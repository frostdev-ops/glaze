// features/docviewer.js in a VM with a small stand-in DOM: the gestures and the import, where a real viewer can't be had.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const CANVAS = 'https://school.instructure.com';
const settle = async () => { for (let i = 0; i < 5; i++) await new Promise(setImmediate); };

class El {
  constructor(tag) { Object.assign(this, { tagName: tag.toUpperCase(), children: [], attrs: {}, dataset: {}, style: {}, listeners: {}, parentNode: null, textContent: '' }); }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k] ?? null; }
  hasAttribute(k) { return k in this.attrs; }
  removeAttribute(k) { delete this.attrs[k]; }
  toggleAttribute(k, on) { if (on) this.attrs[k] = ''; else delete this.attrs[k]; }
  append(...c) { for (const x of c) if (typeof x === 'object') { x.remove(); x.parentNode = this; this.children.push(x); } }
  replaceChildren(...c) { for (const x of this.children) x.parentNode = null; this.children = []; this.append(...c); }
  remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter((x) => x !== this); this.parentNode = null; }
  get isConnected() { return !!this.parentNode; }
  get firstChild() { return this.children[0] || null; }
  addEventListener(t, f) { (this.listeners[t] ||= []).push(f); }
  fire(t, e = {}) { return Promise.all((this.listeners[t] || []).map((f) => f({ type: t, currentTarget: this, target: this, preventDefault() {}, stopPropagation() {}, ...e }))); }
  click() { this.fire('click'); }
  focus() {}
  attachShadow() { return (this.shadowRoot = new El('#shadow')); }
  querySelector(sel) { return sel.includes('gz-ink') ? this.children.find((c) => c.attrs.class === 'gz-ink') || null : null; }
  closest() { return null; }
  setPointerCapture(id) { this.captured = id; }
  releasePointerCapture(id) { this.released = id; }
  getScreenCTM() { return { inverse: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }) }; }
  find(label) { for (const c of [...this.children, ...(this.shadowRoot ? [this.shadowRoot] : [])]) { if (c.attrs?.['aria-label'] === label) return c; const x = c.find(label); if (x) return x; } return null; }
}

const viewer = () => {
  const html = new El('html');
  const body = new El('body');
  html.append(body);
  const page = Object.assign(new El('div'), { id: 'page-1', clientWidth: 600, clientHeight: 800 });
  body.append(page);
  const win = {};
  const sets = [];
  const inputs = [];
  const parent = { postMessage() {} };
  const store = {};
  const document = {
    documentElement: html, head: null, body, contentType: 'text/html', readyState: 'complete', addEventListener() {},
    createElement: (t) => { const e = new El(t); if (t === 'input') inputs.push(e); return e; },
    createElementNS: (ns, t) => new El(t),
    querySelectorAll: (sel) => (sel.startsWith('.Page') ? [page] : sel === '.gz-ink' ? page.children.filter((c) => c.attrs.class === 'gz-ink') : []),
    querySelector: () => null,
    getElementById: (id) => (id === 'page-1' ? page : null),
  };
  const ctx = vm.createContext({
    document, parent, top: {}, location: { hostname: 'canvadocs.instructure.com', ancestorOrigins: [CANVAS] },
    addEventListener: (t, f) => (win[t] ||= []).push(f),
    requestAnimationFrame: (f) => { f(); return 0; },
    MutationObserver: class { observe() {} disconnect() {} },
    DOMPoint: class { constructor(x, y) { this.x = x; this.y = y; } matrixTransform() { return { x: this.x, y: this.y }; } },
    GZ_INK: require('../lib/ink.js'),
    chrome: { storage: {
      onChanged: { addListener() {} },
      local: {
        get: async (k) => ({ [k]: store[k] }),
        set: async (o) => { sets.push(JSON.parse(JSON.stringify(o))); Object.assign(store, o); },
        remove: async (k) => { delete store[k]; },
      },
    } },
  });
  ctx.window = ctx;
  vm.runInContext(fs.readFileSync(path.join(root, 'features/docviewer.js'), 'utf8'), ctx);
  const fire = (t, e) => { for (const f of win[t] || []) f({ preventDefault() {}, stopPropagation() {}, ...e }); };
  const tell = async (more = {}) => { fire('message', { source: parent, origin: CANVAS, data: { gz: 'docs', on: true, ink: true, file: '21', user: '5', ...more } }); await settle(); };
  const bar = () => body.children.find((c) => c.id === 'gz-ink-bar');
  const svg = () => page.children.find((c) => c.attrs.class === 'gz-ink');
  const pointer = (type, id, x, y) => svg().fire(type, { pointerType: 'mouse', button: 0, pointerId: id, clientX: x, clientY: y });
  return { html, tell, fire, bar, svg, pointer, sets, inputs };
};

