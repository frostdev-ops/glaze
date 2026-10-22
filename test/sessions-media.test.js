// A Look share session carries the media file a Look names (x.bg.media with a `file:` address): one encrypted file beside the
// code, uploaded once, fetched by whoever follows, checked against its name and kept only if it is the file the Look names.
// A localhost disk relay only; no account, no live relay.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const S = require('../lib/sessions.js');
const N = require('../lib/notes.js');
const T = require('../lib/todo.js');
const X = require('../lib/lookparts.js');
const M = require('../lib/media.js');
const L = require('../lib/share.js');
const { relay, diskStore } = require('../server/relay.js');

const fx = (f) => new Uint8Array(fs.readFileSync(path.join(__dirname, 'fixtures/media', f)));
const clone = (x) => (x === undefined ? x : structuredClone(x));
const localArea = (data = {}) => ({ data, get: async (keys) => Object.fromEntries([].concat(keys ?? Object.keys(data)).filter((k) => k in data).map((k) => [k, clone(data[k])])),
  set: async (patch) => { Object.assign(data, clone(patch)); return true; }, remove: async (keys) => { for (const k of [].concat(keys)) delete data[k]; return true; } });
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
const start = async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-media-relay-'));
  let r;
  t.after(async () => { if (r) await r.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  r = relay({ db: path.join(dir, 'share.db'), store: diskStore(path.join(dir, 'blobs')) });
  const address = await r.listen(0, '127.0.0.1');
  return { url: `http://127.0.0.1:${address.port}`, blobs: path.join(dir, 'blobs') };
};
// The worker's store of files kept for Looks' backgrounds (lib/media.js), by hash.
const keptFiles = () => {
  const records = new Map();
  return { records, get: async (h) => clone(records.get(h)), put: async (h, v) => { records.set(h, clone(v)); }, del: async (hs) => { for (const h of hs) records.delete(h); }, keys: async () => [...records.keys()] };
};
const device = (url) => {
  const local = localArea({ 'notesIdx:https://school.instructure.com/5': N.clean({}), 'todo:https://school.instructure.com/5': T.clean({}) }), settings = localArea(), db = database(), files = keptFiles();
  const d = { local, settings, db, files, kept: { local, sync: settings, files }, requests: [], offered: [], media: [], fetch };
  d.worker = S.make({ local, sync: settings, db, notes: notesDB(), keptFiles: files, relay: url, dev: true, permission: async () => true, offerLook: async (code, name, media) => { d.offered.push(code); d.media.push(media); return true; },
    fetch: (...a) => { d.requests.push(a[0]); return d.fetch(...a); }, WebSocket });
  d.send = (op, rest = {}) => d.worker.handle({ op, ...rest });
  return d;
};
// A device wearing a Look whose background is `file` kept on it.
const wear = async (d, file, extra = {}) => {
  const put = await M.change({ op: 'put', kind: 'image', b64: M.std(file) }, d.kept);
  Object.assign(d.settings.data, { bg: { kind: 'media' }, lookX: await X.pack({ x: { bg: { media: { type: 'image', src: `file:${put.h}`, fit: 'cover', ...extra } } } }) });
  return put.h;
};
const files = (dir) => fs.readdirSync(dir, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).map((e) => path.join(e.parentPath, e.name));

test('a Look with a media file: the file goes up once, encrypted, and the follower keeps exactly it, pending, before the Look is offered', async (t) => {
  const { url, blobs } = await start(t), a = device(url), b = device(url);
  t.after(() => { a.worker.stop(); b.worker.stop(); });
  const h = await wear(a, fx('anim.webp'));
  const look = await a.send('create', { kind: 'look', title: 'Moving' });
  await b.send('join', { link: (await a.send('link', look)).link });
  await a.send('sync', look); await b.send('sync', look);
  const sent = files(blobs);
  assert.equal(sent.length, 1, 'one encrypted file on the relay');
  const bytes = fs.readFileSync(sent[0]);
  assert.equal(Buffer.from(bytes).includes(Buffer.from(fx('anim.webp').subarray(0, 12))), false, 'the relay holds nothing it could read');
  assert.equal(b.files.records.has(h), false, 'following keeps nothing yet');
  await b.send('useLook', look);
  assert.equal(b.offered.length, 1);
  const got = await L.decode(b.offered[0]);
  assert.equal(got.parts.x.bg.media.src, `file:${h}`);
  assert.equal(got.bg.kind, 'media');
  const kept = await M.read(b.kept, h);
  assert.deepEqual([kept.type, kept.mime], ['image', 'image/webp']);
  assert.deepEqual(Buffer.from(kept.bytes), Buffer.from(fx('anim.webp')));
  // Kept pending, as a gallery Look's file is: the editor lets it go unless the student uses the Look.
  assert.deepEqual(b.media, [{ h, pending: true }]);
  assert.equal(b.local.data[M.INDEX][h].p, true);
  assert.equal(Object.keys(b.local.data).some((k) => k.startsWith('lookMedia:')), false, 'nothing in storage.local but the index');
  assert.deepEqual(b.settings.data, {}, 'following never changes the theme');
  // Syncing again uploads nothing more.
  await a.send('sync', look); await a.send('sync', look);
  assert.equal(files(blobs).length, 1, 'the file is uploaded once');
});

test('a changed media file replaces the one shared; a Look whose file is not here shares only its code', async (t) => {
  const { url, blobs } = await start(t), a = device(url), b = device(url);
  t.after(() => { a.worker.stop(); b.worker.stop(); });
  const first = await wear(a, fx('anim.webp'));
  const look = await a.send('create', { kind: 'look', title: 'Moving' });
  await b.send('join', { link: (await a.send('link', look)).link });
  await a.send('sync', look); await b.send('sync', look);
  const second = await wear(a, fx('still.webp'), { dim: 10 });
  assert.notEqual(first, second);
  await a.send('sync', look); await b.send('sync', look);
  assert.equal(files(blobs).length, 1, 'the new file is a new upload, and the one it replaced is gone from the relay');
  await b.send('useLook', look);
  assert.equal((await L.decode(b.offered.at(-1))).parts.x.bg.media.src, `file:${second}`);
  assert.equal((await M.read(b.kept, second)).mime, 'image/webp');
  assert.equal((await M.change({ op: 'list' }, b.kept)).files.some((f) => f.h === second), true);
  // The Look names a file this device does not have: the code is shared, and no file entity is made.
  const c = device(url), d = device(url);
  t.after(() => { c.worker.stop(); d.worker.stop(); });
  Object.assign(c.settings.data, { bg: { kind: 'media' }, lookX: await X.pack({ x: { bg: { media: { type: 'video', src: `file:${'A'.repeat(43)}` } } } }) });
  const empty = await c.send('create', { kind: 'look', title: 'Missing' });
  await d.send('join', { link: (await c.send('link', empty)).link });
  await c.send('sync', empty); await d.send('sync', empty);
  await d.send('useLook', empty);
  assert.equal((await L.decode(d.offered[0])).parts.x.bg.media.src, `file:${'A'.repeat(43)}`);
  assert.deepEqual([d.files.records.size, d.local.data[M.INDEX]], [0, undefined], 'nothing to keep');
  // A media Look that is not worn as media (another kind) shares no file.
  const e = device(url);
  t.after(() => e.worker.stop());
  await wear(e, fx('anim.webp'));
  e.settings.data.bg = { kind: 'solid' };
  const plain = await e.send('create', { kind: 'look', title: 'Plain' });
  const before = files(blobs).length;
  await e.send('sync', plain);
  assert.equal(files(blobs).length, before, 'the draft stays on this computer');
});

test('the media file goes off the relay when the Look stops using it, and comes back as a new upload if it is worn again', async (t) => {
  const { url, blobs } = await start(t), a = device(url), b = device(url);
  t.after(() => { a.worker.stop(); b.worker.stop(); });
  const h = await wear(a, fx('anim.webp'));
  const look = await a.send('create', { kind: 'look', title: 'Moving' });
  await b.send('join', { link: (await a.send('link', look)).link });
  assert.equal(files(blobs).length, 1);
  const media = a.settings.data.bg;
  a.settings.data.bg = { kind: 'solid' };
  await a.send('sync', look);
  assert.equal(files(blobs).length, 0, 'nothing of the Look\'s media is left on the relay');
  a.settings.data.bg = media;
  await a.send('sync', look); await b.send('sync', look);
  assert.equal(files(blobs).length, 1, 'worn again, the file is sent again');
  await b.send('useLook', look);
  assert.deepEqual(Buffer.from((await M.read(b.kept, h)).bytes), Buffer.from(fx('anim.webp')));
});

test('retrying a changed media upload never reuses the previous background file', async (t) => {
  const { url } = await start(t), a = device(url), b = device(url);
  t.after(() => { a.worker.stop(); b.worker.stop(); });
  await wear(a, fx('anim.webp'));
  const look = await a.send('create', { kind: 'look', title: 'Moving' });
  await b.send('join', { link: (await a.send('link', look)).link });
  const h = await wear(a, fx('still.webp'));
  a.fetch = (...args) => args[1]?.method === 'PUT' ? Promise.reject(Error('offline')) : fetch(...args);
  await a.send('sync', look);
  assert.equal((await a.send('list')).sessions[0].status, 'offline');
  a.fetch = fetch;
  await a.send('sync', look);
  await b.send('sync', look);
  await b.send('useLook', look);
  assert.equal((await L.decode(b.offered.at(-1))).parts.x.bg.media.src, `file:${h}`);
  assert.deepEqual(Buffer.from((await M.read(b.kept, h))?.bytes || []), Buffer.from(fx('still.webp')));
});

test('a file that is not the one the Look names is not kept', async (t) => {
  const { url } = await start(t), a = device(url), b = device(url);
  t.after(() => { a.worker.stop(); b.worker.stop(); });
  const h = await wear(a, fx('anim.webp'));
  const look = await a.send('create', { kind: 'look', title: 'Moving' });
  await b.send('join', { link: (await a.send('link', look)).link });
  await a.send('sync', look); await b.send('sync', look);
  // The follower's copy of the shared file was swapped for another picture (what a relay that lied would have caused, past the
  // reference's own hash): the Look names the first, and `put` names what it keeps.
  const key = [...b.db.stores.files.keys()].find((k) => k.endsWith('/f_media'));
  assert.ok(key, 'the file reached the follower');
  b.db.stores.files.set(key, { ...b.db.stores.files.get(key), bytes: fx('still.webp') });
  await b.send('useLook', look);
  assert.equal(b.files.records.has(h), false, 'bytes that are not the file named are not kept');
  assert.deepEqual([b.files.records.size, b.local.data[M.INDEX]], [0, undefined]);
  assert.equal(b.offered.length, 1, 'the Look itself is still offered');
  assert.deepEqual(b.media, [{ h, error: 'hash' }], 'and the editor is told why its file is not here');
  // Bytes that are not media at all.
  b.db.stores.files.set(key, { ...b.db.stores.files.get(key), bytes: new TextEncoder().encode('<script>alert(1)</script>') });
  await b.send('useLook', look);
  assert.deepEqual([b.files.records.size, b.local.data[M.INDEX]], [0, undefined]);
});

test('a Look share offered when there is no room for its file says so', async (t) => {
  const { url } = await start(t), a = device(url), b = device(url);
  t.after(() => { a.worker.stop(); b.worker.stop(); });
  const h = await wear(a, fx('anim.webp'));
  const look = await a.send('create', { kind: 'look', title: 'Moving' });
  await b.send('join', { link: (await a.send('link', look)).link });
  await a.send('sync', look); await b.send('sync', look);
  b.local.data[M.INDEX] = { ['B'.repeat(43)]: { t: 'video/webm', n: M.LIMIT.total, at: Date.now() } };
  b.files.records.set('B'.repeat(43), { t: 'video/webm', b: 'AAAA' });
  await b.send('useLook', look);
  assert.deepEqual(b.media, [{ h, error: 'full' }]);
  assert.equal(b.files.records.has(h), false);
});

test('a stray old-style kept file is still taken by the sticker reset\'s rule', () => {
  const L2 = require('../lib/lookx.js');
  assert.equal(L2.RESET('lookMedia:abc'), true);
  assert.equal(L2.RESET('lookMedia'), false);
  assert.equal(L2.RESET('stkImg:abc'), true);
});
