// The database functions (lib/sheet-fn-database.js). Cases are the worked examples on Microsoft's page for each
// function, https://support.microsoft.com/en-us/office/<name>-function-<id>:
//   dsum 53181285-0c4b-4f5a-aaa3-529a322be41b, dcount c1fc7b93-fb0d-4d8d-97db-8d5f076eaeb1, dcounta
//   00232a6d-5a66-4a01-a25b-c1653fda1244, daverage a6a2d5ac-4b4b-48cd-a1d8-7b37834e5aee, dget 455568bf-4eef-45f7-90f0-ec250d00892e,
//   dmax f4e8209d-8958-4c3d-a1ee-6351665d41c2, dmin 4ae6f1d9-1f26-40f1-a783-6dc3680192a3, dproduct
//   4f96b13e-d49c-47a7-b769-22f6d017cb31, dstdev 026b8c73-616d-4b5e-b072-241871c4ab96, dstdevp 04b78995-da03-4813-bbd9-d74fd0f5d94b,
//   dvar d6747ca9-99c7-48bb-996e-9d7af00f3ed1, dvarp eb0ba387-9cb7-45c8-81e9-0394912502fc.
// A page's figure shown to fewer digits is checked to those digits. The rest are Excel 16.114.1's answers (probes
// 2026-10-30) over the probe table below.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const M = require('../lib/sheet-model.js');
const C = require('../lib/sheet-calc.js');
require('../lib/sheet-fn-math.js');
require('../lib/sheet-fn-text.js');
require('../lib/sheet-fn-info.js');
require('../lib/sheet-fn-date.js');
require('../lib/sheet-fn-database.js');

// cells: typed input (a string, as a person types it), a number, a boolean, or { s } for text as it is.
const book = (cells = {}, { sheets = ['Sheet1'] } = {}) => {
  const wb = M.workbook();
  wb.sheets[0].name = sheets[0];
  for (const name of sheets.slice(1)) M.apply(wb, { op: 'addSheet', at: wb.sheets.length, name });
  for (const [at, input] of Object.entries(cells)) {
    if (input === null) continue;
    const [sheet, ref] = at.includes('!') ? at.split('!') : [sheets[0], at];
    const [r, c] = M.cellPosition(ref);
    const x = typeof input === 'string' ? M.parseInput(input, { year: 2025 }) : typeof input === 'boolean' ? { t: 'b', v: input }
      : typeof input === 'object' ? { t: 's', v: input.s } : { t: 'n', v: input };
    M.apply(wb, { op: 'set', sheet: M.getSheet(wb, sheet).id, r, c, cell: x.f !== undefined ? { t: 'n', v: 0, f: x.f } : { t: x.t, v: x.v } });
  }
  const e = C.engine(wb);
  e.recalc();
  return e;
};
const out = (x) => (C.isErr(x) ? x.code : x);
const calc = (e, text) => out(e.evaluate(text, e.wb.sheets[0].id, 199, 25));
const cases = (e, rows) => { for (const [f, want] of rows) assert.equal(calc(e, f), want, f); };
const shown = (e, rows) => {
  for (const [f, page] of rows) {
    const got = calc(e, f), dp = (String(page).split('.')[1] ?? '').length;
    assert.equal(typeof got, 'number', `${f} → ${got}`);
    assert.ok(Math.abs(got - Number(page)) <= 0.5 * 10 ** -dp + 1e-15, `${f} → ${got}, the page shows ${page}`);
  }
};
const grid = (at, rows) => {
  const [pre, ref] = at.includes('!') ? [at.slice(0, at.indexOf('!') + 1), at.slice(at.indexOf('!') + 1)] : ['', at];
  const [r0, c0] = M.cellPosition(ref), cells = {};
  rows.forEach((row, i) => row.forEach((v, j) => { cells[pre + M.cellName(r0 + i, c0 + j)] = v; }));
  return cells;
};

const NAMES = 'DSUM DCOUNT DCOUNTA DAVERAGE DGET DMAX DMIN DPRODUCT DSTDEV DSTDEVP DVAR DVARP'.split(' ');

