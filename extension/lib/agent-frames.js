// The frames between the worker (lib/agent-link.js) and the glaze-mcp host, one native message each. The browser takes at
// most 1 MB from the host, so every frame is kept to 1,000,000 bytes of UTF-8 JSON: an MCP line goes as `line` frames
// whose `d` holds at most 160,000 UTF-16 units (all escaped, as `\u0001`, that's 960,000 bytes), never cut inside a
// surrogate pair, every piece but the last marked m:1. The joiner puts a line back together per connection, up to 64 MiB.
//
//   host → worker: {t:'hello',v:1,host,os,browser,node}, {t:'open',c,peer:{name?,exe?,ppid?,verified}}, {t:'line',c,d,m?},
//                  {t:'close',c,why}, {t:'error',why}
//   worker → host: {t:'hello',v:1,glaze,instance}, {t:'line',c,d,m?}, {t:'close',c,why}, {t:'bye'}
// `c` is the host's connection number, a positive safe integer; every other string is at most 4096 units, so any frame
// that passes valid.* fits in a native message.
//
// Classic script; module.exports for node. mcp/lib/agent-frames.js is a byte-identical copy (test/agent-frames.test.js).
var GZ_AGENT_FRAMES = globalThis.GZ_AGENT_FRAMES || (() => {
  const PIECE = 160000, FRAME = 1000000, LINE = 64 * 1024 * 1024, STR = 4096;
  const high = (u) => u >= 0xd800 && u <= 0xdbff, low = (u) => u >= 0xdc00 && u <= 0xdfff;

  // UTF-8 bytes, as TextEncoder writes them (a lone surrogate as U+FFFD, three bytes).
  const utf8 = (s) => {
    let n = s.length;
    for (let i = 0; i < s.length; i++) {
      const u = s.charCodeAt(i);
      if (u < 0x80) continue;
      if (u < 0x800) n += 1;
      else if (high(u) && low(s.charCodeAt(i + 1))) { n += 2; i++; } else n += 2;
    }
    return n;
  };
  const bytes = (f) => utf8(JSON.stringify(f));

  const split = (c, text) => {
    const out = [];
    let at = 0;
    do {
      let end = Math.min(at + PIECE, text.length);
      if (end < text.length && high(text.charCodeAt(end - 1)) && low(text.charCodeAt(end))) end--;
      const f = { t: 'line', c, d: text.slice(at, end) };
      if (end < text.length) f.m = 1;
      out.push(f);
      at = end;
    } while (at < text.length);
    return out;
  };

  // push(f) gives the whole line once its last piece is in, null while more are to come, and false (once) for a line
  // over `max` bytes, whose remaining pieces are then dropped through its last.
  const joiner = (max = LINE) => {
    const open = new Map();
    return {
      push(f) {
        let o = open.get(f.c);
        if (!o) {
          if (!f.m) return utf8(f.d) > max ? false : f.d;
          open.set(f.c, (o = { parts: [], n: 0, over: false }));
        }
        let said = null;
        if (!o.over) {
          o.n += utf8(f.d);
          if (o.n > max) { o.over = true; o.parts = []; said = false; } else o.parts.push(f.d);
        }
        if (f.m) return said;
        open.delete(f.c);
        return o.over ? said : o.parts.join('');
      },
      drop(c) { open.delete(c); },
    };
  };

  const str = (v) => typeof v === 'string' && v.length <= STR;
  const conn = (v) => Number.isSafeInteger(v) && v > 0;
  const whole = (v) => Number.isSafeInteger(v) && v >= 0;
  const one = (v) => v === 1;
  const piece = (v) => typeof v === 'string' && v.length <= PIECE;
  // Exactly these own keys: all of `need` and any of `may`, each passing its check.
  const fits = (o, need, may = {}) => !!o && typeof o === 'object' && !Array.isArray(o)
    && Object.keys(need).every((k) => Object.hasOwn(o, k) && need[k](o[k]))
    && Object.keys(o).every((k) => Object.hasOwn(need, k) || (Object.hasOwn(may, k) && may[k](o[k])));
  const peer = (p) => fits(p, { verified: (v) => typeof v === 'boolean' }, { name: str, exe: str, ppid: whole });
  const LINE_F = [{ c: conn, d: piece }, { m: one }], CLOSE = [{ c: conn, why: str }];
  const FROM_HOST = { hello: [{ v: one, host: str, os: str, browser: str, node: str }], open: [{ c: conn, peer }], line: LINE_F, close: CLOSE, error: [{ why: str }] };
  const FROM_WORKER = { hello: [{ v: one, glaze: str, instance: str }], line: LINE_F, close: CLOSE, bye: [{}] };
  const shape = (table) => (f) => !!f && typeof f === 'object' && typeof f.t === 'string' && Object.hasOwn(table, f.t)
    && fits(f, { t: () => true, ...table[f.t][0] }, table[f.t][1]);
  const valid = { toWorker: shape(FROM_HOST), toHost: shape(FROM_WORKER) };

  return { PIECE, FRAME, LINE, STR, utf8, bytes, split, joiner, valid };
})();
GZ_AGENT_FRAMES;
if (typeof module !== 'undefined') module.exports = GZ_AGENT_FRAMES;
