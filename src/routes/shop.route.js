const express = require('express');
const router = express.Router();
const shopController = require('../controllers/shop.controller');

// @route   POST api/shop/purchase-avatar
// @desc    Purchase an avatar
// @access  Private
router.post('/purchase-avatar', shopController.purchaseAvatar);

module.exports = router;