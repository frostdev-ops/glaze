// The pages panel's reducer (lib/pdf-pages.js): what the student does to the tiles (move, rotate, delete, a blank page,
// another PDF's pages) → one list of page operations for lib/pdf-doc.js bake, which lays them out (layout) and hands
// pdf.js's extractPages its arguments (entries). Pure: no pdf.js here. The panel on a page is scripts/pdf-check.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../lib/pdf-pages.js');
const D = require('../lib/pdf-doc.js');

const at = (pages) => pages.map((p) => `${p.source}:${p.page}${p.turn ? `@${p.turn}` : ''}`);
// What the tiles say the result is, as layout writes it.
const want = (s) => s.tiles.map((x) => `${x.source}:${x.source === 'blank' ? 0 : x.page}${x.turn ? `@${x.turn}` : ''}`);
const run = (s) => D.layout(s.count, R.toOps(s), s.merges.map((m) => m.pages));

test('a new state is the document as it is, and needs no operations', () => {
  const s = R.start(3);
  assert.deepEqual(at(s.tiles), ['0:0', '0:1', '0:2']);
  assert.deepEqual(R.toOps(s), []);
  assert.equal(R.changed(s), false);
  assert.ok(new Set(s.tiles.map((x) => x.id)).size === 3, 'each tile its own id');
});

test('move, rotate, delete, a blank page and a merged PDF: the operations lay the pages out as the tiles show', () => {
  let s = R.start(4);
  s = R.reduce(s, { type: 'move', from: 3, to: 0 });            // 3 0 1 2
  s = R.reduce(s, { type: 'rotate', at: [1], by: 90 });          // 0 turned
  s = R.reduce(s, { type: 'rotate', at: [1, 2], by: 90 });       // 0 by 180, 1 by 90
  s = R.reduce(s, { type: 'remove', at: [3] });                  // 3 0 1
  s = R.reduce(s, { type: 'blank', at: 1 });                     // 3 b 0 1
  s = R.reduce(s, { type: 'merge', at: 2, pages: 2, bytes: new Uint8Array([1]), name: 'Other.pdf' }); // 3 b m0 m1 0 1
  s = R.reduce(s, { type: 'rotate', at: [3], by: -90 });         // m1 by 270
  assert.deepEqual(want(s), ['0:3', 'blank:0', '1:0', '1:1@270', '0:0@180', '0:1@90']);
  assert.deepEqual(at(run(s)), want(s));
  assert.equal(R.changed(s), true);
  const ops = R.toOps(s);
  assert.equal(ops.filter((o) => o.op === 'merge').length, 1);
  assert.ok(ops.find((o) => o.op === 'merge').bytes instanceof Uint8Array);
});

test('every order of moves and rotations comes out as the tiles show (random runs)', () => {
  let seed = 11;
  const rnd = (n) => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) % n);
  for (let k = 0; k < 300; k++) {
    let s = R.start(1 + rnd(6));
    for (let i = 0; i < 1 + rnd(8); i++) {
      const n = s.tiles.length, pick = rnd(6);
      if (pick === 0 && n > 1) s = R.reduce(s, { type: 'move', from: rnd(n), to: rnd(n) });
      else if (pick === 1) s = R.reduce(s, { type: 'rotate', at: [rnd(n)], by: [90, -90, 180][rnd(3)] });
      else if (pick === 2 && n > 1) s = R.reduce(s, { type: 'remove', at: [rnd(n)] });
      else if (pick === 3) s = R.reduce(s, { type: 'blank', at: rnd(n + 1) });
      else if (pick === 4) s = R.reduce(s, { type: 'merge', at: rnd(n + 1), pages: 1 + rnd(3), bytes: new Uint8Array(1) });
    }
    assert.deepEqual(at(run(s)), want(s), JSON.stringify(R.toOps(s).map(({ bytes, ...o }) => o)));
  }
});

