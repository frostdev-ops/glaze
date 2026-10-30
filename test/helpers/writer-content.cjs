// Content-side Writer lifecycle, with the fixture DOM and synchronous page-world replies.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { El, parser } = require('../stand-in-dom.js');
const { parse } = require('../fixture-dom.js');
const U = require('../../lib/writer-ultra.js');
// writer: the student's Writer settings as the page reads them (writer.full: an assignment opens its full view).
module.exports = ({ fixture = 'discussion', helper = 'ok', insert = false, recovery = false, pathname = null, account = async () => '_900_1', writer = {} } = {}) => {
  const doc = { activeElement: null, listeners: [] }, timers = new Map(), observers = [], ports = [], messages = [], clicks = [], kept = [], offers = [];
  doc.root = new El('html', doc); doc.documentElement = doc.root;
  doc.body = parse(fs.readFileSync(path.join(__dirname, `../fixtures/ultra-writer-${fixture}.html`), 'utf8'), doc);
  for (const el of doc.root.all()) el.style.getPropertyPriority = () => '';
  for (const name of ['querySelector', 'querySelectorAll', 'addEventListener', 'removeEventListener', 'dispatchEvent']) doc[name] = El.prototype[name].bind(doc.root);
  doc.createElement = (tag) => {
    const el = new El(tag, doc); el.style.getPropertyPriority = () => '';
    if (tag === 'iframe') el.contentWindow = { postMessage: (data, origin, transfer) => offers.push({ frame: el, data, origin, transfer }) };
    return el;
  };
  doc.execCommand = (name, ui, html) => { if (insert) doc.activeElement.innerHTML = html; return insert; };
  doc.fire = (el, type) => { if (type === 'click') clicks.push(el); };
  const location = { origin: 'https://school.blackboard.com', host: 'school.blackboard.com', pathname: pathname || (fixture === 'discussion' ? '/ultra/courses/_101_1/discussion/_9_1' : '/ultra/courses/_101_1/assessment/_8_1/attempt/_31_1') };
  let timer = 0, mode = helper;
  const ctx = vm.createContext({
    document: doc, location, crypto, CustomEvent, console, Element: El, DOMParser: parser(doc),
    GZ_COLORS: [], GZ_WRITER_ULTRA: U,
    GZ_CTX: { account, on: () => true, site: 'ultra', settings: () => ({ enabled: true, enhance: { writer: true }, writer }), t: (k) => k, locale: () => 'en', need: async () => ctx.GZ_DRAFT_UI, draftAt: (ed) => ({ ed, id: ed.id, near: U.contextOf(ed, U.kindOf(ed, { path: location.pathname })).post?.id || '', path: location.pathname, html: ed.innerHTML, text: ed.textContent, at: Date.now() }), bookFor: () => ({ results: [{ column: { contentId: '_8_1' } }] }) },
    GZ_DRAFT_UI: { ready: async () => !recovery, keep: (s) => kept.push({ ...s }), write() {} },
    chrome: { runtime: { getURL: (s) => `chrome-extension://x/${s}`, sendMessage: async (m) => { messages.push(m); return { ok: true }; } }, storage: { onChanged: { addListener() {} } } },
    getComputedStyle: () => ({ getPropertyValue: () => '' }), matchMedia: () => ({ matches: true }),
    getSelection: () => ({ selectAllChildren() {} }),
    setTimeout: (f, ms) => { timers.set(++timer, { f, ms }); return timer; }, clearTimeout: (id) => timers.delete(id),
    MutationObserver: class { constructor(fn) { this.fn = fn; observers.push(this); } observe(target) { this.target = target; } disconnect() { this.target = null; } },
    MessageChannel: class { constructor() { this.port1 = { sent: [], postMessage(m) { this.sent.push(m); }, close() { this.closed = true; } }; this.port2 = { close() { this.closed = true; } }; ports.push(this.port1); } },
    addEventListener: (type, fn) => doc.addEventListener(type, fn),
    removeEventListener: (type, fn) => doc.removeEventListener(type, fn),
  });
  ctx.window = ctx; ctx.top = ctx;
  // Quill as far as these tests need it: each line of the ops' text a paragraph. 'spoof' claims a write it never made.
  const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const render = (d) => d.map((op) => op.insert).join('').replace(/\n$/, '').split('\n').map((l) => `<p>${l ? esc(l) : '<br>'}</p>`).join('');
  const sets = [];
  doc.addEventListener('gz-writer:set', (e) => {
    const m = JSON.parse(e.detail), ed = doc.querySelector(`.ql-container[data-gz-writer-id="${m.id}"]`)?.querySelector('.ql-editor');
    sets.push(m);
    const html = Array.isArray(m.delta) ? render(m.delta) : null;
    if (mode === 'ok' && html !== null) ed.innerHTML = html;
    if (mode !== 'absent') doc.dispatchEvent(new CustomEvent('gz-writer:done', { detail: JSON.stringify({ id: m.id, ok: mode !== 'fail' && html !== null, html }) }));
  });
  vm.runInContext(fs.readFileSync(process.env.WRITER_CONTENT_SOURCE || path.join(__dirname, '../../features/writer.js'), 'utf8'), ctx);
  const boot = async (frame) => {
    frame.dispatchEvent({ type: 'load' });
    doc.dispatchEvent({ type: 'message', source: frame.contentWindow, origin: 'chrome-extension://x', data: { type: 'glaze:writer:hello' } });
    await new Promise(setImmediate);
  };
  const start = async () => { ctx.GZ_WRITER.pass(); await new Promise(setImmediate); for (const frame of doc.querySelectorAll('iframe.gz-writer')) await boot(frame); for (const p of ports) if (!p.closed) p.onmessage({ data: { type: 'ready' } }); };
  const native = (index = 0) => U.boxes(doc, { path: location.pathname })[index];
  // A frame's change carries its Quill ops; these tests write plain paragraphs, so the ops come from the text.
  const emit = (m, index = 0) => ports[index].onmessage({ data: m.type === 'change' && !('delta' in m) ? { ...m, delta: [{ insert: `${m.text}\n` }] } : m });
  const mutate = (ed) => { for (const o of observers) if (o.target === ed) o.fn([]); };
  const tick = (ms) => { for (const [id, t] of [...timers]) if (t.ms === ms) { timers.delete(id); t.f(); } };
  return { ctx, doc, location, ports, messages, clicks, kept, observers, timers, sets, offers, start, boot, native, emit, mutate, tick, helper: (v) => { mode = v; } };
};
