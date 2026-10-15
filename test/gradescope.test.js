// Gradescope in Better To Do (lib/gradescope.js): reading a course page row by row, guessing the Canvas course, what's
// kept, and the items it adds to Better To Do. Gradescope's markup is from public knowledge of its student course page
// (there's no test account): the real page is checked by an owner before release (parity notes, W10).
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../defaults.js');
const T = require('../lib/todo.js');
const G = require('../lib/gradescope.js');

const at = (s) => Date.parse(s);
const O = D.GZ_SANITIZE({}).todo;

// Just enough of an element: what read() asks of a row.
const el = ({ text = '', attrs = {}, one = {}, all = {} } = {}) => ({
  textContent: text, getAttribute: (k) => attrs[k] ?? null, querySelector: (s) => one[s] ?? null, querySelectorAll: (s) => all[s] ?? [], closest: () => null,
});
const time = (dt) => el({ attrs: { datetime: dt } });
// A row as Gradescope draws it: a header cell with a link or a submit button, a status cell, due dates.
const tr = ({ title, href, aid, status = 'No Submission', cls = 'submissionStatus', due = [] }) => {
  const a = href && el({ text: title, attrs: { href } });
  const btn = aid && el({ text: title, attrs: { 'data-assignment-id': aid, 'data-post-url': `/courses/42/assignments/${aid}/submissions` } });
  const th = el({ text: title, one: { 'a[href]': a, '[data-assignment-id]': btn } });
  return el({ one: { th, '.submissionStatus': el({ text: status, attrs: { class: cls } }) }, all: { '.submissionTimeChart--dueDate': due.map(time) } });
};
const docOf = (rows) => el({ one: { '#assignments-student-table': el({ all: { 'tbody tr': rows } }) } });

test('dates: Gradescope\'s "YYYY-MM-DD HH:MM:SS -0700", ISO, and nothing that isn\'t a date', () => {
  assert.equal(G.when('2026-10-20 23:59:00 -0700'), at('2026-10-21T06:59:00Z'));
  assert.equal(G.when('2026-10-20 23:59:00 +0530'), at('2026-10-20T18:29:00Z'));
  assert.equal(G.when('2026-10-20T23:59:00Z'), at('2026-10-20T23:59:00Z'));
  assert.equal(G.when('2026-10-20T23:59:00-04:00'), at('2026-10-21T03:59:00Z'));
  assert.equal(G.when('2026-10-20 23:59'), new Date(2026, 9, 20, 23, 59).getTime()); // no zone: this browser's
  for (const bad of ['', null, 'Oct 20 at 11:59PM', '2026-13-01 00:00:00 -0700', '2026-10-20 25:00:00 -0700', { toString: null }]) assert.equal(G.when(bad), null);
});

test('ids come from the address, read with URL, and only from Gradescope', () => {
  assert.deepEqual(G.ids('/courses/42/assignments/7/submissions/99'), { gid: '42', aid: '7' });
  assert.deepEqual(G.ids('https://www.gradescope.com/courses/42/assignments/7?x=1#y'), { gid: '42', aid: '7' });
  assert.equal(G.ids('https://evil.test/courses/42/assignments/7'), null);
  assert.equal(G.ids('/courses/42'), null);
  assert.equal(G.ids('//evil.test/courses/42/assignments/7'), null);
  assert.equal(G.ids(undefined), null);
});

