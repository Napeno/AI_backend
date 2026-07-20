require('dotenv').config();
const mongoose = require('mongoose');
const connectDB = require('../src/config/database');
const User = require('../src/models/user.model');
const { DEMO_VERSION, buildAnalyticsDemo } = require('../src/services/analytics-demo.service');

const reset = process.argv.includes('--reset');

const seedAnalyticsDemo = async () => {
  await connectDB();
  const students = await User.find({ role: { $ne: 'admin' } }).select('_id +analyticsDemo');
  let seeded = 0;
  for (const student of students) {
    if (!reset && student.analyticsDemo?.version === DEMO_VERSION) continue;
    // Legacy demo accounts can lack login-only fields such as username.
    // Update this dashboard-only field directly so their old records remain usable.
    const result = await User.updateOne(
      { _id: student._id },
      { $set: { analyticsDemo: buildAnalyticsDemo(student._id, new Date()) } },
    );
    seeded += result.modifiedCount;
  }
  console.log(`Seeded demo analytics for ${seeded} students`);
  await mongoose.disconnect();
};

seedAnalyticsDemo().catch(async error => {
  console.error(error.message);
  await mongoose.disconnect();
  process.exit(1);
});
