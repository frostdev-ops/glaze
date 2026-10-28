// Glaze Writer's objects (lib/writer-objects.js over lib/writer-schema.js): the paper's pictures, tables, links, rules and
// lists keep their attributes through JSON and HTML, and the commands, keys and input rules that make them work on an
// EditorState alone. The frame (writer-objects.js) is checked in headless Chromium by scripts/writer-objects-check.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../lib/writer-schema.js');
const E = require('../lib/writer-editor.js');
const L = require('../lib/writer-objects.js');
const { TextSelection, NodeSelection } = GZ_PM.state;

const P = S.paper, C = S.compose;
const make = (html, o = {}) => E.state({ html, mode: 'paper', plugins: L.plugins(P), ...o });
const html = (st) => S.serialize(st.schema, st.doc);
const json = (doc) => P.nodeFromJSON(JSON.parse(JSON.stringify(doc.toJSON())));
const roundHTML = (doc) => S.parse(P, S.serialize(P, doc));
const find = (st, needle) => {
  const t = S.text(st.doc), i = t.text.indexOf(needle);
  assert.ok(i >= 0, `"${needle}" in ${JSON.stringify(t.text)}`);
  return { from: t.posAt(i), to: t.posAt(i + needle.length) };
};
const caret = (st, needle, at = 'end') => { const r = find(st, needle); return st.apply(st.tr.setSelection(TextSelection.create(st.doc, at === 'end' ? r.to : r.from))); };
const run = (st, name, ...args) => {
  let next = st;
  const ok = L.commands(st.schema)[name](...args)(st, (tr) => { next = st.apply(tr); });
  return { ok, st: next };
};
const type = (st, text) => {
  const rules = st.plugins.find((p) => p.spec.isInputRules);
  for (const ch of text) {
    const view = { state: st, composing: false, dispatch(tr) { this.state = this.state.apply(tr); } };
    const { from, to } = st.selection;
    if (!rules.props.handleTextInput(view, from, to, ch)) view.state = view.state.apply(view.state.tr.insertText(ch));
    st = view.state;
  }
  return st;
};
const key = (st, name) => {
  let next = st;
  const keys = st.plugins.find((p) => p.spec.gzObjectsKeys);
  const ok = keys.props.handleKeyDown({ state: st, dispatch: (tr) => { next = st.apply(tr); } }, name);
  return { ok, st: next };
};
const ev = (k, mods = {}) => ({ key: k, shiftKey: !!mods.shift, metaKey: !!mods.meta, ctrlKey: !!mods.ctrl, altKey: false, preventDefault() {} });
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

// ---- schema attributes
test('a picture keeps its layout, alignment, width and caption through JSON and HTML', () => {
  const img = P.nodes.image.create({ src: PNG, alt: 'A house', width: 300, display: 'block', align: 'right', caption: 'Fig. 1. The house.' });
  const doc = P.nodes.doc.create(null, P.nodes.paragraph.create(null, img));
  for (const back of [json(doc), roundHTML(doc)]) {
    assert.deepEqual(back.firstChild.firstChild.attrs, { src: PNG, alt: 'A house', width: 300, display: 'block', align: 'right', caption: 'Fig. 1. The house.' });
  }
  const plain = S.parse(P, `<p><img src="${PNG}" alt="x" width="120"></p>`).firstChild.firstChild.attrs;
  assert.deepEqual([plain.display, plain.align, plain.caption], ['inline', null, ''], 'an imported picture stays in line');
  const odd = S.parse(P, `<p><img src="${PNG}" data-display="float" data-align="top" data-caption="${'x'.repeat(2000)}"></p>`).firstChild.firstChild.attrs;
  assert.deepEqual([odd.display, odd.align, odd.caption.length], ['inline', null, 500], 'unknown values fall back; captions are capped');
});

