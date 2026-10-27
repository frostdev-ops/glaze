// lib/writer-proof.js and lib/writer-issues.js at the EditorState level: the sure fixes and where they never go, each fix
// one undo step, Harper's lints as issues, the text Harper reads, the context's words, and issues following edits. Typing
// goes through the plugins' own handleTextInput with a stand-in view, as test/writer-editor.test.js does. Harper itself
// (lib/harper/shared.js) is test/writer-proof-harper.test.js; the frame in a browser is scripts/writer-proof-check.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../lib/writer-schema.js');
const E = require('../lib/writer-editor.js');
const P = require('../lib/writer-proof.js');
const I = require('../lib/writer-issues.js');
const { TextSelection } = GZ_PM.state;
const { undo } = GZ_PM.history;

// A stand-in view over an editor state with proofing and issues in, as writer.js makes it.
const editor = (html = '', o = {}) => {
  const fixes = [];
  const view = {
    composing: false, state: null,
    dispatch(tr) { this.state = this.state.apply(tr); },
  };
  view.state = E.state({ html, mode: o.mode || 'compose', plugins: [P.plugin({ words: o.words, onFix: (_v, f) => fixes.push(f) }), I.plugin()] });
  const plugins = view.state.plugins;
  const proof = plugins.find((p) => p.spec.key === P.key), rules = plugins.find((p) => p.spec.isInputRules);
  const type = (text) => {
    for (const ch of text) {
      const { from, to } = view.state.selection;
      if (proof.props.handleTextInput(view, from, to, ch)) continue;
      if (rules.props.handleTextInput(view, from, to, ch)) continue;
      view.dispatch(view.state.tr.insertText(ch, from, to));
    }
    return view;
  };
  const text = () => S.text(view.state.doc).text;
  const at = (needle) => { const t = S.text(view.state.doc), i = t.text.indexOf(needle); assert.ok(i >= 0, needle); return { from: t.posAt(i), to: t.posAt(i + needle.length) }; };
  const caret = (pos) => view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)));
  const end = () => caret(view.state.doc.content.size - 1);
  const back = () => undo(view.state, (tr) => view.dispatch(tr));
  return { view, type, text, at, caret, end, back, fixes, proof, issues: I.bind(view) };
};

// ---- the sure fixes -----------------------------------------------------------------------------------------------
test('fix: the typo table, i → I and doubled words, as typed', () => {
  assert.deepEqual(P.fix('I think teh'), { from: 8, to: 11, was: 'teh', now: 'the', rule: 'typo' });
  assert.equal(P.fix('Teh'), null, 'a capital may be a name even at the start');
  assert.equal(P.fix('It ended. Teh'), null);
  assert.equal(P.fix('We met Teh'), null, 'a capital mid-sentence may be a name');
  assert.equal(P.fix('TEH'), null);
  assert.equal(P.fix('so i').now, 'I');
  assert.equal(P.fix('i’m').now, 'I’m');
  assert.equal(P.fix("i'll").now, "I'll");
  assert.equal(P.fix('you dont'), null, 'dont is a word in French');
  assert.deepEqual(P.fix('read the the'), { from: 5, to: 12, was: 'the the', now: 'the', rule: 'twice' });
  assert.equal(P.fix('what he had had'), null, 'doubled on purpose');
  assert.equal(P.fix('he said that that'), null);
  assert.equal(P.fix('the cat'), null, 'a word');
  assert.equal(P.fix('their'), null, 'a real word is never in the table');
  for (const [k, v] of Object.entries(P.TYPOS)) { assert.notEqual(k, v); assert.match(k, /^[a-z]+$/); }
  for (const word of ['form', 'from', 'its', 'your', 'wont', 'cant', 'ill', 'there', 'then', 'than', 'lose', 'loose', 'affect', 'effect']) assert.ok(!Object.hasOwn(P.TYPOS, word), word);
});

test('fix: never in an address, a path, a handle, code-like or numbered tokens, nor a word taken back', () => {
  for (const s of ['www.teh', 'teh@school.edu x teh@school', 'http://teh', 'see teh.com/teh', 'a_teh', 'file/teh', '2teh', 'myTeh', '#teh']) assert.equal(P.fix(s), null, s);
  assert.equal(P.fix('I think teh', new Set(['teh'])), null);
  assert.equal(P.fix('the the', new Set(['the the'])), null);
  for (const s of ['www.example.com', 'a@b.edu', 'C:\\x', 'snake_case', 'camelCase', 'v2', 'a.b']) assert.equal(P.unsafe(s), true, s);
  for (const s of ['the', 'don’t', 'well-known']) assert.equal(P.unsafe(s), false, s);
});

