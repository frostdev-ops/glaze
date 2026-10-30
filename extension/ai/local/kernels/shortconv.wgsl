// LFM's gated short convolution after in_proj, for T tokens. BCX rows are [B | C | x] (3E); S holds the last K inputs
// to the convolution (rows of E, oldest first); Wc is E rows of K + 1 taps, the last on the current token.
//   (default) one invocation per (t, e): Y[t][e] = C · Σ_k in(t + k) · Wc[e][k], in(j) = S[j] for j < K, else B · x of
//             token j − K; the sum in f32, k in order. Reads S only.
//   ROLL:     one invocation per channel, after: S becomes in(T .. T + K − 1), the last K inputs.
struct P { T: u32, E: u32, K: u32, p0: u32 }
@group(0) @binding(0) var<storage, read> BCX: array<f32>;
//#if ROLL
@group(0) @binding(1) var<storage, read_write> S: array<f32>;
//#else
@group(0) @binding(1) var<storage, read> S: array<f32>;
@group(0) @binding(2) var<storage, read> Wc: array<f32>;
@group(0) @binding(3) var<storage, read_write> Y: array<f32>;
//#endif
@group(0) @binding(4) var<uniform> p: P;

fn input(j: u32, e: u32) -> f32 {
  if (j < p.K) { return S[j * p.E + e]; }
  let row = (j - p.K) * 3u * p.E;
  return BCX[row + e] * BCX[row + 2u * p.E + e];
}

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>, @builtin(num_workgroups) nw: vec3<u32>) {
  let i = gid.y * nw.x * 256u + gid.x;
  let E = p.E;
//#if ROLL
  if (i >= E) { return; }
  // Ascending j reads S at T + j ≥ j before row j is written.
  for (var j = 0u; j < p.K; j++) { S[j * E + i] = input(p.T + j, i); }
//#else
  if (i >= p.T * E) { return; }
  let t = i / E;
  let e = i % E;
  var sum = 0.0;
  for (var k = 0u; k <= p.K; k++) { sum += input(t + k, e) * Wc[e * (p.K + 1u) + k]; }
  Y[i] = BCX[t * 3u * E + E + e] * sum;
//#endif
}
