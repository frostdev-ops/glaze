// The local model's hardware ladder (ai/local/ladder.js): which LFM3 quant a machine downloads and runs. The table
// below was written before the code; each input says where its number comes from.
const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../../extension/ai/local/ladder.js');
// The text tiers; the picture download's files (role) are never one.
const models = require('../../extension/ai/local/models.json').models.filter((m) => !m.role);

const GB = 1e9;
// The engine's decode speeds the model is fitted to (C3, glaze-plans/release-4.0.1, `local-engine-check.js speed`,
// decode 128 tokens with readback, median of 3): RTX 3080 Ti (f32, subgroups) Q4_K_M 133.2, Q8_0 100.0 tok/s; M5 Pro
// Chromium (f16, subgroups) Q4_K_M 103.3, Q8_0 78.9 tok/s.
// Bench results (`bench()` in a browser, ai/local/kernels/bench.wgsl), measured for C7 on 2026-10-30:
const BENCH = {
  // Mac: Playwright Chromium 153, new headless, under nice -n 19 taskpolicy -b; median of runs 2–4 of 5 (run 1 was cold:
  // 129 GB/s, 7.9 ms). Runs: 129.4, 130.9, 175.5, 183.7, 173.4 GB/s; 7.9, 1.5, 1.2, 1.3, 1.0 ms.
  m5pro: { bandwidth: 175.5e9, overheadMs: 1.2 },
  // omarchy: glaze-c3-gpu:1 container, --gpus all, Chromium over Vulkan (C3's flags); median of 5 runs, 390.0–417.3
  // GB/s, every run 2.5 ms.
  rtx3080ti: { bandwidth: 410.4e9, overheadMs: 2.5 },
};

