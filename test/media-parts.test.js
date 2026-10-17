// x.bg.media (lib/lookparts.js): a video, an animated picture or a Lottie animation as a Look part. Every refusal here is a code
// from a stranger that must not get in: an address that is not https or not a public host, a file name that is not a SHA-256, a
// type or fit that is not one of the few, numbers out of range, keys nobody defined.
const test = require('node:test');
const assert = require('node:assert/strict');
const X = require('../lib/lookparts.js');
const S = require('../lib/share.js');
const G = require('../defaults.js');

const clone = (o) => JSON.parse(JSON.stringify(o));
const HASH = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ'; // 43 characters of base64url
const URL1 = 'https://cdn.example.com/loops/rain.webm';
const media = (m) => X.clean({ bg: { media: m } });

test('a media background cleans to itself, and cleaning twice changes nothing', () => {
  for (const m of [
    { type: 'video', src: URL1 },
    { type: 'image', src: 'https://a.example.org/x.webp?size=2&v=1#t', fit: 'contain', dim: 0, loop: true },
    { type: 'lottie', src: URL1.replace('webm', 'json'), fit: 'fill', dim: 90, loop: false },
    { type: 'video', src: `file:${HASH}` },
    { type: 'image', src: 'https://xn--bcher-kva.example/x.avif' },
  ]) {
    const once = media(clone(m));
    assert.deepEqual(once, { bg: { media: m } });
    assert.deepEqual(X.clean(clone(once)), once);
    assert.ok(X.same(once, { bg: { media: m } }));
  }
  // Keys come out in the order the cleaner has them, whatever order they came in.
  assert.deepEqual(Object.keys(media({ loop: false, dim: 5, fit: 'cover', src: URL1, type: 'video' }).bg.media), ['type', 'src', 'fit', 'dim', 'loop']);
  // An absent key stays absent: its meaning is in DEFAULTS.
  assert.deepEqual(media({ type: 'video', src: URL1 }).bg.media, { type: 'video', src: URL1 });
  assert.deepEqual(X.DEFAULTS.media, { fit: 'cover', dim: 40, loop: true });
  assert.ok(Object.isFrozen(X.DEFAULTS.media));
  // It sits beside the other background parts.
  assert.ok(X.clean({ bg: { shader: { src: 'vec4 scene(vec2 uv) { return vec4(0.); }' }, media: { type: 'video', src: URL1 } } }).bg.media);
});

