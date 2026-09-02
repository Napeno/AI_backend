const assert = require('node:assert/strict');
const test = require('node:test');
const ThinkerService = require('../src/services/thinker.service');

test('builds a weekly journal with week-over-week self-attempt progress', () => {
  const now = new Date('2026-08-24T00:00:00.000Z');
  const conversations = [
    { dependencyEvents: [
      { type: 'answer_checked', at: '2026-08-20T00:00:00.000Z', rulesetVersion: 'v2', details: { isMeaningfulAttempt: true } },
      { type: 'hint_requested', at: '2026-08-20T00:01:00.000Z', rulesetVersion: 'v2', details: {} },
      { type: 'answer_checked', at: '2026-08-12T00:00:00.000Z', rulesetVersion: 'v2', details: { isMeaningfulAttempt: true } },
      { type: 'hint_requested', at: '2026-08-11T00:00:00.000Z', rulesetVersion: 'v2', details: {} },
    ] },
  ];
  const journal = ThinkerService.buildWeeklyJournal(conversations, now);
  assert.equal(journal.current.beforeHint, 1);
  assert.equal(journal.current.activities, 1);
  assert.equal(journal.current.rate, 100);
  assert.equal(journal.previous.rate, 0);
  assert.equal(journal.delta, 100);
});

test('requires a concrete correction to report an AI error', () => {
  assert.equal(ThinkerService.isConcreteCorrection('AI sai'), false);
  assert.equal(ThinkerService.isConcreteCorrection('Bước này phải là 2a + 2b vì công thức bình phương.'), true);
});

test('counts self-trial progress across conversations', () => {
  const events = (day) => [
    { type: 'answer_checked', at: `2026-08-${day}T00:00:00.000Z`, rulesetVersion: 'v2', details: { isMeaningfulAttempt: true } },
    { type: 'hint_requested', at: `2026-08-${day}T00:01:00.000Z`, rulesetVersion: 'v2', details: {} },
  ];
  assert.equal(ThinkerService.getSelfTrialStreak([
    { sessionId: 'one', dependencyEvents: events('01') },
    { sessionId: 'two', dependencyEvents: events('02') },
    { sessionId: 'three', dependencyEvents: events('03') },
  ]), 3);
});

test('chooses the next goal from the student context', () => {
  const goal = ThinkerService.buildNextWeeklyGoal({
    current: { activities: 2, beforeHint: 1, meaningfulWork: 2, rate: 50 },
    previous: { rate: 0 },
  }, [{ course: 'mathematics' }]);

  assert.equal(goal.area, 'Tự thử trước khi hỏi');
  assert.equal(goal.subject, 'Toán');
  assert.equal(goal.progress, 1);
  assert.equal(ThinkerService.getFallbackChallenges(goal).length, 3);
});

test('parses and validates generated challenges', () => {
  assert.equal(ThinkerService.parseChallenges('```json\n[{"title":"A","description":"B"}]\n```')[0].title, 'A');
  assert.throws(() => ThinkerService.parseChallenges('[{"title":"A"}]'), /Invalid challenge/);
});

test('counts a challenge only after its start time', () => {
  const challenge = { taskType: 'meaningful_attempt', target: 1 };
  const conversations = [{ sessionId: 'chat-1', dependencyEvents: [
    { type: 'answer_checked', at: '2026-08-31T23:59:00.000Z', rulesetVersion: 'v2', details: { isMeaningfulAttempt: true } },
    { type: 'answer_checked', at: '2026-09-01T00:01:00.000Z', rulesetVersion: 'v2', details: { isMeaningfulAttempt: true } },
  ] }];
  assert.equal(ThinkerService.getChallengeProgress(challenge, conversations, new Date('2026-09-01T00:00:00.000Z'), new Date('2026-09-02T00:00:00.000Z')), 1);
});

test('creates three app task types with badge rewards', () => {
  const goal = ThinkerService.buildNextWeeklyGoal({ current: { activities: 0, beforeHint: 0, meaningfulWork: 0, rate: 0 } }, []);
  const challenges = ThinkerService.normalizeChallenges(ThinkerService.getFallbackChallenges(goal), goal);
  assert.deepEqual(challenges.map(challenge => challenge.taskType), ['self_attempt', 'practice_correct', 'ai_tutor_completed']);
  assert.deepEqual(challenges.map(challenge => challenge.actionPath), ['/chat', '/practice', '/ai-tutor/library']);
  assert.ok(challenges.every(challenge => challenge.badgeCode));
});

test('tracks practice and AI Tutor task completion from their app records', () => {
  const from = new Date('2026-09-01T00:00:00.000Z');
  const to = new Date('2026-09-08T00:00:00.000Z');
  const practiceItems = [{ practice: { variants: [{ turns: [{ role: 'assistant', action: 'attempt', isCorrect: true, createdAt: '2026-09-02T00:00:00.000Z' }] }] } }];
  const lessons = [{ completed: true, completedAt: '2026-09-03T00:00:00.000Z' }];
  assert.equal(ThinkerService.getChallengeProgress({ taskType: 'practice_correct' }, [], from, to, { practiceItems }), 1);
  assert.equal(ThinkerService.getChallengeProgress({ taskType: 'ai_tutor_completed' }, [], from, to, { lessons }), 1);
});
