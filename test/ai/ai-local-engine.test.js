// The local engine's pure parts (extension/ai/local/engine.js): where weights go in GPU buffers, the kernels' preprocessor,
// dispatch grids, the RoPE table and the uniforms. The kernels themselves run in a browser: checks/ai/local-engine-check.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const EN = require('../../extension/ai/local/engine.js');
const R = require('../../extension/ai/local/reference.js');

const LIMITS = { maxBuffer: 2 ** 32 - 4, maxBinding: 2 ** 31 - 4 };
const t = (name, rows, rowBytes, pair) => ({ name, rows, rowBytes, bytes: rows * rowBytes, pair });

test('plan packs tensors at 256-byte boundaries, never past a buffer or the binding limit', () => {
  const p = EN.plan([t('a', 10, 1150), t('b', 1, 8192), t('c', 3, 6)], LIMITS);
  assert.equal(p.buffers.length, 1);
  assert.deepEqual(p.at.a, [{ buffer: 0, offset: 0, size: 11500, row: 0, rows: 10 }]);
  assert.deepEqual(p.at.b, [{ buffer: 0, offset: 11520, size: 8192, row: 0, rows: 1 }]);
  // 18 bytes round up to whole words.
  assert.deepEqual(p.at.c, [{ buffer: 0, offset: 19712, size: 20, row: 0, rows: 3 }]);
  assert.equal(p.buffers[0], 19732);
  for (const runs of Object.values(p.at)) for (const r of runs) assert.equal(r.offset % 256, 0);
});

test('plan splits a tensor over the binding limit into runs of whole rows', () => {
  // A Q6_K vocabulary of 128000 rows of 1680 bytes on a device that binds at most 128 MiB.
  const p = EN.plan([t('token_embd', 128000, 1680)], { maxBuffer: 2 ** 31, maxBinding: 128 * 2 ** 20 });
  const runs = p.at.token_embd, per = Math.floor((128 * 2 ** 20) / 1680);
  assert.equal(runs.length, Math.ceil(128000 / per));
  assert.deepEqual(runs.map((r) => r.row), runs.map((_, i) => i * per));
  assert.equal(runs.reduce((n, r) => n + r.rows, 0), 128000);
  for (const r of runs) { assert.ok(r.size <= 128 * 2 ** 20); assert.equal(r.size, r.rows * 1680); }
});

test('plan never makes a buffer over 1 GiB (Firefox allows 2) and opens a new one when the next run does not fit', () => {
  const big = (n) => t(n, 1000, 400000); // 400 MB each
  const p = EN.plan([big('a'), big('b'), big('c')], LIMITS);
  assert.deepEqual(p.buffers.length, 2);
  assert.ok(p.buffers.every((b) => b <= 2 ** 30));
  assert.deepEqual([p.at.a[0].buffer, p.at.b[0].buffer, p.at.c[0].buffer], [0, 0, 1]);
  assert.throws(() => EN.plan([t('row', 1, 2 ** 30 + 4)], LIMITS), /larger than a buffer|over the binding limit/);
});

test('plan puts a pair (ffn_gate, ffn_up) in one binding, the second at pairOff, unless that is over the limit', () => {
  const p = EN.plan([t('gate', 7680, 1152, 'up'), t('up', 7680, 1152), t('down', 2048, 4320)], LIMITS);
  const [g] = p.at.gate, [u] = p.at.up;
  assert.equal(g.pairOff, 7680 * 1152);
  assert.equal(u.offset, g.offset + g.pairOff);
  assert.equal(g.size, g.pairOff + 7680 * 1152);
  const q = EN.plan([t('gate', 100, 1000, 'up'), t('up', 100, 1000)], { maxBuffer: 2 ** 31, maxBinding: 150000 });
  assert.equal(q.at.gate[0].pairOff, undefined);
  assert.ok(q.at.up[0].offset >= 100000);
});

