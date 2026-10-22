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

// Regression tests from the S4 review. Each failed (or ran far over budget) on the first version of lib/doctext.js.
const u32 = (buf, at, v) => new DataView(buf.buffer, buf.byteOffset).setUint32(at, v, true);
const u16 = (buf, at, v) => new DataView(buf.buffer, buf.byteOffset).setUint16(at, v, true);
const central = (buf) => Buffer.from(buf).indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
const eocd = (buf) => Buffer.from(buf).lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));

test('review: stored entries obey the per-entry cap, and a whole document has a budget', async () => {
  const kib = 'x'.repeat(2048);
  await assert.rejects(D.unzip(zipOf({ 'a.xml': kib }, ['a.xml']), { limits: { entry: 1024 } }).text('a.xml'), /too large/);
  await assert.rejects(D.unzip(zipOf({ 'a.xml': kib }), { limits: { entry: 1024 } }).text('a.xml'), /too large/);
  const z = D.unzip(zipOf({ 'a.xml': kib, 'b.xml': kib, 'c.xml': kib }), { limits: { total: 5000 } });
  assert.equal((await z.text('a.xml')).length, 2048);
  assert.equal((await z.text('a.xml')).length, 2048, 'a part read twice counts once');
  await z.text('b.xml');
  await assert.rejects(z.text('c.xml'), /document too large/);
  assert.throws(() => D.unzip(zipOf({ 'a.xml': 'a' }), { limits: { input: 10 } }), /too large/);
  // A slide listed three times is read once.
  const deck = zipOf({
    'ppt/presentation.xml': '<p:presentation xmlns:p="p" xmlns:r="r"><p:sldIdLst><p:sldId id="1" r:id="rId2"/><p:sldId id="2" r:id="rId2"/><p:sldId id="3" r:id="rId2"/></p:sldIdLst></p:presentation>',
    'ppt/_rels/presentation.xml.rels': rels(rel('rId2', 'slides/slide1.xml', 'slide')),
    'ppt/slides/slide1.xml': slide(sp('title', r('Hello'))),
  });
  assert.deepEqual(await D.pptx(deck), [{ text: 'Hello', notes: '' }]);
});

test('review: reads running at the same time share one document budget, and a failed read gives its share back', async () => {
  const kib = 'y'.repeat(2048);
  const z = D.unzip(zipOf({ 'a.xml': kib, 'b.xml': kib }), { limits: { total: 3000 } });
  const both = await Promise.allSettled([z.text('a.xml'), z.text('b.xml')]);
  assert.deepEqual(both.map((x) => x.status).sort(), ['fulfilled', 'rejected']);
  assert.match(both.find((x) => x.status === 'rejected').reason.message, /document too large/);
  const broken = zipOf({ 'a.xml': kib, 'b.xml': kib });
  u32(broken, central(broken) + 16, 1); // a's CRC is wrong
  const zb = D.unzip(broken, { limits: { total: 3000 } });
  await assert.rejects(zb.text('a.xml'), /damaged/);
  assert.equal((await zb.text('b.xml')).length, 2048);
});

test('review: a raw-text element ends only at its own end tag, and case-folding never shifts positions', () => {
  assert.equal(D.html('<script>hidden</scripture><p>not visible</p></script><p>shown</p>'), 'shown');
  assert.equal(D.html('<style>a{}</STYLE ><p>shown</p>'), 'shown');
  assert.equal(D.html('<script>x</script/><p>shown</p>'), 'shown');
  assert.equal(D.html('<p>İ</p><script>hidden</script><p>shown</p>'), 'İ\nshown');
  assert.equal(D.html('İ<script>hidden</script><p>shown</p>'), 'İ\nshown');
  assert.equal(D.html('<script>never closed</scrip'), '');
});

