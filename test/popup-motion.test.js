const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../lib/popup.js');

const dialog = { left: 420, top: 180, right: 1020, bottom: 720, width: 600, height: 540 };
const point = (transform, x, y) => {
  const [, tx, ty, matrix] = transform.match(/^translate\(([-\d.]+)px, ([-\d.]+)px\) matrix3d\((.*)\)$/);
  const m = matrix.split(',').map(Number);
  assert.equal(m.length, 16);
  assert.ok(m.every(Number.isFinite));
  const w = m[3] * x + m[7] * y + m[15];
  return [(m[0] * x + m[4] * y + m[12]) / w + +tx, (m[1] * x + m[5] * y + m[13]) / w + +ty];
};
const near = (a, b) => a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < 0.08, `${a} meets ${b}`));

test('the genie bends the content as a connected sheet and returns every strip to its real position', () => {
  for (const source of [
    { left: 70, top: 40, right: 230, bottom: 60, width: 160, height: 20 },
    { left: 1180, top: 800, right: 1380, bottom: 820, width: 200, height: 20 },
    { left: 20, top: 360, right: 80, bottom: 388, width: 60, height: 28 },
  ]) {
    const g = P.genie(source, dialog);
    assert.ok(g.bands.length >= 16 && g.bands.length <= 24);
    assert.ok(g.frames.length >= 24, 'enough temporal samples for the changing curvature');
    for (const b of g.bands) {
      assert.equal(b.frames.length, g.frames.length);
      near(point(b.frames.at(-1).transform, 0, 0), [0, b.top]);
      near(point(b.frames.at(-1).transform, dialog.width, b.height), [dialog.width, b.top + b.height]);
    }
    for (let f = 0; f < g.frames.length; f++) for (let i = 0; i < g.bands.length - 1; i++) {
      const a = g.bands[i], b = g.bands[i + 1];
      // Ignore the deliberate subpixel overlap used to cover GPU raster seams.
      for (const x of [0, dialog.width]) {
        near(point(a.frames[f].transform, x, b.top - a.top), point(b.frames[f].transform, x, 0));
      }
    }
  }
});

test('the smooth funnel still begins at the source text and ends at the full dialog', () => {
  const s = { left: 80, top: 40, right: 240, bottom: 60, width: 160, height: 20 };
  const g = P.genie(s, dialog);
  const first = g.frames[0], last = g.frames.at(-1);
  assert.equal(first.opacity, 0);
  assert.equal(last.opacity, 1);
  assert.equal(last.transform, 'none');
  assert.ok(first.clipPath.split(',').length >= 32, 'curved sides have many matching points');
  assert.ok(g.frames.every((f) => !/NaN|Infinity/.test(JSON.stringify(f))));
  assert.equal(P.motion({ level: 'expressive', reduced: true }), 'none');
  assert.equal(P.motion({ level: 'subtle' }), 'scale');
});

test('the neck stays attached to the origin while both ends widen progressively', () => {
  const s = { left: 80, top: 40, right: 240, bottom: 60, width: 160, height: 20 };
  const g = P.genie(s, dialog);
  const origin = g.frames[0].transform;
  for (let i = 1; i < g.frames.length - 1; i++) {
    const f = g.frames[i];
    const pts = f.clipPath.match(/[-\d.]+% [-\d.]+%/g).map((v) => v.split(' ').map(parseFloat));
    const neck = pts[1][0] - pts[0][0], tip = pts[21][0] - pts[22][0];
    assert.ok(neck < 100 && tip < 100, 'neither end is full width before the sheet settles');
    if (f.offset < 0.35) {
      assert.equal(f.transform, origin, 'the neck stays at the source while the ribbon emerges');
      assert.ok(tip < 50, 'the leading edge has not expanded into a wide panel yet');
    }
  }
});
