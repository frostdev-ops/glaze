// 3-D pie and column charts (documents/sheets/sheet-chart-xml.js reads c:view3D, explosions, c:shape and the walls; documents/sheets/sheet-chart.js
// projects them into the SVG scene): a 3-D pie's tilted ellipse, its front rim and cut faces in painter's order, an
// exploded slice's offset and percent labels; a 3-D column's front, top and side faces for clustered, stacked and
// standard groupings; the kinds still framed name their type; the work stays bounded; and the parts round-trip untouched.
const test = require('node:test');
const assert = require('node:assert/strict');
const X = require('../../extension/documents/sheets/sheet-xlsx.js');
const C = require('../../extension/documents/sheets/sheet-calc.js');
const D = require('../../extension/core/doctext.js');
const CX = require('../../extension/documents/sheets/sheet-chart-xml.js');
const CH = require('../../extension/documents/sheets/sheet-chart.js');
const FX = require('../fixtures/sheets/charts.js');

const RAD = Math.PI / 180;
const near = (a, b, eps = 0.02) => Math.abs(a - b) <= eps;
const data = (xml) => CX.resolve(CX.chart(xml), () => null);
const pie3d = (edit = (x) => x) => data(edit(FX.CHARTS.pie3d));
const col3d = (edit = (x) => x) => data(edit(FX.CHARTS.col3d));
const view = (x, y) => (xml) => xml.replace(/<c:rotX val="\d+"\/><c:rotY val="\d+"\/>/, `<c:rotX val="${x}"/><c:rotY val="${y}"/>`);
const grouping = (g) => (xml) => xml.replace('<c:grouping val="clustered"/>', `<c:grouping val="${g}"/>`);

test('parse: view3D, the walls, an exploded slice, a bar\'s shape and gap depth', () => {
  const pie = CX.chart(FX.CHARTS.pie3d), col = CX.chart(FX.CHARTS.col3d);
  assert.deepEqual([pie.kind, pie.groups[0].type, col.kind, col.groups[0].type], ['plot', 'pie3D', 'plot', 'bar3D']);
  assert.deepEqual(pie.view3D, { rotX: 30, rotY: 0, perspective: null, depthPercent: 100, hPercent: null, rAngAx: false });
  assert.deepEqual(col.view3D, { rotX: 15, rotY: 20, perspective: null, depthPercent: 100, hPercent: null, rAngAx: true });
  const s = pie.groups[0].series[0];
  assert.deepEqual([...s.explode], [[1, 18]], 'c:explosion on the second dPt');
  assert.equal(s.explosion, 0);
  assert.equal(CX.chart(FX.CHARTS.pie3d.replace('<c:dPt>', '<c:explosion val="25"/><c:dPt>')).groups[0].series[0].explosion, 25, 'the series\' own');
  assert.deepEqual(s.labels && [s.labels.pct, s.labels.val], [true, false]);
  assert.equal(pie.groups[0].first, 0, 'a 3-D pie turns by rotY');
  assert.equal(CX.chart(view(30, 75)(FX.CHARTS.pie3d)).groups[0].first, 75);
  const g = col.groups[0];
  assert.deepEqual([g.dir, g.grouping, g.gap, g.gapDepth, g.shape, g.axes], ['col', 'clustered', 150, 150, 'box', ['10', '20', '0']]);
  assert.equal(CX.chart(FX.CHARTS.col3d.replace('<c:shape val="box"/>', '<c:shape val="cylinder"/>')).groups[0].shape, 'cylinder');
  assert.deepEqual(col.walls, { floor: { fill: 'none' }, side: { fill: null }, back: { fill: null } });
  assert.deepEqual(pie.walls, { floor: { fill: null }, side: { fill: 'none' }, back: { fill: 'none' } });
  const r = pie3d();
  assert.deepEqual([r.view3D.rotX, r.walls.side.fill, r.title], [30, 'none', 'Share in 3-D'], 'resolve keeps view3D and the walls');
});

