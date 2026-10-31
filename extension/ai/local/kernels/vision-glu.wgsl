// The picture encoder's SwiGLU: G = silu(G) · U, one invocation per vec4 (n of them).
struct P { n: u32, p0: u32, p1: u32, p2: u32 }
@group(0) @binding(0) var<storage, read_write> G: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read> U: array<vec4<f32>>;
@group(0) @binding(2) var<uniform> p: P;

@compute @workgroup_size(256)
fn main(@builtin(local_invocation_index) li: u32, @builtin(workgroup_id) wg: vec3<u32>, @builtin(num_workgroups) nw: vec3<u32>) {
  let i = (wg.y * nw.x + wg.x) * 256u + li;
  if (i >= p.n) { return; }
  let g = G[i];
  G[i] = g / (1.0 + exp(-g)) * U[i];
}
