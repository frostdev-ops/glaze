// Blackboard Ultra speed (D): courses/ultra.js's page stores on a stand-in site. Who's signed in and their memberships
// once per site (the worker's session copy, the last student per site), each course's gradebook once per student and
// minute (in-flight, TTL, a copy kept for a stale-while-revalidate paint), a course's content once per five minutes, and
// what's due once per range of whole days, read with To Do beside the calendar and three courses at a time.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const U = require('../../extension/courses/ultra.js');
const T = require('../../extension/planner/todo.js');
const D = require('../../extension/content/defaults.js');

const load = (n) => JSON.parse(fs.readFileSync(path.join(__dirname, '../fixtures', `ultra-${n}.json`), 'utf8'));
const O = 'https://bb.example.edu';
const DAY = 864e5;
const LATER = Date.parse('2026-10-24T12:00:00Z');
const settle = async (n = 20) => { for (let i = 0; i < n; i++) await new Promise(setImmediate); };
const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
const PREFS = D.GZ_SANITIZE({}).todo;

// A stand-in Ultra site and the page's surroundings (makePage's env). answers: path prefix → body (or a function of the
// URL); hold(url) → true keeps that answer until release(). session: the worker's copy to start with; local: storage.local.
const site = ({ answers = {}, now = LATER, local = {}, session = null, framed = null, hold = () => false, prefs = null } = {}) => {
  const asked = [], sent = [], waiting = [], store = structuredClone(local), clock = { t: now };
  const box = { session: session && structuredClone(session) };
  let busy = 0;
  const fetch = async (url, init, prio) => {
    const u = new URL(url);
    const rec = { url, path: u.pathname, prio, init, busyAtStart: ++busy };
    asked.push(rec);
    try {
      if (hold(u)) await new Promise((r) => waiting.push(r));
      const key = Object.keys(answers).filter((k) => (u.pathname + u.search).startsWith(k)).sort((a, b) => b.length - a.length)[0];
      const body = key ? answers[key] : null;
      return { ok: !!body, status: body ? 200 : 404, text: async () => JSON.stringify(typeof body === 'function' ? body(u) : body) };
    } finally { busy--; }
  };
  const env = {
    origin: () => O, now: () => clock.t, fetch, live: () => true,
    local: { get: async (k) => structuredClone(Object.fromEntries([k].flat().filter((x) => x in store).map((x) => [x, store[x]]))), set: async (v) => { Object.assign(store, structuredClone(v)); return true; } },
    // The worker's 'glaze:ultraMine' (background/background.js), over box.session.
    send: async (m) => {
      sent.push(structuredClone(m));
      if (m.type !== 'glaze:ultraMine') return null;
      if (m.op === 'get') return structuredClone(box.session);
      if (m.op === 'touch' && box.session?.uid === m.uid) box.session.at = clock.t;
      if (m.op === 'put') box.session = { ...structuredClone(m.mine), read: clock.t, at: clock.t };
      return null;
    },
    framed: () => framed,
    todo: () => (prefs ? T : null), todoPrefs: () => prefs,
  };
  return { page: U.makePage(env), env, asked, sent, store, clock, box, release: () => { for (const r of waiting.splice(0)) r(); } };
};
const ANSWERS = () => ({
  '/learn/api/v1/users/me': { id: '_900_1' },
  '/learn/api/v1/users/_900_1/memberships': load('memberships'),
  '/learn/api/v1/calendars/todo/studentItems': load('todo'),
  '/learn/api/v1/calendars/calendarItems': load('calendar-items'),
  '/learn/api/v1/courses/_101_1/gradebook/grades': load('grades'),
  '/learn/api/v1/courses/_102_1/gradebook/grades': load('grades-status'),
  '/learn/api/v1/courses/_101_1/gradebook/memberships/_301_1/exceptions': { results: [] },
  '/learn/api/v1/courses/_102_1/gradebook/memberships/_302_1/exceptions': { results: [{ columnId: '_613_1', dueDate: '2026-10-30T03:59:00.000Z' }] },
});
const count = (asked, re) => asked.filter((a) => re.test(a.path)).length;

// ---- what's due --------------------------------------------------------------------------------------------------

