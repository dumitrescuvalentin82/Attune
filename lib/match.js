'use strict';
/*
 * Matching. Three layers:
 *  1. Hard filters   - mutual orientation, mutual age range, deal-breakers.
 *  2. Domain scores  - mind, life, intimacy; each a confidence-weighted blend of
 *                      similarity (values, pace, desire) and complementarity
 *                      (attachment dynamics, lead/follow polarity, give/receive roles).
 *  3. Mutual score   - each person weights the domains by their own priorities;
 *                      the final figure is the geometric mean, so a match must
 *                      work from both sides.
 */
const { flatKinks } = require('./profile');
const { KINKS } = require('../data/bank');

const pos = (x) => Math.max(0, x);
const clamp01 = (x) => Math.max(0, Math.min(1, x));
const jaccard = (a = [], b = []) => {
  const A = new Set(a), B = new Set(b);
  const inter = [...A].filter((x) => B.has(x)).length;
  const uni = new Set([...A, ...B]).size;
  return uni ? inter / uni : 0;
};

// ---- 1. hard filters --------------------------------------------------------
function eligible(a, b) {
  const fa = a.profile.facts, fb = b.profile.facts;
  if (!fa.seeking || !fb.seeking || !fa.gender || !fb.gender) return false;
  if (!fa.seeking.includes(fb.gender) || !fb.seeking.includes(fa.gender)) return false;
  if (fa.agerange && (b.age < fa.agerange[0] || b.age > fa.agerange[1])) return false;
  if (fb.agerange && (a.age < fb.agerange[0] || a.age > fb.agerange[1])) return false;
  if (!(fa.intent || []).some((x) => (fb.intent || []).includes(x))) return false;
  const pair = (x, y, p, q) => (x === p && y === q) || (x === q && y === p);
  if (pair(fa.kids, fb.kids, 'want', 'no')) return false;
  if (pair(fa.structure, fb.structure, 'mono', 'nonmono')) return false;
  if (pair(fa.smoke, fb.smoke, 'no_strict', 'yes')) return false;
  return true;
}

// ---- 2. domain scores -------------------------------------------------------
function parts(pa, pb) {
  const da = pa.dims, db = pb.dims;
  const out = { mind: [], life: [], intimacy: [] };
  const both = (...ids) => ids.every((id) => da[id] && db[id]);
  const conf = (...ids) => Math.min(...ids.map((id) => Math.min(da[id].conf, db[id].conf)));
  const add = (domain, key, score, weight, kind) => out[domain].push({ key, score: clamp01(score), weight, kind });
  const similar = (domain, id, w) => {
    if (!both(id)) return;
    add(domain, id, 1 - Math.abs(da[id].score - db[id].score) / 2, w * conf(id), 'similar');
  };
  const level = (domain, id, w) => {       // the more both have of it, the better
    if (!both(id)) return;
    add(domain, id, ((da[id].score + db[id].score) / 2 + 1) / 2, w * conf(id), 'level');
  };

  // mind
  similar('mind', 'open', 1); similar('mind', 'consc', 0.8); similar('mind', 'extra', 0.5);
  level('mind', 'agree', 0.8); level('mind', 'stable', 0.8);
  similar('mind', 'closeness', 1.2); similar('mind', 'expressive', 0.6); similar('mind', 'conflict', 0.6);
  if (both('att_anx', 'att_avo')) {
    // The anxious-avoidant trap is the costliest pairing; shared insecurity costs a little.
    const trap = Math.max(pos(da.att_anx.score) * pos(db.att_avo.score), pos(db.att_anx.score) * pos(da.att_avo.score));
    const load = (pos(da.att_anx.score) + pos(da.att_avo.score) + pos(db.att_anx.score) + pos(db.att_avo.score)) / 4;
    add('mind', 'attach', 1 - 0.7 * trap - 0.3 * load, 1.4 * conf('att_anx', 'att_avo'), 'dynamic');
  }
  if (pa.facts.lovelang && pb.facts.lovelang) add('mind', 'lovelang', 0.35 + 0.65 * jaccard(pa.facts.lovelang, pb.facts.lovelang), 0.5, 'similar');

  // life
  similar('life', 'tradition', 1); similar('life', 'faith', 1); similar('life', 'ambition', 0.7);
  similar('life', 'spontaneity', 0.6); similar('life', 'social', 1); similar('life', 'family', 1);
  similar('life', 'spender', 0.7);
  add('life', 'intent', 0.4 + 0.6 * jaccard(pa.facts.intent, pb.facts.intent), 1.5, 'similar');
  if (pa.facts.kids && pb.facts.kids) add('life', 'kids', pa.facts.kids === pb.facts.kids ? 1 : 0.6, 1.2, 'similar');

  // intimacy
  similar('intimacy', 'libido', 1.5); similar('intimacy', 'sociosex', 1); level('intimacy', 'sexcomm', 0.6);
  similar('intimacy', 'intensity', 1); similar('intimacy', 'experiment', 1);
  if (pa.facts.structure && pb.facts.structure) add('intimacy', 'structure', pa.facts.structure === pb.facts.structure ? 1 : 0.65, 1.2, 'similar');
  if (both('dom', 'sub')) {
    // Polarity: +1 leads, -1 follows. Opposites complete each other; two leaders
    // or two followers leave a gap. A genuine switch adapts to either.
    const polA = (da.dom.score - da.sub.score) / 2, polB = (db.dom.score - db.sub.score) / 2;
    const swA = Math.min(pos(da.dom.score), pos(da.sub.score)), swB = Math.min(pos(db.dom.score), pos(db.sub.score));
    const gap = Math.abs(polA + polB) * (1 - 0.6 * Math.max(swA, swB));
    add('intimacy', 'power', 1 - gap, 1.5 * conf('dom', 'sub'), 'dynamic');
  }
  let shared = [];
  if (pa.mapped && pb.mapped) {
    const A = flatKinks(pa), B = Object.fromEntries(flatKinks(pb).map((k) => [k.key, k]));
    const roleCat = Object.fromEntries(KINKS.map((k) => [k.id, k.role]));
    let got = 0, wanted = 0, clashes = 0;
    for (const x of A) {
      const y = B[x.key];
      if (!y) { wanted += pos(x.v) * 0.5; continue; }       // other side's branch never opened
      if ((x.v >= 0.75 && y.v < 0) || (y.v >= 0.75 && x.v < 0)) clashes++;
      if (x.v > 0 || y.v > 0) wanted += Math.max(pos(x.v), pos(y.v));
      if (x.v > 0 && y.v > 0) {
        let fit = 1;
        if (roleCat[x.cat] && x.role && y.role) {
          const complementary = x.role === 'switch' || y.role === 'switch' || x.role !== y.role;
          fit = complementary ? 1 : 0.35;
        }
        got += Math.min(x.v, y.v) * fit;
        if (fit === 1) shared.push({ key: x.key, strength: Math.min(x.v, y.v) });
      }
    }
    const seen = new Set(A.map((k) => k.key));
    for (const y of Object.values(B)) if (!seen.has(y.key)) wanted += pos(y.v) * 0.5;
    const score = wanted === 0 ? 1 : got / wanted - Math.min(0.4, clashes * 0.1);
    add('intimacy', 'tree', score, wanted === 0 ? 0.8 : 1.6, 'dynamic');
  }
  shared = shared.sort((p, q) => q.strength - p.strength || (p.key.includes('.') ? 1 : -1)).slice(0, 8).map((s) => s.key);
  return { out, shared };
}

