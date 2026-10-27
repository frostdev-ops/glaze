// Glaze Writer's paper storage (lib/writer-papers.js) over a stand-in chrome.storage.local: keys, autosave, versions on
// submit, before an import or restore, before a big edit and every 10 minutes, the caps, the list, and presets. That the
// editor frame and papers.html see the same store in Chrome is scripts/writer-paper-check.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const PA = require('../lib/writer-papers.js');
globalThis.GZ_WRITER_STYLES = require('../lib/writer-styles.js');

const store = () => {
  const data = {};
  return { data, get: async (k) => ({ [k]: data[k] === undefined ? undefined : JSON.parse(JSON.stringify(data[k])) }), set: async (o) => { for (const [k, v] of Object.entries(o)) data[k] = JSON.parse(JSON.stringify(v)); }, remove: async (ks) => { for (const k of ks) delete data[k]; } };
};
const doc = (text) => ({ type: 'doc', content: [{ type: 'paragraph', content: text ? [{ type: 'text', text }] : undefined }] });
const words = (n, w = 'word') => Array.from({ length: n }, () => w).join(' ');
const K = { school: 'bb.school.test', user: '_900_1', course: '_101_1', content: '_7_1' };

test('a paper\'s key is the school, student, course and assignment, or nothing', () => {
  assert.equal(PA.keyOf(K), 'bb.school.test|_900_1|_101_1|_7_1');
  assert.equal(PA.keyOf({ ...K, school: 'BB.School.Test' }), 'bb.school.test|_900_1|_101_1|_7_1');
  for (const bad of [{}, { ...K, user: '' }, { ...K, course: '101' }, { ...K, content: '_7_1|x' }, { ...K, school: 'a b' }]) assert.equal(PA.keyOf(bad), null, JSON.stringify(bad));
  assert.equal(PA.scopeOf(K), 'bb.school.test|_900_1');
});

test('autosave keeps the paper; the first save is a version; the list shows it', async () => {
  let t = 1000;
  const s = store(), P = PA.open(s, () => t), k = PA.keyOf(K);
  const r = await P.save(k, { doc: doc('First words here.'), title: 'Essay 2', courseName: 'ENGL 2110', format: 'mla9', words: 3 });
  assert.equal(r.version.reason, 'start');
  t += 5000;
  const r2 = await P.save(k, { doc: doc('First words here, and more.'), words: 5 });
  assert.equal(r2.version, null, 'a small edit soon after is no version');
  const p = await P.get(k);
  assert.deepEqual([p.title, p.courseName, p.format, p.words, p.created, p.updated], ['Essay 2', 'ENGL 2110', 'mla9', 5, 1000, 6000]);
  assert.deepEqual((await P.list()).map((x) => [x.key, x.title, x.course, x.words]), [[k, 'Essay 2', 'ENGL 2110', 5]]);
  assert.equal((await P.versions(k)).length, 1);
  assert.equal((await P.versions(k))[0].doc, undefined, 'the list of versions leaves their documents out');
});

test('versions: before a big edit, every 10 minutes of writing, on submit, before an import and a restore', async () => {
  let t = 0;
  const P = PA.open(store(), () => t), k = PA.keyOf(K);
  await P.save(k, { doc: doc(words(300)) });
  t += 1000; assert.equal((await P.save(k, { doc: doc(words(150)) })).version?.reason, 'edit', 'half the paper deleted at once');
  assert.equal((await P.version(k, (await P.versions(k))[0].id)).words, 300, 'the version is the paper before the edit');
  t += 1000; assert.equal((await P.save(k, { doc: doc(words(151)) })).version, null);
  t += 10 * 60e3; assert.equal((await P.save(k, { doc: doc(words(152)) })).version?.reason, 'auto', 'ten minutes on');
  t += 1000; assert.equal((await P.save(k, { doc: doc(words(152)) }, { reason: 'submit' })).version?.reason, 'submit');
  assert.ok((await P.get(k)).submitted);
  t += 1000; assert.equal((await P.save(k, { doc: doc('Imported.') }, { reason: 'import' })).version?.reason, 'import');
  assert.equal((await P.version(k, (await P.versions(k))[0].id)).words, 152, 'what the import replaced');
  const first = (await P.versions(k)).find((v) => v.reason === 'start');
  t += 1000;
  const back = await P.restore(k, first.id);
  assert.equal(back.paper.words, 300);
  assert.equal(back.version.reason, 'restore', 'what the restore replaced is kept');
  assert.deepEqual((await P.versions(k)).map((v) => v.reason), ['restore', 'import', 'submit', 'auto', 'edit', 'start']);
});

