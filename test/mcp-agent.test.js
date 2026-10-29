// glaze-mcp agent mode (mcp/lib/agent.js): started by an app on stdio, between it and a real host played over the native
// codec (helpers/mcp-pipe.cjs); and the doctor's live check, with the launcher check from the native-messaging spike.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { PassThrough, Readable } = require('node:stream');

const R = require('../mcp/lib/rendezvous.js');
const F = require('../mcp/lib/agent-frames.js');
const A = require('../mcp/lib/agent.js');
const B = require('../mcp/lib/browsers.js');
const I = require('../mcp/lib/install.js');
const D = require('../mcp/lib/doctor.js');
const CLI = require('../mcp/bin/glaze-mcp.js');
const { PKG, BIN, FIREFOX, scratch, hmac, until, envFor, runDir, browser, opened, lineFrom } = require('./helpers/mcp-pipe.cjs');

const POSIX = process.platform !== 'win32';
const MiB = 1024 * 1024;
const nodeVersion = async () => ({ stdout: 'v22.11.0\n', stderr: '' });
const deadPid = () => spawnSync(process.execPath, ['-e', '0']).pid;

// The app's side of one agent: its stdin, what comes out on stdout and stderr, and its exit.
const app = (t, home, args = [], env = {}) => {
  const p = spawn(process.execPath, [BIN, ...args], { env: envFor(home, env), stdio: ['pipe', 'pipe', 'pipe'] });
  let out = Buffer.alloc(0), err = '', exit = null;
  p.stdout.on('data', (c) => { out = Buffer.concat([out, c]); });
  p.stderr.on('data', (c) => { err += c; });
  p.stdin.on('error', () => {});
  const exited = new Promise((r) => p.on('exit', (code) => r((exit = { code, at: Date.now() }))));
  t.after(() => { if (!exit) p.kill('SIGKILL'); return exited; });
  return { p, exited, out: () => out, err: () => err, write: (s) => p.stdin.write(s), end: () => p.stdin.end() };
};

test('the agent waits for a host, holding what the app sends, then passes it on in order', async (t) => {
  const home = scratch(t);
  const a = app(t, home);
  const big = `{"big":"${'é'.repeat(100000)}"}`;
  a.write('{"id":1}\n');
  a.write(`${big}\n`);
  a.write('{"id":2}\n');
  await until('it says it waits', () => /waiting/i.test(a.err()));
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(a.out().length, 0);
  const b = browser(t, home);
  await b.start();
  const o = await opened(b);
  assert.equal(o.c, 1);
  assert.equal(o.peer.ppid, process.pid, 'the app that started it');
  assert.equal(o.peer.verified, false);
  if (process.platform === 'linux') assert.equal(o.peer.exe, fs.realpathSync(process.execPath));
  if (process.platform === 'darwin' && /^[\w.-]+$/.test(process.env.__CFBundleIdentifier || '')) assert.equal(o.peer.exe, process.env.__CFBundleIdentifier);
  assert.equal(await lineFrom(b, 1), '{"id":1}');
  assert.equal(await lineFrom(b, 1), big);
  assert.equal(await lineFrom(b, 1), '{"id":2}');
  a.end();
  assert.equal((await a.exited).code, 0);
});

test('the agent holds exactly 1 MiB of stdin until it has a host, and loses none of it', async (t) => {
  const home = scratch(t);
  // A plain Readable: what the agent hasn't taken is exactly its readableLength.
  const stdin = new Readable({ read() {} }), stdout = new PassThrough(), err = [];
  t.after(() => stdin.destroy());
  let code = null;
  const run = A.main({ args: [], io: { stdin, stdout, stderr: { write: (s) => err.push(s) }, env: envFor(home), exit: (c) => { code = c; } } });
  const chunk = Buffer.alloc(MiB, 'a');
  chunk[chunk.length - 1] = 10;
  stdin.push(chunk);
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(stdin.readableLength, 0);
  const b = browser(t, home);
  await b.start();
  await opened(b);
  assert.equal(await lineFrom(b, 1), 'a'.repeat(MiB - 1));
  stdin.push(null);
  assert.equal(await run, 0);
  assert.equal(code, 0);
  assert.match(err.join(''), /waiting/i);
});

test('stdin EOF at the 1 MiB waiting limit still exits 0 promptly', async (t) => {
  const a = app(t, scratch(t));
  a.write(Buffer.alloc(MiB, 'a'));
  a.end();
  await until('exit after a full waiting buffer and EOF', () => a.p.exitCode !== null, 1000);
  assert.equal((await a.exited).code, 0);
  assert.equal(a.out().length, 0);
});

