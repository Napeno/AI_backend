/**
 * Validate Mongo + analytics overlay against every Excel tab.
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

  const users82 = await User.find({
    role: { $ne: 'admin' },
    rosterStatus: { $in: ['current', 'current-account'] },
  }).lean();
  const a82 = buildAnalytics(users82, conversations, {
    from: SHEET_82.from,
    to: SHEET_82.to,
    metric: 'risk',
    groupBy: 'day',
  });

  const file1 = {
    tab_MoPhongTheoNgay: {
      expectedDays: SHEET_82.days.length,
      actualDays: a82.chart.statusPoints.length,
      allMatch: a82.chart.statusPoints.every((point) => {
        const sheet = SHEET_82.days.find((day) => day.date === point.label);
        return sheet
          && sheet.high === point.high
          && sheet.watch === point.watch
          && sheet.low === point.low
          && Math.round(sheet.averageRisk) === point.averageRisk;
      }),
    },
    tab_TheoDoiTheoNgay: {
      note: 'Chỉ các ngày có số trong sheet; web lấy đủ từ tab Mô phỏng',
      filledAnchorsMatch: ['2026-04-25', '2026-05-25'].every((date) => {
        const sheet = SHEET_82.days.find((day) => day.date === date);
        const point = a82.chart.statusPoints.find((row) => row.label === date);
        return sheet && point && sheet.high === point.high && Math.round(sheet.averageRisk) === point.averageRisk;
      }),
    },
    tab_TongHopDauCuoi: {
      day1: buildAnalytics(users82, conversations, { from: '2026-04-25', to: '2026-04-25' }).summary,
      day31: buildAnalytics(users82, conversations, { from: '2026-05-25', to: '2026-05-25' }).summary,
      expectedDay1: SHEET_82.start,
      expectedDay31: SHEET_82.end,
    },
  };

  const users179 = await User.find({ rosterStatus: 'sim-179' }).lean();
  const a179 = buildAnalytics(users179, conversations, {
    from: SHEET_179.from,
    to: SHEET_179.to,
    metric: 'risk',
    groupBy: 'day',
    className: 'sim-179',
  });

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
      // Only validate sheet-window activity (28/08→01/11); pre-history is synthetic.
      if (event.details?.preHistory) return;
      if (event.details?.usedApp === true) {
        usedAppEvents += 1;
        const date = new Date(event.at).toISOString().slice(0, 10);
        if (activityByUserDate.has(`${String(user._id)}:${date}`)) usedAppMatch += 1;
      }
    });
  });

  const file2 = {
    tab_TongHopTheoNgay: {
      expectedDays: SHEET_179.daily.length,
      actualDays: a179.chart.statusPoints.length,
      riskAllMatch: a179.chart.statusPoints.every((point) => {
        const sheet = SHEET_179.daily.find((day) => day.date === point.date || day.date === point.label);
        return sheet
          && sheet.high === point.high
          && sheet.watch === point.watch
          && sheet.low === point.low
          && Math.round(sheet.averageRisk) === point.averageRisk;
      }),
      visitorsAllMatch: (a179.chart.activityPoints || []).every((point) => {
        const sheet = SHEET_179.daily.find((day) => day.date === point.label);
        return sheet && Number(sheet.visitors) === Number(point.value);
      }),
      cumulativeAllMatch: (a179.chart.participationPoints || []).every((point) => {
        const sheet = SHEET_179.daily.find((day) => day.date === point.label);
        return sheet && Number(sheet.cumulative) === Number(point.value);
      }),
    },
    tab_DiemTungHS: {
      students: users179.length,
      expectedStudents: 179,
      scoreMatrixStudents: Object.keys(SHEET_179.scores).length,
      note: 'Ma trận điểm → event riskScore; aggregate = tab Tổng hợp',
    },
    tab_HoatDong: {
      sheetActivityOnes: Object.values(SHEET_179.activity).reduce(
        (sum, row) => sum + Object.values(row).filter((value) => value === 1).length,
        0,
      ),
      usedAppEvents,
      usedAppMatch,
      visitorsOverlayOk: (a179.chart.activityPoints || []).length === SHEET_179.daily.length,
    },
  };

  const ok = file1.tab_MoPhongTheoNgay.allMatch
    && file1.tab_TheoDoiTheoNgay.filledAnchorsMatch
    && file1.tab_TongHopDauCuoi.day1.requiresIntervention === 6
    && file1.tab_TongHopDauCuoi.day1.watchingStudents === 22
    && file1.tab_TongHopDauCuoi.day31.requiresIntervention === 0
    && file1.tab_TongHopDauCuoi.day31.watchingStudents === 15
    && file2.tab_TongHopTheoNgay.riskAllMatch
    && file2.tab_TongHopTheoNgay.visitorsAllMatch
    && file2.tab_TongHopTheoNgay.cumulativeAllMatch
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
