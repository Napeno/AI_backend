const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
    role: {
        type: String,
        enum: ['user', 'model', 'continue', 'full-answer', 'check-answer'],
        required: true,
    },
    parts: [{
        text: {
            type: String,
            required: true,
        },
    }],
    timestamp: {
        type: Date,
        default: Date.now
    },
    userAnswer: {
        type: String,
        required: false  // Only used for check-answer messages
    },
    isCorrect: {
        type: Boolean,
        required: false // Used for bot responses to check-answer
    }
}, { _id: false });

const conversationSchema = new mongoose.Schema({
    sessionId: {
        type: String,
        required: true,
    },
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
    },
    history: [messageSchema],
}, { timestamps: true });

conversationSchema.index({ user: 1, sessionId: 1 }, { unique: true });

const Conversation = mongoose.model('Conversation', conversationSchema);

module.exports = Conversation; 