test('planner: To Do and the calendar are asked beside the student, not after; the answer is exactly the one-at-a-time one', async () => {
  let holding = true;
  const s = site({ answers: ANSWERS(), hold: (u) => holding && u.pathname.endsWith('/studentItems') });
  const p = s.page.due(LATER - 14 * DAY, LATER + 14 * DAY);
  await settle();
  assert.ok(count(s.asked, /\/calendarItems$/) >= 1, 'the calendar is asked while To Do is still out');
  assert.ok(count(s.asked, /\/users\/me$/) === 1, 'and the student');
  holding = false;
  s.release();
  const { items, complete } = await p;
  // The same reads, one at a time on a plain reader (the shape test/courses/ultra.test.js pins).
  const seq = await U.planner(U.read({ origin: O, f: (u, i) => s.env.fetch(u, i) }), { from: LATER - 14 * DAY, to: LATER + 14 * DAY, now: LATER });
  const strip = (l) => l.map((i) => ({ ...i, url: i.url.replace(O, '') })).sort((a, b) => a.id.localeCompare(b.id));
  assert.deepEqual(strip(items), strip(seq.items));
  assert.equal(complete, seq.complete);
  const by = Object.fromEntries(items.map((i) => [i.id, i]));
  assert.deepEqual(Object.keys(by).sort(), ['_603_1', '_605_1', '_606_1', '_613_1']);
  assert.deepEqual([by._603_1.state, by._603_1.sub.missing], ['missing', true]);
  assert.deepEqual([by._613_1.state, by._613_1.sub], ['unknown', null], 'its exception still counts');
});

test('planner: each course with work due is read through the page reader, three courses at a time', async () => {
  const cids = ['_101_1', '_102_1', '_103_1', '_104_1', '_105_1', '_106_1', '_107_1'];
  const todo = { overdueItems: [], dueTodayItems: [], futureDueItems: cids.map((cid, i) => ({ ...load('todo').futureDueItems[0], column: { ...load('todo').futureDueItems[0].column, id: `_70${i}_1`, courseId: cid } })) };
  let inGrades = 0, most = 0;
  const answers = { ...ANSWERS(), '/learn/api/v1/calendars/todo/studentItems': todo, '/learn/api/v1/calendars/calendarItems': { results: [] } };
  for (const cid of cids) answers[`/learn/api/v1/courses/${cid}/gradebook/grades`] = { results: [] };
  const s = site({ answers, hold: (u) => { if (!/gradebook\/grades$/.test(u.pathname)) return false; most = Math.max(most, ++inGrades); return true; } });
  const p = s.page.due(LATER, LATER + 7 * DAY);
  for (let i = 0; i < 10; i++) { await settle(); inGrades = 0; s.release(); }
  const { items } = await p;
  assert.equal(items.length, cids.length);
  assert.equal(count(s.asked, /gradebook\/grades$/), cids.length, 'every course once');
  assert.equal(most, 3, 'never more than three at once');
});

test("Better To Do's default range is one To Do request, laid back from its end so what's left of it is covered", async () => {
  const s = site({ answers: ANSWERS() });
  const now = Date.now();
  s.clock.t = now;
  const { start, end } = T.fetchRange(PREFS, now, TZ);
  await s.page.due(Date.parse(start), Date.parse(end));
  const todo = s.asked.filter((a) => a.path.endsWith('/studentItems'));
  assert.equal(todo.length, 1);
  const u = new URL(todo[0].url);
  assert.ok(Date.parse(u.searchParams.get('since')) <= now && Date.parse(u.searchParams.get('until')) === Date.parse(end));
  assert.equal(count(s.asked, /\/calendarItems$/), 1, 'the calendar answers the whole range');
  assert.equal(new URL(s.asked.find((a) => a.path.endsWith('/calendarItems')).url).searchParams.get('since'), start);
});

test('To Do ranges are whole days: the same day asked to the millisecond, or a range inside a fresh read, is that read', async () => {
  const s = site({ answers: ANSWERS() });
  const { start, end } = T.fetchRange(PREFS, LATER, TZ);
  assert.equal(new Date(end).getTime() % 6e4, 0);
  assert.deepEqual(T.fetchRange(PREFS, LATER + 3 * 36e5, TZ), T.fetchRange(PREFS, LATER, TZ), 'the same range all day');
  const a = Date.parse(start), b = Date.parse(end);
  const [x, y] = await Promise.all([s.page.due(a, b), s.page.due(a + 1234, b - 5678)]);
  assert.equal(x, y);
  assert.equal(count(s.asked, /\/studentItems$/), 1);
  // Settled: a day inside it is answered by it for two minutes from when it was asked.
  const n = s.asked.length;
  assert.equal(await s.page.due(LATER, LATER + DAY), x);
  s.clock.t += 119999;
  assert.equal(await s.page.due(LATER, LATER + DAY), x);
  assert.equal(s.asked.length, n);
  s.clock.t += 1;
  assert.notEqual(await s.page.due(LATER, LATER + DAY), x);
  assert.ok(s.asked.length > n, 'asked again once two minutes have gone');
});

