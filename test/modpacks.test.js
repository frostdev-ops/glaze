// What a mod carries without any code: sticker packs (a picture, an animated WebP or AVIF, a Lottie file) and pet sprite sheets
// (mod.json `packs`). Its manifest is checked strictly (lib/media.js packs, lib/modbundle.js), the worker answers only for mods
// that are on and not blocked and hands back cleaned copies (lib/modbroker.js page ops 'packs' and 'sticker'), a pet goes into
// the library through the same decoding and checks as an import (lib/petsprites.js 'fromMod'), and the page draws a sticker with
// motion off, hidden and gone as it must (features/lookx.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const M = require('../lib/media.js');
const B = require('../lib/modbroker.js');
const BUNDLE = require('../lib/modbundle.js');
const PETS = require('../lib/petsprites.js');
const L = require('../lib/lookx.js');

const root = path.join(__dirname, '..');
const fx = (f) => new Uint8Array(fs.readFileSync(path.join(__dirname, 'fixtures/media', f)));
const b64 = (bytes) => Buffer.from(bytes).toString('base64');
const flush = () => new Promise(setImmediate);
const ID = 'abcdefghijklmnop', OTHER = 'qrstuvwxyz234567', SITE = 'https://school.instructure.com';
const plain = (x) => JSON.parse(JSON.stringify(x));

// ---- the manifest -------------------------------------------------------------------------------------------------------
const FILES = { 'stickers/wave.webp': 1, 'stickers/spark.json': 1, 'stickers/ok.png': 1, 'stickers/ok.avif': 1, 'pets/mochi.webp': 1, 'pets/mochi.png': 1 };
const has = (f) => Object.hasOwn(FILES, f);
const good = () => ({ stickers: [{ id: 'wave', name: 'Waving hand', file: 'stickers/wave.webp' }, { id: 'spark', name: 'Spark', file: 'stickers/spark.json' }], pets: [{ id: 'mochi', name: 'Mochi 2', file: 'pets/mochi.webp' }] });

test('packs: both lists clean to themselves, in the cleaner\'s order of keys, and cleaning twice changes nothing', () => {
  const once = M.packs(good(), has);
  assert.deepEqual(once, good());
  assert.deepEqual(M.packs(once, has), once);
  assert.deepEqual(M.packs({ pets: good().pets }, has), { pets: good().pets });
  assert.deepEqual(M.packs({ stickers: good().stickers.slice(0, 1) }, has), { stickers: good().stickers.slice(0, 1) });
  assert.deepEqual(Object.keys(M.packs({ pets: good().pets, stickers: good().stickers }, has)), ['stickers', 'pets']);
  assert.deepEqual(M.packs({ stickers: [{ file: 'stickers/ok.png', name: 'x', id: 'a' }] })?.stickers[0], { id: 'a', name: 'x', file: 'stickers/ok.png' }, 'has defaults to anything goes');
});

test('packs: what is not a pack is refused whole', () => {
  const s = (over) => ({ stickers: [{ id: 'wave', name: 'Wave', file: 'stickers/wave.webp', ...over }] });
  const p = (over) => ({ pets: [{ id: 'mochi', name: 'Mochi', file: 'pets/mochi.webp', ...over }] });
  const many = (n, k = 'stickers') => ({ [k]: Array.from({ length: n }, (_, i) => ({ id: `s${i}`, name: 'x', file: 'stickers/ok.png' })) });
  const bad = {
    'not an object': 'x', array: [], null: null, number: 5, nothing: {}, 'unknown list': { sounds: [] }, 'a list and an unknown': { ...s(), music: [] },
    'empty list': { stickers: [] }, 'list not a list': { stickers: {} }, 'item not an object': { stickers: ['x'] }, 'item an array': { stickers: [[]] },
    'an extra key on an item': s({ url: 'https://evil.example/x.png' }), 'a missing key': { stickers: [{ id: 'wave', file: 'stickers/wave.webp' }] },
    'id with capitals': s({ id: 'Wave' }), 'id with an underscore': s({ id: 'a_b' }), 'id starting with a digit': s({ id: '1a' }), 'id too long': s({ id: 'a'.repeat(33) }), 'id empty': s({ id: '' }), 'id not text': s({ id: 5 }),
    'name empty': s({ name: '' }), 'name not text': s({ name: 5 }), 'name with a double space': s({ name: 'a  b' }), 'name with edge spaces': s({ name: ' a' }),
    'name with a newline': s({ name: 'a\\nb'.replace('\\n', '\n') }), 'name with a direction mark': s({ name: 'a‮b' }), 'name with a control': s({ name: 'a\u0007b' }), 'name over 40 characters': s({ name: 'x'.repeat(41) }),
    'file not text': s({ file: 5 }), 'file empty': s({ file: '' }), 'file an address': s({ file: 'https://evil.example/x.png' }), 'file a path up': s({ file: '../x.png' }),
    'file a path from the root': s({ file: '/x.png' }), 'file with a dot part': s({ file: './x.png' }), 'file hidden': s({ file: 'stickers/.x.png' }), 'file with a backslash': s({ file: 'stickers\\x.png' }),
    'file over 200': s({ file: `${'a'.repeat(200)}.png` }), 'file nine deep': s({ file: 'a/b/c/d/e/f/g/h/i.png' }),
    'sticker file a script': s({ file: 'stickers/x.js' }), 'sticker file svg': s({ file: 'stickers/x.svg' }), 'sticker file html': s({ file: 'stickers/x.html' }), 'sticker file gif': s({ file: 'stickers/x.gif' }), 'sticker file without an extension': s({ file: 'stickers/x' }),
    'pet file json': p({ file: 'pets/x.json' }), 'pet file avif': p({ file: 'pets/x.avif' }),
    'a file the bundle does not have': s({ file: 'stickers/missing.png' }),
    'the same id twice': { stickers: [good().stickers[0], good().stickers[0]] },
    'over 24 stickers': many(25), 'over 4 pets': { pets: Array.from({ length: 5 }, (_, i) => ({ id: `p${i}`, name: 'x', file: 'pets/mochi.png' })) },
  };
  for (const [why, v] of Object.entries(bad)) assert.equal(M.packs(v, has), null, why);
  assert.equal(M.packs(many(24), has)?.stickers.length, 24, '24 stickers is the limit');
  assert.equal(M.packs({ pets: Array.from({ length: 4 }, (_, i) => ({ id: `p${i}`, name: 'x', file: 'pets/mochi.png' })) }, has)?.pets.length, 4, '4 pets is the limit');
  for (const file of ['stickers/x.PNG', 'stickers/x.Avif', 'a/b/c/d/e/f/g/x.png']) assert.ok(M.packs({ stickers: [{ id: 'a', name: 'x', file }] }), file);
  assert.equal(M.packs(JSON.parse('{"stickers":[{"id":"a","name":"x","file":"a.png","__proto__":{"y":1}}]}')), null, 'a __proto__ key is a key');
});

