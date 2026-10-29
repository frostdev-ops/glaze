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

test('submitting a stale tab also keeps the newer draft from the other editor', async () => {
  const s = store(), a = PA.open(s), b = PA.open(s), k = PA.keyOf(K);
  await a.save(k, { doc: doc('Original.') }); await b.get(k);
  await a.save(k, { doc: doc('Other editor.') });
  await b.save(k, { doc: doc('Submitted version.') }, { reason: 'submit' });
  assert.ok((await Promise.all((await b.versions(k)).map((v) => b.version(k, v.id)))).some((v) => v.doc.content[0].content[0].text === 'Other editor.'));
});


test('stale formatting changes retain the other editor’s format and import choice', async () => {
  const s = store(), a = PA.open(s), b = PA.open(s), k = PA.keyOf(K);
  await a.save(k, { doc: doc('Same words.'), format: 'mla9', keep: false });
  await b.get(k);
  await a.save(k, { format: 'apa7', keep: true });
  await b.save(k, { doc: doc('Same words.'), format: 'chicago17', keep: false });
  const versions = await Promise.all((await b.versions(k)).map((v) => b.version(k, v.id)));
  assert.ok(versions.some((v) => v.reason === 'conflict' && v.format === 'apa7' && v.keep === true));
});

test('a row without kind lists as paper', async () => {
  const s = store(), P = PA.open(s), k = PA.keyOf(K);
  s.data.writerPapers = [{ key: k, title: 'Before kinds', course: '', url: '', words: 0, updated: 1, submitted: null }];
  assert.deepEqual((await P.list()).map((r) => [r.key, r.kind, r.named]), [[k, 'paper', false]]);
});

test('the index carries kind', async () => {
  const s = store(), P = PA.open(s, () => 5), k = PA.keyOf(K), d = PA.newKey();
  await P.save(k, { doc: doc('Assignment.'), title: 'Essay 2' });
  await P.save(d, { doc: doc('Mine.'), title: 'Notes', named: true });
  await P.save('later-kind', { kind: 'sheet', title: 'Budget' });
  assert.deepEqual([(await P.get(k)).kind, (await P.get(k)).named, (await P.get(d)).named, (await P.get('later-kind')).kind], ['paper', false, true, 'sheet']);
  assert.deepEqual((await P.list()).map((r) => [r.key, r.kind, r.named]), [['later-kind', 'sheet', false], [d, 'paper', true], [k, 'paper', false]]);
  await P.save(d, { doc: doc('Mine, more.') });
  assert.equal((await P.get(d)).named, true, 'a later save keeps the typed title');
});

test('a doc: key saves, lists and removes', async () => {
  let t = 1000;
  const s = store(), P = PA.open(s, () => t), k = PA.newKey();
  assert.match(k, PA.LOCAL);
  assert.ok(PA.local(k));
  assert.notEqual(k, PA.newKey());
  for (const bad of [PA.keyOf(K), 'doc:', 'doc:not-a-uuid', `${k}x`, `x${k}`, null]) assert.equal(PA.local(bad), false, String(bad));
  assert.equal(PA.keyOf({ school: 'doc', user: k }), null, 'keyOf stays Ultra-only');
  assert.equal((await P.save(k, { doc: doc(words(300)), title: 'Untitled document' })).version.reason, 'start');
  t += 1000; await P.save(k, { doc: doc(words(10)) });
  assert.deepEqual((await P.versions(k)).map((v) => v.reason), ['edit', 'start']);
  assert.equal((await P.version(k, (await P.versions(k))[0].id)).words, 300);
  assert.deepEqual((await P.list()).map((r) => [r.key, r.title, r.words, r.course]), [[k, 'Untitled document', 10, '']]);
  await P.remove(k);
  assert.deepEqual([await P.get(k), await P.list(), (await P.versions(k)).length], [null, [], 0]);
});

