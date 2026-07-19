const enMessages = require('../locales/en.json');
const viMessages = require('../locales/vi.json');

const RAPID_HINT_THRESHOLD_MS = 10 * 1000;
const MAX_EXTRA_HINTS = 4;
const GATE_RESPONSE_TYPES = ['attempt', 'blocker_choice', 'quiz_choice', 'reflection'];
const BLOCKER_IDS = ['understand_question', 'formula', 'start', 'calculation'];

const DEFAULT_COPY = {
  vi: {
    reflectionGate: 'Trước khi nhận thêm gợi ý, em trả lời một câu hỏi nhỏ liên quan đến bài này nhé. Em cũng có thể viết một bước em đang nghĩ.',
    fullAnswerGate: 'ThinkBridge sẽ chưa mở đáp án đầy đủ ngay. Em trả lời một câu hỏi nhỏ hoặc viết một bước thử làm trước nhé.',
    stepByStepGate: 'ThinkBridge nhận thấy em đang xin khá nhiều gợi ý mà chưa thử làm. Mình kiểm tra một bước nền tảng thật dễ trước rồi đi tiếp nhé.',
    options: [
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
  };
};

const clamp = (value, min = 0, max = 100) => Math.max(min, Math.min(max, value));

const markMetricsModified = (conversation) => {
  if (typeof conversation.markModified === 'function') {
    conversation.markModified('interventionMetrics');
  }
};

const ensureMetrics = (conversation) => {
  if (!conversation.interventionMetrics) {
    conversation.interventionMetrics = {};
  }

  const metrics = conversation.interventionMetrics;
  metrics.hintRequests ??= 0;
  metrics.rapidHintRequests ??= 0;
  metrics.answerAttempts ??= 0;
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
  metrics.lastRiskScore ??= 0;
  metrics.lastRiskLevel ??= 'green';
  metrics.activeGate ??= { active: false };
  metrics.activeGate.active ??= false;

  return metrics;
};

const toPlainMetrics = (metrics) => ({
  hintRequests: metrics.hintRequests || 0,
  lastHintAt: metrics.lastHintAt || null,
  rapidHintRequests: metrics.rapidHintRequests || 0,
  answerAttempts: metrics.answerAttempts || 0,
  answerChecks: metrics.answerChecks || 0,
  correctAnswers: metrics.correctAnswers || 0,
  incorrectAnswers: metrics.incorrectAnswers || 0,
  fullAnswerRequests: metrics.fullAnswerRequests || 0,
  gateCompletions: metrics.gateCompletions || 0,
  hasAttemptedAnswer: !!metrics.hasAttemptedAnswer,
  hasMeaningfulAttempt: !!metrics.hasMeaningfulAttempt,
  hasCheckedAnswer: !!metrics.hasCheckedAnswer,
  hasRevisedAfterFeedback: !!metrics.hasRevisedAfterFeedback,
});

const getProgress = (metrics) => ({
  identifiedBlocker: !!metrics.identifiedBlocker,
  attempted: !!metrics.hasAttemptedAnswer,
  revised: !!metrics.hasRevisedAfterFeedback,
});

const getFullAnswerRequirements = (metrics) => ({
  hintsUsed: Math.min(metrics.hintRequests || 0, MAX_EXTRA_HINTS),
  hintsRequired: MAX_EXTRA_HINTS,
  hasMeaningfulAttempt: !!metrics.hasMeaningfulAttempt,
});

const getHintRisk = (hintRequests = 0) => {
  let score = 0;

  for (let i = 1; i <= hintRequests; i += 1) {
    if (i === 1) score += 5;
    else if (i === 2) score += 10;
    else if (i === 3) score += 15;
    else score += 25;
  }

  return score;
};

const calculateRiskScore = (rawMetrics = {}) => {
  const metrics = toPlainMetrics(rawMetrics);
  let score = getHintRisk(metrics.hintRequests);

  score += metrics.rapidHintRequests * 20;

  if (metrics.hintRequests > 0 && !metrics.hasAttemptedAnswer) {
    score += 20;
  }

  score += metrics.fullAnswerRequests * 25;

  if (metrics.hasAttemptedAnswer || metrics.answerAttempts > 0) {
    score -= 15;
  }

  if (metrics.hasRevisedAfterFeedback) {
    score -= 15;
  }

  if (metrics.gateCompletions > 0) {
    score -= 20;
  }

  return clamp(score);
};

const getRiskLevel = (score) => {
  if (score > 60) return 'red';
  if (score > 30) return 'yellow';
  return 'green';
};

const updateRisk = (conversation, metrics = ensureMetrics(conversation)) => {
  const score = calculateRiskScore(metrics);
  const level = getRiskLevel(score);

  metrics.lastRiskScore = score;
  metrics.lastRiskLevel = level;
  markMetricsModified(conversation);

  return { score, level };
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
  const level = gate.level || metrics.lastRiskLevel || 'yellow';
  const type = gate.type || 'reflection_gate';
  const message = messageOverride || (
    type === 'full_answer_gate'
      ? copy.fullAnswerGate
      : level === 'red'
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
      options: gate.requiredAction === 'choose_blocker' ? getCopy(language).options : [],
      miniQuiz: getPublicMiniQuiz(gate.miniQuiz),
      canRequestHint: false,
      canRequestFullAnswer: false,
      fullAnswerRequirements: getFullAnswerRequirements(metrics),
      hintTier: gate.hintTier || getNextHintTier(metrics),
      progress: getProgress(metrics),
    },
  };
};

