const { model, extractResponseText } = require('./gemini.service');
const { buildChatPrompt, filterInternalPrompt } = require('./prompt.service');

const sendMessage = async (history, message, language = 'en', educationLevel, subjectArea) => {
  try {
    // Build system context from the original user message and prompts
    const systemContext = buildChatPrompt(message, language, educationLevel, subjectArea);
    console.log('Using system context:', systemContext);
    
    // Filter out system prompts from existing history
    const cleanHistory = history.filter(msg => 
      !msg.parts[0].text.includes('Bạn là một người thầy thân thiện') &&
      !msg.parts[0].text.includes('You are a friendly teacher') &&
      !msg.parts[0].text.includes('QUAN TRỌNG: Bạn KHÔNG BAO GIỜ')
    );
    
    // Further filter to only include roles that Gemini API accepts
    const geminiHistory = cleanHistory
      .filter(msg => 
        msg.role === 'user' || msg.role === 'model' || msg.role === 'function' || msg.role === 'system'
      )
      .map(msg => ({
        role: msg.role,
        parts: msg.parts
      }));
    
    console.log('Clean history length:', cleanHistory.length);
    console.log('Gemini history length:', geminiHistory.length);
    
    // Start chat with the gemini-compatible history (must start with user message or be empty)
    const chat = model.startChat({ 
      history: geminiHistory,
      generationConfig: {
        maxOutputTokens: 1000,
        temperature: 0.7,
      },
      systemInstruction: {
        role: 'system',
        parts: [{ text: systemContext }]
      }
    });
    
    // Send just the user's actual message
    const result = await chat.sendMessage(message);
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