test('a mod\'s mod.json takes packs only as written, with files the bundle has', () => {
  const raw = (packs) => ({ glaze: 1, name: 'Stickers', version: '1.0.0', author: { name: 'Kai', key: 'A'.repeat(43) }, packs });
  const files = Object.fromEntries(Object.keys(FILES).map((f) => [f, new Uint8Array([1])]));
  assert.deepEqual(BUNDLE.clean(raw(good()), files).packs, good());
  const { packs, ...without } = raw(good());
  assert.equal(BUNDLE.clean(without, files).packs, undefined, 'packs are optional');
  for (const [why, packs] of [['unknown key', { ...good(), music: [] }], ['a file that is not there', { stickers: [{ id: 'a', name: 'x', file: 'stickers/none.png' }] }], ['empty', {}], ['text', 'x'], ['a list', []]]) {
    assert.throws(() => BUNDLE.clean(raw(packs), files), (e) => e.vars?.field === 'packs', why);
  }
  assert.throws(() => BUNDLE.clean(raw(good()), { 'stickers/wave.webp': new Uint8Array(1) }), (e) => e.vars?.field === 'packs', 'files are looked up in the bundle');
});

// ---- the worker's answers -----------------------------------------------------------------------------------------------
const area = (data = {}) => ({
  data,
  async get(k) { await flush(); const keys = k === null ? Object.keys(data) : [].concat(k); return structuredClone(Object.fromEntries(keys.filter((x) => x in data).map((x) => [x, data[x]]))); },
  async set(p) { await flush(); Object.assign(data, structuredClone(p)); return true; },
  async remove(k) { await flush(); for (const x of [].concat(k)) delete data[x]; return true; },
});
const rec = (id = ID, over = {}) => ({
  id, enabled: true, hash: `h-${id}`, key: `k-${id}`, version: '1.0.0', source: 'file', installedAt: 1, dev: false,
  manifest: { glaze: 1, name: id === ID ? 'Garden' : 'Other', permissions: [], packs: {
    stickers: [{ id: 'wave', name: 'Waving', file: 'wave.webp' }, { id: 'still', name: 'Still', file: 'still.webp' }, { id: 'spark', name: 'Spark', file: 'spark.json' }, { id: 'photo', name: 'Photo', file: 'photo.avif' }],
    pets: [{ id: 'mochi', name: 'Mochi 2', file: 'mochi.png' }] } },
  grants: {},
  files: { 'wave.webp': b64(fx('anim.webp')), 'still.webp': b64(fx('still.webp')), 'spark.json': b64(fx('spin.json')), 'photo.avif': b64(fx('anim.avif')), 'mochi.png': b64(Uint8Array.of(137, 80, 78, 71)), 'hooks.js': b64(Buffer.from('1')) },
  ...over,
});
const env = ({ records = [rec()], list = null, order, site = SITE } = {}) => {
  const data = { mods: records.map((r) => r.id), ...(order && { modOrder: order }) };
  for (const r of records) data[`mod:${r.id}`] = r;
  return { site, local: area(data), sync: area(), queue: (f) => f(), keys: async () => Object.keys(data), record: async (id) => data[`mod:${id}`], blocklist: async () => list };
};
const ask = (e, m) => B.page(m, e);

