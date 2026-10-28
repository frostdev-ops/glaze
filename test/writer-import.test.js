// Glaze Writer's import flow (owner, 2026-10-27): a file the student brings to an assignment's paper is routed (a .docx
// asks Open in Writer or Submit as is; anything else goes straight to the submit sheet as is), Ultra's own file area hands
// one file to the frame before Ultra hears it unless enhance.writerUploads is off, a file submitted as is reaches Ultra's
// upload byte for byte, and an import's Undo brings back the version it kept. In a browser: scripts/writer-submit-check.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const zlib = require('node:zlib');
const { El } = require('./stand-in-dom.js');
const I = require('../lib/i18n.js');
const L = require('../lib/writer-submit.js');
const page = require('./helpers/writer-submit-page.cjs');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const KEY = 'school.blackboard.com|_900_1|_101_1|_7_1';

// A zip of deflated entries, as Word writes them (test/writer-attach.test.js zipOf).
const zipOf = (files) => {
  const parts = [], central = [];
  let offset = 0;
  const le = (...f) => { const b = Buffer.alloc(f.reduce((n, [, w]) => n + w, 0)); let o = 0; for (const [v, w] of f) { w === 2 ? b.writeUInt16LE(v, o) : b.writeUInt32LE(v >>> 0, o); o += w; } return b; };
  for (const [name, text] of Object.entries(files)) {
    const raw = Buffer.from(text), n = Buffer.from(name), data = zlib.deflateRawSync(raw);
    const meta = [[20, 2], [0x800, 2], [8, 2], [0, 2], [0x21, 2], [zlib.crc32(raw), 4], [data.length, 4], [raw.length, 4], [n.length, 2]];
    parts.push(le([0x04034b50, 4], ...meta, [0, 2]), n, data);
    central.push(le([0x02014b50, 4], [20, 2], ...meta, [0, 2], [0, 2], [0, 2], [0, 2], [0, 4], [offset, 4]), n);
    offset += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(central);
  return new Uint8Array(Buffer.concat([...parts, cd, le([0x06054b50, 4], [0, 2], [0, 2], [central.length / 2, 2], [central.length / 2, 2], [cd.length, 4], [offset, 4], [0, 2])]));
};
const docx = (name = 'Rivera_Essay2.docx', pages = 4) => new File([zipOf({ 'word/document.xml': '<w:document/>', 'docProps/app.xml': `<Properties><Pages>${pages}</Pages></Properties>` })], name, { type: DOCX });
const pdf = (name = 'Rivera_Essay2.pdf') => new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 1, 2, 3])], name, { type: 'application/pdf' });

test('a brought file: a .docx asks, anything else is submitted as is under its own name', () => {
  assert.equal(L.route('Rivera_Essay2.docx'), 'choose');
  assert.equal(L.route('ESSAY.DOCX'), 'choose');
  for (const n of ['Rivera_Essay2.pdf', 'essay.doc', 'notes.txt', 'scan.png', 'docx', '']) assert.equal(L.route(n), 'submit', n);
  for (const n of ['Rivera Essay (final).pdf', 'Müller_Aufsatz.docx', 'a.b.c.odt']) assert.ok(L.asIsName(n), n);
  for (const n of ['../a.pdf', 'a\\b.pdf', 'a\u0000.pdf', '..', '', 'x'.repeat(256), null]) assert.equal(L.asIsName(n), false, String(n));
  assert.deepEqual([L.tag('a.pdf'), L.tag('a.Docx'), L.tag('README')], ['PDF', 'DOCX', 'FILE']);
  assert.equal(L.pagesOf('<Properties><Pages>4</Pages></Properties>'), 4);
  assert.equal(L.pagesOf('<Properties></Properties>'), 0);
  assert.deepEqual(L.start({ asis: true }).plan, ['attach', 'submit'], 'as is: nothing of the paper is saved or built');
  assert.deepEqual(L.start({ asis: true, text: true }).plan, ['attach', 'text', 'submit']);
  assert.deepEqual(L.start({ text: true }).plan, ['save', 'docx', 'attach', 'text', 'submit'], 'the paper\'s own submit is unchanged');
});

