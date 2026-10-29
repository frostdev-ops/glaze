// The glaze-mcp host (mcp/lib/host.js, mux.js, lines.js), run as the browser runs it: a real process started with
// process.execPath, spoken to over the native codec on its stdin and stdout, with agents written here from the
// handshake's format. Every run gets a scratch HOME (LOCALAPPDATA on Windows) for its run folder.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { EventEmitter } = require('node:events');

const N = require('../mcp/lib/native.js');
const F = require('../mcp/lib/agent-frames.js');
const R = require('../mcp/lib/rendezvous.js');
const L = require('../mcp/lib/lines.js');
const H = require('../mcp/lib/host.js');
const M = require('../mcp/lib/mux.js');

const PKG = path.join(__dirname, '..', 'mcp');
const BIN = path.join(PKG, 'bin', 'glaze-mcp.js');
const VERSION = require('../mcp/package.json').version;
const ORIGIN = 'chrome-extension://jmmaeoajomodnbnlmdikjooalmcilooh/';
const POSIX = process.platform !== 'win32';
const MiB = 1024 * 1024;

const scratch = (t) => {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-mcp-host-')));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  return d;
};
const mode = (f) => fs.statSync(f).mode & 0o777;
const hmac = (token, msg) => crypto.createHmac('sha256', Buffer.from(token, 'base64')).update(msg).digest('base64');
const until = async (what, ok, ms = 10000) => {
  const end = Date.now() + ms;
  for (;;) {
    const v = ok();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 10));
  }
};
const envFor = (home) => ({ ...process.env, HOME: home, LOCALAPPDATA: home });
const runDir = (home) => R.dir({ platform: process.platform, env: envFor(home) });

// The browser's side of one host: frames read off its stdout (each with its native message size), frames written to
// its stdin, and its exit.
const browser = (t, home, args = ['host', '--browser=chrome', ORIGIN]) => {
  const p = spawn(process.execPath, [BIN, ...args], { env: envFor(home), stdio: ['pipe', 'pipe', 'pipe'] });
  const frames = [];
  let raw = Buffer.alloc(0), err = '', exit = null;
  p.stdout.on('data', (c) => {
    raw = Buffer.concat([raw, c]);
    while (raw.length >= 4 && raw.length >= 4 + raw.readUInt32LE(0)) {
      const n = raw.readUInt32LE(0);
      frames.push({ f: JSON.parse(raw.subarray(4, 4 + n).toString('utf8')), n });
      raw = raw.subarray(4 + n);
    }
  });
  p.stderr.on('data', (c) => { err += c; });
  p.stdin.on('error', () => {});
  const exited = new Promise((r) => p.on('exit', (code, signal) => r((exit = { code, signal, at: Date.now() }))));
  t.after(() => { if (!exit) p.kill('SIGKILL'); return exited; });
  // The first frame not yet taken that matches.
  const take = async (what, ok = () => true, ms) => {
    const i = await until(what, () => { const j = frames.findIndex((x) => !x.taken && ok(x.f)); return j < 0 ? 0 : j + 1; }, ms);
    frames[i - 1].taken = true;
    return frames[i - 1].f;
  };
  return {
    p, frames, take, exited,
    err: () => err,
    send: (f) => p.stdin.write(N.encode(f)),
    left: (ok = () => true) => frames.filter((x) => !x.taken && ok(x.f)).map((x) => x.f),
    // hello both ways, then the run file.
    async start(instance = 'inst1') {
      const hello = await take('hello', (f) => f.t === 'hello');
      this.send({ t: 'hello', v: 1, glaze: '4.0.0', instance });
      const file = R.runFile(runDir(home), args.includes('--browser=firefox') ? 'firefox' : 'chrome', instance);
      const rec = await until('the run file', () => R.read(file));
      return { hello, rec, file };
    },
  };
};

