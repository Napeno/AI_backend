// Import language files
const enMessages = require('../../locales/en.json');
const viMessages = require('../../locales/vi.json');

const getMessages = (language = 'en') => {
    return language === 'vi' ? viMessages : enMessages;
};

// Helper function to check if a message is an internal prompt
const checkIfInternalPrompt = (message, language) => {
  if (language === 'vi') {
    const patterns = [
      /Bạn là một người thầy thân thiện và kiên nhẫn/,
      /Học sinh đang gặp khó khăn và cần thêm gợi ý/,
      /QUAN TRỌNG: Bạn KHÔNG BAO GIỜ được trả lời hết đáp án/,
      /QUY TẮC: Chỉ gợi ý/,
      /Student is having difficulty and needs more hints/
    ];
    
    return patterns.some(pattern => pattern.test(message));
  } else {
    const patterns = [
      /You are a friendly and patient teacher/,
      /The student is having difficulty and needs more hints/,
      /IMPORTANT: You must NEVER give complete answers/,
      /RULE: Only hint/,
      /Student is having difficulty and needs more hints/
    ];
    
    return patterns.some(pattern => pattern.test(message));
  }
};

// Utility function to remove duplicate messages
const removeDuplicateMessages = (history) => {
    const seen = new Set();
    return history.filter(msg => {
        const key = `${msg.role}-${msg.parts[0].text}`;
        if (seen.has(key)) {
            return false;
        }
        seen.add(key);
        return true;
    });
};

module.exports = {
    getMessages,
    checkIfInternalPrompt,
    removeDuplicateMessages,
}; 