// Media backgrounds pinned by hash: a gallery Look's `file:<h>` fetched from the gallery's one address (lib/media.js
// fromGallery, then put with the name it must have), and a mod's background file carried in its signed bundle (`./<path>`,
// lib/modbundle.js), handed to the page as `mod:<id>/<path>` and served cleaned only for a mod that is on (lib/modbroker.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const M = require('../lib/media.js');
const X = require('../lib/lookparts.js');
const B = require('../lib/modbroker.js');
const BUNDLE = require('../lib/modbundle.js');

const fx = (f) => new Uint8Array(fs.readFileSync(path.join(__dirname, 'fixtures/media', f)));
const b64 = (bytes) => Buffer.from(bytes).toString('base64');
const flush = () => new Promise(setImmediate);
const ID = 'abcdefghijklmnop', OTHER = 'qrstuvwxyz234567', SITE = 'https://school.instructure.com';
const area = (data = {}) => ({
  data,
  async get(k) { await flush(); const keys = k === null ? Object.keys(data) : [].concat(k); return structuredClone(Object.fromEntries(keys.filter((x) => x in data).map((x) => [x, data[x]]))); },
  async set(p) { Object.assign(data, structuredClone(p)); return true; },
  async remove(k) { for (const x of [].concat(k)) delete data[x]; return true; },
});
// Where the worker keeps a Look's files (lib/media.js): an index in storage.local and the records in its files store.
const keeping = () => {
  const records = new Map();
  return { records, local: area(), files: { get: async (h) => structuredClone(records.get(h)), put: async (h, v) => { records.set(h, v); }, del: async (hs) => { for (const h of hs) records.delete(h); }, keys: async () => [...records.keys()] } };
};

// ---- a gallery Look's file ----------------------------------------------------------------------------------------------
const respond = (bytes, { status = 200, length, chunk = 1 << 16, headers = {} } = {}) => {
  let at = 0;
  const body = new ReadableStream({ pull(c) { if (at >= bytes.length) return c.close(); c.enqueue(bytes.subarray(at, at + chunk)); at += chunk; } });
  return new Response(status === 200 ? body : null, { status, headers: { ...(length !== undefined && { 'content-length': String(length) }), ...headers } });
};

test('fromGallery asks the one fixed address, with no cookies, no referrer and no redirects, and the file is kept only by its name', async () => {
  const bytes = fx('clip.webm'), h = await M.sha(M.check(bytes, 'bg').bytes);
  const asked = [];
  const got = await M.fromGallery(h, 'video', { fetch: async (u, i) => { asked.push([u, i]); return respond(bytes, { chunk: 100 }); } });
  assert.equal(got.ok, true);
  assert.equal(asked.length, 1);
  assert.equal(asked[0][0], `https://frostdev.io/glaze/looks/api/media/${h}`);
  assert.deepEqual([asked[0][1].credentials, asked[0][1].referrerPolicy, asked[0][1].redirect, asked[0][1].method], ['omit', 'no-referrer', 'error', 'GET']);
  assert.ok(asked[0][1].signal instanceof AbortSignal, 'a time limit');
  const local = keeping();
  const kept = await M.change({ op: 'put', kind: 'video', b64: got.b64, expect: h }, local);
  assert.deepEqual([kept.ok, kept.h], [true, h]);
  assert.ok((await M.read(local, h))?.type === 'video');
});

