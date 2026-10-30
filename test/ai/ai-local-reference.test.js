// The local engine's reference forward pass (lib/ai/local/reference.js) on a tiny random lfm3 model in F32, written
// here as a GGUF: its logits against a plain re-statement of the graph below (no caches, every position recomputed
// from scratch), the same logits whether a prompt is fed at once, in chunks or a token at a time, the sliding window,
// and the sampling helpers. scripts/local-reference-check.js holds it to llama.cpp on the real model.
const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../lib/ai/local/gguf.js');
const R = require('../lib/ai/local/reference.js');

// conv, full, conv, sliding: 16 wide, 4 query heads over 2 KV heads of 8, window 3, conv width 3.
const C = { E: 16, H: 4, Hkv: 2, hd: 8, ff: 24, V: 40, window: 3, L: 3, kinds: ['conv', 'full', 'conv', 'swa'], eps: 1e-5 };
const mulberry = (a) => () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

const model = (() => {
  const r = mulberry(42), rnd = (n, s = 0.5, base = 0) => Float32Array.from({ length: n }, () => base + s * (2 * r() - 1));
  const t = { 'token_embd.weight': [[C.E, C.V], rnd(C.E * C.V, 1)], 'output_norm.weight': [[C.E], rnd(C.E, 0.2, 1)], 'rope_freqs.weight': [[C.hd / 2], Float32Array.of(1, 1, 1e30, 1e30)] };
  C.kinds.forEach((k, i) => {
    const b = (n) => `blk.${i}.${n}.weight`;
    Object.assign(t, {
      [b('attn_norm')]: [[C.E], rnd(C.E, 0.2, 1)], [b('ffn_norm')]: [[C.E], rnd(C.E, 0.2, 1)],
      [b('post_attention_norm')]: [[C.E], rnd(C.E, 0.2, 1)], [b('post_ffw_norm')]: [[C.E], rnd(C.E, 0.2, 1)],
      [b('ffn_gate')]: [[C.E, C.ff], rnd(C.E * C.ff)], [b('ffn_up')]: [[C.E, C.ff], rnd(C.E * C.ff)], [b('ffn_down')]: [[C.ff, C.E], rnd(C.ff * C.E)],
    });
    if (k === 'conv') Object.assign(t, { [b('shortconv.conv')]: [[C.L, C.E], rnd(C.L * C.E, 0.8)], [b('shortconv.in_proj')]: [[C.E, 3 * C.E], rnd(3 * C.E * C.E)], [b('shortconv.out_proj')]: [[C.E, C.E], rnd(C.E * C.E)] });
    else Object.assign(t, {
      [b('attn_q')]: [[C.E, C.H * C.hd], rnd(C.E * C.H * C.hd)], [b('attn_k')]: [[C.E, C.Hkv * C.hd], rnd(C.E * C.Hkv * C.hd)],
      [b('attn_v')]: [[C.E, C.Hkv * C.hd], rnd(C.E * C.Hkv * C.hd)], [b('attn_output')]: [[C.H * C.hd, C.E], rnd(C.H * C.hd * C.E)],
      [b('attn_gate')]: [[C.E, C.H], rnd(C.E * C.H, 2)], [b('attn_q_norm')]: [[C.hd], rnd(C.hd, 0.2, 1)], [b('attn_k_norm')]: [[C.hd], rnd(C.hd, 0.2, 1)],
    });
  });
  return t;
})();

// GGUF v3 bytes: the metadata as llama.cpp's converter writes it for lfm3, every tensor F32.
const gguf = () => {
  const parts = [], u32 = (v) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v, true); parts.push(b); };
  const u64 = (v) => { const b = new Uint8Array(8); new DataView(b.buffer).setBigUint64(0, BigInt(v), true); parts.push(b); };
  const f32 = (v) => { const b = new Uint8Array(4); new DataView(b.buffer).setFloat32(0, v, true); parts.push(b); };
  const str = (s) => { const b = new TextEncoder().encode(s); u64(b.length); parts.push(b); };
  const len = () => parts.reduce((n, p) => n + p.length, 0);
  const kv = [
    ['general.architecture', 8, () => str('lfm3')], ['lfm3.block_count', 4, () => u32(4)], ['lfm3.embedding_length', 4, () => u32(C.E)],
    ['lfm3.feed_forward_length', 4, () => u32(C.ff)], ['lfm3.attention.head_count', 4, () => u32(C.H)],
    ['lfm3.attention.head_count_kv', 9, () => { u32(5); u64(4); for (const k of C.kinds) u32(k === 'conv' ? 0 : C.Hkv); }],
    ['lfm3.rope.freq_base', 6, () => f32(1e6)], ['lfm3.rope.freq_base_swa', 6, () => f32(1e4)],
    ['lfm3.attention.layer_norm_rms_epsilon', 6, () => f32(C.eps)], ['lfm3.attention.key_length', 4, () => u32(C.hd)],
    ['lfm3.attention.value_length', 4, () => u32(C.hd)], ['lfm3.rope.dimension_count', 4, () => u32(C.hd)],
    ['lfm3.attention.sliding_window_pattern', 9, () => { u32(7); u64(4); for (const k of C.kinds) parts.push(Uint8Array.of(k === 'swa' ? 1 : 0)); }],
    ['lfm3.attention.sliding_window', 4, () => u32(C.window)], ['lfm3.shortconv.l_cache', 4, () => u32(C.L)],
  ];
  parts.push(new TextEncoder().encode('GGUF')); u32(3);
  const names = Object.keys(model);
  u64(names.length); u64(kv.length);
  for (const [k, ty, w] of kv) { str(k); u32(ty); w(); }
  let off = 0;
  for (const n of names) { const [dims, data] = model[n]; str(n); u32(dims.length); for (const d of dims) u64(d); u32(0); u64(off); off += Math.ceil((data.length * 4) / 32) * 32; }
  parts.push(new Uint8Array((32 - (len() % 32)) % 32));
  for (const n of names) { const d = new Uint8Array(model[n][1].buffer); parts.push(d, new Uint8Array((32 - (d.length % 32)) % 32)); }
  const out = new Uint8Array(len()); let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};

