// Glaze's widgets in its own navigation: which ones show (lib/navbar.js) and the widgets themselves
// (features/navbar-widgets.js); the bar's placing them is checked in a browser by scripts/navbar-check.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const M = require('../lib/navbar.js');
const { El } = require('./stand-in-dom.js');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const plain = (v) => JSON.parse(JSON.stringify(v));

test("the student's widgets are cleaned like the rest of navbarItems, and left out until they choose", () => {
  assert.equal('widgets' in M.clean({}), false);
  assert.deepEqual(M.clean({ widgets: [] }).widgets, []);
  assert.deepEqual(M.clean({ widgets: [{ id: 'pet', at: 'top' }, { id: 'clock' }, { id: 'pet' }, { id: 'weather' }, null, 'next', { id: 'timer', at: 'side' }] }).widgets,
    [{ id: 'pet', at: 'top' }, { id: 'clock', at: 'bottom' }, { id: 'timer', at: 'bottom' }]);
  const once = M.clean({ widgets: [{ id: 'next', at: 'top' }] });
  assert.deepEqual(M.clean(once), once, 'idempotent');
});

test("the bar shows the student's widgets, else a worn Look's, else the older rail's", () => {
  const legacy = { widgets: [{ id: 'clock', on: false, at: 'bottom' }, { id: 'timer', on: true, at: 'top' }, { id: 'pet', on: true, at: 'bottom' }] };
  const look = { groups: [{ label: '', items: ['w:next', 'dashboard', 'w:clock', 'w:nope'] }] };
  assert.deepEqual(plain(M.build({ legacy }).widgets), [{ id: 'timer', at: 'top' }, { id: 'pet', at: 'bottom' }]);
  assert.deepEqual(plain(M.build({ legacy, look }).widgets), [{ id: 'next', at: 'top' }, { id: 'clock', at: 'top' }]);
  assert.deepEqual(plain(M.build({ legacy, look, prefs: M.clean({ widgets: [] }) }).widgets), [], 'turning them all off is a choice too');
  assert.deepEqual(plain(M.build({}).widgets), [], 'none by default');
  assert.ok(!M.PICKS.includes('play') && M.ICONS.play && M.ICONS.pause && M.ICONS.reset && M.PICKS.includes('timer'), "the timer's controls aren't icons an item may pick");
});

