// Google Calendar sync (lib/gcal.js) against a local mock of Google's API (scripts/gcal-mock.js, 127.0.0.1 only): connect,
// create, incremental update, delete, the conflict rule, 401 token refresh, 429 backoff, link another device, disconnect.
// Nothing here reaches Google: every request is checked to go to the mock.
const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../lib/gcal.js');
const M = require('../scripts/gcal-mock.js');

const SRC = 'https://canvas.test/3';
const DAY = 864e5;
const NOW = Date.parse('2026-10-15T14:00:00Z');
const FROM = Date.parse('2026-10-15T04:00:00Z'), FIRST = '2026-10-15';
const due = Date.parse('2026-10-20T03:59:00Z');
const EVENTS = [
  { uid: 'canvas.test/assignment/1@glaze', summary: 'Lab 1', description: 'Biology', url: 'https://canvas.test/courses/7/assignments/1', start: due },
  { uid: 'canvas.test/assignment/2@glaze', summary: 'Holiday', description: 'Biology', start: '2026-10-22', end: '2026-10-23' },
  { uid: 'canvas.test/on/assignment%3A1@glaze', summary: 'Do: Lab 1', start: '2026-10-17', end: '2026-10-18', plan: 'on', key: 'assignment:1' },
  { uid: 'canvas.test/session/assignment%3A1/1@glaze', summary: 'Focus: Lab 1', start: NOW + DAY, end: NOW + DAY + 50 * 6e4, plan: 'session', key: 'assignment:1' },
  { uid: 'x/class/7/2026-10-19/540@glaze', summary: 'BIO 101', location: 'Hall 2', start: Date.parse('2026-10-19T13:00:00Z'), end: Date.parse('2026-10-19T13:50:00Z') },
];

// The worker's env, pointed at the mock: no real waits (each is recorded), and a fetch that refuses anything else.
const env = (mock, more = {}) => {
  const e = { waits: [], dropped: [], sent: [], api: mock.api, revoke: mock.revoke, tok: 'tok-1' };
  Object.assign(e, {
    fetch: (url, init) => {
      assert.ok(url.startsWith(`http://127.0.0.1:${mock.port}/`), `only the mock: ${url}`);
      e.sent.push(init);
      return fetch(url, init);
    },
    sleep: async (ms) => { e.waits.push(ms); },
    token: async () => e.tok,
    drop: async (t) => { e.dropped.push(t); e.tok = e.next || e.tok; },
  }, more);
  return e;
};
const withMock = (name, f) => test(name, async () => {
  const mock = await M.start();
  try { await f(mock); } finally { await mock.stop(); }
});
const run = (e, cal, st, events = EVENTS, more = {}) => G.sync(e, cal, st, { src: SRC, events, from: FROM, first: FIRST }, more);
const writes = (mock) => mock.log.filter(([m]) => m !== 'GET');

withMock('connect makes one calendar named Glaze; the account label is its dataOwner; requests carry no cookies and follow no redirect', async (mock) => {
  const e = env(mock);
  const c = await G.connect(e, 'America/New_York');
  assert.match(c.cal, /@group\.calendar\.google\.com$/);
  assert.equal(c.owner, 'student@example.edu');
  assert.deepEqual([...mock.calendars.values()].map((x) => [x.summary, x.timeZone]), [['Glaze', 'America/New_York']]);
  assert.deepEqual([e.sent[0].credentials, e.sent[0].redirect, e.sent[0].headers.authorization], ['omit', 'error', 'Bearer tok-1']);
});

