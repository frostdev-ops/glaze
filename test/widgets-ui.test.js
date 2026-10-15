// Dashboard widgets on a page (features/widgets.js) in a VM with an inert DOM, storage and timers: a tile that goes
// before its storage answers arms nothing, and a note that didn't save stays unsaved and is tried again.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const D = require('../defaults.js');
const W = require('../lib/widgets.js');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const settle = async () => { for (let i = 0; i < 10; i++) await new Promise(setImmediate); };

class E {
  constructor(tag = 'div') { this.tagName = tag.toUpperCase(); this.dataset = {}; this.children = []; this.attrs = {}; this.on = {}; this.style = { setProperty() {} }; this.hidden = false; this.value = ''; }
  append(...xs) { this.children.push(...xs); }
  replaceChildren(...xs) { this.children = xs; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  removeAttribute(k) { delete this.attrs[k]; }
  addEventListener(type, f) { (this.on[type] ||= []).push(f); }
  fire(type, e = {}) { for (const f of this.on[type] || []) f({ target: this, preventDefault() {}, ...e }); }
  focus() {}
  setSelectionRange() {}
  closest() { return null; }
  after() {}
  remove() {}
}

const page = ({ local = {}, replies = [], clock = { t: Date.now() }, hold = false } = {}) => {
  const held = []; // replies the test lets through by hand (hold)
  const FakeDate = class extends Date {};
  FakeDate.now = () => clock.t;
  const timers = new Map();
  let n = 0;
  const reads = [];
  const sent = [];
  const listeners = [];
  const c = {
    console, URL, Intl, Date: FakeDate, Map, Set, JSON, Promise, Error, Number, Math, Object, Array, String,
    GZ_SANITIZE: D.GZ_SANITIZE, GZ_I18N: { locale: () => 'en' },
    GZ_CTX: { t: (k) => k, locale: () => 'en', need: async () => {}, settings: () => ({ enhance: { notes: true, widgets: true } }), profile: async () => ({ id: '3', time_zone: 'UTC' }) },
    location: { origin: 'https://canvas.test', pathname: '/' },
    setTimeout: (f, ms) => { timers.set(++n, { f, ms }); return n; },
    clearTimeout: (id) => timers.delete(id),
    addEventListener() {}, removeEventListener() {},
    chrome: {
      runtime: { lastError: undefined, getURL: (p) => `chrome-extension://x/${p}`, getManifest: () => ({ version: '2.3.0' }), sendMessage: (m, cb) => { sent.push(m); const r = replies.shift() || { ok: true, kept: true }; if (hold) held.push(() => cb(r)); else Promise.resolve().then(() => cb(r)); } },
      storage: {
        local: { get: (keys, cb) => reads.push(() => cb(Object.fromEntries([keys].flat().filter((k) => k in local).map((k) => [k, local[k]])))), set: (v, cb) => { Object.assign(local, v); cb?.(); } },
        sync: { get: (k, cb) => cb({}) },
        onChanged: { addListener: (f) => listeners.push(f), removeListener: (f) => listeners.splice(listeners.indexOf(f), 1) },
      },
    },
    document: { visibilityState: 'visible', createElement: (t) => new E(t), createTextNode: (data) => ({ data }), addEventListener() {} },
  };
  c.globalThis = c;
  vm.createContext(c);
  // The widgets themselves, reached as todo-ui.test.js reaches the list's insides: through the source's return.
  const src = read('features/widgets.js').replace('  return { sync, hub: open };', '  return { sync, hub: open, probe: { WIDGETS, set: (w, s, m) => { W = w; o = s; me = m; } } };');
  assert.notEqual(src, read('features/widgets.js'));
  const ui = vm.runInContext(src, c);
  ui.probe.set(W, D.GZ_SANITIZE({}).widgets, { uid: '3', tz: 'UTC' });
  const answer = () => { while (reads.length) reads.shift()(); };
  return { ui, timers, answer, sent, listeners, local, clock, held };
};
const find = (el, pred) => (pred(el) ? el : el.children?.map((c) => find(c, pred)).find(Boolean) || null);

test('a timer tile that goes before its stored state arrives arms no clock', async () => {
  const p = page({ local: { widgetTimer: { phase: 'work', end: Date.now() + 10 * 6e4, left: 0 } } });
  const body = new E();
  const tile = p.ui.probe.WIDGETS.timer(body);
  tile.stop();
  p.answer();
  await settle();
  assert.equal(p.timers.size, 0, 'nothing is armed for a tile that is gone');
  // And a live one does run its clock.
  const q = page({ local: { widgetTimer: { phase: 'work', end: Date.now() + 10 * 6e4, left: 0 } } });
  q.ui.probe.WIDGETS.timer(new E());
  q.answer();
  await settle();
  assert.equal(q.timers.size, 1);
});

test('a note that did not save stays unsaved, and is tried again on blur and when the tile goes, three times at most', async () => {
  const p = page({ replies: [{ ok: false }, { ok: false }, { ok: true, kept: true }] });
  const body = new E();
  const tile = p.ui.probe.WIDGETS.notes(body);
  p.answer();
  await settle();
  const text = find(body, (e) => e.tagName === 'TEXTAREA');
  text.value = 'read chapter 4';
  text.fire('input');
  text.fire('blur');
  await settle();
  assert.equal(p.sent.length, 1);
  text.fire('blur');
  await settle();
  assert.equal(p.sent.length, 2, 'tried again on blur');
  tile.stop();
  await settle();
  assert.equal(p.sent.length, 3, 'and when the tile goes');
  assert.ok(p.sent.every((m) => m.text === 'read chapter 4' && m.key === 'notes:https://canvas.test/3'));
  tile.stop();
  await settle();
  assert.equal(p.sent.length, 3, 'saved: nothing more to send');

  const q = page({ replies: [{ ok: false }, { ok: false }, { ok: false }, { ok: false }] });
  const b2 = new E();
  const t2 = q.ui.probe.WIDGETS.notes(b2);
  q.answer();
  await settle();
  const ta = find(b2, (e) => e.tagName === 'TEXTAREA');
  ta.value = 'x';
  ta.fire('input');
  for (let i = 0; i < 5; i++) { ta.fire('blur'); await settle(); }
  t2.stop();
  await settle();
  assert.equal(q.sent.length, 3, 'bounded');
});

test('a note is stamped when it is typed, not when it is saved', async () => {
  const clock = { t: 1000 };
  const p = page({ clock });
  const body = new E();
  p.ui.probe.WIDGETS.notes(body);
  p.answer();
  await settle();
  const text = find(body, (e) => e.tagName === 'TEXTAREA');
  text.value = 'typed at 1000';
  text.fire('input');
  clock.t = 1600; // the autosave's turn comes later
  for (const [, x] of p.timers) x.f();
  await settle();
  assert.deepEqual(p.sent.map((m) => [m.text, m.at]), [['typed at 1000', 1000]]);
});

test('a floating widget is never wider or taller than the window, whatever its size', () => {
  const css = read('canvas.css');
  for (const sel of ['#gz-float .gz-w {', '#gz-float .gz-w[data-size="m"] {', '#gz-float .gz-w[data-size="l"] {']) {
    const rule = css.slice(css.indexOf(sel), css.indexOf('}', css.indexOf(sel)));
    assert.match(rule, /width: min\([^;]+, calc\(100vw - 24px\)\)/, sel);
  }
  assert.match(css.slice(css.indexOf('#gz-float .gz-w {')), /^[^}]*max-height: calc\(100vh - 24px\)/);
});

