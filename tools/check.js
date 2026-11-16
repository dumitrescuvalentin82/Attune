'use strict';
// Verifies that every language pack is valid and complete, and that every
// question in the bank has wording.   node tools/check.js
const fs = require('fs'), path = require('path');
const { ITEMS, DIMS, KINKS } = require('../data/bank');
const dir = path.join(__dirname, '..', 'i18n');
const packs = Object.fromEntries(fs.readdirSync(dir).map((f) => [f.slice(0, -5), JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))]));
const need = new Set(Object.keys(packs.en));
for (const it of ITEMS) {
  if (it.type === 'likert' || it.section === 'basics' || it.id === 'lovelang' || it.id === 'kgate') need.add(`q.${it.id}`);
  for (const o of it.options || []) need.add(`opt.${it.id}.${o}`);
  if (it.type === 'rating') need.add(it.id);
}
for (const d of DIMS) for (const s of ['lo', 'hi', 'nlo', 'nhi']) need.add(`dim.${d.id}.${s}`);
for (const k of KINKS) need.add(`kd.${k.id}`);
let bad = 0;
for (const [lang, p] of Object.entries(packs)) {
  const missing = [...need].filter((k) => !p[k] || !String(p[k]).trim());
  const extra = Object.keys(p).filter((k) => !need.has(k));
  const ph = Object.keys(packs.en).filter((k) => p[k] && (packs.en[k].match(/\{\w+\}/g) || []).sort().join() !== (p[k].match(/\{\w+\}/g) || []).sort().join());
  console.log(`${lang}: ${Object.keys(p).length} strings` + (missing.length ? `  MISSING ${missing}` : '') + (extra.length ? `  EXTRA ${extra}` : '') + (ph.length ? `  PLACEHOLDER ${ph}` : ''));
  bad += missing.length + extra.length + ph.length;
}
console.log(bad ? `\n${bad} problem(s)` : `\nAll ${Object.keys(packs).length} language packs complete (${need.size} strings each).`);
process.exit(bad ? 1 : 0);
