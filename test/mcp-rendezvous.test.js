// Where the glaze-mcp host and agent meet (mcp/lib/rendezvous.js), the first line each sends (handshake.js) and what the
// agent says about the app that started it (peer.js). Every run gets a scratch folder; the HMACs are worked out here
// with node:crypto, apart from the code.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const R = require('../mcp/lib/rendezvous.js');
const H = require('../mcp/lib/handshake.js');
const P = require('../mcp/lib/peer.js');

const POSIX = process.platform !== 'win32';
const scratch = (t) => {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-mcp-rv-')));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  return d;
};
const mode = (f) => fs.statSync(f).mode & 0o777;
const hmac = (token, msg) => crypto.createHmac('sha256', Buffer.from(token, 'base64')).update(msg).digest('base64');
const deadPid = () => spawnSync(process.execPath, ['-e', '0']).pid;
const runDir = (t) => R.ready(R.dir({ platform: process.platform, env: { HOME: scratch(t), LOCALAPPDATA: scratch(t) } }));
const record = (d, over = {}) => {
  const browser = over.browser || 'chrome', instance = over.instance || 'inst1';
  return { v: 1, pid: process.pid, path: R.socketPath(d, browser, instance), token: R.token(), browser, instance, at: Date.now(), ...over };
};

// A listening server and a connected client over the run folder, for the handshake.
const pair = async (t, d, onConn) => {
  const p = R.socketPath(d, 'chrome', 'hs'), open = new Set();
  const server = net.createServer((s) => { open.add(s); s.on('error', () => {}); onConn(s); });
  await R.listen(server, p);
  t.after(() => { for (const s of open) s.destroy(); server.close(); });
  return () => { const c = R.connect(p); open.add(c); c.on('error', () => {}); return c; };
};
const bytesFrom = (sock) => { const got = []; sock.on('data', (c) => got.push(c)); return () => Buffer.concat(got); };
const closed = (sock) => new Promise((r) => (sock.destroyed ? r() : sock.once('close', r)));

// ---- the run folder ---------------------------------------------------------------------------------------------------
test('the run folder per OS', () => {
  assert.equal(R.dir({ platform: 'darwin', env: { HOME: '/Users/s' } }), path.join('/Users/s', 'Library', 'Application Support', 'glaze-mcp', 'run'));
  assert.equal(R.dir({ platform: 'linux', env: { HOME: '/home/s' } }), path.join('/home/s', '.local', 'state', 'glaze-mcp', 'run'));
  const local = POSIX ? '/c/Users/s/AppData/Local' : 'C:\\Users\\s\\AppData\\Local';
  assert.equal(R.dir({ platform: 'win32', env: { LOCALAPPDATA: local } }), path.join(local, 'glaze-mcp', 'run'));
  for (const [platform, env] of [['darwin', {}], ['linux', { HOME: 'relative' }], ['win32', { HOME: '/home/s' }]]) {
    assert.throws(() => R.dir({ platform, env }), /not set/, platform);
  }
});

test('ready makes the folder 0700 and is idempotent', (t) => {
  const home = scratch(t);
  const d = R.dir({ platform: process.platform, env: { HOME: home, LOCALAPPDATA: home } });
  assert.equal(R.check(d), false, 'missing');
  assert.equal(R.ready(d), d);
  assert.equal(R.ready(d), d);
  assert.equal(R.check(d), true);
  assert.ok(fs.lstatSync(d).isDirectory());
  if (POSIX) assert.equal(mode(d), 0o700);
});

