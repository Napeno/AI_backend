const PracticeItem = require('../models/practice-item.model');
const mongoose = require('mongoose');
const {
  applyPracticeResult,
  ensurePractice,
  evaluatePracticeAttempt,
  toPublicPracticeItem,
} = require('../services/practice.service');

const getItemForUser = (userId, itemId) => mongoose.isValidObjectId(itemId)
  ? PracticeItem.findOne({ _id: itemId, user: userId })
  : null;

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

    const items = await PracticeItem.find(filter).sort({ nextReviewAt: 1, updatedAt: -1 });
    return res.json({ items: items.map(toPublicPracticeItem) });
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
    const answer = String(req.body?.answer || '').trim();
    if (!answer || answer.length > 1200) {
      return res.status(400).json({ message: 'A practice answer is required' });
    }

    const item = await getItemForUser(req.user._id, req.params.itemId);
    if (!item) {
      return res.status(404).json({ message: 'Practice item not found' });
    }

    await ensurePractice(item, req.body?.language || 'en');
    const result = await evaluatePracticeAttempt(item, answer, req.body?.language || 'en');
    applyPracticeResult(item, result.isCorrect);
    await item.save();

    return res.json({
      ...result,
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
  submitAttempt,
};
