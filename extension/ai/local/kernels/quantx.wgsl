// Two int8 planes per 32 activation values: x ≈ d0*q0 + d1*q1. Quantizing the residual avoids the
// first plane's ~1/254 relative error. The K-quant minimum correction uses the original sum of x.
struct P { K: u32, T: u32, xStride: u32, xOff: u32 }
@group(0) @binding(0) var<storage, read> X: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read_write> XQ: array<vec2<u32>>;
@group(0) @binding(2) var<storage, read_write> XD: array<vec4<f32>>;
@group(0) @binding(3) var<uniform> p: P;
fn packq(v: vec4<f32>, d: f32) -> u32 {
  let q = vec4<i32>(clamp(round(v * select(0.0, 1.0 / d, d > 0.0)), vec4<f32>(-127.0), vec4<f32>(127.0)));
  let u = bitcast<vec4<u32>>(q) & vec4<u32>(255u);
  return u.x | (u.y << 8u) | (u.z << 16u) | (u.w << 24u);
}
fn unpackq(q: u32) -> vec4<f32> {
  return vec4<f32>(vec4<i32>(bitcast<i32>(q << 24u), bitcast<i32>(q << 16u), bitcast<i32>(q << 8u), bitcast<i32>(q)) >> vec4<u32>(24u));
}
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) g: vec3<u32>, @builtin(num_workgroups) nw: vec3<u32>) {
  let nb = p.K / 32u;
  let i = g.y * nw.x * 256u + g.x;
  if (i >= p.T * nb) { return; }
  let t = i / nb;
  let b = i % nb;
  let x0 = (t * p.xStride + p.xOff) / 4u + 8u * b;
  var v: array<vec4<f32>, 8>;
  var q: array<u32, 8>;
  var amax = 0.0;
  var sum = 0.0;
  for (var k = 0u; k < 8u; k++) {
    v[k] = X[x0 + k];
    let a = abs(v[k]);
    amax = max(amax, max(max(a.x, a.y), max(a.z, a.w)));
    sum += v[k].x; sum += v[k].y; sum += v[k].z; sum += v[k].w;
  }
  let d0 = amax / 127.0;
  var rmax = 0.0;
  for (var k = 0u; k < 8u; k++) {
    q[k] = packq(v[k], d0);
    v[k] -= unpackq(q[k]) * d0;
    let a = abs(v[k]);
    rmax = max(rmax, max(max(a.x, a.y), max(a.z, a.w)));
  }
  let d1 = rmax / 127.0;
  for (var k = 0u; k < 8u; k++) { XQ[t * (p.K / 4u) + 8u * b + k] = vec2<u32>(q[k], packq(v[k], d1)); }
  XD[i] = vec4<f32>(d0, d1, sum, 0.0);
}