test('ready refuses a symlink, a file, a folder others can open, and another user\'s folder', { skip: !POSIX }, async (t) => {
  const make = (t, how) => {
    const home = scratch(t), d = R.dir({ platform: process.platform, env: { HOME: home } });
    fs.mkdirSync(path.dirname(d), { recursive: true });
    how(d);
    return d;
  };
  await t.test('symlink', (t) => {
    const elsewhere = scratch(t);
    fs.chmodSync(elsewhere, 0o700);
    const d = make(t, (d) => fs.symlinkSync(elsewhere, d, 'dir'));
    assert.throws(() => R.ready(d), (e) => e.code === 'unsafe' && /symlink/.test(e.message));
    assert.throws(() => R.check(d), /symlink/);
  });
  await t.test('file', (t) => {
    const d = make(t, (d) => fs.writeFileSync(d, ''));
    assert.throws(() => R.ready(d), (e) => e.code === 'unsafe' && /not a folder/.test(e.message));
  });
  await t.test('mode 755', (t) => {
    const d = make(t, (d) => { fs.mkdirSync(d); fs.chmodSync(d, 0o755); });
    assert.throws(() => R.ready(d), (e) => e.code === 'unsafe' && /755/.test(e.message));
    assert.equal(mode(d), 0o755, 'left as it was');
  });
  await t.test('another user', (t) => {
    const d = make(t, (d) => fs.mkdirSync(d, { mode: 0o700 }));
    assert.throws(() => R.ready(d, { uid: process.getuid() + 1 }), (e) => e.code === 'unsafe' && /another user/.test(e.message));
  });
});

// ---- names and addresses ----------------------------------------------------------------------------------------------
test('socket and run file names: <browser>.<instance>, and only safe ids', (t) => {
  const d = runDir(t);
  assert.equal(R.socketPath('/r', 'chrome', 'a-B_9', { platform: 'darwin' }), path.join('/r', 'chrome.a-B_9.sock'));
  assert.equal(R.runFile('/r', 'edge-beta', 'x'), path.join('/r', 'edge-beta.x.json'));
  const pipe = R.socketPath(d, 'chrome', 'x', { platform: 'win32' });
  assert.match(pipe, /^\\\\\.\\pipe\\glaze-mcp-[0-9a-f]{32}$/);
  assert.notEqual(pipe, R.socketPath(d, 'chrome', 'x', { platform: 'win32' }), '128 random bits each time');
  for (const [b, i] of [['../x', 'a'], ['Chrome', 'a'], ['chrome', '../a'], ['chrome', 'a.b'], ['chrome', ''], ['chrome', 'a'.repeat(65)], ['chrome', 'a/b'], ['', 'a']]) {
    assert.throws(() => R.socketPath(d, b, i, { platform: 'darwin' }), /not a/, `${b} ${i}`);
    assert.throws(() => R.runFile(d, b, i), /not a/, `${b} ${i}`);
  }
});

test('a socket path past 103 bytes is bound and reached from inside its folder', { skip: !POSIX }, async (t) => {
  let d = scratch(t);
  while (Buffer.byteLength(path.join(d, 'chrome.inst.sock')) < 120) d = path.join(d, 'deeper-folder');
  fs.mkdirSync(d, { recursive: true, mode: 0o700 });
  const p = path.join(d, 'chrome.inst.sock');
  const cwd = process.cwd();
  const server = net.createServer((s) => s.end('hi\n'));
  await R.listen(server, p);
  t.after(() => server.close());
  assert.equal(process.cwd(), cwd, 'the working folder is put back');
  assert.ok(fs.lstatSync(p).isSocket());
  const c = R.connect(p);
  assert.equal(process.cwd(), cwd);
  const got = bytesFrom(c);
  await closed(c);
  assert.equal(got().toString(), 'hi\n');
});

// ---- the run file -----------------------------------------------------------------------------------------------------
test('the run file is written whole at 0600 and holds {v, pid, path, token, browser, instance, at}', (t) => {
  const d = runDir(t);
  const rec = record(d);
  const file = R.write(d, rec);
  assert.equal(file, path.join(d, 'chrome.inst1.json'));
  assert.deepEqual(fs.readdirSync(d), ['chrome.inst1.json'], 'no temporary file left');
  if (POSIX) assert.equal(mode(file), 0o600);
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(Object.keys(saved).sort(), ['at', 'browser', 'instance', 'path', 'pid', 'token', 'v']);
  assert.deepEqual(saved, rec);
  assert.equal(Buffer.from(saved.token, 'base64').length, 32);
  assert.notEqual(R.token(), R.token());
  assert.deepEqual(R.read(file), rec);
  // A second write replaces it whole.
  const next = { ...rec, token: R.token(), at: rec.at + 1 };
  R.write(d, next);
  assert.deepEqual(R.read(file), next);
});

