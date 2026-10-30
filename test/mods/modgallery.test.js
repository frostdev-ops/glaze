// "Use in Glaze" from the gallery's mod pages: lib/gallery.js hands { id, hash } to the worker, which downloads that exact
// bundle (lib/modbundle.js offer) and leaves an offer for the editor's prompt. Sender checks, the one request it makes, the
// hash, id, signature and blocklist refusals, the size cap, and the broker taking 'gallery' (Reviewed) only for that offer.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const M = require('../lib/modbundle.js');

const enc = new TextEncoder();
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const std = (b) => Buffer.from(b).toString('base64');
const AUTHOR = { kty: 'OKP', crv: 'Ed25519', d: 'nWGxne_9WmC6hEr0kuwsxERJxWl7MmkZcDusAxyuf2A', x: '11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo' };
const MANIFEST = { glaze: 1, name: 'Grade Ring', version: '1.0.0', author: { name: 'Kai' }, permissions: [{ id: 'grades', why: 'Draws a ring.' }], hooks: 'hooks.js' };
const pack = (more = {}) => M.pack({ 'hooks.js': enc.encode('glaze.ready;\n') }, { ...MANIFEST, ...more }, AUTHOR);
const URL_OF = (r) => `https://frostdev.io/glaze/mods/api/mods/${r.id}/${r.hash}.glazemod`;

// A fetch that serves `routes` (url → bytes or a Response) and records every call.
const server = (routes) => {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init });
    const r = routes[url];
    if (r instanceof Response) return r;
    return r ? new Response(r, { status: 200 }) : new Response('nope', { status: 404 });
  };
  return { fetch, calls };
};

test('offer: the exact signed bundle, fetched with no cookies, referrer or redirects', async () => {
  const mod = await pack();
  const s = server({ [URL_OF(mod)]: mod.bytes });
  const got = await M.offer({ id: mod.id, hash: mod.hash }, { fetch: s.fetch, blocked: () => '' });
  assert.deepEqual(Object.keys(got).sort(), ['at', 'hash', 'id', 'zip']);
  assert.equal(got.id, mod.id);
  assert.equal(got.hash, mod.hash);
  assert.deepEqual(Buffer.from(got.zip, 'base64'), Buffer.from(mod.bytes));
  assert.equal(s.calls.length, 1);
  const { init } = s.calls[0];
  assert.equal(s.calls[0].url, URL_OF(mod));
  assert.equal(init.credentials, 'omit');
  assert.equal(init.referrerPolicy, 'no-referrer');
  assert.equal(init.redirect, 'error');
  assert.ok(init.signal instanceof AbortSignal);
});

test('offer: refusals keep the reason for the editor and never carry a bundle', async () => {
  const mod = await pack();
  const other = await pack({ version: '1.1.0' });
  const unsigned = M.archive(Object.fromEntries(Object.entries(mod.files).filter(([p]) => p !== 'mod.sig')));
  const tampered = M.archive({ ...mod.files, 'hooks.js': enc.encode('steal();\n') });
  const ask = async (g, routes, blocked = () => '') => {
    const s = server(routes);
    const r = await M.offer(g, { fetch: s.fetch, blocked });
    assert.ok(!('zip' in r), JSON.stringify(r));
    return [r.error, s.calls.length, r.vars];
  };
  const g = { id: mod.id, hash: mod.hash };
  // Bad input: nothing is fetched.
  for (const bad of [null, {}, { id: mod.id }, { id: mod.id, hash: mod.hash, extra: 1 }, { id: 'UPPERCASEIDXXXXX', hash: mod.hash }, { id: mod.id, hash: `${mod.hash}=` }, { id: mod.id, hash: '../x' }, { id: `${mod.id}/..`, hash: mod.hash }]) {
    assert.deepEqual((await ask(bad, {})).slice(0, 2), ["That gallery link isn't a Glaze mod.", 0], JSON.stringify(bad));
  }
  assert.equal((await ask(g, {}))[0], "Glaze couldn't download that mod from the gallery. Try again later.", '404');
  assert.equal((await ask(g, { [URL_OF(mod)]: unsigned }))[0], "That mod isn't signed by its author, so Glaze won't take it from the gallery.");
  assert.equal((await ask(g, { [URL_OF(mod)]: tampered }))[0], "That mod's signature doesn't match its files: it was changed after its author signed it.");
  // A different (validly signed) bundle served under this hash, or under another mod's id.
  assert.equal((await ask(g, { [URL_OF(mod)]: other.bytes }))[0], "That mod isn't the one the gallery listed.");
  const elsewhere = { id: 'aaaaaaaaaaaaaaaa', hash: mod.hash };
  assert.equal((await ask(elsewhere, { [URL_OF(elsewhere)]: mod.bytes }))[0], "That mod isn't the one the gallery listed.");
  const [why, , vars] = await ask(g, { [URL_OF(mod)]: mod.bytes }, (r) => (r.id === mod.id ? 'Sends grades away.' : ''));
  assert.deepEqual([why, vars], ['Glaze has blocked this mod: {reason}', { reason: 'Sends grades away.' }]);
  // A network error or a redirect (fetch rejects with redirect: 'error').
  assert.equal((await M.offer(g, { fetch: async () => { throw new TypeError('redirect'); }, blocked: () => '' })).error, "Glaze couldn't download that mod from the gallery. Try again later.");
});

