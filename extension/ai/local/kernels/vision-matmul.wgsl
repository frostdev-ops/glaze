// The picture encoder's tiled GEMM: Y[t · rows + r] = W[r] · X[t · K ..] for t < T, r < rows, then + b[r] (BIAS),
// then GELU with erf (GELU), then added into Y (ACC). W is an F16 matrix, two values a word (WF32: F32), rows of K
// (a multiple of 16), rows a multiple of 4. A workgroup of 256 makes a 128-row × 64-token tile, 16 deep at a time,
// both into workgroup memory as H with k outermost, each vec4 stored whole by one invocation (component stores by
// different invocations race in WGSL); invocation (tx, ty) sums rows 4tx.. and 64 + 4tx.. for tokens 4ty..
// in f32, k in order.
struct P { rows: u32, K: u32, T: u32, p0: u32 }
@group(0) @binding(0) var<storage, read> W: array<u32>;
@group(0) @binding(1) var<storage, read> X: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> Y: array<vec4<f32>>;
//#if BIAS
@group(0) @binding(3) var<storage, read> b: array<vec4<f32>>;
//#endif
@group(0) @binding(4) var<uniform> p: P;

var<workgroup> Ws: array<vec4<H>, 512>; // [k 16][row / 4: 32]
var<workgroup> Xs: array<vec4<H>, 256>; // [k 16][token / 4: 16]

// Two adjacent values from one row, starting at an even column.
fn pair(row: u32, k: u32) -> vec2<f32> {
  let at = row * p.K + k;
//#if WF32
  return vec2<f32>(bitcast<f32>(W[at]), bitcast<f32>(W[at + 1u]));
//#else
  return unpack2x16float(W[at / 2u]);
//#endif
}

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
    // W: four rows at a time, two adjacent k's, two whole tile vectors per invocation.
    {
      let r = (li % 32u) * 4u;
      let k = (li / 32u) * 2u;
      var a = vec2<f32>(0.0);
      var b0 = vec2<f32>(0.0);
      var c = vec2<f32>(0.0);
      var d = vec2<f32>(0.0);
      if (r0 + r < p.rows) {
        a = pair(r0 + r, s * 16u + k);
        b0 = pair(r0 + r + 1u, s * 16u + k);
        c = pair(r0 + r + 2u, s * 16u + k);
        d = pair(r0 + r + 3u, s * 16u + k);
      }
      Ws[k * 32u + r / 4u] = vec4<H>(vec4<f32>(a.x, b0.x, c.x, d.x));
      Ws[(k + 1u) * 32u + r / 4u] = vec4<H>(vec4<f32>(a.y, b0.y, c.y, d.y));
    }
    // X: one k from four adjacent tokens, one whole tile vector per invocation.
    {
      let t = (li % 16u) * 4u;
      let k = li / 16u;
      var x = vec4<f32>(0.0);
      for (var j = 0u; j < 4u; j++) {
        if (t0 + t + j < p.T) { x[j] = X[((t0 + t + j) * p.K) / 4u + s * 4u + k / 4u][k % 4u]; }
      }
      Xs[li] = vec4<H>(x);
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
