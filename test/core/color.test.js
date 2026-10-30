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

test('mix() matches Chrome\'s color-mix(in oklab)', () => {
  assert.equal(C.mix('#17c8f4', '#ffe12b', 0), '#17c8f4');
  assert.equal(C.mix('#17c8f4', 'rgb(255, 225, 43)', 1), '#ffe12b');
  // [a, b, share of b, getComputedStyle() of color-mix(in oklab, a, b) in Chrome 155]
  for (const [a, b, t, want] of [
    ['#17c8f4', '#ffe12b', 0.6, 'color(srgb 0.734941 0.860226 0.613563)'],
    ['#2563eb', '#c473d4', 0.5, 'color(srgb 0.503405 0.437274 0.879779)'],
    ['#082f49', '#ff6417', 0.3, 'color(srgb 0.344867 0.273204 0.290544)'],
    ['#0d1b2e', '#89f3db', 0.1, 'color(srgb 0.0898793 0.177239 0.241429)'],
    ['#c026d3', '#85f472', 0.6, 'color(srgb 0.682793 0.702786 0.660296)'],
    ['#000000', '#ffffff', 0.5, 'color(srgb 0.388573 0.388573 0.388573)'],
  ]) {
    const got = C.parse(C.mix(a, b, t));
    const exp = C.parse(want);
    for (const k of 'rgb') assert.ok(Math.abs(got[k] - exp[k]) <= 1, `${a} ${b} ${t}: ${C.mix(a, b, t)} vs ${C.hex(exp)}`);
  }
});

test('rehue() keeps brightness and swaps the hue; a gray gives none', () => {
  const pink = C.rehue('#17c8f4', '#c026d3');
  assert.ok(Math.abs(C.luminance(C.parse(pink)) - C.luminance(C.parse('#17c8f4'))) < 0.05, pink);
  assert.ok(C.parse(pink).r > C.parse(pink).g, `${pink} is pink, not cyan`);
  assert.equal(C.rehue('#17c8f4', '#f4f5f7'), '#17c8f4');
});
