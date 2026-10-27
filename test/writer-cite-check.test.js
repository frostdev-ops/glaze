// lib/writer-cite.js check/cites/count: citations found in the text (parenthetical, narrative, footnotes), and the issues
// they raise, anchored on document positions through lib/writer-schema.js text().
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../lib/writer-cite.js');
const W = require('../lib/writer-schema.js');

const d = (y) => ({ 'date-parts': [[y]] });
const MORRISON = { id: 'morrison', type: 'book', author: [{ family: 'Morrison', given: 'Toni' }], title: 'Beloved', publisher: 'Alfred A. Knopf', issued: d(1987) };
const GRADY = { id: 'grady', type: 'article-journal', author: [{ family: 'Grady', given: 'J. S.' }, { family: 'Her', given: 'M.' }, { family: 'Moreno', given: 'G.' }], title: 'Emotions in storybooks', 'container-title': 'Psychology of Popular Media Culture', volume: '8', issue: '3', page: '207-217', issued: d(2019) };
const SMITH = { id: 'smith', type: 'book', author: [{ family: 'Smith', given: 'Zadie' }], title: 'Swing Time', 'publisher-place': 'New York', publisher: 'Penguin Press', issued: d(2016) };
const CAPY = { id: 'capy', type: 'motion_picture', title: 'Capybara Eat Huge Pumpkin', 'container-title': 'YouTube', publisher: 'Alex Smith', issued: d(2021) };
const doc = (html, schema = W.paper) => W.parse(schema, html);
const at = (node, i) => node.textBetween(i.from, i.to, '\n', '');
const msgs = (issues) => issues.map((i) => i.message).sort();

test('MLA: the comma between author and page is a sure fix, and a cited name with no entry asks for one (the mockup\'s two cards)', () => {
  const html = '<p>Sethe calls the past "rememory," a word that refuses the past tense (Morrison, 42). History is "the price of the ticket" (Baldwin xix).</p>';
  const node = doc(html), issues = C.check(node, [MORRISON], 'mla9');
  assert.deepEqual(msgs(issues), ['Baldwin is cited but has no entry', 'MLA citation']);
  const comma = issues.find((i) => i.message === 'MLA citation');
  assert.equal(at(node, comma), '(Morrison, 42)');
  assert.deepEqual(comma.suggestions, ['(Morrison 42)']);
  assert.equal(comma.sure, true);
  const none = issues.find((i) => i.action === 'add-source');
  assert.equal(at(node, none), '(Baldwin xix)');
  assert.equal(none.name, 'Baldwin');
  assert.equal(none.title, 'Works Cited');
  for (const i of issues) assert.deepEqual([i.source, i.kind], ['cite', 'citation']);
});

test('MLA: a narrative citation names the author in the sentence and gives the page alone', () => {
  const issues = C.check('Morrison argues that rememory waits for whoever walks into it (42).', [MORRISON], 'mla9');
  assert.deepEqual(issues, []);
  assert.deepEqual(C.count('Morrison argues that rememory waits for whoever walks into it (42).', [MORRISON], 'mla9'), { cited: 1, total: 1 });
  // A title cited without an author, and a possessive.
  assert.deepEqual(C.check('One video shows it plainly ("Capybara Eat Huge Pumpkin"). Morrison\'s novel insists (88).', [CAPY, MORRISON], 'mla9'), []);
});

test('a source in the list that the text never cites, and parentheses that are not citations', () => {
  const text = 'The river (the clearing, too) keeps score (see above). Baby Suggs preaches there (Baby Suggs). In 1873 (1873) nothing.';
  const issues = C.check(text, [MORRISON], 'mla9');
  assert.deepEqual(msgs(issues), ['Morrison is never cited']);
  assert.equal(issues[0].sourceId, 'morrison');
  assert.deepEqual(C.count(text, [MORRISON], 'mla9'), { cited: 0, total: 1 });
});

