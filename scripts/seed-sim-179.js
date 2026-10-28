/**
 * Seed cohort 179 HS từ Mo_phong_179_HS_28-8_01-11.xlsx.
 * - 28/08 → 01/11: đúng điểm/hoạt động trong Excel
 * - 01/04 → 27/08: backfill ngẫu nhiên có kiểm soát cho HS vào sớm ngày 28/08
 *   (thưa dần → đúng 4 HS ngày đầu sheet), random-walk điểm về đúng điểm 28/08
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
const HISTORY_FROM = '2026-04-01';
const dayMs = 24 * 60 * 60 * 1000;

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

const unitNoise = (index, day) => {
  const x = Math.sin(index * 12.9898 + day * 78.233) * 43758.5453;
  return x - Math.floor(x);
};

const listDates = (fromIso, toIsoInclusive) => {
  const dates = [];
  let cursor = new Date(`${fromIso}T00:00:00.000Z`);
  const end = new Date(`${toIsoInclusive}T00:00:00.000Z`);
  while (cursor <= end) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor = new Date(cursor.getTime() + dayMs);
  }
  return dates;
};

const firstSheetDate = (scores = {}) => {
  const dates = Object.keys(scores).sort();
  return dates[0] || null;
};

/**
 * Pre-sheet history only for HS whose first sheet day is 28/08 (the 4 early joiners).
 * Stagger start across Apr→Jul; sparse weekday activity; score walks into Aug 28 value.
 */
const buildPreHistoryEvents = (studentCode, index, joinRank, targetScore) => {
  const historyDates = listDates(HISTORY_FROM, '2026-08-27');
  // Stagger: rank0 ~ early April, rank3 ~ late July
  const startOffset = 8 + joinRank * 28 + Math.floor(unitNoise(index, joinRank) * 10);
  const startDate = historyDates[Math.min(startOffset, historyDates.length - 20)];
  const startIdx = historyDates.indexOf(startDate);
  const span = Math.max(1, historyDates.length - 1 - startIdx);
  let score = clamp(targetScore + 8 - joinRank * 2 + Math.floor(unitNoise(index, 3) * 6), 12, 55);
  const events = [];

  for (let i = startIdx; i < historyDates.length; i += 1) {
    const isoDate = historyDates[i];
    const day = new Date(`${isoDate}T00:00:00.000Z`);
    const weekday = day.getUTCDay(); // 0 CN ... 6 T7
    const isWeekend = weekday === 0 || weekday === 6;
    const progress = (i - startIdx) / span;
    const activityChance = isWeekend ? 0.18 : 0.42 + progress * 0.2;
    const active = unitNoise(index, i + 11) < activityChance;
    // Always keep a score sample ~2x/week so timeline is readable; usedApp only when "active"
    const keepScore = active || unitNoise(index, i + 29) < 0.22;
    if (!keepScore) continue;

    const pull = targetScore + (1 - progress) * (score - targetScore) * 0.15;
    const step = Math.round((unitNoise(index, i + 7) - 0.5) * 6);
    score = clamp(Math.round(score * 0.82 + pull * 0.18 + step), 8, 68);
    if (i === historyDates.length - 1) score = clamp(Math.round(targetScore + (unitNoise(index, 99) - 0.5) * 2), 8, 68);

    const type = EVENT_TYPES[(index + i) % EVENT_TYPES.length];
    const hour = active ? 8 + ((index + i) % 9) : 19;
    const minute = (index * 5 + i * 2) % 55;
    events.push(event(type, atDate(isoDate, hour, minute, index), score, {
      usedApp: active,
      sheetCode: studentCode,
      preHistory: true,
      ...(type === 'answer_checked'
        ? { isMeaningfulAttempt: score <= 55 || i % 2 === 1, isCorrect: score <= 35 && i % 3 !== 0 }
        : type === 'hint_requested'
          ? { isRapid: score >= 70 && i % 4 === 0 }
          : {}),
    }));
  }
  return events;
};

const buildEventsForStudent = (studentCode, index, earlyJoinerRank = -1) => {
  const scores = SHEET.scores[studentCode] || {};
  const activity = SHEET.activity[studentCode] || {};
  const events = [];
  const firstDate = firstSheetDate(scores);

  if (firstDate === SHEET.from && earlyJoinerRank >= 0) {
    const targetScore = Number(scores[SHEET.from]);
    if (Number.isFinite(targetScore)) {
      events.push(...buildPreHistoryEvents(studentCode, index, earlyJoinerRank, targetScore));
    }
  }

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

  const earlyJoiners = studentCodes
    .map((code, index) => ({ code, index, first: firstSheetDate(SHEET.scores[code]) }))
    .filter((row) => row.first === SHEET.from)
    .sort((a, b) => a.index - b.index);
  if (earlyJoiners.length !== 4) {
    throw new Error(`Expected 4 HS joining on ${SHEET.from}, found ${earlyJoiners.length}`);
  }
  const earlyRank = new Map(earlyJoiners.map((row, rank) => [row.code, rank]));

  const plans = studentCodes.map((code, index) => ({
    code,
    index,
    events: buildEventsForStudent(code, index, earlyRank.has(code) ? earlyRank.get(code) : -1),
  }));

  const preHistorySample = ['2026-04-15', '2026-05-20', '2026-06-30', '2026-07-31', '2026-08-20'].map((date) => ({
    date,
    ...aggregateDay(plans, date, sheetLevelOf),
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
      dateRange: { from: HISTORY_FROM, sheetFrom: SHEET.from, to: SHEET.to },
      earlyJoiners: earlyJoiners.map((row) => row.code),
      preHistorySample,
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
    dateRange: { from: HISTORY_FROM, sheetFrom: SHEET.from, to: SHEET.to },
    earlyJoiners: earlyJoiners.map((row) => row.code),
    preHistorySample,
    sheetDaysMatched: matched,
    sheetDaysTotal: fullCompare.length,
    sampleCompare: compare,
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