withMock('create: every event once, with an id from the account and UID; deadlines end at the due time; no reminders; shown as free', async (mock) => {
  const e = env(mock);
  const { cal } = await G.connect(e);
  const st = G.fresh();
  const r = await run(e, cal, st);
  assert.deepEqual(r, { wrote: 5, more: false });
  const live = mock.live(cal);
  assert.equal(live.length, 5);
  assert.ok(live.every((x) => /^[0-9a-f]{64}$/.test(x.id) && x.transparency === 'transparent' && x.reminders.useDefault === false && !x.reminders.overrides));
  const lab = live.find((x) => x.summary === 'Lab 1');
  assert.deepEqual([lab.start.dateTime, lab.end.dateTime], [new Date(due - 30 * 6e4).toISOString(), new Date(due).toISOString()]);
  assert.equal(lab.description, 'Biology\n\nhttps://canvas.test/courses/7/assignments/1');
  assert.deepEqual(live.find((x) => x.summary === 'Holiday').start, { date: '2026-10-22' });
  assert.equal(live.find((x) => x.summary === 'BIO 101').location, 'Hall 2');
  assert.ok(st.sync, 'a cursor for next time');
  assert.equal(Object.keys(st.map).length, 5);
  const plan = Object.values(st.map).find((m) => m.k === 'on');
  assert.deepEqual([plan.i, plan.v], ['assignment:1', '2026-10-17']);
  // Another Canvas account on the same site gets its own events, never the first one's.
  const other = await G.sync(e, cal, st, { src: 'https://canvas.test/4', events: EVENTS.slice(0, 1), from: FROM, first: FIRST });
  assert.equal(other.wrote, 1);
  assert.equal(mock.live(cal).length, 6);
});

withMock('incremental: nothing changed costs one read; one changed item is one update; a removed one is deleted; past ones stay as history', async (mock) => {
  const e = env(mock);
  const { cal } = await G.connect(e);
  const st = G.fresh();
  await run(e, cal, st);
  mock.log.length = 0;
  assert.deepEqual(await run(e, cal, st), { wrote: 0, more: false });
  assert.deepEqual(mock.log.map(([m]) => m), ['GET']);
  assert.match(mock.log[0][1], /syncToken=s\d+/);
  mock.log.length = 0;
  const renamed = EVENTS.map((x) => (x.summary === 'Lab 1' ? { ...x, summary: 'Lab 1 (revised)' } : x));
  assert.equal((await run(e, cal, st, renamed)).wrote, 1);
  assert.deepEqual(writes(mock).map(([m]) => m), ['PUT']);
  assert.ok(mock.live(cal).some((x) => x.summary === 'Lab 1 (revised)'));
  // Our own writes come back in the next listing, and are recognized by their etags: nothing more is written.
  mock.log.length = 0;
  assert.equal((await run(e, cal, st, renamed)).wrote, 0);
  // The holiday gone from Canvas: deleted. A day later the range starts after the class: it's history, left alone.
  mock.log.length = 0;
  const fewer = renamed.filter((x) => x.summary !== 'Holiday');
  assert.equal((await run(e, cal, st, fewer)).wrote, 1);
  assert.deepEqual(writes(mock).map(([m]) => m), ['DELETE']);
  assert.ok(!mock.live(cal).some((x) => x.summary === 'Holiday'));
  const later = Date.parse('2026-10-21T04:00:00Z');
  const r = await G.sync(e, cal, st, { src: SRC, events: [], from: later, first: '2026-10-21' });
  assert.ok(mock.live(cal).some((x) => x.summary === 'BIO 101') && mock.live(cal).some((x) => x.summary === 'Lab 1 (revised)'), 'past events stay');
  assert.equal(r.wrote, 0);
  assert.equal(Object.keys(st.map).length, 0, 'and are forgotten here');
});

withMock('conflict rule: an edited deadline is written over, a deleted one stays deleted; a moved or deleted plan moves or clears the plan here', async (mock) => {
  const e = env(mock);
  const { cal } = await G.connect(e);
  const st = G.fresh();
  await run(e, cal, st);
  const id = (summary) => mock.live(cal).find((x) => x.summary === summary).id;
  const lab = id('Lab 1'), hol = id('Holiday'), on = id('Do: Lab 1'), focus = id('Focus: Lab 1');
  mock.edit(cal, lab, { summary: 'my own title' });
  mock.del(cal, hol);
  mock.edit(cal, on, { start: { date: '2026-10-19' }, end: { date: '2026-10-20' } });
  const moved = NOW + 2 * DAY;
  mock.edit(cal, focus, { start: { dateTime: new Date(moved).toISOString() }, end: { dateTime: new Date(moved + 25 * 6e4).toISOString() } });
  const got = [];
  await run(e, cal, st, EVENTS, { plans: async (x) => { got.push(...x); } });
  assert.equal(mock.calendars.get(cal).events.get(lab).summary, 'Lab 1', 'Canvas wins');
  assert.equal(mock.calendars.get(cal).events.get(hol).status, 'cancelled', 'not recreated');
  assert.ok(st.gone.includes(hol));
  assert.equal(mock.calendars.get(cal).events.get(on).start.date, '2026-10-19', 'the moved plan is left as the student put it');
  assert.deepEqual(got.map((x) => x.edits), [[['on', 'assignment:1', '2026-10-19']], [['dropSession', 'assignment:1', { at: NOW + DAY, min: 50 }], ['addSession', 'assignment:1', { at: moved, min: 25 }]]]);
  // Applied only while the plan here is what Glaze last wrote: a newer change here wins.
  const data = { tasks: [], items: { 'assignment:1': { on: '2026-10-17', sessions: [{ at: NOW + DAY, min: 50 }] } } };
  assert.deepEqual(G.still(data, got), [...got[0].edits, ...got[1].edits]);
  assert.deepEqual(G.still({ tasks: [], items: { 'assignment:1': { on: '2026-10-18' } } }, got), []);
  // Deleting a plan's event clears the plan.
  mock.del(cal, on);
  const gone = [];
  await run(e, cal, st, EVENTS, { plans: async (x) => { gone.push(...x); } });
  assert.deepEqual(gone.map((x) => x.edits), [[['on', 'assignment:1', null]]]);
  // The deleted deadline is still not written, even though the page still has it.
  assert.equal(mock.calendars.get(cal).events.get(hol).status, 'cancelled');
});

