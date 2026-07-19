const { startChat, makeRequestWithRetry, extractResponseText } = require('./gemini.service');
const { buildCheckAnswerPrompt, buildSystemInstruction, filterInternalPrompt } = require('./prompt.service');

const getProblemContext = (history = []) => {
  const sourceIndex = [...history].map(message => message.role).lastIndexOf('user');
  if (sourceIndex === -1) {
    return { imageUrl: null, text: '' };
  }

  const sourceMessage = history[sourceIndex];
  const text = history
    .slice(sourceIndex)
    .filter(message => message.role === 'user' || message.role === 'model')
    .map(message => `${message.role === 'user' ? 'Đề bài' : 'Gợi ý'}: ${message.parts?.map(part => part.text || '').join('\n')}`)
    .join('\n\n')
    .slice(0, 5000);

  return {
    imageUrl: sourceMessage.parts?.find(part => part.image?.url)?.image.url || null,
    text,
  };
};

const appendImagePart = async (messageParts, imageUrl, label) => {
  if (!imageUrl) return;

  try {
    const response = await fetch(imageUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch image: ${response.status} ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    messageParts.push({ text: label });
    messageParts.push({
      inlineData: {
        mimeType: response.headers.get('content-type') || 'image/jpeg',
        data: Buffer.from(arrayBuffer).toString('base64'),
      },
    });
  } catch (error) {
    console.error(`Error adding ${label.toLowerCase()}:`, error.message);
  }
};

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

    const problemContext = getProblemContext(history);
    const systemInstruction = buildSystemInstruction(language, educationLevel, subjectArea);
    const chat = startChat(geminiHistory, systemInstruction);
    const prompt = buildCheckAnswerPrompt(userAnswer, language, educationLevel, subjectArea, null, problemContext.text);

    console.log('Checking user answer with prompt:', prompt);

    // Prepare message parts for sending
    const messageParts = [{ text: prompt }];

    await appendImagePart(
      messageParts,
      problemContext.imageUrl,
      language === 'vi' ? 'Ảnh đề gốc:' : 'Original problem image:'
    );
    await appendImagePart(
      messageParts,
      imageUrl,
      language === 'vi' ? 'Ảnh bài làm của học sinh:' : 'Student answer image:'
    );

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
  getProblemContext,
};
