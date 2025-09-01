const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const User = require('../../models/user.model');

const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) return res.status(200).json({ message: 'If an account exists, a reset email has been sent' });

    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = await bcrypt.hash(rawToken, 12);

    user.passwordResetTokenHash = tokenHash;
    user.passwordResetExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
    await user.save();

    // In production, send email. For now, return token for testing
    return res.json({ message: 'Reset token generated', resetToken: rawToken });
  } catch (err) {
    console.error('Forgot password error', err);
    return res.status(500).json({ error: 'Something went wrong' });
  }
};

module.exports = { forgotPassword }; 