// lib/writer-editor.js at the EditorState level: every run() command, the keymap and the input rules, in compose and
// paper mode. EditorView needs a real page (selection, MutationObserver, layout), which test/stand-in-dom.js doesn't
// model, so create() itself is checked in headless Chromium instead; typing here goes through the input-rule plugin's
// own handleTextInput with a stand-in view, and keys through the bindings in the order the plugins run them.
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../lib/writer-schema.js');
const E = require('../lib/writer-editor.js');
const { TextSelection, AllSelection, Plugin } = GZ_PM.state;
const { baseKeymap } = GZ_PM.commands;

const make = (html, mode = 'compose', o = {}) => E.state({ html, mode, ...o });
const html = (st) => S.serialize(st.schema, st.doc);
const find = (st, needle) => {
  const t = S.text(st.doc), i = t.text.indexOf(needle);
  assert.ok(i >= 0, `"${needle}" in ${JSON.stringify(t.text)}`);
  return { from: t.posAt(i), to: t.posAt(i + needle.length) };
};
const select = (st, needle) => { const r = find(st, needle); return st.apply(st.tr.setSelection(TextSelection.create(st.doc, r.from, r.to))); };
const caret = (st, needle, at = 'end') => { const r = find(st, needle); return st.apply(st.tr.setSelection(TextSelection.create(st.doc, at === 'end' ? r.to : r.from))); };
const everything = (st) => st.apply(st.tr.setSelection(new AllSelection(st.doc)));
const run = (st, name, arg) => {
  let next = st;
  const cmd = E.commands(st.schema)[name];
  assert.ok(cmd, `${name} is a command here`);
  const ok = cmd(arg)(st, (tr) => { next = st.apply(tr); });
  return { ok, st: next };
};
const press = (st, key, keys, away) => {
  let next = st;
  const dispatch = (tr) => { next = st.apply(tr); };
  const own = E.bindings(st.schema, keys, away)[key];
  const ok = (own && own(st, dispatch)) || (baseKeymap[key] ? baseKeymap[key](st, dispatch) : false);
  return { ok: !!ok, st: next };
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
const blank = (mode) => make('', mode);

test('native text selection survives takeover before the next typed character', () => {
  const end = make('<p>A</p>', 'compose', { selection: { index: 1, length: 0 } });
  assert.equal(html(type(end, ' body')), '<p>A body</p>');
  const range = make('<p>one</p><p>two three</p>', 'compose', { selection: { index: 4, length: 3 } });
  assert.equal(html(type(range, 'new')), '<p>one</p><p>new three</p>');
  const clamped = make('<p>A</p>', 'compose', { selection: { index: 999, length: 999 } });
  assert.equal(html(type(clamped, 'B')), '<p>AB</p>');
  for (const selection of [{ index: -1, length: 0 }, { index: NaN, length: 1 }, { index: 1, length: 'x' }]) {
    assert.equal(make('<p>A</p>', 'compose', { selection }).selection.from, 1, 'invalid selection uses the normal start');
  }
});

test('marks toggle on a selection, and superscript and subscript exclude each other', () => {
  let st = select(make('<p>one two</p>'), 'two');
  for (const [name, tag] of [['bold', 'strong'], ['italic', 'em'], ['underline', 'u'], ['strike', 's'], ['sup', 'sup'], ['sub', 'sub']]) {
    const on = run(st, name);
    assert.equal(on.ok, true, name);
    assert.equal(html(on.st), `<p>one <${tag}>two</${tag}></p>`, name);
    assert.equal(html(run(on.st, name).st), '<p>one two</p>', `${name} off`);
  }
  const both = run(run(st, 'sup').st, 'sub').st;
  assert.equal(html(both), '<p>one <sub>two</sub></p>');
  st = run(run(st, 'bold').st, 'link', 'https://a.b').st;
  assert.equal(html(st), '<p>one <a href="https://a.b" rel="noopener noreferrer" target="_blank"><strong>two</strong></a></p>');
  assert.equal(run(select(make('<pre>code</pre>'), 'code'), 'bold').ok, false, 'no marks in code');
});

test('link sets, updates and removes the link at the caret, and refuses what Quill would blank', () => {
  let st = run(select(make('<p>see the site</p>'), 'site'), 'link', 'example.com').st;
  assert.equal(html(st), '<p>see the <a href="https://example.com" rel="noopener noreferrer" target="_blank">site</a></p>');
  st = caret(st, 'si');
  assert.equal(E.active(st).link, 'https://example.com');
  st = run(st, 'link', 'https://other.example/x').st;
  assert.match(html(st), /<a href="https:\/\/other\.example\/x"[^>]*>site<\/a>/, 'the whole link changes');
  assert.equal(html(run(st, 'link', null).st), '<p>see the site</p>');
  for (const bad of ['javascript:alert(1)', 'data:text/html,x', 'nope']) assert.equal(run(st, 'link', bad).ok, false, bad);
  assert.equal(run(caret(make('<p>no link</p>'), 'no'), 'link', null).ok, false);
  const inserted = run(caret(make('<p>go&nbsp;</p>'), 'go '), 'link', 'mailto:a@b.c').st;
  assert.equal(html(inserted), '<p>go <a href="mailto:a@b.c" rel="noopener noreferrer" target="_blank">mailto:a@b.c</a></p>', 'an empty selection inserts the address');
});

test('lists toggle, convert and split by line, keep each line\'s indent and alignment, and merge with their neighbours', () => {
  let st = run(everything(make('<p>one</p><p class="ql-indent-1 ql-align-center">two</p><h3>three</h3>')), 'bulletList').st;
  assert.equal(html(st), '<ul><li>one</li><li class="ql-indent-1 ql-align-center">two</li><li>three</li></ul>');
  st = run(caret(st, 'two'), 'orderedList').st;
  assert.equal(html(st), '<ul><li>one</li></ul><ol><li class="ql-indent-1 ql-align-center">two</li></ol><ul><li>three</li></ul>');
  st = run(st, 'orderedList').st;
  assert.equal(html(st), '<ul><li>one</li></ul><p class="ql-indent-1 ql-align-center">two</p><ul><li>three</li></ul>');
  st = run(caret(st, 'two'), 'bulletList').st;
  assert.equal(html(st), '<ul><li>one</li><li class="ql-indent-1 ql-align-center">two</li><li>three</li></ul>', 'neighbours merge');
  assert.equal(html(run(everything(st), 'bulletList').st), '<p>one</p><p class="ql-indent-1 ql-align-center">two</p><p>three</p>', 'all in the list: off');
  const removed = make('<ol><li>a</li></ol><p>b</p><ol><li>c</li></ol>');
  const r = find(removed, 'b'), $b = removed.doc.resolve(r.from);
  assert.equal(html(removed.apply(removed.tr.delete($b.before(), $b.after()))), '<ol><li>a</li><li>c</li></ol>', 'adjacent lists join after any edit');
  assert.equal(run(select(make('<pre>x</pre>'), 'x'), 'bulletList').ok, false, 'code stays code');
  const sel = run(select(make('<p>keep me</p>'), 'me'), 'orderedList').st;
  assert.equal(sel.doc.textBetween(sel.selection.from, sel.selection.to), 'me', 'the selection follows');
});

test('heading takes only the levels the schema has; 0 makes headings plain; a list line leaves its list', () => {
  let st = caret(make('<p>Title</p>'), 'Title');
  assert.equal(html(run(st, 'heading', 3).st), '<h3>Title</h3>');
  assert.equal(html(run(st, 'heading', 4).st), '<h4>Title</h4>');
  for (const level of [1, 2, 5]) assert.equal(run(st, 'heading', level).ok, false, `compose h${level}`);
  assert.equal(html(run(run(st, 'heading', 3).st, 'heading', 0).st), '<p>Title</p>');
  assert.equal(run(st, 'heading', 0).ok, false, 'already plain');
  st = run(caret(make('<ul><li>a</li><li class="ql-align-right">b</li><li>c</li></ul>'), 'b'), 'heading', 4).st;
  assert.equal(html(st), '<ul><li>a</li></ul><h4 class="ql-align-right">b</h4><ul><li>c</li></ul>');
  const paper = caret(make('<p>T</p>', 'paper'), 'T');
  for (const level of [1, 2, 3, 4]) assert.equal(html(run(paper, 'heading', level).st), `<h${level}>T</h${level}>`);
  assert.equal(run(paper, 'heading', 5).ok, false);
});

test('indent and outdent step 0 to 8 on paragraphs, headings and items; align sets every line', () => {
  let st = everything(make('<p>p</p><h3>h</h3><ul><li class="ql-indent-7">i</li></ul>'));
  st = run(st, 'indent').st;
  assert.equal(html(st), '<p class="ql-indent-1">p</p><h3 class="ql-indent-1">h</h3><ul><li class="ql-indent-8">i</li></ul>');
  assert.equal(html(run(st, 'indent').st), '<p class="ql-indent-2">p</p><h3 class="ql-indent-2">h</h3><ul><li class="ql-indent-8">i</li></ul>', 'the deepest stays at 8');
  assert.equal(run(caret(make('<p>x</p>'), 'x'), 'outdent').ok, false);
  assert.equal(html(run(run(st, 'outdent').st, 'outdent').st), '<p>p</p><h3>h</h3><ul><li class="ql-indent-6">i</li></ul>');
  for (const dir of ['center', 'right', 'justify']) assert.equal(html(run(st, 'align', dir).st), `<p class="ql-indent-1 ql-align-${dir}">p</p><h3 class="ql-indent-1 ql-align-${dir}">h</h3><ul><li class="ql-indent-8 ql-align-${dir}">i</li></ul>`);
  assert.equal(html(run(run(st, 'align', 'center').st, 'align', 'left').st), html(st));
  assert.equal(run(st, 'align', 'middle').ok, false);
  assert.equal(run(st, 'align', 'left').ok, false, 'already left');
});

test('clear removes formatting but keeps links; with no selection it clears what typing would carry', () => {
  const st = make('<p><a href="https://a.b"><strong><em>x</em></strong></a><u>y</u><sup>2</sup></p>');
  assert.equal(html(run(everything(st), 'clear').st), '<p><a href="https://a.b" rel="noopener noreferrer" target="_blank">x</a>y2</p>');
  assert.equal(run(everything(make('<p>plain</p>')), 'clear').ok, false);
  const stored = run(caret(make('<p><strong>bold</strong></p>'), 'bold'), 'clear');
  assert.equal(stored.ok, true);
  assert.equal(html(type(stored.st, '!')), '<p><strong>bold</strong>!</p>');
});

test('undo and redo go through history, one step per command', () => {
  const st = select(make('<p>one two</p>'), 'two');
  const bold = run(st, 'bold').st;
  const undone = run(bold, 'undo');
  assert.equal(undone.ok, true);
  assert.equal(html(undone.st), '<p>one two</p>');
  assert.equal(html(run(undone.st, 'redo').st), '<p>one <strong>two</strong></p>');
  assert.equal(run(st, 'undo').ok, false, 'nothing to undo');
  assert.equal(html(press(type(caret(make('<p>a</p>'), 'a'), 'bc'), 'Mod-z').st), '<p>a</p>');
});

test('quote: indented italic lines and "— Name" in compose, a blockquote in paper; typing goes on below', () => {
  const said = { text: 'The first line.\n\n  The   second line. ', author: ' Ada  Lovelace ' };
  let st = run(blank(), 'quote', said).st;
  assert.equal(html(st), '<p class="ql-indent-1"><em>The first line.</em></p><p class="ql-indent-1"><em>The second line.</em></p><p class="ql-indent-1">— Ada Lovelace</p><p><br></p>');
  assert.equal(E.active(st).italic, false);
  assert.equal(html(type(st, 'My reply')).endsWith('<p>My reply</p>'), true);
  st = run(caret(make('<p>Before</p><p>After</p>'), 'Bef'), 'quote', { text: 'q' }).st;
  assert.equal(html(st), '<p>Before</p><p class="ql-indent-1"><em>q</em></p><p><br></p><p>After</p>', 'after the block, without a name line');
  assert.equal(html(run(blank('paper'), 'quote', said).st), '<blockquote><p>The first line.</p><p>The second line.</p><p>— Ada Lovelace</p></blockquote><p><br></p>');
  assert.equal(run(blank(), 'quote', { text: ' \n ' }).ok, false);
});

test('insertText adds plain text in the current marks; a newline starts a block like the one it is in', () => {
  assert.equal(html(run(caret(make('<p>one</p>'), 'one'), 'insertText', ' two\nthree').st), '<p>one two</p><p>three</p>');
  assert.equal(html(run(caret(make('<ul><li class="ql-indent-1"><strong>a</strong></li></ul>'), 'a'), 'insertText', 'b\nc').st), '<ul><li class="ql-indent-1"><strong>ab</strong></li><li class="ql-indent-1"><strong>c</strong></li></ul>');
  assert.equal(html(run(caret(make('<pre>x</pre>'), 'x'), 'insertText', '\ny').st), '<pre class="ql-syntax" spellcheck="false">x\ny\n</pre>');
  assert.equal(run(blank(), 'insertText', '').ok, false);
});

test('insertText replaces the selection even when its first line is empty', () => {
  for (const mode of ['compose', 'paper']) {
    const st = select(make('<p>a😀c</p>', mode), '😀');
    const inserted = run(st, 'insertText', '\n');
    assert.equal(html(inserted.st), '<p>a</p><p>c</p>');
    assert.equal(inserted.st.selection.empty, true);
    assert.equal(S.text(inserted.st.doc).offsetAt(inserted.st.selection.from), 2);
    assert.equal(html(run(inserted.st, 'undo').st), '<p>a😀c</p>');
  }
});

test('paper only: page breaks split the paragraph, footnotes keep their text, line spacing is set per line', () => {
  const compose = E.commands(S.compose);
  for (const name of ['pageBreak', 'footnote', 'lineSpacing']) assert.equal(name in compose, false, name);
  let st = run(caret(make('<p>abcdef</p>', 'paper'), 'abc'), 'pageBreak').st;
  assert.equal(html(st), '<p>abc</p><hr class="gz-page-break"><p>def</p>');
  assert.equal(st.selection.$from.parent.textContent, 'def');
  assert.equal(st.selection.$from.parentOffset, 0);
  assert.equal(html(run(caret(make('<p>abc</p>', 'paper'), 'abc'), 'pageBreak').st), '<p>abc</p><hr class="gz-page-break"><p><br></p>');
  assert.equal(html(run(caret(make('<p>abc</p>', 'paper'), 'abc', 'start'), 'pageBreak').st), '<hr class="gz-page-break"><p>abc</p>');
  st = run(caret(make('<p>abcdef</p>', 'paper'), 'abc'), 'footnote', 'See <em>Ibid.</em><script>x</script>').st;
  assert.equal(html(st), '<p>abc<sup class="gz-footnote" data-footnote="See &lt;em&gt;Ibid.&lt;/em&gt;"></sup>def</p>');
  st = everything(make('<p>a</p><ul><li>b</li></ul>', 'paper'));
  assert.equal(html(run(st, 'lineSpacing', 2).st), '<p style="line-height:2">a</p><ul><li style="line-height:2">b</li></ul>');
  assert.equal(html(run(run(st, 'lineSpacing', 1.5).st, 'lineSpacing', null).st), '<p>a</p><ul><li>b</li></ul>');
  assert.equal(run(st, 'lineSpacing', 9).ok, false);
});

test('Markdown shortcuts make what the schema holds: marks, links, lists, quotes, headings', () => {
  assert.equal(html(type(blank(), 'a **bold** and *it* b')), '<p>a <strong>bold</strong> and <em>it</em> b</p>');
  assert.equal(html(type(blank(), '2*3*4 and **x * y')), '<p>2*3*4 and **x * y</p>', 'arithmetic and unclosed markers stay text');
  assert.equal(html(type(blank(), 'see [Glaze](frostdev.io) now')), '<p>see <a href="https://frostdev.io" rel="noopener noreferrer" target="_blank">Glaze</a> now</p>');
  assert.equal(html(type(blank(), '[x](javascript:alert(1))')), '<p>[x](javascript:alert(1))</p>');
  assert.equal(html(type(blank(), '- one')), '<ul><li>one</li></ul>');
  assert.equal(html(type(blank(), '* one')), '<ul><li>one</li></ul>');
  assert.equal(html(type(blank(), '1. one')), '<ol><li>one</li></ol>');
  assert.equal(html(type(blank(), '1) one')), '<ol><li>one</li></ol>');
  assert.equal(html(type(blank(), '2. two')), '<p>2. two</p>');
  assert.equal(html(type(caret(make('<ul><li>x</li></ul>'), 'x', 'start'), '- ')), '<ul><li>- x</li></ul>', 'already a bullet');
  assert.equal(html(type(blank(), 'mid - not a list')), '<p>mid - not a list</p>');
  assert.equal(html(type(blank(), '> quoted')), '<p class="ql-indent-1"><em>quoted</em></p>', 'compose: the quote shape');
  assert.equal(html(type(blank('paper'), '> quoted')), '<blockquote><p>quoted</p></blockquote>');
  assert.equal(html(type(blank(), '# Big')), '<h3>Big</h3>');
  assert.equal(html(type(blank(), '## Small')), '<h4>Small</h4>');
  assert.equal(html(type(blank(), '### none')), '<p>### none</p>', 'compose has two levels');
  for (const n of [1, 2, 3, 4]) assert.equal(html(type(blank('paper'), `${'#'.repeat(n)} H`)), `<h${n}>H</h${n}>`);
  assert.equal(html(type(blank('paper'), '##### H')), '<p>##### H</p>');
  const below = make('<ol><li>a</li></ol><p><br></p>');
  assert.equal(html(type(below.apply(below.tr.setSelection(TextSelection.create(below.doc, below.doc.content.size - 1))), '1. b')), '<ol><li>a</li><li>b</li></ol>', 'joins the list above');
});

test('smart quotes and dashes, never in code, and Backspace takes one back', () => {
  assert.equal(S.text(type(blank(), `"Hi," she said -- 'it's (done)' "ok"`).doc).text, '“Hi,” she said — ‘it’s (done)’ “ok”');
  const inCode = caret(make('<pre>x</pre>'), 'x');
  assert.equal(S.text(type(inCode, ` "a" 'b' -- **c** - `).doc).text, `x "a" 'b' -- **c** - `);
  const quoted = type(caret(make('<p>say</p>'), 'say'), ' "');
  assert.equal(S.text(quoted.doc).text, 'say “');
  assert.equal(S.text(press(quoted, 'Backspace').st.doc).text, 'say "', 'the rule undone, the typed character kept');
  assert.equal(html(press(type(blank(), '- '), 'Backspace').st), '<p>-&nbsp;</p>');
});

test('input rules leave existing links and Unicode word interiors literal', () => {
  const st = caret(make('<p><a href="https://a.b">https://a.b/path</a></p>'), 'https:');
  assert.equal(S.text(type(st, '--').doc).text, 'https:--//a.b/path');
  for (const word of ['сло*во*', 'مق*طع*', '漢*字*', 'e\u0301*x*']) assert.equal(S.text(type(blank(), word).doc).text, word);
  assert.equal(html(type(blank(), 'слово *да*')), '<p>слово <em>да</em></p>');
  assert.equal(S.text(type(blank(), '«Привет» -- l\'été').doc).text, '«Привет» — l’été');
});

test('a Markdown link preserves the existing marks inside its label', () => {
  const st = caret(make('<p>[<strong>bold</strong> <em>it</em>](https://a.b</p>'), 'https://a.b');
  assert.equal(html(type(st, ')')), '<p><a href="https://a.b" rel="noopener noreferrer" target="_blank"><strong>bold</strong> <em>it</em></a></p>');
});

test('Shift-Enter in paper code inserts a newline without leaving the code block', () => {
  const st = caret(make('<pre>a😀c</pre>', 'paper'), 'a');
  const split = press(st, 'Shift-Enter').st;
  assert.equal(html(split), '<pre class="ql-syntax" spellcheck="false">a\n😀c\n</pre>');
  assert.equal(split.selection.$from.parent.type.name, 'code_block');
  assert.equal(html(run(split, 'undo').st), '<pre class="ql-syntax" spellcheck="false">a😀c\n</pre>');
});

test('Enter, Backspace and Tab behave as in Quill and Word around lists and indents', () => {
  let st = caret(make('<ul><li>a</li><li class="ql-indent-1"><br></li></ul>'), 'a');
  st = st.apply(st.tr.setSelection(TextSelection.create(st.doc, st.doc.content.size - 2)));
  st = press(st, 'Enter').st;
  assert.equal(html(st), '<ul><li>a</li><li><br></li></ul>', 'an empty indented item outdents');
  assert.equal(html(press(st, 'Enter').st), '<ul><li>a</li></ul><p><br></p>', 'then leaves the list');
  assert.equal(html(press(caret(make('<ol><li>ab</li></ol>'), 'a'), 'Enter').st), '<ol><li>a</li><li>b</li></ol>');
  assert.equal(html(press(caret(make('<h3 class="ql-align-center">T</h3>'), 'T'), 'Enter').st), '<h3 class="ql-align-center">T</h3><p class="ql-align-center"><br></p>');
  assert.equal(html(press(caret(make('<p class="ql-indent-2">p</p>'), 'p'), 'Enter').st), '<p class="ql-indent-2">p</p><p class="ql-indent-2"><br></p>');
  assert.equal(html(press(caret(make('<pre>x</pre>'), 'x'), 'Enter').st), '<pre class="ql-syntax" spellcheck="false">x\n\n</pre>');
  assert.equal(html(press(caret(make('<p>a</p><p class="ql-indent-1">b</p>'), 'b', 'start'), 'Backspace').st), '<p>a</p><p>b</p>');
  assert.equal(html(press(caret(make('<ul><li>a</li><li>b</li></ul>'), 'b', 'start'), 'Backspace').st), '<ul><li>a</li></ul><p>b</p>');
  assert.equal(html(press(caret(make('<p>a</p><p>b</p>'), 'b', 'start'), 'Backspace').st), '<p>ab</p>', 'otherwise the usual join');
  const items = select(make('<ul><li>a</li><li>b</li></ul>'), 'b');
  assert.equal(html(press(items, 'Tab').st), '<ul><li>a</li><li class="ql-indent-1">b</li></ul>');
  assert.equal(html(press(press(items, 'Tab').st, 'Shift-Tab').st), '<ul><li>a</li><li>b</li></ul>');
  assert.equal(press(items, 'Shift-Tab').ok, true, 'Tab stays in a list even at the edge');
  assert.equal(html(press(caret(make('<p>ab</p>'), 'a'), 'Tab').st), '<p>a\tb</p>', 'outside a list Tab writes a tab, as Quill does');
  assert.equal(html(press(caret(make('<p>ab</p>', 'paper'), 'a'), 'Tab').st), '<p>a\tb</p>', 'and as Word does');
  assert.equal(press(caret(make('<p>a</p>'), 'a'), 'Shift-Tab').ok, true, 'Shift-Tab stays in the document too');
  assert.equal(press(caret(make('<p>a</p>'), 'a'), 'Tab', undefined, { now: true }).ok, false, 'after Escape, Tab leaves the editor');
  assert.equal(press(items, 'Shift-Tab', undefined, { now: true }).ok, false, 'and Shift-Tab, even in a list');
  assert.equal(html(press(caret(make('<p>ab</p>'), 'a'), 'Shift-Enter').st), '<p>a</p><p>b</p>', 'compose has no line break');
  assert.equal(html(press(caret(make('<p>ab</p>', 'paper'), 'a'), 'Shift-Enter').st), '<p>a<br>b</p>');
  assert.equal(html(press(select(make('<p>ab</p>'), 'b'), 'Mod-b').st), '<p>a<strong>b</strong></p>');
});

test('a tab survives the round trips: Quill\'s HTML, its delta, and the paper\'s .docx', () => {
  const st = press(caret(make('<p>ab</p>'), 'a'), 'Tab').st;
  assert.equal(S.serialize(st.schema, S.parse(st.schema, html(st))), '<p>a\tb</p>', 'parsed back from the HTML Quill keeps');
  assert.deepEqual(S.delta(st.doc).map((o) => o.insert).join(''), 'a\tb\n', 'the delta written into Ultra\'s Quill');
  const X = require('../lib/writer-docx.js');
  const paper = press(caret(make('<p>ab</p>', 'paper'), 'a'), 'Tab').st;
  assert.match(X.exportDocx(paper.doc, { format: 'mla9', date: new Date(2026, 9, 27) }).parts['word/document.xml'], /<w:t xml:space="preserve">a<\/w:t><w:tab\/><w:t xml:space="preserve">b<\/w:t>/, 'a tab is a Word tab');
});

test('Escape used by an IME does not arm Tab to leave the editor', () => {
  const st = make('<p>words</p>'), handlers = new Map();
  const dom = { addEventListener: (name, fn) => handlers.set(name, fn), removeEventListener: (name) => handlers.delete(name) };
  const v = { dom, composing: false };
  const leave = st.plugins.find((p) => p.spec.view).spec.view(v);
  const key = (key, extra = {}) => handlers.get('keydown')({ key, ...extra });
  const tabHandled = () => st.plugins.some((p) => p.props.handleKeyDown?.({ state: st, dispatch() {} }, { key: 'Tab', keyCode: 9 }));
  try {
    v.composing = true;
    key('Escape');
    v.composing = false;
    key('Tab');
    assert.equal(tabHandled(), true, 'Escape cancelled composition; Tab still writes a tab');
    key('Escape', { isComposing: true });
    key('Tab');
    assert.equal(tabHandled(), true, 'the event composition flag is respected too');
    key('Escape');
    handlers.get('compositionstart')?.();
    key('Tab');
    assert.equal(tabHandled(), true, 'starting composition disarms a previous Escape');
    key('Escape'); key('Shift'); key('Tab');
    assert.equal(tabHandled(), false, 'an ordinary Escape still releases the next Tab');
  } finally { leave.destroy(); }
});

test('opts.keys and opts.plugins come first, so the frame, proofing and ghost text win their keys', () => {
  let sent = 0;
  const keys = { 'Mod-Enter': () => { sent++; }, Tab: () => false };
  const st = make('<ul><li>a</li></ul>', 'compose', { keys });
  assert.equal(press(st, 'Mod-Enter', keys).ok, true);
  assert.equal(sent, 1);
  assert.equal(press(select(st, 'a'), 'Tab', keys).ok, false, 'a key that returns false falls through');
  const mine = new Plugin({});
  assert.equal(make('', 'compose', { plugins: [mine] }).plugins[0], mine);
});

test('active() reports marks over the whole selection, the link, and the line', () => {
  let a = E.active(select(make('<p><strong>all</strong> half</p>'), 'all'));
  assert.equal(a.bold, true);
  a = E.active(select(make('<p><strong>all</strong> half</p>'), 'all half'));
  assert.equal(a.bold, false);
  a = E.active(caret(make('<ol><li class="ql-indent-2 ql-align-justify"><a href="https://a.b"><em>x</em></a></li></ol>'), 'x', 'start'));
  assert.deepEqual(a, { bold: false, italic: true, underline: false, strike: false, sup: false, sub: false, link: 'https://a.b', heading: 0, list: 'ordered', align: 'justify', indent: 2, code: false });
  assert.equal(E.active(caret(make('<h4>h</h4>'), 'h')).heading, 4);
  assert.equal(E.active(caret(make('<pre>c</pre>'), 'c')).code, true);
  const paper = E.active(caret(make('<blockquote><p style="line-height:2"><span style="font-family:Arial;font-size:11pt">q</span></p></blockquote>', 'paper'), 'q', 'start'));
  assert.equal(paper.quote, true);
  assert.equal(paper.lineSpacing, 2);
  assert.equal(paper.font, 'Arial');
  assert.equal(paper.size, 11);
});

test('the editor root says when it is blank, for the placeholder', () => {
  const look = (st) => st.plugins.map((p) => p.props.attributes).find(Boolean)(st);
  const st = make('', 'compose', { placeholder: 'Type a reply' });
  assert.deepEqual(look(st), { class: 'gz-writer gz-blank', role: 'textbox', 'aria-multiline': 'true', 'data-placeholder': 'Type a reply' });
  assert.equal(look(type(st, 'x')).class, 'gz-writer');
  assert.equal(look(make('<ul><li><br></li></ul>')).class, 'gz-writer', 'an empty list item is not blank');
});

test('words counts space-separated runs with a letter or digit', () => {
  assert.equal(E.words("Hello, world — 3.5 e-mail don't \u{1F600}  "), 5);
  assert.equal(E.words(''), 0);
  assert.equal(E.words(S.text(S.parse(S.compose, '<p>one two</p><ul><li>three</li></ul>')).text), 3);
  assert.equal(typeof E.create, 'function');
});
