const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../../models/user.model');

const login = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const secret = process.env.JWT_SECRET;
    if (!secret) {
      console.error('JWT_SECRET is not set');
      return res.status(500).json({ error: 'Server configuration error' });
    }

    const token = jwt.sign({ sub: user._id.toString(), email: user.email }, secret, { expiresIn: '7d' });
    return res.json({
      token,
      user: { 
        _id: user._id,
        id: user._id, 
        name: user.name, 
        email: user.email,
        coins: user.coins || 0,
        points: user.points || 0,
        rank: user.rank || 'iron',
        avatar: user.avatar || 'default',
        ownedAvatars: user.ownedAvatars || ['default']
      },
    });
  } catch (err) {
    console.error('Login error', err);
    return res.status(500).json({ error: 'Something went wrong' });
  }
};

module.exports = { login }; 