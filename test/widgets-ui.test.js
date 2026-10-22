// Dashboard widgets on a page (features/widgets.js) in a VM with an inert DOM, storage and timers: a tile that goes
// before its storage answers arms nothing, and a note that didn't save stays unsaved and is tried again.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const D = require('../defaults.js');
const W = require('../lib/widgets.js');

const read = (f) => process.env.GZ_P4_WIDGET_BASE && f === 'features/widgets.js'
  ? require('node:child_process').execFileSync('git', ['show', `${process.env.GZ_P4_WIDGET_BASE}:${f}`], { cwd: path.join(__dirname, '..'), encoding: 'utf8' })
  : fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
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

// Ultra uses the real shared profile/planner helper; only its own-site transport is synthetic and counted.
const page = ({ local = {}, sync = {}, replies = [], clock = { t: Date.now() }, hold = false, tz = 'UTC', ultra = null, capi = async () => [] } = {}) => {
  const held = []; // replies the test lets through by hand (hold)
  const FakeDate = class extends Date {};
  FakeDate.now = () => clock.t;
  const timers = new Map();
  let n = 0;
  const reads = [];
  const sent = [];
  const listeners = [];
  const c = {
    console, URL, URLSearchParams, Intl, Date: FakeDate, Map, Set, JSON, Promise, Error, Number, Math, Object, Array, String,
    GZ_SANITIZE: D.GZ_SANITIZE, GZ_I18N: { locale: () => 'en' },
    GZ_TODO: require('../lib/todo.js'), GZ_CLASSES: require('../lib/classes.js'),
    GZ_CTX: { t: (k) => k, locale: () => 'en', need: async () => {}, capi, settings: () => ({ enhance: { notes: true, widgets: true } }), profile: async () => ({ id: '3', time_zone: tz }),
      ...(ultra && { site: 'ultra', capi: () => { throw new Error('not on Ultra'); }, profile: () => { throw new Error('not on Ultra'); } }) },
    location: ultra ? { origin: 'https://school.blackboard.test', pathname: '/ultra/course' } : { origin: 'https://canvas.test', pathname: '/' },
    setTimeout: (f, ms) => { timers.set(++n, { f, ms }); return n; },
    clearTimeout: (id) => timers.delete(id),
    addEventListener() {}, removeEventListener() {},
    chrome: {
      runtime: { id: 'glaze', lastError: undefined, getURL: (p) => `chrome-extension://x/${p}`, getManifest: () => ({ version: '2.3.0' }), sendMessage: (m, cb) => { sent.push(m); const r = replies.shift() || { ok: true, kept: true }; if (hold) held.push(() => cb(r)); else Promise.resolve().then(() => cb(r)); } },
      storage: {
        local: { get: (keys, cb) => reads.push(() => cb(Object.fromEntries([keys].flat().filter((k) => k in local).map((k) => [k, local[k]])))), set: (v, cb) => { Object.assign(local, v); cb?.(); } },
        sync: { get: (k, cb) => cb(Object.fromEntries([k].flat().filter((x) => x in sync).map((x) => [x, sync[x]]))) },
        onChanged: { addListener: (f) => listeners.push(f), removeListener: (f) => listeners.splice(listeners.indexOf(f), 1) },
      },
    },
    document: { visibilityState: 'visible', createElement: (t) => new E(t), createTextNode: (data) => ({ data }), addEventListener() {} },
  };
  c.globalThis = c;
  vm.createContext(c);
  if (ultra) {
    ultra.requests = []; ultra.asked = []; ultra.pending = [];
    c.GZ_PAGE = require('../lib/page.js'); c.GZ_COURSES = D.GZ_COURSES;
    c.fetch = async (address, init) => {
      const u = new URL(address), uid = ultra.uid || '_5_1';
      assert.equal(u.origin, c.location.origin); assert.equal(init.credentials, 'same-origin');
      ultra.requests.push(u.pathname);
      let value;
      if (u.pathname === '/learn/api/v1/users/me') value = { id: uid };
      else if (u.pathname === `/learn/api/v1/users/${uid}/memberships`) value = { results: [] };
      else if (u.pathname.endsWith('/todo/studentItems')) {
        ultra.asked.push({ origin: u.origin, from: Date.parse(u.searchParams.get('since')), to: Date.parse(u.searchParams.get('until')) });
        if (ultra.holdTodo) await new Promise((resolve) => ultra.pending.push(resolve));
        if (ultra.failTodo) { ultra.failTodo--; throw new Error('planner unavailable'); }
        value = { dueTodayItems: (ultra.items || []).map((i) => ({ column: { id: i.id, courseId: i.cid }, title: i.title, dueDate: new Date(i.at).toISOString() })) };
      } else if (u.pathname.endsWith('/calendarItems')) value = { results: [] };
      else if (u.pathname.endsWith('/gradebook/grades')) value = { results: (ultra.items || []).map((i) => ({ columnId: i.id, column: { contentId: i.content, dueDate: new Date(i.at).toISOString() }, submissionStatus: { status: i.sub?.submitted ? 'SUBMITTED' : 'UNOPENED' } })) };
      else throw new Error(`unexpected Ultra API: ${u.pathname}`);
      return { ok: true, text: async () => JSON.stringify(value) };
    };
    vm.runInContext(read('lib/ultra.js'), c);
  }
  // The widgets themselves, reached as todo-ui.test.js reaches the list's insides: through the source's return.
  const src = read('features/widgets.js').replace('  return { sync, cover, hub: open, register, declare, who: account, avatar, catalog };', '  return { sync, cover, hub: open, register, declare, who: account, avatar, catalog, probe: { WIDGETS, tileEl, added, tiles, draw, onShow, seatAfter: typeof seatAfter === "function" ? seatAfter : null, layout: (x) => { lay = x; }, set: (w, s, m) => { W = w; o = s; me = m; }, hubFrom: (b) => { hubButton = b; }, state: (x) => { on = x.on; lay = x.lay; board = drawn = null; floats = x.floats; ro = x.ro; } } };');
  assert.notEqual(src, read('features/widgets.js'));
  const ui = vm.runInContext(src, c);
  ui.probe.set(W, D.GZ_SANITIZE({}).widgets, { uid: ultra ? '_5_1' : '3', tz: ultra ? undefined : 'UTC' });
  const answer = () => { while (reads.length) reads.shift()(); };
  return { ui, timers, answer, sent, listeners, local, clock, held, c };
};
const find = (el, pred) => (pred(el) ? el : el.children?.map((c) => find(c, pred)).find(Boolean) || null);

