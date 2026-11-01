// llama.cpp's repetition penalty on one row of logits L, in place, before the pick: for each of the `count` ids in I
// (each listed once), L[id] / r where it is positive, else L[id] · r.
struct P { count: u32, r: f32, p0: u32, p1: u32 }
@group(0) @binding(0) var<storage, read_write> L: array<f32>;
@group(0) @binding(1) var<storage, read> I: array<u32>;
@group(0) @binding(2) var<uniform> p: P;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (gid.x >= p.count) { return; }
  let id = I[gid.x];
  let v = L[id];
  L[id] = select(v * p.r, v / p.r, v > 0.0);
}
