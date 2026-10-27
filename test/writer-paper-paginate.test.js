// Glaze Writer's page plan (lib/writer-paginate.js plan): where pages end, as Word ends them by default: a line fits while
// its bottom is inside the text area, 2-line widow and orphan control, headings kept with the next paragraph, page breaks,
// and footnotes taking room at the foot of their page. The editor's measuring and the real pages are
// scripts/writer-paper-check.js; Word's own pages, scripts/writer-word-fidelity.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../lib/writer-paginate.js');

const LH = 36.8, geo = { body: 864, stride: 1082.4, notes: [], sep: 18.4 }; // 23 double-spaced lines a page
const text = (n, o = {}) => ({ kind: 'text', lines: Array.from({ length: n }, (_, i) => ({ h: LH, notes: o.notes?.[i] || [] })), after: o.after || 0, keepNext: !!o.keepNext });
const breaks = (blocks, g = geo) => P.plan(blocks, g).breaks.map(({ b, l }) => [b, l]);

test('a page holds 23 double-spaced lines; the 24th starts the next page at its top', () => {
  const p = P.plan([text(30)], geo);
  assert.deepEqual(p.breaks.map(({ b, l }) => [b, l]), [[0, 23]]);
  assert.equal(p.breaks[0].gap.toFixed(3), (geo.stride - 23 * LH).toFixed(3), 'the gap takes the flow to the next page\'s top');
  assert.equal(p.pages.length, 2);
});

test('orphans: a paragraph\'s first line never sits alone at a page\'s foot', () => {
  assert.deepEqual(breaks([text(22), text(5)]), [[1, 0]], 'one line of room: the whole paragraph moves');
  assert.deepEqual(breaks([text(21), text(5)]), [[1, 2]], 'two lines of room: two stay');
});

test('widows: a paragraph\'s last line never sits alone at a page\'s top', () => {
  assert.deepEqual(breaks([text(20), text(4)]), [[1, 2]], 'three fit, one would be left: two stay, two go');
  assert.deepEqual(breaks([text(21), text(3)]), [[1, 0]], 'two fit of three: one would be a widow, then one an orphan: all go');
  assert.deepEqual(breaks([text(21), text(2)]), [], 'a two-line paragraph that fits stays');
  assert.deepEqual(breaks([text(22), text(2)]), [[1, 0]], 'one fits of two: both go');
});

test('a single line goes where it fits, and a block taller than a page still flows', () => {
  assert.deepEqual(breaks([text(22), text(1), text(1)]), [[2, 0]]);
  assert.deepEqual(breaks([text(50)]), [[0, 23], [0, 46]]);
  assert.deepEqual(breaks([{ kind: 'atom', lines: [{ h: 2000, notes: [] }], after: 0 }]), [], 'nothing fits even on an empty page: it runs over');
});

test('a heading stays with its next paragraph\'s first two lines', () => {
  assert.deepEqual(breaks([text(21), text(1, { keepNext: true }), text(4)]), [[1, 0]], 'heading on line 22, one line of room left: not enough for two of the next');
  assert.deepEqual(breaks([text(20), text(1, { keepNext: true }), text(4)]), [[2, 2]], 'room for the heading and two lines: they stay together');
  assert.deepEqual(breaks([text(22), text(1, { keepNext: true }), text(1)]), [[1, 0]]);
});

test('a page break starts the next block on a new page, unless it is already at a page\'s top', () => {
  const brk = { kind: 'break', lines: [], after: 0 };
  assert.deepEqual(breaks([text(5), brk, text(3)]), [[2, 0]]);
  assert.deepEqual(breaks([text(23), brk, text(3)]), [[2, 0]], 'the page filled exactly: the natural break is the page break');
  assert.equal(P.plan([text(23), brk, text(3)], geo).pages.length, 2, 'no blank page between');
  assert.equal(P.plan([text(23), text(1), brk, text(3)], geo).pages.length, 3);
});

test('space after a paragraph counts for the next, not for whether its own last line fits', () => {
  assert.deepEqual(breaks([text(23, { after: 16 }), text(1)]), [[1, 0]]);
  assert.deepEqual(breaks([text(10, { after: 400 }), text(12)]), [[1, 2]], '10 lines + 400px leave room for 2 of the next');
});

test('footnotes take room at the foot of the page their mark is on, with the separator once', () => {
  const g = { ...geo, notes: [40, 40] };
  const p = P.plan([text(30, { notes: { 2: [0], 4: [1] } })], g);
  // 864 - 18.4 (separator) - 80 (notes) = 765.6 → 20 lines.
  assert.deepEqual(p.breaks.map(({ b, l }) => [b, l]), [[0, 20]]);
  assert.deepEqual(p.pages.map((x) => x.notes), [[0, 1], []]);
  const late = P.plan([text(30, { notes: { 21: [0] } })], { ...geo, notes: [60] });
  assert.deepEqual(late.breaks.map(({ b, l }) => [b, l]), [[0, 21]], 'a mark whose note no longer fits moves to the next page with its line');
  assert.deepEqual(late.pages.map((x) => x.notes), [[], [0]]);
});
