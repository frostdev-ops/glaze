// An assignment's record changing kind (writer-kinds.js: Open in Glaze on a brought PDF or deck, a spreadsheet started):
// the paper it held kept as a version first, that version saying it was a paper, and a restore bringing the paper back;
// which kinds the frame offers: a brought file's by its Settings → Writer switch and its viewer here, Document or
// Spreadsheet only with the spreadsheet kind in this build and writer.sheets on.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const PA = require('../lib/writer-papers.js');
const L = require('../lib/writer-submit.js');
globalThis.GZ_WRITER_STYLES = require('../lib/writer-styles.js');

const store = () => {
  const data = {};
  return { data, get: async (k) => ({ [k]: data[k] === undefined ? undefined : JSON.parse(JSON.stringify(data[k])) }), set: async (o) => { for (const [k, v] of Object.entries(o)) data[k] = JSON.parse(JSON.stringify(v)); }, remove: async (ks) => { for (const k of ks) delete data[k]; } };
};
const doc = (text) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });
const KEY = 'school.blackboard.com|_900_1|_101_1|_7_1';

test('Open in Glaze: the paper kept as a version first, saying it was a paper; the record the PDF; a restore the paper again', async () => {
  const clock = { t: 1000 }, P = PA.open(store(), () => clock.t, { versions: () => 40 });
  await P.save(KEY, { kind: 'paper', doc: doc('My draft of the form answers.'), format: 'mla9', title: 'Essay 2' });
  clock.t += 1000;
  // What pdf-kind.js into saves (writer-kinds.js open): the record becomes the PDF, its document gone.
  const { paper, version } = await P.save(KEY, { kind: 'pdf', doc: null, words: 0, file: 'JVBERi0=', size: 5, pages: 1 }, { reason: 'import' });
  assert.equal(paper.kind, 'pdf');
  assert.equal(paper.doc, null);
  assert.equal(paper.title, 'Essay 2', 'the assignment\'s title stays');
  assert.equal(version.reason, 'import');
  assert.equal(version.kind, 'paper', 'the version says what it was');
  assert.deepEqual(version.doc, doc('My draft of the form answers.'));
  assert.equal((await P.list()).find((r) => r.key === KEY).kind, 'pdf', 'Documents lists it as a PDF');
  // A 'sending' version of the PDF (the submit sheet's) says it is one.
  clock.t += 1000;
  assert.equal((await P.save(KEY, {}, { reason: 'sending' })).version.kind, 'pdf');
  // The paper back from its version: a paper again.
  clock.t += 1000;
  const back = await P.restore(KEY, version.id);
  assert.equal(back.paper.kind, 'paper');
  assert.deepEqual(back.paper.doc, doc('My draft of the form answers.'));
});

test('a record without a kind still versions as a paper', async () => {
  const P = PA.open(store(), () => 5000);
  await P.save(KEY, { doc: doc('Old record.') });
  const { version } = await P.save(KEY, { doc: doc('An import.') }, { reason: 'import' });
  assert.equal(version.kind, 'paper');
});

test('file versions retain bytes and metadata through kind switches and restores', async () => {
  let time = 1000;
  const P = PA.open(store(), () => ++time);
  const draft = doc('Before the PDF.');
  await P.save(KEY, { doc: draft, format: 'mla9' });
  const pdf = { kind: 'pdf', doc: null, file: 'JVBERi0=', size: 5, pages: 2, thumb: 'data:image/png;base64,AA==' };
  const imported = await P.save(KEY, pdf, { reason: 'import' });
  const sending = (await P.save(KEY, {}, { reason: 'sending' })).version;
  assert.equal(sending.file, pdf.file, 'a submitted PDF version contains its file');
  assert.ok(sending.bytes >= pdf.file.length, 'the version cap counts the file');
  assert.equal((await P.versions(KEY)).find((v) => v.id === sending.id).file, undefined, 'version listings omit file payloads');
  const back = await P.restore(KEY, imported.version.id);
  assert.equal(back.paper.kind, 'paper');
  assert.deepEqual(back.paper.doc, draft);
  assert.equal(back.paper.file, null, 'a restored paper has no leftover PDF');
  assert.equal(back.version.file, pdf.file, 'the replaced PDF is restorable too');
  const again = await P.restore(KEY, sending.id);
  for (const [field, value] of Object.entries(pdf)) assert.deepEqual(again.paper[field], value, field);
  const deck = { kind: 'slides', doc: null, file: 'UEsDBA==', size: 4, ext: '.ppsx', slides: 3, text: 'Deck words', words: 2 };
  const changed = await P.save(KEY, deck, { reason: 'import' });
  assert.equal(changed.version.kind, 'pdf');
  assert.equal(changed.version.file, pdf.file, 'PDF to deck retains the PDF');
  const deckVersion = (await P.save(KEY, {}, { reason: 'sending' })).version;
  await P.restore(KEY, sending.id);
  assert.equal((await P.get(KEY)).ext, null, 'the PDF has no leftover slideshow extension');
  const restored = await P.restore(KEY, deckVersion.id);
  for (const [field, value] of Object.entries(deck)) assert.deepEqual(restored.paper[field], value, field);
});

