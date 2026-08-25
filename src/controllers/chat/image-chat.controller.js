const Conversation = require('../../models/conversation.model');
const chatService = require('../../services/chat.service');
const ImageUploadService = require('../../services/image-upload.service');
const InterventionService = require('../../services/intervention.service');
const { setImageProblemContext, toPublicProblemContext } = require('../../services/problem-context.service');
const { getMessages, checkIfInternalPrompt } = require('./utils');

const shouldUpdateProblemContext = (imagePurpose) => imagePurpose !== 'student_work';

const handleImageChat = async (req, res) => {
  try {
    const { message, sessionId, language = 'en', educationLevel, subjectArea, course, imagePurpose } = req.body;
    const imageFile = req.file;
    
    console.log('handleImageChat called with:', { 
      message: message?.substring(0, 50), 
      sessionId, 
      language, 
      educationLevel, 
      subjectArea,
      hasImage: !!imageFile 
    });
    
    if (!sessionId) {
      return res.status(400).json({ 
        message: getMessages(language).missingParams 
      });
    }

    // If no message is provided and image exists, set a purpose-aware default.
    let finalMessage = message;
    if (!message && imageFile) {
      finalMessage = imagePurpose === 'student_work'
        ? (language === 'vi' ? 'Đây là bước làm của em, hãy giúp em kiểm tra lỗi.' : 'This is my working step. Please help me check for mistakes.')
        : (language === 'vi' ? 'Trả lời đáp án bên trong hình ảnh' : 'Answer the question shown in the image');
    }

    if (!finalMessage && !imageFile) {
      return res.status(400).json({ 
        message: getMessages(language).missingParams 
      });
    }

    let conversation = await Conversation.findOne({ user: req.user._id, sessionId });
    
    if (!conversation) {
      conversation = new Conversation({ 
        user: req.user._id, 
        sessionId, 
        history: [],
        educationLevel: educationLevel || 'middle',
        subjectArea: subjectArea || 'natural_sciences',
        course: course || 'mathematics'
      });
      console.log('Created new conversation for user:', req.user._id, 'sessionId:', sessionId);
    } else {
      console.log('Found existing conversation with', conversation.history.length, 'messages');
      if (course && !conversation.course) conversation.course = course;
    }

    let imageData = null;
    if (imageFile) {
      try {
        console.log('Uploading image to Cloudinary...');
        imageData = await ImageUploadService.uploadImage(imageFile.buffer, imageFile.originalname);
        console.log('Image uploaded successfully:', imageData.url);
      } catch (error) {
        console.error('Error uploading image:', error);
        return res.status(500).json({ 
          message: getMessages(language).imageUploadError || 'Error uploading image'
        });
      }
    }

    // Check if message is an internal prompt (should not be saved)
    const isInternalPrompt = checkIfInternalPrompt(finalMessage, language);
    if (isInternalPrompt) {
      console.log('Internal prompt detected, not saving to database:', finalMessage.substring(0, 100));
    }

    // Only save user message if it's NOT an internal prompt
    if (!isInternalPrompt) {
      const userMessage = {
        role: 'user',
        parts: [{
          text: finalMessage
        }]
      };

      // Add image data if available
      if (imageData) {
        userMessage.parts[0].image = {
          url: imageData.url,
          public_id: imageData.public_id,
          width: imageData.width,
          height: imageData.height,
          format: imageData.format,
          bytes: imageData.bytes
        };
      }

      conversation.history.push(userMessage);
      if (imageData && shouldUpdateProblemContext(imagePurpose)) {
        await setImageProblemContext(conversation, { sourceText: finalMessage, image: imageData, language });
      }
      console.log('Added user message with image to history');
    }

    // Get AI response using chatService
    const aiResponse = await chatService.sendMessage(
      conversation.history, 
      finalMessage, 
      language,
      conversation.educationLevel,
      conversation.subjectArea,
      imageFile ? { buffer: imageFile.buffer, mimetype: imageFile.mimetype } : null
    );
    console.log('Got AI response:', aiResponse?.substring(0, 100));
    
    // Save AI response
    conversation.history.push({
      role: 'model',
      parts: [{ text: aiResponse }]
    });

    await conversation.save();
    console.log('Saved conversation with', conversation.history.length, 'total messages');
    
    res.json({ 
      message: aiResponse,
      intervention: InterventionService.buildInactiveIntervention(conversation, language),
      imageUrl: imageData ? imageData.url : null,
      problemContext: toPublicProblemContext(conversation.problemContext)
    });
  } catch (error) {
    console.error(JSON.stringify({
      event: 'image_chat_error',
      stage: error.stage || 'send_message',
      status: error.status || error.statusCode || null,
      message: error.message,
    }));
    
    // Get language from request body for error messages
    const requestLanguage = req.body.language || 'en';
    
    if (error.message.includes('429')) {
      return res.status(429).json({ 
        message: getMessages(requestLanguage).quotaExceeded 
      });
    }
    
    res.status(500).json({
      message: requestLanguage === 'vi'
        ? 'Không thể xử lý ảnh này. Vui lòng thử lại với ảnh rõ hơn hoặc gửi câu hỏi bằng chữ.'
        : 'We could not process this image. Please try a clearer image or send the question as text.',
      errorCode: error.stage || 'image_processing_failed'
    });
  }
};

module.exports = { handleImageChat, shouldUpdateProblemContext };
