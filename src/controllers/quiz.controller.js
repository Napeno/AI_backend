const { getQuestionsForClient, calculateScore, quizResults } = require('../data/quiz-questions');

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
const submitQuiz = (req, res) => {
    try {
        const { answers } = req.body;

        if (!answers || typeof answers !== 'object') {
            return res.status(400).json({
                success: false,
                message: 'Vui lòng gửi câu trả lời hợp lệ',
            });
        }

        const result = calculateScore(answers);

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
};
