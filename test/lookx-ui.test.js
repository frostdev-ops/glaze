// Stickers and Look rotation's storage flows (W12), in VMs with stand-in storage and a small stand-in DOM: the worker's
// sticker writes (lib/background.js 'glaze:stickers': one change at a time on fresh storage, Reset's watermark, the
// picture cap), and the page module (features/lookx.js) when its reads answer late. Painting and keys are checked in a
// browser, not here.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const L = require('../lib/lookx.js');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const SITE = 'https://school.instructure.com';
const KEY = `stk:${SITE}/courses/1`;
const sticker = (id, s = 'study/coffee') => ({ id, s, x: 50, y: 100, w: 120, r: 0 });

// ---- the worker -----------------------------------------------------------------------------------------------------
const worker = (local = {}, syncStore = {}) => {
  const m = require('../manifest.json');
  const later = (fn) => new Promise((res) => setTimeout(() => res(fn())));
  const area = (s) => ({
    get: (k) => later(() => structuredClone(k === null ? s : Object.fromEntries([].concat(k).filter((x) => x in s).map((x) => [x, s[x]])))),
    set: (v) => later(() => { Object.assign(s, structuredClone(v)); }),
    remove: (k) => later(() => { for (const x of [].concat(k)) delete s[x]; }),
  });
  const listeners = [];
  const context = vm.createContext({
    URL, console, TextEncoder, TextDecoder, Blob, CompressionStream, DecompressionStream, btoa, atob, structuredClone, Promise, Date, setTimeout, clearTimeout, crypto: globalThis.crypto,
    importScripts: (...files) => { for (const f of files) vm.runInContext(read(`lib/${f}`), context); },
    chrome: {
      runtime: {
        id: 'glaze', getURL: (f = '') => `chrome-extension://x/${f}`, getManifest: () => m,
        onMessage: { addListener: (f) => listeners.push(f) }, onInstalled: { addListener() {} }, onStartup: { addListener() {} }, onConnect: { addListener() {} },
      },
      storage: { local: area(local), sync: area(syncStore), onChanged: { addListener() {} } },
    },
  });
  vm.runInContext(read('lib/background.js'), context);
  const send = (msg, sender = { id: 'glaze', tab: {}, url: `${SITE}/courses/1` }) => new Promise((res) => {
    let kept = false;
    for (const f of listeners) if (f(msg, sender, (r) => res(JSON.parse(JSON.stringify(r)))) === true) kept = true;
    if (!kept) res('ignored');
  });
  return { send, local, sync: syncStore, context, editor: { id: 'glaze', tab: {}, frameId: 0, url: 'chrome-extension://x/options.html' } };
};

test('stickers: two tabs changing one page at once both land (changes, not whole-page copies)', async () => {
  const w = worker({ [KEY]: [sticker('a')] });
  const at = Date.now();
  // Tab 1 adds b and moves a; tab 2, which never saw b, adds c and turns a. All at once.
  await Promise.all([
    w.send({ type: 'glaze:stickers', key: KEY, op: 'add', p: sticker('b', 'space-sky/sun'), at }),
    w.send({ type: 'glaze:stickers', key: KEY, op: 'add', p: sticker('c', 'critters/round-owl'), at }),
    w.send({ type: 'glaze:stickers', key: KEY, op: 'set', id: 'a', p: { x: 10, y: 20, w: 200 }, at }),
    w.send({ type: 'glaze:stickers', key: KEY, op: 'set', id: 'a', p: { r: 9 }, at }),
  ]);
  assert.deepEqual(w.local[KEY].map((p) => p.id), ['a', 'b', 'c']);
  assert.deepEqual(w.local[KEY][0], { id: 'a', s: 'study/coffee', x: 10, y: 20, w: 200, r: 9 });
  // A move can't change what the sticker is; removing the last one removes the page's item.
  await w.send({ type: 'glaze:stickers', key: KEY, op: 'set', id: 'b', p: { s: 'own:evil' }, at });
  assert.equal(w.local[KEY][1].s, 'space-sky/sun');
  for (const id of ['a', 'b', 'c']) await w.send({ type: 'glaze:stickers', key: KEY, op: 'del', id, at });
  assert.ok(!(KEY in w.local));
});

test('stickers: a page writes only its own site\'s stickers, and only the editor resets', async () => {
  const w = worker({ [KEY]: [sticker('a')] });
  const nope = { ok: false, error: 'sender' };
  const add = { type: 'glaze:stickers', key: `stk:https://other.instructure.com/courses/1`, op: 'add', p: sticker('x'), at: Date.now() };
  assert.deepEqual(await w.send(add), nope);
  assert.deepEqual(await w.send({ ...add, key: `stk:${SITE}.evil.example/x` }), nope);
  assert.deepEqual(await w.send(add, { id: 'other', tab: {}, url: 'https://other.instructure.com/' }), nope);
  assert.deepEqual(await w.send({ type: 'glaze:stickers', reset: true }), nope, 'a page cannot reset');
  assert.deepEqual(await w.send({ type: 'glaze:stickers', reset: true }, { id: 'glaze', url: 'chrome-extension://x/popup.html' }), nope);
  assert.equal(w.local[KEY].length, 1);
});

test('stickers: Reset everything wins over a change made before it that arrives after it', async () => {
  const w = worker({ [KEY]: [sticker('a')], 'stkImg:p1': 'data:image/png;base64,AAAA', cursorImg: 'data:image/png;base64,AA', rotateLooks: ['Clear'], rotateState: { at: 1 }, keep: 1 });
  const before = Date.now() - 50; // a move made in a tab just before the editor's Reset, still on its way
  assert.ok((await w.send({ type: 'glaze:stickers', reset: true }, w.editor)).ok);
  assert.deepEqual(Object.keys(w.local).sort(), ['keep', 'stkCleared']);
  assert.deepEqual(await w.send({ type: 'glaze:stickers', key: KEY, op: 'set', id: 'a', p: { x: 1 }, at: before }), { ok: false, error: 'cleared' });
  assert.deepEqual(await w.send({ type: 'glaze:stickers', key: KEY, op: 'add', p: sticker('b'), at: before }), { ok: false, error: 'cleared' });
  assert.deepEqual(await w.send({ type: 'glaze:stickers', img: 'data:image/png;base64,AAAA', at: before }), { ok: false, error: 'cleared' });
  assert.ok(!(KEY in w.local), 'nothing came back');
  // A change made after it is taken.
  assert.ok((await w.send({ type: 'glaze:stickers', key: KEY, op: 'add', p: sticker('c'), at: Date.now() + 1 })).ok);
  assert.deepEqual(w.local[KEY].map((p) => p.id), ['c']);
});

