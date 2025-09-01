// Import language files
const enPrompts = require('../locales/en.json');
const viPrompts = require('../locales/vi.json');

const getPrompts = (language = 'en') => {
  return language === 'vi' ? viPrompts : enPrompts;
};

const buildChatPrompt = (message, language = 'en') => {
  const prompts = getPrompts(language);
  return prompts.prompts.chat.replace('{{message}}', message);
};

const buildContinuePrompt = (language = 'en') => {
  const prompts = getPrompts(language);
  return prompts.prompts.continue;
};

const buildFullAnswerPrompt = (language = 'en') => {
  const prompts = getPrompts(language);
  return prompts.prompts.fullAnswer;
};

const buildCheckAnswerPrompt = (userAnswer, language = 'en') => {
  const prompts = getPrompts(language);
  return prompts.prompts.checkAnswer.replace('{{userAnswer}}', userAnswer);
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
      /IMPORTANT: You MUST NOT give the full answer[\s\S]*?60-70% of the answer!/
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
      /You are a friendly and patient teacher[\s\S]*?discover the rest!/,
      /IMPORTANT: You must NEVER give complete answers[\s\S]*?discover the rest!/,
      /RULE: Only hint 30-40% of the answer[\s\S]*?discover the rest!/,
      /RULE: Only hint an additional 20-30%[\s\S]*?70% of the answer!/,
      /RULE: Now you can give 100% of the answer!/,
      /RULE: Only evaluate and suggest[\s\S]*?complete answers!/
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

module.exports = {
  getPrompts,
  buildChatPrompt,
  buildContinuePrompt,
  buildFullAnswerPrompt,
  buildCheckAnswerPrompt,
  filterInternalPrompt,
}; 