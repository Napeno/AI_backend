const PracticeItem = require('../models/practice-item.model');
const Conversation = require('../models/conversation.model');
const User = require('../models/user.model');
const mongoose = require('mongoose');
const { awardChestnuts } = require('../services/reward.service');
const RankingService = require('../services/ranking.service');
const ThinkerService = require('../services/thinker.service');
const RULES = require('../config/intervention-rules.json');
const {
  addAssistantTurn,
  addPracticeTurn,
  applyPracticeResult,
  canShowPracticeSolution,
  ensurePracticeVariant,
  evaluatePracticeAttempt,
  generatePracticeVariant,
  QUESTION_TYPES,
  requestPracticeGuidance,
  toPublicPracticeItem,
  getConversationTitle,
} = require('../services/practice.service');

const getConversationTitles = async (userId, items) => {
  const sessionIds = [...new Set(items.map(item => item.sessionId).filter(Boolean))];
  if (!sessionIds.length) return new Map();
  const conversations = await Conversation.find({ user: userId, sessionId: { $in: sessionIds } })
    .select('sessionId history')
    .lean();
  return new Map(conversations.map(conversation => [conversation.sessionId, getConversationTitle(conversation)]));
};

const toPublicPracticeItems = async (userId, items) => {
  const titles = await getConversationTitles(userId, items);
  return items.map(item => toPublicPracticeItem(item, titles.get(item.sessionId)));
};

const getItemForUser = (userId, itemId) => mongoose.isValidObjectId(itemId)
  ? PracticeItem.findOne({ _id: itemId, user: userId })
  : null;

const parsePagination = (value, fallback, maximum) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback;
};

const getRecommendation = async (req, res) => {
  try {
    const now = new Date();
    const filter = {
      user: req.user._id,
      $or: [
        { status: { $ne: 'mastered' } },
        { 'practice.variants': { $elemMatch: { status: { $ne: 'mastered' } } } },
      ],
    };
    let item = await PracticeItem.findOne({ ...filter, nextReviewAt: { $lte: now } }).sort({ nextReviewAt: 1 });
    item ||= await PracticeItem.findOne(filter).sort({ updatedAt: -1 });

    if (!item) {
      return res.json({ recommendation: null });
    }

    const [recommendation] = await toPublicPracticeItems(req.user._id, [item]);
    return res.json({ recommendation });
  } catch (error) {
    console.error('Error fetching practice recommendation:', error);
    return res.status(500).json({ message: 'Unable to fetch practice recommendation' });
  }
};

