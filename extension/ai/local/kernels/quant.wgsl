// Dequantization of ggml blocks inside a kernel, bit for bit as ai/local/quant.js: W holds a matrix's rows in the
// GGUF's own block layout (little-endian), row r at byte r · rowBytes. deq32(rb, s) is the 32 values of sub-block s of
// the row at byte rb, as 8 vec4. Every product here is exact in f32 (a binary16 scale has 11 significant bits, a
// sub-scale ≤ 8, a quant ≤ 6), so only Q4_K's and Q5_K's "− min" rounds, once, fused or not: the values equal ggml's.
// grp(rb, c) is the row's c-th run of 32 values in storage order (four consecutive words of quants, so consecutive runs
// are consecutive bytes: the GEMV's lanes read coalesced, one scale decode per 32 values): v[0..4] at ka.., v[4..8] at kb...
// A GEMM's row stream, for values 4w..4w + 3 of sub-block s alone (lanes share a row's words, each reading its own) and
// the next words read before the values are made: hd(rb, s), the words of its scales (its superblock's for the K
// types); sc(h, rb, s) → (d·scale, dmin·min), or Q6_K's two scales; qw(rb, s, w), the quant words; v4(q, k, rb, s, w),
// the values: v4(qw(rb, s, w), sc(hd(rb, s), rb, s), rb, s, w) is deq32(rb, s)[w], bit for bit.
// Needs `W: array<u32>` bound by the kernel.
struct G { v: array<vec4<f32>, 8>, ka: u32, kb: u32 }

// A binary16 as f32, exactly (subnormals included).
fn h2f(h: u32) -> f32 {
  let e = (h >> 10u) & 31u;
  let m = h & 1023u;
  var v = bitcast<f32>(((e + 112u) << 23u) | (m << 13u));
  if (e == 0u) { v = f32(m) * 5.9604644775390625e-8; }
  if (e == 31u) { v = bitcast<f32>(0x7f800000u | (m << 13u)); }
  return select(v, -v, (h & 0x8000u) != 0u);
}
// The byte, the 16 bits and the 32 bits at byte offset b (b even for the last two).
fn wb(b: u32) -> u32 { return (W[b >> 2u] >> ((b & 3u) * 8u)) & 255u; }
fn w16(b: u32) -> u32 { return (W[b >> 2u] >> ((b & 2u) * 8u)) & 65535u; }
fn w32(b: u32) -> u32 {
  let i = b >> 2u;
  if ((b & 2u) == 0u) { return W[i]; }
  return (W[i] >> 16u) | (W[i + 1u] << 16u);
}
fn bytes4(q: u32) -> vec4<u32> { return vec4<u32>(q, q >> 8u, q >> 16u, q >> 24u) & vec4<u32>(255u); }

//#if Q8_0
// 32 values, 34 bytes: d f16, 32 int8.
fn deq32(rb: u32, s: u32) -> array<vec4<f32>, 8> {
  let b = rb + s * 34u;
  let d = h2f(w16(b));
  var o: array<vec4<f32>, 8>;
  for (var i = 0u; i < 8u; i++) {
    let q = w32(b + 2u + 4u * i);
    let v = vec4<i32>(bitcast<i32>(q << 24u), bitcast<i32>(q << 16u), bitcast<i32>(q << 8u), bitcast<i32>(q)) >> vec4<u32>(24u);
    o[i] = d * vec4<f32>(v);
  }
  return o;
}
fn grp(rb: u32, c: u32) -> G { return G(deq32(rb, c), c * 32u, c * 32u + 16u); }
fn hd(rb: u32, s: u32) -> vec4<u32> { return vec4<u32>(W[(rb + s * 34u) >> 2u], 0u, 0u, 0u); }
fn sc(h: vec4<u32>, rb: u32, s: u32) -> vec2<f32> { return vec2<f32>(h2f((h.x >> (((rb + s * 34u) & 2u) * 8u)) & 65535u), 0.0); }
fn qw(rb: u32, s: u32, w: u32) -> vec4<u32> {
  let b = rb + s * 34u + 2u + 4u * w;
  let i = b >> 2u;
  // An aligned final vec4 can end at the binding's end; only unaligned values need the following word.
  var hi = 0u;
  if ((b & 2u) != 0u) { hi = W[i + 1u]; }
  return vec4<u32>(W[i], hi, 0u, 0u);
}
fn v4(q: vec4<u32>, k: vec2<f32>, rb: u32, s: u32, w: u32) -> vec4<f32> {
  let x = select((q.x >> 16u) | (q.y << 16u), q.x, ((rb + s * 34u + 2u) & 2u) == 0u);
  let v = vec4<i32>(bitcast<i32>(x << 24u), bitcast<i32>(x << 16u), bitcast<i32>(x << 8u), bitcast<i32>(x)) >> vec4<u32>(24u);
  return k.x * vec4<f32>(v);
}
//#endif