test('stickers: the picture cap counts every picture stored, not a list a failed write could leave short', async () => {
  // A picture kept by an earlier write whose bookkeeping never landed: there is no list of sizes at all.
  const big = `data:image/png;base64,${'A'.repeat(L.IMG_MAX - 30)}`;
  const local = {};
  for (let i = 0; i < Math.floor(L.IMGS_MAX / big.length); i++) local[`stkImg:old${i}`] = big;
  const w = worker(local);
  const r = await w.send({ type: 'glaze:stickers', img: `data:image/png;base64,${'A'.repeat(L.IMGS_MAX % big.length)}`, at: Date.now() });
  assert.deepEqual(r, { ok: false, error: 'cap' });
  // Deleting one makes room.
  assert.ok((await w.send({ type: 'glaze:stickers', drop: 'old0' })).ok);
  const r2 = await w.send({ type: 'glaze:stickers', img: 'data:image/png;base64,AAAA', at: Date.now() });
  assert.ok(r2.ok && `stkImg:${r2.id}` in w.local);
});

test('Reset everything saves: settings a library adds after defaults.js (todo, widgets, remind, tabs) go with the Look\'s', async () => {
  const w = worker();
  const d = JSON.parse(JSON.stringify(vm.runInContext('GZ_SANITIZE()', w.context)));
  const patch = { version: 2, bg: d.bg, todo: d.todo, widgets: d.widgets, remind: d.remind, tabs: d.tabs };
  assert.deepEqual(await w.send({ type: 'glaze:look', parts: null, patch }, w.editor), { ok: true });
  assert.deepEqual([w.sync.todo, w.sync.tabs], [d.todo, d.tabs]);
  assert.deepEqual(await w.send({ type: 'glaze:look', parts: null, patch: { version: 2, todo: d.todo } }), { ok: false, error: 'sender' }, 'a page writes the Look\'s keys only');
});

test('rotation: a favorite still decoding when the student turns rotation off or changes the theme is not worn', { timeout: 10000 }, async () => {
  const G = require('../defaults.js');
  const H = require('../lib/history.js');
  const start = () => {
    const s = G.GZ_SANITIZE({ ...G.GZ_LOOK_APPLY(G.GZ_DEFAULTS, G.GZ_LOOKS.find((l) => l.name === 'Library')), extras: { rotate: '6h' } });
    const w = worker({ rotateLooks: ['glaze1:fav'], lookFavorites: [{ code: 'glaze1:fav', name: 'Fav' }], rotateState: { mode: '6h 08:00', at: 1, i: -1 } }, structuredClone(s));
    // The favorite's code decodes when the test says so, and says when the worker has asked for it: by then the worker
    // has read what it compares against, so a change the test makes next is one made meanwhile.
    let done;
    w.context.held = new Promise((r) => { done = r; });
    const begun = new Promise((r) => { w.context.begun = r; });
    vm.runInContext('GZ_SHARE.decode = () => { globalThis.begun(); return globalThis.held; };', w.context);
    const got = { colors: G.GZ_PRESETS.find(([n]) => n === 'Forest')[1], look: { font: 'jetbrains-mono' }, bg: {}, card: {}, cards: [] };
    return { w, s, begun, decoded: () => done(got) };
  };
  // Turned off meanwhile.
  let { w, begun, decoded } = start();
  let turn = w.send({ type: 'glaze:rotate' });
  await begun;
  w.sync.extras = { ...w.sync.extras, rotate: 'off' };
  decoded();
  assert.deepEqual(await turn, { ok: false, error: 'changed' });
  assert.notEqual(w.sync.look.font, 'jetbrains-mono');
  // A Look picked by hand meanwhile.
  let s;
  ({ w, s, begun, decoded } = start());
  turn = w.send({ type: 'glaze:rotate' });
  await begun;
  const mine = G.GZ_LOOK_APPLY(s, G.GZ_LOOKS.find((l) => l.name === 'Clear'));
  Object.assign(w.sync, structuredClone(mine));
  decoded();
  await turn;
  assert.deepEqual(H.theme(G.GZ_SANITIZE(w.sync)), H.theme(G.GZ_SANITIZE({ ...s, ...mine })), 'the hand-picked Look stays');
  // Nothing changed meanwhile: worn.
  ({ w, begun, decoded } = start());
  turn = w.send({ type: 'glaze:rotate' });
  await begun;
  decoded();
  assert.ok((await turn).ok);
  assert.equal(w.sync.look.font, 'jetbrains-mono');
  assert.equal(w.local.rotateState.i, 0);
});

test('rotation: a favorite brings its parts with it, a built-in Look its own, and parts changed meanwhile drop the turn', { timeout: 10000 }, async () => {
  const G = require('../defaults.js');
  const X = require('../lib/lookparts.js');
  const parts = { x: { cursor: { kind: 'glow' } } };
  const mine = { x: { cursor: { kind: 'ripple' } } };
  const settings = async () => ({ ...structuredClone(G.GZ_SANITIZE({ extras: { rotate: '6h' } })), lookX: await X.pack(mine) });
  const due = { mode: '6h 08:00', at: 1, i: -1 };
  const forest = G.GZ_PRESETS.find(([n]) => n === 'Forest')[1];
  const favorite = async (parts, during) => {
    const w = worker({ rotateLooks: ['glaze2:fav'], lookFavorites: [{ code: 'glaze2:fav', name: 'Fav' }], rotateState: due }, await settings());
    let done;
    w.context.held = new Promise((r) => { done = r; });
    const begun = new Promise((r) => { w.context.begun = r; });
    vm.runInContext('GZ_SHARE.decode = () => { globalThis.begun(); return globalThis.held; };', w.context);
    const turn = w.send({ type: 'glaze:rotate' });
    await begun;
    during?.(w);
    done({ colors: forest, look: {}, bg: { kind: 'shader' }, card: {}, cards: [], parts });
    return { w, r: await turn };
  };
  let { w, r } = await favorite(parts);
  assert.ok(r.ok);
  assert.equal(w.sync.bg.kind, 'shader');
  assert.deepEqual(await X.unpack(w.sync.lookX), parts, 'the code\'s parts replace the ones worn');
  ({ w, r } = await favorite(null));
  assert.ok(r.ok);
  assert.equal(w.sync.lookX, '', 'a code without parts leaves none');
  ({ w, r } = await favorite(parts, (x) => { x.sync.lookX = 'x1:changed'; }));
  assert.deepEqual(r, { ok: false, error: 'changed' });
  assert.equal(w.sync.lookX, 'x1:changed');
  // A built-in Look brings its own parts.
  w = worker({ rotateState: due }, await settings());
  assert.ok((await w.send({ type: 'glaze:rotate' })).ok);
  assert.equal(w.sync.bg.kind, 'scene');
  const worn = await X.unpack(w.sync.lookX);
  assert.ok(require('../defaults.js').GZ_LOOKS.some((L) => X.same(worn, require('../lib/lookset.js')(L))), JSON.stringify(worn)?.slice(0, 200));
});

// ---- the page -------------------------------------------------------------------------------------------------------
test('rotation refuses legacy outside favorites that hide critical controls without restricting own Look storage', async () => {
  const G = require('../defaults.js'), X = require('../lib/lookparts.js'), S = require('../lib/share.js');
  const parts = { x: { nav: { hidden: ['logout'] } } };
  const code = await S.encode(G.GZ_SANITIZE({}), {}, parts);
  const packed = await X.pack(parts);
  const w = worker({ rotateLooks: [code], lookFavorites: [{ code, name: 'Legacy' }], rotateState: { mode: '6h 08:00', at: 1, i: -1 } }, { ...G.GZ_SANITIZE({ extras: { rotate: '6h' } }), lookX: packed });
  assert.ok((await w.send({ type: 'glaze:rotate' })).ok);
  assert.equal(w.sync.lookX, packed, 'refused favorite leaves own worn Look intact');
  assert.equal(w.local.rotateState.turned, false);
  assert.deepEqual((await S.decode(code)).parts, parts, 'own code still decodes');
});

