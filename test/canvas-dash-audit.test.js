// Canvas dashboard/in-course audit: real site and folders code, inert DOM, deterministic time and API replies.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const D = require('../defaults.js');
const P = require('../lib/page.js');
const F = require('../lib/folders.js');
const I18N = require('../lib/i18n.js');
const { El, matches } = require('./stand-in-dom.js');
const read = (f) => fs.readFileSync(require.resolve(`../${f}`), 'utf8');
const origin = 'https://audit.instructure.com';
const settle = async () => { for (let n = 0; n < 12; n++) await new Promise(setImmediate); };
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const course = (id = '31') => ({ id, name: `Course ${id}`, course_code: 'CODE', enrollments: [{ type: 'student', computed_current_score: 92 }] });
const modules = (completed = false) => [{ id: '96', items: [{ id: '97', completion_requirement: { type: 'must_mark_done', completed } }] }];

class E extends El {
  get nodeType() { return 1; }
  get childNodes() { return this.children; }
  get href() { return new URL(this.getAttribute('href') || '', origin).href; }
  set href(v) { this.setAttribute('href', v); }
  matches(sel) { return matches(this, sel); }
  getClientRects() { return this.isConnected && !this.hidden ? [this.getBoundingClientRect()] : []; }
  querySelectorAll(sel) {
    if (sel === 'a[href*="/courses/"]') return this.all().filter((e) => e.tagName === 'A' && e.getAttribute('href')?.includes('/courses/'));
    if (sel === ':scope > .ig-header > .ig-header-title') return this.children.filter((e) => e.className?.split(' ').includes('ig-header')).flatMap((e) => e.children.filter((c) => c.className?.split(' ').includes('ig-header-title')));
    return super.querySelectorAll(sel);
  }
}

