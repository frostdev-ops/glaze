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
const frame = async () => {
  const later = (fn, ms, ...a) => { const t = setTimeout(fn, ms, ...a); t.unref(); return t; };
  const paperOf = vm.runInNewContext(`${slice('features/writer.js', '  const paperOf = async', '  let seq = 0;')}; paperOf`,
    { U: () => U, X: { account: async () => '_900_1' }, location: { host: HOST, origin: ORIGIN, pathname: ATTEMPT }, setTimeout: later });
  const paper = await paperOf();
  const init = { prompt: 'Essay 2 Write 1,200 words on memory in Beloved.', ...(paper && { paper }), recovery: ORIGIN + ATTEMPT };
  const column = (u) => { throw new Error(`unexpected ${u}`); };
  const built = await A.build({ school: HOST, path: ATTEMPT, url: ORIGIN + ATTEMPT, origin: ORIGIN, uid: async () => '_900_1',
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
