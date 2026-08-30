const crypto = require('node:crypto');
const { startChat, makeRequestWithRetry, extractResponseText } = require('./gemini.service');

const parseJson = text => {
  const value = String(text || '').replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  const first = value.indexOf('{');
  const last = value.lastIndexOf('}');
  if (first < 0 || last < first) throw new Error('AI tutor returned invalid JSON');
  return JSON.parse(value.slice(first, last + 1));
};

const text = (value, fallback, max = 500) => String(value || fallback).replace(/<[^>]*>/g, '').trim().slice(0, max) || fallback;
const id = value => String(value || '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 32);
const isMathCourse = ({ subjectArea = '', course = '' } = {}) => subjectArea === 'mathematics' || ['mathematics', 'physics', 'chemistry'].includes(course);
const extractBinomialSquare = value => {
  const match = String(value || '').match(/\(\s*([a-z])\s*([+-])\s*(\d+)\s*\)\s*(?:\^\s*2|²)/i);
  if (!match) return null;
  const variable = match[1].toLowerCase();
  const constant = Number(match[3]);
  const sign = match[2];
  const middle = `${sign === '-' ? '−' : ''}${2 * constant}${variable}`;
  return {
    variable,
    constant,
    sign,
    expression: `(${variable} ${sign} ${constant})²`,
    result: `${variable}² ${sign === '-' ? '−' : '+'} ${2 * constant}${variable} + ${constant ** 2}`,
    middle,
  };
};
const algebraData = sourceText => extractBinomialSquare(sourceText);
const topicAlgebraData = sourceText => /hằng\s*đẳng\s*thức|hang\s*dang\s*thuc/i.test(String(sourceText || ''))
  ? extractBinomialSquare('(a + 2)^2')
  : null;
const mathTokenStep = (id, title, explanation, blankLabel, expectedTokenId, tokens) => ({
  id,
  title,
  explanation,
  analysis: explanation,
  easierExample: { prompt: 'Hãy áp dụng đúng ý vừa phân tích vào một ví dụ đơn giản hơn.', answer: tokens.find(([tokenId]) => tokenId === expectedTokenId)?.[1] || '' },
  blanks: [{ id: `${id}-blank`, label: blankLabel, expectedTokenId }],
  tokens: tokens.map(([tokenId, label, type = 'text']) => ({ id: tokenId, label, type })),
});
const algebraTutorSteps = data => [
  mathTokenStep(
    's1',
    'Xác định công thức',
    `Đề bài yêu cầu khai triển ${data.expression}. Hãy chọn đúng công thức bình phương một tổng/hiệu.`,
    'Công thức',
    'square-formula',
    [['square-formula', '(a ± b)² = a² ± 2ab + b²'], ['wrong-formula', 'a² ± b²'], ['linear-formula', 'a ± b']],
  ),
  mathTokenStep(
    's2',
    'Tính số hạng giữa',
    `Trong ${data.expression}, số hạng giữa là 2 × ${data.constant} × ${data.variable}.`,
    'Số hạng giữa',
    'middle-term',
    [['middle-term', data.middle, 'variable'], ['wrong-middle', `${data.constant}${data.variable}`, 'variable'], ['constant-term', String(data.constant ** 2), 'number']],
  ),
  mathTokenStep(
    's3',
    'Kết luận',
    `Ghép ba phần của hằng đẳng thức để thu được kết quả khai triển của ${data.expression}.`,
    'Kết quả',
    'expanded-result',
    [['expanded-result', data.result, 'variable'], ['wrong-result', `${data.variable}² + ${data.constant}${data.variable} + ${data.constant}`, 'variable'], ['constant-only', String(data.constant ** 2), 'number']],
  ),
].map((step, index) => ({
  ...step,
  analysis: index === 0
    ? `Phân tích ${data.expression}: nhận diện dạng bình phương một tổng/hiệu trước khi thay số.`
    : index === 1
      ? `Phân tích ${data.expression}: số hạng giữa được tính bằng 2 × ${data.constant} × ${data.variable}.`
      : `Phân tích ${data.expression}: ghép bình phương thứ nhất, số hạng giữa và bình phương thứ hai để kiểm tra kết quả.`,
  easierExample: index === 0
    ? { prompt: 'Ví dụ dễ hơn: với (a + 1)², công thức vẫn là (a + b)² = a² + 2ab + b².', answer: '(a + b)² = a² + 2ab + b²', hint: 'Chỉ cần nhận diện số hạng a và 1.' }
    : index === 1
      ? { prompt: 'Ví dụ dễ hơn: số hạng giữa của (a + 1)² là 2 × 1 × a = 2a.', answer: '2a', hint: 'Lấy 2 nhân phần biến nhân phần số.' }
      : { prompt: 'Ví dụ dễ hơn: (a + 1)² = a² + 2a + 1.', answer: 'a² + 2a + 1', hint: 'Ghép đủ ba phần theo đúng thứ tự.' },
}));
const algebraQuestion = (data, index, language = 'vi') => {
  const tasks = language === 'vi'
    ? [
      [`Khai triển ${data.expression} bằng hằng đẳng thức nào?`, ['(a ± b)² = a² ± 2ab + b²', 'a² ± b²', 'a ± b', '2a + 2b']],
      [`Số hạng giữa khi khai triển ${data.expression} là bao nhiêu?`, [data.middle, String(data.constant), `${data.constant}${data.variable}`, String(data.constant ** 2)]],
      [`Kết quả khai triển ${data.expression} là gì?`, [data.result, `${data.variable}² + ${data.constant}${data.variable} + ${data.constant}`, `${data.variable}² ${data.sign === '-' ? '+' : '−'} ${2 * data.constant}${data.variable} + ${data.constant ** 2}`, `${data.variable}² + ${data.constant ** 2}`]],
      [`Biểu thức nào có đúng dạng hằng đẳng thức liên quan đến ${data.expression}?`, [data.expression, `${data.variable}² + ${data.constant ** 2}`, `${data.variable} + ${data.constant}`, `${data.constant}${data.variable}`]],
      [`Nếu ${data.variable} = 1, giá trị của ${data.expression} là bao nhiêu?`, [String((1 + (data.sign === '-' ? -data.constant : data.constant)) ** 2), String(data.constant ** 2), String(1 + data.constant), String(2 * data.constant)]],
    ]
    : [
      [`Which identity expands ${data.expression}?`, ['(a ± b)² = a² ± 2ab + b²', 'a² ± b²', 'a ± b', '2a + 2b']],
      [`What is the middle term when expanding ${data.expression}?`, [data.middle, String(data.constant), `${data.constant}${data.variable}`, String(data.constant ** 2)]],
      [`What is the result of expanding ${data.expression}?`, [data.result, `${data.variable}² + ${data.constant}${data.variable} + ${data.constant}`, `${data.variable}² ${data.sign === '-' ? '+' : '−'} ${2 * data.constant}${data.variable} + ${data.constant ** 2}`, `${data.variable}² + ${data.constant ** 2}`]],
      [`Which expression uses the identity related to ${data.expression}?`, [data.expression, `${data.variable}² + ${data.constant ** 2}`, `${data.variable} + ${data.constant}`, `${data.constant}${data.variable}`]],
      [`If ${data.variable} = 1, what is the value of ${data.expression}?`, [String((1 + (data.sign === '-' ? -data.constant : data.constant)) ** 2), String(data.constant ** 2), String(1 + data.constant), String(2 * data.constant)]],
    ];
  const [prompt, optionTexts] = tasks[index] || tasks[0];
  return {
    title: language === 'vi' ? `Khai triển ${data.expression} · Câu ${index + 1}` : `Expand ${data.expression} · Question ${index + 1}`,
    prompt,
    visual: { kind: 'none' },
    interactionType: 'math_tokens',
    options: optionTexts.map((optionText, optionIndex) => ({ id: String.fromCharCode(65 + optionIndex), text: optionText })),
    correctOptionId: 'A',
    tutorSteps: algebraTutorSteps(data),
  };
};
const sanitizeSvg = value => String(value || '')
  .replace(/<script[\s\S]*?<\/script>/gi, '')
  .replace(/<(?:foreignObject|iframe|object|embed)[\s\S]*?<\/\s*(?:foreignObject|iframe|object|embed)>/gi, '')
  .replace(/\son\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
  .replace(/\s(?:href|xlink:href)\s*=\s*["'](?:https?:|data:text\/html|javascript:)[^"']*["']/gi, '')
  .slice(0, 12000);
const interactionFor = ({ subjectArea = '', course = '' } = {}) => {
  if (isMathCourse({ subjectArea, course })) return 'math_tokens';
  if (course === 'english_language' || course === 'foreign_language') return 'cloze';
  if (subjectArea === 'social_sciences' || ['literature', 'history', 'geography', 'civics'].includes(course)) return 'evidence_choice';
  if (subjectArea === 'natural_sciences') return 'label_diagram';
  return 'generic_tokens';
};

const sourceAnchor = (sourceText, language = 'vi') => {
  const source = String(sourceText || '').trim();
  if (!source) return '';
  return language === 'vi' ? `Dựa vào đề bài: ${source}` : `Based on the original problem: ${source}`;
};

const normalizeForMatch = value => String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
const includesSourceAnchor = (value, sourceText) => {
  const source = normalizeForMatch(sourceText);
  const content = normalizeForMatch(value);
  return !source || content.includes(source) || content.includes(source.slice(0, 48));
};

const isRelatedToSource = (value, sourceText) => {
  if (!sourceText) return true;
  if (includesSourceAnchor(value, sourceText)) return true;
  const source = normalizeForMatch(sourceText);
  const content = normalizeForMatch(value);
  const sourceNumbers = source.match(/\d+(?:[.,/]\d+)?/g) || [];
  const matchingNumbers = sourceNumbers.filter(number => content.includes(number)).length;
  if (matchingNumbers >= Math.min(2, sourceNumbers.length) && matchingNumbers > 0) return true;
  const ignored = new Set(['bài', 'toán', 'hãy', 'câu', 'hỏi', 'tính', 'tìm', 'cho', 'biết', 'nào', 'đây', 'what', 'which', 'find', 'calculate']);
  const terms = [...new Set(source.match(/[a-zà-ỹ]{5,}/gi) || [])]
    .map(normalizeForMatch)
    .filter(term => !ignored.has(term));
  return terms.length > 0 && terms.filter(term => content.includes(term)).length >= Math.min(2, terms.length);
};

const genericTutorSteps = ({ sourceText, sourceOption, language }) => {
  const source = sourceText || (language === 'vi' ? 'bài toán này' : 'this problem');
  const labels = language === 'vi'
    ? ['Dữ kiện đề bài', 'Yêu cầu của đề', 'Kiểm tra kết quả']
    : ['Problem data', 'Task requirement', 'Check the result'];
  const explanations = language === 'vi'
    ? [`Ghi lại dữ kiện đúng từ đề bài: ${source}.`, `Dựa trên ${source}, xác định đúng điều đề bài yêu cầu.`, `Đối chiếu câu trả lời với đề bài: ${source}.`]
    : [`Record the data from the original problem: ${source}.`, `Based on ${source}, identify exactly what the problem asks.`, `Check the answer against the original problem: ${source}.`];
  return explanations.map((explanation, index) => ({
    id: `s${index + 1}`,
    title: language === 'vi' ? `Bước ${index + 1}` : `Step ${index + 1}`,
    explanation,
    analysis: language === 'vi' ? `Phân tích nhanh: ${explanation}` : `Quick analysis: ${explanation}`,
    easierExample: { prompt: language === 'vi' ? `Ví dụ dễ hơn: hãy nhận diện phần liên quan trong “${source}”.` : `Easier example: identify the relevant part in “${source}”.`, answer: sourceOption },
    blanks: [{ id: `s${index + 1}-blank`, label: labels[index], expectedTokenId: `s${index + 1}-token` }],
    tokens: [{ id: `s${index + 1}-token`, label: sourceOption, type: 'text' }, { id: `s${index + 1}-other`, label: '?', type: 'text' }],
  }));
};

const fallbackLesson = ({ sourceText = '', sourceExpression = '', questionId = 'main', language = 'vi', subjectArea = '', course = '' } = {}) => {
  const interactionType = interactionFor({ subjectArea, course });
  const anchor = sourceAnchor(sourceText, language) || (language === 'vi' ? 'Đề bài này' : 'This problem');
  const prompts = language === 'vi'
    ? [`${anchor} cho biết dữ kiện nào cần dùng?`, `${anchor} yêu cầu tìm đại lượng hoặc ý chính nào?`, `${anchor} cần áp dụng công thức/khái niệm nào?`, `${anchor} cần thực hiện phép tính hoặc lập luận nào tiếp theo?`, `${anchor} cần kiểm tra kết quả cuối cùng như thế nào?`]
    : [`What data must be used from this problem? ${anchor}`, `What quantity or main idea must be found in this problem? ${anchor}`, `Which formula or concept applies to this problem? ${anchor}`, `What calculation or reasoning comes next for this problem? ${anchor}`, `How should the result of this problem be checked? ${anchor}`];
  const sourceOption = sourceText ? text(sourceText, language === 'vi' ? 'Dữ kiện trong đề bài' : 'Data from the problem', 180) : language === 'vi' ? 'Dữ kiện trong đề bài' : 'Data from the problem';
  const algebra = algebraData(sourceExpression || sourceText) || topicAlgebraData(sourceText);
  const questions = Array.from({ length: 5 }, (_, index) => {
    const generated = algebra ? algebraQuestion(algebra, index, language) : null;
    return {
      ...(generated || {
        id: `q${index + 1}`,
        title: language === 'vi' ? `Làm rõ yêu cầu · Câu ${index + 1}` : `Clarify the task · Question ${index + 1}`,
        prompt: prompts[index],
      }),
      id: `q${index + 1}`,
      // Keep offline fallback text-only; visuals are accepted only from Gemini.
      visual: { kind: 'none' },
      interactionType,
      options: generated?.options || [
        { id: 'A', text: sourceOption },
        { id: 'B', text: language === 'vi' ? 'Một thông tin không xuất hiện trong đề' : 'Information not present in the problem' },
        { id: 'C', text: language === 'vi' ? 'Một dữ kiện trái với đề bài' : 'Data that contradicts the problem' },
        { id: 'D', text: language === 'vi' ? 'Một nội dung không liên quan đến đề' : 'Content unrelated to the problem' },
      ],
      correctOptionId: 'A',
      tutorSteps: algebra ? algebraTutorSteps(algebra) : genericTutorSteps({ sourceText, sourceOption, language }),
    };
  });
  return { sourceQuestionId: questionId, sourceText, questions };
};

const normalizeStep = (raw, index, fallback, sourceText, language) => {
  const tokens = Array.isArray(raw?.tokens) ? raw.tokens.slice(0, 12).map((token, tokenIndex) => ({ id: id(token?.id) || `t${index + 1}_${tokenIndex + 1}`, label: text(token?.label, '?', 30), type: ['number', 'operator', 'variable', 'text'].includes(token?.type) ? token.type : 'text' })) : fallback.tokens;
  const tokenIds = new Set(tokens.map(token => token.id));
  const blanks = Array.isArray(raw?.blanks) ? raw.blanks.slice(0, 6).map((blank, blankIndex) => ({ id: id(blank?.id) || `b${index + 1}_${blankIndex + 1}`, label: text(blank?.label, 'Ô trống', 50), expectedTokenId: tokenIds.has(id(blank?.expectedTokenId)) ? id(blank.expectedTokenId) : tokens[0]?.id })).filter(blank => blank.expectedTokenId) : fallback.blanks;
  const interaction = raw?.interaction?.type === 'sort_sequence' && Array.isArray(raw.interaction.items)
    ? { type: 'sort_sequence', items: raw.interaction.items.slice(0, 6).map((item, itemIndex) => ({ id: id(item?.id) || `i${itemIndex + 1}`, text: text(item?.text, 'Bước', 120), order: Number(item?.order) || itemIndex + 1 })) }
    : ['match_pairs', 'label_diagram', 'cause_effect'].includes(raw?.interaction?.type) && Array.isArray(raw.interaction.pairs)
      ? { type: raw.interaction.type, pairs: raw.interaction.pairs.slice(0, 6).map((pair, pairIndex) => ({ id: id(pair?.id) || `p${pairIndex + 1}`, left: text(pair?.left, 'Khái niệm', 80), right: text(pair?.right, 'Nghĩa', 80) })) }
      : raw?.interaction?.type === 'evidence_choice' && Array.isArray(raw.interaction.choices)
        ? { type: 'evidence_choice', prompt: text(raw.interaction.prompt, 'Chọn bằng chứng phù hợp.', 200), choices: raw.interaction.choices.slice(0, 4).map((choice, choiceIndex) => ({ id: id(choice?.id) || `c${choiceIndex + 1}`, text: text(choice?.text, 'Lựa chọn', 180), correct: Boolean(choice?.correct) })) }
        : raw?.interaction?.type === 'cloze'
          ? { type: 'cloze', prompt: text(raw.interaction.prompt, 'Điền từ còn thiếu.', 300), answer: text(raw.interaction.answer, '', 80).toLowerCase() }
        : null;
  const needsFallbackExercise = !interaction && (!blanks.length || !tokens.length);
  const rawExplanation = text(raw?.explanation, fallback.explanation, 500);
  if (!isRelatedToSource(rawExplanation, sourceText)) return fallback;
  const easierExample = raw?.easierExample && typeof raw.easierExample === 'object'
    ? {
      prompt: text(raw.easierExample.prompt, fallback.easierExample?.prompt || 'Ví dụ dễ hơn.', 500),
      answer: text(raw.easierExample.answer, fallback.easierExample?.answer || '', 120),
      hint: text(raw.easierExample.hint, '', 300),
    }
    : fallback.easierExample;
  return { id: id(raw?.id) || `s${index + 1}`, title: text(raw?.title, fallback.title, 90), explanation: rawExplanation, analysis: text(raw?.analysis, fallback.analysis || rawExplanation, 500), easierExample, blanks: needsFallbackExercise ? fallback.blanks : blanks, tokens: needsFallbackExercise ? fallback.tokens : tokens, interaction };
};

const normalizeQuestion = (raw, index, sourceText, language, context = {}) => {
  const fallback = fallbackLesson({ sourceText, sourceExpression: context.sourceExpression, language, subjectArea: context.subjectArea, course: context.course }).questions[index];
  const options = Array.isArray(raw?.options) ? raw.options.slice(0, 4).map((option, optionIndex) => ({ id: String(option?.id || String.fromCharCode(65 + optionIndex)).slice(0, 2), text: text(option?.text, fallback.options[optionIndex]?.text || 'Lựa chọn', 180) })) : fallback.options;
  const validIds = new Set(options.map(option => option.id));
  const rawPrompt = text(raw?.prompt, sourceText || fallback.prompt, 900);
  if (!isRelatedToSource(rawPrompt, sourceText)) {
    return { id: id(raw?.id) || `q${index + 1}`, ...fallback };
  }
  const prompt = rawPrompt;
  // Never infer the source problem from Gemini's prompt; that would let an
  // unrelated expression in the generated text replace the student's problem.
  const algebra = algebraData(context.sourceExpression || sourceText) || topicAlgebraData(sourceText);
  if (algebra) return { id: id(raw?.id) || `q${index + 1}`, ...algebraQuestion(algebra, index, language) };
  const steps = Array.isArray(raw?.tutorSteps) ? raw.tutorSteps.slice(0, 4).map((step, stepIndex) => normalizeStep(step, stepIndex, fallback.tutorSteps[stepIndex] || fallback.tutorSteps[0], sourceText, language)).filter(Boolean) : fallback.tutorSteps;
  while (steps.length < 3) steps.push(fallback.tutorSteps[steps.length]);
  const mathSubject = isMathCourse(context);
  steps.forEach(step => {
    if (mathSubject) {
      step.interaction = null;
      if (!step.blanks.length || !step.tokens.length) {
        step.blanks = fallback.tutorSteps[0].blanks;
        step.tokens = fallback.tutorSteps[0].tokens;
      }
    }
    if (!mathSubject && !step.interaction && raw?.interactionType === 'cloze') step.interaction = { type: 'cloze', prompt: step.explanation || 'Điền từ còn thiếu.', answer: '' };
    if (!mathSubject && !step.interaction && raw?.interactionType === 'sort_sequence') step.interaction = { type: 'sort_sequence', items: [{ id: 'i1', text: 'Bước đầu', order: 1 }, { id: 'i2', text: 'Bước tiếp theo', order: 2 }, { id: 'i3', text: 'Kết luận', order: 3 }] };
    if (!mathSubject && !step.interaction && ['match_pairs', 'label_diagram', 'cause_effect'].includes(raw?.interactionType)) step.interaction = { type: raw.interactionType, pairs: [{ id: 'p1', left: 'Nội dung chính', right: 'Ghép đúng' }] };
    if (!mathSubject && !step.interaction && raw?.interactionType === 'evidence_choice') step.interaction = { type: 'evidence_choice', prompt: step.explanation || 'Chọn bằng chứng phù hợp.', choices: [{ id: 'c1', text: 'Bằng chứng trực tiếp từ đề bài.', correct: true }, { id: 'c2', text: 'Thông tin không xuất hiện trong đề.', correct: false }] };
    if (step.interaction?.type === 'cloze' && !step.interaction.answer) {
      step.interaction.answer = String(options.find(option => option.id === (validIds.has(String(raw?.correctOptionId)) ? String(raw.correctOptionId) : 'A'))?.text || '').trim().toLowerCase();
    }
  });
  const interactionTypes = ['math_tokens', 'label_diagram', 'sort_sequence', 'match_pairs', 'cloze', 'evidence_choice', 'cause_effect', 'generic_tokens'];
  const resolvedInteractionType = mathSubject ? 'math_tokens' : interactionTypes.includes(raw?.interactionType) && raw.interactionType !== 'generic_tokens' ? raw.interactionType : interactionFor(context);
  const visualSpec = raw?.visual?.kind === 'svg' && raw.visual.spec && typeof raw.visual.spec === 'object'
    ? { ...raw.visual.spec, svg: sanitizeSvg(raw.visual.spec.svg) }
    : null;
  const interactionType = resolvedInteractionType;
  const visual = mathSubject || interactionType === 'math_tokens' ? { kind: 'none' } : visualSpec?.svg ? { kind: 'svg', spec: visualSpec } : { kind: 'none' };
  return { id: id(raw?.id) || `q${index + 1}`, title: text(raw?.title, fallback.title, 120), prompt, visual, interactionType, options: options.length === 4 ? options : fallback.options, correctOptionId: validIds.has(String(raw?.correctOptionId)) ? String(raw.correctOptionId) : 'A', tutorSteps: steps.length ? steps : fallback.tutorSteps };
};

const sanitizeLesson = (raw, context = {}) => {
  const fallback = fallbackLesson(context);
  const questions = Array.isArray(raw?.questions) ? raw.questions.slice(0, 5).map((question, index) => normalizeQuestion(question, index, context.sourceText, context.language, context)).filter(question => question.options.length === 4) : [];
  // Gemini occasionally returns fewer items; pad so every lesson always has five steps/questions.
  while (questions.length < 5) questions.push(fallback.questions[questions.length]);
  return { sourceQuestionId: context.questionId || fallback.sourceQuestionId, sourceText: context.sourceText || '', sourceImage: context.sourceImage || null, questions };
};

const generateLesson = async (context = {}) => {
  const fallback = fallbackLesson(context);
  try {
    const prompt = `Tạo mini-lesson LIÊN TỤC ĐÚNG 5 CÂU dựa CHỈ trên bài học sau. Không đổi dữ kiện. Ngôn ngữ: ${context.language || 'vi'}. Cấp học: ${context.educationLevel || 'middle'}. Nhóm môn: ${context.subjectArea || 'natural_sciences'}. Môn: ${context.course || ''}. Bài học gốc: ${context.sourceText || '(xem ảnh đính kèm)'}. Biểu thức gốc nếu có: ${context.sourceExpression || '(không có)'}. Mỗi câu phải là một ví dụ/bài tập mới cùng dạng với câu hỏi chính, có thể giải bằng đúng công thức hoặc phương pháp của đề gốc; không đổi chủ đề, biến, số liệu hoặc yêu cầu đã có. Nếu nguồn chỉ nêu chủ đề mà chưa có số liệu cụ thể, hãy tạo một ví dụ minh họa cùng chủ đề với số nhỏ, nói rõ đó là ví dụ áp dụng. Mỗi tutorStep phải có explanation, analysis (phân tích ngắn câu hiện tại), và easierExample gồm prompt, answer, hint; easierExample phải là một ví dụ cùng dạng nhưng đơn giản hơn nhiều để học sinh bắt chước trước. Mỗi tutorStep cũng phải nhắc chi tiết cụ thể của câu đang hỏi; tuyệt đối không dùng bước chung chung như "xác định dữ kiện quan trọng", "đọc đề" nếu không kèm dữ kiện cụ thể. Nếu là Toán/Lý/Hóa (math_tokens), KHÔNG tạo hình ảnh/SVG; tập trung vào biểu thức, phép tính và suy luận. Chỉ tạo SVG đơn giản cho môn cần sơ đồ, không script/HTML/external URL. Trả JSON duy nhất theo schema questions gồm id,title,prompt,visual,interactionType,options,correctOptionId,tutorSteps. Không trả câu hỏi chung chung, không thương hiệu.`;
    const chat = startChat([], 'Bạn là AI Tutor. Chỉ trả JSON hợp lệ, trung thành với đề bài.');
    const parts = [{ text: prompt }];
    if (context.sourceImage?.url) {
      const imageResponse = await fetch(context.sourceImage.url);
      if (imageResponse.ok) parts.push({ inlineData: { mimeType: imageResponse.headers.get('content-type') || 'image/jpeg', data: Buffer.from(await imageResponse.arrayBuffer()).toString('base64') } });
    }
    const raw = parseJson(extractResponseText(await makeRequestWithRetry(() => chat.sendMessage(parts))));
    if (!Array.isArray(raw?.questions) || raw.questions.length !== 5 || raw.questions.some(question => !Array.isArray(question?.options) || question.options.length !== 4)) {
      throw new Error('Gemini returned an incomplete five-question lesson');
    }
    return sanitizeLesson(raw, context);
  } catch (error) {
    console.error('AI tutor lesson generation failed:', error.message);
    return fallback;
  }
};

const makeLessonId = () => crypto.randomUUID();

// Keep the original topic endpoint compatible while the Chat flow migrates.
const fallbackQuestion = ({ topic = 'hằng đẳng thức', level = 'middle' } = {}) => ({
  title: `Khám phá ${topic}`,
  prompt: 'Một mảnh vườn hình vuông có cạnh (a + 2). Diện tích của mảnh vườn được viết gọn như thế nào?',
  diagram: { type: 'geometry', outer: 'a + 2', inner: 'a', accent: '2' },
  options: [{ id: 'A', text: 'a² + 4a + 4' }, { id: 'B', text: 'a² + 2a + 4' }, { id: 'C', text: 'a² + 4' }, { id: 'D', text: '2a² + 4' }],
  correctId: 'A',
  steps: [1, 2, 3, 4].map((number) => ({ title: `Bước ${number}`, content: number === 1 ? `Nhận diện cạnh hình vuông là (a + 2), nên diện tích bằng bình phương cạnh.` : 'Dùng hằng đẳng thức và đối chiếu kết quả với lựa chọn.' })),
  hint: 'Hãy xác định cạnh của hình vuông trước, rồi chọn công thức diện tích phù hợp.',
});

const sanitizeQuestion = (raw, context = {}) => {
  const fallback = fallbackQuestion(context);
  const options = Array.isArray(raw?.options) ? raw.options.slice(0, 4).map((option, index) => ({ id: String(option?.id || String.fromCharCode(65 + index)).slice(0, 2), text: text(option?.text, fallback.options[index].text, 160) })) : fallback.options;
  const validIds = new Set(options.map(option => option.id));
  return { title: text(raw?.title, fallback.title, 120), prompt: text(raw?.prompt, fallback.prompt, 900), diagram: raw?.diagram?.type === 'route' ? raw.diagram : fallback.diagram, options: options.length === 4 ? options : fallback.options, correctId: validIds.has(String(raw?.correctId)) ? String(raw.correctId) : fallback.correctId, steps: Array.isArray(raw?.steps) && raw.steps.length === 4 ? raw.steps.slice(0, 4).map((step, index) => ({ title: text(step?.title, fallback.steps[index].title, 80), content: text(step?.content, fallback.steps[index].content, 500) })) : fallback.steps, hint: text(raw?.hint, fallback.hint, 300) };
};

const generateQuestion = async ({ subject = 'Toán', topic = 'hằng đẳng thức', level = 'middle', language = 'vi' } = {}) => {
  const lesson = await generateLesson({ sourceText: `${subject}: ${topic}`, language });
  const question = lesson.questions[0];
  return { title: question.title, prompt: question.prompt, diagram: { type: 'none' }, options: question.options, correctId: question.correctOptionId, steps: question.tutorSteps.map(step => ({ title: step.title, content: step.explanation })), hint: 'Hãy đọc dữ kiện và thử từng bước.' };
};

module.exports = { fallbackLesson, sanitizeLesson, generateLesson, makeLessonId, fallbackQuestion, sanitizeQuestion, generateQuestion, makeQuestionId: makeLessonId };
