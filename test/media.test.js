// lib/media.js: the containers it reads (WebP, AVIF, WebM, MP4), the Lottie cleaner, and the files the worker keeps for a Look.
// Everything here is someone else's bytes, so each reader is tried on real encoder output (test/fixtures/media/) and on files
// built to be wrong in the ways that matter: lengths that lie, sizes and frame counts over a limit, things that reach out or run
// away. A reader that takes less than a file holds returns the cleaned copy, which must come back unchanged when read again.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const M = require('../lib/media.js');

const fx = (f) => new Uint8Array(fs.readFileSync(path.join(__dirname, 'fixtures/media', f)));
const text = (f) => fs.readFileSync(path.join(__dirname, 'fixtures/media', f), 'utf8');
const u32 = (n) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255];
const u24 = (n) => [n & 255, (n >> 8) & 255, (n >> 16) & 255];
const ascii = (s) => [...Buffer.from(s, 'latin1')];
const chunk = (id, data) => [...ascii(id), ...u32(data.length), ...data, ...(data.length & 1 ? [0] : [])];
const riff = (...chunks) => { const body = [...ascii('WEBP'), ...chunks.flat()]; return Uint8Array.from([...ascii('RIFF'), ...u32(body.length), ...body]); };
// A lossless picture's chunk: only its header is real, as far as the reader goes.
const vp8l = (w, h) => chunk('VP8L', [0x2f, ...u32((w - 1) | ((h - 1) << 14)), 0, 0, 0, 0]);
const vp8x = (flags, w, h) => chunk('VP8X', [flags, 0, 0, 0, ...u24(w - 1), ...u24(h - 1)]);
const anmf = (w, h, x = 0, y = 0, inner = vp8l(w, h)) => chunk('ANMF', [...u24(x / 2), ...u24(y / 2), ...u24(w - 1), ...u24(h - 1), ...u24(100), 0, ...inner]);
const animated = (w, h, frames) => riff(vp8x(0x02, w, h), chunk('ANIM', [0, 0, 0, 0, 0, 0]), ...Array.from({ length: frames }, () => anmf(w, h)));
const eq = (a, b) => assert.deepEqual(Array.from(a), Array.from(b));

// ---- WebP ---------------------------------------------------------------------------------------------------------------
test('real WebP files: a still and an animation are read, and a clean file comes back byte for byte', () => {
  for (const [f, frames, moves] of [['still.webp', 1, false], ['anim.webp', 3, true]]) {
    const got = M.check(fx(f), 'bg');
    assert.deepEqual([got.type, got.mime, got.w, got.h, got.frames, got.animated], ['image', 'image/webp', 48, 48, frames, moves], f);
    eq(got.bytes, fx(f));
    eq(M.check(got.bytes, 'bg').bytes, got.bytes); // cleaning twice changes nothing
  }
});

test('WebP is rebuilt from the chunks that draw it: metadata and unknown chunks are gone, nothing else changes', () => {
  const frame = anmf(16, 16);
  const dirty = riff(vp8x(0x02 | 0x08 | 0x04, 16, 16), chunk('ANIM', [0, 0, 0, 0, 0, 0]), frame, chunk('EXIF', [1, 2, 3]), chunk('XMP ', ascii('<x/>')), chunk('JUNK', [9]));
  const got = M.webp(dirty, M.LIMIT.bg.image);
  const clean = riff(vp8x(0x02, 16, 16), chunk('ANIM', [0, 0, 0, 0, 0, 0]), frame);
  eq(got.bytes, clean);
  eq(M.webp(got.bytes, M.LIMIT.bg.image).bytes, clean);
  // A still with metadata, in the extended layout.
  const still = riff(vp8x(0x08, 16, 16), vp8l(16, 16), chunk('EXIF', [1]));
  eq(M.webp(still, M.LIMIT.bg.image).bytes, riff(vp8x(0, 16, 16), vp8l(16, 16)));
  // The colour profile stays, and its flag.
  const icc = riff(vp8x(0x20, 16, 16), chunk('ICCP', [1, 2, 3, 4]), vp8l(16, 16));
  eq(M.webp(icc, M.LIMIT.bg.image).bytes, icc);
});

