const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = process.env.GZ_B8_REPO || path.join(__dirname, '..');
const L = require(path.join(root, 'lib/coursetabs.js'));
const site = 'https://bb.school.test';
const uid = '_42_1', cid = '_1_1';
// A picture the page asks for: the worker takes it (captureVisibleTab, faked here: `shots.size` characters).
const shot = (c = cid, extra = {}) => ({ op: 'shot', cid: c, path: `/ultra/courses/${c}/outline`, strip: null, size: [1400, 900], ...extra });
const flush = () => new Promise(setImmediate);
function worker({ keys = false, canvas = false } = {}) {
  const host = canvas ? 'http://localhost:3000' : site, page = canvas ? '/courses' : '/ultra/course';
  const data = {}, notices = [], pages = new Map([[1, host + page], [2, host + page], [3, host + page]]);
  const active = new Set([1, 2, 3]), shots = { size: 1000, calls: 0, failStore: false, during() {} };
  const born = Date.now() - 10000, epochs = new Map();
  let message, changed;
  const source = fs.readFileSync(path.join(root, 'lib/background.js'), 'utf8');
  const section = source.slice(source.indexOf('const SNAP_MEM'), source.indexOf('// A Gradescope course page for a Canvas or Ultra page'));
  const reads = { all: 0 };
  const area = {
    async get(k) { await flush(); if (k === null) reads.all++; return structuredClone(k === null ? data : { [k]: data[k] }); },
    ...(keys && { async getKeys() { await flush(); return Object.keys(data); } }),
    async set(patch) {
      await flush();
      if (shots.failStore && Object.keys(patch).some((k) => k.startsWith('snap:'))) { shots.failStore = false; throw new Error('quota'); }
      Object.assign(data, structuredClone(patch));
    },
    async remove(keys) { await flush(); for (const k of [].concat(keys)) delete data[k]; },
  };
  let on = true;
  const context = vm.createContext({
    GZ_CTABS_LIB: L, GZ_CARDS: require('../lib/cards.js'), Map, Date, URL,
    fromCanvas: async (s) => canvas && s.id === 'extension' && s.url.startsWith(host + '/') ? host : null,
    fromUltra: async (s) => !canvas && s.id === 'extension' && s.tab && s.url.startsWith(site + '/ultra/') ? site : null,
    switchOn: async () => on,
    chrome: { tabs: {
      async get(id) { return { url: pages.get(id), active: active.has(id), windowId: 1 }; },
      async captureVisibleTab() { shots.calls++; shots.during(); return `data:image/jpeg;base64,${'A'.repeat(shots.size)}`; },
      async sendMessage(tab, value, target) { notices.push({ tab, value, target }); },
    }, storage: { session: area, onChanged: { addListener(f) { changed = f; } } }, runtime: { onMessage: { addListener(f) { message = f; } } } },
  });
  vm.runInContext(section, context);
  const send = async (m, sender = {}) => {
    const s = { id: 'extension', url: host + page, frameId: 0, tab: { id: 1 }, documentId: 'document-1', ...sender };
    const epoch = epochs.get(s.documentId) || 0;
    const reply = await new Promise((resolve) => message({ type: 'glaze:snap', uid: canvas ? '42' : uid, born, epoch, ...m }, s, resolve));
    if (reply?.ok && reply.epoch) epochs.set(s.documentId, reply.epoch);
    return reply;
  };
  return { data, send, notices, pages, born, active, shots, reads,
    change(onNow) { on = onNow; changed({ enabled: { newValue: onNow } }, 'sync'); },
    async drain() { await send({ op: 'invalid' }); },
  };
}

test('snapshots require a hello from the current account', async () => {
  const w = worker();
  assert.equal(await w.send(shot()), null);
});

test('a stale account cannot switch ownership by writing', async () => {
  const w = worker();
  assert.ok(await w.send({ op: 'hello' }));
  assert.ok(await w.send(shot()));
  await w.send({ op: 'hello', uid: '_43_1', born: w.born + 1000 }, { tab: { id: 2 }, documentId: 'document-2' });
  assert.equal(await w.send(shot()), null);
  assert.equal(await w.send({ op: 'get', cid, uid: '_43_1' }), null);
});

test('a concurrent sign-out clear wins over an earlier snapshot write', async () => {
  const w = worker();
  await w.send({ op: 'hello' });
  const put = w.send(shot());
  const drop = w.send({ op: 'drop', signout: true });
  await Promise.all([put, drop]);
  assert.equal(Object.keys(w.data).filter((k) => k.startsWith('snap:')).length, 0);
  assert.equal(await w.send(shot()), null, 'sign-out revokes this document');
  assert.equal((await w.send({ op: 'hello' }))?.stale, true, 'cached identity cannot undo sign-out');
});

test('a picture past the one-course limit is not kept', async () => {
  const w = worker();
  await w.send({ op: 'hello' });
  w.shots.size = L.SNAP_ONE;
  assert.equal(await w.send(shot()), null);
});

