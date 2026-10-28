// Stream F's editing commands at the EditorState level (lib/writer-editor.js, lib/writer-schema.js, lib/writer-styles.js):
// font family and size as run marks (the format's own left unmarked), size steps as Word's, text colour and Word's
// highlighter, small caps and all caps, clear formatting, the paragraph settings the Paragraph dialog and the ruler write
// (only what differs from the format), page break before, tab stops, and Word's and Docs' keyboard shortcuts in paper and
// compose.
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../lib/writer-schema.js');
const E = require('../lib/writer-editor.js');
const ST = require('../lib/writer-styles.js');
const { TextSelection, AllSelection } = GZ_PM.state;

const make = (html, mode = 'paper') => E.state({ html, mode });
const html = (st) => S.serialize(st.schema, st.doc);
const find = (st, needle) => { const t = S.text(st.doc), i = t.text.indexOf(needle); assert.ok(i >= 0, needle); return { from: t.posAt(i), to: t.posAt(i + needle.length) }; };
const select = (st, needle) => { const r = find(st, needle); return st.apply(st.tr.setSelection(TextSelection.create(st.doc, r.from, r.to))); };
const caret = (st, needle) => { const r = find(st, needle); return st.apply(st.tr.setSelection(TextSelection.create(st.doc, r.to))); };
const everything = (st) => st.apply(st.tr.setSelection(new AllSelection(st.doc)));
const run = (st, name, arg) => {
  let next = st;
  const cmd = E.commands(st.schema)[name];
  assert.ok(cmd, `${name} is a command in ${st.schema === S.paper ? 'paper' : 'compose'}`);
  const ok = cmd(arg)(st, (tr) => { next = st.apply(tr); });
  return { ok, st: next };
};
const press = (st, key) => {
  let next = st;
  const fn = E.bindings(st.schema)[key];
  const ok = !!fn && fn(st, (tr) => { next = st.apply(tr); });
  return { ok, st: next };
};
const marksAt = (st, needle) => st.doc.nodeAt(find(st, needle).from).marks.map((m) => [m.type.name, m.attrs]);

test('small caps and all caps are paper marks that round-trip through Writer\'s HTML; compose has neither', () => {
  assert.ok(S.paper.marks.small_caps && S.paper.marks.all_caps);
  assert.equal(S.compose.marks.small_caps, undefined);
  assert.equal(S.compose.marks.all_caps, undefined);
  let st = run(select(make('<p>one two three</p>'), 'two'), 'smallCaps').st;
  st = run(select(st, 'three'), 'allCaps').st;
  const out = html(st);
  assert.match(out, /data-gz-caps="small"/);
  assert.match(out, /data-gz-caps="all"/);
  const back = S.parse(S.paper, out);
  assert.equal(S.serialize(S.paper, back), out, 'parse(serialize) is the same document');
  assert.equal(run(st, 'smallCaps').st !== st, true);
  assert.equal(html(run(select(st, 'two'), 'smallCaps').st).includes('data-gz-caps="small"'), false, 'toggles off');
});

test('font family and size are run marks; null takes the mark\'s part away and leaves the other', () => {
  let st = run(select(make('<p>one two three</p>'), 'two'), 'font', 'Arial').st;
  assert.deepEqual(marksAt(st, 'two'), [['text_style', { font: 'Arial', size: null }]]);
  st = run(st, 'size', 14).st;
  assert.deepEqual(marksAt(st, 'two'), [['text_style', { font: 'Arial', size: 14 }]]);
  st = run(st, 'font', null).st;
  assert.deepEqual(marksAt(st, 'two'), [['text_style', { font: null, size: 14 }]]);
  st = run(st, 'size', null).st;
  assert.deepEqual(marksAt(st, 'two'), [], 'no empty text_style left behind');
  assert.equal(run(st, 'font', 'Comic Sans').ok, false, 'only the paper fonts');
  assert.equal(run(st, 'size', 200).ok, false, 'sizes 8 to 72');
  assert.equal(run(st, 'size', 7).ok, false);
  // An empty selection: what typing carries next.
  const typed = run(caret(make('<p>one</p>'), 'one'), 'size', 18).st;
  assert.deepEqual(typed.storedMarks.map((m) => [m.type.name, m.attrs]), [['text_style', { font: null, size: 18 }]]);
  // A selection across runs keeps each run's other part.
  st = run(select(make('<p><span style="font-family:Arial">aa</span>bb</p>'), 'aabb'), 'size', 10).st;
  assert.deepEqual(marksAt(st, 'aa'), [['text_style', { font: 'Arial', size: 10 }]]);
  assert.deepEqual(marksAt(st, 'bb'), [['text_style', { font: null, size: 10 }]]);
});