// Ultra's own file area, through the page's capture listener: whether Ultra hears it is whether the event went on.
const ultra = (settings = { enhance: { writerUploads: true } }) => {
  const p = page({ settings });
  const area = L.areaOf(p.box.editor), zone = L.dropZone(area);
  const drop = (files, target = zone.querySelector('p')) => p.fire(target, 'drop', { dataTransfer: { files } });
  const choose = (files) => { p.input.files = files; p.input.value = 'C:\\fakepath\\x'; return [p.fire(p.input, 'input'), p.fire(p.input, 'change')]; };
  return { ...p, area, zone, drop, choose };
};

test('Ultra\'s file area: one file dropped on it goes to the paper\'s frame, byte for byte, before Ultra hears it', async () => {
  const u = ultra(), f = docx();
  const ev = u.drop([f]);
  assert.equal(ev.stopped, true, 'Ultra never hears the drop');
  assert.equal(ev.defaultPrevented, true, 'the browser never opens the file');
  await u.flush();
  const m = u.sent.find((x) => x.type === 'import:file');
  assert.ok(m, 'the frame is handed the file');
  assert.equal(m.name, 'Rivera_Essay2.docx');
  assert.equal(m.mime, DOCX);
  assert.deepEqual(new Uint8Array(m.bytes), new Uint8Array(await f.arrayBuffer()));
  assert.equal(u.uploads.length, 0, 'Ultra started no upload');
});

test('Ultra\'s file area: a file chosen through its input goes to the frame; the input is emptied so the same file can be chosen again', async () => {
  const u = ultra(), f = pdf();
  const [input, change] = u.choose([f]);
  assert.equal(input.stopped && change.stopped, true, 'neither event reaches Ultra');
  await u.flush();
  assert.deepEqual(u.sent.filter((x) => x.type === 'import:file').map((x) => [x.name, x.mime]), [['Rivera_Essay2.pdf', 'application/pdf']]);
  assert.equal(u.input.value, '');
});

test('Ultra\'s file area off (enhance.writerUploads): drops and choices are Ultra\'s, untouched', async () => {
  const u = ultra({ enhance: { writerUploads: false } });
  const ev = u.drop([docx()]), [input, change] = u.choose([pdf()]);
  await u.flush();
  assert.equal(!!(ev.stopped || ev.defaultPrevented || input.stopped || change.stopped), false);
  assert.equal(u.sent.some((x) => x.type === 'import:file'), false);
  assert.equal(u.input.value, 'C:\\fakepath\\x');
});

test('Ultra\'s file area: more than one file, a drop outside it, or a box Writer no longer owns stay Ultra\'s', async () => {
  const u = ultra();
  assert.equal(!!u.drop([docx(), pdf()]).stopped, false, 'two files');
  assert.equal(!!u.drop([docx()], u.box.editor).stopped, false, 'on the editor, not the file area');
  u.own(false);
  assert.equal(!!u.drop([docx()]).stopped, false, 'a box given back');
  await u.flush();
  assert.equal(u.sent.some((x) => x.type === 'import:file'), false);
});

test('Glaze\'s own attach through Ultra\'s input is never caught as the student\'s file', async () => {
  const u = ultra();
  // The input's events pass the page's capture listeners first, as in the DOM.
  u.input.dispatchEvent = (e) => { const ev = u.fire(u.input, e.type); if (!ev.stopped) for (const l of u.input.listeners.filter((x) => x.type === e.type)) l.f({ type: e.type, target: u.input }); return true; };
  await u.go();
  assert.equal(u.sent.some((x) => x.type === 'import:file'), false);
  assert.deepEqual(u.uploads.map((f) => f.name), ['Rivera_Essay2.docx']);
  assert.equal(u.clicks.length, 1);
});

