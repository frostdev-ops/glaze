// Mod bundles (lib/modbundle.js): the zip reader's limits, paths and kinds, mod.json's strict check, the hash, id and
// signature contract against fixed vectors, tampering, glazemod1: codes, the author's key and backup file, the install and
// update rules, WebCrypto support, and the worker's 'glaze:mods' broker with its sender checks.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const zlib = require('node:zlib');
const nodeCrypto = require('node:crypto');
const M = require('../lib/modbundle.js');
const { crc32 } = require('../lib/zip.js');

const enc = new TextEncoder();
const u8 = (s) => enc.encode(s);
const b64u = (b) => Buffer.from(b).toString('base64url');

// RFC 8032's first test key, as a JWK. The vectors below were computed apart from lib/modbundle.js: Python's hashlib,
// base64 and json, and the RFC's own reference Ed25519 code (scratch script, 2026-10-17); Python's zipfile and Info-ZIP's
// unzip -t read the packed zip without errors.
const AUTHOR = { kty: 'OKP', crv: 'Ed25519', d: 'nWGxne_9WmC6hEr0kuwsxERJxWl7MmkZcDusAxyuf2A', x: '11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo' };
const MANIFEST = {
  glaze: 1, name: 'GPA Garden', version: '1.2.0', author: { name: 'Kai' },
  permissions: [{ id: 'network:api.weather.gov', why: 'Rains in the garden when it rains outside.' }],
  ui: { tiles: [{ id: 'garden', name: 'Garden', file: 'garden.html', sizes: ['m', 'l'] }], rail: [], nav: null, background: null },
  hooks: 'hooks.js',
  settings: [{ id: 'plant', type: 'choice', label: 'Plant', options: ['Fern', 'Cactus'] }],
};
const PNG = (more = 'leaf') => Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...u8(more)]);
const FILES = () => ({
  'hooks.js': u8("glaze.ready.then(() => glaze.effects.play('burst', {}));\n"),
  'garden.html': u8('<!doctype html><title>Garden</title><canvas id=c></canvas>\n'),
  'img/leaf.png': PNG(),
});
const VECTOR = {
  files: {
    'garden.html': 'rK96Se7iOAq_aIIdn1xjtbKn0Zv7ye9ja2BUlDZc_t0',
    'hooks.js': 'RiL3NSCz21NdJWWnadzXDGm7iaziwHnDQCeVUYjW2ag',
    'img/leaf.png': 'xNixp3qNiU4dmVSmU_wamBxXqe-qqDQTx0fcUqOy-IA',
    'mod.json': '-i7HllzLYS4s5BAnWYu9Abk8jC_eRg6OpmlV9NQ1sFE',
  },
  hash: 'dYFH6tHpeAnq7ndBJkjvkDTbZRJprgI0VORFrpfggDw',
  sig: 'WQt0t_kp9NKskYpea4rfk6wLMtMscNq7nMF_NvqM_l_8l07sqhYecXaQI8g5Wxs8XB5jt-iiIw053hwOmSjOCg',
  id: 'kv7yexa4o2r6a2o6',
  // The zip's own bytes are Glaze's (sorted, stored, 1980-01-01): pinned so packing stays deterministic.
  zip: '36tVkVk6C91y8jsJje_DBl6XU98lYywN0Byj2L63-cE',
};
const sha = (b) => nodeCrypto.createHash('sha256').update(b).digest('base64url');
let packed;
const vector = async () => (packed ||= await M.pack(FILES(), MANIFEST, AUTHOR));
// A files map without its signature, zipped as Glaze does (for edits that keep the zip itself well formed).
const rezip = (files) => M.archive(files);

// ---- the contract's vectors -------------------------------------------------------------------------------------
test('pack: the fixed vector bundle hashes, signs and names itself exactly as computed apart, and its zip is stable', async () => {
  const r = await vector();
  for (const [p, h] of Object.entries(VECTOR.files)) assert.equal(sha(r.files[p]), h, p);
  assert.equal(r.hash, VECTOR.hash);
  assert.equal(new TextDecoder().decode(r.files['mod.sig']), VECTOR.sig);
  assert.equal(r.id, VECTOR.id);
  assert.equal(sha(r.bytes), VECTOR.zip);
  assert.deepEqual([r.signed, r.key, r.version], [true, AUTHOR.x, '1.2.0']);
  assert.deepEqual(Object.keys(r.files).sort(), ['garden.html', 'hooks.js', 'img/leaf.png', 'mod.json', 'mod.sig']);
  // The same input is the same bytes every time.
  assert.deepEqual((await M.pack(FILES(), MANIFEST, AUTHOR)).bytes, r.bytes);
  // mod.json carries the signing key, filled in.
  assert.equal(JSON.parse(Buffer.from(r.files['mod.json'])).author.key, AUTHOR.x);
});

test('ids: base32 of SHA-256(key ‖ slug), the slug as computed apart; a different name or key is a different mod', async () => {
  const key = Buffer.from(AUTHOR.x, 'base64url');
  for (const [name, slug, id] of [['GPA Garden', 'gpa-garden', 'kv7yexa4o2r6a2o6'], ['Jardín ÉTÉ', 'jardín-été', '4eqg7imhujzomguh'], ['日本 Mod', '日本-mod', 'biz7pydgygdz7zdq'], ['  A!! ', 'a', 'pctwpapf6nee75kn']]) {
    assert.equal(M.slug(name), slug);
    assert.equal(await M.modId(key, name), id);
  }
  // Names that slug alike are one mod: spacing and case don't make a new id.
  assert.equal(await M.modId(key, 'gpa  GARDEN'), 'kv7yexa4o2r6a2o6');
  assert.notEqual(await M.modId(Buffer.from((await M.makeKey()).x, 'base64url'), 'GPA Garden'), 'kv7yexa4o2r6a2o6');
  // RFC 4648's own base32 vectors, lowercased, without padding.
  for (const [s, b] of [['', ''], ['f', 'my'], ['fo', 'mzxq'], ['foo', 'mzxw6'], ['foob', 'mzxw6yq'], ['fooba', 'mzxw6ytb'], ['foobar', 'mzxw6ytboi']]) assert.equal(M.base32(u8(s)), b);
});

test('read: a zip from another tool (deflate, folder entries, extra fields) is the same bundle, signature and all', async () => {
  const r = await vector();
  const z = rawZip([{ name: 'img/', data: '' }, ...Object.entries(r.files).map(([name, data]) => ({ name, data, method: 8, extra: 24 }))]);
  const got = await M.read(z);
  assert.deepEqual([got.id, got.hash, got.signed], [VECTOR.id, VECTOR.hash, true]);
  assert.deepEqual(Object.keys(got.files).sort(), Object.keys(r.files).sort());
});

// ---- the zip --------------------------------------------------------------------------------------------------------
// A zip with every field in reach: { name, data, method, body, crc, size, csize, flags, localName, localFlags, localMethod,
// at (the central entry's offset), skip (no local header of its own), extra (bytes of extra field) }.
function rawZip(entries, { comment = '', eocd = {}, prefix = Buffer.alloc(0) } = {}) {
  const le = (...f) => { const b = Buffer.alloc(f.reduce((n, [, w]) => n + w, 0)); let o = 0; for (const [v, w] of f) { if (w === 2) b.writeUInt16LE(v, o); else b.writeUInt32LE(v >>> 0, o); o += w; } return b; };
  const locals = [], central = [];
  let off = prefix.length;
  for (const e of entries) {
    const name = Buffer.from(e.name, 'latin1'), raw = Buffer.from(typeof e.data === 'string' ? u8(e.data) : e.data ?? []);
    const method = e.method ?? 0, body = e.body ?? (method === 8 ? zlib.deflateRawSync(raw) : raw);
    const c = e.crc ?? crc32(raw), cs = e.csize ?? body.length, sz = e.size ?? raw.length, flags = e.flags ?? 0x800;
    const lname = e.localName ? Buffer.from(e.localName, 'latin1') : name, extra = e.extraData || Buffer.alloc(e.extra || 0);
    const at = e.at ?? off;
    if (!e.skip) {
      const local = Buffer.concat([le([0x04034b50, 4], [20, 2], [e.localFlags ?? flags, 2], [e.localMethod ?? method, 2], [0, 2], [0x21, 2], [e.localCrc ?? (flags & 8 ? 0 : c), 4], [e.localCsize ?? (flags & 8 ? 0 : cs), 4], [e.localSize ?? (flags & 8 ? 0 : sz), 4], [lname.length, 2], [extra.length, 2]), lname, extra, body]);
      const descriptor = e.descriptor ?? (flags & 8 ? le(...(e.descriptorSignature === false ? [] : [[0x08074b50, 4]]), [e.descCrc ?? c, 4], [e.descCsize ?? cs, 4], [e.descSize ?? sz, 4]) : Buffer.alloc(0));
      locals.push(local, descriptor);
      off += local.length + descriptor.length;
    }
    central.push(Buffer.concat([le([0x02014b50, 4], [20, 2], [20, 2], [flags, 2], [method, 2], [0, 2], [0x21, 2], [c, 4], [cs, 4], [sz, 4], [name.length, 2], [extra.length, 2], [0, 2], [e.disk ?? 0, 2], [0, 2], [0, 4], [at, 4]), name, extra]));
  }
  const cd = Buffer.concat(central), n = eocd.count ?? entries.length;
  const end = le([0x06054b50, 4], [0, 2], [eocd.disk ?? 0, 2], [n, 2], [eocd.total ?? n, 2], [eocd.cdSize ?? cd.length, 4], [eocd.cdAt ?? off, 4], [comment.length, 2]);
  return new Uint8Array(Buffer.concat([prefix, ...locals, cd, end, Buffer.from(comment, 'latin1')]));
}
const MOD_JSON = JSON.stringify({ glaze: 1, name: 'Tiny', version: '1.0.0', author: { name: 'Kai', key: AUTHOR.x } });
const tiny = (more = []) => [{ name: 'mod.json', data: MOD_JSON }, ...more];
const DAMAGED = /damaged, or isn't a Glaze mod/;
const BIG = /too big/;