test('rotation: a favorite brings its navigation bar, sidebar look and sidebar colours too, and leaves what is the student\u2019s', async () => {
  const G = require('../defaults.js'), S = require('../lib/share.js');
  const code = await S.encode(G.GZ_SANITIZE({ navbar: { place: 'top', badges: false }, sidebar: { surface: 'solid' }, nav: { k: 'solid', c: '#224466' } }), {}, null);
  const w = worker({ rotateLooks: [code], lookFavorites: [{ code, name: 'Bar' }], rotateState: { mode: '6h 08:00', at: 1, i: -1 } },
    G.GZ_SANITIZE({ extras: { rotate: '6h' }, navbar: { on: false, rail: 'icons' }, sidebar: { open: 'drawer' } }));
  assert.ok((await w.send({ type: 'glaze:rotate' })).ok);
  assert.deepEqual([w.sync.navbar.place, w.sync.navbar.badges, w.sync.navbar.on, w.sync.navbar.rail], ['top', false, false, 'icons']);
  assert.deepEqual([w.sync.sidebar.surface, w.sync.sidebar.open], ['solid', 'drawer']);
  assert.deepEqual([w.sync.nav.k, w.sync.nav.c], ['solid', '#224466']);
});

class El {
  constructor(tag) { Object.assign(this, { tagName: tag.toUpperCase(), children: [], attrs: {}, parent: null, style: {}, id: '' }); }
  get classList() { const el = this; return { toggle: (c, on) => { el[`class:${c}`] = on; }, contains: (c) => !!el[`class:${c}`] }; }
  get isConnected() { let e = this; while (e.parent) e = e.parent; return e.tagName === 'HTML'; }
  append(...kids) { for (const k of kids) if (k instanceof El) { k.remove(); k.parent = this; this.children.push(k); } }
  replaceChildren(...kids) { for (const c of this.children) c.parent = null; this.children = []; this.append(...kids); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this); this.parent = null; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  toggleAttribute(k, on) { if (on) this.attrs[k] = ''; else delete this.attrs[k]; }
  hasAttribute(k) { return k in this.attrs; }
  removeAttribute(k) { delete this.attrs[k]; }
  addEventListener(type, f) { ((this.on ||= {})[type] ||= []).push(f); }
  click() { for (const f of this.on?.click || []) f({ type: 'click', target: this, preventDefault() {}, stopPropagation() {} }); }
  focus() {}
  getBoundingClientRect() { return { left: 0, top: 0, width: 1000, height: 0 }; }
  find(id) { return this.id === id ? this : this.children.map((c) => c.find(id)).find(Boolean) || null; }
}
const page = (local, pathname = '/courses/1', send = (m, cb) => cb?.({ ok: true })) => {
  const html = new El('html'), head = new El('head'), body = new El('body');
  html.append(head, body);
  html.style.setProperty = (k, v) => { html.style[k] = v; };
  html.style.removeProperty = (k) => { delete html.style[k]; };
  const blobs = new Set();
  let b = 0;
  const settings = { extras: { stickers: true, rotate: 'off', at: '08:00' } };
  let parts = null; // the worn Look's parts, as GZ_CTX.parts() hands them
  let on = true, partsOn = true, courseLook = null;
  const docOn = {}, changed = [], synced = []; // the document's listeners; storage.onChanged's; what went to storage.sync
  const held = []; // storage reads made to wait: { keys, release }
  let hold = () => false;
  const timers = new Map();
  const fns = new Map();
  const win = {};
  let n = 0;
  const context = vm.createContext({
    console, Promise, Date, Map, Set, structuredClone, crypto: globalThis.crypto, Blob, atob, Uint8Array,
    URL: { createObjectURL: () => { const u = `blob:x/${++b}`; blobs.add(u); return u; }, revokeObjectURL: (u) => blobs.delete(u) },
    setTimeout: (f, ms) => { const id = ++n; timers.set(id, ms); fns.set(id, f); return id; }, clearTimeout: (id) => { timers.delete(id); fns.delete(id); },
    addEventListener: (type, f) => { (win[type] ||= []).push(f); }, innerWidth: 1000, innerHeight: 800,
    location: { origin: SITE, pathname },
    document: { documentElement: html, head, body, createElement: (t) => new El(t), getElementById: (id) => html.find(id), addEventListener: (t, f) => { (docOn[t] ||= []).push(f); }, hidden: false },
    chrome: {
      runtime: { getURL: (f) => `chrome-extension://x/${f}`, sendMessage: (m, cb) => send(structuredClone(m), cb) },
      storage: {
        onChanged: { addListener: (f) => changed.push(f) },
        sync: { set: (v) => synced.push(structuredClone(v)) },
        local: {
          get: (keys, cb) => {
            const answer = (snapshot) => cb(structuredClone(snapshot || (keys === null ? local : Object.fromEntries([].concat(keys).filter((k) => k in local).map((k) => [k, local[k]])))));
            if (hold(keys)) held.push({ keys, release: answer }); else setTimeout(answer);
          },
        },
      },
    },
    GZ_MATCH_PRESET: () => null,
    CSS: { supports: () => true },
    GZ_CTX: { t: (k) => k, need: (file) => { if (file === 'lib/lookset.js') assert.equal(vm.runInContext(read(file), context)?.ready, true, 'the worker requires a serializable completion value'); return Promise.resolve(); }, settings: () => settings, parts: () => parts, partsOn: (pointer) => on && (pointer || partsOn), courseLook: () => courseLook, on: () => on, solo: true },
  });
  context.window = context;
  context.top = context;
  context.globalThis = context;
  vm.runInContext(read('lib/lookx.js'), context);
  vm.runInContext(read('features/lookx.js'), context);
  // Runs the timers due now (the 300 ms save; not rotation's ten-minute one).
  const runTimers = () => { for (const [id, f] of [...fns]) if (timers.get(id) <= 1000) { timers.delete(id); fns.delete(id); f(); } };
  const fire = (type, e = {}) => { for (const f of win[type] || []) f(e); };
  return { lx: context.GZ_LOOKX, location: context.location, runTimers, fire, settings, html, body, held, timers, blobs, holdWhen: (f) => { hold = f; }, wear: (x) => { parts = x; },
    setOn: (v) => { on = v; }, setPartsOn: (v) => { partsOn = v; }, setCourseLook: (v) => { courseLook = v; partsOn = !v; }, emit: (t) => { for (const f of docOn[t] || []) f({ type: t }); }, stored: (c) => { for (const f of changed) f(c, 'local'); }, local, synced };
};

