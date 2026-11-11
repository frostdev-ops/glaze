// Glaze Writer's frame protocol: the worker's one-use pass and the page-world helper it puts in (background/background.js
// 'glaze:writer'), writer/writer-main.js's events, and writer.js's side of the channel, with a stand-in editor. What the frame
// does in a browser, against the real Quill, is checks/writer/writer-check.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const worker = require('../helpers/worker-env.cjs');
const { El } = require('../stand-in-dom.js');
const { parse } = require('../fixture-dom.js');

const root = path.join(__dirname, '../../extension');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

// ---- the worker -----------------------------------------------------------------------------------------------------
test('a writer pass: an Ultra page Glaze runs on also gets writer/writer-main.js in its own world', async () => {
  const w = worker();
  const injected = [];
  w.context.chrome.scripting.executeScript = async (x) => { injected.push(x); return [{}]; };
  const ultra = { id: 'glaze', tab: { id: 7 }, frameId: 0, documentId: 'doc-1', url: 'https://school.blackboard.com/ultra/courses/_1_1/discussion/_2_1' };
  const moodle = { id: 'glaze', tab: { id: 7 }, frameId: 0, url: 'https://school.moodlecloud.com/mod/forum/view.php?id=1' };
  const pass = crypto.randomUUID();
  assert.deepEqual(await w.send({ type: 'glaze:writer', op: 'job', pass }, moodle), { ok: false }, 'not from an LMS Writer has no hand in');
  assert.deepEqual(await w.send({ type: 'glaze:writer', op: 'job', pass: 'short' }, ultra), { ok: false }, 'not a guessable pass');
  assert.equal(injected.length, 0);
  assert.deepEqual(await w.send({ type: 'glaze:writer', op: 'job', pass }, ultra), { ok: true });
  assert.deepEqual(JSON.parse(JSON.stringify(injected)), [{ target: { tabId: 7, documentIds: ['doc-1'] }, files: ['writer/writer-main.js'], world: 'MAIN', injectImmediately: true }], 'into the document that asked, in the page\'s world');
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
  const ultra = { id: 'glaze', tab: { id: 7 }, frameId: 2, documentId: 'doc-7', url: 'https://school.blackboard.com/ultra/courses/_1_1/assessment/_2_1/attempt/create' };
  const writer = { id: 'glaze', tab: { id: 7 }, frameId: 5, documentId: 'writer-doc', url: 'chrome-extension://x/writer.html' };
  const pass = crypto.randomUUID();
  await w.send({ type: 'glaze:writer', op: 'job', pass }, ultra);
  assert.deepEqual(await w.send({ type: 'glaze:writer', op: 'claim', pass }, writer), { ok: true });
  await w.settle?.();
  assert.deepEqual(JSON.parse(JSON.stringify(w.store.session.aiHosts)), { '7|5': { frameId: 2, documentId: 'doc-7', writerDocumentId: 'writer-doc' } }, 'the host is known by the time the frame hears back');
  assert.deepEqual(await w.send({ type: 'glaze:writer', op: 'claim', pass: crypto.randomUUID() }, writer), { ok: false });
  assert.deepEqual(Object.keys(w.store.session.aiHosts), ['7|5'], 'no host for a pass that fails');
});

