const { makeRequestWithRetry, startChat, extractResponseText } = require('./gemini.service');
const PracticeItem = require('../models/practice-item.model');

const REVIEW_DAYS = [1, 3, 7];
const MAX_TURNS_IN_PROMPT = 6;

const getLastUserQuestion = (history = []) => {
  const message = [...history].reverse().find(entry => entry.role === 'user' && entry.parts?.[0]?.text);
  return String(message?.parts?.[0]?.text || '').trim().slice(0, 1200);
};

const getPracticeSourceQuestion = (conversation = {}) => {
  const context = conversation.problemContext || {};
  const questionId = context.activeQuestionId || context.suggestedQuestionId;
  const question = (context.questions || []).find(entry => entry.id === questionId);
  const selectedQuestion = [question?.prompt, question?.sourceExpression]
    .filter(Boolean)
    .join('\n')
    .trim();

  return (selectedQuestion || getLastUserQuestion(conversation.history)).slice(0, 1200);
};

const schedulePracticeGeneration = (item, language) => {
  // ponytail: best-effort in-process generation; opening the item retries after a restart.
  setImmediate(() => {
    ensurePractice(item, language).catch(error => {
      console.error('Error generating saved practice item:', error.message);
    });
  });
};

const capturePracticeItem = async ({ userId, conversation, blocker, feedback = '', language = 'en' }) => {
  const sourceQuestion = getPracticeSourceQuestion(conversation);
  if (!sourceQuestion) return null;

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

  if (!item.practice?.prompt) schedulePracticeGeneration(item, language);
  return item;
};

