// Persistent visual readings are account scoped, content addressed and disposable on corruption.
const test = require('node:test');
const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');
const V = require('../lib/ai/visual-cache.js');

const scope = { school: 'https://school.example', account: 'student-1', assignment: 'course-1/item-2' };
const context = { instructions: 'Describe the chart.', description: 'Assignment description.', rubric: { title: 'Analysis', criteria: [{ id: 'one', points: 10 }] }, locale: 'en' };
const picture = (n = 1) => ({ name: 'chart.png', image: { mime: 'image/png', data: Buffer.from([137, 80, 78, 71, n]).toString('base64') }, context: 'Describe the chart.', contextComplete: true, paper: null });
const reading = (description = 'A chart compares the heights of three bars.') => ({ description, requirements: ['Describe the chart.'], complete: true, reason: '', relevance: 'relevant' });
const store = () => {
  const data = {}, writes = [];
  return { data, writes, async get(key) { return structuredClone({ [key]: data[key] }); }, async set(patch) { writes.push(structuredClone(patch)); Object.assign(data, structuredClone(patch)); return true; } };
};
const make = (area, options = {}) => V.create({ store: area, scope, context, now: () => 1000, crypto: webcrypto, locks: null, ...options });

test('a reading survives a fresh cache instance without persisting image, account or task material', async () => {
  const area = store();
  assert.equal(await make(area).set(picture(), reading()), true);
  assert.deepEqual(await make(area).get(picture()), reading());
  const json = JSON.stringify(area.data);
  for (const text of [scope.school, scope.account, scope.assignment, context.description, picture().image.data, 'chart.png']) assert.equal(json.includes(text), false, text);
  assert.equal(area.data[V.KEY].entries.length, 1);
  assert.match(area.data[V.KEY].entries[0].key, /^[a-f0-9]{64}$/);
});

test('content hashing ignores names and base64 pad bits, but distinguishes actual bytes and MIME', async () => {
  const area = store(), cache = make(area), input = picture();
  await cache.set(input, reading());
  const alternate = input.image.data.replace(/E=$/, 'F=');
  assert.notEqual(alternate, input.image.data);
  assert.deepEqual(Buffer.from(alternate, 'base64'), Buffer.from(input.image.data, 'base64'));
  assert.deepEqual(await cache.get({ ...input, name: 'renamed.png', image: { ...input.image, data: alternate } }), reading());
  assert.deepEqual(await cache.get({ ...input, image: { ...input.image, data: Uint8Array.from(Buffer.from(input.image.data, 'base64')) } }), reading());
  assert.equal(await cache.get(picture(2)), null);
  assert.equal(await cache.get({ ...input, image: { ...input.image, mime: 'image/jpeg' } }), null);
});

test('school, account, assignment, model generation and schema version each isolate cache entries', async () => {
  const area = store();
  await make(area).set(picture(), reading());
  for (const changed of [{ school: 'https://other.example' }, { account: 'student-2' }, { assignment: 'course-1/item-3' }]) {
    assert.equal(await make(area, { scope: { ...scope, ...changed } }).get(picture()), null);
  }
  assert.equal(await make(area, { context: { ...context, generation: 'new-connection' } }).get(picture()), null);
  assert.equal(await make(area, { version: 'writer-image-next' }).get(picture()), null);
  assert.deepEqual(await make(area, { scope: { ...scope, school: 'https://SCHOOL.EXAMPLE:443/' } }).get(picture()), reading());
});

test('full context, locale and helper context completeness invalidate a hit; paper layout does not', async () => {
  const area = store(), input = picture();
  await make(area).set(input, reading());
  for (const changed of [{ instructions: 'Use another chart.' }, { description: 'New description.' }, { rubric: { title: 'New rubric' } }, { locale: 'es' }]) {
    assert.equal(await make(area, { context: { ...context, ...changed } }).get(input), null);
  }
  assert.equal(await make(area).get({ ...input, context: 'A changed compact context.' }), null);
  assert.equal(await make(area).get({ ...input, contextComplete: false }), null);
  assert.deepEqual(await make(area).get({ ...input, paper: { font: 'Arial' } }), reading());
  assert.deepEqual(await make(area, { context: { rubric: { criteria: [{ points: 10, id: 'one' }], title: 'Analysis' }, locale: 'en', description: context.description, instructions: context.instructions } }).get(input), reading());
});