test('typing: a sure fix lands on the word boundary as its own undo step, and stays as typed once taken back', () => {
  const e = editor();
  e.type('I think teh ');
  assert.equal(e.text(), 'I think the ');
  assert.equal(e.fixes.length, 1);
  assert.deepEqual([e.fixes[0].was, e.fixes[0].now, e.fixes[0].rule], ['teh', 'the', 'typo']);
  const st = P.key.getState(e.view.state);
  assert.equal(e.view.state.doc.textBetween(st.fixes[0].from, st.fixes[0].to), 'the', 'the green mark covers the fix');
  e.back();
  assert.equal(e.text(), 'I think teh ', 'one undo takes back the fix only, the space stays');
  assert.equal(P.key.getState(e.view.state).fixes.length, 0);
  e.type('and teh.');
  assert.equal(e.text(), 'I think teh and teh.', 'a word taken back stays as typed');
  e.back();
  assert.equal(e.text(), 'I think teh ', 'the next undo takes back the next typing');
  e.back();
  assert.equal(e.text(), '');
});

test('typing: i → I, doubled words, double spaces, and the boundaries', () => {
  let e = editor();
  e.type('so i think so. ');
  assert.equal(e.text(), 'so I think so. ');
  e = editor();
  e.type('read the the book');
  assert.equal(e.text(), 'read the book');
  e.back();
  assert.equal(e.text(), 'read the ', 'typing after a fix is its own step');
  e.back();
  assert.equal(e.text(), 'read the the ', 'and the fix one');
  e = editor();
  e.type('one  ');
  assert.equal(e.text(), 'one ');
  e.back();
  assert.equal(e.text(), 'one  ');
  e.type('two  three');
  assert.equal(e.text(), 'one  two  three', 'double spaces kept once taken back');
  for (const b of [',', '.', ';', ':', '!', '?']) { e = editor(); e.type(`teh${b}`); assert.equal(e.text(), `the${b}`, b); }
  e = editor();
  e.type('teh');
  assert.equal(e.text(), 'teh', 'not before the word ends');
});

test('typing: only what was typed here, never loaded or pasted text, code, links or during composition', () => {
  let e = editor('<p>I think teh</p>');
  e.end();
  e.type(' ');
  assert.equal(e.text(), 'I think teh ', 'loaded text');
  e = editor();
  e.view.dispatch(e.view.state.tr.insertText('pasted teh'));
  e.type(' ');
  assert.equal(e.text(), 'pasted teh ', 'pasted text');
  e = editor();
  e.proof.props.handleTextInput(e.view, 1, 1, 'x');
  e.view.dispatch(e.view.state.tr.insertText('pasted teh').setMeta('uiEvent', 'paste'));
  e.type(' ');
  assert.equal(e.text(), 'pasted teh ', 'a paste after a keystroke that never landed');
  e = editor('<pre class="ql-syntax">x</pre>');
  e.end();
  e.type(' teh ');
  assert.equal(e.text(), 'x teh ', 'code');
  e = editor('<p><a href="https://a.b">x</a></p>');
  e.caret(e.at('x').to);
  e.type('teh ');
  assert.match(e.text(), /teh /, 'a link');
  e = editor();
  e.view.composing = true;
  e.type('teh ');
  assert.equal(e.text(), 'teh ', 'IME composition');
});

test('autofix: a sure Harper fix the student typed past, as its own undo step; never under the caret or on a name', () => {
  const e = editor();
  e.type('this is is a test');
  const r = e.at('is is');
  const made = P.autofix(e.view, { ...r, suggestions: ['is'], rule: 'Repetition' });
  assert.ok(made);
  assert.equal(e.text(), 'this is a test');
  e.back();
  assert.equal(e.text(), 'this is is a test');
  assert.equal(P.autofix(e.view, { ...e.at('is is'), suggestions: ['is'], rule: 'Repetition' }), null, 'taken back once, kept');
  const f = editor();
  f.type('we saw Smiht');
  assert.equal(P.autofix(f.view, { ...f.at('Smiht'), suggestions: ['Smith'], rule: 'Typo' }), null, 'the caret is at its end');
  f.type(' today');
  assert.equal(P.autofix(f.view, { ...f.at('Smiht'), suggestions: ['Smith'], rule: 'Typo' }), null, 'capitalised mid-sentence');
  const g = editor('<p>loaded teh text</p>');
  g.end();
  assert.equal(P.autofix(g.view, { ...g.at('teh'), suggestions: ['the'], rule: 'Typo' }), null, 'not typed here');
  const h = editor();
  h.type('wait. this one');
  assert.ok(P.autofix(h.view, { ...h.at('this'), suggestions: ['This'], rule: 'Capitalization' }));
  assert.equal(h.text(), 'wait. This one');
  h.back();
  assert.equal(h.text(), 'wait. this one');
});

