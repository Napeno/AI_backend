const enMessages = require('../locales/en.json');
const viMessages = require('../locales/vi.json');
const { createHash } = require('node:crypto');
const RULES = require('../config/intervention-rules.json');

const RAPID_HINT_THRESHOLD_MS = RULES.limits.rapidHelpMs;
const MAX_EXTRA_HINTS = RULES.limits.maxHints;
const BASELINE_RISK_SCORE = 0;
const GATE_RESPONSE_TYPES = ['attempt', 'blocker_choice', 'quiz_choice', 'reflection', 'alternate_view'];
const BLOCKER_IDS = ['understand_question', 'formula', 'start', 'calculation'];
const SUPPORT_OPTION_IDS = ['understand_question', 'theory', 'start', 'calculation', 'creative'];

const DEFAULT_COPY = {
  vi: {
    reflectionGate: 'Trước khi nhận thêm gợi ý, em trả lời một câu hỏi nhỏ liên quan đến bài này nhé. Em cũng có thể viết một bước em đang nghĩ.',
    fullAnswerGate: 'ThinkBridge sẽ chưa mở đáp án đầy đủ ngay. Em trả lời một câu hỏi nhỏ hoặc viết một bước thử làm trước nhé.',
    stepByStepGate: 'ThinkBridge nhận thấy em đang xin khá nhiều gợi ý mà chưa thử làm. Mình kiểm tra một bước nền tảng thật dễ trước rồi đi tiếp nhé.',
    options: [
      { id: 'understand_question', label: 'Giúp em hiểu đề' },
      { id: 'theory', label: 'Nhắc lại lý thuyết' },
      { id: 'calculation', label: 'Kiểm tra lỗi sai' },
      { id: 'creative', label: 'Tìm cách sáng tạo hơn' },
    ],
    blockerOptions: [
      { id: 'understand_question', label: 'Em chưa hiểu đề' },
      { id: 'formula', label: 'Em không nhớ công thức' },
      { id: 'start', label: 'Em không biết bắt đầu' },
      { id: 'calculation', label: 'Em bị sai tính toán' },
    ],
  },
  en: {
    reflectionGate: 'Before another hint, answer one small question related to this problem. You can also write one step you are thinking about.',
    fullAnswerGate: 'ThinkBridge will not open the full answer just yet. Answer one small question or write one attempted step first.',
    stepByStepGate: 'ThinkBridge noticed several quick hint requests before an attempt. Let us check one easy foundation step first, then continue.',
    options: [
      { id: 'understand_question', label: 'Help me understand the problem' },
      { id: 'theory', label: 'Review the theory' },
      { id: 'calculation', label: 'Check my mistake' },
      { id: 'creative', label: 'Find a more creative way' },
    ],
    blockerOptions: [
      { id: 'understand_question', label: 'I do not understand the question' },
      { id: 'formula', label: 'I do not remember the formula' },
      { id: 'start', label: 'I do not know how to start' },
      { id: 'calculation', label: 'My calculation is wrong' },
    ],
  },
};

const getCopy = (language = 'en') => {
  const base = language === 'vi' ? viMessages : enMessages;
  const fallback = language === 'vi' ? DEFAULT_COPY.vi : DEFAULT_COPY.en;
  return {
    ...fallback,
    ...(base.messages?.intervention || {}),
    options: base.messages?.intervention?.options || fallback.options,
    blockerOptions: base.messages?.intervention?.blockerOptions || fallback.blockerOptions,
  };
};

const clamp = (value, min = 0, max = 100) => Math.max(min, Math.min(max, value));

// Keep the learner-facing energy calm during ordinary hinting; intervention
// rules still use the unmodified risk score above.
const getBatteryLevel = (riskScore) => Math.round(100 * Math.pow(1 - clamp(riskScore) / 100, 0.55));
const getProblemKey = (conversation) => {
  const source = String(conversation.problemContext?.sourceText || '').trim();
  return source ? createHash('sha256').update(source).digest('hex').slice(0, 12) : null;
};

const markMetricsModified = (conversation) => {
  if (typeof conversation.markModified === 'function') {
    conversation.markModified('interventionMetrics');
  }
};

