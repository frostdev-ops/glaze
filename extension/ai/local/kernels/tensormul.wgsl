// One subgroup computes a 16-row × 16-token tile. i8 products and int32 accumulation are exact.
// K-quants apply their scale/min after each 32-value block. Q6_K retains the ordinary GEMM.
struct P { rows: u32, K: u32, rowBytes: u32, T: u32, xStride: u32, xOff: u32, ldy: u32, yOff: u32 }
@group(0) @binding(0) var<storage, read> W: array<u32>;
@group(0) @binding(1) var<storage, read> XQ: array<vec2<u32>>;
@group(0) @binding(2) var<storage, read_write> Y: array<f32>;
@group(0) @binding(3) var<uniform> p: P;
@group(0) @binding(4) var<storage, read> XD: array<vec4<f32>>;
var<workgroup> ws: array<i32, 128>;
var<workgroup> x0: array<i32, 128>;
var<workgroup> x1: array<i32, 128>;
var<workgroup> y0: array<i32, 256>;
var<workgroup> y1: array<i32, 256>;
var<workgroup> scales: array<vec2<f32>, 16>;
var<workgroup> ds: array<vec4<f32>, 16>;
@compute @workgroup_size(32)
fn main(@builtin(local_invocation_index) li: u32, @builtin(workgroup_id) wg: vec3<u32>) {
  var acc: array<f32, 8>;
  for (var s = 0u; s < p.K / 32u; s++) {
    for (var j = li; j < 128u; j += 32u) {
      let row = j / 8u;
      let w = j % 8u;
      var q = 0u;
      if (wg.x * 16u + row < p.rows) { q = iq((wg.x * 16u + row) * p.rowBytes, s, w); }
      ws[j] = bitcast<i32>(q);
      var x = vec2<u32>(0u);
      if (wg.y * 16u + row < p.T) { x = XQ[(wg.y * 16u + row) * (p.K / 4u) + s * 8u + w]; }
      x0[j] = bitcast<i32>(x.x); x1[j] = bitcast<i32>(x.y);
    }
    if (li < 16u) {
      let row = wg.x * 16u + li;
      scales[li] = vec2<f32>(0.0);
      if (row < p.rows) { scales[li] = sc(hd(row * p.rowBytes, s), row * p.rowBytes, s); }
      ds[li] = vec4<f32>(0.0);
      if (wg.y * 16u + li < p.T) { ds[li] = XD[(wg.y * 16u + li) * (p.K / 32u) + s]; }
    }
    workgroupBarrier();
    let a = subgroupMatrixLoad<subgroup_matrix_left<i8, 32, 16>>(&ws, 0u, false, 32u);
    let b0 = subgroupMatrixLoad<subgroup_matrix_right<i8, 16, 32>>(&x0, 0u, true, 32u);
    let b1 = subgroupMatrixLoad<subgroup_matrix_right<i8, 16, 32>>(&x1, 0u, true, 32u);
    let c0 = subgroupMatrixMultiply<i32>(a, b0);
    let c1 = subgroupMatrixMultiply<i32>(a, b1);
    subgroupMatrixStore(&y0, 0u, c0, false, 16u);
    subgroupMatrixStore(&y1, 0u, c1, false, 16u);
    workgroupBarrier();
    for (var j = 0u; j < 8u; j++) {
      let at = li + j * 32u;
      let r = at / 16u;
      let t = at % 16u;
      let d = ds[t];
      acc[j] += scales[r].x * (f32(y0[at]) * d.x + f32(y1[at]) * d.y);
//#if Q4_K || Q5_K
      acc[j] -= scales[r].y * d.z;
//#endif
    }
    workgroupBarrier();
  }
  for (var j = 0u; j < 8u; j++) {
    let at = li + j * 32u;
    let r = wg.x * 16u + at / 16u;
    let t = wg.y * 16u + at % 16u;
    if (r < p.rows && t < p.T) { Y[t * p.ldy + p.yOff + r] = acc[j]; }
  }
}