test("planned (agenda, rail): a day inside Better To Do's range reads that range once and keeps it as the To Do copy", async () => {
  const s = site({ answers: ANSWERS(), prefs: PREFS });
  const day = new Date(LATER); day.setHours(0, 0, 0, 0);
  const a = await s.page.planned(+day, +day + DAY, null);
  assert.equal(a.key, `todo:${O}/_900_1`);
  const { start, end } = T.fetchRange(PREFS, LATER, TZ);
  const kept = s.sent.filter((m) => m.type === 'glaze:todo');
  assert.equal(kept.length, 1);
  assert.deepEqual([kept[0].key, kept[0].cache.start, kept[0].cache.end, kept[0].cache.teach, kept[0].cache.progress], [a.key, start, end, PREFS.teacher, PREFS.progress]);
  assert.ok(T.STORE_KEY.test(kept[0].key) && kept[0].cache.items.length === a.items.length && kept[0].cache.at === LATER);
  // Another day inside it, and Better To Do's own read: the same read, kept once.
  await s.page.planned(+day + DAY, +day + 2 * DAY, null);
  await s.page.due(Date.parse(start), Date.parse(end));
  assert.equal(count(s.asked, /\/studentItems$/), 1);
  assert.equal(s.sent.filter((m) => m.type === 'glaze:todo').length, 1);
  // Outside it: that range alone, not kept.
  await s.page.planned(Date.parse(end) + DAY, Date.parse(end) + 2 * DAY, null);
  assert.equal(count(s.asked, /\/studentItems$/), 2);
  assert.equal(s.sent.filter((m) => m.type === 'glaze:todo').length, 1);
});

// ---- who's signed in ---------------------------------------------------------------------------------------------

test('the last student per site is known before anything is asked, and remembered once confirmed', async () => {
  const s = site({ answers: ANSWERS(), local: { [`ultraMe:${O}`]: { uid: '_800_1' } } });
  assert.deepEqual(await s.page.known(), { id: '_800_1', time_zone: TZ });
  assert.equal(s.asked.length, 0);
  assert.equal((await s.page.profile()).id, '_900_1');
  await settle();
  assert.deepEqual(s.store[`ultraMe:${O}`], { uid: '_900_1' }, 'a different student: the record follows');
  assert.equal((await s.page.known()).id, '_900_1');
  assert.equal(count(s.asked, /memberships/), 0, 'who it is needs no course list');
  assert.equal((await site().page.known()), null, 'none yet');
});

test("memberships come once per site: a page confirms the student and keeps the worker's copy; a frame takes it as it is", async () => {
  // A first page: both asked, and handed to the worker.
  const a = site({ answers: ANSWERS() });
  const ma = await a.page.mine();
  assert.equal(ma.mem.length, 4);
  assert.deepEqual([count(a.asked, /users\/me$/), count(a.asked, /memberships/)], [1, 1]);
  assert.equal(a.box.session.uid, '_900_1');
  // The next page in the session: the student confirmed (light), the memberships kept.
  const b = site({ answers: ANSWERS(), session: a.box.session, now: LATER + 60000 });
  const mb = await b.page.mine();
  assert.deepEqual(mb.mem.map((m) => m.courseId), ma.mem.map((m) => m.courseId));
  assert.equal(mb.mem.complete, true);
  assert.deepEqual([count(b.asked, /users\/me$/), count(b.asked, /memberships/)], [1, 0]);
  assert.equal(b.box.session.at, LATER + 60000, 'confirmed by this page');
  // A course tab's frame under it: nothing asked at all.
  const f = site({ answers: ANSWERS(), session: b.box.session, framed: LATER + 1000, now: LATER + 62000 });
  assert.equal((await f.page.mine()).mem.length, 4);
  assert.equal(f.asked.length, 0);
  // A frame whose top page hasn't confirmed the copy confirms it itself.
  const g = site({ answers: ANSWERS(), session: b.box.session, framed: LATER + 61000, now: LATER + 62000 });
  await g.page.mine();
  assert.deepEqual([count(g.asked, /users\/me$/), count(g.asked, /memberships/)], [1, 0]);
});

