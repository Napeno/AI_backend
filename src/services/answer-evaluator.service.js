const { parse } = require('mathjs');
const { startChat, makeRequestWithRetry, extractResponseText } = require('./gemini.service');
const {
  ensureProblemContext,
  getActiveQuestion,
  toPublicProblemContext,
} = require('./problem-context.service');

const normalizeExpression = (value = '') => String(value)
  .replace(/[−–—]/g, '-')
  .replace(/\*\*/g, '^')
  .replace(/[×·]/g, '*')
  .replace(/÷/g, '/')
  .replace(/²/g, '^2')
  .replace(/³/g, '^3')
  .replace(/[⁴]/g, '^4')
  .replace(/[⁵]/g, '^5')
  .replace(/[⁶]/g, '^6')
  .replace(/[⁷]/g, '^7')
  .replace(/[⁸]/g, '^8')
  .replace(/[⁹]/g, '^9')
  .trim();

const parseJson = (text) => {
  const value = String(text || '').replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  const first = value.indexOf('{');
  const last = value.lastIndexOf('}');
  if (first === -1 || last < first) throw new Error('Evaluator did not return JSON');
  return JSON.parse(value.slice(first, last + 1));
};

const isSafeNode = (node) => {
  if (node.type === 'ConstantNode') return Number.isFinite(Number(node.value));
  if (node.type === 'SymbolNode') return /^[a-zA-Z][a-zA-Z0-9_]*$/.test(node.name);
  if (node.type === 'ParenthesisNode') return isSafeNode(node.content);
  if (node.type !== 'OperatorNode' || !['+', '-', '*', '/', '^'].includes(node.op)) return false;
  return node.args.every(isSafeNode);
};

const parseSafeExpression = (value) => {
  const normalized = normalizeExpression(value);
  if (!normalized || normalized.includes('=')) return null;
  try {
    const node = parse(normalized);
    if (!isSafeNode(node)) return null;
    return node;
  } catch (_) {
    return null;
  }
};

const symbolsIn = (node) => {
  const names = new Set();
  node.traverse((child) => {
    if (child.type === 'SymbolNode') names.add(child.name);
  });
  return [...names];
};

const areEquivalent = (sourceExpression, candidateExpression) => {
  const source = parseSafeExpression(sourceExpression);
  const candidate = parseSafeExpression(candidateExpression);
  if (!source || !candidate) return null;

  const variables = [...new Set([...symbolsIn(source), ...symbolsIn(candidate)])];
  const assignments = [
    [2, 3, 5, 7, 11],
    [-2, 4, -3, 5, 7],
    [0.5, -1.5, 2.5, -4, 3],
    [3, -2, 1.25, 6, -0.5],
    [-3, 0.75, 4, -2.5, 5],
  ];
  let validChecks = 0;

  for (const values of assignments) {
    const scope = Object.fromEntries(variables.map((name, index) => [name, values[index % values.length]]));
    try {
      const expected = source.compile().evaluate(scope);
      const actual = candidate.compile().evaluate(scope);
      if (!Number.isFinite(expected) || !Number.isFinite(actual)) continue;
      validChecks += 1;
      if (Math.abs(expected - actual) > 1e-9 * Math.max(1, Math.abs(expected), Math.abs(actual))) return false;
    } catch (_) {
      continue;
    }
  }
  return validChecks >= 3 ? true : null;
};

const appendImagePart = async (parts, url, label) => {
  if (!url) return;
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`image ${response.status}`);
    parts.push({ text: label });
    parts.push({
      inlineData: {
        mimeType: response.headers.get('content-type') || 'image/jpeg',
        data: Buffer.from(await response.arrayBuffer()).toString('base64'),
      },
    });
  } catch (error) {
    console.warn('Evaluator could not load image:', error.message);
  }
};

const fallback = (language, questionId, message) => ({
  status: 'uncertain',
  candidateExpression: '',
  feedback: message || (language === 'vi'
    ? 'Mình cần làm rõ thêm để chấm chính xác. Hãy chọn đúng câu đang làm hoặc viết rõ một bước tính.'
    : 'I need one more detail to grade this reliably. Choose the question or write one clear working step.'),
  evidence: '',
  source: 'uncertain',
  isMeaningfulAttempt: false,
  questionId: questionId || null,
});