test('what is not a media background is refused whole', () => {
  const ok = { type: 'video', src: URL1 };
  const bad = {
    'not an object': 'video', array: [ok], null: null, 'nothing in it': {}, number: 5,
    'no type': { src: URL1 }, 'no source': { type: 'video' },
    'a type nobody has': { ...ok, type: 'gif' }, 'a type in capitals': { ...ok, type: 'Video' }, 'type not text': { ...ok, type: 1 },
    'unknown key': { ...ok, volume: 1 }, 'autoplay': { ...ok, autoplay: true }, 'controls': { ...ok, controls: true }, 'muted': { ...ok, muted: false },
    'fit not one of three': { ...ok, fit: 'repeat' }, 'fit not text': { ...ok, fit: 1 },
    'dim text': { ...ok, dim: '30' }, 'dim NaN': { ...ok, dim: NaN }, 'dim infinite': { ...ok, dim: Infinity },
    'loop text': { ...ok, loop: 'yes' }, 'loop number': { ...ok, loop: 1 },
    'src not text': { ...ok, src: 5 }, 'src an object': { ...ok, src: { href: URL1 } }, 'src empty': { ...ok, src: '' },
    'http': { ...ok, src: 'http://cdn.example.com/a.webm' },
    'data address': { ...ok, src: 'data:video/webm;base64,AAAA' }, 'blob address': { ...ok, src: 'blob:https://cdn.example.com/1' },
    'javascript': { ...ok, src: 'javascript:alert(1)' }, 'ftp': { ...ok, src: 'ftp://cdn.example.com/a.webm' },
    'a file address': { ...ok, src: 'file:///etc/passwd' }, 'chrome-extension': { ...ok, src: 'chrome-extension://abc/x' },
    'no scheme': { ...ok, src: 'cdn.example.com/a.webm' }, 'protocol-relative': { ...ok, src: '//cdn.example.com/a.webm' },
    'credentials': { ...ok, src: 'https://user:pw@cdn.example.com/a.webm' }, 'user only': { ...ok, src: 'https://user@cdn.example.com/a.webm' },
    'a port': { ...ok, src: 'https://cdn.example.com:8443/a.webm' },
    'an IPv4 address': { ...ok, src: 'https://93.184.216.34/a.webm' }, 'loopback': { ...ok, src: 'https://127.0.0.1/a.webm' }, 'IPv6': { ...ok, src: 'https://[::1]/a.webm' },
    'a decimal address': { ...ok, src: 'https://2130706433/a.webm' }, 'hex address': { ...ok, src: 'https://0x7f.0.0.1/a.webm' },
    'localhost': { ...ok, src: 'https://localhost/a.webm' }, 'a .local name': { ...ok, src: 'https://printer.local/a.webm' }, 'internal': { ...ok, src: 'https://nas.internal/a.webm' },
    'a one-label name': { ...ok, src: 'https://intranet/a.webm' }, 'a lan name': { ...ok, src: 'https://router.lan/a.webm' }, 'home.arpa': { ...ok, src: 'https://hub.home.arpa/a.webm' },
    'subdomain of localhost': { ...ok, src: 'https://app.localhost/a.webm' },
    'a trailing dot': { ...ok, src: 'https://cdn.example.com./a.webm' },
    'a space in the host': { ...ok, src: 'https://cdn .example.com/a.webm' },
    'over 2048 characters': { ...ok, src: `https://cdn.example.com/${'a'.repeat(2030)}` },
    'a file name too short': { ...ok, src: 'file:abc' }, 'a file name too long': { ...ok, src: `file:${HASH}A` }, 'a file name with a slash': { ...ok, src: `file:${HASH.slice(1)}/` },
    'a file name with padding': { ...ok, src: `file:${HASH.slice(1)}=` }, 'FILE in capitals': { ...ok, src: `FILE:${HASH}` },
    'an address that is not as the parser writes it': { ...ok, src: 'https://CDN.example.com/a.webm' },
    'a space at the end': { ...ok, src: `${URL1} ` },
    'a newline inside': { ...ok, src: 'https://cdn.example.com/a\n.webm' },
    '__proto__': JSON.parse(`{"type":"video","src":"${URL1}","__proto__":{"fit":"cover"}}`),
  };
  for (const [why, m] of Object.entries(bad)) {
    const got = media(m);
    // An address the parser would write differently is cleaned to that spelling, and a code that carries the other one is refused (below).
    if (['an address that is not as the parser writes it', 'a space at the end', 'a newline inside'].includes(why)) { assert.ok(!X.same(got, { bg: { media: m } }), why); assert.doesNotMatch(got.bg.media.src, /\s/); continue; }
    if (why === '__proto__') { assert.deepEqual(got, { bg: { media: ok } }, 'an own __proto__ key is not a key, and nothing reaches a prototype'); continue; }
    assert.equal(got, null, why);
  }
  assert.equal(Object.getPrototypeOf(media({ type: 'video', src: URL1 }).bg.media), Object.prototype);
});

test('a number is clamped and rounded as every other part does, and a code that carries the other value is refused', () => {
  const dim = (v) => media({ type: 'video', src: URL1, dim: v }).bg.media.dim;
  assert.deepEqual([dim(91), dim(-1), dim(30.5), dim(30.4), dim(1e9), dim(-1e9)], [90, 0, 31, 30, 90, 0]);
  assert.ok(!X.same(media({ type: 'video', src: URL1, dim: 91 }), { bg: { media: { type: 'video', src: URL1, dim: 91 } } }));
});

test('the limits are allowed, and nothing is truncated past them', () => {
  const long = `https://cdn.example.com/${'a'.repeat(2048 - 'https://cdn.example.com/'.length)}`;
  assert.equal(long.length, 2048);
  assert.equal(media({ type: 'video', src: long }).bg.media.src, long);
  assert.equal(media({ type: 'video', src: `${long}a` }), null);
  assert.equal(media({ type: 'video', src: URL1, dim: 0 }).bg.media.dim, 0);
  assert.equal(media({ type: 'video', src: URL1, dim: 90 }).bg.media.dim, 90);
  assert.equal(media({ type: 'video', src: URL1, dim: -0 }).bg.media.dim, 0);
  assert.ok(Object.is(media({ type: 'video', src: URL1, dim: -0 }).bg.media.dim, 0), 'no negative zero');
  for (const fit of ['cover', 'contain', 'fill']) assert.equal(media({ type: 'video', src: URL1, fit }).bg.media.fit, fit);
  for (const type of ['video', 'image', 'lottie']) assert.equal(media({ type, src: URL1 }).bg.media.type, type);
});