test('a course page, row by row: graded, submitted late, unsubmitted, missing; odd rows skipped and counted, never the course', () => {
  const rows = [
    tr({ title: 'HW 1', href: '/courses/42/assignments/101/submissions/5', status: ' 8.5 / 10.0 ', due: ['2026-10-01 23:59:00 -0700'] }),
    tr({ title: '  Lab   2 ', href: '/courses/42/assignments/102/submissions/6', status: 'Submitted Late', due: ['2026-10-05 23:59:00 -0700', '2026-10-07 23:59:00 -0700'] }),
    tr({ title: 'HW 3', aid: '103', status: 'No Submission', due: ['2026-10-30 23:59:00 -0700'] }),
    tr({ title: 'HW 0', aid: '100', status: 'No Submission', due: ['2026-09-01 23:59:00 -0700'] }),
    tr({ title: 'Midterm (paper)', status: '', due: [] }), // nothing to open or tick: left out, not unreadable
    tr({ title: 'Broken date', aid: '104', due: ['soon'] }), // unreadable
    tr({ title: '', aid: '105' }), // unreadable
    tr({ title: '', status: '' }), // an empty spacer row: nothing
    { querySelector() { throw new Error('odd row'); }, querySelectorAll() { throw new Error('odd row'); } }, // throws: unreadable
    tr({ title: 'HW 1 again', href: '/courses/42/assignments/101' }), // the same assignment twice: once
    tr({ title: 'Other course', href: '/courses/9/assignments/900' }), // another course's link: no id here
  ];
  const p = G.parse(docOf(rows), '42');
  assert.equal(p.bad, 3);
  assert.deepEqual(p.rows.map((r) => r.id), ['101', '102', '103', '100']);
  assert.deepEqual(p.rows[0], { id: '101', title: 'HW 1', due: at('2026-10-02T06:59:00Z'), late: null, sub: true, graded: true, score: 8.5, points: 10, lateSub: false });
  assert.deepEqual(p.rows[1], { id: '102', title: 'Lab 2', due: at('2026-10-06T06:59:00Z'), late: at('2026-10-08T06:59:00Z'), sub: true, graded: false, score: null, points: null, lateSub: true });
  assert.equal(p.rows[2].sub, false);
  // No table (signed out, or a course taught rather than taken): no answer, so what's kept stays.
  assert.equal(G.parse(el(), '42'), null);
  // An empty table is an answer: nothing to do.
  assert.deepEqual(G.parse(docOf([]), '42'), { rows: [], bad: 0 });
});

test('status words: a score, "Submitted", "No Submission", and the complete class', () => {
  const st = (status, cls) => G.row({ title: 'x', aid: '1', status, cls, due: [] }, '42');
  assert.equal(st('No Submission').sub, false);
  assert.equal(st('Not submitted').sub, false);
  assert.equal(st('Submitted').sub, true);
  assert.deepEqual([st('SubmittedLate').sub, st('SubmittedLate').lateSub], [true, true]); // parts run together in textContent
  assert.equal(st('NoSubmission').sub, false);
  assert.equal(st('0.0 / 5.0').graded, true);
  assert.equal(st('', 'submissionStatus submissionStatus-complete').sub, true);
  assert.equal(st('Something new').sub, false); // unknown words: still open, the student can tick it
});

test('which Canvas course: by course code, then number, then words; no guess when two fit alike', () => {
  const list = [
    { key: 'canvas:https://c.test/1', name: 'COMPSCI 61A: Structure and Interpretation', code: 'COMPSCI 61A' },
    { key: 'canvas:https://c.test/2', name: 'Math 241 Calculus', code: 'MATH-241' },
    { key: 'canvas:https://c.test/3', name: 'Organic Chemistry', code: 'CHEM 3A' },
    { key: 'canvas:https://c.test/4', name: 'Physics 7A Fall 2026', code: 'PHYS7A' },
  ];
  assert.equal(G.suggest({ short: 'MATH241', name: 'Calculus III' }, list), 'canvas:https://c.test/2');
  assert.equal(G.suggest({ short: 'CS 61A', name: 'Structure and Interpretation of Computer Programs' }, list), 'canvas:https://c.test/1');
  assert.equal(G.suggest({ short: 'Phys 7A', name: '' }, list), 'canvas:https://c.test/4');
  assert.equal(G.suggest({ short: 'Organic Chemistry', name: '' }, list), 'canvas:https://c.test/3');
  assert.equal(G.suggest({ short: 'History 1', name: 'Fall 2026' }, list), ''); // the year alone is no match
  assert.equal(G.suggest({ short: 'Course 61', name: '' }, [{ key: 'a', name: 'Bio 61' }, { key: 'b', name: 'Art 61' }]), ''); // a tie
  assert.equal(G.suggest({ short: 'X' }, []), '');
});

