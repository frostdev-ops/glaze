// Videos and AVIF pictures are kept and shared without the details a phone or an editor puts in them (LOOK-11): where it was shot, what
// shot it, when, who named the track, the program that wrote the file. They are not decoded or rebuilt, so the containers around the
// stream are cleaned in place (lib/media.js "metadata"): the file keeps its length, nothing in it moves, and cleaning twice changes
// nothing more. Each format is tried on real encoder output that carries metadata (test/fixtures/media/meta.*: an MP4 with user data,
// a Quick Time style meta box, a creation time, a GPS box and a subtitle track whose text is a position; a WebM with a title, dates and
// tags; an AVIF still with Exif and XMP items) and on files built to be taken apart wrongly.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const M = require('../lib/media.js');

const fx = (f) => new Uint8Array(fs.readFileSync(path.join(__dirname, 'fixtures/media', f)));
const text = (b) => Buffer.from(b).toString('latin1');
const four = (b, i) => text(b.subarray(i, i + 4));
const u32 = (b, i) => Buffer.from(b).readUInt32BE(i);
const u16 = (b, i) => Buffer.from(b).readUInt16BE(i);
const eq = (a, b, why) => assert.deepEqual(Buffer.from(a), Buffer.from(b), why);
const sha = (b) => crypto.createHash('sha256').update(b).digest('base64url');
const SECRETS = /SECRET|37\.7749|Lavf|Lavc|2020-02/;

