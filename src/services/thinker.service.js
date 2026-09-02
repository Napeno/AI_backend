const User = require('../models/user.model');
const Conversation = require('../models/conversation.model');
const PracticeItem = require('../models/practice-item.model');
const AiTutorLesson = require('../models/ai-tutor-question.model');
const { startChat, makeRequestWithRetry, extractResponseText } = require('./gemini.service');

const SUBJECT_LABELS = {
  mathematics: 'Toán',
  natural_sciences: 'Khoa học tự nhiên',
  social_sciences: 'Khoa học xã hội',
  english_language: 'Tiếng Anh',
  history: 'Lịch sử',
  geography: 'Địa lý',
  civics: 'Giáo dục công dân',
  literature: 'Ngữ văn',
  foreign_language: 'Ngoại ngữ',
};

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
  {
    code: 'challenge_self_attempt',
    title: 'Người tự khởi động',
    description: 'Hoàn thành thử thách tự thử trước khi xin gợi ý.',
    icon: '🏅',
  },
  {
    code: 'challenge_meaningful_attempt',
    title: 'Bền bỉ làm bài',
    description: 'Hoàn thành thử thách gửi bài làm có ý nghĩa trong Chat.',
    icon: '🏅',
  },
  {
    code: 'challenge_correct_answer',
    title: 'Săn đáp án đúng',
    description: 'Hoàn thành thử thách trả lời đúng trong Chat.',
    icon: '🏅',
  },
  {
    code: 'challenge_practice_mastery',
    title: 'Ôn tập đều tay',
    description: 'Hoàn thành task trả lời đúng trong Sổ tay ôn tập.',
    icon: '🏅',
  },
  {
    code: 'challenge_ai_tutor',
    title: 'Chinh phục AI Tutor',
    description: 'Hoàn thành một mini-lesson trong AI Tutor.',
    icon: '🏅',
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

const getFocusSubject = conversations => {
  const counts = new Map();
  conversations.forEach(conversation => {
    const subject = conversation.course || conversation.subjectArea;
    if (subject) counts.set(subject, (counts.get(subject) || 0) + 1);
  });
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
};

const buildNextWeeklyGoal = (journal, conversations = []) => {
  const { current } = journal;
  const subject = getFocusSubject(conversations);
  if (!current.activities) {
    return {
      area: 'Khởi động tư duy',
      title: 'Viết một bước trước khi hỏi',
      description: 'Mỗi khi gặp bài khó, hãy viết điều em đã biết hoặc bước đầu tiên em muốn thử.',
      target: 3,
      progress: 0,
      unit: 'bài',
      taskType: 'self_attempt',
      subject: subject ? SUBJECT_LABELS[subject] || subject : null,
    };
  }

  if (current.rate < 70) {
    return {
      area: 'Tự thử trước khi hỏi',
      title: 'Tự thử trước khi xin gợi ý',
      description: `Tuần tới hãy tự viết ít nhất một bước trong 3 bài${subject ? ` ${SUBJECT_LABELS[subject] || subject}` : ''} trước khi nhờ AI.`,
      target: 3,
      progress: Math.min(current.beforeHint, 3),
      unit: 'bài',
      taskType: 'self_attempt',
      subject: subject ? SUBJECT_LABELS[subject] || subject : null,
    };
  }

  return {
    area: 'Làm rõ cách nghĩ',
    title: 'Giải thích được vì sao',
    description: `Trong 3 bài${subject ? ` ${SUBJECT_LABELS[subject] || subject}` : ''}, hãy gửi một bước làm kèm lý do lựa chọn cách làm đó.`,
    target: 3,
    progress: Math.min(current.meaningfulWork, 3),
    unit: 'bài',
    taskType: 'meaningful_attempt',
    subject: subject ? SUBJECT_LABELS[subject] || subject : null,
  };
};

const CHALLENGE_TYPES = {
  self_attempt: {
    title: 'Tự thử trước khi hỏi',
    description: 'Trong Chat, hãy làm một bước có ý nghĩa trước khi bấm xin gợi ý.',
    actionLabel: 'Mở Chat',
    actionPath: '/chat',
    badgeCode: 'challenge_self_attempt',
    badgeTitle: 'Người tự khởi động',
    badgeDescription: 'Hoàn thành thử thách tự thử trước khi xin gợi ý.',
    icon: '✍️',
  },
  meaningful_attempt: {
    title: 'Gửi bài làm có ý nghĩa',
    description: 'Trong Chat, gửi phép tính, công thức hoặc lập luận của em để AI góp ý.',
    actionLabel: 'Mở Chat',
    actionPath: '/chat',
    badgeCode: 'challenge_meaningful_attempt',
    badgeTitle: 'Bền bỉ làm bài',
    badgeDescription: 'Hoàn thành thử thách gửi bài làm có ý nghĩa trong Chat.',
    icon: '💬',
  },
  correct_answer: {
    title: 'Kiểm tra và trả lời đúng',
    description: 'Trong Chat, thử làm bài rồi gửi đáp án để kiểm tra kết quả.',
    actionLabel: 'Mở Chat',
    actionPath: '/chat',
    badgeCode: 'challenge_correct_answer',
    badgeTitle: 'Săn đáp án đúng',
    badgeDescription: 'Hoàn thành thử thách trả lời đúng trong Chat.',
    icon: '✅',
  },
  practice_correct: {
    title: 'Làm đúng một bài ôn',
    description: 'Mở Sổ tay ôn tập và trả lời đúng một bài được giao.',
    actionLabel: 'Mở Sổ tay ôn tập',
    actionPath: '/practice',
    badgeCode: 'challenge_practice_mastery',
    badgeTitle: 'Ôn tập đều tay',
    badgeDescription: 'Hoàn thành task trả lời đúng trong Sổ tay ôn tập.',
    icon: '📘',
  },
  ai_tutor_completed: {
    title: 'Hoàn thành AI Tutor',
    description: 'Mở AI Tutor và hoàn thành một mini-lesson gồm các câu hỏi dẫn dắt.',
    actionLabel: 'Mở AI Tutor',
    actionPath: '/ai-tutor/library',
    badgeCode: 'challenge_ai_tutor',
    badgeTitle: 'Chinh phục AI Tutor',
    badgeDescription: 'Hoàn thành một mini-lesson trong AI Tutor.',
    icon: '📚',
  },
};

const getFallbackChallenges = goal => [
  { taskType: goal.taskType || 'self_attempt', target: 3, ...CHALLENGE_TYPES[goal.taskType || 'self_attempt'] },
  { taskType: 'practice_correct', target: 2, ...CHALLENGE_TYPES.practice_correct },
  { taskType: 'ai_tutor_completed', target: 1, ...CHALLENGE_TYPES.ai_tutor_completed },
];

const parseChallenges = text => {
  const cleaned = String(text || '').replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  const firstBracket = cleaned.indexOf('[');
  const lastBracket = cleaned.lastIndexOf(']');
  const parsed = JSON.parse(firstBracket === -1 ? cleaned : cleaned.slice(firstBracket, lastBracket + 1));
  const challenges = Array.isArray(parsed) ? parsed : parsed.challenges;
  if (!Array.isArray(challenges)) throw new Error('Invalid challenges schema');
  return challenges.slice(0, 3).map((challenge, index) => {
    const title = String(challenge.title || '').trim().slice(0, 120);
    const description = String(challenge.description || '').trim().slice(0, 300);
    if (!title || !description) throw new Error(`Invalid challenge at index ${index}`);
    return {
      title,
      description,
      taskType: String(challenge.taskType || '').trim(),
      target: Number(challenge.target),
      actionLabel: String(challenge.actionLabel || 'Mở Chat').trim().slice(0, 40),
      actionPath: '/chat',
      badgeTitle: String(challenge.badgeTitle || '').trim().slice(0, 120),
      badgeDescription: String(challenge.badgeDescription || '').trim().slice(0, 180),
      icon: String(challenge.icon || ['✍️', '💬', '✅'][index]).slice(0, 4),
    };
  });
};

const getChallengeProgress = (challenge, conversations, from, to, { practiceItems = [], lessons = [] } = {}) => {
  const events = conversations.flatMap(conversation => (conversation.dependencyEvents || [])
    .filter(event => event.rulesetVersion === 'v2')
    .filter(event => {
      const at = new Date(event.at);
      return at >= from && at < to;
    })
    .map(event => ({ ...event, sessionId: conversation.sessionId })));
  if (challenge.taskType === 'gate_completion') {
    return events.filter(event => event.type === 'gate_completed').length;
  }
  if (challenge.taskType === 'correct_answer') {
    return new Set(events.filter(event => event.type === 'answer_checked' && event.details?.isCorrect === true)
      .map(event => `${event.sessionId}:${event.details?.problemKey || 'main'}`)).size;
  }
  if (challenge.taskType === 'practice_correct') {
    return practiceItems.reduce((count, item) => count + (item.practice?.variants || []).some(variant => (variant.turns || []).some(turn => turn.role === 'assistant' && turn.action === 'attempt' && turn.isCorrect === true && new Date(turn.createdAt) >= from && new Date(turn.createdAt) < to)) ? 1 : 0, 0);
  }
  if (challenge.taskType === 'ai_tutor_completed') {
    return lessons.filter(lesson => lesson.completed && lesson.completedAt && new Date(lesson.completedAt) >= from && new Date(lesson.completedAt) < to).length;
  }
  const problems = new Map();
  events.forEach(event => {
    const key = `${event.sessionId}:${event.details?.problemKey || 'main'}`;
    problems.set(key, [...(problems.get(key) || []), event]);
  });
  return [...problems.values()].filter(problemEvents => {
    const attempts = problemEvents.filter(event => event.type === 'answer_checked' && event.details?.isMeaningfulAttempt);
    if (!attempts.length) return false;
    if (challenge.taskType === 'meaningful_attempt') return true;
    const firstHint = problemEvents.find(event => event.type === 'hint_requested');
    return !firstHint || new Date(attempts[0].at) < new Date(firstHint.at);
  }).length;
};

const getWeekKey = (date = new Date()) => {
  const monday = new Date(date);
  const day = monday.getUTCDay() || 7;
  monday.setUTCDate(monday.getUTCDate() - day + 1);
  return monday.toISOString().slice(0, 10);
};

const normalizeChallenges = (challenges, goal) => {
  const normalized = challenges.map((challenge, index) => {
    const type = CHALLENGE_TYPES[challenge.taskType] ? challenge.taskType : null;
    if (!type || !Number.isInteger(challenge.target) || challenge.target < 1 || challenge.target > 7) throw new Error(`Invalid challenge type at index ${index}`);
    const defaults = CHALLENGE_TYPES[type];
    return {
      code: `weekly_${type}`,
      taskType: type,
      target: challenge.target,
      title: challenge.title,
      description: challenge.description,
      actionLabel: challenge.actionLabel || defaults.actionLabel,
      actionPath: defaults.actionPath,
      badgeCode: defaults.badgeCode,
      badgeTitle: challenge.badgeTitle || defaults.badgeTitle,
      badgeDescription: challenge.badgeDescription || defaults.badgeDescription,
      icon: defaults.icon,
      area: goal.area,
    };
  });
  if (normalized.length !== 3 || new Set(normalized.map(challenge => challenge.taskType)).size !== 3) throw new Error('Challenges must contain three different app tasks');
  return normalized;
};

const generateWeeklyChallenges = async ({ journal, conversations = [], educationLevel = 'middle', language = 'vi' }) => {
  const goal = buildNextWeeklyGoal(journal, conversations);
  const fallback = normalizeChallenges(getFallbackChallenges(goal), goal);
  const subjects = [...new Set(conversations.map(conversation => {
    const subject = conversation.course || conversation.subjectArea;
    return subject ? SUBJECT_LABELS[subject] || subject : null;
  }).filter(Boolean))];
  const context = {
    educationLevel,
    subjects,
    area: goal.area,
    current: journal.current,
    previous: journal.previous,
  };

  try {
    const chat = startChat([], language === 'vi'
      ? 'Bạn là người thiết kế thử thách học tập ngắn cho từng học sinh. Chỉ trả JSON hợp lệ.'
      : 'You design short personalized learning challenges for one student. Return valid JSON only.');
    const prompt = `${language === 'vi' ? 'Tạo đúng 3 challenge bằng tiếng Việt.' : 'Create exactly 3 challenges in English.'}
Mục tiêu tuần tới: ${goal.title}. Khu vực: ${goal.area}.
Ngữ cảnh học sinh (chỉ dùng để cá nhân hóa, không phán xét): ${JSON.stringify(context)}
Mỗi challenge phải là một task thực hiện được trong app, không phải lời khuyên. Chỉ được dùng taskType: self_attempt (Chat: gửi bài làm có ý nghĩa trước gợi ý), meaningful_attempt (Chat: gửi bài làm có ý nghĩa), correct_answer (Chat: trả lời đúng khi kiểm tra), practice_correct (Sổ tay ôn tập: trả lời đúng), ai_tutor_completed (AI Tutor: hoàn thành mini-lesson). Mỗi challenge làm được trong 5-15 phút, khác nhau, cụ thể và hỗ trợ đúng khu vực mục tiêu.
Schema bắt buộc: [{"taskType":"self_attempt","target":3,"title":"...","description":"Học sinh cần làm gì trong app...","actionLabel":"Mở Chat","badgeTitle":"...","badgeDescription":"..."}]`;
    const text = extractResponseText(await makeRequestWithRetry(() => chat.sendMessage(prompt)));
    const challenges = parseChallenges(text);
    const normalized = normalizeChallenges(challenges, goal);
    return { goal, challenges: normalized, generatedBy: 'ai' };
  } catch (error) {
    console.error('Weekly challenge generation failed:', error.message);
    return { goal, challenges: fallback, generatedBy: 'fallback' };
  }
};

const addChallengeProgress = (plan, conversations, journal, sources = {}) => ({
  ...plan,
  goal: {
    ...plan.goal,
    progress: Math.min(plan.goal.target, getChallengeProgress(plan.goal, conversations, new Date(plan.startedAt || journal.to), new Date(journal.to), sources)),
  },
  challenges: plan.challenges.map(challenge => {
    const progress = Math.min(challenge.target, getChallengeProgress(challenge, conversations, new Date(plan.startedAt || journal.to), new Date(journal.to), sources));
    return { ...challenge, progress, completed: progress >= challenge.target };
  }),
});

const syncChallengeBadges = async (userId, plan) => {
  const user = await User.findById(userId);
  if (!user) return [];
  let changed = false;
  plan.challenges.forEach(challenge => {
    if (challenge.completed && awardBadge(user, challenge.badgeCode)) changed = true;
  });
  if (changed) await user.save();
  const earned = new Map((user.badges || []).map(badge => [badge.code, badge.earnedAt]));
  return getBadgeDefinitions().map(badge => ({ ...badge, earnedAt: earned.get(badge.code) || null }));
};

const awardChallengeBadges = async (userId, conversation = null) => {
  const user = await User.findById(userId).select('thinkingChallenges badges');
  const plan = user?.thinkingChallenges;
  if (!user || !plan?.weekKey || !plan.challenges?.length) return [];
  const currentConversation = conversation?.dependencyEvents ? conversation : null;
  const previous = await Conversation.find({ user: userId, ...(conversation?.sessionId ? { sessionId: { $ne: conversation.sessionId } } : {}) })
    .select('sessionId dependencyEvents').lean();
  const [practiceItems, lessons] = await Promise.all([
    PracticeItem.find({ user: userId }).select('practice').lean(),
    AiTutorLesson.find({ user: userId }).select('completed completedAt').lean(),
  ]);
  const now = new Date();
  const startedAt = new Date(plan.startedAt || `${plan.weekKey}T00:00:00.000Z`);
  const completed = addChallengeProgress(plan, [...previous, currentConversation].filter(Boolean), { from: startedAt, to: now }, { practiceItems, lessons })
    .challenges.filter(challenge => challenge.completed);
  const newlyAwarded = [];
  completed.forEach(challenge => {
    if (awardBadge(user, challenge.badgeCode)) newlyAwarded.push(BADGES.find(badge => badge.code === challenge.badgeCode));
  });
  if (newlyAwarded.length) await user.save();
  return newlyAwarded;
};

const getWeeklyChallenges = async ({ userId, conversations, journal, educationLevel = 'middle' }) => {
  const user = await User.findById(userId).select('thinkingChallenges').lean();
  const weekKey = getWeekKey(journal.to);
  const storedPlan = user?.thinkingChallenges;
  const isValidPlan = storedPlan?.weekKey === weekKey
    && storedPlan.version === 2
    && storedPlan.goal?.taskType
    && storedPlan.challenges?.length === 3
    && storedPlan.challenges.every(challenge => challenge.taskType && challenge.target && challenge.badgeCode);
  let plan = isValidPlan ? storedPlan : null;
  if (!plan) {
    const generated = await generateWeeklyChallenges({ journal, conversations, educationLevel });
    plan = { version: 2, weekKey, startedAt: new Date(), generatedBy: generated.generatedBy, goal: generated.goal, challenges: generated.challenges };
    await User.updateOne({ _id: userId }, { $set: { thinkingChallenges: plan } });
  }
  const [practiceItems, lessons] = await Promise.all([
    PracticeItem.find({ user: userId }).select('practice').lean(),
    AiTutorLesson.find({ user: userId }).select('completed completedAt').lean(),
  ]);
  const withProgress = addChallengeProgress(plan, conversations, journal, { practiceItems, lessons });
  const badges = await syncChallengeBadges(userId, withProgress);
  return { goal: withProgress.goal, challenges: withProgress.challenges, generatedBy: withProgress.generatedBy, badges };
};

module.exports = {
  getBadgeDefinitions,
  awardSelfTrialBadge,
  awardAiErrorBadge,
  getSelfTrialStreak,
  isConcreteCorrection,
  validateAiCorrection,
  buildWeeklyJournal,
  buildNextWeeklyGoal,
  generateWeeklyChallenges,
  getFallbackChallenges,
  parseChallenges,
  getChallengeProgress,
  getWeeklyChallenges,
  awardChallengeBadges,
  getWeekKey,
  normalizeChallenges,
  syncChallengeBadges,
};
