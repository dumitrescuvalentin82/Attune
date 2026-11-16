'use strict';
/*
 * Local storage. Everything lives in ./storage on this machine and nowhere else.
 * Each collection is one file, encrypted with AES-256-GCM. The key is read from
 * the ATTUNE_KEY environment variable (64 hex chars) or generated on first run
 * into storage/secret.key - keep that file safe and OUT of your backups' folder.
 *
 * The interface (get / set / del / all) is deliberately tiny so this file can be
 * replaced by PostgreSQL or SQLite when the service outgrows a single machine.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class Store {
  constructor(dir) {
    this.dir = dir;
    fs.mkdirSync(dir, { recursive: true });
    this.key = this.loadKey();
    this.cache = {};
    this.timers = {};
  }

  loadKey() {
    if (process.env.ATTUNE_KEY) return Buffer.from(process.env.ATTUNE_KEY, 'hex');
    const file = path.join(this.dir, 'secret.key');
    if (!fs.existsSync(file)) fs.writeFileSync(file, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
    return Buffer.from(fs.readFileSync(file, 'utf8').trim(), 'hex');
  }

  file(name) { return path.join(this.dir, `${name}.enc`); }

  load(name) {
    if (this.cache[name]) return this.cache[name];
    let data = {};
    if (fs.existsSync(this.file(name))) {
      const raw = fs.readFileSync(this.file(name));
      const iv = raw.subarray(0, 12), tag = raw.subarray(12, 28), body = raw.subarray(28);
      const d = crypto.createDecipheriv('aes-256-gcm', this.key, iv);
      d.setAuthTag(tag);
      data = JSON.parse(Buffer.concat([d.update(body), d.final()]).toString('utf8'));
    }
    return (this.cache[name] = data);
  }

  flush(name) {
    clearTimeout(this.timers[name]);
    delete this.timers[name];
    if (!this.cache[name]) return;
    const iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv('aes-256-gcm', this.key, iv);
    const body = Buffer.concat([c.update(JSON.stringify(this.cache[name]), 'utf8'), c.final()]);
    const tmp = this.file(name) + '.tmp';
    fs.writeFileSync(tmp, Buffer.concat([iv, c.getAuthTag(), body]), { mode: 0o600 });
    fs.renameSync(tmp, this.file(name));
  }

  touch(name) { if (!this.timers[name]) this.timers[name] = setTimeout(() => this.flush(name), 150); }
  flushAll() { for (const n of Object.keys(this.cache)) this.flush(n); }

  get(name, id) { return this.load(name)[id]; }
  set(name, id, value) { this.load(name)[id] = value; this.touch(name); return value; }
  del(name, id) { delete this.load(name)[id]; this.touch(name); }
  all(name) { return Object.values(this.load(name)); }
  entries(name) { return Object.entries(this.load(name)); }
}

module.exports = { Store };
