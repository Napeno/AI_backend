const express = require('express');
const {
  deleteItem,
  getItem,
  getItems,
  getRecommendation,
  submitAttempt,
} = require('../controllers/practice.controller');

const router = express.Router();

router.get('/recommendation', getRecommendation);
router.get('/items', getItems);
router.get('/items/:itemId', getItem);
router.post('/items/:itemId/attempt', submitAttempt);
router.delete('/items/:itemId', deleteItem);

module.exports = router;