const ensureMetrics = (conversation) => {
  if (!conversation.interventionMetrics) {
    conversation.interventionMetrics = {};
  }

  let metrics = conversation.interventionMetrics;
  if (metrics.rulesetVersion !== RULES.version) {
    // Legacy scores used a different baseline and cannot be converted faithfully.
    Object.assign(metrics, {
      rulesetVersion: RULES.version, riskScore: 0, riskLevel: 'low', lastRiskScore: 0, lastRiskLevel: 'low',
      hintRequests: 0, rapidHintRequests: 0, answerAttempts: 0, meaningfulAttempts: 0, answerChecks: 0,
      correctAnswers: 0, incorrectAnswers: 0, fullAnswerRequests: 0, gateCompletions: 0,
      hasAttemptedAnswer: false, hasMeaningfulAttempt: false, hasCheckedAnswer: false,
      hasRevisedAfterFeedback: false, identifiedBlocker: false, hasWorkSinceFourthHint: false,
      hasMeaningfulWorkSinceLastHint: false, hintWithoutWorkCount: 0,
      selfAttemptStreak: 0, bestSelfAttemptStreak: 0,
      lastHintAt: null, lastHelpAt: null, activeGate: { active: false },
    });
  }
  metrics.hintRequests ??= 0;
  metrics.rapidHintRequests ??= 0;
  metrics.answerAttempts ??= 0;
  metrics.meaningfulAttempts ??= metrics.hasMeaningfulAttempt ? 1 : 0;
  metrics.answerChecks ??= 0;
  metrics.correctAnswers ??= 0;
  metrics.incorrectAnswers ??= 0;
  metrics.fullAnswerRequests ??= 0;
  metrics.gateCompletions ??= 0;
  metrics.hasAttemptedAnswer ??= false;
  metrics.hasMeaningfulAttempt ??= false;
  metrics.hasCheckedAnswer ??= false;
  metrics.hasRevisedAfterFeedback ??= false;
  metrics.identifiedBlocker ??= false;
  metrics.hasWorkSinceFourthHint ??= false;
  metrics.hasMeaningfulWorkSinceLastHint ??= false;
  metrics.hintWithoutWorkCount ??= 0;
  metrics.selfAttemptStreak ??= 0;
  metrics.bestSelfAttemptStreak ??= 0;
  metrics.lastEventRiskScore ??= 0;
  metrics.riskScore ??= BASELINE_RISK_SCORE;
  metrics.riskLevel ??= 'low';
  metrics.lastRiskScore ??= metrics.riskScore;
  metrics.lastRiskLevel ??= metrics.riskLevel;
  metrics.activeGate ??= { active: false };
  metrics.activeGate.active ??= false;
  metrics.miniQuizHistory ??= [];

  return metrics;
};

const rememberMiniQuiz = (metrics, quiz) => {
  if (!quiz?.question) return;
  metrics.miniQuizHistory ??= [];
  if (metrics.miniQuizHistory.some(item => item.question === quiz.question)) return;
  metrics.miniQuizHistory = [...metrics.miniQuizHistory, {
    question: quiz.question,
    options: quiz.options || [],
    correctOptionId: quiz.correctOptionId,
    explanation: quiz.explanation || '',
  }].slice(-20);
};

const toPlainMetrics = (metrics) => ({
  hintRequests: metrics.hintRequests || 0,
  lastHintAt: metrics.lastHintAt || null,
  rapidHintRequests: metrics.rapidHintRequests || 0,
  answerAttempts: metrics.answerAttempts || 0,
  meaningfulAttempts: metrics.meaningfulAttempts || (metrics.hasMeaningfulAttempt ? 1 : 0),
  answerChecks: metrics.answerChecks || 0,
  correctAnswers: metrics.correctAnswers || 0,
  incorrectAnswers: metrics.incorrectAnswers || 0,
  fullAnswerRequests: metrics.fullAnswerRequests || 0,
  gateCompletions: metrics.gateCompletions || 0,
  hasAttemptedAnswer: !!metrics.hasAttemptedAnswer,
  hasMeaningfulAttempt: !!metrics.hasMeaningfulAttempt,
  hasCheckedAnswer: !!metrics.hasCheckedAnswer,
  hasRevisedAfterFeedback: !!metrics.hasRevisedAfterFeedback,
  identifiedBlocker: !!metrics.identifiedBlocker,
  hintWithoutWorkCount: metrics.hintWithoutWorkCount ?? ((metrics.hintRequests && !metrics.meaningfulAttempts) ? 1 : 0),
});

const getProgress = (metrics) => ({
  identifiedBlocker: !!metrics.identifiedBlocker,
  attempted: !!metrics.hasAttemptedAnswer,
  revised: !!metrics.hasRevisedAfterFeedback,
});

const getFullAnswerRequirements = (metrics) => ({
  hintsUsed: Math.min(metrics.hintRequests || 0, MAX_EXTRA_HINTS),
  hintsRequired: MAX_EXTRA_HINTS,
  hasMeaningfulAttempt: !!metrics.hasMeaningfulAttempt || !!metrics.hasWorkSinceFourthHint,
});