// lib/widgets.js's timer, as far as the bar uses it.
const W = { IDLE: { phase: 'work', end: 0, left: 0 }, cleanTimer: (v) => v || W.IDLE, advance: (v) => v, left: (v, now) => (v.end ? v.end - now : 1500000),
  clock: (ms) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}` };
const harness = ({ locale = 'en-US', site = 'canvas', preview = false, need, dueWeek, timer = W, local = {}, send, now } = {}) => {
  const doc = { root: null, activeElement: null, visibilityState: 'visible', addEventListener() {} };
  const make = (tag, props = {}, ...kids) => { const e = Object.assign(new El(tag, doc), props); e.append(...kids); return e; };
  const icon = (name, cls) => { const e = new El('svg', doc); e.dataset.icon = name; if (cls) e.className = cls; return e; };
  const sent = [], timers = [], moments = [], active = new Map(), changes = [];
  let tid = 0;
  const ctx = vm.createContext({
    URL, Intl, Date: now ? class extends Date { static now() { return now(); } } : Date, JSON, Math, Number, Object, Array, Promise, String, setTimeout: (fn, ms) => { timers.push({ fn, ms }); active.set(++tid, fn); return tid; }, clearTimeout: (id) => active.delete(id),
    location: { origin: 'https://school.test', href: 'https://school.test/courses/1' }, document: doc,
    GZ_SANITIZE: (s) => ({ widgets: { work: 25, rest: 5, ...(s?.widgets || {}) }, todo: { done: 'hide' } }),
    GZ_PAGE: { describe: () => ({ rel: 'tomorrow' }) },
    chrome: { runtime: { id: 'glaze', lastError: null, sendMessage: (m, cb) => { sent.push(m); if (send) return send(m, cb); cb({ ok: true, timer: { phase: 'work', end: Date.now() + 1500000, left: 0 } }); } },
      storage: { local: { get: (k, cb) => cb(local) }, sync: { get: (k, cb) => cb({}) }, onChanged: { addListener: (fn) => changes.push(fn) } } },
  });
  vm.runInContext(read('features/navbar-widgets.js'), ctx);
  const X = { site, t: (s, v) => (v ? s.replace(/\{(\w+)\}/g, (_, k) => v[k]) : s), locale: () => locale, on: () => true, settings: () => ({ enabled: true }),
    dueWeek: dueWeek || (async () => [{ title: 'Essay', due: Date.now() + 86400000, url: '/courses/1/assignments/2' }, { title: 'Elsewhere', due: Date.now() + 3600000, url: 'https://evil.test/x' }]),
    need: (file) => need ? need(file, ctx) : (file === 'lib/widgets.js' ? Promise.resolve(ctx.GZ_WIDGETS = timer) : Promise.reject(new Error('not here'))), moment: (...args) => moments.push(args) };
  return { w: ctx.GZ_NAVBAR_WIDGETS(X, { make, icon, isPreview: preview }), sent, timers, active, ctx, changes, X, moments };
};
const settle = () => new Promise((r) => setImmediate(r));

test('a widget is one element for as long as it is on; one turned off is let go', async () => {
  const { w } = harness();
  const nodes = w.set(['clock', 'timer']);
  const clock = nodes.get('clock').box;
  assert.equal(clock.getAttribute('part'), 'widget clock');
  assert.match(clock.querySelector('.w-time').textContent, /\d:\d\d/);
  assert.match(clock.dataset.tip, / · /);
  w.set(['clock', 'timer', 'pet']);
  assert.equal(w.nodes.get('clock').box, clock, 'the same element after another is turned on');
  w.set(['timer']);
  assert.equal(w.nodes.has('clock'), false);
  assert.deepEqual([...w.ids()], ['timer']);
  w.stop();
  assert.equal(w.nodes.size, 0);
});

test("what's due next on Canvas is the soonest item on this site, and links to it", async () => {
  const { w } = harness();
  const box = w.set(['next']).get('next').box;
  await settle(); await settle();
  w.draw();
  assert.equal(box.querySelector('.w-detail').textContent, 'Essay', 'an item on another site is dropped, even if it is sooner');
  assert.equal(box.querySelector('.w-when').textContent, 'tomorrow');
  assert.equal(box.href, 'https://school.test/courses/1/assignments/2');
  assert.equal(box.getAttribute('aria-disabled'), null);
  assert.equal(box.getAttribute('aria-label'), 'Next due · Essay · tomorrow');
});

test("the focus timer is the worker's, and a running one is drawn every second", async () => {
  const { w, sent, timers } = harness();
  const node = w.set(['timer']).get('timer');
  assert.equal(node.box.querySelector('.w-reset').getAttribute('aria-label'), 'Reset · Focus timer');
  await settle(); await settle();
  assert.equal(node.box.querySelector('.w-time').textContent, '25:00');
  assert.equal(node.go.getAttribute('aria-label'), 'Start · Focus timer');
  assert.ok(timers.at(-1).ms > 1005, 'an idle timer is drawn once a minute');
  node.go.listeners.find((l) => l.type === 'click').f();
  await settle();
  assert.deepEqual(plain(sent), [{ type: 'glaze:widgetTimer', op: 'toggle' }]);
  assert.equal(node.box.hasAttribute('data-running'), true);
  assert.equal(node.box.querySelector('.w-label').textContent, 'Pause');
  assert.equal(node.box.querySelector('svg').dataset.icon, 'timer');
  assert.equal(node.go.querySelector('svg').dataset.icon, 'pause');
  assert.ok(timers.at(-1).ms <= 1005, 'a running one, every second');
});


test('a retained timer finishes loading after another widget is changed', async () => {
  let ready;
  const { w, sent } = harness({ need: (_, ctx) => new Promise((r) => { ready = () => { ctx.GZ_WIDGETS = W; r(); }; }) });
  const node = w.set(['timer']).get('timer');
  w.set(['timer', 'clock']);
  ready(); await settle();
  assert.ok(node.options, 'the retained node still receives its options');
  node.go.dispatchEvent({ type: 'click' }); await settle();
  assert.equal(sent.length, 1);
});

test('a remounted next widget starts a new request without waiting for its old one', async () => {
  const pending = [];
  const { w } = harness({ dueWeek: () => new Promise((r) => pending.push(r)) });
  w.set(['next']); await settle();
  w.stop(); const node = w.set(['next']).get('next'); await settle();
  assert.equal(pending.length, 2);
  pending[1]([{ title: 'Current', due: Date.now() + 10000, url: '/current' }]); await settle();
  pending[0]([{ title: 'Old', due: Date.now() + 10000, url: '/old' }]); await settle();
  assert.equal(node.detail.textContent, 'Current');
});

test('a remounted timer can act while an old callback is pending', async () => {
  const pending = [];
  const { w } = harness({ send: (_, cb) => pending.push(cb) });
  w.set(['timer']); await settle();
  w.nodes.get('timer').go.dispatchEvent({ type: 'click' });
  w.stop(); const node = w.set(['timer']).get('timer'); await settle();
  node.go.dispatchEvent({ type: 'click' });
  assert.equal(pending.length, 2);
  pending[0]({ ok: true, timer: { end: Date.now() + 10000 } }); await settle();
  assert.equal(node.box.hasAttribute('data-running'), false, 'the old callback cannot update the new node');
  pending[1]({ ok: true, timer: { end: Date.now() + 10000 } }); await settle();
  assert.equal(node.box.hasAttribute('data-running'), true);
});

test('next due rejects same-origin blob and credential URLs', async () => {
  const { w } = harness({ dueWeek: async () => [
    { title: 'Blob', due: Date.now() + 1000, url: 'blob:https://school.test/id' },
    { title: 'Credentials', due: Date.now() + 2000, url: 'https://u:p@school.test/secret' },
    { title: 'Safe', due: Date.now() + 3000, url: '/safe' },
  ] });
  const node = w.set(['next']).get('next'); await settle(); await settle();
  assert.equal(node.box.href, 'https://school.test/safe');
});

test('stopping releases the pet and timers, and storage does no work until remount', async () => {
  let stopped = 0, reads = 0;
  const { w, active, changes, ctx } = harness({ need: (_, ctx) => { ctx.GZ_WIDGETS_UI = { avatar: () => ({ stop: () => stopped++ }) }; return Promise.resolve(); } });
  w.set(['pet', 'clock']); await settle();
  w.stop();
  ctx.chrome.storage.local.get = (_, cb) => { reads++; cb({}); };
  changes[0]({ todoCache: { newValue: {} } }, 'local');
  assert.equal(stopped, 1);
  assert.equal(active.size, 0);
  assert.equal(reads, 0);
  w.set(['clock']); await settle();
  assert.equal(reads, 1);
});

test('widget settings show and preserve the worn Look before the first personal edit', async () => {
  const doc = { activeElement: null }, elements = {};
  for (const id of ['nbar-items', 'nbar-glaze', 'nbar-widgets', 'nbar-links', 'nbar-status', 'nbar-link-form', 'nbar-reset']) elements[id] = Object.assign(new El('div', doc), { id });
  doc.querySelector = (s) => elements[s.slice(1)]; doc.createElement = (s) => new El(s, doc); doc.createElementNS = (_, s) => new El(s, doc);
  let written;
  const ctx = vm.createContext({ document: doc, TextEncoder, URL, GZ_NAVBAR: M, GZ_NAV_ITEMS: require('../lib/nav-items.js'),
    chrome: { storage: { sync: { get: async () => ({ navItems: { widgets: [{ id: 'timer', on: true }] } }), set: async (v) => { written = v; } }, onChanged: { addListener() {} } } } });
  vm.runInContext(read('lib/editor-navbar.js'), ctx);
  ctx.GZ_NAVBAREDIT.mount({ t: (s) => s, settings: () => ({ enhance: {}, parts: { x: { nav: { groups: [{ items: ['w:clock', 'w:next'] }] } } } }) });
  await settle();
  const checks = elements['nbar-widgets'].querySelectorAll('input');
  assert.deepEqual(checks.map((c) => !!c.checked), [true, true, false, false]);
  checks[3].focus(); checks[3].checked = true; checks[3].dispatchEvent({ type: 'change' }); await settle();
  assert.deepEqual(plain(written.navbarItems.widgets), [{ id: 'clock', at: 'top' }, { id: 'next', at: 'top' }, { id: 'pet', at: 'bottom' }]);
  assert.equal(doc.activeElement, elements['nbar-widgets'].querySelectorAll('input')[3], 'saving a widget choice keeps keyboard focus on its checkbox');
});


test('timer advance uses the shared model and emits done once for an observed deadline', async () => {
  const W = require('../lib/widgets.js');
  let now = Date.now();
  const local = { widgetTimer: { phase: 'work', end: now + 1000, left: 0 } };
  const { w, sent, moments } = harness({ timer: W, local, now: () => now, send: (_, cb) => cb({ ok: true, timer: W.advance(local.widgetTimer, now, { work: 25, rest: 5 }) }) });
  w.set(['timer']); await settle();
  now += 1005; w.draw(); await settle(); w.draw();
  assert.deepEqual(plain(sent), [{ type: 'glaze:widgetTimer', op: 'advance' }]);
  assert.equal(moments.length, 1);
  assert.equal(moments[0][0], 'timer.done');
  assert.equal(w.nodes.get('timer').box.hasAttribute('data-running'), true, 'the break starts from the shared timer');
});

test('preview timer actions stay local and next due never requests site data', async () => {
  const { w, sent, X } = harness({ preview: true, timer: require('../lib/widgets.js'), dueWeek: () => { throw Error('preview must not fetch'); } });
  let requested = 0; X.dueWeek = () => { requested++; return Promise.resolve([]); };
  w.set(['timer', 'next']); await settle();
  w.nodes.get('timer').go.dispatchEvent({ type: 'click' }); await settle();
  assert.equal(w.nodes.get('timer').box.hasAttribute('data-running'), true);
  assert.equal(requested, 0);
  assert.equal(sent.length, 0);
});

test('Ultra next due validates course and content ids before building a link', async () => {
  const { w } = harness({ site: 'ultra', need: (_, ctx) => {
    ctx.GZ_ULTRA = { page: { planned: async () => ({ key: 'todo:school', items: [
      { title: 'Bad course', at: Date.now() + 1000, cid: '//elsewhere.test' },
      { title: 'Valid', at: Date.now() + 2000, cid: '_1_1', content: '_2_1' },
    ] }) } };
    ctx.GZ_TODO = { clean: () => ({ items: {} }), isDone: () => false };
    return Promise.resolve();
  } });
  const node = w.set(['next']).get('next'); await settle(); await settle();
  assert.equal(node.detail.textContent, 'Valid');
  assert.equal(node.box.href, 'https://school.test/ultra/redirect?redirectType=nautilus&courseId=_1_1&contentId=_2_1');
});

test('late local reads and timer replies cannot overwrite a newer storage read', async () => {
  const pending = [];
  let reply;
  const { w, ctx, changes } = harness({ send: (_, cb) => { reply = cb; } });
  ctx.chrome.storage.local.get = (_, cb) => pending.push(cb);
  const node = w.set(['timer']).get('timer'); await settle();
  changes[0]({ widgetTimer: {} }, 'local');
  pending[1]({ widgetTimer: { end: Date.now() + 60000 } }); await settle();
  pending[0]({ widgetTimer: { end: 0 } }); await settle();
  assert.equal(node.box.hasAttribute('data-running'), true);
  node.go.dispatchEvent({ type: 'click' });
  changes[0]({ widgetTimer: {} }, 'local');
  pending[2]({ widgetTimer: { end: 0 } }); await settle();
  reply({ ok: true, timer: { end: Date.now() + 60000 } }); await settle();
  assert.equal(node.box.hasAttribute('data-running'), false);
});

test('a next response from a former page is discarded and the current page is requested', async () => {
  const pending = [];
  const { w, ctx } = harness({ dueWeek: () => new Promise((r) => pending.push(r)) });
  const node = w.set(['next']).get('next'); await settle();
  ctx.location.href = 'https://school.test/courses/2';
  pending[0]([{ title: 'Old page', due: Date.now() + 1000, url: '/old' }]); await settle();
  assert.equal(pending.length, 2);
  assert.equal(node.box.getAttribute('aria-disabled'), 'true');
  pending[1]([{ title: 'Current page', due: Date.now() + 1000, url: '/current' }]); await settle();
  assert.equal(node.detail.textContent, 'Current page');
});

test('no widgets start no work; an orphaned runtime cancels the widget clock', async () => {
  const { w, ctx, active, changes, sent } = harness();
  let reads = 0;
  ctx.chrome.storage.local.get = (_, cb) => { reads++; cb({}); };
  w.set([]); changes[0]({ widgetTimer: {} }, 'local');
  assert.equal(reads, 0); assert.equal(active.size, 0);
  w.set(['clock']); await settle();
  delete ctx.chrome.runtime.id;
  w.draw(); changes[0]({ widgetTimer: {} }, 'local');
  assert.equal(active.size, 0); assert.equal(reads, 1); assert.equal(sent.length, 0);
});

test('the phone sheet wraps Tab past an anchor without a destination', () => {
  const doc = { activeElement: null }, sheet = new El('dialog', doc);
  const next = new El('a', doc), go = new El('button', doc), last = new El('button', doc);
  sheet.append(next, go, last); last.focus();
  for (const e of [next, go, last]) e.getClientRects = () => [{}];
  const src = read('features/navbar.js');
  const key = vm.runInNewContext(src.slice(src.indexOf('  const key ='), src.indexOf('  // ---- the loop')) + '\nkey;', {
    menu: '', sheetOpen: true, el: { sheet }, root: { get activeElement() { return doc.activeElement; } },
  });
  key({ key: 'Tab', preventDefault() {} });
  assert.equal(doc.activeElement, go);
});

test('a timer options read cannot overwrite a setting changed while it loads', async () => {
  let reply;
  const { w, ctx, changes } = harness({ timer: require('../lib/widgets.js') });
  ctx.chrome.storage.sync.get = (_, cb) => { reply = cb; };
  const node = w.set(['timer']).get('timer'); await settle();
  changes[0]({ widgets: { newValue: { work: 60 } } }, 'sync');
  reply({ widgets: { work: 25 } }); await settle();
  assert.equal(node.options.work, 60);
  assert.equal(node.time.textContent, '60:00');
});
