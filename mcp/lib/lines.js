// The only parsing the host does of what an agent sends: cutting its bytes into lines at "\n" (a byte no other UTF-8
// character contains), each handed on whole as a string. A line past `max` bytes throws (code 'too-long') after the
// lines before it have gone out, and so does every push after it. QUEUE is how much the host lets build up for an agent
// that doesn't read (mux.js).
'use strict';

const LINE = 64 * 1024 * 1024, QUEUE = 32 * 1024 * 1024;

const cutter = (onLine, max = LINE) => {
  let parts = [], n = 0, dead = null;
  const over = () => (dead = Object.assign(new Error(`a line over ${max} bytes`), { code: 'too-long' }));
  return (chunk) => {
    if (dead) throw dead;
    let at = 0;
    for (let i; (i = chunk.indexOf(10, at)) >= 0; at = i + 1) {
      if (n + i - at > max) throw over();
      parts.push(chunk.subarray(at, i));
      const line = parts.length === 1 ? parts[0] : Buffer.concat(parts, n + i - at);
      parts = [];
      n = 0;
      onLine(line.toString('utf8'));
    }
    if (at === chunk.length) return;
    n += chunk.length - at;
    if (n > max) throw over();
    parts.push(chunk.subarray(at));
  };
};

module.exports = { LINE, QUEUE, cutter };
