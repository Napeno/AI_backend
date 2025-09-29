const { GoogleGenerativeAI } = require("@google/generative-ai");
require('dotenv').config();

// Resolve API key (supports either GOOGLE_API_KEY or GEMINI_API_KEY)
const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
if (!apiKey) {
  throw new Error(
    "Missing Google API key. Set 'GOOGLE_API_KEY' (preferred) or 'GEMINI_API_KEY' in your environment."
  );
}

// Resolve model id from env, or derive from GEMINI_API_URL if provided, else default
const resolveModelId = () => {
  const direct = process.env.GEMINI_MODEL || process.env.GEMINI_MODEL_ID;
  if (direct && typeof direct === 'string' && direct.trim()) return direct.trim();

  const url = process.env.GEMINI_API_URL;
  if (url && typeof url === 'string') {
    const m = url.match(/\/models\/([^:\/]+):generateContent/);
    if (m && m[1]) return m[1];
  }
  // Default to widely available 1.5 Flash
  return 'gemini-1.5-flash';
};

const modelId = resolveModelId();
console.log('[Gemini] Using model:', modelId);
const genAI = new GoogleGenerativeAI(apiKey);
const model = genAI.getGenerativeModel({ model: modelId });

// Helper function for retry logic with exponential backoff
const makeRequestWithRetry = async (requestFn, maxRetries = 3) => {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await requestFn();
      console.log('API Response result:', typeof result, result);
      
      // Check if we have a valid response object
      if (!result) {
        console.error('No result returned');
        throw new Error('No response from Gemini API');
      }
      
      // Check if result has response property with text function
      if (result.response && typeof result.response.text === 'function') {
        console.log('Valid response format with response.text function');
        return result;
      }
      
      // Check if result has direct text function
      if (typeof result.text === 'function') {
        console.log('Valid response format with direct text function');
        return result;
      }
      
      console.error('Invalid response format:', result);
      throw new Error('Invalid response format from Gemini API');
      
    } catch (error) {
      if (error.status === 429 && attempt < maxRetries) {
        console.log(`Rate limit hit, waiting before retry ${attempt + 1}/${maxRetries}...`);
        const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
        await delay(5000 * attempt); // Exponential backoff: 5s, 10s, 15s
        continue;
      }
      throw error;
    }
  }
};

const startChat = (history) => {
  return model.startChat({ history });
};

const extractResponseText = (result) => {
  if (result && result.response) {
    return result.response.text();
  } else if (typeof result.text === 'function') {
    return result.text();
  } else {
    throw new Error('Invalid response format from Gemini API');
  }
};

module.exports = {
  model,
  makeRequestWithRetry,
  startChat,
  extractResponseText,
}; 
