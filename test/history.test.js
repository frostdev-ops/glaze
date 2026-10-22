const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const H = require('../lib/history.js');
const G = require('../defaults.js');
const m = require('../manifest.json');
const M = require('../lib/media.js');
const { fakeIDB } = require('./helpers/fake-idb.cjs');

const looks = Object.fromEntries(G.GZ_LOOKS.map((L) => [L.name, L]));
const wearing = (name, s = G.GZ_DEFAULTS) => G.GZ_SANITIZE({ ...s, ...G.GZ_LOOK_APPLY(s, looks[name]) });

test('history keeps one entry per theme, newest first, capped', () => {
  let list = H.add([], G.GZ_DEFAULTS, 1);
  assert.equal(H.add(list, G.GZ_DEFAULTS, 2), list, 'wearing the same theme again changes nothing');
  list = H.add(list, wearing('Terminal'), 2);
  list = H.add(list, G.GZ_DEFAULTS, 3);
  assert.deepEqual(list.map((e) => e.at), [3, 2], 'the defaults moved to the front, once');
  // Tooltips and hints are behavior, not a theme.
  assert.equal(H.add(list, { ...G.GZ_DEFAULTS, look: { ...G.GZ_DEFAULTS.look, tooltips: false } }, 4), list);
  for (let i = 0; i < 30; i++) list = H.add(list, { ...G.GZ_DEFAULTS, look: { ...G.GZ_DEFAULTS.look, radius: i } }, 10 + i);
  assert.equal(list.length, H.MAX);
});

test('Previous Look is the newest theme that is not the one worn, and wearing it keeps tooltips and hints', () => {
  const mine = G.GZ_SANITIZE({ ...G.GZ_DEFAULTS, look: { ...G.GZ_DEFAULTS.look, tooltips: false, hints: false, radius: 3 }, auto: { on: true, light: 'Paper', dark: 'Midnight' } });
  const now = wearing('Synthwave', mine);
  const list = H.add(H.add([], mine, 1), now, 2);
  const back = H.previous(list, now);
  assert.ok(back && !H.wearing(now, back));
  const patch = H.wear(now, back);
  assert.deepEqual(Object.keys(patch).sort(), [...H.KEYS].sort());
  const after = G.GZ_SANITIZE({ ...now, ...patch });
  assert.equal(after.look.radius, 3);
  assert.deepEqual(after.auto, mine.auto, 'auto light/dark comes back with it');
  assert.equal(after.look.tooltips, false);
  assert.ok(H.wearing(after, back));
  assert.equal(H.previous(H.add(list, after, 3), after).theme.colors['--gz-accent'], looks.Synthwave.colors['--gz-accent'], 'and back again');
  assert.equal(H.previous([], now), null);
});

test('favorites are one per code, newest first, capped; bad stored lists are dropped', () => {
  let favs = [];
  for (let i = 0; i < 120; i++) favs = H.favor(favs, { code: `glaze1:${i % 110}`, name: `n${i}`, author: '', at: i });
  assert.equal(favs.length, H.MAX_FAVORITES);
  assert.equal(favs[0].name, 'n119');
  assert.equal(new Set(favs.map((f) => f.code)).size, favs.length);
  assert.deepEqual(H.favorites([null, { code: 1, name: 'x' }, { code: 'glaze1:a', name: 'ok' }, 'x']), [{ code: 'glaze1:a', name: 'ok' }]);
  assert.deepEqual(H.favorites('nope'), []);
  assert.deepEqual(H.entries([null, { theme: 'x' }, { theme: {}, at: 1 }]), [{ theme: {}, at: 1 }]);
});

