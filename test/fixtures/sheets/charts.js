// A workbook with charts as Excel writes them (its element order, namespaces, caches and two-cell anchors), built with
// lib/zip.js for test/sheet-chart*.test.js and scripts/sheets-check.js: sheet Data's months, sales, costs and an x/y
// pair; a clustered column, a line, a pie and a scatter chart, and a radar chart Glaze draws as a frame.
const Z = require('../../../lib/zip.js');
const enc = new TextEncoder();
const RT = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const C_NS = 'xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const rels = (list) => `${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${list.map(([id, type, target]) => `<Relationship Id="${id}" Type="${type.includes('/') ? type : `${RT}/${type}`}" Target="${target}"/>`).join('')}</Relationships>`;
const pack = (parts) => Buffer.concat(Z.zip(Object.entries(parts).map(([name, s]) => ({ name, data: typeof s === 'string' ? enc.encode(s) : s, date: new Date(2026, 0, 1) }))));

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr'], SALES = [10, 20, 30, 40], COSTS = [5, 15, 10, 20], XS = [1, 2, 3, 4], YS = [2, 4, 1, 3];
const strCache = (list) => `<c:strCache><c:ptCount val="${list.length}"/>${list.map((v, i) => `<c:pt idx="${i}"><c:v>${v}</c:v></c:pt>`).join('')}</c:strCache>`;
const numCache = (list, fmt = 'General') => `<c:numCache><c:formatCode>${fmt}</c:formatCode><c:ptCount val="${list.length}"/>${list.map((v, i) => `<c:pt idx="${i}"><c:v>${v}</c:v></c:pt>`).join('')}</c:numCache>`;
const rich = (text) => `<c:title><c:tx><c:rich><a:bodyPr rot="0" spcFirstLastPara="1" vertOverflow="ellipsis" wrap="square" anchor="ctr" anchorCtr="1"/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="1400" b="0"/></a:pPr><a:r><a:rPr lang="en-US"/><a:t>${text}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title>`;
const fill = (k) => `<c:spPr><a:solidFill><a:schemeClr val="accent${k}"/></a:solidFill><a:ln><a:noFill/></a:ln></c:spPr>`;
const ser = (i, col, cat, vals, extra = '') => `<c:ser><c:idx val="${i}"/><c:order val="${i}"/><c:tx><c:strRef><c:f>Data!$${col}$1</c:f>${strCache([col === 'B' ? 'Sales' : col === 'C' ? 'Costs' : 'y'])}</c:strRef></c:tx>${extra}`
  + `<c:cat><c:strRef><c:f>Data!$A$2:$A$5</c:f>${strCache(cat)}</c:strRef></c:cat><c:val><c:numRef><c:f>Data!$${col}$2:$${col}$5</c:f>${numCache(vals)}</c:numRef></c:val></c:ser>`;
const axes = (cat = 'catAx') => `<c:${cat}><c:axId val="10"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="b"/><c:numFmt formatCode="General" sourceLinked="1"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:crossAx val="20"/><c:crosses val="autoZero"/>${cat === 'catAx' ? '<c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/>' : '<c:crossBetween val="midCat"/>'}</c:${cat}>`
  + '<c:valAx><c:axId val="20"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="l"/><c:majorGridlines/><c:numFmt formatCode="General" sourceLinked="1"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:crossAx val="10"/><c:crosses val="autoZero"/><c:crossBetween val="between"/></c:valAx>';
const space = (title, plot, legend = 'b') => `${HEAD}<c:chartSpace ${C_NS}><c:date1904 val="0"/><c:lang val="en-US"/><c:roundedCorners val="0"/><c:chart>${title ? rich(title) : ''}<c:autoTitleDeleted val="${title ? 0 : 1}"/>`
  + `<c:plotArea><c:layout/>${plot}</c:plotArea>${legend ? `<c:legend><c:legendPos val="${legend}"/><c:overlay val="0"/></c:legend>` : ''}<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart></c:chartSpace>`;