test('WebP that is not whole or not plain is refused', () => {
  const cap = M.LIMIT.bg.image, ok = animated(16, 16, 2);
  assert.ok(M.webp(ok, cap));
  const cases = {
    'not riff': Uint8Array.from([...ascii('RIFX'), ...ok.subarray(4)]),
    'not webp': Uint8Array.from([...ok.subarray(0, 8), ...ascii('WEBX'), ...ok.subarray(12)]),
    'riff size too small': Uint8Array.from([...ok.subarray(0, 4), ...u32(ok.length - 9), ...ok.subarray(8)]),
    'riff size too big': Uint8Array.from([...ok.subarray(0, 4), ...u32(ok.length - 7), ...ok.subarray(8)]),
    'trailing bytes': Uint8Array.from([...ok, 0]),
    truncated: ok.subarray(0, ok.length - 3),
    empty: new Uint8Array(),
    'chunk past the end': riff([...ascii('VP8L'), ...u32(1000), 0x2f]),
    'no chunks': riff(),
    'animation flag, no ANIM': riff(vp8x(0x02, 16, 16), anmf(16, 16)),
    'animation flag, no frames': riff(vp8x(0x02, 16, 16), chunk('ANIM', [0, 0, 0, 0, 0, 0])),
    'ANIM after the frames': riff(vp8x(0x02, 16, 16), anmf(16, 16), chunk('ANIM', [0, 0, 0, 0, 0, 0])),
    'two ANIM': riff(vp8x(0x02, 16, 16), chunk('ANIM', [0, 0, 0, 0, 0, 0]), chunk('ANIM', [0, 0, 0, 0, 0, 0]), anmf(16, 16)),
    'short ANIM': riff(vp8x(0x02, 16, 16), chunk('ANIM', [0, 0]), anmf(16, 16)),
    'a picture beside the frames': riff(vp8x(0x02, 16, 16), chunk('ANIM', [0, 0, 0, 0, 0, 0]), vp8l(16, 16), anmf(16, 16)),
    'frames without the flag': riff(vp8x(0, 16, 16), chunk('ANIM', [0, 0, 0, 0, 0, 0]), anmf(16, 16)),
    'frame outside the canvas': riff(vp8x(0x02, 16, 16), chunk('ANIM', [0, 0, 0, 0, 0, 0]), anmf(16, 16, 2, 0)),
    'frame size that is not its picture': riff(vp8x(0x02, 16, 16), chunk('ANIM', [0, 0, 0, 0, 0, 0]), anmf(16, 16, 0, 0, vp8l(8, 8))),
    'frame with two pictures': riff(vp8x(0x02, 16, 16), chunk('ANIM', [0, 0, 0, 0, 0, 0]), anmf(16, 16, 0, 0, [...vp8l(16, 16), ...vp8l(16, 16)])),
    'frame with junk inside': riff(vp8x(0x02, 16, 16), chunk('ANIM', [0, 0, 0, 0, 0, 0]), anmf(16, 16, 0, 0, [...vp8l(16, 16), ...chunk('JUNK', [1])])),
    'ANMF too short': riff(vp8x(0x02, 16, 16), chunk('ANIM', [0, 0, 0, 0, 0, 0]), chunk('ANMF', [0, 0, 0])),
    'two pictures in a still': riff(vp8x(0, 16, 16), vp8l(16, 16), vp8l(16, 16)),
    'a picture of another size than its header says': riff(vp8x(0, 16, 16), vp8l(16000, 16000)),
    'no picture': riff(vp8x(0, 16, 16)),
    'colour flag, no profile': riff(vp8x(0x20, 16, 16), vp8l(16, 16)),
    'profile, no flag': riff(vp8x(0, 16, 16), chunk('ICCP', [1, 2]), vp8l(16, 16)),
    'bad VP8X length': riff(chunk('VP8X', [0, 0, 0, 0, 15, 0, 0, 15, 0]), vp8l(16, 16)),
    'bad VP8L signature': riff(chunk('VP8L', [0x2e, ...u32(0), 0, 0, 0, 0])),
    'alpha in a plain file': riff(chunk('ALPH', [0, 0]), chunk('VP8 ', [0, 0, 0, 0x9d, 0x01, 0x2a, 16, 0, 16, 0])),
    'plain file with metadata': riff(vp8l(16, 16), chunk('EXIF', [1])),
  };
  for (const [why, bytes] of Object.entries(cases)) assert.equal(M.webp(bytes, cap), null, why);
  // And the size limits: a side, the frames, and the pixels over all the frames.
  assert.ok(M.webp(animated(4096, 8, 3), cap));
  assert.equal(M.webp(animated(4097, 8, 3), cap), null, 'a side over 4096');
  assert.ok(M.webp(animated(8, 8, 300), cap));
  assert.equal(M.webp(animated(8, 8, 301), cap), null, 'more than 300 frames');
  assert.equal(M.webp(animated(4000, 4000, 30), cap), null, '480 million pixels over the frames');
  assert.equal(M.webp(animated(600, 600, 2), M.LIMIT.sticker.image), null, 'a sticker is at most 512 on a side');
  assert.equal(M.webp(animated(512, 512, 200), M.LIMIT.sticker.image), null, 'and at most 150 frames');
});

test('WebP simple files: lossy and lossless are measured from their own headers', () => {
  const lossy = riff(chunk('VP8 ', [0, 0, 0, 0x9d, 0x01, 0x2a, 20, 0, 10, 0, 0, 0]));
  assert.deepEqual([M.webp(lossy, M.LIMIT.bg.image).w, M.webp(lossy, M.LIMIT.bg.image).h], [20, 10]);
  assert.deepEqual([M.webp(riff(vp8l(33, 7)), M.LIMIT.bg.image).w, M.webp(riff(vp8l(33, 7)), M.LIMIT.bg.image).h], [33, 7]);
  assert.equal(M.webp(riff(chunk('VP8 ', [0, 0, 0, 0, 0, 0, 20, 0, 10, 0, 0, 0])), M.LIMIT.bg.image), null, 'no start code');
  const alpha = riff(vp8x(0x10, 20, 10), chunk('ALPH', [0, 1, 2]), chunk('VP8 ', [0, 0, 0, 0x9d, 0x01, 0x2a, 20, 0, 10, 0, 0, 0]));
  assert.ok(M.webp(alpha, M.LIMIT.bg.image));
  assert.equal(M.webp(riff(vp8x(0x10, 20, 10), chunk('ALPH', [0]), vp8l(20, 10)), M.LIMIT.bg.image), null, 'alpha belongs to a lossy picture');
});

// ---- AVIF ---------------------------------------------------------------------------------------------------------------
const box = (type, ...payload) => { const body = payload.flat(); return [...Array.from(u32(body.length + 8)).reverse(), ...ascii(type), ...body]; };
const be = (n) => Array.from(u32(n)).reverse();
const ftyp = (major, ...compat) => box('ftyp', ascii(major), 0, 0, 0, 0, ...compat.flatMap(ascii));
const ispe = (w, h) => box('ispe', 0, 0, 0, 0, be(w), be(h));
const meta = (...kids) => box('meta', 0, 0, 0, 0, ...kids.flat());
const stillAvif = (w, h) => Uint8Array.from([...ftyp('avif', 'mif1'), ...meta(box('iprp', box('ipco', ispe(w, h))))]);
const movingAvif = (w, h, n) => Uint8Array.from([...ftyp('avis', 'avif'), ...meta(box('iprp', box('ipco', ispe(w, h)))), ...box('moov', box('trak', box('mdia', box('minf', box('stbl', box('stsz', 0, 0, 0, 0, be(0), be(n)))))))]);

test('AVIF: the real animated file is read, and the walker follows boxes to their ends', () => {
  const real = M.check(fx('anim.avif'), 'bg');
  assert.deepEqual([real.type, real.mime, real.w, real.h, real.frames, real.animated], ['image', 'image/avif', 48, 48, 3, true]);
  eq(real.bytes, fx('anim.avif'));
  const still = M.avif(stillAvif(64, 32), M.LIMIT.bg.image);
  assert.deepEqual([still.w, still.h, still.frames, still.animated], [64, 32, 1, false]);
  const moving = M.avif(movingAvif(64, 32, 12), M.LIMIT.bg.image);
  assert.deepEqual([moving.w, moving.h, moving.frames, moving.animated], [64, 32, 12, true]);
});

