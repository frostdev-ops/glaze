// 8 rows × 8 tokens, shared packed inputs; two exact int32 dot products per four values.
struct P { rows: u32, K: u32, rowBytes: u32, T: u32, xStride: u32, xOff: u32, ldy: u32, yOff: u32 }
@group(0) @binding(0) var<storage, read> W: array<u32>;
@group(0) @binding(1) var<storage, read> XQ: array<vec2<u32>>;
@group(0) @binding(2) var<storage, read_write> Y: array<f32>;
@group(0) @binding(3) var<uniform> p: P;
@group(0) @binding(4) var<storage, read> XD: array<vec4<f32>>;
var<workgroup> ws: array<u32, 64>;
var<workgroup> xs: array<vec2<u32>, 64>;
var<workgroup> ds: array<vec4<f32>, 8>;
var<workgroup> scales: array<vec2<f32>, 8>;
@compute @workgroup_size(64)
fn main(@builtin(local_invocation_index) li: u32, @builtin(workgroup_id) wg: vec3<u32>) {
  let r = wg.x * 8u + li / 8u;
  let t = wg.y * 8u + li % 8u;
  let lr = li / 8u;
  let w = li % 8u;
  var acc = 0.0;
  for (var s = 0u; s < p.K / 32u; s++) {
    var weight = 0u;
    if (r < p.rows) { weight = iq(r * p.rowBytes, s, w); }
    ws[li] = weight;
    let xt = wg.y * 8u + lr;
    var x = vec2<u32>(0u);
    if (xt < p.T) { x = XQ[xt * (p.K / 4u) + s * 8u + w]; }
    xs[li] = x;
    if (li < 8u) {
      let rr = wg.x * 8u + li;
      scales[li] = vec2<f32>(0.0);
      if (rr < p.rows) { scales[li] = sc(hd(rr * p.rowBytes, s), rr * p.rowBytes, s); }
      ds[li] = vec4<f32>(0.0);
      if (wg.y * 8u + li < p.T) { ds[li] = XD[(wg.y * 8u + li) * (p.K / 32u) + s]; }
    }
    workgroupBarrier();
    var a = vec2<i32>(0);
    var b = vec2<i32>(0);
    for (var k = 0u; k < 8u; k++) {
      let q = ws[lr * 8u + k];
      let xq = xs[w * 8u + k];
      let d = vec2<i32>(dot4I8Packed(q, xq.x), dot4I8Packed(q, xq.y));
      if (k < 4u) { a += d; } else { b += d; }
    }
    let d = ds[w];
    let scale = scales[lr];
//#if Q6_K
    acc += scale.x * dot(vec2<f32>(a), d.xy) + scale.y * dot(vec2<f32>(b), d.xy);
//#else
    acc += scale.x * dot(vec2<f32>(a + b), d.xy);
//#if Q4_K || Q5_K
    acc -= scale.y * d.z;
//#endif
//#endif
    workgroupBarrier();
  }
  if (r < p.rows && t < p.T) { Y[t * p.ldy + p.yOff + r] = acc; }
}