// An archive with a comment after the end record (the comment length field is updated to match).
const withComment = (z, comment) => {
  const out = Buffer.concat([Buffer.from(z), comment]);
  u16(out, eocd(z) + 20, comment.length);
  return new Uint8Array(out);
};
// One entry written with a data descriptor (flag bit 3), as streaming zip writers do.
const descriptorZip = (name, text, crcInDescriptor) => {
  const raw = Buffer.from(text), n = Buffer.from(name), data = zlib.deflateRawSync(raw), crc = zlib.crc32(raw);
  const h = (...f) => { const b = Buffer.alloc(f.reduce((s, [, w]) => s + w, 0)); let o = 0; for (const [x, w] of f) { w === 2 ? b.writeUInt16LE(x, o) : b.writeUInt32LE(x >>> 0, o); o += w; } return b; };
  const local = h([0x04034b50, 4], [20, 2], [0x808, 2], [8, 2], [0, 2], [0x21, 2], [0, 4], [0, 4], [0, 4], [n.length, 2], [0, 2]);
  const desc = h([0x08074b50, 4], [crcInDescriptor ?? crc, 4], [data.length, 4], [raw.length, 4]);
  const cd = Buffer.concat([h([0x02014b50, 4], [20, 2], [20, 2], [0x808, 2], [8, 2], [0, 2], [0x21, 2], [crc, 4], [data.length, 4], [raw.length, 4], [n.length, 2], [0, 2], [0, 2], [0, 2], [0, 2], [0, 4], [0, 4]), n]);
  const body = Buffer.concat([local, n, data, desc]);
  return new Uint8Array(Buffer.concat([body, cd, h([0x06054b50, 4], [0, 2], [0, 2], [1, 2], [1, 2], [cd.length, 4], [body.length, 4], [0, 2])]));
};

test('review: the end record is found past an archive comment, even one holding a fake end record', async () => {
  const z = zipOf({ 'a.xml': '<x>hello</x>' });
  const plain = D.unzip(withComment(z, Buffer.from('made by a test')));
  assert.equal(await plain.text('a.xml'), '<x>hello</x>');
  const fake = Buffer.alloc(22);
  fake.writeUInt32LE(0x06054b50, 0); // an end record for an empty archive, inside the comment
  const tricky = D.unzip(withComment(z, Buffer.concat([Buffer.from('note: '), fake])));
  assert.deepEqual(tricky.names, ['a.xml']);
  assert.equal(await tricky.text('a.xml'), '<x>hello</x>');
});

test('review: a look-alike zip64 end record inside a comment is skipped; a real zip64 one is refused', async () => {
  const z = zipOf({ 'a.xml': '<x>hello</x>' });
  const fake = Buffer.alloc(22);
  fake.writeUInt32LE(0x06054b50, 0);
  fake.writeUInt16LE(0xffff, 8); // zip64 markers: entry counts…
  fake.writeUInt16LE(0xffff, 10);
  fake.writeUInt32LE(0xffffffff, 12); // …directory size and offset
  fake.writeUInt32LE(0xffffffff, 16);
  const ok = D.unzip(withComment(z, Buffer.concat([Buffer.from('note: '), fake])));
  assert.deepEqual(ok.names, ['a.xml']);
  assert.equal(await ok.text('a.xml'), '<x>hello</x>');
  // A real zip64 archive: the end record carries the markers and the zip64 locator sits right before it.
  const at = eocd(z);
  const locator = Buffer.alloc(20);
  locator.writeUInt32LE(0x07064b50, 0);
  const real = Buffer.concat([Buffer.from(z.subarray(0, at)), locator, fake]);
  assert.throws(() => D.unzip(new Uint8Array(real)), /zip64/);
});

