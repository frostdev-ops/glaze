// Insert chart (lib/sheet-chart.js layer insert, move, remove; lib/sheet-chart-xml.js plan and build; lib/sheet-xlsx.js
// attach, current and the parts Glaze writes): a selection's series, names and categories as Excel reads them; the
// chart part in Excel's element order; the workbook written with its drawing, relationships and content types, and read
// back; undo; rows inserted and deleted after (and before) the insert, a log entry taken off included; a chart dragged
// and deleted, an imported one moved after rows were inserted.
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../lib/sheet-model.js');
const X = require('../lib/sheet-xlsx.js');
const C = require('../lib/sheet-calc.js');
const D = require('../lib/doctext.js');
const CX = require('../lib/sheet-chart-xml.js');
const CH = require('../lib/sheet-chart.js');
const FX = require('./fixtures/sheets/charts.js');

const mount = (wb, sh = wb.sheets[0]) => FX.layerOn(wb, sh);
const parts = async (bytes) => { const z = D.unzip(bytes); const out = {}; for (const n of z.names) out[n] = await z.text(n); return out; };
const DATE = new Date(2026, 0, 1);
// A new workbook with Month/Sales/Costs in A1:C5.
const book = () => {
  const wb = M.workbook(), sh = wb.sheets[0];
  const rows = [['Month', 'Sales', 'Costs'], ['Jan', 10, 5], ['Feb', 20, 15], ['Mar', 30, 10], ['Apr', 40, 20]];
  rows.forEach((row, r) => sh.rows.set(r, new Map(row.map((v, c) => [c, typeof v === 'number' ? { t: 'n', v } : { t: 's', v }]))));
  const e = C.engine(wb);
  e.recalc();
  return { wb, sh, e };
};
const show = (x) => (x?.t === 'n' ? String(x.v) : String(x?.v ?? ''));

test('plan: series down the columns, names from the header, categories from the text column', () => {
  const { wb, sh } = book();
  const p = CX.plan(wb, sh, { r0: 0, c0: 0, r1: 4, c1: 2 }, 'column', show);
  assert.deepEqual(p.cats, { f: 'Sheet1!$A$2:$A$5', texts: ['Jan', 'Feb', 'Mar', 'Apr'], nums: [null, null, null, null], num: false, fmt: 'General' });
  assert.deepEqual(p.series.map((s) => [s.name.f, s.name.texts[0], s.vals.f, s.vals.nums]), [['Sheet1!$B$1', 'Sales', 'Sheet1!$B$2:$B$5', [10, 20, 30, 40]], ['Sheet1!$C$1', 'Costs', 'Sheet1!$C$2:$C$5', [5, 15, 10, 20]]]);
  // A wide selection: series along the rows.
  const wide = CX.plan(wb, sh, { r0: 0, c0: 0, r1: 1, c1: 2 }, 'column', show);
  assert.deepEqual(wide.series.map((s) => [s.name.texts[0], s.vals.f]), [['Jan', 'Sheet1!$B$2:$C$2']]);
  assert.equal(wide.cats.f, 'Sheet1!$B$1:$C$1');
  assert.equal(CX.plan(wb, sh, { r0: 0, c0: 0, r1: 4, c1: 2 }, 'pie', show).series.length, 1, 'a pie: the first series');
  assert.equal(CX.plan(wb, sh, { r0: 0, c0: 0, r1: 4, c1: 0 }, 'column', show), null, 'no numbers, no chart');
  const xy = CX.plan(wb, sh, { r0: 1, c0: 1, r1: 4, c1: 2 }, 'scatter', show);
  assert.deepEqual([xy.cats.f, xy.cats.num, xy.series[0].vals.f], ['Sheet1!$B$2:$B$5', true, 'Sheet1!$C$2:$C$5'], 'a scatter: x from the first column');
  sh.name = 'Q1 data';
  assert.equal(CX.plan(wb, sh, { r0: 0, c0: 0, r1: 4, c1: 1 }, 'line', show).series[0].vals.f, "'Q1 data'!$B$2:$B$5");
});

