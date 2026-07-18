const { makeRequestWithRetry, startChat, extractResponseText } = require('./gemini.service');
const InterventionService = require('./intervention.service');

const OPTION_IDS = ['A', 'B', 'C', 'D'];

const stripCodeFence = (text) => String(text || '')
  .replace(/^```(?:json)?\s*/i, '')
  .replace(/\s*```$/i, '')
  .trim();

const safeJsonParse = (text) => {
  const cleaned = stripCodeFence(text);
  try {
    return JSON.parse(cleaned);
  } catch {
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      return JSON.parse(cleaned.slice(firstBrace, lastBrace + 1));
    }
    throw new Error('Invalid mini quiz JSON');
  }
};

const normalizeMiniQuiz = (rawQuiz, language = 'en') => {
  const question = String(rawQuiz?.question || '').trim();
  const rawOptions = Array.isArray(rawQuiz?.options) ? rawQuiz.options : [];
  const options = rawOptions
    .slice(0, 4)
    .map((option, index) => ({
      id: String(option?.id || OPTION_IDS[index] || index + 1).trim(),
      text: String(option?.text || option?.label || '').trim(),
    }))
    .filter(option => option.id && option.text);
  const correctOptionId = String(rawQuiz?.correctOptionId || '').trim();
  const explanation = String(rawQuiz?.explanation || '').trim();

  if (!question || options.length < 2 || !options.some(option => option.id === correctOptionId)) {
    return getFallbackMiniQuiz(language);
  }

  return {
    question,
    options,
    correctOptionId,
    explanation,
  };
};

const getLastUserQuestion = (history = []) => {
  const lastUserMessage = [...history]
    .reverse()
    .find(message => message.role === 'user' && message.parts?.[0]?.text);

  return String(lastUserMessage?.parts?.[0]?.text || '').slice(0, 900);
};

const getLastModelHint = (history = []) => {
  const lastModelMessage = [...history]
    .reverse()
    .find(message => message.role === 'model' && message.parts?.[0]?.text);

  return String(lastModelMessage?.parts?.[0]?.text || '').slice(0, 900);
};

const getFallbackMiniQuiz = (language = 'en') => {
  if (language === 'vi') {
    return {
      question: 'Bước nhỏ đầu tiên em nên làm khi gặp bài này là gì?',
      options: [
        { id: 'A', text: 'Xác định dữ kiện đã cho và điều cần tìm' },
        { id: 'B', text: 'Chép ngay đáp án cuối' },
        { id: 'C', text: 'Bỏ qua phần điều kiện của đề' },
        { id: 'D', text: 'Đổi sang bài khác ngay' },
      ],
      correctOptionId: 'A',
      explanation: 'Bắt đầu bằng dữ kiện và điều cần tìm giúp em chọn đúng hướng giải.',
    };
  }

  return {
    question: 'What is the best small first step for this problem?',
    options: [
      { id: 'A', text: 'Identify the given information and what is asked' },
      { id: 'B', text: 'Copy the final answer immediately' },
      { id: 'C', text: 'Ignore the problem conditions' },
      { id: 'D', text: 'Switch to another problem right away' },
    ],
    correctOptionId: 'A',
    explanation: 'Starting with the given information and goal helps choose the right method.',
  };
};

const buildMiniQuizPrompt = (conversation, language = 'en') => {
  const question = getLastUserQuestion(conversation.history);
  const hint = getLastModelHint(conversation.history);

  if (language === 'vi') {
    return `Tạo đúng 1 câu hỏi trắc nghiệm rất dễ liên quan trực tiếp đến bài học sinh đang hỏi.

Yêu cầu:
- Câu hỏi kiểm tra một bước nền tảng hoặc bước tiếp theo nhỏ, không hỏi đáp án cuối.
- Có 4 lựa chọn ngắn A, B, C, D.
- Chỉ có 1 đáp án đúng.
- Không giải bài chính.
- Với biểu thức Toán, bọc biểu thức bằng $...$ và dùng cú pháp đơn giản như ^, _, ngoặc; không để dấu $ bị thiếu cặp.
- Trả về JSON hợp lệ, không markdown, không giải thích ngoài JSON.

Bài học sinh hỏi:
${question}

Gợi ý gần nhất của ThinkBridge:
${hint}

Schema JSON:
{"question":"...","options":[{"id":"A","text":"..."},{"id":"B","text":"..."},{"id":"C","text":"..."},{"id":"D","text":"..."}],"correctOptionId":"A","explanation":"..."}`;
  }

  return `Create exactly 1 very easy multiple-choice question directly related to the student's problem.

Requirements:
- Check one prerequisite or one small next step, not the final answer.
- Include 4 short choices A, B, C, D.
- Exactly 1 correct answer.
- Do not solve the main problem.
- For math, wrap each expression in $...$ and use simple ^, _, and parentheses syntax; never leave an unmatched $.
- Return valid JSON only. No markdown.

Student problem:
${question}

Latest ThinkBridge hint:
${hint}

JSON schema:
{"question":"...","options":[{"id":"A","text":"..."},{"id":"B","text":"..."},{"id":"C","text":"..."},{"id":"D","text":"..."}],"correctOptionId":"A","explanation":"..."}`;
};

const generateMiniQuiz = async (conversation, language = 'en') => {
  try {
    const systemInstruction = language === 'vi'
      ? 'Bạn tạo câu hỏi trắc nghiệm ngắn, dễ, đúng trọng tâm để kiểm tra hiểu bài. Chỉ trả JSON hợp lệ.'
      : 'You create short, easy, focused multiple-choice checks. Return valid JSON only.';
    const chat = startChat([], systemInstruction);
    const result = await makeRequestWithRetry(async () => chat.sendMessage(buildMiniQuizPrompt(conversation, language)));
    const parsed = safeJsonParse(extractResponseText(result));
    return normalizeMiniQuiz(parsed, language);
  } catch (error) {
    console.error('Error generating intervention mini quiz:', error);
    return getFallbackMiniQuiz(language);
  }
};

const ensureMiniQuizForGate = async (conversation, language = 'en') => {
  const existingQuiz = conversation.interventionMetrics?.activeGate?.miniQuiz;
  if (existingQuiz?.question) {
    return InterventionService.attachCurrentMiniQuiz(conversation, { active: true }).miniQuiz;
  }

  const miniQuiz = await generateMiniQuiz(conversation, language);
  return InterventionService.setActiveGateMiniQuiz(conversation, miniQuiz);
};

module.exports = {
  ensureMiniQuizForGate,
  generateMiniQuiz,
};
