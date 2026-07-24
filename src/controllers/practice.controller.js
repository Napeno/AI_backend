const PracticeItem = require('../models/practice-item.model');
const mongoose = require('mongoose');
const {
  addAssistantTurn,
  addPracticeTurn,
  applyPracticeResult,
  canShowPracticeSolution,
  ensurePractice,
  evaluatePracticeAttempt,
  requestPracticeGuidance,
  toPublicPracticeItem,
} = require('../services/practice.service');

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
    const filter = { user: req.user._id, status: { $ne: 'mastered' } };
    let item = await PracticeItem.findOne({ ...filter, nextReviewAt: { $lte: now } }).sort({ nextReviewAt: 1 });
    item ||= await PracticeItem.findOne(filter).sort({ updatedAt: -1 });

    if (!item) {
      return res.json({ recommendation: null });
    }

    await ensurePractice(item, req.query.language || 'en');
    return res.json({ recommendation: toPublicPracticeItem(item) });
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
      items: items.map(toPublicPracticeItem),
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

    await ensurePractice(item, req.query.language || 'en');
    return res.json({ item: toPublicPracticeItem(item) });
  } catch (error) {
    console.error('Error fetching practice item:', error);
    return res.status(500).json({ message: 'Unable to fetch practice item' });
  }
};

const submitAttempt = async (req, res) => {
  try {
    const action = ['attempt', 'hint', 'solution'].includes(req.body?.action) ? req.body.action : 'attempt';
    const answer = String(req.body?.answer || '').trim();
    if (action === 'attempt' && (!answer || answer.length > 1200)) {
      return res.status(400).json({ message: 'A practice answer is required' });
    }

    const item = await getItemForUser(req.user._id, req.params.itemId);
    if (!item) {
      return res.status(404).json({ message: 'Practice item not found' });
    }

    await ensurePractice(item, req.body?.language || 'en');
    if (action === 'solution' && !canShowPracticeSolution(item)) {
      return res.status(400).json({ message: 'Complete two meaningful incorrect attempts before viewing the sample solution' });
    }

    const language = req.body?.language || 'en';
    let result;
    if (action === 'attempt') {
      result = await evaluatePracticeAttempt(item, answer, language);
      if (!result) {
        return res.status(503).json({ message: language === 'vi' ? 'ThinkBridge chưa thể chấm bài lúc này. Em thử gửi lại sau ít phút nhé.' : 'ThinkBridge cannot grade this attempt right now. Please try again shortly.' });
      }
      addPracticeTurn(item, { role: 'student', action, content: answer });
      if (result.isCorrect === false && result.isMeaningfulAttempt) {
        item.practice.incorrectAttempts = Number(item.practice.incorrectAttempts || 0) + 1;
      }
      if (typeof result.isCorrect === 'boolean') applyPracticeResult(item, result.isCorrect);
    } else {
      result = await requestPracticeGuidance(item, action, '', language);
      if (!result) {
        return res.status(503).json({ message: language === 'vi' ? 'ThinkBridge chưa thể tạo phản hồi lúc này. Em thử lại sau ít phút nhé.' : 'ThinkBridge cannot create a response right now. Please try again shortly.' });
      }
      addPracticeTurn(item, {
        role: 'student',
        action,
        content: action === 'hint'
          ? (language === 'vi' ? 'Em muốn thêm một gợi ý.' : 'I would like another hint.')
          : (language === 'vi' ? 'Em muốn xem lời giải mẫu.' : 'I would like to see the sample solution.'),
      });
    }
    addAssistantTurn(item, action, result);
    await item.save();

    return res.json({
      ...result,
      action,
      item: toPublicPracticeItem(item),
    });
  } catch (error) {
    console.error('Error submitting practice attempt:', error);
    return res.status(500).json({ message: 'Unable to check practice attempt' });
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
  getItem,
  getItems,
  getRecommendation,
  parsePagination,
  submitAttempt,
};
