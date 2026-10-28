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
