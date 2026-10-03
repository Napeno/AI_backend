const fs = require('fs');
const path = require('path');
const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

const MAX_KEY_SLOTS = 6;
const DEFAULT_UNHEALTHY_TTL_MS = Number(process.env.GOOGLE_API_KEY_UNHEALTHY_TTL_MS || 6 * 60 * 60 * 1000);
const DEFAULT_PREFERENCE_TTL_MS = Number(process.env.GOOGLE_API_KEY_PREFERENCE_TTL_MS || 24 * 60 * 60 * 1000);
const DEFAULT_STATE_PATH = process.env.GOOGLE_API_KEY_STATE_PATH
  || path.join(__dirname, '../../.cache/gemini-key-state.json');
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite-preview';

const parseKeyOrder = (raw, availableNumbers = []) => {
  const allowed = new Set(availableNumbers);
  return String(raw || '')
    .split(/[\s,]+/)
    .map(part => Number(part))
    .filter(number => Number.isInteger(number) && allowed.has(number));
};

const orderConfiguredKeys = (configured, preferredNumbers = []) => {
  if (!preferredNumbers.length) return [...configured];
  const byNumber = new Map(configured.map(entry => [entry.number, entry]));
  const ordered = [];
  const seen = new Set();
  for (const number of preferredNumbers) {
    const entry = byNumber.get(number);
    if (entry && !seen.has(number)) {
      ordered.push(entry);
      seen.add(number);
    }
  }
  for (const entry of configured) {
    if (!seen.has(entry.number)) ordered.push(entry);
  }
  return ordered;
};

const loadConfiguredKeys = (env = process.env) => {
  const configured = [];
  for (let number = 1; number <= MAX_KEY_SLOTS; number += 1) {
    const key = env[`GOOGLE_API_KEY_${number}`];
    if (key) configured.push({ number, key });
  }
  return configured;
};

const loadOrderedApiKeys = (env = process.env, preferredNumbers = null) => {
  const configured = loadConfiguredKeys(env);
  const preferred = preferredNumbers?.length
    ? preferredNumbers
    : parseKeyOrder(env.GOOGLE_API_KEY_ORDER, configured.map(entry => entry.number));
  return orderConfiguredKeys(configured, preferred);
};

let statePath = DEFAULT_STATE_PATH;
let preferenceTtlMs = DEFAULT_PREFERENCE_TTL_MS;
let unhealthyTtlMs = DEFAULT_UNHEALTHY_TTL_MS;
let memoryState = null;
let persistToDisk = true;
let API_KEYS = [];
let activeKeyIndex = 0;
const unhealthyUntilByNumber = new Map();
let preferredKeyNumber = null;
let preferredUntil = 0;
let lastPersistAt = 0;
const PERSIST_REFRESH_MIN_MS = Number(process.env.GOOGLE_API_KEY_STATE_FLUSH_MS || 5 * 60 * 1000);

const getActiveKeyNumber = () => API_KEYS[activeKeyIndex]?.number || null;

const isKeyHealthy = (keyNumber, now = Date.now()) => {
  const until = unhealthyUntilByNumber.get(keyNumber);
  if (!until) return true;
  if (until <= now) {
    unhealthyUntilByNumber.delete(keyNumber);
    return true;
  }
  return false;
};

const readPersistedState = () => {
  if (memoryState) return memoryState;
  if (!persistToDisk) return null;
  try {
    if (!fs.existsSync(statePath)) return null;
    return JSON.parse(fs.readFileSync(statePath, 'utf8'));
  } catch (error) {
    console.warn(JSON.stringify({
      event: 'gemini_key_state_read_failed',
      path: statePath,
      error: error.message,
    }));
    return null;
  }
};

const writePersistedState = (state) => {
  memoryState = state;
  if (!persistToDisk) return;
  try {
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  } catch (error) {
    console.warn(JSON.stringify({
      event: 'gemini_key_state_write_failed',
      path: statePath,
      error: error.message,
    }));
  }
};

const snapshotState = (now = Date.now()) => ({
  preferredKeyNumber,
  preferredUntil,
  order: API_KEYS.map(entry => entry.number),
  unhealthy: Object.fromEntries(
    [...unhealthyUntilByNumber.entries()]
      .filter(([, until]) => until > now)
      .map(([number, until]) => [String(number), { until }])
  ),
  updatedAt: now,
});

const persistState = (now = Date.now(), { force = true } = {}) => {
  if (!force && now - lastPersistAt < PERSIST_REFRESH_MIN_MS) {
    return;
  }
  writePersistedState(snapshotState(now));
  lastPersistAt = now;
};

const setActiveKeyNumber = (keyNumber) => {
  const index = API_KEYS.findIndex(entry => entry.number === keyNumber);
  if (index >= 0) activeKeyIndex = index;
};

