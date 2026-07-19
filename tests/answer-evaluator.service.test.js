const assert = require('node:assert/strict');
const test = require('node:test');
const { areEquivalent, normalizeExpression, parseSafeExpression } = require('../src/services/answer-evaluator.service');
const { ensureProblemContext, setActiveQuestion, setTextProblemContext, toPublicProblemContext } = require('../src/services/problem-context.service');

test('checks algebraic equivalence with safe mathjs expressions', () => {
  assert.equal(areEquivalent('x² - x + 1/4', '(x - 1/2)^2'), true);
  assert.equal(areEquivalent('x² - x + 1/4', '(x + 1/2)^2'), false);
});

test('normalizes supported math symbols without accepting executable syntax', () => {
  assert.equal(normalizeExpression('3 × 2·y − 3**2 ÷ 2'), '3 * 2*y - 3^2 / 2');
  assert.ok(parseSafeExpression('3*2*y'));
  assert.equal(parseSafeExpression('sqrt(x)'), null);
  assert.equal(parseSafeExpression('x = 1'), null);
  assert.equal(parseSafeExpression('import("fs")'), null);
});

test('keeps an explicit current question and exposes only public problem data', () => {
  const conversation = { problemContext: {}, markModified() {} };
  setTextProblemContext(conversation, 'Tính x + 1');
  conversation.problemContext.questions = [
    { id: 'a', prompt: 'Câu a' },
    { id: 'd', prompt: 'Câu d', sourceExpression: 'x² - x + 1/4' },
  ];
  conversation.problemContext.activeQuestionId = null;
  conversation.problemContext.suggestedQuestionId = 'd';

  assert.equal(setActiveQuestion(conversation, 'd').activeQuestionId, 'd');
  assert.equal(setActiveQuestion(conversation, 'missing'), null);
  assert.deepEqual(toPublicProblemContext(conversation.problemContext).questions[1], {
    id: 'd', prompt: 'Câu d', sourceExpression: 'x² - x + 1/4',
  });
});

test('automatically uses the suggested image question while allowing a later change', async () => {
  const conversation = {
    problemContext: {
      questions: [{ id: 'a', prompt: 'Câu a' }, { id: 'd', prompt: 'Câu d' }],
      suggestedQuestionId: 'd',
    },
    markModified() {},
  };

  const context = await ensureProblemContext(conversation, 'vi');
  assert.equal(context.activeQuestionId, 'd');
  assert.equal(setActiveQuestion(conversation, 'a').activeQuestionId, 'a');
});