test('read refuses a run file that doesn\'t fit its name or its folder', (t) => {
  const d = runDir(t);
  const rec = record(d);
  const file = R.write(d, rec);
  const bad = {
    'another version': { ...rec, v: 2 },
    'a short token': { ...rec, token: crypto.randomBytes(16).toString('base64') },
    'no pid': { ...rec, pid: 0 },
    'another browser': { ...rec, browser: 'edge' },
    'another instance': { ...rec, instance: 'inst2' },
    'a socket elsewhere': { ...rec, path: POSIX ? '/tmp/x.sock' : '\\\\.\\pipe\\other' },
    'no time': { ...rec, at: 'now' },
  };
  for (const [name, r] of Object.entries(bad)) {
    fs.writeFileSync(file, JSON.stringify(r));
    assert.equal(R.read(file), null, name);
  }
  fs.writeFileSync(file, '{"v":1,');
  assert.equal(R.read(file), null, 'not JSON');
  assert.equal(R.read(path.join(d, 'missing.json')), null);
});

test('list: run files newest first, each with whether its host still runs', (t) => {
  const d = runDir(t);
  R.write(d, record(d, { instance: 'old', at: 1000 }));
  R.write(d, record(d, { browser: 'firefox', instance: 'new', at: 2000 }));
  R.write(d, record(d, { browser: 'edge', instance: 'gone', at: 3000, pid: deadPid() }));
  fs.writeFileSync(path.join(d, 'notes.txt'), 'mine');
  const got = R.list(d).map((e) => [e.rec.browser, e.rec.instance, e.alive]);
  assert.deepEqual(got, [['edge', 'gone', false], ['firefox', 'new', true], ['chrome', 'old', true]]);
  assert.deepEqual(R.list(path.join(d, 'nowhere')), []);
});

test('sweep removes run files whose host is gone, with their sockets, and leaves the rest', (t) => {
  const d = runDir(t);
  const dead = deadPid();
  const live = R.write(d, record(d, { instance: 'live' }));
  const gone = R.write(d, record(d, { instance: 'gone', pid: dead }));
  const junk = path.join(d, 'chrome.junk.json');
  fs.writeFileSync(junk, 'not json');
  const newer = path.join(d, 'chrome.newer.json');
  fs.writeFileSync(newer, JSON.stringify({ v: 2, pid: process.pid }));
  const tmpDead = path.join(d, `chrome.x.json.${dead}.abcd.tmp`), tmpLive = path.join(d, `chrome.y.json.${process.pid}.abcd.tmp`);
  fs.writeFileSync(tmpDead, '');
  fs.writeFileSync(tmpLive, '');
  const notes = path.join(d, 'notes.txt');
  fs.writeFileSync(notes, 'mine');
  // The socket of a host that went without cleaning up: bound by a process that then exited.
  const sock = path.join(d, 'chrome.gone.sock');
  if (POSIX) {
    const rv = JSON.stringify(require.resolve('../mcp/lib/rendezvous.js'));
    const r = spawnSync(process.execPath, ['-e', `require(${rv}).listen(require('net').createServer(), ${JSON.stringify(sock)}).then(() => process.exit(0))`]);
    assert.equal(r.status, 0, String(r.stderr));
    assert.ok(fs.lstatSync(sock).isSocket());
  }
  const removed = R.sweep(d);
  assert.deepEqual(removed.sort(), [gone, junk, tmpDead, ...(POSIX ? [sock] : [])].sort());
  for (const f of [live, newer, tmpLive, notes]) assert.ok(fs.existsSync(f), f);
  for (const f of removed) assert.equal(fs.existsSync(f), false, f);
});

