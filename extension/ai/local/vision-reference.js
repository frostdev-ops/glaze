// The local engine's ground truth for pictures: LiquidAI LFM3-VL's vision path on the CPU in Float32Array, slow by
// design, for WebGPU kernels to be checked against. checks/ai/local-vision-check.js holds it to llama.cpp's mtmd.
// Sources, which agree: llama.cpp v0.8.0 (8642541b2) tools/mtmd (clip.cpp, models/lfm3vl.cpp, mtmd-image.cpp, mtmd.cpp)
// and HF's LiquidAI/LFM3-VL-2B at ba44bd51 (modeling_lfm3_vl.py, image_processing_lfm3_vl.py, processing_lfm3_vl.py).
// The projector GGUF (general.architecture clip, clip.vision.projector_type lfm3vl):
//   preprocess: RGB (alpha dropped, as stb_image and PIL's convert('RGB') do), resized to W × H, multiples of
//     f = patch · merge (32), by smart_resize: round each edge to f (half to even); above max_pixels scale by
//     √(h·w / max) and floor, below min_pixels by √(min / (h·w)) and ceil; never under f. min and max pixels are
//     whole tokens (f² pixels), max capped at 4096 tokens as llama.cpp does. The resize is torchvision's antialiased
//     uint8 bicubic (a = −0.5, int16 weights), as mtmd-image.cpp's resize_pillow with RESIZE_ALGO_FLAG_TORCH;
//     then each channel (u / 255 − mean) / std in float.
//   patchify: 16 × 16 patches in raster order (x fastest), embedded by two conv kernels (patch_embd and .1, the two
//     temporal slices of HF's linear patchifier, a still picture filling both) summed; then RMSNorm (embedding_norm).
//     The pixels stay float32 here, as in HF at fp32. Stock llama.cpp rounds them to f16 first (ggml_conv_2d's im2col
//     is F16 unless the kernel is BF16), which moves its embeddings up to 2.6e-3 on smooth, noisy pictures; with that
//     im2col made F32 it matches this file to 2.4e-6 (glaze-plans/release-4.0.1/c9a).
//   14 blocks, x the residual: x += op(rmsnorm(x)·ln1); x += w2(silu(w1·n) ⊙ w3·n), n = rmsnorm(x)·ln2. op is
//     a gated depthwise conv on blocks with conv2d_in_proj: B, C, X = in_proj·n (thirds); out_proj(C ⊙ conv3×3(B ⊙ X)),
//       the 3 × 3 over the patch grid, zero padded, no bias;
//     or bidirectional GQA attention over every patch: 16 query heads of 64 over 8 KV heads (head h reads h / 2),
//       q and k RMSNorm per head, then 2-D RoPE (theta 1e6): pairs (j, j + 32), angle y · θ^(−2j/32) for j < 16 and
//       x · θ^(−2(j − 16)/32) for 16 ≤ j < 32 (llama.cpp's GGML_ROPE_TYPE_VISION, sections 16/16; HF's axial rope);
//       softmax(q·k / 8), attn_out.
//   project: LayerNorm (mm.input_norm, ε 1e-6) per patch; each 2 × 2 block of patches (top-left, top-right,
//     bottom-left, bottom-right) concatenated to 4096; mm.2(gelu_erf(mm.0 · v + b0)) + b2 → one text embedding each,
//     (W / 32) · (H / 32) of them in raster order.
// In the text model the embeddings take the place of `<|image|>` tokens between <|vision_start|> and <|vision_end|>
// (mtmd: the image chunk between those two text tokens), one position each, causal like text: feed them with
// session.forwardEmbeddings from ai/local/reference.js.
// Numerics as reference.js: every stored value a float32, sums and products inside an op in doubles; weights stay as
// their GGUF bytes and are dequantized a row at a time, bit for bit as ggml (ai/local/quant.js). Classic script; node exports.
var GZ_AI_VISION_REFERENCE = globalThis.GZ_AI_VISION_REFERENCE || (() => {
  let quant = null, ref = null;
  const Q = () => quant || (quant = typeof GZ_AI_QUANT !== 'undefined' ? GZ_AI_QUANT : require('./quant.js'));
  const R = () => ref || (ref = typeof GZ_AI_REFERENCE !== 'undefined' ? GZ_AI_REFERENCE : require('./reference.js'));
  const fr = Math.fround;
  const fail = (what) => { throw new TypeError(`vision: ${what}`); };
  const MAX_TOKENS = 4096;

  // ---- config from the projector GGUF's metadata -------------------------------------------------------------------------
  const config = (g) => {
    const kv = g.kv;
    if (kv['general.architecture'] !== 'clip') fail(`architecture ${JSON.stringify(kv['general.architecture'])}: a clip projector expected`);
    if (kv['clip.vision.projector_type'] !== 'lfm3vl') fail(`projector ${JSON.stringify(kv['clip.vision.projector_type'])}: only lfm3vl`);
    const k = (name, dflt) => { const v = kv[`clip.vision.${name}`]; if (v === undefined) { if (dflt === undefined) fail(`no clip.vision.${name}`); return dflt; } return typeof v === 'bigint' ? Number(v) : v; };
    const patch = k('patch_size'), merge = k('spatial_merge_size'), nEmbd = k('embedding_length'), nHead = k('attention.head_count');
    if (merge !== 2) fail(`spatial_merge_size ${merge}: only 2`);
    const area = patch * patch * merge * merge;
    const algo = k('image_resize_algo');
    if (algo !== 'bicubic' && algo !== 'bilinear') fail(`resize ${algo}`);
    const out = g.tensor('mm.2.bias');
    const c = {
      patch, merge, nEmbd, nHead, nHeadKv: k('attention.head_count_kv', nHead), headDim: nEmbd / nHead, nFf: k('feed_forward_length'),
      nLayer: k('block_count'), eps: k('attention.layer_norm_epsilon'), projEps: 1e-6, ropeTheta: 1e6, resize: algo,
      mean: Array.from(k('image_mean')), std: Array.from(k('image_std')),
      // llama.cpp: whole tokens, the max capped (clip.cpp, PROJECTOR_TYPE_LFM3VL)
      minPixels: Math.trunc(k('image_min_pixels') / area) * area,
      maxPixels: Math.min(MAX_TOKENS, Math.trunc(k('image_max_pixels') / area)) * area,
      outEmbd: out ? out.count : fail('no mm.2.bias'),
    };
    if (c.nHead % c.nHeadKv || c.headDim % 4 || !Number.isInteger(c.headDim)) fail('head shapes');
    if (!(c.minPixels > 0) || c.maxPixels < c.minPixels) fail('image min/max pixels');
    return c;
  };

  // ---- preprocessing ---------------------------------------------------------------------------------------------------
  const halfEven = (v) => { const r = Math.round(v); return r - v === 0.5 && r % 2 ? r - 1 : r; }; // C nearbyint, Python round
  // The size an image of width × height is resized to: { width, height }, multiples of factor.
  const smartResize = (width, height, factor, minPixels, maxPixels) => {
    const h = height, w = width;
    let hb = halfEven(h / factor) * factor, wb = halfEven(w / factor) * factor;
    if (hb * wb > maxPixels) {
      const beta = Math.sqrt((h * w) / maxPixels);
      hb = Math.floor(h / beta / factor) * factor; wb = Math.floor(w / beta / factor) * factor;
    } else if (hb * wb < minPixels) {
      const beta = Math.sqrt(minPixels / (h * w));
      hb = Math.ceil((h * beta) / factor) * factor; wb = Math.ceil((w * beta) / factor) * factor;
    }
    return { width: Math.max(factor, wb), height: Math.max(factor, hb) };
  };
  const targetSize = (c, width, height) => smartResize(width, height, c.patch * c.merge, c.minPixels, c.maxPixels);

  // Pillow's separable resampling as torchvision does it on uint8 (antialiased, int16 weights): one axis's bounds and
  // fixed-point weights at 22 fraction bits. mtmd-image.cpp precompute_weights.
  const PREC = 22;
  const axisWeights = (inSize, outSize, algo) => {
    const support0 = algo === 'bicubic' ? 2 : 1;
    const filter = algo === 'bicubic'
      ? (x) => { const a = -0.5; x = Math.abs(x); return x < 1 ? ((a + 2) * x - (a + 3)) * x * x + 1 : x < 2 ? (((x - 5) * x + 8) * x - 4) * a : 0; }
      : (x) => { x = Math.abs(x); return x < 1 ? 1 - x : 0; };
    const scale = inSize / outSize, fscale = Math.max(1, scale), support = support0 * fscale;
    const ksize = Math.ceil(support) * 2 + 1;
    const pre = new Float64Array(outSize * ksize), bounds = new Int32Array(outSize * 2);
    for (let xx = 0; xx < outSize; xx++) {
      const center = (xx + 0.5) * scale, ss = 1 / fscale;
      const xmin = Math.max(0, Math.trunc(center - support + 0.5));
      const xcnt = Math.min(inSize, Math.trunc(center + support + 0.5)) - xmin;
      let ww = 0;
      for (let x = 0; x < xcnt; x++) { const v = filter((x + xmin - center + 0.5) * ss); pre[xx * ksize + x] = v; ww += v; }
      if (ww !== 0) for (let x = 0; x < xcnt; x++) pre[xx * ksize + x] /= ww;
      bounds[2 * xx] = xmin; bounds[2 * xx + 1] = xcnt;
    }
    // torchvision: as many fraction bits as the largest weight allows in an int16
    let max = -Infinity;
    for (let i = 0; i < pre.length; i++) if (pre[i] > max) max = pre[i];
    let prec = 0;
    for (; prec < PREC; prec++) if (Math.trunc(0.5 + max * 2 ** (prec + 1)) >= 1 << 15) break;
    const k = new Int32Array(pre.length), up = 2 ** (PREC - prec), fx = 2 ** prec;
    for (let i = 0; i < pre.length; i++) k[i] = Math.trunc(pre[i] * fx + (pre[i] < 0 ? -0.5 : 0.5)) * up;
    return { ksize, bounds, k };
  };
  const clip8 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);
  // RGB uint8 (width × height × 3) resized to tw × th: horizontal pass, then vertical, each rounded to uint8.
  const resize = (rgb, width, height, tw, th, algo = 'bicubic') => {
    if (!(tw > 0 && th > 0)) fail('resize target');
    let src = rgb, w = width;
    if (tw !== width) {
      const { ksize, bounds, k } = axisWeights(width, tw, algo), out = new Uint8Array(tw * height * 3);
      for (let y = 0; y < height; y++) {
        for (let xx = 0; xx < tw; xx++) {
          const xmin = bounds[2 * xx], xcnt = bounds[2 * xx + 1];
          for (let ch = 0; ch < 3; ch++) {
            let s = 1 << (PREC - 1);
            for (let x = 0; x < xcnt; x++) s += src[(y * w + xmin + x) * 3 + ch] * k[xx * ksize + x];
            out[(y * tw + xx) * 3 + ch] = clip8(Math.floor(s / 2 ** PREC));
          }
        }
      }
      src = out; w = tw;
    }
    if (th !== height) {
      const { ksize, bounds, k } = axisWeights(height, th, algo), out = new Uint8Array(w * th * 3), row = w * 3;
      for (let yy = 0; yy < th; yy++) {
        const ymin = bounds[2 * yy], ycnt = bounds[2 * yy + 1];
        for (let i = 0; i < row; i++) {
          let s = 1 << (PREC - 1);
          for (let y = 0; y < ycnt; y++) s += src[(ymin + y) * row + i] * k[yy * ksize + y];
          out[yy * row + i] = clip8(Math.floor(s / 2 ** PREC));
        }
      }
      src = out;
    }
    return src === rgb ? Uint8Array.from(rgb) : src;
  };

  // Pixels (RGBA, 4 bytes a pixel as canvas ImageData gives them, or RGB with channels 3) → { width, height, rgb, pixels }:
  // the resized RGB and its normalized floats (width × height × 3, channels interleaved).
  const preprocess = (c, data, width, height, { channels = 4 } = {}) => {
    if (channels !== 3 && channels !== 4) fail('channels');
    if (!(width > 0 && height > 0) || data.length !== width * height * channels) fail(`${data.length} bytes are not ${width} × ${height} × ${channels}`);
    let rgb = data;
    if (channels === 4) {
      rgb = new Uint8Array(width * height * 3);
      for (let p = 0; p < width * height; p++) { rgb[3 * p] = data[4 * p]; rgb[3 * p + 1] = data[4 * p + 1]; rgb[3 * p + 2] = data[4 * p + 2]; }
    }
    const t = targetSize(c, width, height);
    const out = resize(rgb, width, height, t.width, t.height, c.resize);
    const pixels = new Float32Array(out.length), mean = c.mean.map(fr), std = c.std.map(fr);
    for (let i = 0; i < out.length; i++) pixels[i] = fr(fr(fr(out[i] / 255) - mean[i % 3]) / std[i % 3]);
    return { width: t.width, height: t.height, rgb: out, pixels };
  };

  // ---- weights ---------------------------------------------------------------------------------------------------------
  const load = async (g, { onTensor } = {}) => {
    const c = config(g);
    const need = (name) => { const t = g.tensor(name); if (!t) fail(`no ${name}`); return t; };
    // A matrix of rows (ggml's last dims) of cols (dims[0], or the product of all but the last for conv kernels).
    const mat = async (info) => {
      const rows = info.dims[info.dims.length - 1], cols = info.count / rows;
      const m = { name: info.name, type: info.type, rows, cols, bytes: await g.read(info), rowBytes: Q().bytes(info.type, cols) };
      onTensor?.(info.name); return m;
    };
    const vec = async (info, n) => {
      if (info.count !== n) fail(`${info.name}: ${info.count} values, ${n} expected`);
      const v = Q().dequantize(info.type, await g.read(info), n); onTensor?.(info.name); return v;
    };
    const E = c.nEmbd, P = c.patch;
    const w = {
      patch0: await mat(need('v.patch_embd.weight')), patch1: g.tensor('v.patch_embd.weight.1') ? await mat(need('v.patch_embd.weight.1')) : null,
      embNorm: await vec(need('v.embedding_norm.weight'), E),
      inNormW: await vec(need('mm.input_norm.weight'), E), inNormB: await vec(need('mm.input_norm.bias'), E),
      mm0: await mat(need('mm.0.weight')), mm0b: null, mm2: await mat(need('mm.2.weight')), mm2b: null,
      layers: [],
    };
    w.mm0b = await vec(need('mm.0.bias'), w.mm0.rows); w.mm2b = await vec(need('mm.2.bias'), w.mm2.rows);
    if (w.patch0.cols !== 3 * P * P || w.patch0.rows !== E || (w.patch1 && w.patch1.cols !== w.patch0.cols)) fail('patch_embd shape');
    if (g.tensor('v.patch_embd.bias')) fail('a patch bias: not lfm3vl');
    if (w.mm0.cols !== 4 * E || w.mm2.cols !== w.mm0.rows || w.mm2.rows !== c.outEmbd) fail('projector shapes');
    for (let i = 0; i < c.nLayer; i++) {
      const b = (n) => `v.blk.${i}.${n}.weight`, has = (n) => !!g.tensor(b(n));
      const L = {
        ln1: await vec(need(b('ln1')), E), ln2: await vec(need(b('ln2')), E),
        gate: await mat(need(b('ffn_gate'))), up: await mat(need(b('ffn_up'))), down: await mat(need(b('ffn_down'))),
      };
      if (has('conv2d_in_proj')) {
        L.kind = 'conv';
        L.inProj = await mat(need(b('conv2d_in_proj'))); L.outProj = await mat(need(b('conv2d_out_proj')));
        const sp = need(b('conv2d_spatial'));
        if (sp.dims[0] !== 3 || sp.dims[1] !== 3) fail(`layer ${i}: spatial kernel ${sp.dims}`);
        L.spatial = await vec(sp, 9 * E);
        if (L.inProj.rows !== 3 * E) fail(`layer ${i}: in_proj rows`);
      } else {
        L.kind = 'attn';
        L.wq = await mat(need(b('attn_q'))); L.wk = await mat(need(b('attn_k'))); L.wv = await mat(need(b('attn_v'))); L.wo = await mat(need(b('attn_out')));
        L.qNorm = await vec(need(b('attn_q_norm')), c.headDim); L.kNorm = await vec(need(b('attn_k_norm')), c.headDim);
        if (L.wq.rows !== c.nHead * c.headDim || L.wk.rows !== c.nHeadKv * c.headDim || L.wv.rows !== L.wk.rows) fail(`layer ${i}: attention shapes`);
        for (const n of ['attn_q', 'attn_k', 'attn_v', 'attn_out', 'ffn_up', 'ffn_down']) if (g.tensor(`v.blk.${i}.${n}.bias`)) fail(`layer ${i}: ${n} bias`);
      }
      w.layers.push(L);
    }
    return { config: c, weights: w };
  };

  // ---- ops (matmul and rmsnorm as the text reference's) ----------------------------------------------------------------
  const ops = () => R()._ops;
  const matmul = (W, X, T) => ops().matmul(W, X, T);
  const rmsnorm = (X, count, n, wt, eps, out) => ops().rmsnorm(X, count, n, wt, eps, out);
  const addBias = (Y, T, b) => { const n = b.length; for (let t = 0; t < T; t++) for (let i = 0; i < n; i++) Y[t * n + i] = Y[t * n + i] + b[i]; return Y; };
  const layernorm = (X, count, n, wt, b, eps) => {
    const out = new Float32Array(count * n);
    for (let v = 0, o = 0; v < count; v++, o += n) {
      let s = 0;
      for (let i = 0; i < n; i++) s += X[o + i];
      const mean = fr(s / n);
      let ss = 0;
      for (let i = 0; i < n; i++) { const d = fr(X[o + i] - mean); ss += d * d; }
      const scale = 1 / Math.sqrt(ss / n + eps);
      for (let i = 0; i < n; i++) out[o + i] = fr(fr(fr(X[o + i] - mean) * scale) * wt[i]) + b[i];
    }
    return out;
  };
  // erf in doubles: 2/√π · e^(−x²) · Σ 2ⁿ x^(2n+1) / (1·3·…·(2n+1)), every term positive (no cancellation); ±1 past 6.
  const erf = (x) => {
    const a = Math.abs(x);
    if (a >= 6) return Math.sign(x);
    let term = a, sum = a;
    for (let n = 1; term > sum * 1e-17; n++) { term *= (2 * a * a) / (2 * n + 1); sum += term; }
    return Math.sign(x) * (2 / Math.sqrt(Math.PI)) * Math.exp(-a * a) * sum;
  };
  const geluErf = (x) => 0.5 * x * (1 + erf(x * Math.SQRT1_2));
  const silu = (x) => x / (1 + Math.exp(-x));

  // ---- the encoder -----------------------------------------------------------------------------------------------------
  // A preprocessed image ({ width, height, pixels }) → { embeddings (n × out embd), n, nx, ny } (nx × ny = n, raster).
  const encode = (model, pre, { onLayer } = {}) => {
    const { config: c, weights: w } = model;
    const E = c.nEmbd, P = c.patch, px = pre.width / P, py = pre.height / P, T = px * py, hd = c.headDim;
    if (!Number.isInteger(px) || !Number.isInteger(py) || px % 2 || py % 2) fail(`${pre.width} × ${pre.height} is not whole 2 × 2 blocks of patches`);
    // im2col: patch t's values in the kernels' order (kx fastest, then ky, then channel)
    const cols = new Float32Array(T * 3 * P * P);
    for (let y = 0; y < py; y++) for (let x = 0; x < px; x++) {
      const o = (y * px + x) * 3 * P * P;
      for (let ch = 0; ch < 3; ch++) for (let ky = 0; ky < P; ky++) for (let kx = 0; kx < P; kx++) cols[o + ch * P * P + ky * P + kx] = pre.pixels[((y * P + ky) * pre.width + x * P + kx) * 3 + ch];
    }
    let x = matmul(w.patch0, cols, T);
    if (w.patch1) { const x1 = matmul(w.patch1, cols, T); for (let i = 0; i < x.length; i++) x[i] = x[i] + x1[i]; }
    x = rmsnorm(x, T, E, w.embNorm, c.eps);

    // RoPE angles per patch: pairs j < hd/4 turn by the row, the next hd/4 by the column.
    const quarter = hd / 4, cos = new Float32Array(T * hd / 2), sin = new Float32Array(T * hd / 2);
    for (let t = 0; t < T; t++) {
      const yy = Math.floor(t / px), xx = t % px;
      for (let j = 0; j < hd / 2; j++) {
        const theta = (j < quarter ? yy : xx) * c.ropeTheta ** ((-2 * (j % quarter)) / (hd / 2));
        cos[t * hd / 2 + j] = fr(Math.cos(theta)); sin[t * hd / 2 + j] = fr(Math.sin(theta));
      }
    }
    const rope = (X, heads) => {
      const half = hd / 2;
      for (let t = 0; t < T; t++) for (let h = 0; h < heads; h++) {
        const o = (t * heads + h) * hd;
        for (let j = 0; j < half; j++) {
          const x0 = X[o + j], x1 = X[o + j + half], cs = cos[t * half + j], sn = sin[t * half + j];
          X[o + j] = x0 * cs - x1 * sn;
          X[o + j + half] = x0 * sn + x1 * cs;
        }
      }
    };

    const convOp = (L, n) => {
      const bcx = matmul(L.inProj, n, T), g = new Float32Array(T * E), y = new Float32Array(T * E);
      for (let t = 0; t < T; t++) for (let e = 0; e < E; e++) g[t * E + e] = bcx[t * 3 * E + e] * bcx[t * 3 * E + 2 * E + e];
      for (let yy = 0; yy < py; yy++) for (let xx = 0; xx < px; xx++) {
        const t = yy * px + xx;
        for (let e = 0; e < E; e++) {
          let s = 0;
          for (let ky = 0; ky < 3; ky++) {
            const sy = yy + ky - 1;
            if (sy < 0 || sy >= py) continue;
            for (let kx = 0; kx < 3; kx++) {
              const sx = xx + kx - 1;
              if (sx < 0 || sx >= px) continue;
              s += L.spatial[e * 9 + ky * 3 + kx] * g[(sy * px + sx) * E + e];
            }
          }
          y[t * E + e] = bcx[t * 3 * E + E + e] * fr(s);
        }
      }
      return matmul(L.outProj, y, T);
    };

    const attnOp = (L, n) => {
      const H = c.nHead, Hkv = c.nHeadKv, group = H / Hkv;
      const q = matmul(L.wq, n, T), k = matmul(L.wk, n, T), v = matmul(L.wv, n, T);
      rmsnorm(q, T * H, hd, L.qNorm, c.eps, q); rmsnorm(k, T * Hkv, hd, L.kNorm, c.eps, k);
      rope(q, H); rope(k, Hkv);
      const out = new Float32Array(T * H * hd), scale = 1 / Math.sqrt(hd), scores = new Float64Array(T), acc = new Float64Array(hd);
      for (let t = 0; t < T; t++) for (let h = 0; h < H; h++) {
        const qo = (t * H + h) * hd, kh = Math.floor(h / group) * hd;
        let max = -Infinity;
        for (let j = 0; j < T; j++) {
          let d = 0;
          const ko = j * Hkv * hd + kh;
          for (let i = 0; i < hd; i++) d += q[qo + i] * k[ko + i];
          scores[j] = d * scale;
          if (scores[j] > max) max = scores[j];
        }
        let z = 0;
        for (let j = 0; j < T; j++) { scores[j] = Math.exp(scores[j] - max); z += scores[j]; }
        acc.fill(0);
        for (let j = 0; j < T; j++) { const p = scores[j] / z, vo = j * Hkv * hd + kh; for (let i = 0; i < hd; i++) acc[i] += p * v[vo + i]; }
        for (let i = 0; i < hd; i++) out[qo + i] = acc[i];
      }
      return matmul(L.wo, out, T);
    };

    for (let li = 0; li < c.nLayer; li++) {
      const L = w.layers[li];
      const n = rmsnorm(x, T, E, L.ln1, c.eps);
      const a = L.kind === 'conv' ? convOp(L, n) : attnOp(L, n);
      for (let i = 0; i < T * E; i++) x[i] += a[i];
      const fn = rmsnorm(x, T, E, L.ln2, c.eps);
      const g = matmul(L.gate, fn, T), u = matmul(L.up, fn, T);
      for (let i = 0; i < g.length; i++) g[i] = fr(silu(g[i])) * u[i];
      const f = matmul(L.down, g, T);
      for (let i = 0; i < T * E; i++) x[i] += f[i];
      onLayer?.(li);
    }

    // the projector
    const normed = layernorm(x, T, E, w.inNormW, w.inNormB, c.projEps);
    const nx = px / 2, ny = py / 2, N = nx * ny, merged = new Float32Array(N * 4 * E);
    for (let yh = 0; yh < ny; yh++) for (let xh = 0; xh < nx; xh++) {
      const o = (yh * nx + xh) * 4 * E;
      [[0, 0], [0, 1], [1, 0], [1, 1]].forEach(([dy, dx], q) => merged.set(normed.subarray(((2 * yh + dy) * px + 2 * xh + dx) * E, ((2 * yh + dy) * px + 2 * xh + dx + 1) * E), o + q * E));
    }
    const hmid = addBias(matmul(w.mm0, merged, N), N, w.mm0b);
    for (let i = 0; i < hmid.length; i++) hmid[i] = geluErf(hmid[i]);
    const embeddings = addBias(matmul(w.mm2, hmid, N), N, w.mm2b);
    return { embeddings, n: N, nx, ny };
  };

  // ---- into the text model ---------------------------------------------------------------------------------------------
  // The text model's ids of <|vision_start|> and <|vision_end|> (a GGUF's tokenizer.ggml.tokens).
  const tokens = (g) => {
    const list = g.kv['tokenizer.ggml.tokens'];
    const id = (s) => { const i = list ? list.indexOf(s) : -1; if (i < 0) fail(`no ${s} token`); return i; };
    return { start: id('<|vision_start|>'), end: id('<|vision_end|>') };
  };
  // Feeds a prompt's parts in order into a text reference session: arrays of token ids, and images as Float32Array
  // embeddings (n × embedding_length, from encode). → the logits of the last text part: every row, or the last
  // (logits: 'last'), or of every text part in order, a row per token (logits: 'text').
  const feed = (session, parts, { logits = 'last' } = {}) => {
    const rows = [];
    let last = null;
    for (const p of parts) {
      if (p instanceof Float32Array) { session.forwardEmbeddings(p); last = null; continue; }
      if (!p.length) continue;
      last = session.forward(p, { logits: logits === 'last' ? 'last' : 'all' });
      if (logits === 'text') rows.push(last);
    }
    if (!last) fail('the prompt must end in text');
    if (logits !== 'text') return last;
    const out = new Float32Array(rows.reduce((n, r) => n + r.length, 0));
    let o = 0;
    for (const r of rows) { out.set(r, o); o += r.length; }
    return out;
  };

  return { config, load, targetSize, preprocess, resize, encode, tokens, feed, _ops: { smartResize, axisWeights, erf, geluErf, layernorm } };
})();
if (typeof module !== 'undefined') module.exports = GZ_AI_VISION_REFERENCE; else GZ_AI_VISION_REFERENCE;