test('fromGallery refuses what is not that file: bad names, a redirect, an error, too many bytes, the wrong file or type', async () => {
  const webm = fx('clip.webm'), h = await M.sha(M.check(webm, 'bg').bytes);
  const never = async () => assert.fail('nothing is fetched');
  assert.deepEqual(await M.fromGallery('x', 'video', { fetch: never }), { ok: false, error: 'bad' }, 'not a hash');
  assert.deepEqual(await M.fromGallery(`${h}/../x`, 'video', { fetch: never }), { ok: false, error: 'bad' }, 'a path in the name');
  assert.deepEqual(await M.fromGallery(h, 'audio', { fetch: never }), { ok: false, error: 'bad' }, 'not a type');
  // redirect: 'error' makes fetch throw on any redirect; a server that answers 3xx anyway is refused too.
  assert.deepEqual(await M.fromGallery(h, 'video', { fetch: async () => { throw new TypeError('redirect'); } }), { ok: false, error: 'network' }, 'a redirect');
  assert.deepEqual(await M.fromGallery(h, 'video', { fetch: async () => respond(webm, { status: 302, headers: { location: 'https://evil.example/x' } }) }), { ok: false, error: 'network' }, '302');
  assert.deepEqual(await M.fromGallery(h, 'video', { fetch: async () => respond(webm, { status: 404 }) }), { ok: false, error: 'network' }, '404');
  assert.deepEqual(await M.fromGallery(h, 'video', { fetch: async () => Object.assign(respond(webm), { redirected: true }) }), { ok: false, error: 'network' }, 'followed somewhere');
  assert.deepEqual(await M.fromGallery(h, 'lottie', { fetch: async () => respond(webm, { length: M.LIMIT.bg.lottie + 1 }) }), { ok: false, error: 'big' }, 'a length over the cap');
  const huge = new Uint8Array(M.LIMIT.bg.lottie + 10);
  assert.deepEqual(await M.fromGallery(h, 'lottie', { fetch: async () => respond(huge, { length: 10 }) }), { ok: false, error: 'big' }, 'more bytes than it said, counted as they come');
  assert.deepEqual(await M.fromGallery(h, 'image', { fetch: async () => respond(new Uint8Array(M.LIMIT.bg.image.bytes + 1)) }), { ok: false, error: 'big' }, 'a picture over its cap');
  // Downloaded, but not the file the Look names, or not of its type: put refuses to keep it.
  const local = keeping();
  const other = await M.fromGallery(h, 'video', { fetch: async () => respond(fx('clip.mp4')) });
  assert.deepEqual(await M.change({ op: 'put', kind: 'video', b64: other.b64, expect: h }, local), { ok: false, error: 'hash' }, 'another file');
  const lottie = await M.fromGallery(h, 'video', { fetch: async () => respond(fx('spin.json')) });
  assert.deepEqual(await M.change({ op: 'put', kind: 'video', b64: lottie.b64, expect: h }, local), { ok: false, error: 'type' }, 'another type');
  assert.deepEqual([local.local.data, local.records.size], [{}, 0]);
});

// ---- Look parts: a bundle file is a mod's, never a Look's -----------------------------------------------------------------
test('a ./ path and its mod: spelling clean as a media source, but no Look or code may carry them', async () => {
  for (const src of ['./media/loop.webm', './a.json', './x.mp4', './p.webp', './p.avif', `mod:${ID}/media/loop.webm`]) {
    const x = { bg: { media: { type: 'video', src } } };
    assert.deepEqual(X.clean(x), x, src);
    assert.equal(X.bundle({ x }), null, `${src} in a Look`);
  }
  for (const src of ['./../x.webm', './.x.webm', './a/../b.webm', './/x.webm', '.\\x.webm', './x.exe', './x.svg', './x', '../x.webm', 'x.webm', `mod:${ID.toUpperCase()}/x.webm`, 'mod:abc/x.webm', `mod:${ID}/../x.webm`,
    `./${'a/'.repeat(8)}x.webm`, `./${'a'.repeat(240)}.webm`]) {
    assert.equal(X.clean({ bg: { media: { type: 'video', src } } }), null, src);
  }
  assert.equal(X.describe({ x: { bg: { media: { type: 'video', src: './a.webm' } } } })[0].why, 'Plays a video behind your pages, from a file that came with it.', 'a mod\'s file names no host');
  assert.equal(X.MEDIA.mod('./media/loop.webm'), 'media/loop.webm');
  assert.equal(X.MEDIA.mod(`mod:${ID}/a/b.json`), 'a/b.json');
  assert.equal(X.MEDIA.mod('file:' + 'A'.repeat(43)), null);
  assert.equal(await X.write({ sync: area(), local: area() }, { x: { bg: { media: { type: 'video', src: './a.webm' } } } }), false, 'not saved as a Look');
});

// ---- mod bundles -------------------------------------------------------------------------------------------------------
const manifest = (media, more = {}) => ({ glaze: 1, name: 'Loop', version: '1.0.0', author: { name: 'Kai' }, ...(media && { parts: { bg: { media } } }), ...more });
const packed = async (files, man) => BUNDLE.pack(files, man, await (key ||= BUNDLE.makeKey()));
let key;

