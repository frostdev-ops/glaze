// Glaze Writer's pages laid out in slices (lib/writer-paginate.js): what a plan over the blocks measured so far settles
// (settled: the breaks and pages later blocks can't move, so a slice may draw them), a line's first character found by
// halving its text node (firstOn), and where a textblock's DOM text nodes and atoms start, read from ProseMirror's own
// view of the block (startsOf). The slices in the editor, and their pages against a whole layout's, are
// scripts/writer-huge-check.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../lib/writer-paginate.js');

const LH = 36.8, geo = { body: 864, stride: 1082.4, sep: 18.4, noteLine: 18.4 }; // 23 double-spaced lines a page
// A seeded stream (mulberry32), so a failure names the paper that made it.
const stream = (seed) => () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
// A paper of n blocks: paragraphs of 1–30 lines (some lines with note marks), headings kept with the next, page breaks,
// a rule now and then; and its notes' heights.
const paper = (seed, n = 60) => {
  const r = stream(seed), blocks = [], notes = [];
  for (let i = 0; i < n; i++) {
    const x = r();
    if (x < 0.06) { blocks.push({ kind: 'break', lines: [], after: 0 }); continue; }
    if (x < 0.1) { blocks.push({ kind: 'atom', lines: [{ h: 20 + r() * 300, notes: [] }], after: 0 }); continue; }
    const heading = x < 0.25, count = heading ? 1 : 1 + Math.floor(r() * 30);
    const lines = Array.from({ length: count }, () => {
      const marks = r() < 0.08 ? [notes.push(18.4 * (1 + Math.floor(r() * 30))) - 1] : [];
      return { h: LH, notes: marks };
    });
    blocks.push({ kind: 'text', lines, after: heading ? 0 : r() < 0.5 ? 12 : 0, before: heading ? 24 : 0, keepNext: heading, widow: r() < 0.1 ? false : undefined });
  }
  return { blocks, geo: { ...geo, notes } };
};

test('settled: what a plan over the first k blocks settles is the whole plan\'s, for every k of 40 papers', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const { blocks, geo: g } = paper(seed), whole = P.plan(blocks, g);
    for (let k = 1; k <= blocks.length; k++) {
      const s = P.settled(P.plan(blocks.slice(0, k), g), k);
      assert.deepEqual(s.breaks, whole.breaks.filter((br) => br.b < k - 1), `paper ${seed}, ${k} blocks: its breaks`);
      assert.equal(s.pages.length, s.breaks.length + 1, `paper ${seed}, ${k} blocks: a page after each break`);
      // Every settled page but the last, still filling, holds what the whole plan's does, notes and their parts too.
      assert.deepEqual(s.pages.slice(0, -1), whole.pages.slice(0, s.pages.length - 1), `paper ${seed}, ${k} blocks: its pages`);
    }
  }
});

test('settled: a heading at the end of the blocks so far keeps its break open (its next paragraph decides it)', () => {
  const text = (n, o = {}) => ({ kind: 'text', lines: Array.from({ length: n }, () => ({ h: LH, notes: [] })), after: 0, ...o });
  const blocks = [text(21), text(1, { keepNext: true }), text(4)], g = { ...geo, notes: [] };
  assert.deepEqual(P.plan(blocks, g).breaks.map(({ b, l }) => [b, l]), [[1, 0]], 'the whole plan moves the heading to the next page');
  assert.deepEqual(P.plan(blocks.slice(0, 2), g).breaks, [], 'two blocks alone: it seems to fit');
  assert.deepEqual(P.settled(P.plan(blocks.slice(0, 2), g), 2).breaks, [], 'so nothing about it is settled yet');
  assert.deepEqual(P.settled(P.plan(blocks, g), 3).breaks.map(({ b, l }) => [b, l]), [[1, 0]], 'with its paragraph measured, it is');
});

test('firstOn: the first offset whose top is at or below a line\'s top, 2 px either way', () => {
  const tops = [10, 10, 10, 40, 40, 40, 40, 70, 70]; // three lines of a text node's characters
  const top = (o) => tops[o];
  assert.equal(P.firstOn(0, tops.length, top, 40), 3);
  assert.equal(P.firstOn(0, tops.length, top, 70), 7);
  assert.equal(P.firstOn(0, tops.length, top, 41.5), 3, 'a line\'s fragments can sit a pixel or so apart');
  assert.equal(P.firstOn(0, tops.length, top, 10), 0);
  assert.equal(P.firstOn(0, tops.length, top, 100), tops.length, 'none on or below it: the end');
  assert.equal(P.firstOn(4, 4, top, 40), 4, 'an empty range');
  let probes = 0;
  P.firstOn(0, 1 << 20, (o) => { probes++; return o < 700000 ? 0 : 50; }, 50);
  assert.ok(probes <= 21, `halving: ${probes} probes over a million offsets`);
});