test('3-D pie: the slices\' angles, the ellipse from rotX, the rim only on front slices', () => {
  const { marks } = CH.scene(pie3d(), 480, 300);
  assert.deepEqual(marks.slices.map((x) => [x.i, x.a0, x.a1]).sort((a, b) => a[0] - b[0]), [[0, 0, 36], [1, 36, 108], [2, 108, 216], [3, 216, 360]]);
  const { rx, ry, depth } = marks.pie3d;
  assert.ok(near(ry / rx, Math.sin(30 * RAD), 0.005), `ry/rx = sin 30° (${ry}/${rx})`);
  assert.ok(near(depth / rx, 0.18 * Math.cos(30 * RAD), 0.005), 'thickness 18% of the radius, projected');
  for (const [x, want] of [[60, Math.sin(60 * RAD)], [90, 1], [5, Math.sin(10 * RAD)]]) {
    const m = CH.scene(pie3d(view(x, 0)), 480, 300).marks.pie3d;
    assert.ok(near(m.ry / m.rx, want, 0.005), `rotX ${x}: ${m.ry / m.rx}`);
  }
  const rims = marks.sides.filter((x) => x.kind === 'rim');
  assert.deepEqual(rims.map((x) => [x.i, x.a0, x.a1]).sort((a, b) => a[0] - b[0]), [[1, 90, 108], [2, 108, 216], [3, 216, 270]], 'the back slice (0° to 36°) shows no rim; the others only from 90° to 270°');
  assert.deepEqual(marks.legend, FX.MONTHS);
  assert.deepEqual(marks.labels, ['10%', '20%', '30%', '40%'], 'percent labels');
});

test('3-D pie: an exploded slice moves out along its mid-angle; cut faces turn toward the viewer, painted back to front', () => {
  const sc = CH.scene(pie3d(), 480, 300);
  const { rx, ry, cx, cy } = sc.marks.pie3d;
  const by = Object.fromEntries(sc.marks.slices.map((x) => [x.i, x]));
  assert.ok(near(by[1].dx, rx * 0.18 * Math.sin(72 * RAD), 0.02) && near(by[1].dy, -ry * 0.18 * Math.cos(72 * RAD), 0.02), JSON.stringify(by[1]));
  assert.deepEqual([by[0].dx, by[0].dy, by[2].dx, by[3].dy].map((v) => v + 0), [0, 0, 0, 0]);
  // Shrunk to fit: the exploded slice's far edge stays inside the plot.
  assert.ok(cx + by[1].dx + rx <= 480 && cy - ry - 0.18 * ry >= 0);
  // Faces only at separated boundaries: the first slice's last edge and the exploded second slice's last edge.
  const faces = sc.marks.sides.filter((x) => x.kind === 'face');
  assert.deepEqual(faces.map((x) => [x.i, x.a]).sort((a, b) => a[0] - b[0]), [[0, 36], [1, 108]]);
  // Unexploded: no cut faces at all.
  const flat = CH.scene(pie3d((x) => x.replace('<c:explosion val="18"/>', '')), 480, 300);
  assert.equal(flat.marks.sides.filter((x) => x.kind === 'face').length, 0);
  assert.ok(flat.marks.slices.every((x) => x.dx === 0 && x.dy === 0));
  // Painter's order: every side before every top; sides back (mid-angle near 0°) to front (near 180°).
  const kinds = sc.prims.filter((p) => p.cls === 'gc-side' || p.cls === 'gc-slice').map((p) => p.cls);
  assert.equal(kinds.lastIndexOf('gc-side') < kinds.indexOf('gc-slice'), true);
  const order = sc.marks.slices.map((x) => Math.cos(((x.a0 + x.a1) / 2) * RAD));
  assert.deepEqual(order, [...order].sort((a, b) => b - a));
  // Sides shade the slice's own colour darker; tops keep it.
  const top1 = sc.prims.find((p) => p.cls === 'gc-slice' && p.a.fill === by[1].color);
  assert.ok(top1 && sc.prims.some((p) => p.cls === 'gc-side' && p.a.fill === CX.transform(by[1].color, [{ name: 'shade', a: { val: '72000' } }])));
});

