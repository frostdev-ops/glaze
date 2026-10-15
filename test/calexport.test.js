// The calendar file (lib/calexport.js through lib/ics.js): what goes in, the ranges, the UIDs, and that the file reads back.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const X = require('../lib/calexport.js');
const T = require('../lib/todo.js');
const ICS = require('../lib/ics.js');

const TZ = 'America/New_York';
const NOW = Date.parse('2026-10-15T14:00:00Z'); // Thursday, 10:00 in New York
const ALL = { icsDue: true, icsTasks: true, icsPlan: true, icsGs: true };
const words = { plan: (x) => `Do: ${x}`, focus: (x) => `Focus: ${x}`, untitled: 'Planned work' };
const item = (o) => ({ type: 'assignment', id: '1', cid: '7', course: 'Biology', title: 'Lab 1', at: Date.parse('2026-10-20T03:59:00Z'), url: '/courses/7/assignments/1', ov: null, allDay: false, ...o });

const run = (o = {}) => {
  const r = X.range(o.range || '4w', NOW, TZ, o.courses);
  return X.events({ items: [], gs: [], data: {}, o: ALL, ...r, site: 'https://canvas.test', host: 'canvas.test', names: { 7: 'Biology' }, words, ...o });
};

test('ranges run from the start of today to the end of the last day, in the Canvas time zone', () => {
  const r = X.range('2w', NOW, TZ);
  assert.equal(new Date(r.from).toISOString(), '2026-10-15T04:00:00.000Z');
  // Across the November change: midnight in New York is 05:00Z by then.
  assert.equal(new Date(r.to).toISOString(), '2026-10-29T04:00:00.000Z');
  assert.equal(new Date(X.range('16w', NOW, TZ).to).toISOString(), '2027-02-04T05:00:00.000Z');
  assert.equal(r.guessed, false);
});

test('this term: the latest end among courses under way; the default term has no dates, so 16 weeks, said so', () => {
  const courses = [
    { id: 1, term: { start_at: '2026-08-20T00:00:00Z', end_at: '2026-12-18T05:00:00Z' } },
    { id: 2, term: { start_at: '2027-01-10T00:00:00Z', end_at: '2027-05-10T00:00:00Z' } }, // next term: not begun
    { id: 3, restrict_enrollments_to_course_dates: true, end_at: '2026-12-20T22:00:00Z', term: { end_at: '2027-06-01T00:00:00Z' } }, // its own dates
    { id: 4, term: { end_at: '2026-05-01T00:00:00Z' } }, // over
  ];
  const r = X.range('term', NOW, TZ, courses);
  assert.equal(new Date(r.to).toISOString(), '2026-12-21T05:00:00.000Z', 'through Dec 20 in New York');
  assert.equal(r.guessed, false);
  const none = X.range('term', NOW, TZ, [{ id: 5, term: { name: 'Default Term', start_at: null, end_at: null } }]);
  assert.equal(none.guessed, true);
  assert.equal(none.to, X.range('16w', NOW, TZ).to);
  assert.equal(X.range('term', NOW, TZ, [{ term: { end_at: '2030-01-01T00:00:00Z' } }]).last - T.dayOf(NOW, TZ), 366, 'at most a year');
});

test('Canvas items: deadlines as instants, all-day as dates, only in range, only shown courses, never dismissed, announcements or calendar events', () => {
  const items = [
    item(),
    item({ id: '2', title: 'Holiday', allDay: true, at: Date.parse('2026-10-22T00:00:00Z') }),
    item({ id: '3', at: NOW - 864e5 }), // yesterday
    item({ id: '4', at: Date.parse('2026-11-12T05:00:00Z') }), // past 4 weeks (ends Nov 12 00:00 New York = 05:00Z)
    item({ id: '5', ov: { id: '9', done: false, dismissed: true } }),
    item({ id: '6', type: 'announcement' }),
    item({ id: '8', type: 'calendar_event' }), // Canvas's own calendar feed has those
    item({ id: '7', cid: '99' }), // a concluded course
  ];
  const ev = run({ items, cids: new Set(['7']) });
  assert.deepEqual(ev.map((e) => e.uid), ['canvas.test/assignment/1@glaze', 'canvas.test/assignment/2@glaze']);
  assert.deepEqual([ev[0].start, ev[0].end, ev[0].url, ev[0].description], [items[0].at, undefined, 'https://canvas.test/courses/7/assignments/1', 'Biology']);
  assert.deepEqual([ev[1].start, ev[1].end], ['2026-10-22', '2026-10-23']);
  assert.equal(run({ items, o: { ...ALL, icsDue: false } }).length, 0);
});

