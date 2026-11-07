const assert = require('node:assert/strict');
const test = require('node:test');
const {
  applyPracticeResult,
  buildPracticePrompt,
  canShowPracticeSolution,
  getPracticeSourceQuestion,
  getConversationTitle,
  conservationReply,
  explainMassConservation,
  guidanceNumberIssue,
  isMassConservationSource,
  massConservationIssue,
  sameSubstanceIssue,
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

test('does not duplicate an expression already present in the math prompt', () => {
  const expression = '\\frac{1}{9} - 0,3 \\cdot \\frac{5}{9} + \\frac{1}{3} + 5';
  const source = getPracticeSourceQuestion({
    problemContext: {
      activeQuestionId: '1a',
      questions: [{
        id: '1a',
        prompt: `Thực hiện phép tính: ${expression}`,
        sourceExpression: expression,
      }],
    },
  });

  assert.equal(source, `Thực hiện phép tính: ${expression}`);
  assert.equal(source.includes(expression + '\n' + expression), false);
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
  assert.match(prompt, /Chỉ được đổi số liệu/);
  assert.match(prompt, /không tiết lộ đáp án bài gốc/);
  assert.match(prompt, /Giữ đúng DẠNG lời giải/);
});

const MASS_SOURCE = 'Cho 5,6 g sắt (Fe) tác dụng vừa đủ với dung dịch chứa 7,3 g hydrochloric acid (HCl), thu được 12,7 g iron(II) chloride (FeCl₂) và x g khí hydrogen (H₂). Tính x.';

test('rejects a conservation question that drops a given mass', () => {
  assert.equal(isMassConservationSource(MASS_SOURCE), true);
  const issue = massConservationIssue(
    MASS_SOURCE,
    'Cho 4,8 g magie (Mg) tác dụng hoàn toàn với dung dịch hydrochloric acid (HCl), thu được 19 g magnesium chloride (MgCl₂) và một lượng khí hydrogen (H₂). Hãy áp dụng định luật bảo toàn khối lượng để tính khối lượng khí hydrogen thoát ra.',
    '0,4 g',
    '0,4 g',
  );
  assert.match(issue, /ít nhất ba khối lượng/);
});

test('accepts a conservation question that keeps the same substances and the matching unknown', () => {
  const prompt = 'Cho 4,2 g sắt (Fe) tác dụng vừa đủ với dung dịch chứa 5,1 g hydrochloric acid (HCl), thu được 8,8 g iron(II) chloride (FeCl₂) và x g khí hydrogen (H₂). Tính x.';
  assert.equal(massConservationIssue(MASS_SOURCE, prompt, '4,2 + 5,1 - 8,8 = 0,5 g', '0,5 g'), '');
  assert.equal(sameSubstanceIssue(MASS_SOURCE, prompt), '');
});

test('does not treat the C in Cân or Cho as carbon', () => {
  const source = 'Cân bằng PTHH: Mg+Hcl->MgCl2+H2';
  const prompt = 'Cân bằng phương trình: Mg + 2HCl -> MgCl2 + H2';
  assert.equal(sameSubstanceIssue(source, prompt), '');
  assert.equal(sameSubstanceIssue('Cho 4 g C cháy trong O2 tạo CO2', 'Cho 2 g C cháy trong O2 tạo CO2'), '');
  assert.match(sameSubstanceIssue('C + O2 -> CO2', 'O2 tạo O2'), /C/);
});

test('rejects a conservation question that swaps iron for zinc', () => {
  const prompt = 'Cho 6,5 g kẽm (Zn) tác dụng hoàn toàn với dung dịch chứa 7,3 g hydrochloric acid (HCl). Sau phản ứng, người ta thu được 13,6 g muối zinc chloride (ZnCl₂) và x g khí hydrogen (H₂). Giá trị của x là:';
  assert.match(sameSubstanceIssue(MASS_SOURCE, prompt), /Fe/);
});

test('explains a conservation reply with the real sum and the unknown', () => {
  const prompt = 'Cho 16,8 g sắt (Fe) tác dụng vừa đủ với dung dịch chứa 21,9 g HCl, thu được 38,1 g FeCl₂ và x g H₂. Tính x.';
  const explanation = explainMassConservation(prompt, 'D (0,8)');
  assert.match(explanation.feedback, /Lựa chọn D \(0,8\) chưa đúng/);
  assert.match(explanation.feedback, /16,8 \+ 21,9 = 38,7/);
  assert.match(explanation.feedback, /x = 0,6/);
  const variant = { prompt, options: [{ id: 'D', text: '0,8 g' }], answerGuide: '0,6 g' };
  assert.equal(guidanceNumberIssue(variant, explanation.feedback), '');
  assert.match(guidanceNumberIssue(variant, '16,8 + 21,9 = 38,1'), /không khép/);
  assert.match(guidanceNumberIssue(variant, 'Khối lượng là 99 g'), /không có trong đề/);
});

test('grades fill-blank and long-answer conservation without calling the model', () => {
  const prompt = 'Cho 16,8 g sắt (Fe) tác dụng vừa đủ với dung dịch chứa 21,9 g HCl, thu được 38,1 g FeCl₂ và x g H₂. Theo định luật bảo toàn khối lượng, giá trị của x là _____.';
  const fill = { prompt, answerGuide: '0,6 g' };
  const correct = conservationReply(fill, 'attempt', '0,6 gam');
  assert.equal(correct.isCorrect, true);
  assert.match(correct.feedback, /0,6/);

  const wrong = conservationReply(fill, 'attempt', '5,6');
  assert.equal(wrong.isCorrect, false);
  assert.match(wrong.feedback, /16,8 \+ 21,9 = 38,7/);
  assert.doesNotMatch(wrong.feedback, /5,6 g sắt/);

  const longWrong = conservationReply({ prompt, answerGuide: '0,6' }, 'attempt', 'x = 1');
  assert.equal(longWrong.isCorrect, false);
  assert.match(longWrong.feedback, /x = 0,6/);

  const hint = conservationReply(fill, 'hint');
  assert.equal(hint.isCorrect, null);
  assert.match(hint.hint, /16,8 \+ 21,9/);
});

test('allows intermediate sums for non-chemistry questions', () => {
  const variant = { prompt: 'Tính 17 - 8 = ?', answerGuide: '9' };
  assert.equal(guidanceNumberIssue(variant, 'Vì 8 + 9 = 17 nên hiệu là 9.'), '');
});

test('rejects a conservation answer that does not match the mass sum', () => {
  const prompt = 'Cho 3,2 g đồng (Cu) tác dụng vừa đủ với dung dịch chứa 7,3 g HCl, thu được 9,9 g muối và x g khí H₂. Tính x.';
  const issue = massConservationIssue(MASS_SOURCE, prompt, 'Đáp án là 0,4 g', '0,4 g');
  assert.match(issue, /không khớp phép cộng trừ/);
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
