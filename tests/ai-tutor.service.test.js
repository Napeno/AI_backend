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
  assert.equal(lesson.questions.length, 1);
  assert.equal(lesson.questions[0].options.length, 4);
  assert.equal(lesson.questions[0].tutorSteps[0].blanks[0].expectedTokenId, 'good');
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