// ---- the graph again, plainly: all of it in doubles, every position from scratch --------------------------------------
const W = (n) => model[n][1];
const mv = (w, rows, cols, x) => Array.from({ length: rows }, (_, r) => { let s = 0; for (let i = 0; i < cols; i++) s += w[r * cols + i] * x[i]; return s; });
const norm = (x, w) => { const s = 1 / Math.sqrt(x.reduce((a, v) => a + v * v, 0) / x.length + C.eps); return x.map((v, i) => v * s * w[i]); };
const plain = (tokens) => {
  let h = tokens.map((id) => Array.from(W('token_embd.weight').subarray(id * C.E, (id + 1) * C.E)));
  C.kinds.forEach((kind, li) => {
    const b = (n) => W(`blk.${li}.${n}.weight`), T = h.length;
    const n = h.map((x) => norm(x, b('attn_norm')));
    let a;
    if (kind === 'conv') {
      const bcx = n.map((x) => mv(b('shortconv.in_proj'), 3 * C.E, C.E, x));
      const bx = bcx.map((v) => v.slice(0, C.E).map((B, e) => B * v[2 * C.E + e]));
      a = bcx.map((v, t) => {
        const y = Array.from({ length: C.E }, (_, e) => {
          let s = 0;
          for (let k = 0; k < C.L; k++) { const j = t - (C.L - 1) + k; if (j >= 0) s += b('shortconv.conv')[e * C.L + k] * bx[j][e]; }
          return v[C.E + e] * s;
        });
        return mv(b('shortconv.out_proj'), C.E, C.E, y);
      });
    } else {
      const base = kind === 'swa' ? 1e4 : 1e6, ff = kind === 'swa' ? [1, 1, 1, 1] : [1, 1, 1e30, 1e30];
      const ropeV = (v, p) => { const o = v.slice(); for (let i = 0; i < C.hd / 2; i++) { const th = (p * base ** (-2 * i / C.hd)) / ff[i]; o[i] = v[i] * Math.cos(th) - v[i + C.hd / 2] * Math.sin(th); o[i + C.hd / 2] = v[i] * Math.sin(th) + v[i + C.hd / 2] * Math.cos(th); } return o; };
      const heads = (v, nh, w) => Array.from({ length: nh }, (_, hh) => norm(v.slice(hh * C.hd, (hh + 1) * C.hd), w));
      const q = n.map((x, p) => heads(mv(b('attn_q'), C.H * C.hd, C.E, x), C.H, b('attn_q_norm')).map((v) => ropeV(v, p)));
      const k = n.map((x, p) => heads(mv(b('attn_k'), C.Hkv * C.hd, C.E, x), C.Hkv, b('attn_k_norm')).map((v) => ropeV(v, p)));
      const v = n.map((x) => { const o = mv(b('attn_v'), C.Hkv * C.hd, C.E, x); return Array.from({ length: C.Hkv }, (_, hh) => o.slice(hh * C.hd, (hh + 1) * C.hd)); });
      a = n.map((x, p) => {
        const gate = mv(b('attn_gate'), C.H, C.E, x);
        const out = [];
        for (let hh = 0; hh < C.H; hh++) {
          const kh = Math.floor(hh / (C.H / C.Hkv)), js = [];
          for (let j = 0; j <= p; j++) if (kind !== 'swa' || p - j < C.window) js.push(j);
          const sc = js.map((j) => q[p][hh].reduce((s, qi, i) => s + qi * k[j][kh][i], 0) / Math.sqrt(C.hd));
          const m = Math.max(...sc), e = sc.map((s) => Math.exp(s - m)), z = e.reduce((x1, y) => x1 + y, 0);
          for (let i = 0; i < C.hd; i++) out.push(js.reduce((s, j, jj) => s + (e[jj] / z) * v[j][kh][i], 0) / (1 + Math.exp(-gate[hh])));
        }
        return mv(b('attn_output'), C.E, C.H * C.hd, out);
      });
    }
    h = h.map((x, t) => { const pa = norm(a[t], b('post_attention_norm')); return x.map((xv, i) => xv + pa[i]); });
    h = h.map((x) => {
      const f = norm(x, b('ffn_norm')), g = mv(b('ffn_gate'), C.ff, C.E, f), u = mv(b('ffn_up'), C.ff, C.E, f);
      const d = norm(mv(b('ffn_down'), C.E, C.ff, g.map((gv, i) => (gv / (1 + Math.exp(-gv))) * u[i])), b('post_ffw_norm'));
      return x.map((xv, i) => xv + d[i]);
    });
    if (T !== h.length) throw new Error('length');
  });
  return h.map((x) => mv(W('token_embd.weight'), C.V, C.E, norm(x, W('output_norm.weight'))));
};

