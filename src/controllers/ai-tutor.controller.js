const Conversation = require('../models/conversation.model');
const AiTutorLesson = require('../models/ai-tutor-question.model');
const { ensureProblemContext, getActiveQuestion } = require('../services/problem-context.service');
const { generateLesson, makeLessonId, generateQuestion, makeQuestionId } = require('../services/ai-tutor.service');

const publicInteraction = interaction => {
  if (!interaction) return null;
  if (interaction.type === 'sort_sequence') return { type: interaction.type, items: interaction.items.map(item => ({ id: item.id, text: item.text })) };
  if (['match_pairs', 'label_diagram', 'cause_effect'].includes(interaction.type)) return { type: interaction.type, left: interaction.pairs.map(pair => ({ id: pair.id, text: pair.left })), right: interaction.pairs.map(pair => ({ id: `right-${pair.id}`, text: pair.right })) };
  if (interaction.type === 'evidence_choice') return { type: interaction.type, prompt: interaction.prompt, choices: interaction.choices.map(choice => ({ id: choice.id, text: choice.text })) };
  if (interaction.type === 'cloze') return { type: interaction.type, prompt: interaction.prompt };
  return null;
};
// Guidance text is safe to show immediately; answer tokens/interactions stay gated.
const publicStep = (step, reveal = false) => ({ id: step.id, title: step.title, explanation: step.explanation, blanks: reveal ? step.blanks.map(blank => ({ id: blank.id, label: blank.label })) : [], tokens: reveal ? step.tokens : [], interaction: reveal ? publicInteraction(step.interaction) : null });
const publicQuestion = (question, { revealCorrect = false, unlockedStep = -1 } = {}) => ({ id: question.id, title: question.title, prompt: question.prompt, visual: question.visual, interactionType: question.interactionType, options: question.options, tutorSteps: question.tutorSteps.map((step, index) => publicStep(step, index <= unlockedStep)), ...(revealCorrect ? { correctOptionId: question.correctOptionId } : {}) });
const publicLesson = (lesson, options) => ({ lessonId: lesson.lessonId, sessionId: lesson.sessionId, sourceQuestionId: lesson.sourceQuestionId, sourceText: lesson.sourceText, sourceImage: lesson.sourceImage, currentQuestionIndex: lesson.currentQuestionIndex, currentStepIndex: lesson.currentStepIndex, completed: lesson.completed, question: publicQuestion(lesson.questions[lesson.currentQuestionIndex], { unlockedStep: lesson.currentStepIndex, ...options }) });

const createLesson = async (req, res) => {
  try {
    const { sessionId, questionId, language = 'vi' } = req.body || {};
    if (!sessionId) return res.status(400).json({ error: 'sessionId is required' });
    const conversation = await Conversation.findOne({ user: req.user._id, sessionId });
    if (!conversation) return res.status(404).json({ error: 'Conversation not found' });
    await ensureProblemContext(conversation, language);
    const selected = conversation.problemContext?.questions?.find(question => question.id === String(questionId || conversation.problemContext.activeQuestionId || '').toLowerCase()) || getActiveQuestion(conversation.problemContext);
    if (!selected) return res.status(400).json({ error: 'No problem found in this chat' });
    const existing = await AiTutorLesson.findOne({ user: req.user._id, sessionId, sourceQuestionId: selected.id, completed: false }).sort({ updatedAt: -1 });
    if (existing) return res.json({ lesson: publicLesson(existing) });
    const lessonData = await generateLesson({ language, questionId: selected.id, sourceText: selected.prompt || conversation.problemContext.sourceText, sourceImage: conversation.problemContext.sourceImage, subjectArea: conversation.subjectArea, course: conversation.course, educationLevel: conversation.educationLevel });
    const lesson = await AiTutorLesson.create({ ...lessonData, currentStepIndex: 0, subjectArea: conversation.subjectArea, course: conversation.course, educationLevel: conversation.educationLevel, lessonId: makeLessonId(), user: req.user._id, sessionId, sourceQuestionId: selected.id });
    return res.status(201).json({ lesson: publicLesson(lesson) });
  } catch (error) {
    console.error('AI tutor lesson create error:', error.message);
    return res.status(500).json({ error: 'Không thể tạo bài luyện lúc này.' });
  }
};

const getLesson = async (req, res) => {
  const lesson = await AiTutorLesson.findOne({ lessonId: req.params.lessonId, user: req.user._id });
  if (!lesson) return res.status(404).json({ error: 'Lesson not found' });
  return res.json({ lesson: publicLesson(lesson) });
};

const answer = async (req, res) => {
  const { questionId, optionId } = req.body || {};
  const lesson = await AiTutorLesson.findOne({ lessonId: req.params.lessonId, user: req.user._id }).select('+questions.correctOptionId');
  if (!lesson) return res.status(404).json({ error: 'Lesson not found' });
  const question = lesson.questions[lesson.currentQuestionIndex];
  if (!question || question.id !== questionId) return res.status(400).json({ error: 'Question is not active' });
  const correct = question.correctOptionId === optionId;
  lesson.attempts.push({ questionId, optionId, correct, at: new Date() });
  lesson.currentStepIndex = Math.max(lesson.currentStepIndex, 0);
  await lesson.save();
  return res.json({ correct, message: correct ? 'Chính xác! Mở bước tiếp theo nhé.' : 'Chưa đúng. Đáp án đúng đã được đánh dấu, hãy hoàn thành bước gợi ý.', lesson: publicLesson(lesson, { revealCorrect: true, unlockedStep: lesson.currentStepIndex }) });
};

const completeStep = async (req, res) => {
  const { questionId, stepId, placements = {}, interactionAnswer = {} } = req.body || {};
  const lesson = await AiTutorLesson.findOne({ lessonId: req.params.lessonId, user: req.user._id }).select('+questions.correctOptionId');
  if (!lesson) return res.status(404).json({ error: 'Lesson not found' });
  const question = lesson.questions[lesson.currentQuestionIndex];
  const step = question?.tutorSteps.find(item => item.id === stepId);
  if (!step || question.id !== questionId || question.tutorSteps[lesson.currentStepIndex]?.id !== stepId) return res.status(400).json({ error: 'Step is not active' });
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
  const valid = interactionAnswer?.skip === true || (tokenValid && interactionValid);
  if (!valid) return res.status(400).json({ correct: false, error: step.interaction ? 'Câu trả lời chưa đúng, hãy thử lại.' : 'Hãy đặt đúng token vào từng ô trống.', lesson: publicLesson(lesson, { revealCorrect: true, unlockedStep: lesson.currentStepIndex }) });
  lesson.currentStepIndex = Math.min(lesson.currentStepIndex + 1, question.tutorSteps.length - 1);
  if (lesson.currentStepIndex >= question.tutorSteps.length - 1 && lesson.currentQuestionIndex >= lesson.questions.length - 1) {
    lesson.completed = true; lesson.completedAt = new Date();
  } else if (lesson.currentStepIndex >= question.tutorSteps.length - 1) {
    lesson.currentQuestionIndex += 1; lesson.currentStepIndex = 0;
  }
  await lesson.save();
  return res.json({ correct: true, lesson: publicLesson(lesson) });
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

module.exports = { createLesson, getLesson, answer, completeStep, analytics, generate, answerLegacy: legacyAnswer };
