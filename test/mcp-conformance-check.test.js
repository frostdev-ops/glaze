const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), vm = require('node:vm');
const { createRequire } = require('node:module');

const file = path.resolve(__dirname, '../scripts/mcp-conformance-check.js');
const source = fs.readFileSync(file, 'utf8').split("(async () => {\n  fs.mkdirSync(OUT")[0];
const realRequire = createRequire(file);
function harness(t, overrides = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-c17-test-'));
  t.after(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const events = {}, exit = [], calls = [];
  const proc = { ...process, argv: [process.execPath, file, tmp], env: { ...process.env, GLAZE_LOCK: path.join(tmp, 'lock') },
    once: (s, f) => { events[s] = f; }, exit: (s) => exit.push(s), ...overrides.process };
  const context = vm.createContext({ console: { log() {} }, setTimeout, clearTimeout, AbortController, Date, Buffer,
    process: proc, __dirname: path.dirname(file), ...overrides.globals, require: (name) => {
      if (overrides.require) { const got = overrides.require(name, calls); if (got !== undefined) return got; }
      if (name === 'playwright') return { chromium: {} };
      if (name === '../mcp/lib/rendezvous.js') return { dir: () => tmp, list: () => [], alive: () => false };
      return realRequire(name);
    } });
  vm.runInContext(source, context, { filename: file });
  return { tmp, events, exit, calls, run: (s) => vm.runInContext(s, context) };
}
const within = (p, ms = 150) => Promise.race([p, new Promise((resolve) => { const timer = setTimeout(() => resolve('hung'), ms); timer.unref(); })]);

test('a stalled polling predicate has a bound and names the wait in evidence', async (t) => {
  const h = harness(t);
  const result = await within(h.run("until(() => new Promise(() => {}), 15, 1, 'approval focus')"));
  assert.equal(result, null, 'a pending evaluate must not defeat the polling deadline');
  assert.match(h.run('lines.join("\\n")'), /approval focus.*timed out/);
});

test('signal cleanup removes scratch HOME even when the main wait was interrupted', async (t) => {
  const h = harness(t);
  h.run(`scratch = ${JSON.stringify(path.join(h.tmp, 'scratch'))}; HOME = path.join(scratch, 'home'); fs.mkdirSync(HOME, { recursive: true }); interrupted = 'SIGTERM';`);
  await h.run('cleanup()');
  assert.equal(fs.existsSync(path.join(h.tmp, 'scratch')), false);
});

test('cleanup attempts every close and still removes scratch after a close rejects', async (t) => {
  const h = harness(t);
  h.run(`scratch = ${JSON.stringify(path.join(h.tmp, 'scratch'))}; HOME = path.join(scratch, 'home'); fs.mkdirSync(HOME, { recursive: true });
    contexts.add({ close: async () => { throw Error('broken context'); } }); contexts.add({ close: async () => { R.secondClosed = true; } });`);
  await h.run('cleanup()');
  assert.equal(h.run('R.secondClosed'), true);
  assert.equal(fs.existsSync(path.join(h.tmp, 'scratch')), false);
});

test('SDK installation stays in scratch HOME and bounds npm before requiring verified code', (t) => {
  let h;
  const loaded = [];
  h = harness(t, { require: (name, calls) => {
    if (name === 'node:child_process') return { execFileSync: (cmd, args, opts) => {
      calls.push({ cmd, args, opts });
      const dir = args[args.indexOf('--prefix') + 1];
      fs.mkdirSync(path.join(dir, 'node_modules'), { recursive: true });
      const pins = h.run('[...NPM.parsePins(PINS)]');
      const packages = Object.fromEntries(pins.map(([id, integrity]) => {
        const at = id.lastIndexOf('@'), name = id.slice(0, at), version = id.slice(at + 1);
        return ['node_modules/' + name, { version, integrity, resolved: 'https://registry.npmjs.org/' + name }];
      }));
      fs.writeFileSync(path.join(dir, 'node_modules/.package-lock.json'), JSON.stringify({ packages }));
    } };
    if (name === 'node:module') return { createRequire: () => (id) => { loaded.push(id); return {}; } };
  } });
  h.run(`scratch = ${JSON.stringify(h.tmp)}; HOME = path.join(scratch, 'home'); install(path.join(scratch, 'sdk'));`);
  const { args, opts } = h.calls[0];
  assert.ok(args.includes('--ignore-scripts'));
  assert.ok(args.filter((s) => /^@?[^-].*@/.test(s)).every((s) => /@\d+\.\d+\.\d+$/.test(s)));
  assert.equal(opts.env.HOME, path.join(h.tmp, 'home'));
  assert.ok(opts.timeout > 0 && opts.timeout <= 180000, 'npm cannot wait forever');
  assert.deepEqual(loaded, ['@modelcontextprotocol/client', '@modelcontextprotocol/client/stdio']);
});

test('an integrity mismatch stops SDK loading', (t) => {
  let h, loaded = false;
  h = harness(t, { require: (name) => {
    if (name === 'node:child_process') return { execFileSync: (cmd, args) => {
      const dir = args[args.indexOf('--prefix') + 1]; fs.mkdirSync(path.join(dir, 'node_modules'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'node_modules/.package-lock.json'), JSON.stringify({ packages: {
        'node_modules/@modelcontextprotocol/client': { version: '2.4.0', integrity: 'sha512-bad', resolved: 'https://registry.npmjs.org/client' },
      } }));
    } };
    if (name === 'node:module') return { createRequire: () => () => { loaded = true; return {}; } };
  } });
  assert.throws(() => h.run(`install(${JSON.stringify(path.join(h.tmp, 'sdk'))})`), /integrity mismatch/);
  assert.equal(loaded, false);
});

test('the modern wire audit rejects missing resultType and mismatched request metadata', (t) => {
  const h = harness(t);
  h.run(`E.pin = { wire: [
    { dir: 'out', m: { jsonrpc: '2.0', id: 1, method: 'tools/list', params: { _meta: { [PV]: '1900-01-01' } } } },
    { dir: 'in', m: { jsonrpc: '2.0', id: 1, result: { tools: [] } } },
  ] };`);
  h.run('auditWire()');
  const failed = h.run('R.checks.filter((c) => !c.pass).map((c) => c.what).join("\\n")');
  assert.match(failed, /resultType/);
  assert.match(failed, /metadata/);
});

test('subscription acknowledgment must be the first message carrying its id', (t) => {
  const h = harness(t);
  assert.equal(h.run(`acknowledgedFirst({ wire: [
    { dir: 'in', m: { method: 'notifications/tools/list_changed', params: { _meta: { [SUB]: 1 } } } },
    { dir: 'in', m: { method: 'notifications/subscriptions/acknowledged', params: { _meta: { [SUB]: 1 } } } },
  ] }, 1)`), false);
  assert.equal(h.run(`acknowledgedFirst({ wire: [
    { dir: 'in', m: { method: 'notifications/tools/list_changed', params: { _meta: { [SUB]: 2 } } } },
    { dir: 'in', m: { method: 'notifications/subscriptions/acknowledged', params: { _meta: { [SUB]: 1 } } } },
  ] }, 1)`), true);
});


test('an incomplete pinned SDK install is refused before any package loads', (t) => {
  let h, loaded = false;
  h = harness(t, { require: (name) => {
    if (name === 'node:child_process') return { execFileSync: (cmd, args) => {
      const dir = args[args.indexOf('--prefix') + 1]; fs.mkdirSync(path.join(dir, 'node_modules'), { recursive: true });
      const integrity = h.run("NPM.parsePins(PINS).get(SDK)");
      fs.writeFileSync(path.join(dir, 'node_modules/.package-lock.json'), JSON.stringify({ packages: {
        'node_modules/@modelcontextprotocol/client': { version: '2.4.0', integrity, resolved: 'https://registry.npmjs.org/client' },
      } }));
    } };
    if (name === 'node:module') return { createRequire: () => () => { loaded = true; return {}; } };
  } });
  assert.throws(() => h.run(`install(${JSON.stringify(path.join(h.tmp, 'sdk'))})`), /incomplete pinned SDK install/);
  assert.equal(loaded, false, 'NODE_PATH must not supply an unverified missing dependency');
});

test('a stalled client close cannot prevent browser and scratch cleanup', async (t) => {
  const h = harness(t, { globals: { setTimeout: (fn, ms) => setTimeout(fn, Math.min(ms, 10)) } });
  h.run(`scratch = ${JSON.stringify(path.join(h.tmp, 'scratch'))}; HOME = path.join(scratch, 'home'); fs.mkdirSync(HOME, { recursive: true });
    clients.add({ close: () => new Promise(() => {}) }); contexts.add({ close: async () => { R.browserClosed = true; } });`);
  assert.notEqual(await within(h.run('cleanup()')), 'hung');
  assert.equal(h.run('R.browserClosed'), true);
  assert.equal(fs.existsSync(path.join(h.tmp, 'scratch')), false);
  assert.match(h.run('JSON.stringify(R.errors)'), /close agent 0 timed out/);
});

test('cleanup reaps adopted descendants, escalates, and never signals a reused PID', async (t) => {
  const table = new Map(), killed = [];
  const h = harness(t, { globals: { setTimeout: (fn, ms) => setTimeout(fn, Math.min(ms, 10)) },
    process: { platform: 'linux', pid: 9000, kill: (pid, signal) => { killed.push([pid, signal]); if (signal === 'SIGKILL') table.delete(pid); } },
    require: (name) => {
      if (name !== 'node:fs') return;
      return { ...fs, readdirSync: (p, ...args) => p === '/proc' ? [...table.keys()].map(String) : fs.readdirSync(p, ...args),
        readFileSync: (p, ...args) => {
          const m = /^\/proc\/(\d+)\/(stat|cmdline)$/.exec(p);
          if (!m) return fs.readFileSync(p, ...args);
          const rec = table.get(+m[1]); if (!rec) throw Error('gone');
          if (m[2] === 'cmdline') return rec.argv.join('\0');
          const stat = ['S', rec.parent, ...Array(17).fill(0), rec.start];
          return `${m[1]} (node) ${stat.join(' ')}`;
        } };
    } });
  const scratch = path.join(h.tmp, 'scratch');
  table.set(11, { parent: 9000, start: 'original', argv: [path.join(scratch, 'host')] });
  table.set(12, { parent: 11, start: 'child', argv: ['helper'] });
  h.run(`scratch = ${JSON.stringify(scratch)}; HOME = path.join(scratch, 'home'); fs.mkdirSync(HOME, { recursive: true });`);
  // The browser closes the parent; its helper is adopted by init and the parent's PID is reused by an unrelated app.
  h.run('contexts.add({ close: async () => {} })');
  const ctx = h.run('[...contexts][0]');
  ctx.close = async () => { table.set(11, { parent: 1, start: 'reused', argv: ['unrelated'] }); table.get(12).parent = 1; };
  await h.run('cleanup()');
  assert.deepEqual(killed, [[12, 'SIGTERM'], [12, 'SIGKILL']]);
  assert.equal(table.get(11).start, 'reused');
  assert.equal(fs.existsSync(scratch), false);
});

test('the check owns browser signal handling until its cleanup has finished', async (t) => {
  let launch;
  const context = { setDefaultTimeout() {}, route: async () => {}, pages: () => [], on() {}, newPage: async () => ({ goto: async () => {} }) };
  const h = harness(t, { require: (name) => {
    if (name === 'playwright') return { chromium: { launchPersistentContext: async (profile, opts) => { launch = opts; return context; } } };
    if (name === './wait-for-browser.js') return async () => {};
  } });
  h.run(`EXT = { dir: ${JSON.stringify(h.tmp)}, id: 'abcdefghijklmnopabcdefghijklmnop' }; HOME = ${JSON.stringify(h.tmp)};`);
  await h.run("browse('/profile')");
  assert.deepEqual([launch.handleSIGINT, launch.handleSIGTERM, launch.handleSIGHUP], [false, false, false]);
});

test('the ten-minute leg runs only for FULL=1', (t) => {
  for (const [value, expected] of [['0', false], ['false', false], ['', false], ['1', true]]) {
    const h = harness(t, { process: { env: { FULL: value } } });
    assert.equal(h.run('FULL'), expected, `FULL=${value}`);
  }
});
