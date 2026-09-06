const crypto = require('crypto');
const { BASELINE_RISK_SCORE, getRiskLevel } = require('./intervention.service');

const DEMO_VERSION = 3;
const SUBJECTS = ['mathematics', 'natural_sciences', 'social_sciences', 'english_language'];

const randomFor = (seed, index = 0) => {
  const hash = crypto.createHash('sha256').update(`${seed}:${index}`).digest();
  return hash.readUInt32BE(0) / 0x100000000;
};

const event = (type, at, riskScore, details = {}) => ({
  type,
  at,
  riskScore,
  riskLevel: getRiskLevel(riskScore),
  details,
});

const buildAnalyticsDemo = (userId, now = new Date(), { frequent = false } = {}) => {
  const seed = String(userId);
  const start = new Date(now);
  if (frequent) start.setMonth(3, 1);
  else start.setMonth(7, 1);
  start.setHours(9, 0, 0, 0);

  const baselineScore = (frequent ? 64 : 52) + Math.floor(randomFor(seed, 1) * (frequent ? 25 : 39));
  const sessionCount = (frequent ? 16 : 3) + Math.floor(randomFor(seed, 2) * (frequent ? 12 : 5));
  const floorScore = (frequent ? 10 : 4) + Math.floor(randomFor(seed, 3) * (frequent ? 22 : 30));
  const span = Math.max(1, now.getTime() - start.getTime());
  let score = baselineScore;
  const events = [event('baseline', start, score)];

  for (let session = 0; session < sessionCount; session += 1) {
    const fraction = (session + 1) / (sessionCount + 1);
    const jitter = (randomFor(seed, 20 + session) - 0.5) * span / (sessionCount + 2);
    const sessionAt = new Date(Math.min(now.getTime(), start.getTime() + fraction * span + jitter));
    const hints = Math.floor(randomFor(seed, 50 + session) * (frequent ? 3 : 2));
    const meaningful = randomFor(seed, 80 + session) > 0.08;
    const correct = meaningful && randomFor(seed, 110 + session) < (frequent ? 0.68 : 0.58 + randomFor(seed, 140 + session) * 0.2);
    const details = { isMeaningfulAttempt: meaningful, isCorrect: correct };
    const hintCount = hints;

    for (let hint = 0; hint < hintCount; hint += 1) {
      score = Math.min(100, score + 2 + Math.floor(randomFor(seed, 170 + session * 3 + hint) * 5));
      events.push(event('hint_requested', new Date(sessionAt.getTime() - (hintCount - hint) * 12 * 60000), score, {
        isRapid: hint > 0 && randomFor(seed, 200 + session + hint) > 0.72,
      }));
    }

    if (randomFor(seed, 230 + session) > (frequent ? 0.94 : 0.88)) {
      score = Math.min(100, score + 8 + Math.floor(randomFor(seed, 240 + session) * 7));
      events.push(event('full_answer_requested', new Date(sessionAt.getTime() - 5 * 60000), score));
    }

    const progress = meaningful
      ? (correct ? 9 + Math.floor(randomFor(seed, 260 + session) * 8) : 3 + Math.floor(randomFor(seed, 270 + session) * 5))
      : 1;
    score = Math.max(0, score - progress);
    events.push(event('answer_checked', sessionAt, score, details));

    if (meaningful && randomFor(seed, 280 + session) > 0.58) {
      score = Math.max(0, score - 3 - Math.floor(randomFor(seed, 290 + session) * 5));
      events.push(event('gate_completed', new Date(sessionAt.getTime() + 20 * 60000), score));
    }
    if (correct && randomFor(seed, 300 + session) > 0.62) {
      score = Math.max(0, score - 2 - Math.floor(randomFor(seed, 310 + session) * 4));
      events.push(event('answer_revised', new Date(sessionAt.getTime() + 30 * 60000), score));
    }

    // Keep the demo visibly trending down while preserving varied session events.
    score = Math.max(floorScore, Math.min(score, baselineScore - session - 1));
  }

  events.sort((left, right) => new Date(left.at) - new Date(right.at));
  const currentEvent = events[events.length - 1];
  const currentScore = Math.max(floorScore, Math.min(currentEvent.riskScore, Math.max(0, baselineScore - (frequent ? 12 : 5))));
  currentEvent.riskScore = currentScore;
  currentEvent.riskLevel = getRiskLevel(currentScore);
  return {
    version: DEMO_VERSION,
    seededAt: now,
    baselineScore,
    currentScore,
    riskLevel: getRiskLevel(currentScore),
    educationLevel: 'middle',
    subjectArea: SUBJECTS[Math.floor(randomFor(seed, 4) * SUBJECTS.length)],
    events,
  };
};

module.exports = { DEMO_VERSION, buildAnalyticsDemo };