test('a table keeps borders off, a header row and each cell\'s vertical alignment', () => {
  const st = make('<p>x</p>');
  const { st: withTable } = run(caret(st, 'x'), 'insertTable', { rows: 2, cols: 2, header: true });
  let table = null;
  withTable.doc.descendants((n, pos) => { if (n.type.name === 'table') table = { n, pos }; });
  const tr = withTable.tr.setNodeMarkup(table.pos, null, { ...table.n.attrs, borders: false });
  const cellPos = table.pos + 1 + table.n.firstChild.nodeSize + 1;
  tr.setNodeMarkup(cellPos, null, { ...tr.doc.nodeAt(cellPos).attrs, valign: 'middle' });
  const doc = withTable.apply(tr).doc;
  for (const back of [json(doc), roundHTML(doc)]) {
    let t = null; back.descendants((n) => { if (n.type.name === 'table') t = n; });
    assert.equal(t.attrs.borders, false);
    assert.equal(t.firstChild.firstChild.type.name, 'table_header');
    assert.equal(t.child(1).firstChild.attrs.valign, 'middle');
  }
  assert.equal(S.parse(P, '<table><tr><td data-valign="sideways">a</td></tr></table>').firstChild.firstChild.firstChild.attrs.valign, null);
});

test('lists keep per-level styles, continued numbering and a restart through JSON and HTML', () => {
  const ol = P.nodes.ordered_list.create({ styles: 'upper-roman,upper-alpha,decimal', continue: true }, [
    P.nodes.list_item.create(null, P.text('one')), P.nodes.list_item.create({ start: 4 }, P.text('four'))]);
  const ul = P.nodes.bullet_list.create({ styles: 'square,dash' }, P.nodes.list_item.create(null, P.text('dot')));
  const doc = P.nodes.doc.create(null, [ol, P.nodes.paragraph.create(null, P.text('between')), ul]);
  for (const back of [json(doc), roundHTML(doc)]) {
    assert.deepEqual(back.firstChild.attrs, { styles: 'upper-roman,upper-alpha,decimal', continue: true });
    assert.equal(back.firstChild.child(1).attrs.start, 4);
    assert.equal(back.child(2).attrs.styles, 'square,dash');
  }
  const bad = S.parse(P, '<ol data-styles="decimal,nonsense"><li data-start="-3">a</li></ol>').firstChild;
  assert.equal(bad.attrs.styles, 'decimal');
  assert.equal(bad.firstChild.attrs.start, null);
});

test('compose lists, pictures and tables are untouched: Quill keeps none of the new attributes', () => {
  assert.equal(C.nodes.ordered_list.spec.attrs, undefined);
  assert.equal(C.nodes.list_item.attrs.start, undefined);
  assert.equal(S.serialize(C, S.parse(C, '<ol><li>a</li></ol>')), '<ol><li>a</li></ol>');
  assert.equal(S.serialize(P, S.parse(P, '<ol><li>a</li></ol>')), '<ol><li>a</li></ol>', 'a plain paper list writes plain HTML');
});

test('a horizontal line is its own block in paper, and a page break stays a page break', () => {
  assert.ok(P.nodes.horizontal_rule, 'paper has a horizontal line');
  assert.equal(C.nodes.horizontal_rule, undefined);
  const doc = S.parse(P, '<p>a</p><hr class="gz-rule"><p>b</p><hr class="gz-page-break"><hr>');
  assert.deepEqual(doc.content.content.map((n) => n.type.name), ['paragraph', 'horizontal_rule', 'paragraph', 'page_break'], 'a plain <hr> is still dropped, as before');
  assert.equal(S.serialize(P, doc), '<p>a</p><hr class="gz-rule"><p>b</p><hr class="gz-page-break">');
  assert.deepEqual(S.loses(C, '<p>a</p><hr><p>b</p>'), [], 'compose drops a rule as Quill does');
});

// ---- lists
test('marker() numbers each style as Word and Docs do', () => {
  assert.deepEqual([1, 4, 9, 14, 40].map((n) => L.marker('lower-roman', n)), ['i', 'iv', 'ix', 'xiv', 'xl']);
  assert.deepEqual([1, 26, 27, 28].map((n) => L.marker('upper-alpha', n)), ['A', 'Z', 'AA', 'AB']);
  assert.equal(L.marker('decimal', 12), '12');
  assert.deepEqual(['disc', 'circle', 'square', 'dash'].map((s) => L.marker(s)), ['•', '◦', '▪', '–']);
});

