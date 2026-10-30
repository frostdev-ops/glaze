// Tiled GEMM for T tokens: Y[t · ldy + yOff + r] = W[r] · X[t · xStride + xOff ..] for t < T, r < rows. A workgroup of
// 256 makes a 64-row × 64-token tile, 32 deep at a time: 64 invocations dequantize one sub-block of a row each (quant.wgsl),
// all load the tokens' 32 values, both into workgroup memory as H (f16 on the f16 path), rows of 8 vec4 along k padded to
// 9 (no bank conflicts), each vec4 stored whole by one invocation. Invocation (tx, ty) then sums rows tx + 16c and tokens
// ty + 16j (c, j < 4) in f32: four-term dot products, k in order.
struct P { rows: u32, K: u32, rowBytes: u32, T: u32, xStride: u32, xOff: u32, ldy: u32, yOff: u32 }
@group(0) @binding(0) var<storage, read> W: array<u32>;
@group(0) @binding(1) var<storage, read> X: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> Y: array<f32>;
@group(0) @binding(3) var<uniform> p: P;

var<workgroup> Ws: array<vec4<H>, 576>; // [row 64][k / 4: 8, +1]
var<workgroup> Xs: array<vec4<H>, 576>; // [token 64][k / 4: 8, +1]

@compute @workgroup_size(256)
fn main(@builtin(local_invocation_index) li: u32, @builtin(workgroup_id) wg: vec3<u32>) {
  let r0 = wg.x * 64u;
  let t0 = wg.y * 64u;
  let tx = li % 16u;
  let ty = li / 16u;
  var acc: array<vec4<f32>, 4>;
  for (var s = 0u; s < p.K / 32u; s++) {
    if (li < 64u) {
      let r = r0 + li;
      var w: array<vec4<f32>, 8>;
      if (r < p.rows) { w = deq32(r * p.rowBytes, s); }
      for (var i = 0u; i < 8u; i++) { Ws[li * 9u + i] = vec4<H>(w[i]); }
    }
    for (var e = li; e < 512u; e += 256u) {
      let t = e / 8u;
      let k4 = e % 8u;
      var x = vec4<f32>(0.0);
      if (t0 + t < p.T) { x = X[((t0 + t) * p.xStride + p.xOff) / 4u + s * 8u + k4]; }
      Xs[t * 9u + k4] = vec4<H>(x);
    }
    workgroupBarrier();
    for (var k4 = 0u; k4 < 8u; k4++) {
      let w0 = vec4<f32>(Ws[tx * 9u + k4]);
      let w1 = vec4<f32>(Ws[(tx + 16u) * 9u + k4]);
      let w2 = vec4<f32>(Ws[(tx + 32u) * 9u + k4]);
      let w3 = vec4<f32>(Ws[(tx + 48u) * 9u + k4]);
      for (var j = 0u; j < 4u; j++) {
        let x = vec4<f32>(Xs[(ty + 16u * j) * 9u + k4]);
        acc[j] += vec4<f32>(dot(w0, x), dot(w1, x), dot(w2, x), dot(w3, x));
      }
    }
    workgroupBarrier();
  }
  for (var j = 0u; j < 4u; j++) {
    let t = t0 + ty + 16u * j;
    if (t >= p.T) { break; }
    let a = acc[j];
    for (var c = 0u; c < 4u; c++) {
      let r = r0 + tx + 16u * c;
      if (r < p.rows) { Y[t * p.ldy + p.yOff + r] = a[c]; }
    }
  }
}
