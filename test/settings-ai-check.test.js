// The Settings browser check must block actual network access even if routing misses a worker request.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { createRequire } = require('node:module');

test('the Settings check launches offline, including loopback and service-worker requests', async () => {
  const file = path.join(__dirname, '../scripts/settings-ai-check.js'), req = createRequire(file);
  let capture;
  const launched = new Promise((resolve) => { capture = resolve; });
  const fakeFS = { ...fs, mkdirSync() {}, writeFileSync() {}, rmSync() {}, mkdtempSync: () => '/synthetic/settings-check' };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    __dirname: path.dirname(file), process: { argv: [], env: { AI_SCHEME: 'light' }, pid: 0 },
    console: { log() {}, error() {} }, setTimeout,
    require: (id) => id === 'playwright' ? { chromium: { launchPersistentContext: async (_, options) => { capture(options); throw Error('synthetic stop before launch'); } } }
      : id === 'node:fs' ? fakeFS : id === './wait-for-browser.js' ? async () => {}
        : id === './check-env.js' ? { lockPath: () => '/synthetic/lock', staged: () => '/synthetic/extension', chromeLaunch: () => ({}) } : req(id),
  });
  const options = await launched;
  assert.ok(options.args.includes('--proxy-server=http://127.0.0.1:0'), 'unrouted network requests must reach a dead proxy');
  assert.ok(options.args.includes('--proxy-bypass-list=<-loopback>'), 'loopback must not bypass the proxy');
  assert.ok(options.args.includes('--host-resolver-rules=MAP * ~NOTFOUND'), 'DNS is denied too');
  assert.ok(options.args.includes('--disable-quic'));
});