test('the database functions are registered', () => {
  for (const name of NAMES) assert.ok(C.fn(name), name);
  for (const name of NAMES) assert.equal(C.fn(name).min, 3, `${name} takes three arguments`);
  assert.ok(!/\bset(Timeout|Interval)\b/.test(fs.readFileSync(path.join(__dirname, '..', 'lib', 'sheet-fn-database.js'), 'utf8')), 'no timers');
});

// The pages' orchard: criteria A1:F3 over the table, its labels in row `top`.
const TREES = [['Tree', 'Height', 'Age', 'Yield', 'Profit'], ['Apple', 18, 20, 14, 105], ['Pear', 12, 12, 10, 96], ['Cherry', 13, 14, 9, 105],
  ['Apple', 14, 15, 10, 75], ['Pear', 9, 8, 8, 76.8], ['Apple', 8, 9, 6, 45]];
const CRIT = [['Tree', 'Height', 'Age', 'Yield', 'Profit', 'Height'], ['="=Apple"', '>10', null, null, null, '<16'], ['="=Pear"']];
const orchard = (top, crit = CRIT, trees = TREES) => book({ ...grid('A1', crit), ...grid(`A${top}`, trees) });

test('DSUM, DMAX, DMIN, DPRODUCT, DSTDEV, DSTDEVP over the pages\' orchard (A5:E11)', () => {
  const e = orchard(5);
  cases(e, [['DSUM(A5:E11,"Profit",A1:A2)', 225], ['DMAX(A5:E11, "Profit", A1:F3)', 96], ['DMIN(A5:E11, "Profit", A1:F3)', 75], ['DPRODUCT(A5:E11, "Yield", A1:F3)', 800]]);
  shown(e, [['DSUM(A5:E11,"Profit", A1:F3)', '248'], ['DSTDEV(A5:E11, "Yield", A1:A3)', '2.96648'], ['DSTDEVP(A5:E11, "Yield", A1:A3)', '2.6532998']]);
});

test('DVAR, DVARP, DGET, DAVERAGE, DCOUNTA over the pages\' orchard (A4:E10)', () => {
  const e = orchard(4);
  shown(e, [['DVAR(A4:E10, "Yield", A1:A3)', '8.8'], ['DVARP(A4:E10, "Yield", A1:A3)', '7.04']]);
  cases(e, [['DGET(A4:E10, "Yield", A1:A3)', '#NUM!'],
    ['DAVERAGE(A4:E10, "Yield", A1:B2)', 12], ['DAVERAGE(A4:E10, 3, A4:E10)', 13], ['DCOUNTA(A4:E10, "Profit", A1:F2)', 1]]);
  // DGET's page: row 3 is ="Pear" (begins with Pear) and >12 under Height.
  const g = orchard(4, [CRIT[0], CRIT[1], ['="Pear"', '>12']]);
  cases(g, [['DGET(A4:E10, "Yield", A1:F3)', 10], ['DGET(A4:E10, "Yield", A1:A3)', '#NUM!']]);
});

test('DCOUNT counts numbers in the field, or matching records with the field left out', () => {
  const trees = TREES.map((row) => row.slice());
  trees[4][2] = 'N/A';
  trees[6][1] = 12; trees[6][2] = 11;
  const e = orchard(4, CRIT, trees);
  cases(e, [['DCOUNT(A4:E10, "Age", A1:F2)', 1], ['DCOUNT(A4:E10,,A1:F2)', 2], ['DCOUNTA(A4:E10,"Age",A1:F2)', 2], ['DCOUNTA(A4:E10,,A1:F2)', 2]]);
});

