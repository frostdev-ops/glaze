// Does Microsoft Excel open the .xlsx Glaze writes as Glaze meant it? The workbooks of scripts/sheet-fidelity-books.js
// (the 13 golden workbooks read and written again by lib/sheet-xlsx.js, one built in Glaze from scratch, or the files
// given) open in Excel on this Mac (hidden, no alerts; scripts/sheet-excel.js) through JXA. A file fails when Excel
// repaired it ("Repaired" in the workbook's or window's name, or no answer while a repair prompt waits), or when Excel
// shows other than the model: sheets and their order, the date system, each cell's value after Excel's own full
// calculation, formula and number format, merged cells, frozen panes and hidden columns, and as many charts on each sheet
// as Glaze draws there (lib/sheet-chart-xml.js): charts-kept.xlsx (Excel-shaped charts, test/fixtures/sheets/charts.js,
// read and written again with two rows inserted, their references and anchors moved) and charts-inserted.xlsx (a
// column, bar, line, pie and scatter chart made by Insert on a workbook built in Glaze, one dragged, one deleted).
// Mac only, the one heavy job running: nice -n 10 node scripts/sheet-excel-fidelity.js [--keep dir] [file.xlsx …]
const fs = require('node:fs'), path = require('node:path');
const { jxa: run, start, quit, box } = require('./sheet-excel.js');
const { books, expect, agree, stored } = require('./sheet-fidelity-books.js');
const M = require('../lib/sheet-model.js');
const { cases } = require('../test/fixtures/sheets/cases.js');
const X = require('../lib/sheet-xlsx.js'), C = require('../lib/sheet-calc.js'), CX = require('../lib/sheet-chart-xml.js');
const FX = require('../test/fixtures/sheets/charts.js');

// The two chart workbooks: Excel's shapes kept through Glaze, and charts Insert made.
const chartBooks = async () => {
  const kept = await X.read(FX.workbook());
  const e = C.engine(kept);
  e.recalc();
  const ins = { op: 'insert', sheet: kept.sheets[0].id, axis: 'row', at: 0, n: 2 };
  e.apply(ins); X.track(kept, ins);
  const keptBytes = await X.write(kept, { engine: e });
  const made = M.workbook(), sh = made.sheets[0];
  [['Month', 'Sales', 'Costs'], ['Jan', 10, 5], ['Feb', 20, 15], ['Mar', 30, 10], ['Apr', 40, 20]]
    .forEach((row, r) => sh.rows.set(r, new Map(row.map((v, c) => [c, typeof v === 'number' ? { t: 'n', v } : { t: 's', v }]))));
  C.engine(made).recalc();
  const L = FX.layerOn(made, sh);
  for (const kind of ['column', 'bar', 'line', 'pie', 'scatter']) { L.draw(); L.apply(L.insert(kind, { r0: 0, c0: 0, r1: 4, c1: 2 })); }
  L.draw();
  L.apply(L.move(L.list()[1].id, { x: 0, y: 140, w: 400, h: 240 }));
  L.draw();
  L.apply(L.remove(L.list()[3].id));
  const madeBytes = await X.write(made);
  return [{ name: 'charts-kept.xlsx', bytes: keptBytes, model: await X.read(keptBytes) }, { name: 'charts-inserted.xlsx', bytes: madeBytes, model: await X.read(madeBytes) }];
};
const ENGINE_TODO = new Set(['financial.rate.2', 'financial.xirr.1', 'financial.xirr.2']);

