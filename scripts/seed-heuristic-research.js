/**
 * Seed lớp 8.2 (47 HS) khớp sheet Theo_doi_ThinkBridge_8.2_30_ngay.xlsx:
 * - 25/04 → 25/05: đúng count Cao/Theo dõi/Thấp từng ngày trong sheet
 * - 01/04 → 24/04: giữ trạng thái ngày đầu (6/22/19)
 * - 26/05 → hôm nay: giữ trạng thái ngày cuối (0/15/32) + giảm nhẹ
 *
 * Usage:
 *   node scripts/seed-heuristic-research.js
 *   node scripts/seed-heuristic-research.js --dry-run
 *   node scripts/seed-heuristic-research.js --restore-kept
 */
require('dotenv').config();
const path = require('path');
const mongoose = require('mongoose');
const { getRiskLevel } = require('../src/services/intervention.service');
const SHEET = require('./data/sheet-8-2-30-days.json');

const APRIL = new Date('2026-04-01T00:00:00.000Z');
const SHEET_FROM = new Date(`${SHEET.from}T00:00:00.000Z`);
const SHEET_TO = new Date(`${SHEET.to}T23:59:59.999Z`);
const endOfTodayUtc = () => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999));
};
const NOW = endOfTodayUtc() < SHEET_TO ? SHEET_TO : endOfTodayUtc();
const SESSION_PREFIX = 'research-heuristic-daily-2026';
const KEEP_USERNAMES = ['sonha2003', 'kiều oanh', 'kieuoanh'];
const RESTORE_KEPT = process.argv.includes('--restore-kept');
const DRY_RUN = process.argv.includes('--dry-run');

const EVENT_TYPES = [
  'hint_requested',
  'answer_checked',
  'full_answer_requested',
  'gate_completed',
  'hint_requested',
  'answer_checked',
];

const dayMs = 24 * 60 * 60 * 1000;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const levelOf = (score) => getRiskLevel(score);
const daysBetween = (from, to) => Math.floor((to - from) / dayMs);

