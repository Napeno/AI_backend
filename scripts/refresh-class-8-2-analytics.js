require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../src/config/database');
const User = require('../src/models/user.model');
const { DEMO_VERSION, buildAnalyticsDemo } = require('../src/services/analytics-demo.service');

const refresh = async () => {
  await connectDB();
  const students = await User.find({ role: { $ne: 'admin' }, rosterStatus: { $in: ['current', 'current-account'] } }).select('_id rosterStatus');
  const now = new Date();
  for (const student of students) {
    await User.updateOne(
      { _id: student._id },
      { $set: { analyticsDemo: buildAnalyticsDemo(student._id, now, { frequent: student.rosterStatus === 'current-account' }) } },
    );
  }
  console.log(`Refreshed analytics v${DEMO_VERSION} for ${students.length} students`);
  await mongoose.disconnect();
};

refresh().catch(async error => {
  console.error(error.message);
  await mongoose.disconnect();
  process.exit(1);
});
