// The built-in Looks' own parts (lib/lookset.js), and moving the pointer that used to be a setting into the Look worn.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const G = require('../defaults.js');
const MX = require('../lib/motionx.js');
const X = require('../lib/lookparts.js');
const S = require('../lib/share.js');
const LOOK_PARTS = require('../lib/lookset.js');
const L = require('../lib/lookx.js');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('every built-in Look has a full set: its own pointer, the pointer\'s animation, a typing effect and every event', () => {
  const sets = new Set();
  for (const look of G.GZ_LOOKS) {
    const P = LOOK_PARTS(look);
    assert.ok(P, look.name);
    assert.ok(X.same(X.bundle(P), P), `${look.name}: its parts clean as they are`);
    assert.ok(L.CURSORS[P.x.pointer]?.svg, `${look.name}: a drawn set`);
    sets.add(P.x.pointer);
    assert.ok(MX.cursor(P.x.cursor), look.name);
    assert.ok(MX.typing(P.x.type), look.name);
    assert.deepEqual(Object.keys(P.x.fx).sort(), [...MX.EVENTS].sort(), look.name);
  }
  assert.equal(sets.size, G.GZ_LOOKS.length, 'a set of its own each');
  assert.equal(LOOK_PARTS({ name: 'Not a Look' }), null);
  const a = LOOK_PARTS(G.GZ_LOOKS[0]);
  a.x.pointer = 'aqua';
  assert.equal(LOOK_PARTS(G.GZ_LOOKS[0]).x.pointer, 'aurora', 'a copy each time');
});

test('a built-in Look\'s code carries its parts; the student\'s own pointer picture never goes in a code', async () => {
  const look = G.GZ_LOOKS.find((l) => l.name === 'Graveyard');
  const s = { ...G.GZ_DEFAULTS, ...G.GZ_LOOK_APPLY(G.GZ_DEFAULTS, look) };
  const code = await S.encode(s, {}, LOOK_PARTS(look), { files: false });
  assert.ok(code.startsWith('glaze2:'));
  assert.ok(X.same((await S.decode(code)).parts, LOOK_PARTS(look)));
  const own = await S.encode(s, {}, { x: { ...LOOK_PARTS(look).x, pointer: 'own' } });
  assert.equal((await S.decode(own)).parts.x.pointer, undefined, 'the rest of the Look goes, without the pointer');
  assert.ok((await S.decode(own)).parts.x.type);
  assert.ok((await S.encode(s, {}, { x: { pointer: 'own' } })).startsWith('glaze1:'), 'nothing else: a plain code');
});

test('pointer and typing parts: names from the tables, values clamped, anything else refused', () => {
  for (const p of MX.POINTERS) assert.equal(X.clean({ pointer: p })?.pointer, p);
  for (const p of ['off', '', 'https://evil.example/cursor.png', 'data:image/png;base64,AAAA', 5, null]) assert.equal(X.clean({ pointer: p }), null, String(p));
  assert.deepEqual(X.clean({ type: { kind: 'snow', size: 99, count: 0.4 } }).type, { kind: 'snow', size: 24, count: 1 });
  for (const t of [{ kind: 'lasers' }, { kind: 'ink', text: 'x' }, { size: 3 }, { kind: 'ink', c: ['url(x)'] }]) assert.equal(X.clean({ type: t }), null, JSON.stringify(t));
  assert.equal(X.clean({ cursor: { kind: 'orbit', shape: 'bat' } }).cursor.shape, 'bat');
  assert.equal(X.clean({ cursor: { kind: 'orbit', shape: 'skull' } }), null);
  assert.ok(X.clean({ fx: { complete: { kind: 'sprite', shapes: ['ghost', 'pumpkin'] } } }), 'event effects draw the marks');
  assert.equal(X.clean({ bg: { layers: [{ k: 'particles', shape: 'bat' }] } }), null, 'a background layer only its own shapes');
});

// The real worker (lib/background.js) over stand-in storage.
const worker = (sync, local = {}) => {
  const later = (fn) => new Promise((res) => setTimeout(() => res(fn())));
  const area = (s) => ({
    get: (k) => later(() => structuredClone(k === null ? s : Object.fromEntries([].concat(k).filter((x) => x in s).map((x) => [x, s[x]])))),
    set: (v) => later(() => { Object.assign(s, structuredClone(v)); }),
    remove: (k) => later(() => { for (const x of [].concat(k)) delete s[x]; }),
  });
  const noop = { addListener() {} };
  const context = vm.createContext({
    URL, console, TextEncoder, TextDecoder, Blob, CompressionStream, DecompressionStream, btoa, atob, structuredClone, Promise, Date, setTimeout, clearTimeout, crypto: globalThis.crypto,
    importScripts: (...files) => { for (const f of files) vm.runInContext(read(`lib/${f}`), context); },
    chrome: {
      runtime: { id: 'glaze', getURL: (f = '') => `chrome-extension://x/${f}`, getManifest: () => require('../manifest.json'), onMessage: noop, onInstalled: noop, onStartup: noop, onConnect: noop },
      storage: { local: area(local), sync: area(sync), onChanged: noop },
    },
  });
  vm.runInContext(read('lib/background.js'), context);
  return { move: () => vm.runInContext('pointerToLook()', context), sync, local };
};

test('the pointer a student chose as a setting moves into the Look they wear, once, and the setting goes', async () => {
  const glow = { x: { cursor: { kind: 'glow' } } };
  const w = worker({ extras: { cursor: 'lilac', stickers: true, rotate: 'off', at: '08:00' }, lookX: await X.pack(glow) });
  await w.move();
  assert.deepEqual(w.sync.extras, { stickers: true, rotate: 'off', at: '08:00' });
  assert.ok(X.same(await X.unpack(w.sync.lookX), { x: { cursor: { kind: 'glow' }, pointer: 'lilac' } }), 'kept, with the Look\'s own parts');
  const again = w.sync.lookX;
  await w.move();
  assert.equal(w.sync.lookX, again, 'once');
  // No parts yet: the pointer is the Look's first part. 'own' is kept as 'own' (the picture stays where it is).
  const own = worker({ extras: { cursor: 'own', stickers: false } });
  await own.move();
  assert.ok(X.same(await X.unpack(own.sync.lookX), { x: { pointer: 'own' } }));
  // Off, or a Look that already has a pointer: only the setting goes.
  for (const [cursor, parts] of [['off', null], ['aqua', { x: { pointer: 'ghost' } }]]) {
    const v = worker({ extras: { cursor }, ...(parts && { lookX: await X.pack(parts) }) });
    await v.move();
    assert.deepEqual(v.sync.extras, {});
    assert.ok(parts ? X.same(await X.unpack(v.sync.lookX), parts) : v.sync.lookX === undefined, cursor);
  }
  // Parts kept on another computer can't be seen: the setting waits.
  const away = worker({ extras: { cursor: 'pearl' }, lookX: { h: 'abc' } });
  await away.move();
  assert.deepEqual(away.sync.extras, { cursor: 'pearl' });
});