const CHARTS = {
  column: space('Sales by month', `<c:barChart><c:barDir val="col"/><c:grouping val="clustered"/><c:varyColors val="0"/>${ser(0, 'B', MONTHS, SALES, fill(1))}${ser(1, 'C', MONTHS, COSTS, fill(2))}<c:gapWidth val="219"/><c:overlap val="-27"/><c:axId val="10"/><c:axId val="20"/></c:barChart>${axes()}`),
  line: space('Trend', `<c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/>${ser(0, 'B', MONTHS, SALES, '<c:spPr><a:ln w="28575" cap="rnd"><a:solidFill><a:schemeClr val="accent1"/></a:solidFill><a:round/></a:ln></c:spPr><c:marker><c:symbol val="none"/></c:marker>')}<c:marker val="1"/><c:axId val="10"/><c:axId val="20"/></c:lineChart>${axes()}`),
  pie: space('Share', `<c:pieChart><c:varyColors val="1"/>${ser(0, 'B', MONTHS, SALES).replace('</c:tx>', `</c:tx>${[1, 2, 3, 4].map((k, i) => `<c:dPt><c:idx val="${i}"/><c:bubble3D val="0"/>${fill(k)}</c:dPt>`).join('')}`)}<c:firstSliceAng val="0"/></c:pieChart>`, 'r'),
  scatter: space('Spread', `<c:scatterChart><c:scatterStyle val="lineMarker"/><c:varyColors val="0"/><c:ser><c:idx val="0"/><c:order val="0"/><c:tx><c:strRef><c:f>Data!$E$1</c:f>${strCache(['y'])}</c:strRef></c:tx><c:spPr><a:ln w="25400" cap="rnd"><a:noFill/><a:round/></a:ln></c:spPr><c:marker><c:symbol val="circle"/><c:size val="5"/><c:spPr><a:solidFill><a:schemeClr val="accent1"/></a:solidFill></c:spPr></c:marker>`
    + `<c:xVal><c:numRef><c:f>Data!$D$2:$D$5</c:f>${numCache(XS)}</c:numRef></c:xVal><c:yVal><c:numRef><c:f>Data!$E$2:$E$5</c:f>${numCache(YS)}</c:numRef></c:yVal><c:smooth val="0"/></c:ser><c:axId val="10"/><c:axId val="20"/></c:scatterChart>${axes('valAx').replace('<c:axPos val="b"/>', '<c:axPos val="b"/>')}`, null),
  radar: space('Radar view', `<c:radarChart><c:radarStyle val="marker"/><c:varyColors val="0"/>${ser(0, 'B', MONTHS, SALES)}<c:axId val="10"/><c:axId val="20"/></c:radarChart>${axes()}`),
};
// Where each sits: [from col, from row, to col, to row] (0-based cells).
const PLACES = { column: [6, 1, 12, 15], line: [13, 1, 19, 15], pie: [6, 16, 12, 30], scatter: [13, 16, 19, 30], radar: [6, 31, 12, 45] };
const anchor = ([c0, r0, c1, r1], i, name) => `<xdr:twoCellAnchor editAs="oneCell"><xdr:from><xdr:col>${c0}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${r0}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>${c1}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${r1}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>`
  + `<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${i + 2}" name="${name}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" r:id="rId${i + 1}"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor>`;

// The workbook. kinds: which of CHARTS, in order; over: parts to replace or add.
const workbook = ({ kinds = ['column', 'line', 'pie', 'scatter', 'radar'], over = {} } = {}) => {
  const strings = ['Month', 'Sales', 'Costs', 'x', 'y', ...MONTHS];
  const s = (v) => strings.indexOf(v);
  const row = (r, cells) => `<row r="${r}">${cells.map(([ref, v]) => (typeof v === 'number' ? `<c r="${ref}"><v>${v}</v></c>` : `<c r="${ref}" t="s"><v>${s(v)}</v></c>`)).join('')}</row>`;
  const rows = [row(1, [['A1', 'Month'], ['B1', 'Sales'], ['C1', 'Costs'], ['D1', 'x'], ['E1', 'y']])];
  for (let i = 0; i < 4; i++) rows.push(row(i + 2, [[`A${i + 2}`, MONTHS[i]], [`B${i + 2}`, SALES[i]], [`C${i + 2}`, COSTS[i]], [`D${i + 2}`, XS[i]], [`E${i + 2}`, YS[i]]]));
  const parts = {
    '[Content_Types].xml': `${HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>`
      + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
      + '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/><Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>'
      + `${kinds.map((k, i) => `<Override PartName="/xl/charts/chart${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>`).join('')}</Types>`,
    '_rels/.rels': rels([['rId1', 'officeDocument', 'xl/workbook.xml']]),
    'xl/workbook.xml': `${HEAD}<workbook ${NS}><bookViews><workbookView/></bookViews><sheets><sheet name="Data" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': rels([['rId1', 'worksheet', 'worksheets/sheet1.xml'], ['rId2', 'sharedStrings', 'sharedStrings.xml']]),
    'xl/sharedStrings.xml': `${HEAD}<sst ${NS} count="${strings.length}" uniqueCount="${strings.length}">${strings.map((x) => `<si><t>${x}</t></si>`).join('')}</sst>`,
    'xl/worksheets/sheet1.xml': `${HEAD}<worksheet ${NS}><sheetData>${rows.join('')}</sheetData><drawing r:id="rId1"/></worksheet>`,
    'xl/worksheets/_rels/sheet1.xml.rels': rels([['rId1', 'drawing', '../drawings/drawing1.xml']]),
    'xl/drawings/drawing1.xml': `${HEAD}<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="${RT}">${kinds.map((k, i) => anchor(PLACES[k], i, `Chart ${i + 1}`)).join('')}</xdr:wsDr>`,
    'xl/drawings/_rels/drawing1.xml.rels': rels(kinds.map((k, i) => [`rId${i + 1}`, 'chart', `../charts/chart${i + 1}.xml`])),
    ...Object.fromEntries(kinds.map((k, i) => [`xl/charts/chart${i + 1}.xml`, CHARTS[k]])),
    ...over,
  };
  return pack(parts);
};

module.exports = { workbook, CHARTS, PLACES, MONTHS, SALES, COSTS, XS, YS, pack, rels, space, ser, axes, fill, rich, strCache, numCache, C_NS };