// An agent written from the handshake's format alone: { s, lines (got so far), ended }.
const agent = async (rec, { peer = { exe: '/usr/bin/agent', ppid: 7, verified: false }, token = rec.token, read = true } = {}) => {
  const s = R.connect(rec.path);
  const n = crypto.randomBytes(16).toString('base64');
  s.write(`${JSON.stringify({ 'glaze-mcp': 1, n, p: hmac(token, `a${n}`), peer })}\n`);
  const a = { s, bytes: Buffer.alloc(0), ended: false, answer: null };
  s.on('error', () => {});
  s.on('close', () => { a.ended = true; });
  s.on('data', (c) => {
    a.bytes = Buffer.concat([a.bytes, c]);
    if (!a.answer) {
      const i = a.bytes.indexOf(10);
      if (i < 0) return;
      a.answer = JSON.parse(a.bytes.subarray(0, i).toString());
      a.bytes = a.bytes.subarray(i + 1);
      if (!read) s.pause();
    }
  });
  a.lines = () => { const t = a.bytes.toString('utf8'); return t ? t.split('\n').slice(0, -1) : []; };
  await until('the answer', () => a.answer || a.ended);
  if (a.answer) assert.deepEqual(a.answer, { ok: 1, p: hmac(rec.token, `h${n}`) });
  return a;
};
const opened = (b) => b.take('open', (f) => f.t === 'open');
const lineFrames = (b, c, count) => until(`${count} line frames for ${c}`, () => { const got = b.left((f) => f.t === 'line' && f.c === c); return got.length >= count && got; });
// Every frame of one line from the agent on connection c, joined.
const lineFrom = async (b, c) => {
  const j = F.joiner();
  for (;;) {
    const f = await b.take(`a line for ${c}`, (x) => x.t === 'line' && x.c === c);
    const s = j.push(f);
    if (s !== null) return s;
  }
};

// ---- lines.js ---------------------------------------------------------------------------------------------------------
test('lines: cut at "\\n" across any chunking, whole UTF-8, and a line over the limit refused', () => {
  assert.equal(L.LINE, 64 * MiB);
  assert.equal(L.QUEUE, 32 * MiB);
  const text = 'aé😀\r\n\nlast line 中\n';
  const bytes = Buffer.from(text);
  for (const size of [1, 2, 3, 5, bytes.length]) {
    const got = [], push = L.cutter((s) => got.push(s));
    for (let i = 0; i < bytes.length; i += size) push(bytes.subarray(i, i + size));
    assert.deepEqual(got, ['aé😀\r', '', 'last line 中'], `chunks of ${size}`);
  }
  const got = [], push = L.cutter((s) => got.push(s), 4);
  push(Buffer.from('abcd\nab'));
  assert.throws(() => push(Buffer.from('cde\nnext\n')), (e) => e.code === 'too-long');
  assert.deepEqual(got, ['abcd'], 'lines before the long one still come out');
  assert.throws(() => push(Buffer.from('\n')), (e) => e.code === 'too-long', 'and nothing after it');
  const one = [], p2 = L.cutter((s) => one.push(s), 4);
  assert.throws(() => p2(Buffer.from('ok\nabcde\n')), (e) => e.code === 'too-long');
  assert.deepEqual(one, ['ok']);
});

// A socket whose writes drain immediately, or stay queued, without relying on OS buffer sizes.
const socket = ({ stalled = false } = {}) => {
  const s = new EventEmitter();
  s.paused = true;
  s.writableLength = 0;
  s.writes = [];
  s.pause = () => { s.paused = true; };
  s.resume = () => { s.paused = false; };
  s.destroy = () => { s.destroyed = true; };
  s.end = () => { s.ended = true; };
  s.write = (b) => { s.writes.push(b); if (stalled) s.writableLength += b.length; return !stalled; };
  return s;
};