test('what\'s kept: placed courses, rows only for a course still placed where the reader thought, the bar dismissed', async () => {
  let store = {};
  const area = { local: { get: async (k) => ({ [k[0]]: store[k[0]] }), set: async (p) => { store = { ...store, ...p }; return true; } } };
  const to = 'canvas:https://c.test/7';
  assert.equal((await G.change({ op: 'rows', gid: '42', to, rows: [] }, area)).ok, false); // not placed yet
  let r = await G.change({ op: 'map', list: [{ gid: '42', to, name: 'MATH 241' }, { gid: '43', to: '' }, { gid: 'x', to }, { gid: '44', to: 'https://evil.test' }] }, area);
  assert.deepEqual(r.data.map, { 42: { to, name: 'MATH 241' }, 43: { to: '', name: '' } });
  const row = { id: '101', title: 'HW 1', due: 1, late: null, sub: false, graded: false, score: null, points: null, lateSub: false };
  assert.equal((await G.change({ op: 'rows', gid: '42', to: 'canvas:https://c.test/8', rows: [row] }, area)).ok, false); // placed elsewhere since
  assert.equal((await G.change({ op: 'rows', gid: '43', to: '', rows: [row] }, area)).ok, false); // "not a Canvas course"
  r = await G.change({ op: 'rows', gid: '42', to, rows: [row, { id: 'nope', title: 'x' }, null], bad: 2 }, area);
  assert.deepEqual(r.data.courses[42].rows, [row]);
  assert.equal(r.data.courses[42].bad, 2);
  // Placed with another course: what was read goes with the old placing.
  r = await G.change({ op: 'map', list: [{ gid: '42', to: 'canvas:https://c.test/8' }] }, area);
  assert.equal(r.data.courses[42], undefined);
  assert.equal(r.data.map[42].name, 'MATH 241');
  r = await G.change({ op: 'map', list: [{ gid: '42', to: null }] }, area);
  assert.equal(r.data.map[42], undefined);
  r = await G.change({ op: 'hide', hide: true }, area);
  assert.equal(r.data.hide, true);
  assert.equal((await G.change({ op: 'other' }, area)).ok, false);
  assert.deepEqual(G.clean('junk'), { map: {}, courses: {}, hide: false });
});

