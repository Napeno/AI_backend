const Conversation = require('../../models/conversation.model');
const chatService = require('../../services/chat.service');

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

    // Add continue action to conversation history
    conversation.history.push({ 
      role: 'continue',
      parts: [{ text: 'Đang yêu cầu thêm gợi ý...' }],
      timestamp: new Date()
    });

    const modelResponse = await chatService.getContinuation(
      conversation.history, 
      language,
      conversation.educationLevel,
      conversation.subjectArea
    );

    console.log(JSON.stringify({
      event: 'continue_chat_response',
      timestamp: new Date().toISOString(),
      data: {
        userId: req.user._id,
        sessionId,
        responseLength: modelResponse?.length,
        historyLength: conversation.history.length
      }
    }));
    
    // Save AI's response to conversation
    conversation.history.push({ 
      role: 'model', 
      parts: [{ text: modelResponse }],
      timestamp: new Date()
    });
    
    await conversation.save();
    
    res.json({ message: modelResponse });
  } catch (error) {
    console.log(JSON.stringify({
      event: 'continue_chat_error',
      timestamp: new Date().toISOString(),
      error: {
        message: error.message,
        userId: req.user?._id,
        sessionId: req.body?.sessionId
      }
    }));
    res.status(500).json({ error: "Internal server error" });
  }
};

module.exports = { continueChat }; 