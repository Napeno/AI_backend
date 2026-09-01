const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

const API_KEYS = Array.from({ length: 6 }, (_, index) => process.env[`GOOGLE_API_KEY_${index + 1}`])
  .filter(Boolean);
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite-preview';
let activeKeyIndex = 0;

const getActiveKeyNumber = () => activeKeyIndex + 1;

const getChat = (history, systemInstruction) => {
  if (API_KEYS.length === 0) {
    throw new Error('No Google API keys configured');
  }

  const model = new GoogleGenerativeAI(API_KEYS[activeKeyIndex]).getGenerativeModel({
    model: GEMINI_MODEL,
    systemInstruction,
  });

  return model.startChat({ history });
};

const rotateApiKey = (triedKeyIndexes) => {
  for (let offset = 1; offset < API_KEYS.length; offset += 1) {
    const nextKeyIndex = (activeKeyIndex + offset) % API_KEYS.length;
    if (!triedKeyIndexes.has(nextKeyIndex)) {
      activeKeyIndex = nextKeyIndex;
      return true;
    }
  }

  return false;
};

const getErrorStatus = error => Number(error?.status || error?.response?.status || 0);
const isRetryableStatus = status => [408, 429, 500, 502, 503, 504].includes(status);
const isInvalidApiKeyError = error => /api key not valid|invalid api key|api_key_invalid/i.test(String(error?.message || ''));

const makeRequestWithRetry = async (requestFn, maxRetries = Math.max(API_KEYS.length, 1)) => {
  const triedKeyIndexes = new Set();

  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    try {
      const result = await requestFn();

      if (!result) {
        throw new Error('No response from Gemini API');
      }

      if (result.response && typeof result.response.text === 'function') {
        return result;
      }

      if (typeof result.text === 'function') {
        return result;
      }

      throw new Error('Invalid response format from Gemini API');
    } catch (error) {
      const status = getErrorStatus(error);
      if (!isRetryableStatus(status) && !(status === 400 && isInvalidApiKeyError(error))) throw error;

      triedKeyIndexes.add(activeKeyIndex);
      if (attempt < maxRetries && rotateApiKey(triedKeyIndexes)) {
        console.warn(JSON.stringify({
          event: 'gemini_key_rotated',
          model: GEMINI_MODEL,
          failedKeyNumber: [...triedKeyIndexes].at(-1) + 1,
          nextKeyNumber: getActiveKeyNumber(),
          status,
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

module.exports = {
  extractResponseText,
  makeRequestWithRetry,
  startChat,
};
