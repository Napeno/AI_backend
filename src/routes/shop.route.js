const express = require('express');
const router = express.Router();
const shopController = require('../controllers/shop.controller');

router.get('/gifts', shopController.listGifts);
router.put('/favorites/:giftId', shopController.toggleFavorite);
router.get('/history', shopController.getHistory);
router.post('/redeem', shopController.redeemGift);

// @route   POST api/shop/purchase-avatar
// @desc    Purchase an avatar
// @access  Private
router.post('/purchase-avatar', shopController.purchaseAvatar);

module.exports = router;
