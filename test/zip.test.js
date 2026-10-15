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

test('Canvas downloads use unique accessible File ids and same-origin metadata URLs', () => {
  assert.deepEqual(Z.canvasFiles([{type:'Page',content_id:1},{type:'File',content_id:'2'},{type:'File',content_id:2},{type:'File',content_id:'3',content_details:{locked_for_user:true}},{type:'File',content_id:'../4'}]), ['2']);
  for (const file of [null, {}, {url:'https://cdn.example/file'}, {url:'//cdn.example/file'}, {url:'javascript:alert(1)'}, {url:'http://user:password@localhost:3000/file'}, {url:'/files/2/download',locked_for_user:true}]) assert.equal(Z.canvasURL(file,'http://localhost:3000'),null);
  assert.equal(Z.canvasURL({url:'/files/2/download?download_frd=1'},'http://localhost:3000'),'http://localhost:3000/files/2/download?download_frd=1');
});
