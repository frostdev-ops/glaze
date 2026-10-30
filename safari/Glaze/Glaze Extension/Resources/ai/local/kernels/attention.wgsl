// Causal GQA attention for T queries at positions pos.., one workgroup of D (= 128) per query head h and token t,
// invocation i owning output dim i. Query head h reads key/value head h / (H / Hkv) from the caches (slot j, or j mod
// ring on a sliding layer, which sees keys p − window < j ≤ p). Keys go in tiles of 128 with a running max and sum
// (online softmax, in f32); each head's output × sigmoid(G[t][h]), the attention gate.
//   SPLIT (one token): workgroup z of the grid's third side takes only the z-th tile of keys and leaves its (acc, max,
//          sum) in Part, so a decode step has H × tiles workgroups; COMBINE then merges a head's tiles into O.
//   BLOCK  (a prompt step): a workgroup of 256 per query head h and block of 16 tokens; keys go in tiles of 16, loaded
//          once into workgroup memory for the block's 16 rows. Per row the same sums in the same order: each score a
//          dot over vec4 in order, the running max and sum per tile, the values' weighted sum key by key.
struct P { T: u32, pos: u32, H: u32, Hkv: u32, window: u32, ring: u32, scale: f32, splits: u32 }
//#if COMBINE
@group(0) @binding(3) var<storage, read> G: array<f32>;
@group(0) @binding(4) var<storage, read_write> O: array<f32>;
@group(0) @binding(6) var<storage, read> Part: array<f32>;
//#else
@group(0) @binding(0) var<storage, read> Q: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read> Kc: array<vec4<H>>;
//#if BLOCK
@group(0) @binding(2) var<storage, read> Vc: array<vec4<H>>;
//#else
@group(0) @binding(2) var<storage, read> Vc: array<H>;
//#endif
//#if SPLIT
@group(0) @binding(6) var<storage, read_write> Part: array<f32>;
//#else
@group(0) @binding(3) var<storage, read> G: array<f32>;
@group(0) @binding(4) var<storage, read_write> O: array<f32>;
//#endif
//#endif
@group(0) @binding(5) var<uniform> p: P;

const D = 128u;
//#if BLOCK
const BT = 16u;
const NONE = -3.4028234663852886e38; // a masked score
var<workgroup> qb: array<vec4<f32>, 528>; // [row 16][dims / 4: 32, +1]
var<workgroup> kt: array<vec4<H>, 528>;   // [key 16][dims / 4: 32, +1]
var<workgroup> vt: array<vec4<H>, 528>;
var<workgroup> sp: array<f32, 256>;       // [row 16][key 16]: scores, then weights
var<workgroup> cr: array<f32, 16>;        // each row's rescale for the tile, then its sum

@compute @workgroup_size(256)
fn main(@builtin(local_invocation_index) li: u32, @builtin(workgroup_id) wg: vec3<u32>) {
  let h = wg.x;
  let t0 = wg.y * BT;
  let width = p.Hkv * D;
  let kh = h / (p.H / p.Hkv);
  for (var e = li; e < BT * 32u; e += 256u) {
    let r = e / 32u;
    var v = vec4<f32>(0.0);
    if (t0 + r < p.T) { v = Q[((t0 + r) * p.H + h) * 32u + e % 32u]; }
    qb[r * 33u + e % 32u] = v;
  }
  // Keys first..end − 1 cover the block's rows; row t sees p − window < j ≤ p, p = pos + t.
  var first = 0u;
  if (p.window > 0u && p.pos + t0 + 1u > p.window) { first = p.pos + t0 + 1u - p.window; }
  let end = p.pos + min(t0 + BT, p.T);
  // Invocation li: row r = li / 16, and its key c (scores) or vec4 columns 2c, 2c + 1 of the values.
  let r = li / 16u;
  let c = li % 16u;
  let rp = p.pos + t0 + r;
  let live = t0 + r < p.T;
  var m = NONE;
  var l = 0.0;
  var a0 = vec4<f32>(0.0);
  var a1 = vec4<f32>(0.0);
  for (var j0 = first; j0 < end; j0 += 16u) {
    workgroupBarrier();
    for (var e = li; e < 16u * 32u; e += 256u) {
      let j = j0 + e / 32u;
      var kv = vec4<H>(0.0);
      var vv = vec4<H>(0.0);
      if (j < end) {
        var slot = j;
        if (p.ring > 0u) { slot = j % p.ring; }
        let o = (slot * width + kh * D) / 4u + e % 32u;
        kv = Kc[o];
        vv = Vc[o];
      }
      kt[(e / 32u) * 33u + e % 32u] = kv;
      vt[(e / 32u) * 33u + e % 32u] = vv;
    }
    workgroupBarrier();
    let j = j0 + c;
    var s = NONE;
    if (live && j <= rp && j < end && (p.window == 0u || j + p.window > rp)) {
      var d = 0.0;
      for (var i = 0u; i < 32u; i++) { d += dot(qb[r * 33u + i], vec4<f32>(kt[c * 33u + i])); }
      s = d * p.scale;
    }
    sp[r * 16u + c] = s;
    workgroupBarrier();
    if (c == 0u) {
      var mx = m;
      for (var q = 0u; q < 16u; q++) { mx = max(mx, sp[r * 16u + q]); }
      var sum = 0.0;
      for (var q = 0u; q < 16u; q++) {
        let v = sp[r * 16u + q];
        var e = 0.0;
        if (v != NONE) { e = exp(v - mx); }
        sp[r * 16u + q] = e;
        sum += e;
      }
      let f = exp(m - mx);
      l = l * f + sum;
      m = mx;
      cr[r] = f;
    }
    workgroupBarrier();
    let f = cr[r];
    a0 *= f;
    a1 *= f;
    for (var q = 0u; q < 16u; q++) {
      let w = sp[r * 16u + q];
      a0 += w * vec4<f32>(vt[q * 33u + 2u * c]);
      a1 += w * vec4<f32>(vt[q * 33u + 2u * c + 1u]);
    }
  }
  workgroupBarrier();
  if (c == 0u) { cr[r] = l; }
  workgroupBarrier();
  if (live) {
    let t = t0 + r;
    let g = 1.0 / (1.0 + exp(-G[t * p.H + h]));
    let o = ((t * p.H + h) * D) / 4u + 2u * c;
    O4(o, a0 / cr[r] * g);
    O4(o + 1u, a1 / cr[r] * g);
  }
}
fn O4(i: u32, v: vec4<f32>) { O[4u * i] = v.x; O[4u * i + 1u] = v.y; O[4u * i + 2u] = v.z; O[4u * i + 3u] = v.w; }
//#else
//#if !COMBINE
var<workgroup> qs: array<vec4<f32>, 32>;
var<workgroup> pr: array<f32, 128>;
var<workgroup> red: array<f32, 128>;

