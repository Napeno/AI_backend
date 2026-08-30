const { startChat, makeRequestWithRetry, extractResponseText } = require('./gemini.service');
const { buildContinuePrompt, buildCurrentQuestionReminder, buildSystemInstruction, filterInternalPrompt } = require('./prompt.service');

const getContinuation = async (history, language = 'en', educationLevel, subjectArea, course = null, promptOverride = null) => {
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

    const systemInstruction = buildSystemInstruction(language, educationLevel, subjectArea, course);
    const chat = startChat(geminiHistory, systemInstruction);
    const prompt = `${promptOverride || buildContinuePrompt(language, educationLevel, subjectArea, course)}${buildCurrentQuestionReminder(history, language, course)}${educationLevel === 'middle'
      ? language === 'vi'
        ? '\nChỉ trả lời tối đa 4 câu ngắn, nêu đúng 1 gợi ý và không mở rộng sang nội dung ngoài đề.'
        : '\nReply in at most 4 short sentences, give exactly 1 hint, and do not expand beyond the problem.'
      : ''}`;

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