test('APA: the year is required; the fix takes it from the source; narrative citations count', () => {
  const issues = C.check('Memory is a debt (Morrison, p. 42). Grady et al. (2019) found the same. Others disagree (Lee, 2001).', [MORRISON, GRADY], 'apa7');
  assert.deepEqual(msgs(issues), ['Add the year', 'Lee is cited but has no entry']);
  assert.deepEqual(issues.find((i) => i.message === 'Add the year').suggestions, ['(Morrison, 1987, p. 42)']);
  assert.equal(issues.find((i) => i.message === 'Add the year').title, 'APA citation');
  assert.deepEqual(C.count('Grady et al. (2019) found the same.', [MORRISON, GRADY], 'apa7'), { cited: 1, total: 2 });
  assert.deepEqual(C.check('As shown before (Morrison, 1987, p. 42; Grady et al., 2019).', [MORRISON, GRADY], 'apa7'), []);
});

test('a typed reference list out of alphabetical order, and its entries never cited', () => {
  const html = '<p>Rememory waits (Mantel 3).</p><p>Works Cited</p><p>Mantel, Hilary. Wolf Hall. Picador, 2010.</p><p>Burdick, Anne, et al. Digital_Humanities. MIT P, 2012.</p>';
  const node = doc(html);
  const mantel = { id: 'mantel', type: 'book', author: [{ family: 'Mantel', given: 'Hilary' }], title: 'Wolf Hall', publisher: 'Picador', issued: d(2010) };
  const burdick = { id: 'burdick', type: 'book', author: [{ family: 'Burdick', given: 'Anne' }, { family: 'Drucker' }, { family: 'Lunenfeld' }], title: 'Digital_Humanities', publisher: 'MIT P', issued: d(2012) };
  const issues = C.check(node, [mantel, burdick], 'mla9');
  assert.deepEqual(msgs(issues), ['Burdick et al. is never cited', 'Works Cited is out of order']);
  assert.equal(at(node, issues.find((i) => i.message.endsWith('out of order'))), 'Burdick, Anne, et al. Digital_Humanities. MIT P, 2012.');
  assert.equal(at(node, issues.find((i) => i.message.endsWith('never cited'))), 'Burdick, Anne, et al. Digital_Humanities. MIT P, 2012.');
});

test('Chicago: footnotes are the citations; a note naming no source asks for one, on the note\'s mark', () => {
  const html = '<p>Time swings<sup class="gz-footnote" data-footnote="Zadie Smith, <em>Swing Time</em> (New York: Penguin Press, 2016), 315–16."></sup> and pays<sup class="gz-footnote" data-footnote="Baldwin, <em>Price of the Ticket</em>, xix."></sup>.</p>';
  const node = doc(html);
  const issues = C.check(node, [SMITH], 'chicago17');
  assert.deepEqual(msgs(issues), ['Baldwin is cited but has no entry']);
  assert.equal(node.nodeAt(issues[0].from).type.name, 'footnote_ref');
  assert.equal(issues[0].title, 'Bibliography');
  assert.deepEqual(C.count(node, [SMITH], 'chicago17'), { cited: 1, total: 1 });
  // A short note names the source by its family name too.
  const short = doc('<p>Again<sup class="gz-footnote" data-footnote="Smith, <em>Swing Time</em>, 320."></sup>.</p>');
  assert.deepEqual(C.check(short, [SMITH], 'chicago17'), []);
});

test('issue positions follow the document, past marks, footnotes and earlier paragraphs (compose schema too)', () => {
  const node = doc('<p><strong>Bold</strong> start.</p><p>Then <em>it</em> says (Morrison, 42) twice.</p>', W.compose);
  const [i] = C.check(node, [MORRISON], 'mla9');
  assert.equal(at(node, i), '(Morrison, 42)');
  assert.equal(typeof i.id, 'string');
});

test('translated and localized messages come from the caller\'s t()', () => {
  const t = (s, v) => `«${s.replace('{name}', v?.name ?? '')}»`;
  const issues = C.check('A claim (Baldwin xix).', [], 'mla9', { t });
  assert.deepEqual(issues.map((i) => [i.message, i.title]), [['«Baldwin is cited but has no entry»', '«Works Cited»']]);
});