test('Esc in the middle of a stroke lets the pointer go and drops the half stroke; the next stroke draws', async () => {
  const v = viewer();
  await v.tell();
  v.bar().find('Annotate').click();
  assert.equal(v.html.attrs['data-gz-tool'], 'pen');
  v.pointer('pointerdown', 1, 10, 10);
  v.pointer('pointermove', 1, 50, 50);
  v.fire('keydown', { key: 'Escape' });
  assert.equal(v.html.attrs['data-gz-tool'], undefined, 'the tool is down');
  assert.equal(v.svg().released, 1, 'the pointer is let go');
  v.pointer('pointerup', 1, 60, 60);
  await settle();
  assert.equal(v.sets.length, 0, 'the half stroke is not saved');
  v.bar().find('Pen').click();
  v.pointer('pointerdown', 2, 100, 100);
  v.pointer('pointermove', 2, 200, 120);
  v.pointer('pointerup', 2, 300, 140);
  await settle();
  assert.equal(v.sets.length, 1, 'a new stroke draws');
  const [stroke] = Object.values(v.sets[0])[0].pages['1'];
  assert.deepEqual(stroke.p.slice(0, 2), [100, 100], 'from where it began, nothing of the dropped one');
});

test('a Canvas tool picked by keyboard (a click without a pointer) puts Glaze\'s pen down; Glaze\'s own bar does not', async () => {
  const v = viewer();
  await v.tell();
  v.bar().find('Annotate').click();
  const host = v.bar();
  host.closest = () => host;
  v.fire('click', { target: host });
  assert.equal(v.html.attrs['data-gz-tool'], 'pen', 'a click in Glaze\'s bar keeps it');
  const tool = new El('button');
  tool.closest = (sel) => (sel.includes('#gz-ink-bar') ? null : tool);
  v.fire('click', { target: tool });
  assert.equal(v.html.attrs['data-gz-tool'], undefined, 'Canvas\'s tool gets the pages back');
});

const file = (pages) => {
  let resolve;
  const text = new Promise((y) => { resolve = y; });
  return { f: { size: 100, text: () => text }, done: () => resolve(require('../lib/ink.js').exportFile('21', pages)) };
};
const MARK = { 1: [{ t: 'pen', c: '#e11d48', w: 3, p: [1, 1, 9, 9] }] };

for (const [what, change] of [
  ['another file opens', (v) => v.tell({ file: '22' })],
  ['annotations go off and on again', async (v) => { await v.tell({ ink: false }); await v.tell(); }],
]) {
  test(`an import still being read when ${what} is dropped`, async () => {
    const v = viewer();
    await v.tell();
    v.bar().find('Annotate').click();
    v.bar().find('Import annotations').click();
    const input = v.inputs.at(-1);
    const { f, done } = file(MARK);
    input.files = [f];
    const reading = input.fire('change');
    await change(v);
    done();
    await reading;
    await settle();
    assert.deepEqual(v.sets, [], 'nothing written');
  });
}

test('an import that finishes on its own file is kept', async () => {
  const v = viewer();
  await v.tell();
  v.bar().find('Annotate').click();
  v.bar().find('Import annotations').click();
  const input = v.inputs.at(-1);
  const { f, done } = file(MARK);
  input.files = [f];
  const reading = input.fire('change');
  done();
  await reading;
  await settle();
  assert.equal(v.sets.length, 1);
  assert.deepEqual(Object.keys(v.sets[0]), [`ink:${CANVAS}/5/21`]);
});