test('remove takes only a host\'s own files, not those of a host that took over its name', { skip: !POSIX }, async (t) => {
  const d = runDir(t);
  const p = R.socketPath(d, 'chrome', 'same');
  const first = net.createServer();
  t.after(() => first.close());
  await R.listen(first, p);
  const mine = { ...record(d, { instance: 'same' }), ino: fs.lstatSync(p).ino };
  R.write(d, record(d, { instance: 'same', token: mine.token }));
  // A second host must leave the live host reachable. Only its owner clears the name.
  assert.throws(() => R.claim(p), (e) => e.code === 'unsafe');
  R.remove(d, mine);
  await new Promise((resolve) => first.close(resolve));
  const second = net.createServer();
  await R.listen(second, p);
  const theirs = record(d, { instance: 'same' });
  R.write(d, theirs);
  R.remove(d, mine);
  assert.ok(fs.existsSync(p), 'their socket stays');
  assert.deepEqual(R.read(R.runFile(d, 'chrome', 'same')), theirs);
  R.remove(d, { ...theirs, ino: fs.lstatSync(p).ino });
  assert.deepEqual(fs.readdirSync(d), []);
  second.close();
  // claim refuses to clear anything but a socket.
  fs.writeFileSync(p, 'x');
  assert.throws(() => R.claim(p), (e) => e.code === 'unsafe');
});

test('run operations refuse a folder replaced by a symlink after check', { skip: !POSIX }, (t) => {
  const d = runDir(t), outside = scratch(t), saved = `${d}-saved`;
  const rec = record(d), file = R.write(d, rec);
  assert.equal(R.check(d), true);
  fs.renameSync(d, saved);
  fs.symlinkSync(outside, d, 'dir');
  for (const op of [() => R.write(d, rec), () => R.read(file), () => R.list(d), () => R.sweep(d),
    () => R.remove(d, rec), () => R.claim(rec.path)]) {
    assert.throws(op, (e) => e.code === 'unsafe');
  }
  assert.deepEqual(fs.readdirSync(outside), []);
});

test('a folder swap during write cannot redirect the token', { skip: !POSIX }, (t) => {
  const d = runDir(t), outside = scratch(t), saved = `${d}-saved`, rec = record(d);
  const open = fs.openSync;
  let swapped = false;
  fs.openSync = function (file, ...args) {
    if (!swapped && String(file).endsWith('.tmp')) {
      swapped = true;
      fs.renameSync(d, saved);
      fs.symlinkSync(outside, d, 'dir');
    }
    return open.call(this, file, ...args);
  };
  try { R.write(d, rec); } catch (e) { assert.equal(e.code, 'unsafe'); }
  finally { fs.openSync = open; }
  assert.equal(swapped, true);
  assert.deepEqual(fs.readdirSync(outside), [], 'the token never enters the replacement folder');
});

test('read refuses symlinks and nonprivate run files', { skip: !POSIX }, (t) => {
  const d = runDir(t), rec = record(d), file = R.runFile(d, rec.browser, rec.instance);
  const elsewhere = path.join(scratch(t), 'record');
  fs.writeFileSync(elsewhere, JSON.stringify(rec), { mode: 0o600 });
  fs.symlinkSync(elsewhere, file);
  assert.equal(R.read(file), null);
  fs.unlinkSync(file);
  fs.writeFileSync(file, JSON.stringify(rec), { mode: 0o644 });
  assert.equal(R.read(file), null);
});

