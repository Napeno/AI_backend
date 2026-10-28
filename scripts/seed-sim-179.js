/**
 * Seed cohort mô phỏng 179 HS từ Mo_phong_179_HS_28-8_01-11.xlsx.
 * Users dùng rosterStatus=sim-179 nên KHÔNG lẫn vào dashboard lớp 8.2 (chỉ lấy current/current-account).
 *
 * Usage:
 *   node scripts/seed-sim-179.js
 *   node scripts/seed-sim-179.js --dry-run
 *   node scripts/seed-sim-179.js --purge
 */
require('dotenv').config();
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const { getRiskLevel } = require('../src/services/intervention.service');
const SHEET = require('./data/sheet-179-sim.json');

const DRY_RUN = process.argv.includes('--dry-run');
const PURGE = process.argv.includes('--purge');
const SESSION_PREFIX = 'sim-179-daily-2026';
const ROSTER_STATUS = 'sim-179';
const CLASS_NAME = 'sim-179';

const EVENT_TYPES = [
  'hint_requested',
  'answer_checked',
  'full_answer_requested',
  'gate_completed',
];

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const levelOf = (score) => getRiskLevel(score);
/** Sheet thresholds (for verification only). */
const sheetLevelOf = (score) => {
  if (score >= 70) return 'high';
  if (score >= 40) return 'watch';
  return 'low';
};

const atDate = (isoDate, hour, minute, index) => {
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  date.setUTCHours(hour, minute, index % 50, 0);
  return date;
};

const event = (type, at, riskScore, details = {}) => ({
  type,
  at,
  riskScore: clamp(Math.round(riskScore), 0, 100),
  riskLevel: levelOf(clamp(Math.round(riskScore), 0, 100)),
  deltaScore: 0,
  rulesetVersion: 'v2',
  details,
});

const buildEventsForStudent = (studentCode, index) => {
  const scores = SHEET.scores[studentCode] || {};
  const activity = SHEET.activity[studentCode] || {};
  const events = [];
  SHEET.dates.forEach((isoDate, dayIndex) => {
    const score = scores[isoDate];
    if (score == null) return;
    const active = activity[isoDate] === 1;
    const hour = active ? 8 + ((index + dayIndex) % 9) : 20;
    const minute = (index * 5 + dayIndex * 2) % 55;
    const type = EVENT_TYPES[(index + dayIndex) % EVENT_TYPES.length];
    const details = {
      usedApp: active,
      sheetCode: studentCode,
      ...(type === 'answer_checked'
        ? { isMeaningfulAttempt: score <= 55 || dayIndex % 2 === 1, isCorrect: score <= 35 && dayIndex % 3 !== 0 }
        : type === 'hint_requested'
          ? { isRapid: score >= 70 && dayIndex % 4 === 0 }
          : {}),
    };
    events.push(event(type, atDate(isoDate, hour, minute, index), score, details));
  });
  return events.sort((a, b) => new Date(a.at) - new Date(b.at));
};

const aggregateDay = (plans, isoDate, levelFn) => {
  const counts = { high: 0, watch: 0, low: 0 };
  let scoreTotal = 0;
  let scored = 0;
  // Carry-forward last known score (sheet "Điểm từng HS" blanks = not updated that day)
  plans.forEach((plan) => {
    const onOrBefore = plan.events.filter((item) => new Date(item.at).toISOString().slice(0, 10) <= isoDate);
    if (!onOrBefore.length) return;
    const latest = onOrBefore[onOrBefore.length - 1];
    counts[levelFn(latest.riskScore)] += 1;
    scoreTotal += latest.riskScore;
    scored += 1;
  });
  return {
    date: isoDate,
    ...counts,
    total: counts.high + counts.watch + counts.low,
    averageRisk: scored ? Math.round((scoreTotal / scored) * 10) / 10 : 0,
  };
};

