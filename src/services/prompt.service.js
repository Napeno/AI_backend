// Import language files
const enPrompts = require('../locales/en.json');
const viPrompts = require('../locales/vi.json');
const { formulaRule } = require('./model-json');

// Available subject areas for all levels
const AVAILABLE_SUBJECTS = [
  // Elementary level subjects
  'vietnamese', 'mathematics', 'foreign_language', 'ethics', 'natural_social',
  'history_geography', 'science', 'informatics_technology', 'physical_education', 'arts',
  // Middle level subjects
  'literature', 'civic_education', 'natural_sciences', 'technology', 'informatics',
  // High level subjects (existing)
  'social_sciences', 'english_language'
];
const AVAILABLE_LEVELS = ['elementary', 'middle', 'high'];

// Specific courses within each level and subject area
const AVAILABLE_COURSES = {
  'elementary': {
    // Level 1 subjects (cap 1): Tiếng Việt, Toán, Ngoại ngữ 1, Đạo đức, Tự nhiên và Xã hội, Lịch sử và Địa lý, Khoa học, Tin học và Công nghệ, Giáo dục thể chất, Nghệ thuật (Âm nhạc, Mĩ thuật)
    'vietnamese': ['vietnamese'],
    'mathematics': ['mathematics'],
    'foreign_language': ['english'],
    'ethics': ['ethics'],
    'natural_social': ['natural_social'],
    'history_geography': ['history_geography'],
    'science': ['science'],
    'informatics_technology': ['informatics_technology'],
    'physical_education': ['physical_education'],
    'arts': ['music', 'fine_arts']
  },
  'middle': {
    // Level 2 subjects (cap 2): Ngữ văn, Toán, Ngoại ngữ 1, Giáo dục công dân, Lịch sử và Địa lý, Khoa học tự nhiên, Công nghệ, Tin học, Nghệ thuật (Âm nhạc, Mỹ thuật)
    'literature': ['literature'],
    'mathematics': ['mathematics'],
    'foreign_language': ['english'],
    'civic_education': ['civic_education'],
    'history_geography': ['history_geography'],
    'natural_sciences': ['natural_sciences'],
    'technology': ['technology'],
    'informatics': ['informatics'],
    'arts': ['music', 'fine_arts']
  },
  'high': {
    // Level 3 subjects (keep unchanged): existing structure
    'natural_sciences': ['mathematics', 'physics', 'chemistry', 'biology'],
    'social_sciences': ['history', 'geography', 'civics', 'literature', 'foreign_language'],
    'mathematics': ['mathematics'],
    'english_language': ['english_language']
  }
};

const getPrompts = (language = 'en', educationLevel = 'middle', subjectArea = 'natural_sciences', course = null) => {
  const basePrompts = language === 'vi' ? viPrompts : enPrompts;

  // Validate inputs
  const validLevel = AVAILABLE_LEVELS.includes(educationLevel) ? educationLevel : 'middle';
  const validSubject = AVAILABLE_SUBJECTS.includes(subjectArea) ? subjectArea : 'natural_sciences';

  // Get prompts with course-specific fallback logic
  const levelPrompts = basePrompts.prompts?.[validLevel];
  if (levelPrompts) {
    // If course is specified, try to get course-specific prompts first
    if (course && levelPrompts[course]) {
      return levelPrompts[course];
    }
    // Otherwise, fall back to subject area prompts
    if (levelPrompts[validSubject]) {
      return levelPrompts[validSubject];
    }
  }

  // Final fallback based on education level
  let fallbackSubject = 'natural_sciences';
  if (validLevel === 'elementary') {
    fallbackSubject = 'mathematics'; // Elementary fallback to mathematics
  } else if (validLevel === 'middle') {
    fallbackSubject = 'natural_sciences'; // Middle fallback to natural_sciences
  } else if (validLevel === 'high') {
    fallbackSubject = 'natural_sciences'; // High school fallback to natural_sciences
  }

  return basePrompts.prompts?.[validLevel]?.[fallbackSubject] || basePrompts.prompts?.middle?.natural_sciences || {
    chat: "You are a helpful companion. Answer the student's question: {{message}}",
    continue: "Provide more guidance to help the student.",
    fullAnswer: "Give the complete answer to the student.",
    checkAnswer: "Check the student's answer: {{userAnswer}}"
  };
};

