const { makeRequestWithRetry, startChat, extractResponseText } = require('./gemini.service');
const PracticeItem = require('../models/practice-item.model');
const { formulaRule, parseModelJson } = require('./model-json');
const {
  alignConversationSubject,
  inferSubjectFromContent,
  looksLikeChemistry,
  looksLikePureMathPrompt,
} = require('./subject-detect.service');

const REVIEW_DAYS = [1, 3, 7];
const MAX_TURNS_IN_PROMPT = 6;
const MAX_PRACTICE_GENERATION_ATTEMPTS = 3;
const PRACTICE_MODEL = process.env.GEMINI_PRACTICE_MODEL || 'gemini-3-flash-preview';
const QUESTION_TYPES = ['multiple_choice', 'true_false', 'fill_blank', 'long_answer'];
const normalizePracticePrompt = value => String(value || '').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
const isGeminiTransportError = error => Boolean(
  error?.status
  || error?.response?.status
  || /No Google API keys configured|No response from Gemini API|Invalid response format from Gemini API/i.test(String(error?.message || '')),
);

const getLastUserQuestion = (history = []) => {
  const message = [...history].reverse().find(entry => entry.role === 'user' && entry.parts?.[0]?.text);
  return String(message?.parts?.[0]?.text || '').trim().slice(0, 1200);
};