// A small box reader that is not the module's: the children of a box between from and to, as { type, start, at, end }.
const kids = (b, from = 0, to = b.length) => {
  const out = [];
  for (let i = from; i < to;) {
    const size = u32(b, i);
    out.push({ type: four(b, i + 4), start: i, at: i + 8, end: i + size });
    i += size;
  }
  return out;
};
const child = (b, box, type, skip = 0) => kids(b, box.at + skip, box.end).filter((k) => k.type === type);
const top = (b, type) => kids(b).filter((k) => k.type === type);
const moov = (b) => top(b, 'moov')[0];
const tracks = (b) => child(b, moov(b), 'trak');
const handler = (b, trak) => { const h = child(b, child(b, trak, 'mdia')[0], 'hdlr')[0]; return four(b, h.at + 8); };
// Where a track's samples are, by its own tables: [offset, size] of each sample.
const samples = (b, trak) => {
  const stbl = child(b, child(b, child(b, trak, 'mdia')[0], 'minf')[0], 'stbl')[0];
  const [stsc] = child(b, stbl, 'stsc'), [stsz] = child(b, stbl, 'stsz'), [stco] = child(b, stbl, 'stco');
  const runs = Array.from({ length: u32(b, stsc.at + 4) }, (_, i) => [u32(b, stsc.at + 8 + i * 12), u32(b, stsc.at + 12 + i * 12)]);
  const out = [];
  let n = 0;
  for (let c = 1; c <= u32(b, stco.at + 4); c++) {
    const per = runs.filter(([first]) => first <= c).at(-1)[1];
    let off = u32(b, stco.at + 8 + (c - 1) * 4);
    for (let i = 0; i < per; i++, n++) { const size = u32(b, stsz.at + 4) || u32(b, stsz.at + 12 + n * 4); out.push([off, size]); off += size; }
  }
  return out;
};
const bytesAt = (b, ranges) => Buffer.concat(ranges.map(([at, size]) => Buffer.from(b.subarray(at, at + size))));
const put32 = (n) => [(n >>> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255];
const box = (type, ...payload) => { const body = payload.flat(); return [...put32(body.length + 8), ...Buffer.from(type, 'latin1'), ...body]; };
const cat = (...parts) => Uint8Array.from(parts.flatMap((p) => [...p]));

// ---- MP4 ----------------------------------------------------------------------------------------------------------------------
test('the MP4 fixture really carries what is to be taken out', () => {
  const b = fx('meta.mp4');
  assert.match(text(b), /SECRETHANDLER/);
  assert.match(text(b), /SECRETTITLE/);
  assert.deepEqual(kids(b, moov(b).at, moov(b).end).map((k) => k.type), ['mvhd', 'trak', 'trak', 'udta']);
  assert.deepEqual(tracks(b).map((t) => handler(b, t)), ['vide', 'sbtl'], 'a picture and a subtitle track whose text is a position');
  const sub = bytesAt(b, samples(b, tracks(b)[1]));
  assert.match(text(sub), /GPS 37\.7749,-122\.4194/);
  assert.ok(child(b, child(b, moov(b), 'udta')[0], 'loci').length, 'and a GPS box');
  assert.notEqual(u32(b, child(b, moov(b), 'mvhd')[0].at + 4), 0, 'with a creation time');
});

test('an MP4 comes back with its user data, names, times, GPS and subtitle track gone, and the picture untouched', () => {
  const b = fx('meta.mp4'), got = M.check(b, 'bg');
  assert.deepEqual([got.type, got.mime], ['video', 'video/mp4']);
  const c = got.bytes;
  assert.equal(c.length, b.length, 'the same length: nothing moved');
  assert.doesNotMatch(text(c), SECRETS);
  assert.doesNotMatch(text(c), /loci|udta|ilst|©nam|©too/);
  // Only a movie and its picture track are left, and the box that held the rest is free space of the same size.
  assert.deepEqual(kids(c, moov(c).at, moov(c).end).map((k) => k.type), ['mvhd', 'trak', 'free', 'free']);
  assert.deepEqual(tracks(c).map((t) => handler(c, t)), ['vide']);
  assert.deepEqual(kids(c).map((k) => [k.type, k.end - k.start]), kids(b).map((k) => [k.type, k.end - k.start]), 'every top-level box is where it was');
  eq(c.subarray(0, 32), b.subarray(0, 32), 'the file type is the file type');
  // The video's own boxes (its sample tables and every sample) are as they were, except its names and times.
  const [v0, v1] = [tracks(b)[0], tracks(c)[0]];
  eq(bytesAt(c, samples(c, v1)), bytesAt(b, samples(b, v0)), 'every video sample');
  const stbl = (x, t) => child(x, child(x, child(x, t, 'mdia')[0], 'minf')[0], 'stbl')[0];
  for (const name of ['stts', 'stss', 'stsc', 'stsz', 'stco']) {
    const [p, q] = [child(b, stbl(b, v0), name)[0], child(c, stbl(c, v1), name)[0]];
    eq(c.subarray(q.start, q.end), b.subarray(p.start, p.end), name);
  }
  // Times are zero, and so are the handler's name and the compressor's.
  const mvhd = child(c, moov(c), 'mvhd')[0], tkhd = child(c, v1, 'tkhd')[0], mdhd = child(c, child(c, v1, 'mdia')[0], 'mdhd')[0];
  for (const x of [mvhd, tkhd, mdhd]) assert.deepEqual([u32(c, x.at + 4), u32(c, x.at + 8)], [0, 0], x.type);
  const hdlr = child(c, child(c, v1, 'mdia')[0], 'hdlr')[0];
  assert.equal(four(c, hdlr.at + 8), 'vide');
  assert.ok(c.subarray(hdlr.at + 24, hdlr.end).every((x) => x === 0), 'no handler name');
  const entry = kids(c, child(c, stbl(c, v1), 'stsd')[0].at + 8, child(c, stbl(c, v1), 'stsd')[0].end)[0];
  assert.ok(c.subarray(entry.at + 42, entry.at + 74).every((x) => x === 0), 'no compressor name');
  assert.equal(four(c, entry.start + 4), 'avc1', 'and it is still H.264 in its sample entry');
  // The dropped track's samples were set to zero in the data.
  for (const [at, size] of samples(b, tracks(b)[1])) assert.ok(c.subarray(at, at + size).every((x) => x === 0), 'the subtitle text is gone from the data');
});

test('cleaning an MP4 twice changes nothing, so a kept file keeps its name', () => {
  const once = M.check(fx('meta.mp4'), 'bg').bytes;
  eq(M.check(once, 'bg').bytes, once);
  assert.equal(sha(M.check(once, 'bg').bytes), sha(once));
  // A file with nothing to take out is returned as it is.
  const clean = M.check(fx('clip.mp4'), 'bg').bytes;
  eq(M.check(clean, 'bg').bytes, clean);
});

test('boxes after the data, and every kind of box that is not the movie, are set to free space', () => {
  const b = fx('meta.mp4');
  const xmp = box('uuid', [0xbe, 0x7a, 0xcf, 0xcb, 0x97, 0xa9, 0x42, 0xe8, 0x9c, 0x71, 0x99, 0x94, 0x91, 0xe3, 0xaf, 0xac], Buffer.from('<x:xmpmeta SECRETXMP gps="37.7749"/>'));
  const tail = cat(b, xmp, box('meta', [0, 0, 0, 0], box('xml ', Buffer.from('SECRETXML'))), box('free', Buffer.from('SECRETLEFTOVER')), box('skip', Buffer.from('SECRETSKIP')), box('wide'), box('Exif', Buffer.from('SECRETEXIF')), box('XMP_', Buffer.from('SECRETXMP2')));
  assert.ok(M.video(tail), 'a movie the reader accepts');
  const got = M.check(tail, 'bg');
  assert.equal(got.bytes.length, tail.length);
  assert.doesNotMatch(text(got.bytes), /SECRET/);
  assert.deepEqual(kids(got.bytes).map((k) => k.type), ['ftyp', 'moov', 'free', 'mdat', 'free', 'free', 'free', 'free', 'free', 'free', 'free']);
  eq(got.bytes.subarray(0, b.length), M.check(b, 'bg').bytes, 'and the movie in front is cleaned as before');
});

test('a track that is not a picture or sound loses its samples whatever it is called', () => {
  const b = Buffer.from(fx('meta.mp4'));
  const h = child(b, child(b, tracks(b)[1], 'mdia')[0], 'hdlr')[0];
  for (const kind of ['meta', 'text', 'sbtl', 'tmcd', 'gpmd', 'mebx', 'hint', 'data']) {
    const t = Uint8Array.from(b);
    t.set(Buffer.from(kind.padEnd(4, ' ')), h.at + 8);
    const c = M.check(t, 'bg').bytes;
    assert.deepEqual(tracks(c).map((x) => handler(c, x)), ['vide'], kind);
    assert.doesNotMatch(text(c), /GPS 37/, kind);
  }
  // A handler label alone cannot turn subtitle samples into sound.
  const sound = Uint8Array.from(b);
  sound.set(Buffer.from('soun'), h.at + 8);
  assert.equal(M.examine(sound, 'bg').error, 'meta', 'tx3g is not an audio sample entry');
});

test('a movie that cannot be taken apart safely is refused, not kept with its metadata', () => {
  const b = fx('meta.mp4');
  const at = (bytes, find, nth = 0) => { let i = -1; for (let n = 0; n <= nth; n++) i = Buffer.from(bytes).indexOf(find, i + 1); assert.ok(i >= 0, String(find)); return i; };
  const patched = (f) => { const t = Uint8Array.from(b); f(t); return t; };
  const refused = (bytes, why) => {
    assert.ok(M.video(bytes), `${why}: an MP4 the reader accepts`);
    const seen = M.examine(bytes, 'bg');
    assert.deepEqual([seen.got, seen.error, seen.type], [undefined, 'meta', 'video'], why);
    assert.equal(M.check(bytes, 'bg'), null, why);
  };
  refused(cat(b, box('moof', box('mfhd', [0, 0, 0, 0], put32(1)))), 'a movie in fragments with a track to take out');
  refused(patched((t) => { t[at(t, 'url ') + 7] = 0; }), 'data kept in another file');
  refused(patched((t) => { const sub = tracks(t)[1], z = child(t, child(t, child(t, sub, 'mdia')[0], 'minf')[0], 'stbl')[0], co = child(t, z, 'stco')[0]; t.set(put32(40), co.at + 8); }), 'a subtitle chunk that is not in the data');
  refused(patched((t) => { const sub = tracks(t)[1], z = child(t, child(t, child(t, sub, 'mdia')[0], 'minf')[0], 'stbl')[0], sz = child(t, z, 'stsz')[0]; t.set(put32(9999), sz.at + 8); }), 'more samples than the table lists');
  refused(patched((t) => { const sub = tracks(t)[1], z = child(t, child(t, child(t, sub, 'mdia')[0], 'minf')[0], 'stbl')[0]; t.set(Buffer.from('stz2'), child(t, z, 'stsz')[0].start + 4); }), 'a compact sample table');
  // put says so by name, and keeps nothing.
});

test('every track gone leaves nothing to play, so it is refused', () => {
  const t = Uint8Array.from(fx('meta.mp4'));
  for (const trak of tracks(t)) t.set(Buffer.from('meta'), child(t, child(t, trak, 'mdia')[0], 'hdlr')[0].at + 8);
  assert.equal(M.examine(t, 'bg').error, 'meta');
});

test('fixed-size timed metadata samples cannot make a tiny file run billions of loop iterations', () => {
  const b = fx('meta.mp4'), sub = tracks(b)[1], stbl = child(b, child(b, child(b, sub, 'mdia')[0], 'minf')[0], 'stbl')[0];
  const sz = child(b, stbl, 'stsz')[0], sc = child(b, stbl, 'stsc')[0];
  b.set(put32(1), sz.at + 4);
  b.set(put32(0xffffffff), sz.at + 8);
  b.set(put32(0xffffffff), sc.at + 12);
  const script = `const M = require(${JSON.stringify(require.resolve('../lib/media.js'))}); process.stdout.write(String(M.check(new Uint8Array(Buffer.from(process.argv[1], 'base64')), 'bg')));`;
  const r = spawnSync(process.execPath, ['-e', script, Buffer.from(b).toString('base64')], { timeout: 750, encoding: 'utf8' });
  assert.equal(r.signal, null, 'the parser must finish without an attacker-controlled sample loop');
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, 'null');
});

