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

module.exports = { checkUserAnswer }; 