const getSystemInstruction = (language = 'en', educationLevel = 'middle', subjectArea = 'natural_sciences', course = null) => {
  const basePrompts = language === 'vi' ? viPrompts : enPrompts;

  // Validate inputs
  const validLevel = AVAILABLE_LEVELS.includes(educationLevel) ? educationLevel : 'middle';
  const validSubject = AVAILABLE_SUBJECTS.includes(subjectArea) ? subjectArea : 'natural_sciences';

  // Get system instruction with course-specific fallback logic
  const levelInstructions = basePrompts.system_instruction?.[validLevel];
  if (levelInstructions) {
    if (course && levelInstructions[course]) {
      return levelInstructions[course];
    }
    if (levelInstructions[validSubject]) {
      return levelInstructions[validSubject];
    }
  }

  // Fallback
  return basePrompts.system_instruction?.middle?.natural_sciences || "You are a helpful AI assistant.";
};

const buildSystemInstruction = (language = 'en', educationLevel, subjectArea, course = null) => {
  const instruction = getSystemInstruction(language, educationLevel, subjectArea, course);
  const formula = formulaRule(language);
  if (educationLevel !== 'middle') return `${instruction}\n\n${formula}`;

  const isMathematics = subjectArea === 'mathematics' || course === 'mathematics';
  const directRequestRule = isMathematics
    ? language === 'vi'
      ? ' Khi học sinh hỏi kiến thức trực tiếp hoặc yêu cầu liệt kê công thức, hãy trả lời đủ phần được hỏi; quy tắc không đưa lời giải hoàn chỉnh chỉ áp dụng khi đang giải một bài tập cụ thể.'
      : ' When the student asks for factual knowledge or a list of formulas, provide the complete requested list; the no-complete-solution rule applies only when solving a specific exercise.'
    : '';

  return `${instruction}\n\n${language === 'vi'
    ? 'QUY TẮC DÀNH CHO HỌC SINH CẤP 2: Trả lời ngắn, rõ, dùng từ dễ hiểu. Lượt chat thường tối đa 6 câu hoặc 8 dòng; lượt gợi ý tối đa 4 câu và chỉ nêu 1 bước tiếp theo; lượt kiểm tra chỉ nhận xét đúng/sai và 1 cách sửa. Không chào hỏi dài, không lặp lại đề, không tự đưa ví dụ liên môn hoặc kiến thức ngoài câu hỏi. Chỉ liên môn khi học sinh yêu cầu. Nếu là bài Toán, bám đúng biểu thức và khóa học đã chọn.'
    : 'MIDDLE-SCHOOL RULES: Be short, clear, and easy to understand. A normal chat turn is at most 6 sentences or 8 lines; a hint is at most 4 sentences and gives only 1 next step; answer checks state correct/incorrect and 1 fix. Do not add long greetings, repeat the problem, or introduce unrelated subjects or cross-subject examples unless asked. For math, stay with the exact expression and selected course.'}${directRequestRule}\n\n${formula}`;
};

