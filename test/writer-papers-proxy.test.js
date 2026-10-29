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

test('paper pages have no merge write or local backup replay entry point', async (t) => {
  const w = require('./helpers/worker-env.cjs')(), EXT = 'chrome-extension://x';
  for (const page of ['papers.html', 'writer.html', 'options.html']) {
    assert.deepEqual(await w.send({ type: 'glaze:writerPapers', op: 'merge', args: [{}] },
      { id: 'glaze', frameId: 0, url: `${EXT}/${page}`, tab: { id: 4 } }), { ok: false, error: 'sender' });
  }
  const was = globalThis.chrome; t.after(() => { globalThis.chrome = was; });
  globalThis.chrome = { storage: { local: memory() }, runtime: { sendMessage: async () => { throw Error('unexpected'); } } };
  assert.equal(PA.open().merge, undefined);
  assert.equal(PA.one, undefined);
});

test('a page cannot call the worker-only submitted writer through its local store', async (t) => {
  const was = globalThis.chrome; t.after(() => { globalThis.chrome = was; });
  globalThis.chrome = { storage: { local: memory() }, runtime: { sendMessage: async () => { throw Error('unexpected'); } } };
  assert.equal(PA.open().submitted, undefined);
});

// Documents as a page of an LMS tab (features/settingspage.js): each document its frame loads claims a one-use pass that
// Glaze's page got for that tab ('glaze:papers' job), and only that frame, as that document, then writes like the home's
// own tab does: saves, removes and Trash/Restore. A site framing papers.html itself gets no pass.
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
  assert.deepEqual(await papers('untrash', [k], frame), refused, 'an unclaimed frame cannot untrash');
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
  assert.equal((await papers('trash', [k], frame)).ok, true, 'and trashes');
  assert.equal((await papers('untrash', [k], frame)).ok, true, 'and undoes the delete');
  assert.deepEqual(await papers('purge', [], frame), { ok: true, value: [] });
  assert.equal((await papers('remove', [k], frame)).ok, true, 'and removes');
  await save(frame);
  for (const [s, why] of [[{ ...frame, frameId: 8 }, 'another frame of the tab'], [{ ...frame, documentId: 'd2' }, 'the next document in that frame, before its own claim'],
    [{ ...frame, tab: { id: 10 } }, 'another tab'], [{ ...frame, origin: 'https://school.instructure.com' }, 'an LMS origin'], [{ ...frame, url: lms.url, origin: lms.origin }, "the LMS page's content script"],
    [{ ...frame, id: 'other' }, 'another extension']]) {
    assert.deepEqual(await save(s), refused, why);
    for (const [op, args] of [['trash', [k]], ['untrash', [k]], ['purge', []], ['remove', [k]]]) {
      assert.deepEqual(await papers(op, args, s), refused, `${op}: ${why}`);
    }
  }
  // A document opened in place (papers.html?paper=) is the frame's next document: its own pass, and the one before is done.
  const p2 = pass();
  assert.deepEqual(await job(p2), { ok: true });
  const next = { ...frame, url: `${EXT}/papers.html?paper=${encodeURIComponent(k)}`, documentId: 'd2' };
  assert.deepEqual(await claim(p2, next), { ok: true });
  assert.equal((await save(next, 'Words, typed in place.')).ok, true);
  assert.deepEqual(await save(frame), refused, 'the list it replaced');
  assert.deepEqual(await papers('remove', [k], frame), refused, 'the previous document cannot remove');
  assert.deepEqual(await papers('untrash', [k], frame), refused, 'the previous document cannot untrash');
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