test('mux: a full browser pipe pauses agents even when open or close filled it, then drain resumes them', () => {
  let full = false;
  const mux = M.create({ send: () => !full });
  const one = socket(), two = socket(), three = socket();
  mux.open(one, { verified: false });
  assert.equal(one.paused, false);
  full = true;
  mux.open(two, { verified: false });
  assert.equal(one.paused, true, 'open can fill stdout');
  assert.equal(two.paused, true);
  full = false;
  mux.release();
  assert.equal(one.paused, false);
  assert.equal(two.paused, false);
  full = true;
  one.emit('end');
  assert.equal(two.paused, true, 'close can fill stdout too');
  mux.open(three, { verified: false });
  assert.equal(three.paused, true, 'a newly admitted socket stays paused');
  full = false;
  mux.release();
  assert.equal(three.paused, false);
  mux.end();
});

test('mux: browser output over the queue limit closes the sender, including within one data chunk', () => {
  let pending = 0;
  const frames = [];
  const mux = M.create({ queue: 1024, pending: () => pending, send: (f) => {
    frames.push(f);
    pending += N.encode(f).length;
    return false;
  } });
  const s = socket();
  mux.open(s, { verified: false });
  s.emit('data', Buffer.from(`${'x'.repeat(2 * F.PIECE)}\nlater\n`));
  assert.deepEqual(frames.at(-1), { t: 'close', c: 1, why: 'overflow' });
  assert.equal(frames.filter((f) => f.t === 'line').length, 1, 'stop the current split as soon as it overflows');
  assert.equal(s.destroyed, true);
  assert.equal(mux.size(), 0);
  mux.release();
  s.emit('data', Buffer.from('after close\n'));
  assert.equal(frames.at(-1).t, 'close', 'nothing follows close');
});

test('mux: worker pieces stream immediately, with a per-line byte limit even when the agent drains', () => {
  const frames = [], s = socket();
  const mux = M.create({ line: 4, send: (f) => { frames.push(f); return true; } });
  mux.open(s, { verified: false });
  mux.frame({ t: 'line', c: 1, d: 'é', m: 1 });
  assert.equal(Buffer.concat(s.writes).toString(), 'é', 'do not join worker pieces');
  mux.frame({ t: 'line', c: 1, d: 'é' });
  assert.equal(Buffer.concat(s.writes).toString(), 'éé\n', 'exactly the limit is allowed');
  mux.frame({ t: 'line', c: 1, d: 'abcd', m: 1 });
  mux.frame({ t: 'line', c: 1, d: 'e' });
  assert.deepEqual(frames.at(-1), { t: 'close', c: 1, why: 'too-long' });
  assert.equal(Buffer.concat(s.writes).toString(), 'éé\nabcd', 'the overlong piece is not written');
  assert.equal(s.destroyed, true);
});

// ---- the host ---------------------------------------------------------------------------------------------------------
test('the host says hello first, and opens its socket and run file once the worker gives its instance', async (t) => {
  const home = scratch(t);
  const b = browser(t, home);
  const { hello, rec, file } = await b.start('inst1');
  assert.deepEqual(hello, { t: 'hello', v: 1, host: VERSION, os: process.platform, browser: 'chrome', node: process.version });
  assert.ok(F.valid.toWorker(hello));
  assert.equal(b.frames[0].f, hello, 'nothing before it');
  assert.equal(rec.pid, b.p.pid);
  assert.equal(rec.browser, 'chrome');
  assert.equal(rec.instance, 'inst1');
  if (POSIX) {
    assert.equal(mode(runDir(home)), 0o700);
    assert.equal(mode(file), 0o600);
    assert.equal(mode(rec.path), 0o600);
    assert.ok(fs.lstatSync(rec.path).isSocket());
  }
  assert.deepEqual(b.left(), [], 'nothing more until an agent comes');
});

