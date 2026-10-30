const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const C = require('../../extension/planner/classes.js');
const G = require('../../extension/planner/gpa.js');
const N = require('../../extension/planner/notes.js');

// Run the actual sync wiring as a restarted classic worker: install handlers have not loaded optional libraries.
const worker = () => {
  const area = () => {
    const m = new Map();
    return {
      get: async (k) => Object.fromEntries([].concat(k).filter((x) => m.has(x)).map((x) => [x, structuredClone(m.get(x))])),
      set: async (o) => { for (const [k, v] of Object.entries(o)) m.set(k, structuredClone(v)); },
      remove: async (k) => { for (const x of [].concat(k)) m.delete(x); }, getKeys: async () => [...m.keys()],
    };
  };
  const listener = { addListener() {} }, changed = { fns: [], addListener(f) { this.fns.push(f); } }, local = area(), sync = area();
  const stores = { bodies: new Map(), files: new Map(), blobs: new Map() };
  const db = {
    get: async (s, k) => structuredClone(stores[s].get(k)),
    put: async (s, k, v) => { stores[s].set(k, structuredClone(v)); },
    del: async (s, ks) => { for (const k of ks) stores[s].delete(k); },
    scan: async (s, prefix) => [...stores[s]].filter(([k]) => k.startsWith(prefix)),
    keys: async (s, prefix) => [...stores[s].keys()].filter((k) => k.startsWith(prefix)),
  };
  let documents, records;
  const context = vm.createContext({
    console, TextEncoder, TextDecoder,
    chrome: { storage: { local, sync, onChanged: changed }, runtime: { onMessage: listener, onStartup: listener } },
    GZ_CARDS: { queue: () => { let tail = Promise.resolve(); return (fn) => { const p = tail.then(fn); tail = p.catch(() => {}); return p; }; } },
    GZ_DRIVE_SYNC: { create: (env) => { documents = env; return {}; } }, brokerTurn: null,
    driveLib: () => {}, googleLib: () => ({ ON: true }), openPapers: () => ({}),
    NOTES_DB: db, brokerArea: () => ({ get: local.get, set: async (o) => { await local.set(o); return true; } }), GZ_NOTES: N,
    brokerIn: (name) => { assert.equal(name, 'backup'); context.GZ_CLASSES = C; context.GZ_GPA = G; },
  });
  vm.runInContext(fs.readFileSync(require.resolve('../../extension/background/drive-store.js'), 'utf8'), context);
  const create = context.GZ_DRIVE_STORE.create;
  context.GZ_DRIVE_STORE.create = (env) => { records = env; return create(env); };
  const source = fs.readFileSync(require.resolve('../../extension/background/background.js'), 'utf8');
  const from = source.indexOf('// Sync to Google Drive (documents/drive-sync.js');
  vm.runInContext(source.slice(from, source.indexOf('// A Download all wait owns', from)), context);
  vm.runInContext('openDriveSync()', context);
  return { context, documents, records, local, changed };
};

test('a restarted worker loads validators before accepting class schedules and GPA records', () => {
  const { context } = worker();
  const classes = C.clean({ courses: [{ id: '101', name: 'Art', at: 3, periods: [] }] });
  const gpa = G.clean({ t: [] });
  context.values = { classes, gpa };
  for (const cat of ['classes', 'gpa']) {
    assert.deepEqual(vm.runInContext(`GZ_DRIVE_STORE.clean('${cat}', '', values.${cat})`, context), cat === 'classes' ? classes : gpa);
  }
});

test('a remote record compares with current storage inside the broker queue', async () => {
  const { context, records, local } = worker();
  const key = 'writerWords';
  await local.set({ [key]: ['Original'] });
  let release;
  const ready = new Promise((r) => { release = r; });
  context.brokerTurn = context.GZ_CARDS.queue();
  const earlier = context.brokerTurn(async () => { await ready; await local.set({ [key]: ['Local edit'] }); });
  const replacement = records.area('local').replace(key, ['Original'], ['Remote edit']);
  release(); await earlier;
  assert.equal(await replacement, false);
  assert.deepEqual((await local.get(key))[key], ['Local edit']);
  assert.equal(await records.area('local').replace(key, ['Local edit'], ['Remote edit']), true);
  assert.deepEqual((await local.get(key))[key], ['Remote edit']);
});

