/**
 * Unified cohort 179: HS001–HS047 = pilot lớp 8.2 ⊂ 179.
 * Timeline:
 *   01/04 → 24/04: warm-up thưa (core 47)
 *   25/04 → 25/05: khớp count Cao/Theo dõi/Thấp sheet 8.2 (core 47)
 *   26/05 → 27/08: bridge random-walk về điểm first-sheet
 *   28/08 → 01/11: đúng điểm/hoạt động sheet 179
 * HS048–HS179: chỉ event từ ngày first-score trong sheet 179.
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
const SHEET_82 = require('./data/sheet-8-2-30-days.json');

const DRY_RUN = process.argv.includes('--dry-run');
const PURGE = process.argv.includes('--purge');
const SESSION_PREFIX = 'sim-179-daily-2026';
const ROSTER_STATUS = 'sim-179';
const CLASS_NAME = 'sim-179';
const HISTORY_FROM = '2026-04-01';
const BRIDGE_TO = '2026-08-27';
const PILOT_COUNT = 47;
const dayMs = 24 * 60 * 60 * 1000;

const EVENT_TYPES = [
  'hint_requested',
  'answer_checked',
  'full_answer_requested',
  'gate_completed',
];

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const levelOf = (score) => getRiskLevel(score);
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

const detailsFor = (type, score, seq, extra = {}) => {
  const base = { ...extra };
  if (type === 'hint_requested') return { ...base, isRapid: score > 60 && seq % 4 === 0 };
  if (type === 'answer_checked') {
    return {
      ...base,
      isMeaningfulAttempt: score <= 55 || seq % 2 === 1,
      isCorrect: score <= 35 && seq % 3 !== 0,
    };
  }
  return base;
};

const sheet82ByDate = new Map(SHEET_82.days.map((day) => [day.date, day]));
const SHEET_82_FROM = new Date(`${SHEET_82.from}T00:00:00.000Z`);
const SHEET_82_TO = new Date(`${SHEET_82.to}T23:59:59.999Z`);

const pilotTransitions = (codes) => {
  if (codes.length !== PILOT_COUNT) {
    throw new Error(`Expected ${PILOT_COUNT} pilot codes, found ${codes.length}`);
  }
  return codes.map((code, index) => {
    if (index < 6) return { code, before: 'high', after: 'low', index };
    if (index < 13) return { code, before: 'watch', after: 'low', index };
    if (index < 28) return { code, before: 'watch', after: 'watch', index };
    return { code, before: 'low', after: 'low', index };
  });
};

const rankForDay = (plan, isoDate, dayOffset) => {
  const startRank = plan.before === 'high' ? 300 : plan.before === 'watch' ? 160 : 40;
  const endRank = plan.after === 'high' ? 300 : plan.after === 'watch' ? 160 : 40;
  let t = 0;
  if (isoDate <= SHEET_82.from) t = 0;
  else if (isoDate >= SHEET_82.to) t = 1;
  else t = (new Date(`${isoDate}T00:00:00.000Z`) - SHEET_82_FROM) / (SHEET_82_TO - SHEET_82_FROM);
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
    score = clamp(
      Math.round(score + delta * 0.35),
      level === 'high' ? 61 : level === 'watch' ? 31 : 0,
      level === 'high' ? 100 : level === 'watch' ? 60 : 30,
    );
  }
  return score;
};

const target82ForDate = (isoDate) => {
  if (sheet82ByDate.has(isoDate)) return sheet82ByDate.get(isoDate);
  return {
    date: isoDate,
    high: SHEET_82.end.high,
    watch: SHEET_82.end.watch,
    low: SHEET_82.end.low,
    averageRisk: SHEET_82.end.barAverageRisk,
    total: 47,
  };
};

/** Warm-up 01/04→24/04: sparse activity for core. */
const buildWarmupEvents = (studentCode, index) => {
  const dates = listDates(HISTORY_FROM, '2026-04-24');
  const events = [];
  let score = clamp(55 + Math.floor(unitNoise(index, 1) * 20), 35, 75);
  dates.forEach((isoDate, dayIndex) => {
    const day = new Date(`${isoDate}T00:00:00.000Z`);
    const isWeekend = day.getUTCDay() === 0 || day.getUTCDay() === 6;
    const chance = isWeekend ? 0.12 : 0.28;
    if (unitNoise(index, dayIndex + 3) >= chance) return;
    score = clamp(score + Math.round((unitNoise(index, dayIndex + 9) - 0.5) * 8), 20, 85);
    const type = EVENT_TYPES[(index + dayIndex) % EVENT_TYPES.length];
    const hour = 8 + ((index + dayIndex) % 8);
    const minute = (index * 5 + dayIndex * 3) % 55;
    events.push(event(type, atDate(isoDate, hour, minute, index), score, detailsFor(type, score, dayIndex, {
      usedApp: true,
      sheetCode: studentCode,
      pilot82: true,
      phase: 'warmup',
    })));
  });
  return events;
};