test('the grid shows tiles in their saved order, which is also the keyboard and screen-reader order', () => {
  // grid-auto-flow: dense would fill gaps with later tiles, so what you see would not be the order you set or tab through.
  const css = read('canvas.css');
  const rules = [...css.matchAll(/([^{}]*\.gz-dash-grid[^{}]*)\{([^}]*)\}/g)];
  assert.ok(rules.length);
  for (const [, sel, body] of rules) assert.doesNotMatch(body, /grid-auto-flow:\s*[^;]*dense/, sel.trim());
});

test('a save confirmed after a newer edit confirms only itself, and the newer edit is saved next', async () => {
  const clock = { t: 100 };
  const p = page({ clock, hold: true });
  const body = new E();
  p.ui.probe.WIDGETS.notes(body);
  p.answer();
  await settle();
  const text = find(body, (e) => e.tagName === 'TEXTAREA');
  const view = find(body, (e) => e.className === 'gz-w-note-view');
  // A typed at 100 and saved on blur; its answer is still on its way.
  view.fire('click');
  text.value = 'A';
  text.fire('input');
  text.fire('blur');
  assert.deepEqual(p.sent.map((m) => [m.text, m.at]), [['A', 100]]);
  // B typed at 200 and blurred while A is saving.
  clock.t = 200;
  view.fire('click');
  text.value = 'B';
  text.fire('input');
  text.fire('blur');
  assert.equal(p.sent.length, 1, 'one save at a time');
  // A is confirmed: that confirms A only, and B goes next with its own time.
  p.held.shift()();
  await settle();
  assert.deepEqual(p.sent.map((m) => [m.text, m.at]), [['A', 100], ['B', 200]]);
  p.held.shift()();
  await settle();
  view.fire('click');
  assert.equal(text.value, 'B', 'reopening shows the newest text');
  text.fire('blur');
  await settle();
  assert.equal(p.sent.length, 2, 'nothing left to save, and A is never sent again');
});

test('a newer note from another tab, stored while a save is on its way, is not undone by that save\'s answer', async () => {
  const clock = { t: 100 };
  const p = page({ clock, hold: true });
  const body = new E();
  p.ui.probe.WIDGETS.notes(body);
  p.answer();
  await settle();
  const text = find(body, (e) => e.tagName === 'TEXTAREA');
  const view = find(body, (e) => e.className === 'gz-w-note-view');
  view.fire('click');
  text.value = 'A';
  text.fire('input');
  text.fire('blur');
  assert.deepEqual(p.sent.map((m) => [m.text, m.at]), [['A', 100]]);
  // Another tab's C@300 lands in storage before A's answer comes back.
  const key = 'notes:https://canvas.test/3';
  for (const f of [...p.listeners]) f({ [key]: { oldValue: { text: 'A', at: 100 }, newValue: { text: 'C', at: 300 } } }, 'local');
  p.held.shift()();
  await settle();
  view.fire('click');
  assert.equal(text.value, 'C', 'the newest stored note, not the older one just confirmed');
  text.fire('blur');
  await settle();
  assert.equal(p.sent.length, 1, 'and nothing is sent over it');
  // A local draft newer than C still wins over it.
  clock.t = 400;
  view.fire('click');
  text.value = 'D';
  text.fire('input');
  text.fire('blur');
  for (const f of [...p.listeners]) f({ [key]: { oldValue: null, newValue: { text: 'C', at: 300 } } }, 'local');
  p.held.shift()();
  await settle();
  view.fire('click');
  assert.equal(text.value, 'D');
});
