// A minimal valid lfm3 and a command-recording WebGPU double for the engine's host-side contracts.
// kinds: each layer's 'conv', 'full' or 'swa' (default one conv layer).
function model({ vocab = 8, embeddingType = 'Q6_K', kinds = ['conv'], window = 5 } = {}) {
  const E = 256, F = 256, H = 2, D = 128, tensors = new Map();
  const add = (name, dims, type = 'F32') => {
    const count = dims.reduce((a, b) => a * b, 1);
    const [block, size] = { F32: [1, 4], Q6_K: [256, 210], Q8_0: [32, 34] }[type];
    tensors.set(name, { name, dims, count, type, bytes: count / block * size });
  };
  add('token_embd.weight', [E, vocab], embeddingType);
  add('output_norm.weight', [E]);
  kinds.forEach((kind, i) => {
    const b = (n) => `blk.${i}.${n}.weight`;
    for (const n of ['attn_norm', 'ffn_norm']) add(b(n), [E]);
    for (const n of ['ffn_gate', 'ffn_up', 'ffn_down']) add(b(n), [E, F], 'Q8_0');
    if (kind === 'conv') {
      add(b('shortconv.out_proj'), [E, E], 'Q8_0');
      add(b('shortconv.in_proj'), [E, 3 * E], 'Q8_0');
      add(b('shortconv.conv'), [3, E]);
    } else {
      add(b('attn_q'), [E, H * D], 'Q8_0'); add(b('attn_k'), [E, D], 'Q8_0'); add(b('attn_v'), [E, D], 'Q8_0');
      add(b('attn_output'), [H * D, E], 'Q8_0'); add(b('attn_gate'), [E, H], 'Q8_0');
      add(b('attn_q_norm'), [D]); add(b('attn_k_norm'), [D]);
    }
  });
  const kv = Object.fromEntries(Object.entries({
    block_count: kinds.length, embedding_length: E, feed_forward_length: F,
    'attention.head_count': H, 'attention.head_count_kv': kinds.map((k) => (k === 'conv' ? 0 : 1)), 'attention.key_length': D,
    'attention.sliding_window_pattern': kinds.map((k) => k === 'swa'), 'attention.sliding_window': window,
    'attention.layer_norm_rms_epsilon': 1e-5, 'rope.freq_base_swa': 10000, 'shortconv.l_cache': 3,
  }).map(([k, v]) => [`lfm3.${k}`, v]));
  kv['general.architecture'] = 'lfm3';
  return { kv, tensor: (n) => tensors.get(n), read: async (t, o = 0, n = t.bytes - o) => new Uint8Array(n) };
}

function host() {
  const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
  const buffers = [], writes = [], submissions = [], dispatches = [];
  class Buffer {
    constructor({ size, usage }) { this.size = size; this.usage = usage; this.destroyed = false; buffers.push(this); }
    destroy() { this.destroyed = true; }
    async mapAsync() { if (this.destroyed) throw new Error('buffer destroyed'); }
    getMappedRange() { return this.data ? this.data.buffer.slice(0) : new ArrayBuffer(this.size); }
    unmap() {}
  }
  const features = new Set();
  const limits = { maxBufferSize: 2 ** 30, maxStorageBufferBindingSize: 128 * 2 ** 20, maxComputeWorkgroupStorageSize: 32768, maxStorageBuffersPerShaderStage: 10 };
  const device = {
    features, limits, lost: new Promise(() => {}),
    createBuffer: (d) => new Buffer(d),
    createShaderModule: (d) => d,
    createComputePipelineAsync: async (d) => ({ ...d, getBindGroupLayout: () => ({}) }),
    createBindGroup: (d) => d,
    createCommandEncoder: () => {
      const commands = [];
      return {
        beginComputePass: () => {
          let pipeline, group;
          return { setPipeline(p) { pipeline = p; }, setBindGroup(i, g) { group = g; },
            dispatchWorkgroups(...dims) {
              const d = { pipeline, group, dims };
              dispatches.push(d); commands.push(() => device.execute?.(d));
            }, end() {} };
        },
        copyBufferToBuffer(src, from, dst, to, size) {
          commands.push(() => {
            if (src.destroyed || dst.destroyed) throw new Error('buffer destroyed');
            dst.data ||= new Uint8Array(dst.size);
            dst.data.set(src.data ? src.data.subarray(from, from + size) : new Uint8Array(size), to);
          });
        },
        finish: () => commands,
      };
    },
    queue: {
      writeBuffer(buffer, offset, data, byteOffset = 0, size = data.byteLength) {
        if (buffer.destroyed) throw new Error('buffer destroyed');
        if (offset % 4 || size % 4) throw new Error(`unaligned writeBuffer: offset ${offset}, size ${size}`);
        if (offset + size > buffer.size) throw new Error('writeBuffer out of bounds');
        writes.push({ buffer, offset, size });
        if (buffer.size < 128 * 1024) {
          buffer.data ||= new Uint8Array(buffer.size);
          const view = ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : new Uint8Array(data);
          buffer.data.set(view.subarray(byteOffset, byteOffset + size), offset);
        }
      },
      submit(commands) {
        submissions.push(commands);
        for (const list of commands) for (const run of list) run();
      }, onSubmittedWorkDone: async () => {},
    },
  };
  const adapter = { limits, features, requestDevice: async () => device };
  const context = vm.createContext({
    require, navigator: { gpu: {} }, setTimeout, clearTimeout, URL, GZ_AI_REFERENCE: require('../../extension/ai/local/reference.js'),
    GPUBuffer: Buffer, GPUBufferUsage: { STORAGE: 1, COPY_SRC: 2, COPY_DST: 4, MAP_READ: 8, UNIFORM: 16 }, GPUMapMode: { READ: 1 },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../../extension/ai/local/engine.js'), 'utf8'), context);
  const kernels = (n) => fs.readFileSync(path.join(__dirname, `../../extension/ai/local/kernels/${n}.wgsl`), 'utf8');
  return {
    create: (g = model(), opts = {}) => context.GZ_AI_ENGINE.create(g, { adapter, kernels, ...opts }),
    load: (g = model(), opts = {}) => context.GZ_AI_ENGINE.load(g, { adapter, kernels, ...opts }),
    engine: context.GZ_AI_ENGINE, context, device, buffers, writes, submissions, dispatches,
  };
}

module.exports = { model, host };
