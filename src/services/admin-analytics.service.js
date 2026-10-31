const { BASELINE_RISK_SCORE, getRiskLevel } = require('./intervention.service');
const SHEET_82 = require('../../scripts/data/sheet-8-2-30-days.json');
const SHEET_179 = require('../../scripts/data/sheet-179-sim.json');

const RISK_LEVELS = ['low', 'watch', 'high'];
const RISK_LEVEL_INDEX = { low: 1, watch: 2, high: 3 };
const RISK_LABELS = { low: 'Thấp', watch: 'Cần theo dõi', high: 'Cao' };

const SHEET_82_BY_DATE = new Map((SHEET_82.days || []).map((day) => [day.date, day]));
const SHEET_179_BY_DATE = new Map((SHEET_179.daily || []).map((day) => [day.date, day]));

/**
 * Date-based overlay for unified 47⊂179 timeline:
 * - days in sheet 8.2 → high/watch/low/averageRisk from 8.2
 * - days in sheet 179 → high/watch/low/averageRisk + visitors from 179
 * - never overlay cumulative (continuous from Apr)
 */
const applySheetOverlay = (statusPoints, chartPoints, groupBy) => {
  if (groupBy !== 'day') {
    return { statusPoints, chartPoints, activityPoints: null };
  }
  if (!SHEET_82_BY_DATE.size && !SHEET_179_BY_DATE.size) {
    return { statusPoints, chartPoints, activityPoints: null };
  }

  const sheetFor = (label) => {
    if (SHEET_82_BY_DATE.has(label)) return { sheet: SHEET_82_BY_DATE.get(label), source: '82' };
    if (SHEET_179_BY_DATE.has(label)) return { sheet: SHEET_179_BY_DATE.get(label), source: '179' };
    return null;
  };

  const overlayStatus = statusPoints.map((point) => {
    const hit = sheetFor(point.label);
    if (!hit) return point;
    const { sheet, source } = hit;
    const averageRisk = Math.round(Number(sheet.averageRisk) || point.averageRisk || 0);
    const total = source === '82'
      ? (Number(sheet.total) || sheet.high + sheet.watch + sheet.low || point.total)
      : (Number(sheet.high) + Number(sheet.watch) + Number(sheet.low) || point.total);
    return {
      ...point,
      high: Number(sheet.high) || 0,
      watch: Number(sheet.watch) || 0,
      low: Number(sheet.low) || 0,
      total,
      averageRisk,
      value: averageRisk,
      visitors: sheet.visitors != null ? Number(sheet.visitors) : point.visitors,
      // keep event-based cumulative; do not take Excel cumulative
      newParticipants: sheet.newParticipants != null ? Number(sheet.newParticipants) : point.newParticipants,
    };
  });

  const overlayChart = chartPoints.map((point) => {
    const hit = sheetFor(point.label);
    if (!hit || hit.sheet.averageRisk == null) return point;
    return { ...point, value: Math.round(Number(hit.sheet.averageRisk)) };
  });

  // DAU overlay only for sheet-179 window (has visitors column).
  const activityPoints = overlayStatus
    .filter((point) => SHEET_179_BY_DATE.has(point.label))
    .map((point) => ({
      label: point.label,
      value: Number(SHEET_179_BY_DATE.get(point.label).visitors) || 0,
    }));

  return { statusPoints: overlayStatus, chartPoints: overlayChart, activityPoints };
};

const mergeSeries = (basePoints = [], overlayPoints = []) => {
  const byLabel = new Map();
  basePoints.forEach((point) => byLabel.set(point.label, { ...point }));
  overlayPoints.forEach((point) => byLabel.set(point.label, { ...point }));
  return [...byLabel.values()].sort((a, b) => a.label.localeCompare(b.label));
};

