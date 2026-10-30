// Glaze Sheets' .xlsx and CSV files (lib/sheet-xlsx.js): the 13 workbooks Excel saved for the golden harness
// (test/fixtures/sheets) read against golden.json and cases.js, a synthetic workbook for each styles, theme, sheet and
// package case, and what is kept byte for byte.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const Z = require('../lib/zip.js');
const M = require('../lib/sheet-model.js');
const X = require('../lib/sheet-xlsx.js');
const { cases, families } = require('./fixtures/sheets/cases.js');

const DIR = path.join(__dirname, 'fixtures/sheets');
const golden = JSON.parse(fs.readFileSync(path.join(DIR, 'golden.json'), 'utf8'));
const at = (wb, sheet, a) => { const sh = M.getSheet(wb, sheet); const [r, c] = M.cellPosition(a); return M.cell(sh, r, c); };
const input = (v) => (typeof v === 'number' ? { t: 'n', v } : typeof v === 'string' ? { t: 's', v } : typeof v === 'boolean' ? { t: 'b', v } : v.e ? { t: 'e', v: v.e } : null);

// ── The golden workbooks ──────────────────────────────────────────────────────────────────────────────────────────────
const byFamily = new Map();
for (const c of cases) { if (!byFamily.has(c.family)) byFamily.set(c.family, []); byFamily.get(c.family).push(c); }

for (const [family, list] of byFamily) {
  test(`golden ${family}.xlsx: every case's formula, type and cached value, every input`, async () => {
    const wb = await X.read(fs.readFileSync(path.join(DIR, `${family}.xlsx`)));
    assert.deepEqual(wb.keep.problems, []);
    assert.equal(wb.date1904, !!families[family].date1904);
    assert.deepEqual(wb.sheets.map((s) => s.name), families[family].sheets);
    for (const c of list) {
      const cell = at(wb, c.sheet, c.cell);
      if (c.unsupported != null) { assert.equal(cell?.f, undefined, `${c.id}: refused by Excel`); continue; }
      const head = c.array ? at(wb, c.sheet, c.array.split(':')[0]) : cell;
      assert.equal(head?.f, c.formula.slice(1), `${c.id}: formula, _xlfn. and _xlpm. off`);
      if (c.array) assert.equal(head.a, c.array, `${c.id}: legacy array over ${c.array}, its first cell holding it`);
      if (head !== cell) assert.equal(cell.f, undefined, `${c.id}: the array's other cells are values`);
      const g = golden[c.id];
      assert.deepEqual({ t: cell.t, v: cell.v }, { t: g.t, v: g.v }, `${c.id}: cached value`);
    }
    for (const [where, v] of Object.entries(Object.assign({}, ...list.map((c) => c.inputs)))) {
      const k = where.lastIndexOf('!'), cell = at(wb, where.slice(0, k), where.slice(k + 1));
      if (v === null) { assert.equal(cell, null, `${where} blank`); continue; }
      if (v.f) { assert.equal(cell?.f, v.f.slice(1), where); continue; }
      assert.deepEqual(cell && { t: cell.t, v: cell.v }, input(v), `input ${where}`);
    }
  });
}

test('golden: fills read as one formula per cell, dynamic arrays keep their cell metadata', async () => {
  let fills = 0, dynamic = 0;
  const filled = cases.filter((x) => x.fill && x.unsupported == null).length;
  for (const [family, list] of byFamily) {
    const wb = await X.read(fs.readFileSync(path.join(DIR, `${family}.xlsx`)));
    for (const c of list.filter((x) => x.fill && x.unsupported == null)) { fills++; assert.equal(at(wb, c.sheet, c.cell).f, c.formula.slice(1), c.id); }
    for (const sh of wb.sheets) for (const [r, row] of sh.rows) for (const [col, x] of row) {
      if (x.cm === undefined) continue;
      dynamic++;
      assert.ok(x.a && M.rangePosition(x.a).r0 === r && M.rangePosition(x.a).c0 === col, `${family} ${sh.name}!${M.cellName(r, col)} heads its array`);
      assert.ok(wb.keep.parts['xl/metadata.xml'], 'the metadata part the cells point at is kept');
    }
  }
  assert.equal(fills, filled);
  assert.ok(fills >= 18, `${fills} filled cells`);
  assert.equal(dynamic, 36, 'every cm="1" cell the 13 workbooks hold');
});

test('golden: sheet, style and package facts', async () => {
  const wb = await X.read(fs.readFileSync(path.join(DIR, 'financial.xlsx')));
  assert.deepEqual(wb.styles, [{}, { quote: true }, { fmt: 8 }, { fmt: 9 }]);
  assert.equal(wb.active, 1, 'Excel saved with the second tab active');
  const cases1 = wb.sheets[0];
  assert.equal(cases1.colW.get(0), 80.83203125, 'the file\'s width, in its characters');
  assert.deepEqual(cases1.keep.defaults, { colW: 10.7109375, rowH: 16 }, 'baseColWidth 10 with its padding, defaultRowHeight 16 pt');
  assert.equal(cases1.freeze, null);
  assert.deepEqual(cases1.merges, []);
  assert.deepEqual(cases1.keep.xml.map((x) => x.name), ['sheetFormatPr', 'pageMargins']);
  assert.deepEqual(Object.keys(wb.keep.parts).sort(), ['docProps/core.xml', 'xl/theme/theme1.xml']);
  assert.deepEqual(wb.keep.flags, { macros: false, pivots: false, external: false, slicers: false });
  const lookup = await X.read(fs.readFileSync(path.join(DIR, 'lookup.xlsx')));
  assert.ok(Object.keys(lookup.keep.parts).some((p) => p.startsWith('xl/richData/')), 'rich values Excel keeps for errors');
  assert.ok([...lookup.sheets[0].rows.values()].some((row) => [...row.values()].some((x) => x.vm !== undefined)));
});

