// The local engine's GGUF reader (lib/ai/local/gguf.js) on GGUF files written here byte by byte as gguf.cpp lays them
// out: every metadata type, nested and string arrays, tensor infos, the alignment and data offsets, every kind of source
// (read in small chunks, and never past the header until a tensor is asked for), and what ggml refuses.
const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../lib/ai/local/gguf.js');

// ---- a GGUF writer, independent of the reader ------------------------------------------------------------------------
const T = { u8: 0, i8: 1, u16: 2, i16: 3, u32: 4, i32: 5, f32: 6, bool: 7, str: 8, arr: 9, u64: 10, i64: 11, f64: 12 };
const enc = new TextEncoder();
const writer = () => {
  const parts = [];
  const raw = (n, fill) => { const b = new Uint8Array(n); fill(new DataView(b.buffer)); parts.push(b); };
  const w = {
    u8: (v) => raw(1, (d) => d.setUint8(0, v)), i8: (v) => raw(1, (d) => d.setInt8(0, v)),
    u16: (v) => raw(2, (d) => d.setUint16(0, v, true)), i16: (v) => raw(2, (d) => d.setInt16(0, v, true)),
    u32: (v) => raw(4, (d) => d.setUint32(0, v, true)), i32: (v) => raw(4, (d) => d.setInt32(0, v, true)),
    f32: (v) => raw(4, (d) => d.setFloat32(0, v, true)), f64: (v) => raw(8, (d) => d.setFloat64(0, v, true)),
    u64: (v) => raw(8, (d) => d.setBigUint64(0, BigInt(v), true)), i64: (v) => raw(8, (d) => d.setBigInt64(0, BigInt(v), true)),
    bool: (v) => raw(1, (d) => d.setUint8(0, v ? 1 : 0)),
    str: (s) => { const b = enc.encode(s); w.u64(b.length); parts.push(b); },
    bytes: (b) => parts.push(b),
    get length() { return parts.reduce((n, p) => n + p.length, 0); },
    pad: (a) => { const n = (a - (w.length % a)) % a; parts.push(new Uint8Array(n)); },
    done: () => { const out = new Uint8Array(w.length); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; },
  };
  return w;
};
// kv: [key, type, value] (arrays: [key, 'arr', [element type, values]]); tensors: { name, dims, type id, data }.
const value = (w, t, v) => {
  if (t !== 'arr') return w[t](v);
  const [et, vs] = v;
  w.u32(T[et]); w.u64(vs.length);
  for (const x of vs) (et === 'arr' ? value(w, 'arr', x) : w[et](x));
};
const gguf = ({ version = 3, kv = [], tensors = [], alignment = 32, magic = 'GGUF', offsets } = {}) => {
  const w = writer();
  w.bytes(enc.encode(magic)); w.u32(version); w.u64(tensors.length); w.u64(kv.length);
  for (const [k, t, v] of kv) { w.str(k); w.u32(T[t]); value(w, t, v); }
  let rel = 0;
  const rels = tensors.map((t, i) => { const r = offsets ? offsets[i] : rel; rel = Math.ceil((r + t.data.length) / alignment) * alignment; return r; });
  tensors.forEach((t, i) => { w.str(t.name); w.u32(t.dims.length); for (const d of t.dims) w.u64(d); w.u32(t.type); w.u64(rels[i]); });
  w.pad(alignment);
  const start = w.length;
  tensors.forEach((t, i) => { w.pad(alignment); while (w.length - start < rels[i]) w.u8(0); w.bytes(t.data); });
  return { bytes: w.done(), start, rels };
};
const fill = (n, seed) => Uint8Array.from({ length: n }, (_, i) => (i * 31 + seed) & 255);

const KV = [
  ['general.architecture', 'str', 'lfm3'],
  ['general.name', 'str', 'Ünïcode — 名前'],
  ['a.u8', 'u8', 250], ['a.i8', 'i8', -100], ['a.u16', 'u16', 65000], ['a.i16', 'i16', -32000],
  ['a.u32', 'u32', 4000000000], ['a.i32', 'i32', -2000000000], ['a.f32', 'f32', 1e-5], ['a.f64', 'f64', Math.PI],
  ['a.u64', 'u64', 2n ** 63n + 5n], ['a.i64', 'i64', -(2n ** 62n)], ['a.true', 'bool', true], ['a.false', 'bool', false],
  ['a.heads', 'arr', ['i32', [0, 0, 4, 0, -4]]],
  ['a.window', 'arr', ['bool', [false, true, true]]],
  ['a.tokens', 'arr', ['str', ['<|im_start|>', 'Ġhello', '', 'ĊĊ', '\uFEFF', '\uFEFFfoo']]],
  ['a.bom', 'str', '\uFEFFbom'],
  ['a.f32s', 'arr', ['f32', [1, 0.5, -2]]],
  ['a.u64s', 'arr', ['u64', [1n, 2n ** 40n]]],
  ['a.nested', 'arr', ['arr', [['u8', [1, 2]], ['u8', [3]]]]],
  ['a.empty', 'arr', ['str', []]],
];
// F32 [4, 3], Q4_K [256, 2] (2 blocks of 144 B), Q8_0 [64] (2 blocks of 34 B).
const TENSORS = [
  { name: 'output_norm.weight', dims: [4, 3], type: 0, data: fill(48, 1) },
  { name: 'blk.0.ffn_gate.weight', dims: [256, 2], type: 12, data: fill(288, 2) },
  { name: 'token_embd.weight', dims: [64], type: 8, data: fill(68, 3) },
];

