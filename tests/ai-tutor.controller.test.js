const assert = require('node:assert/strict');
const test = require('node:test');
const { filterVisibleLessons } = require('../src/controllers/ai-tutor.controller');

const usableLesson = (overrides = {}) => ({
  sessionId: 'session-1',
  generationVersion: 13,
  questions: Array.from({ length: 5 }, (_, index) => ({
    id: `q${index + 1}`,
    prompt: 'Câu hỏi',
    options: [{}, {}, {}, {}],
    tutorSteps: [
      { id: 's1', explanation: 'Tính.', analysis: 'Thực hiện phép tính.', hint: 'Tính theo đúng thứ tự.' },
      { id: 's2', explanation: 'Kiểm tra.', analysis: 'Đối chiếu kết quả.', hint: 'Đối chiếu với đề bài.' },
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
  ];

  assert.deepEqual(
    filterVisibleLessons(lessons, new Set(['session-1'])),
    [lessons[0]],
  );
});
