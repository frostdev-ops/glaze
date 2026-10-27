// lib/writer-cite.js against each style guide's own published examples, typed in from the publishers' pages (fetched
// 2026-10-27): The Chicago Manual of Style 17th ed. Citation Quick Guide, notes and bibliography
// (chicagomanualofstyle.org/tools_citationguide/citation-guide-1.html, 17th-edition copy); APA Style's reference examples
// for the Publication Manual 7th ed. (apastyle.apa.org/style-grammar-guidelines/references/examples/*); the MLA Style
// Center's MLA Handbook 9th ed. examples (style.mla.org/works-cited/citations-by-format/ and its posts). Where a page's
// typesetting slipped (a period set inside the italics, a stray space, a URL broken over a line), the expected string is
// the guide's own entry with that slip undone; each such case says so.
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../lib/writer-cite.js');

// Guide text → the HTML the formatter writes (only <i>; & escaped).
const h = (s) => s.replace(/&/g, '&amp;');
const d = (y, m, day) => ({ 'date-parts': [[y, m, day].filter(Boolean)] });
const p = (family, given) => (given ? { family, given } : { family });
const L = (literal) => ({ literal });

// ---- Chicago 17 notes and bibliography: the quick guide, every entry it gives for these source types ----
const CMS = [
  { s: { type: 'book', author: [p('Smith', 'Zadie')], title: 'Swing Time', 'publisher-place': 'New York', publisher: 'Penguin Press', issued: d(2016) },
    note: ['315-316', '1. Zadie Smith, <i>Swing Time</i> (New York: Penguin Press, 2016), 315–16.'], short: ['320', '3. Smith, <i>Swing Time</i>, 320.'],
    bib: 'Smith, Zadie. <i>Swing Time</i>. New York: Penguin Press, 2016.' },
  // The guide sets this entry's closing period inside the italics.
  { s: { type: 'book', author: [p('Grazer', 'Brian'), p('Fishman', 'Charles')], title: 'A Curious Mind: The Secret to a Bigger Life', 'publisher-place': 'New York', publisher: 'Simon & Schuster', issued: d(2015) },
    note: ['12', '2. Brian Grazer and Charles Fishman, <i>A Curious Mind: The Secret to a Bigger Life</i> (New York: Simon & Schuster, 2015), 12.'], short: ['37', '4. Grazer and Fishman, <i>Curious Mind</i>, 37.'],
    bib: 'Grazer, Brian, and Charles Fishman. <i>A Curious Mind: The Secret to a Bigger Life</i>. New York: Simon & Schuster, 2015.' },
  { s: { type: 'chapter', author: [p('Thoreau', 'Henry David')], title: 'Walking', 'container-title': 'The Making of the American Essay', editor: [p('D’Agata', 'John')], 'publisher-place': 'Minneapolis', publisher: 'Graywolf Press', issued: d(2016), page: '167-195' },
    note: ['177-178', '1. Henry David Thoreau, “Walking,” in <i>The Making of the American Essay</i>, ed. John D’Agata (Minneapolis: Graywolf Press, 2016), 177–78.'], short: ['182', '2. Thoreau, “Walking,” 182.'],
    bib: 'Thoreau, Henry David. “Walking.” In <i>The Making of the American Essay</i>, edited by John D’Agata, 167–95. Minneapolis: Graywolf Press, 2016.' },
  { s: { type: 'book', editor: [p('D’Agata', 'John')], title: 'The Making of the American Essay', 'title-short': 'American Essay', 'publisher-place': 'Minneapolis', publisher: 'Graywolf Press', issued: d(2016) },
    note: ['177-178', '1. John D’Agata, ed., <i>The Making of the American Essay</i> (Minneapolis: Graywolf Press, 2016), 177–78.'], short: ['182', '2. D’Agata, <i>American Essay</i>, 182.'],
    bib: 'D’Agata, John, ed. <i>The Making of the American Essay</i>. Minneapolis: Graywolf Press, 2016.' },
  // The guide's note has a stray space inside the opening italics.
  { s: { type: 'book', author: [p('Lahiri', 'Jhumpa')], title: 'In Other Words', translator: [p('Goldstein', 'Ann')], 'publisher-place': 'New York', publisher: 'Alfred A. Knopf', issued: d(2016) },
    note: ['146', '1. Jhumpa Lahiri, <i>In Other Words</i>, trans. Ann Goldstein (New York: Alfred A. Knopf, 2016), 146.'], short: ['184', '2. Lahiri, <i>In Other Words</i>, 184.'],
    bib: 'Lahiri, Jhumpa. <i>In Other Words</i>. Translated by Ann Goldstein. New York: Alfred A. Knopf, 2016.' },
  { s: { type: 'book', author: [p('Melville', 'Herman')], title: 'Moby-Dick; or, The Whale', 'publisher-place': 'New York', publisher: 'Harper & Brothers', issued: d(1851), URL: 'http://mel.hofstra.edu/moby-dick-the-whale-proofs.html' },
    note: ['627', '1. Herman Melville, <i>Moby-Dick; or, The Whale</i> (New York: Harper & Brothers, 1851), 627, http://mel.hofstra.edu/moby-dick-the-whale-proofs.html.'], short: ['722-723', '5. Melville, <i>Moby-Dick</i>, 722–23.'],
    bib: 'Melville, Herman. <i>Moby-Dick; or, The Whale</i>. New York: Harper & Brothers, 1851. http://mel.hofstra.edu/moby-dick-the-whale-proofs.html.' },
  { s: { type: 'book', editor: [p('Kurland', 'Philip B.'), p('Lerner', 'Ralph')], title: 'The Founders’ Constitution', 'publisher-place': 'Chicago', publisher: 'University of Chicago Press', issued: d(1987), URL: 'http://press-pubs.uchicago.edu/founders/' },
    note: ['chap. 10, doc. 19', '2. Philip B. Kurland and Ralph Lerner, eds., <i>The Founders’ Constitution</i> (Chicago: University of Chicago Press, 1987), chap. 10, doc. 19, http://press-pubs.uchicago.edu/founders/.'],
    short: ['chap. 4, doc. 29', '6. Kurland and Lerner, <i>Founders’ Constitution</i>, chap. 4, doc. 29.'],
    bib: 'Kurland, Philip B., and Ralph Lerner, eds. <i>The Founders’ Constitution</i>. Chicago: University of Chicago Press, 1987. http://press-pubs.uchicago.edu/founders/.' },
  { s: { type: 'book', author: [p('Borel', 'Brooke')], title: 'The Chicago Guide to Fact-Checking', 'title-short': 'Fact-Checking', 'publisher-place': 'Chicago', publisher: 'University of Chicago Press', issued: d(2016), archive: 'ProQuest Ebrary' },
    note: ['92', '3. Brooke Borel, <i>The Chicago Guide to Fact-Checking</i> (Chicago: University of Chicago Press, 2016), 92, ProQuest Ebrary.'], short: ['104-105', '7. Borel, <i>Fact-Checking</i>, 104–5.'],
    bib: 'Borel, Brooke. <i>The Chicago Guide to Fact-Checking</i>. Chicago: University of Chicago Press, 2016. ProQuest Ebrary.' },
  { s: { type: 'article-journal', author: [p('Satterfield', 'Susan')], title: 'Livy and the <i>Pax Deum</i>', 'title-short': 'Livy', 'container-title': 'Classical Philology', volume: '111', issue: '2', issued: d(2016, 4), page: '165-176' },
    note: ['170', '1. Susan Satterfield, “Livy and the <i>Pax Deum</i>,” <i>Classical Philology</i> 111, no. 2 (April 2016): 170.'], short: ['172-173', '4. Satterfield, “Livy,” 172–73.'],
    bib: 'Satterfield, Susan. “Livy and the <i>Pax Deum</i>.” <i>Classical Philology</i> 111, no. 2 (April 2016): 165–76.' },
  { s: { type: 'article-journal', author: [p('Keng', 'Shao-Hsun'), p('Lin', 'Chun-Hung'), p('Orazem', 'Peter F.')], title: 'Expanding College Access in Taiwan, 1978–2014: Effects on Graduate Quality and Income Inequality', 'container-title': 'Journal of Human Capital', volume: '11', issue: '1', issued: { 'date-parts': [[2017]], season: 'spring' }, page: '1-34', DOI: '10.1086/690235' },
    note: ['9-10', '2. Shao-Hsun Keng, Chun-Hung Lin, and Peter F. Orazem, “Expanding College Access in Taiwan, 1978–2014: Effects on Graduate Quality and Income Inequality,” <i>Journal of Human Capital</i> 11, no. 1 (Spring 2017): 9–10, https://doi.org/10.1086/690235.'],
    short: ['23', '5. Keng, Lin, and Orazem, “Expanding College Access,” 23.'],
    bib: 'Keng, Shao-Hsun, Chun-Hung Lin, and Peter F. Orazem. “Expanding College Access in Taiwan, 1978–2014: Effects on Graduate Quality and Income Inequality.” <i>Journal of Human Capital</i> 11, no. 1 (Spring 2017): 1–34. https://doi.org/10.1086/690235.' },
  // The guide's note has a stray space inside the journal's closing italics.
  { s: { type: 'article-journal', author: [p('LaSalle', 'Peter')], title: 'Conundrum: A Story about Reading', 'container-title': 'New England Review', volume: '38', issue: '1', issued: d(2017), page: '95-109', archive: 'Project MUSE' },
    note: ['95', '3. Peter LaSalle, “Conundrum: A Story about Reading,” <i>New England Review</i> 38, no. 1 (2017): 95, Project MUSE.'], short: ['101', '6. LaSalle, “Conundrum,” 101.'],
    bib: 'LaSalle, Peter. “Conundrum: A Story about Reading.” <i>New England Review</i> 38, no. 1 (2017): 95–109. Project MUSE.' },
  // Four or more authors: the note's first and et al.; all of them (up to ten) in the bibliography. (The guide spells the
  // first author Rachel in the note and Rachael in the entry; each check here keeps the guide's own spelling.)
  { s: { type: 'article-journal', author: [p('Bay', 'Rachael A.'), p('Rose', 'Noah'), p('Barrett', 'Rowan'), p('Bernatchez', 'Louis'), p('Ghalambor', 'Cameron K.'), p('Lasky', 'Jesse R.'), p('Brem', 'Rachel B.'), p('Palumbi', 'Stephen R.'), p('Ralph', 'Peter')],
    title: 'Predicting Responses to Contemporary Environmental Change Using Evolutionary Response Architectures', 'title-short': 'Predicting Responses', 'container-title': 'American Naturalist', volume: '189', issue: '5', issued: d(2017, 5), page: '463-473', DOI: '10.1086/691233' },
    short: ['466', '8. Bay et al., “Predicting Responses,” 466.'],
    bib: 'Bay, Rachael A., Noah Rose, Rowan Barrett, Louis Bernatchez, Cameron K. Ghalambor, Jesse R. Lasky, Rachel B. Brem, Stephen R. Palumbi, and Peter Ralph. “Predicting Responses to Contemporary Environmental Change Using Evolutionary Response Architectures.” <i>American Naturalist</i> 189, no. 5 (May 2017): 463–73. https://doi.org/10.1086/691233.' },
  { s: { type: 'article-journal', author: [p('Bay', 'Rachel A.'), p('Rose', 'Noah'), p('Barrett', 'Rowan'), p('Bernatchez', 'Louis')], title: 'Predicting Responses to Contemporary Environmental Change Using Evolutionary Response Architectures', 'container-title': 'American Naturalist', volume: '189', issue: '5', issued: d(2017, 5), page: '463-473', DOI: '10.1086/691233' },
    note: ['465', '7. Rachel A. Bay et al., “Predicting Responses to Contemporary Environmental Change Using Evolutionary Response Architectures,” <i>American Naturalist</i> 189, no. 5 (May 2017): 465, https://doi.org/10.1086/691233.'] },
  { s: { type: 'article-magazine', author: [p('Mead', 'Rebecca')], title: 'The Prophet of Dystopia', 'title-short': 'Dystopia', 'container-title': 'New Yorker', issued: d(2017, 4, 17) },
    note: ['43', '1. Rebecca Mead, “The Prophet of Dystopia,” <i>New Yorker</i>, April 17, 2017, 43.'], short: ['47', '5. Mead, “Dystopia,” 47.'],
    bib: 'Mead, Rebecca. “The Prophet of Dystopia.” <i>New Yorker</i>, April 17, 2017.' },
  { s: { type: 'article-newspaper', author: [p('Manjoo', 'Farhad')], title: 'Snap Makes a Bet on the Cultural Supremacy of the Camera', 'title-short': 'Snap', 'container-title': 'New York Times', issued: d(2017, 3, 8), URL: 'https://www.nytimes.com/2017/03/08/technology/snap-makes-a-bet-on-the-cultural-supremacy-of-the-camera.html' },
    note: ['', '2. Farhad Manjoo, “Snap Makes a Bet on the Cultural Supremacy of the Camera,” <i>New York Times</i>, March 8, 2017, https://www.nytimes.com/2017/03/08/technology/snap-makes-a-bet-on-the-cultural-supremacy-of-the-camera.html.'],
    short: ['', '6. Manjoo, “Snap.”'],
    bib: 'Manjoo, Farhad. “Snap Makes a Bet on the Cultural Supremacy of the Camera.” <i>New York Times</i>, March 8, 2017. https://www.nytimes.com/2017/03/08/technology/snap-makes-a-bet-on-the-cultural-supremacy-of-the-camera.html.' },
  { s: { type: 'article-newspaper', author: [p('Pegoraro', 'Rob')], title: 'Apple’s iPhone Is Sleek, Smart and Simple', 'title-short': 'Apple’s iPhone', 'container-title': 'Washington Post', issued: d(2007, 7, 5), archive: 'LexisNexis Academic' },
    note: ['', '3. Rob Pegoraro, “Apple’s iPhone Is Sleek, Smart and Simple,” <i>Washington Post</i>, July 5, 2007, LexisNexis Academic.'], short: ['', '7. Pegoraro, “Apple’s iPhone.”'],
    bib: 'Pegoraro, Rob. “Apple’s iPhone Is Sleek, Smart and Simple.” <i>Washington Post</i>, July 5, 2007. LexisNexis Academic.' },
  { s: { type: 'article-newspaper', author: [p('Pai', 'Tanya')], title: 'The Squishy, Sugary History of Peeps', 'title-short': 'History of Peeps', 'container-title': 'Vox', issued: d(2017, 4, 11), URL: 'http://www.vox.com/culture/2017/4/11/15209084/peeps-easter' },
    short: ['', '8. Pai, “History of Peeps.”'],
    note: ['', '4. Tanya Pai, “The Squishy, Sugary History of Peeps,” <i>Vox</i>, April 11, 2017, http://www.vox.com/culture/2017/4/11/15209084/peeps-easter.'],
    bib: 'Pai, Tanya. “The Squishy, Sugary History of Peeps.” <i>Vox</i>, April 11, 2017. http://www.vox.com/culture/2017/4/11/15209084/peeps-easter.' },
  { s: { type: 'webpage', title: 'Privacy Policy', 'container-title': 'Privacy & Terms', publisher: 'Google', issued: d(2017, 4, 17), URL: 'https://www.google.com/policies/privacy/' },
    note: ['', '1. “Privacy Policy,” Privacy & Terms, Google, last modified April 17, 2017, https://www.google.com/policies/privacy/.'],
    bib: 'Google. “Privacy Policy.” Privacy & Terms. Last modified April 17, 2017. https://www.google.com/policies/privacy/.' },
  { s: { type: 'webpage', title: 'About Yale: Yale Facts', 'title-short': 'Yale Facts', publisher: 'Yale University', accessed: d(2017, 5, 1), URL: 'https://www.yale.edu/about-yale/yale-facts' },
    note: ['', '2. “About Yale: Yale Facts,” Yale University, accessed May 1, 2017, https://www.yale.edu/about-yale/yale-facts.'], short: ['', '5. “Yale Facts.”'],
    bib: 'Yale University. “About Yale: Yale Facts.” Accessed May 1, 2017. https://www.yale.edu/about-yale/yale-facts.' },
];

