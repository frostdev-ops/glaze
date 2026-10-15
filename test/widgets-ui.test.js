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

// ultra: Blackboard Ultra instead, its planner (lib/ultra.js) answering with ultra.items and recording what it was asked.
const page = ({ local = {}, replies = [], clock = { t: Date.now() }, hold = false, tz = 'UTC', ultra = null } = {}) => {
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
    GZ_TODO: require('../lib/todo.js'), GZ_CLASSES: require('../lib/classes.js'),
    GZ_CTX: { t: (k) => k, locale: () => 'en', need: async () => {}, capi: async () => [], settings: () => ({ enhance: { notes: true, widgets: true } }), profile: async () => ({ id: '3', time_zone: tz }),
      ...(ultra && { site: 'ultra', capi: () => { throw new Error('not on Ultra'); }, profile: () => { throw new Error('not on Ultra'); } }) },
    ...(ultra && { GZ_ULTRA: { read: ({ origin }) => ({ origin, me: async () => '_5_1' }), planner: async (r, range) => { ultra.asked.push({ origin: r.origin, ...range }); return { items: ultra.items, complete: true }; } } }),
    location: ultra ? { origin: 'https://school.blackboard.test', pathname: '/ultra/course' } : { origin: 'https://canvas.test', pathname: '/' },
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
  const src = read('features/widgets.js').replace('  return { sync, hub: open, register, who: account };', '  return { sync, hub: open, register, who: account, probe: { WIDGETS, set: (w, s, m) => { W = w; o = s; me = m; } } };');
  assert.notEqual(src, read('features/widgets.js'));
  const ui = vm.runInContext(src, c);
  ui.probe.set(W, D.GZ_SANITIZE({}).widgets, { uid: ultra ? '_5_1' : '3', tz: ultra ? undefined : 'UTC' });
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
  const css = read('features/apps.css');
  for (const sel of ['#gz-float .gz-w {', '#gz-float .gz-w[data-size="m"] {', '#gz-float .gz-w[data-size="l"] {']) {
    const rule = css.slice(css.indexOf(sel), css.indexOf('}', css.indexOf(sel)));
    assert.match(rule, /width: min\([^;]+, calc\(100vw - 24px\)\)/, sel);
  }
  assert.match(css.slice(css.indexOf('#gz-float .gz-w {')), /^[^}]*max-height: calc\(100vh - 24px\)/);
});

