const assert = require('node:assert/strict');
const test = require('node:test');
const {
  alignConversationSubject,
  inferSubjectFromContent,
  looksLikeChemistry,
  looksLikePureMathPrompt,
} = require('../src/services/subject-detect.service');
const {
  buildPracticePrompt,
  isOffSubjectPractice,
  resolvePracticeSubject,
} = require('../src/services/practice.service');
const { buildCurrentQuestionReminder } = require('../src/services/prompt.service');

test('detects short chemistry reactions even with HCL typo', () => {
  assert.equal(looksLikeChemistry('Mg+HCL'), true);
  assert.equal(looksLikeChemistry('CB PTHH sau: Mg + HCl -> MgCl2 + H2'), true);
  assert.equal(looksLikeChemistry('Cho 0,56g Zn vào dung dịch H2SO4 loãng'), true);
  assert.equal(looksLikeChemistry('2x + 7 = 13'), false);
});

test('realigns a math-tagged chat when the student pastes chemistry', () => {
  const conversation = {
    educationLevel: 'middle',
    subjectArea: 'mathematics',
    course: 'mathematics',
  };
  const changed = alignConversationSubject(conversation, 'Mg+HCL');
  assert.deepEqual(changed.next, {
    subjectArea: 'natural_sciences',
    course: 'natural_sciences',
    reason: 'chemistry',
  });
  assert.equal(conversation.subjectArea, 'natural_sciences');
  assert.equal(conversation.course, 'natural_sciences');
  assert.equal(alignConversationSubject(conversation, 'Mg+HCL'), null);
});

test('practice capture resolves chemistry subject from source text', () => {
  const subject = resolvePracticeSubject({
    educationLevel: 'middle',
    subjectArea: 'mathematics',
    course: 'mathematics',
  }, 'Mg+HCL');
  assert.deepEqual(subject, {
    subjectArea: 'natural_sciences',
    course: 'natural_sciences',
  });
});

test('rejects algebra practice prompts for chemistry sources', () => {
  const item = {
    sourceQuestion: 'Mg+HCL',
    subjectArea: 'natural_sciences',
    course: 'natural_sciences',
  };
  assert.equal(
    isOffSubjectPractice(item, 'Cho biểu thức đại số A = 2x + 7. Khi thay giá trị x = 3 vào biểu thức, giá trị tính được bằng 13.'),
    true,
  );
  assert.equal(
    isOffSubjectPractice(item, 'Phản ứng Mg + HCl tạo muối MgCl2 và khí H2.'),
    false,
  );
  assert.equal(looksLikePureMathPrompt('Cho biểu thức đại số A = 2x + 7'), true);
});

test('practice prompt locks the required subject for chemistry items', () => {
  const prompt = buildPracticePrompt({
    sourceQuestion: 'Mg+HCL',
    subjectArea: 'natural_sciences',
    course: 'natural_sciences',
    blocker: 'incorrect_answer',
  }, 'vi', 'true_false');
  assert.match(prompt, /Môn học bắt buộc: natural_sciences/);
  assert.match(prompt, /chỉ tạo câu hóa học/i);
});

test('math reminder does not force algebra when the question is chemistry', () => {
  const reminder = buildCurrentQuestionReminder([
    { role: 'user', parts: [{ text: 'Mg+HCL' }] },
  ], 'vi', 'mathematics');
  assert.match(reminder, /Hóa học/);
  assert.doesNotMatch(reminder, /tuyệt đối không chuyển sang/);
});

test('infers high-school chemistry course separately', () => {
  assert.deepEqual(inferSubjectFromContent('Al + O2 -> Al2O3', 'high'), {
    subjectArea: 'natural_sciences',
    course: 'chemistry',
    reason: 'chemistry',
  });
});
