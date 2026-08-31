const assert = require('node:assert/strict');
const test = require('node:test');
const { fallbackQuestion, sanitizeQuestion, fallbackLesson, sanitizeLesson } = require('../src/services/ai-tutor.service');

test('keeps AI tutor questions to four safe choices and four steps', () => {
  const question = sanitizeQuestion({
    title: '  <b>Đường đi</b> ',
    prompt: 'Chọn đường ngắn nhất.',
    diagram: { type: 'route', start: 'A', end: 'B', labels: ['3 phút', '5 phút'] },
    options: [{ id: 'A', text: '3' }, { id: 'B', text: '4' }, { id: 'C', text: '5' }, { id: 'D', text: '6' }, { id: 'E', text: '7' }],
    correctId: 'B',
    steps: [{ title: 'B1', content: 'So sánh.' }, { title: 'B2', content: 'Cộng.' }, { title: 'B3', content: 'Chọn.' }, { title: 'B4', content: 'Kiểm tra.' }, { title: 'B5', content: 'Bỏ.' }],
    hint: 'Đọc nhãn.',
  });
  assert.equal(question.title, 'Đường đi');
  assert.equal(question.options.length, 4);
  assert.equal(question.steps.length, 4);
  assert.equal(question.correctId, 'B');
  assert.equal(question.diagram.type, 'route');
});

test('has a usable visual-question fallback when generation is unavailable', () => {
  const question = fallbackQuestion();
  assert.equal(question.options.length, 4);
  assert.equal(question.steps.length, 4);
  assert.equal(question.diagram.type, 'geometry');
});

test('keeps lesson answers and drag tokens in a bounded, server-checkable shape', () => {
  const lesson = sanitizeLesson({ questions: [{ options: [{ id: 'A', text: 'Đúng' }, { id: 'B', text: 'Sai' }, { id: 'C', text: 'Sai' }, { id: 'D', text: 'Sai' }], correctOptionId: 'A', tutorSteps: [{ blanks: [{ id: 'b', label: 'Ô', expectedTokenId: 'good' }], tokens: [{ id: 'good', label: '2', type: 'number' }] }] }] }, { sourceText: '2 + 2 = ?', questionId: 'main' });
  assert.equal(lesson.questions.length, 5);
  assert.equal(lesson.questions[0].options.length, 4);
  assert.equal(lesson.questions[0].tutorSteps[0].blanks[0].expectedTokenId, 'good');
  assert.ok(lesson.questions[0].tutorSteps.length >= 3);
  assert.equal(fallbackLesson().questions[0].options.length, 4);
});

test('preserves a bounded non-math interaction for sequence learning', () => {
  const lesson = sanitizeLesson({ questions: [{ interactionType: 'sort_sequence', options: [{ id: 'A', text: 'Đúng' }, { id: 'B', text: 'Sai' }, { id: 'C', text: 'Sai' }, { id: 'D', text: 'Sai' }], correctOptionId: 'A', tutorSteps: [{ interaction: { type: 'sort_sequence', items: [{ id: 'first', text: 'Bước đầu', order: 1 }, { id: 'last', text: 'Bước cuối', order: 2 }] } }] }] }, { sourceText: 'Quy trình thí nghiệm', subjectArea: 'natural_sciences', course: 'biology' });
  assert.equal(lesson.questions[0].interactionType, 'sort_sequence');
  assert.equal(lesson.questions[0].tutorSteps[0].interaction.items.length, 2);
});

test('always gives every supported learning mode a usable continuation interaction', () => {
  ['label_diagram', 'sort_sequence', 'match_pairs', 'cloze', 'evidence_choice', 'cause_effect'].forEach(interactionType => {
    const lesson = sanitizeLesson({ questions: [{ interactionType, options: [{ id: 'A', text: 'Đúng' }, { id: 'B', text: 'Sai' }, { id: 'C', text: 'Sai' }, { id: 'D', text: 'Sai' }], correctOptionId: 'A', tutorSteps: [{ title: 'Bước', explanation: 'Giải thích' }] }] }, { sourceText: 'Bài test' });
    assert.ok(lesson.questions[0].tutorSteps[0].interaction, interactionType);
  });
});

