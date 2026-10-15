const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = process.env.GZ_B8_REPO || path.join(__dirname, '..');
const L = require(path.join(root, 'lib/coursetabs.js'));
const site = 'https://bb.school.test';
const uid = '_42_1', cid = '_1_1';
const snapshot = (html = '<div>Viewed course</div>', chain = []) => ({ cid, path: `/ultra/courses/${cid}/outline`, layers: [{ html, at: [0, 0, 0, 0], chain }] });
const flush = () => new Promise(setImmediate);
function worker() {
  const data = {};
  let message, changed;
  const source = fs.readFileSync(path.join(root, 'lib/background.js'), 'utf8');
  const section = source.slice(source.indexOf('const SNAP_MEM'), source.indexOf('// A Gradescope course page for a Canvas or Ultra page'));
  const area = {
    async get(k) { await flush(); return structuredClone(k === null ? data : { [k]: data[k] }); },
    async set(patch) { await flush(); Object.assign(data, structuredClone(patch)); },
    async remove(keys) { await flush(); for (const k of [].concat(keys)) delete data[k]; },
  };
  let on = true;
  const context = vm.createContext({
    GZ_CTABS_LIB: L, GZ_CARDS: require('../lib/cards.js'), Map, Date,
    fromUltra: async (s) => s.url.startsWith(site + '/ultra/') ? site : null,
    switchOn: async () => on,
    chrome: { storage: { session: area, onChanged: { addListener(f) { changed = f; } } }, runtime: { onMessage: { addListener(f) { message = f; } } } },
  });
  vm.runInContext(section, context);
  const send = (m, sender = {}) => new Promise((resolve) => message({ type: 'glaze:snap', uid, ...m }, { url: site + '/ultra/course', frameId: 0, ...sender }, resolve));
  return { data, send, off() { on = false; changed({ enabled: { newValue: false } }, 'sync'); } };
}

test('snapshots require a hello from the current account; a stale account cannot switch ownership by writing', async () => {
  const w = worker();
  assert.equal(await w.send({ op: 'put', cid, snap: snapshot() }), null);
  assert.ok(await w.send({ op: 'hello' }));
  assert.ok(await w.send({ op: 'put', cid, snap: snapshot() }));
  await w.send({ op: 'hello', uid: '_43_1' });
  assert.equal(await w.send({ op: 'put', cid, snap: snapshot() }), null);
  assert.equal(await w.send({ op: 'get', cid, uid: '_43_1' }), null);
});

test('a concurrent sign-out clear wins over an earlier snapshot write', async () => {
  const w = worker();
  await w.send({ op: 'hello' });
  const put = w.send({ op: 'put', cid, snap: snapshot() });
  const drop = w.send({ op: 'drop' });
  await Promise.all([put, drop]);
  assert.equal(Object.keys(w.data).filter((k) => k.startsWith('snap:')).length, 0);
  assert.equal(await w.send({ op: 'put', cid, snap: snapshot() }), null, 'sign-out revokes this account until hello');
});

test('snapshot limits count ancestor metadata and reject unbounded coordinates', async () => {
  const w = worker();
  await w.send({ op: 'hello' });
  const big = snapshot('x'.repeat(990000), Array.from({ length: 30 }, () => ['div', 'i'.repeat(3999), 'c'.repeat(3999), 's'.repeat(3999), 'm'.repeat(3999)]));
  assert.equal(await w.send({ op: 'put', cid, snap: big }), null);
  const bad = snapshot(); bad.layers[0].at[0] = 1e99;
  assert.equal(await w.send({ op: 'put', cid, snap: bad }), null);
});

test('the snapshot broker rejects another origin, subframes and unsafe routes', async () => {
  const w = worker();
  assert.equal(await w.send({ op: 'hello' }, { url: 'https://other.test/ultra/course' }), null);
  assert.equal(await w.send({ op: 'hello' }, { frameId: 1 }), null);
  await w.send({ op: 'hello' });
  const bad = snapshot(); bad.path += '/assessment/_3_1';
  assert.equal(await w.send({ op: 'put', cid, snap: bad }), null);
});


test('concurrent snapshot writes stay inside the shared total cap', async () => {
  const w = worker();
  await w.send({ op: 'hello' });
  await Promise.all(Array.from({ length: 8 }, (_, i) => {
    const s = snapshot('x'.repeat(990000)); s.cid = `_${i + 1}_1`; s.path = `/ultra/courses/${s.cid}/outline`;
    return w.send({ op: 'put', cid: s.cid, snap: s });
  }));
  const copies = Object.entries(w.data).filter(([k]) => k.startsWith('snap:')).map(([, v]) => v);
  assert.ok(copies.length > 0);
  assert.ok(copies.reduce((sum, s) => sum + s.n, 0) <= L.SNAP_ALL);
});


test('closing a course forgets its worker copy without dropping another course', async () => {
  const w = worker(); await w.send({ op: 'hello' });
  await w.send({ op: 'put', cid, snap: snapshot() });
  const other = snapshot(); other.cid = '_2_1'; other.path = '/ultra/courses/_2_1/outline';
  await w.send({ op: 'put', cid: other.cid, snap: other });
  assert.ok(await w.send({ op: 'forget', cid }));
  assert.equal(await w.send({ op: 'get', cid }), null);
  assert.ok((await w.send({ op: 'get', cid: other.cid }))?.snap);
});