// The background, run as the browser would: the gallery hand-off and the history it records.
const worker = ({ fetch } = {}) => {
  const on = { message: [], changed: [] };
  const local = {};
  const sync = {};
  const timers = [];
  // hold(): storage reads wait until the returned release() is called, as a slow write queue would.
  let gate = Promise.resolve();
  const hold = () => { let release; gate = new Promise((r) => { release = r; }); return release; };
  const opened = [];
  const area = (store) => ({
    get: async (k) => (await gate, k === null ? structuredClone(store) : Object.fromEntries([].concat(k).filter((x) => x in store).map((x) => [x, structuredClone(store[x])]))),
    set: async (v) => { Object.assign(store, structuredClone(v)); },
  });
  const context = vm.createContext({
    URL, console, TextEncoder, TextDecoder, Blob, CompressionStream, DecompressionStream, btoa, atob, structuredClone, Promise, Date, crypto, AbortSignal, fetch,
    ...fakeIDB(), // the worker's own IndexedDB, where it keeps a Look's files
    setTimeout: (f) => timers.push(f), clearTimeout: () => timers.splice(0),
    importScripts: (...files) => { for (const f of files) vm.runInContext(fs.readFileSync(require.resolve(`../lib/${f}`), 'utf8'), context); },
    chrome: {
      runtime: {
        id: 'glaze', getURL: (f = '') => `chrome-extension://x/${f}`, getManifest: () => m,
        openOptionsPage: () => { opened.push('options'); return Promise.resolve(); },
        onMessage: { addListener: (f) => on.message.push(f) }, onInstalled: { addListener() {} }, onStartup: { addListener() {} }, onConnect: { addListener() {} },
      },
      storage: { local: area(local), sync: area(sync), onChanged: { addListener: (f) => on.changed.push(f) } },
    },
  });
  vm.runInContext(fs.readFileSync(require.resolve('../lib/background.js'), 'utf8'), context);
  const send = (msg, sender, reply = () => {}) => on.message.forEach((f) => f(msg, sender, reply));
  const change = (changes) => on.changed.forEach((f) => f(changes, 'sync'));
  const tick = () => new Promise(setImmediate);
  // A glaze2 code is read (for a background file to fetch) before it is offered.
  const settle = async () => {
    for (let i = 0; i < 1000 && !local.galleryOffer; i++) await new Promise((r) => setTimeout(r, 5));
    assert.ok(local.galleryOffer, 'the gallery hand-off finishes');
  };
  return { send, change, tick, settle, timers, local, sync, opened, hold };
};

test('editor history checkpoints merge on the recording/clear queue and reject untrusted frames', async () => {
  const w = worker(), editor = { id: 'glaze', url: 'chrome-extension://x/options.html', frameId: 0 };
  const settle = async () => { for (let i = 0; i < 15; i++) await w.tick(); };
  const first = wearing('Lagoon'), typed = { ...first, look: { ...first.look, radius: 2 } }, next = wearing('Library');
  Object.assign(w.sync, first);
  w.change({ colors: { oldValue: G.GZ_DEFAULTS.colors, newValue: first.colors } });
  const answers = [];
  w.send({ type: 'glaze:history-checkpoint', theme: typed }, editor, (r) => answers.push(r));
  await settle();
  assert.equal(answers[0]?.ok, true, 'checkpoint acknowledged before a replacement is saved');
  Object.assign(w.sync, next);
  w.change({ colors: { oldValue: first.colors, newValue: next.colors } });
  w.timers.shift()();
  await settle();
  assert.ok(H.wearing(typed, H.previous(w.local.lookHistory, next)), 'older burst origin cannot displace typed checkpoint');
  const release = w.hold();
  w.send({ type: 'glaze:history-checkpoint', theme: first }, editor);
  w.send('clear-history', editor);
  w.send({ type: 'glaze:history-checkpoint', theme: typed }, editor);
  release();
  await settle();
  assert.equal(w.local.lookHistory.length, 1, 'clear wins over earlier checkpoint, later checkpoint survives');
  assert.ok(H.wearing(typed, w.local.lookHistory[0]));
  const before = JSON.stringify(w.local.lookHistory);
  for (const sender of [{ ...editor, id: 'other' }, { ...editor, frameId: 4, tab: { id: 3 } }, { ...editor, url: 'https://school.test/options.html' }]) {
    w.send({ type: 'glaze:history-checkpoint', theme: first }, sender);
  }
  await settle();
  assert.equal(JSON.stringify(w.local.lookHistory), before);
});

