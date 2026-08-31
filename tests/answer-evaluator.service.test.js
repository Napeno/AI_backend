const assert = require('node:assert/strict');
const test = require('node:test');
const { ensureProblemContext, setActiveQuestion, setTextProblemContext, toPublicProblemContext } = require('../src/services/problem-context.service');

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

test('recognizes an unaccented Vietnamese request for a subquestion', async () => {
  const conversation = {
    problemContext: {
      sourceText: 'giai cau C di',
      questions: [{ id: 'a', prompt: 'Câu a' }, { id: 'c', prompt: 'Câu c' }],
      suggestedQuestionId: 'a',
      activeQuestionId: 'a',
    },
    markModified() {},
  };

  const context = await ensureProblemContext(conversation, 'vi');
  assert.equal(context.activeQuestionId, 'c');
  assert.equal(context.suggestedQuestionId, 'c');
});

test('keeps the original image context when a student asks a text follow-up', () => {
  const conversation = {
    problemContext: {
      sourceText: 'Đề bài trong ảnh',
      sourceImage: { url: 'https://example.com/problem.jpg' },
      questions: [{ id: 'c', prompt: 'Câu c trong ảnh' }],
      suggestedQuestionId: 'c',
      activeQuestionId: 'c',
    },
    markModified() {},
  };

  setTextProblemContext(conversation, 'Câu c có phải là U4/R4?');
  assert.equal(conversation.problemContext.sourceText, 'Đề bài trong ảnh');
  assert.equal(conversation.problemContext.sourceImage.url, 'https://example.com/problem.jpg');
  assert.equal(conversation.problemContext.activeQuestionId, 'c');
});
