// The frame's side of the papers store (lib/writer-papers.js open() without a store): reads from storage.local, writes
// through the worker ('glaze:writerPapers'), each save carrying the revision it last saw so another editor's newer
// text is kept as a version. Here the worker is the same module over the same in-memory storage, answering late.
const test = require('node:test');
const assert = require('node:assert/strict');
const PA = require('../lib/writer-papers.js');

const memory = () => {
  const data = {};
  return { get: async (k) => ({ [k]: structuredClone(data[k]) }), set: async (o) => { Object.assign(data, structuredClone(o)); }, remove: async (ks) => { for (const k of [].concat(ks)) delete data[k]; } };
};
const doc = (text) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
const KEY = 'bb.school.test|_900_1|_101_1|_7_1';

test('one editor\'s saves sent back to back never file its own text as another editor\'s draft', async (t) => {
  const local = memory();
  let clock = 1e12;
  const worker = PA.open(local, () => (clock += 1000), { versions: async () => 40 });
  const was = globalThis.chrome;
  t.after(() => { globalThis.chrome = was; });
  globalThis.chrome = { storage: { local }, runtime: { sendMessage: async (m) => { await new Promise((r) => setTimeout(r, 5)); return { ok: true, value: await worker[m.op](...m.args) }; } } };
  const store = PA.open();
  await store.save(KEY, { doc: doc('First words.') });
  await store.get(KEY);
  // Leaving the page with unsaved typing: visibilitychange then pagehide, each a save, the first not yet answered.
  await Promise.all([store.save(KEY, { doc: doc('First words. More.') }), store.save(KEY, { doc: doc('First words. More, and the end.') })]);
  const reasons = (await worker.versions(KEY)).map((v) => v.reason);
  assert.ok(!reasons.includes('conflict'), `versions: ${reasons.join(', ')}`);
  assert.equal((await worker.get(KEY)).doc.content[0].content[0].text, 'First words. More, and the end.');
});

test('a save that says which revision it builds on keeps a newer one it would replace as a version', async (t) => {
  const local = memory();
  let clock = 1e12;
  const worker = PA.open(local, () => (clock += 1000), { versions: async () => 40 });
  const was = globalThis.chrome;
  t.after(() => { globalThis.chrome = was; });
  globalThis.chrome = { storage: { local }, runtime: { sendMessage: async (m) => ({ ok: true, value: await worker[m.op](...m.args) }) } };
  const store = PA.open();
  const first = (await store.save(KEY, { doc: doc('Mine.') })).paper.revision;
  await worker.save(KEY, { doc: doc('Another tab’s.') });
  await store.get(KEY);
  await store.save(KEY, { doc: doc('Mine, brought back.') }, { base: first });
  const kept = await Promise.all((await worker.versions(KEY)).map((v) => worker.version(KEY, v.id)));
  assert.ok(kept.some((v) => v.reason === 'conflict' && v.doc.content[0].content[0].text === 'Another tab’s.'));
});

// The home page's delete-Undo puts back one key's paper and versions through the worker, from its own tab only.
test('the worker takes merge only from papers.html\'s top frame, for one key\'s two records', async () => {
  const w = require('./helpers/worker-env.cjs')(), EXT = 'chrome-extension://x';
  const home = { id: 'glaze', frameId: 0, url: `${EXT}/papers.html`, origin: EXT, tab: { id: 4, url: `${EXT}/papers.html` } };
  const send = (op, args, s = home) => w.send({ type: 'glaze:writerPapers', op, args }, s);
  for (const k of [PA.newKey(), KEY]) {
    assert.equal((await send('save', [k, { doc: doc('Kept words.'), title: 'Mine', named: true }])).ok, true);
    await send('save', [k, { doc: doc('Kept words, then many more words than before to make a version.') }, { reason: 'import' }]);
    const records = { [`writerPaper:${k}`]: w.store.local[`writerPaper:${k}`], [`writerVersions:${k}`]: w.store.local[`writerVersions:${k}`] };
    assert.equal((await send('remove', [k])).ok, true);
    for (const s of [{ ...home, frameId: 2 }, { ...home, tab: undefined }, { ...home, url: `${EXT}/writer.html` }, { ...home, url: `${EXT}/options.html` }, { ...home, origin: 'https://bb.school.test' }, { ...home, id: 'other' }]) {
      assert.deepEqual(await send('merge', [records], s), { ok: false, error: 'sender' }, JSON.stringify(s));
    }
    const other = PA.newKey();
    for (const bad of [{}, { ...records, [`writerPaper:${other}`]: { ...records[`writerPaper:${k}`], key: other } }, { [`writerPaper:${k}`]: { ...records[`writerPaper:${k}`], key: other } },
      { [`writerVersions:${k}`]: 'not a list' }, { writerPapers: [] }, { 'writerPaper:doc:nope': { key: 'doc:nope' } }, { [`writerPresets:${k}`]: [] }]) {
      assert.deepEqual(await send('merge', [bad]), { ok: false, error: 'bad' }, JSON.stringify(Object.keys(bad)));
    }
    assert.equal(w.store.local[`writerPaper:${k}`], undefined, 'nothing refused was written');
    assert.equal((await send('merge', [records])).ok, true);
    const back = w.store.local[`writerPaper:${k}`];
    assert.deepEqual([back.title, back.named, back.kind, back.doc.content[0].content[0].text], ['Mine', true, 'paper', 'Kept words, then many more words than before to make a version.']);
    assert.ok(w.store.local[`writerVersions:${k}`].some((v) => v.reason === 'import'), 'its versions are back');
    assert.ok(w.store.local.writerPapers.some((r) => r.key === k), 'and its row');
  }
});


