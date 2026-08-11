const express = require('express');
const router = express.Router();
const User = require('../models/user.model');

// Get leaderboard
router.get('/', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    // Get users sorted by points (descending), then by chestnuts (descending)
    const users = await User.find({})
      .select('name email chestnuts points rank avatar')
      .sort({ points: -1, chestnuts: -1, createdAt: 1 })
      .skip(skip)
      .limit(limit)
      .lean();

    // Add rank to each user
    const startRank = skip + 1;
    const leaderboardUsers = users.map((user, index) => ({
      ...user,
      rank: startRank + index,
      // Ensure user has a name, fallback to email prefix if no name
      name: user.name || user.email.split('@')[0]
    }));

    // Get total count for pagination
    const totalUsers = await User.countDocuments({});

    res.json({
      users: leaderboardUsers,
      pagination: {
        currentPage: page,
        totalPages: Math.ceil(totalUsers / limit),
        totalUsers,
        hasNextPage: page * limit < totalUsers,
        hasPrevPage: page > 1
      },
      success: true
    });
  } catch (error) {
    console.error('Leaderboard error:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      success: false
    });
  }
});

// Get user's ranking position
router.get('/my-rank', async (req, res) => {
  try {
    const userId = req.user._id;
    
    // Find current user
    const currentUser = await User.findById(userId).select('chestnuts points');
    if (!currentUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Count users with higher scores
    const higherRankedUsers = await User.countDocuments({
      $or: [
        { points: { $gt: currentUser.points } },
        { 
          points: currentUser.points, 
          chestnuts: { $gt: currentUser.chestnuts } 
        },
        { 
          points: currentUser.points, 
          chestnuts: currentUser.chestnuts,
          createdAt: { $lt: req.user.createdAt }
        }
      ]
    });

    const userRank = higherRankedUsers + 1;

    res.json({
      rank: userRank,
      chestnuts: currentUser.chestnuts,
      points: currentUser.points,
      success: true
    });
  } catch (error) {
    console.error('User rank error:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      success: false
    });
  }
});

// Get top performers (top 10)
router.get('/top', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 10;

    const topUsers = await User.find({})
      .select('name email chestnuts points rank avatar')
      .sort({ points: -1, chestnuts: -1, createdAt: 1 })
      .limit(limit)
      .lean();

    // Add rank to each user
    const leaderboardUsers = topUsers.map((user, index) => ({
      ...user,
      rank: index + 1,
      name: user.name || user.email.split('@')[0]
    }));

    res.json({
      users: leaderboardUsers,
      success: true
    });
  } catch (error) {
    console.error('Top users error:', error);
    res.status(500).json({ 
      error: 'Internal server error',
      success: false
    });
  }
});

module.exports = router;