test('page op packs: what the mods that are on bring, by name, in the student\'s order, and nothing for a mod that is off, blocked or sending nothing', async () => {
  const e = env({ records: [rec(ID), rec(OTHER)], order: [OTHER, ID] });
  assert.deepEqual(await ask(e, { op: 'packs' }), { ok: true, packs: [
    { mod: OTHER, name: 'Other', stickers: [{ id: 'wave', name: 'Waving' }, { id: 'still', name: 'Still' }, { id: 'spark', name: 'Spark' }, { id: 'photo', name: 'Photo' }], pets: [{ id: 'mochi', name: 'Mochi 2' }] },
    { mod: ID, name: 'Garden', stickers: [{ id: 'wave', name: 'Waving' }, { id: 'still', name: 'Still' }, { id: 'spark', name: 'Spark' }, { id: 'photo', name: 'Photo' }], pets: [{ id: 'mochi', name: 'Mochi 2' }] }] });
  assert.deepEqual((await ask(env({ records: [rec(ID, { enabled: false })] }), { op: 'packs' })).packs, [], 'off');
  assert.deepEqual((await ask(env({ records: [rec(ID, { blocked: 'bad' })] }), { op: 'packs' })).packs, [], 'marked blocked');
  assert.deepEqual((await ask(env({ list: { mods: [ID] } }), { op: 'packs' })).packs, [], 'on the blocklist');
  assert.deepEqual((await ask(env({ records: [rec(ID, { manifest: { name: 'No packs', permissions: [] } })] }), { op: 'packs' })).packs, [], 'no packs');
  assert.deepEqual((await ask(env({ records: [rec(ID, { manifest: { name: 'Bad', packs: { stickers: [{ id: 'x', name: 'x', file: 'nope.png' }] } } })] }), { op: 'packs' })).packs, [], 'a manifest that no longer cleans is skipped');
  assert.deepEqual(await ask(env({ site: null }), { op: 'packs' }), { ok: false, error: 'sender' }, 'only a page Glaze runs on');
});

test('page op sticker: a picture and a Lottie file come back cleaned, anything wrong is refused', async () => {
  const e = env();
  const wave = await ask(e, { op: 'sticker', mod: ID, id: 'wave' });
  assert.deepEqual([wave.ok, wave.kind, wave.mime, wave.animated], [true, 'image', 'image/webp', true]);
  assert.deepEqual(Buffer.from(wave.b64, 'base64'), Buffer.from(fx('anim.webp')));
  const still = await ask(e, { op: 'sticker', mod: ID, id: 'still' });
  assert.deepEqual([still.kind, still.animated], ['image', false]);
  const avif = await ask(e, { op: 'sticker', mod: ID, id: 'photo' });
  assert.deepEqual([avif.kind, avif.mime, avif.animated], ['image', 'image/avif', true]);
  const spark = await ask(e, { op: 'sticker', mod: ID, id: 'spark' });
  assert.deepEqual([spark.ok, spark.kind, spark.json.w, spark.json.h, spark.canvases], [true, 'lottie', 200, 120, 1]);
  // A WebP with metadata is cleaned on the way out.
  const chunk = (id, data) => [...Buffer.from(id), data.length & 255, 0, 0, 0, ...data, ...(data.length & 1 ? [0] : [])];
  const body = [...Buffer.from('WEBP'), ...chunk('VP8X', [0x08, 0, 0, 0, 15, 0, 0, 15, 0, 0]), ...chunk('VP8L', [0x2f, 0x0f, 0xc0, 0x03, 0, 0, 0, 0, 0]), ...chunk('EXIF', [9, 9, 9, 9])];
  const img = Uint8Array.from([...Buffer.from('RIFF'), body.length & 255, 0, 0, 0, ...body]);
  const e2 = env({ records: [rec(ID, { files: { ...rec().files, 'wave.webp': b64(img) } })] });
  const cleaned = await ask(e2, { op: 'sticker', mod: ID, id: 'wave' });
  assert.equal(cleaned.ok, true);
  assert.equal(Buffer.from(cleaned.b64, 'base64').includes(Buffer.from('EXIF')), false, 'the metadata is gone');
  for (const [why, m, error] of [
    ['an id that is not in the pack', { mod: ID, id: 'nope' }, 'asset'], ['an id of another list', { mod: ID, id: 'mochi' }, 'asset'], ['no id', { mod: ID }, 'op'], ['an id that is not text', { mod: ID, id: 5 }, 'op'],
    ['a mod that is not installed', { mod: OTHER, id: 'wave' }, 'asset'], ['a mod id that is not one', { mod: 'x', id: 'wave' }, 'op'],
  ]) assert.deepEqual(await ask(e, { op: 'sticker', ...m }), { ok: false, error }, why);
  for (const [why, files] of [
    ['a file that is not what its name says', { 'wave.webp': b64(Buffer.from('not a picture at all')) }],
    ['a file that is a video', { 'wave.webp': b64(fx('clip.webm')) }],
    ['a file that is not base64', { 'wave.webp': '!!!' }],
    ['a file that is not text', { 'wave.webp': 5 }],
    ['a picture over a sticker\'s size', { 'wave.webp': b64(webpOver()) }],
  ]) assert.deepEqual(await ask(env({ records: [rec(ID, { files: { ...rec().files, ...files } })] }), { op: 'sticker', mod: ID, id: 'wave' }), { ok: false, error: 'asset' }, why);
  assert.deepEqual(await ask(env({ records: [rec(ID, { enabled: false })] }), { op: 'sticker', mod: ID, id: 'wave' }), { ok: false, error: 'asset' }, 'a mod turned off');
  assert.deepEqual(await ask(env({ records: [rec(ID, { blocked: 'x' })] }), { op: 'sticker', mod: ID, id: 'wave' }), { ok: false, error: 'asset' }, 'a blocked mod');
  assert.deepEqual(await ask(env({ list: { authors: ['k-' + ID] } }), { op: 'sticker', mod: ID, id: 'wave' }), { ok: false, error: 'asset' }, 'a blocked author');
  assert.deepEqual(await ask(env({ site: null }), { op: 'sticker', mod: ID, id: 'wave' }), { ok: false, error: 'sender' });
});
// A WebP over a sticker's 512-pixel side.
function webpOver() {
  const u32 = (n) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255];
  const chunk = (id, data) => [...Buffer.from(id), ...u32(data.length), ...data, ...(data.length & 1 ? [0] : [])];
  const body = [...Buffer.from('WEBP'), ...chunk('VP8L', [0x2f, ...u32(1000 | (1000 << 14)), 0, 0, 0, 0])];
  return Uint8Array.from([...Buffer.from('RIFF'), ...u32(body.length), ...body]);
}

