const { GoogleGenerativeAI } = require("@google/generative-ai");
require('dotenv').config();

// Import language files
const enPrompts = require('../locales/en.json');
const viPrompts = require('../locales/vi.json');

// Access your API key as an environment variable (see "Set up your API key" above)
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

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

const sendMessage = async (history, message, language = 'en') => {
  try {
    const chat = model.startChat({ history });
    const prompts = language === 'vi' ? viPrompts : enPrompts;
    const prompt = prompts.prompts.chat.replace('{{message}}', message);
    
    console.log('Sending message with prompt:', prompt);
    
    const result = await chat.sendMessage(prompt);
    console.log('Response from Gemini:', result);
    console.log('Result type:', typeof result);
    console.log('Result keys:', Object.keys(result));
    
    // Check if result has response property
    if (result && result.response) {
      console.log('Response object:', result.response);
      console.log('Response keys:', Object.keys(result.response));
      
      // Get the text from response
      const responseText = result.response.text();
      console.log('Response text:', responseText);
      
      const filteredResponse = filterInternalPrompt(responseText, language);
      console.log('Filtered response:', filteredResponse);
      
      return filteredResponse;
    } else {
      // Fallback: try to get text directly from result
      console.log('No response property, trying direct text access');
      if (typeof result.text === 'function') {
        const responseText = result.text();
        console.log('Direct text response:', responseText);
        
        const filteredResponse = filterInternalPrompt(responseText, language);
        console.log('Filtered response:', filteredResponse);
        
        return filteredResponse;
      } else {
        throw new Error('Invalid response format from Gemini API');
      }
    }
  } catch (error) {
    console.error('Error in sendMessage:', error);
    throw error;
  }
};

const getContinuation = async (history, language = 'en') => {
  try {
    const chat = model.startChat({ history });
    const prompts = language === 'vi' ? viPrompts : enPrompts;
    const prompt = prompts.prompts.continue;
    
    console.log('Getting continuation with prompt:', prompt);
    
    const result = await makeRequestWithRetry(async () => {
      const response = await chat.sendMessage(prompt);
      return response;
    });
    
    console.log('Continuation response:', result);
    
    // Get the text response from the result
    let responseText;
    if (result && result.response) {
      responseText = result.response.text();
    } else if (typeof result.text === 'function') {
      responseText = result.text();
    } else {
      throw new Error('Invalid response format from Gemini API');
    }
    
    console.log('Continuation text content:', responseText);
    
    const filteredResponse = filterInternalPrompt(responseText, language);
    console.log('Filtered continuation:', filteredResponse);
    
    return filteredResponse;
  } catch (error) {
    console.error('Error in getContinuation:', error);
    throw error;
  }
};

const getFullAnswer = async (history, language = 'en') => {
  try {
    const chat = model.startChat({ history });
    const prompts = language === 'vi' ? viPrompts : enPrompts;
    const prompt = prompts.prompts.fullAnswer;
    
    console.log('Getting full answer with prompt:', prompt);
    
    const result = await makeRequestWithRetry(async () => {
      const response = await chat.sendMessage(prompt);
      return response;
    });
    
    console.log('Full answer response:', result);
    
    // Get the text response from the result
    let responseText;
    if (result && result.response) {
      responseText = result.response.text();
    } else if (typeof result.text === 'function') {
      responseText = result.text();
    } else {
      throw new Error('Invalid response format from Gemini API');
    }
    
    console.log('Full answer text content:', responseText);
    
    const filteredResponse = filterInternalPrompt(responseText, language);
    console.log('Filtered full answer:', filteredResponse);
    
    return filteredResponse;
  } catch (error) {
    console.error('Error in getFullAnswer:', error);
    throw error;
  }
};

