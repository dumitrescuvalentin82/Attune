'use strict';
const { DIMS, CHOICES, KINKS, RATING } = require('../data/bank');
const engine = require('./engine');

function ageFrom(dob, now = new Date()) {
  const d = new Date(dob);
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return age;
}

// Turns raw answers into the stored profile.
function build(state) {
  const a = state.answers;
  const stats = engine.dimStats(a);
  const dims = {};
  let confSum = 0, confN = 0;
  for (const d of DIMS) {
    const s = stats[d.id];
    if (s.n === 0) continue;                 // declined
    dims[d.id] = { score: +s.score.toFixed(3), conf: +s.conf.toFixed(3), n: s.n };
    confSum += s.conf; confN++;
  }
  const facts = {};
  for (const c of CHOICES) if (a[c.id] !== undefined) facts[c.id] = a[c.id];

  const kinks = {};
  const mapped = a.kgate === 'go';
  if (mapped) {
    for (const k of KINKS) {
      const r = a[`k.${k.id}`];
      if (r === undefined || r === engine.SKIP) continue;
      const entry = { r, subs: {} };
      const role = a[`kr.${k.id}`];
      if (role && role !== engine.SKIP) entry.role = role;
      for (let i = 1; i <= k.subs; i++) {
        const sr = a[`k.${k.id}.${i}`];
        if (sr !== undefined && sr !== engine.SKIP) entry.subs[i] = sr;
      }
      kinks[k.id] = entry;
    }
  }
  return {
    complete: engine.next(a) === null,
    depth: confN ? +(confSum / confN).toFixed(3) : 0,
    answered: Object.keys(a).length,
    dims, facts, kinks, mapped,
  };
}

// Flat list of rated preference items: [{ key, cat, v, role }]
function flatKinks(profile) {
  const out = [];
  for (const k of KINKS) {
    const e = profile.kinks[k.id];
    if (!e) continue;
    out.push({ key: k.id, cat: k.id, v: RATING[e.r], role: e.role });
    for (const [i, r] of Object.entries(e.subs)) out.push({ key: `${k.id}.${i}`, cat: k.id, v: RATING[r], role: e.role });
  }
  return out;
}

module.exports = { build, flatKinks, ageFrom };
