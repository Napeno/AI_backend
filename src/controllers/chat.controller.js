// Main chat controller that aggregates all chat-related controllers
const { handleChat } = require('./chat/handle-chat.controller');
const { continueChat } = require('./chat/continue-chat.controller');
const { getFullAnswer } = require('./chat/full-answer.controller');
const { checkUserAnswer, checkUserAnswerWithImage } = require('./chat/check-answer.controller');
const { 
    getConversations, 
    getConversationHistory, 
    getCurrentIntervention,
    updateProblemContext,
    deleteConversation, 
    cleanupDuplicateMessages,
    cleanupAllConversations,
    updateConversationSettings,
} = require('./chat/conversation-management.controller');
const { getConfig } = require('./chat/config.controller');

module.exports = {
    handleChat,
    continueChat,
    getFullAnswer,
    checkUserAnswer,
    checkUserAnswerWithImage,
    getConversations,
    getConversationHistory,
    getCurrentIntervention,
    updateProblemContext,
    deleteConversation,
    cleanupDuplicateMessages,
    cleanupAllConversations,
    updateConversationSettings,
    getConfig,
}; 
