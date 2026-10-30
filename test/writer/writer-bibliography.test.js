const test = require('node:test');
const assert = require('node:assert/strict');
const B = require('../lib/writer-bibliography.js'), S = require('../lib/writer-sources.js'), C = require('../lib/writer-cite.js');
const mla = 'Rivera, Alex, and Sam Patel. “Learning in School Gardens.” Journal of Garden Studies, vol. 7, no. 2, May 2024, pp. 12–19, doi.org/10.1234/gardens.2024.5.';
const apa = 'Rivera, A., & Patel, S. (2024). Learning in school gardens. Journal of Garden Studies, 7(2), 12–19. https://doi.org/10.1234/gardens.2024.5';
const para = (text) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
test('a bibliography is recovered from existing document paragraphs without AI', () => {
  const doc = { content: [para('My essay'), para('A source is discussed here.'), para('Works Cited'), para(mla), para('“Garden Highlights.” Garden Review, vol. 3, 2023, pp. 8–9, example.org/report.pdf.')] };
  const entries = B.entries(doc); assert.equal(entries.length, 2);
  const src = B.parse(entries[0]);
  assert.equal(src.title, 'Learning in School Gardens'); assert.equal(src.type, 'article-journal');
  assert.deepEqual(src.author, [{ family: 'Rivera', given: 'Alex' }, { family: 'Patel', given: 'Sam' }]);
  assert.deepEqual(src.issued, { 'date-parts': [[2024, 5]] });
  assert.equal(src['container-title'], 'Journal of Garden Studies'); assert.equal(src.volume, '7'); assert.equal(src.issue, '2');
  assert.equal(src.page, '12–19'); assert.equal(src.DOI, '10.1234/gardens.2024.5');
  assert.equal(src.original, mla);
  const anonymous = B.parse(entries[1]); assert.equal(anonymous.title, 'Garden Highlights'); assert.ok(!anonymous.author);
  assert.ok(C.list([src, anonymous], 'mla9').entries.some((e) => e.html.includes('<i>Journal of Garden Studies</i>')));
});
test('APA dates and initials and unquoted Chicago books use the same source format', () => {
  const a = B.parse(apa);
  assert.equal(a.title, 'Learning in school gardens'); assert.equal(a['container-title'], 'Journal of Garden Studies');
  assert.deepEqual(a.author, [{ family: 'Rivera', given: 'A' }, { family: 'Patel', given: 'S' }]);
  assert.equal(a.page, '12–19'); assert.equal(a.issue, '2'); assert.equal(a.volume, '7');
  const book = B.parse('Rivera, Alex. Gardens for Learning. Example Press, 2022.');
  assert.equal(book.type, 'book'); assert.equal(book.title, 'Gardens for Learning'); assert.equal(book.publisher, 'Example Press');
});
test('missing bibliographies do not turn prose into sources; raw uncertain entries survive storage and formatting', () => {
  assert.deepEqual(B.entries({ content: [para('Sources suggest gardens help.'), para(mla)] }), []);
  const text = 'Unfamiliar archival notation <script>alert(1)</script> from an old notebook';
  const raw = B.parse(text); assert.equal(raw.unparsed, true); assert.equal(raw.original, text);
  const saved = S.dedupe([raw])[0]; assert.equal(saved.original, text);
  assert.equal(C.list([saved], 'apa7').entries[0].html, 'Unfamiliar archival notation &lt;script&gt;alert(1)&lt;/script&gt; from an old notebook');
});
test('entries have stable identities and merge with an existing source without overwriting its edits', () => {
  const [entry] = B.entries(`References\n${mla}`); assert.equal(entry.id, B.entries(`References\n${mla}`)[0].id);
  const imported = B.parse(entry), manual = S.normalize({ ...imported, id: 'manual-source', title: 'A title edited by the user' });
  const merged = S.add([manual], imported).sources;
  assert.equal(merged.length, 1); assert.equal(merged[0].id, manual.id); assert.equal(merged[0].title, manual.title);
});
test('page breaks, blank paragraphs and hard wrapped citation lines do not create empty sources', () => {
  const doc = { content: [para('Bibliography'), { type: 'page_break' }, para(''), { type: 'paragraph', content: [{ type: 'text', text: 'Rivera, Alex. “Garden Learning.”' }, { type: 'hard_break' }, { type: 'text', text: 'Garden Journal, 2024.' }] }] };
  assert.deepEqual(B.entries(doc).map((e) => e.text), ['Rivera, Alex. “Garden Learning.” Garden Journal, 2024.']);
});
test('wrapped paragraphs and DOI lines stay with their citation; later sections are excluded', () => {
  const doc = { content: [para('Works Cited'), para('Rivera, Alex. “Garden Learning.”'), para('Journal of Gardens, vol. 3, 2024, pp. 2–9.'), para('https://doi.org/10.1234/garden'), para('Smith, J. R. A Garden Book. Example Press, 2022.'), { type: 'heading', content: [{ type: 'text', text: 'Appendix' }] }, para('A table belongs to the appendix.') ] };
  const entries = B.entries(doc); assert.equal(entries.length, 2);
  assert.equal(B.parse(entries[0]).DOI, '10.1234/garden');
  assert.equal(B.parse(entries[1]).title, 'A Garden Book');
});
test('initials, place and publisher, APA books and month-first web dates retain their roles', () => {
  for (const author of ['Smith, J. R.', 'J. R. Smith.']) {
    const s = B.parse(`${author} The Learning Garden. New York: Example Press, 2022.`);
    assert.equal(s.title, 'The Learning Garden'); assert.equal(s.publisher, 'Example Press'); assert.equal(s['publisher-place'], 'New York');
    assert.equal(s.author[0].family, 'Smith'); assert.equal(s.author[0].given.replace(/\./g, ''), 'J R');
  }
  const book = B.parse('Rivera, A. (2022). U.S. school gardens. Example Press.');
  assert.equal(book.title, 'U.S. school gardens'); assert.equal(book.type, 'book'); assert.equal(book.publisher, 'Example Press');
  const web = B.parse('Rivera, Alex. “Garden Learning.” Garden Site, May 8, 2024, https://example.org/garden.');
  assert.equal(web.type, 'webpage'); assert.deepEqual(web.issued, { 'date-parts': [[2024, 5, 8]] });
});
test('three APA authors and long-entry DOI metadata stay grounded in the entry', () => {
  const s = B.parse('Smith, J. R., Patel, S. K., & Chen, T. (2023). Learning in gardens. Garden Studies, 3(2), 12–20. https://doi.org/10.1234/test');
  assert.deepEqual(s.author.map((n) => n.family), ['Smith', 'Patel', 'Chen']);
  const long = B.parse(`Rivera, Alex. “${'Garden learning '.repeat(25)}.” Garden Studies, 2024, https://doi.org/10.1234/long.`);
  assert.equal(long.DOI, '10.1234/long'); assert.equal(B.parse(null), null);
});
test('source storage preserves bibliography removals and explicit reviews without affecting old callers', async () => {
  const cache = {}, area = { get: async (key) => ({ [key]: cache[key] }), set: async (value) => Object.assign(cache, value), remove: async (key) => delete cache[key] };
  const key = S.key({ school: 'school', user: 'u', course: 'c', item: 'i' });
  const reviewed = S.normalize({ ...B.parse(mla), reviewed: true });
  await S.save(key, [reviewed], area, { removed: ['s-bib-1234', '<script>', 's-bib-1234'] });
  assert.equal((await S.load(key, area))[0].reviewed, true);
  assert.deepEqual((await S.load(key, area, { state: true })).removed, ['s-bib-1234']);
  await S.save(key, [], area, { removed: ['s-bib-1234'] });
  assert.deepEqual(await S.load(key, area), []); assert.deepEqual((await S.loadState(key, area)).removed, ['s-bib-1234']);
});
test('a quoted title after a wrapped author remains part of its entry, and long unknown entries stay distinct', () => {
  const entries = B.entries('Works Cited\nRivera, Alex.\n“Garden Learning.” Garden Journal, 2024.\nSmith, J. R. Another Book. Example Press, 2022.');
  assert.equal(entries.length, 2); assert.equal(B.parse(entries[0]).title, 'Garden Learning');
  const prefix = 'Unknown archival notation '.repeat(30), a = B.parse(prefix + 'first ending'), b = B.parse(prefix + 'second ending');
  assert.equal(a.title, b.title); assert.equal(S.dedupe([a, b]).length, 2);
});
test('et al. bibliography entries retain their incomplete authorship verbatim in every style', () => {
  const citations = [
    'Keles, Betul, et al. “Social Media and Wellbeing.” Journal of Student Research, vol. 4, 2024, pp. 1–12. https://doi.org/10.1234/keles.',
    'Keles, B., et al. (2024). Social media and wellbeing. Journal of Student Research, 4, 1–12.',
    'Keles, Betul, et al. Social Media and Wellbeing. Example Press, 2024.',
  ];
  for (const text of citations) {
    const [entry] = B.entries(`Works Cited\n${text}`), source = B.parse(entry);
    assert.equal(source.unparsed, true); assert.equal(source.original, text); assert.equal(source.author, undefined);
    assert.equal(B.incompleteAuthors(entry), true);
    for (const style of ['mla9', 'apa7', 'chicago17']) {
      const rows = C.list(S.dedupe([source]), style).entries;
      assert.equal(rows.length, 1); assert.equal(rows[0].html, text); assert.match(rows[0].html, /et al\./);
    }
  }
  assert.equal(B.incompleteAuthors('Rivera, Alex. The Use of et al. in Academic Writing. Example Press, 2024.'), false);
  assert.equal(B.incompleteAuthors('Rivera, Alex. “The Use of et al.” Garden Studies, 2024.'), false);
});
