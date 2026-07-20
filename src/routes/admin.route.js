const express = require('express');
const { addNote, exportAnalytics, getAnalytics, getStudent } = require('../controllers/admin.controller');

const router = express.Router();

router.get('/analytics', getAnalytics);
router.get('/analytics/export', exportAnalytics);
router.get('/students/:id', getStudent);
router.post('/students/:id/notes', addNote);

module.exports = router;
