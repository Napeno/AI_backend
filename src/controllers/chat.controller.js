const Conversation = require('../models/conversation.model');
const chatService = require('../services/chat.service');

const handleChat = async (req, res) => {
    try {
        const { message, sessionId } = req.body;

        if (!sessionId) {
            return res.status(400).json({ error: 'sessionId is required' });
        }

        let conversation = await Conversation.findOne({ sessionId });

        if (!conversation) {
            conversation = new Conversation({ sessionId, history: [] });
        }

        const chat = chatService.startChat(conversation.history);
        const modelResponse = await chatService.sendMessage(chat, message);

        conversation.history.push({ role: 'user', parts: [{ text: message }] });
        conversation.history.push({ role: 'model', parts: [{ text: modelResponse }] });

        await conversation.save();

        res.json({ message: modelResponse });
    } catch (error) {
        console.error('Chat error:', error);
        res.status(500).json({ error: 'Something went wrong' });
    }
};

const continueChat = async (req, res) => {
    try {
        const { sessionId } = req.body;

        if (!sessionId) {
            return res.status(400).json({ error: 'sessionId is required' });
        }

        const conversation = await Conversation.findOne({ sessionId });

        if (!conversation || conversation.history.length === 0) {
            return res.status(404).json({ error: 'No conversation found for this session or conversation is empty.' });
        }
        
        const modelResponse = await chatService.getContinuation(conversation.history);

        // We add a system message to indicate this is a continuation, then the model's hint.
        conversation.history.push({ role: 'user', parts: [{ text: "I'm stuck, I need another hint." }] });
        conversation.history.push({ role: 'model', parts: [{ text: modelResponse }] });

        await conversation.save();

        res.json({ message: modelResponse });
    } catch (error) {
        console.error('Continuation error:', error);
        res.status(500).json({ error: 'Something went wrong' });
    }
};

module.exports = {
    handleChat,
    continueChat,
}; 