test('merge refuses malformed documents and versions before writing any record', async () => {
  const w = require('./helpers/worker-env.cjs')(), k = PA.newKey(), EXT = 'chrome-extension://x';
  const sender = { id: 'glaze', frameId: 0, url: `${EXT}/papers.html`, origin: EXT, tab: { id: 4 } };
  const paper = { key: k, doc: doc('Safe.'), updated: 1, revision: 1 };
  for (const records of [
    { [`writerPaper:${k}`]: { ...paper, doc: { type: 'no-such-node' } } },
    { [`writerPaper:${k}`]: { ...paper, doc: { type: 'doc', content: [{ type: 'text', text: 'invalid block' }] } } },
    { [`writerPaper:${k}`]: { ...paper, updated: 'yesterday' } },
    { [`writerPaper:${k}`]: { ...paper, kind: 'unknown' } },
    { [`writerPaper:${k}`]: paper, [`writerVersions:${k}`]: [null] },
    { [`writerPaper:${k}`]: paper, [`writerVersions:${k}`]: [{ id: 'broken', at: 1, doc: { type: 'no-such-node' } }] },
  ]) {
    assert.deepEqual(await w.send({ type: 'glaze:writerPapers', op: 'merge', args: [records] }, sender), { ok: false, error: 'bad' });
    assert.equal(w.store.local[`writerPaper:${k}`], undefined);
  }
});

test('a page cannot call the worker-only submitted writer through its local store', async (t) => {
  const was = globalThis.chrome; t.after(() => { globalThis.chrome = was; });
  globalThis.chrome = { storage: { local: memory() }, runtime: { sendMessage: async () => { throw Error('unexpected'); } } };
  assert.equal(PA.open().submitted, undefined);
});

