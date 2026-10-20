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

test('the core reuses connected provisional sheets without restarting or moving their blocking load', () => {
  const src = source('content.js'), a = src.indexOf('  const enable = () => {'), b = src.indexOf('    applySettings();', a), events = [];
  const sheets = ['theme.css', 'motion.css', 'extras.css', 'features/apps.css'].map((f) => ({
    isConnected: true,
    set rel(v) { assert.fail(`reassigned ${f} rel`); },
    set href(v) { assert.fail(`restarted ${f} URL`); },
    addEventListener: (name) => events.push([f, name]),
  }));
  const c = vm.createContext({ notUltra: false, links: [], ultra: true, SHEETS: [...sheets.keys()], GZ_SITE_ULTRA: { sheets },
    document: { body: null, head: { appendChild: () => assert.fail('moved a connected blocker') } }, html: {}, chrome: { runtime: { getURL: (f) => f } },
    setTimeout: () => assert.fail('reset the bounded blocker timer'), tintKey() {}, reapply() {} });
  vm.runInContext(src.slice(a, b) + '\n}; enable();', c);
  assert.equal(c.links.length, 4); assert.equal(events.length, 4);
});

test('provisional load/error settling before core reuse releases blocking without another node or deadline', () => {
  const sheets = [], timers = [], events = []; let writes = 0;
  const document = { contentType: 'text/html', body: null, head: { appendChild(l) { l.isConnected = true; sheets.push(l); } },
    createElement: () => ({ attrs: {}, set rel(v) { writes++; }, set href(v) { writes++; },
      setAttribute(k, v) { this.attrs[k] = v; }, removeAttribute(k) { delete this.attrs[k]; }, addEventListener: (n) => events.push(n) }) };
  const c = vm.createContext({ document, location: { pathname: '/ultra/course' }, chrome: { runtime: { getURL: (f) => f } },
    setTimeout: (fn, ms) => timers.push({ fn, ms }), notUltra: false, links: [], ultra: true, SHEETS: ['theme.css', 'motion.css', 'extras.css', 'features/apps.css'], html: {}, tintKey() {}, reapply() {} });
  vm.runInContext(source('content-ultra.js'), c);
  sheets[0].onload(); sheets[1].onerror();
  const src = source('content.js'), a = src.indexOf('  const enable = () => {'), b = src.indexOf('    applySettings();', a);
  vm.runInContext(src.slice(a, b) + '\n}; enable();', c);
  assert.equal(sheets.length, 4); assert.equal(writes, 8); assert.equal(events.length, 4); assert.equal(timers.length, 4);
  assert.ok(timers.every((t) => t.ms === 1000)); assert.ok(sheets.slice(0, 2).every((l) => !l.attrs.blocking));
  assert.ok(sheets.slice(2).every((l) => l.attrs.blocking === 'render'));
  timers.forEach((t) => t.fn()); assert.ok(sheets.every((l) => !l.attrs.blocking));
});

const dashboardFixture = () => {
  const src = source('content-ultra.js'), a = Math.max(src.indexOf('  const navRoots ='), src.indexOf('  const renamed =')), b = src.indexOf('  const paintNav =', a);
  const attrs = new Map(), classes = new Set(), text = { nodeType: 3, data: 'Institution page' }, wrapper = { text };
  let scans = 0, globalScans = 0, ownedIcon;
  const link = { nodeType: 1, isConnected: true, hasAttribute: (k) => attrs.has(k), getAttribute: (k) => k === 'href' ? 'https://school.test/ultra/institution-page' : attrs.get(k) ?? null, setAttribute: (k, v) => attrs.set(k, v), removeAttribute: (k) => attrs.delete(k), querySelector: (s) => s.startsWith(':scope') ? ownedIcon?.isConnected ? ownedIcon : null : wrapper, closest: () => link, prepend: (n) => { n.isConnected = true; ownedIcon = n; }, classList: { contains: (k) => classes.has(k), toggle: (k, on) => on ? classes.add(k) : classes.delete(k) } };
  text.parentElement = link;
  const root = { isConnected: true, setAttribute: (k, v) => { root.tagged = k; }, contains: (n) => n === link || n === root || n?.inRail, querySelectorAll: () => { scans++; return [link]; } };
  const I = { links: [1], settings: { enabled: true, enhance: { dashboard: true } } }, callbacks = [], queued = [];
  const globals = { I, chrome: { runtime: { id: 'glaze' } }, GZ_NAV: moduleOf('lib/nav.js'), NodeFilter: { SHOW_TEXT: 4 }, t: (s) => s, html: {}, addEventListener() {}, queueMicrotask: (f) => queued.push(f), MutationObserver: class { constructor(cb) { callbacks.push(cb); } observe() {} disconnect() {} }, document: { querySelectorAll: (selector) => { globalScans++; return selector.endsWith(' a[href]') ? [link] : [root]; }, createTreeWalker: (w) => ({ nextNode: () => w.text }), createElementNS: () => ({ namespaceURI: 'svg', isConnected: false, classList: { add() {}, contains: () => true }, setAttribute() {}, append() {}, remove() { this.isConnected = false; } }) } };
  const c = vm.createContext({ ...globals });
  const api = vm.runInContext(src.slice(a, b) + `\n({syncDashboard, discoverNav: typeof discoverNav === 'undefined' ? null : discoverNav});`, c);
  const flush = () => { let n = 0; while (queued.length && n++ < 10) queued.shift()(); assert.ok(n < 10, 'observer settles without a feedback loop'); };
  return { ...api, chrome: globals.chrome, reload: () => vm.runInContext(src.slice(a, b) + '\nsyncDashboard;', vm.createContext({ ...globals })), text, wrapper, link, attrs, classes, I, root, callbacks, queued, flush, counts: () => ({ scans, globalScans }) };
};