test('a remote note compares after an earlier queued rename before replacing or deleting it', async () => {
  for (const remove of [false, true]) {
    const { context, records } = worker();
    const acct = 'notesIdx:https://school.instructure.com/42', id = '00000000-0000-4000-8000-000000000001', key = `${acct}|${id}`;
    const notes = records.area('notes');
    await notes.set({ [key]: { note: { title: 'Original', at: 10 }, html: '<p>Original</p>' } });
    const expected = (await notes.get(key))[key];
    let release;
    const gate = new Promise((r) => { release = r; });
    const earlier = context.brokerTurn(async () => {
      await gate;
      return N.run({ key: acct, op: 'meta', id, title: 'Local rename' }, { local: context.brokerArea('local') }, context.NOTES_DB);
    });
    const pending = notes.replace(key, expected, remove ? undefined : { note: { title: 'Remote', at: 20 }, html: '<p>Remote</p>' });
    // Let the adapter read the old metadata while the earlier broker operation is held.
    await new Promise(setImmediate);
    release();
    assert.equal((await earlier).ok, true);
    assert.equal(await pending, false, 'the queued local rename invalidates the remote compare');
    assert.equal((await notes.get(key))[key].note.title, 'Local rename');
  }
});

test('a daily snapshot whose files are past one upload is no snapshot, its files never read into the worker', async () => {
  const { context, records, local } = worker();
  Object.assign(context, {
    GZ_BACKUP: require('../../extension/background/backup.js'), GZ_TODO: require('../../extension/planner/todo.js'), GZ_PET: require('../../extension/pet/pet.js'),
    GZ_SANITIZE: require('../../extension/content/defaults.js').GZ_SANITIZE, GZ_HISTORY: require('../../extension/looks/history.js'), GZ_ZIP: require('../../extension/core/zip.js'),
    GZ_DOC_KINDS: require('../../extension/documents/doc-kinds.js'), GZ_FOLDERS: require('../../extension/courses/folders.js'), Blob,
  });
  context.chrome.runtime.getManifest = () => ({ version: '4.0.1' });
  let read = 0;
  context.openDocFiles = () => ({ read: async (hash, each) => { read++; each(new Uint8Array(8)); } });
  // Five PDFs of 45 MB: one backup could hold them (background/backup.js LIMIT.zip), one upload can't (documents/drive.js put).
  const pdf = (n) => ({ key: `doc:00000000-0000-4000-8000-00000000000${n}`, kind: 'pdf', title: `Reader ${n}`, file: { hash: String(n).repeat(64), size: 45e6, type: 'application/pdf' }, revision: 1 });
  for (let n = 1; n <= 5; n++) await local.set({ [`writerPaper:${pdf(n).key}`]: pdf(n) });
  const get = local.get;
  local.get = async (k) => (k === null ? Object.fromEntries(await Promise.all((await local.getKeys()).map(async (x) => [x, (await get(x))[x]]))) : get(k));
  assert.equal(await records.snapshot(), null);
  assert.ok(read <= 4, `read ${read} of the files`);
});

test('while Sync is off for its account, each record\'s time of change is still kept for when it is turned on again', async () => {
  const { context, local, changed } = worker();
  await local.set({ driveSync: { on: false, off: true, account: 'student@school.edu', folder: 'f', token: '9' } });
  for (const f of changed.fns) f({ writerWords: { oldValue: ['Alpha'], newValue: ['Alpha', 'Beta'] } }, 'local');
  await new Promise((r) => setTimeout(r, 20));
  assert.ok(Number.isFinite((await local.get('driveSyncStamps')).driveSyncStamps?.['local:writerWords']), 'stamped while off');
  // Never connected, or its account forgotten: nothing loads, nothing is kept.
  await local.remove(['driveSyncStamps']);
  let loaded = 0;
  context.googleLib = () => { loaded++; return { ON: true }; };
  for (const st of [undefined, { on: false, off: true, problem: 'account' }]) {
    await (st ? local.set({ driveSync: st }) : local.remove(['driveSync']));
    for (const f of changed.fns) f({ writerWords: { oldValue: ['Alpha'], newValue: ['Gamma'] } }, 'local');
    await new Promise((r) => setTimeout(r, 20));
  }
  assert.equal((await local.get('driveSyncStamps')).driveSyncStamps, undefined);
  assert.equal(loaded, 0, 'Google\'s libraries never loaded for it');
});

// The worker's Google sign-in routes (background/background.js), Google's sign-in (background/google.js) as a stand-in.
const googleWorker = (status) => {
  const listeners = [];
  const context = vm.createContext({
    console, URL, Promise, navigator: {}, importScripts: () => {},
    chrome: { runtime: { id: 'glaze', getURL: (f = '') => `chrome-extension://x/${f}`, onMessage: { addListener: (f) => listeners.push(f) }, onConnect: { addListener() {} } },
      storage: { local: { get: async () => ({}) } }, permissions: {}, identity: {}, tabs: {} },
    GZ_GOOGLE: { ON: true, APP: 'app', flowOf: () => 'chrome', create: () => ({ status: async () => status }) }, GZ_GOOGLE_CONFIG: {}, GZ_GCAL: { ON: false },
    fromEditor: () => false, trustedFrame: () => true, settingsFramesLoaded: Promise.resolve(), grantTurn: (f) => f(),
  });
  const source = fs.readFileSync(require.resolve('../../extension/background/background.js'), 'utf8');
  const from = source.indexOf('// Google sign-in for Drive (background/google.js)');
  vm.runInContext(source.slice(from, source.indexOf('// Sync to Google Drive (documents/drive-sync.js', from)), context);
  const send = (m, sender) => new Promise((res) => { for (const f of listeners) f(m, sender, res); });
  return { send };
};

