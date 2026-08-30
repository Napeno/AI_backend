const mongoose = require('mongoose');

const optionSchema = new mongoose.Schema({
  id: { type: String, required: true },
  text: { type: String, required: true },
}, { _id: false });

const blankSchema = new mongoose.Schema({
  id: { type: String, required: true },
  label: { type: String, required: true },
  expectedTokenId: { type: String, required: true },
}, { _id: false });

const tokenSchema = new mongoose.Schema({
  id: { type: String, required: true },
  label: { type: String, required: true },
  type: { type: String, enum: ['number', 'operator', 'variable', 'text'], required: true },
}, { _id: false });

const tutorStepSchema = new mongoose.Schema({
  id: { type: String, required: true },
  title: { type: String, required: true },
  explanation: { type: String, required: true },
  blanks: { type: [blankSchema], default: [] },
  tokens: { type: [tokenSchema], default: [] },
  interaction: { type: mongoose.Schema.Types.Mixed, default: null },
}, { _id: false });

const tutorQuestionSchema = new mongoose.Schema({
  id: { type: String, required: true },
  title: { type: String, required: true },
  prompt: { type: String, required: true },
  visual: { type: mongoose.Schema.Types.Mixed, default: { kind: 'none' } },
  interactionType: { type: String, enum: ['math_tokens', 'label_diagram', 'sort_sequence', 'match_pairs', 'cloze', 'evidence_choice', 'cause_effect', 'generic_tokens'], default: 'generic_tokens' },
  options: { type: [optionSchema], required: true },
  correctOptionId: { type: String, required: true, select: false },
  tutorSteps: { type: [tutorStepSchema], required: true },
}, { _id: false });

const aiTutorLessonSchema = new mongoose.Schema({
  lessonId: { type: String, required: true, unique: true },
  generationVersion: { type: Number, default: 3 },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  sessionId: { type: String, required: true },
  sourceQuestionId: { type: String, required: true },
  sourceText: { type: String, default: '' },
  sourceImage: { type: mongoose.Schema.Types.Mixed, default: null },
  subjectArea: { type: String, default: '' },
  course: { type: String, default: '' },
  educationLevel: { type: String, default: '' },
  questions: { type: [tutorQuestionSchema], required: true, maxlength: 5 },
  currentQuestionIndex: { type: Number, default: 0, min: 0, max: 4 },
  currentStepIndex: { type: Number, default: -1, min: -1 },
  attempts: { type: mongoose.Schema.Types.Mixed, default: [] },
  completed: { type: Boolean, default: false },
  startedAt: { type: Date, default: Date.now },
  completedAt: { type: Date, required: false },
}, { timestamps: true });

aiTutorLessonSchema.index({ user: 1, sessionId: 1, sourceQuestionId: 1, createdAt: -1 });
aiTutorLessonSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 7 });

module.exports = mongoose.model('AiTutorLesson', aiTutorLessonSchema);
