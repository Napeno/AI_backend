const { startChat, makeRequestWithRetry, extractResponseText } = require('./gemini.service');
const { buildCheckAnswerPrompt, filterInternalPrompt } = require('./prompt.service');

const checkUserAnswer = async (history, userAnswer, language = 'en') => {
  try {
    const chat = startChat(history);
    const prompt = buildCheckAnswerPrompt(userAnswer, language);
    
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