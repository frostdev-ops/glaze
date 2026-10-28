// Writer's final review, paste and editor commands: rich paste keeps a list's numbers, a heading's left alignment and text
// direction; every picture in a paper is one Word takes; commands reach every selected table cell; a paper's tabs survive
// its own HTML; a footnote is never cut inside its markup; the link field keeps the schema's one rule for addresses.
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../lib/writer-schema.js');
const P = require('../writer-paste.js');
const OBJ = require('../lib/writer-objects.js');

const read = (html) => S.paper.topNodeType.create(null, S.slice(S.paper, html).content);
const paste = (html, o) => read(P.normalize(html, o).html);
// Each ordered item's number as the page draws it: every list counts from 1, an item at a level counts on that level
// and starts the deeper ones again, and an item's start sets its own.
const numbers = (doc) => {
  const out = [];
  doc.forEach((list) => {
    if (list.type.name !== 'ordered_list') return;
    const styles = OBJ.levelStyles(list), count = [];
    list.forEach((li) => {
      const lv = li.attrs.indent || 0;
      count[lv] = li.attrs.start ?? (count[lv] || 0) + 1;
      count.length = lv + 1;
      out.push(`${OBJ.marker(styles[lv], count[lv])} ${li.textContent}`);
    });
  });
  return out;
};
const wordItem = (list, mark, text, level = 1) => `<p class=MsoListParagraph style='margin-left:${0.5 * level}in;text-indent:-.25in;mso-list:${list} level${level} ${list.replace('l', 'lfo')}'><![if !supportLists]><span style='mso-list:Ignore'>${mark}<span style='font:7.0pt "Times New Roman"'>&nbsp;&nbsp;&nbsp; </span></span><![endif]>${text}<o:p></o:p></p>`;
const word = (body) => `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta name=Generator content="Microsoft Word 15"></head><body lang=EN-US><div class=WordSection1>${body}</div></body></html>`;

test('A1: a pasted list keeps its opening number: <ol start>, and Word\'s own markers', () => {
  assert.deepEqual(numbers(paste('<html><body><ol start="4"><li>four</li><li>five</li></ol></body></html>')), ['4 four', '5 five']);
  assert.deepEqual(numbers(paste('<meta charset="utf-8"><b id="docs-internal-guid-1"><ol start="4"><li dir="ltr"><p dir="ltr"><span>four</span></p></li><li dir="ltr"><p dir="ltr"><span>five</span></p></li></ol></b>')), ['4 four', '5 five']);
  assert.deepEqual(numbers(paste(word(wordItem('l0', '4.', 'four') + wordItem('l0', '5.', 'five')))), ['4 four', '5 five']);
  // A list a paragraph interrupts goes on from Word's number.
  assert.deepEqual(numbers(paste(word(wordItem('l0', '1.', 'one') + '<p class=MsoNormal>Between<o:p></o:p></p>' + wordItem('l0', '2.', 'two')))), ['1 one', '2 two']);
  // The schema reads <ol start> itself too, where no paste normaliser stands in front.
  assert.deepEqual(numbers(read('<ol start="7"><li>seven</li><li>eight</li></ol>')), ['7 seven', '8 eight']);
  // A plain list is unchanged: no restart anywhere.
  const plain = paste('<html><body><ol><li>a</li><li>b</li></ol></body></html>');
  assert.deepEqual(numbers(plain), ['1 a', '2 b']);
  plain.descendants((n) => { if (n.type.name === 'list_item') assert.equal(n.attrs.start, null); });
});

