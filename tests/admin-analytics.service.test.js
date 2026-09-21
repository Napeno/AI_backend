const assert = require('node:assert/strict');
const test = require('node:test');
const { buildAnalytics } = require('../src/services/admin-analytics.service');
const { getRiskLevel } = require('../src/services/intervention.service');
const requireAdmin = require('../src/middleware/require-admin');
const { hasValidAnswers } = require('../src/controllers/quiz.controller');
const { quizQuestions } = require('../src/data/quiz-questions');

test('builds filtered student analytics without exposing conversations', () => {
  const users = [{ _id: 'student-1', name: 'Lan', username: 'lan', dependencyAssessments: [{ score: 32, resultId: 'dependent', submittedAt: '2026-07-20T00:00:00.000Z' }] }];
  const conversations = [{
    user: 'student-1', educationLevel: 'middle', subjectArea: 'mathematics', updatedAt: '2026-07-20T00:00:00.000Z',
    interventionMetrics: { riskScore: 80, riskLevel: 'high' },
    dependencyEvents: [
      { type: 'hint_requested', at: '2026-07-20T08:00:00.000Z', riskScore: 40, riskLevel: 'watch', rulesetVersion: 'v2', details: { isRapid: true } },
      { type: 'answer_checked', at: '2026-07-20T08:05:00.000Z', riskScore: 35, riskLevel: 'watch', rulesetVersion: 'v2', details: { isCorrect: false, isMeaningfulAttempt: true } },
    ],
  }];
  const analytics = buildAnalytics(users, conversations, { metric: 'risk', groupBy: 'day' });

  assert.equal(analytics.summary.totalStudents, 1);
  assert.equal(analytics.students[0].behavioralRisk, 35);
  assert.equal(analytics.students[0].baselineScore, 40);
  assert.equal(analytics.students[0].improvement, 5);
  assert.equal(analytics.students[0].source, 'real');
  assert.equal(analytics.students[0].rapidHintRequests, 1);
  assert.equal(analytics.students[0].quiz.score, 32);
  assert.equal('history' in analytics.students[0], false);
  assert.deepEqual(analytics.chart.points, [{ label: '2026-07-20', value: 38 }]);
  assert.equal(analytics.breakdowns.behaviors.items.find(item => item.key === 'hintRequests').value, 1);
  assert.deepEqual(analytics.breakdowns.riskBySubject, [{ label: 'mathematics', low: 0, watch: 1, high: 0 }]);
  assert.deepEqual(analytics.breakdowns.heuristicClassification.levels, [
    { key: 'high', label: 'Cao', color: '#ef4444', before: 0, after: 0 },
    { key: 'medium', label: 'Trung bình', color: '#f59e0b', before: 1, after: 1 },
    { key: 'low', label: 'Thấp', color: '#10b981', before: 0, after: 0 },
  ]);
});

test('sorts the paginated table by the selected analytics column', () => {
  const users = [
    { _id: 'student-1', name: 'An', username: 'an' },
    { _id: 'student-2', name: 'Bình', username: 'binh' },
  ];
  const conversations = [
    { user: 'student-1', dependencyEvents: [{ at: '2026-07-20T00:00:00.000Z', riskScore: 40, riskLevel: 'watch', rulesetVersion: 'v2', details: {} }] },
    { user: 'student-2', dependencyEvents: [{ at: '2026-07-20T00:00:00.000Z', riskScore: 90, riskLevel: 'high', rulesetVersion: 'v2', details: {} }] },
  ];
  const analytics = buildAnalytics(users, conversations, { sortBy: 'name', sortOrder: 'desc' });
  assert.deepEqual(analytics.students.map(student => student.name), ['Bình', 'An']);
});

test('uses baseline analytics when real event tracking is absent', () => {
  const analytics = buildAnalytics([{ _id: 'student-2', name: 'Mai', username: 'mai' }], [], {});
  assert.equal(analytics.students[0].source, 'baseline');
  assert.equal(analytics.students[0].behavioralRisk, 0);
  assert.equal(analytics.summary.demoStudents, 0);
});

test('requires an admin role and validates all quiz answers', () => {
  let status;
  const response = { status(code) { status = code; return this; }, json() {} };
  requireAdmin({ user: { role: 'student' } }, response, () => assert.fail('next must not run'));
  assert.equal(status, 403);
  assert.equal(hasValidAnswers(Object.fromEntries(quizQuestions.map(question => [question.id, 'A']))), true);
  assert.equal(hasValidAnswers({ 1: 'A' }), false);
});
