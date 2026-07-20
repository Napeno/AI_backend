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
