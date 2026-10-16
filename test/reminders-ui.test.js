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
const C = require('../lib/classes.js');

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
  get firstChild() { return this.children[0] || null; }
  showModal() {}
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
  // A tab's own hold: its answers wait for its release(). failConfirm: the worker can't keep its acknowledgements.
  // gs: a stored Gradescope record (lib/gradescope.js), with enhance.gradescope on.
  w.tab = ({ hidden = false, pathname = '/courses/25/assignments', enhance = {}, cards = false, hold = false, gs = null } = {}) => {
    if (gs) box.gradescope = structuredClone(gs);
    const changed = [];
    const own = { hold, waiting: [], failConfirm: false };
    const timers = [];
    const docOn = {};
    const body = new E('body');
    const document = {
      visibilityState: hidden ? 'hidden' : 'visible', body, activeElement: body,
      createElement: (t) => new E(t), createElementNS: (ns, t) => new E(t), querySelector: (sel) => (cards && sel === '.ic-DashboardCard' ? new E() : null),
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
      GZ_SANITIZE: D.GZ_SANITIZE, GZ_I18N: { locale: () => 'en' }, GZ_TODO: T, GZ_REMIND: R, GZ_CLASSES: C,
      GZ_CTX: {
        t: (k, v) => k.replace(/\{(\w+)\}/g, (_, n) => v?.[n] ?? ''), locale: () => 'en', need: async () => {},
        profile: async () => ({ id: 3, time_zone: 'America/New_York' }), canvasCourses: async () => [{ id: '25', name: 'Biology' }],
        settings: () => ({ enhance: { remind: true, remindExam: false, remindPlan: false, streak: false, todo: false, cardTasks: false, gradescope: !!gs, ...enhance } }),
      },
      chrome: {
        runtime: {
          lastError: null,
          sendMessage: (m, cb) => {
            sent.push(m);
            if (m.type === 'glaze:gradescope') {
              return c.GZ_GRADESCOPE.change(structuredClone(m), area).then((r) => {
                if (r.ok) for (const f of changed) f({ gradescope: { newValue: structuredClone(box.gradescope) } }, 'local');
                cb?.(r);
              });
            }
            if (m.type !== 'glaze:remind') return cb?.(null);
            const run = () => (m.op === 'confirm' && own.failConfirm ? { ok: false, error: 'write' } : R.change(m, area, w.now()));
            // The worker's queue moves on; only this answer's delivery waits.
            turn = turn.then(run);
            turn.then((r) => (w.hold || own.hold ? new Promise((y) => (own.hold ? own.waiting : w.waiting).push(() => y(r))) : r)).then(cb);
          },
        },
        storage: { local: { get: (ks, cb) => area.local.get(ks).then(cb) }, sync: { get: (ks, cb) => cb({}) }, onChanged: { addListener: (f) => changed.push(f) } },
      },
    };
    c.globalThis = c;
    vm.createContext(c);
    if (gs) {
      // lib/todo.js's Gradescope parts use the page's own globals (GZ_CTX, document): here it runs in the page's VM.
      delete c.GZ_TODO;
      c.GZ_SPEC = D.GZ_SPEC;
      for (const f of ['lib/todo.js', 'lib/gradescope.js']) vm.runInContext(read(f), c);
    }
    const ui = vm.runInContext(read('features/reminders.js'), c);
    const toast = () => body.children[0]?.children[0] || null;
    const ops = (op) => sent.filter((m) => m.op === op);
    own.release = () => { own.hold = false; for (const f of own.waiting.splice(0)) f(); };
    return { own, ui, timers, sent, ops, fetched, toast, document, location, docOn, live: () => timers.filter((x) => !x.cleared) };
  };
  w.box = box;
  w.area = area;
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
  const cards = world(2 * 36e5, { cacheAge: stale }).tab({ pathname: '/', enhance: { cardTasks: true }, cards: true });
  cards.ui.sync(true);
  await settle();
  assert.deepEqual(cards.fetched, []);
  // The Dashboard's list view has no course cards, so no card tasks: with To Do off, it asks for itself.
  const listView = world(2 * 36e5, { cacheAge: stale }).tab({ pathname: '/', enhance: { cardTasks: true } });
  listView.ui.sync(true);
  await settle();
  assert.equal(listView.fetched.length, 1);
  // Within ten minutes of the last answer, it doesn't.
  const fresh = world(2 * 36e5, { cacheAge: 5 * 6e4 }).tab({ pathname: '/', enhance: { cardTasks: true } });
  fresh.ui.sync(true);
  await settle();
  assert.deepEqual(fresh.fetched, []);
  // On a page neither runs on, it asks for itself.
  const own = world(2 * 36e5, { cacheAge: stale }).tab({ pathname: '/courses/25/assignments', enhance: { todo: true } });
  own.ui.sync(true);
  await settle();
  assert.equal(own.fetched.length, 1);
  assert.match(own.fetched[0], /\/api\/v1\/planner\/items\?/);
});

