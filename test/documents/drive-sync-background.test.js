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
  const listener = { addListener() {} }, local = area(), sync = area();
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
    chrome: { storage: { local, sync, onChanged: listener }, runtime: { onMessage: listener, onStartup: listener } },
    GZ_CARDS: { queue: () => { let tail = Promise.resolve(); return (fn) => { const p = tail.then(fn); tail = p.catch(() => {}); return p; }; } },
    GZ_DRIVE_SYNC: { create: (env) => { documents = env; return {}; } }, brokerTurn: null,
    driveLib: () => {}, googleLib: () => ({ ON: true }),
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
  return { context, documents, records, local };
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
    GZ_DOC_KINDS: require('../../extension/documents/doc-kinds.js'), Blob,
  });
  context.chrome.runtime.getManifest = () => ({ version: '4.0.1' });
  let read = 0;
  context.openDocFiles = () => ({ read: async (hash, each) => { read++; each(new Uint8Array(8)); } });
  // Two PDFs of 120 MB: one backup could hold them (background/backup.js LIMIT.zip), one upload can't (documents/drive.js put).
  const pdf = (n) => ({ key: `doc:00000000-0000-4000-8000-00000000000${n}`, kind: 'pdf', title: `Reader ${n}`, file: { hash: String(n).repeat(64), size: 120e6, type: 'application/pdf' }, revision: 1 });
  await local.set({ [`writerPaper:${pdf(1).key}`]: pdf(1), [`writerPaper:${pdf(2).key}`]: pdf(2) });
  assert.equal(await records.snapshot(), null);
  assert.ok(read <= 1, `read ${read} of the files`);
});
