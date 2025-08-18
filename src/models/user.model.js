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
}, { timestamps: true });

const User = mongoose.model('User', userSchema);

module.exports = User; 