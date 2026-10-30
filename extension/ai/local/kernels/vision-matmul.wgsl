// The picture encoder's tiled GEMM: Y[t · rows + r] = W[r] · X[t · K ..] for t < T, r < rows, then + b[r] (BIAS),
// then GELU with erf (GELU), then added into Y (ACC). W is an F16 matrix, two values a word (WF32: F32), rows of K
// (a multiple of 16), rows a multiple of 4. A workgroup of 256 makes a 128-row × 64-token tile, 16 deep at a time,
// both into workgroup memory as H with k outermost; invocation (tx, ty) sums rows 4tx.. and 64 + 4tx.. for tokens 4ty..
// in f32, k in order.
struct P { rows: u32, K: u32, T: u32, p0: u32 }
@group(0) @binding(0) var<storage, read> W: array<vec4<u32>>;
@group(0) @binding(1) var<storage, read> X: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> Y: array<vec4<f32>>;
//#if BIAS
@group(0) @binding(3) var<storage, read> b: array<vec4<f32>>;
//#endif
@group(0) @binding(4) var<uniform> p: P;

var<workgroup> Ws: array<vec4<H>, 512>; // [k 16][row / 4: 32]
var<workgroup> Xs: array<vec4<H>, 256>; // [k 16][token / 4: 16]

//#if GELU
// 0.5 x (1 + erf(x / √2)) = 0.5 x · erfc(−x / √2), with erfc by Numerical Recipes' Chebyshev fit (relative error under
// 1.2e-7), taken as 2 − erfc(z) for x ≥ 0 so that neither side cancels.
fn erfc(z: f32) -> f32 {
  let t = 1.0 / (1.0 + 0.5 * z);
  let s = -1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277))))))));
  return t * exp(-z * z + s);
}
fn gelu(x: f32) -> f32 {
  let e = erfc(abs(x) * 0.70710678118654752);
  return select(0.5 * x * e, 0.5 * x * (2.0 - e), x >= 0.0);
}
//#endif

@compute @workgroup_size(256)
fn main(@builtin(local_invocation_index) li: u32, @builtin(workgroup_id) wg: vec3<u32>) {
  let r0 = wg.x * 128u;
  let t0 = wg.y * 64u;
  let tx = li % 16u;
  let ty = li / 16u;
  var acc: array<vec4<f32>, 8>; // [row group g: 2][token j: 4], a vec4 over 4 rows
  for (var s = 0u; s < p.K / 16u; s++) {
    // W: row li / 2, values 8 · (li % 2).. of this slice
    {
      let r = li / 2u;
      let half = li % 2u;
      var w: array<f32, 8>;
      if (r0 + r < p.rows) {
//#if WF32
        let a = W[((r0 + r) * p.K) / 4u + s * 4u + half * 2u];
        let c = W[((r0 + r) * p.K) / 4u + s * 4u + half * 2u + 1u];
        w = array<f32, 8>(bitcast<f32>(a.x), bitcast<f32>(a.y), bitcast<f32>(a.z), bitcast<f32>(a.w), bitcast<f32>(c.x), bitcast<f32>(c.y), bitcast<f32>(c.z), bitcast<f32>(c.w));
//#else
        let a = W[((r0 + r) * p.K) / 8u + s * 2u + half];
        let a0 = unpack2x16float(a.x);
        let a1 = unpack2x16float(a.y);
        let a2 = unpack2x16float(a.z);
        let a3 = unpack2x16float(a.w);
        w = array<f32, 8>(a0.x, a0.y, a1.x, a1.y, a2.x, a2.y, a3.x, a3.y);
//#endif
      }
      for (var i = 0u; i < 8u; i++) { Ws[(half * 8u + i) * 32u + r / 4u][r % 4u] = H(w[i]); }
    }
    // X: token li / 4, values 4 · (li % 4).. of this slice
    {
      let t = li / 4u;
      let k4 = li % 4u;
      var x = vec4<f32>(0.0);
      if (t0 + t < p.T) { x = X[((t0 + t) * p.K) / 4u + s * 4u + k4]; }
      for (var i = 0u; i < 4u; i++) { Xs[(k4 * 4u + i) * 16u + t / 4u][t % 4u] = H(x[i]); }
    }
    workgroupBarrier();
    for (var k = 0u; k < 16u; k++) {
      let a0 = vec4<f32>(Ws[k * 32u + tx]);
      let a1 = vec4<f32>(Ws[k * 32u + 16u + tx]);
      let x = vec4<f32>(Xs[k * 16u + ty]);
      acc[0] += a0 * x.x; acc[1] += a0 * x.y; acc[2] += a0 * x.z; acc[3] += a0 * x.w;
      acc[4] += a1 * x.x; acc[5] += a1 * x.y; acc[6] += a1 * x.z; acc[7] += a1 * x.w;
    }
    workgroupBarrier();
  }
  for (var j = 0u; j < 4u; j++) {
    let t = t0 + 4u * ty + j;
    if (t >= p.T) { break; }
    for (var g = 0u; g < 2u; g++) {
      let r = r0 + 64u * g + 4u * tx;
      if (r >= p.rows) { continue; }
      var v = acc[g * 4u + j];
//#if BIAS
      v += b[r / 4u];
//#endif
//#if GELU
      v = vec4<f32>(gelu(v.x), gelu(v.y), gelu(v.z), gelu(v.w));
//#endif
      let o = (t * p.rows + r) / 4u;
//#if ACC
      Y[o] += v;
//#else
      Y[o] = v;
//#endif
    }
  }
}