// Documents as a page of an LMS tab (features/settingspage.js): each document its frame loads claims a one-use pass that
// Glaze's page got for that tab ('glaze:papers' job), and only that frame, as that document, then writes like the home's
// own tab does: saves, removes and the delete-Undo's merge. A site framing papers.html itself gets no pass.
test('the worker takes papers writes from an LMS tab\'s Documents frame only once its document claims a one-use pass', async () => {
  const EXT = 'chrome-extension://x';
  let w = require('./helpers/worker-env.cjs')();
  const lms = { id: 'glaze', frameId: 0, url: 'https://school.instructure.com/courses/1', origin: 'https://school.instructure.com', tab: { id: 9, url: 'https://school.instructure.com/courses/1' }, documentId: 'top' };
  const frame = { id: 'glaze', frameId: 7, url: `${EXT}/papers.html`, origin: EXT, tab: lms.tab, documentId: 'd1' };
  const k = PA.newKey(), refused = { ok: false, error: 'sender' };
  const papers = (op, args, s) => w.send({ type: 'glaze:writerPapers', op, args }, s);
  const save = (s, text = 'Words.') => papers('save', [k, { doc: doc(text) }], s);
  const job = (pass, s = lms) => w.send({ type: 'glaze:papers', op: 'job', pass }, s);
  const claim = (pass, s = frame) => w.send({ type: 'glaze:papers', op: 'claim', pass }, s);
  const pass = () => crypto.randomUUID();

  assert.deepEqual(await save(frame), refused, 'a papers.html frame that claimed nothing (a site framing it)');
  assert.deepEqual(await papers('remove', [k], frame), refused, 'an unclaimed frame cannot remove');
  assert.deepEqual(await papers('merge', [{ [`writerPaper:${k}`]: { key: k, doc: doc('Unclaimed.'), updated: 1 } }], frame), refused, 'an unclaimed frame cannot merge');
  // Passes: only for the top frame of a page of a site Glaze runs on.
  for (const [s, why] of [[{ ...lms, frameId: 3 }, 'a frame of the page'], [{ ...lms, url: 'https://evil.example/', origin: 'https://evil.example', tab: { id: 9, url: 'https://evil.example/' } }, 'a site Glaze does not run on'],
    [{ ...lms, id: 'other' }, 'another extension'], [{ ...lms, tab: undefined }, 'no tab'], [{ ...frame, frameId: 0 }, "Documents' own tab"]]) {
    assert.deepEqual(await job(pass(), s), { ok: false }, why);
  }
  for (const [s, why] of [[{ ...frame, tab: { id: 10 } }, 'another tab'], [{ ...frame, frameId: 0 }, 'a top frame'], [{ ...frame, url: `${EXT}/options.html` }, 'not Documents'],
    [{ ...frame, url: `${EXT}/writer.html` }, 'the writer frame'], [{ ...frame, origin: 'https://school.instructure.com' }, 'an LMS origin'], [{ ...frame, url: 'https://school.instructure.com/papers.html', origin: 'https://school.instructure.com' }, 'an LMS page']]) {
    const p = pass();
    assert.deepEqual(await job(p), { ok: true });
    assert.deepEqual(await claim(p, s), { ok: false }, why);
    if (s.frameId && !/(options|writer)\.html$/.test(s.url)) assert.deepEqual(await save(s), refused, `then writes nothing: ${why}`);
  }
  // A refused claim from Documents' address spends the pass, as the reader's and the writer's do.
  const spent = pass();
  await job(spent);
  await claim(spent, { ...frame, tab: { id: 10 } });
  assert.deepEqual(await claim(spent), { ok: false }, 'spent by the other tab\'s try');
  assert.deepEqual(await claim(pass()), { ok: false }, 'a made-up pass');
  const p1 = pass();
  assert.deepEqual(await job(p1), { ok: true });
  assert.deepEqual(await w.send({ type: 'glaze:writer', op: 'claim', pass: p1 }, { ...frame, url: `${EXT}/writer.html` }), { ok: false }, "not the writer's");
  assert.deepEqual(await claim(p1), { ok: true });
  assert.deepEqual(await claim(p1), { ok: false }, 'used once');

  assert.equal((await save(frame)).ok, true, 'the claimed frame saves');
  const records = { [`writerPaper:${k}`]: w.store.local[`writerPaper:${k}`], [`writerVersions:${k}`]: w.store.local[`writerVersions:${k}`] };
  assert.equal((await papers('remove', [k], frame)).ok, true, 'and removes');
  assert.equal((await papers('merge', [records], frame)).ok, true, "and puts a delete back (the home's Undo)");
  assert.equal(w.store.local[`writerPaper:${k}`].doc.content[0].content[0].text, 'Words.');
  for (const [s, why] of [[{ ...frame, frameId: 8 }, 'another frame of the tab'], [{ ...frame, documentId: 'd2' }, 'the next document in that frame, before its own claim'],
    [{ ...frame, tab: { id: 10 } }, 'another tab'], [{ ...frame, origin: 'https://school.instructure.com' }, 'an LMS origin'], [{ ...frame, url: lms.url, origin: lms.origin }, "the LMS page's content script"],
    [{ ...frame, id: 'other' }, 'another extension']]) {
    assert.deepEqual(await save(s), refused, why);
    assert.deepEqual(await papers('remove', [k], s), refused, `remove: ${why}`);
    assert.deepEqual(await papers('merge', [records], s), refused, `merge: ${why}`);
  }
  // A document opened in place (papers.html?paper=) is the frame's next document: its own pass, and the one before is done.
  const p2 = pass();
  assert.deepEqual(await job(p2), { ok: true });
  const next = { ...frame, url: `${EXT}/papers.html?paper=${encodeURIComponent(k)}`, documentId: 'd2' };
  assert.deepEqual(await claim(p2, next), { ok: true });
  assert.equal((await save(next, 'Words, typed in place.')).ok, true);
  assert.deepEqual(await save(frame), refused, 'the list it replaced');
  assert.deepEqual(await papers('remove', [k], frame), refused, 'the previous document cannot remove');
  assert.deepEqual(await papers('merge', [records], frame), refused, 'the previous document cannot merge');
  // Settings' frame trust and Documents' are their own: neither lets the other's page write.
  assert.deepEqual(await w.send({ type: 'glaze:courseName', key: 'x' }, { ...next, url: `${EXT}/options.html` }), refused, "a Documents claim is not Settings'");

  // The worker sleeps while the page stays open: the frame it trusted is remembered for that tab until the tab closes.
  w = require('./helpers/worker-env.cjs')({ store: w.store });
  assert.equal((await save(next, 'Words, after the worker woke.')).ok, true);
  assert.deepEqual(await save(frame), refused);
  for (const f of w.removed) f(9);
  await w.settle();
  assert.deepEqual(await save(next), refused, 'the tab closed');
  assert.equal(Object.keys(w.store.session).some((key) => key.startsWith('papersFrame:')), false);
});

