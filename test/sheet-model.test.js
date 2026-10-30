// The spreadsheet model (lib/sheet-model.js): addresses to XFD1048576, the workbook/sheet/cell shapes, the operations
// the grid and its undo stack drive (each returns its inverse), the caps, Excel's serial dates and typed input.
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../lib/sheet-model.js');

test('columns and cells are named to XFD1048576, any case, $ allowed', () => {
  for (const [i, n] of [[0, 'A'], [25, 'Z'], [26, 'AA'], [51, 'AZ'], [701, 'ZZ'], [702, 'AAA'], [16383, 'XFD']]) {
    assert.equal(M.columnName(i), n);
    assert.equal(M.columnIndex(n), i);
    assert.equal(M.columnIndex(n.toLowerCase()), i);
  }
  assert.equal(M.columnIndex('XFE'), -1);
  assert.equal(M.columnIndex(''), -1);
  assert.equal(M.columnIndex('A1'), -1);
  assert.equal(M.cellName(0, 0), 'A1');
  assert.equal(M.cellName(1048575, 16383), 'XFD1048576');
  assert.deepEqual(M.cellPosition('A1'), [0, 0]);
  assert.deepEqual(M.cellPosition('$B$3'), [2, 1]);
  assert.deepEqual(M.cellPosition('b$3'), [2, 1]);
  assert.deepEqual(M.cellPosition('xfd1048576'), [1048575, 16383]);
  for (const bad of ['XFE1', 'A1048577', 'A0', 'A', '1', 'A1B', '$$A1', 'A01x', '', null]) assert.equal(M.cellPosition(bad), null, String(bad));
  assert.equal(M.rangeName(0, 0, 2, 1), 'A1:B3');
  assert.equal(M.rangeName(4, 2, 4, 2), 'C5');
  assert.deepEqual(M.rangePosition('B3:A1'), { r0: 0, c0: 0, r1: 2, c1: 1 }, 'corners in any order');
  assert.deepEqual(M.rangePosition('C5'), { r0: 4, c0: 2, r1: 4, c1: 2 });
  assert.equal(M.rangePosition('A1:'), null);
});

test('a new workbook has one sheet and the shared General style', () => {
  const wb = M.workbook();
  assert.equal(wb.v, 1);
  assert.equal(wb.date1904, false);
  assert.equal(wb.active, 0);
  assert.deepEqual(wb.styles, [{}]);
  assert.deepEqual(wb.names, []);
  assert.deepEqual(wb.keep, { parts: {} });
  assert.equal(wb.sheets.length, 1);
  const sh = wb.sheets[0];
  assert.equal(sh.name, 'Sheet1');
  assert.ok(sh.rows instanceof Map && sh.colW instanceof Map && sh.rowH instanceof Map);
  assert.ok(sh.hidden.rows instanceof Set && sh.hidden.cols instanceof Set);
  assert.deepEqual([sh.merges, sh.freeze, sh.filter, sh.charts, sh.keep], [[], null, null, [], {}]);
  assert.equal(M.workbook({ date1904: true }).date1904, true);
  assert.equal(M.getSheet(wb, sh.id), sh);
  assert.equal(M.getSheet(wb, 'sheet1'), sh, 'by name, any case');
  assert.equal(M.getSheet(wb, 'Nope'), null);
});

test('set and clear return their inverse; undo restores the workbook exactly', () => {
  const wb = M.workbook();
  const id = wb.sheets[0].id;
  const before = structuredClone(wb);
  const r1 = M.apply(wb, { op: 'set', sheet: id, r: 2, c: 1, cell: { t: 'n', v: 5 } });
  assert.deepEqual(M.cell(wb.sheets[0], 2, 1), { t: 'n', v: 5 });
  assert.deepEqual(r1.touched, [[id, 2, 1]]);
  assert.equal(r1.rebuild, false);
  const mid = structuredClone(wb);
  const r2 = M.apply(wb, { op: 'set', sheet: id, r: 2, c: 1, cell: null });
  assert.equal(M.cell(wb.sheets[0], 2, 1), null);
  assert.equal(wb.sheets[0].rows.size, 0, 'an emptied row is dropped');
  M.apply(wb, r2.inverse);
  assert.deepEqual(wb, mid);
  M.apply(wb, r1.inverse);
  assert.deepEqual(wb, before);
});

