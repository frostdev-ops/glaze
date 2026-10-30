// A sheet's charts (lib/sheet-chart-xml.js, lib/sheet-chart.js): the drawing's anchors and the chart parts of a workbook
// built as Excel writes one (test/fixtures/sheets/charts.js) read into descriptions, their references read live and
// moved with inserted rows and renamed sheets, the types Glaze doesn't draw kept as titled frames; the layout's bar
// widths, nice axis ticks, pie angles, scatter scale and stacked totals; and a workbook read and written untouched keeps
// its chart and drawing parts byte for byte, drawn or not.
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../lib/sheet-model.js');
const X = require('../lib/sheet-xlsx.js');
const C = require('../lib/sheet-calc.js');
const D = require('../lib/doctext.js');
const CX = require('../lib/sheet-chart-xml.js');
const CH = require('../lib/sheet-chart.js');
const FX = require('./fixtures/sheets/charts.js');

const open = async (o) => { const wb = await X.read(FX.workbook(o)); const e = C.engine(wb); e.recalc(); return { wb, e }; };
const drawn = (wb, sh = wb.sheets[0]) => CX.charts(wb, sh).map((c) => ({ ...c, data: CX.resolve(c.chart, CX.lookup(wb)) }));
const parts = async (bytes) => { const z = D.unzip(bytes); const out = {}; for (const n of z.names) out[n] = await z.text(n); return out; };

test('the drawing: five two-cell anchors in order, each to its chart part', async () => {
  const { wb } = await open();
  const list = CX.charts(wb, wb.sheets[0]);
  assert.equal(list.length, 5);
  assert.deepEqual(list.map((c) => c.path), [1, 2, 3, 4, 5].map((i) => `xl/charts/chart${i}.xml`));
  assert.deepEqual(list.map((c) => [c.anchor.from.col, c.anchor.from.row, c.anchor.to.col, c.anchor.to.row]), Object.values(FX.PLACES));
  assert.deepEqual(list.map((c) => c.anchor.kind), Array(5).fill('twoCellAnchor'));
  assert.equal(list[0].name, 'Chart 1');
});

test('the charts: types, titles, series, caches, the legend and colours from the theme', async () => {
  const { wb } = await open();
  const [column, line, pie, scatter, radar] = CX.charts(wb, wb.sheets[0]).map((c) => c.chart);
  assert.equal(column.kind, 'plot');
  assert.deepEqual(column.title, { text: 'Sales by month' });
  const g = column.groups[0];
  assert.deepEqual([g.type, g.dir, g.grouping, g.gap, g.overlap], ['bar', 'col', 'clustered', 219, -27]);
  assert.deepEqual(g.series.map((s) => [s.name.f, s.cat.f, s.val.f]), [['Data!$B$1', 'Data!$A$2:$A$5', 'Data!$B$2:$B$5'], ['Data!$C$1', 'Data!$A$2:$A$5', 'Data!$C$2:$C$5']]);
  assert.deepEqual(g.series[0].val.cache, { pts: ['10', '20', '30', '40'], fmt: 'General' });
  assert.deepEqual(g.series.map((s) => s.fill), [CX.DEFAULT_THEME[4], CX.DEFAULT_THEME[5]], 'schemeClr accent1 and accent2 of the (default) theme');
  assert.deepEqual(column.legend, { pos: 'b', overlay: false, hidden: [] });
  assert.equal(Object.values(column.axes).find((a) => a.kind === 'val').grid, true);
  assert.equal(line.groups[0].type, 'line');
  assert.equal(line.groups[0].series[0].marker.symbol, 'none');
  assert.equal(line.groups[0].series[0].width, 3, '28575 EMU');
  assert.equal(pie.groups[0].type, 'pie');
  assert.equal(pie.groups[0].vary, true);
  assert.deepEqual([...pie.groups[0].series[0].points.values()], CX.DEFAULT_THEME.slice(4, 8), 'each slice its own dPt colour');
  assert.equal(pie.legend.pos, 'r');
  assert.deepEqual([scatter.groups[0].type, scatter.groups[0].style, scatter.groups[0].series[0].line], ['scatter', 'lineMarker', 'none']);
  assert.equal(scatter.groups[0].series[0].cat.f, 'Data!$D$2:$D$5', 'xVal is the series\' categories');
  assert.deepEqual([radar.kind, radar.type, radar.title.text], ['frame', 'Radar chart', 'Radar view']);
});

