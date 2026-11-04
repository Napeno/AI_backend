const CHEMISTRY_KEYWORD = /(?:\bPTHH\b|phương\s*trình\s*hóa|cân\s*bằng\s*(?:phương\s*trình|PTHH)|phản\s*ứng(?:\s*hóa\s*học)?|dung\s*dịch|hiệu\s*suất\s*phản\s*ứng|axit|bazơ|muối|kim\s*loại|nguyên\s*tố|hóa\s*trị|phân\s*tử\s*gam|mol\b)/i;
const CHEMISTRY_FORMULA = /\b(?:HCl|HCL|H2SO4|HNO3|NaOH|KOH|MgCl2|MgCL2|Al2O3|AlCl3|AICI3|CuSO4|FeCl2|FeCl3|ZnCl2|CaCO3|CO2|H2O|O2|H2|N2|NH3|CH4|C2H5OH|P2O5|H3PO4)\b/i;
const CHEMISTRY_REACTION = /(?:^|[\s:])(?:[A-Z][a-z]?\d*(?:[A-Z][a-z]?\d*){0,4})\s*\+\s*(?:[A-Z][a-z]?\d*(?:[A-Z][a-z]?\d*){0,4}).{0,40}(?:->|→|=>|＝|=)/;
const SHORT_CHEMISTRY_PAIR = /^(?:CB\s+)?(?:PTHH\s*(?:sau)?[:\s]*)?(?:Mg|Al|Zn|Fe|Cu|Na|Ca|Ag|H2|O2|N2|CO2)\s*\+\s*(?:HCl|HCL|H2SO4|HNO3|O2|H2O|NaOH|KOH)\b/i;
const MATH_SIGNAL = /(?:phương\s*trình|biểu\s*thức|đại\s*số|hằng\s*đẳng\s*thức|khai\s*triển|rút\s*gọn|[0-9a-z]\s*[+\-−]\s*[0-9a-z].*=|[xyz]\s*\^|\d+x\b)/i;
const PHYSICS_SIGNAL = /(?:định\s*luật|vận\s*tốc|gia\s*tốc|lực|điện\s*trở|cường\s*độ\s*dòng|hiệu\s*điện\s*thế|công\s*suất|động\s*năng|thế\s*năng)/i;
const BIOLOGY_SIGNAL = /(?:tế\s*bào|quang\s*hợp|di\s*truyền|ADN|ARN|enzyme|hô\s*hấp\s*tế\s*bào|sin[hl]\s*học)/i;

const looksLikeChemistry = (text = '') => {
  const value = String(text || '').trim();
  if (!value) return false;
  return CHEMISTRY_KEYWORD.test(value)
    || CHEMISTRY_FORMULA.test(value)
    || CHEMISTRY_REACTION.test(value)
    || SHORT_CHEMISTRY_PAIR.test(value);
};

const looksLikePureMathPrompt = (text = '') => {
  const value = String(text || '');
  return /biểu\s*thức\s*đại\s*số|thay\s*giá\s*trị\s*\\?\(?\s*x\s*=|phương\s*trình\s*bậc|hằng\s*đẳng\s*thức|khai\s*triển\s*\(/i.test(value)
    && !looksLikeChemistry(value);
};

const inferSubjectFromContent = (text = '', educationLevel = 'middle') => {
  const value = String(text || '').trim();
  if (!value) return null;

  if (looksLikeChemistry(value)) {
    if (educationLevel === 'high') {
      return { subjectArea: 'natural_sciences', course: 'chemistry', reason: 'chemistry' };
    }
    return { subjectArea: 'natural_sciences', course: 'natural_sciences', reason: 'chemistry' };
  }

  if (PHYSICS_SIGNAL.test(value) && !MATH_SIGNAL.test(value)) {
    if (educationLevel === 'high') {
      return { subjectArea: 'natural_sciences', course: 'physics', reason: 'physics' };
    }
    return { subjectArea: 'natural_sciences', course: 'natural_sciences', reason: 'physics' };
  }

  if (BIOLOGY_SIGNAL.test(value) && !MATH_SIGNAL.test(value)) {
    if (educationLevel === 'high') {
      return { subjectArea: 'natural_sciences', course: 'biology', reason: 'biology' };
    }
    return { subjectArea: 'natural_sciences', course: 'natural_sciences', reason: 'biology' };
  }

  return null;
};

const subjectsMatch = (left = {}, right = {}) => {
  if (!left || !right) return false;
  if (left.subjectArea !== right.subjectArea) return false;
  if (!left.course || !right.course) return true;
  return left.course === right.course;
};

const alignConversationSubject = (conversation, text = '') => {
  if (!conversation) return null;
  const inferred = inferSubjectFromContent(
    text || conversation.problemContext?.sourceText || '',
    conversation.educationLevel || 'middle',
  );
  if (!inferred) return null;
  if (subjectsMatch(
    { subjectArea: conversation.subjectArea, course: conversation.course },
    inferred,
  )) return null;

  const previous = {
    subjectArea: conversation.subjectArea,
    course: conversation.course,
  };
  conversation.subjectArea = inferred.subjectArea;
  conversation.course = inferred.course;
  return { previous, next: inferred };
};

module.exports = {
  looksLikeChemistry,
  looksLikePureMathPrompt,
  inferSubjectFromContent,
  alignConversationSubject,
  subjectsMatch,
};
