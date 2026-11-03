const crypto = require('node:crypto');
const { startChat, makeRequestWithRetry, extractResponseText } = require('./gemini.service');
const { formulaRule, parseModelJson } = require('./model-json');

const parseJson = text => parseModelJson(text, 'AI tutor returned invalid JSON');

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
const linearEquationData = sourceText => {
  const match = String(sourceText || '').match(/([+-]?\s*\d+(?:[.,]\d+)?)\s*x\s*([+-]\s*\d+(?:[.,]\d+)?)\s*(x)?\s*=\s*([+-]?\s*\d+(?:[.,]\d+)?)/i);
  if (!match) {
    const simpleMatch = String(sourceText || '').match(/([+-]?\s*\d+(?:[.,]\d+)?)\s*x\s*=\s*([+-]?\s*\d+(?:[.,]\d+)?)/i);
    if (!simpleMatch) return null;
    const coefficient = Number(simpleMatch[1].replace(',', '.').replace(/\s+/g, ''));
    const right = Number(simpleMatch[2].replace(',', '.').replace(/\s+/g, ''));
    const solution = right / coefficient;
    return { kind: 'linear', coefficient, constant: 0, right, reducedRight: right, solution, solutionText: Number.isInteger(solution) ? String(solution) : `${right}/${coefficient}`, expression: `${coefficient}x = ${right}` };
  }
  const coefficient = value => Number(String(value).replace(',', '.').replace(/\s+/g, ''));
  const first = coefficient(match[1]);
  const second = coefficient(match[2]);
  const right = coefficient(match[4]);
  if (!match[3]) {
    const solution = (right - second) / first;
    return {
      kind: 'linear', coefficient: first, constant: second, right,
      reducedRight: right - second, solution,
      solutionText: Number.isInteger(solution) ? String(solution) : `${right - second}/${first}`,
      expression: `${first}x ${second < 0 ? '−' : '+'} ${Math.abs(second)} = ${right}`,
    };
  }
  const total = first + second;
  const solution = right / total;
  return { kind: 'like_terms', first, second, right, total, solution, solutionText: Number.isInteger(solution) ? String(solution) : `${right}/${total}`, expression: `${first}x + ${second}x = ${right}` };
};
const similarLinearEquation = (data, index) => {
  const coefficient = data.coefficient + index + 1;
  const constant = data.constant + index + 1;
  const solution = data.solution + index + 1;
  const right = coefficient * solution + constant;
  return { ...data, coefficient, constant, right, reducedRight: right - constant, solution, solutionText: Number.isInteger(solution) ? String(solution) : `${right - constant}/${coefficient}`, expression: `${coefficient}x ${constant < 0 ? '−' : '+'} ${Math.abs(constant)} = ${right}` };
};
const answerNumber = value => {
  const normalized = String(value || '').replace(',', '.').replace(/\s/g, '');
  if (/^-?\d+(?:\.\d+)?\/-?\d+(?:\.\d+)?$/.test(normalized)) {
    const [numerator, denominator] = normalized.split('/').map(Number);
    return denominator ? numerator / denominator : null;
  }
  const number = normalized.match(/(?:^|=)-?\d+(?:\.\d+)?$/)?.[0];
  return number ? Number(number.replace(/^=/, '')) : null;
};
const arithmeticBlankAnswer = value => {
  const expression = String(value || '')
    .split('=')[0]
    .replace(/[_?]+/g, '')
    .replace(/−/g, '-')
    .replace(/(?:bằng bao nhiêu|là bao nhiêu)/gi, '')
    .replace(/(?:cộng|plus)/gi, '+')
    .replace(/(?:trừ|minus)/gi, '-')
    .replace(/(?:nhân|times)/gi, '*')
    .replace(/(?:chia|divided by)/gi, '/')
    .replace(/^\s*(?:hãy\s+)?(?:tính|calculate)\s+/i, '')
    .trim();
  const match = expression.match(/^(-?\d+(?:[.,]\d+)?)\s*([+\-×*÷/])\s*(-?\d+(?:[.,]\d+)?)$/);
  if (!match) return null;
  const left = Number(match[1].replace(',', '.'));
  const right = Number(match[3].replace(',', '.'));
  const result = { '+': left + right, '-': left - right, '×': left * right, '*': left * right, '÷': left / right, '/': left / right }[match[2]];
  return Number.isFinite(result) ? result : null;
};
const answerMentionedForBlank = (label, raw, tokens) => {
  const leftSide = String(label || '').split('=')[0].replace(/\s+/g, '').trim();
  const context = [raw?.explanation, raw?.analysis, raw?.easierExample?.prompt, raw?.easierExample?.answer]
    .filter(Boolean).join(' ').replace(/\s+/g, '');
  const easierAnswer = normalizeForMatch(raw?.easierExample?.answer);
  const exactAnswer = tokens.find(token => normalizeForMatch(token.label) === easierAnswer);
  if (exactAnswer) return exactAnswer;
  const answerNumbers = String(raw?.easierExample?.answer || '').match(/-?\d+(?:[.,]\d+)?/g) || [];
  const numericAnswer = tokens.find(token => answerNumbers.some(answer => answerNumber(token.label) === answerNumber(answer)));
  if (numericAnswer) return numericAnswer;
  if (!leftSide) return null;
  return tokens.find(token => {
    const answer = String(token.label || '').replace(/\s+/g, '').trim();
    return answer && context.includes(`${leftSide}=${answer}`);
  }) || null;
};
const chemistryEquation = sourceText => {
  const source = String(sourceText || '').replace(/\s+/g, '');
  if (/H2\+O2[-=]>H2O/i.test(source)) return { equation: 'H₂ + O₂ → H₂O', balanced: '2H₂ + O₂ → 2H₂O', ratio: '2 : 1 : 2', reactants: ['H₂', 'O₂'], product: 'H₂O' };
  if (/Al\+O2[-=]>Al2O3/i.test(source)) return { equation: 'Al + O₂ → Al₂O₃', balanced: '4Al + 3O₂ → 2Al₂O₃', ratio: '4 : 3 : 2', reactants: ['Al', 'O₂'], product: 'Al₂O₃' };
  return null;
};
const isCircuitSource = sourceText => /(?:mạch điện|điện trở|cường độ dòng điện|hiệu điện thế|\b[UIR]\d+\b|nhánh song song|nối tiếp)/i.test(String(sourceText || ''));
const sourceQuestion = (sourceText, index, language = 'vi') => {
  const linear = linearEquationData(sourceText);
  if (linear) return linearQuestion(linear, index, language);
  const algebra = algebraData(sourceText) || topicAlgebraData(sourceText);
  if (algebra) return algebraQuestion(algebra, index, language);
  const chemistry = chemistryEquation(sourceText);
  if (chemistry) return chemistryQuestion(chemistry, index, language);
  if (isCircuitSource(sourceText)) return circuitQuestion(sourceText, index, language);
  return null;
};

