const Conversation = require('../../models/conversation.model');
const AiTutorLesson = require('../../models/ai-tutor-question.model');
const InterventionService = require('../../services/intervention.service');
const InterventionQuizService = require('../../services/intervention-quiz.service');
const { getMessages } = require('./utils');
const { ensureProblemContext, setActiveQuestion, toPublicProblemContext } = require('../../services/problem-context.service');

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
        !msg.parts[0].text.includes('You are a friendly friend')
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
          !msg.parts[0].text.includes('You are a friendly friend')
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

    if (conversation.problemContext?.questions?.length) {
      await ensureProblemContext(conversation, req.body?.language || 'en');
      await conversation.save();
    }

    // Filter out system prompts and invalid messages
    const cleanHistory = conversation.history.filter(msg => {
      // Keep user messages, model responses, continue actions, full-answer actions, and check-answer actions
      if (msg.role === 'user') {
        return !msg.parts[0].text.includes('Bạn là một người thầy') &&
               !msg.parts[0].text.includes('You are a friendly friend') &&
               !msg.parts[0].text.includes('QUAN TRỌNG: Bạn KHÔNG BAO GIỜ');
      }
      return msg.role === 'model' || msg.role === 'continue' || msg.role === 'full-answer' || msg.role === 'check-answer';
    });

    res.json({
      history: cleanHistory,
      educationLevel: conversation.educationLevel,
      subjectArea: conversation.subjectArea,
      course: conversation.course,
      problemContext: toPublicProblemContext(conversation.problemContext),
      intervention: InterventionService.buildInactiveIntervention(conversation, req.body?.language || 'en')
    });
  } catch (error) {
    console.error('Error fetching conversation history:', error);
    res.status(500).json({ message: getMessages(req.body.language || 'en').serverError });
  }
};

const updateProblemContext = async (req, res) => {
  try {
    const { sessionId, questionId } = req.body;
    if (!sessionId || !questionId) return res.status(400).json({ message: 'sessionId and questionId are required' });
    const conversation = await Conversation.findOne({ user: req.user._id, sessionId });
    if (!conversation) return res.status(404).json({ message: 'Conversation not found' });
    const problemContext = setActiveQuestion(conversation, String(questionId).toLowerCase());
    if (!problemContext) return res.status(400).json({ message: 'Question is not in the current problem context' });
    await conversation.save();
    return res.json({ problemContext });
  } catch (error) {
    console.error('Error updating problem context:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
};

const getCurrentIntervention = async (req, res) => {
  try {
    const { sessionId, language = 'en' } = req.body;

    if (!sessionId) {
      return res.status(400).json({ message: 'sessionId is required' });
    }

    const conversation = await Conversation.findOne({
      user: req.user._id,
      sessionId
    });

    if (!conversation) {
      return res.status(404).json({ message: 'Conversation not found' });
    }

    const activeGate = conversation.interventionMetrics?.activeGate;
    if (!activeGate?.active) {
      return res.json({
        intervention: InterventionService.buildInactiveIntervention(conversation, language)
      });
    }

    const miniQuiz = activeGate.active
      ? await InterventionQuizService.ensureMiniQuizForGate(conversation, language, { refresh: true })
      : null;
    if (miniQuiz) {
      await conversation.save();
    }

    const gatePayload = InterventionService.buildActiveGateResponse(conversation, language);
    if (miniQuiz) {
      gatePayload.intervention.miniQuiz = miniQuiz;
    }

    return res.json({
      message: gatePayload.message,
      intervention: gatePayload.intervention
    });
  } catch (error) {
    console.error('Error fetching current intervention:', error);
    return res.status(500).json({ message: getMessages(req.body.language || 'en').serverError });
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

    await AiTutorLesson.deleteMany({ user: req.user._id, sessionId });
    
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
        message.parts[0].text.includes('You are a friendly friend') ||
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
          message.parts[0].text.includes('You are a friendly friend') ||
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
    getCurrentIntervention,
  updateProblemContext,
  deleteConversation,
  cleanupDuplicateMessages,
  cleanupAllConversations,
  updateConversationSettings,
}; 
