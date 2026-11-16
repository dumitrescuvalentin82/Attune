'use strict';
/*
 * Creates simulated people so matching can be tried before real users arrive.
 *   node tools/seed.js 60        (run while the server is stopped)
 * Each simulated person has hidden "true" traits and answers the interview the
 * way such a person would, with a little human inconsistency. Password for all
 * of them: demo-password-1   Emails: demo1@example.test, demo2@example.test ...
 * Remove them with:  node tools/seed.js --clear
 */
const path = require('path');
const crypto = require('crypto');
const { Store } = require('../lib/store');
const engine = require('../lib/engine');
const profiler = require('../lib/profile');
const { DIMS, KINKS } = require('../data/bank');

const store = new Store(process.env.ATTUNE_DATA || path.join(__dirname, '..', 'storage'));
const arg = process.argv[2];
if (arg === '--clear') {
  let n = 0;
  for (const u of store.all('users')) if (u.demo) { store.del('users', u.id); n++; }
  store.flushAll(); console.log(`Removed ${n} simulated people.`); process.exit(0);
}

let seed = 20261116;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const gauss = () => (rnd() + rnd() + rnd() + rnd() - 2) / 1.2;          // roughly -1..1
const pick = (list, weights) => { let r = rnd() * weights.reduce((a, b) => a + b, 0); for (let i = 0; i < list.length; i++) if ((r -= weights[i]) < 0) return list[i]; return list[0]; };
const clamp = (x) => Math.max(-1, Math.min(1, x));
const NAMES = ['Alex', 'Mara', 'Ioana', 'Andrei', 'Sofia', 'Luca', 'Elena', 'Victor', 'Clara', 'Matei', 'Nora', 'Paul', 'Irina', 'David', 'Ana', 'Radu', 'Lea', 'Tudor', 'Emma', 'Noah', 'Mei', 'Arjun', 'Priya', 'Hugo', 'Ines', 'Jonas', 'Lena', 'Diego', 'Lucia', 'Wei'];
const CITIES = ['Bucharest', 'Cluj-Napoca', 'Ploiești', 'Brașov', 'Paris', 'Berlin', 'Madrid'];
const salt = crypto.randomBytes(16).toString('hex');
const pass = `${salt}:${crypto.scryptSync('demo-password-1', salt, 64).toString('hex')}`;

function person(n) {
  const truth = Object.fromEntries(DIMS.map((d) => [d.id, clamp(gauss())]));
  truth.sub = clamp(-0.6 * truth.dom + 0.6 * gauss());                    // lead and yield tend to oppose
  const kinky = truth.experiment > -0.2;
  const gender = pick(['woman', 'man', 'nonbinary'], [47, 47, 6]);
  const age = 20 + Math.floor(rnd() * 35);
  const facts = {
    gender, seeking: pick([['man'], ['woman'], ['woman', 'man'], ['woman', 'man', 'nonbinary']], gender === 'woman' ? [70, 8, 12, 10] : gender === 'man' ? [8, 70, 12, 10] : [10, 10, 30, 50]),
    agerange: [Math.max(18, age - 10), Math.min(99, age + 10)],
    intent: pick([['longterm'], ['longterm', 'dating'], ['dating', 'casual'], ['casual'], ['dating', 'friendship']], [30, 30, 20, 10, 10]),
    structure: pick(['mono', 'flexible', 'nonmono'], [60, 28, 12]), kids: pick(['want', 'open', 'no'], [35, 40, 25]),
    smoke: pick(['no_strict', 'no_ok', 'yes'], [35, 45, 20]), priority: pick([['mind'], ['mind', 'intimacy'], ['life'], ['intimacy'], ['mind', 'life']], [25, 25, 15, 15, 20]),
    lovelang: pick([['words', 'time'], ['touch', 'time'], ['acts'], ['touch'], ['gifts', 'words']], [25, 30, 15, 20, 10]),
  };
  const state = { answers: {}, order: [] };
  const taste = Object.fromEntries(KINKS.map((k) => [k.id, gauss() + (kinky ? 0.3 : -0.5) + (['power', 'bondage', 'impact'].includes(k.id) ? 0.5 * Math.max(Math.abs(truth.dom), Math.abs(truth.sub)) : 0)]));
  const rate = (x) => (x < -0.9 ? 'limit' : x < 0.1 ? 'none' : x < 0.5 ? 'curious' : x < 0.95 ? 'enjoy' : 'essential');
  for (let guard = 0; guard < 400; guard++) {
    const nx = engine.next(state.answers); if (!nx) break;
    const it = nx.item; let v;
    if (it.type === 'likert') v = Math.max(1, Math.min(5, Math.round(3 + 2 * clamp(truth[it.dim] * it.sign + 0.35 * gauss()))));
    else if (it.id === 'kgate') v = rnd() < 0.85 ? 'go' : 'skip';
    else if (it.type === 'rating') v = rate(taste[it.cat] + (it.sub ? 0.5 * gauss() : 0));
    else if (it.type === 'role') { const pol = truth.dom - truth.sub; v = pol > 0.35 ? 'give' : pol < -0.35 ? 'receive' : 'switch'; }
    else v = facts[it.id];
    engine.answer(state, it.id, v);
  }
  const dob = new Date(Date.UTC(new Date().getUTCFullYear() - age, Math.floor(rnd() * 12), 1 + Math.floor(rnd() * 27)));
  dob.setUTCFullYear(dob.getUTCFullYear() - 1);
  return { id: crypto.randomBytes(12).toString('hex'), demo: true, email: `demo${n}@example.test`, name: NAMES[n % NAMES.length], pass,
    dob: dob.toISOString().slice(0, 10), city: CITIES[Math.floor(rnd() * CITIES.length)], lang: 'en', bio: 'Simulated person for testing.', contact: `demo${n}@example.test`,
    created: new Date().toISOString(), consentAt: new Date().toISOString(), state, profile: profiler.build(state), likes: {}, blocked: [] };
}

const count = Math.max(1, Math.min(2000, parseInt(arg, 10) || 60));
const start = store.all('users').filter((u) => u.demo).length;
let questions = 0;
for (let i = 1; i <= count; i++) { const u = person(start + i); questions += u.profile.answered; store.set('users', u.id, u); }
store.flushAll();
console.log(`Created ${count} simulated people (average ${Math.round(questions / count)} questions each).`);