test('size steps go through Word\'s list from the selection\'s size (or the base), 8 to 72', () => {
  const at = (st) => st.doc.nodeAt(find(st, 'two').from).marks.find((m) => m.type.name === 'text_style')?.attrs.size ?? null;
  let st = select(make('<p>one two</p>'), 'two');
  st = run(st, 'sizeStep', { dir: 1, base: 12 }).st; assert.equal(at(st), 14);
  st = run(st, 'sizeStep', { dir: 1, base: 12 }).st; assert.equal(at(st), 16);
  st = run(st, 'sizeStep', { dir: -1, base: 12 }).st; assert.equal(at(st), 14);
  st = run(st, 'sizeStep', { dir: -1, base: 12 }).st; assert.equal(at(st), null, 'back at the base: unmarked');
  st = run(st, 'sizeStep', { dir: -1, base: 12 }).st; assert.equal(at(st), 11);
  st = run(select(make('<p>one <span style="font-size:72pt">two</span></p>'), 'two'), 'sizeStep', { dir: 1, base: 12 });
  assert.equal(st.ok, false, 'nothing past 72');
  st = run(select(make('<p>one <span style="font-size:13pt">two</span></p>'), 'two'), 'sizeStep', { dir: 1, base: 12 }).st;
  assert.equal(at(st), 14, 'a size between steps goes to the next one');
});

test('text colour and highlight: hex colours and Word\'s highlighter names; null removes', () => {
  let st = run(select(make('<p>one two</p>'), 'two'), 'color', 'c00000').st;
  assert.deepEqual(marksAt(st, 'two'), [['color', { color: 'C00000' }]]);
  st = run(st, 'highlight', 'yellow').st;
  assert.deepEqual(marksAt(st, 'two').map(([n]) => n).sort(), ['color', 'highlight']);
  assert.equal(run(st, 'highlight', 'chartreuse').ok, false);
  assert.equal(run(st, 'color', 'red').ok, false);
  st = run(run(st, 'color', null).st, 'highlight', null).st;
  assert.deepEqual(marksAt(st, 'two'), []);
});

test('clear formatting takes every run mark but links: colour, highlight, caps, font and size too', () => {
  let st = select(make('<p><a href="https://a.b">one</a> two</p>'), 'one two');
  for (const [name, arg] of [['bold'], ['color', '0070C0'], ['highlight', 'green'], ['smallCaps'], ['font', 'Arial'], ['size', 20]]) st = run(st, name, arg).st;
  st = run(st, 'clear').st;
  assert.deepEqual(marksAt(st, 'one').map(([n]) => n), ['link']);
  assert.deepEqual(marksAt(st, 'two'), []);
});

test('active() reports the selection\'s font, size, colour, highlight and caps', () => {
  let st = select(make('<p>one two</p>'), 'two');
  for (const [name, arg] of [['font', 'Calibri'], ['size', 11], ['color', '00B050'], ['highlight', 'cyan'], ['allCaps']]) st = run(st, name, arg).st;
  const a = E.active(st);
  assert.deepEqual([a.font, a.size, a.color, a.highlight, a.allCaps, a.smallCaps], ['Calibri', 11, '00B050', 'cyan', true, false]);
});

