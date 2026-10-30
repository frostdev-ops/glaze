// Microsoft Excel's answers to Glaze Sheets' formula cases (test/fixtures/sheets/cases.js). Each family goes into a
// workbook of its own, so a crash loses little: the inputs first, then each case as a dynamic-array formula (a fill over
// its range, a legacy array formula as one), a full calculation, the text Excel shows for each case, and a save as .xlsx
// (date1904 as the family says). The workbooks are copied to test/fixtures/sheets/<family>.xlsx and read back with the
// harness's reader (test/helpers/xlsx-cache.cjs): golden.json takes each case's type and value from the saved file, and
// only the shown text from Excel itself. A formula Excel refuses is listed with Excel's message, for cases.js to mark
// unsupported; the run fails when Excel and cases.js disagree on that, or a saved formula differs from the one written.
// Mac only, the one heavy job running: nice -n 10 node scripts/sheet-excel-golden.js [family …] (default: all)
// node scripts/sheet-excel-golden.js --script <family> prints that family's AppleScript instead (osacompile checks it).
const fs = require('node:fs'), path = require('node:path');
const { str, num, osa, start, quit, box } = require('./sheet-excel.js');
const { read } = require('../test/helpers/xlsx-cache.cjs');
const { cases, families } = require('../test/fixtures/sheets/cases.js');

const OUT = path.join(__dirname, '../test/fixtures/sheets');
const RS = '(character id 30)', US = '(character id 31)';
const bare = (f) => f.replace(/_xl(fn|ws|pm|udf)\./g, '');