test('Chicago 17: every quick-guide note, short note and bibliography entry for these source types', () => {
  for (const c of CMS) {
    const f = C.format(c.s, 'chicago17');
    if (c.note) assert.equal(f.note(c.note[0]), h(c.note[1].replace(/^\d+\. /, '')), c.s.title);
    if (c.short) assert.equal(f.short(c.short[0]), h(c.short[1].replace(/^\d+\. /, '')), c.s.title);
    if (c.bib) assert.equal(f.entry, h(c.bib), c.s.title);
  }
});

// ---- APA 7: APA Style's reference examples (books, edited books, chapters, journals, magazines, newspapers, webpages,
// YouTube videos, reports) and the in-text citations each page gives ----
const APA = [
  ['Jackson, L. M. (2019). <i>The psychology of prejudice: From attitudes to social action</i> (2nd ed.). American Psychological Association. https://doi.org/10.1037/0000168-000',
    { type: 'book', author: [p('Jackson', 'L. M.')], issued: d(2019), title: 'The psychology of prejudice: From attitudes to social action', edition: '2', publisher: 'American Psychological Association', DOI: '10.1037/0000168-000' }, '(Jackson, 2019)', 'Jackson (2019)'],
  ['Sapolsky, R. M. (2017). <i>Behave: The biology of humans at our best and worst</i>. Penguin Books.',
    { type: 'book', author: [p('Sapolsky', 'Robert M.')], issued: d(2017), title: 'Behave: The biology of humans at our best and worst', publisher: 'Penguin Books' }, '(Sapolsky, 2017)', 'Sapolsky (2017)'],
  ['Hygum, E., & Pedersen, P. M. (Eds.). (2010). <i>Early childhood education: Values and practices in Denmark</i>. Hans Reitzels Forlag. https://earlychildhoodeducation.digi.hansreitzel.dk/',
    { type: 'book', editor: [p('Hygum', 'E.'), p('Pedersen', 'P. M.')], issued: d(2010), title: 'Early childhood education: Values and practices in Denmark', publisher: 'Hans Reitzels Forlag', URL: 'https://earlychildhoodeducation.digi.hansreitzel.dk/' }, '(Hygum & Pedersen, 2010)', 'Hygum and Pedersen (2010)'],
  ['Kesharwani, P. (Ed.). (2020). <i>Nanotechnology based approaches for tuberculosis treatment</i>. Academic Press.',
    { type: 'book', editor: [p('Kesharwani', 'Prashant')], issued: d(2020), title: 'Nanotechnology based approaches for tuberculosis treatment', publisher: 'Academic Press' }, '(Kesharwani, 2020)', 'Kesharwani (2020)'],
  ['Torino, G. C., Rivera, D. P., Capodilupo, C. M., Nadal, K. L., & Sue, D. W. (Eds.). (2019). <i>Microaggression theory: Influence and implications</i>. John Wiley & Sons. https://doi.org/10.1002/9781119466642',
    { type: 'book', editor: [p('Torino', 'G. C.'), p('Rivera', 'D. P.'), p('Capodilupo', 'C. M.'), p('Nadal', 'K. L.'), p('Sue', 'D. W.')], issued: d(2019), title: 'Microaggression theory: Influence and implications', publisher: 'John Wiley & Sons', DOI: '10.1002/9781119466642' }, '(Torino et al., 2019)', 'Torino et al. (2019)'],
  ['Aron, L., Botella, M., & Lubart, T. (2019). Culinary arts: Talent and their development. In R. F. Subotnik, P. Olszewski-Kubilius, & F. C. Worrell (Eds.), <i>The psychology of high performance: Developing human potential into domain-specific talent</i> (pp. 345–359). American Psychological Association. https://doi.org/10.1037/0000120-016',
    { type: 'chapter', author: [p('Aron', 'L.'), p('Botella', 'M.'), p('Lubart', 'T.')], issued: d(2019), title: 'Culinary arts: Talent and their development', editor: [p('Subotnik', 'R. F.'), p('Olszewski-Kubilius', 'Paula'), p('Worrell', 'F. C.')], 'container-title': 'The psychology of high performance: Developing human potential into domain-specific talent', page: '345-359', publisher: 'American Psychological Association', DOI: '10.1037/0000120-016' }, '(Aron et al., 2019)', 'Aron et al. (2019)'],
  ['Dillard, J. P. (2020). Currents in the study of persuasion. In M. B. Oliver, A. A. Raney, & J. Bryant (Eds.), <i>Media effects: Advances in theory and research</i> (4th ed., pp. 115–129). Routledge.',
    { type: 'chapter', author: [p('Dillard', 'James Price')], issued: d(2020), title: 'Currents in the study of persuasion', editor: [p('Oliver', 'M. B.'), p('Raney', 'A. A.'), p('Bryant', 'J.')], 'container-title': 'Media effects: Advances in theory and research', edition: '4th', page: '115–129', publisher: 'Routledge' }, '(Dillard, 2020)', 'Dillard (2020)'],
  ['Thestrup, K. (2010). To transform, to communicate, to play—The experimenting community in action. In E. Hygum & P. M. Pedersen (Eds.), <i>Early childhood education: Values and practices in Denmark</i>. Hans Reitzels Forlag. https://earlychildhoodeducation.digi.hansreitzel.dk/?id=192',
    { type: 'chapter', author: [p('Thestrup', 'K.')], issued: d(2010), title: 'To transform, to communicate, to play—The experimenting community in action', editor: [p('Hygum', 'E.'), p('Pedersen', 'P. M.')], 'container-title': 'Early childhood education: Values and practices in Denmark', publisher: 'Hans Reitzels Forlag', URL: 'https://earlychildhoodeducation.digi.hansreitzel.dk/?id=192' }, '(Thestrup, 2010)', 'Thestrup (2010)'],
  ['Grady, J. S., Her, M., Moreno, G., Perez, C., & Yelinek, J. (2019). Emotions in storybooks: A comparison of storybooks that represent ethnic and racial groups in the United States. <i>Psychology of Popular Media Culture</i>, <i>8</i>(3), 207–217. https://doi.org/10.1037/ppm0000185',
    { type: 'article-journal', author: [p('Grady', 'J. S.'), p('Her', 'M.'), p('Moreno', 'G.'), p('Perez', 'C.'), p('Yelinek', 'J.')], issued: d(2019), title: 'Emotions in storybooks: A comparison of storybooks that represent ethnic and racial groups in the United States', 'container-title': 'Psychology of Popular Media Culture', volume: '8', issue: '3', page: '207-217', DOI: '10.1037/ppm0000185' }, '(Grady et al., 2019)', 'Grady et al. (2019)'],
  ['Jerrentrup, A., Mueller, T., Glowalla, U., Herder, M., Henrichs, N., Neubauer, A., & Schaefer, J. R. (2018). Teaching medicine with the help of “Dr. House.” <i>PLoS ONE</i>, <i>13</i>(3), Article e0193972. https://doi.org/10.1371/journal.pone.0193972',
    { type: 'article-journal', author: [p('Jerrentrup', 'A.'), p('Mueller', 'T.'), p('Glowalla', 'U.'), p('Herder', 'M.'), p('Henrichs', 'N.'), p('Neubauer', 'A.'), p('Schaefer', 'J. R.')], issued: d(2018), title: 'Teaching medicine with the help of “Dr. House.”', 'container-title': 'PLoS ONE', volume: '13', issue: '3', number: 'e0193972', DOI: '10.1371/journal.pone.0193972' }, '(Jerrentrup et al., 2018)', 'Jerrentrup et al. (2018)'],
  ['Stegmeir, M. (2016). Climate change: New discipline practices promote college access. <i>The Journal of College Admission</i>, (231), 44–47. https://www.nxtbook.com/ygsreprints/NACAC/nacac_jca_spring2016/#/46',
    { type: 'article-journal', author: [p('Stegmeir', 'M.')], issued: d(2016), title: 'Climate change: New discipline practices promote college access', 'container-title': 'The Journal of College Admission', issue: '231', page: '44-47', URL: 'https://www.nxtbook.com/ygsreprints/NACAC/nacac_jca_spring2016/#/46' }, '(Stegmeir, 2016)', 'Stegmeir (2016)'],
  // The page splits the journal's italics in two ("Computers in" "Human Behavior"); one span here.
  ['Sanchiz, M., Chevalier, A., & Amadieu, F. (2017). How do older and young adults start searching for information? Impact of age, domain knowledge and problem complexity on the different steps of information searching. <i>Computers in Human Behavior</i>, <i>72</i>, 67–78. https://doi.org/10.1016/j.chb.2017.02.038',
    { type: 'article-journal', author: [p('Sanchiz', 'M.'), p('Chevalier', 'A.'), p('Amadieu', 'F.')], issued: d(2017), title: 'How do older and young adults start searching for information? Impact of age, domain knowledge and problem complexity on the different steps of information searching', 'container-title': 'Computers in Human Behavior', volume: '72', page: '67-78', DOI: '10.1016/j.chb.2017.02.038' }, '(Sanchiz et al., 2017)', 'Sanchiz et al. (2017)'],
  ['Butler, J. (2017). Where access meets multimodality: The case of ASL music videos. <i>Kairos: A Journal of Rhetoric, Technology, and Pedagogy</i>, <i>21</i>(1). http://technorhetoric.net/21.1/topoi/butler/index.html',
    { type: 'article-journal', author: [p('Butler', 'J.')], issued: d(2017), title: 'Where access meets multimodality: The case of ASL music videos', 'container-title': 'Kairos: A Journal of Rhetoric, Technology, and Pedagogy', volume: '21', issue: '1', URL: 'http://technorhetoric.net/21.1/topoi/butler/index.html' }, '(Butler, 2017)', 'Butler (2017)'],
  ['Lyons, D. (2009, June 15). Don’t ‘iTune’ us: It’s geeks versus writers. Guess who’s winning. <i>Newsweek</i>, <i>153</i>(24), 27.',
    { type: 'article-magazine', author: [p('Lyons', 'D.')], issued: d(2009, 6, 15), title: 'Don’t ‘iTune’ us: It’s geeks versus writers. Guess who’s winning', 'container-title': 'Newsweek', volume: '153', issue: '24', page: '27' }, '(Lyons, 2009)', 'Lyons (2009)'],
  ['Schaefer, N. K., & Shapiro, B. (2019, September 6). New middle chapter in the story of human evolution. <i>Science</i>, <i>365</i>(6457), 981–982. https://doi.org/10.1126/science.aay3550',
    { type: 'article-magazine', author: [p('Schaefer', 'N. K.'), p('Shapiro', 'B.')], issued: d(2019, 9, 6), title: 'New middle chapter in the story of human evolution', 'container-title': 'Science', volume: '365', issue: '6457', page: '981-982', DOI: '10.1126/science.aay3550' }, '(Schaefer & Shapiro, 2019)', 'Schaefer and Shapiro (2019)'],
  ['Schulman, M. (2019, September 9). Superfans: A love story. <i>The New Yorker</i>. https://www.newyorker.com/magazine/2019/09/16/superfans-a-love-story',
    { type: 'article-magazine', author: [p('Schulman', 'M.')], issued: d(2019, 9, 9), title: 'Superfans: A love story', 'container-title': 'The New Yorker', URL: 'https://www.newyorker.com/magazine/2019/09/16/superfans-a-love-story' }, '(Schulman, 2019)', 'Schulman (2019)'],
  ['Carey, B. (2019, March 22). Can we get better at forgetting? <i>The New York Times</i>. https://www.nytimes.com/2019/03/22/health/memory-forgetting-psychology.html',
    { type: 'article-newspaper', author: [p('Carey', 'Benedict')], issued: d(2019, 3, 22), title: 'Can we get better at forgetting?', 'container-title': 'The New York Times', URL: 'https://www.nytimes.com/2019/03/22/health/memory-forgetting-psychology.html' }, '(Carey, 2019)', 'Carey (2019)'],
  ['Harlan, C. (2013, April 2). North Korea vows to restart shuttered nuclear reactor that can make bomb-grade plutonium. <i>The Washington Post</i>, A1, A4.',
    { type: 'article-newspaper', author: [p('Harlan', 'C.')], issued: d(2013, 4, 2), title: 'North Korea vows to restart shuttered nuclear reactor that can make bomb-grade plutonium', 'container-title': 'The Washington Post', page: 'A1, A4' }, '(Harlan, 2013)', 'Harlan (2013)'],
  ['Stobbe, M. (2020, January 8). Cancer death rate in U.S. sees largest one-year drop ever. <i>Chicago Tribune</i>.',
    { type: 'article-newspaper', author: [p('Stobbe', 'M.')], issued: d(2020, 1, 8), title: 'Cancer death rate in U.S. sees largest one-year drop ever', 'container-title': 'Chicago Tribune' }, '(Stobbe, 2020)', 'Stobbe (2020)'],
  ['Bologna, C. (2019, October 31). <i>Why some people with anxiety love watching horror movies</i>. HuffPost. https://www.huffpost.com/entry/anxiety-love-watching-horror-movies_l_5d277587e4b02a5a5d57b59e',
    { type: 'webpage', author: [p('Bologna', 'C.')], issued: d(2019, 10, 31), title: 'Why some people with anxiety love watching horror movies', 'container-title': 'HuffPost', URL: 'https://www.huffpost.com/entry/anxiety-love-watching-horror-movies_l_5d277587e4b02a5a5d57b59e' }, '(Bologna, 2019)', 'Bologna (2019)'],
  ['Horovitz, B. (2021, October 19). <i>Are you ready to move your aging parent into your home?</i> AARP. https://www.aarp.org/caregiving/home-care/info-2021/caregiving-questions.html',
    { type: 'webpage', author: [p('Horovitz', 'B.')], issued: d(2021, 10, 19), title: 'Are you ready to move your aging parent into your home?', 'container-title': 'AARP', URL: 'https://www.aarp.org/caregiving/home-care/info-2021/caregiving-questions.html' }, '(Horovitz, 2021)', 'Horovitz (2021)'],
  ['National Institute of Mental Health. (2018, July). <i>Anxiety disorders</i>. U.S. Department of Health and Human Services, National Institutes of Health. https://www.nimh.nih.gov/health/topics/anxiety-disorders/index.shtml',
    { type: 'webpage', author: [L('National Institute of Mental Health')], issued: d(2018, 7), title: 'Anxiety disorders', publisher: 'U.S. Department of Health and Human Services, National Institutes of Health', URL: 'https://www.nimh.nih.gov/health/topics/anxiety-disorders/index.shtml' }, '(National Institute of Mental Health, 2018)', 'National Institute of Mental Health (2018)'],
  // The page sets the period after the date inside the italics.
  ['World Health Organization. (2018, May 24). <i>The top 10 causes of death</i>. https://www.who.int/news-room/fact-sheets/detail/the-top-10-causes-of-death',
    { type: 'webpage', author: [L('World Health Organization')], issued: d(2018, 5, 24), title: 'The top 10 causes of death', 'container-title': 'World Health Organization', URL: 'https://www.who.int/news-room/fact-sheets/detail/the-top-10-causes-of-death' }, '(World Health Organization, 2018)', 'World Health Organization (2018)'],
  ['U.S. Census Bureau. (n.d.). <i>U.S. and world population clock</i>. U.S. Department of Commerce. Retrieved January 9, 2020, from https://www.census.gov/popclock/',
    { type: 'webpage', author: [L('U.S. Census Bureau')], title: 'U.S. and world population clock', publisher: 'U.S. Department of Commerce', accessed: d(2020, 1, 9), URL: 'https://www.census.gov/popclock/' }, '(U.S. Census Bureau, n.d.)', 'U.S. Census Bureau (n.d.)'],
  ['Harvard University. (2019, August 28). <i>Soft robotic gripper for jellyfish</i> [Video]. YouTube. https://www.youtube.com/watch?v=guRoWTYfxMs',
    { type: 'motion_picture', author: [L('Harvard University')], issued: d(2019, 8, 28), title: 'Soft robotic gripper for jellyfish', 'container-title': 'YouTube', URL: 'https://www.youtube.com/watch?v=guRoWTYfxMs' }, '(Harvard University, 2019)', 'Harvard University (2019)'],
  ['Asian Boss. (2020, June 5). <i>World’s leading vaccine expert fact-checks COVID-19 vaccine conspiracy: Stay curious #22</i> [Video]. YouTube. https://www.youtube.com/watch?v=WQdLDMLrYIA',
    { type: 'motion_picture', publisher: 'Asian Boss', issued: d(2020, 6, 5), title: 'World’s leading vaccine expert fact-checks COVID-19 vaccine conspiracy: Stay curious #22', 'container-title': 'YouTube', URL: 'https://www.youtube.com/watch?v=WQdLDMLrYIA' }, '(Asian Boss, 2020)', 'Asian Boss (2020)'],
  ['National Cancer Institute. (2019). <i>Taking time: Support for people with cancer</i> (NIH Publication No. 18-2059). U.S. Department of Health and Human Services, National Institutes of Health. https://www.cancer.gov/publications/patient-education/takingtime.pdf',
    { type: 'report', author: [L('National Cancer Institute')], issued: d(2019), title: 'Taking time: Support for people with cancer', genre: 'NIH Publication', number: '18-2059', publisher: 'U.S. Department of Health and Human Services, National Institutes of Health', URL: 'https://www.cancer.gov/publications/patient-education/takingtime.pdf' }, '(National Cancer Institute, 2019)', 'National Cancer Institute (2019)'],
];