test('metadata in a visual sample extension is removed rather than handed to the recipient', () => {
  const b = fx('meta.mp4'), tr = tracks(b)[0], stbl = child(b, child(b, child(b, tr, 'mdia')[0], 'minf')[0], 'stbl')[0];
  const sd = child(b, stbl, 'stsd')[0], entry = kids(b, sd.at + 8, sd.end)[0], codec = kids(b, entry.at + 78, entry.end)[0];
  b.set(Buffer.from('uuid'), codec.start + 4);
  b.fill(0, codec.at, codec.end);
  b.set(Buffer.from('SECRETLOCATION'), codec.at);
  const got = M.check(b, 'bg');
  assert.ok(!got || !text(got.bytes).includes('SECRETLOCATION'));
});

test('a timed metadata track with a missing handler cannot retain its private samples', () => {
  const b = fx('meta.mp4'), sub = tracks(b)[1], hd = child(b, child(b, sub, 'mdia')[0], 'hdlr')[0];
  b.set(Buffer.from('free'), hd.start + 4);
  const got = M.check(b, 'bg');
  assert.ok(!got || !text(got.bytes).includes('GPS 37'));
});

test('metadata in audio sample extensions is removed too', () => {
  const b = fx('meta.mp4'), tr = tracks(b)[0], mdia = child(b, tr, 'mdia')[0], hd = child(b, mdia, 'hdlr')[0];
  b.set(Buffer.from('soun'), hd.at + 8);
  const stbl = child(b, child(b, mdia, 'minf')[0], 'stbl')[0], sd = child(b, stbl, 'stsd')[0], entry = kids(b, sd.at + 8, sd.end)[0];
  b.set(Buffer.from('mp4a'), entry.start + 4);
  b.fill(0, entry.at + 8, entry.at + 28);
  b.set(put32(entry.end - entry.at - 28), entry.at + 28);
  b.set(Buffer.from('uuidSECRETDEVICE'), entry.at + 32);
  const got = M.check(b, 'bg');
  assert.ok(!got || !text(got.bytes).includes('SECRETDEVICE'));
});

