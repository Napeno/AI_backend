/**
 * Seed research analytics for class 8.2 so admin dashboard matches:
 * Phân loại mức độ đi tắt nhận thức trước và sau can thiệp (n = 47)
 *
 * Before: Cao 6 / Trung bình 22 / Thấp 19
 * After:  Cao 0 / Trung bình 15 / Thấp 32
 * Window: 2026-08-22 → 2026-09-22
 *
 * Usage:
 *   node scripts/seed-heuristic-research.js
 *   node scripts/seed-heuristic-research.js --restore-kept
 */
require('dotenv').config();
const mongoose = require('mongoose');
const { getRiskLevel } = require('../src/services/intervention.service');

const FROM = new Date('2026-08-22T00:00:00.000Z');
const TO = new Date('2026-09-22T23:59:59.999Z');
const SESSION_PREFIX = 'research-heuristic-2026-08-22';
const KEEP_USERNAMES = ['sonha2003', 'kiều oanh', 'kieuoanh'];
const RESTORE_KEPT = process.argv.includes('--restore-kept');

const SCORE = {
  high: 78,
  watch: 48,
  low: 18,
};

const levelOf = (score) => getRiskLevel(score);

const atDay = (dayOffset, hour = 9, minute = 0) => {
  const date = new Date(FROM);
  date.setUTCDate(date.getUTCDate() + dayOffset);
  date.setUTCHours(hour, minute, 0, 0);
  if (date > TO) date.setTime(TO.getTime() - 60 * 60 * 1000);
  return date;
};

const event = (type, at, riskScore, details = {}) => ({
  type,
  at,
  riskScore,
  riskLevel: levelOf(riskScore),
  deltaScore: 0,
  rulesetVersion: 'v2',
  details,
});

/**
 * Transitions (stable for n=47):
 * - 6 high → low
 * - 7 watch → low
 * - 15 watch → watch
 * - 19 low → low
 * After: high 0, watch 15, low 32
 */
const planTransitions = (students) => {
  if (students.length !== 47) {
    throw new Error(`Expected 47 roster students, found ${students.length}`);
  }
  const ordered = [...students].sort((a, b) => (a.rosterNumber || 0) - (b.rosterNumber || 0));
  return ordered.map((student, index) => {
    if (index < 6) return { student, before: 'high', after: 'low' };
    if (index < 13) return { student, before: 'watch', after: 'low' };
    if (index < 28) return { student, before: 'watch', after: 'watch' };
    return { student, before: 'low', after: 'low' };
  });
};

const buildEvents = (before, after, index) => {
  const beforeScore = SCORE[before];
  const afterScore = SCORE[after];
  const jitter = index % 5;
  const early = beforeScore + (jitter % 3);
  const mid = Math.round((beforeScore + afterScore) / 2);
  const late = afterScore - (index % 2);
  const subjectHour = 8 + (index % 6);

  const events = [
    event('hint_requested', atDay(1 + (index % 4), subjectHour, 10), early, { isRapid: before === 'high' }),
    event('full_answer_requested', atDay(3 + (index % 3), subjectHour + 1, 5), early, {}),
    event('answer_checked', atDay(8 + (index % 5), subjectHour, 20), mid, {
      isMeaningfulAttempt: before !== 'high',
      isCorrect: false,
    }),
  ];

  if (before !== after || before === 'watch') {
    events.push(
      event('gate_completed', atDay(16 + (index % 4), subjectHour, 40), Math.max(afterScore, mid - 8), {}),
    );
  }

  events.push(
    event('answer_checked', atDay(24 + (index % 5), subjectHour, 15), late + 4, {
      isMeaningfulAttempt: true,
      isCorrect: after === 'low',
    }),
    event('answer_checked', atDay(28 + (index % 3), subjectHour + 1, 30), late, {
      isMeaningfulAttempt: true,
      isCorrect: true,
    }),
  );

  if (after === 'low') {
    events.push(
      event('gate_completed', atDay(30 + (index % 2), subjectHour, 50), late, {}),
    );
  } else {
    events.push(
      event('hint_requested', atDay(29, subjectHour, 12), late + 2, { isRapid: false }),
    );
  }

  return events.sort((a, b) => new Date(a.at) - new Date(b.at));
};

const stripWindowEvents = (events = []) =>
  events.filter((item) => {
    const at = new Date(item.at);
    return Number.isNaN(at.getTime()) || at < FROM || at > TO;
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
    { username: { $in: KEEP_USERNAMES }, rosterStatus: 'current-account' },
    { $set: { rosterStatus: 'kept-account' } },
  );

  const rosterStudents = await users
    .find({ role: { $ne: 'admin' }, rosterStatus: 'current' })
    .project({ _id: 1, name: 1, username: 1, rosterNumber: 1 })
    .toArray();

  const plans = planTransitions(rosterStudents);
  const expected = summarize(plans);

  let updatedConversations = 0;
  let createdConversations = 0;
  let strippedOther = 0;

  for (let index = 0; index < plans.length; index += 1) {
    const { student, before, after } = plans[index];
    const events = buildEvents(before, after, index);
    const latest = events[events.length - 1];
    const subjectArea = ['mathematics', 'natural_sciences', 'english_language'][index % 3];
    const peak = Math.max(...events.map((item) => item.riskScore));

    const existing = await conversations.find({ user: student._id }).toArray();
    const sessionId = `${SESSION_PREFIX}-${String(student._id)}`;
    for (const conversation of existing) {
      if (conversation.sessionId === sessionId) continue;
      const nextEvents = stripWindowEvents(conversation.dependencyEvents || []);
      if (nextEvents.length !== (conversation.dependencyEvents || []).length) {
        await conversations.updateOne(
          { _id: conversation._id },
          { $set: { dependencyEvents: nextEvents, updatedAt: new Date() } },
        );
        strippedOther += 1;
      }
    }

    const researchDoc = {
      sessionId,
      user: student._id,
      educationLevel: 'middle',
      subjectArea,
      course: subjectArea === 'english_language' ? 'english_language' : subjectArea,
      title: 'Can thiệp đi tắt nhận thức (nghiên cứu)',
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
      updatedAt: latest.at,
      createdAt: events[0].at,
    };

    const result = await conversations.updateOne(
      { user: student._id, sessionId },
      { $set: researchDoc, $setOnInsert: { __v: 0 } },
      { upsert: true },
    );
    if (result.upsertedCount) createdConversations += 1;
    else updatedConversations += 1;

    await users.updateOne(
      { _id: student._id },
      {
        $set: {
          analyticsDemo: {
            version: 4,
            seededAt: new Date(),
            baselineScore: peak,
            currentScore: latest.riskScore,
            riskLevel: latest.riskLevel,
            educationLevel: 'middle',
            subjectArea,
            researchWindow: { from: FROM, to: TO },
            transition: { before, after },
            events,
          },
          updatedAt: new Date(),
        },
      },
    );
  }

  console.log(JSON.stringify({
    ok: true,
    n: plans.length,
    window: { from: FROM.toISOString(), to: TO.toISOString() },
    expected,
    keptAccountsHidden: kept.modifiedCount,
    createdConversations,
    updatedConversations,
    strippedOtherConversations: strippedOther,
    note: 'Filter admin from 2026-08-22 to 2026-09-22. Restore kept accounts with --restore-kept.',
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
