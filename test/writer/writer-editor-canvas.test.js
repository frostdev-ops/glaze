// writer/writer-editor.js over Canvas's documents: the canvas dialect (compose's editing, with a real <blockquote> for
// quotes, D4) and plain mode (the Inbox: paragraphs of text, nothing to format). The frame picks them from init's site and
// mode (writer/frame/writer.js); this is the editor's side, at the EditorState level as test/writer/writer-editor.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../../extension/writer/writer-schema.js');
const E = require('../../extension/writer/writer-editor.js');
const { TextSelection } = GZ_PM.state;
const { baseKeymap } = GZ_PM.commands;

const html = (st) => S.serialize(st.schema, st.doc);
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
const press = (st, key) => {
  let next = st;
  const dispatch = (tr) => { next = st.apply(tr); };
  const own = E.bindings(st.schema)[key];
  const ok = (own && own(st, dispatch)) || (baseKeymap[key] ? baseKeymap[key](st, dispatch) : false);
  return { ok: !!ok, st: next };
};
const end = (st) => st.apply(st.tr.setSelection(TextSelection.atEnd(st.doc)));

test('the dialect picks the schema: canvas and plain on Canvas, compose and paper as before', () => {
  assert.equal(E.state({ dialect: 'canvas' }).schema, S.canvas);
  assert.equal(E.state({ dialect: 'plain' }).schema, S.plain);
  assert.equal(E.state({ mode: 'compose' }).schema, S.compose);
  assert.equal(E.state({ mode: 'paper' }).schema, S.paper);
  assert.equal(E.state({ mode: 'paper', dialect: 'canvas' }).schema, S.paper, 'a paper stays a paper');
  assert.equal(E.state({ dialect: 'other' }).schema, S.compose);
});

test('canvas: a quote is a real blockquote (D4), from the command and from Markdown\'s >', () => {
  let st = end(E.state({ dialect: 'canvas', html: '<p>Before</p>' }));
  E.commands(st.schema).quote({ text: 'First line\nSecond line', author: 'Kim Lee' })(st, (tr) => { st = st.apply(tr); });
  assert.equal(html(st), '<p>Before</p><blockquote><p>First line</p><p>Second line</p><p>— Kim Lee</p></blockquote><p><br></p>');
  st = type(E.state({ dialect: 'canvas' }), '> quoted');
  assert.equal(html(st), '<blockquote><p>quoted</p></blockquote>');
  assert.equal(html(type(E.state({ mode: 'compose' }), '> quoted')), '<p class="ql-indent-1"><em>quoted</em></p>', 'Ultra\'s compose is unchanged');
});

test('canvas: compose\'s Markdown and keys write Canvas\'s dialect', () => {
  assert.equal(html(type(E.state({ dialect: 'canvas' }), '- item **bold**')), '<ul><li>item <strong>bold</strong></li></ul>');
  assert.equal(html(type(E.state({ dialect: 'canvas' }), '# Head')), '<h3>Head</h3>');
  let st = type(E.state({ dialect: 'canvas' }), 'one');
  st = press(st, 'Shift-Enter').st;
  assert.equal(html(type(st, 'two')), '<p>one</p><p>two</p>', 'no hard break in Canvas\'s dialect: a new paragraph');
});

test('plain: typing stays text; Markdown and formatting keys do nothing, smart quotes still curl', () => {
  let st = type(E.state({ dialect: 'plain' }), '- not a list **not bold** "quoted" -- ');
  assert.equal(html(st), '<p>- not a list **not bold** “quoted” — </p>');
  for (const key of ['Mod-b', 'Mod-i', 'Mod-u', 'Shift-Mod-8', 'Shift-Mod-x', 'Mod-\\']) assert.equal(press(st, key).st.doc.eq(st.doc), true, key);
  st = press(end(st), 'Enter').st;
  assert.equal(html(type(st, 'next')), '<p>- not a list **not bold** “quoted” — </p><p>next</p>');
  assert.equal(html(type(E.state({ dialect: 'plain', rulesOff: () => true }), '"as typed"')), '<p>"as typed"</p>');
});

test('plain: every command answers without throwing, and none formats', () => {
  const st = E.state({ dialect: 'plain', html: '<p>Hello</p>' }), cmds = E.commands(S.plain);
  for (const [name, make] of Object.entries(cmds)) {
    let next = st;
    assert.doesNotThrow(() => make(name === 'link' ? 'https://a.test' : name === 'heading' ? 3 : undefined)(st, (tr) => { next = st.apply(tr); }), name);
    if (!['insertText', 'quote', 'undo', 'redo'].includes(name)) assert.equal(next.doc.eq(st.doc), true, name);
  }
  let next = end(st);
  cmds.quote({ text: 'Said', author: 'Ann' })(next, (tr) => { next = next.apply(tr); });
  assert.equal(html(next), '<p>Hello</p><p>Said</p><p>— Ann</p><p><br></p>', 'a quote in plain text is its lines');
});

test('plain: the frame\'s object plugins (autolinks, rules, numbering) have nothing to do in the Inbox\'s text, and load without error', () => {
  const O = require('../../extension/writer/writer-objects.js');
  assert.deepEqual(O.plugins(S.plain), []);
  assert.ok(O.plugins(S.canvas).length > 0, 'Canvas\'s dialect keeps them');
});