// ---- WebM ---------------------------------------------------------------------------------------------------------------------
// A Matroska element read the plain way: { id (hex text), start, at, end } of the children between from and to.
const ebml = (b, from = 0, to = b.length) => {
  const out = [];
  for (let i = from; i < to;) {
    let n = 1;
    while (!(b[i] & (128 >> (n - 1)))) n++;
    const id = Buffer.from(b.subarray(i, i + n)).toString('hex');
    let m = 1;
    while (!(b[i + n] & (128 >> (m - 1)))) m++;
    let size = b[i + n] & ((128 >> (m - 1)) - 1);
    for (let j = 1; j < m; j++) size = size * 256 + b[i + n + j];
    const at = i + n + m;
    out.push({ id, start: i, at, end: at + size });
    i = at + size;
  }
  return out;
};
const segment = (b) => { const s = ebml(b).find((e) => e.id === '18538067'); return { ...s, kids: ebml(b, s.at, s.end) }; };
const ids = (b, from, to) => ebml(b, from, to).map((e) => e.id);
const voidOver = (b, e) => b[e.start] === 0xec && b.subarray(e.at, e.end).every((x) => x === 0);

test('the WebM fixture really carries what is to be taken out', () => {
  const b = fx('meta.webm');
  for (const s of ['SECRETTITLE', 'SECRETTRACK', 'SECRETMAKER', 'SECRETHANDLER', '+37.7749-122.4194/', 'Lavf']) assert.ok(text(b).includes(s), s);
  const seg = segment(b);
  assert.ok(seg.kids.some((k) => k.id === '1254c367'), 'tags');
  assert.ok(ids(b, seg.kids.find((k) => k.id === '1549a966').at, seg.kids.find((k) => k.id === '1549a966').end).includes('4461'), 'a date');
});

test('a WebM comes back without its title, dates, tags, track names and the program that wrote it, and plays as before', () => {
  const b = fx('meta.webm'), got = M.check(b, 'bg');
  assert.deepEqual([got.type, got.mime], ['video', 'video/webm']);
  const c = got.bytes;
  assert.equal(c.length, b.length);
  assert.doesNotMatch(text(c), SECRETS);
  const [s0, s1] = [segment(b), segment(c)];
  // Every element is where it was; the tags are a Void of their size.
  assert.deepEqual(s1.kids.map((k) => [k.start, k.end]), s0.kids.map((k) => [k.start, k.end]));
  const was = (id) => s0.kids.find((k) => k.id === id), now = (k) => s1.kids.find((x) => x.start === k.start);
  assert.ok(voidOver(c, now(was('1254c367'))), 'tags');
  for (const id of ['114d9b74', '1f43b675', '1c53bb6b']) eq(c.subarray(was(id).start, was(id).end), b.subarray(was(id).start, was(id).end), `${id} (seek head, cluster, cues) is as it was`);
  // Info keeps its clock and duration; the title and the date go, the two program names stay with nothing in them.
  const info0 = was('1549a966'), info = now(info0);
  const parts = ebml(c, info.at, info.end), parts0 = ebml(b, info0.at, info0.end);
  assert.deepEqual(parts.map((p) => p.id), parts0.map((p) => (['7ba9', '4461'].includes(p.id) ? 'ec' : p.id)));
  for (const p of parts0.filter((x) => ['2ad7b1', '4489'].includes(x.id))) eq(c.subarray(p.start, p.end), b.subarray(p.start, p.end), p.id);
  for (const p of parts.filter((x) => ['4d80', '5741'].includes(x.id))) assert.ok(c.subarray(p.at, p.end).every((x) => x === 0), `${p.id} holds nothing`);
  // The track keeps how it plays and loses its name.
  const trk0 = ebml(b, was('1654ae6b').at, was('1654ae6b').end)[0], trk = ebml(c, trk0.at, trk0.end);
  assert.ok(!trk.some((e) => e.id === '536e'), 'no track name');
  for (const e of ebml(b, trk0.at, trk0.end).filter((x) => ['86', '83', 'd7', 'e0'].includes(x.id))) eq(c.subarray(e.start, e.end), b.subarray(e.start, e.end), e.id);
});