test('picture geometry rejects unbounded sizes', async () => {
  const w = worker();
  await w.send({ op: 'hello' });
  assert.equal(await w.send(shot(cid, { size: [1e99, 900] })), null);
  assert.equal(await w.send(shot(cid, { size: [1400] })), null);
});

test('only the tab on screen is pictured: one switched away from, before or during the picture, gives none', async () => {
  const w = worker();
  await w.send({ op: 'hello' });
  w.active.delete(1);
  assert.equal(await w.send(shot()), null, 'not the active tab');
  w.active.add(1);
  w.shots.during = () => w.active.delete(1);
  assert.equal(await w.send(shot()), null, 'switched away while the picture was taken');
  w.shots.during = () => {}; w.active.add(1);
  w.pages.set(1, 'https://other.test/ultra/course');
  assert.equal(await w.send(shot()), null, 'the tab went to another site');
});

test('the picture broker rejects another origin, subframes and other courses\' addresses', async () => {
  const w = worker();
  assert.equal(await w.send({ op: 'hello' }, { url: 'https://other.test/ultra/course' }), null);
  assert.equal(await w.send({ op: 'hello' }, { frameId: 1 }), null);
  await w.send({ op: 'hello' });
  assert.equal(await w.send(shot(cid, { path: '/ultra/courses/_9_1/outline' })), null);
  assert.equal(await w.send(shot(cid, { path: '/ultra/courses/_1_1/x y' })), null);
});

test('concurrent pictures stay inside the shared total cap', async () => {
  const w = worker();
  await w.send({ op: 'hello' });
  w.shots.size = 1_500_000;
  await Promise.all(Array.from({ length: 8 }, (_, i) => w.send(shot(`_${i + 1}_1`))));
  const copies = Object.entries(w.data).filter(([k]) => k.startsWith('snap:')).map(([, v]) => v);
  assert.ok(copies.length > 0);
  assert.ok(copies.reduce((sum, s) => sum + s.n, 0) <= L.SNAP_ALL);
});

test('with getKeys, the total cap is kept from the sizes recorded, without reading the pictures', async () => {
  const w = worker({ keys: true });
  await w.send({ op: 'hello' });
  w.shots.size = 3_000_000 - 100;
  for (const c of ['_1_1', '_2_1', '_3_1', '_4_1']) assert.ok((await w.send(shot(c)))?.snap);
  assert.equal(w.reads.all, 0, 'no whole-area read');
  const copies = Object.entries(w.data).filter(([k]) => k.startsWith('snap:')).map(([, v]) => v);
  assert.deepEqual(copies.map((s) => s.cid).sort(), ['_3_1', '_4_1'], 'the oldest went past the total');
  await w.send({ op: 'forget', cid: '_4_1' });
  assert.ok((await w.send(shot('_5_1')))?.snap);
  assert.deepEqual(Object.keys(w.data).filter((k) => k.startsWith('snap:')).length, 2, 'a forgotten picture no longer counts');
  w.change(false); await w.drain();
  assert.equal(Object.keys(w.data).filter((k) => k.startsWith('snap:')).length, 0);
});

test('a failed picture overwrite cannot undercount the retained picture and exceed the total cap', async () => {
  const w = worker({ keys: true });
  await w.send({ op: 'hello' });
  w.shots.size = 2_900_000;
  await w.send(shot());
  w.shots.size = 100_000;
  w.shots.failStore = true;
  await w.send(shot());
  w.shots.size = 2_900_000;
  await w.send(shot('_2_1')); await w.send(shot('_3_1'));
  const copies = Object.entries(w.data).filter(([k]) => k.startsWith('snap:')).map(([, s]) => s);
  assert.ok(copies.reduce((n, s) => n + s.n, 0) <= L.SNAP_ALL, 'size bookkeeping must describe the successfully stored pictures');
});

test('closing a course forgets its worker picture without dropping another course\'s', async () => {
  const w = worker(); await w.send({ op: 'hello' });
  await w.send(shot());
  await w.send(shot('_2_1'));
  assert.ok(await w.send({ op: 'forget', cid }));
  assert.equal(await w.send({ op: 'get', cid }), null);
  assert.ok((await w.send({ op: 'get', cid: '_2_1' }))?.snap);
});