test('revert: the pop\'s Undo takes back the last fix with the editor\'s undo, an older one in place', () => {
  const e = editor();
  e.type('teh ');
  const f = P.key.getState(e.view.state).fixes[0];
  assert.ok(P.revert(e.view, f.id));
  assert.equal(e.text(), 'teh ');
  const g = editor();
  g.type('teh cat ');
  const h = P.key.getState(g.view.state).fixes[0];
  g.type('sat');
  assert.ok(P.revert(g.view, h.id));
  assert.equal(g.text(), 'teh cat sat');
  g.type(' teh ');
  assert.equal(g.text(), 'teh cat sat teh ', 'kept after an Undo too');
});

test('verdict: decide\'s answer as a string or { verdict, choice }, the choice checked', () => {
  assert.deepEqual(P.verdict('apply', 2), { verdict: 'apply', choice: 0 });
  assert.deepEqual(P.verdict('suggest', 1), { verdict: 'suggest', choice: 0 });
  assert.deepEqual(P.verdict({ verdict: 'apply', choice: 1 }, 2), { verdict: 'apply', choice: 1 });
  assert.deepEqual(P.verdict({ verdict: 'suggest', choice: 1 }, 3), { verdict: 'suggest', choice: 1 });
  for (const bad of [null, undefined, 'keep', { verdict: 'keep', choice: 0 }, { verdict: 'apply', choice: 2 }, { verdict: 'apply', choice: -1 }, { verdict: 'apply', choice: '1' }, { verdict: 'apply', choice: 0.5 }, 'yes', 7]) assert.equal(P.verdict(bad, 2), null, JSON.stringify(bad));
  assert.equal(P.verdict('apply', 0), null, 'nothing to apply');
});

// ---- Harper's lints and text ------------------------------------------------------------------------------------------
test('toIssue: kinds, suggestions as the span\'s new text, and what is sure', () => {
  const l = (kind, suggestions, problem = 'teh') => P.toIssue({ start: 0, end: problem.length, kind, message: 'm', problem, suggestions });
  assert.deepEqual(l('Typo', [{ k: 0, t: 'the' }]), { start: 0, end: 3, source: 'harper', kind: 'spelling', rule: 'Typo', message: 'm', suggestions: ['the'], sure: true });
  assert.equal(l('Spelling', [{ k: 0, t: 'the' }]).sure, false, 'spelling is never sure');
  assert.equal(l('Typo', [{ k: 0, t: 'the' }, { k: 0, t: 'ten' }]).sure, false, 'two readings');
  assert.deepEqual(l('Repetition', [{ k: 0, t: 'and' }], 'and and').suggestions, ['and']);
  assert.deepEqual(l('Punctuation', [{ k: 1, t: '' }], ' ,').suggestions, ['']);
  assert.deepEqual(l('Punctuation', [{ k: 2, t: ',' }], 'However').suggestions, ['However,']);
  assert.deepEqual(l('Typo', [{ k: 0, t: 'x' }, { k: 0, t: 'x' }, { k: 0, t: 'teh' }]).suggestions, ['x'], 'deduped, no no-op');
  assert.deepEqual(l('Grammar', [{ k: 0, t: "They're" }, { k: 0, t: "They're " }], 'Their').suggestions, ["They're"], 'edge spaces trimmed, then deduped');
  assert.equal(l('Typo', [{ k: 0, t: 'a rives' }], 'arives').sure, false, 'a typo whose one suggestion splits the word');
  assert.equal(l('Typo', [{ k: 0, t: 'thermometer' }], 'tehr').sure, false, 'too far off');
  assert.equal(l('Capitalization', [{ k: 0, t: 'These' }], 'this').sure, false, 'more than the case');
  assert.equal(l('Repetition', [{ k: 0, t: 'the' }], 'the the').sure, true);
  assert.equal(l('Repetition', [{ k: 0, t: 'and' }], 'the the').sure, false);
  assert.deepEqual([P.distance('teh', 'the'), P.distance('recieve', 'receive'), P.distance('cat', 'dog'), P.distance('a', 'abcd')], [1, 1, 3, 3]);
  for (const [k, kind] of [['Capitalization', 'grammar'], ['WordChoice', 'grammar'], ['Agreement', 'grammar'], ['Style', 'style'], ['Redundancy', 'style'], ['Spelling', 'spelling']]) assert.equal(P.kindOf(k), kind, k);
});