test('APA 7: APA Style\'s reference examples and their parenthetical and narrative citations', () => {
  for (const [entry, s, paren, narrative] of APA) {
    const f = C.format(s, 'apa7');
    assert.equal(f.entry, h(entry));
    assert.equal(f.inText(), h(paren));
    assert.equal(f.narrative(), h(narrative));
  }
  // A quotation's page (APA 8.13): (Author, year, p. x), pp. for a range.
  const morrison = { type: 'book', author: [p('Morrison', 'Toni')], title: 'Beloved', issued: d(1987), publisher: 'Alfred A. Knopf' };
  assert.equal(C.format(morrison, 'apa7').inText('42'), '(Morrison, 1987, p. 42)');
  assert.equal(C.format(morrison, 'apa7').inText('42-43'), '(Morrison, 1987, pp. 42–43)');
});

// ---- MLA 9: the MLA Style Center's examples ----
const MLA = [
  ['Mantel, Hilary. <i>Wolf Hall</i>. Picador, 2010.', { type: 'book', author: [p('Mantel', 'Hilary')], title: 'Wolf Hall', publisher: 'Picador', issued: d(2010) }],
  ['<i>Beowulf</i>. Translated by Alan Sullivan and Timothy Murphy, edited by Sarah Anderson, Pearson, 2004.',
    { type: 'book', title: 'Beowulf', translator: [p('Sullivan', 'Alan'), p('Murphy', 'Timothy')], editor: [p('Anderson', 'Sarah')], publisher: 'Pearson', issued: d(2004) }],
  ['Sánchez Prado, Ignacio M., editor. <i>Mexican Literature in Theory</i>. Bloomsbury, 2018.', { type: 'book', editor: [p('Sánchez Prado', 'Ignacio M.')], title: 'Mexican Literature in Theory', publisher: 'Bloomsbury', issued: d(2018) }],
  // The page breaks the address over a line with a space in it.
  ['Deresiewicz, William. “The Death of the Artist—and the Birth of the Creative Entrepreneur.” <i>The Atlantic</i>, 28 Dec. 2014, theatlantic.com/magazine/archive/2015/01/the-death-of-the-artist-and-the-birth-of-thecreative-entrepreneur/383497/.',
    { type: 'article-magazine', author: [p('Deresiewicz', 'William')], title: 'The Death of the Artist—and the Birth of the Creative Entrepreneur', 'container-title': 'The Atlantic', issued: d(2014, 12, 28), URL: 'https://theatlantic.com/magazine/archive/2015/01/the-death-of-the-artist-and-the-birth-of-thecreative-entrepreneur/383497/' }],
  ['Poe, Edgar Allan. “The Masque of the Red Death.” <i>The Complete Works of Edgar Allan Poe</i>, edited by James A. Harrison, vol. 4, Thomas Y. Crowell, 1902, pp. 250-58. <i>HathiTrust Digital Library</i>, hdl.handle.net/2027/coo.31924079574368.',
    { type: 'chapter', author: [p('Poe', 'Edgar Allan')], title: 'The Masque of the Red Death', 'container-title': 'The Complete Works of Edgar Allan Poe', editor: [p('Harrison', 'James A.')], volume: '4', publisher: 'Thomas Y. Crowell', issued: d(1902), page: '250-258', archive: 'HathiTrust Digital Library', URL: 'https://hdl.handle.net/2027/coo.31924079574368' }],
  ['Goldman, Anne. “Questions of Transport: Reading Primo Levi Reading Dante.” <i>The Georgia Review</i>, vol. 64, no. 1, spring 2010, pp. 69-88. <i>JSTOR</i>, www.jstor.org/stable/41403188.',
    { type: 'article-journal', author: [p('Goldman', 'Anne')], title: 'Questions of Transport: Reading Primo Levi Reading Dante', 'container-title': 'The Georgia Review', volume: '64', issue: '1', issued: { 'date-parts': [[2010]], season: 'spring' }, page: '69-88', archive: 'JSTOR', URL: 'https://www.jstor.org/stable/41403188' }],
  ['Burdick, Anne, et al. <i>Digital_Humanities</i>. MIT P, 2012.',
    { type: 'book', author: [p('Burdick', 'Anne'), p('Drucker', 'Johanna'), p('Lunenfeld', 'Peter'), p('Presner', 'Todd'), p('Schnapp', 'Jeffrey')], title: 'Digital_Humanities', publisher: 'MIT P', issued: d(2012) }],
  ['Dewar, James A., and Peng Hwa Ang. “The Cultural Consequences of Printing and the Internet.” <i>Agent of Change: Print Culture Studies after Elizabeth L. Eisenstein</i>, edited by Sabrina Alcorn Baron et al., U of Massachusetts P / Center for the Book, Library of Congress, 2007, pp. 365-77.',
    { type: 'chapter', author: [p('Dewar', 'James A.'), p('Ang', 'Peng Hwa')], title: 'The Cultural Consequences of Printing and the Internet', 'container-title': 'Agent of Change: Print Culture Studies after Elizabeth L. Eisenstein', editor: [p('Baron', 'Sabrina Alcorn'), p('Lindquist', 'Eric N.'), p('Shevlin', 'Eleanor F.')], publisher: 'U of Massachusetts P / Center for the Book, Library of Congress', issued: d(2007), page: '365-377' }],
  ['Beyoncé. “Beyoncé – Pretty Hurts (Video).” <i>YouTube</i>, 24 Apr. 2014, www.youtube.com/watch?v=LXXQLa-5n5w.',
    { type: 'motion_picture', author: [p('Beyoncé')], title: 'Beyoncé – Pretty Hurts (Video)', 'container-title': 'YouTube', issued: d(2014, 4, 24), URL: 'https://www.youtube.com/watch?v=LXXQLa-5n5w' }],
  ['“Capybara Eat Huge Pumpkin.” <i>YouTube</i>, uploaded by Alex Smith, 12 Jan. 2021, www.youtube.com/watch?v=8YNwxZnABzA.',
    { type: 'motion_picture', title: 'Capybara Eat Huge Pumpkin', 'container-title': 'YouTube', publisher: 'Alex Smith', issued: d(2021, 1, 12), URL: 'https://www.youtube.com/watch?v=8YNwxZnABzA' }],
];

