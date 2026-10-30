// The frames between the worker and the glaze-mcp host (lib/agent-frames.js): cutting a line into pieces, putting it
// back together, the exact shapes each side may send, and their size. The vectors in fixtures/agent-frames.json are
// shared with the host's native codec (test/mcp-native.test.js) and were worked out apart from this code.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const F = require('../lib/agent-frames.js');
const V = require('./fixtures/agent-frames.json');

const root = path.join(__dirname, '..');
const build = (recipe) => recipe.map(([unit, n]) => unit.repeat(n)).join('');
const textOf = (v) => (v.build ? build(v.build) : v.text);
const frameOf = (v) => (v.fill ? { ...v.frame, [v.fill.key]: build(v.fill.build) } : v.frame);
const high = (u) => u >= 0xd800 && u <= 0xdbff, low = (u) => u >= 0xdc00 && u <= 0xdfff;

test('the host package carries a byte-identical copy', () => {
  assert.ok(fs.readFileSync(path.join(root, 'mcp/lib/agent-frames.js')).equals(fs.readFileSync(path.join(root, 'lib/agent-frames.js'))));
});

test('the limits: 160,000-unit pieces, 1,000,000-byte frames, 64 MiB lines', () => {
  assert.deepEqual([F.PIECE, F.FRAME, F.LINE, F.STR], [V.limits.piece, V.limits.frame, V.limits.line, V.limits.string]);
  assert.equal(F.LINE, 64 * 1024 * 1024);
});

for (const v of V.split) {
  test(`split: ${v.name}`, () => {
    const c = v.c || 1, text = textOf(v), frames = F.split(c, text);
    assert.deepEqual(frames.map((f) => f.d.length), v.pieces);
    assert.deepEqual(frames.map(F.bytes), v.bytes);
    assert.deepEqual(frames.map((f) => Buffer.byteLength(JSON.stringify(f))), v.bytes, 'bytes() is the UTF-8 size');
    if (v.json) assert.equal(JSON.stringify(frames[0]), v.json);
    frames.forEach((f, i) => {
      const last = i === frames.length - 1;
      assert.deepEqual(Object.keys(f), last ? ['t', 'c', 'd'] : ['t', 'c', 'd', 'm']);
      assert.deepEqual([f.t, f.c, f.m], ['line', c, last ? undefined : 1]);
      assert.ok(F.valid.toWorker(f) && F.valid.toHost(f), 'both sides send them');
      assert.ok(F.bytes(f) <= F.FRAME);
      if (!last) assert.ok(!(high(f.d.charCodeAt(f.d.length - 1)) && low(frames[i + 1].d.charCodeAt(0))), `piece ${i} splits a pair`);
    });
    assert.equal(frames.map((f) => f.d).join(''), text);
    const j = F.joiner(), got = frames.map((f) => j.push(f));
    assert.deepEqual(got.slice(0, -1), frames.slice(1).map(() => null));
    assert.equal(got.at(-1), text);
  });
}

test('split: a long mixed line, from a fixed seed, keeps every rule', () => {
  let seed = 7;
  const rand = (n) => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) % n);
  const kinds = ['a', 'é', '中', '😀', '\u0001', '"', '\\', '\ud800', '\udc00', '\n'];
  let text = '';
  while (text.length < 1e6) text += kinds[rand(kinds.length)].repeat(1 + rand(4));
  const frames = F.split(42, text);
  frames.forEach((f, i) => {
    assert.ok(f.d.length <= F.PIECE && F.bytes(f) <= F.FRAME);
    if (i < frames.length - 1) {
      assert.ok(f.d.length >= F.PIECE - 1, 'a cut moves back at most one unit');
      assert.ok(!(high(f.d.charCodeAt(f.d.length - 1)) && low(frames[i + 1].d.charCodeAt(0))));
    }
  });
  assert.equal(frames.map((f) => f.d).join(''), text);
});

test('every frame either side may send fits in a native message, even at the largest connection number', () => {
  const c = Number.MAX_SAFE_INTEGER;
  for (const d of ['\u0001'.repeat(F.PIECE), '\ud800'.repeat(F.PIECE), '"'.repeat(F.PIECE)]) {
    assert.ok(F.valid.toWorker({ t: 'line', c, d, m: 1 }));
    assert.ok(F.bytes({ t: 'line', c, d, m: 1 }) <= F.FRAME);
  }
  const s = '\u0001'.repeat(F.STR);
  assert.ok(F.valid.toWorker({ t: 'open', c, peer: { name: s, exe: s, ppid: c, verified: true } }));
  assert.ok(F.bytes({ t: 'open', c, peer: { name: s, exe: s, ppid: c, verified: true } }) <= F.FRAME);
  assert.ok(F.bytes({ t: 'hello', v: 1, host: s, os: s, browser: s, node: s }) <= F.FRAME);
});

