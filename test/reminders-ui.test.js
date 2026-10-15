// Reminders on the page (features/reminders.js) in a VM with an inert DOM, storage and worker: one timer to the next
// reminder (never an interval), one toast in one tab for what came due, nothing in a hidden tab until it's shown, a
// reminder lost to no tab that closes or goes quiet mid-claim, and no planner request that To Do or the card tasks will make.
// What's due when is lib/remind.js, tested in remind.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const D = require('../defaults.js');
const T = require('../lib/todo.js');
const R = require('../lib/remind.js');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise(setImmediate); };
const NOW = Date.now();
const ORIGIN = 'https://canvas.test';
const TODO = T.storeKey(ORIGIN, '3');
const KEY = R.storeKey(ORIGIN, '3');

class E {
  constructor(tag = 'div') { this.tagName = tag.toUpperCase(); this.dataset = {}; this.children = []; this.attrs = {}; this.on = {}; }
  append(...xs) { for (const x of xs) { if (typeof x === 'object') x.parent = this; this.children.push(x); } }
  replaceChildren(...xs) { this.children = []; this.append(...xs); }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k] ?? null; }
  addEventListener(t, f) { this.on[t] = f; }
  get isConnected() { return !!this.parent; }
  contains(x) { return x === this || this.children.some((c) => c?.contains?.(x)); }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this); this.parent = null; }
  focus() {}
  get text() { return [this.textContent || '', ...this.children.map((c) => (typeof c === 'object' ? c.text : String(c)))].join(' ').trim(); }
}

// One stored world (storage.local, the worker's queue, a clock both share) and as many tabs on it as a test opens.
// hold: the worker's answers wait until release(), as a slow worker's would.
const world = (dueIn, { cacheAge = 0 } = {}) => {
  const w = { skew: 0, hold: false, waiting: [] };
  w.now = () => Date.now() + w.skew;
  const box = {
    todoCache: { key: TODO, at: NOW - cacheAge, start: new Date(NOW - 8 * 864e5).toISOString(), end: new Date(NOW + 9 * 864e5).toISOString(), teach: true, progress: true, grading: [], sums: {},
      items: [{ type: 'assignment', id: '7', cid: '25', course: 'Biology', title: 'Lab report', at: NOW + dueIn, url: '/courses/25/assignments/7', sub: { submitted: false }, ov: null }] },
  };
  const area = { local: { get: async (ks) => Object.fromEntries(ks.filter((k) => k in box).map((k) => [k, structuredClone(box[k])])), set: async (p) => { Object.assign(box, structuredClone(p)); return true; } } };
  let turn = Promise.resolve();
  w.release = () => { for (const f of w.waiting.splice(0)) f(); };
  const Clock = class extends Date { static now() { return w.now(); } };
  w.tab = ({ hidden = false, pathname = '/courses/25/assignments', enhance = {} } = {}) => {
    const timers = [];
    const docOn = {};
    const body = new E('body');
    const document = {
      visibilityState: hidden ? 'hidden' : 'visible', body, activeElement: body,
      createElement: (t) => new E(t), createElementNS: (ns, t) => new E(t), querySelector: () => null,
      addEventListener: (t, f) => { docOn[t] = f; },
    };
    const sent = [];
    const fetched = [];
    const location = { origin: ORIGIN, pathname };
    const c = {
      console, URL, Intl, Date: Clock, Set, Map, JSON, Promise, Error, Math, Object, Array, String, Number, crypto,
      document, location, navigator: {}, addEventListener() {},
      fetch: async (u) => { fetched.push(u); throw new Error('offline'); },
      setTimeout: (f, ms) => { timers.push({ f, ms }); return timers.length; }, clearTimeout: (id) => { if (timers[id - 1]) timers[id - 1].cleared = true; },
      setInterval: () => { throw new Error('no intervals'); },
      GZ_SANITIZE: D.GZ_SANITIZE, GZ_I18N: { locale: () => 'en' }, GZ_TODO: T, GZ_REMIND: R,
      GZ_CTX: {
        t: (k, v) => k.replace(/\{(\w+)\}/g, (_, n) => v?.[n] ?? ''), locale: () => 'en', need: async () => {},
        profile: async () => ({ id: 3, time_zone: 'America/New_York' }), canvasCourses: async () => [{ id: '25', name: 'Biology' }],
        settings: () => ({ enhance: { remind: true, remindExam: false, remindPlan: false, streak: false, todo: false, cardTasks: false, ...enhance } }),
      },
      chrome: {
        runtime: {
          lastError: null,
          sendMessage: (m, cb) => {
            sent.push(m);
            if (m.type !== 'glaze:remind') return cb?.(null);
            turn = turn.then(() => R.change(m, area, w.now())).then((r) => (w.hold ? new Promise((y) => w.waiting.push(() => y(r))) : r)).then(cb);
          },
        },
        storage: { local: { get: (ks, cb) => area.local.get(ks).then(cb) }, sync: { get: (ks, cb) => cb({}) }, onChanged: { addListener() {} } },
      },
    };
    c.globalThis = c;
    vm.createContext(c);
    const ui = vm.runInContext(read('features/reminders.js'), c);
    const toast = () => body.children[0]?.children[0] || null;
    const ops = (op) => sent.filter((m) => m.op === op);
    return { ui, timers, sent, ops, fetched, toast, document, location, docOn, live: () => timers.filter((x) => !x.cleared) };
  };
  w.box = box;
  return w;
};