test('cache construction snapshots its verified scope and context', async () => {
  const area = store(), mutableScope = { ...scope }, mutableContext = structuredClone(context);
  const cache = make(area, { scope: mutableScope, context: mutableContext });
  mutableScope.account = 'student-2'; mutableContext.rubric.title = 'Changed';
  await cache.set(picture(), reading());
  assert.deepEqual(await make(area).get(picture()), reading());
  assert.equal(await make(area, { scope: mutableScope, context: mutableContext }).get(picture()), null);
});

test('missing or noncanonical scope and unbounded or non-JSON context disable caching', () => {
  const area = store(), cycle = {}; cycle.self = cycle;
  for (const invalid of [null, {}, { ...scope, account: '' }, { ...scope, account: ' student-1' }, { ...scope, account: 1 }, { ...scope, school: 'https://user:password@school.example' }, { ...scope, school: 'https://school.example/path' }, { ...scope, assignment: 'item\n2' }]) assert.equal(make(area, { scope: invalid }), null);
  for (const invalid of [undefined, cycle, { text: 'x'.repeat(V.LIMIT.context + 1) }, { rubric: new Date() }]) assert.equal(make(area, { context: invalid }), null);
});

test('invalid, unfinished, oversized or unknown-field readings and malformed images never persist', async () => {
  const area = store(), cache = make(area);
  for (const value of [null, {}, { ...reading(), complete: false }, { ...reading(), reason: 'Uncertain' }, { ...reading(), relevance: 'invalid' }, { ...reading(), description: '' }, { ...reading(), description: 'é'.repeat(1100) }, { ...reading(), requirements: ['a'] }, { ...reading(), requirements: ['repeat', 'repeat'] }, { ...reading(), credentials: 'secret' }]) assert.equal(await cache.set(picture(), value), false);
  for (const image of [null, { mime: 'image/png', data: '' }, { mime: 'image/png', data: 'not base64!' }, { mime: 'image/png', data: 'AA==\n' }, { mime: 'image/svg+xml', data: 'AA==' }, { mime: 'image/png', data: 'A'.repeat(V.LIMIT.image + 4) }]) assert.equal(await cache.set({ ...picture(), image }, reading()), false);
  assert.equal(area.writes.length, 0);
});

test('readable observations with uncertain task relevance remain cacheable', async () => {
  const area = store(), cache = make(area), value = { ...reading(), relevance: 'uncertain' };
  assert.equal(await cache.set(picture(), value), true);
  assert.deepEqual(await cache.get(picture()), value);
});

test('corrupt envelopes and entries are safe misses and are replaced by bounded clean records', async () => {
  const area = store(), cache = make(area);
  for (const invalid of [null, 'bad', { schema: 999, entries: [] }, { schema: V.SCHEMA, entries: 'bad' }]) {
    area.data[V.KEY] = invalid;
    assert.equal(await cache.get(picture()), null);
  }
  await cache.set(picture(), reading());
  const entry = structuredClone(area.data[V.KEY].entries[0]);
  for (const changed of [{ value: { ...reading(), credentials: 'secret' } }, { createdAt: -1 }, { usedAt: 1001 }, { key: 'not-a-digest' }]) {
    area.data[V.KEY] = { schema: V.SCHEMA, entries: [{ ...entry, ...changed }] };
    assert.equal(await cache.get(picture()), null);
    assert.equal(await cache.set(picture(2), reading()), true);
    assert.equal(area.data[V.KEY].entries.length, 1);
  }
});

test('expiry is based on creation even after hits, and future timestamps are rejected', async () => {
  const area = store(); let time = 1000;
  const cache = make(area, { now: () => time });
  await cache.set(picture(), reading());
  time += V.LIMIT.age - 1;
  assert.deepEqual(await cache.get(picture()), reading());
  await cache.set(picture(), reading());
  time += 1;
  assert.equal(await cache.get(picture()), null);
  assert.equal(area.data[V.KEY].entries.length, 0, 'an expired record is pruned on the next read');
  time = 999;
  assert.equal(await cache.get(picture()), null);
});