test('review: local headers, descriptors and member positions must agree with the central directory', async () => {
  const bad = async (mutate) => { const z = zipOf({ 'a.xml': '<x>hello</x>' }); mutate(z); await assert.rejects((async () => D.unzip(z).text('a.xml'))(), /damaged|multi-disk/); };
  await bad((z) => { z[30] = 'b'.charCodeAt(0); }); // local name differs
  await bad((z) => u16(z, 6, 0x0808)); // local says it has a data descriptor
  await bad((z) => u32(z, 14, 1)); // local CRC differs
  await bad((z) => u32(z, 18, 1)); // local compressed size differs
  await bad((z) => u32(z, 22, 1)); // local size differs
  await bad((z) => u16(z, central(z) + 34, 1)); // central entry starts on another disk
  // A member placed after the end record (inside the comment) is outside the archive's members.
  const z = zipOf({ 'a.xml': '<x>hello</x>' });
  const member = Buffer.from(z.subarray(0, central(z)));
  const moved = withComment(z, member);
  u32(moved, central(moved) + 42, z.length);
  await assert.rejects(D.unzip(moved).text('a.xml'), /damaged/);
  // Data descriptors: accepted when they agree, refused when their CRC doesn't.
  assert.equal(await D.unzip(descriptorZip('a.xml', '<x>streamed</x>')).text('a.xml'), '<x>streamed</x>');
  await assert.rejects(D.unzip(descriptorZip('a.xml', '<x>streamed</x>', 7)).text('a.xml'), /damaged/);
});

test('review: an XML declaration longer than 200 bytes still sets the encoding', async () => {
  const xml = (decl) => Buffer.from(W(p(t('Café'))).replace(/^<\?xml[^>]*\?>/, decl), 'latin1');
  assert.equal(await D.docx(zipOf({ 'word/document.xml': xml(`<?xml version="1.0"${' '.repeat(210)}encoding="windows-1252"?>`) })), 'Café');
  await assert.rejects(D.docx(zipOf({ 'word/document.xml': `<?xml version="1.0"${' '.repeat(5000)}` })), /XML declaration/);
});

test('review: malformed markup costs linear time', () => {
  for (const unit of ['<a ', '<script ', '<p title="', '<!--', '<![CDATA[', '<b>x<i y=\'']) {
    const src = unit.repeat(Math.ceil((300 << 10) / unit.length));
    const t0 = performance.now();
    D.html(src);
    const ms = performance.now() - t0;
    assert.ok(ms < 1500, `${JSON.stringify(unit)} × ${src.length} chars took ${ms.toFixed(0)} ms`);
  }
  assert.equal(D.html('a < b and <a href="x">link</a> <unfinished'), 'a < b and link <unfinished');
  assert.throws(() => D.html('x'.repeat(100), { limits: { text: 50 } }), /too large/);
});

// Reading the end of a string that has just been appended to flattens it, so a scanner that looked back at its own output
// after every token took quadratic time: 3 s for a 16,000-paragraph Word file and 11 s for 1.6 MB of pretty-printed HTML.
test('import: a 16,000-paragraph Word file and 1.6 MB of pretty-printed HTML extract in well under a second', async () => {
  const para = (i) => `<w:p><w:r><w:t xml:space="preserve">Week ${i}: reading chapter ${i % 30} and the lecture notes for this topic </w:t></w:r></w:p>`;
  const xml = `<?xml version="1.0"?><w:document xmlns:w="x"><w:body>${Array.from({ length: 16000 }, (_, i) => para(i)).join('')}</w:body></w:document>`;
  const bytes = zipOf({ 'word/document.xml': xml });
  let t0 = performance.now();
  const out = await D.docx(bytes);
  const docxMs = performance.now() - t0;
  assert.equal(out.split('\n').length, 16000);
  assert.ok(out.startsWith('Week 0: reading chapter 0 and the lecture notes for this topic\nWeek 1:') && out.endsWith('Week 15999: reading chapter 9 and the lecture notes for this topic'));
  assert.ok(docxMs < 1000, `docx took ${docxMs.toFixed(0)} ms`);

  const n = 20000;
  const page = '<html><body><table>\n' + Array.from({ length: n }, (_, i) => `  <tr>\n    <td>BIO ${i} </td>\n    <td>Mon 9:00 </td>\n  </tr>\n`).join('') + '</table>' + Array.from({ length: n }, (_, i) => `<p>Line ${i} </p>\n`).join('') + '</body></html>';
  assert.ok(page.length > 1.5e6);
  t0 = performance.now();
  const text = D.html(page);
  const htmlMs = performance.now() - t0;
  const lines = text.split('\n');
  assert.deepEqual([lines[0], lines[n - 1], lines[n], lines.at(-1), lines.length], ['BIO 0\tMon 9:00', `BIO ${n - 1}\tMon 9:00`, 'Line 0', `Line ${n - 1}`, 2 * n]);
  assert.ok(htmlMs < 1000, `html took ${htmlMs.toFixed(0)} ms`);
});