test('colours: a file theme\'s accents, lumMod/lumOff, srgbClr, and the automatic order past six series', () => {
  const theme = ['#FFFFFF', '#000000', '#E7E6E6', '#44546A', '#4472C4', '#ED7D31', '#A5A5A5', '#FFC000', '#5B9BD5', '#70AD47', '#0563C1', '#954F72'];
  const xml = FX.space('T', `<c:barChart><c:barDir val="col"/><c:grouping val="clustered"/><c:varyColors val="0"/>${[0, 1, 2, 3, 4, 5, 6].map((i) => FX.ser(i, 'B', FX.MONTHS, FX.SALES)).join('')}`
    + `<c:axId val="10"/><c:axId val="20"/></c:barChart>${FX.axes()}`)
    .replace('<c:invertIfNegative', '<c:invertIfNegative');
  const c = CX.chart(xml, theme);
  assert.deepEqual(c.groups[0].series.slice(0, 6).map((s) => s.color), theme.slice(4, 10));
  assert.equal(c.groups[0].series[6].color, CX.transform('#4472C4', [{ name: 'lumMod', a: { val: '60000' } }]), 'the seventh: accent1 darker');
  assert.equal(CX.transform('#4472C4', [{ name: 'lumMod', a: { val: '75000' } }]), '#2F5597', 'Excel\'s "Blue, Accent 1, Darker 25%"');
  assert.equal(CX.transform('#4472C4', [{ name: 'lumMod', a: { val: '60000' } }, { name: 'lumOff', a: { val: '40000' } }]), '#8FAADC', 'Lighter 40%');
  const red = CX.chart(FX.space('T', `<c:barChart><c:barDir val="col"/><c:grouping val="clustered"/>${FX.ser(0, 'B', FX.MONTHS, FX.SALES, '<c:spPr><a:solidFill><a:srgbClr val="ff0000"/></a:solidFill></c:spPr>')}<c:axId val="10"/><c:axId val="20"/></c:barChart>${FX.axes()}`), theme);
  assert.equal(red.groups[0].series[0].fill, '#FF0000');
});

test('resolve: references read live, the cache when they can\'t be, hidden rows left out', async () => {
  const { wb, e } = await open();
  let [column] = drawn(wb);
  assert.equal(column.data.title, 'Sales by month');
  assert.deepEqual(column.data.groups[0].series.map((s) => [s.name, s.cats, s.vals]), [['Sales', FX.MONTHS, FX.SALES], ['Costs', FX.MONTHS, FX.COSTS]]);
  e.edit(wb.sheets[0].id, 1, 1, '80');
  [column] = drawn(wb);
  assert.deepEqual(column.data.groups[0].series[0].vals, [80, 20, 30, 40], 'B2 typed reads at once');
  wb.sheets[0].hidden.rows.add(2);
  [column] = drawn(wb);
  assert.deepEqual(column.data.groups[0].series[0].vals, [80, 30, 40], 'a hidden row is not plotted (plotVisOnly)');
  assert.deepEqual(column.data.groups[0].series[0].cats, ['Jan', 'Mar', 'Apr']);
  wb.sheets[0].hidden.rows.clear();
  // A reference to a sheet that isn't there: the cache.
  const c = CX.chart(FX.CHARTS.column.replaceAll('Data!', 'Gone!'));
  const r = CX.resolve(c, CX.lookup(wb));
  assert.deepEqual(r.groups[0].series[0].vals, FX.SALES);
  assert.equal(r.groups[0].series[0].name, 'Sales');
  // A scatter's x values are numbers; a pie's title, when the file leaves it out, is its one series' name.
  const [, , pie, scatter] = drawn(wb);
  assert.deepEqual(scatter.data.groups[0].series[0].xs, FX.XS);
  assert.deepEqual(scatter.data.groups[0].series[0].vals, FX.YS);
  const untitled = CX.resolve(CX.chart(FX.CHARTS.pie.replace(/<c:title>.*?<\/c:title><c:autoTitleDeleted val="0"\/>/, '')), CX.lookup(wb));
  assert.equal(untitled.title, 'Sales');
  assert.equal(pie.data.title, 'Share');
});

test('lookup: whole columns and rows read their used cells live across sheets', async () => {
  const { wb, e } = await open();
  e.edit(wb.sheets[0].id, 1, 1, '80');
  const other = M.sheet('Other data', 2);
  other.rows.set(0, new Map([[0, { t: 'n', v: 7 }], [2, { t: 'n', v: 9 }]]));
  wb.sheets.push(other);
  const look = CX.lookup(wb);
  assert.deepEqual(look('Data!$B:$B')?.map((x) => x.v), ['Sales', 80, 20, 30, 40]);
  assert.deepEqual(look("'Other data'!$1:$1")?.map((x) => x.v), [7, undefined, 9]);
});

