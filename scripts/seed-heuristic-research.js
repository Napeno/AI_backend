/**
 * Seed daily class snapshots from April → now with:
 * - continuous day-to-day fluctuation (ups & downs)
 * - overall improving trend
 * - research window 22/08 → 22/09 landing on:
 *     before: Cao 6 / TB 22 / Thấp 19
 *     after:  Cao 0 / TB 15 / Thấp 32
 *
 * Usage:
 *   node scripts/seed-heuristic-research.js
 *   node scripts/seed-heuristic-research.js --restore-kept
 */
require('dotenv').config();
const mongoose = require('mongoose');
const { getRiskLevel } = require('../src/services/intervention.service');

const APRIL = new Date('2026-04-01T00:00:00.000Z');
const RESEARCH_FROM = new Date('2026-08-22T00:00:00.000Z');
const RESEARCH_TO = new Date('2026-09-22T23:59:59.999Z');
const endOfTodayUtc = () => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999));
};
const NOW = endOfTodayUtc() < RESEARCH_TO ? RESEARCH_TO : endOfTodayUtc();
const SESSION_PREFIX = 'research-heuristic-daily-2026';
const KEEP_USERNAMES = ['sonha2003', 'kiều oanh', 'kieuoanh'];
const RESTORE_KEPT = process.argv.includes('--restore-kept');

const SCORE = { high: 78, watch: 48, low: 20 };
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
const lerp = (from, to, t) => from + (to - from) * t;
const levelOf = (score) => getRiskLevel(score);
const daysBetween = (from, to) => Math.floor((to - from) / dayMs);
const easeSmooth = (t) => t * t * (3 - 2 * t);

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

const scoreInBand = (level, index, phase) => {
  const wobble = ((index * 3 + phase * 5) % 5) - 2;
  if (level === 'high') return clamp(SCORE.high + wobble, 66, 92);
  if (level === 'watch') return clamp(SCORE.watch + wobble, 34, 58);
  return clamp(SCORE.low + wobble, 8, 28);
};

const bandCeiling = (level) => (level === 'high' ? 95 : level === 'watch' ? 60 : 30);
const bandFloor = (level) => (level === 'high' ? 61 : level === 'watch' ? 31 : 0);

const aprilStartFor = (before, index) => {
  if (before === 'high') return 90 - (index % 4);
  if (before === 'watch') return 78 - (index % 5);
  return 62 - (index % 6);
};

/** Deterministic noise in [-1, 1]. */
const noise11 = (index, day) => {
  const x = Math.sin(index * 12.9898 + day * 78.233) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
};

/**
 * Trend + ups/downs. Anchors:
 * - Aug 22 → exact "before" band
 * - Sep 22 → exact "after" band
 * Research-window scores stay within before/after bands so baseline/latest classification matches the table.
 */
const scoreForMoment = (at, before, after, index) => {
  const day = daysBetween(APRIL, at);
  const researchStartDay = daysBetween(APRIL, RESEARCH_FROM);
  const researchEndDay = daysBetween(APRIL, RESEARCH_TO);
  const beforeScore = scoreInBand(before, index, 1);
  const afterScore = scoreInBand(after, index, 2);
  const aprilStart = aprilStartFor(before, index);

  if (day === researchStartDay) return beforeScore;
  if (day === researchEndDay) return afterScore;

  let trend;
  if (day < researchStartDay) {
    const local = clamp(day / Math.max(1, researchStartDay), 0, 1);
    trend = lerp(aprilStart, beforeScore, easeSmooth(local ** 0.85));
  } else if (day < researchEndDay) {
    const stagger = (index % 12) / 14;
    const span = Math.max(1, researchEndDay - researchStartDay);
    const raw = (day - researchStartDay) / span;
    const u = clamp((raw - stagger * 0.55) / (1 - stagger * 0.35), 0, 1);
    trend = lerp(beforeScore, afterScore, easeSmooth(u));
  } else {
    const postSpan = Math.max(1, daysBetween(RESEARCH_TO, NOW));
    const post = clamp((day - researchEndDay) / postSpan, 0, 1);
    trend = lerp(afterScore, Math.max(6, afterScore - 5), easeSmooth(post));
  }

  const wave =
    Math.sin(day / 2.7 + index * 0.63) * 9 +
    Math.sin(day / 6.1 + index * 1.1) * 5 +
    Math.cos(day / 11 + index * 0.4) * 3;
  const jitter = noise11(index, day) * 7;
  const pulse = ((day * 5 + index * 9) % 13 === 0) ? 10 : ((day * 5 + index * 9) % 13 === 7) ? -8 : 0;
  let score = Math.round(trend + wave + jitter + pulse);

  // Keep research-window max/min inside the student's before→after corridor
  // so table before/after counts stay exact, while daily values still wobble.
  if (day >= researchStartDay && day <= researchEndDay) {
    const upper = Math.max(bandCeiling(before), bandCeiling(after));
    const lower = Math.min(bandFloor(before), bandFloor(after));
    score = clamp(score, lower, upper);
  } else {
    score = clamp(score, 0, 100);
  }

  return score;
};

const detailsFor = (type, score, index, seq) => {
  if (type === 'hint_requested') return { isRapid: score > 60 && seq % 4 === 0 };
  if (type === 'answer_checked') {
    return {
      isMeaningfulAttempt: score <= 55 || seq % 2 === 1,
      isCorrect: score <= 35 && seq % 3 !== 0,
    };
  }
  return {};
};

