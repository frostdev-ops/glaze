// Writer's submit, final review: what a failed, cancelled or interrupted submit leaves behind (the worker's permit, the
// paper's versions, Ultra's own text box and buttons), and the paper's word count as the editor makes it.
const test = require('node:test');
const assert = require('node:assert/strict');

const BLOCK = { align: null, indent: 0, line: null, first: null };
const para = (...content) => ({ type: 'paragraph', attrs: BLOCK, content });
const text = (t, marks) => ({ type: 'text', text: t, ...(marks && { marks }) });

test('F5: a paper\'s words are counted as the status bar counts them, hard breaks and all', () => {
  const S = require('../lib/writer-schema.js'), E = require('../lib/writer-editor.js'), P = require('../lib/writer-papers.js');
  const docs = {
    hardBreak: [para(text('one'), { type: 'hard_break' }, text('two'))],
    marks: [para(text('alpha'), text('beta', [{ type: 'bold' }]))],
    blocks: [para(text('one two')), para(text('three'))],
    footnote: [para(text('word'), { type: 'footnote_ref', attrs: { content: 'a note of four words' } }, text('next'))],
    quote: [{ type: 'blockquote', content: [para(text('quoted words')), para(text('more'), { type: 'hard_break' }, text('lines'))] }],
  };
  for (const [name, content] of Object.entries(docs)) {
    const json = { type: 'doc', content };
    assert.equal(P.measure(json).words, E.words(S.text(S.paper.nodeFromJSON(json)).text), name);
  }
});

const page = require('./helpers/writer-submit-page.cjs');
const L = require('../lib/writer-submit.js');
const done = (p) => p.sent.filter((m) => m.type === 'submit:done').map((m) => (m.ok ? 'ok' : m.error));

test('D9: once Writer has clicked Ultra\'s Submit, Ultra\'s Save and Close works again (after the paper saves)', async () => {
  const p = page();
  await p.go();
  assert.deepEqual(done(p), ['ok']);
  // Ultra's confirmation, cancelled: the student is back on the attempt and presses Save and Close.
  const save = L.footer(p.box.editor).save;
  save.disabled = false; save.removeAttribute('disabled'); save.className = '';
  p.fire(save, 'click');
  const asked = p.sent.filter((m) => m.type === 'submit:save');
  assert.equal(asked.length, 1, 'the paper is saved first, as before any submit');
  p.hear({ type: 'submit:saved', request: asked[0].request, ok: true });
  assert.equal(p.clicks.filter((b) => b === save).length, 1, 'then Ultra\'s own Save and Close goes on');
});

// The frame between its ready (the page is armed and catches Ultra's file area and Submit) and the paper's mount.
const early = (file) => {
  const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
  const { El } = require('./stand-in-dom.js'), I = require('../lib/i18n.js');
  const doc = { activeElement: null }, handles = {}, hooks = {}, opened = [], timers = [];
  doc.root = new El('html', doc); doc.documentElement = doc.root;
  doc.body = new El('body', doc); doc.root.append(doc.body); doc.body.append(new El('main', doc));
  for (const n of ['querySelector', 'querySelectorAll', 'addEventListener', 'removeEventListener', 'dispatchEvent']) doc[n] = El.prototype[n].bind(doc.root);
  doc.createElement = (tag) => new El(tag, doc);
  doc.createElementNS = (ns, tag) => new El(tag, doc);
  let current = null;
  const ctx = vm.createContext({ document: doc, console, Intl, File, TextDecoder, Uint8Array, ArrayBuffer,
    setTimeout: (f) => { timers.push(f); return timers.length; }, clearTimeout: () => {},
    GZ_WRITER_FRAME: { t: (k, v) => I.t(k, v, 'en'), mode: () => 'paper', kind: () => 'assignment', say: () => {}, handle: (k, f) => { handles[k] = f; }, on: (k, f) => { hooks[k] = f; } },
    GZ_WRITER_PAPER: { current: () => current, need: async () => {} }, GZ_WRITER_SUBMIT_LIB: L });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), ctx);
  const flush = async () => { for (let i = 0; i < 20; i++) await new Promise(setImmediate); };
  const later = async () => { for (const f of timers.splice(0)) f(); await flush(); };
  return { ctx, doc, handles, opened, flush, later, mount: (api) => { current = api; } };
};

test('D8: a file handed over from Ultra\'s file area before the paper has mounted waits for it, never dropped', async () => {
  const f = early('writer-import.js');
  const opened = [];
  f.ctx.GZ_WRITER_SUBMIT_SHEET = { open: (api, file) => opened.push(file), close: () => {}, busy: () => false };
  f.handles['import:file']({ name: 'Rivera_Essay2.pdf', mime: 'application/pdf', bytes: new Uint8Array([1, 2, 3]).buffer });
  await f.flush(); await f.later();
  f.mount({ notify: () => {}, blank: () => true, importing: () => false });
  await f.later(); await f.later();
  assert.deepEqual(opened.map((x) => x.name), ['Rivera_Essay2.pdf'], 'the file taken from Ultra reaches the submit sheet once the paper is there');
});

test('D8: Ultra\'s Submit pressed before the paper has mounted opens the sheet once it has', async () => {
  const f = early('writer-submit.js');
  f.handles['submit:open']({});
  await f.flush(); await f.later();
  assert.equal(f.ctx.GZ_WRITER_SUBMIT_SHEET.opened(), false);
  const view = { state: { doc: { label: 'x' } } };
  f.mount({ context: () => ({}), paper: () => ({}), key: () => 'k', pages: () => 1, format: () => ({ id: 'mla9' }), editor: { view, text: () => '' },
    docx: () => new Promise(() => {}), version: async () => true, save: async () => true });
  await f.later(); await f.later();
  assert.equal(f.ctx.GZ_WRITER_SUBMIT_SHEET.opened(), true, 'the press was caught from Ultra: the sheet answers it');
});