test('zip: a well formed unsigned zip reads; the structural refusals each name the zip damaged', async () => {
  assert.equal((await M.read(rawZip(tiny()))).signed, false);
  const cases = {
    'not a zip': u8('hello'),
    'empty': new Uint8Array(0),
    'cut short': rawZip(tiny()).subarray(0, 40),
    'an archive comment': rawZip(tiny(), { comment: 'hi' }),
    'data before the zip': rawZip(tiny(), { prefix: Buffer.from('MZ junk') }),
    'a central directory that does not end at the end record': rawZip(tiny(), { eocd: { cdSize: 10 } }),
    'entry counts that disagree': rawZip(tiny(), { eocd: { total: 2 } }),
    'a central entry the end record doesn\'t count': rawZip(tiny([{ name: 'a.js', data: 'x' }]), { eocd: { count: 1 } }),
    'a multi-disk zip': rawZip(tiny(), { eocd: { disk: 1 } }),
    'encryption': rawZip(tiny([{ name: 'a.js', data: 'x', flags: 0x801 }])),
    'encryption in the local header only': rawZip(tiny([{ name: 'a.js', data: 'x', localFlags: 0x801 }])),
    'strong encryption bit': rawZip(tiny([{ name: 'a.js', data: 'x', flags: 0x840 }])),
    'an unknown method (bzip2)': rawZip(tiny([{ name: 'a.js', data: 'x', method: 12, body: Buffer.from('x') }])),
    'methods that disagree': rawZip(tiny([{ name: 'a.js', data: 'x', localMethod: 8 }])),
    'stored with sizes that disagree': rawZip(tiny([{ name: 'a.js', data: 'xy', size: 1 }])),
    'zip64 sizes': rawZip(tiny([{ name: 'a.js', data: 'x', size: 0xffffffff, csize: 0xffffffff }])),
    'a bad CRC': rawZip(tiny([{ name: 'a.js', data: 'x', crc: 1234 }])),
    'a local name unlike the central one': rawZip(tiny([{ name: 'a.js', localName: 'b.js', data: 'x' }])),
    'a central name the local header lacks (longer)': rawZip(tiny([{ name: 'a.js', localName: 'a.jsx', data: 'x' }])),
    'an entry pointing past the data': rawZip(tiny([{ name: 'a.js', data: 'x', at: 5000, skip: true }])),
    'an entry on another disk': rawZip(tiny([{ name: 'a.js', data: 'x', disk: 1 }])),
    'deflate that is not deflate': rawZip(tiny([{ name: 'a.js', data: 'abc', method: 8, body: Buffer.from([0xff, 0xff, 0xff]) }])),
    'deflate with junk after it': rawZip(tiny([{ name: 'a.js', data: 'abc', method: 8, body: Buffer.concat([zlib.deflateRawSync(Buffer.from('abc')), Buffer.from('junk')]) }])),
    'a folder entry with data': rawZip(tiny([{ name: 'img/', data: 'x' }])),
    'a folder entry with a bad path': rawZip(tiny([{ name: '../', data: '' }])),
  };
  for (const [what, bytes] of Object.entries(cases)) await assert.rejects(M.read(bytes), DAMAGED, what);
  await assert.rejects(M.read('not bytes'), DAMAGED);
});

test('zip bombs: overlapping entries, lying sizes and huge declarations are refused before or while inflating, quickly', async () => {
  // The non-recursive bomb: entries whose data holds the next entries' local headers, so every central entry has a
  // real local header of its own and the same bytes are inflated over and over.
  const first = 30 + 8 + MOD_JSON.length; // a.txt's local header, after mod.json's
  const inner = Buffer.from(rawZip([{ name: 'b.txt', data: 'hello' }])).subarray(0, 30 + 5 + 5); // b.txt's local header and data
  const quoted = rawZip(tiny([{ name: 'a.txt', data: inner }, { name: 'b.txt', data: 'hello', at: first + 30 + 5, skip: true }]));
  await assert.rejects(M.read(quoted), DAMAGED, 'b.txt inside a.txt');
  // Two central entries naming one local entry.
  await assert.rejects(M.read(rawZip(tiny([{ name: 'a.txt', data: 'x' }, { name: 'a.txt', data: 'x', at: first, skip: true }]))), DAMAGED, 'one entry twice');
  // Inflation is told to stop at each entry's declared size.
  const X = require('../lib/lookparts.js'), inflate = X.inflate, caps = [];
  X.inflate = (b, cap) => { caps.push(cap); return inflate(b, cap); };
  try { await M.read(rawZip(tiny([{ name: 'a.txt', data: 'a'.repeat(5000), method: 8 }]))); } finally { X.inflate = inflate; }
  assert.deepEqual(caps, [5000]);
  // Declared small, inflates huge: inflation stops at the declared size.
  const zeros = Buffer.alloc(20 << 20);
  const t = Date.now();
  await assert.rejects(M.read(rawZip(tiny([{ name: 'z.txt', data: zeros, method: 8, size: 1024, crc: 0 }]))), DAMAGED, 'size lie');
  // Declared huge: refused before anything is inflated.
  await assert.rejects(M.read(rawZip(tiny([{ name: 'z.txt', data: Buffer.alloc(10), method: 8, size: 50 << 20 }]))), BIG, 'declared 50 MiB');
  await assert.rejects(M.read(rawZip(tiny([{ name: 'z.txt', data: Buffer.alloc(10), method: 8, size: (2 << 20) - MOD_JSON.length + 1 }]))), BIG, 'declared one byte over');
  assert.ok(Date.now() - t < 3000, 'bombs fail fast');
  // A glazemod1: code that inflates without end stops at the zip cap.
  const code = M.PREFIX + b64u(zlib.deflateRawSync(Buffer.alloc(40 << 20)));
  assert.ok(code.length < M.CAP.text, 'the bomb fits in a code');
  await assert.rejects(M.decode(code), /damaged, cut short or too big/);
});

test('limits: files, total bytes, code bytes, mod.json, the archive', async () => {
  const many = Array.from({ length: 256 }, (_, i) => ({ name: `f${i}.txt`, data: '' }));
  await assert.rejects(M.read(rawZip(tiny(many))), BIG, '257 entries');
  await assert.rejects(M.read(rawZip(tiny(Array.from({ length: 300 }, (_, i) => ({ name: `d${i}/`, data: '' }))))), BIG, 'folder entries count too');
  assert.equal(Object.keys((await M.read(rawZip(tiny(many.slice(1))))).files).length, 256);
  const room = (2 << 20) - MOD_JSON.length;
  assert.ok(await M.read(rawZip(tiny([{ name: 'a.txt', data: 'a'.repeat(room) }]))));
  await assert.rejects(M.read(rawZip(tiny([{ name: 'a.txt', data: 'a'.repeat(room + 1) }]))), BIG);
  const code = 256 << 10;
  assert.ok(await M.bundle([['mod.json', u8(MOD_JSON)], ['a.js', u8('a'.repeat(code - 10))], ['b.js', u8('b'.repeat(10))]]));
  await assert.rejects(M.bundle([['mod.json', u8(MOD_JSON)], ['a.js', u8('a'.repeat(code - 10))], ['b.js', u8('b'.repeat(11))]]), BIG, 'code over 256 KiB');
  assert.ok(await M.bundle([['mod.json', u8(MOD_JSON)], ['a.css', u8('a'.repeat(code + 1))]]), 'CSS is not code');
  await assert.rejects(M.bundle([['mod.json', u8(MOD_JSON.replace('}', `,"x":"${' '.repeat(64 << 10)}"}`))]]), BIG, 'mod.json over 64 KiB');
  await assert.rejects(M.read(new Uint8Array(M.CAP.archive + 1)), BIG, 'archive over its cap');
  await assert.rejects(M.bundle([]), /no mod.json/);
  await assert.rejects(M.bundle([['MOD.JSON', u8(MOD_JSON)]]), /no mod.json/);
});