test('waiting input over 1 MiB is refused promptly without forwarding a partial request', async (t) => {
  // Test both many ordinary pipe reads and a single oversized Readable chunk.
  const a = app(t, scratch(t));
  a.write(Buffer.alloc(MiB + 1, 'a'));
  await until('exit after overflowing the waiting buffer', () => a.p.exitCode !== null, 1000);
  assert.equal((await a.exited).code, 1);
  assert.match(a.err(), /1 MiB.*before.*host/i);
  assert.equal(a.out().length, 0);

  const stdin = new Readable({ read() {} }), stdout = new PassThrough(), err = [];
  t.after(() => stdin.destroy());
  const run = A.main({ io: { stdin, stdout, stderr: { write: (s) => err.push(s) }, env: envFor(scratch(t)), exit() {} } });
  stdin.push(Buffer.alloc(2 * MiB, 'a'));
  let code;
  run.then((c) => { code = c; });
  await until('oversized chunk refused', () => code !== undefined, 1000);
  assert.equal(code, 1);
  assert.match(err.join(''), /1 MiB.*before.*host/i);
  assert.equal(stdout.readableLength, 0);
});

test('stdin EOF cancels an in-flight handshake and closes its socket', async (t) => {
  const home = scratch(t), dir = R.ready(runDir(home)), sockets = new Set();
  let hello = false;
  const server = net.createServer((s) => {
    sockets.add(s);
    s.on('error', () => {});
    s.on('data', () => { hello = true; });
    s.on('close', () => sockets.delete(s));
  });
  const sock = R.socketPath(dir, 'chrome', 'pending');
  await R.listen(server, sock);
  t.after(() => { for (const s of sockets) s.destroy(); server.close(); });
  R.write(dir, { v: 1, pid: process.pid, path: sock, token: R.token(), browser: 'chrome', instance: 'pending', at: Date.now() });
  const stdin = new PassThrough();
  t.after(() => stdin.destroy());
  const run = A.main({ io: { stdin, stdout: new PassThrough(), stderr: { write() {} }, env: envFor(home), exit() {} } });
  await until('handshake sent', () => hello);
  stdin.end();
  assert.equal(await run, 0);
  await until('pending handshake socket closed after EOF', () => sockets.size === 0, 500);
});

test('lines go through untouched both ways, and stdout carries only the worker\'s lines', async (t) => {
  const home = scratch(t);
  const b = browser(t, home);
  await b.start();
  const a = app(t, home);
  await opened(b);
  const lines = [
    '{"jsonrpc":"2.0","id":1,"method":"server/discover","params":{"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28"}}}',
    '{"x":"\u2028 é😀 \\r"}\r',
    `{"big":"${'中'.repeat(MiB)}"}`,
  ];
  a.write(lines.map((l) => `${l}\n`).join(''));
  for (const l of lines) assert.equal(await lineFrom(b, 1), l);
  const back = ['{"jsonrpc":"2.0","id":1,"result":{}}', `{"r":"${'😀'.repeat(400000)}"}`];
  for (const l of back) for (const f of F.split(1, l)) b.send(f);
  const want = Buffer.from(back.map((l) => `${l}\n`).join(''));
  await until('both lines out', () => a.out().length >= want.length);
  await new Promise((r) => setTimeout(r, 50));
  assert.ok(a.out().equals(want));
  assert.match(a.err(), /connected/i);
  a.end();
  assert.equal((await a.exited).code, 0);
});

test('the agent exits 1 when its connection closes or the host goes, and 0 when stdin ends', async (t) => {
  const home = scratch(t);
  const b = browser(t, home);
  await b.start();
  const one = app(t, home);
  const o1 = await opened(b);
  b.send({ t: 'close', c: o1.c, why: 'off' });
  assert.equal((await one.exited).code, 1);
  assert.match(one.err(), /closed/i);
  // What the app sent just before closing stdin still arrives, and the worker hears the close.
  const two = app(t, home);
  const o2 = await opened(b);
  two.write('{"id":"last"}\n');
  two.end();
  assert.equal((await two.exited).code, 0);
  assert.equal(await lineFrom(b, o2.c), '{"id":"last"}');
  assert.deepEqual(await b.take('close', (f) => f.t === 'close' && f.c === o2.c), { t: 'close', c: o2.c, why: 'eof' });
  const three = app(t, home);
  await opened(b);
  b.send({ t: 'bye' });
  assert.equal((await three.exited).code, 1);
  // Before there is any host.
  const four = app(t, scratch(t));
  await until('it waits', () => /waiting/i.test(four.err()));
  const at = Date.now();
  four.end();
  const { code, at: done } = await four.exited;
  assert.equal(code, 0);
  assert.ok(done - at < 1000, `exited after ${done - at} ms`);
});