test('copyOf drops the assignment fields', async () => {
  const P = PA.open(store(), () => 50), k = PA.keyOf(K);
  const { paper } = await P.save(k, { doc: doc('Original.'), title: 'Essay 2', courseName: 'ENGL 2110', url: 'https://bb.school.test/x', due: 9, format: 'mla9', keep: true, school: 'bb.school.test', user: '_900_1', course: '_101_1', content: '_7_1' }, { reason: 'submit' });
  const copy = PA.copyOf(paper, 'Copy of Essay 2', 70);
  assert.ok(PA.local(copy.key));
  assert.deepEqual(copy, { key: copy.key, kind: 'paper', doc: doc('Original.'), format: 'mla9', keep: true, title: 'Copy of Essay 2', named: true, created: 70, updated: 70, revision: 0 });
  copy.doc.content[0].content[0].text = 'Changed.';
  assert.equal(paper.doc.content[0].content[0].text, 'Original.', 'the copy is its own document');
  assert.deepEqual(Object.keys(PA.copyOf({ kind: 'sheet', title: 'x' }, 'Copy of x', 1)).sort(), ['created', 'keep', 'key', 'kind', 'named', 'revision', 'title', 'updated']);
});

test('fromDocument: a standalone document\'s text, format and import choice for an assignment\'s paper, never its name', async () => {
  let t = 100;
  const P = PA.open(store(), () => (t += 10)), k = PA.keyOf(K), home = PA.newKey();
  await P.save(k, { doc: doc('My essay so far.'), title: 'Essay 2', format: 'mla9' });
  const { paper: source } = await P.save(home, { doc: doc('Drafted at home tonight.'), kind: 'paper', named: true, title: 'Home draft', format: 'plain', keep: true });
  const fields = PA.fromDocument(k, source);
  assert.deepEqual(fields, { doc: doc('Drafted at home tonight.'), words: 4, format: 'plain', keep: true, outline: null });
  fields.doc.content[0].content[0].text = 'Changed.';
  assert.equal(source.doc.content[0].content[0].text, 'Drafted at home tonight.', 'the paper gets its own copy');
  const { paper, version } = await P.save(k, { title: 'Essay 2', named: false, ...PA.fromDocument(k, source) }, { reason: 'import' });
  assert.deepEqual([paper.title, paper.named, paper.format, paper.keep, paper.words, paper.doc], ['Essay 2', false, 'plain', true, 4, doc('Drafted at home tonight.')]);
  assert.equal(version.reason, 'import');
  assert.deepEqual((await P.version(k, version.id)).doc, doc('My essay so far.'), 'what the paper held is kept');
  assert.deepEqual(await P.get(home), source, 'the document itself is untouched');
  // A preset's format as stored, the words counted when the record has none, an AI outline bound to the paper.
  const preset = { id: 'custom:x', label: 'Arial 11', base: 'mla9', font: 'Arial', size: 11, line: 2, first: 0.5, margin: 1, header: 'name-page' };
  const outline = { schema: 1, version: 1, scope: '', identity: 'model', language: 'en', entries: [{ content: 'c', heading: 'Intro' }] };
  assert.deepEqual(PA.fromDocument(k, { doc: doc('One two three.'), format: preset, outline }), { doc: doc('One two three.'), words: 3, format: preset, keep: false, outline: { ...outline, scope: k } });
  assert.equal(outline.scope, '');
  for (const none of [null, undefined, {}, { title: 'x', format: 'mla9' }]) assert.equal(PA.fromDocument(k, none), null);
  assert.equal(PA.fromDocument(k, { doc: doc('One two three.'), words: 100 }).words, 3, 'old import counts are recomputed');
  const copied = PA.fromDocument(k, { doc: doc('Draft.'), format: preset, outline });
  copied.format.font = 'Other'; copied.outline.entries[0].heading = 'Other';
  assert.equal(preset.font, 'Arial'); assert.equal(outline.entries[0].heading, 'Intro');
});