const buildChatPrompt = (message, language = 'en', educationLevel, subjectArea, course = null) => {
  const prompts = getPrompts(language, educationLevel, subjectArea, course);
  const isMathematics = subjectArea === 'mathematics' || course === 'mathematics';
  const concise = educationLevel === 'middle'
    ? language === 'vi'
      ? ' Chỉ trả lời 3-6 câu ngắn, đúng câu hỏi, không mở rộng sang môn khác nếu không được hỏi; riêng yêu cầu liệt kê công thức thì phải liệt kê đủ các công thức được hỏi.'
      : ' Reply in 3-6 short sentences, answer only the question, and do not expand into other subjects unless asked; formula-list requests must include every requested formula.'
    : '';
  const directMathRequest = isMathematics
    ? language === 'vi'
      ? ' Nếu học sinh yêu cầu liệt kê tên hoặc công thức, đó là yêu cầu kiến thức trực tiếp chứ không phải yêu cầu gợi ý: hãy trả lời trực tiếp và liệt kê đủ các mục được hỏi; không thay bằng một ví dụ khác. Nếu học sinh yêu cầu giải bài, mới hướng dẫn từng bước theo đúng biểu thức trong đề và lịch sử hội thoại.'
      : ' If the student asks to list names or formulas, that is a direct knowledge request rather than a hint request: answer directly and list every requested item; do not replace it with another example. If the student asks to solve a problem, guide step by step using the exact expression and conversation history.'
    : '';
  return `${prompts.chat.replace('{{message}}', message)}${directMathRequest}${concise}`;
};

const buildContinuePrompt = (language = 'en', educationLevel, subjectArea, course = null) => {
  const prompts = getPrompts(language, educationLevel, subjectArea, course);
  const concise = educationLevel === 'middle'
    ? language === 'vi'
      ? ' Chỉ đưa 1 gợi ý mới trong tối đa 4 câu ngắn, bám đúng đề và hỏi 1 câu nhỏ ở cuối.'
      : ' Give only 1 new hint in at most 4 short sentences, stay with the problem, and ask 1 small question at the end.'
    : '';
  return `${prompts.continue}${concise}`;
};

const buildFullAnswerPrompt = (language = 'en', educationLevel, subjectArea, course = null) => {
  const prompts = getPrompts(language, educationLevel, subjectArea, course);
  const concise = educationLevel === 'middle'
    ? language === 'vi'
      ? ' Trình bày tối đa 6 bước đánh số, mỗi bước 1 câu ngắn; chỉ dùng kiến thức đúng môn và kết luận rõ.'
      : ' Use at most 6 numbered steps, one short sentence per step; stay in the selected subject and state the conclusion clearly.'
    : '';
  return `${prompts.fullAnswer}${concise}`;
};

const buildCurrentQuestionReminder = (history = [], language = 'en', course = null, fullAnswer = false) => {
  const currentQuestion = [...history].reverse()
    .find(message => message.role === 'user')?.parts?.map(part => part.text || '').join('\n').trim();
  if (!currentQuestion) return '';

  const subjectReminder = course === 'mathematics'
    ? language === 'vi'
      ? ` Đây là câu hỏi Toán; ${fullAnswer ? 'chỉ dùng kiến thức Toán' : 'tuyệt đối không chuyển sang Vật lý, Hóa học hoặc Sinh học'}.`
      : ` This is a mathematics question; ${fullAnswer ? 'use mathematics only' : 'do not switch to physics, chemistry, or biology'}.`
    : '';
  const label = fullAnswer
    ? (language === 'vi' ? 'CÂU HỎI HIỆN TẠI CẦN TRẢ LỜI' : 'CURRENT QUESTION TO ANSWER')
    : (language === 'vi' ? 'CÂU HỎI HIỆN TẠI CẦN BÁM SÁT' : 'CURRENT QUESTION TO STAY WITH');
  return `\n${label}: "${currentQuestion}".${subjectReminder}`;
};

const normalizeMathAnswer = (answer) => String(answer || '')
  .replace(/\*\*/g, '^')
  .replace(/[×·*]/g, ' × ')
  .replace(/[÷]/g, ' / ')
  .replace(/[−–—]/g, '-')
  .replace(/\s*([=+\-/^])\s*/g, ' $1 ')
  .replace(/\s+/g, ' ')
  .trim();