test('offer: the size cap holds whatever Content-Length says', async () => {
  const mod = await pack();
  const g = { id: mod.id, hash: mod.hash };
  const big = new Uint8Array(M.CAP.archive + 1);
  let headerCancelled = false;
  const said = new Response(new ReadableStream({
    start(c) { c.enqueue(mod.bytes); }, cancel() { headerCancelled = true; },
  }), { headers: { 'content-length': String(M.CAP.archive + 1) } });
  let r = await M.offer(g, { fetch: async () => said, blocked: () => '' });
  assert.match(r.error, /too big/);
  assert.ok(headerCancelled, 'an oversized Content-Length cancels the download too');
  // No length given: the stream is cut at the cap and the reader cancelled.
  let pulled = 0, cancelled = false;
  const stream = new ReadableStream({
    pull(c) { pulled += 1 << 16; if (pulled > big.length + (1 << 20)) c.close(); else c.enqueue(new Uint8Array(1 << 16)); },
    cancel() { cancelled = true; },
  });
  r = await M.offer(g, { fetch: async () => new Response(stream), blocked: () => '' });
  assert.match(r.error, /too big/);
  assert.ok(cancelled, 'the download stops at the cap');
  assert.ok(pulled <= M.CAP.archive + (3 << 16), `read ${pulled} bytes`);
});

// lib/background.js in a vm, as test/modbundle.test.js runs it.
const worker = (globals = {}) => {
  const local = {};
  const area = (s) => ({
    get: async (k) => structuredClone(k == null ? s : Object.fromEntries([].concat(k).filter((x) => x in s).map((x) => [x, s[x]]))),
    set: async (v) => { Object.assign(s, structuredClone(v)); },
    remove: async (k) => { for (const x of [].concat(k)) delete s[x]; },
  });
  const listeners = [], opened = [];
  const context = vm.createContext({
    URL, URLSearchParams, console, TextEncoder, TextDecoder, structuredClone, Promise, Date, AbortController, AbortSignal, Response, crypto: globalThis.crypto, atob, btoa, navigator: {},
    Blob, CompressionStream, DecompressionStream, DOMException, setTimeout, clearTimeout, ...globals,
    importScripts: (...files) => { for (const f of files) vm.runInContext(read(`lib/${f}`), context); },
    chrome: {
      runtime: { id: 'glaze', getURL: (f = '') => `chrome-extension://x/${f}`, getManifest: () => require('../manifest.json'), onMessage: { addListener: (f) => listeners.push(f) },
        openOptionsPage: async () => { opened.push('options'); }, onInstalled: { addListener() {} }, onStartup: { addListener() {} }, onConnect: { addListener() {} } },
      storage: { local: area(local), sync: area({ enabled: true }), onChanged: { addListener() {} } },
      tabs: { query: async () => [] },
      scripting: { getRegisteredContentScripts: async () => [], registerContentScripts: async () => {}, unregisterContentScripts: async () => {} },
    },
  });
  vm.runInContext(read('lib/background.js'), context);
  const send = (m, sender) => new Promise((res) => { let n = 0; for (const f of listeners) if (f(structuredClone(m), sender, (r) => res(structuredClone(r))) === true) n++; if (!n) setTimeout(res, 0); });
  const settle = async () => { for (let i = 0; i < 50; i++) await new Promise((r) => setTimeout(r, 2)); };
  return { local, send, settle, opened };
};
const PAGE = { id: 'glaze', url: 'https://frostdev.io/glaze/mods/grade-ring', frameId: 0, tab: { id: 4 } };
const EDITOR = { id: 'glaze', url: 'chrome-extension://x/options.html#mods', frameId: 0, origin: 'chrome-extension://x' };