// ---- pets ----------------------------------------------------------------------------------------------------------------
// A sprite sheet stand-in: the decoder, the canvas and the encoder of the browser are stood in for, so `normalize` runs for real
// on a PNG header of the right size and a sheet with every frame cell occupied.
const sheet = (h = 2288) => { const b = new Uint8Array(24); b.set([137, 80, 78, 71]); new DataView(b.buffer).setUint32(16, 1536); new DataView(b.buffer).setUint32(20, h); return b; };
const withCanvas = async (fn) => {
  const keep = [globalThis.createImageBitmap, globalThis.OffscreenCanvas];
  globalThis.createImageBitmap = async () => ({ width: 1536, height: 2288, close() {} });
  globalThis.OffscreenCanvas = class {
    constructor(w, h) { this.w = w; this.h = h; }
    getContext() {
      const rgba = new Uint8ClampedArray(this.w * this.h * 4);
      for (let row = 0; row < 11; row++) for (let f = 0; f < PETS.COUNTS[row]; f++) rgba[((row * 208 + 10) * 1536 + f * 192 + 10) * 4 + 3] = 255;
      return { drawImage() {}, getImageData: () => ({ data: rgba }) };
    }
    async convertToBlob() { return new Blob([Uint8Array.of(82, 73, 70, 70, 1, 2, 3, 4)], { type: 'image/webp' }); }
  };
  try { return await fn(); } finally { [globalThis.createImageBitmap, globalThis.OffscreenCanvas] = keep; }
};
const petStore = (records = [rec(ID, { files: { ...rec().files, 'mochi.png': b64(sheet()) } })]) => {
  const data = { mods: records.map((r) => r.id) };
  for (const r of records) data[`mod:${r.id}`] = r;
  return { data, local: area(data) };
};
const UUID = /^own:[a-f0-9-]{36}$/;

test('pets: the library lists the pets mods carry, and adds one through the same checks as an import, once', async () => {
  const s = petStore([rec(ID, { files: { ...rec().files, 'mochi.png': b64(sheet()) } }), rec(OTHER, { blocked: 'bad', files: { ...rec().files, 'mochi.png': b64(sheet()) } })]);
  assert.deepEqual((await PETS.change({ op: 'mods' }, s)).pets, [{ mod: ID, modName: 'Garden', pet: 'mochi', name: 'Mochi 2', added: false }], 'a blocked mod brings nothing');
  await withCanvas(async () => {
    const r = await PETS.change({ op: 'fromMod', mod: ID, pet: 'mochi' }, s);
    assert.equal(r.ok, true);
    assert.match(r.id, UUID);
    const kept = s.data[PETS.KEY][r.id];
    assert.deepEqual([kept.name, kept.spriteVersionNumber, kept.from], ['Mochi 2', 2, `${ID}/mochi`]);
    assert.match(kept.data, /^data:image\/webp;base64,/, 're-encoded, not the mod\'s own file');
    assert.deepEqual(PETS.clean(s.data[PETS.KEY])[r.id].frameCounts, PETS.COUNTS);
    assert.deepEqual((await PETS.change({ op: 'mods' }, s)).pets.map((p) => p.added), [true]);
    assert.deepEqual(await PETS.change({ op: 'fromMod', mod: ID, pet: 'mochi' }, s), { ok: false, error: 'added' }, 'not twice');
    assert.equal((await PETS.change({ op: 'list' }, s)).pets.some((p) => p.id === r.id && p.name === 'Mochi 2'), true);
  });
});

