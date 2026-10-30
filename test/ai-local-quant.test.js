// The local engine's dequantization (lib/ai/local/quant.js): blocks built here field by field, each value checked
// against ggml-quants.c's formula written out again below, and seeded random blocks whose output must hash to what
// ggml 0.28 (llama.cpp b11960) gives from type_traits.to_float, bit for bit.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const Q = require('../lib/ai/local/quant.js');

const f = Math.fround;
// binary16 bits of a few values the blocks use.
const H = { 1: 0x3c00, 0.5: 0x3800, 0.25: 0x3400, 2: 0x4000, '-0.125': 0xb000, 0.1: 0x2e66 };
const h16 = (b, o, bits) => { b[o] = bits & 255; b[o + 1] = bits >> 8; };
const sum = (a) => a.reduce((x, y) => x + y, 0);

test('binary16, bfloat16 and float32 convert exactly', () => {
  const cases = [[0x0000, 0], [0x8000, -0], [0x3c00, 1], [0xc000, -2], [0x3555, f(0.333251953125)], [0x7bff, 65504], [0x0001, 2 ** -24],
    [0x03ff, 1023 * 2 ** -24], [0x0400, 2 ** -14], [0x7c00, Infinity], [0xfc00, -Infinity], [0x2e66, f(0.0999755859375)]];
  for (const [bits, v] of cases) assert.ok(Object.is(Q.fp16(bits), v), `0x${bits.toString(16)} → ${v}`);
  assert.ok(Number.isNaN(Q.fp16(0x7e00)));
  const b = new Uint8Array(cases.length * 2);
  cases.forEach(([bits], i) => h16(b, 2 * i, bits));
  assert.deepEqual([...Q.dequantize('F16', b, cases.length)], cases.map(([, v]) => v));
  const bf = new Uint8Array([0x80, 0x3f, 0x40, 0xc0, 0x49, 0x40, 0x80, 0x7f]);
  assert.deepEqual([...Q.dequantize('BF16', bf, 4)], [1, -3, f(3.140625), Infinity]);
  assert.deepEqual([...Q.dequantize(30, bf, 2)], [1, -3]);
  const f32 = new Float32Array([1.5, -2.25, 1e-30]);
  assert.deepEqual([...Q.dequantize('F32', new Uint8Array(f32.buffer), 3)], [...f32]);
});

test('Q4_0: (nibble − 8)·d, low nibbles first then high', () => {
  const b = new Uint8Array(36);
  h16(b, 0, H[0.5]); h16(b, 18, H['-0.125']);
  for (let j = 0; j < 16; j++) { b[2 + j] = j | ((15 - j) << 4); b[20 + j] = (j * 7) & 0xff; }
  const want = [];
  for (const [o, d] of [[0, 0.5], [18, -0.125]]) {
    const lo = [], hi = [];
    for (let j = 0; j < 16; j++) { lo.push(((b[o + 2 + j] & 15) - 8) * d); hi.push(((b[o + 2 + j] >> 4) - 8) * d); }
    want.push(...lo, ...hi);
  }
  assert.deepEqual([...Q.dequantize('Q4_0', b, 64)], want);
  assert.equal(want[0], -4); assert.equal(want[16], 3.5);
});

test('Q8_0: signed byte·d', () => {
  const b = new Uint8Array(34);
  h16(b, 0, H[0.25]);
  const qs = [127, -128, 0, 1, -1, 64, -64, 100];
  for (let j = 0; j < 32; j++) b[2 + j] = qs[j % 8] & 255;
  assert.deepEqual([...Q.dequantize('Q8_0', b, 32)], Array.from({ length: 32 }, (_, j) => qs[j % 8] * 0.25));
});

// The 12 scale bytes of a K block from 8 six-bit scales and 8 six-bit mins (the inverse of get_scale_min_k4).
const packScales = (sc, mn) => {
  const s = new Uint8Array(12);
  for (let j = 0; j < 4; j++) { s[j] = (sc[j] & 63) | ((sc[j + 4] >> 4) << 6); s[j + 4] = (mn[j] & 63) | ((mn[j + 4] >> 4) << 6); }
  for (let j = 4; j < 8; j++) s[j + 4] = (sc[j] & 15) | ((mn[j] & 15) << 4);
  return s;
};
const SC = [1, 63, 17, 40, 33, 48, 5, 62], MN = [0, 9, 63, 21, 50, 1, 32, 47];

test('Q4_K: d·scale_j·q − dmin·min_j over eight groups of 32', () => {
  const b = new Uint8Array(144);
  h16(b, 0, H[0.1]); h16(b, 2, H[0.25]);
  b.set(packScales(SC, MN), 4);
  for (let i = 0; i < 128; i++) b[16 + i] = (i * 37 + 11) & 255;
  const d = Q.fp16(H[0.1]), dmin = 0.25, want = [];
  for (let g = 0; g < 8; g++) {
    const chunk = 16 + 32 * (g >> 1), shift = g & 1 ? 4 : 0;
    for (let l = 0; l < 32; l++) want.push(f(f(f(d * SC[g]) * ((b[chunk + l] >> shift) & 15)) - f(dmin * MN[g])));
  }
  assert.deepEqual([...Q.dequantize('Q4_K', b, 256)], want);
});

