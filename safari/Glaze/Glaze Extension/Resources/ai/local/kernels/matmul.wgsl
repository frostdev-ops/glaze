// Tiled GEMM for T tokens: Y[t · ldy + yOff + r] = W[r] · X[t · xStride + xOff ..] for t < T, r < rows. The rows'
// sub-blocks are dequantized (quant.wgsl) and the tokens' values loaded into workgroup memory as H (f16 on the f16 path,
// unless TF32: f32 tiles). Sums in f32.
//   (default) a 64-row × 64-token tile, 32 deep at a time: invocation (tx, ty) sums rows tx + 16c and tokens ty + 16j,
//             c, j < 4, four-term dot products, k in order; rows padded to 9 vec4 (no bank conflicts).
//   BIG       a 128 × 128 tile, 16 deep at a time in two buffers (one barrier a step: the next 16 load into one while the
//             other is summed). A tile vec4 is 4 consecutive k of one row (or token), stored whole (WGSL lets a store to
//             one component touch the whole vector), vec4 k4 of row r at k4 ^ (r / 2 mod 4) (no bank conflicts).
//             Invocation (tx, ty) sums rows tx + 16c and tokens ty + 16j, c, j < 8, an FMA chain each, k in order.
//             Loads coalesce: invocations 2r, 2r + 1 stream row r's values (8 each a step: its scales once a sub-block,
//             two quant words a step), 4 a token's; the next step's words are read before this one is summed and made
//             into values after. Split along k (the dispatch's z: the split, num_workgroups.z: how many), each split
//             sums its own run of steps and writes its sums at z · T · ldy (ldy = rows); SUM then adds the splits in
//             order into Y.
//   SUM       Y[t · ldy + yOff + r] = Σ_z X[z · T · rows + t · rows + r], z < K (the splits), z in order.
struct P { rows: u32, K: u32, rowBytes: u32, T: u32, xStride: u32, xOff: u32, ldy: u32, yOff: u32 }
@group(0) @binding(0) var<storage, read> W: array<u32>;
@group(0) @binding(1) var<storage, read> X: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> Y: array<f32>;
@group(0) @binding(3) var<uniform> p: P;

//#if SUM
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) g: vec3<u32>, @builtin(num_workgroups) nw: vec3<u32>) {
  let n4 = p.rows / 4u;
  let i = g.y * nw.x * 256u + g.x;
  if (i >= p.T * n4) { return; }
  var v = X[i];
  for (var z = 1u; z < p.K; z++) { v += X[z * p.T * n4 + i]; }
  let y = (i / n4) * p.ldy + p.yOff + 4u * (i % n4);
  Y[y] = v.x; Y[y + 1u] = v.y; Y[y + 2u] = v.z; Y[y + 3u] = v.w;
}
//#else

//#if BIG && TF32
var<workgroup> Ws: array<vec4<f32>, 1024>; // [buffer 2][row 128][k / 4: 4]
var<workgroup> Xs: array<vec4<f32>, 1024>; // [buffer 2][token 128][k / 4: 4]
alias S = f32;
//#endif
//#if BIG && !TF32
var<workgroup> Ws: array<vec4<H>, 1024>;
var<workgroup> Xs: array<vec4<H>, 1024>;
alias S = H;
//#endif
//#if BIG
// Vec4 k4 of row (or token) r in buffer b.
fn at(b: u32, r: u32, k4: u32) -> u32 { return b * 512u + r * 4u + (k4 ^ ((r >> 1u) & 3u)); }
fn ldX(t: u32, j: u32, w: u32) -> vec4<f32> {
  if (t >= p.T) { return vec4<f32>(0.0); }
  return X[(t * p.xStride + p.xOff) / 4u + 4u * j + w];
}

