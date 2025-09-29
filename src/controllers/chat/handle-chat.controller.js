const Conversation = require('../../models/conversation.model');
const chatService = require('../../services/chat.service');
const { getMessages, checkIfInternalPrompt } = require('./utils');

const handleChat = async (req, res) => {
  try {
    const { message, sessionId, language = 'en', educationLevel, subjectArea, course } = req.body;
    console.log('handleChat called with:', { message: message?.substring(0, 50), sessionId, language, educationLevel, subjectArea });
    
    if (!message || !sessionId) {
      return res.status(400).json({ 
        message: getMessages(language).missingParams 
      });
    }

    // Check if message is an internal prompt (should not be saved)
    const isInternalPrompt = checkIfInternalPrompt(message, language);
    if (isInternalPrompt) {
      console.log('Internal prompt detected, not saving to database:', message.substring(0, 100));
      // Still process the message but don't save the prompt
    }

    let conversation = await Conversation.findOne({ user: req.user._id, sessionId });
    
    if (!conversation) {
      conversation = new Conversation({ 
        user: req.user._id, 
        sessionId, 
        history: [],
        educationLevel: educationLevel || 'middle',
        subjectArea: subjectArea || course || 'natural_sciences',
        course: course || subjectArea || undefined
      });
      console.log('Created new conversation for user:', req.user._id, 'sessionId:', sessionId);
    } else {
      console.log('Found existing conversation with', conversation.history.length, 'messages');
      if (educationLevel && educationLevel !== conversation.educationLevel) {
        conversation.educationLevel = educationLevel;
      }
      if (subjectArea && subjectArea !== conversation.subjectArea) {
        conversation.subjectArea = subjectArea;
      }
      if (course && course !== conversation.course) {
        conversation.course = course;
      }
    }

    // Only save user message if it's NOT an internal prompt
    if (!isInternalPrompt) {
      conversation.history.push({
        role: 'user',
        parts: [{ text: message }]
      });
      console.log('Added user message to history');
    }

    // Get AI response using chatService directly
    const aiResponse = await chatService.sendMessage(
      conversation.history, 
      message, 
      language,
      conversation.educationLevel,
      conversation.subjectArea,
      conversation.course
    );
    console.log('Got AI response:', aiResponse?.substring(0, 100));
    
    // Save AI response
    conversation.history.push({
      role: 'model',
      parts: [{ text: aiResponse }]
    });

    await conversation.save();
    console.log('Saved conversation with', conversation.history.length, 'total messages');
    
    res.json({ message: aiResponse });
  } catch (error) {
    console.error('Error in chat service:', error);
    
    // Get language from request body for error messages
    const requestLanguage = req.body.language || 'en';
    
    if (error.message.includes('429')) {
      return res.status(429).json({ 
        message: getMessages(requestLanguage).quotaExceeded 
      });
    }
    
    res.status(500).json({ 
      message: getMessages(requestLanguage).serverError 
    });
  }
};

module.exports = { handleChat }; 