//#if Q4_K || Q5_K
// get_scale_min_k4: the j-th six-bit scale and min of the 12 scale bytes in sc.
fn scmin(sc: vec3<u32>, j: u32) -> vec2<u32> {
  let a = (sc[j >> 2u] >> ((j & 3u) * 8u)) & 255u;            // byte j
  let b = (sc[(j + 4u) >> 2u] >> (((j + 4u) & 3u) * 8u)) & 255u; // byte j + 4
  if (j < 4u) { return vec2<u32>(a & 63u, b & 63u); }
  let c = (sc[(j - 4u) >> 2u] >> (((j - 4u) & 3u) * 8u)) & 255u; // byte j - 4
  return vec2<u32>((b & 15u) | ((c >> 6u) << 4u), (b >> 4u) | ((a >> 6u) << 4u));
}
//#endif

//#if Q4_K
// 256 values, 144 bytes: d, dmin f16, 12 scale bytes, 128 bytes of nibbles. Sub-block is (0..7) of a superblock is the
// low (is even) or high nibbles of qs[32·(is >> 1) ..][0..32), × d·scale − dmin·min.
fn deq32(rb: u32, s: u32) -> array<vec4<f32>, 8> {
  let b = (rb + (s >> 3u) * 144u) >> 2u;
  let is = s & 7u;
  let dm = W[b];
  let m = scmin(vec3<u32>(W[b + 1u], W[b + 2u], W[b + 3u]), is);
  let d1 = h2f(dm & 65535u) * f32(m.x);
  let m1 = h2f(dm >> 16u) * f32(m.y);
  let sh = vec4<u32>((is & 1u) * 4u);
  let q0 = b + 4u + 8u * (is >> 1u);
  var o: array<vec4<f32>, 8>;
  for (var i = 0u; i < 8u; i++) {
    o[i] = d1 * vec4<f32>((bytes4(W[q0 + i]) >> sh) & vec4<u32>(15u)) - m1;
  }
  return o;
}
// Words w0..w0 + 3 of qs (w0 = 4·(c mod 8)): low nibbles are values 64j + l.. (sub-block 2j), high 64j + 32 + l..
// (2j + 1), j = w0 / 8, l = 4·(w0 mod 8).
fn grp(rb: u32, c: u32) -> G {
  let b = (rb + (c >> 3u) * 144u) >> 2u;
  let w0 = 4u * (c & 7u);
  let j = w0 >> 3u;
  let dm = W[b];
  let sc = vec3<u32>(W[b + 1u], W[b + 2u], W[b + 3u]);
  let s1 = scmin(sc, 2u * j);
  let s2 = scmin(sc, 2u * j + 1u);
  let d = h2f(dm & 65535u);
  let mn = h2f(dm >> 16u);
  let d1 = d * f32(s1.x);
  let m1 = mn * f32(s1.y);
  let d2 = d * f32(s2.x);
  let m2 = mn * f32(s2.y);
  var g: G;
  for (var i = 0u; i < 4u; i++) {
    let q = bytes4(W[b + 4u + w0 + i]);
    g.v[i] = d1 * vec4<f32>(q & vec4<u32>(15u)) - m1;
    g.v[4u + i] = d2 * vec4<f32>(q >> vec4<u32>(4u)) - m2;
  }
  g.ka = (c >> 3u) * 256u + 64u * j + 4u * (w0 & 7u);
  g.kb = g.ka + 32u;
  return g;
}
fn hd(rb: u32, s: u32) -> vec4<u32> { let b = (rb + (s >> 3u) * 144u) >> 2u; return vec4<u32>(W[b], W[b + 1u], W[b + 2u], W[b + 3u]); }
fn sc(h: vec4<u32>, rb: u32, s: u32) -> vec2<f32> {
  let m = scmin(h.yzw, s & 7u);
  return vec2<f32>(h2f(h.x & 65535u) * f32(m.x), h2f(h.x >> 16u) * f32(m.y));
}
fn qw(rb: u32, s: u32, w: u32) -> vec4<u32> { return vec4<u32>(W[((rb + (s >> 3u) * 144u) >> 2u) + 4u + 8u * ((s & 7u) >> 1u) + w], 0u, 0u, 0u); }
fn v4(q: vec4<u32>, k: vec2<f32>, rb: u32, s: u32, w: u32) -> vec4<f32> {
  return k.x * vec4<f32>((bytes4(q.x) >> vec4<u32>((s & 1u) * 4u)) & vec4<u32>(15u)) - k.y;
}
//#endif

