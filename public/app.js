'use strict';
(() => {
  const LANG_NAMES = { en: 'English', ro: 'Română', fr: 'Français', de: 'Deutsch', es: 'Español', zh: '中文', hi: 'हिन्दी' };
  const state = { me: null, lang: 'en', strings: {}, meta: null, view: 'interview' };
  const app = document.getElementById('app'), top = document.getElementById('top');

  // ---- tiny helpers ---------------------------------------------------------
  const t = (key, vars) => {
    let s = state.strings[key] ?? key;
    for (const [k, v] of Object.entries(vars || {})) s = s.replace(`{${k}}`, v);
    return s;
  };
  // Builds DOM nodes; text is always inserted as text, never as HTML.
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === false || v == null) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'width') el.style.width = v;
      else if (k === 'left') el.style.left = v;
      else if (k === 'bg') el.style.background = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat(3)) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(kid));
    return el;
  }
  const mount = (el, ...kids) => el.replaceChildren(...kids.flat(3).filter((k) => k != null && k !== false));
  async function api(method, url, body) {
    const res = await fetch(url, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || 'generic'), { status: res.status, code: data.error || 'generic' });
    return data;
  }
  const errText = (e) => (state.strings[`err.${e.code}`] ? t(`err.${e.code}`) : t('err.generic'));
  const remember = (lang) => { try { localStorage.setItem('attune.lang', lang); } catch { /* storage unavailable */ } };
  const recall = () => { try { return localStorage.getItem('attune.lang'); } catch { return null; } };

  async function setLang(lang, persist) {
    if (!LANG_NAMES[lang]) lang = 'en';
    state.strings = await (await fetch(`/i18n/${lang}.json`)).json();
    state.lang = lang; document.documentElement.lang = lang; remember(lang);
    if (persist && state.me) state.me = await api('POST', '/api/me', { lang });
  }
  const partLabel = (key) => (state.strings[`part.${key}`] ? t(`part.${key}`) : `${t(`dim.${key}.lo`)} ↔ ${t(`dim.${key}.hi`)}`);

  // ---- chrome ---------------------------------------------------------------
  function renderTop() {
    const langSel = h('select', { 'aria-label': t('ui.set.language'), onchange: async (e) => { await setLang(e.target.value, true); go(state.view); } },
      Object.entries(LANG_NAMES).map(([k, v]) => h('option', { value: k, selected: k === state.lang }, v)));
    const tabs = state.me ? h('nav', null, ['interview', 'profile', 'matches', 'settings'].map((v) =>
      h('button', { class: v === state.view ? 'on' : '', onclick: () => go(v) }, t(`ui.nav.${v}`)))) : null;
    mount(top, h('div', { class: 'brand' }, 'Attune'), tabs, langSel,
      state.me ? h('button', { class: 'link', onclick: async () => { await api('POST', '/api/logout', {}); state.me = null; go('auth'); } }, t('ui.logout')) : null);
  }
  function go(view) {
    state.view = state.me ? view : 'auth';
    renderTop();
    views[state.view]().catch((e) => {
      if (e.status === 401) { state.me = null; return go('auth'); }
      mount(app, h('p', { class: 'error' }, errText(e)));
    });
    window.scrollTo(0, 0);
  }

  const views = {};

  // ---- sign in / sign up ----------------------------------------------------
  let authMode = 'register';
  views.auth = async () => {
    const error = h('p', { class: 'error', role: 'alert' });
    const field = (name, type, label, extra) => h('label', null, label, h('input', { name, type, required: true, ...extra }));
    const reg = authMode === 'register';
    const form = h('form', { class: 'stack', onsubmit: async (e) => {
      e.preventDefault(); error.textContent = '';
      const f = new FormData(e.target);
      const body = { email: f.get('email'), password: f.get('password') };
      if (reg) Object.assign(body, { name: f.get('name'), dob: f.get('dob'), city: f.get('city'), lang: state.lang, consentAdult: f.get('adult') === 'on', consentData: f.get('data') === 'on' });
      try { state.me = await api('POST', reg ? '/api/register' : '/api/login', body); await setLang(state.me.lang); go(state.me.complete ? 'matches' : 'interview'); }
      catch (err) { error.textContent = errText(err); }
    } },
      reg && field('name', 'text', t('ui.name'), { maxlength: 40, autocomplete: 'nickname' }),
      field('email', 'email', t('ui.email'), { autocomplete: 'email' }),
      field('password', 'password', t('ui.password'), { minlength: reg ? 10 : 1, autocomplete: reg ? 'new-password' : 'current-password' }),
      reg && field('dob', 'date', t('ui.dob')),
      reg && h('label', null, t('ui.city'), h('input', { name: 'city', type: 'text', maxlength: 60 })),
      reg && h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'adult', required: true }), h('span', null, t('ui.consentAdult'))),
      reg && h('label', { class: 'check' }, h('input', { type: 'checkbox', name: 'data', required: true }), h('span', null, t('ui.consentData'))),
      error,
      h('div', { class: 'row' },
        h('button', { class: 'btn', type: 'submit' }, t(reg ? 'ui.register' : 'ui.login')),
        h('button', { class: 'link', type: 'button', onclick: () => { authMode = reg ? 'login' : 'register'; go('auth'); } }, t(reg ? 'ui.haveAccount' : 'ui.noAccount'))));
    mount(app, h('h1', null, t('ui.tagline')), h('p', { class: 'muted' }, t('ui.intro')), h('div', { class: 'card' }, form));
  };

  // ---- interview ------------------------------------------------------------
  views.interview = async () => renderInterview(await api('GET', '/api/interview'));

  function renderInterview(iv) {
    if (iv.done) {
      state.me.complete = true;
      return mount(app, h('div', { class: 'card' },
        h('h1', null, t('ui.done.title')), h('p', null, t('ui.done.text')),
        h('div', { class: 'row' },
          h('button', { class: 'btn', onclick: () => go('profile') }, t('ui.seeProfile')),
          h('button', { class: 'btn ghost', onclick: () => go('matches') }, t('ui.seeMatches')))));
    }
    const q = iv.question;
    const send = async (value) => renderInterview(await api('POST', '/api/interview/answer', { id: q.id, value }));
    let title, hint = null, body;

    if (q.type === 'rating' || q.type === 'role') {
      title = t(q.sub ? `k.${q.cat}.${q.sub}` : `k.${q.cat}`);
      hint = (q.sub ? `${t(`k.${q.cat}`)} · ` : `${t(`kd.${q.cat}`)} `) + t(q.type === 'role' ? 'ui.kq.role' : 'ui.kq.rating');
    } else title = t(`q.${q.id}`);

    if (q.type === 'likert') {
      body = h('div', { class: 'opts scale' }, [1, 2, 3, 4, 5].map((v) => h('button', { class: 'opt', onclick: () => send(v) }, t(`ui.l${v}`))));
    } else if (q.type === 'rating') {
      body = h('div', { class: 'opts scale' }, ['limit', 'none', 'curious', 'enjoy', 'essential'].map((v) =>
        h('button', { class: `opt ${v === 'limit' ? 'limit' : ''}`, onclick: () => send(v) }, t(`ui.r.${v}`))));
    } else if (q.type === 'role') {
      body = h('div', { class: 'opts' }, ['give', 'receive', 'switch'].map((v) => h('button', { class: 'opt', onclick: () => send(v) }, t(`ui.role.${v}`))));
    } else if (q.type === 'single') {
      body = h('div', { class: 'opts' }, q.options.map((o) => h('button', { class: 'opt', onclick: () => send(o) }, t(`opt.${q.id}.${o}`))));
    } else if (q.type === 'multi') {
      const picked = new Set();
      const cont = h('button', { class: 'btn', disabled: true, onclick: () => send([...picked]) }, t('ui.next'));
      hint = q.max ? t('ui.pickUpTo', { n: q.max }) : t('ui.pickAny');
      body = h('div', null, h('div', { class: 'opts' }, q.options.map((o) => h('button', { class: 'opt', 'aria-pressed': 'false', onclick: (e) => {
        if (picked.has(o)) picked.delete(o); else if (!q.max || picked.size < q.max) picked.add(o);
        e.currentTarget.classList.toggle('on', picked.has(o)); e.currentTarget.setAttribute('aria-pressed', picked.has(o));
        cont.disabled = picked.size < (q.min || 1);
      } }, t(`opt.${q.id}.${o}`)))), cont);
    } else if (q.type === 'range') {
      const lo = h('input', { type: 'number', min: q.min, max: q.max, value: Math.max(q.min, state.me.age - 7), 'aria-label': t('ui.from') });
      const hi = h('input', { type: 'number', min: q.min, max: q.max, value: Math.min(q.max, state.me.age + 7), 'aria-label': t('ui.to') });
      body = h('div', null, h('div', { class: 'row opts' }, t('ui.from'), lo, t('ui.to'), hi),
        h('button', { class: 'btn', onclick: () => { const a = +lo.value, b = +hi.value; if (a >= q.min && b <= q.max && a <= b) send([a, b]); } }, t('ui.next')));
    }

    mount(app, 
      h('div', { class: 'section' }, t(`ui.sec.${q.section}`)),
      h('div', { class: 'depth', role: 'progressbar', 'aria-label': t('ui.depth'), 'aria-valuenow': Math.round(iv.progress * 100) }, h('i', { width: `${Math.round(iv.progress * 100)}%` })),
      iv.reason !== 'core' && h('div', { class: 'why' }, t(`ui.reason.${iv.reason}`)),
      h('p', { class: `question ${title.length > 160 ? 'long' : ''}` }, title),
      hint && h('p', { class: 'hint' }, hint),
      body,
      h('div', { class: 'foot' },
        iv.canBack ? h('button', { class: 'link', onclick: async () => renderInterview(await api('POST', '/api/interview/back', {})) }, `← ${t('ui.back')}`) : h('span'),
        q.skippable ? h('button', { class: 'link', onclick: () => send('__skip') }, t('ui.skip')) : null));
    const first = app.querySelector('.opt, input'); if (first) first.focus({ preventScroll: true });
  }

  // ---- portrait -------------------------------------------------------------
  views.profile = async () => {
    const p = await api('GET', '/api/profile');
    if (!p.answered) return mount(app, h('p', { class: 'muted' }, t('ui.profile.empty')));
    const out = [h('h1', null, state.me.name), h('p', { class: 'muted' }, t('ui.profile.private')),
      !p.complete && h('div', { class: 'why' }, t('ui.profile.incomplete')),
      h('p', { class: 'muted' }, `${t('ui.depth')}: ${Math.round(p.depth * 100)}%`)];

    // narrative
    const strong = [], mid = [];
    for (const d of state.meta.dims) {
      const v = p.dims[d.id]; if (!v) continue;
      if (Math.abs(v.score) >= 0.3) strong.push({ d, v }); else if (d.deep) mid.push({ d, v });
    }
    if (strong.length || mid.length) {
      out.push(h('h2', null, t('ui.profile.story')));
      for (const sec of ['mind', 'life', 'intimacy']) {
        const mine = strong.filter((x) => x.d.section === sec).sort((a, b) => Math.abs(b.v.score) - Math.abs(a.v.score));
        const mids = mid.filter((x) => x.d.section === sec && !['dom', 'sub'].includes(x.d.id));
        if (!mine.length && !mids.length) continue;
        out.push(h('h3', null, t(`ui.sec.${sec}`)), h('div', { class: 'story' },
          mine.map(({ d, v }) => h('p', null, t(`dim.${d.id}.${v.score > 0 ? 'nhi' : 'nlo'}`))),
          mids.map(({ d }) => h('p', null, t('ui.profile.mid', { lo: t(`dim.${d.id}.lo`), hi: t(`dim.${d.id}.hi`) })))));
      }
    }

    // scales
    out.push(h('h2', null, t('ui.profile.traits')));
    for (const sec of ['mind', 'life', 'intimacy']) {
      const rows = state.meta.dims.filter((d) => d.section === sec && p.dims[d.id]);
      if (!rows.length) continue;
      out.push(h('h3', null, t(`ui.sec.${sec}`)), rows.map((d) => {
        const s = p.dims[d.id].score;
        return h('div', { class: 'trait' },
          h('div', { class: 'ends' }, s <= -0.3 ? h('b', null, t(`dim.${d.id}.lo`)) : h('span', null, t(`dim.${d.id}.lo`)), s >= 0.3 ? h('b', null, t(`dim.${d.id}.hi`)) : h('span', null, t(`dim.${d.id}.hi`))),
          h('div', { class: 'track' }, h('i', { left: `${(s + 1) * 50}%` })));
      }));
    }

    // preference map
    out.push(h('h2', null, t('ui.profile.map')));
    if (!p.mapped) out.push(h('p', { class: 'muted' }, t('ui.profile.mapSkipped')));
    else {
      const limits = [];
      for (const k of state.meta.kinks) {
        const e = p.kinks[k.id]; if (!e) continue;
        if (e.r === 'limit') { limits.push(t(`k.${k.id}`)); continue; }
        if (e.r === 'none') continue;
        const chips = Object.entries(e.subs).map(([i, r]) => {
          if (r === 'limit') { limits.push(t(`k.${k.id}.${i}`)); return null; }
          if (r === 'none') return null;
          return h('span', { class: `chip ${r === 'curious' ? 'faint' : 'strong'}` }, t(`k.${k.id}.${i}`), ' ', h('small', null, `· ${t(`ui.r.${r}`)}`));
        });
        out.push(h('h3', null, `${t(`k.${k.id}`)} · ${t(`ui.r.${e.r}`)}${e.role ? ` · ${t(`ui.role.${e.role}`)}` : ''}`), h('div', { class: 'chips' }, chips));
      }
      if (limits.length) out.push(h('h3', null, t('ui.profile.limits')), h('div', { class: 'chips' }, limits.map((x) => h('span', { class: 'chip limit' }, x))));
    }
    mount(app, out);
  };

  // ---- matches --------------------------------------------------------------
  views.matches = async () => {
    if (!state.me.complete) {
      state.me = await api('GET', '/api/me');
      if (!state.me.complete) return mount(app, h('p', { class: 'muted' }, t('ui.match.needProfile')), h('button', { class: 'btn', onclick: () => go('interview') }, t('ui.nav.interview')));
    }
    const list = await api('GET', '/api/matches');
    if (!list.length) return mount(app, h('p', { class: 'muted' }, t('ui.match.none')));
    mount(app, list.map(matchCard));
  };

  function matchCard(m) {
    let card;
    const act = async (fn) => { try { await fn(); go('matches'); } catch (e) { card.append(h('p', { class: 'error' }, errText(e))); } };
    const bar = (label, v) => (v == null ? [] : [h('span', null, label), h('div', { class: 'track' }, h('i', { width: `${v}%`, bg: 'var(--accent)' })), h('span', null, `${v}%`)]);
    const report = h('div', { hidden: true },
      h('label', null, h('span', { class: 'muted' }, t('ui.match.blockReason')), h('textarea', { maxlength: 500 })),
      h('button', { class: 'btn quiet', onclick: (e) => act(() => api('POST', '/api/block', { id: m.id, report: true, reason: e.target.parentNode.querySelector('textarea').value })) }, t('ui.match.block')));
    card = h('div', { class: 'card' },
      h('div', { class: 'match-head' },
        h('div', { class: 'who' }, `${m.name}, ${m.age}`, m.city ? h('span', { class: 'muted' }, ` · ${m.city}`) : null),
        h('div', null, h('div', { class: 'score' }, `${m.overall}%`), h('div', { class: 'muted' }, `${m.certainty}% ${t('ui.match.certainty')}`))),
      m.mutual && h('div', { class: 'mutual' }, `${t('ui.match.mutual')}${m.contact ? ` — ${t('ui.match.contact')}: ${m.contact}` : ''}`),
      m.bio && h('p', null, m.bio),
      h('div', { class: 'bars' }, bar(t('ui.match.mind'), m.domains.mind), bar(t('ui.match.life'), m.domains.life), bar(t('ui.match.intimacy'), m.domains.intimacy)),
      m.strengths.length ? [h('h3', null, t('ui.match.strengths')), h('div', { class: 'chips' }, m.strengths.map((s) => h('span', { class: 'chip strong' }, partLabel(s.key), ' ', h('small', null, `· ${t(`ui.kind.${s.kind}`)}`))))] : null,
      m.frictions.length ? [h('h3', null, t('ui.match.frictions')), h('div', { class: 'chips' }, m.frictions.map((s) => h('span', { class: 'chip' }, partLabel(s.key))))] : null,
      m.shared ? (m.shared.length ? [h('h3', null, t('ui.match.shared')), h('div', { class: 'chips' }, m.shared.map((k) => h('span', { class: 'chip strong' }, t(`k.${k}`))))] : null)
        : (m.sharedCount ? h('p', { class: 'muted' }, t('ui.match.sharedCount', { n: m.sharedCount })) : null),
      h('div', { class: 'row' },
        m.liked ? h('span', { class: 'chip strong' }, t('ui.match.liked')) : h('button', { class: 'btn', onclick: () => act(() => api('POST', '/api/like', { id: m.id, like: true })) }, t('ui.match.like')),
        h('button', { class: 'btn quiet', onclick: () => act(() => api('POST', '/api/like', { id: m.id, like: false })) }, t('ui.match.pass')),
        h('button', { class: 'link', onclick: () => { report.hidden = !report.hidden; } }, t('ui.match.block'))),
      report);
    return card;
  }

  // ---- settings -------------------------------------------------------------
  views.settings = async () => {
    const note = h('span', { class: 'muted', role: 'status' });
    const bio = h('textarea', { maxlength: 600 }, state.me.bio || '');
    const contact = h('input', { type: 'text', maxlength: 120, value: state.me.contact || '' });
    const city = h('input', { type: 'text', maxlength: 60, value: state.me.city || '' });
    const delError = h('p', { class: 'error', role: 'alert' });
    const delPass = h('input', { type: 'password', autocomplete: 'current-password', 'aria-label': t('ui.set.deleteConfirm') });
    const delBox = h('div', { hidden: true, class: 'stack' }, h('p', null, t('ui.set.deleteConfirm')), h('div', { class: 'row' }, delPass,
      h('button', { class: 'btn', onclick: async () => { try { await api('POST', '/api/delete', { password: delPass.value }); state.me = null; go('auth'); } catch (e) { delError.textContent = errText(e); } } }, t('ui.set.delete'))), delError);
    const restartBox = h('div', { hidden: true }, h('p', null, t('ui.set.restartConfirm')),
      h('button', { class: 'btn', onclick: async () => { await api('POST', '/api/interview/restart', {}); state.me.complete = false; go('interview'); } }, t('ui.set.restart')));
    mount(app, 
      h('div', { class: 'card' }, h('form', { class: 'stack', onsubmit: async (e) => { e.preventDefault(); state.me = await api('POST', '/api/me', { bio: bio.value, contact: contact.value, city: city.value }); note.textContent = t('ui.set.saved'); } },
        h('label', null, t('ui.set.about'), bio), h('label', null, t('ui.set.contact'), contact), h('label', null, t('ui.city'), city),
        h('div', { class: 'row' }, h('button', { class: 'btn', type: 'submit' }, t('ui.set.save')), note))),
      h('div', { class: 'card' }, h('div', { class: 'row' },
        h('a', { class: 'btn ghost', href: '/api/export', download: 'my-attune-data.json' }, t('ui.set.export')),
        h('button', { class: 'btn quiet', onclick: () => { restartBox.hidden = !restartBox.hidden; } }, t('ui.set.restart')),
        h('button', { class: 'btn quiet', onclick: () => { delBox.hidden = !delBox.hidden; } }, t('ui.set.delete'))),
        restartBox, delBox));
  };

  // ---- start ----------------------------------------------------------------
  (async () => {
    state.meta = await (await fetch('/api/meta')).json();
    try { state.me = await api('GET', '/api/me'); } catch { state.me = null; }
    const nav = (navigator.language || 'en').slice(0, 2);
    await setLang(state.me ? state.me.lang : recall() || nav);
    go(state.me ? (state.me.complete ? 'matches' : 'interview') : 'auth');
  })();
})();
