const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = () => fs.readFileSync(process.env.WRITER_PAPER_SOURCE || path.join(__dirname, '../writer-paper.js'), 'utf8');
const paper = () => {
  const text = source(), from = text.indexOf('    // The paper becomes the Word file'), to = text.indexOf("    file.addEventListener('change'", from);
  const applied = [], saved = [], snapshots = [], notices = [], api = {}, root = { inert: false, isConnected: true };
  const view = { props: { editable: () => true }, state: { doc: { label: 'draft' } }, setProps(p) { Object.assign(this.props, p); }, focus() {} };
  const ctx = vm.createContext({ console: { error() {} }, RangeError, ArrayBuffer, Uint8Array, DOCX: [], format: {}, key: 'original', paper: {}, root, view, current: api, api,
    need: async () => {}, GZ_WRITER_DOCX: { importDocx: async () => ({ doc: { type: 'doc', text: 'imported' }, html: '<p>Imported</p>', warnings: [] }) },
    S: { paper: { nodeFromJSON: (json) => ({ toJSON: () => json }) } }, PA: require('../lib/writer-papers.js'), keep: false,
    F: { check: () => ({ issues: [{ rule: 'spacing' }] }), KEPT: new Set(['spacing']) },
    save: async () => { snapshots.push(ctx.keep); return true; }, record: () => ({ keep: ctx.keep }), t: (k) => k, restore: () => {}, toast: (text, act) => notices.push({ text, act }),
    store: { save: async (k, patch) => { saved.push(k); return { paper: patch, version: { id: 'before' } }; } },
    setDoc: (json) => { applied.push(json); view.state.doc = json; },
  });
  const own = text.slice(text.indexOf('    const ownFormatting = ')).split('\n')[0];
  const importFile = vm.runInContext(`${own}\n${text.slice(from, to)} importFile`, ctx);
  const file = (name = 'original.docx') => ({ name, size: 3, type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', arrayBuffer: async () => new ArrayBuffer(3) });
  const flush = async () => { for (let i = 0; i < 5; i++) await new Promise(setImmediate); };
  return { ctx, root, view, applied, saved, snapshots, notices, importFile, file, flush };
};
for (const change of ['unmounted', 'key', 'doc']) test(`review: an import read cannot replace a changed ${change}`, async () => {
  const p = paper(); let finish;
  const importing = p.importFile({ ...p.file(), arrayBuffer: () => new Promise((r) => { finish = r; }) });
  await p.flush();
  if (change === 'unmounted') p.root.isConnected = false;
  if (change === 'key') p.ctx.key = 'different';
  if (change === 'doc') p.view.state.doc = { label: 'newer edits' };
  finish(new ArrayBuffer(3)); await importing;
  assert.equal(p.applied.length + p.saved.length, 0);
});
test('review: importing holds editability from the start and serializes another import', async () => {
  const p = paper(); let finish, reads = 0;
  const first = p.importFile({ ...p.file(), arrayBuffer: () => new Promise((r) => { finish = r; }) });
  assert.equal(p.root.inert, true);
  assert.equal(p.view.props.editable(), false);
  await p.flush();
  await p.importFile({ ...p.file('second.docx'), arrayBuffer: async () => { reads++; return new ArrayBuffer(3); } });
  assert.equal(reads, 0);
  finish(new ArrayBuffer(3)); await first;
  assert.equal(p.applied.length, 1);
  assert.equal(p.root.inert, false);
  assert.equal(p.view.props.editable(), true);
});
test('review: an oversized Word import is rejected before reading it', async () => {
  const p = paper(); let reads = 0;
  await p.importFile({ ...p.file(), size: 15e6 + 1, arrayBuffer: async () => { reads++; return new ArrayBuffer(3); } });
  assert.equal(reads + p.applied.length + p.saved.length, 0);
  assert.equal(p.notices[0].text, 'Choose a Word file smaller than 15 MB.');
});

test('import saves the outgoing paper with its own formatting choice', async () => {
  const p = paper();
  await p.importFile(p.file());
  assert.deepEqual(p.snapshots, [false], 'the pre-import version belongs to the outgoing document');
  assert.equal(p.ctx.paper.keep, true, 'the imported document keeps its own formatting');
  assert.equal(p.ctx.keep, true);
});

test('a failed import save leaves the current formatting choice intact', async () => {
  const p = paper();
  p.ctx.save = async () => false;
  await p.importFile(p.file());
  assert.equal(p.ctx.keep, false);
  assert.equal(p.applied.length, 0);
});

test('a Word import saves the new word count before its editor autosave', async () => {
  const p = paper();
  p.ctx.record = () => ({ words: 100 });
  p.ctx.GZ_WRITER_DOCX.importDocx = async () => ({ doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Three new words.' }] }] }, warnings: [] });
  await p.importFile(p.file());
  assert.equal(p.ctx.paper.words, 3);
});