const page = ({ where = '/', frame = '', parent = {}, enhance = {}, api = async (p) => p === '/users/self/profile' ? { id: '42' } : p === '/users/self/colors' ? {} : p.includes('/modules?') ? modules() : [course()], store = {}, session = new Map() } = {}) => {
  const doc = {}, make = (tag, props = {}, ...kids) => { const e = Object.assign(new E(tag, doc), props); e.append(...kids); return e; };
  doc.root = make('html'); doc.head = make('head'); doc.body = make('body'); doc.root.append(doc.head, doc.body);
  const events = new Map(), documentEvents = new Map(), observers = [], timers = new Map(), calls = [], loads = [], writes = [], storeListeners = [];
  let now = Date.UTC(2026, 9, 19), serial = 0;
  const listen = (map, type, fn) => { if (!map.has(type)) map.set(type, new Set()); map.get(type).add(fn); };
  const fire = (map, type, extra = {}) => { for (const fn of [...map.get(type) || []]) fn({ type, ...extra }); };
  Object.assign(doc, { documentElement: doc.root, activeElement: doc.body, hidden: false, visibilityState: 'visible', createElement: (tag) => make(tag),
    querySelector: (s) => doc.root.querySelector(s), querySelectorAll: (s) => doc.root.querySelectorAll(s), getElementById: (id) => doc.root.all().find((e) => e.id === id) || null,
    addEventListener: (type, fn) => listen(documentEvents, type, fn), removeEventListener: (type, fn) => documentEvents.get(type)?.delete(fn) });
  const local = { get: (keys, cb) => {
    const value = structuredClone(Object.fromEntries([keys].flat().map((k) => [k, store[k]])));
    if (cb) cb(value); else return Promise.resolve(value);
  }, set: async (patch) => { writes.push(patch); Object.assign(store, structuredClone(patch)); return true; } };
  const c = { document: doc, location: { origin, pathname: where }, URL, Intl, console, Promise, GZ_PAGE: P, GZ_FOLDERS: F, GZ_I18N: I18N, GZ_TABS_AUTO: D.GZ_TABS_AUTO,
    sessionStorage: { getItem: (k) => session.get(k) ?? null, setItem: (k, v) => session.set(k, String(v)) },
    fetch: async (url) => { const u = new URL(url), p = u.pathname.slice(7) + u.search; calls.push(p); const value = await api(p); return value instanceof Response ? value : new Response(JSON.stringify(value)); },
    Date: class extends Date { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } },
    addEventListener: (type, fn) => listen(events, type, fn), removeEventListener: (type, fn) => events.get(type)?.delete(fn),
    setTimeout: (fn, ms = 0) => { const id = ++serial; timers.set(id, { at: now + ms, fn }); return id; }, clearTimeout: (id) => timers.delete(id),
    MutationObserver: class { constructor(fn) { this.fn = fn; observers.push(this); } observe() {} disconnect() {} },
    requestAnimationFrame: (fn) => c.setTimeout(fn, 16),
    chrome: { runtime: { id: 'audit', sendMessage: (m) => F.change(m, { local }) }, storage: { local, onChanged: { addListener: (fn) => storeListeners.push(fn) } } },
  };
  c.window = c; c.top = frame ? parent : c; c.globalThis = c;
  const settings = D.GZ_SANITIZE({ enhance: { progress: true, hideFolders: false, ...enhance } });
  const input = { settings, observer: {}, links: [{}], solo: true, tabFrame: frame, html: doc.root, locale: () => 'en', t: (k, v) => I18N.t(k, v, 'en'),
    canvasCourseId: () => c.location.pathname.match(/^\/courses\/(\d+)(?:\/|$)/)?.[1], canvasCourseKey: (id) => id ? `canvas:${origin}/${id}` : null,
    need: async (f) => { loads.push(f); if (f === 'features/folders.js' && !c.GZ_FOLDER_UI) vm.runInContext(read(f), context); },
    setAttr: (k, v) => { if (v !== false && v != null && v !== '') doc.root.setAttribute(k, v === true ? '' : v); else doc.root.removeAttribute(k); },
    setVar: (k, v) => doc.root.style.setProperty(k, v), setCourseList: (list) => { input.courseList = list; }, courseList: {},
  };
  c.GZ_CTX = { site: 'canvas', t: input.t, settings: () => input.settings, on: () => !!input.observer && input.settings.enabled,
    canvasCourseId: input.canvasCourseId, profile: () => site.ctx.profile(), toggleOf: () => null };
  const context = vm.createContext(c);
  // Use the actual shared progress renderer as well as the Canvas orchestration.
  const content = read('content.js'), from = content.indexOf('  const drawProgress = '), to = content.indexOf('\n  };', from) + 5;
  input.capi = vm.runInContext(`${content.slice(content.indexOf('  const api = '), content.indexOf('  // The Canvas course this page'))} capi;`, context);
  input.drawProgress = vm.runInContext(`(() => { const locale = GZ_CTX.locale || (() => 'en'), t = GZ_CTX.t; ${content.slice(from, to)} return drawProgress; })()`, context);
  const site = vm.runInContext(read('content-canvas.js'), context)(input);
  const addModules = () => {
    const row = make('div', { className: 'context_module', id: 'context_module_96' }); row.dataset.moduleId = '96';
    const header = make('div', { className: 'ig-header' });
    for (const state of ['collapse_module_link', 'expand_module_link']) header.append(make('span', { className: `ig-header-title ${state}`, textContent: 'Unit 1' }));
    row.append(header);
    const list = make('div', { id: 'context_modules_sortable_container' }, row), container = make('div', { id: 'context_modules' }, list);
    doc.body.append(container); return { container, list, row };
  };
  const addCard = (id = '31') => {
    const subtitle = make('div', { className: 'ic-DashboardCard__header-subtitle', textContent: 'CODE' });
    const link = make('a', { href: `/courses/${id}` }, subtitle), header = make('div', { className: 'ic-DashboardCard__header' }, link);
    const card = make('div', { className: 'ic-DashboardCard' }, header); card.setAttribute('aria-label', `Course ${id}`); doc.body.append(card);
    return { card, subtitle, link, header };
  };
  const advance = async (ms) => { now += ms; for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.fn(); } await settle(); };
  return { site, input, c, doc, calls, loads, store, session, writes, addModules, addCard, advance, fire: (type, extra) => fire(events, type, extra),
    storageChanged: (key) => storeListeners.forEach((fn) => fn({ [key]: { newValue: store[key] } }, 'local')) };
};

