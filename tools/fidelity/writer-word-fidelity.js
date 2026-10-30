// Does Microsoft Word lay out Glaze Writer's .docx as the editor's pages show it? Opens each fixture paper that
// scripts/writer-paper-check.js wrote (paper-<format>.docx, with the editor's pages in editor-pages.json) in Word on this
// Mac through AppleScript, saves it as PDF, and compares the page count and each page's first line with the editor's.
// A page may start one line earlier or later (the owner's accepted tolerance); more fails. Word must not open the file in
// Compatibility Mode. Word runs without dialogs; each document is closed; Word quits only if this script started it.
// Files go in a temporary folder inside Word's own container, so the sandboxed app reads and writes them without asking.
// node scripts/writer-word-fidelity.js [folder with the check's output] (default: $TMPDIR/gz-paper-check)
const { execFileSync } = require('node:child_process');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');

const from = path.resolve(process.argv[2] || path.join(os.tmpdir(), 'gz-paper-check'));
const WORD = '/Applications/Microsoft Word.app';
const osa = (script) => execFileSync('osascript', ['-e', script], { encoding: 'utf8', timeout: 120000 }).trim();
const words = (s) => String(s || '').replace(/ (\d+) /g, '$1 ').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim();
const running = () => { try { execFileSync('pgrep', ['-x', 'Microsoft Word']); return true; } catch { return false; } };

const main = () => {
  if (!fs.existsSync(WORD)) throw Error('Microsoft Word is not installed');
  const editor = JSON.parse(fs.readFileSync(path.join(from, 'editor-pages.json'), 'utf8'));
  const box = path.join(os.homedir(), 'Library/Containers/com.microsoft.Word/Data/tmp');
  fs.mkdirSync(box, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(box, 'glaze-fidelity-'));
  const started = !running();
  const rows = [];
  try {
    for (const [id, ed] of Object.entries(editor)) {
      const docx = path.join(tmp, `paper-${id}.docx`), pdf = path.join(tmp, `paper-${id}.pdf`);
      fs.copyFileSync(path.join(from, `paper-${id}.docx`), docx);
      // Open without alerts, read the window title (Word adds "[Compatibility Mode]" there), save as PDF, close unsaved.
      const caption = osa(`tell application "Microsoft Word"
  set display alerts to alerts none
  open POSIX file "${docx}"
  set d to active document
  set c to caption of active window
  save as d file name "${pdf}" file format format PDF
  close d saving no
  return c
end tell`);
      const pageCount = +/Pages:\s+(\d+)/.exec(execFileSync('pdfinfo', [pdf], { encoding: 'utf8' }))[1];
      const firsts = [];
      let same = 0, total = 0;
      for (let k = 1; k <= pageCount; k++) {
        const text = execFileSync('pdftotext', ['-f', String(k), '-l', String(k), pdf, '-'], { encoding: 'utf8' });
        let lines = text.split('\n').map(words).filter(Boolean);
        const header = ed.headers[k - 1] || '';
        if (lines[0] === header) lines = lines.slice(1);
        firsts.push(lines[0] || '');
        // Every body line of the page, in order (footnotes come after them in the PDF's text).
        for (const [i, l] of (ed.lines?.[k - 1] || []).entries()) { total++; if (words(l) === lines[i]) same++; }
      }
      // A page's first line matches when the same text starts it, or the line before or after it does (±1 line):
      // compared on the first 6 words, which a line always holds.
      const head = (s) => words(s).split(' ').slice(0, 6).join(' ');
      const pages = [];
      for (let k = 0; k < Math.max(pageCount, ed.count); k++) {
        const a = head(ed.firsts[k]), b = head(firsts[k]);
        const same = a === b, near = !same && !!a && !!b && (words(firsts[k]).includes(a) || words(ed.firsts[k]).includes(b));
        pages.push({ page: k + 1, editor: ed.firsts[k] || '', word: firsts[k] || '', match: same ? 'same' : near ? '±1 line' : 'differs' });
      }
      rows.push({ id, lines: { same, total }, compat: /compatibility mode/i.test(caption), caption, editorPages: ed.count, wordPages: pageCount, pages, pdf: path.join(from, `word-${id}.pdf`) });
      fs.copyFileSync(pdf, path.join(from, `word-${id}.pdf`));
    }
  } finally {
    try { if (started) osa('tell application "Microsoft Word" to quit saving no'); } catch { /* already gone */ }
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  let ok = true;
  for (const r of rows) {
    const bad = r.compat || r.editorPages !== r.wordPages || r.pages.some((p) => p.match === 'differs');
    if (bad) ok = false;
    console.log(`\n${r.id}: editor ${r.editorPages} pages, Word ${r.wordPages} pages, ${r.lines.same} of ${r.lines.total} lines identical, compatibility mode ${r.compat ? 'ON' : 'off'} ${bad ? 'FAIL' : 'ok'}`);
    console.log('| page | editor first line | Word first line | |');
    for (const p of r.pages) console.log(`| ${p.page} | ${p.editor.slice(0, 60)} | ${p.word.slice(0, 60)} | ${p.match} |`);
  }
  fs.writeFileSync(path.join(from, 'word-fidelity.json'), JSON.stringify(rows, null, 2) + '\n');
  if (!ok) process.exitCode = 1;
};
main();
