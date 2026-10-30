// The picture encoder's gated 3 × 3 depthwise conv over the px × py patch grid, zero padded:
// Y[t][e] = C[t][e] · Σ w[k][e] · B[s][e] · X[s][e] over the neighbours s of patch t, k = 3 · dy + dx in order.
// One invocation per patch and 4 channels.
struct P { px: u32, py: u32, E: u32, p0: u32 }
@group(0) @binding(0) var<storage, read> B: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read> C: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> X: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read> w: array<vec4<f32>>; // [k 9][E / 4]
@group(0) @binding(4) var<storage, read_write> Y: array<vec4<f32>>;
@group(0) @binding(5) var<uniform> p: P;

@compute @workgroup_size(256)
fn main(@builtin(local_invocation_index) li: u32, @builtin(workgroup_id) wg: vec3<u32>, @builtin(num_workgroups) nw: vec3<u32>) {
  let E4 = p.E / 4u;
  let i = (wg.y * nw.x + wg.x) * 256u + li;
  if (i >= p.px * p.py * E4) { return; }
  let t = i / E4;
  let e = i % E4;
  let yy = i32(t / p.px);
  let xx = i32(t % p.px);
  var s = vec4<f32>(0.0);
  for (var dy = 0; dy < 3; dy++) {
    let sy = yy + dy - 1;
    if (sy < 0 || sy >= i32(p.py)) { continue; }
    for (var dx = 0; dx < 3; dx++) {
      let sx = xx + dx - 1;
      if (sx < 0 || sx >= i32(p.px)) { continue; }
      let o = (u32(sy) * p.px + u32(sx)) * E4 + e;
      s += w[u32(dy * 3 + dx) * E4 + e] * (B[o] * X[o]);
    }
  }
  Y[i] = C[i] * s;
}
