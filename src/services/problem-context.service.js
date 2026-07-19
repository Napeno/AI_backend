const { startChat, makeRequestWithRetry, extractResponseText } = require('./gemini.service');

const parseJson = (text) => {
  const cleaned = String(text || '').replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  return JSON.parse(firstBrace === -1 ? cleaned : cleaned.slice(firstBrace, lastBrace + 1));
};

const getQuestionIdFromText = (text = '') => String(text).toLowerCase().match(/(?:câu|question)\s*([a-z0-9]+)/i)?.[1] || null;

const toPublicProblemContext = (context = {}) => ({
  sourceText: context.sourceText || '',
  questions: Array.isArray(context.questions) ? context.questions.map(question => ({
    id: question.id,
    prompt: question.prompt,
    sourceExpression: question.sourceExpression || '',
  })) : [],
  suggestedQuestionId: context.suggestedQuestionId || null,
  activeQuestionId: context.activeQuestionId || null,
});

const setTextProblemContext = (conversation, sourceText) => {
  const text = String(sourceText || '').trim();
  if (!text) return toPublicProblemContext(conversation.problemContext);

  conversation.problemContext = {
    sourceText: text,
    questions: [{ id: 'main', prompt: text }],
    suggestedQuestionId: 'main',
    activeQuestionId: 'main',
    extractedAt: new Date(),
  };
  conversation.markModified?.('problemContext');
  return toPublicProblemContext(conversation.problemContext);
};

const extractImageProblemContext = async ({ sourceText, image, language = 'en' }) => {
  const messageParts = [{ text: `${language === 'vi' ? 'Chỉ trả JSON hợp lệ.' : 'Return valid JSON only.'}
Đọc đề bài trong ảnh. Không giải bài. Tách các câu con nếu có (a, b, c, d...).
Schema: {"questions":[{"id":"a","prompt":"...","sourceExpression":"..."}]}
sourceExpression chỉ là biểu thức gốc cần biến đổi/giải; để trống nếu không phải Toán.
Ngữ cảnh người dùng: ${sourceText || '(không có)'}` }];

  const response = await fetch(image.url);
  if (!response.ok) throw new Error(`Failed to fetch source image: ${response.status}`);
  messageParts.push({
    inlineData: {
      mimeType: response.headers.get('content-type') || 'image/jpeg',
      data: Buffer.from(await response.arrayBuffer()).toString('base64'),
    },
  });

  const chat = startChat([], language === 'vi'
    ? 'Bạn trích cấu trúc đề bài chính xác. Không giải bài. Chỉ trả JSON.'
    : 'Extract the problem structure accurately. Do not solve it. Return JSON only.');
  const parsed = parseJson(extractResponseText(await makeRequestWithRetry(() => chat.sendMessage(messageParts))));
  return Array.isArray(parsed.questions)
    ? parsed.questions.map((question, index) => ({
      id: String(question.id || index + 1).toLowerCase().match(/[a-z0-9]+/)?.[0] || String(index + 1),
      prompt: String(question.prompt || '').trim(),
      sourceExpression: String(question.sourceExpression || '').trim(),
    })).filter(question => question.prompt)
    : [];
};

const setImageProblemContext = async (conversation, { sourceText, image, language }) => {
  const existing = conversation.problemContext || {};
  if (existing.sourceImage?.url === image?.url && existing.questions?.length) {
    return toPublicProblemContext(existing);
  }

  let questions = [];
  try {
    questions = await extractImageProblemContext({ sourceText, image, language });
  } catch (error) {
    console.error('Problem context extraction failed:', error.message);
  }
  if (!questions.length) {
    questions = [{ id: 'main', prompt: sourceText || (language === 'vi' ? 'Đề bài trong ảnh' : 'Problem shown in image') }];
  }

  const requestedQuestionId = getQuestionIdFromText(sourceText);
  const suggestedQuestionId = questions.find(question => question.id === requestedQuestionId)?.id || questions[0].id;
  conversation.problemContext = {
    sourceText: sourceText || '',
    sourceImage: { url: image.url, public_id: image.public_id },
    questions,
    suggestedQuestionId,
    activeQuestionId: requestedQuestionId || questions.length === 1 ? suggestedQuestionId : undefined,
    extractedAt: new Date(),
  };
  conversation.markModified?.('problemContext');
  return toPublicProblemContext(conversation.problemContext);
};

const ensureProblemContext = async (conversation, language = 'en') => {
  if (conversation.problemContext?.questions?.length) return toPublicProblemContext(conversation.problemContext);
  const sourceMessage = [...(conversation.history || [])].reverse().find(message => message.role === 'user');
  if (!sourceMessage) return toPublicProblemContext();
  const sourceText = sourceMessage.parts?.map(part => part.text || '').join('\n').trim();
  const image = sourceMessage.parts?.find(part => part.image?.url)?.image;
  return image
    ? setImageProblemContext(conversation, { sourceText, image, language })
    : setTextProblemContext(conversation, sourceText);
};

const setActiveQuestion = (conversation, questionId) => {
  const context = conversation.problemContext || {};
  const question = context.questions?.find(item => item.id === String(questionId).toLowerCase());
  if (!question) return null;
  context.activeQuestionId = question.id;
  conversation.problemContext = context;
  conversation.markModified?.('problemContext');
  return toPublicProblemContext(context);
};

const getActiveQuestion = (context = {}) => context.questions?.find(question => question.id === context.activeQuestionId) || null;

module.exports = {
  ensureProblemContext,
  getActiveQuestion,
  setActiveQuestion,
  setImageProblemContext,
  setTextProblemContext,
  toPublicProblemContext,
};
