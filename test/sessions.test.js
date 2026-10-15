// S6b's extension adapters/broker against a localhost disk relay only. No account, R2 or deployed host.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const G = require('../lib/sharing.js');
const S = require('../lib/sessions.js');
const R = require('../lib/relay.js');
const N = require('../lib/notes.js');
const T = require('../lib/todo.js');
const { relay, diskStore } = require('../server/relay.js');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const NK = 'notesIdx:https://school.instructure.com/5', TK = 'todo:https://school.instructure.com/5';
const clone = (x) => x === undefined ? x : structuredClone(x);
const localArea = (data = {}) => ({ data, get: async (keys) => Object.fromEntries([].concat(keys ?? Object.keys(data)).filter((k) => k in data).map((k) => [k, clone(data[k])])),
  set: async (patch) => { Object.assign(data, clone(patch)); return true; }, remove: async () => true });
const database = () => {
  const stores = { sessions: new Map(), files: new Map() };
  return { stores, get: async (s, k) => clone(stores[s].get(k)), all: async (s) => [...stores[s].values()].map(clone),
    put: async (s, k, v) => { stores[s].set(k, clone(v)); }, del: async (s, k) => { stores[s].delete(k); } };
};
const notesDB = () => {
  const stores = { bodies: new Map(), files: new Map(), blobs: new Map() };
  return { stores, get: async (s, k) => clone(stores[s].get(k)), put: async (s, k, v) => { stores[s].set(k, clone(v)); },
    del: async (s, ks) => { for (const k of ks) stores[s].delete(k); }, scan: async (s, p) => [...stores[s]].filter(([k]) => k.startsWith(p)),
    keys: async (s, p) => [...stores[s].keys()].filter((k) => k.startsWith(p)), estimate: async () => ({ quota: 1e9, usage: 0 }) };
};
const start = async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-s6b-relay-'));
  let r;
  t.after(async () => { if (r) await r.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const store = diskStore(path.join(dir, 'blobs'));
  r = relay({ db: path.join(dir, 'share.db'), store });
  const address = await r.listen(0, '127.0.0.1');
  return { r, url: `http://127.0.0.1:${address.port}`, files: path.join(dir, 'blobs') };
};
const device = (url, { local = localArea({ [NK]: N.clean({}), [TK]: T.clean({}) }), db = database(), notes = notesDB() } = {}) => {
  let online = true, permission = true;
  const settings = localArea();
  const d = { local, db, notes, settings, online: (v) => { online = v; }, permission: (v) => { permission = v; }, requests: [] };
  d.worker = S.make({ local, sync: settings, db, notes, relay: url, dev: true, permission: async () => permission, offerLook: async (code) => { d.offered = code; return true; },
    fetch: (...args) => { d.requests.push(args[0]); if (!online) throw new Error('offline'); return fetch(...args); }, WebSocket });
  d.send = (op, rest = {}) => d.worker.handle({ op, ...rest });
  d.list = async () => (await d.send('list')).sessions;
  return d;
};
const seed = async (d, text = '<p>hello</p>', file = false) => {
  const id = crypto.randomUUID(), fid = crypto.randomUUID();
  if (file) assert.equal((await N.run({ key: NK, op: 'file', id: fid, note: id, kind: 'file', name: 'private.txt', data: N.b64(new TextEncoder().encode('private bytes')) }, { local: d.local }, d.notes)).ok, true);
  assert.equal((await N.run({ key: NK, op: 'save', id, base: 0, sid: crypto.randomUUID(), copy: crypto.randomUUID(), title: 'Notes', html: text + (file ? `<p><a data-gz-file="${fid}">Attachment</a></p>` : '') }, { local: d.local }, d.notes)).ok, true);
  return id;
};
const create = (d, id, rest = {}) => d.send('create', { kind: 'notes', title: 'Biology', name: 'A', key: NK, ids: [id], ...rest });
const sync = (d, sid) => d.send('sync', { sid });
const session = (d, sid) => d.db.get('sessions', sid);

test('optional switch: list/export/import are offline; permission, key reads and local reads fail closed', async () => {
  const d = device('http://127.0.0.1:1');
  assert.throws(() => S.make({ local: d.local, sync: d.settings, db: d.db, notes: d.notes, relay: 'https://evil.invalid' }), /bad/);
  await d.send('list'); assert.deepEqual((await d.send('exportKeys')).keys, []); assert.equal(d.requests.length, 0);
  const key = G.exportKeys(G.create('collection'));
  await d.send('importKeys', { keys: [key] }); // Restoring another origin is offline and does not grant consent.
  assert.equal(d.requests.length, 0);
  await assert.rejects(d.send('create', { kind: 'notes', title: 'x', key: NK, ids: [crypto.randomUUID()] }), /missing/);
  assert.equal(d.local.data.shareOn, false);
  d.permission(false);
  await assert.rejects(d.send('create', { kind: 'look', title: 'x' }), /permission/);
  assert.equal(d.local.data.shareOn, false);
  const get = d.local.get; d.local.get = async () => { throw new Error('read failed'); };
  await assert.rejects(d.send('list'), /read failed/); d.local.get = get;
  d.db.all = async () => { throw new Error('disk failed'); };
  await assert.rejects(d.send('exportKeys'), /disk failed/);
  assert.equal(d.requests.length, 0);
  d.worker.stop();
});

test('the session database reopens after versionchange closes its cached connection', async () => {
  const original = globalThis.indexedDB, opened = [];
  globalThis.indexedDB = { open: () => {
    const request = {};
    const connection = { closed: false, close() { this.closed = true; }, transaction() {
      if (this.closed) throw new Error('closed database');
      const tx = { objectStore: () => ({ getAll: () => { const r = {}; queueMicrotask(() => { r.result = []; r.onsuccess(); tx.oncomplete(); }); return r; } }) };
      return tx;
    } };
    opened.push(connection); request.result = connection; queueMicrotask(() => request.onsuccess()); return request;
  } };
  try {
    const db = S.database(); await db.all('sessions');
    opened[0].onversionchange();
    assert.deepEqual(await db.all('sessions'), []);
    assert.equal(opened.length, 2);
  } finally { globalThis.indexedDB = original; }
});

test('Pause during a pending consent read cannot let the older Create enable sharing again', async () => {
  let release, entered, requests = 0;
  const gate = new Promise((r) => { release = r; }), ready = new Promise((r) => { entered = r; });
  const local = localArea(), worker = S.make({ local, sync: localArea(), notes: notesDB(), db: database(),
    permission: async () => { entered(); return gate; }, fetch: async () => { requests++; throw new Error('blocked'); } });
  try {
    const creating = worker.handle({ op: 'create', kind: 'look', title: 'Pending' }); await ready;
    await worker.handle({ op: 'pause' }); release(true);
    await assert.rejects(creating, /off/);
    assert.equal(local.data.shareOn, false); assert.equal(requests, 0);
  } finally { release(true); worker.stop(); }
});

test('disk relay: create, read/edit join, local files, offline restart catch-up and explicit file re-upload', async (t) => {
  const { url } = await start(t), a = device(url), b = device(url);
  t.after(() => { a.worker.stop(); b.worker.stop(); });
  const id = await seed(a, '<p>one<script>private()</script></p>', true);
  const { sid } = await create(a, id);
  assert.equal((await a.list())[0].status, 'live');
  const link = (await a.send('link', { sid, edit: true })).link;
  await b.send('join', { link, name: 'B' });
  const before = clone(b.local.data[NK]);
  const view = (await b.send('read', { sid })).view;
  assert.equal(view[id].html.includes('script'), false);
  assert.deepEqual(b.local.data[NK], before, 'joining never overwrites the local notes index');
  await b.send('attach', { sid, key: NK });
  const localId = (await session(b, sid)).bind.map[id];
  assert.notEqual(localId, id);
  const copy = await N.run({ key: NK, op: 'load', id: localId }, { local: b.local }, b.notes);
  assert.match(copy.html, /one/);
  const fid = [...N.refs(copy.html)][0];
  const f = await N.run({ key: NK, op: 'getFile', id: fid }, { local: b.local }, b.notes);
  assert.equal(new TextDecoder().decode(N.unb64(f.data)), 'private bytes');
  a.online(false);
  const n = a.local.data[NK].notes[id];
  await N.run({ key: NK, op: 'save', id, base: n.rev, sid: crypto.randomUUID(), copy: crypto.randomUUID(), html: '<p>offline</p>' }, { local: a.local }, a.notes);
  await sync(a, sid);
  assert.ok((await session(a, sid)).st.pending.length);
  a.worker.stop();
  const reopened = device(url, a); t.after(() => reopened.worker.stop());
  await sync(reopened, sid); await sync(b, sid);
  assert.match((await b.send('read', { sid })).view[id].html, /offline/);
  // A member closed during another edit catches up from persisted state on its next opening.
  const nb = b.local.data[NK].notes[localId];
  await N.run({ key: NK, op: 'save', id: localId, base: nb.rev, sid: crypto.randomUUID(), copy: crypto.randomUUID(), html: '<p>while A closed</p>' }, { local: b.local }, b.notes);
  await sync(b, sid); await sync(reopened, sid);
  assert.match((await reopened.send('read', { sid })).view[id].html, /while A closed/);
  // The retained file remains available even after its note no longer refers to it.
  const keyRecord = (await reopened.send('exportKeys')).keys[0];
  assert.ok(keyRecord.seed && keyRecord.del);
});

test('disk relay: live doorbell catches changes while open and disconnect cancels owned socket/timer', async (t) => {
  const { url } = await start(t), a = device(url), b = device(url);
  t.after(() => { a.worker.stop(); b.worker.stop(); });
  const id = await seed(a), { sid } = await create(a, id);
  await b.send('join', { link: (await a.send('link', { sid })).link });
  const disconnect = b.worker.connect();
  t.after(disconnect);
  await new Promise((resolve) => setTimeout(resolve, 60));
  const n = a.local.data[NK].notes[id];
  await N.run({ key: NK, op: 'save', id, base: n.rev, sid: crypto.randomUUID(), copy: crypto.randomUUID(), html: '<p>live change</p>' }, { local: a.local }, a.notes);
  await sync(a, sid);
  const until = Date.now() + 3000;
  while (!(await b.send('read', { sid })).view[id]?.html.includes('live change') && Date.now() < until) await new Promise((res) => setTimeout(res, 20));
  assert.match((await b.send('read', { sid })).view[id].html, /live change/);
  disconnect(); await b.send('pause');
  const requests = b.requests.length;
  await assert.rejects(sync(b, sid), /off/);
  assert.equal(b.requests.length, requests);
});

test('disk relay: encrypted retained-file re-upload publishes a fresh reference, leave keeps local Notes, delete and one-year expiry', async (t) => {
  const { r, url, files } = await start(t), a = device(url), b = device(url);
  t.after(() => { a.worker.stop(); b.worker.stop(); });
  const id = await seed(a, '<p>with file</p>', true), { sid } = await create(a, id);
  const before = (await a.send('read', { sid })).view;
  const fe = Object.keys(before).find((k) => k.startsWith('f_'));
  // Simulate restored metadata without the fixture's encrypted file store; recovery uses only public client calls.
  fs.rmSync(files, { recursive: true, force: true }); fs.mkdirSync(files, { recursive: true });
  await assert.rejects(G.session((await session(a, sid)).st).get(before[fe].file));
  await a.send('reupload', { sid });
  const after = (await a.send('read', { sid })).view;
  assert.notEqual(after[fe].file.id, before[fe].file.id);
  assert.equal(new TextDecoder().decode(await G.session((await session(a, sid)).st).get(after[fe].file)), 'private bytes');
  // A newer encrypted reference is still untrusted: never label cached old bytes as the new file.
  const record = await session(a, sid), c = G.session(record.st);
  const changed = new TextEncoder().encode('newly shared bytes');
  const ref = await c.put(changed), v = c.view(); v[fe] = { file: { ...ref, n: 'updated.txt', t: 'application/octet-stream' } };
  await c.edit(v); await c.sync(); await a.db.put('sessions', sid, record); await sync(a, sid);
  const cached = await a.db.get('files', `${sid}/${fe}`);
  assert.equal(new TextDecoder().decode(cached.bytes), 'newly shared bytes');
  const current = await N.run({ key: NK, op: 'load', id }, { local: a.local }, a.notes);
  const currentFile = await N.run({ key: NK, op: 'getFile', id: [...N.refs(current.html)][0] }, { local: a.local }, a.notes);
  assert.equal(new TextDecoder().decode(N.unb64(currentFile.data)), 'newly shared bytes');
  const renamed = await session(a, sid), rc = G.session(renamed.st), rv = rc.view();
  rv[fe].file = { ...rv[fe].file, n: 'renamed.txt' };
  await rc.edit(rv); await rc.sync(); await a.db.put('sessions', sid, renamed); await sync(a, sid);
  const renamedNote = await N.run({ key: NK, op: 'load', id }, { local: a.local }, a.notes);
  const renamedId = [...N.refs(renamedNote.html)][0];
  assert.notEqual(renamedId, [...N.refs(current.html)][0], 'changed references receive new immutable local file IDs');
  assert.equal((await N.run({ key: NK, op: 'getFile', id: renamedId }, { local: a.local }, a.notes)).name, 'renamed.txt');
  await b.send('join', { link: (await a.send('link', { sid })).link });
  await b.send('attach', { sid, key: NK });
  assert.equal((await session(b, sid)).bind, null, 'a viewer gets a detached local app copy');
  const copied = clone(b.local.data[NK]);
  await b.send('leave', { sid }); assert.deepEqual(b.local.data[NK], copied);
  assert.deepEqual((await b.send('exportKeys')).keys, []);
  await a.send('expiry', { sid, on: true });
  assert.equal((await a.list())[0].expire, true);
  r.db.prepare('UPDATE sessions SET touched = touched - 366').run(); await r.expire();
  await sync(a, sid); assert.equal((await a.list())[0].status, 'gone');
  const id2 = await seed(a), next = await create(a, id2);
  await a.send('delete', { sid: next.sid });
  assert.equal((await a.list()).find((s) => s.sid === next.sid).status, 'gone');
  assert.ok(a.local.data[NK].notes[id2], 'relay deletion leaves the local note');
});

test('adapters validate every received carrier and remove account/course identifiers from custom tasks', async () => {
  const a = G.ADAPTERS.collection;
  assert.equal(await a.clean('html', '<script>x</script><p onclick="x()">ok</p>'), '<p>ok</p>');
  const task = await a.clean('task', { id: 'x', title: 'task', cid: '22', notes: 'x' });
  assert.equal(task.cid, '');
  assert.equal(await a.clean('task', { id: '../x', title: 'x' }), undefined);
  assert.equal(await a.clean('code', 'javascript:bad'), undefined);
  assert.equal(await a.clean('member', { name: 'a'.repeat(61), at: 1 }), undefined);
  assert.deepEqual(await a.clean('plan', { on: 'bad', subs: [{ id: 'x', title: 'step', done: true }], unrelated: 'secret' }), { subs: [{ id: 'x', title: 'step', done: true }] });
});

test('a changed file reference is validated even when its claimed hash is unchanged', async (t) => {
  const { url } = await start(t), a = device(url);
  t.after(() => a.worker.stop());
  const id = await seed(a, '<p>file</p>', true), { sid } = await create(a, id);
  const record = await session(a, sid), c = G.session(record.st), view = c.view();
  const entity = Object.keys(view).find((k) => view[k].file), original = clone(view[entity].file);
  view[entity].file = { ...original, id: 'A'.repeat(original.id.length) };
  await c.edit(view); await c.sync(); await a.db.put('sessions', sid, record);
  await sync(a, sid);
  assert.equal((await a.list())[0].status, 'offline', 'the changed reference must go through client.get before cached bytes are reused');
  assert.deepEqual((await a.db.get('files', `${sid}/${entity}`)).ref, original);
});

test('disconnect during catch-up does not restart the live connection', async (t) => {
  const { url } = await start(t), a = device(url), b = device(url);
  t.after(() => { a.worker.stop(); b.worker.stop(); });
  const id = await seed(a), { sid } = await create(a, id);
  await b.send('join', { link: (await a.send('link', { sid })).link });
  let release, entered;
  const gate = new Promise((r) => { release = r; }), ready = new Promise((r) => { entered = r; });
  const fetch = globalThis.fetch;
  const worker = S.make({ local: b.local, sync: b.settings, db: b.db, notes: b.notes, relay: url, dev: true, permission: async () => true,
    fetch: async (...args) => { entered(); await gate; return fetch(...args); }, WebSocket });
  t.after(() => { release(); worker.stop(); });
  const close = worker.connect();
  await ready; close(); release();
  await new Promise((r) => setTimeout(r, 40));
  assert.equal((await b.db.get('sessions', sid)).status, 'live', 'an aborted update must not write a stale offline result');
});

test('key-bearing import/export runs only in extension pages; LMS actions route without carrying keys', () => {
  const notes = read('features/notes.js');
  const start = notes.indexOf('  const exportAll =');
  assert.match(notes.slice(start), /glaze:sessions-open/);
  assert.doesNotMatch(notes.slice(start), /exportKeys|importKeys|shareKeys|createObjectURL|GZ_ZIP/);
  assert.doesNotMatch(notes, /accept: '\.zip,application\/zip'/);
  const page = read('sharing/sessions.html');
  assert.match(page, /Includes all share keys and creator delete tokens/);
  assert.ok(!require('../manifest.json').web_accessible_resources.some((e) => e.resources.some((p) => p.startsWith('sharing/'))));
  const ui = read('sharing/sessions.js');
  assert.match(ui, /const human = \(e\) => e\.isTrusted/);
  assert.match(ui, /if \(!human\(e\) \|\| busy \|\| !state\) return;/);
  assert.match(ui, /if \(!e\.isTrusted\) return;/);
  // Required HTTPS access covers the default/custom relay; optional hosts are only for explicit local testing.
  assert.deepEqual(require('../manifest.json').optional_host_permissions, ['http://localhost/*', 'http://127.0.0.1/*']);
  assert.ok(require('../manifest.json').host_permissions.includes('https://*/*'));
});

test('session worker accepts only exact extension pages; an LMS or another extension cannot ask for keys', async () => {
  const listeners = [], imported = [];
  const area = localArea();
  const ctx = vm.createContext({ URL, console, TextEncoder, TextDecoder, structuredClone, Date, setTimeout, clearTimeout, crypto, atob, btoa,
    importScripts: (...files) => { for (const f of files) { imported.push(f); vm.runInContext(read(`lib/${f}`), ctx); } }, navigator: {},
    chrome: { runtime: { id: 'glaze', getURL: (f = '') => `chrome-extension://glaze/${f}`, getManifest: () => require('../manifest.json'),
      onMessage: { addListener: (f) => listeners.push(f) }, onInstalled: { addListener() {} }, onStartup: { addListener() {} }, onConnect: { addListener() {} } },
      storage: { local: area, sync: area, onChanged: { addListener() {} } } } });
  vm.runInContext(read('lib/background.js'), ctx);
  const send = (op, url, id = 'glaze', extra = {}, rest = {}) => new Promise((resolve) => {
    for (const f of listeners) if (f({ type: 'glaze:sessions', op, ...rest }, { id, url, frameId: 0, tab: {}, ...extra }, resolve) === true) return;
  });
  for (const [url, id] of [['https://school.instructure.com/courses/1'], ['chrome-extension://glaze/sharing/sessions.html.evil'], ['chrome-extension://other/sharing/sessions.html'], ['chrome-extension://glaze/sharing/sessions.html', 'other']]) {
    const r = await send('exportKeys', url, id);
    assert.equal(r.error, 'sender');
  }
  for (const op of ['exportKeys', 'relaySave', 'relayTest']) for (const extra of [{ frameId: 2 }, { origin: 'https://school.instructure.com' }]) assert.equal((await send(op, 'chrome-extension://glaze/sharing/sessions.html', 'glaze', extra)).error, 'sender');
  assert.equal((await send('unknown', 'chrome-extension://glaze/sharing/sessions.html')).error, 'sender');
  assert.equal((await send('exportKeys', 'chrome-extension://glaze/sharing/sessions.html', 'glaze', { origin: 'chrome-extension://glaze' }, { payload: 'x'.repeat(33 << 20) })).error, 'sender');
  assert.ok(!imported.includes('sharing.js'), 'refused callers do not even load the crypto dependency');
});

test('Pause interrupts a running sync before waiting for the shared storage queue', async () => {
  const listeners = [], area = localArea();
  let release, entered, stopped = 0, syncs = 0;
  const gate = new Promise((r) => { release = r; }), ready = new Promise((r) => { entered = r; });
  const ctx = vm.createContext({ URL, console, TextEncoder, TextDecoder, structuredClone, Date, setTimeout, clearTimeout, crypto, atob, btoa,
    GZ_SESSIONS: { make: () => ({ handle: async (m) => { if (m.op === 'sync') { syncs++; entered(); await gate; } return { ok: true }; }, stop: () => { stopped++; release(); } }) },
    importScripts: (...files) => { for (const f of files) vm.runInContext(read(`lib/${f}`), ctx); }, navigator: {},
    chrome: { runtime: { id: 'glaze', getURL: (f = '') => `chrome-extension://glaze/${f}`, getManifest: () => require('../manifest.json'),
      onMessage: { addListener: (f) => listeners.push(f) }, onInstalled: { addListener() {} }, onStartup: { addListener() {} }, onConnect: { addListener() {} } },
      storage: { local: area, sync: area, onChanged: { addListener() {} } } } });
  vm.runInContext(read('lib/background.js'), ctx);
  const send = (op) => new Promise((resolve) => { for (const f of listeners) if (f({ type: 'glaze:sessions', op }, { id: 'glaze', url: 'chrome-extension://glaze/sharing/sessions.html', origin: 'chrome-extension://glaze', frameId: 0 }, resolve) === true) return; });
  const pending = send('sync'); await ready;
  const queued = send('sync');
  const queuedHealth = send('relayTest');
  const paused = send('pause');
  try { await new Promise(setImmediate); assert.ok(stopped > 0, 'Pause must abort before its queued mutation can run'); }
  finally { release(); await pending; await paused; }
  assert.equal((await queued).error, 'off', 'an old queued sync cannot restart after Pause');
  assert.equal((await queuedHealth).error, 'off', 'an old queued connection test cannot start after Pause');
  assert.equal(syncs, 1);
});

test('disk relay: custom tasks carry only cleaned task/plan fields; joined Looks never apply themselves', async (t) => {
  const { url } = await start(t), a = device(url), b = device(url);
  t.after(() => { a.worker.stop(); b.worker.stop(); });
  a.local.data[TK] = T.clean({ tasks: [{ id: 'task1', title: 'Write essay', cid: '123', at: Date.now() }], items: { 'task:task1': { on: '2026-10-20', subs: [{ id: 'step', title: 'Outline', done: false }] } } });
  const taskSession = await a.send('create', { kind: 'todo', title: 'Our work', key: TK, ids: ['task1'] });
  const view = (await a.send('read', taskSession)).view;
  assert.equal(view.task1.task.cid, '');
  assert.equal(view.task1.plan.on, '2026-10-20');
  await b.send('join', { link: (await a.send('link', { ...taskSession, edit: true })).link });
  await b.send('attach', { ...taskSession, key: TK });
  assert.equal(b.local.data[TK].tasks[0].title, 'Write essay');
  assert.notEqual(b.local.data[TK].tasks[0].id, 'task1');
  const lookSession = await a.send('create', { kind: 'look', title: 'Study Look' });
  await b.send('join', { link: (await a.send('link', lookSession)).link });
  assert.deepEqual(b.settings.data, {}, 'following never changes the theme');
  await b.send('useLook', lookSession);
  assert.ok(b.offered.startsWith('glaze1:'));
  assert.deepEqual(b.settings.data, {}, 'Use this Look goes through the existing editor preview/apply contract');
});

test('disk relay: two offline bound editors preserve both note bodies and touch only the chosen local account', async (t) => {
  const { url } = await start(t), a = device(url), b = device(url);
  t.after(() => { a.worker.stop(); b.worker.stop(); });
  const other = 'notesIdx:https://school.instructure.com/6';
  b.local.data[other] = N.clean({});
  const untouched = clone(b.local.data[other]);
  const id = await seed(a), { sid } = await create(a, id);
  await b.send('join', { link: (await a.send('link', { sid, edit: true })).link });
  await b.send('attach', { sid, key: NK });
  const copy = (await session(b, sid)).bind.map[id];
  for (const [d, nid, html] of [[a, id, '<p>offline A</p>'], [b, copy, '<p>offline B</p>']]) {
    d.online(false);
    await N.run({ key: NK, op: 'save', id: nid, base: d.local.data[NK].notes[nid].rev, sid: crypto.randomUUID(), copy: crypto.randomUUID(), html }, { local: d.local }, d.notes);
    await sync(d, sid);
  }
  a.online(true); b.online(true);
  await sync(a, sid); await sync(b, sid); await sync(a, sid);
  const bodies = Object.values((await a.send('read', { sid })).view).map((v) => v.html || '').join(' ');
  assert.match(bodies, /offline A/); assert.match(bodies, /offline B/);
  assert.deepEqual(b.local.data[other], untouched);
});

test('disk relay: selected-note sharing stays selected; only an explicit folder share includes new folder notes', async (t) => {
  const { url } = await start(t), a = device(url);
  t.after(() => a.worker.stop());
  const id = await seed(a), { sid } = await create(a, id);
  const folder = (await session(a, sid)).bind.folder;
  const extra = await seed(a, '<p>Unselected private note</p>');
  assert.equal((await N.run({ key: NK, op: 'meta', id: extra, folder, at: Date.now() + 1 }, { local: a.local }, a.notes)).ok, true);
  await sync(a, sid);
  assert.equal((await a.send('read', { sid })).view[extra], undefined, 'a new note in the copy folder was never selected to share');
  const whole = await create(a, id, { folder, ids: [] });
  const next = await seed(a, '<p>Explicit folder member</p>');
  await N.run({ key: NK, op: 'meta', id: next, folder, at: Date.now() + 1 }, { local: a.local }, a.notes);
  await sync(a, whole.sid);
  assert.match((await a.send('read', whole)).view[next].html, /Explicit folder member/);
});

test('E1 relay origins and invites are bounded, canonical and origin-only', () => {
  for (const [input, expected] of [[' https://Relay.Example.edu:443/ ', 'https://relay.example.edu'], ['https://relay.example.edu:8443', 'https://relay.example.edu:8443'], ['http://localhost:8787', 'http://localhost:8787'], ['http://127.0.0.1:8787/', 'http://127.0.0.1:8787']]) assert.equal(R.normalize(input), expected);
  for (const input of [null, {}, 'x', '//relay.example.edu', 'http://relay.example.edu', 'http://localhost.evil', 'http://[::1]', 'file:///tmp/relay', 'https://user:pass@relay.example.edu', 'https://relay.example.edu/path', 'https://relay.example.edu/?q=1', 'https://relay.example.edu/#key', 'https://' + 'a'.repeat(513)]) assert.equal(R.normalize(input), null, String(input));
  for (const server of ['https://relay.example.edu', 'http://127.0.0.1:8787']) {
    const edit = G.link(server, { sid: G.b64(new Uint8Array(16)), seed: new Uint8Array(32) }, true);
    assert.equal(R.invite(edit), server);
    assert.equal(R.invite(edit.replace('/j#', '/prefix/j#')), null);
    assert.equal(R.invite(edit.replace('/j#', '/j?q=1#')), null);
    assert.equal(R.invite(edit + 'x'), null);
  }
});

test('E1 saving a relay is offline and rejects invalid input without changing the preference', async () => {
  const local = localArea(), settings = localArea(), calls = [];
  const worker = S.make({ local, sync: settings, db: database(), notes: notesDB(), permission: async () => { calls.push('permission'); return true; }, fetch: async () => { calls.push('fetch'); throw new Error('must stay offline'); } });
  try {
    await worker.handle({ op: 'relaySave', server: ' https://Relay.Example.edu:443/ ' });
    assert.equal(settings.data.shareRelay, 'https://relay.example.edu');
    assert.equal((await worker.handle({ op: 'list' })).relay, 'https://relay.example.edu');
    await assert.rejects(worker.handle({ op: 'relaySave', server: 'https://user:pass@relay.example.edu/path' }), /bad/);
    assert.equal(settings.data.shareRelay, 'https://relay.example.edu');
    assert.deepEqual(calls, []); assert.equal(local.data.shareOn, undefined); assert.equal(local.data.shareHosts, undefined);
  } finally { worker.stop(); }
});

test('E1 custom Join and imported-key Resume require host confirmation before permission or network', async () => {
  const local = localArea(), db = database(), calls = [], server = 'https://relay.example.edu';
  const key = G.exportKeys(G.create('collection', { server }));
  const link = G.link(server, { sid: key.sid, seed: G.unb64(key.seed) }, true);
  const worker = S.make({ local, sync: localArea(), db, notes: notesDB(), permission: async (s) => { calls.push(['permission', s]); return false; }, fetch: async () => { calls.push(['fetch']); throw new Error('blocked'); } });
  try {
    await assert.rejects(worker.handle({ op: 'join', link }), /confirmation/);
    await assert.rejects(worker.handle({ op: 'join', link, confirmServer: 'https://another.example.edu' }), /confirmation/);
    assert.deepEqual(calls, []); assert.equal((await db.all('sessions')).length, 0);
    await local.set({ shareHosts: [server] });
    await worker.handle({ op: 'relaySave', server });
    await assert.rejects(worker.handle({ op: 'join', link }), /confirmation/, 'a selected, previously approved custom server still needs Join confirmation');
    const defaultKey = G.create('collection');
    const defaultLink = G.link(G.SERVER, { sid: defaultKey.sid, seed: G.unb64(defaultKey.seed) }, true);
    await assert.rejects(worker.handle({ op: 'join', link: defaultLink }), /confirmation/, 'the built-in host also needs confirmation when it differs from the selected relay');
    assert.deepEqual(calls, []);
    await local.set({ shareHosts: [] });
    await worker.handle({ op: 'importKeys', keys: [key] });
    assert.equal(local.data.shareOn, false); assert.deepEqual(calls, []);
    await assert.rejects(worker.handle({ op: 'resume' }), /confirmation/);
    assert.deepEqual(calls, []);
    await assert.rejects(worker.handle({ op: 'resume', confirmServers: [server] }), /permission/);
    assert.deepEqual(calls, [['permission', server]]); assert.equal(local.data.shareOn, false);
    assert.equal((await worker.handle({ op: 'exportKeys' })).keys[0].server, server);
  } finally { worker.stop(); }
});

test('E1 health checks are bounded, explicit, credential-free HTTP with no redirects and no sharing side effects', async () => {
  const local = localArea(), settings = localArea(), requests = [];
  let response = () => new Response('{"ok":true}'), permit = true;
  const worker = S.make({ local, sync: settings, db: database(), notes: notesDB(), healthTimeout: 15,
    permission: async () => permit, fetch: async (url, init) => { requests.push({ url, init }); return response(init); } });
  const checkHealth = () => worker.handle({ op: 'relayTest', server: 'http://127.0.0.1:8787' });
  try {
    assert.equal((await checkHealth()).result, 'connected');
    const request = requests[0];
    assert.equal(request.url, 'http://127.0.0.1:8787/health');
    for (const [key, value] of Object.entries({ method: 'GET', credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', cache: 'no-store' })) assert.equal(request.init[key], value);
    assert.equal(request.init.headers, undefined);
    response = () => new Response('unavailable', { status: 503 });
    assert.deepEqual(await checkHealth(), { ok: true, result: 'http', status: 503 });
    response = () => new Response('{"ok":false}'); assert.equal((await checkHealth()).result, 'invalid');
    response = () => new Response('not json'); assert.equal((await checkHealth()).result, 'invalid');
    response = () => new Response('x'.repeat(1025)); assert.equal((await checkHealth()).result, 'invalid');
    response = () => new Response('{"ok":true}', { headers: { 'content-length': '1025' } }); assert.equal((await checkHealth()).result, 'invalid');
    response = () => { throw new Error('redirect refused'); }; assert.equal((await checkHealth()).result, 'network');
    response = (init) => new Promise((resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
    assert.equal((await checkHealth()).result, 'timeout');
    permit = false; const before = requests.length;
    await assert.rejects(checkHealth(), /permission/); assert.equal(requests.length, before);
    for (const server of [null, 'http://remote.example.edu', 'https://relay.example.edu/path']) await assert.rejects(worker.handle({ op: 'relayTest', server }), /bad/);
    assert.equal(requests.length, before);
    assert.deepEqual(settings.data, {}); assert.equal(local.data.shareOn, undefined); assert.equal(local.data.shareHosts, undefined);
  } finally { worker.stop(); }
});

test('E1 Pause cancels a health check and a queued permission read cannot start it afterward', async () => {
  let permit, enter, requests = 0;
  const ready = new Promise((r) => { enter = r; }), gate = new Promise((r) => { permit = r; });
  const worker = S.make({ local: localArea(), sync: localArea(), db: database(), notes: notesDB(),
    permission: async () => { enter(); return gate; }, fetch: async () => { requests++; return new Response('{"ok":true}'); } });
  try {
    const pending = worker.handle({ op: 'relayTest', server: G.SERVER }); await ready;
    await worker.handle({ op: 'pause' }); permit(true);
    await assert.rejects(pending, /off/); assert.equal(requests, 0);
  } finally { permit(true); worker.stop(); }
  let started;
  const fetching = new Promise((r) => { started = r; });
  const other = S.make({ local: localArea(), sync: localArea(), db: database(), notes: notesDB(), permission: async () => true,
    fetch: async (url, init) => { started(); return new Promise((resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true })); } });
  try {
    const pending = other.handle({ op: 'relayTest', server: G.SERVER }); await fetching;
    await other.handle({ op: 'pause' }); assert.equal((await pending).result, 'cancelled');
  } finally { other.stop(); }
});

test('E1 disk relays: new-session preference never repoints old sessions, keys or grouped live sockets', async (t) => {
  const first = await start(t), second = await start(t), d = device(first.url);
  t.after(() => d.worker.stop());
  const one = await d.send('create', { kind: 'look', title: 'First' });
  assert.equal((await d.send('relayTest', { server: first.url })).result, 'connected');
  const before = d.requests.length;
  await d.send('relaySave', { server: second.url });
  assert.equal(d.requests.length, before);
  const two = await d.send('create', { kind: 'look', title: 'Second', server: second.url });
  assert.equal((await session(d, one.sid)).st.server, first.url);
  assert.equal((await session(d, two.sid)).st.server, second.url);
  await d.send('relaySave', { server: first.url });
  const saved = (await d.send('exportKeys')).keys;
  assert.deepEqual(saved.map((s) => s.server).sort(), [first.url, second.url].sort());
  const sockets = [];
  class Socket { constructor(url) { this.url = url; this.closed = false; sockets.push(this); } close() { this.closed = true; this.onclose?.(); } }
  const restarted = S.make({ local: d.local, sync: d.settings, db: d.db, notes: d.notes, relay: first.url, dev: true, permission: async () => true,
    fetch: (url, init) => { assert.equal(init.credentials, 'omit'); assert.equal(init.redirect, 'error'); return fetch(url, init); }, WebSocket: Socket });
  t.after(() => restarted.stop());
  const close = restarted.connect();
  try {
    for (let n = 0; n < 100 && sockets.length < 2; n++) await new Promise((r) => setTimeout(r, 10));
    assert.deepEqual(sockets.map((s) => s.url).sort(), [first.url, second.url].map((s) => s.replace(/^http/, 'ws') + '/live').sort());
    assert.equal((await session(d, one.sid)).st.server, first.url);
    assert.equal((await session(d, two.sid)).st.server, second.url);
  } finally { close(); }
  assert.ok(sockets.every((s) => s.closed));
  const joined = device(first.url);
  t.after(() => joined.worker.stop());
  const invite = (await d.send('link', { sid: two.sid })).link;
  await assert.rejects(joined.send('join', { link: invite }), /confirmation/);
  assert.equal(joined.requests.length, 0);
  const accepted = await joined.send('join', { link: invite, confirmServer: second.url });
  assert.equal((await session(joined, accepted.sid)).st.server, second.url);
  assert.ok(joined.requests.every((url) => url.startsWith(second.url + '/')));
  const restored = device(first.url);
  t.after(() => restored.worker.stop());
  await restored.send('importKeys', { keys: saved });
  assert.equal(restored.requests.length, 0);
  await assert.rejects(restored.send('resume'), /confirmation/);
  await restored.send('resume', { confirmServers: [second.url] });
  assert.equal((await restored.send('list')).sessions.length, 2);
});