test('versions are capped by count and size, keeping the newest and the last submitted', async () => {
  let t = 0;
  const P = PA.open(store(), () => t), k = PA.keyOf(K);
  await P.save(k, { doc: doc(words(10)) }, { reason: 'submit' });
  for (let i = 0; i < 60; i++) { t += 11 * 60e3; await P.save(k, { doc: doc(words(10 + i)) }); }
  const list = await P.versions(k);
  assert.equal(list.length, PA.CAP.versions);
  assert.ok(list.some((v) => v.reason === 'submit'), 'the submitted version stays');
  assert.equal(list[0].at, t, 'the newest stays');
  const big = PA.open(store(), () => t);
  for (let i = 0; i < 8; i++) { t += 11 * 60e3; await big.save(k, { doc: doc(words(60000 + i, 'longerword')) }); }
  assert.ok((await big.versions(k)).reduce((n, v) => n + v.bytes, 0) <= PA.CAP.bytes);
});

test('saves to one paper run in order; a missing key refuses; remove takes it off the list', async () => {
  const s = store(), P = PA.open(s, () => 1), k = PA.keyOf(K);
  await Promise.all([P.save(k, { doc: doc('a') }), P.save(k, { doc: doc('ab') }), P.save(k, { doc: doc('abc') })]);
  assert.equal((await P.get(k)).doc.content[0].content[0].text, 'abc');
  await assert.rejects(P.save('', { doc: doc('x') }), /no paper key/);
  await P.remove(k);
  assert.deepEqual([await P.get(k), await P.list(), (await P.versions(k)).length], [null, [], 0]);
});

test('a student\'s presets: saved per student, invalid ones dropped', async () => {
  const s = store(), P = PA.open(s), scope = PA.scopeOf(K);
  await P.savePreset(scope, { id: 'custom:a', label: 'Arial 11', base: 'mla9', font: 'Arial', size: 11 });
  s.data[`writerPresets:${scope}`].push({ id: 'custom:bad', label: 'Bad', base: 'mla9', font: 'Papyrus' });
  assert.deepEqual((await P.presets(scope)).map((p) => p.label), ['Arial 11']);
  assert.deepEqual(await P.presets(PA.scopeOf({ ...K, user: '_901_1' })), [], 'another student\'s are theirs');
  await P.removePreset(scope, 'custom:a');
  assert.deepEqual(await P.presets(scope), []);
  await assert.rejects(P.savePreset(null, {}), /no student/);
});

test('two editors retain a stale tab\'s overwritten draft and concurrent index rows', async () => {
  const s = store(), a = PA.open(s), b = PA.open(s), k = PA.keyOf(K);
  await a.save(k, { doc: doc('Original.') });
  await a.get(k); await b.get(k);
  await a.save(k, { doc: doc('From tab A.') });
  await b.save(k, { doc: doc('From tab B.') });
  const versions = await b.versions(k);
  assert.ok((await Promise.all(versions.map((v) => b.version(k, v.id)))).some((v) => v.doc.content[0].content[0].text === 'From tab A.'), 'the overwritten tab must be recoverable');
  await Promise.all([a.save('other-a', { doc: doc('a') }), b.save('other-b', { doc: doc('b') })]);
  assert.equal((await a.list()).length, 3, 'neither index row is lost');
});

test('versions restore the matching format and count encoded bytes', async () => {
  const P = PA.open(store()), k = PA.keyOf(K);
  await P.save(k, { doc: doc('é'.repeat(100)), format: 'mla9' });
  await P.save(k, { doc: doc('New.'), format: 'apa7' }, { reason: 'format' });
  const v = (await P.versions(k)).find((x) => x.reason === 'format');
  assert.equal(v.bytes, new TextEncoder().encode(JSON.stringify(doc('é'.repeat(100)))).length);
  assert.equal((await P.restore(k, v.id)).paper.format, 'mla9');
});
