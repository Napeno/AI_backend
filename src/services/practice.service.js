const { makeRequestWithRetry, startChat, extractResponseText } = require('./gemini.service');
const PracticeItem = require('../models/practice-item.model');

const REVIEW_DAYS = [1, 3, 7];

const getLastUserQuestion = (history = []) => {
  const message = [...history].reverse().find(entry => entry.role === 'user' && entry.parts?.[0]?.text);
  return String(message?.parts?.[0]?.text || '').trim().slice(0, 1200);
};

const capturePracticeItem = async ({ userId, conversation, blocker, feedback = '' }) => {
  const sourceQuestion = getLastUserQuestion(conversation.history);
  if (!sourceQuestion) {
    return null;
  }

  const item = await PracticeItem.findOneAndUpdate(
    { user: userId, sessionId: conversation.sessionId, sourceQuestion, blocker },
    {
      $set: {
        educationLevel: conversation.educationLevel,
        subjectArea: conversation.subjectArea,
        sourceFeedback: String(feedback || '').slice(0, 1200),
        status: 'new',
        nextReviewAt: new Date(),
      },
      $setOnInsert: { practice: {}, reviewCount: 0 },
    },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );

  return item;
};

const parseJson = (text) => {
  const cleaned = String(text || '').replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  return JSON.parse(firstBrace === -1 ? cleaned : cleaned.slice(firstBrace, lastBrace + 1));
};

const getFallbackPractice = (item, language = 'en') => {
  const prompts = language === 'vi'
    ? {
      understand_question: ['Hãy viết ngắn gọn: đề cho gì và yêu cầu tìm gì?', 'Tách đề thành “dữ kiện” và “điều cần tìm”.'],
      formula: ['Hãy nêu công thức hoặc khái niệm em nghĩ cần dùng, rồi nói vì sao.', 'Nhìn lại đại lượng cần tìm trước khi chọn công thức.'],
      start: ['Nếu chỉ được làm một việc đầu tiên, em sẽ làm gì?', 'Hãy bắt đầu bằng dữ kiện rõ nhất trong đề.'],
      calculation: ['Hãy chọn một phép tính hoặc dòng biến đổi em muốn kiểm tra lại.', 'Kiểm tra từng phép tính nhỏ trước khi làm tiếp.'],
      incorrect_answer: ['Hãy thử lại một bước khác với lần trước và giải thích vì sao em chọn bước đó.', 'Đừng vội làm lại toàn bộ; hãy sửa đúng một bước.'],
    }
    : {
      understand_question: ['Briefly write what the problem gives and asks for.', 'Separate the given information from the goal.'],
      formula: ['Name the formula or idea you think applies, then say why.', 'Look at the target quantity before choosing a formula.'],
      start: ['If you could do only one first action, what would it be?', 'Start with the clearest given information.'],
      calculation: ['Choose one calculation or transformation line to check again.', 'Check each small calculation before continuing.'],
      incorrect_answer: ['Try one step differently from last time and explain why.', 'Do not restart everything; repair one step first.'],
    };
  const [prompt, hint] = prompts[item.blocker] || prompts.incorrect_answer;

  return { prompt, hint, answerGuide: '' };
};

const buildPracticePrompt = (item, language = 'en') => {
  const languageInstruction = language === 'vi' ? 'Trả lời bằng tiếng Việt.' : 'Respond in English.';
  return `${languageInstruction}
Tạo một nhiệm vụ ôn tập ngắn, trả lời tự do, mất không quá 2 phút. Không dùng trắc nghiệm, không đưa đáp án bài gốc.

Bài gốc: ${item.sourceQuestion}
Điểm học sinh từng kẹt: ${item.blocker}
Phản hồi trước đó: ${item.sourceFeedback || 'Không có'}

Trả JSON hợp lệ: {"prompt":"...","hint":"...","answerGuide":"..."}.
prompt yêu cầu đúng một bước nhỏ; hint gợi mở nhưng không giải hộ; answerGuide chỉ để hệ thống chấm.`;
};