test('keeps Gemini SVG visuals while stripping executable content', () => {
  const lesson = sanitizeLesson({ questions: [{ visual: { kind: 'svg', spec: { svg: '<svg><rect /></svg><script>alert(1)</script>' } }, options: [{ id: 'A', text: 'Đúng' }, { id: 'B', text: 'Sai' }, { id: 'C', text: 'Sai' }, { id: 'D', text: 'Sai' }], correctOptionId: 'A', tutorSteps: [{ title: 'Bước', explanation: 'Giải thích' }] }] }, { sourceText: 'Bài test' });
  assert.equal(lesson.questions[0].visual.kind, 'svg');
  assert.doesNotMatch(lesson.questions[0].visual.spec.svg, /script/i);
});

test('forces math subjects to use token practice without SVG visuals', () => {
  ['mathematics', 'physics', 'chemistry'].forEach(course => {
    const lesson = sanitizeLesson({ questions: [{
      interactionType: 'label_diagram',
      visual: { kind: 'svg', spec: { svg: '<svg><rect /></svg>' } },
      options: [{ id: 'A', text: 'Đúng' }, { id: 'B', text: 'Sai' }, { id: 'C', text: 'Sai' }, { id: 'D', text: 'Sai' }],
      correctOptionId: 'A',
      tutorSteps: [{ explanation: 'Tách biểu thức.', interaction: { type: 'label_diagram', pairs: [{ id: 'p1', left: 'x', right: 'y' }] } }],
    }] }, { sourceText: '2x + 1 = 5', subjectArea: 'natural_sciences', course });
    assert.equal(lesson.questions.length, 5);
    assert.ok(lesson.questions.every(question => question.interactionType === 'math_tokens'));
    assert.ok(lesson.questions.every(question => question.visual.kind === 'none'));
    assert.ok(lesson.questions[0].tutorSteps.every(step => !step.interaction && step.blanks.length && step.tokens.length));
  });
});

test('builds algebra practice from the expression in the source problem', () => {
  const lesson = fallbackLesson({ sourceText: 'Khai triển (x + 3)^2', language: 'vi', subjectArea: 'mathematics', course: 'mathematics' });

  assert.match(lesson.questions[0].prompt, /\(x \+ 3\)²/);
  assert.equal(lesson.questions[0].options[0].text, '(a ± b)² = a² ± 2ab + b²');
  assert.match(lesson.questions[1].prompt, /\(x \+ 3\)²/);
  assert.equal(lesson.questions[0].tutorSteps.length, 3);
  assert.match(lesson.questions[0].tutorSteps[1].explanation, /2 × 3 × x/);
  assert.equal(lesson.questions[0].tutorSteps[1].blanks[0].expectedTokenId, 'middle-term');
  assert.equal(lesson.questions[0].tutorSteps[2].tokens[0].label, 'x² + 6x + 9');
  assert.match(lesson.questions[2].options[0].text, /x² \+ 6x \+ 9/);
});

test('creates a same-topic example when the source only names the algebra topic', () => {
  const lesson = fallbackLesson({ sourceText: 'hằng đẳng thức lớp 8', language: 'vi', subjectArea: 'mathematics', course: 'mathematics' });

  assert.match(lesson.questions[0].prompt, /\(a \+ 2\)²/);
  assert.match(lesson.questions[2].prompt, /\(a \+ 2\)²/);
  assert.match(lesson.questions[2].options[0].text, /a² \+ 4a \+ 4/);
  assert.ok(lesson.questions.every(question => question.interactionType === 'math_tokens'));
});

test('keeps all five algebra questions aligned with their own guidance', () => {
  const questions = fallbackLesson({ sourceText: 'hằng đẳng thức lớp 8', language: 'vi', subjectArea: 'mathematics', course: 'mathematics' }).questions;

  assert.equal(questions.length, 5);
  assert.deepEqual(questions.map(question => question.tutorSteps[0].title), [
    'Xác định công thức',
    'Nhận diện số hạng giữa',
    'Tách ba phần',
    'Nhận diện dạng',
    'Thay giá trị',
  ]);
  assert.equal(questions[4].tutorSteps[2].title, 'Kết luận');
  assert.match(questions[4].tutorSteps[2].explanation, /Bình phương/);
  assert.match(questions[3].tutorSteps[0].analysis, /tương đương/);
  assert.match(questions[4].tutorSteps[0].analysis, /a = 1/);
  assert.ok(questions.every(question => question.tutorSteps.every(step => step.analysis && step.easierExample?.prompt)));
});

test('adds analysis and an easier example to algebra guidance', () => {
  const question = fallbackLesson({ sourceText: 'hằng đẳng thức lớp 8', language: 'vi', subjectArea: 'mathematics', course: 'mathematics' }).questions[0];

  assert.match(question.tutorSteps[0].analysis, /Phân tích/);
  assert.match(question.tutorSteps[0].easierExample.prompt, /\(a \+ 1\)²/);
  assert.equal(question.tutorSteps[0].easierExample.answer, '(a + b)² = a² + 2ab + b²');
});

