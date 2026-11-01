// GEMV for one token: Y[yOff + r] = W[r] · X[xOff ..] for r < rows, W quantized (quant.wgsl), X and Y f32. TPR lanes
// share a row (a run of TPR consecutive invocations), lane i taking runs i, i + TPR, … of 32 values (grp: consecutive
// lanes read consecutive words); 256 / TPR rows per workgroup, on a 2-D grid of workgroups (x · y ≥ rows / (256 / TPR)).
// GLU: W also holds a second matrix at byte upOff (ffn_up beside ffn_gate) and Y[r] = silu(gate[r] · X) · (up[r] · X).
// Sums in f32: per lane, its runs in turn (eight four-term dot products each); then the TPR lanes.
struct P { rows: u32, K: u32, rowBytes: u32, xOff: u32, yOff: u32, upOff: u32, p0: u32, p1: u32 }
@group(0) @binding(0) var<storage, read> W: array<u32>;
@group(0) @binding(1) var<storage, read> X: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> Y: array<f32>;
@group(0) @binding(3) var<uniform> p: P;

var<workgroup> red: array<f32, 256>;

// The sum of v over each run of TPR lanes, in every lane of the run. Called by every invocation.
fn rowsum(v: f32, li: u32) -> f32 {
//#if SUBGROUPS
  var s = v;
  for (var o = 1u; o < TPR; o <<= 1u) { s += subgroupShuffleXor(s, o); }
  return s;
//#else
  red[li] = v;
  workgroupBarrier();
  for (var o = TPR >> 1u; o > 0u; o >>= 1u) {
    if ((li % TPR) < o) { red[li] += red[li + o]; }
    workgroupBarrier();
  }
  let s = red[li - li % TPR];
  workgroupBarrier();
  return s;
//#endif
}

@compute @workgroup_size(256)
fn main(@builtin(local_invocation_index) li: u32, @builtin(workgroup_id) wg: vec3<u32>, @builtin(num_workgroups) nw: vec3<u32>) {
  let r = (wg.y * nw.x + wg.x) * (256u / TPR) + li / TPR;
  var a = 0.0;
  var u = 0.0;
  if (r < p.rows) {
    let rb = r * p.rowBytes;
    let xo = p.xOff / 4u;
    for (var c = li % TPR; c < p.K / 32u; c += TPR) {
      let q = grp(rb, c);
//#if GLU
      let v = grp(p.upOff + rb, c);
//#endif
      for (var i = 0u; i < 4u; i++) {
        let xa = X[xo + q.ka / 4u + i];
        let xb = X[xo + q.kb / 4u + i];
        a += dot(q.v[i], xa) + dot(q.v[4u + i], xb);
//#if GLU
        u += dot(v.v[i], xa) + dot(v.v[4u + i], xb);
//#endif
      }
    }
  }
  let g = rowsum(a, li);
//#if GLU
  let up = rowsum(u, li);
//#endif
  if (li % TPR == 0u && r < p.rows) {
//#if GLU
    Y[p.yOff + r] = g / (1.0 + exp(-g)) * up;
//#else
    Y[p.yOff + r] = g;
//#endif
  }
}