test('cleaning a WebM twice changes nothing', () => {
  const once = M.check(fx('meta.webm'), 'bg').bytes;
  eq(M.check(once, 'bg').bytes, once);
});

test('WebM with a non-AV track is refused when its private block data cannot be scrubbed safely', () => {
  const b = fx('meta.webm'), seg = segment(b), tracks = seg.kids.find((e) => e.id === '1654ae6b');
  const entry = ebml(b, tracks.at, tracks.end)[0], copy = b.slice(entry.start, entry.end);
  const type = ebml(copy).flatMap((e) => ebml(copy, e.at, e.end)).find((e) => e.id === '83');
  copy[type.at] = 17; // subtitle track; its CodecPrivate may contain personal text
  const codec = ebml(copy).flatMap((e) => ebml(copy, e.at, e.end)).find((e) => e.id === '86');
  copy.fill(65, codec.at, codec.end);
  const body = cat(b.slice(tracks.at, tracks.end), copy), length = put32(body.length); length[0] |= 0x10;
  const expanded = cat(Buffer.from('1654ae6b', 'hex'), length, body);
  const grown = cat(b.slice(0, tracks.start), expanded, b.slice(tracks.end));
  const size = (at, width, n) => { for (let j = width - 1; j >= 0; j--, n = Math.floor(n / 256)) grown[at + j] = n & 255; grown[at] |= 128 >> (width - 1); };
  size(seg.start + 4, seg.at - seg.start - 4, seg.end - seg.at + expanded.length - (tracks.end - tracks.start));
  assert.ok(M.video(grown));
  assert.equal(M.examine(grown, 'bg').error, 'meta');
});

test('attachments, chapters, checksums, unknown elements and a segment of no stated length are taken out too', () => {
  const b = Buffer.from(fx('meta.webm'));
  const seg = segment(b);
  // Elements added to the end of the segment (its length is eight bytes, so it can grow in place).
  const el = (id, ...payload) => { const body = Buffer.concat(payload.map((p) => Buffer.from(p))); return Buffer.concat([Buffer.from(id, 'hex'), Buffer.from([0x40 | (body.length >> 8), body.length & 255]), body]); };
  const extras = Buffer.concat([
    el('1941a469', el('61a7', el('466e', 'SECRETFILE.jpg'), el('465c', 'SECRETDATA'))),
    el('1043a770', el('45b9', el('b6', el('5b2d', 'SECRETCHAPTER')))),
    el('bf', [1, 2, 3, 4]),
    el('1a2b3c4d'.slice(0, 8), 'SECRETUNKNOWN'),
    el('ec', 'SECRETVOID'),
  ]);
  const grown = Buffer.concat([b, extras]);
  assert.equal(seg.at - seg.start, 12, 'an eight byte length field');
  grown.writeBigUInt64BE(0x0100000000000000n | BigInt(seg.end - seg.at + extras.length), seg.start + 4);
  assert.ok(M.video(new Uint8Array(grown)), 'a WebM the reader accepts');
  const c = M.check(new Uint8Array(grown), 'bg').bytes;
  assert.doesNotMatch(text(c), /SECRET/);
  assert.equal(c.length, grown.length);
  const s = segment(c), added = s.kids.slice(-5);
  assert.deepEqual(added.map((k) => voidOver(c, k)), [true, true, true, true, true]);
  // No stated length: the same file, streamed.
  const streaming = Uint8Array.from(grown);
  streaming.fill(255, seg.start + 5, seg.start + 12);
  streaming[seg.start + 4] = 0x01;
  const d = M.check(streaming, 'bg').bytes;
  assert.doesNotMatch(text(d), /SECRET|Lavf/);
  assert.equal(d.length, streaming.length);
  eq(M.check(d, 'bg').bytes, d);
});

test('clusters of no stated length end where the next part of the segment begins, and what follows them is cleaned', () => {
  const b = Buffer.from(fx('meta.webm'));
  const seg = segment(b), cluster = seg.kids.find((k) => k.id === '1f43b675');
  // The cluster's length field says "unknown", in the bytes it had.
  const m = cluster.at - cluster.start - 4, marker = 128 >> (m - 1);
  const live = Buffer.from(b);
  live[cluster.start + 4] = marker | (marker - 1);
  live.fill(255, cluster.start + 5, cluster.start + 4 + m);
  const tagsBefore = Buffer.concat([live, Buffer.from(b.subarray(seg.kids.find((k) => k.id === '1254c367').start, seg.kids.find((k) => k.id === '1254c367').end))]);
  const grown = Buffer.from(tagsBefore);
  grown.writeBigUInt64BE(0x0100000000000000n | BigInt(seg.end - seg.at + (tagsBefore.length - live.length)), seg.start + 4);
  assert.ok(M.video(new Uint8Array(grown)));
  const c = M.check(new Uint8Array(grown), 'bg').bytes;
  assert.doesNotMatch(text(c), /SECRET|Lavf/, 'the tags after an open cluster are gone too');
});