@compute @workgroup_size(256)
fn main(@builtin(local_invocation_index) li: u32, @builtin(workgroup_id) wg: vec3<u32>, @builtin(num_workgroups) nw: vec3<u32>) {
  let r0 = wg.x * 128u;
  let t0 = wg.y * 128u;
  // This split's steps j0..j1 (whole sub-blocks).
  let per = 2u * ((p.K / 32u + nw.z - 1u) / nw.z);
  let j0 = min(wg.z * per, p.K / 16u);
  let j1 = min(j0 + per, p.K / 16u);
  // Loading: row lr's values 8h..8h + 7 of each step; tokens lt and lt + 64, vec4 lw of the step's 4.
  let lr = li >> 1u;
  let h = li & 1u;
  let wok = r0 + lr < p.rows;
  let rb = select(0u, (r0 + lr) * p.rowBytes, wok);
  let lt = li >> 2u;
  let lw = li & 3u;
  // Summing: a warp is 8 tx × 4 ty.
  let tx = (li & 7u) | (((li >> 5u) & 1u) << 3u);
  let ty = ((li >> 3u) & 3u) | ((li >> 6u) << 2u);
  var c00 = vec4<f32>(0.0); var c01 = vec4<f32>(0.0); var c10 = vec4<f32>(0.0); var c11 = vec4<f32>(0.0);
  var c20 = vec4<f32>(0.0); var c21 = vec4<f32>(0.0); var c30 = vec4<f32>(0.0); var c31 = vec4<f32>(0.0);
  var c40 = vec4<f32>(0.0); var c41 = vec4<f32>(0.0); var c50 = vec4<f32>(0.0); var c51 = vec4<f32>(0.0);
  var c60 = vec4<f32>(0.0); var c61 = vec4<f32>(0.0); var c70 = vec4<f32>(0.0); var c71 = vec4<f32>(0.0);
  // Step j: sub-block j / 2, its words 4(j mod 2) + 2h and + 1.
  var hw = vec4<u32>();
  var qa = vec4<u32>();
  var qb = vec4<u32>();
  if (wok) { hw = hd(rb, j0 >> 1u); qa = qw(rb, j0 >> 1u, 2u * h); qb = qw(rb, j0 >> 1u, 2u * h + 1u); }
  var ks = sc(hw, rb, j0 >> 1u);
  var x0 = ldX(t0 + lt, j0, lw);
  var x1 = ldX(t0 + lt + 64u, j0, lw);
  Ws[at(0u, lr, 2u * h)] = vec4<S>(select(vec4<f32>(0.0), v4(qa, ks, rb, j0 >> 1u, 2u * h), wok));
  Ws[at(0u, lr, 2u * h + 1u)] = vec4<S>(select(vec4<f32>(0.0), v4(qb, ks, rb, j0 >> 1u, 2u * h + 1u), wok));
  Xs[at(0u, lt, lw)] = vec4<S>(x0); Xs[at(0u, lt + 64u, lw)] = vec4<S>(x1);
  workgroupBarrier();
  for (var j = j0; j < j1; j++) {
    let more = j + 1u < j1;
    let s1 = (j + 1u) >> 1u;
    let wn = 4u * ((j + 1u) & 1u) + 2u * h;
    if (more) {
      if (wok) {
        if (((j + 1u) & 1u) == 0u) { hw = hd(rb, s1); }
        qa = qw(rb, s1, wn); qb = qw(rb, s1, wn + 1u);
      }
      x0 = ldX(t0 + lt, j + 1u, lw); x1 = ldX(t0 + lt + 64u, j + 1u, lw);
    }
    let kb = (j - j0) & 1u;
    for (var k4 = 0u; k4 < 4u; k4++) {
      let w0 = vec4<f32>(Ws[at(kb, tx, k4)]);
      let w1 = vec4<f32>(Ws[at(kb, tx + 16u, k4)]);
      let w2 = vec4<f32>(Ws[at(kb, tx + 32u, k4)]);
      let w3 = vec4<f32>(Ws[at(kb, tx + 48u, k4)]);
      let w4 = vec4<f32>(Ws[at(kb, tx + 64u, k4)]);
      let w5 = vec4<f32>(Ws[at(kb, tx + 80u, k4)]);
      let w6 = vec4<f32>(Ws[at(kb, tx + 96u, k4)]);
      let w7 = vec4<f32>(Ws[at(kb, tx + 112u, k4)]);
      let ax = vec4<f32>(w0.x, w1.x, w2.x, w3.x); let bx = vec4<f32>(w4.x, w5.x, w6.x, w7.x);
      let ay = vec4<f32>(w0.y, w1.y, w2.y, w3.y); let by = vec4<f32>(w4.y, w5.y, w6.y, w7.y);
      let az = vec4<f32>(w0.z, w1.z, w2.z, w3.z); let bz = vec4<f32>(w4.z, w5.z, w6.z, w7.z);
      let aw = vec4<f32>(w0.w, w1.w, w2.w, w3.w); let bw = vec4<f32>(w4.w, w5.w, w6.w, w7.w);
      { let x = vec4<f32>(Xs[at(kb, ty + 0u, k4)]);
        c00 = fma(aw, vec4<f32>(x.w), fma(az, vec4<f32>(x.z), fma(ay, vec4<f32>(x.y), fma(ax, vec4<f32>(x.x), c00))));
        c01 = fma(bw, vec4<f32>(x.w), fma(bz, vec4<f32>(x.z), fma(by, vec4<f32>(x.y), fma(bx, vec4<f32>(x.x), c01)))); }
      { let x = vec4<f32>(Xs[at(kb, ty + 16u, k4)]);
        c10 = fma(aw, vec4<f32>(x.w), fma(az, vec4<f32>(x.z), fma(ay, vec4<f32>(x.y), fma(ax, vec4<f32>(x.x), c10))));
        c11 = fma(bw, vec4<f32>(x.w), fma(bz, vec4<f32>(x.z), fma(by, vec4<f32>(x.y), fma(bx, vec4<f32>(x.x), c11)))); }
      { let x = vec4<f32>(Xs[at(kb, ty + 32u, k4)]);
        c20 = fma(aw, vec4<f32>(x.w), fma(az, vec4<f32>(x.z), fma(ay, vec4<f32>(x.y), fma(ax, vec4<f32>(x.x), c20))));
        c21 = fma(bw, vec4<f32>(x.w), fma(bz, vec4<f32>(x.z), fma(by, vec4<f32>(x.y), fma(bx, vec4<f32>(x.x), c21)))); }
      { let x = vec4<f32>(Xs[at(kb, ty + 48u, k4)]);
        c30 = fma(aw, vec4<f32>(x.w), fma(az, vec4<f32>(x.z), fma(ay, vec4<f32>(x.y), fma(ax, vec4<f32>(x.x), c30))));
        c31 = fma(bw, vec4<f32>(x.w), fma(bz, vec4<f32>(x.z), fma(by, vec4<f32>(x.y), fma(bx, vec4<f32>(x.x), c31)))); }
      { let x = vec4<f32>(Xs[at(kb, ty + 64u, k4)]);
        c40 = fma(aw, vec4<f32>(x.w), fma(az, vec4<f32>(x.z), fma(ay, vec4<f32>(x.y), fma(ax, vec4<f32>(x.x), c40))));
        c41 = fma(bw, vec4<f32>(x.w), fma(bz, vec4<f32>(x.z), fma(by, vec4<f32>(x.y), fma(bx, vec4<f32>(x.x), c41)))); }
      { let x = vec4<f32>(Xs[at(kb, ty + 80u, k4)]);
        c50 = fma(aw, vec4<f32>(x.w), fma(az, vec4<f32>(x.z), fma(ay, vec4<f32>(x.y), fma(ax, vec4<f32>(x.x), c50))));
        c51 = fma(bw, vec4<f32>(x.w), fma(bz, vec4<f32>(x.z), fma(by, vec4<f32>(x.y), fma(bx, vec4<f32>(x.x), c51)))); }
      { let x = vec4<f32>(Xs[at(kb, ty + 96u, k4)]);
        c60 = fma(aw, vec4<f32>(x.w), fma(az, vec4<f32>(x.z), fma(ay, vec4<f32>(x.y), fma(ax, vec4<f32>(x.x), c60))));
        c61 = fma(bw, vec4<f32>(x.w), fma(bz, vec4<f32>(x.z), fma(by, vec4<f32>(x.y), fma(bx, vec4<f32>(x.x), c61)))); }
      { let x = vec4<f32>(Xs[at(kb, ty + 112u, k4)]);
        c70 = fma(aw, vec4<f32>(x.w), fma(az, vec4<f32>(x.z), fma(ay, vec4<f32>(x.y), fma(ax, vec4<f32>(x.x), c70))));
        c71 = fma(bw, vec4<f32>(x.w), fma(bz, vec4<f32>(x.z), fma(by, vec4<f32>(x.y), fma(bx, vec4<f32>(x.x), c71)))); }
    }
    if (more) {
      let kn = 1u - kb;
      if (((j + 1u) & 1u) == 0u) { ks = sc(hw, rb, s1); }
      Ws[at(kn, lr, 2u * h)] = vec4<S>(select(vec4<f32>(0.0), v4(qa, ks, rb, s1, wn), wok));
      Ws[at(kn, lr, 2u * h + 1u)] = vec4<S>(select(vec4<f32>(0.0), v4(qb, ks, rb, s1, wn + 1u), wok));
      Xs[at(kn, lt, lw)] = vec4<S>(x0); Xs[at(kn, lt + 64u, lw)] = vec4<S>(x1);
    }
    workgroupBarrier();
  }
  let yz = wg.z * p.T * p.ldy;
  put(yz, t0 + ty, r0 + tx, c00, c01); put(yz, t0 + ty + 16u, r0 + tx, c10, c11);
  put(yz, t0 + ty + 32u, r0 + tx, c20, c21); put(yz, t0 + ty + 48u, r0 + tx, c30, c31);
  put(yz, t0 + ty + 64u, r0 + tx, c40, c41); put(yz, t0 + ty + 80u, r0 + tx, c50, c51);
  put(yz, t0 + ty + 96u, r0 + tx, c60, c61); put(yz, t0 + ty + 112u, r0 + tx, c70, c71);
}
// Token t's sums for rows r + 16c: c < 4 in v, 4 ≤ c in w; at yz on.
fn put(yz: u32, t: u32, r: u32, v: vec4<f32>, w: vec4<f32>) {
  if (t >= p.T) { return; }
  let y = yz + t * p.ldy + p.yOff + r;
  for (var c = 0u; c < 4u; c++) {
    if (r + 16u * c < p.rows) { Y[y + 16u * c] = v[c]; }
    if (r + 16u * c + 64u < p.rows) { Y[y + 16u * c + 64u] = w[c]; }
  }
}
//#else
const BM = 64u;
const RC = 4u;
var<workgroup> Ws: array<vec4<H>, 576>; // [row 64][k / 4: 8, +1]
var<workgroup> Xs: array<vec4<H>, 576>; // [token 64][k / 4: 8, +1]
fn at(r: u32, k4: u32) -> u32 { return r * 9u + k4; }

