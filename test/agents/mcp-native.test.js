// The host's native-messaging codec (mcp/lib/native.js): a 32-bit little-endian length, then UTF-8 JSON. The reader takes
// stdin's chunks in any sizes; the writer keeps to the frame limit. Vectors: fixtures/agent-frames.json.
const test = require('node:test');
const assert = require('node:assert/strict');
const N = require('../mcp/lib/native.js');
const F = require('../mcp/lib/agent-frames.js');
const V = require('./fixtures/agent-frames.json');

const read = (chunks, opts) => {
  const got = [], push = N.reader((m) => got.push(m), opts);
  for (const c of chunks) push(c);
  return got;
};
const refused = (fn, code) => assert.throws(fn, (e) => e.code === code);
const head = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };

test('the limits: 64 MiB in, 1,000,000 bytes out', () => {
  assert.deepEqual([N.MAX_IN, N.MAX_OUT], [V.limits.nativeIn, V.limits.nativeOut]);
});

for (const v of V.native) {
  test(`encode and read: ${v.name}`, () => {
    const bytes = Buffer.from(v.hex, 'hex');
    assert.equal(N.encode(v.message).toString('hex'), v.hex);
    assert.deepEqual(read([bytes]), [v.message]);
    assert.deepEqual(read([...bytes].map((b) => Buffer.from([b]))), [v.message], 'a byte at a time, cutting inside UTF-8 characters');
  });
}

for (const v of V.nativeRefused) {
  test(`read refuses ${v.name}`, () => {
    const push = N.reader(() => assert.fail('no message'));
    refused(() => push(Buffer.from(v.hex, 'hex')), v.code);
    refused(() => push(N.encode({ t: 'bye' })), v.code); // and everything after it
  });
}

test('read: several messages in one chunk, and one across many, with empty reads between', () => {
  const all = Buffer.concat(V.native.map((v) => Buffer.from(v.hex, 'hex')));
  assert.deepEqual(read([all]), V.native.map((v) => v.message));
  const big = { t: 'line', c: 1, d: 'y'.repeat(300000) }, enc = N.encode(big);
  const parts = [Buffer.alloc(0), enc.subarray(0, 2), enc.subarray(2, 5), Buffer.alloc(0)];
  for (let at = 5; at < enc.length; at += 65536) parts.push(enc.subarray(at, at + 65536));
  assert.deepEqual(read([...parts, Buffer.from(V.native[2].hex, 'hex')]), [big, V.native[2].message]);
});

test('read: malformed UTF-8 is terminal even with another message buffered', () => {
  const bad = Buffer.from('0300000022ff22', 'hex'), got = [], push = N.reader((m) => got.push(m));
  for (const b of bad.subarray(0, -1)) push(Buffer.from([b]));
  refused(() => push(Buffer.concat([bad.subarray(-1), N.encode({ t: 'bye' })])), 'bad-json');
  refused(() => push(Buffer.alloc(0)), 'bad-json');
  assert.deepEqual(got, []);
});

test('read: a literal replacement character and escaped surrogates are valid UTF-8 JSON', () => {
  for (const s of ['\ufffd', '\ud800', '\udc00', '\ud83d\ude00']) assert.deepEqual(read([N.encode(s)]), [s]);
});

test('read: a length up to 64 MiB waits for its body; one byte more is refused at once', () => {
  assert.deepEqual(read([head(N.MAX_IN), Buffer.from('"')]), []);
  refused(() => read([head(N.MAX_IN + 1)]), 'too-large');
  refused(() => read([head(0xffffffff)]), 'too-large');
  assert.deepEqual(read([head(4), Buffer.from('"ab"')], { max: 4 }), ['ab']);
  refused(() => read([head(5)], { max: 4 }), 'too-large');
});

test('read: a message handler that throws leaves the reader in step', () => {
  const got = [];
  const push = N.reader((m) => { if (m === 1) throw new Error('handler'); got.push(m); });
  assert.throws(() => push(Buffer.concat([N.encode(1), N.encode(2)])), /handler/);
  push(N.encode(3));
  assert.deepEqual(got, [2, 3]);
});

test('encode: up to 1,000,000 bytes; more, or anything that isn\'t JSON, is refused', () => {
  assert.equal(N.encode('x'.repeat(N.MAX_OUT - 2)).length, 4 + N.MAX_OUT);
  refused(() => N.encode('x'.repeat(N.MAX_OUT - 1)), 'too-large');
  refused(() => N.encode('é'.repeat(N.MAX_OUT / 2)), 'too-large'); // counted in bytes, not characters
  for (const bad of [undefined, () => {}, Symbol('s')]) assert.throws(() => N.encode(bad), TypeError);
});

test('write: the encoded message to a stream', () => {
  const out = [];
  N.write({ write: (b) => out.push(b) }, { t: 'bye' });
  assert.deepEqual(out, [N.encode({ t: 'bye' })]);
});

test('the 5 MiB line goes out as frames the browser takes, and comes back whole', () => {
  const v = V.split.find((s) => s.name === 'a 5 MiB line');
  const text = v.build.map(([u, n]) => u.repeat(n)).join('');
  const wire = Buffer.concat(F.split(9, text).map(N.encode));
  const j = F.joiner(), lines = [];
  const push = N.reader((f) => { assert.ok(F.valid.toWorker(f)); const s = j.push(f); if (s) lines.push(s); });
  for (let at = 0; at < wire.length; at += 4093) push(wire.subarray(at, at + 4093));
  assert.equal(lines.length, 1);
  assert.equal(lines[0], text);
});
