// Tiled GEMM for T tokens: Y[t · ldy + yOff + r] = W[r] · X[t · xStride + xOff ..] for t < T, r < rows. The rows'
// sub-blocks are dequantized (quant.wgsl) and the tokens' values loaded into workgroup memory as H (f16 on the f16 path,
// unless TF32: f32 tiles). Sums in f32.
//   (default) a 64-row × 64-token tile, 32 deep at a time: invocation (tx, ty) sums rows tx + 16c and tokens ty + 16j,
//             c, j < 4, four-term dot products, k in order; rows padded to 9 vec4 (no bank conflicts).
//   BIG       a 128 × 128 tile, 16 deep at a time in two buffers (one barrier a step: the next 16 load into one while the
//             other is summed), stored k-major (a vec4 holds 4 rows, or 4 tokens, at one k; vec4 c of row k at
//             c ^ 2·(k / 4 mod 4), so the transposing stores fill 32 banks): invocation (tx, ty) sums rows 4tx.. and
//             64 + 4tx.., tokens 4ty.. and 64 + 4ty.. (8 × 8, an FMA chain each, k in order) from 4 vec4 reads a k.
//             Loads coalesce: invocations 2r, 2r + 1 stream row r's values (8 each a step: its scales once a sub-block,
//             two quant words a step), 4 a token's; the next step's words are read before this one is summed and made
//             into values after. Split along k (SPLIT, the dispatch's z: the split, num_workgroups.z: how many), each
//             split sums its own run of steps and writes its sums at z · T · ldy (ldy = rows); SUM then adds the splits
//             in order into Y.
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
var<workgroup> Ws: array<vec4<f32>, 1024>; // [buffer 2][k 16][row / 4: 32]
var<workgroup> Xs: array<vec4<f32>, 1024>; // [buffer 2][k 16][token / 4: 32]
alias S = f32;
//#endif
//#if BIG && !TF32
var<workgroup> Ws: array<vec4<H>, 1024>;
var<workgroup> Xs: array<vec4<H>, 1024>;
alias S = H;
//#endif
//#if BIG
// k: 16 · buffer + k of the step.
fn sw(k: u32, c: u32) -> u32 { return k * 32u + (c ^ (((k >> 2u) & 3u) << 1u)); }
// Values k0..k0 + 3 of row (or token) i.
fn putW(k0: u32, i: u32, v: vec4<f32>) {
  Ws[sw(k0, i >> 2u)][i & 3u] = S(v.x);
  Ws[sw(k0 + 1u, i >> 2u)][i & 3u] = S(v.y);
  Ws[sw(k0 + 2u, i >> 2u)][i & 3u] = S(v.z);
  Ws[sw(k0 + 3u, i >> 2u)][i & 3u] = S(v.w);
}
fn putX(k0: u32, i: u32, v: vec4<f32>) {
  Xs[sw(k0, i >> 2u)][i & 3u] = S(v.x);
  Xs[sw(k0 + 1u, i >> 2u)][i & 3u] = S(v.y);
  Xs[sw(k0 + 2u, i >> 2u)][i & 3u] = S(v.z);
  Xs[sw(k0 + 3u, i >> 2u)][i & 3u] = S(v.w);
}
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
  putW(8u * h, lr, select(vec4<f32>(0.0), v4(qa, ks, rb, j0 >> 1u, 2u * h), wok));
  putW(8u * h + 4u, lr, select(vec4<f32>(0.0), v4(qb, ks, rb, j0 >> 1u, 2u * h + 1u), wok));
  putX(4u * lw, lt, x0); putX(4u * lw, lt + 64u, x1);
  workgroupBarrier();
  for (var j = j0; j < j1; j++) {
    let more = j + 1u < j1;
    let s1 = (j + 1u) >> 1u;
    let w1 = 4u * ((j + 1u) & 1u) + 2u * h;
    if (more) {
      if (wok) {
        if (((j + 1u) & 1u) == 0u) { hw = hd(rb, s1); }
        qa = qw(rb, s1, w1); qb = qw(rb, s1, w1 + 1u);
      }
      x0 = ldX(t0 + lt, j + 1u, lw); x1 = ldX(t0 + lt + 64u, j + 1u, lw);
    }
    let kb = 16u * ((j - j0) & 1u);
    for (var k4 = 0u; k4 < 16u; k4 += 4u) {
      {
        let k = kb + k4 + 0u;
        let a0 = vec4<f32>(Ws[sw(k, tx)]);
        let a1 = vec4<f32>(Ws[sw(k, 16u + tx)]);
        let b0 = vec4<f32>(Xs[sw(k, ty)]);
        let b1 = vec4<f32>(Xs[sw(k, 16u + ty)]);
        c00 = fma(a0, vec4<f32>(b0.x), c00); c01 = fma(a1, vec4<f32>(b0.x), c01);
        c10 = fma(a0, vec4<f32>(b0.y), c10); c11 = fma(a1, vec4<f32>(b0.y), c11);
        c20 = fma(a0, vec4<f32>(b0.z), c20); c21 = fma(a1, vec4<f32>(b0.z), c21);
        c30 = fma(a0, vec4<f32>(b0.w), c30); c31 = fma(a1, vec4<f32>(b0.w), c31);
        c40 = fma(a0, vec4<f32>(b1.x), c40); c41 = fma(a1, vec4<f32>(b1.x), c41);
        c50 = fma(a0, vec4<f32>(b1.y), c50); c51 = fma(a1, vec4<f32>(b1.y), c51);
        c60 = fma(a0, vec4<f32>(b1.z), c60); c61 = fma(a1, vec4<f32>(b1.z), c61);
        c70 = fma(a0, vec4<f32>(b1.w), c70); c71 = fma(a1, vec4<f32>(b1.w), c71);
      }
      {
        let k = kb + k4 + 1u;
        let a0 = vec4<f32>(Ws[sw(k, tx)]);
        let a1 = vec4<f32>(Ws[sw(k, 16u + tx)]);
        let b0 = vec4<f32>(Xs[sw(k, ty)]);
        let b1 = vec4<f32>(Xs[sw(k, 16u + ty)]);
        c00 = fma(a0, vec4<f32>(b0.x), c00); c01 = fma(a1, vec4<f32>(b0.x), c01);
        c10 = fma(a0, vec4<f32>(b0.y), c10); c11 = fma(a1, vec4<f32>(b0.y), c11);
        c20 = fma(a0, vec4<f32>(b0.z), c20); c21 = fma(a1, vec4<f32>(b0.z), c21);
        c30 = fma(a0, vec4<f32>(b0.w), c30); c31 = fma(a1, vec4<f32>(b0.w), c31);
        c40 = fma(a0, vec4<f32>(b1.x), c40); c41 = fma(a1, vec4<f32>(b1.x), c41);
        c50 = fma(a0, vec4<f32>(b1.y), c50); c51 = fma(a1, vec4<f32>(b1.y), c51);
        c60 = fma(a0, vec4<f32>(b1.z), c60); c61 = fma(a1, vec4<f32>(b1.z), c61);
        c70 = fma(a0, vec4<f32>(b1.w), c70); c71 = fma(a1, vec4<f32>(b1.w), c71);
      }
      {
        let k = kb + k4 + 2u;
        let a0 = vec4<f32>(Ws[sw(k, tx)]);
        let a1 = vec4<f32>(Ws[sw(k, 16u + tx)]);
        let b0 = vec4<f32>(Xs[sw(k, ty)]);
        let b1 = vec4<f32>(Xs[sw(k, 16u + ty)]);
        c00 = fma(a0, vec4<f32>(b0.x), c00); c01 = fma(a1, vec4<f32>(b0.x), c01);
        c10 = fma(a0, vec4<f32>(b0.y), c10); c11 = fma(a1, vec4<f32>(b0.y), c11);
        c20 = fma(a0, vec4<f32>(b0.z), c20); c21 = fma(a1, vec4<f32>(b0.z), c21);
        c30 = fma(a0, vec4<f32>(b0.w), c30); c31 = fma(a1, vec4<f32>(b0.w), c31);
        c40 = fma(a0, vec4<f32>(b1.x), c40); c41 = fma(a1, vec4<f32>(b1.x), c41);
        c50 = fma(a0, vec4<f32>(b1.y), c50); c51 = fma(a1, vec4<f32>(b1.y), c51);
        c60 = fma(a0, vec4<f32>(b1.z), c60); c61 = fma(a1, vec4<f32>(b1.z), c61);
        c70 = fma(a0, vec4<f32>(b1.w), c70); c71 = fma(a1, vec4<f32>(b1.w), c71);
      }
      {
        let k = kb + k4 + 3u;
        let a0 = vec4<f32>(Ws[sw(k, tx)]);
        let a1 = vec4<f32>(Ws[sw(k, 16u + tx)]);
        let b0 = vec4<f32>(Xs[sw(k, ty)]);
        let b1 = vec4<f32>(Xs[sw(k, 16u + ty)]);
        c00 = fma(a0, vec4<f32>(b0.x), c00); c01 = fma(a1, vec4<f32>(b0.x), c01);
        c10 = fma(a0, vec4<f32>(b0.y), c10); c11 = fma(a1, vec4<f32>(b0.y), c11);
        c20 = fma(a0, vec4<f32>(b0.z), c20); c21 = fma(a1, vec4<f32>(b0.z), c21);
        c30 = fma(a0, vec4<f32>(b0.w), c30); c31 = fma(a1, vec4<f32>(b0.w), c31);
        c40 = fma(a0, vec4<f32>(b1.x), c40); c41 = fma(a1, vec4<f32>(b1.x), c41);
        c50 = fma(a0, vec4<f32>(b1.y), c50); c51 = fma(a1, vec4<f32>(b1.y), c51);
        c60 = fma(a0, vec4<f32>(b1.z), c60); c61 = fma(a1, vec4<f32>(b1.z), c61);
        c70 = fma(a0, vec4<f32>(b1.w), c70); c71 = fma(a1, vec4<f32>(b1.w), c71);
      }
    }
    if (more) {
      let kn = 16u - kb;
      if (((j + 1u) & 1u) == 0u) { ks = sc(hw, rb, s1); }
      putW(kn + 8u * h, lr, select(vec4<f32>(0.0), v4(qa, ks, rb, s1, w1), wok));
      putW(kn + 8u * h + 4u, lr, select(vec4<f32>(0.0), v4(qb, ks, rb, s1, w1 + 1u), wok));
      putX(kn + 4u * lw, lt, x0); putX(kn + 4u * lw, lt + 64u, x1);
    }
    workgroupBarrier();
  }
  let ra = r0 + 4u * tx;
  let rc = ra + 64u;
  let ta = t0 + 4u * ty;
  let tc = ta + 64u;
  let yz = wg.z * p.T * p.ldy;
  put(yz, ta, ra, rc, c00, c01); put(yz, ta + 1u, ra, rc, c10, c11); put(yz, ta + 2u, ra, rc, c20, c21); put(yz, ta + 3u, ra, rc, c30, c31);
  put(yz, tc, ra, rc, c40, c41); put(yz, tc + 1u, ra, rc, c50, c51); put(yz, tc + 2u, ra, rc, c60, c61); put(yz, tc + 3u, ra, rc, c70, c71);
}
// Token t's sums for rows ra.. (v) and rc.. (w), at yz on.
fn put(yz: u32, t: u32, ra: u32, rc: u32, v: vec4<f32>, w: vec4<f32>) {
  if (t >= p.T) { return; }
  let y = yz + t * p.ldy + p.yOff;
  for (var i = 0u; i < 4u; i++) {
    if (ra + i < p.rows) { Y[y + ra + i] = v[i]; }
    if (rc + i < p.rows) { Y[y + rc + i] = w[i]; }
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