// ── Synthetic workbooks ───────────────────────────────────────────────────────────────────────────────────────────────
const enc = new TextEncoder();
const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const RT = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const pack = (parts) => Buffer.concat(Z.zip(Object.entries(parts).map(([name, s]) => ({ name, data: typeof s === 'string' ? enc.encode(s) : s, date: new Date(2026, 0, 1) }))));
const rels = (list) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${list.map(([id, type, target, mode]) => `<Relationship Id="${id}" Type="${type.includes('/') ? type : `${RT}/${type}`}" Target="${target}"${mode ? ` TargetMode="${mode}"` : ''}/>`).join('')}</Relationships>`;
const THEME = `<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="T"><a:themeElements><a:clrScheme name="T">
<a:dk1><a:sysClr val="windowText" lastClr="111111"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FEFEFE"/></a:lt1><a:dk2><a:srgbClr val="44546A"/></a:dk2><a:lt2><a:srgbClr val="E7E6E6"/></a:lt2>
<a:accent1><a:srgbClr val="4472C4"/></a:accent1><a:accent2><a:srgbClr val="ED7D31"/></a:accent2><a:accent3><a:srgbClr val="A5A5A5"/></a:accent3><a:accent4><a:srgbClr val="FFC000"/></a:accent4>
<a:accent5><a:srgbClr val="5B9BD5"/></a:accent5><a:accent6><a:srgbClr val="70AD47"/></a:accent6><a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink>
</a:clrScheme></a:themeElements></a:theme>`;
const STYLES = `<styleSheet ${NS}>
<numFmts count="3"><numFmt numFmtId="164" formatCode="0.000&quot; kg&quot;"/><numFmt numFmtId="165" formatCode="[Red]#,##0;(#,##0)"/><numFmt numFmtId="8" formatCode="&quot;$&quot;#,##0.00_);[Red]\\(&quot;$&quot;#,##0.00\\)"/></numFmts>
<fonts count="5"><font><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/><scheme val="minor"/></font>
<font><b/><i/><u val="double"/><strike/><sz val="14"/><color theme="4" tint="-0.249977111117893"/><name val="Calibri"/><family val="2"/><scheme val="minor"/></font>
<font><sz val="9"/><color rgb="FFFF0000"/><name val="Arial"/><family val="2"/></font>
<font><vertAlign val="superscript"/><sz val="11"/><color indexed="10"/><name val="Calibri"/><family val="2"/><scheme val="minor"/></font>
<font><b val="0"/><u/><sz val="11"/><color theme="0" tint="0.39997558519241921"/><name val="Calibri"/><family val="2"/><scheme val="minor"/></font></fonts>
<fills count="6"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFFFFF00"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="darkGrid"><fgColor theme="5"/><bgColor indexed="9"/></patternFill></fill>
<fill><gradientFill degree="90"><stop position="0"><color theme="0"/></stop><stop position="1"><color theme="4"/></stop></gradientFill></fill>
<fill><patternFill patternType="solid"><fgColor indexed="8"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="3"><border><left/><right/><top/><bottom/><diagonal/></border>
<border diagonalUp="1"><left style="thin"><color indexed="64"/></left><right style="medium"><color rgb="FF00FF00"/></right><top style="dashed"/><bottom style="double"><color theme="3"/></bottom><diagonal style="hair"><color auto="1"/></diagonal></border>
<border><left/><right/><top/><bottom style="thick"><color indexed="12"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/><xf numFmtId="0" fontId="4" fillId="0" borderId="0" applyNumberFormat="0" applyFill="0" applyBorder="0" applyAlignment="0" applyProtection="0"/></cellStyleXfs>
<cellXfs count="12"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="164" fontId="1" fillId="2" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="14" fontId="2" fillId="3" borderId="2" xfId="0"/>
<xf numFmtId="165" fontId="3" fillId="4" borderId="0" xfId="0"><alignment horizontal="center" vertical="top" wrapText="1" indent="2" textRotation="45" shrinkToFit="1" readingOrder="2"/></xf>
<xf numFmtId="8" fontId="4" fillId="5" borderId="0" xfId="1"><alignment horizontal="general" vertical="bottom"/><protection locked="0" hidden="1"/></xf>
<xf numFmtId="49" fontId="0" fillId="1" borderId="0" xfId="0" quotePrefix="1"/>
<xf numFmtId="30" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="22" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"><alignment horizontal="right"/></xf>
<xf numFmtId="10" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="999" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>
<cellStyles count="2"><cellStyle name="Normal" xfId="0" builtinId="0"/><cellStyle name="Accent" xfId="1" builtinId="29"/></cellStyles>
<dxfs count="1"><dxf><font><b/><color rgb="FF9C0006"/></font><fill><patternFill><bgColor rgb="FFFFC7CE"/></patternFill></fill></dxf></dxfs>
<tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/>
<colors><indexedColors>${[...Array(64)].map((_, i) => `<rgbColor rgb="${i === 10 ? 'FF123456' : i === 12 ? 'FFABCDEF' : 'FF000000'}"/>`).join('')}</indexedColors></colors>
</styleSheet>`;
const SST = `<sst ${NS} count="6" uniqueCount="5"><si><t>plain &amp; simple</t></si>
<si><r><t xml:space="preserve">Bold </t></r><r><rPr><b/><sz val="12"/><color theme="4"/><rFont val="Calibri"/><family val="2"/><scheme val="minor"/></rPr><t>blue</t></r><r><rPr><i/><vertAlign val="subscript"/><sz val="11"/><rFont val="Arial"/></rPr><t xml:space="preserve"> sub</t></r></si>
<si><t>日本</t><rPh sb="0" eb="2"><t>ニホン</t></rPh><phoneticPr fontId="1"/></si><si><t>a_x000D_b_x005F_x0041_</t></si><si><t/></si></sst>`;
const SHEET1 = `<worksheet ${NS} xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:x14ac="http://schemas.microsoft.com/office/spreadsheetml/2009/9/ac" mc:Ignorable="x14ac">
<sheetPr><tabColor rgb="FFFF0000"/></sheetPr><dimension ref="A1:H9"/>
<sheetViews><sheetView tabSelected="1" zoomScale="125" workbookViewId="0"><pane xSplit="2" ySplit="1" topLeftCell="C2" activePane="bottomRight" state="frozen"/><selection pane="topRight" activeCell="C1" sqref="C1"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/><selection pane="bottomRight" activeCell="D5" sqref="D5"/></sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="15" x14ac:dyDescent="0.25"/>
<cols><col min="1" max="1" width="20.7109375" customWidth="1"/><col min="2" max="3" width="0" hidden="1" customWidth="1"/><col min="5" max="5" width="9.140625" style="3"/></cols>
<sheetData>
<row r="1" spans="1:8" ht="30" customHeight="1"><c r="A1" s="1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c><c r="D1" t="s"><v>3</v></c><c r="E1" t="s"><v>4</v></c><c r="F1" t="inlineStr"><is><t>in</t></is></c><c r="G1" t="inlineStr"><is><r><rPr><b/></rPr><t>B</t></r><r><t>c</t></r></is></c><c r="H1" s="2"/></row>
<row r="2" hidden="1"><c r="A2"><v>1.5</v></c><c r="B2" t="b"><v>1</v></c><c r="C2" t="e"><v>#N/A</v></c><c r="D2" t="d"><v>2026-10-30T12:00:00Z</v></c><c r="E2"><v>-4.0000000000000001E+300</v></c><c r="F2" t="str"><f>"x"&amp;A2</f><v>x1.5</v></c><c r="G2" t="b"><f>A2&gt;1</f><v>1</v></c><c r="H2" t="e"><f>1/0</f><v>#DIV/0!</v></c></row>
<row r="3" ht="12.75" s="4" customFormat="1" outlineLevel="1"><c r="A3"><f t="shared" ref="A3:B4" si="0">$A$2+A2+$A2+A$2</f><v>6</v></c><c r="B3"><f t="shared" si="0"/><v>0</v></c><c r="C3"><f t="array" ref="C3:C4">A2:A3*2</f><v>3</v></c><c r="D3"><f>_xlfn.LET(_xlpm.x,2,_xlpm.x*_xlfn.XLOOKUP(1,A2:A3,A2:A3))</f><v>3</v></c><c r="E3"><f>SUM(Table1[Qty])+[1]Other!A1</f><v>9</v></c></row>
<row r="4"><c r="A4"><f t="shared" si="0"/><v>0</v></c><c r="B4"><f t="shared" si="0"/><v>0</v></c><c r="C4"><v>0</v></c><c r="D4"><f t="dataTable" ref="D4:D5" dt2D="0" dtr="0" r1="A2"/><v>7</v></c></row>
<row><c><v>10</v></c><c><v>11</v></c><c s="5" t="s"><v>0</v></c><c r="D5"><v>8</v></c><c r="F5"><f>H1</f></c></row>
<row r="9"><c r="H9" s="11"><v>2</v></c></row>
</sheetData>
<sheetProtection sheet="1" objects="1"/>
<autoFilter ref="A1:H9"><filterColumn colId="1"><filters><filter val="TRUE"/></filters></filterColumn><sortState ref="A2:H9"><sortCondition descending="1" ref="C2:C9"/></sortState></autoFilter>
<mergeCells count="2"><mergeCell ref="G5:H6"/><mergeCell ref="A7:C8"/></mergeCells>
<conditionalFormatting sqref="A2:A9 C2"><cfRule type="expression" dxfId="0" priority="1"><formula>A2&gt;$B$1</formula></cfRule></conditionalFormatting>
<dataValidations count="1"><dataValidation type="list" sqref="B2:B9"><formula1>$A$1:$A$3</formula1></dataValidation></dataValidations>
<hyperlinks><hyperlink ref="A1" r:id="rId1" display="site"/><hyperlink ref="B5" location="'Two'!A1"/></hyperlinks>
<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>
<drawing r:id="rId2"/><legacyDrawing r:id="rId3"/>
<extLst><ext uri="{X}"><x14:sparklineGroups xmlns:x14="http://schemas.microsoft.com/office/spreadsheetml/2009/9/main"/></ext></extLst>
</worksheet>`;
const SHEET2 = `<worksheet ${NS}><sheetViews><sheetView workbookViewId="0"><pane ySplit="3" topLeftCell="A40" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetData><row r="1"><c r="A1"><v>2</v></c></row></sheetData></worksheet>`;
const SHEET3 = `<worksheet ${NS}><sheetViews><sheetView workbookViewId="0"><pane xSplit="2400" ySplit="1600" topLeftCell="D5"/></sheetView></sheetViews><sheetData/></worksheet>`;
const BOOK = (extra = '') => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook ${NS} xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><fileVersion appName="xl" lastEdited="7"/><workbookPr date1904="1" defaultThemeVersion="166925"/>
<bookViews><workbookView xWindow="0" yWindow="0" windowWidth="1000" windowHeight="800" activeTab="3"/></bookViews>
<sheets><sheet name="One" sheetId="5" r:id="rId1"/><sheet name="Chart" sheetId="6" r:id="rId9"/><sheet name="Two" sheetId="2" state="hidden" r:id="rId2"/><sheet name="Split view" sheetId="9" r:id="rId3"/></sheets>
<externalReferences><externalReference r:id="rId8"/></externalReferences>
<definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">One!$A$1:$H$9</definedName><definedName name="Rate" comment="tax">0.25</definedName><definedName name="Local" localSheetId="2">Two!$A$1</definedName><definedName name="Pick">_xlfn.XLOOKUP(1,One!$A:$A,One!$B:$B)</definedName></definedNames>
<calcPr calcId="191029" iterate="1"/>${extra}</workbook>`;
const synthetic = (over = {}) => pack({
  '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="vml" ContentType="application/vnd.openxmlformats-officedocument.vmlDrawing"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/><Override PartName="/xl/charts/chart1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/><Override PartName="/xl/chartsheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.chartsheet+xml"/><Override PartName="/custom/thing.xml" ContentType="application/x-glaze-test+xml"/></Types>`,
  '_rels/.rels': rels([['rId1', 'officeDocument', 'xl/workbook.xml'], ['rId2', 'http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties', 'docProps/core.xml'], ['rId3', 'extended-properties', 'docProps/app.xml'], ['rId4', 'http://example.com/custom', 'custom/thing.xml']]),
  'docProps/core.xml': '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:creator>Ann</dc:creator></cp:coreProperties>',
  'docProps/app.xml': '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Microsoft Excel</Application></Properties>',
  'custom/thing.xml': '<thing>kept as it is</thing>',
  'xl/workbook.xml': BOOK(),
  'xl/_rels/workbook.xml.rels': rels([['rId1', 'worksheet', 'worksheets/sheet1.xml'], ['rId2', 'worksheet', 'worksheets/sheet2.xml'], ['rId3', 'worksheet', '/xl/worksheets/sheet3.xml'], ['rId4', 'styles', 'styles.xml'], ['rId5', 'sharedStrings', 'sharedStrings.xml'], ['rId6', 'theme', 'theme/theme1.xml'], ['rId7', 'calcChain', 'calcChain.xml'], ['rId8', 'externalLink', 'externalLinks/externalLink1.xml'], ['rId9', 'chartsheet', 'chartsheets/sheet1.xml']]),
  'xl/styles.xml': STYLES,
  'xl/sharedStrings.xml': SST,
  'xl/theme/theme1.xml': THEME,
  'xl/calcChain.xml': '<calcChain><c r="A3" i="1"/></calcChain>',
  'xl/externalLinks/externalLink1.xml': '<externalLink/>',
  'xl/chartsheets/sheet1.xml': '<chartsheet/>',
  'xl/worksheets/sheet1.xml': SHEET1,
  'xl/worksheets/_rels/sheet1.xml.rels': rels([['rId1', 'hyperlink', 'https://example.com/', 'External'], ['rId2', 'drawing', '../drawings/drawing1.xml'], ['rId3', 'vmlDrawing', '../drawings/vmlDrawing1.vml'], ['rId4', 'comments', '../comments1.xml']]),
  'xl/worksheets/sheet2.xml': SHEET2,
  'xl/worksheets/sheet3.xml': SHEET3,
  'xl/drawings/drawing1.xml': '<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing"/>',
  'xl/drawings/_rels/drawing1.xml.rels': rels([['rId1', 'chart', '../charts/chart1.xml'], ['rId2', 'image', '../media/image1.png']]),
  'xl/drawings/vmlDrawing1.vml': '<xml/>',
  'xl/charts/chart1.xml': '<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"/>',
  'xl/comments1.xml': `<comments ${NS}><authors><author>Ann</author></authors><commentList><comment ref="B2" authorId="0"><text><t>check</t></text></comment></commentList></comments>`,
  'xl/media/image1.png': Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3, 255]),
  ...over,
});

test('synthetic: theme colours (lt1/dk1 swapped, tints), indexed colours, the custom palette, rgb and auto', async () => {
  const wb = await X.read(synthetic());
  const s = wb.styles;
  assert.equal(s.length, 12);
  assert.deepEqual(s[0], {}, 'the default style is the empty difference');
  // theme="4" is accent1 4472C4, darkened 25%; theme="1" is dk1 (111111), theme="0" lt1 (FEFEFE).
  assert.equal(s[1].color, X.tinted('#4472C4', -0.249977111117893));
  assert.equal(s[1].color, '#2F5597');
  assert.equal(X.tinted('#FEFEFE', 0.39997558519241921), '#FEFEFE');
  assert.equal(X.tinted('#4472C4', 0.39997558519241921), '#8FAADC');
  assert.equal(s[2].color, '#FF0000');
  assert.equal(s[3].color, '#123456', 'indexed 10 from the workbook palette');
  assert.equal(s[2].border.bottom.color, '#ABCDEF', 'indexed 12 from the workbook palette');
  assert.equal(s[1].border.left.color, '#000000', 'indexed 64 is the system text colour');
  assert.equal(s[1].border.diagonal.color, '#000000', 'auto');
  assert.equal(s[1].border.bottom.color, '#44546A', 'theme 3 is dk2');
  assert.equal(s[4].fill, '#000000', 'indexed 8 is palette entry 1');
  assert.equal(s[2].pattern.fg, '#ED7D31');
  assert.equal(s[2].pattern.bg, '#000000', 'indexed 9 from the custom palette');
  const colors = wb.keep.styles.colors;
  assert.deepEqual(colors['#111111'], { theme: '1' }, 'the default font colour is dk1');
  assert.deepEqual(colors['#2F5597'], { theme: '4', tint: '-0.249977111117893' });
  assert.deepEqual(colors['#123456'], { indexed: '10' });
  assert.deepEqual(wb.keep.theme.slice(0, 4), ['#FEFEFE', '#111111', '#E7E6E6', '#44546A']);
});

// What Excel 16.114.1 on the Mac drew for the 2023 Office theme's accent 1 (#156082) at five tints, read from its fonts
// (2026-10-30). Glaze's HLS tint lands within 2 of each channel; the file keeps the theme and tint themselves.
test('tints within 2 of each channel Excel draws', () => {
  const drawn = { 0.39997558519241921: '#44B3E1', '-0.249977111117893': '#104861', 0.59999389629810485: '#83CCEB', '-0.499984740745262': '#0B3040', 0.79998168889431442: '#C0E6F5' };
  const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  for (const [tint, want] of Object.entries(drawn)) {
    const got = X.tinted('#156082', Number(tint));
    assert.ok(rgb(got).every((v, i) => Math.abs(v - rgb(want)[i]) <= 2), `${tint}: ${got}, Excel ${want}`);
  }
});

