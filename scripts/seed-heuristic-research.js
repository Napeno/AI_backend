/**
 * Seed class 8.2 analytics with a smooth April → now decline, messy day spread,
 * and Aug 22–Sep 22 before/after levels matching the research table (n = 47):
 *
 * Before: Cao 6 / Trung bình 22 / Thấp 19
 * After:  Cao 0 / Trung bình 15 / Thấp 32
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
const NOW = RESEARCH_TO;
const SESSION_PREFIX = 'research-heuristic-timeline-2026';
const KEEP_USERNAMES = ['sonha2003', 'kiều oanh', 'kieuoanh'];
const RESTORE_KEPT = process.argv.includes('--restore-kept');

const SCORE = {
  high: 78,
  watch: 48,
  low: 20,
};

const EVENT_TYPES = [
  'hint_requested',
  'full_answer_requested',
  'answer_checked',
  'gate_completed',
  'hint_requested',
  'answer_checked',
];

const dayMs = 24 * 60 * 60 * 1000;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const lerp = (from, to, t) => from + (to - from) * t;
const levelOf = (score) => getRiskLevel(score);
const daysBetween = (from, to) => Math.floor((to - from) / dayMs);

const atDay = (start, dayOffset, hour = 9, minute = 0) => {
  const date = new Date(start.getTime() + dayOffset * dayMs);
  date.setUTCHours(hour, minute, (dayOffset * 7) % 50, 0);
  if (date > NOW) date.setTime(NOW.getTime() - 30 * 60 * 1000);
  if (date < APRIL) date.setTime(APRIL.getTime() + 60 * 60 * 1000);
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

/**
 * Transitions (n = 47):
 * - 6 high → low
 * - 7 watch → low
 * - 15 watch → watch
 * - 19 low → low
 */
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

const aprilStartFor = (before, index) => {
  if (before === 'high') return 90 - (index % 4);
  if (before === 'watch') return 72 - (index % 5);
  return 58 - (index % 6);
};

const targetScore = (level, index, phase) => {
  const base = SCORE[level];
  const wobble = ((index * 3 + phase * 5) % 5) - 2;
  if (level === 'high') return clamp(base + wobble, 61, 95);
  if (level === 'watch') return clamp(base + wobble, 31, 60);
  return clamp(base + wobble, 5, 30);
};

const progressAt = (at) => (at - APRIL.getTime()) / (NOW.getTime() - APRIL.getTime());
const researchProgressAt = (at) =>
  (at - RESEARCH_FROM.getTime()) / (RESEARCH_TO.getTime() - RESEARCH_FROM.getTime());

const scoreForMoment = (at, before, after, index) => {
  const t = clamp(progressAt(at), 0, 1);
  const aprilStart = aprilStartFor(before, index);
  const beforeScore = targetScore(before, index, 1);
  const afterScore = targetScore(after, index, 2);

  if (at < RESEARCH_FROM) {
    const local = t / progressAt(RESEARCH_FROM);
    // Decline from April peak toward the research "before" level.
    return Math.round(lerp(aprilStart, beforeScore, local ** 0.85));
  }

  const u = clamp(researchProgressAt(at), 0, 1);
  // Inside research window: move from before → after.
  return Math.round(lerp(beforeScore, afterScore, u ** 1.1));
};

const detailsFor = (type, score, index, seq) => {
  if (type === 'hint_requested') {
    return { isRapid: score > 60 && seq % 3 === 0 };
  }
  if (type === 'answer_checked') {
    return {
      isMeaningfulAttempt: score <= 55 || seq % 2 === 1,
      isCorrect: score <= 35 && seq % 2 === 0,
    };
  }
  return {};
};

const pickDays = (count, index) => {
  const totalDays = daysBetween(APRIL, NOW);
  const days = new Set();

  // Anchor points so charts have coverage in every month and research window.
  const anchors = [
    2 + (index % 5),
    20 + (index % 7),
    45 + (index % 9),
    70 + (index % 6),
    95 + (index % 8),
    daysBetween(APRIL, RESEARCH_FROM) + 1 + (index % 4),
    daysBetween(APRIL, RESEARCH_FROM) + 10 + (index % 5),
    daysBetween(APRIL, RESEARCH_FROM) + 20 + (index % 6),
    totalDays - 3 - (index % 4),
    totalDays - 1,
  ];
  anchors.forEach((day) => days.add(clamp(day, 0, totalDays)));

  for (let i = 0; i < count; i += 1) {
    const even = Math.round((i / Math.max(count - 1, 1)) * totalDays);
    const messy = ((index * 19 + i * 11) % 9) - 4;
    days.add(clamp(even + messy, 0, totalDays));
  }

  return [...days].sort((a, b) => a - b);
};