test('page: a picture read that answers after Hide doesn\'t draw the stickers back', async () => {
  const p = page({ [KEY]: [sticker('a', 'own:pic1')], 'stkImg:pic1': 'data:image/png;base64,AAAA' });
  p.holdWhen((keys) => [].concat(keys).some((k) => String(k).startsWith('stkImg:')));
  p.lx.sync();
  for (let i = 0; i < 20 && !p.held.length; i++) await tick();
  assert.equal(p.held.length, 1, 'the own picture is being read');
  // The student hides stickers; applySettings asks again.
  p.settings.extras = { ...p.settings.extras, stickers: false };
  await p.lx.sync();
  await tick();
  assert.equal(p.body.find('gz-stickers'), null);
  p.held.shift().release();
  await tick();
  await tick();
  assert.equal(p.body.find('gz-stickers'), null, 'still hidden once the read answered');
});

test('page: rotation arms one timer, however often it is asked while reading', async () => {
  const p = page({ rotateState: { mode: '6h 08:00', at: Date.now(), i: 0 } });
  p.settings.extras = { ...p.settings.extras, stickers: false, rotate: '6h' };
  p.holdWhen((keys) => [].concat(keys).includes('rotateState'));
  p.lx.sync();
  p.lx.sync();
  for (let i = 0; i < 20 && p.held.length < 2; i++) await tick();
  assert.equal(p.held.length, 2);
  for (const h of p.held.splice(0)) h.release();
  await tick();
  assert.deepEqual([...p.timers.values()], [6e5], 'one timer, at most ten minutes');
});

test('page: saved stickers stay off a Moodle quiz attempt', async () => {
  const key = `stk:${SITE}/mod/quiz/attempt.php`;
  const p = page({ [key]: [sticker('a')] }, '/mod/quiz/attempt.php');
  await p.lx.sync();
  await tick();
  assert.equal(p.body.find('gz-stickers'), null);
  await p.lx.edit();
  assert.equal(p.body.find('gz-stk-panel'), null, 'no sticker mode there either');
});

test('page: Place stickers with Show stickers off opens sticker mode with its layer, and placing works', async () => {
  const p = page({});
  p.settings.extras = { ...p.settings.extras, stickers: false };
  // The switch being saved makes applySettings ask again (sync) while sticker mode opens.
  const opening = p.lx.edit();
  p.lx.sync();
  await opening;
  await tick();
  assert.ok(p.body.find('gz-stk-panel'), 'the panel is open');
  assert.ok(p.body.find('gz-stickers'), 'with its layer');
  const pick = (function first(e) { return e['class:gz-stk-pick'] || e.className === 'gz-stk-pick' ? e : e.children.map(first).find(Boolean); })(p.body.find('gz-stk-panel'));
  assert.ok(pick, 'a sticker to pick');
  pick.click();
  assert.equal(p.body.find('gz-stickers').children.length, 1);
});

