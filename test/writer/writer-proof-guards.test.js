// Autocorrect as you type (writer/writer-proof.js) is English proofing: a paragraph that reads as another language, a
// quotation, a block quote and a code variable named i are left as typed, and its apostrophes follow Smart quotes.
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../../extension/writer/writer-schema.js');
const E = require('../../extension/writer/writer-editor.js');
const P = require('../../extension/writer/writer-proof.js');
const I = require('../../extension/writer/writer-issues.js');

const editor = (html = '', o = {}) => {
  const view = { composing: false, state: null, dispatch(tr) { this.state = this.state.apply(tr); } };
  view.state = E.state({ html, mode: o.mode || 'compose', plugins: [P.plugin({ allow: o.allow }), I.plugin()] });
  const proof = view.state.plugins.find((p) => p.spec.key === P.key), rules = view.state.plugins.find((p) => p.spec.isInputRules);
  const type = (text) => {
    for (const ch of text) {
      const { from, to } = view.state.selection;
      if (proof.props.handleTextInput(view, from, to, ch)) continue;
      if (rules.props.handleTextInput(view, from, to, ch)) continue;
      view.dispatch(view.state.tr.insertText(ch, from, to));
    }
  };
  const text = () => S.text(view.state.doc).text;
  const at = (needle) => { const t = S.text(view.state.doc), i = t.text.indexOf(needle); return { from: t.posAt(i), to: t.posAt(i + needle.length) }; };
  return { view, type, text, at };
};
const typed = (s, o) => { const e = editor('', o); e.type(s); return e.text(); };

test('a paragraph in another language keeps its doubled words and its lone i', () => {
  for (const s of ['Mais nous nous ', 'Elle dit que nous nous sommes trompés. ', 'Je crois que que ', 'Vous vous trompez. ', 'Dijo que sí sí ', 'Ich glaube, dass sie sie ',
    'Esco con i miei amici e i ', 'Jeg bor i ', 'Nie wiem, czy Ala i ', 'He told us, nous nous ']) assert.equal(typed(s), s, s);
  assert.equal(typed('so i think the the end '), 'so I think the end ', 'English still');
  assert.equal(typed('I think teh '), 'I think the ');
  assert.equal(typed('The film Les Misérables is is '), 'The film Les Misérables is is ', 'a real doubled verb stays (TWICE)');
  assert.equal(typed('We saw Les Misérables and teh '), 'We saw Les Misérables and the ', 'a title in another language does not make the paragraph French');
});

test('a sure Harper fix in a paragraph in another language is not made', () => {
  const e = editor();
  e.type('Mais nous nous sommes trompés');
  assert.equal(P.autofix(e.view, { ...e.at('nous nous'), suggestions: ['nous'], rule: 'Repetition' }), null);
  assert.equal(e.text(), 'Mais nous nous sommes trompés');
});

test('a variable named i stays lower case', () => {
  for (const s of ['the loop variable i ', 'for each index i ', 'where row i ', 'let i ']) assert.equal(typed(s), s, s);
  assert.equal(typed('and then i '), 'and then I ');
});

test('inside a quotation or a block quote, what is typed stays as typed', () => {
  assert.equal(typed('She wrote "I saw teh '), 'She wrote “I saw teh ');
  assert.equal(typed('She wrote "I saw it" and teh '), 'She wrote “I saw it” and the ');
  assert.equal(typed('Il a dit « teh '), 'Il a dit « teh ');
  const e = editor('<blockquote><p>Quoted</p></blockquote>', { mode: 'paper' });
  e.view.dispatch(e.view.state.tr.setSelection(GZ_PM.state.TextSelection.create(e.view.state.doc, 1 + 1 + 'Quoted'.length)));
  e.type(' teh ');
  assert.equal(e.text(), 'Quoted teh ');
});

test('with Smart quotes off a contraction gets a straight apostrophe, on a curly one', () => {
  assert.equal(typed('Take thats ', { allow: (c) => c !== 'smart' }), "Take that's ");
  assert.equal(typed('Take thats '), 'Take that’s ');
  assert.equal(typed('It doesnt ', { allow: (c) => c !== 'smart' }), "It doesn't ");
});
