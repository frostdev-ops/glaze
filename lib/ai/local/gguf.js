// A GGUF reader for the local engine (GGUF v2 and v3, little-endian, as ggml's gguf.cpp writes them): the header, every
// metadata key and value, the tensor infos, the alignment and where each tensor's data starts. It reads by range from
// a Blob or File, an ArrayBuffer or typed array, or { size, read(offset, length) → Uint8Array or a promise of one } (an
// OPFS sync access handle or a Node file handle wrapped so), so a model never has to be in memory whole: the header is
// read in chunks and a tensor only when asked for. What ggml would refuse (a duplicate key or tensor, an unknown type,
// an unaligned offset, data past the end) is refused here too.
// Values: integers up to 32 bits and floats are numbers, 64-bit integers BigInt, bool true/false, strings strings;
// arrays of numbers are typed arrays (BigInt64Array for 64-bit), of bools and strings plain arrays. Classic script; node exports.
var GZ_AI_GGUF = globalThis.GZ_AI_GGUF || (() => {
  // ggml's types (ggml.h enum ggml_type): elements per block and bytes per block, from ggml_blck_size / ggml_type_size.
  const TYPES = {
    F32: [0, 1, 4], F16: [1, 1, 2], Q4_0: [2, 32, 18], Q4_1: [3, 32, 20], Q5_0: [6, 32, 22], Q5_1: [7, 32, 24],
    Q8_0: [8, 32, 34], Q8_1: [9, 32, 36], Q2_K: [10, 256, 84], Q3_K: [11, 256, 110], Q4_K: [12, 256, 144],
    Q5_K: [13, 256, 176], Q6_K: [14, 256, 210], Q8_K: [15, 256, 292], IQ2_XXS: [16, 256, 66], IQ2_XS: [17, 256, 74],
    IQ3_XXS: [18, 256, 98], IQ1_S: [19, 256, 50], IQ4_NL: [20, 32, 18], IQ3_S: [21, 256, 110], IQ2_S: [22, 256, 82],
    IQ4_XS: [23, 256, 136], I8: [24, 1, 1], I16: [25, 1, 2], I32: [26, 1, 4], I64: [27, 1, 8], F64: [28, 1, 8],
    IQ1_M: [29, 256, 56], BF16: [30, 1, 2], TQ1_0: [34, 256, 54], TQ2_0: [35, 256, 66], MXFP4: [39, 32, 17],
    NVFP4: [40, 64, 36], Q1_0: [41, 128, 18], Q2_0: [42, 64, 18],
  };
  const BY_ID = new Map(Object.entries(TYPES).map(([name, [id, block, bytes]]) => [id, { name, id, block, bytes }]));
  const type = (t) => (typeof t === 'number' ? BY_ID.get(t) : TYPES[t] && BY_ID.get(TYPES[t][0])) || null;

  // Metadata value types (gguf.h enum gguf_type).
  const KV = ['u8', 'i8', 'u16', 'i16', 'u32', 'i32', 'f32', 'bool', 'str', 'arr', 'u64', 'i64', 'f64'];
  const SIZE = { u8: 1, i8: 1, u16: 2, i16: 2, u32: 4, i32: 4, f32: 4, bool: 1, u64: 8, i64: 8, f64: 8 };
  const ARRAY = { u8: Uint8Array, i8: Int8Array, u16: Uint16Array, i16: Int16Array, u32: Uint32Array, i32: Int32Array, f32: Float32Array, u64: BigUint64Array, i64: BigInt64Array, f64: Float64Array };
  const MAX_DIMS = 4;
  const fail = (what) => { throw new TypeError(`gguf: ${what}`); };

  // Any source as { size, read(offset, length) → Promise<Uint8Array> }.
  const source = (src) => {
    if (src instanceof ArrayBuffer || ArrayBuffer.isView(src)) {
      const u8 = src instanceof ArrayBuffer ? new Uint8Array(src) : new Uint8Array(src.buffer, src.byteOffset, src.byteLength);
      return { size: u8.length, read: async (o, n) => u8.subarray(o, o + n) };
    }
    if (typeof Blob !== 'undefined' && src instanceof Blob) {
      return { size: src.size, read: async (o, n) => new Uint8Array(await src.slice(o, o + n).arrayBuffer()) };
    }
    if (src && typeof src.read === 'function' && Number.isSafeInteger(src.size)) return { size: src.size, read: async (o, n) => src.read(o, n) };
    return fail('a source is a Blob, an ArrayBuffer, a typed array or { size, read(offset, length) }');
  };

  // Sequential reads over a window of the source, refilled a chunk at a time.
  const cursor = (src, chunk) => {
    let buf = new Uint8Array(0), base = 0, pos = 0, dv = new DataView(buf.buffer);
    const td = new TextDecoder('utf-8');
    const c = {
      get pos() { return pos; },
      // Makes the next n bytes readable (awaits only when the window runs out).
      async need(n) {
        if (pos + n <= base + buf.length) return;
        if (pos + n > src.size) fail(`truncated at byte ${pos} (wants ${n} more of ${src.size})`);
        const len = Math.min(Math.max(chunk, n), src.size - pos);
        const got = await src.read(pos, len);
        if (!got || got.length < n) fail(`short read at byte ${pos}`);
        buf = got; base = pos; dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
      },
      has: (n) => pos + n <= base + buf.length,
      u8() { const v = buf[pos - base]; pos += 1; return v; },
      u32() { const v = dv.getUint32(pos - base, true); pos += 4; return v; },
      u64() { const v = dv.getBigUint64(pos - base, true); pos += 8; return v; },
      scalar(t) {
        const o = pos - base;
        pos += SIZE[t];
        switch (t) {
          case 'u8': return dv.getUint8(o);
          case 'i8': return dv.getInt8(o);
          case 'u16': return dv.getUint16(o, true);
          case 'i16': return dv.getInt16(o, true);
          case 'u32': return dv.getUint32(o, true);
          case 'i32': return dv.getInt32(o, true);
          case 'f32': return dv.getFloat32(o, true);
          case 'bool': return dv.getUint8(o) !== 0;
          case 'u64': return dv.getBigUint64(o, true);
          case 'i64': return dv.getBigInt64(o, true);
          default: return dv.getFloat64(o, true);
        }
      },
      // Copies n bytes out of the window (they are in it after need(n)).
      bytes(n) { const o = pos - base; pos += n; return buf.slice(o, o + n); },
      text(n) { const o = pos - base; pos += n; return td.decode(buf.subarray(o, o + n)); },
    };
    return c;
  };

  const count = (big, what) => {
    if (big > BigInt(Number.MAX_SAFE_INTEGER)) fail(`${what} too large`);
    return Number(big);
  };

  const readString = async (c) => {
    await c.need(8);
    const n = count(c.u64(), 'string length');
    await c.need(n);
    return c.text(n);
  };

  const kvType = async (c) => {
    await c.need(4);
    const t = KV[c.u32()];
    if (!t) fail('unknown metadata type');
    return t;
  };

  // A value of type t; arrays as [arr, element type] in types.
  const readValue = async (c, t) => {
    if (t === 'str') return { value: await readString(c), type: t };
    if (t !== 'arr') { await c.need(SIZE[t]); return { value: c.scalar(t), type: t }; }
    const et = await kvType(c);
    await c.need(8);
    const n = count(c.u64(), 'array length');
    if (ARRAY[et]) {
      const size = SIZE[et];
      const out = new ARRAY[et](n);
      for (let i = 0; i < n;) {
        // Whole runs out of the window at a time.
        if (!c.has(size)) await c.need(size);
        out[i++] = c.scalar(et);
      }
      return { value: out, type: ['arr', et] };
    }
    const out = new Array(n);
    let inner = et;
    for (let i = 0; i < n; i++) {
      if (et === 'bool') { if (!c.has(1)) await c.need(1); out[i] = c.scalar('bool'); continue; }
      const v = await readValue(c, et);
      out[i] = v.value;
      inner = v.type;
    }
    return { value: out, type: ['arr', inner] };
  };

  // → { version, size, alignment, dataOffset, kv, kvTypes, tensors, tensor(name), read(name or info), bytesOf(type, n) }.
  // A tensor info: { name, dims (ggml order: dims[0] is the row length), type (its name), typeId, count, bytes, offset
  // (from the start of the file) }. opts.chunk: bytes the header is read in (1 MiB).
  const open = async (input, { chunk = 1 << 20 } = {}) => {
    const src = source(input);
    const c = cursor(src, chunk);
    await c.need(8);
    const magic = c.text(4);
    if (magic !== 'GGUF') fail('not a GGUF file');
    const version = c.u32();
    if (version === 1) fail('GGUF v1 is not supported');
    if (version !== 2 && version !== 3) fail((version & 0xffff) === 0 ? 'a big-endian GGUF' : `unknown version ${version}`);
    await c.need(16);
    const nTensors = count(c.u64(), 'tensor count');
    const nKv = count(c.u64(), 'metadata count');

    const kv = Object.create(null), kvTypes = Object.create(null);
    for (let i = 0; i < nKv; i++) {
      const key = await readString(c);
      if (key in kv) fail(`duplicate key ${key}`);
      const { value, type: t } = await readValue(c, await kvType(c));
      kv[key] = value;
      kvTypes[key] = t;
    }
    let alignment = 32;
    if ('general.alignment' in kv) {
      if (kvTypes['general.alignment'] !== 'u32') fail('general.alignment is not a u32');
      alignment = kv['general.alignment'];
      if (!alignment || alignment & (alignment - 1)) fail(`alignment ${alignment} is not a power of two`);
    }

    const tensors = [], byName = new Map();
    for (let i = 0; i < nTensors; i++) {
      const name = await readString(c);
      if (byName.has(name)) fail(`duplicate tensor ${name}`);
      await c.need(4);
      const nd = c.u32();
      if (nd < 1 || nd > MAX_DIMS) fail(`${name}: ${nd} dimensions`);
      await c.need(8 * nd + 12);
      const dims = [];
      for (let d = 0; d < nd; d++) dims.push(count(c.u64(), `${name} dimension`));
      const t = type(c.u32());
      if (!t) fail(`${name}: unknown type`);
      const rel = count(c.u64(), `${name} offset`);
      if (rel % alignment) fail(`${name}: offset ${rel} is not aligned to ${alignment}`);
      if (dims[0] % t.block) fail(`${name}: row of ${dims[0]} is not whole ${t.name} blocks`);
      const n = dims.reduce((a, b) => a * b, 1);
      if (!Number.isSafeInteger(n)) fail(`${name}: too many elements`);
      const info = { name, dims, type: t.name, typeId: t.id, count: n, bytes: (n / t.block) * t.bytes, rel };
      tensors.push(info);
      byName.set(name, info);
    }
    const dataOffset = Math.ceil(c.pos / alignment) * alignment;
    for (const t of tensors) {
      t.offset = dataOffset + t.rel;
      delete t.rel;
      if (t.offset + t.bytes > src.size) fail(`${t.name}: data runs past the end of the file`);
    }

    const tensor = (name) => byName.get(name) || null;
    return {
      version, size: src.size, alignment, dataOffset, kv, kvTypes, tensors, tensor,
      // A tensor's raw bytes (a copy only when the source makes one), or a byte range of it.
      async read(t, from = 0, length) {
        const info = typeof t === 'string' ? tensor(t) : t;
        if (!info) fail(`no tensor ${t}`);
        const n = length ?? info.bytes - from;
        if (from < 0 || n < 0 || from + n > info.bytes) fail(`${info.name}: range out of the tensor`);
        const got = await src.read(info.offset + from, n);
        if (!got || got.length !== n) fail(`${info.name}: short read`);
        return got;
      },
    };
  };

  // Bytes of n elements of a type (n whole blocks).
  const bytesOf = (t, n) => {
    const ty = type(t);
    if (!ty) fail(`unknown type ${t}`);
    if (n % ty.block) fail(`${n} is not whole ${ty.name} blocks`);
    return (n / ty.block) * ty.bytes;
  };

  return { open, source, type, bytesOf, TYPES, KV };
})();
if (typeof module !== 'undefined') module.exports = GZ_AI_GGUF; else GZ_AI_GGUF;
