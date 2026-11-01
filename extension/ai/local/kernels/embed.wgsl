// Rows of a quantized matrix, dequantized (quant.wgsl): Y[t] = W[ids[t]] for t < n, each E long, where W holds rows
// row0 .. row0 + rows − 1 (one run of a split matrix; ids outside it are another run's). The embedding lookup, and the
// dequantization the checks hold to quant.js bit for bit. One invocation per 32-value sub-block (deq32, as the GEMM
// loads), or with GRP per run of 32 in storage order (grp, as the GEMV reads).
struct P { n: u32, E: u32, rowBytes: u32, row0: u32, rows: u32, p0: u32, p1: u32, p2: u32 }
@group(0) @binding(0) var<storage, read> W: array<u32>;
@group(0) @binding(1) var<storage, read> ids: array<u32>;
@group(0) @binding(2) var<storage, read_write> Y: array<vec4<f32>>;
@group(0) @binding(3) var<uniform> p: P;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>, @builtin(num_workgroups) nw: vec3<u32>) {
  let g = gid.y * nw.x * 64u + gid.x;
  let per = p.E / 32u;
  let t = g / per;
  if (t >= p.n) { return; }
  let id = ids[t];
  if (id < p.row0 || id - p.row0 >= p.rows) { return; }
  let s = g % per;
//#if GRP
  let q = grp((id - p.row0) * p.rowBytes, s);
  for (var i = 0u; i < 4u; i++) {
    Y[(t * p.E + q.ka) / 4u + i] = q.v[i];
    Y[(t * p.E + q.kb) / 4u + i] = q.v[4u + i];
  }
//#else
  let w = deq32((id - p.row0) * p.rowBytes, s);
  let o = (t * p.E) / 4u + s * 8u;
  for (var i = 0u; i < 8u; i++) { Y[o + i] = w[i]; }
//#endif
}
