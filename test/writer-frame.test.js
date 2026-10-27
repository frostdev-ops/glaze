// Glaze Writer's frame protocol: the worker's one-use pass and the page-world helper it puts in (lib/background.js
// 'glaze:writer'), lib/writer-main.js's events, and writer.js's side of the channel, with a stand-in editor. What the frame
// does in a browser, against the real Quill, is scripts/writer-check.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const worker = require('./helpers/worker-env.cjs');
const { El } = require('./stand-in-dom.js');
const { parse } = require('./fixture-dom.js');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

// ---- the worker -----------------------------------------------------------------------------------------------------
test('a writer pass: only from an Ultra page Glaze runs on, which also gets lib/writer-main.js in its own world', async () => {
  const w = worker();
  const injected = [];
  w.context.chrome.scripting.executeScript = async (x) => { injected.push(x); return [{}]; };
  const ultra = { id: 'glaze', tab: { id: 7 }, frameId: 0, documentId: 'doc-1', url: 'https://school.blackboard.com/ultra/courses/_1_1/discussion/_2_1' };
  const canvas = { id: 'glaze', tab: { id: 7 }, frameId: 0, url: 'https://school.instructure.com/courses/1' };
  const pass = crypto.randomUUID();
  assert.deepEqual(await w.send({ type: 'glaze:writer', op: 'job', pass }, canvas), { ok: false }, 'not from another LMS');
  assert.deepEqual(await w.send({ type: 'glaze:writer', op: 'job', pass: 'short' }, ultra), { ok: false }, 'not a guessable pass');
  assert.equal(injected.length, 0);
  assert.deepEqual(await w.send({ type: 'glaze:writer', op: 'job', pass }, ultra), { ok: true });
  assert.deepEqual(JSON.parse(JSON.stringify(injected)), [{ target: { tabId: 7, documentIds: ['doc-1'] }, files: ['lib/writer-main.js'], world: 'MAIN', injectImmediately: true }], 'into the document that asked, in the page\'s world');
  // Without a documentId (Firefox, Safari), the frame that asked.
  await w.send({ type: 'glaze:writer', op: 'job', pass: crypto.randomUUID() }, { ...ultra, documentId: undefined, frameId: 4 });
  assert.deepEqual(JSON.parse(JSON.stringify(injected[1].target)), { tabId: 7, frameIds: [4] });
  // A page whose helper can't go in gets no pass.
  w.context.chrome.scripting.executeScript = async () => { throw new Error('no access'); };
  assert.deepEqual(await w.send({ type: 'glaze:writer', op: 'job', pass: crypto.randomUUID() }, ultra), { ok: false });
});

test('a writer pass is redeemed once, by writer.html in the tab that asked, and never by the reader (nor the reverse)', async () => {
  const w = worker();
  const ultra = { id: 'glaze', tab: { id: 7 }, frameId: 0, url: 'https://school.blackboard.com/ultra/messages/create' };
  const frame = (page, tab = 7) => ({ id: 'glaze', tab: { id: tab }, frameId: 3, url: `chrome-extension://x/${page}` });
  const pass = crypto.randomUUID(), other = crypto.randomUUID(), reader = crypto.randomUUID();
  await w.send({ type: 'glaze:writer', op: 'job', pass }, ultra);
  await w.send({ type: 'glaze:writer', op: 'job', pass: other }, ultra);
  await w.send({ type: 'glaze:reader', op: 'job', pass: reader }, ultra);
  assert.deepEqual(await w.send({ type: 'glaze:writer', op: 'claim', pass }, ultra), { ok: false }, 'not by the page');
  assert.deepEqual(await w.send({ type: 'glaze:writer', op: 'claim', pass }, frame('reader.html')), { ok: false }, 'not by the reader');
  assert.deepEqual(await w.send({ type: 'glaze:reader', op: 'claim', pass: other }, frame('reader.html')), { ok: false }, 'nor as a reader pass');
  assert.deepEqual(await w.send({ type: 'glaze:writer', op: 'claim', pass: reader }, frame('writer.html')), { ok: false }, 'a reader\'s pass opens no writer');
  assert.deepEqual(await w.send({ type: 'glaze:writer', op: 'claim', pass }, frame('writer.html', 8)), { ok: false }, 'not in another tab');
  assert.deepEqual(await w.send({ type: 'glaze:writer', op: 'claim', pass: other }, frame('writer.html')), { ok: true });
  assert.deepEqual(await w.send({ type: 'glaze:writer', op: 'claim', pass: other }, frame('writer.html')), { ok: false }, 'once');
  assert.deepEqual(await w.send({ type: 'glaze:reader', op: 'claim', pass: reader }, frame('reader.html')), { ok: true }, 'the reader\'s own still works');
});