test('renamed: a title set elsewhere reaches an open editor, its own saves never read as one', async () => {
  let t = 1;
  const P = PA.open(store(), () => t), k = PA.newKey();
  const mine = (await P.save(k, { doc: doc('Draft.'), title: 'Draft.', named: false })).paper;
  assert.equal(PA.renamed(mine, mine), null, 'the editor\'s own save');
  t++; const derived = (await P.save(k, { doc: doc('Draft two.'), title: 'Draft two.', named: false })).paper;
  assert.equal(PA.renamed(mine, derived), null, 'another unnamed save: each editor derives its own title');
  t++; const home = (await P.save(k, { title: 'Field notes', named: true })).paper;
  assert.deepEqual(PA.renamed(derived, home), { title: 'Field notes', named: true, revision: home.revision }, 'the document unchanged: the editor builds on the rename');
  assert.deepEqual(PA.renamed(mine, home), { title: 'Field notes', named: true }, 'the document changed too: the title alone');
  assert.equal(PA.renamed(home, { ...home }), null);
  assert.equal(PA.renamed({ ...home, revision: home.revision + 1 }, home), null, 'an older record');
  t++; const cleared = (await P.save(k, { title: '', named: false })).paper;
  assert.deepEqual(PA.renamed(home, cleared), { title: '', named: false, revision: cleared.revision }, 'a name taken away');
  assert.deepEqual(PA.renamed(null, home), { title: 'Field notes', named: true }, 'an editor that has saved nothing yet');
  assert.equal(PA.renamed(home, null), null);
});

test('a save typed before a rename landed is no conflict: only a change to the document is', async () => {
  let t = 1;
  const P = PA.open(store(), () => t), k = PA.newKey();
  const first = (await P.save(k, { doc: doc('Draft.'), title: 'Draft.' })).paper;
  t++; await P.save(k, { title: 'Field notes', named: true });
  t++; const r = await P.save(k, { doc: doc('Draft. And more.'), title: 'Field notes', named: true }, { base: first.revision });
  assert.deepEqual((await P.versions(k)).map((v) => v.reason), ['start'], 'the rename changed no text');
  assert.equal(r.paper.title, 'Field notes');
  t++; await P.save(k, { doc: doc('Another tab.') }, { base: r.paper.revision });
  t++; await P.save(k, { doc: doc('Stale tab.') }, { base: r.paper.revision });
  assert.equal((await P.versions(k))[0].reason, 'conflict', 'a stale save over other text still keeps it');
});


test('a stale autosave cannot replace a newer title, but an explicit title edit can', async () => {
  let t = 1;
  const P = PA.open(store(), () => t++), k = PA.newKey();
  const first = (await P.save(k, { doc: doc('Draft.'), title: 'Draft.', named: false })).paper;
  await P.save(k, { title: 'Home title', named: true });
  const saved = await P.save(k, { doc: doc('Draft. More.'), title: 'Draft.', named: false }, { base: first.revision });
  assert.equal(saved.paper.title, 'Home title');
  assert.equal(saved.paper.named, true);
  const typed = await P.save(k, { doc: saved.paper.doc, title: 'Typed here', named: true }, { base: first.revision, rename: true });
  assert.equal(typed.paper.title, 'Typed here');
});

test('a rename does not advance the base over a different format or import choice', () => {
  const known = { doc: doc('Same words.'), format: 'plain', keep: false, title: 'A', named: true, revision: 1 };
  for (const change of [{ format: 'apa7' }, { keep: true }]) {
    assert.deepEqual(PA.renamed(known, { ...known, ...change, title: 'B', revision: 2 }), { title: 'B', named: true });
  }
});

test('format-only stale saves retain the newer format as a conflict version', async () => {
  const s = store(), a = PA.open(s), b = PA.open(s), k = PA.newKey();
  await a.save(k, { doc: doc('Same words.'), format: 'plain' }); await b.get(k);
  await a.save(k, { format: 'apa7' });
  await b.save(k, { format: 'chicago17' });
  const kept = await Promise.all((await b.versions(k)).map((v) => b.version(k, v.id)));
  assert.ok(kept.some((v) => v.reason === 'conflict' && v.format === 'apa7'));
});

