// Glaze's first screen (features/welcome.js): what a student types becomes the one site Glaze asks for.
const test = require('node:test');
const assert = require('node:assert/strict');
const W = require('../features/welcome.js');

test('the button says what it will do', () => {
  const s = require('../lib/site.js').address('bb.school.edu');
  assert.equal(W.act(null, false), 'none');
  assert.equal(W.act(null, true), 'none');
  assert.equal(W.act(s, false), 'allow');
  assert.equal(W.act(s, true), 'open');
});

test('the page wears the Frostdev Look from its definition, and asks only from a click', () => {
  const fs = require('node:fs'), path = require('node:path');
  const js = fs.readFileSync(path.join(__dirname, '../features/welcome.js'), 'utf8');
  assert.match(js, /GZ_LOOKS\.find\(\(l\) => l\.name === 'Frostdev'\)/);
  assert.match(js, /GZ_LOOK_PARTS\(\{ name: 'Frostdev' \}\)/);
  // Every request sits in a click or submit handler, before any await.
  const requests = [...js.matchAll(/chrome\.permissions\.request\(/g)].length;
  assert.equal(requests, 2);
  assert.doesNotMatch(js, /await[^;\n]*\n?[^;\n]*chrome\.permissions\.request/);
  assert.doesNotMatch(js, /\bfetch\(|XMLHttpRequest|WebSocket/, 'the page itself fetches nothing: only lib/site.js, at the sites the student names');
  // A site that isn't a course site gives its grant back.
  assert.match(js, /chrome\.permissions\.remove\(\{ origins: \[s\.pattern\] \}\)/);
});


// Run the shipped page while the worker's second check is pending: a quick Open must never race registration.
const screen = ({ granted = true } = {}) => {
  const vm = require('node:vm');
  const elements = new Map();
  const element = (name) => {
    if (!elements.has(name)) elements.set(name, {
      value: '', dataset: {}, hidden: true, handlers: {}, attributes: new Map(),
      addEventListener(type, fn) { this.handlers[type] = fn; },
      querySelector: (s) => element(`${name} ${s}`),
      setAttribute(k, v) { this.attributes.set(k, v); },
      removeAttribute(k) { this.attributes.delete(k); },
      toggleAttribute(k, on) { if (on) this.attributes.set(k, ''); else this.attributes.delete(k); },
      replaceChildren() {}, append() {}, focus() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 1, height: 1 }),
      style: { setProperty() {} }, classList: { remove() {} },
    });
    return elements.get(name);
  };
  const messages = [];
  let answer;
  const context = vm.createContext({
    document: { querySelector: element, documentElement: element('html'), body: element('body'), createElement: element, dispatchEvent() {} },
    matchMedia: () => ({ matches: true, addEventListener() {} }),
    GZ_I18N: { t: (s) => s, ui() {}, page() {} },
    GZ_SITE: { address: require('../lib/site.js').address, probe: async () => ({ kind: 'ultra', url: 'https://bb.school.edu/' }) },
    GZ_LOOKS: [{ name: 'Frostdev', colors: {}, bg: {} }], GZ_LOOK_PARTS: () => ({}),
    setTimeout() {}, clearTimeout() {}, CustomEvent: class {},
    chrome: {
      runtime: { id: 'glaze', getURL: (p) => `chrome-extension://glaze/${p}`, sendMessage: (m) => {
        messages.push(m);
        return m.op === 'yes' ? new Promise((r) => { answer = r; }) : Promise.resolve({ ok: true });
      } },
      permissions: { contains: async () => false, request: async () => granted },
    },
  });
  vm.runInContext(require('node:fs').readFileSync(require('node:path').join(__dirname, '../features/welcome.js'), 'utf8'), context);
  return { element, messages, reply: (r) => answer(r) };
};
const tick = () => new Promise(setImmediate);

test('first screen waits for the worker to approve and register before offering Open', async () => {
  const s = screen(), bar = s.element('.bar'), go = s.element('#go');
  await tick();
  s.element('#address').value = 'bb.school.edu';
  s.element('#site').handlers.submit({ preventDefault() {} });
  await tick();
  assert.equal(s.messages.at(-1).op, 'yes', 'the page found the LMS and asked for the worker check');
  assert.equal(go.attributes.has('data-busy'), true, 'Open stays blocked during the worker check');
  assert.notEqual(bar.dataset.state, 'done', 'no success before registration');
  s.reply({ ok: true });
  await tick();
  assert.equal(go.attributes.has('data-busy'), false);
  assert.equal(bar.dataset.state, 'done');
});

test('first screen does not report success when the worker rejects the second check', async () => {
  const s = screen();
  await tick();
  s.element('#address').value = 'bb.school.edu';
  s.element('#site').handlers.submit({ preventDefault() {} });
  await tick();
  s.reply({ ok: false });
  await tick();
  assert.notEqual(s.element('.bar').dataset.state, 'done');
  assert.equal(s.element('#go').attributes.has('data-busy'), false, 'the student can retry');
  assert.equal(s.element('#note').hidden, false, 'a failed approval is visible');
});


test('a dismissed first-run prompt tells the worker to stop waiting for its page', async () => {
  const s = screen({ granted: false });
  await tick();
  s.element('#address').value = 'bb.school.edu';
  s.element('#site').handlers.submit({ preventDefault() {} });
  await tick();
  assert.deepEqual(s.messages.map((m) => m.op), ['ask', 'cancel']);
  assert.equal(s.element('#go').attributes.has('data-busy'), false);
});