test('dashboard grades and course recording share one in-flight courses request', async () => {
  const pending = deferred(), p = page({ api: (s) => s.startsWith('/courses?') ? pending.promise : {} });
  const { card, subtitle } = p.addCard();
  const record = p.site.record(); p.site.tagCards(); p.site.tagCards(); await settle();
  assert.equal(p.calls.filter((s) => s.startsWith('/courses?')).length, 1);
  pending.resolve([course()]); await record; await settle();
  assert.equal(subtitle.getAttribute('data-gz-grade'), '92%');
  assert.equal(card.querySelectorAll('.gz-card-grade').length, 1);
});

test('grade links survive repeated passes and native card replacement without duplicates', async () => {
  const p = page(), first = p.addCard(); p.site.tagCards(); await settle();
  const link = first.card.querySelector('.gz-card-grade');
  for (let i = 0; i < 4; i++) p.site.tagCards(); await settle();
  assert.equal(first.card.querySelector('.gz-card-grade'), link);
  assert.equal(link.href, `${origin}/courses/31/grades`);
  assert.equal(link.getAttribute('aria-label'), 'Grades for Course 31: 92%');
  first.card.remove(); const second = p.addCard(); p.site.tagCards(); await settle();
  assert.equal(second.card.querySelectorAll('.gz-card-grade').length, 1);
  assert.equal(p.calls.length, 1);
});

test('late grade replies do not paint after the Canvas observer stops', async () => {
  const pending = deferred(), p = page({ api: () => pending.promise }), { card, subtitle } = p.addCard();
  p.site.tagCards(); p.input.observer = null; pending.resolve([course()]); await settle();
  assert.equal(subtitle.getAttribute('data-gz-grade'), null); assert.equal(card.querySelector('.gz-card-grade'), null);
});

test('hidden and restricted grades never disclose a numeric chip', async () => {
  const hidden = { ...course('31'), hide_final_grades: true }, restricted = { ...course('32'), restrict_quantitative_data: true };
  const p = page({ api: async () => [hidden, restricted] }), a = p.addCard('31'), b = p.addCard('32');
  p.site.tagCards(); await settle();
  assert.equal(a.subtitle.getAttribute('data-gz-grade'), null); assert.equal(b.subtitle.getAttribute('data-gz-grade'), null);
  assert.equal(p.doc.querySelectorAll('.gz-card-grade').length, 0);
});

test('failed grade requests remain quiet and retry after the one-minute backoff', async () => {
  let attempts = 0; const p = page({ api: async () => { if (++attempts === 1) throw new Error('503'); return [course()]; } });
  const { subtitle } = p.addCard(); p.site.tagCards(); await settle();
  assert.equal(subtitle.getAttribute('data-gz-grade'), null);
  p.site.tagCards(); await settle(); assert.equal(attempts, 1);
  await p.advance(60000); p.site.tagCards(); await settle();
  assert.equal(attempts, 2); assert.equal(subtitle.getAttribute('data-gz-grade'), '92%');
});

test('profile requests are shared within a document and rejected requests can retry', async () => {
  let attempts = 0; const pending = deferred(), p = page({ api: () => ++attempts === 1 ? pending.promise : { id: '42' } });
  const a = p.site.ctx.profile(), b = p.site.ctx.profile(); assert.equal(a, b);
  pending.reject(new Error('503')); await assert.rejects(a, /503/);
  assert.equal((await p.site.ctx.profile()).id, '42'); assert.equal(attempts, 2);
});

test('hidden modules share the profile reader, repaint idempotently, and restore on stop', async () => {
  const key = F.key(origin, '42', '31'), p = page({ where: '/courses/31/modules', enhance: { progress: false, hideFolders: true }, store: { [key]: { ids: ['96'], show: false } } });
  const { row } = p.addModules(); await p.site.ctx.profile(); p.site.renderProgress(); await settle();
  assert.equal(row.getAttribute('data-gz-folder-hidden'), 'hide');
  assert.equal(p.calls.filter((s) => s === '/users/self/profile').length, 1);
  const eye = row.querySelector('.gz-folder-eye');
  for (let i = 0; i < 4; i++) p.site.renderProgress(); await settle();
  assert.equal(row.querySelector('.gz-folder-eye'), eye); assert.equal(row.querySelectorAll('.gz-folder-eye').length, 1);
  p.input.observer = null; p.site.stop();
  assert.equal(row.getAttribute('data-gz-folder-hidden'), null); assert.equal(p.doc.getElementById('gz-folder-style'), null);
});