const buildEvents = (before, after, index) => {
  const eventCount = 20 + (index % 8);
  const days = pickDays(eventCount, index);
  const events = days.map((dayOffset, seq) => {
    const hour = 7 + ((index + seq) % 10);
    const minute = (index * 7 + seq * 13) % 55;
    const at = atDay(APRIL, dayOffset, hour, minute);
    const score = scoreForMoment(at, before, after, index);
    const type = EVENT_TYPES[(index + seq) % EVENT_TYPES.length];
    return event(type, at, score, detailsFor(type, score, index, seq));
  });

  // Hard anchors inside research window so before/after levels are exact.
  const earlyResearch = atDay(
    RESEARCH_FROM,
    1 + (index % 5),
    8 + (index % 5),
    10 + (index % 20),
  );
  const lateResearch = atDay(
    RESEARCH_FROM,
    daysBetween(RESEARCH_FROM, RESEARCH_TO) - (index % 3),
    15 + (index % 4),
    20 + (index % 25),
  );
  events.push(
    event(
      'hint_requested',
      earlyResearch,
      targetScore(before, index, 3),
      detailsFor('hint_requested', SCORE[before], index, 90),
    ),
    event(
      'answer_checked',
      lateResearch,
      targetScore(after, index, 4),
      detailsFor('answer_checked', SCORE[after], index, 91),
    ),
  );

  return events
    .sort((a, b) => new Date(a.at) - new Date(b.at))
    .filter((item, pos, list) => {
      if (pos === 0) return true;
      return new Date(item.at).getTime() !== new Date(list[pos - 1].at).getTime();
    });
};

const stripSeededRange = (events = []) =>
  events.filter((item) => {
    const at = new Date(item.at);
    return Number.isNaN(at.getTime()) || at < APRIL || at > NOW;
  });

const summarize = (plans) => {
  const before = { high: 0, watch: 0, low: 0 };
  const after = { high: 0, watch: 0, low: 0 };
  plans.forEach((plan) => {
    before[plan.before] += 1;
    after[plan.after] += 1;
  });
  return { before, after };
};

const classifyPlansFromEvents = (plansWithEvents) => {
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

  // Remove previous research conversation batches.
  await conversations.deleteMany({
    sessionId: { $regex: '^research-heuristic-' },
  });

  const rosterStudents = await users
    .find({ role: { $ne: 'admin' }, rosterStatus: 'current' })
    .project({ _id: 1, name: 1, username: 1, rosterNumber: 1 })
    .toArray();

  const plans = planTransitions(rosterStudents);
  const expected = summarize(plans);
  const plansWithEvents = plans.map((plan) => ({
    ...plan,
    events: buildEvents(plan.before, plan.after, plan.index),
  }));
  const verified = classifyPlansFromEvents(plansWithEvents);

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
      title: 'Timeline can thiệp đi tắt nhận thức',
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
            version: 5,
            seededAt: new Date(),
            baselineScore: peak,
            currentScore: latest.riskScore,
            riskLevel: latest.riskLevel,
            educationLevel: 'middle',
            subjectArea,
            timeline: { from: APRIL, to: NOW },
            researchWindow: { from: RESEARCH_FROM, to: RESEARCH_TO },
            transition: { before, after },
          },
          updatedAt: new Date(),
        },
      },
    );
  }

  console.log(JSON.stringify({
    ok: true,
    n: plans.length,
    timeline: { from: APRIL.toISOString(), to: NOW.toISOString() },
    researchWindow: { from: RESEARCH_FROM.toISOString(), to: RESEARCH_TO.toISOString() },
    expected,
    verifiedResearchWindow: verified,
    keptAccountsHidden: kept.modifiedCount,
    createdConversations,
    strippedOtherConversations: strippedOther,
    note: 'Filter 2026-08-22 → 2026-09-22 for research table. Broader filters show April→now decline.',
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
