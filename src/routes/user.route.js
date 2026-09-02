const express = require('express');
const router = express.Router();
const User = require('../models/user.model');
const Conversation = require('../models/conversation.model');
const RewardTransaction = require('../models/reward-transaction.model');
const ThinkerService = require('../services/thinker.service');

// Change avatar
router.put('/change-avatar', async (req, res) => {
  try {
    const { avatarId } = req.body;
    const userId = req.user._id;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Check if user owns this avatar
    if (!user.ownedAvatars.includes(avatarId)) {
      return res.status(400).json({ error: 'Avatar not owned' });
    }

    user.avatar = avatarId;
    await user.save();

    res.json({
      success: true,
      avatar: avatarId,
    });
  } catch (error) {
    console.error('Change avatar error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/rewards', async (req, res) => {
  const transactions = await RewardTransaction.find({ user: req.user._id }).sort({ createdAt: -1 }).limit(50).lean();
  return res.json({ chestnuts: req.user.chestnuts ?? req.user.coins ?? 0, transactions });
});

router.get('/badges', async (req, res) => {
  await ThinkerService.awardSelfTrialBadge(req.user._id);
  const user = await User.findById(req.user._id).select('badges').lean();
  const earned = new Map((user?.badges || []).map(badge => [badge.code, badge.earnedAt]));
  return res.json({ badges: ThinkerService.getBadgeDefinitions().map(badge => ({ ...badge, earnedAt: earned.get(badge.code) || null })) });
});

router.post('/ai-error', async (req, res) => {
  const { sessionId, messageText, correction, language = 'vi' } = req.body || {};
  if (!sessionId || !messageText || !ThinkerService.isConcreteCorrection(correction)) {
    return res.status(400).json({ error: 'A specific correction is required' });
  }

  const conversation = await Conversation.findOne({ user: req.user._id, sessionId });
  if (!conversation) return res.status(404).json({ error: 'Conversation not found' });
  const isAiMessage = conversation.history.some(message => message.role === 'model' && message.parts?.some(part => part.text === messageText));
  if (!isAiMessage) return res.status(400).json({ error: 'Message was not found in this conversation' });

  const valid = await ThinkerService.validateAiCorrection({
    sourceText: conversation.problemContext?.sourceText,
    aiResponse: messageText,
    correction,
    language,
  });
  if (!valid) return res.json({ reported: false, valid: false, message: 'Chưa đủ căn cứ để xác nhận lỗi này.' });

  conversation.aiErrorReports.push({ messageText: String(messageText).slice(0, 12000), correction: String(correction).trim().slice(0, 2000) });
  await conversation.save();
  const badge = await ThinkerService.awardAiErrorBadge(req.user._id);
  return res.json({ reported: true, valid: true, badge });
});

router.get('/journal/weekly', async (req, res) => {
  const now = new Date();
  const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
  const conversations = await Conversation.find({ user: req.user._id, 'dependencyEvents.at': { $gte: twoWeeksAgo } })
    .select('dependencyEvents educationLevel subjectArea course').lean();
  const journal = ThinkerService.buildWeeklyJournal(conversations, now);
  const challenges = await ThinkerService.getWeeklyChallenges({ userId: req.user._id, journal, conversations, educationLevel: conversations[0]?.educationLevel || 'middle' });
  return res.json({ ...journal, ...challenges });
});

router.get('/risk-trend', async (req, res) => {
  const days = Math.min(90, Math.max(1, Number(req.query.days) || 14));
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const conversations = await Conversation.find({ user: req.user._id, 'dependencyEvents.at': { $gte: since } })
    .select('dependencyEvents').lean();
  const groups = new Map();
  conversations.flatMap(item => item.dependencyEvents || []).forEach(event => {
    if (event.rulesetVersion !== 'v2' || new Date(event.at) < since) return;
    const day = new Date(event.at).toISOString().slice(0, 10);
    const item = groups.get(day) || { total: 0, count: 0 };
    item.total += event.riskScore;
    item.count += 1;
    groups.set(day, item);
  });
  return res.json({ points: [...groups.entries()].map(([date, value]) => ({ date, riskScore: Math.round(value.total / value.count) })).sort((a, b) => a.date.localeCompare(b.date)) });
});

module.exports = router;
