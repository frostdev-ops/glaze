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