test('DCOUNTA\'s sales examples', () => {
  const SALES = [['Category', 'Salesperson', 'Sales'], ['Beverages', 'Suyama', 5122], ['Meat', 'Davolio', 450], ['produce', 'Buchanan', 6328], ['Produce', 'Davolio', 6544]];
  const at = (crit, rows = SALES) => book({ ...grid('A1', crit), ...grid('A6', rows) });
  cases(at([[null, 'Salesperson'], [null, '="=Davolio"'], [null, '="=Buchanan"']]), [['DCOUNTA(A6:C10,2,B1:B3)', 3]]);
  cases(at([['Category', 'Salesperson', 'Sales'], ['="=Produce"', null, '>2000']], [SALES[0], ['Beverages', 'Suyama', 5122], ['Meat', 'Davolio', 450],
    ['Produce', 'Buchanan', 935], ['Produce', 'Davolio', 6544], ['Beverages', 'Buchanan', 3677], ['Produce', 'Davolio', 3186]]), [['DCOUNTA(A6:C12,,A1:C2)', 2]]);
  cases(at([['Category', 'Salesperson'], ['="=Produce"'], [null, '="=Davolio"']], [SALES[0], ['Beverages', 'Suyama', 5122], ['Meat', 'Davolio', 675],
    ['produce', 'Buchanan', 937], ['Produce', 'Buchanan', null]]), [['DCOUNTA(A6:C10,"Sales",A1:B3)', 2]]);
  cases(at([['Category', 'Salesperson', 'Sales'], [null, '="=Davolio"', '>3000'], [null, '="=Buchanan"', '>1500']]), [['DCOUNTA(A6:C10,,B1:C3)', 2]]);
  cases(at([['Category', 'Salesperson', 'Sales', 'Sales'], [null, null, '>6000', '<6500'], [null, null, '<500']]), [['DCOUNTA(A6:C10,,C1:D3)', 2]]);
  cases(at([['Category', 'Salesperson', 'Sales'], ['Me'], [null, '?u*']]), [['DCOUNTA(A6:C10,,A1:B3)', 3]]);
  // A criterion a formula makes (">4611") under a column's label is its value.
  cases(at([[null, null, 'Sales'], [null, null, '=CONCATENATE(">",C4)'], [null, null, 'Calculated Average'], [null, null, '=AVERAGE(C7:C10)']]), [['DCOUNTA(A6:C10,,C1:C2)', 3]]);
});

test('Excel\'s values for the golden cases', () => {
  const e = book({
    ...grid('Data!K1', [['id', 'name', 'score'], [101, 'Ann', 88], [102, 'Bob', 95], [103, 'Cy', 72], [104, 'Dee', 95], [105, 'Eve', 60]]),
    ...grid('Data!AA1', [['score', 'name'], ['>80', 'B*']]),
  }, { sheets: ['Sheet1', 'Data'] });
  cases(e, [['DSUM(Data!K1:M6,"score",Data!AA1:AA2)', 278], ['DCOUNT(Data!K1:M6,"score",Data!AA1:AB2)', 1], ['DAVERAGE(Data!K1:M6,3,Data!AA1:AA2)', 92.66666666666667],
    ['DGET(Data!K1:M6,"name",Data!AA1:AB2)', 'Bob'], ['DMAX(Data!K1:M6,"id",Data!AA1:AA2)', 104]]);
});

// Excel 16.114.1's probe table: mask is a bit per record, so DSUM(db,"mask",crit) names the records a criteria range
// matches (Ann 1, Bob 2, Bea 4, bob 8, Eve 16, Bobby 32, B 64, Cy 128).
const PROBE = [
  ['id', 'name', 'score', 'val', 'when', 'mask'],
  [101, 'Ann', 88, { s: '95' }, '1/1/2024', 1],
  [102, 'Bob', 95, 95, '6/1/2024', 2],
  [103, 'Bea', 72, true, '12/31/2023', 4],
  [104, 'bob', 95, '=NA()', '2/1/2024', 8],
  [105, 'Eve', 60, { s: 'abc' }, null, 16],
  [106, 'Bobby', 50, null, '1/2/2024', 32],
  [107, { s: 'B' }, 40, false, '1/1/2024', 64],
  [108, 'Cy', 30, { s: 'TRUE' }, '3/3/2024', 128],
];
// Each criteria range in a block of its own from row 20, as the probe laid them out; f(crit) is the formula.
const probe = (rows) => {
  const cells = grid('A1', PROBE), formulas = [];
  rows.forEach(([crit, f, want], i) => {
    const c0 = 9 + 4 * i;
    const w = Math.max(...crit.map((r) => r.length));
    Object.assign(cells, grid(M.cellName(19, c0), crit));
    formulas.push([f(`${M.cellName(19, c0)}:${M.cellName(19 + crit.length - 1, c0 + w - 1)}`, M.columnName(c0)), want]);
  });
  cases(book(cells), formulas);
};
const mask = (crit, want) => [crit, (c) => `DSUM(A1:F9,"mask",${c})`, want];
const t = (s) => ({ s });