test('one toast for what came due, in one tab, and one timer to the next reminder', async () => {
  const w = world(2 * 36e5); // due in two hours: three hours before has passed
  const a = w.tab();
  a.ui.sync(true);
  await settle();
  assert.match(a.toast()?.text || '', /Due .*Lab report/);
  assert.equal(a.toast().getAttribute('aria-label'), 'Glaze reminder');
  assert.equal(a.document.body.children[0].getAttribute('aria-live'), 'polite');
  assert.equal(a.document.activeElement, a.document.body, 'a toast never takes focus');
  assert.equal(a.ops('confirm').length, 1, 'shown, then confirmed');
  // Nothing else to fire before the deadline: no timer at all. Another tab on the same device: nothing again.
  assert.equal(a.live().length, 0);
  const b = w.tab();
  b.ui.sync(true);
  await settle();
  assert.equal(b.toast(), null);
  assert.equal(Object.keys(w.box[KEY].seen).length, 1);
});

test('a hidden tab waits, and shows it once it is looked at; a reminder still to come arms one timeout', async () => {
  const w = world(5 * 36e5); // three hours before is two hours away
  const a = w.tab();
  a.ui.sync(true);
  await settle();
  assert.equal(a.toast(), null);
  const armed = a.live();
  assert.equal(armed.length, 1);
  assert.ok(armed[0].ms <= 6e5, 'at most ten minutes, so a sleeping computer catches up');
  // Due now, but the tab is hidden: nothing until it's shown.
  const h = world(36e5).tab({ hidden: true });
  h.ui.sync(true);
  await settle();
  assert.equal(h.toast(), null);
  assert.equal(h.ops('claim').length, 0);
  h.document.visibilityState = 'visible';
  h.docOn.visibilitychange();
  await settle();
  assert.match(h.toast()?.text || '', /Lab report/);
  // Turned off: the toast and the timer go.
  a.ui.sync(false);
  assert.equal(a.live().length, 0);
});

test('a tab turned off while its claim is answered shows and confirms nothing, and another tab shows it once the lease runs out', async () => {
  const w = world(2 * 36e5);
  w.hold = true;
  const a = w.tab();
  a.ui.sync(true);
  await settle();
  assert.equal(a.ops('claim').length, 1);
  a.ui.sync(false);
  w.release();
  await settle();
  assert.equal(a.toast(), null);
  assert.equal(a.ops('confirm').length, 0);
  assert.deepEqual(w.box[KEY].seen, {}, 'not lost: nobody saw it');
  w.hold = false;
  const b = w.tab();
  b.ui.sync(true);
  await settle();
  assert.equal(b.toast(), null, "a's lease still stands");
  assert.ok(b.live().some((x) => x.ms <= R.LEASE + 1000), 'b wakes when it runs out');
  w.skew = R.LEASE + 1;
  b.live().at(-1).f();
  await settle();
  assert.match(b.toast()?.text || '', /Lab report/);
  assert.equal(Object.keys(w.box[KEY].seen).length, 1);
});

test('a tab hidden while its claim is answered shows nothing until it is looked at again', async () => {
  const w = world(2 * 36e5);
  w.hold = true;
  const a = w.tab();
  a.ui.sync(true);
  await settle();
  a.document.visibilityState = 'hidden';
  w.release();
  await settle();
  assert.equal(a.toast(), null);
  assert.equal(a.ops('confirm').length, 0);
  w.hold = false;
  a.document.visibilityState = 'visible';
  a.docOn.visibilitychange();
  await settle();
  assert.match(a.toast()?.text || '', /Lab report/);
  assert.equal(a.ops('confirm').length, 1);
});

test('a quiz being taken by the time the claim is answered gets no toast', async () => {
  const w = world(2 * 36e5);
  w.hold = true;
  const a = w.tab();
  a.ui.sync(true);
  await settle();
  a.location.pathname = '/courses/25/quizzes/4/take';
  w.release();
  await settle();
  assert.equal(a.toast(), null);
  assert.equal(a.ops('confirm').length, 0);
  assert.deepEqual(w.box[KEY].seen, {});
});

test('no planner request where To Do or the card tasks will make it, drawn yet or not', async () => {
  const stale = 20 * 6e4;
  const list = world(2 * 36e5, { cacheAge: stale }).tab({ pathname: '/', enhance: { todo: true } });
  list.ui.sync(true);
  await settle();
  assert.deepEqual(list.fetched, []);
  const cards = world(2 * 36e5, { cacheAge: stale }).tab({ pathname: '/', enhance: { cardTasks: true } });
  cards.ui.sync(true);
  await settle();
  assert.deepEqual(cards.fetched, []);
  // On a page neither runs on, it asks for itself.
  const own = world(2 * 36e5, { cacheAge: stale }).tab({ pathname: '/courses/25/assignments', enhance: { todo: true } });
  own.ui.sync(true);
  await settle();
  assert.equal(own.fetched.length, 1);
  assert.match(own.fetched[0], /\/api\/v1\/planner\/items\?/);
});
