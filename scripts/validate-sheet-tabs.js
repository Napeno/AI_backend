/**
 * Validate unified 47⊂179 Mongo + analytics overlay.
 *
 * - Sheet 8.2 window (25/4→25/5): overlay high/watch/low/avg on statusPoints
 * - Sheet 179 window (28/8→1/11): overlay risk + visitors; cumulative from events
 * - Continuous cumulative: 28/8 ≥ 47, 1/11 = 179
 *
 * Usage: node scripts/validate-sheet-tabs.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const { buildAnalytics } = require('../src/services/admin-analytics.service');
const User = require('../src/models/user.model');
const Conversation = require('../src/models/conversation.model');
const SHEET_82 = require('./data/sheet-8-2-30-days.json');
const SHEET_179 = require('./data/sheet-179-sim.json');

const main = async () => {
  await mongoose.connect(process.env.MONGODB_URI);
  const conversations = await Conversation.find({})
    .select('user educationLevel subjectArea interventionMetrics dependencyEvents updatedAt')
    .lean();

  const users179 = await User.find({ rosterStatus: 'sim-179' }).lean();
  const pilots = users179.filter((user) => {
    const code = user.note || user.analyticsDemo?.sheetCode || '';
    const num = Number(String(code).replace(/\D/g, ''));
    return Number.isFinite(num) && num >= 1 && num <= 47;
  });

  const aFull = buildAnalytics(users179, conversations, {
    from: '2026-04-01',
    to: SHEET_179.to,
    metric: 'risk',
    groupBy: 'day',
    className: 'sim-179',
  });

  const a82 = buildAnalytics(users179, conversations, {
    from: SHEET_82.from,
    to: SHEET_82.to,
    metric: 'risk',
    groupBy: 'day',
    className: 'sim-179',
  });

  const a179 = buildAnalytics(users179, conversations, {
    from: SHEET_179.from,
    to: SHEET_179.to,
    metric: 'risk',
    groupBy: 'day',
    className: 'sim-179',
  });

  const file1 = {
    tab_MoPhongTheoNgay: {
      expectedDays: SHEET_82.days.length,
      overlayDays: a82.chart.statusPoints.filter((point) =>
        SHEET_82.days.some((day) => day.date === point.label)).length,
      allMatch: SHEET_82.days.every((sheet) => {
        const point = a82.chart.statusPoints.find((row) => row.label === sheet.date);
        return point
          && sheet.high === point.high
          && sheet.watch === point.watch
          && sheet.low === point.low
          && Math.round(sheet.averageRisk) === point.averageRisk;
      }),
    },
    tab_TongHopDauCuoi: {
      day1: buildAnalytics(users179, conversations, {
        from: '2026-04-25',
        to: '2026-04-25',
        className: 'sim-179',
      }).summary,
      day31: buildAnalytics(users179, conversations, {
        from: '2026-05-25',
        to: '2026-05-25',
        className: 'sim-179',
      }).summary,
      expectedDay1: SHEET_82.start,
      expectedDay31: SHEET_82.end,
      note: 'KPI single-day uses events in range (pilots only on 8.2 dates)',
    },
    pilots: {
      expected: 47,
      actual: pilots.length,
    },
  };

  const activityByUserDate = new Map();
  users179.forEach((user) => {
    const code = user.note || user.analyticsDemo?.sheetCode;
    const acts = SHEET_179.activity[code] || {};
    Object.keys(acts).forEach((date) => {
      if (acts[date] === 1) {
        activityByUserDate.set(`${String(user._id)}:${date}`, true);
      }
    });
  });

  let usedAppEvents = 0;
  let usedAppMatch = 0;
  const user179Ids = new Set(users179.map((user) => String(user._id)));
  const convByUser = new Map();
  conversations.forEach((conversation) => {
    const id = String(conversation.user);
    if (!user179Ids.has(id)) return;
    convByUser.set(id, conversation);
  });
  users179.forEach((user) => {
    const conversation = convByUser.get(String(user._id));
    (conversation?.dependencyEvents || []).forEach((event) => {
      if (event.details?.phase !== 'sheet179') return;
      if (event.details?.usedApp !== true) return;
      usedAppEvents += 1;
      const date = new Date(event.at).toISOString().slice(0, 10);
      if (activityByUserDate.has(`${String(user._id)}:${date}`)) usedAppMatch += 1;
    });
  });

  const participation = aFull.chart.participationPoints || [];
  const cumAug28 = participation.find((point) => point.label === '2026-08-28')?.value;
  const cumNov1 = participation.find((point) => point.label === SHEET_179.to)?.value
    || participation[participation.length - 1]?.value;

  const activity179 = (a179.chart.activityPoints || []).filter((point) =>
    SHEET_179.daily.some((day) => day.date === point.label));

  const file2 = {
    tab_TongHopTheoNgay: {
      expectedDays: SHEET_179.daily.length,
      actualDays: a179.chart.statusPoints.filter((point) =>
        SHEET_179.daily.some((day) => day.date === point.label)).length,
      riskAllMatch: SHEET_179.daily.every((sheet) => {
        const point = a179.chart.statusPoints.find((row) => row.label === sheet.date);
        return point
          && sheet.high === point.high
          && sheet.watch === point.watch
          && sheet.low === point.low
          && Math.round(sheet.averageRisk) === point.averageRisk;
      }),
      visitorsAllMatch: SHEET_179.daily.every((sheet) => {
        const point = activity179.find((row) => row.label === sheet.date);
        return point && Number(sheet.visitors) === Number(point.value);
      }),
      // Continuous cumulative — NOT Excel start-at-4
      continuousCumulative: {
        aug28: cumAug28,
        nov1: cumNov1,
        aug28AtLeast47: Number(cumAug28) >= 47,
        nov1Is179: Number(cumNov1) === 179,
      },
    },
    tab_DiemTungHS: {
      students: users179.length,
      expectedStudents: 179,
      scoreMatrixStudents: Object.keys(SHEET_179.scores).length,
    },
    tab_HoatDong: {
      sheetActivityOnes: Object.values(SHEET_179.activity).reduce(
        (sum, row) => sum + Object.values(row).filter((value) => value === 1).length,
        0,
      ),
      usedAppEvents,
      usedAppMatch,
      visitorsOverlayOk: activity179.length === SHEET_179.daily.length,
    },
  };

  const day1 = file1.tab_TongHopDauCuoi.day1;
  const day31 = file1.tab_TongHopDauCuoi.day31;

  const ok = file1.tab_MoPhongTheoNgay.allMatch
    && file1.pilots.actual === 47
    && day1.requiresIntervention === 6
    && day1.watchingStudents === 22
    && day31.requiresIntervention === 0
    && day31.watchingStudents === 15
    && file2.tab_TongHopTheoNgay.riskAllMatch
    && file2.tab_TongHopTheoNgay.visitorsAllMatch
    && file2.tab_TongHopTheoNgay.continuousCumulative.aug28AtLeast47
    && file2.tab_TongHopTheoNgay.continuousCumulative.nov1Is179
    && file2.tab_DiemTungHS.students === 179
    && file2.tab_HoatDong.usedAppMatch === file2.tab_HoatDong.usedAppEvents;

  console.log(JSON.stringify({ ok, file1, file2 }, null, 2));
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
