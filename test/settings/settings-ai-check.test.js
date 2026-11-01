// The Settings browser check must block actual network access even if routing misses a worker request.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { createRequire } = require('node:module');
const { GZ_SANITIZE, GZ_ACTIVE_COLORS, GZ_PRESET } = require('../../extension/content/defaults.js');

test('the Settings check launches offline, including loopback and service-worker requests', async () => {
  const file = path.join(__dirname, '../../checks/settings/settings-ai-check.js'), req = createRequire(file);
  let capture;
  const launched = new Promise((resolve) => { capture = resolve; });
  const fakeFS = { ...fs, mkdirSync() {}, writeFileSync() {}, rmSync() {}, mkdtempSync: () => '/synthetic/settings-check' };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    __dirname: path.dirname(file), process: { argv: [], env: { AI_SCHEME: 'light' }, pid: 0 },
    console: { log() {}, error() {} }, setTimeout,
    require: (id) => id === 'playwright' ? { chromium: { launchPersistentContext: async (_, options) => { capture(options); throw Error('synthetic stop before launch'); } } }
      : id === 'node:fs' ? fakeFS : id === '../../tools/dev/wait-for-browser.js' ? async () => {}
        : id === '../../tools/dev/check-env.js' ? { lockPath: () => '/synthetic/lock', staged: () => '/synthetic/extension', chromeLaunch: () => ({}) } : req(id),
  });
  const options = await launched;
  assert.ok(options.args.includes('--proxy-server=http://127.0.0.1:0'), 'unrouted network requests must reach a dead proxy');
  assert.ok(options.args.includes('--proxy-bypass-list=<-loopback>'), 'loopback must not bypass the proxy');
  assert.ok(options.args.includes('--host-resolver-rules=MAP * ~NOTFOUND'), 'DNS is denied too');
  assert.ok(options.args.includes('--disable-quic'));
});

for (const scheme of ['light', 'dark']) test(`the isolated Glaze check paints the ${scheme} Look before inspecting the card`, { timeout: 1000 }, async () => {
  const file = path.join(__dirname, '../../checks/settings/settings-ai-check.js'), req = createRequire(file);
  const sync = {}, local = {};
  const area = (data) => ({ get: async () => ({ ...data }), set: async (patch) => Object.assign(data, patch) });
  const chrome = { storage: { sync: area(sync), local: area(local) } };
  const pageContext = vm.createContext({ chrome, GZ_SANITIZE });
  let painted, inspected = 0, finish;
  const errors = [];
  const done = new Promise((resolve) => { finish = resolve; });
  const page = {
    setDefaultTimeout() {}, on() {},
    goto: async (url) => { if (url.includes('options.html')) painted = GZ_ACTIVE_COLORS(GZ_SANITIZE(sync), scheme === 'dark'); },
    evaluate: async (fn, arg) => { pageContext.arg = arg; return vm.runInContext(`(${fn})(arg)`, pageContext); },
    locator: () => ({
      waitFor: async () => {},
      click: async () => { inspected++; throw Error('synthetic stop at the first card inspection'); },
    }),
  };
  const context = { serviceWorkers: () => [{ url: () => 'chrome-extension://synthetic/background.js' }], route: async () => {}, newPage: async () => page, close: async () => {} };
  const fakeFS = { ...fs, mkdirSync() {}, writeFileSync() {}, rmSync() {}, mkdtempSync: () => '/synthetic/settings-check' };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    __dirname: path.dirname(file), URL, process: { argv: [], env: { AI_CASE: 'glaze', AI_SCHEME: scheme }, pid: 0 },
    console: { log: () => finish(), error: (e) => { errors.push(String(e)); finish(); } }, setTimeout: (fn) => setTimeout(fn, 0),
    require: (id) => id === 'playwright' ? { chromium: { launchPersistentContext: async () => context } }
      : id === 'node:fs' ? fakeFS : id === '../../tools/dev/wait-for-browser.js' ? async () => {}
        : id === '../../tools/dev/check-env.js' ? { lockPath: () => '/synthetic/lock', staged: () => '/synthetic/extension', chromeLaunch: () => ({}), noFirstRun() {} } : req(id),
  });
  await done;
  assert.equal(inspected, 1, `the isolated Glaze scenario reached its first card interaction: ${errors.join('\n')}`);
  assert.deepEqual(painted, GZ_PRESET(scheme === 'dark' ? 'Frost' : 'Paper'), 'the page uses the requested Look, even when migration is skipped');
});