test('a claimed writer pass tells the AI broker the frame and the page it works for, before the frame hears back', async () => {
  const w = worker();
  const hosted = [];
  const ultra = { id: 'glaze', tab: { id: 7 }, frameId: 2, documentId: 'doc-7', url: 'https://school.blackboard.com/ultra/courses/_1_1/assessment/_2_1/attempt/create' };
  const writer = { id: 'glaze', tab: { id: 7 }, frameId: 5, url: 'chrome-extension://x/writer.html' };
  const pass = crypto.randomUUID(), again = crypto.randomUUID();
  await w.send({ type: 'glaze:writer', op: 'job', pass }, ultra);
  await w.send({ type: 'glaze:writer', op: 'job', pass: again }, ultra);
  assert.deepEqual(await w.send({ type: 'glaze:writer', op: 'claim', pass }, writer), { ok: true }, 'without the AI harness, the editor still opens');
  w.context.aiFrameHost = async (claim, job) => { hosted.push(JSON.parse(JSON.stringify({ claim: claim.frameId, job }))); };
  assert.deepEqual(await w.send({ type: 'glaze:writer', op: 'claim', pass: again }, writer), { ok: true });
  assert.deepEqual(hosted, [{ claim: 5, job: { tab: { id: 7 }, frameId: 2, documentId: 'doc-7' } }]);
  const third = crypto.randomUUID();
  await w.send({ type: 'glaze:writer', op: 'job', pass: third }, ultra);
  w.context.aiFrameHost = async () => { throw new Error('refused'); };
  assert.deepEqual(await w.send({ type: 'glaze:writer', op: 'claim', pass: third }, writer), { ok: true }, 'a refused AI host leaves the editor working');
  assert.deepEqual(await w.send({ type: 'glaze:writer', op: 'claim', pass: crypto.randomUUID() }, writer), { ok: false });
  assert.equal(hosted.length, 1, 'no host for a pass that fails');
});