test('lookup: a wide explicit reference is complete', () => {
  const wb = M.workbook(), sh = wb.sheets[0];
  sh.rows.set(0, new Map([[1500, { t: 'n', v: 42 }]]));
  assert.equal(CX.lookup(wb)('Sheet1!A1:XFD1')?.[1500]?.v, 42, 'no silent 1001-column truncation');
});

test('lookup: oversized rectangles are refused before reading cells', () => {
  const wb = M.workbook(), sh = wb.sheets[0];
  let reads = 0;
  sh.rows.get = () => { reads++; throw new Error('oversized reference read a cell'); };
  assert.equal(CX.lookup(wb)('Sheet1!A1:ALL100001'), null);
  assert.equal(reads, 0, 'check the complete rectangle before allocating or visiting it');
});

test('resolve: hiding a point keeps each remaining slice and legend in its original colour', async () => {
  const { wb } = await open();
  wb.sheets[0].hidden.rows.add(2);
  const pie = drawn(wb)[2].data;
  const sc = CH.scene(pie, 500, 300);
  assert.deepEqual(sc.marks.legend, ['Jan', 'Mar', 'Apr']);
  assert.deepEqual(sc.marks.slices.map((s) => s.color), [4, 6, 7].map((i) => CX.DEFAULT_THEME[i]));
  assert.deepEqual(sc.prims.filter((p) => p.cls === 'gc-swatch').map((p) => p.a.fill), sc.marks.slices.map((s) => s.color));
  const automatic = { ...pie, groups: pie.groups.map((g) => ({ ...g, series: g.series.map((s) => ({ ...s, points: new Map() })) })) };
  assert.deepEqual(CH.scene(automatic, 500, 300).marks.slices.map((s) => s.color), sc.marks.slices.map((s) => s.color));
});

test('moving: inserted rows move the anchors and references, a rename follows, undo takes it back', async () => {
  const { wb, e } = await open();
  const id = wb.sheets[0].id;
  const run = (op) => { const res = e.apply(op); X.track(wb, op); return res.inverse; };
  const undo = run({ op: 'insert', sheet: id, axis: 'row', at: 0, n: 2 });
  let list = drawn(wb);
  assert.deepEqual(list.map((c) => [c.anchor.from.row, c.anchor.to.row]), Object.values(FX.PLACES).map(([, r0, , r1]) => [r0 + 2, r1 + 2]));
  assert.equal(list[0].chart.groups[0].series[0].val.f, 'Data!$B$4:$B$7');
  assert.deepEqual(list[0].data.groups[0].series[0].vals, FX.SALES, 'the values moved with their cells');
  run(undo);
  list = drawn(wb);
  assert.deepEqual(list.map((c) => c.anchor.from.row), Object.values(FX.PLACES).map(([, r0]) => r0));
  run({ op: 'rename', sheet: id, name: 'Year 1' });
  list = drawn(wb);
  assert.equal(list[0].chart.groups[0].series[0].val.f, "'Year 1'!$B$2:$B$5");
  assert.deepEqual(list[0].data.groups[0].series[0].vals, FX.SALES);
  // A deleted column of cells: the chart's anchor lands where the deletion was, as the writer moves it.
  run({ op: 'delete', sheet: id, axis: 'col', at: 5, n: 3 });
  list = drawn(wb);
  assert.deepEqual([list[0].anchor.from.col, list[0].anchor.to.col], [5, 9]);
});

