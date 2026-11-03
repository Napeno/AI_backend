const LATEX_COMMANDS = new Set([
  'bar', 'begin', 'beta', 'bf', 'bigg', 'binom', 'bullet',
  'flat', 'forall', 'frac',
  'nabla', 'ne', 'neg', 'neq', 'newline', 'not', 'notin', 'nu',
  'rangle', 'rceil', 'rfloor', 'rho', 'right', 'rightarrow', 'rightarrowtail', 'rm',
  'tan', 'tau', 'text', 'textbf', 'textit', 'textrm', 'theta', 'times', 'to', 'top', 'triangle',
  'uparrow', 'updownarrow', 'upsilon',
]);

const formulaRule = (language = 'vi') => (language === 'vi'
  ? 'Khi viết công thức, dùng ký tự Unicode (→, ₂, ², ×) hoặc bọc trong \\( ... \\). Trong JSON, mọi dấu \\ của LaTeX phải viết thành \\\\.'
  : 'Write formulas with Unicode symbols (→, ₂, ², ×) or wrap them in \\( ... \\). In JSON, write every LaTeX backslash as \\\\.');

// Gemini often emits a single LaTeX backslash. JSON.parse then treats \r, \t,
// \f, \n and \b as control characters, so \rightarrow becomes a carriage return
// plus "ightarrow". Double only the backslash of a real command, and keep a
// genuine JSON escape such as \n before ordinary text.
const escapeLatexBackslashes = (json) => {
  let result = '';
  for (let index = 0; index < json.length; index += 1) {
    const char = json[index];
    if (char !== '\\') {
      result += char;
      continue;
    }
    const next = json[index + 1] || '';
    const command = json.slice(index + 1).match(/^[A-Za-z]+/)?.[0] || '';
    if (next === '"' || next === '\\' || next === '/') {
      result += `\\${next}`;
      index += 1;
      continue;
    }
    if (LATEX_COMMANDS.has(command)) {
      result += '\\\\';
      continue;
    }
    if (next === 'u' && /^[0-9a-fA-F]{4}/.test(json.slice(index + 2, index + 6))) {
      result += json.slice(index, index + 6);
      index += 5;
      continue;
    }
    if ('bfnrt'.includes(next)) {
      result += `\\${next}`;
      index += 1;
      continue;
    }
    result += '\\\\';
  }
  return result;
};

const parseModelJson = (text, invalidMessage = 'Model returned invalid JSON') => {
  const value = String(text || '').replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  const objectAt = value.indexOf('{');
  const arrayAt = value.indexOf('[');
  const useArray = arrayAt !== -1 && (objectAt === -1 || arrayAt < objectAt);
  const open = useArray ? '[' : '{';
  const close = useArray ? ']' : '}';
  const first = value.indexOf(open);
  const last = value.lastIndexOf(close);
  if (first < 0 || last < first) throw new Error(invalidMessage);
  return JSON.parse(escapeLatexBackslashes(value.slice(first, last + 1)));
};

module.exports = { escapeLatexBackslashes, formulaRule, parseModelJson };