test('build: each kind in Excel\'s element order, read back as written', () => {
  const { wb, sh } = book();
  const order = (xml, names) => { let at = -1; for (const n of names) { const i = xml.indexOf(`<c:${n}`, at + 1); assert.ok(i > at, `${n} after the one before (${xml.slice(0, 80)})`); at = i; } };
  for (const kind of ['column', 'bar', 'line', 'pie', 'scatter']) {
    const xml = CX.build(CX.plan(wb, sh, { r0: 0, c0: 0, r1: 4, c1: 2 }, kind, show));
    order(xml, ['date1904', 'lang', 'roundedCorners', 'chart', 'autoTitleDeleted', 'plotArea', 'layout']);
    assert.match(xml, /<\/c:plotArea>(<c:legend>.*<\/c:legend>)?<c:plotVisOnly val="1"\/><c:dispBlanksAs val="gap"\/><\/c:chart><\/c:chartSpace>$/);
    const c = CX.chart(xml);
    assert.equal(c.kind, 'plot', kind);
    const g = c.groups[0];
    if (kind === 'column' || kind === 'bar') {
      order(xml, ['barChart', 'barDir', 'grouping', 'varyColors', 'ser', 'idx', 'order', 'tx', 'spPr', 'invertIfNegative', 'cat', 'val', 'gapWidth', 'overlap', 'axId', 'axId', 'catAx', 'valAx']);
      assert.deepEqual([g.type, g.dir], ['bar', kind === 'bar' ? 'bar' : 'col']);
    }
    if (kind === 'line') order(xml, ['lineChart', 'grouping', 'varyColors', 'ser', 'idx', 'order', 'tx', 'spPr', 'marker', 'cat', 'val', 'smooth', 'marker', 'axId', 'axId', 'catAx', 'valAx']);
    if (kind === 'pie') { order(xml, ['pieChart', 'varyColors', 'ser', 'idx', 'order', 'tx', 'dPt', 'cat', 'val', 'firstSliceAng']); assert.doesNotMatch(xml, /<c:(catAx|valAx)/); }
    if (kind === 'scatter') order(xml, ['scatterChart', 'scatterStyle', 'varyColors', 'ser', 'idx', 'order', 'tx', 'spPr', 'marker', 'xVal', 'yVal', 'smooth', 'axId', 'axId', 'valAx', 'valAx']);
    const r = CX.resolve(c, CX.lookup(wb));
    assert.deepEqual(r.groups[0].series[0].vals, [10, 20, 30, 40], kind);
    if (kind === 'scatter') assert.deepEqual(r.groups[0].series[0].xs, [1, 2, 3, 4], 'text x values count 1, 2, 3…');
    if (kind !== 'scatter') assert.deepEqual(r.groups[0].series[0].cats, ['Jan', 'Feb', 'Mar', 'Apr']);
  }
  const one = CX.build(CX.plan(wb, sh, { r0: 0, c0: 0, r1: 4, c1: 1 }, 'column', show));
  assert.match(one, /<c:title><c:overlay val="0"\/><\/c:title><c:autoTitleDeleted val="0"\/>/, 'one series: its name is the title');
  assert.equal(CX.resolve(CX.chart(one), CX.lookup(wb)).title, 'Sales');
  assert.match(one, /<c:numCache><c:formatCode>General<\/c:formatCode><c:ptCount val="4"\/><c:pt idx="0"><c:v>10<\/c:v><\/c:pt>/, 'the values cached');
});

