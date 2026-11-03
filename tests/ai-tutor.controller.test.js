const assert = require('node:assert/strict');
const test = require('node:test');
const { filterVisibleLessons, isUsableLesson } = require('../src/controllers/ai-tutor.controller');

const usableLesson = (overrides = {}) => ({
  sessionId: 'session-1',
  generationVersion: 14,
  questions: Array.from({ length: 5 }, (_, index) => ({
    id: `q${index + 1}`,
    prompt: 'Câu hỏi',
    options: [{}, {}, {}, {}],
    tutorSteps: [
      { id: 's1', explanation: 'Tính.', analysis: 'Thực hiện phép tính.', hint: 'Tính theo đúng thứ tự.', easierExample: { prompt: 'Tính 2 + 2.', answer: '4', hint: 'Cộng hai số.' } },
      { id: 's2', explanation: 'Kiểm tra.', analysis: 'Đối chiếu kết quả.', hint: 'Đối chiếu với đề bài.', easierExample: { prompt: 'Kiểm tra 2 + 2 = 4.', answer: '4', hint: 'Đối chiếu kết quả.' } },
    ],
  })),
  ...overrides,
});

test('hides stale AI tutor lessons that cannot be opened from Chat', () => {
  const lessons = [
    usableLesson({ sourceText: 'Bản mới' }),
    usableLesson({ sourceText: 'Bản cũ' }),
    usableLesson({ sessionId: 'deleted-session' }),
    usableLesson({ generationVersion: 7 }),
    usableLesson({ archived: true, sourceQuestionId: 'archived', sourceText: 'Bài đã lưu trữ' }),
  ];

  assert.deepEqual(
    filterVisibleLessons(lessons, new Set(['session-1'])),
    [lessons[0]],
  );
  assert.equal(isUsableLesson(usableLesson({ archived: true })), false);
  assert.equal(isUsableLesson(usableLesson()), true);
});
