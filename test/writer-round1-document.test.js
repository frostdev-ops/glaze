const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const S = require('../lib/writer-schema.js');
const E = require('../lib/writer-editor.js');

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