const linearTutorSteps = (data, index, language = 'vi') => {
  if (data.kind === 'linear') {
    const vi = language === 'vi';
    const move = data.constant < 0 ? `cộng ${Math.abs(data.constant)}` : `trừ ${data.constant}`;
    const steps = [
      [vi ? `Với ${data.expression}, chuyển số hạng tự do ${data.constant} sang vế phải bằng cách ${move} ở cả hai vế.` : `In ${data.expression}, move the constant ${data.constant} to the right by ${move} on both sides.`, 'Phương trình sau khi chuyển', `${data.coefficient}x = ${data.reducedRight}`],
      [vi ? `Tính vế phải: ${data.right} ${data.constant < 0 ? '+' : '−'} ${Math.abs(data.constant)} = ${data.reducedRight}, nên ${data.coefficient}x = ${data.reducedRight}.` : `Calculate the right side: ${data.right} ${data.constant < 0 ? '+' : '−'} ${Math.abs(data.constant)} = ${data.reducedRight}, so ${data.coefficient}x = ${data.reducedRight}.`, 'Vế phải sau khi tính', String(data.reducedRight)],
      [vi ? `Chia hai vế cho ${data.coefficient}: x = ${data.solutionText}.` : `Divide both sides by ${data.coefficient}: x = ${data.solutionText}.`, 'Nghiệm của phương trình', data.solutionText],
    ];
    return steps.map(([explanation, label, answer], stepIndex) => mathTokenStep(
      `s${stepIndex + 1}`,
      vi ? ['Chuyển số hạng tự do', 'Tính vế phải', 'Tìm x'][stepIndex] : ['Move the constant', 'Calculate the right side', 'Find x'][stepIndex],
      explanation,
      label,
      `answer-${stepIndex + 1}`,
      [[`answer-${stepIndex + 1}`, answer, stepIndex === 2 ? 'number' : 'variable'], [`wrong-${stepIndex + 1}`, stepIndex === 0 ? `${data.coefficient}x = ${data.right + data.constant}` : stepIndex === 1 ? String(data.right + data.constant) : String(data.solution + 1), 'variable']],
    ));
  }
  const vi = language === 'vi';
  const steps = [
    [`Từ phương trình ${data.expression}, gom các hạng tử đồng dạng: ${data.first}x + ${data.second}x = ${data.total}x.`, 'Vế trái sau khi rút gọn', `${data.total}x`],
    [`Phương trình sau khi rút gọn là ${data.total}x = ${data.right}.`, 'Phương trình mới', `${data.total}x = ${data.right}`],
    [`Chia hai vế cho ${data.total}: x = ${data.solutionText}.`, 'Giá trị của x', data.solutionText],
  ];
  return steps.map(([explanation, label, answer], stepIndex) => mathTokenStep(
    `s${stepIndex + 1}`,
    vi ? ['Gom hạng tử đồng dạng', 'Rút gọn phương trình', 'Tìm giá trị x'][stepIndex] : ['Combine like terms', 'Simplify the equation', 'Find x'][stepIndex],
    explanation,
    label,
    `answer-${stepIndex + 1}`,
    [[`answer-${stepIndex + 1}`, answer, stepIndex === 2 ? 'number' : 'variable'], [`wrong-${stepIndex + 1}`, stepIndex === 0 ? `${data.first * data.second}x` : stepIndex === 1 ? `${data.total}x = ${data.right + 1}` : String(data.total / data.right), 'variable'], [`source-${stepIndex + 1}`, data.expression, 'text']],
  ));
};
const linearQuestion = (data, index, language = 'vi') => {
  if (data.kind === 'linear') {
    const question = similarLinearEquation(data, index);
    const vi = language === 'vi';
    const options = [question.solutionText, String(question.solution + 1), String(question.solution - 1), String(question.right)];
    return {
      id: `q${index + 1}`,
      title: vi ? `Giải phương trình tương tự · Câu ${index + 1}` : `Solve a similar equation · Question ${index + 1}`,
      prompt: vi ? `Giải phương trình tương tự: ${question.expression}.` : `Solve this similar equation: ${question.expression}.`,
      visual: { kind: 'none' },
      interactionType: 'math_tokens',
      options: options.map((optionText, optionIndex) => ({ id: String.fromCharCode(65 + optionIndex), text: optionText })),
      correctOptionId: 'A',
      tutorSteps: linearTutorSteps(question, index, language),
    };
  }
  const tasks = language === 'vi'
    ? [
      [`Trong ${data.expression}, tổng các hệ số của x là bao nhiêu?`, [String(data.total), String(data.first * data.second), String(data.right), '1']],
      [`Sau khi thu gọn ${data.expression}, phương trình trở thành gì?`, [`${data.total}x = ${data.right}`, `${data.first}x = ${data.right}`, `x = ${data.right}`, `${data.total}x = ${data.right + 1}`]],
      [`Từ ${data.total}x = ${data.right}, cần chia hai vế cho số nào?`, [String(data.total), String(data.right), String(data.first), '2']],
      [`Nghiệm của ${data.expression} là bao nhiêu?`, [data.solutionText, String(data.total / data.right), String(data.right), String(data.total)]],
      [`Phép kiểm tra nào xác nhận x = ${data.solutionText}?`, [`${data.first}(${data.solutionText}) + ${data.second}(${data.solutionText}) = ${data.right}`, `${data.first} + ${data.second} = ${data.right}`, `${data.total} + ${data.solutionText} = ${data.right}`, `${data.first}(${data.right}) = ${data.solutionText}`]],
    ]
    : [
      [`What is the sum of the coefficients of x in ${data.expression}?`, [String(data.total), String(data.first * data.second), String(data.right), '1']],
      [`What does ${data.expression} become after simplifying?`, [`${data.total}x = ${data.right}`, `${data.first}x = ${data.right}`, `x = ${data.right}`, `${data.total}x = ${data.right + 1}`]],
      [`From ${data.total}x = ${data.right}, which number divides both sides?`, [String(data.total), String(data.right), String(data.first), '2']],
      [`What is the solution of ${data.expression}?`, [data.solutionText, String(data.total / data.right), String(data.right), String(data.total)]],
      [`Which check confirms x = ${data.solutionText}?`, [`${data.first}(${data.solutionText}) + ${data.second}(${data.solutionText}) = ${data.right}`, `${data.first} + ${data.second} = ${data.right}`, `${data.total} + ${data.solutionText} = ${data.right}`, `${data.first}(${data.right}) = ${data.solutionText}`]],
    ];
  const [prompt, optionTexts] = tasks[index] || tasks[0];
  return {
    id: `q${index + 1}`,
    title: language === 'vi' ? `Giải ${data.expression} · Câu ${index + 1}` : `Solve ${data.expression} · Question ${index + 1}`,
    prompt,
    visual: { kind: 'none' },
    interactionType: 'math_tokens',
    options: optionTexts.map((optionText, optionIndex) => ({ id: String.fromCharCode(65 + optionIndex), text: optionText })),
    correctOptionId: 'A',
    tutorSteps: linearTutorSteps(data, index, language),
  };
};
const chemistryTutorSteps = (data, index, language = 'vi') => {
  const steps = language === 'vi'
    ? [`Đề bài có ${data.reactants.join(' và ')} tạo thành ${data.product}.`, 'Đặt hệ số trước chất để số nguyên tử mỗi nguyên tố ở hai vế bằng nhau.', `Kiểm tra lại: ${data.balanced}.`]
    : [`The problem has ${data.reactants.join(' and ')} forming ${data.product}.`, 'Place coefficients so each element has the same atom count on both sides.', `Check again: ${data.balanced}.`];
  return steps.map((explanation, stepIndex) => mathTokenStep(
    `s${stepIndex + 1}`,
    language === 'vi' ? ['Xác định chất', 'Cân bằng nguyên tử', 'Kiểm tra phương trình'][stepIndex] : ['Identify substances', 'Balance atoms', 'Check the equation'][stepIndex],
    explanation,
    language === 'vi' ? ['Chất tham gia', 'Hệ số', 'Phương trình cân bằng'][stepIndex] : ['Reactants', 'Coefficients', 'Balanced equation'][stepIndex],
    `answer-${stepIndex + 1}`,
    [[`answer-${stepIndex + 1}`, [data.reactants.join(' + '), data.ratio, data.balanced][stepIndex], 'text'], [`wrong-${stepIndex + 1}`, data.equation, 'text']],
  ));
};
const chemistryQuestion = (data, index, language = 'vi') => {
  const tasks = language === 'vi'
    ? [
      [`Trong ${data.equation}, các chất tham gia là gì?`, [data.reactants.join(' và '), data.product, 'H₂O và O₂', 'Al và H₂O']],
      [`Khi cân bằng ${data.equation}, cần thay đổi điều gì?`, ['Hệ số trước chất', 'Chỉ số nhỏ trong công thức', 'Ký hiệu nguyên tố', 'Tên chất']],
      [`Tỉ lệ hệ số của phương trình ${data.balanced} là gì?`, [data.ratio, '1 : 1 : 1', '1 : 2 : 1', '2 : 2 : 1']],
      [`Phương trình cân bằng đúng là gì?`, [data.balanced, data.equation, data.balanced.replace(/2/g, '1'), `${data.reactants[0]} + 2${data.reactants[1]} → ${data.product}`]],
      [`Sau khi cân bằng, cần kiểm tra điều gì?`, ['Số nguyên tử mỗi nguyên tố ở hai vế bằng nhau', 'Đổi chỉ số trong công thức', 'Bỏ một chất tham gia', 'Đổi mũi tên phản ứng']],
    ]
    : [
      [`Which are the reactants in ${data.equation}?`, [data.reactants.join(' and '), data.product, 'H₂O and O₂', 'Al and H₂O']],
      [`When balancing ${data.equation}, what should change?`, ['Coefficients before substances', 'Subscripts in formulas', 'Element symbols', 'Substance names']],
      [`What is the coefficient ratio in ${data.balanced}?`, [data.ratio, '1 : 1 : 1', '1 : 2 : 1', '2 : 2 : 1']],
      ['Which is the balanced equation?', [data.balanced, data.equation, data.balanced.replace(/2/g, '1'), `${data.reactants[0]} + 2${data.reactants[1]} → ${data.product}`]],
      ['What should be checked after balancing?', ['Each element has the same atom count on both sides', 'Change formula subscripts', 'Remove a reactant', 'Change the reaction arrow']],
    ];
  const [prompt, optionTexts] = tasks[index] || tasks[0];
  return { id: `q${index + 1}`, title: language === 'vi' ? `Cân bằng ${data.equation} · Câu ${index + 1}` : `Balance ${data.equation} · Question ${index + 1}`, prompt, visual: { kind: 'none' }, interactionType: 'math_tokens', options: optionTexts.map((text, optionIndex) => ({ id: String.fromCharCode(65 + optionIndex), text })), correctOptionId: 'A', tutorSteps: chemistryTutorSteps(data, index, language) };
};
const circuitQuestion = (sourceText, index, language = 'vi') => {
  const vi = language === 'vi';
  const tasks = vi
    ? [
      [`Trong câu hỏi “${sourceText}”, công thức tính dòng qua R4 là gì?`, ['I₄ = U₄/R₄', 'I₄ = U₄ × R₄', 'I₄ = R₄/U₄', 'I₄ = U₄ + R₄']],
      ['Nếu R4 song song với nhánh R234, đại lượng nào bằng nhau?', ['U₄ = U₂₃₄', 'I₄ = I₂₃₄ luôn luôn', 'R₄ = R₂₃₄', 'U₄ = 0']],
      ['Muốn tính I4 theo định luật Ôm, cần biết những đại lượng nào?', ['U₄ và R₄', 'I4 và U4', 'R4 và I4', 'Chỉ cần U4']],
      ['Sau khi tìm U₄ = U₂₃₄, bước tiếp theo là gì?', ['Thay U₄ và R₄ vào I₄ = U₄/R₄', 'Cộng U₄ với R₄', 'Chia R₄ cho I₄', 'Bỏ qua R₄']],
      ['Cách kiểm tra kết quả I4 hợp lý là gì?', ['Thay ngược I₄ vào U₄ = I₄R₄', 'Đổi R4 thành U4', 'Cộng các điện trở song song', 'So sánh với số 0']],
    ]
    : [
      [`For “${sourceText}”, what formula gives the current through R4?`, ['I₄ = U₄/R₄', 'I₄ = U₄ × R₄', 'I₄ = R₄/U₄', 'I₄ = U₄ + R₄']],
      ['If R4 is parallel to branch R234, which quantity is equal?', ['U₄ = U₂₃₄', 'I₄ = I₂₃₄ always', 'R₄ = R₂₃₄', 'U₄ = 0']],
      ['Which quantities are needed to calculate I4 using Ohm’s law?', ['U₄ and R₄', 'I4 and U4', 'R4 and I4', 'Only U4']],
      ['After finding U₄ = U₂₃₄, what comes next?', ['Substitute U₄ and R₄ into I₄ = U₄/R₄', 'Add U₄ and R₄', 'Divide R₄ by I₄', 'Ignore R₄']],
      ['How can the I4 result be checked?', ['Substitute I₄ into U₄ = I₄R₄', 'Swap R4 and U4', 'Add parallel resistances', 'Compare it with zero']],
    ];
  const [prompt, optionTexts] = tasks[index] || tasks[0];
  const explanations = vi
    ? [`Bám sát câu hỏi về R4: dòng điện được tính bằng hiệu điện thế chia cho điện trở.`, 'Trong mạch song song, hiệu điện thế hai nhánh bằng nhau nên U₄ = U₂₃₄.', 'Định luật Ôm cho nhánh R4 dùng đúng U₄ và R₄.', 'Thay các đại lượng đã biết vào công thức I₄ = U₄/R₄.', 'Kiểm tra bằng cách nhân I₄ với R₄ và so sánh với U₄.']
    : ['For R4, current equals voltage divided by resistance.', 'In a parallel circuit, branch voltages are equal, so U₄ = U₂₃₄.', 'Ohm’s law for branch R4 uses U₄ and R₄.', 'Substitute the known values into I₄ = U₄/R₄.', 'Check by multiplying I₄ by R₄ and comparing it with U₄.'];
  const explanation = explanations[index] || explanations[0];
  const stepExplanations = vi
    ? [
      `${explanation} Hãy xác định đúng đại lượng cần tìm trong câu này.`,
      `Áp dụng đúng mối liên hệ của mạch điện: ${index === 1 ? 'mạch song song có cùng hiệu điện thế.' : 'I₄ = U₄/R₄.'}`,
      `Đối chiếu kết quả với dữ kiện của R4 và nhánh R234 trong đề bài.`,
    ]
    : [
      `${explanation} Identify the quantity requested in this question.`,
      `Use the circuit relationship correctly: ${index === 1 ? 'parallel branches have the same voltage.' : 'I₄ = U₄/R₄.'}`,
      'Compare the result with the R4 and R234 data in the problem.',
    ];
  return { id: `q${index + 1}`, title: vi ? `Tính dòng qua R4 · Câu ${index + 1}` : `Current through R4 · Question ${index + 1}`, prompt, visual: { kind: 'none' }, interactionType: 'math_tokens', options: optionTexts.map((optionText, optionIndex) => ({ id: String.fromCharCode(65 + optionIndex), text: optionText })), correctOptionId: 'A', tutorSteps: stepExplanations.map((stepExplanation, stepIndex) => ({ id: `s${stepIndex + 1}`, title: vi ? `Bước ${stepIndex + 1}` : `Step ${stepIndex + 1}`, explanation: stepExplanation, analysis: stepExplanation, easierExample: { prompt: vi ? `Ví dụ dễ hơn: với U₄ = 12 V và R₄ = 6 Ω, tính I₄ theo I₄ = U₄/R₄.` : 'Easier example: with U₄ = 12 V and R₄ = 6 Ω, calculate I₄ using I₄ = U₄/R₄.', answer: '2 A', hint: vi ? 'Chia hiệu điện thế cho điện trở.' : 'Divide voltage by resistance.' }, blanks: [{ id: `s${stepIndex + 1}-blank`, label: vi ? 'Đáp án' : 'Answer', expectedTokenId: `answer-${stepIndex + 1}` }], tokens: [{ id: `answer-${stepIndex + 1}`, label: optionTexts[0], type: 'text' }, { id: `wrong-${stepIndex + 1}`, label: optionTexts[1], type: 'text' }] })) };
};
const mathTokenStep = (id, title, explanation, blankLabel, expectedTokenId, tokens) => ({
  id,
  title,
  explanation,
  analysis: explanation,
  easierExample: { prompt: 'Hãy áp dụng đúng ý vừa phân tích vào một ví dụ đơn giản hơn.', answer: tokens.find(([tokenId]) => tokenId === expectedTokenId)?.[1] || '' },
  blanks: [{ id: `${id}-blank`, label: blankLabel, expectedTokenId }],
  tokens: tokens.map(([tokenId, label, type = 'text']) => ({ id: tokenId, label, type })),
});
const decorateAlgebraSteps = (steps, focus) => steps.map((step, index) => ({
  ...step,
  analysis: focus[index]?.analysis || step.analysis,
  easierExample: focus[index]?.easierExample || step.easierExample,
}));
const algebraTutorSteps = (data, questionIndex = 0) => {
  const common = [
    mathTokenStep('s1', 'Xác định công thức', `Đề bài yêu cầu khai triển ${data.expression}. Hãy chọn đúng công thức bình phương một tổng/hiệu.`, 'Công thức', 'square-formula', [['square-formula', '(a ± b)² = a² ± 2ab + b²'], ['wrong-formula', 'a² ± b²'], ['linear-formula', 'a ± b']]),
    mathTokenStep('s2', 'Tính số hạng giữa', `Trong ${data.expression}, số hạng giữa là 2 × ${data.constant} × ${data.variable}.`, 'Số hạng giữa', 'middle-term', [['middle-term', data.middle, 'variable'], ['wrong-middle', `${data.constant}${data.variable}`, 'variable'], ['constant-term', String(data.constant ** 2), 'number']]),
    mathTokenStep('s3', 'Kết luận', `Ghép ba phần của hằng đẳng thức để thu được kết quả khai triển của ${data.expression}.`, 'Kết quả', 'expanded-result', [['expanded-result', data.result, 'variable'], ['wrong-result', `${data.variable}² + ${data.constant}${data.variable} + ${data.constant}`, 'variable'], ['constant-only', String(data.constant ** 2), 'number']]),
  ];
  const variants = [
    common,
    [
      mathTokenStep('s1', 'Nhận diện số hạng giữa', `Câu hỏi yêu cầu tìm số hạng giữa của ${data.expression}, tức phần 2ab trong công thức.`, 'Phần cần tìm', 'middle-term', [['middle-term', '2ab', 'variable'], ['square-formula', 'a² + b²', 'text'], ['constant-term', 'b²', 'variable']]),
      mathTokenStep('s2', 'Thay dữ kiện', `Thay a = ${data.variable} và b = ${data.constant} vào 2ab để được 2 × ${data.constant} × ${data.variable}.`, 'Biểu thức thay vào', 'middle-term', [['middle-term', data.middle, 'variable'], ['wrong-middle', `${data.constant}${data.variable}`, 'variable'], ['constant-term', String(data.constant ** 2), 'number']]),
      mathTokenStep('s3', 'Kiểm tra', `Đối chiếu ${data.middle} với số hạng giữa trong kết quả của ${data.expression}.`, 'Số hạng giữa', 'middle-term', [['middle-term', data.middle, 'variable'], ['expanded-result', data.result, 'variable'], ['constant-term', String(data.constant ** 2), 'number']]),
    ],
    [
      mathTokenStep('s1', 'Tách ba phần', `Kết quả của ${data.expression} gồm bình phương thứ nhất, số hạng giữa ${data.middle} và bình phương thứ hai ${data.constant ** 2}.`, 'Phần cần ghép', 'expanded-result', [['expanded-result', data.result, 'variable'], ['middle-term', data.middle, 'variable'], ['constant-term', String(data.constant ** 2), 'number']]),
      mathTokenStep('s2', 'Ghép số hạng giữa', `Đặt đúng số hạng giữa ${data.middle} vào giữa ${data.variable}² và ${data.constant ** 2}.`, 'Số hạng giữa', 'middle-term', [['middle-term', data.middle, 'variable'], ['expanded-result', data.result, 'variable'], ['constant-term', String(data.constant ** 2), 'number']]),
      mathTokenStep('s3', 'Ghép kết quả', `Ghép đủ ba phần để được ${data.result}.`, 'Kết quả khai triển', 'expanded-result', [['expanded-result', data.result, 'variable'], ['wrong-result', `${data.variable}² + ${data.constant}${data.variable} + ${data.constant}`, 'variable'], ['constant-only', String(data.constant ** 2), 'number']]),
    ],
    [
      mathTokenStep('s1', 'Nhận diện dạng', `${data.expression} có dạng bình phương một tổng/hiệu nên dùng công thức (a ± b)².`, 'Dạng biểu thức', 'square-formula', [['square-formula', '(a ± b)²'], ['wrong-formula', 'a² ± b²'], ['linear-formula', 'a ± b']]),
      mathTokenStep('s2', 'Ghép các phần', `Với ${data.expression}, ghép bình phương thứ nhất, ${data.middle} và ${data.constant ** 2}.`, 'Ba phần kết quả', 'expanded-result', [['expanded-result', data.result, 'variable'], ['middle-term', data.middle, 'variable'], ['constant-term', String(data.constant ** 2), 'number']]),
      mathTokenStep('s3', 'Chọn biểu thức tương đương', `Chọn biểu thức đúng và tương đương với kết quả khai triển của ${data.expression}.`, 'Biểu thức tương đương', 'expanded-result', [['expanded-result', data.result, 'variable'], ['wrong-result', `${data.variable}² + ${data.constant}${data.variable} + ${data.constant}`, 'variable'], ['constant-only', String(data.constant ** 2), 'number']]),
    ],
    [
      mathTokenStep('s1', 'Thay giá trị', `Câu hỏi cho ${data.variable} = 1 trong ${data.expression}. Hãy thay giá trị vào biểu thức.`, 'Giá trị thay vào', 'substitution', [['substitution', '1', 'number'], ['wrong-value', '0', 'number'], ['constant-term', String(data.constant), 'number']]),
      mathTokenStep('s2', 'Tính trong ngoặc', `Tính 1 ${data.sign} ${data.constant} trước khi bình phương.`, 'Kết quả trong ngoặc', 'inside-value', [['inside-value', String(1 + (data.sign === '-' ? -data.constant : data.constant)), 'number'], ['wrong-value', String(data.constant), 'number'], ['substitution', '1', 'number']]),
      mathTokenStep('s3', 'Kết luận', `Bình phương kết quả trong ngoặc để tìm giá trị của ${data.expression}.`, 'Giá trị cuối cùng', 'final-value', [['final-value', String((1 + (data.sign === '-' ? -data.constant : data.constant)) ** 2), 'number'], ['inside-value', String(1 + (data.sign === '-' ? -data.constant : data.constant)), 'number'], ['constant-term', String(data.constant ** 2), 'number']]),
    ],
  ];
  const selected = variants[questionIndex] || common;
  const focus = [
    [
      { analysis: `Phân tích ${data.expression}: nhận diện đây là bình phương một tổng/hiệu.`, easierExample: { prompt: 'Ví dụ dễ hơn: với (a + 1)², dùng (a + b)² = a² + 2ab + b².', answer: '(a + b)² = a² + 2ab + b²', hint: 'Nhận diện dạng trước khi thay số.' } },
      { analysis: `Từ công thức của ${data.expression}, số hạng giữa là 2 × ${data.constant} × ${data.variable}.`, easierExample: { prompt: 'Ví dụ dễ hơn: số hạng giữa của (a + 1)² là 2 × 1 × a = 2a.', answer: '2a', hint: 'Lấy 2 nhân biến nhân số.' } },
      { analysis: `Ghép đủ ba phần của ${data.expression} để có kết quả cuối cùng.`, easierExample: { prompt: 'Ví dụ dễ hơn: (a + 1)² = a² + 2a + 1.', answer: 'a² + 2a + 1', hint: 'Ghép theo thứ tự bình phương, số hạng giữa, hằng số.' } },
    ],
    [
      { analysis: `Tập trung vào phần 2ab trong ${data.expression}.`, easierExample: { prompt: 'Ví dụ dễ hơn: trong (a + 1)², phần giữa là 2ab.', answer: '2ab', hint: 'Tìm phần nằm giữa hai bình phương.' } },
      { analysis: `Thay đúng biến và số của ${data.expression} vào 2ab.`, easierExample: { prompt: 'Ví dụ dễ hơn: 2 × 1 × a = 2a.', answer: '2a', hint: 'Thay số 1 vào vị trí b.' } },
      { analysis: `Kiểm tra kết quả bằng cách tìm đúng ${data.middle} trong biểu thức đã khai triển.`, easierExample: { prompt: 'Ví dụ dễ hơn: trong a² + 2a + 1, số hạng giữa là 2a.', answer: '2a', hint: 'Đọc số hạng ở giữa.' } },
    ],
    [
      { analysis: `Xác định công thức phù hợp cho ${data.expression}.`, easierExample: { prompt: 'Ví dụ dễ hơn: (a + 1)² có dạng bình phương một tổng.', answer: '(a + b)²', hint: 'Nhìn số mũ 2 ngoài ngoặc.' } },
      { analysis: `Tính lần lượt hai bình phương và số hạng giữa của ${data.expression}.`, easierExample: { prompt: 'Ví dụ dễ hơn: a² + 2a + 1 gồm ba phần.', answer: 'a² + 2a + 1', hint: 'Không bỏ sót phần nào.' } },
      { analysis: `Chọn kết quả chứa đúng biến, số hạng ${data.middle} và hằng số ${data.constant ** 2}.`, easierExample: { prompt: 'Ví dụ dễ hơn: kết quả của (a + 1)² là a² + 2a + 1.', answer: 'a² + 2a + 1', hint: 'Đối chiếu đủ ba phần.' } },
    ],
    [
      { analysis: `Phân tích câu hỏi: biểu thức tương đương với ${data.expression} phải giữ đúng dạng bình phương một tổng/hiệu.`, easierExample: { prompt: 'Ví dụ dễ hơn: biểu thức tương đương với (a + 1)² phải có dạng (a + 1)².', answer: '(a + 1)²', hint: 'Giữ nguyên hai phần trong ngoặc và số mũ 2.' } },
      { analysis: `Đối chiếu ${data.expression} với ba phần của công thức: bình phương thứ nhất, số hạng giữa và bình phương thứ hai.`, easierExample: { prompt: 'Ví dụ dễ hơn: (a + 1)² có ba phần a², 2a và 1.', answer: 'a² + 2a + 1', hint: 'Không bỏ sót số hạng giữa.' } },
      { analysis: `Chọn biểu thức đúng và tương đương với ${data.expression}, không chọn từng phần riêng lẻ.`, easierExample: { prompt: 'Ví dụ dễ hơn: (a + 1)² tương đương với a² + 2a + 1.', answer: 'a² + 2a + 1', hint: 'So sánh toàn bộ biểu thức.' } },
    ],
    [
      { analysis: `Thay ${data.variable} = 1 vào ${data.expression} trước khi tính.`, easierExample: { prompt: 'Ví dụ dễ hơn: với a = 1, (a + 1)² trở thành (1 + 1)².', answer: '(1 + 1)²', hint: 'Thay giá trị vào biến.' } },
      { analysis: `Tính phần trong ngoặc trước: 1 ${data.sign} ${data.constant}.`, easierExample: { prompt: 'Ví dụ dễ hơn: (1 + 1) = 2.', answer: '2', hint: 'Tính trong ngoặc trước.' } },
      { analysis: `Bình phương kết quả trong ngoặc để ra đáp số của ${data.expression}.`, easierExample: { prompt: 'Ví dụ dễ hơn: 2² = 4.', answer: '4', hint: 'Nhân số đó với chính nó.' } },
    ],
  ][questionIndex] || [];
  return decorateAlgebraSteps(selected, focus);
};
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
    tutorSteps: algebraTutorSteps(data, index),
  };
};
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
const SUBSCRIPT_DIGITS = { '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4', '₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9', '⁰': '0', '¹': '1', '²': '2', '³': '3', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9' };
const normalizedTutorText = value => normalizeForMatch(String(value || '')
  .replace(/^\s*(?:câu|cau|bài|bai|question)\s*\d+\s*[:.)\-–—]*\s*/i, '')
  .replace(/\(\s*(?:câu|cau|bài|bai|question)\s*\d+\s*\)/gi, ' ')
  .replace(/[?!.:;,"“”'’()[\]{}]/g, ' '));
const reactionSkeleton = value => {
  const normalized = String(value || '')
    .replace(/\r(?=ightarrow)/gi, '')
    .replace(/\\(?:rightarrow|to)\b|ightarrow|->|=>/gi, '→')
    .replace(/[₀-₉⁰¹²³⁴⁵⁶⁷⁸⁹]/g, digit => SUBSCRIPT_DIGITS[digit] || digit)
    .replace(/[$_{}\\]/g, '');
  const term = '(?:\\d+\\s*)?[A-Za-z][A-Za-z0-9]*';
  const match = normalized.match(new RegExp(`${term}(?:\\s*\\+\\s*${term})*\\s*→\\s*${term}(?:\\s*\\+\\s*${term})*`));
  if (!match) return '';
  const stripCoefficient = termText => termText.replace(/^\d+/, '');
  return match[0]
    .split('→')
    .map(side => side.split('+').map(part => stripCoefficient(part.replace(/\s+/g, ''))).filter(Boolean).join('+'))
    .join('→')
    .toLowerCase();
};
const arithmeticSignature = value => {
  const match = String(value || '').match(/(-?\d+(?:[.,]\d+)?)\s*([+\-×*÷/])\s*(-?\d+(?:[.,]\d+)?)/);
  if (!match) return '';
  return `${match[1].replace(',', '.')}${match[2]}${match[3].replace(',', '.')}`;
};
const questionFingerprint = value => {
  const linear = linearEquationData(value);
  if (linear?.expression) return `linear:${linear.expression.replace(/\s+/g, '')}`;
  const reaction = reactionSkeleton(value);
  if (reaction) return `reaction:${reaction}`;
  const arithmetic = arithmeticSignature(value);
  if (arithmetic) return `arithmetic:${arithmetic}`;
  const textKey = normalizedTutorText(value);
  return textKey ? `text:${textKey}` : '';
};
const isDuplicateTutorQuestion = (prompt, previousValues = []) => {
  const fingerprint = questionFingerprint(prompt);
  if (!fingerprint) return false;
  return previousValues.some(previous => previous && questionFingerprint(previous) === fingerprint);
};
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
  const arithmetic = source.match(/-?\d+(?:[.,]\d+)?\s*([+\-×*÷/])\s*-?\d+(?:[.,]\d+)?\s*=/);
  if (arithmetic) {
    const operator = arithmetic[1] === '×' ? '[×*]' : arithmetic[1] === '÷' ? '[÷/]' : `\\${arithmetic[1]}`;
    if (/\bx\b/i.test(content) || !new RegExp(`-?\\d+(?:[.,]\\d+)?\\s*${operator}\\s*-?\\d+(?:[.,]\\d+)?\\s*=`).test(content)) return false;
    return true;
  }
  if (linearEquationData(source) && /\d+(?:[.,]\d+)?\s*x\s*[+-]\s*\d+(?:[.,]\d+)?\s*=\s*[+-]?\d+/i.test(content)) return true;
  if (linearEquationData(source) && /\bx\b|phương trình|hệ số|chuyển|chia|equation|coefficient|divide/i.test(content)) return true;
  if (algebraData(source) && /\([^)]*\)\s*(?:\^\s*2|²)/i.test(content)) return true;
  if (chemistryEquation(source) && /(?:→|->|=>)/.test(content)) return true;
  if (/(?:→|->|=>|\\rightarrow|ightarrow)/i.test(source) && /(?:→|->|=>|\\rightarrow|ightarrow)/i.test(content)) return true;
  if (isCircuitSource(source) && /\b(?:u|i|r)\d+\b|mạch điện|điện trở/i.test(content)) return true;
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
  const questions = Array.from({ length: 5 }, (_, index) => {
    const generated = sourceQuestion(sourceExpression || sourceText, index, language);
    return {
      ...(generated || {
        id: `q${index + 1}`,
        title: language === 'vi' ? `Luyện tập theo đề · Câu ${index + 1}` : `Practice from the problem · Question ${index + 1}`,
        prompt: prompts[index],
      }),
      id: `q${index + 1}`,
      // Keep offline fallback text-only; visuals are accepted only from Gemini.
      visual: { kind: 'none' },
      interactionType: generated?.interactionType || interactionType,
      options: generated?.options || [
        { id: 'A', text: sourceOption },
        { id: 'B', text: language === 'vi' ? 'Một thông tin không xuất hiện trong đề' : 'Information not present in the problem' },
        { id: 'C', text: language === 'vi' ? 'Một dữ kiện trái với đề bài' : 'Data that contradicts the problem' },
        { id: 'D', text: language === 'vi' ? 'Một nội dung không liên quan đến đề' : 'Content unrelated to the problem' },
      ],
      correctOptionId: 'A',
      tutorSteps: generated?.tutorSteps || genericTutorSteps({ sourceText, sourceOption, language }),
    };
  });
  return { sourceQuestionId: questionId, sourceText, questions };
};

const normalizeStep = (raw, index, fallback, sourceText, language, strict = false, questionPrompt = '') => {
  if (strict && (!raw || typeof raw !== 'object' || !String(raw.explanation || '').trim() || !String(raw.analysis || '').trim() || !String(raw.hint || raw.easierExample?.hint || '').trim())) {
    throw new Error(`Gemini returned an incomplete tutor step at index ${index + 1}`);
  }
  if (strict && (!raw.easierExample || typeof raw.easierExample !== 'object'
    || !String(raw.easierExample.prompt || '').trim()
    || !String(raw.easierExample.answer || '').trim()
    || !String(raw.easierExample.hint || '').trim())) {
    throw new Error(`Gemini returned an incomplete easier example at index ${index + 1}`);
  }
  const hasRawBlanks = Array.isArray(raw?.blanks) && raw.blanks.length > 0;
  const hasRawTokens = Array.isArray(raw?.tokens) && raw.tokens.length > 0;
  if (strict && !raw.interaction?.type && hasRawBlanks !== hasRawTokens) {
    throw new Error(`Gemini returned an incomplete tutor exercise at index ${index + 1}`);
  }
  if (strict && !raw.interaction?.type && hasRawTokens && raw.tokens.some(token => !String(typeof token === 'string' ? token : token?.label || '').trim())) {
    throw new Error(`Gemini returned invalid tutor tokens at index ${index + 1}`);
  }
  const tokens = Array.isArray(raw?.tokens) ? raw.tokens.slice(0, 12).map((token, tokenIndex) => ({ id: id(typeof token === 'string' ? `t${index + 1}_${tokenIndex + 1}` : token?.id) || `t${index + 1}_${tokenIndex + 1}`, label: text(typeof token === 'string' ? token : token?.label, strict ? '' : '?', 30), type: ['number', 'operator', 'variable', 'text'].includes(token?.type) ? token.type : 'text' })) : strict ? [] : fallback.tokens;
  const tokenIds = new Set(tokens.map(token => token.id));
  const defaultTokenId = tokens[0]?.id;
  if (strict && !raw.interaction?.type && hasRawBlanks && raw.blanks.some(blank => !String(typeof blank === 'string' ? blank : blank?.label || '').trim())) {
    throw new Error(`Gemini returned invalid tutor blanks at index ${index + 1}`);
  }
  const blanks = Array.isArray(raw?.blanks) ? raw.blanks.slice(0, 6).map((blank, blankIndex) => {
    const label = text(typeof blank === 'string' ? blank : blank?.label, 'Ô trống', 50);
    const explicitTokenId = id(typeof blank === 'string' ? '' : blank?.expectedTokenId);
    const arithmeticAnswer = arithmeticBlankAnswer(label);
    const expectedLabels = arithmeticAnswer === null ? [] : [String(arithmeticAnswer)];
    const inferredToken = tokens.find(token => expectedLabels.some(answer => answerNumber(token.label) === answerNumber(answer) || normalizeForMatch(token.label) === normalizeForMatch(answer)));
    const mentionedToken = answerMentionedForBlank(label, raw, tokens);
    const expectedTokenId = tokenIds.has(explicitTokenId) ? explicitTokenId : inferredToken?.id || mentionedToken?.id || (strict && hasRawBlanks ? undefined : defaultTokenId);
    if (strict && !expectedTokenId) throw new Error(`Gemini returned an unmapped tutor blank at index ${index + 1}`);
    return { id: id(typeof blank === 'string' ? `b${index + 1}_${blankIndex + 1}` : blank?.id) || `b${index + 1}_${blankIndex + 1}`, label, expectedTokenId };
  }).filter(blank => blank.expectedTokenId) : strict ? [] : fallback.blanks;
  const interaction = raw?.interaction?.type === 'sort_sequence' && Array.isArray(raw.interaction.items)
    ? { type: 'sort_sequence', items: raw.interaction.items.slice(0, 6).map((item, itemIndex) => ({ id: id(item?.id) || `i${itemIndex + 1}`, text: text(item?.text, 'Bước', 120), order: Number(item?.order) || itemIndex + 1 })) }
    : ['match_pairs', 'label_diagram', 'cause_effect'].includes(raw?.interaction?.type) && Array.isArray(raw.interaction.pairs)
      ? { type: raw.interaction.type, pairs: raw.interaction.pairs.slice(0, 6).map((pair, pairIndex) => ({ id: id(pair?.id) || `p${pairIndex + 1}`, left: text(pair?.left, 'Khái niệm', 80), right: text(pair?.right, 'Nghĩa', 80) })) }
      : raw?.interaction?.type === 'evidence_choice' && Array.isArray(raw.interaction.choices)
        ? { type: 'evidence_choice', prompt: text(raw.interaction.prompt, 'Chọn bằng chứng phù hợp.', 200), choices: raw.interaction.choices.slice(0, 4).map((choice, choiceIndex) => ({ id: id(choice?.id) || `c${choiceIndex + 1}`, text: text(choice?.text, 'Lựa chọn', 180), correct: Boolean(choice?.correct) })) }
        : raw?.interaction?.type === 'cloze'
          ? { type: 'cloze', prompt: text(raw.interaction.prompt, 'Điền từ còn thiếu.', 300), answer: text(raw.interaction.answer, '', 80).toLowerCase() }
        : null;
  if (strict && raw?.interaction?.type) {
    const source = raw.interaction;
    const valid = source.type === 'sort_sequence'
      ? Array.isArray(source.items) && source.items.length > 0 && source.items.every(item => String(item?.text || '').trim())
      : ['match_pairs', 'label_diagram', 'cause_effect'].includes(source.type)
        ? Array.isArray(source.pairs) && source.pairs.length > 0 && source.pairs.every(pair => String(pair?.left || '').trim() && String(pair?.right || '').trim())
        : source.type === 'evidence_choice'
          ? String(source.prompt || '').trim() && Array.isArray(source.choices) && source.choices.length > 0 && source.choices.some(choice => choice?.correct === true)
          : source.type === 'cloze'
            ? String(source.prompt || '').trim() && String(source.answer || '').trim()
            : false;
    if (!valid) throw new Error(`Gemini returned an incomplete interaction at index ${index + 1}`);
  }
  const hasExercise = Boolean(interaction || (blanks.length && tokens.length));
  const rawExplanation = text(raw?.explanation, strict ? '' : fallback.explanation, 500);
  if (!isRelatedToSource(rawExplanation, `${sourceText}\n${questionPrompt}`) && !strict) return fallback;
  const hint = text(raw?.hint || raw?.easierExample?.hint, strict ? '' : fallback.hint || fallback.easierExample?.hint || '', 300);
  if (strict && /[?？]/.test(hint)) {
    throw new Error(`Gemini returned a question inside hint at index ${index + 1}; hint must only guide`);
  }
  return { id: id(raw?.id) || `s${index + 1}`, title: text(raw?.title, strict ? '' : fallback.title, 90), explanation: rawExplanation, analysis: text(raw?.analysis, strict ? '' : fallback.analysis || rawExplanation, 500), hint, easierExample: strict ? { prompt: text(raw.easierExample.prompt, '', 500), answer: text(raw.easierExample.answer, '', 300), hint: text(raw.easierExample.hint, '', 300) } : (fallback.easierExample || { prompt: '', answer: '', hint }), blanks: hasExercise ? blanks : [], tokens: hasExercise ? tokens : [], interaction };
};

const normalizeQuestion = (raw, index, sourceText, language, context = {}, strict = false) => {
  const fallback = strict ? null : fallbackLesson({ sourceText, sourceExpression: context.sourceExpression, language, subjectArea: context.subjectArea, course: context.course }).questions[index];
  if (strict && (!raw || typeof raw !== 'object' || !String(raw.title || '').trim() || !String(raw.prompt || '').trim() || !Array.isArray(raw.options) || raw.options.length !== 4 || !Array.isArray(raw.tutorSteps) || raw.tutorSteps.length !== 2)) {
    throw new Error(`Gemini returned an incomplete question at index ${index + 1}`);
  }
  if (strict && raw.options.some(option => !String(typeof option === 'string' ? option : option?.text || '').trim())) {
    throw new Error(`Gemini returned invalid options at index ${index + 1}`);
  }
  if (strict && !['A', 'B', 'C', 'D', '0', '1', '2', '3'].includes(String(raw.correctOptionId ?? ''))) {
    throw new Error(`Gemini returned an invalid answer at index ${index + 1}`);
  }
  if (strict && isMathCourse(context) && raw.tutorSteps.some(step => {
    const hasBlanks = Array.isArray(step?.blanks) && step.blanks.length > 0;
    const hasTokens = Array.isArray(step?.tokens) && step.tokens.length > 0;
    return hasBlanks !== hasTokens;
  })) throw new Error(`Gemini returned an incomplete math exercise at index ${index + 1}`);
  const rawPrompt = text(raw?.prompt, strict ? '' : sourceText || fallback.prompt, 900);
  if (strict && !isRelatedToSource(rawPrompt, sourceText)) {
    throw new Error(`Gemini returned an unrelated question at index ${index + 1}`);
  }
  const deterministic = !strict && sourceQuestion(context.sourceExpression || sourceText, index, language);
  if (deterministic) return { ...deterministic, id: id(raw?.id) || deterministic.id };
  const options = Array.isArray(raw?.options) ? raw.options.slice(0, 4).map((option, optionIndex) => ({ id: String.fromCharCode(65 + optionIndex), text: text(typeof option === 'string' ? option : option?.text, strict ? '' : fallback.options[optionIndex]?.text || 'Lựa chọn', 180) })) : strict ? [] : fallback.options;
  const validIds = new Set(options.map(option => option.id));
  const correctOptionId = ['0', '1', '2', '3'].includes(String(raw?.correctOptionId ?? ''))
    ? String.fromCharCode(65 + Number(raw.correctOptionId))
    : String(raw?.correctOptionId || '');
  if (!isRelatedToSource(rawPrompt, sourceText)) {
    if (strict) throw new Error(`Gemini returned an unrelated question at index ${index + 1}`);
    return { id: id(raw?.id) || `q${index + 1}`, ...fallback };
  }
  const prompt = rawPrompt;
  // Never infer the source problem from Gemini's prompt; that would let an
  // unrelated expression in the generated text replace the student's problem.
  const steps = Array.isArray(raw?.tutorSteps) ? raw.tutorSteps.slice(0, 4).map((step, stepIndex) => normalizeStep(step, stepIndex, strict ? null : fallback.tutorSteps[stepIndex] || fallback.tutorSteps[0], sourceText, language, strict, rawPrompt)).filter(Boolean) : strict ? [] : fallback.tutorSteps;
  if (!strict) while (steps.length < 3) steps.push(fallback.tutorSteps[steps.length]);
  const mathSubject = isMathCourse(context);
  steps.forEach(step => {
    if (mathSubject) {
      step.interaction = null;
      if (step.blanks.length || step.tokens.length) {
        if (!step.blanks.length || !step.tokens.length) throw new Error(`Gemini returned an incomplete math exercise at index ${index + 1}`);
      }
    }
    if (!mathSubject && !step.interaction && raw?.interactionType === 'cloze') step.interaction = { type: 'cloze', prompt: step.explanation || 'Điền từ còn thiếu.', answer: '' };
    if (!mathSubject && !step.interaction && raw?.interactionType === 'sort_sequence') step.interaction = { type: 'sort_sequence', items: [{ id: 'i1', text: 'Bước đầu', order: 1 }, { id: 'i2', text: 'Bước tiếp theo', order: 2 }, { id: 'i3', text: 'Kết luận', order: 3 }] };
    if (!mathSubject && !step.interaction && ['match_pairs', 'label_diagram', 'cause_effect'].includes(raw?.interactionType)) step.interaction = { type: raw.interactionType, pairs: [{ id: 'p1', left: 'Nội dung chính', right: 'Ghép đúng' }] };
    if (!mathSubject && !step.interaction && raw?.interactionType === 'evidence_choice') step.interaction = { type: 'evidence_choice', prompt: step.explanation || 'Chọn bằng chứng phù hợp.', choices: [{ id: 'c1', text: 'Bằng chứng trực tiếp từ đề bài.', correct: true }, { id: 'c2', text: 'Thông tin không xuất hiện trong đề.', correct: false }] };
    if (step.interaction?.type === 'cloze' && !step.interaction.answer) {
      step.interaction.answer = String(options.find(option => option.id === (validIds.has(correctOptionId) ? correctOptionId : 'A'))?.text || '').trim().toLowerCase();
    }
  });
  const interactionTypes = ['math_tokens', 'label_diagram', 'sort_sequence', 'match_pairs', 'cloze', 'evidence_choice', 'cause_effect', 'generic_tokens'];
  const resolvedInteractionType = mathSubject ? 'math_tokens' : interactionTypes.includes(raw?.interactionType) && raw.interactionType !== 'generic_tokens' ? raw.interactionType : interactionFor(context);
  const interactionType = resolvedInteractionType;
  let resolvedCorrectOptionId = validIds.has(correctOptionId) ? correctOptionId : 'A';
  const equation = linearEquationData(rawPrompt);
  if (strict && equation?.kind === 'linear') {
    const answerIndex = options.findIndex(option => answerNumber(option.text) === equation.solution);
    if (answerIndex < 0) throw new Error(`Gemini returned no correct answer at index ${index + 1}`);
    resolvedCorrectOptionId = String.fromCharCode(65 + answerIndex);
  }
  return { id: id(raw?.id) || `q${index + 1}`, title: text(raw?.title, strict ? '' : fallback.title, 120), prompt, visual: { kind: 'none' }, interactionType, options: options.length === 4 ? options : strict ? [] : fallback.options, correctOptionId: resolvedCorrectOptionId, tutorSteps: steps.length ? steps : strict ? [] : fallback.tutorSteps };
};

const sanitizeLesson = (raw, context = {}, strict = false) => {
  const fallback = strict ? null : fallbackLesson(context);
  if (strict && (!Array.isArray(raw?.questions) || raw.questions.length !== 5)) throw new Error('Gemini returned an incomplete five-question lesson');
  const questions = Array.isArray(raw?.questions) ? raw.questions.slice(0, 5).map((question, index) => normalizeQuestion(question, index, context.sourceText, context.language, context, strict)).filter(question => question.options.length === 4) : [];
  if (strict && questions.length !== 5) throw new Error('Gemini returned unusable lesson questions');
  if (strict && new Set(questions.map(question => normalizeForMatch(question.prompt))).size !== 5) throw new Error('Gemini returned duplicate lesson questions');
  const previousQuestions = new Set((context.previousQuestions || []).map(normalizeForMatch));
  if (strict && previousQuestions.size && questions.some(question => previousQuestions.has(normalizeForMatch(question.prompt)))) {
    throw new Error('Gemini returned a question from the previous lesson');
  }
  const originalEquation = linearEquationData(context.sourceExpression || context.sourceText);
  if (strict && originalEquation?.kind === 'linear' && questions.some(question => {
    const generatedEquation = linearEquationData(question.prompt);
    return !generatedEquation || generatedEquation.expression === originalEquation.expression;
  })) throw new Error('Gemini returned the original equation instead of a similar one');
  // Gemini occasionally returns fewer items; pad so every lesson always has five steps/questions.
  if (!strict) while (questions.length < 5) questions.push(fallback.questions[questions.length]);
  return { sourceQuestionId: context.questionId || 'main', sourceText: context.sourceText || '', sourceImage: context.sourceImage || null, questions };
};

const generateLessonLegacy = async (context = {}) => {
  let repairAttempts = Number(context.repairAttempts || 0);
  let repairError = context.repairError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
    const previousQuestions = (context.previousQuestions || []).filter(Boolean).join('\n- ');
    /* Legacy prompt kept out of the request; the contract below is authoritative. */
    /*
    const previousQuestions = (context.previousQuestions || []).filter(Boolean).join('\n- ');
    const prompt = `Tạo một bộ 5 câu hỏi luyện tập HOÀN TOÀN MỚI cho lần mở AI Tutor này, cùng dạng và cùng kỹ năng với bài gốc. Mã sinh mới của lần này là ${context.generationSeed || `${Date.now()}-${Math.random()}`}; không được dùng mã này trong nội dung câu hỏi. Được đổi số liệu nhưng không đổi dạng, phép toán, biến hoặc phương pháp; mỗi câu phải khác câu gốc và khác 4 câu còn lại. Nếu bài gốc là phép tính số học không có biến, tuyệt đối không thêm biến x hoặc đổi sang phương trình; chỉ tạo phép tính cùng phép toán. Với phương trình, tạo 5 phương trình dạng ax+b=c khác nhau, không lặp bài gốc và không lặp bộ câu hỏi trước. Dùng ngữ cảnh cuộc trò chuyện bên dưới để hiểu đúng yêu cầu hiện tại, nhưng chỉ tạo bài tập xoay quanh đề bài hiện tại; không sao chép câu trả lời cũ hoặc tạo lại lesson cũ.

ĐÂY LÀ HỢP ĐỒNG BẮT BUỘC: không được bỏ trường nào. Mỗi câu có title rõ ràng, prompt là một câu hỏi hoàn chỉnh có đủ dữ kiện và yêu cầu cụ thể (không viết câu chung chung như “hãy áp dụng”, “hãy suy nghĩ” hoặc “dựa vào bước trên”), interactionType, options là đúng 4 chuỗi, correctOptionId là một số 0-3, tutorSteps là đúng 2 object. Mỗi tutorStep bắt buộc có title, explanation, analysis, easierExample là object {prompt,answer,hint}; prompt của easierExample phải là một câu hỏi độc lập, nêu đủ số liệu/biểu thức và yêu cầu cụ thể, answer phải trả lời đúng prompt, hint phải hướng dẫn trực tiếp. Với dạng điền ô, tutorStep bắt buộc có blanks là mảng chuỗi và tokens là mảng chuỗi: blanks chỉ là các ô cần điền (dùng chuỗi có ____), tokens chỉ là các lựa chọn để điền (không tách phương trình thành từng ký hiệu). Ví dụ hợp lệ: blanks:["14 - 5 = ____"], tokens:["14","5","9"]. Token đúng phải xuất hiện trong tokens và blanks phải tương ứng với token đúng. Không tạo visual/SVG/hình ảnh.

Chỉ trả JSON hợp lệ theo đúng schema này, không markdown: {"questions":[{"title":"...","prompt":"...","interactionType":"math_tokens","options":["...","...","...","..."],"correctOptionId":0,"tutorSteps":[{"title":"...","explanation":"...","analysis":"...","easierExample":{"prompt":"Tính 10 - 3 = ?","answer":"7","hint":"Lấy 10 trừ 3."},"blanks":["10 - 3 = ____"],"tokens":["10","3","7"]},{"title":"...","explanation":"...","analysis":"...","easierExample":{"prompt":"Kiểm tra 10 - 3 = 7 bằng phép cộng.","answer":"7 + 3 = 10","hint":"Cộng hiệu với số trừ."},"blanks":["7 + 3 = ____"],"tokens":["7","3","10"]}]}]}. Ngôn ngữ: ${context.language || 'vi'}. Cấp học: ${context.educationLevel || 'middle'}. Môn: ${context.course || context.subjectArea || ''}. Bài gốc: ${context.sourceText || '(xem ảnh đính kèm)'}. Biểu thức gốc: ${context.sourceExpression || '(không có)'}. Ngữ cảnh cuộc trò chuyện hiện tại:\n${context.conversationContext || '(không có)'}. Các prompt của lesson cũ, TUYỆT ĐỐI KHÔNG ĐƯỢC LẶP LẠI:\n- ${previousQuestions || '(không có)'}`;
    */
    const contractPrompt = [
      `Tạo JSON lesson gồm đúng 5 câu hỏi mới theo bài gốc. Mã sinh lần này là ${context.generationSeed || `${Date.now()}-${Math.random()}`}; không đưa mã này vào nội dung. Đây là lần sửa ${repairAttempts + 1}.`,
      'Mỗi câu có title, prompt đầy đủ dữ kiện, interactionType, đúng 4 options, correctOptionId là số 0-3 và đúng 2 tutorSteps.',
      'Giữ nguyên dạng bài, phép toán, biến và phương pháp. Nếu bài gốc là phép tính số học không có biến thì tuyệt đối không thêm biến x hoặc đổi sang phương trình. Nếu là phương trình thì tạo phương trình cùng dạng, khác số liệu và không lặp bài gốc.',
      'Mỗi tutorStep có title, explanation, analysis, easierExample {prompt,answer,hint}, hint, blanks và tokens.',
      'Hint chỉ là hướng dẫn ngắn, không chứa câu hỏi, dấu ? hoặc ____.',
      'Nếu chỉ hướng dẫn thì blanks và tokens phải là []; chỉ tạo bài điền khi học sinh thật sự cần điền.',
      'Khi có bài điền, blanks là object {id,label,expectedTokenId}; label nói rõ cần điền gì; expectedTokenId trỏ chính xác đến một token trong tokens; tokens là object {id,label,type}.',
      'easierExample bắt buộc là một câu hỏi dễ hơn, độc lập, có đủ dữ kiện; answer phải đúng và hint chỉ hướng dẫn. Không tạo câu hỏi phụ, visual, SVG hoặc hình ảnh.',
      'Câu hỏi phải cùng dạng bài, bám sát đề gốc, khác nhau và không lặp các câu cũ.',
      formulaRule(context.language),
      'Chỉ trả JSON hợp lệ, không markdown.',
      `Ngôn ngữ: ${context.language || 'vi'}. Cấp học: ${context.educationLevel || 'middle'}. Môn: ${context.course || context.subjectArea || ''}.`,
      `Bài gốc: ${context.sourceText || '(xem ảnh đính kèm)'}. Biểu thức gốc: ${context.sourceExpression || '(không có)'}.`,
      `Ngữ cảnh: ${context.conversationContext || '(không có)'}. Câu cũ không được lặp: ${previousQuestions || '(không có)'}.`,
      repairError ? `LỖI Ở LẦN TRƯỚC: ${repairError}. Hãy tạo lại toàn bộ JSON và sửa đúng lỗi này.` : '',
    ].filter(Boolean).join('\n');
    const chat = startChat([], 'Bạn là AI Tutor. Chỉ trả JSON hợp lệ. Bắt buộc tạo easierExample cho mỗi tutorStep; không dùng fallback. Hint chỉ là hướng dẫn, không phải câu hỏi.');
    const requestPrompt = contractPrompt;
    const parts = [{ text: requestPrompt }];
    if (context.sourceImage?.url) {
      const imageResponse = await fetch(context.sourceImage.url);
      if (imageResponse.ok) parts.push({ inlineData: { mimeType: imageResponse.headers.get('content-type') || 'image/jpeg', data: Buffer.from(await imageResponse.arrayBuffer()).toString('base64') } });
    }
    const raw = parseJson(extractResponseText(await makeRequestWithRetry(() => chat.sendMessage(parts))));
    if (!Array.isArray(raw?.questions) || raw.questions.length !== 5 || raw.questions.some(question => !Array.isArray(question?.options) || question.options.length !== 4)) {
      throw new Error('Gemini returned an incomplete five-question lesson');
    }
    return sanitizeLesson(raw, context, true);
  } catch (error) {
    console.error('AI tutor lesson generation failed:', error.message);
    if (error?.status || error?.response?.status || /No Google API keys configured|No response from Gemini API|Invalid response format from Gemini API/i.test(error.message)) throw error;
    repairAttempts += 1;
    repairError = error.message;
    }
  }
  throw new Error(`Không thể tạo lesson AI Tutor: ${repairError || 'Gemini không trả về dữ liệu hợp lệ'}`);
};

