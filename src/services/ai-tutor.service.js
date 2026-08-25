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
const interactionFor = ({ subjectArea = '', course = '' } = {}) => {
  if (course === 'english_language' || course === 'foreign_language') return 'cloze';
  if (subjectArea === 'social_sciences' || ['literature', 'history', 'geography', 'civics'].includes(course)) return 'evidence_choice';
  if (subjectArea === 'natural_sciences' && course !== 'mathematics') return 'label_diagram';
  if (['mathematics', 'physics', 'chemistry'].includes(course) || subjectArea === 'mathematics') return 'math_tokens';
  return 'generic_tokens';
};

const fallbackLesson = ({ sourceText = '', questionId = 'main', language = 'vi', subjectArea = '', course = '' } = {}) => ({
  sourceQuestionId: questionId,
  sourceText,
  questions: [{
    id: 'q1', title: language === 'vi' ? 'Tách dữ kiện từ đề bài' : 'Identify the given data',
    prompt: sourceText || (language === 'vi' ? 'Đâu là cách bắt đầu phù hợp nhất với đề bài?' : 'What is the best first step?'),
    visual: { kind: 'fallback', spec: { label: language === 'vi' ? 'Bài học từ Chat' : 'Lesson from Chat' } },
    interactionType: interactionFor({ subjectArea, course }),
    options: [
      { id: 'A', text: language === 'vi' ? 'Đọc và gạch chân dữ kiện' : 'Read and underline the data' },
      { id: 'B', text: language === 'vi' ? 'Chọn ngẫu nhiên một đáp án' : 'Pick an answer randomly' },
      { id: 'C', text: language === 'vi' ? 'Bỏ qua câu hỏi' : 'Skip the question' },
      { id: 'D', text: language === 'vi' ? 'Xin đáp án ngay' : 'Ask for the answer immediately' },
    ],
    correctOptionId: 'A',
    tutorSteps: [{ id: 's1', title: language === 'vi' ? 'Bước 1 · Xác định dữ kiện' : 'Step 1 · Find the data', explanation: language === 'vi' ? 'Hãy chọn dữ kiện quan trọng nhất trong đề.' : 'Choose the most important data in the problem.', blanks: [{ id: 'b1', label: 'Dữ kiện', expectedTokenId: 't1' }], tokens: [{ id: 't1', label: language === 'vi' ? 'Dữ kiện đề bài' : 'Given data', type: 'text' }, { id: 't2', label: '+', type: 'operator' }, { id: 't3', label: '?', type: 'text' }] }],
  }],
});

const normalizeStep = (raw, index, fallback) => {
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
  return { id: id(raw?.id) || `s${index + 1}`, title: text(raw?.title, fallback.title, 90), explanation: text(raw?.explanation, fallback.explanation, 500), blanks: needsFallbackExercise ? fallback.blanks : blanks, tokens: needsFallbackExercise ? fallback.tokens : tokens, interaction };
};

const normalizeQuestion = (raw, index, sourceText, language, context = {}) => {
  const fallback = fallbackLesson({ sourceText, language, subjectArea: context.subjectArea, course: context.course }).questions[0];
  const options = Array.isArray(raw?.options) ? raw.options.slice(0, 4).map((option, optionIndex) => ({ id: String(option?.id || String.fromCharCode(65 + optionIndex)).slice(0, 2), text: text(option?.text, fallback.options[optionIndex]?.text || 'Lựa chọn', 180) })) : fallback.options;
  const validIds = new Set(options.map(option => option.id));
  const steps = Array.isArray(raw?.tutorSteps) ? raw.tutorSteps.slice(0, 4).map((step, stepIndex) => normalizeStep(step, stepIndex, fallback.tutorSteps[0])).filter(Boolean) : fallback.tutorSteps;
  steps.forEach(step => {
    if (!step.interaction && raw?.interactionType === 'cloze') step.interaction = { type: 'cloze', prompt: step.explanation || 'Điền từ còn thiếu.', answer: '' };
    if (!step.interaction && raw?.interactionType === 'sort_sequence') step.interaction = { type: 'sort_sequence', items: [{ id: 'i1', text: 'Bước đầu', order: 1 }, { id: 'i2', text: 'Bước tiếp theo', order: 2 }, { id: 'i3', text: 'Kết luận', order: 3 }] };
    if (!step.interaction && ['match_pairs', 'label_diagram', 'cause_effect'].includes(raw?.interactionType)) step.interaction = { type: raw.interactionType, pairs: [{ id: 'p1', left: 'Nội dung chính', right: 'Ghép đúng' }] };
    if (!step.interaction && raw?.interactionType === 'evidence_choice') step.interaction = { type: 'evidence_choice', prompt: step.explanation || 'Chọn bằng chứng phù hợp.', choices: [{ id: 'c1', text: 'Bằng chứng trực tiếp từ đề bài.', correct: true }, { id: 'c2', text: 'Thông tin không xuất hiện trong đề.', correct: false }] };
    if (step.interaction?.type === 'cloze' && !step.interaction.answer) {
      step.interaction.answer = String(options.find(option => option.id === (validIds.has(String(raw?.correctOptionId)) ? String(raw.correctOptionId) : 'A'))?.text || '').trim().toLowerCase();
    }
  });
  const interactionTypes = ['math_tokens', 'label_diagram', 'sort_sequence', 'match_pairs', 'cloze', 'evidence_choice', 'cause_effect', 'generic_tokens'];
  return { id: id(raw?.id) || `q${index + 1}`, title: text(raw?.title, fallback.title, 120), prompt: text(raw?.prompt, sourceText || fallback.prompt, 900), visual: raw?.visual?.kind === 'svg' ? { kind: 'svg', spec: raw.visual.spec || {} } : { kind: 'fallback', spec: { label: text(raw?.visual?.spec?.label, 'Minh họa bài toán', 80) } }, interactionType: interactionTypes.includes(raw?.interactionType) ? raw.interactionType : 'generic_tokens', options: options.length === 4 ? options : fallback.options, correctOptionId: validIds.has(String(raw?.correctOptionId)) ? String(raw.correctOptionId) : 'A', tutorSteps: steps.length ? steps : fallback.tutorSteps };
};

