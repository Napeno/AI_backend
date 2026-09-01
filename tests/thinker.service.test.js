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