const checkUserAnswer = async (history, userAnswer, language = 'en') => {
  try {
    const chat = model.startChat({ history });
    const prompts = language === 'vi' ? viPrompts : enPrompts;
    const prompt = prompts.prompts.checkAnswer.replace('{{userAnswer}}', userAnswer);
    
    console.log('Checking user answer with prompt:', prompt);
    
    const result = await makeRequestWithRetry(async () => {
      const response = await chat.sendMessage(prompt);
      return response;
    });
    
    console.log('Check answer response:', result);
    
    // Get the text response from the result
    let responseText;
    if (result && result.response) {
      responseText = result.response.text();
    } else if (typeof result.text === 'function') {
      responseText = result.text();
    } else {
      throw new Error('Invalid response format from Gemini API');
    }
    
    console.log('Check answer text content:', responseText);
    
    const filteredResponse = filterInternalPrompt(responseText, language);
    console.log('Filtered check answer:', filteredResponse);
    
    return filteredResponse;
  } catch (error) {
    console.error('Error in checkUserAnswer:', error);
    throw error;
  }
};

// Helper function to filter out internal prompt text
const filterInternalPrompt = (text, language) => {
  if (language === 'vi') {
    // Remove Vietnamese internal prompts
    const patterns = [
      /Học sinh đã đưa ra câu trả lời để kiểm tra\. Hãy:[\s\S]*?đáp án hoàn chỉnh!/,
      /Học sinh đang gặp khó khăn và cần thêm gợi ý\. QUAN TRỌNG:[\s\S]*?70% đáp án!/,
      /Học sinh đã yêu cầu được trả lời đầy đủ\. Lần này[\s\S]*?100% đáp án!/,
      /Bạn là một người thầy thân thiện và kiên nhẫn[\s\S]*?phần còn lại!/,
      /QUAN TRỌNG: Bạn KHÔNG BAO GIỜ được trả lời hết đáp án[\s\S]*?phần còn lại!/,
      /QUY TẮC: Chỉ gợi ý 30-40% đáp án[\s\S]*?phần còn lại!/,
      /QUY TẮC: Chỉ gợi ý thêm 20-30% nữa[\s\S]*?70% đáp án!/,
      /QUY TẮC: Bây giờ bạn có thể trả lời 100% đáp án!/,
      /QUY TẮC: Chỉ đánh giá và gợi ý[\s\S]*?đáp án hoàn chỉnh!/,
      /Student is having difficulty and needs more hints\. IMPORTANT:[\s\S]*?70% of the answer!/,
      /IMPORTANT: You MUST NOT give the full answer[\s\S]*?60-70% of the answer!/
    ];
    
    patterns.forEach(pattern => {
      text = text.replace(pattern, '');
    });
  } else {
    // Remove English internal prompts
    const patterns = [
      /The student has provided their answer for checking\. Please:[\s\S]*?complete answers!/,
      /The student is having difficulty and needs more hints\. IMPORTANT:[\s\S]*?70% of the answer!/,
      /The student has requested a complete answer\. This time[\s\S]*?100% of the answer!/,
      /You are a friendly and patient teacher[\s\S]*?discover the rest!/,
      /IMPORTANT: You must NEVER give complete answers[\s\S]*?discover the rest!/,
      /RULE: Only hint 30-40% of the answer[\s\S]*?discover the rest!/,
      /RULE: Only hint an additional 20-30%[\s\S]*?70% of the answer!/,
      /RULE: Now you can give 100% of the answer!/,
      /RULE: Only evaluate and suggest[\s\S]*?complete answers!/
    ];
    
    patterns.forEach(pattern => {
      text = text.replace(pattern, '');
    });
  }
  
  // Clean up any remaining formatting instructions
  text = text.replace(/\*\*Lưu ý:\*\*[\s\S]*?từ khóa quan trọng/g, '');
  text = text.replace(/\*\*Note:\*\*[\s\S]*?important keywords/g, '');
  
  // Clean up extra whitespace
  text = text.replace(/\n\s*\n\s*\n/g, '\n\n').trim();
  
  return text;
};

module.exports = {
    startChat,
    sendMessage,
    getContinuation,
    getFullAnswer,
    checkUserAnswer,
}; 