test('every metadata type reads back as written', async () => {
  const { bytes } = gguf({ kv: KV });
  const g = await G.open(bytes);
  assert.equal(g.version, 3);
  assert.equal(g.kv['general.architecture'], 'lfm3');
  assert.equal(g.kv['general.name'], 'Ünïcode — 名前');
  assert.equal(g.kv['a.u8'], 250); assert.equal(g.kv['a.i8'], -100);
  assert.equal(g.kv['a.u16'], 65000); assert.equal(g.kv['a.i16'], -32000);
  assert.equal(g.kv['a.u32'], 4000000000); assert.equal(g.kv['a.i32'], -2000000000);
  assert.equal(g.kv['a.f32'], Math.fround(1e-5)); assert.equal(g.kv['a.f64'], Math.PI);
  assert.equal(g.kv['a.u64'], 2n ** 63n + 5n); assert.equal(g.kv['a.i64'], -(2n ** 62n));
  assert.equal(g.kv['a.true'], true); assert.equal(g.kv['a.false'], false);
  assert.ok(g.kv['a.heads'] instanceof Int32Array);
  assert.deepEqual([...g.kv['a.heads']], [0, 0, 4, 0, -4]);
  assert.deepEqual(g.kv['a.window'], [false, true, true]);
  // A leading U+FEFF is text, not a byte order mark (gguf.cpp keeps it).
  assert.deepEqual(g.kv['a.tokens'], ['<|im_start|>', 'Ġhello', '', 'ĊĊ', '\uFEFF', '\uFEFFfoo']);
  assert.equal(g.kv['a.bom'], '\uFEFFbom');
  assert.ok(g.kv['a.f32s'] instanceof Float32Array);
  assert.deepEqual([...g.kv['a.f32s']], [1, 0.5, -2]);
  assert.ok(g.kv['a.u64s'] instanceof BigUint64Array);
  assert.deepEqual([...g.kv['a.u64s']], [1n, 2n ** 40n]);
  assert.deepEqual(g.kv['a.nested'].map((a) => [...a]), [[1, 2], [3]]);
  assert.deepEqual(g.kv['a.empty'], []);
  assert.equal(g.kvTypes['a.u8'], 'u8');
  assert.deepEqual(g.kvTypes['a.tokens'], ['arr', 'str']);
  assert.deepEqual(g.kvTypes['a.nested'], ['arr', ['arr', 'u8']]);
  assert.equal(Object.keys(g.kv).length, KV.length);
  assert.equal(g.tensors.length, 0);
});

test('tensor infos, the default alignment and each tensor\'s bytes', async () => {
  const { bytes, start, rels } = gguf({ kv: KV.slice(0, 3), tensors: TENSORS });
  const g = await G.open(bytes);
  assert.equal(g.alignment, 32);
  assert.equal(g.dataOffset, start);
  assert.equal(g.dataOffset % 32, 0);
  assert.deepEqual(g.tensors.map((t) => [t.name, t.type, t.typeId, t.dims, t.count, t.bytes, t.offset]), [
    ['output_norm.weight', 'F32', 0, [4, 3], 12, 48, start + rels[0]],
    ['blk.0.ffn_gate.weight', 'Q4_K', 12, [256, 2], 512, 288, start + rels[1]],
    ['token_embd.weight', 'Q8_0', 8, [64], 64, 68, start + rels[2]],
  ]);
  for (const t of TENSORS) assert.deepEqual([...(await g.read(t.name))], [...t.data]);
  assert.deepEqual([...(await g.read('blk.0.ffn_gate.weight', 144, 144))], [...TENSORS[1].data.subarray(144)]);
  assert.equal(g.tensor('nope'), null);
  await assert.rejects(g.read('nope'), /no tensor/);
  await assert.rejects(g.read('token_embd.weight', 60, 10), /range/);
});

test('general.alignment moves the data and every offset', async () => {
  const kv = [['general.alignment', 'u32', 64]];
  const { bytes, start, rels } = gguf({ kv, tensors: TENSORS, alignment: 64 });
  const g = await G.open(bytes);
  assert.equal(g.alignment, 64);
  assert.equal(g.dataOffset, start);
  assert.equal(start % 64, 0);
  assert.deepEqual(rels, [0, 64, 384]);
  for (const t of TENSORS) assert.deepEqual([...(await g.read(t.name))], [...t.data]);
});

