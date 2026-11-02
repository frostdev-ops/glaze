// Canonical Markdown memory, account boundaries, sync convergence and interrupted automatic writes.
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../../extension/ai/memory.js');
const A = 'https://school.example/5', B = 'https://school.example/6', U = 'https://ultra.example/_5_1';
const id = (n, kind = 'memory') => `${kind === 'memory' ? 'm' : 's'}-${n.toString(16).padStart(32, '0')}`;
const revision = (n) => n.toString(16).padStart(32, '0');
const record = (n = 1, extra = {}) => ({ v: 1, id: id(n), account: A, kind: 'memory', markdown: '# Preference\n\nUse short paragraphs.', createdAt: 100, updatedAt: 100, revision: revision(n), source: { type: 'user-message', evidence: 'Use short paragraphs.' }, ...extra });
const area = (initial = {}) => {
  const data = structuredClone(initial); let fail = false;
  return { data, get fail() { return fail; }, set fail(v) { fail = v; },
    async get(keys) { if (fail) throw Error('storage'); return structuredClone(keys === null ? data : Object.fromEntries([].concat(keys).filter((k) => Object.hasOwn(data, k)).map((k) => [k, data[k]]))); },
    async set(patch) { if (fail) return false; Object.assign(data, structuredClone(patch)); return true; },
  };
};
const make = (local, extra = {}) => { let n = 1000; return M.create({ local, now: () => 1000, random: () => revision(++n), ...extra }); };
const save = (s, account = A, text = 'Use short paragraphs.', options = {}) => s.save(account, { text, evidence: text }, { question: text, ...options });
const source = (extra = {}) => ({ type: 'course-read', tool: 'content_read', course: '7', id: '8', page: 1, observedAt: 500, complete: true, title: 'Titration notes', ...extra });

test('keys strictly bind canonical school account, kind and 32-hex id', () => {
  const k = M.keyOf(A, id(1));
  assert.equal(k, `rimeMemory:${A}|${id(1)}`);
  assert.deepEqual(M.parseKey(k), { account: A, id: id(1), kind: 'memory' });
  assert.equal(M.parseKey(M.keyOf(U, id(2, 'course'))).kind, 'course');
  for (const account of ['', 'https://school.example/anon', 'https://SCHOOL.example/5', 'https://user:pass@school.example/5', 'https://school.example/path/5', 'https://school.example:443/5', 'https://school.example/5/']) assert.equal(M.keyOf(account, id(1)), null, account);
  for (const key of [`rimeMemory:${A}|${id(1, 'course')}`, `${k}extra`, k.toUpperCase(), `rimeMaterial:${A}|${id(1)}`]) assert.equal(M.parseKey(key), null, key);
});

test('strict envelope rejects unknown authority fields, wrong provenance and contentful tombstones', () => {
  const r = record(), k = M.keyOf(A, r.id);
  assert.deepEqual(M.clean(r, k), r);
  for (const change of [{ account: B }, { id: id(2) }, { kind: 'course' }, { revision: '1' }, { markdown: 'x'.repeat(M.LIMIT.memory + 1) }, { markdown: ' ' }, { updatedAt: 99 }, { createdAt: NaN }, { edited: false }, { approved: true }, { source: { type: 'user-message', evidence: 'Use short paragraphs.', url: 'https://example.test' } }]) assert.equal(M.clean({ ...r, ...change }, k), null);
  const gone = { v: 1, id: r.id, account: A, kind: 'memory', createdAt: 100, updatedAt: 101, revision: revision(9), deleted: true };
  assert.deepEqual(M.clean(gone, k), gone);
  assert.equal(M.clean({ ...gone, markdown: '' }, k), null);
  assert.equal(M.clean({ ...gone, source: r.source }, k), null);
  assert.equal(M.clean({ ...gone, id: 'bad', kind: null }), null);
  assert.equal(M.clean({ ...r, category: 'preference' }).category, 'preference');
});

test('merge is convergent, accepts absent records and deletion dominates all older or newer content', () => {
  const a = record(), b = record(1, { markdown: 'A different preference.', updatedAt: 200, revision: revision(2) });
  const gone = { v: 1, id: a.id, account: A, kind: 'memory', createdAt: 100, updatedAt: 101, revision: revision(3), deleted: true };
  assert.deepEqual(M.merge(undefined, a), a);
  assert.deepEqual(M.merge(a, null), a);
  assert.deepEqual(M.merge(a, b), b);
  assert.deepEqual(M.merge(b, a), b);
  assert.deepEqual(M.merge(gone, b), gone);
  assert.deepEqual(M.merge(b, gone), gone);
  const tie = { ...a, markdown: 'Same timestamp, different text.' };
  assert.deepEqual(M.merge(tie, a), M.merge(a, tie));
  assert.equal(M.merge(a, { ...b, account: B }), null);
  assert.equal(M.merge(a, { ...b, authority: true }), null);
});

