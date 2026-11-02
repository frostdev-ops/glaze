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

test('an optional integer kernel compile failure falls back and releases scratch buffers', async () => {
  const h = host();
  h.context.navigator.gpu.wgslLanguageFeatures = new Set(['packed_4x8_integer_dot_product']);
  const compile = h.device.createComputePipelineAsync;
  h.device.createComputePipelineAsync = async (d) => {
    if (d.compute.module.code.includes('dot4I8Packed')) throw new Error('optional integer kernel refused');
    return compile(d);
  };
  const e = await h.create();
  try {
    assert.equal(e.features.acceleration.dp4a.enabled, false);
    assert.match(e.features.acceleration.dp4a.types.Q8_0.reason, /optional integer kernel refused/);
    const s = await e.session({ ctx: 8, chunk: 2 });
    await s.forward([1, 2], { logits: 'keep' });
    s.destroy();
  } finally { e.destroy(); }
  assert.ok(h.buffers.every((b) => b.destroyed));
});

test('a device request refusing the experimental tensor feature retries portable features', async () => {
  const h = host(), requests = [];
  const adapter = {
    limits: h.device.limits,
    features: new Set(['subgroups', 'chromium-experimental-subgroup-matrix']),
    info: { subgroupMinSize: 32, subgroupMaxSize: 32, subgroupMatrixConfigs: [{ componentType: 'i8', resultComponentType: 'i32', M: 16, N: 16, K: 32 }] },
    requestDevice: async (desc) => {
      requests.push(desc.requiredFeatures);
      if (desc.requiredFeatures.includes('chromium-experimental-subgroup-matrix')) throw new Error('experimental feature refused');
      return h.device;
    },
  };
  const e = await h.create(undefined, { adapter });
  try {
    assert.equal(requests.length, 2);
    assert.equal(requests[1].includes('chromium-experimental-subgroup-matrix'), false);
    assert.equal(e.features.acceleration.tensor.enabled, false);
  } finally { e.destroy(); }
  assert.ok(h.buffers.every((b) => b.destroyed));
});

test('cancellation during optional compilation releases weights on a caller-owned device', async () => {
  const h = host(), c = new AbortController(), why = new Error('cancel selfcheck');
  h.context.navigator.gpu.wgslLanguageFeatures = new Set(['packed_4x8_integer_dot_product']);
  const compile = h.device.createComputePipelineAsync;
  h.device.createComputePipelineAsync = async (d) => { c.abort(why); return compile(d); };
  await assert.rejects(h.create(undefined, { device: h.device, signal: c.signal }), (e) => e === why);
  assert.ok(h.buffers.every((b) => b.destroyed));
});

test('optional kernel variants preprocess without unresolved directives', () => {
  const fs = require('node:fs'), path = require('node:path');
  for (const name of ['quantx', 'iquant', 'imatmul', 'tensormul']) {
    const source = fs.readFileSync(path.join(__dirname, `../../extension/ai/local/kernels/${name}.wgsl`), 'utf8');
    for (const type of Object.keys(E.QUANT)) {
      const code = E.preprocess(source, { [type]: true });
      assert.doesNotMatch(code, /\/\/#(?:if|else|endif)/);
      if (name === 'imatmul') assert.match(code, /dot4I8Packed/);
      if (name === 'tensormul') assert.match(code, /subgroupMatrixMultiply<i32>/);
    }
  }
});