test('MLA 9: the MLA Style Center\'s works-cited examples', () => {
  for (const [entry, s] of MLA) assert.equal(C.format(s, 'mla9').entry, h(entry));
});

// The rules each guide states, beyond its printed examples.
test('MLA in-text citations: author and page with no comma, two authors joined by and, et al. from three, a title without an author', () => {
  const f = (s, page) => C.format(s, 'mla9').inText(page);
  assert.equal(f({ type: 'book', author: [p('Morrison', 'Toni')], title: 'Beloved' }, '42'), '(Morrison 42)');
  assert.equal(f({ type: 'book', author: [p('Dorris', 'Michael'), p('Erdrich', 'Louise')], title: 'The Crown of Columbus' }, '23'), '(Dorris and Erdrich 23)');
  assert.equal(f(MLA[6][1], '7'), '(Burdick et al. 7)');
  assert.equal(f(MLA[9][1]), '(“Capybara Eat Huge Pumpkin”)');
  assert.equal(f({ type: 'book', title: 'Beowulf', translator: [p('Sullivan', 'Alan')] }, '12'), '(<i>Beowulf</i> 12)');
  assert.equal(C.format({ type: 'book', author: [p('Morrison', 'Toni')], title: 'Beloved' }, 'mla9').narrative('42'), '(42)');
});

