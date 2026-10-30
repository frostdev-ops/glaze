// The worker's side of media (lib/background.js): who may keep and drop the files a Look names (the editor's top frame), and who may
// ask for a Lottie file's cleaned JSON (a page Glaze runs on, only for the address the worn Look names; the editor and its preview
// frame, for the address they are showing). Run from the worker's own source, with stand-ins for storage and the network.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const M = require('../lib/media.js');
const X = require('../lib/lookparts.js');
const B = require('../lib/modbroker.js');
const G = require('../defaults.js');

const source = fs.readFileSync(path.join(__dirname, '../lib/background.js'), 'utf8');
const slice = source.slice(source.indexOf('// Media for a Look (lib/media.js)'), source.indexOf("// Share keys and relay traffic"));
const frames = source.slice(source.indexOf('// Frames the worker trusts, by what for.'), source.indexOf('const BROKER = {')); // trustedFrame, whose Settings frame none claimed here
const spin = fs.readFileSync(path.join(__dirname, 'fixtures/media/spin.json'), 'utf8');
const URL1 = 'https://cdn.example.com/spin.json';
const OTHER = 'https://cdn.example.com/other.json';

const rig = async ({ worn = URL1, wornType = 'lottie', body = spin, lms = 'https://school.instructure.com', installed = {}, respond = null } = {}) => {
  const listeners = [], fetched = [], local = { data: {} };
  const lookX = worn ? await X.pack({ x: { bg: { media: { type: wornType, src: worn } } } }) : '';
  const area = (data) => ({ get: async (k) => Object.fromEntries([].concat(k === null ? Object.keys(data) : k).filter((x) => x in data).map((x) => [x, structuredClone(data[x])])),
    set: async (p) => { Object.assign(data, structuredClone(p)); return true; }, remove: async (k) => { for (const x of [].concat(k)) delete data[x]; return true; } });
  const sync = { lookX }, local2 = installed;
  const ctx = vm.createContext({
    BROKER: {}, BROKER_FILES: {}, GZ_MEDIA: M, GZ_XPARTS: X, GZ_MODBROKER: B, importScripts() {}, URL, console,
    GZ_SANITIZE: G.GZ_SANITIZE, GZ_LOOKS: G.GZ_LOOKS, GZ_CATALOG: require('../lib/looks.js'), GZ_SHARE: require('../lib/share.js'),
    addressOf: (s) => s.url, approved: async () => false,
    MEDIA_FILES: { get: async () => undefined, put: async () => {}, del: async () => {}, keys: async () => [] },
    chrome: { runtime: { id: 'glaze', getURL: (p = '') => `chrome-extension://glaze/${p}`, onMessage: { addListener: (f) => listeners.push(f) } } },
    fromEditor: (s) => s.id === 'glaze' && s.url?.split(/[?#]/)[0] === 'chrome-extension://glaze/options.html',
    fromLms: async (s) => (s.id === 'glaze' && s.tab && s.frameId === 0 && s.url?.startsWith(lms) ? lms : null),
    brokerArea: (name) => area(name === 'sync' ? sync : local2),
    reachable: async () => true, // the address's host held (test/feature-hosts.test.js: one that isn't)
    setTimeout, clearTimeout,
    fetch: async (u, i) => { fetched.push([u, i]); return respond ? respond(u, i) : new Response(body, { status: 200 }); },
  });
  vm.runInContext(`${frames}\n${slice}\nglobalThis.media = BROKER.media;`, ctx);
  const ask = (m, s) => new Promise((res) => { for (const f of listeners) if (f(m, s, (r) => res(JSON.parse(JSON.stringify(r)))) === true) return; res('ignored'); });
  return { media: ctx.media, ask, fetched, sync };
};
const editor = { id: 'glaze', frameId: 0, url: 'chrome-extension://glaze/options.html#look/background' };
const preview = { id: 'glaze', frameId: 0, url: 'chrome-extension://glaze/preview.html?site=ultra' };
const page = { id: 'glaze', frameId: 0, tab: { id: 1 }, url: 'https://school.instructure.com/ultra/stream' };

test('only the editor\'s top frame puts, lists, keeps, drops and resets the files kept for a Look', async () => {
  const { media } = await rig();
  for (const op of ['put', 'list', 'drop', 'keep', 'reset']) assert.equal(media.allow({ op }, editor), true, op);
  for (const op of ['lottie', 'file', 'nope', undefined]) assert.equal(media.allow({ op }, editor), false, String(op));
  for (const s of [{ ...editor, frameId: 1 }, preview, page, { ...editor, id: 'another-extension' }, { id: 'glaze', frameId: 0, url: 'https://evil.example/options.html' }]) assert.equal(media.allow({ op: 'put' }, s), false, JSON.stringify(s));
  assert.equal(typeof media.run, 'function');
});

test('a page gets a Lottie file only for the address the worn Look names; the editor and its preview for the one they show', async () => {
  const r = await rig();
  const ask = (src, s) => r.ask({ type: 'glaze:lottie', src }, s);
  const fine = await ask(URL1, page);
  assert.equal(fine.ok, true);
  assert.equal(fine.json.w, 200);
  assert.equal(r.fetched.length, 1);
  assert.deepEqual([r.fetched[0][0], r.fetched[0][1].credentials, r.fetched[0][1].redirect, r.fetched[0][1].referrerPolicy], [URL1, 'omit', 'manual', 'no-referrer']);
  // Another address: refused before anything is fetched.
  assert.deepEqual(await ask(OTHER, page), { ok: false, error: 'bad' });
  assert.equal(r.fetched.length, 1);
  assert.equal((await ask(OTHER, editor)).ok, true, 'the editor may try an address');
  assert.equal((await ask(OTHER, preview)).ok, true, 'and so may its preview frame');
  assert.equal(r.fetched.length, 3);
  for (const bad of [{ ...page, frameId: 2 }, { ...page, tab: undefined }, { ...page, id: 'other' }, { ...page, url: 'https://elsewhere.example/ultra' }, { ...preview, id: 'x' }, { id: 'glaze', frameId: 0, url: 'chrome-extension://glaze/sharing/quick.html' }]) {
    assert.deepEqual(await ask(URL1, bad), { ok: false, error: 'sender' }, JSON.stringify(bad));
  }
  assert.equal(r.fetched.length, 3, 'a refused sender fetches nothing');
  // Other messages are not this listener's.
  assert.equal(await r.ask({ type: 'glaze:other' }, page), 'ignored');
  assert.equal(await r.ask(null, page), 'ignored');
});

test('with no Look worn that names an address, a page may have none; a file the Look names needs no fetch', async () => {
  const none = await rig({ worn: null });
  assert.deepEqual(await none.ask({ type: 'glaze:lottie', src: URL1 }, page), { ok: false, error: 'bad' });
  assert.equal(none.fetched.length, 0);
  for (const src of [5, null, undefined, '', 'http://cdn.example.com/a.json', 'https://127.0.0.1/a.json', `file:${'A'.repeat(43)}`, {}]) {
    const r = await rig();
    const got = await r.ask({ type: 'glaze:lottie', src }, page);
    assert.equal(got.ok, false, String(src));
    assert.equal(r.fetched.length, 0, `${String(src)} fetches nothing`);
  }
});

test('a Lottie fetch is not held up by, and does not hold up, the broker\'s queue', () => {
  assert.match(slice, /chrome\.runtime\.onMessage\.addListener\(\(m, s, reply\) => \{\n  if \(m\?\.type !== 'glaze:lottie'\) return;/);
  assert.doesNotMatch(slice.split("'glaze:lottie'")[1], /brokerTurn|GZ_CARDS/);
});

test('installed mod Lottie sources are authorized only while the mod is eligible to supply parts', async () => {
  const id = 'a'.repeat(16);
  const rec = { id, hash: 'bundle', key: 'author', enabled: true, manifest: { parts: { bg: { media: { type: 'lottie', src: URL1 } } } } };
  const run = async (record, more = {}, mods = [id]) => {
    const r = await rig({ worn: null, installed: { mods, [`mod:${id}`]: record, ...more } });
    return { r, result: await r.ask({ type: 'glaze:lottie', src: URL1 }, page) };
  };
  const good = await run(rec);
  assert.equal(good.result.ok, true, 'a mod background needs no separate worn Look');
  assert.equal(good.r.fetched.length, 1);
  assert.equal((await good.r.ask({ type: 'glaze:lottie', src: OTHER }, page)).ok, false, 'only the signed source is allowed');
  for (const [record, more, mods] of [
    [{ ...rec, enabled: false }], [{ ...rec, blocked: 'removed' }], [{ ...rec, dev: true }],
    [rec, { modsBlocklist: { list: { mods: [id] } } }], [rec, {}, []],
    [{ ...rec, manifest: { parts: { bg: { media: { type: 'image', src: URL1 } } } } }],
  ]) {
    const refused = await run(record, more, mods);
    assert.equal(refused.result.ok, false);
    assert.equal(refused.r.fetched.length, 0, 'ineligible sources cause no request');
  }
  assert.equal((await run({ ...rec, dev: true }, { modDev: true })).result.ok, true);
});

// ---- a video or an animated picture at an address (LOOK-6) ---------------------------------------------------------------------
const CLIP = 'https://cdn.example.com/loop.webm';
const clip = fs.readFileSync(path.join(__dirname, 'fixtures/media/clip.webm'));
const webp = fs.readFileSync(path.join(__dirname, 'fixtures/media/anim.webp'));

test('a page gets a remote video or picture, cleaned, only for the address and kind the worn Look names', async () => {
  const r = await rig({ worn: CLIP, wornType: 'video', body: clip });
  const ask = (src, kind, s = page) => r.ask({ type: 'glaze:remoteMedia', src, kind }, s);
  const fine = await ask(CLIP, 'video');
  assert.deepEqual([fine.ok, fine.type, fine.mime], [true, 'video', 'video/webm']);
  assert.equal(Buffer.from(fine.b64, 'base64').length > 0, true);
  assert.deepEqual([r.fetched.length, r.fetched[0][0], r.fetched[0][1].credentials, r.fetched[0][1].redirect, r.fetched[0][1].referrerPolicy], [1, CLIP, 'omit', 'manual', 'no-referrer']);
  // Another address, or the worn address as another kind: refused before anything is fetched.
  assert.deepEqual(await ask('https://cdn.example.com/other.webm', 'video'), { ok: false, error: 'bad' });
  assert.deepEqual(await ask(CLIP, 'image'), { ok: false, error: 'bad' }, 'the Look names a video there');
  assert.deepEqual(await ask(CLIP, 'lottie'), { ok: false, error: 'bad' });
  assert.equal(r.fetched.length, 1);
  assert.equal((await ask('https://cdn.example.com/other.webm', 'video', editor)).ok, true, 'the editor may try an address');
  assert.equal((await ask('https://cdn.example.com/other.webm', 'video', preview)).ok, true, 'and so may its preview frame');
  assert.equal(r.fetched.length, 3);
  for (const bad of [{ ...page, frameId: 2 }, { ...page, tab: undefined }, { ...page, id: 'other' }, { ...page, url: 'https://elsewhere.example/ultra' }, { ...preview, id: 'x' }, { id: 'glaze', frameId: 0, url: 'chrome-extension://glaze/sharing/quick.html' }]) {
    assert.deepEqual(await ask(CLIP, 'video', bad), { ok: false, error: 'sender' }, JSON.stringify(bad));
  }
  assert.equal(r.fetched.length, 3, 'a refused sender fetches nothing');
});

test('a remote address that points inward, is not https or is not as cleaned is never fetched, even for the worn Look', async () => {
  for (const src of ['https://192-168-1-1.nip.io/a.webm', 'https://localtest.me/a.webm', 'https://127.0.0.1/a.webm', 'http://cdn.example.com/a.webm', 'https://CDN.example.com/a.webm', `file:${'A'.repeat(43)}`, 5, null, undefined, '']) {
    const r = await rig({ worn: typeof src === 'string' ? src : null, wornType: 'video', body: clip });
    const got = await r.ask({ type: 'glaze:remoteMedia', src, kind: 'video' }, page);
    assert.equal(got.ok, false, String(src));
    assert.equal(r.fetched.length, 0, `${String(src)} fetches nothing`);
  }
});

test('what the address serves is read as a kept file is: a picture past the caps, or another kind, is refused after the fetch', async () => {
  const mp4 = fs.readFileSync(path.join(__dirname, 'fixtures/media/clip.mp4'));
  const a = await rig({ worn: CLIP, wornType: 'image', body: clip });
  assert.deepEqual(await a.ask({ type: 'glaze:remoteMedia', src: CLIP, kind: 'image' }, page), { ok: false, error: 'type' }, 'a video where a picture was named');
  const b = await rig({ worn: CLIP, wornType: 'video', body: webp });
  assert.deepEqual(await b.ask({ type: 'glaze:remoteMedia', src: CLIP, kind: 'video' }, page), { ok: false, error: 'type' });
  const c = await rig({ worn: CLIP, wornType: 'video', body: mp4 });
  assert.equal((await c.ask({ type: 'glaze:remoteMedia', src: CLIP, kind: 'video' }, page)).mime, 'video/mp4');
});

test('installed mods\' video and picture sources are authorized only for their own kind, while the mod is eligible', async () => {
  const id = 'a'.repeat(16);
  const rec = (type) => ({ id, hash: 'bundle', key: 'author', enabled: true, manifest: { parts: { bg: { media: { type, src: CLIP } } } } });
  const run = async (record, kind, mods = [id]) => {
    const r = await rig({ worn: null, body: clip, installed: { mods, [`mod:${id}`]: record } });
    return { r, result: await r.ask({ type: 'glaze:remoteMedia', src: CLIP, kind }, page) };
  };
  const good = await run(rec('video'), 'video');
  assert.equal(good.result.ok, true);
  assert.equal(good.r.fetched.length, 1);
  assert.equal((await good.r.ask({ type: 'glaze:remoteMedia', src: 'https://cdn.example.com/other.webm', kind: 'video' }, page)).ok, false, 'only the signed source is allowed');
  for (const [record, kind, mods] of [[rec('image'), 'video'], [rec('video'), 'image'], [rec('lottie'), 'video'], [{ ...rec('video'), enabled: false }, 'video'], [{ ...rec('video'), blocked: 'removed' }, 'video'], [rec('video'), 'video', []]]) {
    const refused = await run(record, kind, mods);
    assert.equal(refused.result.ok, false);
    assert.equal(refused.r.fetched.length, 0, 'ineligible sources cause no request');
  }
});

test('a remote media fetch is not held up by, and does not hold up, the broker\'s queue', () => {
  assert.match(slice, /chrome\.runtime\.onMessage\.addListener\(\(m, s, reply\) => \{\n  if \(m\?\.type !== 'glaze:remoteMedia'\) return;/);
  assert.doesNotMatch(slice.split("'glaze:remoteMedia'")[1], /brokerTurn|GZ_CARDS/);
});

test('simultaneous remote requests share one download only after each caller is authorized', async (t) => {
  const url = 'https://cdn.example.com/a.webm', bytes = fs.readFileSync(path.join(__dirname, 'fixtures/media/clip.webm'));
  const gates = [];
  const r = await rig({ worn: url, wornType: 'video', respond: () => new Promise((resolve) => gates.push(resolve)) });
  t.after(() => gates.forEach((resolve) => resolve(new Response(bytes))));
  const requests = Array.from({ length: 20 }, () => r.ask({ type: 'glaze:remoteMedia', src: url, kind: 'video' }, page));
  for (let i = 0; i < 100 && r.fetched.length < 20; i++) await new Promise((resolve) => setTimeout(resolve, 2));
  assert.equal(r.fetched.length, 1, 'tabs using the same file do not each allocate another full download');
  const bad = await r.ask({ type: 'glaze:remoteMedia', src: url, kind: 'video' }, { ...page, id: 'other-extension' });
  assert.deepEqual(bad, { ok: false, error: 'sender' }, 'an unauthorized caller cannot join an in-flight answer');
  gates.forEach((resolve) => resolve(new Response(bytes)));
  assert.ok((await Promise.all(requests)).every((x) => x.ok));
  const again = r.ask({ type: 'glaze:remoteMedia', src: url, kind: 'video' }, page);
  for (let i = 0; i < 100 && r.fetched.length < 2; i++) await new Promise((resolve) => setTimeout(resolve, 2));
  assert.equal(r.fetched.length, 2, 'completed media is not retained as an unbounded worker cache');
  gates.at(-1)(new Response(bytes));
  assert.equal((await again).ok, true);
});

test('the worker bounds distinct remote downloads rather than retaining an unbounded waiting queue', async (t) => {
  const bytes = fs.readFileSync(path.join(__dirname, 'fixtures/media/clip.webm')), gates = [];
  const r = await rig({ respond: () => new Promise((resolve) => gates.push(resolve)) });
  t.after(() => gates.forEach((resolve) => resolve(new Response(bytes))));
  const request = (name) => r.ask({ type: 'glaze:remoteMedia', src: `https://cdn.example.com/${name}.webm`, kind: 'video' }, preview);
  const a = request('a'), b = request('b');
  await new Promise(setImmediate);
  const c = request('c');
  const result = await Promise.race([c, new Promise((resolve) => setTimeout(() => resolve('still downloading'), 100))]);
  assert.deepEqual(result, { ok: false, error: 'network' });
  assert.equal(r.fetched.length, 2);
  gates.forEach((resolve) => resolve(new Response(bytes)));
  assert.ok((await Promise.all([a, b])).every((x) => x.ok));
});