test('two clients interleaved: each gets its own number and its own lines, both ways', async (t) => {
  const home = scratch(t);
  const b = browser(t, home);
  const { rec } = await b.start();
  const one = await agent(rec, { peer: { name: 'One', exe: '/usr/bin/one', ppid: 11, verified: true } });
  const o1 = await opened(b);
  const two = await agent(rec, { peer: { exe: '/usr/bin/two', bogus: 'x' } });
  const o2 = await opened(b);
  assert.deepEqual(o1, { t: 'open', c: 1, peer: { name: 'One', exe: '/usr/bin/one', ppid: 11, verified: false } });
  assert.deepEqual(o2, { t: 'open', c: 2, peer: { exe: '/usr/bin/two', verified: false } });
  assert.ok(F.valid.toWorker(o1) && F.valid.toWorker(o2));
  // One writes a line a byte at a time; two writes two lines in one go; then one again.
  const l1 = '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{"q":"é😀"}}';
  for (const byte of Buffer.from(`${l1}\n`)) one.s.write(Buffer.from([byte]));
  two.s.write('{"id":"a"}\n{"id":"b"}\n');
  one.s.write('{"id":3}\n');
  assert.equal(await lineFrom(b, 1), l1);
  assert.equal(await lineFrom(b, 1), '{"id":3}');
  assert.equal(await lineFrom(b, 2), '{"id":"a"}');
  assert.equal(await lineFrom(b, 2), '{"id":"b"}');
  // The worker answers in pieces, interleaved.
  b.send({ t: 'line', c: 1, d: '{"id":1,', m: 1 });
  b.send({ t: 'line', c: 2, d: '{"id":"a"}' });
  b.send({ t: 'line', c: 1, d: '"r":"é😀"', m: 1 });
  b.send({ t: 'line', c: 2, d: '{"id":"b"}' });
  b.send({ t: 'line', c: 1, d: '}' });
  await until('both answers', () => one.lines().length === 1 && two.lines().length === 2);
  assert.deepEqual(one.lines(), ['{"id":1,"r":"é😀"}']);
  assert.deepEqual(two.lines(), ['{"id":"a"}', '{"id":"b"}']);
  one.s.destroy();
  two.s.destroy();
});

test('a 3 MiB line goes each way in ordered pieces of at most 1 MB', async (t) => {
  const home = scratch(t);
  const b = browser(t, home);
  const { rec } = await b.start();
  const a = await agent(rec);
  await opened(b);
  const unit = 'abcé中😀"\\';
  const big = `{"d":"${unit.repeat(Math.ceil((3 * MiB) / Buffer.byteLength(unit)))}"}`;
  assert.ok(Buffer.byteLength(big) >= 3 * MiB);
  const bytes = Buffer.from(`${big}\n`);
  for (let i = 0; i < bytes.length; i += 65521) a.s.write(bytes.subarray(i, i + 65521));
  const frames = await until('the whole line', () => {
    const got = b.frames.filter((x) => x.f.t === 'line' && x.f.c === 1);
    return got.length && !got[got.length - 1].f.m && got;
  });
  assert.ok(frames.length > 3);
  frames.forEach(({ f, n }, i) => {
    assert.ok(n <= 1000000, `frame ${i} is ${n} bytes`);
    assert.ok(F.valid.toWorker(f));
    assert.equal(f.m, i < frames.length - 1 ? 1 : undefined);
  });
  assert.equal(frames.map((x) => x.f.d).join(''), big);
  // And back: the worker's pieces, written as they come.
  for (const f of F.split(1, big)) b.send(f);
  await until('the line back', () => a.bytes.length >= bytes.length);
  assert.ok(a.bytes.equals(bytes));
  a.s.destroy();
});

