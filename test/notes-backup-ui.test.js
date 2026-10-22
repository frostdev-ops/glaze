const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const N = require('../lib/notes.js');
const Z = require('../lib/zip.js');
const D = require('../lib/doctext.js');

test('backup import explains oversized skips instead of claiming the missing note was already present', async () => {
  const elements = new Map(), sent = [];
  const make = () => ({ hidden: true, value: '', textContent: '', handlers: {}, classList: { contains: () => false, toggle() {} },
    addEventListener(type, f) { this.handlers[type] = f; }, append() {}, replaceChildren() {} });
  const $ = (s) => { if (!elements.has(s)) elements.set(s, make()); return elements.get(s); };
  const context = vm.createContext({
    URL, URLSearchParams, TextEncoder, TextDecoder, Uint8Array, Blob, setTimeout, clearTimeout,
    GZ_NOTES: N, GZ_DOCTEXT: D, GZ_ZIP: Z,
    GZ_I18N: { ui: () => 'en', t: (s, v = {}) => s.replace(/\{(\w+)\}/g, (_, k) => v[k]) },
    navigator: { userActivation: { isActive: true } }, location: { search: '' },
    document: { querySelector: $, createElement: make }, addEventListener() {},
    MutationObserver: class { observe() {} },
    chrome: { runtime: { sendMessage: async (m) => { sent.push(m); return { ok: true, done: 0, skipped: 1 }; } } },
  });
  vm.runInContext(fs.readFileSync(require.resolve('../lib/sessions-ui.js'), 'utf8'), context);
  $('#nb-account').value = 'notesIdx:https://school.instructure.com/5';
  const json = JSON.stringify({ format: 'glaze-notes', version: 1, site: 'https://school.instructure.com', folders: [], files: [], notes: [
    { id: '00000000-0000-4000-8000-000000000001', html: '<p>x</p>'.repeat(60000) },
  ] });
  const bytes = new Uint8Array(await new Blob(Z.zip([{ name: 'notes.json', data: new TextEncoder().encode(json) }])).arrayBuffer());
  $('#nb-file').files = [{ name: 'notes.zip', size: bytes.length, arrayBuffer: async () => bytes.buffer }];
  $('#nb-file').handlers.change({ isTrusted: true, target: $('#nb-file') });
  for (let i = 0; i < 20; i++) await new Promise(setImmediate);
  assert.equal(sent.filter((m) => m.op === 'notesImport').length, 1, $('#nb-status').textContent);
  assert.match($('#nb-status').textContent, /too large/i);
  assert.doesNotMatch($('#nb-status').textContent, /Skipped, already here and not older/);
});