test('synthetic: fonts, fills, borders, alignment, protection and number formats as style fields', async () => {
  const wb = await X.read(synthetic());
  const s = wb.styles;
  assert.deepEqual(s[1], { fmt: '0.000" kg"', bold: true, italic: true, underline: 'double', strike: true, size: 14, color: '#2F5597', fill: '#FFFF00',
    border: { left: { style: 'thin', color: '#000000' }, right: { style: 'medium', color: '#00FF00' }, top: { style: 'dashed' }, bottom: { style: 'double', color: '#44546A' }, diagonal: { style: 'hair', color: '#000000' }, up: true } });
  assert.deepEqual(s[2], { fmt: 14, size: 9, color: '#FF0000', font: 'Arial', fontScheme: null, pattern: { type: 'darkGrid', fg: '#ED7D31', bg: '#000000' }, border: { bottom: { style: 'thick', color: '#ABCDEF' } } });
  assert.deepEqual(Object.keys(s[3]).sort(), ['color', 'fmt', 'gradient', 'h', 'indent', 'reading', 'rotate', 'shrink', 'v', 'vert', 'wrap']);
  assert.equal(s[3].fmt, '[Red]#,##0;(#,##0)');
  assert.match(s[3].gradient, /^<gradientFill degree="90">.*<\/gradientFill>$/);
  assert.deepEqual([s[3].h, s[3].v, s[3].wrap, s[3].indent, s[3].rotate, s[3].shrink, s[3].reading, s[3].vert], ['center', 'top', true, 2, 45, true, 2, 'superscript']);
  assert.deepEqual(s[4], { fmt: 8, underline: 'single', color: '#FEFEFE', fill: '#000000', locked: false, hidden: true, xfId: 1 }, 'b val="0" is not bold; general/bottom are defaults; a redefined built-in keeps its id');
  assert.deepEqual(s[5], { fmt: 49, pattern: { type: 'gray125' }, quote: true });
  assert.deepEqual(s[6], { fmt: 30 }, 'a built-in id the en-US locale leaves out stays an id');
  assert.deepEqual(s[7], {});
  assert.deepEqual(s[11], {}, 'a custom id the file never defines is General');
  const keep = wb.keep.styles;
  assert.equal(keep.fonts.length, 5);
  assert.equal(keep.fills.length, 6);
  assert.equal(keep.borders.length, 3);
  assert.deepEqual(keep.numFmts.map((f) => f.id), [164, 165, 8]);
  for (const k of ['cellStyleXfs', 'cellStyles', 'dxfs', 'tableStyles']) assert.match(keep[k], new RegExp(`^<${k}[ >]`), `${k} kept raw`);
  assert.match(keep.dxfs, /FF9C0006/);
});

test('synthetic: shared strings with rich runs, inline strings, every cell type', async () => {
  const wb = await X.read(synthetic());
  const c = (a) => at(wb, 'One', a);
  assert.deepEqual(c('A1'), { t: 's', v: 'plain & simple', s: 1 });
  assert.deepEqual(c('B1'), { t: 's', v: 'Bold blue sub', rich: [{ text: 'Bold ' }, { text: 'blue', bold: true, size: 12, color: '#4472C4', font: 'Calibri', fontFamily: 2, fontScheme: 'minor' }, { text: ' sub', italic: true, vert: 'subscript', size: 11, font: 'Arial' }] });
  assert.deepEqual(c('C1'), { t: 's', v: '日本' }, 'phonetic guides are not text');
  assert.deepEqual(c('D1'), { t: 's', v: 'a\rb_x0041_' });
  assert.deepEqual(c('E1'), { t: 's', v: '' });
  assert.deepEqual(c('F1'), { t: 's', v: 'in' });
  assert.deepEqual(c('G1'), { t: 's', v: 'Bc', rich: [{ text: 'B', bold: true }, { text: 'c' }] });
  assert.deepEqual(c('H1'), { t: 'z', s: 2 }, 'a styled blank');
  assert.deepEqual(c('A2'), { t: 'n', v: 1.5 });
  assert.deepEqual(c('B2'), { t: 'b', v: true });
  assert.deepEqual(c('C2'), { t: 'e', v: '#N/A' });
  assert.deepEqual(c('D2'), { t: 'n', v: M.toSerial(2026, 10, 30, true) + 0.5 }, 'an ISO date in the 1904 system');
  assert.deepEqual(c('E2'), { t: 'n', v: -4e300 });
  assert.deepEqual(c('F2'), { t: 's', v: 'x1.5', f: '"x"&A2' });
  assert.deepEqual(c('G2'), { t: 'b', v: true, f: 'A2>1' });
  assert.deepEqual(c('H2'), { t: 'e', v: '#DIV/0!', f: '1/0' });
  assert.deepEqual(c('A5'), { t: 'n', v: 10 }, 'a row and cells without r count on');
  assert.deepEqual(c('B5'), { t: 'n', v: 11 });
  assert.deepEqual(c('C5'), { t: 's', v: 'plain & simple', s: 5 });
  assert.deepEqual(c('F5'), { t: 'z', f: 'H1' }, 'a formula without a cached value');
  assert.deepEqual(c('H9'), { t: 'n', v: 2, s: 11 });
});

test('synthetic: shared and array formulas, LET parameters, table and external references, data tables', async () => {
  const wb = await X.read(synthetic());
  const c = (a) => at(wb, 'One', a);
  assert.deepEqual(['A3', 'B3', 'A4', 'B4'].map((a) => c(a).f), ['$A$2+A2+$A2+A$2', '$A$2+B2+$A2+B$2', '$A$2+A3+$A3+A$2', '$A$2+B3+$A3+B$2']);
  assert.deepEqual(c('C3'), { t: 'n', v: 3, f: 'A2:A3*2', a: 'C3:C4' });
  assert.deepEqual(c('C4'), { t: 'n', v: 0 }, 'the array range\'s other cells are values');
  assert.equal(c('D3').f, 'LET(x,2,x*XLOOKUP(1,A2:A3,A2:A3))');
  assert.equal(X.toFile(c('D3').f), '_xlfn.LET(_xlpm.x,2,_xlpm.x*_xlfn.XLOOKUP(1,A2:A3,A2:A3))');
  assert.equal(X.toFile('LAMBDA(a,b,a+b)(1,2)+LET(rate,0.1,total,A1*rate,total)+rate'), '_xlfn.LAMBDA(_xlpm.a,_xlpm.b,_xlpm.a+_xlpm.b)(1,2)+_xlfn.LET(_xlpm.rate,0.1,_xlpm.total,A1*_xlpm.rate,_xlpm.total)+rate',
    'a defined name outside the LET keeps its name');
  assert.equal(c('E3').f, 'SUM(Table1[Qty])+[1]Other!A1');
  assert.deepEqual(c('D4'), { t: 'n', v: 7, dt: '<f t="dataTable" ref="D4:D5" dt2D="0" dtr="0" r1="A2"/>' });
  assert.deepEqual(M.getSheet(wb, 'One').keep.locks, ['external', 'dataTable']);
});

test('synthetic: sheets, names, sizes, merges, freeze panes, filter and sort, kept elements', async () => {
  const wb = await X.read(synthetic());
  assert.equal(wb.date1904, true);
  assert.deepEqual(wb.sheets.map((s) => [s.name, s.id]), [['One', 5], ['Two', 2], ['Split view', 9]]);
  assert.equal(wb.active, 2, 'activeTab 3 counts the chart sheet');
  assert.equal(M.getSheet(wb, 'Two').keep.hidden, true);
  assert.equal(M.getSheet(wb, 'Two').keep.state, undefined, 'only veryHidden says so');
  assert.deepEqual(wb.names, [
    { name: '_xlnm._FilterDatabase', ref: 'One!$A$1:$H$9', sheet: 5, hidden: true },
    { name: 'Rate', ref: '0.25', attrs: { comment: 'tax' } },
    { name: 'Local', ref: 'Two!$A$1', sheet: 2 },
    { name: 'Pick', ref: 'XLOOKUP(1,One!$A:$A,One!$B:$B)' },
  ]);
  const one = M.getSheet(wb, 'One');
  assert.deepEqual([...one.colW], [[0, 20.7109375], [1, 0], [2, 0], [4, 9.140625]], 'widths as the file has them');
  assert.deepEqual([...one.hidden.cols], [1, 2]);
  assert.deepEqual([...one.keep.colAttrs], [[4, { style: '3' }]]);
  assert.deepEqual([...one.rowH], [[0, 30]], 'custom heights only, in points');
  assert.deepEqual([...one.hidden.rows], [1]);
  assert.deepEqual([...one.keep.rowAttrs], [[2, { ht: '12.75', s: '4', outlineLevel: '1' }]]);
  assert.deepEqual(one.keep.defaults, { colW: 8.7109375, rowH: 15 }, 'eight characters when the file names no width');
  assert.deepEqual(one.merges, [{ r0: 4, c0: 6, r1: 5, c1: 7 }, { r0: 6, c0: 0, r1: 7, c1: 2 }]);
  assert.deepEqual(one.freeze, { rows: 1, cols: 2 });
  assert.deepEqual(M.getSheet(wb, 'Two').freeze, { rows: 3, cols: 0 });
  assert.equal(M.getSheet(wb, 'Split view').freeze, null, 'a split that is not frozen');
  assert.deepEqual({ ...one.filter, xml: undefined }, { r0: 0, c0: 0, r1: 8, c1: 7, xml: undefined });
  assert.match(one.filter.xml, /^<filterColumn colId="1">.*<sortState ref="A2:H9"><sortCondition descending="1" ref="C2:C9"\/><\/sortState>$/);
  assert.deepEqual(one.keep.xml.map((x) => x.name), ['sheetPr', 'sheetFormatPr', 'sheetProtection', 'conditionalFormatting', 'dataValidations', 'hyperlinks', 'pageMargins', 'drawing', 'legacyDrawing', 'extLst']);
  assert.equal(one.keep.xml.find((x) => x.name === 'hyperlinks').xml, '<hyperlinks><hyperlink ref="A1" r:id="rId1" display="site"/><hyperlink ref="B5" location="\'Two\'!A1"/></hyperlinks>');
  assert.equal(one.keep.view.attrs.zoomScale, '125');
  assert.deepEqual(one.keep.rels.map((r) => r.id), ['rId1', 'rId2', 'rId3', 'rId4']);
  assert.deepEqual(one.keep.drawing, { id: 'rId2', path: 'xl/drawings/drawing1.xml', charts: ['xl/charts/chart1.xml'] }, 'where the charts lane finds them in keep.parts');
  assert.equal(one.keep.comments, 'xl/comments1.xml');
  assert.match(one.keep.root, /^<worksheet [^>]*mc:Ignorable="x14ac">$/);
});

