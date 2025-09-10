const mongoose = require('mongoose');

const avatarSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  price: { type: Number, required: true },
  category: { type: String, required: true },
  imageUrl: { type: String, required: true },
}, { timestamps: true });

const Avatar = mongoose.model('Avatar', avatarSchema);

module.exports = Avatar; 