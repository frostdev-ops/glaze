// Microsoft Excel on this Mac through AppleScript, for the Sheets harness (scripts/sheet-excel-golden.js,
// scripts/sheet-excel-fidelity.js), as scripts/writer-word-fidelity.js drives Word. Excel runs hidden and without alerts;
// files go through a folder inside Excel's own container, which the sandboxed app reads and writes without asking; Excel
// quits only if the script started it. Scripts are plain ASCII: other characters are spelled as (character id N).
const { execFileSync } = require('node:child_process');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');

const EXCEL = '/Applications/Microsoft Excel.app';
const BOX = path.join(os.homedir(), 'Library/Containers/com.microsoft.Excel/Data/tmp');
const pid = () => { try { return +execFileSync('pgrep', ['-x', 'Microsoft Excel'], { encoding: 'utf8' }).split('\n')[0]; } catch { return 0; } };

// AppleScript text for any string, and an AppleScript number that reads back as the same double.
const str = (s) => {
  const parts = [];
  let run = '';
  for (const ch of String(s)) {
    const cp = ch.codePointAt(0);
    if (cp >= 32 && cp < 127) { run += ch === '"' || ch === '\\' ? `\\${ch}` : ch; continue; }
    if (run) parts.push(`"${run}"`);
    run = '';
    parts.push(`(character id ${cp})`);
  }
  if (run || !parts.length) parts.push(`"${run}"`);
  return parts.join(' & ');
};
const num = (x) => {
  if (!Number.isFinite(x)) throw RangeError(`${x} is no Excel number`);
  if (Number.isInteger(x) && Math.abs(x) < 2 ** 29) return String(x);
  const [m, e] = x.toExponential().split('e');
  return `${m.includes('.') ? m : `${m}.0`}E${e[0] === '-' ? e : `+${e.replace('+', '')}`}`;
};

// Runs a script, its result as text: AppleScript (osa) or JavaScript for Automation (jxa). macOS refusing the events
// (the Automation setting, or its prompt left unanswered) comes back as an Error that says what to allow.
const run = (script, timeout, js) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gz-excel-'));
  const file = path.join(dir, js ? 'run.js' : 'run.applescript');
  try {
    fs.writeFileSync(file, script);
    return execFileSync('osascript', [...(js ? ['-l', 'JavaScript'] : []), file], { encoding: 'utf8', timeout, maxBuffer: 64 << 20 }).replace(/\n$/, '');
  } catch (err) {
    const why = `${err.stderr || ''}`.trim() || err.message;
    const from = process.env.__CFBundleIdentifier || process.env.TERM_PROGRAM || 'this terminal';
    if (/-1743/.test(why)) throw Error(`macOS doesn't let ${from} control Microsoft Excel: turn it on in System Settings > Privacy & Security > Automation, then run again (${why})`);
    if (/-1712/.test(why)) throw Error(`Excel didn't answer in time; if macOS asked whether ${from} may control Microsoft Excel, allow it and run again (${why})`);
    throw Error(why);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
};
const osa = (script, timeout = 120000) => run(script, timeout, false);
const jxa = (script, timeout = 120000) => run(script, timeout, true);

// Excel ready for Apple events: launched hidden when it isn't running. → { started, pid } for quit().
const start = () => {
  if (process.platform !== 'darwin' || !fs.existsSync(EXCEL)) throw Error('Microsoft Excel is not installed on this Mac');
  const before = pid();
  if (!before) execFileSync('open', ['-g', '-j', '-a', EXCEL]);
  const self = { started: !before, pid: before || pid() };
  try {
    osa('with timeout of 110 seconds\ntell application "Microsoft Excel" to get version\nend timeout');
  } catch (err) {
    self.pid ||= pid();
    quit(self);
    throw err;
  }
  self.pid ||= pid();
  return self;
};
// Quits Excel if start() launched it: asked first; the process it launched is stopped if it can't be asked.
const quit = ({ started, pid: was }) => {
  if (!started) return;
  try { osa('with timeout of 60 seconds\ntell application "Microsoft Excel" to quit saving no\nend timeout', 90000); } catch { /* not answering */ }
  if (was && pid() === was) try { process.kill(was, 'SIGTERM'); } catch { /* already gone */ }
};

// A folder inside Excel's container for one run's files, removed by the caller.
const box = (name) => { fs.mkdirSync(BOX, { recursive: true }); return fs.mkdtempSync(path.join(BOX, `glaze-${name}-`)); };

module.exports = { EXCEL, str, num, osa, jxa, start, quit, box };