test('the stored cell is a copy: a later change to the op does not reach the sheet', () => {
  const wb = M.workbook();
  const cell = { t: 's', v: 'a' };
  M.apply(wb, { op: 'set', sheet: wb.sheets[0].id, r: 0, c: 0, cell });
  cell.v = 'b';
  assert.equal(M.cell(wb.sheets[0], 0, 0).v, 'a');
});

test('a batch of cells undoes to the original even when a cell is written twice', () => {
  const wb = M.workbook();
  const id = wb.sheets[0].id;
  M.apply(wb, { op: 'set', sheet: id, r: 0, c: 0, cell: { t: 'n', v: 1 } });
  const before = structuredClone(wb);
  const { inverse, touched } = M.apply(wb, { op: 'cells', sheet: id, cells: [[0, 0, { t: 'n', v: 2 }], [1, 0, { t: 's', v: 'x' }], [0, 0, { t: 'n', v: 3 }]] });
  assert.equal(M.cell(wb.sheets[0], 0, 0).v, 3);
  assert.equal(touched.length, 3);
  M.apply(wb, inverse);
  assert.deepEqual(wb, before);
});

test('out-of-bounds cells and unknown sheets are refused', () => {
  const wb = M.workbook();
  const id = wb.sheets[0].id;
  assert.throws(() => M.apply(wb, { op: 'set', sheet: id, r: 1048576, c: 0, cell: { t: 'n', v: 1 } }), (e) => e.code === 'bounds');
  assert.throws(() => M.apply(wb, { op: 'set', sheet: id, r: 0, c: 16384, cell: { t: 'n', v: 1 } }), (e) => e.code === 'bounds');
  assert.throws(() => M.apply(wb, { op: 'set', sheet: 999, r: 0, c: 0, cell: { t: 'n', v: 1 } }), (e) => e.code === 'sheet');
  assert.throws(() => M.apply(wb, { op: 'nope' }), (e) => e.code === 'op');
});

test('the workbook holds at most 250,000 cells and 100 sheets', () => {
  assert.equal(M.CAP.cells, 250000);
  assert.equal(M.CAP.sheets, 100);
  const wb = M.workbook();
  const sh = wb.sheets[0];
  for (let r = 0; r < 2500; r++) { const row = new Map(); for (let c = 0; c < 100; c++) row.set(c, { t: 'n', v: c }); sh.rows.set(r, row); }
  assert.equal(M.cellCount(wb), 250000);
  assert.throws(() => M.apply(wb, { op: 'set', sheet: sh.id, r: 3000, c: 0, cell: { t: 'n', v: 1 } }), (e) => e.code === 'cap-cells');
  M.apply(wb, { op: 'set', sheet: sh.id, r: 0, c: 0, cell: { t: 'n', v: 9 } }); // replacing a cell adds none
  M.apply(wb, { op: 'set', sheet: sh.id, r: 0, c: 0, cell: null });
  M.apply(wb, { op: 'set', sheet: sh.id, r: 3000, c: 0, cell: { t: 'n', v: 1 } }); // room again
  const big = M.workbook();
  for (let i = 1; i < 100; i++) M.apply(big, { op: 'addSheet', at: i, name: `S${i}` });
  assert.equal(big.sheets.length, 100);
  assert.throws(() => M.apply(big, { op: 'addSheet', at: 100, name: 'One more' }), (e) => e.code === 'cap-sheets');
});

