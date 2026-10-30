// Native messaging on the host's stdin and stdout, as Chrome and Firefox speak it: each message is UTF-8 JSON after a
// 32-bit little-endian count of its bytes. The browser sends at most 64 MiB and takes at most 1 MB, so the host writes no
// more than the frame limit (agent-frames.js) and refuses a longer incoming length before reading its body.
'use strict';
const F = require('./agent-frames.js');
const { isUtf8 } = require('node:buffer');

const MAX_IN = 64 * 1024 * 1024, MAX_OUT = F.FRAME;
const fail = (code, message) => Object.assign(new Error(`native message: ${message}`), { code });

const encode = (msg) => {
  const json = JSON.stringify(msg);
  if (typeof json !== 'string') throw new TypeError('native message: not JSON');
  const n = Buffer.byteLength(json, 'utf8');
  if (n > MAX_OUT) throw Object.assign(new RangeError(`native message: ${n} bytes is over ${MAX_OUT}`), { code: 'too-large' });
  const out = Buffer.allocUnsafe(4 + n);
  out.writeUInt32LE(n, 0);
  out.write(json, 4, 'utf8');
  return out;
};
const write = (stream, msg) => stream.write(encode(msg));

// push(chunk) with stdin's chunks as they come; onMessage gets each message once all of it is in. A length over `max`,
// a zero length or a body that isn't UTF-8 JSON throws, and so does every push after it: the browser sends none of them, so
// the stream can't be trusted past one. A throwing onMessage leaves the reader in step; the next push goes on.
const reader = (onMessage, { max = MAX_IN } = {}) => {
  let chunks = [], have = 0, need = -1, dead = null;
  const take = (n) => {
    const all = chunks.length === 1 ? chunks[0] : Buffer.concat(chunks, have);
    chunks = all.length > n ? [all.subarray(n)] : [];
    have = all.length - n;
    return all.subarray(0, n);
  };
  return (chunk) => {
    if (dead) throw dead;
    if (chunk.length) { chunks.push(chunk); have += chunk.length; }
    for (;;) {
      if (need < 0) {
        if (have < 4) return;
        const n = take(4).readUInt32LE(0);
        if (n > max) throw (dead = fail('too-large', `length ${n} is over ${max}`));
        if (n === 0) throw (dead = fail('empty', 'zero length'));
        need = n;
      }
      if (have < need) return;
      const body = take(need);
      need = -1;
      let msg;
      if (!isUtf8(body)) throw (dead = fail('bad-json', 'not UTF-8 JSON'));
      try { msg = JSON.parse(body.toString('utf8')); } catch { throw (dead = fail('bad-json', 'not JSON')); }
      onMessage(msg);
    }
  };
};

module.exports = { MAX_IN, MAX_OUT, encode, write, reader };
