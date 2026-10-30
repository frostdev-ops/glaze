// An assignment's paper keeps one set of sources (lib/writer-sources.js keyOf) in its attempt's frame and in Documents:
// the frame's context as features/writer.js (paperOf, init) and lib/writer-context-assignment.js (build) make it, and
// papers.js's for the same paper's record. A standalone document keeps its local key. The page is
// scripts/documents-ai-check.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const S = require('../lib/writer-sources.js'), PA = require('../lib/writer-papers.js'), U = require('../lib/writer-ultra.js'), A = require('../lib/writer-context-assignment.js');
const R = require('../lib/rubric.js');
const grades = require('./fixtures/ultra-writer-gradebook.json'), members = require('./fixtures/ultra-memberships.json'), item = require('./fixtures/ultra-writer-content.json');

const HOST = 'bb.school.test', ORIGIN = `https://${HOST}`, ATTEMPT = '/ultra/courses/_101_1/assessment/_7_1/attempt/create';
const slice = (file, from, to) => {
  const src = fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), a = src.indexOf(from), b = src.indexOf(to, a + 1);
  assert.ok(a >= 0 && b > a, `${file}: ${from.trim()} … ${to.trim()}`);
  return src.slice(a, b);
};

// The attempt's frame: its init context (features/writer.js mount's paper, swap's recovery) and the one it has once
// Ultra's context arrives (lib/writer-context-assignment.js send: { ...box.context, ...build() }).
const frame = async (host = HOST) => {
  const origin = `https://${host}`;
  const later = (fn, ms, ...a) => { const t = setTimeout(fn, ms, ...a); t.unref(); return t; };
  const paperOf = vm.runInNewContext(`${slice('features/writer.js', '  const paperOf = async', '  let seq = 0;')}; paperOf`,
    { U: () => U, X: { account: async () => '_900_1' }, location: { host, origin, pathname: ATTEMPT }, setTimeout: later });
  const paper = await paperOf();
  const init = { prompt: 'Essay 2 Write 1,200 words on memory in Beloved.', ...(paper && { paper }), recovery: origin + ATTEMPT };
  const column = (u) => { throw new Error(`unexpected ${u}`); };
  const built = await A.build({ school: host, path: ATTEMPT, url: origin + ATTEMPT, origin, uid: async () => '_900_1',
    me: async () => ({ id: '_900_1', userName: 'synthetic', givenName: 'Alex', familyName: 'Rivera' }), courses: async () => members.results, rows: async () => grades.results,
    get: async (u) => (u === '/learn/api/v1/courses/_101_1/contents/_7_1' ? item : column(u)), instructions: async () => 'Essay 2\nWrite 1,200 words on memory in Beloved.', R });
  return { init, full: { ...init, ...built } };
};
// The paper's record as writer-paper.js saves it from the frame's context (record(), then the store's save).
const recordOf = (key, ctx) => ({ key, kind: 'paper', named: false, title: ctx.assignment.title, due: ctx.assignment.due, url: ctx.paper.url, courseName: ctx.course.name,
  school: ctx.paper.school, user: ctx.paper.user, course: ctx.paper.course, content: ctx.paper.content, format: 'mla9', keep: false,
  doc: { type: 'doc', content: [{ type: 'paragraph' }] }, words: 0, created: 1, updated: 2, revision: 1 });
// papers.js edit()'s context for papers.html?paper=<key>, the store holding `stored`.
const standalone = (key, stored = {}) => vm.runInNewContext(`(async () => { ${slice('papers.js', '    const rec = GZ_WRITER_PAPERS.local(key)', '    // The same editor modules')}; return context; })()`,
  { key, GZ_WRITER_PAPERS: PA, papers: () => ({ get: async (k) => stored[k] ?? null }) });
const localKey = (key) => `writer:sources:local|local|papers|${encodeURIComponent(key)}`;

test('an assignment paper opened from Documents has the sources its attempt saved', async () => {
  const { init, full } = await frame();
  const k = S.keyOf(init);
  assert.equal(k, 'writer:sources:bb.school.test|_900_1|_101_1|_7_1', 'the attempt keeps its sources under its paper\'s school (host), student, course and assignment');
  assert.equal(S.keyOf(full), k, 'Ultra\'s context arriving keeps the same store');
  const key = PA.keyOf(full.paper), ctx = await standalone(key, { [key]: recordOf(key, full) });
  assert.equal(S.keyOf(ctx), k, 'Documents opens the attempt\'s store');
  assert.deepEqual([ctx.kind, ctx.course.name, ctx.assignment.title, ctx.assignment.due], ['assignment', full.course.name, full.assignment.title, full.assignment.due], 'what the record keeps still comes along');
});

