// Tiled GEMM for T tokens: Y[t · ldy + yOff + r] = W[r] · X[t · xStride + xOff ..] for t < T, r < rows, 32 deep at a time:
// the rows' sub-blocks dequantized (quant.wgsl) and the tokens' values loaded into workgroup memory as H (f16 on the f16
// path), rows of 8 vec4 along k, each vec4 stored whole by one invocation. Sums in f32, four-term dot products, k in order.
//   (default) a 64-row × 64-token tile; invocation (tx, ty) sums rows tx + 16c and tokens ty + 16j, c, j < 4; rows padded
//             to 9 vec4 (no bank conflicts).
//   BIG       a 128 × 128 tile (32 KiB of f32): rows tx + 16c and tokens ty + 16j, c, j < 8, so each value read from
//             workgroup memory serves 8 products; vec4 column k4 of row r stored at k4 ^ (r mod 8) (no bank conflicts).
struct P { rows: u32, K: u32, rowBytes: u32, T: u32, xStride: u32, xOff: u32, ldy: u32, yOff: u32 }
@group(0) @binding(0) var<storage, read> W: array<u32>;
@group(0) @binding(1) var<storage, read> X: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> Y: array<f32>;
@group(0) @binding(3) var<uniform> p: P;

//#if BIG
const BM = 128u;
const RC = 8u; // rows (and tokens) per invocation
var<workgroup> Ws: array<vec4<H>, 1024>;
var<workgroup> Xs: array<vec4<H>, 1024>;
fn at(r: u32, k4: u32) -> u32 { return r * 8u + (k4 ^ (r & 7u)); }
//#else
const BM = 64u;
const RC = 4u;
var<workgroup> Ws: array<vec4<H>, 576>; // [row 64][k / 4: 8, +1]
var<workgroup> Xs: array<vec4<H>, 576>; // [token 64][k / 4: 8, +1]
fn at(r: u32, k4: u32) -> u32 { return r * 9u + k4; }
//#endif

