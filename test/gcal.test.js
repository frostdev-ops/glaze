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
const run = (e, cal, st, events = EVENTS, more = {}) => G.sync(e, cal, st, { src: SRC, events, from: FROM, first: FIRST, whole: true }, more);
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
  const other = await G.sync(e, cal, st, { src: 'https://canvas.test/4', events: EVENTS.slice(0, 1), from: FROM, first: FIRST, whole: true });
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
  const r = await G.sync(e, cal, st, { src: SRC, events: [], from: later, first: '2026-10-21', whole: true });
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
  await run(e, cal, st, EVENTS, { plans: async (x) => { got.push(...x); return true; } });
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
  await run(e, cal, st, EVENTS, { plans: async (x) => { gone.push(...x); return true; } });
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
// on: the build-time switch (lib/gcal.js ON) turned on in the worker's copy, as scripts/dev-gcal.sh does.
const switched = (src, on) => (on ? src.replace('  const ON = false;\n', '  const ON = true;\n') : src);
// failSet(patch): a storage write that fails, as a full disk or a quota does. identity.hold: what getAuthToken waits on.
const worker = (mock, { on = true, local = {}, sync = { enabled: true }, failSet = () => false } = {}) => {
  const store = { local, sync };
  // As chrome.storage: a read is served when it's asked (hooks.read runs after that, while the answer is on its way, as a
  // change landing then would), and every change is heard through onChanged.
  const heard = [], hooks = {};
  const fire = (name, c) => { for (const f of heard) f(c, name); };
  const area = (name, s) => ({
    get: async (k) => {
      const v = structuredClone(k == null ? s : Object.fromEntries([].concat(k).filter((x) => x in s).map((x) => [x, s[x]])));
      await hooks.read?.(name, [].concat(k ?? []));
      return v;
    },
    set: async (v) => {
      if (failSet(v)) throw new Error('QUOTA_BYTES quota exceeded');
      const c = Object.fromEntries(Object.keys(v).map((k) => [k, { oldValue: s[k], newValue: structuredClone(v[k]) }]));
      Object.assign(s, structuredClone(v));
      fire(name, c);
    },
    remove: async (k) => { const c = {}; for (const x of [].concat(k)) { c[x] = { oldValue: s[x] }; delete s[x]; } fire(name, c); },
  });
  const listeners = [], asked = [];
  let registered = [];
  const identity = {
    cleared: 0, removed: [],
    asked: 0, hold: null,
    getAuthToken: async ({ interactive }) => {
      assert.equal(interactive, false, 'the worker never prompts');
      identity.asked++;
      await identity.hold;
      return { token: 'tok-1', grantedScopes: [G.SCOPE] };
    },
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
    importScripts: (...files) => { for (const f of files) vm.runInContext(switched(read(`lib/${f}`), on && f === 'gcal.js'), context); },
    chrome: {
      runtime: { id: 'glaze', getURL: (f = '') => `chrome-extension://x/${f}`, getManifest: () => require('../manifest.json'), onMessage: { addListener: (f) => listeners.push(f) },
        onInstalled: { addListener: (f) => listeners.installed = f }, onStartup: { addListener() {} }, onConnect: { addListener() {} } },
      storage: { local: area('local', store.local), sync: area('sync', store.sync), onChanged: { addListener: (f) => heard.push(f) } },
      identity,
      tabs: { query: async () => [] },
      scripting: {
        getRegisteredContentScripts: async () => registered,
        registerContentScripts: async (l) => { registered.push(...l); },
        unregisterContentScripts: async ({ ids } = {}) => { registered = ids ? registered.filter((s) => !ids.includes(s.id)) : []; },
      },
    },
  });
  vm.runInContext(read('lib/background.js'), context);
  const send = (m, sender) => new Promise((res) => { for (const f of listeners) f(structuredClone(m), sender, (r) => res(structuredClone(r))); });
  // change(): a change made elsewhere (the popup, the editor), heard as Chrome tells it.
  const change = (name, patch) => { const c = Object.fromEntries(Object.keys(patch).map((k) => [k, { oldValue: store[name][k], newValue: patch[k] }])); Object.assign(store[name], patch); fire(name, c); };
  return { store, identity, asked, send, hooks, change, registered: () => registered, install: () => listeners.installed() };
};
// What the page sends with its batch (lib/calexport.js consent), worked out from the worker's storage as it is now.
const D = require('../defaults.js');
const T = require('../lib/todo.js');
const X = require('../lib/calexport.js');
const consentOf = (w, who = SITE_SRC) => { const z = D.GZ_SANITIZE(w.store.sync); return X.consent(z, z.todo, w.store.local.gradescope, who); };
const EDITOR = { id: 'glaze', url: 'chrome-extension://x/options.html#gcal' };
const PAGE = { id: 'glaze', tab: { id: 4 }, frameId: 0, url: 'https://school.instructure.com/courses/7' };
const SITE_SRC = 'https://school.instructure.com/3';
const settle = (ms = 30) => new Promise((res) => setTimeout(res, ms));

