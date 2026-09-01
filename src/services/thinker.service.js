const User = require('../models/user.model');
const Conversation = require('../models/conversation.model');
const { startChat, makeRequestWithRetry, extractResponseText } = require('./gemini.service');

const BADGES = [
  {
    code: 'self_trial_3',
    title: 'Ba lần tự thử',
    description: 'Tự thử làm 3 lần liên tiếp trước khi xin gợi ý.',
    icon: '🌱',
  },
  {
    code: 'ai_error_spotter',
    title: 'Mắt cú soi lỗi',
    description: 'Phát hiện và ghi lại một lỗi cụ thể trong phản hồi của AI.',
    icon: '🔎',
  },
];

const getBadgeDefinitions = () => BADGES;

const hasBadge = (user, code) => (user.badges || []).some(badge => badge.code === code);

const awardBadge = (user, code) => {
  if (!BADGES.some(badge => badge.code === code) || hasBadge(user, code)) return false;
  user.badges ??= [];
  user.badges.push({ code, earnedAt: new Date() });
  return true;
};

const getSelfTrialStreak = (conversations) => {
  const activities = conversations.flatMap(conversation => {
    const groups = new Map();
    (conversation.dependencyEvents || []).filter(event => event.rulesetVersion === 'v2').forEach(event => {
      const key = event.details?.problemKey || conversation.sessionId;
      groups.set(key, [...(groups.get(key) || []), event]);
    });
    return [...groups.values()].map(events => {
      const ordered = events.sort((a, b) => new Date(a.at) - new Date(b.at));
      const firstAttempt = ordered.find(event => event.type === 'answer_checked' && event.details?.isMeaningfulAttempt);
      const firstHint = ordered.find(event => event.type === 'hint_requested');
      return { at: firstAttempt?.at || firstHint?.at, triedFirst: Boolean(firstAttempt && (!firstHint || new Date(firstAttempt.at) < new Date(firstHint.at))) };
    });
  }).filter(activity => activity.at).sort((a, b) => new Date(a.at) - new Date(b.at));

  return activities.reduce((streak, activity) => activity.triedFirst ? streak + 1 : 0, 0);
};

const awardSelfTrialBadge = async (userId, conversation) => {
  const previousConversations = await Conversation.find({ user: userId, ...(conversation?.sessionId ? { sessionId: { $ne: conversation.sessionId } } : {}) }).select('sessionId dependencyEvents').lean();
  const streak = conversation
    ? Math.max(conversation.interventionMetrics?.bestSelfAttemptStreak || 0, getSelfTrialStreak([...previousConversations, conversation]))
    : getSelfTrialStreak(previousConversations);
  if (streak < 3) return null;
  const user = await User.findById(userId);
  if (!user || !awardBadge(user, 'self_trial_3')) return null;
  await user.save();
  return BADGES.find(badge => badge.code === 'self_trial_3');
};

const isConcreteCorrection = (value) => {
  const text = String(value || '').trim();
  return text.length >= 12 && (/\d|[=+\-*/^]/.test(text) || /\b(đúng|sai|phải|lỗi|because|correct|wrong)\b/i.test(text));
};

const validateAiCorrection = async ({ sourceText = '', aiResponse, correction, language = 'vi' }) => {
  const prompt = `Bạn là người kiểm tra chất lượng phản hồi AI trong học tập. Chỉ trả JSON hợp lệ: {"valid":true|false}.
Chỉ chọn true khi phản hồi AI có lỗi cụ thể và phần sửa của học sinh thực sự sửa đúng lỗi đó. Không chấm theo thiện cảm.
Đề bài: ${sourceText || '(không có)'}
Phản hồi AI: ${aiResponse}
Phát hiện của học sinh: ${correction}`;
  try {
    const chat = startChat([], language === 'vi'
      ? 'Chỉ trả JSON hợp lệ, không markdown.'
      : 'Return valid JSON only, no markdown.');
    const text = extractResponseText(await makeRequestWithRetry(() => chat.sendMessage(prompt)));
    const parsed = JSON.parse(String(text).replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim());
    return parsed?.valid === true;
  } catch (error) {
    console.error('AI correction validation failed:', error.message);
    return false;
  }
};

const awardAiErrorBadge = async (userId) => {
  const user = await User.findById(userId);
  if (!user || !awardBadge(user, 'ai_error_spotter')) return null;
  await user.save();
  return BADGES.find(badge => badge.code === 'ai_error_spotter');
};

const summarizeWindow = (conversations, from, to) => {
  let meaningful = 0;
  let hints = 0;
  let activities = 0;
  let beforeHint = 0;

  conversations.forEach((conversation, conversationIndex) => {
    const events = (conversation.dependencyEvents || [])
      .filter(event => event.rulesetVersion === 'v2')
      .filter(event => {
        const at = new Date(event.at);
        return at >= from && at < to;
      })
      .sort((a, b) => new Date(a.at) - new Date(b.at));
    const problems = new Map();
    events.forEach(event => {
      const key = event.details?.problemKey || `legacy-${conversationIndex}`;
      const group = problems.get(key) || [];
      group.push(event);
      problems.set(key, group);
    });
    problems.forEach(problemEvents => {
      activities += 1;
      meaningful += problemEvents.filter(event => event.type === 'answer_checked' && event.details?.isMeaningfulAttempt).length;
      hints += problemEvents.filter(event => event.type === 'hint_requested').length;
      const firstHint = problemEvents.find(event => event.type === 'hint_requested');
      const firstAttempt = problemEvents.find(event => event.type === 'answer_checked' && event.details?.isMeaningfulAttempt);
      if (firstAttempt && (!firstHint || new Date(firstAttempt.at) < new Date(firstHint.at))) beforeHint += 1;
    });
  });

  return { activities, meaningfulWork: meaningful, hints, beforeHint, rate: activities ? Math.round(beforeHint * 100 / activities) : 0 };
};

const buildWeeklyJournal = (conversations, now = new Date()) => {
  const start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const previousStart = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
  const current = summarizeWindow(conversations, start, now);
  const previous = summarizeWindow(conversations, previousStart, start);
  const delta = current.rate - previous.rate;
  const message = current.activities
    ? `Tuần này, bạn đã tự thử trước khi xin gợi ý trong ${current.beforeHint}/${current.activities} bài${delta ? ` — ${delta > 0 ? 'tăng' : 'giảm'} ${Math.abs(delta)} điểm phần trăm so với tuần trước` : ''}.`
    : 'Tuần này hãy thử viết một bước em đang nghĩ trước khi xin thêm gợi ý nhé.';
  return { from: start, to: now, current, previous, delta, message };
};

module.exports = {
  getBadgeDefinitions,
  awardSelfTrialBadge,
  awardAiErrorBadge,
  getSelfTrialStreak,
  isConcreteCorrection,
  validateAiCorrection,
  buildWeeklyJournal,
};
