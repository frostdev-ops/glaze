const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const source = (file) => process.env.GZ_B7C_REVIEW_BASE
  ? require('node:child_process').execFileSync('git', ['show', `${process.env.GZ_B7C_REVIEW_BASE}:${file}`], { cwd: root, encoding: 'utf8' })
  : fs.readFileSync(path.join(root, file), 'utf8');
const moduleOf = (file) => {
  const Module = require('node:module'), m = new Module(path.join(root, file), module);
  m.filename = path.join(root, file); m.paths = module.paths; m._compile(source(file), m.filename); return m.exports;
};

test('the known Ultra entry provisionally blocks before a head marker or body exists, bounded to one second', () => {
  const sheets = [], timers = [];
  const head = { appendChild: (l) => { sheets.push(l); } };
  const document = { contentType: 'text/html', body: null, head, createElement: () => ({ attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, removeAttribute(k) { delete this.attrs[k]; } }) };
  const c = vm.createContext({ document, location: { pathname: '/ultra/course' }, chrome: { runtime: { getURL: (f) => `extension://${f}` } }, setTimeout: (fn, ms) => { timers.push({ fn, ms }); } });
  vm.runInContext(source('content-ultra.js'), c);
  assert.equal(sheets.length, 4);
  assert.ok(sheets.every((l) => l.attrs.blocking === 'render'));
  assert.ok(timers.every((t) => t.ms === 1000));
  vm.runInContext(source('content-ultra.js'), c); assert.equal(sheets.length, 4, 'duplicate injection reuses the gate');
  for (const t of timers) t.fn(); assert.ok(sheets.every((l) => !('blocking' in l.attrs)));
  document.body = {}; c.GZ_SITE_ULTRA.sheets = undefined; vm.runInContext(source('content-ultra.js'), c);
  assert.equal(sheets.length, 4, 'late injection never arms a render blocker');
  document.body = null; document.contentType = 'application/xml'; vm.runInContext(source('content-ultra.js'), c);
  assert.equal(sheets.length, 4, 'XML/error responses get no provisional styles');
});

test('bundled-logo CSS retains the original img accessible name', () => {
  const rule = source('theme.css').split('\n').find((line) => line.includes('header.themed-logo-background-primary-fill img {'));
  assert.match(rule, /opacity: 0/); assert.doesNotMatch(rule, /visibility: hidden|display: none/);
});

test('Dashboard first-paint rename preserves its React text wrapper and restores when disabled', () => {
  const src = source('content-ultra.js'), a = src.indexOf('  const renamed ='), b = src.indexOf('  const navObserver', a);
  assert.ok(a >= 0 && b > a, 'Dashboard lives in the initial script');
  const text = { data: 'Institution page' }, wrapper = { text }, classes = new Set(), attrs = new Map();
  const link = { isConnected: true, getAttribute: (k) => k === 'href' ? 'https://school.test/ultra/institution-page' : attrs.get(k) ?? null, setAttribute: (k, v) => attrs.set(k, v), removeAttribute: (k) => attrs.delete(k), querySelector: () => wrapper, classList: { toggle: (k, on) => on ? classes.add(k) : classes.delete(k) } };
  const I = { links: [1], settings: { enabled: true, enhance: { dashboard: true } } };
  const c = vm.createContext({ I, GZ_NAV: moduleOf('lib/nav.js'), NodeFilter: { SHOW_TEXT: 4 }, t: (s) => s, document: { querySelectorAll: () => [link], createTreeWalker: (w) => ({ nextNode: () => w.text }) } });
  const sync = vm.runInContext(src.slice(a, b) + '\nsyncDashboard;', c);
  sync(); assert.equal(text.data, 'Dashboard'); assert.equal(wrapper.text, text); assert.ok(classes.has('gz-nav-dashboard'));
  I.settings.enhance.dashboard = false; sync(); assert.equal(text.data, 'Institution page'); assert.ok(!classes.has('gz-nav-dashboard')); assert.equal(attrs.has('aria-label'), false);
});

