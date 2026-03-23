const express = require('express');
const router = express.Router();
const { getQuestions, submitQuiz, getResults } = require('../controllers/quiz.controller');

// GET /api/quiz/questions - Get all quiz questions with shuffled answers
router.get('/questions', getQuestions);

// POST /api/quiz/submit - Submit answers and get result
router.post('/submit', submitQuiz);

// GET /api/quiz/results - Get all possible result categories
router.get('/results', getResults);

module.exports = router;