//#if Q5_K
// 256 values, 176 bytes: d, dmin, 12 scale bytes, qh[32] (bit is of qh[l] is the fifth bit), qs[128] as in Q4_K.
fn deq32(rb: u32, s: u32) -> array<vec4<f32>, 8> {
  let b = (rb + (s >> 3u) * 176u) >> 2u;
  let is = s & 7u;
  let dm = W[b];
  let m = scmin(vec3<u32>(W[b + 1u], W[b + 2u], W[b + 3u]), is);
  let d1 = h2f(dm & 65535u) * f32(m.x);
  let m1 = h2f(dm >> 16u) * f32(m.y);
  let sh = vec4<u32>((is & 1u) * 4u);
  let hb = vec4<u32>(is);
  let q0 = b + 12u + 8u * (is >> 1u);
  var o: array<vec4<f32>, 8>;
  for (var i = 0u; i < 8u; i++) {
    let lo = (bytes4(W[q0 + i]) >> sh) & vec4<u32>(15u);
    let hi = ((bytes4(W[b + 4u + i]) >> hb) & vec4<u32>(1u)) << vec4<u32>(4u);
    o[i] = d1 * vec4<f32>(lo + hi) - m1;
  }
  return o;
}
fn grp(rb: u32, c: u32) -> G {
  let b = (rb + (c >> 3u) * 176u) >> 2u;
  let w0 = 4u * (c & 7u);
  let j = w0 >> 3u;
  let dm = W[b];
  let sc = vec3<u32>(W[b + 1u], W[b + 2u], W[b + 3u]);
  let s1 = scmin(sc, 2u * j);
  let s2 = scmin(sc, 2u * j + 1u);
  let d = h2f(dm & 65535u);
  let mn = h2f(dm >> 16u);
  let d1 = d * f32(s1.x);
  let m1 = mn * f32(s1.y);
  let d2 = d * f32(s2.x);
  let m2 = mn * f32(s2.y);
  var g: G;
  for (var i = 0u; i < 4u; i++) {
    let q = bytes4(W[b + 12u + w0 + i]);
    let h = bytes4(W[b + 4u + (w0 & 7u) + i]);
    g.v[i] = d1 * vec4<f32>((q & vec4<u32>(15u)) + (((h >> vec4<u32>(2u * j)) & vec4<u32>(1u)) << vec4<u32>(4u))) - m1;
    g.v[4u + i] = d2 * vec4<f32>((q >> vec4<u32>(4u)) + (((h >> vec4<u32>(2u * j + 1u)) & vec4<u32>(1u)) << vec4<u32>(4u))) - m2;
  }
  g.ka = (c >> 3u) * 256u + 64u * j + 4u * (w0 & 7u);
  g.kb = g.ka + 32u;
  return g;
}
fn hd(rb: u32, s: u32) -> vec4<u32> { let b = (rb + (s >> 3u) * 176u) >> 2u; return vec4<u32>(W[b], W[b + 1u], W[b + 2u], W[b + 3u]); }
fn sc(h: vec4<u32>, rb: u32, s: u32) -> vec2<f32> {
  let m = scmin(h.yzw, s & 7u);
  return vec2<f32>(h2f(h.x & 65535u) * f32(m.x), h2f(h.x >> 16u) * f32(m.y));
}
fn qw(rb: u32, s: u32, w: u32) -> vec4<u32> {
  let b = (rb + (s >> 3u) * 176u) >> 2u;
  return vec4<u32>(W[b + 12u + 8u * ((s & 7u) >> 1u) + w], W[b + 4u + w], 0u, 0u);
}
fn v4(q: vec4<u32>, k: vec2<f32>, rb: u32, s: u32, w: u32) -> vec4<f32> {
  let lo = (bytes4(q.x) >> vec4<u32>((s & 1u) * 4u)) & vec4<u32>(15u);
  let hi = ((bytes4(q.y) >> vec4<u32>(s & 7u)) & vec4<u32>(1u)) << vec4<u32>(4u);
  return k.x * vec4<f32>(lo + hi) - k.y;
}
//#endif