test('Drive\'s status tells Documents and Writer whether Google\'s Picker works there, as well as whether Drive is connected', async () => {
  const page = { id: 'glaze', url: 'chrome-extension://x/papers.html', frameId: 0 };
  const ask = async (status) => JSON.parse(JSON.stringify(await googleWorker(status).send({ type: 'glaze:drive', op: 'status' }, page)));
  assert.deepEqual(await ask({ ok: true, flow: 'chrome', email: 'student@school.edu', picker: true }), { ok: true, connected: true, picker: true });
  assert.deepEqual(await ask({ ok: true, flow: 'native', email: 'student@school.edu', picker: false }), { ok: true, connected: true, picker: false }, 'Safari\'s app flow: Save to Drive, no Picker');
  assert.deepEqual(await ask({ ok: true, flow: 'chrome', email: null, picker: true }), { ok: true, connected: false, picker: false }, 'not connected');
  assert.deepEqual(await ask({ ok: false, why: 'setup' }), { ok: true, connected: false, picker: false });
});

test('a daily snapshot holds Notes and hidden course folders as Back up… does, and never share keys', async () => {
  const { context, records, local } = worker();
  const B = require('../../extension/background/backup.js');
  Object.assign(context, {
    GZ_BACKUP: B, GZ_TODO: require('../../extension/planner/todo.js'), GZ_PET: require('../../extension/pet/pet.js'), GZ_SANITIZE: require('../../extension/content/defaults.js').GZ_SANITIZE,
    GZ_HISTORY: require('../../extension/looks/history.js'), GZ_ZIP: require('../../extension/core/zip.js'), GZ_DOC_KINDS: require('../../extension/documents/doc-kinds.js'),
    GZ_FOLDERS: require('../../extension/courses/folders.js'), Blob, URL,
  });
  context.chrome.runtime.getManifest = () => ({ version: '4.0.1' });
  context.openDocFiles = () => ({ read: async () => { throw new Error('no files'); } });
  const get = local.get;
  local.get = async (k) => (k === null ? Object.fromEntries(await Promise.all((await local.getKeys()).map(async (x) => [x, (await get(x))[x]]))) : get(k));
  const acct = 'notesIdx:https://school.instructure.com/42', id = '00000000-0000-4000-8000-000000000001', pic = '00000000-0000-4000-8000-000000000500';
  const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex').toString('base64');
  const brokered = context.brokerArea('local');
  assert.ok((await N.run({ key: acct, op: 'file', id: pic, kind: 'image', name: 'cell.png', data: png, note: id }, { local: brokered }, context.NOTES_DB)).ok);
  assert.ok((await N.run({ key: acct, op: 'save', id, base: 0, sid: 's1', html: `<p>Cells</p><img data-gz-file="${pic}">`, title: 'Cells' }, { local: brokered }, context.NOTES_DB)).ok);
  const hidden = { ids: ['101'], show: false };
  await local.set({ 'hiddenFolders:https://school.instructure.com/42/7': hidden });
  const made = await records.snapshot();
  const r = await B.read(Object.assign(new Blob([made.bytes]), { name: made.name }));
  assert.deepEqual(r.cats.notes?.map((n) => [n.account, n.count]), [[acct, 1]], 'the Notes account and its note');
  assert.ok(r.zip.names.some((n) => /^notes\/1\/files\//.test(n)), 'with its picture');
  assert.equal(r.cats.shareKeys, undefined);
  assert.ok(!r.zip.names.some((n) => /share-keys/.test(n)), 'no share keys');
  assert.deepEqual(JSON.parse(await r.zip.text('glaze-backup.json')).settings.folders, { 'hiddenFolders:https://school.instructure.com/42/7': hidden }, 'the hidden course folders');
});

test('a restarted worker builds the daily snapshot without a document export having loaded the zip library first', async () => {
  const { context, records, local } = worker();
  // The worker's own importScripts, relative to background/: what a restarted worker has is only what something loaded.
  const path = require('node:path');
  const loaded = [];
  context.importScripts = (...files) => { for (const f of files) { loaded.push(f); vm.runInContext(fs.readFileSync(path.resolve(__dirname, '../../extension/background', f), 'utf8'), context); } };
  const B = require('../../extension/background/backup.js');
  Object.assign(context, {
    GZ_BACKUP: B, GZ_TODO: require('../../extension/planner/todo.js'), GZ_PET: require('../../extension/pet/pet.js'), GZ_SANITIZE: require('../../extension/content/defaults.js').GZ_SANITIZE,
    GZ_HISTORY: require('../../extension/looks/history.js'), GZ_DOC_KINDS: require('../../extension/documents/doc-kinds.js'), GZ_FOLDERS: require('../../extension/courses/folders.js'), Blob, URL,
  });
  assert.equal(context.GZ_ZIP, undefined, 'no export ran in this worker');
  context.chrome.runtime.getManifest = () => ({ version: '4.0.1' });
  context.openDocFiles = () => ({ read: async () => { throw new Error('no files'); } });
  const get = local.get;
  local.get = async (k) => (k === null ? Object.fromEntries(await Promise.all((await local.getKeys()).map(async (x) => [x, (await get(x))[x]]))) : get(k));
  await local.set({ writerWords: ['Glaze'] });
  const made = await records.snapshot();
  assert.ok(made?.bytes?.length > 0, 'a snapshot was made');
  const r = await B.read(Object.assign(new Blob([made.bytes]), { name: made.name }));
  assert.deepEqual(JSON.parse(await r.zip.text('glaze-backup.json')).writerWords, ['Glaze']);
  assert.ok(loaded.includes('../core/zip.js'));
});

test('a restarted worker\'s push run checks a document saved before it stopped, without Documents having loaded the paper store', async () => {
  // The real Sync to Google Drive in a classic worker: no require, only what the worker's own importScripts loaded.
  const path = require('node:path');
  const area = () => {
    const m = new Map();
    return {
      get: async (k) => (k === null ? Object.fromEntries(structuredClone([...m])) : Object.fromEntries([].concat(k).filter((x) => m.has(x)).map((x) => [x, structuredClone(m.get(x))]))),
      set: async (o) => { for (const [k, v] of Object.entries(o)) m.set(k, structuredClone(v)); },
      remove: async (k) => { for (const x of [].concat(k)) m.delete(x); }, getKeys: async () => [...m.keys()],
    };
  };
  const listener = { addListener() {} }, local = area(), sync = area();
  const FOLDER = 'application/vnd.google-apps.folder', root = { id: 'F1', name: 'Glaze', mimeType: FOLDER, trashed: false, parents: ['0AroOt'], appProperties: { glaze: 'root' } };
  const data = { id: 'D1', name: 'Data', mimeType: FOLDER, trashed: false, parents: ['F1'], appProperties: { glaze: 'data' } };
  const client = {
    file: async (id) => ({ F1: root, D1: data })[id],
    find: async (q) => ({ files: /glaze' and value='data'/.test(q) ? [data] : /glaze' and value='root'/.test(q) ? [root] : [] }),
  };
  const context = vm.createContext({
    console, TextEncoder, TextDecoder, URL, crypto: globalThis.crypto, navigator: {},
    chrome: { storage: { local, sync, onChanged: listener }, runtime: { onMessage: listener, onStartup: listener } },
    GZ_CARDS: { queue: () => { let tail = Promise.resolve(); return (fn) => { const p = tail.then(fn); tail = p.catch(() => {}); return p; }; } }, brokerTurn: null,
    driveLib: () => {}, googleLib: () => ({ ON: true }), openGoogle: () => ({ account: async () => 'student@school.edu' }), GZ_DRIVE: { create: () => client },
    NOTES_DB: { keys: async () => [] }, brokerArea: () => local, GZ_NOTES: N, brokerIn: () => {},
  });
  context.importScripts = (...files) => { for (const f of files) vm.runInContext(fs.readFileSync(path.resolve(__dirname, '../../extension/background', f), 'utf8'), context); };
  context.openPapers = () => { if (!context.paperStore) { context.importScripts('../writer/writer-styles.js', '../writer/writer-papers.js'); context.paperStore = context.GZ_WRITER_PAPERS.open(local, () => Date.now(), {}); } return context.paperStore; };
  const source = fs.readFileSync(require.resolve('../../extension/background/background.js'), 'utf8');
  const from = source.indexOf('// Sync to Google Drive (documents/drive-sync.js');
  vm.runInContext(source.slice(from, source.indexOf('// A Download all wait owns', from)), context);
  // A paper saved, its push still waiting when the last worker stopped; Sync on, its folders known, today's snapshot made.
  const key = 'doc:00000000-0000-4000-8000-000000000001';
  await local.set({ driveSync: { on: true, account: 'student@school.edu', folder: 'F1', data: 'D1', token: '7', snap: Date.now() }, driveSyncDirty: { [key]: 1 } });
  const r = await vm.runInContext('openDriveSync()', context).run({ push: true });
  assert.deepEqual(JSON.parse(JSON.stringify(r)), { ok: true });
  assert.deepEqual((await local.get('driveSyncDirty')).driveSyncDirty, {}, 'the mark let go');
});
