const test = require('node:test');
const assert = require('node:assert/strict');
const worker = require('../helpers/worker-env.cjs');
const vm = require('node:vm');

const CANVAS = 'https://school.instructure.com', EXT = 'chrome-extension://x';
const page = (patch = {}) => ({ id: 'glaze', frameId: 0, url: `${CANVAS}/courses/25/pages/week-3`, origin: CANVAS,
  tab: { id: 7, url: `${CANVAS}/courses/25/pages/week-3` }, ...patch });
const store = () => ({ sync: { version: 2, enabled: true, enhance: { bbPreviews: true }, writer: { pdf: true, slides: true, sheets: true } }, local: {}, session: {} });
const ask = (w, sender = page(), kind = 'slides', pass = 'a'.repeat(36)) => w.send({ type: 'glaze:canvas-view', kind, pass }, sender);

test('Canvas viewer passes follow the preview and individual Writer switches', async () => {
  for (const [key, kind] of [['pdf', 'pdf'], ['slides', 'slides'], ['sheets', 'sheet']]) {
    const w = worker({ store: store() });
    assert.deepEqual(await ask(w, page(), kind), { ok: true });
    w.store.sync.writer[key] = false;
    assert.deepEqual(await ask(w, page(), kind, 'b'.repeat(36)), { ok: false }, `${key} off`);
  }
  for (const off of ['enabled', 'bbPreviews']) {
    const w = worker({ store: store() });
    if (off === 'enabled') w.store.sync.enabled = false; else w.store.sync.enhance.bbPreviews = false;
    assert.deepEqual(await ask(w), { ok: false }, off);
  }
  assert.deepEqual(await ask(worker({ store: store() }), page(), 'paper'), { ok: false }, 'unsupported kind');
});

test('Canvas viewer passes require a course file page or link page in its own tab or same-site course frame', async () => {
  const w = worker({ store: store() });
  const refused = [
    page({ id: 'other-extension' }), page({ tab: undefined }), page({ tab: { id: '7', url: page().url } }),
    page({ url: `${CANVAS}/login` }), page({ url: `${CANVAS}/courses/25/settings` }),
    page({ frameId: 3, tab: { id: 7, url: 'https://evil.example/' } }),
    page({ frameId: 3, origin: 'null' }), page({ frameId: 3, url: 'about:blank' }),
  ];
  for (const s of refused) assert.deepEqual(await ask(w, s), { ok: false }, JSON.stringify(s));
  assert.deepEqual(await ask(w, page({ frameId: 3 })), { ok: true });
});

test('Canvas passes are one-use, tab-bound and claim no AI host or MAIN-world script', async () => {
  const scripts = [];
  const w = worker({ store: store() });
  w.context.chrome.scripting.executeScript = async (s) => { scripts.push(s); return []; };
  const frame = (tab = 7) => ({ id: 'glaze', frameId: 4, documentId: 'viewer', url: `${EXT}/writer.html`, origin: EXT, tab: { id: tab, url: page().url } });
  const claim = (pass, sender = frame()) => w.send({ type: 'glaze:writer', op: 'claim', pass }, sender);
  const pass = 'a'.repeat(36), other = 'b'.repeat(36);
  assert.deepEqual(await ask(w), { ok: true });
  assert.deepEqual(await claim(pass), { ok: true });
  assert.deepEqual(await claim(pass), { ok: false });
  assert.deepEqual(await ask(w, page(), 'slides', other), { ok: true });
  assert.deepEqual(await claim(other, frame(8)), { ok: false });
  assert.equal(vm.runInContext('aiHosts.size', w.context), 0);
  assert.deepEqual(w.store.session.aiHosts || {}, {});
  assert.deepEqual(scripts, []);
});