test('in Better To Do: this site\'s courses only, in their Canvas course, missing once the last due date passes, ticked on this device', () => {
  const now = at('2026-10-15T12:00:00Z');
  const rec = {
    map: { 42: { to: 'canvas:https://c.test/7', name: 'MATH 241' }, 50: { to: 'canvas:https://other.test/7', name: 'X' }, 51: { to: '', name: 'Y' } },
    courses: {
      42: { at: now, bad: 0, rows: [
        { id: '101', title: 'HW 1', due: at('2026-10-01T06:59:00Z'), late: null, sub: true, graded: true, score: 8.5, points: 10, lateSub: false },
        { id: '102', title: 'Lab 2', due: at('2026-10-14T06:59:00Z'), late: at('2026-10-16T06:59:00Z'), sub: false, graded: false, score: null, points: null, lateSub: false },
        { id: '103', title: 'HW 3', due: at('2026-10-16T06:59:00Z'), late: null, sub: false, graded: false, score: null, points: null, lateSub: false },
        { id: '100', title: 'HW 0', due: at('2026-10-10T06:59:00Z'), late: null, sub: false, graded: false, score: null, points: null, lateSub: false },
      ] },
      50: { at: now, bad: 0, rows: [{ id: '900', title: 'Elsewhere', due: now + 1, late: null, sub: false, graded: false, score: null, points: null, lateSub: false }] },
    },
  };
  const items = G.items(rec, 'https://c.test', now);
  assert.deepEqual(items.map((i) => i.id), ['101', '102', '103', '100']);
  assert.ok(items.every((i) => i.type === 'gradescope' && i.cid === '7'));
  assert.equal(items[0].url, 'https://www.gradescope.com/courses/42/assignments/101');
  assert.deepEqual(items.map((i) => i.sub.missing), [false, false, false, true]); // Lab 2 still has its late window
  const tz = 'America/Los_Angeles';
  const build = (data, sync = false) => T.build({ items, data, o: { ...O, past: 'month' }, now, tz, cids: new Set(['7']), names: { 7: 'Math 241' }, sync });
  const b = build({ tasks: [], items: {} });
  const open = b.groups.flatMap(([, l]) => l);
  assert.deepEqual(open.map((r) => r.key).sort(), ['gradescope:100', 'gradescope:102', 'gradescope:103']);
  assert.equal(open.find((r) => r.key === 'gradescope:100').status, 'Missing');
  assert.equal(open[0].course, 'Math 241');
  assert.deepEqual(b.graded.map((r) => r.key), ['gradescope:101']);
  // A tick stays on this device even with "tick off in Canvas too" on: Gradescope has no Canvas planner item.
  const ticked = build({ tasks: [], items: { 'gradescope:103': { done: true } } }, true);
  assert.ok(ticked.done.some((r) => r.key === 'gradescope:103'));
  // On a course card, the course's Gradescope work with the rest.
  const card = T.card(T.build({ items, data: { tasks: [], items: {} }, o: O, now, tz, course: '7' }), 4, false, tz);
  assert.ok(card.some((r) => r.key === 'gradescope:103'));
  // Another site's Canvas, or none: nothing.
  assert.deepEqual(G.items(rec, 'https://elsewhere.test', now), []);
  assert.deepEqual(G.items(undefined, 'https://c.test', now), []);
});

test('on a Canvas page: off means no file is asked for and nothing is added', () => {
  const asked = [];
  globalThis.GZ_CTX = { settings: () => ({ enhance: { gradescope: false } }), need: (f) => { asked.push(f); return new Promise(() => {}); } };
  try {
    const gs = T.gradescope(() => {});
    assert.deepEqual(gs(Date.now()), []);
    assert.deepEqual(asked, []);
    globalThis.GZ_CTX = { settings: () => ({ enhance: { gradescope: true } }), need: (f) => { asked.push(f); return new Promise(() => {}); } };
    assert.deepEqual(gs(Date.now()), []); // asked for, not in yet
    gs(Date.now());
    assert.deepEqual(asked, ['lib/gradescope.js']); // once
  } finally { delete globalThis.GZ_CTX; }
});