test('submit as is: Ultra gets the file\'s own name, type and bytes, then one Submit; a path for a name is refused', async () => {
  const u = page(), bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 9, 8, 7]);
  await u.go({ asis: true, name: 'Rivera Essay (final).pdf', mime: 'application/pdf', bytes: bytes.slice().buffer, note: 'Attached as a PDF.' });
  assert.equal(u.uploads.length, 1);
  assert.equal(u.uploads[0].name, 'Rivera Essay (final).pdf');
  assert.equal(u.uploads[0].type, 'application/pdf');
  assert.deepEqual(new Uint8Array(await u.uploads[0].arrayBuffer()), bytes);
  assert.equal(u.box.editor.textContent, 'Attached as a PDF.');
  assert.equal(u.clicks.length, 1);
  assert.deepEqual(u.sent.filter((m) => m.type === 'submit:done').map((m) => m.ok), [true]);
  const bad = page();
  await bad.go({ asis: true, name: '../x.pdf', mime: 'application/pdf' });
  assert.equal(bad.uploads.length + bad.clicks.length, 0);
  const old = page();
  await old.go({ name: 'Rivera Essay (final).pdf' });
  assert.equal(old.uploads.length, 0, 'the paper\'s own submit still takes only its Lastname_Title.docx');
});

// The card, in a frame of the stand-in DOM.
const frame = ({ blank = true, busy = false } = {}) => {
  const doc = { activeElement: null }, handles = {}, opened = [], imported = [], notices = [];
  doc.root = new El('html', doc); doc.documentElement = doc.root;
  doc.body = new El('body', doc); doc.root.append(doc.body); doc.body.append(new El('main', doc));
  for (const n of ['querySelector', 'querySelectorAll', 'addEventListener', 'removeEventListener', 'dispatchEvent']) doc[n] = El.prototype[n].bind(doc.root);
  doc.createElement = (tag) => new El(tag, doc);
  doc.createElementNS = (ns, tag) => new El(tag, doc);
  doc.fire = (el, type, more = {}) => { const e = { type, target: el, isTrusted: true, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {}, ...more }; el.dispatchEvent(e); return e; };
  const api = { notify: (k) => notices.push(k), blank: () => blank, importFile: async (f) => { imported.push(f); return { id: 'v1' }; } };
  const sheet = { open: (a, f) => { opened.push(f); }, close: () => {}, busy: () => busy };
  const ctx = vm.createContext({ document: doc, console, Intl, File, TextDecoder, Uint8Array, ArrayBuffer, DecompressionStream, Response, Blob,
    GZ_WRITER_FRAME: { t: (k, v) => I.t(k, v, 'en'), mode: () => 'paper', kind: () => 'assignment', handle: (k, f) => { handles[k] = f; } },
    GZ_WRITER_PAPER: { current: () => api, need: async () => { ctx.GZ_DOCTEXT ||= require('../lib/doctext.js'); } },
    GZ_WRITER_SUBMIT_LIB: L, GZ_WRITER_SUBMIT_SHEET: sheet });
  vm.runInContext(process.env.WRITER_IMPORT_SOURCE ? fs.readFileSync(process.env.WRITER_IMPORT_SOURCE, 'utf8') : read('writer-import.js'), ctx);
  const flush = async () => { for (let i = 0; i < 20; i++) await new Promise(setImmediate); };
  const card = () => doc.querySelector('.gi-card');
  const tiles = () => doc.querySelectorAll('.gi-choice');
  return { doc, ctx, api, handles, opened, imported, notices, flush, card, tiles, I: ctx.GZ_WRITER_IMPORT, key: (key) => doc.fire(doc.querySelector('.gi-layer'), 'keydown', { key, stopPropagation() {} }) };
};