const promoteKey = (keyNumber, reason = 'promote', now = Date.now()) => {
  if (!keyNumber || !API_KEYS.some(entry => entry.number === keyNumber)) return;

  const nextOrder = [
    keyNumber,
    ...API_KEYS.map(entry => entry.number).filter(number => number !== keyNumber),
  ];
  API_KEYS = orderConfiguredKeys(API_KEYS, nextOrder);
  setActiveKeyNumber(keyNumber);
  preferredKeyNumber = keyNumber;
  preferredUntil = now + preferenceTtlMs;
  persistState(now);

  console.warn(JSON.stringify({
    event: 'gemini_key_promoted',
    model: GEMINI_MODEL,
    keyNumber,
    reason,
    preferredForMs: preferenceTtlMs,
  }));
};

const markKeyUnhealthy = (keyNumber, reason, ttlMs = unhealthyTtlMs, now = Date.now()) => {
  if (!keyNumber) return;
  const until = ttlMs > 0 ? now + ttlMs : Number.POSITIVE_INFINITY;
  unhealthyUntilByNumber.set(keyNumber, until);
  persistState(now);
  console.warn(JSON.stringify({
    event: 'gemini_key_unhealthy',
    model: GEMINI_MODEL,
    keyNumber,
    reason,
    skipForMs: ttlMs > 0 ? ttlMs : null,
  }));
};

const getChat = (history, systemInstruction) => {
  if (API_KEYS.length === 0) {
    throw new Error('No Google API keys configured');
  }

  const model = new GoogleGenerativeAI(API_KEYS[activeKeyIndex].key).getGenerativeModel({
    model: GEMINI_MODEL,
    systemInstruction,
  });

  return model.startChat({ history });
};

const rotateApiKey = (triedKeyIndexes, { preferHealthy = true } = {}) => {
  for (let offset = 1; offset < API_KEYS.length; offset += 1) {
    const nextKeyIndex = (activeKeyIndex + offset) % API_KEYS.length;
    if (triedKeyIndexes.has(nextKeyIndex)) continue;
    if (preferHealthy && !isKeyHealthy(API_KEYS[nextKeyIndex].number)) continue;
    activeKeyIndex = nextKeyIndex;
    return true;
  }

  for (let offset = 1; offset < API_KEYS.length; offset += 1) {
    const nextKeyIndex = (activeKeyIndex + offset) % API_KEYS.length;
    if (triedKeyIndexes.has(nextKeyIndex)) continue;
    activeKeyIndex = nextKeyIndex;
    return true;
  }

  return false;
};

const ensureActiveKeyHealthy = () => {
  if (!API_KEYS.length) return;
  if (isKeyHealthy(API_KEYS[activeKeyIndex].number)) return;
  const tried = new Set([activeKeyIndex]);
  if (rotateApiKey(tried, { preferHealthy: true })) {
    promoteKey(getActiveKeyNumber(), 'skip_unhealthy');
  }
};

const getErrorStatus = error => Number(error?.status || error?.response?.status || 0);

const getErrorText = (error) => {
  const parts = [error?.message];

  if (Array.isArray(error?.errorDetails)) {
    for (const detail of error.errorDetails) {
      if (detail?.reason) parts.push(detail.reason);
      if (detail?.message) parts.push(detail.message);
    }
  }

  return parts.filter(Boolean).join(' ');
};

const isRetryableStatus = status => [402, 408, 429, 500, 502, 503, 504].includes(status);
const isInvalidApiKeyError = error => /api key not valid|invalid api key|api_key_invalid/i.test(getErrorText(error));
const isBillingDepletedError = error => /prepayment credits are depleted|payment required|billing/i.test(getErrorText(error));
const isSuspendedApiKeyError = error => {
  const status = getErrorStatus(error);
  if (status !== 403) return false;

  return /consumer_suspended|has been suspended|permission denied|api_key_service_blocked|consumer.*suspended/i
    .test(getErrorText(error));
};

const isPermanentKeyFailure = error => (
  isInvalidApiKeyError(error) ||
  isBillingDepletedError(error) ||
  isSuspendedApiKeyError(error) ||
  getErrorStatus(error) === 402
);

