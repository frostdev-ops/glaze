const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');
const { EventEmitter } = require('node:events');

const file = path.join(process.env.EXT || path.join(__dirname, '..'), 'scripts/agent-link-firefox-check.mjs');
const source = fs.readFileSync(file, 'utf8');
const section = (from, to) => {
  const start = source.indexOf(from), end = source.indexOf(to, start);
  assert.ok(start >= 0 && end > start, `${from} ... ${to}`);
  return source.slice(start, end);
};

// Evaluate the check's definitions only. Every path, process and clock belongs to this fixture.
const harness = (t, overrides = {}) => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-firefox-unit-'));
  t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  const home = path.join(scratch, 'owner');
  fs.mkdirSync(home);
  const bin = path.join(scratch, 'firefox');
  fs.writeFileSync(bin, '');
  const signals = [], table = new Map();
  let now = 0;
  const proc = {
    platform: 'darwin', pid: 123456, execPath: '/check/node',
    env: { FIREFOX: bin }, argv: ['node', file, path.join(scratch, 'out')],
    kill(pid, signal) {
      if (!table.has(pid)) throw Object.assign(new Error('gone'), { code: 'ESRCH' });
      if (signal !== 0) { signals.push([pid, signal]); table.delete(pid); }
    },
    exit: (code) => { throw new Error(`unexpected exit ${code}`); },
  };
  const execFileSync = (_, args) => {
    if (args.includes('-p')) return table.get(Number(args[args.indexOf('-p') + 1]))?.command || '';
    return [...table].map(([pid, p]) => `${pid} ${p.ppid} Wed Oct 29 22:48:00 2026 ${p.command}`).join('\n');
  };
  const context = vm.createContext({
    fs, os: { homedir: () => home, tmpdir: () => scratch }, path, net: {},
    process: proc, fileURLToPath: () => file, createRequire: () => require, execFileSync,
    console: { log() {}, error() {} }, setTimeout, clearTimeout,
    Date: class extends Date { static now() { return now; } },
    ...overrides,
  });
  const definitions = source.slice(source.indexOf('const require = '), source.indexOf("process.on('exit'"))
    .replaceAll('import.meta.url', JSON.stringify(pathToFileURL(file).href));
  const api = vm.runInContext(`${definitions}\n({ writeManifest, removeManifest, cleanup, isHelper, made, R, failed,
    MANIFEST, HOSTS, HELPER, NAME, tmp, setFirefox: (p) => { ff = p; } })`, context);
  // Let cleanup deadlines advance without waiting several real seconds.
  context.setTimeout = (fn, ms) => { now += ms; return setTimeout(fn, 0); };
  return { ...api, context, home, table, signals };
};

test('T10 removes a partially written manifest and the directories it created', async (t) => {
  const h = harness(t);
  h.context.fs = { ...fs, writeFileSync: (target, data, opts) => {
    fs.writeFileSync(target, data.slice(0, 5), opts);
    throw Object.assign(new Error('disk full'), { code: 'ENOSPC' });
  } };
  assert.throws(() => h.writeManifest(['glaze@frostdev.io']), /disk full/);
  assert.ok(fs.existsSync(h.MANIFEST), 'the write created a partial file');
  await h.cleanup();
  assert.equal(fs.existsSync(h.MANIFEST), false, 'partial manifests must be owned before writing');
  for (const dir of h.made) assert.equal(fs.existsSync(dir), false, `remove ${dir}`);
});

test('T10 preserves an existing check manifest and the installed host', async (t) => {
  const h = harness(t);
  fs.mkdirSync(h.HOSTS, { recursive: true });
  const real = path.join(h.HOSTS, 'io.frostdev.glaze_mcp.json');
  fs.writeFileSync(real, 'installed host');
  fs.writeFileSync(h.MANIFEST, 'somebody else');
  assert.throws(() => h.writeManifest(['glaze@frostdev.io']), /EEXIST/);
  await h.cleanup();
  assert.equal(fs.readFileSync(real, 'utf8'), 'installed host');
  assert.equal(fs.readFileSync(h.MANIFEST, 'utf8'), 'somebody else');
});

test('T10 does not mistake another host process for this run after PID reuse', (t) => {
  const h = harness(t);
  h.table.set(71, { ppid: 1, command: `/check/node ${h.HELPER} host --browser=firefox /other/host.json glaze@frostdev.io` });
  assert.equal(h.isHelper(71), false);
  h.table.set(71, { ppid: 1, command: `/check/node ${h.HELPER} host --browser=firefox ${h.MANIFEST} glaze@frostdev.io` });
  assert.equal(h.isHelper(71), true);
});

