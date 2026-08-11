const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    trim: true,
  },
  username: {
    type: String,
    required: true,
    unique: true,
    trim: true,
  },
  passwordHash: {
    type: String,
    required: true,
  },
  role: {
    type: String,
    enum: ['student', 'admin'],
    default: 'student',
  },
  coins: {
    type: Number,
    default: 0,
  },
  chestnuts: {
    type: Number,
    default: 0,
  },
  badges: [{
    code: { type: String, required: true },
    earnedAt: { type: Date, default: Date.now },
  }],
  points: {
    type: Number,
    default: 0,
  },
  rank: {
    type: String,
    enum: ['bronze', 'silver', 'gold', 'platinum', 'diamond'],
    default: 'bronze',
  },
  avatar: {
    type: String,
    default: 'default',
  },
  ownedAvatars: [{
    type: String,
    default: ['default'],
  }],
  purchasedAvatars: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Avatar',
  }],
  dependencyAssessments: [{
    score: { type: Number, required: true },
    resultId: { type: String, required: true },
    submittedAt: { type: Date, default: Date.now },
  }],
  analyticsDemo: {
    type: {
      version: { type: Number, required: true },
      seededAt: { type: Date, required: true },
      baselineScore: { type: Number, required: true },
      currentScore: { type: Number, required: true },
      riskLevel: { type: String, enum: ['green', 'yellow', 'red'], required: true },
      educationLevel: { type: String, required: true },
      subjectArea: { type: String, required: true },
      events: [{
        type: { type: String, required: true },
        at: { type: Date, required: true },
        riskScore: { type: Number, required: true },
        riskLevel: { type: String, enum: ['green', 'yellow', 'red'], required: true },
        details: {
          isRapid: { type: Boolean, required: false },
          isCorrect: { type: Boolean, required: false },
          isMeaningfulAttempt: { type: Boolean, required: false },
        },
      }],
    },
    required: false,
    select: false,
  },
  teacherNotes: {
    type: [{
      body: { type: String, required: true, trim: true },
      author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
      createdAt: { type: Date, default: Date.now },
    }],
    default: [],
    select: false,
  },
}, { timestamps: true });

const User = mongoose.model('User', userSchema);

module.exports = User; 