test('pets: only a pet a mod declares, from a mod that is installed and not blocked, with a sheet that checks out', async () => {
  const s = petStore();
  await withCanvas(async () => {
    for (const m of [{ mod: ID, pet: 'nope' }, { mod: OTHER, pet: 'mochi' }, { mod: 'x', pet: 'mochi' }, { mod: ID }, { pet: 'mochi' }, { mod: ID, pet: 5 }, { mod: {}, pet: 'mochi' }, { mod: '__proto__', pet: 'mochi' }]) {
      assert.deepEqual(await PETS.change({ op: 'fromMod', ...m }, s), { ok: false, error: 'bad' }, JSON.stringify(m));
    }
    assert.equal(s.data[PETS.KEY], undefined, 'nothing was written');
    const blocked = petStore([rec(ID, { blocked: 'bad', files: { ...rec().files, 'mochi.png': b64(sheet()) } })]);
    assert.deepEqual(await PETS.change({ op: 'fromMod', mod: ID, pet: 'mochi' }, blocked), { ok: false, error: 'bad' });
    const notBase64 = petStore([rec(ID, { files: { ...rec().files, 'mochi.png': '!!' } })]);
    assert.deepEqual(await PETS.change({ op: 'fromMod', mod: ID, pet: 'mochi' }, notBase64), { ok: false, error: 'bad' });
    // A sheet that is not the pets' layout is the import's own refusal.
    const wrong = petStore([rec(ID, { files: { ...rec().files, 'mochi.png': b64(sheet(1000)) } })]);
    await assert.rejects(PETS.change({ op: 'fromMod', mod: ID, pet: 'mochi' }, wrong), /layout/);
    const html = petStore([rec(ID, { files: { ...rec().files, 'mochi.png': b64(Buffer.from('<svg onload=alert(1)>')) } })]);
    await assert.rejects(PETS.change({ op: 'fromMod', mod: ID, pet: 'mochi' }, html));
    assert.equal(wrong.data[PETS.KEY], undefined);
    // The library holds eight.
    const full = petStore();
    full.data[PETS.KEY] = Object.fromEntries(Array.from({ length: PETS.MAX_PETS }, (_, i) => [`own:00000000-0000-0000-0000-00000000000${i}`, { name: 'p', spriteVersionNumber: 2, data: 'data:image/webp;base64,AAAA' }]));
    assert.deepEqual(await PETS.change({ op: 'fromMod', mod: ID, pet: 'mochi' }, full), { ok: false, error: 'full' });
  });
});

test('pets: a mod\'s pets are asked for by the editor only', () => {
  const source = fs.readFileSync(path.join(root, 'lib/background.js'), 'utf8');
  const setup = source.slice(source.indexOf('const fromEditor'), source.indexOf('// The notes app'));
  const chrome = { runtime: { id: 'glaze', getURL: (p) => `chrome-extension://glaze/${p}`, getManifest: () => ({ host_permissions: ['<all_urls>'] }) },
    storage: { local: { get: async () => ({ ultra: ['https://school.test'] }) }, sync: { get: async () => ({ enhance: { pet: true } }) } } };
  const allow = vm.runInNewContext(`${setup} BROKER.petSprites.allow`, { chrome, URL, GZ_PET: require('../lib/pet.js'), GZ_SANITIZE: require('../defaults.js').GZ_SANITIZE });
  const site = { id: 'glaze', tab: {}, frameId: 0, url: 'https://school.test/ultra/courses' }, key = 'pet:https://school.test/_3_1';
  return Promise.all([allow({ op: 'mods', key }, site), allow({ op: 'fromMod', key }, site)]).then(([a, b]) => assert.deepEqual([a, b], [false, false]));
});