test('sheet names follow Excel: 1-31 characters, none of : \\ / ? * [ ], no edge apostrophe, unique in any case', () => {
  const wb = M.workbook();
  assert.equal(M.validName(wb, 'Budget 2025'), null);
  for (const bad of ['', 'a'.repeat(32), 'a:b', 'a\\b', 'a/b', 'a?b', 'a*b', 'a[b', 'a]b', "'ab", "ab'", 'History', 'SHEET1', 'sheet1']) assert.ok(M.validName(wb, bad), bad);
  assert.equal(M.validName(wb, 'Sheet1', wb.sheets[0].id), null, 'its own name');
  assert.equal(M.validName(wb, "it's"), null);
  assert.throws(() => M.apply(wb, { op: 'rename', sheet: wb.sheets[0].id, name: 'a/b' }), (e) => e.code === 'name');
  assert.equal(M.nextSheetName(wb), 'Sheet2');
});

test('sheets are added, moved, renamed and removed, each undoable', () => {
  const wb = M.workbook();
  const before = structuredClone(wb);
  const add = M.apply(wb, { op: 'addSheet', at: 1, name: 'Data' });
  assert.deepEqual(wb.sheets.map((s) => s.name), ['Sheet1', 'Data']);
  assert.equal(add.rebuild, true);
  const data = wb.sheets[1];
  M.apply(wb, { op: 'set', sheet: data.id, r: 0, c: 0, cell: { t: 'n', v: 7 } });
  const snap = structuredClone(wb);
  const mv = M.apply(wb, { op: 'moveSheet', sheet: data.id, to: 0 });
  assert.deepEqual(wb.sheets.map((s) => s.name), ['Data', 'Sheet1']);
  M.apply(wb, mv.inverse);
  assert.deepEqual(wb, snap);
  const rn = M.apply(wb, { op: 'rename', sheet: data.id, name: 'Figures' });
  assert.equal(data.name, 'Figures');
  M.apply(wb, rn.inverse);
  assert.deepEqual(wb, snap);
  const rm = M.apply(wb, { op: 'removeSheet', sheet: data.id });
  assert.deepEqual(wb.sheets.map((s) => s.name), ['Sheet1']);
  assert.throws(() => M.apply(wb, { op: 'removeSheet', sheet: wb.sheets[0].id }), (e) => e.code === 'last-sheet');
  M.apply(wb, rm.inverse);
  assert.deepEqual(wb, snap);
  M.apply(wb, { op: 'set', sheet: data.id, r: 0, c: 0, cell: null });
  M.apply(wb, add.inverse);
  assert.deepEqual(wb, before);
});

// A sheet with a little of everything a row or column shift moves.
const shaped = () => {
  const wb = M.workbook();
  const sh = wb.sheets[0];
  const set = (r, c, cell) => M.apply(wb, { op: 'set', sheet: sh.id, r, c, cell });
  set(0, 0, { t: 'n', v: 1 }); set(1, 0, { t: 'n', v: 2 }); set(2, 0, { t: 'n', v: 3 }); set(5, 2, { t: 's', v: 'far' });
  set(3, 1, { t: 'n', v: 6, f: 'SUM(A1:A3)' });
  sh.rowH.set(1, 30); sh.rowH.set(4, 40); sh.colW.set(2, 20);
  sh.hidden.rows.add(2); sh.hidden.cols.add(3);
  sh.merges.push({ r0: 1, c0: 0, r1: 2, c1: 1 }, { r0: 6, c0: 0, r1: 6, c1: 3 });
  sh.freeze = { rows: 2, cols: 1 };
  sh.filter = { r0: 0, c0: 0, r1: 5, c1: 2 };
  return wb;
};

