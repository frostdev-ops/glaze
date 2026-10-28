// lib/writer-cite.js, final review: Chicago's n.d. for an undated book, report or chapter; APA's translators and the
// editors of an authored book; parentheses and footnotes that are not citations raise no "no entry" card.
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../lib/writer-cite.js');

const d = (y) => ({ 'date-parts': [[y]] });
const p = (family, given) => ({ family, given });

test('Chicago: an undated book, report or chapter reads n.d. in the bibliography and the note (CMOS 17 14.145)', () => {
  const book = C.format({ type: 'book', author: [p('Smith', 'John')], title: 'Undated Book', 'publisher-place': 'Chicago', publisher: 'Press' }, 'chicago17');
  assert.equal(book.entry, 'Smith, John. <i>Undated Book</i>. Chicago: Press, n.d.');
  assert.equal(book.note('5'), 'John Smith, <i>Undated Book</i> (Chicago: Press, n.d.), 5.');
  const report = C.format({ type: 'report', author: [{ literal: 'Council' }], title: 'Report', 'publisher-place': 'Chicago', publisher: 'Press' }, 'chicago17');
  assert.equal(report.entry, 'Council. <i>Report</i>. Chicago: Press, n.d.');
  const chapter = C.format({ type: 'chapter', author: [p('Smith', 'John')], title: 'A Chapter', 'container-title': 'The Book', editor: [p('Lee', 'Ann')], 'publisher-place': 'Chicago', publisher: 'Press', page: '1-9' }, 'chicago17');
  assert.equal(chapter.entry, 'Smith, John. “A Chapter.” In <i>The Book</i>, edited by Ann Lee, 1–9. Chicago: Press, n.d.');
  assert.equal(chapter.note('5'), 'John Smith, “A Chapter,” in <i>The Book</i>, ed. Ann Lee (Chicago: Press, n.d.), 5.');
  // A dated one is as before.
  assert.equal(C.format({ type: 'book', author: [p('Smith', 'John')], title: 'B', publisher: 'Press', issued: d(2001) }, 'chicago17').entry, 'Smith, John. <i>B</i>. Press, 2001.');
});

test('APA: a book\'s translators and the editors of an authored book sit in the parentheses after its title (APA 7 10.2)', () => {
  const piaget = { type: 'book', author: [p('Piaget', 'Jean')], translator: [p('Weaver', 'Helen')], title: 'The psychology of the child', edition: '2', issued: d(1969), publisher: 'Basic Books' };
  assert.equal(C.format(piaget, 'apa7').entry, 'Piaget, J. (1969). <i>The psychology of the child</i> (H. Weaver, Trans.; 2nd ed.). Basic Books.');
  const plath = { type: 'book', author: [p('Plath', 'Sylvia')], editor: [p('Kukil', 'Karen V.')], title: 'The unabridged journals of Sylvia Plath', issued: d(2000), publisher: 'Anchor Books' };
  assert.equal(C.format(plath, 'apa7').entry, 'Plath, S. (2000). <i>The unabridged journals of Sylvia Plath</i> (K. V. Kukil, Ed.). Anchor Books.');
  const both = { type: 'book', author: [p('Freud', 'Sigmund')], editor: [p('Strachey', 'James')], translator: [p('Strachey', 'James')], title: 'The ego and the id', issued: d(1961), publisher: 'Hogarth Press' };
  assert.equal(C.format(both, 'apa7').entry, 'Freud, S. (1961). <i>The ego and the id</i> (J. Strachey, Ed. &amp; Trans.). Hogarth Press.');
  // An edited book's editors lead and are not named twice.
  const edited = { type: 'book', editor: [p('Lee', 'Ann'), p('Kim', 'Bo')], title: 'Essays', issued: d(2010), publisher: 'Press' };
  assert.equal(C.format(edited, 'apa7').entry, 'Lee, A., &amp; Kim, B. (Eds.). (2010). <i>Essays</i>. Press.');
});

const MORRISON = { id: 'morrison', type: 'book', author: [p('Morrison', 'Toni')], title: 'Beloved', publisher: 'Knopf', issued: d(1987) };
const noEntry = (text, sources, style) => C.check(text, sources, style).filter((i) => i.action === 'add-source').map((i) => i.name);

test('dates, labels inside a text, named things and sums in brackets are not citations; an author with a page still is', () => {
  const texts = [
    'The war ended in spring (May 1945) and Morrison wrote later (Morrison 42).',
    'Students in the study (Grade 10) improved (Morrison 42).',
    'The mission (Apollo 11) landed (Morrison 42).',
    'Hamlet hesitates (Act 3) as Morrison notes (Morrison 42).',
    'It cost a lot (US$ 40) per Morrison (Morrison 42).',
    'See the second part (Section 4) and Morrison (Morrison 42).',
    'It rained (Spring 2020) and stopped (Morrison 42).',
  ];
  for (const style of ['mla9', 'apa7']) for (const t of texts) assert.deepEqual(noEntry(t, [MORRISON], style), [], `${style} ${t}`);
  assert.deepEqual(noEntry('A claim (Morrison 42).', [], 'mla9'), ['Morrison']);
  assert.deepEqual(noEntry('A claim (Baldwin xix), and more.', [], 'mla9'), ['Baldwin']);
  const may = { ...MORRISON, id: 'may', author: [p('May', 'Rollo')], title: 'Love and Will' };
  assert.deepEqual(C.count('Love is willed (May 42).', [may], 'mla9'), { cited: 1, total: 1 }, 'a saved source named May is still cited');
  // The labels are one list, shared with the compose bar's count.
  for (const w of ['Figure', 'Act', 'Grade', 'Section', 'chapters']) assert.ok(C.INSIDE.test(w), w);
});

test('Chicago: an explanatory note is not a citation, Ibid. is the note before\'s source, and a name after "see" is one', () => {
  const W = require('../lib/writer-schema.js');
  const SMITH = { id: 'smith', type: 'book', author: [p('Smith', 'Zadie')], title: 'Swing Time', 'publisher-place': 'New York', publisher: 'Penguin Press', issued: d(2016) };
  const paper = (...notes) => W.parse(W.paper, `<p>Time swings${notes.map((n, i) => `${i ? ' again' : ''}<sup class="gz-footnote" data-footnote="${n}"></sup>`).join('')}.</p>`);
  const first = 'Zadie Smith, <em>Swing Time</em> (New York: Penguin Press, 2016), 3.';
  for (const note of ['This point is developed further in the conclusion.', 'Ibid., 320.', 'Ibid.', 'Smith, Swing Time, 320.', 'Translation mine.', 'For a contrasting view, see Smith, Swing Time, 12.', 'Cf. Smith, Swing Time, 9.']) {
    assert.deepEqual(noEntry(paper(first, note), [SMITH], 'chicago17'), [], note);
  }
  assert.deepEqual(C.cites(paper(first, 'Ibid., 320.'), [SMITH], 'chicago17').map((c) => c.ids), [['smith'], ['smith']]);
  assert.deepEqual(noEntry(paper(first, 'For a contrasting view, see Baldwin, Price of the Ticket, 12.'), [SMITH], 'chicago17'), ['Baldwin']);
  assert.deepEqual(noEntry(paper('Baldwin, Price of the Ticket, xix.', 'Ibid., 3.'), [], 'chicago17'), ['Baldwin'], 'Ibid. raises no second card');
  assert.deepEqual(C.count(paper('This point is developed further in the conclusion.'), [SMITH], 'chicago17'), { cited: 0, total: 1 });
});