test('A2: adjacent pasted lists stay two lists, each numbered as it was', () => {
  const two = paste(word(wordItem('l0', '1.', 'first A') + wordItem('l0', '2.', 'first B') + wordItem('l1', 'a)', 'second A') + wordItem('l1', 'b)', 'second B')));
  assert.deepEqual(numbers(two), ['1 first A', '2 first B', 'a second A', 'b second B']);
  assert.deepEqual(numbers(paste(word(wordItem('l0', '1.', 'A') + wordItem('l0', '2.', 'B') + wordItem('l1', '1.', 'C') + wordItem('l1', '2.', 'D')))), ['1 A', '2 B', '1 C', '2 D']);
  assert.deepEqual(numbers(paste('<html><body><ol><li>A</li><li>B</li></ol><ol><li>C</li><li>D</li></ol></body></html>')), ['1 A', '2 B', '1 C', '2 D']);
  // One Word list over two levels stays one list, its levels in their own styles.
  const nested = paste(word(wordItem('l0', '1.', 'top') + wordItem('l0', 'a.', 'sub', 2) + wordItem('l0', 'b.', 'sub two', 2) + wordItem('l0', '2.', 'top two')));
  assert.equal(nested.childCount, 1);
  assert.deepEqual(numbers(nested), ['1 top', 'a sub', 'b sub two', '2 top two']);
  assert.deepEqual(numbers(paste(word(wordItem('l0', 'I.', 'one') + wordItem('l0', 'II.', 'two')))), ['I one', 'II two']);
});

test('A3: a pasted heading keeps an explicit left alignment the format would centre; a paragraph\'s left stays the default', () => {
  assert.equal(paste('<html><body><h1 style="text-align:left">Left title</h1></body></html>').firstChild.attrs.align, 'left');
  assert.equal(paste('<html><body><h2 align="left">Left two</h2></body></html>').firstChild.attrs.align, 'left');
  assert.equal(paste(word("<h1 style='text-align:left'>Word left<o:p></o:p></h1>")).firstChild.attrs.align, 'left');
  assert.equal(paste('<html><body><h1 style="text-align:right">Right</h1></body></html>').firstChild.attrs.align, 'right');
  assert.equal(paste('<html><body><h1>Plain</h1></body></html>').firstChild.attrs.align, null);
  assert.equal(paste('<html><body><p style="text-align:left">Body</p></body></html>').firstChild.attrs.align, null);
  assert.equal(paste('<html><body><h1 style="text-align:left">Matched</h1></body></html>', { match: true }).firstChild.attrs.align, null, 'Match the paper takes it away');
});

test('A4: pasted text keeps its direction: a block\'s and a run\'s, from a page, Word and Docs', () => {
  const runDirs = (doc) => { const out = []; doc.descendants((n) => { if (n.isText) out.push([n.text, n.marks.find((m) => m.type.name === 'direction')?.attrs.dir ?? null]); }); return out; };
  assert.equal(paste('<html><body><p dir="rtl">مرحبا بالعالم</p></body></html>').firstChild.attrs.dir, 'rtl');
  assert.deepEqual(runDirs(paste('<html><body><p>English <span dir="rtl">مرحبا</span> end</p></body></html>')), [['English ', null], ['مرحبا', 'rtl'], [' end', null]]);
  const w = paste(word("<p class=MsoNormal dir=RTL style='text-align:right;direction:rtl;unicode-bidi:embed'><span lang=AR-SA dir=RTL>مرحبا</span></p>"));
  assert.equal(w.firstChild.attrs.dir, 'rtl');
  assert.deepEqual(runDirs(w), [['مرحبا', null]], 'a run in its paragraph\'s own direction needs no mark');
  assert.equal(paste('<meta charset="utf-8"><b id="docs-internal-guid-1"><p dir="rtl" style="text-align:right"><span>مرحبا</span></p></b>').firstChild.attrs.dir, 'rtl');
  assert.equal(paste('<html><body><ul><li dir="rtl">بند</li></ul></body></html>').firstChild.firstChild.attrs.dir, 'rtl');
  assert.deepEqual(runDirs(paste('<html><body><p dir="rtl">عربي <span dir="ltr">English</span></p></body></html>')), [['عربي ', null], ['English', 'ltr']]);
  // Docs marks every block ltr: that is the paper's own direction, so nothing is set and nothing counts as formatting.
  const docs = P.normalize('<meta charset="utf-8"><b id="docs-internal-guid-1"><p dir="ltr"><span>Plain</span></p></b>');
  assert.equal(read(docs.html).firstChild.attrs.dir, null);
  assert.equal(docs.rich, false);
  assert.equal(paste('<html><body><p dir="rtl">مطابق</p></body></html>', { match: true }).firstChild.attrs.dir, 'rtl', 'direction is the text\'s, not formatting Match the paper takes away');
});