test('typed text finds every value that begins with it; = matches whole values; wildcards, comparisons', () => {
  probe([
    mask([['name'], [t('B')]], 110), mask([['name'], [t('=B')]], 64), mask([['name'], [t('=Bob')]], 10), mask([['name'], [t('<>Bob')]], 245),
    mask([['name'], [t('>B')]], 190), mask([['name'], [t('B*')]], 110), mask([['name'], [t('*o*')]], 42), mask([['name'], [t('?o?')]], 42),
    mask([['name'], [t('bob')]], 42), mask([['name'], [t('=')]], 0), mask([['name'], [t('<>')]], 255), mask([['name'], ['=""']], 255),
    mask([['name'], [t('Bo')]], 42), mask([['name'], [t('=Bo*')]], 42), mask([['name'], [t('<B')]], 1), mask([['name'], [t('<>B*')]], 145),
    mask([['name'], [t('>=Bob')]], 186), mask([['name'], [t('=b?b')]], 10), mask([['name'], [t('B~*')]], 0),
  ]);
});

test('numbers, booleans, errors and dates as criteria', () => {
  probe([
    mask([['val'], [95]], 3), mask([['val'], [t('95')]], 3), mask([['val'], [true]], 4), mask([['val'], [t('TRUE')]], 4),
    mask([['val'], ['=NA()']], 8), mask([['val'], [t('#N/A')]], 8), mask([['val'], [t('>90')]], 2), mask([['val'], [t('9')]], 0),
    mask([['val'], [false]], 64), mask([['val'], [t('a')]], 16), mask([['val'], [t('<>95')]], 253), mask([['val'], [t('TRU')]], 128),
    mask([['score'], [t('9')]], 0), mask([['score'], [95]], 10), mask([['score'], [t('<>95')]], 245), mask([['score'], [t('>=95')]], 10), mask([['score'], [t('=95')]], 10),
    mask([['when'], [t('>1/1/2024')]], 170), mask([['when'], [t('1/1/2024')]], 65), mask([['when'], ['=DATE(2024,1,1)']], 65), mask([['when'], [t('=1/1/2024')]], 65),
    mask([['name'], ['=1/0']], 0),
  ]);
});

test('criteria ranges: rows OR, columns AND, blanks no condition, labels that name no column', () => {
  probe([
    mask([['name'], [null]], 255), mask([['name'], [t('Ann')], [null]], 255), mask([['NAME'], [t('ann')]], 1), mask([['name', 'score'], [t('B'), t('>90')]], 10),
    mask([['name'], [t('Ann')], [t('Eve')]], 17), mask([['score', 'score'], [t('>50'), t('<90')]], 21), mask([['name', null], [t('Ann'), null]], 1),
    mask([[t(' name')], [t('Ann')]], 0),
    // Under a label that names no column a constant holds for every record or none: TRUE or a number other than 0 all,
    // FALSE or text none; a blank cell is no condition.
    mask([['zzz'], [1]], 255), mask([[null], [1]], 255), mask([['zzz'], [true]], 255), mask([['zzz'], [false]], 0), mask([['zzz'], [t('Ann')]], 0),
    mask([['zzz'], [null]], 255), mask([['zzz', 'name'], [1, t('Ann')]], 1), mask([['zzz', 'name'], [null, t('Ann')]], 1), mask([['=NA()'], [t('Ann')]], 0),
    mask([[1], [1]], 255),
    // A formula under a column's label is its value (TRUE here, so no name matches).
    mask([['name'], ['=C2>80']], 0),
    // Computed criteria are evaluated for every record with relative rows advanced.
    mask([['zzz'], ['=C2>80']], 11), mask([[null], ['=C2>80']], 11),
    mask([['name']], '#VALUE!'),
    [[['name'], [t('Ann')]], (c, col) => `DSUM(A1:F9,"mask",${col}:${col})`, 255],
  ]);
  cases(book(grid('A1', PROBE)), [
    ['DSUM(A1:F9,"mask",B1:B2)', 1], ['DSUM(A1:F9,"mask",B1)', '#VALUE!'], ['DSUM(A1:F9,"mask",(B1:B2,B1:B2))', '#VALUE!'],
    ['DSUM((A1:F9,A1:F9),"mask",B1:B2)', '#VALUE!'], ['DSUM(A1:F1,"mask",B1:B2)', '#VALUE!'], ['DAVERAGE(A1:F9,3,A1:F9)', 500 / 7],
    // Excel won't take an array as the database; one as the criteria is taken element by element, each #VALUE!.
    ['DSUM({"name","mask";"Ann",1},"mask",B1:B2)', '#VALUE!'], ['DSUM(A1:F9,"mask",{"name";"Ann"})', '#VALUE!'],
  ]);
});