test('the last page cannot go; moves and rotations out of range change nothing', () => {
  const s = R.start(2);
  const one = R.reduce(s, { type: 'remove', at: [0] });
  assert.equal(one.tiles.length, 1);
  assert.equal(R.reduce(one, { type: 'remove', at: [0] }), one, 'a PDF keeps one page');
  assert.equal(R.reduce(s, { type: 'move', from: 0, to: 9 }), s);
  assert.equal(R.reduce(s, { type: 'rotate', at: [5], by: 90 }), s);
  assert.equal(R.reduce(s, { type: 'rotate', at: [0], by: 45 }), s);
  assert.equal(R.reduce(s, { type: 'nothing' }), s);
});

test('limits: past 500 pages a merge is refused; the merged bytes count against 50 MB', () => {
  const s = R.start(499);
  assert.throws(() => R.reduce(s, { type: 'merge', at: 0, pages: 2, bytes: new Uint8Array(1) }), (e) => e.name === 'PdfTooManyPagesError');
  assert.throws(() => R.reduce(R.start(1, { bytes: 49e6 }), { type: 'merge', at: 0, pages: 1, bytes: { length: 2e6 } }), (e) => e.name === 'PdfTooLargeError');
  assert.equal(R.reduce(R.start(1, { bytes: 10e6 }), { type: 'merge', at: 1, pages: 1, bytes: { length: 2e6 } }).tiles.length, 2);
});

test('entries: the pages laid out → extractPages\'s arguments, each source page once per entry, its slot and turn', () => {
  // 0:2, blank, 1:0@90, 0:0@180, 0:2 again (a second entry of the document).
  const pages = [{ source: 0, page: 2, turn: 0 }, { source: 'blank', page: 0, turn: 0 }, { source: 1, page: 0, turn: 90 }, { source: 0, page: 0, turn: 180 }, { source: 0, page: 2, turn: 0 }];
  assert.deepEqual(D.entries(pages), [
    { source: 0, includePages: [0, 2], pageIndices: [3, 0], rotations: { 0: 180, 2: 0 } },
    { source: 'blank', includePages: [0], pageIndices: [1], rotations: { 0: 0 } },
    { source: 1, includePages: [0], pageIndices: [2], rotations: { 0: 90 } },
    { source: 0, includePages: [2], pageIndices: [4], rotations: { 2: 0 } },
  ]);
});

test('the reducer\'s operations through layout and entries: the panel\'s Done in one extractPages call', () => {
  let s = R.start(3);
  s = R.reduce(s, { type: 'merge', at: 3, pages: 1, bytes: new Uint8Array(1) });
  s = R.reduce(s, { type: 'move', from: 3, to: 0 });
  s = R.reduce(s, { type: 'rotate', at: [1], by: 90 });
  s = R.reduce(s, { type: 'remove', at: [2] });
  // m0, 0:0@90, 0:2
  const e = D.entries(run(s));
  assert.deepEqual(e, [{ source: 1, includePages: [0], pageIndices: [0], rotations: { 0: 0 } }, { source: 0, includePages: [0, 2], pageIndices: [1, 2], rotations: { 0: 90, 2: 0 } }]);
});

test('Done applies deletions before additions at the 500-page limit', () => {
  for (const type of ['blank', 'merge']) {
    let s = R.reduce(R.start(500), { type: 'remove', at: [1] });
    s = R.reduce(s, type === 'blank' ? { type } : { type, pages: 1, bytes: new Uint8Array(1) });
    assert.equal(s.tiles.length, 500);
    assert.deepEqual(at(run(s)), want(s), type);
  }
  let s = R.reduce(R.start(1), { type: 'merge', pages: 499, bytes: new Uint8Array(1) });
  s = R.reduce(s, { type: 'remove', at: Array.from({ length: 499 }, (_, i) => i + 1) });
  s = R.reduce(s, { type: 'merge', pages: 499, bytes: new Uint8Array(1) });
  assert.deepEqual(at(run(s)), want(s), 'deleted pages from an earlier merge do not occupy capacity');
});