test('startsOf: each text node and atom of a textblock where ProseMirror\'s view puts it, marks and widgets in between', () => {
  const dom = (name) => ({ name });
  const text = (s, wrap = null) => { const n = dom(`"${s}"`); return { node: { isText: true }, nodeDOM: n, dom: wrap || n, size: s.length, children: [] }; };
  const mark = (...children) => ({ mark: {}, dom: dom('strong'), children, get size() { return children.reduce((a, c) => a + c.size, 0); } });
  const atom = (name) => ({ node: { isText: false, type: { name } }, dom: dom(`${name} wrapper`), nodeDOM: dom(name), size: 1, children: [] });
  const widget = () => ({ widget: {}, dom: dom('gap'), size: 0, children: [] });
  const a = text('Plain '), b = text('bold'), c = text(' and'), d = text('\t', dom('tab stop')), e = text('after.'), note = atom('footnote_ref'), br = atom('hard_break');
  const hack = { dom: dom('trailing br'), size: 0, children: [] };
  const node = { type: { name: 'paragraph' } }, el = dom('p');
  el.pmViewDesc = { node, dom: el, children: [a, mark(b, widget(), c), note, d, widget(), e, br, hack] };
  const at = P.startsOf(el, node);
  assert.deepEqual([a, b, c, d, e].map((x) => at.get(x.nodeDOM)), [0, 6, 10, 15, 16], 'text: by the sizes before it');
  assert.equal(at.get(d.dom), undefined, 'a decorated text node by its own DOM text, not its wrapper');
  assert.deepEqual([at.get(note.nodeDOM), at.get(note.dom)], [14, 14], 'an atom by its element and its wrapper');
  assert.equal(at.get(br.nodeDOM), 22);
  assert.equal(at.get(hack.dom), 23, 'ProseMirror\'s own last break: the end');
  assert.equal([...at.keys()].some((k) => k.name === 'gap'), false, 'widgets hold no position');
  // A node view wrapped in an outer decoration: its own DOM's parent holds the desc.
  const inner = dom('p'), outer = dom('span');
  inner.parentNode = outer;
  outer.pmViewDesc = { node, dom: outer, nodeDOM: inner, children: [text('x')] };
  assert.equal(P.startsOf(inner, node).size, 1);
  assert.equal(P.startsOf(dom('p'), node), null, 'no view of it: null, so the editor asks ProseMirror instead');
  assert.equal(P.startsOf(el, { type: { name: 'heading' } }), null, 'a view of another node: null');
});

test('measure: a bidi line uses the visual coordinate lookup rather than its first logical character', () => {
  const fs = require('node:fs'), vm = require('node:vm');
  // A two-line text node. Its second line's left edge is logical offset 8, while its first logical character is 5.
  // This models the browser's Range and hit-test results, independently of the line-start implementation.
  const node = { content: { size: 10 }, nodeSize: 12, attrs: {}, textContent: 'שלום עולם!' };
  const dom = { nodeType: 1, querySelectorAll: () => [], querySelector: () => null, getBoundingClientRect: () => ({ height: 80 }) };
  const text = { nodeType: 3, nodeValue: node.textContent, parentNode: dom };
  const rect = (top) => ({ top, bottom: top + 20, height: 20, left: 0 });
  dom.pmViewDesc = { node, dom, children: [{ node: { isText: true }, nodeDOM: text, size: 10 }] };
  let offset = 0, hits = 0;
  const ctx = vm.createContext({
    getComputedStyle: () => ({ direction: 'ltr' }),
    NodeFilter: { SHOW_TEXT: 4, SHOW_ELEMENT: 1 },
    document: {
      createTreeWalker: () => { let done = false; return { nextNode: () => done ? null : (done = true, text) }; },
      createRange: () => ({ selectNodeContents() {}, getClientRects: () => [rect(0), rect(40)], setStart: (_, at) => { offset = at; }, setEnd() {}, getBoundingClientRect: () => rect(offset < 5 ? 0 : 40) }),
    },
    GZ_WRITER_STYLES: { blockBox: () => ({ line: 40, after: 0, before: 0 }) },
  });
  const source = fs.readFileSync(require.resolve('../lib/writer-paginate.js'), 'utf8').replace('return { plan, settled,', 'return { measure, plan, settled,');
  vm.runInContext(source, ctx);
  const view = { nodeDOM: () => dom, posAtCoords: () => { hits++; return { pos: 9 }; } };
  const lines = ctx.GZ_WRITER_PAGINATE.measure(view, { node, pos: 0, kind: 'text' }, {}, 1).lines;
  assert.equal(lines[1].at, 8, 'the second line starts at the visual left edge, as posAtCoords specifies');
  assert.equal(hits, 1);
});
