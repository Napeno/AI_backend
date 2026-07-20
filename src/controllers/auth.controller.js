// Main auth controller that aggregates all auth-related controllers
const { register } = require('./auth/register.controller');
const { login } = require('./auth/login.controller');

const getCurrentUser = (req, res) => {
  const user = req.user;
  return res.json({
    user: {
      _id: user._id,
      id: user._id,
      name: user.name,
      username: user.username,
      role: user.role || 'student',
      coins: user.coins || 0,
      points: user.points || 0,
      rank: user.rank || 'bronze',
      avatar: user.avatar || 'default',
      ownedAvatars: user.ownedAvatars || ['default'],
    },
  });
};

module.exports = { register, login, getCurrentUser }; 
