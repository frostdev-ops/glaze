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
test('Chicago notes recognize full author names with given names Van and Al or a suffix (CMOS 14.29)', () => {
  const W = require('../../extension/writer/writer-schema.js');
  for (const [given, family, suffix] of [['Van', 'Morrison'], ['Al', 'Green'], ['Hans', 'van der Berg'], ['Martin Luther', 'King', 'Jr.']]) {
    const source = book({ id: 's-noted', author: [{ family, given, suffix }] });
    const html = C.format(source, 'chicago17').note(4);
    const doc = W.parse(W.paper, `<p>Held.<sup class="gz-footnote" data-footnote="${html}"></sup></p>`);
    assert.deepEqual(C.check(doc, [source], 'chicago17').map((i) => i.message), [], html);
  }
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
test('a comma inside an unsigned title does not end its alphabetization key (MLA 5.125)', () => {
  const entries = ['“War and Peace.” Journal of Literature, 2020.', '“War, Memory, and History.” Journal of Literature, 2021.'];
  assert.deepEqual(C.check(typed(entries, 'Works Cited'), [], 'mla9').filter((i) => /out of order/.test(i.message)), []);
  assert.equal(SRC.disorder(entries), -1);
  assert.deepEqual(SRC.order([...entries].reverse()), [1, 0]);
});
test('the generated list files Æ, Ø and Ł under A, O and L (APA 9.44, MLA 5.125, CMOS 16.62)', () => {
  const s = (family, id) => ({ id, type: 'book', author: [{ family, given: 'A.' }], title: 'T', issued: d(2020) });
  const ids = (st) => C.list([s('Zimmer', 'zzzz'), s('Łoś', 'llll'), s('Ødegaard', 'oooo'), s('Ærø', 'aaaa'), s('Nilsen', 'nnnn')], st).entries.map((e) => e.id);
  for (const st of ['apa7', 'mla9', 'chicago17']) assert.deepEqual(ids(st), ['aaaa', 'llll', 'nnnn', 'oooo', 'zzzz'], st);
});

// Names as a student types them. APA 7 §9.8 (King, M. L., Jr.), MLA 9 §5.21 (King, Martin Luther, Jr.), CMOS 17 6.43 and
// 14.72 (a note's "Martin Luther King Jr.", the bibliography's "King, Martin Luther, Jr."); initials, with periods or
// without, are given names (APA 9.8: "Rowling, J. K."); a group's name stays whole.
test('suffixes and undotted initials parse as a person\'s parts (APA 9.8, MLA 5.21, CMOS 6.43 and 14.72)', () => {
  const at = (n, st) => { const f = C.format({ type: 'book', title: 'Why we can’t wait', author: [n], publisher: 'Harper', issued: d(1964) }, st); return [f.entry.replace(/ (?:<i>)?Why.*$/, ''), f.inText(12)]; };
  for (const n of ['Martin Luther King Jr.', 'King, Martin Luther, Jr.', 'Martin Luther King, Jr.']) {
    assert.deepEqual(SRC.name(n), { family: 'King', given: 'Martin Luther', suffix: 'Jr.' }, n);
    assert.deepEqual(at(n, 'apa7'), ['King, M. L., Jr. (1964).', '(King, 1964, p. 12)'], n);
    assert.deepEqual(at(n, 'mla9'), ['King, Martin Luther, Jr.', '(King 12)'], n);
    assert.equal(at(n, 'chicago17')[0], 'King, Martin Luther, Jr.', n);
    assert.match(at(n, 'chicago17')[1], /^Martin Luther King Jr., <i>/, n);
  }
  assert.deepEqual(SRC.name('Henry Ford III'), { family: 'Ford', given: 'Henry', suffix: 'III' });
  for (const [n, family, given, apa] of [['JK Rowling', 'Rowling', 'JK', 'Rowling, J. K.'], ['CS Lewis', 'Lewis', 'CS', 'Lewis, C. S.'], ['JRR Tolkien', 'Tolkien', 'JRR', 'Tolkien, J. R. R.'],
    ['J.K. Rowling', 'Rowling', 'J.K.', 'Rowling, J. K.'], ['W. E. B. Du Bois', 'Du Bois', 'W. E. B.', 'Du Bois, W. E. B.']]) {
    assert.deepEqual(SRC.name(n), { family, given }, n);
    assert.equal(at(n, 'apa7')[0], `${apa} (1964).`, n);
  }
  for (const n of ['UN Women', 'IBM Research', 'World Health Organization', 'BBC News', 'NASA']) assert.ok(!SRC.name(n).given, `${n} is not a person`);
});

// APA 7 §8.19 and §9.47: works by the same author(s) in the same year take a, b, … after the year, in the order of their
// titles (A, An and The skipped), in both the reference entry and the in-text citation; n.d. works take n.d.-a, n.d.-b.
test('APA: same author, same year: a and b by title order in the entry and the citation (APA 8.19, 9.47)', () => {
  const smith = (id, title, year) => ({ id, type: 'book', author: [{ family: 'Smith', given: 'Ann' }], title, publisher: 'Press', ...(year && { issued: d(year) }) });
  const all = [smith('s-beta', 'The beta work', 2020), smith('s-alpha', 'Alpha work', 2020), smith('s-gamma', 'Gamma work', 2021), { ...smith('s-other', 'Other', 2020), author: [{ family: 'Smith', given: 'Bea' }] }];
  assert.deepEqual(C.list(all, 'apa7').entries.map((e) => e.html), [
    'Smith, A. (2020a). <i>Alpha work</i>. Press.', 'Smith, A. (2020b). <i>The beta work</i>. Press.', 'Smith, A. (2021). <i>Gamma work</i>. Press.', 'Smith, B. (2020). <i>Other</i>. Press.']);
  assert.equal(C.format(all[1], 'apa7', { sources: all }).inText(), '(Smith, 2020a)');
  assert.equal(C.format(all[0], 'apa7', { sources: all }).narrative(4), 'Smith (2020b, p. 4)');
  assert.equal(C.format(all[2], 'apa7', { sources: all }).inText(), '(Smith, 2021)');
  assert.equal(C.format(all[0], 'apa7').inText(), '(Smith, 2020)', 'without the list, no letter');
  assert.equal(C.format(all[0], 'mla9', { sources: all }).inText(), '(Smith)', 'MLA uses short titles, not letters');
  const nd = [smith('s-x', 'Xylophones'), smith('s-y', 'Yodels')];
  assert.deepEqual(C.list(nd, 'apa7').entries.map((e) => e.html.slice(0, 20)), ['Smith, A. (n.d.-a). ', 'Smith, A. (n.d.-b). ']);
  // The check reads the letter: each citation names its own work, and both count as cited.
  const issues = C.check('One (Smith, 2020a). Two (Smith, 2020b). Three (Smith, 2021). Four (Smith, 2020).', all.slice(0, 3).concat(all[3]), 'apa7');
  assert.deepEqual(issues.map((i) => i.message), []);
  assert.deepEqual(C.cites('One (Smith, 2020a).', all, 'apa7').map((c) => c.ids), [['s-alpha']]);
});
test('APA year letters follow specific publication dates before titles (APA 9.47)', () => {
  const all = [
    book({ id: 's-later', type: 'webpage', title: 'Alpha update', issued: d(2020, 4, 2) }),
    book({ id: 's-earlier', type: 'webpage', title: 'Zebra update', issued: d(2020, 3, 26) }),
    book({ id: 's-year', title: 'Yearly overview', issued: d(2020) }),
    book({ id: 's-same', type: 'webpage', title: 'The beta update', issued: d(2020, 4, 2) }),
  ];
  const list = C.list(all, 'apa7').entries;
  assert.deepEqual(list.map((e) => e.id), ['s-year', 's-earlier', 's-later', 's-same']);
  assert.deepEqual(list.map((e) => e.html.match(/\(2020[^)]*\)/)[0]), ['(2020a)', '(2020b, March 26)', '(2020c, April 2)', '(2020d, April 2)']);
  assert.equal(C.format(all[1], 'apa7', { sources: all }).inText(), '(Lee, 2020b)');
  assert.deepEqual(C.cites('Earlier (Lee, 2020b).', all, 'apa7').map((c) => c.ids), [['s-earlier']]);
});

// Each work is its own entry (APA 9.43, MLA 5.124, CMOS 14.63): two pages at different addresses, or two chapters of one
// title in different books, stay two sources; the same work found twice stays one.
test('distinct works with different addresses or books stay apart; the same work stays one (APA 9.43, CMOS 14.63)', () => {
  const who = [{ literal: 'World Health Organization' }], y = d(2023);
  assert.equal(SRC.dedupe([{ type: 'webpage', title: 'Malaria', author: who, issued: y, URL: 'https://www.who.int/news-room/fact-sheets/detail/malaria' },
    { type: 'webpage', title: 'Malaria', author: who, issued: y, URL: 'https://www.who.int/health-topics/malaria' }]).length, 2);
  const ch = (book) => ({ type: 'chapter', title: 'Introduction', author: [{ family: 'Lee', given: 'A.' }], 'container-title': book, issued: d(2019) });
  assert.equal(SRC.dedupe([ch('Book One'), ch('Book Two')]).length, 2);
  assert.equal(SRC.dedupe([ch('Book One'), ch('Book one')]).length, 1);
  const beloved = { type: 'book', title: 'Beloved', author: [{ family: 'Morrison', given: 'Toni' }], issued: d(1987) };
  assert.equal(SRC.dedupe([beloved, { ...beloved, URL: 'https://example.com/b' }]).length, 1, 'one with an address, one without');
  assert.equal(SRC.dedupe([{ ...beloved, URL: 'https://www.example.com/b/' }, { ...beloved, URL: 'http://example.com/b' }]).length, 1, 'one address written two ways');
});
test('a Chicago journal entry dated in parentheses does not swallow the entry after it (CMOS 14.171)', () => {
  const B = require('../../extension/writer/writer-bibliography.js');
  const doc = 'Body.\nBibliography\nLee, Ann. "Sleep and Memory." Journal of Sleep 4, no. 2 (2018): 1–9.\nUnited Nations. Report on Sleep and Health. New York: UN, 2020.';
  assert.deepEqual(B.entries(doc).map((e) => e.text), ['Lee, Ann. "Sleep and Memory." Journal of Sleep 4, no. 2 (2018): 1–9.', 'United Nations. Report on Sleep and Health. New York: UN, 2020.']);
});
