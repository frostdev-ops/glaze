// Writer's citation rules on ordinary input the style guides cover (APA 7th ed., MLA 9th ed., Chicago 17th ed.): each
// test names the rule it holds the code to. Where a rule is unclear, the expectation is that nothing is flagged.
const test = require('node:test');
const assert = require('node:assert/strict');
const SRC = require('../../extension/writer/writer-sources.js');
const C = require('../../extension/writer/writer-cite.js');

const d = (y, m, day) => ({ 'date-parts': [[y, m, day].filter(Boolean)] });
const book = (extra) => ({ type: 'book', author: [{ family: 'Lee', given: 'Alex' }], title: 'Research methods', publisher: 'Press', issued: d(2020), ...extra });

// APA 7 §10.2, MLA 9 §5.47, Chicago 17 14.112: an edition after the first is its ordinal number and "ed."; any other
// edition statement (Revised, Expanded) is given as the work gives it.
test('edition typed in words is kept whole; ordinal words and numerals print as numerals with ed. (APA 10.2, MLA 5.47, CMOS 14.112)', () => {
  for (const [typed, stored, apa] of [
    ['Second edition', 'Second edition', '(2nd ed.)'], ['Third', 'Third', '(3rd ed.)'], ['seventh edition', 'seventh edition', '(7th ed.)'],
    ['Revised edition', 'Revised edition', '(Revised ed.)'], ['Revised', 'Revised', '(Revised ed.)'], ['Expanded ed.', 'Expanded ed.', '(Expanded ed.)'],
    ['2nd ed.', '2', '(2nd ed.)'], ['3', '3', '(3rd ed.)'], ['4th edition', '4', '(4th ed.)'], ['11th', '11', '(11th ed.)'],
  ]) {
    assert.equal(SRC.normalize(book({ edition: typed })).edition, stored, typed);
    assert.equal(C.format(book({ edition: typed }), 'apa7').entry, `Lee, A. (2020). <i>Research methods</i> ${apa}. Press.`, typed);
  }
  assert.equal(C.format(book({ edition: 'Second edition' }), 'mla9').entry, 'Lee, Alex. <i>Research methods</i>. 2nd ed., Press, 2020.');
  assert.equal(C.format(book({ edition: 'Second edition' }), 'chicago17').entry, 'Lee, Alex. <i>Research methods</i>. 2nd ed. Press, 2020.');
});

// APA 7 §8.11 and §9.8, MLA 9 §6.4, CMOS 17 8.5 and 15.13: a citation names the author as the reference entry does,
// apostrophe and particle included ("O’Malley", "van der Berg"); a possessive ("Smith’s (2020)") is still that author.
const who = (family, year, given = 'A.') => ({ id: `s-${family.toLowerCase().replace(/[^a-z]/g, '')}x`, type: 'book', title: `On ${family}`, author: [{ family, given }], issued: d(year) });
test('possessives, apostrophe names and name particles match their source and are never "cited but has no entry" (APA 8.11, MLA 6.4, CMOS 8.5)', () => {
  for (const [style, text, s] of [
    ['apa7', 'Smith’s (2020) study found this.', who('Smith', 2020)], ['apa7', "Smith's (2020) study found this.", who('Smith', 2020)],
    ['apa7', 'Results held (O’Malley, 2017).', who('O’Malley', 2017)], ['apa7', "Results held (O'Malley, 2017).", who('O’Malley', 2017)],
    ['apa7', 'O’Malley (2017) said so.', who('O’Malley', 2017)], ['apa7', 'Results held (D’Angelo, 2018).', who('D’Angelo', 2018)],
    ['apa7', 'Results held (van der Berg, 2016).', who('van der Berg', 2016)], ['apa7', 'As van der Berg (2016) said.', who('van der Berg', 2016)],
    ['apa7', 'As de la Cruz (2019) said.', who('de la Cruz', 2019)], ['apa7', 'It held (al-Rashid, 2015).', who('al-Rashid', 2015)],
    ['mla9', 'It held (O’Malley 12).', who('O’Malley', 2017)], ['mla9', 'It held (van der Berg 12).', who('van der Berg', 2016)],
    ['mla9', 'O’Malley’s claim holds (12).', who('O’Malley', 2017)],
  ]) assert.deepEqual(C.check(text, [s], style).map((i) => i.message), [], `${style}: ${text}`);
  // A name with no source is still asked for, written as the text has it.
  assert.deepEqual(C.check('Results held (O’Malley, 2017).', [], 'apa7').map((i) => i.message), ['O’Malley is cited but has no entry']);
  assert.deepEqual(C.check('As van der Berg (2016) said.', [], 'apa7').map((i) => i.message), ['van der Berg is cited but has no entry']);
  // Chicago notes: the full note's name in natural order, and the short note's family name, particles kept (CMOS 14.29, 8.5).
  const W = require('../../extension/writer/writer-schema.js');
  const note = (n) => W.parse(W.paper, `<p>Held.<sup class="gz-footnote" data-footnote="${n}"></sup></p>`);
  for (const n of ['Hans van der Berg, <em>On van der Berg</em> (Leiden: Brill, 2016), 4.', 'van der Berg, <em>On van der Berg</em>, 4.', 'Sean O’Malley, <em>On O’Malley</em> (Boston: Beacon, 2017), 9.'])
    assert.deepEqual(C.check(note(n), [who('van der Berg', 2016), who('O’Malley', 2017)].filter((s) => n.includes(s.author[0].family)), 'chicago17').map((i) => i.message), [], n);
});

