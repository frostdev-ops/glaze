// lib/writer-proof.js's sure fixes, final review: the capital-I fix keeps abbreviations, list markers and maths variables
// as typed; the doubled-word fix keeps names and real reduplications. Typing goes through the plugins' handleTextInput.
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../lib/writer-schema.js');
const E = require('../lib/writer-editor.js');
const P = require('../lib/writer-proof.js');
const I = require('../lib/writer-issues.js');

const editor = () => {
  const view = { composing: false, state: null, dispatch(tr) { this.state = this.state.apply(tr); } };
  view.state = E.state({ html: '', mode: 'compose', plugins: [P.plugin({}), I.plugin()] });
  const proof = view.state.plugins.find((p) => p.spec.key === P.key), rules = view.state.plugins.find((p) => p.spec.isInputRules);
  const type = (s) => {
    for (const ch of s) {
      const { from, to } = view.state.selection;
      if (proof.props.handleTextInput(view, from, to, ch) || rules.props.handleTextInput(view, from, to, ch)) continue;
      view.dispatch(view.state.tr.insertText(ch, from, to));
    }
  };
  const text = () => S.text(view.state.doc).text;
  const at = (needle) => { const t = S.text(view.state.doc), i = t.text.indexOf(needle); assert.ok(i >= 0, needle); return { from: t.posAt(i), to: t.posAt(i + needle.length) }; };
  return { view, type, text, at };
};
const typed = (s) => { const e = editor(); e.type(s); return e.text(); };

test('capital I: i.e., roman-numeral markers and a maths variable before a comma stay as typed; the pronoun is fixed', () => {
  for (const s of ['We use many, i.e. most, of them.', 'i. First item', 'Let i, j be indices.', 'See (i) and (ii).']) assert.equal(typed(s), s, s);
  assert.equal(typed('i think so'), 'I think so');
  assert.equal(typed('and i went home.'), 'and I went home.');
  assert.equal(typed('i’m here, i’ll stay.'), 'I’m here, I’ll stay.');
  assert.equal(P.fix('many, i', new Set(), '.'), null, 'before a full stop it may be i.e. or a marker');
  assert.equal(P.fix('Let i', new Set(), ','), null, 'before a comma it may be a variable');
  assert.equal(P.fix('so i').now, 'I', 'a space after it is the pronoun');
  // Harper's Capitalization lint on the same i is sure: autofix keeps it as typed too.
  const e = editor();
  e.type('Let i, j be indices.');
  assert.equal(P.autofix(e.view, { ...e.at('i,'), to: e.at('i,').to - 1, suggestions: ['I'], rule: 'Capitalization', sure: true }), null);
  assert.equal(e.text(), 'Let i, j be indices.');
});

test('doubled words: a capitalised pair is a name and real reduplications are words; typos still collapse', () => {
  for (const s of ['We flew to Bora Bora', 'She studies at Walla Walla', 'They toured Pago Pago', 'The band Duran Duran', 'Bora Bora', 'I ate mahi mahi', 'It was so so', 'and then bye bye', 'a long long']) assert.equal(P.fix(s), null, s);
  assert.equal(typed('We flew to Bora Bora today.'), 'We flew to Bora Bora today.');
  assert.equal(typed('I ate mahi mahi today.'), 'I ate mahi mahi today.');
  assert.equal(P.fix('He liked the the').now, 'the');
  assert.equal(P.fix('The the').now, 'The', 'a sentence start capitalises the first only');
  assert.equal(P.fix('cats and and').now, 'and');
  // Harper's Repetition lint: sure only where this file's own fix would be.
  for (const [was, now] of [['Bora Bora', 'Bora'], ['Walla Walla', 'Walla'], ['mahi mahi', 'mahi']]) assert.equal(P.plausible('Repetition', was, now), false, was);
  assert.equal(P.plausible('Repetition', 'the the', 'the'), true);
  assert.equal(P.toIssue({ start: 11, end: 20, kind: 'Repetition', message: '', problem: 'Bora Bora', suggestions: [{ k: 0, t: 'Bora' }] }).sure, false);
});
