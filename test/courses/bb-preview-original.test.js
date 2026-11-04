// Original-only PDF attachments use the live discussion shape, with invented names and URLs. The full browser check
// also draws a real PDF; these tests cover credential boundaries, independent controls and interrupted reads.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const { El } = require('../stand-in-dom.js');
const source = fs.readFileSync(process.env.BB_PREVIEW_SOURCE || require.resolve('../../extension/courses/page/bbpreview.js'), 'utf8');
const ORIGIN = 'https://school.example.edu';
const FILE = { fileName: 'Speaking rubric.pdf', displayName: 'Speaking rubric.pdf', mimeType: 'application/pdf', render: 'inline', resourceUrl: '/courses/1/202640001/db/_900_1/embedded/Speaking%20rubric.pdf' };
const settle = () => new Promise(setImmediate);
const page = (files = [FILE], get = async () => new Response('synthetic PDF')) => {
  const doc = {}, ports = [], reads = [], timers = new Map(); let seq = 0;
  doc.root = new El('html', doc); doc.documentElement = doc.root;
  doc.body = new El('div', doc); doc.body.id = 'site-wrap'; doc.root.append(doc.body);
  for (const k of ['querySelector', 'querySelectorAll', 'addEventListener', 'removeEventListener', 'dispatchEvent']) doc[k] = El.prototype[k].bind(doc.root);
  doc.createElement = (tag) => { const el = new El(tag, doc); if (tag === 'iframe') el.contentWindow = { postMessage() {} }; return el; };
  for (const f of files) {
    const el = new El('div', doc), host = new El('div', doc), controls = new El('div', doc), native = new El('button', doc);
    el.setAttribute('data-bbtype', 'attachment'); el.setAttribute('data-bbfile', JSON.stringify(f));
    host.className = 'bb-editor-file-viewer'; controls.className = 'js-file-viewer-root-controls'; native.setAttribute('aria-label', 'More options');
    controls.append(native); host.append(controls); el.append(host); doc.body.append(el);
  }
  const settings = { enabled: true, enhance: { bbPreviews: true }, writer: { pdf: true } };
  const ctx = vm.createContext({ document: doc, location: new URL(`${ORIGIN}/ultra/courses/_101_1/discussion/_19_1`), URL, AbortController, crypto,
    GZ_COLORS: [], GZ_CTX: { site: 'ultra', on: () => true, settings: () => settings, t: (s) => s, locale: () => 'en' },
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    fetch: async (url, init) => { reads.push({ url, init }); return get(url, init); },
    setTimeout: (fn, ms) => { timers.set(++seq, { fn, ms }); return seq; }, clearTimeout: (id) => timers.delete(id),
    chrome: { runtime: { getURL: (s) => `chrome-extension://test/${s}`, sendMessage: async () => ({ ok: true }) } },
    MessageChannel: class { constructor() { this.port1 = { sent: [], postMessage(m) { this.sent.push(m); }, close() { this.closed = true; } }; this.port2 = { close() {} }; ports.push(this.port1); } },
    addEventListener: (...args) => doc.addEventListener(...args), removeEventListener: (...args) => doc.removeEventListener(...args),
  });
  vm.runInContext(source, ctx);
  const sync = () => ctx.GZ_BB_PREVIEW_UI.sync();
  const buttons = () => doc.querySelectorAll('button.gz-bb-pdf');
  const press = (n = 0) => buttons()[n].dispatchEvent({ type: 'click' });
  sync();
  const nativeMenu = () => doc.querySelectorAll('button').find((b) => b.getAttribute('aria-label') === 'More options');
  return { doc, ctx, settings, reads, ports, timers, sync, buttons, press, nativeMenu };
};

test('original-only PDFs get a preview toggle without fetching or replacing the native menu', () => {
  const p = page(); p.sync();
  assert.equal(p.buttons().length, 1);
  assert.equal(p.buttons()[0].getAttribute('aria-expanded'), 'false');
  assert.equal(p.reads.length, 0);
  assert.ok(p.nativeMenu());
  p.press();
  assert.equal(p.reads[0].url, ORIGIN + FILE.resourceUrl);
  assert.equal(p.reads[0].init.credentials, 'same-origin');
  assert.equal(p.reads[0].init.mode, 'cors', 'the school may redirect its original to Blackboard file storage');
  p.press();
});

test('original-only preview refuses foreign origins, credentials, non-files, non-PDFs and native viewer URLs', () => {
  for (const change of [{ resourceUrl: 'https://foreign.example/private.pdf' }, { resourceUrl: 'https://person:secret@school.example.edu/courses/1/a.pdf' },
    { resourceUrl: '/learn/api/public/v1/users/me' }, { resourceUrl: '' }, { mimeType: 'text/plain', fileName: 'Notes.txt' },
    { render: 'link' }, { viewerUrl: '/bbcswebdav/courses/1/a.pdf?render=inline' }]) {
    const p = page([{ ...FILE, ...change }]);
    assert.equal(p.buttons().length, 0, JSON.stringify(change));
    assert.equal(p.reads.length, 0);
  }
});

