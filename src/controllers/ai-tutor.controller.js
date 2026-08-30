const Conversation = require('../models/conversation.model');
const User = require('../models/user.model');
const AiTutorLesson = require('../models/ai-tutor-question.model');
const { ensureProblemContext, getActiveQuestion } = require('../services/problem-context.service');
const { generateLesson, makeLessonId, generateQuestion, makeQuestionId } = require('../services/ai-tutor.service');
const RankingService = require('../services/ranking.service');
const { awardChestnuts } = require('../services/reward.service');

const LESSON_GENERATION_VERSION = 7;
const isUsableLesson = lesson => lesson?.generationVersion === LESSON_GENERATION_VERSION
  && Array.isArray(lesson.questions)
  && lesson.questions.length === 5
  && lesson.questions.every(question => question
    && question.id
    && question.prompt
    && Array.isArray(question.options)
    && question.options.length === 4
    && Array.isArray(question.tutorSteps)
    && question.tutorSteps.length >= 3);

const publicInteraction = interaction => {
  if (!interaction) return null;
  if (interaction.type === 'sort_sequence' && Array.isArray(interaction.items)) return { type: interaction.type, items: interaction.items.map(item => ({ id: item.id, text: item.text })) };
  if (['match_pairs', 'label_diagram', 'cause_effect'].includes(interaction.type) && Array.isArray(interaction.pairs)) return { type: interaction.type, left: interaction.pairs.map(pair => ({ id: pair.id, text: pair.left })), right: interaction.pairs.map(pair => ({ id: `right-${pair.id}`, text: pair.right })) };
  if (interaction.type === 'evidence_choice' && Array.isArray(interaction.choices)) return { type: interaction.type, prompt: interaction.prompt, choices: interaction.choices.map(choice => ({ id: choice.id, text: choice.text })) };
  if (interaction.type === 'cloze') return { type: interaction.type, prompt: interaction.prompt };
  return null;
};
const publicStep = (step, reveal = false) => {
  if (!step) return null;
  return {
    id: step.id,
    title: step.title,
    explanation: reveal ? step.explanation : '',
    analysis: reveal ? step.analysis || step.explanation : '',
    easierExample: reveal ? step.easierExample || null : null,
    blanks: reveal && Array.isArray(step.blanks) ? step.blanks.map(blank => ({ id: blank.id, label: blank.label })) : [],
    tokens: reveal && Array.isArray(step.tokens) ? step.tokens : [],
    interaction: reveal ? publicInteraction(step.interaction) : null,
  };
};
const publicQuestion = (question, { revealCorrect = false, unlockedStep = -1 } = {}) => {
  if (!question) return null;
  return {
    id: question.id,
    title: question.title,
    prompt: question.prompt,
    visual: question.visual,
    interactionType: question.interactionType,
    options: Array.isArray(question.options) ? question.options : [],
    tutorSteps: (Array.isArray(question.tutorSteps) ? question.tutorSteps : [])
      .map((step, index) => publicStep(step, index <= unlockedStep)).filter(Boolean),
    ...(revealCorrect ? { correctOptionId: question.correctOptionId } : {}),
  };
};
const publicLesson = (lesson, options = {}) => {
  const questions = Array.isArray(lesson.questions) ? lesson.questions : [];
  const requestedIndex = Number.isInteger(lesson.currentQuestionIndex)
    ? lesson.currentQuestionIndex
    : 0;
  const currentQuestionIndex = Math.min(Math.max(requestedIndex, 0), Math.max(questions.length - 1, 0));
  return {
    lessonId: lesson.lessonId,
    sessionId: lesson.sessionId,
    sourceQuestionId: lesson.sourceQuestionId,
    sourceText: lesson.sourceText,
    sourceImage: lesson.sourceImage,
    currentQuestionIndex,
    currentStepIndex: Number.isInteger(lesson.currentStepIndex) ? lesson.currentStepIndex : -1,
    completed: lesson.completed,
    question: publicQuestion(questions[currentQuestionIndex], { unlockedStep: lesson.currentStepIndex, ...options }),
  };
};

