const test = require('node:test');
const assert = require('node:assert/strict');
const I = require('../lib/ink.js');

test('a key per Canvas site, person and file; anything else has none', () => {
  assert.equal(I.storeKey('https://school.instructure.com', '170000000000123', '4567'), 'ink:https://school.instructure.com/170000000000123/4567');
  assert.equal(I.storeKey('https://canvas.school.edu', '', '9'), 'ink:https://canvas.school.edu/anon/9');
  assert.equal(I.storeKey('https://canvas.school.edu', 'x"y', '9'), 'ink:https://canvas.school.edu/anon/9');
  for (const bad of [['https://a.edu', '1', ''], ['https://a.edu', '1', '9/../1'], ['http://a.edu', '1', '9'], ['https://a.edu/x', '1', '9']]) assert.equal(I.storeKey(...bad), null, bad.join(' '));
  assert.ok(I.STORE_KEY.test('ink:https://a.edu:8443/anon/1'));
});

test('a rotated view draws the page frame turned, its corners onto the view\'s', () => {
  const h = 1294; // a letter page
  const at = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
  const corners = [[0, 0], [I.W, 0], [I.W, h], [0, h]];
  // A quarter turn clockwise puts the page's top-left corner at the view's top-right.
  const want = { 0: [[0, 0], [1000, 0], [1000, h], [0, h]], 1: [[h, 0], [h, 1000], [0, 1000], [0, 0]], 2: [[1000, h], [0, h], [0, 0], [1000, 0]], 3: [[0, 1000], [0, 0], [h, 0], [h, 1000]] };
  for (const rot of [0, 1, 2, 3]) {
    assert.deepEqual(corners.map(([x, y]) => at(I.matrix(rot, h), x, y)), want[rot], `rot ${rot}`);
    const [vw, vh] = I.view(rot, h);
    for (const [x, y] of want[rot]) assert.ok(x >= 0 && x <= vw && y >= 0 && y <= vh);
  }
});

test('simplify keeps the shape with fewer points, and rounds to a tenth', () => {
  const line = [];
  for (let i = 0; i <= 100; i++) line.push(i * 3.33333, 10 + i * 0.00001);
  assert.deepEqual(I.simplify(line), [0, 10, 333.3, 10]);
  const corner = [0, 0, 5, 0, 10, 0, 10, 5, 10, 10];
  assert.deepEqual(I.simplify(corner), [0, 0, 10, 0, 10, 10]);
  assert.deepEqual(I.simplify([1.23, 4.56]), [1.2, 4.6]);
});

test('a path for a dot, a line and a curve', () => {
  assert.equal(I.path([5, 6]), 'M5 6h0.01');
  assert.equal(I.path([0, 0, 10, 0]), 'M0 0L10 0');
  assert.equal(I.path([0, 0, 10, 0, 10, 10]), 'M0 0Q10 0 10 5L10 10');
  assert.equal(I.path([]), '');
});

test('the eraser touches a stroke within its reach, the stroke\'s width counted', () => {
  const s = { t: 'pen', c: '#000000', w: 4, p: [0, 0, 100, 0] };
  assert.ok(I.hits(s, 50, 5, 3)); // 5 away; reach 3 + 2
  assert.ok(!I.hits(s, 50, 6, 3));
  assert.ok(I.hits(s, 104, 0, 3));
  assert.ok(!I.hits(s, 106, 0, 3));
  assert.ok(I.hits({ ...s, p: [10, 10] }, 13, 14, 3));
});

test('every edit undoes to exactly what was there, in order', () => {
  const a = { t: 'pen', c: '#111111', w: 2, p: [1, 1] }, b = { ...a, p: [2, 2] }, c = { ...a, p: [3, 3] }, d = { ...a, p: [4, 4] };
  const pages = { 1: [a, b, c] };
  const before = JSON.stringify(pages);
  const erase = { n: '1', add: [], del: [[0, a], [2, c]] };
  I.apply(pages, erase);
  assert.deepEqual(pages, { 1: [b] });
  I.revert(pages, erase);
  assert.equal(JSON.stringify(pages), before);
  const draw = { n: '2', add: [d], del: [] };
  I.apply(pages, draw);
  assert.deepEqual(pages[2], [d]);
  I.revert(pages, draw);
  assert.ok(!('2' in pages), 'an emptied page is dropped');
  const clear = { n: '1', add: [], del: pages[1].map((s, i) => [i, s]) };
  I.apply(pages, clear);
  assert.deepEqual(pages, {});
  I.revert(pages, clear);
  assert.equal(JSON.stringify(pages), before);
});

test('clean keeps only well-formed strokes and pages', () => {
  const ok = { t: 'hl', c: '#FDE047', w: 14, p: [1.234, 2, 3, 4] };
  const got = I.clean({ 1: [ok, { ...ok, t: 'marker' }, { ...ok, c: 'red' }, { ...ok, w: 500 }, { ...ok, p: [1, 2, 3] }, { ...ok, p: [1, '2'] }, { ...ok, p: [1, 1e9] }, null],
    0: [ok], '01': [ok], x: [ok], 2: 'no', 3: [] });
  assert.deepEqual(got, { 1: [{ t: 'hl', c: '#fde047', w: 14, p: [1.2, 2, 3, 4] }] });
  assert.deepEqual(I.clean(null), {});
  assert.deepEqual(I.clean([ok]), {});
});

test('an exported file reads back; an import adds what is new and refuses anything else', () => {
  const s = { t: 'pen', c: '#e11d48', w: 3, p: [10, 10, 20, 20] };
  const t = { ...s, c: '#2563eb' };
  const file = I.exportFile('4567', { 1: [s] }, new Date('2026-10-15T12:00:00Z'));
  assert.deepEqual(JSON.parse(file), { format: 'glaze-annotations', version: 1, file: '4567', exported: '2026-10-15T12:00:00.000Z', pages: { 1: [s] } });
  assert.deepEqual(I.importFile(file, { 1: [s] }), { pages: { 1: [s] }, added: 0 });
  assert.deepEqual(I.importFile(file, { 1: [t], 3: [t] }), { pages: { 1: [t, s], 3: [t] }, added: 1 });
  for (const bad of ['nope', '{}', JSON.stringify({ format: 'glaze-annotations', version: 2, pages: {} }), JSON.stringify({ pages: { 1: [s] } })]) assert.equal(I.importFile(bad, {}), null, bad);
});