test('AVIF that is not whole, not a picture or over a limit is refused', () => {
  const cap = M.LIMIT.bg.image, ok = movingAvif(64, 32, 12);
  const cases = {
    truncated: ok.subarray(0, ok.length - 2),
    'extra bytes': Uint8Array.from([...ok, 0, 0]),
    'box over its parent': Uint8Array.from([...ftyp('avif'), ...box('meta', 0, 0, 0, 0, ...box('iprp', box('ipco', ispe(8, 8))).slice(0, -1))]),
    'no ftyp first': Uint8Array.from([...meta(), ...ftyp('avif')]),
    'neither brand': Uint8Array.from([...ftyp('heic', 'mif1'), ...meta(box('iprp', box('ipco', ispe(8, 8))))]),
    'no meta': Uint8Array.from([...ftyp('avif')]),
    'two meta': Uint8Array.from([...ftyp('avif'), ...meta(box('iprp', box('ipco', ispe(8, 8)))), ...meta(box('iprp', box('ipco', ispe(8, 8))))]),
    'no size': Uint8Array.from([...ftyp('avif'), ...meta(box('iprp', box('ipco')))]),
    'a sequence without moov': Uint8Array.from([...ftyp('avis'), ...meta(box('iprp', box('ipco', ispe(8, 8))))]),
    'a sequence without a sample table': Uint8Array.from([...ftyp('avis'), ...meta(box('iprp', box('ipco', ispe(8, 8)))), ...box('moov', box('trak'))]),
    'a box of 64-bit size with high bits': Uint8Array.from([...ftyp('avif'), 0, 0, 0, 1, ...ascii('free'), 0, 0, 0, 1, 0, 0, 0, 16]),
    'a box smaller than its header': Uint8Array.from([...ftyp('avif'), 0, 0, 0, 4, ...ascii('free')]),
    'a side over 4096': movingAvif(4097, 8, 2),
    'frames over 300': movingAvif(8, 8, 301),
    'pixels over all frames': movingAvif(3000, 3000, 60),
  };
  for (const [why, bytes] of Object.entries(cases)) assert.equal(M.avif(bytes, cap), null, why);
  assert.equal(M.avif(movingAvif(600, 600, 2), M.LIMIT.sticker.image), null, 'a sticker: 512 a side at most');
});

// ---- video --------------------------------------------------------------------------------------------------------------
test('WebM and MP4: real files are known by their first bytes and boxes, and kept as they came', () => {
  for (const [f, mime] of [['clip.webm', 'video/webm'], ['clip.mp4', 'video/mp4']]) {
    const got = M.check(fx(f), 'bg');
    assert.deepEqual([got.type, got.mime], ['video', mime], f);
    eq(got.bytes, fx(f));
  }
  assert.equal(M.check(fx('clip.webm'), 'sticker'), null, 'a sticker is never a video');
});

test('what only looks like a video is refused', () => {
  const mp4 = fx('clip.mp4'), webm = fx('clip.webm');
  const cases = {
    empty: new Uint8Array(), 'plain text': Buffer.from('hello, this is a video, honest'.repeat(5)), 'random': Uint8Array.from({ length: 400 }, (_, i) => (i * 37 + 11) & 255),
    'matroska, not webm': Uint8Array.from([...webm.subarray(0, 64)].map((b, i) => (i >= 20 && i < 64 ? (b === 0x77 ? 0x78 : b) : b)).concat([...webm.subarray(64)])),
    'mp4 cut short': mp4.subarray(0, mp4.length - 5),
    'mp4 with extra bytes': Uint8Array.from([...mp4, 1]),
    'an image brand': Uint8Array.from([...ftyp('avif', 'mif1'), ...box('moov')]),
    'no moov': Uint8Array.from([...ftyp('isom', 'mp42'), ...box('mdat', 1, 2, 3)]),
    'moov with a lying size': Uint8Array.from([...ftyp('isom'), 0, 0, 1, 0, ...ascii('moov'), 1, 2]),
  };
  cases['matroska, not webm'] = Uint8Array.from(webm, (b, i) => (i < 64 && b === 0x77 ? 0x78 : b));
  for (const [why, bytes] of Object.entries(cases)) assert.equal(M.video(Uint8Array.from(bytes)), null, why);
  assert.equal(M.check(Uint8Array.from(mp4.subarray(0, 12)), 'bg'), null);
});

// ---- Lottie -------------------------------------------------------------------------------------------------------------
const good = () => JSON.parse(text('spin.json'));
const layer = (extra = {}) => ({ ddd: 0, ind: 1, ty: 4, nm: 'l', ks: {}, ip: 0, op: 60, st: 0, shapes: [], ...extra });
const withLayers = (layers, extra = {}) => ({ ...good(), layers, ...extra });
const PNG = 'data:image/png;base64,' + fs.readFileSync(path.join(__dirname, '../icons/icon16.png')).toString('base64');

test('Lottie: a real file is cleaned to what draws it, and cleaning twice changes nothing', () => {
  const got = M.lottie(text('spin.json'));
  assert.deepEqual([got.w, got.h, got.frames, got.fr], [200, 120, 60, 30]);
  const again = M.lottie(Buffer.from(got.bytes).toString());
  eq(again.bytes, got.bytes);
  // Keys that do not draw (fonts, glyphs, meta, anything unknown) are not kept.
  const noisy = M.lottie({ ...good(), fonts: { list: [{ fPath: 'https://evil.example/f.woff', fOrigin: 'u' }] }, chars: [], meta: { g: 'tool' }, tgs: 1, props: {}, slots: {} });
  eq(noisy.bytes, got.bytes);
  assert.deepEqual(Object.keys(noisy.json).sort(), ['ddd', 'fr', 'h', 'ip', 'layers', 'markers', 'nm', 'op', 'v', 'w', 'assets'].sort());
});

