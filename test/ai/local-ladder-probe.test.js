const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../../extension/ai/local/ladder.js');
const fs = require('node:fs');
const vm = require('node:vm');

// Isolate the browser's WebGPU constants from other Node tests.
const context = vm.createContext({
  GPUBufferUsage: { MAP_READ: 1, COPY_SRC: 4, COPY_DST: 8, UNIFORM: 64, STORAGE: 128 },
  GPUMapMode: { READ: 1 },
});
const browser = vm.runInContext(fs.readFileSync(require.resolve('../../extension/ai/local/ladder.js'), 'utf8'), context);

const limits = { maxBufferSize: 268435456, maxStorageBufferBindingSize: 134217728 };
const adapterWith = (requestDevice) => ({
  info: { vendor: 'intel' },
  features: new Set(['shader-f16']),
  limits,
  requestDevice,
});

const deviceWith = ({ error, pipelineError } = {}) => {
  const scopes = [], buffers = [];
  const device = {
    limits,
    scopes,
    buffers,
    destroyed: false,
    pushErrorScope(filter) { scopes.push({ filter, error: null }); },
    async popErrorScope() { return scopes.pop().error; },
    createShaderModule() { return {}; },
    async createComputePipelineAsync() {
      if (pipelineError) throw new Error(pipelineError);
      return { getBindGroupLayout() { return {}; } };
    },
    createBuffer({ size }) {
      if (error && size === limits.maxStorageBufferBindingSize) {
        // WebGPU reports allocation/validation errors through scopes, not JS throws.
        const scope = scopes.findLast((s) => s.filter === error.filter);
        if (scope) scope.error = { message: error.message };
      }
      const b = { destroyed: false, async mapAsync() {}, unmap() {}, destroy() { this.destroyed = true; } };
      buffers.push(b);
      return b;
    },
    createBindGroup() { return {}; },
    createCommandEncoder() {
      return {
        beginComputePass() { return { setPipeline() {}, setBindGroup() {}, dispatchWorkgroups() {}, end() {} }; },
        copyBufferToBuffer() {},
        finish() { return {}; },
      };
    },
    queue: { writeBuffer() {}, submit() {}, async onSubmittedWorkDone() {} },
    destroy() { this.destroyed = true; },
  };
  return device;
};
const benchOptions = () => {
  let time = 0;
  return { source: 'synthetic shader', ms: 0, now: () => ++time };
};

test('probe preserves the unmeasured fallback when requesting a device fails', async () => {
  const adapter = adapterWith(async () => { throw new Error('GPU device unavailable'); });
  const out = await L.probe({
    gpu: { requestAdapter: async () => adapter },
    navigator: { deviceMemory: 8, storage: { estimate: async () => ({ quota: 10e9, usage: 0 }) } },
  });
  assert.equal(out.info.vendor, 'intel');
  assert.equal(out.bench, null);
  assert.match(out.benchError, /GPU device unavailable/);
  assert.equal(L.pick(out).reason, 'unmeasured');
  assert.equal(L.pick(out).tier, 1);
});

for (const filter of ['validation', 'out-of-memory', 'internal']) {
  test(`probe discards a benchmark with an asynchronous GPU ${filter} error`, async () => {
    const device = deviceWith({ error: { filter, message: `GPU ${filter} failure` } });
    const out = await browser.probe({
      ...benchOptions(),
      gpu: { requestAdapter: async () => adapterWith(async () => device) },
      navigator: { deviceMemory: 8 },
    });
    assert.equal(out.bench, null);
    assert.match(out.benchError, new RegExp(`GPU ${filter} failure`));
    assert.equal(L.pick(out).reason, 'unmeasured');
    assert.equal(device.destroyed, true);
    assert.ok(device.buffers.length > 0 && device.buffers.every((b) => b.destroyed));
    assert.equal(device.scopes.length, 0);
  });
}

test('benchmark releases GPU error scopes after pipeline compilation rejects', async () => {
  const device = deviceWith({ pipelineError: 'shader compilation failed' });
  await assert.rejects(browser.bench(device, benchOptions()), /shader compilation failed/);
  assert.equal(device.scopes.length, 0);
});

test('benchmark returns finite measurements and releases its buffers after success', async () => {
  const device = deviceWith();
  const result = await browser.bench(device, benchOptions());
  assert.ok(Number.isFinite(result.bandwidth) && result.bandwidth > 0);
  assert.ok(Number.isFinite(result.overheadMs) && result.overheadMs >= 0);
  assert.ok(device.buffers.every((b) => b.destroyed));
  assert.equal(device.scopes.length, 0);
});

test('a clock too coarse to measure the workload produces an unmeasured fallback', async () => {
  const device = deviceWith();
  let time = 0;
  const out = await browser.probe({
    source: 'synthetic shader', ms: 0, now: () => Math.floor(++time / 100) * 100,
    gpu: { requestAdapter: async () => adapterWith(async () => device) },
    navigator: { deviceMemory: 8 },
  });
  assert.equal(out.bench, null);
  assert.match(out.benchError, /tim|clock/i);
  assert.equal(L.pick(out).reason, 'unmeasured');
  assert.equal(L.pick(out).tier, 1);
  assert.ok(device.buffers.every((b) => b.destroyed));
  assert.equal(device.destroyed, true);
});