test('insert: a new workbook\'s chart, written with its drawing, relationships and content types, read back; undo', async () => {
  const { wb, sh } = book();
  const L = mount(wb);
  L.draw();
  const op = L.insert('column', { r0: 0, c0: 0, r1: 4, c1: 2 });
  assert.ok(op);
  assert.equal(wb.keep.parts['xl/charts/chart1.xml'], undefined, 'nothing changes before the grid applies it');
  const undo = L.apply(op);
  L.draw();
  const list = L.list();
  assert.equal(list.length, 1);
  assert.deepEqual(list[0].box, { x: 4 * 64, y: 0, w: 480, h: 288 }, 'two columns past the data, 5 × 3 inches');
  assert.equal(L.chosen(), list[0].id, 'the new chart is chosen');
  assert.equal(list[0].marks.bars.length, 8);
  const p = await parts(await X.write(wb, { date: DATE }));
  assert.match(p['xl/worksheets/sheet1.xml'], /<sheetFormatPr defaultRowHeight="15"\/>.*<\/sheetData><drawing r:id="rId1"\/><\/worksheet>$/s);
  assert.match(p['xl/worksheets/_rels/sheet1.xml.rels'], /<Relationship Id="rId1" Type="http:\/\/schemas.openxmlformats.org\/officeDocument\/2006\/relationships\/drawing" Target="..\/drawings\/drawing1.xml"\/>/);
  assert.match(p['xl/drawings/_rels/drawing1.xml.rels'], /Id="rId1" Type="[^"]+\/chart" Target="..\/charts\/chart1.xml"/);
  assert.match(p['[Content_Types].xml'], /<Override PartName="\/xl\/drawings\/drawing1.xml" ContentType="application\/vnd.openxmlformats-officedocument.drawing\+xml"\/>/);
  assert.match(p['[Content_Types].xml'], /<Override PartName="\/xl\/charts\/chart1.xml" ContentType="application\/vnd.openxmlformats-officedocument.drawingml.chart\+xml"\/>/);
  assert.match(p['xl/drawings/drawing1.xml'], /<xdr:twoCellAnchor><xdr:from><xdr:col>4<\/xdr:col><xdr:colOff>0<\/xdr:colOff><xdr:row>0<\/xdr:row><xdr:rowOff>0<\/xdr:rowOff><\/xdr:from><xdr:to><xdr:col>11<\/xdr:col><xdr:colOff>\d+<\/xdr:colOff><xdr:row>14<\/xdr:row><xdr:rowOff>\d+<\/xdr:rowOff><\/xdr:to><xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="2" name="Chart 1"\/>/);
  const back = await X.read(await X.write(wb, { date: DATE }));
  assert.deepEqual(back.keep.problems, []);
  const again = CX.charts(back, back.sheets[0]);
  assert.equal(again.length, 1);
  assert.deepEqual(again[0].chart.groups[0].series.map((s) => s.val.f), ['Sheet1!$B$2:$B$5', 'Sheet1!$C$2:$C$5']);
  // Undo: nothing of it is left, and the file is as before.
  L.apply(undo);
  L.draw();
  assert.equal(L.list().length, 0);
  assert.deepEqual([wb.keep.parts, sh.keep], [{}, {}]);
  const plain = await parts(await X.write(wb, { date: DATE }));
  assert.ok(!Object.keys(plain).some((n) => /drawing|chart/.test(n)));
  assert.match(plain['xl/worksheets/sheet1.xml'], /<sheetFormatPr defaultRowHeight="15"\/>/);
});

test('insert, then rows: the chart moves with its cells, and with a log entry taken off after it was made', async () => {
  const { wb, sh, e } = book();
  const run = (o) => { const res = e.apply(o); X.track(wb, o); return res.inverse; };
  run({ op: 'insert', sheet: sh.id, axis: 'row', at: 0, n: 1 });
  const L = mount(wb);
  L.draw();
  L.apply(L.insert('line', { r0: 1, c0: 0, r1: 5, c1: 1 }));
  L.draw();
  assert.equal(L.list()[0].box.y, 20, 'at the data\'s first row, row 2');
  let p = await parts(await X.write(wb, { date: DATE }));
  assert.match(p['xl/charts/chart1.xml'], /<c:f>Sheet1!\$B\$3:\$B\$6<\/c:f>/);
  assert.match(p['xl/drawings/drawing1.xml'], /<xdr:from><xdr:col>3<\/xdr:col><xdr:colOff>0<\/xdr:colOff><xdr:row>1<\/xdr:row>/);
  // Deleting the row inserted first takes that entry off the log: the chart, made after it, goes back up a row.
  run({ op: 'delete', sheet: sh.id, axis: 'row', at: 0, n: 1 });
  assert.deepEqual(wb.keep.log, []);
  L.draw();
  assert.equal(L.list()[0].box.y, 0);
  assert.deepEqual(L.list()[0].marks.points.map((x) => x.v), [10, 20, 30, 40], 'its values read from where they are now');
  p = await parts(await X.write(wb, { date: DATE }));
  assert.match(p['xl/charts/chart1.xml'], /<c:f>Sheet1!\$B\$2:\$B\$5<\/c:f>/);
  assert.match(p['xl/drawings/drawing1.xml'], /<xdr:from><xdr:col>3<\/xdr:col><xdr:colOff>0<\/xdr:colOff><xdr:row>0<\/xdr:row>/);
  // Rows inserted after: down it goes.
  run({ op: 'insert', sheet: sh.id, axis: 'row', at: 0, n: 3 });
  L.draw();
  assert.equal(L.list()[0].box.y, 60);
  p = await parts(await X.write(wb, { date: DATE }));
  assert.match(p['xl/charts/chart1.xml'], /<c:f>Sheet1!\$B\$5:\$B\$8<\/c:f>/);
  const back = await X.read(await X.write(wb, { date: DATE }));
  const r = CX.resolve(CX.charts(back, back.sheets[0])[0].chart, CX.lookup(back));
  assert.deepEqual(r.groups[0].series[0].vals, [10, 20, 30, 40]);
});