const makeRequestWithRetry = async (requestFn, maxRetries = Math.max(API_KEYS.length, 1)) => {
  const triedKeyIndexes = new Set();
  ensureActiveKeyHealthy();

  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    try {
      const result = await requestFn();

      if (!result) {
        throw new Error('No response from Gemini API');
      }

      if (
        (result.response && typeof result.response.text === 'function') ||
        typeof result.text === 'function'
      ) {
        const activeNumber = getActiveKeyNumber();
        const now = Date.now();
        if (activeNumber && (preferredKeyNumber !== activeNumber || preferredUntil <= now)) {
          promoteKey(activeNumber, 'success', now);
        } else if (activeNumber) {
          // Keep the sticky window alive while this key keeps working.
          preferredUntil = now + preferenceTtlMs;
          persistState(now, { force: false });
        }
        return result;
      }

      throw new Error('Invalid response format from Gemini API');
    } catch (error) {
      const status = getErrorStatus(error);
      const canRotate =
        isRetryableStatus(status) ||
        (status === 400 && isInvalidApiKeyError(error)) ||
        isBillingDepletedError(error) ||
        isSuspendedApiKeyError(error);
      if (!canRotate) throw error;

      const failedKeyNumber = getActiveKeyNumber();
      triedKeyIndexes.add(activeKeyIndex);

      if (isPermanentKeyFailure(error)) {
        const reason = isSuspendedApiKeyError(error)
          ? 'consumer_suspended'
          : isBillingDepletedError(error) || status === 402
            ? 'billing_depleted'
            : 'invalid_api_key';
        markKeyUnhealthy(failedKeyNumber, reason);
      }

      if (attempt < maxRetries && rotateApiKey(triedKeyIndexes)) {
        const nextKeyNumber = getActiveKeyNumber();
        if (isPermanentKeyFailure(error)) {
          promoteKey(nextKeyNumber, 'failover');
        }
        console.warn(JSON.stringify({
          event: 'gemini_key_rotated',
          model: GEMINI_MODEL,
          failedKeyNumber,
          nextKeyNumber,
          status,
          reason: isSuspendedApiKeyError(error) ? 'consumer_suspended' : undefined,
        }));
        continue;
      }

      throw error;
    }
  }
};

const startChat = (history, systemInstruction) => ({
  sendMessage: (...args) => getChat(history, systemInstruction).sendMessage(...args),
});

const extractResponseText = (result) => {
  if (result && result.response) {
    return result.response.text();
  } else if (typeof result.text === 'function') {
    return result.text();
  }

  throw new Error('Invalid response format from Gemini API');
};

const applyPersistedState = (env = process.env, now = Date.now()) => {
  const saved = readPersistedState();
  unhealthyUntilByNumber.clear();

  if (saved?.unhealthy && typeof saved.unhealthy === 'object') {
    for (const [number, info] of Object.entries(saved.unhealthy)) {
      const until = Number(info?.until || 0);
      if (until > now) unhealthyUntilByNumber.set(Number(number), until);
    }
  }

  const preferenceValid = Number(saved?.preferredUntil || 0) > now
    && Number.isInteger(Number(saved?.preferredKeyNumber));
  const savedOrder = Array.isArray(saved?.order)
    ? saved.order.map(Number).filter(Number.isInteger)
    : [];

  const preferredNumbers = preferenceValid
    ? [Number(saved.preferredKeyNumber), ...savedOrder]
    : parseKeyOrder(env.GOOGLE_API_KEY_ORDER, loadConfiguredKeys(env).map(entry => entry.number));

  API_KEYS = loadOrderedApiKeys(env, preferredNumbers);
  preferredKeyNumber = preferenceValid ? Number(saved.preferredKeyNumber) : null;
  preferredUntil = preferenceValid ? Number(saved.preferredUntil) : 0;

  if (preferredKeyNumber && isKeyHealthy(preferredKeyNumber, now)) {
    setActiveKeyNumber(preferredKeyNumber);
  } else {
    activeKeyIndex = 0;
    ensureActiveKeyHealthy();
  }
};

const resetGeminiKeyState = (env = process.env, options = {}) => {
  statePath = options.statePath || DEFAULT_STATE_PATH;
  preferenceTtlMs = Number(options.preferenceTtlMs || process.env.GOOGLE_API_KEY_PREFERENCE_TTL_MS || DEFAULT_PREFERENCE_TTL_MS);
  unhealthyTtlMs = Number(options.unhealthyTtlMs || process.env.GOOGLE_API_KEY_UNHEALTHY_TTL_MS || DEFAULT_UNHEALTHY_TTL_MS);
  persistToDisk = options.persistToDisk !== false && options.useMemoryState !== true;
  memoryState = options.useMemoryState ? (options.initialState || {}) : null;
  if (options.clearState) memoryState = options.useMemoryState ? {} : null;

  preferredKeyNumber = null;
  preferredUntil = 0;
  unhealthyUntilByNumber.clear();
  applyPersistedState(env);
};

// Initialize from env + any saved preference on boot.
resetGeminiKeyState(process.env, {
  persistToDisk: true,
  useMemoryState: false,
});

module.exports = {
  extractResponseText,
  makeRequestWithRetry,
  startChat,
  parseKeyOrder,
  loadOrderedApiKeys,
  resetGeminiKeyState,
  getActiveKeyNumber,
  isKeyHealthy,
  markKeyUnhealthy,
  promoteKey,
  snapshotState,
};
