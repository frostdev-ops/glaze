// The host's connections. Each agent socket that passed the handshake gets a number `c`, never reused in this host, and
// the worker hears {t:'open',c,peer}. The agent's lines (lines.js) go to the worker as line frames (agent-frames.js); the
// worker's line frames for c are written to the socket as they come, the last piece of each line followed by "\n".
// A close from either side ends only that connection; the agent's reaches the worker as {t:'close',c,why}:
//   eof (the agent hung up), error, too-long (a line over 64 MiB), overflow (over 32 MiB waiting for an agent that
//   doesn't read), bad-line (a worker piece holding "\n", which would break the agent's framing).
// send(frame) is the host's write to the browser: when it reports a full pipe every socket pauses until release().
'use strict';
const F = require('./agent-frames.js');
const L = require('./lines.js');

const create = ({ send, queue = L.QUEUE, line = L.LINE }) => {
  const conns = new Map();
  let next = 1, held = false;

  const drop = (c, why) => {
    const k = conns.get(c);
    if (!k) return;
    conns.delete(c);
    k.socket.destroy();
    send({ t: 'close', c, why });
  };
  const hold = () => {
    if (held) return;
    held = true;
    for (const k of conns.values()) k.socket.pause();
  };

  const open = (socket, peer) => {
    const c = next++;
    conns.set(c, { socket });
    send({ t: 'open', c, peer });
    const push = L.cutter((text) => { for (const f of F.split(c, text)) if (send(f) === false) hold(); }, line);
    socket.on('data', (chunk) => {
      if (!conns.has(c)) return;
      try { push(chunk); } catch (e) { if (e.code !== 'too-long') throw e; drop(c, 'too-long'); }
    });
    socket.on('error', () => drop(c, 'error'));
    socket.on('end', () => drop(c, 'eof'));
    socket.on('close', () => drop(c, 'eof'));
    if (!held) socket.resume();
    return c;
  };

  // A frame from the worker: line or close. One for a connection already closed is dropped.
  const frame = (f) => {
    const k = conns.get(f.c);
    if (!k) return;
    if (f.t === 'close') {
      conns.delete(f.c);
      // What was written before still goes; an agent that never reads it doesn't keep the socket.
      k.socket.end();
      setTimeout(() => k.socket.destroy(), 10000).unref();
      return;
    }
    if (f.t !== 'line') return;
    if (f.d.includes('\n')) return drop(f.c, 'bad-line');
    if (f.d || !f.m) k.socket.write(Buffer.from(f.m ? f.d : `${f.d}\n`));
    if (k.socket.writableLength > queue) drop(f.c, 'overflow');
  };

  const release = () => {
    if (!held) return;
    held = false;
    for (const k of conns.values()) k.socket.resume();
  };
  // The worker is gone: every socket closes, and nothing more is sent.
  const end = () => {
    const all = [...conns.values()];
    conns.clear();
    for (const k of all) k.socket.destroy();
  };

  return { open, frame, release, end, size: () => conns.size };
};

module.exports = { create };