test('the agent takes the newest host unless told which, and names the others', async (t) => {
  const home = scratch(t);
  const chrome = browser(t, home);
  await chrome.start('chromeinst');
  await new Promise((r) => setTimeout(r, 20));
  const fox = browser(t, home, FIREFOX);
  await fox.start('foxinst');
  const opens = () => [...chrome.left((f) => f.t === 'open'), ...fox.left((f) => f.t === 'open')];
  const pick = async (args, env, b) => {
    const a = app(t, home, args, env);
    await opened(b);
    a.end();
    assert.equal((await a.exited).code, 0);
    assert.deepEqual(opens(), [], `${args.join(' ')}: only that host`);
    return a;
  };
  const newest = await pick([], {}, fox);
  assert.match(newest.err(), /firefox/);
  assert.match(newest.err(), /also.*chrome.*chromeinst/i);
  await pick(['--browser', 'chrome'], {}, chrome);
  await pick(['agent', '--instance=chromeinst'], {}, chrome);
  await pick([], { GLAZE_MCP_BROWSER: 'chrome' }, chrome);
  await pick(['--browser=firefox'], { GLAZE_MCP_BROWSER: 'chrome' }, fox);
  // One that isn't running: it waits, saying what is.
  const none = app(t, home, ['--browser', 'edge']);
  await until('it waits', () => /waiting/i.test(none.err()));
  assert.match(none.err(), /chrome/);
  none.end();
  assert.equal((await none.exited).code, 0);
  assert.deepEqual(opens(), []);
});

test('a stale socket with a live recorded pid keeps waiting until a host replaces it', { skip: !POSIX }, async (t) => {
  const home = scratch(t), dir = R.ready(runDir(home));
  const sock = R.socketPath(dir, 'chrome', 'inst1');
  // Exiting without server.close leaves a socket inode, with no listener.
  const stale = spawnSync(process.execPath, ['-e', "require('node:net').createServer().listen(process.argv[1], () => process.exit(0))", `./${path.basename(sock)}`], { cwd: dir });
  assert.equal(stale.status, 0, stale.stderr.toString());
  assert.ok(fs.lstatSync(sock).isSocket());
  R.write(dir, { v: 1, pid: process.pid, path: sock, token: R.token(), browser: 'chrome', instance: 'inst1', at: Date.now() });
  const a = app(t, home);
  a.write('{"id":"held"}\n');
  await until('waiting after a refused socket connect', () => /waiting/i.test(a.err()));
  assert.equal(a.p.exitCode, null);
  assert.equal(a.out().length, 0);
  const b = browser(t, home);
  await b.start();
  await opened(b);
  assert.equal(await lineFrom(b, 1), '{"id":"held"}');
  a.end();
  assert.equal((await a.exited).code, 0);
});

test('the agent refuses a socket that can\'t prove the token, and the host refuses an agent with the wrong one', async (t) => {
  const home = scratch(t);
  const b = browser(t, home);
  const { rec, file } = await b.start();
  R.write(path.dirname(file), { ...rec, token: R.token() });
  const a = app(t, home);
  a.write('{"id":1}\n');
  assert.equal((await a.exited).code, 1);
  assert.match(a.err(), /refused/i);
  assert.equal(a.out().length, 0);
  assert.deepEqual(b.left((f) => f.t === 'open'), []);
  // A socket that isn't the host's gets the agent's hello and nothing more.
  const home2 = scratch(t), d = R.ready(runDir(home2));
  const p = R.socketPath(d, 'chrome', 'fake'), got = [];
  const server = net.createServer((s) => {
    s.on('error', () => {});
    s.on('data', (c) => got.push(c));
    s.once('data', (c) => { const { n } = JSON.parse(c.toString()); s.write(`${JSON.stringify({ ok: 1, p: hmac(R.token(), `h${n}`) })}\n{"injected":1}\n`); });
  });
  await R.listen(server, p);
  t.after(() => server.close());
  R.write(d, { v: 1, pid: process.pid, path: p, token: R.token(), browser: 'chrome', instance: 'fake', at: Date.now() });
  const f = app(t, home2);
  f.write('{"secret":1}\n');
  assert.equal((await f.exited).code, 1);
  assert.match(f.err(), /prove/);
  const text = Buffer.concat(got).toString();
  assert.equal(text.split('\n').filter(Boolean).length, 1, 'the hello only');
  assert.doesNotMatch(text, /secret/);
  assert.equal(f.out().length, 0, 'nothing of it reaches the app');
});

test('the agent refuses options it doesn\'t know and ids that aren\'t ids', async (t) => {
  const home = scratch(t);
  for (const [args, env] of [[['--frobnicate'], {}], [['--browser'], {}], [['--browser', '../x'], {}], [['--instance', 'a b'], {}],
    [['--browser=chrome', '--browser=edge'], {}], [[], { GLAZE_MCP_BROWSER: 'Not Valid' }]]) {
    const a = app(t, home, args, env);
    assert.equal((await a.exited).code, 2, args.join(' '));
    assert.match(a.err(), /Usage|GLAZE_MCP_BROWSER/, args.join(' '));
    assert.equal(a.out().length, 0);
  }
  assert.equal(fs.existsSync(runDir(home)), false);
});

