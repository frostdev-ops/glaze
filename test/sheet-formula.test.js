// The formula parser (lib/sheet-formula.js): Excel's grammar to an AST whose relative references are offsets from the
// formula's cell (so cells sharing an R1C1 text share one AST), and the text rewrites the model's operations and the
// grid's fill and paste drive: shift for inserted or deleted rows and columns, rename for sheets, move for copies,
// _xlfn. prefixes off and on.
const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('../lib/sheet-formula.js');
const M = require('../lib/sheet-model.js');

// The AST as an S-expression, references resolved at (r, c) to A1 text.
const ref = (n, r, c) => {
  const row = (v, a) => (a ? v : v + r), col = (v, a) => (a ? v : v + c);
  const [ra0, ca0, ra1, ca1] = n.abs;
  const pre = n.sheet ? `${n.sheet}${n.sheet2 ? `:${n.sheet2}` : ''}!` : '';
  const cr = (rr, cc, ar, ac) => `${ac ? '$' : ''}${M.columnName(col(cc, ac))}${ar ? '$' : ''}${row(rr, ar) + 1}`;
  if (n.whole === 'col') return `${pre}${ca0 ? '$' : ''}${M.columnName(col(n.c0, ca0))}:${ca1 ? '$' : ''}${M.columnName(col(n.c1, ca1))}`;
  if (n.whole === 'row') return `${pre}${ra0 ? '$' : ''}${row(n.r0, ra0) + 1}:${ra1 ? '$' : ''}${row(n.r1, ra1) + 1}`;
  return pre + cr(n.r0, n.c0, ra0, ca0) + (n.cell ? '' : `:${cr(n.r1, n.c1, ra1, ca1)}`);
};
const sx = (n, r = 0, c = 0) => {
  const s = (x) => sx(x, r, c);
  switch (n.k) {
    case 'num': return String(n.v);
    case 'str': return JSON.stringify(n.v);
    case 'bool': return n.v ? 'TRUE' : 'FALSE';
    case 'err': return n.v;
    case 'empty': return '_';
    case 'ref': return ref(n, r, c);
    case 'name': return n.sheet ? `${n.sheet}!${n.name}` : n.name;
    case 'fn': return `(${[n.name, ...n.args.map(s)].join(' ')})`;
    case 'un': return `(${n.op}u ${s(n.a)})`;
    case 'pct': return `(% ${s(n.a)})`;
    case 'bin': return `(${n.op === ' ' ? '∩' : n.op} ${s(n.a)} ${s(n.b)})`;
    case 'union': return `(, ${n.items.map(s).join(' ')})`;
    case 'array': return `{${n.rows.map((row) => row.map((v) => (typeof v === 'object' ? v.err : JSON.stringify(v))).join(',')).join(';')}}`;
    case 'table': case 'ext': return `[${n.k} ${n.s}]`;
    default: throw new Error(n.k);
  }
};
const p = (text, r, c) => sx(F.parse(text, r, c), r, c);

test('precedence: unary minus over ^, % over ^, ^ left to right, & under +, comparisons last', () => {
  assert.equal(p('1+2*3'), '(+ 1 (* 2 3))');
  assert.equal(p('(1+2)*3'), '(* (+ 1 2) 3)');
  assert.equal(p('-2^2'), '(^ (-u 2) 2)');
  assert.equal(p('2^3^2'), '(^ (^ 2 3) 2)');
  assert.equal(p('2^-2'), '(^ 2 (-u 2))');
  assert.equal(p('-A1%'), '(% (-u A1))');
  assert.equal(p('2^3%'), '(^ 2 (% 3))');
  assert.equal(p('1-2-3'), '(- (- 1 2) 3)');
  assert.equal(p('1--2'), '(- 1 (-u 2))');
  assert.equal(p('+A1'), '(+u A1)');
  assert.equal(p('"a"&1+2'), '(& "a" (+ 1 2))');
  assert.equal(p('1<2=TRUE'), '(= (< 1 2) TRUE)');
  assert.equal(p('A1<>B1'), '(<> A1 B1)');
  assert.equal(p('1>=2'), '(>= 1 2)');
  assert.equal(p('=1+1'), '(+ 1 1)', 'a leading = is allowed');
  assert.equal(p('-A1:A3'), '(-u A1:A3)', 'references bind before signs');
  assert.equal(p('@A1:A3'), '(@u A1:A3)');
});