// ---- the page ------------------------------------------------------------------------------------------------------------
class El {
  constructor(tag) { Object.assign(this, { tagName: tag.toUpperCase(), children: [], attrs: {}, parent: null, style: {}, id: '', className: '', hidden: false }); }
  get offsetWidth() { return this.className === 'gz-stk-lottie' ? parseFloat(this.style.width) || parseFloat(this.parent?.style.width) || 120 : 0; }
  get offsetHeight() { return this.offsetWidth * 0.6; }
  get classList() { const el = this; return { toggle: (c, on) => { el[`class:${c}`] = on; }, contains: (c) => !!el[`class:${c}`] }; }
  get isConnected() { let e = this; while (e.parent) e = e.parent; return e.tagName === 'HTML'; }
  append(...kids) { for (const k of kids) if (k instanceof El) { k.remove(); k.parent = this; this.children.push(k); } }
  replaceChildren(...kids) { for (const c of this.children) c.parent = null; this.children = []; this.append(...kids); }
  replaceWith(...kids) { const p = this.parent, i = p.children.indexOf(this); this.remove(); for (const k of kids) { k.remove(); k.parent = p; } p.children.splice(i, 0, ...kids); }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this); this.parent = null; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  toggleAttribute(k, on) { if (on) this.attrs[k] = ''; else delete this.attrs[k]; }
  hasAttribute(k) { return k in this.attrs; }
  getAttribute(k) { return this.attrs[k] ?? null; }
  removeAttribute(k) { delete this.attrs[k]; }
  addEventListener(type, f) { ((this.on ||= {})[type] ||= []).push(f); }
  click() { for (const f of this.on?.click || []) f({ type: 'click', target: this, preventDefault() {}, stopPropagation() {} }); }
  getContext() { return { drawImage: (...a) => { this.drawn = (this.drawn || 0) + 1; this.drew = a; } }; }
  focus() {}
  getBoundingClientRect() { return { left: 0, top: 0, width: 1000, height: 0 }; }
  all() { return this.children.flatMap((c) => [c, ...c.all()]); }
  find(id) { return this.id === id ? this : this.children.map((c) => c.find(id)).find(Boolean) || null; }
  get textContent() { return this._text ?? this.children.map((c) => c.textContent).join(''); }
  set textContent(v) { this._text = String(v); this.children = []; }
}
const KEY = `stk:${SITE}/courses/1`;
const placed = (id, s) => ({ id, s, x: 50, y: 100, w: 120, r: 0 });
const mod = (sid) => `mod:${ID}/${sid}`;
const FILES_REPLY = {
  wave: { ok: true, kind: 'image', mime: 'image/webp', animated: true, b64: b64(fx('anim.webp')) },
  still: { ok: true, kind: 'image', mime: 'image/webp', animated: false, b64: b64(fx('still.webp')) },
  spark: { ok: true, kind: 'lottie', canvases: 1, json: { v: '5.7.0', w: 200, h: 120, fr: 30, ip: 0, op: 60, layers: [] } },
};
const page = ({ local = {}, motion = 'subtle', packs, replies = FILES_REPLY, deferSticker } = {}) => {
  const html = new El('html'), head = new El('head'), body = new El('body');
  html.append(head, body);
  html.style.setProperty = (k, v) => { html.style[k] = v; };
  html.style.removeProperty = () => {};
  const log = { sent: [], blobs: [], revoked: [], anims: [], bitmaps: 0 }, docListeners = {}, storageListeners = [];
  let b = 0, motionLevel = motion, packList = packs ?? [{ mod: ID, name: 'Garden', stickers: [{ id: 'wave', name: 'Waving' }, { id: 'still', name: 'Still' }, { id: 'spark', name: 'Spark' }], pets: [] }];
  const settings = { extras: { cursor: 'off', stickers: true, rotate: 'off', at: '08:00' } };
  html.getAttribute = (k) => (k === 'data-gz-motion' ? motionLevel : html.attrs[k] ?? null);
  const send = (m, cb) => {
    log.sent.push(structuredClone(m));
    const r = m.type === 'glaze:modpage' && m.op === 'packs' ? { ok: true, packs: packList } : m.type === 'glaze:modpage' && m.op === 'sticker' ? (replies[m.id] || { ok: false, error: 'asset' }) : { ok: true };
    if (m.op === 'sticker' && deferSticker?.(m, () => cb?.(structuredClone(r)))) return;
    setTimeout(() => cb?.(structuredClone(r)));
  };
  const lottie = { loadAnimation: (o) => { const calls = []; const a = { o, calls, isLoaded: true, play: () => calls.push('play'), pause: () => calls.push('pause'), goToAndStop: (...x) => calls.push(['goToAndStop', ...x]), destroy: () => calls.push('destroy'), setSubframe: () => {} }; log.anims.push(a); return a; } };
  const context = vm.createContext({
    console, Promise, Date, Map, Set, structuredClone, crypto: globalThis.crypto, Blob, atob, btoa, Uint8Array, JSON,
    URL: { createObjectURL: (blob) => { const u = `blob:x/${++b}`; log.blobs.push([u, blob.type, blob.size]); return u; }, revokeObjectURL: (u) => log.revoked.push(u) },
    createImageBitmap: async () => { log.bitmaps++; return { width: 48, height: 48, close() {} }; },
    setTimeout, clearTimeout, addEventListener() {}, innerWidth: 1000, innerHeight: 800, devicePixelRatio: 1,
    location: { origin: SITE, pathname: '/courses/1' },
    document: { documentElement: html, head, body, createElement: (t) => new El(t), getElementById: (id) => html.find(id), addEventListener: (t, f) => { (docListeners[t] ||= []).push(f); }, hidden: false },
    chrome: {
      runtime: { getURL: (f) => `chrome-extension://x/${f}`, sendMessage: send },
      storage: { onChanged: { addListener: (f) => storageListeners.push(f) }, sync: { set() {} },
        local: { get: (keys, cb) => setTimeout(() => cb(structuredClone(keys === null ? local : Object.fromEntries([].concat(keys).filter((k) => k in local).map((k) => [k, local[k]]))))) } },
    },
    importLottie: async () => { context.lottie = lottie; },
    GZ_MATCH_PRESET: () => null,
    GZ_CTX: { t: (k, v) => (v ? k.replace(/\{(\w+)\}/g, (_, n) => v[n]) : k), need: () => Promise.resolve(), settings: () => settings, on: () => true, solo: true },
  });
  context.window = context; context.top = context; context.globalThis = context;
  vm.runInContext(fs.readFileSync(path.join(root, 'lib/lookx.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(root, 'features/lookx.js'), 'utf8').replace("import(chrome.runtime.getURL('lib/lottie/lottie_light_canvas.min.js'))", 'importLottie()'), context);
  const layer = () => body.find('gz-stickers');
  const settle = () => new Promise((r) => setTimeout(r, 25));
  return { lx: context.GZ_LOOKX, html, body, log, layer, settle, settings,
    motion: (m) => { motionLevel = m; }, hide: (hidden) => { context.document.hidden = hidden; for (const f of docListeners.visibilitychange || []) f(); },
    packs: (p) => { packList = p; }, changed: (c) => { for (const f of storageListeners) f(c, 'local'); } };
};
const arts = (p) => (p.layer()?.children || []).map((s) => s.children[0]);

test('page: a mod\'s sticker is asked for by name once, drawn from a blob the worker\'s cleaned copy makes, and freed with the page', async () => {
  const p = page({ local: { [KEY]: [placed('a', mod('still')), placed('b', mod('still'))] } });
  await p.lx.sync(); await p.settle();
  assert.deepEqual(p.log.sent.map((m) => [m.type, m.op, m.mod, m.id]), [['glaze:modpage', 'packs', undefined, undefined], ['glaze:modpage', 'sticker', ID, 'still']], 'one ask however many are placed');
  const [a, b] = arts(p);
  assert.deepEqual([a.tagName, a.src, b.src, a.alt], ['IMG', 'blob:x/1', 'blob:x/1', '']);
  assert.deepEqual(plain(p.log.blobs), [['blob:x/1', 'image/webp', fx('still.webp').length]]);
  assert.equal(p.layer().attrs['aria-hidden'], '', 'decoration, out of a screen reader\'s way');
});

test('page: an animated picture moves with motion on, and is its first frame in a canvas with motion off', async () => {
  const local = { [KEY]: [placed('a', mod('wave'))] };
  const on = page({ local });
  await on.lx.sync(); await on.settle();
  assert.equal(arts(on)[0].tagName, 'IMG');
  assert.equal(on.log.bitmaps, 0, 'nothing is decoded for a picture that moves by itself');
  const off = page({ local, motion: 'off' });
  await off.lx.sync(); await off.settle();
  const c = arts(off)[0];
  assert.deepEqual([c.tagName, c.drawn, c.width, c.height], ['CANVAS', 1, 48, 48], 'frame one, drawn from the bytes');
  assert.equal(off.log.bitmaps, 1);
  // Motion switched on under an open page: redrawn as the moving picture.
  off.motion('subtle');
  await off.lx.sync(); await off.settle();
  assert.equal(arts(off)[0].tagName, 'IMG');
  // A picture that does not move is an img whatever the motion level.
  const still = page({ local: { [KEY]: [placed('a', mod('still'))] }, motion: 'off' });
  await still.lx.sync(); await still.settle();
  assert.equal(arts(still)[0].tagName, 'IMG');
  assert.equal(still.log.bitmaps, 0);
});

test('page: a Lottie sticker loads the player on demand, plays, holds frame 0 with motion off, pauses hidden, and is destroyed on a redraw', async () => {
  const local = { [KEY]: [placed('a', mod('spark')), placed('b', mod('spark'))] };
  const p = page({ local });
  await p.lx.sync(); await p.settle();
  assert.equal(p.log.anims.length, 2);
  const [one] = p.log.anims;
  assert.deepEqual(plain([one.o.renderer, one.o.loop, one.o.autoplay, one.o.animationData.w]), ['canvas', true, false, 200]);
  assert.equal(one.o.animationData === FILES_REPLY.spark.json, false, 'the player gets its own copy');
  assert.deepEqual(plain(one.o.rendererSettings), { preserveAspectRatio: 'xMidYMid meet', clearCanvas: true, dpr: 1 });
  assert.equal(one.o.container.style.aspectRatio, '200 / 120');
  assert.deepEqual(plain(one.calls), ['play']);
  p.hide(true);
  assert.deepEqual(plain(p.log.anims.map((a) => a.calls.at(-1))), ['pause', 'pause']);
  p.hide(false);
  assert.deepEqual(plain(p.log.anims.map((a) => a.calls.at(-1))), ['play', 'play']);
  // A redraw ends the old players before it makes new ones.
  await p.lx.sync(); await p.settle();
  assert.deepEqual(plain(p.log.anims.slice(0, 2).map((a) => a.calls.at(-1))), ['destroy', 'destroy']);
  assert.equal(p.log.anims.length, 4);
  // Motion off: frame 0, and hiding and showing leaves it there.
  const off = page({ local, motion: 'off' });
  await off.lx.sync(); await off.settle();
  assert.deepEqual(plain(off.log.anims[0].calls), [['goToAndStop', 0, true]]);
  off.hide(true); off.hide(false);
  assert.equal(off.log.anims[0].calls.includes('play'), false, 'hiding and showing never plays it');
  assert.deepEqual(plain(off.log.anims[0].calls[0]), ['goToAndStop', 0, true]);
});

test('page: a sticker whose mod is gone draws nothing (a hidden box, a dashed one in sticker mode) and a mod change asks again', async () => {
  const p = page({ local: { [KEY]: [placed('a', mod('missing')), placed('b', mod('still'))] } });
  await p.lx.sync(); await p.settle();
  const [gone, fine] = arts(p);
  assert.deepEqual([gone.tagName, gone.className, fine.tagName], ['SPAN', 'gz-stk-gone', 'IMG']);
  assert.equal(p.layer().children.length, 2, 'the placements stay, so it comes back with the mod');
  const asked = p.log.sent.length;
  p.changed({ [`mod:${ID}`]: { newValue: {} } });
  await p.settle();
  assert.ok(p.log.sent.length > asked, 'a mod record changed: asked again');
  assert.deepEqual(plain(p.log.revoked), ['blob:x/1'], 'the old blob is let go once the new one is drawn');
  p.changed({ somethingElse: {} });
  const n = p.log.sent.length;
  await p.settle();
  assert.equal(p.log.sent.length, n, 'other changes ask nothing');
});

test('page: turning dev mode off invalidates cached mod stickers and packs', async () => {
  const replies = { ...FILES_REPLY };
  const p = page({ local: { [KEY]: [placed('a', mod('still'))] }, replies });
  await p.lx.sync(); await p.settle();
  assert.equal(arts(p)[0].tagName, 'IMG');
  replies.still = { ok: false, error: 'asset' };
  p.packs([]);
  p.changed({ modDev: { oldValue: true, newValue: false } });
  await p.settle();
  assert.equal(arts(p)[0].className, 'gz-stk-gone');
  assert.deepEqual(plain(p.log.revoked), ['blob:x/1']);
  await p.lx.edit(); await p.settle();
  const select = p.body.find('gz-stk-panel').children.find((e) => e.tagName === 'SELECT');
  assert.equal(select.children.some((e) => e.value === `mod:${ID}`), false);
});

test('page: a late sticker response cannot restore art after its mod is disabled', async () => {
  const replies = { ...FILES_REPLY };
  let late, holding = true;
  const p = page({ local: { [KEY]: [placed('a', mod('still'))] }, replies,
    deferSticker: (_, reply) => { if (!holding) return false; late = reply; return true; } });
  await p.lx.sync(); await p.settle();
  assert.equal(typeof late, 'function');
  holding = false;
  replies.still = { ok: false, error: 'asset' };
  p.packs([]);
  p.changed({ [`mod:${ID}`]: { newValue: { enabled: false } } });
  await p.settle();
  late();
  await p.settle();
  assert.equal(arts(p)[0].className, 'gz-stk-gone');
  assert.deepEqual(p.log.blobs, [], 'discarded responses create no object URLs');
});

test('page: sticker mode offers a mod\'s pack, lists its stickers, and places one as a placement the worker keeps', async () => {
  const p = page({ local: {} });
  await p.lx.sync();
  await p.lx.edit(); await p.settle();
  const panel = p.body.find('gz-stk-panel');
  const select = panel.all().find((e) => e.tagName === 'SELECT');
  const options = select.children.map((o) => [o.value, o.textContent]);
  assert.deepEqual(options.at(-1), [`mod:${ID}`, 'Garden']);
  select.value = `mod:${ID}`;
  for (const f of select.on.change) f({});
  await p.settle();
  const grid = panel.all().find((e) => e.className === 'gz-stk-grid');
  assert.equal(grid.children.length, 3, 'the three stickers, each in a button');
  const [wave, , spark] = grid.children;
  assert.equal(wave.title, 'Waving');
  assert.equal(wave.children[0].tagName, 'IMG', 'a picture shows as itself');
  assert.equal(spark.children[0].textContent, 'Spark', 'a Lottie animation shows by name');
  wave.click();
  await p.settle();
  const add = p.log.sent.find((m) => m.type === 'glaze:stickers' && m.op === 'add');
  assert.equal(add.p.s, mod('wave'));
  assert.deepEqual(p.log.sent.filter((m) => m.op === 'sticker').map((m) => m.id).sort(), ['spark', 'still', 'wave'], 'each read once');
  // The worker's own cleaner takes it, and a made-up one is not.
  assert.ok(L.placement({ id: 'a', s: mod('wave'), x: 1, y: 1, w: 100, r: 0 }));
  for (const s of [`mod:${ID.toUpperCase()}/wave`, `mod:short/wave`, `mod:${ID}/Wave`, `mod:${ID}/`, `mod:${ID}wave`, `mod:${ID}/../x`, `mod:${ID}/a b`]) assert.equal(L.placement({ id: 'a', s, x: 1, y: 1, w: 100, r: 0 }), null, s);
});

test('the manifest reference documents packs and a complete entry that the importer accepts', () => {
  const doc = fs.readFileSync(path.join(root, 'docs/mods-api.md'), 'utf8');
  const section = doc.match(/### `packs`\n([\s\S]*?)(?=\n### )/);
  assert.ok(section, 'packs belongs in the manifest reference');
  const example = JSON.parse(section[1].match(/```json\n([\s\S]*?)\n```/)[1]);
  assert.deepEqual(M.packs(example.packs), example.packs);
  assert.match(section[1], /24 stickers/);
  assert.match(section[1], /4 pets/);
  assert.match(section[1], /Firefox/);
});

test('page: Lottie stickers require checked canvas metadata and bound matte pixels before setup', async () => {
  for (const canvases of [undefined, 0, -1, 1.5, Infinity, '1', 501]) {
    const p = page({ local: { [KEY]: [{ ...placed('a', mod('spark')), w: 480 }] },
      replies: { spark: { ...FILES_REPLY.spark, canvases } } });
    await p.lx.sync(); await p.settle();
    assert.equal(p.log.anims.length, 0, String(canvases));
    assert.equal(arts(p)[0].className, 'gz-stk-gone');
  }
});

test('page: Lottie sticker canvas pixels are bounded across all players on the page', async () => {
  const p = page({ local: { [KEY]: Array.from({ length: 100 }, (_, i) => placed(`s${i}`, mod('spark'))) },
    replies: { spark: { ...FILES_REPLY.spark, canvases: 101 } } });
  await p.lx.sync(); await p.settle();
  assert.equal(p.log.anims.length, Math.floor(6.4e7 / (120 * 72 * 101)));
  await p.lx.sync(); await p.settle();
  assert.equal(p.log.anims.length, 2 * Math.floor(6.4e7 / (120 * 72 * 101)), 'redraw releases the previous players budget');
});