test('the agent won\'t trust a run folder others can open', { skip: !POSIX }, async (t) => {
  const home = scratch(t);
  fs.mkdirSync(runDir(home), { recursive: true });
  fs.chmodSync(runDir(home), 0o755);
  const a = app(t, home);
  assert.equal((await a.exited).code, 1);
  assert.match(a.err(), /755/);
});

// ---- doctor -----------------------------------------------------------------------------------------------------------
test('doctor\'s live check: a probe each live host answers without the worker hearing of it; stale and silent ones said', async (t) => {
  const home = scratch(t), ctx = { platform: process.platform, env: envFor(home) };
  const none = await A.doctor(ctx);
  assert.deepEqual(none.map((r) => r.level), ['warn']);
  assert.match(none[0].detail, /Settings → Agents/);
  assert.equal(fs.existsSync(runDir(home)), false, 'the check makes nothing');
  const b = browser(t, home);
  const { rec } = await b.start();
  const d = runDir(home);
  R.write(d, { v: 1, pid: deadPid(), path: R.socketPath(d, 'edge', 'gone'), token: R.token(), browser: 'edge', instance: 'gone', at: 1 });
  R.write(d, { v: 1, pid: process.pid, path: R.socketPath(d, 'brave', 'silent'), token: R.token(), browser: 'brave', instance: 'silent', at: 2 });
  const rows = await A.doctor(ctx);
  const row = (re) => rows.find((r) => re.test(r.what));
  assert.equal(row(/chrome/).level, 'ok', JSON.stringify(rows));
  assert.match(row(/chrome/).detail, new RegExp(`${rec.pid}`));
  assert.equal(row(/edge/).level, 'warn');
  assert.match(row(/edge/).detail, /gone/);
  assert.equal(row(/brave/).level, 'fail');
  await new Promise((r) => setTimeout(r, 100));
  assert.deepEqual(b.left((f) => f.t === 'open' || f.t === 'close'), [], 'a probe never reaches the worker');
  assert.ok(fs.existsSync(R.runFile(d, 'edge', 'gone')), 'the check removes nothing');
});

test('glaze-mcp doctor adds the live rows after its own', { skip: !POSIX }, async (t) => {
  // Only HOME: setup must not follow an XDG_* folder out of the scratch one.
  const home = scratch(t), env = { HOME: home };
  fs.mkdirSync(B.table(process.platform, env).find((b) => b.id === 'chrome').data, { recursive: true });
  const ctx = { platform: process.platform, env, node: process.execPath, run: nodeVersion, src: PKG };
  await I.setup(ctx);
  const b = browser(t, home);
  await b.start();
  const out = [];
  const code = await CLI.main(['doctor'], { ...ctx, stdout: { write: (s) => out.push(s) }, stderr: { write: (s) => out.push(s) } });
  assert.equal(code, 0, out.join(''));
  assert.match(out.join(''), /^ok {3}Live chrome \(inst1\): /m);
});

test('doctor says a missing or relative launcher is what the browser reports as "not found"', async (t) => {
  const home = scratch(t);
  fs.mkdirSync(path.join(home, 'Library', 'Application Support', 'Google', 'Chrome'), { recursive: true });
  const ctx = { platform: 'darwin', env: { HOME: home }, node: process.execPath, run: nodeVersion, src: PKG };
  await I.setup(ctx);
  const launcher = path.join(home, 'Library', 'Application Support', 'glaze-mcp', 'hosts', 'chrome');
  const manifest = path.join(home, 'Library', 'Application Support', 'Google', 'Chrome', 'NativeMessagingHosts', 'io.frostdev.glaze_mcp.json');
  const fails = async () => (await D.run(ctx)).rows.filter((r) => r.level === 'fail' && r.what === 'Google Chrome').map((r) => r.detail);
  fs.rmSync(launcher);
  const missing = await fails();
  assert.equal(missing.length, 1, missing.join('\n'));
  assert.ok(missing[0].includes(launcher), missing[0]);
  assert.match(missing[0], /Specified native messaging host not found\./);
  await I.setup(ctx);
  assert.deepEqual(await fails(), []);
  const m = JSON.parse(fs.readFileSync(manifest, 'utf8'));
  fs.writeFileSync(manifest, JSON.stringify({ ...m, path: path.join('..', '..', '..', 'glaze-mcp', 'hosts', 'chrome') }));
  const relative = await fails();
  assert.equal(relative.length, 1, relative.join('\n'));
  assert.match(relative[0], /relative/);
  assert.match(relative[0], /Specified native messaging host not found\./);
});