test('review: ordinary parenthetical prose, figure labels and dates are not citations', () => {
  const bait = 'We compared two versions (see Figure 2). The draft (Version 2) improved (In 2020). Morrison was born in (1931).';
  assert.equal(C.check(bait, [MORRISON], 'mla9').some((i) => i.action === 'add-source'), false);
  assert.deepEqual(C.count(bait, [MORRISON], 'mla9'), { cited: 0, total: 1 });
});

test('review: names sharing an eight-character prefix are distinct sources', () => {
  const s = { ...MORRISON, id: 'longname', author: [{ family: 'Richardson' }] };
  assert.equal(C.check('A result (Richardsonson 42).', [s], 'mla9').some((i) => i.action === 'add-source'), true);
});

test('review: adding one APA year preserves the other citations and introductory text', () => {
  const node = doc('<p>A result (see Morrison, p. 42; Grady et al., 2019).</p>');
  const issue = C.check(node, [MORRISON, GRADY], 'apa7').find((i) => i.message === 'Add the year');
  assert.equal(at(node, issue), '(see Morrison, p. 42; Grady et al., 2019)');
  assert.deepEqual(issue.suggestions, ['(see Morrison, 1987, p. 42; Grady et al., 2019)']);
});

test('review: APA citation years identify the work and reference entries do not cite themselves', () => {
  const later = { ...MORRISON, id: 'later', title: 'Jazz', issued: d(1992) };
  assert.deepEqual(C.count('A result (Morrison, 1987).', [MORRISON, later], 'apa7'), { cited: 1, total: 2 });
  assert.deepEqual(C.count('References\nMorrison, T. (1987). Beloved. Knopf.', [MORRISON], 'apa7'), { cited: 0, total: 1 });
});

test('review: Chicago compose checks recognize their own shortened notes', () => {
  const text = 'A result (Smith, Swing Time, 320).';
  assert.deepEqual(C.check(text, [SMITH], 'chicago17'), []);
  assert.deepEqual(C.count(text, [SMITH], 'chicago17'), { cited: 1, total: 1 });
});

test('review: MLA title-led organization reports match the title used by the formatter', () => {
  const s = { id: 'report', type: 'report', title: 'Annual Findings', author: [{ literal: 'Research Council' }], publisher: 'Research Council' };
  const node = doc(`<p>A result ${C.format(s, 'mla9').inText('4')}.</p>`);
  assert.deepEqual(C.check(node, [s], 'mla9'), []);
  assert.deepEqual(C.count(node, [s], 'mla9'), { cited: 1, total: 1 });
});

for (const style of ['mla9', 'apa7', 'chicago17']) {
  test(`${style}: typed paper references satisfy citations without saved source metadata`, () => {
    const FX = require('./fixtures/writer-paper-fixtures.js');
    const node = W.paper.nodeFromJSON(FX.papers[style]());
    assert.deepEqual(C.check(node, [], style), []);
  });
}

test('typed references preserve citation fixes and reject absent authors, surname prefixes and wrong APA years', () => {
  const list = '\nWorks Cited\nMorrison, Toni. Beloved. Knopf, 1987.';
  assert.deepEqual(msgs(C.check(`A claim (Morrison, 42).${list}`, [], 'mla9')), ['MLA citation']);
  assert.deepEqual(msgs(C.check(`A claim (Baldwin xix).${list}`, [], 'mla9')), ['Baldwin is cited but has no entry']);
  assert.deepEqual(msgs(C.check(`A claim (Morrisonson 42).${list}`, [], 'mla9')), ['Morrisonson is cited but has no entry']);
  assert.deepEqual(msgs(C.check('A claim (Morrison, 1992).\nReferences\nMorrison, T. (1987). Beloved. Knopf.', [], 'apa7')), ['Morrison is cited but has no entry']);
});
