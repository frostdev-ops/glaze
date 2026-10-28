// Page setup on a paper Writer made (lib/writer-styles.js setup with own: true): the page sizes, orientation, margins and
// header and footer distances; the format's running header ("Surname N") kept until the student edits it, then the
// edited parts with PAGE / NUMPAGES fields; a different first page; the margins check quiet while the student's own setup
// is there (an imported file's setup still asks); and the .docx made from it.
const test = require('node:test');
const assert = require('node:assert/strict');
const ST = require('../lib/writer-styles.js');
const F = require('../lib/writer-format.js');
const S = require('../lib/writer-schema.js');
const X = require('../lib/writer-docx.js');

const mla = ST.FORMATS.mla9, chicago = ST.FORMATS.chicago17;

test('page sizes and a setup made from the format', () => {
  assert.deepEqual(ST.PAGES, { letter: [8.5, 11], a4: [8.27, 11.69], legal: [8.5, 14] });
  const s = ST.pageSetup(mla);
  assert.deepEqual([s.page, s.margins, s.header, s.footer, s.title, s.own, s.headers.default, s.footers.default], [[8.5, 11], [1, 1, 1, 1], 0.5, 0.5, false, true, null, null]);
  assert.equal(ST.pageSetup(chicago).title, true, 'Chicago\'s page 1 has no number: a different first page');
  const land = ST.pageSetup(mla, { page: [11, 8.5], margins: [0.75, 1, 0.75, 1] });
  assert.deepEqual(ST.setup(land).page, [11, 8.5]);
  assert.equal(ST.setup({ ...land, own: 'yes' }).own, false, 'own is a boolean from storage');
});

test('the format\'s header stays until edited; then the parts, with fields, and a first-page variant', () => {
  const s = ST.pageSetup(mla, { margins: [1, 1.25, 1, 1.25] }), L = ST.look(mla, s);
  assert.equal(ST.headerParts(L, 2, 5), null, 'no parts of its own: the format\'s "Surname N"');
  assert.equal(ST.headerText(L, 2, 'Rivera'), 'Rivera 2');
  assert.equal(ST.geometry(L).left, 120);
  const titled = ST.look(mla, { ...s, title: true });
  assert.equal(ST.headerText(titled, 1, 'Rivera'), '', 'a different first page: page 1 has none');
  assert.equal(ST.headerText(titled, 2, 'Rivera'), 'Rivera 2');
  assert.deepEqual(ST.formatHeader(mla, 'Rivera'), [{ align: 'right', line: 1, after: 0, runs: [{ text: 'Rivera ' }, { field: 'PAGE' }] }]);
  assert.deepEqual(ST.formatHeader(ST.FORMATS.apa7, ''), [{ align: 'right', line: 1, after: 0, runs: [{ field: 'PAGE' }] }]);
  const edited = { ...s, headers: { default: [{ align: 'center', runs: [{ text: 'Draft ' }, { field: 'PAGE' }, { text: ' of ' }, { field: 'NUMPAGES' }] }], first: null } };
  const L2 = ST.look(mla, edited);
  assert.deepEqual(ST.headerParts(L2, 2, 5)[0].runs.map((r) => r.text), ['Draft ', '2', ' of ', '5']);
  const first = ST.look(mla, { ...edited, title: true, headers: { ...edited.headers, first: [{ runs: [{ text: 'Cover' }] }] } });
  assert.deepEqual(ST.headerParts(first, 1, 5)[0].runs.map((r) => r.text), ['Cover']);
  assert.deepEqual(ST.headerParts(first, 2, 5)[0].runs.map((r) => r.text), ['Draft ', '2', ' of ', '5']);
});

test('the margins check is quiet while the student\'s own setup is there; an imported setup still asks', () => {
  const doc = (setup) => S.paper.nodeFromJSON({ type: 'doc', attrs: { setup }, content: F.template(mla, { name: 'Alex Rivera', instructor: 'Prof', course: 'ENG', date: '1 October 2026', title: 'T' }).content });
  const narrow = { margins: [0.5, 0.5, 0.5, 0.5] };
  const own = F.check(doc(ST.pageSetup(mla, narrow)), mla, {}, {}).issues.map((i) => i.rule);
  assert.ok(!own.includes('margins'), 'own setup: quiet');
  const imported = { ...ST.pageSetup(mla, narrow), own: false };
  assert.ok(F.check(doc(imported), mla, {}, {}).issues.some((i) => i.rule === 'margins'), 'imported: asks');
});

test('the .docx of a paper with the student\'s setup: its page, the format\'s header until edited, then its own', () => {
  const content = F.template(mla, { name: 'Alex Rivera', instructor: 'Prof', course: 'ENG', date: '1 October 2026', title: 'T' }).content;
  const date = new Date('2026-10-28T12:00:00Z');
  const s = ST.pageSetup(mla, { page: [8.27, 11.69], margins: [1, 1.25, 1, 1.25], header: 0.4, footer: 0.6 });
  let o = X.exportDocx({ type: 'doc', attrs: { setup: s }, content }, { format: 'mla9', surname: 'Rivera', date });
  const sect = o.parts['word/document.xml'].match(/<w:sectPr>.*<\/w:sectPr>/)[0];
  assert.match(sect, /<w:pgSz w:w="11909" w:h="16834"\/>/);
  assert.match(sect, /w:left="1800"/);
  assert.match(sect, /w:header="576" w:footer="864"/);
  assert.match(o.parts['word/header1.xml'], /Rivera <\/w:t>.*PAGE/, 'the format\'s "Rivera N"');
  assert.doesNotMatch(sect, /titlePg/);
  o = X.exportDocx({ type: 'doc', attrs: { setup: { ...s, title: true } }, content }, { format: 'mla9', surname: 'Rivera', date });
  assert.match(o.parts['word/document.xml'], /<w:titlePg\/>/);
  assert.match(o.parts['word/document.xml'], /w:type="first"/, 'an empty first-page header');
  const edited = { ...s, headers: { default: [{ align: 'right', runs: [{ text: 'Page ' }, { field: 'PAGE' }, { text: ' of ' }, { field: 'NUMPAGES' }] }], first: null }, footers: { default: [{ align: 'center', runs: [{ text: 'Draft' }] }], first: null } };
  o = X.exportDocx({ type: 'doc', attrs: { setup: edited }, content }, { format: 'mla9', surname: 'Rivera', date });
  assert.match(o.parts['word/header1.xml'], /Page <\/w:t>.*PAGE.*NUMPAGES/);
  assert.doesNotMatch(o.parts['word/header1.xml'], /Rivera/);
  assert.match(Object.entries(o.parts).find(([k]) => /footer\d\.xml$/.test(k))[1], /Draft/);
});