test('a standalone document keeps its sources under its local key', async () => {
  const key = `doc:${crypto.randomUUID()}`;
  const ctx = await standalone(key, { [key]: { key, kind: 'paper', school: HOST, user: '_900_1', course: '_101_1', content: '_7_1' } });
  assert.equal(S.keyOf(ctx), localKey(key));
  assert.equal(ctx.kind, undefined, 'its record is never read as an assignment\'s');
});

test('a paper whose record doesn\'t make its own key keeps its local key, never another paper\'s store', async () => {
  const recovery = `recovery:${crypto.randomUUID()}`;
  assert.equal(S.keyOf(await standalone(recovery, { [recovery]: { key: recovery, kind: 'paper', title: 'Essay 2' } })), localKey(recovery));
  const key = `${HOST}|_900_1|_101_1|_7_1`, other = { key, kind: 'paper', school: HOST, user: '_900_1', course: '_101_1', content: '_8_1' };
  assert.equal(S.keyOf(await standalone(key, { [key]: other })), localKey(key));
});

test('keyOf: a whole paper names the store; a partial one leaves the context\'s own parts', () => {
  const own = { school: 'local', user: { id: 'local' }, course: { id: 'papers' }, item: { id: 'x' } };
  assert.equal(S.keyOf({ ...own, paper: { school: HOST, user: '_900_1', course: '_101_1', content: '_7_1' } }), 'writer:sources:bb.school.test|_900_1|_101_1|_7_1');
  assert.equal(S.keyOf({ ...own, paper: { school: HOST, user: '_900_1', course: '_101_1' } }), 'writer:sources:local|local|papers|x');
  assert.equal(S.keyOf({ paper: null, kind: 'assignment', course: { id: '_101_1' } }), null, 'without the student nothing is saved under a guess');
});


test('an assignment saved with a port reopens the encoded host key from Documents', async () => {
  const { init, full } = await frame('bb.school.test:8443'), key = PA.keyOf(full.paper), data = {};
  const store = PA.open({ get: async (k) => ({ [k]: data[k] }), set: async (v) => Object.assign(data, v) });
  await store.save(key, recordOf(key, full));
  const ctx = await standalone(key, { [key]: await store.get(key) });
  assert.equal(S.keyOf(init), 'writer:sources:bb.school.test%3A8443|_900_1|_101_1|_7_1');
  assert.equal(S.keyOf(ctx), S.keyOf(init));
  assert.ok(ctx.paper, 'a current saved assignment never falls through to the local key');
});

test('source key parts encode separators and unicode once without collisions', () => {
  const parts = { school: 'https://bb.school.test:8443', user: 'a|b', course: '%2F', item: 'é?#' };
  const key = S.key(parts);
  assert.deepEqual(key.slice(S.PREFIX.length).split('|').map(decodeURIComponent), Object.values(parts));
  assert.notEqual(S.key({ ...parts, user: 'a', course: 'b|%2F' }), key);
});

test('Documents paper identity is stripped from AI context', async () => {
  const W = require('../lib/ai/tasks/writer-context.js');
  const C = require('../lib/ai/tasks/writer-complete.js');
  const { full } = await frame(), key = PA.keyOf(full.paper), ctx = await standalone(key, { [key]: recordOf(key, full) });
  const { paper, ...without } = ctx;
  assert.deepEqual(W.clean(ctx), W.clean(without));
  const input = C.task.input({ before: 'When memory returns it', mode: 'paper', kind: 'paper', context: ctx });
  assert.ok(input);
  assert.doesNotMatch(JSON.stringify(input.context), /bb\.school|_900_1|_101_1|_7_1|"paper"/);
});

test('test boxes still have no source key', async () => {
  // A test leaves contextOf before touching the editor (lib/writer-ultra.js); a message's key comes with its context
  // (test/writer-discussion-sources.test.js).
  for (const kind of ['test']) {
    const context = U.contextOf(null, kind);
    assert.equal(S.keyOf(context), null);
    let writes = 0;
    assert.equal(await S.save(S.keyOf(context), [{ type: 'book', title: 'A source' }], { set: async () => writes++, remove: async () => writes++ }), false);
    assert.equal(writes, 0);
  }
});

