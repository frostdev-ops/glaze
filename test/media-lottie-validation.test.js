const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../lib/media.js');

const gradient = (g, ty = 'gf') => ({ v: '5.13.0', fr: 30, ip: 0, op: 30, w: 100, h: 100,
  layers: [{ ty: 4, shapes: [{ ty, g }] }] });
const colors = [0, 1, 0, 0, 1, 0, 0, 1];

test('Lottie gradient allocations are bounded by the supplied color stops', () => {
  for (const ty of ['gf', 'gs']) {
    for (const p of [100000000, -1, 0, 1.5, '2']) {
      assert.equal(M.lottie(gradient({ p, k: { a: 0, k: colors } }, ty)), null, `${ty}: ${p}`);
    }
    assert.ok(M.lottie(gradient({ p: 2, k: { a: 0, k: colors } }, ty)));
    assert.ok(M.lottie(gradient({ p: 2, k: { a: 0, k: [...colors, 0, 1, 1, 0] } }, ty)));
    assert.ok(M.lottie(gradient({ p: 2, k: { a: 1, k: [{ t: 0, s: colors, e: colors }, { t: 30 }] } }, ty)));
    assert.equal(M.lottie(gradient({ p: 3, k: { a: 1, k: [{ t: 0, s: colors }, { t: 30 }] } }, ty)), null);
    assert.equal(M.lottie(gradient({ p: 2, k: { a: 0, k: [...colors, 0] } }, ty)), null, 'opacity stops need position/value pairs');
  }
});