// ---- AVIF ---------------------------------------------------------------------------------------------------------------------
// iloc by the book: [{ id, extents: [[offset, length]] }] and where each item's row starts and ends.
const iloc = (b) => {
  const meta = top(b, 'meta')[0], box = child(b, meta, 'iloc', 4)[0];
  const v = b[box.at], off = b[box.at + 4] >> 4, len = b[box.at + 4] & 15, base = b[box.at + 5] >> 4;
  assert.equal(v, 0);
  const n = u16(b, box.at + 6), rows = [];
  let i = box.at + 8;
  for (let k = 0; k < n; k++) {
    const from = i, id = u16(b, i);
    i += 4 + base;
    const count = u16(b, i);
    i += 2;
    const extents = [];
    for (let e = 0; e < count; e++) { extents.push([Buffer.from(b).readUIntBE(i, off), Buffer.from(b).readUIntBE(i + off, len), i]); i += off + len; }
    rows.push({ id, extents, from, to: i });
  }
  return rows;
};
const items = (b) => {
  const meta = top(b, 'meta')[0], iinf = child(b, meta, 'iinf', 4)[0];
  return kids(b, iinf.at + 6, iinf.end).map((e) => ({ id: u16(b, e.at + 4), kind: four(b, e.at + 8) }));
};

test('the AVIF fixture really carries what is to be taken out', () => {
  const b = fx('meta.avif');
  assert.deepEqual(items(b), [{ id: 1, kind: 'av01' }, { id: 2, kind: 'Exif' }, { id: 3, kind: 'mime' }]);
  assert.match(text(b), /SECRETCAM/);
  assert.match(text(b), /SECRETXMPCAM/);
  assert.ok(child(b, top(b, 'meta')[0], 'iref', 4).length, 'with links from the Exif and XMP items to the picture');
});

test('an AVIF comes back without its Exif and XMP, with the same picture, in the same place', () => {
  const b = fx('meta.avif'), got = M.check(b, 'bg');
  assert.deepEqual([got.type, got.mime, got.w, got.h, got.frames, got.animated], ['image', 'image/avif', 64, 48, 1, false]);
  const c = got.bytes;
  assert.equal(c.length, b.length, 'the same length: the freed room is a free box right after meta');
  assert.doesNotMatch(text(c), /SECRET|Exif|xmpmeta/);
  assert.deepEqual(items(c), [{ id: 1, kind: 'av01' }]);
  assert.deepEqual(iloc(c).map((r) => r.id), [1]);
  assert.deepEqual(child(c, top(c, 'meta')[0], 'iref', 4), [], 'and nothing links to the others');
  assert.deepEqual(kids(c).map((k) => k.type), ['ftyp', 'meta', 'free', 'mdat']);
  assert.equal(top(c, 'mdat')[0].start, top(b, 'mdat')[0].start, 'the data is where it was');
  // The picture: its bytes are the same, and the items' place in the data is zero.
  const [p0, p1] = [iloc(b)[0].extents[0], iloc(c)[0].extents[0]];
  assert.deepEqual([p1[0], p1[1]], [p0[0], p0[1]]);
  eq(c.subarray(p1[0], p1[0] + p1[1]), b.subarray(p0[0], p0[0] + p0[1]), 'the AV1 stream');
  for (const row of iloc(b).slice(1)) for (const [at, size] of row.extents) assert.ok(c.subarray(at, at + size).every((x) => x === 0), `item ${row.id}'s bytes are zero`);
  // The primary item is still the picture, and its properties stand.
  const pitm = child(c, top(c, 'meta')[0], 'pitm', 4)[0];
  assert.equal(u16(c, pitm.at + 4), 1);
  for (const name of ['ispe', 'pixi', 'av1C', 'colr']) assert.ok(text(c).includes(name), name);
  assert.deepEqual(M.avif(c, M.LIMIT.bg.image) && [M.avif(c, M.LIMIT.bg.image).w, M.avif(c, M.LIMIT.bg.image).h], [64, 48]);
});

test('cleaning an AVIF twice changes nothing; a picture with no Exif or XMP is returned as it is', () => {
  const once = M.check(fx('meta.avif'), 'bg').bytes;
  eq(M.check(once, 'bg').bytes, once);
  const noMeta = M.check(fx('anim.avif'), 'bg').bytes;
  eq(M.check(noMeta, 'bg').bytes, noMeta);
  // A sequence's movie is cleaned as an MP4's is.
  assert.doesNotMatch(text(noMeta), /Lavc|PictureHandler/);
});

