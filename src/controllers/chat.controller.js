// Main chat controller that aggregates all chat-related controllers
const { handleChat } = require('./chat/handle-chat.controller');
const { continueChat } = require('./chat/continue-chat.controller');
const { getFullAnswer } = require('./chat/full-answer.controller');
const { checkUserAnswer } = require('./chat/check-answer.controller');
const { 
    getConversations, 
    getConversationHistory, 
    deleteConversation, 
    cleanupDuplicateMessages,
    cleanupAllConversations 
} = require('./chat/conversation-management.controller');

module.exports = {
    handleChat,
    continueChat,
    getFullAnswer,
    checkUserAnswer,
    getConversations,
    getConversationHistory,
    deleteConversation,
    cleanupDuplicateMessages,
    cleanupAllConversations,
}; 