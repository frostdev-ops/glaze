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
  assert.equal(cases1.colW.get(0), 566, 'width 80.83203125 is 566 px');
  assert.deepEqual(cases1.keep.defaults, { colW: 75, rowH: 64 / 3 }, 'baseColWidth 10, defaultRowHeight 16 pt');
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
  assert.equal(s[1].color, '#2F5597', "Excel's darker 25% of accent 1");
  assert.equal(X.tinted('#FEFEFE', 0.39997558519241921), '#FEFEFE');
  assert.equal(X.tinted('#4472C4', 0.39997558519241921), '#8FAADC', "Excel's lighter 40% of accent 1");
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
  assert.deepEqual(s[11], { fmt: 'General' }, 'a custom id the file never defines is General');
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
  assert.deepEqual(M.getSheet(wb, 'One').keep.locks, ['external']);
});

test('synthetic: sheets, names, sizes, merges, freeze panes, filter and sort, kept elements', async () => {
  const wb = await X.read(synthetic());
  assert.equal(wb.date1904, true);
  assert.deepEqual(wb.sheets.map((s) => [s.name, s.id]), [['One', 5], ['Two', 2], ['Split view', 9]]);
  assert.equal(wb.active, 2, 'activeTab 3 counts the chart sheet');
  assert.equal(M.getSheet(wb, 'Two').keep.state, 'hidden');
  assert.deepEqual(wb.names, [
    { name: '_xlnm._FilterDatabase', ref: 'One!$A$1:$H$9', sheet: 5, hidden: true },
    { name: 'Rate', ref: '0.25', attrs: { comment: 'tax' } },
    { name: 'Local', ref: 'Two!$A$1', sheet: 2 },
    { name: 'Pick', ref: 'XLOOKUP(1,One!$A:$A,One!$B:$B)' },
  ]);
  const one = M.getSheet(wb, 'One');
  assert.deepEqual([...one.colW], [[0, 145], [1, 0], [2, 0], [4, 64]], "Excel's 20.00 (145 pixels) and 8.43 (64 pixels)");
  assert.deepEqual([...one.hidden.cols], [1, 2]);
  assert.deepEqual([...one.keep.colAttrs], [[4, { style: '3' }]]);
  assert.deepEqual([...one.rowH], [[0, 40]], 'custom heights only: 30 pt is 40 px');
  assert.deepEqual([...one.hidden.rows], [1]);
  assert.deepEqual([...one.keep.rowAttrs], [[2, { ht: '12.75', s: '4', outlineLevel: '1' }]]);
  assert.deepEqual(one.keep.defaults, { colW: 64, rowH: 20 });
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
  assert.deepEqual(one.keep.drawing, { id: 'rId2', path: 'xl/drawings/drawing1.xml' });
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
  assert.deepEqual(wb.keep.problems.map((p) => p.code), ['cap-sheets', 'cap-sheets']);
  const row = '<c><v>1</v></c>'.repeat(1000);
  const big = pack({
    'xl/workbook.xml': `<workbook ${NS}><sheets><sheet name="Big" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': rels([['rId1', 'worksheet', 'worksheets/sheet1.xml']]),
    'xl/worksheets/sheet1.xml': `<worksheet ${NS}><sheetData>${`<row>${row}</row>`.repeat(251)}</sheetData></worksheet>`,
  });
  const b = await X.read(big);
  assert.equal(M.cellCount(b), 250000);
  assert.deepEqual(b.keep.problems.map((p) => p.code), ['cap-cells']);
});