// The JXA that opens one file and reports what Excel shows, as JSON. ask: per sheet, the cells whose shown text (errors)
// and number format are wanted, the merges and hidden columns to look at. Each cell Glaze holds is read by itself: JXA
// drops an error (missing value) from a nested list, and on refs.xlsx (Excel's own file too) a whole range's value2 came
// back empty, or stopped Excel, and every read after it was empty. Rows are read only for their formulas, to find
// content where Glaze has none.
const jxa = (file, ask) => `
const app = Application('Microsoft Excel');
const alerts = app.displayAlerts();
app.displayAlerts = false;
let wb = null, step = 'open';
try {
  app.open(Path(${JSON.stringify(file)}));
  const opened = app.activeWorkbook;
  if (opened.fullName() !== ${JSON.stringify(file)}) throw new Error('Excel did not open the probe workbook');
  wb = opened;
  const out = { name: wb.name(), caption: app.activeWindow.caption(), date1904: wb.date1904(), active: wb.activeSheet.name(), sheets: [], visible: wb.worksheets.visible() };
  const ask = ${JSON.stringify(ask)};
  const names = wb.worksheets.name();
  out.names = names;
  for (const a of ask) {
    step = a.name;
    const i = names.indexOf(a.name);
    if (i < 0) { out.sheets.push(null); continue; }
    const ws = wb.worksheets.byName(a.name);
    const s = { formulas: [], text: {}, fmt: {}, merges: {}, hidden: {} };
    const read = (row, prop) => {
      let v = ws.ranges[a.cols.length === 1 ? a.cols[0] + row : a.cols[0] + row + ':' + a.cols[a.cols.length - 1] + row][prop]();
      if (!Array.isArray(v)) v = [v];
      else if (Array.isArray(v[0])) v = v.length === 1 ? v[0] : null;
      if (v && v.length === a.cols.length) return v;
      return a.cols.map((c) => ws.ranges[c + row][prop]());
    };
    step = a.name + ' rows';
    for (let row = 1; row <= a.rows; row++) s.formulas.push(read(row, 'formula2'));
    step = a.name + ' cells';
    s.cell = {};
    s.cellF = {};
    for (const at of a.cells) { s.cell[at] = ws.ranges[at].value2(); s.cellF[at] = ws.ranges[at].formula2(); }
    step = a.name + ' text';
    for (const at of a.text) s.text[at] = ws.ranges[at].stringValue();
    step = a.name + ' formats';
    for (const at of a.fmt) s.fmt[at] = ws.ranges[at].numberFormat();
    for (const g of a.merges) s.merges[g] = { merged: ws.ranges[g].mergeCells(), area: app.getAddress(ws.ranges[g.split(':')[0]].mergeArea) };
    for (const c of a.hidden) s.hidden[c] = ws.ranges[c].entireColumn.hidden();
    step = a.name + ' charts';
    try { s.charts = ws.chartObjects.length; s.chartTypes = []; for (let i = 0; i < s.charts; i++) { try { s.chartTypes.push(String(ws.chartObjects[i].chart.chartType())); } catch (e) { s.chartTypes.push('?'); } } } catch (e) { s.charts = { error: e.message }; }
    step = a.name + ' panes';
    if (a.visible) {
      const panes = (w) => ({ on: w.freezePanes(), rows: w.splitRow(), cols: w.splitColumn() });
      try { app.activateObject(ws); s.freeze = panes(wb.windows[0]); } catch (e) {
        try { ws.activate(); s.freeze = panes(app.activeWindow); } catch (e2) { s.freeze = { error: e2.message }; }
      }
    }
    out.sheets.push(s);
  }
  wb.close({ saving: 'no' });
  wb = null;
  app.displayAlerts = alerts;
  JSON.stringify(out);
} catch (e) {
  try { if (wb) wb.close({ saving: 'no' }); } catch (e2) {}
  app.displayAlerts = alerts;
  throw new Error(step + ': ' + e.message);
}`;

