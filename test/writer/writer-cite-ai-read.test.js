// Cite's AI reading of a thin web page (writer/frame/writer-cite.js aiRead) against the real writer.cite task's input
// check (ai/tasks/writer-cite.js): what the frame sends is what the task accepts, so the reading runs.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const S = require('../../extension/writer/writer-sources.js'), C = require('../../extension/writer/writer-cite.js'), LK = require('../../extension/writer/writer-lookup.js');
require('../../extension/writer/writer-schema.js');
const TASK = require('../../extension/ai/tasks/writer-cite.js').task;

test('a thin page is read by the AI with the input writer.cite accepts, and its answer fills the source', async () => {
  const URL_ = 'https://news.example.org/story';
  const html = '<html><head><title>A Quiet Year</title></head><body>A Quiet Year. By Ann Lee. Published March 3, 2021.</body></html>';
  const facts = { metas: [['og:site_name', 'Example News']], jsonld: [], title: 'A Quiet Year', canonical: '', text: 'A Quiet Year. By Ann Lee. Published March 3, 2021.' };
  const sent = [];
  const port = { listeners: [], onMessage: { addListener(fn) { port.listeners.push(fn); }, removeListener(fn) { port.listeners = port.listeners.filter((x) => x !== fn); } }, onDisconnect: { addListener() {} }, disconnect() {},
    postMessage(m) {
      sent.push(m);
      const reply = m.op === 'status' ? { id: m.id, type: 'status', allowed: true, ready: true }
        : TASK.input(m.input) ? { id: m.id, type: 'end', output: { type: 'webpage', title: 'A Quiet Year', author: [{ family: 'Lee', given: 'Ann' }], issued: { 'date-parts': [[2021, 3, 3]] }, URL: URL_ } }
          : { id: m.id, type: 'error', error: 'input' };
      queueMicrotask(() => port.listeners.slice().forEach((fn) => fn(reply)));
    } };
  const chrome = {
    storage: { local: { get: async () => ({ ai: { on: true, features: { writing: true } } }) } },
    runtime: { getManifest: () => ({ host_permissions: ['<all_urls>'] }), connect: () => port, sendMessage: async (m) => (m.type === 'glaze:writer-lookup' ? { ok: true, text: html, url: URL_ } : null) },
  };
  const scope = vm.createContext({ console, setTimeout, clearTimeout, queueMicrotask, URL, chrome, ResizeObserver: class { observe() {} }, DOMParser: class { parseFromString() { return {}; } }, addEventListener() {},
    document: { createElement: () => ({ append() {}, setAttribute() {}, addEventListener() {} }), body: { append() {} }, getElementById: () => null, addEventListener() {} },
    GZ_PM: globalThis.GZ_PM, GZ_WRITER_CITE: { ...C }, GZ_WRITER_SOURCES: S, GZ_WRITER_LOOKUP: { ...LK, facts: () => facts },
    GZ_WRITER_FRAME: { on() {}, slot: () => null, editor: () => null, mode: () => 'compose', t: (s) => s } });
  vm.runInContext(fs.readFileSync(require.resolve('../../extension/writer/frame/writer-cite.js'), 'utf8'), scope);
  const said = [];
  const src = await scope.GZ_WRITER_CITE.lookup(URL_, (s) => said.push(s));
  const run = sent.find((m) => m.op === 'run');
  assert.ok(run, 'the AI was asked');
  assert.ok(TASK.input(run.input), `writer.cite accepts what the frame sends: ${Object.keys(run.input)}`);
  assert.equal(run.input.text, facts.text);
  assert.equal(src.author?.[0]?.family, 'Lee', 'the AI\'s reading fills the thin page\'s source');
});