const generateTutorQuestion = async (context = {}, index = 0) => {
  let lastError;
  let rejectedPrompt = '';
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      const previousQuestions = (context.previousQuestions || []).filter(Boolean).join('\n- ');
      const usedFingerprints = [...new Set((context.previousQuestions || []).map(questionFingerprint).filter(Boolean))].join('; ');
      const variantId = `${context.generationSeed || Date.now()}-${index}-${attempt}`;
      const prompt = [
        `Tạo đúng 1 câu hỏi AI Tutor mới cho bài gốc. Đây là câu ${index + 1}/5, biến thể ${attempt + 1}, mã biến thể ${variantId}; không tạo mảng questions và không tạo thêm câu nào khác.`,
        'Prompt phải là một câu hỏi hoàn chỉnh, có đủ dữ kiện và yêu cầu cụ thể; không viết câu chung chung.',
        'Giữ nguyên dạng bài, phép toán, biến và phương pháp. Nếu bài gốc là phép tính số học không có biến thì không thêm biến x hoặc đổi thành phương trình. Nếu là phương trình hoặc phản ứng hóa học thì bắt buộc đổi chất tham gia hoặc số liệu để tạo bài mới. Không được chỉ thêm "Câu N", đổi vài từ, hoặc giữ cùng một phản ứng hay phương trình.',
        'Câu hỏi có title, prompt, interactionType, đúng 4 options, correctOptionId là số 0-3 và đúng 2 tutorSteps.',
        'Mỗi tutorStep bắt buộc có title, explanation, analysis, easierExample và hint. easierExample là một câu hỏi dễ hơn nhưng độc lập, có đủ dữ kiện và yêu cầu rõ ràng; answer phải đúng với prompt; hint chỉ hướng dẫn ngắn, không chứa câu hỏi, dấu ? hoặc ____.',
      'Nếu có bài điền, blanks là object {id,label,expectedTokenId}, tokens là object {id,label,type}; expectedTokenId phải trỏ đúng token. Nếu chỉ hướng dẫn thì blanks và tokens là [].',
        'Không tạo visual, SVG hoặc hình ảnh. Chỉ trả JSON hợp lệ, không markdown theo dạng: {"question":{"title":"...","prompt":"...","interactionType":"...","options":["...","...","...","..."],"correctOptionId":0,"tutorSteps":[{"title":"...","explanation":"...","analysis":"...","easierExample":{"prompt":"Tính 10 - 3 = ?","answer":"7","hint":"Lấy 10 trừ 3."},"hint":"...","blanks":[],"tokens":[]},{"title":"...","explanation":"...","analysis":"...","easierExample":{"prompt":"Tính 6 - 2 = ?","answer":"4","hint":"Lấy 6 trừ 2."},"hint":"...","blanks":[],"tokens":[]}]}}',
        formulaRule(context.language),
        `Ngôn ngữ: ${context.language || 'vi'}. Cấp học: ${context.educationLevel || 'middle'}. Môn: ${context.course || context.subjectArea || ''}.`,
        `Bài gốc: ${context.sourceText || '(xem ảnh đính kèm)'}. Biểu thức gốc: ${context.sourceExpression || '(không có)'}.`,
        `Ngữ cảnh cuộc trò chuyện hiện tại: ${context.conversationContext || '(không có)'}.`,
        `Các câu không được lặp, kể cả khi viết khác lời: ${previousQuestions || '(không có)'}.`,
        `Vân tay đã dùng, không được tạo lại: ${usedFingerprints || '(không có)'}.`,
        rejectedPrompt ? `Prompt vừa bị từ chối vì bị trùng, tuyệt đối không được dùng lại. Hãy đổi chất tham gia, số liệu hoặc đại lượng được hỏi, không được copy: ${rejectedPrompt}` : '',
        lastError ? `Lần trước output không hợp lệ vì: ${lastError}. Hãy sửa đúng lỗi đó.` : '',
      ].filter(Boolean).join('\n');
      const chat = startChat([], 'Bạn là AI Tutor. Chỉ trả JSON hợp lệ. Bắt buộc tự tạo câu hỏi và easierExample; không dùng fallback.');
      const parts = [{ text: prompt }];
      if (context.sourceImage?.url) {
        const imageResponse = await fetch(context.sourceImage.url);
        if (imageResponse.ok) parts.push({ inlineData: { mimeType: imageResponse.headers.get('content-type') || 'image/jpeg', data: Buffer.from(await imageResponse.arrayBuffer()).toString('base64') } });
      }
      const raw = parseJson(extractResponseText(await makeRequestWithRetry(() => chat.sendMessage(parts))));
      const question = normalizeQuestion(raw?.question || raw, index, context.sourceText, context.language, context, true);
      const seen = [...(context.previousQuestions || []), context.sourceExpression, context.sourceText];
      if (isDuplicateTutorQuestion(question.prompt, seen)) {
        rejectedPrompt = question.prompt;
        throw new Error('Gemini returned a duplicated question');
      }
      const originalEquation = linearEquationData(context.sourceExpression || context.sourceText);
      if (originalEquation?.kind === 'linear') {
        const generatedEquation = linearEquationData(question.prompt);
        if (!generatedEquation || generatedEquation.expression === originalEquation.expression) {
          rejectedPrompt = question.prompt;
          throw new Error('Gemini returned the original equation instead of a similar one');
        }
      }
      return { ...question, id: `q${index + 1}` };
    } catch (error) {
      lastError = error.message;
      console.error(`AI tutor question ${index + 1} generation failed:`, lastError);
    }
  }
  throw new Error(`Không thể tạo câu AI Tutor ${index + 1}: ${lastError || 'Gemini không trả về dữ liệu hợp lệ'}`);
};

const generateLesson = async (context = {}) => {
  const questions = [];
  for (let index = 0; index < 5; index += 1) {
    questions.push(await generateTutorQuestion({
      ...context,
      previousQuestions: [...(context.previousQuestions || []), ...questions.map(question => question.prompt)],
    }, index));
  }
  return { sourceQuestionId: context.questionId || 'main', sourceText: context.sourceText || '', sourceImage: context.sourceImage || null, questions };
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
  const question = await generateTutorQuestion({ sourceText: `${subject}: ${topic}`, language, educationLevel: level }, 0);
  return { title: question.title, prompt: question.prompt, diagram: { type: 'none' }, options: question.options, correctId: question.correctOptionId, steps: question.tutorSteps.map(step => ({ title: step.title, content: step.explanation })), hint: 'Hãy đọc dữ kiện và thử từng bước.' };
};

module.exports = { fallbackLesson, sanitizeLesson, generateLesson, generateTutorQuestion, makeLessonId, fallbackQuestion, sanitizeQuestion, generateQuestion, makeQuestionId: makeLessonId, questionFingerprint, isDuplicateTutorQuestion };