test('hidden modules fail open on profile failure and recover on the next pass', async () => {
  let attempts = 0; const p = page({ where: '/courses/31/modules', enhance: { progress: false, hideFolders: true }, api: async () => { if (++attempts === 1) throw new Error('401'); return { id: '42' }; } });
  const { row } = p.addModules(); p.site.renderProgress(); await settle();
  assert.equal(row.querySelector('.gz-folder-eye'), null); assert.equal(row.getAttribute('data-gz-folder-hidden'), null);
  p.site.renderProgress(); await settle();
  assert.ok(row.querySelector('.gz-folder-eye')); assert.equal(attempts, 2);
});

test('module progress shares its in-flight request and reuses its rendered bar', async () => {
  const pending = deferred(), p = page({ where: '/courses/31/modules', api: () => pending.promise }); p.addModules();
  p.site.renderProgress(); p.site.renderProgress(); await settle(); assert.equal(p.calls.length, 1);
  pending.resolve(modules()); await settle(); const bar = p.doc.getElementById('gz-progress');
  assert.equal(bar.dataset.v, '0/1 en'); p.site.renderProgress(); assert.equal(p.doc.getElementById('gz-progress'), bar);
  p.input.settings.enhance.progress = false; p.site.renderProgress(); assert.equal(p.doc.getElementById('gz-progress'), null);
});

test('module progress retries after a failed Modules API request', async () => {
  let attempts = 0; const p = page({ where: '/courses/31/modules', api: async () => { if (++attempts === 1) throw new Error('503'); return modules(); } }); p.addModules();
  p.site.renderProgress(); await settle(); assert.equal(p.doc.getElementById('gz-progress'), null);
  for (let i = 0; i < 10; i++) { p.site.renderProgress(); await settle(); }
  assert.equal(attempts, 1, 'a failing Canvas is not asked again on every pass');
  await p.advance(60000); p.site.renderProgress(); await settle();
  assert.equal(attempts, 2, 'reqs must release a failed course so the already-evicted Modules promise can retry');
  assert.equal(p.doc.getElementById('gz-progress')?.dataset.v, '0/1 en');
});

test('module progress refreshes expired completion data after a BFCache restore', async () => {
  let completed = false; const p = page({ where: '/courses/31/modules', api: async () => modules(completed) }); p.addModules();
  p.site.renderProgress(); await settle(); assert.equal(p.doc.getElementById('gz-progress').dataset.v, '0/1 en');
  p.fire('pagehide', { persisted: true }); completed = true; await p.advance(300001);
  p.fire('pageshow', { persisted: true }); await settle();
  assert.equal(p.doc.getElementById('gz-progress').dataset.v, '1/1 en', 'restore must stop using expired reqs.progress without waiting for a mutation');
});

test('course frames reuse the top page course-list and color requests', async () => {
  let who = '42';
  const requests = [], api = async (s) => { requests.push(s); return s === '/users/self/colors' ? {} : s === '/users/self/profile' ? { id: who } : [course()]; };
  const top = page({ api }); await top.site.record();
  const frame = page({ api, where: '/courses/31/modules', frame: '31', parent: top.c, store: top.store, session: top.session }); await frame.site.record();
  assert.equal(frame.input.courseList[`canvas:${origin}/31`]?.name, 'Course 31');
  const counts = () => [requests.filter((s) => s.startsWith('/courses?')).length, requests.filter((s) => s === '/users/self/colors').length];
  assert.deepEqual(counts(), [1, 1], 'a registered course frame is solo too, but its parent already fetched these records');
  // Another account signed in since: its own courses, never the snapshot of the one before.
  who = '99';
  const other = page({ api, where: '/courses/31/modules', frame: '31', parent: top.c, store: top.store, session: top.session }); await other.site.record();
  assert.deepEqual(counts(), [2, 2]);
});

