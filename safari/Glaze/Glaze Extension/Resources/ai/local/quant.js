// Dequantization of ggml blocks to Float32 for the local engine's reference (ai/local/reference.js): Q4_0, Q8_0,
// Q4_K, Q5_K, Q6_K, F16, BF16 and F32, bit for bit as ggml-quants.c's dequantize_row_* computes them in float, every
// product and difference rounded to float in the C source's order (Math.fround), with no fused multiply-add.
// Block layouts (ggml-common.h), little-endian, ggml_half = IEEE binary16:
//   Q4_0 (32, 18 B): d f16, qs[16]            y[j] = (lo4 - 8)·d, y[j+16] = (hi4 - 8)·d
//   Q8_0 (32, 34 B): d f16, qs[32] i8         y = q·d
//   Q4_K (256, 144 B): d, dmin f16, scales[12] (8 six-bit scale/min pairs), qs[128]
//   Q5_K (256, 176 B): d, dmin f16, scales[12], qh[32], qs[128]
//   Q6_K (256, 210 B): ql[128], qh[64], scales[16] i8, d f16
// Classic script; node exports.
var GZ_AI_QUANT = globalThis.GZ_AI_QUANT || (() => {
  const f = Math.fround;
  // Every binary16 value as a float (exact: binary16 → binary32 loses nothing).
  let HALF = null;
  const half = () => {
    if (HALF) return HALF;
    HALF = new Float32Array(65536);
    for (let h = 0; h < 65536; h++) {
      const s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 31, m = h & 1023;
      HALF[h] = e === 0 ? s * m * 2 ** -24 : e === 31 ? (m ? NaN : s * Infinity) : s * (1024 + m) * 2 ** (e - 25);
    }
    return HALF;
  };
  const fp16 = (h) => half()[h];
  const bf16 = (() => { const u = new Uint32Array(1), v = new Float32Array(u.buffer); return (h) => { u[0] = h << 16; return v[0]; }; })();

  // Elements per block and bytes per block.
  const BLOCKS = { F32: [1, 4], F16: [1, 2], BF16: [1, 2], Q4_0: [32, 18], Q8_0: [32, 34], Q4_K: [256, 144], Q5_K: [256, 176], Q6_K: [256, 210] };
  const IDS = { 0: 'F32', 1: 'F16', 30: 'BF16', 2: 'Q4_0', 8: 'Q8_0', 12: 'Q4_K', 13: 'Q5_K', 14: 'Q6_K' };
  const name = (t) => (typeof t === 'number' ? IDS[t] : t);
  const fail = (what) => { throw new TypeError(`quant: ${what}`); };

  // get_scale_min_k4: the j-th six-bit scale and min of a Q4_K/Q5_K block's 12 scale bytes at s.
  const scaleMin = (b, s, j, out) => {
    if (j < 4) { out[0] = b[s + j] & 63; out[1] = b[s + j + 4] & 63; return; }
    out[0] = (b[s + j + 4] & 0xf) | ((b[s + j - 4] >> 6) << 4);
    out[1] = (b[s + j + 4] >> 4) | ((b[s + j] >> 6) << 4);
  };

  const q4_0 = (b, o, y, at) => {
    const d = fp16(b[o] | (b[o + 1] << 8));
    for (let j = 0; j < 16; j++) {
      const q = b[o + 2 + j];
      y[at + j] = f(((q & 0xf) - 8) * d);
      y[at + j + 16] = f(((q >> 4) - 8) * d);
    }
  };
  const q8_0 = (b, o, y, at) => {
    const d = fp16(b[o] | (b[o + 1] << 8));
    for (let j = 0; j < 32; j++) y[at + j] = f(((b[o + 2 + j] << 24) >> 24) * d); // the byte as an int8
  };
  const sm = new Uint8Array(2);
  const q4_K = (b, o, y, at) => {
    const d = fp16(b[o] | (b[o + 1] << 8)), min = fp16(b[o + 2] | (b[o + 3] << 8));
    let q = o + 16;
    for (let j = 0, is = 0; j < 256; j += 64, is += 2, q += 32) {
      scaleMin(b, o + 4, is, sm); const d1 = f(d * sm[0]), m1 = f(min * sm[1]);
      scaleMin(b, o + 4, is + 1, sm); const d2 = f(d * sm[0]), m2 = f(min * sm[1]);
      for (let l = 0; l < 32; l++) y[at++] = f(f(d1 * (b[q + l] & 0xf)) - m1);
      for (let l = 0; l < 32; l++) y[at++] = f(f(d2 * (b[q + l] >> 4)) - m2);
    }
  };
  const q5_K = (b, o, y, at) => {
    const d = fp16(b[o] | (b[o + 1] << 8)), min = fp16(b[o + 2] | (b[o + 3] << 8));
    const qh = o + 16;
    let ql = o + 48, u1 = 1, u2 = 2;
    for (let j = 0, is = 0; j < 256; j += 64, is += 2, ql += 32, u1 <<= 2, u2 <<= 2) {
      scaleMin(b, o + 4, is, sm); const d1 = f(d * sm[0]), m1 = f(min * sm[1]);
      scaleMin(b, o + 4, is + 1, sm); const d2 = f(d * sm[0]), m2 = f(min * sm[1]);
      for (let l = 0; l < 32; l++) y[at++] = f(f(d1 * ((b[ql + l] & 0xf) + (b[qh + l] & u1 ? 16 : 0))) - m1);
      for (let l = 0; l < 32; l++) y[at++] = f(f(d2 * ((b[ql + l] >> 4) + (b[qh + l] & u2 ? 16 : 0))) - m2);
    }
  };
  const q6_K = (b, o, y, at) => {
    const d = fp16(b[o + 208] | (b[o + 209] << 8));
    let ql = o, qh = o + 128, sc = o + 192;
    const s8 = (i) => (b[i] << 24) >> 24;
    for (let n = 0; n < 256; n += 128, ql += 64, qh += 32, sc += 8, at += 128) {
      for (let l = 0; l < 32; l++) {
        const is = l >> 4, h = b[qh + l];
        const q1 = ((b[ql + l] & 0xf) | (((h >> 0) & 3) << 4)) - 32;
        const q2 = ((b[ql + l + 32] & 0xf) | (((h >> 2) & 3) << 4)) - 32;
        const q3 = ((b[ql + l] >> 4) | (((h >> 4) & 3) << 4)) - 32;
        const q4 = ((b[ql + l + 32] >> 4) | (((h >> 6) & 3) << 4)) - 32;
        y[at + l] = f(f(d * s8(sc + is)) * q1);
        y[at + l + 32] = f(f(d * s8(sc + is + 2)) * q2);
        y[at + l + 64] = f(f(d * s8(sc + is + 4)) * q3);
        y[at + l + 96] = f(f(d * s8(sc + is + 6)) * q4);
      }
    }
  };
  const BLOCK = { Q4_0: q4_0, Q8_0: q8_0, Q4_K: q4_K, Q5_K: q5_K, Q6_K: q6_K };

  // Bytes of n elements of a type.
  const bytes = (type, n) => {
    const t = BLOCKS[name(type)];
    if (!t) fail(`unsupported type ${type}`);
    if (n % t[0]) fail(`${n} is not whole ${name(type)} blocks`);
    return (n / t[0]) * t[1];
  };

  // n elements of `type` from src (a Uint8Array starting at a block) into out at `at` (a new Float32Array by default).
  const dequantize = (type, src, n, out = new Float32Array(n), at = 0) => {
    const t = name(type), need = bytes(t, n);
    if (src.length < need) fail(`${t}: ${src.length} bytes, ${need} needed`);
    if (out.length < at + n) fail('output too short');
    if (t === 'F32') { out.set(new Float32Array(src.buffer.slice(src.byteOffset, src.byteOffset + need)), at); return out; }
    if (t === 'F16' || t === 'BF16') {
      const conv = t === 'F16' ? fp16 : bf16;
      for (let i = 0; i < n; i++) out[at + i] = conv(src[2 * i] | (src[2 * i + 1] << 8));
      return out;
    }
    const [per, size] = BLOCKS[t], fn = BLOCK[t];
    for (let blk = 0, o = 0; blk < n / per; blk++, o += size, at += per) fn(src, o, out, at);
    return out;
  };

  return { dequantize, bytes, fp16, bf16, BLOCKS, TYPES: Object.keys(BLOCKS) };
})();
if (typeof module !== 'undefined') module.exports = GZ_AI_QUANT; else GZ_AI_QUANT;