test('page ranges: MLA keeps two digits (103-04, 395-401), Chicago 9.64 keeps what changes, APA keeps every digit', () => {
  const cases = [['103-104', '103-04', '103–4', '103–104'], ['395-401', '395-401', '395–401', '395–401'], ['96-117', '96-117', '96–117', '96–117'],
    ['1496-1500', '1496-1500', '1496–500', '1496–1500'], ['321-328', '321-28', '321–28', '321–328'], ['808-833', '808-33', '808–33', '808–833'], ['100-104', '100-04', '100–104', '100–104'],
    ['1103-1104', '1103-04', '1103–4', '1103–1104'], ['xix', 'xix', 'xix', 'xix']];
  for (const [input, mla, cms, apa] of cases) {
    assert.equal(C.pages(input, 'mla'), mla, input);
    assert.equal(C.pages(input, 'cms'), cms, input);
    assert.equal(C.pages(input, 'apa'), apa, input);
  }
});

test('APA lists up to twenty authors and then an ellipsis before the last; no author moves the title first', () => {
  const many = Array.from({ length: 22 }, (_, i) => p(`Author${String.fromCharCode(65 + i)}`, 'A.'));
  const e = C.format({ type: 'article-journal', author: many, issued: d(2020), title: 'Long list', 'container-title': 'Journal', volume: '1', page: '1-2' }, 'apa7').entry;
  assert.match(e, /^AuthorA, A\., AuthorB, A\., .*AuthorS, A\., \. \. \. AuthorV, A\. \(2020\)\./);
  assert.ok(!e.includes('AuthorT'));
  assert.equal(C.format({ type: 'book', title: 'Merriam-Webster’s collegiate dictionary', edition: '11', issued: d(2003), publisher: 'Merriam-Webster' }, 'apa7').entry,
    '<i>Merriam-Webster’s collegiate dictionary</i> (11th ed.). (2003). Merriam-Webster.');
});

