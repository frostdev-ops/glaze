// ai/local/store.js's side of background model updates (docs/ai-harness.md "Model updates"): the state file beside the
// models (glaze-models/~updates.json) composed over the shipped catalog, a newer version of a model kept beside the one in
// use, its download (Range resume, per-chunk and whole-file hashes, quota, a pause between chunks), dropping a version, and
// a remove forgetting what the state said about that model.
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../../extension/ai/local/store.js');
const { fakeFs, fakeHf, fakeLocks, fakeBus, entry, bytes } = require('../helpers/model-store-fakes.cjs');

const OLD = bytes(4 * 1024 + 300, 7), NEW = bytes(4 * 1024 + 500, 9);
const old = entry(OLD, { version: 'r5', tools: 3 });
const fresh = entry(NEW, { commit: 'b'.repeat(40), version: 'r6', tools: 3, minGlaze: '4.0.1' });
const big = entry(bytes(2048, 3), { id: 'rime-q8', file: 'Rime-Q8.gguf', tier: 4, version: 'r5', tools: 3 });
const files = { [old.url]: OLD, [fresh.url]: NEW, [big.url]: bytes(2048, 3) };
const settle = () => new Promise((r) => setTimeout(r, 5));

const make = (opts = {}) => {
  const fs = opts.fs || fakeFs(opts);
  const fetch = opts.fetch || fakeHf(files, opts);
  const locks = opts.locks || fakeLocks(), channel = 'channel' in opts ? opts.channel : fakeBus();
  const store = S.create({ models: opts.models || [old, big], fetch, root: async () => fs.root, estimate: fs.estimate, locks, channel });
  return { store, fs, fetch, locks, channel };
};
const twin = (m) => S.create({ models: [old, big], fetch: m.fetch, root: async () => m.fs.root, estimate: m.fs.estimate, locks: m.locks, channel: m.channel });
const tags = (fs, id) => [...fs.root.kids.get('glaze-models').kids.get(id).kids.keys()].sort();

test('without a state file the catalog is the shipped one; list says each model\'s version', async () => {
  const { store } = make();
  const c = await store.catalog();
  assert.equal(c.state, null);
  assert.equal(c.entries.get('rime-q4').total, old.total);
  assert.equal(c.latest.get('rime-q4').total, old.total);
  assert.deepEqual([...c.spares.keys()], []);
  const list = await store.list();
  assert.deepEqual(list.map((m) => [m.id, m.version, m.state]), [['rime-q4', 'r5', 'missing'], ['rime-q8', 'r5', 'missing']]);
});

test('compose: a list\'s newer version of a model replaces it unless pinned; a pin holds, keep holds spares, failed ones are skipped', () => {
  const none = S.compose([old, big], { v: 1, serial: 2, models: [fresh] });
  assert.equal(none.entries.get('rime-q4').total, fresh.total, 'nothing downloaded pinned it: the newest is offered');
  assert.equal(none.latest.get('rime-q4').total, fresh.total);
  const pinned = S.compose([old, big], { v: 1, serial: 2, models: [fresh], pins: { 'rime-q4': old }, keep: { 'rime-q4': [fresh] } });
  assert.equal(pinned.entries.get('rime-q4').total, old.total, 'the downloaded version stays in use until a swap');
  assert.equal(pinned.latest.get('rime-q4').total, fresh.total);
  assert.deepEqual(pinned.spares.get('rime-q4').map((m) => m.total), [fresh.total]);
  const failed = S.compose([old, big], { v: 1, serial: 2, models: [fresh], failed: { [fresh.total]: 2 } });
  assert.equal(failed.entries.get('rime-q4').total, old.total);
  assert.equal(failed.latest.get('rime-q4').total, old.total, 'a version that failed is never the target again');
});