test('Lottie that reaches out, runs code or can run away is refused', () => {
  const n = (k) => Array.from({ length: k }, () => layer());
  const comp = (id, layers) => ({ id, layers });
  const deep = (d) => { let o = {}; const root = o; for (let i = 0; i < d; i++) { o.a = {}; o = o.a; } return root; };
  const cases = {
    'not an object': 5, array: [good()], null: null, 'invalid json': '{"v":',
    'too big as text': ' '.repeat(M.LIMIT.bg.lottie + 1),
    'expression': withLayers([layer({ ks: { o: { a: 0, k: 100, x: 'var $bm_rt = time * 100;' } } })]),
    'a text layer': withLayers([layer({ ty: 5 })]),
    'an audio layer': withLayers([layer({ ty: 6 })]),
    'an unknown layer type': withLayers([layer({ ty: 99 })]),
    'a layer that is not an object': withLayers([5]),
    'layers not a list': withLayers({}),
    'no layers': { ...good(), layers: undefined },
    '__proto__ key': JSON.parse('{"v":"5","fr":30,"ip":0,"op":30,"w":10,"h":10,"layers":[{"ty":4,"__proto__":{"x":1}}]}'),
    'constructor key': withLayers([layer({ constructor: {} })]),
    'fr 0': { ...good(), fr: 0 }, 'fr 61': { ...good(), fr: 61 }, 'fr not a number': { ...good(), fr: '30' },
    'op before ip': { ...good(), ip: 30, op: 30 }, 'negative ip': { ...good(), ip: -1 },
    'over 3600 frames': { ...good(), fr: 60, op: 3601 },
    'over 60 seconds': { ...good(), fr: 24, op: 1500 },
    'width 0': { ...good(), w: 0 }, 'width 4097': { ...good(), w: 4097 }, 'height not a number': { ...good(), h: 'x' },
    'area over 8 million': { ...good(), w: 4096, h: 2049 },
    'over 500 layers': withLayers(n(501)),
    'over 2000 layers once precomps are counted': withLayers(n(100).map((l) => ({ ...l, ty: 0, refId: 'c' })), { assets: [comp('c', n(30).map((l) => ({ ...l, ty: 0, refId: 'd' }))), comp('d', n(20))] }),
    'a precomp naming itself': withLayers([layer({ ty: 0, refId: 'a' })], { assets: [comp('a', [layer({ ty: 0, refId: 'a' })])] }),
    'two precomps naming each other': withLayers([layer({ ty: 0, refId: 'a' })], { assets: [comp('a', [layer({ ty: 0, refId: 'b' })]), comp('b', [layer({ ty: 0, refId: 'a' })])] }),
    'a precomp that is not there': withLayers([layer({ ty: 0, refId: 'zzz' })]),
    'a precomp without a name': withLayers([layer({ ty: 0 })]),
    'precomps nested 10 deep': withLayers([layer({ ty: 0, refId: 'c0' })], { assets: Array.from({ length: 10 }, (_, i) => comp(`c${i}`, [i < 9 ? layer({ ty: 0, refId: `c${i + 1}` }) : layer()])) }),
    'a picture that is not there': withLayers([layer({ ty: 2, refId: 'img' })]),
    'a picture from a file name': withLayers([layer({ ty: 2, refId: 'img' })], { assets: [{ id: 'img', w: 1, h: 1, p: 'img_0.png', u: 'images/' }] }),
    'a picture from a link': withLayers([layer({ ty: 2, refId: 'img' })], { assets: [{ id: 'img', w: 1, h: 1, p: 'https://evil.example/x.png', u: '', e: 0 }] }),
    'a picture with a base address': withLayers([layer({ ty: 2, refId: 'img' })], { assets: [{ id: 'img', w: 1, h: 1, p: PNG, u: 'https://evil.example/', e: 1 }] }),
    'a picture that is not embedded': withLayers([layer({ ty: 2, refId: 'img' })], { assets: [{ id: 'img', w: 1, h: 1, p: PNG, u: '', e: 0 }] }),
    'a picture that is svg': withLayers([layer({ ty: 2, refId: 'img' })], { assets: [{ id: 'img', w: 1, h: 1, p: 'data:image/svg+xml;base64,PHN2Zy8+', u: '', e: 1 }] }),
    'a picture over the embed limit': withLayers([layer({ ty: 2, refId: 'img' })], { assets: [{ id: 'img', w: 1, h: 1, p: `data:image/png;base64,${'A'.repeat(400000)}`, u: '', e: 1 }] }),
    'the same asset twice': withLayers([layer()], { assets: [comp('a', [layer()]), comp('a', [layer()])] }),
    'an asset that is not an object': withLayers([layer()], { assets: [5] }),
    'assets not a list': withLayers([layer()], { assets: {} }),
    'markers not a list': withLayers([layer()], { markers: {} }),
    'a repeater of 101 copies': withLayers([layer({ shapes: [{ ty: 'rp', c: { a: 0, k: 101 } }] })]),
    'repeaters adding up past 100': withLayers([layer({ shapes: [{ ty: 'rp', c: { a: 0, k: 60 } }, { ty: 'rp', c: { a: 0, k: 60 } }] })]),
    'an animated repeater past 100': withLayers([layer({ shapes: [{ ty: 'rp', c: { a: 1, k: [{ t: 0, s: [5] }, { t: 10, s: [500] }] } }] })]),
    'a repeater with no count': withLayers([layer({ shapes: [{ ty: 'rp' }] })]),
    'a repeater with a negative count': withLayers([layer({ shapes: [{ ty: 'rp', c: { a: 0, k: -1 } }] })]),
    'over 60,000 nodes': withLayers([layer({ ks: { big: Array.from({ length: 60001 }, () => 1) } })]),
    'over 32 levels': withLayers([layer({ ks: deep(40) })]),
    'a long string': withLayers([layer({ nm: 'x'.repeat(513) })]),
  };
  for (const [why, v] of Object.entries(cases)) {
    // Straight to the cleaner, and as the text of a file.
    assert.equal(M.lottie(v), null, why);
    if (v !== undefined && typeof v === 'object' && v !== null && !Array.isArray(v) && JSON.stringify(v).length < M.LIMIT.bg.lottie) assert.equal(M.lottie(JSON.stringify(v)), null, `${why} (as text)`);
  }
  // The limits themselves are allowed.
  assert.ok(M.lottie(withLayers(n(500))), '500 layers');
  assert.ok(M.lottie({ ...good(), fr: 60, op: 3600 }), '3600 frames at 60 a second');
  assert.ok(M.lottie({ ...good(), w: 4096, h: 2048 }), '8 million pixels');
  assert.ok(M.lottie(withLayers([layer({ shapes: [{ ty: 'rp', c: { a: 0, k: 100 } }] })])), 'a repeater of 100');
  assert.ok(M.lottie(withLayers([layer({ ty: 0, refId: 'a' }), layer({ ty: 2, refId: 'img' })], { assets: [comp('a', [layer()]), { id: 'img', w: 1, h: 1, p: PNG, u: '', e: 1 }] })), 'a precomp and an embedded picture');
});

