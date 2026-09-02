const assert = require('node:assert/strict');
const test = require('node:test');
const InterventionService = require('../src/services/intervention.service');
const { parseCheckAnswerResponse, recordAnswerEvaluation } = require('../src/controllers/chat/check-answer.controller');
const { getErrorDetails } = require('../src/controllers/chat/continue-chat.controller');
const { shouldUpdateProblemContext } = require('../src/controllers/chat/image-chat.controller');
const { buildChatPrompt, buildCheckAnswerPrompt, buildSystemInstruction, normalizeMathAnswer } = require('../src/services/prompt.service');
const { getProblemContext } = require('../src/services/chat-check.service');

const createConversation = () => ({
  interventionMetrics: {},
  dependencyEvents: [],
  markModified() {},
});

test('records timestamped dependency events for dashboard analytics', () => {
  const conversation = createConversation();

  InterventionService.evaluateHintRequest(conversation, 'vi');
  InterventionService.recordAnswerCheck(conversation, false, true);
  InterventionService.recordGateResponse(conversation, { type: 'reflection', value: 'Em sẽ thử viết công thức.' }, 'vi');

  assert.deepEqual(conversation.dependencyEvents.map(event => event.type), ['hint_requested', 'answer_checked', 'gate_completed']);
  assert.equal(conversation.dependencyEvents[0].details.isRapid, false);
  assert.equal(conversation.dependencyEvents[1].details.isMeaningfulAttempt, true);
  assert.ok(conversation.dependencyEvents.every(event => event.at && Number.isFinite(event.riskScore)));
});

test('starts at zero and applies the v2 risk rules with clamp and levels', () => {
  assert.equal(InterventionService.calculateRiskScore({}), 0);
  assert.equal(InterventionService.getRiskLevel(0), 'low');
  assert.equal(InterventionService.getRiskLevel(31), 'watch');
  assert.equal(InterventionService.getRiskLevel(61), 'high');
  assert.equal(InterventionService.calculateRiskScore({ hintRequests: 1 }), 13);
  assert.equal(InterventionService.calculateRiskScore({ hintRequests: 50, rapidHintRequests: 50, fullAnswerRequests: 50 }), 100);
  assert.equal(InterventionService.calculateRiskScore({ meaningfulAttempts: 2, correctAnswers: 2, gateCompletions: 2 }), 0);
});

test('records a correct answer as learning progress for dependency risk', () => {
  const conversation = createConversation();

  recordAnswerEvaluation(conversation, { isMeaningfulAttempt: true }, true);

  assert.equal(conversation.interventionMetrics.meaningfulAttempts, 1);
  assert.equal(conversation.interventionMetrics.correctAnswers, 1);
  assert.equal(conversation.interventionMetrics.lastRiskScore, 0);
  assert.deepEqual(conversation.dependencyEvents[0].details, { isCorrect: true, isMeaningfulAttempt: true });
});

test('allows the first hint and exposes battery state', () => {
  const conversation = createConversation();
  const result = InterventionService.evaluateHintRequest(conversation, 'vi');

  assert.equal(result.allowed, true);
  assert.equal(conversation.interventionMetrics.lastRiskScore, 13);
  assert.equal(result.intervention.batteryLevel, 93);
});

test('counts a self-trial streak only when work comes before each hint', () => {
  const conversation = createConversation();
  for (let index = 0; index < 3; index += 1) {
    InterventionService.recordStudentAttempt(conversation, true);
    InterventionService.evaluateHintRequest(conversation, 'vi');
  }
  assert.equal(conversation.interventionMetrics.bestSelfAttemptStreak, 3);
});

