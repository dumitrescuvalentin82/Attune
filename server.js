'use strict';
/*
 * Attune - self-hosted profiling and matchmaking service.
 * Zero dependencies. Run:  node server.js     (Node.js 18 or newer)
 *
 * Environment:
 *   PORT            default 3000
 *   HOST            default 127.0.0.1 (this computer only). Use 0.0.0.0 on a server.
 *   ATTUNE_SECURE   set to 1 when served over HTTPS (marks the session cookie Secure)
 *   ATTUNE_KEY      64 hex chars; otherwise a key file is generated in ./storage
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Store } = require('./lib/store');
const engine = require('./lib/engine');
const profiler = require('./lib/profile');
const matcher = require('./lib/match');
const { SKIPPABLE, DIMS, KINKS } = require('./data/bank');

const PORT = +process.env.PORT || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const SECURE = process.env.ATTUNE_SECURE === '1';
const LANGS = ['en', 'ro', 'fr', 'de', 'es', 'zh', 'hi'];
const SESSION_DAYS = 14;
const store = new Store(process.env.ATTUNE_DATA || path.join(__dirname, 'storage'));

// ---- helpers ----------------------------------------------------------------
class HttpError extends Error { constructor(status, code) { super(code); this.status = status; this.code = code; } }
const fail = (status, code) => { throw new HttpError(status, code); };
const id = () => crypto.randomBytes(12).toString('hex');
const clean = (s, max) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);

function hashPassword(pw, salt = crypto.randomBytes(16).toString('hex')) {
  return `${salt}:${crypto.scryptSync(pw, salt, 64).toString('hex')}`;
}
function checkPassword(pw, stored) {
  const [salt, hash] = stored.split(':');
  const test = crypto.scryptSync(pw, salt, 64);
  return crypto.timingSafeEqual(test, Buffer.from(hash, 'hex'));
}

const attempts = new Map();              // brute-force guard: 10 tries / 10 min / address
function throttle(key) {
  const now = Date.now();
  const list = (attempts.get(key) || []).filter((t) => now - t < 600000);
  if (list.length >= 10) fail(429, 'too_many_attempts');
  list.push(now); attempts.set(key, list);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    if (!/^application\/json/.test(req.headers['content-type'] || '')) return reject(new HttpError(415, 'json_required'));
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > 100000) { reject(new HttpError(413, 'too_large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { reject(new HttpError(400, 'bad_json')); } });
    req.on('error', reject);
  });
}

function sessionUser(req) {
  const m = /(?:^|;\s*)attune=([a-f0-9]{48})/.exec(req.headers.cookie || '');
  if (!m) return null;
  const s = store.get('sessions', m[1]);
  if (!s || s.exp < Date.now()) return null;
  const user = store.get('users', s.uid);
  return user ? { user, token: m[1] } : null;
}
function setSession(res, uid) {
  const token = crypto.randomBytes(24).toString('hex');
  store.set('sessions', token, { uid, exp: Date.now() + SESSION_DAYS * 864e5 });
  res.setHeader('Set-Cookie', `attune=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_DAYS * 86400}${SECURE ? '; Secure' : ''}`);
}

const save = (user) => store.set('users', user.id, user);
const me = (u) => ({
  id: u.id, name: u.name, email: u.email, lang: u.lang, city: u.city, bio: u.bio, contact: u.contact,
  age: profiler.ageFrom(u.dob), complete: !!(u.profile && u.profile.complete),
});

function interviewView(user) {
  const n = engine.next(user.state.answers);
  const base = { progress: +engine.progress(user.state.answers).toFixed(3), canBack: user.state.order.length > 0 };
  if (!n) return { ...base, progress: 1, done: true };
  const it = n.item;
  return {
    ...base, done: false, reason: n.reason,
    question: { id: it.id, type: it.type, section: it.section, options: it.options, min: it.min, max: it.max,
      cat: it.cat, sub: it.sub, skippable: SKIPPABLE.has(it.section) && it.id !== 'kgate' },
  };
}

function refreshProfile(user) { user.profile = profiler.build(user.state); save(user); }

// ---- API --------------------------------------------------------------------
const routes = {
  'POST /api/register': async (req, res, body) => {
    throttle('reg:' + req.socket.remoteAddress);
    const email = clean(body.email, 200).toLowerCase();
    const name = clean(body.name, 40);
    const password = String(body.password || '');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail(400, 'bad_email');
    if (name.length < 2) fail(400, 'bad_name');
    if (password.length < 10) fail(400, 'weak_password');
    const dob = new Date(body.dob);
    if (isNaN(dob) || dob.getFullYear() < 1900) fail(400, 'bad_dob');
    if (profiler.ageFrom(dob) < 18) fail(403, 'adults_only');
    if (body.consentAdult !== true || body.consentData !== true) fail(400, 'consent_required');
    if (store.all('users').some((u) => u.email === email)) fail(409, 'email_taken');
    const user = save({
      id: id(), email, name, pass: hashPassword(password), dob: dob.toISOString().slice(0, 10),
      city: clean(body.city, 60), lang: LANGS.includes(body.lang) ? body.lang : 'en', bio: '', contact: '',
      created: new Date().toISOString(), consentAt: new Date().toISOString(),
      state: { answers: {}, order: [] }, profile: null, likes: {}, blocked: [],
    });
    setSession(res, user.id);
    return me(user);
  },

  'POST /api/login': async (req, res, body) => {
    throttle('login:' + req.socket.remoteAddress);
    const email = clean(body.email, 200).toLowerCase();
    const user = store.all('users').find((u) => u.email === email);
    if (!user || !checkPassword(String(body.password || ''), user.pass)) fail(401, 'bad_login');
    setSession(res, user.id);
    return me(user);
  },

  'POST /api/logout': async (req, res, body, s) => {
    store.del('sessions', s.token);
    res.setHeader('Set-Cookie', 'attune=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
    return {};
  },

  'GET /api/meta': async () => ({ langs: LANGS, dims: DIMS, kinks: KINKS }),

  'GET /api/me': async (req, res, body, s) => me(s.user),

  'POST /api/me': async (req, res, body, s) => {
    const u = s.user;
    if (body.lang !== undefined && LANGS.includes(body.lang)) u.lang = body.lang;
    if (body.city !== undefined) u.city = clean(body.city, 60);
    if (body.bio !== undefined) u.bio = clean(body.bio, 600);
    if (body.contact !== undefined) u.contact = clean(body.contact, 120);
    save(u);
    return me(u);
  },

  'GET /api/interview': async (req, res, body, s) => interviewView(s.user),

  'POST /api/interview/answer': async (req, res, body, s) => {
    try { engine.answer(s.user.state, String(body.id), body.value); }
    catch (e) { fail(400, e.message); }
    refreshProfile(s.user);
    return interviewView(s.user);
  },

  'POST /api/interview/back': async (req, res, body, s) => {
    engine.back(s.user.state);
    refreshProfile(s.user);
    return interviewView(s.user);
  },

  'POST /api/interview/restart': async (req, res, body, s) => {
    s.user.state = { answers: {}, order: [] };
    refreshProfile(s.user);
    return interviewView(s.user);
  },

  'GET /api/profile': async (req, res, body, s) => s.user.profile || profiler.build(s.user.state),

  'GET /api/matches': async (req, res, body, s) => {
    const u = s.user;
    if (!u.profile || !u.profile.complete) fail(409, 'profile_incomplete');
    const view = (x) => ({ id: x.id, age: profiler.ageFrom(x.dob), profile: x.profile });
    const pool = store.all('users').filter((x) => !u.blocked.includes(x.id) && !x.blocked.includes(u.id) && u.likes[x.id] !== false);
    return matcher.rank(view(u), pool.map(view)).map((m) => {
      const o = store.get('users', m.id);
      const mutual = u.likes[o.id] === true && o.likes[u.id] === true;
      // Specific shared preferences and contact details are revealed only after
      // both people have said yes. Before that, only the count is shown.
      const { shared, ...rest } = m;
      return {
        ...rest, name: o.name, age: profiler.ageFrom(o.dob), city: o.city, bio: o.bio,
        liked: u.likes[o.id] === true, mutual, sharedCount: shared.length,
        shared: mutual ? shared : undefined, contact: mutual ? o.contact : undefined,
      };
    });
  },

  'POST /api/like': async (req, res, body, s) => {
    const other = store.get('users', String(body.id));
    if (!other || other.id === s.user.id) fail(404, 'not_found');
    s.user.likes[other.id] = body.like === true;
    save(s.user);
    return { mutual: body.like === true && other.likes[s.user.id] === true };
  },

  'POST /api/block': async (req, res, body, s) => {
    const other = store.get('users', String(body.id));
    if (!other) fail(404, 'not_found');
    if (!s.user.blocked.includes(other.id)) s.user.blocked.push(other.id);
    delete s.user.likes[other.id];
    save(s.user);
    if (body.report) store.set('reports', id(), { at: new Date().toISOString(), by: s.user.id, about: other.id, reason: clean(body.reason, 500) });
    return {};
  },

  // GDPR: access / portability
  'GET /api/export': async (req, res, body, s) => {
    const { pass, ...rest } = s.user;
    res.setHeader('Content-Disposition', 'attachment; filename="my-attune-data.json"');
    return rest;
  },

  // GDPR: erasure
  'POST /api/delete': async (req, res, body, s) => {
    if (!checkPassword(String(body.password || ''), s.user.pass)) fail(401, 'bad_login');
    const uid = s.user.id;
    for (const [token, sess] of store.entries('sessions')) if (sess.uid === uid) store.del('sessions', token);
    for (const o of store.all('users')) {
      if (o.likes[uid] !== undefined || o.blocked.includes(uid)) {
        delete o.likes[uid]; o.blocked = o.blocked.filter((x) => x !== uid); save(o);
      }
    }
    store.del('users', uid);
    res.setHeader('Set-Cookie', 'attune=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
    return {};
  },
};
const PUBLIC = new Set(['POST /api/register', 'POST /api/login', 'GET /api/meta']);

// ---- static files -----------------------------------------------------------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' };
function serveStatic(req, res, pathname) {
  let rel = pathname === '/' ? '/index.html' : pathname;
  const root = rel.startsWith('/i18n/') ? __dirname : path.join(__dirname, 'public');
  const file = path.normalize(path.join(root, rel));
  if (!file.startsWith(root + path.sep) || !MIME[path.extname(file)] || !fs.existsSync(file)) {
    res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found');
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)], 'Cache-Control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
}

// ---- server -----------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  const { pathname } = new URL(req.url, 'http://x');
  if (!pathname.startsWith('/api/')) return req.method === 'GET' ? serveStatic(req, res, pathname) : (res.writeHead(405), res.end());
  res.setHeader('Cache-Control', 'no-store');
  try {
    const key = `${req.method} ${pathname}`;
    const handler = routes[key];
    if (!handler) fail(404, 'not_found');
    const session = sessionUser(req);
    if (!PUBLIC.has(key) && !session) fail(401, 'login_required');
    const body = req.method === 'POST' ? await readBody(req) : {};
    const result = await handler(req, res, body, session);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(result));
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status === 500) console.error(e);
    if (!res.headersSent) res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: e instanceof HttpError ? e.code : 'server_error' }));
  }
});

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { store.flushAll(); process.exit(0); });
process.on('exit', () => store.flushAll());

server.listen(PORT, HOST, () => console.log(`Attune is running:  http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`));