const PROMPT = [3, 17, 5, 5, 39, 0, 22, 8, 11];
let loaded;
const load = async () => (loaded ||= await R.load(await G.open(gguf())));

test('config from the metadata, and the layers in order', async () => {
  const { config: c } = await load();
  assert.deepEqual(c.layers, ['conv', 'full', 'conv', 'swa']);
  assert.deepEqual([c.nEmbd, c.nHead, c.headDim, c.nFf, c.vocab, c.window, c.lCache, c.nRot, c.nRotSwa], [16, 4, 8, 24, 40, 3, 3, 8, 8]);
  assert.deepEqual([c.ropeBase, c.ropeBaseSwa, c.eps], [1e6, 1e4, Math.fround(1e-5)]);
  assert.deepEqual(c.nHeadKv, [0, 2, 0, 2]);
});

test('logits at every position match the graph computed plainly, past the sliding window', async () => {
  const m = await load();
  const want = plain(PROMPT);
  const got = R.session(m).forward(PROMPT, { logits: 'all' });
  let max = 0;
  for (let t = 0; t < PROMPT.length; t++) for (let i = 0; i < C.V; i++) max = Math.max(max, Math.abs(got[t * C.V + i] - want[t][i]));
  assert.ok(max < 2e-5, `max |Δ| ${max}`);
  // The window matters here: with every key visible to the sliding layer the plain graph moves.
  const wide = C.window; C.window = 99;
  const unmasked = plain(PROMPT); C.window = wide;
  const last = PROMPT.length - 1;
  assert.ok(unmasked[last].some((v, i) => Math.abs(v - want[last][i]) > 1e-3), 'the window changes the last logits');
});

test('one batch, chunks and single tokens give the same logits, and the last row by default', async () => {
  const m = await load();
  const all = R.session(m).forward(PROMPT, { logits: 'all' });
  const s = R.session(m);
  const chunks = [...s.forward(PROMPT.slice(0, 4), { logits: 'all' }), ...s.forward(PROMPT.slice(4, 5), { logits: 'all' }), ...s.forward(PROMPT.slice(5), { logits: 'all' })];
  assert.equal(s.pos, PROMPT.length);
  const one = R.session(m), each = [];
  for (const id of PROMPT) each.push(...one.forward([id]));
  for (const [label, x] of [['chunks', chunks], ['one at a time', each]]) {
    let max = 0;
    for (let i = 0; i < all.length; i++) max = Math.max(max, Math.abs(all[i] - x[i]));
    assert.ok(max < 1e-5, `${label}: max |Δ| ${max}`);
  }
  assert.deepEqual([...R.session(m).forward(PROMPT)], [...all.subarray(all.length - C.V)]);
  assert.throws(() => R.session(m).forward([]), /no tokens/);
  assert.throws(() => R.session(m).forward([C.V]), /token 40/);
});

test('greedy, top and top-k sampling', () => {
  const lg = Float32Array.of(0.5, 2, -1, 2, 1.5);
  assert.equal(R.greedy(lg), 1);
  assert.deepEqual(R.top(lg, 3), [{ id: 1, logit: 2 }, { id: 3, logit: 2 }, { id: 4, logit: 1.5 }]);
  assert.equal(R.topK(lg, 3, { temperature: 0 }), 1);
  assert.equal(R.topK(lg, 3, { random: () => 0 }), 1);
  assert.equal(R.topK(lg, 3, { random: () => 0.999999 }), 4);
  // p ∝ e^0, e^0, e^-0.5 at temperature 1: the middle of the draw falls on id 3.
  const z = 2 + Math.exp(-0.5);
  assert.equal(R.topK(lg, 3, { random: () => 1.5 / z }), 3);
  assert.equal(R.topK(lg, 1, { random: () => 0.7 }), 1);
  assert.throws(() => R.topK(lg, 0), /k/);
});

test('a model that is not lfm3 is refused', async () => {
  const g = await G.open(gguf());
  g.kv['general.architecture'] = 'llama';
  assert.throws(() => R.config(g), /only lfm3/);
});