test('the compact settings widget reuses the palette editor command', async () => {
  const p = page(), body = new E();
  p.ui.probe.WIDGETS.settings(body);
  assert.equal(body.children.length, 1);
  assert.equal(body.children[0].textContent, 'Glaze settings');
  body.children[0].fire('click');
  await settle();
  assert.deepEqual(p.sent, ['options']);
});

test('Canvas tiles have a resize corner and no grip', () => {
  const p = page();
  const { el: tile } = p.ui.probe.tileEl('timer');
  assert.deepEqual(tile.children.map((x) => x.tagName), ['HEADER', 'DIV', 'DIV', 'BUTTON']);
  assert.equal(tile.children.at(-1).className, 'gz-w-resize');
  assert.equal(tile.children[0].children.length, 1);
});

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

test("a tile's resize corner, drawn at 18px, takes presses over 24 (WCAG 2.5.8), inside the tile", () => {
  const css = read('features/apps.css');
  assert.match(css.slice(css.indexOf('.gz-w-resize {')), /^[^}]*position: absolute; right: 0; bottom: 0; width: 18px; height: 18px;/);
  assert.ok(css.includes('.gz-w-resize::before { content: ""; position: absolute; inset: -6px 0 0 -6px; }'));
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
    { type: 'assignment', id: '_11_1', cid: '_7_1', content: '_3_1', course: 'Biology', title: 'Lab report', at: now + 36e5, url: '/ultra/redirect?redirectType=nautilus&courseId=_7_1&contentId=_3_1', sub: { submitted: true }, ov: null, allDay: false },
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
  assert.equal(link.href, 'https://school.blackboard.test/ultra/redirect?redirectType=nautilus&courseId=_7_1&contentId=_3_1');
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

const agendaText = (el) => [el.textContent || '', ...(el.children || []).map((c) => (typeof c === 'object' ? agendaText(c) : String(c)))].join(' ');
const loadAgenda = async (p) => {
  const body = new E(), tile = p.ui.probe.WIDGETS.agenda(body);
  for (let i = 0; i < 4; i++) { p.answer(); await settle(); }
  return { body, tile };
};
const ultraDay = (p) => {
  const L = p.c.GZ_TODO, tz = Intl.DateTimeFormat().resolvedOptions().timeZone, d = L.dayOf(p.clock.t, tz);
  return [L.midnight(d, tz), L.midnight(d + 1, tz)];
};
const cachedDay = (p) => {
  const [from, to] = ultraDay(p);
  return { key: `todo:${p.c.location.origin}/_5_1`, at: p.clock.t, start: new Date(from).toISOString(), end: new Date(to).toISOString(),
    items: [{ type: 'assignment', id: '_11_1', cid: '_7_1', title: 'Covered work', at: p.clock.t, url: `${p.c.location.origin}/ultra/courses/_7_1/outline` }] };
};

test('Ultra shared planner: an agenda reuses the profile and range already read by another consumer', async () => {
  const ultra = { items: [] }, p = page({ ultra });
  const range = ultraDay(p);
  await p.c.GZ_ULTRA.page.planned(...range);
  const { tile } = await loadAgenda(p);
  assert.equal(ultra.requests.filter((s) => s.endsWith('/users/me')).length, 1, 'shared identity, no independent widget read');
  assert.equal(ultra.requests.filter((s) => s.endsWith('/memberships')).length, 1);
  assert.equal(ultra.asked.length, 1, 'the shared fresh range supplies the agenda');
  tile.stop();
});

test('Ultra shared planner: two agendas join an in-flight range and keep absolute own-site links', async () => {
  const now = Date.now(), ultra = { holdTodo: true, items: [{ id: '_11_1', cid: '_7_1', title: 'Shared work', at: now }] };
  const p = page({ ultra, clock: { t: now } });
  const a = await loadAgenda(p), b = await loadAgenda(p);
  const count = ultra.pending.length;
  ultra.holdTodo = false; for (const resolve of ultra.pending) resolve();
  await settle();
  assert.equal(count, 1, 'one planner transport while both tiles wait');
  assert.match(agendaText(a.body), /Shared work/); assert.match(agendaText(b.body), /Shared work/);
  assert.equal(find(a.body, (e) => e.tagName === 'A').href, `${p.c.location.origin}/ultra/courses/_7_1/outline`);
  a.tile.stop(); b.tile.stop();
});

test('Ultra shared planner: covered To Do cache is account-scoped and fresh for less than ten minutes', async (t) => {
  for (const kind of ['covered', 'account', 'origin', 'stale', 'uncovered']) await t.test(kind, async () => {
    const ultra = { items: [] }, p = page({ ultra }), cache = cachedDay(p);
    if (kind === 'account') cache.key = cache.key.replace('_5_1', '_6_1');
    if (kind === 'origin') cache.key = cache.key.replace(p.c.location.origin, 'https://other.test');
    if (kind === 'stale') cache.at -= 600000;
    if (kind === 'uncovered') cache.end = new Date(ultraDay(p)[1] - 1).toISOString();
    p.local.todoCache = cache;
    const { body, tile } = await loadAgenda(p);
    assert.equal(ultra.asked.length, kind === 'covered' ? 0 : 1);
    assert.equal(/Covered work/.test(agendaText(body)), kind === 'covered');
    tile.stop();
  });
});

test('Ultra shared planner: memo age belongs to the shared read, and expires at two minutes', async () => {
  const ultra = { items: [] }, clock = { t: Date.parse('2026-10-15T16:00:00Z') }, p = page({ ultra, clock });
  await p.c.GZ_ULTRA.page.planned(...ultraDay(p));
  clock.t += 119999;
  const { body, tile } = await loadAgenda(p);
  assert.equal(ultra.asked.length, 1, 'opening the agenda does not restart or duplicate another consumer’s memo');
  clock.t++;
  find(body, (e) => e.tagName === 'BUTTON' && e.textContent === 'Today').fire('click');
  await settle();
  assert.equal(ultra.asked.length, 2, 'shared range refreshes at its original expiry');
  tile.stop();
});

test('Ultra shared planner: a failed range is retried, then a newer covered To Do copy takes precedence', async () => {
  const ultra = { failTodo: 1, items: [] }, p = page({ ultra });
  await assert.rejects(p.c.GZ_ULTRA.page.planned(...ultraDay(p)), /planner unavailable/);
  const { body, tile } = await loadAgenda(p);
  assert.equal(ultra.asked.length, 2, 'a failed shared promise is evicted');
  assert.doesNotMatch(agendaText(body), /Couldn't load/);
  const cache = cachedDay(p);
  for (const f of [...p.listeners]) f({ todoCache: { newValue: cache } }, 'local');
  await settle();
  assert.match(agendaText(body), /Covered work/);
  assert.equal(ultra.asked.length, 2, 'the fresh covered copy supersedes memo without another planner call');
  tile.stop();
});

test("the agenda marks work done as Better To Do does: its manual mode, and Canvas's marks when they go there", async () => {
  const clock = { t: Date.parse('2026-10-15T16:00:00Z') };
  const raw = [
    { plannable_type: 'assignment', plannable_id: '5', course_id: '1', context_name: 'Bio', plannable: { title: 'Lab 3' }, plannable_date: '2026-10-15T20:00:00Z', html_url: '/courses/1/assignments/5', submissions: { submitted: true } },
    { plannable_type: 'quiz', plannable_id: '6', course_id: '1', context_name: 'Bio', plannable: { title: 'Quiz 2' }, plannable_date: '2026-10-15T21:00:00Z', html_url: '/courses/1/quizzes/6' },
  ];
  const open = async (todo) => {
    const p = page({ clock, sync: { todo }, capi: async () => raw, local: { 'todo:https://canvas.test/3': { tasks: [], items: { 'quiz:6': { done: true } } } } });
    return { p, ...(await loadAgenda(p)) };
  };
  const done = ({ body }) => find(body, (e) => e.className === 'gz-w-agenda').children.map((li) => 'done' in li.dataset);
  const auto = await open({});
  assert.deepEqual(done(auto), [true, true], 'handed in, and ticked in Glaze');
  const manual = await open({ done: 'manual' });
  assert.deepEqual(done(manual), [false, true], 'a hand-in alone leaves it open');
  const sync = await open({ sync: true });
  assert.deepEqual(done(sync), [true, false], "marks go to Canvas: Glaze's own is set aside");
  // Changed while the agenda is on the page.
  for (const f of [...auto.p.listeners]) f({ todo: { newValue: { done: 'manual', sync: true } } }, 'sync');
  for (let i = 0; i < 4; i++) { auto.p.answer(); await settle(); }
  assert.deepEqual(done(auto), [false, false]);
  for (const x of [auto, manual, sync]) x.tile.stop();
});

test('Canvas agenda retains its covered-cache, day memo and Canvas API path', async () => {
  let calls = 0;
  const clock = { t: Date.parse('2026-10-15T16:00:00Z') }, p = page({ clock, capi: async (url) => { assert.match(url, /^\/planner\/items\?/); calls++; return []; } });
  const L = p.c.GZ_TODO, d = L.dayOf(clock.t, 'UTC');
  const cache = { key: 'todo:https://canvas.test/3', at: clock.t, start: new Date(L.midnight(d, 'UTC')).toISOString(), end: new Date(L.midnight(d + 1, 'UTC')).toISOString(), items: [] };
  p.local.todoCache = cache;
  const { body, tile } = await loadAgenda(p);
  assert.equal(calls, 0, 'covered Canvas copy');
  for (const f of [...p.listeners]) f({ todoCache: { newValue: { ...cache, at: clock.t - 600000 } } }, 'local');
  await settle(); assert.equal(calls, 1);
  find(body, (e) => e.attrs?.['aria-label'] === 'Next day').fire('click');
  await settle();
  find(body, (e) => e.attrs?.['aria-label'] === 'Previous day').fire('click');
  await settle(); assert.equal(calls, 2, 'today still from the Canvas day memo');
  clock.t += 120000;
  find(body, (e) => e.tagName === 'BUTTON' && e.textContent === 'Today').fire('click');
  await settle(); assert.equal(calls, 3, 'Canvas memo keeps its two-minute freshness');
  tile.stop();
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


test('the timer initial storage read cannot replace a newer storage event', async () => {
  const clock = { t: 1e12 };
  const p = page({ clock, local: { widgetTimer: W.IDLE } });
  const body = new E();
  p.ui.probe.WIDGETS.timer(body);
  const running = { phase: 'work', end: clock.t + 25 * 6e4, left: 0 };
  for (const f of [...p.listeners]) f({ widgetTimer: { newValue: running } }, 'local');
  p.answer(); // old read's callback arrives after the worker's newer running event
  await settle();
  assert.equal(body.dataset.running, 'yes');
  assert.equal(find(body, (e) => e.className === 'gz-w-btn gz-w-main').textContent, 'Pause');
});


test('buddy timer checks context invalidation before any core mutation or runtime URL access', async () => {
  for (const failure of ['missing id', 'throwing id']) {
    const clock = { t: 1e12 };
    const p = page({ clock });
    const body = new E();
    const tile = p.ui.probe.WIDGETS.buddy(body);
    p.answer(); await settle();
    find(body, (e) => e.className === 'gz-w-pet').fire('click');
    const timer = [...p.timers.values()].find((x) => x.ms > 60000);
    assert.ok(timer, 'a live buddy arms its next repaint');
    let calls = 0;
    p.c.chrome.runtime.getURL = () => { calls++; throw Error('Extension context invalidated'); };
    if (failure === 'missing id') delete p.c.chrome.runtime.id;
    else Object.defineProperty(p.c.chrome.runtime, 'id', { get() { throw Error('Extension context invalidated'); } });
    clock.t += 60050;
    assert.doesNotThrow(() => timer.f(), failure);
    assert.equal(calls, 0, 'guard precedes runtime URL access');
    assert.ok(![...p.timers.values()].some((x) => x.ms > 60000), 'invalid repaint does not rearm');
    tile.stop();
  }
});


test('a buddy win or pat stored far ahead of the clock arms no repaint longer than a timer can wait', async () => {
  const clock = { t: 1e12 }, far = clock.t + 40 * 864e5;
  const p = page({ clock, local: { widgetBuddy: { happyAt: far, patAt: far } } });
  const body = new E();
  const tile = p.ui.probe.WIDGETS.buddy(body);
  p.answer(); await settle();
  // Past 2^31 - 1 ms a browser runs the timer at once, and the repaint arms the same one again.
  assert.ok([...p.timers.values()].every((x) => x.ms <= 2 ** 31 - 1));
  assert.equal(body.dataset.mood, 'sleepy');
  tile.stop();
});

test('declaring and revoking a built-in tile replacement disposes the previous renderer', () => {
  const p = page();
  let stops = 0, removed = 0;
  const old = () => ({ stop: () => stops++, el: { remove: () => removed++ } });
  p.ui.probe.tiles.set('timer', old());
  const fill = () => ({});
  p.ui.declare({ timer: { name: 'Mod timer', size: 'm', owner: 'a|tile:timer', fill } });
  assert.equal(p.ui.probe.added.get('timer'), fill);
  assert.equal(stops, 1);
  p.ui.probe.tiles.set('timer', old());
  p.ui.declare({});
  assert.equal(p.ui.probe.added.has('timer'), false);
  assert.equal(stops, 2);
  assert.equal(removed, 2);
});

test('course tabs: the timer ticks in the document on screen only, from the one stored deadline, and only that one moves it on', async () => {
  const clock = { t: 1e12 };
  const running = { phase: 'work', end: clock.t + 10 * 6e4, left: 0 };
  const view = { on: 'a' };
  const doc = (name) => {
    const p = page({ clock, local: { widgetTimer: running } });
    p.c.GZ_CTABS = { visible: () => view.on === name };
    const body = new E();
    const tile = p.ui.probe.WIDGETS.timer(body);
    p.answer();
    return { p, body, tile, shows: () => find(body, (e) => e.className === 'gz-w-clock').children[0].data, tick: () => [...p.timers.values()].at(-1).f() };
  };
  const a = doc('a'), b = doc('b');
  await settle();
  assert.equal(a.p.timers.size, 1, 'the document on screen ticks');
  assert.equal(b.p.timers.size, 0, 'a covered one arms nothing');
  // The switch: a sleeps, b wakes where the stored deadline says, not from the start.
  view.on = 'b';
  a.tile.suspend();
  clock.t += 4 * 6e4;
  b.tile.wake();
  assert.equal(a.p.timers.size, 0);
  assert.equal(b.p.timers.size, 1);
  assert.equal(b.shows(), W.clock(6 * 6e4));
  // The phase ends while b is on screen: b asks the worker to move it on (and would ring); a, asleep, does nothing.
  clock.t = running.end + 300;
  b.tick();
  await settle();
  assert.deepEqual(b.p.sent.map((m) => m.op), ['advance']);
  assert.deepEqual(a.p.sent, []);
});

test('covered timer storage updates wait for visibility before advancing or rendering their deadline', async () => {
  const clock = { t: 1e12 }, p = page({ clock });
  let visible = true;
  p.c.GZ_CTABS = { visible: () => visible };
  const body = new E(), tile = p.ui.probe.WIDGETS.timer(body);
  p.answer(); await settle();
  visible = false;
  const before = find(body, (e) => e.className === 'gz-w-clock').children[0].data;
  const expired = { phase: 'work', end: clock.t - 200, left: 0 };
  for (const f of [...p.listeners]) f({ widgetTimer: { newValue: expired } }, 'local');
  assert.equal(find(body, (e) => e.className === 'gz-w-clock').children[0].data, before, 'covered state maintenance does not paint');
  visible = true; tile.wake(); await settle();
  assert.deepEqual(p.sent.map((m) => m.op), ['advance'], 'the hidden storage update cannot consume an uncommitted transition');
});

test('visibility suspension stops presentation timers and board observation, including floating tiles', () => {
  const p = page(); let sleeps = 0, disconnects = 0;
  p.c.cancelAnimationFrame = () => {};
  p.ui.probe.tiles.set('quotes', { el: new E(), suspend: () => sleeps++ });
  p.ui.probe.state({ on: false, ro: { disconnect: () => disconnects++ } });
  p.c.document.visibilityState = 'hidden'; p.ui.probe.onShow();
  assert.equal(sleeps, 1); assert.equal(disconnects, 1);
});

test('a covered agenda neither refetches for storage updates nor paints a late response', async () => {
  let finish, calls = 0, visible = true;
  const p = page({ capi: async () => { calls++; return new Promise((r) => { finish = r; }); } });
  p.c.GZ_CTABS = { visible: () => visible };
  const body = new E(), tile = p.ui.probe.WIDGETS.agenda(body);
  p.answer(); await settle(); p.answer(); await settle();
  const list = find(body, (e) => e.className === 'gz-w-agenda');
  visible = false; finish([]); await settle();
  assert.equal(list.children.length, 0, 'the pending answer waits to paint');
  for (const f of [...p.listeners]) f({ todoCache: { newValue: null } }, 'local');
  await settle(); assert.equal(calls, 1, 'no work starts behind the active course tab');
  tile.stop();
});

test('simultaneous top floating and course-frame timers announce a deadline only after one queued advance wins', async () => {
  const Store = require('../lib/nav-store.js'), K = require('../lib/cards.js');
  const clock = { t: 1e12 }, running = { phase: 'work', end: clock.t + 1000, left: 0 }, values = { widgetTimer: running };
  const area = { sync: { get: async () => ({}) }, local: { get: async () => values, set: async (v) => { Object.assign(values, v); return true; } } };
  const serial = K.queue(), moments = [];
  const docs = ['float', 'dock'].map((name) => {
    const p = page({ clock, local: { widgetTimer: running } }), body = new E();
    p.c.GZ_CTX.moment = (...x) => moments.push({ name, x });
    p.c.chrome.runtime.sendMessage = (m, cb) => serial(() => Store.timer(m.op, area, clock.t)).then(cb);
    p.ui.probe.WIDGETS.timer(body); p.answer(); return p;
  });
  await settle(); clock.t = running.end + 100;
  for (const p of docs) [...p.timers.values()].at(-1).f();
  await settle();
  assert.equal(moments.length, 1, 'only the response which advanced shared storage announces/chimes');
  assert.equal(values.widgetTimer.phase, 'rest');
});

test('a covered notes save completes without repainting outgoing content, then paints on wake', async () => {
  const p = page({ hold: true }), body = new E(); let visible = true;
  p.c.GZ_CTABS = { visible: () => visible };
  const tile = p.ui.probe.WIDGETS.notes(body); p.answer(); await settle();
  const text = find(body, (e) => e.tagName === 'TEXTAREA'), view = find(body, (e) => e.className === 'gz-w-note-view');
  text.value = 'Saved after switch'; text.fire('input'); text.fire('blur');
  let paints = 0; view.replaceChildren = () => paints++;
  visible = false; p.held.shift()(); await settle();
  assert.equal(paints, 0, 'accepted writes finish quietly behind the visible frame');
  visible = true; tile.wake(); assert.equal(paints, 1);
});

const dockAndFloat = () => {
  const { El } = require('./stand-in-dom.js'), S = require('../lib/sidebar.js');
  const p = page(), doc = { visibilityState: 'visible' }, loads = [], counts = { contexts: 0, suspended: 0, resumed: 0 }; let visible = true;
  doc.root = new El('html', doc); doc.body = new El('body', doc); doc.root.append(doc.body);
  Object.assign(doc, { documentElement: doc.root, createElement: (tag) => new El(tag, doc), querySelector: (s) => doc.root.querySelector(s), querySelectorAll: (s) => doc.root.querySelectorAll(s),
    getElementById: (id) => doc.root.all().find((e) => e.id === id) || null });
  p.c.document = doc; p.c.location.pathname = '/courses/25'; p.c.innerWidth = 1440; p.c.innerHeight = 900; p.c.cancelAnimationFrame = () => {};
  p.c.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  p.c.GZ_SIDEBAR = S; p.c.GZ_CTABS = { visible: () => visible };
  p.c.GZ_CTX.settings = () => ({ enhance: { sidebar: true, widgets: true, notes: true, pet: true } });
  p.c.GZ_CTX.need = (file) => { loads.push(file); return new Promise(() => {}); };
  const host = new El('div', doc); doc.body.append(host);
  const rec = S.clean({ mig: 1, dock: [{ id: 'notes' }], dest: { notes: 'dock', quotes: 'float' } });
  p.c.GZ_SIDEBAR_UI = { active: () => true, rec: () => rec, host: () => ({ widgets: host }), context: () => ({ accountId: '3' }), drawn() {} };
  p.ui.declare({ notes: { name: 'Notes', size: 's', fill: () => ({ context: () => counts.contexts++, suspend: () => counts.suspended++, resume: () => counts.resumed++ }) }, quotes: { name: 'Quote', size: 's', fill: () => ({}) } });
  const lay = W.apply(W.layout(), { ops: [{ s: 'canvas', id: 'quotes', set: { on: true, float: true } }] });
  p.ui.probe.state({ on: true, lay }); p.ui.probe.draw();
  return { p, doc, loads, rec, host, lay, counts, hide: () => { visible = false; p.ui.cover(); } };
};

test('a covered top document can redraw its float without mounting or relabelling dock widgets', () => {
  const { p, loads, rec, host, counts, hide } = dockAndFloat();
  assert.equal(counts.contexts, 1); assert.equal(p.ui.probe.tiles.size, 2);
  hide();
  rec.dest.pet = 'dock'; rec.dock.push({ id: 'pet' });
  p.ui.probe.draw();
  assert.deepEqual(loads, [], 'a newly docked habitat does not start loading behind the active course frame');
  assert.equal(counts.suspended, 1); assert.equal(counts.contexts, 1, 'the dock keeps its outgoing context while its float reconciles');
  assert.equal(p.ui.probe.tiles.get('notes').el.parentNode, host, 'the open form remains in its own document');
});

test('disabling the last floating tile while the top document is covered removes its live renderer', () => {
  const { p, rec, lay, hide } = dockAndFloat();
  hide();
  const quote = p.ui.probe.tiles.get('quotes'); let stopped = 0; quote.stop = () => stopped++;
  rec.dest.quotes = 'off';
  p.ui.probe.layout(W.apply(lay, { ops: [{ s: 'canvas', id: 'quotes', set: { on: false } }] }));
  p.ui.probe.draw();
  assert.equal(p.ui.probe.tiles.has('quotes'), false);
  assert.equal(quote.el.isConnected, false); assert.equal(stopped, 1);
  assert.equal(p.ui.probe.tiles.has('notes'), true, 'the suspended dock is retained');
});

test('a suspended dock renderer moved to float while covered resumes in its existing element', () => {
  const { p, rec, lay, counts, hide } = dockAndFloat();
  const notes = p.ui.probe.tiles.get('notes'); hide();
  assert.equal(counts.suspended, 1);
  rec.dest.notes = 'float';
  p.ui.probe.layout(W.apply(lay, { ops: [{ s: 'canvas', id: 'notes', set: { on: true, float: true } }] }));
  p.ui.probe.draw();
  assert.equal(p.ui.probe.tiles.get('notes'), notes);
  assert.equal(notes.el.parentNode.id, 'gz-float');
  assert.equal(counts.resumed, 1, 'the newly visible float resumes its stopped presentation work');
  p.ui.probe.draw(); assert.equal(counts.resumed, 1, 'incidental redraws do not resume it twice');
});

test('a sidebar account change invalidates the cached widget profile and late previous-account answers', async () => {
  const p = page(), listeners = {}; let accountId = '3', release;
  p.c.cancelAnimationFrame = () => {}; p.c.GZ_WIDGETS = W;
  p.c.document.getElementById = () => null;
  p.c.GZ_CTX.settings = () => ({ enhance: { sidebar: true } });
  p.c.GZ_SIDEBAR_UI = { on: (name, fn) => { listeners[name] = fn; }, context: () => ({ accountId }), ready: async () => {}, active: () => false };
  p.ui.sync(true); p.ui.sync(false); p.answer(); await settle();
  listeners.context();
  p.c.GZ_CTX.profile = () => new Promise((r) => { release = r; });
  const old = p.ui.who();
  const rejected = assert.rejects(old, /stale profile/);
  accountId = '4'; listeners.context();
  p.c.GZ_CTX.profile = async () => ({ id: '4' });
  const latest = p.ui.who();
  release({ id: '3' }); await rejected;
  assert.equal((await latest).uid, '4');
  assert.equal((await p.ui.who()).uid, '4', 'the old response cannot replace the new signed-in identity');
});

// ---- WP-W1: notes, the timer, the study buddy, the music tile and the tour -----------------------------------------------

// WID-2: 22be3da read a stored note stamped ahead of the clock as time 0, which the tile (it adopts a note only when its
// time is later than the one it shows, which starts at 0) never showed; typing then replaced the text it hid.
test('a note stored with a time ahead of the clock is shown in the tile, and typing goes on from it', async () => {
  const key = 'notes:https://canvas.test/3';
  const p = page({ local: { [key]: { text: 'Exam room 204, bring calculator', at: Date.now() + 3 * 864e5 } } });
  const body = new E();
  const tile = p.ui.probe.WIDGETS.notes(body);
  await settle(); p.answer(); await settle(); // who is signed in, then the stored note
  const view = find(body, (e) => e.className === 'gz-w-note-view'), text = find(body, (e) => e.tagName === 'TEXTAREA');
  assert.deepEqual(view.children, ['Exam room 204, bring calculator'], 'the note, not the placeholder');
  view.fire('click');
  assert.equal(text.value, 'Exam room 204, bring calculator', 'and it is what a click edits');
  text.value += '; lab at 3';
  text.fire('input'); text.fire('blur'); await settle();
  assert.equal(p.sent.at(-1).text, 'Exam room 204, bring calculator; lab at 3', 'what is typed is added to it');
  tile.stop();
  // The same note arriving from another tab while the tile is empty.
  const q = page();
  const b2 = new E();
  const t2 = q.ui.probe.WIDGETS.notes(b2);
  await settle(); q.answer(); await settle();
  for (const f of [...q.listeners]) f({ [key]: { newValue: { text: 'from another tab', at: Date.now() + 864e5 } } }, 'local');
  assert.deepEqual(find(b2, (e) => e.className === 'gz-w-note-view').children, ['from another tab']);
  t2.stop();
});

// WID-5: run() stopped everything when the page was hidden, so a block ending while the student was in another tab or
// app passed in silence. One timeout to the end now stays armed in the tab that has the sound ready.
const audioPage = (extra = {}) => {
  const clock = { t: 1e12 };
  const running = { phase: 'work', end: clock.t + 25 * 6e4, left: 0 };
  const rest = { phase: 'rest', end: running.end + 5 * 6e4, left: 0 };
  const replies = [{ ok: true, timer: running }, { ok: true, timer: rest, advanced: running.end }];
  const p = page({ clock, replies, ...extra });
  const notes = [];
  p.c.AudioContext = class { constructor() { this.currentTime = 0; this.destination = {}; } resume() {} close() {}
    createOscillator() { const x = { frequency: {}, connect: (n) => n, start() {}, stop() {} }; notes.push(x); return x; }
    createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect: (n) => n }; } };
  p.ui.probe.set(W, { ...D.GZ_SANITIZE({}).widgets, sound: true }, { uid: '3', tz: 'UTC' });
  const moments = [];
  p.c.GZ_CTX.moment = (...a) => moments.push(a);
  const body = new E();
  const tile = p.ui.probe.WIDGETS.timer(body);
  const status = find(body, (e) => e.className === 'gz-w-status');
  const start = async () => { p.answer(); await settle(); find(body, (e) => e.className === 'gz-w-btn gz-w-main').fire('click'); await settle(); };
  const away = () => { p.c.document.visibilityState = 'hidden'; tile.suspend(); };
  // A timer that fires is spent (the stub keeps it until it is cleared, as the page never would).
  const fire = async (x) => { for (const [k, v] of p.timers) if (v === x) p.timers.delete(k); x.f(); await settle(); };
  return { p, clock, running, rest, replies, notes, moments, body, tile, status, start, away, fire, timers: () => [...p.timers.values()] };
};

test('the chime rings when the phase ends while this tab is in the background, once, with the break announced', async () => {
  const a = audioPage();
  await a.start();
  a.away();
  assert.equal(a.timers().length, 1, 'one timeout to the end stays armed while hidden');
  assert.ok(Math.abs(a.timers()[0].ms - (25 * 6e4 + 5)) < 50, `${a.timers()[0].ms} ms`);
  a.clock.t = a.running.end + 5;
  await a.fire(a.timers()[0]);
  assert.deepEqual(a.p.sent.map((m) => m.op), ['toggle', 'advance']);
  assert.equal(a.notes.length, 2, 'the two notes of the chime');
  assert.equal(a.status.textContent, 'Time for a break.', 'and the tile says so for when the student comes back');
  assert.equal(a.moments.length, 1);
  assert.equal(a.timers().length, 1, 'the break is watched the same way');
  assert.ok(Math.abs(a.timers()[0].ms - 5 * 6e4) < 50, `${a.timers()[0].ms} ms to the break's end`);
  a.tile.stop();
  assert.equal(a.timers().length, 0, 'nothing left armed when the tile goes');
});

test('the background chime stays quiet when it should: no sound set, a phase that ended long ago, another tab moved it on, or a tab that never watched it', async () => {
  // No sound (or no Start pressed in this tab): nothing armed while hidden, as before.
  const quiet = audioPage();
  quiet.p.ui.probe.set(W, { ...D.GZ_SANITIZE({}).widgets, sound: false }, { uid: '3', tz: 'UTC' });
  await quiet.start(); quiet.away();
  assert.equal(quiet.timers().length, 0);
  // The computer slept through the end: it moves on quietly, as a phase that ended while away always has.
  const late = audioPage();
  await late.start(); late.away();
  late.clock.t = late.running.end + 60e3;
  await late.fire(late.timers()[0]);
  assert.deepEqual(late.p.sent.map((m) => m.op), ['toggle', 'advance'], 'it still moves on');
  assert.equal(late.notes.length, 0);
  assert.equal(late.status.textContent, '');
  // Another tab's advance came first: this one's answer carries no `advanced`, and only the tab that moved it rings.
  const lost = audioPage();
  lost.replies[1] = { ok: true, timer: lost.rest };
  await lost.start(); lost.away();
  lost.clock.t = lost.running.end + 5;
  await lost.fire(lost.timers()[0]);
  assert.deepEqual(lost.p.sent.map((m) => m.op), ['toggle', 'advance']);
  assert.equal(lost.notes.length, 0);
  // A tab that took the phase from storage (Start was pressed elsewhere) never had the sound allowed: nothing armed.
  const other = audioPage();
  other.p.answer(); await settle();
  for (const f of [...other.p.listeners]) f({ widgetTimer: { newValue: other.running } }, 'local');
  other.away();
  assert.equal(other.timers().length, 0);
});

test('a visible tab still rings at the end, and a clock set back does not ring a deadline that was never reached (WID-11)', async () => {
  const a = audioPage();
  await a.start();
  const tick = a.timers().find((x) => x.ms <= 1005);
  assert.ok(tick, 'the visible tab ticks');
  a.clock.t = a.running.end + 5;
  await a.fire(tick);
  assert.equal(a.notes.length, 2);
  assert.equal(a.status.textContent, 'Time for a break.');
  a.tile.stop();
  // The clock set back two hours a minute in: the tile shows the phase's length at most, starts it over from now, and rings nothing
  // (the worker's answer to the correction carries the old deadline as `advanced`, which is not a phase that ended).
  const b = audioPage();
  await b.start();
  b.clock.t = b.running.end - 24 * 6e4 - 2 * 3600e3;
  b.replies[0] = { ok: true, timer: { phase: 'work', end: b.clock.t + 25 * 6e4, left: 0 }, advanced: b.running.end }; // Start's answer is spent: this is the next
  const clockText = () => find(b.body, (e) => e.className === 'gz-w-clock').children[0].data;
  await b.fire(b.timers().find((x) => x.ms <= 1005));
  assert.equal(clockText(), '25:00');
  assert.deepEqual(b.p.sent.map((m) => m.op), ['toggle', 'advance'], 'the worker is asked to correct the stored deadline');
  assert.equal(b.notes.length, 0, 'no chime');
  assert.equal(b.status.textContent, '', 'and no break announced');
  b.tile.stop();
});

// WID-8: the first paint ran as a microtask and stopped for good when the tile was not on the page yet (Hide widgets on
// Ultra's Courses page builds the tiles and attaches none), so pressing Show widgets attached a dead tile.
test('a study buddy made before it is on the page waits for it; it stops only once it has been, and then is gone', async () => {
  const p = page();
  const body = new E();
  const tile = p.ui.probe.WIDGETS.buddy(body);
  const pet = find(body, (e) => e.className === 'gz-w-pet');
  pet.isConnected = false; // made, not yet attached (nothing has run yet: the first paint is a microtask)
  p.answer(); await settle();
  assert.equal(body.dataset.mood, 'sleepy', 'drawn all the same');
  assert.ok(find(body, (e) => e.tagName === 'IMG').src, 'with its picture');
  assert.equal(p.listeners.length, 1, 'still listening for its storage');
  pet.isConnected = true; // Show widgets
  tile.update();
  assert.equal(p.listeners.length, 1, 'alive on the page');
  pet.isConnected = false; // the page took it out
  tile.update();
  assert.equal(p.listeners.length, 0, 'now it is gone, and has stopped');
  tile.stop();
});

// WID-9: moving an element that holds an iframe unloads it, so the player restarted whenever the board reordered tiles.
test('seating a tile moves it with moveBefore where the browser has it; without, a tile holding a player stays and the others move around it', () => {
  const { El } = require('./stand-in-dom.js');
  const p = page();
  const doc = {}; doc.root = new El('html', doc); doc.body = new El('body', doc); doc.root.append(doc.body);
  const row = (names) => { const parent = new El('div', doc); for (const n of names) { const e = new El('section', doc); e.id = n; parent.append(e); } doc.body.append(parent); return parent; };
  const order = (parent) => parent.children.map((c) => c.id).join(' ');
  const at = (parent, id) => parent.children.find((c) => c.id === id);
  // How often an element is taken out of one place and put in another (adopted) by the stand-in's own moves.
  const counted = (el, ...parents) => { el.moved = 0; for (const parent of parents) { const adopt = parent.adopt.bind(parent); parent.adopt = (k) => { if (k === el) el.moved++; return adopt(k); }; } return el; };
  const player = (parent, id, ...also) => { const el = at(parent, id); el.append(new El('iframe', doc)); return counted(el, parent, ...also); };
  const seat = p.ui.probe.seatAfter;
  // Without moveBefore, the tile with the player stays where it is while what is in its way moves past it.
  const a = row(['a', 'music', 'b', 'c']), music = player(a, 'music');
  seat(a, music, null);
  assert.equal(order(a), 'music a b c');
  assert.equal(music.moved, 0, 'the player was not moved');
  const unset = row(['x', 'music', 'y']), unsetMusic = player(unset, 'music');
  seat(unset, unsetMusic, undefined); // draw() uses last.get(home) for the first tile
  assert.equal(order(unset), 'music x y');
  assert.equal(unsetMusic.moved, 0, 'an unset first predecessor must also preserve the player');
  const b = row(['x', 'y', 'music', 'z']), m2 = player(b, 'music');
  seat(b, m2, at(b, 'x'));
  assert.equal(order(b), 'x music y z');
  assert.equal(m2.moved, 0);
  // A tile without a player is moved the usual way, and so is one that has to change parents (its player reloads: nothing else can be done).
  const plain = row(['a', 'b', 'c']);
  seat(plain, at(plain, 'c'), null);
  assert.equal(order(plain), 'c a b');
  seat(plain, at(plain, 'c'), at(plain, 'b'));
  assert.equal(order(plain), 'a b c');
  const other = row(['q']);
  counted(m2, other);
  seat(other, m2, at(other, 'q'));
  assert.equal(order(other), 'q music');
  assert.equal(m2.moved, 1, 'a move between parents is a move');
  // With moveBefore it is used, across parents too, and the tile is not taken out and put back the old way.
  const calls = [];
  const t1 = row(['m', 'n']), t2 = row(['k', 'l']);
  for (const [name, parent] of [['t1', t1], ['t2', t2]]) {
    parent.moveBefore = (node, ref) => {
      calls.push([name, node.id, ref?.id || null]);
      node.parentNode.children.splice(node.parentNode.children.indexOf(node), 1);
      node.parentNode = parent;
      parent.children.splice(ref ? parent.children.indexOf(ref) : parent.children.length, 0, node);
    };
  }
  const tile = player(t1, 'm', t2);
  seat(t2, tile, at(t2, 'k'));
  assert.equal(order(t2), 'k m l');
  assert.deepEqual(calls, [['t2', 'm', 'l']]);
  seat(t2, tile, null);
  assert.equal(order(t2), 'm k l');
  assert.equal(tile.moved, 0, 'never adopted anew');
  // A browser that refuses the move gets the old way, not an error.
  t2.moveBefore = () => { throw new Error('HierarchyRequestError'); };
  seat(t2, at(t2, 'l'), null);
  assert.equal(order(t2), 'l m k');
});

// WID-14: the tour is opened from the hub (a dialog that closes first), and ended by Esc, End tour or Finish; the bubble
// that held focus was removed and focus went to <body>, so a keyboard user started over from the top of the page.
const tourPage = () => {
  const { El } = require('./stand-in-dom.js');
  const p = page(), doc = { visibilityState: 'visible', keys: [] };
  doc.root = new El('html', doc); doc.body = new El('body', doc); doc.root.append(doc.body);
  Object.assign(doc, { documentElement: doc.root, createElement: (tag) => new El(tag, doc), createTextNode: (data) => ({ data }), querySelector: (s) => doc.root.querySelector(s), querySelectorAll: (s) => doc.root.querySelectorAll(s),
    getElementById: (id) => doc.root.all().find((e) => e.id === id) || null,
    addEventListener: (type, f) => { if (type === 'keydown') doc.keys.push(f); }, removeEventListener: (type, f) => { doc.keys = doc.keys.filter((k) => k !== f); } });
  doc.activeElement = doc.body;
  p.c.document = doc; p.c.navigator = { userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/150.0.0.0 Safari/537.36' };
  const press = (box, text) => box.querySelectorAll('button').find((b) => b.textContent === text).listeners.find((l) => l.type === 'click').f({});
  const begin = async () => {
    await p.ui.hub(); await settle();
    press(doc.getElementById('gz-hub'), 'Take the tour'); await settle();
    assert.ok(doc.querySelector('.gz-tour'), 'the tour is on');
    assert.ok(doc.activeElement.className.includes('gz-tour'), 'focus is in its bubble');
  };
  return { p, doc, El, press, begin, bubble: () => doc.querySelector('.gz-tour') };
};

test('the tour gives focus back to where the student opened it from when it ends, by Esc, End tour or Finish', async () => {
  const { doc, El, press, begin, bubble } = tourPage();
  const opener = new El('button', doc); opener.id = 'opener'; doc.body.append(opener);
  for (const how of ['Esc', 'End tour', 'Finish']) {
    opener.focus();
    await begin();
    if (how === 'Esc') doc.keys[0]({ key: 'Escape', preventDefault() {} });
    else if (how === 'End tour') press(bubble(), 'End tour');
    else { press(bubble(), 'Next'); press(bubble(), 'Finish'); }
    assert.equal(bubble(), null, how);
    assert.equal(doc.activeElement, opener, `${how}: back on the control that opened it`);
    assert.equal(doc.keys.length, 0, 'and its key handler is gone');
  }
});

test('when what opened the tour is gone, the tour hands focus to the Dashboard button, and to nothing missing', async () => {
  const { p, doc, El, press, begin, bubble } = tourPage();
  const opener = new El('button', doc); doc.body.append(opener);
  const dashHub = new El('button', doc); doc.body.append(dashHub);
  p.ui.probe.hubFrom(dashHub); // the Dashboard's What Glaze can do, as the board built it
  opener.focus();
  await begin();
  opener.remove(); // the palette that ran the command is closed
  press(bubble(), 'End tour');
  assert.equal(doc.activeElement, dashHub);
  dashHub.remove(); opener.remove();
  await begin();
  assert.doesNotThrow(() => press(bubble(), 'End tour'));
  assert.equal(bubble(), null);
});