test('inserting rows moves cells, heights, hidden rows, merges, freeze and filter below the insert', () => {
  const wb = shaped();
  const sh = wb.sheets[0];
  const before = structuredClone(wb);
  const { inverse, rebuild } = M.apply(wb, { op: 'insert', sheet: sh.id, axis: 'row', at: 1, n: 2 });
  assert.equal(rebuild, true);
  assert.equal(M.cell(sh, 0, 0).v, 1);
  assert.equal(M.cell(sh, 1, 0), null);
  assert.equal(M.cell(sh, 3, 0).v, 2);
  assert.equal(M.cell(sh, 7, 2).v, 'far');
  assert.deepEqual([...sh.rowH], [[3, 30], [6, 40]]);
  assert.deepEqual([...sh.hidden.rows], [4]);
  assert.deepEqual([...sh.hidden.cols], [3], 'columns stay');
  assert.deepEqual(sh.merges, [{ r0: 3, c0: 0, r1: 4, c1: 1 }, { r0: 8, c0: 0, r1: 8, c1: 3 }]);
  assert.deepEqual(sh.freeze, { rows: 4, cols: 1 }, 'an insert inside the frozen rows grows them');
  assert.deepEqual(sh.filter, { r0: 0, c0: 0, r1: 7, c1: 2 }, 'an insert inside the filter range widens it');
  M.apply(wb, inverse);
  assert.deepEqual(wb, before);
});

test('deleting rows drops their cells and shrinks what spans them; undo brings it all back', () => {
  const wb = shaped();
  const sh = wb.sheets[0];
  const before = structuredClone(wb);
  const { inverse } = M.apply(wb, { op: 'delete', sheet: sh.id, axis: 'row', at: 1, n: 2 });
  assert.equal(M.cell(sh, 0, 0).v, 1);
  assert.equal(M.cell(sh, 1, 1).v, 6, 'B4 moved to B2');
  assert.equal(M.cell(sh, 3, 2).v, 'far');
  assert.deepEqual([...sh.rowH], [[2, 40]]);
  assert.deepEqual([...sh.hidden.rows], []);
  assert.deepEqual(sh.merges, [{ r0: 4, c0: 0, r1: 4, c1: 3 }], 'a merge inside the deleted rows goes');
  assert.deepEqual(sh.freeze, { rows: 1, cols: 1 });
  assert.deepEqual(sh.filter, { r0: 0, c0: 0, r1: 3, c1: 2 });
  M.apply(wb, inverse);
  assert.deepEqual(wb, before);
});

test('columns insert and delete the same way', () => {
  const wb = shaped();
  const sh = wb.sheets[0];
  const before = structuredClone(wb);
  const ins = M.apply(wb, { op: 'insert', sheet: sh.id, axis: 'col', at: 1, n: 1 });
  assert.equal(M.cell(sh, 3, 2).v, 6, 'B4 → C4');
  assert.equal(M.cell(sh, 5, 3).v, 'far');
  assert.deepEqual([...sh.colW], [[3, 20]]);
  assert.deepEqual([...sh.hidden.cols], [4]);
  assert.deepEqual(sh.merges, [{ r0: 1, c0: 0, r1: 2, c1: 2 }, { r0: 6, c0: 0, r1: 6, c1: 4 }]);
  assert.deepEqual(sh.freeze, { rows: 2, cols: 1 }, 'an insert at the frozen edge leaves it');
  M.apply(wb, ins.inverse);
  assert.deepEqual(wb, before);
  const del = M.apply(wb, { op: 'delete', sheet: sh.id, axis: 'col', at: 0, n: 2 });
  assert.equal(M.cell(sh, 5, 0).v, 'far');
  assert.equal(sh.rows.has(0), false);
  assert.deepEqual(sh.merges, [{ r0: 6, c0: 0, r1: 6, c1: 1 }]);
  assert.deepEqual(sh.freeze, { rows: 2, cols: 0 });
  M.apply(wb, del.inverse);
  assert.deepEqual(wb, before);
});

