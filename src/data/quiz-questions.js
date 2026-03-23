/**
 * Quiz: "Bạn đang dùng AI hay AI đang dùng bạn?"
 * 12 questions across 6 levels, each with 4 answer options
 * Each answer has a score value used to calculate the final result
 */

const quizQuestions = [
    // LEVEL 1: PHẢN XẠ TỰ NHIÊN
    {
        id: 1,
        level: 1,
        levelTitle: 'PHẢN XẠ TỰ NHIÊN',
        levelEmoji: '🧩',
        question: 'Khi gặp bài tập khó, bạn sẽ:',
        answers: [
            { id: 'A', text: 'Nghĩ trước vài phút rồi mới hỏi AI', score: 1 },
            { id: 'B', text: 'Mở AI ngay, tiết kiệm thời gian 😎', score: 3 },
            { id: 'C', text: 'Ngồi nhìn đề… và hy vọng có phép màu 🫠', score: 4 },
            { id: 'D', text: 'Nhắn tin cầu cứu bạn bè trước', score: 2 },
        ],
    },
    {
        id: 2,
        level: 1,
        levelTitle: 'PHẢN XẠ TỰ NHIÊN',
        levelEmoji: '🧩',
        question: 'Khi giáo viên giao bài về nhà, bạn thường:',
        answers: [
            { id: 'A', text: 'Tự làm trước, AI chỉ hỗ trợ', score: 1 },
            { id: 'B', text: 'Làm song song với AI', score: 2 },
            { id: 'C', text: 'Để AI làm chính', score: 4 },
            { id: 'D', text: 'Đợi gần deadline rồi tính 😅', score: 3 },
        ],
    },

    // LEVEL 2: "Ngày AI biến mất"
    {
        id: 3,
        level: 2,
        levelTitle: '"Ngày AI biến mất"',
        levelEmoji: '🧩',
        question: 'Nếu hôm nay AI "biến mất", bạn sẽ:',
        answers: [
            { id: 'A', text: 'Vẫn ổn, tự xử được', score: 1 },
            { id: 'B', text: 'Hơi lo nhưng cố làm', score: 2 },
            { id: 'C', text: 'Hoang mang thật sự 😱', score: 4 },
            { id: 'D', text: 'Thôi… mai làm tiếp', score: 3 },
        ],
    },
    {
        id: 4,
        level: 2,
        levelTitle: '"Ngày AI biến mất"',
        levelEmoji: '🧩',
        question: 'Khi không dùng AI, bạn cảm thấy:',
        answers: [
            { id: 'A', text: 'Bình thường', score: 1 },
            { id: 'B', text: 'Hơi chậm hơn', score: 2 },
            { id: 'C', text: 'Khó làm hơn nhiều', score: 3 },
            { id: 'D', text: 'Không biết bắt đầu từ đâu', score: 4 },
        ],
    },

    // LEVEL 3: "Bạn có bị AI lừa không?"
    {
        id: 5,
        level: 3,
        levelTitle: '"Bạn có bị AI lừa không?"',
        levelEmoji: '🧩',
        question: 'Khi AI trả lời rất "xịn", bạn sẽ:',
        answers: [
            { id: 'A', text: 'Kiểm tra lại', score: 1 },
            { id: 'B', text: 'Đọc rồi chỉnh sửa chút', score: 2 },
            { id: 'C', text: 'Copy luôn 😅', score: 4 },
            { id: 'D', text: 'Copy mà cũng chưa hiểu', score: 3 },
        ],
    },
    {
        id: 6,
        level: 3,
        levelTitle: '"Bạn có bị AI lừa không?"',
        levelEmoji: '🧩',
        question: 'Bạn có từng phát hiện AI sai chưa?',
        answers: [
            { id: 'A', text: 'Có, và mình sửa lại', score: 1 },
            { id: 'B', text: 'Có, nhưng kệ', score: 3 },
            { id: 'C', text: 'Chưa để ý', score: 2 },
            { id: 'D', text: 'AI mà sai à? 😆', score: 4 },
        ],
    },

    // LEVEL 4: "Não bạn đang hoạt động bao nhiêu %?"
    {
        id: 7,
        level: 4,
        levelTitle: '"Não bạn đang hoạt động bao nhiêu %?"',
        levelEmoji: '🧩',
        question: 'Trước khi làm bài, bạn:',
        answers: [
            { id: 'A', text: 'Lập dàn ý', score: 1 },
            { id: 'B', text: 'Nghĩ sơ qua', score: 2 },
            { id: 'C', text: 'Làm luôn', score: 3 },
            { id: 'D', text: 'Hỏi AI trước 😜', score: 4 },
        ],
    },
    {
        id: 8,
        level: 4,
        levelTitle: '"Não bạn đang hoạt động bao nhiêu %?"',
        levelEmoji: '🧩',
        question: 'Khi nộp bài có dùng AI, bạn có thể:',
        answers: [
            { id: 'A', text: 'Giải thích rõ ràng', score: 1 },
            { id: 'B', text: 'Giải thích được phần lớn', score: 2 },
            { id: 'C', text: 'Giải thích hơi khó', score: 3 },
            { id: 'D', text: '"Ủa bài này của mình hả?" 🤔', score: 4 },
        ],
    },

    // LEVEL 5: SỰ THẬT KHÓ NÓI 😆
    {
        id: 9,
        level: 5,
        levelTitle: 'SỰ THẬT KHÓ NÓI 😆',
        levelEmoji: '🧩',
        question: 'Bạn dùng AI khi nào nhiều nhất?',
        answers: [
            { id: 'A', text: 'Khi cần gợi ý', score: 1 },
            { id: 'B', text: 'Khi bí ý tưởng', score: 2 },
            { id: 'C', text: 'Khi lười 😅', score: 3 },
            { id: 'D', text: 'Khi… luôn luôn', score: 4 },
        ],
    },
    {
        id: 10,
        level: 5,
        levelTitle: 'SỰ THẬT KHÓ NÓI 😆',
        levelEmoji: '🧩',
        question: 'Bạn nghĩ AI là:',
        answers: [
            { id: 'A', text: 'Trợ lý học tập', score: 1 },
            { id: 'B', text: 'Người hỗ trợ nhanh', score: 2 },
            { id: 'C', text: '"Cứu tinh deadline"', score: 3 },
            { id: 'D', text: 'Não thứ 2 của mình 😆', score: 4 },
        ],
    },

    // LEVEL 6: Có những sự thật… bạn không muốn thừa nhận
    {
        id: 11,
        level: 6,
        levelTitle: 'Có những sự thật… bạn không muốn thừa nhận',
        levelEmoji: '🧩',
        question: 'Khi học bài mới, bạn:',
        answers: [
            { id: 'A', text: 'Tự hiểu trước', score: 1 },
            { id: 'B', text: 'Xem AI giải thích', score: 2 },
            { id: 'C', text: 'Nhờ AI tóm tắt', score: 3 },
            { id: 'D', text: 'Chỉ đọc AI', score: 4 },
        ],
    },
    {
        id: 12,
        level: 6,
        levelTitle: 'Có những sự thật… bạn không muốn thừa nhận',
        levelEmoji: '🧩',
        question: 'Sau khi học xong, bạn:',
        answers: [
            { id: 'A', text: 'Tự tóm tắt lại', score: 1 },
            { id: 'B', text: 'Xem lại bài', score: 2 },
            { id: 'C', text: 'Không làm gì thêm', score: 3 },
            { id: 'D', text: 'Quên luôn 😅', score: 4 },
        ],
    },
];

