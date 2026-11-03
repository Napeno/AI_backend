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

test('replaces a stuck image problem when the student pastes a new exercise', async () => {
  const conversation = {
    problemContext: {
      sourceText: 'Hằng đẳng thức là gì?',
      sourceImage: { url: 'https://example.com/old.jpg' },
      questions: [{ id: 'main', prompt: 'Hằng đẳng thức là gì?' }],
      suggestedQuestionId: 'main',
      activeQuestionId: 'main',
    },
    history: [{
      role: 'user',
      parts: [{ text: 'Bài 2. Viết lại các đa thức thành vế kia.\na. 4x^2 - 4x^2 + 1\nd. 1 - 10x + 25x^2' }],
    }],
    markModified() {},
  };

  const pasted = conversation.history[0].parts[0].text;
  setTextProblemContext(conversation, pasted);
  assert.equal(conversation.problemContext.sourceText, pasted);
  assert.equal(conversation.problemContext.sourceImage, undefined);
  assert.equal(conversation.problemContext.activeQuestionId, 'main');

  conversation.problemContext = {
    sourceText: 'Hằng đẳng thức là gì?',
    questions: [{ id: 'main', prompt: 'Hằng đẳng thức là gì?' }],
    activeQuestionId: 'main',
  };
  const context = await ensureProblemContext(conversation, 'vi');
  assert.equal(context.sourceText, pasted);
  assert.equal(context.activeQuestionId, 'main');
});