test('an insert that would push cells past the last row or column is refused', () => {
  const wb = M.workbook();
  const sh = wb.sheets[0];
  M.apply(wb, { op: 'set', sheet: sh.id, r: 1048575, c: 0, cell: { t: 'n', v: 1 } });
  assert.throws(() => M.apply(wb, { op: 'insert', sheet: sh.id, axis: 'row', at: 0, n: 1 }), (e) => e.code === 'bounds');
  M.apply(wb, { op: 'insert', sheet: sh.id, axis: 'col', at: 0, n: 1 });
  assert.equal(M.cell(sh, 1048575, 1).v, 1);
});

test('structural changes hand every formula and defined name to the shift hook, and undo restores their text', () => {
  const wb = M.workbook();
  const sh = wb.sheets[0];
  M.apply(wb, { op: 'addSheet', at: 1, name: 'Other' });
  const other = wb.sheets[1];
  M.apply(wb, { op: 'set', sheet: sh.id, r: 4, c: 0, cell: { t: 'n', v: 0, f: 'A1+1' } });
  M.apply(wb, { op: 'set', sheet: other.id, r: 0, c: 0, cell: { t: 'n', v: 0, f: 'Sheet1!A5' } });
  wb.names.push({ name: 'Top', ref: 'Sheet1!$A$1' });
  const before = structuredClone(wb);
  const calls = [];
  const hooks = {
    shift: (f, change, host) => { calls.push([f, change, host]); return `${f}'`; },
    rename: (f, from, to) => `${f}{${from}>${to}}`,
  };
  const ins = M.apply(wb, { op: 'insert', sheet: sh.id, axis: 'row', at: 2, n: 1 }, hooks);
  assert.deepEqual(calls, [
    ['A1+1', { sheet: 'Sheet1', axis: 'row', at: 2, n: 1 }, 'Sheet1'],
    ['Sheet1!A5', { sheet: 'Sheet1', axis: 'row', at: 2, n: 1 }, 'Other'],
    ['Sheet1!$A$1', { sheet: 'Sheet1', axis: 'row', at: 2, n: 1 }, null],
  ]);
  assert.equal(M.cell(sh, 5, 0).f, "A1+1'");
  assert.equal(M.cell(other, 0, 0).f, "Sheet1!A5'");
  assert.equal(wb.names[0].ref, "Sheet1!$A$1'");
  M.apply(wb, ins.inverse, hooks);
  assert.deepEqual(wb, before, 'formula text restored exactly, not re-shifted');
  const del = M.apply(wb, { op: 'delete', sheet: sh.id, axis: 'col', at: 3, n: 2 }, hooks);
  assert.deepEqual(calls.at(-1)[1], { sheet: 'Sheet1', axis: 'col', at: 3, n: -2 }, 'a delete is a negative count');
  M.apply(wb, del.inverse, hooks);
  assert.deepEqual(wb, before);
  const rn = M.apply(wb, { op: 'rename', sheet: sh.id, name: 'Main' }, hooks);
  assert.equal(M.cell(other, 0, 0).f, 'Sheet1!A5{Sheet1>Main}');
  assert.equal(wb.names[0].ref, 'Sheet1!$A$1{Sheet1>Main}');
  M.apply(wb, rn.inverse, hooks);
  assert.deepEqual(wb, before);
  const rm = M.apply(wb, { op: 'removeSheet', sheet: sh.id }, hooks);
  assert.equal(M.cell(other, 0, 0).f, 'Sheet1!A5{Sheet1>null}', 'a removed sheet is renamed to nothing: its refs go #REF!');
  M.apply(wb, rm.inverse, hooks);
  assert.deepEqual(wb, before);
});