test('3-D pie: rotY turns the first slice; a lone slice is a whole ellipse', () => {
  const turned = CH.scene(pie3d(view(30, 90)), 480, 300).marks.slices;
  assert.deepEqual(turned.map((x) => [x.i, x.a0]).sort((a, b) => a[0] - b[0]).map((x) => x[1]), [90, 126, 198, 306]);
  const one = pie3d();
  one.groups[0].series[0].vals = [5, 0, null, 0];
  const sc = CH.scene(one, 480, 300);
  assert.equal(sc.prims.filter((p) => p.el === 'ellipse' && p.cls === 'gc-slice').length, 1);
  assert.deepEqual(sc.marks.sides.map((x) => [x.kind, x.a0, x.a1]), [['rim', 90, 270]]);
});

test('3-D column, clustered: front, top and side faces in the oblique projection, Excel\'s gap width', () => {
  const sc = CH.scene(col3d(), 480, 300);
  const { bars, faces } = sc.marks;
  assert.equal(bars.length, 8);
  const sx = Math.sin(20 * RAD), sy = Math.sin(15 * RAD) * Math.cos(20 * RAD);
  for (const b of bars) {
    const top = faces.find((f) => f.kind === 'top' && f.s === b.s && f.i === b.i).pts, side = faces.find((f) => f.kind === 'side' && f.s === b.s && f.i === b.i).pts;
    const dz = b.z1 - b.z0;
    assert.ok(near(top[0][0], b.x) && near(top[0][1], b.y) && near(top[1][0], b.x + b.w), 'the top starts on the front\'s top edge');
    assert.ok(near(top[2][0] - top[1][0], sx * dz, 0.03) && near(top[2][1] - top[1][1], -sy * dz, 0.03), `depth recedes by (sin rotY, −sin rotX cos rotY) (${JSON.stringify({ top, dz })})`);
    assert.ok(near(side[0][0], b.x + b.w) && near(side[3][1], b.y + b.h), 'the side on the right of the front');
    assert.ok(near(dz, b.w, 0.03), 'as deep as wide (depthPercent 100)');
  }
  const a = bars.find((b) => b.s === 0 && b.i === 0), b = bars.find((x) => x.s === 1 && x.i === 0), a2 = bars.find((x) => x.s === 0 && x.i === 1);
  assert.ok(near(b.x - a.x, a.w) && a.z0 === b.z0, 'the second series beside the first, at the same depth');
  assert.ok(near(a.w, (a2.x - a.x) / (2 + 1.5), 0.03), 'gapWidth 150: two bars in a band of 3.5');
  assert.ok(near(a2.h / a.h, 2, 0.01));
  assert.deepEqual(sc.marks.ticks.val, [0, 10, 20, 30, 40, 50]);
  assert.deepEqual(sc.marks.labels, ['10', '20', '30', '40'], 'the first series\' value labels');
  // Walls: the side and back in the Look's fill (none said), no floor (noFill).
  assert.deepEqual(faces.filter((f) => !('s' in f)).map((f) => f.kind), ['back', 'side']);
  assert.ok(sc.prims.filter((p) => p.cls === 'gc-wall').every((p) => !('fill' in p.a)));
  // Painted far to near: left to right across the categories.
  const fronts = sc.prims.filter((p) => p.cls === 'gc-bar').map((p) => p.a.x);
  assert.deepEqual(fronts, [...fronts].sort((p, q) => p - q));
  // Faces shade the series colour: top lighter, side darker.
  const blue = a.color;
  assert.ok(sc.prims.some((p) => p.cls === 'gc-face' && p.a.fill === CX.transform(blue, [{ name: 'tint', a: { val: '75000' } }])));
  assert.ok(sc.prims.some((p) => p.cls === 'gc-face' && p.a.fill === CX.transform(blue, [{ name: 'shade', a: { val: '72000' } }])));
});