test('who is signed in is always Canvas\'s word, never the page\'s own storage', async () => {
  let profiles = 0; const api = async () => { profiles++; return { id: '42' }; }, top = page({ api }); await top.site.ctx.profile();
  top.session.set?.('gz-canvas-profile', JSON.stringify({ at: Date.now(), value: { id: '99' } }));
  const frame = page({ api, where: '/courses/31/modules', frame: '31', parent: top.c, store: top.store, session: top.session, enhance: { progress: false, hideFolders: true } });
  const { row } = frame.addModules(); frame.site.renderProgress(); await settle();
  assert.ok(row.querySelector('.gz-folder-eye'), 'the frame still needs usable hide-module controls');
  assert.equal(String((await frame.site.ctx.profile()).id), '42', 'a forged identity in sessionStorage is not used');
  assert.equal(profiles, 2, 'each page asks Canvas once');
});

test('dashboard course grades include courses beyond the first API page', async () => {
  const first = Array.from({ length: 100 }, (_, n) => course(String(n + 1)));
  const p = page({ api: async (s) => /[?&]page=2(?:&|$)/.test(s) ? [course('101')] : new Response(JSON.stringify(first), { headers: { Link: `<${origin}/api/v1/courses?per_page=100&page=2>; rel="next"` } }) });
  const { subtitle } = p.addCard('101'); p.site.tagCards(); await settle();
  assert.equal(subtitle.getAttribute('data-gz-grade'), '92%', 'a visible Dashboard course must not silently lose its grade because /courses was truncated at 100');
});

test('course pagination stays on this API and stops at cycles or twenty pages', async () => {
  for (const next of ['https://other.test/api/v1/courses?page=2', `${origin}/login`, 'http://[', `${origin}/api/v1/courses?page=2`, '?page=2']) {
    const p = page({ api: async () => new Response(JSON.stringify([course()]), { headers: { Link: `<${next}>; rel="next"` } }) });
    assert.equal((await p.site.ctx.canvasCourses()).length, next.endsWith('?page=2') && !next.includes('other.test') ? 2 : 1);
    assert.ok(p.calls.length <= 2, 'cyclic links must stop without refetching a visited page');
  }
  let n = 0;
  const p = page({ api: async () => new Response(JSON.stringify([course(String(++n))]), { headers: { Link: `<${origin}/api/v1/courses?page=${n + 1}>; rel="next"` } }) });
  assert.equal((await p.site.ctx.canvasCourses()).length, 20); assert.equal(n, 20);
});

test('first-paint strip uses the saved placement synchronously and tolerates blocked storage', () => {
  const p = page({ where: '/courses/31' }); p.c.sessionStorage = { getItem: () => 'below large' };
  p.site.paintTabs(); assert.equal(p.doc.root.getAttribute('data-gz-ctabs'), 'below large');
  p.c.sessionStorage.getItem = () => { throw new Error('blocked'); }; p.site.paintTabs();
  assert.equal(p.doc.root.getAttribute('data-gz-ctabs'), 'above medium'); assert.deepEqual(p.calls, []);
  p.input.settings.enhance.tabs = false; p.site.paintTabs(); assert.equal(p.doc.root.getAttribute('data-gz-ctabs'), null);
});

test('paintNav reserves room before lazy UI startup and leaves a live renderer in charge', () => {
  const p = page({ where: '/courses/31' }); const n = D.GZ_SANITIZE().nav;
  p.site.paintNav(n, ''); const words = p.doc.root.getAttribute('data-gz-navbar'); assert.ok(words);
  p.c.GZ_NAVBAR_UI = { live: () => true }; p.doc.root.setAttribute('data-gz-navbar', 'renderer-owned');
  p.site.paintNav(n, ''); assert.equal(p.doc.root.getAttribute('data-gz-navbar'), 'renderer-owned');
  assert.deepEqual(p.calls, []);
});
