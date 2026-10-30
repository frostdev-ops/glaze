// A small lfm3vl projector GGUF (zero weights) and a command-recording WebGPU double for the picture encoder's host-side
// contracts (ai/local/vision.js): its buffers, writes, dispatches, error scopes and the device's loss.
function projector({ E = 128, H = 2, Hkv = 1, F = 256, mid = 4 * E, out = 64, layers = ['conv', 'attn'], matrixType = 'F16', extra = {}, drop = [], kv: more = {} } = {}) {
  const tensors = new Map(), P = 16;
  const add = (name, dims, type = 'F32') => {
    const count = dims.reduce((a, b) => a * b, 1);
    tensors.set(name, { name, dims, count, type, bytes: count * { F32: 4, F16: 2, Q8_0: 34 / 32 }[type] });
  };
  const m = (name, cols, rows) => add(name, [cols, rows], matrixType);
  add('v.patch_embd.weight', [P, P, 3, E], matrixType); add('v.patch_embd.weight.1', [P, P, 3, E], matrixType);
  add('v.embedding_norm.weight', [E]);
  layers.forEach((kind, i) => {
    const b = (n) => `v.blk.${i}.${n}.weight`;
    add(b('ln1'), [E]); add(b('ln2'), [E]);
    m(b('ffn_gate'), E, F); m(b('ffn_up'), E, F); m(b('ffn_down'), F, E);
    if (kind === 'conv') { m(b('conv2d_in_proj'), E, 3 * E); m(b('conv2d_out_proj'), E, E); add(b('conv2d_spatial'), [3, 3, 1, E]); }
    else { m(b('attn_q'), E, H * 64); m(b('attn_k'), E, Hkv * 64); m(b('attn_v'), E, Hkv * 64); m(b('attn_out'), H * 64, E); add(b('attn_q_norm'), [64]); add(b('attn_k_norm'), [64]); }
  });
  add('mm.input_norm.weight', [E]); add('mm.input_norm.bias', [E]);
  m('mm.0.weight', 4 * E, mid); add('mm.0.bias', [mid]); m('mm.2.weight', mid, out); add('mm.2.bias', [out]);
  for (const [name, t] of Object.entries(extra)) add(name, t.dims, t.type);
  for (const name of drop) tensors.delete(name);
  const kv = {
    'general.architecture': 'clip', 'clip.vision.projector_type': 'lfm3vl', 'clip.vision.patch_size': P, 'clip.vision.spatial_merge_size': 2,
    'clip.vision.embedding_length': E, 'clip.vision.feed_forward_length': F, 'clip.vision.block_count': layers.length,
    'clip.vision.attention.head_count': H, 'clip.vision.attention.head_count_kv': Hkv, 'clip.vision.attention.layer_norm_epsilon': Math.fround(1e-5),
    'clip.vision.image_mean': Float32Array.of(0.5, 0.5, 0.5), 'clip.vision.image_std': Float32Array.of(0.5, 0.5, 0.5),
    'clip.vision.image_min_pixels': 4 * 1024, 'clip.vision.image_max_pixels': 1024 * 1024, 'clip.vision.image_resize_algo': 'bicubic', ...more,
  };
  const reads = [];
  return { kv, tensor: (n) => tensors.get(n), reads, read: async (t, o = 0, n = t.bytes - o) => { reads.push(t.name); return new Uint8Array(n); } };
}

// opts: limits (merged over the defaults), features, oom (a function of the scope's buffers → true for out of memory),
// onWork (called at each onSubmittedWorkDone, awaited).
function host({ limits: L = {}, features = [], oom = null, onWork = null } = {}) {
  const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
  const buffers = [], writes = [], submissions = [], dispatches = [], scopes = [];
  let loseDevice;
  class Buffer {
    constructor({ size, usage }) { this.size = size; this.usage = usage; this.destroyed = false; buffers.push(this); scopes[scopes.length - 1]?.made.push(this); }
    destroy() { this.destroyed = true; }
  }
  const limits = { maxBufferSize: 2 ** 30, maxStorageBufferBindingSize: 128 * 2 ** 20, maxComputeWorkgroupStorageSize: 16384, minStorageBufferOffsetAlignment: 256, ...L };
  const device = {
    features: new Set(features), limits, lost: new Promise((r) => { loseDevice = r; }), destroyed: false,
    destroy() { this.destroyed = true; },
    pushErrorScope: (kind) => scopes.push({ kind, made: [] }),
    popErrorScope: async () => { const s = scopes.pop(); return s.kind === 'out-of-memory' && oom?.(s.made) ? { message: 'out of memory' } : null; },
    createBuffer: (d) => new Buffer(d),
    createShaderModule: (d) => d,
    createComputePipelineAsync: async (d) => ({ ...d, getBindGroupLayout: () => ({}) }),
    createBindGroup: (d) => {
      for (const e of d.entries) {
        const r = e.resource, size = r.size ?? r.buffer.size - (r.offset || 0);
        if (r.buffer.destroyed) throw new Error('binding a destroyed buffer');
        if ((r.offset || 0) % 256 || (r.offset || 0) + size > r.buffer.size) throw new Error(`binding ${e.binding}: offset ${r.offset}, size ${size} of ${r.buffer.size}`);
      }
      return d;
    },
    createCommandEncoder: () => ({
      beginComputePass: () => {
        let pipeline, group;
        return { setPipeline(p) { pipeline = p; }, setBindGroup(i, g) { group = g; }, dispatchWorkgroups(...dims) { dispatches.push({ pipeline, group, dims }); }, end() {} };
      },
      finish: () => ({}),
    }),
    queue: {
      writeBuffer(buffer, offset, data, byteOffset = 0, size) {
        if (buffer.destroyed) throw new Error('buffer destroyed');
        const bytes = size ?? (ArrayBuffer.isView(data) ? data.byteLength : data.byteLength - byteOffset);
        if (offset % 4 || bytes % 4) throw new Error(`unaligned writeBuffer: offset ${offset}, size ${bytes}`);
        if (offset + bytes > buffer.size) throw new Error('writeBuffer out of bounds');
        writes.push({ buffer, offset, size: bytes });
      },
      submit: (commands) => submissions.push(commands),
      onSubmittedWorkDone: async () => { await onWork?.(submissions.length); },
    },
  };
  const adapter = { limits, features: device.features, requestDevice: async () => device };
  const context = vm.createContext({
    require, navigator: { gpu: { requestAdapter: async () => adapter } }, DOMException,
    GPUBufferUsage: { STORAGE: 1, COPY_SRC: 2, COPY_DST: 4, MAP_READ: 8, UNIFORM: 16 },
  });
  for (const f of ['vision-reference.js', 'engine.js', 'vision.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../../extension/ai/local', f), 'utf8'), context);
  const kernels = (n) => fs.readFileSync(path.join(__dirname, `../../extension/ai/local/kernels/vision-${n}.wgsl`), 'utf8');
  return {
    V: context.GZ_AI_VISION, context, device, adapter, buffers, writes, submissions, dispatches,
    load: (g = projector(), opts = {}) => context.GZ_AI_VISION.load(g, { device, kernels, ...opts }),
    lose: (message = 'gone') => loseDevice({ reason: 'unknown', message }),
    live: () => buffers.filter((b) => !b.destroyed),
  };
}

// A picture's RGBA bytes.
const picture = (width, height) => ({ width, height, data: Uint8Array.from({ length: width * height * 4 }, (_, i) => (i * 37) & 255) });

module.exports = { projector, host, picture };