test('a precomp used many times is counted every time, and a ladder of precomps is not walked once per path', () => {
  const layer1 = (extra = {}) => layer(extra);
  // Eight levels of ten layers that each name the next: 10^8 instances in 80 layers.
  const comps = Array.from({ length: 8 }, (_, i) => ({ id: `c${i}`, layers: Array.from({ length: 10 }, () => (i < 7 ? layer1({ ty: 0, refId: `c${i + 1}` }) : layer1())) }));
  assert.equal(M.lottie(withLayers([layer1({ ty: 0, refId: 'c0' })], { assets: comps })), null);
  // 40 levels that each name the next one twice would take 2^40 steps to walk without remembering.
  const ladder = Array.from({ length: 40 }, (_, i) => ({ id: `c${i}`, layers: i < 39 ? [layer1({ ty: 0, refId: `c${i + 1}` }), layer1({ ty: 0, refId: `c${i + 1}` })] : [layer1()] }));
  const t0 = Date.now();
  assert.equal(M.lottie(withLayers([layer1({ ty: 0, refId: 'c0' })], { assets: ladder })), null);
  assert.ok(Date.now() - t0 < 500, 'refused at once');
});

test('Lottie from bytes: UTF-8 text that is JSON, with a byte-order mark and whitespace allowed', () => {
  const enc = (s) => new TextEncoder().encode(s);
  assert.equal(M.check(enc(text('spin.json')), 'bg').type, 'lottie');
  assert.equal(M.check(Uint8Array.from([0xef, 0xbb, 0xbf, ...enc(`\n ${text('spin.json')}`)]), 'bg').type, 'lottie');
  assert.equal(M.check(Uint8Array.from([0xff, 0xfe, 0x7b]), 'bg'), null, 'not UTF-8');
  assert.equal(M.check(enc('[1,2,3]'), 'bg'), null);
  assert.equal(M.check(enc(`{"a":${'1'.repeat(10)}}`), 'bg'), null, 'JSON that is not Lottie');
  assert.equal(M.check(enc(text('spin.json').repeat(1) + ' '.repeat(M.LIMIT.bg.lottie)), 'bg'), null, 'over the limit');
  assert.equal(M.check(enc(text('spin.json')), 'sticker').type, 'lottie');
  assert.equal(M.check(enc(`${text('spin.json').slice(0, -1)},"layers2":"${'x'.repeat(M.LIMIT.sticker.lottie)}"}`), 'sticker'), null, 'a sticker animation is at most 256 KiB');
});

// ---- the files this computer keeps --------------------------------------------------------------------------------------
const area = (data = {}) => ({
  data,
  get: async (keys) => Object.fromEntries((keys === null ? Object.keys(data) : [].concat(keys)).filter((k) => k in data).map((k) => [k, structuredClone(data[k])])),
  set: async (patch) => { Object.assign(data, structuredClone(patch)); return true; },
  remove: async (keys) => { for (const k of [].concat(keys)) delete data[k]; return true; },
});
const b64 = (bytes) => M.std(bytes);

test('put keeps the cleaned file under its own SHA-256, list shows it and drop takes it away', async () => {
  const local = area();
  const r = await M.change({ op: 'put', kind: 'image', b64: b64(fx('anim.webp')) }, { local });
  assert.equal(r.ok, true);
  assert.deepEqual([r.type, r.mime, r.size, r.width, r.height, r.frames], ['image', 'image/webp', 210, 48, 48, 3]);
  assert.equal(r.h, M.b64u(require('node:crypto').createHash('sha256').update(fx('anim.webp')).digest()));
  assert.deepEqual(Object.keys(local.data), [`lookMedia:${r.h}`]);
  assert.equal(M.fileOf(`file:${r.h}`), r.h);
  assert.equal((await M.read(local, r.h)).mime, 'image/webp');
  assert.deepEqual((await M.change({ op: 'list' }, { local })).files, [{ h: r.h, t: 'image/webp', size: 210 }]);
  // The same file again is the same entry.
  assert.equal((await M.change({ op: 'put', kind: 'image', b64: b64(fx('anim.webp')) }, { local })).h, r.h);
  assert.equal(Object.keys(local.data).length, 1);
  assert.deepEqual(await M.change({ op: 'drop', h: r.h }, { local }), { ok: true });
  assert.deepEqual(local.data, {});
  assert.equal(await M.read(local, r.h), null);
});

test('put names a file by what Glaze keeps: a WebP with metadata is stored without it', async () => {
  const local = area();
  const dirty = riff(vp8x(0x08, 16, 16), vp8l(16, 16), chunk('EXIF', [1, 2, 3]));
  const r = await M.change({ op: 'put', kind: 'image', b64: b64(dirty) }, { local });
  assert.equal(r.size, riff(vp8x(0, 16, 16), vp8l(16, 16)).length);
  assert.equal(M.unstd(local.data[`lookMedia:${r.h}`].b).length, r.size);
});

test('put refuses what is not what it says, too big, a wrong kind, or no room', async () => {
  const local = area();
  const put = (m) => M.change({ op: 'put', ...m }, { local });
  assert.equal((await put({ kind: 'video', b64: b64(fx('anim.webp')) })).error, 'type', 'a picture sent as a video');
  assert.equal((await put({ kind: 'image', b64: b64(fx('clip.webm')) })).error, 'type', 'a video sent as a picture');
  assert.equal((await put({ kind: 'lottie', b64: b64(fx('still.webp')) })).error, 'type');
  assert.equal((await put({ kind: 'gif', b64: b64(fx('anim.webp')) })).error, 'bad');
  assert.equal((await put({ kind: 'image' })).error, 'bad');
  assert.equal((await put({ kind: 'image', b64: 5 })).error, 'bad');
  assert.equal((await put({ kind: 'image', b64: 'not base64!!' })).error, 'big');
  assert.equal((await put({ kind: 'image', b64: b64(new Uint8Array(1000)) })).error, 'type');
  assert.equal((await put({ kind: 'image', b64: 'A'.repeat(Math.ceil(M.LIMIT.bg.image.bytes * 4 / 3) + 100) })).error, 'big');
  assert.equal((await put({ kind: 'lottie', b64: 'A'.repeat(Math.ceil(M.LIMIT.bg.lottie * 4 / 3) + 100) })).error, 'big');
  assert.equal((await put({ kind: 'video', b64: 'A'.repeat(Math.ceil(M.LIMIT.bg.video * 4 / 3) + 100) })).error, 'big');
  assert.equal((await M.change({ op: 'nope' }, { local })).error, 'bad');
  assert.equal((await M.change({ op: 'drop', h: 'short' }, { local })).error, 'bad');
  assert.deepEqual(local.data, {}, 'nothing was kept');
  // expect: bytes that are not the file a Look names are not kept.
  assert.equal((await put({ kind: 'image', b64: b64(fx('anim.webp')), expect: 'A'.repeat(43) })).error, 'hash');
  assert.deepEqual(local.data, {});
  const r = await put({ kind: 'image', b64: b64(fx('anim.webp')) });
  assert.equal((await put({ kind: 'image', b64: b64(fx('anim.webp')), expect: r.h })).ok, true);
  // No room: the total of what is kept, less the file being replaced.
  const full = area({ 'lookMedia:other': { t: 'video/webm', b: 'A'.repeat(Math.ceil(M.LIMIT.total * 4 / 3) - 100) } });
  assert.equal((await M.change({ op: 'put', kind: 'image', b64: b64(fx('anim.webp')) }, { local: full })).error, 'full');
  full.data[`lookMedia:${r.h}`] = { t: 'image/webp', b: b64(fx('anim.webp')) };
  assert.equal((await M.change({ op: 'put', kind: 'image', b64: b64(fx('anim.webp')) }, { local: full })).ok, true, 'replacing a file needs no more room');
  const failing = { ...area(), set: async () => false };
  assert.equal((await M.change({ op: 'put', kind: 'image', b64: b64(fx('anim.webp')) }, { local: failing })).error, 'write');
});