test('closing: the worker\'s close ends one client; a client\'s close reaches the worker; numbers are never reused', async (t) => {
  const home = scratch(t);
  const b = browser(t, home);
  const { rec } = await b.start();
  const one = await agent(rec);
  await opened(b);
  const two = await agent(rec);
  await opened(b);
  b.send({ t: 'line', c: 1, d: '{"last":true}' });
  b.send({ t: 'close', c: 1, why: 'off' });
  await until('one ends', () => one.ended);
  assert.deepEqual(one.lines(), ['{"last":true}'], 'what was sent before the close still arrives');
  // Frames for a closed connection are dropped, and two goes on.
  b.send({ t: 'line', c: 1, d: '{"late":1}' });
  two.s.write('{"id":2}\n');
  assert.equal(await lineFrom(b, 2), '{"id":2}');
  assert.deepEqual(b.left((f) => f.t === 'close'), [], 'no close back for the worker\'s own');
  two.s.end();
  assert.deepEqual(await b.take('close 2', (f) => f.t === 'close'), { t: 'close', c: 2, why: 'eof' });
  const three = await agent(rec);
  assert.deepEqual((await opened(b)).c, 3);
  // A worker line with a raw newline in it would break the agent's framing: the connection closes instead.
  b.send({ t: 'line', c: 3, d: '{"a":1}\n{"b":2}' });
  assert.deepEqual(await b.take('close 3', (f) => f.t === 'close'), { t: 'close', c: 3, why: 'bad-line' });
  await until('three ends', () => three.ended);
  assert.deepEqual(three.lines(), []);
  // A wrong token, or a probe, never reaches the worker.
  const wrong = await agent(rec, { token: R.token() });
  assert.equal(wrong.answer, null);
  assert.equal(wrong.bytes.length, 0);
  const probe = R.connect(rec.path);
  const n = crypto.randomBytes(16).toString('base64');
  probe.write(`${JSON.stringify({ 'glaze-mcp': 1, n, p: hmac(rec.token, `a${n}`), peer: {}, probe: 1 })}\n`);
  let answer = '';
  probe.on('data', (c) => { answer += c; });
  await new Promise((r) => probe.on('close', r));
  assert.deepEqual(JSON.parse(answer), { ok: 1, p: hmac(rec.token, `h${n}`) });
  const four = await agent(rec);
  assert.equal((await opened(b)).c, 4);
  assert.deepEqual(b.left((f) => f.t === 'open'), []);
  four.s.destroy();
  assert.match(b.err(), /refused/);
});

for (const [how, end] of [['the worker\'s bye', (b) => b.send({ t: 'bye' })], ['stdin closing', (b) => b.p.stdin.end()]]) {
  test(`${how} closes every client, removes the socket and run file, and exits 0 within 1 s`, async (t) => {
    const home = scratch(t);
    const b = browser(t, home);
    const { rec, file } = await b.start();
    const one = await agent(rec), two = await agent(rec);
    await opened(b);
    await opened(b);
    const at = Date.now();
    end(b);
    const { code, at: done } = await b.exited;
    assert.equal(code, 0, b.err());
    assert.ok(done - at < 1000, `exited after ${done - at} ms`);
    await until('the clients see it', () => one.ended && two.ended, 2000);
    assert.equal(fs.existsSync(file), false);
    if (POSIX) assert.equal(fs.existsSync(rec.path), false);
    assert.deepEqual(fs.readdirSync(runDir(home)), []);
    assert.deepEqual(b.left((f) => f.t === 'close'), [], 'nothing more to a worker that has gone');
  });
}

test('a bye in the same read as hello cleans up a socket whose listen is still starting', async (t) => {
  const home = scratch(t), b = browser(t, home);
  await b.take('hello', (f) => f.t === 'hello');
  const at = Date.now();
  b.p.stdin.write(Buffer.concat([
    N.encode({ t: 'hello', v: 1, glaze: '4.0.0', instance: 'starting' }),
    N.encode({ t: 'bye' }),
  ]));
  const { code, at: done } = await b.exited;
  assert.equal(code, 0, b.err());
  assert.ok(done - at < 1000, `exited after ${done - at} ms`);
  assert.deepEqual(fs.readdirSync(runDir(home)), [], 'no socket or run file left behind');
});