test('page: own sticker and pointer pictures reach the page as blob: addresses, never data: URLs', async () => {
  const data = `data:image/png;base64,${Buffer.from('not really a png').toString('base64')}`;
  const p = page({ [KEY]: [sticker('a', 'own:pic1'), sticker('b')], 'stkImg:pic1': data, cursorImg: data });
  p.wear({ pointer: 'own' });
  await p.lx.sync();
  for (let i = 0; i < 5; i++) await tick();
  const text = JSON.stringify((function walk(e) { return { a: e.attrs, s: e.style, src: e.src, kids: e.children.map(walk) }; })(p.html));
  assert.ok(!text.includes('data:'), 'no data: URL in the page');
  assert.match(p.html.style['--gz-cursor'], /^url\("blob:x\/\d+"\) 0 0, auto$/);
  const img = p.body.find('gz-stickers').children[0].children[0];
  assert.match(img.src, /^blob:x\//);
  assert.equal(p.blobs.size, 2, 'the sticker and the pointer');
  // A Look without a pointer: its address is revoked.
  p.wear({ cursor: { kind: 'glow' } });
  await p.lx.sync();
  await tick();
  assert.equal(p.blobs.size, 1);
  assert.equal(p.html.style['--gz-cursor'], undefined);
});

test('page: the Look\'s pointer set is the system\'s cursor, its SVG first with the PNGs after, and goes with the Look', async () => {
  const p = page({});
  p.wear({ pointer: 'pumpkin' });
  await p.lx.sync();
  await tick();
  assert.equal(p.html.style['--gz-cursor'], 'url("chrome-extension://x/assets/art/cursors/pumpkin/default.svg") 4 3, image-set(url("chrome-extension://x/assets/art/cursors/pumpkin/default.png") 1x, url("chrome-extension://x/assets/art/cursors/pumpkin/default@2x.png") 2x) 4 3, url("chrome-extension://x/assets/art/cursors/pumpkin/default.png") 4 3, auto');
  assert.match(p.html.style['--gz-cursor-pointer'], /pumpkin\/pointer\.svg"\) 12 3, .*, pointer$/);
  assert.ok('data-gz-cursor' in p.html.attrs);
  p.wear(null);
  await p.lx.sync();
  await tick();
  assert.equal(p.html.style['--gz-cursor'], undefined);
  assert.equal(p.blobs.size, 0, 'a set is the extension\'s file, never a blob');
});

// The student's pointer (settings extras.pointer) over the Look's: what --gz-cursor says, as a set's name, 'own' or none.
const shown = (p) => {
  const c = p.html.style['--gz-cursor'];
  if (c === undefined) return 'data-gz-cursor' in p.html.attrs ? 'broken' : 'system';
  return /^url\("blob:/.test(c) ? 'own' : c.match(/cursors\/(\w+)\/default\./)?.[1] || c;
};
const choose = async (p, pointer) => { p.settings.extras = { ...p.settings.extras, pointer }; await p.lx.sync(); await settle(); };

test('page: the student\'s pointer wins over the Look\'s; The Look\'s pointer gives the Look\'s back', async () => {
  const data = `data:image/png;base64,${Buffer.from('png').toString('base64')}`;
  const p = page({ cursorImg: data });
  p.settings.extras = { ...p.settings.extras, stickers: false, pointer: 'look' };
  p.wear({ pointer: 'pumpkin', cursor: { kind: 'flicker' } });
  await p.lx.sync();
  await settle();
  assert.equal(shown(p), 'pumpkin', 'the Look\'s, by default');
  await choose(p, 'aqua');
  assert.equal(shown(p), 'aqua', 'a set over the Look\'s');
  assert.match(p.html.style['--gz-cursor-pointer'], /cursors\/aqua\/pointer\.png"\) 14 2, pointer$/, 'its hand where the page is clickable');
  await choose(p, 'off');
  assert.equal(shown(p), 'system', 'System pointer: none of Glaze\'s, whatever the Look has');
  assert.equal(p.html.style['--gz-cursor-pointer'], undefined);
  await choose(p, 'own');
  assert.equal(shown(p), 'own', 'their picture, as a blob: address');
  assert.equal(p.blobs.size, 1);
  await choose(p, 'look');
  assert.equal(shown(p), 'pumpkin', 'back to the Look\'s');
  assert.equal(p.blobs.size, 0, 'the picture\'s address revoked');
});

test('page: the student\'s pointer stays through a change of Look; the Look\'s follows it', async () => {
  const p = page({});
  p.settings.extras = { ...p.settings.extras, stickers: false, pointer: 'lava' };
  p.wear({ pointer: 'pumpkin' });
  await p.lx.sync();
  await settle();
  assert.equal(shown(p), 'lava');
  // Another Look is worn (features/lookparts.js fires glaze:parts): the choice stays.
  p.wear({ pointer: 'ghost' });
  p.emit('glaze:parts');
  await settle();
  assert.equal(shown(p), 'lava');
  p.wear(null);
  p.emit('glaze:parts');
  await settle();
  assert.equal(shown(p), 'lava', 'a Look without a pointer or any parts: still the student\'s');
  // Following the Look again: each Look's own, and none for a Look without.
  await choose(p, 'look');
  assert.equal(shown(p), 'system');
  p.wear({ pointer: 'ghost' });
  p.emit('glaze:parts');
  await settle();
  assert.equal(shown(p), 'ghost');
});

test('page: the personal pointer wins on course Looks, and following the Look uses that course\'s pointer', async () => {
  const p = page({});
  p.settings.extras = { ...p.settings.extras, stickers: false, pointer: 'neon' };
  await p.lx.sync();
  await settle();
  assert.equal(shown(p), 'neon');
  p.setCourseLook('Library');
  await p.lx.sync();
  await settle();
  assert.equal(shown(p), 'neon', 'the personal override also wins on a course Look');
  await choose(p, 'look');
  assert.equal(shown(p), 'quill', 'the course Look, not the global Look');
  p.setCourseLook('Graveyard');
  await p.lx.sync();
  await settle();
  assert.equal(shown(p), 'ghost', 'changing courses follows their respective Looks');
  await choose(p, 'off');
  assert.equal(shown(p), 'system');
  await choose(p, 'neon');
  p.setCourseLook(null);
  await p.lx.sync();
  await settle();
  assert.equal(shown(p), 'neon');
  // Glaze turned off (disable() calls sync()): the attribute and both variables go.
  p.setOn(false);
  await p.lx.sync();
  await settle();
  assert.equal(shown(p), 'system');
  assert.ok(!('data-gz-cursor' in p.html.attrs) && p.html.style['--gz-cursor-pointer'] === undefined);
  p.setOn(true);
  await p.lx.sync();
  await settle();
  assert.equal(shown(p), 'neon');
});

test('page: no custom pointer on quiz or quiet pages, including an override with no Look parts', async () => {
  for (const pathname of ['/courses/1/quizzes/2/take', '/ultra/courses/_1_1/assessment/_2_1/attempt', '/courses/1/external_tools/2', '/mod/quiz/attempt.php']) {
    const p = page({}, pathname);
    await choose(p, 'neon');
    assert.equal(shown(p), 'system', pathname);
    assert.equal(p.html.style['--gz-cursor-pointer'], undefined);
    p.location.pathname = '/courses/1';
    await p.lx.sync();
    await settle();
    assert.equal(shown(p), 'neon');
  }
});

test('page: a new picture of their own is shown at once while it is the pointer worn, and not read otherwise', async () => {
  const one = `data:image/png;base64,${Buffer.from('one').toString('base64')}`, two = `data:image/png;base64,${Buffer.from('two').toString('base64')}`;
  const p = page({ cursorImg: one });
  p.settings.extras = { ...p.settings.extras, stickers: false, pointer: 'own' };
  await p.lx.sync();
  await settle();
  const first = p.html.style['--gz-cursor'];
  assert.equal(shown(p), 'own');
  p.local.cursorImg = two;
  p.stored({ cursorImg: { oldValue: one, newValue: two } });
  await settle();
  assert.equal(shown(p), 'own');
  assert.notEqual(p.html.style['--gz-cursor'], first, 'the new picture');
  assert.equal(p.blobs.size, 1, 'the old address revoked');
  // Removed: the system's pointer, not a broken one.
  delete p.local.cursorImg;
  p.stored({ cursorImg: { oldValue: two } });
  await settle();
  assert.equal(shown(p), 'system');
  assert.equal(p.blobs.size, 0);
  // Wearing a set, a new picture is not even read.
  await choose(p, 'rose');
  let reads = 0;
  p.holdWhen((keys) => { if ([].concat(keys).includes('cursorImg')) reads++; return false; });
  p.stored({ cursorImg: { newValue: one } });
  await settle();
  assert.equal(reads, 0);
  assert.equal(shown(p), 'rose');
});

test('page: a stale own-picture read cannot undo removal or survive a pagehide and restore', async () => {
  const img = 'data:image/png;base64,b25l';
  const p = page({ cursorImg: img });
  p.settings.extras = { ...p.settings.extras, stickers: false, pointer: 'own' };
  p.holdWhen((keys) => keys === 'cursorImg');
  await p.lx.sync();
  assert.equal(p.held.length, 1);
  delete p.local.cursorImg;
  p.stored({ cursorImg: { oldValue: img } });
  assert.equal(p.held.length, 2);
  p.held[1].release({});
  await settle();
  p.held[0].release({ cursorImg: img });
  await settle();
  assert.equal(shown(p), 'system', 'the removed picture must not reappear');
  assert.equal(p.blobs.size, 0);

  p.local.cursorImg = img;
  await p.lx.sync();
  const old = p.held.at(-1);
  p.fire('pagehide');
  p.fire('pageshow', { persisted: true });
  await settle();
  const current = p.held.at(-1);
  current.release({ cursorImg: img });
  await settle();
  const restored = p.html.style['--gz-cursor'];
  old.release({});
  await settle();
  assert.equal(p.html.style['--gz-cursor'], restored, 'a read from the previous page lifetime cannot clear the restored pointer');
  assert.equal(p.blobs.size, 1);
});

test('palette: a Pointer: entry for every choice the setting takes, the current one marked, and the animation switch', async () => {
  const G = require('../defaults.js');
  const p = page({});
  p.settings.extras = { ...G.GZ_DEFAULTS.extras, pointer: 'lava' };
  await p.lx.ready();
  const pointers = () => [...p.lx.cmds()].filter((c) => c.label === 'Pointer: {name}');
  const chosen = (list) => list.map((c) => { c.run(); return p.synced.at(-1).extras.pointer; });
  // No picture of their own yet: every other choice, in the editor's order.
  assert.deepEqual(chosen(pointers()), G.GZ_SPEC.extras.pointer[1].filter((v) => v !== 'own'));
  assert.deepEqual(pointers().map((c) => c.hint), pointers().map((c, i) => (G.GZ_SPEC.extras.pointer[1][i] === 'lava' ? 'Current' : 'Glaze')));
  // Each writes only the pointer into the extras the page has, nothing of the Look's.
  pointers()[0].run();
  assert.deepEqual(JSON.parse(JSON.stringify(p.synced.at(-1))), { version: 2, extras: { ...G.GZ_DEFAULTS.extras, pointer: 'look' } });
  // With a picture: it too.
  p.local.cursorImg = 'data:image/png;base64,AAAA';
  await p.lx.ready();
  assert.deepEqual(chosen(pointers()), G.GZ_SPEC.extras.pointer[1]);
  // The pointer's animation: one switch, saying which way it goes.
  const anim = p.lx.cmds().find((c) => /^Turn (off|on) \{name\|lower\}$/.test(c.label) && (c.run(), p.synced.at(-1).extras.pointerAnim === false));
  assert.equal(anim.label, 'Turn off {name|lower}');
  p.settings.extras = { ...p.settings.extras, pointerAnim: false };
  const on = p.lx.cmds().filter((c) => c.label === 'Turn on {name|lower}');
  assert.equal(on.length, 1);
  on[0].run();
  assert.equal(p.synced.at(-1).extras.pointerAnim, true);
});

test('palette: a pointer command preserves settings changed since the palette opened', () => {
  const G = require('../defaults.js'), p = page({});
  p.settings.extras = { ...G.GZ_DEFAULTS.extras };
  const command = p.lx.cmds().filter((c) => c.label === 'Pointer: {name}')[2]; // Aqua
  p.settings.extras = { ...p.settings.extras, pointerAnim: false, stickers: false, rotate: 'daily', at: '10:30' };
  command.run();
  assert.deepEqual(p.synced.at(-1).extras, { ...p.settings.extras, pointer: 'aqua' });
});

// A tab on a computer whose worker is the real one (lib/background.js), in sticker mode on `path`.
const key = (e, k) => { for (const f of e.on?.keydown || []) f({ key: k, shiftKey: false, preventDefault() {}, stopPropagation() {} }); };
const stickersOf = (p) => p.body.find('gz-stickers').children;
const settle = async () => { for (let i = 0; i < 30; i++) await tick(); };
const inSickerMode = async (w, path = '/courses/1') => {
  const p = page(w.local, path, (m, cb) => w.send(m, { id: 'glaze', tab: {}, url: `${SITE}${p.location.pathname}` }).then((r) => cb?.(r)));
  await p.lx.edit();
  await settle();
  return p;
};

test('page: a move in one tab and a turn in another, both from the UI, both land', async () => {
  const w = worker({ [KEY]: [sticker('a')] });
  const A = await inSickerMode(w);
  const B = await inSickerMode(w);
  key(stickersOf(A)[0], 'ArrowRight'); // tab A moves it right
  const turn = (function find(e) { return e.attrs?.['aria-label'] === 'Turn {name} right' ? e : e.children.map(find).find(Boolean); })(B.body.find('gz-stk-panel'));
  turn.click(); // tab B, which never saw the move, turns it
  A.runTimers();
  B.runTimers();
  await settle();
  const [a] = w.local[KEY];
  assert.ok(a.x > 50, `the move stands (x ${a.x})`);
  assert.equal(a.r, 5, 'and the turn');
});

test('page: a move still waiting to be saved when the page changes in place is saved to the page it was made on', async () => {
  const w = worker({ [KEY]: [sticker('a')] });
  const A = await inSickerMode(w);
  key(stickersOf(A)[0], 'ArrowDown');
  // Ultra changes pages in place before the save rests.
  A.location.pathname = '/courses/2';
  await A.lx.sync();
  await settle(); // the new page's stickers are read before the save's 300 ms are up
  A.runTimers();
  await settle();
  assert.equal(w.local[KEY][0].y, 108, 'the first page has its move');
  assert.ok(!(`stk:${SITE}/courses/2` in w.local), 'and the second page nothing');
});

test('page: a pointer picture read that answers after the page is hidden makes no blob: address', async () => {
  const data = `data:image/png;base64,${Buffer.from('png').toString('base64')}`;
  const p = page({ cursorImg: data });
  p.settings.extras = { ...p.settings.extras, stickers: false };
  p.wear({ pointer: 'own' });
  p.holdWhen((keys) => [].concat(keys).includes('cursorImg'));
  p.lx.sync();
  for (let i = 0; i < 20 && !p.held.length; i++) await tick();
  p.fire('pagehide');
  p.held.shift().release();
  await settle();
  assert.equal(p.blobs.size, 0);
});

test('page: "Your pictures" read answering after the page is hidden makes no blob: address', async () => {
  const data = `data:image/png;base64,${Buffer.from('png').toString('base64')}`;
  const p = page({ 'stkImg:pic1': data });
  await p.lx.edit();
  await settle();
  p.holdWhen((keys) => keys === null);
  const sel = (function find(e) { return e.tagName === 'SELECT' ? e : e.children.map(find).find(Boolean); })(p.body.find('gz-stk-panel'));
  sel.value = 'own';
  for (const f of sel.on.change) f();
  for (let i = 0; i < 20 && !p.held.length; i++) await tick();
  assert.equal(p.held.length, 1, 'your pictures are being read');
  p.fire('pagehide');
  p.held.shift().release();
  await settle();
  assert.equal(p.blobs.size, 0);
});


// The real popup/editor helper, with callback storage and the worker's queued messages sharing one store.
const ui = (w) => {
  const pending = [], c = w.context.chrome;
  for (const a of ['sync', 'local']) for (const method of ['get', 'set', 'remove']) {
    const original = c.storage[a][method];
    c.storage[a][method] = (v, cb) => { const p = original(v); if (cb) p.then((r) => cb(r)); return p; };
  }
  c.runtime.sendMessage = (m, cb) => { const p = w.send(m, w.editor); if (cb) p.then(cb); return p; };
  w.context.GZ_I18N = { t: (s) => s, ui: () => 'en' };
  vm.runInContext(read('ui.js') + ';globalThis.UI = GZ_UI;', w.context);
  return { save: (s, keys) => { const p = new Promise((resolve) => w.context.UI.save(s, keys, resolve)); pending.push(p); return p; }, done: () => Promise.all(pending) };
};

test('overlapping editor Looks share the worker queue, so the last Look and its parts win together', async () => {
  const G = require('../defaults.js');
  const X = require('../lib/lookparts.js');
  const w = worker(), u = ui(w);
  let release, begun;
  const held = new Promise((r) => { release = r; });
  const started = new Promise((r) => { begun = r; });
  const set = w.context.chrome.storage.sync.set;
  w.context.chrome.storage.sync.set = (patch, cb) => {
    const p = (async () => { if (patch.lookX?.h) { begun(); await held; } return set(patch); })();
    if (cb) p.then(cb);
    return p;
  };
  const noise = Array.from(require('node:crypto').randomBytes(8000), (b) => String.fromCharCode(33 + b % 94)).join('').replaceAll('/', '~');
  const first = { ...G.GZ_DEFAULTS, bg: { kind: 'shader' }, parts: { x: { bg: { shader: { src: noise } } } } };
  u.save(first, ['bg', 'parts']);
  await started;
  u.save({ ...G.GZ_DEFAULTS, bg: { kind: 'solid' }, parts: null }, ['bg', 'parts']);
  await tick(20);
  release();
  assert.deepEqual(await u.done(), ['', '']);
  assert.equal(w.sync.bg.kind, 'solid');
  assert.equal(w.sync.lookX, '');
  assert.equal(w.local.lookX, undefined);
});

test('backup restore stores or clears parts in the same sync write as its Look, and rejects malformed parts', async () => {
  const X = require('../lib/lookparts.js');
  const old = await X.pack({ x: { cursor: { kind: 'glow' } } });
  const w = worker({ lookX: old }, { lookX: { h: X.hash(old) }, bg: { kind: 'solid' } });
  const writes = [], set = w.context.chrome.storage.sync.set;
  w.context.chrome.storage.sync.set = async (p) => { writes.push(structuredClone(p)); return set(p); };
  const restore = (parts) => w.send({ type: 'glaze:todo', restore: { tasks: {}, settings: { bg: { kind: 'shader' } }, ...(parts !== undefined && { parts }) } }, w.editor);
  const P = { x: { cursor: { kind: 'ripple' } } };
  assert.ok((await restore(P)).ok);
  assert.deepEqual(await X.unpack(w.sync.lookX), P);
  assert.ok(writes.every((p) => Object.hasOwn(p, 'bg') && Object.hasOwn(p, 'lookX')));
  assert.ok((await restore()).ok);
  assert.equal(w.sync.lookX, '');
  const before = structuredClone(w.sync);
  assert.equal((await restore({ x: { cursor: { kind: 'laser' } } })).ok, false);
  assert.deepEqual(w.sync, before);
});

test('picking a palette in the popup or the editor keeps the Look’s parts; picking a whole Look replaces them', () => {
  const G = require('../defaults.js');
  const w = worker(), u = ui(w);
  const s = { ...structuredClone(G.GZ_DEFAULTS), parts: { x: { cursor: { kind: 'glow' } } } };
  const keys = w.context.UI.pickPreset(s, 'Frost', G.GZ_PRESET('Frost'));
  assert.deepEqual(s.parts, { x: { cursor: { kind: 'glow' } } }, 'a palette is not a Look: a typed colour keeps the extras, and so does a swatch');
  assert.ok(!keys.includes('parts'), 'and they are not rewritten');
  const looked = w.context.UI.pickLook(s, G.GZ_LOOKS[0]);
  assert.deepEqual(JSON.parse(JSON.stringify(s.parts)), require('../lib/lookset.js')(G.GZ_LOOKS[0]), 'a whole Look brings its own extras');
  assert.ok(looked.includes('parts'));
});

test('the student\'s pointer and its animation switch stay through every way of changing Look; only the Look\'s parts change', () => {
  const G = require('../defaults.js');
  const w = worker(), u = ui(w);
  const s = { ...structuredClone(G.GZ_SANITIZE({ extras: { pointer: 'lava', pointerAnim: false } })), parts: { x: { pointer: 'ghost' } } };
  const keys = [...w.context.UI.pickLook(s, G.GZ_LOOKS.find((L) => L.name === 'Pumpkin Patch')), ...w.context.UI.pickPreset(s, 'Frost', G.GZ_PRESET('Frost'))];
  assert.equal(JSON.parse(JSON.stringify(s.parts)).x.pointer, 'pumpkin', 'the new Look\'s own pointer');
  assert.deepEqual([s.extras.pointer, s.extras.pointerAnim], ['lava', false]);
  assert.ok(!keys.includes('extras'), 'and the setting is not even rewritten');
});


test('an editor Look sends its nav and captured parts in one queued request', async () => {
  const G = require('../defaults.js');
  const w = worker(), u = ui(w), sent = [];
  const send = w.context.chrome.runtime.sendMessage;
  w.context.chrome.runtime.sendMessage = (m, cb) => { sent.push(structuredClone(m)); return send(m, cb); };
  const first = { x: { cursor: { kind: 'glow' } } };
  const s = { ...G.GZ_DEFAULTS, parts: first };
  u.save(s, ['bg', 'nav', 'parts']);
  s.parts = { x: { cursor: { kind: 'ripple' } } };
  await u.done();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].type, 'glaze:look');
  assert.deepEqual(sent[0].patch.nav, s.nav);
  assert.deepEqual(await require('../lib/lookparts.js').unpack(w.sync.lookX), first);
});

test('a refused Look write preserves the native nav and its local pictures', async () => {
  const G = require('../defaults.js'), X = require('../lib/lookparts.js');
  require('../lib/nav.js');
  const nav = G.GZ_SANITIZE({ nav: { k: 'image', i: 'abcdefghijkl', brand: 'custom', li: 'mnopqrstuvwx' } }).nav;
  const before = { nav, lookX: await X.pack({ x: { cursor: { kind: 'glow' } } }), bg: { kind: 'solid' } };
  const pictures = { 'navLogo:mnopqrstuvwx': 'logo bytes', 'cardImg:abcdefghijkl': 'picture bytes' };
  const w = worker(structuredClone(pictures), structuredClone(before));
  const set = w.context.chrome.storage.sync.set;
  w.context.chrome.storage.sync.set = (patch) => Object.hasOwn(patch, 'lookX') ? Promise.reject(new Error('quota')) : set(patch);
  const patch = { nav: { k: 'solid', brand: 'glaze', li: '' }, bg: { kind: 'gradient' } };
  assert.equal((await w.send({ type: 'glaze:look', parts: null, patch }, w.editor)).ok, false);
  assert.deepEqual(w.sync, before);
  assert.deepEqual(w.local, pictures);
  for (const nav of [null, false, '', 'solid', []]) {
    assert.equal((await w.send({ type: 'glaze:look', parts: null, patch: { ...patch, nav } }, w.editor)).ok, false);
    assert.deepEqual(w.sync, before);
    assert.deepEqual(w.local, pictures);
  }
  // The queue survives refusal; success commits nav, background and parts in one write before cleaning pictures.
  const writes = [];
  w.context.chrome.storage.sync.set = (patch) => { writes.push(structuredClone(patch)); return set(patch); };
  assert.equal((await w.send({ type: 'glaze:look', parts: null, patch }, w.editor)).ok, true);
  assert.equal(writes.length, 1);
  assert.deepEqual(Object.keys(writes[0]).sort(), ['bg', 'lookX', 'nav']);
  assert.equal(w.sync.nav.k, 'solid');
  assert.equal(w.sync.lookX, '');
  assert.deepEqual(w.local, {});
});

test('a partial Look nav patch preserves personal pictures through the parts quota fallback', async () => {
  const G = require('../defaults.js'), X = require('../lib/lookparts.js');
  require('../lib/nav.js');
  const nav = G.GZ_SANITIZE({ nav: { k: 'image', i: 'abcdefghijkl', brand: 'custom', li: 'mnopqrstuvwx' } }).nav;
  const pictures = { 'navLogo:mnopqrstuvwx': 'logo bytes', 'cardImg:abcdefghijkl': 'picture bytes' };
  const w = worker(structuredClone(pictures), { nav });
  const set = w.context.chrome.storage.sync.set, writes = [];
  w.context.chrome.storage.sync.set = (patch) => {
    writes.push(structuredClone(patch));
    return typeof patch.lookX === 'string' ? Promise.reject(new Error('item quota')) : set(patch);
  };
  const parts = { x: { cursor: { kind: 'trail', len: 24 } } };
  assert.deepEqual(await w.send({ type: 'glaze:look', parts, patch: { nav: { labels: 'small' }, bg: { kind: 'solid' } } }, w.editor), { ok: true });
  assert.equal(writes.length, 2, 'one rejected packed write, then one combined device fallback');
  assert.equal(w.sync.nav.labels, 'small');
  assert.equal(w.sync.nav.i, nav.i);
  assert.equal(w.sync.nav.li, nav.li);
  assert.deepEqual(await X.fromStored(w.sync.lookX, { get: async () => w.local }), parts);
  assert.deepEqual(Object.fromEntries(Object.entries(w.local).filter(([k]) => k !== 'lookX')), pictures);
});


test('the queued Look writer limits page callers to theme changes and refuses arbitrary storage keys', async () => {
  const w = worker({ moodle: ['https://moodle.example.edu/*'] }); // a Moodle the student approved (lib/background.js approved)
  const message = { type: 'glaze:look', parts: null, patch: { colors: { '--gz-accent': '#123456' } } };
  const denied = { ok: false, error: 'sender' };
  assert.deepEqual(await w.send(message, { id: 'other', tab: {}, url: `${SITE}/courses/1` }), denied);
  assert.deepEqual(await w.send({ ...message, parts: { x: { cursor: { kind: 'glow' } } } }), denied);
  assert.deepEqual(await w.send({ ...message, patch: { lookX: 'forged' } }, w.editor), denied);
  assert.deepEqual(await w.send({ ...message, patch: JSON.parse('{"__proto__":{}}') }, w.editor), denied);
  assert.deepEqual(w.sync, {});
  const moodle = { id: 'glaze', tab: {}, url: 'https://moodle.example.edu/my/' };
  assert.deepEqual(await w.send(message, { ...moodle, url: 'https://shop.example/' }), denied, 'not from a tab where only lib/detect.js runs (WP-C2)');
  assert.deepEqual(w.sync, {});
  assert.deepEqual(await w.send(message, moodle), { ok: true });
  assert.equal(w.sync.lookX, '');
  const popup = { id: 'glaze', url: 'chrome-extension://x/popup.html' };
  assert.deepEqual(await w.send({ type: 'glaze:look', parts: { x: { cursor: { kind: 'glow' } } }, patch: {} }, popup), { ok: true });
});


test('a command palette palette choice preserves the previous Look parts like popup and editor swatches', async () => {
  const X = require('../lib/lookparts.js');
  const w = worker({}, { lookX: await X.pack({ x: { cursor: { kind: 'glow' } } }) });
  ui(w);
  const source = read('features/palette.js');
  const store = source.slice(source.indexOf('  const store ='), source.indexOf('  const paletteItems ='));
  const palettes = source.split('\n').find((line) => line.includes('...GZ_ALL_PRESETS(s.presets).map')).trim().slice(3, -1);
  vm.runInContext(`(() => { const s = GZ_DEFAULTS, t = (s) => s; ${store}; (${palettes})[0].run(); })()`, w.context);
  await tick(30);
  assert.deepEqual(await X.unpack(w.sync.lookX), { x: { cursor: { kind: 'glow' } } });
});

test('rotation does not announce a favorite that could not be decoded or worn', async () => {
  const before = { mode: '6h 08:00', at: 1, i: 0 };
  const w = worker({ rotateState: before, rotateLooks: ['glaze1:bad'], lookFavorites: [{ code: 'glaze1:bad', name: 'Bad' }] }, { extras: { rotate: '6h', at: '08:00' } });
  w.context.GZ_SHARE = { decode: () => Promise.reject(new Error('bad code')) };
  assert.ok((await w.send({ type: 'glaze:rotate' })).ok);
  assert.equal(L.turned(before, w.local.rotateState), false);
});

test('queued builder edits merge only their named parts into the latest Look', async () => {
  const X = require('../lib/lookparts.js');
  const original = { x: { cursor: { kind: 'glow' }, nav: { place: 'left' } } };
  const latest = { x: { cursor: { kind: 'trail' }, nav: { place: 'left' }, bg: { shader: { src: 'vec4 scene(vec2 uv) { return vec4(uC1, 1.0); }' }, layers: [{ k: 'noise' }] },
    anim: { 'card.enter': { s: [{ at: 0, o: 0 }, { at: 1, o: 1 }] } }, fx: { complete: { kind: 'ring' } } },
    m: [{ id: 'abcdefghijklmnop', h: 'A'.repeat(43), name: 'Garden' }] };
  const w = worker({}, { lookX: await X.pack(latest), bg: { kind: 'shader' } });
  const edit = { type: 'glaze:look', parts: { x: { ...original.x, nav: { place: 'dock' } } }, partKeys: ['nav'], patch: { version: 2 } };
  assert.deepEqual(await w.send(edit, w.editor), { ok: true });
  assert.deepEqual(await X.unpack(w.sync.lookX), { ...latest, x: { ...latest.x, nav: { place: 'dock' } } });
  assert.equal(w.sync.bg.kind, 'shader');
  // A second stale editor removes its nav without removing the newly added shader or cursor.
  assert.deepEqual(await w.send({ ...edit, parts: original, partKeys: ['rules'] }, w.editor), { ok: true });
  assert.equal((await X.unpack(w.sync.lookX)).x.nav.place, 'dock');
  assert.deepEqual(await w.send({ ...edit, parts: { x: { cursor: original.x.cursor } } }, w.editor), { ok: true });
  const left = structuredClone(latest); delete left.x.nav;
  assert.deepEqual(await X.unpack(w.sync.lookX), left);
});

test('a background or motion builder edit merges only its own part, keeping the nav builder\'s', async () => {
  const X = require('../lib/lookparts.js');
  const stored = { x: { nav: { place: 'dock' }, cursor: { kind: 'glow' } } };
  const w = worker({}, { lookX: await X.pack(stored) });
  // A stale page copy without the nav: only the cursor is written.
  assert.deepEqual(await w.send({ type: 'glaze:look', parts: { x: { cursor: { kind: 'trail' } } }, partKeys: ['cursor'], patch: {} }, w.editor), { ok: true });
  assert.deepEqual(await X.unpack(w.sync.lookX), { x: { nav: { place: 'dock' }, cursor: { kind: 'trail' } } });
});

test('builder merges refuse malformed part names and unavailable device parts without writing', async () => {
  const w = worker({}, { lookX: { h: 'on-another-device' } });
  const edit = { type: 'glaze:look', parts: { x: { nav: { place: 'top' } } }, partKeys: ['nav'], patch: {} };
  const before = structuredClone(w.sync);
  assert.equal((await w.send(edit, w.editor)).ok, false);
  assert.deepEqual(w.sync, before);
  for (const partKeys of ['nav', [], ['__proto__'], ['lookX'], ['nav', 'nav']]) {
    assert.equal((await w.send({ ...edit, partKeys }, w.editor)).ok, false);
    assert.deepEqual(w.sync, before);
  }
});

test('the shared editor save forwards builder part keys through the queued writer', async () => {
  const X = require('../lib/lookparts.js'), G = require('../defaults.js');
  const w = worker({}, { lookX: await X.pack({ x: { cursor: { kind: 'trail' } } }) });
  ui(w);
  const result = await new Promise((done) => w.context.UI.save({ ...G.GZ_DEFAULTS, parts: { x: { nav: { place: 'top' } } } }, ['parts'], done, undefined, ['nav']));
  assert.equal(result, '');
  assert.deepEqual(await X.unpack(w.sync.lookX), { x: { cursor: { kind: 'trail' }, nav: { place: 'top' } } });
});