const calculateRiskScore = (rawMetrics = {}) => {
  const metrics = toPlainMetrics(rawMetrics);
  let score = BASELINE_RISK_SCORE;

  score += RULES.risk.hintFirstThree * Math.min(metrics.hintRequests, 3);
  score += RULES.risk.hintAfterThree * Math.max(metrics.hintRequests - 3, 0);
  score += RULES.risk.rapidHint * Math.min(metrics.rapidHintRequests, RULES.limits.rapidHints);
  score += RULES.risk.fullAnswer * Math.min(metrics.fullAnswerRequests, RULES.limits.fullAnswers);
  score += RULES.risk.hintWithoutWork * Math.min(metrics.hintWithoutWorkCount, RULES.limits.hintWithoutWork);

  score += RULES.risk.meaningfulWork * Math.min(metrics.meaningfulAttempts, RULES.limits.meaningfulWork);
  score += RULES.risk.correctAnswer * Math.min(metrics.correctAnswers, RULES.limits.correctAnswers);
  if (metrics.hasRevisedAfterFeedback) score += RULES.risk.revisionAfterFeedback;
  score += RULES.risk.gateCompleted * Math.min(metrics.gateCompletions, RULES.limits.gateCompletions);
  if (metrics.identifiedBlocker) score += RULES.risk.statedStuckPoint;

  return clamp(score, 0, RULES.risk.maxScore);
};

const getRiskLevel = (score) => {
  if (score > RULES.risk.levels.watchMax) return 'high';
  if (score > RULES.risk.levels.lowMax) return 'watch';
  return 'low';
};

const updateRisk = (conversation, metrics = ensureMetrics(conversation)) => {
  const score = calculateRiskScore(metrics);
  const level = getRiskLevel(score);

  metrics.lastRiskScore = score;
  metrics.lastRiskLevel = level;
  metrics.riskScore = score;
  metrics.riskLevel = level;
  markMetricsModified(conversation);

  return { score, level };
};

const recordDependencyEvent = (conversation, type, details = {}, at = new Date()) => {
  const metrics = ensureMetrics(conversation);
  const previousScore = Number(metrics.lastEventRiskScore || 0);
  conversation.dependencyEvents ??= [];
  conversation.dependencyEvents.push({
    type,
    at,
    riskScore: metrics.riskScore || 0,
    riskLevel: metrics.riskLevel || 'low',
    deltaScore: (metrics.riskScore || 0) - previousScore,
    rulesetVersion: RULES.version,
    details: { ...details, ...(getProblemKey(conversation) ? { problemKey: getProblemKey(conversation) } : {}) },
  });
  if (typeof conversation.markModified === 'function') {
    conversation.markModified('dependencyEvents');
  }
  metrics.lastEventRiskScore = metrics.riskScore || 0;
  markMetricsModified(conversation);
};

const getNextHintTier = (metrics) => {
  return Math.min((metrics.hintRequests || 0) + 2, 4);
};

const getPublicMiniQuiz = (miniQuiz) => {
  if (!miniQuiz?.question || !Array.isArray(miniQuiz.options) || miniQuiz.options.length === 0) {
    return null;
  }

  return {
    question: miniQuiz.question,
    options: miniQuiz.options.map(option => ({
      id: option.id,
      text: option.text,
    })),
  };
};

const buildCurrentGatePayload = (conversation, language = 'en', messageOverride = null) => {
  const copy = getCopy(language);
  const metrics = ensureMetrics(conversation);
  const gate = metrics.activeGate || {};
  const level = gate.level || metrics.riskLevel || 'watch';
  const type = gate.type || 'reflection_gate';
  const message = messageOverride || (
    type === 'full_answer_gate'
      ? copy.fullAnswerGate
      : level === 'high'
        ? copy.stepByStepGate
        : copy.reflectionGate
  );

  return {
    message,
    intervention: {
      active: true,
      level,
      type,
      requiredAction: gate.requiredAction || 'mini_quiz_or_reflection',
      options: gate.requiredAction === 'choose_blocker' ? getCopy(language).blockerOptions : [],
      miniQuiz: getPublicMiniQuiz(gate.miniQuiz),
      canRequestHint: false,
      canRequestFullAnswer: false,
      fullAnswerRequirements: getFullAnswerRequirements(metrics),
      hintTier: gate.hintTier || getNextHintTier(metrics),
      progress: getProgress(metrics),
      riskScore: metrics.riskScore,
      riskLevel: metrics.riskLevel,
      batteryLevel: getBatteryLevel(metrics.riskScore),
      hintsUsed: Math.min(metrics.hintRequests || 0, MAX_EXTRA_HINTS),
      gate: { active: true, type, requiredAction: gate.requiredAction || 'mini_quiz_or_reflection' },
    },
  };
};