test('paths: nothing absolute, no .., no backslashes or drives, no hidden files, no duplicates (case-folded), no file over a folder', async () => {
  const one = (name, data = 'x') => M.read(rawZip(tiny([{ name, data }])));
  for (const p of ['../evil.js', 'a/../../evil.js', '/abs.js', '\\evil.js', 'a\\b.js', 'C:/x.js', 'C:x.js', 'a//b.js', './a.js', 'a/./b.js', '.hidden.js',
    'a/.git/x.txt', '__MACOSX/._a.js', 'a b.js', 'é.js', 'a.js ', `${'a/'.repeat(8)}x.js`, `${'a'.repeat(198)}.js`, 'a.js\u0000.png']) {
    await assert.rejects(one(p), /won't open/, JSON.stringify(p));
  }
  assert.ok(await one(`${'a/'.repeat(7)}x.js`), 'eight levels');
  assert.ok(await one(`${'a'.repeat(197)}.js`), '200 characters');
  await assert.rejects(M.read(rawZip(tiny([{ name: 'a.js', data: 'x' }, { name: 'a.js', data: 'y' }]))), /two files named a\.js/);
  await assert.rejects(M.read(rawZip(tiny([{ name: 'A.js', data: 'x' }, { name: 'a.js', data: 'y' }]))), /two files named a\.js/);
  await assert.rejects(M.read(rawZip(tiny([{ name: 'Img/x.png', data: PNG() }, { name: 'img/X.PNG', data: PNG() }]))), /two files named/);
  await assert.rejects(M.read(rawZip(tiny([{ name: 'a.js', data: 'x' }, { name: 'A.js/b.js', data: 'y' }]))), /two files named a\.js/);
  await assert.rejects(M.read(rawZip([{ name: 'mod.json', data: MOD_JSON }, { name: 'Mod.json', data: MOD_JSON }])), /two files named/);
});

test('kinds: only the listed extensions, checked against their bytes; no SVG, wasm, archives or binaries, nested zips refused', async () => {
  const one = (name, data) => M.read(rawZip(tiny([{ name, data }])));
  const KIND = /kind mods can't carry/;
  for (const p of ['x.exe', 'x.svg', 'x.wasm', 'x.zip', 'x.glazemod', 'x.mjs', 'x.mp3', 'README', 'x.', 'x.htm']) await assert.rejects(one(p, 'x'), KIND, p);
  const zipped = Buffer.from(rawZip(tiny()));
  await assert.rejects(one('nested.txt', zipped), KIND, 'a zip in a .txt');
  await assert.rejects(one('nested.json', zipped), KIND, 'a zip in a .json');
  await assert.rejects(one('nested.js', zlib.gzipSync(Buffer.from('x'))), KIND, 'gzip in a .js');
  await assert.rejects(one('x.js', Buffer.from([0x61, 0x00, 0x62])), KIND, 'a NUL');
  await assert.rejects(one('x.js', Buffer.from([0x61, 0xc3, 0x28])), KIND, 'not UTF-8');
  await assert.rejects(one('x.js', 'a\u001bb'), KIND, 'an escape character');
  await assert.rejects(one('x.png', 'not a png'), KIND);
  await assert.rejects(one('x.png', zipped), KIND, 'a zip named .png');
  await assert.rejects(one('x.jpg', PNG()), KIND, 'a PNG named .jpg');
  for (const [p, data] of [['x.png', PNG()], ['x.jpg', Buffer.from([0xff, 0xd8, 0xff, 0xe0])], ['x.JPEG', Buffer.from([0xff, 0xd8, 0xff, 0xdb])], ['x.gif', Buffer.from('GIF89a..')],
    ['x.webp', Buffer.from('RIFF\0\0\0\0WEBPVP8 ')], ['x.avif', Buffer.from('\0\0\0\x1cftypavif')], ['f.woff2', Buffer.from('wOF2....')], ['x.js', 'let a = "é";\r\n\tb\f'],
    ['x.css', 'a{}'], ['x.md', '# hi'], ['x.txt', ''], ['d.json', '{}'], ['x.html', '<p>hi</p>']]) {
    assert.ok(await one(p, data), p);
  }
  assert.equal(M.type('img/A.PNG'), 'image/png');
  assert.equal(M.type('a.svg'), null);
  await assert.rejects(M.bundle([['mod.json', u8(MOD_JSON)], ['mod.sig', u8('x'.repeat(86))]]), KIND, 'a mod.sig that is no signature');
  await assert.rejects(M.bundle([['mod.json', u8(MOD_JSON)], ['mod.sig', u8(`${VECTOR.sig}\n`)]]), KIND, 'a trailing newline');
  await assert.rejects(M.bundle([['mod.json', u8(MOD_JSON)], ['mod.sig', new Uint8Array(2 << 20)]]), KIND, 'a huge mod.sig');
});

// ---- mod.json -------------------------------------------------------------------------------------------------------
const BASE = { glaze: 1, name: 'Tiny', version: '1.0.0', author: { name: 'Kai', key: AUTHOR.x } };
const HTML = ['tile.html', u8('<p>tile</p>')];
const HOOKS = ['hooks.js', u8('1')];
// An unsigned bundle with mod.json = BASE patched (undefined deletes), plus files.
const man = (patch = {}, files = [HTML, HOOKS]) => {
  const m = { ...BASE, ...patch };
  for (const k of Object.keys(m)) if (m[k] === undefined) delete m[k];
  return M.bundle([['mod.json', u8(JSON.stringify(m))], ...files]);
};
const field = (f) => new RegExp(`can't use \\(${f.replace(/\./g, '\\.')}\\)`);

test('mod.json: a full manifest comes back exactly as written, and checking it again changes nothing', async () => {
  const full = {
    permissions: [{ id: 'network:api.weather.gov', why: 'Rains in the garden when it rains outside.' }, { id: 'network:xn--bcher-kva.example', why: 'Books.' }, { id: 'network:1.2.3.example', why: 'Numbers.' }],
    parts: { fx: { complete: { kind: 'confetti', count: 30 } } },
    ui: { tiles: [{ id: 'garden', name: 'Garden', file: 'tile.html', sizes: ['m', 'l'] }, { id: 'drawn', name: 'Drawn', sizes: ['s'] }], rail: [{ id: 'r', name: 'Rail' }], nav: {}, background: { file: 'tile.html' } },
    hooks: 'hooks.js', replaces: ['bg', 'nav', 'effect:complete', 'tile:timer'],
    settings: [
      { id: 'plant', type: 'choice', label: 'Plant', options: ['Fern', 'Cactus'], default: 'Fern' },
      { id: 'on', type: 'toggle', label: 'On', default: true },
      { id: 'n', type: 'number', label: 'N', min: 0, max: 10, step: 0.5, default: 2 },
      { id: 't', type: 'text', label: 'Text', max: 20, default: '' },
      { id: 'c', type: 'color', label: 'Colour', default: '#00ff88' },
    ],
  };
  const got = await man(full);
  assert.deepEqual(got.manifest, { ...BASE, ...full });
  assert.deepEqual(M.clean(structuredClone(got.manifest), got.files), got.manifest);
  assert.deepEqual(M.caps(got.manifest), ['network:api.weather.gov', 'network:xn--bcher-kva.example', 'network:1.2.3.example', 'code', 'frame']);
  assert.deepEqual(M.caps({ ...BASE, permissions: [{ id: 'grades', why: 'x' }], ui: { tiles: [{ id: 'a', name: 'A', sizes: ['s'] }] } }), ['grades']);
  for (const v of ['0.0.0', '1.2.3-beta.2', '1.0.0-rc-1.x', '999999.0.1']) assert.ok(await man({ version: v }), v);
});

test('mod.json: every refusal names its field', async () => {
  const hosts = (n) => Array.from({ length: n }, (_, i) => ({ id: `network:h${i}.example.com`, why: 'x' }));
  const cases = [
    [{ extra: 1 }, 'mod.json'], [{ glaze: 2 }, 'glaze'], [{ glaze: '1' }, 'glaze'], [{ glaze: undefined }, 'mod.json'],
    [{ name: '' }, 'name'], [{ name: ' Tiny' }, 'name'], [{ name: 'Ti  ny' }, 'name'], [{ name: 'Ti\nny' }, 'name'], [{ name: 'x'.repeat(41) }, 'name'],
    [{ name: '!!!' }, 'name'], [{ name: 'a\u202eb' }, 'name'], [{ name: 7 }, 'name'],
    [{ version: '1.0' }, 'version'], [{ version: '01.0.0' }, 'version'], [{ version: '1.0.0+build.1' }, 'version'], [{ version: 'v1.0.0' }, 'version'],
    [{ version: '1.0.0-' }, 'version'], [{ version: '1.0.0-01' }, 'version'], [{ version: '1234567.0.0' }, 'version'], [{ version: 1 }, 'version'], [{ version: ' 1.0.0' }, 'version'],
    [{ author: { name: 'Kai', key: AUTHOR.x, url: 'x' } }, 'author'], [{ author: { key: AUTHOR.x } }, 'author'], [{ author: { name: '', key: AUTHOR.x } }, 'author.name'],
    [{ author: { name: 'Kai' } }, 'author.key'], [{ author: { name: 'Kai', key: AUTHOR.x.slice(1) } }, 'author.key'],
    [{ author: { name: 'Kai', key: `${AUTHOR.x.slice(0, -1)}p` } }, 'author.key'], // the same 32 bytes spelled another way
    [{ permissions: {} }, 'permissions'], [{ permissions: [{ id: 'grades' }] }, 'permissions.0'], [{ permissions: [{ id: 'grades', why: 'x', extra: 1 }] }, 'permissions.0'],
    [{ permissions: [{ id: 'camera', why: 'x' }] }, 'permissions.0.id'], [{ permissions: [{ id: 'grades', why: 'x' }, { id: 'grades', why: 'y' }] }, 'permissions.1.id'],
    [{ permissions: [{ id: 'grades', why: '' }] }, 'permissions.0.why'], [{ permissions: [{ id: 'grades', why: 'x'.repeat(281) }] }, 'permissions.0.why'],
    [{ permissions: [{ id: 'grades', why: 'two\nlines' }] }, 'permissions.0.why'], [{ permissions: hosts(9) }, 'permissions'],
    ...['1.2.3.4', 'example.com:443', '*.example.com', 'Example.com', 'example.com.', 'localhost', '[::1]', '::1', 'exa_mple.com', '-a.com', 'a-.com', '', 'a.b.c.1', 'example.123',
      'https://example.com', 'example.com/x', 'ex ample.com', 'bücher.example', `${'a'.repeat(64)}.com`].map((h) => [{ permissions: [{ id: `network:${h}`, why: 'x' }] }, 'permissions.0.id']),
    [{ parts: { bg: { nope: 1 } } }, 'parts'], [{ parts: { fx: { complete: { kind: 'confetti', count: 999 } } } }, 'parts'], [{ parts: {} }, 'parts'],
    [{ ui: { extra: [] } }, 'ui'], [{ ui: [] }, 'ui'], [{ ui: { tiles: {} } }, 'ui.tiles'], [{ ui: { tiles: [{ id: 'a', name: 'A' }] } }, 'ui.tiles.0'],
    [{ ui: { tiles: [{ id: 'a', name: 'A', sizes: ['xl'] }] } }, 'ui.tiles.0.sizes'], [{ ui: { tiles: [{ id: 'a', name: 'A', sizes: ['s', 's'] }] } }, 'ui.tiles.0.sizes'],
    [{ ui: { tiles: [{ id: 'a', name: 'A', sizes: [] }] } }, 'ui.tiles.0.sizes'], [{ ui: { tiles: [{ id: 'A', name: 'A', sizes: ['s'] }] } }, 'ui.tiles.0.id'],
    [{ ui: { tiles: [{ id: 'a', name: 'A', sizes: ['s'] }, { id: 'a', name: 'B', sizes: ['s'] }] } }, 'ui.tiles.1.id'],
    [{ ui: { tiles: [{ id: 'a', name: 'A', sizes: ['s'], file: 'missing.html' }] } }, 'ui.tiles.0.file'], [{ ui: { tiles: [{ id: 'a', name: 'A', sizes: ['s'], file: 'hooks.js' }] } }, 'ui.tiles.0.file'],
    [{ ui: { tiles: Array.from({ length: 9 }, (_, i) => ({ id: `t${i}`, name: 'T', sizes: ['s'] })) } }, 'ui.tiles'], [{ ui: { rail: [{ id: 'a', name: 'A', sizes: ['s'] }] } }, 'ui.rail.0'],
    [{ ui: { nav: 'x' } }, 'ui.nav'], [{ ui: { nav: { file: 'missing.html' } } }, 'ui.nav.file'], [{ ui: { background: { other: 1 } } }, 'ui.background'],
    // A mod that reads personal data has no page of its own, named in its slots or not.
    [{ permissions: [{ id: 'grades', why: 'x' }], ui: { tiles: [{ id: 'a', name: 'A', sizes: ['s'], file: 'tile.html' }] } }, 'ui'], [{ permissions: [{ id: 'todo', why: 'x' }] }, 'ui'],
    [{ hooks: 'missing.js' }, 'hooks'], [{ hooks: 'tile.html' }, 'hooks'], [{ hooks: null }, 'hooks'], [{ hooks: 'mod.json' }, 'hooks'],
    [{ replaces: 'bg' }, 'replaces'], [{ replaces: ['bg', 'bg'] }, 'replaces'], [{ replaces: ['effect:nope'] }, 'replaces'], [{ replaces: ['tile:nope'] }, 'replaces'], [{ replaces: ['cursor'] }, 'replaces'],
    [{ settings: {} }, 'settings'], [{ settings: Array.from({ length: 33 }, (_, i) => ({ id: `s${i}`, type: 'toggle', label: 'S' })) }, 'settings'],
    [{ settings: [{ id: 'a', type: 'slider', label: 'A' }] }, 'settings.0.type'], [{ settings: [{ id: 'a', type: 'toggle' }] }, 'settings.0'], [{ settings: [{ id: 'a', type: 'toggle', label: 'A', min: 1 }] }, 'settings.0'],
    [{ settings: [{ id: 'a', type: 'toggle', label: 'A' }, { id: 'a', type: 'toggle', label: 'B' }] }, 'settings.1.id'], [{ settings: [{ id: 'a', type: 'toggle', label: 'A', default: 1 }] }, 'settings.0'],
    [{ settings: [{ id: 'a', type: 'choice', label: 'A', options: ['x'] }] }, 'settings.0'], [{ settings: [{ id: 'a', type: 'choice', label: 'A', options: ['x', 'x'] }] }, 'settings.0'],
    [{ settings: [{ id: 'a', type: 'choice', label: 'A', options: ['x', 'y'], default: 'z' }] }, 'settings.0'], [{ settings: [{ id: 'a', type: 'number', label: 'A', min: 2, max: 1 }] }, 'settings.0'],
    [{ settings: [{ id: 'a', type: 'number', label: 'A', min: 0, max: 1, default: 2 }] }, 'settings.0'], [{ settings: [{ id: 'a', type: 'number', label: 'A', min: 0, max: 1, step: 0 }] }, 'settings.0'],
    [{ settings: [{ id: 'a', type: 'text', label: 'A', max: 501 }] }, 'settings.0'], [{ settings: [{ id: 'a', type: 'text', label: 'A', max: 3, default: 'abcd' }] }, 'settings.0'],
    [{ settings: [{ id: 'a', type: 'color', label: 'A', default: '#FFF' }] }, 'settings.0'], [{ settings: [{ id: 'a', type: 'color', label: 'A', default: 'accent' }] }, 'settings.0'],
  ];
  for (const [patch, f] of cases) await assert.rejects(man(patch), field(f), JSON.stringify(patch).slice(0, 120));
  await assert.rejects(M.bundle([['mod.json', u8('{"glaze":1,')]]), /mod.json is damaged/);
  await assert.rejects(M.bundle([['mod.json', u8('[1]')]]), field('mod.json'));
  assert.ok(await M.bundle([['mod.json', Uint8Array.from([0xef, 0xbb, 0xbf, ...u8(JSON.stringify(BASE))])]]), 'a UTF-8 BOM is read past');
  await assert.rejects(M.bundle([['mod.json', u8('{"__proto__":{"glaze":1},"name":"Tiny"}')]]), field('author.key'));
  await assert.rejects(man({ __proto__: null, constructor: 1 }), field('mod.json'));
  assert.ok(await man({ permissions: hosts(8) }), 'eight hosts');
  assert.ok(await man({ permissions: [{ id: 'grades', why: 'x' }] }, [HOOKS]), 'a data mod without HTML');
});

test('versions order as semver: releases after their pre-releases, numbers by value', () => {
  const order = ['1.0.0-2', '1.0.0-1a', '1.0.0-alpha', '1.0.0-alpha.1', '1.0.0-alpha.beta', '1.0.0-beta', '1.0.0-beta.2', '1.0.0-beta.11', '1.0.0-rc.1', '1.0.0', '1.0.1', '1.9.0', '1.10.0', '2.0.0'];
  for (let i = 0; i < order.length; i++) {
    for (let j = 0; j < order.length; j++) assert.equal(M.compare(order[i], order[j]), Math.sign(i - j), `${order[i]} vs ${order[j]}`);
  }
});

// ---- signatures and tampering ----------------------------------------------------------------------------------------
const SIGNATURE = /signature doesn't match its files/;

test('tampering: one byte changed in any file, mod.json or mod.sig is refused; outside the files nothing changes', async () => {
  const r = await vector();
  for (const [p, bytes] of Object.entries(r.files)) {
    for (let i = 0; i < bytes.length; i++) {
      const files = { ...r.files, [p]: bytes.slice() };
      files[p][i] ^= 1;
      // The signature fails, unless the file stopped being its kind first (a control character in text, a broken PNG
      // header, mod.json no longer JSON or mod.sig no longer a signature): refused all the same.
      await assert.rejects(M.read(rezip(files)), p === 'mod.json' ? /signature|damaged|can't use|can't carry/ : /signature doesn't match|can't carry/, `${p}[${i}]`);
    }
  }
  // Every bit 0 of the zip itself: refused, or (a date, an attribute) the very same files.
  for (let i = 0; i < r.bytes.length; i++) {
    const z = r.bytes.slice();
    z[i] ^= 1;
    const got = await M.read(z).catch(() => null);
    if (got) assert.deepEqual([got.hash, Object.keys(got.files), got.signed], [r.hash, Object.keys(r.files), true], `zip byte ${i}`);
  }
});

test('tampering: a key swap is refused; re-signing with another key makes another mod, never an update', async () => {
  const r = await vector();
  const other = await M.makeKey();
  const json = JSON.parse(Buffer.from(r.files['mod.json']));
  // The mod.json names another key, the signature is still the first key's.
  await assert.rejects(M.read(rezip({ ...r.files, 'mod.json': u8(JSON.stringify({ ...json, author: { ...json.author, key: other.x } })) })), SIGNATURE);
  // The signature by another key over the very same hash, mod.json naming the first key.
  const forged = nodeCrypto.sign(null, Buffer.from(`glaze-mod-1|${r.hash}`), nodeCrypto.createPrivateKey({ key: { ...other }, format: 'jwk' }));
  await assert.rejects(M.read(rezip({ ...r.files, 'mod.sig': u8(b64u(forged)) })), SIGNATURE);
  // A whole bundle re-signed by someone else: valid, but its id is theirs.
  const theirs = await M.pack(FILES(), MANIFEST, other);
  assert.notEqual(theirs.id, r.id);
  assert.equal(theirs.hash === r.hash, false);
  // Even given the same id (an 80-bit collision), the pinned key refuses it.
  const installed = { id: r.id, key: r.key, hash: r.hash, version: '1.2.0', dev: false, manifest: r.manifest };
  assert.deepEqual(M.plan(installed, { ...theirs, id: r.id, version: '9.0.0' }), { action: 'refuse', reason: 'key', newPermissions: [], prompt: false });
  // Without mod.sig the bundle is unsigned: dev mode only.
  const bare = { ...r.files };
  delete bare['mod.sig'];
  const unsigned = await M.read(rezip(bare));
  assert.equal(unsigned.signed, false);
  assert.equal(M.plan(null, unsigned).reason, 'dev-off');
});

test('pack: refuses a manifest naming another key, a damaged key, a mismatched key pair and reserved names', async () => {
  const other = await M.makeKey();
  await assert.rejects(M.pack(FILES(), { ...MANIFEST, author: { name: 'Kai', key: other.x } }, AUTHOR), /different author key/);
  await assert.rejects(M.pack(FILES(), MANIFEST, { ...AUTHOR, d: 'x' }), /author key is damaged/);
  await assert.rejects(M.pack(FILES(), MANIFEST, { ...AUTHOR, x: other.x }), /author key is damaged/, 'd signs for another public key');
  await assert.rejects(M.pack({ ...FILES(), 'mod.json': u8('{}') }, MANIFEST, AUTHOR), /can't be packed/);
  await assert.rejects(M.pack({ ...FILES(), 'mod.sig': u8('{}') }, MANIFEST, AUTHOR), /can't be packed/);
  await assert.rejects(M.pack({ ...FILES(), 'x.svg': u8('<svg/>') }, MANIFEST, AUTHOR), /can't carry/);
});

// ---- codes -----------------------------------------------------------------------------------------------------------
test('glazemod1: codes carry the same bundle; too big for a code says so; damaged codes are refused', async () => {
  const r = await vector();
  const code = await M.encode(r.bytes);
  assert.match(code, /^glazemod1:[\w-]+$/);
  const back = await M.decode(` ${code.slice(0, 40)}\n${code.slice(40)} `);
  assert.deepEqual(back, r.bytes);
  assert.equal((await M.read(back)).hash, VECTOR.hash);
  const noise = nodeCrypto.randomBytes(90 << 10).toString('base64').slice(0, 90 << 10);
  const big = await M.pack({ 'a.txt': u8(noise) }, { ...BASE, author: { name: 'Kai' } }, AUTHOR);
  await assert.rejects(M.encode(big.bytes), /too big for a code/);
  await assert.rejects(M.decode('glaze1:abc'), /isn't a Glaze mod code/);
  await assert.rejects(M.decode('glazemod1:ab+c'), /damaged/);
  await assert.rejects(M.decode(`glazemod1:${'a'.repeat(M.CAP.text)}`), /damaged/);
  const long = `glazemod1:${b64u(zlib.deflateRawSync(nodeCrypto.randomBytes(60 << 10)))}`;
  assert.ok(long.length > M.CAP.text);
  await assert.rejects(M.decode(long), /^Error: That mod code is damaged\.$/, 'a well formed code over 64 KiB');
  await assert.rejects(M.decode(code.slice(0, -10)), /damaged, cut short/);
  await assert.rejects(M.decode(null), /damaged/);
});

// ---- the author's key ----------------------------------------------------------------------------------------------
test('author key: made extractable, backed up plain or under a passphrase, restored only whole and only with the passphrase', async () => {
  assert.equal(await M.canSign(), true);
  const k = await M.makeKey();
  assert.deepEqual(Object.keys(k), ['kty', 'crv', 'd', 'x']);
  assert.equal(await M.keyPair(k), true);
  assert.equal(await M.keyPair({ ...k, x: AUTHOR.x }), false, 'a private half that signs for another public key');
  const r = await M.pack(FILES(), MANIFEST, k);
  assert.equal((await M.read(r.bytes)).key, k.x);

  const plain = await M.backup(k);
  assert.deepEqual(await M.restore(plain), k);
  const locked = await M.backup(k, 'correct horse');
  assert.ok(!locked.includes(k.d), 'the private key is not in the clear');
  const f = JSON.parse(locked);
  assert.deepEqual([f.glazeAuthorKey, f.x, f.kdf.name, f.kdf.hash, f.kdf.iterations], [1, k.x, 'PBKDF2', 'SHA-256', 600000]);
  assert.deepEqual(await M.restore(locked, 'correct horse'), k);
  await assert.rejects(M.restore(locked), /needs its passphrase/);
  await assert.rejects(M.restore(locked, 'wrong'), /doesn't open/);
  const ct = Buffer.from(f.ct, 'base64url');
  ct[3] ^= 1;
  await assert.rejects(M.restore(JSON.stringify({ ...f, ct: b64u(ct) }), 'correct horse'), /doesn't open/, 'ciphertext changed');
  await assert.rejects(M.restore(JSON.stringify({ ...f, x: AUTHOR.x }), 'correct horse'), /doesn't open/, 'the public key in the clear swapped');
  for (const bad of [{ kdf: { ...f.kdf, iterations: 1000 } }, { kdf: { ...f.kdf, iterations: 1e9 } }, { kdf: { ...f.kdf, hash: 'SHA-1' } }, { iv: 'abc' }, { kdf: { ...f.kdf, salt: '' } }]) {
    await assert.rejects(M.restore(JSON.stringify({ ...f, ...bad }), 'correct horse'), /damaged/, JSON.stringify(bad));
  }
  // A file whose clear public key isn't the one inside (made with the passphrase, so it opens): refused, not swapped in.
  const S = globalThis.crypto.subtle, other = await M.makeKey(), salt = nodeCrypto.randomBytes(16), iv = nodeCrypto.randomBytes(12);
  const pk = await S.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100000 }, await S.importKey('raw', u8('pw'), 'PBKDF2', false, ['deriveKey']), { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
  const inside = await S.encrypt({ name: 'AES-GCM', iv, additionalData: u8(`glaze-author-key-1|${k.x}`) }, pk, u8(JSON.stringify(other)));
  const mixed = JSON.stringify({ glazeAuthorKey: 1, x: k.x, kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: 100000, salt: b64u(salt) }, iv: b64u(iv), ct: b64u(new Uint8Array(inside)) });
  await assert.rejects(M.restore(mixed, 'pw'), /damaged/);
  for (const text of ['', 'nope', '{}', JSON.stringify({ glazeAuthorKey: 2, key: k }), 'x'.repeat(5000)]) await assert.rejects(M.restore(text), /isn't a Glaze author key file/);
  await assert.rejects(M.restore(JSON.stringify({ glazeAuthorKey: 1, key: { ...k, x: AUTHOR.x } })), /damaged/, 'a mismatched pair');
  await assert.rejects(M.backup({ ...k, x: AUTHOR.x }), /damaged/);
});

// ---- WebCrypto Ed25519 -------------------------------------------------------------------------------------------
test('WebCrypto Ed25519: RFC 8032 vectors, agreement with OpenSSL and strict encodings', async () => {
  const hex = (s) => Uint8Array.from(Buffer.from(s, 'hex'));
  const RFC = [
    ['d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a', '', 'e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b'],
    ['3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c', '72', '92a009a9f0d4cab8720e820b5f642540a2b27b5416503f8fb3762223ebdb69da085ac1e43e15996e458f3613d0f11d8c387b2eaeb4302aeeb00d291612bb0c00'],
    ['fc51cd8e6218a1a38da47ed00230f0580816ed13ba3303ac5deb911548908025', 'af82', '6291d657deec24024827e69c3abe01a30ce548a284743a445e3680d7db5ac3ac18ff9b538d16f290ae67f760984dc6594a7c15e9716ed28dc027beceea1ec40a'],
  ];
  for (const [pk, msg, sig] of RFC) {
    assert.equal(await M.verify(hex(pk), hex(msg), hex(sig)), true);
    const s = hex(sig);
    s[63] ^= 1;
    assert.equal(await M.verify(hex(pk), hex(msg), s), false);
    assert.equal(await M.verify(hex(pk), hex(`${msg}00`), hex(sig)), false);
  }
  const verifyOpenSSL = (pub, msg, sig) => nodeCrypto.verify(null, msg, { key: { kty: 'OKP', crv: 'Ed25519', x: b64u(pub) }, format: 'jwk' }, sig);
  for (let i = 0; i < 24; i++) {
    const { publicKey, privateKey } = nodeCrypto.generateKeyPairSync('ed25519');
    const pub = Uint8Array.from(Buffer.from(publicKey.export({ format: 'jwk' }).x, 'base64url'));
    const msg = Uint8Array.from(nodeCrypto.randomBytes(i * 7));
    const sig = Uint8Array.from(nodeCrypto.sign(null, msg, privateKey));
    assert.equal(await M.verify(pub, msg, sig), true);
    const bit = nodeCrypto.randomInt(sig.length * 8);
    const bent = sig.slice();
    bent[bit >> 3] ^= 1 << (bit & 7);
    assert.equal(await M.verify(pub, msg, bent), verifyOpenSSL(pub, msg, bent), `bit ${bit}`);
    assert.equal(await M.verify(pub, msg, bent), false);
  }
  // s + L: the same signature with a non-canonical s (malleable) is refused, as BoringSSL and OpenSSL do.
  const L = 2n ** 252n + 27742317777372353535851937790883648493n;
  const [pk, msg, sig] = RFC[0].map(hex);
  const s = sig.subarray(32).reduceRight((n, x) => (n << 8n) | BigInt(x), 0n) + L;
  const big = sig.slice();
  for (let i = 0, v = s; i < 32; i++, v >>= 8n) big[32 + i] = Number(v & 255n);
  assert.equal(await M.verify(pk, msg, big), false);
  assert.equal(verifyOpenSSL(pk, msg, big), false);
  // A y of p or more is not a point (R and A); lengths other than 32 and 64 are nothing.
  const highY = new Uint8Array(32).fill(0xff);
  highY[31] = 0x7f;
  assert.equal(await M.verify(pk, msg, Uint8Array.from([...highY, ...sig.subarray(32)])), false);
  assert.equal(await M.verify(highY, msg, sig), false);
  assert.equal(await M.verify(pk.subarray(1), msg, sig), false);
  assert.equal(await M.verify(pk, msg, sig.subarray(1)), false);
  assert.equal(M.ed25519, undefined, 'no hand-written crypto exported');
});

test('WebCrypto Ed25519: detect support once and refuse signed and dev installs with an update-browser error', async () => {
  let probes = 0;
  const subtle = new Proxy(crypto.subtle, { get(target, prop) {
    if (prop === 'importKey') return (...args) => {
      if (String(args[2]?.name || args[2]) === 'Ed25519') { probes++; return Promise.reject(new DOMException('Unavailable', 'NotSupportedError')); }
      return target.importKey(...args);
    };
    return typeof target[prop] === 'function' ? target[prop].bind(target) : target[prop];
  } });
  const context = vm.createContext({ crypto: { subtle }, TextEncoder, TextDecoder, Uint8Array, atob, btoa, require: (f) => require(`../lib/${f}`) });
  const old = vm.runInContext(fs.readFileSync(path.join(__dirname, '../lib/modbundle.js'), 'utf8'), context);
  const r = await vector(), bare = { ...r.files };
  delete bare['mod.sig'];
  for (const files of [r.files, bare]) await assert.rejects(old.bundle(Object.entries(files)), /[Uu]pdate your browser/);
  assert.equal(await old.canSign(), false);
  assert.equal(probes, 1, 'a cached feature detection, with no crypto fallback');
});

// ---- install and update rules ---------------------------------------------------------------------------------------
test('plan: TOFU on the key, newer versions only, prompts when permissions grow, dev rules, blocklist', () => {
  const K1 = AUTHOR.x, K2 = 'z'.repeat(42) + 'w';
  const P = (...ids) => ({ permissions: ids.map((id) => ({ id, why: 'x' })) });
  const rec = (o = {}) => ({ id: 'aaaaaaaaaaaaaaaa', key: K1, hash: 'H1', version: '1.0.0', dev: false, manifest: P('grades'), ...o });
  const inc = (o = {}) => ({ id: 'aaaaaaaaaaaaaaaa', key: K1, hash: 'H2', version: '1.1.0', signed: true, manifest: P('grades'), ...o });
  const FRAME = { permissions: [], ui: { tiles: [{ id: 't', name: 'T', sizes: ['s'], file: 't.html' }] } };
  const BLOCKS = { tiles: [{ id: 't', name: 'T', sizes: ['s'], blocks: [{ type: 'text', text: 'hi' }] }] };
  const DEV = { dev: true };
  const yes = (action, reason, newPermissions, prompt) => ({ action, reason, newPermissions, prompt });
  const no = (reason) => yes('refuse', reason, [], false);
  // What the blocklist says about the incoming bundle: its reason, or ''.
  const banned = { ...no('blocked'), blocked: 'Sends grades away.' };
  const BLOCKED = { blocked: 'Sends grades away.' };
  const rows = [
    ['first install', null, inc(), {}, yes('install', 'new', ['grades'], true)],
    ['first install, frame UI', null, inc({ manifest: FRAME }), {}, yes('install', 'new', ['code', 'frame'], true)],
    ['unsigned without dev mode', null, inc({ signed: false }), {}, no('dev-off')],
    ['unsigned in dev mode', null, inc({ signed: false }), DEV, yes('install', 'dev', ['grades'], true)],
    ['newer, same permissions: quiet', rec(), inc(), {}, yes('update', 'newer', [], false)],
    ['newer, fewer permissions: quiet', rec({ manifest: P('grades', 'todo') }), inc(), {}, yes('update', 'newer', [], false)],
    ['newer, more permissions: prompt', rec(), inc({ manifest: P('grades', 'network:api.example.com') }), {}, yes('update', 'newer', ['network:api.example.com'], true)],
    ['newer, now with frame UI: prompt', rec({ manifest: { permissions: [] } }), inc({ manifest: FRAME }), {}, yes('update', 'newer', ['code', 'frame'], true)],
    ['newer, a widget Glaze draws now has hooks: prompt', rec({ manifest: { ...P('todo'), ui: BLOCKS } }), inc({ manifest: { ...P('todo'), hooks: 'hooks.js' } }), {}, yes('update', 'newer', ['code'], true)],
    ['newer, a widget now with a slot page: prompt', rec({ manifest: { ...P('todo'), ui: BLOCKS } }), inc({ manifest: { ...P('todo'), ui: { tiles: [{ id: 't', name: 'T', sizes: ['s'], file: 't.html' }] } } }), {}, yes('update', 'newer', ['code', 'frame'], true)],
    ['newer, code already there: quiet', rec({ manifest: { ...P('todo'), hooks: 'hooks.js' } }), inc({ manifest: { ...P('todo'), hooks: 'other.js' } }), {}, yes('update', 'newer', [], false)],
    ['newer, code dropped: quiet', rec({ manifest: { ...P('todo'), hooks: 'hooks.js' } }), inc({ manifest: { ...P('todo'), ui: BLOCKS } }), {}, yes('update', 'newer', [], false)],
    ['another key', rec(), inc({ key: K2 }), {}, no('key')],
    ['another id', rec(), inc({ id: 'bbbbbbbbbbbbbbbb' }), {}, no('id')],
    ['the same bundle again', rec(), inc({ hash: 'H1', version: '1.0.0' }), {}, no('same')],
    ['same version, other files', rec(), inc({ version: '1.0.0' }), {}, no('version')],
    ['downgrade', rec({ version: '2.0.0' }), inc({ version: '1.9.9' }), {}, no('version')],
    ['an older signed bundle replayed', rec({ version: '1.1.0', hash: 'H2' }), inc({ version: '1.0.0', hash: 'H0' }), {}, no('version')],
    ['pre-release of the installed version', rec(), inc({ version: '1.0.0-beta' }), {}, no('version')],
    ['release after its pre-release', rec({ version: '1.0.0-beta' }), inc({ version: '1.0.0' }), {}, yes('update', 'newer', [], false)],
    ['unsigned over signed, even in dev mode', rec(), inc({ signed: false }), DEV, no('signed')],
    ['signed over a dev copy', rec({ dev: true }), inc(), DEV, no('dev')],
    ['dev reload, same version', rec({ dev: true }), inc({ signed: false, version: '1.0.0' }), DEV, yes('update', 'dev', [], false)],
    ['dev reload asking for more', rec({ dev: true }), inc({ signed: false, manifest: P('grades', 'courses') }), DEV, yes('update', 'dev', ['courses'], true)],
    ['dev reload after dev mode went off', rec({ dev: true }), inc({ signed: false }), {}, no('dev-off')],
    ['blocked, first install', null, inc(), BLOCKED, banned],
    ['blocked update', rec(), inc(), BLOCKED, banned],
    ['blocked, dev mode or not', null, inc({ signed: false }), { ...DEV, ...BLOCKED }, banned],
    ['not blocked', rec(), inc(), { blocked: '' }, yes('update', 'newer', [], false)],
  ];
  for (const [what, installed, incoming, opts, want] of rows) assert.deepEqual(M.plan(installed, incoming, opts), want, what);
});

// ---- the worker's broker ---------------------------------------------------------------------------------------------
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
// globals: more for the worker's global scope (a stand-in GZ_BLOCKLIST).
// own: clone messages and stored values inside the worker's realm, as real ones arrive (the cleaners check plain objects by
// prototype); the default clones outside it.
const worker = (local = {}, globals = {}, own = false) => {
  let clone = structuredClone;
  const store = { local, sync: { enabled: true } };
  const area = (s) => ({
    get: async (k) => clone(k == null ? s : Object.fromEntries([].concat(k).filter((x) => x in s).map((x) => [x, s[x]]))),
    set: async (v) => { Object.assign(s, clone(v)); },
    remove: async (k) => { for (const x of [].concat(k)) delete s[x]; },
  });
  const listeners = [], imported = [];
  const context = vm.createContext({
    URL, URLSearchParams, console, TextEncoder, TextDecoder, structuredClone, Promise, Date, AbortController, crypto: globalThis.crypto, atob, btoa, navigator: {},
    Blob, CompressionStream, DecompressionStream, DOMException, setTimeout, clearTimeout, ...globals,
    importScripts: (...files) => { for (const f of files) { imported.push(f); vm.runInContext(read(`lib/${f}`), context); } },
    chrome: {
      runtime: { id: 'glaze', getURL: (f = '') => `chrome-extension://x/${f}`, getManifest: () => require('../manifest.json'), onMessage: { addListener: (f) => listeners.push(f) },
        onInstalled: { addListener() {} }, onStartup: { addListener() {} }, onConnect: { addListener() {} } },
      storage: { local: area(store.local), sync: area(store.sync), onChanged: { addListener() {} } },
      tabs: { query: async () => [] },
      scripting: { getRegisteredContentScripts: async () => [], registerContentScripts: async () => {}, unregisterContentScripts: async () => {} },
    },
  });
  if (own) clone = vm.runInContext('(v) => structuredClone === undefined ? v : JSON.parse(JSON.stringify(v))', context);
  vm.runInContext(read('lib/background.js'), context);
  const send = (m, sender) => new Promise((res) => { for (const f of listeners) f(clone(m), sender, (r) => res(structuredClone(r))); });
  return { store, send, imported, context };
};
const EDITOR = { id: 'glaze', url: 'chrome-extension://x/options.html#mods', frameId: 0, origin: 'chrome-extension://x' };
const std = (b) => Buffer.from(b).toString('base64');

test('broker: only the editor\'s own top frame may use glaze:mods', async () => {
  const w = worker();
  const list = { type: 'glaze:mods', op: 'list' };
  assert.deepEqual(await w.send(list, EDITOR), { ok: true, mods: [] });
  assert.ok(w.imported.includes('modbundle.js') && w.imported.includes('zip.js'), 'loaded on first use');
  const senders = {
    'an LMS page': { id: 'glaze', tab: { id: 4 }, frameId: 0, url: 'https://school.instructure.com/courses/7', origin: 'https://school.instructure.com' },
    'the popup': { id: 'glaze', url: 'chrome-extension://x/popup.html', frameId: 0, origin: 'chrome-extension://x' },
    'the editor\'s preview frame': { ...EDITOR, frameId: 3 },
    'another extension': { ...EDITOR, id: 'evil' },
    'an editor address from another origin': { ...EDITOR, origin: 'https://evil.example' },
    'the Notes share panel': { id: 'glaze', url: 'chrome-extension://x/sharing/quick.html', frameId: 3, origin: 'chrome-extension://x', tab: { id: 4 } },
    'a sandboxed mod host (opaque origin)': { id: 'glaze', url: 'chrome-extension://x/mods/host.html', frameId: 2, origin: 'null', tab: { id: 4 } },
  };
  for (const [who, s] of Object.entries(senders)) {
    for (const op of M.OPS) assert.deepEqual(await w.send({ type: 'glaze:mods', op, id: 'aaaaaaaaaaaaaaaa' }, s), { ok: false, error: 'sender' }, `${who}: ${op}`);
  }
  assert.deepEqual(await w.send({ type: 'glaze:mods', op: 'eval' }, EDITOR), { ok: false, error: 'sender' }, 'an unknown operation');
  assert.deepEqual(await w.send({ type: 'glaze:mods', op: 'enable', id: 'nope' }, EDITOR), { ok: false, error: 'bad' });
  assert.deepEqual(await w.send({ type: 'glaze:mods', op: 'enable', id: 'aaaaaaaaaaaaaaaa' }, EDITOR), { ok: false, error: 'missing' });
});

test('broker: install, list, enable, disable, revoke, quiet and prompted updates, export and remove, each checked again in the worker', async () => {
  const w = worker();
  const send = (m) => w.send({ type: 'glaze:mods', ...m }, EDITOR);
  const v1 = await M.pack(FILES(), MANIFEST, AUTHOR);
  const install = (r, more = {}) => send({ op: 'install', zip: std(r.bytes), hash: r.hash, grants: ['network:api.weather.gov'], source: 'file', ...more });

  // What the worker refuses whatever the editor says.
  assert.deepEqual(await install(v1, { hash: 'x'.repeat(43) }), { ok: false, error: 'hash' }, 'not the bundle the student saw');
  assert.deepEqual(await install(v1, { grants: ['grades'] }), { ok: false, error: 'grants' }, 'a grant the mod never asked for');
  assert.deepEqual(await install(v1, { grants: undefined }), { ok: false, error: 'grants' }, 'no answer from a prompt');
  assert.deepEqual(await install(v1, { source: 'magic' }), { ok: false, error: 'bad' });
  assert.deepEqual(await install(v1, { zip: '!!' }), { ok: false, error: 'bad' });
  const changed = await install(v1, { zip: std(M.archive({ ...v1.files, 'hooks.js': u8('steal()') })) });
  assert.deepEqual([changed.error, changed.why], ['bundle', "That mod's signature doesn't match its files: it was changed after its author signed it."]);
  assert.equal((await install(v1, { zip: std(u8('not a zip')) })).why, "That mod file is damaged, or isn't a Glaze mod.");
  assert.deepEqual(w.store.local, {}, 'nothing written');

  const got = await install(v1);
  assert.equal(got.ok, true);
  assert.equal(got.action, 'install');
  const rec = w.store.local[`mod:${v1.id}`];
  assert.deepEqual(w.store.local.mods, [v1.id]);
  assert.deepEqual(Object.keys(rec).sort(), ['dev', 'enabled', 'files', 'grants', 'hash', 'id', 'installedAt', 'key', 'manifest', 'source', 'version']);
  assert.deepEqual([rec.hash, rec.key, rec.version, rec.enabled, rec.dev, rec.source], [v1.hash, AUTHOR.x, '1.2.0', true, false, 'file']);
  assert.deepEqual(rec.grants, { 'network:api.weather.gov': true });
  assert.deepEqual(Object.fromEntries(Object.entries(rec.files).map(([k, b]) => [k, Buffer.from(b, 'base64').equals(Buffer.from(v1.files[k]))])),
    { 'garden.html': true, 'hooks.js': true, 'img/leaf.png': true, 'mod.json': true, 'mod.sig': true });
  assert.deepEqual(rec.manifest, JSON.parse(Buffer.from(v1.files['mod.json'])));
  const listed = await send({ op: 'list' });
  assert.equal(listed.mods.length, 1);
  assert.equal('files' in listed.mods[0], false, 'the list leaves the files out');
  assert.deepEqual(await install(v1), { ok: false, error: 'refused', reason: 'same' });

  assert.deepEqual(await send({ op: 'disable', id: v1.id }), { ok: true });
  assert.equal(w.store.local[`mod:${v1.id}`].enabled, false);
  assert.deepEqual(await send({ op: 'enable', id: v1.id }), { ok: true });
  assert.deepEqual(await send({ op: 'revoke', id: v1.id, perm: 'grades' }), { ok: false, error: 'bad' });
  assert.deepEqual(await send({ op: 'revoke', id: v1.id, perm: 'network:api.weather.gov' }), { ok: true });
  assert.deepEqual(w.store.local[`mod:${v1.id}`].grants, {});

  // A quiet update keeps the revoked grant revoked, whatever grants the message carries.
  const v2 = await M.pack(FILES(), { ...MANIFEST, version: '1.3.0' }, AUTHOR);
  assert.deepEqual((await install(v2, { grants: ['network:api.weather.gov'] })).action, 'update');
  assert.deepEqual(w.store.local[`mod:${v1.id}`].grants, {});
  assert.equal(w.store.local[`mod:${v1.id}`].version, '1.3.0');
  assert.deepEqual(await install(v1), { ok: false, error: 'refused', reason: 'version' }, 'downgrade');
  // An update asking for more needs the student's answer, which then is the grants.
  const v3 = await M.pack(FILES(), { ...MANIFEST, version: '1.4.0', permissions: [...MANIFEST.permissions, { id: 'network:tiles.example.com', why: 'Map tiles.' }] }, AUTHOR);
  assert.deepEqual(await install(v3, { grants: undefined }), { ok: false, error: 'grants' });
  assert.equal((await install(v3, { grants: ['network:tiles.example.com'] })).ok, true);
  assert.deepEqual(w.store.local[`mod:${v1.id}`].grants, { 'network:tiles.example.com': true });
  // Someone else's bundle with the same name is another mod, never an update.
  const theirs = await M.pack(FILES(), { ...MANIFEST, version: '9.0.0' }, await M.makeKey());
  assert.equal((await install(theirs)).action, 'install');
  assert.deepEqual(w.store.local.mods, [v1.id, theirs.id]);

  // Unsigned: only in dev mode, and never over a signed mod.
  const bare = { ...v3.files };
  delete bare['mod.sig'];
  const dev = await M.read(M.archive(bare));
  assert.deepEqual(await install({ bytes: M.archive(bare), hash: dev.hash }, { source: 'dev' }), { ok: false, error: 'refused', reason: 'dev-off' });
  w.store.local.modDev = true;
  assert.deepEqual(await install({ bytes: M.archive(bare), hash: dev.hash }, { source: 'dev' }), { ok: false, error: 'refused', reason: 'signed' });

  const out = await send({ op: 'export', id: v1.id });
  assert.equal(out.ok, true);
  assert.equal(out.name, 'GPA Garden');
  assert.deepEqual(new Uint8Array(Buffer.from(out.zip, 'base64')), v3.bytes, 'the same .glazemod bytes back');

  assert.deepEqual(await send({ op: 'remove', id: v1.id }), { ok: true });
  assert.equal(`mod:${v1.id}` in w.store.local, false);
  assert.deepEqual(w.store.local.mods, [theirs.id]);
  assert.deepEqual(await install(v1), { ok: false, error: 'refused', reason: 'version' }, 'removal keeps the highest version');
  assert.equal((await install(v3)).action, 'install', 'the exact highest bundle can be reinstalled with a prompt');
});

test('broker: Remove clears what the mod stored, its private flag, nav switch and stop note by default, and keeps them when asked', async () => {
  const w = worker();
  const send = (m) => w.send({ type: 'glaze:mods', ...m }, EDITOR);
  const v1 = await M.pack(FILES(), MANIFEST, AUTHOR);
  const stash = (id, other) => Object.assign(w.store.local, {
    [`modData:${id}`]: { grades: [{ percent: 91.5 }] }, [`modPrivate:${id}`]: true, [`modNavLayout:${id}`]: false,
    modStops: { [id]: { why: 'error', at: 1 }, [other]: { why: 'error', at: 2 } },
  });
  const OTHER = 'bbbbbbbbbbbbbbbb';
  const install = () => send({ op: 'install', zip: std(v1.bytes), hash: v1.hash, grants: ['network:api.weather.gov'], source: 'file' });
  const own = (id) => [`modData:${id}`, `modPrivate:${id}`, `modNavLayout:${id}`];
  assert.equal((await install()).ok, true);
  stash(v1.id, OTHER);
  Object.assign(w.store.local, { [`modData:${OTHER}`]: { keep: 1 } });
  assert.equal((await send({ op: 'remove', id: v1.id })).ok, true);
  assert.deepEqual(own(v1.id).filter((k) => k in w.store.local), [], 'its stored data, private flag and nav switch are gone');
  assert.deepEqual(w.store.local.modStops, { [OTHER]: { why: 'error', at: 2 } }, 'only its own stop note goes');
  assert.deepEqual(w.store.local[`modData:${OTHER}`], { keep: 1 }, 'another mod\'s data stays');

  assert.equal((await install()).ok, true);
  stash(v1.id, OTHER);
  assert.equal((await send({ op: 'remove', id: v1.id, data: false })).ok, true);
  assert.deepEqual(own(v1.id).filter((k) => k in w.store.local), own(v1.id), 'kept on request');
  assert.ok(v1.id in w.store.local.modStops);
  assert.deepEqual(await send({ op: 'remove', id: v1.id, data: 'no' }), { ok: false, error: 'bad' });
});

test('Remove can be retried when persisting the cleared stop note fails', async () => {
  const id = 'aaaaaaaaaaaaaaaa', record = { id, files: {}, dev: true };
  const store = { mods: [id], [`mod:${id}`]: record, [`modData:${id}`]: { grades: 1 }, modStops: { [id]: { why: 'error' } } };
  let fail = true;
  const local = {
    get: async (key) => Object.fromEntries([].concat(key).map((k) => [k, store[k]])),
    set: async (patch) => { if (fail && 'modStops' in patch) return false; Object.assign(store, structuredClone(patch)); return true; },
    remove: async (keys) => { for (const k of [].concat(keys)) delete store[k]; return true; },
  };
  assert.equal((await M.change({ op: 'remove', id }, { local })).ok, false);
  assert.ok(store[`mod:${id}`], 'a failed cleanup keeps the mod available for retry');
  assert.deepEqual(store.mods, [id]);
  fail = false;
  assert.equal((await M.change({ op: 'remove', id }, { local })).ok, true);
  assert.equal(store[`mod:${id}`], undefined);
  assert.equal(store[`modData:${id}`], undefined);
  assert.deepEqual(store.modStops, {});
});

test('broker: the blocklist (GZ_BLOCKLIST) stops installs, updates and turning a blocked mod back on; the list keeps its reason', async () => {
  const listed = new Set(), REASON = 'Sends grades away.';
  // lib/blocklist.js's shape: blocked(local, { id, hash, key }) → a promise of its reason, or ''.
  const asked = [];
  const w = worker({}, { GZ_BLOCKLIST: { blocked: async (local, { id, hash, key }) => { asked.push(typeof local.get); return [id, hash, key].some((v) => listed.has(v)) ? REASON : ''; } } });
  const send = (m) => w.send({ type: 'glaze:mods', ...m }, EDITOR);
  const install = (r) => send({ op: 'install', zip: std(r.bytes), hash: r.hash, grants: [], source: 'file' });
  const v1 = await M.pack(FILES(), MANIFEST, AUTHOR), v2 = await M.pack(FILES(), { ...MANIFEST, version: '1.3.0' }, AUTHOR);
  const refused = { ok: false, error: 'refused', reason: 'blocked', blocked: REASON };
  listed.add(AUTHOR.x);
  assert.deepEqual(await install(v1), refused, 'a blocked author');
  listed.clear();
  assert.equal((await install(v1)).ok, true);
  listed.add(v2.hash);
  assert.deepEqual(await install(v2), refused, 'a blocked update');
  assert.equal(w.store.local[`mod:${v1.id}`].version, '1.2.0');
  // What lib/blocklist.js does to an installed mod it blocks; the list shows why, and it can't be turned back on.
  w.store.local[`mod:${v1.id}`] = { ...w.store.local[`mod:${v1.id}`], enabled: false, blocked: REASON };
  const [shown] = (await send({ op: 'list' })).mods;
  assert.deepEqual([shown.enabled, shown.blocked], [false, REASON]);
  listed.clear();
  assert.deepEqual(await send({ op: 'enable', id: v1.id }), refused, 'marked blocked');
  delete w.store.local[`mod:${v1.id}`].blocked;
  listed.add(v1.id);
  assert.deepEqual(await send({ op: 'enable', id: v1.id }), refused, 'listed, not yet marked');
  listed.clear();
  assert.deepEqual(await send({ op: 'enable', id: v1.id }), { ok: true });
  assert.ok(asked.length >= 5 && asked.every((t) => t === 'function'), 'asked with the storage area');
});

test('broker: a fresh worker loads and enforces the real blocklist for installs, updates and enable', async () => {
  const w = worker();
  const send = (m) => w.send({ type: 'glaze:mods', ...m }, EDITOR);
  await send({ op: 'list' });
  assert.equal(vm.runInContext('typeof GZ_BLOCKLIST?.blocked', w.context), 'function', 'loaded in the worker for glaze:mods');
  const v1 = await M.pack(FILES(), MANIFEST, AUTHOR);
  assert.equal(await vm.runInContext(`GZ_BLOCKLIST.blocked({ get: async () => ({}) }, ${JSON.stringify({ id: v1.id, hash: v1.hash, key: v1.key })})`, w.context), '', 'no list yet: fails open');
  const v2 = await M.pack(FILES(), { ...MANIFEST, version: '1.3.0' }, AUTHOR);
  const install = (r) => send({ op: 'install', zip: std(r.bytes), hash: r.hash, grants: [], source: 'file' });
  const refused = { ok: false, error: 'refused', reason: 'blocked', blocked: 'Listed.' };
  const list = { v: 1, seq: 1, issued: '2026-10-16T00:00:00Z', expires: '2026-11-16T00:00:00Z', mods: [], bundles: [], authors: [AUTHOR.x], reasons: { [AUTHOR.x]: 'Listed.' } };
  w.store.local.modsBlocklist = { list };
  assert.deepEqual(await install(v1), refused, 'author block on first install');
  list.authors = []; list.reasons = {};
  assert.equal((await install(v1)).ok, true);
  list.bundles = [v2.hash]; list.reasons = { [v2.hash]: 'Listed.' };
  assert.deepEqual(await install(v2), refused, 'bundle block on update');
  list.mods = [v1.id]; list.reasons[v1.id] = 'Listed.';
  assert.deepEqual(await send({ op: 'enable', id: v1.id }), refused, 'id block before record is marked');

});

test('broker: wired as the other brokers are, and cached at install for later worker starts', () => {
  const src = read('lib/background.js');
  assert.match(src, /BROKER_FILES\.mods = \['zip\.js', 'modapi\.js', 'modwidget\.js', 'modbundle\.js', 'blocklist\.js'\];/);
  assert.match(src, /addEventListener\?\.\('install', \(\) => importScripts\('zip\.js', 'modapi\.js', 'modwidget\.js', 'modbundle\.js'\)\)/);
  assert.match(src, /allow: \(m, s\) => fromEditor\(s\) && s\.frameId === 0 && s\.origin === chrome\.runtime\.getURL\(''\)\.replace\(\/\\\/\$\/, ''\) && GZ_MODBUNDLE\.OPS\.includes\(m\.op\)/);
});


test('trust: removal retains author, highest version and hash, including legacy records; only an explicit editor clear forgets them', async () => {
  let w = worker();
  const send = (m) => w.send({ type: 'glaze:mods', ...m }, EDITOR);
  const v1 = await vector(), v2 = await M.pack(FILES(), { ...MANIFEST, version: '2.0.0' }, AUTHOR);
  const install = (r, extra = {}) => send({ op: 'install', zip: std(r.bytes), hash: r.hash, grants: [], source: 'file', ...extra });
  assert.equal((await install(v2)).ok, true);
  const key = `modTrust:${v1.id}`;
  const pin = { key: v2.key, version: v2.version, hash: v2.hash };
  assert.deepEqual(w.store.local[key], pin);
  assert.deepEqual(await send({ op: 'clearTrust', id: v1.id }), { ok: false, error: 'installed' });
  // Migrate an installed record written before separate trust storage was introduced.
  delete w.store.local[key];
  assert.equal((await send({ op: 'remove', id: v1.id })).ok, true);
  assert.deepEqual(w.store.local[key], pin);
  w = worker(structuredClone(w.store.local)); // a worker restart cannot forget it
  assert.deepEqual(await install(v1), { ok: false, error: 'refused', reason: 'version' });
  const sameVersion = await M.pack({ ...FILES(), 'extra.txt': u8('other') }, { ...MANIFEST, version: '2.0.0' }, AUTHOR);
  assert.deepEqual(await install(sameVersion), { ok: false, error: 'refused', reason: 'version' }, 'same version with different files');
  const bare = { ...v2.files }; delete bare['mod.sig'];
  w.store.local.modDev = true;
  assert.deepEqual(await install({ bytes: M.archive(bare), hash: v2.hash }), { ok: false, error: 'refused', reason: 'signed' }, 'no unsigned bypass after removal');
  const swapped = { ...v2, key: (await M.makeKey()).x };
  assert.equal(M.plan(null, swapped, { trust: pin }).reason, 'key', 'pin protects even a hypothetical id collision');
  assert.equal((await install(v2)).action, 'install');
  assert.equal((await send({ op: 'remove', id: v1.id })).ok, true);
  assert.equal((await send({ op: 'clearTrust', id: v1.id })).ok, true);
  assert.equal(key in w.store.local, false);
  assert.equal((await install(v1)).action, 'install', 'explicitly cleared trust permits an older version');
});


test('broker: grant restores only a declared permission in the editor and quiet updates preserve timestamps and revoked grants', async () => {
  const w = worker(), id = (await vector()).id;
  const send = (m) => w.send({ type: 'glaze:mods', ...m }, EDITOR);
  const install = (r) => send({ op: 'install', zip: std(r.bytes), hash: r.hash, grants: [], source: 'file' });
  assert.equal((await install(await vector())).ok, true);
  const request = { op: 'grant', id, perm: 'network:api.weather.gov' };
  assert.deepEqual(await w.send({ type: 'glaze:mods', ...request }, { ...EDITOR, url: 'https://school.example', origin: 'https://school.example' }), { ok: false, error: 'sender' });
  assert.deepEqual(await send({ ...request, perm: 'grades' }), { ok: false, error: 'bad' });
  assert.deepEqual(await send({ ...request, perm: '__proto__' }), { ok: false, error: 'bad' });
  assert.deepEqual(await send(request), { ok: true });
  assert.deepEqual(w.store.local[`mod:${id}`].grants, { 'network:api.weather.gov': true });
  assert.deepEqual(await send({ ...request, op: 'revoke' }), { ok: true });
  const before = w.store.local[`mod:${id}`];
  before.installedAt = 1000;
  before.updatedAt = 1500;
  const v2 = await M.pack(FILES(), { ...MANIFEST, version: '2.0.0' }, AUTHOR);
  const result = await install(v2);
  assert.equal(result.action, 'update');
  assert.equal(result.mod.installedAt, 1000, 'an update is not a new installation');
  assert.ok(result.mod.updatedAt >= 1500, 'quiet updates can be shown as updated');
  assert.deepEqual(result.mod.grants, {}, 'quiet updates keep revocations');
  assert.deepEqual(await send(request), { ok: true });
});


test('broker: a quiet update records updatedAt without replacing installedAt', async () => {
  const w = worker();
  const install = (r) => w.send({ type: 'glaze:mods', op: 'install', zip: std(r.bytes), hash: r.hash, grants: [], source: 'file' }, EDITOR);
  const v1 = await vector();
  await install(v1);
  w.store.local[`mod:${v1.id}`].installedAt = 1000;
  const v2 = await M.pack(FILES(), { ...MANIFEST, version: '2.0.0' }, AUTHOR);
  const result = await install(v2);
  assert.equal(result.mod.installedAt, 1000);
  assert.ok(result.mod.updatedAt > 1000);
});


test('prompt: strip format, zero-width and bidi controls from every displayed string without changing signed bytes', async () => {
  const hidden = 'A\u00ad\u061c\u200b\u200c\u200d\u200e\u200f\u202a\u202e\u2060\u2066\u2069\ufeffB';
  const raw = { name: hidden, author: { name: hidden }, permissions: [{ id: 'grades', why: hidden }],
    ui: { tiles: [{ name: hidden }], rail: [{ name: hidden }] }, settings: [{ label: hidden, options: [hidden], default: hidden }],
    parts: { nav: { groups: [{ label: hidden }], links: [{ n: hidden }] }, rules: [{ t: hidden }] } };
  const displayed = M.prompt(raw);
  assert.equal(JSON.stringify(displayed).includes('AB'), true);
  assert.equal(/[\p{Cf}\p{Bidi_Control}]/u.test(JSON.stringify(displayed)), false);
  assert.equal(raw.name, hidden, 'display cleaning leaves the signed manifest alone');
  const dirty = { ...MANIFEST, name: 'GPA\u200b Garden', author: { name: 'K\u200cai' } };
  const bundle = await M.pack(FILES(), dirty, AUTHOR);
  assert.equal(bundle.prompt.name, 'GPA Garden', 'pre-install prompt view');
  assert.equal(bundle.prompt.author.name, 'Kai');
  assert.equal(bundle.manifest.name, dirty.name);
  assert.deepEqual((await M.read(bundle.bytes)).files['mod.json'], bundle.files['mod.json']);
  const w = worker();
  const installed = await w.send({ type: 'glaze:mods', op: 'install', zip: std(bundle.bytes), hash: bundle.hash, grants: [], source: 'file' }, EDITOR);
  assert.equal(installed.mod.prompt.name, 'GPA Garden', 'worker prompt view uses the same cleaner');
  const listed = await w.send({ type: 'glaze:mods', op: 'list' }, EDITOR);
  assert.equal(listed.mods[0].prompt.author.name, 'Kai');
});


test('zip: local metadata, data descriptors, ZIP64 extras, unindexed gaps and directory aliases cannot disagree', async (t) => {
  // Both standard descriptor spellings work, for store and deflate.
  for (const method of [0, 8]) for (const descriptorSignature of [true, false]) {
    assert.ok(await M.read(rawZip(tiny([{ name: 'a.js', data: 'hello', method, flags: 0x808, descriptorSignature }]))));
  }
  const cases = [
    { name: 'a.js', data: 'x', localFlags: 0x808 },
    { name: 'a.js', data: 'x', localCrc: 1 },
    { name: 'a.js', data: 'x', localSize: 2 },
    { name: 'a.js', data: 'x', localCsize: 2 },
    { name: 'a.js', data: 'x', flags: 0x808, localSize: 2 },
    { name: 'a.js', data: 'x', flags: 0x808, descCrc: 1 },
    { name: 'a.js', data: 'x', flags: 0x808, descSize: 2 },
    { name: 'a.js', data: 'x', flags: 0x808, descCsize: 2 },
    { name: 'a.js', data: 'x', flags: 0x808, descriptor: Buffer.alloc(0) },
    { name: 'a.js', data: 'x', descriptor: Buffer.from('hidden unindexed bytes') },
    { name: 'a.js', data: 'x', extraData: Buffer.from([1, 0, 0, 0]) }, // ZIP64, even without sentinel sizes
    { name: 'a.js', data: 'x', extraData: Buffer.from([0x75, 0x70, 0, 0]) }, // Unicode path override
    { name: 'a.js', data: 'x', extraData: Buffer.from([0, 0, 4, 0]) }, // truncated extra
    { name: 'img/', data: '', crc: 1 },
  ];
  for (const e of cases) await t.test(JSON.stringify(e), () => assert.rejects(M.read(rawZip(tiny([e]))), DAMAGED));
  for (const entries of [
    [{ name: 'img/', data: '' }, { name: 'IMG/', data: '' }],
    [{ name: 'a.js/', data: '' }, { name: 'A.js', data: 'x' }],
    [{ name: 'a.js/sub/', data: '' }, { name: 'A.js', data: 'x' }],
  ]) await t.test(entries.map((e) => e.name).join(' / '), () => assert.rejects(M.read(rawZip(tiny(entries))), /two files named/));
  for (const name of ['é.js', 'e\u0301.js', 'Ａ.js']) await assert.rejects(M.read(rawZip(tiny([{ name: Buffer.from(name), data: 'x' }]))), /won't open/);
});


test('broker: an unsigned mod cannot be re-enabled after dev mode is switched off', async () => {
  const w = worker({ modDev: true });
  const send = (m) => w.send({ type: 'glaze:mods', ...m }, EDITOR);
  const v1 = await vector(), files = { ...v1.files }; delete files['mod.sig'];
  const r = await send({ op: 'install', zip: std(M.archive(files)), hash: v1.hash, grants: [], source: 'dev' });
  assert.equal(r.ok, true);
  assert.equal(r.mod.dev, true);
  assert.equal((await send({ op: 'disable', id: v1.id })).ok, true);
  w.store.local.modDev = false;
  assert.deepEqual(await send({ op: 'enable', id: v1.id }), { ok: false, error: 'refused', reason: 'dev-off' });
  assert.equal(w.store.local[`mod:${v1.id}`].enabled, false);
  w.store.local.modDev = true;
  assert.deepEqual(await send({ op: 'enable', id: v1.id }), { ok: true });
});

test('broker: replacement switches are cleaned against the installed manifest, kept by updates (new keys off) and cleared by remove', async () => {
  const w = worker({}, {}, true);
  const send = (m, s = EDITOR) => w.send({ type: 'glaze:mods', ...m }, s);
  const install = (r) => send({ op: 'install', zip: std(r.bytes), hash: r.hash, grants: ['network:api.weather.gov'], source: 'file' });
  const v1 = await M.pack(FILES(), { ...MANIFEST, replaces: ['bg', 'effect:complete'] }, AUTHOR);
  await install(v1);
  const key = `modReplace:${v1.id}`;
  const set = (s) => send({ op: 'replace', id: v1.id, set: s });
  assert.deepEqual(await set({ 'effect:complete': true, bg: false }), { ok: true });
  assert.equal(JSON.stringify(w.store.local[key]), JSON.stringify({ bg: false, 'effect:complete': true }));
  for (const bad of [{ nav: true }, { bg: 1 }, { bg: 'true' }, { bg: null }, [true], 'bg', null, undefined]) {
    assert.deepEqual(await set(bad), { ok: false, error: 'bad' }, JSON.stringify(bad));
  }
  assert.equal(JSON.stringify(w.store.local[key]), JSON.stringify({ bg: false, 'effect:complete': true }), 'refused writes change nothing');
  assert.deepEqual(await send({ op: 'replace', id: 'aaaaaaaaaaaaaaaa', set: { bg: true } }), { ok: false, error: 'missing' }, 'only an installed mod');
  assert.deepEqual(await send({ op: 'replace', id: v1.id, set: { bg: true } }, { ...EDITOR, frameId: 2 }), { ok: false, error: 'sender' });
  assert.deepEqual(await send({ op: 'replace', id: v1.id, set: { bg: true } }, { id: 'glaze', tab: { id: 4 }, frameId: 0, url: 'https://school.instructure.com/', origin: 'https://school.instructure.com' }), { ok: false, error: 'sender' });
  assert.equal(JSON.stringify(w.store.local[key]), JSON.stringify({ bg: false, 'effect:complete': true }));

  // An update keeps what is on and declared; a key it adds is off; one it drops is forgotten, so it can't come back on.
  await set({ bg: true, 'effect:complete': true });
  const v2 = await M.pack(FILES(), { ...MANIFEST, version: '1.3.0', replaces: ['bg', 'nav'] }, AUTHOR);
  assert.equal((await install(v2)).action, 'update');
  assert.equal(JSON.stringify(w.store.local[key]), JSON.stringify({ bg: true }));
  const v3 = await M.pack(FILES(), { ...MANIFEST, version: '1.4.0', replaces: ['effect:complete'] }, AUTHOR);
  assert.equal((await install(v3)).action, 'update');
  assert.equal(JSON.stringify(w.store.local[key]), JSON.stringify({}));

  await set({ 'effect:complete': true });
  assert.deepEqual(await send({ op: 'remove', id: v1.id }), { ok: true });
  assert.equal(key in w.store.local, false, 'remove clears the replacements');
});

test('broker: concurrent replacement edits and updates preserve other switches without reviving dropped keys', async () => {
  const w = worker({}, {}, true);
  const send = (m) => w.send({ type: 'glaze:mods', ...m }, EDITOR);
  const install = (r) => send({ op: 'install', zip: std(r.bytes), hash: r.hash, grants: ['network:api.weather.gov'], source: 'file' });
  const v1 = await M.pack(FILES(), { ...MANIFEST, replaces: ['bg', 'nav'] }, AUTHOR);
  assert.equal((await install(v1)).ok, true);
  const key = `modReplace:${v1.id}`, saved = () => JSON.parse(JSON.stringify(w.store.local[key]));
  const set = (value) => send({ op: 'replace', id: v1.id, set: value });
  assert.deepEqual(await Promise.all([set({ bg: true }), set({ nav: true })]), [{ ok: true }, { ok: true }]);
  assert.deepEqual(saved(), { bg: true, nav: true });
  assert.deepEqual(await Promise.all([set({ bg: false }), set({ nav: false }), set({ bg: true })]), [{ ok: true }, { ok: true }, { ok: true }]);
  assert.equal(saved().bg, true, 'the last edit of the same key wins');
  assert.equal(saved().nav === true, false);
  const v2 = await M.pack(FILES(), { ...MANIFEST, version: '1.3.0', replaces: ['bg', 'effect:complete'] }, AUTHOR);
  const [nav, update, bg, stale] = await Promise.all([set({ nav: true }), install(v2), set({ bg: false }), set({ nav: true })]);
  assert.equal(nav.ok && update.ok && bg.ok, true);
  assert.deepEqual(stale, { ok: false, error: 'bad' }, 'a queued edit uses the updated manifest');
  assert.deepEqual(saved(), { bg: false });
  await Promise.all([send({ op: 'remove', id: v1.id }), set({ bg: true })]);
  assert.equal(key in w.store.local, false, 'a queued edit cannot recreate removed state');
});


test('broker: concurrent first author requests retain one signing identity', async () => {
  const w = worker();
  const ask = () => w.send({ type: 'glaze:mods', op: 'author' }, EDITOR);
  const both = await Promise.all([ask(), ask()]);
  assert.ok(both.every((r) => r.ok), 'both editors receive an author key');
  assert.equal(both[0].key.x === both[1].key.x, true, 'both requests use the same identity');
  assert.equal(both.filter((r) => r.created).length, 1, 'only one key is generated');
  assert.equal(w.store.local.modAuthor.x === both[0].key.x, true, 'the returned identity remains stored');
  assert.equal(await M.keyPair(both[0].key), true);
  const again = await ask();
  assert.equal(again.created, false);
  assert.equal(again.key.x === both[0].key.x, true);
  const damaged = worker({ modAuthor: { damaged: true } });
  const refused = await damaged.send({ type: 'glaze:mods', op: 'author' }, EDITOR);
  assert.equal(refused.ok, false, 'an existing damaged key is never silently overwritten');
  assert.equal(damaged.store.local.modAuthor.damaged, true);
  const failed = await M.change({ op: 'author' }, { local: { get: async () => ({}), set: async () => false } });
  assert.deepEqual(failed, { ok: false, error: 'write' }, 'no signing identity is returned unless it was retained');
});


test('plan: adding or changing a remote background host prompts without granting network', () => {
  const manifest = (src) => ({ permissions: [], ...(src && { parts: { bg: { media: { type: 'video', src } } } }) });
  const before = (src) => ({ id: 'a', key: 'k', hash: 'old', version: '1.0.0', dev: false, manifest: manifest(src) });
  const incoming = (src) => ({ ...before(src), hash: 'new', version: '1.1.0', signed: true });
  for (const old of [null, 'https://old.example/a.webm', `file:${'a'.repeat(43)}`]) {
    const plan = M.plan(before(old), incoming('https://new.example/a.webm'));
    assert.equal(plan.prompt, true, 'the newly contacted host needs consent');
    assert.deepEqual(plan.newPermissions, ['media:new.example']);
  }
  assert.deepEqual(M.caps(manifest('https://new.example/a.webm')), ['media:new.example']);
  assert.equal(M.plan(before('https://new.example/a.webm'), incoming('https://new.example/b.webm')).prompt, false, 'the same host is already disclosed');
  assert.equal(M.plan(before('https://new.example/a.webm'), incoming(null)).prompt, false, 'removing remote media needs no new consent');
  assert.deepEqual(M.caps(manifest(`file:${'a'.repeat(43)}`)), [], 'local media adds no remote capability');
});