/** Cumulative participants = students with any event on/before each day. */
const buildParticipationTimeline = (students, groupBy = 'day') => {
  const firstLabel = new Map();
  students.forEach((student) => {
    const events = [...(student._events || [])].sort((a, b) => new Date(a.at) - new Date(b.at));
    if (!events.length) return;
    firstLabel.set(student.id, bucketFor(events[0], groupBy));
  });
  const labels = [...new Set([...firstLabel.values()])].sort((a, b) => a.localeCompare(b));
  // Also include later days that appear in events so cumulative continues
  students.forEach((student) => {
    (student._events || []).forEach((event) => {
      const label = bucketFor(event, groupBy);
      if (!labels.includes(label)) labels.push(label);
    });
  });
  const ordered = [...new Set(labels)].sort((a, b) => a.localeCompare(b));
  return ordered.map((label) => ({
    label,
    value: [...firstLabel.values()].filter((first) => first <= label).length,
  }));
};

/** DAU from events tagged usedApp (Hoạt động=1); if tag missing, count any event that day. */
const buildActivityTimeline = (students, groupBy = 'day') => {
  const buckets = new Map();
  students.forEach((student) => {
    const seen = new Set();
    (student._events || []).forEach((event) => {
      const hasFlag = event.details && Object.prototype.hasOwnProperty.call(event.details, 'usedApp');
      if (hasFlag && event.details.usedApp !== true) return;
      const label = bucketFor(event, groupBy);
      const key = `${student.id}:${label}`;
      if (seen.has(key)) return;
      seen.add(key);
      const bucket = buckets.get(label) || { label, value: 0 };
      bucket.value += 1;
      buckets.set(label, bucket);
    });
  });
  return [...buckets.values()].sort((a, b) => a.label.localeCompare(b.label));
};

const toDate = (value, endOfDay = false) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  if (endOfDay) date.setHours(23, 59, 59, 999);
  return date;
};

const average = (values) => values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : 0;
const inRange = (at, from, to) => {
  const date = new Date(at);
  return (!from || date >= from) && (!to || date <= to);
};
const latest = (items) => [...items].sort((a, b) => new Date(b.at) - new Date(a.at))[0] || null;
const matchesContext = (item, filters) =>
  (!filters.educationLevel || item.educationLevel === filters.educationLevel) &&
  (!filters.subjectArea || item.subjectArea === filters.subjectArea);

const countMetrics = (events) => {
  const answerChecks = events.filter(event => event.type === 'answer_checked');
  const meaningfulAttempts = answerChecks.filter(event => event.details?.isMeaningfulAttempt).length;
  const correctAnswers = answerChecks.filter(event => event.details?.isCorrect === true).length;
  return {
    hintRequests: events.filter(event => event.type === 'hint_requested').length,
    rapidHintRequests: events.filter(event => event.type === 'hint_requested' && event.details?.isRapid).length,
    fullAnswerRequests: events.filter(event => event.type === 'full_answer_requested').length,
    answerChecks: answerChecks.length,
    meaningfulAttempts,
    correctAnswers,
    gateCompletions: events.filter(event => event.type === 'gate_completed').length,
    attemptRate: answerChecks.length ? Math.round(meaningfulAttempts * 100 / answerChecks.length) : 0,
    correctRate: answerChecks.length ? Math.round(correctAnswers * 100 / answerChecks.length) : 0,
  };
};

const realAnalytics = (conversations, filters) => {
  const from = toDate(filters.from);
  const to = toDate(filters.to, true);
  const allTime = !from && !to;
  const events = [];
  const states = [];
  const relevant = conversations.filter(conversation => matchesContext(conversation, filters));

  for (const conversation of relevant) {
    const conversationEvents = (conversation.dependencyEvents || [])
      .filter(event => event.rulesetVersion === 'v2')
      .filter(event => inRange(event.at, from, to))
      .map(event => ({ ...event, subjectArea: conversation.subjectArea, educationLevel: conversation.educationLevel }));
    events.push(...conversationEvents);
    const current = latest(conversationEvents);
    if (current) {
      states.push(current);
    } else if (allTime && conversation.interventionMetrics?.rulesetVersion === 'v2') {
      states.push({
        at: conversation.updatedAt,
        riskScore: conversation.interventionMetrics.lastRiskScore ?? BASELINE_RISK_SCORE,
        riskLevel: conversation.interventionMetrics.riskLevel || conversation.interventionMetrics.lastRiskLevel || 'low',
      });
    }
  }

  return {
    source: 'real',
    tracked: events.length > 0,
    events,
    current: latest(states),
    baselineScore: events.length ? Math.max(...events.map(event => Number(event.riskScore) || 0)) : BASELINE_RISK_SCORE,
    conversations: relevant.length,
  };
};