const buildInactiveIntervention = (conversation, language = 'en') => {
  const metrics = ensureMetrics(conversation);
  const { level, score } = updateRisk(conversation, metrics);
  const fullAnswerRequirements = getFullAnswerRequirements(metrics);

  return {
    active: false,
    level,
    type: null,
    requiredAction: null,
    options: getCopy(language).options,
    canRequestHint: (metrics.hintRequests || 0) < MAX_EXTRA_HINTS,
    canRequestFullAnswer: fullAnswerRequirements.hintsUsed >= MAX_EXTRA_HINTS && fullAnswerRequirements.hasMeaningfulAttempt,
    fullAnswerRequirements,
    hintTier: getNextHintTier(metrics),
    progress: getProgress(metrics),
    riskScore: score,
    riskLevel: level,
    batteryLevel: getBatteryLevel(score),
    hintsUsed: Math.min(metrics.hintRequests || 0, MAX_EXTRA_HINTS),
    gate: { active: false },
  };
};

const buildGateIntervention = (conversation, language, type, level, hintTier) => {
  const requiredAction = type === 'blocker_choice_gate'
    ? 'choose_blocker'
    : 'mini_quiz_or_reflection';
  const metrics = ensureMetrics(conversation);

  metrics.activeGate = {
    active: true,
    type,
    requiredAction,
    level,
    hintTier,
    createdAt: new Date(),
  };
  metrics.lastInterventionType = type;
  metrics.lastRiskLevel = level;
  markMetricsModified(conversation);

  return buildCurrentGatePayload(conversation, language);
};

const buildActiveGateResponse = (conversation, language = 'en') => {
  return buildCurrentGatePayload(conversation, language);
};

const validateGateResponse = (gateResponse) => {
  if (!gateResponse || typeof gateResponse !== 'object') {
    return null;
  }

  const type = String(gateResponse.type || '').trim();
  const value = String(gateResponse.value || '').trim();

  if (!GATE_RESPONSE_TYPES.includes(type) ||
    (type === 'blocker_choice' && !BLOCKER_IDS.includes(value)) ||
    (type !== 'quiz_choice' && type !== 'blocker_choice' && value.length < 2) ||
    (type === 'quiz_choice' && value.length < 1)) {
    return null;
  }

  return { type, value };
};

const validateSupportChoice = (gateResponse) => {
  if (!gateResponse || gateResponse.type !== 'support_choice') {
    return null;
  }

  const value = String(gateResponse.value || '').trim();
  return SUPPORT_OPTION_IDS.includes(value) ? { type: 'support_choice', value } : null;
};

const getIncorrectQuizMessage = (miniQuiz, language = 'en') => {
  const hint = String(miniQuiz?.explanation || '').trim();
  const prefix = language === 'vi'
    ? 'Chưa đúng rồi. '
    : 'Not quite yet. ';
  const retry = language === 'vi'
    ? ' Em thử chọn lại nhé.'
    : ' Try choosing again.';
  const fallbackHint = language === 'vi'
    ? 'Hãy xem lại bước nền tảng của câu hỏi này.'
    : 'Review the foundation step in this question.';

  return `${prefix}${hint ? `Gợi ý: ${hint}` : fallbackHint}${retry}`;
};

