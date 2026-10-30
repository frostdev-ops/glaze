// Attention's per-head step before the scores, for T tokens at positions pos..: each of the H query heads and Hkv key
// heads (head_dim D, invocation i < D / 2 holding dims i and i + D / 2) is RMS-normed with its norm weights, then turned
// by NeoX RoPE: (x_i, x_{i+D/2}) → (x_i·cos − x_{i+D/2}·sin, x_i·sin + x_{i+D/2}·cos), cos and sin from CS (the session's
// table, rows of D / 2 (cos, sin) per position, made in double precision and rounded to f32 as the reference does).
// Queries are written back in place; keys, and the values beside them, go to the caches at slot pos (mod ring when the
// layer slides, ring > 0), as H.
struct P { T: u32, pos: u32, H: u32, Hkv: u32, D: u32, ring: u32, eps: f32, p0: u32 }
@group(0) @binding(0) var<storage, read_write> Q: array<f32>;
@group(0) @binding(1) var<storage, read> Kn: array<f32>;
@group(0) @binding(2) var<storage, read> Vn: array<f32>;
@group(0) @binding(3) var<storage, read_write> Kc: array<H>;
@group(0) @binding(4) var<storage, read_write> Vc: array<H>;
@group(0) @binding(5) var<storage, read> qw: array<f32>;
@group(0) @binding(6) var<storage, read> kw: array<f32>;
@group(0) @binding(7) var<storage, read> CS: array<vec2<f32>>;
@group(0) @binding(8) var<uniform> p: P;

var<workgroup> red: array<f32, 128>;

@compute @workgroup_size(64)
fn main(@builtin(local_invocation_index) li: u32, @builtin(workgroup_id) wg: vec3<u32>) {
  let half = p.D / 2u;
  let h = wg.x;
  let t = wg.y;
  let isQ = h < p.H;
  var x0 = 0.0;
  var x1 = 0.0;
  var o = 0u;
  if (li < half) {
    if (isQ) { o = (t * p.H + h) * p.D; x0 = Q[o + li]; x1 = Q[o + li + half]; }
    else { o = (t * p.Hkv + h - p.H) * p.D; x0 = Kn[o + li]; x1 = Kn[o + li + half]; }
  }
  // Sum of squares over the head (up to 128 dims by up to 64 invocations).
  red[li] = x0 * x0 + x1 * x1;
  workgroupBarrier();
  for (var s = 32u; s > 0u; s >>= 1u) {
    if (li < s) { red[li] += red[li + s]; }
    workgroupBarrier();
  }
  let k = 1.0 / sqrt(red[0] / f32(p.D) + p.eps);
  if (li >= half) { return; }
  var y0 = 0.0;
  var y1 = 0.0;
  if (isQ) { y0 = x0 * k * qw[li]; y1 = x1 * k * qw[li + half]; }
  else { y0 = x0 * k * kw[li]; y1 = x1 * k * kw[li + half]; }
  let cs = CS[(p.pos + t) * half + li];
  let r0 = y0 * cs.x - y1 * cs.y;
  let r1 = y0 * cs.y + y1 * cs.x;
  if (isQ) { Q[o + li] = r0; Q[o + li + half] = r1; return; }
  var slot = p.pos + t;
  if (p.ring > 0u) { slot = slot % p.ring; }
  let c = (slot * p.Hkv + h - p.H) * p.D;
  Kc[c + li] = H(r0);
  Kc[c + li + half] = H(r1);
  Vc[c + li] = H(Vn[o + li]);
  Vc[c + li + half] = H(Vn[o + li + half]);
}
