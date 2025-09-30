const { startChat, makeRequestWithRetry, extractResponseText } = require('./gemini.service');
const { buildContinuePrompt, filterInternalPrompt } = require('./prompt.service');

const getContinuation = async (history, language = 'en', educationLevel, subjectArea, course = null) => {
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
    
    // Build prompt and strengthen with structured-output instruction
    let prompt = buildContinuePrompt(language, educationLevel, subjectArea, course);
    const jsonInstrVi = 'Chỉ trả về JSON dạng {"hints": ["..."], "question": "..."}. Không tiết lộ toàn bộ lời giải.';
    const jsonInstrEn = 'Return only JSON of the form {"hints": ["..."], "question": "..."}. Do not reveal the full solution.';
    prompt += `\n\n${language === 'vi' ? jsonInstrVi : jsonInstrEn}`;

    // Start chat with schema-enforced generation
    const chat = startChat(geminiHistory, {
      generationConfig: {
        maxOutputTokens: 600,
        temperature: 0.7,
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'object',
          properties: {
            hints: {
              type: 'array',
              items: { type: 'string' },
              minItems: 1,
              maxItems: 3
            },
            question: { type: 'string' }
          },
          required: ['hints', 'question'],
          additionalProperties: false
        }
      }
    });

    console.log('Getting continuation with prompt (schema-enforced)');

    const result = await makeRequestWithRetry(async () => {
      const response = await chat.sendMessage(prompt);
      return response;
    });

    console.log('Continuation response:', result);

    const responseText = extractResponseText(result);
    console.log('Continuation text content:', responseText);

    // Try to parse structured output to enforce hint-only policy
    let formattedText = null;
    try {
      const json = JSON.parse(responseText);
      if (json && Array.isArray(json.hints)) {
        const hints = json.hints
          .filter(h => typeof h === 'string' && h.trim())
          .slice(0, 3);
        const question = typeof json.question === 'string' ? json.question.trim() : '';
        if (hints.length) {
          formattedText = `${hints.map((h, i) => `- Gợi ý ${i + 1}: ${h}`).join('\n')}` +
            (question ? `\n\n${question}` : (language === 'vi' ? '\n\nCậu nghĩ bước tiếp theo là gì?' : '\n\nWhat do you think is the next step?'));
        }
      }
    } catch (_) {}

    const filteredResponse = filterInternalPrompt(formattedText || responseText, language);
    console.log('Filtered continuation:', filteredResponse);

    return filteredResponse || (language === 'vi'
      ? 'Tớ sẽ gợi ý thêm nhưng chưa hiểu rõ ý cậu. Cậu mô tả cụ thể hơn nhé?'
      : 'I can hint more, but please clarify what you need.');
  } catch (error) {
    console.error('Error in getContinuation:', error);
    throw error;
  }
};

module.exports = {
  getContinuation,
}; 