test('synthetic: unknown and unmodelled parts kept byte for byte; calcChain and app.xml dropped', async () => {
  const bytes = synthetic();
  const wb = await X.read(bytes);
  assert.deepEqual(Object.keys(wb.keep.parts).sort(), ['custom/thing.xml', 'docProps/core.xml', 'xl/charts/chart1.xml', 'xl/chartsheets/sheet1.xml',
    'xl/comments1.xml', 'xl/drawings/_rels/drawing1.xml.rels', 'xl/drawings/drawing1.xml', 'xl/drawings/vmlDrawing1.vml', 'xl/externalLinks/externalLink1.xml',
    'xl/media/image1.png', 'xl/theme/theme1.xml']);
  assert.deepEqual(wb.keep.parts['xl/media/image1.png'], { type: 'image/png', data: Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3, 255]) });
  assert.equal(wb.keep.parts['custom/thing.xml'].type, 'application/x-glaze-test+xml');
  assert.equal(new TextDecoder().decode(wb.keep.parts['xl/theme/theme1.xml'].data), THEME);
  assert.deepEqual(wb.keep.pkg.map((r) => r.id), ['rId2', 'rId4']);
  assert.deepEqual(wb.keep.book.rels.map((r) => r.id), ['rId6', 'rId8', 'rId9']);
  assert.deepEqual(wb.keep.others.map((o) => [o.rel.id, o.after]), [['rId9', 5]], 'the chart sheet after One');
  assert.deepEqual(wb.keep.book.xml.map((x) => x.name), ['fileVersion', 'externalReferences']);
  assert.deepEqual(wb.keep.book.calcPr, { calcId: '191029', iterate: '1' });
  assert.deepEqual(wb.keep.flags, { macros: false, pivots: false, external: true, slicers: false });
});

test('synthetic: pivot tables, slicers and macros are flagged and lock their sheets', async () => {
  const pivot = await X.read(synthetic({
    'xl/workbook.xml': BOOK('<pivotCaches><pivotCache cacheId="1" r:id="rId10"/></pivotCaches>'),
    'xl/_rels/workbook.xml.rels': rels([['rId1', 'worksheet', 'worksheets/sheet1.xml'], ['rId2', 'worksheet', 'worksheets/sheet2.xml'], ['rId3', 'worksheet', 'worksheets/sheet3.xml'], ['rId4', 'styles', 'styles.xml'], ['rId9', 'chartsheet', 'chartsheets/sheet1.xml'], ['rId10', 'pivotCacheDefinition', 'pivotCache/pivotCacheDefinition1.xml'], ['rId11', 'vbaProject', 'vbaProject.bin'], ['rId12', 'http://schemas.microsoft.com/office/2007/relationships/slicerCache', 'slicerCaches/slicerCache1.xml']]),
    'xl/pivotCache/pivotCacheDefinition1.xml': `<pivotCacheDefinition ${NS}><cacheSource type="worksheet"><worksheetSource ref="A1:B5" sheet="Two"/></cacheSource></pivotCacheDefinition>`,
    'xl/worksheets/sheet3.xml': SHEET3.replace('<sheetData/>', '<sheetData/><extLst><ext uri="{A8765BA9-456A-4dab-B4F3-ACF838C121DE}"><x14:slicerList xmlns:x14="http://schemas.microsoft.com/office/spreadsheetml/2009/9/main"><x14:slicer r:id="rId1"/></x14:slicerList></ext></extLst>'),
    'xl/worksheets/_rels/sheet3.xml.rels': rels([['rId1', 'http://schemas.microsoft.com/office/2007/relationships/slicer', '../slicers/slicer1.xml'], ['rId2', 'pivotTable', '../pivotTables/pivotTable1.xml']]),
    'xl/slicers/slicer1.xml': '<slicers/>', 'xl/slicerCaches/slicerCache1.xml': '<slicerCacheDefinition/>', 'xl/pivotTables/pivotTable1.xml': '<pivotTableDefinition/>',
    'xl/vbaProject.bin': Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0]),
  }));
  assert.deepEqual(pivot.keep.flags, { macros: true, pivots: true, external: true, slicers: true });
  assert.deepEqual(M.getSheet(pivot, 'Two').keep.locks, ['pivot'], 'the pivot cache reads this sheet');
  assert.deepEqual(M.getSheet(pivot, 'Split view').keep.locks, ['slicer', 'pivot']);
  assert.deepEqual(new Uint8Array(pivot.keep.parts['xl/vbaProject.bin'].data), Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0]));
  const xlsm = await X.read(synthetic({ '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.ms-excel.sheet.macroEnabled.main+xml"/></Types>' }));
  assert.equal(xlsm.keep.flags.macros, true);
  assert.equal(xlsm.keep.main, 'application/vnd.ms-excel.sheet.macroEnabled.main+xml');
});

test('synthetic: a broken part degrades to its sheet or its strings; only a non-workbook throws', async () => {
  const wb = await X.read(synthetic({
    'xl/worksheets/sheet2.xml': `<worksheet ${NS}><sheetData><row r="1"><c r="A1" t="s"><v>99</v></c><c r="ZZZZ1"><v>1</v></c><c r="B1"><f t="shared" si="7"/><v>3</v></c></row><row r="2000000"><c><v>1</v></c></row></sheetData></worksheet>`,
    'xl/worksheets/sheet3.xml': new Uint8Array([0x3c, 0x3f, 0x78, 0x6d, 0x6c, 0x20, 0x65, 0x6e, 0x63, 0x6f, 0x64, 0x69, 0x6e, 0x67, 0x3d, 0x22, 0x78, 0x22, 0x3f, 0x3e]),
  }));
  assert.equal(at(wb, 'One', 'A2').v, 1.5, 'the other sheets read');
  assert.deepEqual(at(wb, 'Two', 'A1'), { t: 's', v: '' });
  assert.deepEqual(at(wb, 'Two', 'B1'), { t: 'n', v: 3 }, 'a shared formula without its first cell keeps its value');
  assert.deepEqual(wb.keep.problems.map((p) => [p.sheet ?? null, p.code]), [['Two', 'string'], ['Two', 'cell'], ['Two', 'row'], ['Two', 'cell'], ['Two', 'formula'], [null, 'part'], ['Split view', 'sheet']]);
  assert.equal(M.getSheet(wb, 'Split view').rows.size, 0);
  await assert.rejects(X.read(pack({ 'word/document.xml': '<w:document/>' })), { code: 'not-workbook' });
  await assert.rejects(X.read(enc.encode('not a zip at all, long enough to look for an end record in it')), /not a zip file/);
  await assert.rejects(X.read(synthetic(), { limits: { entry: 100 } }), { code: 'not-workbook' }, 'a workbook part over the limit');
});