test('compose: with no usable list entry for a model, it stays on its pinned version, never back to the shipped one', () => {
  const r7 = { ...fresh, commit: 'e'.repeat(40), total: 'e'.repeat(64), version: 'r7' };
  const c = S.compose([old, big], { v: 1, serial: 3, models: [r7], pins: { 'rime-q4': fresh }, failed: { [r7.total]: 3 } });
  assert.equal(c.entries.get('rime-q4').total, fresh.total);
  assert.equal(c.latest.get('rime-q4').total, fresh.total, 'r7 failed and r5 is older: nothing to do');
});

test('compose: a list entry taking a shipped model\'s tier under another id, or changing a shipped id\'s tier, is skipped; a new tier is added', () => {
  const thief = { ...fresh, id: 'rime-other' };
  const moved = { ...fresh, tier: 2 };
  const added = entry(bytes(1500, 5), { id: 'rime-q5', file: 'Rime-Q5.gguf', tier: 2, version: 'r6', tools: 3, minGlaze: '4.0.1' });
  const c = S.compose([old, big], { v: 1, serial: 3, models: [thief, moved, added] });
  assert.equal(c.entries.get('rime-q4').total, old.total);
  assert.equal(c.entries.has('rime-other'), false);
  assert.equal(c.entries.get('rime-q5').tier, 2);
  assert.deepEqual([...c.entries.keys()], ['rime-q4', 'rime-q8', 'rime-q5']);
});

test('edit writes the state under its lock and every store over the same OPFS reads it', async () => {
  const m = make();
  const other = twin(m);
  assert.equal((await other.catalog()).entries.get('rime-q4').total, old.total);
  const next = await m.store.edit((st) => ({ ...(st || { v: 1 }), serial: 4, models: [fresh] }));
  assert.equal(next.serial, 4);
  assert.ok(m.fs.root.kids.get('glaze-models').kids.has('~updates.json'));
  assert.equal((await m.store.catalog()).entries.get('rime-q4').total, fresh.total);
  await settle();
  assert.equal((await other.catalog()).entries.get('rime-q4').total, fresh.total, 'the other context heard the change');
  assert.equal((await other.catalog()).state.serial, 4);
});

test('a newer version downloads beside the one in use, which stays ready and is never deleted', async () => {
  const { store, fs } = make();
  assert.equal((await store.download('rime-q4')).state, 'ready');
  await store.edit(() => ({ v: 1, serial: 1, models: [fresh], pins: { 'rime-q4': old }, keep: { 'rime-q4': [fresh] } }));
  assert.deepEqual(await store.status('rime-q4', { total: fresh.total }), { state: 'missing' });
  assert.equal((await store.download('rime-q4', { total: fresh.total, whole: true })).state, 'ready');
  assert.deepEqual(await store.status('rime-q4'), { state: 'ready' });
  assert.deepEqual(await store.status('rime-q4', { total: fresh.total }), { state: 'ready' });
  assert.equal(tags(fs, 'rime-q4').length, 2);
  // The one in use, downloaded again (a Settings click), keeps the spare.
  assert.equal((await store.download('rime-q4')).state, 'ready');
  assert.equal(tags(fs, 'rime-q4').length, 2);
  const opened = await store.open('rime-q4');
  assert.deepEqual(Buffer.from(await opened.read(0, 16)), Buffer.from(OLD.subarray(0, 16)), 'open reads the version in use');
});

test('a version the catalog neither uses nor keeps is unknown to download', async () => {
  const { store } = make();
  await assert.rejects(store.download('rime-q4', { total: fresh.total }), (e) => e.reason === 'unknown');
});