test('levelStyles() fills nine levels from a list\'s own styles and the defaults', () => {
  assert.deepEqual(L.levelStyles(P.nodes.ordered_list.create(null, P.nodes.list_item.create())), ['decimal', 'lower-alpha', 'lower-roman', 'decimal', 'lower-alpha', 'lower-roman', 'decimal', 'lower-alpha', 'lower-roman']);
  assert.deepEqual(L.levelStyles(P.nodes.bullet_list.create({ styles: 'dash' }, P.nodes.list_item.create())).slice(0, 4), ['dash', 'circle', 'square', 'disc']);
});

test('a numbering style applies to the caret\'s level of its list; presets set every level', () => {
  let st = caret(make('<ol><li>a</li><li class="ql-indent-1">b</li></ol>'), 'b');
  st = run(st, 'listStyle', 'upper-roman').st;
  assert.equal(st.doc.firstChild.attrs.styles, 'decimal,upper-roman');
  st = run(st, 'listPreset', 'A. 1. a.').st;
  assert.equal(st.doc.firstChild.attrs.styles, 'upper-alpha,decimal,lower-alpha');
  assert.equal(run(caret(make('<p>x</p>'), 'x'), 'listStyle', 'decimal').ok, false, 'outside a list nothing happens');
  assert.equal(run(caret(make('<ul><li>a</li></ul>'), 'a'), 'listStyle', 'upper-roman').ok, false, 'a bullet list takes bullet styles only');
  assert.equal(run(caret(make('<ul><li>a</li></ul>'), 'a'), 'listStyle', 'square').st.doc.firstChild.attrs.styles, 'square');
});

test('Tab and Shift-Tab nest list items as before', () => {
  const st = caret(make('<ol><li>a</li><li>b</li></ol>'), 'b');
  const press = (s, k) => { let next = s; E.bindings(s.schema)[k](s, (tr) => { next = s.apply(tr); }); return next; };
  const in1 = press(st, 'Tab');
  assert.equal(in1.doc.firstChild.child(1).attrs.indent, 1);
  assert.equal(press(in1, 'Shift-Tab').doc.firstChild.child(1).attrs.indent, 0);
});

test('restart numbering marks the caret\'s item; continue numbering marks its list', () => {
  let st = caret(make('<ol><li>a</li><li>b</li></ol><p>x</p><ol><li>c</li></ol>'), 'b');
  st = run(st, 'restart').st;
  assert.equal(st.doc.firstChild.child(1).attrs.start, 1);
  st = run(st, 'restart').st;
  assert.equal(st.doc.firstChild.child(1).attrs.start, null, 'a second restart takes it off');
  st = run(caret(st, 'c'), 'continueList').st;
  assert.equal(st.doc.child(2).attrs.continue, true);
  assert.equal(run(caret(st, 'x'), 'restart').ok, false);
});

test('an item split from a restarted one does not restart again', () => {
  let st = run(caret(make('<ol><li>a</li><li>bc</li></ol>'), 'b'), 'restart').st;
  const r = find(st, 'b');
  st = st.apply(st.tr.split(r.to));
  assert.deepEqual([...Array(st.doc.firstChild.childCount).keys()].map((i) => st.doc.firstChild.child(i).attrs.start), [null, 1, null]);
});

// ---- links
test('autolink() finds a typed address or email before the caret, without trailing punctuation', () => {
  assert.deepEqual(L.autolink('see www.example.com'), { start: 4, end: 19, href: 'https://www.example.com' });
  assert.deepEqual(L.autolink('(https://doi.org/10.1/x).'), { start: 1, end: 23, href: 'https://doi.org/10.1/x' });
  assert.deepEqual(L.autolink('https://en.wikipedia.org/wiki/Beloved_(novel)'), { start: 0, end: 45, href: 'https://en.wikipedia.org/wiki/Beloved_(novel)' });
  assert.deepEqual(L.autolink('mail a.rivera@school.edu.'), { start: 5, end: 24, href: 'mailto:a.rivera@school.edu' });
  for (const s of ['ratio 3.5', 'e.g.', 'i.e', 'see p.42', 'file.docx', 'javascript:alert(1)', 'http://', 'www.']) assert.equal(L.autolink(s), null, s);
});