test('a legacy file version without its payload cannot replace the current record', async () => {
  const s = store(), P = PA.open(s, () => 1000);
  await P.save(KEY, { doc: doc('Keep this draft.') });
  await s.set({ [`writerVersions:${KEY}`]: [{ id: 'old-pdf', kind: 'pdf', doc: null, at: 1, bytes: 4 }] });
  assert.equal(await P.restore(KEY, 'old-pdf'), null);
  assert.deepEqual((await P.get(KEY)).doc, doc('Keep this draft.'));
});

test('a late paper autosave cannot replace a file-kind record', async () => {
  const s = store(), P = PA.open(s, () => 1000), late = PA.open(s, () => 2000);
  await P.save(KEY, { kind: 'paper', doc: doc('Draft.') });
  const old = await late.get(KEY);
  await P.save(KEY, { kind: 'pdf', doc: null, file: 'JVBERi0=', size: 5 }, { reason: 'import' });
  await assert.rejects(late.save(KEY, { kind: 'paper', doc: doc('Late key.') }, { base: old.revision }), /kind/);
  assert.equal((await P.get(KEY)).kind, 'pdf');
  assert.equal((await P.get(KEY)).file, 'JVBERi0=');
});

// writer-kinds.js in a frame of its own: the frame, the settings and the submit library it reads.
const kinds = (w = {}) => {
  const ctx = vm.createContext({ console, setTimeout, clearTimeout, document: { querySelector: () => null, getElementById: () => null },
    GZ_WRITER_FRAME: { t: (k) => k, on: () => {}, mode: () => 'paper', kind: () => 'assignment', item: () => null, say: () => {} },
    GZ_WRITER_SETTINGS: { now: () => w }, GZ_WRITER_SUBMIT_LIB: L });
  ctx.globalThis = ctx;
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'writer-kinds.js'), 'utf8'), ctx);
  return ctx.GZ_WRITER_KINDS;
};

test('a brought file opens as its kind only while that kind is switched on and has a viewer here', () => {
  assert.deepEqual([...kinds({}).opens()], [], 'off: nothing but Word files');
  assert.deepEqual([...kinds({ pdf: true }).opens()], ['pdf']);
  assert.deepEqual([...kinds({ pdf: true, slides: true }).opens()], ['pdf', 'slides']);
  assert.deepEqual([...kinds({ pdf: true, slides: true, sheets: true }).opens()], ['pdf', 'slides'], 'writer.sheets on, but no grid in the frame yet');
  assert.deepEqual(Object.keys(kinds().FRAME), ['pdf', 'slides']);
  assert.ok(Object.isFrozen(kinds().FRAME));
  const K = kinds();
  assert.deepEqual([...K.opens({ sheets: true }, { ...K.FRAME, sheet: {} })], ['sheet'], 'the grid once it is here');
});

test('Document or Spreadsheet: offered only with the spreadsheet kind here and writer.sheets on', () => {
  const K = kinds(), grid = { ...K.FRAME, sheet: {} }, KINDS = { paper: {}, pdf: {}, slides: {}, sheet: {} };
  assert.deepEqual([...K.offers({ sheets: true }, K.FRAME, { paper: {}, pdf: {}, slides: {} })], [], 'this build: no spreadsheet kind');
  assert.deepEqual([...K.offers({ sheets: true }, grid, { paper: {}, pdf: {}, slides: {} })], [], 'a grid but no kind in the registry');
  assert.deepEqual([...K.offers({ sheets: false }, grid, KINDS)], [], 'writer.sheets off');
  assert.deepEqual([...K.offers({}, grid, KINDS)], []);
  assert.deepEqual([...K.offers({ sheets: true }, grid, KINDS)], ['paper', 'sheet']);
});

test('a frame without Writer\'s host makes no kinds module', () => {
  const ctx = vm.createContext({ console });
  ctx.globalThis = ctx;
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'writer-kinds.js'), 'utf8'), ctx);
  assert.equal(ctx.GZ_WRITER_KINDS, null);
});