test('the gallery content script runs only on the gallery, and the background takes codes only from there', async () => {
  const entry = m.content_scripts.find((c) => c.js.includes('lib/gallery.js'));
  assert.deepEqual(entry.matches, ['https://frostdev.io/glaze/looks', 'https://frostdev.io/glaze/looks/*', 'https://frostdev.io/glaze/mods', 'https://frostdev.io/glaze/mods/*']);
  assert.ok(!entry.all_frames);
  assert.deepEqual(m.permissions, ['storage', 'scripting', 'unlimitedStorage'], 'no permission for the gallery');
  const w = worker();
  const code = 'glaze1:abc';
  for (const [url, frameId] of [['https://evil.example/glaze/looks/', 0], ['https://frostdev.io/glaze', 0], ['https://frostdev.io/glaze/looksevil', 0], ['https://frostdev.io/glaze/looksevil/', 0], ['http://frostdev.io/glaze/looks/', 0], ['https://frostdev.io.evil.example/glaze/looks/', 0], ['https://frostdev.io/glaze/looks/', 3], ['https://frostdev.io/glaze/mods/', 0], ['https://frostdev.io/glaze/mods', 0], [undefined, 0]]) {
    w.send({ gallery: { code, name: 'X', author: 'y' } }, { url, frameId });
  }
  w.send({ gallery: { code: 'x'.repeat(20001), name: 'X' } }, { url: 'https://frostdev.io/glaze/looks/', frameId: 0 });
  await w.tick();
  assert.deepEqual(w.local, {});
  assert.deepEqual(w.opened, []);
  w.send({ gallery: { code, name: 'Aurora Night', author: 'frostdev-ops', extra: 1 } }, { url: 'https://frostdev.io/glaze/looks/#aurora-night', frameId: 0 });
  await w.tick();
  assert.deepEqual(w.local.galleryOffer, { code, name: 'Aurora Night', author: 'frostdev-ops' });
  assert.deepEqual(w.opened, ['options']);
  // The page itself, without the slash, with a query or a fragment.
  for (const url of ['https://frostdev.io/glaze/looks', 'https://frostdev.io/glaze/looks?q=x#clear']) {
    delete w.local.galleryOffer;
    w.send({ gallery: { code, name: 'A' } }, { url, frameId: 0 });
    await w.tick();
    assert.equal(w.local.galleryOffer?.code, code, url);
  }
});

test('the background records the theme left and the theme worn once a burst of changes rests', async () => {
  const w = worker();
  const before = G.GZ_SANITIZE({});
  const after = wearing('Lagoon', before);
  Object.assign(w.sync, after);
  w.change({ colors: { oldValue: before.colors, newValue: after.colors }, look: { oldValue: before.look, newValue: after.look }, bg: { oldValue: before.bg, newValue: after.bg } });
  w.change({ enabled: { oldValue: true, newValue: false } }); // not a theme: ignored
  await w.tick();
  assert.equal(w.timers.length, 1, 'one timer for the burst');
  w.timers.shift()();
  for (let i = 0; i < 5; i++) await w.tick();
  const list = w.local.lookHistory;
  assert.equal(list.length, 2);
  assert.ok(H.wearing(after, list[0]));
  assert.ok(H.wearing(before, list[1]));
  assert.ok(H.wearing(before, H.previous(list, after)));
});

test('Clear history wins over a recording that is waiting or already queued', async () => {
  const editor = { url: 'chrome-extension://x/options.html' };
  const burst = async (w, name) => {
    const was = G.GZ_SANITIZE(w.sync);
    const now = wearing(name, was);
    Object.assign(w.sync, now);
    w.change({ colors: { oldValue: was.colors, newValue: now.colors } });
    await w.tick();
  };
  const settle = async () => { for (let i = 0; i < 6; i++) await new Promise(setImmediate); };

  // Waiting: the timer hasn't fired when the student clears.
  let w = worker();
  w.local.lookHistory = [{ theme: H.theme(G.GZ_DEFAULTS), at: 1 }];
  await burst(w, 'Terminal');
  w.send('clear-history', editor);
  await settle();
  assert.deepEqual(w.local.lookHistory, []);
  assert.equal(w.timers.length, 0, 'the waiting recording is cancelled');

  // Queued: the timer fired and its write is in flight when the student clears.
  w = worker();
  await burst(w, 'Terminal');
  w.timers.shift()();
  w.send('clear-history', editor);
  await settle();
  assert.deepEqual(w.local.lookHistory, []);

  // Only the extension's own pages can clear; the next change records afresh.
  w.local.lookHistory = [{ theme: H.theme(G.GZ_DEFAULTS), at: 1 }];
  w.send('clear-history', { url: 'https://frostdev.io/glaze/looks/', frameId: 0 });
  await settle();
  assert.equal(w.local.lookHistory.length, 1);
  w.local.lookHistory = [];
  await burst(w, 'Library');
  w.timers.shift()();
  await settle();
  assert.equal(w.local.lookHistory.length, 2);
});

