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
