// Glaze Writer's compose bar (writer-compose.js) and Quote pop (features/writer-quote.js), their pure parts: the ring, its
// tooltip, the citation count that stands in for the cite stream's, the quote blocks the editor draws, and where the pop
// goes. What they do in a browser, with the page's context and a real Quill, is scripts/writer-compose-check.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../lib/writer-schema.js');
const E = require('../lib/writer-editor.js');
const C = require('../writer-compose.js');
const Q = require('../features/writer-quote.js');

test('the ring counts toward the minimum, then the maximum; full and green at the minimum, amber past the maximum', () => {
  const at = (n, req) => { const r = C.ring(n, req); return [r.target, r.state, Math.round(r.offset * 100) / 100]; };
  const full = Math.round(C.CIRCLE * 100) / 100;
  assert.deepEqual(at(0, { minWords: 250 }), [250, '', full]);
  assert.deepEqual(at(182, { minWords: 250 }), [250, '', Math.round(C.CIRCLE * (1 - 182 / 250) * 100) / 100], 'the mockup\'s 182 / 250');
  assert.equal(Math.abs(C.ring(182, { minWords: 250 }).offset - 25.4) < 0.3, true, 'the mockup\'s dash offset');
  assert.deepEqual(at(250, { minWords: 250 }), [250, 'ok', 0]);
  assert.deepEqual(at(300, { minWords: 250 }), [250, 'ok', 0], 'no maximum: past the minimum stays green');
  assert.deepEqual(at(5, { minWords: 10, maxWords: 20 }), [10, '', Math.round(C.CIRCLE * 0.5 * 100) / 100]);
  assert.deepEqual(at(14, { minWords: 10, maxWords: 20 }), [20, 'ok', 0]);
  assert.deepEqual(at(20, { minWords: 10, maxWords: 20 }), [20, 'ok', 0]);
  assert.deepEqual(at(27, { minWords: 10, maxWords: 20 }), [20, 'over', 0]);
  assert.deepEqual(at(100, { maxWords: 500 }), [500, '', Math.round(C.CIRCLE * 0.8 * 100) / 100], 'a maximum alone fills toward it');
  assert.deepEqual(at(501, { maxWords: 500 }), [500, 'over', 0]);
  for (const req of [{}, null, undefined, { minWords: null, maxWords: null }, { minWords: 0 }, { minWords: -3 }, { minWords: 2.5 }, { minWords: '250' }]) assert.equal(C.ring(12, req).target, null, JSON.stringify(req));
});

test('the ring\'s tooltip: the words, then the replies asked for', () => {
  assert.equal(C.tip({ minWords: 250, sources: 2, replies: 2 }), 'At least 250 words\nReply to 2 classmates');
  assert.equal(C.tip({ minWords: 250, maxWords: 300 }), '250–300 words');
  assert.equal(C.tip({ maxWords: 500 }), 'At most 500 words');
  assert.equal(C.tip({ replies: 1 }), 'Reply to 1 classmates');
  assert.equal(C.tip({}), '');
  assert.equal(C.tip({ minWords: 250 }, (k, v) => `${k}|${JSON.stringify(v)}`), 'At least {n} words|{"n":250}', 'through the frame\'s t()');
});

test('citations count the sources an in-text citation names, once each', () => {
  const cases = [
    ['Sethe calls it "rememory" (Morrison 42).', 1],
    ['(Morrison 42) and again (Morrison, 50).', 1],
    ['The price of the ticket (Baldwin xix).', 1],
    ['(Smith & Lee, 2020, p. 4)', 1],
    ['(Smith and Lee 2020)', 1],
    ['(Smith et al., 2019)', 1],
    ['(Hooks 12; Davis 1981)', 2],
    ['("Rememory" 12)', 1],
    ['(“Rememory” 12) and ("Rememory" 13)', 1],
    ['(Pew Research Center, 2021)', 1],
    ['(Morrison, 1987, pp. 42-44)', 1],
    ['(see Morrison 42)', 1],
    ['(Smith, n.d.)', 1],
    ['Morrison (1987) argues that memory is a place, and Baldwin (1985, p. 12) agrees.', 2],
    ['Two sources: (Morrison 42), (Baldwin xix).', 2],
    ['(Figure 2) (Table 1) (Chapter 3) (Week 6) (Page 4) (Part 2)', 0],
    ['(see below) (Morrison) (2020) (n.d.) (i.e. the river)', 0],
    ['', 0],
  ];
  for (const [text, n] of cases) assert.equal(C.citations(text), n, text);
  assert.equal(C.citations(`${'(x '.repeat(50000)}`), 0, 'a long run of open parentheses');
});

