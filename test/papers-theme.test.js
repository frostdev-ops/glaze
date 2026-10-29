// Documents' palette follows the newest storage read, including a refusal after a live settings change.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const theme = async () => {
  const raw = fs.readFileSync(path.join(__dirname, '..', 'papers.js'), 'utf8');
  const body = raw.slice(raw.indexOf('  const theme = async () => {'), raw.indexOf('  theme().catch'));
  const pending = [], events = {}, errors = [], root = { style: {}, toggleAttribute() {} };
  const ctx = vm.createContext({ document: { documentElement: root }, console: { error: (e) => errors.push(e) },
    matchMedia: () => ({ matches: false, addEventListener: (k, fn) => { events.scheme = fn; } }),
    GZ_WRITER_PAPER: { need: async () => {} }, GZ_SANITIZE: (x) => x, GZ_UI: { paint: (x) => { root.style.colorScheme = x.scheme; } },
    chrome: { storage: { sync: { get: () => new Promise((resolve, reject) => pending.push({ resolve, reject })) }, onChanged: { addListener: (fn) => { events.storage = fn; } } } } });
  const loading = vm.runInContext(`${body}\ntheme()`, ctx);
  await new Promise(setImmediate);
  return { loading, pending, events, errors, root };
};

test('an older theme read never repaints over a newer settings change', async () => {
  const r = await theme();
  const changed = r.events.storage({}, 'sync');
  r.pending[1].resolve({ scheme: 'dark' }); await changed; await new Promise(setImmediate);
  r.pending[0].resolve({ scheme: 'light' }); await r.loading;
  assert.equal(r.root.style.colorScheme, 'dark');
});

test('live theme storage failures are handled by the listener', async () => {
  const r = await theme(); r.pending[0].resolve({ scheme: 'light' }); await r.loading;
  const changed = r.events.scheme(); r.pending[1].reject(Error('storage refused'));
  await assert.doesNotReject(Promise.resolve(changed));
  assert.equal(r.errors.length, 1);
  assert.equal(r.root.style.colorScheme, 'light');
});