const buildInactiveIntervention = (conversation, language = 'en') => {
  const metrics = ensureMetrics(conversation);
  const { level } = updateRisk(conversation, metrics);
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
  const response = validateGateResponse(gateResponse);
  if (response?.type !== 'blocker_choice') {
    return null;
  }

  const prompts = language === 'vi'
    ? {
      understand_question: 'Học sinh chưa hiểu đề. Hãy tách ngắn gọn dữ kiện đã cho và điều cần tìm, rồi yêu cầu em nhắc lại một ý. Không giải bài.',
      formula: 'Học sinh không nhớ công thức. Hãy nhắc đúng khái niệm hoặc công thức cần xét, giải thích khi nào dùng và yêu cầu em xác nhận có phù hợp với bài này không. Không giải bài.',
      start: 'Học sinh chưa biết bắt đầu. Hãy nêu đúng một thao tác đầu tiên thật cụ thể, rồi hỏi em sẽ làm gì tiếp theo. Không giải bài.',
      calculation: 'Học sinh nghi sai tính toán. Hãy yêu cầu em kiểm tra một phép tính hoặc một dòng biến đổi cụ thể trước. Không đưa đáp án cuối.',
    }
    : {
      understand_question: 'The student does not understand the problem. Briefly separate the given information from what is asked, then ask the student to repeat one key point. Do not solve it.',
      formula: 'The student does not remember the formula. Remind the relevant idea or formula, explain when it applies, and ask whether it fits this problem. Do not solve it.',
      start: 'The student does not know how to start. Give exactly one concrete first action, then ask what they would do next. Do not solve it.',
      calculation: 'The student thinks the calculation is wrong. Ask them to check one calculation or transformation line first. Do not give the final answer.',
    };

  return prompts[response.value] || null;
};