test('Q5_K: as Q4_K with a fifth bit from qh, bit 2g of byte l for group g', () => {
  const b = new Uint8Array(176);
  h16(b, 0, H[2]); h16(b, 2, H[0.5]);
  b.set(packScales(SC, MN), 4);
  for (let l = 0; l < 32; l++) b[16 + l] = (l * 73 + 5) & 255;
  for (let i = 0; i < 128; i++) b[48 + i] = (i * 29 + 3) & 255;
  const want = [];
  for (let g = 0; g < 8; g++) {
    const chunk = 48 + 32 * (g >> 1), shift = g & 1 ? 4 : 0;
    for (let l = 0; l < 32; l++) {
      const q = ((b[chunk + l] >> shift) & 15) + ((b[16 + l] >> g) & 1 ? 16 : 0);
      want.push(f(f(2 * SC[g] * q) - f(0.5 * MN[g])));
    }
  }
  assert.deepEqual([...Q.dequantize('Q5_K', b, 256)], want);
});

test('Q6_K: d·scale·(6-bit q − 32), sixteen signed scales', () => {
  const b = new Uint8Array(210);
  for (let i = 0; i < 128; i++) b[i] = (i * 53 + 7) & 255;
  for (let i = 0; i < 64; i++) b[128 + i] = (i * 91 + 1) & 255;
  const sc = [-128, 127, -1, 1, 60, -60, 3, 99, -45, 12, 0, 77, -9, 31, -100, 8];
  sc.forEach((v, i) => { b[192 + i] = v & 255; });
  h16(b, 208, H[0.1]);
  const d = Q.fp16(H[0.1]), want = new Array(256);
  for (let half = 0; half < 2; half++) {
    const ql = 64 * half, qh = 128 + 32 * half, s = 8 * half;
    for (let l = 0; l < 32; l++) {
      const is = l >> 4, hb = b[qh + l];
      const q = [
        ((b[ql + l] & 15) | ((hb & 3) << 4)) - 32, ((b[ql + l + 32] & 15) | (((hb >> 2) & 3) << 4)) - 32,
        ((b[ql + l] >> 4) | (((hb >> 4) & 3) << 4)) - 32, ((b[ql + l + 32] >> 4) | (((hb >> 6) & 3) << 4)) - 32,
      ];
      for (let k = 0; k < 4; k++) want[128 * half + l + 32 * k] = f(f(d * sc[s + is + 2 * k]) * q[k]);
    }
  }
  assert.deepEqual([...Q.dequantize('Q6_K', b, 256)], want);
});

// Seeded blocks (mulberry32), every half-precision scale kept finite; digests of ggml's own output.
const mulberry = (a) => () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const GGML = {
  Q4_0: [2, '06d6335107d5fc43ff31a002b519b7e14a32fd5d0a6ac1cae23548e4b2f05cd4'],
  Q8_0: [8, '33f61a063113624e3530bf4589b5420ae383d99e56659280500347cda0500473'],
  Q4_K: [12, '77d3b55189b437683efa0c028df4737d4bf5e297bdf4c8fbd5f97a7aa93e7384'],
  Q5_K: [13, '4a3c2ac8c97ad12c0f780212ca59d464a04ecf9e5cb1272f2f05c4d393e69c64'],
  Q6_K: [14, '0cc9bdb763e103882e92565e0b63d563f4ba8698d4dfde4b27d4a49ca14484e3'],
};
test('seeded random blocks dequantize bit for bit as ggml does', () => {
  for (const [type, [id, digest]] of Object.entries(GGML)) {
    const [per, size] = Q.BLOCKS[type], blocks = 64, r = mulberry(id * 7919), b = new Uint8Array(blocks * size);
    for (let i = 0; i < b.length; i++) b[i] = Math.floor(r() * 256);
    const halves = type === 'Q6_K' ? [208] : type.endsWith('_K') ? [0, 2] : [0];
    for (let k = 0; k < blocks; k++) for (const o of halves) b[k * size + o + 1] &= 0xbf;
    const out = Q.dequantize(id, b, blocks * per);
    assert.equal(crypto.createHash('sha256').update(new Uint8Array(out.buffer)).digest('hex'), digest, type);
    assert.equal(Q.dequantize(type, b.subarray(size), per).join(), out.subarray(per, 2 * per).join(), `${type} from a later block`);
  }
});

test('output offset, sizes and refusals', () => {
  const b = new Uint8Array(34); h16(b, 0, H[1]); b[2] = 5;
  const out = new Float32Array(40).fill(9);
  Q.dequantize('Q8_0', b, 32, out, 8);
  assert.equal(out[7], 9); assert.equal(out[8], 5); assert.equal(sum([...out.subarray(9, 40)]), 0);
  assert.equal(Q.bytes('Q4_K', 7680), 30 * 144);
  assert.equal(Q.bytes('Q6_K', 2048), 8 * 210);
  assert.equal(Q.bytes(8, 64), 68);
  assert.throws(() => Q.bytes('Q4_K', 100), /whole/);
  assert.throws(() => Q.bytes('IQ2_XXS', 256), /unsupported/);
  assert.throws(() => Q.dequantize('Q8_0', b.subarray(0, 30), 32), /bytes/);
  assert.throws(() => Q.dequantize('Q8_0', b, 32, new Float32Array(16)), /too short/);
  assert.deepEqual(Q.TYPES, ['F32', 'F16', 'BF16', 'Q4_0', 'Q8_0', 'Q4_K', 'Q5_K', 'Q6_K']);
});
