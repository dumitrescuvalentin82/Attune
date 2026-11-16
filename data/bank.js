'use strict';
/*
 * Language-neutral question bank.
 * All wording lives in /i18n/<lang>.json under the same ids.
 *
 * Likert item:  { id, dim, sign }           answer 1..5  -> (v-3)/2 * sign
 * Tier 'core'  : always asked.
 * Tier 'probe' : asked only when the engine is not yet confident about a trait
 *                (too few answers, contradictory answers, or fence-sitting).
 */

// ---- Traits (continuous, -1 .. +1) -----------------------------------------
// deep:true => higher confidence threshold, so the engine always digs further.
const DIMS = [
  // mind
  { id: 'open',       section: 'mind' },
  { id: 'consc',      section: 'mind' },
  { id: 'extra',      section: 'mind' },
  { id: 'agree',      section: 'mind' },
  { id: 'stable',     section: 'mind' },
  { id: 'att_anx',    section: 'mind', deep: true },
  { id: 'att_avo',    section: 'mind', deep: true },
  { id: 'closeness',  section: 'mind', deep: true },
  { id: 'expressive', section: 'mind' },
  { id: 'conflict',   section: 'mind' },
  // life
  { id: 'tradition',  section: 'life' },
  { id: 'faith',      section: 'life' },
  { id: 'ambition',   section: 'life' },
  { id: 'spontaneity',section: 'life' },
  { id: 'social',     section: 'life' },
  { id: 'family',     section: 'life' },
  { id: 'spender',    section: 'life' },
  // intimacy
  { id: 'libido',     section: 'intimacy', deep: true },
  { id: 'sociosex',   section: 'intimacy' },
  { id: 'sexcomm',    section: 'intimacy' },
  { id: 'intensity',  section: 'intimacy' },
  { id: 'experiment', section: 'intimacy' },
  { id: 'dom',        section: 'intimacy', deep: true },
  { id: 'sub',        section: 'intimacy', deep: true },
];

// [dim, [sign of core1, core2, probe]]
const L = {
  open: [1, -1, 1], consc: [1, -1, 1], extra: [1, -1, 1], agree: [1, -1, 1],
  stable: [1, -1, -1], att_anx: [1, 1, 1], att_avo: [1, -1, 1],
  closeness: [1, -1, 1], expressive: [1, -1, 1], conflict: [1, -1, 1],
  tradition: [1, -1, 1], faith: [1, 1, -1], ambition: [1, -1, 1],
  spontaneity: [1, -1, 1], social: [1, -1, 1], family: [1, 1, -1],
  spender: [1, -1, 1],
  libido: [1, 1, -1], sociosex: [1, -1, 1], sexcomm: [1, -1, 1],
  intensity: [1, -1, 1], experiment: [1, -1, 1], dom: [1, 1, 1], sub: [1, 1, 1],
};

const LIKERT = [];
for (const d of DIMS) {
  L[d.id].forEach((sign, i) => {
    LIKERT.push({
      id: `${d.id}${i + 1}`, type: 'likert', dim: d.id, sign,
      tier: i < 2 ? 'core' : 'probe', section: d.section,
    });
  });
}

// ---- Categorical facts ------------------------------------------------------
const CHOICES = [
  { id: 'gender',    section: 'basics', type: 'single', options: ['woman', 'man', 'nonbinary'] },
  { id: 'seeking',   section: 'basics', type: 'multi',  options: ['woman', 'man', 'nonbinary'], min: 1 },
  { id: 'agerange',  section: 'basics', type: 'range',  min: 18, max: 99 },
  { id: 'intent',    section: 'basics', type: 'multi',  options: ['longterm', 'dating', 'casual', 'friendship'], min: 1 },
  { id: 'structure', section: 'basics', type: 'single', options: ['mono', 'flexible', 'nonmono'] },
  { id: 'kids',      section: 'basics', type: 'single', options: ['want', 'open', 'no'] },
  { id: 'smoke',     section: 'basics', type: 'single', options: ['no_strict', 'no_ok', 'yes'] },
  { id: 'priority',  section: 'basics', type: 'multi',  options: ['mind', 'life', 'intimacy'], min: 1 },
  { id: 'lovelang',  section: 'mind',   type: 'multi',  options: ['words', 'time', 'touch', 'acts', 'gifts'], min: 1, max: 2 },
];

// ---- Preference tree --------------------------------------------------------
// Each category is rated first; only categories rated "curious" or higher open
// their branch (role question where a role exists, then three specifics).
const RATING = { limit: -1, none: 0, curious: 0.4, enjoy: 0.75, essential: 1 };
const ROLES = ['give', 'receive', 'switch'];
const KINKS = [
  { id: 'power',     role: true,  subs: 3 },
  { id: 'bondage',   role: true,  subs: 3 },
  { id: 'impact',    role: true,  subs: 3 },
  { id: 'sensation', role: true,  subs: 3 },
  { id: 'rough',     role: true,  subs: 3 },
  { id: 'verbal',    role: true,  subs: 3 },
  { id: 'roleplay',  role: false, subs: 3 },
  { id: 'exhib',     role: false, subs: 3 },
  { id: 'group',     role: false, subs: 3 },
  { id: 'attire',    role: false, subs: 3 },
  { id: 'body',      role: false, subs: 3 },
  { id: 'sensual',   role: false, subs: 3 },
  { id: 'toys',      role: false, subs: 3 },
];

const TREE = [{ id: 'kgate', section: 'tree', type: 'single', options: ['go', 'skip'] }];
const opened = (catId) => (a) => a.kgate === 'go' && RATING[a[`k.${catId}`]] >= RATING.curious;
for (const k of KINKS) {
  TREE.push({ id: `k.${k.id}`, section: 'tree', type: 'rating', cat: k.id, requires: (a) => a.kgate === 'go' });
  if (k.role) TREE.push({ id: `kr.${k.id}`, section: 'tree', type: 'role', cat: k.id, requires: opened(k.id) });
  for (let i = 1; i <= k.subs; i++) {
    TREE.push({ id: `k.${k.id}.${i}`, section: 'tree', type: 'rating', cat: k.id, sub: i, requires: opened(k.id) });
  }
}

const SECTIONS = ['basics', 'life', 'mind', 'intimacy', 'tree'];
// Sections where "prefer not to say" is offered on every question.
const SKIPPABLE = new Set(['intimacy', 'tree']);

const ITEMS = [...CHOICES, ...LIKERT, ...TREE];
const BY_ID = Object.fromEntries(ITEMS.map((i) => [i.id, i]));

module.exports = { DIMS, ITEMS, BY_ID, SECTIONS, SKIPPABLE, KINKS, RATING, ROLES, CHOICES, LIKERT, TREE };