test('the worker: who may write, the script on Gradescope only while on, and the daily read kept to its course and day', async () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const vm = require('node:vm');
  const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  const m = require('../manifest.json');
  const store = { sync: { enhance: { gradescope: false } }, local: {} };
  const area = (s) => ({
    get: async (k) => structuredClone(k === null ? s : Object.fromEntries([].concat(k).filter((x) => x in s).map((x) => [x, s[x]]))),
    set: async (v) => { Object.assign(s, structuredClone(v)); },
    remove: async (k) => { for (const x of [].concat(k)) delete s[x]; },
  });
  const listeners = [], changed = [], fetched = [];
  let registered = [];
  let answer = null;
  const context = vm.createContext({
    URL, console, TextEncoder, structuredClone, Promise, Date, setTimeout, clearTimeout, crypto: globalThis.crypto,
    fetch: async (url, init) => { fetched.push([url, init.credentials]); return answer; },
    importScripts: (...files) => { for (const f of files) vm.runInContext(read(`lib/${f}`), context); },
    chrome: {
      runtime: {
        id: 'glaze', getURL: (f = '') => `chrome-extension://x/${f}`, getManifest: () => m,
        onMessage: { addListener: (f) => listeners.push(f) }, onInstalled: { addListener() {} }, onStartup: { addListener() {} }, onConnect: { addListener() {} },
      },
      storage: { local: area(store.local), sync: area(store.sync), onChanged: { addListener: (f) => changed.push(f) } },
      scripting: {
        getRegisteredContentScripts: async () => registered.map((id) => ({ id })),
        registerContentScripts: async (l) => { registered.push(...l.map((s) => s.id)); },
        unregisterContentScripts: async ({ ids }) => { registered = registered.filter((id) => !ids.includes(id)); },
      },
    },
  });
  vm.runInContext(read('lib/background.js'), context);
  const send = (msg, sender) => new Promise((res) => {
    let kept = false;
    for (const f of listeners) if (f(msg, sender, (r) => res(JSON.parse(JSON.stringify(r)))) === true) kept = true;
    if (!kept) res('ignored');
  });
  const settle = () => new Promise((r) => setTimeout(r, 5));
  const toggle = async (on) => { store.sync.enhance = { gradescope: on }; for (const f of changed) f({ enhance: {} }, 'sync'); await settle(); };
  const gs = { id: 'glaze', tab: {}, frameId: 0, url: 'https://www.gradescope.com/courses/42' };
  const canvas = { id: 'glaze', tab: {}, url: 'https://school.instructure.com/' };
  const other = { ...canvas, url: 'https://other.instructure.com/' };
  const to = 'canvas:https://school.instructure.com/7';
  const map = { type: 'glaze:gradescope', op: 'map', list: [{ gid: '42', to }] };
  const nope = { ok: false, error: 'sender' };
  // Off: Gradescope's page may write nothing, and no script is registered there.
  assert.deepEqual(await send(map, gs), nope);
  // On: the script is registered, and Gradescope's own top frame may place courses.
  await toggle(true);
  assert.deepEqual(registered, ['gz-gradescope']);
  assert.equal((await send(map, gs)).ok, true);
  assert.deepEqual(await send(map, { ...gs, frameId: 3 }), nope, 'not a frame inside it');
  assert.deepEqual(await send(map, { ...gs, url: 'https://www.gradescope.com.evil.test/' }), nope);
  // A Canvas page may only keep rows, for a course placed with its own site.
  assert.deepEqual(await send(map, canvas), nope);
  assert.equal((await send({ type: 'glaze:gradescope', op: 'rows', gid: '42', to, rows: [] }, canvas)).ok, true);
  assert.deepEqual(await send({ type: 'glaze:gradescope', op: 'rows', gid: '42', to, rows: [] }, other), nope);
  // The daily read: only with its switch, for this site's course, once a day; Gradescope's sign-in page is no answer.
  const page = { type: 'glaze:gradescope-page', gid: '42' };
  assert.deepEqual(await send(page, canvas), nope);
  store.sync.todo = { gsDaily: true };
  store.local.gradescope.courses = {}; // never read
  assert.deepEqual(await send(page, other), nope);
  answer = { ok: true, url: 'https://www.gradescope.com/login', text: async () => 'Log In' };
  assert.deepEqual(await send(page, canvas), { ok: false, error: 'signed out' });
  assert.deepEqual(await send(page, canvas), { ok: false, error: 'soon' }, 'tried today: not again');
  assert.deepEqual(fetched, [['https://www.gradescope.com/courses/42', 'include']]);
  store.local.gsTried = {};
  answer = { ok: true, url: 'https://www.gradescope.com/courses/42', text: async () => '<table id="assignments-student-table"></table>' };
  const r = await send(page, canvas);
  assert.deepEqual([r.ok, r.to], [true, to]);
  // Off again: the script goes.
  await toggle(false);
  assert.deepEqual(registered, []);
});