test('a typed address becomes a link on space, and Backspace takes it back', () => {
  const st = type(caret(make('<p>See </p>'), 'See '), 'www.example.com ');
  let linked = null;
  st.doc.descendants((n) => { if (n.isText && n.marks.length) linked = { text: n.text, href: n.marks[0].attrs.href }; });
  assert.deepEqual(linked, { text: 'www.example.com', href: 'https://www.example.com' });
  assert.equal(html(st), '<p>See <a href="https://www.example.com" rel="noopener noreferrer" target="_blank">www.example.com</a> </p>');
  let back = st;
  GZ_PM.inputrules.undoInputRule(st, (tr) => { back = st.apply(tr); });
  assert.equal(html(back), '<p>See www.example.com </p>');
  assert.equal(html(type(caret(make('<p>x</p>'), 'x'), ' 3.5 ')), '<p>x 3.5 </p>');
});

test('link() sets a link\'s text and address, and refuses an unsafe one', () => {
  let st = caret(make('<p>Read <a href="https://a.org">this</a> now</p>'), 'th', 'end');
  st = run(st, 'link', { text: 'the article', href: 'doi.org/10.1/x' }).st;
  assert.equal(html(st), '<p>Read <a href="https://doi.org/10.1/x" rel="noopener noreferrer" target="_blank">the article</a> now</p>');
  assert.equal(run(st, 'link', { text: 'x', href: 'javascript:alert(1)' }).ok, false);
  const fresh = run(caret(make('<p>Read </p>'), 'Read '), 'link', { text: '', href: 'https://a.org' }).st;
  assert.equal(html(fresh), '<p>Read <a href="https://a.org" rel="noopener noreferrer" target="_blank">https://a.org</a></p>');
  assert.equal(html(run(caret(st, 'the', 'end'), 'unlink').st), '<p>Read the article now</p>');
});

test('linkAt() reports the link around the caret: its range, text and address', () => {
  const st = caret(make('<p>Read <a href="https://a.org">this</a> now</p>'), 'th');
  assert.deepEqual(L.linkAt(st), { from: 6, to: 10, text: 'this', href: 'https://a.org' });
  assert.equal(L.linkAt(caret(st, 'now')), null);
});

// ---- the horizontal line and characters
test('--- (or the em dash it becomes, then -) on an empty line makes a horizontal line', () => {
  for (const typed of ['---', '—-']) {
    const st = type(caret(make('<p>a</p><p></p>'), 'a'), '');
    const at = st.apply(st.tr.setSelection(TextSelection.create(st.doc, st.doc.firstChild.nodeSize + 1)));
    const out = type(at, typed);
    assert.deepEqual(out.doc.content.content.map((n) => n.type.name), ['paragraph', 'horizontal_rule', 'paragraph'], typed);
  }
  assert.equal(html(type(caret(make('<p>a</p>'), 'a'), '---')), '<p>a---</p>', 'mid-line it stays text');
});

test('insertRule() puts a horizontal line after the caret\'s block, with a line after it to type on', () => {
  const { st } = run(caret(make('<p>one</p><p>two</p>'), 'one'), 'insertRule');
  assert.deepEqual(st.doc.content.content.map((n) => n.type.name), ['paragraph', 'horizontal_rule', 'paragraph', 'paragraph']);
  assert.equal(st.selection.$from.parent.type.name, 'paragraph');
});

test('searchChars() finds characters by name, code point and group', () => {
  const dash = L.searchChars('dash').map((c) => c.c);
  assert.ok(dash.includes('—') && dash.includes('–'), dash.join(''));
  assert.deepEqual(L.searchChars('section').map((c) => c.c), ['§']);
  assert.deepEqual(L.searchChars('U+00B6').map((c) => c.c), ['¶']);
  const greek = L.searchChars('', 'greek');
  assert.ok(greek.length >= 30 && greek.every((c) => c.cat === 'greek'));
  assert.ok(L.searchChars('e acute').some((c) => c.c === 'é'));
  for (const g of ['punctuation', 'accents', 'greek', 'arrows', 'math', 'symbols']) assert.ok(L.searchChars('', g).length, g);
  assert.equal(new Set(L.CHARS.map((c) => c.c)).size, L.CHARS.length, 'no character twice');
});