const parseJson = (text) => {
  const cleaned = String(text || '').replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  const json = firstBrace === -1 ? cleaned : cleaned.slice(firstBrace, lastBrace + 1);
  // Gemini may return LaTex such as \(x^2\) with raw backslashes, which JSON rejects.
  return JSON.parse(json.replace(/\\(?!["\\/bfnrtu])/g, '\\\\'));
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
Tạo một bài ôn trả lời tự do, mất không quá 2 phút, cùng đúng kỹ năng cần luyện nhưng là bài MỚI.
Đổi dữ kiện, số liệu, bối cảnh hoặc cách diễn đạt để không sao chép câu hay đáp án của bài gốc. Không dùng lại nguyên câu dài từ bài gốc, không hỏi lại bài gốc và không tiết lộ đáp án bài gốc. Không dùng trắc nghiệm.

Bài gốc chỉ để nhận biết kỹ năng: ${item.sourceQuestion}
Điểm học sinh từng kẹt: ${item.blocker}
Phản hồi trước đó: ${item.sourceFeedback || 'Không có'}

Trả JSON hợp lệ: {"prompt":"...","hint":"...","answerGuide":"..."}.
prompt là bài mới và yêu cầu đúng một bước nhỏ; hint gợi mở nhưng không giải hộ; answerGuide chỉ để hệ thống chấm. Nếu có công thức toán, luôn đặt biểu thức trong \\(...\\) để giao diện hiển thị đúng.`;
};

const ensurePractice = async (item, language = 'en') => {
  if (item.practice?.prompt) return item.practice;

  let practice = getFallbackPractice(item, language);
  try {
    const chat = startChat([], language === 'vi'
      ? 'Bạn tạo bài ôn mới, tích cực, cùng kỹ năng nhưng không sao chép hoặc tiết lộ đáp án bài gốc. Chỉ trả JSON hợp lệ.'
      : 'Create a new, encouraging practice task with the same skill without copying or revealing the original answer. Return valid JSON only.');
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

  item.practice = {
    ...practice,
    turns: item.practice?.turns || [],
    incorrectAttempts: item.practice?.incorrectAttempts || 0,
  };
  await item.save();
  return item.practice;
};

const formatRecentTurns = (item) => (item.practice?.turns || [])
  .slice(-MAX_TURNS_IN_PROMPT)
  .map(turn => `${turn.role}: ${turn.content}${turn.hint ? `\nGợi ý: ${turn.hint}` : ''}`.slice(0, 600))
  .join('\n');

const requestPracticeGuidance = async (item, action, answer = '', language = 'en') => {
  const actionInstruction = action === 'hint'
    ? 'Đưa đúng một gợi ý mới, tăng dần nhưng không giải hộ.'
    : action === 'solution'
      ? 'Giải thích ngắn gọn lời giải mẫu CHỈ cho bài ôn mới này. Không nhắc lại hay giải bài gốc.'
      : 'Đọc kỹ bước làm học sinh vừa gửi và đánh giá theo đúng bài ôn. Nếu sai, chỉ rõ đúng một điểm cần sửa; nếu đúng, xác nhận chính xác điều đã làm đúng. Câu hỏi tiếp theo phải dựa trên câu trả lời này, không dùng mẫu chung. Không giải trọn bài.';
  const prompt = `${language === 'vi' ? 'Chỉ trả JSON hợp lệ bằng tiếng Việt.' : 'Return valid JSON only in English.'}
Bạn là gia sư ôn tập theo kiểu dẫn dắt. ${actionInstruction}
Bài ôn mới: ${item.practice?.prompt}
Gợi ý chấm nội bộ: ${item.practice?.answerGuide || 'Đánh giá bước làm có hợp lý với bài ôn hay không.'}
Lịch sử gần đây:
${formatRecentTurns(item) || '(chưa có)'}
${action === 'attempt' ? `Bước học sinh vừa gửi: ${answer}` : ''}

Schema: {"isCorrect":true|false|null,"isMeaningfulAttempt":true|false,"feedback":"...","hint":"...","nextQuestion":"..."}.
Với hint hoặc solution, isCorrect là null. Với attempt, feedback phải nhắc đến bước hoặc phép tính học sinh vừa gửi; nextQuestion là bắt buộc và chỉ yêu cầu đúng một bước tiếp theo phù hợp với phản hồi đó. Không dùng các câu mẫu như “hãy viết một công thức” nếu không giải thích được công thức nào liên quan. Nếu có công thức toán, luôn đặt biểu thức trong \\(...\\) để giao diện hiển thị đúng.`;

  try {
    const chat = startChat([], language === 'vi'
      ? 'Bạn là gia sư gợi mở. Chỉ trả JSON hợp lệ.'
      : 'You are a guided tutor. Return valid JSON only.');
    const parsed = parseJson(extractResponseText(await makeRequestWithRetry(() => chat.sendMessage(prompt))));
    if (!String(parsed?.feedback || '').trim() || (action === 'attempt' && !String(parsed?.nextQuestion || '').trim())) {
      return null;
    }

    return {
      isCorrect: action === 'attempt' && typeof parsed.isCorrect === 'boolean' ? parsed.isCorrect : null,
      isMeaningfulAttempt: action === 'attempt' && parsed.isMeaningfulAttempt === true,
      feedback: String(parsed.feedback).trim().slice(0, 2000),
      hint: String(parsed.hint || '').trim().slice(0, 1200),
      nextQuestion: String(parsed.nextQuestion || '').trim().slice(0, 1200),
    };
  } catch (error) {
    console.error('Error guiding practice interaction:', error);
    return null;
  }
};

const evaluatePracticeAttempt = (item, answer, language = 'en') => requestPracticeGuidance(item, 'attempt', answer, language);

const canShowPracticeSolution = (item) => Number(item.practice?.incorrectAttempts || 0) >= 2;

const addPracticeTurn = (item, turn) => {
  if (!item.practice) item.practice = {};
  if (!item.practice.turns) item.practice.turns = [];
  item.practice.turns.push({ ...turn, createdAt: new Date() });
};

const addAssistantTurn = (item, action, result) => {
  addPracticeTurn(item, {
    role: 'assistant',
    action,
    content: result.feedback,
    hint: result.hint,
    nextQuestion: result.nextQuestion,
    isCorrect: result.isCorrect,
    isMeaningfulAttempt: result.isMeaningfulAttempt,
  });
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
  practice: item.practice?.prompt ? {
    prompt: item.practice.prompt,
    hint: item.practice.hint,
    turns: item.practice.turns || [],
    incorrectAttempts: item.practice.incorrectAttempts || 0,
  } : null,
  canShowSolution: canShowPracticeSolution(item),
  status: item.status,
  reviewCount: item.reviewCount,
  nextReviewAt: item.nextReviewAt,
  lastReviewedAt: item.lastReviewedAt,
  createdAt: item.createdAt,
});

module.exports = {
  addAssistantTurn,
  addPracticeTurn,
  applyPracticeResult,
  buildPracticePrompt,
  canShowPracticeSolution,
  capturePracticeItem,
  ensurePractice,
  evaluatePracticeAttempt,
  getFallbackPractice,
  getPracticeSourceQuestion,
  parseJson,
  requestPracticeGuidance,
  toPublicPracticeItem,
};
