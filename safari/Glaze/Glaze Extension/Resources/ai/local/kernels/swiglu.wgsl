// SwiGLU in place: G[i] = silu(G[i]) · U[i] for i < n (n / 4 vec4).
struct P { n4: u32, p0: u32, p1: u32, p2: u32 }
@group(0) @binding(0) var<storage, read_write> G: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read> U: array<vec4<f32>>;
@group(0) @binding(2) var<uniform> p: P;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>, @builtin(num_workgroups) nw: vec3<u32>) {
  let i = gid.y * nw.x * 256u + gid.x;
  if (i >= p.n4) { return; }
  let g = G[i];
  G[i] = g / (vec4<f32>(1.0) + exp(-g)) * U[i];
}
