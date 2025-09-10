const express = require('express');
const router = express.Router();
const User = require('../models/user.model');

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

module.exports = router;