test('the card: a .docx shows its name, pages and size, and Open in Writer (the default, focused for Enter) opens it', async () => {
  const f = frame(), file = docx();
  await f.I.bring(f.api, file); await f.flush();
  assert.ok(f.card(), 'a .docx asks first');
  assert.equal(f.doc.querySelector('.gi-file b').textContent, 'Rivera_Essay2.docx');
  assert.match(f.doc.querySelector('.gi-file small').textContent, /^4 pages · \d+ KB$/);
  const [open, asis] = f.tiles();
  assert.equal(open.querySelector('span').textContent, 'Open in Writer');
  assert.equal(asis.querySelector('span').textContent, 'Submit as is');
  assert.equal(f.doc.activeElement, open, 'Enter takes the default');
  assert.equal(f.doc.querySelector('.gi-kept'), null, 'an empty paper needs no word about saving it');
  f.doc.fire(open, 'click');
  await f.flush();
  assert.deepEqual(f.imported, [file]);
  assert.deepEqual(f.opened, []);
  assert.equal(f.card(), null);
});

test('the card: over a paper with text, Open in Writer says it saves the current paper', async () => {
  const f = frame({ blank: false });
  await f.I.bring(f.api, docx()); await f.flush();
  assert.equal(f.doc.querySelector('.gi-kept').textContent, 'Saves current paper');
});

test('the card: Submit as is opens the submit sheet with the file; close, Escape and the dim do nothing', async () => {
  const f = frame(), file = docx();
  await f.I.bring(f.api, file); await f.flush();
  f.doc.fire(f.tiles()[1], 'click');
  assert.deepEqual(f.opened, [file]);
  assert.deepEqual(f.imported, []);
  for (const how of ['.gi-x', 'Escape', '.gi-dim']) {
    await f.I.bring(f.api, docx()); await f.flush();
    if (how === 'Escape') f.key('Escape'); else f.doc.fire(f.doc.querySelector(how), 'click');
    assert.equal(f.card(), null, how);
  }
  assert.equal(f.opened.length + f.imported.length, 1, 'nothing more happened');
  assert.equal(!!f.doc.querySelector('main').inert, false, 'the paper is live again');
});

test('a file Writer can\'t open (a PDF, anything not .docx) goes straight to the submit sheet as is, with no card', async () => {
  const f = frame(), file = pdf();
  await f.I.bring(f.api, file); await f.flush();
  assert.equal(f.card(), null);
  assert.deepEqual(f.opened, [file]);
  const busy = frame({ busy: true });
  await busy.I.bring(busy.api, docx()); await busy.flush();
  assert.equal(busy.card() || busy.opened.length, 0, 'a sheet already submitting keeps going');
});

test('the page\'s import:file becomes the routed file', async () => {
  const f = frame(), bytes = await pdf().arrayBuffer();
  f.handles['import:file']({ name: 'Rivera_Essay2.pdf', mime: 'application/pdf', bytes });
  await f.flush();
  assert.equal(f.opened.length, 1);
  assert.equal(f.opened[0].name, 'Rivera_Essay2.pdf');
  assert.equal(f.opened[0].type, 'application/pdf');
  assert.deepEqual(new Uint8Array(await f.opened[0].arrayBuffer()), new Uint8Array(bytes));
  f.handles['import:file']({ name: 'x.pdf', bytes: 'not bytes' });
  await f.flush();
  assert.equal(f.opened.length, 1);
});

