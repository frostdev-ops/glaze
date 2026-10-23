const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = process.env.GZ_B8_REPO || path.join(__dirname, '..');
const L = require(path.join(root, 'lib/coursetabs.js'));
const site = 'https://bb.school.test';
const uid = '_42_1', cid = '_1_1';
// A sketch the page sends of what it shows (lib/coursetabs.js sketch): `boxes` of its boxes, 60 at most.
const box = (i) => [i % 20 * 70, Math.floor(i / 20) * 300, 64, 280, 'btic'[i % 4], '#1a2b3cff', 4];
const boxes = (n = 3) => Array.from({ length: n }, (_, i) => box(i));
const sketch = (c = cid, extra = {}) => ({ op: 'sketch', cid: c, path: `/ultra/courses/${c}/outline`, size: [1400, 900], top: 0, name: 'Computer Science I', strip: null, boxes: boxes(), ...extra });
const big = (c) => sketch(c, { boxes: boxes(L.BOXES), name: 'N'.repeat(200), strip: [0, 0, 1400, 40] });
const kept = (w) => Object.entries(w.data).filter(([k]) => k.startsWith('snap:')).map(([, v]) => v);
const flush = () => new Promise(setImmediate);
function worker({ keys = false, canvas = false } = {}) {
  const host = canvas ? 'http://localhost:3000' : site, page = canvas ? '/courses' : '/ultra/course';
  const data = {}, notices = [], pages = new Map([[1, host + page], [2, host + page], [3, host + page]]);
  const store = { failStore: false }, captures = { calls: 0 };
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
      if (store.failStore && Object.keys(patch).some((k) => k.startsWith('snap:'))) { store.failStore = false; throw new Error('quota'); }
      Object.assign(data, structuredClone(patch));
    },
    async remove(keys) { await flush(); for (const k of [].concat(keys)) delete data[k]; },
  };
  let on = true;
  const context = vm.createContext({
    GZ_CTABS_LIB: L, GZ_CARDS: require('../lib/cards.js'), Map, Date, URL, JSON,
    fromCanvas: async (s) => canvas && s.id === 'extension' && s.url.startsWith(host + '/') ? host : null,
    fromUltra: async (s) => !canvas && s.id === 'extension' && s.tab && s.url.startsWith(site + '/ultra/') ? site : null,
    switchOn: async () => on,
    chrome: { tabs: {
      async get(id) { return { url: pages.get(id), active: true, windowId: 1 }; },
      // Present, as in a browser holding <all_urls>: the worker must never reach for it.
      async captureVisibleTab() { captures.calls++; return `data:image/jpeg;base64,${'A'.repeat(1000)}`; },
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
  return { data, send, notices, pages, born, store, captures, reads, source,
    change(onNow) { on = onNow; changed({ enabled: { newValue: onNow } }, 'sync'); },
    async drain() { await send({ op: 'invalid' }); },
  };
}

test('sketches require a hello from the current account', async () => {
  const w = worker();
  assert.equal(await w.send(sketch()), null);
});

test('a stale account cannot switch ownership by writing', async () => {
  const w = worker();
  assert.ok(await w.send({ op: 'hello' }));
  assert.ok(await w.send(sketch()));
  await w.send({ op: 'hello', uid: '_43_1', born: w.born + 1000 }, { tab: { id: 2 }, documentId: 'document-2' });
  assert.equal(await w.send(sketch()), null);
  assert.equal(await w.send({ op: 'get', cid, uid: '_43_1' }), null);
});

test('a concurrent sign-out clear wins over an earlier sketch write', async () => {
  const w = worker();
  await w.send({ op: 'hello' });
  const put = w.send(sketch());
  const drop = w.send({ op: 'drop', signout: true });
  await Promise.all([put, drop]);
  assert.equal(kept(w).length, 0);
  assert.equal(await w.send(sketch()), null, 'sign-out revokes this document');
  assert.equal((await w.send({ op: 'hello' }))?.stale, true, 'cached identity cannot undo sign-out');
});

test('the worker keeps the sketch the page sent, as clip() cleans it, and never takes a screenshot', async () => {
  const w = worker();
  await w.send({ op: 'hello' });
  const sent = sketch(cid, { top: 412.4, strip: [0, 0, 1400, 40.2], boxes: [[0, 0, 1400, 60, 'b', '#102030ff', 0], [20, 15, 220, 30, 'n', '#eeeeeeff', 30], [60, 120, 500, 50.4, 't', '#ccccccff', 30]] });
  const r = await w.send(sent);
  assert.deepEqual(JSON.parse(JSON.stringify(r.snap)), { cid, path: sent.path, at: r.snap.at, size: [1400, 900], top: 412, name: 'Computer Science I', strip: [0, 0, 1400, 40],
    boxes: [[0, 0, 1400, 60, 'b', '#102030ff', 0], [20, 15, 220, 30, 'n', '#eeeeeeff', 30], [60, 120, 500, 50, 't', '#ccccccff', 30]], n: r.snap.n });
  assert.equal(r.snap.n, JSON.stringify({ ...r.snap, n: undefined }).length, 'n: the size of what is kept');
  assert.ok(!('shot' in r.snap));
  assert.equal(w.captures.calls, 0);
  assert.ok(!/captureVisibleTab|data:image|SNAP_SHOT|snapShot/.test(w.source.replace(/\/\/.*$/gm, '')), 'no screenshot path is left in the worker');
});

test('a sketch of the wrong shape is refused, field by field', async () => {
  const w = worker();
  await w.send({ op: 'hello' });
  const bad = [
    { size: [1e99, 900] }, { size: [1400] }, { size: [0, 900] }, { size: ['1400', 900] },
    { top: -1 }, { top: NaN }, { top: 1e9 },
    { name: 'x'.repeat(201) }, { name: 'a\nb' }, { name: 7 },
    { strip: [0, 0, 1400] }, { strip: [0, 0, 1500, 40] }, { strip: 'top' },
    { boxes: 'none' }, { boxes: boxes(L.BOXES + 1) },
    { boxes: [[0, 0, 10, 10, 'b', '#102030ff']] }, { boxes: [[0, 0, 10, 10, 'b', '#102030ff', 0, 'extra']] },
    { boxes: [[-1, 0, 10, 10, 'b', '#102030ff', 0]] }, { boxes: [[1395, 0, 10, 10, 'b', '#102030ff', 0]] }, { boxes: [[0, 895, 10, 10, 'b', '#102030ff', 0]] },
    { boxes: [[0, 0, 0, 10, 'b', '#102030ff', 0]] }, { boxes: [[0, 0, 10, 10, 'x', '#102030ff', 0]] },
    { boxes: [[0, 0, 10, 10, 'b', 'red', 0]] }, { boxes: [[0, 0, 10, 10, 'b', 'url(https://x.test/a.png)', 0]] }, { boxes: [[0, 0, 10, 10, 'b', '#102030', 0]] },
    { boxes: [[0, 0, 10, 10, 'b', '#102030ff', 6]] }, { boxes: [[0, 0, 10, 10, 'b', '#102030ff', -1]] }, { boxes: [[0, 0, 10, 10, 't', '#102030ff', 11]] },
    { boxes: [[0, 0, 10, 10, 'n', '#102030ff', 10], [0, 20, 10, 10, 'n', '#102030ff', 10]] }, { name: '', boxes: [[0, 0, 10, 10, 'n', '#102030ff', 10]] },
    { boxes: [[0, 0, 10, 10, 'b', '#102030ff', '0']] }, { boxes: [[0, 0, 10, 10, 'b', '#102030ff', 0], null] }, { boxes: [{ 0: 0, 1: 0, 2: 10, 3: 10, 4: 'b', 5: '#102030ff', 6: 0, length: 7 }] },
    { shot: 'data:image/jpeg;base64,AAAA', boxes: undefined },
  ];
  for (const x of bad) assert.equal(await w.send(sketch(cid, x)), null, JSON.stringify(x));
  assert.equal(kept(w).length, 0);
  assert.ok((await w.send(sketch(cid, { strip: null, name: '' })))?.snap, 'and the shape itself is kept');
});

test('the largest sketch fits the one-course limit, and one account\'s full list fits the total', async () => {
  const w = worker();
  await w.send({ op: 'hello' });
  // Every field at its longest: five-digit places, a quoted name and query (each quote doubles in JSON).
  const worst = sketch(cid, { path: `/ultra/courses/${cid}/${'a'.repeat(560)}?${'"'.repeat(600)}`, size: [99999, 99999], top: 9_999_999, name: '"'.repeat(200),
    strip: [10000, 10000, 89999, 89999], boxes: Array.from({ length: L.BOXES }, (_, i) => [10000 + i, 10000, 10000, 10000, i ? 'b' : 'n', '#ffffffff', i ? 5000 : 10000]) });
  const r = await w.send(worst);
  assert.ok(r?.snap && r.snap.n <= L.SNAP_ONE, `${r?.snap?.n} <= ${L.SNAP_ONE}`);
  assert.ok(L.MAX * L.SNAP_ONE <= L.SNAP_ALL, 'a full list of one account never evicts its own sketches');
  assert.ok(L.SNAP_ALL <= 1e6, 'sized for sketches: storage.session keeps room for everything else');
});

test('the picture broker rejects another origin, subframes and other courses\' addresses', async () => {
  const w = worker();
  assert.equal(await w.send({ op: 'hello' }, { url: 'https://other.test/ultra/course' }), null);
  assert.equal(await w.send({ op: 'hello' }, { frameId: 1 }), null);
  await w.send({ op: 'hello' });
  assert.equal(await w.send(sketch(cid, { path: '/ultra/courses/_9_1/outline' })), null);
  assert.equal(await w.send(sketch(cid, { path: '/ultra/courses/_1_1/x y' })), null);
  assert.equal(await w.send(sketch(), { url: 'https://other.test/private' }), null, 'a sender off the site');
});

// Enough big sketches to pass the total (each kept a little larger than its message's JSON less the op).
const many = Math.ceil(L.SNAP_ALL / (JSON.stringify(big('_1_1')).length - 20)) + 20;

test('concurrent sketches stay inside the shared total cap', async () => {
  const w = worker();
  await w.send({ op: 'hello' });
  await Promise.all(Array.from({ length: many }, (_, i) => w.send(big(`_${i + 1}_1`))));
  const copies = kept(w);
  assert.ok(copies.length > 0 && copies.length < many);
  assert.ok(copies.reduce((sum, s) => sum + s.n, 0) <= L.SNAP_ALL);
});

test('with getKeys, the total cap is kept from the sizes recorded, without reading the sketches', async () => {
  const w = worker({ keys: true });
  await w.send({ op: 'hello' });
  for (let i = 1; i <= many; i++) assert.ok((await w.send(big(`_${i}_1`)))?.snap);
  assert.equal(w.reads.all, 0, 'no whole-area read');
  const copies = kept(w), cids = copies.map((s) => s.cid);
  assert.ok(copies.reduce((sum, s) => sum + s.n, 0) <= L.SNAP_ALL);
  assert.ok(!cids.includes('_1_1') && cids.includes(`_${many}_1`), 'the oldest went past the total');
  const count = copies.length;
  await w.send({ op: 'forget', cid: `_${many}_1` });
  assert.ok((await w.send(big('_9999_1')))?.snap);
  assert.equal(kept(w).length, count, 'a forgotten sketch no longer counts');
  w.change(false); await w.drain();
  assert.equal(kept(w).length, 0);
});

test('a failed sketch overwrite cannot undercount the retained sketch and exceed the total cap', async () => {
  const w = worker({ keys: true });
  await w.send({ op: 'hello' });
  await w.send(big(cid));
  w.store.failStore = true;
  await w.send(sketch(cid, { boxes: boxes(1), name: '' }));
  for (let i = 2; i <= many; i++) await w.send(big(`_${i}_1`));
  assert.ok(kept(w).reduce((n, s) => n + s.n, 0) <= L.SNAP_ALL, 'size bookkeeping must describe the successfully stored sketches');
});

test('closing a course forgets its worker sketch without dropping another course\'s', async () => {
  const w = worker(); await w.send({ op: 'hello' });
  await w.send(sketch());
  await w.send(sketch('_2_1'));
  assert.ok(await w.send({ op: 'forget', cid }));
  assert.equal(await w.send({ op: 'get', cid }), null);
  assert.ok((await w.send({ op: 'get', cid: '_2_1' }))?.snap?.boxes);
});

test('an account change clears and revokes already-open documents, including cached hello', async () => {
  const w = worker();
  const hello = await w.send({ op: 'hello' });
  await w.send(sketch());
  const next = { tab: { id: 2 }, documentId: 'document-2' };
  assert.ok((await w.send({ op: 'hello', uid: '_43_1', born: w.born + 1000 }, next))?.ok);
  assert.equal(kept(w).length, 0);
  assert.ok(w.notices.some((n) => n.tab === 1 && n.target.documentId === 'document-1' && n.value.uid === '_43_1'));
  assert.equal((await w.send({ op: 'hello' }))?.stale, true, 'old document cannot reassert cached /users/me');
  assert.equal(await w.send(sketch(cid, { epoch: hello.epoch })), null);
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

test('a rapid off/on clears its observed generation and rejects an old document\'s sketch', async () => {
  const w = worker();
  const hello = await w.send({ op: 'hello' });
  await w.send(sketch());
  w.change(false); w.change(true);
  await w.drain();
  assert.equal(kept(w).length, 0);
  assert.ok(w.notices.some((n) => n.value.epoch > hello.epoch && n.value.uid === uid));
  assert.equal(await w.send(sketch()), null, 'old generation cannot refill after off/on');
  assert.ok((await w.send({ op: 'hello' }))?.ok);
  assert.ok((await w.send(sketch()))?.snap, 'fresh hello resumes normal sketches');
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

test('the old screenshot op is gone: a `shot` is refused and nothing is captured', async () => {
  const w = worker();
  await w.send({ op: 'hello' });
  assert.equal(await w.send({ op: 'shot', cid, path: `/ultra/courses/${cid}/outline`, strip: null, size: [1400, 900] }), null);
  assert.equal(w.captures.calls, 0);
  assert.equal(kept(w).length, 0);
});

test('Canvas numeric accounts keep and clear sketches of their own course pages', async () => {
  const w = worker({ canvas: true });
  const canvasSketch = sketch('12', { path: '/courses/12/pages/notes?module_item_id=9' });
  assert.ok(await w.send({ op: 'hello' }));
  const result = await w.send(canvasSketch);
  assert.equal(result.snap.path, canvasSketch.path);
  assert.equal((await w.send({ op: 'get', cid: '12' })).snap.cid, '12');
  assert.equal(await w.send({ ...canvasSketch, path: '/courses/123/grades' }), null);
  assert.equal(await w.send({ ...canvasSketch, cid: '_12_1', path: '/ultra/courses/_12_1/outline' }), null);
  assert.equal(await w.send(canvasSketch, { frameId: 7 }), null, 'only the surrounding page can send one');
  await w.send({ op: 'drop', signout: true });
  assert.equal(await w.send({ op: 'get', cid: '12' }), null);
  assert.equal(kept(w).length, 0);
});

test('Canvas sketches revoke old documents on account change and notify non-course pages', async () => {
  const w = worker({ canvas: true });
  await w.send({ op: 'hello' });
  await w.send({ op: 'hello', uid: '43', born: w.born + 1000 }, { tab: { id: 2 }, documentId: 'canvas-account-2' });
  assert.equal((await w.send({ op: 'hello' }))?.stale, true);
  assert.ok(w.notices.some((n) => n.tab === 1 && n.value.uid === '43'));
});
