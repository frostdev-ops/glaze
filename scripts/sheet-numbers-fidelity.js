// Does Apple Numbers open the .xlsx Glaze writes with Glaze's values? The workbooks of scripts/sheet-fidelity-books.js
// open in Numbers on this Mac (launched hidden when it isn't running, and quit only then) through JXA. A file fails
// when Numbers won't open it, its sheets aren't Glaze's, or a value Glaze stored as such (text, a number, a date, a
// boolean) reads otherwise. Formulas Numbers calculates with its own functions: where its answer differs from the value
// Glaze cached, that is listed apart and doesn't fail the file. Google Sheets stays a manual check.
// Mac only, the one heavy job running: nice -n 10 node scripts/sheet-numbers-fidelity.js [--keep dir] [file.xlsx …]
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { execFileSync } = require('node:child_process');
const { books, expect, agree } = require('./sheet-fidelity-books.js');
const M = require('../lib/sheet-model.js');

const NUMBERS = '/Applications/Numbers.app';
const pid = () => { try { return +execFileSync('pgrep', ['-x', 'Numbers'], { encoding: 'utf8' }).split('\n')[0]; } catch { return 0; } };
const jxa = (js, timeout = 300000) => execFileSync('osascript', ['-l', 'JavaScript', '-e', js], { encoding: 'utf8', timeout, maxBuffer: 64 << 20 });
const start = () => {
  if (process.platform !== 'darwin' || !fs.existsSync(NUMBERS)) throw Error('Numbers is not installed on this Mac');
  const before = pid();
  if (!before) execFileSync('open', ['-g', '-j', '-a', NUMBERS]);
  jxa("Application('Numbers').name()", 120000);
  return { started: !before, pid: before || pid() };
};
const quit = ({ started, pid: was }) => {
  if (!started) return;
  try { jxa("Application('Numbers').quit({ saving: 'no' })", 90000); } catch { /* not answering */ }
  if (was && pid() === was) try { process.kill(was, 'SIGTERM'); } catch { /* already gone */ }
};

// What Numbers shows of one file: each sheet's first table and, for each cell Glaze holds (ask: sheet name → cell names),
// its value (a date as its local parts, so the day survives JSON) and shown text. A cell at a time: a whole table's
// values in one Apple event outlast Numbers' reply.
const read = (file, ask) => `
const app = Application('Numbers');
const doc = app.open(Path(${JSON.stringify(file)}));
try {
  const ask = ${JSON.stringify(ask)};
  const out = { sheets: [] };
  for (const sh of doc.sheets()) {
    const t = sh.tables()[0], s = { name: sh.name(), cells: {} };
    out.sheets.push(s);
    if (!t) continue;
    s.rows = t.rowCount(); s.cols = t.columnCount(); s.header = t.headerRowCount();
    for (const at of ask[s.name] || []) {
      let v, text;
      try { const c = t.cells.byName(at); v = c.value(); text = c.formattedValue(); } catch (e) { v = { missing: e.message }; }
      s.cells[at] = { v: v instanceof Date ? { date: [v.getFullYear(), v.getMonth() + 1, v.getDate(), v.getHours(), v.getMinutes(), v.getSeconds()] } : v, text };
    }
  }
  JSON.stringify(out);
} finally { doc.close({ saving: 'no' }); }`;

const serial = ([y, m, d, H, Mi, S], date1904) => M.toSerial(y, m, d, date1904) + M.timeSerial(H, Mi, S);

const compare = (model, got) => {
  const problems = [], engine = [];
  const want = expect(model);
  const names = got.sheets.map((s) => s.name);
  if (JSON.stringify(names) !== JSON.stringify(want.map((s) => s.name))) problems.push(`sheets ${JSON.stringify(names)}, not ${JSON.stringify(want.map((s) => s.name))}`);
  let cells = 0;
  for (const sh of want) {
    const s = got.sheets.find((x) => x.name === sh.name);
    if (!s) continue;
    for (const [at, x] of sh.cells) {
      if (x.t === 'z') continue;
      const g = s.cells[at];
      cells++;
      const off = x.f !== undefined ? engine : problems;
      const where = `${sh.name}!${at}${x.f ? ` ${x.f}` : ''}`;
      if (!g || (g.v && g.v.missing)) { off.push(`${where}: not in Numbers' table${g ? ` (${g.v.missing})` : ''}`); continue; }
      let v = g.v;
      if (v && typeof v === 'object' && v.date) v = serial(v.date, model.date1904);
      if (x.t === 'n') { if (!agree('n', x.v, v) && !(typeof v === 'number' && Math.abs(x.v - v) <= 1e-9 * Math.max(1, Math.abs(x.v)))) off.push(`${where}: ${JSON.stringify(g.v)}, not ${x.v}`); }
      else if (x.t === 's') { if (v !== x.v && !(x.v === '' && (v === null || v === ''))) off.push(`${where}: ${JSON.stringify(g.v)}, not ${JSON.stringify(x.v)}`); }
      else if (x.t === 'b') { if (v !== x.v && g.text !== (x.v ? 'TRUE' : 'FALSE')) off.push(`${where}: ${JSON.stringify(g.v)} (${g.text}), not ${x.v}`); }
      else if (x.t === 'e') { if (!/^#|error/i.test(String(g.text ?? '')) && g.v !== null) off.push(`${where}: ${JSON.stringify(g.v)} (${g.text}), not ${x.v}`); }
    }
  }
  return { cells, problems, engine };
};

const main = async () => {
  const args = process.argv.slice(2);
  const k = args.indexOf('--keep');
  const keepDir = k >= 0 ? path.resolve(args.splice(k, 2)[1]) : null;
  const list = await books(args.map((f) => path.resolve(f)));
  const numbers = start();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'glaze-numbers-'));
  const rows = [];
  try {
    for (const b of list) {
      const file = path.join(tmp, b.name);
      fs.writeFileSync(file, b.bytes);
      if (keepDir) { fs.mkdirSync(keepDir, { recursive: true }); fs.writeFileSync(path.join(keepDir, b.name), b.bytes); }
      let got;
      const ask = Object.fromEntries(expect(b.model).map((sh) => [sh.name, [...sh.cells].filter(([, x]) => x.t !== 'z').map(([at]) => at)]));
      try { got = JSON.parse(jxa(read(file, ask), 900000)); } catch (err) { rows.push({ name: b.name, opened: 'no', cells: 0, problems: [String(err.stderr || err.message).trim().slice(0, 300)], engine: [] }); continue; }
      rows.push({ name: b.name, opened: 'yes', ...compare(b.model, got) });
    }
  } finally {
    try { quit(numbers); } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  }
  console.log('| workbook | opened | values compared | file differences | formulas Numbers answers otherwise |');
  console.log('|---|---|---|---|---|');
  for (const r of rows) console.log(`| ${r.name} | ${r.opened} | ${r.cells} | ${r.problems.length} | ${r.engine.length} |`);
  for (const r of rows) for (const p of r.problems) console.log(`${r.name}: ${p}`);
  for (const r of rows) for (const p of r.engine) console.log(`${r.name} (Numbers' functions): ${p}`);
  if (rows.some((r) => r.opened !== 'yes' || r.problems.length)) process.exitCode = 1;
};

main().catch((err) => { console.error(err.stack || err.message); process.exitCode = 2; });
