// The highest logit's id per row of L (rows of n), the lowest id on a tie; NaN never wins. Two passes: PART reduces
// chunks of 4096 of each row to (value, id) pairs in B; the final pass reduces a row's pairs to its id in I.
struct P { n: u32, chunks: u32, p0: u32, p1: u32 }
@group(0) @binding(0) var<storage, read> L: array<f32>;
@group(0) @binding(1) var<storage, read_write> B: array<vec2<u32>>;
@group(0) @binding(2) var<storage, read_write> I: array<u32>;
@group(0) @binding(3) var<uniform> p: P;

var<workgroup> rv: array<f32, 256>;
var<workgroup> ri: array<u32, 256>;

fn better(v: f32, i: u32, w: f32, j: u32) -> bool { return v > w || (v == w && i < j); }

@compute @workgroup_size(256)
fn main(@builtin(local_invocation_index) li: u32, @builtin(workgroup_id) wg: vec3<u32>) {
  var bv = -3.4028234663852886e38;
  var bi = 0xffffffffu;
//#if PART
  let row = wg.y;
  let base = wg.x * 4096u;
  for (var k = li; k < 4096u; k += 256u) {
    let i = base + k;
    if (i < p.n) { let v = L[row * p.n + i]; if (better(v, i, bv, bi)) { bv = v; bi = i; } }
  }
//#else
  let row = wg.x;
  for (var k = li; k < p.chunks; k += 256u) {
    let c = B[row * p.chunks + k];
    let v = bitcast<f32>(c.x);
    if (c.y != 0xffffffffu && better(v, c.y, bv, bi)) { bv = v; bi = c.y; }
  }
//#endif
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
  if (li == 0u) {
//#if PART
    B[row * p.chunks + wg.x] = vec2<u32>(bitcast<u32>(rv[0]), ri[0]);
//#else
    I[row] = ri[0];
//#endif
  }
}
