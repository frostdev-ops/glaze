const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../lib/color.js');

test('parses hex in every length', () => {
  assert.deepEqual(C.parse('#fff'), { r: 255, g: 255, b: 255, a: 1 });
  assert.deepEqual(C.parse('#0D1B2E'), { r: 13, g: 27, b: 46, a: 1 });
  assert.equal(C.parse('#00000080').a.toFixed(2), '0.50');
});

test('parses computed rgb() and rgba()', () => {
  assert.deepEqual(C.parse('rgb(38, 38, 38)'), { r: 38, g: 38, b: 38, a: 1 });
  assert.deepEqual(C.parse('rgba(0, 0, 0, 0)'), { r: 0, g: 0, b: 0, a: 0 });
  assert.deepEqual(C.parse('rgb(10 20 30 / 0.5)'), { r: 10, g: 20, b: 30, a: 0.5 });
});

test('parses color(srgb) from color-mix() as 0-255, not near-black', () => {
  const c = C.parse('color(srgb 1 1 1 / 0.85)');
  assert.deepEqual(c, { r: 255, g: 255, b: 255, a: 0.85 });
  assert.ok(C.brightness(C.parse('color(srgb 0.9 0.9 0.9)')) > 0.8);
});

test('rejects junk', () => {
  for (const v of [null, '', 'red', '#ggg', 'rgb(1,2)', 'color(display-p3 1 1 1)', 'rgb(a, b, c)']) assert.equal(C.parse(v), null, v);
});

test('contrast matches WCAG reference values', () => {
  assert.equal(C.contrast('#000000', '#ffffff').toFixed(1), '21.0');
  assert.equal(C.contrast('#ffffff', '#ffffff').toFixed(1), '1.0');
  assert.equal(C.contrast('#777777', '#ffffff').toFixed(2), '4.48');
});

test('saturation separates greys from brand colors', () => {
  assert.equal(C.saturated(C.parse('#f4f5f7')), false);
  assert.equal(C.saturated(C.parse('#17c8f4')), true);
});

test('same() compares across notations', () => {
  assert.ok(C.same(C.parse('#0d1b2e'), C.parse('rgb(13, 27, 46)')));
  assert.ok(!C.same(C.parse('#0d1b2e'), C.parse('rgb(13, 27, 47)')));
});