test('paragraph settings land on every selected textblock; a null clears one back to the format', () => {
  let st = everything(make('<p>one</p><p>two</p>'));
  st = run(st, 'paragraph', { before: 6, after: 12, line: 1.5, first: -0.5, left: 0.5, right: 1, keepNext: true, keepLines: true, widow: false, align: 'justify' }).st;
  for (let i = 0; i < 2; i++) {
    const a = st.doc.child(i).attrs;
    assert.deepEqual([a.before, a.after, a.line, a.first, a.left, a.indent, a.right, a.keepNext, a.keepLines, a.widow, a.align], [6, 12, 1.5, -0.5, null, 1, 1, true, true, false, 'justify'], 'a half-inch left indent is the indent step');
  }
  st = run(st, 'paragraph', { left: 0.3, exact: 18 }).st;
  assert.deepEqual([st.doc.child(0).attrs.left, st.doc.child(0).attrs.indent, st.doc.child(0).attrs.exact, st.doc.child(0).attrs.line], [0.3, 0, 18, null], 'exact spacing replaces the multiple');
  st = run(st, 'paragraph', { before: null, after: null, exact: null, left: null, right: null, first: null, keepNext: null, keepLines: null, widow: null, align: null }).st;
  const a = st.doc.child(1).attrs;
  assert.deepEqual([a.before, a.after, a.exact, a.left, a.indent, a.right, a.first, a.keepNext, a.keepLines, a.widow, a.align, a.line], [null, null, null, null, 0, null, null, null, null, null, null, null]);
  assert.equal(run(make('<p>x</p>', 'compose'), 'paragraph', { before: 6 }).ok === undefined, false, 'compose has no paragraph command');
});

test('page break before puts a page break ahead of the paragraph, and takes it away', () => {
  let st = caret(make('<p>one</p><p>two</p>'), 'two');
  st = run(st, 'breakBefore', true).st;
  assert.deepEqual(st.doc.content.content.map((n) => n.type.name), ['paragraph', 'page_break', 'paragraph']);
  assert.equal(E.active(caret(st, 'two')).breakBefore, true);
  assert.equal(run(caret(st, 'two'), 'breakBefore', true).ok, false, 'already there');
  st = run(caret(st, 'two'), 'breakBefore', false).st;
  assert.deepEqual(st.doc.content.content.map((n) => n.type.name), ['paragraph', 'paragraph']);
  assert.equal(E.active(caret(st, 'two')).breakBefore, false);
});

test('tab stops: set, sorted, cleared', () => {
  let st = caret(make('<p>one</p>'), 'one');
  st = run(st, 'tabs', [[3, 'c'], [1, 'l'], [4.5, 'd']]).st;
  assert.deepEqual(st.doc.child(0).attrs.tabs, [[1, 'l'], [3, 'c'], [4.5, 'd']]);
  assert.match(html(st), /data-gz="tabs:1l 3c 4.5d"/);
  st = run(st, 'tabs', []).st;
  assert.equal(st.doc.child(0).attrs.tabs, null);
});