test('docText: textblocks by blank lines, code left out, offsets to positions', () => {
  const s = S.paper, x = (t) => s.text(t);
  const doc = s.node('doc', null, [s.node('paragraph', null, [x('one '), x('two')]), s.node('code_block', null, [x('code')]),
    s.node('bullet_list', null, [s.node('list_item', null, [x('three'), s.node('hard_break'), x('four')])])]);
  const d = P.docText(doc);
  assert.equal(d.text, 'one two\n\nthree\nfour');
  for (const w of ['two', 'three', 'four']) {
    const i = d.text.indexOf(w), from = d.posAt(i);
    assert.equal(doc.textBetween(from, from + w.length), w, w);
  }
  assert.equal(P.blockText(doc.firstChild), 'one two');
});

test('contextWords: course, prompt, assignment, people and thread authors', () => {
  const w = P.contextWords({ course: { name: 'ENGL 2110: Morrison & Memory' }, prompt: { text: 'Discuss Sethe’s choice in Beloved.' }, user: { name: 'Ana Ruiz', given: 'Ana', family: 'Ruiz' },
    instructor: 'Dr. Okonkwo', replyTo: { author: 'Jordan Lee' }, thread: [{ author: 'Priya Natarajan' }, { author: 'Jordan Lee' }], assignment: { title: 'Paper 2' } });
  for (const x of ['ENGL', 'Morrison', 'Memory', 'Sethe', 'Beloved', 'Ruiz', 'Okonkwo', 'Jordan', 'Natarajan', 'Paper']) assert.ok(w.includes(x), x);
  assert.ok(!w.includes('Sethe’s') && !w.includes('2110') && !w.includes('&'));
  assert.deepEqual(P.contextWords(null), []);
  assert.deepEqual(P.contextWords({ thread: 'x', course: 5 }), []);
});

// ---- issues -----------------------------------------------------------------------------------------------------------
test('issues: set, list, ranges, and positions that follow edits', () => {
  const e = editor('<p>Morrison is definately less interested</p><p>the clearing seem to collect</p>');
  const sp = e.at('definately'), gr = e.at('seem');
  assert.ok(e.issues.set('harper', [{ ...sp, kind: 'spelling', message: 'Spelling', suggestions: ['definitely', 'defiantly'], id: 'a' }, { ...gr, kind: 'grammar', message: 'Agreement', suggestions: ['seems'] }]));
  let l = e.issues.list();
  assert.deepEqual(l.map((i) => [i.text, i.kind, i.source]), [['definately', 'spelling', 'harper'], ['seem', 'grammar', 'harper']]);
  assert.equal(l[0].id, 'harper:a');
  const deco = I.key.getState(e.view.state).deco.find();
  assert.deepEqual(deco.map((d) => [d.from, d.to, d.type.attrs.class]), [[sp.from, sp.to, 'gz-iss gz-iss-sp'], [gr.from, gr.to, 'gz-iss gz-iss-gr']]);
  e.view.dispatch(e.view.state.tr.insertText('Toni ', 1));
  l = e.issues.list();
  assert.equal(l[0].from, sp.from + 5, 'mapped');
  assert.equal(e.view.state.doc.textBetween(l[0].from, l[0].to), 'definately');
  e.view.dispatch(e.view.state.tr.insertText('X', l[0].from + 3));
  assert.deepEqual(e.issues.list().map((i) => i.text), ['seem'], 'its text changed: dropped');
  assert.equal(I.key.getState(e.view.state).deco.find().length, 1);
  e.issues.set('ai', [{ ...e.at('clearing'), kind: 'style', message: 'Vague' }, { from: 0, to: 9999, kind: 'style' }, { from: 3, to: 3 }]);
  assert.deepEqual(e.issues.list().map((i) => i.source), ['ai', 'harper'], 'bad ranges dropped, sorted by position');
  e.issues.set('harper', [], { from: 0, to: e.at('Toni').to });
  assert.equal(e.issues.list().length, 2, 'a range replaces only inside it');
  e.issues.clear('ai');
  assert.deepEqual(e.issues.list().map((i) => i.source), ['harper']);
  assert.equal(e.issues.set('nobody', []), false);
});

