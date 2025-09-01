// Main chat service that aggregates all chat-related services
const { startChat } = require('./gemini.service');
const { sendMessage } = require('./chat-message.service');
const { getContinuation } = require('./chat-continuation.service');
const { getFullAnswer } = require('./chat-answer.service');
const { checkUserAnswer } = require('./chat-check.service');

module.exports = {
    startChat,
    sendMessage,
    getContinuation,
    getFullAnswer,
    checkUserAnswer,
}; 