const assert = require('node:assert/strict');
const test = require('node:test');
const {
  applyPracticeResult,
  buildPracticePrompt,
  canShowPracticeSolution,
  getPracticeSourceQuestion,
  getConversationTitle,
  parseJson,
  validateGeneratedPractice,
  toPublicPracticeItem,
  ensurePracticeVariant,
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

test('uses the first real user message as the saved conversation title', () => {
  assert.equal(getConversationTitle({
    history: [
      { role: 'user', parts: [{ text: 'Bạn là một người thầy thân thiện và kiên nhẫn' }] },
      { role: 'user', parts: [{ text: 'Giúp em giải phương trình này' }] },
    ],
  }), 'Giúp em giải phương trình này');
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

test('requires the requested type and excludes existing questions from the next prompt', () => {
  const item = {
    sourceQuestion: 'Tính 12 + 5',
    blocker: 'calculation',
    practice: { variants: [{ questionType: 'long_answer', prompt: 'Tính 20 + 4.' }] },
  };
  const prompt = buildPracticePrompt(item, 'vi', 'multiple_choice');

  assert.match(prompt, /loại câu bắt buộc: multiple_choice/i);
  assert.match(prompt, /Tính 20 \+ 4/);
  assert.match(prompt, /questionType chính xác là "multiple_choice"/);
  assert.equal(validateGeneratedPractice({ prompt: 'Câu', hint: 'Gợi ý', answerGuide: 'A', questionType: 'true_false' }, 'multiple_choice'), null);
});

test('accepts Gemini JSON containing raw LaTex backslashes', () => {
  const rawJson = `{"feedback":"Ta có ${'\\'}(x+1${'\\'})^2","nextQuestion":"Thử khai triển biểu thức."}`;
  const parsed = parseJson(rawJson);

  assert.equal(parsed.feedback, 'Ta có \\(x+1\\)^2');
  assert.equal(parsed.nextQuestion, 'Thử khai triển biểu thức.');
});

test('keeps LaTeX commands that share a letter with JSON escapes', () => {
  const rawJson = `{"prompt":"Al + HCl ${'\\'}rightarrow AlCl_3 va ${'\\'}frac{1}{2}","note":"dong 1\\ndong 2"}`;
  const parsed = parseJson(rawJson);

  assert.equal(parsed.prompt, 'Al + HCl \\rightarrow AlCl_3 va \\frac{1}{2}');
  assert.equal(parsed.note, 'dong 1\ndong 2');
});

test('uses safe pagination defaults and limits', () => {
  assert.equal(parsePagination('bad', 6, 24), 6);
  assert.equal(parsePagination('30', 6, 24), 24);
  assert.equal(parsePagination('2', 6, 24), 2);
});

test('validates each generated practice format before saving it', () => {
  const base = { prompt: 'Câu mới', hint: 'Đọc kỹ đề', answerGuide: 'Đáp án' };
  assert.equal(validateGeneratedPractice({ ...base, questionType: 'long_answer' }, 'long_answer').questionType, 'long_answer');
  const options = ['A', 'B', 'C', 'D'].map(id => ({ id, text: id }));
  assert.equal(validateGeneratedPractice({ ...base, questionType: 'multiple_choice', options, correctOptionId: 'A' }, 'multiple_choice').correctOptionId, 'A');
  assert.equal(validateGeneratedPractice({ ...base, questionType: 'true_false', correctAnswer: false }, 'true_false').correctAnswer, false);
  assert.equal(validateGeneratedPractice({ ...base, questionType: 'fill_blank', prompt: 'Điền _____ vào đây' }, 'fill_blank').questionType, 'fill_blank');
  assert.equal(validateGeneratedPractice({ ...base, questionType: 'multiple_choice', options: options.slice(0, 2), correctOptionId: 'A' }, 'multiple_choice'), null);
  assert.equal(validateGeneratedPractice(base, 'fill_blank'), null);
});

test('does not expose legacy practice as a question variant', () => {
  const publicItem = toPublicPracticeItem({
    _id: 'item-1', conversationTitle: 'Tiêu đề cuộc trò chuyện', sourceQuestion: 'Câu gốc', blocker: 'start', status: 'new', reviewCount: 0,
    practice: { prompt: 'Câu cũ', hint: 'Gợi ý cũ', answerGuide: 'Bí mật', turns: [], incorrectAttempts: 0 },
  });

  assert.deepEqual(publicItem.variants, []);
  assert.equal(publicItem.title, 'Tiêu đề cuộc trò chuyện');
  assert.equal(ensurePracticeVariant({ practice: { prompt: 'Câu cũ', variants: [] } }, 'long_answer'), null);
});
