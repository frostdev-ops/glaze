// The k (≤ 64) highest logits of one row as (value, id), highest first, the lower id first on a tie; NaN never chosen.
// PART: each workgroup takes 2048 logits of L and writes its own top k to C[chunk · k ..]; the final pass takes the
// chunks' candidates from C, up to 4096 per workgroup, and writes each group's top k to R. Repeat this merge until
// one group remains. Each round picks the best not yet picked (a tree over the workgroup), so k rounds give the k
// best in order.
struct P { n: u32, k: u32, chunks: u32, p0: u32 }
//#if PART
@group(0) @binding(0) var<storage, read> L: array<f32>;
@group(0) @binding(1) var<storage, read_write> C: array<vec2<u32>>;
//#else
@group(0) @binding(1) var<storage, read> C: array<vec2<u32>>;
@group(0) @binding(2) var<storage, read_write> R: array<vec2<u32>>;
//#endif
@group(0) @binding(3) var<uniform> p: P;

var<workgroup> rv: array<f32, 256>;
var<workgroup> ri: array<u32, 256>;

fn better(v: f32, i: u32, w: f32, j: u32) -> bool { return v > w || (v == w && i < j); }

@compute @workgroup_size(256)
fn main(@builtin(local_invocation_index) li: u32, @builtin(workgroup_id) wg: vec3<u32>) {
  // Each invocation holds up to 16 candidates.
  var v: array<f32, 16>;
  var id: array<u32, 16>;
  var cnt = 0u;
//#if PART
  let base = wg.x * 2048u;
  for (var k = li; k < 2048u; k += 256u) {
    let i = base + k;
    if (i < p.n) { let x = L[i]; if (x == x) { v[cnt] = x; id[cnt] = i; cnt++; } }
  }
//#else
  let all = p.chunks * p.k;
  let base = wg.x * 4096u;
  for (var k = base + li; k < min(all, base + 4096u); k += 256u) {
    let c = C[k];
    if (c.y != 0xffffffffu) { v[cnt] = bitcast<f32>(c.x); id[cnt] = c.y; cnt++; }
  }
//#endif
  var picked = 0u;
  for (var round = 0u; round < p.k; round++) {
    var bv = 0.0;
    var bi = 0xffffffffu;
    for (var c = 0u; c < cnt; c++) {
      if ((picked & (1u << c)) == 0u && (bi == 0xffffffffu || better(v[c], id[c], bv, bi))) { bv = v[c]; bi = id[c]; }
    }
    rv[li] = bv;
    ri[li] = bi;
    workgroupBarrier();
    for (var o = 128u; o > 0u; o >>= 1u) {
      if (li < o && ri[li + o] != 0xffffffffu && (ri[li] == 0xffffffffu || better(rv[li + o], ri[li + o], rv[li], ri[li]))) {
        rv[li] = rv[li + o];
        ri[li] = ri[li + o];
      }
      workgroupBarrier();
    }
    let wv = rv[0];
    let wi = ri[0];
    workgroupBarrier();
    if (wi != 0xffffffffu) {
      for (var c = 0u; c < cnt; c++) { if (id[c] == wi) { picked |= 1u << c; } }
    }
    if (li == 0u) {
//#if PART
      C[wg.x * p.k + round] = vec2<u32>(bitcast<u32>(wv), wi);
//#else
      R[wg.x * p.k + round] = vec2<u32>(bitcast<u32>(wv), wi);
//#endif
    }
  }
}