const buildCheckAnswerPrompt = (userAnswer, language = 'en', educationLevel, subjectArea, course = null, problemContext = '') => {
  const prompts = getPrompts(language, educationLevel, subjectArea, course);
  const basePrompts = language === 'vi' ? viPrompts : enPrompts;
  const isMathematics = subjectArea === 'mathematics' || course === 'mathematics';
  const answerForReview = isMathematics ? normalizeMathAnswer(userAnswer) : userAnswer;
  const formatInstruction = basePrompts.messages?.checkAnswerFormatInstruction || (
    language === 'vi'
      ? 'BẮT BUỘC: Bắt đầu bằng [ATTEMPT] hoặc [NOT_ATTEMPT], rồi [ĐÚNG], [SAI] hoặc [UNCERTAIN]. [ATTEMPT] chỉ dùng khi học sinh đã viết một bước làm liên quan. Chỉ dùng [SAI] khi đã kiểm tra chắc chắn; nếu ký hiệu hoặc dữ kiện chưa đủ rõ, dùng [UNCERTAIN] và hỏi đúng một điều cần làm rõ. Không đưa đáp án hoàn chỉnh.'
      : 'REQUIRED: Start with [ATTEMPT] or [NOT_ATTEMPT], then [CORRECT], [INCORRECT], or [UNCERTAIN]. Use [ATTEMPT] only for a relevant working step. Use [INCORRECT] only when certain; otherwise use [UNCERTAIN] and ask one clarification. Do not give the complete answer.'
  );
  const mathInstruction = isMathematics
    ? (language === 'vi'
      ? 'BÀI TOÁN: Dấu × là phép nhân; tuyệt đối không ghép các thừa số thành chữ số mới. Đối chiếu câu trả lời với đề gốc và kiểm tra tương đương đại số (khai triển hoặc thay giá trị) trước khi kết luận. Câu trả lời có thể kết thúc bằng “đúng không?”; hãy chấm biểu thức, không chấm câu hỏi đó.'
      : 'MATH: × means multiplication; never concatenate factors into a new number. Compare the answer with the original problem and check algebraic equivalence by expansion or substitution before deciding. The student may end with “is this correct?”; grade the expression, not that question.')
    : '';
  const contextInstruction = String(problemContext || '').trim()
    ? (language === 'vi'
      ? `NGỮ CẢNH ĐỀ GỐC VÀ CÁC GỢI Ý LIÊN QUAN:\n${problemContext}`
      : `ORIGINAL PROBLEM CONTEXT AND RELEVANT HINTS:\n${problemContext}`)
    : '';

  const conciseInstruction = language === 'vi'
    ? 'Chỉ trả lời ngắn gọn tối đa 4 câu, nêu đúng một nhận xét và một bước sửa/tiếp theo.'
    : 'Reply briefly in at most 4 sentences with one finding and one fix/next step.';
  return `${contextInstruction}\n${prompts.checkAnswer.replace('{{userAnswer}}', answerForReview)} ${mathInstruction} ${formatInstruction} ${conciseInstruction}`.trim();
};