const recommendationFor = (score, metrics) => {
  if (score > 60 && metrics.meaningfulAttempts === 0) return 'Yêu cầu học sinh tự viết một bước trước khi nhận hỗ trợ.';
  if (score > 60) return 'Ưu tiên can thiệp: kiểm tra lại cách dùng AI và mục tiêu học.';
  if (score > 30) return 'Theo dõi: khuyến khích sửa bài và tự kiểm tra đáp án.';
  return 'Đã cải thiện: duy trì cách học tự chủ hiện tại.';
};

const buildStudent = (user, conversations, filters = {}) => {
  const real = realAnalytics(conversations, filters);
  const selected = real;
  const currentScore = selected.current?.riskScore ?? BASELINE_RISK_SCORE;
  const baselineScore = selected.baselineScore ?? BASELINE_RISK_SCORE;
  const metrics = countMetrics(selected.events);
  const latestAssessment = [...(user.dependencyAssessments || [])]
    .filter(assessment => inRange(assessment.submittedAt, toDate(filters.from), toDate(filters.to, true)))
    .sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt))[0] || null;

  return {
    id: String(user._id),
    name: user.name || user.username,
    username: user.username || '',
    classProfile: {
      className: user.className || '',
      rosterNumber: user.rosterNumber || null,
      dateOfBirth: user.dateOfBirth || '',
      gender: user.gender || '',
      ethnicity: user.ethnicity || '',
      previousClass: user.previousClass || '',
      rosterStatus: user.rosterStatus || '',
      note: user.note || '',
    },
    baselineScore,
    behavioralRisk: currentScore,
    riskLevel: getRiskLevel(currentScore),
    improvement: Math.max(0, baselineScore - currentScore),
    source: selected.tracked ? 'real' : 'baseline',
    educationLevel: selected.current?.educationLevel || 'unclassified',
    subjectArea: selected.current?.subjectArea || 'unclassified',
    recommendation: recommendationFor(currentScore, metrics),
    quiz: latestAssessment ? {
      score: latestAssessment.score,
      resultId: latestAssessment.resultId,
      submittedAt: latestAssessment.submittedAt,
    } : null,
    conversations: selected.conversations,
    latestActivity: selected.current?.at || null,
    _events: selected.events,
    ...metrics,
  };
};

const bucketFor = (event, groupBy) => {
  const date = new Date(event.at);
  if (groupBy === 'subject') return event.subjectArea || 'unclassified';
  if (groupBy === 'riskLevel') return event.riskLevel || 'low';
  if (groupBy === 'month') return date.toISOString().slice(0, 7);
  if (groupBy === 'week') {
    const start = new Date(date);
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    return start.toISOString().slice(0, 10);
  }
  return date.toISOString().slice(0, 10);
};

const metricFor = (event, metric) => {
  if (metric === 'hints') return event.type === 'hint_requested' ? 1 : 0;
  if (metric === 'fullAnswers') return event.type === 'full_answer_requested' ? 1 : 0;
  if (metric === 'attemptRate') return event.type === 'answer_checked' ? (event.details?.isMeaningfulAttempt ? 100 : 0) : null;
  if (metric === 'correctRate') return event.type === 'answer_checked' ? (event.details?.isCorrect === true ? 100 : 0) : null;
  return event.riskScore;
};

const buildChart = (students, metric = 'risk', groupBy = 'day') => {
  const buckets = new Map();
  students.flatMap(student => student._events).forEach(event => {
    const value = metricFor(event, metric);
    if (value === null || (value === 0 && ['hints', 'fullAnswers'].includes(metric))) return;
    const label = bucketFor(event, groupBy);
    const bucket = buckets.get(label) || { label, total: 0, count: 0 };
    bucket.total += value;
    bucket.count += 1;
    buckets.set(label, bucket);
  });
  return [...buckets.values()]
    .map(bucket => ({ label: bucket.label, value: ['risk', 'attemptRate', 'correctRate'].includes(metric) ? Math.round(bucket.total / bucket.count) : bucket.total }))
    .sort((a, b) => a.label.localeCompare(b.label));
};