test('move, size and delete: a dragged chart\'s new cells, a deleted one\'s parts gone, undo brings it back', async () => {
  const { wb } = book();
  const L = mount(wb);
  L.draw();
  L.apply(L.insert('column', { r0: 0, c0: 0, r1: 4, c1: 2 }));
  L.draw();
  const id = L.list()[0].id;
  assert.equal(L.hit(300, 100).id, id);
  assert.equal(L.hit(4 * 64 + 478, 286).handle, 'se', 'the chosen chart\'s corner sizes it');
  assert.equal(L.hit(10, 10), null);
  const back = L.apply(L.move(id, { x: 100, y: 105, w: 300, h: 200 }));
  L.draw();
  assert.deepEqual(L.list()[0].box, { x: 100, y: 105, w: 300, h: 200 });
  let p = await parts(await X.write(wb, { date: DATE }));
  assert.match(p['xl/drawings/drawing1.xml'], new RegExp(`<xdr:from><xdr:col>1</xdr:col><xdr:colOff>${36 * 9525}</xdr:colOff><xdr:row>5</xdr:row><xdr:rowOff>${5 * 9525}</xdr:rowOff></xdr:from><xdr:to><xdr:col>6</xdr:col><xdr:colOff>${16 * 9525}</xdr:colOff><xdr:row>15</xdr:row><xdr:rowOff>${5 * 9525}</xdr:rowOff></xdr:to>`));
  L.apply(back);
  L.draw();
  assert.deepEqual(L.list()[0].box, { x: 256, y: 0, w: 480, h: 288 });
  const undel = L.apply(L.remove(id));
  L.draw();
  assert.equal(L.list().length, 0);
  p = await parts(await X.write(wb, { date: DATE }));
  assert.equal(p['xl/charts/chart1.xml'], undefined, 'the chart part goes');
  assert.doesNotMatch(p['xl/drawings/_rels/drawing1.xml.rels'] ?? '', /chart1/);
  assert.doesNotMatch(p['xl/drawings/drawing1.xml'], /twoCellAnchor/);
  L.apply(undel);
  L.draw();
  assert.equal(L.list().length, 1);
  p = await parts(await X.write(wb, { date: DATE }));
  assert.match(p['xl/drawings/_rels/drawing1.xml.rels'], /chart1/);
});

test('an imported chart moved after rows were inserted: the others keep their moved places, the part its other anchors', async () => {
  const wb = await X.read(FX.workbook());
  const e = C.engine(wb);
  e.recalc();
  const sh = wb.sheets[0];
  const op = { op: 'insert', sheet: sh.id, axis: 'row', at: 0, n: 2 };
  e.apply(op); X.track(wb, op);
  const L = mount(wb);
  L.draw();
  const before = L.list().map((c) => c.box.y);
  assert.deepEqual(before, Object.values(FX.PLACES).map(([, r]) => (r + 2) * 20));
  L.apply(L.move(L.list()[1].id, { x: 0, y: 0, w: 128, h: 100 }));
  L.draw();
  assert.deepEqual(L.list().map((c) => c.box.y), [before[0], 0, ...before.slice(2)]);
  const p = await parts(await X.write(wb, { date: DATE }));
  const rows = [...p['xl/drawings/drawing1.xml'].matchAll(/<xdr:from><xdr:col>(\d+)<\/xdr:col><xdr:colOff>\d+<\/xdr:colOff><xdr:row>(\d+)<\/xdr:row>/g)].map((m) => [Number(m[1]), Number(m[2])]);
  assert.deepEqual(rows, [[6, 3], [0, 0], [6, 18], [13, 18], [6, 33]]);
  assert.match(p['xl/charts/chart1.xml'], /<c:f>Data!\$B\$4:\$B\$7<\/c:f>/, 'its chart parts still move by the log');
  // Inserted on a sheet that has a drawing: the same drawing, a sixth anchor, a new part.
  L.apply(L.insert('pie', { r0: 2, c0: 0, r1: 6, c1: 1 }));
  L.draw();
  assert.equal(L.list().length, 6);
  const q = await parts(await X.write(wb, { date: DATE }));
  assert.match(q['xl/drawings/_rels/drawing1.xml.rels'], /Id="rId6" Type="[^"]+\/chart" Target="..\/charts\/chart6.xml"/);
  assert.match(q['xl/charts/chart6.xml'], /<c:pieChart>/);
  assert.equal((q['xl/drawings/drawing1.xml'].match(/<xdr:cNvPr id="(\d+)"/g) ?? []).length, 6);
  assert.match(q['xl/drawings/drawing1.xml'], /<xdr:cNvPr id="7" name="Chart 6"\/>/, 'a cNvPr id the drawing doesn\'t have');
});

