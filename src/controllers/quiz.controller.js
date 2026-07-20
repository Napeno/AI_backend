const { getQuestionsForClient, calculateScore, quizResults } = require('../data/quiz-questions');
const { quizQuestions } = require('../data/quiz-questions');
const User = require('../models/user.model');

const hasValidAnswers = (answers) => quizQuestions.every(question => {
    const answerId = answers?.[question.id];
    return question.answers.some(answer => answer.id === answerId);
});

/**
 * GET /api/quiz/questions
 * Returns all quiz questions with shuffled answers (no scores)
 */
const getQuestions = (req, res) => {
    try {
        const questions = getQuestionsForClient();
        res.json({
            success: true,
            data: {
                title: 'BẠN ĐANG DÙNG AI HAY AI ĐANG DÙNG BẠN?',
                subtitle: 'Bài test vui 3 phút – Không đúng sai – Chỉ để hiểu bản thân!',
                totalQuestions: questions.length,
                questions,
            },
        });
    } catch (error) {
        console.error('Error getting quiz questions:', error);
        res.status(500).json({ success: false, message: 'Lỗi server' });
    }
};

/**
 * POST /api/quiz/submit
 * Accepts user answers and returns score + result
 * Body: { answers: { "1": "A", "2": "B", ... } }
 */
const submitQuiz = async (req, res) => {
    try {
        const { answers } = req.body;

        if (!answers || typeof answers !== 'object' || !hasValidAnswers(answers)) {
            return res.status(400).json({
                success: false,
                message: 'Vui lòng trả lời đầy đủ và hợp lệ tất cả câu hỏi',
            });
        }

        const result = calculateScore(answers);

        if (req.user?._id) {
            await User.updateOne(
                { _id: req.user._id },
                { $push: { dependencyAssessments: {
                    score: result.totalScore,
                    resultId: result.result.id,
                    submittedAt: new Date(),
                } } }
            );
        }

        res.json({
            success: true,
            data: result,
        });
    } catch (error) {
        console.error('Error submitting quiz:', error);
        res.status(500).json({ success: false, message: 'Lỗi server' });
    }
};

/**
 * GET /api/quiz/results
 * Returns all possible result categories (for reference/display)
 */
const getResults = (req, res) => {
    try {
        res.json({
            success: true,
            data: quizResults,
        });
    } catch (error) {
        console.error('Error getting quiz results:', error);
        res.status(500).json({ success: false, message: 'Lỗi server' });
    }
};

module.exports = {
  getQuestions,
  submitQuiz,
  getResults,
  hasValidAnswers,
};