//#if Q6_K
// 256 values, 210 bytes (so blocks are only 2-aligned): ql[128], qh[64], int8 scales[16], d f16. Sub-block s of a
// superblock: half n = s >> 2, quarter q = s & 3; value l (0..31) is the low (q < 2) or high nibble of
// ql[64n + 32·(q & 1) + l] with bits 2q, 2q + 1 of qh[32n + l] above it, minus 32, × d·scales[8n + 2q + (l >> 4)].
fn deq32(rb: u32, s: u32) -> array<vec4<f32>, 8> {
  let bb = rb + (s >> 3u) * 210u;
  let n = (s >> 2u) & 1u;
  let q = s & 3u;
  let d = h2f(w16(bb + 208u));
  let sc = bb + 192u + 8u * n + 2u * q;
  let da = d * f32(bitcast<i32>(wb(sc) << 24u) >> 24u);
  let db = d * f32(bitcast<i32>(wb(sc + 1u) << 24u) >> 24u);
  let ql = bb + 64u * n + 32u * (q & 1u);
  let qh = bb + 128u + 32u * n;
  let sh = vec4<u32>(4u * (q >> 1u));
  let hs = vec4<u32>(2u * q);
  var o: array<vec4<f32>, 8>;
  for (var i = 0u; i < 8u; i++) {
    let v = ((bytes4(w32(ql + 4u * i)) >> sh) & vec4<u32>(15u)) | (((bytes4(w32(qh + 4u * i)) >> hs) & vec4<u32>(3u)) << vec4<u32>(4u));
    o[i] = select(db, da, i < 4u) * vec4<f32>(vec4<i32>(v) - vec4<i32>(32));
  }
  return o;
}
// Words w0..w0 + 3 of ql (w0 = 4·(c mod 8)): half n = w0 / 16; its first 8 words are ql[64n + l..] (quarters 0 and 2),
// the next 8 ql[64n + 32 + l..] (quarters 1 and 3), l = 4·(w0 mod 8); qh[32n + l..] above both.
fn grp(rb: u32, c: u32) -> G {
  let bb = rb + (c >> 3u) * 210u;
  let w0 = 4u * (c & 7u);
  let n = w0 >> 4u;
  let hq = (w0 >> 3u) & 1u;
  let l = 4u * (w0 & 7u);
  let d = h2f(w16(bb + 208u));
  let sc = bb + 192u + 8u * n + (l >> 4u) + 2u * hq;
  let da = d * f32(bitcast<i32>(wb(sc) << 24u) >> 24u);
  let db = d * f32(bitcast<i32>(wb(sc + 4u) << 24u) >> 24u);
  let ha = vec4<u32>(2u * hq);
  let hb = vec4<u32>(4u + 2u * hq);
  var g: G;
  for (var i = 0u; i < 4u; i++) {
    let q = bytes4(w32(bb + 64u * n + 32u * hq + l + 4u * i));
    let h = bytes4(w32(bb + 128u + 32u * n + l + 4u * i));
    g.v[i] = da * vec4<f32>(vec4<i32>((q & vec4<u32>(15u)) | (((h >> ha) & vec4<u32>(3u)) << vec4<u32>(4u))) - vec4<i32>(32));
    g.v[4u + i] = db * vec4<f32>(vec4<i32>((q >> vec4<u32>(4u)) | (((h >> hb) & vec4<u32>(3u)) << vec4<u32>(4u))) - vec4<i32>(32));
  }
  g.ka = (c >> 3u) * 256u + 128u * n + 32u * hq + l;
  g.kb = g.ka + 64u;
  return g;
}
// sc: the scales of values 0..15 and 16..31.
fn hd(rb: u32, s: u32) -> vec4<u32> {
  let bb = rb + (s >> 3u) * 210u;
  return vec4<u32>(W[(bb + 208u) >> 2u], W[(bb + 192u + 8u * ((s >> 2u) & 1u) + 2u * (s & 3u)) >> 2u], 0u, 0u);
}
fn sc(h: vec4<u32>, rb: u32, s: u32) -> vec2<f32> {
  let bb = rb + (s >> 3u) * 210u;
  let c = bb + 192u + 8u * ((s >> 2u) & 1u) + 2u * (s & 3u);
  let d = h2f((h.x >> (((bb + 208u) & 2u) * 8u)) & 65535u);
  let two = h.y >> ((c & 3u) * 8u);
  return vec2<f32>(d * f32(bitcast<i32>((two & 255u) << 24u) >> 24u), d * f32(bitcast<i32>(((two >> 8u) & 255u) << 24u) >> 24u));
}
fn qw(rb: u32, s: u32, w: u32) -> vec4<u32> {
  let bb = rb + (s >> 3u) * 210u;
  let n = (s >> 2u) & 1u;
  let l = (bb + 64u * n + 32u * (s & 1u) + 4u * w) >> 2u;
  let h = (bb + 128u + 32u * n + 4u * w) >> 2u;
  return vec4<u32>(W[l], W[l + 1u], W[h], W[h + 1u]);
}
fn v4(q: vec4<u32>, k: vec2<f32>, rb: u32, s: u32, w: u32) -> vec4<f32> {
  let qq = s & 3u;
  let odd = ((rb + (s >> 3u) * 210u) & 2u) != 0u;
  let l = select(q.x, (q.x >> 16u) | (q.y << 16u), odd);
  let h = select(q.z, (q.z >> 16u) | (q.w << 16u), odd);
  let v = ((bytes4(l) >> vec4<u32>(4u * (qq >> 1u))) & vec4<u32>(15u)) | (((bytes4(h) >> vec4<u32>(2u * qq)) & vec4<u32>(3u)) << vec4<u32>(4u));
  return select(k.y, k.x, w < 4u) * vec4<f32>(vec4<i32>(v) - vec4<i32>(32));
}
//#endif