// The Dashboard in its planner (list) view still holds Canvas's course-card skeletons, hidden: content-canvas.js's gate
// (syncCardTasks: cardsHere and a .ic-DashboardCard on the page) starts the card tasks there, and they ask the planner.
// So reminders leave it to them, and the planner is asked once, not twice.
test("the Dashboard's planner view: card tasks run and ask, reminders don't: one planner request", async () => {
  const html = read('test/fixtures/canvas-dashboard-planner.html');
  assert.match(html, /id="DashboardCard_Container" style="display: none;?"/, 'the fixture is the planner view');
  const has = (sel) => (sel === '.ic-DashboardCard' && /class="ic-DashboardCard"/.test(html) ? {} : null);
  // Canvas's part's own gate (content-canvas.js), run over that page.
  const src = read('content-canvas.js');
  const line = (name) => src.match(new RegExp(`^  const ${name} = \\(\\) => [^\\n]*;$`, 'm'))[0];
  const started = [];
  const CT = { sync: (on) => started.push(on) };
  vm.runInNewContext(`${line('cardsHere')} ${line('syncCardTasks')} syncCardTasks()`, {
    I: { links: [{}], settings: { enhance: { cardTasks: true } } }, location: { pathname: '/' },
    document: { querySelector: has }, need: async () => {}, globalThis: { GZ_CARD_TASKS: CT }, GZ_CARD_TASKS: CT,
  });
  await settle();
  assert.deepEqual(started, [true], 'card tasks start in planner view');
  // Both on that page, the shared planner copy stale: reminders first (the worse order), then the card tasks.
  const w = world(2 * 36e5, { cacheAge: 20 * 6e4 });
  const r = w.tab({ pathname: '/', enhance: { cardTasks: true }, cards: !!has('.ic-DashboardCard') });
  r.ui.sync(true);
  await settle();
  const fetched = [];
  const c = {
    console, URL, Intl, Date, Set, Map, JSON, Promise, Error,
    GZ_SANITIZE: D.GZ_SANITIZE, GZ_I18N: { locale: () => 'en' }, GZ_CANVAS_DUE_WEEK: () => [], GZ_TODO: T,
    GZ_CTX: { t: (k) => k, locale: () => 'en', need: async () => {}, canvasCourses: async () => [{ id: '25', name: 'Biology' }], profile: async () => ({ id: 3, time_zone: 'America/New_York' }) },
    location: { origin: ORIGIN, pathname: '/' },
    fetch: async (u) => { fetched.push(u); return { ok: true, text: async () => '[]', headers: { get: () => null } }; },
    chrome: {
      runtime: { sendMessage: (m, cb) => { T.change(structuredClone(m), w.area).then(cb); } },
      storage: { local: { get: (k, cb) => w.area.local.get(k).then(cb) }, sync: { get: (k, cb) => cb({}) }, onChanged: { addListener() {} } },
    },
    document: { visibilityState: 'visible', addEventListener() {}, getElementById: () => null, querySelectorAll: () => [], createElement: (t) => new E(t) },
    addEventListener() {}, setTimeout,
  };
  c.globalThis = c;
  vm.createContext(c);
  vm.runInContext(read('features/cardtasks.js'), c).sync(true);
  await settle();
  const planner = (l) => l.filter((u) => u.includes('/api/v1/planner/items')).length;
  assert.equal(planner(fetched), 1, 'the card tasks asked');
  assert.equal(planner(r.fetched) + planner(fetched), 1);
});

