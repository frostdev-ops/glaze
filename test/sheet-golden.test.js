// Glaze Sheets' formula engine against Microsoft Excel. scripts/sheet-excel-golden.js writes the cases
// (test/fixtures/sheets/cases.js) into Excel, one workbook per family, has Excel calculate and save them as
// test/fixtures/sheets/<family>.xlsx, and reads what Excel cached back into test/fixtures/sheets/golden.json.
// Regenerate on a Mac with Excel after changing the cases, as the one heavy job running:
//   nice -n 10 node scripts/sheet-excel-golden.js [family …]
// Checked here: the cases themselves, the reader the harness reads workbooks with (test/helpers/xlsx-cache.cjs), the
// workbooks and golden.json against the cases, and the engine against golden.json (todo until it is wired).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const Z = require('../lib/zip.js');
const X = require('./helpers/xlsx-cache.cjs');
const { cases, families } = require('./fixtures/sheets/cases.js');

const DIR = path.join(__dirname, 'fixtures/sheets');
const GOLDEN = path.join(DIR, 'golden.json');
const VOLATILE = /(?<![\w.])(NOW|TODAY|RAND|RANDBETWEEN|RANDARRAY|INFO|CELL|OFFSET|INDIRECT)\s*\(/i;
// Excel's file prefixes for functions newer than the file format, LAMBDA/LET parameters and unknown functions.
const bare = (f) => f.replace(/_xl(fn|ws|pm|udf)\./g, '');

const xml = (s) => new TextEncoder().encode(s);
const xlsx = (parts) => Buffer.concat(Z.zip(Object.entries(parts).map(([name, s]) => ({ name, data: xml(s), date: new Date(2026, 0, 1) }))));
const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const book = (sheets, extra = {}) => xlsx({
  'xl/workbook.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook ${NS}><workbookPr date1904="1"/><sheets>${Object.keys(sheets).map((n, i) => `<sheet name="${n}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`,
  'xl/_rels/workbook.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${Object.keys(sheets).map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId99" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>`,
  'xl/sharedStrings.xml': '<sst count="5" uniqueCount="5"><si><t>a &amp; b</t></si><si><r><rPr><b/></rPr><t>bold</t></r><r><t xml:space="preserve"> and plain</t></r></si><si><t>日本</t><rPh sb="0" eb="2"><t>ニホン</t></rPh></si><si><t>line_x000D_break_x005F_x0041_</t></si><si><t/></si></sst>',
  ...Object.fromEntries(Object.values(sheets).map((body, i) => [`xl/worksheets/sheet${i + 1}.xml`, `<worksheet ${NS}><sheetData>${body}</sheetData></worksheet>`])),
  ...extra,
});

const SHEET1 = '<row r="1"><c r="A1"><v>1.5</v></c><c r="B1" t="str"><f>CONCAT("x",A1)</f><v>x1.5</v></c><c r="C1"><f t="shared" ref="C1:C3" si="0">A1*2</f><v>3</v></c>'
  + '<c r="D1"><f t="array" ref="D1:D2">A1:A2*10</f><v>15</v></c><c r="E1" t="inlineStr"><is><t>in</t><r><t>line</t></r></is></c><c r="F1" cm="1"><f t="array" ref="F1" aca="false">_xlfn.SUM(_xlfn.SEQUENCE(3))</f><v>6</v></c>'
  + '<c r="G1" s="3"/><c r="H1"><f>1+1</f></c><c r="I1"><f t="shared" ref="I1:J2" si="1">$A$1+A$1+$A1+A1</f><v>0</v></c><c r="J1"><f t="shared" si="1"/><v>0</v></c></row>'
  + '<row r="2"><c r="A2" t="s"><v>0</v></c><c r="B2" t="b"><f>TRUE</f><v>1</v></c><c r="C2"><f t="shared" si="0"/><v>0</v></c><c r="D2"><v>0</v></c><c r="I2"><f t="shared" si="1"/><v>0</v></c><c r="J2"><f t="shared" si="1"/><v>0</v></c></row>'
  + '<row r="3"><c r="A3" t="s"><v>1</v></c><c r="B3" t="e"><f>1/0</f><v>#DIV/0!</v></c><c r="C3"><f t="shared" si="0"/><v>0</v></c></row>'
  + '<row r="4"><c r="A4" t="s"><v>2</v></c><c r="B4" t="s"><v>3</v></c><c r="C4" t="s"><v>4</v></c><c r="D4" t="str"><f>""</f><v></v></c><c r="E4"><v>1E-3</v></c><c r="F4"><v>-4.0000000000000001E+300</v></c></row>';

test('reader: values, shared strings, shared and array formulas, date1904', async () => {
  const wb = await X.read(book({ One: SHEET1, 'Sheet 2': '<row r="1"><c r="A1"><v>7</v></c></row>' }));
  assert.equal(wb.date1904, true);
  assert.deepEqual(wb.sheets.map((s) => s.name), ['One', 'Sheet 2']);
  const c = wb.sheets[0].cells, at = (a) => c.get(a);
  assert.deepEqual(at('A1'), { t: 'n', v: 1.5 });
  assert.deepEqual(at('A2'), { t: 's', v: 'a & b' });
  assert.deepEqual(at('A3'), { t: 's', v: 'bold and plain' });
  assert.deepEqual(at('A4'), { t: 's', v: '日本' }, 'phonetic guides are not text');
  assert.deepEqual(at('B4'), { t: 's', v: 'line\rbreak_x0041_' }, '_xHHHH_ escapes, _x005F_ escaping an underscore');
  assert.deepEqual(at('C4'), { t: 's', v: '' });
  assert.deepEqual(at('B1'), { t: 's', v: 'x1.5', f: 'CONCAT("x",A1)' });
  assert.deepEqual(at('B2'), { t: 'b', v: true, f: 'TRUE' });
  assert.deepEqual(at('B3'), { t: 'e', v: '#DIV/0!', f: '1/0' });
  assert.deepEqual(at('D4'), { t: 's', v: '', f: '""' });
  assert.deepEqual(at('E1'), { t: 's', v: 'inline' });
  assert.deepEqual(at('E4'), { t: 'n', v: 0.001 });
  assert.deepEqual(at('F4'), { t: 'n', v: -4e300 });
  assert.equal(at('G1'), undefined, 'a styled blank is no cell');
  assert.deepEqual(at('H1'), { t: null, v: null, f: '1+1' }, 'a formula without a cached value');
  assert.deepEqual(['C1', 'C2', 'C3'].map((a) => [at(a).f, at(a).kind]), [['A1*2', 'shared'], ['A2*2', 'shared'], ['A3*2', 'shared']]);
  assert.deepEqual(['I1', 'J1', 'I2', 'J2'].map((a) => at(a).f), ['$A$1+A$1+$A1+A1', '$A$1+B$1+$A1+B1', '$A$1+A$1+$A2+A2', '$A$1+B$1+$A2+B2']);
  assert.deepEqual(at('D1'), { t: 'n', v: 15, f: 'A1:A2*10', kind: 'array', ref: 'D1:D2' });
  assert.deepEqual(at('D2'), { t: 'n', v: 0, f: 'A1:A2*10', kind: 'array', ref: 'D1:D2', master: 'D1' });
  assert.deepEqual(at('F1'), { t: 'n', v: 6, f: '_xlfn.SUM(_xlfn.SEQUENCE(3))', kind: 'array', ref: 'F1', cm: '1' });
  assert.deepEqual(wb.sheets[1].cells.get('A1'), { t: 'n', v: 7 });
});

test('reader: bounded and strict', async () => {
  await assert.rejects(X.read(book({ One: SHEET1 }), { limits: { cells: 5 } }), { name: 'RangeError', message: 'too many cells' });
  await assert.rejects(X.read(book({ One: SHEET1 }), { limits: { formula: 10 } }), { name: 'RangeError', message: 'formula too long' });
  await assert.rejects(X.read(book({ One: SHEET1 }), { limits: { strings: 2 } }), { name: 'RangeError', message: 'too many shared strings' });
  await assert.rejects(X.read(book({ A: '', B: '', C: '' }), { limits: { sheets: 2 } }), { name: 'RangeError', message: 'too many sheets' });
  await assert.rejects(X.read(book({ One: '<row r="1"><c r="A1" t="s"><v>9</v></c></row>' })), /shared string 9 out of range/);
  await assert.rejects(X.read(book({ One: '<row r="1"><c r="A1"><v>abc</v></c></row>' })), /bad number/);
  await assert.rejects(X.read(book({ One: '<row r="1"><c r="B1"><f t="shared" si="4"/><v>1</v></c></row>' })), /shared formula 4 has no master/);
  await assert.rejects(X.read(book({ One: '<row r="1"><c r="XFE1"><v>1</v></c></row>' })), /bad cell reference/);
  await assert.rejects(X.read(xlsx({ 'word/document.xml': '<w:document/>' })), /not an Excel workbook/);
  await assert.rejects(X.read(xml('not a zip at all, long enough to look for an end record in it')), /not a zip file/);
});

test('reader: a formula moved as Excel fills it', () => {
  const cases = [
    ['A1*2', 2, 0, 'A3*2'],
    ['$A$1+A$1+$A1+A1', 1, 1, '$A$1+B$1+$A2+B2'],
    ['SUM(Data!A1:B2)', 1, 0, 'SUM(Data!A2:B3)'],
    ["'Sheet 2'!A1+'it''s'!B1", 0, 1, "'Sheet 2'!B1+'it''s'!C1"],
    ['SUM(Jan:Mar!B2)', 1, 0, 'SUM(Jan:Mar!B3)'],
    ['SUM(S1:S3!B2)+S1!A1', 1, 1, 'SUM(S1:S3!C3)+S1!B2'],
    ['LOG10(A1)+ATAN2(B1,C1)+DAYS360(A1,A2)', 1, 0, 'LOG10(A2)+ATAN2(B2,C2)+DAYS360(A2,A3)'],
    ['"A1"&A1&"say ""B2"""', 1, 0, '"A1"&A2&"say ""B2"""'],
    ['SUM(A:A)+SUM($B:C)+SUM(1:1)+SUM($2:3)', 1, 1, 'SUM(B:B)+SUM($B:D)+SUM(2:2)+SUM($2:4)'],
    ['1.5E+3*A1+.5', 1, 0, '1.5E+3*A2+.5'],
    ['_xlfn.XLOOKUP(A1,B1:B3,C1:C3)', 0, 1, '_xlfn.XLOOKUP(B1,C1:C3,D1:D3)'],
    ['Table1[@Col1]+A1', 1, 0, 'Table1[@Col1]+A2'],
    ['IFERROR(#N/A,#REF!)+A1', 0, 1, 'IFERROR(#N/A,#REF!)+B1'],
    ['{1,2;3,4}', 5, 5, '{1,2;3,4}'],
    ['A1', -1, 0, '#REF!'],
    ['XFD1', 0, 1, '#REF!'],
    ['TRUE+R2D2+TAX2019', 1, 0, 'TRUE+R2D2+TAX2020'],
  ];
  for (const [f, dr, dc, want] of cases) assert.equal(X.shift(f, dr, dc), want, `${f} by ${dr},${dc}`);
});

test('reader: inline phonetics and empty strings', async () => {
  const wb = await X.read(book({ One: '<row r="1">'
    + '<c r="A1" t="inlineStr"><is><r><t>日</t></r><r><t>本</t></r><rPh sb="0" eb="2"><t>ニホン</t></rPh></is></c>'
    + '<c r="B1" t="inlineStr"><is><t/></is></c></row>' }));
  const c = wb.sheets[0].cells;
  assert.deepEqual(c.get('A1'), { t: 's', v: '日本' });
  assert.deepEqual(c.get('B1'), { t: 's', v: '' });
});

test('reader: missing typed caches are blank, ISO dates and false retain their types', async () => {
  const wb = await X.read(book({ One: '<row r="1">'
    + '<c r="C1" s="1" t="s"/><c r="D1" s="1" t="b"/><c r="E1" s="1" t="e"/><c r="F1" s="1" t="d"/>'
    + '<c r="G1" t="str"><f>"x"</f></c><c r="H1" t="b"><f>TRUE()</f></c>'
    + '<c r="I1" t="d"><v>2026-10-30T00:00:00Z</v></c><c r="J1" t="b"><v>0</v></c></row>' }));
  const c = wb.sheets[0].cells;
  for (const at of ['C1', 'D1', 'E1', 'F1']) assert.equal(c.get(at), undefined, at);
  assert.deepEqual(c.get('G1'), { t: null, v: null, f: '"x"' });
  assert.deepEqual(c.get('H1'), { t: null, v: null, f: 'TRUE()' });
  assert.deepEqual(c.get('I1'), { t: 'd', v: '2026-10-30T00:00:00Z' });
  assert.deepEqual(c.get('J1'), { t: 'b', v: false });
});

test('reader: empty shared strings count toward limits', async () => {
  await assert.rejects(X.read(book({ One: '' }, { 'xl/sharedStrings.xml': '<sst><si/><si/><si/></sst>' }),
    { limits: { strings: 2 } }), /too many shared strings/);
});

test('reader: styled blanks count toward limits', async () => {
  await assert.rejects(X.read(book({ One: '<row r="1"><c r="A1" s="1"/><c r="B1" s="1"/><c r="C1" s="1"/></row>' }),
    { limits: { cells: 2 } }), /too many cells/);
});

test('reader: array expansion is bounded even without cached followers', async () => {
  await assert.rejects(X.read(book({ One: '<row r="1"><c r="A1"><f t="array" ref="A1:D4">1</f><v>1</v></c></row>' }),
    { limits: { cells: 5 } }), /too many array cells/);
});

test('reader: invalid array ranges are rejected', async () => {
  await assert.rejects(X.read(book({ One: '<row r="1"><c r="A1"><f t="array" ref="bad">1</f><v>1</v></c></row>' })), /bad array range/);
});

test('reader: expanded shared formulas respect the formula limit', async () => {
  await assert.rejects(X.read(book({ One: '<row r="1"><c r="A1"><f t="shared" si="0" ref="A1:A100">B1</f><v>1</v></c></row>'
    + '<row r="100"><c r="A100"><f t="shared" si="0"/><v>1</v></c></row>' }), { limits: { formula: 2 } }), /formula too long/);
});

test('reader: dimensions do not hide cells and archive budgets pass through', async () => {
  const bytes = book({ One: '<row r="99"><c r="Z99"><v>7</v></c></row>' }, {
    'xl/worksheets/sheet1.xml': `<worksheet ${NS}><dimension ref="A1"/><sheetData><row r="99"><c r="Z99"><v>7</v></c></row></sheetData></worksheet>`,
  });
  assert.deepEqual((await X.read(bytes)).sheets[0].cells.get('Z99'), { t: 'n', v: 7 });
  for (const limits of [{ input: 10 }, { entries: 1 }, { entry: 10 }, { total: 10 }]) {
    await assert.rejects(X.read(bytes, { limits }), RangeError);
  }
});

// ---- the cases ----------------------------------------------------------------------------------------------------
// Every reference a case's formula spells out: { sheets: [names], c0, r0, c1, r1 } (rows or columns null for whole
// columns or rows). A reference without a sheet comes back with sheets null.
const references = (f) => {
  const out = [];
  let i = 0;
  const n = f.length, edge = (k) => k === 0 || !/[\w.$]/.test(f[k - 1]);
  const CELLS = /^\$?([A-Za-z]{1,3})\$?(\d{1,7})(?::\$?([A-Za-z]{1,3})\$?(\d{1,7}))?(?![\w.(!])/;
  const COLS = /^\$?([A-Za-z]{1,3}):\$?([A-Za-z]{1,3})(?![\w.(!])/, ROWS = /^\$?(\d{1,7}):\$?(\d{1,7})(?![\w.(!])/;
  while (i < n) {
    let sheets = null, m;
    if (f[i] === '"') { let j = i + 1; for (; j < n; j++) if (f[j] === '"') { if (f[j + 1] === '"') j++; else break; } i = j + 1; continue; }
    if (f[i] === "'") {
      let j = i + 1;
      for (; j < n; j++) if (f[j] === "'") { if (f[j + 1] === "'") j++; else break; }
      if (f[j + 1] !== '!') throw Error(`quoted text outside a string in ${f}`);
      sheets = f.slice(i + 1, j).replace(/''/g, "'").split(':');
      i = j + 2;
    } else if (edge(i) && (m = /^([A-Za-z_][\w.]*(?::[A-Za-z_][\w.]*)?)!/.exec(f.slice(i)))) { sheets = m[1].split(':'); i += m[0].length; }
    const rest = f.slice(i);
    if ((sheets || edge(i)) && (m = CELLS.exec(rest))) {
      const a = X.parseAddress(m[1] + m[2]), b = m[3] ? X.parseAddress(m[3] + m[4]) : a;
      out.push({ sheets, c0: Math.min(a.c, b.c), r0: Math.min(a.r, b.r), c1: Math.max(a.c, b.c), r1: Math.max(a.r, b.r) });
      i += m[0].length; continue;
    }
    if ((sheets || edge(i)) && (m = COLS.exec(rest))) { out.push({ sheets, c0: X.colNumber(m[1]), c1: X.colNumber(m[2]), r0: null, r1: null }); i += m[0].length; continue; }
    if ((sheets || edge(i)) && (m = ROWS.exec(rest))) { out.push({ sheets, r0: +m[1], r1: +m[2], c0: null, c1: null }); i += m[0].length; continue; }
    if (sheets) throw Error(`a sheet name without a reference in ${f}`);
    if ((m = /^#[A-Za-z0-9_/]+[!?]?/.exec(rest)) || (m = /^(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(rest)) || (m = /^[A-Za-z_\\][\w.\\]*/.exec(rest))) { i += m[0].length; continue; }
    i++;
  }
  return out;
};

const byFamily = Map.groupBy(cases, (c) => c.family);
const VALUE = (v) => v === null || typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean'
  || (v && typeof v === 'object' && Object.keys(v).length === 1 && (/^#(NULL!|DIV\/0!|VALUE!|REF!|NAME\?|NUM!|N\/A)$/.test(v.e) || /^=/.test(v.f)));

test('cases: about 800, every family the design lists, ids and cells unique', () => {
  assert.ok(cases.length >= 800, `${cases.length} cases`);
  for (const f of ['math', 'stats', 'logical', 'lookup', 'text', 'date', 'info', 'financial', 'coerce', 'criteria', 'refs', 'format', 'date1904']) {
    assert.ok(byFamily.get(f)?.length >= 20, `${f}: ${byFamily.get(f)?.length || 0} cases`);
  }
  assert.deepEqual([...byFamily.keys()].sort(), Object.keys(families).sort());
  assert.equal(new Set(cases.map((c) => c.id)).size, cases.length, 'ids are unique');
  for (const c of cases) {
    assert.match(c.id, /^[a-z0-9]+\.[a-z0-9.]+\.\d+$/, c.id);
    assert.ok(families[c.family].sheets.includes(c.sheet), `${c.id}: sheet ${c.sheet}`);
    assert.ok(X.parseAddress(c.cell), `${c.id}: cell ${c.cell}`);
    assert.equal(typeof c.note, 'string', c.id);
  }
  for (const [f, list] of byFamily) assert.equal(new Set(list.map((c) => `${c.sheet}!${c.cell}`)).size, list.length, `${f}: one case per cell`);
});

test('cases: deterministic formulas within Excel limits', () => {
  for (const c of cases) {
    assert.match(c.formula, /^=/, c.id);
    assert.ok(c.formula.length <= 8192, c.id);
    for (const f of [c.formula, ...Object.values(c.inputs).filter((v) => v?.f).map((v) => v.f)]) {
      assert.doesNotMatch(f.replace(/"(?:[^"]|"")*"/g, ''), VOLATILE, `${c.id} is volatile`);
      if (/^=SUMIF\(/i.test(f)) {
        const [range, sum = range] = references(f);
        assert.equal(sum.r1 - sum.r0, range.r1 - range.r0, `${c.id}: no volatile SUMIF range expansion`);
        assert.equal(sum.c1 - sum.c0, range.c1 - range.c0, `${c.id}: no volatile SUMIF range expansion`);
      }
    }
    assert.doesNotMatch(c.formula, /_xl(fn|ws|pm|udf)\./, `${c.id}: written as typed, without file prefixes`);
    if (c.unsupported != null) assert.ok(typeof c.unsupported === 'string' && c.unsupported, `${c.id}: unsupported holds Excel's message`);
  }
});

test('cases: nonempty TEXT format codes pin en-US', () => {
  for (const c of cases.filter((c) => /^=TEXT\(/.test(c.formula))) {
    const m = /^=TEXT\([^,]+,"((?:""|[^"])*)"\)$/.exec(c.formula);
    assert.ok(m, `${c.id}: a literal format code`);
    if (m[1]) assert.match(m[1], /^\[\$-409\]/i, `${c.id}: ${m[1]}`);
  }
});

test('cases: fills and array formulas cover their ranges', () => {
  for (const key of ['fill', 'array']) {
    const groups = Map.groupBy(cases.filter((c) => c[key]), (c) => `${c.family} ${c[key]}`);
    for (const [name, list] of groups) {
      const r = X.parseRange(list[0][key]);
      assert.ok(r, name);
      assert.equal(list.length, (r.r1 - r.r0 + 1) * (r.c1 - r.c0 + 1), `${name}: a case for every cell`);
      const first = list.find((c) => c.cell === X.colName(r.c0) + r.r0);
      assert.ok(first, `${name}: a case at its first cell`);
      for (const c of list) {
        const p = X.parseAddress(c.cell);
        assert.ok(p.r >= r.r0 && p.r <= r.r1 && p.c >= r.c0 && p.c <= r.c1, `${c.id} inside ${c[key]}`);
        if (key === 'array') assert.equal(c.formula, first.formula, `${c.id}: one formula for the array`);
        else assert.equal(c.formula.slice(1), X.shift(first.formula.slice(1), p.r - r.r0, p.c - r.c0), `${c.id}: the first cell's formula, filled`);
      }
    }
  }
});

test('cases: inputs agree within a family and cover every cell a formula names', () => {
  for (const [family, list] of byFamily) {
    const sheets = families[family].sheets, cells = new Set(list.map((c) => `${c.sheet}!${c.cell}`));
    const seen = new Map();
    for (const c of list) for (const [at, v] of Object.entries(c.inputs)) {
      const [sheet, cell] = [at.slice(0, at.lastIndexOf('!')), at.slice(at.lastIndexOf('!') + 1)];
      assert.ok(sheets.includes(sheet) && X.parseAddress(cell), `${c.id}: input ${at}`);
      assert.ok(VALUE(v), `${c.id}: input ${at} is ${JSON.stringify(v)}`);
      assert.ok(!cells.has(at), `${c.id}: input ${at} is a case's cell`);
      if (seen.has(at)) assert.deepEqual(v, seen.get(at), `${c.id}: ${at} differs from another case's`);
      else seen.set(at, v);
    }
    for (const c of list) for (const ref of references(c.formula)) {
      assert.ok(ref.sheets, `${c.id}: every reference names its sheet (${c.formula})`);
      const span = ref.sheets.length === 1 ? ref.sheets : sheets.slice(sheets.indexOf(ref.sheets[0]), sheets.indexOf(ref.sheets[1]) + 1);
      assert.ok(span.length && span.every((s) => sheets.includes(s)), `${c.id}: sheets ${ref.sheets}`);
      for (const s of span) {
        if (ref.r0 == null || ref.c0 == null) {
          // A whole row or column reads every cell the family fills in it.
          for (const at of seen.keys()) {
            const [sheet, cell] = [at.slice(0, at.lastIndexOf('!')), X.parseAddress(at.slice(at.lastIndexOf('!') + 1))];
            const inside = sheet === s && (ref.r0 == null ? cell.c >= ref.c0 && cell.c <= ref.c1 : cell.r >= ref.r0 && cell.r <= ref.r1);
            if (inside) assert.ok(at in c.inputs, `${c.id}: reads ${at} through a whole row or column`);
          }
          continue;
        }
        assert.ok((ref.r1 - ref.r0 + 1) * (ref.c1 - ref.c0 + 1) <= 4096, `${c.id}: a range that large reads cells no input names`);
        for (let r = ref.r0; r <= ref.r1; r++) for (let k = ref.c0; k <= ref.c1; k++) {
          const at = `${s}!${X.colName(k)}${r}`;
          assert.ok(at in c.inputs, `${c.id}: reads ${at}, which its inputs don't name (null for a blank)`);
        }
      }
    }
  }
});

// ---- the workbooks Excel saved, and golden.json ---------------------------------------------------------------------
const golden = fs.existsSync(GOLDEN) ? JSON.parse(fs.readFileSync(GOLDEN, 'utf8')) : null;
const WAIT = golden ? false : 'golden.json not generated yet: run scripts/sheet-excel-golden.js on a Mac with Excel';
const input = (v) => (v === null ? undefined : typeof v === 'number' ? { t: 'n', v } : typeof v === 'string' ? { t: 's', v } : typeof v === 'boolean' ? { t: 'b', v } : v.e ? { t: 'e', v: v.e } : null);

test('golden: every case is in its workbook as written, with the value Excel cached', { todo: WAIT }, async () => {
  assert.ok(golden, WAIT);
  const ids = new Set(cases.filter((c) => c.unsupported == null).map((c) => c.id));
  assert.deepEqual(Object.keys(golden).filter((id) => !ids.has(id)), [], 'golden.json holds only cases Excel took');
  for (const [family, list] of byFamily) {
    const file = path.join(DIR, `${family}.xlsx`);
    const size = fs.statSync(file).size;
    assert.ok(size < 100 * 1024, `${family}.xlsx is ${size} bytes`);
    const wb = await X.read(fs.readFileSync(file));
    assert.equal(wb.date1904, !!families[family].date1904, `${family}: date1904`);
    assert.deepEqual(wb.sheets.map((s) => s.name), families[family].sheets, `${family}: sheets in order`);
    const sheet = (name) => wb.sheets.find((s) => s.name === name).cells;
    for (const c of list) {
      const cell = sheet(c.sheet).get(c.cell);
      if (c.unsupported != null) { assert.ok(!cell?.f, `${c.id}: Excel refused it, yet the cell holds a formula`); continue; }
      assert.ok(cell?.f != null, `${c.id}: no formula at ${c.sheet}!${c.cell}`);
      assert.equal(bare(cell.f), c.formula.slice(1), `${c.id}: the formula Excel saved`);
      if (c.array) assert.equal(cell.ref, c.array, `${c.id}: array formula over ${c.array}`);
      else if (cell.kind === 'array') assert.equal(cell.ref, c.cell, `${c.id}: spills over ${cell.ref}`);
      assert.ok(cell.t != null, `${c.id}: no cached value`);
      assert.notEqual(cell.v, '#SPILL!', `${c.id} spills`);
      const g = golden[c.id];
      assert.ok(g, `${c.id}: not in golden.json`);
      assert.deepEqual({ t: g.t, v: g.v }, { t: cell.t, v: cell.v }, `${c.id}: golden.json against the workbook`);
      assert.equal(typeof g.text, 'string', `${c.id}: the text Excel showed`);
    }
    // The inputs as Excel stored them: a text that looks like a number or a date stays text.
    const inputs = Object.assign({}, ...list.map((c) => c.inputs));
    for (const [at, v] of Object.entries(inputs)) {
      const k = at.lastIndexOf('!'), cell = sheet(at.slice(0, k)).get(at.slice(k + 1));
      if (v === null) { assert.equal(cell, undefined, `${family}: ${at} is blank`); continue; }
      if (v.f) { assert.equal(bare(cell?.f ?? ''), v.f.slice(1), `${family}: ${at} holds ${v.f}`); continue; }
      assert.deepEqual(cell && { t: cell.t, v: cell.v }, input(v), `${family}: input ${at}`);
    }
  }
});

// ---- the engine -----------------------------------------------------------------------------------------------------
// Two results are the same when their types are and, for numbers, they agree to 1e-12 of the larger magnitude
// (so Excel's exact zero needs an exact zero).
const same = (want, got) => !!want && !!got && want.t === got.t && (want.t === 'n'
  ? Number.isFinite(want.v) && Number.isFinite(got.v) && Math.abs(want.v - got.v) <= 1e-12 * Math.max(Math.abs(want.v), Math.abs(got.v))
  : want.v === got.v);

test('engine comparison: 1e-12 relative, types strict', () => {
  assert.ok(same({ t: 'n', v: 0.1 + 0.2 }, { t: 'n', v: 0.3 }));
  assert.ok(same({ t: 'n', v: 1e300 }, { t: 'n', v: 1e300 * (1 + 5e-13) }));
  assert.ok(!same({ t: 'n', v: 1 }, { t: 'n', v: 1 + 2e-12 }));
  assert.ok(!same({ t: 'n', v: 0 }, { t: 'n', v: 1e-17 }));
  assert.ok(!same({ t: 'n', v: 1 }, { t: 's', v: '1' }));
  assert.ok(!same({ t: 's', v: 'a' }, { t: 's', v: 'A' }));
  assert.ok(same({ t: 'e', v: '#N/A' }, { t: 'e', v: '#N/A' }));
  assert.ok(!same({ t: 'b', v: true }, { t: 'n', v: 1 }));
  assert.ok(!same({ t: 'n', v: 1 }, undefined));
  for (const v of [Infinity, -Infinity, NaN, '1', null]) {
    assert.ok(!same({ t: 'n', v: 1 }, { t: 'n', v }), `invalid engine number ${v}`);
  }
});

// The engine's entry, wired once lane A's calc (lib/sheet-calc.js, S4) lands: the family's inputs and formulas in, each
// case's { t, v } out.
const ENGINE = fs.existsSync(path.join(__dirname, '../lib/sheet-calc.js'));
const run = () => { throw Error('not wired'); };
const REASON = ENGINE ? 'lib/sheet-calc.js exists: wire its entry into run() here' : 'lib/sheet-calc.js is not built yet (lane A, S4)';

for (const [family, list] of byFamily) {
  test(`engine against Excel: ${family}`, async (t) => {
    for (const c of list) {
      if (c.unsupported != null) continue;
      await t.test(c.id, { todo: REASON }, () => {
        if (!ENGINE) return;
        const got = run(family, c);
        assert.ok(same(golden?.[c.id], got), `${c.formula}: Excel ${JSON.stringify(golden?.[c.id])}, engine ${JSON.stringify(got)}`);
      });
    }
  });
}
