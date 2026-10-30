const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');

// Exercise the check's real launch sequence without running the download/restore scenario. The extension page can be
// usable, and its worker installed, while Settings' news or preview write is still in flight.
const source = fs.readFileSync(path.join(__dirname, '../scripts/backup-check.js'), 'utf8');
const origin = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop', version = '4.0.0';
const navKey = `navbarSeen:${origin}`;
const ready = () => ({ freshDefaults: { fresh: true, pending: false }, migrated: ['tabs-auto'], channelKeysMoved: true, lookCatalog: { sig: 'e3b0c442', looks: [] },
  newsSeen: version, [navKey]: [{ id: 'course', label: 'Courses', path: '/ultra/course' }] });
const harness = (local, expired = false) => {
  const pageContext = vm.createContext({ location: { origin }, chrome: {
    storage: { local: { get: async (keys) => structuredClone(Object.fromEntries(keys.filter((k) => k in local).map((k) => [k, local[k]]))) } },
    runtime: { getManifest: () => ({ version }) },
  } });
  const page = { setDefaultTimeout() {}, goto: async () => {}, waitForFunction: async () => {},
    evaluate: (fn, arg) => vm.runInContext(`(${fn})`, pageContext)(structuredClone(arg)) };
  const context = { route: async () => {}, serviceWorkers: () => [{ url: () => `${origin}/lib/background.js` }],
    newPage: async () => page, pages: () => [], on() {} };
  let clock = 0;
  const sandbox = vm.createContext({ require: (name) => name === 'playwright' ? { chromium: { launchPersistentContext: async () => context } }
    : name === './wait-for-browser.js' ? async () => {} : name === './check-env.js' ? require('../scripts/check-env.js') : require(name),
    __dirname: path.join(__dirname, '../scripts'), process: { argv: [], env: {} }, URL, setTimeout,
    Date: expired ? { now: () => clock++ ? 10001 : 0 } : Date });
  vm.runInContext(source.slice(0, source.indexOf('\n(async () => {')) + '\nglobalThis.launch = launch;', sandbox);
  return sandbox.launch;
};

test('backup launch accepts a completed install and completed Settings startup', async () => {
  await harness(ready())('/unused-profile');
});

for (const delayed of ['newsSeen', navKey]) test(`backup launch waits for Settings' ${delayed} write after install finishes`, async () => {
  const local = ready(), value = local[delayed];
  delete local[delayed];
  let returned = false;
  const pending = harness(local)('/unused-profile').then(() => { returned = true; });
  try {
    await new Promise(setImmediate);
    assert.equal(returned, false, 'neither seeding nor a no-change snapshot may race the page write');
  } finally {
    local[delayed] = value;
    await pending;
  }
  assert.equal(returned, true, 'the completed page write releases launch');
});

test('backup launch reports a Settings startup write that never completes', async () => {
  const local = ready();
  delete local.newsSeen;
  await assert.rejects(harness(local, true)('/unused-profile'), /Settings.*newsSeen/);
});