const ensurePractice = async (item, language = 'en') => {
  if (item.practice?.prompt) {
    return item.practice;
  }

  let practice = getFallbackPractice(item, language);
  try {
    const chat = startChat([], language === 'vi'
      ? 'Bạn tạo bài ôn tập ngắn, tích cực và không tiết lộ đáp án bài gốc. Chỉ trả JSON hợp lệ.'
      : 'You create short, encouraging practice tasks without revealing the original answer. Return valid JSON only.');
    const result = await makeRequestWithRetry(async () => chat.sendMessage(buildPracticePrompt(item, language)));
    const parsed = parseJson(extractResponseText(result));
    if (String(parsed?.prompt || '').trim() && String(parsed?.hint || '').trim()) {
      practice = {
        prompt: String(parsed.prompt).trim(),
        hint: String(parsed.hint).trim(),
        answerGuide: String(parsed.answerGuide || '').trim(),
      };
    }
  } catch (error) {
    console.error('Error generating practice item:', error);
  }

  item.practice = practice;
  await item.save();
  return practice;
};

const evaluatePracticeAttempt = async (item, answer, language = 'en') => {
  const fallback = language === 'vi'
    ? { isCorrect: true, feedback: 'ThinkBridge đã ghi nhận bước em thử làm. Lần sau mình sẽ cùng kiểm tra kỹ hơn nhé.' }
    : { isCorrect: true, feedback: 'ThinkBridge recorded the step you tried. We will check it more closely next time.' };

  try {
    const chat = startChat([], language === 'vi'
      ? 'Bạn chấm một bước học tập ngắn một cách khích lệ. Chỉ trả JSON hợp lệ.'
      : 'You assess a short learning step encouragingly. Return valid JSON only.');
    const prompt = `${language === 'vi' ? 'Chỉ trả JSON.' : 'Return JSON only.'}
Bài gốc: ${item.sourceQuestion}
Nhiệm vụ: ${item.practice.prompt}
Gợi ý chấm: ${item.practice.answerGuide || 'Đánh giá xem học sinh có làm đúng một bước hợp lý hay không.'}
Học sinh trả lời: ${answer}

Schema: {"isCorrect":true,"feedback":"..."}
isCorrect chỉ true khi học sinh đã thể hiện một bước hợp lý. feedback ngắn, tích cực, không đưa đáp án hoàn chỉnh.`;
    const result = await makeRequestWithRetry(async () => chat.sendMessage(prompt));
    const parsed = parseJson(extractResponseText(result));
    if (typeof parsed?.isCorrect === 'boolean' && String(parsed?.feedback || '').trim()) {
      return { isCorrect: parsed.isCorrect, feedback: String(parsed.feedback).trim() };
    }
  } catch (error) {
    console.error('Error evaluating practice attempt:', error);
  }

  return fallback;
};

const applyPracticeResult = (item, isCorrect, now = new Date()) => {
  item.lastReviewedAt = now;

  if (!isCorrect) {
    item.status = 'needs_review';
    item.nextReviewAt = now;
    return item;
  }

  item.reviewCount += 1;
  item.status = item.reviewCount >= REVIEW_DAYS.length ? 'mastered' : 'reviewed';
  const days = REVIEW_DAYS[Math.min(item.reviewCount - 1, REVIEW_DAYS.length - 1)];
  item.nextReviewAt = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
  return item;
};

const toPublicPracticeItem = (item) => ({
  id: item._id,
  sessionId: item.sessionId,
  educationLevel: item.educationLevel,
  subjectArea: item.subjectArea,
  sourceQuestion: item.sourceQuestion,
  blocker: item.blocker,
  sourceFeedback: item.sourceFeedback,
  practice: item.practice?.prompt ? { prompt: item.practice.prompt, hint: item.practice.hint } : null,
  status: item.status,
  reviewCount: item.reviewCount,
  nextReviewAt: item.nextReviewAt,
  lastReviewedAt: item.lastReviewedAt,
  createdAt: item.createdAt,
});

module.exports = {
  applyPracticeResult,
  capturePracticeItem,
  ensurePractice,
  evaluatePracticeAttempt,
  getFallbackPractice,
  toPublicPracticeItem,
};
