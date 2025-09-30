const { startChat, makeRequestWithRetry, extractResponseText } = require('./gemini.service');
const { buildContinuePrompt, filterInternalPrompt } = require('./prompt.service');

const getContinuation = async (history, language = 'en', educationLevel, subjectArea) => {
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
    const prompt = buildContinuePrompt(language, educationLevel, subjectArea);
    
    console.log('Getting continuation with prompt:', prompt);
    
    const result = await makeRequestWithRetry(async () => {
      const response = await chat.sendMessage(prompt);
      return response;
    });
    
    console.log('Continuation response:', result);
    
    const responseText = extractResponseText(result);
    console.log('Continuation text content:', responseText);
    
    const filteredResponse = filterInternalPrompt(responseText, language);
    console.log('Filtered continuation:', filteredResponse);
    
    return filteredResponse;
  } catch (error) {
    console.error('Error in getContinuation:', error);
    throw error;
  }
};

module.exports = {
  getContinuation,
}; 