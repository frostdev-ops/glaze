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
const harness = ({ locale = 'en-US', site = 'canvas' } = {}) => {
  const doc = { root: null, activeElement: null, visibilityState: 'visible', addEventListener() {} };
  const make = (tag, props = {}, ...kids) => { const e = Object.assign(new El(tag, doc), props); e.append(...kids); return e; };
  const icon = (name, cls) => { const e = new El('svg', doc); e.dataset.icon = name; if (cls) e.className = cls; return e; };
  const sent = [], timers = [];
  const ctx = vm.createContext({
    URL, Intl, Date, JSON, Math, Number, Object, Array, Promise, String, setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimeout() {},
    location: { origin: 'https://school.test', href: 'https://school.test/courses/1' }, document: doc,
    GZ_SANITIZE: (s) => ({ widgets: { work: 25, rest: 5, ...(s?.widgets || {}) }, todo: { done: 'hide' } }),
    GZ_PAGE: { describe: () => ({ rel: 'tomorrow' }) },
    chrome: { runtime: { id: 'glaze', lastError: null, sendMessage: (m, cb) => { sent.push(m); cb({ ok: true, timer: { phase: 'work', end: Date.now() + 1500000, left: 0 } }); } },
      storage: { local: { get: (k, cb) => cb({}) }, sync: { get: (k, cb) => cb({}) }, onChanged: { addListener() {} } } },
  });
  vm.runInContext(read('features/navbar-widgets.js'), ctx);
  const X = { site, t: (s, v) => (v ? s.replace(/\{(\w+)\}/g, (_, k) => v[k]) : s), locale: () => locale, on: () => true, settings: () => ({ enabled: true }),
    dueWeek: async () => [{ title: 'Essay', due: Date.now() + 86400000, url: '/courses/1/assignments/2' }, { title: 'Elsewhere', due: Date.now() + 3600000, url: 'https://evil.test/x' }],
    need: (file) => (file === 'lib/widgets.js' ? Promise.resolve(ctx.GZ_WIDGETS = W) : Promise.reject(new Error('not here'))), moment() {} };
  return { w: ctx.GZ_NAVBAR_WIDGETS(X, { make, icon, isPreview: false }), sent, timers };
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