test('an AVIF whose Exif or XMP cannot be taken out of its tables is refused', () => {
  const b = fx('meta.avif');
  const patched = (f) => { const t = Uint8Array.from(b); f(t, iloc(t)); return t; };
  const refused = (bytes, why) => {
    assert.ok(M.avif(bytes, M.LIMIT.bg.image), `${why}: an AVIF the reader accepts`);
    const seen = M.examine(bytes, 'bg');
    assert.deepEqual([seen.got, seen.error], [undefined, 'meta'], why);
  };
  refused(patched((t, rows) => { t.set(put32(0), rows[1].extents[0][2] + 4); }), 'an Exif item of no stated length');
  refused(patched((t, rows) => { t.set(put32(40), rows[1].extents[0][2]); }), 'an Exif item in the file type box, not in the data');
  refused(patched((t, rows) => { t.set(put32(t.length - 4), rows[2].extents[0][2]); }), 'an XMP item that runs past the end');
  // Two items with one number.
  refused(patched((t) => { const meta = top(t, 'meta')[0], iinf = child(t, meta, 'iinf', 4)[0], first = kids(t, iinf.at + 6, iinf.end)[0]; t[first.at + 5] = 2; }), 'two items numbered 2');
  // A property attached to the Exif item: the ipma entry for item 1 is rewritten to name item 2.
  refused(patched((t) => { const meta = top(t, 'meta')[0], iprp = child(t, meta, 'iprp', 4)[0], ipma = child(t, iprp, 'ipma')[0]; t[ipma.at + 9] = 2; }), 'a property tied to the Exif item');
  // The primary item is the Exif item.
  refused(patched((t) => { const pitm = child(t, top(t, 'meta')[0], 'pitm', 4)[0]; t[pitm.at + 5] = 2; }), 'the primary item is the Exif item');
  // A picture that points at the Exif item (a reference with the picture as its source).
  refused(patched((t) => { const iref = child(t, top(t, 'meta')[0], 'iref', 4)[0], first = kids(t, iref.at + 4, iref.end)[0]; t[first.at + 1] = 1; t[first.at + 5] = 2; }), 'a link from the picture to the Exif item');
});

test('duplicate AVIF metadata tables are refused rather than cleaning just the first copy', () => {
  const b = fx('meta.avif'), meta = top(b, 'meta')[0], info = child(b, meta, 'iinf', 4)[0];
  const copy = b.slice(info.start, info.end), grown = cat(b.slice(0, meta.end), copy, b.slice(meta.end));
  grown.set(put32(meta.end - meta.start + copy.length), meta.start);
  for (const row of iloc(b)) for (const [at, , field] of row.extents) grown.set(put32(at + copy.length), field);
  assert.ok(M.avif(grown, M.LIMIT.bg.image));
  assert.equal(M.examine(grown, 'bg').error, 'meta');
});

test('the retained AVIF picture item loses its author-supplied item name too', () => {
  const b = fx('meta.avif'), meta = top(b, 'meta')[0], info = child(b, meta, 'iinf', 4)[0];
  const first = kids(b, info.at + 6, info.end)[0], name = first.at + 12;
  assert.ok(first.end - name >= 6);
  b.set(Buffer.from('PHONE'), name);
  const got = M.check(b, 'bg');
  assert.ok(got);
  assert.ok(!text(got.bytes).includes('PHONE'));
});

test('an AVIF metadata item without a matching unique location cannot leave its bytes behind', () => {
  const b = fx('meta.avif'), rows = iloc(b);
  b[rows[1].from + 1] = 9;
  assert.ok(M.avif(b, M.LIMIT.bg.image));
  assert.equal(M.examine(b, 'bg').error, 'meta');
});

test('an AVIF color profile that can carry device metadata is refused rather than copied unchanged', () => {
  const b = fx('meta.avif'), meta = top(b, 'meta')[0], iprp = child(b, meta, 'iprp', 4)[0], ipco = child(b, iprp, 'ipco')[0], colr = child(b, ipco, 'colr')[0];
  b.set(Buffer.from('profSECRET'), colr.at);
  assert.ok(M.avif(b, M.LIMIT.bg.image));
  assert.equal(M.examine(b, 'bg').error, 'meta');
});

test('stickers a mod carries are cleaned the same way', () => {
  const got = M.check(fx('meta.avif'), 'sticker');
  assert.equal(got.type, 'image');
  assert.doesNotMatch(text(got.bytes), /SECRET/);
});

test('cleaning writes into a copy, never into the bytes it was given', () => {
  for (const f of ['meta.mp4', 'meta.webm', 'meta.avif']) {
    for (const make of [(b) => Uint8Array.from(b), (b) => Buffer.from(b)]) {
      const given = make(fx(f)), before = Uint8Array.from(given);
      const got = M.check(given, 'bg');
      assert.notDeepEqual(Buffer.from(got.bytes), Buffer.from(before), `${f}: it did clean`);
      eq(given, before, `${f}: the file it was handed is as it was`);
    }
  }
});

// ---- the files this computer keeps --------------------------------------------------------------------------------------------
const area = (data = {}, records = new Map()) => ({
  data, records,
  local: {
    get: async (k) => Object.fromEntries([].concat(k === null ? Object.keys(data) : k).filter((x) => x in data).map((x) => [x, structuredClone(data[x])])),
    set: async (p) => { Object.assign(data, structuredClone(p)); return true; },
    remove: async (k) => { for (const x of [].concat(k)) delete data[x]; return true; },
  },
  files: { get: async (h) => structuredClone(records.get(h)), put: async (h, v) => { records.set(h, structuredClone(v)); }, del: async (hs) => { for (const h of hs) records.delete(h); }, keys: async () => [...records.keys()] },
});