test('sizes, hiding, sheet properties and defined names are undoable operations', () => {
  const wb = M.workbook();
  const sh = wb.sheets[0];
  const before = structuredClone(wb);
  const ops = [
    { op: 'size', sheet: sh.id, axis: 'col', i: 2, size: 18.5 },
    { op: 'size', sheet: sh.id, axis: 'row', i: 0, size: 30 },
    { op: 'hide', sheet: sh.id, axis: 'row', i: 4, hidden: true },
    { op: 'prop', sheet: sh.id, key: 'freeze', value: { rows: 1, cols: 0 } },
    { op: 'prop', sheet: sh.id, key: 'merges', value: [{ r0: 0, c0: 0, r1: 0, c1: 2 }] },
    { op: 'name', name: 'Rate', ref: '0.05' },
  ];
  const { inverse, rebuild } = M.apply(wb, { op: 'batch', ops });
  assert.equal(rebuild, true, 'a defined name changes what formulas read');
  assert.equal(sh.colW.get(2), 18.5);
  assert.equal(sh.rowH.get(0), 30);
  assert.ok(sh.hidden.rows.has(4));
  assert.deepEqual(sh.freeze, { rows: 1, cols: 0 });
  assert.deepEqual(wb.names, [{ name: 'Rate', ref: '0.05' }]);
  assert.throws(() => M.apply(wb, { op: 'prop', sheet: sh.id, key: 'rows', value: null }), (e) => e.code === 'op');
  M.apply(wb, inverse);
  assert.deepEqual(wb, before);
  assert.equal(M.apply(wb, { op: 'size', sheet: sh.id, axis: 'col', i: 0, size: 9 }).rebuild, false);
});

test('serial dates: 1900 counts the phantom 1900-02-29, 1904 starts at zero', () => {
  assert.equal(M.toSerial(1900, 1, 1), 1);
  assert.equal(M.toSerial(1900, 2, 28), 59);
  assert.equal(M.toSerial(1900, 3, 1), 61);
  assert.equal(M.toSerial(2024, 1, 1), 45292);
  assert.equal(M.toSerial(2025, 1, 1), 45658);
  assert.equal(M.toSerial(2025, 3, 4), 45720);
  assert.equal(M.toSerial(9999, 12, 31), 2958465);
  assert.equal(M.toSerial(1904, 1, 1, true), 0);
  assert.equal(M.toSerial(2025, 3, 4, true), 45720 - 1462);
  assert.equal(M.toSerial(2025, 13, 1), M.toSerial(2026, 1, 1), 'months roll over as DATE does');
  assert.equal(M.toSerial(2025, 3, 0), M.toSerial(2025, 2, 28));
  const d = (n, w) => { const x = M.fromSerial(n, w); return x && [x.y, x.m, x.d, x.dow]; };
  assert.deepEqual(d(1), [1900, 1, 1, 0], 'Excel calls 1900-01-01 a Sunday');
  assert.deepEqual(d(60), [1900, 2, 29, 3]);
  assert.deepEqual(d(61), [1900, 3, 1, 4]);
  assert.deepEqual(d(0), [1900, 1, 0, 6]);
  assert.deepEqual(d(45720), [2025, 3, 4, 2], 'a Tuesday');
  assert.deepEqual(d(2958465), [9999, 12, 31, 5]);
  assert.equal(M.fromSerial(2958466), null);
  assert.equal(M.fromSerial(-1), null);
  assert.deepEqual(d(0, true), [1904, 1, 1, 5]);
  const t = M.fromSerial(45720.5625);
  assert.deepEqual([t.H, t.M, t.S], [13, 30, 0]);
  assert.equal(M.timeSerial(13, 30, 0), 0.5625);
});

