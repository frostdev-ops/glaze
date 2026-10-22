// The moments Look parts answer ('glaze:moment', GZ_CTX.moment): the submit, rotation and completion emitters.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const T = require('../lib/todo.js');
const L = require('../lib/lookx.js');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('work handed in: an open submission that is now handed in, in the same account', () => {
  const item = (id, sub, type = 'assignment') => ({ type, id, sub });
  const cache = (items, key = 'todo:https://c.test/1') => ({ key, at: 1, items });
  const open = { submitted: false }, done = { submitted: true };
  assert.equal(T.handedIn(cache([item('1', open), item('2', open)]), cache([item('1', done), item('2', open)])), 1);
  assert.equal(T.handedIn(cache([item('1', open), item('2', open)]), cache([item('1', done), item('2', done)])), 2);
  assert.equal(T.handedIn(cache([item('1', done)]), cache([item('1', done)])), 0, 'already in');
  assert.equal(T.handedIn(cache([]), cache([item('1', done)])), 0, 'first seen handed in');
  assert.equal(T.handedIn(cache([item('1', null)]), cache([item('1', done)])), 0, 'Ultra did not know');
  assert.equal(T.handedIn(cache([item('1', open)]), cache([item('1', open)])), 0);
  assert.equal(T.handedIn(cache([item('1', done)]), cache([item('1', open)])), 0, 'handed in then back to open is not');
  assert.equal(T.handedIn(cache([item('1', open, 'quiz')]), cache([item('1', done, 'assignment')])), 0, 'a different item');
  assert.equal(T.handedIn(cache([item('1', open)], 'todo:https://c.test/1'), cache([item('1', done)], 'todo:https://c.test/2')), 0, 'another account');
  for (const bad of [null, undefined, {}, 'x', [], { key: 'k', items: 'no' }, { key: 'k', items: [null, 3, 'x'] }]) {
    assert.equal(T.handedIn(bad, cache([item('1', done)])), 0);
    assert.equal(T.handedIn(cache([item('1', open)]), bad), 0);
  }
  // Items without an id are not tracked.
  assert.equal(T.handedIn(cache([{ type: 'planner_note', id: '', sub: open }]), cache([{ type: 'planner_note', id: '', sub: done }])), 0);
});

test('the planner answer another tab stores announces a submit once, through GZ_CTX.moment', () => {
  const heard = [];
  let listener;
  const ctx = vm.createContext({ chrome: { storage: { onChanged: { addListener: (f) => { listener = f; } } } }, location: { origin: 'https://school-a.test' }, module: undefined, require: undefined });
  ctx.globalThis = ctx;
  ctx.GZ_CTX = { moment: (...a) => heard.push(a) };
  ctx.GZ_SPEC = {};
  vm.runInContext(read('lib/todo.js'), ctx);
  const item = (submitted) => ({ type: 'assignment', id: '7', sub: { submitted } });
  const change = (oldValue, newValue) => ({ todoCache: { oldValue, newValue } });
  const key = 'todo:https://school-a.test/1';
  listener(change({ key, items: [item(false)] }, { key, items: [item(true)] }), 'local');
  assert.deepEqual(heard, [['submit']]);
  for (const foreign of ['todo:https://school-b.test/1', 'todo:https://school-a.test.evil/1']) {
    listener(change({ key: foreign, items: [item(false)] }, { key: foreign, items: [item(true)] }), 'local');
  }
  assert.deepEqual(heard, [['submit']], 'another origin cannot announce its submissions on this page');
  listener(change({ key, items: [item(false)] }, { key, items: [item(true)] }), 'sync');
  listener({ other: {} }, 'local');
  listener(change({ key, items: [item(true)] }, { key, items: [item(true)] }), 'local');
  assert.equal(heard.length, 1);
  // Nothing listens where there is no page (the worker, the editor, node).
  assert.ok(T.handedIn);
});