test('worker: only a top frame of the gallery mod pages hands a mod over, and the editor opens on its offer', async () => {
  const mod = await pack();
  const s = server({ [URL_OF(mod)]: mod.bytes });
  const w = worker({ fetch: s.fetch });
  const g = { galleryMod: { id: mod.id, hash: mod.hash } };
  for (const sender of [{ ...PAGE, frameId: 2 }, { ...PAGE, id: 'other' }, { ...PAGE, tab: undefined }, { ...PAGE, url: 'https://frostdev.io/glaze/looks/x' },
    { ...PAGE, url: 'https://frostdev.io/glaze/modsevil' }, { ...PAGE, url: 'http://frostdev.io/glaze/mods/x' }, { ...PAGE, url: 'https://evil.example/glaze/mods/x' }, EDITOR]) {
    await w.send(g, sender);
  }
  await w.settle();
  assert.equal(s.calls.length, 0, 'no request for a sender that is not the gallery');
  assert.deepEqual(w.local, {});
  await w.send(g, PAGE);
  await w.settle();
  assert.deepEqual(s.calls.map((c) => c.url), [URL_OF(mod)]);
  assert.equal(w.local.modOffer.hash, mod.hash);
  assert.deepEqual(w.opened, ['options']);
  assert.ok(!w.local[`mod:${mod.id}`], 'nothing installs before the prompt');

  // The broker takes source 'gallery' only for that offer's hash, and the install clears the offer.
  const install = (r, source = 'gallery') => w.send({ type: 'glaze:mods', op: 'install', zip: std(r.bytes), hash: r.hash, grants: ['grades'], source }, EDITOR);
  const other = await pack({ version: '1.1.0' });
  assert.deepEqual(await install(other), { ok: false, error: 'bad' }, 'not the bundle the gallery handed over');
  const done = await install(mod);
  assert.equal(done.ok, true);
  assert.equal(w.local[`mod:${mod.id}`].source, 'gallery');
  assert.ok(!('modOffer' in w.local));
  assert.deepEqual(await install(other), { ok: false, error: 'bad' }, 'no offer left');
  assert.equal((await install(other, 'file')).ok, true, 'a file is a file');
  assert.equal(w.local[`mod:${mod.id}`].source, 'file', 'an update from elsewhere is no longer Reviewed');
});

test('worker: a refused download still opens the editor, with the reason', async () => {
  const mod = await pack();
  const w = worker({ fetch: server({}).fetch });
  await w.send({ galleryMod: { id: mod.id, hash: mod.hash } }, PAGE);
  await w.settle();
  assert.equal(w.local.modOffer.error, "Glaze couldn't download that mod from the gallery. Try again later.");
  assert.ok(!('zip' in w.local.modOffer));
  assert.deepEqual(w.opened, ['options']);
});

test('worker: gallery provenance belongs to the signed offer, not an unsigned copy with the same hash', async () => {
  const mod = await pack();
  const unsigned = M.archive(Object.fromEntries(Object.entries(mod.files).filter(([p]) => p !== 'mod.sig')));
  assert.equal((await M.read(unsigned)).hash, mod.hash);
  const w = worker({ fetch: server({ [URL_OF(mod)]: mod.bytes }).fetch });
  w.local.modDev = true;
  await w.send({ galleryMod: { id: mod.id, hash: mod.hash } }, PAGE);
  await w.settle();
  const r = await w.send({ type: 'glaze:mods', op: 'install', zip: std(unsigned), hash: mod.hash, grants: ['grades'], source: 'gallery' }, EDITOR);
  assert.deepEqual(r, { ok: false, error: 'bad' });
  assert.ok(!w.local[`mod:${mod.id}`]);
  assert.equal(w.local.modOffer.zip, std(mod.bytes), 'the real offer remains available');
});

test('worker: extra gallery fields cannot trigger a request', async () => {
  const mod = await pack(), s = server({ [URL_OF(mod)]: mod.bytes });
  const w = worker({ fetch: s.fetch });
  await w.send({ galleryMod: { id: mod.id, hash: mod.hash, extra: 'ignored?' } }, PAGE);
  await w.settle();
  assert.equal(s.calls.length, 0, 'do not discard unexpected fields before validating');
});

test('worker: mixed Look/mod messages cannot trigger a request or an offer', async () => {
  const mod = await pack(), s = server({ [URL_OF(mod)]: mod.bytes });
  const w = worker({ fetch: s.fetch });
  const mixed = { galleryMod: { id: mod.id, hash: mod.hash }, gallery: { code: 'glaze1:abc', name: 'Look' } };
  await w.send(mixed, PAGE);
  await w.send(mixed, { ...PAGE, url: 'https://frostdev.io/glaze/looks/x' });
  await w.settle();
  assert.equal(s.calls.length, 0);
  assert.ok(!w.local.galleryOffer);
});

test('worker: dismissing an offer only clears that exact pending offer', async () => {
  const w = worker();
  w.local.modOffer = { zip: 'new', at: 2 };
  const dismiss = (zip, at) => w.send({ type: 'glaze:mods', op: 'dismissOffer', zip, at }, EDITOR);
  assert.equal((await dismiss('old', 1)).ok, true);
  assert.equal(w.local.modOffer.zip, 'new');
  assert.equal((await dismiss('new', 2)).ok, true);
  assert.ok(!w.local.modOffer);
  w.local.modOffer = { error: 'download failed', at: 3 };
  await dismiss(null, 2);
  assert.ok(w.local.modOffer, 'a stale refusal cannot dismiss a newer refusal');
  await dismiss(null, 3);
  assert.ok(!w.local.modOffer);
});
