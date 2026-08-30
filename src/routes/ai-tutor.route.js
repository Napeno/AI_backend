const express = require('express');
const auth = require('../middleware/auth');
const controller = require('../controllers/ai-tutor.controller');

const router = express.Router();
router.post('/lessons', auth, controller.createLesson);
router.get('/lessons', auth, controller.listLessons);
router.get('/lessons/:lessonId', auth, controller.getLesson);
router.post('/lessons/:lessonId/previous', auth, controller.previous);
router.post('/lessons/:lessonId/answer', auth, controller.answer);
router.post('/lessons/:lessonId/step', auth, controller.completeStep);
router.get('/analytics', auth, controller.analytics);
router.post('/generate', auth, controller.generate);
router.post('/answer', auth, controller.answerLegacy);

module.exports = router;