// writer-paper.js importFile itself, with the paper's store and editor stood in.
const importer = ({ key = 'k' } = {}) => {
  const source = process.env.WRITER_PAPER_SOURCE ? fs.readFileSync(process.env.WRITER_PAPER_SOURCE, 'utf8') : read('writer-paper.js'), start = source.indexOf('    // The paper becomes the Word file'), end = source.indexOf("    file.addEventListener('change'", start);
  const toasts = [], restored = [], saved = [];
  const fn = vm.runInNewContext(`${source.slice(start, end)} importFile`, {
    RangeError, ArrayBuffer, Uint8Array, console, current: null, api: null, view: { state: { doc: {} }, props: {}, setProps() {}, focus() {} }, need: async () => {}, DOCX: [], format: {}, key, root: { isConnected: true },
    GZ_WRITER_DOCX: { importDocx: async () => ({ doc: { type: 'doc' }, html: '<p>Essay</p>', warnings: [] }) }, S: { paper: { nodeFromJSON: (json) => ({ toJSON: () => json }) } }, ownFormatting: () => false,
    save: async () => true, record: () => ({}), setDoc: () => {}, paper: null,
    store: { save: async (k, p, o) => { saved.push(o.reason); return { paper: {}, version: { id: 'before-import' } }; } },
    t: (k) => I.t(k, {}, 'en'), toast: (text, act) => toasts.push({ text, act }), restore: (id) => restored.push(id),
  });
  return { fn, toasts, restored, saved };
};

test('Open in Writer: the paper before is kept as a version, the toast names the file, and its Undo restores that version', async () => {
  const x = importer();
  const v = await x.fn({ name: 'Rivera_Essay2.docx', size: 4, arrayBuffer: async () => new ArrayBuffer(4) });
  assert.deepEqual(x.saved, ['import']);
  assert.equal(v.id, 'before-import');
  assert.equal(x.toasts.length, 1);
  assert.equal(x.toasts[0].text, 'Rivera_Essay2.docx');
  assert.equal(x.toasts[0].act.label, 'Undo');
  x.toasts[0].act.run();
  assert.deepEqual(x.restored, ['before-import']);
  const none = importer({ key: null });
  await none.fn({ name: 'a.docx', size: 4, arrayBuffer: async () => new ArrayBuffer(4) });
  assert.equal(none.toasts[0].act, null, 'no saved version, no Undo');
});

test('Settings → Writer has the uploads switch, on by default, beside Glaze Writer', () => {
  const D = require('../defaults.js');
  assert.equal(D.GZ_DEFAULTS.enhance.writerUploads, true);
  const html = read('options.html');
  const at = html.indexOf('data-key="enhance.writer"'), up = html.indexOf('data-key="enhance.writerUploads"');
  assert.ok(at > 0 && up > at && up - at < 1500, 'right after Glaze Writer');
  for (const lang of ['de', 'es', 'fr', 'nl', 'pt-BR']) for (const k of ['Open uploads in Writer', 'Open in Writer', 'Submit as is', 'Saves current paper', 'Import…', 'That file could not be read.', 'That file is too large.']) assert.notEqual(I.t(k, {}, lang), k, `${lang}: ${k}`);
});

// Keep each deferred read tied to the input, box and frame that caught it.
const deferredFile = (name = 'first.pdf') => {
  let resolve;
  const bytes = new Uint8Array([1, 2, 3]).buffer;
  const file = { name, type: 'application/pdf', size: bytes.byteLength, arrayBuffer: () => new Promise((r) => { resolve = r; }) };
  return { file, finish: () => resolve(bytes) };
};
test('review: a later caught file wins even when the first read finishes last', async () => {
  const u = ultra(), first = deferredFile(), second = deferredFile('second.pdf');
  u.drop([first.file]); u.drop([second.file]);
  second.finish(); await u.flush(); first.finish(); await u.flush();
  assert.deepEqual(u.sent.filter((m) => m.type === 'import:file').map((m) => m.name), ['second.pdf']);
});
for (const change of ['frame', 'port', 'unmounted', 'setting']) test(`review: a caught read cannot cross a changed ${change}`, async () => {
  const settings = { enhance: { writerUploads: true } }, u = ultra(settings), f = deferredFile();
  u.drop([f.file]);
  if (change === 'frame') { u.box.frame.remove(); u.box.frame = new El('iframe', u.doc); u.doc.body.append(u.box.frame); }
  if (change === 'port') u.box.port = { postMessage: (m) => u.sent.push(m) };
  if (change === 'unmounted') u.box.ready = false;
  if (change === 'setting') settings.enhance.writerUploads = false;
  f.finish(); await u.flush();
  assert.equal(u.sent.some((m) => m.type === 'import:file'), false);
});
test('review: a paper without a mounted frame leaves the upload area to Ultra', () => {
  const u = ultra(); u.box.frame.remove(); u.box.ready = false;
  assert.equal(!!u.drop([pdf()]).stopped, false);
});
test('review: a different file input in the submission is outside the attempt upload area', () => {
  const u = ultra(), other = new El('input', u.doc); other.setAttribute('type', 'file'); other.files = [pdf()]; u.area.append(other);
  assert.equal(!!u.fire(other, 'change').stopped, false);
});