test('the grid shows tiles in their saved order, which is also the keyboard and screen-reader order', () => {
  // grid-auto-flow: dense would fill gaps with later tiles, so what you see would not be the order you set or tab through.
  const css = read('features/apps.css');
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

// Codex W14 review: the agenda shows a class on the day it happens for the student, by instant. A Thursday 23:00 class
// kept in Phoenix is Friday 02:00 for a Canvas profile in New York; kept in New York, it stays on Thursday at 23:00.
test('the agenda puts a class kept in another zone on the student\'s own day, at the student\'s clock time', async () => {
  const text = (el) => [el.textContent || '', ...(el.children || []).map((c) => (typeof c === 'object' ? text(c) : String(c)))].join(' ');
  const day = async (scheduleTz) => {
    const p = page({
      tz: 'America/New_York', clock: { t: Date.parse('2026-10-15T16:00:00Z') }, // Thursday noon in New York
      local: { 'classes:https://canvas.test/3': { tz: scheduleTz, courses: [{ id: 'o-lab', name: 'Night lab', periods: [{ days: [4], start: 1380, end: 1430, loc: '', from: '', to: '', skip: [] }] }] } },
    });
    const body = new E();
    p.ui.probe.WIDGETS.agenda(body);
    for (let i = 0; i < 4; i++) { p.answer(); await settle(); }
    const list = find(body, (e) => e.className === 'gz-w-agenda');
    const thursday = text(list);
    find(body, (e) => e.attrs?.['aria-label'] === 'Next day').fire('click');
    for (let i = 0; i < 4; i++) { p.answer(); await settle(); }
    return [thursday, text(list)];
  };
  const [phxThu, phxFri] = await day('America/Phoenix');
  assert.doesNotMatch(phxThu, /Night lab/, 'not on Thursday in New York');
  assert.match(phxFri, /Night lab/);
  assert.match(phxFri, /2:00\s?(?:AM\s?)?–\s?2:50\s?AM/, 'at 02:00 New York time');
  const [nyThu, nyFri] = await day('America/New_York');
  assert.match(nyThu, /Night lab/);
  assert.match(nyThu, /11:00\s?–\s?11:50\s?PM/);
  assert.doesNotMatch(nyFri, /Night lab/);
});

test("Ultra: the agenda reads the day from Ultra's To Do and calendar (lib/ultra.js), never Canvas's planner, and links into Ultra", async () => {
  const text = (el) => [el.textContent || '', ...(el.children || []).map((c) => (typeof c === 'object' ? text(c) : String(c)))].join(' ');
  const now = Date.parse('2026-10-15T16:00:00Z');
  const ultra = { asked: [], items: [
    { type: 'assignment', id: '_11_1', cid: '_7_1', course: 'Biology', title: 'Lab report', at: now + 36e5, url: '/ultra/redirect?redirectType=nautilus&courseId=_7_1&contentId=_3_1', sub: { submitted: true }, ov: null, allDay: false },
    { type: 'quiz', id: '_12_1', cid: '_7_1', course: 'Biology', title: 'Next week', at: now + 7 * 864e5, url: '/ultra/courses/_7_1/outline', sub: null, ov: null, allDay: false },
  ] };
  const p = page({ clock: { t: now }, ultra });
  const body = new E();
  p.ui.probe.WIDGETS.agenda(body);
  for (let i = 0; i < 4; i++) { p.answer(); await settle(); }
  const list = find(body, (e) => e.className === 'gz-w-agenda');
  assert.match(text(list), /Lab report/);
  assert.doesNotMatch(text(list), /Next week/, "only the day's");
  const link = find(list, (e) => e.tagName === 'A');
  assert.equal(link.href, '/ultra/redirect?redirectType=nautilus&courseId=_7_1&contentId=_3_1');
  assert.ok(find(list, (e) => e.tagName === 'LI' && 'done' in e.dataset), 'handed in: done');
  assert.equal(ultra.asked.length, 1);
  assert.equal(ultra.asked[0].origin, 'https://school.blackboard.test', "this Ultra site's own");
  assert.equal(ultra.asked[0].to - ultra.asked[0].from, 864e5, 'one day');
  // The day again within two minutes: not asked again.
  find(body, (e) => e.attrs?.['aria-label'] === 'Next day').fire('click');
  for (let i = 0; i < 4; i++) { p.answer(); await settle(); }
  find(body, (e) => e.attrs?.['aria-label'] === 'Previous day').fire('click');
  for (let i = 0; i < 4; i++) { p.answer(); await settle(); }
  assert.equal(ultra.asked.length, 2, 'the next day once, today from memory');
});

// B7b with B7c: the timer's changes go through the worker's one queue (glaze:widgetTimer), which the nav's timer shares;
// the page writes no widgetTimer of its own, and shows what the worker answers. No answer: nothing changed, it says so.
test('the timer asks the worker to start, pause and reset it, and shows its answer; without one it says nothing changed', async () => {
  const clock = { t: 1e12 };
  const running = { phase: 'work', end: clock.t + 25 * 6e4, left: 0 };
  const p = page({ clock, replies: [{ ok: true, timer: running }, { ok: false, error: 'busy' }, undefined] });
  const body = new E();
  p.ui.probe.WIDGETS.timer(body);
  p.answer();
  await settle();
  const start = find(body, (e) => e.className === 'gz-w-btn gz-w-main');
  const reset = find(body, (e) => e.tagName === 'BUTTON' && e.textContent === 'Reset');
  const status = find(body, (e) => e.className === 'gz-w-status');
  start.fire('click');
  await settle();
  assert.equal(JSON.stringify(p.sent.at(-1)), '{"type":"glaze:widgetTimer","op":"toggle"}');
  assert.equal(body.dataset.running, 'yes', "the worker's answer is shown");
  assert.equal(start.textContent, 'Pause');
  reset.fire('click');
  await settle();
  assert.equal(JSON.stringify(p.sent.at(-1)), '{"type":"glaze:widgetTimer","op":"reset"}');
  assert.match(status.textContent, /Nothing changed/);
  assert.equal(body.dataset.running, 'yes', 'still the stored state');
  start.fire('click');
  await settle();
  assert.match(status.textContent, /Nothing changed/, 'no answer at all: the same');
  assert.ok(!('widgetTimer' in p.local), 'the page itself never writes the timer');
});

// Codex B7b 6 (P2 4): Start's answer comes back after the nav reset the timer through the same queue. The stored state
// (idle) is newer than that answer, so the tile keeps showing it: Start, not Pause.
test("the timer never shows an answer older than what's stored since: a late Start after the nav's Reset stays reset", async () => {
  const clock = { t: 1e12 };
  const running = { phase: 'work', end: clock.t + 25 * 6e4, left: 0 };
  const p = page({ clock, hold: true, replies: [{ ok: true, timer: running }] });
  const body = new E();
  p.ui.probe.WIDGETS.timer(body);
  p.answer();
  await settle();
  const start = find(body, (e) => e.className === 'gz-w-btn gz-w-main');
  start.fire('click');
  // The worker stored Start's running timer, then the nav's Reset made it idle; both changes arrive first.
  for (const f of [...p.listeners]) f({ widgetTimer: { oldValue: W.IDLE, newValue: running } }, 'local');
  for (const f of [...p.listeners]) f({ widgetTimer: { oldValue: running, newValue: W.IDLE } }, 'local');
  assert.equal(start.textContent, 'Start');
  p.held.shift()(); // Start's answer, late
  await settle();
  assert.equal(start.textContent, 'Start', 'what is stored, not the late answer');
  assert.equal(body.dataset.running, 'no');
});
