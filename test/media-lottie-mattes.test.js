const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const M = require('../lib/media.js');

// Exercise the shipped canvas layer constructor with tiny stand-in canvases: no decoder or pixel buffers are created.
const player = fs.readFileSync(path.join(__dirname, '../lib/lottie/lottie_light_canvas.min.js'), 'utf8');
const start = player.indexOf('createContainerElements:function(){if(this.data.tt>=1)');
const end = player.indexOf(',createContent:function()', start);
assert.ok(start > 0 && end > start);
const allocations = [];
const makeLayer = vm.runInNewContext(`(${player.slice(start + 'createContainerElements:'.length, end)})`, {
  Rs: { createCanvas: (w, h) => { const canvas = { width: w, height: h }; allocations.push(canvas); return canvas; }, loadLumaCanvas() {} },
  zs: function () {}, document: {},
});

test('the shipped Lottie player allocates two viewport canvases for every matte layer', () => {
  allocations.length = 0;
  for (let i = 0; i < 3; i++) makeLayer.call({ data: { tt: 1, w: 1, h: 1 },
    globalData: { canvasContext: { canvas: { width: 40, height: 20 } }, transformCanvas: {} }, searchEffectTransforms() {} });
  assert.equal(allocations.length, 6);
  assert.ok(allocations.every((c) => c.width === 40 && c.height === 20));
});

const solid = (ind, tt = 0) => ({ ty: 1, ind, tt, sw: 1, sh: 1, sc: '#ffffff', ks: {}, ip: 0, op: 30 });
const animation = (layers, assets = []) => ({ v: '5.13.0', fr: 30, ip: 0, op: 30, w: 1, h: 1, layers, assets });

test('Lottie reports every instantiated matte buffer through precomp reuse and extra comps', () => {
  const comp = { id: 'matte', layers: [solid(1), solid(2, 1)] };
  const references = [{ ty: 0, refId: 'matte' }, { ty: 0, refId: 'matte' }];
  assert.equal(M.lottie(animation(references, [comp])).canvases, 5, 'main canvas and two buffers per reused matte');
  assert.equal(M.lottie(animation(references, [{ ...comp, xt: 1 }])).canvases, 7, 'extra compositions are instantiated independently');
  assert.equal(M.lottie(animation([solid(1), solid(2, 3)])).canvases, 4, 'luma mattes share one more canvas');
  assert.equal(M.lottie(animation([])).canvases, 1);
});

test('worker Lottie replies retain the checked canvas count for files and remote data', async () => {
  const bytes = M.lottie(animation([solid(1), solid(2, 1)])).bytes;
  const h = await M.sha(bytes);
  const area = { local: { get: async () => ({}) }, files: { get: async (k) => (k === h ? { t: 'application/json', b: M.std(bytes) } : undefined) } };
  const file = await M.change({ op: 'lottie', src: `file:${h}` }, area);
  assert.equal(file.canvases, 3);
  const remote = await M.change({ op: 'lottie', src: 'https://cdn.example.com/a.json' }, area, {
    allow: async () => true, fetch: async () => new Response(bytes),
  });
  assert.equal(remote.canvases, 3);
});

test('Lottie matte modes cannot rely on numeric coercion or unknown buffer types', () => {
  for (const tt of ['1', true, -1, 5]) {
    assert.equal(M.lottie(animation([solid(1), solid(2, tt)])), null, String(tt));
    assert.equal(M.lottie(animation([], [{ id: 'extra', xt: 1, tt, layers: [] }])), null, `extra ${tt}`);
  }
});

test('Lottie refuses preexpanded layer children and completion flags that bypass asset accounting', () => {
  const nested = Array.from({ length: 100 }, (_, i) => solid(i + 1, 1));
  for (const layer of [
    { ty: 0, refId: 'empty', completed: true, ks: {}, layers: nested },
    { ty: 0, refId: 'empty', ks: {}, layers: nested },
    { ty: 0, refId: 'empty', layers: nested },
    { ty: 0, refId: 'empty', completed: true, ks: {} },
  ]) assert.equal(Boolean(M.lottie(animation([layer], [{ id: 'empty', layers: [] }]))), false);
  assert.equal(M.lottie(animation([{ ty: 0, refId: 'matte', ks: {} }], [{ id: 'matte', layers: [solid(1), solid(2, 1)] }])).canvases, 3);
});

test('Lottie strips the top completion flag and refuses internal cache keys inside drawing data', () => {
  const original = animation([solid(1), solid(2, 1)]);
  assert.equal(M.lottie({ ...original, __complete: true }).canvases, 3);
  for (const key of ['__complete', '__used', '__fnct']) {
    assert.equal(Boolean(M.lottie(animation([{ ...solid(1), ks: { [key]: true } }]))), false, key);
  }
});
