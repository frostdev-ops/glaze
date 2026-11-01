// The local model's ladder bench (ai/local/ladder.js): a decode step's shape on this GPU.
// gemv: one workgroup a row of packed 8-bit weights times an f32 vector, row sums in workgroup memory (no subgroups or
// f16, so it runs on every adapter the ladder accepts); timed, it gives the rate weights stream through a GEMV.
// tick: an almost empty dispatch; a chain of them and a readback give a decode step's fixed cost.
// fill: random weights first, so no zero-page shortcut flatters the read.
struct P { cols: u32, rows: u32, seed: u32, pad: u32 } // cols: u32 words a row

@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read> w: array<u32>;
@group(0) @binding(2) var<storage, read> x: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read_write> y: array<f32>;
@group(0) @binding(4) var<storage, read_write> wf: array<u32>;

const WG: u32 = 256u;
var<workgroup> part: array<f32, WG>;

@compute @workgroup_size(256)
fn gemv(@builtin(workgroup_id) g: vec3<u32>, @builtin(num_workgroups) n: vec3<u32>, @builtin(local_invocation_index) li: u32) {
  let row = g.y * n.x + g.x;
  if (row >= p.rows) { return; }
  let base = row * p.cols;
  var s = 0.0;
  for (var j = li; j < p.cols; j += WG) {
    let q = w[base + j];
    let v = vec4<f32>(f32(q & 255u), f32((q >> 8u) & 255u), f32((q >> 16u) & 255u), f32(q >> 24u)) - 128.0;
    s += dot(v, x[j]);
  }
  part[li] = s;
  workgroupBarrier();
  for (var k = WG / 2u; k > 0u; k >>= 1u) {
    if (li < k) { part[li] += part[li + k]; }
    workgroupBarrier();
  }
  if (li == 0u) { y[row] = part[0]; }
}

@compute @workgroup_size(64)
fn tick(@builtin(local_invocation_index) li: u32) {
  if (li == 0u) { y[0] = y[0] + 1.0; }
}

@compute @workgroup_size(256)
fn fill(@builtin(global_invocation_id) id: vec3<u32>, @builtin(num_workgroups) n: vec3<u32>) {
  let i = id.y * n.x * WG + id.x;
  if (i >= p.rows * p.cols) { return; }
  var h = i * 2654435761u + p.seed;
  h ^= h >> 15u;
  h *= 2246822519u;
  h ^= h >> 13u;
  wf[i] = h;
}