const createLesson = async (req, res) => {
  try {
    const { sessionId, questionId, language = 'vi' } = req.body || {};
    if (!sessionId) return res.status(400).json({ error: 'Vui lòng cung cấp mã phiên học.' });
    const conversation = await Conversation.findOne({ user: req.user._id, sessionId });
    if (!conversation) return res.status(404).json({ error: 'Không tìm thấy cuộc trò chuyện.' });
    await ensureProblemContext(conversation, language);
    const selected = conversation.problemContext?.questions?.find(question => question.id === String(questionId || conversation.problemContext.activeQuestionId || '').toLowerCase()) || getActiveQuestion(conversation.problemContext);
    if (!selected) return res.status(400).json({ error: 'Không tìm thấy đề bài trong cuộc trò chuyện.' });
    const existing = await AiTutorLesson.findOne({ user: req.user._id, sessionId, sourceQuestionId: selected.id, completed: false }).sort({ updatedAt: -1 });
    // Reuse only lessons from the current generation; older lessons must be regenerated.
    if (isUsableLesson(existing)) {
      let changed = false;
      if (!existing.attempts?.length && existing.currentStepIndex !== -1) { existing.currentStepIndex = -1; changed = true; }
      if (existing.currentQuestionIndex < 0 || existing.currentQuestionIndex > 4) { existing.currentQuestionIndex = 0; changed = true; }
      if (changed) await existing.save();
      return res.json({ lesson: publicLesson(existing) });
    }
    if (existing) await existing.deleteOne();
    const lessonData = await generateLesson({ language, questionId: selected.id, sourceText: selected.prompt || conversation.problemContext.sourceText, sourceExpression: selected.sourceExpression || '', sourceImage: conversation.problemContext.sourceImage, subjectArea: conversation.subjectArea, course: conversation.course, educationLevel: conversation.educationLevel });
    const lesson = await AiTutorLesson.create({ ...lessonData, generationVersion: LESSON_GENERATION_VERSION, currentStepIndex: -1, subjectArea: conversation.subjectArea, course: conversation.course, educationLevel: conversation.educationLevel, lessonId: makeLessonId(), user: req.user._id, sessionId, sourceQuestionId: selected.id });
    return res.status(201).json({ lesson: publicLesson(lesson) });
  } catch (error) {
    console.error('AI tutor lesson create error:', error.message);
    return res.status(500).json({ error: 'Không thể tạo bài luyện lúc này.' });
  }
};

const getLesson = async (req, res) => {
  const lesson = await AiTutorLesson.findOne({ lessonId: req.params.lessonId, user: req.user._id });
  if (!lesson) return res.status(404).json({ error: 'Không tìm thấy bài luyện.' });
  return res.json({ lesson: publicLesson(lesson) });
};

const previous = async (req, res) => {
  const lesson = await AiTutorLesson.findOne({ lessonId: req.params.lessonId, user: req.user._id });
  if (!lesson) return res.status(404).json({ error: 'Không tìm thấy bài luyện.' });
  if (lesson.currentQuestionIndex <= 0) return res.status(400).json({ error: 'Đã ở câu hỏi đầu tiên.' });
  lesson.currentQuestionIndex -= 1;
  lesson.currentStepIndex = -1;
  lesson.completed = false;
  lesson.completedAt = undefined;
  await lesson.save();
  return res.json({ lesson: publicLesson(lesson) });
};

const listLessons = async (req, res) => {
  const lessons = await AiTutorLesson.find({ user: req.user._id })
    .sort({ updatedAt: -1 })
    .select('lessonId sessionId sourceQuestionId sourceText subjectArea course educationLevel completed currentQuestionIndex questions createdAt updatedAt')
    .lean();
  return res.json({ lessons: lessons.map(lesson => ({
    lessonId: lesson.lessonId,
    sessionId: lesson.sessionId,
    sourceQuestionId: lesson.sourceQuestionId,
    sourceText: lesson.sourceText,
    subjectArea: lesson.subjectArea,
    course: lesson.course,
    educationLevel: lesson.educationLevel,
    completed: lesson.completed,
    questionCount: lesson.questions?.length || 0,
    currentQuestionIndex: lesson.currentQuestionIndex || 0,
    createdAt: lesson.createdAt,
    updatedAt: lesson.updatedAt
  })) });
};