test("a claim answered after its lease ended draws nothing: the tab that took it over showed it", async () => {
  const w = world(2 * 36e5);
  const a = w.tab({ hold: true });
  a.ui.sync(true);
  await settle();
  assert.equal(a.ops('claim').length, 1);
  // A's answer is held past its lease; B claims, draws and confirms meanwhile.
  w.skew = R.LEASE + 1;
  const b = w.tab();
  b.ui.sync(true);
  await settle();
  assert.match(b.toast()?.text || '', /Lab report/);
  assert.equal(Object.keys(w.box[KEY].seen).length, 1);
  a.own.release();
  await settle();
  assert.equal(a.toast(), null, 'no second toast');
  assert.equal(a.ops('confirm').length, 0);
});

test("an acknowledgement that wasn't kept is sent again, and the toast isn't drawn again", async () => {
  const w = world(2 * 36e5);
  const a = w.tab();
  a.own.failConfirm = true;
  a.ui.sync(true);
  await settle();
  const card = a.toast();
  assert.match(card?.text || '', /Lab report/);
  assert.deepEqual([a.ops('claim').length, a.ops('confirm').length], [1, 1]);
  assert.deepEqual(w.box[KEY].seen, {});
  // A lease later, the worker keeps it: only the acknowledgement goes again, under the same lease.
  a.own.failConfirm = false;
  w.skew = R.LEASE + 1;
  a.live().at(-1).f();
  await settle();
  assert.deepEqual([a.ops('claim').length, a.ops('confirm').length], [1, 2]);
  assert.equal(a.ops('confirm')[1].lease, a.ops('confirm')[0].lease);
  assert.equal(a.toast(), card, 'the same toast, not announced again');
  assert.equal(Object.keys(w.box[KEY].seen).length, 1);
});

test('an acknowledgement past the lease and its grace is not taken as one, and nothing this page drew is drawn again', async () => {
  const w = world(2 * 36e5);
  const a = w.tab();
  a.own.failConfirm = true;
  a.ui.sync(true);
  await settle();
  const card = a.toast();
  assert.match(card?.text || '', /Lab report/);
  // The worker comes back after the lease and its grace have gone: a confirm under the old lease keeps nothing.
  a.own.failConfirm = false;
  w.skew = 2 * R.LEASE + 1;
  a.live().at(-1).f();
  await settle();
  assert.equal(a.toast(), card, 'drawn once');
  assert.equal(Object.keys(w.box[KEY].seen).length, 1, 'acknowledged under a new, quiet lease');
  // Passes after that draw nothing and claim nothing.
  const claims = a.ops('claim').length;
  a.docOn.visibilitychange();
  await settle();
  assert.equal(a.toast(), card);
  assert.equal(a.ops('claim').length, claims);
});