withMock('worker: only the editor connects; a page syncs only its own site\'s account; plans moved in Google reach Better To Do; Glaze off stops it', async (mock) => {
  const w = worker(mock);
  const sync = (more = {}) => w.send({ type: 'glaze:gcal', op: 'sync', src: SITE_SRC, events: EVENTS, from: FROM, first: FIRST, whole: true, consent: consentOf(w), ...more }, PAGE);
  assert.deepEqual(await sync(), { ok: false, error: 'off' }, 'not connected');
  assert.deepEqual(await sync({ whole: undefined }), { ok: false, error: 'sender' }, 'a batch that doesn\'t say whether it was read whole is refused');
  assert.deepEqual(await w.send({ type: 'glaze:gcal', op: 'connect' }, PAGE), { ok: false, error: 'sender' });
  assert.deepEqual(await w.send({ type: 'glaze:gcal', op: 'connect', tz: 'America/New_York' }, EDITOR), { ok: true });
  await settle();
  const cal = w.store.local.gcal.cal;
  assert.ok(mock.calendars.has(cal));
  assert.equal(w.store.local.gcal.owner, 'student@example.edu');
  const reg = structuredClone(w.registered().find((s) => s.id === 'gz-gcal'));
  assert.deepEqual([reg.js, reg.matches, reg.excludeMatches], [['features/gcal.js'], ['https://*.instructure.com/*', 'https://*/ultra', 'https://*/ultra/*'], ['https://canvadocs.instructure.com/*']]);
  assert.deepEqual(await w.send({ type: 'glaze:gcal', op: 'connect' }, EDITOR), { ok: false, error: 'connected' }, 'one calendar per connection');
  assert.deepEqual(await sync({ src: 'https://other.instructure.com/3' }), { ok: false, error: 'sender' });
  assert.deepEqual(await sync({ src: SITE_SRC, from: 'soon' }), { ok: false, error: 'sender' });
  // The plans the page's events carry are the ones Better To Do holds (a page's plan that isn't there any more is skipped).
  const key = `todo:${SITE_SRC}`;
  w.store.local[key] = { tasks: [], items: { 'assignment:1': { on: '2026-10-17', sessions: [{ at: NOW + DAY, min: 50 }] } } };
  assert.deepEqual(await sync(), { ok: true, wrote: 5, more: false });
  assert.equal(mock.live(cal).length, 5);
  assert.ok(w.store.local.gcal.last[SITE_SRC] > 0 && w.store.local.gcal.error === '');
  assert.equal(Object.keys(w.store.local.gcalSync.map).length, 5);
  // The student moves the "do on" day in Google Calendar: Better To Do's plan follows, through the broker.
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
  const running = w.send({ type: 'glaze:gcal', op: 'sync', src: SITE_SRC, events: EVENTS, from: FROM, first: FIRST, whole: true, consent: consentOf(w) }, PAGE);
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

// ---- the build-time switch (lib/gcal.js ON): off in the repo and the store package until Google verifies the app ----
test('switch off (the repo as it is): no settings section, no sync, no page script, even with a connection left from a dev build', async () => {
  assert.equal(G.ON, false, 'lib/gcal.js ON stays false until Google verifies the app (DECISIONS.md, W13)');
  // The section is hidden in the page itself, and only the switch shows it; the editor loads the switch.
  assert.match(read('options.html'), /<div class="group" id="gcal" hidden>/);
  assert.match(read('options.html'), /<script src="lib\/gcal\.js"><\/script>[\s\S]*<script src="options\.js"><\/script>/);
  const js = read('options.js');
  const gate = js.indexOf('if (GZ_GCAL.ON) {');
  assert.ok(gate > 0 && js.indexOf("$('#gcal').hidden = false") > gate && js.indexOf("type: 'glaze:gcal'") > gate, 'everything for it sits behind the switch');
  assert.ok(!/gcal|Google Calendar/i.test(read('features/palette.js')), 'no palette entry');
  const mock = await M.start();
  try {
    const w = worker(mock, { on: false, local: { gcal: { gen: 'g', cal: 'c_1@group.calendar.google.com', last: {} }, canvas: [] } });
    for (const [m, sender] of [[{ op: 'connect' }, EDITOR], [{ op: 'disconnect' }, EDITOR], [{ op: 'sync', src: SITE_SRC, events: EVENTS, from: FROM, first: FIRST, whole: true }, PAGE]]) {
      assert.deepEqual(await w.send({ type: 'glaze:gcal', ...m }, sender), { ok: false, error: 'off' }, m.op);
    }
    w.install();
    await settle();
    assert.ok(!w.registered().some((s) => s.id === 'gz-gcal'), 'features/gcal.js never registered');
    const on = worker(mock, { local: { gcal: { gen: 'g', cal: 'c_1@group.calendar.google.com', last: {} }, canvas: [] } });
    on.install();
    await settle();
    assert.ok(on.registered().some((s) => s.id === 'gz-gcal'), 'and with the switch on, the same install registers it');
    assert.deepEqual([w.asked, mock.log], [[], []], 'no request at all');
  } finally { await mock.stop(); }
});

test('the store package leaves Google sync out while the switch is off; scripts/dev-gcal.sh turns it on in its copy only', () => {
  const { execFileSync } = require('node:child_process');
  const os = require('node:os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-gcal-pkg-'));
  try {
    const keyFile = path.join(dir, 'key.txt');
    fs.writeFileSync(keyFile, require('node:crypto').randomBytes(294).toString('base64'));
    const env = { ...process.env, DIST: path.join(dir, 'dist') };
    execFileSync(path.join(__dirname, '../scripts/dev-gcal.sh'), [keyFile, path.join(dir, 'dev')], { env, stdio: 'pipe' });
    const repo = require('../manifest.json');
    const zip = path.join(dir, 'dist', `glaze-v${repo.version}.zip`);
    const packed = JSON.parse(execFileSync('unzip', ['-p', zip, 'manifest.json']));
    const { oauth2, optional_permissions: _, ...rest } = repo;
    assert.deepEqual(packed, rest, 'the store manifest: the same, without oauth2 and the optional identity permission');
    assert.match(execFileSync('unzip', ['-p', zip, 'lib/gcal.js']).toString(), /\n {2}const ON = false;\n/);
    const dev = JSON.parse(fs.readFileSync(path.join(dir, 'dev/manifest.json')));
    assert.deepEqual([dev.oauth2, dev.optional_permissions, dev.key], [oauth2, ['identity'], fs.readFileSync(keyFile, 'utf8')]);
    assert.match(fs.readFileSync(path.join(dir, 'dev/lib/gcal.js'), 'utf8'), /\n {2}const ON = true;\n/);
    assert.equal(G.ON, false, "the repo's switch is untouched");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ---- review (Codex, W13): each failed before its fix ----
const eventWrites = (mock) => mock.log.filter(([m, p]) => m !== 'GET' && p.includes('/events'));
const holdToken = (w) => { let open; w.identity.hold = new Promise((r) => { open = r; }); return () => { w.identity.hold = null; open(); }; };
const until = async (f) => { for (let i = 0; i < 500 && !f(); i++) await settle(2); assert.ok(f(), 'timed out'); };

withMock('review: a plan deleted in Google stays deleted, in the same run and from a page that read the plan before', async (mock) => {
  const e = env(mock);
  const { cal } = await G.connect(e);
  const st = G.fresh();
  const data = T.clean({ tasks: [], items: { 'assignment:1': { on: '2026-10-17', sessions: [{ at: NOW + DAY, min: 50 }] } } });
  const opts = { plans: async (x) => { for (const ed of G.still(data, x)) T.edit(data, ed); return true; }, mine: async () => T.clean(data) };
  await run(e, cal, st, EVENTS, opts);
  const id = (summary) => mock.live(cal).find((x) => x.summary === summary).id;
  const on = id('Do: Lab 1'), focus = id('Focus: Lab 1');
  mock.del(cal, on);
  mock.del(cal, focus);
  // EVENTS still has both plans: what a page read before the deletion came back.
  await run(e, cal, st, EVENTS, opts);
  assert.deepEqual(T.clean(data).items, {}, 'the plans are cleared here');
  await run(e, cal, st, EVENTS, opts);
  assert.deepEqual([mock.calendars.get(cal).events.get(on).status, mock.calendars.get(cal).events.get(focus).status], ['cancelled', 'cancelled'], 'and not recreated');
  // Planned again here, it goes back.
  T.edit(data, ['on', 'assignment:1', '2026-10-17']);
  await run(e, cal, st, EVENTS, opts);
  assert.equal(mock.calendars.get(cal).events.get(on).status, 'confirmed');
});

withMock('review: Glaze turned off while the token is awaited: the run stops and writes nothing', async (mock) => {
  const w = worker(mock);
  await w.send({ type: 'glaze:gcal', op: 'connect' }, EDITOR);
  const open = holdToken(w);
  const n = w.identity.asked;
  const running = w.send({ type: 'glaze:gcal', op: 'sync', src: SITE_SRC, events: EVENTS, from: FROM, first: FIRST, whole: true, consent: consentOf(w) }, PAGE);
  await until(() => w.identity.asked > n);
  w.store.sync.enabled = false;
  open();
  assert.deepEqual(await running, { ok: false, error: 'stopped' });
  assert.deepEqual(eventWrites(mock), []);
  assert.ok(!mock.log.some(([, p]) => p.includes('/events')), 'not even a read');
  assert.ok(!w.store.local.gcal.last[SITE_SRC], 'nor its own state');
});

withMock('review: syncs in flight and queued when Disconnect comes stop before it revokes, and nothing is written after', async (mock) => {
  const w = worker(mock);
  await w.send({ type: 'glaze:gcal', op: 'connect' }, EDITOR);
  const cal = w.store.local.gcal.cal;
  const open = holdToken(w);
  const n = w.identity.asked;
  const sync = () => w.send({ type: 'glaze:gcal', op: 'sync', src: SITE_SRC, events: EVENTS, from: FROM, first: FIRST, whole: true, consent: consentOf(w) }, PAGE);
  const a = sync();
  await until(() => w.identity.asked > n);
  const b = sync();
  await settle();
  const bye = w.send({ type: 'glaze:gcal', op: 'disconnect' }, EDITOR);
  open();
  assert.deepEqual([await a, await b], [{ ok: false, error: 'stopped' }, { ok: false, error: 'stopped' }]);
  assert.deepEqual(await bye, { ok: true, revoked: true, had: true });
  assert.deepEqual(eventWrites(mock), []);
  assert.equal(mock.live(cal).length, 0);
  assert.ok(!('gcal' in w.store.local) && !('gcalSync' in w.store.local));
});

withMock('review: a plan change that can\'t be written here isn\'t taken as done: the next run tries again, and Google keeps the move', async (mock) => {
  const key = `todo:${SITE_SRC}`;
  let full = false;
  const w = worker(mock, { local: { [key]: { tasks: [], items: { 'assignment:1': { on: '2026-10-17' } } } }, failSet: (v) => full && key in v });
  await w.send({ type: 'glaze:gcal', op: 'connect' }, EDITOR);
  const cal = w.store.local.gcal.cal;
  const sync = () => w.send({ type: 'glaze:gcal', op: 'sync', src: SITE_SRC, events: EVENTS, from: FROM, first: FIRST, whole: true, consent: consentOf(w) }, PAGE);
  assert.equal((await sync()).ok, true);
  const on = mock.live(cal).find((x) => x.summary === 'Do: Lab 1').id;
  mock.edit(cal, on, { start: { date: '2026-10-21' }, end: { date: '2026-10-22' } });
  const cursor = w.store.local.gcalSync.sync;
  full = true;
  assert.deepEqual(await sync(), { ok: false, error: 'local' });
  assert.equal(w.store.local[key].items['assignment:1'].on, '2026-10-17');
  assert.equal(w.store.local.gcalSync.sync, cursor, 'the cursor stays where it was');
  assert.equal(mock.calendars.get(cal).events.get(on).start.date, '2026-10-21');
  full = false;
  assert.equal((await sync()).ok, true);
  assert.equal(w.store.local[key].items['assignment:1'].on, '2026-10-21', 'the move lands here on the next run');
  assert.equal(mock.calendars.get(cal).events.get(on).start.date, '2026-10-21', 'and is never written over from here');
});

// The page's own compose (features/calexport.js, as features/gcal.js calls it), reading the same storage as the worker.
const composer = (store) => {
  const get = (area) => (keys, cb) => { const all = structuredClone(store[area]); cb(keys === null ? all : Object.fromEntries([keys].flat().filter((k) => k in all).map((k) => [k, all[k]]))); };
  const planner = [{ plannable_type: 'assignment', plannable_id: '1', course_id: '7', context_name: 'Biology', plannable: { title: 'Lab 1' }, plannable_date: '2026-10-20T03:59:00Z', html_url: '/courses/7/assignments/1' }];
  const c = vm.createContext({
    TextEncoder, URL, Date: class extends Date { constructor(...a) { super(...(a.length ? a : [NOW])); } static now() { return NOW; } },
    location: { origin: 'https://school.instructure.com', host: 'school.instructure.com' },
    chrome: { runtime: {}, storage: { sync: { get: get('sync') }, local: { get: get('local') } } },
    fetch: async (url) => ({ ok: true, headers: { get: () => null }, text: async () => JSON.stringify(url.includes('start_date=2026-10-15') ? planner : []) }),
    GZ_CTX: { t: (k, v = {}) => k.replace(/\{(\w+)\}/g, (_, x) => v[x]), need: async () => {}, settings: () => D.GZ_SANITIZE(store.sync),
      profile: async () => ({ id: '3', time_zone: 'America/New_York' }), canvasCourses: async () => [{ id: '7', name: 'Biology' }] },
  });
  vm.runInContext('globalThis.globalThis = this; Date.UTC = Object.getPrototypeOf(Date).UTC; Date.parse = Object.getPrototypeOf(Date).parse;', c);
  for (const f of ['lib/color.js', 'lib/fonts.js', 'defaults.js', 'lib/todo.js', 'lib/ics.js', 'lib/calexport.js', 'lib/gradescope.js', 'lib/classes.js', 'features/calexport.js']) vm.runInContext(read(f), c);
  return () => c.GZ_CAL_UI.compose(null, () => true);
};

withMock('review (P1): the Gradescope answer taken back while the token is awaited: the batch composed under it is never sent', async (mock) => {
  const ACCT = 'a'.repeat(24);
  const gradescope = {
    acct: { id: ACCT, name: 'Sam' }, map: { 11: { to: 'canvas:https://school.instructure.com/7', name: 'BIO' } },
    courses: { 11: { at: NOW, bad: 0, rows: [{ id: '55', title: 'HW 3', due: Date.parse('2026-10-20T03:59:00Z'), late: null, sub: false, graded: false, score: null, points: 10, lateSub: false }] } },
    bind: { [SITE_SRC]: { id: ACCT, show: true } },
  };
  const w = worker(mock, { local: { gradescope }, sync: { version: 2, enabled: true, enhance: { gradescope: true } } });
  await w.send({ type: 'glaze:gcal', op: 'connect' }, EDITOR);
  const cal = w.store.local.gcal.cal;
  const compose = composer(w.store);
  const send = (c) => w.send({ type: 'glaze:gcal', op: 'sync', src: SITE_SRC, events: c.events, from: c.from, first: c.first, whole: true, consent: c.consent }, PAGE);
  const c = await compose();
  assert.ok(c.events.some((e) => e.summary === 'HW 3') && await c.recheck(), 'composed and rechecked while the answer was yes');
  const open = holdToken(w);
  const n = w.identity.asked;
  const running = send(c);
  await until(() => w.identity.asked > n);
  w.store.local.gradescope.bind[SITE_SRC].show = false; // "Not here", as lib/gradescope.js keeps it
  open();
  assert.deepEqual(await running, { ok: false, error: 'stopped' });
  assert.deepEqual(eventWrites(mock), [], 'neither HW 3 nor anything else from that batch');
  // The page's next batch is composed without it, and goes.
  const next = await compose();
  assert.ok(!next.events.some((e) => e.summary === 'HW 3'));
  assert.equal((await send(next)).ok, true);
  assert.deepEqual(mock.live(cal).map((e) => e.summary), ['Lab 1']);
});

// Blackboard Ultra pages are a source too (B2): the page composes from Ultra's due items (lib/ultra.js page.due, as
// content-ultra.js gives them: links whole, on the site), and the worker takes the batch only from an Ultra page of that
// account's own site.
const ULTRA = 'https://bb.example.edu', ULTRA_SRC = `${ULTRA}/_900_1`;
const ultraComposer = (store) => {
  const get = (area) => (keys, cb) => { const all = structuredClone(store[area]); cb(keys === null ? all : Object.fromEntries([keys].flat().filter((k) => k in all).map((k) => [k, all[k]]))); };
  const items = [{ type: 'assignment', id: '_603_1', cid: '_101_1', course: 'Biology', title: 'Lab 1', at: Date.parse('2026-10-20T03:59:00Z'), allDay: false, sub: null, ov: null,
    url: `${ULTRA}/ultra/redirect?redirectType=nautilus&courseId=_101_1&contentId=_1003_1` }];
  const asked = [];
  const c = vm.createContext({
    TextEncoder, URL, Date: class extends Date { constructor(...a) { super(...(a.length ? a : [NOW])); } static now() { return NOW; } },
    location: { origin: ULTRA, host: 'bb.example.edu' },
    chrome: { runtime: {}, storage: { sync: { get: get('sync') }, local: { get: get('local') } } },
    fetch: async () => { throw new Error('an Ultra page asks lib/ultra.js, never Canvas'); },
    GZ_ULTRA: { page: { due: async (from, to) => { asked.push([from, to]); return { items: items.filter((i) => i.at >= from && i.at < to), complete: true }; } } },
    GZ_CTX: { site: 'ultra', t: (k, v = {}) => k.replace(/\{(\w+)\}/g, (_, x) => v[x]), need: async () => {}, settings: () => D.GZ_SANITIZE(store.sync),
      profile: async () => ({ id: '_900_1', time_zone: 'America/New_York' }), canvasCourses: async () => [{ id: '_101_1', name: 'Biology' }] },
  });
  vm.runInContext('globalThis.globalThis = this; Date.UTC = Object.getPrototypeOf(Date).UTC; Date.parse = Object.getPrototypeOf(Date).parse;', c);
  for (const f of ['lib/color.js', 'lib/fonts.js', 'defaults.js', 'lib/todo.js', 'lib/ics.js', 'lib/calexport.js', 'lib/gradescope.js', 'lib/classes.js', 'features/calexport.js']) vm.runInContext(read(f), c);
  return { compose: () => c.GZ_CAL_UI.compose(null, () => true), asked };
};

withMock('Ultra pages sync too: the page composes from Ultra\'s due items, and the worker takes it from an Ultra page of that account\'s site only', async (mock) => {
  const w = worker(mock);
  await w.send({ type: 'glaze:gcal', op: 'connect' }, EDITOR);
  const cal = w.store.local.gcal.cal;
  const { compose, asked } = ultraComposer(w.store);
  const c = await compose();
  assert.ok(asked.length > 0);
  assert.deepEqual(JSON.parse(JSON.stringify(c.events.map((e) => [e.summary, e.url]))), [['Lab 1', `${ULTRA}/ultra/redirect?redirectType=nautilus&courseId=_101_1&contentId=_1003_1`]]);
  const page = { id: 'glaze', tab: { id: 5 }, frameId: 0, url: `${ULTRA}/ultra/course` };
  const send = (src, sender) => w.send({ type: 'glaze:gcal', op: 'sync', src, events: c.events, from: c.from, first: c.first, whole: true, consent: consentOf(w, src) }, sender);
  assert.deepEqual(await send(ULTRA_SRC, page), { ok: false, error: 'sender' }, 'a host Glaze has not found Ultra on');
  w.store.local.ultra = [ULTRA]; // as the worker keeps it once content-ultra.js says Glaze found Ultra there
  assert.deepEqual(await send('https://other.example.edu/_900_1', page), { ok: false, error: 'sender' }, "another site's account");
  assert.deepEqual(await send(ULTRA_SRC, { ...page, url: 'http://bb.example.edu/ultra/course' }), { ok: false, error: 'sender' }, 'not over https');
  assert.deepEqual(await send(ULTRA_SRC, { ...page, url: `${ULTRA}/webapps/login/` }), { ok: false, error: 'sender' }, 'not an Ultra page');
  assert.equal((await send(ULTRA_SRC, page)).ok, true);
  assert.deepEqual(mock.live(cal).map((e) => e.summary), ['Lab 1']);
  assert.ok(w.store.local.gcal.last[ULTRA_SRC] > 0);
  // The page side runs there too, by the site's part and its _N_N account (features/gcal.js).
  assert.match(read('features/gcal.js'), /ctx\.site !== 'canvas' && ctx\.site !== 'ultra'/);
});

// ---- Codex's fix verification (W13): a change while a guard's own read is on its way. Each failed before its fix. ----
withMock('review (P1, late await): Glaze turned off while the last read before an event POST is on its way: nothing is posted', async (mock) => {
  // The read right before the first POST: counted on a run with nothing changed, then the change lands during it.
  const lastRead = async (flip) => {
    const w = worker(mock);
    await w.send({ type: 'glaze:gcal', op: 'connect' }, EDITOR);
    const cal = w.store.local.gcal.cal;
    const from = mock.log.length;
    const posted = () => mock.log.slice(from).some(([m, p]) => m === 'POST' && p.includes('/events'));
    const listed = () => mock.log.slice(from).some(([m, p]) => m === 'GET' && p.includes('/events'));
    let n = 0;
    w.hooks.read = async (name, keys) => {
      if (name !== 'local' || !keys.includes('gcal') || !listed() || posted()) return;
      if (++n === flip) w.change('sync', { enabled: false });
    };
    const r = await w.send({ type: 'glaze:gcal', op: 'sync', src: SITE_SRC, events: EVENTS.slice(0, 1), from: FROM, first: FIRST, whole: true, consent: consentOf(w) }, PAGE);
    return { r, n, live: mock.live(cal).map((e) => e.summary), enabled: w.store.sync.enabled };
  };
  const dry = await lastRead(0);
  assert.deepEqual([dry.r.ok, dry.live], [true, ['Lab 1']], 'nothing changed: Lab 1 goes');
  assert.ok(dry.n >= 1);
  const got = await lastRead(dry.n);
  assert.deepEqual(got, { r: { ok: false, error: 'stopped' }, n: dry.n, live: [], enabled: false });
});

withMock('review (P1, late await): Glaze turned off while the broker reads Better To Do: the plan moved in Google is not applied', async (mock) => {
  const key = `todo:${SITE_SRC}`;
  const w = worker(mock, { local: { [key]: { tasks: [], items: { 'assignment:1': { on: '2026-10-17' } } } } });
  await w.send({ type: 'glaze:gcal', op: 'connect' }, EDITOR);
  const cal = w.store.local.gcal.cal;
  const sync = () => w.send({ type: 'glaze:gcal', op: 'sync', src: SITE_SRC, events: EVENTS, from: FROM, first: FIRST, whole: true, consent: consentOf(w) }, PAGE);
  assert.equal((await sync()).ok, true);
  const on = mock.live(cal).find((x) => x.summary === 'Do: Lab 1').id;
  mock.edit(cal, on, { start: { date: '2026-10-21' }, end: { date: '2026-10-22' } });
  let armed = true;
  w.hooks.read = async (name, keys) => { if (armed && name === 'local' && keys.includes(key)) { armed = false; w.change('sync', { enabled: false }); } };
  const r = await sync();
  assert.equal(armed, false, 'the change landed during that read');
  assert.deepEqual({ r, enabled: w.store.sync.enabled, localOn: w.store.local[key].items['assignment:1'].on }, { r: { ok: false, error: 'stopped' }, enabled: false, localOn: '2026-10-17' });
  assert.equal(mock.calendars.get(cal).events.get(on).start.date, '2026-10-21', 'and Google keeps the move for when Glaze is back on');
});

// Codex B2 (finding 4): a batch the page couldn't read whole (Ultra's calendar cut short: whole: false) is no proof that
// what's missing from it is gone. Its future events stay; a whole batch later deletes them as before.
withMock('review (B2): a partial batch deletes nothing for being missing from it; a whole one does', async (mock) => {
  const e = env(mock);
  const { cal } = await G.connect(e);
  const st = G.fresh();
  await run(e, cal, st);
  assert.equal(mock.live(cal).length, 5);
  const some = EVENTS.slice(0, 1);
  await G.sync(e, cal, st, { src: SRC, events: some, from: FROM, first: FIRST, whole: false });
  assert.equal(mock.live(cal).length, 5, 'nothing deleted after a partial read');
  assert.ok(!mock.log.some(([m]) => m === 'DELETE'));
  await G.sync(e, cal, st, { src: SRC, events: some, from: FROM, first: FIRST, whole: true });
  assert.deepEqual(mock.live(cal).map((x) => x.summary), ['Lab 1']);
});

test('review (B2): the page tells the worker whether its batch was read whole, and the worker accepts only a yes or no', async () => {
  const sent = [];
  const run1 = (whole) => new Promise((done) => {
    const c = vm.createContext({
      window: {}, setTimeout: (f) => { if (sent.length) return; setTimeout(f, 0); }, clearTimeout,
      location: { origin: 'https://bb.example.edu' }, Date,
      chrome: {
        storage: { local: { get: async () => ({ gcal: { cal: 'c_1@group.calendar.google.com', last: {} } }) }, onChanged: { addListener() {} } },
        runtime: { sendMessage: async (m) => { sent.push(m); done(); return { ok: true }; } },
      },
      GZ_CTX: { site: 'ultra', on: () => true, settings: () => ({ enabled: true }), profile: async () => ({ id: '_900_1' }), need: async () => {} },
      GZ_CAL_UI: { compose: async () => ({ events: [], from: FROM, first: FIRST, consent: '[]', recheck: async () => true, ...(whole !== undefined && { whole }) }) },
    });
    c.window.top = c.window;
    c.globalThis = c;
    vm.runInContext(read('features/gcal.js'), c);
  });
  await run1(false);
  await run1(true);
  await run1(undefined); // a Canvas page's compose has no whole: its reads are whole
  assert.deepEqual(sent.map((m) => [m.src, m.whole]), [['https://bb.example.edu/_900_1', false], ['https://bb.example.edu/_900_1', true], ['https://bb.example.edu/_900_1', true]]);
  assert.match(read('lib/background.js'), /typeof m\.whole !== 'boolean'\) return \{ ok: false, error: 'sender' \}/); // an omitted flag is refused, never taken as whole
});

withMock('review (B2 residual): a batch that doesn\'t say it was read whole deletes nothing for being missing', async (mock) => {
  const e = env(mock);
  const { cal } = await G.connect(e);
  const st = G.fresh();
  await run(e, cal, st);
  assert.equal(mock.live(cal).length, 5);
  await G.sync(e, cal, st, { src: SRC, events: EVENTS.slice(0, 1), from: FROM, first: FIRST });
  assert.equal(mock.live(cal).length, 5, 'no flag: nothing deleted');
  assert.ok(!mock.log.some(([m]) => m === 'DELETE'));
});
