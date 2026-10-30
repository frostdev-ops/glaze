// The local engine's ground truth: a CPU forward pass of LiquidAI's LFM3 (GGUF architecture `lfm3`) in Float32Array,
// slow by design, for WebGPU kernels to be checked against. scripts/local-reference-check.js holds it to llama.cpp.
// The graph is llama.cpp's src/models/lfm3.cpp and lfm-base.cpp (b11960) and HF's modeling_lfm3.py (LiquidAI/LFM3-1.7B
// at ac2586a3), which agree. Per block, h the residual stream:
//   a = op(rmsnorm(h)·attn_norm); h += rmsnorm(a)·post_attention_norm      (the post norms only when present)
//   f = w2(silu(w1·n) ⊙ w3·n), n = rmsnorm(h)·ffn_norm;  h += rmsnorm(f)·post_ffw_norm
// op is a gated short convolution on layers with no KV heads:
//   B, C, x = in_proj·n (thirds, in that order);  y = C ⊙ conv(B ⊙ x);  out_proj·y
//   conv: depthwise and causal, width shortconv.l_cache (7), w[c][6] on the current token; state: the last 6 B ⊙ x.
// or attention (GQA, query head i reads KV head ⌊i / (heads / kv heads)⌋):
//   q, k = rmsnorm per head (attn_q_norm, attn_k_norm), then NeoX RoPE: dims (i, i + n/2) for i < n/2, n =
//   rope.dimension_count (128), θ = pos · base^(−2i/n) / factor_i. Sliding layers (sliding_window_pattern): base
//   freq_base_swa (1e4), no factors, and a query at p sees keys at p − window < j ≤ p. Full layers: base freq_base
//   (1e6), factors rope_freqs (32 × 1, 32 × 1e30: only the first 32 pairs turn, HF's partial_rotary_factor 0.5 with
//   the full head's frequency progression). Softmax(q·k / √head_dim); each head's output × sigmoid(attn_gate·n)_head,
//   before attn_output.
// Then rmsnorm·output_norm and the output matrix (token_embd when there is no output.weight). RMSNorm: x / √(mean x² + ε).
// Numerics: every value an op stores is a float32 (Float32Array); inside an op, sums and products are JavaScript doubles
// (dot products, norms, softmax, RoPE angles), so the reference is at least as exact as an f32-accumulating kernel.
// Weights stay quantized in memory and are dequantized a row at a time (lib/ai/local/quant.js), bit for bit as ggml.
// Classic script; node exports.
var GZ_AI_REFERENCE = globalThis.GZ_AI_REFERENCE || (() => {
  let quant = null;
  const Q = () => quant || (quant = typeof GZ_AI_QUANT !== 'undefined' ? GZ_AI_QUANT : require('./quant.js'));
  const fr = Math.fround;
  const fail = (what) => { throw new TypeError(`reference: ${what}`); };

  // ---- config from GGUF metadata ---------------------------------------------------------------------------------------
  const config = (g) => {
    const kv = g.kv, arch = kv['general.architecture'];
    if (arch !== 'lfm3') fail(`architecture ${JSON.stringify(arch)}: only lfm3`);
    const k = (name, dflt) => { const v = kv[`${arch}.${name}`]; if (v === undefined) { if (dflt === undefined) fail(`no ${arch}.${name}`); return dflt; } return typeof v === 'bigint' ? Number(v) : v; };
    const nLayer = k('block_count'), nEmbd = k('embedding_length'), nHead = k('attention.head_count');
    const perLayer = (v) => (typeof v === 'number' ? new Array(nLayer).fill(v) : Array.from(v, Number));
    const nHeadKv = perLayer(k('attention.head_count_kv'));
    const swa = Array.from(k('attention.sliding_window_pattern'), Boolean);
    if (nHeadKv.length !== nLayer || swa.length !== nLayer) fail('per-layer arrays are not block_count long');
    const headDim = k('attention.key_length', nEmbd / nHead);
    if (k('attention.value_length', headDim) !== headDim) fail('key and value lengths differ');
    const nRot = k('rope.dimension_count', headDim);
    const emb = g.tensor('token_embd.weight');
    if (!emb) fail('no token_embd.weight');
    const c = {
      arch, nLayer, nEmbd, nHead, nHeadKv, headDim, nFf: k('feed_forward_length'), eps: k('attention.layer_norm_rms_epsilon'),
      nRot, nRotSwa: k('rope.dimension_count_swa', nRot), ropeBase: k('rope.freq_base', 10000), ropeBaseSwa: k('rope.freq_base_swa'),
      window: k('attention.sliding_window'), lCache: k('shortconv.l_cache'), vocab: emb.dims[1],
      layers: nHeadKv.map((kvh, i) => (kvh === 0 ? 'conv' : swa[i] ? 'swa' : 'full')),
    };
    if (c.layers.some((t, i) => t !== 'conv' && nHead % nHeadKv[i])) fail('head count is not a multiple of the KV heads');
    if (c.nRot > headDim || c.nRot % 2 || c.nRotSwa > headDim || c.nRotSwa % 2) fail('rope dimensions');
    if (c.lCache < 2) fail('shortconv.l_cache');
    return c;
  };

  // ---- weights ---------------------------------------------------------------------------------------------------------
  // A matrix of `rows` rows of `cols` (ggml dims [cols, rows]), quantized bytes kept; or a float vector.
  const matrix = (info, bytes) => {
    if (info.dims.length !== 2 && !(info.dims.length === 1)) fail(`${info.name}: not a matrix`);
    const cols = info.dims[0], rows = info.dims[1] || 1, rowBytes = Q().bytes(info.type, cols);
    return { name: info.name, type: info.type, rows, cols, bytes, rowBytes };
  };
  // Row r of a matrix, dequantized into out.
  const row = (W, r, out) => Q().dequantize(W.type, W.bytes.subarray(r * W.rowBytes, (r + 1) * W.rowBytes), W.cols, out);

  // → { config, weights }. Every tensor's bytes are read once (quantized: the model's file size in memory).
  const load = async (g, { onTensor } = {}) => {
    const c = config(g);
    const need = (name) => { const t = g.tensor(name); if (!t) fail(`no ${name}`); return t; };
    const opt = (name) => g.tensor(name);
    const mat = async (info) => { const m = matrix(info, await g.read(info)); onTensor?.(info.name); return m; };
    const vec = async (info, n) => {
      if (info.count !== n) fail(`${info.name}: ${info.count} values, ${n} expected`);
      const v = Q().dequantize(info.type, await g.read(info), n); onTensor?.(info.name); return v;
    };
    const E = c.nEmbd;
    const w = {
      embd: await mat(need('token_embd.weight')),
      outNorm: await vec(need('output_norm.weight'), E),
      layers: [],
    };
    w.output = opt('output.weight') ? await mat(opt('output.weight')) : w.embd;
    const freqs = opt('rope_freqs.weight');
    w.ropeFreqs = freqs ? await vec(freqs, c.nRot / 2) : null;
    for (let i = 0; i < c.nLayer; i++) {
      const b = (n) => `blk.${i}.${n}.weight`;
      const L = {
        kind: c.layers[i],
        attnNorm: await vec(need(b('attn_norm')), E), ffnNorm: await vec(need(b('ffn_norm')), E),
        gate: await mat(need(b('ffn_gate'))), up: await mat(need(b('ffn_up'))), down: await mat(need(b('ffn_down'))),
      };
      const pa = opt(b('post_attention_norm')), pf = opt(b('post_ffw_norm'));
      if (!pa !== !pf) fail(`layer ${i}: one post norm without the other`);
      L.postAttnNorm = pa ? await vec(pa, E) : null;
      L.postFfnNorm = pf ? await vec(pf, E) : null;
      if (L.kind === 'conv') {
        L.conv = await vec(need(b('shortconv.conv')), c.lCache * E);
        L.inProj = await mat(need(b('shortconv.in_proj')));
        L.outProj = await mat(need(b('shortconv.out_proj')));
        if (L.inProj.rows !== 3 * E) fail(`layer ${i}: in_proj rows`);
      } else {
        const hd = c.headDim;
        L.wq = await mat(need(b('attn_q'))); L.wk = await mat(need(b('attn_k'))); L.wv = await mat(need(b('attn_v')));
        L.wo = await mat(need(b('attn_output'))); L.wGate = await mat(need(b('attn_gate')));
        L.qNorm = await vec(need(b('attn_q_norm')), hd); L.kNorm = await vec(need(b('attn_k_norm')), hd);
        if (L.wq.rows !== c.nHead * hd || L.wk.rows !== c.nHeadKv[i] * hd || L.wGate.rows !== c.nHead) fail(`layer ${i}: attention shapes`);
        if (L.kind === 'full' && !w.ropeFreqs && c.nRot !== hd) fail('partial rotary without rope_freqs');
      }
      w.layers.push(L);
    }
    if (w.embd.cols !== E || w.output.cols !== E) fail('embedding width');
    return { config: c, weights: w };
  };

  // ---- ops -------------------------------------------------------------------------------------------------------------
  // Y[t][r] = W[r] · X[t] for T rows of X (each W.cols long). Each weight row is dequantized once for all T.
  const matmul = (W, X, T) => {
    const n = W.cols, Y = new Float32Array(T * W.rows), wr = new Float32Array(n);
    for (let r = 0; r < W.rows; r++) {
      row(W, r, wr);
      for (let t = 0, xo = 0; t < T; t++, xo += n) {
        let s = 0;
        for (let i = 0; i < n; i++) s += wr[i] * X[xo + i];
        Y[t * W.rows + r] = s;
      }
    }
    return Y;
  };
  // In place over `count` vectors of `n` at X (stride n): x / √(mean x² + ε) · w.
  const rmsnorm = (X, count, n, w, eps, out = new Float32Array(count * n)) => {
    for (let v = 0, o = 0; v < count; v++, o += n) {
      let ss = 0;
      for (let i = 0; i < n; i++) ss += X[o + i] * X[o + i];
      const scale = 1 / Math.sqrt(ss / n + eps);
      for (let i = 0; i < n; i++) out[o + i] = X[o + i] * scale * w[i];
    }
    return out;
  };
  const silu = (x) => x / (1 + Math.exp(-x));
  const sigmoid = (x) => 1 / (1 + Math.exp(-x));

  // NeoX RoPE on `heads` vectors of hd at X[t] for each token t at pos[t]: pairs (i, i + n/2), i < n/2.
  const rope = (X, T, heads, hd, pos, n, base, factors) => {
    const half = n / 2, cos = new Float64Array(half), sin = new Float64Array(half);
    for (let t = 0; t < T; t++) {
      for (let i = 0; i < half; i++) {
        const theta = (pos[t] * base ** (-2 * i / n)) / (factors ? factors[i] : 1);
        cos[i] = fr(Math.cos(theta)); sin[i] = fr(Math.sin(theta));
      }
      for (let h = 0; h < heads; h++) {
        const o = (t * heads + h) * hd;
        for (let i = 0; i < half; i++) {
          const x0 = X[o + i], x1 = X[o + i + half];
          X[o + i] = x0 * cos[i] - x1 * sin[i];
          X[o + i + half] = x0 * sin[i] + x1 * cos[i];
        }
      }
    }
  };

  // ---- a session: the caches and the forward pass ----------------------------------------------------------------------
  // A sequence's state: per attention layer its keys and values for every position so far (sliding layers too: the mask
  // keeps them to the window), per conv layer the last l_cache − 1 inputs to its convolution (zeros at the start).
  const session = (model) => {
    const { config: c, weights: w } = model;
    const E = c.nEmbd, hd = c.headDim, K = c.lCache - 1;
    const state = c.layers.map((kind, i) => (kind === 'conv' ? { conv: new Float32Array(K * E) } : { k: new Float32Array(0), v: new Float32Array(0), width: c.nHeadKv[i] * hd }));
    let pos = 0;
    const grow = (s, need) => {
      if (s.k.length >= need) return;
      const cap = Math.max(need, s.k.length * 2, 64 * s.width);
      const k = new Float32Array(cap), v = new Float32Array(cap);
      k.set(s.k); v.set(s.v); s.k = k; s.v = v;
    };

    const convBlock = (L, s, n, T) => {
      const bcx = matmul(L.inProj, n, T), bx = new Float32Array(T * E), y = new Float32Array(T * E);
      for (let t = 0; t < T; t++) for (let e = 0; e < E; e++) bx[t * E + e] = bcx[t * 3 * E + e] * bcx[t * 3 * E + 2 * E + e];
      // The window over [state | bx]: input j < K is state row j, then bx row j − K.
      const at = (j, e) => (j < K ? s.conv[j * E + e] : bx[(j - K) * E + e]);
      for (let t = 0; t < T; t++) {
        for (let e = 0; e < E; e++) {
          let sum = 0;
          for (let k = 0; k <= K; k++) sum += at(t + k, e) * L.conv[e * (K + 1) + k];
          y[t * E + e] = bcx[t * 3 * E + E + e] * fr(sum);
        }
      }
      const next = new Float32Array(K * E);
      for (let j = 0; j < K; j++) for (let e = 0; e < E; e++) next[j * E + e] = at(T + j, e);
      s.conv = next;
      return matmul(L.outProj, y, T);
    };

    const attnBlock = (L, s, n, T, li) => {
      const H = c.nHead, Hkv = c.nHeadKv[li], group = H / Hkv, swa = L.kind === 'swa';
      const q = matmul(L.wq, n, T), k = matmul(L.wk, n, T), v = matmul(L.wv, n, T);
      rmsnorm(q, T * H, hd, L.qNorm, c.eps, q);
      rmsnorm(k, T * Hkv, hd, L.kNorm, c.eps, k);
      const ps = Array.from({ length: T }, (_, t) => pos + t);
      if (swa) { rope(q, T, H, hd, ps, c.nRotSwa, c.ropeBaseSwa, null); rope(k, T, Hkv, hd, ps, c.nRotSwa, c.ropeBaseSwa, null); }
      else { rope(q, T, H, hd, ps, c.nRot, c.ropeBase, w.ropeFreqs); rope(k, T, Hkv, hd, ps, c.nRot, c.ropeBase, w.ropeFreqs); }
      grow(s, (pos + T) * s.width);
      s.k.set(k, pos * s.width); s.v.set(v, pos * s.width);
      const gate = matmul(L.wGate, n, T);
      const out = new Float32Array(T * H * hd), scale = 1 / Math.sqrt(hd);
      const scores = new Float64Array(pos + T), acc = new Float64Array(hd);
      for (let t = 0; t < T; t++) {
        const p = pos + t, from = swa ? Math.max(0, p - c.window + 1) : 0;
        for (let h = 0; h < H; h++) {
          const qo = (t * H + h) * hd, kh = Math.floor(h / group) * hd;
          let max = -Infinity;
          for (let j = from; j <= p; j++) {
            let d = 0;
            const ko = j * s.width + kh;
            for (let i = 0; i < hd; i++) d += q[qo + i] * s.k[ko + i];
            scores[j] = d * scale;
            if (scores[j] > max) max = scores[j];
          }
          let z = 0;
          for (let j = from; j <= p; j++) { scores[j] = Math.exp(scores[j] - max); z += scores[j]; }
          acc.fill(0);
          for (let j = from; j <= p; j++) {
            const pj = scores[j] / z, vo = j * s.width + kh;
            for (let i = 0; i < hd; i++) acc[i] += pj * s.v[vo + i];
          }
          const g = sigmoid(gate[t * H + h]);
          for (let i = 0; i < hd; i++) out[qo + i] = fr(acc[i]) * fr(g);
        }
      }
      return matmul(L.wo, out, T);
    };

    // Feeds tokens at the next positions. → their logits: all rows (T × vocab) or only the last (vocab).
    const forward = (tokens, { logits = 'last' } = {}) => {
      const T = tokens.length;
      if (!T) fail('no tokens');
      const x = new Float32Array(T * E), er = new Float32Array(E);
      for (let t = 0; t < T; t++) {
        const id = tokens[t];
        if (!Number.isInteger(id) || id < 0 || id >= c.vocab) fail(`token ${id}`);
        x.set(row(w.embd, id, er), t * E);
      }
      for (let li = 0; li < c.nLayer; li++) {
        const L = w.layers[li], s = state[li];
        const n = rmsnorm(x, T, E, L.attnNorm, c.eps);
        let a = L.kind === 'conv' ? convBlock(L, s, n, T) : attnBlock(L, s, n, T, li);
        if (L.postAttnNorm) a = rmsnorm(a, T, E, L.postAttnNorm, c.eps, a);
        for (let i = 0; i < T * E; i++) x[i] += a[i];
        const fn = rmsnorm(x, T, E, L.ffnNorm, c.eps);
        const g = matmul(L.gate, fn, T), u = matmul(L.up, fn, T);
        for (let i = 0; i < g.length; i++) g[i] = silu(g[i]) * u[i];
        let f = matmul(L.down, g, T);
        if (L.postFfnNorm) f = rmsnorm(f, T, E, L.postFfnNorm, c.eps, f);
        for (let i = 0; i < T * E; i++) x[i] += f[i];
      }
      pos += T;
      const first = logits === 'all' ? 0 : T - 1, rows = T - first;
      const h = rmsnorm(x.subarray(first * E), rows, E, w.outNorm, c.eps);
      return matmul(w.output, h, rows);
    };

    return { forward, get pos() { return pos; }, state };
  };

  // ---- sampling --------------------------------------------------------------------------------------------------------
  // The highest logit's id (the lowest id on a tie).
  const greedy = (logits) => {
    let b = 0;
    for (let i = 1; i < logits.length; i++) if (logits[i] > logits[b]) b = i;
    return b;
  };
  // The k highest as [{ id, logit }], highest first (lower id first on a tie).
  const top = (logits, k) => {
    const best = [];
    for (let i = 0; i < logits.length; i++) {
      const v = logits[i];
      if (best.length === k && v <= best[k - 1].logit) continue;
      let j = best.length < k ? best.length : k - 1;
      while (j > 0 && best[j - 1].logit < v) j--;
      best.splice(j, 0, { id: i, logit: v });
      if (best.length > k) best.pop();
    }
    return best;
  };
  // A draw from the softmax of the k highest logits at `temperature`; random() in [0, 1) (Math.random by default).
  const topK = (logits, k, { temperature = 1, random = Math.random } = {}) => {
    if (!(k >= 1)) fail('k');
    if (!(temperature > 0)) return greedy(logits);
    const best = top(logits, k), m = best[0].logit;
    const p = best.map((b) => Math.exp((b.logit - m) / temperature));
    let r = random() * p.reduce((a, b) => a + b, 0);
    for (let i = 0; i < best.length; i++) { r -= p[i]; if (r < 0) return best[i].id; }
    return best[best.length - 1].id;
  };

  return { config, load, session, greedy, top, topK, _ops: { matmul, rmsnorm, rope, row } };
})();
if (typeof module !== 'undefined') module.exports = GZ_AI_REFERENCE; else GZ_AI_REFERENCE;
