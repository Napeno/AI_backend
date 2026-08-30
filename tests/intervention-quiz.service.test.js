const assert = require('node:assert/strict');
const test = require('node:test');
const { buildMiniQuizPrompt } = require('../src/services/intervention-quiz.service');

test('asks Gemini to create a different mini quiz from the previous one', () => {
  const prompt = buildMiniQuizPrompt({ history: [{ role: 'user', parts: [{ text: 'Khai triển (a+b)^2' }] }] }, 'vi', {
    question: 'Khai triển (a+b)^2 là gì?',
    options: [{ id: 'A', text: 'a^2 + b^2' }],
  });

  assert.match(prompt, /Mỗi lần nhận yêu cầu, hãy tạo mới/);
  assert.match(prompt, /TUYỆT ĐỐI KHÔNG LẶP LẠI/);
  assert.match(prompt, /Khai triển \(a\+b\)\^2 là gì\?/);
  assert.match(prompt, /đổi kiểu kiểm tra/);
});

test('includes the full mini-quiz history in the generation prompt', () => {
  const prompt = buildMiniQuizPrompt({ history: [{ role: 'user', parts: [{ text: 'Khai triển (a+b)^2' }] }] }, 'vi', [
    { question: 'Câu hỏi cũ một', options: [{ text: 'A' }] },
    { question: 'Câu hỏi cũ hai', options: [{ text: 'B' }] },
  ]);

  assert.match(prompt, /Câu hỏi cũ một/);
  assert.match(prompt, /Câu hỏi cũ hai/);
  assert.match(prompt, /TẤT CẢ các câu trên/);
});

test('anchors mini quizzes to the original problem and selected course', () => {
  const prompt = buildMiniQuizPrompt({
    course: 'mathematics',
    problemContext: { sourceText: 'Khai triển (a+b)^2' },
    history: [{ role: 'user', parts: [{ text: 'Hằng đẳng thức lớp 8' }] }],
  }, 'vi');

  assert.match(prompt, /Đề gốc:\nKhai triển \(a\+b\)\^2/);
  assert.match(prompt, /Chỉ dùng kiến thức môn mathematics/);
  assert.match(prompt, /không đưa ví dụ liên môn/);
});
