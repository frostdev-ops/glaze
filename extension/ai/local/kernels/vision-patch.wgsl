// The picture encoder's im2col: the pixels (width × height × 3, channels interleaved) as one row of 3 · P² values per
// P × P patch, in the patch kernels' order (x fastest, then y, then channel), patches in raster order. One invocation
// per output vec4 (n of them).
struct P { n: u32, px: u32, P: u32, p0: u32 }
@group(0) @binding(0) var<storage, read> pix: array<f32>;
@group(0) @binding(1) var<storage, read_write> cols: array<vec4<f32>>;
@group(0) @binding(2) var<uniform> p: P;

@compute @workgroup_size(256)
fn main(@builtin(local_invocation_index) li: u32, @builtin(workgroup_id) wg: vec3<u32>, @builtin(num_workgroups) nw: vec3<u32>) {
  let i = (wg.y * nw.x + wg.x) * 256u + li;
  if (i >= p.n) { return; }
  let per = 3u * p.P * p.P / 4u;
  let t = i / per;
  let r = (i % per) * 4u;
  let ch = r / (p.P * p.P);
  let ky = (r / p.P) % p.P;
  let kx = r % p.P;
  let at = (((t / p.px) * p.P + ky) * p.px * p.P + (t % p.px) * p.P + kx) * 3u + ch;
  cols[i] = vec4<f32>(pix[at], pix[at + 3u], pix[at + 6u], pix[at + 9u]);
}
