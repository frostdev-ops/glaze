const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const F = require(process.env.GZ_B9_LIB || '../lib/folders.js');
const T = require('../lib/todo.js');
const C = require('../lib/cards.js');
const D = require('../defaults.js');
const key = F.key('https://bb.example.edu', '_7_1', '_8_1');
const storage = () => {
  const store = {};
  return { store, local: { get: async (keys) => keys === null ? structuredClone(store) : Object.fromEntries(keys.map((k) => [k, structuredClone(store[k])])), set: async (p) => { Object.assign(store, structuredClone(p)); return true; }, remove: async (keys) => { for (const k of keys) delete store[k]; return true; } } };
};
test('folder keys require a known Ultra account and isolate site, account and course', () => {
  assert.ok(F.KEY.test(key));
  for (const uid of ['', 'anon', undefined, '_1_1/../_2_1']) assert.equal(F.key('https://bb.example.edu', uid, '_8_1'), '');
  for (const o of ['http://bb.example.edu', 'https://bb.example.edu/a', 'https://user@bb.example.edu']) assert.equal(F.key(o, '_7_1', '_8_1'), '');
  assert.notEqual(key, F.key('https://other.edu', '_7_1', '_8_1'));
  assert.notEqual(key, F.key('https://bb.example.edu', '_9_1', '_8_1'));
  assert.notEqual(key, F.key('https://bb.example.edu', '_7_1', '_9_1'));
});
test('single-folder operations retain nested hidden IDs and concurrent tabs do not overwrite snapshots', async () => {
  const a = storage(), turn = C.queue();
  await Promise.all(['_1_1', '_2_1'].map((id) => turn(() => F.change({ key, id, hidden: true }, a))));
  assert.deepEqual(a.store[key], { ids: ['_1_1', '_2_1'], show: false });
  await F.change({ key, show: true }, a);
  await F.change({ key, id: '_1_1', hidden: false }, a);
  assert.deepEqual(a.store[key], { ids: ['_2_1'], show: true });
  await F.change({ key, id: '_2_1', hidden: false }, a);
  assert.deepEqual(a.store[key], { ids: [], show: true });
});
test('invalid operations, caps and storage failures preserve the existing records', async () => {
  const a = storage();
  a.store[key] = { ids: Array.from({ length: F.MAX_IDS }, (_, i) => `_${i}_1`), show: false };
  const before = structuredClone(a.store);
  assert.equal((await F.change({ key, id: '_9000_1', hidden: true }, a)).error, 'cap');
  assert.equal((await F.change({ key, id: 'bad', hidden: true }, a)).error, 'bad');
  assert.equal((await F.change({ key, show: 'true' }, a)).error, 'bad');
  assert.deepEqual(a.store, before);
  a.local.set = async () => false;
  assert.equal((await F.change({ key, id: '_0_1', hidden: false }, a)).error, 'write');
  assert.deepEqual(a.store, before);
  a.local.get = async () => { throw Error('unavailable'); };
  await assert.rejects(F.change({ key, show: true }, a), /unavailable/);
});
test('global course cap and backup validation bound imported device data', async () => {
  const a = storage();
  for (let i = 0; i < F.MAX_KEYS; i++) a.store[F.key('https://bb.example.edu', '_7_1', `_${i}_1`)] = { ids: [], show: false };
  assert.equal((await F.change({ key: F.key('https://bb.example.edu', '_7_1', '_900_1'), show: true }, a)).error, 'cap');
  const raw = { ...a.store, bad: { ids: ['_1_1'] }, [key]: { ids: ['_1_1', '_1_1', 'bad'], show: 'yes' } };
  const cleaned = F.backup(raw);
  assert.equal(Object.keys(cleaned).length, F.MAX_KEYS - 1);
  assert.equal(cleaned.bad, undefined);
  assert.deepEqual(F.clean(raw[key]), { ids: ['_1_1'], show: false });
});
test('backup restore rolls folder data back with settings when sync fails', async () => {
  const a = storage(); a.store[key] = { ids: ['_1_1'], show: false };
  const data = F.backup({ [key]: { ids: ['_2_1'], show: true } });
  assert.deepEqual(await T.restore(data, {}, a.local, { set: async () => false }), { ok: false });
  assert.deepEqual(a.store[key], { ids: ['_1_1'], show: false });
  assert.deepEqual(await T.restore(data, {}, a.local, { set: async () => true }), { ok: true });
  assert.deepEqual(a.store[key], data[key]);
});
test('backup import enforces the cap against other accounts already stored', async () => {
  const a = storage();
  for (let i = 0; i < F.MAX_KEYS; i++) a.store[F.key('https://bb.example.edu', '_7_1', `_${i}_1`)] = { ids: [], show: false };
  const before = structuredClone(a.store);
  const folders = { [F.key('https://other.edu', '_9_1', '_900_1')]: { ids: ['_1_1'], show: true } };
  assert.equal((await F.restore({ folders, settings: {} }, { local: a.local, sync: { set: async () => true } }, T)).error, 'cap');
  assert.deepEqual(a.store, before);
  assert.equal((await F.restore({ folders, settings: null }, { local: a.local }, T)).error, 'bad');
});
test('B9 is default-on, on-demand and has no request or page-storage path', () => {
  assert.equal(D.GZ_SANITIZE({}).enhance.hideFolders, true);
  assert.equal(D.GZ_SANITIZE({ enhance: { hideFolders: false } }).enhance.hideFolders, false);
  const source = fs.readFileSync(require.resolve('../features/folders.js'), 'utf8');
  assert.doesNotMatch(source, /\b(?:fetch|XMLHttpRequest|sessionStorage|localStorage|profile|myCourses)\s*[.(]/);
  const core = fs.readFileSync(require.resolve('../content-ultra.js'), 'utf8');
  assert.match(core, /GZ_FOLDER_UI\.sync\(!!top\(\)\?\.hideFolders, meId\)/);
  assert.doesNotMatch(fs.readFileSync(require.resolve('../content.js'), 'utf8'), /GZ_FOLDER|hideFolders/);
});
test('the byte cap bounds both imported records and new single-folder writes', async () => {
  const a = storage(), raw = {};
  const ids = Array.from({ length: F.MAX_IDS }, (_, i) => `_${String(i).padStart(18, '0')}_123456789012345678`);
  for (let i = 0; i < 30; i++) raw[F.key('https://bb.example.edu', '_7_1', `_${i}_1`)] = { ids, show: false };
  const imported = F.backup(raw);
  assert.ok(Object.keys(imported).length < 30);
  assert.ok(new TextEncoder().encode(JSON.stringify(imported)).length <= F.MAX_BYTES);
  Object.assign(a.store, imported);
  const next = F.key('https://bb.example.edu', '_7_1', '_99_1');
  const before = structuredClone(a.store);
  // Existing records already consume nearly the whole allowance; one equally sized record cannot fit.
  a.store[next] = { ids, show: false };
  assert.equal((await F.change({ key: next, show: true }, a)).error, 'cap');
  assert.deepEqual(a.store[next], { ids, show: false });
  for (const k of Object.keys(before)) assert.deepEqual(a.store[k], before[k]);
});
test('folder operations reject coerced IDs and keys before touching storage', async () => {
  const a = storage();
  for (const id of [['_1_1'], { toString: () => '_1_1' }]) {
    assert.equal((await F.change({ key, id, hidden: true }, a)).error, 'bad');
  }
  assert.equal((await F.change({ key: [key], show: true }, a)).error, 'bad');
  assert.deepEqual(a.store, {});
  assert.equal(F.key('https://bb.example.edu', ['_7_1'], '_8_1'), '');
});
test('malformed backup records cannot clear existing folder choices', async () => {
  for (const record of [{}, { ids: '_1_1', show: true }, { ids: ['_2_1'], show: 'yes' }, { ids: [['_2_1']], show: true }, { ids: Array(F.MAX_IDS + 1).fill('_2_1'), show: true }]) {
    const a = storage(); a.store[key] = { ids: ['_1_1'], show: true };
    assert.equal((await F.restore({ folders: { [key]: record }, settings: {} }, { local: a.local, sync: { set: async () => true } }, T)).ok, true);
    assert.deepEqual(a.store[key], { ids: ['_1_1'], show: true });
  }
});
