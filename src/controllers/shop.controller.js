const User = require('../models/user.model');

const purchaseAvatar = async (req, res) => {
  try {
    const { avatarId } = req.body;
    const userId = req.user._id;

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Define avatar prices
    const AVATAR_PRICES = {
      default: 0,
      student: 50,
      friend: 100,
      scientist: 150,
      artist: 120,
      engineer: 180,
      astronaut: 250,
      detective: 200,
      ninja: 300,
      wizard: 350,
      crown: 500,
      unicorn: 400,
    };

    const price = AVATAR_PRICES[avatarId];
    if (price === undefined) {
      return res.status(400).json({ error: 'Invalid avatar ID' });
    }

    // Check if user already owns this avatar
    if (user.ownedAvatars.includes(avatarId)) {
      return res.status(400).json({ error: 'Avatar already owned' });
    }

    // Check if user has enough chestnuts
    if ((user.chestnuts ?? user.coins ?? 0) < price) {
      return res.status(400).json({ error: 'Insufficient chestnuts' });
    }

    // Purchase avatar
    user.chestnuts = (user.chestnuts ?? user.coins ?? 0) - price;
    user.ownedAvatars.push(avatarId);
    await user.save();

    res.json({
      success: true,
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        chestnuts: user.chestnuts,
        points: user.points,
        rank: user.rank,
        avatar: user.avatar,
        ownedAvatars: user.ownedAvatars,
      }
    });
  } catch (error) {
    console.error('Purchase avatar error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

module.exports = {
  purchaseAvatar,
}; 