test('replaces generic algebra tutor steps with source-specific steps', () => {
  const lesson = sanitizeLesson({ questions: [{
    title: 'Khai triển biểu thức',
    prompt: 'Chọn đáp án đúng cho (x + 3)^2.',
    options: [{ id: 'A', text: 'x² + 6x + 9' }, { id: 'B', text: 'x² + 3x + 9' }, { id: 'C', text: 'x² + 9' }, { id: 'D', text: '2x² + 9' }],
    correctOptionId: 'A',
    tutorSteps: [{ title: 'Xác định dữ kiện', explanation: 'Hãy đọc đề.' }],
  }] }, { sourceText: 'Bài toán: khai triển (x + 3)^2', language: 'vi', subjectArea: 'mathematics', course: 'mathematics' });

  assert.match(lesson.questions[0].tutorSteps[0].explanation, /\(x \+ 3\)²/);
  assert.match(lesson.questions[0].tutorSteps[1].explanation, /2 × 3 × x/);
  assert.match(lesson.questions[0].tutorSteps[2].explanation, /\(x \+ 3\)²/);
});

test('falls back to the original problem when Gemini returns an unrelated question', () => {
  const sourceText = 'Một vật chuyển động với vận tốc 5 m/s trong 3 giây. Tính quãng đường.';
  const lesson = sanitizeLesson({ questions: [{
    prompt: 'Khai triển (y + 9)^2.',
    options: [{ id: 'A', text: 'y² + 18y + 81' }, { id: 'B', text: 'y² + 9' }, { id: 'C', text: '2y + 9' }, { id: 'D', text: '81' }],
    correctOptionId: 'A',
    tutorSteps: [{ explanation: 'Hãy dùng định lý Pythagore cho tam giác vuông.' }],
  }] }, { sourceText, language: 'vi', subjectArea: 'natural_sciences', course: 'physics' });

  assert.match(lesson.questions[0].prompt, /vận tốc 5 m\/s trong 3 giây/);
  assert.doesNotMatch(lesson.questions[0].prompt, /Khai triển \(y \+ 9\)\^2/);
  assert.equal(lesson.questions[0].options[0].text, sourceText);
  assert.match(lesson.questions[0].tutorSteps[0].explanation, /vận tốc 5 m\/s trong 3 giây/);
});

test('restores five source-specific questions for a linear equation even without a selected course', () => {
  const lesson = fallbackLesson({ sourceText: 'giải giúp mình bài 2x + 5x = 32', language: 'vi', subjectArea: 'natural_sciences' });

  assert.equal(lesson.questions.length, 5);
  assert.ok(lesson.questions.every(question => question.interactionType === 'math_tokens'));
  assert.ok(lesson.questions.every(question => !/Làm rõ yêu cầu|đại lượng hoặc ý chính nào/.test(question.title + question.prompt)));
  assert.match(lesson.questions[0].prompt, /2x \+ 5x/);
  assert.match(lesson.questions[3].prompt, /Nghiệm/);
  assert.match(lesson.questions[0].tutorSteps[0].explanation, /2x \+ 5x = 32/);
});

test('restores five circuit questions around U4, R4, and U234', () => {
  const lesson = fallbackLesson({ sourceText: 'Câu c có phải là U4/R4, U4 sẽ bằng U234', language: 'vi', subjectArea: 'natural_sciences', course: 'natural_sciences' });

  assert.equal(lesson.questions.length, 5);
  assert.match(lesson.questions[0].options[0].text, /I₄ = U₄\/R₄/);
  assert.match(lesson.questions[1].options[0].text, /U₄ = U₂₃₄/);
  assert.ok(lesson.questions.every(question => question.options[0].text.includes('U')));
  assert.ok(lesson.questions.every(question => question.tutorSteps.length >= 3));
});

test('restores five chemistry questions for a balancing exercise', () => {
  const lesson = fallbackLesson({ sourceText: 'cân bằng PTHH sau: H2 + O2 -> H2O', language: 'vi', subjectArea: 'natural_sciences', course: 'natural_sciences' });

  assert.equal(lesson.questions.length, 5);
  assert.match(lesson.questions[3].options[0].text, /2H₂ \+ O₂ → 2H₂O/);
  assert.ok(lesson.questions.every(question => !question.title.includes('Làm rõ yêu cầu')));
});
