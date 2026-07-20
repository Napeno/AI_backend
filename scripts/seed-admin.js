require('dotenv').config();
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const connectDB = require('../src/config/database');
const User = require('../src/models/user.model');

const seedAdmin = async () => {
  const username = String(process.env.ADMIN_USERNAME || '').trim().toLowerCase();
  const password = String(process.env.ADMIN_PASSWORD || '');
  const name = String(process.env.ADMIN_NAME || 'Giáo viên').trim();
  if (!username || !password) throw new Error('ADMIN_USERNAME and ADMIN_PASSWORD are required');

  await connectDB();
  const existing = await User.findOne({ username });
  if (existing) {
    if (existing.role !== 'admin') throw new Error('Username already belongs to a student');
    console.log('Admin already exists');
  } else {
    await User.create({ name, username, passwordHash: await bcrypt.hash(password, 12), role: 'admin' });
    console.log('Admin created');
  }
  await mongoose.disconnect();
};

seedAdmin().catch(error => {
  console.error(error.message);
  mongoose.disconnect().finally(() => process.exit(1));
});
