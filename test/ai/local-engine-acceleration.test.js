const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../../extension/ai/local/engine.js');
const { host } = require('../fixtures/local-engine.js');

test('acceleration requires finite nonzero reference, tight error and reproducible speed', () => {
  const ref = Float32Array.of(1, -2, 0.5, 3);
  const fast = [1, 1.01, 1.02], base = [2, 2.01, 2.02];
  assert.equal(E.accelerationCheck(ref, ref, base, fast).ok, true);
  for (const value of [NaN, Infinity, -Infinity, 1.1]) {
    const bad = ref.slice(); bad[0] = value;
    assert.equal(E.accelerationCheck(ref, bad, base, fast).ok, false);
  }
  assert.equal(E.accelerationCheck(ref, ref, base, [1.9, 1.9, 1.9]).ok, false);
  assert.equal(E.accelerationCheck(ref, ref, [0, 0, 0], fast).ok, false);
  assert.equal(E.accelerationCheck(new Float32Array(4), new Float32Array(4), base, fast).ok, false);
  assert.equal(E.accelerationCheck(ref, ref.subarray(1), base, fast).ok, false);
});

test('adapters without optional acceleration preserve normal paths', async () => {
  const h = host(), e = await h.create();
  try {
    assert.equal(e.features.acceleration.dp4a.enabled, false);
    assert.equal(e.features.acceleration.tensor.enabled, false);
    const s = await e.session({ ctx: 16, chunk: 2 });
    await s.forward([1, 2], { logits: 'keep' });
    s.destroy();
    assert.ok(h.dispatches.every((d) => !d.pipeline.compute.module.code.includes('dot4I8Packed')));
  } finally { e.destroy(); }
  assert.ok(h.buffers.every((b) => b.destroyed));
});