// ---- tables
test('insertTable() makes a rows × cols grid of paragraphs, capped at 10 × 10, with a header row on request', () => {
  const { ok, st } = run(caret(make('<p>x</p>'), 'x'), 'insertTable', { rows: 3, cols: 4, header: true });
  assert.ok(ok);
  let t = null; st.doc.descendants((n) => { if (n.type.name === 'table') t = n; });
  assert.equal(t.childCount, 3);
  assert.equal(t.firstChild.childCount, 4);
  assert.equal(t.firstChild.firstChild.type.name, 'table_header');
  assert.equal(t.child(1).firstChild.type.name, 'table_cell');
  assert.equal(t.child(1).firstChild.firstChild.type.name, 'paragraph');
  assert.equal(st.selection.$from.node(-1).type.name, 'table_header', 'the caret goes to the first cell');
  assert.equal(run(caret(make('<p>x</p>'), 'x'), 'insertTable', { rows: 11, cols: 2 }).ok, false);
  assert.equal(run(caret(make('<p>x</p>'), 'x'), 'insertTable', { rows: 2, cols: 0 }).ok, false);
});

const inTable = (rows, cols) => run(caret(make('<p>x</p>'), 'x'), 'insertTable', { rows, cols }).st;
const tableOf = (st) => { let t = null; st.doc.descendants((n) => { if (n.type.name === 'table') t = n; }); return t; };
test('rows and columns add and go; the table refuses columns narrower than half an inch', () => {
  let st = inTable(2, 2);
  st = run(st, 'table', 'addRowAfter').st;
  st = run(st, 'table', 'addColumnAfter').st;
  assert.deepEqual([tableOf(st).childCount, tableOf(st).firstChild.childCount], [3, 3]);
  st = run(st, 'table', 'deleteRow').st;
  st = run(st, 'table', 'deleteColumn').st;
  assert.deepEqual([tableOf(st).childCount, tableOf(st).firstChild.childCount], [2, 2]);
  assert.equal(L.maxColumns(624), 13, '6.5in of text holds 13 half-inch columns');
  let wide = inTable(2, 10);
  for (let i = 0; i < 3; i++) wide = run(wide, 'table', 'addColumnAfter', { content: 624 }).st;
  assert.equal(tableOf(wide).firstChild.childCount, 13);
  assert.equal(run(wide, 'table', 'addColumnAfter', { content: 624 }).ok, false);
  st = run(st, 'table', 'deleteTable').st;
  assert.equal(tableOf(st), null);
});

test('the header row, borders and cell alignment toggle; cell text aligns through its paragraphs', () => {
  let st = inTable(2, 2);
  st = run(st, 'table', 'toggleHeaderRow').st;
  assert.equal(tableOf(st).firstChild.firstChild.type.name, 'table_header');
  st = run(st, 'tableAttr', 'borders', false).st;
  assert.equal(tableOf(st).attrs.borders, false);
  st = run(st, 'cellAttr', 'valign', 'bottom').st;
  assert.equal(tableOf(st).firstChild.firstChild.attrs.valign, 'bottom');
  st = run(st, 'cellAlign', 'center').st;
  assert.equal(tableOf(st).firstChild.firstChild.firstChild.attrs.align, 'center');
  assert.equal(run(caret(make('<p>x</p>'), 'x'), 'cellAlign', 'center').ok, false, 'outside a table nothing happens');
});

test('Tab and Shift-Tab move between cells, and Tab in the last cell adds a row', () => {
  let st = inTable(2, 2);
  const cellIndex = (s) => { const $ = s.selection.$from; return [$.index(-2), $.index(-1)]; };
  st = key(st, ev('Tab')).st;
  assert.deepEqual(cellIndex(st), [0, 1]);
  st = key(st, ev('Tab', { shift: true })).st;
  assert.deepEqual(cellIndex(st), [0, 0]);
  st = key(key(key(st, ev('Tab')).st, ev('Tab')).st, ev('Tab')).st;
  assert.deepEqual(cellIndex(st), [1, 1]);
  st = key(st, ev('Tab')).st;
  assert.equal(tableOf(st).childCount, 3);
  assert.equal(key(caret(make('<p>x</p>'), 'x'), ev('Tab')).ok, false, 'outside a table Tab is the editor\'s');
});