test('a client that stops reading is closed past 32 MiB queued; a line past 64 MiB closes with too-long', async (t) => {
  const home = scratch(t);
  const b = browser(t, home);
  const { rec } = await b.start();
  const slow = await agent(rec, { read: false });
  await opened(b);
  const piece = 'x'.repeat(F.PIECE);
  for (let i = 0; i < Math.ceil((40 * MiB) / F.PIECE); i++) b.send({ t: 'line', c: 1, d: piece, m: 1 });
  assert.deepEqual(await b.take('overflow', (f) => f.t === 'close', 30000), { t: 'close', c: 1, why: 'overflow' });

  const long = await agent(rec);
  await opened(b);
  const chunk = Buffer.alloc(MiB, 'a');
  for (let i = 0; i < 64; i++) long.s.write(chunk);
  long.s.write('ab');
  assert.deepEqual(await b.take('too-long', (f) => f.t === 'close', 30000), { t: 'close', c: 2, why: 'too-long' });
  assert.deepEqual(b.left((f) => f.t === 'line'), [], 'no piece of it reached the worker');
  await until('it is closed', () => long.ended);
  slow.s.destroy();
  // The host is still serving.
  const next = await agent(rec);
  await opened(b);
  next.s.write('{"ok":1}\n');
  assert.equal(await lineFrom(b, 3), '{"ok":1}');
  next.s.destroy();
});

test('a host for the same browser and instance takes over; the old one leaves its files alone; stale ones are swept', async (t) => {
  const home = scratch(t);
  const d = R.ready(runDir(home));
  const stale = R.write(d, { v: 1, pid: 2147483646, path: R.socketPath(d, 'edge', 'gone'), token: R.token(), browser: 'edge', instance: 'gone', at: 1 });
  const first = browser(t, home);
  const a = await first.start('same');
  assert.equal(fs.existsSync(stale), false, 'swept at start');
  const second = browser(t, home);
  const b = await second.start('same');
  await until('the second run file', () => R.read(b.file)?.pid === second.p.pid);
  first.p.stdin.end();
  assert.equal((await first.exited).code, 0);
  assert.equal(R.read(a.file).pid, second.p.pid, 'the run file is the new host\'s');
  const c = await agent(R.read(b.file));
  await opened(second);
  c.s.write('{"id":1}\n');
  assert.equal(await lineFrom(second, 1), '{"id":1}');
  c.s.destroy();
});

test('a run folder that isn\'t safe: the worker gets an error and the host exits 1', { skip: !POSIX }, async (t) => {
  const home = scratch(t);
  fs.mkdirSync(runDir(home), { recursive: true, mode: 0o755 });
  fs.chmodSync(runDir(home), 0o755);
  const b = browser(t, home);
  await b.take('hello', (f) => f.t === 'hello');
  b.send({ t: 'hello', v: 1, glaze: '4.0.0', instance: 'inst1' });
  const e = await b.take('error', (f) => f.t === 'error');
  assert.ok(F.valid.toWorker(e));
  assert.match(e.why, /mode 755/);
  assert.equal((await b.exited).code, 1);
  assert.deepEqual(fs.readdirSync(runDir(home)), []);
});

test('a worker hello the host can\'t take is an error; frames that aren\'t the worker\'s are ignored', async (t) => {
  const home = scratch(t);
  const bad = browser(t, home);
  await bad.take('hello', (f) => f.t === 'hello');
  bad.send({ t: 'hello', v: 1, glaze: '4.0.0', instance: '../escape' });
  assert.equal((await bad.take('error', (f) => f.t === 'error')).t, 'error');
  assert.equal((await bad.exited).code, 1);
  assert.equal(fs.existsSync(path.join(runDir(home), '..', 'escape.json')), false);

  const b = browser(t, scratch(t));
  const { rec } = await b.start();
  b.send({ t: 'line', c: 1, d: 'x', extra: 1 });
  b.send({ t: 'open', c: 1, peer: { verified: false } });
  const a = await agent(rec);
  assert.equal((await opened(b)).c, 1);
  b.send({ t: 'line', c: 1, d: '{"ok":1}' });
  await until('the line', () => a.lines().length === 1);
  assert.deepEqual(a.lines(), ['{"ok":1}']);
  a.s.destroy();
});

