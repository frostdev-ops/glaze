const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { El, matches, parser } = require('../stand-in-dom.js');
const { parse } = require('../fixture-dom.js');

// The real Canvas adapter and page controller over the captured LMS boxes. Native clicks pass through the controller's
// capture listener, including its replay; frame messages and the clock are driven explicitly by each test.
const page = async ({ fixture = 'discussion', helper = 'ok' } = {}) => {
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
  const location = { origin: 'https://canvas.school.test', host: 'canvas.school.test', pathname: fixture === 'inbox' ? '/conversations' : fixture === 'assignment' ? '/courses/34/assignments/238' : '/courses/34/discussion_topics/80' };
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
  doc.addEventListener('gz-writer:canvas-set', (e) => {
    const m = JSON.parse(e.detail), ed = doc.querySelector(`textarea[data-gz-writer-id="${m.id}"]`);
    if (mode === 'ok') {
      if ('text' in m) ed.value = m.text;
      else ctx.GZ_WRITER_CANVAS.rootOf(ed).querySelector(`#${ed.id}_ifr`).contentDocument.body.innerHTML = m.html;
    }
    const native = ctx.GZ_WRITER_CANVAS.read(ed);
    doc.dispatchEvent(new CustomEvent('gz-writer:done', { detail: JSON.stringify({ id: m.id, ok: mode !== 'fail', ...native }) }));
  });
  run('writer/page/writer.js');
  const settle = async () => { await new Promise(setImmediate); };
  const boot = async () => {
    ctx.GZ_WRITER.pass(); await settle();
    for (const frame of doc.querySelectorAll('iframe.gz-writer')) {
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
  await boot();
  return { ctx, doc, ports, clicks, timers, observers, kept, location, destination, box, emit, press, flush, boot, load, prepare,
    helper: (value) => { mode = value; }, clock: (value) => { now = value; },
    tick: (ms) => { for (const [id, t] of [...timers]) if (t.ms === ms) { if (!t.repeat) timers.delete(id); t.f(); } } };
};

test('Canvas: repeated Send clicks cannot replay the same document while its send is in flight', async () => {
  const c = await page();
  c.emit({ type: 'change', html: '<p>Send this reply once.</p>', text: 'Send this reply once.' });
  c.press(c.box().send); c.flush();
  assert.equal(c.clicks.length, 1);
  c.press(c.box().send); c.flush();
  assert.equal(c.clicks.length, 1, 'Canvas may leave Reply enabled until its network request finishes');
});

test('Canvas: a shortcut can retry after the frame flush times out', async () => {
  const c = await page();
  c.emit({ type: 'change', html: '<p>Send this reply once.</p>', text: 'Send this reply once.' });
  c.emit({ type: 'send' }); c.tick(3000);
  assert.equal(c.clicks.length, 0);
  c.emit({ type: 'send' }); c.flush();
  assert.equal(c.clicks.length, 1, 'a held shortcut has not sent the document');
});

test('Canvas: an overdue flush reply cannot send before the timeout callback runs', async () => {
  const c = await page();
  c.press(c.box().send);
  c.clock(103000); // The page was suspended; its timeout task has not run yet.
  c.flush();
  assert.equal(c.clicks.length, 0, 'the request deadline applies even when timer tasks are delayed');
  assert.equal(c.ports.at(-1).sent.at(-1).type, 'held');
});

test('Canvas: replacing the frame retires its outstanding send request', async () => {
  const c = await page();
  c.press(c.box().send);
  const old = c.ports.at(-1), request = old.sent.find((m) => m.type === 'flush').request;
  c.doc.querySelector('iframe.gz-writer').dispatchEvent({ type: 'load' });
  await c.boot();
  c.emit({ type: 'flushed', request, html: '<p>Stale reply</p>' }, old);
  assert.equal(c.clicks.length, 0);
  c.press(c.box().send); c.flush();
  assert.equal(c.clicks.length, 1, 'a new press asks the replacement frame, without waiting on the retired frame');
});

for (const fixture of ['assignment', 'inbox']) test(`Canvas: ${fixture} carry-over cannot fill another destination with the same editor id`, async () => {
  const c = await page({ fixture, helper: 'fail' });
  c.emit({ type: 'change', html: '<p>Private unsynced words.</p>', text: 'Private unsynced words.' });
  c.doc.body.remove(); c.ctx.GZ_WRITER.pass(); // Keep the orphan before navigation.
  if (fixture === 'assignment') c.location.pathname = '/courses/34/assignments/239';
  else c.destination.to = ['address-book-label-9-user'];
  c.doc.body = c.load(); c.prepare(c.doc.body);
  await c.boot();
  assert.equal(c.ports.at(-1).sent.find((m) => m.type === 'init').html, '<p><br></p>', 'the editor id alone does not identify its destination');
});

test('Canvas: a remount at the same destination keeps its unsynced words', async () => {
  const c = await page({ fixture: 'assignment', helper: 'fail' });
  c.emit({ type: 'change', html: '<p>Private unsynced words.</p>', text: 'Private unsynced words.' });
  c.doc.body.remove(); c.ctx.GZ_WRITER.pass();
  c.doc.body = c.load(); c.prepare(c.doc.body); c.helper('ok');
  await c.boot();
  assert.equal(c.ports.at(-1).sent.find((m) => m.type === 'init').html, '<p>Private unsynced words.</p>');
  assert.equal(c.ctx.GZ_WRITER_CANVAS.read(c.box().editor).text, 'Private unsynced words.');
});

test('Canvas: changing Inbox recipients while a send is held requires a new press', async () => {
  const c = await page({ fixture: 'inbox' });
  c.emit({ type: 'change', html: '<p>Private message.</p>', text: 'Private message.' });
  c.press(c.box().send);
  c.destination.to = ['address-book-label-9-user'];
  c.flush('<p>Private message.</p>');
  assert.equal(c.clicks.length, 0, 'a press addressed to one recipient cannot send to another after the asynchronous flush');
  c.press(c.box().send); c.flush('<p>Private message.</p>');
  assert.equal(c.clicks.length, 1, 'the student can explicitly send to the new destination');
});

test('Canvas: a held send cannot replay a connected button that is no longer this box\'s send', async () => {
  const c = await page({ fixture: 'inbox' }), button = c.box().send;
  c.press(button);
  button.removeAttribute('data-testid');
  c.flush();
  assert.equal(c.clicks.length, 0, 'being connected and enabled does not establish the button\'s current action');
});
