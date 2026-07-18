const assert = require('node:assert/strict');
const test = require('node:test');
const { applyPracticeResult, getFallbackPractice } = require('../src/services/practice.service');

test('schedules successful practice reviews at 1, 3, then 7 days and marks mastery', () => {
  const item = { reviewCount: 0 };
  const now = new Date('2026-07-18T00:00:00.000Z');

  applyPracticeResult(item, true, now);
  assert.equal(item.status, 'reviewed');
  assert.equal(item.reviewCount, 1);
  assert.equal(item.nextReviewAt.toISOString(), '2026-07-19T00:00:00.000Z');

  applyPracticeResult(item, true, now);
  assert.equal(item.reviewCount, 2);
  assert.equal(item.nextReviewAt.toISOString(), '2026-07-21T00:00:00.000Z');

  applyPracticeResult(item, true, now);
  assert.equal(item.status, 'mastered');
  assert.equal(item.reviewCount, 3);
  assert.equal(item.nextReviewAt.toISOString(), '2026-07-25T00:00:00.000Z');
});

test('keeps an incorrect practice item due now without changing rewards', () => {
  const item = { reviewCount: 1, status: 'reviewed' };
  const now = new Date('2026-07-18T00:00:00.000Z');

  applyPracticeResult(item, false, now);

  assert.equal(item.status, 'needs_review');
  assert.equal(item.reviewCount, 1);
  assert.equal(item.nextReviewAt, now);
  assert.equal(item.coins, undefined);
  assert.equal(item.points, undefined);
});

test('provides a non-quiz fallback prompt for each saved blocker', () => {
  const practice = getFallbackPractice({ blocker: 'start' }, 'vi');

  assert.match(practice.prompt, /việc đầu tiên/);
  assert.match(practice.hint, /dữ kiện/);
});
