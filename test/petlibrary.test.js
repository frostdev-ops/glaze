const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const { El } = require('./stand-in-dom.js');
const S = require('../lib/petsprites.js');
const library = () => {
  const doc = {}, sent = [];
  doc.createElement = (tag) => new El(tag, doc); doc.root = doc.createElement('div');
  const c = { document: doc, window: { addEventListener() {} }, Uint8Array, TextDecoder,
    GZ_PET_SPRITES: S, GZ_DOCTEXT: require('../lib/doctext.js'),
    chrome: { runtime: { sendMessage: async (m) => { sent.push(m.op); return { ok: true, pets: [] }; } } } };
  vm.runInNewContext(fs.readFileSync(require.resolve('../lib/petlibrary.js'), 'utf8') + ';GZ_PET_LIBRARY.mount(document.root, (s) => s);', c);
  const [input, status] = doc.root.children;
  return { input, status, sent, import: async (files) => { input.files = files; await input.listeners.find((e) => e.type === 'change').f({ isTrusted: true }); } };
};
test('malformed ZIP and JSON failures show a translatable package error without writing', async () => {
  for (const files of [
    [{ name: 'pet.zip', size: 4, arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer }],
    [{ name: 'pet.json', size: 1, text: async () => '{' }, { name: 'spritesheet.png', size: 4 }],
  ]) {
    const p = library(); await p.import(files);
    assert.equal(p.status.textContent, 'Invalid pet package.');
    assert.equal(p.sent.includes('import'), false); assert.equal(p.input.disabled, false);
  }
});
test('validated sprite failures retain their actionable translated explanation', async () => {
  const p = library(); await p.import([{ name: 'spritesheet.png', size: S.MAX_INPUT + 1 }]);
  assert.equal(p.status.textContent, 'Pet files must be at most 20 MB.');
  assert.equal(p.sent.includes('import'), false);
});