/** 25/04→25/05: match sheet 8.2 counts (code thresholds). */
const buildPilot82Events = (plans) => {
  const dates = listDates(SHEET_82.from, SHEET_82.to);
  const byCode = new Map(plans.map((plan) => [plan.code, []]));
  dates.forEach((isoDate, dayOffset) => {
    const targets = target82ForDate(isoDate);
    const levels = assignLevels(plans, isoDate, dayOffset, targets);
    let cardPull = SHEET_82.start.cardAverageRisk;
    if (isoDate >= SHEET_82.to) cardPull = SHEET_82.end.cardAverageRisk;
    else if (isoDate > SHEET_82.from) {
      const t = (new Date(`${isoDate}T00:00:00.000Z`) - SHEET_82_FROM) / (SHEET_82_TO - SHEET_82_FROM);
      cardPull = SHEET_82.start.cardAverageRisk
        + (SHEET_82.end.cardAverageRisk - SHEET_82.start.cardAverageRisk) * t;
    }
    plans.forEach((plan) => {
      const level = levels.get(plan.index);
      const score = scoreInBand(level, plan.index, dayOffset, cardPull);
      const type = EVENT_TYPES[(plan.index + dayOffset) % EVENT_TYPES.length];
      const hour = 7 + ((plan.index + dayOffset) % 10);
      const minute = (plan.index * 7 + dayOffset * 3) % 55;
      byCode.get(plan.code).push(event(type, atDate(isoDate, hour, minute, plan.index), score, detailsFor(type, score, dayOffset, {
        usedApp: true,
        sheetCode: plan.code,
        pilot82: true,
        phase: 'sheet82',
      })));
    });
  });
  return byCode;
};

/** 26/05→27/08 (or day before first sheet): walk toward target first-sheet score. */
const buildBridgeEvents = (studentCode, index, startScore, targetScore, bridgeEndIso) => {
  const dates = listDates('2026-05-26', bridgeEndIso);
  if (!dates.length) return [];
  let score = Number.isFinite(startScore) ? startScore : 40;
  const target = Number.isFinite(targetScore) ? targetScore : score;
  const events = [];
  dates.forEach((isoDate, dayIndex) => {
    const day = new Date(`${isoDate}T00:00:00.000Z`);
    const isWeekend = day.getUTCDay() === 0 || day.getUTCDay() === 6;
    const progress = dates.length <= 1 ? 1 : dayIndex / (dates.length - 1);
    const chance = isWeekend ? 0.2 : 0.45;
    const active = unitNoise(index, dayIndex + 17) < chance;
    const keepScore = active || unitNoise(index, dayIndex + 41) < 0.25;
    if (!keepScore) return;
    const pull = target + (1 - progress) * (score - target) * 0.12;
    const step = Math.round((unitNoise(index, dayIndex + 5) - 0.5) * 6);
    score = clamp(Math.round(score * 0.8 + pull * 0.2 + step), 5, 98);
    if (dayIndex === dates.length - 1) {
      score = clamp(Math.round(target + (unitNoise(index, 77) - 0.5) * 2), 5, 98);
    }
    const type = EVENT_TYPES[(index + dayIndex) % EVENT_TYPES.length];
    const hour = active ? 8 + ((index + dayIndex) % 9) : 19;
    const minute = (index * 5 + dayIndex * 2) % 55;
    events.push(event(type, atDate(isoDate, hour, minute, index), score, detailsFor(type, score, dayIndex, {
      usedApp: active,
      sheetCode: studentCode,
      pilot82: true,
      phase: 'bridge',
    })));
  });
  return events;
};