/**
 * Result categories based on total score ranges
 * Min score: 12 (all A), Max score: 48 (all D/worst)
 */
const quizResults = [
    {
        id: 'explorer',
        minScore: 12,
        maxScore: 18,
        color: '🟢',
        title: 'Nhà thám hiểm tư duy',
        emoji: '🧠✨',
        description: 'Bạn dùng AI rất thông minh. Bạn là người điều khiển công nghệ, không để công nghệ điều khiển mình. Quá đỉnh! 👏',
        advice: 'Hãy tiếp tục giữ vững phong cách học tập thông minh này! Bạn có thể giúp đỡ bạn bè học cách dùng AI hiệu quả hơn.',
        gradient: 'from-emerald-400 to-green-500',
        bgGradient: 'from-emerald-50 to-green-50',
    },
    {
        id: 'assistant_user',
        minScore: 19,
        maxScore: 27,
        color: '🟡',
        title: 'Người học có trợ lý AI',
        emoji: '🤝💡',
        description: 'AI là trợ lý, không phải "não phụ". Chỉ cần tự suy nghĩ trước 5–10 phút nữa là bạn sẽ học rất hiệu quả!',
        advice: 'Thử thách: Trước khi hỏi AI, hãy viết ra ít nhất 3 ý tưởng của riêng mình.',
        gradient: 'from-yellow-400 to-amber-500',
        bgGradient: 'from-yellow-50 to-amber-50',
    },
    {
        id: 'dependent',
        minScore: 28,
        maxScore: 36,
        color: '🟠',
        title: 'Người học hơi "dựa" AI',
        emoji: '😅📱',
        description: 'AI giúp bạn nhanh, nhưng bạn đang phụ thuộc hơi nhiều đó 😅 Thử thách bản thân bằng việc làm bài không AI trước nhé!',
        advice: 'Mỗi ngày hãy thử làm 1 bài tập mà không cần AI. Bạn sẽ ngạc nhiên với khả năng của mình!',
        gradient: 'from-orange-400 to-red-400',
        bgGradient: 'from-orange-50 to-red-50',
    },
    {
        id: 'need_detox',
        minScore: 37,
        maxScore: 48,
        color: '🔴',
        title: 'Người học cần "cai nhẹ" AI',
        emoji: '💪🔥',
        description: 'Đừng lo! Không phải bỏ AI, chỉ cần dùng lại đúng cách. Bắt đầu từ việc tự làm phần đầu tiên của mỗi bài nhé 💪',
        advice: 'Bước 1: Đọc đề và ghi ra những gì mình hiểu trước khi mở AI. Chỉ cần 5 phút thôi!',
        gradient: 'from-red-500 to-rose-600',
        bgGradient: 'from-red-50 to-rose-50',
    },
];