test('an account change clears and revokes already-open documents, including cached hello', async () => {
  const w = worker();
  const hello = await w.send({ op: 'hello' });
  await w.send(shot());
  const next = { tab: { id: 2 }, documentId: 'document-2' };
  assert.ok((await w.send({ op: 'hello', uid: '_43_1', born: w.born + 1000 }, next))?.ok);
  assert.equal(Object.keys(w.data).filter((k) => k.startsWith('snap:')).length, 0);
  assert.ok(w.notices.some((n) => n.tab === 1 && n.target.documentId === 'document-1' && n.value.uid === '_43_1'));
  assert.equal((await w.send({ op: 'hello' }))?.stale, true, 'old document cannot reassert cached /users/me');
  assert.equal(await w.send(shot(cid, { epoch: hello.epoch })), null);
  assert.equal((await w.send({ op: 'hello', born: w.born - 1000 }, { tab: { id: 3 }, documentId: 'unseen-old-document' }))?.stale, true);
  assert.equal((await w.send({ op: 'hello', born: w.born + 1500 }, { tab: { id: 3 }, documentId: 'old-document-born-after-switching-document' }))?.stale, true, 'even an unseen document born after the switching document predates the observed boundary');
  assert.ok((await w.send({ op: 'hello', born: Date.now() + 1 }, { tab: { id: 1 }, documentId: 'reloaded-document' }))?.ok);
});

test('cache broadcasts only reach known matching Ultra documents', async () => {
  const w = worker();
  await w.send({ op: 'hello' });
  w.pages.set(1, 'https://other.test/ultra/course');
  w.notices.length = 0;
  await w.send({ op: 'hello', born: w.born + 1000 }, { tab: { id: 2 }, documentId: 'document-2' });
  assert.deepEqual(w.notices.map((n) => n.tab), [2]);
});

test('a rapid off/on clears its observed generation and rejects an old document\'s picture', async () => {
  const w = worker();
  const hello = await w.send({ op: 'hello' });
  await w.send(shot());
  w.change(false); w.change(true);
  await w.drain();
  assert.equal(Object.keys(w.data).filter((k) => k.startsWith('snap:')).length, 0);
  assert.ok(w.notices.some((n) => n.value.epoch > hello.epoch && n.value.uid === uid));
  assert.equal(await w.send(shot()), null, 'old generation cannot refill after off/on');
  assert.ok((await w.send({ op: 'hello' }))?.ok);
  assert.ok((await w.send(shot()))?.snap, 'fresh hello resumes normal pictures');
});

test('document ordering metadata is strictly validated and never replaces sender checks', async () => {
  const w = worker();
  for (const born of [0, -1, Infinity, NaN, '123', Date.now() + 100000]) assert.equal(await w.send({ op: 'hello', born }), null);
  assert.equal(await w.send({ op: 'hello' }, { id: 'other-extension' }), null);
  assert.equal(await w.send({ op: 'hello' }, { tab: null }), null);
  assert.equal(await w.send({ op: 'hello' }, { documentId: {} }), null);
  assert.equal(await w.send({ op: 'hello', uid: '_' + '1'.repeat(1000) + '_1' }), null);
});


test('a tolerated birth-time skew never creates a future account boundary', async () => {
  const w = worker(); await w.send({ op: 'hello' });
  const future = Date.now() + 500;
  await w.send({ op: 'hello', uid: '_43_1', born: future }, { tab: { id: 2 }, documentId: 'skewed-document' });
  assert.ok(w.data[`snapwho:${site}`]?.floor <= Date.now());
  assert.ok((await w.send({ op: 'hello', born: Date.now() + 1 }, { tab: { id: 3 }, documentId: 'fresh-document' }))?.ok);
});


test('a queued screenshot never calls capture on a tab that has already left Ultra', async () => {
  const w = worker();
  await w.send({ op: 'hello' });
  w.pages.set(1, 'https://other.test/private');
  assert.equal(await w.send(shot()), null);
  assert.equal(w.shots.calls, 0);
});

test('Canvas numeric accounts keep and clear snapshots of their own course pages', async () => {
  const w = worker({ canvas: true });
  const canvasShot = { op: 'shot', cid: '12', path: '/courses/12/pages/notes?module_item_id=9', strip: null, size: [1400, 900] };
  assert.ok(await w.send({ op: 'hello' }));
  const result = await w.send(canvasShot);
  assert.equal(result.snap.path, canvasShot.path);
  assert.equal((await w.send({ op: 'get', cid: '12' })).snap.cid, '12');
  assert.equal(await w.send({ ...canvasShot, path: '/courses/123/grades' }), null);
  assert.equal(await w.send({ ...canvasShot, cid: '_12_1', path: '/ultra/courses/_12_1/outline' }), null);
  assert.equal(await w.send(canvasShot, { frameId: 7 }), null, 'only the surrounding page can capture');
  await w.send({ op: 'drop', signout: true });
  assert.equal(await w.send({ op: 'get', cid: '12' }), null);
  assert.equal(Object.keys(w.data).filter((k) => k.startsWith('snap:')).length, 0);
});

test('Canvas snapshots revoke old documents on account change and notify non-course pages', async () => {
  const w = worker({ canvas: true });
  await w.send({ op: 'hello' });
  await w.send({ op: 'hello', uid: '43', born: w.born + 1000 }, { tab: { id: 2 }, documentId: 'canvas-account-2' });
  assert.equal((await w.send({ op: 'hello' }))?.stale, true);
  assert.ok(w.notices.some((n) => n.tab === 1 && n.value.uid === '43'));
});
