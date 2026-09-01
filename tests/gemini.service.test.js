const assert = require('node:assert/strict');
const test = require('node:test');
const { makeRequestWithRetry } = require('../src/services/gemini.service');

test('retries with the next configured key after a quota response', async () => {
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
});
