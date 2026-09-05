require('dotenv').config();
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');

const roster = require('./class-8-2-students.json');
const KEEP_USERNAMES = ['sonha2003', 'kiều oanh', 'kieuoanh'];
const runId = new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
const credentialsPath = path.resolve(process.cwd(), `class-8-2-credentials-${runId}.csv`);

const slug = value => String(value).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd').replace(/[^a-z0-9]+/g, '').slice(0, 24);

const buildAnalyticsDemo = (studentId, frequent, index, now = new Date()) => {
  const start = new Date(now);
  start.setMonth(frequent ? 3 : 7, frequent ? 1 : 15);
  start.setHours(9, 0, 0, 0);
  const events = [];
  let riskScore = frequent ? 52 : 42;
  const add = (type, at, details = {}, delta = 0) => {
    riskScore = Math.max(0, Math.min(100, riskScore + delta));
    events.push({ type, at, riskScore, riskLevel: riskScore > 60 ? 'high' : riskScore > 30 ? 'watch' : 'low', details });
  };
  add('baseline', start, {}, 0);
  if (frequent) {
    for (let day = 12 + (index % 5); day <= Math.floor((now - start) / 86400000); day += 16 + (index % 3)) {
      const at = new Date(start.getTime() + day * 86400000);
      add('answer_checked', at, { isMeaningfulAttempt: true, isCorrect: day % 3 !== 0 }, day % 3 !== 0 ? -9 : -3);
      if (day % 2 === 0) add('hint_requested', new Date(at.getTime() + 3600000), { isRapid: false }, 5);
      if (day % 4 === 0) add('gate_completed', new Date(at.getTime() + 7200000), {}, -7);
    }
  } else {
    const at = new Date(start.getTime() + (index % 10) * 86400000);
    add('answer_checked', at, { isMeaningfulAttempt: index % 2 === 0, isCorrect: index % 3 === 0 }, index % 3 === 0 ? -8 : 2);
    if (index % 4 === 0) add('hint_requested', new Date(at.getTime() + 3600000), { isRapid: false }, 5);
  }
  return {
    version: 3,
    seededAt: now,
    baselineScore: 50,
    currentScore: riskScore,
    riskLevel: riskScore > 60 ? 'high' : riskScore > 30 ? 'watch' : 'low',
    educationLevel: 'middle',
    subjectArea: ['mathematics', 'natural_sciences', 'english_language'][index % 3],
    events,
  };
};

const backupCollections = async (sourceDb, targetDb) => {
  const names = (await sourceDb.listCollections().toArray()).map(collection => collection.name);
  for (const name of names) {
    const documents = await sourceDb.collection(name).find({}).toArray();
    if (documents.length) await targetDb.collection(name).insertMany(documents, { ordered: false });
  }
  return names;
};

const main = async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const sourceDb = mongoose.connection.db;
  const backupDbName = `${sourceDb.databaseName}_backup_${runId}`;
  const targetDb = mongoose.connection.client.db(backupDbName);
  const backedUpCollections = await backupCollections(sourceDb, targetDb);

  const users = sourceDb.collection('users');
  const keepUsers = await users.find({ username: { $in: KEEP_USERNAMES } }).toArray();
  if (keepUsers.length !== KEEP_USERNAMES.length) {
    throw new Error(`Expected ${KEEP_USERNAMES.length} current accounts, found ${keepUsers.length}`);
  }
  const keepIds = keepUsers.map(user => user._id);
  const adminIds = (await users.find({ role: 'admin' }).project({ _id: 1 }).toArray()).map(user => user._id);
  const oldUsers = await users.find({ _id: { $nin: keepIds }, role: { $ne: 'admin' } }).project({ _id: 1 }).toArray();
  const oldIds = oldUsers.map(user => user._id);

  const dependentCollections = ['conversations', 'practiceitems', 'aitutorlessons', 'aitutorquestions', 'rewardtransactions', 'giftredemptions'];
  const deleted = {};
  const deletedUsers = await users.deleteMany({ _id: { $in: oldIds } });

  await users.updateMany(
    { _id: { $in: keepIds } },
    { $set: { role: 'student', className: '8.2', rosterSource: 'Danh_Sach_Hoc_Sinh_Lop_8.2.docx', rosterStatus: 'current-account' } },
  );

  const existingUsernames = new Set((await users.find({}).project({ username: 1 }).toArray()).map(user => user.username));
  const credentials = ['STT,Ho ten,Username,Mat khau,Ngay sinh,Gioi tinh,Dan toc,Lop nam truoc,Lop hien tai,Ghi chu'];
  const newUsers = [];
  for (const student of roster) {
    const username = `hs82_${String(student.stt).padStart(2, '0')}`;
    if (existingUsernames.has(username)) throw new Error(`Username already exists: ${username}`);
    const password = `TB82-${String(student.stt).padStart(2, '0')}-2026`;
    newUsers.push({
      name: student.name,
      username,
      passwordHash: await bcrypt.hash(password, 12),
      role: 'student',
      className: student.className,
      rosterNumber: student.stt,
      dateOfBirth: student.dateOfBirth,
      gender: student.gender,
      ethnicity: student.ethnicity,
      previousClass: student.previousClass,
      rosterSource: 'Danh_Sach_Hoc_Sinh_Lop_8.2.docx',
      rosterStatus: 'current',
      note: student.note,
      coins: 0,
      chestnuts: 0,
      points: 0,
      rank: 'bronze',
      avatar: 'default',
      ownedAvatars: ['default'],
      badges: [],
      favoriteGifts: [],
      dependencyAssessments: [],
      thinkingChallenges: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    credentials.push([student.stt, student.name, username, password, student.dateOfBirth, student.gender, student.ethnicity, student.previousClass, student.className, student.note]
      .map(value => `"${String(value || '').replace(/"/g, '""')}"`).join(','));
  }
  const inserted = await users.insertMany(newUsers, { ordered: true });
  const allowedIds = [...adminIds, ...keepIds, ...Object.values(inserted.insertedIds)];
  for (const name of dependentCollections) {
    const result = await sourceDb.collection(name).deleteMany({ user: { $nin: allowedIds } });
    deleted[name] = result.deletedCount;
  }
  for (let index = 0; index < keepUsers.length; index += 1) {
    await users.updateOne({ _id: keepUsers[index]._id }, { $set: { analyticsDemo: buildAnalyticsDemo(keepUsers[index]._id, true, index) } });
  }
  for (let index = 0; index < roster.length; index += 1) {
    await users.updateOne({ _id: Object.values(inserted.insertedIds)[index] }, { $set: { analyticsDemo: buildAnalyticsDemo(Object.values(inserted.insertedIds)[index], false, index) } });
  }
  fs.writeFileSync(credentialsPath, `${credentials.join('\n')}\n`, { mode: 0o600 });

  const activeCount = await users.countDocuments({ role: { $ne: 'admin' } });
  console.log(JSON.stringify({ runId, backupDbName, backedUpCollections, deletedUsers: deletedUsers.deletedCount, deleted, keptAccounts: KEEP_USERNAMES, addedRosterStudents: roster.length, activeStudents: activeCount, credentialsPath }, null, 2));
};

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
}).finally(async () => {
  await mongoose.disconnect();
});
