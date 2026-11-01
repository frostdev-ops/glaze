// The picture encoder's norms over rows of n (a multiple of 4), one workgroup of 256 per row (wg.x), sums in f32:
//   RMSNorm:    N[row] = X[row] · (1 / √(mean x² + ε)) · w
//   LAYER:      LayerNorm (x − mean) · (1 / √(mean (x − mean)² + ε)) · w + b, and row t of the px-wide patch grid goes
//               to the projector's merged rows: row (y / 2) · (px / 2) + x / 2, quarter 2 · (y % 2) + x % 2.
struct P { n: u32, eps: f32, px: u32, p0: u32 }
@group(0) @binding(0) var<storage, read> X: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read_write> N: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> w: array<vec4<f32>>;
//#if LAYER
@group(0) @binding(3) var<storage, read> b: array<vec4<f32>>;
//#endif
@group(0) @binding(4) var<uniform> p: P;

var<workgroup> red: array<f32, 256>;

fn total(v: f32, li: u32) -> f32 {
  red[li] = v;
  workgroupBarrier();
  for (var o = 128u; o > 0u; o >>= 1u) {
    if (li < o) { red[li] += red[li + o]; }
    workgroupBarrier();
  }
  let s = red[0];
  workgroupBarrier();
  return s;
}

@compute @workgroup_size(256)
fn main(@builtin(local_invocation_index) li: u32, @builtin(workgroup_id) wg: vec3<u32>) {
  let n4 = p.n / 4u;
  let row = wg.x;
  let o = row * n4;
//#if LAYER
  var sx = 0.0;
  for (var i = li; i < n4; i += 256u) { let v = X[o + i]; sx += v.x + v.y + v.z + v.w; }
  let mean = total(sx, li) / f32(p.n);
  var sd = 0.0;
  for (var i = li; i < n4; i += 256u) { let d = X[o + i] - mean; sd += dot(d, d); }
  let k = 1.0 / sqrt(total(sd, li) / f32(p.n) + p.eps);
  let y = row / p.px;
  let x = row % p.px;
  let to = (((y / 2u) * (p.px / 2u) + x / 2u) * 4u + 2u * (y % 2u) + x % 2u) * n4;
  for (var i = li; i < n4; i += 256u) { N[to + i] = (X[o + i] - mean) * k * w[i] + b[i]; }
//#else
  var sx = 0.0;
  for (var i = li; i < n4; i += 256u) { let v = X[o + i]; sx += dot(v, v); }
  let k = 1.0 / sqrt(total(sx, li) / f32(p.n) + p.eps);
  for (var i = li; i < n4; i += 256u) { N[o + i] = X[o + i] * k * w[i]; }
//#endif
}
