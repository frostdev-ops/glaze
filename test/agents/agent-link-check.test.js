const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../../checks/agents/agent-link-check.js'), 'utf8');

test('T9 does not force the optional-grant worker to restart', () => {
  assert.ok(!/ServiceWorker\.stop|runtime\.reload\(/.test(source), 'a forced restart cannot prove the idle restart decision');
});

test('T9 waits for SIGKILL to finish before releasing an owned process', async () => {
  const proc = { exitCode: null, signalCode: null, kill: (sig) => { if (sig === 'SIGKILL') killing = true; } };
  const owned = { procs: new Set([proc]) };
  let killing = false, ticks = 0;
  const context = { owned, processGroup: () => [], sameProcess: () => false,
    sleep: async () => { if (killing && ++ticks === 3) proc.signalCode = 'SIGKILL'; },
  };
  vm.runInNewContext(source.slice(source.indexOf('async function stop(proc)'), source.indexOf('// ---- agents')), context);
  await context.stop(proc);
  assert.equal(proc.signalCode, 'SIGKILL', 'wait for the exit after escalation');
  assert.equal(owned.procs.has(proc), false);
});

test('T9 retains a context when closing it fails so final cleanup can retry', async () => {
  const failure = Error('browser close failed');
  const context = { close: async () => { throw failure; } };
  const owned = { contexts: new Set([context]) };
  const start = source.indexOf('const close = async');
  const close = vm.runInNewContext(`${source.slice(start, source.indexOf('\nconst config', start))}\nclose`, { owned });
  await assert.rejects(close(context), failure);
  assert.equal(owned.contexts.has(context), true);
});

test('T9 stops a surviving browser helper after its parent has exited', async () => {
  const child = { pid: 42, live: true }, signals = [];
  const proc = { exitCode: 0, signalCode: null, kill: () => assert.fail('parent has exited') };
  const owned = { procs: new Set([proc]) };
  const context = { owned, processGroup: () => [child], sameProcess: (p) => p.live, sleep: async () => {},
    process: { kill: (pid, sig) => { signals.push([pid, sig]); if (sig === 'SIGKILL') child.live = false; } },
  };
  vm.runInNewContext(source.slice(source.indexOf('async function stop(proc)'), source.indexOf('// ---- agents')), context);
  await context.stop(proc);
  assert.deepEqual(signals, [[42, 'SIGTERM'], [42, 'SIGKILL']]);
  assert.equal(child.live, false);
  assert.equal(owned.procs.has(proc), false);
});

test('T9 cleans up on SIGINT and SIGTERM as well as exceptions', () => {
  for (const signal of ['SIGINT', 'SIGTERM']) assert.ok(new RegExp(`['"]${signal}['"]`).test(source), signal);
  assert.match(source, /process\.once\(signal,/, 'route interruption through the same cleanup as a failed phase');
});

test('T9 step 1 fails a setup whose launcher names no Node.js, as hosted runners got from v4.0.1 on', () => {
  const L = require('../../mcp/lib/launcher.js'), IDS = require('../../mcp/lib/ids.js');
  const start = source.indexOf('const installed = ');
  assert.ok(start > 0, 'step 1 judges setup through installed()');
  const installed = vm.runInNewContext(`${source.slice(start, source.indexOf('\nfunction setup()', start))}\ninstalled`, { L, IDS, path, VERSION: '9.9.9' });
  const id = 'jmmaeoajomodnbnlmdikjooalmcilooh', root = '/home/u/.local/share/glaze-mcp', script = path.join(root, '9.9.9', 'bin', 'glaze-mcp.js');
  const manifest = { allowed_origins: [IDS.origin(id)] };
  const run = (node) => installed({ code: 0, manifest, launcher: L.sh({ node, script, browser: 'chromium' }) }, id, root);
  assert.equal(run('/usr/local/glaze-ci/bin/node'), true);
  assert.equal(run(null), false);
});
