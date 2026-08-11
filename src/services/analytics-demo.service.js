const crypto = require('crypto');
const { BASELINE_RISK_SCORE, calculateRiskScore, getRiskLevel } = require('./intervention.service');

const DEMO_VERSION = 2;
const LEVELS = ['elementary', 'middle', 'high'];
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

const buildScenarioEvents = (seed, riskLevel, start) => {
  const metrics = { hintRequests: 0, rapidHintRequests: 0, meaningfulAttempts: 0, correctAnswers: 0, fullAnswerRequests: 0, gateCompletions: 0, hasRevisedAfterFeedback: false, identifiedBlocker: false };
  const events = [event('baseline', start, BASELINE_RISK_SCORE)];
  let step = 1;
  const at = () => new Date(start.getTime() + step++ * 24 * 60 * 60 * 1000);
  const add = (type, details, change) => {
    change();
    events.push(event(type, at(), calculateRiskScore(metrics), details));
  };
  const hints = (count, rapid = 0) => Array.from({ length: count }, (_, index) => add('hint_requested', { isRapid: index < rapid }, () => {
    metrics.hintRequests += 1;
    if (index < rapid) metrics.rapidHintRequests += 1;
  }));
  const attempts = (count, correct = 0) => Array.from({ length: count }, (_, index) => add('answer_checked', { isMeaningfulAttempt: true, isCorrect: index < correct }, () => {
    metrics.meaningfulAttempts += 1;
    if (index < correct) metrics.correctAnswers += 1;
  }));
  const variant = Math.floor(randomFor(seed, 5) * 4);
  const variation = Math.floor(randomFor(seed, 6) * 3);

  if (riskLevel === 'red') {
    if (variant === 0) { hints(1 + variation); add('full_answer_requested', {}, () => { metrics.fullAnswerRequests += 1; }); }
    if (variant === 1) { hints(1 + variation); attempts(1); }
    if (variant === 2) { hints(2 + variation); }
    if (variant === 3) { hints(2 + variation, 1); attempts(1); add('gate_completed', {}, () => { metrics.gateCompletions += 1; }); }
  } else if (riskLevel === 'yellow') {
    if (variant === 0) attempts(1);
    if (variant === 1) { hints(1 + Math.min(variation, 1)); attempts(1, 1); }
    if (variant === 2) { hints(1 + Math.min(variation, 1)); attempts(1); add('gate_completed', {}, () => { metrics.gateCompletions += 1; }); add('blocker_identified', {}, () => { metrics.identifiedBlocker = true; }); }
    if (variant === 3) { hints(3, 1); attempts(2, 1); add('answer_revised', {}, () => { metrics.hasRevisedAfterFeedback = true; }); add('gate_completed', {}, () => { metrics.gateCompletions += 1; }); }
  } else {
    if (variant === 0) { hints(1); attempts(2, 2); add('answer_revised', {}, () => { metrics.hasRevisedAfterFeedback = true; }); add('gate_completed', {}, () => { metrics.gateCompletions += 1; }); add('gate_completed', {}, () => { metrics.gateCompletions += 1; }); add('blocker_identified', {}, () => { metrics.identifiedBlocker = true; }); }
    if (variant === 1) { attempts(2, 1); add('answer_revised', {}, () => { metrics.hasRevisedAfterFeedback = true; }); add('gate_completed', {}, () => { metrics.gateCompletions += 1; }); add('blocker_identified', {}, () => { metrics.identifiedBlocker = true; }); }
    if (variant === 2) { hints(2); attempts(2, 1); add('answer_revised', {}, () => { metrics.hasRevisedAfterFeedback = true; }); add('gate_completed', {}, () => { metrics.gateCompletions += 1; }); }
    if (variant === 3) { hints(1, 1); attempts(2, 2); add('answer_revised', {}, () => { metrics.hasRevisedAfterFeedback = true; }); add('gate_completed', {}, () => { metrics.gateCompletions += 1; }); add('gate_completed', {}, () => { metrics.gateCompletions += 1; }); }
  }

  return events;
};

const buildAnalyticsDemo = (userId, now = new Date()) => {
  const seed = String(userId);
  const levelRoll = randomFor(seed, 0);
  const riskLevel = levelRoll < 0.60 ? 'red' : levelRoll < 0.92 ? 'yellow' : 'green';
  const daysAgo = 5 + Math.floor(randomFor(seed, 2) * 20);
  const start = new Date(now);
  start.setDate(start.getDate() - daysAgo);
  const events = buildScenarioEvents(seed, riskLevel, start);
  const currentScore = events[events.length - 1].riskScore;

  return {
    version: DEMO_VERSION,
    seededAt: now,
    baselineScore: BASELINE_RISK_SCORE,
    currentScore,
    riskLevel: getRiskLevel(currentScore),
    educationLevel: LEVELS[Math.floor(randomFor(seed, 3) * LEVELS.length)],
    subjectArea: SUBJECTS[Math.floor(randomFor(seed, 4) * SUBJECTS.length)],
    events,
  };
};

module.exports = { DEMO_VERSION, buildAnalyticsDemo };
