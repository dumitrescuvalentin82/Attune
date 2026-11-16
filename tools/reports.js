'use strict';
// Moderation: lists reports filed by users.   node tools/reports.js
const path = require('path');
const { Store } = require('../lib/store');
const store = new Store(process.env.ATTUNE_DATA || path.join(__dirname, '..', 'storage'));
const reports = store.all('reports');
if (!reports.length) console.log('No reports.');
for (const r of reports) {
  const by = store.get('users', r.by), about = store.get('users', r.about);
  console.log(`${r.at}  ${by ? by.email : '(deleted)'}  reported  ${about ? `${about.name} <${about.email}>` : '(deleted)'}\n    ${r.reason || '(no reason given)'}\n`);
}
