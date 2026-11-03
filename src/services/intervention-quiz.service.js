const { makeRequestWithRetry, startChat, extractResponseText } = require('./gemini.service');
const { formulaRule, parseModelJson } = require('./model-json');
const InterventionService = require('./intervention.service');

const OPTION_IDS = ['A', 'B', 'C', 'D'];
const normalizeQuestion = value => String(value || '')
  .toLocaleLowerCase()
  .replace(/[?!.:;,\-–—]/g, '')
  .replace(/\s+/g, ' ')
  .trim();

const stripCodeFence = (text) => String(text || '')
  .replace(/^```(?:json)?\s*/i, '')
  .replace(/\s*```$/i, '')
  .trim();

const safeJsonParse = (text) => parseModelJson(stripCodeFence(text), 'Invalid mini quiz JSON');

const normalizeMiniQuiz = (rawQuiz, language = 'en', previousQuiz = null) => {
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
    return getFallbackMiniQuiz(language, previousQuiz);
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

const getProblemSource = (conversation) => String(
  conversation.problemContext?.sourceText || getLastUserQuestion(conversation.history)
).slice(0, 1200);

const getFallbackMiniQuiz = (language = 'en', previousQuiz = null) => {
  const previousQuestions = (Array.isArray(previousQuiz) ? previousQuiz : [previousQuiz])
    .map(quiz => normalizeQuestion(quiz?.question));
  if (language === 'vi') {
    const fallbacks = [{
      question: 'Bước nhỏ đầu tiên em nên làm khi gặp bài này là gì?',
      options: [
        { id: 'A', text: 'Xác định dữ kiện đã cho và điều cần tìm' },
        { id: 'B', text: 'Chép ngay đáp án cuối' },
        { id: 'C', text: 'Bỏ qua phần điều kiện của đề' },
        { id: 'D', text: 'Đổi sang bài khác ngay' },
      ],
      correctOptionId: 'A',
      explanation: 'Bắt đầu bằng dữ kiện và điều cần tìm giúp em chọn đúng hướng giải.',
    }, {
      question: 'Khi bắt đầu giải bài, em nên xác định điều gì trước?',
      options: [
        { id: 'A', text: 'Dữ kiện và điều cần tìm' },
        { id: 'B', text: 'Đáp án cuối cùng' },
        { id: 'C', text: 'Một công thức bất kỳ' },
        { id: 'D', text: 'Bỏ qua điều kiện đề bài' },
      ],
      correctOptionId: 'A',
      explanation: 'Xác định dữ kiện và điều cần tìm giúp em chọn đúng hướng giải.',
    }];
    return fallbacks.find(item => !previousQuestions.includes(normalizeQuestion(item.question))) || {
      ...fallbacks[0],
      question: `Em hãy chọn một bước nền tảng khác để kiểm tra bài này (lần ${previousQuestions.length + 1})?`,
    };
  }

  const fallbacks = [{
    question: 'What is the best small first step for this problem?',
    options: [
      { id: 'A', text: 'Identify the given information and what is asked' },
      { id: 'B', text: 'Copy the final answer immediately' },
      { id: 'C', text: 'Ignore the problem conditions' },
      { id: 'D', text: 'Switch to another problem right away' },
    ],
    correctOptionId: 'A',
    explanation: 'Starting with the given information and goal helps choose the right method.',
  }, {
    question: 'Before solving, what should you identify first?',
    options: [
      { id: 'A', text: 'The given information and the goal' },
      { id: 'B', text: 'The final answer' },
      { id: 'C', text: 'Any formula at random' },
      { id: 'D', text: 'Nothing from the problem statement' },
    ],
    correctOptionId: 'A',
    explanation: 'Identifying the given information and goal helps choose the right method.',
  }];
  return fallbacks.find(item => !previousQuestions.includes(normalizeQuestion(item.question))) || {
    ...fallbacks[0],
    question: `Which different foundation step should you check for this problem (attempt ${previousQuestions.length + 1})?`,
  };
};

const buildMiniQuizPrompt = (conversation, language = 'en', previousQuiz = null, retry = false) => {
  const question = getLastUserQuestion(conversation.history);
  const problem = getProblemSource(conversation);
  const hint = getLastModelHint(conversation.history);
  const subject = conversation.course || conversation.subjectArea || 'the selected subject';
  const previousQuizzes = (Array.isArray(previousQuiz) ? previousQuiz : [previousQuiz])
    .filter(quiz => quiz?.question);
  const previousQuestionsText = previousQuizzes.map((quiz, index) => {
    const options = Array.isArray(quiz.options)
      ? quiz.options.map(option => option.text).filter(Boolean).join(' | ')
      : '';
    return `${index + 1}. ${quiz.question}${options ? ` — ${options}` : ''}`;
  }).join('\n');
  const variationInstruction = previousQuizzes.length
    ? language === 'vi'
      ? `\n\nCác câu hỏi nhỏ đã dùng trước đây (TUYỆT ĐỐI KHÔNG LẶP LẠI):\n${previousQuestionsText}\nHãy đổi kiểu kiểm tra và bước kiến thức so với TẤT CẢ các câu trên. Có thể đổi sang nhận diện dữ kiện, chọn công thức, điền bước còn thiếu, so sánh, phát hiện lỗi hoặc dự đoán kết quả.`
      : `\n\nPreviously used mini-questions (DO NOT REPEAT ANY OF THEM):\n${previousQuestionsText}\nChange the checking style and knowledge step from ALL questions above. You may switch to identifying data, choosing a formula, filling a missing step, comparing, spotting an error, or predicting a result.`
    : '';
  const retryInstruction = retry
    ? language === 'vi'
      ? '\n\nĐây là lần tạo lại vì câu trước bị trùng. Bắt buộc chọn một dạng kiểm tra khác hẳn và viết câu hỏi mới, không chỉ đổi vài từ.'
      : '\n\nThis is a retry because the previous output was duplicated. You must use a substantially different checking format and write a new question, not just reword it.'
    : '';

  if (language === 'vi') {
    return `Mỗi lần nhận yêu cầu, hãy tạo mới đúng 1 câu hỏi trắc nghiệm rất dễ, chỉ kiểm tra đúng một bước của đề gốc.${variationInstruction}${retryInstruction}

Yêu cầu:
- Câu hỏi kiểm tra một bước nền tảng hoặc bước tiếp theo nhỏ, không hỏi đáp án cuối.
- Có 4 lựa chọn ngắn A, B, C, D.
- Chỉ có 1 đáp án đúng.
- Không giải bài chính.
- Chỉ dùng kiến thức môn ${subject}; không đưa ví dụ liên môn hoặc đổi sang chủ đề khác.
- Câu hỏi phải bám trực tiếp vào đề gốc bên dưới, không hỏi kiến thức chung thay thế cho đề.
- ${formulaRule('vi')}
- Trả về JSON hợp lệ, không markdown, không giải thích ngoài JSON.

Đề gốc:
${problem}

Câu gần nhất học sinh gửi:
${question}

Gợi ý gần nhất của ThinkBridge:
${hint}

Schema JSON:
{"question":"...","options":[{"id":"A","text":"..."},{"id":"B","text":"..."},{"id":"C","text":"..."},{"id":"D","text":"..."}],"correctOptionId":"A","explanation":"..."}`;
  }

  return `Create a new very easy multiple-choice question on every request, checking exactly one small step from the original problem.${variationInstruction}${retryInstruction}

Requirements:
- Check one prerequisite or one small next step, not the final answer.
- Include 4 short choices A, B, C, D.
- Exactly 1 correct answer.
- Do not solve the main problem.
- Use only the selected subject (${subject}); do not introduce cross-subject examples or a different topic.
- The question must directly use the original problem below, not replace it with a generic knowledge question.
- ${formulaRule('en')}
- Return valid JSON only. No markdown.

Original problem:
${problem}

Latest student message:
${question}

Latest ThinkBridge hint:
${hint}

JSON schema:
{"question":"...","options":[{"id":"A","text":"..."},{"id":"B","text":"..."},{"id":"C","text":"..."},{"id":"D","text":"..."}],"correctOptionId":"A","explanation":"..."}`;
};

const generateMiniQuiz = async (conversation, language = 'en', previousQuiz = null) => {
  const previousQuizzes = (Array.isArray(previousQuiz) ? previousQuiz : [previousQuiz]).filter(quiz => quiz?.question);
  const previousQuestions = previousQuizzes.map(quiz => normalizeQuestion(quiz.question));
  try {
    const systemInstruction = language === 'vi'
      ? 'Bạn tạo câu hỏi trắc nghiệm ngắn, dễ, đúng trọng tâm để kiểm tra hiểu bài. Chỉ trả JSON hợp lệ.'
      : 'You create short, easy, focused multiple-choice checks. Return valid JSON only.';
    const chat = startChat([], systemInstruction);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const result = await makeRequestWithRetry(async () => chat.sendMessage(buildMiniQuizPrompt(conversation, language, previousQuiz, attempt > 0)));
      const parsed = safeJsonParse(extractResponseText(result));
      const miniQuiz = normalizeMiniQuiz(parsed, language, previousQuizzes);
      if (!previousQuestions.includes(normalizeQuestion(miniQuiz.question))) {
        return miniQuiz;
      }
    }
    return getFallbackMiniQuiz(language, previousQuiz);
  } catch (error) {
    console.error('Error generating intervention mini quiz:', error);
    return getFallbackMiniQuiz(language, previousQuiz);
  }
};

const ensureMiniQuizForGate = async (conversation, language = 'en', { refresh = false } = {}) => {
  const activeQuiz = conversation.interventionMetrics?.activeGate?.miniQuiz;
  if (activeQuiz?.question && !refresh) {
    return InterventionService.attachCurrentMiniQuiz(conversation, { active: true }).miniQuiz;
  }

  const previousQuizzes = [
    ...(conversation.interventionMetrics?.miniQuizHistory || []),
    ...(activeQuiz?.question ? [activeQuiz] : []),
  ];
  const miniQuiz = await generateMiniQuiz(conversation, language, previousQuizzes);
  return InterventionService.setActiveGateMiniQuiz(conversation, miniQuiz);
};

module.exports = {
  buildMiniQuizPrompt,
  ensureMiniQuizForGate,
  generateMiniQuiz,
};