test('utf8() counts as TextEncoder does, a lone surrogate as U+FFFD', () => {
  for (const s of ['', 'a', '\u007f', '\u0080', '߿', 'ࠀ', '￿', '😀', '\ud800', '\udc00', '\udc00\ud800', '\ud800𐀀', 'x\ud83d']) {
    assert.equal(F.utf8(s), new TextEncoder().encode(s).length, JSON.stringify(s));
  }
});

for (const [side, check] of [['toWorker', F.valid.toWorker], ['toHost', F.valid.toHost]]) {
  test(`valid.${side}: the frames the plan's table allows, and nothing else`, () => {
    for (const v of V.frames[side].valid) assert.equal(check(frameOf(v)), true, JSON.stringify(v.frame));
    for (const v of V.frames[side].invalid) assert.equal(check(frameOf(v)), false, v.name);
  });
}

test('valid: a key on the prototype doesn\'t count, and a JSON __proto__ key is refused', () => {
  assert.equal(F.valid.toHost(Object.create({ t: 'bye' })), false);
  assert.equal(F.valid.toHost(Object.assign([], { t: 'bye' })), false, 'an array is no frame');
  assert.equal(F.valid.toHost(JSON.parse('{"t":"bye","__proto__":{}}')), false);
  assert.equal(F.valid.toWorker(JSON.parse('{"t":"open","c":1,"peer":{"verified":true,"__proto__":{"x":1}}}')), false);
});

test('joiner: lines on different connections come back whole, however their pieces interleave', () => {
  const j = F.joiner();
  const a = 'a'.repeat(F.PIECE * 2 + 5), b = '😀'.repeat(F.PIECE);
  const fa = F.split(1, a), fb = F.split(2, b);
  const out = [];
  for (let i = 0; i < Math.max(fa.length, fb.length); i++) for (const f of [fa[i], fb[i]]) if (f) out.push([f.c, j.push(f)]);
  assert.deepEqual(out.filter(([, s]) => s !== null).map(([c, s]) => [c, s.length]), [[2, b.length], [1, a.length]], 'the shorter line first');
  assert.equal(out.find(([c, s]) => c === 2 && s !== null)[1], b);
  assert.equal(j.push({ t: 'line', c: 1, d: 'next' }), 'next', 'a one-piece line comes straight back');
});

test('joiner: a line over the cap is refused once and its remaining pieces dropped; the connection goes on', () => {
  const j = F.joiner(10);
  assert.equal(j.push({ t: 'line', c: 1, d: '12345', m: 1 }), null);
  assert.equal(j.push({ t: 'line', c: 1, d: '123456', m: 1 }), false, 'over');
  assert.equal(j.push({ t: 'line', c: 1, d: 'abc', m: 1 }), null, 'dropped');
  assert.equal(j.push({ t: 'line', c: 1, d: 'abc' }), null, 'its last piece too');
  assert.equal(j.push({ t: 'line', c: 1, d: '1234567890' }), '1234567890', 'exactly the cap');
  assert.equal(j.push({ t: 'line', c: 1, d: '12345678901' }), false, 'one piece over the cap');
  assert.equal(j.push({ t: 'line', c: 1, d: 'é'.repeat(5) }), 'é'.repeat(5), 'the cap counts UTF-8 bytes');
  assert.equal(j.push({ t: 'line', c: 1, d: 'é'.repeat(5) + 'x' }), false);
  assert.equal(j.push({ t: 'line', c: 2, d: '123456789', m: 1 }), null);
  assert.equal(j.push({ t: 'line', c: 2, d: '12' }), false, 'over on the last piece');
  assert.equal(j.push({ t: 'line', c: 2, d: 'ok' }), 'ok');
});

test('joiner: drop() forgets a closed connection\'s partial line', () => {
  const j = F.joiner();
  j.push({ t: 'line', c: 3, d: 'half', m: 1 });
  j.drop(3);
  assert.equal(j.push({ t: 'line', c: 3, d: 'whole' }), 'whole');
});

test('joiner: the default cap is 64 MiB', () => {
  const piece = 'x'.repeat(F.PIECE), n = Math.floor(F.LINE / F.PIECE), rest = F.LINE - n * F.PIECE;
  const j = F.joiner();
  for (let i = 0; i < n; i++) assert.equal(j.push({ t: 'line', c: 1, d: piece, m: 1 }), null);
  assert.equal(j.push({ t: 'line', c: 1, d: 'x'.repeat(rest) }).length, F.LINE);
  for (let i = 0; i < n; i++) j.push({ t: 'line', c: 1, d: piece, m: 1 });
  assert.equal(j.push({ t: 'line', c: 1, d: 'x'.repeat(rest + 1) }), false);
});