test('custom tasks with a due date; plans and focus sessions under their item\'s title; Gradescope only when picked', () => {
  const gs = [item({ type: 'gradescope', id: '55', title: 'HW 3', url: 'https://www.gradescope.com/courses/1/assignments/55', course: '' })];
  const data = {
    tasks: [
      { id: 'a1', title: 'Read ch. 4', cid: '7', due: { day: '2026-10-18' }, notes: 'pages 80-95' },
      { id: 'a2', title: 'Email TA', due: { at: Date.parse('2026-10-16T13:00:00Z') } },
      { id: 'a3', title: 'Someday' },
    ],
    items: {
      'assignment:1': { on: '2026-10-17', sessions: [{ at: Date.parse('2026-10-16T18:00:00Z'), min: 50 }, { at: NOW - 864e5, min: 30 }] },
      'task:a3': { on: '2026-10-19' },
      'assignment:404': { on: '2026-10-19' }, // not among what was read: kept, untitled
    },
  };
  const ev = run({ items: [item()], gs, data });
  const by = Object.fromEntries(ev.map((e) => [e.uid, e]));
  assert.deepEqual(Object.keys(by).sort(), [
    'canvas.test/assignment/1@glaze', 'canvas.test/gradescope/55@glaze', 'canvas.test/on/assignment%3A1@glaze', 'canvas.test/on/assignment%3A404@glaze', 'canvas.test/on/task%3Aa3@glaze',
    `canvas.test/session/assignment%3A1/${Date.parse('2026-10-16T18:00:00Z')}@glaze`, 'canvas.test/task/a1@glaze', 'canvas.test/task/a2@glaze',
  ]);
  assert.deepEqual([by['canvas.test/task/a1@glaze'].start, by['canvas.test/task/a1@glaze'].description], ['2026-10-18', 'Biology\npages 80-95']);
  assert.equal(by['canvas.test/gradescope/55@glaze'].url, 'https://www.gradescope.com/courses/1/assignments/55');
  const s = by[`canvas.test/session/assignment%3A1/${Date.parse('2026-10-16T18:00:00Z')}@glaze`];
  assert.deepEqual([s.summary, s.end - s.start, s.url], ['Focus: Lab 1', 50 * 6e4, 'https://canvas.test/courses/7/assignments/1']);
  assert.equal(by['canvas.test/on/task%3Aa3@glaze'].summary, 'Do: Someday');
  // Each part has its own switch; a plan keeps its title when its item's deadline isn't exported.
  const plansOnly = run({ items: [item()], gs, data, o: { icsPlan: true } });
  assert.deepEqual(plansOnly.map((e) => e.summary).sort(), ['Do: Lab 1', 'Do: Planned work', 'Do: Someday', 'Focus: Lab 1']);
  assert.deepEqual(X.planned(data, X.range('4w', NOW, TZ)).sort(), ['assignment:1', 'assignment:404', 'task:a3']);
  assert.ok(!run({ items: [item()], gs, data, o: { ...ALL, icsGs: false } }).some((e) => e.uid.includes('gradescope')));
  // W14's class periods pass straight through.
  const cls = { uid: 'x@glaze', summary: 'BIO 101', start: '2026-10-19T09:00', end: '2026-10-19T09:50', rrule: { freq: 'WEEKLY', byday: ['MO'] } };
  assert.ok(run({ classes: [cls] }).includes(cls));
});

