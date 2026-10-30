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
