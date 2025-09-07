const Conversation = require('../../models/conversation.model');
const { getMessages } = require('./utils');

const getConversations = async (req, res) => {
  try {
    const conversations = await Conversation.find({ user: req.user._id })
      .sort({ updatedAt: -1 })
      .select('sessionId updatedAt history')
      .lean();

    const conversationList = conversations.map(conv => {
      const firstUserMessage = conv.history.find(msg => 
        msg.role === 'user' && 
        !msg.parts[0].text.includes('Bạn là một người thầy') &&
        !msg.parts[0].text.includes('You are a friendly teacher')
      );
      
      return {
        sessionId: conv.sessionId,
        title: firstUserMessage 
          ? firstUserMessage.parts[0].text.substring(0, 50) + (firstUserMessage.parts[0].text.length > 50 ? '...' : '')
          : 'New Chat',
        lastUpdate: conv.updatedAt,
        messageCount: conv.history.filter(msg => 
          msg.role === 'user' && 
          !msg.parts[0].text.includes('Bạn là một người thầy') &&
          !msg.parts[0].text.includes('You are a friendly teacher')
        ).length
      };
    });

    res.json(conversationList);
  } catch (error) {
    console.error('Error fetching conversations:', error);
    res.status(500).json({ message: getMessages(req.body.language || 'en').serverError });
  }
};

const getConversationHistory = async (req, res) => {
  try {
    const { sessionId } = req.params;
    
    const conversation = await Conversation.findOne({ 
      user: req.user._id, 
      sessionId 
    });
    
    if (!conversation) {
      return res.status(404).json({ message: 'Conversation not found' });
    }

    // Filter out system prompts and invalid messages
    const cleanHistory = conversation.history.filter(msg => {
      // Keep user messages, model responses, continue actions, full-answer actions, and check-answer actions
      if (msg.role === 'user') {
        return !msg.parts[0].text.includes('Bạn là một người thầy') &&
               !msg.parts[0].text.includes('You are a friendly teacher') &&
               !msg.parts[0].text.includes('QUAN TRỌNG: Bạn KHÔNG BAO GIỜ');
      }
      return msg.role === 'model' || msg.role === 'continue' || msg.role === 'full-answer' || msg.role === 'check-answer';
    });

    res.json({ history: cleanHistory });
  } catch (error) {
    console.error('Error fetching conversation history:', error);
    res.status(500).json({ message: getMessages(req.body.language || 'en').serverError });
  }
};

const deleteConversation = async (req, res) => {
  try {
    const { sessionId } = req.params;
    
    const result = await Conversation.deleteOne({ 
      user: req.user._id, 
      sessionId 
    });
    
    if (result.deletedCount === 0) {
      return res.status(404).json({ message: 'Conversation not found' });
    }
    
    res.json({ message: 'Conversation deleted successfully' });
  } catch (error) {
    console.error('Error deleting conversation:', error);
    res.status(500).json({ message: getMessages(req.body.language || 'en').serverError });
  }
};

const cleanupDuplicateMessages = async (req, res) => {
  try {
    const { sessionId } = req.params;
    
    const conversation = await Conversation.findOne({ 
      user: req.user._id, 
      sessionId 
    });
    
    if (!conversation) {
      return res.status(404).json({ message: 'Conversation not found' });
    }

    // Remove duplicate consecutive messages and system prompts
    const cleanedHistory = [];
    let lastMessage = null;
    
    for (const message of conversation.history) {
      // Skip system prompts
      if (message.role === 'user' && (
        message.parts[0].text.includes('Bạn là một người thầy') ||
        message.parts[0].text.includes('You are a friendly teacher') ||
        message.parts[0].text.includes('QUAN TRỌNG: Bạn KHÔNG BAO GIỜ')
      )) {
        continue;
      }
      
      // Skip exact duplicates
      if (lastMessage && 
          lastMessage.role === message.role && 
          lastMessage.parts[0].text === message.parts[0].text) {
        continue;
      }
      
      cleanedHistory.push(message);
      lastMessage = message;
    }

    conversation.history = cleanedHistory;
    await conversation.save();
    
    res.json({ 
      message: 'Duplicate messages cleaned up successfully',
      originalCount: conversation.history.length,
      cleanedCount: cleanedHistory.length,
      history: cleanedHistory
    });
  } catch (error) {
    console.error('Error cleaning up duplicate messages:', error);
    res.status(500).json({ message: getMessages(req.body.language || 'en').serverError });
  }
};

// New function to clean all conversations
const cleanupAllConversations = async (req, res) => {
  try {
    const conversations = await Conversation.find({ user: req.user._id });
    let totalCleaned = 0;
    let totalOriginal = 0;
    
    for (const conversation of conversations) {
      const originalCount = conversation.history.length;
      totalOriginal += originalCount;
      
      // Remove duplicate consecutive messages and system prompts
      const cleanedHistory = [];
      let lastMessage = null;
      
      for (const message of conversation.history) {
        // Skip system prompts
        if (message.role === 'user' && (
          message.parts[0].text.includes('Bạn là một người thầy') ||
          message.parts[0].text.includes('You are a friendly teacher') ||
          message.parts[0].text.includes('QUAN TRỌNG: Bạn KHÔNG BAO GIỜ')
        )) {
          continue;
        }
        
        // Skip exact duplicates
        if (lastMessage && 
            lastMessage.role === message.role && 
            lastMessage.parts[0].text === message.parts[0].text) {
          continue;
        }
        
        cleanedHistory.push(message);
        lastMessage = message;
      }

      console.log('Cleaned history length:', cleanedHistory);

      conversation.history = cleanedHistory;
      await conversation.save();
      totalCleaned += cleanedHistory.length;
    }
    
    res.json({ 
      message: 'All conversations cleaned up successfully',
      conversationsProcessed: conversations.length,
      totalOriginalMessages: totalOriginal,
      totalCleanedMessages: totalCleaned,
      messagesRemoved: totalOriginal - totalCleaned
    });
  } catch (error) {
    console.error('Error cleaning up all conversations:', error);
    res.status(500).json({ message: getMessages(req.body.language || 'en').serverError });
  }
};

const updateConversationSettings = async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { educationLevel, subjectArea } = req.body;

    const conversation = await Conversation.findOne({ user: req.user._id, sessionId });

    if (!conversation) {
      return res.status(404).json({ message: 'Conversation not found' });
    }

    if (educationLevel) {
      conversation.educationLevel = educationLevel;
    }
    if (subjectArea) {
      conversation.subjectArea = subjectArea;
    }

    await conversation.save();

    res.json({ message: 'Settings updated successfully', conversation });
  } catch (error) {
    console.error('Error updating conversation settings:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
};

module.exports = {
  getConversations,
  getConversationHistory,
  deleteConversation,
  cleanupDuplicateMessages,
  cleanupAllConversations,
  updateConversationSettings,
}; 