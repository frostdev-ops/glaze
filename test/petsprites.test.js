const test = require('node:test'), assert = require('node:assert/strict');
const S = require('../lib/petsprites.js'), P = require('../lib/pet.js');

test('both ChatGPT layouts validate without trusting metadata paths or versions', () => {
  assert.equal(S.meta({ name: '<img onerror=x>', spritesheet: 'https://bad.test/x' }, 1536, 1872).spriteVersionNumber, 1);
  assert.equal(S.meta({}, 1536, 2288).spriteVersionNumber, 2);
  assert.deepEqual(Object.keys(S.meta({ url: 'https://bad.test', script: 'bad' }, 1536, 2288)).sort(), ['description', 'name', 'spriteVersionNumber']);
  for (const args of [[{}, 1536, 208], [{ spriteVersionNumber: 3 }, 1536, 2288], [{ spriteVersionNumber: 1 }, 1536, 2288], [{}, 100000, 100000]]) assert.throws(() => S.meta(...args));
});
test('frame addressing respects each state count and clockwise gaze order', () => {
  for (const [row, state] of S.STATES.entries()) {
    assert.deepEqual(S.frame(state, 0), { x: 0, y: row * 208, width: 192, height: 208 });
    assert.equal(S.frame(state, S.COUNTS[row] * 125).x, 0);
    assert.equal(S.frame(state, (S.COUNTS[row] - 1) * 125).x, (S.COUNTS[row] - 1) * 192);
  }
  assert.deepEqual([S.direction(0, -1), S.direction(1, 0), S.direction(0, 1), S.direction(-1, 0)], [0, 4, 8, 12]);
  assert.equal(S.frame('look', 8).y, 2080); assert.equal(S.frame('look', 8, 1).y, 0);
});
test('required frames and trailing cells are contiguous and transparent gaps are refused', () => {
  const rgba = new Uint8ClampedArray(1536 * 2288 * 4);
  for (let row = 0; row < 11; row++) for (let frame = 0; frame < S.COUNTS[row]; frame++) rgba[((row * 208 + 10) * 1536 + frame * 192 + 10) * 4 + 3] = 255;
  assert.deepEqual(S.pixels(rgba, 2), S.COUNTS);
  rgba[(10 * 1536 + 7 * 192 + 10) * 4 + 3] = 255;
  assert.throws(() => S.pixels(rgba, 2));
  rgba[(10 * 1536 + 7 * 192 + 10) * 4 + 3] = 0; rgba[(10 * 1536 + 10) * 4 + 3] = 0;
  assert.throws(() => S.pixels(rgba, 2));
});
test('imports refuse executable formats, enormous dimensions and capacity failures before changing storage', async () => {
  for (const data of ['data:image/svg+xml;base64,PHN2Zz4=', 'https://bad.test/x', 'data:image/png;base64,@@@@', 'x'.repeat(S.MAX_IMAGE + 1)]) assert.throws(() => S.dataBytes(data));
  let writes = 0;
  const local = { get: async () => { throw Error('read failed'); }, set: async () => { writes++; return true; } };
  await assert.rejects(S.change({ op: 'delete', id: 'own:00000000-0000-0000-0000-000000000000' }, { local })); assert.equal(writes, 0);
  assert.throws(() => S.clean(null)); assert.throws(() => S.clean(Array(9).fill({})));
  await assert.rejects(S.normalize(new TextEncoder().encode('<svg onload="bad"/>')));
  const png = new Uint8Array(24); png.set([137, 80, 78, 71]); new DataView(png.buffer).setUint32(16, 100000); new DataView(png.buffer).setUint32(20, 100000);
  await assert.rejects(S.normalize(png), /layout/);
});
test('adding a pet selection preserves XP, rewards, provider clocks and habitat', () => {
  const before = { earned: { 'work:assignment:7': 20 }, seen: { 'assignment:7': 42 }, sub: { 'assignment:7': 40 }, days: [1, 2], decor: { books: 3 }, wear: 'plain' };
  const after = P.view({ ...before, sprite: 'ember' });
  assert.equal(after.sprite, 'ember'); assert.equal(after.work, 20); assert.deepEqual(after.decor, before.decor); assert.deepEqual(after.sub, before.sub);
  assert.equal(P.clean({ ...before, sprite: '../../bad.js' }).sprite, '');
});