@compute @workgroup_size(256)
fn main(@builtin(local_invocation_index) li: u32, @builtin(workgroup_id) wg: vec3<u32>) {
  let r0 = wg.x * BM;
  let t0 = wg.y * BM;
  let tx = li % 16u;
  let ty = li / 16u;
  // acc[j · RC / 4 + c / 4][c mod 4]: token ty + 16j, row tx + 16c.
  var acc: array<vec4<f32>, RC * RC / 4u>;
  for (var s = 0u; s < p.K / 32u; s++) {
    if (li < BM) {
      let r = r0 + li;
      var w: array<vec4<f32>, 8>;
      if (r < p.rows) { w = deq32(r * p.rowBytes, s); }
      for (var i = 0u; i < 8u; i++) { Ws[at(li, i)] = vec4<H>(w[i]); }
    }
    for (var e = li; e < BM * 8u; e += 256u) {
      let t = e / 8u;
      let k4 = e % 8u;
      var x = vec4<f32>(0.0);
      if (t0 + t < p.T) { x = X[((t0 + t) * p.xStride + p.xOff) / 4u + s * 8u + k4]; }
      Xs[at(t, k4)] = vec4<H>(x);
    }
    workgroupBarrier();
    for (var k4 = 0u; k4 < 8u; k4++) {
      let w0 = vec4<f32>(Ws[at(tx + 0u, k4)]);
      let w1 = vec4<f32>(Ws[at(tx + 16u, k4)]);
      let w2 = vec4<f32>(Ws[at(tx + 32u, k4)]);
      let w3 = vec4<f32>(Ws[at(tx + 48u, k4)]);
      { let x = vec4<f32>(Xs[at(ty + 0u, k4)]); acc[0] += vec4<f32>(dot(w0, x), dot(w1, x), dot(w2, x), dot(w3, x)); }
      { let x = vec4<f32>(Xs[at(ty + 16u, k4)]); acc[1] += vec4<f32>(dot(w0, x), dot(w1, x), dot(w2, x), dot(w3, x)); }
      { let x = vec4<f32>(Xs[at(ty + 32u, k4)]); acc[2] += vec4<f32>(dot(w0, x), dot(w1, x), dot(w2, x), dot(w3, x)); }
      { let x = vec4<f32>(Xs[at(ty + 48u, k4)]); acc[3] += vec4<f32>(dot(w0, x), dot(w1, x), dot(w2, x), dot(w3, x)); }
    }
    workgroupBarrier();
  }
  for (var j = 0u; j < RC; j++) {
    let t = t0 + ty + 16u * j;
    if (t >= p.T) { break; }
    for (var c = 0u; c < RC; c++) {
      let r = r0 + tx + 16u * c;
      if (r < p.rows) { Y[t * p.ldy + p.yOff + r] = acc[j * (RC / 4u) + c / 4u][c % 4u]; }
    }
  }
}
//#endif
//#endif
