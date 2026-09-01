const assert = require('node:assert/strict');
const test = require('node:test');
const {
  applyPracticeResult,
  buildPracticePrompt,
  canShowPracticeSolution,
  getFallbackPractice,
  getFallbackGuidance,
  getPracticeSourceQuestion,
  parseJson,
  validateGeneratedPractice,
  toPublicPracticeItem,
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

test('gives each practice type a distinct generation contract', () => {
  assert.match(buildPracticePrompt({}, 'vi', 'multiple_choice'), /đúng 4 lựa chọn A, B, C, D/);
  assert.match(buildPracticePrompt({}, 'vi', 'true_false'), /đúng một mệnh đề/);
  assert.match(buildPracticePrompt({}, 'vi', 'fill_blank'), /đúng một chỗ trống dạng/);
  assert.match(buildPracticePrompt({}, 'vi', 'long_answer'), /đúng một câu tự luận rõ ràng/);
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

test('validates each generated practice format before saving it', () => {
  const base = { prompt: 'Câu mới', hint: 'Đọc kỹ đề', answerGuide: 'Đáp án' };
  assert.equal(validateGeneratedPractice(base, 'long_answer').questionType, 'long_answer');
  const options = ['A', 'B', 'C', 'D'].map(id => ({ id, text: id }));
  assert.equal(validateGeneratedPractice({ ...base, options, correctOptionId: 'A' }, 'multiple_choice').correctOptionId, 'A');
  assert.equal(validateGeneratedPractice({ ...base, correctAnswer: false }, 'true_false').correctAnswer, false);
  assert.equal(validateGeneratedPractice({ ...base, prompt: 'Điền _____ vào đây' }, 'fill_blank').questionType, 'fill_blank');
  assert.equal(validateGeneratedPractice({ ...base, options: options.slice(0, 2), correctOptionId: 'A' }, 'multiple_choice'), null);
  assert.equal(validateGeneratedPractice(base, 'fill_blank'), null);
});

test('exposes legacy practice as a long-answer variant without its answer guide', () => {
  const publicItem = toPublicPracticeItem({
    _id: 'item-1', sourceQuestion: 'Câu gốc', blocker: 'start', status: 'new', reviewCount: 0,
    practice: { prompt: 'Câu cũ', hint: 'Gợi ý cũ', answerGuide: 'Bí mật', turns: [], incorrectAttempts: 0 },
  });

  assert.equal(publicItem.variants[0].questionType, 'long_answer');
  assert.equal(publicItem.variants[0].answerGuide, undefined);
});

test('keeps short-answer practice usable when Gemini grading is unavailable', () => {
  const variant = { questionType: 'fill_blank', answerGuide: '8', hint: 'Trừ 7 khỏi 15.' };
  const result = getFallbackGuidance(variant, 'attempt', '8', 'fill_blank', 'vi');

  assert.equal(result.isCorrect, true);
  assert.equal(result.isMeaningfulAttempt, true);
  assert.match(result.feedback, /Chính xác/);
});

test('does not block a long-answer submission when Gemini grading is unavailable', () => {
  const result = getFallbackGuidance({ hint: 'Kiểm tra phép chuyển vế.' }, 'attempt', 'x = 19', 'long_answer', 'vi');

  assert.equal(result.isCorrect, null);
  assert.equal(result.isMeaningfulAttempt, true);
  assert.match(result.feedback, /chưa thể chấm/);
  assert.ok(result.nextQuestion);
});