test('T10 cleanup waits for Firefox descendants and tries graceful shutdown first', async (t) => {
  const h = harness(t), ff = new EventEmitter();
  ff.pid = 41; ff.exitCode = null; ff.signalCode = null;
  ff.kill = (signal) => {
    h.signals.push([ff.pid, signal]);
    h.table.delete(ff.pid);
    ff.signalCode = signal;
    ff.emit('exit', null, signal);
  };
  h.table.set(41, { ppid: 123456, command: `firefox --headless --no-remote --profile ${h.tmp}/profile` });
  h.table.set(42, { ppid: 41, command: 'Firefox child' });
  h.table.set(43, { ppid: 1, command: 'owner Firefox' });
  h.setFirefox(ff);
  await h.cleanup();
  assert.equal(h.signals[0][1], 'SIGTERM');
  assert.equal(h.table.has(42), false, 'a Firefox child outliving its parent must be reaped');
  assert.equal(h.table.has(43), true, 'preserve unrelated Firefox');
  assert.equal(fs.existsSync(h.tmp), false);
});

test('T10 SIGTERM saves evidence and exits only after asynchronous cleanup', async () => {
  const handlers = {}, events = [];
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  vm.runInNewContext(section("process.on('exit'", 'const watchdog ='), {
    process: { on: (name, fn) => { handlers[name] = fn; }, exit: (code) => events.push(`exit ${code}`) },
    cleanup: async () => { events.push('cleanup'); await gate; },
    save: () => events.push('save'), failed: [], clearTimeout() {}, watchdog: 1,
  });
  handlers.SIGTERM();
  assert.deepEqual(events, ['cleanup']);
  release();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, ['cleanup', 'save', 'exit 143']);
});

test('T10 still owns a child that execs after Firefox exits', async (t) => {
  const h = harness(t), ff = new EventEmitter();
  ff.pid = 41; ff.exitCode = null; ff.signalCode = null;
  ff.kill = () => {
    h.table.delete(41); ff.signalCode = 'SIGTERM';
    h.table.set(42, { ppid: 1, command: 'Firefox child after exec' });
  };
  h.table.set(41, { ppid: 123456, command: `firefox --profile ${h.tmp}/profile` });
  h.table.set(42, { ppid: 41, command: 'Firefox child before exec' });
  h.setFirefox(ff);
  await h.cleanup();
  assert.equal(h.table.has(42), false, 'exec changes the command, not ownership of the process');
});

const claims = async (code, values) => {
  const failures = [];
  await vm.runInNewContext(`(async () => { ${code} })()`, {
    R: {}, IDLE: 60000, TIMEOUT: 3000, PAGE: 'page', Date: { now: () => 60000 },
    tally: () => ({}), restarts: () => [],
    ok: (v, label) => { if (!v) failures.push(label); },
    ...values,
  });
  return failures;
};

test('T10 fails if Firefox ignored the configured 3000 ms idle timeout', async () => {
  const log = Array.from({ length: 20 }, () => ({ ev: 'background-script-reset-idle', reason: 'nativeapp', at: 3000 }));
  const failures = await claims(section('  const page2 = ', '  const list = '), {
    b: { inChrome: async () => ({ state: 'running', child: 7, timeout: 30000, nativePorts: true, log }) },
    mark: 0, idleFrom: 0, page0: { child: 7 },
  });
  assert.ok(failures.length, 'logging the actual timeout does not assert it');
});

test('T10 control must end stopped, with no native port, at the configured timeout', async () => {
  const failures = await claims(section('  const before = (await b.inChrome(PAGE)).log.length;', '  // 3. What the port says'), {
    b: { inChrome: async () => ({ log: [] }), close: async () => {} }, c: 'settings',
    config: async () => ({ link: { state: 'off' } }), started: () => [{ pid: 1 }, { pid: 2 }],
    runFiles: () => [], alive: () => false,
    until: async (_, label) => label.includes('event page') ? { state: 'running', nativePorts: true, timeout: 30000, log: [{ ev: 'shutdown-background-script' }] } : true,
  });
  assert.ok(failures.length, 'a shutdown log followed by a restart is not a stopped control');
});

test('T10 checks the exact Firefox disconnect error after killing the host', async () => {
  const code = section("  ok(exited.state === 'exited'", '  ok(back.state');
  const failures = await claims(code, { exited: { state: 'exited', error: 'some unexpected regression' } });
  assert.ok(failures.length, 'an exited state alone does not prove the browser error');
});