const getConversationTitle = (conversation = {}) => {
  const firstUserMessage = (conversation.history || []).find(entry => {
    const text = String(entry.parts?.[0]?.text || '').trim();
    return entry.role === 'user'
      && text
      && !text.includes('Bạn là một người thầy')
      && !text.includes('You are a friendly friend')
      && !text.includes('QUAN TRỌNG: Bạn KHÔNG BAO GIỜ');
  });
  if (!firstUserMessage) return 'New Chat';
  const title = String(firstUserMessage.parts[0].text).trim();
  return title.slice(0, 50) + (title.length > 50 ? '...' : '');
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

const resolvePracticeSubject = (conversation = {}, sourceQuestion = '') => {
  alignConversationSubject(conversation, sourceQuestion);
  const inferred = inferSubjectFromContent(sourceQuestion, conversation.educationLevel || 'middle');
  return {
    subjectArea: inferred?.subjectArea || conversation.subjectArea || 'natural_sciences',
    course: inferred?.course || conversation.course || conversation.subjectArea || '',
  };
};

const capturePracticeItem = async ({ userId, conversation, blocker, feedback = '', language = 'en' }) => {
  const sourceQuestion = getPracticeSourceQuestion(conversation);
  if (!sourceQuestion) return null;
  const subject = resolvePracticeSubject(conversation, sourceQuestion);
  if (conversation.subjectArea !== subject.subjectArea || conversation.course !== subject.course) {
    conversation.subjectArea = subject.subjectArea;
    conversation.course = subject.course;
    if (typeof conversation.save === 'function') {
      try { await conversation.save(); } catch (_) { /* capture must not fail the chat turn */ }
    }
  }

  const item = await PracticeItem.findOneAndUpdate(
    { user: userId, sessionId: conversation.sessionId, sourceQuestion, blocker },
    {
      $set: {
        conversationTitle: getConversationTitle(conversation),
        educationLevel: conversation.educationLevel,
        subjectArea: subject.subjectArea,
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

const parseJson = (text) => parseModelJson(text);

const buildPracticePrompt = (item, language = 'en', questionType = 'long_answer', repairError = '') => {
  const languageInstruction = language === 'vi' ? 'Trả lời bằng tiếng Việt.' : 'Respond in English.';
  const formats = {
    multiple_choice: {
      task: 'Tạo đúng một câu hỏi trắc nghiệm rõ ràng. Câu hỏi phải hỏi đúng một kiến thức hoặc một phép tính, có đủ dữ kiện, không mơ hồ, không gộp nhiều câu hỏi. Tạo đúng 4 lựa chọn A, B, C, D; các lựa chọn cùng kiểu dữ liệu, khác nhau, hợp lý và chỉ có đúng một đáp án. Không đặt đáp án đúng dài hoặc nổi bật bất thường hơn các đáp án khác.',
      schema: 'options là đúng 4 phần tử [{"id":"A","text":"..."},{"id":"B","text":"..."},{"id":"C","text":"..."},{"id":"D","text":"..."}], correctOptionId là một trong A, B, C, D',
    },
    true_false: {
      task: 'Tạo đúng một mệnh đề để học sinh xác định Đúng hoặc Sai. Mệnh đề phải ngắn, rõ, chỉ kiểm tra một ý, có thể xác định khách quan từ dữ kiện; không dùng mệnh đề kép, phủ định kép hoặc câu hỏi gây mẹo. correctAnswer phải là true nếu mệnh đề đúng và false nếu mệnh đề sai.',
      schema: 'correctAnswer là boolean true hoặc false',
    },
    fill_blank: {
      task: 'Tạo đúng một câu điền vào chỗ trống ngắn. Câu phải có đúng một chỗ trống dạng _____ ở vị trí cần điền một từ, số, đơn vị hoặc biểu thức ngắn. Đáp án phải duy nhất và answerGuide chỉ ghi đáp án cần điền, không ghi lời giải dài.',
      schema: 'prompt có đúng một _____ và answerGuide là đáp án ngắn duy nhất',
    },
    long_answer: {
      task: 'Tạo đúng một câu tự luận rõ ràng, yêu cầu học sinh trình bày cách suy nghĩ, công thức hoặc các bước giải cho một nhiệm vụ cụ thể. Câu phải có đủ dữ kiện, chỉ có một yêu cầu chính và phù hợp để làm trong khoảng 2 phút; không yêu cầu viết bài dài hoặc giải lại câu gốc.',
      schema: 'answerGuide nêu các ý hoặc kết quả tối thiểu để chấm, không hiển thị cho học sinh',
    },
  }[questionType] || null;
  const format = formats || formats.long_answer;
  const previousVariants = (item.practice?.variants || [])
    .map(variant => `${variant.questionType}: ${variant.prompt}`)
    .join('\n');
  const subjectLabel = item.course || item.subjectArea || 'natural_sciences';
  return `${languageInstruction}
Tạo một bài ôn mới mất không quá 2 phút, cùng đúng kỹ năng cần luyện nhưng là bài MỚI.
Chỉ được đổi số liệu. Giữ nguyên mọi chất và công thức của bài gốc. Không thay sắt bằng kẽm, không đổi phản ứng, không tiết lộ đáp án bài gốc.
BẮT BUỘC giữ đúng môn học "${subjectLabel}". Nếu bài gốc là hóa học thì chỉ tạo câu hóa học; tuyệt đối không tạo câu đại số, biểu thức, thay số vào x, hay toán thuần.
Giữ đúng DẠNG lời giải của bài gốc. Cách giải trong câu mới phải làm được ngay bằng dữ kiện đã cho.
Nếu bài gốc là bảo toàn khối lượng, câu mới phải cho ít nhất ba khối lượng có đơn vị g và đúng một ẩn. Không được bỏ một khối lượng rồi vẫn bảo học sinh dùng định luật bảo toàn. Không đổi sang tính số mol, nồng độ hoặc hiệu suất khi bài gốc chỉ là cộng trừ khối lượng.
${format.task}

Đây là loại câu bắt buộc: ${questionType}. Chỉ tạo đúng loại này, không đổi sang loại khác. Không được tạo câu giống hoặc chỉ đổi nhãn của các câu đã có:
${previousVariants || '(chưa có câu nào)'}

Bài gốc, giữ đúng dạng này: ${item.sourceQuestion}
Môn học bắt buộc: ${subjectLabel}
Điểm học sinh từng kẹt: ${item.blocker}
Phản hồi trước đó: ${item.sourceFeedback || 'Không có'}

Trả JSON hợp lệ với trường questionType chính xác là "${questionType}" và các trường bắt buộc prompt, hint, answerGuide; ${format.schema}${questionType === 'multiple_choice' ? ', options, correctOptionId' : questionType === 'true_false' ? ', correctAnswer' : ''}.
prompt là bài mới; hint gợi mở nhưng không giải hộ; answerGuide chỉ để hệ thống chấm. ${formulaRule(language)}${repairError ? `

LỖI Ở LẦN TRƯỚC: ${repairError}. Hãy tạo lại toàn bộ JSON và sửa đúng lỗi đó.` : ''}`;
};

const FORMULA_ELEMENTS = new Set(['H', 'He', 'Li', 'Be', 'B', 'C', 'N', 'O', 'F', 'Ne', 'Na', 'Mg', 'Al', 'Si', 'P', 'S', 'Cl', 'K', 'Ca', 'Fe', 'Cu', 'Zn', 'Ag', 'Sn', 'I', 'Ba', 'Pb', 'Mn', 'Cr', 'Ni', 'Co', 'Hg', 'Br']);
const SUBSCRIPT_DIGITS = { '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4', '₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9' };

const extractFormulas = (text) => {
  const normalized = String(text || '').replace(/[₀-₉]/g, digit => SUBSCRIPT_DIGITS[digit] || digit);
  const tokens = normalized.match(/[A-Z][a-z]?\d*(?:[A-Z][a-z]?\d*)*/g) || [];
  const formulas = [];
  for (const token of tokens) {
    const parts = token.match(/[A-Z][a-z]?/g) || [];
    if (parts.length && parts.every(part => FORMULA_ELEMENTS.has(part))) formulas.push(token);
  }
  return [...new Set(formulas)];
};

const sameSubstanceIssue = (source, prompt) => {
  const required = extractFormulas(source);
  if (required.length < 2) return '';
  const present = new Set(extractFormulas(prompt));
  const missing = required.filter(token => !present.has(token));
  if (!missing.length) return '';
  return `Câu ôn đổi chất, thiếu công thức của bài gốc: ${missing.join(', ')}.`;
};

const isOffSubjectPractice = (item, prompt) => {
  // Chemistry sources must never get algebra "biểu thức đại số / thay x =" drills.
  if (!looksLikeChemistry(item?.sourceQuestion || '')) return false;
  return looksLikePureMathPrompt(prompt);
};

const parseGramNumbers = (text) => {
  const values = [];
  for (const match of String(text || '').matchAll(/(\d+(?:[.,]\d+)?)\s*g(?![a-zA-Z])/gi)) {
    const value = Number(String(match[1]).replace(',', '.'));
    if (Number.isFinite(value)) values.push(value);
  }
  return values;
};

const hasMassUnknown = (text) => /(?:\bx\s*g\b|tính\s+x\b|tính\s+khối\s*lượng|bao nhiêu|_____)/i.test(String(text || ''));

const conservationUnknown = (grams) => {
  if (grams.length < 3) return null;
  const sum = grams.reduce((total, value) => total + value, 0);
  const unknown = sum - 2 * Math.max(...grams);
  if (unknown < 0) return null;
  return Math.round(unknown * 1000) / 1000;
};

const isMassConservationSource = (text) => {
  const value = String(text || '');
  if (/(?:số\s*mol|hiệu\s*suất|nồng\s*độ|khối\s*lượng\s*mol)/i.test(value)) return false;
  const grams = parseGramNumbers(value);
  return grams.length >= 3 && hasMassUnknown(value) && conservationUnknown(grams) !== null;
};

const formatViNumber = (value) => String(Math.round(Number(value) * 1000) / 1000).replace('.', ',');

const explainMassConservation = (prompt, selectedLabel = '') => {
  if (!isMassConservationSource(prompt)) return null;
  const grams = parseGramNumbers(prompt);
  const largest = Math.max(...grams);
  const maxIndex = grams.indexOf(largest);
  const reactants = grams.filter((_, index) => index !== maxIndex);
  const reactantSum = Math.round(reactants.reduce((total, value) => total + value, 0) * 1000) / 1000;
  const unknown = Math.round((reactantSum - largest) * 1000) / 1000;
  if (unknown < 0) return null;
  const left = reactants.map(formatViNumber).join(' + ');
  const sumText = formatViNumber(reactantSum);
  const productText = formatViNumber(largest);
  const unknownText = formatViNumber(unknown);
  const choice = selectedLabel ? `Lựa chọn ${selectedLabel} chưa đúng. ` : '';
  const steps = `${choice}Áp dụng định luật bảo toàn khối lượng: tổng khối lượng các chất tham gia bằng tổng khối lượng các chất sản phẩm.\nCộng các khối lượng đã biết của chất tham gia: ${left} = ${sumText}.\nPhương trình: ${sumText} = ${productText} + x.\nVậy x = ${unknownText} g, vì ${sumText} − ${productText} = ${unknownText}.`;
  return {
    feedback: steps,
    correctFeedback: `Đúng. ${left} = ${sumText}, rồi x = ${sumText} − ${productText} = ${unknownText} g.`,
    nextQuestion: `Khối lượng còn lại x bằng ${unknownText} g. Em đối chiếu lại với các lựa chọn trong đề.`,
  };
};

const numbersClose = (left, right) => Math.abs(left - right) <= 0.05;

const parseLooseNumbers = (text) => {
  const values = [];
  for (const match of String(text || '').matchAll(/(\d+(?:[.,]\d+)?)/g)) {
    const value = Number(String(match[1]).replace(',', '.'));
    if (Number.isFinite(value)) values.push(value);
  }
  return values;
};

const allowedPracticeNumbers = (variant = {}) => {
  const texts = [variant.prompt, variant.answerGuide, ...(variant.options || []).map(option => option.text)];
  const grams = parseGramNumbers(variant.prompt);
  const derived = [];
  for (let i = 0; i < grams.length; i += 1) {
    for (let j = i + 1; j < grams.length; j += 1) {
      derived.push(grams[i] + grams[j], Math.abs(grams[i] - grams[j]));
    }
  }
  const unknown = conservationUnknown(grams);
  if (unknown !== null) derived.push(unknown);
  return [...texts.flatMap(parseLooseNumbers), ...derived];
};

const guidanceNumberIssue = (variant, reply) => {
  const allowed = allowedPracticeNumbers(variant);
  if (!allowed.length) return '';
  const isAllowed = (value) => allowed.some(candidate => numbersClose(candidate, value));
  for (const value of parseGramNumbers(reply)) {
    if (!isAllowed(value)) return `Phản hồi dùng khối lượng ${formatViNumber(value)} g không có trong đề.`;
  }
  for (const match of String(reply || '').matchAll(/=\s*(\d+(?:[.,]\d+)?)/g)) {
    const value = Number(String(match[1]).replace(',', '.'));
    if (Number.isFinite(value) && !isAllowed(value)) return `Kết quả ${formatViNumber(value)} không tính được từ số trong đề.`;
  }
  const closed = String(reply || '').match(/(\d+(?:[.,]\d+)?)\s*\+\s*(\d+(?:[.,]\d+)?)\s*=\s*(\d+(?:[.,]\d+)?)(?!\s*\+)/);
  if (closed) {
    const left = Number(closed[1].replace(',', '.')) + Number(closed[2].replace(',', '.'));
    const right = Number(closed[3].replace(',', '.'));
    if (!numbersClose(left, right)) return `Phương trình ${closed[0]} không khép.`;
  }
  return '';
};

const textHasNumber = (text, expected) => {
  for (const match of String(text || '').matchAll(/(\d+(?:[.,]\d+)?)/g)) {
    const value = Number(String(match[1]).replace(',', '.'));
    if (Number.isFinite(value) && Math.abs(value - expected) <= 0.05) return true;
  }
  return false;
};

const massConservationIssue = (source, prompt, answerGuide = '', correctOptionText = '') => {
  const sourceIsConservation = isMassConservationSource(source);
  const claimsConservation = /bảo\s*toàn\s*khối\s*lượng/i.test(String(prompt || ''));
  if (!sourceIsConservation && !claimsConservation) return '';
  if (sourceIsConservation && /(?:số\s*mol|khối\s*lượng\s*mol|nồng\s*độ|hiệu\s*suất)/i.test(String(prompt || ''))) {
    return 'Câu ôn đổi sang tính mol hoặc hiệu suất trong khi bài gốc là bảo toàn khối lượng.';
  }
  const grams = parseGramNumbers(prompt);
  if (grams.length < 3 || !hasMassUnknown(prompt)) {
    return 'Câu bảo toàn khối lượng phải có ít nhất ba khối lượng đã biết (g) và một ẩn.';
  }
  const expected = conservationUnknown(grams);
  if (expected === null) return 'Các khối lượng đã cho không khép được bằng phép cộng trừ.';
  if (!textHasNumber(answerGuide, expected)) {
    return `Đáp án không khớp phép cộng trừ khối lượng. Ẩn phải bằng ${expected} g.`;
  }
  if (correctOptionText && !textHasNumber(correctOptionText, expected)) {
    return `Đáp án trắc nghiệm không khớp phép cộng trừ khối lượng. Ẩn phải bằng ${expected} g.`;
  }
  return '';
};

const getReadVariant = (item, questionType) => {
  return item.practice?.variants?.find(entry => entry.questionType === questionType) || null;
};

const ensurePracticeVariant = (item, questionType) => {
  item.practice ||= {};
  item.practice.variants ||= [];
  return item.practice.variants.find(entry => entry.questionType === questionType) || null;
};

const validateGeneratedPractice = (parsed, questionType) => {
  if (parsed?.questionType !== questionType) return null;
  const prompt = String(parsed?.prompt || '').trim();
  const hint = String(parsed?.hint || '').trim();
  const answerGuide = String(parsed?.answerGuide || '').trim();
  if (!prompt || !hint || !answerGuide || prompt.length > 2000 || hint.length > 1200 || answerGuide.length > 2000) return null;

  const result = { questionType, prompt, hint, answerGuide, turns: [], incorrectAttempts: 0, status: 'new', reviewCount: 0, nextReviewAt: new Date() };
  if (questionType === 'multiple_choice') {
    const options = Array.isArray(parsed.options) ? parsed.options.map(option => ({ id: String(option?.id || '').trim(), text: String(option?.text || '').trim() })) : [];
    if (options.length !== 4 || options.some(option => !option.id || !option.text) || new Set(options.map(option => option.id)).size !== options.length || options.map(option => option.id).join(',') !== 'A,B,C,D') return null;
    result.options = options;
    result.correctOptionId = String(parsed.correctOptionId || '').trim();
    if (!result.options.some(option => option.id === result.correctOptionId)) return null;
  }
  if (questionType === 'true_false' && typeof parsed.correctAnswer !== 'boolean') return null;
  if (questionType === 'fill_blank' && (prompt.match(/_{2,}/g) || []).length !== 1) return null;
  if (questionType === 'true_false') result.correctAnswer = parsed.correctAnswer;
  return result;
};

const generatePracticeVariant = async (item, questionType, language = 'en') => {
  if (!QUESTION_TYPES.includes(questionType)) throw new Error('Invalid practice question type');
  let repairError = '';
  let variant;
  let lastError;
  for (let attempt = 1; attempt <= MAX_PRACTICE_GENERATION_ATTEMPTS && !variant; attempt += 1) {
    try {
      const chat = startChat([], language === 'vi'
        ? 'Bạn tạo đúng một bài ôn mới theo loại được yêu cầu. Chỉ trả JSON hợp lệ. Giữ đúng dạng bài gốc.'
        : 'Create exactly one new practice task in the requested type. Return valid JSON only. Keep the original problem form.', PRACTICE_MODEL);
      const result = await makeRequestWithRetry(() => chat.sendMessage(buildPracticePrompt(item, language, questionType, repairError)));
      variant = validateGeneratedPractice(parseJson(extractResponseText(result)), questionType);
      if (!variant) throw new Error(`Gemini returned invalid ${questionType} practice format`);
      if (isOffSubjectPractice(item, variant.prompt)) {
        variant = undefined;
        throw new Error(`Gemini returned an off-subject ${questionType} practice question`);
      }
      const correctOptionText = variant.options?.find(option => option.id === variant.correctOptionId)?.text || '';
      const formIssue = massConservationIssue(item.sourceQuestion, variant.prompt, variant.answerGuide, correctOptionText)
        || sameSubstanceIssue(item.sourceQuestion, variant.prompt);
      if (formIssue) {
        variant = undefined;
        throw new Error(formIssue);
      }
      const existingPrompts = new Set((item.practice?.variants || []).map(entry => normalizePracticePrompt(entry.prompt)));
      if (existingPrompts.has(normalizePracticePrompt(variant.prompt)) || normalizePracticePrompt(item.sourceQuestion) === normalizePracticePrompt(variant.prompt)) {
        variant = undefined;
        throw new Error(`Gemini returned a duplicate ${questionType} practice question`);
      }
    } catch (error) {
      lastError = error;
      console.error('Practice question generation failed:', error.message);
      if (isGeminiTransportError(error)) throw error;
      repairError = error.message;
      variant = undefined;
    }
  }
  if (!variant) throw lastError || new Error('Practice question generation failed');

  item.practice ||= {};
  item.practice.variants ||= [];
  item.practice.variants = item.practice.variants.filter(entry => entry.questionType !== questionType);
  item.practice.variants.push(variant);
  item.status = 'new';
  item.reviewCount = 0;
  item.nextReviewAt = new Date();
  item.lastReviewedAt = undefined;
  await item.save();
  return variant;
};

const formatRecentTurns = (item, variant = item.practice) => (variant?.turns || [])
  .slice(-MAX_TURNS_IN_PROMPT)
  .map(turn => `${turn.role}: ${turn.content}${turn.hint ? `\nGợi ý: ${turn.hint}` : ''}`.slice(0, 600))
  .join('\n');

const normalizeAnswer = (value) => String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');

const conservationReply = (variant, action, answer) => {
  const explanation = explainMassConservation(variant?.prompt);
  if (!explanation) return null;
  if (action === 'solution') {
    return { isCorrect: null, isMeaningfulAttempt: false, feedback: explanation.feedback, hint: '', nextQuestion: explanation.nextQuestion };
  }
  if (action !== 'attempt') return null;
  const option = variant.options?.find(entry => entry.id === answer);
  const selectedLabel = option ? `${option.id} (${option.text})` : answer;
  const detailed = explainMassConservation(variant.prompt, selectedLabel);
  const isCorrect = variant.correctOptionId ? answer === variant.correctOptionId : null;
  if (isCorrect === false) {
    return { isCorrect: false, isMeaningfulAttempt: true, feedback: detailed.feedback, hint: '', nextQuestion: detailed.nextQuestion };
  }
  if (isCorrect === true) {
    return { isCorrect: true, isMeaningfulAttempt: true, feedback: detailed.correctFeedback, hint: '', nextQuestion: '' };
  }
  return null;
};

const requestPracticeGuidance = async (item, action, answer = '', language = 'en', questionType = 'long_answer') => {
  const variant = getReadVariant(item, questionType);
  if (!variant) return null;
  const prepared = conservationReply(variant, action, answer);
  if (prepared) return prepared;
  const actionInstruction = action === 'hint'
    ? 'Đưa đúng một gợi ý mới, tăng dần nhưng không giải hộ. Chỉ dùng số có trong đề.'
    : action === 'solution'
      ? 'Giải thích chi tiết hướng làm CHỈ cho bài ôn này, từng bước. Mỗi phép tính phải ghi kết quả trung gian. Chỉ dùng số có trong đề, các lựa chọn và gợi ý chấm. Không bịa số mới.'
      : 'Nếu sai, giải thích chi tiết hướng làm từng bước bằng đúng số trong đề. Mỗi phép tính phải ghi kết quả trung gian. Không bịa khối lượng mới. Nếu đúng, xác nhận và nêu ngắn phép tính đúng.';
  const prompt = `${language === 'vi' ? 'Chỉ trả JSON hợp lệ bằng tiếng Việt.' : 'Return valid JSON only in English.'}
Bạn là gia sư ôn tập. ${actionInstruction}
Loại bài: ${questionType}
Bài ôn mới: ${variant.prompt}
${questionType === 'multiple_choice' ? `Các lựa chọn: ${JSON.stringify(variant.options)}` : ''}
${questionType === 'multiple_choice' ? `Đáp án đúng nội bộ: ${variant.correctOptionId}` : questionType === 'true_false' ? `Đáp án đúng nội bộ: ${variant.correctAnswer ? 'true' : 'false'}` : ''}
Gợi ý chấm nội bộ: ${variant.answerGuide || 'Đánh giá bước làm có hợp lý với bài ôn hay không.'}
Lịch sử gần đây:
${formatRecentTurns(item, variant) || '(chưa có)'}
${action === 'attempt' ? `Bước học sinh vừa gửi: ${answer}` : ''}

Schema: {"isCorrect":true|false|null,"isMeaningfulAttempt":true|false,"feedback":"...","hint":"...","nextQuestion":"..."}.
Với hint hoặc solution, isCorrect là null. Với attempt, feedback phải nhắc lựa chọn hoặc bước học sinh vừa gửi và giải thích hướng làm; nextQuestion là bắt buộc. Không dùng số không có trong đề. ${formulaRule(language)}`;

  let repairError = '';
  let lastError;
  for (let attempt = 1; attempt <= MAX_PRACTICE_GENERATION_ATTEMPTS; attempt += 1) {
    try {
      const chat = startChat([], language === 'vi'
        ? 'Bạn là gia sư. Chỉ trả JSON hợp lệ. Giải thích hướng làm bằng đúng số trong đề.'
        : 'You are a tutor. Return valid JSON only. Explain the method using only numbers from the question.', PRACTICE_MODEL);
      const parsed = parseJson(extractResponseText(await makeRequestWithRetry(() => chat.sendMessage(`${prompt}${repairError ? `\n\nLỖI Ở LẦN TRƯỚC: ${repairError}. Hãy sửa và trả lại toàn bộ JSON.` : ''}`))));
      if (!parsed || typeof parsed !== 'object' || !String(parsed.feedback || '').trim()) throw new Error('Gemini returned invalid practice guidance');
      if (action !== 'attempt' && parsed.isCorrect !== null) throw new Error('Gemini returned an answer for a non-attempt action');
      if (action === 'attempt' && typeof parsed.isCorrect !== 'boolean') throw new Error('Gemini returned invalid practice correctness');
      if (action === 'attempt' && typeof parsed.isMeaningfulAttempt !== 'boolean') throw new Error('Gemini returned invalid practice attempt status');
      if (action === 'attempt' && !String(parsed.nextQuestion || '').trim()) throw new Error('Gemini returned no next step for the practice attempt');
      if (action === 'hint' && !String(parsed.hint || '').trim()) throw new Error('Gemini returned no hint for the practice hint request');
      const reply = {
        isCorrect: action === 'attempt' && typeof parsed.isCorrect === 'boolean' ? parsed.isCorrect : null,
        isMeaningfulAttempt: action === 'attempt' && parsed.isMeaningfulAttempt === true,
        feedback: String(parsed.feedback).trim().slice(0, 2000),
        hint: String(parsed.hint || '').trim().slice(0, 1200),
        nextQuestion: String(parsed.nextQuestion || '').trim().slice(0, 1200),
      };
      const numberIssue = guidanceNumberIssue(variant, `${reply.feedback}\n${reply.hint}\n${reply.nextQuestion}`);
      if (numberIssue) throw new Error(numberIssue);
      return reply;
    } catch (error) {
      lastError = error;
      console.error('Practice guidance generation failed:', error.message);
      if (isGeminiTransportError(error)) throw error;
      repairError = error.message;
    }
  }
  throw lastError || new Error('Practice guidance generation failed');
};

const evaluatePracticeAttempt = async (item, answer, language = 'en', questionType = 'long_answer') => {
  const variant = getReadVariant(item, questionType);
  const prepared = conservationReply(variant, 'attempt', answer);
  if (prepared) return prepared;
  const result = await requestPracticeGuidance(item, 'attempt', answer, language, questionType);
  if (!result) return null;

  if (questionType === 'multiple_choice' && variant?.correctOptionId) {
    result.isCorrect = answer === variant.correctOptionId;
    result.isMeaningfulAttempt = true;
  }
  if (questionType === 'true_false' && typeof variant?.correctAnswer === 'boolean') {
    result.isCorrect = answer === String(variant.correctAnswer);
    result.isMeaningfulAttempt = true;
  }
  if (questionType === 'fill_blank' && variant?.answerGuide) {
    result.isCorrect = normalizeAnswer(answer) === normalizeAnswer(variant.answerGuide);
    result.isMeaningfulAttempt = true;
  }
  return result;
};

const canShowPracticeSolution = (item, variant) => Number((variant || item?.practice || item)?.incorrectAttempts || 0) >= 2;

const addPracticeTurn = (item, turn, variant = item.practice) => {
  if (!item.practice) item.practice = {};
  if (!variant.turns) variant.turns = [];
  variant.turns.push({ ...turn, createdAt: new Date() });
};

const addAssistantTurn = (item, action, result, variant = item.practice) => {
  addPracticeTurn(item, {
    role: 'assistant',
    action,
    content: result.feedback,
    hint: result.hint,
    nextQuestion: result.nextQuestion,
    isCorrect: result.isCorrect,
    isMeaningfulAttempt: result.isMeaningfulAttempt,
  }, variant);
};

const applyPracticeResult = (item, isCorrect, now = new Date(), variant = item) => {
  variant.lastReviewedAt = now;

  if (!isCorrect) {
    variant.status = 'needs_review';
    variant.nextReviewAt = now;
    if (variant !== item) Object.assign(item, { status: variant.status, reviewCount: variant.reviewCount, nextReviewAt: variant.nextReviewAt, lastReviewedAt: variant.lastReviewedAt });
    return item;
  }

  variant.reviewCount = Number(variant.reviewCount || 0) + 1;
  variant.status = variant.reviewCount >= REVIEW_DAYS.length ? 'mastered' : 'reviewed';
  const days = REVIEW_DAYS[Math.min(variant.reviewCount - 1, REVIEW_DAYS.length - 1)];
  variant.nextReviewAt = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
  if (variant !== item) Object.assign(item, { status: variant.status, reviewCount: variant.reviewCount, nextReviewAt: variant.nextReviewAt, lastReviewedAt: variant.lastReviewedAt });
  return item;
};

const toPublicPracticeVariant = (variant) => variant ? ({
  questionType: variant.questionType,
  prompt: variant.prompt,
  hint: variant.hint,
  options: (variant.options || []).map(option => ({ id: option.id, text: option.text })),
  turns: variant.turns || [],
  incorrectAttempts: variant.incorrectAttempts || 0,
  canShowSolution: canShowPracticeSolution(variant),
  status: variant.status || 'new',
  reviewCount: variant.reviewCount || 0,
  nextReviewAt: variant.nextReviewAt,
  lastReviewedAt: variant.lastReviewedAt,
}) : null;

const toPublicPracticeItem = (item, conversationTitle = item.conversationTitle) => ({
  id: item._id,
  sessionId: item.sessionId,
  conversationTitle,
  title: conversationTitle || item.sourceQuestion || 'Luyện lại một bước',
  educationLevel: item.educationLevel,
  subjectArea: item.subjectArea,
  sourceQuestion: item.sourceQuestion,
  blocker: item.blocker,
  sourceFeedback: item.sourceFeedback,
  variants: (item.practice?.variants || []).map(toPublicPracticeVariant),
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
  evaluatePracticeAttempt,
  explainMassConservation,
  guidanceNumberIssue,
  generatePracticeVariant,
  getPracticeSourceQuestion,
  getConversationTitle,
  isMassConservationSource,
  isOffSubjectPractice,
  massConservationIssue,
  parseJson,
  requestPracticeGuidance,
  resolvePracticeSubject,
  sameSubstanceIssue,
  toPublicPracticeVariant,
  validateGeneratedPractice,
  toPublicPracticeItem,
  QUESTION_TYPES,
  ensurePracticeVariant,
};
