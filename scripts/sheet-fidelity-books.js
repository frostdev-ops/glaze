// The workbooks the fidelity scripts (scripts/sheet-excel-fidelity.js, scripts/sheet-numbers-fidelity.js) open in another
// app: the 13 golden workbooks read and written again by lib/sheet-xlsx.js, a workbook built in Glaze from scratch, and
// files given on the command line (written by Glaze elsewhere). Each comes back with the model it holds (read back from
// the written bytes), which is what the other app must show.
const fs = require('node:fs'), path = require('node:path');
const LIB = path.join(__dirname, '../lib');
const M = require('../lib/sheet-model.js');
const C = require('../lib/sheet-calc.js');
for (const f of fs.readdirSync(LIB).filter((n) => /^sheet-fn-.*\.js$/.test(n)).sort()) require(path.join(LIB, f));
const X = require('../lib/sheet-xlsx.js');

const GOLDEN = path.join(__dirname, '../test/fixtures/sheets');

// A workbook as a student might make one in Glaze: typed values of every kind, formulas across sheets, styles, a merge,
// frozen panes, a filter, widths, a hidden column, a rich text cell and a defined name.
const built = async () => {
  const wb = M.workbook();
  const e = C.engine(wb);
  const id = wb.sheets[0].id;
  e.apply({ op: 'addSheet', name: 'Data & more' });
  const data = M.getSheet(wb, 'Data & more').id;
  const typed = [['A1', 'Item'], ['B1', 'Qty'], ['C1', 'Price'], ['D1', 'Total'], ['E1', 'Bought'], ['F1', 'Note'], ['A2', 'Pens'], ['B2', '12'], ['C2', '$1.25'],
    ['A3', 'Paper <A4> & "quotes"'], ['B3', '3'], ['C3', '4.5'], ['A4', 'Glue'], ['B4', '1,200'], ['C4', '0.1'], ['D2', '=B2*C2'], ['D3', '=B3*C3'], ['D4', '=B4*C4'],
    ['D5', '=SUM(D2:D4)'], ['E2', '3/4/2025'], ['E3', '1:30 PM'], ['E4', '3/4/2025 13:30'], ['F2', '=TEXTJOIN(", ",TRUE,A2:A4)'], ['F3', '=IF(D5>40,"big","small")'],
    ['F4', '=XLOOKUP("Glue",A2:A4,B2:B4)'], ['G2', '=1/0'], ['G3', 'TRUE'], ['G4', '12%'], ['H2', "'0042"], ['A7', '=\'Data & more\'!A1&" "&Sheet1!A1'],
    ['B7', '=LET(x,D5,x*2)'], ['C7', '=AVERAGE(Sheet1!B2:B4)'], ['D7', '=TODAY()-TODAY()'], ['E7', '=ROUND(PI(),10)'], ['F7', '=Total*1']];
  for (const [a, text] of typed) {
    const [r, c] = M.cellPosition(a);
    const res = e.edit(id, r, c, text);
    if (res.error) throw Error(`${a}: ${res.error.message}`);
  }
  for (let i = 0; i < 6; i++) e.edit(data, i, 0, String((i + 1) * 1.5));
  e.edit(data, 0, 1, '=SUM(A1:A6)');
  e.apply({ op: 'set', sheet: data, r: 2, c: 1, cell: { t: 'n', v: 0, f: 'A1:A3*2', a: 'B3:B5' } });
  const head = M.internStyle(wb, { bold: true, fill: '#DDEBF7', color: '#1F4E79', border: { bottom: { style: 'thin', color: '#000000' } }, h: 'center' });
  for (let c = 0; c < 6; c++) e.apply({ op: 'set', sheet: id, r: 0, c, cell: { ...M.cell(wb.sheets[0], 0, c), s: head } });
  const money = M.internStyle(wb, { fmt: '"$"#,##0.00' });
  for (let r = 1; r <= 4; r++) e.apply({ op: 'set', sheet: id, r, c: 3, cell: { ...M.cell(wb.sheets[0], r, 3), s: money } });
  const pct = M.internStyle(wb, { fmt: 10, italic: true });
  e.apply({ op: 'set', sheet: id, r: 4, c: 6, cell: { t: 'n', v: 0.4567, s: pct } });
  e.apply({ op: 'set', sheet: id, r: 8, c: 0, cell: { t: 's', v: 'Rich text', rich: [{ text: 'Rich', bold: true, color: '#C00000' }, { text: ' text', italic: true, size: 14 }] } });
  e.apply({ op: 'set', sheet: id, r: 9, c: 0, cell: { t: 's', v: 'Merged across three columns', s: M.internStyle(wb, { h: 'center', wrap: true }) } });
  e.apply({ op: 'prop', sheet: id, key: 'merges', value: [{ r0: 9, c0: 0, r1: 10, c1: 2 }] });
  e.apply({ op: 'prop', sheet: id, key: 'freeze', value: { rows: 1, cols: 1 } });
  e.apply({ op: 'prop', sheet: id, key: 'filter', value: { r0: 0, c0: 0, r1: 4, c1: 5 } });
  e.apply({ op: 'size', sheet: id, axis: 'col', i: 0, size: 22.7109375 });
  e.apply({ op: 'size', sheet: id, axis: 'col', i: 5, size: 31.7109375 });
  e.apply({ op: 'size', sheet: id, axis: 'row', i: 0, size: 21 });
  e.apply({ op: 'addSheet', name: 'Hidden' });
  e.edit(M.getSheet(wb, 'Hidden').id, 0, 0, 'kept out of sight');
  M.getSheet(wb, 'Hidden').keep = { hidden: true };
  e.apply({ op: 'hide', sheet: id, axis: 'col', i: 7, hidden: true });
  e.apply({ op: 'name', name: 'Total', ref: 'Sheet1!$D$5' });
  e.recalc();
  return X.write(wb, { engine: e });
};