test('marks only hints less than ten seconds apart as rapid', () => {
  const quickConversation = createConversation();
  quickConversation.interventionMetrics = {
    rulesetVersion: 'v2', hasAttemptedAnswer: true,
    answerAttempts: 1,
    lastHintAt: new Date(Date.now() - 9_000),
  };

  InterventionService.evaluateHintRequest(quickConversation, 'vi');
  assert.equal(quickConversation.dependencyEvents[0].details.isRapid, true);

  const normalConversation = createConversation();
  normalConversation.interventionMetrics = {
    rulesetVersion: 'v2', hasAttemptedAnswer: true,
    answerAttempts: 1,
    lastHintAt: new Date(Date.now() - 11_000),
  };

  InterventionService.evaluateHintRequest(normalConversation, 'vi');
  assert.equal(normalConversation.dependencyEvents[0].details.isRapid, false);
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

test('handles every support choice without consuming a hint request', () => {
  for (const value of ['understand_question', 'theory', 'start', 'calculation', 'creative']) {
    const conversation = createConversation();
    conversation.interventionMetrics = { rulesetVersion: 'v2', hintRequests: 1 };

    const result = InterventionService.evaluateSupportChoice(conversation, 'vi', {
      type: 'support_choice',
      value,
    });

    assert.equal(result.allowed, true);
    assert.equal(conversation.interventionMetrics.hintRequests, 1);
    assert.equal(conversation.interventionMetrics.lastBlocker, value);
    assert.ok(InterventionService.getBlockerSupportPrompt({ type: 'support_choice', value }, 'vi'));
  }
});

test('keeps the original problem context for a student-work image', () => {
  assert.equal(shouldUpdateProblemContext('student_work'), false);
  assert.equal(shouldUpdateProblemContext(), true);
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
  conversation.interventionMetrics = { rulesetVersion: 'v2', hintRequests: 4 };

  InterventionService.recordGateResponse(conversation, { type: 'reflection', value: 'Em chưa biết.' }, 'vi');

  assert.equal(conversation.interventionMetrics.hasAttemptedAnswer, false);
  assert.equal(conversation.interventionMetrics.hasMeaningfulAttempt, false);
  assert.equal(InterventionService.evaluateFullAnswerRequest(conversation, 'vi').allowed, false);
});

test('unlocks the full answer through one alternate-view response after four hints', () => {
  const conversation = createConversation();
  conversation.interventionMetrics = { rulesetVersion: 'v2', hintRequests: 4 };
  const blocked = InterventionService.evaluateFullAnswerRequest(conversation, 'vi');
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.intervention.type, 'full_answer_gate');

  const allowed = InterventionService.evaluateFullAnswerRequest(conversation, 'vi', {
    type: 'alternate_view', value: 'Em sẽ thử đặt ẩn rồi so sánh hai vế.',
  });
  assert.equal(allowed.allowed, true);
  assert.equal(conversation.interventionMetrics.hasWorkSinceFourthHint, true);
});

test('unlocks the full answer after a correct mini quiz at four hints', () => {
  const conversation = createConversation();
  conversation.interventionMetrics = {
    rulesetVersion: 'v2',
    hintRequests: 4,
    activeGate: {
      active: true,
      type: 'full_answer_gate',
      requiredAction: 'mini_quiz_or_reflection',
      miniQuiz: {
        question: 'Câu hỏi nhỏ',
        options: [{ id: 'A', text: 'Đúng' }, { id: 'B', text: 'Sai' }],
        correctOptionId: 'A',
      },
    },
  };

  const result = InterventionService.evaluateFullAnswerRequest(conversation, 'vi', {
    type: 'quiz_choice',
    value: 'A',
  });

  assert.equal(result.allowed, true);
  assert.equal(conversation.interventionMetrics.hasMeaningfulAttempt, true);
  assert.equal(conversation.interventionMetrics.activeGate.active, false);
});

test('does not reopen a full-answer gate after a correct quiz before four hints', () => {
  const conversation = createConversation();
  conversation.interventionMetrics = {
    rulesetVersion: 'v2',
    hintRequests: 3,
    activeGate: {
      active: true,
      type: 'full_answer_gate',
      requiredAction: 'mini_quiz_or_reflection',
      miniQuiz: {
        question: 'Câu hỏi nhỏ',
        options: [{ id: 'A', text: 'Đúng' }, { id: 'B', text: 'Sai' }],
        correctOptionId: 'A',
      },
    },
  };

  const result = InterventionService.evaluateFullAnswerRequest(conversation, 'vi', {
    type: 'quiz_choice',
    value: 'A',
  });

  assert.equal(result.allowed, false);
  assert.equal(result.intervention.active, false);
  assert.equal(result.intervention.miniQuiz, undefined);
  assert.match(result.message, /đủ 4 gợi ý/);
});

test('keeps completed mini quizzes in history for future questions', () => {
  const conversation = createConversation();
  conversation.interventionMetrics = {
    rulesetVersion: 'v2',
    activeGate: {
      active: true,
      type: 'mini_quiz_gate',
      requiredAction: 'mini_quiz_or_reflection',
      miniQuiz: {
        question: 'Câu hỏi đã dùng',
        options: [{ id: 'A', text: 'Đúng' }, { id: 'B', text: 'Sai' }],
        correctOptionId: 'A',
      },
    },
  };

  InterventionService.recordGateResponse(conversation, { type: 'quiz_choice', value: 'A' }, 'vi');

  assert.equal(conversation.interventionMetrics.miniQuizHistory[0].question, 'Câu hỏi đã dùng');
});

test('provides a safe fallback for each blocker choice', () => {
  for (const value of ['understand_question', 'formula', 'start', 'calculation']) {
    const fallback = InterventionService.getBlockerSupportFallback({ type: 'blocker_choice', value }, 'vi');
    assert.equal(typeof fallback, 'string');
    assert.ok(fallback.length > 10);
  }
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

  assert.deepEqual(
    parseCheckAnswerResponse('[ATTEMPT] [UNCERTAIN] Em cần biết dấu này có phải phép nhân không.'),
    {
      isCorrect: null,
      isMeaningfulAttempt: true,
      responseText: 'Em cần biết dấu này có phải phép nhân không.',
    }
  );
});

test('normalizes common math operators before asking Gemini to grade', () => {
  const answer = 'y² − 3*2*y + 3**2 = (y–3)^2';
  const normalized = normalizeMathAnswer(answer);

  assert.equal(normalized, 'y² - 3 × 2 × y + 3 ^ 2 = (y - 3) ^ 2');
  assert.match(buildCheckAnswerPrompt(answer, 'vi', 'middle', 'mathematics'), /3 × 2 × y/);
  assert.match(buildCheckAnswerPrompt(answer, 'vi', 'middle', 'mathematics'), /không ghép các thừa số/);
});

test('keeps direct middle-school math list requests in the selected context', () => {
  const prompt = buildChatPrompt('hằng đẳng thức lớp 8', 'vi', 'middle', 'mathematics', 'mathematics');

  assert.match(prompt, /liệt kê đủ các mục/);
  assert.match(prompt, /liệt kê đủ các công thức/);
  assert.match(buildSystemInstruction('vi', 'middle', 'mathematics', 'mathematics'), /trả lời đủ phần được hỏi/);
});

test('adds the current problem and its image to the answer-check context', () => {
  const context = getProblemContext([
    { role: 'user', parts: [{ text: 'Giải bài trong ảnh', image: { url: 'https://example.test/problem.png' } }] },
    { role: 'model', parts: [{ text: 'Với câu d), ta có x² - x + 1/4.' }] },
    { role: 'check-answer', parts: [{ text: 'Đang kiểm tra câu trả lời.' }] },
  ]);

  assert.equal(context.imageUrl, 'https://example.test/problem.png');
  assert.match(context.text, /x² - x \+ 1\/4/);
  assert.match(
    buildCheckAnswerPrompt('(x-1/2)^2 đúng không?', 'vi', 'middle', 'mathematics', null, context.text),
    /NGỮ CẢNH ĐỀ GỐC/
  );
});

test('logs Gemini error details without serializing the whole request', () => {
  const error = Object.assign(new Error('Quota exceeded'), {
    status: 429,
    code: 'RESOURCE_EXHAUSTED',
  });

  assert.deepEqual(getErrorDetails(error), {
    name: 'Error',
    message: 'Quota exceeded',
    status: 429,
    code: 'RESOURCE_EXHAUSTED',
    apiMessage: null,
    stack: error.stack,
  });
});

test('keeps a mini quiz open and gives its stored hint after a wrong choice', () => {
  const conversation = createConversation();
  conversation.interventionMetrics = { rulesetVersion: 'v2', activeGate: {
    active: true,
    type: 'mini_quiz_gate',
    requiredAction: 'mini_quiz_or_reflection',
    miniQuiz: {
      question: 'Câu hỏi nhỏ',
      options: [{ id: 'A', text: 'Đúng' }, { id: 'B', text: 'Sai' }],
      correctOptionId: 'A',
      explanation: 'Xem lại bước đầu tiên.',
    },
  } };

  const result = InterventionService.evaluateHintRequest(conversation, 'vi', {
    type: 'quiz_choice',
    value: 'B',
  });

  assert.equal(result.allowed, false);
  assert.equal(result.rejected, true);
  assert.equal(result.intervention.active, true);
  assert.match(result.message, /Xem lại bước đầu tiên/);
});
