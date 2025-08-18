const Conversation = require('../models/conversation.model');
const chatService = require('../services/chat.service');

// Import language files
const enMessages = require('../locales/en.json');
const viMessages = require('../locales/vi.json');

const getMessages = (language = 'en') => {
    return language === 'vi' ? viMessages : enMessages;
};

// Helper function to check if a message is an internal prompt
const checkIfInternalPrompt = (message, language) => {
  if (language === 'vi') {
    const patterns = [
      /Bạn là một người thầy thân thiện và kiên nhẫn/,
      /Học sinh đang gặp khó khăn và cần thêm gợi ý/,
      /QUAN TRỌNG: Bạn KHÔNG BAO GIỜ được trả lời hết đáp án/,
      /QUY TẮC: Chỉ gợi ý/,
      /Student is having difficulty and needs more hints/
    ];
    
    return patterns.some(pattern => pattern.test(message));
  } else {
    const patterns = [
      /You are a friendly and patient teacher/,
      /The student is having difficulty and needs more hints/,
      /IMPORTANT: You must NEVER give complete answers/,
      /RULE: Only hint/,
      /Student is having difficulty and needs more hints/
    ];
    
    return patterns.some(pattern => pattern.test(message));
  }
};

// Utility function to remove duplicate messages
const removeDuplicateMessages = (history) => {
    const seen = new Set();
    return history.filter(msg => {
        const key = `${msg.role}-${msg.parts[0].text}`;
        if (seen.has(key)) {
            return false;
        }
        seen.add(key);
        return true;
    });
};