test("a browser without document ids (Firefox, Safari) trusts the claimed Documents frame by its tab and frame", async () => {
  const w = require('./helpers/worker-env.cjs')();
  const lms = { id: 'glaze', frameId: 0, url: 'https://school.instructure.com/courses/1', tab: { id: 3, url: 'https://school.instructure.com/courses/1' } };
  const frame = { id: 'glaze', frameId: 2, url: 'chrome-extension://x/papers.html', tab: lms.tab };
  const pass = crypto.randomUUID();
  assert.deepEqual(await w.send({ type: 'glaze:papers', op: 'job', pass }, lms), { ok: true });
  assert.deepEqual(await w.send({ type: 'glaze:papers', op: 'claim', pass }, frame), { ok: true });
  assert.equal((await w.send({ type: 'glaze:writerPapers', op: 'save', args: [PA.newKey(), { doc: doc('Hi.') }] }, frame)).ok, true);
  assert.deepEqual(await w.send({ type: 'glaze:writerPapers', op: 'save', args: [PA.newKey(), { doc: doc('Hi.') }] }, { ...frame, frameId: 5 }), { ok: false, error: 'sender' });
});

test('Documents passes expire, spend every claim attempt, and require the exact extension page even without sender.origin', async () => {
  let now = Date.now();
  const w = require('./helpers/worker-env.cjs')({ globals: { Date: class extends Date { static now() { return now; } } } });
  const host = { id: 'glaze', frameId: 0, url: 'https://school.instructure.com/courses/1', tab: { id: 8 } };
  const frame = { id: 'glaze', frameId: 2, documentId: 'doc', url: 'chrome-extension://x/papers.html', tab: host.tab };
  const job = (pass) => w.send({ type: 'glaze:papers', op: 'job', pass }, host);
  const claim = (pass, s = frame) => w.send({ type: 'glaze:papers', op: 'claim', pass }, s);
  const expired = crypto.randomUUID();
  await job(expired); now += 60001;
  assert.deepEqual(await claim(expired), { ok: false }, 'expires after one minute');
  for (const url of ['chrome-extension://other/papers.html', 'chrome-extension://x.evil/papers.html', 'chrome-extension://x/options.html', 'https://school.instructure.com/papers.html']) {
    const pass = crypto.randomUUID();
    await job(pass);
    assert.deepEqual(await claim(pass, { ...frame, url }), { ok: false }, url);
    assert.deepEqual(await claim(pass), { ok: false }, `the refused claim spent it: ${url}`);
  }
  const pass = crypto.randomUUID();
  assert.equal(await w.send({ type: 'glaze:papers:hello', pass }, host), 'ignored', 'hello cannot issue a pass');
  assert.deepEqual(await claim(pass), { ok: false });
});

test('a replacement Documents claim fences the previous document before persistence and queued writes run', async () => {
  const vm = require('node:vm');
  const w = require('./helpers/worker-env.cjs')();
  const host = { id: 'glaze', frameId: 0, documentId: 'top', url: 'https://school.instructure.com/courses/1', tab: { id: 8 } };
  const frame = { id: 'glaze', frameId: 2, documentId: 'old', url: 'chrome-extension://x/papers.html', tab: host.tab };
  const next = { ...frame, documentId: 'new' }, key = PA.newKey();
  const claim = async (sender) => {
    const pass = crypto.randomUUID();
    await w.send({ type: 'glaze:papers', op: 'job', pass }, host);
    return w.send({ type: 'glaze:papers', op: 'claim', pass }, sender);
  };
  const save = (s) => w.send({ type: 'glaze:writerPapers', op: 'save', args: [key, { doc: doc('Retired.') }] }, s);
  assert.deepEqual(await claim(frame), { ok: true });
  let release;
  const held = new Promise((r) => { release = r; });
  const queue = vm.runInContext('(brokerTurn ||= GZ_CARDS.queue())', w.context);
  const blocking = queue(() => held);
  const queued = save(frame);
  await w.settle();
  const set = w.context.chrome.storage.session.set;
  let persisted;
  w.context.chrome.storage.session.set = async (v) => { if (v['papersFrame:8']) await new Promise((r) => { persisted = r; }); return set(v); };
  try {
    const claiming = claim(next);
    await w.settle();
    assert.equal(typeof persisted, 'function');
    assert.equal(vm.runInContext('trustedFrame', w.context)(frame, 'papers'), false, 'old claim revoked before the new claim settles');
    assert.equal(vm.runInContext('trustedFrame', w.context)(next, 'papers'), false, 'pending claim grants nothing');
    persisted();
    assert.deepEqual(await claiming, { ok: true });
    release(); await blocking;
    assert.deepEqual(await queued, { ok: false, error: 'sender' }, 'a queued write rechecks the document when it runs');
    assert.equal(w.store.local[`writerPaper:${key}`], undefined);
  } finally { persisted?.(); release(); }
});