/**
 * Shuffle array using Fisher-Yates algorithm
 */
const shuffleArray = (array) => {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
};

/**
 * Get questions with shuffled answers (no scores exposed to client)
 */
const getQuestionsForClient = () => {
    return quizQuestions.map(q => ({
        id: q.id,
        level: q.level,
        levelTitle: q.levelTitle,
        levelEmoji: q.levelEmoji,
        question: q.question,
        answers: shuffleArray(q.answers).map(a => ({
            id: a.id,
            text: a.text,
        })),
    }));
};

/**
 * Calculate score from user answers
 * @param {Object} userAnswers - { questionId: answerId } map
 * @returns {{ totalScore: number, result: Object, breakdown: Array }}
 */
const calculateScore = (userAnswers) => {
    let totalScore = 0;
    const breakdown = [];

    for (const q of quizQuestions) {
        const selectedAnswerId = userAnswers[q.id];
        if (!selectedAnswerId) continue;

        const selectedAnswer = q.answers.find(a => a.id === selectedAnswerId);
        if (selectedAnswer) {
            totalScore += selectedAnswer.score;
            breakdown.push({
                questionId: q.id,
                answerId: selectedAnswer.id,
                score: selectedAnswer.score,
            });
        }
    }

    // Find matching result category
    const result = quizResults.find(r => totalScore >= r.minScore && totalScore <= r.maxScore)
        || quizResults[quizResults.length - 1]; // fallback to last

    return {
        totalScore,
        maxScore: 48,
        minScore: 12,
        result,
        breakdown,
        answeredCount: breakdown.length,
        totalQuestions: quizQuestions.length,
    };
};

module.exports = {
    quizQuestions,
    quizResults,
    getQuestionsForClient,
    calculateScore,
    shuffleArray,
};
