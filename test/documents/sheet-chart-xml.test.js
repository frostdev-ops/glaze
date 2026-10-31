// Card summaries use the same DrawingML parts as the spreadsheet chart reader.
const test = require('node:test');
const assert = require('node:assert/strict');
const X = require('../../extension/documents/sheets/sheet-xlsx.js');
const CX = require('../../extension/documents/sheets/sheet-chart-xml.js');
const FX = require('../fixtures/sheets/charts.js');
const marker = (tag, col, row, colOff = 0, rowOff = 0) => `<xdr:${tag}><xdr:col>${col}</xdr:col><xdr:colOff>${colOff * CX.EMU}</xdr:colOff><xdr:row>${row}</xdr:row><xdr:rowOff>${rowOff * CX.EMU}</xdr:rowOff></xdr:${tag}>`;
const frame = '<xdr:graphicFrame><xdr:nvGraphicFramePr><xdr:cNvPr id="2" name="Chart 1"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" r:id="rId1"/></a:graphicData></a:graphic></xdr:graphicFrame>';
const anchor = (kind, pos) => `<xdr:${kind}>${pos}${frame}<xdr:clientData/></xdr:${kind}>`;
const drawing = (body) => `<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${body}</xdr:wsDr>`;
const book = (body) => X.read(FX.workbook({ kinds: ['column'], over: { 'xl/drawings/drawing1.xml': drawing(body) } }));
const ext = (w, h) => `<xdr:ext cx="${w * CX.EMU}" cy="${h * CX.EMU}"/>`;

test('glance uses exclusive end boundaries and does not give empty or reversed anchors a cell', async () => {
  const wb = await book([
    anchor('twoCellAnchor', marker('from', 1, 1) + marker('to', 5, 4)),
    anchor('twoCellAnchor', marker('from', 5, 3) + marker('to', 8, 6, 1, 1)),
    anchor('twoCellAnchor', marker('from', 1, 1) + marker('to', 1, 1)),
    anchor('twoCellAnchor', marker('from', 2, 2, 12, 5) + marker('to', 2, 2, 1, 1)),
    anchor('oneCellAnchor', marker('from', 1, 1) + ext(0, 40)),
    anchor('absoluteAnchor', `<xdr:pos x="0" y="0"/>` + ext(64, 0)),
  ].join(''));
  const list = CX.glance(wb, wb.sheets[0]);
  assert.deepEqual(list.slice(0, 2).map((x) => x.anchor), [[1, 1, 3, 4], [3, 5, 6, 8]]);
  for (const x of list.slice(2)) assert.ok(x.anchor[2] < x.anchor[0] || x.anchor[3] < x.anchor[1], `no area: ${JSON.stringify(x.anchor)}`);
});

test('glance locates one-cell and absolute extents using actual row and column sizes', async () => {
  const wb = await book([
    anchor('oneCellAnchor', marker('from', 0, 0, 100, 30) + ext(100, 30)),
    anchor('absoluteAnchor', `<xdr:pos x="${100 * CX.EMU}" y="${30 * CX.EMU}"/>` + ext(100, 30)),
    anchor('twoCellAnchor', marker('from', 0, 0, 200, 60) + marker('to', 2, 2)),
  ].join(''));
  const sh = wb.sheets[0];
  sh.colW.set(0, 200 / 7); sh.rowH.set(0, 45); // A is 200px, row 1 is 60px.
  assert.deepEqual(CX.glance(wb, sh).map((x) => x.anchor), [[0, 0, 0, 0], [0, 0, 0, 0], [1, 1, 1, 1]]);
});