test('both frames load on demand: writer/writer-ultra.js and writer/page/writer.js are loadable; the helper is not', () => {
  const list = JSON.parse(read('background/background.js').match(/const LOADABLE = new Set\((\[[^\]]*\])\)/)[1].replace(/'/g, '"'));
  assert.ok(list.includes('writer/writer-ultra.js') && list.includes('writer/page/writer.js'));
  assert.ok(!list.includes('writer/writer-main.js'), 'the page-world helper goes in only with a pass');
  const m = require('../../extension/manifest.json');
  assert.ok(m.web_accessible_resources.some((w) => w.resources.includes('writer.html') && !w.use_dynamic_url));
  assert.ok(!m.content_scripts.some((c) => c.world === 'MAIN'), 'no manifest MAIN-world entry (Safari 18 only)');
});

// ---- writer/writer-main.js -----------------------------------------------------------------------------------------------
const pageWorld = () => {
  const doc = new EventTarget();
  const attrs = new Set(), calls = [];
  doc.documentElement = { hasAttribute: (k) => attrs.has(k), setAttribute: (k) => attrs.add(k) };
  const quill = (version) => ({
    constructor: { version }, root: { innerHTML: '<p><br></p>', isConnected: true }, text: '\n',
    clipboard: { convert: () => { calls.push('convert'); return []; } },
    setContents(d, source) { calls.push({ d, source }); this.root.innerHTML = `<p>${d.map((o) => o.insert).join('').trim()}</p>`; this.text = d.map((o) => o.insert).join(''); },
    getText() { return this.text; }, focus() { calls.push('focus'); },
  });
  const boxes = { 'gzw-1': { __quill: quill('dev') }, 'gzw-2': { __quill: quill('2.0.2') } };
  for (const b of Object.values(boxes)) { const root = b.__quill.root; b.querySelector = () => root; }
  doc.querySelector = (sel) => boxes[sel.match(/data-gz-writer-id="([^"]+)"/)?.[1]] || null;
  const ctx = vm.createContext({ document: doc, CustomEvent, JSON });
  const run = () => vm.runInContext(read('writer/writer-main.js'), ctx);
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

test('page world: set writes compose\'s Quill ops as the student\'s edit, get reads it back, and focus is never touched', () => {
  const p = pageWorld();
  assert.equal(p.run(), true, 'ends on a value, as executeScript reports');
  p.run(); // a second job's injection adds no second listener
  const delta = [{ insert: 'Hello' }, { insert: ' world', attributes: { bold: true, link: 'https://x.test/a' } }, { insert: '\n', attributes: { header: 3 } }];
  assert.deepEqual(p.ask('set', JSON.stringify({ id: 'gzw-1', delta })), [{ id: 'gzw-1', ok: true, html: '<p>Hello world</p>', text: 'Hello world\n' }]);
  assert.deepEqual(JSON.parse(JSON.stringify(p.calls)), [{ d: delta, source: 'user' }], 'setContents(ops, user), once, no clipboard');
  assert.deepEqual(p.ask('get', JSON.stringify({ id: 'gzw-1' })), [{ id: 'gzw-1', ok: true, html: '<p>Hello world</p>', text: 'Hello world\n' }]);
  assert.ok(!p.calls.includes('focus') && !p.calls.includes('convert'));
});

test('page world: ops outside what compose writes are refused before Quill sees them', () => {
  const p = pageWorld();
  p.run();
  for (const delta of [
    'x', [], [{ insert: 'no newline' }], [{ insert: 'x\n', attributes: { color: 'red' } }], [{ insert: 'x\n', attributes: { link: 'javascript:alert(1)' } }],
    [{ insert: { image: 'https://x.test/a.png' } }, { insert: '\n' }], [{ insert: 'x\n', attributes: { header: 1 } }], [{ insert: 'x\n', attributes: { indent: 9 } }],
    [{ insert: 'x\n', retain: 3 }], [{ insert: 'x\n', attributes: { list: 'checked' } }], [{ insert: '' }, { insert: '\n' }],
  ]) assert.deepEqual(p.ask('set', JSON.stringify({ id: 'gzw-1', delta })), [{ id: 'gzw-1', ok: false }], JSON.stringify(delta));
  assert.equal(p.calls.length, 0);
});

test('page world: telephone links accepted by compose sync to native Quill', () => {
  const S = require('../../extension/writer/writer-schema.js');
  const p = pageWorld(); p.run();
  const doc = S.parse(S.compose, '<p>Call <a href="tel:+15551234567">the office</a>.</p>');
  const delta = S.delta(doc);
  assert.ok(delta.some((op) => op.attributes?.link === 'tel:+15551234567'));
  assert.equal(p.ask('set', JSON.stringify({ id: 'gzw-1', delta }))[0].ok, true);
  assert.equal(p.calls.length, 1, 'the entire draft must reach the native editor');
});

test('page world: get reads native selection without focusing or changing Quill', () => {
  const p = pageWorld(); p.run();
  p.boxes['gzw-1'].__quill.getSelection = () => ({ index: 2, length: 3 });
  assert.deepEqual(p.ask('get', JSON.stringify({ id: 'gzw-1' }))[0].selection, { index: 2, length: 3 });
  assert.equal(p.calls.length, 0);
});

test('page world: an unknown box, a bad id or a bad message answers not ok, or not at all', () => {
  const p = pageWorld();
  p.run();
  assert.deepEqual(p.ask('set', JSON.stringify({ id: 'gzw-9', delta: [{ insert: 'x\n' }] })), [{ id: 'gzw-9', ok: false }]);
  assert.deepEqual(p.ask('set', JSON.stringify({ id: '"] *, [x="', delta: [{ insert: 'x\n' }] })), [{ id: '"] *, [x="', ok: false }], 'an id is never a selector');
  assert.deepEqual(p.ask('set', JSON.stringify({ id: 'gzw-1', html: '<p>x</p>' })), [{ id: 'gzw-1', ok: false }], 'HTML is no longer taken');
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
const frame = ({ claim = true, host = 'https://school.blackboard.com', readyState = 'loading' } = {}) => {
  const doc = { activeElement: null, readyState };
  doc.root = new El('html', doc);
  doc.head = new El('head', doc);
  doc.body = parse(read('writer.html'), doc);
  doc.documentElement = doc.root;
  doc.getElementById = (id) => doc.root.querySelector(`#${id}`);
  doc.querySelector = (s) => doc.root.querySelector(s);
  doc.addEventListener = () => {};
  doc.createElement = (t) => new El(t, doc);
  const listeners = [], loads = [], ticks = [], asked = [], made = [], announced = [], lost = [], blurs = [];
  const editor = (opts) => {
    let html = opts.html;
    const ed = { opts, set: [], focused: 0, view: { state: { doc: 'the doc' } }, html: () => html, words: () => (html.replace(/<[^>]*>/g, ' ').match(/\S+/g) || []).length, setHTML: (h) => { ed.set.push(h); html = h; opts.onChange({ html: h, text: h, words: 1, docChanged: true }); }, focus: () => { ed.focused++; }, run: () => true, active: () => ({}) };
    made.push(ed);
    return ed;
  };
  const ctx = vm.createContext({
    document: doc, innerWidth: 800, innerHeight: 300, console, URL,
    location: { href: `chrome-extension://x/writer.html?host=${encodeURIComponent(host)}` },
    parent: { postMessage: (data, origin) => announced.push({ data, origin }) },
    setTimeout: (fn) => ticks.push(fn),
    ResizeObserver: class { observe() {} },
    addEventListener: (type, f) => { if (type === 'message') listeners.push(f); else if (type === 'load') loads.push(f); else if (type === 'blur') blurs.push(f); },
    chrome: { runtime: { sendMessage: async (m) => { asked.push(m); return { ok: claim }; } } },
    GZ_WRITER_EDITOR: { create: editor },
    // writer/writer-schema.js as the frame uses it: compose's ops for a doc, and what a box holds that compose can't keep.
    GZ_WRITER_SCHEMA: { compose: 'compose', paper: 'paper', canvas: 'canvas', plain: 'plain', delta: (doc) => [{ insert: `ops of ${doc}\n` }], loses: (schema, h) => { lost.push(schema); return [...(/class="attachment"/.test(h) ? ['attachment'] : []), ...(h.length > 5000 ? ['limit'] : [])]; } },
  });
  ctx.globalThis = ctx;
  vm.runInContext(read('core/i18n.js'), ctx);
  vm.runInContext(read('writer/frame/writer.js'), ctx);
  const port = () => { const p = { sent: [], closed: false, postMessage(m) { this.sent.push(JSON.parse(JSON.stringify(m))); }, close() { this.closed = true; } }; return p; };
  const hand = async (data, p = port()) => { for (const f of listeners) await f({ data, ports: [p] }); return p; };
  const to = (p, m) => p.onmessage({ data: m });
  const loaded = () => { for (const f of loads) f(); };
  const tick = () => { for (const f of ticks.splice(0)) f(); };
  return { doc, hand, to, asked, made, ctx, announced, loaded, tick, lost, blurs };
};
const INIT = { type: 'init', mode: 'compose', kind: 'reply', html: '<p>Hi there</p>', placeholder: 'Type a reply', context: { post: { id: '_201_1' } }, locale: 'en',
  look: { tokens: { '--gz-accent': '#17c8f4', '--gz-font': '"Glaze Inter", sans-serif', '--gz-bad': 'url(https://x.test/a)', '--other': 'red', '--gz-ink': 'red;}body{' }, dark: true, motion: 'off' } };

test('frame: context re-sends keep the object and clear omitted identity fields', async () => {
  const f = frame(), p = await f.hand({ type: 'glaze:writer', pass: 'p'.repeat(36) });
  f.to(p, { ...INIT, kind: 'journal', context: { prompt: 'Reading Journal' } });
  const api = f.ctx.GZ_WRITER_FRAME, original = api.context();
  const full = { prompt: 'Reading Journal', school: 'bb.school.test', user: { id: '_42_1' }, course: { id: '_101_1' }, item: { id: '_12_1' } };
  let heard;
  api.on('context', (c) => { heard = c; });
  f.to(p, { type: 'context', context: full });
  assert.equal(api.context(), original);
  assert.equal(heard, original);
  assert.deepEqual(JSON.parse(JSON.stringify(original)), full);
  f.to(p, { type: 'context', context: { prompt: 'Reading Journal', user: null } });
  assert.equal(api.context(), original);
  assert.deepEqual(JSON.parse(JSON.stringify(original)), { prompt: 'Reading Journal', user: null });
});

test('frame: boot is announced after load finishes, to the exact public host origin without a pass', () => {
  const f = frame({ host: 'https://bb.wpunj.edu' });
  assert.deepEqual(f.announced, [], 'later Writer scripts must register before the host is contacted');
  f.loaded();
  assert.deepEqual(f.announced, [], 'the parent iframe load runs before the boot announcement');
  f.tick();
  assert.deepEqual(JSON.parse(JSON.stringify(f.announced)), [{ data: { type: 'glaze:writer:hello' }, origin: 'https://bb.wpunj.edu' }]);
  assert.deepEqual(f.asked, [], 'a public boot announcement claims no worker pass');
  assert.equal(frame({ readyState: 'complete' }).announced.length, 1, 'a late injection can also announce its completed boot');
  for (const host of ['', 'null', '*', 'https://bb.wpunj.edu/path', 'data:text/plain,hello']) {
    const bad = frame({ host }); bad.loaded(); bad.tick();
    assert.deepEqual(bad.announced, [], `no permissive or opaque target: ${host}`);
  }
});

test('frame: the link field keeps a telephone address as entered', async () => {
  const f = frame(), p = await f.hand({ type: 'glaze:writer', pass: 'p'.repeat(36) });
  f.to(p, INIT);
  const calls = [];
  f.made[0].run = (...args) => calls.push(args);
  const input = f.doc.getElementById('href');
  input.value = 'tel:+15551234567';
  input.dispatchEvent({ type: 'keydown', key: 'Enter', preventDefault() {} });
  assert.deepEqual(calls, [['link', 'tel:+15551234567']]);
});

test('frame: native selection reaches the editor initialization', async () => {
  const f = frame(), p = await f.hand({ type: 'glaze:writer', pass: 'p'.repeat(36) });
  f.to(p, { ...INIT, selection: { index: 2, length: 3 } });
  assert.deepEqual(JSON.parse(JSON.stringify(f.made[0].opts.selection)), { index: 2, length: 3 });
});

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

test('frame: saved typing preferences load before the editor channel is ready', async () => {
  const f = frame();
  let release;
  const loaded = new Promise((resolve) => { release = resolve; });
  f.ctx.GZ_WRITER_SETTINGS = { load: () => loaded };
  const p = { sent: [], postMessage(m) { this.sent.push(m); }, close() {} };
  const pending = f.hand({ type: 'glaze:writer', pass: 'p'.repeat(36) }, p);
  await new Promise(setImmediate);
  try { assert.deepEqual(p.sent, [], 'the page cannot initialize an editor with default preferences'); }
  finally { release(); await pending; }
  assert.deepEqual(p.sent.map((m) => m.type), ['ready', 'height']);
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
  assert.deepEqual(p.sent, [{ type: 'change', html: '<p>Hi there, Jordan</p>', text: 'Hi there, Jordan', words: 3, delta: [{ insert: 'ops of the doc\n' }] }], 'with compose\'s Quill ops, what the page writes');
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

test('frame: Canvas putting what Writer can\'t keep into its box gets the same check as init: the box goes back, nothing flattened', async () => {
  const f = frame({ host: 'https://canvas.school.test' });
  const p = await f.hand({ type: 'glaze:writer', pass: 'p'.repeat(36) });
  f.to(p, { ...INIT, site: 'canvas', kind: 'assignment' });
  p.sent.length = 0; f.lost.length = 0;
  f.to(p, { type: 'html', html: '<p>Restored</p><p class="attachment">file</p>' });
  assert.deepEqual(f.made[0].set, [], 'the frame keeps nothing of it');
  assert.deepEqual(f.lost, ['canvas']);
  assert.deepEqual(p.sent, [{ type: 'native', reason: 'attachment' }]);
  f.to(p, { type: 'html', html: '<p>Later</p>' });
  assert.deepEqual(f.made[0].set, [], 'and stays out of it');
});

test('page world: a stale Quill pointer never writes into another editor', () => {
  const p = pageWorld(); p.run();
  p.boxes['gzw-1'].__quill = p.boxes['gzw-2'].__quill;
  assert.deepEqual(p.ask('set', JSON.stringify({ id: 'gzw-1', delta: [{ insert: 'Wrong destination\n' }] })), [{ id: 'gzw-1', ok: false }]);
  assert.equal(p.calls.length, 0);
});

test('frame: a box holding what Writer can\'t keep is refused before the editor exists, so nothing is ever written back', async () => {
  for (const [html, reason] of [['<p>See</p><div class="attachment">f.docx</div>', 'attachment'], [`<p>${'x'.repeat(6000)}</p>`, 'limit']]) {
    const f = frame();
    const p = await f.hand({ type: 'glaze:writer', pass: 'p'.repeat(36) });
    p.sent.length = 0;
    f.to(p, { ...INIT, html });
    assert.equal(f.made.length, 0, `${reason}: no editor`);
    assert.deepEqual(p.sent, [{ type: 'native', reason }], `${reason}: the page hears why, and nothing else`);
    f.to(p, INIT);
    assert.equal(f.made.length, 0, `${reason}: a later init builds nothing either`);
  }
});

test('frame: paper mode sends the page nothing as it changes, so a paper is never squeezed into Ultra\'s text box nor copied out per keystroke', async () => {
  const f = frame();
  const p = await f.hand({ type: 'glaze:writer', pass: 'p'.repeat(36) });
  f.to(p, { ...INIT, mode: 'paper', kind: 'assignment' });
  p.sent.length = 0;
  let heard = 0;
  f.ctx.GZ_WRITER_FRAME.on('change', () => heard++);
  f.made[0].opts.onChange({ get html() { throw new Error('a paper\'s HTML is not built per keystroke'); }, text: 'A paper', words: 2, docChanged: true });
  assert.deepEqual(p.sent.filter((m) => m.type === 'change'), []);
  assert.equal(heard, 1, 'the frame\'s own parts still hear it');
});

test('page world: attachment filenames and Markdown append as literal Quill text', () => {
  const p = pageWorld(); p.run();
  const q = p.boxes['gzw-1'].__quill, updates = [];
  q.text = 'Existing draft\n'; q.getLength = () => q.text.length;
  q.updateContents = (ops, source) => updates.push({ ops, source });
  const text = 'Attached: <img src=x onerror=alert(1)>.bin, **[notes](javascript:alert(1))**.txt';
  assert.equal(p.ask('append', JSON.stringify({ id: 'gzw-1', text }))[0].ok, true);
  assert.deepEqual(JSON.parse(JSON.stringify(updates)), [{ ops: [{ retain: 15 }, { insert: `\n${text}\n` }], source: 'user' }]);
  assert.equal(p.calls.length, 0, 'no clipboard conversion or HTML parsing');
});

// ---- Canvas: init's site picks the dialect, ⋯'s words and its Insert from Canvas --------------------------------------
const CANVAS = { ...INIT, site: 'canvas', kind: 'assignment', html: '<p>Hi there</p>', context: {} };
const menuItems = (f) => f.doc.getElementById('menu').querySelectorAll('[role="menuitem"]').map((b) => b.textContent);

test('frame: Canvas compose is Canvas\'s dialect: its editor, its check, no Quill ops, ⋯ → Canvas editor and Insert from Canvas', async () => {
  const f = frame({ host: 'https://school.instructure.com' });
  const p = await f.hand({ type: 'glaze:writer', pass: 'p'.repeat(36) });
  f.to(p, CANVAS);
  const [ed] = f.made;
  assert.deepEqual([ed.opts.mode, ed.opts.dialect], ['compose', 'canvas']);
  assert.deepEqual(f.lost, ['canvas'], 'what the box holds is checked against Canvas\'s dialect');
  assert.equal(f.doc.root.dataset.site, 'canvas');
  assert.deepEqual(menuItems(f), ['Canvas editor', 'Image', 'Media', 'Document', 'Equation', 'Course link']);
  assert.equal(f.doc.getElementById('menu').querySelector('[data-insert-head]').textContent, 'Insert from Canvas');
  p.sent.length = 0;
  ed.opts.onChange({ html: '<p>Hi there, Jordan</p>', text: 'Hi there, Jordan', words: 3, docChanged: true });
  assert.deepEqual(p.sent, [{ type: 'change', html: '<p>Hi there, Jordan</p>', text: 'Hi there, Jordan', words: 3, delta: null }], 'no Quill ops on Canvas');
  p.sent.length = 0;
  const items = f.doc.getElementById('menu').querySelectorAll('[data-insert]');
  for (const b of items) b.dispatchEvent({ type: 'click' });
  assert.deepEqual(p.sent, ['image', 'media', 'document', 'equation', 'link'].map((tool) => ({ type: 'insert', tool })));
});

test('frame: the Inbox is plain text: its schema, no Insert, Canvas editor in ⋯', async () => {
  const f = frame({ host: 'https://school.instructure.com' });
  const p = await f.hand({ type: 'glaze:writer', pass: 'p'.repeat(36) });
  f.to(p, { ...CANVAS, mode: 'plain', kind: 'message' });
  const [ed] = f.made;
  assert.deepEqual([ed.opts.mode, ed.opts.dialect, f.doc.root.dataset.mode, f.doc.root.dataset.dialect], ['compose', 'plain', 'compose', 'plain']);
  assert.deepEqual(f.lost, ['plain']);
  assert.deepEqual(menuItems(f), ['Canvas editor']);
  p.sent.length = 0;
  ed.opts.onChange({ html: '<p>Hello</p>', text: 'Hello', words: 1, docChanged: true });
  assert.deepEqual(p.sent.map((m) => [m.type, m.delta]), [['change', null]], 'plain text goes to the page as compose\'s does');
});

test('frame: Ultra\'s box keeps Blackboard editor and no Insert from Canvas', async () => {
  const f = frame(), p = await f.hand({ type: 'glaze:writer', pass: 'p'.repeat(36) });
  f.to(p, INIT);
  assert.deepEqual([f.made[0].opts.dialect, f.lost], [null, ['compose']]);
  assert.deepEqual(menuItems(f), ['Blackboard editor']);
});

test('frame: a flush answers with the document as it is now; a held send says why in the bar until the next edit', async () => {
  const f = frame({ host: 'https://school.instructure.com' });
  const p = await f.hand({ type: 'glaze:writer', pass: 'p'.repeat(36) });
  f.to(p, CANVAS);
  const [ed] = f.made;
  ed.setHTML('<p>The last words</p>');
  p.sent.length = 0;
  f.to(p, { type: 'flush', request: 'r-1' });
  assert.deepEqual(p.sent, [{ type: 'flushed', request: 'r-1', html: '<p>The last words</p>' }]);
  f.to(p, { type: 'flush', request: 7 });
  assert.equal(p.sent.length, 1, 'a request is a string');
  const note = f.doc.getElementById('note');
  assert.equal(note.hidden, true);
  f.to(p, { type: 'held' });
  assert.equal(note.hidden, false);
  assert.equal(note.textContent, 'Not sent: Canvas didn’t take your text. Try again.');
  ed.opts.onChange({ html: '<p>x</p>', text: 'x', words: 1, docChanged: true });
  assert.equal(note.hidden, true, 'the next edit clears it');
});

test('frame: a copy Glaze kept is offered at the top: Restore puts it in and tells the page; Dismiss only tells it', async () => {
  for (const restore of [true, false]) {
    const f = frame({ host: 'https://school.instructure.com' });
    const p = await f.hand({ type: 'glaze:writer', pass: 'p'.repeat(36) });
    f.to(p, { ...CANVAS, html: '<p><br></p>', offer: { html: '<p>Kept words</p>', text: 'Glaze kept a copy of what you wrote here (5 minutes ago).' } });
    const bar = f.doc.getElementById('gw').querySelector('.gw-offer');
    assert.ok(bar, 'the offer');
    assert.equal(bar.querySelector('span').textContent, 'Glaze kept a copy of what you wrote here (5 minutes ago).');
    const [yes, no] = bar.querySelectorAll('button');
    assert.deepEqual([yes.textContent, no.textContent], ['Restore', 'Dismiss']);
    p.sent.length = 0;
    (restore ? yes : no).dispatchEvent({ type: 'click' });
    const [ed] = f.made;
    if (restore) {
      assert.deepEqual(ed.set, ['<p>Kept words</p>']);
      assert.deepEqual(p.sent.map((m) => m.type), ['change', 'change', 'offer'], 'the stand-in reports its own change; the page hears the restored document, then the offer settled');
      assert.equal(p.sent[1].html, '<p>Kept words</p>');
    } else {
      assert.deepEqual(ed.set, []);
      assert.deepEqual(p.sent, [{ type: 'offer' }]);
    }
    assert.equal(bar.isConnected ?? !!bar.parentNode, false, 'the offer goes');
  }
  const f = frame({ host: 'https://school.instructure.com' }), p = await f.hand({ type: 'glaze:writer', pass: 'p'.repeat(36) });
  f.to(p, { ...CANVAS, offer: { html: 7, text: 'x' } });
  assert.equal(f.doc.getElementById('gw').querySelector('.gw-offer'), null, 'no offer without its document');
});

test('frame: losing the focus is said to the page, which takes it back from a hidden native editor', async () => {
  const f = frame({ host: 'https://school.instructure.com' }), p = await f.hand({ type: 'glaze:writer', pass: 'p'.repeat(36) });
  f.to(p, CANVAS);
  p.sent.length = 0;
  for (const fn of f.blurs) fn();
  assert.deepEqual(p.sent, [{ type: 'blur' }]);
});

test('frame: an offered copy cannot overwrite text Canvas restores after initialization', async () => {
  const f = frame({ host: 'https://school.instructure.com' }), p = await f.hand({ type: 'glaze:writer', pass: 'p'.repeat(36) });
  f.to(p, { ...CANVAS, html: '<p><br></p>', offer: { html: '<p>Older kept copy</p>', text: 'Kept copy' } });
  const bar = f.doc.getElementById('gw').querySelector('.gw-offer'), restore = bar.querySelector('button'), ed = f.made[0];
  ed.text = () => ed.html().replace(/<[^>]*>/g, '');
  // The real editor's setHTML reports docChanged:false for a programmatic native update.
  const onChange = ed.opts.onChange;
  ed.opts.onChange = (c) => onChange({ ...c, docChanged: false });
  f.to(p, { type: 'html', html: '<p>Newer Canvas draft</p>' });
  restore.dispatchEvent({ type: 'click' });
  assert.equal(ed.html(), '<p>Newer Canvas draft</p>', 'even a stale Restore control cannot replace nonempty work');
  assert.equal(p.sent.some((m) => m.type === 'offer'), false, 'the un-restored copy is retained');
});

test('frame: recovery buttons and a held-send message follow the asynchronously loaded locale', async () => {
  const f = frame({ host: 'https://school.instructure.com' }), p = await f.hand({ type: 'glaze:writer', pass: 'p'.repeat(36) });
  f.to(p, { ...CANVAS, locale: 'es', html: '<p><br></p>', offer: { html: '<p>Kept copy</p>', text: 'Saved' } });
  f.to(p, { type: 'held' });
  vm.runInContext(read('i18n/es.js'), f.ctx);
  f.doc.head.querySelector('script').onload();
  const t = (key) => vm.runInContext(`GZ_I18N.t(${JSON.stringify(key)}, undefined, 'es')`, f.ctx);
  assert.deepEqual(f.doc.getElementById('gw').querySelector('.gw-offer').querySelectorAll('button').map((b) => b.textContent), [t('Restore'), t('Dismiss')]);
  assert.equal(f.doc.getElementById('note').textContent, t('Not sent: Canvas didn’t take your text. Try again.'));
});