test('caps: 100 sheets and 250,000 cells; the rest are listed, not read', async () => {
  const many = Array.from({ length: 102 }, (_, i) => i);
  const book = pack({
    'xl/workbook.xml': `<workbook ${NS}><sheets>${many.map((i) => `<sheet name="S${i}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': rels(many.map((i) => [`rId${i + 1}`, 'worksheet', `worksheets/sheet${i + 1}.xml`])),
    ...Object.fromEntries(many.map((i) => [`xl/worksheets/sheet${i + 1}.xml`, `<worksheet ${NS}><sheetData><row r="1"><c r="A1"><v>${i}</v></c></row></sheetData></worksheet>`])),
  });
  const wb = await X.read(book);
  assert.equal(wb.sheets.length, 100);
  assert.deepEqual(wb.keep.problems.map((p) => p.code), ['content-types', 'cap-sheets', 'cap-sheets']);
  const row = '<c><v>1</v></c>'.repeat(1000);
  const big = pack({
    'xl/workbook.xml': `<workbook ${NS}><sheets><sheet name="Big" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': rels([['rId1', 'worksheet', 'worksheets/sheet1.xml']]),
    'xl/worksheets/sheet1.xml': `<worksheet ${NS}><sheetData>${`<row>${row}</row>`.repeat(251)}</sheetData></worksheet>`,
  });
  const b = await X.read(big);
  assert.equal(M.cellCount(b), 250000);
  assert.deepEqual(b.keep.problems.map((p) => p.code), ['content-types', 'cap-cells']);
});

// ── Writing ───────────────────────────────────────────────────────────────────────────────────────────────────────────
const C = require('../lib/sheet-calc.js');
const F = require('../lib/sheet-formula.js');
for (const f of fs.readdirSync(path.join(__dirname, '../lib')).filter((n) => /^sheet-fn-.*\.js$/.test(n)).sort()) require(`../lib/${f}`);
const D = require('../lib/doctext.js');
const DATE = new Date(2026, 0, 1);
const parts = async (bytes) => { const z = D.unzip(bytes); const out = {}; for (const n of z.names) out[n] = await z.text(n); return out; };
// What Excel can store of an error: the seven, #GETTING_DATA, and #VALUE! for the newer ones.
const stored = (v) => (['#NULL!', '#DIV/0!', '#VALUE!', '#REF!', '#NAME?', '#NUM!', '#N/A', '#GETTING_DATA'].includes(v) ? v : '#VALUE!');
// The model's fields, as plain data, for comparing two reads.
const fields = (wb) => ({
  date1904: wb.date1904, active: wb.active, names: wb.names, styles: wb.styles,
  sheets: wb.sheets.map((sh) => ({
    id: sh.id, name: sh.name, freeze: sh.freeze, filter: sh.filter, merges: sh.merges, colW: [...sh.colW].sort((a, b) => a[0] - b[0]), rowH: [...sh.rowH].sort((a, b) => a[0] - b[0]),
    hidden: { rows: [...sh.hidden.rows].sort((a, b) => a - b), cols: [...sh.hidden.cols].sort((a, b) => a - b) }, sheetHidden: sh.keep.hidden, state: sh.keep.state,
    cells: [...sh.rows].sort((a, b) => a[0] - b[0]).flatMap(([r, row]) => [...row].sort((a, b) => a[0] - b[0])
      .filter(([, x]) => !(x.t === 'z' && x.s === undefined && x.f === undefined))
      .map(([c, x]) => [M.cellName(r, c), x.t === 'e' ? { ...x, v: stored(x.v) } : x])),
    keep: { xml: sh.keep.xml, rowAttrs: [...(sh.keep.rowAttrs ?? [])], colAttrs: [...(sh.keep.colAttrs ?? [])], view: sh.keep.view && { ...sh.keep.view.attrs, tabSelected: undefined } },
  })),
});
const keptBytes = (wb) => Object.fromEntries(Object.entries(wb.keep.parts).map(([p, x]) => [p, Buffer.from(x.data).toString('base64')]));
const same = (want, got) => want.t === got.t && (want.t === 'n' ? Math.abs(want.v - got.v) <= 1e-12 * Math.max(Math.abs(want.v), Math.abs(got.v)) : want.v === got.v);
// The engine answers these otherwise than Excel (test/sheet-golden.test.js TODO).
const ENGINE_TODO = new Set(['financial.rate.2', 'financial.xirr.1', 'financial.xirr.2']);

for (const [family, list] of byFamily) {
  test(`round trip ${family}.xlsx: read, recalculate and write, read again: the same model, Excel's values cached`, async () => {
    const bytes = fs.readFileSync(path.join(DIR, `${family}.xlsx`));
    const wb = await X.read(bytes);
    const kept = keptBytes(wb);
    const out = await X.write(wb, { date: DATE });
    const again = await X.read(out);
    assert.deepEqual(again.keep.problems, []);
    assert.deepEqual(fields(again), fields(wb));
    assert.deepEqual(keptBytes(again), kept, 'kept parts byte for byte');
    for (const c of list) {
      if (c.unsupported != null || ENGINE_TODO.has(c.id)) continue;
      const g = golden[c.id], cell = at(again, c.sheet, c.cell);
      assert.ok(same({ t: g.t, v: g.v }, cell), `${c.id}: cached ${JSON.stringify(cell)}, Excel ${JSON.stringify(g)}`);
    }
    const p = await parts(out);
    assert.equal(p['xl/calcChain.xml'], undefined, 'no stale calculation chain');
    assert.match(p['xl/workbook.xml'], /<calcPr [^>]*fullCalcOnLoad="1"/);
    for (const [name, xml] of Object.entries(p).filter(([n]) => /worksheets\/sheet\d+\.xml$/.test(n))) {
      assert.doesNotMatch(xml, /t="inlineStr"/, `${name}: shared strings, not inline`);
      for (const m of xml.matchAll(/<c [^>]*>(?:(?!<\/c>).)*<\/c>/g)) if (m[0].includes('<f')) assert.match(m[0], /<v>[^<]*<\/v>|<v\/>/, `${name}: a cached value for ${m[0].slice(0, 80)}`);
    }
  });
}

test('round trip: the synthetic workbook keeps every model field, kept element and part', async () => {
  const wb = await X.read(synthetic());
  const kept = keptBytes(wb);
  const out = await X.write(wb, { date: DATE, recalc: false });
  const again = await X.read(out);
  assert.deepEqual(fields(again), fields(wb));
  const reachable = { ...kept };
  delete reachable['xl/calcChain.xml'];
  assert.deepEqual(keptBytes(again), reachable);
  assert.deepEqual(again.keep.styles.colors, wb.keep.styles.colors);
  assert.deepEqual(again.keep.styles.numFmts, wb.keep.styles.numFmts);
  for (const k of ['cellStyleXfs', 'cellStyles', 'dxfs', 'tableStyles', 'palette']) assert.equal(again.keep.styles[k], wb.keep.styles[k], k);
  assert.deepEqual(again.keep.styles.fonts, wb.keep.styles.fonts, 'the fonts as written, so cell styles and dxfs still point right');
  assert.deepEqual(again.keep.others.map((o) => o.xml), wb.keep.others.map((o) => o.xml));
  assert.deepEqual(again.keep.book.xml.map((x) => x.xml), wb.keep.book.xml.map((x) => x.xml));
  assert.deepEqual(again.keep.flags, wb.keep.flags);
  assert.deepEqual(again.keep.pkg.map((r) => r.target), wb.keep.pkg.map((r) => r.target));
});

test('write: Excel\'s element order, character widths, point heights, shared strings, formula types', async () => {
  const wb = await X.read(synthetic());
  const p = await parts(await X.write(wb, { date: DATE, recalc: false }));
  const order = (xml, root) => [...xml.matchAll(/<([\w:]+)[\s/>]/g)].map((m) => m[1]);
  const top = (xml, root) => {
    const out = [];
    let depth = 0;
    for (const tk of D.tokens(xml)) {
      if (!tk.name || tk.name.startsWith('?')) continue;
      if (tk.close) { depth--; continue; }
      if (depth === 1) out.push(tk.name.replace(/^\w+:/, ''));
      if (!tk.empty) depth++;
    }
    return out;
  };
  const sheet = p['xl/worksheets/sheet1.xml'];
  assert.deepEqual(top(sheet), ['sheetPr', 'dimension', 'sheetViews', 'sheetFormatPr', 'cols', 'sheetData', 'sheetProtection', 'autoFilter', 'mergeCells',
    'conditionalFormatting', 'dataValidations', 'hyperlinks', 'pageMargins', 'drawing', 'legacyDrawing', 'extLst']);
  assert.deepEqual(top(p['xl/workbook.xml']), ['fileVersion', 'workbookPr', 'bookViews', 'sheets', 'externalReferences', 'definedNames', 'calcPr']);
  assert.deepEqual(top(p['xl/styles.xml']), ['numFmts', 'fonts', 'fills', 'borders', 'cellStyleXfs', 'cellXfs', 'cellStyles', 'dxfs', 'tableStyles', 'colors']);
  assert.match(sheet, /<dimension ref="A1:H9"\/>/);
  assert.match(sheet, /<col min="1" max="1" width="20.7109375" customWidth="1"\/><col min="2" max="3" width="0" hidden="1" customWidth="1"\/><col min="5" max="5" width="9.140625" style="3" customWidth="1"\/>/);
  assert.match(sheet, /<row r="1" ht="30" customHeight="1">/);
  assert.match(sheet, /<row r="3" s="4" customFormat="1" ht="12.75" outlineLevel="1">/);
  assert.match(sheet, /<c r="F2" t="str"><f>"x"&amp;A2<\/f><v>x1.5<\/v><\/c>/);
  assert.match(sheet, /<c r="G2" t="b"><f>A2&gt;1<\/f><v>1<\/v><\/c>/);
  assert.match(sheet, /<c r="H2" t="e"><f>1\/0<\/f><v>#DIV\/0!<\/v><\/c>/);
  assert.match(sheet, /<c r="C3"><f t="array" ref="C3:C4">A2:A3\*2<\/f><v>3<\/v><\/c>/);
  assert.match(sheet, /<c r="D3"><f>_xlfn.LET\(_xlpm.x,2,_xlpm.x\*_xlfn.XLOOKUP\(1,A2:A3,A2:A3\)\)<\/f>/);
  assert.match(sheet, /<c r="D4"><f t="dataTable" ref="D4:D5" dt2D="0" dtr="0" r1="A2"\/><v>7<\/v><\/c>/);
  assert.match(sheet, /<sheetView zoomScale="125" workbookViewId="0"><pane xSplit="2" ySplit="1" topLeftCell="C2" activePane="bottomRight" state="frozen"\/>/, 'not the active sheet');
  assert.match(p['xl/worksheets/sheet3.xml'], /<sheetView tabSelected="1" workbookViewId="0">/, 'the active sheet');
  assert.match(sheet, /<autoFilter ref="A1:H9"><filterColumn colId="1">/);
  assert.match(sheet, /<mergeCells count="2"><mergeCell ref="G5:H6"\/><mergeCell ref="A7:C8"\/><\/mergeCells>/);
  assert.match(p['xl/sharedStrings.xml'], /^<\?xml[^>]*\?>\n<sst xmlns="[^"]+" count="8" uniqueCount="7"><si><t>plain &amp; simple<\/t><\/si>/, 'inline strings become shared ones');
  assert.match(p['xl/sharedStrings.xml'], /<si><r><t xml:space="preserve">Bold <\/t><\/r><r><rPr><b\/><sz val="12"\/><color theme="4"\/><rFont val="Calibri"\/><family val="2"\/><scheme val="minor"\/><\/rPr><t>blue<\/t><\/r>/);
  assert.match(p['xl/sharedStrings.xml'], /<t>a_x000D_b_x005F_x0041_<\/t>/);
  assert.match(p['xl/workbook.xml'], /<sheets><sheet name="One" sheetId="5" r:id="rId\d+"\/><sheet name="Chart" sheetId="6" r:id="rId9"\/><sheet name="Two" sheetId="2" state="hidden" r:id="rId\d+"\/><sheet name="Split view" sheetId="9" r:id="rId\d+"\/><\/sheets>/);
  assert.match(p['xl/workbook.xml'], /<workbookView xWindow="0" yWindow="0" windowWidth="1000" windowHeight="800" activeTab="3"\/>/);
  assert.match(p['xl/workbook.xml'], /<definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">One!\$A\$1:\$H\$9<\/definedName><definedName name="Rate" comment="tax">0.25<\/definedName><definedName name="Local" localSheetId="2">Two!\$A\$1<\/definedName><definedName name="Pick">_xlfn.XLOOKUP\(1,One!\$A:\$A,One!\$B:\$B\)<\/definedName>/);
  assert.match(p['xl/workbook.xml'], /<calcPr calcId="191029" iterate="1" fullCalcOnLoad="1"\/>/);
  assert.match(p['xl/workbook.xml'], /<workbookPr date1904="1" defaultThemeVersion="166925"\/>/);
  assert.equal(p['xl/calcChain.xml'], undefined);
  assert.match(p['[Content_Types].xml'], /<Default Extension="png" ContentType="image\/png"\/>/);
  assert.match(p['[Content_Types].xml'], /<Override PartName="\/custom\/thing.xml" ContentType="application\/x-glaze-test\+xml"\/>/);
});

test('write: a workbook built in Glaze from scratch reads back as built', async () => {
  const wb = M.workbook();
  const e = C.engine(wb);
  const id = wb.sheets[0].id;
  e.apply({ op: 'addSheet', name: 'Data & more' });
  const data = M.getSheet(wb, 'Data & more').id;
  for (const [a, text] of [['A1', 'Item'], ['B1', 'Qty'], ['C1', 'Price'], ['D1', 'Total'], ['A2', 'Pens'], ['B2', '12'], ['C2', '$1.25'], ['A3', 'Paper <A4>'], ['B3', '3'], ['C3', '4.5'], ['D2', '=B2*C2'], ['D3', '=B3*C3'], ['D4', '=SUM(D2:D3)'], ['E2', '3/4/2025'], ['E3', '12%'], ['F2', "=TEXTJOIN(\", \",TRUE,A2:A3)"], ['F3', '=IF(D4>40,"big","small")'], ['G2', '=1/0'], ['G3', 'TRUE'], ['H2', "'0042"], ['A6', '=\'Data & more\'!A1&" "&Sheet1!A1']]) {
    const [r, c] = M.cellPosition(a);
    assert.equal(e.edit(id, r, c, text).error, undefined, a);
  }
  e.edit(data, 0, 0, 'from Sheet1');
  const bold = M.internStyle(wb, { bold: true, fill: '#DDEBF7', border: { bottom: { style: 'thin', color: '#000000' } }, h: 'center' });
  for (let c = 0; c < 4; c++) e.apply({ op: 'set', sheet: id, r: 0, c, cell: { ...M.cell(wb.sheets[0], 0, c), s: bold } });
  const money = M.internStyle(wb, { fmt: '"$"#,##0.00' });
  e.apply({ op: 'set', sheet: id, r: 3, c: 3, cell: { ...M.cell(wb.sheets[0], 3, 3), s: money } });
  e.apply({ op: 'set', sheet: id, r: 4, c: 0, cell: { t: 's', v: 'Rich', rich: [{ text: 'Ri', bold: true, color: '#C00000' }, { text: 'ch', italic: true }] } });
  e.apply({ op: 'prop', sheet: id, key: 'merges', value: [{ r0: 6, c0: 0, r1: 7, c1: 2 }] });
  e.apply({ op: 'prop', sheet: id, key: 'freeze', value: { rows: 1, cols: 1 } });
  e.apply({ op: 'prop', sheet: id, key: 'filter', value: { r0: 0, c0: 0, r1: 3, c1: 3 } });
  e.apply({ op: 'size', sheet: id, axis: 'col', i: 0, size: 16.7109375 });
  e.apply({ op: 'size', sheet: id, axis: 'row', i: 0, size: 21 });
  e.apply({ op: 'addSheet', name: 'Hidden one' });
  M.getSheet(wb, 'Hidden one').keep = { hidden: true };
  e.apply({ op: 'hide', sheet: id, axis: 'col', i: 7, hidden: true });
  e.apply({ op: 'name', name: 'Total', ref: 'Sheet1!$D$4' });
  const out = await X.write(wb, { date: DATE, engine: e });
  const again = await X.read(out);
  assert.deepEqual(again.keep.problems, []);
  const strip = (x) => { const f = fields(x); for (const s of f.sheets) s.keep = null; return f; };
  const built = strip(wb);
  built.sheets.forEach((s, i) => { s.id = again.sheets[i].id; });
  assert.deepEqual(strip(again), built);
  assert.deepEqual(at(again, 'Sheet1', 'D4'), { t: 'n', v: 28.5, f: 'SUM(D2:D3)', s: money });
  assert.deepEqual(at(again, 'Sheet1', 'F2'), { t: 's', v: 'Pens, Paper <A4>', f: 'TEXTJOIN(", ",TRUE,A2:A3)' });
  assert.deepEqual(at(again, 'Sheet1', 'A6'), { t: 's', v: 'from Sheet1 Item', f: "'Data & more'!A1&\" \"&Sheet1!A1" });
  const p = await parts(out);
  assert.match(p['xl/worksheets/sheet1.xml'], /<c r="F2" t="str"><f>_xlfn.TEXTJOIN\(", ",TRUE,A2:A3\)<\/f><v>Pens, Paper &lt;A4&gt;<\/v><\/c>/);
  assert.match(p['xl/styles.xml'], /<numFmts count="3"><numFmt numFmtId="164" formatCode="&quot;\$&quot;#,##0.00"\/><numFmt numFmtId="165" formatCode="m\/d\/yyyy"\/><numFmt numFmtId="166" formatCode="0%"\/><\/numFmts>/,
    'typed formats are codes in the model, so they stay codes');
  assert.match(p['xl/styles.xml'], /<fills count="3"><fill><patternFill patternType="none"\/><\/fill><fill><patternFill patternType="gray125"\/><\/fill><fill><patternFill patternType="solid"><fgColor rgb="FFDDEBF7"\/><bgColor indexed="64"\/><\/patternFill><\/fill><\/fills>/);
  assert.equal(X.extension(again), 'xlsx');
});

test('write: kept references follow inserted and deleted rows and columns, renames, and undo', async () => {
  const chart = '<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart><c:plotArea><c:barChart><c:ser><c:cat><c:strRef><c:f>One!$A$2:$A$9</c:f></c:strRef></c:cat><c:val><c:numRef><c:f>\'Split view\'!$B$2:$B$9</c:f><c:numCache><c:ptCount val="0"/></c:numCache></c:numRef></c:val></c:ser></c:barChart></c:plotArea></c:chart></c:chartSpace>';
  const drawing = '<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing"><xdr:twoCellAnchor><xdr:from><xdr:col>3</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>4</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>8</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>20</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to></xdr:twoCellAnchor></xdr:wsDr>';
  const vml = '<xml xmlns:v="urn:schemas-microsoft-com:vml" xmlns:x="urn:schemas-microsoft-com:office:excel"><v:shape id="_x0000_s1025"><x:ClientData ObjectType="Note"><x:Anchor>2, 15, 0, 2, 4, 15, 4, 16</x:Anchor><x:Row>1</x:Row><x:Column>1</x:Column></x:ClientData></v:shape></xml>';
  const wb = await X.read(synthetic({ 'xl/charts/chart1.xml': chart, 'xl/drawings/drawing1.xml': drawing, 'xl/drawings/vmlDrawing1.vml': vml }));
  const e = C.engine(wb);
  e.recalc();
  const original = await parts(await X.write(wb, { date: DATE, recalc: false }));
  const one = M.getSheet(wb, 'One').id;
  const apply = (op) => { const res = e.apply(op); X.track(wb, op); return res.inverse; };
  const undo = apply({ op: 'insert', sheet: one, axis: 'row', at: 0, n: 1 });
  assert.deepEqual(wb.keep.log, [{ op: 'shift', sheet: one, name: 'One', axis: 'row', at: 0, n: 1 }]);
  let p = await parts(await X.write(wb, { date: DATE, recalc: false }));
  const s1 = p['xl/worksheets/sheet1.xml'];
  assert.match(s1, /<conditionalFormatting sqref="A3:A10 C3"><cfRule type="expression" dxfId="0" priority="1"><formula>A3&gt;\$B\$2<\/formula>/);
  assert.match(s1, /<dataValidation type="list" sqref="B3:B10"><formula1>\$A\$2:\$A\$4<\/formula1>/);
  assert.match(s1, /<hyperlink ref="A2" r:id="rId1" display="site"\/><hyperlink ref="B6" location="'Two'!A1"\/>/);
  assert.match(s1, /<row r="4" s="4" customFormat="1" ht="12.75" outlineLevel="1">/, 'a kept row format moves with its row');
  assert.match(s1, /<sortState ref="A3:H10"><sortCondition descending="1" ref="C3:C10"\/>/);
  assert.match(p['xl/comments1.xml'], /<comment ref="B3" authorId="0">/);
  assert.match(p['xl/charts/chart1.xml'], /<c:f>One!\$A\$3:\$A\$10<\/c:f>.*<c:f>'Split view'!\$B\$2:\$B\$9<\/c:f>/);
  assert.match(p['xl/drawings/drawing1.xml'], /<xdr:from><xdr:col>3<\/xdr:col><xdr:colOff>0<\/xdr:colOff><xdr:row>5<\/xdr:row>.*<xdr:to><xdr:col>8<\/xdr:col><xdr:colOff>0<\/xdr:colOff><xdr:row>21<\/xdr:row>/);
  assert.match(p['xl/drawings/vmlDrawing1.vml'], /<x:Anchor>2, 15, 1, 2, 4, 15, 5, 16<\/x:Anchor><x:Row>2<\/x:Row><x:Column>1<\/x:Column>/);
  assert.match(p['xl/workbook.xml'], /<definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">One!\$A\$2:\$H\$10<\/definedName>/, 'names move with the model');
  apply(undo);
  assert.deepEqual(wb.keep.log, [], 'the undo takes the insert off the log');
  p = await parts(await X.write(wb, { date: DATE, recalc: false }));
  for (const name of ['xl/worksheets/sheet1.xml', 'xl/comments1.xml', 'xl/charts/chart1.xml', 'xl/drawings/drawing1.xml', 'xl/drawings/vmlDrawing1.vml']) assert.equal(p[name], original[name], name);
  // A delete takes what was only in its rows; a rename follows into kept formulas.
  apply({ op: 'delete', sheet: one, axis: 'row', at: 1, n: 1 });
  apply({ op: 'delete', sheet: one, axis: 'col', at: 0, n: 1 });
  apply({ op: 'rename', sheet: one, name: 'Uno' });
  assert.deepEqual(wb.keep.log.map((x) => x.op), ['shift', 'shift', 'rename']);
  p = await parts(await X.write(wb, { date: DATE, recalc: false }));
  const s2 = p['xl/worksheets/sheet1.xml'];
  assert.doesNotMatch(s2, /<hyperlink ref="A1"/, 'the hyperlink in a deleted column goes');
  assert.match(s2, /<hyperlinks><hyperlink ref="A4" location="'Two'!A1"\/><\/hyperlinks>/);
  assert.doesNotMatch(s2, /<conditionalFormatting/, 'its ranges were all in the deleted row and column');
  assert.match(s2, /<dataValidations count="1"><dataValidation type="list" sqref="A2:A8"><formula1>#REF!<\/formula1>/, 'its list was in the deleted column');
  assert.doesNotMatch(p['xl/comments1.xml'], /<comment /, 'the comment on a deleted row goes');
  assert.match(p['xl/comments1.xml'], /<commentList><\/commentList>/);
  assert.doesNotMatch(p['xl/drawings/vmlDrawing1.vml'], /<v:shape/, 'and its note shape');
  assert.match(p['xl/charts/chart1.xml'], /<c:f>One!#REF!<\/c:f>.*<c:f>'Split view'!\$B\$2:\$B\$9<\/c:f>/, 'as the engine writes a deleted reference');
  // Renaming 'Split view' reaches the chart.
  apply({ op: 'rename', sheet: M.getSheet(wb, 'Split view').id, name: 'Totals' });
  p = await parts(await X.write(wb, { date: DATE, recalc: false }));
  assert.match(p['xl/charts/chart1.xml'], /<c:f>Totals!\$B\$2:\$B\$9<\/c:f>/);
  const again = await X.read(await X.write(wb, { date: DATE, recalc: false }));
  assert.deepEqual(again.keep.problems, []);
});

test('locked: structural edits a pivot, slicer, query, macro, external link or table relies on', async () => {
  const wb = await X.read(synthetic());
  const one = M.getSheet(wb, 'One'), two = M.getSheet(wb, 'Two');
  assert.equal(X.locked(wb, { op: 'insert', sheet: one.id, axis: 'row', at: 0, n: 1 }), 'this sheet links to another workbook');
  assert.equal(X.locked(wb, { op: 'insert', sheet: two.id, axis: 'row', at: 0, n: 1 }), null);
  assert.equal(X.locked(wb, { op: 'set', sheet: one.id, r: 0, c: 0, cell: null }), null, 'cell edits are not structural');
  assert.equal(X.locked(wb, { op: 'batch', ops: [{ op: 'set', sheet: two.id, r: 0, c: 0, cell: null }, { op: 'delete', sheet: one.id, axis: 'col', at: 0, n: 1 }] }), 'this sheet links to another workbook');
  two.keep.locks = ['pivot'];
  assert.equal(X.locked(wb, { op: 'delete', sheet: two.id, axis: 'col', at: 2, n: 1 }), 'a pivot table uses this sheet');
  two.keep.locks = [];
  two.keep.tables = ['xl/tables/table1.xml'];
  assert.equal(X.locked(wb, { op: 'insert', sheet: two.id, axis: 'col', at: 0, n: 1 }), 'a table on this sheet would lose its columns');
  assert.equal(X.locked(wb, { op: 'insert', sheet: two.id, axis: 'row', at: 0, n: 1 }), null, 'a table grows and shrinks with rows');
  wb.keep.flags.macros = true;
  assert.equal(X.locked(wb, { op: 'insert', sheet: two.id, axis: 'row', at: 0, n: 1 }), 'the workbook has macros');
});

test('write: a copied sheet gets its own part and leaves the original its drawing; macros make it .xlsm', async () => {
  const wb = await X.read(synthetic({ 'xl/vbaProject.bin': Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0]),
    'xl/worksheets/sheet1.xml': SHEET1.replace('mc:Ignorable="x14ac">', 'mc:Ignorable="x14ac" xmlns:xr="http://schemas.microsoft.com/office/spreadsheetml/2014/revision" xr:uid="{11691459-BD10-3A42-A056-F33732C221E5}">'),
    'xl/_rels/workbook.xml.rels': rels([['rId1', 'worksheet', 'worksheets/sheet1.xml'], ['rId2', 'worksheet', 'worksheets/sheet2.xml'], ['rId3', 'worksheet', '/xl/worksheets/sheet3.xml'], ['rId4', 'styles', 'styles.xml'], ['rId5', 'sharedStrings', 'sharedStrings.xml'], ['rId6', 'theme', 'theme/theme1.xml'], ['rId9', 'chartsheet', 'chartsheets/sheet1.xml'], ['rId11', 'vbaProject', 'vbaProject.bin']]) }));
  const one = M.getSheet(wb, 'One');
  const copy = { ...one, id: 77, name: 'One (2)', rows: new Map([...one.rows].map(([r, row]) => [r, new Map(row)])), keep: { ...one.keep } };
  M.apply(wb, { op: 'addSheet', sheet: copy, at: 1 });
  assert.equal(X.extension(wb), 'xlsm');
  const out = await X.write(wb, { date: DATE, recalc: false });
  const p = await parts(out);
  assert.match(p['[Content_Types].xml'], /PartName="\/xl\/workbook.xml" ContentType="application\/vnd.ms-excel.sheet.macroEnabled.main\+xml"/);
  assert.ok(p['xl/vbaProject.bin'] !== undefined);
  const copyPart = Object.keys(p).find((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n) && !['xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml', 'xl/worksheets/sheet3.xml'].includes(n));
  assert.ok(copyPart, 'a new part for the copy');
  assert.doesNotMatch(p[copyPart], /<drawing |<legacyDrawing /, 'the drawing stays with the original');
  assert.match(p[copyPart], /<hyperlink ref="A1" r:id="rId1"/, 'an external hyperlink is no part, so the copy keeps it');
  assert.match(p['xl/worksheets/sheet1.xml'], /<drawing r:id="rId2"\/>/);
  assert.match(p['xl/worksheets/sheet1.xml'], /xr:uid="\{11691459/);
  assert.doesNotMatch(p[copyPart], /xr:uid=/, 'a copy is not the sheet Excel tracks by that id');
  const again = await X.read(out);
  assert.deepEqual(again.sheets.map((s) => s.name), ['One', 'One (2)', 'Two', 'Split view']);
  assert.equal(M.cell(M.getSheet(again, 'One (2)'), 1, 0).v, 1.5);
  const plain = await parts(await X.write(wb, { date: DATE, recalc: false, macros: false }));
  assert.equal(plain['xl/vbaProject.bin'], undefined);
  assert.match(plain['[Content_Types].xml'], /sheet.main\+xml/);
  assert.doesNotMatch(plain['xl/_rels/workbook.xml.rels'], /vbaProject/);
});

test('write: cell metadata only where its part is kept; rich values only on the #VALUE! they explain', async () => {
  const wb = await X.read(fs.readFileSync(path.join(DIR, 'lookup.xlsx')));
  const p = await parts(await X.write(wb, { date: DATE }));
  const cells = [...p['xl/worksheets/sheet1.xml'].matchAll(/<c [^>]*\bvm="\d+"[^>]*>.*?<\/c>/g)].map((m) => m[0]);
  assert.ok(cells.length > 0);
  for (const c of cells) assert.match(c, /t="e".*<v>#VALUE!<\/v>/, c);
  const fresh = M.workbook();
  fresh.sheets[0].rows.set(0, new Map([[0, { t: 'n', v: 1, f: 'SEQUENCE(1)', a: 'A1', cm: '1' }], [1, { t: 'e', v: '#VALUE!', vm: '1' }]]));
  const q = await parts(await X.write(fresh, { date: DATE, recalc: false }));
  assert.doesNotMatch(q['xl/worksheets/sheet1.xml'], / cm=| vm=/, 'without metadata.xml the indices would point at nothing');
});

// ── CSV and TSV ───────────────────────────────────────────────────────────────────────────────────────────────────────
const sheetOf = (wb) => { const sh = wb.sheets[0]; const out = {}; for (const [r, row] of sh.rows) for (const [c, x] of row) out[M.cellName(r, c)] = x; return out; };

test('csv: quotes, doubled quotes, line breaks inside quotes, CRLF, LF and CR, a final line end, empty fields', () => {
  const wb = X.readDelimited('name,note,qty\r\n"Lee, Ann","said ""hi""\nthen left",3\n,,\rlast,"",x\r\n');
  const c = sheetOf(wb);
  assert.deepEqual(c.A2, { t: 's', v: 'Lee, Ann' });
  assert.deepEqual(c.B2, { t: 's', v: 'said "hi"\nthen left' });
  assert.deepEqual(c.C2, { t: 'n', v: 3 });
  assert.equal(c.A3, undefined, 'empty fields are blank cells');
  assert.deepEqual(c.A4, { t: 's', v: 'last' });
  assert.equal(c.B4, undefined, 'a quoted empty field is blank too');
  assert.equal(M.getSheet(wb, 'Sheet1').rows.size, 3, 'no row for the final line end');
});

test('csv: typed values as Excel opens them: numbers, money, percents, dates, booleans, errors, formulas, leading zeros', () => {
  const wb = X.readDelimited('1.5,"1,200",$5.25,12%,3/4/2025,TRUE,#N/A,=A1*2,0042,  spaced  ,=SUM((,1e3');
  const c = sheetOf(wb);
  assert.deepEqual([c.A1, c.B1.v, c.C1.v, c.D1.v, c.E1.v, c.F1, c.G1], [{ t: 'n', v: 1.5 }, 1200, 5.25, 0.12, M.toSerial(2025, 3, 4), { t: 'b', v: true }, { t: 'e', v: '#N/A' }]);
  assert.deepEqual([wb.styles[c.B1.s].fmt, wb.styles[c.C1.s].fmt, wb.styles[c.D1.s].fmt, wb.styles[c.E1.s].fmt], ['#,##0', '"$"#,##0.00', '0%', 'm/d/yyyy']);
  assert.deepEqual(c.H1, { t: 'z', f: 'A1*2' });
  assert.deepEqual(c.I1, { t: 'n', v: 42 }, 'Excel drops the zeros of an unquoted number');
  assert.deepEqual(c.J1, { t: 's', v: '  spaced  ' });
  assert.deepEqual(c.K1, { t: 's', v: '=SUM((' }, 'a formula Excel would refuse stays text');
  assert.deepEqual(c.L1.v, 1000);
});

test('csv: delimiter sniffing (comma, semicolon, tab, pipe) and the file name', () => {
  assert.equal(X.sniff('a;b;c\n1;2;3\n4;5;6'), ';');
  assert.equal(X.sniff('a,b;c\n1,2;3\n4,5;6\n7,8;9'), ',', 'a tie goes to the comma');
  assert.equal(X.sniff('name\tcity, state\nAnn\tAustin, TX\nBo\tReno, NV'), '\t', 'commas inside fields don\'t count');
  assert.equal(X.sniff('"a,b"|c\n"d,e"|f'), '|');
  assert.equal(X.sniff('just one column\nand another line'), ',');
  assert.equal(X.sniff('x;y\n"1;2";3\n4;5'), ';');
  const tsv = X.readDelimited('a,b\tc', { name: 'Grades 2026.tsv' });
  assert.deepEqual(sheetOf(tsv).A1, { t: 's', v: 'a,b' }, '.tsv is tab separated');
  assert.equal(tsv.sheets[0].name, 'Grades 2026');
  assert.equal(X.readDelimited('a', { name: 'a:b/c*?.csv' }).sheets[0].name, 'Sheet1', 'a name Excel would refuse');
  assert.equal(X.readDelimited('a;b', { delimiter: ',' }).sheets[0].rows.get(0).get(0).v, 'a;b');
});

test('csv: byte-order marks and encodings', () => {
  const utf8 = Uint8Array.from([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('Ünï,2')]);
  assert.deepEqual(sheetOf(X.readDelimited(utf8)).A1, { t: 's', v: 'Ünï' });
  const le = Uint8Array.from([0xff, 0xfe, ...[...'ab\tç\r\n1\t2'].flatMap((ch) => [ch.charCodeAt(0) & 255, ch.charCodeAt(0) >> 8])]);
  const w = X.readDelimited(le);
  assert.deepEqual([sheetOf(w).A1.v, sheetOf(w).B1.v, sheetOf(w).B2.v], ['ab', 'ç', 2], 'UTF-16 with a BOM: Excel\'s Unicode Text');
  const be = Uint8Array.from([0xfe, 0xff, ...[...'x,y'].flatMap((ch) => [ch.charCodeAt(0) >> 8, ch.charCodeAt(0) & 255])]);
  assert.equal(sheetOf(X.readDelimited(be)).B1.v, 'y');
  const latin = Uint8Array.from([0x63, 0x61, 0x66, 0xe9, 0x2c, 0x31]);
  assert.equal(sheetOf(X.readDelimited(latin)).A1.v, 'café', 'not UTF-8: Windows-1252');
  assert.equal(sheetOf(X.readDelimited('\ufeffa,b')).A1.v, 'a');
});

test('csv: an unclosed quote and the cell cap degrade, listed in the problems', () => {
  const wb = X.readDelimited('a,"b\nc,d');
  assert.deepEqual(sheetOf(wb).B1, { t: 's', v: 'b\nc,d' });
  assert.deepEqual(wb.keep.problems.map((p) => p.code), ['quote']);
  const big = X.readDelimited(`${'1,'.repeat(999)}1\n`.repeat(251));
  assert.equal(M.cellCount(big), 250000);
  assert.deepEqual(big.keep.problems.map((p) => p.code), ['cap-cells']);
});

test('csv: written as Excel saves CSV UTF-8: shown text, quotes where needed, CRLF, a BOM; TSV with tabs', async () => {
  const wb = await X.read(synthetic());
  const one = M.getSheet(wb, 'One');
  const csv = X.writeDelimited(wb, { sheet: one.id, recalc: false });
  const lines = csv.split('\r\n');
  assert.equal(csv[0], '\ufeff');
  assert.equal(lines[0], '\ufeffplain & simple,Bold blue sub,日本,"a\rb_x0041_",,in,Bc,', 'a carriage return is quoted too');
  assert.equal(lines[1], '1.5,TRUE,#N/A,44863.5,-4E+300,x1.5,TRUE,#DIV/0!', 'shown as their formats show them: the ISO date has no date format');
  assert.equal(lines.at(-1), '', 'a line end after the last row');
  const tsv = X.writeDelimited(wb, { sheet: 'One', delimiter: '\t', bom: false, recalc: false });
  assert.equal(tsv.split('\r\n')[1].split('\t').length, 8);
  const q = M.workbook();
  q.sheets[0].rows.set(0, new Map([[0, { t: 's', v: 'a,b' }], [1, { t: 's', v: 'say "x"' }], [2, { t: 's', v: 'two\nlines' }], [3, { t: 'n', v: 0.1 + 0.2 }], [4, { t: 'n', v: 1 / 3 }]]));
  q.sheets[0].rows.set(2, new Map([[1, { t: 'b', v: false }]]));
  assert.equal(X.writeDelimited(q, { bom: false }), '"a,b","say ""x""","two\nlines",0.3,0.333333333\r\n,,,,\r\n,FALSE,,,\r\n');
  const back = X.readDelimited(X.writeDelimited(q));
  assert.deepEqual(sheetOf(back).A1, { t: 's', v: 'a,b' });
  assert.deepEqual(sheetOf(back).C1, { t: 's', v: 'two\nlines' });
});

test('review reader: ambiguous ZIP parts are refused, including case aliases', async () => {
  const base = D.unzip(synthetic()), files = [];
  for (const name of base.names) files.push({ name, data: await base.bytes(name) });
  for (const name of ['xl/workbook.xml', 'XL/WORKBOOK.XML']) {
    await assert.rejects(X.read(Buffer.concat(Z.zip([...files, { name, data: enc.encode(BOOK()) }]))), /duplicate|ambiguous/i);
  }
});

test('review reader: missing content types and package-escaping relationships are reported', async () => {
  const wb = await X.read(synthetic({ '[Content_Types].xml': '',
    'xl/worksheets/_rels/sheet1.xml.rels': rels([['bad', 'comments', '../../../xl/comments1.xml']]) }));
  assert.ok(wb.keep.problems.some((p) => p.code === 'content-types'));
  assert.ok(wb.keep.problems.some((p) => p.code === 'relationship'));
  assert.deepEqual(wb.sheets[0].keep.rels, []);
});

test('review reader: an empty array formula cannot discard later cells', async () => {
  const wb = await X.read(synthetic({ 'xl/worksheets/sheet1.xml': `<worksheet ${NS}><sheetData><row r="1"><c r="A1"><f t="array" ref="A1:A2"/><v>1</v></c><c r="B1"><v>2</v></c></row></sheetData></worksheet>` }));
  assert.equal(at(wb, 'One', 'B1')?.v, 2);
  assert.ok(wb.keep.problems.some((p) => p.code === 'formula'));
});

test('review reader: imported strings obey the model text cap', async () => {
  const long = 'x'.repeat(M.CAP.text + 1);
  const wb = await X.read(synthetic({ 'xl/worksheets/sheet1.xml': `<worksheet ${NS}><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>${long}</t></is></c><c r="B1" t="str"><v>${long}</v></c></row></sheetData></worksheet>` }));
  for (const a of ['A1', 'B1']) assert.equal(at(wb, 'One', a).v.length, M.CAP.text);
  assert.ok(wb.keep.problems.some((p) => p.code === 'text'));
});

test('review writer: unchanged cellXfs retain flags, inheritance and unmodelled fields', async () => {
  const xf = '<xf numFmtId="164" fontId="1" fillId="2" borderId="1" xfId="1" applyFont="0" applyFill="0" applyNumberFormat="0" applyBorder="0" applyProtection="0" applyAlignment="0" pivotButton="1"><alignment relativeIndent="2"/><protection locked="0"/></xf>';
  const styles = STYLES.replace(/<cellXfs[\s\S]*?<\/cellXfs>/, `<cellXfs count="1">${xf}</cellXfs>`);
  const wb = await X.read(synthetic({ 'xl/styles.xml': styles }));
  const p = await parts(await X.write(wb, { recalc: false }));
  assert.ok(p['xl/styles.xml'].includes(`<cellXfs count="1">${xf}</cellXfs>`));
  wb.styles[0] = { bold: true };
  const q = await parts(await X.write(wb, { recalc: false }));
  assert.ok(!q['xl/styles.xml'].includes(xf), 'an edited style must be regenerated');
});

test('review writer: prefixed and empty roots produce well-formed namespaced XML', async () => {
  const wb = await X.read(synthetic({
    'xl/workbook.xml': `<s:workbook xmlns:s="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${RT}"><s:sheets><s:sheet name="One" sheetId="1" r:id="rId1"/></s:sheets></s:workbook>`,
    'xl/worksheets/sheet1.xml': '<s:worksheet xmlns:s="http://schemas.openxmlformats.org/spreadsheetml/2006/main"/>',
    'xl/styles.xml': '<s:styleSheet xmlns:s="http://schemas.openxmlformats.org/spreadsheetml/2006/main"/>',
  }));
  const p = await parts(await X.write(wb, { recalc: false }));
  for (const [file, root] of [['xl/workbook.xml', 'workbook'], ['xl/worksheets/sheet1.xml', 'worksheet'], ['xl/styles.xml', 'styleSheet']]) {
    assert.match(p[file], new RegExp(`<s:${root}[^>]* xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"[^>]*>`));
    assert.ok(p[file].endsWith(`</s:${root}>`));
    assert.doesNotMatch(p[file], new RegExp(`<s:${root}[^>]*\\/>`));
  }
});

test('review writer: large number-format tables do not overflow the call stack', async () => {
  const wb = M.workbook();
  wb.keep.styles = { numFmts: Array.from({ length: 140000 }, (_, i) => ({ id: 164 + i, code: '0' })) };
  wb.styles = [{ fmt: '0.0001' }];
  const p = await parts(await X.write(wb, { recalc: false }));
  assert.match(p['xl/styles.xml'], /numFmtId="140164" formatCode="0.0001"/);
});

test('review writer: refs in single quotes, whole columns and rows, and kept table formulas move', async () => {
  const xml = SHEET1.replace('</worksheet>', "<ignoredErrors><ignoredError sqref='$A:$C $2:$5' numberStoredAsText='1'/></ignoredErrors><dataValidations count='1'><dataValidation sqref='C2:C5'><formula1>Two!A1</formula1></dataValidation></dataValidations><tableParts count=\"1\"><tablePart r:id=\"t\"/></tableParts></worksheet>");
  const wb = await X.read(synthetic({ 'xl/worksheets/sheet1.xml': xml,
    'xl/worksheets/_rels/sheet1.xml.rels': rels([['t', 'table', '../tables/table1.xml']]),
    'xl/tables/table1.xml': `<table ${NS} ref="A1:C5"><tableColumns count="1"><tableColumn id="1" name="V"><calculatedColumnFormula>A2+Two!A1</calculatedColumnFormula></tableColumn></tableColumns></table>` }));
  const sh = wb.sheets[0];
  X.track(wb, { op: 'insert', sheet: sh.id, axis: 'row', at: 1, n: 1 });
  X.track(wb, { op: 'insert', sheet: sh.id, axis: 'col', at: 1, n: 1 });
  const p = await parts(await X.write(wb, { recalc: false }));
  assert.match(p['xl/worksheets/sheet1.xml'], /sqref=["']\$?A:\$?D \$?3:\$?6["']/);
  assert.match(p['xl/worksheets/sheet1.xml'], /sqref=["']D3:D6["']/);
  assert.match(p['xl/tables/table1.xml'], /<calculatedColumnFormula>A3\+Two!A1<\/calculatedColumnFormula>/);
});

test('review writer: kept range insertion at its first cell moves the start too', async () => {
  const wb = await X.read(synthetic());
  X.track(wb, { op: 'insert', sheet: wb.sheets[0].id, axis: 'row', at: 1, n: 2 });
  const p = await parts(await X.write(wb, { recalc: false }));
  assert.match(p['xl/worksheets/sheet1.xml'], /sqref="A4:A11 C4"/);
});

test('review writer: shifted chart formulas invalidate stale point caches', async () => {
  const chart = '<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:numRef><c:f>One!$A$2:$A$3</c:f><c:numCache><c:ptCount val="2"/><c:pt idx="0"><c:v>7</c:v></c:pt></c:numCache></c:numRef></c:chartSpace>';
  const wb = await X.read(synthetic({ 'xl/charts/chart1.xml': chart }));
  X.track(wb, { op: 'delete', sheet: wb.sheets[0].id, axis: 'row', at: 1, n: 1 });
  const p = await parts(await X.write(wb, { recalc: false }));
  assert.match(p['xl/charts/chart1.xml'], /One!\$A\$2/);
  assert.doesNotMatch(p['xl/charts/chart1.xml'], /numCache/);
});

test('review copied sheet: the original keeps its part and revision id even after the copy moves before it', async () => {
  const wb = await X.read(synthetic({ 'xl/worksheets/sheet1.xml': SHEET1.replace('<worksheet ', '<worksheet xmlns:xr="http://schemas.microsoft.com/office/spreadsheetml/2014/revision" xr:uid="original" ') }));
  const one = wb.sheets[0], copy = { ...one, id: 77, name: 'Copy', keep: { ...one.keep } };
  wb.sheets.unshift(copy);
  const p = await parts(await X.write(wb, { recalc: false }));
  const again = await X.read(await X.write(wb, { recalc: false }));
  assert.equal(M.getSheet(again, 'One').keep.path, one.keep.path);
  assert.match(p[one.keep.path], /xr:uid="original"/);
  assert.doesNotMatch(p[M.getSheet(again, 'Copy').keep.path], /xr:uid=/);
  assert.match(p[one.keep.path], /<drawing /);
});

test('review csv: formula caches refresh and sparse rectangles are bounded', () => {
  const wb = X.readDelimited('2,=A1*2');
  assert.equal(X.writeDelimited(wb, { bom: false }), '2,4\r\n');
  const sparse = M.workbook(), sh = sparse.sheets[0];
  sh.rows.set(M.MAX_ROWS - 1, new Map([[M.MAX_COLS - 1, { t: 'n', v: 1 }]]));
  sh.rows.get = () => { throw Error('export walked a giant rectangle'); };
  assert.throws(() => X.writeDelimited(sparse), (e) => e.code === 'cap-cells');
});

test('review dependencies: a failed early lookup can retry after the engine loads', () => {
  const vm = require('node:vm');
  const ctx = { GZ_SHEET_MODEL: M, module: { exports: {} }, require: () => { throw Error('late dependency'); } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../lib/sheet-xlsx.js'), 'utf8'), ctx);
  assert.throws(() => ctx.module.exports.tinted('#000000', 0), /late dependency/);
  Object.assign(ctx, { GZ_SHEET_FORMULA: require('../lib/sheet-formula.js'), GZ_SHEET_NUMFMT: require('../lib/sheet-numfmt.js'), GZ_DOCTEXT: D });
  assert.equal(M.cell(ctx.module.exports.readDelimited('1').sheets[0], 0, 0)?.v, 1);
});

test('review page: Documents defers spreadsheet and document file codecs', () => {
  const html = fs.readFileSync(path.join(__dirname, '../papers.html'), 'utf8');
  assert.doesNotMatch(html, /<script src="lib\/(?:sheet-xlsx|doctext|zip)\.js"/);
});

test('review charts: relationship lookup honours XML encoding and package case', async () => {
  const rp = 'xl/drawings/_rels/drawing1.xml.rels', z = D.unzip(synthetic()), files = [];
  for (const name of z.names) files.push({ name: name === rp ? rp.toUpperCase() : name, data: name === rp
    ? Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(await z.text(name), 'utf16le')]) : await z.bytes(name) });
  const wb = await X.read(Buffer.concat(Z.zip(files)));
  assert.deepEqual(wb.sheets[0].keep.drawing.charts, ['xl/charts/chart1.xml']);
  const out = await parts(await X.write(wb, { recalc: false }));
  assert.ok(out['xl/charts/chart1.xml'], 'chart remains reachable through UTF-16 relationships');
  assert.ok(out[rp.toUpperCase()], 'case-variant relationships are retained');
});

test('review track: undo of a delete-and-rename batch restores the original kept refs', async () => {
  const wb = await X.read(synthetic()), e = C.engine(wb), id = wb.sheets[0].id;
  const op = { op: 'batch', ops: [{ op: 'delete', sheet: id, axis: 'row', at: 1, n: 1 }, { op: 'rename', sheet: id, name: "O'Brien" }] };
  const undo = e.apply(op).inverse;
  X.track(wb, op);
  const changed = await parts(await X.write(wb, { recalc: false }));
  assert.match(changed['xl/worksheets/sheet1.xml'], /sqref="A2:A8"/);
  e.apply(undo); X.track(wb, undo);
  assert.deepEqual(wb.keep.log, []);
});

test('review kept counts: deleting a nonempty validation updates its container count', async () => {
  const sheet = `<worksheet ${NS}><sheetData/><dataValidations count='2'><dataValidation sqref='A2'><formula1>1</formula1></dataValidation><dataValidation sqref='B5'><formula1>2</formula1></dataValidation></dataValidations></worksheet>`;
  const wb = await X.read(synthetic({ 'xl/worksheets/sheet1.xml': sheet }));
  X.track(wb, { op: 'delete', sheet: wb.sheets[0].id, axis: 'row', at: 1, n: 1 });
  const p = await parts(await X.write(wb, { recalc: false }));
  assert.match(p['xl/worksheets/sheet1.xml'], /<dataValidations count=["']1["']>/);
});

test('review locked: named pivot sources and data tables refuse structural edits', async () => {
  const wb = await X.read(synthetic({
    'xl/workbook.xml': BOOK().replace('</definedNames>', '<definedName name="PivotSource">Two!$A$1:$B$5</definedName></definedNames>'),
    'xl/_rels/workbook.xml.rels': rels([['rId1', 'worksheet', 'worksheets/sheet1.xml'], ['rId2', 'worksheet', 'worksheets/sheet2.xml'], ['p', 'pivotCacheDefinition', 'pivotCache/p.xml']]),
    'xl/pivotCache/p.xml': `<pivotCacheDefinition ${NS}><cacheSource type="worksheet"><worksheetSource name="PivotSource"/></cacheSource></pivotCacheDefinition>`,
    'xl/worksheets/sheet1.xml': `<worksheet ${NS}><sheetData><row r="1"><c r="A1"><f t="dataTable" ref="A1:B5" r1="C1"/><v>1</v></c></row></sheetData></worksheet>`,
  }));
  for (const sh of wb.sheets) assert.ok(X.locked(wb, { op: 'insert', sheet: sh.id, axis: 'row', at: 0, n: 1 }), sh.name);
});