test('duplicate original PDF references have independent preview and focus controls', async () => {
  const p = page([FILE, FILE]);
  p.press(0); p.press(1); await settle();
  const [a, b] = p.ports;
  a.onmessage({ data: { type: 'ready' } }); b.onmessage({ data: { type: 'ready' } }); await settle();
  a.onmessage({ data: { type: 'view:shown' } }); b.onmessage({ data: { type: 'view:shown' } });
  assert.equal(p.doc.querySelectorAll('iframe.gz-pv').length, 2);
  b.onmessage({ data: { type: 'view:esc' } });
  assert.equal(p.doc.activeElement, p.buttons()[1]);
  p.press(0);
  assert.equal(p.doc.querySelectorAll('iframe.gz-pv').length, 1);
  assert.equal(p.buttons()[1].getAttribute('aria-expanded'), 'true');
  p.press(1);
});

test('collapsing while the PDF reads aborts it and ignores its late result and retired port', async () => {
  let release;
  const p = page([FILE], () => new Promise((r) => { release = r; }));
  p.press(); const old = p.ports[0]; old.onmessage({ data: { type: 'ready' } });
  p.press();
  assert.equal(p.reads[0].init.signal.aborted, true);
  release(new Response('late PDF')); await settle();
  old.onmessage({ data: { type: 'view:shown' } });
  assert.equal(old.sent.length, 0);
  assert.equal(p.doc.querySelectorAll('iframe.gz-pv').length, 0);
  assert.equal(p.buttons()[0].getAttribute('aria-expanded'), 'false');
});

test('a failed PDF read leaves Open original and the native menu available, without a busy toggle', async () => {
  const p = page([FILE], async () => new Response('', { status: 403 }));
  p.press(); await settle();
  assert.equal(p.doc.querySelectorAll('iframe.gz-pv').length, 0);
  assert.equal(p.doc.querySelector('.gz-bb-pdf-fallback a').href, ORIGIN + FILE.resourceUrl);
  assert.equal(p.buttons()[0].hasAttribute('aria-busy'), false);
  assert.ok(p.nativeMenu());
  p.press();
});

test('a failed original PDF viewer returns its keyboard focus to its own toggle without taking focus from native controls', async () => {
  for (const focused of [true, false]) {
    const p = page([FILE, FILE]); p.press(1); await settle();
    const port = p.ports[0];
    port.onmessage({ data: { type: 'ready' } }); await settle();
    port.onmessage({ data: { type: 'view:shown' } });
    const frame = p.doc.querySelector('iframe.gz-pv');
    (focused ? frame : p.nativeMenu()).focus();
    port.onmessage({ data: { type: 'view:failed', reason: 'draw' } });
    assert.equal(frame.isConnected, false);
    assert.equal(p.doc.activeElement, focused ? p.buttons()[1] : p.nativeMenu());
    assert.ok(p.doc.querySelector('.gz-bb-pdf-fallback a'));
    p.press(1);
  }
});

test('a zero-byte PDF response is reported without opening an empty viewer or removing the original link', async () => {
  const p = page([FILE], async () => new Response(new Uint8Array()));
  p.press(); await settle();
  assert.equal(p.doc.querySelectorAll('iframe.gz-pv').length, 0);
  assert.equal(p.doc.querySelector('[role="status"]').textContent, 'This PDF is empty.');
  assert.equal(p.doc.querySelector('.gz-bb-pdf-fallback a').href, ORIGIN + FILE.resourceUrl);
  assert.equal(p.buttons()[0].hasAttribute('aria-busy'), false);
  p.press();
});

test('switching off PDFs or replacing the attachment removes its view, controls, timers and listeners', () => {
  for (const change of [(p) => { p.settings.writer.pdf = false; }, (p) => { p.settings.enhance.bbPreviews = false; },
    (p) => p.doc.querySelector('[data-bbfile]').setAttribute('data-bbfile', JSON.stringify({ ...FILE, resourceUrl: 'https://foreign.example/new.pdf' }))]) {
    const p = page(); p.press(); change(p); p.sync();
    assert.equal(p.buttons().length, 0);
    assert.equal(p.doc.querySelectorAll('iframe.gz-pv').length, 0);
    assert.equal(p.reads[0].init.signal.aborted, true);
    assert.equal(p.timers.size, 0);
    assert.equal(p.doc.root.listeners.length, 0);
    assert.ok(p.nativeMenu());
  }
});
