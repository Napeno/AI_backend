const bcrypt = require('bcryptjs');
const User = require('../../models/user.model');

const resetPassword = async (req, res) => {
  try {
    const { email, token, newPassword } = req.body;
    if (!email || !token || !newPassword) {
      return res.status(400).json({ error: 'Email, token, and new password are required' });
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user || !user.passwordResetTokenHash || !user.passwordResetExpires) {
      return res.status(400).json({ error: 'Invalid or expired reset token' });
    }

    if (Date.now() > user.passwordResetExpires.getTime()) {
      return res.status(400).json({ error: 'Invalid or expired reset token' });
    }

    const ok = await bcrypt.compare(token, user.passwordResetTokenHash);
    if (!ok) {
      return res.status(400).json({ error: 'Invalid or expired reset token' });
    }

    user.passwordHash = await bcrypt.hash(newPassword, 12);
    user.passwordResetTokenHash = undefined;
    user.passwordResetExpires = undefined;
    await user.save();

    return res.json({ message: 'Password has been reset successfully' });
  } catch (err) {
    console.error('Reset password error', err);
    return res.status(500).json({ error: 'Something went wrong' });
  }
};

module.exports = { resetPassword }; 