// Helper function to filter out internal prompt text
const filterInternalPrompt = (text, language) => {
  if (language === 'vi') {
    // Remove Vietnamese internal prompts
    const patterns = [
      /Học sinh đã đưa ra câu trả lời để kiểm tra\. Hãy:[\s\S]*?đáp án hoàn chỉnh!/,
      /Học sinh đang gặp khó khăn và cần thêm gợi ý\. QUAN TRỌNG:[\s\S]*?70% đáp án!/,
      /Học sinh đã yêu cầu được trả lời đầy đủ\. Lần này[\s\S]*?100% đáp án!/,
      /Bạn là một người thầy thân thiện và kiên nhẫn[\s\S]*?phần còn lại!/,
      /QUAN TRỌNG: Bạn KHÔNG BAO GIỜ được trả lời hết đáp án[\s\S]*?phần còn lại!/,
      /QUY TẮC: Chỉ gợi ý 30-40% đáp án[\s\S]*?phần còn lại!/,
      /QUY TẮC: Chỉ gợi ý thêm 20-30% nữa[\s\S]*?70% đáp án!/,
      /QUY TẮC: Bây giờ bạn có thể trả lời 100% đáp án!/,
      /QUY TẮC: Chỉ đánh giá và gợi ý[\s\S]*?đáp án hoàn chỉnh!/,
      /Student is having difficulty and needs more hints\. IMPORTANT:[\s\S]*?70% of the answer!/,
      /IMPORTANT: You MUST NOT give the full answer[\s\S]*?60-70% of the answer!/,
      // Mathematics specific Vietnamese patterns
      /Bạn là một giáo viên toán học có kỹ năng[\s\S]*?nên là gì\./,
      /Bạn là một giáo viên toán học chuyên môn[\s\S]*?bước tiếp theo\./,
      /Thầy là người thầy toán vui vẻ[\s\S]*?tiếp theo là gì!/,
      // English language specific Vietnamese patterns
      /Bạn là một giáo viên tiếng Anh nhiệt tình[\s\S]*?về văn bản hoặc khái niệm\./,
      /Bạn là một giáo viên tiếng Anh và văn học tinh tế[\s\S]*?diễn giải sâu hơn\./,
      /Thầy là cô giáo tiếng Anh ấm áp[\s\S]*?nhận thấy hoặc cảm nhận!/
    ];

    patterns.forEach(pattern => {
      text = text.replace(pattern, '');
    });
  } else {
    // Remove English internal prompts
    const patterns = [
      /The student has provided their answer for checking\. Please:[\s\S]*?complete answers!/,
      /The student is having difficulty and needs more hints\. IMPORTANT:[\s\S]*?70% of the answer!/,
      /The student has requested a complete answer\. This time[\s\S]*?100% of the answer!/,
      /You are a friendly and patient friend[\s\S]*?discover the rest!/,
      /IMPORTANT: You must NEVER give complete answers[\s\S]*?discover the rest!/,
      /RULE: Only hint 30-40% of the answer[\s\S]*?discover the rest!/,
      /RULE: Only hint an additional 20-30%[\s\S]*?70% of the answer!/,
      /RULE: Now you can give 100% of the answer!/,
      /RULE: Only evaluate and suggest[\s\S]*?complete answers!/,
      // Mathematics specific patterns
      /You are a skilled and encouraging mathematics companion[\s\S]*?next step should be\./,
      /You are an enthusiastic and supportive mathematics companion[\s\S]*?should come next!/,
      /You are an expert mathematics companion[\s\S]*?explain their next step\./,
      // English language specific patterns
      /You are an enthusiastic and supportive English language companion[\s\S]*?text or concept\./,
      /You are a sophisticated English language and literature companion[\s\S]*?interpretation further\./,
      /You are a warm and encouraging English companion[\s\S]*?notice or feel!/
    ];

    patterns.forEach(pattern => {
      text = text.replace(pattern, '');
    });
  }

  // Clean up any remaining formatting instructions
  text = text.replace(/\*\*Lưu ý:\*\*[\s\S]*?từ khóa quan trọng/g, '');
  text = text.replace(/\*\*Note:\*\*[\s\S]*?important keywords/g, '');

  // Clean up extra whitespace
  text = text.replace(/\n\s*\n\s*\n/g, '\n\n').trim();

  return text;
};

// Helper functions to get available options
const getAvailableSubjects = () => AVAILABLE_SUBJECTS;
const getAvailableLevels = () => AVAILABLE_LEVELS;
const getAvailableCourses = (educationLevel = null, subjectArea = null) => {
  if (educationLevel && AVAILABLE_COURSES[educationLevel]) {
    if (subjectArea && AVAILABLE_COURSES[educationLevel][subjectArea]) {
      return AVAILABLE_COURSES[educationLevel][subjectArea];
    }
    return AVAILABLE_COURSES[educationLevel];
  }
  return AVAILABLE_COURSES;
};

module.exports = {
  getPrompts,
  buildSystemInstruction,
  buildChatPrompt,
  buildContinuePrompt,
  buildFullAnswerPrompt,
  buildCurrentQuestionReminder,
  buildCheckAnswerPrompt,
  normalizeMathAnswer,
  filterInternalPrompt,
  getAvailableSubjects,
  getAvailableLevels,
  getAvailableCourses,
  AVAILABLE_SUBJECTS,
  AVAILABLE_LEVELS,
  AVAILABLE_COURSES,
}; 
