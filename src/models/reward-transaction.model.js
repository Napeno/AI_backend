const mongoose = require('mongoose');

const rewardTransactionSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  amount: { type: Number, required: true },
  reason: { type: String, required: true },
  balanceAfter: { type: Number, required: true },
  idempotencyKey: { type: String, required: true, unique: true },
}, { timestamps: true });

module.exports = mongoose.model('RewardTransaction', rewardTransactionSchema);