const buildSheet179Events = (studentCode, index) => {
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
    events.push(event(type, atDate(isoDate, hour, minute, index), score, detailsFor(type, score, dayIndex, {
      usedApp: active,
      sheetCode: studentCode,
      phase: 'sheet179',
    })));
  });
  return events;
};

const buildEventsForStudent = (studentCode, index, isPilot, pilotPlan, pilot82ByCode) => {
  const scores = SHEET.scores[studentCode] || {};
  const firstDate = firstSheetDate(scores);
  const firstScore = firstDate != null ? Number(scores[firstDate]) : null;
  const events = [];

  if (isPilot) {
    events.push(...buildWarmupEvents(studentCode, index));
    events.push(...(pilot82ByCode.get(studentCode) || []));
    const last82 = [...(pilot82ByCode.get(studentCode) || [])].pop();
    const startScore = last82?.riskScore;
    let bridgeEnd = BRIDGE_TO;
    if (firstDate && firstDate < SHEET.from) {
      // first score before study window shouldn't happen; keep bridge to 27/08
      bridgeEnd = BRIDGE_TO;
    } else if (firstDate && firstDate > SHEET.from) {
      // walk until day before first sheet score
      const prev = new Date(`${firstDate}T00:00:00.000Z`);
      prev.setUTCDate(prev.getUTCDate() - 1);
      const prevIso = prev.toISOString().slice(0, 10);
      bridgeEnd = prevIso < '2026-05-26' ? null : (prevIso < BRIDGE_TO ? prevIso : BRIDGE_TO);
    }
    if (bridgeEnd) {
      events.push(...buildBridgeEvents(studentCode, index, startScore, firstScore, bridgeEnd));
    }
  }

  events.push(...buildSheet179Events(studentCode, index));
  return events.sort((a, b) => new Date(a.at) - new Date(b.at));
};