const getBlockerSupportPrompt = (gateResponse, language = 'en') => {
  const response = validateSupportChoice(gateResponse) || validateGateResponse(gateResponse);
  if (!response || !['blocker_choice', 'support_choice'].includes(response.type)) {
    return null;
  }

  const prompts = language === 'vi'
    ? {
      understand_question: 'Học sinh chưa hiểu đề. Hãy tách ngắn gọn dữ kiện đã cho và điều cần tìm, rồi yêu cầu em nhắc lại một ý. Không giải bài.',
      formula: 'Học sinh không nhớ công thức. Hãy nhắc đúng khái niệm hoặc công thức cần xét, giải thích khi nào dùng và yêu cầu em xác nhận có phù hợp với bài này không. Không giải bài.',
      theory: 'Học sinh muốn nhắc lại lý thuyết. Hãy nêu ngắn gọn khái niệm hoặc công thức liên quan, khi nào dùng, kèm một ví dụ rất ngắn. Không giải bài.',
      start: 'Học sinh chưa biết bắt đầu. Hãy nêu đúng một thao tác đầu tiên thật cụ thể, rồi hỏi em sẽ làm gì tiếp theo. Không giải bài.',
      calculation: 'Học sinh muốn kiểm tra lỗi sai. Hãy yêu cầu em gửi một dòng biến đổi, bước làm hoặc ảnh bài làm đang nghi ngờ; sau đó mới chỉ lỗi về số, dấu, đơn vị hoặc lập luận. Không đưa đáp án cuối.',
      creative: 'Học sinh muốn một cách sáng tạo hơn. Hãy gợi ý một cách biểu diễn, góc nhìn hoặc chiến lược khác để thử, rồi hỏi em muốn thử cách nào. Không giải toàn bài.',
    }
    : {
      understand_question: 'The student does not understand the problem. Briefly separate the given information from what is asked, then ask the student to repeat one key point. Do not solve it.',
      formula: 'The student does not remember the formula. Remind the relevant idea or formula, explain when it applies, and ask whether it fits this problem. Do not solve it.',
      theory: 'The student wants a theory review. Briefly state the relevant idea or formula, when it applies, and give one tiny example. Do not solve the problem.',
      start: 'The student does not know how to start. Give exactly one concrete first action, then ask what they would do next. Do not solve it.',
      calculation: 'The student wants to check a mistake. Ask them to send one working line, step, or image they doubt; then inspect numbers, signs, units, or reasoning. Do not give the final answer.',
      creative: 'The student wants a more creative approach. Suggest one alternative representation, viewpoint, or strategy and ask which one they want to try. Do not solve the whole problem.',
    };

  return prompts[response.value] || null;
};

const getBlockerSupportFallback = (gateResponse, language = 'en') => {
  const response = validateSupportChoice(gateResponse) || validateGateResponse(gateResponse);
  if (!response || !['blocker_choice', 'support_choice'].includes(response.type)) {
    return null;
  }

  const messages = language === 'vi'
    ? {
      understand_question: 'Mình tách đề ra trước nhé: em hãy viết ngắn gọn đề đã cho gì và đang hỏi tìm gì.',
      formula: 'Em thử nêu công thức hoặc khái niệm em nghĩ có liên quan, rồi mình cùng xem nó có hợp với bài không nhé.',
      theory: 'Mình nhắc nhanh kiến thức nền trước nhé: em thử nêu khái niệm hoặc công thức em đang nghĩ tới.',
      start: 'Em hãy làm đúng một việc đầu tiên: khoanh hoặc viết lại dữ kiện rõ nhất trong đề.',
      calculation: 'Em gửi một dòng biến đổi hoặc ảnh bước làm em nghi ngờ, mình sẽ cùng tìm lỗi về số, dấu hoặc cách lập luận nhé.',
      creative: 'Em thử chọn một cách nhìn khác: vẽ sơ đồ, đặt ẩn, lập bảng hoặc diễn đạt lại đề bằng lời của mình nhé.',
    }
    : {
      understand_question: 'Let us split the problem first: briefly write what is given and what it asks for.',
      formula: 'Name the formula or idea you think may apply, then we can check whether it fits the problem.',
      theory: 'Let us review the foundation first: name the idea or formula you think is relevant.',
      start: 'Do one first action: underline or write down the clearest given information.',
      calculation: 'Send one working line or an image of the step you doubt, then we can check the numbers, signs, and reasoning together.',
      creative: 'Try a different view: draw a diagram, make a table, use a variable, or restate the problem in your own words.',
    };

  return messages[response.value] || null;
};

const evaluateSupportChoice = (conversation, language = 'en', gateResponse = null) => {
  const choice = validateSupportChoice(gateResponse);
  const metrics = ensureMetrics(conversation);

  if (!choice) {
    return {
      allowed: false,
      message: language === 'vi' ? 'Lựa chọn hỗ trợ chưa hợp lệ. Em thử chọn lại nhé.' : 'That support choice is not valid. Please choose again.',
      intervention: buildInactiveIntervention(conversation, language),
    };
  }

  if (metrics.activeGate?.active) {
    return { allowed: false, ...buildActiveGateResponse(conversation, language) };
  }

  metrics.identifiedBlocker = true;
  metrics.lastBlocker = choice.value;
  updateRisk(conversation, metrics);
  recordDependencyEvent(conversation, 'blocker_selected', { blocker: choice.value });
  markMetricsModified(conversation);

  return {
    allowed: true,
    intervention: buildInactiveIntervention(conversation, language),
  };
};

