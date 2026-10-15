const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const D = require('../lib/doctext.js');

// A zip whose entries are deflated (method 8), as Word and PowerPoint write them; `stored` names stay method 0.
const zipOf = (files, stored = []) => {
  const parts = [], central = [];
  let offset = 0;
  const le = (...f) => { const b = Buffer.alloc(f.reduce((n, [, w]) => n + w, 0)); let o = 0; for (const [v, w] of f) { w === 2 ? b.writeUInt16LE(v, o) : b.writeUInt32LE(v >>> 0, o); o += w; } return b; };
  for (const [name, text] of Object.entries(files)) {
    const raw = Buffer.from(text), n = Buffer.from(name);
    const method = stored.includes(name) ? 0 : 8;
    const data = method ? zlib.deflateRawSync(raw) : raw;
    const meta = [[20, 2], [0x800, 2], [method, 2], [0, 2], [0x21, 2], [zlib.crc32(raw), 4], [data.length, 4], [raw.length, 4], [n.length, 2]];
    parts.push(le([0x04034b50, 4], ...meta, [4, 2]), n, Buffer.from('XXXX'), data); // a local extra field the central one lacks
    central.push(le([0x02014b50, 4], [20, 2], ...meta, [0, 2], [0, 2], [0, 2], [0, 2], [0, 4], [offset, 4]), n);
    offset += 30 + n.length + 4 + data.length;
  }
  const cd = Buffer.concat(central);
  return new Uint8Array(Buffer.concat([...parts, cd, le([0x06054b50, 4], [0, 2], [0, 2], [central.length / 2, 2], [central.length / 2, 2], [cd.length, 4], [offset, 4], [0, 2])]));
};

test('unzip: deflated and stored entries, UTF-8 names, local extra fields', async () => {
  const z = D.unzip(zipOf({ 'a/ü.xml': '<x>héllo</x>', 'b.txt': 'plain' }, ['b.txt']));
  assert.deepEqual(z.names, ['a/ü.xml', 'b.txt']);
  assert.equal(await z.text('a/ü.xml'), '<x>héllo</x>');
  assert.equal(await z.text('b.txt'), 'plain');
  assert.equal(await z.text('missing'), null);
  assert.throws(() => D.unzip(new TextEncoder().encode('%PDF-1.7 not a zip')), /not a zip/);
});

test('unzip stops inflating past 64 MB', async () => {
  const z = D.unzip(zipOf({ 'bomb.xml': '\0'.repeat(65 << 20) }));
  await assert.rejects(z.text('bomb.xml'), /too large/);
});

const W = (body) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`;
const p = (...runs) => `<w:p><w:pPr><w:tabs><w:tab w:val="left" w:pos="720"/></w:tabs></w:pPr>${runs.map((r) => `<w:r><w:rPr><w:b/></w:rPr>${r}</w:r>`).join('')}</w:p>`;
const t = (s) => `<w:t xml:space="preserve">${s}</w:t>`;
const cell = (...paras) => `<w:tc><w:tcPr><w:tcW w:w="2000"/></w:tcPr>${paras.join('')}</w:tc>`;

test('docx: runs, tabs, breaks, tables row by row, tracked deletions and field codes left out', async () => {
  const doc = W([
    p(t('Instructor:'), '<w:tab/>', t('Dr. Maria '), t('Okafor')),
    p(t('Office hours: Tue'), '<w:br/>', t('2:00&#8211;3:30 PM &amp; by appointment')),
    p(t('Grade '), '<w:delText>deleted words</w:delText>', t('scale'), '<w:instrText> PAGE </w:instrText>'),
    `<w:tbl><w:tblPr/><w:tr>${cell(p(t('Letter')))}${cell(p(t('Range')))}</w:tr>`,
    `<w:tr>${cell(p(t('A')))}${cell(p(t('93')), p(t('to 100')))}</w:tr></w:tbl>`,
    `<w:p><w:r><mc:AlternateContent><mc:Choice Requires="wps"><w:txbxContent>${p(t('Text box'))}</w:txbxContent></mc:Choice><mc:Fallback><w:pict><w:txbxContent>${p(t('Text box'))}</w:txbxContent></w:pict></mc:Fallback></mc:AlternateContent></w:r></w:p>`,
    '<w:p/><w:sectPr/>',
  ].join(''));
  const header = `<w:hdr xmlns:w="x">${p(t('BIO 1100 · Fall 2026'))}</w:hdr>`;
  const text = await D.docx(zipOf({ '[Content_Types].xml': '<Types/>', 'word/document.xml': doc, 'word/header1.xml': header, 'word/header2.xml': header }));
  assert.equal(text, [
    'BIO 1100 · Fall 2026', '',
    'Instructor:\tDr. Maria Okafor',
    'Office hours: Tue',
    '2:00–3:30 PM & by appointment',
    'Grade scale',
    'Letter\tRange',
    'A\t93 to 100',
    'Text box',
  ].join('\n'));
  await assert.rejects(D.docx(zipOf({ 'ppt/presentation.xml': '<p/>' })), /not a Word document/);
});

const slide = (body) => `<p:sld xmlns:a="a" xmlns:p="p"><p:cSld><p:spTree>${body}</p:spTree></p:cSld></p:sld>`;
const sp = (type, ...paras) => `<p:sp><p:nvSpPr><p:nvPr><p:ph type="${type}"/></p:nvPr></p:nvSpPr><p:txBody><a:bodyPr/>${paras.map((x) => `<a:p>${x}</a:p>`).join('')}</p:txBody></p:sp>`;
const r = (s) => `<a:r><a:rPr lang="en-US"/><a:t>${s}</a:t></a:r>`;
const rel = (id, target, type) => `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${target}"/>`;
const rels = (...x) => `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${x.join('')}</Relationships>`;

