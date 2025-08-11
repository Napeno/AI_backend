const express = require('express');
const router = express.Router();
const chatController = require('../controllers/chat.controller');

router.post('/', chatController.handleChat);
router.post('/continue', chatController.continueChat);

module.exports = router; 