test('a spare\'s download resumes after a restart from its verified chunks', async () => {
  const ctl = new AbortController();
  let n = 0;
  const m = make({ onChunk: (url) => { if (url === fresh.url && ++n === 3) ctl.abort(); } });
  await m.store.download('rime-q4');
  await m.store.edit(() => ({ v: 1, serial: 1, models: [fresh], pins: { 'rime-q4': old }, keep: { 'rime-q4': [fresh] } }));
  await assert.rejects(m.store.download('rime-q4', { total: fresh.total, signal: ctl.signal }), (e) => e.reason === 'aborted');
  await settle(); // a chunk that had arrived when the cancel came is kept
  const { state, bytes: kept } = await m.store.status('rime-q4', { total: fresh.total });
  assert.equal(state, 'partial');
  assert.ok(kept >= 2 * 1024 && kept % 1024 === 0);
  const before = m.fetch.log.length;
  const again = twin(m); // the browser restarted
  assert.equal((await again.download('rime-q4', { total: fresh.total, whole: true })).state, 'ready');
  assert.deepEqual(m.fetch.log.slice(before).map((l) => l.range[0] / 1024), [2, 3, 4].filter((i) => i >= kept / 1024), 'only the chunks it lacked');
});

test('pause is awaited before every chunk', async () => {
  const { store } = make();
  await store.download('rime-q4');
  await store.edit(() => ({ v: 1, serial: 1, models: [fresh], pins: { 'rime-q4': old }, keep: { 'rime-q4': [fresh] } }));
  let pauses = 0;
  await store.download('rime-q4', { total: fresh.total, pause: async () => { pauses++; await settle(); } });
  assert.equal(pauses, 5);
});

test('a chunk failing its hash twice ends with reason hash; a file whose whole hash is wrong is never ready and its chunks go', async () => {
  const twice = make({ corrupt: { [fresh.url]: { 1: 2 } } });
  await twice.store.edit(() => ({ v: 1, serial: 1, models: [fresh], pins: { 'rime-q4': old }, keep: { 'rime-q4': [fresh] } }));
  await assert.rejects(twice.store.download('rime-q4', { total: fresh.total }), (e) => e.reason === 'hash' && e.chunk === 1);

  const liar = { ...fresh, total: 'f'.repeat(64) }; // every chunk right, the whole file not what the list says
  const m = make({ fetch: fakeHf({ ...files, [liar.url]: NEW }) });
  await m.store.edit(() => ({ v: 1, serial: 1, models: [liar], pins: { 'rime-q4': old }, keep: { 'rime-q4': [liar] } }));
  await assert.rejects(m.store.download('rime-q4', { total: liar.total, whole: true }), (e) => e.reason === 'hash' && e.whole === true);
  assert.deepEqual(await m.store.status('rime-q4', { total: liar.total }), { state: 'missing' });
});

test('too little room for the spare beside the model in use is reason quota, cleanly', async () => {
  const { store } = make({ quota: OLD.length + 6000 }); // the state file takes some of it
  await store.download('rime-q4');
  await store.edit(() => ({ v: 1, serial: 1, models: [fresh], pins: { 'rime-q4': old }, keep: { 'rime-q4': [fresh] } }));
  await assert.rejects(store.download('rime-q4', { total: fresh.total }), (e) => e.reason === 'quota' && e.needed === NEW.length && Number.isFinite(e.available));
  assert.deepEqual(await store.status('rime-q4'), { state: 'ready' }, 'the model in use is untouched');
});

test('drop deletes one kept version, never the one in use', async () => {
  const { store, fs } = make();
  await store.download('rime-q4');
  await store.edit(() => ({ v: 1, serial: 1, models: [fresh], pins: { 'rime-q4': old }, keep: { 'rime-q4': [fresh] } }));
  await store.download('rime-q4', { total: fresh.total });
  await store.edit((st) => ({ ...st, pins: { 'rime-q4': fresh }, keep: { 'rime-q4': [old] } })); // swapped
  await assert.rejects(store.drop('rime-q4', fresh.total), (e) => e.reason === 'in-use');
  await store.drop('rime-q4', old.total);
  assert.equal(tags(fs, 'rime-q4').length, 1);
  assert.deepEqual(await store.status('rime-q4'), { state: 'ready' });
  const opened = await store.open('rime-q4');
  assert.deepEqual(Buffer.from(await opened.read(0, 16)), Buffer.from(NEW.subarray(0, 16)));
});