test('absolute native links have the same item identity as relative links', () => {
  const N = moduleOf('lib/nav.js');
  assert.equal(N.native('https://school.test/ultra/grades?from=nav'), 'grades');
  assert.equal(N.native('/ultra/institution-page/'), 'institution-page');
  assert.equal(N.native('https://school.test/courses/1'), '');
});

test('editor writes keep the render-restored reorder or Show control focused', async () => {
  const src = source('options.js'), a = src.indexOf('  const writeNavItems ='), b = src.indexOf('  const move =', a);
  for (const wanted of ['Move down', 'Show']) {
    let focus = wanted;
    const c = vm.createContext({ N: { clean: (v) => v }, navItems: {}, chrome: { runtime: { sendMessage: (m, cb) => cb({ ok: true, items: m.items }) } }, renderNavItems: () => { focus = wanted; }, showNavPreview() {}, hint() {}, t: (s) => s, $: () => ({ querySelector: () => ({ focus: () => { focus = 'Move up'; } }) }) });
    const write = vm.runInContext(src.slice(a, b) + '\nwriteNavItems;', c);
    await write({}, 'calendar'); assert.equal(focus, wanted);
  }
});

test('a real page cannot drive the extension-only preview listener', () => {
  const line = source('features/nav.js').split('\n').find((s) => s.includes("addEventListener('message'"));
  let listener;
  const parent = {}, c = vm.createContext({ isPreview: false, config: 'original', active: false, location: { origin: 'https://school.test' }, parent, N: { clean: (v) => v }, addEventListener: (name, fn) => { listener = fn; } });
  vm.runInContext(line, c); listener({ origin: 'https://school.test', source: parent, data: { gzNavPreview: { hidden: ['grades'] } } });
  assert.equal(c.config, 'original');
});

test('Next due keeps an earlier item with no content id and uses its course outline', () => {
  const src = source('features/nav.js'), a = src.indexOf("      if (w.id === 'next') {"), b = src.indexOf("      if (w.id === 'timer'", a);
  const items = [{ title: 'Earlier', cid: '_1_1', content: null, at: 2000, due: 2000 }, { title: 'Later', cid: '_1_1', content: '_8_1', at: 4000, due: 4000 }];
  const box = { setAttribute() {}, removeAttribute() {} }, detail = {};
  const c = vm.createContext({ w: { id: 'next' }, now: 1000, node: { box, detail }, nextItems: items, nextError: false, local: { dueWeekFrom: 'https://school.test', dueWeek: items }, location: { origin: 'https://school.test' }, X: { t: (s) => s, locale: () => 'en' }, GZ_PAGE: { describe: () => ({ rel: 'soon' }) }, setText: (el, value) => { el.textContent = value; }, refreshNext() {} });
  vm.runInContext(src.slice(a, b), c);
  assert.match(detail.textContent, /^Earlier/); assert.equal(box.href, 'https://school.test/ultra/courses/_1_1/outline');
});

test('the compact clock accessible name includes the date even when its detail is visually hidden', () => {
  const src = source('features/nav.js'), a = src.indexOf("      if (w.id === 'clock') {"), b = src.indexOf("      if (w.id === 'next')", a);
  const attrs = new Map(), node = { box: { setAttribute: (k, v) => attrs.set(k, v) }, time: {}, detail: {} };
  const c = vm.createContext({ w: { id: 'clock' }, now: 1000, node, X: { locale: () => 'en', t: (s) => s }, Intl: { DateTimeFormat: class { constructor(_, options) { this.value = options.hour ? '12:00' : 'Mon, Jan 1'; } format() { return this.value; } } }, setText: (el, value) => { el.textContent = value; } });
  vm.runInContext(src.slice(a, b), c); assert.equal(attrs.get('aria-label'), 'Clock and date · 12:00 · Mon, Jan 1');
});

