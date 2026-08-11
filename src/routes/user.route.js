const express = require('express');
const router = express.Router();
const User = require('../models/user.model');
const Conversation = require('../models/conversation.model');
const RewardTransaction = require('../models/reward-transaction.model');

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
  const user = await User.findById(req.user._id).select('badges').lean();
  return res.json({ badges: user?.badges || [] });
});

router.get('/journal/weekly', async (req, res) => {
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const conversations = await Conversation.find({ user: req.user._id, 'dependencyEvents.at': { $gte: weekAgo } })
    .select('dependencyEvents').lean();
  const events = conversations.flatMap(item => item.dependencyEvents || [])
    .filter(event => event.rulesetVersion === 'v2' && new Date(event.at) >= weekAgo);
  const meaningful = events.filter(event => event.type === 'answer_checked' && event.details?.isMeaningfulAttempt).length;
  const hints = events.filter(event => event.type === 'hint_requested').length;
  const message = meaningful
    ? `Tuần này em đã gửi ${meaningful} bước làm có ý nghĩa trước khi tiếp tục học.`
    : 'Tuần này hãy thử viết một bước em đang nghĩ trước khi xin thêm gợi ý nhé.';
  return res.json({ from: weekAgo, to: now, meaningfulWork: meaningful, hints, message });
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
