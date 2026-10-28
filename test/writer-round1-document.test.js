const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const S = require('../lib/writer-schema.js');
const E = require('../lib/writer-editor.js');
const ST = require('../lib/writer-styles.js');
const X = require('../lib/writer-docx.js');

test('whole-paper replacement restores every document attribute and undoes independently', () => {
  const source = fs.readFileSync(require('node:path').join(__dirname, '../writer-paper.js'), 'utf8');
  const from = source.indexOf('    const setDoc = '), to = source.indexOf('    const setFormat = ', from);
  const view = { state: E.state({ mode: 'paper', html: '<p>before</p>' }), dispatch(tr) { this.state = this.state.apply(tr); } };
  view.state = view.state.apply(view.state.tr.setDocAttribute('paste', 'match'));
  const setDoc = vm.runInNewContext(`${source.slice(from, to)} setDoc`, { S, PM: GZ_PM, view, formatIssues: [], picked: null });
  const replacement = S.paper.node('doc', { paste: 'keep' }, [S.paper.node('paragraph', null, S.paper.text('after'))]);
  setDoc(replacement.toJSON());
  assert.equal(view.state.doc.attrs.paste, 'keep');
  E.commands(S.paper).undo()(view.state, (tr) => view.dispatch(tr));
  assert.equal(view.state.doc.attrs.paste, 'match');
  assert.equal(view.state.doc.textContent, 'before');
  E.commands(S.paper).redo()(view.state, (tr) => view.dispatch(tr));
  assert.equal(view.state.doc.attrs.paste, 'keep');
  setDoc(S.paper.node('doc', null, [S.paper.node('paragraph')]).toJSON());
  assert.equal(view.state.doc.attrs.paste, null, 'an imported paper must not inherit the previous paper preference');
});

test('a heading can explicitly align left through commands, HTML and Word', async () => {
  let st = E.state({ mode: 'paper', html: '<h1>Heading</h1>' });
  E.commands(S.paper).align('left')(st, (tr) => { st = st.apply(tr); });
  assert.equal(st.doc.firstChild.attrs.align, 'left');
  assert.equal(S.parse(S.paper, S.serialize(S.paper, st.doc)).firstChild.attrs.align, 'left');
  const out = X.exportDocx(st.doc, { format: 'apa7' });
  assert.match(out.parts['word/document.xml'], /<w:jc w:val="left"/);
  const back = await X.importDocx(out.bytes, { format: 'apa7' });
  assert.equal(back.doc.content[0].attrs.align, 'left');
});

test('the Paragraph dialog retains left when a format centres a heading', () => {
  const patch = ST.paraAttrs(ST.FORMATS.apa7, { heading: 1 }, { align: 'left' });
  assert.equal(patch.align, 'left');
  let st = E.state({ mode: 'paper', html: '<h1>Heading</h1>' });
  E.commands(S.paper).paragraph(patch)(st, (tr) => { st = st.apply(tr); });
  assert.equal(st.doc.firstChild.attrs.align, 'left');
});
