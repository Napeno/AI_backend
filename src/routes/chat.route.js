const express = require('express');
const router = express.Router();
const chatController = require('../controllers/chat.controller');
const { handleImageChat } = require('../controllers/chat/image-chat.controller');
const upload = require('../middleware/upload');

router.post('/', chatController.handleChat);
router.post('/image', upload.single('image'), handleImageChat);
router.post('/continue', chatController.continueChat);
router.post('/full-answer', chatController.getFullAnswer);
router.post('/check-answer', chatController.checkUserAnswer);
router.get('/conversations', chatController.getConversations);
router.get('/conversations/:sessionId', chatController.getConversationHistory);
router.put('/conversations/:sessionId/settings', chatController.updateConversationSettings);
router.delete('/conversations/:sessionId', chatController.deleteConversation);
router.post('/conversations/:sessionId/cleanup', chatController.cleanupDuplicateMessages);
router.post('/cleanup-all', chatController.cleanupAllConversations);

module.exports = router; 