withMock('401: Chrome forgets the refused token and the request goes once more with a fresh one; refused again, the run stops as auth', async (mock) => {
  const e = env(mock, { next: 'tok-2' });
  const { cal } = await G.connect(e);
  mock.tokens.clear();
  mock.tokens.add('tok-2');
  const st = G.fresh();
  assert.equal((await run(e, cal, st)).wrote, 5);
  assert.deepEqual(e.dropped, ['tok-1']);
  mock.tokens.clear();
  await assert.rejects(run(e, cal, G.fresh()), (x) => x.code === 'auth');
  // No token at all (Chrome would need to ask): auth, before any request.
  const n = mock.log.length;
  await assert.rejects(run(env(mock, { token: async () => { throw new Error('OAuth2 not granted or revoked.'); } }), cal, G.fresh()), (x) => x.code === 'auth');
  assert.equal(mock.log.length, n);
});

withMock('429 and 5xx: backoff (Retry-After when given), then success; five failures in a row stop the run as busy; other 403s are not retried', async (mock) => {
  const e = env(mock);
  const { cal } = await G.connect(e);
  e.waits.length = 0;
  mock.fail(1, 429, { headers: { 'retry-after': '3' } });
  mock.fail(2, 503);
  const st = G.fresh();
  assert.equal((await run(e, cal, st)).wrote, 5);
  const backoff = e.waits.filter((w) => w !== 150);
  assert.equal(backoff[0], 3000);
  // The same request's second and third tries: 2 s and 4 s, each with up to a second of jitter.
  assert.ok(backoff[1] >= 2000 && backoff[1] <= 3000 && backoff[2] >= 4000 && backoff[2] <= 5000, `exponential with jitter: ${backoff}`);
  assert.ok(e.waits.filter((w) => w === 150).length >= 5, 'requests spaced out');
  mock.fail(1, 403, { reason: 'rateLimitExceeded' });
  assert.equal((await run(e, cal, st, EVENTS.map((x) => ({ ...x, summary: `${x.summary}!` })))).wrote, 5);
  mock.fail(5, 500);
  await assert.rejects(run(e, cal, st), (x) => x.code === 'busy');
  mock.fail(1, 403, { reason: 'forbidden' });
  const n = mock.log.length;
  await assert.rejects(run(e, cal, st), (x) => x.code === 'denied');
  assert.equal(mock.log.length, n + 1);
});

withMock('an expired cursor (410) lists everything again and carries on', async (mock) => {
  const e = env(mock);
  const { cal } = await G.connect(e);
  const st = G.fresh();
  await run(e, cal, st);
  mock.expire();
  mock.log.length = 0;
  assert.equal((await run(e, cal, st)).wrote, 0);
  assert.deepEqual(mock.log.map(([m, p]) => [m, /syncToken/.test(p)]), [['GET', true], ['GET', false]]);
});