test('pet library writes are restricted to the top-level editor; LMS reads need a confirmed site and opt-in', async () => {
  const fs = require('node:fs'), vm = require('node:vm');
  const source = fs.readFileSync(require.resolve('../lib/background.js'), 'utf8');
  const setup = source.slice(source.indexOf('const fromEditor'), source.indexOf('// The notes app'));
  const local = { ultra: ['https://school.test'] }, sync = { enhance: { pet: true } };
  const chrome = { runtime: { id: 'glaze', getURL: (p) => `chrome-extension://glaze/${p}`, getManifest: () => ({ host_permissions: ['<all_urls>'] }) },
    storage: { local: { get: async () => local }, sync: { get: async () => sync } } };
  const allow = vm.runInNewContext(`${setup} BROKER.petSprites.allow`, { chrome, URL, GZ_PET: P, GZ_SANITIZE: require('../defaults.js').GZ_SANITIZE, GZ_BUILT_IN: require('../defaults.js').GZ_BUILT_IN });
  const editor = { id: 'glaze', frameId: 0, origin: 'chrome-extension://glaze', url: 'chrome-extension://glaze/options.html#look/pets' };
  assert.equal(await allow({ op: 'import' }, editor), true);
  assert.equal(await allow({ op: 'delete' }, { ...editor, frameId: 1 }), false);
  assert.equal(await allow({ op: 'import' }, { ...editor, origin: 'https://bad.test' }), false);
  const site = { id: 'glaze', tab: {}, frameId: 0, url: 'https://school.test/ultra/courses' }, key = 'pet:https://school.test/_3_1';
  for (const op of ['import', 'delete']) assert.equal(await allow({ op, key }, site), false);
  for (const op of ['list', 'get']) assert.equal(await allow({ op, key }, site), true);
  assert.equal(await allow({ op: 'list', key: 'pet:https://other.test/_3_1' }, site), false);
  local.ultra = [];
  assert.equal(await allow({ op: 'get', key }, site), false);
  local.ultra = ['https://school.test']; sync.enhance.pet = false;
  assert.equal(await allow({ op: 'list', key }, site), false);
  sync.enhance.pet = true; sync.enabled = false;
  assert.equal(await allow({ op: 'list', key }, site), false);
});

test('existing app metadata and a seventh idle frame survive safe import addressing', () => {
  const raw = require('../assets/art/pets/rime/pet.json');
  assert.equal(S.meta(raw, 1536, 2288).name, 'Rime');
  assert.equal(S.meta({ name: '\u0000', displayName: ' Rime ' }, 1536, 2288).name, 'Rime');
  const rgba = new Uint8ClampedArray(1536 * 2288 * 4), frameCounts = [7, ...S.COUNTS.slice(1)];
  for (let row = 0; row < 11; row++) for (let col = 0; col < frameCounts[row]; col++) rgba[((row * 208 + 10) * 1536 + col * 192 + 10) * 4 + 3] = 255;
  assert.deepEqual(S.pixels(rgba, 2), frameCounts);
  assert.equal(S.frame('idle', 750, 2, frameCounts).x, 1152);
  assert.equal(S.frame('idle', 875, 2, frameCounts).x, 0);
  assert.deepEqual(S.BUILTIN.rime.frameCounts, frameCounts); assert.equal(S.BUILTIN.glaze.name, 'Glaze');
  for (const invalid of [[5, ...S.COUNTS.slice(1)], [9, ...S.COUNTS.slice(1)], [6], Array(11).fill(7), [6.5, ...S.COUNTS.slice(1)]]) assert.throws(() => S.counts(invalid, 2));
  assert.deepEqual(S.counts(undefined, 1), S.COUNTS.slice(0, 9));
});