test('frames: a chartex chart, 3-D, a second value axis, a missing part', async () => {
  const ex = '<cx:chartSpace xmlns:cx="http://schemas.microsoft.com/office/drawing/2014/chartex" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><cx:chartData/><cx:chart><cx:title><cx:tx><cx:txData><cx:v>Cash flow</cx:v></cx:txData></cx:tx><cx:txPr><a:p><a:r><a:t>Cash flow</a:t></a:r></a:p></cx:txPr></cx:title><cx:plotArea><cx:plotAreaRegion><cx:series layoutId="waterfall"/></cx:plotAreaRegion></cx:plotArea></cx:chart></cx:chartSpace>';
  const drawing = `<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006">`
    + '<xdr:twoCellAnchor><xdr:from><xdr:col>1</xdr:col><xdr:colOff>9525</xdr:colOff><xdr:row>1</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>5</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>9</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>'
    + '<mc:AlternateContent><mc:Choice xmlns:cx1="http://schemas.microsoft.com/office/drawing/2015/9/8/chartex" Requires="cx1"><xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="2" name="Chart 1"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/drawing/2014/chartex"><cx:chart xmlns:cx="http://schemas.microsoft.com/office/drawing/2014/chartex" r:id="rId1"/></a:graphicData></a:graphic></xdr:graphicFrame></mc:Choice>'
    + '<mc:Fallback><xdr:sp macro="" textlink=""><xdr:nvSpPr><xdr:cNvPr id="0" name=""/><xdr:cNvSpPr/></xdr:nvSpPr><xdr:txBody><a:p><a:r><a:t>This chart isn\'t available in your version of Excel.</a:t></a:r></a:p></xdr:txBody></xdr:sp></mc:Fallback></mc:AlternateContent><xdr:clientData/></xdr:twoCellAnchor>'
    + '<xdr:oneCellAnchor><xdr:from><xdr:col>7</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>1</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:ext cx="4572000" cy="2743200"/><xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="3" name="Chart 2"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" r:id="rId2"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:oneCellAnchor>'
    + '<xdr:absoluteAnchor><xdr:pos x="952500" y="95250"/><xdr:ext cx="952500" cy="476250"/><xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="4" name="Chart 3"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" r:id="rId9"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:absoluteAnchor>'
    + '<xdr:twoCellAnchor><xdr:from><xdr:col>0</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>20</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>2</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>24</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="5" name="Picture"/></xdr:nvPicPr></xdr:pic><xdr:clientData/></xdr:twoCellAnchor></xdr:wsDr>';
  const bar3d = FX.CHARTS.column.replace(/barChart>/g, 'bar3DChart>');
  const { wb } = await open({ kinds: ['column', 'line'], over: {
    'xl/drawings/drawing1.xml': drawing,
    'xl/drawings/_rels/drawing1.xml.rels': FX.rels([['rId1', 'http://schemas.microsoft.com/office/2014/relationships/chartEx', '../charts/chartEx1.xml'], ['rId2', 'chart', '../charts/chart1.xml']]),
    'xl/charts/chartEx1.xml': ex, 'xl/charts/chart1.xml': bar3d,
  } });
  const list = drawn(wb);
  assert.equal(list.length, 3, 'the picture is not a chart');
  assert.deepEqual(list.map((c) => [c.data.kind, c.data.type, c.data.title]), [['frame', 'Waterfall chart', 'Cash flow'], ['frame', '3-D chart', 'Sales by month'], ['frame', 'Chart', null]]);
  assert.deepEqual(list[0].anchor.from, { col: 1, colOff: 1, row: 1, rowOff: 0 }, '9525 EMU is a pixel');
  assert.deepEqual([list[1].anchor.kind, list[1].anchor.ext], ['oneCellAnchor', { w: 480, h: 288 }]);
  assert.deepEqual([list[2].anchor.pos, list[2].anchor.ext], [{ x: 100, y: 10 }, { w: 100, h: 50 }]);
  // Bars with a line on a second value axis: a frame; on the same axes, drawn.
  const combo = (ax) => FX.space('Mix', `<c:barChart><c:barDir val="col"/><c:grouping val="clustered"/>${FX.ser(0, 'B', FX.MONTHS, FX.SALES)}<c:axId val="10"/><c:axId val="20"/></c:barChart><c:lineChart><c:grouping val="standard"/>${FX.ser(1, 'C', FX.MONTHS, FX.COSTS)}<c:axId val="${ax[0]}"/><c:axId val="${ax[1]}"/></c:lineChart>${FX.axes()}`);
  assert.deepEqual([CX.chart(combo([30, 40])).kind, CX.chart(combo([30, 40])).type], ['frame', 'Combo chart']);
  const same = CX.resolve(CX.chart(combo([10, 20])), CX.lookup(wb));
  assert.deepEqual(same.groups.map((g) => g.type), ['bar', 'line']);
  const sc = CH.scene(same, 400, 300);
  assert.equal(sc.marks.bars.length, 4);
  assert.equal(sc.marks.lines.length, 1);
  // A frame's scene: its title and kind.
  const fr = CH.scene(list[0].data, 300, 200, { t: (s) => `«${s}»` });
  assert.equal(fr.marks.title, 'Cash flow');
  assert.equal(fr.marks.kind, '«Waterfall chart»', 'the kind goes through the page\'s words');
});

