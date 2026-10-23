const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');

// Exercise the real check's startup and failure cleanup without launching a browser.
const run = async (lock) => {
  let launches = 0, locked = false;
  const errors = [], proc = { argv: ['node', 'pointer-check.js'], pid: process.pid, exitCode: 0 };
  const dir = path.resolve(__dirname, '../scripts');
  const context = vm.createContext({
    __dirname: dir, process: proc, URL, setTimeout,
    console: { log() {}, error: (e) => errors.push(String(e)) },
    require: (name) => {
      if (name === 'playwright') return { chromium: { launchPersistentContext: async () => {
        launches++;
        locked = fs.existsSync(path.join(lock, 'owner'));
        throw new Error('synthetic launch failure');
      } } };
      if (name === './check-env.js') return { lockPath: () => lock, chromeLaunch: () => ({}), staged: (src) => src };
      if (name === './wait-for-browser.js') return async () => {};
      return require(name.startsWith('.') ? path.resolve(dir, name) : name);
    },
  });
  vm.runInContext(fs.readFileSync(path.join(dir, 'pointer-check.js'), 'utf8'), context);
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r));
  return { launches, locked, errors, proc };
};

test('pointer check refuses a held heavy lock and preserves its owner', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-pointer-lock-test-')), lock = path.join(tmp, 'lock');
  try {
    fs.mkdirSync(lock);
    fs.writeFileSync(path.join(lock, 'owner'), 'another check');
    const r = await run(lock);
    assert.equal(r.launches, 0, 'checking running processes alone cannot serialize simultaneous launches');
    assert.equal(fs.readFileSync(path.join(lock, 'owner'), 'utf8'), 'another check');
    assert.equal(r.proc.exitCode, 1);
    assert.match(r.errors.join(' '), /EEXIST/);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('pointer check holds the heavy lock at launch and releases it after failure', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-pointer-lock-test-')), lock = path.join(tmp, 'lock');
  try {
    const r = await run(lock);
    assert.equal(r.launches, 1);
    assert.equal(r.locked, true);
    assert.equal(fs.existsSync(lock), false);
    assert.equal(r.proc.exitCode, 1);
    assert.match(r.errors.join(' '), /synthetic launch failure/);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});