fn reduce(v: f32, li: u32, isMax: bool) -> f32 {
  red[li] = v;
  workgroupBarrier();
  for (var o = 64u; o > 0u; o >>= 1u) {
    if (li < o) { red[li] = select(red[li] + red[li + o], max(red[li], red[li + o]), isMax); }
    workgroupBarrier();
  }
  let s = red[0];
  workgroupBarrier();
  return s;
}
//#endif

@compute @workgroup_size(128)
fn main(@builtin(local_invocation_index) li: u32, @builtin(workgroup_id) wg: vec3<u32>) {
  let h = wg.x;
  let t = wg.y;
//#if COMBINE
  // Merge the tiles: rescale each by e^(its max − the max of all).
  let base = (t * p.H + h) * p.splits;
  var mx = -3.4028234663852886e38;
  for (var z = 0u; z < p.splits; z++) { mx = max(mx, Part[(base + z) * (D + 2u) + D]); }
  var l = 0.0;
  var acc = 0.0;
  for (var z = 0u; z < p.splits; z++) {
    let o = (base + z) * (D + 2u);
    let f = exp(Part[o + D] - mx);
    l += Part[o + D + 1u] * f;
    acc += Part[o + li] * f;
  }
  let g = G[t * p.H + h];
  O[(t * p.H + h) * D + li] = acc / l * (1.0 / (1.0 + exp(-g)));
//#else
  let p_ = p.pos + t;
  let width = p.Hkv * D;
  let kh = h / (p.H / p.Hkv);
  var first = 0u;
  if (p.window > 0u && p_ + 1u > p.window) { first = p_ + 1u - p.window; }
  var end = p_ + 1u;
//#if SPLIT
  first += wg.z * 128u;
  end = min(end, first + 128u);
//#endif
  if (li < 32u) { qs[li] = Q[((t * p.H + h) * D) / 4u + li]; }
  workgroupBarrier();
  var m = -3.4028234663852886e38;
  var l = 0.0;
  var acc = 0.0;
  for (var j0 = first; j0 < end; j0 += 128u) {
    let j = j0 + li;
    var s = -3.4028234663852886e38;
    let ok = j < end;
    if (ok) {
      var slot = j;
      if (p.ring > 0u) { slot = j % p.ring; }
      let kb = (slot * width + kh * D) / 4u;
      var d = 0.0;
      for (var i = 0u; i < 32u; i++) { d += dot(qs[i], vec4<f32>(Kc[kb + i])); }
      s = d * p.scale;
    }
    let mn = max(m, reduce(s, li, true));
    var e = 0.0;
    if (ok) { e = exp(s - mn); }
    pr[li] = e;
    let corr = exp(m - mn);
    l = l * corr + reduce(e, li, false);
    acc *= corr;
    let n = min(128u, end - j0);
    for (var jj = 0u; jj < n; jj++) {
      var slot = j0 + jj;
      if (p.ring > 0u) { slot = slot % p.ring; }
      acc += pr[jj] * f32(Vc[slot * width + kh * D + li]);
    }
    m = mn;
    workgroupBarrier();
  }
//#if SPLIT
  let o = ((t * p.H + h) * p.splits + wg.z) * (D + 2u);
  Part[o + li] = acc;
  if (li == 0u) { Part[o + D] = m; Part[o + D + 1u] = l; }
//#else
  let g = G[t * p.H + h];
  O[(t * p.H + h) * D + li] = acc / l * (1.0 / (1.0 + exp(-g)));
//#endif
//#endif
}
//#endif
