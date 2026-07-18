const assert = require('node:assert/strict');
const test = require('node:test');
const InterventionService = require('../src/services/intervention.service');

const createConversation = () => ({
  interventionMetrics: {},
  markModified() {},
});

test('guides repeated hint requests from blocker choice to a mini quiz', () => {
  const conversation = createConversation();

  assert.equal(InterventionService.evaluateHintRequest(conversation, 'vi').allowed, true);

  const blockerGate = InterventionService.evaluateHintRequest(conversation, 'vi');
  assert.equal(blockerGate.allowed, false);
  assert.equal(blockerGate.intervention.type, 'blocker_choice_gate');
  assert.equal(blockerGate.intervention.requiredAction, 'choose_blocker');

  const guidedHint = InterventionService.evaluateHintRequest(conversation, 'vi', {
    type: 'blocker_choice',
    value: 'start',
  });
  assert.equal(guidedHint.allowed, true);
  assert.equal(conversation.interventionMetrics.identifiedBlocker, true);
  assert.equal(conversation.interventionMetrics.lastBlocker, 'start');

  const quizGate = InterventionService.evaluateHintRequest(conversation, 'vi');
  assert.equal(quizGate.allowed, false);
  assert.equal(quizGate.intervention.type, 'mini_quiz_gate');
});

test('requires a learning step before a full answer and unlocks it after an attempt', () => {
  const blockedConversation = createConversation();
  const blocked = InterventionService.evaluateFullAnswerRequest(blockedConversation, 'vi');

  assert.equal(blocked.allowed, false);
  assert.equal(blocked.intervention.type, 'full_answer_gate');

  const blockerOnlyConversation = createConversation();
  const blockerOnly = InterventionService.evaluateFullAnswerRequest(blockerOnlyConversation, 'vi', {
    type: 'blocker_choice',
    value: 'start',
  });
  assert.equal(blockerOnly.allowed, false);
  assert.equal(blockerOnly.intervention.type, 'full_answer_gate');

  const attemptedConversation = createConversation();
  InterventionService.recordStudentAttempt(attemptedConversation);
  const allowed = InterventionService.evaluateFullAnswerRequest(attemptedConversation, 'vi');

  assert.equal(allowed.allowed, true);
  assert.equal(allowed.intervention.canRequestFullAnswer, true);
});

test('keeps a mini quiz open and gives its stored hint after a wrong choice', () => {
  const conversation = createConversation();
  conversation.interventionMetrics.activeGate = {
    active: true,
    type: 'mini_quiz_gate',
    requiredAction: 'mini_quiz_or_reflection',
    miniQuiz: {
      question: 'Câu hỏi nhỏ',
      options: [{ id: 'A', text: 'Đúng' }, { id: 'B', text: 'Sai' }],
      correctOptionId: 'A',
      explanation: 'Xem lại bước đầu tiên.',
    },
  };

  const result = InterventionService.evaluateHintRequest(conversation, 'vi', {
    type: 'quiz_choice',
    value: 'B',
  });

  assert.equal(result.allowed, false);
  assert.equal(result.intervention.active, true);
  assert.match(result.message, /Xem lại bước đầu tiên/);
});