test('Word\'s and Docs\' shortcuts in paper', () => {
  const sel = () => select(make('<p>one two</p>'), 'two');
  for (const [key, tag] of [['Shift-Mod-x', 's'], ['Mod-=', 'sub'], ['Shift-Mod-=', 'sup'], ['Mod-.', 'sup'], ['Mod-,', 'sub']]) {
    const r = press(sel(), key);
    assert.equal(r.ok, true, key);
    assert.equal(html(r.st), `<p>one <${tag}>two</${tag}></p>`, key);
  }
  assert.equal(html(press(run(sel(), 'bold').st, 'Mod-\\').st), '<p>one two</p>', '⌘\\ clears formatting');
  const p = () => caret(make('<p>one</p>'), 'one');
  assert.equal(press(p(), 'Shift-Mod-e').st.doc.child(0).attrs.align, 'center');
  assert.equal(press(p(), 'Shift-Mod-r').st.doc.child(0).attrs.align, 'right');
  assert.equal(press(p(), 'Shift-Mod-j').st.doc.child(0).attrs.align, 'justify');
  assert.equal(press(press(p(), 'Shift-Mod-e').st, 'Shift-Mod-l').st.doc.child(0).attrs.align, null);
  assert.equal(press(p(), 'Mod-]').st.doc.child(0).attrs.indent, 1);
  assert.equal(press(press(p(), 'Mod-]').st, 'Mod-[').st.doc.child(0).attrs.indent, 0);
  assert.equal(press(p(), 'Alt-Mod-2').st.doc.child(0).type.name, 'heading');
  assert.equal(press(p(), 'Alt-Mod-2').st.doc.child(0).attrs.level, 2);
  assert.equal(press(press(p(), 'Alt-Mod-1').st, 'Alt-Mod-0').st.doc.child(0).type.name, 'paragraph');
  assert.equal(press(p(), 'Shift-Mod-7').st.doc.child(0).type.name, 'ordered_list');
  assert.equal(press(p(), 'Shift-Mod-8').st.doc.child(0).type.name, 'bullet_list');
});

test('compose gets the shortcuts that make sense for a post: marks and lists, not alignment, headings or indents', () => {
  const sel = () => select(make('<p>one two</p>', 'compose'), 'two');
  assert.equal(html(press(sel(), 'Shift-Mod-x').st), '<p>one <s>two</s></p>');
  assert.equal(html(press(sel(), 'Shift-Mod-=').st), '<p>one <sup>two</sup></p>');
  assert.equal(press(caret(make('<p>one</p>', 'compose'), 'one'), 'Shift-Mod-8').st.doc.child(0).type.name, 'bullet_list');
  for (const key of ['Shift-Mod-e', 'Alt-Mod-1', 'Mod-]', 'Mod-[']) assert.equal(press(sel(), key).ok, false, `${key} not bound in compose`);
});

test('the format\'s paragraph values and what the dialog stores: only what differs', () => {
  const f = ST.FORMATS.mla9;
  assert.deepEqual(ST.paraBase(f, {}), { align: 'left', left: 0, right: 0, first: 0.5, before: 0, after: 0, line: 2, exact: null, least: null });
  assert.deepEqual(ST.paraBase(f, { entry: true }).first, -0.5);
  assert.deepEqual(ST.paraBase(f, { entry: true }).left, 0.5);
  assert.deepEqual(ST.paraBase(f, { heading: 1 }).first, 0);
  assert.equal(ST.paraBase(ST.FORMATS.chicago17, { quote: true }).line, 1);
  const same = ST.paraAttrs(f, {}, { align: 'left', left: 0, right: 0, first: 0.5, before: 0, after: 0, line: 2, keepNext: false, keepLines: false, widow: true });
  assert.deepEqual(same, { align: null, left: null, right: null, first: null, before: null, after: null, line: null, exact: null, least: null, keepNext: null, keepLines: null, widow: null });
  const own = ST.paraAttrs(f, {}, { align: 'center', left: 1, right: 0.25, first: 0.25, before: 12, after: 6, line: 1.15, keepNext: true, keepLines: false, widow: false });
  assert.deepEqual(own, { align: 'center', left: 1, right: 0.25, first: 0.25, before: 12, after: 6, line: 1.15, exact: null, least: null, keepNext: true, keepLines: null, widow: false });
  assert.deepEqual(ST.paraAttrs(f, {}, { line: 'exact', at: 18 }).exact, 18);
  assert.deepEqual(ST.paraAttrs(f, {}, { line: 'least', at: 14 }).least, 14);
  assert.equal(ST.paraAttrs(f, {}, { align: 'center', first: 0 }).first, null, 'a centred line has no first-line indent by default');
});