withMock('link another device: the code opens the same calendar, and that device\'s events land on the same ones, not duplicates', async (mock) => {
  const a = env(mock);
  const { cal } = await G.connect(a);
  await run(a, cal, G.fresh());
  const b = env(mock);
  assert.equal(G.code(cal.split('@')[0]), cal, 'the short form works too');
  assert.deepEqual(await G.link(b, cal.split('@')[0]), { cal, owner: 'student@example.edu' });
  const st = G.fresh();
  assert.equal((await run(b, cal, st)).wrote, 5);
  assert.equal(mock.live(cal).length, 5, 'no duplicates');
  assert.ok(mock.log.filter(([m]) => m === 'POST').length >= 5 && mock.log.some(([m]) => m === 'PUT'), 'taken ids are updated instead');
  // The first device sees the second's identical copies as its own: nothing to rewrite.
  mock.log.length = 0;
  const first = G.fresh();
  await run(a, cal, first);
  mock.log.length = 0;
  assert.equal((await run(a, cal, first)).wrote, 0);
  await assert.rejects(G.link(b, 'not a code'), (x) => x.code === 'code');
  await assert.rejects(G.link(b, 'c_0000000000@group.calendar.google.com'), (x) => x.code === 'missing');
  mock.foreign('their@group.calendar.google.com');
  await assert.rejects(G.link(b, 'their@group.calendar.google.com'), (x) => x.code === 'denied', 'a calendar Glaze did not make is out of reach');
});

withMock('disconnect: the calendar deleted if asked, and the grant revoked with the token in the body, not the address', async (mock) => {
  const e = env(mock);
  const { cal } = await G.connect(e);
  await run(e, cal, G.fresh());
  await G.remove(e, cal);
  assert.ok(!mock.calendars.has(cal));
  await G.remove(e, cal); // already gone: fine
  assert.equal(await G.revoke(e, 'tok-1'), true);
  assert.deepEqual(mock.revoked, ['tok-1']);
  assert.ok(mock.log.at(-1)[1] === '/revoke', 'no token in the address');
  assert.deepEqual([e.sent.at(-1).body, e.sent.at(-1).credentials, e.sent.at(-1).redirect], ['token=tok-1', 'omit', 'error']);
  assert.equal(await G.revoke(e, 'tok-1'), false, 'an answer that is not ok says so');
});

withMock('a big first fill goes in runs of 150, and says when there is more', async (mock) => {
  const e = env(mock);
  const { cal } = await G.connect(e);
  const many = Array.from({ length: 200 }, (_, i) => ({ uid: `u${i}@glaze`, summary: `Item ${i}`, start: NOW + i * 36e5 }));
  const st = G.fresh();
  assert.deepEqual(await run(e, cal, st, many), { wrote: 150, more: true });
  assert.deepEqual(await run(e, cal, st, many), { wrote: 50, more: false });
  assert.equal(mock.live(cal).length, 200);
});

test('what a page sends is checked: no uid, no times, an end before the start, or a plan on the wrong kind of event', async () => {
  for (const bad of [null, {}, { uid: 'a', start: 'soon' }, { uid: 'a', start: '2026-10-20', end: '2026-10-19' }, { uid: 'a', start: NaN }, { uid: 'x'.repeat(501), start: NOW }]) {
    assert.equal(await G.prep(SRC, bad), null, JSON.stringify(bad));
  }
  const w = await G.prep(SRC, { uid: 'a', start: NOW, end: NOW + 6e5, plan: 'on', key: 'assignment:1', url: 'javascript:alert(1)' });
  assert.deepEqual([w.k, w.i, w.body.description], ['', '', ''], 'a timed event is not a "do on" day; only http(s) links');
  assert.equal((await G.prep(SRC, { uid: 'a', start: NOW })).id, (await G.prep(SRC, { uid: 'a', start: NOW + 1 })).id, 'the id follows the UID');
  assert.notEqual((await G.prep(SRC, { uid: 'a', start: NOW })).id, (await G.prep('https://canvas.test/4', { uid: 'a', start: NOW })).id);
});

test('Google only: the addresses, the one scope, and the manifest\'s client asking for exactly it', () => {
  assert.equal(G.API, 'https://www.googleapis.com/calendar/v3');
  assert.equal(G.REVOKE, 'https://oauth2.googleapis.com/revoke');
  assert.equal(G.SCOPE, 'https://www.googleapis.com/auth/calendar.app.created');
  const m = require('../manifest.json');
  assert.deepEqual(m.oauth2.scopes, [G.SCOPE]);
  assert.match(m.oauth2.client_id, /^\d+-\w+\.apps\.googleusercontent\.com$/);
  assert.deepEqual(m.optional_permissions, ['identity']);
  assert.ok(!m.permissions.includes('identity') && !m.permissions.includes('identity.email') && !('key' in m), 'optional, never identity.email, no dev key');
});

