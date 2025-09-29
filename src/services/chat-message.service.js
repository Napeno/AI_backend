const { model, extractResponseText } = require('./gemini.service');
const { buildChatPrompt, filterInternalPrompt } = require('./prompt.service');

const sendMessage = async (history, message, language = 'en', educationLevel, subjectArea, course = null, imageUrl = null) => {
  try {
    // Build system context from the original user message and prompts
    let systemContext = buildChatPrompt(message, language, educationLevel, subjectArea, course);
    // Strengthen hint-only policy with structured output instruction
    const jsonInstrVi = 'Chỉ trả về JSON dạng {"hints": ["..."], "question": "..."}. Không tiết lộ toàn bộ lời giải.';
    const jsonInstrEn = 'Return only JSON of the form {"hints": ["..."], "question": "..."}. Do not reveal the full solution.';
    systemContext += `\n\n${language === 'vi' ? jsonInstrVi : jsonInstrEn}`;
    console.log('Using system context:', systemContext);
    
    // Filter out system prompts from existing history
    const cleanHistory = history.filter(msg => 
      !msg.parts[0]?.text?.includes('Bạn là một người thầy thân thiện') &&
      !msg.parts[0]?.text?.includes('You are a friendly friend') &&
      !msg.parts[0]?.text?.includes('QUAN TRỌNG: Bạn KHÔNG BAO GIỜ')
    );
    
    // Further filter to only include roles that Gemini API accepts
    const geminiHistory = cleanHistory
      .filter(msg => 
        msg.role === 'user' || msg.role === 'model' || msg.role === 'function' || msg.role === 'system'
      )
      .map(msg => {
        // We will pass the history as is, assuming it's in the correct format
        // The image handling will be done for the CURRENT message, not past messages.
        return {
          role: msg.role,
          parts: msg.parts.map(part => ({ text: part.text })) // Assuming history parts are text for now
        };
      });
    
    console.log('Clean history length:', cleanHistory.length);
    console.log('Gemini history length:', geminiHistory.length);
    
    // Start chat with the gemini-compatible history
    const chat = model.startChat({ 
      history: geminiHistory,
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
          required: ['hints', 'question']
        }
      },
      systemInstruction: {
        role: 'system',
        parts: [{ text: systemContext }]
      }
    });
    
    // Prepare message parts
    const messageParts = [{ text: message }];
    
    // Add image if provided
    if (imageUrl) {
        const response = await fetch(imageUrl);
        const buffer = await response.arrayBuffer();
        const base64Data = Buffer.from(buffer).toString('base64');
        const mimeType = response.headers.get('content-type');
        
        messageParts.push({
            inlineData: {
                data: base64Data,
                mimeType: mimeType
            }
        });
    }
    
    // Send message with parts
    const result = await chat.sendMessage(messageParts);
    console.log('Response from Gemini:', result);
    console.log('Result type:', typeof result);
    console.log('Result keys:', Object.keys(result));
    
    const responseText = extractResponseText(result);
    console.log('Response text:', responseText);

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
    } catch (_) {
      // Not JSON; fall back to free text with filter
    }

    const filteredResponse = filterInternalPrompt(formattedText || responseText, language);
    console.log('Filtered response:', filteredResponse);
    
    // Ensure we never return an empty string to the client
    return filteredResponse || (language === 'vi' 
      ? 'Xin lỗi, tớ chưa hiểu yêu cầu. Cậu có thể nói rõ hơn không?' 
      : "Sorry, I couldn't parse the response. Could you rephrase?");
  } catch (error) {
    console.error('Error in sendMessage:', error);
    throw error;
  }
};

module.exports = {
  sendMessage,
}; 
