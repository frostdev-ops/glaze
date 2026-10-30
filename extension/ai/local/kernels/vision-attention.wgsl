// The picture encoder's bidirectional GQA attention over every patch: O = softmax(q · k · scale) · v for T queries per
// head, heads of 64. One invocation per query, 64 a workgroup, query head h = wg.y reads key/value head h / (H / Hkv).
// Keys go 32 at a time through workgroup memory (as H), with a running max and sum (online softmax), in f32.
struct P { T: u32, H: u32, Hkv: u32, scale: f32 }
@group(0) @binding(0) var<storage, read> Q: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read> K: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> V: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read_write> O: array<vec4<f32>>;
@group(0) @binding(4) var<uniform> p: P;

const BK = 32u;
var<workgroup> Ks: array<vec4<H>, 512>; // [key 32][dim / 4: 16]
var<workgroup> Vs: array<vec4<H>, 512>;

@compute @workgroup_size(64)
fn main(@builtin(local_invocation_index) li: u32, @builtin(workgroup_id) wg: vec3<u32>) {
  let h = wg.y;
  let t = wg.x * 64u + li;
  let kh = h / (p.H / p.Hkv);
  let live = t < p.T;
  var q: array<vec4<f32>, 16>;
  if (live) { for (var i = 0u; i < 16u; i++) { q[i] = Q[(t * p.H + h) * 16u + i]; } }
  var acc: array<vec4<f32>, 16>;
  var m = -3.4028234663852886e38;
  var l = 0.0;
  for (var j0 = 0u; j0 < p.T; j0 += BK) {
    for (var e = li; e < BK * 16u; e += 64u) {
      let j = j0 + e / 16u;
      var kv = vec4<f32>(0.0);
      var vv = vec4<f32>(0.0);
      if (j < p.T) {
        let o = (j * p.Hkv + kh) * 16u + e % 16u;
        kv = K[o];
        vv = V[o];
      }
      Ks[e] = vec4<H>(kv);
      Vs[e] = vec4<H>(vv);
    }
    workgroupBarrier();
    var s: array<f32, 32>;
    var mt = m;
    for (var j = 0u; j < BK; j++) {
      var d = 0.0;
      for (var i = 0u; i < 16u; i++) { d += dot(q[i], vec4<f32>(Ks[j * 16u + i])); }
      s[j] = select(-3.4028234663852886e38, d * p.scale, j0 + j < p.T);
      mt = max(mt, s[j]);
    }
    let corr = exp(m - mt);
    l *= corr;
    for (var i = 0u; i < 16u; i++) { acc[i] *= corr; }
    for (var j = 0u; j < BK; j++) {
      let pj = exp(s[j] - mt);
      l += pj;
      for (var i = 0u; i < 16u; i++) { acc[i] += pj * vec4<f32>(Vs[j * 16u + i]); }
    }
    m = mt;
    workgroupBarrier();
  }
  if (live) { for (var i = 0u; i < 16u; i++) { O[(t * p.H + h) * 16u + i] = acc[i] / l; } }
}