// ---- the worker's side (lib/background.js 'glaze:gcal'), with Chrome's identity API stubbed and Google's addresses
// mapped onto the mock (anything else is refused) ----
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const worker = (mock) => {
  const store = { local: {}, sync: { enabled: true } };
  const area = (s) => ({
    get: async (k) => structuredClone(k == null ? s : Object.fromEntries([].concat(k).filter((x) => x in s).map((x) => [x, s[x]]))),
    set: async (v) => { Object.assign(s, structuredClone(v)); },
    remove: async (k) => { for (const x of [].concat(k)) delete s[x]; },
  });
  const listeners = [], asked = [];
  let registered = [];
  const identity = {
    cleared: 0, removed: [],
    getAuthToken: async ({ interactive }) => { assert.equal(interactive, false, 'the worker never prompts'); return { token: 'tok-1', grantedScopes: [G.SCOPE] }; },
    removeCachedAuthToken: async ({ token }) => { identity.removed.push(token); },
    clearAllCachedAuthTokens: async () => { identity.cleared++; },
  };
  const context = vm.createContext({
    URL, URLSearchParams, console, TextEncoder, TextDecoder, structuredClone, Promise, Date, AbortController, crypto: globalThis.crypto, atob, btoa, navigator: {},
    setTimeout: (f, ms) => setTimeout(f, Math.min(ms, 1)), clearTimeout,
    fetch: (url, init) => {
      asked.push(url);
      assert.ok(url.startsWith(`${G.API}/`) || url === G.REVOKE, `only Google's two addresses: ${url}`);
      return fetch(url.replace(G.API, mock.api).replace(G.REVOKE, mock.revoke), init);
    },
    importScripts: (...files) => { for (const f of files) vm.runInContext(read(`lib/${f}`), context); },
    chrome: {
      runtime: { id: 'glaze', getURL: (f = '') => `chrome-extension://x/${f}`, getManifest: () => require('../manifest.json'), onMessage: { addListener: (f) => listeners.push(f) },
        onInstalled: { addListener() {} }, onStartup: { addListener() {} }, onConnect: { addListener() {} } },
      storage: { local: area(store.local), sync: area(store.sync), onChanged: { addListener() {} } },
      identity,
      tabs: { query: async () => [] },
      scripting: {
        getRegisteredContentScripts: async () => registered,
        registerContentScripts: async (l) => { registered.push(...l); },
        unregisterContentScripts: async ({ ids }) => { registered = registered.filter((s) => !ids.includes(s.id)); },
      },
    },
  });
  vm.runInContext(read('lib/background.js'), context);
  const send = (m, sender) => new Promise((res) => { for (const f of listeners) f(structuredClone(m), sender, (r) => res(structuredClone(r))); });
  return { store, identity, asked, send, registered: () => registered };
};
const EDITOR = { id: 'glaze', url: 'chrome-extension://x/options.html#gcal' };
const PAGE = { id: 'glaze', tab: { id: 4 }, frameId: 0, url: 'https://school.instructure.com/courses/7' };
const SITE_SRC = 'https://school.instructure.com/3';
const settle = (ms = 30) => new Promise((res) => setTimeout(res, ms));

