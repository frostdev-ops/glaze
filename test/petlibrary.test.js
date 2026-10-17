const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const { El } = require('./stand-in-dom.js');
const S = require('../lib/petsprites.js');
const library = ({ visibleGate = false, pets = [], modPets = [] } = {}) => {
  const doc = {}, sent = [], messages = [], events = {}; let observe, disconnects = 0, mounted = 0, fail = '';
  doc.createElement = (tag) => new El(tag, doc); doc.root = doc.createElement('div');
  const c = { document: doc, window: { addEventListener: (key, fn) => { events[key] = fn; } }, Uint8Array, TextDecoder,
    GZ_PET_SPRITES: S, GZ_PET_PLAYER: { mount: () => { mounted++; return { stop() {}, set() {} }; } }, GZ_DOCTEXT: require('../lib/doctext.js'),
    chrome: { runtime: { sendMessage: async (m) => { sent.push(m.op); messages.push(m); return m.op === 'get' ? { ok: true, pet: { name: 'Pet', spriteVersionNumber: 2 } } : m.op === 'mods' ? { ok: true, pets: modPets } : m.op === 'fromMod' ? { ok: modPets.length > 0 && !fail, ...(fail && { error: fail }) } : { ok: true, pets }; } } } };
  if (visibleGate) c.IntersectionObserver = class { constructor(fn) { observe = fn; } observe() {} disconnect() { disconnects++; } };
  vm.runInNewContext(fs.readFileSync(require.resolve('../lib/petlibrary.js'), 'utf8') + ';GZ_PET_LIBRARY.mount(document.root, (s) => s);', c);
  const [input, status] = doc.root.children;
  return { input, status, sent, messages, root: doc.root, failWith: (v) => { fail = v; }, show: () => observe([{ isIntersecting: true }]), close: () => events.pagehide(), mounted: () => mounted, disconnects: () => disconnects, import: async (files) => { input.files = files; await input.listeners.find((e) => e.type === 'change').f({ isTrusted: true }); } };
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

test('a hidden Pet section loads no library or atlases until it becomes visible', async () => {
  const p = library({ visibleGate: true, pets: [{ id: 'ember', name: 'Ember' }] });
  await new Promise(setImmediate);
  assert.deepEqual(p.sent, []); assert.equal(p.mounted(), 0);
  p.show(); await new Promise(setImmediate);
  assert.deepEqual(p.sent, ['mods', 'list', 'get']); assert.equal(p.mounted(), 1); assert.equal(p.disconnects(), 1);
});
test('pagehide disconnects a pending library visibility gate without loading pictures', async () => {
  const p = library({ visibleGate: true }); p.close();
  assert.equal(p.disconnects(), 1); assert.deepEqual(p.sent, []);
});

test('pets from mods: listed with their mod, added by a trusted click through the worker, and shown as added', async () => {
  const mod = 'abcdefghijklmnop';
  const modPets = [{ mod, modName: 'Garden', pet: 'mochi', name: 'Mochi 2', added: false }, { mod, modName: 'Garden', pet: 'ember', name: 'Ember 2', added: true }];
  const p = library({ modPets });
  await new Promise(setImmediate);
  const section = p.root.children[3];
  assert.equal(section.children[0].textContent, 'Pets from your mods');
  const [fresh, had] = section.children.slice(1);
  assert.equal(fresh.textContent.startsWith('Mochi 2 · Garden'), true);
  assert.equal(had.textContent, 'Ember 2 · Garden Added');
  assert.equal(had.children.filter((c) => c.tagName === 'BUTTON').length, 0, 'one already in the library has nothing to press');
  const button = fresh.children.find((c) => c.tagName === 'BUTTON');
  assert.equal(button.attrs['aria-label'], 'Add to my pets · Mochi 2');
  const click = (trusted) => button.listeners.find((l) => l.type === 'click').f({ isTrusted: trusted });
  await click(false);
  assert.equal(p.sent.includes('fromMod'), false, 'a click a page made is ignored');
  await click(true);
  assert.deepEqual(JSON.parse(JSON.stringify(p.messages.find((m) => m.op === 'fromMod'))), { type: 'glaze:petSprites', op: 'fromMod', mod, pet: 'mochi' });
  assert.equal(p.status.textContent, 'Pet imported. Choose it in your habitat.');
  // Refusals are said in words.
  const q = library({ modPets });
  await new Promise(setImmediate);
  q.failWith('full');
  await q.root.children[3].children[1].children.find((c) => c.tagName === 'BUTTON').listeners.find((l) => l.type === 'click').f({ isTrusted: true });
  assert.equal(q.status.textContent, 'Your pet library is full. Remove a pet first.');
  q.failWith('bad');
  await q.root.children[3].children[1].children.find((c) => c.tagName === 'BUTTON').listeners.find((l) => l.type === 'click').f({ isTrusted: true });
  assert.equal(q.status.textContent, 'That pet couldn’t be added.');
  // No mod carries a pet: no section at all.
  const none = library();
  await new Promise(setImmediate);
  assert.equal(none.root.children[3].children.length, 0);
});