// ---- B20: several table cells selected
const E = require('../lib/writer-editor.js');
const cellsState = () => {
  const base = E.state({ mode: 'paper', html: '<p>Before</p><table><tr><td><p>A1</p></td><td><p>B1</p></td></tr><tr><td><p>A2</p></td><td><p>B2</p></td></tr></table><p>After</p>' });
  const cells = [];
  base.doc.descendants((n, pos) => { if (n.type.name === 'table_cell') cells.push(pos); });
  return base.apply(base.tr.setSelection(GZ_PM.tables.CellSelection.create(base.doc, cells[0], cells[3])));
};
const cellBlocks = (doc) => { const out = []; doc.descendants((n) => { if (n.type.name !== 'table_cell') return true; n.descendants((x) => { if (x.isTextblock) out.push(x); return !x.isTextblock; }); return false; }); return out; };
const runCmd = (st, name, arg) => { let out = null; E.commands(S.paper)[name](arg)(st, (tr) => { out = st.apply(tr); }); return out; };

test('B20: paragraph and run commands reach every selected cell', () => {
  const st = cellsState();
  assert.deepEqual(cellBlocks(runCmd(st, 'align', 'center').doc).map((n) => n.attrs.align), ['center', 'center', 'center', 'center']);
  assert.deepEqual(cellBlocks(runCmd(st, 'paragraph', { before: 12 }).doc).map((n) => n.attrs.before), [12, 12, 12, 12]);
  assert.deepEqual(cellBlocks(runCmd(st, 'lineSpacing', 2).doc).map((n) => n.attrs.line), [2, 2, 2, 2]);
  assert.deepEqual(cellBlocks(runCmd(st, 'bulletList').doc).map((n) => n.type.name), ['list_item', 'list_item', 'list_item', 'list_item']);
  assert.deepEqual(cellBlocks(runCmd(st, 'heading', 2).doc).map((n) => n.type.name), ['heading', 'heading', 'heading', 'heading']);
  const red = runCmd(st, 'color', 'C00000');
  assert.deepEqual(cellBlocks(red.doc).map((n) => n.firstChild.marks.map((m) => m.attrs.color)), [['C00000'], ['C00000'], ['C00000'], ['C00000']]);
  assert.deepEqual(cellBlocks(runCmd(st, 'font', 'Arial').doc).map((n) => n.firstChild.marks.map((m) => m.attrs.font)), [['Arial'], ['Arial'], ['Arial'], ['Arial']]);
  const cleared = runCmd(red.apply(red.tr.setSelection(GZ_PM.tables.CellSelection.create(red.doc, st.selection.$anchorCell.pos, st.selection.$headCell.pos))), 'clear');
  assert.deepEqual(cellBlocks(cleared.doc).map((n) => n.firstChild.marks.length), [0, 0, 0, 0]);
  // Outside the table nothing moves.
  assert.equal(runCmd(st, 'align', 'center').doc.firstChild.attrs.align, null);
});

test('B20: Tab with several cells selected never replaces them', () => {
  const st = cellsState();
  let out = st;
  E.bindings(S.paper).Tab(st, (tr) => { out = st.apply(tr); });
  assert.deepEqual(cellBlocks(out.doc).map((n) => n.textContent), ['A1', 'B1', 'A2', 'B2']);
  E.bindings(S.paper)['Shift-Tab'](st, (tr) => { out = st.apply(tr); });
  assert.deepEqual(cellBlocks(out.doc).map((n) => n.textContent), ['A1', 'B1', 'A2', 'B2']);
  // In a paragraph Tab still types a tab.
  let one = E.state({ mode: 'paper', html: '<p>x</p>' });
  one = one.apply(one.tr.setSelection(GZ_PM.state.TextSelection.create(one.doc, 1)));
  E.bindings(S.paper).Tab(one, (tr) => { one = one.apply(tr); });
  assert.equal(one.doc.textContent, '\tx');
});

// ---- B21: tabs through HTML
// What a paste in a paper does: writer-paste.js's normalize (api.before), then the editor's transformPastedHTML
// (S.slice, serialize) and clipboardParser (S.slice of that HTML).
const pasteInPaper = (html) => {
  const once = S.serialize(S.paper, S.paper.topNodeType.create(null, S.slice(S.paper, P.normalize(html).html).content));
  const c = S.slice(S.paper, once).content;
  return c.textBetween(0, c.size, '\n');
};
const tabbed = ['\tIndented with a tab, as students indent by hand', 'Name\t\tDate', 'Total:\t42', 'Ends\t', 'Gap \t here', '\t\t'];

