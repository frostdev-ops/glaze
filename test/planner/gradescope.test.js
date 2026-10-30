// Gradescope in Better To Do (lib/gradescope.js): reading a course page row by row, guessing the Canvas course, what's
// kept and for whom, and the items it adds to Better To Do; the worker's rules and the Gradescope page's start. Gradescope's
// markup is from public knowledge of its pages (there's no test account): the real pages are checked by an owner before
// release (W10).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const nodeCrypto = require('node:crypto');
const D = require('../defaults.js');
const T = require('../lib/todo.js');
const G = require('../lib/gradescope.js');

const at = (s) => Date.parse(s);
const O = D.GZ_SANITIZE({}).todo;
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const EMAIL = 'student@school.edu';
const A1 = nodeCrypto.createHash('sha256').update(EMAIL).digest('hex').slice(0, 24);
const A2 = 'f'.repeat(24);

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
const row = (id, more = {}) => ({ id, title: `HW ${id}`, due: 1, late: null, sub: false, graded: false, score: null, points: null, lateSub: false, ...more });
// storage.local as the worker's change() sees it.
// A page script's async work as the tests below run it: SHA-256 is hashed at once (the real digest runs on a thread pool
// that lags on a busy machine) and short timers are counted, so a test waits until none is pending a few turns in a
// row, not for a fixed time.
const pageWork = () => {
  const short = new Set();
  const later = (f, ms, ...a) => { const id = setTimeout(() => { short.delete(id); f(...a); }, ms); if (!(ms > 100)) short.add(id); return id; };
  const cancel = (id) => { short.delete(id); clearTimeout(id); };
  const digest = async (alg, data) => { const b = nodeCrypto.createHash('sha256').update(data).digest(); return b.buffer.slice(b.byteOffset, b.byteOffset + b.length); };
  const settle = async () => { for (let quiet = 0, turns = 0; quiet < 3 && turns < 400; turns++) { await new Promise((r) => setTimeout(r, 5)); quiet = short.size ? 0 : quiet + 1; } };
  return { setTimeout: later, clearTimeout: cancel, crypto: { subtle: { digest }, randomUUID: () => nodeCrypto.randomUUID() }, settle };
};
const memory = (store = {}) => ({ store, area: { local: { get: async (k) => ({ [k[0]]: store[k[0]] }), set: async (p) => { Object.assign(store, JSON.parse(JSON.stringify(p))); return true; } } } });

test('dates: Gradescope\'s "YYYY-MM-DD HH:MM:SS -0700", ISO, and nothing that isn\'t a real date', () => {
  assert.equal(G.when('2026-10-20 23:59:00 -0700'), at('2026-10-21T06:59:00Z'));
  assert.equal(G.when('2026-10-20 23:59:00 +0530'), at('2026-10-20T18:29:00Z'));
  assert.equal(G.when('2026-10-20T23:59:00Z'), at('2026-10-20T23:59:00Z'));
  assert.equal(G.when('2026-10-20T23:59:00-04:00'), at('2026-10-21T03:59:00Z'));
  assert.equal(G.when('2026-10-20 23:59'), new Date(2026, 9, 20, 23, 59).getTime()); // no zone: this browser's
  assert.equal(G.when('2028-02-29 12:00:00 -0800'), at('2028-02-29T20:00:00Z')); // a leap day is a day
  // Impossible dates are no dates (Date alone would roll 30 February into March).
  for (const bad of ['', null, 'Oct 20 at 11:59PM', '2026-13-01 00:00:00 -0700', '2026-10-20 25:00:00 -0700', '2026-02-30 23:59:00 -0800',
    '2027-02-29 12:00:00', '2026-04-31T10:00:00Z', '2026-00-10 10:00:00', { toString: null }]) assert.equal(G.when(bad), null, JSON.stringify(bad));
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
    tr({ title: 'Broken date', aid: '104', due: ['soon'] }), // a date that isn't one: the row stays, without it
    tr({ title: 'Feb 30', aid: '106', due: ['2026-02-30 23:59:00 -0800'] }), // an impossible date: likewise
    tr({ title: '', aid: '105' }), // unreadable
    tr({ title: '', status: '' }), // an empty spacer row: nothing
    { querySelector() { throw new Error('odd row'); }, querySelectorAll() { throw new Error('odd row'); } }, // throws: unreadable
    tr({ title: 'HW 1 again', href: '/courses/42/assignments/101' }), // the same assignment twice: once
    tr({ title: 'Other course', href: '/courses/9/assignments/900' }), // another course's link: no id here
  ];
  const p = G.parse(docOf(rows), '42');
  assert.equal(p.bad, 2);
  assert.deepEqual(p.rows.map((r) => r.id), ['101', '102', '103', '100', '104', '106']);
  assert.deepEqual(p.rows[0], { id: '101', title: 'HW 1', due: at('2026-10-02T06:59:00Z'), late: null, sub: true, graded: true, score: 8.5, points: 10, lateSub: false });
  assert.deepEqual(p.rows[1], { id: '102', title: 'Lab 2', due: at('2026-10-06T06:59:00Z'), late: at('2026-10-08T06:59:00Z'), sub: true, graded: false, score: null, points: null, lateSub: true });
  assert.equal(p.rows[2].sub, false);
  assert.deepEqual([p.rows[4].due, p.rows[5].due], [null, null]);
  // No table (signed out, or a course taught rather than taken): no answer, so what's kept stays.
  assert.equal(G.parse(el(), '42'), null);
  // An empty table is an answer: nothing to do.
  assert.deepEqual(G.parse(docOf([]), '42'), { rows: [], bad: 0 });
  // The table without its id: the one whose rows open assignments.
  const bare = el({ one: { 'tbody a[href*="/assignments/"], tbody [data-assignment-id]': el() }, all: { 'tbody tr': [tr({ title: 'HW 9', aid: '109' })] } });
  assert.deepEqual(G.parse(el({ all: { table: [el(), bare] } }), '42').rows.map((r) => r.id), ['109']);
});

