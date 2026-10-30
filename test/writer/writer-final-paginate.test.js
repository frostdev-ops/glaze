// Glaze Writer's page plan (lib/writer-paginate.js plan) on hostile page setups, a heading before a table, and page
// breaks in a row. The ordinary cases are test/writer-paper-paginate.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const P = require('../lib/writer-paginate.js');

const LH = 36.8, geo = { body: 864, stride: 1082.4, notes: [], sep: 18.4 }; // 23 double-spaced lines a page
const text = (n, o = {}) => ({ kind: 'text', lines: Array.from({ length: n }, () => ({ h: o.h || LH, notes: [] })), after: 0, before: o.before || 0, keepNext: !!o.keepNext, widow: o.widow });
const brk = { kind: 'break', lines: [], after: 0 };
const breaks = (blocks, g = geo) => P.plan(blocks, g).breaks.map(({ b, l }) => [b, l]);

// plan() in a child with a time limit, so a plan that never ends fails the test instead of hanging the suite.
const bounded = (body) => {
  const lib = JSON.stringify(path.join(__dirname, '..', 'lib'));
  const r = spawnSync(process.execPath, ['-e', `const P = require(${lib} + '/writer-paginate.js'), ST = require(${lib} + '/writer-styles.js');\n${body}`], { timeout: 5000, encoding: 'utf8' });
  assert.equal(r.signal, null, 'plan() finishes');
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
};

test('a footnote whose separator and first line are taller than the page\'s text area still ends the plan', () => {
  // An imported Word file: 72 pt text on a 3 in page with 1 in margins (a 1 in text area under a 72 pt separator line).
  const out = bounded(`
    const f = ST.look(ST.get('mla9'), { page: [8.5, 3], margins: [1, 1, 1, 1], size: 72 }), g = ST.geometry(f);
    const geo = { body: g.body, stride: g.height + 24, notes: [20, 400], sep: ST.lineHeight(f, { line: 1 }), noteLine: ST.lineHeight(f, { size: f.notes.size, line: f.notes.line }) };
    const p = P.plan([{ kind: 'text', lines: [{ h: 90, slack: 0, notes: [0] }, { h: 90, slack: 0, notes: [1] }], after: 0, before: 0 }], geo);
    console.log(JSON.stringify({ sep: geo.sep, body: geo.body, pages: p.pages.length, notes: p.pages.map((x) => x.fragments.reduce((n, fr) => n + fr.height, 0)) }));`);
  assert.ok(out.sep > out.body, 'the setup really leaves no room for a note line under the separator');
  assert.ok(out.pages < 60, `a bounded number of pages (${out.pages})`);
  const placed = out.notes.reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(placed - 420) < 0.01, `every note line is placed (${placed} of 420)`);
});

test('no page geometry makes the plan run on', () => {
  const out = bounded(`
    const L = (h, notes = []) => ({ h, slack: 0, notes });
    const shapes = [
      { body: 1, stride: 2, notes: [500], sep: 50, noteLine: 15 },
      { body: 10, stride: 20, notes: [500, 500], sep: 0, noteLine: 40 },
      { body: 0, stride: 10, notes: [30], sep: 5, noteLine: 15 },
      { body: 100, stride: 120, notes: [1000], sep: 99.9, noteLine: 0.2 },
    ];
    const blocks = [{ kind: 'text', lines: [L(30, [0]), L(0, [1]), L(500)], after: 0, before: 0, keepNext: true }, { kind: 'table', lines: [L(300, [0])], after: 0 }, { kind: 'break', lines: [] }, { kind: 'break', lines: [] }, { kind: 'text', lines: [L(30), L(30)], after: 0, before: 40, keepLines: true }];
    console.log(JSON.stringify(shapes.map((g) => P.plan(blocks, g).pages.length)));`);
  for (const n of out) assert.ok(n > 0 && n < 1e5, `pages ${n}`);
});

test('a heading kept with the next block stays with a table\'s first row', () => {
  const table = { kind: 'table', lines: [{ h: 60, notes: [] }, { h: 60, notes: [] }], after: 0 };
  const g = { body: 864, stride: 1080, notes: [], sep: 0, noteLine: 15 };
  // 27 lines of 30 px and a 30 px heading leave 24 px: the table's 60 px first row goes, and the heading with it.
  assert.deepEqual(breaks([text(27, { h: 30, widow: false }), text(1, { h: 30, keepNext: true }), table], g), [[1, 0]]);
  assert.deepEqual(breaks([text(25, { h: 30, widow: false }), text(1, { h: 30, keepNext: true }), table], g), [[2, 1]], 'room for the first row: the heading stays, the second row goes');
});

test('page breaks in a row leave an empty page between them, as Word does', () => {
  const p = P.plan([text(3), brk, brk, text(3)], geo);
  assert.equal(p.pages.length, 3);
  assert.deepEqual(p.breaks.map(({ b, l }) => [b, l]), [[3, 0], [3, 0]]);
  assert.equal(p.breaks[0].gap.toFixed(3), (geo.stride - 3 * LH).toFixed(3));
  assert.equal(p.breaks[1].gap.toFixed(3), geo.stride.toFixed(3), 'the empty page is a whole stride');
  const spaced = P.plan([text(3), brk, brk, brk, text(3, { before: 20 })], geo);
  assert.equal(spaced.pages.length, 4);
  assert.deepEqual(spaced.breaks.map((x) => x.gap.toFixed(3)), [(geo.stride - 3 * LH).toFixed(3), geo.stride.toFixed(3), (geo.stride - 20).toFixed(3)], 'space before is dropped once, at the page the paragraph starts');
  assert.equal(P.plan([text(3), brk, text(1), brk, text(3)], geo).pages.length, 3, 'an empty paragraph between two breaks has its own page');
  assert.equal(P.plan([text(23), brk, brk, text(3)], geo).pages.length, 3, 'a full page, then two breaks: one empty page');
  assert.equal(P.plan([brk, text(3)], geo).pages.length, 1, 'a break before the first paragraph adds no page');
  assert.equal(P.plan([text(23), brk, text(3)], geo).pages.length, 2, 'a break after a page filled exactly adds no page');
});