test('literals: numbers, strings with doubled quotes, booleans, errors, array constants', () => {
  assert.equal(p('1.5e3+.5+1E-2'), '(+ (+ 1500 0.5) 0.01)');
  assert.equal(p('"say ""hi"""'), '"say \\"hi\\""');
  assert.equal(p('TRUE'), 'TRUE');
  assert.equal(p('false'), 'FALSE');
  assert.equal(p('TRUE()'), '(TRUE)', 'TRUE( is the function');
  assert.equal(p('#N/A'), '#N/A');
  assert.equal(p('#div/0!'), '#DIV/0!');
  assert.equal(p('{1,2;3,4}'), '{1,2;3,4}');
  assert.equal(p('{-1,"a";TRUE,#N/A}'), '{-1,"a";true,#N/A}');
});

test('references: A1 and $, ranges, whole rows and columns, sheets quoted and 3-D, names', () => {
  assert.equal(p('A1+$B$2+C$3+$D4'), '(+ (+ (+ A1 $B$2) C$3) $D4)');
  assert.equal(p('SUM(A1:B2)'), '(SUM A1:B2)');
  assert.equal(p('a1:b2'), 'A1:B2');
  assert.equal(p('SUM(A:A,$B:$C,1:1,$2:$5)'), '(SUM A:A $B:$C 1:1 $2:$5)');
  assert.equal(p('Sheet1!A1'), 'Sheet1!A1');
  assert.equal(p("'My Sheet'!A1:B2"), 'My Sheet!A1:B2');
  assert.equal(p("'It''s'!A1"), "It's!A1");
  assert.equal(p('SUM(Sheet1:Sheet3!A1)'), '(SUM Sheet1:Sheet3!A1)');
  assert.equal(p("SUM('Jan 1:Mar 3'!B2:C3)"), '(SUM Jan 1:Mar 3!B2:C3)');
  assert.equal(p('XFD1048576'), 'XFD1048576');
  assert.equal(p('Rate*2'), '(* Rate 2)');
  assert.equal(p('Sheet1!Rate'), 'Sheet1!Rate');
  assert.equal(p('XFE1'), 'XFE1', 'past XFD is a name');
  assert.equal(p('A1B'), 'A1B');
  assert.equal(p('LOG10(100)'), '(LOG10 100)', 'a cell-like name before ( is a function');
  assert.equal(p('A1:B2:C3'), '(: A1:B2 C3)');
  assert.equal(p('A1:INDEX(B:B,2)'), '(: A1 (INDEX B:B 2))');
  assert.equal(p('SUM(A1:B2 B1:C3)'), '(SUM (∩ A1:B2 B1:C3))', 'a space between references intersects them');
  assert.equal(p('A1 + B1'), '(+ A1 B1)');
  assert.equal(p('SUM((A1,B2))'), '(SUM (, A1 B2))');
  assert.equal(p('Table1[Col]+[@Price]'), '(+ [table Table1[Col]] [table [@Price]])');
  assert.equal(p('Table1[[#This Row],[Qty]]'), '[table Table1[[#This Row],[Qty]]]');
  assert.equal(p('[1]Sheet1!A1*2'), '(* [ext [1]Sheet1!A1] 2)');
  assert.equal(p('#REF!A1+1'), '(+ #REF! 1)', 'a reference to a removed sheet');
  assert.equal(p('Sheet2!#REF!'), '#REF!');
});

test('relative references are offsets from the formula\'s cell', () => {
  const ast = F.parse('A1+$A$1', 4, 3);
  assert.deepEqual([ast.a.r0, ast.a.c0, ast.a.abs], [-4, -3, [false, false, false, false]]);
  assert.deepEqual([ast.b.r0, ast.b.c0, ast.b.abs], [0, 0, [true, true, true, true]]);
  assert.equal(p('A1', 4, 3), 'A1');
});

test('functions: names upper-cased, _xlfn. stripped, empty arguments kept', () => {
  assert.equal(p('sum(1,2)'), '(SUM 1 2)');
  assert.equal(p('_xlfn.CONCAT(A1,"x")'), '(CONCAT A1 "x")');
  assert.equal(p('_xlfn._xlws.SORT(A1:A3)'), '(SORT A1:A3)');
  assert.equal(p('IF(A1,,)'), '(IF A1 _ _)');
  assert.equal(p('SUM(1,,2)'), '(SUM 1 _ 2)');
  assert.equal(p('NOW()'), '(NOW)');
  assert.equal(p('IF(A1>0,"y",IF(A1<0,"n","z"))'), '(IF (> A1 0) "y" (IF (< A1 0) "n" "z"))');
  assert.equal(p('Model.Rate+_x.y'), '(+ Model.Rate _x.y)', 'names may hold dots and start with _');
});