const MACHINES = [
  {
    name: 'M5 Pro, Chrome',
    // C0 §1: Playwright Chromium 153 on the Mac, new headless; navigator.deviceMemory is capped at 8 by Chrome.
    input: {
      info: { vendor: 'apple', architecture: 'metal-3', device: '', description: '', isFallbackAdapter: false },
      features: ['shader-f16', 'subgroups', 'subgroup-size-control', 'timestamp-query', 'core-features-and-limits'],
      limits: { maxBufferSize: 4294967292, maxStorageBufferBindingSize: 4294967292 },
      deviceMemory: 16,
      // Chrome's quota is 60% of the disk (1 TB here); usage a fresh profile's.
      storageEstimate: { quota: 600 * GB, usage: 0.05 * GB },
      bench: () => BENCH.m5pro,
    },
    expect: { tier: 4, id: 'lfm3-1.7b-q8_0', reason: 'fastest' },
  },
  {
    name: 'M5 Pro, Firefox',
    // C0 §3: native Firefox 158.0.1, headed: no subgroups, 2 GiB limits, vendor and architecture empty. Firefox has no
    // navigator.deviceMemory. The bench is the Chromium measurement on the same Mac (the kernel uses no subgroups, so
    // the same work runs; Firefox's own number was not measured).
    input: {
      info: { vendor: '', architecture: '', device: '', description: '', isFallbackAdapter: false },
      features: ['shader-f16', 'timestamp-query', 'core-features-and-limits'],
      limits: { maxBufferSize: 2147483644, maxStorageBufferBindingSize: 2147483644 },
      deviceMemory: undefined,
      storageEstimate: { quota: 10 * GB, usage: 0.01 * GB }, // Firefox's group limit: 10 GB
      bench: () => BENCH.m5pro,
    },
    expect: { tier: 4, id: 'lfm3-1.7b-q8_0', reason: 'fastest' },
  },
  {
    name: 'RTX 3080 Ti, Chrome on Linux',
    // C3's adapter dump on omarchy (Chromium 153, Vulkan, NVIDIA 615.78): subgroups, no shader-f16, 4 GiB buffers,
    // 2 GiB bindings. 12 GB of VRAM, which no browser reports; deviceMemory read 32 in C7's run.
    input: {
      info: { vendor: 'nvidia', architecture: 'ampere', device: '', description: '', isFallbackAdapter: false },
      features: ['subgroups', 'subgroup-size-control', 'timestamp-query', 'core-features-and-limits'],
      limits: { maxBufferSize: 4294967292, maxStorageBufferBindingSize: 2147483644 },
      deviceMemory: 32,
      storageEstimate: { quota: 300 * GB, usage: 0.05 * GB },
      bench: () => BENCH.rtx3080ti,
    },
    expect: { tier: 4, id: 'lfm3-1.7b-q8_0', reason: 'fastest' },
  },
  {
    name: 'Intel Iris Xe iGPU, 8 GB RAM',
    // Typical, not measured here: Chrome on Windows (D3D12) reports Intel Xe as vendor intel / architecture gen-12lp
    // with shader-f16 and subgroups, maxBufferSize 2 GiB and bindings 2 GiB − 4. Memory: LPDDR4x-4266 on a 128-bit
    // bus, 68 GB/s peak, shared with the CPU. Bench: that peak times the share of peak the bench reached on the two
    // measured machines; per-token overhead: a guess, twice the M5 Pro's. Written before the measurement as Q6_K; the
    // calibrated model puts Q8_0 at 16.9 tok/s here, so Q8_0.
    input: {
      info: { vendor: 'intel', architecture: 'gen-12lp', device: '', description: '', isFallbackAdapter: false },
      features: ['shader-f16', 'subgroups', 'timestamp-query', 'core-features-and-limits'],
      limits: { maxBufferSize: 2147483648, maxStorageBufferBindingSize: 2147483644 },
      deviceMemory: 8,
      storageEstimate: { quota: 150 * GB, usage: 0.05 * GB }, // 256 GB SSD, 60%
      bench: () => ({ bandwidth: 68 * GB * SHARE(), overheadMs: 2 * BENCH.m5pro.overheadMs }),
    },
    expect: { tier: 4, id: 'lfm3-1.7b-q8_0', reason: 'fastest' },
  },
  {
    name: 'Low-end Chromebook (no shader-f16)',
    // Typical, not measured here: Intel Celeron N4500 (Jasper Lake, UHD), 4 GB LPDDR4x-2933 on one 64-bit channel,
    // 23 GB/s peak; ChromeOS Chrome over Vulkan without shader-f16, 2 GiB limits. Bench: that peak times the measured
    // share of peak; per-token overhead: a guess, four times the M5 Pro's. 64 GB eMMC with 20 GB free.
    input: {
      info: { vendor: 'intel', architecture: 'gen-11', device: '', description: '', isFallbackAdapter: false },
      features: ['subgroups', 'timestamp-query', 'core-features-and-limits'],
      limits: { maxBufferSize: 2147483648, maxStorageBufferBindingSize: 2147483644 },
      deviceMemory: 4,
      storageEstimate: { quota: 12 * GB, usage: 0.05 * GB }, // 60% of 20 GB free
      bench: () => ({ bandwidth: 23 * GB * SHARE(), overheadMs: 4 * BENCH.m5pro.overheadMs }),
    },
    // Every size is under 15 tok/s, none is refused: the smallest, flagged slow.
    expect: { tier: 1, id: 'lfm3-1.7b-q4_k_m', reason: 'slow' },
  },
  {
    name: 'SwiftShader fallback (refused)',
    // C0 §2: the runner's Chromium with --use-webgpu-adapter=swiftshader: isFallbackAdapter, no shader-f16, 1 GiB limits.
    input: {
      info: { vendor: 'google', architecture: 'swiftshader', device: '', description: 'SwiftShader Device (Subzero)', isFallbackAdapter: true },
      features: ['subgroups', 'timestamp-query', 'core-features-and-limits'],
      limits: { maxBufferSize: 1073741824, maxStorageBufferBindingSize: 1073741824 },
      deviceMemory: 8,
      storageEstimate: { quota: 300 * GB, usage: 0 },
      bench: () => null,
    },
    expect: { tier: null, reason: 'fallback' },
  },
];