const answer = async (req, res) => {
  const { questionId, optionId } = req.body || {};
  const lesson = await AiTutorLesson.findOne({ lessonId: req.params.lessonId, user: req.user._id }).select('+questions.correctOptionId');
  if (!lesson) return res.status(404).json({ error: 'Không tìm thấy bài luyện.' });
  const question = lesson.questions[lesson.currentQuestionIndex];
  if (!question || question.id !== questionId) return res.status(400).json({ error: 'Câu hỏi hiện tại không hợp lệ.' });
  const correct = question.correctOptionId === optionId;
  const attempts = Array.isArray(lesson.attempts) ? lesson.attempts : [];
  const alreadyRewarded = attempts.some(attempt => !attempt.stepId && attempt.questionId === question.id && attempt.correct);
  if (!Array.isArray(lesson.attempts)) lesson.attempts = [];
  lesson.attempts.push({ questionId, optionId, correct, type: 'answer', at: new Date() });
  lesson.markModified('attempts');
  lesson.currentStepIndex = Math.max(lesson.currentStepIndex, 0);
  await lesson.save();

  let pointsAwarded = 0;
  let chestnutsAwarded = 0;
  let totalPoints = null;
  let totalChestnuts = null;
  let currentRank = null;
  if (correct && !alreadyRewarded) {
    const user = await User.findById(req.user._id);
    if (user) {
      const reward = await awardChestnuts(
        user,
        5,
        'ai_tutor_correct_answer',
        `ai-tutor-correct:${lesson.lessonId}:${question.id}`
      );
      chestnutsAwarded = reward.awarded ? 5 : 0;
      if (reward.awarded) {
        const pointsResult = RankingService.awardPoints(user, 25, 'ai_tutor_correct_answer');
        pointsAwarded = pointsResult.pointsAwarded;
        await user.save();
      }
      const updatedUser = reward.awarded
        ? user
        : await User.findById(req.user._id).select('chestnuts points rank');
      totalPoints = updatedUser?.points ?? null;
      totalChestnuts = updatedUser?.chestnuts ?? reward.balance ?? null;
      currentRank = updatedUser?.rank ?? null;
    }
  } else if (correct) {
    const user = await User.findById(req.user._id).select('chestnuts points rank');
    totalPoints = user?.points ?? null;
    totalChestnuts = user?.chestnuts ?? null;
    currentRank = user?.rank ?? null;
  }

  return res.json({
    correct,
    message: correct ? 'Chính xác! Mở bước tiếp theo nhé.' : 'Chưa đúng. Đáp án đúng đã được đánh dấu, hãy hoàn thành bước gợi ý.',
    pointsAwarded,
    totalPoints,
    chestnutsAwarded,
    totalChestnuts,
    currentRank,
    lesson: publicLesson(lesson, { revealCorrect: true, unlockedStep: lesson.currentStepIndex }),
  });
};

