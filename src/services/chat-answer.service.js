const { startChat, makeRequestWithRetry, extractResponseText } = require('./gemini.service');
const { buildFullAnswerPrompt, buildSystemInstruction, filterInternalPrompt } = require('./prompt.service');

const getFullAnswer = async (history, language = 'en', educationLevel, subjectArea) => {
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

    const fullAnswerException = language === 'vi'
      ? ' NGOẠI LỆ: Ở lượt này học sinh đã vượt qua điều kiện hỗ trợ và được phép nhận lời giải đầy đủ. Hãy trả lời 100% rõ ràng, nhưng vẫn giải thích theo hướng học tập.'
      : ' EXCEPTION: In this turn the student has passed the support gate and may receive the complete answer. Give 100% of the answer clearly while keeping it educational.';
    const systemInstruction = `${buildSystemInstruction(language, educationLevel, subjectArea)}${fullAnswerException}`;
    const chat = startChat(geminiHistory, systemInstruction);
    const prompt = buildFullAnswerPrompt(language, educationLevel, subjectArea);

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