test('malformed formulas throw with where it went wrong', () => {
  const fails = (text, code = 'syntax') => assert.throws(() => F.parse(text), (e) => e.code === code, text);
  for (const t of ['', '=', 'SUM(', '1+', '(1', '1)', '"abc', '{1,2;3}', '{A1}', '!A1', 'Sheet1!', 'A1:', '1 2', '*2', 'SUM(1 2)', "'Sheet 1!A1", '{1,,2}', 'A1#']) fails(t);
  fails(`${'1+'.repeat(4096)}1`, 'limit');
  fails(`${'ABS('.repeat(65)}1${')'.repeat(65)}`, 'limit');
  F.parse(`${'ABS('.repeat(64)}1${')'.repeat(64)}`);
  fails(`SUM(${Array(256).fill(1).join(',')})`, 'limit');
  F.parse(`SUM(${Array(255).fill(1).join(',')})`);
  try { F.parse('1+*2'); } catch (e) { assert.equal(e.at, 2); }
});

test('R1C1 text is the cache key: a filled-down formula parses once', () => {
  assert.equal(F.r1c1('A1', 1, 1), 'R[-1]C[-1]');
  assert.equal(F.r1c1('$A$1', 1, 1), 'R1C1');
  assert.equal(F.r1c1('A$1+$A1', 1, 1), 'R1C[-1]+R[-1]C1');
  assert.equal(F.r1c1('SUM(A1:A3)', 3, 0), 'SUM(R[-3]C:R[-1]C)');
  assert.equal(F.r1c1('A:A+$2:$2', 1, 1), 'C[-1]+R2');
  assert.equal(F.r1c1("'My Sheet'!B2", 1, 1), "'My Sheet'!RC");
  assert.equal(F.r1c1('sum( "A1" )', 0, 0), 'SUM( "A1" )');
  const a = F.compile('A1*2+SUM($B$1:B1)', 1, 1);
  const b = F.compile('B2*2+SUM($B$1:C2)', 2, 2);
  assert.equal(a.key, b.key);
  assert.equal(a.ast, b.ast, 'one AST for both');
  assert.notEqual(F.compile('A1*2', 1, 1).ast, F.compile('A1*2', 2, 2).ast);
});

test('refs lists what a formula reads, resolved to its cell', () => {
  assert.deepEqual(F.refs(F.parse('A1+SUM(Sheet2!B1:C3)+Rate+A:A', 5, 5), 5, 5), [
    { sheet: null, sheet2: null, r0: 0, c0: 0, r1: 0, c1: 0 },
    { sheet: 'Sheet2', sheet2: null, r0: 0, c0: 1, r1: 2, c1: 2 },
    { sheet: null, sheet2: null, r0: 0, c0: 0, r1: 1048575, c1: 0 },
  ]);
});

const ROW = (at, n) => ({ sheet: 'Sheet1', axis: 'row', at, n });
const COL = (at, n) => ({ sheet: 'Sheet1', axis: 'col', at, n });

test('inserting rows or columns moves the references below or right of them', () => {
  const s = (f, change, host = 'Sheet1') => F.shift(f, change, host);
  assert.equal(s('A1+A5', ROW(2, 1)), 'A1+A6');
  assert.equal(s('SUM(A2:A10)', ROW(2, 1)), 'SUM(A2:A11)', 'an insert inside a range widens it');
  assert.equal(s('SUM(A3:A10)', ROW(2, 1)), 'SUM(A4:A11)');
  assert.equal(s('SUM(A1:A2)', ROW(2, 1)), 'SUM(A1:A2)', 'an insert just below a range leaves it');
  assert.equal(s('$A$5*2', ROW(2, 3)), '$A$8*2');
  assert.equal(s('SUM(A:A)+SUM(3:5)', ROW(2, 1)), 'SUM(A:A)+SUM(4:6)');
  assert.equal(s('Other!A5', ROW(2, 1)), 'Other!A5', 'another sheet\'s cells did not move');
  assert.equal(s('Sheet1!A5', ROW(2, 1), 'Other'), 'Sheet1!A6');
  assert.equal(s("'sheet1'!A5", ROW(2, 1), 'Other'), "'sheet1'!A6");
  assert.equal(s('A5', ROW(2, 1), 'Other'), 'A5');
  assert.equal(s('  A5 +  "A5" ', ROW(2, 1)), '  A6 +  "A5" ', 'spacing and strings stay');
  assert.equal(s('SUM(Sheet1:Sheet3!A5)', ROW(2, 1)), 'SUM(Sheet1:Sheet3!A5)');
  assert.equal(s('B1+C1+A1', COL(1, 1)), 'C1+D1+A1');
  assert.equal(s('SUM(A:C)', COL(1, 2)), 'SUM(A:E)');
  assert.equal(s('A1048576', ROW(0, 1)), '#REF!', 'pushed past the last row');
  assert.equal(s('SUM(A2:A1048576)', ROW(0, 1)), 'SUM(A3:A1048576)');
  assert.equal(s('Rate+A5', ROW(0, 1)), 'Rate+A6');
});