const recordGateResponse = (conversation, gateResponse, language = 'en') => {
  const validResponse = validateGateResponse(gateResponse);
  if (!validResponse) {
    return { accepted: false };
  }

  const metrics = ensureMetrics(conversation);

  rememberMiniQuiz(metrics, metrics.activeGate?.miniQuiz);

  if (validResponse.type === 'blocker_choice') {
    metrics.identifiedBlocker = true;
    metrics.lastBlocker = validResponse.value;
    metrics.activeGate = { active: false };
    updateRisk(conversation, metrics);
    recordDependencyEvent(conversation, 'blocker_selected', { blocker: validResponse.value });
    markMetricsModified(conversation);
    return { accepted: true, type: validResponse.type };
  }

  if (validResponse.type === 'quiz_choice') {
    const correctOptionId = metrics.activeGate?.miniQuiz?.correctOptionId;
    if (correctOptionId && validResponse.value !== correctOptionId) {
      const gatePayload = buildCurrentGatePayload(
        conversation,
        language,
        getIncorrectQuizMessage(metrics.activeGate?.miniQuiz, language)
      );
      markMetricsModified(conversation);
      return {
        accepted: false,
        rejected: true,
        ...gatePayload,
      };
    }

    if (metrics.activeGate?.type === 'full_answer_gate') {
      metrics.hasWorkSinceFourthHint = true;
      metrics.hasAttemptedAnswer = true;
      metrics.hasMeaningfulAttempt = true;
      metrics.hasMeaningfulWorkSinceLastHint = true;
      metrics.meaningfulAttempts += 1;
    }
  }

  const isAlternateView = validResponse.type === 'alternate_view' ||
    (metrics.activeGate?.type === 'full_answer_gate' && validResponse.type === 'reflection');
  if (isAlternateView && validResponse.value.trim()) {
    metrics.hasWorkSinceFourthHint = true;
    metrics.hasAttemptedAnswer = true;
    metrics.hasMeaningfulAttempt = true;
    metrics.hasMeaningfulWorkSinceLastHint = true;
    metrics.meaningfulAttempts += 1;
  }
  metrics.gateCompletions += 1;

  metrics.activeGate = { active: false };
  updateRisk(conversation, metrics);
  recordDependencyEvent(conversation, 'gate_completed', { isAlternateView });
  markMetricsModified(conversation);

  return { accepted: true, type: validResponse.type };
};

const projectHintRequest = (metrics, now = new Date()) => {
  const projected = toPlainMetrics(metrics);
  const lastHintAt = projected.lastHintAt ? new Date(projected.lastHintAt).getTime() : null;

  projected.hintRequests += 1;
  projected.lastHintAt = now;

  if (lastHintAt && now.getTime() - lastHintAt < RAPID_HINT_THRESHOLD_MS) {
    projected.rapidHintRequests += 1;
  }

  return projected;
};

const recordHintRequest = (conversation, now = new Date()) => {
  const metrics = ensureMetrics(conversation);
  const projected = projectHintRequest(metrics, now);
  const isRapid = projected.rapidHintRequests > (metrics.rapidHintRequests || 0);

  metrics.hintRequests = projected.hintRequests;
  metrics.lastHintAt = now;
  metrics.lastHelpAt = now;
  metrics.rapidHintRequests = projected.rapidHintRequests;
  if (!metrics.hasMeaningfulWorkSinceLastHint && metrics.hintWithoutWorkCount < RULES.limits.hintWithoutWork) {
    metrics.hintWithoutWorkCount += 1;
  }
  if (!metrics.hasMeaningfulWorkSinceLastHint) metrics.selfAttemptStreak = 0;
  metrics.hasMeaningfulWorkSinceLastHint = false;
  metrics.activeGate = { active: false };
  updateRisk(conversation, metrics);
  recordDependencyEvent(conversation, 'hint_requested', {
    isRapid,
  }, now);
  markMetricsModified(conversation);

  return metrics;
};