test('source saves enforce MAX and leave stored sources intact when quota refuses', async () => {
  const k = S.keyOf((await frame()).init), data = {}; let fail = false;
  const area = { get: async (key) => ({ [key]: structuredClone(data[key]) }),
    set: async (v) => { if (fail) throw new Error('QUOTA_BYTES'); Object.assign(data, structuredClone(v)); },
    remove: async (key) => { if (fail) throw new Error('QUOTA_BYTES'); delete data[key]; } };
  assert.equal(await S.save(k, Array.from({ length: S.MAX.sources + 1 }, (_, n) => ({ id: `source-${n}`, title: `Book ${n}` })), area), true);
  assert.equal((await S.load(k, area)).length, S.MAX.sources);
  const before = structuredClone(data);
  fail = true;
  assert.equal(await S.save(k, [{ title: 'Replacement' }], area), false);
  assert.equal(await S.save(k, [], area), false);
  assert.deepEqual(data, before);
});

// Clear, Delete forever and Trash's 30 days delete a paper's or document's saved sources with it: reopening the
// assignment, or a new paper under that key, starts with none.
test('a removed or purged paper takes its saved sources with it', async () => {
  const data = {};
  const area = {
    get: async (k) => { const ks = k == null ? Object.keys(data) : [].concat(k); return Object.fromEntries(ks.filter((x) => x in data).map((x) => [x, structuredClone(data[x])])); },
    set: async (o) => { Object.assign(data, structuredClone(o)); },
    remove: async (k) => { for (const x of [].concat(k)) delete data[x]; },
  };
  let t = 1e12;
  const api = PA.open(area, () => t);
  const paper = { school: HOST, user: '_900_1', course: '_101_1', content: '_7_1' };
  const k = PA.keyOf(paper), doc = PA.newKey(), source = [{ type: 'web', title: 'A source', URL: 'https://example.org/a' }];
  const docOf = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Words.' }] }] };
  for (const key of [k, doc]) await api.save(key, { ...(key === k ? paper : {}), title: 'Essay', doc: docOf });
  const sk = S.keyOf({ paper }), dk = localKey(doc), other = localKey(PA.newKey());
  assert.equal(sk, `writer:sources:${k}`);
  for (const key of [sk, dk, other]) await S.save(key, source, area);
  await api.remove(k);
  assert.deepEqual(await S.load(sk, area), [], 'Clear: the assignment\'s sources go with its paper');
  await api.trash(doc);
  t += 31 * 864e5;
  assert.deepEqual(await api.purge(), [doc]);
  assert.deepEqual(await S.load(dk, area), [], 'Trash\'s 30 days: the document\'s sources go too');
  assert.equal((await S.load(other, area)).length, 1, 'another document\'s stay');
});

test('Clear and purge also sweep the local source store used by an assignment with incomplete identity', async () => {
  for (const op of ['remove', 'purge']) {
    const data = {}, area = {
      get: async (k) => Object.fromEntries([].concat(k).filter((x) => x in data).map((x) => [x, structuredClone(data[x])])),
      set: async (v) => { Object.assign(data, structuredClone(v)); },
      remove: async (keys) => { for (const k of [].concat(keys)) delete data[k]; },
    };
    let now = 1e12;
    const api = PA.open(area, () => now), key = PA.keyOf({ school: `${HOST}:8443`, user: '_900_1', course: '_101_1', content: '_7_1' });
    await api.save(key, { title: 'Legacy paper', doc: { type: 'doc', content: [{ type: 'paragraph' }] } });
    const ctx = await standalone(key, { [key]: await api.get(key) }), sk = S.keyOf(ctx);
    assert.equal(sk, localKey(key));
    const siblings = ['_8_1', '_9_1'].map((item) => S.key({ school: `${HOST}:8443`, user: '_900_1', course: '_101_1', item }));
    for (const k of [sk, ...siblings]) await S.save(k, [{ id: 'source-a', title: 'A source' }], area);
    if (op === 'purge') { await api.trash(key); now += 31 * 864e5; await api.purge(); }
    else await api.remove(key);
    assert.deepEqual(await S.load(sk, area), [], `${op}: the store Documents actually opened is deleted`);
    for (const k of siblings) assert.equal((await S.load(k, area)).length, 1, 'discussion and journal sources stay');
  }
});
