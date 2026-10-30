// RMSNorm over rows of n (a multiple of 4), one workgroup of 256 per row: x / √(mean x² + ε) · w, the sum of squares in
// f32 (each invocation's values in turn, then a tree), x · scale · w in that order as the reference.
//   plain:  N[row] = rmsnorm(X[row]) · w1
//   ADD:    the residual step around an op's output A: a = rmsnorm(A[row]) · w1 (POST, else a = A[row]); X[row] += a;
//           N[row] = rmsnorm(X[row]) · w2 (the next norm).
struct P { n: u32, eps: f32, p0: u32, p1: u32 }
//#if ADD
@group(0) @binding(0) var<storage, read> A: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read_write> X: array<vec4<f32>>;
//#else
@group(0) @binding(1) var<storage, read> X: array<vec4<f32>>;
//#endif
@group(0) @binding(2) var<storage, read_write> N: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read> w1: array<vec4<f32>>;
//#if ADD
@group(0) @binding(4) var<storage, read> w2: array<vec4<f32>>;
//#endif
@group(0) @binding(5) var<uniform> p: P;

var<workgroup> red: array<f32, 256>;

fn total(v: f32, li: u32) -> f32 {
  red[li] = v;
  workgroupBarrier();
  for (var o = 128u; o > 0u; o >>= 1u) {
    if (li < o) { red[li] += red[li + o]; }
    workgroupBarrier();
  }
  let s = red[0];
  workgroupBarrier();
  return s;
}

@compute @workgroup_size(256)
fn main(@builtin(local_invocation_index) li: u32, @builtin(workgroup_id) wg: vec3<u32>) {
  let n4 = p.n / 4u;
  let o = wg.x * n4;
//#if ADD
//#if POST
  var sa = 0.0;
  for (var i = li; i < n4; i += 256u) { let v = A[o + i]; sa += dot(v, v); }
  let ka = 1.0 / sqrt(total(sa, li) / f32(p.n) + p.eps);
//#endif
  var sx = 0.0;
  for (var i = li; i < n4; i += 256u) {
//#if POST
    let x = X[o + i] + A[o + i] * ka * w1[i];
//#else
    let x = X[o + i] + A[o + i];
//#endif
    X[o + i] = x;
    sx += dot(x, x);
  }
  let k = 1.0 / sqrt(total(sx, li) / f32(p.n) + p.eps);
  for (var i = li; i < n4; i += 256u) { N[o + i] = X[o + i] * k * w2[i]; }
//#else
  var sx = 0.0;
  for (var i = li; i < n4; i += 256u) { let v = X[o + i]; sx += dot(v, v); }
  let k = 1.0 / sqrt(total(sx, li) / f32(p.n) + p.eps);
  for (var i = li; i < n4; i += 256u) { N[o + i] = X[o + i] * k * w1[i]; }
//#endif
}
