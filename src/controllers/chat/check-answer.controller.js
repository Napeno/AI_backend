const Conversation = require('../../models/conversation.model');
const chatService = require('../../services/chat.service');

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

    // Add check-answer action to conversation history
    conversation.history.push({ 
      role: 'check-answer',
      parts: [{ text: `🔍 Đang kiểm tra câu trả lời: "${userAnswer}"` }],
      timestamp: new Date(),
      userAnswer: userAnswer  // Store the actual user answer for reference
    });

    const modelResponse = await chatService.checkUserAnswer(conversation.history, userAnswer, language);
    
    console.log(JSON.stringify({
      event: 'check_answer_response',
      timestamp: new Date().toISOString(),
      data: {
        userId: req.user._id,
        sessionId,
        userAnswer: userAnswer.substring(0, 100),
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
      event: 'check_answer_error',
      timestamp: new Date().toISOString(),
      error: {
        message: error.message,
        userId: req.user?._id,
        sessionId: req.body?.sessionId,
        userAnswer: req.body?.userAnswer?.substring(0, 50)
      }
    }));
    res.status(500).json({ error: "Internal server error" });
  }
};

module.exports = { checkUserAnswer }; 