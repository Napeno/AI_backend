require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../src/config/database');
const Conversation = require('../src/models/conversation.model');
const { updateRisk } = require('../src/services/intervention.service');

const apply = process.argv.includes('--apply');

const recalculateRisk = async () => {
  await connectDB();
  const conversations = await Conversation.find({});
  for (const conversation of conversations) updateRisk(conversation);
  if (apply) await Promise.all(conversations.map(conversation => conversation.save()));
  console.log(`${apply ? 'Updated' : 'Would update'} ${conversations.length} conversations`);
  await mongoose.disconnect();
};

recalculateRisk().catch(async error => {
  console.error(error.message);
  await mongoose.disconnect();
  process.exit(1);
});