test('another student, or a copy over ten minutes old, is never taken: the memberships are read again', async () => {
  const other = { uid: '_800_1', mem: load('memberships').results, complete: true, read: LATER, at: LATER };
  const top = site({ answers: ANSWERS(), session: other, now: LATER + 1000 });
  assert.equal((await top.page.mine()).uid, '_900_1');
  assert.equal(count(top.asked, /memberships/), 1);
  assert.equal(top.box.session.uid, '_900_1', 'and the copy is the new student\'s');
  const old = site({ answers: ANSWERS(), session: { ...other, uid: '_900_1' }, now: LATER + 600001 });
  await old.page.mine();
  assert.equal(count(old.asked, /memberships/), 1);
});

// ---- the gradebook -----------------------------------------------------------------------------------------------

test('the gradebook: one request for every reader asking at once, kept a minute, in the one shape Ultra\'s Grades page asks', async () => {
  let holding = true;
  const s = site({ answers: ANSWERS(), hold: (u) => holding && u.pathname.endsWith('/gradebook/grades') });
  const all = Promise.all(Array.from({ length: 6 }, () => s.page.book('_101_1', '_900_1')));
  await settle();
  holding = false;
  s.release();
  const rows = await all;
  assert.ok(rows.every((r) => r === rows[0]) && rows[0].length === 7 && rows[0].complete === true);
  const asks = s.asked.filter((a) => a.path.endsWith('/gradebook/grades'));
  assert.equal(asks.length, 1);
  assert.equal(new URL(asks[0].url).search, '?userId=_900_1&limit=200&includeNoGradeItems=true&expand=column,lastAttempt,submissionStatus');
  s.clock.t += 59999;
  assert.equal(await s.page.book('_101_1', '_900_1'), rows[0]);
  assert.equal(count(s.asked, /gradebook\/grades$/), 1);
  s.clock.t += 2;
  await s.page.book('_101_1', '_900_1');
  assert.equal(count(s.asked, /gradebook\/grades$/), 2, 'asked again after a minute');
  assert.equal(await s.page.book('_101_1', '_900_1', { maxAge: Infinity }), await s.page.book('_101_1', '_900_1'));
  // Another student's is their own.
  await s.page.book('_101_1', '_901_1').catch(() => {});
  assert.equal(count(s.asked, /gradebook\/grades$/), 3);
});

test('the gradebook: a failed read is asked again next time; one caller giving up leaves the read for the others', async () => {
  let fail = true;
  const s = site({ answers: { '/learn/api/v1/courses/_101_1/gradebook/grades': () => (fail ? null : load('grades')) } });
  s.env.fetch = ((f) => async (u, i, p) => { const r = await f(u, i, p); return fail ? { ok: false, status: 503, text: async () => '' } : r; })(s.env.fetch);
  const t = U.makePage(s.env);
  await assert.rejects(t.book('_101_1', '_900_1'), /HTTP 503/);
  fail = false;
  const ac = new AbortController();
  const a = t.book('_101_1', '_900_1', { signal: ac.signal }), b = t.book('_101_1', '_900_1');
  ac.abort();
  await assert.rejects(a, new RegExp(U.STALE));
  assert.equal((await b).length, 7);
});

test('the gradebook is kept on this device for the next page to paint at once (stale-while-revalidate), bounded', async () => {
  const s = site({ answers: ANSWERS() });
  await s.page.book('_101_1', '_900_1');
  const key = `ultraBooks:${O}/_900_1`;
  assert.equal(s.store[key]._101_1.rows.length, 7);
  // A new page: the kept copy at once, before (and whatever) the network says.
  const next = U.makePage({ ...s.env, fetch: () => new Promise(() => {}) });
  const kept = await next.saved('_101_1', '_900_1');
  assert.equal(kept.at, LATER);
  assert.deepEqual(kept.rows.map((r) => r.columnId), load('grades').results.map((r) => r.columnId));
  assert.equal(kept.rows.complete, true);
  assert.equal(await next.saved('_101_1', '_901_1'), null, 'another student has none');
  // Bounded: the newest 30 courses of the last 30 days, about 2 MB.
  const many = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`_${200 + i}_1`, { at: LATER - i * 1000, rows: [], complete: true }]));
  many._999_1 = { at: LATER - 31 * DAY, rows: [], complete: true };
  s.store[key] = many;
  await s.page.book('_102_1', '_900_1');
  const after = Object.keys(s.store[key]);
  assert.equal(after.length, 30);
  assert.ok(after.includes('_102_1') && after.includes('_200_1') && !after.includes('_999_1') && !after.includes('_239_1'));
  s.store[key] = { _300_1: { at: LATER, rows: [{ big: 'x'.repeat(2.1e6) }], complete: true } };
  s.clock.t += 61000;
  await s.page.book('_101_1', '_900_1');
  assert.deepEqual(Object.keys(s.store[key]), ['_101_1'], 'what overflows goes, oldest first');
});