test('issues: a word that grows drops its spelling issue; apply and ignore', () => {
  const e = editor('<p>we recieve it and recieve more</p>');
  const r = e.at('recieve');
  e.issues.set('harper', [{ ...r, kind: 'spelling', message: 'sp', suggestions: ['receive', 'relieve'] }]);
  e.view.dispatch(e.view.state.tr.insertText('d', r.to));
  assert.equal(e.issues.list().length, 0, 'recieved is a new word');
  const f = editor('<p>we recieve it and recieve more</p>');
  const all = () => f.issues.list();
  const two = (t) => { const s = S.text(t.view.state.doc).text; let k = -1; const out = []; while ((k = s.indexOf('recieve', k + 1)) >= 0) out.push({ from: S.text(t.view.state.doc).posAt(k), to: S.text(t.view.state.doc).posAt(k + 7), kind: 'spelling', message: 'sp', suggestions: ['receive', 'relieve'] }); return out; };
  f.issues.set('harper', two(f));
  assert.ok(f.issues.apply(all()[0], 1));
  assert.equal(f.text(), 'we relieve it and recieve more');
  assert.equal(all().length, 1);
  f.issues.set('harper', two(f));
  assert.ok(f.issues.ignore(all()[0]));
  assert.equal(all().length, 0, 'ignored with its like');
  f.issues.set('harper', two(f));
  assert.equal(all().length, 0, 'and stays ignored');
  f.issues.set('ai', two(f).map((i) => ({ ...i, kind: 'spelling' })));
  assert.equal(all().length, 1, 'only for its source');
  assert.equal(f.issues.apply({ id: 'nope' }), false);
});

test('typing provenance excludes pasted and replaced text inside or beside typed ranges', () => {
  for (const how of ['end', 'middle', 'replace']) {
    const e = editor();
    e.type(how === 'replace' ? 'xxx' : 'te');
    if (how === 'end') e.view.dispatch(e.view.state.tr.insertText('h').setMeta('uiEvent', 'paste'));
    if (how === 'middle') e.view.dispatch(e.view.state.tr.insertText('h', 2).setMeta('uiEvent', 'paste'));
    if (how === 'replace') e.view.dispatch(e.view.state.tr.insertText('teh', 1, 4).setMeta('uiEvent', 'paste'));
    e.end(); e.type(' ');
    assert.equal(e.text(), how === 'middle' ? 'the ' : 'teh ', `${how}: pasted characters never become autocorrect eligible`);
    const typed = P.key.getState(e.view.state).typed;
    assert.equal(P.within(typed, 1, 4), false, how);
  }
  const e = editor(); e.type('te');
  e.view.dispatch(e.view.state.tr.insertText('h').setMeta('uiEvent', 'paste'));
  e.end(); e.type(' and');
  assert.equal(P.autofix(e.view, { from: 1, to: 4, suggestions: ['the'], rule: 'Typo' }), null);
});

test('delayed autocorrect refuses composition, stale text and invalid ranges', () => {
  const e = editor(); e.type('wait. this one');
  const issue = { ...e.at('this'), text: 'this', suggestions: ['This'], rule: 'Capitalization' };
  e.view.composing = true;
  assert.equal(P.autofix(e.view, issue), null, 'a worker or decide reply must not change an active composition');
  assert.equal(e.text(), 'wait. this one');
  e.view.composing = false;
  assert.equal(P.autofix(e.view, { ...issue, text: 'that' }), null, 'the original issue text must still match');
  for (const from of [-1, NaN, 1.5]) assert.equal(P.autofix(e.view, { ...issue, from }), null);
});

