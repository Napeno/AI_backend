const Conversation = require('../../models/conversation.model');
const User = require('../../models/user.model');
const { awardChestnuts } = require('../../services/reward.service');
const RULES = require('../../config/intervention-rules.json');
const ImageUploadService = require('../../services/image-upload.service');
const InterventionService = require('../../services/intervention.service');
const { capturePracticeItem } = require('../../services/practice.service');
const { evaluateAnswer } = require('../../services/answer-evaluator.service');
const { toPublicProblemContext } = require('../../services/problem-context.service');
const { alignConversationSubject } = require('../../services/subject-detect.service');
const { getMessages } = require('./utils');
const ThinkerService = require('../../services/thinker.service');

// Kept for older tests/callers; new checks use the structured evaluator below.
const parseCheckAnswerResponse = (modelResponse) => {
  let responseText = String(modelResponse || '').trim();
  const isMeaningfulAttempt = responseText.startsWith('[ATTEMPT]');
  responseText = responseText.replace(/^\[(?:ATTEMPT|NOT_ATTEMPT)\]\s*/, '');
  const status = responseText.match(/^\[(CORRECT|ĐÚNG|INCORRECT|SAI|UNCERTAIN)\]/)?.[1];
  return {
    isCorrect: ['CORRECT', 'ĐÚNG'].includes(status) ? true : ['INCORRECT', 'SAI'].includes(status) ? false : null,
    isMeaningfulAttempt,
    responseText: responseText.replace(/^\[(?:CORRECT|ĐÚNG|INCORRECT|SAI|UNCERTAIN)\]\s*/, ''),
  };
};

const recordAnswerEvaluation = (conversation, evaluation, isCorrect) => {
  InterventionService.recordStudentAttempt(conversation, evaluation.isMeaningfulAttempt);
  InterventionService.recordAnswerCheck(conversation, isCorrect, evaluation.isMeaningfulAttempt);
};

const checkAnswer = async (req, res, imageData = null) => {
  const { sessionId, userAnswer, language = 'en', imageUrl } = req.body;
  const answerImageUrl = imageData?.url || imageUrl || null;
  if (!sessionId) return res.status(400).json({ error: 'Session ID is required' });
  if (!userAnswer && !answerImageUrl) return res.status(400).json({ error: 'User answer or image is required' });

  const conversation = await Conversation.findOne({ user: req.user._id, sessionId });
  if (!conversation) return res.status(404).json({ error: 'Conversation not found' });
  alignConversationSubject(
    conversation,
    conversation.problemContext?.sourceText
      || [...conversation.history].reverse().find(entry => entry.role === 'user')?.parts?.map(part => part.text || '').join('\n')
      || '',
  );
  const latestModelMessage = [...conversation.history].reverse().find(message => message.role === 'model');
  const followUpQuestion = latestModelMessage?.evaluationStatus
    ? null
    : latestModelMessage?.parts?.map(part => part.text || '').join('\n') || null;

  const entry = {
    role: 'check-answer',
    parts: [{ text: userAnswer ? `Đang kiểm tra câu trả lời: "${userAnswer}"` : 'Đang kiểm tra câu trả lời từ hình ảnh' }],
    timestamp: new Date(),
    userAnswer: userAnswer || '',
  };
  if (answerImageUrl) entry.parts[0].image = imageData || { url: answerImageUrl };
  conversation.history.push(entry);

  const evaluation = await evaluateAnswer({
    conversation,
    answer: userAnswer || '',
    answerImageUrl,
    language,
    course: conversation.course,
    followUpQuestion,
  });
  const isCorrect = evaluation.status === 'correct' ? true : evaluation.status === 'incorrect' ? false : null;
  let responseText = evaluation.feedback;
  let chestnutsAwarded = 0;
  let pointsAwarded = 0;

  if (isCorrect === true) {
    try {
      const user = await User.findById(req.user._id);
      if (user) {
        const reward = await awardChestnuts(
          user,
          RULES.rewards.correctAnswer,
          'correct_answer',
          `correct-answer:${conversation._id}:${evaluation.questionId || 'current'}`
        );
        chestnutsAwarded = reward.awarded ? RULES.rewards.correctAnswer : 0;
      }
    } catch (error) {
      console.error('Correct-answer reward failed:', error.message);
      chestnutsAwarded = 0;
      pointsAwarded = 0;
    }
    responseText ||= getMessages(language).messages.success;
  } else if (isCorrect === false) {
    responseText ||= getMessages(language).messages.tryAgain;
  }

  recordAnswerEvaluation(conversation, evaluation, isCorrect);
  let badge = null;
  let challengeBadges = [];
  try {
    badge = await ThinkerService.awardSelfTrialBadge(req.user._id, conversation);
    challengeBadges = await ThinkerService.awardChallengeBadges(req.user._id, conversation);
  } catch (error) {
    console.error('Check-answer badge award failed:', error.message);
  }
  if (isCorrect === false) responseText += InterventionService.getFoundationSupportMessage(conversation, language);

  conversation.history.push({
    role: 'model',
    parts: [{ text: responseText }],
    timestamp: new Date(),
    isCorrect,
    evaluationStatus: evaluation.status,
  });
  await conversation.save();

  if (isCorrect === false) {
    try {
      await capturePracticeItem({ userId: req.user._id, conversation, blocker: 'incorrect_answer', feedback: responseText, language });
    } catch (error) {
      console.error('Error capturing practice item:', error.message);
    }
  }

  const updatedUser = await User.findById(req.user._id);
  res.json({
    message: responseText,
    isCorrect,
    isMeaningfulAttempt: evaluation.isMeaningfulAttempt,
    evaluation: {
      status: evaluation.status,
      source: evaluation.source,
      questionId: evaluation.questionId,
      evidence: evaluation.evidence,
    },
    problemContext: toPublicProblemContext(conversation.problemContext),
    chestnutsAwarded,
    totalChestnuts: updatedUser?.chestnuts ?? null,
    totalPoints: updatedUser?.points ?? null,
    currentRank: updatedUser?.rank ?? null,
    pointsAwarded,
    badge: badge || challengeBadges[0] || null,
    challengeBadges,
    intervention: InterventionService.buildInactiveIntervention(conversation, language),
    imageUrl: answerImageUrl,
  });
};

const checkUserAnswer = async (req, res) => {
  try {
    await checkAnswer(req, res);
  } catch (error) {
    console.error('Check answer error:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
};

const checkUserAnswerWithImage = async (req, res) => {
  try {
    let imageData = null;
    if (req.file) imageData = await ImageUploadService.uploadImage(req.file.buffer, req.file.originalname);
    await checkAnswer(req, res, imageData);
  } catch (error) {
    console.error('Check answer image error:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
};

module.exports = { checkUserAnswer, checkUserAnswerWithImage, parseCheckAnswerResponse, recordAnswerEvaluation };