test('lists: each style\'s title, in its order (leading articles aside, a group by its name)', () => {
  const sources = [MLA[0][1], MLA[1][1], MLA[6][1], { ...MLA[9][1] }, MLA[2][1]];
  const l = C.list(sources, 'mla9');
  assert.equal(l.title, 'Works Cited');
  assert.deepEqual(l.entries.map((e) => e.html.slice(0, 18)), ['<i>Beowulf</i>. Tr', 'Burdick, Anne, et ', '“Capybara Eat Huge', 'Mantel, Hilary. <i', 'Sánchez Prado, Ign']);
  assert.equal(C.list([], 'apa7').title, 'References');
  assert.equal(C.list([], 'chicago17').title, 'Bibliography');
  // Chicago's own example list order.
  const cms = C.list([CMS[0].s, CMS[1].s], 'chicago17').entries.map((e) => e.html.split('.')[0]);
  assert.deepEqual(cms, ['Grazer, Brian, and Charles Fishman', 'Smith, Zadie']);
});

test('entries escape what a source holds; titles keep only their italics', () => {
  const e = C.format({ type: 'webpage', author: [p('<b>X</b>', 'Y')], title: 'A <script>alert(1)</script> & <i>B</i> <img src=x onerror=1>', 'container-title': 'Site', URL: 'https://e.test/?a=1&b=<2>' }, 'mla9').entry;
  assert.ok(!/<(?!\/?i>)/.test(e), e);
  assert.match(e, /&amp; <i>B<\/i>/);
});

