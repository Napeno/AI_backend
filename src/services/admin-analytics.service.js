const { BASELINE_RISK_SCORE, getRiskLevel } = require('./intervention.service');

const RISK_LEVELS = ['low', 'watch', 'high'];
const RISK_LEVEL_INDEX = { low: 1, watch: 2, high: 3 };
const RISK_LABELS = { low: 'Thấp', watch: 'Cần theo dõi', high: 'Cao' };

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
    conversations: relevant.length,
  };
};

const demoAnalytics = (demo, filters) => {
  if (!demo || !matchesContext(demo, filters)) return null;
  const from = toDate(filters.from);
  const to = toDate(filters.to, true);
  const events = (demo.events || []).filter(event => inRange(event.at, from, to));
  const current = latest(events) || (!from && !to ? {
    at: demo.seededAt,
    riskScore: demo.currentScore,
    riskLevel: demo.riskLevel,
  } : null);
  return { source: 'demo', tracked: !!current, events, current, conversations: 0 };
};

const recommendationFor = (score, metrics) => {
  if (score > 60 && metrics.meaningfulAttempts === 0) return 'Yêu cầu học sinh tự viết một bước trước khi nhận hỗ trợ.';
  if (score > 60) return 'Ưu tiên can thiệp: kiểm tra lại cách dùng AI và mục tiêu học.';
  if (score > 30) return 'Theo dõi: khuyến khích sửa bài và tự kiểm tra đáp án.';
  return 'Đã cải thiện: duy trì cách học tự chủ hiện tại.';
};

const buildStudent = (user, conversations, filters = {}) => {
  const real = realAnalytics(conversations, filters);
  const demo = demoAnalytics(user.analyticsDemo, filters);
  const selected = real.tracked ? real : demo?.tracked ? demo : real;
  const currentScore = selected.current?.riskScore ?? BASELINE_RISK_SCORE;
  const metrics = countMetrics(selected.events);
  const latestAssessment = [...(user.dependencyAssessments || [])]
    .filter(assessment => inRange(assessment.submittedAt, toDate(filters.from), toDate(filters.to, true)))
    .sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt))[0] || null;

  return {
    id: String(user._id),
    name: user.name || user.username,
    username: user.username || '',
    baselineScore: BASELINE_RISK_SCORE,
    behavioralRisk: currentScore,
    riskLevel: getRiskLevel(currentScore),
    improvement: Math.max(0, BASELINE_RISK_SCORE - currentScore),
    source: selected.source === 'demo' ? 'demo' : selected.tracked ? 'real' : 'baseline',
    educationLevel: selected.current?.educationLevel || user.analyticsDemo?.educationLevel || 'unclassified',
    subjectArea: selected.current?.subjectArea || user.analyticsDemo?.subjectArea || 'unclassified',
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
  if (groupBy === 'subject') return event.subjectArea || 'mô phỏng';
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
    { label: '0', min: 0, max: 0 }, { label: '1–17', min: 1, max: 17 }, { label: '18–35', min: 18, max: 35 },
    { label: '36+', min: 36, max: Infinity },
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
  const distribution = RISK_LEVELS.reduce((result, level) => ({ ...result, [level]: students.filter(student => student.riskLevel === level).length }), {});
  const quizScores = students.map(student => student.quiz?.score).filter(Number.isFinite);
  const summary = {
    totalStudents: students.length,
    requiresIntervention: distribution.high,
    watchingStudents: distribution.watch,
    improvedStudents: students.filter(student => student.improvement >= 15).length,
    averageBehavioralRisk: average(students.map(student => student.behavioralRisk)),
    averageQuizScore: quizScores.length ? Math.round(quizScores.reduce((sum, score) => sum + score, 0) / quizScores.length * 10) / 10 : null,
    demoStudents: students.filter(student => student.source === 'demo').length,
    riskDistribution: distribution,
  };
  const page = Math.max(1, Number(filters.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(filters.limit) || 20));
  const withoutEvents = ({ _events, ...student }) => student;

  return {
    summary,
    chart: { metric: filters.metric || 'risk', groupBy: filters.groupBy || 'day', points: buildChart(students, filters.metric || 'risk', filters.groupBy || 'day') },
    breakdowns: buildBreakdowns(students),
    students: students.slice((page - 1) * limit, page * limit).map(withoutEvents),
    exportStudents: students.map(withoutEvents),
    pagination: { page, limit, total: students.length, totalPages: Math.max(1, Math.ceil(students.length / limit)) },
  };
};

module.exports = { buildAnalytics, buildStudent };