// ---- pictures
test('fitImage() keeps a picture within 1600 pixels a side and 1 MB, as PNG or JPEG', () => {
  assert.deepEqual(L.fitImage({ width: 4000, height: 3000, bytes: 3e6, type: 'image/png' }), { width: 1600, height: 1200, reencode: true, smaller: true });
  assert.deepEqual(L.fitImage({ width: 800, height: 600, bytes: 2e5, type: 'image/png' }), { width: 800, height: 600, reencode: false, smaller: false });
  assert.deepEqual(L.fitImage({ width: 800, height: 600, bytes: 2e6, type: 'image/jpeg' }), { width: 800, height: 600, reencode: true, smaller: true });
  assert.equal(L.fitImage({ width: 400, height: 300, bytes: 1e4, type: 'image/webp' }).reencode, true, 'Word takes no WebP');
  assert.equal(L.fitImage({ width: 0, height: 300, bytes: 1e4, type: 'image/png' }), null);
  assert.equal(L.fitImage({ width: 10, height: 10, bytes: 1e4, type: 'image/svg+xml' }), null);
});

test('a picture\'s width stays between a quarter inch and the text width, shown in inches and percent', () => {
  assert.equal(L.clampWidth(10, 624), 24);
  assert.equal(L.clampWidth(900, 624), 624);
  assert.equal(L.clampWidth(300.4, 624), 300);
  assert.deepEqual(L.size(300, 624), { inches: 3.13, percent: 48 });
  assert.equal(L.fromInches(3.25, 624), 312);
  assert.equal(L.fromPercent(50, 624), 312);
});

test('insertImage() puts a picture in its own centred block by default; the paper\'s pictures are budgeted', () => {
  const { st } = run(caret(make('<p>before after</p>'), 'before'), 'insertImage', { src: PNG, width: 200 });
  assert.deepEqual(st.doc.content.content.map((n) => n.type.name), ['paragraph', 'paragraph', 'paragraph']);
  assert.deepEqual([st.doc.child(0).textContent, st.doc.child(2).textContent], ['before', ' after']);
  const img = st.doc.child(1).firstChild;
  assert.deepEqual([img.attrs.display, img.attrs.align, img.attrs.width], ['block', 'center', 200]);
  assert.ok(st.selection instanceof NodeSelection && st.selection.node === img, 'the new picture is selected');
  assert.ok(L.imageBytes(st.doc) > 60 && L.imageBytes(st.doc) < 80);
  assert.equal(L.IMAGE.maxTotal, 5e6);
  assert.equal(run(st, 'insertImage', { src: 'https://example.com/x.png' }).ok, false, 'only pictures held in the paper');
});

test('setImage() changes a picture; going in line or back to a block keeps it in a paragraph of its own', () => {
  let { st } = run(caret(make('<p>ab</p>'), 'a'), 'insertImage', { src: PNG, width: 200 });
  const pos = st.selection.from;
  st = run(st, 'setImage', pos, { align: 'left', alt: 'A house', caption: 'Fig. 1.', width: 5000 }).st;
  assert.deepEqual(pick(st.doc.nodeAt(pos).attrs), { display: 'block', align: 'left', alt: 'A house', caption: 'Fig. 1.', width: 624 });
  st = run(st, 'setImage', pos, { display: 'inline' }).st;
  assert.equal(st.doc.nodeAt(pos).attrs.display, 'inline');
  st = run(st, 'deleteImage', pos).st;
  let n = 0; st.doc.descendants((x) => { if (x.type.name === 'image') n++; });
  assert.equal(n, 0);
});
const pick = (a) => ({ display: a.display, align: a.align, alt: a.alt, caption: a.caption, width: a.width });