// The bench's share of peak memory bandwidth on the measured machines, for the machines without a measurement:
// M5 Pro 307 GB/s and RTX 3080 Ti 912 GB/s peak (the vendors' figures).
const SHARE = () => (BENCH.m5pro.bandwidth / (307 * GB) + BENCH.rtx3080ti.bandwidth / (912 * GB)) / 2;

const run = ({ bench, ...input }, extra = {}) => L.pick({ ...input, bench: bench(), models, ...extra });

for (const m of MACHINES) {
  test(`picks for ${m.name}`, () => {
    const got = run(m.input);
    assert.deepEqual({ tier: got.tier, id: got.id, reason: got.reason }, m.expect.tier === null ? { tier: null, id: undefined, reason: m.expect.reason } : m.expect);
  });
}

const M5 = MACHINES[0].input;

test('a fallback adapter is refused by name too, and no adapter at all', () => {
  const info = { vendor: 'google', architecture: 'swiftshader', isFallbackAdapter: false };
  assert.equal(run({ ...M5, info }).reason, 'fallback');
  assert.equal(run({ ...M5, adapter: { isFallbackAdapter: true }, info: { vendor: 'apple' } }).reason, 'fallback');
  assert.deepEqual(run({ ...M5, info: null, features: [], limits: null }), { tier: null, reason: 'no-webgpu', quants: [] });
});

test('limits below the buffer the engine binds whole are refused', () => {
  const need = L.need();
  assert.equal(need, 128 * 128000 * 4); // a prefill chunk's logits
  for (const limits of [
    { maxBufferSize: need - 4, maxStorageBufferBindingSize: need - 4 },
    { maxBufferSize: 4294967292, maxStorageBufferBindingSize: need - 4 },
    { maxBufferSize: need - 4, maxStorageBufferBindingSize: 4294967292 },
  ]) assert.equal(run({ ...M5, limits }).reason, 'limits');
  // WebGPU's guaranteed minimums (256 MiB buffers, 128 MiB bindings) are enough: weights split into rows.
  assert.equal(run({ ...M5, limits: { maxBufferSize: 268435456, maxStorageBufferBindingSize: 134217728 } }).tier, 4);
});

test('without shader-f16 the f32 path runs when it fits memory, and is refused when it does not', () => {
  const noF16 = { ...M5, features: ['subgroups'] };
  assert.equal(run({ ...noF16, deviceMemory: 4 }).tier, 4);
  // f32 doubles the key/value cache: with memory between Q4_K_M's two footprints, f16 runs it and f32 doesn't.
  const q4 = models.find((x) => x.tier === 1);
  const [half, full] = [L.footprint(q4, { f16: true }), L.footprint(q4, { f16: false })];
  assert.ok(full > half);
  const between = { deviceMemory: (2 * (half + full) / 2) / 2 ** 30 }; // the budget is half of deviceMemory
  assert.equal(run({ ...M5, ...between }).tier, 1);
  assert.equal(run({ ...noF16, ...between }).reason, 'no-f16');
  // 2 GB of RAM: half of it holds no size even with f16.
  assert.equal(run({ ...M5, deviceMemory: 2 }).reason, 'memory');
  assert.equal(run({ ...noF16, deviceMemory: 2 }).reason, 'memory');
});