test('remove forgets the model\'s pins, spares and trial, and keeps the serial and what failed', async () => {
  const { store } = make();
  await store.download('rime-q4');
  await store.edit(() => ({ v: 1, serial: 5, models: [fresh], pins: { 'rime-q4': old, 'rime-q8': big }, keep: { 'rime-q4': [fresh] },
    trial: { id: 'rime-q4', from: old.total, to: fresh.total }, failed: { ['c'.repeat(64)]: 4 } }));
  await store.remove('rime-q4');
  const st = (await store.catalog()).state;
  assert.equal(st.serial, 5);
  assert.deepEqual(Object.keys(st.pins), ['rime-q8']);
  assert.deepEqual(st.keep, {});
  assert.equal(st.trial, null);
  assert.deepEqual(st.failed, { ['c'.repeat(64)]: 4 });
  assert.equal((await store.catalog()).entries.get('rime-q4').total, fresh.total, 'a fresh download takes the newest');
});

test('a state file that is not JSON leaves the shipped catalog in force', async () => {
  const m = make();
  const top = await m.fs.root.getDirectoryHandle('glaze-models', { create: true });
  const h = await top.getFileHandle('~updates.json', { create: true });
  const w = await h.createWritable(); await w.write(new TextEncoder().encode('{nope')); await w.close();
  const c = await m.store.catalog();
  assert.equal(c.state, null);
  assert.equal(c.entries.get('rime-q4').total, old.total);
  assert.deepEqual((await m.store.list()).filter((x) => x.state === 'stale'), [], 'the state file is never a stale model');
});

test('drop rechecks the version in use under both locks before deleting files', async () => {
  const m = make();
  await m.store.download('rime-q4');
  await m.store.edit(() => ({ v: 1, serial: 1, models: [fresh], pins: { 'rime-q4': old }, keep: { 'rime-q4': [fresh] } }));
  await m.store.download('rime-q4', { total: fresh.total });
  let entered, release;
  const held = new Promise((r) => { entered = r; });
  const gate = new Promise((r) => { release = r; });
  const blocker = m.locks.request('glaze-model:rime-q4', async () => { entered(); await gate; });
  await held;
  const dropping = m.store.drop('rime-q4', fresh.total);
  const checked = assert.rejects(dropping, (e) => e.reason === 'in-use');
  await settle();
  await m.store.edit((st) => ({ ...st, pins: { 'rime-q4': fresh }, keep: { 'rime-q4': [old] } }));
  release();
  await blocker;
  await checked;
  assert.equal((await m.store.status('rime-q4')).state, 'ready');
});

test('drop reads current state even before a catalog broadcast arrives', async () => {
  const m = make({ channel: null });
  await m.store.download('rime-q4');
  await m.store.edit(() => ({ v: 1, serial: 1, models: [fresh], pins: { 'rime-q4': old }, keep: { 'rime-q4': [fresh] } }));
  await m.store.download('rime-q4', { total: fresh.total });
  const other = twin(m);
  await other.catalog();
  await m.store.edit((st) => ({ ...st, pins: { 'rime-q4': fresh }, keep: { 'rime-q4': [old] } }));
  await assert.rejects(other.drop('rime-q4', fresh.total), (e) => e.reason === 'in-use');
  assert.equal((await m.store.status('rime-q4')).state, 'ready');
});

test('whole-file verification cannot be skipped by an existing ready marker', async () => {
  const liar = { ...fresh, total: 'f'.repeat(64) };
  const m = make();
  await m.store.download('rime-q4');
  await m.store.edit(() => ({ v: 1, serial: 1, models: [liar], pins: { 'rime-q4': old }, keep: { 'rime-q4': [liar] } }));
  await m.store.download('rime-q4', { total: liar.total });
  await assert.rejects(m.store.download('rime-q4', { total: liar.total, whole: true }), (e) => e.reason === 'hash' && e.whole);
  assert.equal((await m.store.status('rime-q4', { total: liar.total })).state, 'missing');
  assert.equal((await m.store.status('rime-q4')).state, 'ready');
});
