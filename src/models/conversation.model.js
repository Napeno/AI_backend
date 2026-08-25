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
    },
    evaluationStatus: {
        type: String,
        enum: ['correct', 'incorrect', 'uncertain'],
        required: false,
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
        enum: ['green', 'yellow', 'red', 'low', 'watch', 'high'],
        default: 'low',
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

const problemQuestionSchema = new mongoose.Schema({
    id: { type: String, required: true },
    prompt: { type: String, required: true },
    sourceExpression: { type: String, required: false },
}, { _id: false });

const problemContextSchema = new mongoose.Schema({
    sourceText: { type: String, default: '' },
    sourceImage: {
        url: { type: String, required: false },
        public_id: { type: String, required: false },
    },
    questions: { type: [problemQuestionSchema], default: [] },
    suggestedQuestionId: { type: String, required: false },
    activeQuestionId: { type: String, required: false },
    extractedAt: { type: Date, required: false },
}, { _id: false });

const interventionMetricsSchema = new mongoose.Schema({
    rulesetVersion: { type: String, default: 'v2' },
    riskScore: { type: Number, default: 0 },
    riskLevel: { type: String, enum: ['low', 'watch', 'high'], default: 'low' },
    hintRequests: {
        type: Number,
        default: 0,
    },
    lastHintAt: {
        type: Date,
        required: false,
    },
    lastHelpAt: { type: Date, required: false },
    hasWorkSinceFourthHint: { type: Boolean, default: false },
    hasMeaningfulWorkSinceLastHint: { type: Boolean, default: false },
    hintWithoutWorkCount: { type: Number, default: 0 },
    selfAttemptStreak: { type: Number, default: 0 },
    bestSelfAttemptStreak: { type: Number, default: 0 },
    lastEventRiskScore: { type: Number, default: 0 },
    rapidHintRequests: {
        type: Number,
        default: 0,
    },
    answerAttempts: {
      type: Number,
      default: 0,
    },
    meaningfulAttempts: {
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
    hasMeaningfulAttempt: {
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
        enum: ['green', 'yellow', 'red', 'low', 'watch', 'high'],
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

const dependencyEventSchema = new mongoose.Schema({
    type: {
        type: String,
        enum: ['hint_requested', 'full_answer_requested', 'answer_checked', 'gate_completed', 'blocker_selected', 'gate_opened'],
        required: true,
    },
    at: { type: Date, default: Date.now },
    riskScore: { type: Number, required: true },
    riskLevel: { type: String, enum: ['green', 'yellow', 'red', 'low', 'watch', 'high'], required: true },
    deltaScore: { type: Number, default: 0 },
    rulesetVersion: { type: String, default: 'v2' },
    details: {
        isRapid: { type: Boolean, required: false },
        isCorrect: { type: Boolean, required: false },
        isMeaningfulAttempt: { type: Boolean, required: false },
        blocker: { type: String, required: false },
        isAlternateView: { type: Boolean, required: false },
        problemKey: { type: String, required: false },
    },
}, { _id: false });

const aiErrorReportSchema = new mongoose.Schema({
    messageText: { type: String, required: true, maxlength: 12000 },
    correction: { type: String, required: true, maxlength: 2000 },
    status: { type: String, enum: ['validated'], default: 'validated' },
    createdAt: { type: Date, default: Date.now },
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
    dependencyEvents: {
        type: [dependencyEventSchema],
        default: [],
    },
    aiErrorReports: {
        type: [aiErrorReportSchema],
        default: [],
    },
    problemContext: {
        type: problemContextSchema,
        default: () => ({}),
    },
    history: [messageSchema],
}, { timestamps: true });

conversationSchema.index({ user: 1, sessionId: 1 }, { unique: true });
conversationSchema.index({ 'dependencyEvents.at': -1 });

const Conversation = mongoose.model('Conversation', conversationSchema);

module.exports = Conversation; 