test('a v2 file reads the same', async () => {
  const g = await G.open(gguf({ version: 2, kv: KV.slice(0, 4), tensors: TENSORS.slice(0, 1) }).bytes);
  assert.equal(g.version, 2);
  assert.equal(g.kv['a.u8'], 250);
  assert.equal(g.tensors[0].bytes, 48);
});

test('every source reads alike, in small chunks, and open never reads tensor data', async () => {
  const { bytes } = gguf({ kv: KV, tensors: TENSORS });
  const reads = [];
  const ranged = { size: bytes.length, read: (o, n) => { reads.push([o, n]); return bytes.slice(o, o + n); } };
  const later = { size: bytes.length, read: (o, n) => new Promise((r) => setTimeout(() => r(bytes.slice(o, o + n)), 0)) };
  const shifted = new Uint8Array(bytes.length + 5); shifted.set(bytes, 5);
  const sources = [
    ['ArrayBuffer', bytes.buffer.slice(0)], ['Uint8Array at an offset', shifted.subarray(5)],
    ['Blob', new Blob([bytes])], ['range reader, 7-byte chunks', ranged], ['async range reader', later],
  ];
  const want = await G.open(bytes);
  for (const [label, src] of sources) {
    const g = await G.open(src, { chunk: 7 });
    assert.deepEqual(g.kv, want.kv, label);
    assert.deepEqual(g.tensors, want.tensors, label);
    for (const t of TENSORS) assert.deepEqual([...(await g.read(t.name))], [...t.data], label);
  }
  reads.length = 0;
  const g = await G.open(ranged, { chunk: 7 });
  const headerReads = reads.splice(0);
  assert.ok(headerReads.length > 20, 'read in many chunks');
  assert.ok(headerReads.every(([o]) => o < g.dataOffset), 'every read starts in the header');
  assert.ok(Math.max(...headerReads.map(([o, n]) => o + n)) <= g.dataOffset + 7, 'at most one chunk past it');
  await g.read('token_embd.weight');
  assert.deepEqual(reads, [[g.tensor('token_embd.weight').offset, 68]]);
  assert.throws(() => G.source({}), /a source is/);
});

test('what ggml refuses is refused', async () => {
  const bad = async (o, re) => assert.rejects(G.open(o.bytes || gguf(o).bytes), re);
  await bad({ magic: 'GGUX' }, /not a GGUF/);
  await bad({ version: 1 }, /v1/);
  await bad({ version: 0x03000000 }, /big-endian/);
  await bad({ version: 4 }, /unknown version/);
  await bad({ kv: [['a', 'u8', 1], ['a', 'u8', 2]] }, /duplicate key a/);
  await bad({ tensors: [TENSORS[0], { ...TENSORS[0] }] }, /duplicate tensor/);
  await bad({ tensors: [{ ...TENSORS[0], type: 4 }] }, /unknown type/);
  await bad({ tensors: [{ ...TENSORS[0], type: 99 }] }, /unknown type/);
  await bad({ tensors: [{ name: 'x', dims: [100], type: 12, data: fill(144, 0) }] }, /not whole Q4_K blocks/);
  await bad({ tensors: [{ name: 'x', dims: [1, 1, 1, 1, 1], type: 0, data: fill(4, 0) }] }, /5 dimensions/);
  await bad({ tensors: [TENSORS[0]], offsets: [8] }, /not aligned/);
  await bad({ kv: [['general.alignment', 'u32', 48]] }, /power of two/);
  await bad({ kv: [['general.alignment', 'u64', 32]] }, /not a u32/);
  const whole = gguf({ kv: KV, tensors: TENSORS }).bytes;
  await bad({ bytes: whole.subarray(0, whole.length - 1) }, /past the end/);
  const g = await G.open(whole);
  await bad({ bytes: whole.subarray(0, g.dataOffset - 40) }, /truncated/);
  await bad({ bytes: whole.subarray(0, 30) }, /truncated/);
});

test('the type table and bytesOf', () => {
  assert.deepEqual(G.type('Q6_K'), { name: 'Q6_K', id: 14, block: 256, bytes: 210 });
  assert.deepEqual(G.type(30), { name: 'BF16', id: 30, block: 1, bytes: 2 });
  assert.equal(G.type(4), null);
  assert.equal(G.bytesOf('Q4_K', 2048), 8 * 144);
  assert.equal(G.bytesOf('Q8_0', 2048), 64 * 34);
  assert.equal(G.bytesOf('Q4_0', 64), 36);
  assert.equal(G.bytesOf('F16', 3), 6);
  assert.throws(() => G.bytesOf('Q5_K', 100), /whole/);
  assert.throws(() => G.bytesOf('X', 1), /unknown type/);
});