test('3-D column, stacked, 100% and standard; a cylinder drawn as a box; horizontal bars', () => {
  let { bars } = CH.scene(col3d(grouping('stacked')), 480, 300).marks;
  for (let i = 0; i < 4; i++) {
    const a = bars.find((b) => b.s === 0 && b.i === i), b = bars.find((x) => x.s === 1 && x.i === i);
    assert.ok(near(b.y + b.h, a.y) && a.x === b.x && a.z0 === b.z0, `category ${i}: costs on sales`);
    assert.equal(b.top, FX.SALES[i] + FX.COSTS[i]);
  }
  ({ bars } = CH.scene(col3d(grouping('percentStacked')), 480, 300).marks);
  const full = (i) => bars.filter((b) => b.i === i).reduce((n, b) => n + b.h, 0);
  assert.ok(near(full(0), full(3), 0.05));
  const std = CH.scene(col3d(grouping('standard')), 480, 300);
  ({ bars } = std.marks);
  const s0 = bars.find((b) => b.s === 0 && b.i === 0), s1 = bars.find((b) => b.s === 1 && b.i === 0);
  assert.ok(s1.z0 > s0.z1, 'the second series a row behind the first');
  const firstFront = std.prims.findIndex((p) => p.cls === 'gc-bar' && p.a.fill === s0.color);
  assert.ok(std.prims.findIndex((p) => p.cls === 'gc-bar' && p.a.fill === s1.color) < firstFront, 'the back row painted first');
  const box = CH.scene(col3d(), 480, 300), cyl = CH.scene(col3d((x) => x.replace('<c:shape val="box"/>', '<c:shape val="cylinder"/>')), 480, 300);
  assert.deepEqual(cyl.marks.faces, box.marks.faces);
  const across = CH.scene(col3d((x) => x.replace('<c:barDir val="col"/>', '<c:barDir val="bar"/>')), 480, 300).marks.bars;
  const j0 = across.find((b) => b.s === 0 && b.i === 0), j3 = across.find((b) => b.s === 0 && b.i === 3);
  assert.ok(near(j3.w / j0.w, 4, 0.01) && j3.y < j0.y);
});

test('frames: 3-D line and area charts, and a 3-D chart beside another, name their type', () => {
  const line3d = FX.CHARTS.line.replace(/lineChart>/g, 'line3DChart>');
  assert.deepEqual([CX.chart(line3d).kind, CX.chart(line3d).type], ['frame', '3-D line chart']);
  assert.equal(CX.chart(FX.CHARTS.line.replace(/lineChart>/g, 'area3DChart>')).type, '3-D area chart');
  const both = (a, b) => FX.CHARTS.col3d.replace('</c:bar3DChart>', `</c:bar3DChart>${a}`).replace('<c:plotArea><c:layout/>', `<c:plotArea><c:layout/>${b}`);
  assert.equal(CX.chart(both('<c:lineChart><c:grouping val="standard"/><c:axId val="10"/><c:axId val="20"/></c:lineChart>', '')).type, '3-D column chart');
  assert.equal(CX.chart(both('', '<c:pie3DChart><c:varyColors val="1"/></c:pie3DChart>')).type, '3-D pie chart');
  const pie = FX.CHARTS.pie3d.match(/<c:pie3DChart>[\s\S]*?<\/c:pie3DChart>/)[0];
  for (const name of ['col3d', 'line', 'radar']) {
    assert.equal(CX.chart(FX.CHARTS[name].replace('</c:plotArea>', `${pie}</c:plotArea>`)).type, '3-D pie chart', `pie after ${name}`);
  }
  for (const w of ['3-D pie chart', '3-D column chart', '3-D bar chart', '3-D line chart', '3-D area chart']) assert.ok(CX.WORDS.includes(w), w);
  assert.ok(!CX.WORDS.includes('3-D chart'), 'no frame says only "3-D"');
});

test('3-D bars: zero values and zero percent totals have no filled faces', () => {
  for (const dir of ['col', 'bar']) for (const grouping of ['clustered', 'stacked', 'percentStacked', 'standard']) {
    const d = col3d(), g = d.groups[0];
    g.dir = dir; g.grouping = grouping;
    for (const s of g.series) { s.vals = [0, -10, 20, null]; }
    const sc = CH.scene(d, 480, 300);
    assert.ok(!sc.marks.faces.some((f) => 's' in f && f.i === 0), `${dir}/${grouping}: zero is not a coloured depth plane`);
    assert.ok(!/NaN|Infinity/.test(JSON.stringify(sc.prims)), `${dir}/${grouping}: finite geometry`);
    assert.ok(sc.marks.bars.filter((b) => b.i === 0).every((b) => b.top === 0));
  }
});