test('a no-op document save does not turn a rename into an intervening document edit', async () => {
  const P = PA.open(store()), k = PA.newKey();
  const first = (await P.save(k, { doc: doc('Draft.'), format: 'plain' })).paper;
  await P.save(k, { title: 'Title', named: true });
  await P.save(k, { doc: first.doc, format: 'plain' });
  const r = await P.save(k, { doc: doc('Draft. More.') }, { base: first.revision });
  assert.notEqual(r.version?.reason, 'conflict');
});

test('delete then merge keeps every original version at the cap', async () => {
  let t = 1;
  const s = store(), P = PA.open(s, () => t++, { versions: async () => 4 }), k = PA.newKey();
  for (let i = 0; i < 4; i++) await P.save(k, { doc: doc(`Draft ${i}.`) }, { reason: i === 0 ? 'submit' : 'import' });
  const records = { [`writerPaper:${k}`]: await P.get(k), [`writerVersions:${k}`]: structuredClone(s.data[`writerVersions:${k}`]) };
  await P.remove(k); await P.merge(records);
  assert.deepEqual((await P.versions(k)).map((v) => v.id), records[`writerVersions:${k}`].map((v) => v.id));
  assert.equal((await P.get(k)).updated, records[`writerPaper:${k}`].updated, 'Undo preserves Last edited');
  assert.equal((await P.get(k)).revision, records[`writerPaper:${k}`].revision, 'Undo adds no save');
});

test('remove returns the exact document and versions it deleted for Undo', async () => {
  const s = store(), P = PA.open(s), k = PA.newKey();
  await P.save(k, { doc: doc('The newest typing.'), format: 'plain' });
  const records = { [`writerPaper:${k}`]: await P.get(k), [`writerVersions:${k}`]: structuredClone(s.data[`writerVersions:${k}`]) };
  assert.deepEqual(await P.remove(k), records, 'the worker captures the snapshot in the same turn as deletion');
  assert.equal(await P.get(k), null);
});

test('a refused delete leaves the paper, versions and index intact', async () => {
  const s = store(), P = PA.open(s), k = PA.newKey();
  await P.save(k, { doc: doc('Keep every word.'), format: 'plain' });
  const before = structuredClone(s.data), set = s.set;
  s.set = async (patch) => { if ('writerPapers' in patch) throw Error('QUOTA_BYTES'); return set(patch); };
  await assert.rejects(P.remove(k), /QUOTA_BYTES/);
  assert.deepEqual(s.data, before);
});

test('merge keeps an older record with a different format as a version', async () => {
  const P = PA.open(store(), () => 10), k = PA.newKey();
  await P.save(k, { doc: doc('Same words.'), format: 'apa7' });
  await P.merge({ [`writerPaper:${k}`]: { key: k, doc: doc('Same words.'), format: 'plain', updated: 1 } });
  const kept = await Promise.all((await P.versions(k)).map((v) => P.version(k, v.id)));
  assert.ok(kept.some((v) => v.reason === 'restore' && v.format === 'plain'));
});

test('a refused undo merge cannot publish the document without its versions', async () => {
  const s = store(), P = PA.open(s), k = PA.newKey();
  await P.save(k, { doc: doc('Kept.'), format: 'plain' });
  const records = { [`writerPaper:${k}`]: await P.get(k), [`writerVersions:${k}`]: structuredClone(s.data[`writerVersions:${k}`]) };
  await P.remove(k);
  const before = structuredClone(s.data), set = s.set;
  s.set = async (patch) => { if (Object.hasOwn(patch, `writerVersions:${k}`)) throw Error('QUOTA_BYTES'); return set(patch); };
  await assert.rejects(P.merge(records), /QUOTA_BYTES/);
  assert.deepEqual(s.data, before);
});