const blend = (list) => {
  const w = list.reduce((s, p) => s + p.weight, 0);
  return w > 0 ? list.reduce((s, p) => s + p.weight * p.score, 0) / w : null;
};

function domainWeights(profile) {
  const w = { mind: 0.35, life: 0.3, intimacy: 0.35 };
  for (const p of profile.facts.priority || []) w[p] += 0.2;
  return w;
}

// ---- 3. mutual score --------------------------------------------------------
function compatibility(a, b) {
  const { out, shared } = parts(a.profile, b.profile);
  const domains = { mind: blend(out.mind), life: blend(out.life), intimacy: blend(out.intimacy) };
  const directional = (profile) => {
    const w = domainWeights(profile);
    let s = 0, t = 0;
    for (const d of Object.keys(domains)) if (domains[d] !== null) { s += w[d] * domains[d]; t += w[d]; }
    return t ? s / t : 0;
  };
  const overall = Math.sqrt(directional(a.profile) * directional(b.profile));
  // How much we can trust the figure: both profiles deep, all three domains present.
  const certainty = Math.min(a.profile.depth, b.profile.depth) * (Object.values(domains).filter((x) => x !== null).length / 3);
  const all = [...out.mind, ...out.life, ...out.intimacy].filter((p) => p.weight >= 0.3);
  const impact = (p) => (p.score - 0.5) * p.weight;
  const strengths = all.filter((p) => p.score >= 0.78).sort((p, q) => impact(q) - impact(p)).slice(0, 4);
  const frictions = all.filter((p) => p.score <= 0.45).sort((p, q) => impact(p) - impact(q)).slice(0, 3);
  const pct = (x) => (x === null ? null : Math.round(x * 100));
  return {
    overall: pct(overall), certainty: pct(certainty),
    domains: { mind: pct(domains.mind), life: pct(domains.life), intimacy: pct(domains.intimacy) },
    strengths: strengths.map((p) => ({ key: p.key, kind: p.kind })),
    frictions: frictions.map((p) => ({ key: p.key, kind: p.kind })),
    shared,
  };
}

// candidates: [{ id, age, profile }]
function rank(me, candidates, limit = 30) {
  return candidates
    .filter((c) => c.id !== me.id && c.profile && c.profile.complete && eligible(me, c))
    .map((c) => ({ id: c.id, ...compatibility(me, c) }))
    .sort((p, q) => q.overall - p.overall)
    .slice(0, limit);
}

module.exports = { eligible, compatibility, rank };