test('Dashboard first-paint rename preserves its React wrapper, native icon and tooltip when disabled', () => {
  const f = dashboardFixture(); f.syncDashboard();
  assert.equal(f.text.data, 'Dashboard'); assert.equal(f.wrapper.text, f.text); assert.ok(f.classes.has('gz-nav-dashboard')); assert.equal(f.attrs.get('title'), 'Dashboard');
  f.I.settings.enhance.dashboard = false; f.syncDashboard();
  assert.equal(f.text.data, 'Institution page'); assert.ok(!f.classes.has('gz-nav-dashboard')); assert.equal(f.attrs.has('aria-label'), false); assert.equal(f.attrs.has('title'), false);
});

test('a new extension context restores the native Dashboard name and icon metadata', () => {
  const f = dashboardFixture(); f.syncDashboard(); assert.equal(f.text.data, 'Dashboard');
  f.I.settings.enhance.dashboard = false; const again = f.reload(); again();
  assert.equal(f.text.data, 'Institution page'); assert.equal(f.attrs.has('aria-label'), false); assert.equal(f.attrs.has('title'), false); assert.equal(f.attrs.has('data-gz-nav-original'), false);
});

test('the merged synchronous gate discovers native navigation and preserves the course-tab callback return', () => {
  const line = source('content-ultra.js').split('\n').find((s) => s.includes('const gate = ')), calls = [], scope = {};
  assert.ok(line, 'the merged gate is explicit');
  const c = vm.createContext({ discoverNav: (n) => { assert.equal(n, scope); calls.push('nav'); }, tagDocs: (n) => { assert.equal(n.length, 1); assert.equal(n[0], scope); calls.push('docs'); }, GZ_CTABS: { held: () => { calls.push('tabs'); return true; } } });
  const gate = vm.runInContext(line + '\ngate;', c);
  assert.equal(gate(scope), true); assert.deepEqual(calls, ['nav', 'docs', 'tabs']);
  c.GZ_CTABS = undefined; assert.equal(gate(scope), undefined); assert.deepEqual(calls, ['nav', 'docs', 'tabs', 'nav', 'docs']);
});

test('thirty unrelated widget text updates cause no navigation scans and own writes become idle', () => {
  const f = dashboardFixture(); f.syncDashboard(); const before = f.counts();
  const target = { nodeType: 3, parentElement: { closest: () => null }, inRail: true };
  for (let n = 0; n < 30; n++) f.callbacks[0]([{ type: 'characterData', target, addedNodes: [], removedNodes: [] }]);
  f.flush(); assert.deepEqual(f.counts(), before);
  f.callbacks[0]([{ type: 'characterData', target: f.text, addedNodes: [], removedNodes: [] }]); f.flush();
  assert.deepEqual(f.counts(), before); assert.equal(f.queued.length, 0);
});

test('an invalidated native-label observer neither scans nor reclaims a new context name', () => {
  const f = dashboardFixture(); f.syncDashboard(); f.flush(); const before = f.counts();
  f.chrome.runtime.id = undefined; f.text.data = 'Institution page';
  f.callbacks[0]([{ type: 'characterData', target: f.text, addedNodes: [], removedNodes: [] }]); f.flush(); f.syncDashboard();
  assert.equal(f.text.data, 'Institution page'); assert.deepEqual(f.counts(), before);
});

test('native text replacement batches before paint while a replacement drawer is discovered', () => {
  const f = dashboardFixture(); f.syncDashboard(); f.text.data = 'New institution';
  f.callbacks[0]([{ type: 'characterData', target: f.text, addedNodes: [], removedNodes: [] }]);
  assert.equal(f.queued.length, 1); f.flush(); assert.equal(f.text.data, 'Dashboard');
  f.I.settings.enhance.dashboard = false; f.syncDashboard(); assert.equal(f.text.data, 'New institution');
  assert.equal(f.callbacks.length, 1, 'only the rail has an observer; added subtrees come from the core gate');
  f.root.isConnected = false;
  const replacement = { ...f.root, isConnected: true, matches: () => true };
  f.discoverNav(replacement); f.flush();
  assert.ok(f.counts().scans >= 2);
  assert.equal(f.root.tagged, 'data-gz-nav-root', 'a discovered nav is tagged for theme.css, which keeps class tests out of its :has()');
});

