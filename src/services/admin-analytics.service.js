const RISK_LABELS = { green: 'green', yellow: 'yellow', red: 'red' };

const toDate = (value, endOfDay = false) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  if (endOfDay) date.setHours(23, 59, 59, 999);
  return date;
};

const riskLevel = (score) => score > 60 ? 'red' : score > 30 ? 'yellow' : 'green';
const average = (values) => values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : 0;

const eventInRange = (event, from, to) => {
  const at = new Date(event.at);
  return (!from || at >= from) && (!to || at <= to);
};

const assessmentInRange = (assessment, from, to) => eventInRange({ at: assessment.submittedAt }, from, to);

const buildStudent = (user, conversations, filters = {}) => {
  const from = toDate(filters.from);
  const to = toDate(filters.to, true);
  const allTime = !from && !to;
  const relevantConversations = conversations.filter(conversation =>
    (!filters.educationLevel || conversation.educationLevel === filters.educationLevel) &&
    (!filters.subjectArea || conversation.subjectArea === filters.subjectArea)
  );
  const events = [];
  const snapshots = [];

  for (const conversation of relevantConversations) {
    const conversationEvents = (conversation.dependencyEvents || []).filter(event => eventInRange(event, from, to));
    conversationEvents.forEach(event => {
      events.push({ ...event, subjectArea: conversation.subjectArea, educationLevel: conversation.educationLevel });
      snapshots.push(event.riskScore || 0);
    });
    if (allTime && conversationEvents.length === 0 && conversation.interventionMetrics) {
      snapshots.push(conversation.interventionMetrics.lastRiskScore || 0);
    }
  }

  const latestAssessment = [...(user.dependencyAssessments || [])]
    .filter(assessment => assessmentInRange(assessment, from, to))
    .sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt))[0] || null;
  const answerEvents = events.filter(event => event.type === 'answer_checked');
  const riskScore = average(snapshots);
  const latestActivity = [
    ...events.map(event => event.at),
    ...(allTime ? relevantConversations.map(conversation => conversation.updatedAt) : []),
  ].filter(Boolean).sort((a, b) => new Date(b) - new Date(a))[0] || null;

  return {
    id: String(user._id),
    name: user.name || user.username,
    username: user.username,
    behavioralRisk: riskScore,
    riskLevel: riskLevel(riskScore),
    quiz: latestAssessment ? {
      score: latestAssessment.score,
      resultId: latestAssessment.resultId,
      submittedAt: latestAssessment.submittedAt,
    } : null,
    conversations: relevantConversations.length,
    hintRequests: events.filter(event => event.type === 'hint_requested').length,
    rapidHintRequests: events.filter(event => event.type === 'hint_requested' && event.details?.isRapid).length,
    fullAnswerRequests: events.filter(event => event.type === 'full_answer_requested').length,
    answerChecks: answerEvents.length,
    meaningfulAttempts: answerEvents.filter(event => event.details?.isMeaningfulAttempt).length,
    correctAnswers: answerEvents.filter(event => event.details?.isCorrect === true).length,
    gateCompletions: events.filter(event => event.type === 'gate_completed').length,
    attemptRate: answerEvents.length ? Math.round(answerEvents.filter(event => event.details?.isMeaningfulAttempt).length * 100 / answerEvents.length) : 0,
    correctRate: answerEvents.length ? Math.round(answerEvents.filter(event => event.details?.isCorrect === true).length * 100 / answerEvents.length) : 0,
    latestActivity,
    _events: events,
  };
};

const bucketFor = (event, groupBy) => {
  const date = new Date(event.at);
  if (groupBy === 'subject') return event.subjectArea || 'unknown';
  if (groupBy === 'riskLevel') return event.riskLevel || 'green';
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
  return event.riskScore || 0;
};

const buildChart = (students, metric = 'risk', groupBy = 'day') => {
  const buckets = new Map();
  students.flatMap(student => student._events).forEach(event => {
    const value = metricFor(event, metric);
    if (value === null || value === 0 && ['hints', 'fullAnswers'].includes(metric) && event.type !== (metric === 'hints' ? 'hint_requested' : 'full_answer_requested')) return;
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

const buildAnalytics = (users, conversations, filters = {}) => {
  const query = String(filters.search || '').trim().toLowerCase();
  const byUser = new Map();
  conversations.forEach(conversation => {
    const key = String(conversation.user);
    byUser.set(key, [...(byUser.get(key) || []), conversation]);
  });

  const students = users
    .map(user => buildStudent(user, byUser.get(String(user._id)) || [], filters))
    .filter(student => !query || `${student.name} ${student.username}`.toLowerCase().includes(query))
    .filter(student => !filters.riskLevel || student.riskLevel === filters.riskLevel)
    .sort((a, b) => b.behavioralRisk - a.behavioralRisk || new Date(b.latestActivity || 0) - new Date(a.latestActivity || 0));

  const riskDistribution = Object.keys(RISK_LABELS).reduce((distribution, level) => {
    distribution[level] = students.filter(student => student.riskLevel === level).length;
    return distribution;
  }, {});
  const quizScores = students.map(student => student.quiz?.score).filter(Number.isFinite);
  const summary = {
    totalStudents: students.length,
    activeStudents: students.filter(student => student._events.length > 0).length,
    averageBehavioralRisk: average(students.map(student => student.behavioralRisk)),
    averageQuizScore: quizScores.length ? Math.round(quizScores.reduce((sum, score) => sum + score, 0) / quizScores.length * 10) / 10 : null,
    riskDistribution,
  };
  const page = Math.max(1, Number(filters.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(filters.limit) || 20));
  const publicStudent = ({ _events, ...student }) => student;

  return {
    summary,
    chart: {
      metric: filters.metric || 'risk',
      groupBy: filters.groupBy || 'day',
      points: buildChart(students, filters.metric || 'risk', filters.groupBy || 'day'),
    },
    students: students.slice((page - 1) * limit, page * limit).map(publicStudent),
    exportStudents: students.map(publicStudent),
    pagination: { page, limit, total: students.length, totalPages: Math.max(1, Math.ceil(students.length / limit)) },
  };
};

module.exports = { buildAnalytics, buildStudent, riskLevel };