test('typed input: numbers, percent, currency, dates, times, booleans, errors, formulas and text', () => {
  const p = (s, o) => M.parseInput(s, { year: 2025, ...o });
  assert.equal(p(''), null);
  assert.deepEqual(p('42'), { t: 'n', v: 42 });
  assert.deepEqual(p(' -3.5 '), { t: 'n', v: -3.5 });
  assert.deepEqual(p('.5'), { t: 'n', v: 0.5 });
  assert.deepEqual(p('1e3'), { t: 'n', v: 1000, fmt: '0.00E+00' });
  assert.deepEqual(p('1.5E-3'), { t: 'n', v: 0.0015, fmt: '0.00E+00' });
  assert.deepEqual(p('12%'), { t: 'n', v: 0.12, fmt: '0%' });
  assert.deepEqual(p('12.5%'), { t: 'n', v: 0.125, fmt: '0.00%' });
  assert.deepEqual(p('1,200'), { t: 'n', v: 1200, fmt: '#,##0' });
  assert.deepEqual(p('1,200.50'), { t: 'n', v: 1200.5, fmt: '#,##0.00' });
  assert.deepEqual(p('$1,200'), { t: 'n', v: 1200, fmt: '"$"#,##0' });
  assert.deepEqual(p('$5.25'), { t: 'n', v: 5.25, fmt: '"$"#,##0.00' });
  assert.deepEqual(p('-$5'), { t: 'n', v: -5, fmt: '"$"#,##0' });
  assert.deepEqual(p('(42)'), { t: 'n', v: -42 });
  assert.deepEqual(p('3/4/2025'), { t: 'n', v: 45720, fmt: 'm/d/yyyy' });
  assert.deepEqual(p('2025-03-04'), { t: 'n', v: 45720, fmt: 'm/d/yyyy' });
  assert.deepEqual(p('3/4/25'), { t: 'n', v: 45720, fmt: 'm/d/yyyy' });
  assert.equal(p('1/1/30').v, M.toSerial(1930, 1, 1), 'two-digit years 30-99 are the 1900s');
  assert.deepEqual(p('3/4'), { t: 'n', v: 45720, fmt: 'd-mmm' }, 'this year');
  assert.deepEqual(p('4-Mar-2025'), { t: 'n', v: 45720, fmt: 'd-mmm-yy' });
  assert.deepEqual(p('March 4, 2025'), { t: 'n', v: 45720, fmt: 'd-mmm-yy' });
  assert.deepEqual(p('13:30'), { t: 'n', v: 0.5625, fmt: 'h:mm' });
  assert.deepEqual(p('1:30 PM'), { t: 'n', v: 0.5625, fmt: 'h:mm AM/PM' });
  assert.deepEqual(p('12:00:30 am'), { t: 'n', v: 30 / 86400, fmt: 'h:mm:ss AM/PM' });
  assert.deepEqual(p('13:30:15'), { t: 'n', v: (13 * 3600 + 30 * 60 + 15) / 86400, fmt: 'h:mm:ss' });
  assert.deepEqual(p('3/4/2025 13:30'), { t: 'n', v: 45720.5625, fmt: 'm/d/yyyy h:mm' });
  assert.deepEqual(p('3/4/2025', { date1904: true }), { t: 'n', v: 45720 - 1462, fmt: 'm/d/yyyy' });
  assert.deepEqual(p('TRUE'), { t: 'b', v: true });
  assert.deepEqual(p('false'), { t: 'b', v: false });
  assert.deepEqual(p('#N/A'), { t: 'e', v: '#N/A' });
  assert.deepEqual(p('#div/0!'), { t: 'e', v: '#DIV/0!' });
  assert.deepEqual(p('=SUM(A1:A3)'), { f: 'SUM(A1:A3)' });
  assert.deepEqual(p('='), { t: 's', v: '=' });
  assert.deepEqual(p("'42"), { t: 's', v: '42' });
  assert.deepEqual(p("'"), { t: 's', v: '' });
  for (const s of ['hello', '2/30/2025', '13/1/2025', '25:61', '1,2', '1,2345', '$', '%', '1e', '12%%', 'TRUE!', ' ']) assert.equal(p(s).t, 's', s);
  assert.deepEqual(M.parseNumber('$1,200'), { v: 1200, fmt: '"$"#,##0' });
  assert.equal(M.parseNumber('abc'), null);
});