const completeStep = async (req, res) => {
  const { questionId, stepId, placements = {}, interactionAnswer = {} } = req.body || {};
  const lesson = await AiTutorLesson.findOne({ lessonId: req.params.lessonId, user: req.user._id }).select('+questions.correctOptionId');
  if (!lesson) return res.status(404).json({ error: 'Không tìm thấy bài luyện.' });
  const question = lesson.questions[lesson.currentQuestionIndex];
  if (!question || question.id !== questionId) return res.status(400).json({ error: 'Câu hỏi hiện tại không hợp lệ.' });
  const attempts = Array.isArray(lesson.attempts) ? lesson.attempts : [];
  const canAdvanceAfterCorrectAnswer = interactionAnswer?.skip === true
    && interactionAnswer?.stepReview !== true
    && attempts.some(attempt => !attempt.stepId
      && String(attempt.questionId) === String(question.id)
      && attempt.correct === true);
  if (canAdvanceAfterCorrectAnswer) {
    if (lesson.currentQuestionIndex >= lesson.questions.length - 1) {
      lesson.completed = true; lesson.completedAt = new Date();
    } else {
      lesson.currentQuestionIndex += 1; lesson.currentStepIndex = -1;
    }
    await lesson.save();
    const activeQuestion = lesson.questions[lesson.currentQuestionIndex];
    const answered = lesson.attempts?.some(attempt => !attempt.stepId && attempt.questionId === activeQuestion?.id);
    return res.json({ correct: true, lesson: publicLesson(lesson, { revealCorrect: answered, unlockedStep: lesson.currentStepIndex }) });
  }
  const step = question.tutorSteps.find(item => item.id === stepId);
  if (!step || question.tutorSteps[lesson.currentStepIndex]?.id !== stepId) return res.status(400).json({ error: 'Bước hướng dẫn hiện tại không hợp lệ.' });
  const isReviewedFailedStep = interactionAnswer?.stepReview === true
    && attempts.some(attempt => String(attempt.questionId) === String(question.id)
      && String(attempt.stepId) === String(stepId)
      && attempt.correct === false);
  if (interactionAnswer?.stepReview === true && !isReviewedFailedStep) {
    return res.status(400).json({ error: 'Bước hướng dẫn chưa có câu trả lời sai để xem lại.' });
  }
  const tokenValid = step.interaction ? true : step.blanks.every(blank => placements[blank.id] === blank.expectedTokenId);
  const interactionValid = step.interaction?.type === 'sort_sequence'
    ? JSON.stringify(interactionAnswer.order || []) === JSON.stringify([...step.interaction.items].sort((a, b) => a.order - b.order).map(item => item.id))
    : ['match_pairs', 'label_diagram', 'cause_effect'].includes(step.interaction?.type)
      ? step.interaction.pairs.every(pair => interactionAnswer.matches?.[pair.id] === `right-${pair.id}`)
      : step.interaction?.type === 'evidence_choice'
        ? step.interaction.choices.find(choice => choice.correct)?.id === interactionAnswer.choiceId
        : step.interaction?.type === 'cloze'
          ? String(interactionAnswer.text || '').trim().toLowerCase() === step.interaction.answer
        : true;
  const valid = isReviewedFailedStep || (tokenValid && interactionValid);
  if (!valid) {
    if (!Array.isArray(lesson.attempts)) lesson.attempts = [];
    lesson.attempts.push({ questionId, stepId, correct: false, type: 'step', at: new Date() });
    lesson.markModified('attempts');
    await lesson.save();
    return res.status(400).json({
    correct: false,
    error: step.interaction ? 'Câu trả lời chưa đúng, hãy xem lại hướng dẫn.' : 'Câu trả lời chưa đúng. Đáp án đúng ở bên dưới.',
    correctAnswer: step.interaction ? null : step.blanks.map(blank => ({
      blankId: blank.id,
      label: step.tokens.find(token => token.id === blank.expectedTokenId)?.label || 'Đáp án đúng',
    })),
    guidance: step.explanation,
    lesson: publicLesson(lesson, { revealCorrect: true, unlockedStep: lesson.currentStepIndex }),
    });
  }
  lesson.currentStepIndex = Math.min(lesson.currentStepIndex + 1, question.tutorSteps.length - 1);
  if (lesson.currentStepIndex >= question.tutorSteps.length - 1 && lesson.currentQuestionIndex >= lesson.questions.length - 1) {
    lesson.completed = true; lesson.completedAt = new Date();
  } else if (lesson.currentStepIndex >= question.tutorSteps.length - 1) {
    lesson.currentQuestionIndex += 1; lesson.currentStepIndex = -1;
  }
  await lesson.save();
  const activeQuestion = lesson.questions[lesson.currentQuestionIndex];
  const answered = lesson.attempts?.some(attempt => !attempt.stepId && attempt.questionId === activeQuestion?.id);
  return res.json({ correct: true, lesson: publicLesson(lesson, { revealCorrect: answered, unlockedStep: lesson.currentStepIndex }) });
};

const analytics = async (req, res) => {
  const lessons = await AiTutorLesson.find(req.user.role === 'admin' ? {} : { user: req.user._id }).lean();
  const attempts = lessons.flatMap(lesson => lesson.attempts || []);
  return res.json({ lessons: lessons.length, completed: lessons.filter(lesson => lesson.completed).length, attempts: attempts.length, correct: attempts.filter(attempt => attempt.correct).length, incorrect: attempts.filter(attempt => !attempt.correct).length });
};

// Legacy endpoints remain available for old bookmarks.
const generate = async (req, res) => {
  try { const question = await generateQuestion(req.body || {}); return res.json({ question: { ...question, questionId: makeQuestionId() } }); } catch { return res.status(500).json({ error: 'Không thể tạo câu hỏi lúc này.' }); }
};
const legacyAnswer = async (req, res) => res.status(410).json({ error: 'Hãy mở AI Tutor từ một bài trong Chat.' });

module.exports = { createLesson, getLesson, previous, listLessons, answer, completeStep, analytics, generate, answerLegacy: legacyAnswer };