// Additional rule checks, with synthetic works. MLA 9: style.mla.org/works-cited-a-quick-guide/ and
// style.mla.org/works-cited/citations-by-format/. APA 7: apastyle.apa.org/style-grammar-guidelines/references/elements-list-entry
// (title, date and source), /examples/newspaper-article-references; list order: MLA Handbook 9, 5.123;
// Chicago 17, 14.71 (same author, alphabetical titles), contrasted with APA 7, 9.46 (chronological).
test('MLA: a first author without a given name still takes a comma before et al.', () => {
  const s = { type: 'book', title: 'Collected Work', author: [p('Beyoncé'), p('Smith'), p('Jones')] };
  assert.equal(C.format(s, 'mla9').entry, 'Beyoncé, et al. <i>Collected Work</i>.');
});

test('MLA: an organization that is also publisher is cited by the title that leads its entry', () => {
  const s = { type: 'report', title: 'Annual Findings', author: [L('Research Council')], publisher: 'Research Council', issued: d(2020) };
  assert.equal(C.format(s, 'mla9').inText('4'), '(<i>Annual Findings</i> 4)');
});

test('MLA and Chicago alphabetize the same author by title; APA orders by date', () => {
  const works = [{ id: 'zeta', type: 'book', author: [p('Lee', 'Alex')], title: 'Zeta', issued: d(2000) }, { id: 'alpha', type: 'book', author: [p('Lee', 'Alex')], title: 'The Alpha', issued: d(2020) }];
  for (const style of ['mla9', 'chicago17']) assert.deepEqual(C.list(works, style).entries.map((e) => e.id), ['alpha', 'zeta']);
  assert.deepEqual(C.list(works, 'apa7').entries.map((e) => e.id), ['zeta', 'alpha']);
});

