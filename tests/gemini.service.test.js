const assert = require('node:assert/strict');
const test = require('node:test');
const {
  makeRequestWithRetry,
  parseKeyOrder,
  loadOrderedApiKeys,
  resetGeminiKeyState,
  getActiveKeyNumber,
  markKeyUnhealthy,
  isKeyHealthy,
  snapshotState,
} = require('../src/services/gemini.service');

const baseEnv = (order = '1,2,3') => ({
  GOOGLE_API_KEY_1: 'key-1',
  GOOGLE_API_KEY_2: 'key-2',
  GOOGLE_API_KEY_3: 'key-3',
  GOOGLE_API_KEY_ORDER: order,
});

const withKeys = (order = '1,2,3', options = {}) => {
  resetGeminiKeyState(baseEnv(order), {
    useMemoryState: true,
    initialState: options.initialState || {},
    preferenceTtlMs: options.preferenceTtlMs || 60_000,
    unhealthyTtlMs: options.unhealthyTtlMs || 60_000,
    ...options,
  });
};

test('parseKeyOrder keeps only configured key numbers', () => {
  assert.deepEqual(parseKeyOrder('3, 1,9,2', [1, 2, 3]), [3, 1, 2]);
});

test('loadOrderedApiKeys respects GOOGLE_API_KEY_ORDER', () => {
  const ordered = loadOrderedApiKeys({
    GOOGLE_API_KEY_1: 'a',
    GOOGLE_API_KEY_2: 'b',
    GOOGLE_API_KEY_3: 'c',
    GOOGLE_API_KEY_ORDER: '3,1',
  });
  assert.deepEqual(ordered.map(entry => entry.number), [3, 1, 2]);
  assert.deepEqual(ordered.map(entry => entry.key), ['c', 'a', 'b']);
});

test('retries with the next configured key after a quota response', async () => {
  withKeys();
  let calls = 0;
  const result = await makeRequestWithRetry(async () => {
    calls += 1;
    if (calls === 1) {
      const error = new Error('Quota exceeded');
      error.status = 429;
      throw error;
    }

    return { response: { text: () => 'ok' } };
  });

  assert.equal(calls, 2);
  assert.equal(result.response.text(), 'ok');
});

test('retries transient Gemini service outages with the next configured key', async () => {
  withKeys();
  let calls = 0;
  const result = await makeRequestWithRetry(async () => {
    calls += 1;
    if (calls === 1) {
      const error = new Error('Service unavailable');
      error.status = 503;
      throw error;
    }

    return { response: { text: () => 'ok' } };
  });

  assert.equal(calls, 2);
  assert.equal(result.response.text(), 'ok');
});

test('skips an invalid API key instead of turning it into a service outage', async () => {
  withKeys();
  let calls = 0;
  const result = await makeRequestWithRetry(async () => {
    calls += 1;
    if (calls === 1) {
      const error = new Error('API key not valid. Please pass a valid API key.');
      error.status = 400;
      throw error;
    }

    return { response: { text: () => 'ok' } };
  });

  assert.equal(calls, 2);
  assert.equal(result.response.text(), 'ok');
  assert.equal(isKeyHealthy(1), false);
});

test('rolls back to the next key when the active consumer is suspended', async () => {
  withKeys();
  let calls = 0;
  const result = await makeRequestWithRetry(async () => {
    calls += 1;
    if (calls === 1) {
      const error = new Error(
        "Permission denied: Consumer 'api_key:AIzaSyTEST' has been suspended."
      );
      error.status = 403;
      error.errorDetails = [
        {
          reason: 'CONSUMER_SUSPENDED',
          domain: 'googleapis.com',
        },
      ];
      throw error;
    }

    return { response: { text: () => 'ok' } };
  });

  assert.equal(calls, 2);
  assert.equal(result.response.text(), 'ok');
  assert.equal(getActiveKeyNumber(), 2);
  assert.equal(isKeyHealthy(1), false);
});

test('skips unhealthy keys on the next request without probing them again', async () => {
  withKeys('1,2,3');
  markKeyUnhealthy(1, 'consumer_suspended', 60_000);
  markKeyUnhealthy(2, 'billing_depleted', 60_000);

  let calls = 0;
  const seenKeys = [];
  const result = await makeRequestWithRetry(async () => {
    calls += 1;
    seenKeys.push(getActiveKeyNumber());
    return { response: { text: () => 'ok' } };
  });

  assert.equal(calls, 1);
  assert.deepEqual(seenKeys, [3]);
  assert.equal(result.response.text(), 'ok');
});

test('preferred order starts with the env-selected key', async () => {
  withKeys('3,1,2');
  assert.equal(getActiveKeyNumber(), 3);

  let calls = 0;
  const seenKeys = [];
  await makeRequestWithRetry(async () => {
    calls += 1;
    seenKeys.push(getActiveKeyNumber());
    return { response: { text: () => 'ok' } };
  });

  assert.equal(calls, 1);
  assert.deepEqual(seenKeys, [3]);
});

test('promotes the next healthy key and restores it after reload', async () => {
  withKeys('1,2,3', { preferenceTtlMs: 60_000 });

  let calls = 0;
  await makeRequestWithRetry(async () => {
    calls += 1;
    if (calls === 1) {
      const error = new Error('Permission denied: Consumer has been suspended.');
      error.status = 403;
      error.errorDetails = [{ reason: 'CONSUMER_SUSPENDED' }];
      throw error;
    }
    return { response: { text: () => 'ok' } };
  });

  assert.equal(getActiveKeyNumber(), 2);
  const saved = snapshotState();
  assert.equal(saved.preferredKeyNumber, 2);
  assert.ok(saved.preferredUntil > Date.now());
  assert.equal(saved.order[0], 2);

  resetGeminiKeyState(baseEnv('1,2,3'), {
    useMemoryState: true,
    initialState: saved,
    preferenceTtlMs: 60_000,
  });

  assert.equal(getActiveKeyNumber(), 2);
  assert.equal(isKeyHealthy(1), false);
});

test('expired preference falls back to env order', () => {
  resetGeminiKeyState(baseEnv('1,2,3'), {
    useMemoryState: true,
    preferenceTtlMs: 60_000,
    initialState: {
      preferredKeyNumber: 3,
      preferredUntil: Date.now() - 1000,
      order: [3, 1, 2],
      unhealthy: {},
    },
  });

  assert.equal(getActiveKeyNumber(), 1);
});