test('snoozed for an hour on the same page: it comes back once, after the hour', async () => {
  const w = world(2 * 36e5);
  const a = w.tab();
  a.ui.sync(true);
  await settle();
  const first = a.toast();
  const id = first.dataset.id;
  assert.ok(id);
  // The student's own click on "Snooze 1 hour".
  const target = { closest: (sel) => (sel === '[data-act]' ? { dataset: { act: 'snooze' } } : { dataset: { id } }) };
  a.document.body.children[0].on.click({ target, isTrusted: true });
  await settle();
  assert.equal(a.toast(), null);
  assert.equal(w.box[KEY].snooze[id] > 0, true);
  // Within the hour: nothing. After it: the same reminder, drawn once more.
  a.live().at(-1).f();
  await settle();
  assert.equal(a.toast(), null);
  w.skew = 36e5 + 1;
  a.live().at(-1).f();
  await settle();
  const again = a.toast();
  assert.ok(again && again !== first);
  assert.equal(again.dataset.id, id);
  a.docOn.visibilitychange();
  await settle();
  assert.equal(a.toast(), again, 'once');
  assert.equal(a.ops('claim').length, 2);
});

test('a worker that never keeps the acknowledgement gets five retries, a lease apart, and then none from this page', async () => {
  const w = world(2 * 36e5);
  const a = w.tab();
  a.own.failConfirm = true;
  a.ui.sync(true);
  await settle();
  const card = a.toast();
  assert.equal(a.ops('confirm').length, 1);
  for (let i = 1; i <= 5; i++) {
    const t = a.live().at(-1);
    assert.ok(t && t.ms >= R.LEASE - 1000, `retry ${i} waits a lease`);
    w.skew = i * (R.LEASE + 1);
    t.f();
    await settle();
    assert.equal(a.ops('confirm').length, 1 + i);
  }
  // Given up: no more confirms, no claim, no second toast, whatever wakes the page however much later.
  w.skew = 8 * (R.LEASE + 1);
  a.docOn.visibilitychange();
  await settle();
  for (const t of a.live()) t.f();
  await settle();
  assert.equal(a.ops('confirm').length, 6);
  assert.equal(a.ops('claim').length, 1);
  assert.equal(a.toast(), card);
  assert.deepEqual(w.box[KEY].seen, {});
});

// Gradescope (lib/gradescope.js): the one-time question is asked in the hub too, quietly, never as a toast; one answer.
const GS_ID = '0123456789abcdef01234567';
const gsRecord = (bind = {}) => ({
  acct: { id: GS_ID, name: 'Sam' }, map: { 77: { to: `canvas:${ORIGIN}/25`, name: 'BIO' } }, bind,
  courses: { 77: { at: NOW, bad: 0, rows: [{ id: '501', title: 'Gradescope lab', due: NOW + 1.5 * 36e5, late: null, sub: false, graded: false, score: null, points: null, lateSub: false }] } },
});
const hubOf = (t) => t.document.body.children.find((x) => x.id === 'gz-rm');
const askIn = (hub) => hub?.children[0]?.children.find((x) => typeof x === 'object' && String(x.className).split(' ').includes('gz-gs-ask'));

test('Gradescope: the hub asks once whether to show it, the answer is kept for this Canvas account, and no toast ever asks', async () => {
  const w = world(30 * 864e5); // nothing of Canvas's due soon
  const a = w.tab({ gs: gsRecord() });
  a.ui.sync(true);
  await settle();
  a.ui.sync(true);
  await settle();
  assert.equal(a.toast(), null, 'no toast: not for the question, nor for work not yet shown');
  a.ui.cmds()[0].run();
  await settle();
  const ask = askIn(hubOf(a));
  assert.ok(ask, 'asked in the hub');
  assert.equal(ask.children[0].textContent, 'Show Gradescope work from Sam here?');
  ask.children[1].on.click({ isTrusted: false, preventDefault() {}, stopPropagation() {} });
  await settle();
  assert.equal(w.box.gradescope.bind[`${ORIGIN}/3`], undefined, "a script's click answers nothing");
  ask.children[1].on.click({ isTrusted: true, preventDefault() {}, stopPropagation() {} });
  await settle();
  assert.deepEqual(w.box.gradescope.bind[`${ORIGIN}/3`], { id: GS_ID, show: true });
  assert.equal(askIn(hubOf(a)), undefined, 'answered: the line goes');
  // Now the Gradescope work is reminded of like the rest: due in an hour and a half, its three-hour reminder is claimed.
  const gsClaims = (t) => t.ops('claim').flatMap((m) => m.ids).filter((id) => id.startsWith('gradescope:501@'));
  assert.ok(gsClaims(a).length > 0);
  // Answered (here or anywhere) means no question in another tab's hub either.
  const b = w.tab({ gs: w.box.gradescope });
  b.ui.sync(true);
  await settle();
  b.ui.sync(true);
  await settle();
  b.ui.cmds()[0].run();
  await settle();
  assert.equal(askIn(hubOf(b)), undefined);
});