test('concurrent unnamed saves derive the title from the body that is saved', async () => {
  const P = PA.open(store()), k = PA.newKey();
  const first = (await P.save(k, { doc: doc('First line'), title: 'First line', named: false })).paper;
  await P.save(k, { doc: doc('Another first line'), title: 'Another first line', named: false });
  const r = await P.save(k, { doc: doc('My first line'), title: 'My first line', named: false }, { base: first.revision });
  assert.equal(r.paper.title, 'My first line');
  assert.equal(r.version.reason, 'conflict');
});

// The Documents home's Trash (S3b): Delete marks the record, Undo and Restore unmark it, and 30 days on it goes for good.
const DAY = 864e5;
test('trash sets the flag and keeps versions; restore clears it; purge removes what\'s older than 30 days and nothing else', async () => {
  let t = 1e12;
  const s = store(), P = PA.open(s, () => t), [a, b, c, d, live] = Array.from({ length: 5 }, () => PA.newKey());
  for (const k of [a, b, c, d, live]) { t += 1000; await P.save(k, { doc: doc(`Words of ${k}.`), title: k, named: true, format: 'plain' }); }
  t += 1000; await P.save(a, { doc: doc('Imported words.') }, { reason: 'import' });
  const before = await P.get(a), history = structuredClone(s.data[`writerVersions:${a}`]);
  assert.equal(history.length, 2);
  const row = async (k) => (await P.list()).find((r) => r.key === k);

  t += 1000;
  assert.deepEqual(await P.trash(a), { key: a, trashed: t });
  const trashed = await P.get(a);
  assert.equal(trashed.trashed, t);
  assert.deepEqual([trashed.updated, trashed.revision, trashed.doc, trashed.title], [before.updated, before.revision, before.doc, before.title], 'no edit: Last edited and the revision stay');
  assert.deepEqual(s.data[`writerVersions:${a}`], history, 'its versions are untouched');
  assert.equal((await row(a)).trashed, t, 'the index row carries it, so lists need no record');
  assert.deepEqual([PA.trashed(await row(a)), PA.trashed(await row(live)), PA.trashed(null)], [true, false, false]);
  const at = t;
  t += 1000; await P.trash(a);
  assert.equal((await P.get(a)).trashed, at, 'trashed again, it keeps when it was first trashed');

  assert.deepEqual(await P.untrash(a), { key: a });
  const back = await P.get(a);
  assert.equal('trashed' in back, false);
  assert.equal('trashed' in await row(a), false);
  assert.deepEqual([back.updated, back.revision], [before.updated, before.revision], 'restored as it was');
  assert.deepEqual(s.data[`writerVersions:${a}`], history);
  assert.equal(await P.trash(PA.newKey()), null, 'no such paper: nothing written');
  await assert.rejects(P.trash(''), /no paper key/);

  // Purge: past 30 days goes with its versions; 30 days exactly, 29, and what isn't trashed stay.
  const T = 2e12;
  t = T - 31 * DAY; await P.trash(a);
  t = T - 30 * DAY; await P.trash(b);
  t = T - 29 * DAY; await P.trash(c);
  t = T - 40 * DAY; await P.trash(d); await P.untrash(d);
  t = T;
  const kept = structuredClone(Object.fromEntries(Object.entries(s.data).filter(([k]) => !k.endsWith(a) && k !== 'writerPapers')));
  assert.deepEqual(await P.purge(), [a]);
  assert.deepEqual([s.data[`writerPaper:${a}`], s.data[`writerVersions:${a}`], await row(a)], [undefined, undefined, undefined]);
  assert.deepEqual(Object.fromEntries(Object.entries(s.data).filter(([k]) => k !== 'writerPapers')), kept, 'every other record and its versions as they were');
  assert.deepEqual((await P.list()).map((r) => r.key).sort(), [b, c, d, live].sort());
  const sets = []; const set = s.set; s.set = async (o) => { sets.push(Object.keys(o)); return set(o); };
  assert.deepEqual(await P.purge(), [], 'nothing more to purge');
  assert.deepEqual(sets, [], 'and nothing written');
  s.set = set;
});

