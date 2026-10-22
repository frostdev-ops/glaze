// The sync loop (lib/sessions.js over lib/sharing.js): what a local save costs with several shares open, which doorbell
// rings start a sync, presence without a batch a minute, unsent edits kept to one copy, one share that fails never
// holding up the others, and a log compacted before the relay's cap. A localhost disk relay only; no live relay.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const G = require('../lib/sharing.js');
const S = require('../lib/sessions.js');
const N = require('../lib/notes.js');
const T = require('../lib/todo.js');
const K = require('../lib/cards.js');
const { relay, diskStore, LIMIT } = require('../server/relay.js');

const NK = 'notesIdx:https://school.instructure.com/5', TK = 'todo:https://school.instructure.com/5';
const clone = (x) => (x === undefined ? x : structuredClone(x));
const localArea = (data = {}) => ({ data, get: async (keys) => Object.fromEntries([].concat(keys ?? Object.keys(data)).filter((k) => k in data).map((k) => [k, clone(data[k])])),
  set: async (patch) => { Object.assign(data, clone(patch)); return true; }, remove: async () => true });
const database = () => {
  const stores = { sessions: new Map(), files: new Map() };
  return { stores, get: async (s, k) => clone(stores[s].get(k)), all: async (s) => [...stores[s].values()].map(clone),
    put: async (s, k, v) => { stores[s].set(k, clone(v)); }, del: async (s, k) => { stores[s].delete(k); } };
};
const notesDB = () => {
  const stores = { bodies: new Map(), files: new Map(), blobs: new Map() };
  return { stores, get: async (s, k) => clone(stores[s].get(k)), put: async (s, k, v) => { stores[s].set(k, clone(v)); }, del: async (s, ks) => { for (const k of ks) stores[s].delete(k); },
    scan: async (s, p) => [...stores[s]].filter(([k]) => k.startsWith(p)), keys: async (s, p) => [...stores[s].keys()].filter((k) => k.startsWith(p)), estimate: async () => ({ quota: 1e9, usage: 0 }) };
};
const start = async (t, opts = {}) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-sync-relay-'));
  let r;
  t.after(async () => { if (r) await r.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  r = relay({ db: path.join(dir, 'share.db'), store: diskStore(path.join(dir, 'blobs')), ...opts });
  const address = await r.listen(0, '127.0.0.1');
  return { r, url: `http://127.0.0.1:${address.port}` };
};
// A device as the worker runs it: one queue for every session operation (lib/background.js's sessionTurn), its relay
// requests noted as "<method> <session>", and its sockets kept to see which open and which this device closes.
const device = (url, { WebSocket: W = WebSocket, now } = {}) => {
  const local = localArea({ [NK]: N.clean({}), [TK]: T.clean({}) }), db = database(), notes = notesDB(), serial = K.queue();
  const d = { local, db, notes, serial, requests: [], sockets: [], online: true };
  class Socket extends W { constructor(...a) { super(...a); d.sockets.push(this); } close() { this.closedHere = true; return super.close(); } }
  d.worker = S.make({ local, sync: localArea(), db, notes, relay: url, dev: true, serial, permission: async () => true, ...(now && { now }), WebSocket: Socket,
    fetch: (u, init) => {
      const p = new URL(u).pathname.split('/');
      d.requests.push(`${init?.method || 'GET'} ${p[2] || ''}${p[3] ? '/' + p[3] : ''}`);
      return d.online ? fetch(u, init) : Promise.reject(new TypeError('offline'));
    } });
  d.send = (op, rest = {}) => serial(() => d.worker.handle({ op, ...rest }));
  d.session = (sid) => db.get('sessions', sid);
  // Rings and queued refreshes land a little after what started them.
  d.settle = async () => { for (let i = 0; i < 3; i++) { await new Promise((r) => setTimeout(r, 60)); await serial(() => {}); } };
  return d;
};
const seed = async (d, html = '<p>hello</p>', title = 'Notes') => {
  const id = crypto.randomUUID();
  assert.equal((await N.run({ key: NK, op: 'save', id, base: 0, sid: crypto.randomUUID(), copy: crypto.randomUUID(), title, html }, { local: d.local }, d.notes)).ok, true);
  return id;
};
const write = async (d, id, html) => {
  const n = d.local.data[NK].notes[id];
  assert.equal((await N.run({ key: NK, op: 'save', id, base: n.rev, sid: crypto.randomUUID(), copy: crypto.randomUUID(), html }, { local: d.local }, d.notes)).ok, true);
};
const body = async (d, id) => (await N.run({ key: NK, op: 'load', id }, { local: d.local }, d.notes)).html;
const share = async (d, id, title = 'Shared') => (await d.send('create', { kind: 'notes', title, name: 'A', key: NK, ids: [id] })).sid;
const until = async (ok, what) => { for (let i = 0; i < 150 && !await ok(); i++) await new Promise((r) => setTimeout(r, 20)); assert.ok(await ok(), what); };
// A stand-in doorbell: it opens at once, and the test rings it.
const bells = () => {
  const made = [];
  class Bell { constructor(url) { this.url = url; made.push(this); setTimeout(() => this.onopen?.(), 0); } send(m) { this.sent = m; } close() { this.closed = true; } }
  return { made, Bell, ring: (m) => made.at(-1).onmessage({ data: JSON.stringify(m) }) };
};

test('a save with five shares open syncs its own share once, and no socket closes or reopens', async (t) => {
  const { url } = await start(t), a = device(url);
  const ids = [], sids = [];
  for (let i = 0; i < 5; i++) { ids.push(await seed(a, `<p>note ${i}</p>`, `Note ${i}`)); sids.push(await share(a, ids[i], `Note ${i}`)); }
  t.after(a.worker.connect()); // a sharing surface is open
  await a.settle();
  assert.equal(a.sockets.length, 1, 'one socket for the relay');
  a.requests.length = 0;
  for (let i = 0; i < 3; i++) {
    await write(a, ids[0], `<p>typing ${i}</p>`);
    a.worker.changed([NK]); // what storage.onChanged does for that Notes key
    await a.settle();
  }
  assert.deepEqual(a.requests, Array(3).fill([`POST ${sids[0]}`, `GET ${sids[0]}`]).flat(), 'each save: its own share sends, then reads its own batch; the other four stay quiet');
  assert.equal(a.sockets.length, 1, 'no socket reopens');
  assert.ok(!a.sockets[0].closedHere, 'no socket closes');
  // A To Do or Look write touches none of these Notes shares.
  a.worker.changed([TK]); a.worker.changed(['look']);
  await a.settle();
  assert.equal(a.requests.length, 6);
});

test('a change another member made, applied here, starts no further sync of any share', async (t) => {
  const { url } = await start(t), a = device(url), b = device(url);
  const id = await seed(a, '<p>first</p>'), sid = await share(a, id), other = await share(a, await seed(a, '<p>other</p>'), 'Other');
  for (const s of [sid, other]) {
    await b.send('join', { link: (await a.send('link', { sid: s, edit: true })).link, name: 'B' });
    await b.send('attach', { sid: s, key: NK });
  }
  t.after(b.worker.connect());
  await b.settle();
  const mine = (await b.session(sid)).bind.map[id];
  b.requests.length = 0;
  await write(a, id, '<p>from A</p>');
  await a.send('sync', { sid });
  // B's doorbell rings: B syncs that share and writes A's change into its own Notes.
  await until(async () => (await body(b, mine)) === '<p>from A</p>', 'B received the change');
  await b.settle();
  assert.deepEqual(b.requests, [`GET ${sid}`]);
  // That write is a storage change like any other; it must not come back as a sync.
  b.worker.changed([NK]);
  await b.settle();
  assert.deepEqual(b.requests, [`GET ${sid}`]);
});

test('the worker names what changed: a Notes or To Do key, or the Look; nothing for other keys', async () => {
  const vm = require('node:vm');
  const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  const changed = [], changes = [], connections = [], area = localArea();
  const ctx = vm.createContext({ URL, console, TextEncoder, TextDecoder, structuredClone, Date, setTimeout, clearTimeout, crypto, atob, btoa, navigator: {},
    GZ_SESSIONS: { make: () => ({ connect: () => () => {}, changed: (keys) => changed.push(keys) }) },
    importScripts: (...files) => { for (const f of files) vm.runInContext(read(`lib/${f}`), ctx); },
    chrome: { runtime: { id: 'glaze', getURL: (f = '') => `chrome-extension://glaze/${f}`, getManifest: () => require('../manifest.json'),
      onMessage: { addListener() {} }, onInstalled: { addListener() {} }, onStartup: { addListener() {} }, onConnect: { addListener: (fn) => connections.push(fn) } },
      storage: { local: area, sync: area, onChanged: { addListener: (fn) => changes.push(fn) } } } });
  vm.runInContext(read('lib/background.js'), ctx);
  for (const connect of connections) connect({ name: 'glaze:sessions', sender: { id: 'glaze', url: 'chrome-extension://glaze/options.html', origin: 'chrome-extension://glaze', frameId: 0 },
    onMessage: { addListener() {} }, onDisconnect: { addListener() {} }, postMessage() {}, disconnect() {} });
  await new Promise(setImmediate);
  const fire = (ch, where) => { for (const fn of changes) fn(Object.fromEntries(Object.keys(ch).map((k) => [k, { newValue: ch[k] }])), where); };
  fire({ [NK]: {}, [TK]: {}, shareName: 'A' }, 'local');
  fire({ colors: {}, lookX: {} }, 'sync');
  fire({ shareName: 'B', courses: {} }, 'local');
  fire({ shareRelay: 'https://relay.example.edu' }, 'sync');
  assert.deepEqual(changed.map((k) => [...k]), [[NK, TK], ['look']]);
});

test('a doorbell at or behind the cursor starts no sync; one past it does', async (t) => {
  const { url } = await start(t), bell = bells(), a = device(url, { WebSocket: bell.Bell });
  const sid = await share(a, await seed(a));
  t.after(a.worker.connect());
  await a.settle();
  assert.equal(bell.made.length, 1);
  assert.deepEqual(JSON.parse(bell.made[0].sent), { sub: [sid] });
  const { cursor } = (await a.session(sid)).st;
  assert.ok(cursor > 0);
  a.requests.length = 0;
  // What the relay answers a subscribe with (the newest batch), and a ring for this device's own batch.
  bell.ring({ s: sid, n: cursor }); bell.ring({ s: sid, n: cursor - 1 });
  await a.settle();
  assert.deepEqual(a.requests, []);
  bell.ring({ s: sid, n: cursor + 1 });
  await a.settle();
  assert.deepEqual(a.requests, [`GET ${sid}`]);
  bell.ring({ s: sid, gone: 1 });
  await a.settle();
  assert.deepEqual(a.requests, [`GET ${sid}`, `GET ${sid}`], 'a deletion always syncs');
});

test('presence goes with a change, or alone only every few minutes', async (t) => {
  let clock = Date.now();
  const { url } = await start(t), a = device(url, { now: () => clock });
  const id = await seed(a), sid = await share(a, id);
  const seen = async () => G.view((await a.session(sid)).st)[`_m_${(await a.session(sid)).st.actor}`].member.at;
  const made = await seen();
  a.requests.length = 0;
  clock += 2 * 60e3;
  await a.send('sync', { sid });
  assert.deepEqual(a.requests, [`GET ${sid}`], 'two minutes on, nothing to send: no presence batch');
  assert.equal(await seen(), made);
  clock += 10e3;
  await write(a, id, '<p>an edit</p>');
  await a.send('sync', { sid });
  assert.deepEqual(a.requests.slice(1), [`POST ${sid}`, `GET ${sid}`], 'the edit and the presence go in one batch');
  assert.equal(await seen(), clock);
  const edited = clock;
  clock += 6 * 60e3;
  a.requests.length = 0;
  await a.send('sync', { sid });
  assert.deepEqual(a.requests, [`POST ${sid}`, `GET ${sid}`], 'six minutes on, presence goes alone');
  assert.ok(await seen() > edited);
});

test('editing offline keeps one unsent copy per note, so the share syncs again once back online', async (t) => {
  const state = S.LIMIT.state;
  S.LIMIT.state = 300000; // scaled from 16 MiB, as the audit did: 16 MiB is about 280 offline saves of a 60 KB note
  t.after(() => { S.LIMIT.state = state; });
  const { r, url } = await start(t), a = device(url);
  let html = `<p>${'Lecture notes. '.repeat(1300)}</p>`; // about 20 KB
  const id = await seed(a, html), sid = await share(a, id);
  const head = () => r.db.prepare('SELECT head FROM sessions WHERE sid = ?').get(sid).head;
  const before = head();
  a.online = false;
  for (let i = 0; i < 30; i++) {
    html += `<p>${i}</p>`;
    await write(a, id, html);
    assert.equal((await a.send('sync', { sid })).ok, true, `offline save ${i}`);
  }
  const kept = await a.session(sid);
  assert.ok(JSON.stringify(kept).length < S.LIMIT.state / 2, `${JSON.stringify(kept).length} bytes kept`);
  assert.equal(kept.st.pending.flat().filter((o) => o.e === id && o.f === 'html').length, 1, 'one copy of the note waits');
  assert.equal((await a.send('list')).sessions[0].status, 'pending');
  a.online = true;
  await a.send('sync', { sid });
  assert.equal((await a.send('list')).sessions[0].status, 'live');
  assert.equal(head(), before + 1, 'thirty offline saves arrive as one batch');
  const b = device(url);
  await b.send('join', { link: (await a.send('link', { sid })).link });
  assert.equal((await b.send('read', { sid })).view[id].html, html);
});

test('a share too big to keep says so, and the shares after it still sync, connect and refresh', async (t) => {
  const state = S.LIMIT.state;
  S.LIMIT.state = 300000;
  t.after(() => { S.LIMIT.state = state; });
  const { url } = await start(t), bell = bells(), a = device(url), b = device(url, { WebSocket: bell.Bell });
  const big = await share(a, await seed(a, '<p>x</p>', 'Big'), 'Big'), id = await seed(a, '<p>y</p>', 'Other'), other = await share(a, id, 'Other');
  for (const s of [big, other]) await b.send('join', { link: (await a.send('link', { sid: s, edit: true })).link, name: 'B' });
  // Another edit-link holder adds a 400 KB note: past this device's (scaled) cap for one share.
  const evil = G.session(G.join((await a.send('link', { sid: big, edit: true })).link, true));
  await evil.sync();
  await evil.edit({ ...evil.view(), [crypto.randomUUID()]: { title: 'pad', html: `<p>${'z'.repeat(400000)}</p>` } });
  await evil.sync();
  await write(a, id, '<p>news for B</p>');
  await a.send('sync', { sid: other });
  const cursor = (await b.session(other)).st.cursor;
  assert.equal((await b.send('sync', { sid: big })).ok, true, 'a sync that cannot keep what it got still ends');
  assert.equal((await b.send('list')).sessions.find((s) => s.sid === big).status, 'big');
  // A surface opens: every share is synced in turn, then the sockets open and the next refresh is set.
  b.requests.length = 0;
  t.after(b.worker.connect());
  await b.settle();
  assert.ok(b.requests.includes(`GET ${other}`), 'the share after the big one is synced');
  assert.ok((await b.session(other)).st.cursor > cursor);
  assert.equal(bell.made.length, 1, 'the doorbell opens');
  const list = (await b.send('list')).sessions;
  assert.equal(list.find((s) => s.sid === big).status, 'big');
  assert.equal(list.find((s) => s.sid === other).status, 'live');
});

test('the log is compacted once it runs LIMIT.compact batches past its trim', async (t) => {
  const compact = G.LIMIT.compact;
  G.LIMIT.compact = 4; // scaled from 200
  t.after(() => { G.LIMIT.compact = compact; });
  const { r, url } = await start(t), a = device(url);
  const id = await seed(a, '<p>v0</p>'), sid = await share(a, id);
  const row = () => r.db.prepare('SELECT head, base FROM sessions WHERE sid = ?').get(sid);
  const ops = () => r.db.prepare('SELECT count(*) AS c FROM ops WHERE sid = ?').get(sid).c;
  for (let i = 1; i <= 10; i++) { await write(a, id, `<p>v${i}</p>`); await a.send('sync', { sid }); }
  assert.ok(row().base > 0, `trimmed at ${row().base} of ${row().head}`);
  assert.ok(ops() <= G.LIMIT.compact + 2, `${ops()} batches kept`);
  assert.equal((await a.send('list')).sessions[0].status, 'live');
  const b = device(url);
  await b.send('join', { link: (await a.send('link', { sid })).link });
  assert.equal((await b.send('read', { sid })).view[id].html, '<p>v10</p>', 'a new member reads the state, not the history');
});

test('a full log (507) is compacted, and the share keeps syncing', async (t) => {
  const { r, url } = await start(t, { limit: { ...LIMIT, session: 64 << 10 } }), a = device(url);
  const text = (i) => `<p>${String(i % 10).repeat(12000)}</p>`; // each save seals to about 12 KB: five fit in 64 KiB
  const id = await seed(a, text(0)), sid = await share(a, id);
  const b = device(url);
  await b.send('join', { link: (await a.send('link', { sid })).link });
  for (let i = 1; i <= 12; i++) {
    await write(a, id, text(i));
    await a.send('sync', { sid });
    assert.equal((await a.send('list')).sessions[0].status, 'live', `save ${i}`);
  }
  assert.ok(r.db.prepare('SELECT base FROM sessions WHERE sid = ?').get(sid).base > 0);
  // A member who read nothing since joining catches up from the state sent past the trim.
  await b.send('sync', { sid });
  assert.equal((await b.send('read', { sid })).view[id].html, text(12));
});

for (const failure of ['snapshot send', 'trim reply']) test(`an interrupted ${failure} retries compaction after the pending copy exceeds the local cap`, async (t) => {
  const state = S.LIMIT.state, compact = G.LIMIT.compact;
  t.after(() => { S.LIMIT.state = state; G.LIMIT.compact = compact; });
  const { url } = await start(t, { limit: { ...LIMIT, session: 26000 } }), a = device(url);
  const id = await seed(a, `<p>${'x'.repeat(16000)}</p>`), sid = await share(a, id);
  // Unbind this editor: a received state can exceed half the local cap while still fitting as one stored copy.
  const rec = await a.session(sid); rec.bind = null;
  await a.db.put('sessions', sid, rec);
  const b = device(url);
  await b.send('join', { link: (await a.send('link', { sid })).link });
  S.LIMIT.state = JSON.stringify(rec).length + 2000;
  G.LIMIT.compact = 1;
  const realFetch = globalThis.fetch;
  let trimmed = false, failed = false;
  globalThis.fetch = async (u, init) => {
    if (failure === 'snapshot send' && trimmed && !failed && init?.method === 'POST' && !new URL(u).pathname.endsWith('/trim')) {
      failed = true; throw new TypeError('snapshot send interrupted');
    }
    const out = await realFetch(u, init);
    if (new URL(u).pathname.endsWith('/trim') && out.ok) {
      trimmed = true;
      if (failure === 'trim reply' && !failed) { failed = true; throw new TypeError('trim reply lost'); }
    }
    return out;
  };
  try { await a.send('sync', { sid }); } finally { globalThis.fetch = realFetch; }
  assert.ok(trimmed && failed, 'trim committed before the snapshot send failed');
  await a.send('sync', { sid });
  const late = device(url);
  await late.send('join', { link: (await a.send('link', { sid })).link });
  assert.equal((await late.send('read', { sid })).view[id]?.html?.length, 16007, 'the persisted retry restores the whole snapshot');
});
