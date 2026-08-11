const mongoose = require('mongoose');
const connectDB = require('../src/config/database');
const User = require('../src/models/user.model');
const RewardTransaction = require('../src/models/reward-transaction.model');

const run = async () => {
  await connectDB();
  const users = await User.find({ chestnuts: { $exists: false } });
  for (const user of users) {
    const balance = Number(user.coins || 0);
    user.chestnuts = balance;
    await user.save();
    await RewardTransaction.updateOne(
      { idempotencyKey: `migration-opening:${user._id}` },
      { $setOnInsert: { user: user._id, amount: balance, reason: 'migration_opening_balance', balanceAfter: balance, idempotencyKey: `migration-opening:${user._id}` } },
      { upsert: true }
    );
  }
  console.log(`Migrated ${users.length} users to chestnuts.`);
  await mongoose.disconnect();
};

run().catch(error => { console.error(error); process.exit(1); });
