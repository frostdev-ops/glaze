// S6b's extension adapters/broker against a localhost disk relay only. No account, R2 or deployed host.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const G = require('../lib/sharing.js');
const S = require('../lib/sessions.js');
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
  return { r, url: `http://127.0.0.1:${address.port}` };
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
  await d.send('list'); assert.deepEqual((await d.send('exportKeys')).keys, []); assert.equal(d.requests.length, 0);
  const key = G.exportKeys(G.create('collection'));
  await d.send('importKeys', { keys: [key] }).catch(() => {}); // another origin is refused even for a backup
  assert.equal(d.requests.length, 0);
  await assert.rejects(d.send('create', { kind: 'notes', title: 'x', key: NK, ids: [crypto.randomUUID()] }), /missing/);
  assert.equal(d.local.data.shareOn, undefined);
  d.permission(false);
  await assert.rejects(d.send('create', { kind: 'look', title: 'x' }), /permission/);
  assert.equal(d.local.data.shareOn, undefined);
  const get = d.local.get; d.local.get = async () => { throw new Error('read failed'); };
  await assert.rejects(d.send('list'), /read failed/); d.local.get = get;
  d.db.all = async () => { throw new Error('disk failed'); };
  await assert.rejects(d.send('exportKeys'), /disk failed/);
  assert.equal(d.requests.length, 0);
  d.worker.stop();
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
  const { r, url } = await start(t), a = device(url), b = device(url);
  t.after(() => { a.worker.stop(); b.worker.stop(); });
  const id = await seed(a, '<p>with file</p>', true), { sid } = await create(a, id);
  const before = (await a.send('read', { sid })).view;
  const fe = Object.keys(before).find((k) => k.startsWith('f_'));
  await a.send('reupload', { sid });
  const after = (await a.send('read', { sid })).view;
  assert.notEqual(after[fe].file.id, before[fe].file.id);
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
  assert.match(ui, /if \(!human\(e\) \|\| busy\) return;[\s\S]*?const p = permission\(\)/);
  assert.match(ui, /if \(!e\.isTrusted\) return;/);
  assert.deepEqual(require('../manifest.json').optional_host_permissions, ['https://share.frostdev.io/*']);
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
  const send = (op, url, id = 'glaze') => new Promise((resolve) => {
    for (const f of listeners) if (f({ type: 'glaze:sessions', op }, { id, url, frameId: 0, tab: {} }, resolve) === true) return;
  });
  for (const [url, id] of [['https://school.instructure.com/courses/1'], ['chrome-extension://glaze/sharing/sessions.html.evil'], ['chrome-extension://other/sharing/sessions.html'], ['chrome-extension://glaze/sharing/sessions.html', 'other']]) {
    const r = await send('exportKeys', url, id);
    assert.equal(r.error, 'sender');
  }
  assert.ok(!imported.includes('sharing.js'), 'refused callers do not even load the crypto dependency');
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
