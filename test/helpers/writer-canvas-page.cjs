const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { El, matches, parser } = require('../stand-in-dom.js');
const { parse } = require('../fixture-dom.js');

// The real Canvas adapter and page controller over the captured LMS boxes. Native clicks pass through the controller's
// capture listener, including its replay; frame messages and the clock are driven explicitly by each test.
// strict: writes go through the real page-world script (writer/writer-main-canvas.js), which refuses what isn't Canvas's
// dialect (TinyMCE's data-mce-* bookkeeping included), into a stand-in TinyMCE whose setContent collapses runs of
// whitespace as TinyMCE's parser does. There, helper 'fail' (or a function answering it) is an RCE TinyMCE can't give.
// scripts: more of the extension's files, run before the controller (writer/writer-target.js, which X.need would load).
const page = async ({ fixture = 'discussion', helper = 'ok', ready = () => true, draft = () => false, strict = false, scripts = [] } = {}) => {
  const doc = { activeElement: null }, ports = [], clicks = [], timers = new Map(), observers = [], kept = [];
  let seq = 0, now = 100000, mode = helper;
  doc.root = doc.documentElement = new El('html', doc);
  const load = () => parse(fs.readFileSync(path.join(__dirname, `../fixtures/canvas-writer-${fixture}.html`), 'utf8'), doc);
  doc.body = load();
  const prepare = (root) => {
    for (const el of [root, ...root.all()]) {
      el.ownerDocument = doc;
      el.matches = (s) => matches(el, s);
      el.style.getPropertyPriority = () => '';
      if (el.tagName === 'IFRAME' && /_ifr$/.test(el.id)) {
        const body = new El('body', doc); body.innerHTML = '<p><br></p>';
        el.contentDocument = { body };
      }
    }
  };
  prepare(doc.root);
  for (const name of ['querySelector', 'querySelectorAll', 'addEventListener', 'removeEventListener']) doc[name] = El.prototype[name].bind(doc.root);
  doc.dispatchEvent = (e) => { for (const l of [...doc.root.listeners]) if (l.type === e.type) { l.f(e); if (e.stopped) break; } };
  const press = (target) => {
    const e = { type: 'click', target, preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; } };
    doc.dispatchEvent(e);
    if (!e.prevented) clicks.push(target);
  };
  doc.fire = (el, type) => { if (type === 'click') press(el); };
  doc.createElement = (tag) => {
    const el = new El(tag, doc); prepare(el);
    if (tag === 'iframe') el.contentWindow = { postMessage() {} };
    return el;
  };
  const location = { origin: 'https://canvas.school.test', host: 'canvas.school.test', pathname: fixture === 'inbox' ? '/conversations' : fixture === 'assignment' ? '/courses/34/assignments/238' : fixture === 'a2' ? '/courses/36/assignments/253' : fixture === 'quiz' ? '/courses/36/quizzes/56/take' : '/courses/34/discussion_topics/80' };
  const destination = { subject: 'First subject', name: 'Course', to: ['address-book-label-2-user'] };
  class Clock extends Date { static now() { return now; } }
  const ctx = vm.createContext({
    document: doc, location, crypto, CustomEvent, console, Element: El, DOMParser: parser(doc), Date: Clock,
    GZ_COLORS: [],
    GZ_CTX: { site: 'canvas', on: () => true, settings: () => ({ enabled: true, enhance: { writer: true } }), account: async () => '7',
      t: (k) => k, locale: () => 'en', need: async () => ctx.GZ_DRAFT_UI,
      draftAt: (ed) => ({ ed, id: ed.id, path: location.pathname, near: '', ...destination, at: now }) },
    GZ_DRAFT_UI: { ready: async () => true, keep: (s) => kept.push({ ...s }), write() {} },
    chrome: { runtime: { getURL: (s) => `chrome-extension://x/${s}`, sendMessage: async () => ({ ok: true }) }, storage: { onChanged: { addListener() {} } } },
    getComputedStyle: () => ({ getPropertyValue: () => '' }), matchMedia: () => ({ matches: true }),
    setTimeout: (f, ms = 0) => { timers.set(++seq, { f, ms }); return seq; }, clearTimeout: (id) => timers.delete(id),
    setInterval: (f, ms) => { timers.set(++seq, { f, ms, repeat: true }); return seq; }, clearInterval: (id) => timers.delete(id),
    MutationObserver: class { constructor(fn) { this.fn = fn; observers.push(this); } observe(target) { this.target = target; } disconnect() { this.target = null; } },
    MessageChannel: class { constructor() { this.port1 = { sent: [], postMessage(m) { this.sent.push(m); }, close() { this.closed = true; } }; this.port2 = { close() {} }; ports.push(this.port1); } },
    addEventListener: (type, fn) => doc.addEventListener(type, fn), removeEventListener: (type, fn) => doc.removeEventListener(type, fn),
  });
  ctx.window = ctx; ctx.top = ctx;
  const run = (f) => vm.runInContext(fs.readFileSync(path.join(__dirname, '../../extension', f), 'utf8'), ctx);
  run('writer/writer-canvas.js');
  for (const f of scripts) run(f);
  if (strict) {
    const handlers = new WeakMap();
    class HTMLTextAreaElement {}
    Object.defineProperty(HTMLTextAreaElement.prototype, 'value', Object.getOwnPropertyDescriptor(El.prototype, 'value'));
    Object.assign(ctx, { HTMLTextAreaElement, Event: class { constructor(type, o = {}) { this.type = type; this.bubbles = !!o.bubbles; } } });
    ctx.tinymce = { majorVersion: '5', get: (id) => {
      const ta = doc.querySelector(`textarea#${id}`), body = ta && ctx.GZ_WRITER_CANVAS.rootOf(ta)?.querySelector(`#${id}_ifr`)?.contentDocument?.body;
      if (!body || (typeof mode === 'function' ? mode(ta) : mode) === 'fail') return null;
      if (!handlers.has(ta)) handlers.set(ta, []);
      const on = handlers.get(ta), fire = (name) => { for (const [n, fn] of on) if (n === name.toLowerCase()) fn({}); };
      return { initialized: true, removed: false, isHidden: () => false, getElement: () => ta, getBody: () => body, getContent: () => body.innerHTML,
        setContent: (html) => { body.innerHTML = html.replace(/[ \t\r\n]+/g, ' '); fire('SetContent'); }, undoManager: { add() {} }, fire,
        on: (names, fn) => { for (const n of names.split(' ')) on.push([n.toLowerCase(), fn]); }, focus() {}, selection: { select() {}, collapse() {} }, execCommand() {} };
    } };
    run('writer/writer-main-canvas.js');
  } else doc.addEventListener('gz-writer:canvas-set', (e) => {
    const m = JSON.parse(e.detail), ed = doc.querySelector(`textarea[data-gz-writer-id="${m.id}"]`);
    const result = typeof mode === 'function' ? mode(ed) : mode;
    if (result === 'ok') {
      if ('text' in m) ed.value = m.text;
      else ctx.GZ_WRITER_CANVAS.rootOf(ed).querySelector(`#${ed.id}_ifr`).contentDocument.body.innerHTML = m.html;
    }
    const native = ctx.GZ_WRITER_CANVAS.read(ed);
    doc.dispatchEvent(new CustomEvent('gz-writer:done', { detail: JSON.stringify({ id: m.id, ok: result !== 'fail', ...native }) }));
  });
  doc.addEventListener('gz-writer:canvas-draft', (e) => {
    const m = JSON.parse(e.detail);
    doc.dispatchEvent(new CustomEvent('gz-writer:done', { detail: JSON.stringify({ id: m.id, ok: true, kept: draft() }) }));
  });
  run('writer/page/writer.js');
  const settle = async () => { await new Promise(setImmediate); };
  const boot = async (start = () => true) => {
    ctx.GZ_WRITER.pass(); await settle();
    for (const frame of doc.querySelectorAll('iframe.gz-writer')) {
      if (!start(frame)) continue;
      const port = ports.find((p) => !p.closed && !p.started);
      if (!port) continue;
      port.started = true;
      doc.dispatchEvent({ type: 'message', source: frame.contentWindow, origin: 'chrome-extension://x', data: { type: 'glaze:writer:hello' } });
      await settle(); port.onmessage({ data: { type: 'ready' } });
    }
  };
  const box = () => ctx.GZ_WRITER_CANVAS.boxes(doc, { path: location.pathname })[0];
  const emit = (m, p = ports.at(-1)) => p.onmessage({ data: m });
  const flush = (html = '<p>Send this reply once.</p>') => {
    const p = ports.at(-1), request = p.sent.filter((m) => m.type === 'flush').at(-1)?.request;
    assert.ok(request, 'a send requests the frame document');
    emit({ type: 'flushed', request, html }, p);
  };
  await boot(ready);
  return { ctx, doc, ports, clicks, timers, observers, kept, location, destination, box, emit, press, flush, boot, load, prepare,
    helper: (value) => { mode = value; }, clock: (value) => { now = value; },
    tick: (ms) => { for (const [id, t] of [...timers]) if (t.ms === ms) { if (!t.repeat) timers.delete(id); t.f(); } } };
};

module.exports = page;
