const { startChat, makeRequestWithRetry, extractResponseText } = require('./gemini.service');
const { parseModelJson } = require('./model-json');
const {
  ensureProblemContext,
  getActiveQuestion,
  toPublicProblemContext,
} = require('./problem-context.service');

const parseJson = (text) => parseModelJson(text, 'Evaluator did not return JSON');

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
  feedback: message || (language === 'vi'
    ? 'Mình cần làm rõ thêm để chấm chính xác. Hãy chọn đúng câu đang làm hoặc viết rõ một bước tính.'
    : 'I need one more detail to grade this reliably. Choose the question or write one clear working step.'),
  evidence: '',
  source: 'uncertain',
  isMeaningfulAttempt: false,
  questionId: questionId || null,
});

const evaluateAnswer = async ({ conversation, answer = '', answerImageUrl = null, language = 'en', course = null, followUpQuestion = null, questionId = null }) => {
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
  const targetQuestion = followUpQuestion || question.prompt || question.sourceExpression;
  const targetQuestionId = questionId || question.id;
  const prompt = `${language === 'vi' ? 'Bạn là evaluator chấm bài, không phải gia sư.' : 'You are a grading evaluator, not a tutor.'}
${language === 'vi' ? 'Chỉ trả JSON hợp lệ, không markdown.' : 'Return valid JSON only, no markdown.'}
${language === 'vi' ? 'Phản hồi ngắn tối đa 3 câu, bám đúng câu học sinh đang làm, không lạc sang môn khác.' : 'Keep feedback to at most 3 short sentences, stay with the selected question, and do not drift into other subjects.'}
${language === 'vi' ? 'Chỉ kết luận correct/incorrect khi đủ chắc chắn; thiếu dữ kiện hoặc ký hiệu mơ hồ là uncertain.' : 'Use correct/incorrect only when certain; missing context or ambiguous notation is uncertain.'}
${language === 'vi' ? 'status phải khớp với feedback: nếu feedback nói bài đúng thì status là correct; nếu chưa chắc thì status là uncertain.' : 'status must agree with feedback: if feedback says the work is correct, status must be correct; use uncertain when unsure.'}
${language === 'vi' ? 'Bài làm có ý nghĩa là có phép tính, công thức, lập luận hoặc kết luận gắn với câu đang chấm.' : 'A meaningful attempt contains a calculation, formula, reasoning, or conclusion tied to the selected question.'}
${language === 'vi' ? 'Schema:' : 'Schema:'} {"status":"correct|incorrect|uncertain","feedback":"","evidence":"","isMeaningfulAttempt":true}
${language === 'vi' ? 'Môn học:' : 'Subject:'} ${course || conversation.course || conversation.subjectArea || ''}
${language === 'vi' ? 'Ngữ cảnh đề:' : 'Problem context:'} ${JSON.stringify({ sourceText: context.sourceText, question })}
${language === 'vi' ? 'Câu hỏi cần chấm:' : 'Question to grade:'} ${targetQuestion}
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
    feedback: String(parsed.feedback || '').trim(),
    evidence: String(parsed.evidence || '').trim(),
    source: status === 'uncertain' ? 'uncertain' : 'gemini',
    isMeaningfulAttempt: parsed.isMeaningfulAttempt === true,
    questionId: targetQuestionId,
  };
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
  evaluateAnswer,
  toPublicProblemContext,
};
