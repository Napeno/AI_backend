const { startChat, makeRequestWithRetry, extractResponseText } = require('./gemini.service');
const { buildCheckAnswerPrompt, filterInternalPrompt } = require('./prompt.service');

const checkUserAnswer = async (history, userAnswer, language = 'en', educationLevel, subjectArea, imageUrl = null) => {
  try {
    // Filter history to only include roles that Gemini API accepts: user, model, function, system
    const geminiHistory = history
      .filter(msg =>
        msg.role === 'user' || msg.role === 'model' || msg.role === 'function' || msg.role === 'system'
      )
      .map(msg => ({
        role: msg.role,
        parts: msg.parts.map(part => {
          const textPart = { text: part.text || '' };
          // Include image data if available in the part
          if (part.image && part.image.url) {
            // Note: For images from history, we need to fetch and convert them to base64
            // This will be handled in the main image processing section
            console.log('Image found in history, will be processed separately:', part.image.url);
          }
          return textPart;
        })
      }));

    console.log('Original history length:', history.length);
    console.log('Filtered history for Gemini:', geminiHistory.length);

    const chat = startChat(geminiHistory);
    const prompt = buildCheckAnswerPrompt(userAnswer, language, educationLevel, subjectArea);

    console.log('Checking user answer with prompt:', prompt);

    // Prepare message parts for sending
    const messageParts = [{ text: prompt }];

    // Add image if provided
    if (imageUrl) {
      console.log('Adding image to check answer request:', imageUrl);
      // For Gemini, we need to convert the image URL to base64 or use inline data
      try {
        const response = await fetch(imageUrl);
        if (!response.ok) {
          throw new Error(`Failed to fetch image: ${response.status} ${response.statusText}`);
        }
        
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const base64 = buffer.toString('base64');
        const mimeType = response.headers.get('content-type') || 'image/jpeg';
        
        console.log('Image processed successfully:', {
          mimeType,
          dataLength: base64.length,
          imageUrl: imageUrl.substring(0, 50) + '...'
        });

        messageParts.push({
          inlineData: {
            mimeType: mimeType,
            data: base64
          }
        });
      } catch (imageError) {
        console.error('Error processing image for check answer:', imageError);
        // Continue without image if there's an error
      }
    }

    console.log('Sending message to Gemini with parts:', messageParts.map(part => ({
      hasText: !!part.text,
      textLength: part.text ? part.text.length : 0,
      hasInlineData: !!part.inlineData,
      mimeType: part.inlineData ? part.inlineData.mimeType : null,
      dataLength: part.inlineData ? part.inlineData.data.length : 0
    })));

    const result = await makeRequestWithRetry(async () => {
      const response = await chat.sendMessage(messageParts);
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