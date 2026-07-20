const jwt = require('jsonwebtoken');
const User = require('../models/user.model');

module.exports = async function optionalAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token || !process.env.JWT_SECRET) return next();

    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = await User.findById(payload.sub || payload.userId || payload.id)
      .select('_id name username role');
  } catch {
    // Quiz remains public; only a valid signed-in user gets a stored result.
  }
  next();
};