const recordGateResponse = (conversation, gateResponse, language = 'en') => {
  const validResponse = validateGateResponse(gateResponse);
  if (!validResponse) {
    return { accepted: false };
  }

  const metrics = ensureMetrics(conversation);

  if (validResponse.type === 'blocker_choice') {
    metrics.identifiedBlocker = true;
    metrics.lastBlocker = validResponse.value;
    metrics.activeGate = { active: false };
    updateRisk(conversation, metrics);
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
  }

  metrics.gateCompletions += 1;

  metrics.activeGate = { active: false };
  updateRisk(conversation, metrics);
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

  metrics.hintRequests = projected.hintRequests;
  metrics.lastHintAt = now;
  metrics.rapidHintRequests = projected.rapidHintRequests;
  metrics.activeGate = { active: false };
  updateRisk(conversation, metrics);
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
  const hasNoAttempt = !metrics.hasAttemptedAnswer && metrics.answerAttempts === 0;
  const isRapidNow = projected.rapidHintRequests > (metrics.rapidHintRequests || 0);
  const shouldGate = !hasGateResponse && (
    (hasNoAttempt && projected.hintRequests >= 2) ||
    (hasNoAttempt && projectedLevel !== 'green') ||
    (hasNoAttempt && isRapidNow)
  );

  if (shouldGate) {
    metrics.lastRiskScore = projectedScore;
    metrics.lastRiskLevel = projectedLevel;
    markMetricsModified(conversation);

    return {
      allowed: false,
      ...buildGateIntervention(
        conversation,
        language,
        projected.hintRequests === 2 ? 'blocker_choice_gate' : 'mini_quiz_gate',
        projectedLevel,
        getNextHintTier(metrics)
      ),
    };
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
  markMetricsModified(conversation);
  return metrics;
};

const evaluateFullAnswerRequest = (conversation, language = 'en', gateResponse = null) => {
  const gateResult = recordGateResponse(conversation, gateResponse, language);
  const hasGateResponse = gateResult.accepted && gateResult.type !== 'blocker_choice';

  if (gateResult.rejected) {
    return {
      allowed: false,
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
  }

  updateRisk(conversation, metrics);
  const fullAnswerRequirements = getFullAnswerRequirements(metrics);
  const canAccessFullAnswer = fullAnswerRequirements.hintsUsed >= MAX_EXTRA_HINTS && fullAnswerRequirements.hasMeaningfulAttempt;

  if (!canAccessFullAnswer) {
    metrics.activeGate = { active: false };
    markMetricsModified(conversation);
    return {
      allowed: false,
      message: fullAnswerRequirements.hintsUsed < MAX_EXTRA_HINTS
        ? (language === 'vi'
          ? 'Em hãy dùng hết các gợi ý trước nhé. Khi đã nhận đủ 4 gợi ý, nút xem lời giải đầy đủ sẽ hiện ra.'
          : 'Please use all the hints first. The full-answer button appears after all 4 hints.')
        : (language === 'vi'
          ? 'Em đã nhận đủ gợi ý rồi. Hãy gửi một bước em đã làm ở ô kiểm tra câu trả lời để mình mở lời giải đầy đủ nhé.'
          : 'You have received all hints. Submit one relevant step in the answer check so I can unlock the full solution.'),
      intervention: buildInactiveIntervention(conversation, language),
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
  metrics.hasMeaningfulAttempt ||= hasMeaningfulAttempt;

  if (metrics.answerChecks > 0 || metrics.incorrectAnswers > 0) {
    metrics.hasRevisedAfterFeedback = true;
  }

  metrics.activeGate = { active: false };
  updateRisk(conversation, metrics);
  markMetricsModified(conversation);
};

const recordAnswerCheck = (conversation, isCorrect) => {
  const metrics = ensureMetrics(conversation);
  metrics.answerChecks += 1;
  metrics.hasCheckedAnswer = true;

  if (isCorrect === true) {
    metrics.correctAnswers += 1;
  } else if (isCorrect === false) {
    metrics.incorrectAnswers += 1;
  }

  updateRisk(conversation, metrics);
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
  evaluateHintRequest,
  evaluateFullAnswerRequest,
  getFoundationReviewPrompt,
  getFoundationSupportMessage,
  getBlockerSupportPrompt,
  recordAnswerCheck,
  recordGateResponse,
  recordStudentAttempt,
  setActiveGateMiniQuiz,
  updateRisk,
};
