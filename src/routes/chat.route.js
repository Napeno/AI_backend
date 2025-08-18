const express = require('express');
const router = express.Router();
const chatController = require('../controllers/chat.controller');

router.post('/', chatController.handleChat);
router.post('/continue', chatController.continueChat);
router.post('/full-answer', chatController.getFullAnswer);
router.post('/check-answer', chatController.checkUserAnswer);
router.get('/conversations', chatController.getConversations);
router.get('/conversations/:sessionId', chatController.getConversationHistory);
router.delete('/conversations/:sessionId', chatController.deleteConversation);
router.post('/conversations/:sessionId/cleanup', chatController.cleanupDuplicateMessages);

module.exports = router; 