const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('a count renderer owns the slot without intercepting DOM properties, including native HTML changes', async () => {
  let receive;
  const el = () => ({ style: { setProperty() {} }, dataset: {}, setAttribute() {}, getAttribute() {}, toggleAttribute() {},
    addEventListener() {}, querySelectorAll: () => [], querySelector: () => el(), getBoundingClientRect: () => ({ height: 100 }), classList: { contains: () => false } });
  const slots = Object.fromEntries(['words', 'gw', 'tb', 'href', 'menu', 'more', 'body'].map((k) => [k, el()]));
  slots.words.textContent = '';
  let n = 0;
  const editor = { words: () => n, setHTML: () => { n = 7; } };
  const root = el();
  const sandbox = { console, CSS: { escape: (v) => v },
    document: { documentElement: root, getElementById: (id) => slots[id], addEventListener() {}, head: { append() {} } },
    addEventListener: (ev, fn) => { if (ev === 'message') receive = fn; }, ResizeObserver: class { observe() {} },
    chrome: { runtime: { sendMessage: async () => ({ ok: true }) } }, GZ_I18N: { t: (k) => k, file: () => null },
    GZ_WRITER_SCHEMA: { compose: {}, loses: () => [] }, GZ_WRITER_EDITOR: { create: () => editor },
  };
  vm.createContext(sandbox); vm.runInContext(fs.readFileSync(require.resolve('../writer.js'), 'utf8'), sandbox);
  const F = sandbox.GZ_WRITER_FRAME, counts = [];
  F.on('count', () => { counts.push(editor.words()); slots.words.textContent = `${editor.words()} words`; });
  const port = { postMessage() {} }; await receive({ ports: [port], data: { type: 'glaze:writer', pass: 'test' } });
  port.onmessage({ data: { type: 'init', mode: 'compose', html: '' } });
  assert.equal(slots.words.textContent, '0 words');
  port.onmessage({ data: { type: 'html', html: '<p>Native reset</p>' } });
  assert.equal(slots.words.textContent, '7 words');
  assert.deepEqual(counts, [0, 7]);
  assert.equal(Object.getOwnPropertyDescriptor(slots.words, 'textContent').set, undefined);
});