// APA 7 §9.44–9.48, MLA 9 §5.124–5.126, CMOS 17 14.66 and 16.58: entries go letter by letter by their first element (the
// surname, a group's name, or a title without A, An or The); "nothing precedes something" (Brown before Browning);
// letters with diacritics file as their base letter; a repeated-author dash (———. or ---.) keeps the entry with the one before.
const LISTS = {
  articles: ['Adams, J. (2019). One. Press.', 'Brown, K. (2018). Two. Press.', 'The Pew Research Center. (2020). Three. Press.', 'Smith, A. (2017). Four. Press.'],
  prefix: ['Brown, J. (2020). One. Press.', 'Browning, K. (2019). Two. Press.', 'Smith, A. (2021). Three. Press.'],
  diacritics: ['Łoś, A. (2018). Three. Press.', 'Nilsen, P. (2020). One. Press.', 'Ødegaard, M. (2019). Two. Press.', 'Smith, A. (2021). Four. Press.'],
  dash: ['Smith, Zadie. Swing Time. New York: Penguin, 2016.', '———. White Teeth. New York: Vintage, 2000.', 'Thomas, Ann. Notes. Boston: Beacon, 2010.'],
  quoted: ['Brown, K. Two. Press, 2018.', '“A Quiet Year.” Times, 2019.', 'Smith, A. Four. Press, 2021.'],
};
const typed = (entries, title = 'References') => ['Body text.', title, ...entries].join('\n');
test('a correctly ordered typed reference list is never "out of order" (APA 9.44–9.48, MLA 5.124–5.126, CMOS 14.66)', () => {
  for (const [k, entries] of Object.entries(LISTS)) for (const st of ['apa7', 'mla9', 'chicago17'])
    assert.deepEqual(C.check(typed(entries, C.TITLES[st]), [], st).filter((i) => /out of order/.test(i.message)), [], `${st} ${k}`);
  assert.deepEqual(C.check(typed(['Smith, A. (2017). Four.', 'Adams, J. (2019). One.']), [], 'apa7').filter((i) => /out of order/.test(i.message)).length, 1, 'a misordered list is still flagged');
});
test('reference-list order: one comparison for the check and the sort, articles skipped, letter by letter (APA 9.44, MLA 5.125)', () => {
  for (const entries of Object.values(LISTS)) assert.equal(SRC.disorder(entries), -1, entries[0]);
  assert.equal(SRC.disorder(['Smith, A.', 'The Pew Research Center.', 'Adams, J.']), 1);
  assert.deepEqual(SRC.order(['Smith, Zadie. Swing Time.', '———. White Teeth.', 'The Pew Research Center.', 'Adams, J.']).map((i) => i), [3, 2, 0, 1]);
  assert.deepEqual(SRC.order(['Browning, K.', 'Brown, J.']), [1, 0]);
});
test('the generated list files Æ, Ø and Ł under A, O and L (APA 9.44, MLA 5.125, CMOS 16.62)', () => {
  const s = (family, id) => ({ id, type: 'book', author: [{ family, given: 'A.' }], title: 'T', issued: d(2020) });
  const ids = (st) => C.list([s('Zimmer', 'zzzz'), s('Łoś', 'llll'), s('Ødegaard', 'oooo'), s('Ærø', 'aaaa'), s('Nilsen', 'nnnn')], st).entries.map((e) => e.id);
  for (const st of ['apa7', 'mla9', 'chicago17']) assert.deepEqual(ids(st), ['aaaa', 'llll', 'nnnn', 'oooo', 'zzzz'], st);
});
