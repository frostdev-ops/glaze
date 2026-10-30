const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const K = require(path.join(process.env.GZ_B6_REPO || path.join(__dirname, '..'), 'lib/cards.js'));
const U = 'ultra:https://bb.school.edu/_25_1', C = 'canvas:https://school.instructure.com/7';
const saveUltra = (op, area) => (K.ultraChange || K.change)(op, area);
const image = 'data:image/png;base64,AAAA';
const storage = () => {
  const store = { sync: { cards: { [C]: { k: 'solid', c: '#112233' } }, links: { [C]: [{ u: '/courses/7', n: 'Canvas', i: 'book' }] } }, local: {} };
  const area = Object.fromEntries(['sync', 'local'].map((n) => [n, {
    get: async (keys) => structuredClone(keys === null ? store[n] : Object.fromEntries(keys.filter((k) => k in store[n]).map((k) => [k, store[n][k]]))),
    set: async (patch) => { Object.assign(store[n], structuredClone(patch)); return true; },
    remove: async (keys) => { for (const k of keys) delete store[n][k]; return true; },
  }]));
  return { store, area };
};
// A pre-B6 client reads/writes only its known items and garbage-collects only cardImg: local keys.
const legacyWrite = async ({ store, area }) => {
  const r = await area.sync.get(['cards', 'links']);
  for (const k of ['cards', 'links']) r[k] = Object.fromEntries(Object.entries(r[k] || {}).filter(([id]) => id === '*' || id.startsWith('canvas:')));
  await area.sync.set(r);
  const used = new Set(Object.values(r.cards).map((s) => s.i));
  await area.local.remove(Object.keys(store.local).filter((k) => k.startsWith('cardImg:') && !used.has(k.slice(8))));
};

test('Ultra styles and bookmarks survive an older client saving Canvas settings', async () => {
  const e = storage(), before = structuredClone(e.store.sync);
  assert.equal((await saveUltra({ key: U, style: { k: 'solid', c: '#ff0000' }, links: [{ u: '/ultra/course', i: 'book' }] }, e.area)).ok, true);
  assert.deepEqual(e.store.sync.cards, before.cards);
  assert.deepEqual(e.store.sync.links, before.links);
  await legacyWrite(e);
  assert.equal(e.store.sync.ucards[U].c, '#ff0000');
  assert.equal(e.store.sync.ulinks[U][0].u, '/ultra/course');
});

test('Ultra pictures survive old and new Canvas orphan cleanup, then only Ultra deletes its own', async () => {
  const e = storage();
  const r = await saveUltra({ key: U, style: { k: 'image' }, image }, e.area);
  assert.equal(r.ok, true);
  const p = `ultraCardImg:${r.id}`;
  assert.equal(e.store.local[p], image);
  await legacyWrite(e); assert.equal(e.store.local[p], image);
  await K.change({ key: C, style: null }, e.area); assert.equal(e.store.local[p], image);
  await saveUltra({ key: U, style: null }, e.area); assert.equal(e.store.local[p], undefined);
});

test('the picture cap counts both namespaces and a failed Ultra save leaves existing pictures alone', async () => {
  const e = storage(); e.store.local['cardImg:aaaaaaaaaaaa'] = 'A'.repeat(K.IMG_TOTAL - image.length + 1);
  assert.deepEqual(await saveUltra({ key: U, style: { k: 'image' }, image }, e.area), { ok: false, error: 'cap' });
  e.store.local = {}; e.area.sync.set = async () => false;
  assert.equal((await saveUltra({ key: U, style: { k: 'image' }, image }, e.area)).ok, false);
  assert.deepEqual(Object.keys(e.store.local), []);
});

test('Ultra import and reset keep Canvas and navigation data, and Canvas respects Ultra picture capacity', async () => {
  const e = storage(), before = structuredClone(e.store.sync);
  await saveUltra({ replace: { cards: { [U]: { k: 'gradient', c: '#112233', d: '#334455' } }, links: { [U]: [{ u: '/ultra/course' }] } } }, e.area);
  assert.equal(e.store.sync.ucards[U].k, 'gradient');
  await saveUltra({ reset: true }, e.area);
  assert.deepEqual(e.store.sync, before);
  e.store.local['ultraCardImg:aaaaaaaaaaaa'] = 'A'.repeat(K.IMG_TOTAL - image.length + 1);
  assert.deepEqual(await K.change({ key: C, style: { k: 'image' }, image }, e.area), { ok: false, error: 'cap' });
});