for (const change of ['frame', 'port']) test(`review: an as-is upload stops before Submit when its ${change} changes`, async () => {
  const u = page({ listed: false });
  await u.go({ asis: true, name: 'original.pdf', mime: 'application/pdf' });
  assert.equal(u.uploads.length, 1);
  if (change === 'frame') { u.box.frame.remove(); u.box.frame = new El('iframe', u.doc); u.doc.body.append(u.box.frame); }
  else u.box.port = { postMessage: (m) => u.sent.push(m) };
  u.addRow('original.pdf'); await u.tick();
  assert.equal(u.clicks.length, 0, 'the old frame no longer holds consent');
});

test('review: a slow earlier bring cannot replace the second file card', async () => {
  const f = frame(), pending = [];
  f.ctx.GZ_WRITER_PAPER.need = () => new Promise((r) => pending.push(r));
  const first = f.I.bring(f.api, docx('first.docx')), second = f.I.bring(f.api, pdf('second.pdf'));
  pending[1](); await second; pending[0](); await first;
  assert.equal(f.card(), null);
  assert.deepEqual(f.opened.map((x) => x.name), ['second.pdf']);
});
test('review: a bring awaiting libraries cannot dismiss a sheet that starts submitting', async () => {
  const f = frame(); let finish, busy = false, closed = 0;
  f.ctx.GZ_WRITER_PAPER.need = () => new Promise((r) => { finish = r; });
  f.ctx.GZ_WRITER_SUBMIT_SHEET.busy = () => busy;
  f.ctx.GZ_WRITER_SUBMIT_SHEET.close = () => { closed++; };
  const bringing = f.I.bring(f.api, pdf()); busy = true; finish(); await bringing;
  assert.equal(closed + f.opened.length, 0);
});
test('review: closing import cancels a pending bring without reopening a modal', async () => {
  const f = frame(); let finish;
  f.ctx.GZ_WRITER_PAPER.need = () => new Promise((r) => { finish = r; });
  const bringing = f.I.bring(f.api, docx()); f.I.close(); finish(); await bringing;
  assert.equal(f.card(), null);
});

