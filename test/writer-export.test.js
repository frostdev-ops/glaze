// lib/writer-export.js: a paper as plain text and as Markdown, on the paper fixtures (test/fixtures/writer-paper-
// fixtures.js) and on small documents for each block and mark.
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../lib/writer-schema.js');
const X = require('../lib/writer-export.js');
const FX = require('./fixtures/writer-paper-fixtures.js');

const BLOCK = { align: null, indent: 0, line: null, first: null };
const node = (json) => S.paper.nodeFromJSON(json);
const doc = (...content) => node({ type: 'doc', content });
const t = (text, ...marks) => ({ type: 'text', text, ...(marks.length ? { marks: marks.map((m) => (typeof m === 'string' ? { type: m } : m)) } : {}) });
const para = (...content) => ({ type: 'paragraph', attrs: BLOCK, content: content.map((c) => (typeof c === 'string' ? t(c) : c)) });
const item = (text, indent = 0) => ({ type: 'list_item', attrs: { ...BLOCK, indent }, content: [t(text)] });

test('MLA fixture as text: heading lines, paragraphs a blank line apart, Works Cited, no empty lines doubled', () => {
  const out = X.text(node(FX.papers.mla9()));
  const lines = out.split('\n');
  assert.deepEqual(lines.slice(0, 9), ['Alex Rivera', '', 'Professor Okafor', '', 'ENGL 2110: American Literature II', '', '26 October 2026', '', 'What the River Keeps: Memory as Inheritance in Beloved']);
  assert.ok(out.includes('(Morrison 35)'));
  assert.ok(out.includes('\n\nWorks Cited\n\nBaldwin, James. The Price of the Ticket: Collected Nonfiction, 1948–1985. St. Martin\'s, 1985.'));
  assert.ok(!/\n{3,}/.test(out));
  assert.ok(out.endsWith('pp. 567–97.\n'));
  // the block quote set off by indentation
  assert.ok(/\n {4}Sethe had walked there in the dark/.test(out));
});

test('Chicago fixture as text: note numbers in the text and the notes after it', () => {
  const out = X.text(node(FX.papers.chicago17()));
  assert.ok(out.includes('[1]'));
  const [body, notes] = out.split('\nNotes\n\n');
  assert.ok(notes, 'a Notes section');
  assert.equal((body.match(/\[\d\]/g) || []).length, 5);
  assert.ok(notes.startsWith('[1] Toni Morrison, Beloved (New York: Knopf, 1987), 35.\n'));
  assert.ok(notes.includes('[5] Baldwin, Price of the Ticket, xx.'));
  assert.ok(!body.startsWith('\n'), 'the title page\'s empty lines are left out');
});

test('MLA fixture as Markdown: emphasis, block quote, Works Cited', () => {
  const out = X.markdown(node(FX.papers.mla9()));
  assert.ok(out.includes('Baldwin, James. *The Price of the Ticket: Collected Nonfiction, 1948–1985*. St. Martin\'s, 1985.'));
  assert.ok(/\n> Sethe had walked there in the dark/.test(out));
  assert.ok(!/\n{3,}/.test(out));
});

test('APA fixture as Markdown: headings by level, bold title', () => {
  const out = X.markdown(node(FX.papers.apa7()));
  assert.ok(out.includes('\n# The Clearing as Ledger\n'));
  assert.ok(out.includes('\n## The River and the Return\n'));
  assert.ok(out.includes('**What the River Keeps: Memory as Inheritance in Beloved**'));
  assert.ok(out.includes('**References**'));
});

test('Chicago fixture as Markdown: footnotes as [^n] with their italics', () => {
  const out = X.markdown(node(FX.papers.chicago17()));
  assert.equal((out.match(/\[\^\d\](?!:)/g) || []).length, 5);
  assert.ok(out.includes('\n[^1]: Toni Morrison, *Beloved* (New York: Knopf, 1987), 35.\n'));
});

test('Markdown marks: nested, across text nodes, spaces kept outside the markers, links, strike, sup', () => {
  const d = doc(para('A ', t('bold ', 'bold'), t('and italic', 'bold', 'italic'), ' word, ', t('a link', { type: 'link', attrs: { href: 'https://example.com/a(b)' } }), ', ', t('gone', 'strike'), ' x', t('2', 'sup'), ' ', t('under', 'underline'), '.'));
  assert.equal(X.markdown(d), 'A **bold *and italic*** word, [a link](<https://example.com/a(b)>), ~~gone~~ x<sup>2</sup> <u>under</u>.\n');
  assert.equal(X.text(d), 'A bold and italic word, a link (https://example.com/a(b)), gone x2 under.\n');
});

test('Markdown escapes what would read as syntax', () => {
  const d = doc(para('# not a heading'), para('1. not a list'), para('- nor this'), para('a *star*, an _under_, a [b] and <tag> and back\\slash'));
  assert.equal(X.markdown(d), '\\# not a heading\n\n1\\. not a list\n\n\\- nor this\n\na \\*star\\*, an \\_under\\_, a \\[b\\] and \\<tag> and back\\\\slash\n');
});

test('lists: bullets and numbers, nested by indent, as the paper numbers them in text', () => {
  const d = doc({ type: 'bullet_list', content: [item('one'), item('two', 1)] }, { type: 'ordered_list', content: [item('first'), item('sub a', 1), item('sub b', 1), item('second')] });
  assert.equal(X.markdown(d), '- one\n    - two\n\n1. first\n    1. sub a\n    2. sub b\n2. second\n');
  assert.equal(X.text(d), '• one\n    • two\n\n1. first\n    a. sub a\n    b. sub b\n2. second\n');
});

test('tables, images, hard breaks and page breaks', () => {
  const cell = (s, type = 'table_cell') => ({ type, content: [para(s)] });
  const table = { type: 'table', content: [{ type: 'table_row', content: [cell('Year', 'table_header'), cell('Event | note', 'table_header')] }, { type: 'table_row', content: [cell('1987'), cell('Beloved')] }] };
  const img = { type: 'image', attrs: { src: 'data:image/png;base64,iVBORw0KGgo=', alt: 'A river', width: null } };
  const d = doc(para('before', { type: 'hard_break' }, 'after'), { type: 'page_break' }, table, para('see ', img, ' here'));
  assert.equal(X.markdown(d), 'before\\\nafter\n\n| Year | Event \\| note |\n| --- | --- |\n| 1987 | Beloved |\n\nsee ![A river][image-1] here\n\n[image-1]: <data:image/png;base64,iVBORw0KGgo=>\n');
  assert.equal(X.text(d), 'before\nafter\n\nYear\tEvent | note\n1987\tBeloved\n\nsee [Image: A river] here\n');
});

test('compose documents export too', () => {
  const d = S.parse(S.compose, '<h3>Reply</h3><p>One <strong>two</strong></p><ul><li>three</li></ul>');
  assert.equal(X.markdown(d), '### Reply\n\nOne **two**\n\n- three\n');
  assert.equal(X.text(d), 'Reply\n\nOne two\n\n• three\n');
  assert.equal(X.text(S.parse(S.compose, '')), '');
});

test('multi-paragraph notes keep their paragraphs in text and Markdown exports', () => {
  const d = doc(para('Body', { type: 'footnote_ref', attrs: { content: '<p>First paragraph.</p><p>Second paragraph.</p>' } }));
  assert.ok(X.text(d).includes('[1] First paragraph.\n\nSecond paragraph.'));
  assert.ok(X.markdown(d).includes('[^1]: First paragraph.\n\n    Second paragraph.'));
});