test('3-D bar labels: negative endpoints, reversed axes and stacked segment centres, above all faces', () => {
  for (const dir of ['col', 'bar']) for (const reverse of [false, true]) {
    const d = col3d(), g = d.groups[0];
    g.dir = dir; g.series = [g.series[0]];
    g.series[0].vals = [-10, 20];
    Object.values(d.axes).find((a) => a.kind === 'val').reverse = reverse;
    const sc = CH.scene(d, 480, 300), b = sc.marks.bars.find((b) => b.i === 0);
    const label = sc.prims.find((p) => p.cls === 'gc-label' && p.text === '-10');
    if (dir === 'col') assert.ok(reverse ? label.a.y < b.y : label.a.y > b.y + b.h, `${dir}/${reverse}: ${JSON.stringify({ b, label })}`);
    else assert.ok(reverse ? label.a.x > b.x + b.w : label.a.x < b.x, `${dir}/${reverse}: ${JSON.stringify({ b, label })}`);
  }
  for (const dir of ['col', 'bar']) {
    const d = col3d(grouping('stacked')); d.groups[0].dir = dir;
    const sc = CH.scene(d, 480, 300), b = sc.marks.bars.find((b) => b.s === 0 && b.i === 0);
    const label = sc.prims.find((p) => p.cls === 'gc-label' && p.text === '10');
    assert.ok(near(label.a.x, b.x + b.w / 2) && near(label.a.y - 3.5, b.y + b.h / 2), `${dir}: the label belongs to its own segment`);
    assert.ok(sc.prims.findIndex((p) => p.cls === 'gc-label') > sc.prims.findLastIndex((p) => p.cls === 'gc-bar' || p.cls === 'gc-face'), 'later bars cannot erase a label');
  }
});

test('3-D pie: rotations are reduced to one turn before geometry work', () => {
  // This finite XML number makes turn++ stop advancing in the old rim loop.
  const run = require('node:child_process').spawnSync(process.execPath, ['-e', `
    const CX = require('./documents/sheets/sheet-chart-xml.js'), CH = require('./documents/sheets/sheet-chart.js');
    const FX = require('../test/fixtures/sheets/charts.js');
    const xml = FX.CHARTS.pie3d.replace('<c:rotY val="0"/>', '<c:rotY val="1.3282328232823282e+22"/>');
    console.log(JSON.stringify(CH.scene(CX.resolve(CX.chart(xml), () => null), 480, 300).marks));
  `], { cwd: require('node:path').join(__dirname, '../../extension'), timeout: 2000, encoding: 'utf8' });
  assert.equal(run.error, undefined, `rotation must finish: ${run.error}`);
  assert.equal(run.status, 0, run.stderr);
  const marks = JSON.parse(run.stdout);
  assert.equal(marks.slices.length, 4);
  assert.ok(marks.slices.every((s) => s.a0 >= 0 && s.a1 <= 720));
  assert.ok(marks.sides.filter((s) => s.kind === 'rim').length <= 5);
});

test('3-D pie: every slice exploded still fits a small plot', () => {
  const d = pie3d(); d.title = null; d.legend = null;
  d.groups[0].series[0].explosion = 400;
  d.groups[0].series[0].explode.clear();
  const { marks } = CH.scene(d, 40, 40), p = marks.pie3d;
  for (const s of marks.slices) {
    assert.ok(p.cx + s.dx - p.rx >= 8 && p.cx + s.dx + p.rx <= 32, JSON.stringify({ p, s }));
    assert.ok(p.cy + s.dy - p.ry >= 8 && p.cy + s.dy + p.ry + p.depth <= 32, JSON.stringify({ p, s }));
  }
});

test('3-D pie: large finite values keep their proportions when their sum overflows', () => {
  const d = pie3d(), s = d.groups[0].series[0];
  s.vals = [Number.MAX_VALUE, -Number.MAX_VALUE / 2, 0, null];
  const sc = CH.scene(d, 480, 300);
  assert.deepEqual(sc.marks.slices.map((p) => p.a1 - p.a0).sort((a, b) => a - b), [120, 240]);
  assert.deepEqual(sc.marks.labels, ['67%', '33%']);
  assert.ok(!/NaN|Infinity/.test(JSON.stringify(sc.prims)));
});