test('purge trusts the record over a stale row, and drops a row whose record is gone', async () => {
  let t = 1e12;
  const s = store(), P = PA.open(s, () => t), [live, ghost] = [PA.newKey(), PA.newKey()];
  await P.save(live, { doc: doc('Still here.'), format: 'plain' });
  s.data.writerPapers = [{ ...s.data.writerPapers[0], trashed: t - 60 * DAY }, { key: ghost, kind: 'paper', named: false, title: '', updated: 1, trashed: t - 60 * DAY }];
  assert.deepEqual(await P.purge(), [ghost]);
  assert.ok(s.data[`writerPaper:${live}`] && s.data[`writerVersions:${live}`], 'a record not trashed stays whatever its row says');
  assert.deepEqual(s.data.writerPapers.map((r) => r.key), [live]);
});

test('a refused purge leaves the papers, versions and index intact', async () => {
  let t = 1e12;
  const s = store(), P = PA.open(s, () => t), k = PA.newKey();
  await P.save(k, { doc: doc('Keep every word.'), format: 'plain' });
  await P.trash(k);
  t += 31 * DAY;
  const before = structuredClone(s.data);
  s.remove = async () => { throw Error('storage refused'); };
  await assert.rejects(P.purge(), /storage refused/);
  assert.deepEqual(s.data, before);
});

test('typing in or submitting a trashed document brings it back; a rename or an unchanged save leaves it in Trash', async () => {
  let t = 1e12;
  const P = PA.open(store(), () => t), k = PA.newKey();
  await P.save(k, { doc: doc('First words.'), format: 'plain' });
  await P.trash(k);
  t += 1000; await P.save(k, { title: 'Renamed', named: true });
  assert.ok(PA.trashed(await P.get(k)), 'a rename is no edit');
  t += 1000; await P.save(k, { doc: doc('First words.') });
  assert.ok(PA.trashed(await P.get(k)), 'an autosave of the same text is no edit');
  t += 1000; await P.save(k, { doc: doc('First words, and more.') });
  assert.equal('trashed' in await P.get(k), false, 'what an open editor writes is never purged with the Trash');
  assert.equal('trashed' in (await P.list())[0], false);
  await P.trash(k);
  t += 1000; await P.save(k, { doc: doc('First words, and more.') }, { reason: 'sending' });
  assert.equal(PA.trashed(await P.get(k)), false, 'a paper submitted as it was is out of Trash too, its submitted version never purged');
});

test('a backup\'s trashed record keeps its flag through merge, and a newer live one beats an old trashed copy', async () => {
  let t = 1e12;
  const s = store(), P = PA.open(s, () => t), k = PA.newKey(), other = PA.newKey();
  await P.save(k, { doc: doc('From the backup.'), format: 'plain' });
  await P.trash(k);
  const records = { [`writerPaper:${k}`]: await P.get(k), [`writerVersions:${k}`]: structuredClone(s.data[`writerVersions:${k}`]) };
  const Q = PA.open(store(), () => t);
  await Q.merge(records);
  assert.equal((await Q.get(k)).trashed, records[`writerPaper:${k}`].trashed);
  assert.equal((await Q.list())[0].trashed, records[`writerPaper:${k}`].trashed);
  await P.save(other, { doc: doc('Old.'), format: 'plain' });
  await P.trash(other);
  t += 1000;
  await P.merge({ [`writerPaper:${other}`]: { key: other, kind: 'paper', doc: doc('Newer, written elsewhere.'), format: 'plain', updated: t } });
  assert.equal(PA.trashed(await P.get(other)), false, 'newer work restored from a backup is out of Trash');
});