test('a pending text input cannot lend provenance to composition', () => {
  const e = editor(); e.type('t');
  e.proof.props.handleTextInput(e.view, 2, 2, 'x');
  e.view.composing = true;
  e.proof.props.handleTextInput(e.view, 2, 2, 'eh');
  e.view.dispatch(e.view.state.tr.insertText('eh'));
  e.view.composing = false; e.type(' ');
  assert.equal(e.text(), 'teh ');
});

test('typing after a space correction has a separate undo group', () => {
  const e = editor(); e.type('one  two');
  assert.equal(e.text(), 'one two');
  e.back(); assert.equal(e.text(), 'one ', 'undo typing only');
  e.back(); assert.equal(e.text(), 'one  ', 'undo correction only');
});


test('sure fixes preserve valid repetition, capitalised names and dictionary words', () => {
  for (const problem of ['had had', 'that that', 'No no', 'very very', 'is is']) {
    const first = problem.split(' ')[0];
    assert.equal(P.toIssue({ kind: 'Repetition', problem, suggestions: [{ k: 0, t: first }] }).sure, false, problem);
  }
  assert.equal(P.toIssue({ kind: 'Typo', problem: 'cat', suggestions: [{ k: 0, t: 'bat' }] }).sure, false, 'edit distance is not confidence');
  for (const text of ['Teh is here ', 'we use a calender ', 'ce dont je parle ']) {
    const e = editor(); e.type(text); assert.equal(e.text(), text);
  }
  const e = editor('', { words: ['teh'] }); e.type('teh '); assert.equal(e.text(), 'teh ');
  e.type('and this one');
  e.view.dispatch(e.view.state.tr.setMeta(P.key, { words: ['teh', 'this'] }));
  assert.equal(P.autofix(e.view, { ...e.at('this'), suggestions: ['This'], rule: 'Capitalization' }), null);
  for (const before of ['well-teh', 'pre-teh', "'teh", '“teh']) assert.equal(P.fix(before), null, before);
});

test('issue capacity keeps decorations equal to live issues across sources', () => {
  const e = editor('<p>word</p>');
  const many = Array.from({ length: 2000 }, (_, n) => ({ from: 1, to: 5, id: String(n), kind: 'spelling' }));
  e.issues.set('harper', many);
  e.issues.set('ai', [{ from: 1, to: 5, id: 'ai', kind: 'style' }]);
  const st = I.key.getState(e.view.state), ids = new Set(st.issues.map((i) => i.id));
  assert.equal(st.deco.find().length, st.issues.length);
  assert.ok(st.deco.find().every((d) => ids.has(d.spec.id)));
  e.issues.clear('harper');
  assert.equal(I.key.getState(e.view.state).deco.find().length, e.issues.list().length);
});

test('issues reject spans that split a surrogate pair', () => {
  const e = editor('<p>😀 wrong</p>');
  e.issues.set('ai', [{ from: 1, to: 2, suggestions: ['x'] }, { from: 2, to: 3, suggestions: ['x'] }]);
  assert.equal(e.issues.list().length, 0);
  e.issues.set('ai', [{ from: 1, to: 3, suggestions: ['🙂'] }]);
  assert.equal(e.issues.list().length, 1);
  assert.ok(e.issues.apply(e.issues.list()[0]));
  assert.equal(e.text(), '🙂 wrong');
});

test('contextual issues expire when their sentence changes outside the marked word', () => {
  const e = editor('<p>Their going home.</p><p>Another issue.</p>');
  e.issues.set('harper', [{ from: 1, to: 6, kind: 'grammar', suggestions: ["They’re"] }, { ...e.at('Another'), kind: 'grammar' }]);
  e.view.dispatch(e.view.state.tr.insertText('going home was surprising.', 7, 18));
  assert.deepEqual(e.issues.list().map((i) => i.text), ['Another']);
  assert.equal(I.key.getState(e.view.state).deco.find().length, 1);
});

test('a cancelled input cannot mark a later programmatic replacement as typed', () => {
  const e = editor();
  e.proof.props.handleTextInput(e.view, 1, 1, 'x');
  e.view.dispatch(e.view.state.tr.insertText('teh'));
  e.type(' ');
  assert.equal(e.text(), 'teh ');
});


test('every curated typo corrects as typed and undoes independently', () => {
  for (const [was, now] of Object.entries(P.TYPOS)) {
    const e = editor(); e.type(`we wrote ${was} `);
    assert.equal(e.text(), `we wrote ${now} `, was);
    e.back(); assert.equal(e.text(), `we wrote ${was} `, was);
  }
});
