const { startChat, makeRequestWithRetry, extractResponseText } = require('./gemini.service');
const { buildCheckAnswerPrompt, filterInternalPrompt } = require('./prompt.service');

const checkUserAnswer = async (history, userAnswer, language = 'en', educationLevel, subjectArea) => {
  try {
    // Filter history to only include roles that Gemini API accepts: user, model, function, system
    const geminiHistory = history
      .filter(msg => 
        msg.role === 'user' || msg.role === 'model' || msg.role === 'function' || msg.role === 'system'
      )
      .map(msg => ({
        role: msg.role,
        parts: msg.parts
      }));
    
    console.log('Original history length:', history.length);
    console.log('Filtered history for Gemini:', geminiHistory.length);
    
    const chat = startChat(geminiHistory);
    const prompt = buildCheckAnswerPrompt(userAnswer, language, educationLevel, subjectArea);
    
    console.log('Checking user answer with prompt:', prompt);
    
    const result = await makeRequestWithRetry(async () => {
      const response = await chat.sendMessage(prompt);
      return response;
    });
    
    console.log('Check answer response:', result);
    
    const responseText = extractResponseText(result);
    console.log('Check answer text content:', responseText);
    
    const filteredResponse = filterInternalPrompt(responseText, language);
    console.log('Filtered check answer:', filteredResponse);
    
    return filteredResponse;
  } catch (error) {
    console.error('Error in checkUserAnswer:', error);
    throw error;
  }
};

module.exports = {
  checkUserAnswer,
}; 