test('storage must hold the size plus 20%, unless it is already stored', () => {
  const free = (bytes) => ({ quota: bytes, usage: 0 });
  const size = (t) => models.find((x) => x.tier === t).size;
  assert.equal(run({ ...M5, storageEstimate: free(size(4) * 1.2) }).tier, 4);
  assert.equal(run({ ...M5, storageEstimate: free(size(4) * 1.2 - 1) }).tier, 3);
  assert.equal(run({ ...M5, storageEstimate: free(size(1) * 1.2 - 1) }).reason, 'storage');
  assert.equal(run({ ...M5, storageEstimate: free(0), stored: ['lfm3-1.7b-q6_k'] }).tier, 3);
  // No estimate (an API the browser lacks): storage does not refuse.
  assert.equal(run({ ...M5, storageEstimate: undefined }).tier, 4);
});

test('the highest tier at 15 tok/s or more; speed falls with size', () => {
  const b = BENCH.m5pro;
  const speeds = models.map((x) => L.decodeSpeed(x, b));
  for (let i = 1; i < speeds.length; i++) assert.ok(speeds[i] < speeds[i - 1]);
  // A bench just fast enough for Q5_K_M and not for Q6_K (with no overhead, speed is proportional to bandwidth).
  const q5 = models.find((x) => x.tier === 2), q6 = models.find((x) => x.tier === 3);
  const bw = 15e9 / L.decodeSpeed(q5, { bandwidth: 1e9, overheadMs: 0 });
  assert.ok(L.decodeSpeed(q5, { bandwidth: bw, overheadMs: 0 }) >= 15 - 1e-9);
  assert.equal(run({ ...M5, bench: () => ({ bandwidth: bw * 1.001, overheadMs: 0 }) }).tier, 2);
  assert.ok(L.decodeSpeed(q6, { bandwidth: bw * 1.001, overheadMs: 0 }) < 15);
  // No bench (it failed): the smallest that isn't refused, so the student still gets a model.
  assert.deepEqual(pickOf(run({ ...M5, bench: () => null })), { tier: 1, reason: 'unmeasured' });
});

test('non-finite benchmark measurements cannot select a larger model', () => {
  for (const bench of [
    { bandwidth: Infinity, overheadMs: 0 },
    { bandwidth: BENCH.m5pro.bandwidth, overheadMs: Infinity },
  ]) {
    assert.equal(L.decodeSpeed(models[0], bench), 0);
    assert.equal(run({ ...M5, bench: () => bench }).reason, 'unmeasured');
  }
});

const pickOf = (r) => ({ tier: r.tier, reason: r.reason });

test('a student may choose another size, never a refused one', () => {
  assert.deepEqual(pickOf(run(M5, { choice: 'lfm3-1.7b-q5_k_m' })), { tier: 2, reason: 'chosen' });
  // Chromebook: slow but allowed, so a larger size can be chosen.
  assert.deepEqual(pickOf(run(MACHINES[4].input, { choice: 'lfm3-1.7b-q8_0' })), { tier: 4, reason: 'chosen' });
  // Storage refuses Q8_0 here: the automatic pick stands and says why the choice did not.
  const tight = { ...M5, storageEstimate: { quota: models.find((x) => x.tier === 3).size * 1.2, usage: 0 } };
  const r = run(tight, { choice: 'lfm3-1.7b-q8_0' });
  assert.deepEqual({ tier: r.tier, reason: r.reason, refused: r.refused }, { tier: 3, reason: 'fastest', refused: 'storage' });
  // A refused machine stays refused whatever the choice.
  assert.equal(run(MACHINES[5].input, { choice: 'lfm3-1.7b-q4_k_m' }).tier, null);
  // An unknown id is no choice.
  assert.equal(run(M5, { choice: 'nope' }).reason, 'fastest');
});

test('every size is listed with its verdict, for the advanced picker', () => {
  const r = run(MACHINES[4].input);
  assert.deepEqual(r.quants.map((q) => q.tier), [1, 2, 3, 4]);
  for (const q of r.quants) assert.equal(q.refused, undefined);
  assert.ok(r.quants.every((q) => q.tps > 0 && q.tps < 15));
  const s = run(MACHINES[5].input);
  assert.deepEqual(s.quants, []);
});
