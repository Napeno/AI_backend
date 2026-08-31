const mongoose = require('mongoose');

const giftRedemptionSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  giftId: { type: String, required: true },
  title: { type: String, required: true },
  price: { type: Number, required: true },
  balanceAfter: { type: Number, required: true, default: 0 },
  status: { type: String, enum: ['pending', 'failed'], required: true },
  idempotencyKey: { type: String, required: true, unique: true },
}, { timestamps: true });

module.exports = mongoose.model('GiftRedemption', giftRedemptionSchema);