/**
 * Per-bucket class snapshot: each student's latest score in that day/week/month,
 * carrying forward the last known score so history stays readable.
 */
const buildStatusTimeline = (students, groupBy = 'day') => {
  const state = new Map();
  students.forEach((student) => {
    const events = [...(student._events || [])].sort((a, b) => new Date(a.at) - new Date(b.at));
    if (!events.length) return;
    state.set(student.id, {
      events,
      cursor: 0,
      score: null,
      peak: null,
      first: null,
    });
  });

  const labels = [...new Set(
    students.flatMap((student) => (student._events || []).map((event) => bucketFor(event, groupBy))),
  )].sort((a, b) => a.localeCompare(b));

  return labels.map((label) => {
    let high = 0;
    let watch = 0;
    let low = 0;
    let active = 0;
    let improved = 0;
    let scoreTotal = 0;
    let scored = 0;

    state.forEach((item) => {
      let hadEvent = false;
      while (item.cursor < item.events.length && bucketFor(item.events[item.cursor], groupBy) === label) {
        const event = item.events[item.cursor];
        item.score = Number(event.riskScore) || 0;
        item.peak = item.peak == null ? item.score : Math.max(item.peak, item.score);
        item.first = item.first == null ? item.score : item.first;
        item.cursor += 1;
        hadEvent = true;
      }
      if (item.score == null) return;
      if (hadEvent) active += 1;
      const level = getRiskLevel(item.score);
      if (level === 'high') high += 1;
      else if (level === 'watch') watch += 1;
      else low += 1;
      if (item.peak != null && item.peak - item.score >= 5) improved += 1;
      scoreTotal += item.score;
      scored += 1;
    });

    return {
      label,
      high,
      watch,
      low,
      active,
      improved,
      total: high + watch + low,
      averageRisk: scored ? Math.round(scoreTotal / scored) : 0,
      value: scored ? Math.round(scoreTotal / scored) : 0,
    };
  });
};

const countByRisk = (students, key) => Object.values(students.reduce((rows, student) => {
  const label = student[key] || 'unclassified';
  rows[label] ||= { label, low: 0, watch: 0, high: 0 };
  rows[label][student.riskLevel] += 1;
  return rows;
}, {}));

const buildToday = (students, now = new Date()) => {
  const today = now.toISOString().slice(0, 10);
  const active = students.map(student => ({
    student,
    events: student._events.filter(event => new Date(event.at).toISOString().slice(0, 10) === today),
  })).filter(item => item.events.length);
  const events = active.flatMap(item => item.events);
  const behaviorTypes = [
    ['hint_requested', 'Gợi ý'], ['full_answer_requested', 'Xin lời giải'], ['answer_checked', 'Kiểm tra đáp án'], ['gate_completed', 'Hoàn thành can thiệp'],
  ];
  return {
    activeStudents: active.length,
    behaviors: behaviorTypes.map(([type, label]) => ({ label, value: events.filter(event => event.type === type).length })),
    riskDistribution: ['high', 'watch', 'low'].map(level => ({ label: RISK_LABELS[level], value: active.filter(item => getRiskLevel(latest(item.events).riskScore) === level).length, color: { high: '#ef4444', watch: '#f59e0b', low: '#10b981' }[level] })),
    students: active.map(({ student, events: studentEvents }) => {
      const event = latest(studentEvents);
      return { id: student.id, name: student.name, username: student.username, riskLevel: getRiskLevel(event.riskScore), behavior: behaviorTypes.find(([type]) => type === event.type)?.[1] || event.type, at: event.at };
    }).sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, 8),
  };
};

const buildBreakdowns = (students) => ({
  behaviors: {
    items: [
    ['hintRequests', 'Gợi ý'], ['rapidHintRequests', 'Gợi ý nhanh'], ['fullAnswerRequests', 'Xin lời giải'],
    ['meaningfulAttempts', 'Tự thử'], ['correctAnswers', 'Đáp án đúng'], ['gateCompletions', 'Hoàn thành can thiệp'],
    ].map(([key, label]) => ({ key, label, value: students.reduce((total, student) => total + student[key], 0) })),
    today: buildToday(students),
  },
  riskBySubject: countByRisk(students, 'subjectArea'),
  riskByEducationLevel: countByRisk(students, 'educationLevel'),
  improvement: [
    { label: '0', min: 0, max: 0 },
    { label: '1–4', min: 1, max: 4 },
    { label: '5–14', min: 5, max: 14 },
    { label: '15+', min: 15, max: Infinity },
  ].map(bucket => ({ label: bucket.label, value: students.filter(student => student.improvement >= bucket.min && student.improvement <= bucket.max).length })),
});