test('a failed atomic write removes its temporary file and preserves the record', (t) => {
  const d = runDir(t), rec = record(d);
  R.write(d, rec);
  const write = fs.writeFileSync;
  fs.writeFileSync = function (file, ...args) {
    if (typeof file === 'number') throw Object.assign(new Error('disk full'), { code: 'ENOSPC' });
    return write.call(this, file, ...args);
  };
  try { assert.throws(() => R.write(d, { ...rec, token: R.token() }), (e) => e.code === 'ENOSPC'); }
  finally { fs.writeFileSync = write; }
  assert.deepEqual(fs.readdirSync(d), ['chrome.inst1.json']);
  assert.deepEqual(R.read(R.runFile(d, 'chrome', 'inst1')), rec);
});

test('sweep leaves an unrecorded live socket alone', { skip: !POSIX }, async (t) => {
  const d = runDir(t), p = R.socketPath(d, 'chrome', 'junk');
  const server = net.createServer((s) => s.end());
  await R.listen(server, p);
  t.after(() => server.close());
  fs.writeFileSync(R.runFile(d, 'chrome', 'junk'), 'not json', { mode: 0o600 });
  R.sweep(d);
  assert.ok(fs.existsSync(p), 'no dead host record authorizes deleting this socket');
  const c = R.connect(p);
  c.on('error', () => {});
  c.resume();
  await closed(c);
});

test('sweep cannot delete a live record published during its stale check', (t) => {
  const d = runDir(t), dead = deadPid(), stale = record(d, { pid: dead });
  const file = R.write(d, stale), live = { ...stale, pid: process.pid, token: R.token() };
  const kill = process.kill;
  let writer;
  process.kill = function (pid, signal) {
    if (pid === dead && !writer) {
      const code = `const R=require(${JSON.stringify(require.resolve('../mcp/lib/rendezvous.js'))});try{R.write(${JSON.stringify(d)},${JSON.stringify(live)})}catch(e){process.stderr.write(e.code);process.exitCode=1}`;
      writer = spawnSync(process.execPath, ['-e', code]);
    }
    return kill.call(this, pid, signal);
  };
  try { R.sweep(d); } finally { process.kill = kill; }
  assert.ok(writer);
  if (writer.status === 0) assert.deepEqual(R.read(file), live, 'a published live record survives');
  else { assert.equal(writer.stderr.toString(), 'EBUSY'); assert.equal(fs.existsSync(file), false); }
});

test('the longest permitted socket basename is never truncated, including on Node 18', { skip: !POSIX }, async (t) => {
  const d = path.join(scratch(t), 'é'.repeat(40));
  fs.mkdirSync(d, { mode: 0o700 });
  const p = R.socketPath(d, 'b'.repeat(32), 'i'.repeat(64));
  const server = net.createServer((s) => s.end('exact'));
  await R.listen(server, p);
  t.after(() => server.close());
  assert.deepEqual(fs.readdirSync(d), [path.basename(p)]);
  const c = R.connect(p), got = bytesFrom(c);
  c.on('error', () => {});
  await closed(c);
  assert.equal(got().toString(), 'exact');
});

// ---- the handshake ----------------------------------------------------------------------------------------------------
test('handshake: the agent proves the token, the host proves it back, and bytes after the answer are the caller\'s', async (t) => {
  const d = runDir(t), token = R.token();
  let hostSide;
  const seen = new Promise((resolve) => {
    hostSide = async (s) => {
      const got = await H.accept(s, token);
      s.write('{"jsonrpc":"2.0"}\n');
      resolve({ got });
    };
  });
  const dial = await pair(t, d, (s) => hostSide(s));
  const c = dial();
  const peer = { name: 'Agent', exe: '/usr/bin/app', ppid: 42, verified: false };
  const { rest } = await H.offer(c, token, peer);
  const { got } = await seen;
  assert.deepEqual(got, { peer: { name: 'Agent', exe: '/usr/bin/app', ppid: 42, verified: false }, probe: false });
  const more = bytesFrom(c);
  c.resume();
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(Buffer.concat([rest, more()]).toString(), '{"jsonrpc":"2.0"}\n');
  c.destroy();
});

