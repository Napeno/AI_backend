const assert = require('node:assert/strict');
const test = require('node:test');
const {
  applyPracticeResult,
  buildPracticePrompt,
  canShowPracticeSolution,
  getFallbackPractice,
  getPracticeSourceQuestion,
  parseJson,
} = require('../src/services/practice.service');
const { parsePagination } = require('../src/controllers/practice.controller');

test('schedules successful practice reviews at 1, 3, then 7 days and marks mastery', () => {
  const item = { reviewCount: 0 };
  const now = new Date('2026-07-18T00:00:00.000Z');

  applyPracticeResult(item, true, now);
  assert.equal(item.status, 'reviewed');
  assert.equal(item.reviewCount, 1);
  assert.equal(item.nextReviewAt.toISOString(), '2026-07-19T00:00:00.000Z');

  applyPracticeResult(item, true, now);
  assert.equal(item.reviewCount, 2);
  assert.equal(item.nextReviewAt.toISOString(), '2026-07-21T00:00:00.000Z');

  applyPracticeResult(item, true, now);
  assert.equal(item.status, 'mastered');
  assert.equal(item.reviewCount, 3);
  assert.equal(item.nextReviewAt.toISOString(), '2026-07-25T00:00:00.000Z');
});

test('keeps an incorrect practice item due now without changing rewards', () => {
  const item = { reviewCount: 1, status: 'reviewed' };
  const now = new Date('2026-07-18T00:00:00.000Z');

  applyPracticeResult(item, false, now);

  assert.equal(item.status, 'needs_review');
  assert.equal(item.reviewCount, 1);
  assert.equal(item.nextReviewAt, now);
  assert.equal(item.coins, undefined);
  assert.equal(item.points, undefined);
});

test('provides a non-quiz fallback prompt for each saved blocker', () => {
  const practice = getFallbackPractice({ blocker: 'start' }, 'vi');

  assert.match(practice.prompt, /việc đầu tiên/);
  assert.match(practice.hint, /dữ kiện/);
});

test('uses the selected conversation question as the practice source', () => {
  const source = getPracticeSourceQuestion({
    history: [{ role: 'user', parts: [{ text: 'Đề dài cũ' }] }],
    problemContext: {
      activeQuestionId: 'b',
      questions: [
        { id: 'a', prompt: 'Câu a' },
        { id: 'b', prompt: 'Câu b', sourceExpression: 'x + 4' },
      ],
    },
  });

  assert.equal(source, 'Câu b\nx + 4');
});

test('requires two meaningful incorrect attempts before showing a sample solution', () => {
  assert.equal(canShowPracticeSolution({ practice: { incorrectAttempts: 1 } }), false);
  assert.equal(canShowPracticeSolution({ practice: { incorrectAttempts: 2 } }), true);
});

test('asks Gemini for a new similar task rather than the original question', () => {
  const prompt = buildPracticePrompt({
    sourceQuestion: 'Tính 12 + 5',
    blocker: 'calculation',
    sourceFeedback: '',
  }, 'vi');

  assert.match(prompt, /bài MỚI/);
  assert.match(prompt, /không sao chép/);
  assert.match(prompt, /không tiết lộ đáp án bài gốc/);
});

test('accepts Gemini JSON containing raw LaTex backslashes', () => {
  const rawJson = `{"feedback":"Ta có ${'\\'}(x+1${'\\'})^2","nextQuestion":"Thử khai triển biểu thức."}`;
  const parsed = parseJson(rawJson);

  assert.equal(parsed.feedback, 'Ta có \\(x+1\\)^2');
  assert.equal(parsed.nextQuestion, 'Thử khai triển biểu thức.');
});

test('uses safe pagination defaults and limits', () => {
  assert.equal(parsePagination('bad', 6, 24), 6);
  assert.equal(parsePagination('30', 6, 24), 24);
  assert.equal(parsePagination('2', 6, 24), 2);
});