test('the rotation turned: its Look changed, not its clock started or its mode', () => {
  const s = (o) => ({ mode: 'daily 08:00', at: 1000, i: 2, turned: true, ...o });
  assert.equal(L.turned(s({ i: 1, at: 500 }), s()), true);
  assert.equal(L.turned(s({ i: 0, at: 500 }), s({ i: 0, at: 1000 })), true, 'a list of one still turns');
  assert.equal(L.turned(undefined, s({ turned: undefined })), false, 'first clock state');
  assert.equal(L.turned(s(), s({ mode: 'weekly 08:00', turned: undefined })), false, 'mode changed');
  assert.equal(L.turned(s(), s()), false, 'same state');
  assert.equal(L.turned(s({ at: 5 }), s({ i: -1, turned: undefined })), false, 'clock started');
  assert.equal(L.turned(s({ at: 5 }), undefined), false, 'cleared');
  assert.equal(L.turned('x', s()), false);
});

// content.js: moment(), celebrate() and moveParts() run in a VM with stand-ins, sliced between markers.
const firstScript = read('content.js');
const slice = (from, to) => { const a = firstScript.indexOf(from), b = firstScript.indexOf(to, a); assert.ok(a > 0 && b > a, `${from} … ${to}`); return firstScript.slice(a, b); };
const rig = ({ level = 'expressive', rect = { left: 10, top: 20, width: 30, height: 40 }, parts = null, motionx = null } = {}) => {
  const events = [], needed = [], burst = [];
  const attrs = { 'data-gz-motion': level };
  const document = {
    dispatchEvent: (e) => { events.push({ type: e.type, detail: JSON.parse(JSON.stringify(e.detail)) }); return true; }, addEventListener: (t, f) => { document.on = [...(document.on || []), [t, f]]; },
    createElement: () => { const el = { style: { setProperty() {} }, append() {}, remove() {}, className: '' }; burst.push(el); return el; },
    body: { append() {} },
  };
  const ctx = vm.createContext({ document, html: { getAttribute: (k) => attrs[k] ?? null }, CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init.detail; } },
    setTimeout: () => 0, globalThis: null, need: (f) => { needed.push(f); return motionx ? Promise.resolve() : Promise.reject(new Error('stand-in')); } });
  ctx.globalThis = ctx;
  ctx.GZ_CTX = { parts: () => parts };
  if (motionx) ctx.GZ_MOTIONX = motionx;
  vm.runInContext(`${slice('  const told = new Set();', '  // ---- the student\'s courses')}; globalThis.api = { moment, celebrate, moveParts }`, ctx);
  const el = { getBoundingClientRect: () => rect, matches: () => true };
  return { api: ctx.api, events, needed, burst, el, document, ctx };
};

test('celebrate announces the completion where the circle is, and the dots stay Expressive\'s', () => {
  const x = rig();
  x.api.celebrate(x.el);
  assert.deepEqual(x.events, [{ type: 'glaze:moment', detail: { name: 'complete', x: 25, y: 40 } }]);
  assert.equal(x.burst.length, 11, 'the burst and its ten dots');
  for (const level of ['subtle', 'off']) {
    const y = rig({ level });
    y.api.celebrate(y.el);
    assert.equal(y.events.length, 1, `${level}: the moment still happens, for a Look's effect`);
    assert.equal(y.burst.length, 0, `${level}: no dots`);
  }
  const own = rig({ motionx: { has: (n) => n === 'complete' } });
  own.api.celebrate(own.el);
  assert.equal(own.events.length, 1);
  assert.equal(own.burst.length, 0, 'a Look with its own effect has no dots');
  const gone = rig({ rect: { left: 0, top: 0, width: 0, height: 0 } });
  gone.api.celebrate(gone.el);
  assert.equal(gone.events.length, 0, 'an element with no box is not a place');
});