test('styles are shared: an equal style is the same index', () => {
  const wb = M.workbook();
  assert.equal(M.internStyle(wb, {}), 0);
  const a = M.internStyle(wb, { fmt: '0%', bold: true });
  assert.equal(a, 1);
  assert.equal(M.internStyle(wb, { bold: true, fmt: '0%' }), 1, 'key order does not matter');
  assert.equal(M.internStyle(wb, { fmt: 10 }), 2);
  assert.equal(wb.styles.length, 3);
});

// Excel's legacy array restrictions: support.microsoft.com/en-us/excel/rules-for-changing-array-formulas.
test('structural edits refuse to split an array before changing formulas or dimensions', () => {
  for (const axis of ['row', 'col']) for (const op of ['insert', 'delete']) {
    const wb = shaped(), sh = wb.sheets[0];
    M.apply(wb, { op: 'set', sheet: sh.id, r: 1, c: 1, cell: { t: 'n', v: 1, f: '{1,2;3,4}', a: 'B2:C3' } });
    const before = structuredClone(wb);
    assert.throws(() => M.apply(wb, { op, sheet: sh.id, axis, at: 2, n: 1 }), (e) => e.code === 'array-part');
    assert.deepEqual(wb, before);
  }
});

test('insert undo preserves dimensions and hidden flags pushed off the last row or column', () => {
  for (const axis of ['row', 'col']) {
    const wb = shaped(), sh = wb.sheets[0];
    const max = axis === 'row' ? M.MAX_ROWS : M.MAX_COLS;
    sh[axis === 'row' ? 'rowH' : 'colW'].set(max - 1, 27);
    sh.hidden[axis === 'row' ? 'rows' : 'cols'].add(max - 1);
    const before = structuredClone(wb);
    const { inverse } = M.apply(wb, { op: 'insert', sheet: sh.id, axis, at: 0, n: 1 });
    M.apply(wb, inverse);
    assert.deepEqual(wb, before);
  }
});

test('adding a populated sheet cannot bypass the workbook cell cap', () => {
  const wb = M.workbook(), sh = M.sheet('Imported', 2);
  sh.rows.set(0, new Map(Array.from({ length: M.CAP.cells + 1 }, (_, i) => [i, { t: 'n', v: i }])));
  const before = structuredClone(wb);
  assert.throws(() => M.apply(wb, { op: 'addSheet', sheet: sh }), (e) => e.code === 'cap-cells');
  assert.deepEqual(wb, before);
});

// Microsoft: Keeping leading zeros and large numbers, digits beyond the fifteenth are zeroed on entry.
test('typed numbers discard significant digits past the fifteenth', () => {
  assert.equal(M.parseInput('1234567890123456').v, 1234567890123450);
  assert.equal(M.parseInput('0.1234567890123456').v, 0.123456789012345);
  assert.equal(M.parseInput('-1234567890123456').v, -1234567890123450);
});

// Microsoft: Control settings in the Format Cells dialog box, Fraction and automatic formats.
test('an unprefixed slash is a date while a mixed fraction is numeric', () => {
  assert.deepEqual(M.parseInput('1/2', { year: 2025 }), { t: 'n', v: M.toSerial(2025, 1, 2), fmt: 'd-mmm' });
  assert.deepEqual(M.parseInput('0 1/2'), { t: 'n', v: 0.5, fmt: '# ?/?' });
  assert.deepEqual(M.parseInput('1 1/2'), { t: 'n', v: 1.5, fmt: '# ?/?' });
  assert.deepEqual(M.parseInput('-1 1/2'), { t: 'n', v: -1.5, fmt: '# ?/?' });
  assert.equal(M.parseInput('$-1,200').v, -1200);
  assert.deepEqual(M.parseInput("'1/2"), { t: 's', v: '1/2' });
});
