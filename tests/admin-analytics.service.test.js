const assert = require('node:assert/strict');
const test = require('node:test');
const { buildAnalytics } = require('../src/services/admin-analytics.service');
const requireAdmin = require('../src/middleware/require-admin');
const { hasValidAnswers } = require('../src/controllers/quiz.controller');
const { quizQuestions } = require('../src/data/quiz-questions');

test('builds filtered student analytics without exposing conversations', () => {
  const users = [{ _id: 'student-1', name: 'Lan', username: 'lan', dependencyAssessments: [{ score: 32, resultId: 'dependent', submittedAt: '2026-07-20T00:00:00.000Z' }] }];
  const conversations = [{
    user: 'student-1', educationLevel: 'middle', subjectArea: 'mathematics', updatedAt: '2026-07-20T00:00:00.000Z',
    interventionMetrics: { lastRiskScore: 80 },
    dependencyEvents: [
      { type: 'hint_requested', at: '2026-07-20T08:00:00.000Z', riskScore: 40, riskLevel: 'yellow', details: { isRapid: true } },
      { type: 'answer_checked', at: '2026-07-20T08:05:00.000Z', riskScore: 35, riskLevel: 'yellow', details: { isCorrect: false, isMeaningfulAttempt: true } },
    ],
  }];
  const analytics = buildAnalytics(users, conversations, { metric: 'risk', groupBy: 'day' });

  assert.equal(analytics.summary.totalStudents, 1);
  assert.equal(analytics.students[0].behavioralRisk, 38);
  assert.equal(analytics.students[0].rapidHintRequests, 1);
  assert.equal(analytics.students[0].quiz.score, 32);
  assert.equal('history' in analytics.students[0], false);
  assert.deepEqual(analytics.chart.points, [{ label: '2026-07-20', value: 38 }]);
});

test('requires an admin role and validates all quiz answers', () => {
  let status;
  const response = { status(code) { status = code; return this; }, json() {} };
  requireAdmin({ user: { role: 'student' } }, response, () => assert.fail('next must not run'));
  assert.equal(status, 403);
  assert.equal(hasValidAnswers(Object.fromEntries(quizQuestions.map(question => [question.id, 'A']))), true);
  assert.equal(hasValidAnswers({ 1: 'A' }), false);
});
