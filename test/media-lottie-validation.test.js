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

const shapes = (...items) => ({ v: '5.13.0', fr: 30, ip: 0, op: 30, w: 100, h: 100,
  layers: [{ ty: 4, shapes: items }] });
const prop = (k) => ({ a: 0, k });

test('Lottie bounds repeater offsets and zigzag expansion before the player loops', () => {
  for (const k of [100000000, -100000000]) {
    assert.equal(M.lottie(shapes({ ty: 'rp', c: prop(1), o: prop(k) })), null);
  }
  assert.equal(M.lottie(shapes({ ty: 'zz', r: prop(100000000), s: prop(10) })), null);
  assert.equal(M.lottie(shapes(...Array.from({ length: 5 }, () => ({ ty: 'zz', r: prop(10), s: prop(10) })))), null, 'modifiers multiply their generated vertices');
  assert.ok(M.lottie(shapes({ ty: 'rp', c: prop(2), o: prop(-2) }, { ty: 'zz', r: prop(3), s: prop(10) })));
});

test('Lottie bounded scalar keyframes cannot use easing to overshoot their limits', () => {
  const animated = (y) => ({ a: 1, k: [{ t: 0, s: [1], e: [2], o: { x: 0.3, y }, i: { x: 0.7, y } }, { t: 30, s: [2] }] });
  for (const item of [
    { ty: 'rp', c: animated(100000000) },
    { ty: 'rp', c: prop(2), o: animated(100000000) },
    { ty: 'sr', pt: animated(100000000) },
    { ty: 'zz', r: animated(100000000), s: prop(10) },
  ]) assert.equal(M.lottie(shapes(item)), null);
  assert.ok(M.lottie(shapes({ ty: 'rp', c: animated(0.5) })));
});
