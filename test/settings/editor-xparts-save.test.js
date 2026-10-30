const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../options.js'), 'utf8');
const saving = source.slice(source.indexOf('  const pending = new Set()'), source.indexOf('  const get = (path)'));
const listening = source.slice(source.indexOf('  // Another surface'), source.indexOf('  // ---- share:'));
const tick = () => new Promise(setImmediate);
const page = () => {
  const writes = [], reads = [], listeners = [];
  const c = vm.createContext({ s: { parts: null, nav: {} }, clearTimeout() {}, setTimeout: () => 1, addEventListener() {},
    hint() {}, t: (s) => s, fill() {},
    chrome: { storage: { onChanged: { addListener: (f) => listeners.push(f) } } },
    GZ_UI: { save: (s, keys, done, nav, partKeys) => writes.push({ parts: structuredClone(s.parts), keys, done, partKeys: partKeys && [...partKeys] }), load: () => new Promise((resolve) => reads.push(resolve)) },
  });
  vm.runInContext(`${saving}\n${listening}\nglobalThis.save = save; globalThis.flush = flush;`, c);
  return { c, writes, reads, changed: () => listeners[0]({ lookX: {} }, 'sync') };
};

test('builder save batching forwards the touched parts and keeps whole Look replacements whole', () => {
  const p = page();
  p.c.save(['parts'], true, ['nav']); p.c.save(['parts'], true, ['rules']); p.c.flush();
  assert.deepEqual(p.writes[0].partKeys, ['nav', 'rules']);
  p.c.save(['parts'], true); p.c.save(['parts'], true, ['nav']); p.c.flush();
  assert.equal(p.writes[1].partKeys, undefined);
});

test('storage echoes wait for queued saves, and a read cannot roll back a newer edit', async () => {
  const p = page();
  p.c.s.parts = { x: { nav: { place: 'top' } } }; p.c.save(['parts']); p.changed();
  assert.equal(p.reads.length, 0, 'a save is still in the worker queue');
  p.c.s.parts = { x: { nav: { place: 'dock' } } }; p.c.save(['parts']);
  p.writes[0].done('');
  assert.equal(p.reads.length, 0, 'the second save has not finished');
  p.writes[1].done('');
  assert.equal(p.reads.length, 1, 'read the worker merge after the last acknowledgement');
  p.c.s.parts = { x: { nav: { place: 'bottom' } } }; p.c.save(['parts'], true);
  p.reads[0]({ parts: { x: { nav: { place: 'dock' } } } }); await tick();
  assert.equal(p.c.s.parts.x.nav.place, 'bottom');
});

test('an older storage read cannot overwrite a later external Look', async () => {
  const p = page(); p.changed(); p.changed();
  p.reads[1]({ parts: { x: { nav: { place: 'dock' } } } }); await tick();
  p.reads[0]({ parts: null }); await tick();
  assert.equal(p.c.s.parts?.x.nav.place, 'dock');
});