test('a mod carries its background file: checked as a Look\'s, named by bgMedia, and said in the install prompt', async () => {
  for (const [type, file, bytes] of [['video', 'media/loop.webm', fx('clip.webm')], ['video', 'loop.mp4', fx('clip.mp4')], ['image', 'bg/a.webp', fx('anim.webp')], ['image', 'a.avif', fx('anim.avif')], ['lottie', 'spin.json', fx('spin.json')]]) {
    const got = await packed({ [file]: bytes }, manifest({ type, src: `./${file}` }));
    assert.deepEqual(BUNDLE.bgMedia(got.manifest), { type, src: `./${file}`, path: file }, file);
    assert.ok(BUNDLE.caps(got.manifest).includes('bgfile'), file);
    assert.deepEqual((await BUNDLE.read(got.bytes)).hash, got.hash, 'reads back');
  }
  assert.deepEqual(BUNDLE.bgMedia(manifest({ type: 'video', src: 'https://cdn.example.com/a.webm' })), { type: 'video', src: 'https://cdn.example.com/a.webm', path: null });
  assert.equal(BUNDLE.bgMedia(manifest()), null);
  assert.equal(BUNDLE.bgMedia(null), null);
  assert.equal(BUNDLE.bgMedia({ parts: { bg: { media: 'x' } } }), null);
  assert.deepEqual(BUNDLE.caps(manifest({ type: 'video', src: 'https://cdn.example.com/a.webm' })), ['media:cdn.example.com']);
});

