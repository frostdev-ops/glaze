// Do other PDF readers see what Glaze writes? Builds the fixture corpus (scripts/pdf-fixtures.js), saves and bakes each
// file with lib/pdf-doc.js as the editor and the pages panel do, then reads every output in pdf.js, in Poppler (pdfinfo,
// pdftotext, pdftoppm, pdfsig) and in PDFKit, Preview's engine (a small Swift program compiled in a temporary folder),
// and compares page count, page order (each page's text), rotation and field values with what was asked. Prints a
// table, writes fidelity.json and the outputs to the folder, exits 1 on any difference. macOS; a heavy job, so it runs
// under the machine's heavy-job lock, niced.
// node scripts/pdf-fidelity.js [folder] [--small]   (default folder: a new temporary one; --small: not the 300-page file)
const { spawnSync } = require('node:child_process');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { pathToFileURL } = require('node:url');
const F = require('./pdf-fixtures.js');
const D = require('../lib/pdf-doc.js');

const squash = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

// ---- reading what the readers say ------------------------------------------------------------------------------------
// pdfinfo -f 1 -l N: the page count, each page's turn, whether the file is encrypted and may be printed.
const parseInfo = (text) => ({
  pages: +(/^Pages:\s+(\d+)/m.exec(text)?.[1] ?? NaN),
  rotations: [...text.matchAll(/^Page\s+(\d+) rot:\s+(\d+)/gm)].map((m) => +m[2]),
  encrypted: /^Encrypted:\s+yes/m.test(text),
  printing: !/^Encrypted:.*\bprint:no\b/m.test(text),
});
// pdftotext's text: a form feed ends each page.
const splitPages = (text) => text.split('\f').slice(0, -1).map(squash);

// What a save or a bake should leave: pages as layout() places them, each with its source page's text and turn.
const expectedOf = (sources, slots) => slots.map((s) => {
  if (s.source === 'blank') return { text: '', rotate: s.turn, blank: true };
  const page = sources[s.source].pages[s.page];
  return { text: page.text, rotate: (page.rotate + s.turn) % 360 };
});

// Each column: 'ok', 'n/a' (the reader cannot tell) or what differs. A page's text may hold more than its own (Poppler
// adds the text its annotations draw); a blank page holds none; a page with no text of its own (a scan) tells no order.
// A reader that gives no field values but draws them
// (drawnFields) is checked by the values in its pages' text; a check box draws no text.
const compare = (want, got) => {
  if (got.error) return { pages: got.error, order: '', rotation: '', fields: '' };
  const pages = got.pages.length === want.pages.length ? 'ok' : `${got.pages.length}, not ${want.pages.length}`;
  const same = { text: (a, b, p) => a === b || (b === '' ? !p.blank && typeof a === 'string' : !!a?.includes(b)), rotate: (a, b) => a === b };
  const bad = (key) => want.pages.flatMap((p, i) => (same[key](got.pages[i]?.[key], p[key], p) ? [] : [i + 1]));
  const order = bad('text'), turns = bad('rotate');
  const shown = (list, key) => `pages ${list.slice(0, 4).join(', ')}${list.length > 4 ? '…' : ''}: ${list.slice(0, 2).map((i) => JSON.stringify(got.pages[i - 1]?.[key] ?? null)).join(', ')}`;
  let fields = 'n/a';
  if (want.fields && got.fields) {
    const wrong = Object.entries(want.fields).filter(([k, v]) => got.fields[k] !== v);
    fields = wrong.length ? wrong.map(([k]) => `${k}=${JSON.stringify(got.fields[k] ?? null)}`).join(', ') : 'ok';
  } else if (want.fields && got.drawnFields) {
    const unseen = Object.entries(want.fields).filter(([, v]) => !['', 'Yes', 'Off'].includes(v) && !got.pages.some((p) => p.text?.includes(v)));
    fields = unseen.length ? `not drawn: ${unseen.map(([k]) => k).join(', ')}` : 'drawn';
  } else if (!want.fields) fields = '';
  return { pages, order: order.length ? shown(order, 'text') : 'ok', rotation: turns.length ? shown(turns, 'rotate') : 'ok', fields };
};