withMock('worker: only the editor connects; a page syncs only its own site\'s account; plans moved in Google reach Better To Do; Glaze off stops it', async (mock) => {
  const w = worker(mock);
  const sync = (more = {}) => w.send({ type: 'glaze:gcal', op: 'sync', src: SITE_SRC, events: EVENTS, from: FROM, first: FIRST, ...more }, PAGE);
  assert.deepEqual(await sync(), { ok: false, error: 'off' }, 'not connected');
  assert.deepEqual(await w.send({ type: 'glaze:gcal', op: 'connect' }, PAGE), { ok: false, error: 'sender' });
  assert.deepEqual(await w.send({ type: 'glaze:gcal', op: 'connect', tz: 'America/New_York' }, EDITOR), { ok: true });
  await settle();
  const cal = w.store.local.gcal.cal;
  assert.ok(mock.calendars.has(cal));
  assert.equal(w.store.local.gcal.owner, 'student@example.edu');
  const reg = structuredClone(w.registered().find((s) => s.id === 'gz-gcal'));
  assert.deepEqual([reg.js, reg.matches, reg.excludeMatches], [['features/gcal.js'], ['https://*.instructure.com/*'], ['https://canvadocs.instructure.com/*']]);
  assert.deepEqual(await w.send({ type: 'glaze:gcal', op: 'connect' }, EDITOR), { ok: false, error: 'connected' }, 'one calendar per connection');
  assert.deepEqual(await sync({ src: 'https://other.instructure.com/3' }), { ok: false, error: 'sender' });
  assert.deepEqual(await sync({ src: SITE_SRC, from: 'soon' }), { ok: false, error: 'sender' });
  assert.deepEqual(await sync(), { ok: true, wrote: 5, more: false });
  assert.equal(mock.live(cal).length, 5);
  assert.ok(w.store.local.gcal.last[SITE_SRC] > 0 && w.store.local.gcal.error === '');
  assert.equal(Object.keys(w.store.local.gcalSync.map).length, 5);
  // The student moves the "do on" day in Google Calendar: Better To Do's plan follows, through the broker.
  const key = `todo:${SITE_SRC}`;
  w.store.local[key] = { tasks: [], items: { 'assignment:1': { on: '2026-10-17' } } };
  const on = mock.live(cal).find((x) => x.summary === 'Do: Lab 1').id;
  mock.edit(cal, on, { start: { date: '2026-10-21' }, end: { date: '2026-10-22' } });
  assert.equal((await sync()).ok, true);
  assert.equal(w.store.local[key].items['assignment:1'].on, '2026-10-21');
  // Glaze turned off: nothing is written.
  w.store.sync.enabled = false;
  assert.deepEqual(await sync(), { ok: false, error: 'off' });
  assert.ok(w.asked.every((u) => u.startsWith('https://www.googleapis.com/') || u.startsWith('https://oauth2.googleapis.com/')));
});

withMock('worker: disconnect deletes the calendar when asked, revokes the grant, clears Chrome\'s tokens and every trace here; a run under way keeps nothing', async (mock) => {
  const w = worker(mock);
  await w.send({ type: 'glaze:gcal', op: 'connect' }, EDITOR);
  const cal = w.store.local.gcal.cal;
  assert.deepEqual(await w.send({ type: 'glaze:gcal', op: 'disconnect', drop: true }, PAGE), { ok: false, error: 'sender' });
  mock.fail(3, 503); // a run in backoff when Disconnect comes
  const running = w.send({ type: 'glaze:gcal', op: 'sync', src: SITE_SRC, events: EVENTS, from: FROM, first: FIRST }, PAGE);
  while (!mock.log.some(([m, p]) => m === 'GET' && p.includes('/events'))) await settle(1);
  const bye = await w.send({ type: 'glaze:gcal', op: 'disconnect', drop: true }, EDITOR);
  assert.deepEqual(await running, { ok: false, error: 'stopped' });
  assert.deepEqual(bye, { ok: true, revoked: true, had: true });
  await settle();
  assert.ok(!mock.calendars.has(cal));
  assert.deepEqual(mock.revoked, ['tok-1']);
  assert.equal(w.identity.cleared, 1);
  assert.ok(!('gcal' in w.store.local) && !('gcalSync' in w.store.local));
  assert.ok(!w.registered().some((s) => s.id === 'gz-gcal'));
  // A calendar that can't be deleted: nothing changes, and the student can try again or keep it.
  mock.tokens.add('tok-1');
  await w.send({ type: 'glaze:gcal', op: 'connect' }, EDITOR);
  mock.fail(5, 500);
  assert.deepEqual(await w.send({ type: 'glaze:gcal', op: 'disconnect', drop: true }, EDITOR), { ok: false, error: 'busy' });
  assert.ok(w.store.local.gcal?.cal && mock.revoked.length === 1);
  assert.deepEqual(await w.send({ type: 'glaze:gcal', op: 'disconnect' }, EDITOR), { ok: true, revoked: true, had: true });
  assert.equal(mock.calendars.size, 1, 'kept, as chosen');
});
