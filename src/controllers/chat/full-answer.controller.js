const Conversation = require('../../models/conversation.model');
const chatService = require('../../services/chat.service');

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

    // Add full-answer action to conversation history
    conversation.history.push({ 
      role: 'full-answer',
      parts: [{ text: 'Đang yêu cầu đáp án đầy đủ...' }],
      timestamp: new Date()
    });

    const modelResponse = await chatService.getFullAnswer(
      conversation.history,
      language,
      conversation.educationLevel,
      conversation.subjectArea,
      conversation.course
    );
    
    console.log(JSON.stringify({
      event: 'full_answer_response',
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
      event: 'full_answer_error',
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

module.exports = { getFullAnswer }; 
