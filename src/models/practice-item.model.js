const mongoose = require('mongoose');

const practiceTurnSchema = new mongoose.Schema({
  role: {
    type: String,
    enum: ['student', 'assistant'],
    required: true,
  },
  action: {
    type: String,
    enum: ['attempt', 'hint', 'solution'],
    required: true,
  },
  content: {
    type: String,
    required: true,
    maxlength: 2000,
  },
  hint: {
    type: String,
    maxlength: 1200,
  },
  nextQuestion: {
    type: String,
    maxlength: 1200,
  },
  isCorrect: {
    type: Boolean,
    required: false,
  },
  isMeaningfulAttempt: {
    type: Boolean,
    required: false,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
}, { _id: false });

const practiceOptionSchema = new mongoose.Schema({
  id: { type: String, required: true, maxlength: 20 },
  text: { type: String, required: true, maxlength: 600 },
}, { _id: false });

const practiceVariantSchema = new mongoose.Schema({
  questionType: {
    type: String,
    enum: ['multiple_choice', 'true_false', 'fill_blank', 'long_answer'],
    required: true,
  },
  prompt: { type: String, required: true, maxlength: 2000 },
  hint: { type: String, required: true, maxlength: 1200 },
  answerGuide: { type: String, required: false, maxlength: 2000 },
  options: { type: [practiceOptionSchema], default: [] },
  correctOptionId: { type: String, required: false, maxlength: 20 },
  correctAnswer: { type: Boolean, required: false },
  turns: { type: [practiceTurnSchema], default: [] },
  incorrectAttempts: { type: Number, default: 0 },
  status: {
    type: String,
    enum: ['new', 'needs_review', 'reviewed', 'mastered'],
    default: 'new',
  },
  reviewCount: { type: Number, default: 0 },
  nextReviewAt: { type: Date, default: Date.now },
  lastReviewedAt: { type: Date, required: false },
}, { _id: false });

const practiceSchema = new mongoose.Schema({
  prompt: { type: String, required: false },
  hint: { type: String, required: false },
  answerGuide: { type: String, required: false },
  turns: {
    type: [practiceTurnSchema],
    default: [],
  },
  incorrectAttempts: {
    type: Number,
    default: 0,
  },
  variants: {
    type: [practiceVariantSchema],
    default: [],
  },
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
  conversationTitle: {
    type: String,
    required: false,
    maxlength: 120,
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
