const { startChat, makeRequestWithRetry, extractResponseText } = require('./gemini.service');
const { buildFullAnswerPrompt, filterInternalPrompt } = require('./prompt.service');

const getFullAnswer = async (history, language = 'en', educationLevel, subjectArea, course = null) => {
  try {
    // Filter history to only include roles that Gemini API accepts: user, model, function, system
    const geminiHistory = history
      .filter(msg => 
        msg.role === 'user' || msg.role === 'model' || msg.role === 'function' || msg.role === 'system'
      )
      .map(msg => ({
        role: msg.role,
        parts: msg.parts.map(part => ({ text: part.text || '' }))
      }));
    
    console.log('Original history length:', history.length);
    console.log('Filtered history for Gemini:', geminiHistory.length);
    
    const chat = startChat(geminiHistory);
    const prompt = buildFullAnswerPrompt(language, educationLevel, subjectArea, course);
    
    console.log('Getting full answer with prompt:', prompt);
    
    const result = await makeRequestWithRetry(async () => {
      const response = await chat.sendMessage(prompt);
      return response;
    });
    
    console.log('Full answer response:', result);
    
    const responseText = extractResponseText(result);
    console.log('Full answer text content:', responseText);
    
    const filteredResponse = filterInternalPrompt(responseText, language);
    console.log('Filtered full answer:', filteredResponse);
    
    return filteredResponse;
  } catch (error) {
    console.error('Error in getFullAnswer:', error);
    throw error;
  }
};

module.exports = {
  getFullAnswer,
}; 