const getItems = async (req, res) => {
  try {
    const filter = { user: req.user._id };
    if (req.query.subjectArea) {
      filter.subjectArea = req.query.subjectArea;
    }

    const limit = parsePagination(req.query.limit, 6, 24);
    const requestedPage = parsePagination(req.query.page, 1, 100000);
    const [totalItems, subjects] = await Promise.all([
      PracticeItem.countDocuments(filter),
      PracticeItem.distinct('subjectArea', { user: req.user._id }),
    ]);
    const totalPages = Math.max(1, Math.ceil(totalItems / limit));
    const page = Math.min(requestedPage, totalPages);
    const items = await PracticeItem.find(filter)
      .sort({ nextReviewAt: 1, updatedAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit);

    return res.json({
      items: await toPublicPracticeItems(req.user._id, items),
      subjects: subjects.filter(Boolean),
      pagination: { page, limit, totalItems, totalPages },
    });
  } catch (error) {
    console.error('Error fetching practice items:', error);
    return res.status(500).json({ message: 'Unable to fetch practice items' });
  }
};

const getItem = async (req, res) => {
  try {
    const item = await getItemForUser(req.user._id, req.params.itemId);
    if (!item) {
      return res.status(404).json({ message: 'Practice item not found' });
    }

    const [publicItem] = await toPublicPracticeItems(req.user._id, [item]);
    return res.json({ item: publicItem });
  } catch (error) {
    console.error('Error fetching practice item:', error);
    return res.status(500).json({ message: 'Unable to fetch practice item' });
  }
};

const submitAttempt = async (req, res) => {
  try {
    const action = ['attempt', 'hint', 'solution'].includes(req.body?.action) ? req.body.action : 'attempt';
    const questionType = req.body?.questionType || 'long_answer';
    const answer = String(req.body?.answer || '').trim();
    if (!QUESTION_TYPES.includes(questionType)) {
      return res.status(400).json({ message: 'Invalid practice question type' });
    }
    const maxAnswerLength = questionType === 'fill_blank' ? 300 : 1200;
    if (action === 'attempt' && (!answer || answer.length > maxAnswerLength)) {
      return res.status(400).json({ message: 'A practice answer is required' });
    }

    const item = await getItemForUser(req.user._id, req.params.itemId);
    if (!item) {
      return res.status(404).json({ message: 'Practice item not found' });
    }

    const variant = ensurePracticeVariant(item, questionType);
    if (!variant) {
      return res.status(400).json({ message: 'Please generate a practice question first' });
    }
    if (action === 'attempt' && questionType === 'multiple_choice' && !variant.options.some(option => option.id === answer)) {
      return res.status(400).json({ message: 'Please choose one of the available options' });
    }
    if (action === 'attempt' && questionType === 'true_false' && !['true', 'false'].includes(answer)) {
      return res.status(400).json({ message: 'Please choose True or False' });
    }
    if (action === 'solution' && !canShowPracticeSolution(item, variant)) {
      return res.status(400).json({ message: 'Complete two meaningful incorrect attempts before viewing the sample solution' });
    }

    const language = req.body?.language || 'en';
    let result;
    if (action === 'attempt') {
      result = await evaluatePracticeAttempt(item, answer, language, questionType);
      if (!result) {
        return res.status(503).json({ message: language === 'vi' ? 'ThinkBridge đang tạo lại phản hồi đúng cho bài này.' : 'ThinkBridge is regenerating a correct response for this task.' });
      }
      addPracticeTurn(item, { role: 'student', action, content: answer }, variant);
      if (result.isCorrect === false && result.isMeaningfulAttempt) {
        variant.incorrectAttempts = Number(variant.incorrectAttempts || 0) + 1;
      }
      if (typeof result.isCorrect === 'boolean') applyPracticeResult(item, result.isCorrect, new Date(), variant);
    } else {
      result = await requestPracticeGuidance(item, action, '', language, questionType);
      if (!result) {
        return res.status(503).json({ message: language === 'vi' ? 'ThinkBridge chưa thể tạo phản hồi lúc này. Em thử lại sau ít phút nhé.' : 'ThinkBridge cannot create a response right now. Please try again shortly.' });
      }
      addPracticeTurn(item, {
        role: 'student',
        action,
        content: action === 'hint'
          ? (language === 'vi' ? 'Em muốn thêm một gợi ý.' : 'I would like another hint.')
          : (language === 'vi' ? 'Em muốn xem lời giải mẫu.' : 'I would like to see the sample solution.'),
      }, variant);
    }
    addAssistantTurn(item, action, result, variant);
    await item.save();
    const challengeBadges = action === 'attempt' && result.isCorrect === true
      ? await ThinkerService.awardChallengeBadges(req.user._id)
      : [];
    let chestnutsAwarded = 0;
    let pointsAwarded = 0;
    let totalPoints = null;
    let totalChestnuts = null;
    let currentRank = null;
    if (action === 'attempt' && result.isCorrect === true) {
      const user = await User.findById(req.user._id);
      if (user) {
        const reward = await awardChestnuts(
          user,
          RULES.rewards.practiceCorrect,
          'practice_correct',
          `practice-correct:${item._id}:${questionType}:${variant.prompt}`
        );
        chestnutsAwarded = reward.awarded ? RULES.rewards.practiceCorrect : 0;
        if (reward.awarded) {
          const pointsResult = RankingService.awardPoints(user, 25, 'practice_correct');
          pointsAwarded = pointsResult.pointsAwarded;
          await user.save();
        }
        const updatedUser = reward.awarded
          ? user
          : await User.findById(req.user._id).select('chestnuts points rank');
        totalChestnuts = updatedUser?.chestnuts ?? reward.balance ?? null;
        totalPoints = updatedUser?.points ?? null;
        currentRank = updatedUser?.rank ?? null;
      }
    }

    return res.json({
      ...result,
      action,
      item: (await toPublicPracticeItems(req.user._id, [item]))[0],
      chestnutsAwarded,
      totalChestnuts,
      pointsAwarded,
      totalPoints,
      currentRank,
      challengeBadges,
    });
  } catch (error) {
    console.error('Error submitting practice attempt:', error);
    return res.status(503).json({
      message: req.body?.language === 'vi' ? 'ThinkBridge chưa thể tạo phản hồi đúng lúc này.' : 'ThinkBridge cannot create the correct response right now.',
      details: error.message,
    });
  }
};

const generateItem = async (req, res) => {
  try {
    const questionType = req.body?.questionType;
    if (!QUESTION_TYPES.includes(questionType)) {
      return res.status(400).json({ message: 'Invalid practice question type' });
    }
    const item = await getItemForUser(req.user._id, req.params.itemId);
    if (!item) return res.status(404).json({ message: 'Practice item not found' });

    const variant = await generatePracticeVariant(item, questionType, req.body?.language || 'en');
    return res.json({ item: (await toPublicPracticeItems(req.user._id, [item]))[0], questionType: variant.questionType });
  } catch (error) {
    console.error('Error generating practice question:', error);
    return res.status(503).json({
      message: req.body?.language === 'vi' ? 'ThinkBridge chưa thể tạo bài ôn lúc này.' : 'ThinkBridge cannot create this practice question right now.',
      details: error.message,
    });
  }
};

const deleteItem = async (req, res) => {
  try {
    const item = await getItemForUser(req.user._id, req.params.itemId);
    if (!item) {
      return res.status(404).json({ message: 'Practice item not found' });
    }

    await item.deleteOne();

    return res.json({ message: 'Practice item deleted' });
  } catch (error) {
    console.error('Error deleting practice item:', error);
    return res.status(500).json({ message: 'Unable to delete practice item' });
  }
};

module.exports = {
  deleteItem,
  generateItem,
  getItem,
  getItems,
  getRecommendation,
  parsePagination,
  submitAttempt,
};