test('Gradescope: "Not here" in the hub hides it everywhere, and nothing from it is reminded of', async () => {
  const w = world(30 * 864e5);
  const a = w.tab({ gs: gsRecord() });
  a.ui.sync(true);
  await settle();
  a.ui.sync(true);
  await settle();
  a.ui.cmds()[0].run();
  await settle();
  askIn(hubOf(a)).children[2].on.click({ isTrusted: true, preventDefault() {}, stopPropagation() {} });
  await settle();
  assert.deepEqual(w.box.gradescope.bind[`${ORIGIN}/3`], { id: GS_ID, show: false });
  assert.equal(askIn(hubOf(a)), undefined);
  assert.deepEqual(a.ops('claim').flatMap((m) => m.ids).filter((id) => id.startsWith('gradescope:')), [], 'never reminded of');
});

test('class start (W14): a class in the class schedule reminds its lead time before, only with its own switch on', async () => {
  const w = world(30 * 864e5, { cacheAge: 36e5 }); // nothing due soon, and Better To Do's copy is an hour old
  const tz = 'America/New_York';
  const at = Date.now() + 8 * 6e4;
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', weekday: 'short', hour: 'numeric', minute: 'numeric' }).formatToParts(at).map((x) => [x.type, x.value]));
  const start = +p.hour * 60 + +p.minute;
  w.box[C.storeKey(ORIGIN, '3')] = { courses: [{ id: '25', code: 'BIO 1100', name: 'Biology', periods: [{ days: [['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday)], start, end: Math.min(start + 50, 1439), loc: 'Room 9', from: '', to: '', skip: [] }] }] };
  const off = w.tab({ enhance: { remind: true } });
  off.ui.sync(true);
  await settle();
  assert.equal(off.toast(), null, 'class reminders are off');
  const on = w.tab({ enhance: { remind: false, remindClass: true } });
  on.ui.sync(true);
  await settle();
  // The lead time can cross midnight; this checks the class reminder, not its relative-date wording.
  assert.match(on.toast()?.text || '', /Class .*Biology Room 9/);
  assert.equal(on.ops('confirm').length, 1);
  // Class reminders alone ask Canvas for nothing (Codex W14 review): not the planner, however old its copy.
  assert.deepEqual(on.fetched, []);
  assert.ok(off.fetched.length > 0, 'due-date reminders do ask, with the copy that old');
});


test('NEW-1: W11 persists calculated day even when start and best do not change', async () => {
  const w = world(5 * 864e5);
  const today = T.dayOf(w.now(), 'America/New_York');
  w.box[KEY] = { streak: { start: today - 20, best: 100, asOf: today - 1 } };
  const a = w.tab({ enhance: { remind: false, streak: true } });
  a.ui.sync(true); await settle();
  assert.equal(a.ops('streak').length, 1);
  assert.equal(w.box[KEY].streak.asOf, today);
  a.ui.sync(true); await settle();
  assert.equal(a.ops('streak').length, 1, 'same day does not rewrite');
  w.skew += 864e5;
  a.live().at(-1).f(); await settle();
  assert.equal(a.ops('streak').length, 2);
  assert.equal(w.box[KEY].streak.asOf, today + 1);
  a.ui.sync(false);
});