// One file's comparison: → { cells, problems: [text] (what the file got wrong), engine: [text] (formulas Excel's own
// calculation answers otherwise than the value Glaze cached) }.
const compare = (model, got) => {
  const problems = [], engine = [], unchecked = [];
  const want = expect(model);
  if (JSON.stringify(got.names) !== JSON.stringify(model.sheets.map((s) => s.name))) problems.push(`sheets ${JSON.stringify(got.names)}, not ${JSON.stringify(model.sheets.map((s) => s.name))}`);
  if (got.date1904 !== model.date1904) problems.push(`date1904 ${got.date1904}`);
  const hidden = model.sheets.map((s) => !!s.keep?.hidden);
  if (got.visible && JSON.stringify(got.visible.map((v) => v !== true && v !== 'sheet visible')) !== JSON.stringify(hidden)) problems.push(`sheet visibility ${JSON.stringify(got.visible)}`);
  if (got.active !== model.sheets[model.active].name) problems.push(`active sheet ${got.active}, not ${model.sheets[model.active].name}`);
  let cells = 0;
  want.forEach((sh, k) => {
    const s = got.sheets[k];
    if (!s) { problems.push(`${sh.name}: missing`); return; }
    const forms = s.formulas;
    for (let r = 0; r <= sh.r1; r++) for (let c = 0; c <= sh.c1; c++) {
      const at = M.cellName(r, c), x = sh.cells.get(at), v = s.cell[at], f = Object.hasOwn(s.cellF, at) ? s.cellF[at] : forms[r]?.[c];
      const where = `${sh.name}!${at}`;
      if (!x || x.t === 'z') {
        if (x?.array) { if (f !== x.array) problems.push(`${where}: formula ${JSON.stringify(f)}, not the array's ${x.array}`); cells++; continue; }
        if (x?.f !== undefined) { if (f !== x.f) problems.push(`${where}: formula ${JSON.stringify(f)}, not ${x.f}`); cells++; continue; }
        if (f !== '' && f !== null && f !== undefined) problems.push(`${where}: ${JSON.stringify(f)} where Glaze has nothing`);
        continue;
      }
      cells++;
      const wantF = x.array ?? x.f;
      if (wantF !== undefined && f !== wantF) problems.push(`${where}: formula ${JSON.stringify(f)}, not ${wantF}`);
      if (wantF === undefined && typeof f === 'string' && f.startsWith('=')) problems.push(`${where}: formula ${f} where Glaze has a value`);
      const shown = Object.hasOwn(s.text, at) ? s.text[at] : null;
      const off = x.f !== undefined ? engine : problems;
      if (x.t === 'e') {
        if (typeof shown !== 'string') problems.push(`${where}: error text was not read`);
        else if (shown !== x.v && stored(shown) !== x.v) off.push(`${where} ${x.f ?? ''}: ${JSON.stringify(shown)}, not ${x.v}`);
      }
      else if (shown !== null && /^#[A-Z/0!?]+[!?A]?$/.test(shown) && x.t !== 's') off.push(`${where} ${x.f ?? ''}: ${shown}, not ${JSON.stringify(x.v)}`);
      else if (x.t === 'n' && !agree('n', x.v, v)) off.push(`${where} ${x.f ?? ''}: ${JSON.stringify(v)}, not ${x.v}`);
      else if (x.t === 's' && v !== x.v) off.push(`${where} ${x.f ?? ''}: ${JSON.stringify(v)}, not ${JSON.stringify(x.v)}`);
      else if (x.t === 'b' && v !== x.v) off.push(`${where} ${x.f ?? ''}: ${JSON.stringify(v)}, not ${x.v}`);
      if (Object.hasOwn(s.fmt, at) && !sameFormat(s.fmt[at], x)) problems.push(`${where}: number format ${JSON.stringify(s.fmt[at])}, not ${JSON.stringify(x.fmt)}`);
    }
    for (const g of sh.merges) {
      const m = s.merges[g];
      if (!m?.merged || String(m.area).replace(/\$/g, '') !== g) problems.push(`${sh.name}!${g}: merged ${JSON.stringify(m)}`);
    }
    for (const c of sh.hidden) if (s.hidden[M.columnName(c) + '1'] !== true) problems.push(`${sh.name}: column ${M.columnName(c)} not hidden`);
    const charts = CX.charts(model, model.sheets[k]).length;
    if (s.charts?.error) unchecked.push(`${sh.name}: charts not readable (${s.charts.error})`);
    else if (s.charts !== charts) problems.push(`${sh.name}: ${s.charts} charts in Excel, ${charts} in Glaze (${JSON.stringify(s.chartTypes)})`);
    if (s.freeze?.error) unchecked.push(`${sh.name}: panes not readable (${s.freeze.error})`);
    else if (s.freeze) {
      const f = sh.freeze ?? { rows: 0, cols: 0 };
      const on = !!(f.rows || f.cols);
      if (s.freeze.on !== on || (on && (s.freeze.rows !== f.rows || s.freeze.cols !== f.cols))) problems.push(`${sh.name}: frozen ${JSON.stringify(s.freeze)}, not ${JSON.stringify(f)}`);
    }
  });
  return { cells, problems, engine, unchecked };
};
// Excel's own spelling of a format against the code Glaze keeps: quotes, backslashes and case aside. Built-in 14 and 22
// follow the Mac's short date, which Excel 16.114.1 in en-US spells with a two-digit year.
const norm = (s) => String(s ?? '').replace(/["\\]/g, '').toLowerCase();
const LOCALE = { 14: ['m/d/yy'], 22: ['m/d/yy h:mm'] };
const sameFormat = (shown, x) => norm(shown) === norm(x.fmt) || (LOCALE[x.id] ?? []).includes(norm(shown));

const ask = (model) => expect(model).map((sh) => {
  const text = [], fmt = [];
  for (const [at, x] of sh.cells) {
    if (x.t === 'e' || x.f !== undefined) text.push(at);
    if (x.fmt !== 'General') fmt.push(at);
  }
  return { name: sh.name, cells: [...sh.cells.keys()], rows: sh.r1 + 1, cols: Array.from({ length: sh.c1 + 1 }, (_, c) => M.columnName(c)), text, fmt, merges: sh.merges,
    hidden: sh.hidden.map((c) => `${M.columnName(c)}1`), visible: !sh.sheetHidden };
});

const main = async () => {
  const args = process.argv.slice(2);
  const k = args.indexOf('--keep');
  const keepDir = k >= 0 ? path.resolve(args.splice(k, 2)[1]) : null;
  const list = await books(args.map((f) => path.resolve(f)));
  if (!args.length) list.push(...await chartBooks());
  const excel = start();
  let tmp;
  const rows = [];
  try {
    tmp = box('fidelity');
    for (const b of list) {
      const file = path.join(tmp, b.name);
      fs.writeFileSync(file, b.bytes);
      if (keepDir) { fs.mkdirSync(keepDir, { recursive: true }); fs.writeFileSync(path.join(keepDir, b.name), b.bytes); }
      let got;
      try {
        got = JSON.parse(run(jxa(file, ask(b.model)), 600000));
      } catch (err) {
        rows.push({ name: b.name, repaired: 'no answer (a repair prompt?)', cells: 0, problems: [err.message.trim().slice(0, 300)] });
        continue;
      }
      const repaired = /repaired/i.test(got.name) || /repaired/i.test(got.caption);
      const res = compare(b.model, got);
      const allowed = cases.filter((c) => ENGINE_TODO.has(c.id) && `${c.family}.xlsx` === b.name).map((c) => `${c.sheet}!${c.cell} `);
      for (const p of res.engine) if (!allowed.some((prefix) => p.startsWith(prefix))) res.problems.push(`unexpected engine difference: ${p}`);
      rows.push({ name: b.name, repaired: repaired ? `REPAIRED ("${got.name}", "${got.caption}")` : 'no', ...res });
    }
  } finally {
    try { quit(excel); } finally { if (tmp) fs.rmSync(tmp, { recursive: true, force: true }); }
  }
  console.log('| workbook | repaired | cells compared | file differences | formulas Excel answers otherwise |');
  console.log('|---|---|---|---|---|');
  for (const r of rows) console.log(`| ${r.name} | ${r.repaired} | ${r.cells} | ${r.problems.length} | ${r.engine?.length ?? '-'} |`);
  for (const r of rows) for (const p of r.problems) console.log(`${r.name}: ${p}`);
  for (const r of rows) for (const p of r.engine ?? []) console.log(`${r.name} (engine): ${p}`);
  for (const r of rows) for (const p of r.unchecked ?? []) console.log(`${r.name} (not checked): ${p}`);
  if (rows.some((r) => r.repaired !== 'no' || r.problems.length)) process.exitCode = 1;
};

main().catch((err) => { console.error(err.stack || err.message); process.exitCode = 2; });
