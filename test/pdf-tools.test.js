// The PDF tools' shapes (lib/pdf-tools.js shape): a rectangle, an ellipse, a line and an arrow as pdf.js's Ink JSON, the
// strokes in the page's PDF space with each corner given twice, so pdf.js's smoothing keeps them sharp. The tools on a
// page are scripts/pdf-check.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../lib/pdf-tools.js');

const pairs = (a) => Array.from({ length: a.length / 2 }, (_, i) => [a[2 * i], a[2 * i + 1]]);
// pdf.js's smoothing (Outline.createBezierPoints): a stroke runs through the midpoints of its points, from the first to
// the midpoint of the last two. Each corner's own point must be on that path.
const through = (pts) => { const out = [pts[0]]; for (let i = 1; i < pts.length - 1; i++) out.push([(pts[i][0] + pts[i + 1][0]) / 2, (pts[i][1] + pts[i + 1][1]) / 2]); return out; };
const has = (path, [x, y]) => path.some(([a, b]) => Math.abs(a - x) < 1e-3 && Math.abs(b - y) < 1e-3);

test('a rectangle: one closed stroke through its four corners, sharp', () => {
  const s = T.shape('rect', [100, 200, 300, 260], { color: [255, 0, 0], thickness: 4, pageIndex: 2, rotation: 90 });
  assert.equal(s.annotationType, 15);
  assert.deepEqual(s.color, [255, 0, 0]);
  assert.equal(s.thickness, 4);
  assert.equal(s.pageIndex, 2);
  assert.equal(s.rotation, 90);
  assert.equal(s.paths.points.length, 1);
  assert.ok(s.paths.points[0] instanceof Float32Array);
  const path = through(pairs(s.paths.points[0]));
  for (const c of [[100, 200], [300, 200], [300, 260], [100, 260]]) assert.ok(has(path, c), `corner ${c}`);
  assert.deepEqual(path.at(-1), [100, 200], 'closed');
  assert.deepEqual(s.rect, [97, 197, 303, 263], 'the box with half the stroke and a point around it');
});

test('a line and an arrow: from the first point to the second; the arrow\'s head a second stroke at its tip', () => {
  const line = T.shape('line', [10, 10, 110, 10]);
  assert.equal(line.paths.points.length, 1);
  const lp = through(pairs(line.paths.points[0]));
  assert.ok(has(lp, [10, 10]) && has(lp, [110, 10]));
  const arrow = T.shape('arrow', [10, 10, 110, 10], { thickness: 2 });
  assert.equal(arrow.paths.points.length, 2);
  const head = through(pairs(arrow.paths.points[1]));
  assert.ok(has(head, [110, 10]), 'the head meets the tip');
  const [one, tip, two] = pairs(arrow.paths.points[1]).filter((_, i) => i % 2 === 0);
  assert.deepEqual(tip, [110, 10]);
  assert.ok(one[0] < 110 && two[0] < 110 && (one[1] - 10) * (two[1] - 10) < 0, 'the head\'s sides go back from the tip, either side');
  assert.ok(arrow.rect[1] < 10 && arrow.rect[3] > 10, 'the box takes the head in');
});

test('an ellipse: a closed stroke within its box, touching each side', () => {
  const s = T.shape('ellipse', [0, 0, 200, 100]);
  const pts = pairs(s.paths.points[0]);
  assert.ok(pts.every(([x, y]) => x >= -1e-3 && x <= 200 + 1e-3 && y >= -1e-3 && y <= 100 + 1e-3));
  for (const [x, y] of [[200, 50], [100, 100], [0, 50], [100, 0]]) assert.ok(pts.some(([a, b]) => Math.abs(a - x) < 0.2 && Math.abs(b - y) < 0.2), `touches ${x},${y}`);
});

test('no other shapes; the highlight colours are pdf.js\'s option string', () => {
  assert.throws(() => T.shape('star', [0, 0, 1, 1]), /no shape star/);
  assert.deepEqual(T.SHAPES.map(([k]) => k), ['rect', 'ellipse', 'line', 'arrow']);
  assert.match(T.HIGHLIGHTS, /^yellow=#FFFF98,green=#53FFBC,blue=#80EBFF,pink=#FFCBE6,red=#FF4F5F$/);
});