const table = (rows) => {
  const head = ['file', 'output', 'reader', 'pages', 'order', 'rotation', 'fields', 'notes'];
  const cell = (s) => String(s ?? '').replace(/\|/g, '\\|');
  return [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${head.map((k) => cell(r[k])).join(' | ')} |`)].join('\n');
};

const notesOf = (want, got) => {
  const notes = [];
  if (want.encrypted !== undefined && got.encrypted !== want.encrypted) notes.push(`encrypted ${got.encrypted}, not ${want.encrypted}`);
  if (want.printing === false && got.printing !== false) notes.push('printing allowed again');
  if (want.notes !== undefined && got.notes !== undefined && got.notes !== want.notes) notes.push(`${got.notes} FreeText, not ${want.notes}`);
  if (want.signatures !== undefined && got.signatures !== undefined && got.signatures !== want.signatures) notes.push(`${got.signatures} signatures, not ${want.signatures}`);
  if (got.drawn === false) notes.push('pdftoppm failed');
  return notes;
};

module.exports = { parseInfo, splitPages, expectedOf, compare, table, notesOf };

// ---- the readers -----------------------------------------------------------------------------------------------------
const PDFKIT = `import Foundation
import PDFKit

// A PDF as Preview reads it: its pages' text, turns and annotation types, its form fields' values, its lock.
let args = CommandLine.arguments
guard args.count >= 2, let doc = PDFDocument(url: URL(fileURLWithPath: args[1])) else {
  print("{\\"error\\":\\"PDFKit cannot open it\\"}")
  exit(0)
}
if doc.isLocked && args.count >= 3 { _ = doc.unlock(withPassword: args[2]) }
var pages: [[String: Any]] = []
var fields: [String: String] = [:]
for i in 0..<doc.pageCount {
  guard let page = doc.page(at: i) else { pages.append(["text": "", "rotate": -1, "annotations": [String]()]); continue }
  var types: [String] = []
  for a in page.annotations {
    types.append(a.type ?? "")
    guard a.type == "Widget", let name = a.fieldName else { continue }
    switch a.widgetFieldType {
    case .button: fields[name] = a.buttonWidgetState == .onState ? a.buttonWidgetStateString : "Off"
    case .text, .choice: fields[name] = a.widgetStringValue ?? ""
    default: break
    }
  }
  pages.append(["text": page.string ?? "", "rotate": page.rotation, "annotations": types])
}
let out: [String: Any] = ["locked": doc.isLocked, "encrypted": doc.isEncrypted, "printing": doc.allowsPrinting, "pages": pages, "fields": fields]
FileHandle.standardOutput.write(try! JSONSerialization.data(withJSONObject: out))
`;

const run = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: 300000, maxBuffer: 256 << 20, ...opts });
  if (r.error) throw r.error;
  return r;
};

const readers = async (tmp) => {
  const root = path.join(__dirname, '..');
  const url = (f) => pathToFileURL(path.join(root, 'lib/pdfjs', f)).href;
  const [log, warn] = [console.log, console.warn];
  console.log = console.warn = () => {}; // pdf.js warns at import that node has no canvas
  let pdfjs;
  try {
    pdfjs = await import(url('pdf.mjs'));
    pdfjs.GlobalWorkerOptions.workerSrc = url('pdf.worker.mjs');
    await import(url('pdf.worker.mjs'));
  } finally { [console.log, console.warn] = [log, warn]; }
  const swift = path.join(tmp, 'pdfkit-read.swift'), binary = path.join(tmp, 'pdfkit-read');
  fs.writeFileSync(swift, PDFKIT);
  const cache = path.join(tmp, 'module-cache');
  const built = run('xcrun', ['swiftc', '-module-cache-path', cache, '-O', '-o', binary, swift],
    { env: { ...process.env, CLANG_MODULE_CACHE_PATH: cache, SWIFT_MODULE_CACHE_PATH: cache } });
  if (built.status !== 0) throw new Error(`swiftc: ${built.stderr}`);

  const pdfjsRead = async (file, password) => {
    let doc;
    try { doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(file)), password, verbosity: 0 }).promise; } catch (e) { return { error: e.name }; }
    try {
      const pages = [];
      let notes = 0;
      for (let n = 1; n <= doc.numPages; n++) {
        const page = await doc.getPage(n);
        pages.push({ text: squash((await page.getTextContent()).items.map((i) => (i.str ?? '') + (i.hasEOL ? ' ' : '')).join('')), rotate: page.rotate });
        notes += (await page.getAnnotations()).filter((a) => a.annotationType === pdfjs.AnnotationType.FREETEXT).length;
      }
      const all = await doc.getFieldObjects();
      const fields = all && Object.fromEntries([...all].filter(([, [f]]) => ['text', 'checkbox', 'combobox', 'radiobutton', 'listbox'].includes(f.type)).map(([k, [f]]) => [k, String(f.value)]));
      const { info } = await doc.getMetadata();
      const permissions = await doc.getPermissions();
      return { pages, fields, notes, encrypted: !!info.EncryptFilterName, printing: !permissions || permissions.has(pdfjs.PermissionFlag.PRINT),
        signatures: (await doc.getSignatures())?.length ?? 0 };
    } finally { await doc.loadingTask.destroy(); }
  };

  const popplerRead = (file, password) => {
    const pw = password ? ['-upw', password] : [];
    const info = run('pdfinfo', [...pw, '-f', '1', '-l', '100000', file]);
    if (info.status !== 0) return { error: squash(info.stderr).slice(0, 60) || `pdfinfo ${info.status}` };
    const facts = parseInfo(info.stdout);
    const text = run('pdftotext', [...pw, file, '-']);
    const texts = splitPages(text.stdout);
    const picture = run('pdftoppm', [...pw, '-r', '12', '-f', '1', '-l', '2', '-png', file, path.join(tmp, 'page')]);
    const sig = run('pdfsig', [...pw, file]);
    const complaints = [info, text, picture].flatMap((r) => r.stderr.split('\n')).filter((l) => /error/i.test(l) && !/NSS/.test(l));
    return { pages: Array.from({ length: facts.pages }, (_, i) => ({ text: texts[i] ?? null, rotate: facts.rotations[i] })), fields: null, drawnFields: true,
      encrypted: facts.encrypted, printing: facts.printing, signatures: (sig.stdout.match(/^Signature #\d+/gm) || []).length,
      drawn: picture.status === 0, complaints: [...new Set(complaints)] };
  };

  const pdfkitRead = (file, password) => {
    const r = run(binary, password ? [file, password] : [file]);
    if (r.status !== 0) return { error: `PDFKit exit ${r.status}` };
    const out = JSON.parse(r.stdout);
    if (out.error) return out;
    if (out.locked) return { error: 'locked' };
    return { pages: out.pages.map((p) => ({ text: squash(p.text), rotate: p.rotate })), fields: out.fields, encrypted: out.encrypted, printing: out.printing,
      notes: out.pages.flatMap((p) => p.annotations).filter((t) => t === 'FreeText').length };
  };
  return { pdfjs, list: [['pdf.js', pdfjsRead], ['Poppler', popplerRead], ['PDFKit', pdfkitRead]] };
};

// ---- the cases -------------------------------------------------------------------------------------------------------
const note = (pageIndex) => ({ annotationType: 3, color: [0, 0, 255], fontSize: 12, value: 'Glaze note', pageIndex, rect: [20, 20, 160, 50], rotation: 0, structTreeParentId: null, id: null });
const CASES = [
  { file: 'three', save: { note: 0 }, bake: [{ op: 'reorder', order: [2, 0, 1] }, { op: 'rotate', pages: [0], by: 90 }, { op: 'duplicate', pages: [1] }, { op: 'blank', at: 2 }] },
  { file: 'rotated', save: { note: 1 }, bake: [{ op: 'rotate', pages: [0, 1, 2, 3], by: 90 }, { op: 'reorder', order: [3, 2, 1, 0] }, { op: 'blank', at: 1 }] },
  { file: 'acroform', save: { fields: { name: 'Grace Hopper', agree: false, term: 'Fall' } }, bake: [{ op: 'reorder', order: [1, 2, 0] }, { op: 'rotate', pages: [2], by: 90 }, { op: 'duplicate', pages: [0] }], fromSaved: true },
  { file: 'hybridXfa', save: { fields: { 'form1[0].name[0]': 'Grace Hopper' } }, bake: [{ op: 'rotate', pages: [0], by: 90 }, { op: 'blank' }], fromSaved: true },
  { file: 'pureXfa', refuse: 'PdfXfaError', save: {}, bake: [] },
  { file: 'signed', save: { note: 0 }, bake: [{ op: 'rotate', pages: [0], by: 90 }], refuse: 'PdfSignedError' },
  { file: 'encrypted', password: F.PASSWORDS.user, save: { note: 0 }, bake: [{ op: 'delete', pages: [0] }, { op: 'rotate', pages: [0], by: 90 }] },
  { file: 'restricted', save: { note: 1 }, bake: [{ op: 'reorder', order: [2, 1, 0] }, { op: 'rotate', pages: [0], by: 90 }] },
  { file: 'scanned', save: { note: 0 }, bake: [{ op: 'duplicate', pages: [0] }, { op: 'rotate', pages: [1], by: 270 }] },
  { file: 'xrefStream', save: { note: 2 }, bake: [{ op: 'reorder', order: [1, 2, 0] }, { op: 'rotate', pages: [0], by: 180 }] },
  { file: 'brokenXref', save: { note: 0 }, bake: [{ op: 'delete', pages: [1] }, { op: 'rotate', pages: [1], by: 90 }] },
  { file: 'three', label: 'merged', bake: [{ op: 'merge', with: 'rotated', at: 1 }, { op: 'merge', with: 'scanned' }, { op: 'rotate', pages: [0], by: 270 }] },
  { file: 'large', large: true, bake: [{ op: 'reorder', order: Array.from({ length: 300 }, (_, i) => 299 - i) }, { op: 'rotate', pages: Array.from({ length: 150 }, (_, i) => i * 2), by: 90 }] },
  { file: 'publicXfa', refuse: 'PdfXfaError', save: {}, bake: [] },
];

const main = async () => {
  const args = process.argv.slice(2);
  const small = args.includes('--small');
  const dir = path.resolve(args.find((a) => !a.startsWith('--')) || fs.mkdtempSync(path.join(os.tmpdir(), 'gz-pdf-fidelity-')));
  fs.mkdirSync(dir, { recursive: true });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gz-pdfkit-'));
  const rows = [];
  let differs = false;
  try {
    for (const tool of ['pdfinfo', 'pdftotext', 'pdftoppm', 'pdfsig']) if (run('which', [tool]).status !== 0) throw new Error(`${tool} is not installed`);
    const { pdfjs, list } = await readers(tmp);
    const pdf = D.use(pdfjs);
    const files = {};
    const fileOf = (name) => {
      const at = path.join(dir, `${name}.pdf`);
      if (!fs.existsSync(at)) {
        if (name === 'publicXfa') return null;
        fs.writeFileSync(at, name === 'large' ? F.large() : F.FIXTURES[name]());
      }
      return files[name] ||= new Uint8Array(fs.readFileSync(at));
    };
    const [pdfjsRead] = list.map(([, read]) => read);
    const factsOf = async (name, bytes, password) => {
      const at = path.join(tmp, `${name}.facts.pdf`);
      fs.writeFileSync(at, bytes);
      return pdfjsRead(at, password);
    };
    // A reader that cannot open the source is not blamed for the outputs: the row says so.
    const baseline = new Map();
    const check = async (label, output, bytes, want, password, extra = {}) => {
      const at = path.join(dir, `${label}-${output}.pdf`);
      fs.writeFileSync(at, bytes);
      for (const [reader, read] of list) {
        const got = await read(at, password);
        const verdict = compare(want, got);
        const notes = [];
        const inherited = got.error && baseline.get(`${label}:${reader}`) === got.error;
        if (inherited) notes.push('as the source');
        if (!got.error) {
          notes.push(...notesOf(want, got));
          if (got.complaints?.length) notes.push(got.complaints.slice(0, 2).map((c) => c.slice(0, 70)).join('; '));
        }
        if (extra.note) notes.push(extra.note);
        const bad = got.error || Object.values(verdict).some((v) => !['', 'ok', 'n/a', 'drawn'].includes(v)) || notes.some((n) => !/^(Syntax|Internal) (Error|Warning)|refused|took/.test(n));
        if (bad && !extra.allowed && !inherited) differs = true;
        rows.push({ file: label, output, reader, ...verdict, notes: notes.join('; ') || (want.notes ? `${want.notes} FreeText` : '') });
      }
    };
    for (const c of CASES) {
      if (c.large && small) continue;
      const source = fileOf(c.file);
      if (!source) { rows.push({ file: c.file, output: 'source', reader: '', pages: 'not fetched', notes: 'no pinned public pure XFA form given' }); continue; }
      const label = c.label || c.file;
      const facts = await factsOf(label, source, c.password);
      const at = path.join(tmp, `${label}.source.pdf`);
      fs.writeFileSync(at, source);
      for (const [reader, read] of list) { const got = await read(at, c.password); if (got.error) baseline.set(`${label}:${reader}`, got.error); }
      // A refusal at open is the case's result; the readers still say what they show of the source.
      let opened;
      try { opened = await pdf.open(source, { password: c.password }); } catch (e) {
        if (e.name !== c.refuse) differs = true;
        await check(label, 'source', source, { pages: facts.pages, fields: null }, c.password, { note: `open refused: ${e.name}`, allowed: e.name === c.refuse });
        continue;
      }
      if (c.refuse === 'PdfXfaError') {
        differs = true;
        rows.push({ file: label, output: 'source', reader: 'lib/pdf-doc.js', pages: `opened, expected ${c.refuse}` });
      }
      let base = source, baseFacts = facts;
      try {
        if (c.save) {
          const { doc } = opened;
          if (c.save.note !== undefined) doc.annotationStorage.setValue('pdfjs_internal_editor_0', note(c.save.note));
          const fields = c.save.fields && await doc.getFieldObjects();
          for (const [name, value] of Object.entries(c.save.fields || {})) doc.annotationStorage.setValue(fields.get(name)[0].id, { value });
          const saved = await pdf.save(doc);
          const want = { pages: facts.pages, fields: facts.fields && { ...facts.fields, ...Object.fromEntries(Object.entries(c.save.fields || {}).map(([k, v]) => [k, v === false ? 'Off' : String(v)])) },
            encrypted: facts.encrypted, printing: facts.printing, notes: c.save.note !== undefined ? facts.notes + 1 : facts.notes, signatures: facts.signatures };
          await check(label, 'saved', saved.bytes, want, c.password);
          if (c.fromSaved) { base = saved.bytes; baseFacts = await factsOf(`${label}-saved`, base, c.password); }
        }
      } finally { await opened.doc.loadingTask.destroy(); }
      if (!c.bake.length) continue;
      const merged = c.bake.filter((o) => o.op === 'merge').map((o) => fileOf(o.with));
      let k = 0;
      const ops = c.bake.map((o) => (o.op === 'merge' ? { ...o, bytes: merged[k++] } : o));
      const started = Date.now();
      let baked;
      try { baked = await pdf.bake(base, ops, { password: c.password }); } catch (e) {
        rows.push({ file: label, output: 'baked', reader: 'lib/pdf-doc.js', pages: `refused: ${e.name}`, notes: e.message });
        if (e.name !== c.refuse) differs = true;
        continue;
      }
      const took = Date.now() - started;
      if (c.refuse) {
        differs = true;
        rows.push({ file: label, output: 'baked', reader: 'lib/pdf-doc.js', pages: `wrote, expected ${c.refuse}` });
      }
      const sources = [baseFacts, ...await Promise.all(merged.map((b, i) => factsOf(`${label}-merge${i}`, b)))];
      const slots = D.layout(baseFacts.pages.length, ops, merged.map((_, i) => sources[i + 1].pages.length));
      const want = { pages: expectedOf(sources, slots), fields: baseFacts.fields, encrypted: baseFacts.encrypted, printing: baseFacts.printing, notes: baseFacts.notes };
      await check(label, 'baked', baked.bytes, want, c.password, { note: `${(baked.bytes.length / 1e6).toFixed(2)} MB, took ${took} ms` });
    }
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  const out = table(rows);
  console.log(out);
  fs.writeFileSync(path.join(dir, 'fidelity.json'), JSON.stringify(rows, null, 2) + '\n');
  fs.writeFileSync(path.join(dir, 'fidelity.md'), out + '\n');
  console.log(`\n${dir}`);
  if (differs) process.exitCode = 1;
};
if (require.main === module) main().catch((e) => { console.error(e.stack || e.message); process.exitCode = 1; });