test('the same items give the same UIDs on every export, and the file reads back, escaping intact', () => {
  const items = [item({ title: 'Essay; draft, v2\nfinal \\ notes' })];
  const a = run({ items }), b = run({ items });
  assert.deepEqual(a.map((e) => e.uid), b.map((e) => e.uid));
  const text = ICS.write({ name: 'Glaze', events: a }, { now: NOW });
  assert.match(text, /SUMMARY:Essay\\; draft\\, v2\\nfinal \\\\ notes\r\n/);
  assert.match(text, /DTSTAMP:20261015T140000Z/);
  const back = ICS.parse(text);
  assert.equal(back.events[0].summary, 'Essay; draft, v2\nfinal \\ notes');
  assert.equal(back.events[0].start, items[0].at);
  assert.equal(back.events[0].uid, 'canvas.test/assignment/1@glaze');
});

test('the on-demand files end on their module and keep the first when loaded twice', () => {
  const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  for (const [file, name] of [['lib/ics.js', 'GZ_ICS'], ['lib/calexport.js', 'GZ_CALEXPORT'], ['features/calexport.js', 'GZ_CAL_UI']]) {
    const ctx = vm.createContext({ TextEncoder, GZ_CTX: { t: (k) => k } });
    vm.runInContext('globalThis.globalThis = this;', ctx);
    assert.ok(vm.runInContext(read(file), ctx), `${file}: no last value`);
    const first = vm.runInContext(name, ctx);
    vm.runInContext(read(file), ctx);
    assert.equal(vm.runInContext(name, ctx), first, file);
  }
});

test('review: overdue work planned for later keeps its plan; its past deadline stays out', () => {
  const late = item({ at: NOW - 864e5 }); // due yesterday
  const data = { items: { 'assignment:1': { on: '2026-10-16' } } };
  assert.deepEqual(run({ items: [late], data }).map((e) => [e.summary, e.start]), [['Do: Lab 1', '2026-10-16']]);
  // Even when its item wasn't read at all.
  assert.deepEqual(run({ items: [], data }).map((e) => e.summary), ['Do: Planned work']);
  // A dismissed item's plan stays out, as Better To Do doesn't show it.
  assert.deepEqual(run({ items: [item({ ov: { id: '9', dismissed: true } })], data }), []);
});

