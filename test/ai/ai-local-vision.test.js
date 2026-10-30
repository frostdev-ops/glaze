// The picture reference's preprocessing (ai/local/vision-reference.js) against llama.cpp's own: every expected value
// below came from llama.cpp v0.8.0's mtmd-image.cpp (smart_resize, resize_pillow with torchvision's int16 weights,
// from_u8 and normalize) compiled into a probe and fed these same inputs. checks/ai/local-vision-check.js holds the
// encoder and projector to llama.cpp on the real model.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const V = require('../../extension/ai/local/vision-reference.js');

const mulberry = (a) => () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const bytes = (seed, n) => { const r = mulberry(seed); return Uint8Array.from({ length: n }, () => Math.floor(r() * 256)); };
const sha = (a) => crypto.createHash('sha256').update(Buffer.from(a.buffer, a.byteOffset, a.byteLength)).digest('hex');
const hex = (a) => Buffer.from(a.buffer, a.byteOffset, a.byteLength).toString('hex');

// LFM3-VL-2B's projector metadata (mmproj at LiquidAI/LFM3-VL-2B-GGUF b36554cf).
const KV = {
  'general.architecture': 'clip', 'clip.vision.projector_type': 'lfm3vl', 'clip.vision.patch_size': 16, 'clip.vision.spatial_merge_size': 2,
  'clip.vision.embedding_length': 1024, 'clip.vision.feed_forward_length': 2560, 'clip.vision.block_count': 14,
  'clip.vision.attention.head_count': 16, 'clip.vision.attention.head_count_kv': 8, 'clip.vision.attention.layer_norm_epsilon': Math.fround(1e-5),
  'clip.vision.image_mean': Float32Array.of(0.5, 0.5, 0.5), 'clip.vision.image_std': Float32Array.of(0.5, 0.5, 0.5),
  'clip.vision.image_min_pixels': 65536, 'clip.vision.image_max_pixels': 16777216, 'clip.vision.image_resize_algo': 'bicubic',
};
const fake = (kv = KV) => ({ kv, tensor: (n) => (n === 'mm.2.bias' ? { count: 2048 } : null) });
const C = V.config(fake());

test('config: the projector metadata, max pixels capped at 4096 tokens as llama.cpp does', () => {
  assert.deepEqual([C.patch, C.merge, C.nEmbd, C.nHead, C.nHeadKv, C.headDim, C.nFf, C.nLayer, C.outEmbd], [16, 2, 1024, 16, 8, 64, 2560, 14, 2048]);
  assert.deepEqual([C.minPixels, C.maxPixels, C.resize, C.ropeTheta, C.projEps], [65536, 4096 * 1024, 'bicubic', 1e6, 1e-6]);
  assert.throws(() => V.config(fake({ ...KV, 'clip.vision.projector_type': 'qwen3vl' })), /only lfm3vl/);
  assert.throws(() => V.config(fake({ ...KV, 'general.architecture': 'lfm3' })), /clip projector/);
  assert.throws(() => V.config(fake({ ...KV, 'clip.vision.spatial_merge_size': 3 })), /only 2/);
});

test('target sizes: smart_resize to multiples of 32 within the pixel budget, rounding half to even', () => {
  // width height → llama.cpp's width height
  const want = '360 240 352 256;300 200 320 224;512 384 512 384;400 400 384 384;500 375 512 384;61 47 320 256;1 1 256 256;4000 20 4000 32;20 4000 32 4000;4096 4096 2048 2048;3000 2000 2496 1664;8000 6000 2336 1760;224 224 256 256;336 336 320 320;1920 1080 1920 1088;1023 769 1024 768;48 48 256 256;200 300 224 320';
  for (const row of want.split(';')) {
    const [w, h, ew, eh] = row.split(' ').map(Number);
    assert.deepEqual(V.targetSize(C, w, h), { width: ew, height: eh }, `${w} × ${h}`);
  }
});