const aggregateDay = (plans, isoDate, levelFn, { onlyPilot = false, onlyOnDay = false } = {}) => {
  const counts = { high: 0, watch: 0, low: 0 };
  let scoreTotal = 0;
  let scored = 0;
  plans.forEach((plan) => {
    if (onlyPilot && !plan.isPilot) return;
    let relevant;
    if (onlyOnDay) {
      relevant = plan.events.filter((item) => new Date(item.at).toISOString().slice(0, 10) === isoDate);
    } else {
      relevant = plan.events.filter((item) => new Date(item.at).toISOString().slice(0, 10) <= isoDate);
    }
    if (!relevant.length) return;
    const latest = relevant[relevant.length - 1];
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

const cumulativeByDate = (plans, isoDate) => {
  let count = 0;
  plans.forEach((plan) => {
    const has = plan.events.some((item) => new Date(item.at).toISOString().slice(0, 10) <= isoDate);
    if (has) count += 1;
  });
  return count;
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
    console.log(JSON.stringify({
      purgedUsers: deletedUsers.deletedCount,
      purgedConversations: deletedConv.deletedCount,
    }, null, 2));
    return;
  }

  const studentCodes = Object.keys(SHEET.scores).sort();
  if (studentCodes.length !== 179) {
    throw new Error(`Expected 179 students in sheet JSON, found ${studentCodes.length}`);
  }

  const pilotCodes = studentCodes.slice(0, PILOT_COUNT);
  const pilotPlans = pilotTransitions(pilotCodes);
  const pilot82ByCode = buildPilot82Events(pilotPlans);

  const plans = studentCodes.map((code, index) => {
    const isPilot = index < PILOT_COUNT;
    const pilotPlan = isPilot ? pilotPlans[index] : null;
    return {
      code,
      index,
      isPilot,
      events: buildEventsForStudent(code, index, isPilot, pilotPlan, pilot82ByCode),
    };
  });

  // Validate sheet 8.2 window on pilots (code thresholds, on-day)
  const sheet82Compare = SHEET_82.days.map((day) => {
    const actual = aggregateDay(plans, day.date, levelOf, { onlyPilot: true, onlyOnDay: true });
    return {
      date: day.date,
      expected: { high: day.high, watch: day.watch, low: day.low },
      actual: { high: actual.high, watch: actual.watch, low: actual.low, total: actual.total },
      countsMatch: actual.high === day.high && actual.watch === day.watch && actual.low === day.low,
    };
  });
  const sheet82Matched = sheet82Compare.filter((row) => row.countsMatch).length;
  if (sheet82Matched !== sheet82Compare.length) {
    const first = sheet82Compare.find((row) => !row.countsMatch);
    throw new Error(`Sheet 8.2 mismatch: ${JSON.stringify(first)}`);
  }

  // Sheet 179: score events present; risk counts validated via overlay in analytics
  const sheet179Sample = [SHEET.from, '2026-09-03', '2026-09-17', '2026-10-01', SHEET.to].map((date) => {
    const expected = SHEET.daily.find((row) => row.date === date);
    const sheetOnly = plans.map((plan) => ({
      ...plan,
      events: plan.events.filter((item) => item.details?.phase === 'sheet179'),
    }));
    const actual = aggregateDay(sheetOnly, date, sheetLevelOf);
    return {
      date,
      expected: expected
        ? { high: expected.high, watch: expected.watch, low: expected.low, averageRisk: expected.averageRisk }
        : null,
      actualSheetThresholds: actual,
      countsMatch: expected
        ? actual.high === expected.high && actual.watch === expected.watch && actual.low === expected.low
        : false,
    };
  });

  const cumApr25 = cumulativeByDate(plans, '2026-04-25');
  const cumAug28 = cumulativeByDate(plans, '2026-08-28');
  const cumNov1 = cumulativeByDate(plans, SHEET.to);

  if (cumApr25 < PILOT_COUNT) {
    throw new Error(`Expected >= ${PILOT_COUNT} cumulative by 2026-04-25, got ${cumApr25}`);
  }
  if (cumAug28 < PILOT_COUNT) {
    throw new Error(`Expected >= ${PILOT_COUNT} cumulative by 2026-08-28, got ${cumAug28}`);
  }
  if (cumNov1 !== 179) {
    throw new Error(`Expected cumulative 179 by ${SHEET.to}, got ${cumNov1}`);
  }

  const summary = {
    ok: true,
    students: plans.length,
    pilots: PILOT_COUNT,
    dateRange: { from: HISTORY_FROM, sheet82: { from: SHEET_82.from, to: SHEET_82.to }, sheet179: { from: SHEET.from, to: SHEET.to } },
    sheet82DaysMatched: sheet82Matched,
    sheet82DaysTotal: sheet82Compare.length,
    sheet179Sample,
    sheet179SampleMatched: sheet179Sample.filter((row) => row.countsMatch).length,
    cumulative: { '2026-04-25': cumApr25, '2026-08-28': cumAug28, [SHEET.to]: cumNov1 },
    pilotSample: ['2026-04-25', '2026-05-16', '2026-05-25'].map((date) => ({
      date,
      ...aggregateDay(plans, date, levelOf, { onlyPilot: true, onlyOnDay: true }),
    })),
  };

  if (DRY_RUN) {
    console.log(JSON.stringify({ ...summary, dryRun: true }, null, 2));
    return;
  }

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
  const userDocs = studentCodes.map((code, index) => ({
    name: index < PILOT_COUNT ? `HS lớp 8.2 ${code}` : `HS nghiên cứu ${code}`,
    username: `sim179_${String(index + 1).padStart(3, '0')}`,
    passwordHash,
    role: 'student',
    className: CLASS_NAME,
    rosterNumber: index + 1,
    rosterStatus: ROSTER_STATUS,
    rosterSource: 'unified-47-in-179-apr-nov-2026',
    note: code,
    createdAt: now,
    updatedAt: now,
  }));
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
      title: 'Timeline ThinkBridge 4–11/2026',
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
            version: 2,
            seededAt: now,
            cohort: 'sim-179',
            sheetCode: plan.code,
            pilot82: plan.isPilot,
            timeline: { from: HISTORY_FROM, to: SHEET.to },
            dailyEvents: plan.events.length,
          },
          updatedAt: now,
        },
      },
    );
    createdConversations += 1;
  }

  console.log(JSON.stringify({
    ...summary,
    createdConversations,
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