test('B21: a paper\'s tabs survive its own clipboard and its own HTML', () => {
  for (const text of tabbed) {
    // ProseMirror's clipboard HTML: the paper schema's toDOM, text as it is, data-pm-slice on the first element.
    assert.equal(pasteInPaper(`<p data-pm-slice="1 1 []">${text}</p>`), text, JSON.stringify(text));
    const doc = S.paper.node('doc', null, [S.paper.node('paragraph', null, [S.paper.text(text)])]);
    assert.ok(S.parse(S.paper, S.serialize(S.paper, doc), { document: true }).eq(doc), `serialize → parse: ${JSON.stringify(text)}`);
  }
  const note = S.paper.node('footnote_ref', { content: S.inline('Ibid.\t12') });
  assert.equal(note.attrs.content, 'Ibid.\t12');
});

test('B21: a page\'s tabs are spaces as the page shows them, unless its white-space keeps them', () => {
  assert.equal(pasteInPaper('<html><body><p>\n\t\tHello\n\t</p></body></html>'), 'Hello');
  assert.equal(pasteInPaper('<html><body><table><tr><td>\t\tvalue\t</td></tr></table></body></html>'), 'value');
  assert.equal(pasteInPaper('<html><body><p>Name\t\tDate</p></body></html>'), 'Name Date');
  assert.equal(pasteInPaper('<html><body><p>Name<span style="white-space:pre">\t</span>Date</p></body></html>'), 'Name\tDate');
  // Compose holds what Ultra's Quill 1.3.7 keeps: one tab between words, no runs, none at an edge.
  assert.equal(S.parse(S.compose, '<p>tab\there</p>').textContent, 'tab\there');
  assert.equal(S.parse(S.compose, '<p>\tTabbed\t\tcolumns</p>').textContent, 'Tabbed columns');
});

test('B24: a footnote is never cut: a long note keeps its end, and no markup becomes its text', () => {
  const words = Array.from({ length: 2500 }, (_, i) => (i % 10 === 9 ? `<em>Title${i}</em>` : `word${i}`)).join(' ');
  const plain = words.replace(/<[^>]+>/g, '');
  const out = S.inline(words);
  assert.equal(out.replace(/<[^>]+>/g, '').length, plain.length, 'every character of the note');
  assert.ok(out.endsWith('<em>Title2499</em>'), out.slice(-60));
  const pad = `${'x'.repeat(19990)}<a href="https://example.com/">link</a> end`;
  const cut = S.inline(pad);
  assert.ok(cut.endsWith('<a href="https://example.com/" rel="noopener noreferrer" target="_blank">link</a> end'), cut.slice(-80));
  assert.doesNotMatch(cut, /&lt;/);
  // The bound is the one every other reader of a note's HTML has: the clipboard's input limit, refused whole.
  assert.throws(() => S.inline('x'.repeat(S.MAX_INPUT)), (e) => e.code === 'WRITER_INPUT_LIMIT');
});