test('a duplicated sheet: its charts stay its original\'s, and a chart inserted on it gets a drawing of its own', async () => {
  const wb = await X.read(FX.workbook({ kinds: ['column'] }));
  const e = C.engine(wb);
  e.recalc();
  const one = wb.sheets[0];
  const copy = { ...structuredClone({ ...one, rows: null }), id: 9, name: 'Data (2)', rows: new Map([...one.rows].map(([r, row]) => [r, new Map(row)])) };
  e.apply({ op: 'addSheet', sheet: copy, at: 1, active: 1 });
  const dup = wb.sheets[1];
  assert.equal(dup.keep.drawing.path, one.keep.drawing.path, 'Duplicate copies the keep, the drawing with it');
  assert.equal(CX.charts(wb, dup).length, 0, 'the file writes the drawing with Data alone');
  const L = mount(wb, dup);
  L.draw();
  L.apply(L.insert('line', { r0: 0, c0: 0, r1: 4, c1: 1 }));
  L.draw();
  assert.equal(L.list().length, 1);
  assert.notEqual(dup.keep.drawing.path, one.keep.drawing.path);
  assert.equal(CX.charts(wb, one).length, 1, 'Data keeps its one chart');
  const back = await X.read(await X.write(wb, { date: DATE }));
  assert.deepEqual(back.sheets.map((s) => CX.charts(back, s).map((c) => c.chart.groups[0].type)), [['bar'], ['line']]);
});

test('chart room: imported anchors and an inserted chart extend beyond the initial grid columns', async () => {
  const G = require('../sheet-grid.js'), el = FX.fakeDom();
  const mounted = (wb) => {
    const geo = { R: new G.Sizes(1000, 20), C: new G.Sizes(26, 64), FR: 0, FC: 0, FW: 0, FH: 0 };
    const L = CH.layer({ panes: { br: { el: { hidden: false }, inner: el(), fr: false, fc: false } }, wb: () => wb,
      sheet: () => wb.sheets[0], geo: () => geo, reach: (r, c) => { geo.R.grow(Math.max(geo.R.n, r + 200)); geo.C.grow(Math.max(geo.C.n, c + 6)); } });
    return L;
  };
  const wb = await X.read(FX.workbook({ kinds: ['column'] }));
  const drawing = wb.keep.parts['xl/drawings/drawing1.xml'];
  drawing.data = new TextEncoder().encode(CX.partText(drawing.data).replace('<xdr:col>6</xdr:col>', '<xdr:col>40</xdr:col>').replace('<xdr:col>12</xdr:col>', '<xdr:col>46</xdr:col>'));
  const imported = mounted(wb);
  imported.draw();
  assert.deepEqual(imported.list()[0].box, { x: 2560, y: 20, w: 384, h: 280 });
  imported.dispose();
  const fresh = book();
  for (const row of fresh.sh.rows.values()) { const cells = [...row]; row.clear(); for (const [c, x] of cells) row.set(c + 23, x); }
  const L = mounted(fresh.wb);
  L.draw();
  L.apply(L.insert('column', { r0: 0, c0: 23, r1: 4, c1: 25 }));
  L.draw();
  assert.deepEqual(L.list()[0].box, { x: 27 * 64, y: 0, w: 480, h: 288 });
  L.dispose();
});
