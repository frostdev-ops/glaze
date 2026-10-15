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
  const data = {}, notices = [], pages = new Map([[1, site + '/ultra/course'], [2, site + '/ultra/course'], [3, site + '/ultra/course']]);
  const born = Date.now() - 10000, epochs = new Map();
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
    GZ_CTABS_LIB: L, GZ_CARDS: require('../lib/cards.js'), Map, Date, URL,
    fromUltra: async (s) => s.id === 'extension' && s.tab && s.url.startsWith(site + '/ultra/') ? site : null,
    switchOn: async () => on,
    chrome: { tabs: {
      async get(id) { return { url: pages.get(id) }; },
      async sendMessage(tab, value, target) { notices.push({ tab, value, target }); },
    }, storage: { session: area, onChanged: { addListener(f) { changed = f; } } }, runtime: { onMessage: { addListener(f) { message = f; } } } },
  });
  vm.runInContext(section, context);
  const send = async (m, sender = {}) => {
    const s = { id: 'extension', url: site + '/ultra/course', frameId: 0, tab: { id: 1 }, documentId: 'document-1', ...sender };
    const epoch = epochs.get(s.documentId) || 0;
    const reply = await new Promise((resolve) => message({ type: 'glaze:snap', uid, born, epoch, ...m }, s, resolve));
    if (reply?.ok && reply.epoch) epochs.set(s.documentId, reply.epoch);
    return reply;
  };
  return { data, send, notices, pages, born,
    change(onNow) { on = onNow; changed({ enabled: { newValue: onNow } }, 'sync'); },
    async drain() { await send({ op: 'invalid' }); },
  };
}

test('snapshots require a hello from the current account', async () => {
  const w = worker();
  assert.equal(await w.send({ op: 'put', cid, snap: snapshot() }), null);
});

test('a stale account cannot switch ownership by writing', async () => {
  const w = worker();
  assert.ok(await w.send({ op: 'hello' }));
  assert.ok(await w.send({ op: 'put', cid, snap: snapshot() }));
  await w.send({ op: 'hello', uid: '_43_1', born: w.born + 1000 }, { tab: { id: 2 }, documentId: 'document-2' });
  assert.equal(await w.send({ op: 'put', cid, snap: snapshot() }), null);
  assert.equal(await w.send({ op: 'get', cid, uid: '_43_1' }), null);
});

test('a concurrent sign-out clear wins over an earlier snapshot write', async () => {
  const w = worker();
  await w.send({ op: 'hello' });
  const put = w.send({ op: 'put', cid, snap: snapshot() });
  const drop = w.send({ op: 'drop', signout: true });
  await Promise.all([put, drop]);
  assert.equal(Object.keys(w.data).filter((k) => k.startsWith('snap:')).length, 0);
  assert.equal(await w.send({ op: 'put', cid, snap: snapshot() }), null, 'sign-out revokes this account until hello');
});

test('snapshot limits count ancestor metadata', async () => {
  const w = worker();
  await w.send({ op: 'hello' });
  const big = snapshot('x'.repeat(990000), Array.from({ length: 30 }, () => ['div', 'i'.repeat(3999), 'c'.repeat(3999), 's'.repeat(3999), 'm'.repeat(3999)]));
  assert.equal(await w.send({ op: 'put', cid, snap: big }), null);
});

test('snapshot geometry rejects unbounded coordinates', async () => {
  const w = worker();
  await w.send({ op: 'hello' });
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


test('an account change clears and revokes already-open documents, including cached hello', async () => {
  const w = worker();
  const hello = await w.send({ op: 'hello' });
  await w.send({ op: 'put', cid, snap: snapshot() });
  const next = { tab: { id: 2 }, documentId: 'document-2' };
  assert.ok((await w.send({ op: 'hello', uid: '_43_1', born: w.born + 1000 }, next))?.ok);
  assert.equal(Object.keys(w.data).filter((k) => k.startsWith('snap:')).length, 0);
  assert.ok(w.notices.some((n) => n.tab === 1 && n.target.documentId === 'document-1' && n.value.uid === '_43_1'));
  assert.equal((await w.send({ op: 'hello' }))?.stale, true, 'old document cannot reassert cached /users/me');
  assert.equal(await w.send({ op: 'put', cid, epoch: hello.epoch, snap: snapshot() }), null);
  assert.equal((await w.send({ op: 'hello', born: w.born - 1000 }, { tab: { id: 3 }, documentId: 'unseen-old-document' }))?.stale, true);
  assert.ok((await w.send({ op: 'hello', born: w.born + 2000 }, { tab: { id: 1 }, documentId: 'reloaded-document' }))?.ok);
});

test('cache broadcasts only reach known matching Ultra documents', async () => {
  const w = worker();
  await w.send({ op: 'hello' });
  w.pages.set(1, 'https://other.test/ultra/course');
  w.notices.length = 0;
  await w.send({ op: 'hello', born: w.born + 1000 }, { tab: { id: 2 }, documentId: 'document-2' });
  assert.deepEqual(w.notices.map((n) => n.tab), [2]);
});

test('a rapid off/on clears its observed generation and rejects an in-flight old put', async () => {
  const w = worker();
  const hello = await w.send({ op: 'hello' });
  await w.send({ op: 'put', cid, snap: snapshot() });
  w.change(false); w.change(true);
  await w.drain();
  assert.equal(Object.keys(w.data).filter((k) => k.startsWith('snap:')).length, 0);
  assert.ok(w.notices.some((n) => n.value.epoch > hello.epoch && n.value.uid === uid));
  assert.equal(await w.send({ op: 'put', cid, snap: snapshot() }), null, 'old generation cannot refill after off/on');
  assert.ok((await w.send({ op: 'hello' }))?.ok);
  assert.ok((await w.send({ op: 'put', cid, snap: snapshot() }))?.ok, 'fresh hello resumes normal snapshots');
});

test('document ordering metadata is strictly validated and never replaces sender checks', async () => {
  const w = worker();
  for (const born of [0, -1, Infinity, NaN, '123', Date.now() + 100000]) assert.equal(await w.send({ op: 'hello', born }), null);
  assert.equal(await w.send({ op: 'hello' }, { id: 'other-extension' }), null);
  assert.equal(await w.send({ op: 'hello' }, { tab: null }), null);
  assert.equal(await w.send({ op: 'hello' }, { documentId: {} }), null);
});