test('a burst that starts after Clear history, while older writes are still queued, keeps its own theme left', async () => {
  const editor = { url: 'chrome-extension://x/options.html' };
  const settle = async () => { for (let i = 0; i < 10; i++) await new Promise(setImmediate); };
  const w = worker();
  const burst = (name) => {
    const was = G.GZ_SANITIZE(w.sync);
    const now = wearing(name, was);
    Object.assign(w.sync, now);
    // What a Look writes, as GZ_UI.save sends it: one change with every theme key.
    w.change(Object.fromEntries(H.KEYS.map((k) => [k, { oldValue: was[k], newValue: now[k] }])));
    return now;
  };
  burst('Clear');
  await settle();
  const release = w.hold();
  w.timers.shift()(); // a write under way, stuck on storage
  await settle();
  const terminal = burst('Terminal');
  w.timers.shift()(); // queued behind it
  w.send('clear-history', editor);
  const library = burst('Library'); // a new burst, before the queue drains
  release();
  await settle();
  assert.deepEqual(w.local.lookHistory, [], 'the clear came after the older writes');
  w.timers.shift()();
  await settle();
  const list = w.local.lookHistory;
  assert.equal(list.length, 2);
  assert.ok(H.wearing(library, list[0]));
  assert.ok(H.wearing(terminal, H.previous(list, library)), 'Previous Look is Terminal, not the defaults');
});

// ---- Look parts ---------------------------------------------------------------------------------------------------
const XP = require('../lib/lookparts.js');
const GLOW = { x: { cursor: { kind: 'glow' } } };

test('a Look\'s parts are part of the theme: wearing it brings them, and a theme without any clears them', () => {
  const withParts = { ...G.GZ_DEFAULTS, parts: GLOW };
  assert.deepEqual(H.theme(withParts).parts, GLOW);
  assert.equal(H.theme(G.GZ_DEFAULTS).parts, null, 'a theme from before parts had none');
  assert.equal(H.theme({ ...G.GZ_DEFAULTS, parts: 'x' }).parts, null);
  assert.equal(H.theme({ ...G.GZ_DEFAULTS, parts: { x: 'nope' } }).parts, null);
  assert.equal(H.theme({ ...G.GZ_DEFAULTS, parts: { y: 1 } }).parts, null);
  let list = H.add([], G.GZ_DEFAULTS, 1);
  list = H.add(list, withParts, 2);
  assert.equal(list.length, 2, 'the same colours, look and background with other parts are another theme');
  assert.equal(H.add(list, withParts, 3), list);
  assert.ok(H.KEYS.includes('parts'));
  const patch = H.wear(G.GZ_DEFAULTS, list[0]);
  assert.deepEqual(patch.parts, GLOW);
  assert.equal(H.wear(withParts, list[1]).parts, null, 'wearing one without parts leaves none worn');
  assert.ok(H.wearing(withParts, list[0]) && !H.wearing(G.GZ_DEFAULTS, list[0]));
  assert.equal(H.previous(list, withParts).theme.parts, null);
});

test('the background records the parts each theme wore, and skips the theme left when its parts were on this computer', async () => {
  const before = G.GZ_SANITIZE({});
  const after = wearing('Lagoon', before);
  // Unpacking is real (de)compression, so wait for the write rather than for a number of turns.
  const settle = async (w) => { w.timers.shift()(); for (let i = 0; i < 400 && !w.local.lookHistory; i++) await new Promise((r) => setTimeout(r, 5)); };
  const packed = await XP.pack(GLOW);
  // In sync: left with parts, arrived without (a built-in Look clears them).
  let w = worker();
  Object.assign(w.sync, after, { lookX: '' });
  w.change({ colors: { oldValue: before.colors, newValue: after.colors }, lookX: { oldValue: packed, newValue: '' } });
  await w.tick();
  await settle(w);
  let [now, was] = w.local.lookHistory;
  assert.equal(now.theme.parts, null);
  assert.deepEqual(was.theme.parts, GLOW, 'the theme left, with the parts it wore');
  assert.ok(H.wearing({ ...after, parts: GLOW }, was));
  // Now with parts, from a Look without.
  w = worker();
  Object.assign(w.sync, after, { lookX: packed });
  w.change({ colors: { oldValue: before.colors, newValue: after.colors }, lookX: { oldValue: '', newValue: packed } });
  await w.tick();
  await settle(w);
  [now, was] = w.local.lookHistory;
  assert.deepEqual(now.theme.parts, GLOW);
  assert.equal(was.theme.parts, null);
  // Parts in this computer's local storage: the new theme has them; the old ones can't be told, so they aren't added again.
  w = worker();
  const big = await XP.pack({ x: { bg: { shader: { src: 'a'.repeat(100) } } } });
  w.local.lookX = big;
  Object.assign(w.sync, after, { lookX: { h: XP.hash(big) } });
  w.change({ colors: { oldValue: before.colors, newValue: after.colors }, lookX: { oldValue: { h: 'oldhash' }, newValue: { h: XP.hash(big) } } });
  await w.tick();
  await settle(w);
  assert.equal(w.local.lookHistory.length, 1);
  assert.equal(w.local.lookHistory[0].theme.parts.x.bg.shader.src, 'a'.repeat(100));
  // A change to the parts alone is a change of Look, too.
  w = worker();
  Object.assign(w.sync, G.GZ_SANITIZE({}), { lookX: packed });
  w.change({ lookX: { oldValue: '', newValue: packed } });
  await w.tick();
  assert.equal(w.timers.length, 1);
});

