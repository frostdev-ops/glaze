// The browser's side of a glaze-mcp host, for test/mcp-host.test.js and test/mcp-agent.test.js: a real host process
// started with process.execPath, spoken to over the native codec, and agents written from the handshake's format alone.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const N = require('../../mcp/lib/native.js');
const F = require('../../mcp/lib/agent-frames.js');
const R = require('../../mcp/lib/rendezvous.js');

const PKG = path.join(__dirname, '..', '..', 'mcp');
const BIN = path.join(PKG, 'bin', 'glaze-mcp.js');
const ORIGIN = 'chrome-extension://jmmaeoajomodnbnlmdikjooalmcilooh/';
const FIREFOX = ['host', '--browser=firefox', '/x/io.frostdev.glaze_mcp.json', 'glaze@frostdev.io'];

const scratch = (t) => {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-mcp-pipe-')));
  t.after(() => fs.rmSync(d, { recursive: true, force: true }));
  return d;
};
// Doctor's runner is mocked; its executable must still have a safe path on every developer machine.
const nodeAt = (t) => {
  const file = path.join(scratch(t), 'node');
  fs.writeFileSync(file, '#!/bin/sh\necho v22.11.0\n', { mode: 0o755 });
  return file;
};
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
// A scratch HOME (LOCALAPPDATA on Windows), and no choice of browser carried in from the shell running the tests.
const envFor = (home, over = {}) => {
  const env = { ...process.env, HOME: home, LOCALAPPDATA: home, ...over };
  if (!('GLAZE_MCP_BROWSER' in over)) delete env.GLAZE_MCP_BROWSER;
  return env;
};
const runDir = (home) => R.dir({ platform: process.platform, env: envFor(home) });

const stop = async (p, exited) => {
  const wait = async () => {
    let timer;
    try { return await Promise.race([exited.then(() => true), new Promise((r) => { timer = setTimeout(() => r(false), 1000); })]); }
    finally { clearTimeout(timer); }
  };
  if (p.exitCode !== null || p.signalCode !== null) return exited;
  p.stdin.end();
  if (await wait()) return exited;
  p.kill('SIGTERM');
  if (await wait()) return exited;
  p.kill('SIGKILL');
  return exited;
};

// One host: frames read off its stdout, each with its native message size; frames written to its stdin; its exit.
const browser = (t, home, args = ['host', '--browser=chrome', ORIGIN], nodeArgs = []) => {
  const p = spawn(process.execPath, [...nodeArgs, BIN, ...args], { env: envFor(home), stdio: ['pipe', 'pipe', 'pipe'] });
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
  t.after(() => stop(p, exited));
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
    // Hello both ways, then the run file.
    async start(instance = 'inst1') {
      const hello = await take('hello', (f) => f.t === 'hello');
      this.send({ t: 'hello', v: 1, glaze: '4.0.0', instance });
      const file = R.runFile(runDir(home), hello.browser, instance);
      const rec = await until('the run file', () => { const r = R.read(file); return r && r.pid === p.pid && r; });
      return { hello, rec, file };
    },
  };
};

// An agent from the format alone: { s, bytes (after the answer), lines(), answer, ended }.
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
  a.lines = () => { const text = a.bytes.toString('utf8'); return text ? text.split('\n').slice(0, -1) : []; };
  await until('the answer', () => a.answer || a.ended);
  if (a.answer) assert.deepEqual(a.answer, { ok: 1, p: hmac(rec.token, `h${n}`) });
  return a;
};
const opened = (b) => b.take('open', (f) => f.t === 'open');
// Every frame of the next line from connection c, joined.
const lineFrom = async (b, c) => {
  const j = F.joiner();
  for (;;) {
    const f = await b.take(`a line for ${c}`, (x) => x.t === 'line' && x.c === c);
    const s = j.push(f);
    if (s !== null) return s;
  }
};

module.exports = { PKG, BIN, ORIGIN, FIREFOX, scratch, nodeAt, hmac, until, envFor, runDir, stop, browser, agent, opened, lineFrom };