test('deleting rows or columns pulls references up and turns deleted ones to #REF!', () => {
  const s = (f, change, host = 'Sheet1') => F.shift(f, change, host);
  assert.equal(s('A2', ROW(1, -2)), '#REF!');
  assert.equal(s('A2+1', ROW(1, -2), 'Other'), 'A2+1');
  assert.equal(s('Sheet1!A2+1', ROW(1, -2), 'Other'), 'Sheet1!#REF!+1');
  assert.equal(s('SUM(A1:A5)', ROW(1, -2)), 'SUM(A1:A3)');
  assert.equal(s('SUM(A2:A3)', ROW(1, -2)), 'SUM(#REF!)');
  assert.equal(s('A5*$A$5', ROW(1, -2)), 'A3*$A$3');
  assert.equal(s('SUM(B:D)', COL(0, -2)), 'SUM(A:B)');
  assert.equal(s('SUM(B1:B9)', COL(1, -1)), 'SUM(#REF!)');
  assert.equal(s('SUM(2:3)', ROW(1, -2)), 'SUM(#REF!)');
});

test('renaming a sheet renames its references; removing it makes them #REF!', () => {
  assert.equal(F.rename("Sheet1!A1+'Sheet1'!B2+sheet1!C3+Sheet10!A1", 'Sheet1', 'My Data'), "'My Data'!A1+'My Data'!B2+'My Data'!C3+Sheet10!A1");
  assert.equal(F.rename('Sheet1!A1*Sheet1!Rate', 'Sheet1', 'Data'), 'Data!A1*Data!Rate');
  assert.equal(F.rename("'It''s'!A1", "It's", 'Its'), 'Its!A1');
  assert.equal(F.rename('A1', 'Sheet1', 'Data'), 'A1');
  assert.equal(F.rename('SUM(Sheet1:Sheet3!A1)', 'Sheet3', 'Last'), 'SUM(Sheet1:Last!A1)');
  assert.equal(F.rename('Sheet1!A1+1', 'Sheet1', null), '#REF!A1+1');
  for (const [name, quoted] of [['Data', 'Data'], ['My Data', "'My Data'"], ['2025', "'2025'"], ['A1', "'A1'"], ['R1C1', "'R1C1'"], ["it's", "'it''s'"], ['Q1.Plan', 'Q1.Plan'], ['TRUE', "'TRUE'"]]) {
    assert.equal(F.sheetPrefix(name), `${quoted}!`, name);
  }
});

test('moving a formula shifts its relative parts only', () => {
  assert.equal(F.move('A1+$A$1+A$1+$A1', 1, 2), 'C2+$A$1+C$1+$A2');
  assert.equal(F.move('A1', -1, 0), '#REF!');
  assert.equal(F.move('Sheet2!A1', -1, 0), 'Sheet2!#REF!');
  assert.equal(F.move('SUM(A1:B2)', 2, 0), 'SUM(A3:B4)');
  assert.equal(F.move('SUM(A:A)+SUM(1:1)', 5, 1), 'SUM(B:B)+SUM(6:6)');
  assert.equal(F.move('Sheet2!A1*Rate', 1, 1), 'Sheet2!B2*Rate');
  assert.equal(F.move('A1', 0, 16383), 'XFD1');
  assert.equal(F.move('A1', 0, 16384), '#REF!');
});

