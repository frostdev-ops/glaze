// A video or an animated picture a Look names by https address (LOOK-6): the worker fetches it with no cookies, no referrer and no
// redirect, under a time limit and a byte cap, and reads it as a kept file is read (lib/media.js check: container, size, frames and
// pixels, metadata gone), so a page is only ever handed a checked file and never the address itself. lib/media.js `remote`.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const M = require('../lib/media.js');

const fx = (f) => new Uint8Array(fs.readFileSync(path.join(__dirname, 'fixtures/media', f)));
const u32 = (n) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255];
const u24 = (n) => [n & 255, (n >> 8) & 255, (n >> 16) & 255];
const ascii = (s) => [...Buffer.from(s, 'latin1')];
const chunk = (id, data) => [...ascii(id), ...u32(data.length), ...data, ...(data.length & 1 ? [0] : [])];
const riff = (...chunks) => { const body = [...ascii('WEBP'), ...chunks.flat()]; return Uint8Array.from([...ascii('RIFF'), ...u32(body.length), ...body]); };
const vp8l = (w, h) => chunk('VP8L', [0x2f, ...u32((w - 1) | ((h - 1) << 14)), 0, 0, 0, 0]);
const vp8x = (flags, w, h) => chunk('VP8X', [flags, 0, 0, 0, ...u24(w - 1), ...u24(h - 1)]);

const URL1 = 'https://cdn.example.com/loop.webm';
const area = () => ({ local: { get: async () => ({}), set: async () => true, remove: async () => true }, files: { get: async () => undefined, put: async () => {}, del: async () => {}, keys: async () => [] } });
const response = (bytes, init = {}) => {
  const body = new Response(bytes).body;
  const cancelled = [];
  const real = body.cancel.bind(body);
  body.cancel = (...a) => { cancelled.push(true); return real(...a); };
  return { ok: init.ok ?? true, status: init.status ?? 200, type: init.type ?? 'basic', redirected: init.redirected ?? false, headers: new Headers(init.headers), body, cancelled };
};
// The worker's side with a stand-in network: asks for `src` as `kind`, answered by `reply` (a response, or an error to throw).
const got = (kind, src, reply, { allow = async () => true } = {}) => {
  const calls = [];
  const env = { allow, fetch: async (u, i) => { calls.push([u, i]); if (reply instanceof Error) throw reply; return reply; } };
  return M.change({ op: 'remote', src, kind }, area(), env).then((r) => Object.assign(r, { calls }));
};

test('a remote video is fetched with no cookies, no referrer and no redirect, and handed back as the checked file', async () => {
  const bytes = fx('clip.webm');
  const r = await got('video', URL1, response(bytes));
  assert.equal(r.ok, true);
  assert.deepEqual([r.type, r.mime], ['video', 'video/webm']);
  assert.equal(r.calls.length, 1);
  const [url, init] = r.calls[0];
  assert.equal(url, URL1);
  assert.deepEqual([init.method, init.credentials, init.redirect, init.referrerPolicy], ['GET', 'omit', 'manual', 'no-referrer']);
  assert.ok(init.signal instanceof AbortSignal, 'under a time limit');
  assert.deepEqual(Array.from(M.unstd(r.b64)), Array.from(M.check(bytes, 'bg').bytes), 'the cleaned bytes, as a kept file would be');
});

test('a remote video or AVIF picture comes back without its metadata, like a kept file', async () => {
  for (const [file, kind] of [['meta.mp4', 'video'], ['meta.webm', 'video'], ['meta.avif', 'image']]) {
    const bytes = fx(file), r = await got(kind, `https://cdn.example.com/${file}`, response(bytes));
    assert.equal(r.ok, true, file);
    assert.doesNotMatch(Buffer.from(M.unstd(r.b64)).toString('latin1'), /SECRET|37\.7749/, file);
    assert.deepEqual(Array.from(M.unstd(r.b64)), Array.from(M.check(bytes, 'bg').bytes), file);
  }
});

test('a remote picture is the cleaned picture: metadata is gone before a page sees it', async () => {
  const dirty = riff(vp8x(0x08, 16, 16), vp8l(16, 16), chunk('EXIF', [1, 2, 3, 4, 5, 6]));
  const r = await got('image', 'https://cdn.example.com/a.webp', response(dirty));
  assert.equal(r.ok, true);
  assert.deepEqual([r.type, r.mime], ['image', 'image/webp']);
  assert.equal(M.unstd(r.b64).length, riff(vp8x(0, 16, 16), vp8l(16, 16)).length);
  assert.equal(r.b64.includes('RVhJRg'), false);
});

test('only an address the worn Look, or the editor, names is fetched, and only as cleaned', async () => {
  const asked = [];
  const refuse = async (src) => { asked.push(src); return false; };
  const r = await got('video', URL1, response(fx('clip.webm')), { allow: refuse });
  assert.deepEqual([r.ok, r.error, r.calls.length, asked], [false, 'bad', 0, [URL1]]);
  for (const src of ['http://cdn.example.com/a.webm', 'https://127.0.0.1/a.webm', 'https://192-168-1-1.nip.io/a.webm', 'https://localtest.me/a.webm', 'https://10-0-0-1.example.com/a.webm',
    'https://CDN.example.com/a.webm', 'https://cdn.example.com:8443/a.webm', 'https://u:p@cdn.example.com/a.webm', `file:${'A'.repeat(43)}`, './a.webm', 'mod:aaaaaaaaaaaaaaaa/a.webm', 5, null, undefined, {}]) {
    const x = await got('video', src, response(fx('clip.webm')));
    assert.deepEqual([x.ok, x.error, x.calls.length], [false, 'bad', 0], String(src));
  }
  for (const kind of ['lottie', 'audio', undefined, null, 5]) {
    const x = await got(kind, URL1, response(fx('clip.webm')));
    assert.deepEqual([x.ok, x.error, x.calls.length], [false, 'bad', 0], String(kind));
  }
  const noFetch = await M.change({ op: 'remote', src: URL1, kind: 'video' }, area(), { allow: async () => true });
  assert.deepEqual(noFetch, { ok: false, error: 'bad' });
});