@compute @workgroup_size(256)
fn main(@builtin(local_invocation_index) li: u32, @builtin(workgroup_id) wg: vec3<u32>) {
  let r0 = wg.x * BM;
  let t0 = wg.y * BM;
  let tx = li % 16u;
  let ty = li / 16u;
  // acc[j · RC / 4 + c / 4][c mod 4]: token ty + 16j, row tx + 16c.
  var acc: array<vec4<f32>, RC * RC / 4u>;
  for (var s = 0u; s < p.K / 32u; s++) {
    if (li < BM) {
      let r = r0 + li;
      var w: array<vec4<f32>, 8>;
      if (r < p.rows) { w = deq32(r * p.rowBytes, s); }
      for (var i = 0u; i < 8u; i++) { Ws[at(li, i)] = vec4<H>(w[i]); }
    }
    for (var e = li; e < BM * 8u; e += 256u) {
      let t = e / 8u;
      let k4 = e % 8u;
      var x = vec4<f32>(0.0);
      if (t0 + t < p.T) { x = X[((t0 + t) * p.xStride + p.xOff) / 4u + s * 8u + k4]; }
      Xs[at(t, k4)] = vec4<H>(x);
    }
    workgroupBarrier();
    for (var k4 = 0u; k4 < 8u; k4++) {
//#if BIG
      // Written out with constant indices, so the accumulators and operands stay in registers.
      let w0 = vec4<f32>(Ws[at(tx + 0u, k4)]);
      let w1 = vec4<f32>(Ws[at(tx + 16u, k4)]);
      let w2 = vec4<f32>(Ws[at(tx + 32u, k4)]);
      let w3 = vec4<f32>(Ws[at(tx + 48u, k4)]);
      let w4 = vec4<f32>(Ws[at(tx + 64u, k4)]);
      let w5 = vec4<f32>(Ws[at(tx + 80u, k4)]);
      let w6 = vec4<f32>(Ws[at(tx + 96u, k4)]);
      let w7 = vec4<f32>(Ws[at(tx + 112u, k4)]);
      { let x = vec4<f32>(Xs[at(ty + 0u, k4)]);
        acc[0] += vec4<f32>(dot(w0, x), dot(w1, x), dot(w2, x), dot(w3, x));
        acc[1] += vec4<f32>(dot(w4, x), dot(w5, x), dot(w6, x), dot(w7, x)); }
      { let x = vec4<f32>(Xs[at(ty + 16u, k4)]);
        acc[2] += vec4<f32>(dot(w0, x), dot(w1, x), dot(w2, x), dot(w3, x));
        acc[3] += vec4<f32>(dot(w4, x), dot(w5, x), dot(w6, x), dot(w7, x)); }
      { let x = vec4<f32>(Xs[at(ty + 32u, k4)]);
        acc[4] += vec4<f32>(dot(w0, x), dot(w1, x), dot(w2, x), dot(w3, x));
        acc[5] += vec4<f32>(dot(w4, x), dot(w5, x), dot(w6, x), dot(w7, x)); }
      { let x = vec4<f32>(Xs[at(ty + 48u, k4)]);
        acc[6] += vec4<f32>(dot(w0, x), dot(w1, x), dot(w2, x), dot(w3, x));
        acc[7] += vec4<f32>(dot(w4, x), dot(w5, x), dot(w6, x), dot(w7, x)); }
      { let x = vec4<f32>(Xs[at(ty + 64u, k4)]);
        acc[8] += vec4<f32>(dot(w0, x), dot(w1, x), dot(w2, x), dot(w3, x));
        acc[9] += vec4<f32>(dot(w4, x), dot(w5, x), dot(w6, x), dot(w7, x)); }
      { let x = vec4<f32>(Xs[at(ty + 80u, k4)]);
        acc[10] += vec4<f32>(dot(w0, x), dot(w1, x), dot(w2, x), dot(w3, x));
        acc[11] += vec4<f32>(dot(w4, x), dot(w5, x), dot(w6, x), dot(w7, x)); }
      { let x = vec4<f32>(Xs[at(ty + 96u, k4)]);
        acc[12] += vec4<f32>(dot(w0, x), dot(w1, x), dot(w2, x), dot(w3, x));
        acc[13] += vec4<f32>(dot(w4, x), dot(w5, x), dot(w6, x), dot(w7, x)); }
      { let x = vec4<f32>(Xs[at(ty + 112u, k4)]);
        acc[14] += vec4<f32>(dot(w0, x), dot(w1, x), dot(w2, x), dot(w3, x));
        acc[15] += vec4<f32>(dot(w4, x), dot(w5, x), dot(w6, x), dot(w7, x)); }
//#else
      let w0 = vec4<f32>(Ws[at(tx + 0u, k4)]);
      let w1 = vec4<f32>(Ws[at(tx + 16u, k4)]);
      let w2 = vec4<f32>(Ws[at(tx + 32u, k4)]);
      let w3 = vec4<f32>(Ws[at(tx + 48u, k4)]);
      { let x = vec4<f32>(Xs[at(ty + 0u, k4)]); acc[0] += vec4<f32>(dot(w0, x), dot(w1, x), dot(w2, x), dot(w3, x)); }
      { let x = vec4<f32>(Xs[at(ty + 16u, k4)]); acc[1] += vec4<f32>(dot(w0, x), dot(w1, x), dot(w2, x), dot(w3, x)); }
      { let x = vec4<f32>(Xs[at(ty + 32u, k4)]); acc[2] += vec4<f32>(dot(w0, x), dot(w1, x), dot(w2, x), dot(w3, x)); }
      { let x = vec4<f32>(Xs[at(ty + 48u, k4)]); acc[3] += vec4<f32>(dot(w0, x), dot(w1, x), dot(w2, x), dot(w3, x)); }
//#endif
    }
    workgroupBarrier();
  }
  for (var j = 0u; j < RC; j++) {
    let t = t0 + ty + 16u * j;
    if (t >= p.T) { break; }
    for (var c = 0u; c < RC; c++) {
      let r = r0 + tx + 16u * c;
      if (r < p.rows) { Y[t * p.ldy + p.yOff + r] = acc[j * (RC / 4u) + c / 4u][c % 4u]; }
    }
  }
}
