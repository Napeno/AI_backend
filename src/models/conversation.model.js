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
            required: false, // Not required when image is present
        },
        image: {
            url: {
                type: String,
                required: false,
            },
            public_id: {
                type: String,
                required: false,
            },
            width: {
                type: Number,
                required: false,
            },
            height: {
                type: Number,
                required: false,
            },
            format: {
                type: String,
                required: false,
            },
            bytes: {
                type: Number,
                required: false,
            }
        }
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

const activeGateSchema = new mongoose.Schema({
    active: {
        type: Boolean,
        default: false,
    },
    type: {
        type: String,
        required: false,
    },
    requiredAction: {
        type: String,
        required: false,
    },
    level: {
        type: String,
        enum: ['green', 'yellow', 'red'],
        default: 'green',
    },
    hintTier: {
        type: Number,
        default: 1,
    },
    createdAt: {
        type: Date,
        required: false,
    },
    miniQuiz: {
        question: {
            type: String,
            required: false,
        },
        options: [{
            id: {
                type: String,
                required: false,
            },
            text: {
                type: String,
                required: false,
            },
        }],
        correctOptionId: {
            type: String,
            required: false,
        },
        explanation: {
            type: String,
            required: false,
        },
    },
}, { _id: false });

const interventionMetricsSchema = new mongoose.Schema({
    hintRequests: {
        type: Number,
        default: 0,
    },
    lastHintAt: {
        type: Date,
        required: false,
    },
    rapidHintRequests: {
        type: Number,
        default: 0,
    },
    answerAttempts: {
        type: Number,
        default: 0,
    },
    answerChecks: {
        type: Number,
        default: 0,
    },
    correctAnswers: {
        type: Number,
        default: 0,
    },
    incorrectAnswers: {
        type: Number,
        default: 0,
    },
    fullAnswerRequests: {
        type: Number,
        default: 0,
    },
    gateCompletions: {
        type: Number,
        default: 0,
    },
    hasAttemptedAnswer: {
        type: Boolean,
        default: false,
    },
    hasCheckedAnswer: {
        type: Boolean,
        default: false,
    },
    hasRevisedAfterFeedback: {
        type: Boolean,
        default: false,
    },
    identifiedBlocker: {
        type: Boolean,
        default: false,
    },
    lastBlocker: {
        type: String,
        required: false,
    },
    lastRiskScore: {
        type: Number,
        default: 0,
    },
    lastRiskLevel: {
        type: String,
        enum: ['green', 'yellow', 'red'],
        default: 'green',
    },
    lastInterventionType: {
        type: String,
        required: false,
    },
    activeGate: {
        type: activeGateSchema,
        default: () => ({ active: false }),
    },
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
    educationLevel: {
        type: String,
        enum: ['elementary', 'middle', 'high'],
        default: 'middle',
    },
    subjectArea: {
        type: String,
        enum: ['natural_sciences', 'social_sciences', 'mathematics', 'english_language'],
        default: 'natural_sciences',
    },
    course: {
        type: String,
        enum: ['mathematics', 'natural_sciences', 'history', 'geography', 'civics', 'literature', 'foreign_language', 'english_language'],
        required: false,
    },
    interventionMetrics: {
        type: interventionMetricsSchema,
        default: () => ({}),
    },
    history: [messageSchema],
}, { timestamps: true });

conversationSchema.index({ user: 1, sessionId: 1 }, { unique: true });

const Conversation = mongoose.model('Conversation', conversationSchema);

module.exports = Conversation; 
