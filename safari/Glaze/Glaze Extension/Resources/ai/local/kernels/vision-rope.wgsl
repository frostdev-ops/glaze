// The picture encoder's q and k for every patch, in place: each head's 64 values RMS-normed (weights wq, wk), then 2-D
// RoPE: pairs (j, j + 32) turned by angle R[t][j] (the table holds the reference's own f32 cos and sin). One workgroup
// of 64 per head (q heads, then k heads: wg.x) and patch (wg.y).
struct P { H: u32, Hkv: u32, eps: f32, p0: u32 }
@group(0) @binding(0) var<storage, read_write> Q: array<f32>;
@group(0) @binding(1) var<storage, read_write> K: array<f32>;
@group(0) @binding(2) var<storage, read> wq: array<f32>;
@group(0) @binding(3) var<storage, read> wk: array<f32>;
@group(0) @binding(4) var<storage, read> R: array<vec2<f32>>; // [patch][32] (cos, sin)
@group(0) @binding(5) var<uniform> p: P;

var<workgroup> red: array<f32, 64>;
var<workgroup> nv: array<f32, 64>;

@compute @workgroup_size(64)
fn main(@builtin(local_invocation_index) li: u32, @builtin(workgroup_id) wg: vec3<u32>) {
  let t = wg.y;
  let isQ = wg.x < p.H;
  var x: f32;
  var w: f32;
  if (isQ) { x = Q[(t * p.H + wg.x) * 64u + li]; w = wq[li]; } else { x = K[(t * p.Hkv + wg.x - p.H) * 64u + li]; w = wk[li]; }
  red[li] = x * x;
  workgroupBarrier();
  for (var o = 32u; o > 0u; o >>= 1u) {
    if (li < o) { red[li] += red[li + o]; }
    workgroupBarrier();
  }
  let n = x * (1.0 / sqrt(red[0] / 64.0 + p.eps)) * w;
  nv[li] = n;
  workgroupBarrier();
  let cs = R[t * 32u + li % 32u];
  var y: f32;
  if (li < 32u) { y = n * cs.x - nv[li + 32u] * cs.y; } else { y = nv[li - 32u] * cs.y + n * cs.x; }
  if (isQ) { Q[(t * p.H + wg.x) * 64u + li] = y; } else { K[(t * p.Hkv + wg.x - p.H) * 64u + li] = y; }
}
