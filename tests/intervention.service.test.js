const assert = require('node:assert/strict');
const test = require('node:test');
const InterventionService = require('../src/services/intervention.service');
const { parseCheckAnswerResponse } = require('../src/controllers/chat/check-answer.controller');

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

test('only unlocks a full answer after all hints and a meaningful attempt', () => {
  const blockedConversation = createConversation();
  const blocked = InterventionService.evaluateFullAnswerRequest(blockedConversation, 'vi');

  assert.equal(blocked.allowed, false);
  assert.equal(blocked.intervention.canRequestFullAnswer, false);

  const attemptedConversation = createConversation();
  InterventionService.recordStudentAttempt(attemptedConversation, false);
  assert.equal(InterventionService.evaluateFullAnswerRequest(attemptedConversation, 'vi').allowed, false);

  attemptedConversation.interventionMetrics.hintRequests = 4;
  const stillBlocked = InterventionService.evaluateFullAnswerRequest(attemptedConversation, 'vi');

  assert.equal(stillBlocked.allowed, false);
  assert.equal(stillBlocked.intervention.fullAnswerRequirements.hasMeaningfulAttempt, false);

  InterventionService.recordStudentAttempt(attemptedConversation, true);
  const allowed = InterventionService.evaluateFullAnswerRequest(attemptedConversation, 'vi');

  assert.equal(allowed.allowed, true);
  assert.equal(allowed.intervention.canRequestFullAnswer, true);
});

test('does not count a quiz or reflection as a meaningful attempt', () => {
  const conversation = createConversation();
  conversation.interventionMetrics.hintRequests = 4;

  InterventionService.recordGateResponse(conversation, { type: 'reflection', value: 'Em chưa biết.' }, 'vi');

  assert.equal(conversation.interventionMetrics.hasAttemptedAnswer, false);
  assert.equal(conversation.interventionMetrics.hasMeaningfulAttempt, false);
  assert.equal(InterventionService.evaluateFullAnswerRequest(conversation, 'vi').allowed, false);
});

test('parses and removes attempt and correctness labels from answer feedback', () => {
  assert.deepEqual(
    parseCheckAnswerResponse('[ATTEMPT] [SAI] Em đã thay nhầm dấu ở bước hai.'),
    {
      isCorrect: false,
      isMeaningfulAttempt: true,
      responseText: 'Em đã thay nhầm dấu ở bước hai.',
    }
  );

  assert.deepEqual(
    parseCheckAnswerResponse('[NOT_ATTEMPT] [INCORRECT] Em hãy thử viết công thức trước nhé.'),
    {
      isCorrect: false,
      isMeaningfulAttempt: false,
      responseText: 'Em hãy thử viết công thức trước nhé.',
    }
  );
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