// ---- F6: writer.js's link field, in the stand-in DOM writer-frame.test.js runs it in
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { El } = require('./stand-in-dom.js');
const { parse: parseDOM } = require('./fixture-dom.js');
const linkField = async () => {
  const root = path.join(__dirname, '..'), file = (f) => fs.readFileSync(path.join(root, f), 'utf8');
  if (!Object.getOwnPropertyDescriptor(El.prototype, 'classList')) {
    Object.defineProperty(El.prototype, 'classList', { get() {
      const e = this, list = () => String(e.className).split(/\s+/).filter(Boolean);
      return { contains: (c) => list().includes(c), add: (c) => { if (!list().includes(c)) e.className = [...list(), c].join(' '); }, remove: (c) => { e.className = list().filter((x) => x !== c).join(' '); },
        toggle: (c, on) => { if (on ?? !list().includes(c)) { if (!list().includes(c)) e.className = [...list(), c].join(' '); } else e.className = list().filter((x) => x !== c).join(' '); } };
    } });
  }
  const doc = { activeElement: null };
  doc.root = new El('html', doc);
  doc.head = new El('head', doc);
  doc.body = parseDOM(file('writer.html'), doc);
  doc.documentElement = doc.root;
  doc.getElementById = (id) => doc.root.querySelector(`#${id}`);
  doc.querySelector = (s) => doc.root.querySelector(s);
  doc.addEventListener = () => {};
  doc.createElement = (t) => new El(t, doc);
  const listeners = [], links = [];
  // The editor's link command: it links what the schema's href() keeps (loosely: "example.com" too), else refuses.
  const editor = (opts) => ({ opts, view: { state: { doc: 'd' } }, html: () => opts.html, words: () => 1, setHTML() {}, focus() {}, active: () => ({}),
    run: (name, url) => { const h = name === 'link' && S.href(url, true); if (h) links.push(h); return !!h; } });
  const ctx = vm.createContext({
    document: doc, innerWidth: 800, innerHeight: 300, console, ResizeObserver: class { observe() {} },
    addEventListener: (type, f) => { if (type === 'message') listeners.push(f); },
    chrome: { runtime: { sendMessage: async () => ({ ok: true }) } },
    GZ_WRITER_EDITOR: { create: editor },
    GZ_WRITER_SCHEMA: { compose: 'compose', paper: 'paper', delta: () => [{ insert: '\n' }], loses: () => [] },
  });
  ctx.globalThis = ctx;
  vm.runInContext(file('lib/i18n.js'), ctx);
  vm.runInContext(file('writer.js'), ctx);
  const port = { sent: [], postMessage(m) { this.sent.push(m); }, close() {} };
  for (const f of listeners) await f({ data: { type: 'glaze:writer', pass: 'p'.repeat(36) }, ports: [port] });
  port.onmessage({ data: { type: 'init', mode: 'compose', kind: 'reply', html: '<p>Hi there</p>', locale: 'en', look: {} } });
  const input = doc.getElementById('href');
  const enter = (v) => { links.length = 0; input.hidden = false; input.value = v; input.dispatchEvent({ type: 'keydown', key: 'Enter', preventDefault() {} }); return { links: [...links], open: !input.hidden, invalid: input.getAttribute('aria-invalid') }; };
  return { enter, input };
};

test('F6: the link field takes what the schema keeps, https:// only before an address without a scheme, and stays open on the rest', async () => {
  const f = await linkField();
  assert.deepEqual(f.enter('https://ok.example/a'), { links: ['https://ok.example/a'], open: false, invalid: null });
  assert.deepEqual(f.enter('tel:+15551234567'), { links: ['tel:+15551234567'], open: false, invalid: null });
  assert.deepEqual(f.enter('mailto:help@example.com'), { links: ['mailto:help@example.com'], open: false, invalid: null });
  assert.deepEqual(f.enter('example.com'), { links: ['https://example.com'], open: false, invalid: null });
  assert.deepEqual(f.enter('example.com:8080/x'), { links: ['https://example.com:8080/x'], open: false, invalid: null });
  assert.deepEqual(f.enter('//example.com/a'), { links: ['https://example.com/a'], open: false, invalid: null });
  for (const bad of ['mailto:help', 'ftp://files.example.com/a', 'https:example.com', 'javascript:alert(1)']) {
    assert.deepEqual(f.enter(bad), { links: [], open: true, invalid: 'true' }, bad);
  }
  f.input.dispatchEvent({ type: 'input' });
  assert.equal(f.input.getAttribute('aria-invalid'), null, 'typing again clears it');
});

