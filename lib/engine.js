'use strict';
/*
 * The interviewing agent. No network, no model: a deterministic adaptive engine.
 *
 * For every trait it keeps an estimate and a confidence. Confidence grows with
 * each answer and shrinks when answers contradict each other or sit on the
 * fence. The agent keeps asking follow-ups until every trait it could measure
 * clears its threshold, and opens branches of the preference tree only where
 * the person showed interest.
 */
const { DIMS, ITEMS, BY_ID, SECTIONS, SKIPPABLE, RATING, ROLES } = require('../data/bank');

const SKIP = '__skip';
const THRESHOLD = 0.7;
const THRESHOLD_DEEP = 0.8;

function likertValue(item, v) { return ((v - 3) / 2) * item.sign; }

function dimStats(answers) {
  const out = {};
  for (const d of DIMS) {
    const vals = [];
    for (const it of ITEMS) {
      if (it.dim !== d.id) continue;
      const v = answers[it.id];
      if (v === undefined || v === SKIP) continue;
      vals.push(likertValue(it, v));
    }
    const n = vals.length;
    let score = 0, conf = 0, spread = 0, neutral = false;
    if (n) {
      score = vals.reduce((s, x) => s + x, 0) / n;
      spread = Math.max(...vals) - Math.min(...vals);
      neutral = vals.every((x) => x === 0);
      conf = 1 - Math.pow(0.5, n);                       // 0.50, 0.75, 0.875
      conf -= 0.25 * Math.max(0, spread - 0.5);           // contradiction
      if (neutral) conf -= 0.1;                           // fence-sitting
      conf = Math.max(0.05, Math.min(1, conf));
    }
    out[d.id] = { score, conf, n, spread, neutral, threshold: d.deep ? THRESHOLD_DEEP : THRESHOLD };
  }
  return out;
}

function applicable(item, answers) { return !item.requires || item.requires(answers); }

// Returns { item, reason } or null when the agent is satisfied.
function next(answers) {
  const stats = dimStats(answers);
  for (const section of SECTIONS) {
    for (const it of ITEMS) {
      if (it.section !== section || it.tier === 'probe') continue;
      if (answers[it.id] === undefined && applicable(it, answers)) return { item: it, reason: 'core' };
    }
    for (const d of DIMS) {
      if (d.section !== section) continue;
      const s = stats[d.id];
      if (s.n === 0 || s.conf >= s.threshold) continue;   // n===0: person declined this trait
      const probe = ITEMS.find((it) => it.dim === d.id && it.tier === 'probe' && answers[it.id] === undefined);
      if (probe) {
        const reason = s.spread > 0.5 ? 'contradiction' : s.neutral ? 'neutral' : 'depth';
        return { item: probe, reason };
      }
    }
  }
  return null;
}

function progress(answers) {
  const done = Object.keys(answers).length;
  let remaining = 0;
  const stats = dimStats(answers);
  for (const it of ITEMS) {
    if (answers[it.id] !== undefined) continue;
    if (it.tier === 'probe') {
      const s = stats[it.dim];
      if (s.n === 0 ? true : s.conf < s.threshold) remaining++;
    } else if (it.section !== 'tree') remaining++;
    else if (it.id === 'kgate' || (it.type === 'rating' && !it.sub && answers.kgate !== 'skip')) remaining++;
    else if (applicable(it, answers)) remaining++;
  }
  return done / Math.max(1, done + remaining);
}

// Validates a raw answer; returns the normalised value or throws.
function validate(item, value) {
  const bad = () => { throw new Error('invalid_answer'); };
  if (value === SKIP) { if (!SKIPPABLE.has(item.section) || item.id === 'kgate') bad(); return SKIP; }
  switch (item.type) {
    case 'likert': if (![1, 2, 3, 4, 5].includes(value)) bad(); return value;
    case 'single': if (!item.options.includes(value)) bad(); return value;
    case 'multi': {
      if (!Array.isArray(value)) bad();
      const v = [...new Set(value)];
      if (v.some((x) => !item.options.includes(x))) bad();
      if (v.length < (item.min || 0) || v.length > (item.max || item.options.length)) bad();
      return v;
    }
    case 'range': {
      if (!Array.isArray(value) || value.length !== 2) bad();
      const [lo, hi] = value.map(Number);
      if (!Number.isInteger(lo) || !Number.isInteger(hi) || lo < item.min || hi > item.max || lo > hi) bad();
      return [lo, hi];
    }
    case 'rating': if (!(value in RATING)) bad(); return value;
    case 'role': if (!ROLES.includes(value)) bad(); return value;
    default: bad();
  }
}

// Records an answer. Answers that no longer apply after a change are dropped.
function answer(state, id, value) {
  const item = BY_ID[id];
  if (!item) throw new Error('unknown_question');
  const expected = next(state.answers);
  if (!expected || expected.item.id !== id) throw new Error('out_of_order');
  state.answers[id] = validate(item, value);
  state.order.push(id);
}

function back(state) {
  const id = state.order.pop();
  if (id) delete state.answers[id];
  return id;
}

module.exports = { next, answer, back, progress, dimStats, validate, SKIP };
