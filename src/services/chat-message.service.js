const { startChat, makeRequestWithRetry, extractResponseText } = require('./gemini.service');
const { buildChatPrompt, buildSystemInstruction, filterInternalPrompt } = require('./prompt.service');

const sendMessage = async (history, message, language = 'en', educationLevel, subjectArea, imageUrl = null) => {
  try {
    // Build user prompt from the original user message and prompts
    const userPrompt = buildChatPrompt(message, language, educationLevel, subjectArea);
    console.log('Using user prompt:', userPrompt);

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
    // Start chat with the gemini-compatible history and system instruction
    const systemInstruction = buildSystemInstruction(language, educationLevel, subjectArea);
    const chat = startChat(geminiHistory, systemInstruction);

    // Prepare message parts
    const messageParts = [{ text: userPrompt }];

    // Add image if provided
    if (imageUrl) {
      const response = await fetch(imageUrl);
      if (!response.ok) {
        throw new Error(`Unable to read uploaded image: ${response.status}`);
      }
      const buffer = await response.arrayBuffer();
      const base64Data = Buffer.from(buffer).toString('base64');
      const mimeType = response.headers.get('content-type') || 'image/jpeg';

      messageParts.push({
        inlineData: {
          data: base64Data,
          mimeType: mimeType
        }
      });
    }

    // Send message with parts
    const result = await makeRequestWithRetry(() => chat.sendMessage(messageParts));
    console.log('Response from Gemini:', result);
    console.log('Result type:', typeof result);
    console.log('Result keys:', Object.keys(result));

    const responseText = extractResponseText(result);
    console.log('Response text:', responseText);

    const filteredResponse = filterInternalPrompt(responseText, language);
    console.log('Filtered response:', filteredResponse);

    return filteredResponse;
  } catch (error) {
    console.error('Error in sendMessage:', error);
    throw error;
  }
};

module.exports = {
  sendMessage,
};
