const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

test('Ultra native card check enables its school and keeps the native page visible', async () => {
  const script = path.join(__dirname, '../scripts/ultra-cards-check.js'), req = createRequire(script);
  const stop = new Error('fixture ready'), local = {}, sync = {};
  const page = { goto: async () => {}, setViewportSize: async () => {}, evaluate: (fn, arg) => fn(arg),
    waitForFunction: async () => {
      assert.deepEqual(Array.from(local.ultra || []), ['https://bb.school.test'], 'enable the invented Ultra site before waiting for its theme');
      assert.equal(sync.navbar?.on, false, 'the check measures the native Courses page');
      throw stop;
    } };
  const chrome = { storage: { local: { set: async (s) => Object.assign(local, s) }, sync: { clear: async () => {}, set: async (s) => Object.assign(sync, s) } } };
  const ctx = { route: async () => {}, newPage: async () => page, close: async () => {} };
  const result = vm.runInNewContext(fs.readFileSync(script, 'utf8'), {
    __dirname: path.dirname(script), console: { log() {} }, chrome,
    process: { env: {}, argv: ['node', script, '/unused'] },
    require: (id) => id === './wait-for-browser.js' ? async () => {}
      : id === 'playwright' ? { chromium: { launchPersistentContext: async (profile, options) => { assert.equal(options.headless, true); return ctx; } } }
      : id === 'fs' ? { ...fs, mkdirSync() {}, mkdtempSync: () => '/unused', rmSync() {} } : req(id),
  });
  await assert.rejects(result, (e) => e === stop);
});
