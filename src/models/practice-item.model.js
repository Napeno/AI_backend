const mongoose = require('mongoose');

const practiceSchema = new mongoose.Schema({
  prompt: { type: String, required: false },
  hint: { type: String, required: false },
  answerGuide: { type: String, required: false },
}, { _id: false });

const practiceItemSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  sessionId: {
    type: String,
    required: true,
  },
  educationLevel: {
    type: String,
    required: false,
  },
  subjectArea: {
    type: String,
    required: false,
  },
  sourceQuestion: {
    type: String,
    required: true,
    maxlength: 1200,
  },
  blocker: {
    type: String,
    enum: ['understand_question', 'formula', 'start', 'calculation', 'incorrect_answer'],
    required: true,
  },
  sourceFeedback: {
    type: String,
    required: false,
    maxlength: 1200,
  },
  practice: {
    type: practiceSchema,
    default: () => ({}),
  },
  status: {
    type: String,
    enum: ['new', 'needs_review', 'reviewed', 'mastered'],
    default: 'new',
  },
  reviewCount: {
    type: Number,
    default: 0,
  },
  nextReviewAt: {
    type: Date,
    default: Date.now,
  },
  lastReviewedAt: {
    type: Date,
    required: false,
  },
}, { timestamps: true });

practiceItemSchema.index({ user: 1, sessionId: 1, sourceQuestion: 1, blocker: 1 }, { unique: true });
practiceItemSchema.index({ user: 1, status: 1, nextReviewAt: 1 });

module.exports = mongoose.model('PracticeItem', practiceItemSchema);