// One family's workbook as an AppleScript: its result lists refusals (R), shown texts (T) and the sheets made (S).
const script = (family, list, file) => {
  const { sheets, date1904 } = families[family];
  const lines = [];
  const at = (sheet, cell) => `range ${str(cell)} of worksheet ${str(sheet)} of wb`;
  const inputs = Object.assign({}, ...list.map((c) => c.inputs));
  for (const [where, v] of Object.entries(inputs)) {
    if (v === null) continue;
    const k = where.lastIndexOf('!'), r = at(where.slice(0, k), where.slice(k + 1));
    if (typeof v === 'number') lines.push(`set value of ${r} to ${num(v)}`);
    else if (typeof v === 'boolean') lines.push(`set value of ${r} to ${v}`);
    else if (typeof v === 'string') lines.push(`set formula of ${r} to ${str(`'${v}`)}`);
    else if (v.e) lines.push(`set formula of ${r} to ${str(v.e)}`);
    else lines.push(`set formula2 of ${r} to ${str(v.f)}`);
  }
  const tryEach = (target, verb, formula) => lines.push(`try`, `set ${verb} of ${target} to ${str(formula)}`,
    `on error m number n`, `set end of out to "R" & ${US} & ${str(target.split('"')[1])} & ${US} & m & " (" & n & ")"`, `end try`);
  const groups = new Set();
  for (const c of list) {
    const group = c.fill || c.array;
    if (group) {
      if (groups.has(`${c.sheet}!${group}`)) continue;
      groups.add(`${c.sheet}!${group}`);
      const first = list.find((d) => (d.fill || d.array) === group && d.sheet === c.sheet && d.cell === group.split(':')[0]);
      tryEach(at(c.sheet, group), c.array ? 'formula array' : 'formula2', first.formula);
    } else tryEach(at(c.sheet, c.cell), 'formula2', c.formula);
  }
  const columns = new Set(list.map((c) => `${c.sheet}!${c.cell.replace(/\d+$/, '')}`));
  for (const k of columns) { const [s, col] = k.split('!'); lines.push(`set column width of range ${str(`${col}:${col}`)} of worksheet ${str(s)} of wb to 80`); }
  lines.push('calculate full');
  for (const c of list) lines.push('try', `set end of out to "T" & ${US} & ${str(c.cell)} & ${US} & (string value of ${at(c.sheet, c.cell)})`, 'end try');
  return `on run
  set out to {}
  tell application "Microsoft Excel"
    with timeout of 900 seconds
      set display alerts to false
      set screen updating to false
      set wb to make new workbook
      set date 1904 of wb to ${!!date1904}
      set remove personal information of wb to true
      set names to {${sheets.map(str).join(', ')}}
      repeat with i from 1 to count of names
        if i > (count of worksheets of wb) then make new worksheet at end of wb
        set name of worksheet i of wb to item i of names
      end repeat
      repeat while (count of worksheets of wb) > (count of names)
        delete worksheet ((count of names) + 1) of wb
      end repeat
      ${lines.join('\n      ')}
      set shown to {}
      repeat with s in worksheets of wb
        set end of shown to name of s
      end repeat
      set AppleScript's text item delimiters to ${US}
      set end of out to "S" & ${US} & (shown as text)
      save workbook as wb filename ${str(file)} file format Excel XML file format
      close workbook ${str(path.basename(file))} saving no
      set screen updating to true
      set display alerts to true
    end timeout
  end tell
  set AppleScript's text item delimiters to ${RS}
  return out as text
end run
`;
};

const main = async () => {
  if (process.argv[2] === '--script') {
    const family = process.argv[3];
    if (!families[family]) throw Error(`no family ${family}`);
    process.stdout.write(script(family, cases.filter((c) => c.family === family), `/tmp/${family}.xlsx`));
    return;
  }
  const wanted = process.argv.slice(2);
  for (const f of wanted) if (!families[f]) throw Error(`no family ${f}; families: ${Object.keys(families).join(', ')}`);
  const names = wanted.length ? wanted : Object.keys(families);
  const goldenFile = path.join(OUT, 'golden.json');
  const golden = fs.existsSync(goldenFile) ? JSON.parse(fs.readFileSync(goldenFile, 'utf8')) : {};
  const problems = [], refused = [], timing = [];
  const t0 = Date.now();
  const excel = start();
  const tmp = box('golden');
  try {
    for (const family of names) {
      const list = cases.filter((c) => c.family === family);
      const file = path.join(tmp, `${family}.xlsx`);
      const t = Date.now();
      const out = osa(script(family, list, file), 1000000);
      timing.push(`${family} ${((Date.now() - t) / 1000).toFixed(1)} s`);
      const records = out ? out.split('\x1e').map((r) => r.split('\x1f')) : [];
      const texts = new Map(records.filter((r) => r[0] === 'T').map((r) => [r[1], r[2]]));
      const no = new Map(records.filter((r) => r[0] === 'R').map((r) => [r[1], r[2]]));
      const made = records.find((r) => r[0] === 'S')?.slice(1);
      if (JSON.stringify(made) !== JSON.stringify(families[family].sheets)) problems.push(`${family}: Excel made sheets ${made}, not ${families[family].sheets}`);
      fs.copyFileSync(file, path.join(OUT, `${family}.xlsx`));
      const wb = await read(fs.readFileSync(file));
      for (const id of Object.keys(golden)) if (id.startsWith(`${family}.`)) delete golden[id];
      for (const c of list) {
        const why = no.get(c.cell) ?? no.get(c.fill || c.array);
        if (why != null) {
          refused.push({ id: c.id, formula: c.formula, why });
          if (c.unsupported == null) problems.push(`${c.id}: Excel refused ${c.formula} (${why}); mark it unsupported in cases.js`);
          continue;
        }
        if (c.unsupported != null) problems.push(`${c.id}: marked unsupported, yet Excel took ${c.formula}`);
        const cell = wb.sheets.find((s) => s.name === c.sheet)?.cells.get(c.cell);
        if (cell?.f == null || cell.t == null) { problems.push(`${c.id}: ${c.sheet}!${c.cell} has no formula or no cached value`); continue; }
        if (bare(cell.f) !== c.formula.slice(1)) problems.push(`${c.id}: Excel saved =${bare(cell.f)} for ${c.formula}`);
        golden[c.id] = { v: cell.v, t: cell.t, text: texts.get(c.cell) ?? '' };
      }
    }
  } finally {
    quit(excel);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  const order = new Map(cases.map((c, i) => [c.id, i]));
  const sorted = Object.fromEntries(Object.entries(golden).filter(([id]) => order.has(id)).sort(([a], [b]) => order.get(a) - order.get(b)));
  fs.writeFileSync(goldenFile, `{\n${Object.entries(sorted).map(([id, g]) => `${JSON.stringify(id)}: ${JSON.stringify(g)}`).join(',\n')}\n}\n`);
  for (const family of names) {
    const list = cases.filter((c) => c.family === family);
    const size = fs.statSync(path.join(OUT, `${family}.xlsx`)).size;
    console.log(`${family}: ${list.length} cases, ${list.filter((c) => sorted[c.id]).length} cached, ${(size / 1024).toFixed(1)} KB`);
  }
  console.log(`Excel: ${timing.join(', ')}; ${((Date.now() - t0) / 1000).toFixed(1)} s in all`);
  for (const r of refused) console.log(`refused ${r.id} ${r.formula}: ${r.why}`);
  for (const p of problems) console.log(`PROBLEM ${p}`);
  if (problems.length) process.exitCode = 1;
};

main().catch((err) => { console.error(err.message); process.exitCode = 2; });