test('handshake: the wire format, checked byte for byte', async (t) => {
  const d = runDir(t), token = R.token();
  const lines = [];
  const dial = await pair(t, d, async (s) => {
    try { await H.accept(s, token); } catch { /* the second client */ }
  });
  // An agent written from the format alone.
  const c = dial();
  const n = crypto.randomBytes(16).toString('base64');
  c.write(`${JSON.stringify({ 'glaze-mcp': 1, n, p: hmac(token, `a${n}`), peer: { exe: 'x', bogus: 1, ppid: -1 } })}\n`);
  const got = bytesFrom(c);
  await new Promise((r) => setTimeout(r, 100));
  lines.push(got().toString());
  assert.deepEqual(lines, [`${JSON.stringify({ ok: 1, p: hmac(token, `h${n}`) })}\n`]);
  c.destroy();
  // And a host written from it, for the agent.
  const server = net.createServer((s) => {
    t.after(() => s.destroy());
    const raw = bytesFrom(s);
    setTimeout(() => {
      const hello = JSON.parse(raw().toString().trim());
      assert.deepEqual(Object.keys(hello).sort(), ['glaze-mcp', 'n', 'p', 'peer']);
      assert.equal(hello.p, hmac(token, `a${hello.n}`));
      assert.equal(Buffer.from(hello.n, 'base64').length, 16);
      s.write(`${JSON.stringify({ ok: 1, p: hmac(token, `h${hello.n}`) })}\nafter`);
    }, 50);
  });
  const p2 = path.join(d, 'fake.sock');
  await R.listen(server, POSIX ? p2 : R.socketPath(d, 'chrome', 'fake'));
  t.after(() => server.close());
  const c2 = R.connect(POSIX ? p2 : server.address());
  t.after(() => c2.destroy());
  const { rest } = await H.offer(c2, token, { ppid: 1, verified: false });
  assert.equal(rest.toString(), 'after');
  c2.destroy();
});

test('handshake: a wrong token gets nothing back and no connection', async (t) => {
  const d = runDir(t), token = R.token();
  const results = [];
  const dial = await pair(t, d, (s) => { H.accept(s, token).then(() => results.push('accepted'), (e) => results.push(e.code)); });
  const c = dial();
  const got = bytesFrom(c);
  await assert.rejects(H.offer(c, R.token(), { verified: false }), (e) => e.code === 'closed');
  await closed(c);
  assert.equal(got().length, 0, 'the host wrote nothing');
  assert.deepEqual(results, ['refused']);
});

test('handshake: a host that can\'t prove the token is refused by the agent', async (t) => {
  const d = runDir(t), token = R.token();
  const dial = await pair(t, d, (s) => {
    s.once('data', (b) => {
      const { n } = JSON.parse(b.toString());
      s.write(`${JSON.stringify({ ok: 1, p: hmac(R.token(), `h${n}`) })}\n`);
    });
  });
  await assert.rejects(H.offer(dial(), token, { verified: false }), (e) => e.code === 'refused');
  // Nor is the agent's own proof, echoed back.
  const dial2 = await pair(t, runDir(t), (s) => {
    s.once('data', (b) => { const { p } = JSON.parse(b.toString()); s.write(`${JSON.stringify({ ok: 1, p })}\n`); });
  });
  await assert.rejects(H.offer(dial2(), token, { verified: false }), (e) => e.code === 'refused');
});