test('a refused completed timer advance is attempted only once for that stored state', () => {
  const src = source('features/nav.js'), a = src.indexOf("      if (w.id === 'timer' && W"), b = src.indexOf("      if (w.id === 'pet'", a);
  let attempts = 0;
  const W = require('../lib/widgets.js'), node = { options: { work: 25, rest: 5 }, go: { setAttribute() {} }, time: {} };
  const c = vm.createContext({ w: { id: 'timer' }, W, node, now: 5000, local: { widgetTimer: { phase: 'work', end: 1000, left: 0 } }, advanced: '', timerFailed: '', timerAction: () => { attempts++; }, send: () => { attempts++; }, X: { t: (s) => s }, setText() {} });
  vm.runInContext(src.slice(a, b), c); vm.runInContext(src.slice(a, b), c); assert.equal(attempts, 1);
});

test('a default Ultra grade page does not load the nav UI, but saved custom links do', () => {
  const src = source('content-ultra.js'), a = src.indexOf('  const syncNav ='), b = src.indexOf('\n  chrome.storage.onChanged', a);
  let files = [];
  const c = vm.createContext({ isPreview: false, window: {}, I: { links: [1], worn: { nav: {} } }, navItems: { links: [], order: [], hidden: [], widgets: [] }, navRead: false, syncDashboard() {}, location: { pathname: '/ultra/grades' }, need: (f) => { files.push(f); return Promise.resolve(); } });
  c.window.top = c.window;
  const sync = vm.runInContext(src.slice(a, b > a ? b : src.indexOf('\n  // A host registered', a)) + '\nsyncNav;', c);
  sync(); assert.deepEqual(files, []);
  c.GZ_NAV_UI = { sync() {} };
  c.navItems.links = [{}]; sync(); assert.deepEqual(files, [], 'already loaded UI synchronizes directly');
});

test('successful backup restore cleans logos only after settings commit; failed restore retains them', async () => {
  const src = source('lib/background.js');
  const c = vm.createContext({ GZ_TODO: { change: async (m) => ({ ok: m.good }) }, GZ_FOLDERS: { restore: async () => ({ ok: c.good }) }, GZ_NAV_STORE: { cleanup: async () => { c.cleaned++; return true; } }, cleaned: 0, good: false });
  const body = src.match(/\n  todo: \{([\s\S]*?)\n  \},/)[1];
  const handler = vm.runInContext(`({${body}})`, c);
  await handler.run({ restore: {}, good: false }, {}); assert.equal(c.cleaned, 0);
  c.good = true; await handler.run({ restore: {}, good: true }, {}); assert.equal(c.cleaned, 1);
});

test('the shared planner reuses only this account covered fresh cache, otherwise a bounded shared memo', async () => {
  const U = moduleOf('lib/ultra.js'), now = Date.now(), from = now, to = now + 1000;
  global.location = { origin: 'https://school.test' };
  const profile = U.page.profile, due = U.page.due;
  let calls = 0;
  U.page.profile = async () => ({ id: '_9_1' }); U.page.due = async () => { calls++; return { items: [{ title: 'Read' }] }; };
  try {
    const key = 'todo:https://school.test/_9_1', cache = { key, at: now, start: new Date(from).toISOString(), end: new Date(to).toISOString(), items: [{ title: 'Cached' }] };
    assert.equal((await U.page.planned(from, to, cache)).items[0].title, 'Cached'); assert.equal(calls, 0);
    assert.equal((await U.page.planned(from, to, { ...cache, key: 'todo:https://other.test/_9_1' })).items[0].title, 'Read');
    await U.page.planned(from, to, { ...cache, at: now - 600001 }); assert.equal(calls, 1);
    await U.page.planned(from + 1, to + 1, cache); assert.equal(calls, 2, 'uncovered range uses planner');
  } finally { U.page.profile = profile; U.page.due = due; delete global.location; }
});