test('compose\'s quote is drawn as one block: its italic lines and its byline, nothing else', () => {
  const st = E.state({ html: '<p>Before.</p>' });
  let next = st;
  E.commands(st.schema).quote({ text: 'Every time a character crosses it,\nthey carry something.', author: 'Jordan Lee' })(st.apply(st.tr.setSelection(GZ_PM.state.TextSelection.atEnd(st.doc))), (tr) => { next = st.apply(tr); });
  assert.equal(S.serialize(next.schema, next.doc), '<p>Before.</p><p class="ql-indent-1"><em>Every time a character crosses it,</em></p><p class="ql-indent-1"><em>they carry something.</em></p><p class="ql-indent-1">— Jordan Lee</p><p><br></p>');
  const q = C.quotes(next.doc);
  assert.deepEqual(q.map((x) => [next.doc.textBetween(x.from, x.to), x.by, x.end]), [['Every time a character crosses it,', false, false], ['they carry something.', false, false], ['— Jordan Lee', true, true]]);
  const parse = (html) => C.quotes(S.parse(S.compose, html)).map((x) => [x.by, x.end]);
  assert.deepEqual(parse('<p class="ql-indent-1"><em>No author</em></p><p>Next.</p>'), [[false, true]], 'without a byline its last line ends it');
  assert.deepEqual(parse('<p class="ql-indent-1">Indented, not italic</p><p class="ql-indent-2"><em>Deeper</em></p><p class="ql-indent-1"><em>Half</em> plain</p>'), [], 'other indented or italic text stays as it is');
  assert.deepEqual(parse('<p class="ql-indent-1">— A dash line alone</p>'), []);
  assert.deepEqual(C.quotes(S.parse(S.paper, '<p class="ql-indent-1"><em>x</em></p>')), [], 'paper mode has blockquotes');
});

test('the Quote pop: the selection as quoted lines, and its place above the first line or under the last', () => {
  assert.equal(Q.clean('  Every   time\n\n a character\r\ncrosses it  '), 'Every time\na character\ncrosses it');
  assert.equal(Q.clean('x'.repeat(5000)).length, 2000);
  assert.equal(Q.clean(null), '');
  const line = (left, top, width = 300, height = 20) => ({ left, top, right: left + width, bottom: top + height, width, height });
  assert.deepEqual(Q.place([line(100, 300), line(20, 322)], 80, 30, 1440, 900), { x: 250, y: 292, below: false }, 'centred over the first line');
  assert.deepEqual(Q.place([line(100, 20), line(20, 42)], 80, 30, 1440, 900), { x: 170, y: 70, below: true }, 'no room above: under the last line');
  assert.deepEqual(Q.place([line(-200, 300, 210)], 80, 30, 1440, 900), { x: 44, y: 292, below: false }, 'kept inside the window');
  assert.deepEqual(Q.place([line(1400, 300, 100)], 80, 30, 1440, 900), { x: 1396, y: 292, below: false });
  assert.equal(Q.place([{ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }], 80, 30, 1440, 900), null, 'nothing laid out');
  assert.equal(Q.place([], 80, 30, 1440, 900), null);
});

test('the sources pill reads parentheses as the paper\'s citation checks do: a date or a label inside a text is no source', () => {
  assert.equal(C.citations('The war ended in Europe (May 1945) and in Asia (August 1945).'), 0);
  assert.equal(C.citations('Memory is a debt (Morrison 42), not a record (Baldwin xix).'), 2);
});