test('put keeps the cleaned file under the hash of the cleaned file, and tells a file it cannot clean from one it cannot play', async () => {
  for (const [file, kind] of [['meta.mp4', 'video'], ['meta.webm', 'video'], ['meta.avif', 'image']]) {
    const a = area(), dirty = fx(file), cleaned = M.check(dirty, 'bg').bytes;
    const r = await M.change({ op: 'put', kind, b64: M.std(dirty) }, a);
    assert.equal(r.ok, true, file);
    assert.equal(r.h, sha(cleaned), `${file}: named by what is kept`);
    assert.notEqual(r.h, sha(dirty));
    assert.equal(r.size, cleaned.length);
    eq(M.unstd(a.records.get(r.h).b), cleaned);
    assert.doesNotMatch(text(M.unstd(a.records.get(r.h).b)), SECRETS);
    assert.equal((await M.read(a, r.h)).bytes.length, cleaned.length, 'and read back, it is the file its name says');
    // A Look that names the file by its cleaned hash is satisfied; one that names the file as it came is not.
    assert.equal((await M.change({ op: 'put', kind, b64: M.std(dirty), expect: sha(cleaned) }, area())).ok, true, file);
    assert.equal((await M.change({ op: 'put', kind, b64: M.std(dirty), expect: sha(dirty) }, area())).error, 'hash', file);
  }
  const a = area(), fragmented = cat(fx('meta.mp4'), box('moof', box('mfhd', [0, 0, 0, 0], put32(1))));
  assert.deepEqual(await M.change({ op: 'put', kind: 'video', b64: M.std(fragmented) }, a), { ok: false, error: 'meta' });
  assert.equal((await M.change({ op: 'put', kind: 'image', b64: M.std(fragmented) }, a)).error, 'type', 'not a picture at all');
  assert.equal((await M.change({ op: 'put', kind: 'video', b64: M.std(new Uint8Array(500)) }, a)).error, 'type');
  assert.deepEqual([a.data, a.records.size], [{}, 0], 'nothing was kept');
});

test('a video or picture an older Glaze kept, named by the file as it came, still plays and moves over, and is never sent on', async () => {
  const dirty = fx('meta.mp4'), old = sha(dirty);
  const a = area({ [M.INDEX]: { [old]: { t: 'video/mp4', n: dirty.length, at: Date.now() } } }, new Map([[old, { t: 'video/mp4', b: M.std(dirty) }]]));
  const served = await M.change({ op: 'file', h: old }, a);
  assert.equal(served.ok, true);
  eq(M.unstd(served.b64), dirty, 'the page is handed what was kept, as before');
  assert.equal(await M.read(a, old), null, 'the share path does not get it: it would send the metadata');
  // From storage.local, where an older Glaze kept it: it moves over whole.
  const b = area({ [`${M.KEY}${old}`]: { t: 'video/mp4', b: M.std(dirty) } });
  const moved = await M.migrate(b, [`${M.KEY}${old}`]);
  assert.deepEqual(Object.keys(moved), [old]);
  assert.equal(b.records.has(old), true);
  assert.deepEqual(Object.keys(b.data[M.INDEX]), [old]);
  // Keeping the same file again makes the clean one beside it, under its own name.
  const again = await M.change({ op: 'put', kind: 'video', b64: M.std(dirty) }, a);
  assert.notEqual(again.h, old);
  assert.equal((await M.read(a, again.h)).bytes.length, dirty.length);
  // Bytes under a name that is neither the file nor its clean copy are nothing.
  a.records.set(old, { t: 'video/mp4', b: M.std(fx('clip.mp4')) });
  assert.equal(await M.read(a, old), null);
  assert.deepEqual((await M.migrate(area({ [`${M.KEY}${'A'.repeat(43)}`]: { t: 'video/mp4', b: M.std(dirty) } }), [`${M.KEY}${'A'.repeat(43)}`])), {}, 'a name that is not its hash');
});

test('migration must preserve an original-hash file whose container plays but metadata cannot be stripped', async () => {
  const dirty = cat(fx('meta.mp4'), box('moof', box('mfhd', [0, 0, 0, 0], put32(1))));
  assert.ok(M.video(dirty));
  assert.equal(M.examine(dirty, 'bg').error, 'meta');
  const old = sha(dirty), key = `${M.KEY}${old}`, a = area({ [key]: { t: 'video/mp4', b: M.std(dirty) } });
  await M.migrate(a, [key]);
  assert.ok(a.data[key] || a.records.has(old), 'a new metadata refusal must not delete the only legacy copy');
  const file = await M.change({ op: 'file', h: old }, a);
  assert.equal(file.ok, true);
  eq(M.unstd(file.b64), dirty, 'existing local playback keeps the exact original');
  assert.equal(await M.read(a, old), null, 'uncleanable originals must not become share uploads');
  assert.deepEqual(await M.change({ op: 'put', kind: 'video', b64: M.std(dirty) }, area()), { ok: false, error: 'meta' }, 'the legacy exception does not permit a new upload');
  const remote = await M.change({ op: 'remote', kind: 'video', src: 'https://cdn.example.com/old.mp4' }, area(), { allow: async () => true, fetch: async () => new Response(dirty) });
  assert.equal(remote.ok, false, 'nor does it permit new remote media');
});
