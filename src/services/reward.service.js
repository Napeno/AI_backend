const RewardTransaction = require('../models/reward-transaction.model');

const awardChestnuts = async (user, amount, reason, idempotencyKey) => {
  const existing = await RewardTransaction.findOne({ idempotencyKey }).lean();
  if (existing) return { awarded: false, balance: existing.balanceAfter, transaction: existing };
  // ponytail: unique key prevents duplicate browser retries; use a Mongo transaction if rewards later span multiple documents.
  let transaction;
  try {
    transaction = await RewardTransaction.create({ user: user._id, amount, reason, balanceAfter: 0, idempotencyKey });
  } catch (error) {
    if (error?.code !== 11000) throw error;
    const duplicate = await RewardTransaction.findOne({ idempotencyKey }).lean();
    return { awarded: false, balance: duplicate.balanceAfter, transaction: duplicate };
  }
  user.chestnuts = Number(user.chestnuts || 0) + amount;
  await user.save();
  transaction.balanceAfter = user.chestnuts;
  await transaction.save();
  return { awarded: true, balance: user.chestnuts, transaction };
};

module.exports = { awardChestnuts };