test('the preprocessor keeps the lines its conditions select, nested, with || and !', () => {
  const src = ['a', '//#if X', 'b', '//#if !Y', 'c', '//#else', 'd', '//#endif', '//#else', 'e', '//#endif', '//#if Y || Z', 'f', '//#endif', 'g'].join('\n');
  assert.equal(EN.preprocess(src, { X: true }), 'a\nb\nc\ng');
  assert.equal(EN.preprocess(src, { X: true, Y: true }), 'a\nb\nd\nf\ng');
  assert.equal(EN.preprocess(src, { Z: true }), 'a\ne\nf\ng');
  assert.throws(() => EN.preprocess('//#if X\na'), /without #endif/);
  assert.throws(() => EN.preprocess('a\n//#endif'), /without #if/);
});

test('every kernel file is shipped and balanced under every define it uses', () => {
  const dir = path.join(__dirname, '../../extension/ai/local/kernels');
  for (const k of EN.KERNELS) {
    const src = fs.readFileSync(path.join(dir, `${k}.wgsl`), 'utf8');
    const names = new Set([...src.matchAll(/^\s*\/\/#if (.*)$/gm)].flatMap((m) => m[1].split(/\|\||&&/).map((s) => s.trim().replace(/^!/, ''))));
    const list = [...names];
    for (let mask = 0; mask < 2 ** list.length; mask++) {
      const d = Object.fromEntries(list.map((n, i) => [n, !!(mask & (1 << i))]));
      const out = EN.preprocess(src, d);
      assert.doesNotMatch(out, /\/\/#/, `${k} ${JSON.stringify(d)}`);
    }
    // One deq32 per quant type, so a kernel gets exactly one.
    // One deq32, and one of each of the GEMM's row-stream functions, per quant type, so a kernel gets exactly one.
    if (k === 'quant') for (const q of Object.keys(EN.QUANT)) for (const f of ['deq32', 'hd', 'sc', 'qw', 'v4']) assert.equal((EN.preprocess(src, { [q]: true }).match(new RegExp(`fn ${f}\\(`, 'g')) || []).length, 1, `${q} ${f}`);
  }
});

test('grid keeps each side within 65535 and covers n', () => {
  for (const n of [1, 65535, 65536, 128000, 1e6, 65535 * 65535]) {
    const [x, y] = EN.grid(n);
    assert.ok(x <= 65535 && y <= 65535 && x * y >= n, `${n}: ${x}×${y}`);
  }
  assert.deepEqual(EN.grid(0), [1, 1]);
  assert.throws(() => EN.grid(65535 * 65535 + 1), /workgroups/);
});

test('a big-tile GEMM splits along k only when its tiles cannot fill a GPU, in whole sub-blocks', () => {
  // LFM3-1.7B's matrices at a 512-token step: ffn_down (2048 × 7680) and the 2048 × 2048 ones split 5 ways, the wide
  // ones not at all, attn_k / attn_v (512 rows) 8 ways.
  assert.equal(EN.splits(2048, 7680, 512), 5);
  assert.equal(EN.splits(2048, 2048, 512), 5);
  assert.equal(EN.splits(7680, 2048, 512), 1);
  assert.equal(EN.splits(6144, 2048, 512), 1);
  assert.equal(EN.splits(512, 2048, 512), 8);
  // A short step has fewer token tiles, so more splits; never more than 8, nor than the sub-blocks of a row.
  assert.equal(EN.splits(2048, 7680, 128), 8);
  assert.equal(EN.splits(512, 64, 128), 2);
  // The sum reads rows four at a time.
  assert.equal(EN.splits(2050, 7680, 512), 1);
  for (const [rows, cols, T] of [[16, 2048, 512], [128000, 2048, 512], [4096, 32, 1024]]) {
    const z = EN.splits(rows, cols, T);
    assert.ok(Number.isInteger(z) && z >= 1 && z <= 8 && z <= cols / 32, `${rows}×${cols} T=${T}: ${z}`);
  }
});

test('the RoPE table is the reference rope\'s own cos and sin', () => {
  const n = 8, half = n / 2, factors = Float32Array.of(1, 1, 1e30, 1e30), pos = [0, 3, 1500];
  for (const [base, f] of [[1e6, factors], [1e4, null]]) {
    const tab = EN.ropeTable(0, 1501, n, base, f);
    // Turning unit vectors with the reference gives its (cos, sin) per pair.
    for (const p of pos) {
      for (let i = 0; i < half; i++) {
        const x = new Float32Array(n); x[i] = 1;
        R._ops.rope(x, 1, 1, n, [p], n, base, f);
        assert.equal(tab[(p * half + i) * 2], x[i]);
        assert.equal(tab[(p * half + i) * 2 + 1], x[i + half]);
      }
    }
  }
});

test('uniforms are eight words in each kernel\'s field order, floats as their bits', () => {
  assert.deepEqual([...EN.PARAMS.matvec({ rows: 7, K: 2048, rowBytes: 1152, xOff: 4, yOff: 9, upOff: 256 })], [7, 2048, 1152, 4, 9, 256, 0, 0]);
  assert.deepEqual([...EN.PARAMS.matmul({ rows: 7, K: 32, rowBytes: 34, T: 70, xStride: 32, ldy: 7 })], [7, 32, 34, 70, 32, 0, 7, 0]);
  const w = EN.PARAMS.attention({ T: 1, pos: 599, H: 16, Hkv: 4, window: 256, ring: 384, scale: 1 / Math.sqrt(128) });
  assert.equal(new Float32Array(w.buffer)[6], Math.fround(1 / Math.sqrt(128)));
  assert.deepEqual([...w.slice(0, 6)], [1, 599, 16, 4, 256, 384]);
  assert.equal(new Float32Array(EN.PARAMS.norm({ n: 2048, eps: 1e-5 }).buffer)[1], Math.fround(1e-5));
});
