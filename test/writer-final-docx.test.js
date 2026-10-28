// lib/writer-docx.js and lib/writer-objects-docx.js against what Word really writes: each part's own relationships,
// wrapped table rows and cells, table styles, captions, section and page breaks, header tables, list markers, symbols,
// alternate content, endnotes, link fields, case-insensitive part names, and the order Word's schema gives pPr and rPr.
// Synthetic OOXML only.
const test = require('node:test');
const assert = require('node:assert/strict');
globalThis.GZ_WRITER_OBJECTS_DOCX = require('../lib/writer-objects-docx.js');
const S = require('../lib/writer-schema.js');
const X = require('../lib/writer-docx.js');
const Z = require('../lib/zip.js');
const { pack, p, r } = require('./fixtures/writer-hostile.js');

const NSW = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const imp = async (bytes, o) => { const got = await X.importDocx(bytes, o); return { ...got, node: S.paper.nodeFromJSON(got.doc) }; };
const nodes = (doc, name) => { const out = []; doc.descendants((n) => { if (n.type.name === name) out.push(n); }); return out; };
const links = (doc) => { const out = []; doc.descendants((n) => { const l = n.isText && n.marks.find((m) => m.type.name === 'link'); if (l) out.push([n.text, l.attrs.href]); }); return out; };
const zipParts = (parts) => Buffer.concat(Z.zip(Object.entries(parts).map(([name, data]) => ({ name, data: typeof data === 'string' ? new TextEncoder().encode(data) : data }))));
const rels = (list) => `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${list.map(([id, type, target, ext]) => `<Relationship Id="${id}" Type="${REL}/${type}" Target="${target}"${ext ? ' TargetMode="External"' : ''}/>`).join('')}</Relationships>`;

// ---- relationships
test('a footnote\'s link resolves against the footnotes part\'s own relationships', async () => {
  const note = 'See <a href="https://journal.example/right-source">the source</a>.';
  const doc = S.parse(S.paper, `<p>Body cites <a href="https://body.example/other">another page</a> here<sup class="gz-footnote" data-footnote="${note.replace(/"/g, '&quot;')}"></sup>.</p>`);
  const back = await imp(X.exportDocx(doc).bytes);
  const content = nodes(back.node, 'footnote_ref')[0].attrs.content;
  assert.match(content, /href="https:\/\/journal\.example\/right-source"/);
  assert.doesNotMatch(content, /body\.example/);
  assert.deepEqual(links(back.node), [['another page', 'https://body.example/other']]);
});

test('relationships are read once per part: many links import in time linear in their number', async () => {
  const file = (n) => pack(`<w:p>${Array.from({ length: n }, (_, i) => `<w:hyperlink r:id="L${i}">${r('x')}</w:hyperlink>`).join('')}</w:p>`,
    { 'word/_rels/document.xml.rels': rels([['rS', 'styles', 'styles.xml'], ...Array.from({ length: n }, (_, i) => [`L${i}`, 'hyperlink', `https://e.test/${i}`, true])]) });
  const time = async (n) => { const bytes = file(n); let best = Infinity; for (let k = 0; k < 3; k++) { const t0 = process.hrtime.bigint(); await X.importDocx(bytes); best = Math.min(best, Number(process.hrtime.bigint() - t0) / 1e6); } return best; };
  const small = await time(500), large = await time(4000);
  const got = await imp(file(4000));
  assert.equal(links(got.node).length, 4000);
  assert.ok(large / small < 14, `8 times the links took ${(large / small).toFixed(1)} times as long (${small.toFixed(0)} ms, ${large.toFixed(0)} ms)`);
});

// ---- the package
const entries = async (bytes) => { const z = require('../lib/doctext.js').unzip(bytes); return Promise.all(z.names.map(async (name) => ({ name, data: await z.bytes(name) }))); };
test('part names match relationship targets without regard to case, as the package format has it', async () => {
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const out = X.exportDocx(S.parse(S.paper, `<p>Hello case<img src="data:image/png;base64,${png}" alt="Dot"></p>`));
  const renamed = (await entries(out.bytes)).map((e) => ({ ...e, name: e.name === 'word/document.xml' ? 'word/Document.xml' : e.name === 'word/media/image1.png' ? 'word/media/IMAGE1.png' : e.name }));
  const got = await imp(Buffer.concat(Z.zip(renamed)));
  assert.equal(got.node.textContent, 'Hello case');
  assert.equal(nodes(got.node, 'image').length, 1);
  assert.deepEqual(got.warnings, []);
});

// ---- links
const marksOf = (doc) => { const out = []; doc.descendants((n) => { if (n.isText) out.push([n.text, n.marks.map((m) => m.type.name).sort().join(',')]); }); return out; };
test('a link\'s Hyperlink character style is the link\'s look, not underline and colour marks of its own', async () => {
  const back = await imp(X.exportDocx(S.parse(S.paper, '<p>Read <a href="https://example.org/a">this page</a> now.</p>')).bytes);
  assert.deepEqual(marksOf(back.node), [['Read ', ''], ['this page', 'link'], [' now.', '']]);
  const styled = `<w:r><w:rPr><w:rStyle w:val="Hyperlink"/></w:rPr><w:t>blue</w:t></w:r>`;
  const plain = await imp(pack(`<w:p>${r('Not a link: ')}${styled}</w:p>`));
  assert.deepEqual(marksOf(plain.node), [['Not a link: ', ''], ['blue', 'color,underline']], 'without a link the style still draws its text');
});

test('tel: links come back from the .docx as the schema accepts them', async () => {
  for (const href of ['tel:+15551234567', 'mailto:a@b.co', 'https://example.com/x']) {
    const back = await imp(X.exportDocx(S.parse(S.paper, `<p><a href="${href}">call</a></p>`)).bytes);
    assert.deepEqual(links(back.node), [['call', href]], href);
  }
  const bad = await imp(pack(`<w:p><w:hyperlink r:id="J">${r('js')}</w:hyperlink></w:p>`, { 'word/_rels/document.xml.rels': rels([['J', 'hyperlink', 'javascript:alert(1)', true]]) }));
  assert.deepEqual(links(bad.node), []);
});

test('a HYPERLINK field\'s result is a link; one to a bookmark is text', async () => {
  const field = (code, result) => `<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> ${code} </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>${result}<w:r><w:fldChar w:fldCharType="end"/></w:r>`;
  const styled = (s) => `<w:r><w:rPr><w:rStyle w:val="Hyperlink"/></w:rPr><w:t xml:space="preserve">${s}</w:t></w:r>`;
  const got = await imp(pack(`<w:p>${r('See ')}${field('HYPERLINK "https://example.org/x" \\o "tip"', styled('linked ') + styled('text'))}${r(' and ')}${field('HYPERLINK \\l "_Toc1"', r('a heading'))}${r('.')}</w:p>`));
  assert.equal(got.node.textContent, 'See linked text and a heading.');
  assert.deepEqual(links(got.node), [['linked text', 'https://example.org/x']]);
  assert.deepEqual(marksOf(got.node).map(([, m]) => m), ['', 'link', '']);
});
