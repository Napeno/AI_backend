/**
 * Đối chiếu data Mongo với 2 sheet Excel (đã export JSON).
 *
 * Usage:
 *   node scripts/verify-sheet-match.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const { getRiskLevel } = require('../src/services/intervention.service');
const SHEET_82 = require('./data/sheet-8-2-30-days.json');
const SHEET_179 = require('./data/sheet-179-sim.json');

const levelOf = (score) => getRiskLevel(score);
const sheet179Level = (score) => {
  if (score >= 70) return 'high';
  if (score >= 40) return 'watch';
  return 'low';
};

const latestOnDay = (events, isoDate) => {
  const onDay = (events || []).filter((item) => new Date(item.at).toISOString().slice(0, 10) === isoDate);
  if (!onDay.length) return null;
  return [...onDay].sort((a, b) => new Date(b.at) - new Date(a.at))[0];
};

const carryForward = (events, isoDate) => {
  const onOrBefore = (events || [])
    .filter((item) => new Date(item.at).toISOString().slice(0, 10) <= isoDate)
    .sort((a, b) => new Date(a.at) - new Date(b.at));
  return onOrBefore.length ? onOrBefore[onOrBefore.length - 1] : null;
};

const main = async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const users = db.collection('users');
  const conversations = db.collection('conversations');

  const class82 = await users
    .find({ role: { $ne: 'admin' }, rosterStatus: 'current' })
    .project({ _id: 1, username: 1, rosterNumber: 1 })
    .toArray();
  const class82Ids = class82.map((user) => user._id);
  const class82Convs = await conversations.find({
    user: { $in: class82Ids },
    sessionId: { $regex: '^research-heuristic-' },
  }).project({ user: 1, dependencyEvents: 1 }).toArray();

  const eventsByUser = new Map(class82Convs.map((conversation) => [String(conversation.user), conversation.dependencyEvents || []]));

  const compare82 = SHEET_82.days.map((day) => {
    const counts = { high: 0, watch: 0, low: 0 };
    let scoreTotal = 0;
    let scored = 0;
    class82.forEach((user) => {
      const latest = latestOnDay(eventsByUser.get(String(user._id)) || [], day.date);
      if (!latest) return;
      counts[levelOf(latest.riskScore)] += 1;
      scoreTotal += latest.riskScore;
      scored += 1;
    });
    return {
      date: day.date,
      expected: { high: day.high, watch: day.watch, low: day.low, averageRisk: day.averageRisk },
      actual: {
        high: counts.high,
        watch: counts.watch,
        low: counts.low,
        total: counts.high + counts.watch + counts.low,
        averageRisk: scored ? Math.round(scoreTotal / scored) : 0,
      },
      countsMatch: counts.high === day.high && counts.watch === day.watch && counts.low === day.low,
    };
  });

  const simUsers = await users
    .find({ rosterStatus: 'sim-179' })
    .project({ _id: 1, note: 1, username: 1 })
    .toArray();
  const simIds = simUsers.map((user) => user._id);
  const simConvs = await conversations.find({
    user: { $in: simIds },
    sessionId: { $regex: '^sim-179-' },
  }).project({ user: 1, dependencyEvents: 1 }).toArray();
  const simEvents = new Map(simConvs.map((conversation) => [String(conversation.user), conversation.dependencyEvents || []]));

  const compare179 = SHEET_179.daily.map((day) => {
    const counts = { high: 0, watch: 0, low: 0 };
    let scoreTotal = 0;
    let scored = 0;
    simUsers.forEach((user) => {
      const latest = carryForward(simEvents.get(String(user._id)) || [], day.date);
      if (!latest) return;
      counts[sheet179Level(latest.riskScore)] += 1;
      scoreTotal += latest.riskScore;
      scored += 1;
    });
    return {
      date: day.date,
      expected: { high: day.high, watch: day.watch, low: day.low, cumulative: day.cumulative },
      actual: {
        high: counts.high,
        watch: counts.watch,
        low: counts.low,
        total: counts.high + counts.watch + counts.low,
        averageRisk: scored ? Math.round((scoreTotal / scored) * 10) / 10 : 0,
      },
      countsMatch: counts.high === day.high && counts.watch === day.watch && counts.low === day.low,
    };
  });

  const report = {
    class82: {
      users: class82.length,
      conversations: class82Convs.length,
      sheetDays: compare82.length,
      matchedDays: compare82.filter((row) => row.countsMatch).length,
      sample: compare82.filter((row) => ['2026-04-25', '2026-05-16', '2026-05-25'].includes(row.date)),
      firstMismatch: compare82.find((row) => !row.countsMatch) || null,
    },
    sim179: {
      users: simUsers.length,
      conversations: simConvs.length,
      sheetDays: compare179.length,
      matchedDays: compare179.filter((row) => row.countsMatch).length,
      sample: compare179.filter((row) =>
        ['2026-08-28', '2026-09-03', '2026-09-17', '2026-11-01'].includes(row.date)),
      firstMismatch: compare179.find((row) => !row.countsMatch) || null,
    },
  };

  const ok = report.class82.matchedDays === report.class82.sheetDays
    && report.class82.users === 47
    && report.sim179.users === 179
    && report.sim179.matchedDays === report.sim179.sheetDays;

  console.log(JSON.stringify({ ok, ...report }, null, 2));
  if (!ok) process.exitCode = 1;
};

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
