// Execute the viewer's actual save/replacement closures with controlled storage and a paused bake.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const { deferred, tick, Element } = require('../helpers/pdf-ui.cjs');
const source = fs.readFileSync(require.resolve('../../extension/documents/pdf/pdf-kind.js'), 'utf8');
const H = (c) => c.repeat(64);
const session = (init = {}) => { const m = new Map(Object.entries(init)); return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); } }; };
const harness = ({ storage = session(), revision = 1, edited } = {}) => {
  const ui = new Element('main'), life = new AbortController(), bake = deferred(), calls = [], events = new Map(), migrations = [], extra = [];
  const rec = { revision, ...(edited !== undefined && { edited }), file: { hash: H('b'), size: 1, type: 'application/pdf' }, size: 1, pages: 3, thumb: 'data:image/png;base64,AA==' };
  const ctx = { console: { error() {} }, JSON, Error, RangeError, FileError: class extends Error {}, setTimeout, clearTimeout, signal: life.signal, ui, src: null, key: 'doc:x', rec, modified: () => {},
    tools: { commit() {}, extraUndo(x) { extra.push(x); }, dispose() {} }, signs: { cancel() {}, busy: () => false }, doc: { numPages: 1, annotationStorage: {} }, t: (s) => s,
    state: {}, SIGNED: '', LOCKED: '', PROTECTED: '', TOO_BIG: '', PA: { isRef: (f) => /^[0-9a-f]{64}$/.test(f?.hash || '') },
    st: { get: async () => rec, save: async (...args) => { calls.push(args); return { paper: { ...rec, ...args[1], revision: rec.revision + 1 }, version: null, ...(args[2].hold && { held: true }) }; }, migrate: async (...args) => { migrations.push(args); return { moved: 0 }; } },
    STORE: { get: async () => new Uint8Array([1]), put: async () => ({ file: { hash: H('d'), size: 1, type: 'application/pdf' }, size: 1 }) },
    pdfdoc: async () => ({ save: async () => ({ bytes: new Uint8Array([1]) }), bake: () => bake.promise }),
    read: async () => ({ doc: {}, task: { destroy: async () => {} } }), picture: async () => null,
    GZ_PDF_PAGES: { toOps: () => [{ op: 'blank' }] }, GZ_DOC_KINDS: { progress: () => Object.assign(() => {}, { end() {}, fail() {} }) },
    location: { reload() {} }, sessionStorage: storage, task: null, drawTimer: 0, life, closeMenu() {},
    sizing: { disconnect() {} }, l10n: { destroy() {} }, viewer: { setDocument() {} }, links: { setDocument() {} }, finder: { setDocument() {} },
    pagesB: null, back: null, document: new Element('document'), addEventListener: (name, fn) => events.set(name, fn),
  };
  const block = source.slice(source.indexOf('    // ---- saving:'), source.indexOf('    // ---- the title:'));
  vm.runInNewContext(`${block}\n globalThis.api = { flush, applyPages, modify: () => modified() };`, ctx);
  return { ...ctx.api, ctx, ui, calls, bake, events, migrations, extra, storage, close: () => life.abort() };
};
const UNDO = 'gq-pages-undo:doc:x';

test('opening a second viewer without an Undo pointer does not release another tab\'s hold', (t) => {
  const h = harness(); t.after(h.close);
  assert.deepEqual(h.migrations, [], 'this tab has no hold to release');
});

test('renaming after Done does not discard Undo when the file is unchanged', (t) => {
  const storage = session({ [UNDO]: JSON.stringify({ file: { hash: H('a'), size: 7, type: 'application/pdf' }, size: 7, pages: 3, revision: 2 }) });
  const h = harness({ storage, revision: 3, edited: 2 }); t.after(h.close);
  assert.equal(typeof h.extra[0]?.run, 'function', 'the file edit revision still matches Done');
  assert.ok(storage.getItem(UNDO));
});

test('Done releases its hold if session storage cannot keep the Undo pointer', async (t) => {
  const storage = session();
  storage.setItem = () => { throw new Error('storage unavailable'); };
  const h = harness({ storage }); t.after(h.close);
  h.migrations.length = 0;
  const applying = h.applyPages({}); await tick();
  h.bake.resolve({ bytes: new Uint8Array([3]), pages: 2 }); await applying;
  assert.equal(h.migrations.length, 1, 'no abandoned hold after Done');
  assert.equal(h.migrations[0][1].file.hash, H('b'), 'release only the file held by this Done');
});

