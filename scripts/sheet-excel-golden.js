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
const { read, parseRange, colName } = require('../test/helpers/xlsx-cache.cjs');
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
  const tryEach = (sheet, cell, commands) => lines.push('try', ...commands, 'on error m number n',
    `set end of out to "R" & ${US} & ${str(`${sheet}!${cell}`)} & ${US} & my fieldText(m & " (" & n & ")")`, 'end try');
  const groups = new Set();
  for (const c of list) {
    const group = c.fill || c.array;
    if (group) {
      if (groups.has(`${c.sheet}!${group}`)) continue;
      groups.add(`${c.sheet}!${group}`);
      const first = list.find((d) => (d.fill || d.array) === group && d.sheet === c.sheet && d.cell === group.split(':')[0]);
      const commands = [`set ${c.array ? 'formula array' : 'formula2'} of ${at(c.sheet, c.array ? group : first.cell)} to ${str(first.formula)}`];
      if (c.fill) {
        const r = parseRange(group);
        if (r.c1 > r.c0) commands.push(`fill right ${at(c.sheet, `${colName(r.c0)}${r.r0}:${colName(r.c1)}${r.r0}`)}`);
        if (r.r1 > r.r0) commands.push(`fill down ${at(c.sheet, group)}`);
      }
      tryEach(c.sheet, group, commands);
    } else tryEach(c.sheet, c.cell, [`set formula2 of ${at(c.sheet, c.cell)} to ${str(c.formula)}`]);
  }
  const columns = new Set(list.map((c) => `${c.sheet}!${c.cell.replace(/\d+$/, '')}`));
  for (const k of columns) { const [s, col] = k.split('!'); lines.push(`set column width of range ${str(`${col}:${col}`)} of worksheet ${str(s)} of wb to 80`); }
  lines.push('calculate full');
  for (const c of list) lines.push('try', `set end of out to "T" & ${US} & ${str(c.id)} & ${US} & my fieldText(string value of ${at(c.sheet, c.cell)})`, 'end try');
  return `on fieldText(s)
  set s to s as text
  set oldDelimiters to AppleScript's text item delimiters
  repeat with mapping in {{character id 29, (character id 29) & "g"}, {character id 30, (character id 29) & "r"}, {character id 31, (character id 29) & "u"}}
    set AppleScript's text item delimiters to item 1 of mapping
    set pieces to text items of s
    set AppleScript's text item delimiters to item 2 of mapping
    set s to pieces as text
  end repeat
  set AppleScript's text item delimiters to oldDelimiters
  return s
end fieldText

on run
  set out to {}
  tell application "Microsoft Excel"
    with timeout of 900 seconds
      if (get international data type country_setting) is not 1 or (get international data type country_code) is not 1 or (get international data type decimal separator) is not "." or (get international data type thousands separator) is not "," then error "The Sheets golden harness requires Excel's en-US locale and separators"
      set oldAlerts to display alerts
      set oldUpdating to screen updating
      set wb to missing value
      try
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
      close wb saving no
      set wb to missing value
      on error m number n
        try
          if wb is not missing value then close wb saving no
        end try
        set screen updating to oldUpdating
        set display alerts to oldAlerts
        error m number n
      end try
      set screen updating to oldUpdating
      set display alerts to oldAlerts
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
  let tmp;
  try {
    tmp = box('golden');
    for (const family of names) {
      const list = cases.filter((c) => c.family === family);
      const file = path.join(tmp, `${family}.xlsx`);
      const t = Date.now();
      const out = osa(script(family, list, file), 1000000);
      timing.push(`${family} ${((Date.now() - t) / 1000).toFixed(1)} s`);
      const records = out ? out.split('\x1e').map((r) => r.split('\x1f').map((s) => s.replace(/\x1d([gru])/g,
        (_, c) => ({ g: '\x1d', r: '\x1e', u: '\x1f' })[c]))) : [];
      const texts = new Map(records.filter((r) => r[0] === 'T').map((r) => [r[1], r[2]]));
      const no = new Map(records.filter((r) => r[0] === 'R').map((r) => [r[1], r[2]]));
      const made = records.find((r) => r[0] === 'S')?.slice(1);
      if (JSON.stringify(made) !== JSON.stringify(families[family].sheets)) problems.push(`${family}: Excel made sheets ${made}, not ${families[family].sheets}`);
      fs.copyFileSync(file, path.join(OUT, `${family}.xlsx`));
      const wb = await read(fs.readFileSync(file));
      for (const id of Object.keys(golden)) if (id.startsWith(`${family}.`)) delete golden[id];
      for (const c of list) {
        const why = no.get(`${c.sheet}!${c.cell}`) ?? no.get(`${c.sheet}!${c.fill || c.array}`);
        if (why != null) {
          refused.push({ id: c.id, formula: c.formula, why });
          if (c.unsupported == null) problems.push(`${c.id}: Excel refused ${c.formula} (${why}); mark it unsupported in cases.js`);
          continue;
        }
        if (c.unsupported != null) problems.push(`${c.id}: marked unsupported, yet Excel took ${c.formula}`);
        const cell = wb.sheets.find((s) => s.name === c.sheet)?.cells.get(c.cell);
        if (cell?.f == null || cell.t == null) { problems.push(`${c.id}: ${c.sheet}!${c.cell} has no formula or no cached value`); continue; }
        if (bare(cell.f) !== c.formula.slice(1)) problems.push(`${c.id}: Excel saved =${bare(cell.f)} for ${c.formula}`);
        if (!texts.has(c.id)) { problems.push(`${c.id}: Excel returned no displayed text`); continue; }
        golden[c.id] = { v: cell.v, t: cell.t, text: texts.get(c.id) };
      }
    }
  } finally {
    try { quit(excel); } finally { if (tmp) fs.rmSync(tmp, { recursive: true, force: true }); }
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