test('through storage packing and through a glaze2 code, a media Look comes back as it went in', async () => {
  const parts = { x: { bg: { media: { type: 'image', src: 'https://cdn.example.com/a.webp', fit: 'contain', dim: 55, loop: true } } } };
  const P = X.bundle(parts);
  assert.ok(X.same(P, parts));
  assert.ok(X.same(await X.unpack(await X.pack(P)), P), 'storage');
  const s = G.GZ_SANITIZE({ look: { radius: 6 }, bg: { kind: 'media' } });
  const code = await S.encode(s, {}, P);
  assert.match(code, /^glaze2:[\w-]+$/);
  assert.ok(code.length < 600, `${code.length} characters`);
  const got = await S.decode(code);
  assert.ok(X.same(got.parts, P));
  assert.equal(got.bg.kind, 'media');
  assert.equal(got.look.radius, 6);
  // A file the Look names by hash travels as its name; the file itself does not.
  const file = { x: { bg: { media: { type: 'video', src: `file:${HASH}` } } } };
  assert.ok(X.same((await S.decode(await S.encode(s, {}, file))).parts, file));
  // Only while the background is media: another kind leaves the draft in storage and out of the code.
  for (const kind of ['solid', 'shader', 'layers', 'scene']) {
    const plain = G.GZ_SANITIZE({ bg: { kind } });
    assert.match(await S.encode(plain, {}, P), /^glaze1:/, kind);
  }
  const both = { x: { bg: { media: parts.x.bg.media, layers: [{ k: 'noise' }] } } };
  const layers = await S.decode(await S.encode(G.GZ_SANITIZE({ bg: { kind: 'layers' } }), {}, both));
  assert.deepEqual(layers.parts.x.bg, { layers: [{ k: 'noise' }] });
  const mediaOnly = await S.decode(await S.encode(s, {}, both));
  assert.deepEqual(mediaOnly.parts.x.bg, { media: parts.x.bg.media });
});

test('a code with a media part is refused whole for anything off in it, naming the part', async () => {
  const make = async (obj) => `glaze2:${Buffer.from(await new Response(new Blob([JSON.stringify(obj)]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer()).toString('base64url')}`;
  const C = G.GZ_COLORS.map(([, , d]) => d.slice(1)).join('');
  const x = (m) => ({ c: C, b: { kind: 'media' }, x: { bg: { media: m } } });
  const fine = await S.decode(await make(x({ type: 'video', src: URL1 })));
  assert.equal(fine.parts.x.bg.media.src, URL1);
  for (const [why, m] of [
    ['http', { type: 'video', src: 'http://cdn.example.com/a.webm' }],
    ['a local host', { type: 'video', src: 'https://192.168.0.1/a.webm' }],
    ['not as the parser writes it', { type: 'video', src: 'https://CDN.example.com/a.webm' }],
    ['unknown key', { type: 'video', src: URL1, volume: 1 }],
    ['no src', { type: 'video' }],
    ['dim out of range', { type: 'video', src: URL1, dim: 99 }],
    ['dim not whole', { type: 'video', src: URL1, dim: 12.5 }],
    ['a type nobody has', { type: 'iframe', src: URL1 }],
  ]) await assert.rejects(S.decode(await make(x(m))), /setting Glaze can't use \(x\.bg\)/, why);
  // encode refuses what decode would refuse.
  await assert.rejects(S.encode(G.GZ_SANITIZE({ bg: { kind: 'media' } }), {}, { x: { bg: { media: { type: 'video', src: 'http://a.example.com/x' } } } }), /extras Glaze can't put in a code/);
});

test('describe says what a media Look plays, and where it loads from', () => {
  const d = (m) => X.describe({ x: { bg: { media: m } } });
  assert.deepEqual(d({ type: 'video', src: 'https://cdn.example.com/a.webm' }), [{ why: 'Plays a video behind your pages, loaded from {host}.', vars: { host: 'cdn.example.com' } }]);
  assert.deepEqual(d({ type: 'image', src: 'https://a.example.org/x.webp' }), [{ why: 'Plays an animated picture behind your pages, loaded from {host}.', vars: { host: 'a.example.org' } }]);
  assert.deepEqual(d({ type: 'lottie', src: 'https://xn--bcher-kva.example/a.json' }), [{ why: 'Plays an animation behind your pages, loaded from {host}.', vars: { host: 'xn--bcher-kva.example' } }]);
  assert.deepEqual(d({ type: 'video', src: `file:${HASH}` }), [{ why: 'Plays a video behind your pages, from a file that came with it.', vars: undefined }]);
  assert.equal(X.KIND_WORD.media, 'a video or animation background');
  assert.deepEqual(X.describe({ x: { cursor: { kind: 'glow' } } }).map((n) => n.why), ['Adds a cursor effect.']);
});

test('the Look kind accepts media, and a stored Look with it passes the settings sanitizer', () => {
  assert.ok(G.GZ_SPEC.bg.kind[1].includes('media'));
  assert.equal(G.GZ_SANITIZE({ bg: { kind: 'media' } }).bg.kind, 'media');
  assert.equal(G.GZ_SANITIZE({ bg: { kind: 'video' } }).bg.kind, 'solid', 'anything else is the default');
  assert.deepEqual(G.GZ_SANITIZE(G.GZ_SANITIZE({ bg: { kind: 'media' } })), G.GZ_SANITIZE({ bg: { kind: 'media' } }), 'idempotent');
});