test('status words: a score, "Graded", "Submitted", "No Submission", and the complete class', () => {
  const st = (status, cls) => G.row({ title: 'x', aid: '1', status, cls, due: [] }, '42');
  assert.equal(st('No Submission').sub, false);
  assert.equal(st('Not submitted').sub, false);
  assert.equal(st('Submitted').sub, true);
  assert.deepEqual([st('SubmittedLate').sub, st('SubmittedLate').lateSub], [true, true]); // parts run together in textContent
  assert.equal(st('NoSubmission').sub, false);
  assert.equal(st('0.0 / 5.0').graded, true);
  assert.deepEqual([st('Graded').sub, st('Graded').graded, st('Graded').score], [true, true, null]);
  assert.equal(st('Ungraded').graded, false);
  assert.equal(st('', 'submissionStatus submissionStatus-complete').sub, true);
  assert.equal(st('Something new').sub, false); // unknown words: still open, the student can tick it
});

test('whose: the account page names the account by a hash of its email, never the address itself', async () => {
  const page = (v) => el({ one: Object.fromEntries(Object.entries(v).map(([k, x]) => [`input[name="user[${k}]"]`, el({ attrs: { value: x } })])) });
  assert.deepEqual(await G.account(page({ email: ' Student@School.edu ', name: 'Sam Student' })), { id: A1, name: 'Sam Student' });
  assert.deepEqual(await G.account(page({ email: EMAIL, first_name: 'Sam', last_name: 'S' })), { id: A1, name: 'Sam S' });
  assert.equal(await G.account(page({ name: 'No email' })), null);
  assert.equal(await G.account(el()), null); // the sign-in page, or markup that moved: no account, nothing done
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

test('Canvas courses to pick from are told apart: code and site in every label, the id when that is not enough', () => {
  const labels = G.canvas({
    'canvas:https://a.instructure.com/1': { name: 'Calculus I', code: 'MATH 1350', canvas: true },
    'canvas:https://b.instructure.com/1': { name: 'Calculus I', code: 'MATH 1350', canvas: true },
    'canvas:https://a.instructure.com/2': { name: 'Calculus I', code: 'MATH 1350', canvas: true }, // another term, same words
    'canvas:https://a.instructure.com/3': { name: 'Biology', code: 'Biology', canvas: true },
    'ultra:https://bb.test/_1_1': { name: 'Calculus I' }, // not Canvas
  }).map((c) => c.label);
  assert.deepEqual(labels, ['Biology · a.instructure.com', 'Calculus I · MATH 1350 · a.instructure.com · #1', 'Calculus I · MATH 1350 · a.instructure.com · #2',
    'Calculus I · MATH 1350 · b.instructure.com']);
  assert.equal(new Set(labels).size, labels.length);
});

test('what\'s kept: one Gradescope account; placings and rows only for it; another account starts afresh', async () => {
  const { area } = memory();
  const to = 'canvas:https://c.test/7';
  assert.equal((await G.change({ op: 'map', acct: A1, list: [{ gid: '42', to }] }, area)).ok, false); // no account known yet
  assert.equal((await G.change({ op: 'acct', acct: { id: 'nope', name: 'x' } }, area)).ok, false);
  let r = await G.change({ op: 'acct', acct: { id: A1, name: 'Sam' } }, area);
  assert.deepEqual(r.data.acct, { id: A1, name: 'Sam' });
  r = await G.change({ op: 'map', acct: A1, list: [{ gid: '42', to, name: 'MATH 241' }, { gid: '43', to: '' }, { gid: 'x', to }, { gid: '44', to: 'https://evil.test' }] }, area);
  assert.deepEqual(r.data.map, { 42: { to, name: 'MATH 241' }, 43: { to: '', name: '' } });
  assert.equal((await G.change({ op: 'rows', acct: A1, gid: '42', to: 'canvas:https://c.test/8', rows: [row('101')] }, area)).ok, false); // placed elsewhere since
  assert.equal((await G.change({ op: 'rows', acct: A1, gid: '43', to: '', rows: [row('101')] }, area)).ok, false); // "not a Canvas course"
  assert.equal((await G.change({ op: 'rows', acct: A2, gid: '42', to, rows: [row('101')] }, area)).ok, false); // another account's
  r = await G.change({ op: 'rows', acct: A1, gid: '42', to, rows: [row('101'), { id: 'nope', title: 'x' }, null], bad: 2 }, area);
  assert.deepEqual(r.data.courses[42].rows, [row('101')]);
  assert.equal(r.data.courses[42].bad, 2);
  // Placed with another course: what was read goes with the old placing.
  r = await G.change({ op: 'map', acct: A1, list: [{ gid: '42', to: 'canvas:https://c.test/8' }] }, area);
  assert.equal(r.data.courses[42], undefined);
  assert.equal(r.data.map[42].name, 'MATH 241');
  r = await G.change({ op: 'hide', hide: true }, area);
  assert.equal(r.data.hide, true);
  // An answer counts only for the account it was asked about, and only while that account is the one kept.
  assert.equal((await G.change({ op: 'bind', key: 'https://c.test/111', show: true }, area)).ok, false, 'no account named');
  assert.equal((await G.change({ op: 'bind', key: 'https://c.test/111', acct: A2, show: true }, area)).ok, false, 'another account');
  r = await G.change({ op: 'bind', key: 'https://c.test/111', acct: A1, show: true }, area);
  assert.deepEqual(r.data.bind, { 'https://c.test/111': { id: A1, show: true } });
  // Another account signs in on Gradescope: placings, rows and the dismissal go; the answers stay, for the account they named.
  r = await G.change({ op: 'acct', acct: { id: A2, name: 'Alex' } }, area);
  assert.deepEqual([r.data.map, r.data.courses, r.data.hide, r.data.bind], [{}, {}, false, { 'https://c.test/111': { id: A1, show: true } }]);
  // A yes to A's question that arrives after B signed in grants B nothing.
  assert.equal((await G.change({ op: 'bind', key: 'https://c.test/222', acct: A1, show: true }, area)).ok, false);
  assert.equal(r.data.bind['https://c.test/222'], undefined);
  r = await G.change({ op: 'bind', key: null }, area);
  assert.deepEqual(r.data.bind, {});
  assert.equal((await G.change({ op: 'bind', key: 'not a key', show: true }, area)).ok, false);
  assert.equal((await G.change({ op: 'other' }, area)).ok, false);
  assert.deepEqual(G.clean('junk'), { acct: null, map: {}, courses: {}, hide: false, bind: {} });
});

test('in Better To Do: only for a Canvas user who said yes, this site\'s courses, missing once the last due date passes, ticked on this device', () => {
  const now = at('2026-10-15T12:00:00Z');
  const rec = {
    acct: { id: A1, name: 'Sam' },
    map: { 42: { to: 'canvas:https://c.test/7', name: 'MATH 241' }, 50: { to: 'canvas:https://other.test/7', name: 'X' }, 51: { to: '', name: 'Y' } },
    courses: {
      42: { at: now, bad: 0, rows: [
        row('101', { title: 'HW 1', due: at('2026-10-01T06:59:00Z'), sub: true, graded: true, score: 8.5, points: 10 }),
        row('102', { title: 'Lab 2', due: at('2026-10-14T06:59:00Z'), late: at('2026-10-16T06:59:00Z') }),
        row('103', { title: 'HW 3', due: at('2026-10-16T06:59:00Z') }),
        row('100', { title: 'HW 0', due: at('2026-10-10T06:59:00Z') }),
      ] },
      50: { at: now, bad: 0, rows: [row('900', { due: now + 1 })] },
    },
    bind: { 'https://c.test/111': { id: A1, show: true }, 'https://c.test/333': { id: A1, show: false }, 'https://c.test/444': { id: A2, show: true } },
  };
  // Two Canvas users on one site and browser: only the one who said yes to this Gradescope account sees its work.
  assert.deepEqual(G.items(rec, 'https://c.test', '222', now), [], 'never asked: nothing');
  assert.deepEqual(G.items(rec, 'https://c.test', '333', now), [], 'said "Not here": nothing');
  assert.deepEqual(G.items(rec, 'https://c.test', '444', now), [], 'said yes to another Gradescope account: nothing');
  assert.equal(G.ask(rec, 'https://c.test', '222'), 'Sam');
  assert.equal(G.ask(rec, 'https://c.test', '444'), 'Sam', 'asked again for this account');
  assert.equal(G.ask(rec, 'https://c.test', '111'), null);
  assert.equal(G.ask(rec, 'https://c.test', '333'), null, '"Not here" is an answer');
  assert.equal(G.ask(rec, 'https://elsewhere.test', '222'), null, 'nothing placed with that site: not asked');
  const items = G.items(rec, 'https://c.test', '111', now);
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
  // Another site's Canvas, or nothing kept: nothing.
  assert.deepEqual(G.items(rec, 'https://elsewhere.test', '111', now), []);
  assert.deepEqual(G.items(undefined, 'https://c.test', '111', now), []);
});

test('on a Canvas page: off means no file is asked for and nothing is added', () => {
  const asked = [];
  globalThis.GZ_CTX = { settings: () => ({ enhance: { gradescope: false } }), need: (f) => { asked.push(f); return new Promise(() => {}); } };
  try {
    const gs = T.gradescope(() => {});
    assert.deepEqual(gs(Date.now(), '111'), []);
    assert.equal(gs.ask('111'), null);
    assert.deepEqual(asked, []);
    globalThis.GZ_CTX = { settings: () => ({ enhance: { gradescope: true } }), need: (f) => { asked.push(f); return new Promise(() => {}); } };
    assert.deepEqual(gs(Date.now(), '111'), []); // asked for, not in yet
    gs(Date.now(), '111');
    assert.deepEqual(asked, ['lib/gradescope.js']); // once
    // Glaze switched off as a whole: nothing, whatever the Gradescope switch says.
    const off = T.gradescope(() => {});
    globalThis.GZ_CTX = { settings: () => ({ enabled: false, enhance: { gradescope: true } }), need: (f) => { asked.push(f); return new Promise(() => {}); } };
    assert.deepEqual(off(Date.now(), '111'), []);
    assert.equal(asked.length, 1);
  } finally { delete globalThis.GZ_CTX; }
});

test('the worker: who may write, the script on Gradescope only while on, and the daily read kept to its course, account and day', async () => {
  const m = require('../manifest.json');
  const store = { sync: { enhance: { gradescope: false } }, local: {} };
  let onSet = null;
  const area = (s) => ({
    get: async (k) => structuredClone(k === null ? s : Object.fromEntries([].concat(k).filter((x) => x in s).map((x) => [x, s[x]]))),
    set: async (v) => { Object.assign(s, structuredClone(v)); onSet?.(v); },
    remove: async (k) => { for (const x of [].concat(k)) delete s[x]; },
  });
  const listeners = [], changed = [], fetched = [];
  let registered = [];
  let answer = null;
  let hold = null; // a promise the next requests wait on, as a slow network would
  let gsHeld = false; // the browser's grant for www.gradescope.com (not a required host: the switch asks for it)
  const pages = { '/courses/42': '<table id="assignments-student-table"></table>', '/account/edit': `<input name="user[email]" value="${EMAIL}">` };
  const context = vm.createContext({
    URL, console, TextEncoder, structuredClone, Promise, Date, setTimeout, clearTimeout, crypto: globalThis.crypto,
    fetch: async (url, init) => {
      fetched.push([url, init.credentials, init.redirect]);
      if (hold) await hold;
      if (answer === 'redirect' && init.redirect === 'error') throw new TypeError('Failed to fetch'); // as the browser does, before any second request
      if (answer === 'redirect') { fetched.push(['https://www.gradescope.com/login', init.credentials, 'followed']); return { ok: true, url: 'https://www.gradescope.com/login', text: async () => 'Log In' }; }
      const p = new URL(url).pathname;
      return { ok: true, url, text: async () => pages[p] };
    },
    importScripts: (...files) => { for (const f of files) vm.runInContext(read(`lib/${f}`), context); },
    chrome: {
      runtime: {
        id: 'glaze', getURL: (f = '') => `chrome-extension://x/${f}`, getManifest: () => m,
        onMessage: { addListener: (f) => listeners.push(f) }, onInstalled: { addListener() {} }, onStartup: { addListener() {} }, onConnect: { addListener() {} },
      },
      storage: { local: area(store.local), sync: area(store.sync), onChanged: { addListener: (f) => changed.push(f) } },
      permissions: {
        contains: async ({ origins }) => origins.every((o) => (gsHeld && o === 'https://www.gradescope.com/*') || m.host_permissions.includes(o)),
        getAll: async () => ({ origins: [...m.host_permissions, ...(gsHeld ? ['https://www.gradescope.com/*'] : [])] }),
        remove: async ({ origins }) => { if (origins.includes('https://www.gradescope.com/*')) gsHeld = false; return true; },
      },
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
  const toggle = async (on) => { const was = store.sync.enhance; store.sync.enhance = { gradescope: on }; for (const f of changed) f({ enhance: { oldValue: was, newValue: store.sync.enhance } }, 'sync'); await settle(); };
  const gs = { id: 'glaze', tab: {}, frameId: 0, url: 'https://www.gradescope.com/courses/42' };
  const canvas = { id: 'glaze', tab: {}, url: 'https://school.instructure.com/' };
  const other = { ...canvas, url: 'https://other.instructure.com/' };
  const to = 'canvas:https://school.instructure.com/7';
  const acct = { type: 'glaze:gradescope', op: 'acct', acct: { id: A1, name: 'Sam' } };
  const map = { type: 'glaze:gradescope', op: 'map', acct: A1, list: [{ gid: '42', to }] };
  const rows = { type: 'glaze:gradescope', op: 'rows', acct: A1, gid: '42', to, rows: [] };
  const me = 'https://school.instructure.com/111';
  const nope = { ok: false, error: 'sender' };
  // Off: Gradescope's page may write nothing, and no script is registered there.
  assert.deepEqual(await send(acct, gs), nope);
  // On without the browser's grant for Gradescope (refused, or taken back): still nothing registered.
  await toggle(true);
  assert.deepEqual(registered, [], 'no script on a host Glaze does not hold');
  // On, held: the script is registered, and Gradescope's own top frame may say who's signed in and place courses.
  gsHeld = true;
  await toggle(true);
  assert.deepEqual(registered, ['gz-gradescope']);
  assert.equal((await send(acct, gs)).ok, true);
  assert.equal((await send(map, gs)).ok, true);
  assert.deepEqual(await send(map, { ...gs, frameId: 3 }), nope, 'not a frame inside it');
  assert.deepEqual(await send(map, { ...gs, url: 'https://www.gradescope.com.evil.test/' }), nope);
  assert.deepEqual(await send({ type: 'glaze:gradescope', op: 'bind', key: me, acct: A1, show: true }, gs), nope, "Gradescope can't answer for Canvas");
  // A Canvas page may keep rows for a course placed with its own site, and answer for its own site's accounts only.
  assert.deepEqual(await send(map, canvas), nope);
  assert.equal((await send(rows, canvas)).ok, true);
  assert.deepEqual(await send(rows, other), nope);
  assert.deepEqual(await send({ type: 'glaze:gradescope', op: 'bind', key: 'https://other.instructure.com/111', acct: A1, show: true }, canvas), nope);
  // The daily read: only with its switch, for a Canvas account of this site that said yes, once a day.
  const page = { type: 'glaze:gradescope-page', gid: '42', key: me };
  store.sync.todo = { gsDaily: true };
  assert.deepEqual(await send(page, canvas), nope, 'this Canvas account never said yes');
  assert.equal((await send({ type: 'glaze:gradescope', op: 'bind', key: me, acct: A1, show: true }, canvas)).ok, true);
  assert.deepEqual(await send({ ...page, key: 'https://school.instructure.com/222' }, canvas), nope, 'another Canvas user of the site');
  assert.deepEqual(await send(page, other), nope);
  store.sync.todo = { gsDaily: false };
  assert.deepEqual(await send(page, canvas), nope, 'its switch off');
  store.sync.todo = { gsDaily: true };
  store.local.gradescope.courses = {}; // never read
  // Signed out, Gradescope redirects to its sign-in page: the redirect isn't followed, and it counts as tried today.
  answer = 'redirect';
  assert.deepEqual(await send(page, canvas), { ok: false, error: 'signed out' });
  assert.deepEqual(await send(page, canvas), { ok: false, error: 'soon' }, 'tried today: not again');
  assert.deepEqual(fetched, [['https://www.gradescope.com/courses/42', 'include', 'error']], 'one request, the redirect not followed');
  // Signed in: the course page and the account page, both refusing redirects.
  store.local.gsTried = {};
  answer = null;
  fetched.length = 0;
  const r = await send(page, canvas);
  assert.deepEqual([r.ok, r.to, r.html, r.account], [true, to, pages['/courses/42'], pages['/account/edit']]);
  assert.deepEqual(fetched.map(([u, , how]) => [u, how]), [['https://www.gradescope.com/courses/42', 'error'], ['https://www.gradescope.com/account/edit', 'error']]);
  // What the read rests on changing while its course GET is held: on release no account page is asked for, and the
  // read is no answer. The yes taken back; another Gradescope account kept; the course placed elsewhere.
  for (const [why, undo, redo] of [
    ['the yes taken back', () => { store.local.gradescope.bind[me].show = false; }, () => { store.local.gradescope.bind[me].show = true; }],
    ['another account kept', () => { store.local.gradescope.acct = { id: A2, name: 'Alex' }; }, () => { store.local.gradescope.acct = { id: A1, name: 'Sam' }; }],
    ['placed elsewhere', () => { store.local.gradescope.map[42].to = 'canvas:https://school.instructure.com/8'; }, () => { store.local.gradescope.map[42].to = to; }],
  ]) {
    store.local.gsTried = {};
    fetched.length = 0;
    let release;
    hold = new Promise((y) => { release = y; });
    const pending = send(page, canvas);
    await settle();
    assert.equal(fetched.length, 1, `${why}: the course GET is out`);
    undo();
    release();
    assert.deepEqual(await pending, { ok: false, error: 'off' }, why);
    assert.deepEqual(fetched.map(([u]) => u), ['https://www.gradescope.com/courses/42'], `${why}: no account page asked for`);
    hold = null;
    redo();
  }
  // The grant taken back: the read is refused before a request, and isn't counted as tried.
  store.local.gsTried = {};
  fetched.length = 0;
  gsHeld = false;
  assert.deepEqual(await send(page, canvas), { ok: false, error: 'host' });
  assert.deepEqual(fetched, [], 'no request to a host Glaze does not hold');
  assert.deepEqual(store.local.gsTried, {}, 'not tried');
  gsHeld = true;
  // Turned off while the read is under way (here, as its try is noted): not one request more.
  store.local.gsTried = {};
  fetched.length = 0;
  onSet = (v) => { if (v.gsTried) store.sync.enhance = { gradescope: false }; };
  assert.equal((await send(page, canvas)).ok, false);
  assert.deepEqual(fetched, [], 'switched off before the request: none');
  onSet = null;
  store.sync.enhance = { gradescope: true };
  store.local.gsTried = {};
  onSet = (v) => { if (v.gsTried) store.sync.enabled = false; };
  assert.equal((await send(page, canvas)).ok, false);
  assert.deepEqual(fetched, [], 'Glaze off before the request: none');
  onSet = null;
  // Glaze off as a whole, Gradescope's switch still on: no script, no writes, no daily read, as if it were off.
  store.local.gsTried = {};
  for (const f of changed) f({ enabled: {} }, 'sync');
  await settle();
  assert.deepEqual(registered, [], 'unregistered when Glaze is off');
  assert.deepEqual(await send(map, gs), nope);
  assert.deepEqual(await send(rows, canvas), nope);
  assert.deepEqual(await send(page, canvas), nope);
  assert.deepEqual(fetched, [], 'no request to Gradescope');
  store.sync.enabled = true;
  for (const f of changed) f({ enabled: {} }, 'sync');
  await settle();
  assert.deepEqual(registered, ['gz-gradescope'], 'back when Glaze is on again');
  // Off again: the script goes, and the grant goes back.
  await toggle(false);
  assert.deepEqual(registered, []);
  assert.equal(gsHeld, false, 'the Gradescope grant is handed back');
});

test('on Gradescope: only with Glaze and its switch on; whose account first; redirects refused; stops when switched off mid-way', async () => {
  const run = async (sync, { redirect = false, offAfter = null, placed = ['42', '43'] } = {}) => {
    const fetched = [], drawn = [], sent = [], work = pageWork();
    const local = { seenCourses: {}, gradescope: { acct: { id: A1, name: 'Sam' }, map: Object.fromEntries(placed.map((g) => [g, { to: 'canvas:https://c.test/7', name: g }])) } };
    const get = (s) => ({ get: (k, cb) => cb(Object.fromEntries([].concat(k).filter((x) => x in s).map((x) => [x, s[x]]))) });
    const node = () => ({ prepend: (x) => drawn.push(x) });
    const doc = { querySelector: () => null, querySelectorAll: () => [] };
    const context = vm.createContext({
      URL, console, Promise, Date, setTimeout: work.setTimeout, TextEncoder, crypto: work.crypto, matchMedia: () => ({ matches: false, addEventListener() {} }), clearTimeout: work.clearTimeout, addEventListener() {}, navigator: { language: 'en' }, location: { pathname: '/' },
      DOMParser: class { parseFromString(s) { return s === 'account' ? { querySelector: (q) => (q === 'input[name="user[email]"]' ? { getAttribute: () => EMAIL } : null) } : doc; } },
      fetch: async (u, init) => {
        fetched.push(u);
        if (init?.redirect !== 'error') fetched.push(`redirect: ${init?.redirect}`);
        if (redirect && init?.redirect === 'error' && u !== '/account/edit') throw new TypeError('Failed to fetch');
        if (u === offAfter) sync.enabled = false; // Glaze turned off while this batch runs
        return { ok: true, url: `https://www.gradescope.com${u}`, text: async () => (u === '/account/edit' ? 'account' : '') };
      },
      document: { ...doc, body: node(), createElement: () => ({}) },
      chrome: {
        i18n: { getUILanguage: () => 'en' },
        runtime: { id: 'glaze', getURL: (p) => `chrome-extension://x/${p}`, sendMessage: (m, cb) => { sent.push(m.op); if (m.type !== 'glaze:gradescope') return cb({ ok: true }); context.GZ_GRADESCOPE.change(m, memory(local).area).then(cb); } },
        storage: { sync: get(sync), local: get(local) },
      },
    });
    context.window = context;
    context.window.top = context;
    for (const f of ['lib/color.js', 'lib/i18n.js', 'lib/fonts.js', 'lib/surfaces.js', 'defaults.js', 'lib/gradescope.js', 'features/gradescope.js']) vm.runInContext(read(f), context);
    await work.settle();
    return { fetched, drawn, sent };
  };
  const on = { enhance: { gradescope: true } };
  assert.deepEqual((await run({ ...on })).fetched, ['/account/edit', '/courses/42', '/courses/43'], 'on: whose first, then each placed course, redirects refused');
  // Signed out (a redirect to the sign-in page): not followed, nothing kept, so the rows already kept stay.
  const out = await run({ ...on }, { redirect: true, placed: ['42'] });
  assert.deepEqual([out.fetched, out.sent.filter((op) => op === 'rows')], [['/account/edit', '/courses/42'], []]);
  // Switched off after the first course: the next one is never asked for.
  assert.deepEqual((await run({ ...on }, { offAfter: '/courses/42' })).fetched, ['/account/edit', '/courses/42']);
  assert.deepEqual(await run({ enabled: false, enhance: { gradescope: true } }), { fetched: [], drawn: [], sent: [] }, 'Glaze off: nothing');
  assert.deepEqual(await run({ enhance: { gradescope: false } }), { fetched: [], drawn: [], sent: [] }, 'its switch off: nothing');
});

test('on Gradescope: the bar is drawn only if both switches still hold after every wait, and goes when either is turned off', async () => {
  // Just enough of an element for the bar.
  class E {
    constructor(tag = 'div') { this.tagName = tag.toUpperCase(); this.children = []; this.dataset = {}; this.attrs = {}; this.on = {}; this.parent = null; this.style = { setProperty: (k, v) => { this.style[k] = v; }, removeProperty: (k) => { delete this.style[k]; } }; }
    append(...xs) { for (const x of xs) { if (x && typeof x === 'object') x.parent = this; this.children.push(x); } }
    prepend(x) { x.parent = this; this.children.unshift(x); }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this); this.parent = null; }
    attachShadow() { return (this.shadowRoot = new E('shadow')); }
    addEventListener(t, f) { this.on[t] = f; }
    setAttribute(k, v) { this.attrs[k] = v; }
    getAttribute(k) { return this.attrs[k] ?? null; }
    querySelector() { return null; }
    querySelectorAll() { return []; }
    closest() { return this; }
  }
  const run = async ({ lang = 'en', offWhileLoading = false, look = {}, readFails = false } = {}) => {
    const sync = { enhance: { gradescope: true }, look }, work = pageWork();
    const local = {
      seenCourses: { 'canvas:https://c.test/7': { name: 'Calculus I', code: 'MATH 1350', canvas: true } },
      gradescope: { acct: { id: A1, name: 'Sam' } },
    };
    const changed = [];
    const main = new E('main');
    const box = new E('a');
    box.attrs.href = '/courses/900001';
    box.querySelector = (q) => (q === '.courseBox--shortname' ? { textContent: 'MATH 1350' } : null);
    const get = (s) => ({ get: (k, cb) => { if (readFails) throw Error('storage failed'); cb(Object.fromEntries([].concat(k).filter((x) => x in s).map((x) => [x, s[x]]))); } });
    const context = vm.createContext({
      URL, console, Promise, Date, setTimeout: work.setTimeout, TextEncoder, crypto: work.crypto, matchMedia: () => ({ matches: false, addEventListener() {} }), clearTimeout: work.clearTimeout, addEventListener() {}, navigator: { language: lang }, location: { pathname: '/' },
      DOMParser: class { parseFromString() { return { querySelector: (q) => (q === 'input[name="user[email]"]' ? { getAttribute: () => EMAIL } : null) }; } },
      fetch: async (u) => ({ ok: true, url: `https://www.gradescope.com${u}`, text: async () => 'account' }),
      document: { querySelector: (q) => (q === 'main' ? main : null), querySelectorAll: (q) => (q.includes('courseBox') ? [box] : []), body: new E('body'), createElement: (t) => new E(t) },
      chrome: {
        i18n: { getUILanguage: () => lang },
        runtime: {
          id: 'glaze', getURL: (p) => `chrome-extension://x/${p}`,
          sendMessage: (m, cb) => {
            if (m.type === 'glaze:load') { if (offWhileLoading) sync.enabled = false; return work.setTimeout(() => cb({ ok: true }), 5); }
            context.GZ_GRADESCOPE.change(m, memory(local).area).then(cb);
          },
        },
        storage: { sync: get(sync), local: get(local), onChanged: { addListener: (f) => changed.push(f) } },
      },
    });
    context.window = context;
    context.window.top = context;
    for (const f of ['lib/color.js', 'lib/i18n.js', 'lib/fonts.js', 'lib/surfaces.js', 'defaults.js', 'lib/gradescope.js', 'features/gradescope.js']) vm.runInContext(read(f), context);
    await work.settle();
    const off = async (patch) => {
      Object.assign(sync, patch);
      for (const f of changed) f(Object.fromEntries(Object.keys(patch).map((k) => [k, { newValue: patch[k] }])), 'sync');
      await work.settle();
    };
    return { main, off };
  };
  // Glaze turned off while the page's words load: the old wait draws nothing.
  assert.equal((await run({ lang: 'de', offWhileLoading: true })).main.children.length, 0);
  // Drawn, then Glaze turned off: it goes. Drawn, then the Gradescope switch turned off: it goes too.
  const a = await run();
  assert.equal(a.main.children.length, 1, 'the bar');
  await a.off({ enabled: false });
  assert.equal(a.main.children.length, 0, 'gone with Glaze off');
  const b = await run();
  assert.equal(b.main.children.length, 1);
  await b.off({ enhance: { gradescope: false } });
  assert.equal(b.main.children.length, 0, 'gone with its switch off');
  const styled = await run({ look: { radius: 0, depth: 3, surfaceCustom: true, surfaceColor: '#334455', surfaceBorder: 0, surfaceFrost: 50 } });
  assert.equal(styled.main.children[0].style['--gz-radius'], '0px');
  assert.equal(styled.main.children[0].style['--gz-surface-color'], '#334455');
  assert.equal(styled.main.children[0].attrs['data-gz-depth'], '3');
  await styled.off({ look: { radius: 24, surfaceBorder: 50 } });
  assert.equal(styled.main.children[0].style['--gz-radius'], '24px');
  assert.equal(styled.main.children[0].style['--gz-surface-color'], undefined);
  assert.equal(styled.main.children[0].style['--gz-surface-border'], '50%');
  assert.equal((await run({ readFails: true })).main.children.length, 0, 'failed reads never draw');
  // Another setting changing leaves it.
  const c = await run();
  await c.off({ enhance: { gradescope: true, todo: true } });
  assert.equal(c.main.children.length, 1);
});
