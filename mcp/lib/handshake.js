// The first line each way on a new connection, before any MCP byte. The agent proves it could read the run file's
// token, and the host proves it wrote it:
//   agent → host  {"glaze-mcp":1,"n":<nonce>,"p":HMAC(token,"a"+n),"peer":{name?,exe?,ppid?,verified}[,"probe":1]}\n
//   host → agent  {"ok":1,"p":HMAC(token,"h"+n)}\n
// HMAC-SHA256 keyed with the token's 32 bytes, in base64. The host reads nothing past the agent's line and writes nothing
// until the proof checks out; a wrong proof, more bytes before the answer, a line too long or none in time closes the
// connection with nothing written. A probe (doctor's) is answered and never reaches the worker.
'use strict';
const crypto = require('node:crypto');

const TIMEOUT = 5000, HELLO = 64 * 1024, ANSWER = 1024, STR = 4096;
const NONCE = /^[A-Za-z0-9+/=]{16,128}$/;

const fail = (code, message) => Object.assign(new Error(`handshake: ${message}`), { code });
const mac = (token, tag, n) => crypto.createHmac('sha256', Buffer.from(token, 'base64')).update(tag + n).digest('base64');
const same = (a, b) => {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};
const parse = (line) => { try { const m = JSON.parse(line); return m && typeof m === 'object' && !Array.isArray(m) ? m : null; } catch { return null; } };
// What the host passes on of an agent's self-report, which it can't check.
const peerOf = (p) => {
  const out = {};
  if (p && typeof p === 'object') {
    if (typeof p.name === 'string' && p.name.length <= STR) out.name = p.name;
    if (typeof p.exe === 'string' && p.exe.length <= STR) out.exe = p.exe;
    if (Number.isSafeInteger(p.ppid) && p.ppid >= 0) out.ppid = p.ppid;
  }
  out.verified = false;
  return out;
};

// The socket's first line, at most `max` bytes, and whatever came after it in the same read. The socket is left paused,
// with no listener of ours on it.
const first = (socket, max, timeout) => new Promise((resolve, reject) => {
  const parts = [];
  let n = 0;
  const end = (err, line, rest) => {
    clearTimeout(timer);
    socket.off('data', data).off('error', end).off('end', gone).off('close', gone);
    socket.pause();
    if (err) reject(err); else resolve({ line, rest });
  };
  const data = (chunk) => {
    const i = chunk.indexOf(10);
    if (n + (i < 0 ? chunk.length : i) > max) return end(fail('too-long', `a first line over ${max} bytes`));
    if (i < 0) { parts.push(chunk); n += chunk.length; return; }
    parts.push(chunk.subarray(0, i));
    end(null, Buffer.concat(parts).toString('utf8'), chunk.subarray(i + 1));
  };
  const gone = () => end(fail('closed', 'the other side closed first'));
  const timer = setTimeout(() => end(fail('timeout', `nothing in ${timeout} ms`)), timeout);
  socket.on('data', data).on('error', end).on('end', gone).on('close', gone);
  socket.resume();
});

// Host side: resolves { peer, probe } once it has answered; otherwise the socket is destroyed and it rejects.
const accept = async (socket, token, { timeout = TIMEOUT } = {}) => {
  try {
    const { line, rest } = await first(socket, HELLO, timeout);
    const m = parse(line);
    if (!m || m['glaze-mcp'] !== 1 || typeof m.n !== 'string' || !NONCE.test(m.n) || !same(m.p, mac(token, 'a', m.n))) throw fail('refused', 'no proof of the token');
    if (rest.length) throw fail('refused', 'bytes before the answer');
    socket.write(`${JSON.stringify({ ok: 1, p: mac(token, 'h', m.n) })}\n`);
    return { peer: peerOf(m.peer), probe: m.probe === 1 };
  } catch (e) {
    socket.destroy();
    throw e;
  }
};

// Agent side: resolves { rest }, the bytes that followed the answer, once the host has proved the token.
const offer = async (socket, token, peer, { timeout = TIMEOUT, probe = false } = {}) => {
  const n = crypto.randomBytes(16).toString('base64');
  try {
    socket.write(`${JSON.stringify({ 'glaze-mcp': 1, n, p: mac(token, 'a', n), peer, ...(probe ? { probe: 1 } : {}) })}\n`);
    const { line, rest } = await first(socket, ANSWER, timeout);
    const m = parse(line);
    if (!m || m.ok !== 1 || !same(m.p, mac(token, 'h', n))) throw fail('refused', 'the host did not prove the token');
    return { rest };
  } catch (e) {
    socket.destroy();
    throw e;
  }
};

module.exports = { TIMEOUT, HELLO, mac, same, accept, offer };