test('APA: an anonymous standalone webpage has an italicized title in text', () => {
  const f = C.format({ type: 'webpage', title: 'A guide to research', issued: d(2020) }, 'apa7');
  assert.equal(f.inText(), '(<i>Guide to Research</i>, 2020)');
});

test('APA: print newspaper page ranges take pp., journal page ranges do not', () => {
  const s = { type: 'article-newspaper', author: [p('Lee', 'Alex')], title: 'A new finding', 'container-title': 'Daily News', page: '2-4', issued: d(2020, 4, 2) };
  assert.equal(C.format(s, 'apa7').entry, 'Lee, A. (2020, April 2). A new finding. <i>Daily News</i>, pp. 2–4.');
});

test('APA: no date alone does not require a retrieval date or override the DOI', () => {
  const s = { type: 'webpage', author: [p('Lee', 'Alex')], title: 'A stable page', URL: 'https://example.org/page', accessed: d(2026, 10, 27), DOI: '10.5555/page' };
  assert.equal(C.format(s, 'apa7').entry, 'Lee, A. (n.d.). <i>A stable page</i>. https://doi.org/10.5555/page');
});

test('APA: book volumes join the edition outside the italic title', () => {
  const s = { type: 'book', author: [p('Lee', 'Alex')], title: 'Research methods', edition: '2', volume: '3', publisher: 'Press', issued: d(2020) };
  assert.equal(C.format(s, 'apa7').entry, 'Lee, A. (2020). <i>Research methods</i> (2nd ed., Vol. 3). Press.');
});