test('saves require current evidence and survive reopening without crossing accounts', async () => {
  const local = area(), s = make(local);
  assert.deepEqual(await s.save(A, { text: 'I prefer essays.', evidence: 'I prefer essays.' }, { question: 'What is due?' }), { ok: false, error: 'evidence' });
  assert.equal((await save(s, 'unknown')).error, 'scope');
  const r = await save(s);
  assert.equal(r.ok, true); assert.equal(r.receipt.operation, 'created'); assert.equal(r.receipt.persistence, 'device');
  assert.match(r.receipt.revision, /^[a-f0-9]{32}$/);
  assert.equal((await make(local).list(A)).items.length, 1);
  assert.equal((await s.list(B)).items.length, 0);
  assert.equal((await s.read(B, r.receipt.id)).error, 'not-found');
  assert.equal((await save(s)).receipt.operation, 'unchanged');
});

test('optimistic updates serialize across instances, and automatic replacement preserves user edits', async () => {
  const local = area(), first = make(local), second = make(local);
  const a = await save(first), pair = { id: a.receipt.id, revision: a.receipt.revision };
  const results = await Promise.all([first.edit(A, { ...pair, markdown: 'Use short sentences.' }), second.edit(A, { ...pair, markdown: 'Use plain words.' })]);
  assert.equal(results.filter((r) => r.ok).length, 1);
  assert.equal(results.find((r) => !r.ok).error, 'conflict');
  const current = (await first.list(A)).items[0];
  assert.equal(current.source.evidence, current.markdown);
  const args = { id: current.id, revision: current.revision, text: 'Prefer tables.', evidence: 'Prefer tables.' };
  assert.equal((await first.save(A, args, { question: args.evidence })).error, 'conflict');
  assert.equal((await first.save(A, args, { question: args.evidence, explicitCorrection: true })).ok, true);
});

test('forget keeps no content and defeats incoming sync updates and direct CAS revival', async () => {
  const local = area(), s = make(local), r = await save(s), k = M.keyOf(A, r.receipt.id), old = structuredClone(local.data[k]);
  assert.equal((await s.forget(A, { id: old.id, revision: old.revision })).receipt.operation, 'forgotten');
  const gone = structuredClone(local.data[k]);
  assert.equal(Object.hasOwn(gone, 'markdown'), false); assert.equal(Object.hasOwn(gone, 'source'), false);
  assert.equal((await M.apply({ local }, k, { ...old, updatedAt: 999999 })).record.deleted, true);
  assert.equal(await M.replace({ local }, k, gone, { ...old, updatedAt: 999999 }), false);
  assert.equal((await s.search(A, 'paragraphs')).items.length, 0);
});

test('course source identities are deterministic, page aware and forgotten source ids never reingest', async () => {
  const local = area(), s = make(local), material = { source: source(), markdown: '# Titration\n\nMeasure acid concentration.' };
  const first = await s.ingest(A, material), again = await s.ingest(A, material);
  assert.equal(first.ok, true); assert.equal(again.receipt.operation, 'unchanged');
  assert.equal(first.receipt.id, again.receipt.id);
  assert.notEqual((await s.ingest(A, { ...material, source: source({ page: 2 }) })).receipt.id, first.receipt.id);
  const r = (await s.list(A, { kind: 'course' })).items.find((v) => v.id === first.receipt.id);
  assert.equal((await s.forget(A, r)).ok, true);
  assert.equal((await s.ingest(A, material)).error, 'not-found');
  const partial = await s.ingest(A, { source: source({ id: '9', complete: false }), markdown: 'Partly read.' });
  assert.equal((await s.read(A, partial.receipt.id)).source.complete, false);
});

test('partial refresh cannot overwrite a complete source or falsely advance its observation time', async () => {
  const local = area(), s = make(local), a = await s.ingest(A, { source: source(), markdown: 'Whole chapter.' });
  const b = await s.ingest(A, { source: source({ complete: false, observedAt: 800 }), markdown: 'Partial chapter.' });
  assert.equal(b.receipt.operation, 'unchanged');
  const r = await s.read(A, a.receipt.id);
  assert.equal(r.text, 'Whole chapter.'); assert.equal(r.source.observedAt, 500);
});

test('lease invalidation rejects pending automatic saves and ingestion across clear or off', async () => {
  const local = area(), s = make(local), lease = s.lease(A);
  assert.equal(s.validateLease(A, lease), true); assert.equal(s.validateLease(B, lease), false);
  await s.invalidate(A);
  assert.equal(s.validateLease(A, lease), false);
  assert.equal((await save(s, A, 'Prefer tables.', { lease })).error, 'scope');
  assert.equal((await s.ingest(A, { source: source(), markdown: 'Chapter' }, { lease })).error, 'scope');
  const newLease = s.lease(A);
  await s.clear(A, { kind: 'course' });
  assert.equal(s.validateLease(A, newLease), false);
});