// features/calexport.js run() in a page of its own: Canvas's answers can be held, and storage changed meanwhile.
const page = () => {
  const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  const UID = '3', ORIGIN = 'https://canvas.test', ACCT = 'a'.repeat(24);
  const store = {
    sync: { version: 2, enabled: true, enhance: { gradescope: true } },
    local: {
      [`todo:${ORIGIN}/${UID}`]: { tasks: [], items: { 'assignment:1': { on: '2026-10-16' } } },
      gradescope: {
        acct: { id: ACCT, name: 'Sam' }, map: { 11: { to: `canvas:${ORIGIN}/7`, name: 'BIO' } },
        courses: { 11: { at: NOW, bad: 0, rows: [{ id: '55', title: 'HW 3', due: Date.parse('2026-10-20T03:59:00Z'), late: null, sub: false, graded: false, score: null, points: 10, lateSub: false }] } },
        bind: { [`${ORIGIN}/${UID}`]: { id: ACCT, show: true } },
      },
    },
  };
  const asked = [], held = [];
  let hold = false;
  const answer = (url) => {
    const late = url.includes('start_date=2026-04') ? [{ plannable_type: 'assignment', plannable_id: '1', course_id: '7', context_name: 'Biology', plannable: { title: 'Lab 1' }, plannable_date: '2026-10-14T03:59:00Z', html_url: '/courses/7/assignments/1' }] : [];
    return { ok: true, headers: { get: () => null }, text: async () => JSON.stringify(late) };
  };
  // fail[area]: 'error' answers with runtime.lastError and no result, as a failed read does; 'throw' throws.
  const fail = {}, runtime = {};
  const get = (area) => (keys, cb) => {
    if (fail[area] === 'throw') throw new Error('Extension context invalidated.');
    if (fail[area] === 'error') { runtime.lastError = { message: 'failed' }; cb(undefined); delete runtime.lastError; return; }
    const all = JSON.parse(JSON.stringify(store[area])); cb(keys === null ? all : Object.fromEntries([keys].flat().filter((k) => k in all).map((k) => [k, all[k]])));
  };
  // Just enough of a page for the dialog: elements that record their listeners, and links that record a click.
  const activation = { isActive: true };
  const downloads = [];
  class E {
    constructor(tag) { this.tagName = tag.toUpperCase(); this.kids = []; this.on = {}; this.dataset = {}; }
    append(...k) { this.kids.push(...k); }
    addEventListener(type, f) { (this.on[type] ||= []).push(f); }
    setAttribute() {}
    showModal() { this.open = true; }
    close() { this.open = false; for (const f of this.on.close || []) f(); }
    remove() {}
    focus() {}
    querySelector() { return null; }
    click() { if (this.download) downloads.push(this.download); }
  }
  const document = { activeElement: null, createElement: (tag) => new E(tag), body: { append(x) { document.dialog = x; } } };
  const c = vm.createContext({
    document, navigator: { userActivation: activation }, setTimeout: () => 0, Blob: class {},
    FormData: class { constructor(f) { this.v = f.values; } has(k) { return k in this.v; } get(k) { return this.v[k] ?? null; } },
    TextEncoder, URL: Object.assign(class extends URL {}, { createObjectURL: () => 'blob:x', revokeObjectURL() {} }), Date: class extends Date { constructor(...a) { super(...(a.length ? a : [NOW])); } static now() { return NOW; } },
    location: { origin: ORIGIN, host: 'canvas.test' },
    chrome: { runtime, storage: { sync: { get: get('sync'), set() {} }, local: { get: get('local') } } },
    fetch: async (url) => { asked.push(decodeURIComponent(url)); if (hold) await new Promise((res) => held.push(res)); return answer(url); },
    GZ_CTX: {
      t: (k, v = {}) => k.replace(/\{(\w+)\}/g, (_, x) => v[x]), need: async () => {}, settings: () => ({ enabled: true, enhance: { gradescope: true } }),
      profile: async () => ({ id: UID, time_zone: TZ }), canvasCourses: async () => [{ id: '7', name: 'Biology' }],
    },
  });
  vm.runInContext('globalThis.globalThis = this; Date.UTC = Object.getPrototypeOf(Date).UTC; Date.parse = Object.getPrototypeOf(Date).parse;', c);
  for (const f of ['lib/color.js', 'lib/fonts.js', 'defaults.js', 'lib/todo.js', 'lib/ics.js', 'lib/calexport.js', 'lib/gradescope.js', 'features/calexport.js']) vm.runInContext(read(f), c);
  const saved = [];
  const go = (alive = () => true) => c.GZ_CAL_UI.run({ icsDue: true, icsTasks: true, icsPlan: true, icsGs: true, icsRange: '2w' }, alive, (text) => { saved.push(text); return 'f.ics'; });
  // The dialog's Download, as the page would send it: trusted either way (a real press, or a script's requestSubmit()).
  const submit = async () => {
    await c.GZ_CAL_UI.open();
    const form = document.dialog.kids[0];
    Object.assign(form, { elements: {}, values: { icsDue: 'on', icsTasks: 'on', icsPlan: 'on', icsRange: '2w' } });
    for (const f of form.on.submit) await f({ isTrusted: true, target: form, preventDefault() {} });
  };
  return { store, fail, asked, held, saved, go, activation, downloads, submit, hold: () => { hold = true; }, release: () => { hold = false; held.splice(0).forEach((r) => r()); } };
};
const settle = () => new Promise((res) => setImmediate(res));

