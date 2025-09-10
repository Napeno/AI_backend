const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    trim: true,
  },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
  },
  passwordHash: {
    type: String,
    required: true,
  },
  passwordResetTokenHash: {
    type: String,
  },
  passwordResetExpires: {
    type: Date,
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
    enum: ['iron', 'bronze', 'silver', 'gold', 'platinum', 'diamond'],
    default: 'iron',
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
}, { timestamps: true });

const User = mongoose.model('User', userSchema);

module.exports = User; 