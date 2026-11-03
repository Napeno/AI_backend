const { startChat, makeRequestWithRetry, extractResponseText } = require('./gemini.service');
const { parseModelJson } = require('./model-json');

const parseJson = (text) => parseModelJson(text);

const getQuestionIdFromText = (text = '') => String(text).toLowerCase().match(/(?:câu|cau|question)\s*([a-z0-9]+)/i)?.[1] || null;

const isNewProblemMessage = (text, context = {}) => {
  const value = String(text || '').trim();
  if (!value) return false;
  if (!context?.questions?.length) return true;
  const normalized = value.replace(/\s+/g, ' ').toLowerCase();
  const current = String(context.sourceText || '').replace(/\s+/g, ' ').toLowerCase();
  if (!current || normalized === current) return false;
  const requestedId = getQuestionIdFromText(value);
  const namesExisting = Boolean(requestedId && context.questions.some(question => question.id === requestedId));
  const heading = /(?:^|\n)\s*bài\s*\d+/i.test(value);
  const multiline = value.split('\n').filter(line => line.trim()).length >= 3;
  const expression = /[=^²]|\d+\s*[+\-−×*/]\s*\d+|[a-z]\s*(?:\^|²)/i.test(value);
  if (heading || multiline) return true;
  if (expression && !namesExisting) return true;
  if (value.length >= 180 && !namesExisting) return true;
  return false;
};

const replaceTextProblem = (conversation, text) => {
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

  if (isNewProblemMessage(text, conversation.problemContext)) return replaceTextProblem(conversation, text);

  // A short follow-up stays on the current problem. "Câu c..." only switches
  // the active part; a pasted new exercise replaces the context above.
  if (conversation.problemContext?.questions?.length) {
    const requestedQuestionId = getQuestionIdFromText(text);
    const requestedQuestion = conversation.problemContext.questions.find(question => question.id === requestedQuestionId);
    if (requestedQuestion) {
      conversation.problemContext.suggestedQuestionId = requestedQuestion.id;
      conversation.problemContext.activeQuestionId = requestedQuestion.id;
      conversation.markModified?.('problemContext');
    }
    return toPublicProblemContext(conversation.problemContext);
  }

  return replaceTextProblem(conversation, text);
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
    const requestedQuestionId = getQuestionIdFromText(sourceText);
    const requestedQuestion = existing.questions.find(question => question.id === requestedQuestionId);
    if (requestedQuestion) {
      existing.suggestedQuestionId = requestedQuestion.id;
      existing.activeQuestionId = requestedQuestion.id;
      conversation.markModified?.('problemContext');
    }
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
    activeQuestionId: suggestedQuestionId,
    extractedAt: new Date(),
  };
  conversation.markModified?.('problemContext');
  return toPublicProblemContext(conversation.problemContext);
};

const latestUserMessage = (conversation) => [...(conversation.history || [])].reverse().find(message => message.role === 'user');

const ensureProblemContext = async (conversation, language = 'en') => {
  if (conversation.problemContext?.questions?.length) {
    const latest = latestUserMessage(conversation);
    const latestText = latest?.parts?.map(part => part.text || '').join('\n').trim();
    const latestImage = latest?.parts?.find(part => part.image?.url)?.image;
    if (latestImage?.url && latestImage.url !== conversation.problemContext.sourceImage?.url) {
      return setImageProblemContext(conversation, { sourceText: latestText, image: latestImage, language });
    }
    if (latestText && isNewProblemMessage(latestText, conversation.problemContext)) {
      return setTextProblemContext(conversation, latestText);
    }
    const sourceImageMessage = (conversation.history || []).find(message => message.parts?.some(part => part.image?.url));
    if (!conversation.problemContext.sourceImage?.url && sourceImageMessage) {
      const image = sourceImageMessage.parts.find(part => part.image?.url)?.image;
      await setImageProblemContext(conversation, {
        sourceText: sourceImageMessage.parts.map(part => part.text || '').join('\n').trim(),
        image,
        language,
      });
    }
    const requestedQuestionId = getQuestionIdFromText(conversation.problemContext.sourceText);
    const requestedQuestion = conversation.problemContext.questions.find(question => question.id === requestedQuestionId);
    if (requestedQuestion) {
      conversation.problemContext.suggestedQuestionId = requestedQuestion.id;
      conversation.problemContext.activeQuestionId = requestedQuestion.id;
      conversation.markModified?.('problemContext');
    }
    if (!conversation.problemContext.activeQuestionId) {
      conversation.problemContext.activeQuestionId = conversation.problemContext.suggestedQuestionId || conversation.problemContext.questions[0].id;
      conversation.markModified?.('problemContext');
    }
    return toPublicProblemContext(conversation.problemContext);
  }
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
  isNewProblemMessage,
  getActiveQuestion,
  setActiveQuestion,
  setImageProblemContext,
  setTextProblemContext,
  toPublicProblemContext,
};