test('review: relationship and slide attributes in either quote style, with spaces around "="', async () => {
  const deck = zipOf({
    'ppt/presentation.xml': "<p:presentation xmlns:p='p' xmlns:r='r'><p:sldIdLst><p:sldId id='256' r:id = 'rId7'/><p:sldId id='257' r:id='rId9'/></p:sldIdLst></p:presentation>",
    'ppt/_rels/presentation.xml.rels': "<Relationships><Relationship Id = 'rId7' Type='http://x/slide' Target='slides/slide3.xml'/><Relationship Id='rId9' Type='http://x/slide' Target='slides/gone.xml'/></Relationships>",
    'ppt/slides/slide3.xml': slide(sp('title', r('Hello'))),
    'ppt/slides/_rels/slide3.xml.rels': "<Relationships><Relationship Id='n' Type='http://x/notesSlide' Target='../notesSlides/n1.xml'/></Relationships>",
    'ppt/notesSlides/n1.xml': slide("<p:sp><p:nvSpPr><p:nvPr><p:ph type='body'/></p:nvPr></p:nvSpPr><p:txBody><a:p>" + r('Say hi') + '</a:p></p:txBody></p:sp>'),
  });
  assert.deepEqual(await D.pptx(deck), [{ text: 'Hello', notes: 'Say hi' }, { text: '', notes: '', missing: true }]);
});

test('review: XML parts in UTF-16 or a declared legacy encoding decode', async () => {
  const xml = W(p(t('Café · Grading scale')));
  const le = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(xml.replace('UTF-8', 'UTF-16'), 'utf16le')]);
  const beBytes = Buffer.from(xml.replace('UTF-8', 'UTF-16'), 'utf16le').swap16();
  assert.equal(await D.docx(zipOf({ 'word/document.xml': le })), 'Café · Grading scale');
  assert.equal(await D.docx(zipOf({ 'word/document.xml': Buffer.concat([Buffer.from([0xfe, 0xff]), beBytes]) })), 'Café · Grading scale');
  assert.equal(await D.docx(zipOf({ 'word/document.xml': Buffer.from(xml.replace('UTF-8', 'UTF-16'), 'utf16le') })), 'Café · Grading scale', 'no BOM');
  assert.equal(await D.docx(zipOf({ 'word/document.xml': Buffer.from(xml.replace('UTF-8', 'windows-1252'), 'latin1') })), 'Café · Grading scale');
  await assert.rejects(D.docx(zipOf({ 'word/document.xml': xml.replace('UTF-8', 'x-no-such-encoding') })), /unsupported XML encoding/);
});

test('review: a zip whose CRC, local header or sizes disagree is refused as damaged', async () => {
  const good = () => zipOf({ 'a.xml': '<x>hello</x>' });
  const bad = async (mutate, re = /damaged/) => { const z = good(); mutate(z); await assert.rejects((async () => D.unzip(z).text('a.xml'))(), re); };
  await bad((z) => u32(z, central(z) + 16, 12345)); // central CRC
  await bad((z) => u32(z, 0, 0x01020304)); // local signature
  await bad((z) => u16(z, 8, 0)); // local method says stored
  await bad((z) => u32(z, central(z) + 24, 5)); // uncompressed size too small for the stream
  await bad((z) => u32(z, central(z) + 24, 50)); // uncompressed size larger than the stream
  await bad((z) => u32(z, central(z) + 20, 1 << 30)); // compressed size past the end of the file
  const z64 = good();
  u32(z64, central(z64) + 24, 0xffffffff);
  assert.throws(() => D.unzip(z64), /zip64/);
  const disk = good();
  u16(disk, eocd(disk) + 4, 1);
  assert.throws(() => D.unzip(disk), /multi-disk/);
});