test('resize: torchvision bicubic on uint8 as llama.cpp, down, up and one axis at a time', () => {
  const small = bytes(7, 7 * 5 * 3);
  assert.equal(hex(V.resize(small, 7, 5, 4, 3)), '693c8d964690c56e746f7c3c5f899b978a9eb66d4da4865f91b49c6eb48d7c8e9b7abad6');
  assert.equal(hex(V.resize(small, 7, 5, 3, 5)), '6249a9ae52466b9a5a883275b773d1ae4f3f57a29f9e5237b58b4189a9d0a2e3a48693aa8ab0624d798f7dafd0');
  assert.equal(hex(V.resize(small, 7, 5, 7, 9)), '000cffbd8a64714086be3a1cbf822354508f4aff444613bd89736e8c2cacaf6051d28e6b8036704dce2ad827322f4d85be0fe8939daaf4a0e5cc0c355671048e74274058bfbf50a871646ffa79aac7260e829b3516c45e6d77f2b4b0545b2322e95230a1560bafeb8c7bb9ba3a7fced9eda4859596b2a4008c5268a4d6d8d6a9e7248ca1dbeacb8ffffe8ac70b845bc685c4f8a8c5957caf917a714130fae6984071919bf159eac188d664afc18b432d0000f1d2a300ab9abfff41ff9f');
  assert.equal(hex(V.resize(small, 7, 5, 13, 9)), '0002ff262ee0aa7f76ae79697245878f3558be3a1cca6412ba81297b586e4d628c49d75a48ff3d4a0bbe572da7816c748e5f828b2eab9b3c85af6051ca825ad08b6da34d7475436857a63c48d425e6242aa932443b4c765833b1b80ee6ae4ccf939daac8b1d2f599dee7397abc0f2573540b4c790093761a766d4d425cae6c52c4bc50ab9c578971646fbb7696fc75a4e43c45bc300a927c277ca5390fca5229af885f7de9918cc7b4b25d8871325b2322a93429ea532ec04c0f9f6818a9c66bb0f79781bdb966a7c03980ce72a6c2d4eaa6bbcba38595969c9d3cb1a1009a66338e5d7a9db3bfa7e1e1e5aceea49fd42f8aa65baaa9d4e5c7c5fdf38ffffe89e86f89c00b8677748561d685a6f185ccfcabc7959dc29781b5967c916d7c703f52b68d30fae66596a79b3e739d6dc28baaf267d9d154efbd85d76095d572b0cc8f8f824c4a2d00118a4e00f1d25363c4a800aeab66ea8fd2fd57f6bb3aff97');
  const mid = bytes(9, 37 * 23 * 3);
  assert.equal(sha(V.resize(mid, 37, 23, 64, 32)), '8b82f7c3e15a04bc3474f4bec709b6a3cd6173df60b786ac550ca1bd0c093900');
  assert.equal(sha(V.resize(mid, 37, 23, 16, 11)), 'e02b6eeac57353a571c5aa44647bd02aa4ad6b269fe0c06f3f5f098e28582645');
  assert.equal(sha(V.resize(mid, 37, 23, 96, 96)), '787760a6a21e0d4dd937af285198b90880981b2326e47158da2985e69a97cebe');
  // the same size is a copy, never a resample
  assert.deepEqual(V.resize(small, 7, 5, 7, 5), small);
});

test('preprocess: RGBA in, alpha dropped, resized and normalized as llama.cpp', () => {
  const rgba = bytes(11, 61 * 47 * 4);
  const p = V.preprocess(C, rgba, 61, 47);
  assert.deepEqual([p.width, p.height], [320, 256]);
  assert.equal(sha(p.rgb), '8634f64eb10ecb7d0aaa7ec91f4bf7b009e0860aa678cfa39f76fcbd975fb2d0');
  assert.equal(sha(p.pixels), '8f8a7d3796af3cfe43fc94d330553e5840149a9807995cdd6a858755841f9e97');
  const rgb = new Uint8Array(61 * 47 * 3);
  for (let i = 0; i < 61 * 47; i++) rgb.set(rgba.subarray(4 * i, 4 * i + 3), 3 * i);
  assert.equal(sha(V.preprocess(C, rgb, 61, 47, { channels: 3 }).pixels), sha(p.pixels));
  // (u / 255 − 0.5) / 0.5 in float
  const edge = V.preprocess({ ...C, minPixels: 1024, maxPixels: 1024 }, Uint8Array.from({ length: 32 * 32 * 3 }, (_, i) => [0, 255, 128][i % 3]), 32, 32, { channels: 3 });
  assert.deepEqual([...edge.pixels.subarray(0, 3)], [-1, 1, Math.fround(Math.fround(Math.fround(128 / 255) - 0.5) / 0.5)]);
  assert.throws(() => V.preprocess(C, rgba, 60, 47), /not 60 × 47 × 4/);
});

test('erf and the projector\'s erf GELU in doubles', () => {
  const { erf, geluErf } = V._ops;
  for (const [x, want] of [[0, 0], [0.5, 0.5204998778130465], [1, 0.8427007929497149], [2, 0.9953222650189527], [3.5, 0.9999992569016276], [-1, -0.8427007929497149]]) assert.ok(Math.abs(erf(x) - want) < 1e-15, `erf(${x}) = ${erf(x)}`);
  assert.equal(erf(7), 1);
  assert.ok(Math.abs(geluErf(1) - 0.8413447460685429) < 1e-15);
});