test('layout: a clustered column\'s bar widths from gapWidth and overlap, nice ticks from 0', async () => {
  const { wb } = await open();
  const [column] = drawn(wb);
  const { marks } = CH.scene(column.data, 500, 300);
  assert.equal(marks.bars.length, 8);
  assert.deepEqual(marks.ticks.val, [0, 10, 20, 30, 40, 50], '40 and 5% of room past it');
  assert.deepEqual(marks.ticks.cat, FX.MONTHS);
  const a = marks.bars.find((b) => b.s === 0 && b.i === 0), b = marks.bars.find((x) => x.s === 1 && x.i === 0), a2 = marks.bars.find((x) => x.s === 0 && x.i === 1);
  const band = a2.x - a.x;
  const w = band / (2 + 0.27 + 2.19);
  assert.ok(Math.abs(a.w - w) < 0.02, `bar width ${a.w} = band ${band} / 4.46`);
  assert.ok(Math.abs(b.x - a.x - w * 1.27) < 0.03, 'the second series a bar and 27% on (overlap -27)');
  // Heights in proportion to the values, from one baseline.
  assert.ok(Math.abs(a2.h / a.h - 2) < 0.01);
  assert.ok(Math.abs((a.y + a.h) - (a2.y + a2.h)) < 0.01);
  assert.equal(marks.legend.join(), 'Sales,Costs');
  assert.equal(marks.title, 'Sales by month');
});

test('layout: Excel\'s axis rule, fixed bounds, the major unit', () => {
  assert.deepEqual(CH.scale(0, 40, 200).ticks, [0, 10, 20, 30, 40, 50], 'past 40 by 5% of the span: 42, up to the next step');
  assert.deepEqual(CH.scale(0, 37, 200).ticks, [0, 10, 20, 30, 40]);
  assert.equal(CH.scale(50, 100, 200).min, 0, 'from 0 when the values spread over a sixth of the top');
  assert.ok(CH.scale(95, 100, 200).min > 0, 'not when they sit close to it');
  assert.equal(CH.scale(-30, -10, 200).max, 0);
  assert.deepEqual(CH.scale(0, 1, 200, 28, { min: 0, max: 1, major: 0.25 }).ticks, [0, 0.25, 0.5, 0.75, 1]);
  const one = CH.scale(3, 3, 100);
  assert.ok(one.min === 0 && one.max >= 3, `one value: from 0 (${JSON.stringify(one)})`);
  assert.deepEqual([CH.scale(0, 0, 100).min, CH.scale(0, 0, 100).max], [0, 1], 'all zero: 0 to 1, no room added');
  const s = CH.scale(0, 1234, 300);
  assert.ok(s.ticks.length >= 3 && s.ticks.length <= 11 && s.max >= 1234 && [1, 2, 2.5, 5].some((k) => Math.abs(s.step / 10 ** Math.floor(Math.log10(s.step)) - k) < 1e-9), JSON.stringify(s));
});

test('layout: a pie\'s angles from its first slice\'s, clockwise; a doughnut\'s rings', async () => {
  const { wb } = await open();
  const [, , pie] = drawn(wb);
  let { marks } = CH.scene(pie.data, 400, 300);
  assert.deepEqual(marks.slices.map((s) => [s.a0, s.a1]), [[0, 36], [36, 108], [108, 216], [216, 360]]);
  assert.deepEqual(marks.legend, FX.MONTHS);
  const turned = { ...pie.data, groups: [{ ...pie.data.groups[0], first: 90 }] };
  ({ marks } = CH.scene(turned, 400, 300));
  assert.deepEqual(marks.slices.map((s) => [s.a0, s.a1]), [[90, 126], [126, 198], [198, 306], [306, 450]]);
  const ring = { ...pie.data, groups: [{ ...pie.data.groups[0], type: 'doughnut', hole: 50, series: [pie.data.groups[0].series[0], { ...pie.data.groups[0].series[0], vals: [1, 1, null, 2] }] }] };
  ({ marks } = CH.scene(ring, 400, 300));
  assert.deepEqual(marks.slices.filter((s) => s.ring === 1).map((s) => [s.i, s.a0, s.a1]), [[0, 0, 90], [1, 90, 180], [3, 180, 360]], 'a blank point takes no room');
});