// The Documents home's Trash (S3b): Delete, Undo, Restore and the purge on opening go through the worker, as every paper
// write does; on browser startup the worker purges too, beside its other sweeps.
test('the worker takes trash, untrash and purge from Glaze\'s paper pages, and purges past 30 days on startup', async () => {
  const DAY = 864e5, now = Date.now(), EXT = 'chrome-extension://x', [old, recent, live] = [PA.newKey(), PA.newKey(), PA.newKey()];
  const rec = (k, trashed) => ({ key: k, kind: 'paper', named: true, title: k, doc: doc('Words.'), format: 'plain', updated: 1, revision: 1, ...(trashed && { trashed }) });
  const row = (r) => ({ key: r.key, kind: 'paper', named: true, title: r.title, course: '', url: '', words: 1, format: 'plain', updated: 1, submitted: null, ...(r.trashed && { trashed: r.trashed }) });
  const recs = [rec(old, now - 31 * DAY), rec(recent, now - 29 * DAY), rec(live)];
  const local = { ultra: [], writerPapers: recs.map(row), ...Object.fromEntries(recs.flatMap((r) => [[`writerPaper:${r.key}`, r], [`writerVersions:${r.key}`, [{ id: 'v1-aaaaaa', at: 1, reason: 'start', words: 1, bytes: 10, doc: doc('Words.') }]]])) };
  const w = require('./helpers/worker-env.cjs')({ store: { sync: { version: 2, enabled: true, enhance: {} }, local, session: {} } });
  await w.settle();
  assert.ok(w.store.local[`writerPaper:${old}`], 'worker initialization runs no startup purge');
  for (const fn of w.startup) fn();
  await w.settle();
  assert.deepEqual([w.store.local[`writerPaper:${old}`], w.store.local[`writerVersions:${old}`]], [undefined, undefined], 'past 30 days: gone with its versions');
  assert.ok(w.store.local[`writerPaper:${recent}`] && w.store.local[`writerVersions:${recent}`] && w.store.local[`writerPaper:${live}`], '29 days, and what is not trashed, stay');
  assert.deepEqual(w.store.local.writerPapers.map((r) => r.key).sort(), [recent, live].sort());

  const home = { id: 'glaze', frameId: 0, url: `${EXT}/papers.html`, origin: EXT, tab: { id: 4, url: `${EXT}/papers.html` } };
  const send = (op, args, s = home) => w.send({ type: 'glaze:writerPapers', op, args }, s);
  for (const s of [{ ...home, tab: undefined }, { ...home, url: `${EXT}/options.html` }, { ...home, origin: 'https://bb.school.test' }, { ...home, id: 'other' }]) {
    for (const [op, args] of [['trash', [live]], ['untrash', [recent]], ['purge', []]]) assert.deepEqual(await send(op, args, s), { ok: false, error: 'sender' }, `${op} ${JSON.stringify(s)}`);
  }
  assert.ok(w.store.local[`writerPaper:${live}`], 'waking the worker alone runs no purge');
  const writer = { ...home, url: `${EXT}/writer.html`, frameId: 2 };
  for (const [op, args] of [['trash', [live]], ['untrash', [live]], ['purge', []]]) assert.equal((await send(op, args, writer)).ok, true, `writer: ${op}`);
  const trashed = await send('trash', [live]);
  assert.equal(trashed.ok, true);
  assert.equal(w.store.local[`writerPaper:${live}`].trashed, trashed.value.trashed);
  assert.equal(w.store.local.writerPapers.find((r) => r.key === live).trashed, trashed.value.trashed);
  assert.deepEqual(await send('purge', []), { ok: true, value: [] });
  // Documents inside a school's page (features/settingspage.js): its frame writes to the Trash once it claimed its pass.
  const lms = { id: 'glaze', frameId: 0, url: 'https://school.instructure.com/courses/1', origin: 'https://school.instructure.com', tab: { id: 9, url: 'https://school.instructure.com/courses/1' }, documentId: 'top' };
  const frame = { id: 'glaze', frameId: 7, url: `${EXT}/papers.html`, origin: EXT, tab: lms.tab, documentId: 'd1' };
  assert.deepEqual(await send('untrash', [live], frame), { ok: false, error: 'sender' }, 'a frame that claimed nothing');
  const pass = crypto.randomUUID();
  assert.deepEqual(await w.send({ type: 'glaze:papers', op: 'job', pass }, lms), { ok: true });
  assert.deepEqual(await w.send({ type: 'glaze:papers', op: 'claim', pass }, frame), { ok: true });
  assert.deepEqual(await send('untrash', [live], frame), { ok: true, value: { key: live } });
  assert.equal('trashed' in w.store.local[`writerPaper:${live}`], false);
  assert.equal((await send('trash', [recent], frame)).ok, true);
  assert.deepEqual(await send('purge', [], frame), { ok: true, value: [] });
  assert.deepEqual(await send('trash', [live], { ...frame, frameId: 8 }), { ok: false, error: 'sender' }, 'another frame of the tab');
});

test('the page\'s store sends trash, untrash and purge to the worker, never writing them itself', async (t) => {
  const was = globalThis.chrome; t.after(() => { globalThis.chrome = was; });
  const sent = [];
  globalThis.chrome = { storage: { local: { get: async () => ({}), set: async () => { throw Error('a page write'); }, remove: async () => { throw Error('a page write'); } } },
    runtime: { sendMessage: async (m) => { sent.push([m.op, m.args]); return { ok: true, value: m.op === 'purge' ? [] : { key: m.args[0] } }; } } };
  const store = PA.open(), k = PA.newKey();
  await store.trash(k); await store.untrash(k); await store.purge();
  assert.deepEqual(sent, [['trash', [k]], ['untrash', [k]], ['purge', []]]);
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

test('Delete forever and startup/page purges preserve a paper while its submit permit is held', async () => {
  const make = require('./helpers/worker-env.cjs'), k = KEY;
  for (const scheme of ['https', 'http']) {
    let w = make();
    const sender = { id: 'glaze', frameId: 0, url: 'chrome-extension://x/papers.html', tab: { id: 4 } };
    const send = (op, args) => w.send({ type: 'glaze:writerPapers', op, args }, sender);
    await send('save', [k, { doc: doc('The submitted draft.'), format: 'plain' }, { reason: 'sending' }]);
    await send('trash', [k]);
    const permit = `writerSubmit:${scheme}://${k}`;
    w.store.local[permit] = { run: { token: 'a'.repeat(36), owner: '1|doc', until: Date.now() - 1000 }, sent: [] };
    const before = structuredClone(w.store.local);
    assert.deepEqual(await send('remove', [k]), { ok: false, error: 'submit in progress' });
    assert.deepEqual(w.store.local, before, 'a refusal changes no records');
    const old = Date.now() - 31 * 864e5;
    w.store.local[`writerPaper:${k}`].trashed = old;
    w.store.local.writerPapers[0].trashed = old;
    assert.deepEqual(await send('purge', []), { ok: true, value: [] });
    w = make({ store: w.store });
    for (const f of w.startup) f();
    await w.settle();
    assert.ok(w.store.local[`writerPaper:${k}`] && w.store.local[`writerVersions:${k}`], 'the permit survives a worker restart');
    w.store.local[permit].run = null;
    assert.deepEqual(await send('purge', []), { ok: true, value: [k] });
    assert.equal(w.store.local[`writerPaper:${k}`], undefined);
    assert.equal(w.store.local[`writerVersions:${k}`], undefined);
  }
});