// → [{ name, bytes, model }]
const books = async (files = []) => {
  const out = [];
  if (files.length) {
    for (const f of files) { const bytes = new Uint8Array(fs.readFileSync(f)); out.push({ name: path.basename(f), bytes, model: await X.read(bytes) }); }
    return out;
  }
  for (const f of fs.readdirSync(GOLDEN).filter((n) => n.endsWith('.xlsx')).sort()) {
    const bytes = await X.write(await X.read(fs.readFileSync(path.join(GOLDEN, f))));
    out.push({ name: f, bytes, model: await X.read(bytes) });
  }
  const bytes = await built();
  out.push({ name: 'built-in-glaze.xlsx', bytes, model: await X.read(bytes) });
  return out;
};

// What each sheet of a model must show: { name, r1, c1 (the last row and column), cells: Map 'A1' → expectation }.
// An expectation: { t, v, f (with '='), fmt (the code), array (the head's formula, for an array's other cells) }.
const NF = require('../lib/sheet-numfmt.js');
const expect = (wb) => wb.sheets.map((sh) => {
  let r1 = 0, c1 = 0;
  const cells = new Map();
  const heads = [];
  for (const [r, row] of sh.rows) for (const [c, x] of row) {
    r1 = Math.max(r1, r); c1 = Math.max(c1, c);
    const id = x.s ? wb.styles[x.s]?.fmt : 0;
    cells.set(M.cellName(r, c), { t: x.t, v: x.v, f: x.f === undefined ? undefined : `=${x.f}`, fmt: NF.code(id), id });
    if (x.a !== undefined && x.f !== undefined) heads.push([M.rangePosition(x.a), `=${x.f}`]);
  }
  for (const [g, f] of heads) for (let r = g.r0; r <= g.r1; r++) for (let c = g.c0; c <= g.c1; c++) {
    if (r === g.r0 && c === g.c0) continue;
    const at = M.cellName(r, c);
    cells.set(at, { ...(cells.get(at) ?? { t: 'z', fmt: 'General' }), array: f });
  }
  return { name: sh.name, r1, c1, cells, merges: sh.merges.map((g) => M.rangeName(g.r0, g.c0, g.r1, g.c1)), freeze: sh.freeze, hidden: [...sh.hidden.cols], sheetHidden: !!sh.keep?.hidden };
});

// Two values agree: numbers to 1e-12 of the larger, the rest exactly.
const agree = (t, want, got) => (t === 'n' ? typeof got === 'number' && Math.abs(want - got) <= 1e-12 * Math.max(Math.abs(want), Math.abs(got)) : want === got);
// Excel's #CALC!, #SPILL! and the like are stored as #VALUE!.
const stored = (v) => (['#NULL!', '#DIV/0!', '#VALUE!', '#REF!', '#NAME?', '#NUM!', '#N/A', '#GETTING_DATA'].includes(v) ? v : '#VALUE!');

module.exports = { books, built, expect, agree, stored };