test('_xlfn. prefixes come off on read and go back on write; entry text is normalized', () => {
  const file = '_xlfn.CONCAT(A1,_xlfn.IFS(TRUE,1),SUM(B1))';
  assert.equal(F.fromFile(file), 'CONCAT(A1,IFS(TRUE,1),SUM(B1))');
  assert.equal(F.toFile(F.fromFile(file)), file);
  assert.equal(F.toFile('SORT(A1:A3)+FILTER(A1:A3,B1:B3)'), '_xlfn._xlws.SORT(A1:A3)+_xlfn._xlws.FILTER(A1:A3,B1:B3)');
  assert.equal(F.fromFile('_xlfn._xlws.SORT(A1:A3)'), 'SORT(A1:A3)');
  assert.equal(F.toFile('concat(a1)'), '_xlfn.CONCAT(a1)');
  assert.equal(F.toFile('"_xlfn.X"&IFNA(1,2)'), '"_xlfn.X"&_xlfn.IFNA(1,2)');
  assert.equal(F.normalize('sum(a1:$b$2, rate) & "a1"'), 'SUM(A1:$B$2, rate) & "a1"');
  assert.ok(F.FUTURE.has('XLOOKUP') && F.FUTURE.has('STDEV.S') && !F.FUTURE.has('SUM'));
});

test('the @ operator is _xlfn.SINGLE() in a file, as Excel writes it', () => {
  for (const [glaze, file] of [
    ['@B1:B5+1', '_xlfn.SINGLE(B1:B5)+1'], ['SUM(@A1:A3,2)', 'SUM(_xlfn.SINGLE(A1:A3),2)'], ['@(A1:A3)*2', '_xlfn.SINGLE(A1:A3)*2'],
    ['@INDEX(A:A,2)%', '_xlfn.SINGLE(INDEX(A:A,2))%'], ['@ Sheet2!A1:B2', '_xlfn.SINGLE(Sheet2!A1:B2)'], ['@A1:INDEX(A:A,3)', '_xlfn.SINGLE(A1:INDEX(A:A,3))'],
    ['-@Rate^2', '-_xlfn.SINGLE(Rate)^2'], ['@@A1:A2', '_xlfn.SINGLE(_xlfn.SINGLE(A1:A2))'], ['@{1,2}', '_xlfn.SINGLE({1,2})'], ['Table1[@Col1]*2', 'Table1[@Col1]*2'],
    ['@XLOOKUP(1,A:A,B:B)', '_xlfn.SINGLE(_xlfn.XLOOKUP(1,A:A,B:B))'],
  ]) assert.equal(F.toFile(glaze), file, glaze);
  // Read back as Excel shows it: @ and its operand, in parentheses only when @ wouldn't bind all of it.
  for (const [file, glaze] of [
    ['_xlfn.SINGLE(B1:B5)+1', '@B1:B5+1'], ['_xlfn.SINGLE(_xlfn.XLOOKUP(1,A:A,B:B))*2', '@XLOOKUP(1,A:A,B:B)*2'], ['_xlfn.SINGLE(A1%)', '@(A1%)'],
    ['_xlfn.SINGLE(A1+1)', '@(A1+1)'], ['SUM(_xlfn.SINGLE(A1:INDEX(A:A,3)),2)', 'SUM(@A1:INDEX(A:A,3),2)'], ['_xlfn.SINGLE(_xlfn.SINGLE(A1:A2))', '@@A1:A2'],
    ['_xlfn.SINGLE()', '@()'],
  ]) {
    assert.equal(F.fromFile(file), glaze, file);
    if (file !== '_xlfn.SINGLE()') assert.equal(F.toFile(F.fromFile(file)), file, `${file} round trip`);
  }
  assert.deepEqual(F.parse(F.fromFile('_xlfn.SINGLE(B1:B5)')), F.parse('@B1:B5'));
});

test('the model\'s shift and rename hooks are these', () => {
  assert.equal(F.hooks.shift, F.shift);
  assert.equal(F.hooks.rename, F.rename);
  const wb = M.workbook();
  const sh = wb.sheets[0];
  M.apply(wb, { op: 'set', sheet: sh.id, r: 9, c: 0, cell: { t: 'n', v: 0, f: 'SUM(A1:A5)' } }, F.hooks);
  M.apply(wb, { op: 'insert', sheet: sh.id, axis: 'row', at: 0, n: 2 }, F.hooks);
  assert.equal(M.cell(sh, 11, 0).f, 'SUM(A3:A7)');
});

// Copying a mixed reference cannot produce row 0 or a column past XFD.
// support.microsoft.com/en-us/excel/how-to-correct-a-ref-error.
test('copying mixed-anchor ranges checks both endpoints against sheet bounds', () => {
  for (const [formula, dr, dc] of [
    ['$A$1:A2', -2, 0], ['A1:$A$2', 1048576, 0],
    ['$A$1:B1', 0, -2], ['A1:$B$1', 0, 16384],
    ['$1:2', -2, 0], ['1:$2', 1048576, 0], ['$A:B', 0, -2], ['A:$B', 0, 16384],
  ]) assert.equal(F.move(formula, dr, dc), '#REF!', formula);
});