test('the host refuses a terminal on stdin and arguments a browser doesn\'t pass', async (t) => {
  const err = [];
  const io = { stdin: { isTTY: true }, stdout: { write: () => assert.fail('nothing on stdout') }, stderr: { write: (s) => err.push(s) } };
  assert.equal(await H.main({ args: ['--browser=chrome', ORIGIN], browser: 'chrome', caller: ORIGIN, io }), 2);
  assert.match(err.join(''), /started by the browser/);
  const home = scratch(t);
  for (const args of [['host'], ['host', '--browser=chrome'], ['host', '--browser=chrome', ORIGIN, 'extra'], ['host', '--browser=../x', ORIGIN],
    ['host', '--browser=chrome', '--browser=edge', ORIGIN], ['host', ORIGIN, '--browser=chrome'], ['host', '--browser=firefox', 'glaze@frostdev.io']]) {
    const b = browser(t, home, args);
    const { code } = await b.exited;
    assert.equal(code, 2, args.join(' '));
    assert.match(b.err(), /glaze-mcp/, args.join(' '));
    assert.deepEqual(b.frames, [], `${args.join(' ')}: nothing on stdout`);
  }
  assert.equal(fs.existsSync(runDir(home)), false, 'no run folder made');
  // The browser's own arguments, with the launcher's --browser or without it, are taken.
  const manifest = path.join(home, 'io.frostdev.glaze_mcp.json');
  for (const [args, want] of [[[ORIGIN], 'chromium'], [['host', '--browser=firefox', manifest, 'glaze@frostdev.io'], 'firefox'], [[manifest, 'glaze@frostdev.io'], 'firefox']]) {
    const b = browser(t, scratch(t), args);
    assert.equal((await b.take('hello', (f) => f.t === 'hello')).browser, want, args.join(' '));
    b.p.stdin.end();
    assert.equal((await b.exited).code, 0);
  }
});

// ---- what the pipe may use ----------------------------------------------------------------------------------------------
test('the pipe files start no process, open no network port and run no code they are sent', () => {
  const PIPE = ['native', 'agent-frames', 'lines', 'mux', 'host', 'agent', 'rendezvous', 'handshake', 'peer'];
  const LOCAL = new Set([...PIPE.map((n) => `./${n}.js`), '../package.json', '../bin/glaze-mcp.js']);
  for (const name of PIPE) {
    const file = path.join(PKG, 'lib', `${name}.js`);
    if (name === 'agent' && !fs.existsSync(file)) continue;
    const code = fs.readFileSync(file, 'utf8').replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    assert.doesNotMatch(code, /\b(child_process|http|https|http2|dgram|tls|vm|worker_threads|inspector)\b['"]/, name);
    // Bare calls only: RegExp's .exec( is fine, and no module that has a spawn can be required.
    assert.doesNotMatch(code, /\bimport\(|process\.binding|\beval\(|new Function\b|(?<![.\w$])(spawn|spawnSync|exec|execSync|execFile|execFileSync|fork)\(/, name);
    assert.doesNotMatch(code, /\blisten\(\s*(\d|['"`]?\d|\{[^}]*\b(port|host)\b)/, `${name}: a numeric listen`);
    for (const [, dep] of code.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      assert.ok(dep.startsWith('node:') ? !/^node:(child_process|http|https|http2|dgram|tls|vm)$/.test(dep) : LOCAL.has(dep), `${name} requires ${dep}`);
    }
  }
});