test('an invalidated collapse listener leaves the native event untouched', () => {
  const src = source('features/nav.js'), a = src.indexOf("  document.addEventListener('click'"), b = src.indexOf('  chrome.storage.onChanged', a);
  let click, sends = 0, prevented = 0;
  const c = vm.createContext({ X: { on: () => true, nav: () => ({ collapsed: true }) }, chrome: { runtime: { sendMessage: () => { sends++; return Promise.resolve(); } } }, document: { addEventListener: (_, fn) => { click = fn; } } });
  vm.runInContext(src.slice(a, b), c);
  click({ target: { closest: () => true }, preventDefault: () => prevented++, stopImmediatePropagation() {} });
  assert.equal(sends, 0); assert.equal(prevented, 0);
});

test('all navigation customization values use one bounded first-paint spec', () => {
  const N = moduleOf('lib/nav.js');
  assert.deepEqual(N.SPEC.labelOverflow, ['ellipsis', ['ellipsis', 'wrap', 'shrink']]);
  assert.deepEqual(N.SPEC.itemStyle, ['tile', ['tile', 'pill', 'flat']]);
  assert.deepEqual(N.SPEC.activeIndicator, ['bar', ['bar', 'outline', 'background', 'none']]);
  assert.deepEqual(N.SPEC.expandOnHover, [true, 'bool']); assert.deepEqual(N.SPEC.width, [200, [160, 400]]); assert.deepEqual(N.SPEC.logoSize, [48, [24, 96]]); assert.deepEqual(N.SPEC.footer, [true, 'bool']);
  for (const [size, height] of [['small', 40], ['medium', 44], ['large', 48]]) assert.equal(N.dimensions({ size, gap: 2, padding: 8 }).height, height);
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
  const src = source('features/nav.js'), a = src.indexOf("      if (w.id === 'timer' && W"), b = src.indexOf('\n    }\n    if (config.widgets', a);
  let attempts = 0;
  const W = require('../lib/widgets.js'), node = { options: { work: 25, rest: 5 }, go: { setAttribute() {} }, time: {} };
  const c = vm.createContext({ w: { id: 'timer' }, W, node, now: 5000, local: { widgetTimer: { phase: 'work', end: 1000, left: 0 } }, advanced: '', timerFailed: '', timerAction: () => { attempts++; }, send: () => { attempts++; }, X: { t: (s) => s }, setText() {} });
  vm.runInContext(src.slice(a, b), c); vm.runInContext(src.slice(a, b), c); assert.equal(attempts, 1);
});

test('a default Ultra grade page does not load the nav UI, but saved custom links do', () => {
  const src = source('content-ultra.js'), a = src.indexOf('  const syncNav ='), b = src.indexOf('\n  chrome.storage.onChanged', a);
  let files = [];
  const c = vm.createContext({ isPreview: false, window: {}, I: { links: [1], worn: { nav: {} } }, navItems: { links: [], order: [], hidden: [], widgets: [] }, navRead: false, syncDashboard() {}, glazeItem() {}, location: { pathname: '/ultra/grades' }, need: (f) => { files.push(f); return Promise.resolve(); } });
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
  const writes = [], area = { local: { set: async (patch) => { writes.push(JSON.parse(JSON.stringify(patch))); return true; } } };
  await handler.run({ restore: {}, good: false }, area); assert.equal(c.cleaned, 0); assert.deepEqual(writes, []);
  c.good = true; await handler.run({ restore: {}, good: true }, area); assert.equal(c.cleaned, 1);
  assert.deepEqual(writes, [{ freshDefaults: { fresh: false, pending: false } }]);
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


test('item URL validation and ordering are loaded only when the rail UI is needed', () => {
  const manifest = require('../manifest.json'), initial = manifest.content_scripts.find((c) => c.matches.includes('https://*/ultra')).js;
  assert.ok(initial.includes('lib/nav.js')); assert.ok(!initial.includes('lib/nav-items.js'));
  const src = source('lib/nav.js'); assert.ok(!src.includes('const link =')); assert.ok(!src.includes('const clean =')); assert.ok(!src.includes('const sequence ='));
  const N = require('../lib/nav-items.js'); assert.equal(N.link({ id: 'aaaaaaaaaaaa', n: 'Safe', u: 'javascript:alert(1)' }), null); assert.equal(N.clean().widgets.length, 4);
});

test('the document view\'s column is tagged as it is drawn and untagged once its document goes', () => {
  const src = source('content-ultra.js'), a = src.indexOf('  const docs = new Set();'), b = src.indexOf('  // Keep the course strip attached', a);
  const parent = { attrs: new Set(), isConnected: true, child: null, setAttribute(k) { this.attrs.add(k); }, removeAttribute(k) { this.attrs.delete(k); }, querySelector() { return this.child; } };
  const doc = { parentElement: parent }; parent.child = doc;
  const tagDocs = vm.runInNewContext(src.slice(a, b) + '\ntagDocs;', {});
  tagDocs([{ matches: () => false, getElementsByClassName: (c) => (c === 'document-content-root' ? [doc] : []) }]);
  assert.ok(parent.attrs.has('data-gz-doc'));
  parent.child = null; tagDocs([]);
  assert.ok(!parent.attrs.has('data-gz-doc'), 'its document removed, nothing added: untagged on the next pass, which has no roots');
});