const evaluateHintRequest = (conversation, language = 'en', gateResponse = null) => {
  const metrics = ensureMetrics(conversation);
  const gateResult = recordGateResponse(conversation, gateResponse, language);
  const hasGateResponse = gateResult.accepted;

  if (gateResult.rejected) {
    return {
      allowed: false,
      rejected: true,
      message: gateResult.message,
      intervention: gateResult.intervention,
    };
  }

  if (metrics.activeGate?.active && !hasGateResponse) {
    return {
      allowed: false,
      ...buildActiveGateResponse(conversation, language),
    };
  }

  const projected = projectHintRequest(metrics);
  const projectedScore = calculateRiskScore(projected);
  const projectedLevel = getRiskLevel(projectedScore);
  const hasNoAttempt = !metrics.hasMeaningfulAttempt;
  const isRapidNow = projected.rapidHintRequests > (metrics.rapidHintRequests || 0);
  const shouldGate = !hasGateResponse && hasNoAttempt && (
    projected.hintRequests >= RULES.limits.gateAtHint || isRapidNow
  );

  if (shouldGate) {
    metrics.lastRiskScore = projectedScore;
    metrics.lastRiskLevel = projectedLevel;
    metrics.riskScore = projectedScore;
    metrics.riskLevel = projectedLevel;
    markMetricsModified(conversation);

    const result = {
      allowed: false,
      ...buildGateIntervention(
        conversation,
        language,
        projected.hintRequests === RULES.limits.gateAtHint ? 'blocker_choice_gate' : 'mini_quiz_gate',
        projectedLevel,
        getNextHintTier(metrics)
      ),
    };
    recordDependencyEvent(conversation, 'gate_opened', { isRapid: isRapidNow });
    return result;
  }

  recordHintRequest(conversation);

  return {
    allowed: true,
    intervention: buildInactiveIntervention(conversation, language),
  };
};

const recordFullAnswerRequest = (conversation) => {
  const metrics = ensureMetrics(conversation);
  metrics.fullAnswerRequests += 1;
  updateRisk(conversation, metrics);
  recordDependencyEvent(conversation, 'full_answer_requested');
  markMetricsModified(conversation);
  return metrics;
};

const evaluateFullAnswerRequest = (conversation, language = 'en', gateResponse = null) => {
  const gateResult = recordGateResponse(conversation, gateResponse, language);
  const hasGateResponse = gateResult.accepted && gateResult.type !== 'blocker_choice';

  if (gateResult.rejected) {
    return {
      allowed: false,
      rejected: true,
      message: gateResult.message,
      intervention: gateResult.intervention,
    };
  }

  const metrics = ensureMetrics(conversation);

  if (metrics.activeGate?.active && !hasGateResponse) {
    return {
      allowed: false,
      ...buildActiveGateResponse(conversation, language),
    };
  }

  if (!hasGateResponse) {
    recordFullAnswerRequest(conversation);
  } else {
    recordDependencyEvent(conversation, 'full_answer_requested');
  }

  updateRisk(conversation, metrics);
  const fullAnswerRequirements = getFullAnswerRequirements(metrics);
  const canAccessFullAnswer = fullAnswerRequirements.hintsUsed >= MAX_EXTRA_HINTS && fullAnswerRequirements.hasMeaningfulAttempt;

  if (!canAccessFullAnswer) {
    if (hasGateResponse) {
      metrics.activeGate = { active: false };
      markMetricsModified(conversation);
      return {
        allowed: false,
        message: fullAnswerRequirements.hintsUsed < MAX_EXTRA_HINTS
          ? (language === 'vi'
            ? 'Em đã trả lời đúng câu hỏi nhỏ rồi. Hãy nhận đủ 4 gợi ý trước khi xem lời giải nhé.'
            : 'You answered the mini-question correctly. Please use all 4 hints before viewing the solution.')
          : (language === 'vi'
            ? 'Em đã hoàn thành câu hỏi nhỏ. Giờ hãy gửi lời giải thích hoặc một bước em tự làm để mở lời giải nhé.'
            : 'You completed the mini-question. Now send your reasoning or one step you tried to unlock the solution.'),
        intervention: buildInactiveIntervention(conversation, language),
      };
    }

    metrics.activeGate = { active: false };
    markMetricsModified(conversation);
    return {
      allowed: false,
      message: fullAnswerRequirements.hintsUsed < MAX_EXTRA_HINTS
        ? (language === 'vi'
          ? 'Em hãy dùng hết các gợi ý trước nhé. Khi đã nhận đủ 4 gợi ý, nút xem lời giải đầy đủ sẽ hiện ra.'
          : 'Please use all the hints first. The full-answer button appears after all 4 hints.')
        : (language === 'vi'
          ? 'Trước khi xem lời giải, hãy viết một hướng em muốn thử trước nhé.'
          : 'Before the full solution, write one direction you would try first.'),
      intervention: (() => {
        const gate = buildGateIntervention(conversation, language, 'full_answer_gate', metrics.riskLevel, getNextHintTier(metrics));
        return gate.intervention;
      })(),
    };
  }

  metrics.activeGate = { active: false };
  markMetricsModified(conversation);

  return {
    allowed: true,
    intervention: buildInactiveIntervention(conversation, language),
  };
};