test('lexical retrieval finds relevant passages, is bounded, Unicode aware and account scoped', async () => {
  const local = area(), s = make(local);
  await save(s, A, 'Prefiero español y párrafos breves.');
  await save(s, B, 'Secret Spanish facts.');
  await s.ingest(A, { source: source(), markdown: '# Chemistry\n\n' + 'Background. '.repeat(1000) + '\n\nTitration measures acid concentration.' });
  const spanish = await s.search(A, 'ESPAÑOL'); assert.equal(spanish.items.length, 1);
  const found = await s.search(A, 'acid concentration', { kind: 'course', maxChars: 120 });
  assert.equal(found.items.length, 1); assert.match(found.items[0].text, /acid concentration/); assert.ok(found.items[0].text.length <= 120);
  assert.equal((await s.search(A, 'Spanish')).items.length, 0);
  assert.equal((await s.search(A, 'not present')).items.length, 0);
  assert.equal((await s.search(A, 'acid', { course: '99' })).items.length, 0);
  assert.equal((await s.search(A, 'x'.repeat(M.LIMIT.query + 1))).ok, false);
});

test('reads page safely and used revisions can be revalidated before a final answer', async () => {
  const local = area(), s = make(local), a = await s.ingest(A, { source: source(), markdown: 'x'.repeat(2401) });
  const r = await s.read(A, a.receipt.id, { page: 2 }); assert.equal(r.text.length, 1200); assert.equal(r.pages, 3);
  assert.equal(await s.current(A, [{ id: a.receipt.id, revision: a.receipt.revision }]), true);
  assert.equal((await s.read(A, a.receipt.id, { page: 4 })).error, 'not-found');
  await s.forget(A, { id: a.receipt.id, revision: a.receipt.revision });
  assert.equal(await s.current(A, [{ id: a.receipt.id, revision: a.receipt.revision }]), false);
});

test('pre-turn recall includes a saved preference without changing ordinary lexical searches', async () => {
  const local = area(), s = make(local), preference = 'Use short paragraphs.';
  const a = await s.save(A, { text: preference, evidence: preference, category: 'preference' }, { question: preference });
  await save(s, A, 'I study chemistry.');
  assert.equal((await s.search(A, 'photosynthesis')).items.length, 0);
  const recall = await s.search(A, 'photosynthesis', { limit: 3, includePreferences: true });
  assert.deepEqual(recall.items.map((r) => r.id), [a.receipt.id]);
  assert.equal(recall.items[0].category, 'preference');
  assert.equal(recall.items.length <= 3, true);
  assert.equal((await s.search(B, 'photosynthesis', { includePreferences: true })).items.length, 0);
});

test('aggregate caps refuse automatic memory saves without evicting any saved record', async () => {
  const initial = Object.fromEntries(Array.from({ length: M.LIMIT.memories }, (_, n) => { const r = record(n + 1); return [M.keyOf(A, r.id), r]; }));
  const local = area(initial), s = make(local);
  assert.equal(M.fits(initial), true);
  assert.equal((await save(s, A, 'Another preference.')).error, 'limit');
  assert.deepEqual(local.data, initial);
  assert.equal(M.fits({ ...initial, [M.keyOf(A, id(9999))]: record(9999) }), false);
});

test('Settings lists all accounts but ambiguous ids never select an arbitrary owner', async () => {
  const local = area(), s = make(local);
  const a = await save(s), b = await save(s, B, 'Use tables.');
  assert.equal((await s.listAll()).items.length, 2);
  assert.equal((await s.resolveById(a.receipt.id)).record.account, A);
  const r = record(77), duplicate = { ...r, account: B };
  Object.assign(local.data, { [M.keyOf(A, r.id)]: r, [M.keyOf(B, r.id)]: duplicate });
  assert.equal((await s.resolveById(r.id)).error, 'scope');
  const before = (await s.list(B)).items.find((r) => r.id === b.receipt.id);
  await s.edit(B, { id: before.id, revision: before.revision, markdown: 'Use prose.' });
  const result = await s.clearAll({ kind: 'memory', snapshot: [{ id: a.receipt.id, revision: a.receipt.revision }, { id: b.receipt.id, revision: b.receipt.revision }] });
  assert.equal(result.ok, true); assert.equal(result.conflicts, 1);
  assert.equal((await s.read(B, b.receipt.id)).text, 'Use prose.');
});

test('shared queue CAS rejects stale sync reads and recovers from failed writes', async () => {
  const r = record(), k = M.keyOf(A, r.id), local = area({ [k]: r });
  const newer = { ...r, markdown: 'Use prose.', updatedAt: 101, revision: revision(2) };
  assert.equal(await M.replace({ local }, k, r, newer), true);
  assert.equal(await M.replace({ local }, k, r, { ...r, updatedAt: 999, revision: revision(3) }), false);
  local.fail = true; assert.equal((await make(local).list(A)).error, 'write');
  local.fail = false; assert.equal((await save(make(local), A, 'Use headings.')).ok, true);
});
