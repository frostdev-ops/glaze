const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const scripts = path.join(__dirname, '../scripts');

test('every browser check waits before launching', () => {
  for (const file of fs.readdirSync(scripts).filter((f) => f.endsWith('-check.js'))) {
    const lines = fs.readFileSync(path.join(scripts, file), 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (/chromium\.launch|launchPersistentContext/.test(line)) {
        const before = lines.slice(Math.max(0, i - 2), i).filter((l) => !l.includes('watchdog ='));
        assert.equal(before.at(-1).trim(), "await require('./wait-for-browser.js')();", file);
      }
    });
  }
});

const waiter = (probe) => {
  const module = { exports: {} }, calls = [];
  vm.runInNewContext(fs.readFileSync(path.join(scripts, 'wait-for-browser.js'), 'utf8'), {
    module, console: { error() {} }, setTimeout: (f) => f(),
    require: (name) => {
      assert.equal(name, 'node:child_process');
      return { execFileSync: (...args) => { calls.push(args); return probe(); } };
    },
  });
  return { wait: module.exports, calls };
};

test('browser wait probes exact process names until the other browsers exit', async () => {
  let probes = 0;
  const { wait, calls } = waiter(() => {
    if (++probes < 3) return '123\n';
    throw Object.assign(new Error('no matches'), { status: 1 });
  });
  await wait();
  assert.equal(probes, 3);
  assert.deepEqual(Array.from(calls[0][1]), ['-x', 'chrome-headless-shell|Chromium|Google Chrome for Testing']);
  assert.equal(calls[0][0], 'pgrep');
});

test('browser wait fails closed if the probe fails or another browser never exits', async () => {
  await assert.rejects(waiter(() => { throw Object.assign(new Error('probe failed'), { status: 2 }); }).wait(), /probe failed/);
  await assert.rejects(waiter(() => '123\n').wait(), /waiting for another browser/);
});

test('browser wait on Windows, which has no pgrep, goes straight on', async () => {
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(scripts, 'wait-for-browser.js'), 'utf8'), {
    module, process: { platform: 'win32' },
    require: () => ({ execFileSync: () => assert.fail('no probe on Windows') }),
  });
  await module.exports();
});

test('the mod channel browser check is available alongside the Mods section check', () => {
  assert.ok(fs.existsSync(path.join(scripts, 'mods-channel-check.js')));
});

test('the blocklist browser check seeds complete installed manifests for the real editor', () => {
  const source = fs.readFileSync(path.join(scripts, 'blocklist-check.js'), 'utf8');
  const fixture = source.slice(source.indexOf('const record = '), source.indexOf('\n(async () =>'));
  const rec = vm.runInNewContext(`${fixture}\nrecord('aaaaaaaaaaaaaaaa')`);
  const files = Object.fromEntries(Object.entries(rec.files || {}).map(([p, b]) => [p, new Uint8Array(Buffer.from(b, 'base64'))]));
  assert.doesNotThrow(() => require('../lib/modbundle.js').clean(rec.manifest, files));
  assert.equal(typeof rec.manifest.author.name, 'string');
});

test('the course background check waits for installation and site registration before opening the LMS', async () => {
  const events = [];
  const storage = Object.fromEntries(['sync', 'local'].map((name) => [name, {
    clear: async () => events.push(`clear:${name}`), set: async () => {},
  }]));
  const opts = { goto: async () => {}, evaluate: (fn, arg) => vm.runInNewContext(`(${fn.toString()})(arg)`, { chrome: { storage }, arg }) };
  const page = { on() {}, goto: async () => events.push('navigate'), locator: () => ({ waitFor: async () => { throw Error('end of bootstrap probe'); } }) };
  let opened = 0;
  const ctx = { route: async () => {}, newPage: async () => ++opened === 1 ? opts : page, close: async () => events.push('closed') };
  const env = { staged: () => '/fixture/extension', chromeLaunch: () => ({}), noFirstRun: () => {},
    installed: async () => { await Promise.resolve(); events.push('installed'); },
    ultraReady: async () => { await Promise.resolve(); events.push('registered'); } };
  await vm.runInNewContext(fs.readFileSync(path.join(scripts, 'ctab-background-check.js'), 'utf8'), {
    process: { env: {}, argv: [] }, __dirname: scripts, console: { log() {}, error() {} }, setTimeout,
    require: (name) => {
      if (name === 'playwright') return { chromium: { launchPersistentContext: async () => ctx } };
      if (name === './check-env.js') return env;
      if (name === './wait-for-browser.js') return async () => {};
      if (name === 'node:fs') return { readFileSync: () => '<html></html>', mkdtempSync: () => '/fixture/profile', rmSync: () => events.push('removed') };
      if (name.endsWith('/defaults.js')) return require('../defaults.js');
      return require(name);
    },
  });
  assert.deepEqual(events, ['installed', 'clear:sync', 'clear:local', 'registered', 'navigate', 'closed', 'removed']);
});