const sanitizeLesson = (raw, context = {}) => {
  const fallback = fallbackLesson(context);
  const questions = Array.isArray(raw?.questions) ? raw.questions.slice(0, 3).map((question, index) => normalizeQuestion(question, index, context.sourceText, context.language, context)).filter(question => question.options.length === 4) : fallback.questions;
  return { sourceQuestionId: context.questionId || fallback.sourceQuestionId, sourceText: context.sourceText || '', sourceImage: context.sourceImage || null, questions: questions.length ? questions : fallback.questions };
};

const generateLesson = async (context = {}) => {
  const fallback = fallbackLesson(context);
  try {
    const prompt = `Tạo mini-lesson tối đa 3 câu dựa CHỈ trên bài học sau. Không đổi dữ kiện. Ngôn ngữ: ${context.language || 'vi'}. Cấp học: ${context.educationLevel || 'middle'}. Nhóm môn: ${context.subjectArea || 'natural_sciences'}. Môn: ${context.course || ''}. Bài học: ${context.sourceText || '(xem ảnh đính kèm)'}. Chọn interactionType phù hợp: math_tokens (Toán/Lý/Hóa tính toán), label_diagram (KHTN), sort_sequence (quy trình/timeline), match_pairs (Anh/khái niệm), cloze (điền từ), evidence_choice (Văn/KHXH), cause_effect (nguyên nhân-kết quả). Trả JSON duy nhất: {"questions":[{"id":"q1","title":"","prompt":"","visual":{"kind":"svg|fallback","spec":{}},"interactionType":"math_tokens|label_diagram|sort_sequence|match_pairs|cloze|evidence_choice|cause_effect","options":[{"id":"A","text":""},{"id":"B","text":""},{"id":"C","text":""},{"id":"D","text":""}],"correctOptionId":"A","tutorSteps":[{"id":"s1","title":"","explanation":"","blanks":[{"id":"b1","label":"","expectedTokenId":"t1"}],"tokens":[{"id":"t1","label":"","type":"number|operator|variable|text"}],"interaction":{"type":"sort_sequence|match_pairs|label_diagram|cause_effect|evidence_choice|cloze","items":[{"id":"i1","text":"","order":1}],"pairs":[{"id":"p1","left":"","right":""}],"choices":[{"id":"c1","text":"","correct":true}],"prompt":"","answer":""}}]}]}. Với sort_sequence/match_pairs/label_diagram/cause_effect/evidence_choice/cloze, điền interaction và bỏ blanks/tokens nếu không phù hợp. Không HTML, không thương hiệu.`;
    const chat = startChat([], 'Bạn là AI Tutor. Chỉ trả JSON hợp lệ, trung thành với đề bài.');
    const parts = [{ text: prompt }];
    if (context.sourceImage?.url) {
      const imageResponse = await fetch(context.sourceImage.url);
      if (imageResponse.ok) parts.push({ inlineData: { mimeType: imageResponse.headers.get('content-type') || 'image/jpeg', data: Buffer.from(await imageResponse.arrayBuffer()).toString('base64') } });
    }
    const raw = parseJson(extractResponseText(await makeRequestWithRetry(() => chat.sendMessage(parts))));
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