test('review: an export with nothing changed saves Gradescope work and the overdue item\'s plan, after asking further back', async () => {
  const p = page();
  const r = await p.go();
  assert.equal(r.name, 'f.ics');
  assert.match(p.saved[0], /UID:canvas\.test\/gradescope\/55@glaze/);
  assert.match(p.saved[0], /SUMMARY:Do: Lab 1/);
  assert.ok(!/UID:canvas\.test\/assignment\/1@glaze/.test(p.saved[0]), 'its past deadline stays out');
  assert.equal(p.asked.length, 2);
  assert.match(p.asked[1], /start_date=2026-04-18T04:00:00\.000Z&end_date=2026-10-15T04:00:00\.000Z/);
});

for (const [what, change] of [
  ['Gradescope consent withdrawn', (s) => { s.local.gradescope.bind['https://canvas.test/3'].show = false; }],
  ['Gradescope switched off', (s) => { s.sync.enhance.gradescope = false; }],
  ['Glaze turned off', (s) => { s.sync.enabled = false; }],
]) {
  test(`review: ${what} while Canvas answers: no file`, async () => {
    const p = page();
    p.hold();
    const job = p.go();
    await settle();
    assert.ok(p.held.length, 'the planner request is out');
    change(p.store);
    p.release();
    assert.equal(await job, null);
    assert.deepEqual(p.saved, []);
  });
}

test('review: the dialog closed while Canvas answers: no file', async () => {
  const p = page();
  let open = true;
  p.hold();
  const job = p.go(() => open);
  await settle();
  open = false;
  p.release();
  assert.equal(await job, null);
  assert.deepEqual(p.saved, []);
});

test('review: a script\'s requestSubmit() (trusted, but no activation) starts no export; the student\'s press does', async () => {
  const script = page();
  script.activation.isActive = false;
  await script.submit();
  assert.deepEqual([script.asked, script.downloads], [[], []]);
  const person = page();
  await person.submit();
  assert.equal(person.asked.length > 0, true);
  assert.deepEqual(person.downloads, ['glaze-calendar-2026-10-15.ics']);
});

test('review: a plan on a Gradescope item that isn\'t allowed (or on a kind that never goes in) stays out, even untitled', () => {
  const data = { items: { 'gradescope:55': { on: '2026-10-16', sessions: [{ at: Date.parse('2026-10-16T18:00:00Z'), min: 30 }] }, 'announcement:9': { on: '2026-10-16' }, 'calendar_event:4': { on: '2026-10-16' } } };
  assert.deepEqual(run({ gs: [], data }), [], 'consent refused: no Gradescope items allowed');
  const gs = [item({ type: 'gradescope', id: '55', title: 'HW 3', url: 'https://www.gradescope.com/courses/1/assignments/55', course: '' })];
  assert.deepEqual(run({ gs, data }).map((e) => e.summary).sort(), ['Do: HW 3', 'Focus: HW 3', 'HW 3'], 'allowed: its plans go in, with its deadline');
});

for (const [what, change] of [
  ['Glaze turned off, then its settings can\'t be read back', (p) => { p.store.sync.enabled = false; p.fail.sync = 'error'; }],
  ['the settings can\'t be read back', (p) => { p.fail.sync = 'error'; }],
  ['the settings read throws', (p) => { p.fail.sync = 'throw'; }],
  ['the Gradescope answer can\'t be read back', (p) => { p.fail.local = 'error'; }],
]) {
  test(`review: ${what} while Canvas answers: no file`, async () => {
    const p = page();
    // No Gradescope, so what a failed read falls back to (the defaults, nothing kept) looks the same as before.
    p.store.sync.enhance.gradescope = false;
    delete p.store.local.gradescope;
    p.hold();
    const job = p.go();
    await settle();
    change(p);
    p.release();
    assert.equal(await job, null);
    assert.deepEqual(p.saved, []);
  });
}

test('review: a read that works but finds no settings (a fresh install) uses the defaults, and saves', async () => {
  const p = page();
  p.store.sync = {};
  const r = await p.go();
  assert.equal(r.name, 'f.ics');
  assert.match(p.saved[0], /SUMMARY:Do: Lab 1/);
  assert.ok(!/gradescope/.test(p.saved[0]), 'Gradescope in To Do is off by default');
});