test('3-D pie labels: a whole pie is centred; text that cannot fit a shallow ellipse is omitted', () => {
  const one = pie3d(); one.groups[0].series[0].vals = [5, 0, null, 0];
  const sc = CH.scene(one, 480, 300), p = sc.marks.pie3d, slice = sc.marks.slices[0];
  const label = sc.prims.find((p) => p.cls === 'gc-plabel');
  assert.ok(near(label.a.x, p.cx + slice.dx) && near(label.a.y - 4, p.cy + slice.dy), '100% belongs at the centre of its ellipse');
  const shallow = pie3d(view(10, 0)); shallow.title = null; shallow.legend = null;
  const s = shallow.groups[0].series[0]; s.explode.clear(); s.explosion = 400; s.vals = [10, 10, 10, 10];
  const small = CH.scene(shallow, 160, 100);
  assert.ok(small.marks.pie3d.ry < 5, 'the ellipse cannot hold a 10px label');
  assert.equal(small.prims.filter((p) => p.cls === 'gc-plabel').length, 0);
});

test('3-D defaults: missing view3D, all explosions, negative pies and zero totals stay finite', () => {
  for (const kind of ['pie3d', 'col3d']) {
    const d = data(FX.CHARTS[kind].replace(/<c:view3D>[\s\S]*?<\/c:view3D>/, ''));
    const s = d.groups[0].series[0];
    s.vals = [-10, 0, 30, null]; s.explosion = 25; s.explode.clear();
    const before = JSON.stringify(d), sc = CH.scene(d, 480, 300);
    assert.ok(!/NaN|Infinity/.test(JSON.stringify(sc.prims)));
    assert.equal(JSON.stringify(d), before, 'drawing does not mutate the description');
    if (kind === 'pie3d') {
      assert.equal(sc.marks.slices.length, 2);
      assert.ok(sc.marks.slices.every((p) => p.explosion === 0.25));
      assert.ok(near(sc.marks.pie3d.ry / sc.marks.pie3d.rx, 0.5, 0.005));
      s.vals = [0, 0, null];
      assert.equal(CH.scene(d, 480, 300).marks.slices.length, 0);
    }
  }
});

test('bounded: an oversized 3-D chart is a titled frame; a 3-D pie\'s shapes grow by a few per slice', () => {
  const big = pie3d();
  big.groups[0].series[0].vals = new Array(10001).fill(1);
  const sc = CH.scene(big, 480, 288);
  assert.equal(sc.marks.kind, 'Chart');
  assert.ok(sc.prims.length < 10);
  const many = pie3d();
  const s = many.groups[0].series[0];
  s.vals = Array.from({ length: 400 }, (_, i) => i + 1); s.cats = s.vals.map(String); s.explode = new Map(s.vals.map((_, i) => [i, 10]));
  const wide = CH.scene(many, 480, 288);
  assert.ok(wide.prims.length <= 30 + 400 * 6, `${wide.prims.length} shapes for 400 slices`);
  const cols = col3d();
  cols.groups[0].series.forEach((x) => { x.vals = new Array(4000).fill(3); x.cats = x.vals.map(String); });
  assert.ok(CH.scene(cols, 480, 288).prims.length <= 60 + 8000 * 4 + 50);
});

test('round trip: a workbook with 3-D charts read, drawn and written untouched keeps their parts byte for byte', async () => {
  const bytes = FX.workbook({ kinds: ['pie3d', 'col3d'] });
  const z = D.unzip(bytes), before = {};
  for (const n of z.names) before[n] = await z.bytes(n);
  const wb = await X.read(bytes);
  C.engine(wb).recalc();
  const list = CX.charts(wb, wb.sheets[0]).map((c) => CX.resolve(c.chart, CX.lookup(wb)));
  assert.deepEqual(list.map((d) => [d.kind, d.groups[0].type]), [['plot', 'pie3D'], ['plot', 'bar3D']]);
  assert.deepEqual(list[0].groups[0].series[0].vals, FX.SALES, 'read live from the sheet');
  for (const d of list) CH.scene(d, 480, 300);
  const out = D.unzip(await X.write(wb, { date: new Date(2026, 0, 1) }));
  const names = Object.keys(before).filter((n) => /^xl\/(charts|drawings)\//.test(n));
  assert.equal(names.length, 4);
  for (const n of names) assert.deepEqual(new Uint8Array(await out.bytes(n)), new Uint8Array(before[n]), n);
});
