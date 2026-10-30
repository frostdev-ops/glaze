// Does Microsoft Excel open an .xlsx as it was written, without repairing it? Opens the file in Excel on this Mac
// (hidden, no alerts; scripts/sheet-excel.js) and fails when Excel repaired it: "Repaired" in the workbook's or window's
// name, or no answer while a repair prompt waits. Still todo, for the .xlsx Glaze writes (lib/sheet-xlsx.js, S7): its
// values, frozen panes, merges and charts against what Glaze meant.
// Mac only, the one heavy job running: nice -n 10 node scripts/sheet-excel-fidelity.js [file.xlsx] (default: a golden workbook)
const fs = require('node:fs'), path = require('node:path');
const { str, osa, start, quit, box } = require('./sheet-excel.js');

const TODO = ['cell values against what Glaze wrote', 'frozen panes', 'merged cells', 'charts'];

const main = () => {
  const from = path.resolve(process.argv[2] || path.join(__dirname, '../test/fixtures/sheets/math.xlsx'));
  if (!fs.existsSync(from)) throw Error(`no file ${from}`);
  const excel = start();
  let tmp, names;
  try {
    tmp = box('fidelity');
    const file = path.join(tmp, path.basename(from));
    fs.copyFileSync(from, file);
    names = osa(`tell application "Microsoft Excel"
  with timeout of 110 seconds
    set oldAlerts to display alerts
    set wb to missing value
    try
    set display alerts to false
    open (POSIX file ${str(file)})
    set wb to active workbook
    set b to name of wb
    set w to caption of active window
    close wb saving no
    set wb to missing value
    on error m number n
      try
        if wb is not missing value then close wb saving no
      end try
      set display alerts to oldAlerts
      error m number n
    end try
    set display alerts to oldAlerts
  end timeout
  return b & (character id 31) & w
end tell`).split('\x1f');
  } catch (err) {
    throw Error(`Excel did not open ${path.basename(from)} cleanly; a repair prompt may be waiting (${err.message})`);
  } finally {
    try { quit(excel); } finally { if (tmp) fs.rmSync(tmp, { recursive: true, force: true }); }
  }
  const repaired = names.some((n) => /repaired/i.test(n));
  console.log(`${path.basename(from)}: ${repaired ? 'REPAIRED by Excel' : 'no repair prompt'} (workbook "${names[0]}", window "${names[1]}")`);
  for (const t of TODO) console.log(`todo: ${t}`);
  if (repaired) process.exitCode = 1;
};

try { main(); } catch (err) { console.error(err.message); process.exitCode = 2; }
