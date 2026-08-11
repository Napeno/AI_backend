const mongoose = require('mongoose');
const connectDB = require('../src/config/database');
const User = require('../src/models/user.model');
const RewardTransaction = require('../src/models/reward-transaction.model');
const RULES = require('../src/config/intervention-rules.json');

const run = async () => {
  await connectDB();
  const period = new Date().toISOString().slice(0, 7);
  const users = await User.find({});
  for (const user of users) {
    const idempotencyKey = `chestnut-reset:${period}:${user._id}`;
    if (await RewardTransaction.exists({ idempotencyKey })) continue;
    const before = Number(user.chestnuts ?? user.coins ?? 0);
    user.chestnuts = RULES.rewards.monthlyReset;
    await user.save();
    await RewardTransaction.create({ user: user._id, amount: user.chestnuts - before, reason: 'monthly_reset', balanceAfter: user.chestnuts, idempotencyKey });
  }
  await mongoose.disconnect();
};

run().catch(error => { console.error(error); process.exit(1); });
