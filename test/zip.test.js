const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const Z = require('../lib/zip.js');

// Reads an archive back the way an unzipper does: end record → central directory → local headers.
const unzip = (buf) => {
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const end = buf.length - 22;
  assert.equal(v.getUint32(end, true), 0x06054b50);
  const count = v.getUint16(end + 10, true);
  let p = v.getUint32(end + 16, true);
  assert.equal(p + v.getUint32(end + 12, true), end, 'central directory ends where the end record starts');
  const out = [];
  for (let i = 0; i < count; i++) {
    assert.equal(v.getUint32(p, true), 0x02014b50);
    assert.equal(v.getUint16(p + 8, true) & 0x800, 0x800, 'UTF-8 flag');
    assert.equal(v.getUint16(p + 10, true), 0, 'stored');
    const crc = v.getUint32(p + 16, true);
    const size = v.getUint32(p + 24, true);
    const nameLen = v.getUint16(p + 28, true);
    const name = new TextDecoder().decode(buf.subarray(p + 46, p + 46 + nameLen));
    const at = v.getUint32(p + 42, true);
    assert.equal(v.getUint32(at, true), 0x04034b50);
    assert.equal(v.getUint32(at + 14, true), crc, 'local and central crc agree');
    const start = at + 30 + v.getUint16(at + 26, true);
    const data = buf.subarray(start, start + size);
    assert.equal(zlib.crc32(data), crc, `crc of ${name}`);
    out.push({ name, data: Buffer.from(data).toString() });
    p += 46 + nameLen;
  }
  return out;
};

test('crc32 matches zlib', () => {
  for (const s of ['', 'a', 'The quick brown fox jumps over the lazy dog', 'ñ €'.repeat(500)]) {
    const b = new TextEncoder().encode(s);
    assert.equal(Z.crc32(b), zlib.crc32(b), JSON.stringify(s.slice(0, 20)));
  }
});

test('a stored archive unpacks to what went in, UTF-8 names and folders included', () => {
  const enc = new TextEncoder();
  const files = [
    { name: 'Syllabus.pdf', data: enc.encode('%PDF-1.7 fake') },
    { name: 'Módulo 1/Gramática ñ.pptx', data: enc.encode('slides') },
    { name: 'empty.txt', data: new Uint8Array(0) },
  ];
  const buf = Buffer.concat(Z.zip(files));
  assert.deepEqual(unzip(buf), [
    { name: 'Syllabus.pdf', data: '%PDF-1.7 fake' },
    { name: 'Módulo 1/Gramática ñ.pptx', data: 'slides' },
    { name: 'empty.txt', data: '' },
  ]);
  assert.deepEqual(unzip(Buffer.concat(Z.zip([]))), []);
});

test('DOS dates', () => {
  const buf = Buffer.concat(Z.zip([{ name: 'a', data: new Uint8Array(1), date: new Date(2026, 9, 13, 14, 30, 58) }]));
  assert.equal(buf.readUInt16LE(10), (14 << 11) | (30 << 5) | 29);
  assert.equal(buf.readUInt16LE(12), (46 << 9) | (10 << 5) | 13);
});

test('titles become safe path segments', () => {
  assert.equal(Z.safeName('Module 1: Intro / Week 1?'), 'Module 1_ Intro _ Week 1_');
  assert.equal(Z.safeName('  Notes.  '), 'Notes');
  assert.equal(Z.safeName('a\nb\tc'), 'a_b_c');
  assert.equal(Z.safeName(''), 'Untitled');
  assert.equal(Z.safeName('...'), 'Untitled');
  assert.equal(Z.safeName('x'.repeat(300)).length, 120);
});

test('a long name keeps its extension when it is shortened', () => {
  const long = 'Week 3 Lecture Notes - Introduction to Thermodynamics, Entropy and the Second Law (Annotated, Revised for Fall 2026 Section 002)';
  const n = Z.safeName(`${long}.pdf`);
  assert.ok(n.length <= 120 && n.endsWith('.pdf') && n.startsWith('Week 3 Lecture Notes'), n);
  assert.equal(Z.safeName('a'.repeat(300) + '.docx'), 'a'.repeat(115) + '.docx');
  // The cut can leave a space or dot at the end of the base: Windows drops those, so they go before the extension.
  assert.equal(Z.safeName(`${'a'.repeat(115)} ${'b'.repeat(30)}.pdf`), `${'a'.repeat(115)}.pdf`);
  assert.equal(Z.safeName('b'.repeat(130) + '.' + 'c'.repeat(30)).length, 120, 'something that is not an extension is cut as before');
  assert.equal(Z.safeName('v2.0 final'), 'v2.0 final');
  assert.equal(Z.safeName('Syllabus.pdf'), 'Syllabus.pdf');
});

