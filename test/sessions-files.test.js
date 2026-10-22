// WP-S3: the session worker's entity maps, its files and its file cache. A localhost disk relay only; no live relay.
//  - SHR-9: an entity named like an Object.prototype member never breaks sync, here or in a share saved that way before.
//  - SHR-12: a file the merged state stopped pointing to goes off the relay once the batch that dropped it is in.
//  - SHR-7: a file keeps its time while bytes move; a slow or failing file never holds up the text, either way.
//  - SHR-14: the file cache keeps a running total; listing shares reads only the Notes and To Do keys.
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
const { relay, diskStore } = require('../server/relay.js');

const NK = 'notesIdx:https://school.instructure.com/5', TK = 'todo:https://school.instructure.com/5';
const clone = (x) => (x === undefined ? x : structuredClone(x));
const localArea = (data = {}) => ({ data, reads: [], get(keys) { this.reads.push(keys); return Promise.resolve(Object.fromEntries([].concat(keys ?? Object.keys(data)).filter((k) => k in data).map((k) => [k, clone(data[k])]))); },
  set: async (patch) => { Object.assign(data, clone(patch)); return true; }, remove: async (keys) => { for (const k of [].concat(keys)) delete data[k]; return true; } });
const database = () => {
  const stores = { sessions: new Map(), files: new Map() }, d = { stores, all_: [] };
  return Object.assign(d, { get: async (s, k) => clone(stores[s].get(k)), all: async (s) => { d.all_.push(s); return [...stores[s].values()].map(clone); },
    put: async (s, k, v) => { stores[s].set(k, clone(v)); }, del: async (s, k) => { stores[s].delete(k); } });
};
const notesDB = () => {
  const stores = { bodies: new Map(), files: new Map(), blobs: new Map() };
  return { stores, get: async (s, k) => clone(stores[s].get(k)), put: async (s, k, v) => { stores[s].set(k, clone(v)); }, del: async (s, ks) => { for (const k of ks) stores[s].delete(k); },
    scan: async (s, p) => [...stores[s]].filter(([k]) => k.startsWith(p)), keys: async (s, p) => [...stores[s].keys()].filter((k) => k.startsWith(p)), estimate: async () => ({ quota: 1e9, usage: 0 }) };
};
const start = async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-files-relay-'));
  let r;
  t.after(async () => { if (r) await r.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  r = relay({ db: path.join(dir, 'share.db'), store: diskStore(path.join(dir, 'blobs')) });
  const address = await r.listen(0, '127.0.0.1');
  return { r, url: `http://127.0.0.1:${address.port}` };
};
const sleep = (ms, signal) => new Promise((resolve, reject) => {
  const timer = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new DOMException('The operation was aborted.', 'AbortError')); }, { once: true });
});
// A request nobody answers, until the caller gives up on it.
const stall = (init) => new Promise((resolve, reject) => init.signal.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')), { once: true }));
// An answer whose body arrives in `parts` pieces, `gap` ms apart: slow, but never silent for long.
const trickle = async (res, signal, parts = 5, gap = 150) => {
  const bytes = new Uint8Array(await res.arrayBuffer()), size = Math.ceil(bytes.length / parts);
  let at = 0;
  return new Response(new ReadableStream({
    async pull(c) {
      if (at >= bytes.length) return c.close();
      try { await sleep(gap, signal); } catch (e) { c.error(e); return; }
      c.enqueue(bytes.subarray(at, at += size));
    },
  }), { status: res.status, headers: { 'content-length': String(bytes.length) } });
};
// One request's time (the library reads it when a session is made), for the length of the test.
const patience = (t, ms) => { const was = G.LIMIT.timeout; G.LIMIT.timeout = ms; t.after(() => { G.LIMIT.timeout = was; }); };
// A device as the worker runs it. `hook(url, init)` may answer a request itself; what it leaves is sent to the relay.
const device = (url, { getKeys } = {}) => {
  const local = localArea({ [NK]: N.clean({}), [TK]: T.clean({}) }), db = database(), notes = notesDB(), serial = K.queue();
  if (getKeys) local.getKeys = async () => Object.keys(local.data);
  const d = { local, db, notes, serial, requests: [], hook: null };
  d.worker = S.make({ local, sync: localArea(), db, notes, relay: url, dev: true, serial, permission: async () => true, WebSocket,
    fetch: async (u, init) => {
      const p = new URL(u).pathname.split('/');
      d.requests.push({ method: init?.method || 'GET', file: p[3] === 'b' ? p[4] : null, op: p[3] === undefined && init?.method === 'POST' });
      return (await d.hook?.(u, init)) || fetch(u, init);
    } });
  d.send = (op, rest = {}) => serial(() => d.worker.handle({ op, ...rest }));
  d.session = (sid) => db.get('sessions', sid);
  d.status = async (sid) => { const r = await d.session(sid); return [r.status, r.error]; };
  return d;
};
const uuid = () => crypto.randomUUID();
const bytes = (text, n = 0) => { const b = new Uint8Array(Math.max(n, text.length)); b.set(new TextEncoder().encode(text)); return b; };
const attach = async (d, id, name, data) => {
  const fid = uuid();
  assert.equal((await N.run({ key: NK, op: 'file', id: fid, note: id, kind: 'file', name, data: N.b64(data) }, { local: d.local }, d.notes)).ok, true);
  return fid;
};
const link = (fid, name = 'file') => `<p><a data-gz-file="${fid}">${name}</a></p>`;
const note = async (d, html, id = uuid()) => {
  assert.equal((await N.run({ key: NK, op: 'save', id, base: 0, sid: uuid(), copy: uuid(), title: 'Notes', html }, { local: d.local }, d.notes)).ok, true);
  return id;
};
const write = async (d, id, html) => {
  const n = d.local.data[NK].notes[id];
  assert.equal((await N.run({ key: NK, op: 'save', id, base: n.rev, sid: uuid(), copy: uuid(), html }, { local: d.local }, d.notes)).ok, true);
};
const body = async (d, id) => (await N.run({ key: NK, op: 'load', id }, { local: d.local }, d.notes)).html;
const share = async (d, ids, title = 'Shared') => (await d.send('create', { kind: 'notes', title, name: 'A', key: NK, ids })).sid;
const refs = async (d, sid) => Object.fromEntries(Object.entries((await d.send('read', { sid })).view).filter(([e, v]) => e.startsWith('f_') && v.file).map(([e, v]) => [e, v.file.id]));
const onRelay = async (url, sid, id) => (await fetch(`${url}/s/${sid}/b/${id}`)).status;
const T0 = () => Date.now().toString(36).padStart(9, '0') + '000aaaaaaaa';
// What a client that skips this library's own checks would send: a sealed batch, straight to the log.
const forge = async (url, text, ops, y = 'collection') => {
  const st = G.join(text, true), k = await G.keys({ sid: G.unb64(st.sid), seed: G.unb64(st.seed) });
  const { head } = await (await fetch(`${url}/s/${st.sid}?after=0`)).json();
  const sealed = await G.seal(k, 'op', { y, o: ops }, String(head + 1), 1); // the staged relay advertises no v2
  const res = await fetch(`${url}/s/${st.sid}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ n: head + 1, ...sealed }) });
  assert.equal(res.ok, true, `the forged batch was taken (${res.status})`);
};

// ---- SHR-9 ----------------------------------------------------------------------------------------------------------
const PROTO = ['toString', 'valueOf', 'hasOwnProperty', 'constructor', 'isPrototypeOf', '__defineGetter__', '__proto__'];
test('syllabus-generated tasks remain shareable and survive reopening an existing share', async (t) => {
  const { url } = await start(t), a = device(url), b = device(url);
  t.after(() => { a.worker.stop(); b.worker.stop(); });
  const L = require('../lib/syllabus.js'), id = L.taskId('_123_1', { day: '2026-11-01', title: 'Essay' });
  a.local.data[TK] = T.clean({ tasks: [{ id, title: 'Essay', at: 1 }] });
  assert.ok((await a.send('list')).sources.some((s) => s.kind === 'todo' && s.ids[0] === id), 'a real syllabus task is offered');
  const { sid } = await a.send('create', { kind: 'todo', title: 'Dates', key: TK, ids: [id] });
  await b.send('join', { link: (await a.send('link', { sid, edit: true })).link }); await b.send('attach', { sid, key: TK });
  await b.send('sync', { sid }); await a.send('sync', { sid });
  assert.equal((await a.send('read', { sid })).view[id]?.task.title, 'Essay');
  assert.ok(Object.hasOwn((await a.session(sid)).bind.map, id), 'the saved binding survives reopening');
  assert.equal(b.local.data[TK].tasks[0]?.title, 'Essay');
});
test('SHR-9: an edit-link holder who adds entities named like prototype members breaks no member\'s sync, and nothing is bound to them', async (t) => {
  const { url } = await start(t), a = device(url), b = device(url);
  t.after(() => { a.worker.stop(); b.worker.stop(); });
  const id = await note(a, '<p>hello</p>');
  const sid = await share(a, [id]);
  const edit = (await a.send('link', { sid, edit: true })).link;
  await b.send('join', { link: edit, name: 'B' }); await b.send('attach', { sid, key: NK });
  await forge(url, edit, PROTO.flatMap((e) => [{ e, f: 'html', v: '<p>x</p>', t: T0(), p: '' }, { e, f: 'title', v: 'x', t: T0(), p: '' }, { e, f: 'task', v: { id: 'x', title: 'x' }, t: T0(), p: '' }]));
  for (const d of [a, b]) { await d.send('sync', { sid }); assert.deepEqual(await d.status(sid), ['live', undefined], 'every member keeps syncing'); }
  const rec = await b.session(sid);
  assert.ok(Object.keys(rec.bind.map).every((e) => /^[0-9a-f-]{36}$/.test(e)), `bound to ${Object.keys(rec.bind.map)}`);
  assert.equal(Object.keys(b.local.data[NK].notes).length, 1, 'no note was made for them');
  // Real edits still travel both ways afterwards.
  await write(a, id, '<p>after</p>');
  await a.send('sync', { sid }); await b.send('sync', { sid });
  assert.match(await body(b, rec.bind.map[id]), /after/);
  assert.deepEqual(await b.status(sid), ['live', undefined]);
});

test('SHR-9: a To Do share is as safe: prototype-named tasks are no tasks, and only ids To Do makes can be shared', async (t) => {
  const { url } = await start(t), a = device(url), b = device(url);
  t.after(() => { a.worker.stop(); b.worker.stop(); });
  const task = '3f9a1c0e-7b42';
  a.local.data[TK] = T.clean({ tasks: [{ id: task, title: 'Write essay', at: 1 }, { id: 'task1', title: 'Old id', at: 2 }] });
  await assert.rejects(a.send('create', { kind: 'todo', title: 'Ours', key: TK, ids: ['task1'] }), /bad/);
  assert.deepEqual((await a.send('list')).sources.filter((s) => s.kind === 'todo').map((s) => s.ids[0]), [task], 'a task whose id To Do does not make is not offered');
  const { sid } = await a.send('create', { kind: 'todo', title: 'Ours', key: TK, ids: [task] });
  const edit = (await a.send('link', { sid, edit: true })).link;
  await b.send('join', { link: edit, name: 'B' }); await b.send('attach', { sid, key: TK });
  await forge(url, edit, PROTO.flatMap((e) => [{ e, f: 'task', v: { id: 'x', title: 'planted', done: false }, t: T0(), p: '' }, { e, f: 'plan', v: {}, t: T0(), p: '' }]));
  for (const d of [a, b]) { await d.send('sync', { sid }); assert.deepEqual(await d.status(sid), ['live', undefined]); }
  assert.deepEqual(b.local.data[TK].tasks.map((x) => x.title), ['Write essay'], 'nothing was made for them');
  assert.ok(Object.keys((await b.session(sid)).bind.map).every((e) => /^[0-9a-f-]{13}$/.test(e)));
});

test('SHR-9: a share already holding such an entity (saved before the fix) syncs, applies and sends nothing about it', async (t) => {
  const { url } = await start(t), a = device(url);
  t.after(() => a.worker.stop());
  const id = await note(a, '<p>hello</p>');
  const sid = await share(a, [id]);
  const rec = await a.session(sid);
  for (const e of ['toString', 'hasOwnProperty']) rec.st.state[e] = { html: ['<p>planted</p>', T0(), ''], title: ['planted', T0(), ''], task: [{ id: 'x', title: 'x', done: false }, T0(), ''] };
  await a.db.put('sessions', sid, rec);
  await a.send('sync', { sid });
  assert.deepEqual(await a.status(sid), ['live', undefined]);
  const after = await a.session(sid);
  assert.equal(after.st.pending.length, 0);
  assert.equal(Object.keys(after.bind.map).length, 1);
  assert.deepEqual(Object.keys(G.view(after.st)).filter((e) => PROTO.includes(e)), [], 'the view never offers them');
  assert.deepEqual((await a.send('list')).sessions[0].items.map((i) => i.id), [id]);
  assert.equal(Object.keys(a.local.data[NK].notes).length, 1);
});

test('SHR-9: lookups in a session record are own-property lookups, whatever the stored maps inherit', async (t) => {
  const { url } = await start(t), a = device(url);
  t.after(() => a.worker.stop());
  const id = await note(a, '<p>hello</p>');
  const sid = await share(a, [id]);
  const rec = await a.session(sid);
  // As IndexedDB hands them back: plain objects, with a prototype and whatever keys the record held.
  Object.defineProperty(rec.bind.map, '__proto__', { value: 'planted', enumerable: true, configurable: true, writable: true });
  rec.bind.files = JSON.parse('{"__proto__": "x", "toString": "y"}');
  rec.bind.hashes = JSON.parse('{"constructor": "z"}');
  await a.db.put('sessions', sid, rec);
  await a.send('sync', { sid });
  assert.deepEqual(await a.status(sid), ['live', undefined]);
  const after = await a.session(sid);
  assert.deepEqual(Object.keys(after.bind.map), [id]);
  assert.deepEqual([Object.keys(after.bind.files), Object.keys(after.bind.hashes)], [[], []], 'keys that are not ids Glaze makes are not kept');
});

// ---- SHR-12 ---------------------------------------------------------------------------------------------------------
test('SHR-12: a removed attachment and a trashed note\'s attachment go off the relay; the one still in use stays', async (t) => {
  const { url } = await start(t), a = device(url), b = device(url);
  t.after(() => { a.worker.stop(); b.worker.stop(); });
  const one = uuid(), two = uuid(), keep = uuid();
  const n1 = await note(a, '<p>x</p>', one), n2 = await note(a, '<p>y</p>', two), n3 = await note(a, '<p>z</p>', keep);
  const f1 = await attach(a, n1, 'one.txt', bytes('one')), f2 = await attach(a, n2, 'two.txt', bytes('two')), f3 = await attach(a, n3, 'keep.txt', bytes('keep'));
  await write(a, n1, `<p>x</p>${link(f1)}`); await write(a, n2, `<p>y</p>${link(f2)}`); await write(a, n3, `<p>z</p>${link(f3)}`);
  const sid = await share(a, [n1, n2, n3]);
  const first = await refs(a, sid);
  assert.equal(Object.keys(first).length, 3);
  for (const id of Object.values(first)) assert.equal(await onRelay(url, sid, id), 200);
  await write(a, n1, '<p>x, no attachment</p>');
  await N.run({ key: NK, op: 'trash', ids: [n2] }, { local: a.local }, a.notes);
  await a.send('sync', { sid });
  const now = await refs(a, sid);
  assert.deepEqual(Object.keys(now), [`f_${f3}`]);
  assert.equal(await onRelay(url, sid, first[`f_${f1}`]), 404, 'the removed attachment is gone from the relay');
  assert.equal(await onRelay(url, sid, first[`f_${f2}`]), 404, 'so is the trashed note\'s');
  assert.equal(await onRelay(url, sid, first[`f_${f3}`]), 200, 'a file still referenced is not touched');
  // A member who joins now reads the state, and finds every file it names.
  await b.send('join', { link: (await a.send('link', { sid })).link });
  assert.deepEqual(await b.status(sid), ['live', undefined]);
  assert.ok(b.db.stores.files.has(`${sid}/f_${f3}`));
});

test('SHR-12: Re-upload retained files removes the copies it replaces', async (t) => {
  const { url } = await start(t), a = device(url), b = device(url);
  t.after(() => { a.worker.stop(); b.worker.stop(); });
  const id = uuid(), n = await note(a, '<p>x</p>', id), f = await attach(a, n, 'a.txt', bytes('private bytes'));
  await write(a, n, `<p>x</p>${link(f)}`);
  const sid = await share(a, [n]);
  const before = (await refs(a, sid))[`f_${f}`];
  await a.send('reupload', { sid });
  const after = (await refs(a, sid))[`f_${f}`];
  assert.notEqual(after, before);
  assert.equal(await onRelay(url, sid, before), 404, 'the old encrypted copy is deleted');
  assert.equal(await onRelay(url, sid, after), 200);
  await b.send('join', { link: (await a.send('link', { sid })).link });
  assert.equal(new TextDecoder().decode((await b.db.get('files', `${sid}/f_${f}`)).bytes), 'private bytes');
});

test('SHR-12: nothing is deleted before the batch that drops the reference is accepted, and a file that comes back is sent again', async (t) => {
  const { url } = await start(t), a = device(url), b = device(url);
  t.after(() => { a.worker.stop(); b.worker.stop(); });
  const n = await note(a, '<p>x</p>'), f = await attach(a, n, 'a.txt', bytes('first'));
  await write(a, n, `<p>x</p>${link(f)}`);
  const sid = await share(a, [n]);
  const old = (await refs(a, sid))[`f_${f}`];
  await b.send('join', { link: (await a.send('link', { sid })).link });
  // Offline: the attachment is removed, and nothing may be deleted on the relay.
  a.hook = () => { throw new TypeError('offline'); };
  await write(a, n, '<p>x, no attachment</p>');
  a.requests.length = 0;
  await a.send('sync', { sid });
  assert.equal((await a.session(sid)).status, 'offline');
  assert.equal(a.requests.some((r) => r.method === 'DELETE'), false);
  a.hook = null;
  assert.equal(await onRelay(url, sid, old), 200, 'still there: the removal is not on the relay yet');
  // Back online: the batch goes first, then the file.
  a.requests.length = 0;
  await a.send('sync', { sid });
  const order = a.requests.filter((r) => r.op || r.method === 'DELETE').map((r) => r.method);
  assert.ok(order.indexOf('POST') >= 0 && order.indexOf('DELETE') > order.indexOf('POST'), order.join(' '));
  assert.equal(await onRelay(url, sid, old), 404);
  // The attachment comes back into the note: it has to be uploaded again, not pointed at the deleted copy.
  await write(a, n, `<p>x</p>${link(f)}`);
  await a.send('sync', { sid });
  const again = (await refs(a, sid))[`f_${f}`];
  assert.ok(again && again !== old);
  assert.equal(await onRelay(url, sid, again), 200, 'the new reference names a file the relay has');
  await b.send('sync', { sid });
  assert.deepEqual(await b.status(sid), ['live', undefined]);
});

// ---- SHR-7 ----------------------------------------------------------------------------------------------------------
test('SHR-7: a download that is slow but keeps moving does not time out', async (t) => {
  const { url } = await start(t), a = device(url), b = device(url);
  t.after(() => { a.worker.stop(); b.worker.stop(); });
  patience(t, 600);
  const n = await note(a, '<p>x</p>'), f = await attach(a, n, 'a.txt', bytes('slow bytes', 4096));
  await write(a, n, `<p>x</p>${link(f)}`);
  const sid = await share(a, [n]);
  b.hook = async (u, init) => (init?.method || 'GET') === 'GET' && u.includes('/b/') ? trickle(await fetch(u, init), init.signal) : undefined;
  const t0 = Date.now();
  await b.send('join', { link: (await a.send('link', { sid })).link });
  assert.deepEqual(await b.status(sid), ['live', undefined]);
  assert.ok((await b.db.get('files', `${sid}/f_${f}`)).bytes.length >= 10);
  assert.ok(Date.now() - t0 > 650, 'it took longer than a request may take in all');
});

test('SHR-7: a download that stalls leaves the text of the share synced and applied', async (t) => {
  const { url } = await start(t), a = device(url), b = device(url);
  t.after(() => { a.worker.stop(); b.worker.stop(); });
  patience(t, 600);
  const n = await note(a, '<p>one</p>');
  const sid = await share(a, [n]);
  await b.send('join', { link: (await a.send('link', { sid, edit: true })).link }); await b.send('attach', { sid, key: NK });
  const local = (await b.session(sid)).bind.map[n];
  const f = await attach(a, n, 'a.txt', bytes('new file'));
  await write(a, n, `<p>two</p>${link(f)}`);
  await a.send('sync', { sid });
  b.hook = (u, init) => (init?.method || 'GET') === 'GET' && u.includes('/b/') ? stall(init) : undefined;
  await b.send('sync', { sid });
  assert.match(await body(b, local), /two/, 'the new text arrived although the file did not');
  assert.equal((await b.session(sid)).status, 'offline', 'and the share says something is missing');
  // The file comes in the next round, and the note gets its attachment.
  b.hook = null;
  await b.send('sync', { sid });
  assert.deepEqual(await b.status(sid), ['live', undefined]);
  assert.match(await body(b, local), /data-gz-file/);
  // Nothing of the member's rounds took the attachment out of the share.
  await a.send('sync', { sid });
  assert.match((await a.send('read', { sid })).view[n].html, /data-gz-file/);
  assert.deepEqual(Object.keys(await refs(a, sid)), [`f_${f}`]);
});

test('SHR-7: an upload that stalls leaves the text of the share sent, and the file goes on the next round', async (t) => {
  const { url } = await start(t), a = device(url), b = device(url);
  t.after(() => { a.worker.stop(); b.worker.stop(); });
  patience(t, 600);
  const n = await note(a, '<p>one</p>');
  const sid = await share(a, [n]);
  await b.send('join', { link: (await a.send('link', { sid, edit: true })).link }); await b.send('attach', { sid, key: NK });
  const local = (await b.session(sid)).bind.map[n];
  const f = await attach(a, n, 'a.txt', bytes('new file'));
  await write(a, n, `<p>two</p>${link(f)}`);
  a.hook = (u, init) => init?.method === 'PUT' ? stall(init) : undefined;
  await a.send('sync', { sid });
  assert.equal((await a.session(sid)).status, 'offline');
  await b.send('sync', { sid });
  assert.match(await body(b, local), /two/, 'the text reached the other member while the file was stuck');
  a.hook = null;
  await a.send('sync', { sid }); await b.send('sync', { sid });
  assert.deepEqual(await a.status(sid), ['live', undefined]);
  assert.equal(new TextDecoder().decode((await b.db.get('files', `${sid}/f_${f}`)).bytes), 'new file');
});

test('SHR-7: stopping sharing ends a file that is stuck at once, and leaves the text as it landed', async (t) => {
  const { url } = await start(t), a = device(url), b = device(url);
  t.after(() => { a.worker.stop(); b.worker.stop(); });
  const n = await note(a, '<p>one</p>');
  const sid = await share(a, [n]);
  await b.send('join', { link: (await a.send('link', { sid, edit: true })).link }); await b.send('attach', { sid, key: NK });
  const f = await attach(a, n, 'a.txt', bytes('stuck'));
  await write(a, n, `<p>two</p>${link(f)}`);
  let held; const stuck = new Promise((resolve) => { held = resolve; });
  a.hook = (u, init) => { if (init?.method === 'PUT') { held(); return stall(init); } };
  const t0 = Date.now(), round = a.send('sync', { sid });
  await stuck;
  a.worker.stop();
  await round;
  assert.ok(Date.now() - t0 < 5000, 'it did not wait out the request\'s own time');
  assert.equal((await a.session(sid)).status, 'live', 'a stop is not a failure of the share');
  await b.send('sync', { sid });
  assert.match(await body(b, (await b.session(sid)).bind.map[n]), /two/, 'the text had been sent');
});

test('SHR-7: an upload gets the time its size needs, and a file that fails does not stop the ones after it', async (t) => {
  const { url } = await start(t), a = device(url), b = device(url);
  t.after(() => { a.worker.stop(); b.worker.stop(); });
  patience(t, 600);
  const n = await note(a, '<p>one</p>');
  const sid = await share(a, [n]);
  await b.send('join', { link: (await a.send('link', { sid })).link });
  const big = await attach(a, n, 'big.bin', bytes('big', 1 << 20)), small = await attach(a, n, 'small.txt', bytes('small'));
  await write(a, n, `<p>one</p>${link(small)}${link(big)}`);
  // The first file is refused outright; the second is slow, but a megabyte is allowed longer than a request.
  let seen = 0;
  a.hook = async (u, init) => {
    if (init?.method !== 'PUT') return undefined;
    if (seen++ === 0) return new Response('no', { status: 403 });
    await sleep(1000, init.signal);
    return undefined;
  };
  await a.send('sync', { sid });
  const v = await refs(a, sid);
  assert.deepEqual(Object.keys(v), [`f_${big}`], 'the second file is published although the first failed');
  assert.equal((await a.session(sid)).status, 'offline');
  a.hook = null;
  await a.send('sync', { sid });
  assert.deepEqual(Object.keys(await refs(a, sid)).sort(), [`f_${big}`, `f_${small}`].sort());
  assert.deepEqual(await a.status(sid), ['live', undefined]);
});

// ---- SHR-14 ---------------------------------------------------------------------------------------------------------
test('SHR-14: caching files keeps a running total instead of reading every cached file each time', async (t) => {
  const { url } = await start(t), a = device(url), b = device(url);
  t.after(() => { a.worker.stop(); b.worker.stop(); });
  const n = await note(a, '<p>x</p>');
  const names = [];
  const more = async (list) => {
    for (const name of list) names.push(await attach(a, n, `${name}.txt`, bytes(name.repeat(1000))));
    await write(a, n, `<p>x</p>${names.map((f) => link(f)).join('')}`);
  };
  await more(['a', 'b', 'c']);
  const sid = await share(a, [n]);
  await b.send('join', { link: (await a.send('link', { sid, edit: true })).link }); await b.send('attach', { sid, key: NK });
  await a.send('sync', { sid }); await b.send('sync', { sid });
  const reads = (d) => d.db.all_.filter((s) => s === 'files').length;
  const first = [reads(a), reads(b)];
  assert.ok(first.every((x) => x <= 1), `one full count at most, to start the total: ${first}`);
  await more(['d', 'e']);
  await a.send('sync', { sid }); await b.send('sync', { sid });
  assert.deepEqual([reads(a), reads(b)], first, 'more files add to the total, and read nothing');
  const total = (d) => [...d.db.stores.files.entries()].filter(([k]) => k.includes('/')).reduce((x, [, f]) => x + f.bytes.length, 0);
  for (const d of [a, b]) assert.equal(d.db.stores.files.get('total').total, total(d), 'the total is what is cached');
  assert.equal(total(b), 5000);
  // Leaving takes the files, and the total with them.
  await b.send('leave', { sid });
  assert.equal(total(b), 0);
  assert.equal(b.db.stores.files.get('total').total, 0);
});

test('SHR-14: a total that drifted high is counted again before a file is refused for room', async (t) => {
  const { url } = await start(t), a = device(url);
  t.after(() => a.worker.stop());
  const n = await note(a, '<p>x</p>'), f = await attach(a, n, 'a.txt', bytes('x', 1000));
  await write(a, n, `<p>x</p>${link(f)}`);
  a.db.stores.files.set('total', { total: S.LIMIT.total });
  const sid = await share(a, [n]);
  assert.deepEqual(await a.status(sid), ['live', undefined]);
  assert.equal(a.db.stores.files.get('total').total, 1000);
  // A cache that really is full still refuses.
  a.db.stores.files.set('padding/f_x', { bytes: { length: S.LIMIT.total }, sid: 'padding', entity: 'f_x' });
  a.db.stores.files.delete('total');
  const f2 = await attach(a, n, 'b.txt', bytes('y', 1000));
  await write(a, n, `<p>x</p>${link(f)}${link(f2)}`);
  await a.send('sync', { sid });
  assert.equal((await a.session(sid)).error, 'full');
});

test('SHR-14: listing shares reads only the Notes and To Do keys, not all of local storage', async (t) => {
  const { url } = await start(t), a = device(url, { getKeys: true });
  t.after(() => a.worker.stop());
  const n = await note(a, '<p>x</p>');
  await share(a, [n]);
  Object.assign(a.local.data, { lookMedia: 'x'.repeat(5000), 'lookMedia:abc': 'y'.repeat(5000), galleryOffer: { code: 'z' } });
  a.local.reads.length = 0;
  const out = await a.send('list');
  assert.deepEqual(out.accounts.sort(), [NK, TK].sort());
  assert.ok(out.sources.some((s) => s.kind === 'notes'));
  const asked = a.local.reads.flatMap((k) => (k === null || k === undefined ? ['<everything>'] : [].concat(k)));
  assert.equal(asked.includes('<everything>'), false, 'storage is never read whole');
  assert.equal(asked.some((k) => k.startsWith('lookMedia') || k === 'galleryOffer'), false, 'nor are other features\' keys');
});

test('a failed cache replacement cannot leave a low total that permits exceeding the cache cap', async (t) => {
  const { url } = await start(t), a = device(url), b = device(url);
  t.after(() => { a.worker.stop(); b.worker.stop(); });
  const n = await note(a, '<p>file</p>'), f = await attach(a, n, 'a.bin', bytes('original', 5000));
  await write(a, n, link(f));
  const sid = await share(a, [n]);
  await b.send('join', { link: (await a.send('link', { sid })).link });
  const c = G.session((await a.session(sid)).st), ref = await c.put(bytes('small', 1000));
  await c.edit({ ...c.view(), [`f_${f}`]: { file: { ...ref, n: 'small.bin', t: 'application/octet-stream' } } }); await c.sync();
  const put = b.db.put;
  b.db.put = async (s, k, v) => { if (s === 'files' && k === `${sid}/f_${f}`) throw new Error('disk full'); return put(s, k, v); };
  await b.send('sync', { sid });
  assert.equal((await b.db.get('files', `${sid}/f_${f}`)).bytes.length, 5000);
  const total = (await b.db.get('files', 'total'))?.total;
  assert.ok(total === undefined || total >= 5000, `a failed shrinking write left the total at ${total}`);
});

test('a local text save interrupts an older file transfer instead of waiting for its timeout', async (t) => {
  const { url } = await start(t), a = device(url), b = device(url);
  t.after(() => { a.worker.stop(); b.worker.stop(); });
  const n = await note(a, '<p>first</p>'), sid = await share(a, [n]);
  await b.send('join', { link: (await a.send('link', { sid, edit: true })).link }); await b.send('attach', { sid, key: NK });
  const close = a.worker.connect(); await a.serial(() => {});
  const f = await attach(a, n, 'pending.txt', bytes('not uploaded yet'));
  await write(a, n, `<p>first save</p>${link(f)}`);
  let entered; const transferring = new Promise((r) => { entered = r; });
  a.hook = (u, init) => { if (init?.method === 'PUT') { entered(); return stall(init); } };
  const round = a.send('sync', { sid });
  await transferring;
  await write(a, n, `<p>second save</p>${link(f)}`); a.worker.changed([NK]);
  try {
    await sleep(200);
    await b.send('sync', { sid });
    assert.match(await body(b, (await b.session(sid)).bind.map[n]), /second save/, 'new text is sent while the older transfer would still be waiting');
  } finally { close(); await round; await a.serial(() => {}); }
});

test('a stream emitting empty chunks has made no download progress and still times out', async (t) => {
  const { url } = await start(t), a = device(url), b = device(url);
  t.after(() => { a.worker.stop(); b.worker.stop(); });
  patience(t, 200);
  const n = await note(a, '<p>text</p>'), f = await attach(a, n, 'file.txt', bytes('bytes'));
  await write(a, n, link(f)); const sid = await share(a, [n]);
  b.hook = async (u, init) => {
    if ((init?.method || 'GET') !== 'GET' || !u.includes('/b/')) return;
    const data = new Uint8Array(await (await fetch(u, init)).arrayBuffer());
    let count = 0;
    return new Response(new ReadableStream({ async pull(c) {
      try { await sleep(50, init.signal); } catch (e) { c.error(e); return; }
      if (count++ < 6) c.enqueue(new Uint8Array()); else { c.enqueue(data); c.close(); }
    } }));
  };
  await b.send('join', { link: (await a.send('link', { sid })).link });
  assert.equal((await b.session(sid)).status, 'offline', 'empty chunks cannot extend the idle allowance');
  assert.equal(await b.db.get('files', `${sid}/f_${f}`), undefined);
});

test('a newer doorbell interrupts a download so the next remote text change lands promptly', async (t) => {
  const { url } = await start(t), a = device(url), b = device(url);
  t.after(() => { a.worker.stop(); b.worker.stop(); });
  const n = await note(a, '<p>first</p>'), sid = await share(a, [n]);
  await b.send('join', { link: (await a.send('link', { sid, edit: true })).link }); await b.send('attach', { sid, key: NK });
  const close = b.worker.connect(); await b.serial(() => {}); await sleep(50);
  let entered; const downloading = new Promise((r) => { entered = r; });
  b.hook = (u, init) => { if ((init?.method || 'GET') === 'GET' && u.includes('/b/')) { entered(); return stall(init); } };
  const f = await attach(a, n, 'file.txt', bytes('download later'));
  await write(a, n, `<p>first update</p>${link(f)}`); await a.send('sync', { sid });
  await downloading;
  try {
    await write(a, n, `<p>second update</p>${link(f)}`); await a.send('sync', { sid });
    await sleep(200);
    assert.match(await body(b, (await b.session(sid)).bind.map[n]), /second update/);
  } finally { close(); await b.serial(() => {}); }
});

test('a behind editor retaining a removed attachment restores it with a new live reference', async (t) => {
  const { url } = await start(t), a = device(url), b = device(url);
  t.after(() => { a.worker.stop(); b.worker.stop(); });
  const n = await note(a, '<p>file</p>'), f = await attach(a, n, 'retained.txt', bytes('retained bytes'));
  await write(a, n, `<p>file</p>${link(f)}`); const sid = await share(a, [n]);
  await b.send('join', { link: (await a.send('link', { sid, edit: true })).link }); await b.send('attach', { sid, key: NK });
  const bound = (await b.session(sid)).bind, mine = bound.map[n], localFile = bound.files[f], old = (await refs(a, sid))[`f_${f}`];
  await write(a, n, '<p>removed here</p>'); await a.send('sync', { sid });
  assert.equal(await onRelay(url, sid, old), 404);
  // B has not read A's removal, and still has both the local bytes and its own local file id.
  await write(b, mine, `<p>retained on B</p>${link(localFile)}`);
  await b.send('sync', { sid }); await b.send('sync', { sid });
  const fresh = (await refs(b, sid))[`f_${f}`];
  assert.ok(fresh && fresh !== old, 'a stale editor never republishes only the deleted blob');
  assert.equal(await onRelay(url, sid, fresh), 200);
  const late = device(url); t.after(() => late.worker.stop());
  await late.send('join', { link: (await a.send('link', { sid })).link });
  assert.equal(new TextDecoder().decode((await late.db.get('files', `${sid}/f_${f}`)).bytes), 'retained bytes');
});