test('pptx: slides in presentation order (not file order), tables, breaks, notes without placeholders', async () => {
  const file = zipOf({
    'ppt/presentation.xml': '<p:presentation xmlns:p="p" xmlns:r="r"><p:sldMasterIdLst><p:sldMasterId id="1" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst><p:sldId id="256" r:id="rId3"/><p:sldId id="257" r:id="rId2"/></p:sldIdLst></p:presentation>',
    'ppt/_rels/presentation.xml.rels': rels(rel('rId1', 'slideMasters/slideMaster1.xml', 'slideMaster'), rel('rId2', 'slides/slide1.xml', 'slide'), rel('rId3', '/ppt/slides/slide2.xml', 'slide')),
    'ppt/slides/slide1.xml': slide(sp('title', r('Replication fork')) + sp('body', r('Helicase unwinds'), r('Primase') + '<a:br/>' + r('lays primers'))
      + '<p:graphicFrame><a:graphic><a:graphicData><a:tbl><a:tr><a:tc><a:txBody><a:p>' + r('Enzyme') + '</a:p></a:txBody></a:tc><a:tc><a:txBody><a:p>' + r('Job') + '</a:p></a:txBody></a:tc></a:tr><a:tr><a:tc><a:txBody><a:p>' + r('Ligase') + '</a:p></a:txBody></a:tc><a:tc><a:txBody><a:p>' + r('Seals') + '</a:p><a:p>' + r('nicks') + '</a:p></a:txBody></a:tc></a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame>'
      + sp('sldNum', '<a:fld id="{1}" type="slidenum"><a:t>2</a:t></a:fld>')),
    'ppt/slides/_rels/slide1.xml.rels': rels(rel('rId1', '../slideLayouts/slideLayout2.xml', 'slideLayout'), rel('rId2', '../notesSlides/notesSlide1.xml', 'notesSlide')),
    'ppt/notesSlides/notesSlide1.xml': slide(sp('sldImg') + sp('body', r('Ask about Okazaki fragments.')) + sp('sldNum', r('2'))),
    'ppt/slides/slide2.xml': slide(sp('ctrTitle', r('DNA &amp; replication')) + sp('subTitle', r('BIO 1100 · Lecture 8'))),
  });
  assert.deepEqual(await D.pptx(file), [
    { text: 'DNA & replication\nBIO 1100 · Lecture 8', notes: '' },
    { text: 'Replication fork\nHelicase unwinds\nPrimase\nlays primers\nEnzyme\tJob\nLigase\tSeals nicks', notes: 'Ask about Okazaki fragments.' },
  ]);
});

test('html: blocks on lines, table rows on one line, scripts and navigation dropped, entities decoded', () => {
  const page = `<!doctype html><html><head><title>Syllabus</title><style>td > p { color: red }</style></head>
  <body><nav><a href="/">Home</a> <a href="/courses">Courses</a></nav>
  <script>if (a < b && c > d) document.write("<p>not text</p>")</script>
  <h1>BIO&nbsp;1100 &mdash; Intro</h1><p>Instructor: <b>Dr.&#x20;Okafor</b><br>Office hours: Tue&#8211;Thu
     2&ndash;3:30 PM</p><!-- <p>hidden</p> -->
  <table><tr><th>Letter<th>Range<tr><td>A<td>93<br>to 100<tr><td><p>B</p><td><p>83</p></table>
  <ul><li>Late work &amp; extensions</li><li>Unknown &zeta; entity</ul>
  <pre>Mon  9:00
Wed  9:00</pre><select><option>Fall</option></select><p>Done</p></body></html>`;
  assert.equal(D.html(page), [
    'BIO 1100 — Intro',
    'Instructor: Dr. Okafor',
    'Office hours: Tue–Thu 2–3:30 PM',
    'Letter\tRange',
    'A\t93 to 100',
    'B\t83',
    'Late work & extensions',
    'Unknown &zeta; entity',
    'Mon  9:00',
    'Wed  9:00',
    'Done',
  ].join('\n'));
  // A table used for page layout: lists and headings inside a cell keep their own lines.
  assert.equal(D.html('<table><tr><td><ul><li>Instructor: Ann Lee</li><li>Office: Swords 332</li></ul></td><td><h3>Meeting Times</h3><p>Tue 9-10am</p></td></tr></table>'),
    'Instructor: Ann Lee\nOffice: Swords 332\nMeeting Times\nTue 9-10am');
  assert.equal(D.html('plain text, no tags'), 'plain text, no tags');
  assert.equal(D.decode('&#0; &#xD800; &#128512; &lt;'), '� � 😀 <');
});