const compareStudents = (sortBy, sortOrder) => (left, right) => {
  const direction = sortOrder === 'asc' ? 1 : -1;
  const value = (student) => sortBy === 'riskLevel' ? RISK_LEVEL_INDEX[student.riskLevel] : student[sortBy];
  const a = value(left);
  const b = value(right);
  if (typeof a === 'string' || typeof b === 'string') return String(a || '').localeCompare(String(b || ''), 'vi') * direction;
  return ((Number(a) || 0) - (Number(b) || 0)) * direction;
};

const buildAnalytics = (users, conversations, filters = {}) => {
  const query = String(filters.search || '').trim().toLowerCase();
  const byUser = new Map();
  conversations.forEach(conversation => {
    const id = String(conversation.user);
    byUser.set(id, [...(byUser.get(id) || []), conversation]);
  });
  const students = users
    .map(user => buildStudent(user, byUser.get(String(user._id)) || [], filters))
    .filter(student => !query || `${student.name} ${student.username}`.toLowerCase().includes(query))
    .filter(student => !filters.riskLevel || student.riskLevel === filters.riskLevel)
    .sort(compareStudents(filters.sortBy || 'behavioralRisk', filters.sortOrder || 'desc'));
  const IMPROVED_DELTA = 5;
  const distribution = RISK_LEVELS.reduce((result, level) => ({ ...result, [level]: students.filter(student => student.riskLevel === level).length }), {});
  const quizScores = students.map(student => student.quiz?.score).filter(Number.isFinite);
  const summary = {
    totalStudents: students.length,
    requiresIntervention: distribution.high,
    watchingStudents: distribution.watch,
    improvedStudents: students.filter(student => student.improvement >= IMPROVED_DELTA).length,
    averageBehavioralRisk: average(students.map(student => student.behavioralRisk)),
    averageQuizScore: quizScores.length ? Math.round(quizScores.reduce((sum, score) => sum + score, 0) / quizScores.length * 10) / 10 : null,
    demoStudents: students.filter(student => student.source === 'demo').length,
    riskDistribution: distribution,
  };
  const page = Math.max(1, Number(filters.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(filters.limit) || 20));
  const withoutEvents = ({ _events, ...student }) => student;
  const groupBy = filters.groupBy || 'day';
  const metric = filters.metric || 'risk';
  const rawPoints = buildChart(students, metric, groupBy);
  const rawStatus = buildStatusTimeline(students, groupBy);
  const {
    statusPoints,
    chartPoints,
    activityPoints: sheetActivity,
  } = applySheetOverlay(rawStatus, rawPoints, groupBy);

  // Unified 179: DAU from events, merge sheet-179 visitors; cumulative always from events.
  const activityPoints = mergeSeries(buildActivityTimeline(students, groupBy), sheetActivity || []);
  const participationPoints = buildParticipationTimeline(students, groupBy);
  const lastActivity = activityPoints.length ? activityPoints[activityPoints.length - 1] : null;
  const lastParticipation = participationPoints.length
    ? participationPoints[participationPoints.length - 1]
    : null;

  return {
    summary: {
      ...summary,
      dailyActiveStudents: lastActivity ? lastActivity.value : null,
      cumulativeParticipants: lastParticipation ? lastParticipation.value : null,
    },
    chart: {
      metric,
      groupBy,
      points: chartPoints,
      statusPoints,
      activityPoints,
      participationPoints,
    },
    breakdowns: buildBreakdowns(students),
    students: students.slice((page - 1) * limit, page * limit).map(withoutEvents),
    exportStudents: students.map(withoutEvents),
    pagination: { page, limit, total: students.length, totalPages: Math.max(1, Math.ceil(students.length / limit)) },
  };
};

module.exports = { buildAnalytics, buildStudent };