// ---- a course's content ------------------------------------------------------------------------------------------

test("a course's content: one read for everyone asking within five minutes; search's bodies read once and answer the rest", async () => {
  const s = site({ answers: { '/learn/api/public/v1/courses/_101_1/contents': load('contents') } });
  const [a, b] = await Promise.all([s.page.outline('_101_1'), s.page.outline('_101_1', { prio: 1 })]);
  assert.equal(a, b);
  assert.equal(s.asked.length, 1);
  const q = new URL(s.asked[0].url).searchParams;
  assert.deepEqual([q.get('fields'), q.get('recursive'), q.get('limit')], ['id,parentId,title,availability,contentHandler.id,contentHandler.isBbPage,links', 'true', '200']);
  assert.doesNotMatch(q.get('fields'), /contentDetail/);
  await s.page.outline('_101_1', { body: true });
  assert.equal(s.asked.length, 2);
  assert.match(new URL(s.asked[1].url).searchParams.get('fields'), /,body$/);
  await s.page.outline('_101_1');
  assert.equal(s.asked.length, 2, 'a read with bodies answers one without');
  s.clock.t += 300001;
  await s.page.outline('_101_1');
  assert.equal(s.asked.length, 3);
});

// ---- the queue ---------------------------------------------------------------------------------------------------

test("on a page, every read here goes through the site's queue (courses/lmsq.js), at the caller's priority", async () => {
  const had = { location: globalThis.location, GZ_LMSQ: globalThis.GZ_LMSQ };
  const via = [];
  globalThis.location = { origin: O };
  globalThis.GZ_LMSQ = { fetch: async (url, init, prio, live) => { via.push([new URL(url).pathname, prio, typeof live]); return { ok: true, status: 200, text: async () => JSON.stringify(load('contents')) }; } };
  try {
    await U.page.outline('_555_1', { prio: 1 });
    await U.page.book('_555_1', '_900_1').catch(() => {});
    assert.deepEqual(via, [['/learn/api/public/v1/courses/_555_1/contents', 1, 'function'], ['/learn/api/v1/courses/_555_1/gradebook/grades', 0, 'function']]);
  } finally { Object.assign(globalThis, had); if (!had.GZ_LMSQ) delete globalThis.GZ_LMSQ; if (!had.location) delete globalThis.location; }
});

// ---- the readers -------------------------------------------------------------------------------------------------

test("every reader of a course's gradebook on a page asks the store, never its own reader", () => {
  const src = (f) => fs.readFileSync(path.join(__dirname, '../../extension', f), 'utf8');
  for (const f of ['content/content-ultra.js', 'planner/page/grades.js', 'planner/page/insights.js', 'courses/page/rubric.js']) {
    assert.doesNotMatch(src(f), /\.grades\(|gradebook\/grades\?/, f);
    assert.match(src(f), /\.book\(/, f);
  }
  // Agent apps' Insights read, as the view's.
  const tab = src('agents/tab.js'), insights = tab.slice(tab.indexOf('const insights = async'), tab.indexOf('const assignment'));
  assert.match(insights, /GZ_ULTRA\.page\.book\(c\.id, uid, \{ signal: go\.signal, live: go \}\)/);
  assert.doesNotMatch(insights, /\.grades\(/);
  // The planner's per-course reads, on a page: the store's.
  assert.match(src('courses/ultra.js'), /grades: \(cid, uid\) => book\(cid, uid\)/);
});

test("search takes a course's documents from a fresh read with their bodies (a hover's prefetch) instead of asking", async () => {
  const s = site({ answers: { '/learn/api/public/v1/courses/_101_1/contents': load('contents') } });
  assert.equal(s.page.outlineNow('_101_1', { body: true }), null);
  await s.page.outline('_101_1');
  assert.equal(s.page.outlineNow('_101_1', { body: true }), null, 'a read without bodies is no search');
  const o = await s.page.outline('_101_1', { body: true });
  assert.equal(s.page.outlineNow('_101_1', { body: true }), o);
  assert.equal(s.page.outlineNow('_101_1'), o);
  s.clock.t += 300001;
  assert.equal(s.page.outlineNow('_101_1', { body: true }), null);
  const search = fs.readFileSync(path.join(__dirname, '../../extension/navigation/page/search.js'), 'utf8');
  assert.match(search, /U\.page\?\.outlineNow\?\.\(course\.id, \{ body: true \}\)/);
});