test('a mod\'s background file that is missing, not its type, too big or not a background is refused with a reason', async () => {
  const why = /background file .* is missing, or isn't the video, animated picture or Lottie file/;
  await assert.rejects(packed({}, manifest({ type: 'video', src: './media/loop.webm' })), why, 'missing');
  await assert.rejects(packed({ 'loop.webm': fx('clip.webm') }, manifest({ type: 'image', src: './loop.webm' })), why, 'a video said to be a picture');
  await assert.rejects(packed({ 'a.json': fx('spin.json') }, manifest({ type: 'video', src: './a.json' })), why, 'a Lottie file said to be a video');
  await assert.rejects(packed({ 'a.webp': fx('clip.webm').slice(0, 12) }, manifest({ type: 'image', src: './a.webp' })), /kind mods can't carry/, 'bytes that are not their extension');
  await assert.rejects(packed({ 'a.json': new TextEncoder().encode('{"x":1}') }, manifest({ type: 'lottie', src: './a.json' })), why, 'JSON that is not a Lottie file');
  const big = new TextEncoder().encode(new TextDecoder().decode(fx('spin.json')) + ' '.repeat(M.LIMIT.bg.lottie));
  await assert.rejects(packed({ 'a.json': big }, manifest({ type: 'lottie', src: './a.json' })), why, 'over the background limit');
  await assert.rejects(packed({ 'x.webm': fx('clip.webm') }, manifest()), /kind mods can't carry: x.webm/, 'a video that is not the background');
  await assert.rejects(packed({ 'loop.webm': fx('clip.webm'), 'x.mp4': fx('clip.mp4') }, manifest({ type: 'video', src: './loop.webm' })), /kind mods can't carry: x.mp4/, 'a second video');
  await assert.rejects(packed({ 'loop.webm': fx('clip.webm') }, manifest({ type: 'video', src: `mod:${ID}/loop.webm` })), (e) => e.vars?.field === 'parts.bg.media.src', 'the page spelling');
  await assert.rejects(packed({ 'loop.webm': fx('clip.webm') }, manifest({ type: 'video', src: './../loop.webm' })), (e) => e.vars?.field === 'parts', 'a path up');
  await assert.rejects(packed({}, manifest({ type: 'video', src: `file:${'a'.repeat(43)}` })), (e) => e.vars?.field === 'parts.bg.media.src', 'the student\'s own kept file');
});

// ---- the worker's answers -----------------------------------------------------------------------------------------------
const rec = (id = ID, over = {}) => ({
  id, enabled: true, hash: `h-${id}`, key: `k-${id}`, version: '1.0.0', source: 'file', installedAt: 1, dev: false, grants: {},
  manifest: { glaze: 1, name: 'Loop', permissions: [], parts: { bg: { media: { type: 'video', src: './media/loop.webm', dim: 20 } } } },
  files: { 'media/loop.webm': b64(fx('clip.webm')), 'spin.json': b64(fx('spin.json')) },
  ...over,
});
const env = ({ records = [rec()], list = null, order, site = SITE, dev } = {}) => {
  const data = { mods: records.map((r) => r.id), ...(order && { modOrder: order }), ...(dev !== undefined && { modDev: dev }) };
  for (const r of records) data[`mod:${r.id}`] = r;
  return { site, local: area(data), sync: area(), queue: (f) => f(), keys: async () => Object.keys(data), record: async (id) => data[`mod:${id}`], blocklist: async () => list };
};

test('page parts name a carried file by its mod, which is the only file the media op serves, cleaned', async () => {
  const lot = rec(OTHER, { manifest: { glaze: 1, name: 'Spin', permissions: [], parts: { bg: { media: { type: 'lottie', src: './spin.json' } } } } });
  const e = env({ records: [rec(), lot], order: [OTHER, ID] });
  const parts = (await B.page({ op: 'parts' }, e)).parts;
  assert.deepEqual(parts.map((p) => p.bg.media.src), [`mod:${OTHER}/spin.json`, `mod:${ID}/media/loop.webm`]);
  assert.deepEqual(X.clean(parts[1]), parts[1], 'the page cleans them again, unchanged');
  assert.equal(X.over(null, parts).bg.media.src, `mod:${OTHER}/spin.json`, 'the first in the student\'s order wins');
  const v = await B.page({ op: 'media', src: `mod:${ID}/media/loop.webm` }, e);
  assert.deepEqual([v.ok, v.kind, v.mime], [true, 'video', 'video/webm']);
  assert.deepEqual(Buffer.from(v.b64, 'base64'), Buffer.from(fx('clip.webm')));
  const l = await B.page({ op: 'media', src: `mod:${OTHER}/spin.json` }, e);
  assert.deepEqual([l.ok, l.kind, l.json.w, l.canvases], [true, 'lottie', 200, 1]);
  // A code mod's override may name its own declared file only, and the page gets its mod: spelling.
  const over = await B.CALLS['look.override'].run([{ bg: { media: { type: 'video', src: './media/loop.webm' } } }], { ...e, mod: ID, rec: rec() });
  assert.equal(over.bg.media.src, `mod:${ID}/media/loop.webm`);
  await assert.rejects(async () => B.CALLS['look.override'].run([{ bg: { media: { type: 'video', src: `mod:${OTHER}/spin.json` } } }], { ...e, mod: ID, rec: rec() }), /permission/);
});

test('the media op refuses anything but an on mod\'s own declared background file', async () => {
  const src = `mod:${ID}/media/loop.webm`;
  const no = (error) => ({ ok: false, error });
  for (const [why, m, e, error] of [
    ['a file it carries that is not its background', { src: `mod:${ID}/spin.json` }, env(), 'asset'],
    ['a path up', { src: `mod:${ID}/../media/loop.webm` }, env(), 'asset'],
    ['a dot part', { src: `mod:${ID}/media/./loop.webm` }, env(), 'asset'],
    ['the manifest spelling', { src: './media/loop.webm' }, env(), 'asset'],
    ['a Look\'s file', { src: `file:${'A'.repeat(43)}` }, env(), 'asset'],
    ['an address', { src: 'https://cdn.example.com/a.webm' }, env(), 'asset'],
    ['not text', { src: 5 }, env(), 'op'],
    ['a mod that is not installed', { src: `mod:${OTHER}/media/loop.webm` }, env(), 'mod'],
    ['a mod turned off', { src }, env({ records: [rec(ID, { enabled: false })] }), 'mod'],
    ['a mod marked blocked', { src }, env({ records: [rec(ID, { blocked: 'x' })] }), 'mod'],
    ['a mod on the blocklist', { src }, env({ list: { bundles: [`h-${ID}`] } }), 'mod'],
    ['a dev copy with dev mode off', { src }, env({ records: [rec(ID, { dev: true })] }), 'mod'],
    ['a file that is gone', { src }, env({ records: [rec(ID, { files: {} })] }), 'asset'],
    ['a file that is not what it says', { src }, env({ records: [rec(ID, { files: { 'media/loop.webm': b64(fx('spin.json')) } })] }), 'asset'],
    ['a file that is not base64', { src }, env({ records: [rec(ID, { files: { 'media/loop.webm': '!!!' } })] }), 'asset'],
    ['not a page Glaze runs on', { src }, env({ site: null }), 'sender'],
  ]) assert.deepEqual(await B.page({ op: 'media', ...m }, e), no(error), why);
  assert.equal((await B.page({ op: 'media', src }, env({ records: [rec(ID, { dev: true })], dev: true }))).ok, true, 'a dev copy while dev mode is on');
});