const buildEvents = (before, after, index) => {
  const totalDays = daysBetween(APRIL, NOW);
  const events = [];

  for (let day = 0; day <= totalDays; day += 1) {
    const hour = 7 + ((index + day) % 10);
    const minute = (index * 7 + day * 3) % 55;
    const at = atDay(day, hour, minute);
    const score = scoreForMoment(at, before, after, index);
    const type = EVENT_TYPES[(index + day) % EVENT_TYPES.length];
    events.push(event(type, at, score, detailsFor(type, score, index, day)));
  }

  // Extra peak early in research window so baseline (max) stays in "before" band
  // even if later days are lower — needed for research table before counts.
  const earlyExtra = daysBetween(APRIL, RESEARCH_FROM) + 1;
  events.push(
    event(
      'hint_requested',
      atDay(earlyExtra, 8, 5 + (index % 20)),
      scoreInBand(before, index, 3),
      detailsFor('hint_requested', SCORE[before], index, 900),
    ),
    event(
      'answer_checked',
      atDay(daysBetween(APRIL, RESEARCH_TO), 18, 10 + (index % 20)),
      scoreInBand(after, index, 4),
      detailsFor('answer_checked', SCORE[after], index, 901),
    ),
  );

  return events.sort((a, b) => new Date(a.at) - new Date(b.at));
};

const stripSeededRange = (events = []) =>
  events.filter((item) => {
    const at = new Date(item.at);
    return Number.isNaN(at.getTime()) || at < APRIL || at > NOW;
  });

const classifyResearchWindow = (plansWithEvents) => {
  const before = { high: 0, watch: 0, low: 0 };
  const after = { high: 0, watch: 0, low: 0 };
  plansWithEvents.forEach(({ events }) => {
    const inWindow = events.filter((item) => {
      const at = new Date(item.at);
      return at >= RESEARCH_FROM && at <= RESEARCH_TO;
    });
    const maxScore = Math.max(...inWindow.map((item) => item.riskScore));
    const latestScore = [...inWindow].sort((a, b) => new Date(b.at) - new Date(a.at))[0].riskScore;
    before[levelOf(maxScore)] += 1;
    after[levelOf(latestScore)] += 1;
  });
  return { before, after };
};

const dailySnapshot = (plansWithEvents, dayOffset) => {
  const counts = { high: 0, watch: 0, low: 0 };
  const dayStart = atDay(dayOffset, 0, 0);
  const dayKey = dayStart.toISOString().slice(0, 10);
  plansWithEvents.forEach(({ events }) => {
    const onDay = events.filter((item) => new Date(item.at).toISOString().slice(0, 10) === dayKey);
    if (!onDay.length) return;
    const latest = [...onDay].sort((a, b) => new Date(b.at) - new Date(a.at))[0];
    counts[levelOf(latest.riskScore)] += 1;
  });
  return { day: dayKey, ...counts, total: counts.high + counts.watch + counts.low };
};

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

  const kept = await users.updateMany(
    { username: { $in: KEEP_USERNAMES }, rosterStatus: { $in: ['current-account', 'kept-account'] } },
    { $set: { rosterStatus: 'kept-account' } },
  );

  await conversations.deleteMany({ sessionId: { $regex: '^research-heuristic-' } });

  const rosterStudents = await users
    .find({ role: { $ne: 'admin' }, rosterStatus: 'current' })
    .project({ _id: 1, name: 1, username: 1, rosterNumber: 1 })
    .toArray();

  const plans = planTransitions(rosterStudents);
  const plansWithEvents = plans.map((plan) => ({
    ...plan,
    events: buildEvents(plan.before, plan.after, plan.index),
  }));
  const verified = classifyResearchWindow(plansWithEvents);

  if (
    verified.before.high !== 6 ||
    verified.before.watch !== 22 ||
    verified.before.low !== 19 ||
    verified.after.high !== 0 ||
    verified.after.watch !== 15 ||
    verified.after.low !== 32
  ) {
    throw new Error(`Research window mismatch: ${JSON.stringify(verified)}`);
  }

  const sampleDays = [
    0,
    30,
    60,
    daysBetween(APRIL, RESEARCH_FROM),
    daysBetween(APRIL, RESEARCH_FROM) + 7,
    daysBetween(APRIL, RESEARCH_FROM) + 15,
    daysBetween(APRIL, RESEARCH_TO),
    daysBetween(APRIL, NOW),
  ].map((day) => dailySnapshot(plansWithEvents, day));

  let createdConversations = 0;
  let strippedOther = 0;

  for (const plan of plansWithEvents) {
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
            version: 7,
            seededAt: new Date(),
            baselineScore: peak,
            currentScore: latest.riskScore,
            riskLevel: latest.riskLevel,
            educationLevel: 'middle',
            subjectArea,
            timeline: { from: APRIL, to: NOW },
            researchWindow: { from: RESEARCH_FROM, to: RESEARCH_TO },
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
    n: plans.length,
    days: daysBetween(APRIL, NOW) + 1,
    timeline: { from: APRIL.toISOString(), to: NOW.toISOString() },
    verifiedResearchWindow: verified,
    sampleDays,
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