test('a kept file is checked again when it is read: by its name, its type and its contents', async () => {
  const local = area();
  const r = await M.change({ op: 'put', kind: 'video', b64: b64(fx('clip.webm')) }, { local });
  const key = `lookMedia:${r.h}`, rec = local.data[key];
  assert.ok(await M.read(local, r.h));
  local.data[key] = { ...rec, t: 'video/mp4' };
  assert.equal(await M.read(local, r.h), null, 'its type is not what it holds');
  local.data[key] = { ...rec, b: M.std(fx('clip.mp4')) };
  assert.equal(await M.read(local, r.h), null, 'another file under this name');
  local.data[key] = { ...rec, b: '!!' };
  assert.equal(await M.read(local, r.h), null);
  local.data[key] = 'text';
  assert.equal(await M.read(local, r.h), null);
  assert.equal(await M.read(local, 'nope'), null);
  assert.equal(await M.read(local, 'A'.repeat(43)), null, 'not there');
  assert.equal(M.fileOf('file:short'), null);
  assert.equal(M.fileOf('https://a.example.com/'), null);
  assert.equal(M.fileOf(5), null);
});

test('lottie: a kept file answers with its cleaned JSON; an address only when allowed, with no redirect, within a size, as Lottie', async () => {
  const local = area();
  const put = await M.change({ op: 'put', kind: 'lottie', b64: b64(fx('spin.json')) }, { local });
  const got = await M.change({ op: 'lottie', src: `file:${put.h}` }, { local });
  assert.equal(got.ok, true);
  assert.equal(got.json.w, 200);
  assert.equal((await M.change({ op: 'lottie', src: `file:${'A'.repeat(43)}` }, { local })).error, 'missing');
  const video = await M.change({ op: 'put', kind: 'video', b64: b64(fx('clip.webm')) }, { local });
  assert.equal((await M.change({ op: 'lottie', src: `file:${video.h}` }, { local })).error, 'missing', 'a video is not an animation');

  const url = 'https://cdn.example.com/anim.json';
  const calls = [];
  const response = (body, init = {}) => {
    const bytes = new TextEncoder().encode(body);
    return { ok: init.ok ?? true, status: init.status ?? 200, type: init.type ?? 'basic', headers: new Headers(init.headers), body: new Response(bytes).body };
  };
  const run = (src, reply, allow = async () => true) => M.change({ op: 'lottie', src }, { local }, { allow, fetch: async (u, i) => { calls.push([u, i]); if (reply instanceof Error) throw reply; return reply; } });
  const fine = await run(url, response(text('spin.json')));
  assert.equal(fine.ok, true);
  assert.deepEqual(calls[0][0], url);
  assert.deepEqual([calls[0][1].credentials, calls[0][1].redirect, calls[0][1].referrerPolicy, calls[0][1].method], ['omit', 'manual', 'no-referrer', 'GET']);
  const n = calls.length;
  assert.equal((await run(url, response(text('spin.json')), async () => false)).error, 'bad', 'an address the worn Look does not name');
  assert.equal(calls.length, n, 'and nothing is fetched for it');
  assert.equal((await run('http://cdn.example.com/a.json', response('{}'))).error, 'bad', 'not https');
  assert.equal((await run('https://127.0.0.1/a.json', response('{}'))).error, 'bad', 'not a public host');
  assert.equal((await run('https://CDN.example.com/a.json', response('{}'))).error, 'bad', 'only an address as it is cleaned');
  assert.equal((await run(url, response('', { status: 302, type: 'opaqueredirect' }))).error, 'network', 'a redirect is not followed');
  assert.equal((await run(url, response('', { status: 301, headers: { location: 'https://evil.example/' } }))).error, 'network');
  assert.equal((await run(url, response('x', { ok: false, status: 404 }))).error, 'network');
  assert.equal((await run(url, new Error('offline'))).error, 'network');
  assert.equal((await run(url, response('x', { headers: { 'content-length': String(M.LIMIT.bg.lottie + 1) } }))).error, 'big');
  assert.equal((await run(url, response(' '.repeat(M.LIMIT.bg.lottie + 10)))).error, 'big', 'a body past the limit with no length given');
  assert.equal((await run(url, response('{"not":"lottie"}'))).error, 'type');
  assert.equal((await run(url, response('<html>'))).error, 'type');
  assert.equal((await run(url, response(JSON.stringify({ ...good(), layers: [layer({ ty: 5 })] })))).error, 'type', 'a text layer');
  assert.equal((await M.change({ op: 'lottie', src: url }, { local }, { allow: async () => true })).error, 'bad', 'no fetch given');
});

test('check refuses what is not a media file, and the limits for a sticker are tighter than for a background', () => {
  assert.equal(M.check(null), null);
  assert.equal(M.check('text'), null);
  assert.equal(M.check(new Uint8Array()), null);
  assert.equal(M.check(fx('anim.webp'), 'sticker').type, 'image');
  assert.equal(M.check(new Uint8Array(M.LIMIT.sticker.image.bytes + 1).fill(0), 'sticker'), null);
  // A WebP past the sticker's byte limit but inside a background's.
  const big = riff(vp8x(0, 16, 16), vp8l(16, 16), chunk('ALPH', new Uint8Array(M.LIMIT.sticker.image.bytes)));
  assert.equal(M.check(big, 'sticker'), null);
});

