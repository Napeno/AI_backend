// Main auth controller that aggregates all auth-related controllers
const { register } = require('./auth/register.controller');
const { login } = require('./auth/login.controller');

module.exports = { register, login }; 