test('names Windows reserves are made safe, whatever their case or extension', () => {
  for (const n of ['CON', 'con', 'PRN.pdf', 'aux.txt', 'NUL', 'Nul.tar.gz', 'COM1', 'com9.log', 'LPT1', 'lpt9.txt', 'CON.', 'NUL  ', 'COM\u00b9.txt']) {
    const safe = Z.safeName(n);
    assert.ok(safe !== n.trim() && /^_/.test(safe) && !/^(con|prn|aux|nul|com[1-9\u00b9\u00b2\u00b3]|lpt[1-9\u00b9\u00b2\u00b3])(\.|$)/i.test(safe), `${JSON.stringify(n)} -> ${safe}`);
  }
  assert.equal(Z.safeName('CON.pdf'), '_CON.pdf');
  assert.equal(Z.safeName('NUL'), '_NUL');
  for (const ok of ['Console.txt', 'COM10', 'COM0.txt', 'LPT', 'Aux notes.pdf', 'contents', 'null.txt', 'nul2']) assert.equal(Z.safeName(ok), ok);
  assert.equal(Z.safeName('Notes. '), 'Notes');
  assert.equal(Z.safeName('Notes.pdf. .'), 'Notes.pdf');
});

test('a name is never cut inside an emoji or other surrogate pair', () => {
  const whole = (s) => !/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(s);
  for (const n of [`${'a'.repeat(119)}\u{1F600}.pdf`, `${'a'.repeat(119)}\u{1F600}`, `${'a'.repeat(110)}${'\u{1F600}'.repeat(20)}`, `${'a'.repeat(118)}\u{1F600}\u{1F600}.docx`]) {
    const safe = Z.safeName(n);
    assert.ok(whole(safe) && safe.length <= 120, JSON.stringify(safe.slice(-6)));
    assert.equal(Buffer.from(safe, 'utf8').toString('utf8'), safe, 'survives UTF-8, as a zip entry name does');
  }
  assert.ok(Z.safeName(`${'a'.repeat(119)}\u{1F600}.pdf`).endsWith('.pdf'));
});

test('duplicate names are numbered, case-insensitively', () => {
  const taken = new Set();
  assert.equal(Z.unique('a.pdf', taken), 'a.pdf');
  assert.equal(Z.unique('A.pdf', taken), 'A (2).pdf');
  assert.equal(Z.unique('a.pdf', taken), 'a (3).pdf');
  assert.equal(Z.unique('Week 1.5/notes', taken), 'Week 1.5/notes');
  assert.equal(Z.unique('Week 1.5/notes', taken), 'Week 1.5/notes (2)');
  assert.equal(Z.unique('b.tar.gz', taken), 'b.tar.gz');
  assert.equal(Z.unique('b.tar.gz', taken), 'b.tar (2).gz');
});

test('device-name prefixes and duplicate suffixes stay within the name limit', () => {
  const safe = Z.safeName('CON.' + 'a'.repeat(200));
  assert.ok(safe.startsWith('_CON.') && safe.length <= 120, safe);
  const taken = new Set();
  const name = Z.safeName('a'.repeat(200) + '.pdf');
  Z.unique(name, taken);
  const duplicate = Z.unique(name, taken);
  assert.ok(duplicate.length <= 120 && duplicate.endsWith(' (2).pdf'), duplicate);
});

test('a file and a directory never get the same archive path in either order', () => {
  let taken = new Set();
  assert.equal(Z.unique('notes', taken), 'notes');
  assert.equal(Z.unique('notes/x.pdf', taken), 'notes (2)/x.pdf');
  assert.equal(Z.unique('notes/y.pdf', taken), 'notes (2)/y.pdf', 'siblings use the same renamed directory');
  taken = new Set();
  assert.equal(Z.unique('Notes/x.pdf', taken), 'Notes/x.pdf');
  assert.equal(Z.unique('notes', taken), 'notes (2)');
});

test('Canvas downloads use unique accessible File ids and API-supplied HTTPS URLs', () => {
  assert.deepEqual(Z.canvasFiles([{type:'Page',content_id:1},{type:'File',content_id:'2'},{type:'File',content_id:2},{type:'File',content_id:'3',content_details:{locked_for_user:true}},{type:'File',content_id:'../4'}]), ['2']);
  for (const file of [null, {}, {url:'http://cdn.example/file'}, {url:'javascript:alert(1)'}, {url:'http://user:password@localhost:3000/file'}, {url:'/files/2/download',locked_for_user:true}]) assert.equal(Z.canvasURL(file,'http://localhost:3000'),null);
  assert.equal(Z.canvasURL({url:'https://cdn.example/file?token=a%2Fb'},'http://localhost:3000'),'https://cdn.example/file?token=a%2Fb');
  assert.equal(Z.canvasURL({url:'/files/2/download?download_frd=1'},'http://localhost:3000'),'http://localhost:3000/files/2/download?download_frd=1');
});

test('Canvas omits unmet views before deduplication while retaining completed and unrelated requirements', () => {
  const items = [
    { type: 'File', content_id: 1 },
    { type: 'File', content_id: 1, completion_requirement: { type: 'must_view', completed: false } },
    { type: 'File', content_id: 2, completion_requirement: { type: 'must_view', completed: true } },
    { type: 'File', content_id: 3, completion_requirement: { type: 'must_mark_done', completed: false } },
    { type: 'File', content_id: 4, completion_requirement: { type: 'must_view' } },
  ];
  assert.deepEqual([...Z.canvasUnopened(items)], ['1', '4']);
  assert.deepEqual(Z.canvasFiles(items), ['2', '3']);
});
