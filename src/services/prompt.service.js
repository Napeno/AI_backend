// Import language files
const enPrompts = require('../locales/en.json');
const viPrompts = require('../locales/vi.json');

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

const buildChatPrompt = (message, language = 'en', educationLevel, subjectArea, course = null) => {
  const prompts = getPrompts(language, educationLevel, subjectArea, course);
  return prompts.chat.replace('{{message}}', message);
};

const buildContinuePrompt = (language = 'en', educationLevel, subjectArea, course = null) => {
  const prompts = getPrompts(language, educationLevel, subjectArea, course);
  return prompts.continue;
};

const buildFullAnswerPrompt = (language = 'en', educationLevel, subjectArea, course = null) => {
  const prompts = getPrompts(language, educationLevel, subjectArea, course);
  return prompts.fullAnswer;
};

const buildCheckAnswerPrompt = (userAnswer, language = 'en', educationLevel, subjectArea, course = null) => {
  const prompts = getPrompts(language, educationLevel, subjectArea, course);
  return prompts.checkAnswer.replace('{{userAnswer}}', userAnswer);
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
  buildChatPrompt,
  buildContinuePrompt,
  buildFullAnswerPrompt,
  buildCheckAnswerPrompt,
  filterInternalPrompt,
  getAvailableSubjects,
  getAvailableLevels,
  getAvailableCourses,
  AVAILABLE_SUBJECTS,
  AVAILABLE_LEVELS,
  AVAILABLE_COURSES,
}; 