test('moment: a name, a place if there is one, and a `once` key keeps one from repeating', () => {
  const x = rig();
  x.api.moment('streak');
  x.api.moment('grade', x.el, 'grade c1 2');
  x.api.moment('grade', x.el, 'grade c1 2');
  x.api.moment('grade', x.el, 'grade c1 3');
  x.api.moment('timer.done', { getBoundingClientRect: () => ({ width: 0 }) });
  assert.deepEqual(x.events.map((e) => e.detail), [{ name: 'streak' }, { name: 'grade', x: 25, y: 40 }, { name: 'grade', x: 25, y: 40 }, { name: 'timer.done' }]);
});

test('the first script loads motionx only for a Look that moves, or once it is loaded', () => {
  for (const parts of [{ anim: { 'card.enter': {} } }, { fx: { complete: {} } }, { cursor: { kind: 'glow' } }]) {
    const x = rig({ parts });
    x.api.moveParts();
    assert.deepEqual(x.needed, ['features/motionx.js']);
  }
  for (const parts of [null, {}, { bg: { layers: [] } }, { nav: {}, rules: [] }]) {
    const x = rig({ parts });
    x.api.moveParts();
    assert.deepEqual(x.needed, [], JSON.stringify(parts));
  }
  const loaded = rig({ parts: null, motionx: { sync() {} } });
  loaded.api.moveParts();
  assert.deepEqual(loaded.needed, ['features/motionx.js'], 'loaded already: asked again so it follows the change (a Look without parts clears)');
  assert.match(firstScript, /document\.addEventListener\('glaze:parts', moveParts\)/);
  assert.match(firstScript, /globalThis\.GZ_MOTIONX\?\.off\(\)/, 'turning Glaze off stops it');
});

test('every place that celebrates leaves the level to celebrate()', () => {
  assert.doesNotMatch(read('content-canvas.js'), /data-gz-motion/);
  assert.doesNotMatch(read('features/todo.js').match(/const burst = [^\n]*/)[0], /data-gz-motion/);
  assert.doesNotMatch(firstScript.match(/r\.oldValue !== 'true'[^\n]*/)[0], /data-gz-motion/);
});