test('a redirect, an error status and a network failure are refused, never followed', async () => {
  for (const [why, reply] of [
    ['opaque redirect', response(new Uint8Array(), { status: 0, type: 'opaqueredirect', ok: false })],
    ['301 with a Location', response(new Uint8Array(), { status: 301, headers: { location: 'https://192.168.0.1/x.webm' } })],
    ['a 302 that claims to be fine', response(fx('clip.webm'), { status: 302 })],
    ['a followed redirect', response(fx('clip.webm'), { redirected: true })],
    ['404', response(new Uint8Array(), { ok: false, status: 404 })],
    ['offline', new Error('offline')],
  ]) {
    const x = await got('video', URL1, reply);
    assert.deepEqual([x.ok, x.error], [false, 'network'], why);
    assert.equal(x.calls.length, 1, `${why}: asked once and not again`);
  }
});

test('a body over the byte cap is refused by its length or as it arrives, and the rest is not read', async () => {
  const L = M.LIMIT.bg;
  const long = response(new Uint8Array(10), { headers: { 'content-length': String(L.video + 1) } });
  const a = await got('video', URL1, long);
  assert.deepEqual([a.ok, a.error], [false, 'big']);
  assert.equal(long.cancelled.length, 1, 'a declared length over the cap cancels the body');
  const pic = await got('image', 'https://cdn.example.com/a.webp', response(new Uint8Array(10), { headers: { 'content-length': String(L.image.bytes + 1) } }));
  assert.deepEqual([pic.ok, pic.error], [false, 'big'], 'a picture has the smaller cap');
  // No length (or a lying one): counted as it comes.
  let pulled = 0;
  const endless = new ReadableStream({ pull(c) { pulled++; c.enqueue(new Uint8Array(1 << 20)); } });
  const b = await got('video', URL1, { ok: true, status: 200, type: 'basic', headers: new Headers({ 'content-length': '10' }), body: endless });
  assert.deepEqual([b.ok, b.error], [false, 'big']);
  assert.ok(pulled <= Math.ceil(L.video / (1 << 20)) + 4, `stopped reading near the cap (${pulled} MiB pulled)`);
  const exactly = await got('image', 'https://cdn.example.com/a.webp', response(fx('anim.webp'), { headers: { 'content-length': String(fx('anim.webp').length) } }));
  assert.equal(exactly.ok, true);
});

test('a picture or video past the side, frame or pixel caps is refused, wherever it is hosted', async () => {
  const huge = riff(vp8x(0, 16383, 16383), vp8l(16383, 16383));
  const a = await got('image', 'https://cdn.example.com/a.webp', response(huge));
  assert.deepEqual([a.ok, a.error], [false, 'type'], '16383 x 16383');
  const wide = riff(vp8x(0, 4097, 8), vp8l(4097, 8));
  assert.equal((await got('image', 'https://cdn.example.com/a.webp', response(wide))).error, 'type', 'a side past 4096');
  const many = riff(vp8x(0x02, 64, 64), chunk('ANIM', [0, 0, 0, 0, 0, 0]), ...Array.from({ length: 301 }, () => chunk('ANMF', [...u24(0), ...u24(0), ...u24(63), ...u24(63), ...u24(100), 0, ...vp8l(64, 64)])));
  assert.equal((await got('image', 'https://cdn.example.com/a.webp', response(many))).error, 'type', 'more than 300 frames');
  // A video whose track is wider than 4096.
  const mp4 = Buffer.from(fx('clip.mp4')), at = mp4.lastIndexOf('avc1'); // the sample entry, not the brand in ftyp
  assert.ok(at > 0);
  mp4.writeUInt16BE(5000, at + 4 + 24);
  assert.equal((await got('video', 'https://cdn.example.com/a.mp4', response(new Uint8Array(mp4)))).error, 'type', 'an 8K video');
  const ok = await got('video', 'https://cdn.example.com/a.mp4', response(fx('clip.mp4')));
  assert.deepEqual([ok.ok, ok.mime], [true, 'video/mp4']);
});

test('what is not the kind asked for, or not media at all, is refused', async () => {
  assert.equal((await got('image', 'https://cdn.example.com/a.webp', response(fx('clip.webm')))).error, 'type', 'a video where a picture was named');
  assert.equal((await got('video', URL1, response(fx('anim.webp')))).error, 'type', 'a picture where a video was named');
  assert.equal((await got('video', URL1, response(fx('spin.json')))).error, 'type', 'a Lottie file is not a video');
  assert.equal((await got('video', URL1, response(Buffer.from('<html><body>login</body></html>')))).error, 'type');
  assert.equal((await got('video', URL1, response(new Uint8Array()))).error, 'type', 'nothing');
  assert.equal((await got('video', URL1, response(fx('clip.webm').subarray(0, 200)))).error, 'type', 'cut short');
});
