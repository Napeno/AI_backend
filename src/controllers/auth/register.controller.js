const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../../models/user.model');

const register = async (req, res) => {
  try {
    const { name, username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const existing = await User.findOne({ username: username.toLowerCase() });
    if (existing) {
      return res.status(409).json({ error: 'Username already in use' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await User.create({
      name,
      username: username.toLowerCase(),
      passwordHash,
      role: 'student',
    });

    const secret = process.env.JWT_SECRET;
    if (!secret) {
      console.error('JWT_SECRET is not set');
      return res.status(500).json({ error: 'Server configuration error' });
    }

    const token = jwt.sign({ sub: user._id.toString(), username: user.username }, secret, { expiresIn: '7d' });
    return res.status(201).json({
      token,
      user: {
        _id: user._id,
        id: user._id,
        name: user.name,
        username: user.username,
        role: user.role,
        chestnuts: user.chestnuts ?? user.coins ?? 0,
        points: user.points || 0,
        rank: user.rank || 'iron',
        avatar: user.avatar || 'default',
        ownedAvatars: user.ownedAvatars || ['default'],
        favoriteGifts: user.favoriteGifts || []
      },
    });
  } catch (err) {
    console.error('Register error', err);
    return res.status(500).json({ error: 'Something went wrong' });
  }
};

module.exports = { register }; 