// ---- A6: every picture in a paper is one Word takes. writer-objects.js in a stand-in DOM, its plugins over a state.
const X = require('../lib/writer-docx.js');
globalThis.GZ_WRITER_OBJECTS_DOCX = require('../lib/writer-objects-docx.js');
const WEBP = 'UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA=='; // a 1×1 lossless WebP
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const objectsFrame = (html) => {
  const doc = { activeElement: null };
  doc.root = new El('html', doc);
  doc.body = new El('body', doc);
  doc.root.append(doc.body);
  doc.documentElement = doc.root;
  doc.querySelector = (s) => doc.root.querySelector(s);
  doc.querySelectorAll = (s) => doc.root.querySelectorAll(s);
  doc.addEventListener = () => {};
  const drawn = [];
  // A canvas draws whatever it was given as the 1×1 PNG above; the test checks what Writer asked of it.
  doc.createElement = (t) => (t === 'canvas'
    ? { getContext: () => ({ drawImage() {}, fillRect() {} }), toBlob: (ok, type) => { drawn.push(type); ok(new Blob([Buffer.from(PNG, 'base64')], { type: 'image/png' })); } }
    : new El(t, doc));
  doc.createElementNS = (_ns, t) => new El(t, doc);
  const on = {}, plugins = [];
  const ctx = vm.createContext({
    document: doc, innerWidth: 800, innerHeight: 600, console, navigator: { platform: 'MacIntel' }, Blob, atob, setTimeout, Promise, Uint8Array,
    addEventListener() {}, requestAnimationFrame: () => 1, MutationObserver: class { observe() {} disconnect() {} },
    createImageBitmap: async (blob) => { if (blob.type !== 'image/webp') throw new Error('not the picture'); return { width: 1, height: 1, close() {} }; },
    FileReader: class { readAsDataURL(b) { b.arrayBuffer().then((buf) => { this.result = `data:${b.type};base64,${Buffer.from(buf).toString('base64')}`; this.onload(); }); } },
    GZ_PM, GZ_WRITER_OBJECTS_LIB: OBJ,
    GZ_WRITER_FRAME: { t: (k) => k, mode: () => 'paper', on: (name, f) => { on[name] = f; }, plugin: (p) => plugins.push(p) },
  });
  ctx.globalThis = ctx;
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../writer-objects.js'), 'utf8'), ctx);
  // A view as the editor's: the state with every plugin writer-objects.js adds, and their views told of each change.
  const view = { dom: new El('div', doc), focus() {}, views: [], dispatch(tr) { const prev = this.state; this.state = this.state.apply(tr); for (const v of this.views) v.update?.(this, prev); } };
  view.state = E.state({ mode: 'paper', html: '<p>x</p>' });
  on.ready({ view, run: () => true });
  view.state = E.state({ mode: 'paper', html, plugins });
  view.views = plugins.filter((p) => p.spec.view).map((p) => p.spec.view(view));
  return { view, drawn };
};
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise(setImmediate); };
const sources = (doc) => { const out = []; doc.descendants((n) => { if (n.type.name === 'image') out.push(n.attrs.src.slice(0, 22)); }); return out; };

test('A6: a pasted WebP picture is drawn again as PNG, in place and in the paste\'s undo step, so Word export takes it', async () => {
  const f = objectsFrame('<p>Before</p>');
  const slice = S.slice(S.paper, P.normalize(`<html><body><p>Chart <img src="data:image/webp;base64,${WEBP}" alt="chart"> here</p></body></html>`).html);
  f.view.dispatch(f.view.state.tr.replaceSelection(slice).setMeta('paste', true));
  await settle();
  assert.deepEqual(sources(f.view.state.doc), ['data:image/png;base64,']);
  assert.deepEqual(f.drawn, ['image/png'], 'drawn as PNG, as a picture from a file is');
  let alt = null;
  f.view.state.doc.descendants((n) => { if (n.type.name === 'image') alt = n.attrs.alt; });
  assert.equal(alt, 'chart');
  assert.ok(X.exportDocx(f.view.state.doc, { format: 'mla9' }).bytes.length > 0);
  // One undo takes the paste away whole.
  GZ_PM.history.undo(f.view.state, (tr) => f.view.dispatch(tr));
  assert.equal(f.view.state.doc.textContent, 'Before');
  assert.deepEqual(sources(f.view.state.doc), []);
});

test('A6: a paper that already holds a WebP picture gets it drawn again when it opens', async () => {
  const f = objectsFrame(`<p>Old <img src="data:image/webp;base64,${WEBP}" alt="old"></p>`);
  await settle();
  assert.deepEqual(sources(f.view.state.doc), ['data:image/png;base64,']);
  assert.ok(X.exportDocx(f.view.state.doc, { format: 'mla9' }).bytes.length > 0);
  // Typing after it starts nothing new.
  f.view.dispatch(f.view.state.tr.insertText('!'));
  await settle();
  assert.deepEqual(f.drawn, ['image/png']);
});