test('normalization derives counts from decoded alpha and the broker preserves them after re-encoding', async () => {
  const fs = require('node:fs'), vm = require('node:vm'), raw = require('../assets/art/pets/rime/pet.json');
  const rgba = new Uint8ClampedArray(1536 * 2288 * 4), frameCounts = [7, ...S.COUNTS.slice(1)];
  for (let row = 0; row < 11; row++) for (let col = 0; col < frameCounts[row]; col++) rgba[((row * 208 + 10) * 1536 + col * 192 + 10) * 4 + 3] = 255;
  const encoded = new Uint8Array([82, 73, 70, 70, 0, 0, 0, 0, 87, 69, 66, 80]);
  const lib = vm.runInNewContext(fs.readFileSync(require.resolve('../lib/petsprites.js'), 'utf8'), {
    GZ_DOCTEXT: { imageSize: () => ({ w: 1536, h: 2288 }) }, Uint8Array, Blob, TextDecoder, atob, btoa, crypto: globalThis.crypto,
    createImageBitmap: async () => ({ width: 1536, height: 2288, close() {} }),
    OffscreenCanvas: class { getContext() { return { drawImage() {}, getImageData: () => ({ data: rgba }) }; } convertToBlob() { return Promise.resolve(new Blob([encoded], { type: 'image/webp' })); } },
  });
  const png = new Uint8Array(24); png.set([137, 80, 78, 71]);
  const data = S.dataURL(png, 'image/png'), store = {}, local = { get: async () => store, set: async (patch) => { Object.assign(store, patch); return true; } };
  const imported = await lib.change({ op: 'import', data, meta: { ...raw, frameCounts: Array(11).fill(8), spritesheetPath: 'https://bad.test/not-used' } }, { local });
  assert.equal(imported.ok, true);
  const pet = (await lib.change({ op: 'get', id: imported.id }, { local })).pet;
  assert.equal(pet.name, 'Rime'); assert.deepEqual(Array.from(pet.frameCounts), frameCounts);
  assert.equal(pet.data, S.dataURL(encoded, 'image/webp')); assert.notEqual(pet.data, data);
  assert.equal(pet.spritesheetPath, undefined);
  store.petSprites[imported.id].frameCounts[0] = 9;
  await assert.rejects(lib.change({ op: 'get', id: imported.id }, { local }), /Invalid sprite pixels/);
});

test('WID-6: an unchanged imported library is decoded once, not on every pet operation', async () => {
  const lib = {};
  for (let i = 0; i < 2; i++) lib[`own:${crypto.randomUUID()}`] = { name: `P${i}`, spriteVersionNumber: 2, data: `data:image/webp;base64,${Buffer.alloc(3000, i + 1).toString('base64')}` };
  const [first] = Object.keys(lib), store = { petSprites: lib };
  const local = { get: async () => structuredClone(store), set: async (patch) => { Object.assign(store, structuredClone(patch)); return true; } };
  const real = globalThis.atob; let decoded = 0;
  globalThis.atob = (s) => { decoded++; return real(s); };
  try {
    for (let i = 0; i < 4; i++) assert.equal((await S.change({ op: 'get', id: 'ember' }, { local })).ok, true);
    assert.equal(decoded, 2, 'two images decoded once for four operations');
    assert.equal((await S.change({ op: 'get', id: first }, { local })).pet.name, 'P0');
    assert.equal(decoded, 2);
    // A change to the stored library (another surface, an import or delete) is seen at once.
    store.petSprites = { ...lib }; delete store.petSprites[first];
    assert.equal((await S.change({ op: 'get', id: first }, { local })).pet, null);
    assert.equal(decoded, 3, 'the remaining image is checked again after the change');
    store.petSprites[Object.keys(store.petSprites)[0]].frameCounts = [99, 8, 8, 4, 5, 8, 6, 6, 6, 8, 8];
    await assert.rejects(S.change({ op: 'get', id: 'ember' }, { local }), /Invalid sprite pixels/);
    // A rejected library is never remembered as good.
    await assert.rejects(S.change({ op: 'list' }, { local }), /Invalid sprite pixels/);
  } finally { globalThis.atob = real; }
});

test('a malformed sprite library cannot hit the empty-library cache by omitting undefined entries from JSON', async () => {
  const store = { petSprites: {} }, local = { get: async () => structuredClone(store) };
  assert.equal((await S.change({ op: 'get', id: 'ember' }, { local })).ok, true);
  store.petSprites = { invalid: undefined };
  await assert.rejects(S.change({ op: 'get', id: 'ember' }, { local }), /Pet library could not be read/);
  await assert.rejects(S.change({ op: 'list' }, { local }), /Pet library could not be read/);
});