test('the field: a label in any case or a column number; anything else #VALUE!', () => {
  const ann = [['name'], [t('Ann')]], bs = [['name'], [t('B*')]];
  probe([
    [ann, (c) => `DSUM(A1:F9,"MASK",${c})`, 1], [ann, (c) => `DSUM(A1:F9,6,${c})`, 1], [ann, (c) => `DSUM(A1:F9,6.9,${c})`, 1],
    [ann, (c) => `DSUM(A1:F9,TRUE,${c})`, 101], [ann, (c) => `DSUM(A1:F9,F1,${c})`, 1], [ann, (c) => `DSUM(A1:F9,NA(),${c})`, '#N/A'],
    [ann, (c) => `DSUM(A1:F9,0,${c})`, '#VALUE!'], [ann, (c) => `DSUM(A1:F9,7,${c})`, '#VALUE!'], [ann, (c) => `DSUM(A1:F9,-1,${c})`, '#VALUE!'],
    [ann, (c) => `DSUM(A1:F9,"zzz",${c})`, '#VALUE!'], [ann, (c) => `DSUM(A1:F9,"6",${c})`, '#VALUE!'], [ann, (c) => `DSUM(A1:F9,"",${c})`, '#VALUE!'],
    [ann, (c) => `DSUM(A1:F9," mask",${c})`, '#VALUE!'], [ann, (c) => `DSUM(A1:F9,,${c})`, '#VALUE!'], [ann, (c) => `DGET(A1:F9,,${c})`, '#VALUE!'],
    [bs, (c) => `DCOUNT(A1:F9,,${c})`, 5], [bs, (c) => `DCOUNTA(A1:F9,,${c})`, 5], [bs, (c) => `DCOUNT(A1:F9,"",${c})`, '#VALUE!'],
    [bs, (c) => `DCOUNTA(A1:F9,"",${c})`, '#VALUE!'], [bs, (c) => `DCOUNT(A1:F9,"name",${c})`, 0], [bs, (c) => `DCOUNT(A1:F9,"zzz",${c})`, '#VALUE!'],
    [bs, (c) => `DCOUNT(A1:F9,0,${c})`, '#VALUE!'], [bs, (c) => `DSUM(A1:F9,,${c})`, '#VALUE!'], [bs, (c) => `DAVERAGE(A1:F9,,${c})`, '#VALUE!'],
  ]);
});

