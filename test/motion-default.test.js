const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const D = require('../defaults.js');
const source = fs.readFileSync(require.resolve('../lib/background.js'), 'utf8');

// The real migration and install listener; unrelated worker services do nothing in this fixture.
const worker = (stored = {}, faults = {}) => {
  const start = source.indexOf('const motionExpressive = '), end = source.indexOf('\nchrome.runtime.onStartup', start);
  assert.ok(start >= 0 && end > start, 'the update migration is registered in the worker');
  const installed = [], writes = [];
  const context = vm.createContext({ GZ_DEFAULTS: D.GZ_DEFAULTS, console, brokerTurn: null,
    GZ_CARDS: { queue: () => (fn) => Promise.resolve().then(fn) },
    tabsAuto: async () => {}, keepWidgets: async () => {}, serial: (fn) => Promise.resolve().then(fn), ensure: async () => {},
    sweepMedia() {}, moveChannelKeys: async () => {}, perSite: async () => {}, pointerToLook() {}, lightUp: async () => {}, firstRun() {}, catalogue() {},
    chrome: { runtime: { onInstalled: { addListener: (fn) => installed.push(fn) } }, storage: { sync: {
      get: async (keys) => {
        if (faults.get) throw Error('storage read failed');
        return structuredClone(Object.fromEntries(keys.filter((k) => Object.hasOwn(stored, k)).map((k) => [k, stored[k]])));
      },
      set: async (patch) => {
        if (faults.set) throw Error('storage write failed');
        writes.push(structuredClone(patch)); Object.assign(stored, structuredClone(patch));
      },
    } } },
  });
  vm.runInContext(source.slice(start, end), context);
  return { writes, install: async (reason) => { installed.forEach((fn) => fn({ reason })); for (let i = 0; i < 20; i++) await new Promise(setImmediate); } };
};

test('Expressive is the default, with reduced motion still respected and all three levels selectable', () => {
  assert.equal(D.GZ_DEFAULTS.motion.level, 'expressive');
  assert.equal(D.GZ_DEFAULTS.motion.followSystem, true);
  for (const motion of [undefined, {}, { enter: false }, { level: 'invalid' }])
    assert.equal(D.GZ_SANITIZE({ motion }).motion.level, 'expressive');
  for (const level of ['off', 'subtle', 'expressive']) assert.equal(D.GZ_SANITIZE({ motion: { level } }).motion.level, level);
  assert.equal(D.GZ_SANITIZE({ motion: { enter: false, hover: false, transitions: false } }).motion.level, 'off');
});

test('the next install or update upgrades stored Subtle once and preserves the other motion switches', async () => {
  for (const reason of ['install', 'update']) {
    const stored = { motion: { level: 'subtle', followSystem: true, enter: false, hover: true, transitions: false } };
    const w = worker(stored);
    await w.install(reason);
    assert.deepEqual(stored.motion, { level: 'expressive', followSystem: true, enter: false, hover: true, transitions: false });
    assert.equal(stored.motionExpressiveMigrated, true);
    stored.motion.level = 'subtle'; // an explicit choice after the new default
    await w.install('update');
    await worker(stored).install('update'); // another worker or a device sharing sync
    assert.equal(stored.motion.level, 'subtle');
    assert.equal(w.writes.length, 1);
  }
});

test('an explicit Off setting is never re-enabled on install, update or worker restart', async () => {
  for (const reason of ['install', 'update']) {
    const motion = { level: 'off', followSystem: false, enter: true, hover: true, transitions: true };
    const stored = { motion: { ...motion } };
    await worker(stored).install(reason);
    await worker(stored).install('update');
    assert.deepEqual(stored.motion, motion);
    assert.equal(stored.motionExpressiveMigrated, true);
  }
});

test('legacy switches preserve fully disabled motion while enabled legacy profiles get Expressive', async () => {
  for (const on of [false, true]) {
    const stored = { motion: { enter: on, hover: false, transitions: false, followSystem: true } };
    await worker(stored).install('update');
    assert.equal(stored.motion.level, on ? 'expressive' : 'off');
    assert.equal(stored.motion.enter, on);
    assert.equal(stored.motion.followSystem, true);
  }
});

test('a fresh install uses the schema default without writing over unseen synced motion preferences', async () => {
  const stored = {}, w = worker(stored);
  await w.install('browser_update');
  assert.deepEqual(stored, {});
  await w.install('install');
  assert.equal(stored.motion, undefined);
  assert.equal(stored.motionExpressiveMigrated, true);
  stored.motion = { level: 'off' }; // late sync, or a choice after install
  await worker(stored).install('update');
  assert.equal(stored.motion.level, 'off');
});

test('failed storage reads or writes leave migration retryable and preserve the original setting', async () => {
  for (const failure of ['get', 'set']) {
    const stored = { motion: { level: 'subtle', hover: false } }, faults = { [failure]: true };
    const w = worker(stored, faults);
    await w.install('update');
    assert.equal(stored.motion.level, 'subtle');
    assert.equal(stored.motionExpressiveMigrated, undefined);
    faults[failure] = false;
    await w.install('update');
    assert.equal(stored.motion.level, 'expressive');
    assert.equal(stored.motion.hover, false);
    assert.equal(stored.motionExpressiveMigrated, true);
  }
});
