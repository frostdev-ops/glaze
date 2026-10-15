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
    URL, console, TextEncoder, structuredClone, Promise, Date, setTimeout, clearTimeout, crypto: globalThis.crypto,
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
  return { send, local, sync: syncStore, context, editor: { id: 'glaze', tab: {}, url: 'chrome-extension://x/options.html' } };
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

test('rotation: a favorite still decoding when the student turns rotation off or changes the theme is not worn', async () => {
  const G = require('../defaults.js');
  const H = require('../lib/history.js');
  const start = () => {
    const s = G.GZ_SANITIZE({ ...G.GZ_LOOK_APPLY(G.GZ_DEFAULTS, G.GZ_LOOKS.find((l) => l.name === 'Library')), extras: { rotate: '6h' } });
    const w = worker({ rotateLooks: ['glaze1:fav'], rotateState: { mode: '6h 08:00', at: 1, i: -1 } }, structuredClone(s));
    // The favorite's code decodes when the test says so.
    let done;
    w.context.held = new Promise((r) => { done = r; });
    vm.runInContext('GZ_SHARE.decode = () => globalThis.held;', w.context);
    const got = { colors: G.GZ_PRESETS.find(([n]) => n === 'Forest')[1], look: { font: 'jetbrains-mono' }, bg: {}, card: {}, cards: [] };
    return { w, s, decoded: () => done(got) };
  };
  // Turned off meanwhile.
  let { w, decoded } = start();
  let turn = w.send({ type: 'glaze:rotate' });
  await tick(5);
  w.sync.extras = { ...w.sync.extras, rotate: 'off' };
  decoded();
  assert.deepEqual(await turn, { ok: false, error: 'changed' });
  assert.notEqual(w.sync.look.font, 'jetbrains-mono');
  // A Look picked by hand meanwhile.
  let s;
  ({ w, s, decoded } = start());
  turn = w.send({ type: 'glaze:rotate' });
  await tick(5);
  const mine = G.GZ_LOOK_APPLY(s, G.GZ_LOOKS.find((l) => l.name === 'Clear'));
  Object.assign(w.sync, structuredClone(mine));
  decoded();
  await turn;
  assert.deepEqual(H.theme(G.GZ_SANITIZE(w.sync)), H.theme(G.GZ_SANITIZE({ ...s, ...mine })), 'the hand-picked Look stays');
  // Nothing changed meanwhile: worn.
  ({ w, decoded } = start());
  turn = w.send({ type: 'glaze:rotate' });
  await tick(5);
  decoded();
  assert.ok((await turn).ok);
  assert.equal(w.sync.look.font, 'jetbrains-mono');
  assert.equal(w.local.rotateState.i, 0);
});

// ---- the page -------------------------------------------------------------------------------------------------------
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
  const settings = { extras: { cursor: 'off', stickers: true, rotate: 'off', at: '08:00' } };
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
    document: { documentElement: html, head, body, createElement: (t) => new El(t), getElementById: (id) => html.find(id), addEventListener() {}, hidden: false },
    chrome: {
      runtime: { getURL: (f) => `chrome-extension://x/${f}`, sendMessage: (m, cb) => send(structuredClone(m), cb) },
      storage: {
        onChanged: { addListener() {} },
        sync: { set() {} },
        local: {
          get: (keys, cb) => {
            const answer = () => cb(structuredClone(keys === null ? local : Object.fromEntries([].concat(keys).filter((k) => k in local).map((k) => [k, local[k]]))));
            if (hold(keys)) held.push({ keys, release: answer }); else setTimeout(answer);
          },
        },
      },
    },
    GZ_MATCH_PRESET: () => null,
    GZ_CTX: { t: (k) => k, need: () => Promise.resolve(), settings: () => settings, on: () => true },
  });
  context.window = context;
  context.top = context;
  context.globalThis = context;
  vm.runInContext(read('lib/lookx.js'), context);
  vm.runInContext(read('features/lookx.js'), context);
  // Runs the timers due now (the 300 ms save; not rotation's ten-minute one).
  const runTimers = () => { for (const [id, f] of [...fns]) if (timers.get(id) <= 1000) { timers.delete(id); fns.delete(id); f(); } };
  const fire = (type, e = {}) => { for (const f of win[type] || []) f(e); };
  return { lx: context.GZ_LOOKX, location: context.location, runTimers, fire, settings, html, body, held, timers, blobs, holdWhen: (f) => { hold = f; } };
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
  p.settings.extras = { ...p.settings.extras, cursor: 'own' };
  await p.lx.sync();
  for (let i = 0; i < 5; i++) await tick();
  const text = JSON.stringify((function walk(e) { return { a: e.attrs, s: e.style, src: e.src, kids: e.children.map(walk) }; })(p.html));
  assert.ok(!text.includes('data:'), 'no data: URL in the page');
  assert.match(p.html.style['--gz-cursor'], /^url\("blob:x\/\d+"\) 0 0, auto$/);
  const img = p.body.find('gz-stickers').children[0].children[0];
  assert.match(img.src, /^blob:x\//);
  assert.equal(p.blobs.size, 2, 'the sticker and the pointer');
  // Pointer off: its address is revoked.
  p.settings.extras = { ...p.settings.extras, cursor: 'off' };
  await p.lx.sync();
  await tick();
  assert.equal(p.blobs.size, 1);
  assert.equal(p.html.style['--gz-cursor'], undefined);
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
  p.settings.extras = { ...p.settings.extras, stickers: false, cursor: 'own' };
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