const handleChat = async (req, res) => {
  try {
    const { message, sessionId, language = 'en' } = req.body;
    
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
      conversation = new Conversation({ user: req.user._id, sessionId, history: [] });
    }

    // Only save user message if it's NOT an internal prompt
    if (!isInternalPrompt) {
      conversation.history.push({
        role: 'user',
        parts: [{ text: message }]
      });
    }

    // Get AI response using chatService directly
    const aiResponse = await chatService.sendMessage(conversation.history, message, language);
    
    // Save AI response
    conversation.history.push({
      role: 'model',
      parts: [{ text: aiResponse }]
    });

    await conversation.save();
    
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

const continueChat = async (req, res) => {
  try {
    const { sessionId, language = 'en' } = req.body;
    
    if (!sessionId) {
      return res.status(400).json({ error: "Session ID is required" });
    }

    const conversation = await Conversation.findOne({ user: req.user._id, sessionId });
    if (!conversation || conversation.history.length === 0) {
      return res.status(404).json({ error: "Conversation not found" });
    }

    // Check if the last message is already a continuation request (validation to prevent duplicate)
    const lastMessage = conversation.history[conversation.history.length - 1];
    if (lastMessage && lastMessage.role === 'user' &&
        (lastMessage.parts[0].text.includes("Tôi cần thêm gợi ý") ||
         lastMessage.parts[0].text.includes("I'm stuck, I need another hint."))) {
      return res.status(400).json({ error: "Continuation already requested" });
    }

    const modelResponse = await chatService.getContinuation(conversation.history, language);
    
    // Only save AI's response, user message will be added by frontend
    conversation.history.push({ role: 'model', parts: [{ text: modelResponse }] });
    await conversation.save();
    
    res.json({ message: modelResponse });
  } catch (error) {
    console.error('Error getting continuation:', error);
    res.status(500).json({ error: "Internal server error" });
  }
};

const getFullAnswer = async (req, res) => {
  try {
    const { sessionId, language = 'en' } = req.body;
    
    if (!sessionId) {
      return res.status(400).json({ error: "Session ID is required" });
    }

    const conversation = await Conversation.findOne({ user: req.user._id, sessionId });
    if (!conversation || conversation.history.length === 0) {
      return res.status(404).json({ error: "Conversation not found" });
    }

    // Check if the last message is already a full answer request (validation to prevent duplicate)
    const lastMessage = conversation.history[conversation.history.length - 1];
    if (lastMessage && lastMessage.role === 'user' &&
        (lastMessage.parts[0].text.includes("Hãy trả lời đầy đủ") ||
         lastMessage.parts[0].text.includes("Give me the full answer"))) {
      return res.status(400).json({ error: "Full answer already requested" });
    }

    const modelResponse = await chatService.getFullAnswer(conversation.history, language);
    
    // Only save AI's response, user message will be added by frontend
    conversation.history.push({ role: 'model', parts: [{ text: modelResponse }] });
    await conversation.save();
    
    res.json({ message: modelResponse });
  } catch (error) {
    console.error('Error getting full answer:', error);
    res.status(500).json({ error: "Internal server error" });
  }
};

const checkUserAnswer = async (req, res) => {
  try {
    const { sessionId, userAnswer, language = 'en' } = req.body;
    
    if (!sessionId || !userAnswer) {
      return res.status(400).json({ error: "Session ID and user answer are required" });
    }

    const conversation = await Conversation.findOne({ user: req.user._id, sessionId });
    if (!conversation) {
      return res.status(404).json({ error: "Conversation not found" });
    }

    // Check if the last message is already a check answer request (validation to prevent duplicate)
    const lastMessage = conversation.history[conversation.history.length - 1];
    if (lastMessage && lastMessage.role === 'user' &&
        (lastMessage.parts[0].text.includes("Câu trả lời của tôi:") ||
         lastMessage.parts[0].text.includes("My answer:"))) {
      return res.status(400).json({ error: "Answer already checked" });
    }

    const modelResponse = await chatService.checkUserAnswer(conversation.history, userAnswer, language);
    
    // Only save AI's response, user message will be added by frontend
    conversation.history.push({ role: 'model', parts: [{ text: modelResponse }] });
    await conversation.save();
    
    res.json({ message: modelResponse });
  } catch (error) {
    console.error('Error checking user answer:', error);
    res.status(500).json({ error: "Internal server error" });
  }
};

const getConversations = async (req, res) => {
    try {
        const conversations = await Conversation.find({ user: req.user._id }, 'sessionId createdAt updatedAt')
            .sort({ updatedAt: -1 })
            .limit(50);
        
        res.json({ conversations });
    } catch (error) {
        console.error('Get conversations error:', error);
        res.status(500).json({ error: 'Something went wrong' });
    }
};

const getConversationHistory = async (req, res) => {
    try {
        const { sessionId } = req.params;
        
        const conversation = await Conversation.findOne({ user: req.user._id, sessionId });
        
        if (!conversation) {
            return res.status(404).json({ error: 'Conversation not found' });
        }
        
        res.json({ 
            sessionId: conversation.sessionId,
            history: conversation.history,
            createdAt: conversation.createdAt,
            updatedAt: conversation.updatedAt
        });
    } catch (error) {
        console.error('Get conversation history error:', error);
        res.status(500).json({ error: 'Something went wrong' });
    }
};

const deleteConversation = async (req, res) => {
    try {
        const { sessionId } = req.params;
        const { language = 'en' } = req.query;
        
        const result = await Conversation.deleteOne({ user: req.user._id, sessionId });
        
        if (result.deletedCount === 0) {
            const messages = getMessages(language);
            return res.status(404).json({ error: messages.messages.errors.conversationNotFoundGeneral });
        }
        
        const messages = getMessages(language);
        res.json({ message: messages.messages.success.conversationDeleted });
    } catch (error) {
        console.error('Delete conversation error:', error);
        const messages = getMessages(req.query.language || 'en');
        res.status(500).json({ error: messages.messages.errors.somethingWentWrong });
    }
};

const cleanupDuplicateMessages = async (req, res) => {
    try {
        const { sessionId } = req.params;
        
        const conversation = await Conversation.findOne({ user: req.user._id, sessionId });
        if (!conversation) {
            return res.status(404).json({ error: 'Conversation not found' });
        }
        
        // Remove duplicate messages
        const originalLength = conversation.history.length;
        conversation.history = removeDuplicateMessages(conversation.history);
        const newLength = conversation.history.length;
        
        if (originalLength !== newLength) {
            await conversation.save();
            res.json({ 
                message: `Cleaned up ${originalLength - newLength} duplicate messages`,
                originalCount: originalLength,
                newCount: newLength
            });
        } else {
            res.json({ message: 'No duplicate messages found' });
        }
    } catch (error) {
        console.error('Cleanup error:', error);
        res.status(500).json({ error: 'Something went wrong during cleanup' });
    }
};

module.exports = {
    handleChat,
    continueChat,
    getFullAnswer,
    checkUserAnswer,
    getConversations,
    getConversationHistory,
    deleteConversation,
    cleanupDuplicateMessages,
}; 