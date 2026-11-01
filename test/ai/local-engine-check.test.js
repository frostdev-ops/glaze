const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { pageLib } = require('../../checks/ai/local-engine-check.js');

function page() {
  const adapter = { info: {}, features: new Set(), limits: {} };
  const context = vm.createContext({
    window: {}, console: { log() {} }, URL, location: { href: 'http://127.0.0.1/' },
    fetch: async () => ({ ok: true, headers: new Map([['content-length', '0']]) }),
    navigator: { gpu: { requestAdapter: async () => adapter } },
    GZ_AI_GGUF: { open: async () => ({}) }, GZ_AI_QUANT: {}, GZ_AI_REFERENCE: {},
    GZ_AI_ENGINE: { create: async () => ({ config: { vocab: 1 }, _k: { tpr: 32 }, layout: { buffers: [] }, destroy() {} }) },
  });
  vm.runInContext(`(${pageLib.toString()})()`, context);
  return context.window.CK;
}

test('whole-model validation cannot pass without reference prompts', async () => {
  for (const precision of ['f32', 'f16']) await assert.rejects(page().model({ ids: [], precision }), /reference|prompt/);
});

// The `small` mode's tiny random model runs the f16 path wherever the adapter has shader-f16 (Apple's Metal): every value
// that enters an f16 GEMM tile or the f16 key/value caches must stay inside f16's range (65,504), with room (the residual
// stream stays f32). Traced here through the reference's own ops, layer by layer, for the check's 20-token prompt.
test('the tiny model stays inside f16\'s range, so the small mode means something on an f16 GPU', async () => {
  const { tinyModel } = require('../../checks/ai/local-engine-check.js');
  const G = require('../../extension/ai/local/gguf.js'), R = require('../../extension/ai/local/reference.js'), O = R._ops;
  const m = await R.load(await G.open(tinyModel())), c = m.config, w = m.weights, E = c.nEmbd, hd = c.headDim;
  const prompt = Array.from({ length: 20 }, (_, i) => (i * 37 + 5) % c.vocab), T = prompt.length, pos = prompt.map((_, t) => t);
  let peak = 0, at = '';
  const see = (a, where) => { for (const v of a) if (Math.abs(v) > peak) { peak = Math.abs(v); at = where; } return a; };
  const x = new Float32Array(T * E), r = new Float32Array(E);
  prompt.forEach((id, t) => x.set(O.row(w.embd, id, r), t * E));
  const add = (a, post) => { const b = post ? O.rmsnorm(a, T, E, post, c.eps) : a; for (let i = 0; i < x.length; i++) x[i] += b[i]; };
  for (let i = 0; i < c.nLayer; i++) {
    const L = w.layers[i], n = see(O.rmsnorm(x, T, E, L.attnNorm, c.eps), `${i} norm`);
    if (L.kind === 'conv') {
      const { y } = O.shortconv(see(O.matmul(L.inProj, n, T), `${i} in_proj`), new Float32Array((c.lCache - 1) * E), L.conv, T, E, c.lCache - 1);
      add(O.matmul(L.outProj, see(y, `${i} conv`), T), L.postAttnNorm);
    } else {
      const H = c.nHead, Hkv = c.nHeadKv[i], swa = L.kind === 'swa';
      const q = O.rmsnorm(O.matmul(L.wq, n, T), T * H, hd, L.qNorm, c.eps), k = O.rmsnorm(O.matmul(L.wk, n, T), T * Hkv, hd, L.kNorm, c.eps);
      const v = see(O.matmul(L.wv, n, T), `${i} v`);
      for (const [a, h] of [[q, H], [k, Hkv]]) O.rope(a, T, h, hd, pos, swa ? c.nRotSwa : c.nRot, swa ? c.ropeBaseSwa : c.ropeBase, swa ? null : w.ropeFreqs);
      see(k, `${i} k`);
      const out = O.attend(q, k, v, O.matmul(L.wGate, n, T), { T, pos: 0, H, Hkv, hd, window: swa ? c.window : 0 });
      add(O.matmul(L.wo, see(out, `${i} attention`), T), L.postAttnNorm);
    }
    const f = see(O.rmsnorm(x, T, E, L.ffnNorm, c.eps), `${i} ffn norm`), g = O.matmul(L.gate, f, T), u = O.matmul(L.up, f, T);
    for (let j = 0; j < g.length; j++) g[j] = O.silu(g[j]) * u[j];
    add(O.matmul(L.down, see(g, `${i} swiglu`), T), L.postFfnNorm);
  }
  assert.ok(peak < 2 ** 14, `|${peak.toExponential(3)}| at layer ${at}, over 2^14`);
});