const evaluateAnswer = async ({ conversation, answer = '', answerImageUrl = null, language = 'en' }) => {
  await ensureProblemContext(conversation, language);
  const context = conversation.problemContext || {};
  const question = getActiveQuestion(context);
  if (!question) return fallback(language, null, language === 'vi'
    ? 'Hãy chọn câu đang làm trước khi kiểm tra đáp án.'
    : 'Choose the question you are working on before checking your answer.');

  const relevantHints = (conversation.history || [])
    .filter(message => message.role === 'model' || message.role === 'continue')
    .slice(-3)
    .map(message => message.parts?.map(part => part.text || '').join('\n').slice(0, 500))
    .filter(Boolean);
  const prompt = `${language === 'vi' ? 'Bạn là evaluator chấm bài, không phải gia sư.' : 'You are a grading evaluator, not a tutor.'}
${language === 'vi' ? 'Chỉ trả JSON hợp lệ, không markdown.' : 'Return valid JSON only, no markdown.'}
${language === 'vi' ? 'Chỉ kết luận correct/incorrect khi đủ chắc chắn; thiếu dữ kiện hoặc ký hiệu mơ hồ là uncertain.' : 'Use correct/incorrect only when certain; missing context or ambiguous notation is uncertain.'}
${language === 'vi' ? 'Bài làm có ý nghĩa là có phép tính, công thức, lập luận hoặc kết luận gắn với câu đang chấm.' : 'A meaningful attempt contains a calculation, formula, reasoning, or conclusion tied to the selected question.'}
${language === 'vi' ? 'Schema:' : 'Schema:'} {"status":"correct|incorrect|uncertain","candidateExpression":"","feedback":"","evidence":"","isMeaningfulAttempt":true}
${language === 'vi' ? 'Ngữ cảnh đề:' : 'Problem context:'} ${JSON.stringify({ sourceText: context.sourceText, question })}
${language === 'vi' ? 'Các gợi ý liên quan:' : 'Relevant hints:'} ${relevantHints.join('\n') || '(none)'}
${language === 'vi' ? 'Câu trả lời/bài làm của học sinh:' : 'Student answer/work:'} ${answer || '(image only)'}`;

  let parsed;
  try {
    const parts = [{ text: prompt }];
    await appendImagePart(parts, context.sourceImage?.url, language === 'vi' ? 'Ảnh đề gốc:' : 'Original problem image:');
    await appendImagePart(parts, answerImageUrl, language === 'vi' ? 'Ảnh bài làm:' : 'Student work image:');
    const chat = startChat([], language === 'vi'
      ? 'Bạn chỉ chấm bài theo dữ kiện nhận được và trả JSON hợp lệ.'
      : 'Grade only from supplied evidence and return valid JSON.');
    parsed = parseJson(extractResponseText(await makeRequestWithRetry(() => chat.sendMessage(parts))));
  } catch (error) {
    console.error('Answer evaluator failed:', error.message);
    return fallback(language, question.id);
  }

  const status = ['correct', 'incorrect', 'uncertain'].includes(parsed.status) ? parsed.status : 'uncertain';
  const result = {
    status,
    candidateExpression: String(parsed.candidateExpression || '').trim(),
    feedback: String(parsed.feedback || '').trim(),
    evidence: String(parsed.evidence || '').trim(),
    source: status === 'uncertain' ? 'uncertain' : 'gemini',
    isMeaningfulAttempt: parsed.isMeaningfulAttempt === true,
    questionId: question.id,
  };
  if (conversation.subjectArea === 'mathematics' && question.sourceExpression && result.candidateExpression) {
    const mathVerdict = areEquivalent(question.sourceExpression, result.candidateExpression);
    if (mathVerdict !== null) {
      result.status = mathVerdict ? 'correct' : 'incorrect';
      result.source = 'mathjs';
    }
  }
  if (!result.feedback) {
    result.feedback = result.status === 'correct'
      ? (language === 'vi' ? 'Bước làm này đúng.' : 'This working step is correct.')
      : result.status === 'incorrect'
        ? (language === 'vi' ? 'Bước này chưa khớp với đề. Hãy kiểm tra lại một phép tính.' : 'This step does not match the problem. Check one calculation.')
        : fallback(language).feedback;
  }
  console.log(JSON.stringify({ event: 'answer_evaluation', status: result.status, source: result.source, questionId: result.questionId }));
  return result;
};

module.exports = {
  areEquivalent,
  evaluateAnswer,
  normalizeExpression,
  parseSafeExpression,
  toPublicProblemContext,
};