test('both frames load on demand: lib/writer-ultra.js and features/writer.js are loadable; the helper is not', () => {
  const list = JSON.parse(read('lib/background.js').match(/const LOADABLE = new Set\((\[[^\]]*\])\)/)[1].replace(/'/g, '"'));
  assert.ok(list.includes('lib/writer-ultra.js') && list.includes('features/writer.js'));
  assert.ok(!list.includes('lib/writer-main.js'), 'the page-world helper goes in only with a pass');
  const m = require('../manifest.json');
  assert.ok(m.web_accessible_resources.some((w) => w.resources.includes('writer.html') && !w.use_dynamic_url));
  assert.ok(!m.content_scripts.some((c) => c.world === 'MAIN'), 'no manifest MAIN-world entry (Safari 18 only)');
});

// ---- lib/writer-main.js -----------------------------------------------------------------------------------------------
const pageWorld = () => {
  const doc = new EventTarget();
  const attrs = new Set(), calls = [];
  doc.documentElement = { hasAttribute: (k) => attrs.has(k), setAttribute: (k) => attrs.add(k) };
  const quill = (version) => ({
    constructor: { version }, root: { innerHTML: '<p><br></p>' }, text: '\n',
    clipboard: { convert: (h) => ({ from: h }) },
    setContents(d, source) { calls.push({ d, source }); this.root.innerHTML = typeof d.from === 'string' ? d.from : d.from.html; this.text = 'Hello\n'; },
    getText() { return this.text; }, focus() { calls.push('focus'); },
  });
  const boxes = { 'gzw-1': { __quill: quill('dev') }, 'gzw-2': { __quill: quill('2.0.2') } };
  doc.querySelector = (sel) => boxes[sel.match(/data-gz-writer-id="([^"]+)"/)?.[1]] || null;
  const ctx = vm.createContext({ document: doc, CustomEvent, JSON });
  const run = () => vm.runInContext(read('lib/writer-main.js'), ctx);
  const ask = (type, detail) => {
    const got = [];
    const hear = (e) => got.push(JSON.parse(e.detail));
    doc.addEventListener('gz-writer:done', hear);
    doc.dispatchEvent(new CustomEvent(`gz-writer:${type}`, { detail }));
    doc.removeEventListener('gz-writer:done', hear);
    return got;
  };
  return { run, ask, calls, boxes };
};

test('page world: set puts the HTML in as the student\'s edit, get reads it back, and focus is never touched', () => {
  const p = pageWorld();
  assert.equal(p.run(), true, 'ends on a value, as executeScript reports');
  p.run(); // a second job's injection adds no second listener
  assert.deepEqual(p.ask('set', JSON.stringify({ id: 'gzw-1', html: '<p>Hello</p>' })), [{ id: 'gzw-1', ok: true, html: '<p>Hello</p>', text: 'Hello\n' }]);
  assert.deepEqual(p.calls, [{ d: { from: '<p>Hello</p>' }, source: 'user' }], 'clipboard.convert(html), source user, once');
  assert.deepEqual(p.ask('get', JSON.stringify({ id: 'gzw-1' })), [{ id: 'gzw-1', ok: true, html: '<p>Hello</p>', text: 'Hello\n' }]);
  p.ask('set', JSON.stringify({ id: 'gzw-2', html: '<p>Two</p>' }));
  assert.deepEqual(JSON.parse(JSON.stringify(p.calls[1].d)), { from: { html: '<p>Two</p>' } }, 'Quill 2 takes { html }');
  assert.ok(!p.calls.includes('focus'));
});

test('page world: an unknown box, a bad id or a bad message answers not ok, or not at all', () => {
  const p = pageWorld();
  p.run();
  assert.deepEqual(p.ask('set', JSON.stringify({ id: 'gzw-9', html: '<p>x</p>' })), [{ id: 'gzw-9', ok: false }]);
  assert.deepEqual(p.ask('set', JSON.stringify({ id: '"] *, [x="', html: '<p>x</p>' })), [{ id: '"] *, [x="', ok: false }], 'an id is never a selector');
  assert.deepEqual(p.ask('set', JSON.stringify({ id: 'gzw-1', html: 7 })), [{ id: 'gzw-1', ok: false }]);
  assert.deepEqual(p.ask('set', 'not json'), []);
  assert.equal(p.calls.length, 0);
});

// ---- writer.js, the frame -------------------------------------------------------------------------------------------
if (!Object.getOwnPropertyDescriptor(El.prototype, 'classList')) {
  Object.defineProperty(El.prototype, 'classList', { get() {
    const e = this, list = () => String(e.className).split(/\s+/).filter(Boolean);
    return { contains: (c) => list().includes(c), add: (c) => { if (!list().includes(c)) e.className = [...list(), c].join(' '); }, remove: (c) => { e.className = list().filter((x) => x !== c).join(' '); },
      toggle: (c, on) => { if (on ?? !list().includes(c)) { if (!list().includes(c)) e.className = [...list(), c].join(' '); } else e.className = list().filter((x) => x !== c).join(' '); } };
  } });
}
const frame = ({ claim = true } = {}) => {
  const doc = { activeElement: null };
  doc.root = new El('html', doc);
  doc.head = new El('head', doc);
  doc.body = parse(read('writer.html'), doc);
  doc.documentElement = doc.root;
  doc.getElementById = (id) => doc.root.querySelector(`#${id}`);
  doc.querySelector = (s) => doc.root.querySelector(s);
  doc.addEventListener = () => {};
  doc.createElement = (t) => new El(t, doc);
  const listeners = [], asked = [], made = [];
  const editor = (opts) => {
    let html = opts.html;
    const ed = { opts, set: [], focused: 0, html: () => html, words: () => (html.replace(/<[^>]*>/g, ' ').match(/\S+/g) || []).length, setHTML: (h) => { ed.set.push(h); html = h; opts.onChange({ html: h, text: h, words: 1, docChanged: true }); }, focus: () => { ed.focused++; }, run: () => true, active: () => ({}) };
    made.push(ed);
    return ed;
  };
  const ctx = vm.createContext({
    document: doc, innerWidth: 800, innerHeight: 300, console,
    ResizeObserver: class { observe() {} },
    addEventListener: (type, f) => { if (type === 'message') listeners.push(f); },
    chrome: { runtime: { sendMessage: async (m) => { asked.push(m); return { ok: claim }; } } },
    GZ_WRITER_EDITOR: { create: editor },
  });
  ctx.globalThis = ctx;
  vm.runInContext(read('lib/i18n.js'), ctx);
  vm.runInContext(read('writer.js'), ctx);
  const port = () => { const p = { sent: [], closed: false, postMessage(m) { this.sent.push(JSON.parse(JSON.stringify(m))); }, close() { this.closed = true; } }; return p; };
  const hand = async (data, p = port()) => { for (const f of listeners) await f({ data, ports: [p] }); return p; };
  const to = (p, m) => p.onmessage({ data: m });
  return { doc, hand, to, asked, made, ctx };
};
const INIT = { type: 'init', mode: 'compose', kind: 'reply', html: '<p>Hi there</p>', placeholder: 'Type a reply', context: { post: { id: '_201_1' } }, locale: 'en',
  look: { tokens: { '--gz-accent': '#17c8f4', '--gz-font': '"Glaze Inter", sans-serif', '--gz-bad': 'url(https://x.test/a)', '--other': 'red', '--gz-ink': 'red;}body{' }, dark: true, motion: 'off' } };

test('frame: nothing without the pass; with it, ready and its height on the job\'s channel only', async () => {
  const no = frame({ claim: false });
  const refused = await no.hand({ type: 'glaze:writer', pass: 'p'.repeat(36) });
  assert.ok(refused.closed && refused.sent.length === 0, 'a refused pass closes the channel unanswered');
  assert.deepEqual(JSON.parse(JSON.stringify(no.asked)), [{ type: 'glaze:writer', op: 'claim', pass: 'p'.repeat(36) }]);
  const f = frame();
  assert.equal((await f.hand({ type: 'glaze:other', pass: 'x' })).sent.length, 0);
  const p = await f.hand({ type: 'glaze:writer', pass: 'p'.repeat(36) });
  assert.deepEqual(p.sent.map((m) => m.type), ['ready', 'height']);
  const second = await f.hand({ type: 'glaze:writer', pass: 'q'.repeat(36) });
  assert.equal(second.sent.length, 0, 'one box per frame');
  assert.equal(f.asked.length, 1, 'a second job isn\'t even claimed');
});

test('frame: init builds the editor in the Look\'s tokens; changes, Mod-Enter and the menu go to the page', async () => {
  const f = frame();
  const p = await f.hand({ type: 'glaze:writer', pass: 'p'.repeat(36) });
  f.to(p, INIT);
  const [ed] = f.made;
  assert.deepEqual([ed.opts.mode, ed.opts.html, ed.opts.placeholder], ['compose', '<p>Hi there</p>', 'Type a reply']);
  const root = f.doc.root;
  assert.equal(root.style.getPropertyValue('--gz-accent'), '#17c8f4');
  assert.equal(root.style.getPropertyValue('--gz-font'), '"Glaze Inter", sans-serif');
  assert.equal(root.style.getPropertyValue('--gz-bad'), '', 'no url()');
  assert.equal(root.style.getPropertyValue('--gz-ink'), '', 'no breaking out of the declaration');
  assert.equal(root.style.getPropertyValue('--other'), '', 'only --gz-* tokens');
  assert.equal(root.hasAttribute('data-dark'), true);
  assert.equal(root.dataset.motion, 'off');
  assert.equal(root.dataset.kind, 'reply');
  assert.equal(f.doc.getElementById('words').textContent, 'Word count: 2');
  assert.equal(f.ctx.GZ_WRITER_FRAME.context().post.id, '_201_1');
  f.to(p, INIT);
  assert.equal(f.made.length, 1, 'a second init builds nothing');
  p.sent.length = 0;
  ed.opts.onChange({ html: '<p>Hi there, Jordan</p>', text: 'Hi there, Jordan', words: 3, docChanged: true });
  assert.deepEqual(p.sent, [{ type: 'change', html: '<p>Hi there, Jordan</p>', text: 'Hi there, Jordan', words: 3 }]);
  assert.equal(ed.opts.keys['Mod-Enter'](), true);
  assert.deepEqual(p.sent.at(-1), { type: 'send' });
  f.to(p, { type: 'focus' });
  assert.equal(ed.focused, 1);
  f.to(p, { type: 'look', look: { tokens: { '--gz-accent': '#ff0000' }, dark: false, motion: 'expressive' } });
  assert.deepEqual([root.style.getPropertyValue('--gz-accent'), root.hasAttribute('data-dark'), root.dataset.motion], ['#ff0000', false, 'expressive']);
});

test('frame: Ultra changing its own editor shows in the frame without echoing back', async () => {
  const f = frame();
  const p = await f.hand({ type: 'glaze:writer', pass: 'p'.repeat(36) });
  f.to(p, INIT);
  p.sent.length = 0;
  f.to(p, { type: 'html', html: '<p><br></p>' });
  assert.deepEqual(f.made[0].set, ['<p><br></p>']);
  assert.deepEqual(p.sent.filter((m) => m.type === 'change'), [], 'no change goes back for what Ultra did');
  f.to(p, { type: 'html', html: 7 });
  assert.equal(f.made[0].set.length, 1);
  f.to(p, { type: 'unknown-op' });
  f.to(p, { type: 'constructor' });
});