test('page replacement blocks interactions until reload and cannot autosave the old document over Done', async (t) => {
  const h = harness(); t.after(h.close);
  const applying = h.applyPages({}); await tick();
  assert.equal(h.ui.inert, true, 'the viewer is fenced while baking');
  h.bake.resolve({ bytes: new Uint8Array([3]), pages: 2 }); await applying;
  h.events.get('beforeunload')({ preventDefault() { assert.fail('a successful replacement must reload'); } });
  assert.equal(h.calls.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(h.calls[0][2].expectedFile)), { hash: H('b'), size: 1, type: 'application/pdf' });
});

test('every viewer save replaces the file: no reason that keeps a version', async (t) => {
  const h = harness(); t.after(h.close);
  for (let i = 0; i < 3; i++) { h.modify(); await h.flush(); }
  assert.deepEqual(h.calls.map((c) => c[2].reason ?? 'auto'), ['auto', 'auto', 'auto']);
  assert.ok(h.calls.every((c) => !c[2].hold));
});

test('Done holds the file before it for Undo: a pointer for this tab, no version', async (t) => {
  const h = harness(); t.after(h.close);
  const applying = h.applyPages({}); await tick();
  h.bake.resolve({ bytes: new Uint8Array([3]), pages: 2 }); await applying;
  assert.equal(h.calls[0][2].hold, true);
  assert.equal(h.calls[0][2].reason, 'edit');
  const u = JSON.parse(h.storage.getItem(UNDO));
  assert.deepEqual([u.file.hash, u.pages, u.revision, u.thumb], [H('b'), 3, 2, 'data:image/png;base64,AA==']);
  assert.equal(u.id, undefined, 'not a version');
});

test('after the reload, Undo puts the held file back and forgets it', async (t) => {
  const storage = session({ [UNDO]: JSON.stringify({ file: { hash: H('a'), size: 7, type: 'application/pdf' }, size: 7, pages: 3, thumb: null, revision: 2 }) });
  const h = harness({ storage, revision: 2 }); t.after(h.close);
  assert.deepEqual(h.migrations, [], 'a visit holding Undo keeps the copy');
  assert.equal(typeof h.extra[0]?.run, 'function', 'Undo offered');
  await h.extra[0].run();
  assert.equal(h.calls.length, 1);
  const [, patch, o] = h.calls[0];
  assert.deepEqual([patch.file.hash, patch.size, patch.pages, o.reason, o.expectedFile.hash], [H('a'), 7, 3, 'restore', H('b')]);
  assert.equal(storage.getItem(UNDO), null);
});

test('an edit save after Done lets the held copy go: the pointer and Undo with it', async (t) => {
  const storage = session({ [UNDO]: JSON.stringify({ file: { hash: H('a'), size: 7, type: 'application/pdf' }, size: 7, pages: 3, revision: 2 }) });
  const h = harness({ storage, revision: 2 }); t.after(h.close);
  h.modify(); await h.flush();
  assert.equal(storage.getItem(UNDO), null);
  assert.equal(h.extra.at(-1), null, 'Undo withdrawn');
});

test('a stale Undo pointer is forgotten without releasing another tab\'s hold; closing releases its own', async (t) => {
  const stale = session({ [UNDO]: JSON.stringify({ file: { hash: H('a'), size: 7, type: 'application/pdf' }, size: 7, pages: 3, revision: 1 }) });
  const h = harness({ storage: stale, revision: 5 }); t.after(h.close);
  assert.deepEqual(h.migrations, []);
  assert.equal(stale.getItem(UNDO), null);
  const storage = session({ [UNDO]: JSON.stringify({ file: { hash: H('a'), size: 7, type: 'application/pdf' }, size: 7, pages: 3, revision: 2 }) });
  const k = harness({ storage, revision: 2 }); t.after(k.close);
  k.events.get('pagehide')();
  await tick();
  assert.deepEqual(JSON.parse(JSON.stringify(k.migrations)), [['doc:x', { release: true, file: { hash: H('a'), size: 7, type: 'application/pdf' } }]]);
  assert.equal(storage.getItem(UNDO), null);
});
