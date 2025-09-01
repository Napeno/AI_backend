// Main auth controller that aggregates all auth-related controllers
const { register } = require('./auth/register.controller');
const { login } = require('./auth/login.controller');
const { forgotPassword } = require('./auth/forgot-password.controller');
const { resetPassword } = require('./auth/reset-password.controller');

module.exports = { register, login, forgotPassword, resetPassword }; 