const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const C = require('../../extension/planner/classes.js');
const G = require('../../extension/planner/gpa.js');

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
  let documents, records;
  const context = vm.createContext({
    console, TextEncoder, TextDecoder,
    chrome: { storage: { local, sync, onChanged: listener }, runtime: { onMessage: listener, onStartup: listener } },
    GZ_CARDS: { queue: () => { let tail = Promise.resolve(); return (fn) => { const p = tail.then(fn); tail = p.catch(() => {}); return p; }; } },
    GZ_DRIVE_SYNC: { create: (env) => { documents = env; return {}; } }, brokerTurn: null,
    driveLib: () => {}, googleLib: () => ({ ON: true }),
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
