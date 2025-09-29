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
        enum: [
            // Elementary
            'vietnamese', 'mathematics', 'foreign_language', 'ethics', 'natural_social',
            'history_geography', 'science', 'informatics_technology', 'physical_education', 'arts',
            // Middle
            'literature', 'civic_education', 'natural_sciences', 'technology', 'informatics',
            // High / generalized
            'social_sciences', 'english_language'
        ],
        default: 'natural_sciences',
    },
    course: {
        type: String,
        enum: ['mathematics', 'natural_sciences', 'history', 'geography', 'civics', 'literature', 'foreign_language', 'english_language'],
        required: false,
    },
    history: [messageSchema],
}, { timestamps: true });

conversationSchema.index({ user: 1, sessionId: 1 }, { unique: true });

const Conversation = mongoose.model('Conversation', conversationSchema);

module.exports = Conversation; 