test('the gallery hands over a glaze2 code up to its limit, and no more', async () => {
  const w = worker();
  const url = 'https://frostdev.io/glaze/looks/';
  w.send({ gallery: { code: `glaze2:${'A'.repeat(19993)}`, name: 'Big' } }, { url, frameId: 0 });
  await w.tick();
  assert.equal(w.local.galleryOffer?.code.length, 20000);
  delete w.local.galleryOffer;
  w.send({ gallery: { code: `glaze2:${'A'.repeat(19994)}`, name: 'Bigger' } }, { url, frameId: 0 });
  await w.tick();
  assert.deepEqual(w.local, {});
});



test('history cleans parts before offering an entry to wear', () => {
  assert.equal(H.wear(G.GZ_DEFAULTS, { theme: { parts: { x: { cursor: { kind: 'laser' } } } } }).parts, null);
});


test('gallery Look names and authors lose bidi and control characters before storage', async () => {
  const w = worker();
  w.send({ gallery: { code: 'glaze2:abc', name: 'a\u202eb\u061cc', author: 'x\u0000\u2069y' } }, { url: 'https://frostdev.io/glaze/looks/', frameId: 0 });
  await w.settle();
  assert.deepEqual(w.local.galleryOffer, { code: 'glaze2:abc', name: 'abc', author: 'xy' });
});

// A gallery Look whose background is a file: the worker fetches that one file from the gallery and keeps it, pending, before
// the editor opens (test/media-store.test.js follows it there); anything wrong with it still offers the Look, without the file.
test('a gallery Look\'s background file is fetched from the gallery and kept by its name, pending, before the offer', async () => {
  const S = require('../lib/share.js'), M = require('../lib/media.js');
  const bytes = fs.readFileSync(require.resolve('./fixtures/media/spin.json'));
  const h = await M.sha(M.check(new Uint8Array(bytes), 'bg').bytes);
  const code = await S.encode(G.GZ_SANITIZE({ bg: { kind: 'media' } }), {}, { x: { bg: { media: { type: 'lottie', src: `file:${h}` } } } });
  const url = 'https://frostdev.io/glaze/looks/';
  const asked = [];
  const serve = (body) => async (u, i) => { asked.push([u, i.credentials, i.redirect, i.referrerPolicy]); return new Response(body); };
  const w = worker({ fetch: serve(bytes) });
  w.send({ gallery: { code, name: 'Spin' } }, { url, frameId: 0 });
  await w.settle();
  assert.deepEqual(asked, [[`https://frostdev.io/glaze/looks/api/media/${h}`, 'omit', 'error', 'no-referrer']]);
  assert.deepEqual([w.local[M.INDEX]?.[h]?.t, w.local[M.INDEX]?.[h]?.p], ['application/json', true]);
  assert.equal(w.local.galleryOffer?.code, code);
  assert.deepEqual(w.local.galleryOffer?.media, { h, pending: true });
  // Kept already: nothing is fetched.
  delete w.local.galleryOffer;
  w.send({ gallery: { code, name: 'Spin' } }, { url, frameId: 0 });
  await w.settle();
  assert.equal(asked.length, 1);
  assert.equal(w.local.galleryOffer?.code, code);
  // The wrong file, or no gallery: offered all the same, nothing kept, and the editor told why.
  for (const [f, error] of [[serve('{"not":"it"}'), 'type'], [serve(fs.readFileSync(require.resolve('./fixtures/media/clip.webm'))), 'type'], [async () => { throw new TypeError('offline'); }, 'network']]) {
    const v = worker({ fetch: f });
    v.send({ gallery: { code, name: 'Spin' } }, { url, frameId: 0 });
    await v.settle();
    assert.equal(v.local.galleryOffer?.code, code);
    assert.deepEqual(v.local.galleryOffer?.media, { h, error });
    assert.equal(M.INDEX in v.local, false);
  }
  // Not from the gallery's pages: nothing is fetched.
  const x = worker({ fetch: () => assert.fail('fetched') });
  x.send({ gallery: { code, name: 'Spin' } }, { url: 'https://evil.example/glaze/looks/', frameId: 0 });
  for (let i = 0; i < 50; i++) await x.tick();
  assert.deepEqual(x.local, {});
});