test('layout: a scatter\'s axes in proportion to x and y', async () => {
  const { wb } = await open();
  const [, , , scatter] = drawn(wb);
  const { marks } = CH.scene(scatter.data, 400, 300);
  const p = marks.points;
  assert.deepEqual(p.map((x) => [x.xv, x.v]), FX.XS.map((x, i) => [x, FX.YS[i]]));
  const dx = (p[1].x - p[0].x) / (p[1].xv - p[0].xv), dy = (p[1].y - p[0].y) / (p[1].v - p[0].v);
  for (let i = 2; i < p.length; i++) {
    assert.ok(Math.abs((p[i].x - p[0].x) - dx * (p[i].xv - p[0].xv)) < 0.05, `x of point ${i}`);
    assert.ok(Math.abs((p[i].y - p[0].y) - dy * (p[i].v - p[0].v)) < 0.05, `y of point ${i}`);
  }
  assert.ok(dy < 0, 'up the page as y grows');
  assert.equal(marks.lines.length, 0);
  assert.deepEqual(marks.ticks.x, [0, 1, 2, 3, 4, 5]);
  assert.ok(p[3].x < Math.max(...p.map((x) => x.x)) + 1 && marks.ticks.val.at(-1) > 4, 'the last point inside the axes');
});

test('layout: stacked and 100% stacked columns, horizontal bars, a line\'s gap', async () => {
  const { wb } = await open();
  const [column, line] = drawn(wb);
  const stacked = { ...column.data, groups: [{ ...column.data.groups[0], grouping: 'stacked', overlap: 100 }] };
  let { marks } = CH.scene(stacked, 500, 300);
  assert.deepEqual(marks.ticks.val.at(-1), 70, 'the axis reaches past the tallest total (40 + 20, and 5%)');
  for (let i = 0; i < 4; i++) {
    const a = marks.bars.find((b) => b.s === 0 && b.i === i), b = marks.bars.find((x) => x.s === 1 && x.i === i);
    assert.ok(Math.abs(b.y + b.h - a.y) < 0.02, `category ${i}: the second series sits on the first`);
    assert.equal(a.x, b.x);
    assert.equal(b.top, FX.SALES[i] + FX.COSTS[i]);
  }
  const pct = { ...column.data, groups: [{ ...column.data.groups[0], grouping: 'percentStacked', overlap: 100 }] };
  ({ marks } = CH.scene(pct, 500, 300));
  const full = marks.bars.filter((b) => b.i === 0).reduce((n, b) => n + b.h, 0), full2 = marks.bars.filter((b) => b.i === 3).reduce((n, b) => n + b.h, 0);
  assert.ok(Math.abs(full - full2) < 0.05, 'every 100% column is as tall');
  assert.deepEqual(marks.ticks.val.at(-1), 1);
  const across = { ...column.data, groups: [{ ...column.data.groups[0], dir: 'bar' }] };
  ({ marks } = CH.scene(across, 500, 300));
  const j0 = marks.bars.find((b) => b.s === 0 && b.i === 0), j3 = marks.bars.find((b) => b.s === 0 && b.i === 3);
  assert.ok(Math.abs(j3.w / j0.w - 4) < 0.01, 'widths in proportion to the values');
  assert.ok(j3.y < j0.y, 'the first category at the bottom, as Excel draws it');
  const gap = { ...line.data, groups: [{ ...line.data.groups[0], series: [{ ...line.data.groups[0].series[0], vals: [10, null, 30, 40] }] }] };
  const sc = CH.scene(gap, 400, 300);
  assert.equal(sc.prims.filter((x) => x.cls === 'gc-line').length, 2, 'a blank breaks the line');
  assert.equal(CH.scene({ ...gap, blanks: 'span' }, 400, 300).prims.filter((x) => x.cls === 'gc-line').length, 1, '"span" joins it');
});

test('round trip: a workbook read, drawn and written untouched keeps its drawing and chart parts byte for byte', async () => {
  const bytes = FX.workbook();
  const before = await parts(bytes);
  const { wb } = await open();
  drawn(wb);
  CH.scene(drawn(wb)[0].data, 300, 200);
  const after = await parts(await X.write(wb, { date: new Date(2026, 0, 1) }));
  const names = Object.keys(before).filter((n) => /^xl\/(charts|drawings)\//.test(n));
  assert.equal(names.length, 7);
  for (const n of names) assert.equal(after[n], before[n], n);
  assert.match(after['xl/worksheets/sheet1.xml'], /<drawing r:id="rId1"\/>/);
});
