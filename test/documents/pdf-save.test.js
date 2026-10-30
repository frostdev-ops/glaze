// Execute the viewer's actual save/replacement closures with controlled storage and a paused bake.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const { deferred, tick, Element } = require('../helpers/pdf-ui.cjs');
const source = fs.readFileSync(require.resolve('../../extension/pdf-kind.js'), 'utf8');
const harness = () => {
  const ui = new Element('main'), life = new AbortController(), bake = deferred(), calls = [], events = new Map();
  const rec = { revision: 1, file: { hash: 'base' }, size: 1 }, target = { id: 'v', kind: 'pdf', file: { hash: 'target' }, pages: 2 };
  const ctx = { console: { error() {} }, JSON, Error, RangeError, FileError: class extends Error {}, setTimeout, clearTimeout, signal: life.signal, ui, src: null, key: 'doc:x', rec, modified: () => {},
    tools: { commit() {}, extraUndo() {}, dispose() {} }, signs: { cancel() {}, busy: () => false }, doc: { numPages: 1, annotationStorage: {} }, t: (s) => s,
    state: {}, SIGNED: '', LOCKED: '', PROTECTED: '', TOO_BIG: '',
    st: { get: async () => rec, save: async (...args) => { calls.push(args); return { paper: { ...rec, revision: 2 }, version: { id: 'undo' } }; }, restore: async () => {}, version: async () => target },
    STORE: { get: async (r) => new Uint8Array([r?.file?.hash === 'target' ? 2 : 1]), put: async (bytes) => ({ file: { hash: String(bytes[0]) } }) },
    pdfdoc: async () => ({ save: async () => ({ bytes: new Uint8Array([1]) }), bake: () => bake.promise }),
    read: async () => ({ doc: {}, task: { destroy: async () => {} } }), picture: async () => null,
    GZ_PDF_PAGES: { toOps: () => [{ op: 'blank' }] }, GZ_DOC_KINDS: { progress: () => Object.assign(() => {}, { end() {}, fail() {} }) },
    location: { reload() {} }, sessionStorage: { getItem() {}, setItem() {}, removeItem() {} },
    pagesB: null, versB: null, back: null, document: new Element('document'), addEventListener: (name, fn) => events.set(name, fn),
  };
  const block = source.slice(source.indexOf('    // ---- saving:'), source.indexOf('    // ---- the title:'));
  vm.runInNewContext(`${block}\n globalThis.api = { flush, applyPages, restoreTo, modify: () => modified() };`, ctx);
  return { ...ctx.api, ctx, ui, calls, bake, events, close: () => life.abort() };
};
test('page replacement blocks interactions until reload and cannot autosave the old document over Done', async (t) => {
  const h = harness(); t.after(h.close);
  const applying = h.applyPages({}); await tick();
  assert.equal(h.ui.inert, true, 'the viewer is fenced while baking');
  h.bake.resolve({ bytes: new Uint8Array([3]), pages: 2 }); await applying;
  h.events.get('beforeunload')({ preventDefault() { assert.fail('a successful replacement must reload'); } });
  assert.equal(h.calls.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls[0][2].expectedFile)), { hash: 'base' });
});
test('a restore captures its target before a flush can evict that version', async (t) => {
  const h = harness(); t.after(h.close);
  h.ctx.st.restore = async () => assert.fail('restore must not look up a possibly evicted version after flushing');
  h.modify();
  await h.restoreTo('v');
  assert.equal(h.calls.length, 2);
  assert.equal(h.calls[1][1].file.hash, '2', 'the selected version bytes');
  assert.equal(h.calls[1][2].reason, 'restore');
});

test('a no-op save does not spend the visit\'s first edited-file version', async (t) => {
  const h = harness(); t.after(h.close);
  const reasons = [];
  h.ctx.st.save = async (_key, _patch, options) => {
    reasons.push(options.reason);
    return { paper: h.ctx.rec, version: reasons.length === 2 ? { id: 'original' } : null };
  };
  for (let i = 0; i < 3; i++) { h.modify(); await h.flush(); }
  assert.deepEqual(reasons, ['edit', 'edit', 'auto'], 'only a save that kept the old file consumes first');
});