test('LRU eviction bounds all accounts together and a hit preserves the recently used entry', async () => {
  const area = store(); let time = 1000;
  const cache = make(area, { now: () => time++ });
  for (let i = 0; i < V.LIMIT.entries; i++) await cache.set(picture(i), reading());
  await cache.get(picture(0));
  await make(area, { scope: { ...scope, account: 'student-2' }, now: () => time++ }).set(picture(129), reading());
  assert.equal(area.data[V.KEY].entries.length, V.LIMIT.entries);
  assert.equal(await cache.get(picture(1)), null);
  assert.deepEqual(await cache.get(picture(0)), reading());
});

test('LRU keeps the newest insertion when the cache fills within one clock tick', async () => {
  const area = store(), cache = make(area);
  for (let i = 0; i <= V.LIMIT.entries; i++) await cache.set(picture(i), reading());
  assert.equal(area.data[V.KEY].entries.length, V.LIMIT.entries);
  assert.equal(await cache.get(picture(0)), null);
  assert.deepEqual(await cache.get(picture(V.LIMIT.entries)), reading());
});

test('concurrent adapters sharing a store cannot lose writes, and stores stay independent', async () => {
  const one = store(), two = store(), a = make(one), b = make(one), c = make(two);
  await Promise.all(Array.from({ length: 24 }, (_, n) => (n % 2 ? a : b).set(picture(n), reading(`Chart ${n}.`))));
  assert.equal(one.data[V.KEY].entries.length, 24);
  await c.set(picture(), reading('Other store.'));
  assert.equal(two.data[V.KEY].entries.length, 1);
  assert.deepEqual(await c.get(picture()), reading('Other store.'));
  assert.deepEqual(await a.get(picture()), reading('Chart 1.'));
});

test('browser locks protect transactions across separately loaded worker modules', async () => {
  const area = store(); let tail = Promise.resolve(), calls = 0;
  const locks = { request(name, work) { assert.equal(name, V.LOCK); calls++; const p = tail.then(work); tail = p.catch(() => {}); return p; } };
  const path = require.resolve('../lib/ai/visual-cache.js'); delete require.cache[path];
  const fresh = require(path);
  await Promise.all([make(area, { locks }).set(picture(1), reading()), fresh.create({ store: area, scope, context, now: () => 1000, crypto: webcrypto, locks }).set(picture(2), reading())]);
  assert.equal(area.data[V.KEY].entries.length, 2);
  assert.equal(calls, 2);
});

test('storage or crypto failures stay optional, and cancellation prevents delayed writes', async () => {
  const unavailable = { async get() { throw new Error('unavailable'); }, async set() { throw new Error('unavailable'); } };
  assert.equal(await make(unavailable).get(picture()), null);
  assert.equal(await make(unavailable).set(picture(), reading()), false);
  assert.equal(await make(store(), { crypto: { subtle: { async digest() { throw new Error('unavailable'); } } } }).get(picture()), null);
  const area = store(), controller = new AbortController();
  let release; const blocked = new Promise((resolve) => { release = resolve; });
  const cache = make(area, { signal: controller.signal, locks: { request: async (_name, work) => { await blocked; return work(); } } });
  const pending = cache.set(picture(), reading());
  controller.abort(); release();
  assert.equal(await pending, false);
  assert.equal(area.writes.length, 0);
});

const incomplete = () => ({ description: 'The image could not be read completely.', requirements: [], complete: false, reason: 'The small text is unreadable.', relevance: 'uncertain' });

test('incomplete readings are shared across adapters only in memory and expire after 30 seconds', async () => {
  const area = store(); let time = 1000;
  const cache = make(area, { now: () => time });
  assert.equal(await cache.setFailure(picture(), incomplete()), true);
  assert.deepEqual(await make(area).getFailure(picture()), incomplete());
  assert.equal(await cache.get(picture()), null);
  assert.equal(area.writes.length, 0);
  time += 29999;
  assert.deepEqual(await cache.getFailure(picture()), incomplete());
  await cache.setFailure(picture(), incomplete());
  time += 1;
  assert.equal(await cache.getFailure(picture()), null, 'hits and repeated bookkeeping do not renew the failure guard');
});