const main = async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const users = db.collection('users');
  const conversations = db.collection('conversations');

  if (PURGE) {
    const oldUsers = await users.find({ rosterStatus: ROSTER_STATUS }).project({ _id: 1 }).toArray();
    const ids = oldUsers.map((user) => user._id);
    const deletedConv = await conversations.deleteMany({
      $or: [
        { sessionId: { $regex: `^${SESSION_PREFIX}` } },
        { user: { $in: ids } },
      ],
    });
    const deletedUsers = await users.deleteMany({ rosterStatus: ROSTER_STATUS });
    console.log(JSON.stringify({ purgedUsers: deletedUsers.deletedCount, purgedConversations: deletedConv.deletedCount }, null, 2));
    return;
  }

  const studentCodes = Object.keys(SHEET.scores).sort();
  if (studentCodes.length !== 179) {
    throw new Error(`Expected 179 students in sheet JSON, found ${studentCodes.length}`);
  }

  const plans = studentCodes.map((code, index) => ({
    code,
    index,
    events: buildEventsForStudent(code, index),
  }));

  const sampleDates = [SHEET.from, '2026-09-03', '2026-09-07', '2026-09-17', '2026-10-01', SHEET.to];
  const compare = sampleDates.map((date) => {
    const expected = SHEET.daily.find((row) => row.date === date);
    const actualSheet = aggregateDay(plans, date, sheetLevelOf);
    const actualCode = aggregateDay(plans, date, levelOf);
    return {
      date,
      expected: expected
        ? { high: expected.high, watch: expected.watch, low: expected.low, averageRisk: expected.averageRisk, cumulative: expected.cumulative }
        : null,
      actualSheetThresholds: actualSheet,
      actualCodeThresholds: actualCode,
      countsMatchSheet: expected
        ? actualSheet.high === expected.high && actualSheet.watch === expected.watch && actualSheet.low === expected.low
        : false,
    };
  });

  // Full-day compare with sheet thresholds + carry-forward
  const fullCompare = SHEET.daily.map((day) => {
    const actual = aggregateDay(plans, day.date, sheetLevelOf);
    return {
      date: day.date,
      countsMatch: actual.high === day.high && actual.watch === day.watch && actual.low === day.low,
      expected: { high: day.high, watch: day.watch, low: day.low },
      actual: { high: actual.high, watch: actual.watch, low: actual.low, total: actual.total, averageRisk: actual.averageRisk },
    };
  });
  const matched = fullCompare.filter((row) => row.countsMatch).length;

  if (DRY_RUN) {
    console.log(JSON.stringify({
      ok: true,
      dryRun: true,
      students: plans.length,
      dateRange: { from: SHEET.from, to: SHEET.to },
      sheetDaysMatched: matched,
      sheetDaysTotal: fullCompare.length,
      sampleCompare: compare,
      firstMismatch: fullCompare.find((row) => !row.countsMatch) || null,
    }, null, 2));
    return;
  }

  // Replace previous sim cohort
  const oldUsers = await users.find({ rosterStatus: ROSTER_STATUS }).project({ _id: 1 }).toArray();
  const oldIds = oldUsers.map((user) => user._id);
  await conversations.deleteMany({
    $or: [
      { sessionId: { $regex: `^${SESSION_PREFIX}` } },
      { user: { $in: oldIds } },
    ],
  });
  await users.deleteMany({ rosterStatus: ROSTER_STATUS });

  const passwordHash = await bcrypt.hash('Sim179-2026', 10);
  const now = new Date();
  const userDocs = [];
  for (let index = 0; index < studentCodes.length; index += 1) {
    const code = studentCodes[index];
    userDocs.push({
      name: `HS mô phỏng ${code}`,
      username: `sim179_${String(index + 1).padStart(3, '0')}`,
      passwordHash,
      role: 'student',
      className: CLASS_NAME,
      rosterNumber: index + 1,
      rosterStatus: ROSTER_STATUS,
      rosterSource: 'Mo_phong_179_HS_28-8_01-11.xlsx',
      note: code,
      createdAt: now,
      updatedAt: now,
    });
  }
  const inserted = await users.insertMany(userDocs, { ordered: true });
  const insertedIds = Object.values(inserted.insertedIds);

  let createdConversations = 0;
  for (let index = 0; index < plans.length; index += 1) {
    const plan = plans[index];
    const userId = insertedIds[index];
    if (!plan.events.length) continue;
    const latest = plan.events[plan.events.length - 1];
    const subjectArea = ['mathematics', 'natural_sciences', 'english_language'][index % 3];
    await conversations.insertOne({
      sessionId: `${SESSION_PREFIX}-${String(userId)}`,
      user: userId,
      educationLevel: 'middle',
      subjectArea,
      course: subjectArea === 'english_language' ? 'english_language' : subjectArea,
      title: 'Mô phỏng 179 HS ThinkBridge',
      messages: [],
      dependencyEvents: plan.events,
      interventionMetrics: {
        rulesetVersion: 'v2',
        riskScore: latest.riskScore,
        riskLevel: latest.riskLevel,
        lastRiskScore: latest.riskScore,
        lastRiskLevel: latest.riskLevel,
        hintRequests: plan.events.filter((item) => item.type === 'hint_requested').length,
        fullAnswerRequests: plan.events.filter((item) => item.type === 'full_answer_requested').length,
        answerAttempts: plan.events.filter((item) => item.type === 'answer_checked').length,
        meaningfulAttempts: plan.events.filter((item) => item.details?.isMeaningfulAttempt).length,
        correctAnswers: plan.events.filter((item) => item.details?.isCorrect).length,
        gateCompletions: plan.events.filter((item) => item.type === 'gate_completed').length,
      },
      createdAt: plan.events[0].at,
      updatedAt: latest.at,
      __v: 0,
    });
    await users.updateOne(
      { _id: userId },
      {
        $set: {
          analyticsDemo: {
            version: 1,
            seededAt: now,
            cohort: 'sim-179',
            sheetCode: plan.code,
            timeline: { from: SHEET.from, to: SHEET.to },
            dailyEvents: plan.events.length,
          },
          updatedAt: now,
        },
      },
    );
    createdConversations += 1;
  }

  console.log(JSON.stringify({
    ok: true,
    students: insertedIds.length,
    createdConversations,
    dateRange: { from: SHEET.from, to: SHEET.to },
    sheetDaysMatched: matched,
    sheetDaysTotal: fullCompare.length,
    sampleCompare: compare,
    note: 'Cohort sim-179 dùng rosterStatus=sim-179, không hiện trên dashboard giáo viên lớp 8.2.',
  }, null, 2));
};

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
