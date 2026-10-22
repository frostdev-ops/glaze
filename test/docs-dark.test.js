// The page's Dark documents button (features/docs.js, content.js's setDark): it steps through all three choices of
// enhance.docPages, and it saves only the choice it changed.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { El } = require('./stand-in-dom.js');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const darkCode = () => {
  const source = read('content.js');
  let a = source.indexOf('  let darkSave = ');
  if (a < 0) a = source.indexOf('  const setDark = ');
  const b = source.indexOf('  const syncDocTools = ', a);
  assert.ok(a > 0 && b > a);
  return `${source.slice(a, b)}; setDark`;
};

// features/docs.js in a VM with a stand-in page: a Canvas wiki page, so the document buttons are drawn.
const toolbar = (docPages) => {
  const doc = {}; doc.root = new El('html', doc); doc.body = new El('body', doc); doc.root.append(doc.body);
  const content = new El('div', doc); content.setAttribute('class', 'show-content'); doc.body.append(content);
  Object.assign(doc, { documentElement: doc.root, createElement: (tag) => new El(tag, doc), addEventListener() {},
    querySelector: (sel) => doc.root.querySelector(sel), querySelectorAll: (sel) => doc.root.querySelectorAll(sel) });
  const settings = { enhance: { toggles: true, docPages } };
  const chosen = [];
  const ctx = vm.createContext({ document: doc, location: new URL('https://school.instructure.com/courses/1/pages/x'), IntersectionObserver: class { observe() {} unobserve() {} }, URL });
  ctx.globalThis = ctx;
  ctx.GZ_CTX = { site: 'canvas', solo: true, t: (w) => w, on: () => true, darkTheme: () => true, settings: () => settings, PREVIEWS: 'iframe', DOC: '.show-content', wordsIn: new Set(),
    docButton: (key, label, onClick) => { const b = new El('button', doc); b.dataset.gz = key; b.title = label; b.addEventListener('click', onClick); return b; },
    setDark: (v) => { chosen.push(v); settings.enhance = { ...settings.enhance, docPages: v }; ctx.GZ_DOCS.sync(); } };
  vm.runInContext(read('features/docs.js'), ctx);
  ctx.GZ_DOCS.sync();
  const button = doc.root.querySelector('button[data-gz="dark"]');
  assert.ok(button, 'the Dark documents button is drawn');
  return { press: () => button.dispatchEvent({ type: 'click' }), chosen, settings };
};

test('the Dark documents button steps Off, Dimmed, Inverted and round again', () => {
  for (const [from, want] of [['plain', ['dim', 'dark', 'plain', 'dim']], ['dim', ['dark', 'plain', 'dim']], ['dark', ['plain', 'dim', 'dark']]]) {
    const t = toolbar(from);
    for (let i = 0; i < want.length; i++) t.press();
    assert.deepEqual(t.chosen, want, `from ${from}`);
  }
});

// content.js's setDark, as the button's callback: its source, run with stand-ins.
test('Dark documents saves only the changed field to sync, on top of what is stored', () => {
  const stored = { enhance: { notes: false, docPages: 'plain' } }; // what the student has chosen: not every default
  const writes = [];
  const ctx = vm.createContext({
    settings: { enhance: { notes: true, pet: true, calc: true, docPages: 'plain', toggles: true } }, // this tab's copy: defaults filled in
    setAttr() {}, syncDocTools() {},
    chrome: { runtime: { lastError: null }, storage: { sync: {
      get: (k, cb) => cb({ [k]: stored[k] }),
      set: (o) => { writes.push(JSON.parse(JSON.stringify(o))); Object.assign(stored, o); },
    } } },
  });
  const setDark = vm.runInContext(darkCode(), ctx);
  setDark('dim');
  assert.deepEqual(writes, [{ enhance: { notes: false, docPages: 'dim' } }]);
  // Another tab changed a switch since this one loaded: that change is kept, not written over.
  stored.enhance = { ...stored.enhance, calc: false };
  setDark('dark');
  assert.deepEqual(writes.at(-1), { enhance: { notes: false, docPages: 'dark', calc: false } });
  // Sync unreadable: nothing is written rather than a guess.
  ctx.chrome.runtime.lastError = { message: 'quota' };
  setDark('plain');
  assert.equal(writes.length, 2);
  assert.equal(ctx.settings.enhance.docPages, 'plain', 'this tab still shows the choice');
});

test('Dark documents ignores late reads from earlier clicks', () => {
  const reads = [], writes = [];
  const ctx = vm.createContext({ settings: { enhance: { docPages: 'plain' } }, setAttr() {}, syncDocTools() {},
    chrome: { runtime: {}, storage: { sync: { get: (_, cb) => reads.push(cb), set: (o) => writes.push(JSON.parse(JSON.stringify(o))) } } } });
  const setDark = vm.runInContext(darkCode(), ctx);
  setDark('dim'); setDark('dark');
  reads[1]({ enhance: { notes: false, docPages: 'plain' } });
  reads[0]({ enhance: { notes: true, docPages: 'plain' } });
  assert.deepEqual(writes, [{ enhance: { notes: false, docPages: 'dark' } }]);
  assert.equal(ctx.settings.enhance.docPages, 'dark');
});