test('transient failures use exactly the same scope, context, byte identity and store isolation', async () => {
  const area = store(), cache = make(area);
  await cache.setFailure(picture(), incomplete());
  assert.deepEqual(await cache.getFailure({ ...picture(), name: 'renamed.png', paper: { font: 'Arial' } }), incomplete());
  assert.equal(await cache.getFailure(picture(2)), null);
  assert.equal(await cache.getFailure({ ...picture(), contextComplete: false }), null);
  for (const options of [{ scope: { ...scope, school: 'elsewhere.example' } }, { scope: { ...scope, account: 'student-2' } }, { scope: { ...scope, assignment: 'elsewhere' } }, { context: { ...context, locale: 'fr' } }, { version: 'next-schema' }]) assert.equal(await make(area, options).getFailure(picture()), null);
  assert.equal(await make(store()).getFailure(picture()), null);
  const path = require.resolve('../lib/ai/visual-cache.js'); delete require.cache[path];
  const fresh = require(path).create({ store: area, scope, context, crypto: webcrypto, now: () => 1000, locks: null });
  assert.equal(await fresh.getFailure(picture()), null, 'a worker restart does not restore failure guards');
});

test('transient failure guard accepts only bounded explicit incomplete readings with a reason', async () => {
  const area = store(), cache = make(area);
  for (const value of [null, reading(), { ...incomplete(), complete: undefined }, { ...incomplete(), reason: '' }, { ...incomplete(), reason: '   ' }, { ...incomplete(), reason: 'x'.repeat(201) }, { ...incomplete(), relevance: 'irrelevant' }, { ...incomplete(), description: 'é'.repeat(1100) }, { ...incomplete(), credentials: 'secret' }]) assert.equal(await cache.setFailure(picture(), value), false);
  assert.equal(await cache.setFailure(picture(), { ...incomplete(), relevance: 'relevant' }), true);
  assert.equal(await cache.set(picture(), incomplete()), false, 'incomplete readings never enter persistent storage');
  assert.equal(area.writes.length, 0);
});

test('successful persistence clears the matching failure guard but a rejected write does not', async () => {
  const area = store(), cache = make(area);
  await cache.setFailure(picture(), incomplete()); await cache.setFailure(picture(2), incomplete());
  const save = area.set; area.set = async () => false;
  assert.equal(await cache.set(picture(), reading()), false);
  assert.deepEqual(await cache.getFailure(picture()), incomplete());
  area.set = save;
  assert.equal(await cache.set(picture(), reading()), true);
  assert.equal(await cache.getFailure(picture()), null);
  assert.deepEqual(await cache.getFailure(picture(2)), incomplete());
});

test('transient failure guards have bounded LRU capacity across accounts', async () => {
  const area = store(), cache = make(area);
  for (let i = 0; i < 128; i++) await cache.setFailure(picture(i), incomplete());
  await cache.getFailure(picture(0));
  await make(area, { scope: { ...scope, account: 'student-2' } }).setFailure(picture(129), incomplete());
  assert.equal(await cache.getFailure(picture(1)), null);
  assert.deepEqual(await cache.getFailure(picture(0)), incomplete());
  assert.equal(area.writes.length, 0);
});

test('cancellation while hashing prevents transient failure writes', async () => {
  const area = store(), controller = new AbortController();
  let release; const blocked = new Promise((resolve) => { release = resolve; });
  const crypto = { subtle: { digest: async (...args) => { await blocked; return webcrypto.subtle.digest(...args); } } };
  const cache = make(area, { crypto, signal: controller.signal });
  const pending = cache.setFailure(picture(), incomplete());
  controller.abort(); release();
  assert.equal(await pending, false);
  assert.equal(await cache.getFailure(picture()), null);
  assert.equal(await make(area).getFailure(picture()), null);
  assert.equal(area.writes.length, 0);
});

test('an active assignment lease keeps an early image failure through a later slow image', async () => {
  const area = store(); let time = 1000;
  const options = { now: () => time }, cache = make(area, options);
  const release = await cache.hold();
  await cache.setFailure(picture(1), incomplete());
  time += 31000;
  assert.deepEqual(await make(area, options).getFailure(picture(1)), incomplete());
  release();
  time += 29999;
  assert.deepEqual(await cache.getFailure(picture(1)), incomplete());
  time += 1;
  assert.equal(await cache.getFailure(picture(1)), null);
});