const atDay = (dayOffset, hour = 9, minute = 0) => {
  const date = new Date(APRIL.getTime() + dayOffset * dayMs);
  date.setUTCHours(hour, minute, (dayOffset * 11) % 50, 0);
  if (date > NOW) date.setTime(NOW.getTime() - 30 * 60 * 1000);
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

const planTransitions = (students) => {
  if (students.length !== 47) {
    throw new Error(`Expected 47 roster students, found ${students.length}`);
  }
  const ordered = [...students].sort((a, b) => (a.rosterNumber || 0) - (b.rosterNumber || 0));
  return ordered.map((student, index) => {
    if (index < 6) return { student, before: 'high', after: 'low', index };
    if (index < 13) return { student, before: 'watch', after: 'low', index };
    if (index < 28) return { student, before: 'watch', after: 'watch', index };
    return { student, before: 'low', after: 'low', index };
  });
};

const sheetByDate = new Map(SHEET.days.map((day) => [day.date, day]));

const targetForDate = (isoDate) => {
  if (sheetByDate.has(isoDate)) return sheetByDate.get(isoDate);
  if (isoDate < SHEET.from) return { ...SHEET.start, date: isoDate, averageRisk: SHEET.start.barAverageRisk };
  return { ...SHEET.end, date: isoDate, averageRisk: SHEET.end.barAverageRisk };
};

/**
 * Rank students so top = more likely "high". Improvers lose rank over the sheet window.
 * Small day noise lets counts wobble like the sheet (high 6→5→6).
 */
const rankForDay = (plan, isoDate, dayOffset) => {
  const startRank = plan.before === 'high' ? 300 : plan.before === 'watch' ? 160 : 40;
  const endRank = plan.after === 'high' ? 300 : plan.after === 'watch' ? 160 : 40;
  let t = 0;
  if (isoDate <= SHEET.from) t = 0;
  else if (isoDate >= SHEET.to) t = 1;
  else t = (new Date(`${isoDate}T00:00:00.000Z`) - SHEET_FROM) / (SHEET_TO - SHEET_FROM);

  const wobble = Math.sin(dayOffset * 0.9 + plan.index * 1.7) * 8
    + Math.cos(dayOffset * 0.35 + plan.index) * 4;
  return startRank + (endRank - startRank) * t + wobble - plan.index * 0.02;
};

const assignLevels = (plans, isoDate, dayOffset, targets) => {
  const ranked = plans
    .map((plan) => ({ plan, rank: rankForDay(plan, isoDate, dayOffset) }))
    .sort((a, b) => b.rank - a.rank || a.plan.index - b.plan.index);

  const levels = new Map();
  ranked.forEach((item, position) => {
    if (position < targets.high) levels.set(item.plan.index, 'high');
    else if (position < targets.high + targets.watch) levels.set(item.plan.index, 'watch');
    else levels.set(item.plan.index, 'low');
  });
  return levels;
};

const scoreInBand = (level, index, dayOffset, pullToward) => {
  const wobble = ((index * 3 + dayOffset * 5) % 5) - 2;
  let score;
  if (level === 'high') score = clamp(78 + wobble, 61, 95);
  else if (level === 'watch') score = clamp(48 + wobble, 31, 60);
  else score = clamp(20 + wobble, 5, 30);

  if (Number.isFinite(pullToward)) {
    const delta = pullToward - score;
    score = clamp(Math.round(score + delta * 0.35), level === 'high' ? 61 : level === 'watch' ? 31 : 0, level === 'high' ? 100 : level === 'watch' ? 60 : 30);
  }
  return score;
};

const detailsFor = (type, score, seq) => {
  if (type === 'hint_requested') return { isRapid: score > 60 && seq % 4 === 0 };
  if (type === 'answer_checked') {
    return {
      isMeaningfulAttempt: score <= 55 || seq % 2 === 1,
      isCorrect: score <= 35 && seq % 3 !== 0,
    };
  }
  return {};
};

const buildAllDailyLevels = (plans) => {
  const totalDays = daysBetween(APRIL, NOW);
  const byDay = [];
  for (let day = 0; day <= totalDays; day += 1) {
    const at = atDay(day, 0, 0);
    const isoDate = at.toISOString().slice(0, 10);
    const targets = targetForDate(isoDate);
    const levels = assignLevels(plans, isoDate, day, targets);
    byDay.push({ day, isoDate, targets, levels });
  }
  return byDay;
};

const buildEvents = (plan, dailyLevels) => {
  const events = [];
  dailyLevels.forEach(({ day, isoDate, levels }) => {
    const level = levels.get(plan.index);
    const hour = 7 + ((plan.index + day) % 10);
    const minute = (plan.index * 7 + day * 3) % 55;
    const at = atDay(day, hour, minute);
    // Aim for dashboard card TB (~40→~25), not sheet bar column (78→52) which
    // cannot coexist with code thresholds while keeping Cao/Theo dõi/Thấp counts.
    let cardPull = null;
    if (isoDate <= SHEET.from) cardPull = SHEET.start.cardAverageRisk;
    else if (isoDate >= SHEET.to) cardPull = SHEET.end.cardAverageRisk;
    else {
      const t = (new Date(`${isoDate}T00:00:00.000Z`) - SHEET_FROM) / (SHEET_TO - SHEET_FROM);
      cardPull = SHEET.start.cardAverageRisk + (SHEET.end.cardAverageRisk - SHEET.start.cardAverageRisk) * t;
    }
    const score = scoreInBand(level, plan.index, day, cardPull);
    const type = EVENT_TYPES[(plan.index + day) % EVENT_TYPES.length];
    events.push(event(type, at, score, detailsFor(type, score, day)));
  });
  return events;
};

const stripSeededRange = (events = []) =>
  events.filter((item) => {
    const at = new Date(item.at);
    return Number.isNaN(at.getTime()) || at < APRIL || at > NOW;
  });

const snapshotDay = (plansWithEvents, isoDate) => {
  const counts = { high: 0, watch: 0, low: 0 };
  let scoreTotal = 0;
  let scored = 0;
  plansWithEvents.forEach(({ events }) => {
    const onDay = events.filter((item) => new Date(item.at).toISOString().slice(0, 10) === isoDate);
    if (!onDay.length) return;
    const latest = [...onDay].sort((a, b) => new Date(b.at) - new Date(a.at))[0];
    counts[levelOf(latest.riskScore)] += 1;
    scoreTotal += latest.riskScore;
    scored += 1;
  });
  return {
    date: isoDate,
    ...counts,
    total: counts.high + counts.watch + counts.low,
    averageRisk: scored ? Math.round(scoreTotal / scored) : 0,
  };
};

const compareSheetDays = (plansWithEvents) =>
  SHEET.days.map((day) => {
    const actual = snapshotDay(plansWithEvents, day.date);
    return {
      date: day.date,
      expected: { high: day.high, watch: day.watch, low: day.low, averageRisk: day.averageRisk },
      actual,
      countsMatch: actual.high === day.high && actual.watch === day.watch && actual.low === day.low,
      avgDelta: actual.averageRisk - Math.round(day.averageRisk),
    };
  });

const main = async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const users = db.collection('users');
  const conversations = db.collection('conversations');

  if (RESTORE_KEPT) {
    const restored = await users.updateMany(
      { username: { $in: KEEP_USERNAMES } },
      { $set: { rosterStatus: 'current-account' } },
    );
    console.log(JSON.stringify({ restoredKeptAccounts: restored.modifiedCount }, null, 2));
    return;
  }

  const kept = DRY_RUN
    ? { modifiedCount: 0 }
    : await users.updateMany(
      { username: { $in: KEEP_USERNAMES }, rosterStatus: { $in: ['current-account', 'kept-account'] } },
      { $set: { rosterStatus: 'kept-account' } },
    );

  const rosterStudents = await users
    .find({ role: { $ne: 'admin' }, rosterStatus: 'current' })
    .project({ _id: 1, name: 1, username: 1, rosterNumber: 1 })
    .toArray();

  const plans = planTransitions(rosterStudents);
  const dailyLevels = buildAllDailyLevels(plans);
  const finalPlans = plans.map((plan) => ({
    ...plan,
    events: buildEvents(plan, dailyLevels),
  }));

  const finalCompare = compareSheetDays(finalPlans);
  const failed = finalCompare.filter((row) => !row.countsMatch);
  if (failed.length) {
    throw new Error(`Sheet day count mismatch on ${failed.length} days: ${JSON.stringify(failed.slice(0, 3))}`);
  }

  const startSnap = snapshotDay(finalPlans, SHEET.from);
  const endSnap = snapshotDay(finalPlans, SHEET.to);
  const verified = {
    before: { high: startSnap.high, watch: startSnap.watch, low: startSnap.low },
    after: { high: endSnap.high, watch: endSnap.watch, low: endSnap.low },
  };
  if (
    verified.before.high !== 6
    || verified.before.watch !== 22
    || verified.before.low !== 19
    || verified.after.high !== 0
    || verified.after.watch !== 15
    || verified.after.low !== 32
  ) {
    throw new Error(`Sheet window mismatch: ${JSON.stringify(verified)}`);
  }

  const sampleCompare = finalCompare.filter((row) =>
    ['2026-04-25', '2026-05-16', '2026-05-25'].includes(row.date));

  if (DRY_RUN) {
    console.log(JSON.stringify({
      ok: true,
      dryRun: true,
      days: daysBetween(APRIL, NOW) + 1,
      sheetDaysMatched: finalCompare.length,
      verifiedSheetWindow: verified,
      sampleCompare,
      note: 'Bar averageRisk trong sheet (78→52) không khả thi với ngưỡng code (>60/>30) khi giữ đúng count; card TB ~40→~25 mới khớp band.',
    }, null, 2));
    return;
  }

  await conversations.deleteMany({ sessionId: { $regex: '^research-heuristic-' } });

  let createdConversations = 0;
  let strippedOther = 0;

  for (const plan of finalPlans) {
    const { student, before, after, index, events } = plan;
    const latest = [...events].sort((a, b) => new Date(b.at) - new Date(a.at))[0];
    const subjectArea = ['mathematics', 'natural_sciences', 'english_language'][index % 3];
    const peak = Math.max(...events.map((item) => item.riskScore));
    const sessionId = `${SESSION_PREFIX}-${String(student._id)}`;

    const existing = await conversations.find({ user: student._id }).toArray();
    for (const conversation of existing) {
      const nextEvents = stripSeededRange(conversation.dependencyEvents || []);
      if (nextEvents.length !== (conversation.dependencyEvents || []).length) {
        await conversations.updateOne(
          { _id: conversation._id },
          { $set: { dependencyEvents: nextEvents, updatedAt: new Date() } },
        );
        strippedOther += 1;
      }
    }

    await conversations.insertOne({
      sessionId,
      user: student._id,
      educationLevel: 'middle',
      subjectArea,
      course: subjectArea === 'english_language' ? 'english_language' : subjectArea,
      title: 'Timeline hàng ngày can thiệp đi tắt nhận thức',
      messages: [],
      dependencyEvents: events,
      interventionMetrics: {
        rulesetVersion: 'v2',
        riskScore: latest.riskScore,
        riskLevel: latest.riskLevel,
        lastRiskScore: latest.riskScore,
        lastRiskLevel: latest.riskLevel,
        hintRequests: events.filter((item) => item.type === 'hint_requested').length,
        fullAnswerRequests: events.filter((item) => item.type === 'full_answer_requested').length,
        answerAttempts: events.filter((item) => item.type === 'answer_checked').length,
        meaningfulAttempts: events.filter((item) => item.details?.isMeaningfulAttempt).length,
        correctAnswers: events.filter((item) => item.details?.isCorrect).length,
        gateCompletions: events.filter((item) => item.type === 'gate_completed').length,
      },
      createdAt: events[0].at,
      updatedAt: latest.at,
      __v: 0,
    });
    createdConversations += 1;

    await users.updateOne(
      { _id: student._id },
      {
        $set: {
          analyticsDemo: {
            version: 8,
            seededAt: new Date(),
            baselineScore: peak,
            currentScore: latest.riskScore,
            riskLevel: latest.riskLevel,
            educationLevel: 'middle',
            subjectArea,
            timeline: { from: APRIL, to: NOW },
            sheetWindow: { from: SHEET_FROM, to: SHEET_TO, source: path.basename(SHEET.from ? 'sheet-8-2-30-days.json' : '') },
            transition: { before, after },
            dailyEvents: events.length,
          },
          updatedAt: new Date(),
        },
      },
    );
  }

  console.log(JSON.stringify({
    ok: true,
    n: finalPlans.length,
    days: daysBetween(APRIL, NOW) + 1,
    timeline: { from: APRIL.toISOString(), to: NOW.toISOString() },
    sheetWindow: { from: SHEET.from, to: SHEET.to },
    verifiedSheetWindow: verified,
    sheetDaysMatched: finalCompare.filter((row) => row.countsMatch).length,
    sampleCompare,
    keptAccountsHidden: kept.modifiedCount,
    createdConversations,
    strippedOtherConversations: strippedOther,
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