const recordStudentAttempt = (conversation, hasMeaningfulAttempt = false) => {
  const metrics = ensureMetrics(conversation);
  metrics.answerAttempts += 1;
  metrics.hasAttemptedAnswer = true;
  if (hasMeaningfulAttempt) {
    metrics.meaningfulAttempts += 1;
    metrics.hasMeaningfulAttempt = true;
    metrics.hasMeaningfulWorkSinceLastHint = true;
    metrics.selfAttemptStreak += 1;
    metrics.bestSelfAttemptStreak = Math.max(metrics.bestSelfAttemptStreak, metrics.selfAttemptStreak);
  }

  if (metrics.answerChecks > 0 || metrics.incorrectAnswers > 0) {
    metrics.hasRevisedAfterFeedback = true;
  }

  metrics.activeGate = { active: false };
  updateRisk(conversation, metrics);
  markMetricsModified(conversation);
};

const recordAnswerCheck = (conversation, isCorrect, isMeaningfulAttempt = false) => {
  const metrics = ensureMetrics(conversation);
  metrics.answerChecks += 1;
  metrics.hasCheckedAnswer = true;

  if (isCorrect === true) {
    metrics.correctAnswers += 1;
  } else if (isCorrect === false) {
    metrics.incorrectAnswers += 1;
  }

  updateRisk(conversation, metrics);
  recordDependencyEvent(conversation, 'answer_checked', { isCorrect, isMeaningfulAttempt });
  markMetricsModified(conversation);
};

const getFoundationSupportMessage = (conversation, language = 'en') => {
  const metrics = ensureMetrics(conversation);
  if (!metrics.hasAttemptedAnswer || metrics.incorrectAnswers < 2) {
    return '';
  }

  return language === 'vi'
    ? '\n\nCó vẻ phần kiến thức nền của bài này còn hơi lỏng. Mình ôn lại nhanh phần cần dùng bằng một ví dụ dễ hơn trước khi quay lại bài chính nhé.'
    : '\n\nIt looks like the foundation for this problem may still be shaky. Let us quickly review the needed idea with an easier example before returning to the main problem.';
};

const getFoundationReviewPrompt = (conversation, language = 'en') => {
  const metrics = ensureMetrics(conversation);
  if (!metrics.hasAttemptedAnswer || metrics.incorrectAnswers < 2) {
    return null;
  }

  return language === 'vi'
    ? 'Học sinh đã cố gắng trả lời nhưng sai nhiều. Hãy chuyển sang chế độ bổ sung nền tảng: nhắc lại kiến thức/công thức cần dùng, đưa một ví dụ dễ hơn hoặc câu điền vào chỗ trống, rồi yêu cầu học sinh thử lại một bước. Không đưa đáp án bài chính.'
    : 'The student has attempted the work but has several incorrect checks. Switch to foundation support: briefly review the needed idea/formula, give an easier example or a fill-in-the-blank step, then ask the student to try one step again. Do not give the main problem answer.';
};

const setActiveGateMiniQuiz = (conversation, miniQuiz) => {
  if (!miniQuiz?.question || !Array.isArray(miniQuiz.options) || !miniQuiz.correctOptionId) {
    return null;
  }

  const metrics = ensureMetrics(conversation);
  if (!metrics.activeGate?.active) {
    return null;
  }

  rememberMiniQuiz(metrics, metrics.activeGate.miniQuiz);

  metrics.activeGate.miniQuiz = {
    question: miniQuiz.question,
    options: miniQuiz.options.map(option => ({
      id: option.id,
      text: option.text,
    })),
    correctOptionId: miniQuiz.correctOptionId,
    explanation: miniQuiz.explanation || '',
  };
  markMetricsModified(conversation);

  return getPublicMiniQuiz(metrics.activeGate.miniQuiz);
};

const attachCurrentMiniQuiz = (conversation, intervention) => {
  const metrics = ensureMetrics(conversation);
  return {
    ...intervention,
    miniQuiz: getPublicMiniQuiz(metrics.activeGate?.miniQuiz),
  };
};

module.exports = {
  attachCurrentMiniQuiz,
  buildActiveGateResponse,
  buildInactiveIntervention,
  evaluateSupportChoice,
  evaluateHintRequest,
  evaluateFullAnswerRequest,
  getFoundationReviewPrompt,
  getBlockerSupportFallback,
  getFoundationSupportMessage,
  getBlockerSupportPrompt,
  recordAnswerCheck,
  recordDependencyEvent,
  recordGateResponse,
  recordStudentAttempt,
  calculateRiskScore,
  getRiskLevel,
  BASELINE_RISK_SCORE,
  setActiveGateMiniQuiz,
  updateRisk,
};