test('consecutive image and Feedback leases carry failures through the joined batch', async () => {
  const area = store(); let time = 1000;
  const options = { now: () => time }, first = make(area, options);
  const doneFirst = await first.hold();
  await first.setFailure(picture(), incomplete());
  doneFirst(); time += 1;
  const second = make(area, options), doneSecond = await second.hold();
  time += 31000;
  doneSecond(); time += 1;
  const feedback = make(area, options), doneFeedback = await feedback.hold();
  assert.deepEqual(await feedback.getFailure(picture()), incomplete());
  time += 31000;
  assert.deepEqual(await feedback.getFailure(picture()), incomplete());
  doneFeedback(); time += 31000;
  const retry = make(area, options), doneRetry = await retry.hold();
  assert.equal(await retry.getFailure(picture()), null, 'a new lease after the idle retry period must not revive an old failure');
  doneRetry();
});

test('an active lease never extends a failure beyond its absolute retention bound', async () => {
  const area = store(); let time = 1000;
  const cache = make(area, { now: () => time }), release = await cache.hold();
  await cache.setFailure(picture(), incomplete());
  time += 15 * 60 * 1000 - 1;
  assert.deepEqual(await cache.getFailure(picture()), incomplete());
  time += 1;
  assert.equal(await cache.getFailure(picture()), null);
  release();
});

test('another account or context lease does not keep an idle failure alive', async () => {
  for (const changed of [{ scope: { ...scope, account: 'student-2' } }, { context: { ...context, locale: 'fr' } }]) {
    const area = store(); let time = 1000;
    const cache = make(area, { now: () => time });
    await cache.setFailure(picture(), incomplete());
    const other = make(area, { ...changed, now: () => time }), release = await other.hold();
    time += 31000;
    assert.equal(await cache.getFailure(picture()), null);
    release();
  }
});

test('aborting a lease releases it and repeated release cannot postpone idle expiry', async () => {
  const { getEventListeners } = require('node:events');
  const area = store(), controller = new AbortController(); let time = 1000;
  const options = { now: () => time }, cache = make(area, { ...options, signal: controller.signal });
  const release = await cache.hold();
  assert.equal(getEventListeners(controller.signal, 'abort').length, 1);
  await cache.setFailure(picture(), incomplete());
  time += 31000; controller.abort();
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  assert.deepEqual(await make(area, options).getFailure(picture()), incomplete());
  time += 29999; release(); release();
  time += 1;
  assert.equal(await make(area, options).getFailure(picture()), null);
});

test('overlapping leases release independently and bounded groups never resurrect an evicted guard', async () => {
  const area = store(); let time = 1000;
  const cache = make(area, { now: () => time }), one = await cache.hold(), two = await cache.hold();
  await cache.setFailure(picture(), incomplete());
  one(); one(); time += 31000;
  assert.deepEqual(await cache.getFailure(picture()), incomplete());
  const releases = [];
  for (let n = 0; n < 128; n++) releases.push(await make(area, { scope: { ...scope, assignment: `other-${n}` }, now: () => time }).hold());
  assert.equal(await cache.getFailure(picture()), null, 'the oldest group is evicted at the bounded group capacity');
  two();
  assert.equal(await cache.getFailure(picture()), null, 'a stale release cannot recreate an evicted group');
  releases.forEach((release) => release());
});

test('cancellation during lease setup returns a harmless release without a live abort listener', async () => {
  const { getEventListeners } = require('node:events');
  const area = store(), controller = new AbortController(); let time = 1000;
  let unblock; const blocked = new Promise((resolve) => { unblock = resolve; });
  const crypto = { subtle: { digest: async (...args) => { await blocked; return webcrypto.subtle.digest(...args); } } };
  const pending = make(area, { crypto, signal: controller.signal, now: () => time }).hold();
  controller.abort(); unblock();
  const release = await pending;
  release(); release();
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  const cache = make(area, { now: () => time });
  await cache.setFailure(picture(), incomplete());
  time += 31000;
  assert.equal(await cache.getFailure(picture()), null, 'the cancelled setup did not leave an active group hold');
});