test('the emitters sit where the data is read', () => {
  assert.match(read('features/reminders.js'), /if \(run && s\.current > run\.current\) ctx\.moment\?\.\('streak'/);
  assert.match(read('features/widgets.js'), /chime\(\); ctx\.moment\?\.\('timer\.done'/);
  assert.match(read('features/nav.js'), /X\.moment\?\.\('timer\.done'/);
  assert.match(read('features/lookx.js'), /ctx\.moment\?\.\('look\.rotate'\)/);
  assert.match(firstScript, /gradeMoment\(cid, count, pill\)/);
  assert.match(read('content-canvas.js'), /GZ_CTX\.gradeMoment\(cid, n, pill/);
});


const badgeRig = (site) => {
  const heard = [], pills = new Map();
  const node = () => ({ dataset: {}, textContent: '', setAttribute() {}, getAttribute() { return null; }, remove() { for (const [k, v] of pills) if (v === this) pills.delete(k); } });
  const host = { querySelector: (s) => pills.get(s.match(/data-kind="([^"']+)"/)[1]), insertBefore: (p) => pills.set(p.dataset.kind, p), append: (p) => pills.set(p.dataset.kind, p) };
  const ctx = vm.createContext({ document: { createElement: node }, moment: (...args) => heard.push(args), t: (text) => text, KIND: { grades: 'grades' } });
  ctx.globalThis = ctx;
  const shared = slice('  // ---- new grades (Extras)', '  // Ultra\'s pills');
  vm.runInContext(`${shared}; globalThis.cardBadge = cardBadge; globalThis.GZ_CTX = { moment${/const gradeMoment =/.test(shared) ? ', gradeMoment' : ''} };`, ctx);
  if (site === 'canvas') {
    const source = read('content-canvas.js');
    vm.runInContext(`${source.slice(source.indexOf('  const canvasNewsBadge ='), source.indexOf('  const renderCanvasNew ='))}; globalThis.badge = canvasNewsBadge;`, ctx);
  } else ctx.badge = ctx.cardBadge;
  return { heard, draw: (n) => ctx.badge(host, 'c1', n, 'grades'), remount: () => pills.clear() };
};
for (const site of ['ultra', 'canvas']) test(`${site}: unread grades only announce an increase after the initial reading`, () => {
  const x = badgeRig(site);
  x.draw(2);
  assert.equal(x.heard.length, 0, 'old unread grades on page load are not a new event');
  x.remount(); x.draw(2);
  assert.equal(x.heard.length, 0, 'a remounted card is not a new event');
  x.draw(3);
  assert.equal(x.heard.length, 1, 'a count increase on an existing pill is a new event');
  x.draw(3); x.draw(0); x.draw(1);
  assert.equal(x.heard.length, 2, 'a later new grade still counts after earlier grades were read');
});

test('Ultra does not treat a gradebook still loading as a known zero count', () => {
  const x = badgeRig('ultra');
  const call = read('content-ultra.js').match(/cardBadge\(el, id, b\.results \?[^;]+;/)[0];
  const ctx = vm.createContext({ el: {}, id: 'c1', b: { results: null }, GZ_GRADES: { fresh: () => ({ ids: new Set(['a', 'b']) }) }, seen: {}, cardBadge: (_, __, n) => x.draw(n) });
  vm.runInContext(call, ctx);
  ctx.b.results = [];
  vm.runInContext(call, ctx);
  assert.equal(x.heard.length, 0, 'the first loaded count is the baseline');
});


test('Ultra completion follows a trusted review action once, never hydration or duplicate mutations', () => {
  const x = rig();
  Object.assign(x.ctx, { ultra: true, chrome: { runtime: { id: 'test' } }, hid: () => false, dirty: new Set(), full: false, timer: 1, X: { lift() {} } });
  vm.runInContext(`${slice('  const schedule = (records)', '  const startSweep =')}; globalThis.schedule = schedule`, x.ctx);
  let checked = 'false';
  x.el.getAttribute = () => checked;
  x.el.closest = (s) => s === '.js-review-state-icon-button' ? x.el : null;
  const record = (oldValue) => ({ target: x.el, oldValue, type: 'attributes', attributeName: 'aria-checked' });
  checked = 'true';
  x.ctx.schedule([record(null), record('false')]);
  assert.equal(x.events.length, 0, 'hydration cannot announce completion');
  checked = 'false';
  const click = (trusted) => { for (const [type, f] of x.document.on) if (type === 'click') f({ isTrusted: trusted, target: x.el }); };
  click(false); checked = 'true'; x.ctx.schedule([record('false')]);
  assert.equal(x.events.length, 0, 'a scripted click cannot arm a completion');
  checked = 'false'; click(true); checked = 'true';
  x.ctx.schedule([record('false'), record('false')]);
  assert.equal(x.events.length, 1, 'one completion for one action');
  checked = 'false'; click(true); checked = 'true'; x.ctx.schedule([record('false')]);
  assert.equal(x.events.length, 2, 'a later real completion still announces');
});

test('a quiz or tool page gets no built-in completion burst', () => {
  const x = rig();
  x.ctx.GZ_LX = { quiet: () => true };
  x.ctx.location = { pathname: '/ultra/courses/_1_1/assessment/_2_1' };
  x.api.celebrate(x.el);
  assert.equal(x.burst.length, 0);
  assert.equal(x.events.length, 0);
});

test('rotation clock repair is silent even when the stored index names a Look', () => {
  const before = { mode: '6h 08:00', at: 2000, i: 1 };
  const reset = L.turn(before, 1000, { rotate: '6h', at: '08:00' }, ['Clear', 'Library']);
  assert.equal(reset.wear, -1);
  assert.equal(L.turned(before, reset.state), false);
  const forced = L.turn(before, 1000, { rotate: '6h', at: '08:00' }, ['Clear', 'Library'], true);
  assert.equal(L.turned(before, forced.state), true, 'an actual forced turn still announces');
});

for (const site of ['widget', 'rail']) test(`${site}: a timer loaded already expired is silent; an observed deadline announces once`, async () => {
  const W = require('../lib/widgets.js');
  const heard = [];
  const claimed = new Set();
  let now = 10000;
  const ctx = vm.createContext({ W, now, Date: { now: () => now }, node: { options: { work: 25, rest: 5, auto: false } }, local: {}, w: { id: 'timer' }, timerFailed: '', advanced: '',
    X: { moment: (...a) => heard.push(a), t: (s) => s }, ctx: { moment: (...a) => heard.push(a) },
    shown: () => true, alive: true, tick: 0, alarm: 0, audio: null, seenEnd: 0, o: { work: 25, rest: 5, auto: false }, s: W.IDLE,
    clearTimeout() {}, setTimeout() {}, ask() { const end = ctx.local.widgetTimer.end, advanced = claimed.has(end) ? undefined : end; claimed.add(end); return Promise.resolve({ advanced }); }, timerAction() {}, chime() {}, t: (s) => s, say: {}, phase: {}, time: {}, go: {}, body: { dataset: {} } });
  if (site === 'widget') {
    const src = read('features/widgets.js');
    // From `over` (what a phase running out does, which a hidden tab's alarm runs too) through `run`.
    const over = src.indexOf('      const over = (now, away) => {', src.indexOf('    timer(body)'));
    const start = over >= 0 ? over : src.indexOf('      const run = () => {', src.indexOf('    timer(body)'));
    vm.runInContext(`${src.slice(start, src.indexOf('      const onStore =', start))}; globalThis.run = run`, ctx);
  } else {
    const src = read('features/nav.js');
    const start = src.indexOf("      if (w.id === 'timer' && W && node.options) {");
    const end = src.indexOf('        const left =', start);
    vm.runInContext(`globalThis.run = () => { ${src.slice(start, end)} } }`, ctx);
  }
  const state = (end) => { ctx.now = now; ctx.s = { phase: 'work', end, left: 0 }; ctx.local.widgetTimer = ctx.s; ctx.run(); };
  state(9500);
  await Promise.resolve();
  assert.equal(heard.length, 0, 'loading an expired phase is not completion');
  state(11000);
  now = 11010;
  state(11000); state(11000);
  await Promise.resolve();
  assert.equal(heard.length, 1, 'the deadline observed running announces once');
});

test('a local To Do completion announces only after its save succeeds, at the original box', async () => {
  const src = read('features/todo.js');
  const mark = src.slice(src.indexOf('  const mark = async'), src.indexOf('  const onClick ='));
  for (const ok of [false, true]) {
    const heard = [], rect = { left: 10, top: 20, width: 20, height: 20 };
    let answer;
    const ctx = vm.createContext({ t: (s) => s, toSite: () => false, L: { isDone: () => false }, save: () => new Promise((res) => { answer = res; }),
      document: { documentElement: { getAttribute: () => 'expressive' } }, ctx: { celebrate: (el) => heard.push(el.getBoundingClientRect()) } });
    vm.runInContext(`${mark}; globalThis.mark = mark`, ctx);
    const el = { checked: true, getBoundingClientRect: () => rect };
    const saving = ctx.mark({ custom: true, title: 'Task', id: '1' }, el);
    assert.equal(heard.length, 0, 'no completion while the write is pending');
    el.getBoundingClientRect = () => ({ width: 0 });
    answer(ok); await saving;
    assert.equal(heard.length, ok ? 1 : 0);
    if (ok) assert.deepEqual(heard[0], rect);
  }
});