test('review: oversized, empty and invalid-name local files never open a modal or read bytes', async () => {
  const f = frame(); let reads = 0;
  for (const meta of [{ name: 'huge.pdf', size: 50e6 + 1 }, { name: 'empty.pdf', size: 0 }, { name: '../paper.docx', size: 3 }]) {
    await f.I.bring(f.api, { type: 'application/pdf', ...meta, arrayBuffer: async () => { reads++; return new ArrayBuffer(3); } });
  }
  assert.equal(f.opened.length + Number(!!f.card()) + reads, 0);
  assert.equal(f.notices.length, 3, 'the student gets an explanation');
});
test('review: malformed import messages are refused before constructing a file', async () => {
  const f = frame();
  for (const m of [{ name: '../a.pdf', bytes: new ArrayBuffer(3) }, { name: 'a.pdf', bytes: new ArrayBuffer(0) }, { name: 'a.pdf', bytes: new ArrayBuffer(3), mime: 'x'.repeat(201) }]) f.handles['import:file'](m);
  await f.flush(); assert.equal(f.opened.length, 0);
});
test('review: captured metadata and read results are bounded before posting to the frame', async () => {
  const u = ultra();
  for (const file of [{ name: 'a.pdf', size: 0 }, { name: '../a.pdf', size: 3 }, { name: 'a.pdf', size: 3, type: 'x'.repeat(201) }]) {
    assert.equal(!!u.drop([{ type: 'application/pdf', arrayBuffer: async () => new ArrayBuffer(3), ...file }]).stopped, false);
  }
  u.drop([{ name: 'bad.pdf', size: 3, type: 'application/pdf', arrayBuffer: async () => new ArrayBuffer(4) }]);
  await u.flush(); assert.equal(u.sent.some((m) => m.type === 'import:file'), false);
});

for (const action of ['replace', 'close']) test(`review: a pending page handoff cannot reopen after ${action}`, async () => {
  const f = frame(), pending = []; let calls = 0;
  f.ctx.GZ_WRITER_PAPER.need = () => ++calls <= (action === 'replace' ? 2 : 1) ? new Promise((r) => pending.push(r)) : Promise.resolve();
  const first = f.handles['import:file']({ name: 'first.pdf', mime: 'application/pdf', bytes: new ArrayBuffer(3) });
  if (action === 'replace') { const second = f.I.bring(f.api, pdf('second.pdf')); pending[1](); await second; }
  else f.I.close();
  pending[0](); await first; await f.flush();
  assert.deepEqual(f.opened.map((x) => x.name), action === 'replace' ? ['second.pdf'] : []);
});

test('review: two mounted attempts route only their own upload files', async () => {
  const u = ultra(), sent = [], panel = new El('bb-assignment-attempt-authoring-panel', u.doc), area = new El('div', u.doc);
  area.className = 'makeStylessubmission-2'; panel.append(area); u.doc.body.append(panel);
  const editor = new El('div', u.doc), frame = new El('iframe', u.doc), zone = new El('div', u.doc), input = new El('input', u.doc);
  zone.className = 'makeStylesinputContainer-2'; input.setAttribute('type', 'file'); zone.append(input); area.append(editor, frame, zone);
  const second = { ...u.box, editor, frame, port: { postMessage: (m) => sent.push(m) } };
  u.ctx.GZ_WRITER_SUBMIT.hear(second, { type: 'submit:arm' }, { settings: () => ({ enhance: { writerUploads: true } }) }, () => true);
  const first = deferredFile(), next = deferredFile('second.pdf');
  u.drop([first.file]); u.fire(zone, 'drop', { dataTransfer: { files: [next.file] } });
  next.finish(); first.finish(); await u.flush();
  assert.deepEqual(u.sent.filter((m) => m.type === 'import:file').map((m) => m.name), ['first.pdf']);
  assert.deepEqual(sent.filter((m) => m.type === 'import:file').map((m) => m.name), ['second.pdf']);
});
test('review: replacing an open card keeps one modal and its keyboard loop', async () => {
  const f = frame(); await f.I.bring(f.api, docx('first.docx')); await f.I.bring(f.api, docx('second.docx'));
  assert.equal(f.doc.querySelectorAll('.gi-card').length, 1);
  assert.equal(f.doc.querySelector('.gi-file b').textContent, 'second.docx');
  for (let i = 0; i < 8; i++) { f.key('Tab'); assert.ok(f.doc.activeElement.closest('.gi-card')); }
  f.doc.fire(f.doc.querySelector('.gi-layer'), 'keydown', { key: 'Tab', shiftKey: true });
  assert.ok(f.doc.activeElement.closest('.gi-card'));
  f.key('Escape'); assert.equal(f.doc.querySelector('main').inert, undefined);
});