test('text, booleans, blanks and errors in the field; no match; one match', () => {
  const each = (crit, field, wants) => Object.entries(wants).map(([fn, want]) => [crit, (c) => `${fn}(A1:F9,"${field}",${c})`, want]);
  probe([
    // id<>104 leaves "95" as text, 95, TRUE, "abc", a blank, FALSE and "TRUE" as text.
    ...each([['id'], [t('<>104')]], 'val', { DSUM: 95, DCOUNT: 1, DCOUNTA: 6, DAVERAGE: 95, DMAX: 95, DMIN: 95, DPRODUCT: 95, DSTDEV: '#DIV/0!', DSTDEVP: 0, DVAR: '#DIV/0!', DVARP: 0, DGET: '#NUM!' }),
    ...each([['name'], [null]], 'val', { DSUM: '#N/A', DCOUNT: 1, DCOUNTA: 7, DAVERAGE: '#N/A', DMAX: '#N/A', DMIN: '#N/A', DPRODUCT: '#N/A', DSTDEV: '#N/A', DSTDEVP: '#N/A', DVAR: '#N/A', DVARP: '#N/A', DGET: '#NUM!' }),
    ...each([['id'], [t('<>104')]], 'name', { DSUM: 0, DCOUNT: 0, DCOUNTA: 7, DAVERAGE: '#DIV/0!', DMAX: 0, DMIN: 0, DPRODUCT: 0, DSTDEV: '#DIV/0!', DSTDEVP: '#DIV/0!', DVAR: '#DIV/0!', DVARP: '#DIV/0!', DGET: '#NUM!' }),
    ...each([['id'], [999]], 'score', { DSUM: 0, DCOUNT: 0, DCOUNTA: 0, DAVERAGE: '#DIV/0!', DMAX: 0, DMIN: 0, DPRODUCT: 0, DSTDEV: '#DIV/0!', DSTDEVP: '#DIV/0!', DVAR: '#DIV/0!', DVARP: '#DIV/0!', DGET: '#VALUE!' }),
    ...each([['id'], [101]], 'score', { DSUM: 88, DCOUNT: 1, DCOUNTA: 1, DAVERAGE: 88, DMAX: 88, DMIN: 88, DPRODUCT: 88, DSTDEV: '#DIV/0!', DSTDEVP: 0, DVAR: '#DIV/0!', DVARP: 0, DGET: 88 }),
    ...[[101, '95'], [103, true], [105, 'abc'], [106, '#VALUE!'], [104, '#N/A'], [107, false]].map(([id, want]) => [[['id'], [id]], (c) => `DGET(A1:F9,"val",${c})`, want]),
    [[['id'], [105]], (c) => `DGET(A1:F9,"when",${c})`, '#VALUE!'], [[['name'], [t('B*')]], (c) => `DGET(A1:F9,"name",${c})`, '#NUM!'],
  ]);
});


test('database computed criteria, empty strings and blank field references agree with Excel', () => {
  const e = book({ ...grid('A1', [['name', 'value', 'id'], ['Apple', 2, 1], ['Apricot', '=""', 2], ['Pear', null, 3], ['Plum', 4, 4]]),
    ...grid('H1', [['computed', 'id'], ['=B2>1', '>0']]), J1: 'computed', J2: { s: 'TRUE' } });
  cases(e, [['DSUM(A1:C5,"value",H1:H2)', 6], ['DCOUNTA(A1:C5,"value",I1:I2)', 3],
    ['DCOUNT(A1:C5,Z1,I1:I2)', '#VALUE!'], ['DCOUNTA(A1:C5,Z1,I1:I2)', '#VALUE!'], ['DSUM(A1:C5,"value",J1:J2)', 6]]);
  const f = book({ ...grid('A1', [['name', 'value', 'id'], ['Apple', 2, 1], ['Apricot', 5, 2], ['Pear', '=1/0', 3], ['Plum', 4, 4]]),
    H1: 'computed', H2: '=B2>AVERAGE($B$2:$B$3)', I1: 'computed', I2: '=B2', J1: 'computed', J2: '=FALSE',
    K1: 'computed', K2: '=1/0', L1: 'computed', L2: '="TRUE"' });
  cases(f, [['DSUM(A1:C5,"id",H1:H2)', 6], ['DSUM(A1:C5,"id",I1:I2)', 7], ['DSUM(A1:C5,"id",J1:J2)', 0],
    ['DSUM(A1:C5,"id",K1:K2)', 0], ['DSUM(A1:C5,"id",L1:L2)', 10]]);
});

test('computed criteria update with records and refuse untracked shifted references', () => {
  const e = book({ ...grid('A1', [['id', 'value'], [1, 0], [2, 1], [3, 0]]), H1: 'computed', H2: '=B2>0' });
  cases(e, [['DSUM(A1:B4,"id",H1:H2)', 2]]);
  const sh = e.wb.sheets[0];
  e.apply({ op: 'set', sheet: sh.id, r: 3, c: 1, cell: { t: 'n', v: 1 } });
  cases(e, [['DSUM(A1:B4,"id",H1:H2)', 5]]);
  // The engine only tracks the first criterion cell's dependencies. Relative references outside database would
  // otherwise return stale results after another record changes; support needs an engine dependency hook.
  const outside = book({ ...grid('A1', [['id'], [1], [2], [3]]), D2: 0, D3: 1, D4: 0, H1: 'computed', H2: '=D2>0' });
  cases(outside, [['DSUM(A1:A4,"id",H1:H2)', '#VALUE!']]);
});