test('handshake: bytes past the hello, a hello too long, or none in time are refused, with nothing written', async (t) => {
  const d = runDir(t), token = R.token();
  const outcomes = [];
  const dial = await pair(t, d, (s) => { H.accept(s, token, { timeout: 300 }).then(() => outcomes.push('accepted'), (e) => outcomes.push(e.code)); });
  const hello = (n = 'bm9uY2Vub25jZW5vbmNl') => `${JSON.stringify({ 'glaze-mcp': 1, n, p: hmac(token, `a${n}`), peer: {} })}\n`;
  const cases = [
    ['extra', (c) => c.write(`${hello()}{"jsonrpc":"2.0"}\n`), 'refused'],
    ['long', (c) => c.write('x'.repeat(H.HELLO + 1)), 'too-long'],
    ['silent', () => {}, 'timeout'],
    ['not json', (c) => c.write('hello\n'), 'refused'],
    ['another version', (c) => c.write(hello().replace('"glaze-mcp":1', '"glaze-mcp":2')), 'refused'],
  ];
  for (const [name, send, want] of cases) {
    const c = dial();
    const got = bytesFrom(c);
    send(c);
    await closed(c);
    assert.equal(got().length, 0, name);
    assert.equal(outcomes.pop(), want, name);
  }
  // And the agent's own wait for an answer has a timeout.
  const quiet = await pair(t, runDir(t), () => {});
  await assert.rejects(H.offer(quiet(), token, { verified: false }, { timeout: 200 }), (e) => e.code === 'timeout');
});

test('handshake: a probe is accepted as such, and the peer is cut down to what the host passes on', async (t) => {
  const d = runDir(t), token = R.token();
  let got;
  const dial = await pair(t, d, async (s) => { got = await H.accept(s, token); });
  const c = dial();
  await H.offer(c, token, { name: 'n'.repeat(5000), exe: 7, ppid: 1.5, verified: true, extra: 'x' }, { probe: true });
  await new Promise((r) => setTimeout(r, 20));
  assert.deepEqual(got, { peer: { verified: false }, probe: true });
  c.destroy();
});

test('handshake: proofs are compared in constant time', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'mcp', 'lib', 'handshake.js'), 'utf8').replace(/^\s*\/\/.*$/gm, '');
  assert.match(src, /timingSafeEqual\(/);
  assert.equal(H.mac('AAAA', 'a', 'n'), hmac('AAAA', 'an'));
  assert.equal(H.same('abc', 'abc'), true);
  assert.equal(H.same('abc', 'abd'), false);
  assert.equal(H.same('abc', 'abcd'), false);
  assert.equal(H.same(undefined, 'abc'), false);
});

// ---- peer -------------------------------------------------------------------------------------------------------------
test('peer: Linux reads the parent\'s program from /proc', () => {
  const asked = [];
  const readlink = (p) => { asked.push(p); return '/usr/lib/claude/claude (deleted)'; };
  assert.deepEqual(P.self({ platform: 'linux', env: {}, ppid: 321, readlink }), { exe: '/usr/lib/claude/claude', ppid: 321, verified: false });
  assert.deepEqual(asked, ['/proc/321/exe']);
  const denied = () => { throw Object.assign(new Error('EACCES'), { code: 'EACCES' }); };
  assert.deepEqual(P.self({ platform: 'linux', env: {}, ppid: 321, readlink: denied }), { ppid: 321, verified: false });
  if (process.platform === 'linux') assert.equal(P.self().exe, fs.readlinkSync(`/proc/${process.ppid}/exe`));
});

test('peer: macOS takes the app\'s bundle id from the environment; Windows says nothing', () => {
  const never = () => assert.fail('no file is read');
  assert.deepEqual(P.self({ platform: 'darwin', env: { __CFBundleIdentifier: 'com.anthropic.claudefordesktop' }, ppid: 9, readlink: never }), { exe: 'com.anthropic.claudefordesktop', ppid: 9, verified: false });
  assert.deepEqual(P.self({ platform: 'darwin', env: {}, ppid: 9, readlink: never }), { ppid: 9, verified: false });
  assert.deepEqual(P.self({ platform: 'darwin', env: { __CFBundleIdentifier: 'bad id; rm -rf' }, ppid: 9, readlink: never }), { ppid: 9, verified: false });
  assert.deepEqual(P.self({ platform: 'win32', env: { __CFBundleIdentifier: 'x' }, ppid: 9, readlink: never }), { ppid: 9, verified: false });
  assert.equal(P.self().verified, false);
});