// ---- the vendored player ------------------------------------------------------------------------------------------------
test('the Lottie player in lib/lottie/ is the pinned official light canvas build, unmodified under its one comment line, with its licence', () => {
  const crypto = require('node:crypto');
  const script = fs.readFileSync(path.join(__dirname, '../scripts/vendor-lottie.sh'), 'utf8');
  const version = /^version=(\S+)$/m.exec(script)[1], pinned = /^file_sha256=([0-9a-f]{64})$/m.exec(script)[1];
  const file = fs.readFileSync(path.join(__dirname, '../lib/lottie/lottie_light_canvas.min.js'), 'utf8');
  const [header, ...rest] = file.split('\n');
  assert.equal(header, `// lottie-web ${version} light canvas build (MIT, lib/lottie/LICENSE), as published, after this line. Fetched by scripts/vendor-lottie.sh.`);
  assert.equal(crypto.createHash('sha256').update(rest.join('\n')).digest('hex'), pinned, 'the file is the build the script pins');
  assert.match(/^tarball_sha256=([0-9a-f]{64})$/m.exec(script)[1], /^[0-9a-f]{64}$/);
  assert.match(fs.readFileSync(path.join(__dirname, '../lib/lottie/LICENSE'), 'utf8'), /^\s*The MIT License \(MIT\)/);
  // The light build has no expressions: nothing in it turns text into code, and it fetches or imports nothing of its own accord.
  assert.doesNotMatch(file, /\beval\s*\(|new\s+Function\s*\(|\bFunction\s*\(\s*["'`]|importScripts|\bimport\s*\(/);
  assert.match(file, /runExpressions/, 'it is the build that knows expressions exist, and leaves them out');
  assert.doesNotMatch(file, /\bevalExpression|\bExpressionManager\b/);
});

test('the page may load the player and the media module, and the first script loads neither', () => {
  const manifest = require('../manifest.json');
  const web = manifest.web_accessible_resources.flatMap((e) => e.resources);
  for (const f of ['lib/scene-media.js', 'lib/lottie/lottie_light_canvas.min.js']) {
    assert.ok(web.includes(f), `${f} is web-accessible`);
    assert.ok(fs.existsSync(path.join(__dirname, '..', f)), `${f} exists`);
    assert.ok(!manifest.content_scripts.some((c) => c.js.includes(f)), `${f} is not in a content script's list`);
  }
  const content = fs.readFileSync(path.join(__dirname, '../content.js'), 'utf8');
  assert.ok(!/lottie/i.test(content), 'content.js does not know Lottie');
  assert.match(content, /import\(chrome\.runtime\.getURL\(file\)\)/);
});


test('Lottie bounds multiplied repeaters, animated endpoints, stars and parent chains before the player sees them', () => {
  const repeat = (n) => ({ ty: 'rp', c: { a: 0, k: n } });
  for (const shapes of [
    [repeat(10), repeat(11)],
    [{ ty: 'gr', it: [repeat(11)] }, repeat(10)],
    [{ ty: 'rp', c: { a: 1, k: [{ t: 0, s: [1], e: [1000000] }, { t: 30, s: [1] }] } }],
    [{ ty: 'sr', pt: { a: 0, k: 1000000 } }],
    [{ ty: 'sr', pt: { a: 1, k: [{ t: 0, s: [5], e: [1000000] }, { t: 30, s: [5] }] } }],
  ]) assert.equal(M.lottie(withLayers([layer({ shapes })])), null);
  assert.equal(M.lottie(withLayers([layer({ ind: 1, parent: 1 })])), null);
  assert.equal(M.lottie(withLayers([layer({ ind: 1, parent: 2 }), layer({ ind: 2, parent: 1 })])), null);
  assert.equal(M.lottie(withLayers(Array.from({ length: 30 }, (_, ind) => layer({ ind, ty: 0, refId: 'copies' })), {
    assets: [{ id: 'copies', layers: [layer({ shapes: [repeat(100)] })] }],
  })), null, 'a precomp repeats its repeaters on every use');
  assert.ok(M.lottie(withLayers([layer({ shapes: [repeat(10), repeat(10)] })])));
  assert.ok(M.lottie(withLayers([layer({ ind: 1 }), layer({ ind: 2, parent: 1 })])));
});

test('put returns a refusal for base64 with an impossible length', async () => {
  const local = area();
  assert.equal((await M.change({ op: 'put', kind: 'image', b64: 'A' }, { local })).ok, false);
  assert.deepEqual(local.data, {});
});

test('a kept Lottie cannot bypass cleaning by naming unclean bytes with their own hash', async () => {
  const bytes = new TextEncoder().encode(JSON.stringify({ ...good(), fonts: { list: [{ fPath: 'https://evil.example/f.woff', fOrigin: 'u' }] } }));
  const h = await M.sha(bytes), local = area({ [`lookMedia:${h}`]: { t: 'application/json', b: b64(bytes) } });
  const r = await M.change({ op: 'lottie', src: `file:${h}` }, { local });
  assert.equal(r.json?.fonts, undefined);
  if (r.ok) assert.equal(await M.sha(new TextEncoder().encode(JSON.stringify(r.json))), h);
});

test('PNG stickers are accepted, bounded and stripped of metadata before display', () => {
  const png = new Uint8Array(fs.readFileSync(path.join(__dirname, '../icons/icon16.png')));
  const got = M.check(png, 'sticker');
  assert.deepEqual([got?.type, got?.mime, got?.w, got?.h, got?.animated], ['image', 'image/png', 16, 16, false]);
  const crc = require('../lib/zip.js').crc32;
  const part = (id, bytes) => Uint8Array.from([...be(bytes.length), ...ascii(id), ...bytes, ...be(crc(Uint8Array.from([...ascii(id), ...bytes])))]);
  const textChunk = part('tEXt', ascii('Comment\0private information'));
  const dirty = Uint8Array.from([...png.subarray(0, 33), ...textChunk, ...png.subarray(33)]);
  const clean = M.check(dirty, 'sticker');
  assert.ok(clean);
  assert.equal(Buffer.from(clean.bytes).includes('private information'), false);
  eq(M.check(clean.bytes, 'sticker').bytes, clean.bytes);
  assert.equal(M.check(png.subarray(0, png.length - 1), 'sticker'), null);
  const huge = png.slice();
  huge.set(be(100000), 16);
  assert.equal(M.check(huge, 'sticker'), null);
  const apng = Uint8Array.from([...png.subarray(0, 33), ...part('acTL', [...be(100000), ...be(0)]), ...png.subarray(33)]);
  assert.equal(M.check(apng, 'sticker'), null, 'APNG cannot bypass the animation limits');
});

test('embedded Lottie pictures use their real bounded dimensions and are cleaned before loading', () => {
  const png = new Uint8Array(fs.readFileSync(path.join(__dirname, '../icons/icon16.png')));
  const picture = (bytes, mime = 'png') => withLayers([layer({ ty: 2, refId: 'image' })], { assets: [{ id: 'image', w: 1, h: 1, e: 1, p: `data:image/${mime};base64,${b64(bytes)}` }] });
  const huge = png.slice();
  huge.set(be(100000), 16);
  assert.equal(M.lottie(picture(huge)), null, 'a tiny compressed input cannot allocate an enormous bitmap');
  assert.equal(M.lottie(picture(fx('anim.webp'), 'webp')), null, 'an embedded animation cannot run past motion off');
  const got = M.lottie(picture(png));
  assert.ok(got);
  assert.deepEqual([got.json.assets[0].w, got.json.assets[0].h], [16, 16]);
  const secret = Buffer.from('private text');
  const crc = require('../lib/zip.js').crc32;
  const chunk = Uint8Array.from([...be(secret.length), ...ascii('tEXt'), ...secret, ...be(crc(Uint8Array.from([...ascii('tEXt'), ...secret])))]);
  const dirty = Uint8Array.from([...png.subarray(0, 33), ...chunk, ...png.subarray(33)]);
  const clean = M.lottie(picture(dirty));
  assert.ok(clean);
  assert.equal(Buffer.from(clean.json.assets[0].p.split(',')[1], 'base64').includes('private text'), false);
});


test('embedded JPEGs keep their pixels and drop metadata between scans', () => {
  const bytes = fx('../import/timetable-photo.jpg');
  const picture = (bytes) => withLayers([layer({ ty: 2, refId: 'image' })], { assets: [{ id: 'image', e: 1, p: `data:image/jpeg;base64,${b64(bytes)}` }] });
  const segment = Uint8Array.from([0xff, 0xfe, 0, 8, ...ascii('secret')]);
  const dirty = Uint8Array.from([...bytes.subarray(0, -2), ...segment, ...bytes.subarray(-2)]);
  const got = M.lottie(picture(dirty));
  assert.ok(got);
  assert.deepEqual([got.json.assets[0].w, got.json.assets[0].h], [860, 600]);
  assert.equal(Buffer.from(got.json.assets[0].p.split(',')[1], 'base64').includes('secret'), false);
  eq(M.lottie(JSON.stringify(got.json)).bytes, got.bytes);
  assert.equal(M.lottie(picture(bytes.subarray(0, -1))), null);
});

test('AVIF refuses malformed sibling boxes instead of skipping them beside a valid extent', () => {
  const bad = [0, 0, 1, 0, ...ascii('iprp')];
  const bytes = Uint8Array.from([...ftyp('avif'), ...meta(box('iprp', box('ipco', ispe(16, 16))), box('iprp', bad))]);
  assert.equal(M.avif(bytes, M.LIMIT.sticker.image), null);
  const shortExtent = Uint8Array.from([...ftyp('avif'), ...meta(box('iprp', box('ipco', ispe(16, 16), box('ispe', 0, 0, 0, 0))))]);
  assert.equal(M.avif(shortExtent, M.LIMIT.sticker.image), null);
});

test('MP4 validates nested movie boxes and sample dimensions before accepting the file', () => {
  const real = fx('clip.mp4');
  const at = Buffer.from(real).indexOf(Buffer.from('trak')) - 4;
  const malformed = real.slice(); malformed.set(be(real.length), at);
  assert.equal(M.video(malformed), null, 'a track cannot exceed moov');
  const huge = real.slice(), sample = Buffer.from(huge).lastIndexOf(Buffer.from('avc1')) - 4;
  huge.set([0x13, 0x88], sample + 32);
  assert.equal(M.video(huge), null, 'a sample description cannot request a 5000-pixel side');
  assert.equal(M.video(Uint8Array.from([...ftyp('isom'), ...box('moov')])), null, 'an empty movie is not a video');
  const avif = fx('anim.avif'), av01 = Buffer.from(avif).lastIndexOf(Buffer.from('av01')) - 4;
  assert.ok(av01 > 0);
  avif.set([0x13, 0x88], av01 + 32);
  assert.equal(M.avif(avif, M.LIMIT.sticker.image), null, 'the AVIF sequence track is bounded independently of its primary image');
});

test('Lottie bounds the total decoded pixels of all embedded pictures', () => {
  const bytes = new Uint8Array(fs.readFileSync(path.join(__dirname, '../icons/icon16.png')));
  bytes.set(be(4096), 16); bytes.set(be(2048), 20);
  const image = (id) => ({ id, e: 1, p: `data:image/png;base64,${b64(bytes)}` });
  assert.ok(M.lottie(withLayers([], { assets: [image('one')] })));
  assert.equal(M.lottie(withLayers([], { assets: [image('one'), image('two')] })), null);
});

test('unused precomps cannot evade cycle and expansion limits through the player extra-composition flag', () => {
  const comp = { id: 'loop', xt: true, layers: [layer({ ty: 0, refId: 'loop' })] };
  assert.equal(M.lottie(withLayers([], { assets: [comp] })), null);
  const assets = Array.from({ length: 8 }, (_, i) => ({ id: `extra${i}`, xt: true, layers: Array.from({ length: 10 }, () => i < 7 ? layer({ ty: 0, refId: `extra${i + 1}` }) : layer()) }));
  assert.equal(M.lottie(withLayers([], { assets })), null);
  const many = [{ id: 'payload', layers: Array.from({ length: 32 }, () => layer()) }, ...Array.from({ length: 63 }, (_, i) => ({ id: `extra${i}`, xt: true, layers: [layer({ ty: 0, refId: 'payload' })] }))];
  assert.equal(M.lottie(withLayers([], { assets: many })), null, 'extra compositions count together, including their reused layers');
});

test('AVIF bounds the aggregate property tree before collecting dimensions', () => {
  const iso = (type, body) => Buffer.concat([Buffer.from(be(body.length + 8)), Buffer.from(type), body]);
  const properties = iso('ipco', Buffer.concat(Array(4096).fill(Buffer.from(ispe(16, 16)))));
  const iprp = iso('iprp', Buffer.concat(Array(32).fill(properties)));
  const bytes = new Uint8Array(Buffer.concat([Buffer.from(ftyp('avif')), iso('meta', Buffer.concat([Buffer.alloc(4), iprp]))]));
  assert.equal(M.avif(bytes, M.LIMIT.bg.image), null);
});
