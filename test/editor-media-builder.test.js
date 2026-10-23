// The editor's "Video or animation" builder (lib/editor-xbg.js) run for real against an inert page: what the Kind picker, the link
// box and the file picker do to the background a Look already has (LOOK-8), and what the preview's report of a file past the limits
// says (LOOK-6). Nothing here touches a browser: the page is a handful of stand-in elements, the worker a function.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const D = require('../defaults.js');
const XP = require('../lib/lookparts.js');
const MEDIA = require('../lib/media.js');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const HASH = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQ';
const LINK = 'https://cdn.example.com/loops/rain.webm';

class El {
  constructor(tag, doc) {
    Object.assign(this, { tagName: tag, doc, children: [], attrs: {}, listeners: {}, dataset: {}, className: '', textContent: '', hidden: false, parent: null });
  }
  // A select answers with the option picked, until one is chosen.
  get value() { return this._value ?? (this.tagName === 'select' ? this.children.find((c) => c.selected)?.value ?? this.children[0]?.value ?? '' : ''); }
  set value(v) { this._value = v; }
  append(...kids) { for (const k of kids) { if (k instanceof El) k.parent = this; this.children.push(k); } }
  replaceChildren(...kids) { this.children = []; this.append(...kids); }
  after() {}
  setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'id') this.id = String(v); }
  addEventListener(type, f) { (this.listeners[type] ||= []).push(f); }
  fire(type) { for (const f of this.listeners[type] || []) f({ type, target: this, isTrusted: true }); }
  get all() { return this.children.filter((c) => c instanceof El).flatMap((c) => [c, ...c.all]); }
  get files() { return this._files || []; }
  focus() {}
}

// The builder with the real editor-x.js and lib/editor-xbg.js, a recording worker, and the parts the Look has.
const rig = ({ parts = null, reply = (m) => (m.op === 'list' ? { ok: true, files: [] } : { ok: true }), answer = () => true } = {}) => {
  const doc = { body: null, elements: {} };
  doc.createElement = (tag) => new El(tag, doc);
  const roots = {};
  for (const id of ['x-shader', 'x-layers', 'x-media']) { roots[id] = new El('div', doc); roots[id].id = id; }
  const everything = () => Object.values(roots).flatMap((r) => [r, ...r.all]);
  doc.getElementById = (id) => everything().find((e) => e.id === id) || null;
  doc.querySelector = () => null;
  doc.querySelectorAll = () => [];
  const sent = [], listeners = {}, asked = [];
  const ctx = vm.createContext({
    document: doc, console, Promise, JSON, Object, Array, String, Number, Math, Error, Set, Map, URL, btoa, Uint8Array, ArrayBuffer, clearTimeout, setTimeout, CSS: { escape: (s) => s }, structuredClone,
    Option: function Option(text, value, d, selected) { const o = new El('option', doc); Object.assign(o, { text, value: value ?? text, selected: !!selected }); o.textContent = text; return o; },
    chrome: { runtime: { lastError: null, getManifest: () => ({ host_permissions: ['https://frostdev.io/*'] }), sendMessage: (m, cb) => { sent.push(m); const r = Promise.resolve(reply(m)); if (cb) r.then(cb); return r; } },
      permissions: { request: (o) => { asked.push(o.origins); return Promise.resolve(answer(o.origins)); } } },
    location: { origin: 'chrome-extension://glaze' }, addEventListener: (t, f) => { (listeners[t] ||= []).push(f); },
    GZ_XPARTS: XP, GZ_MEDIA: MEDIA, GZ_SPEC: D.GZ_SPEC, GZ_COLORS: D.GZ_COLORS, GZ_MX: require('../lib/motionx.js'),
  });
  vm.runInContext(`${read('lib/site.js')}\n${read('lib/editor-x.js')}\n${read('lib/editor-xbg.js')}\nglobalThis.X = GZ_EDITOR_X; globalThis.BG = GZ_EDITOR_XBG;`, ctx);
  const s = { parts: structuredClone(parts), bg: { kind: 'media' }, motion: { level: 'full' } }, writes = [];
  const frame = { contentWindow: {} };
  ctx.X.mount({ s, t: (str, v) => str.replace(/\{(\w+)\}/g, (_, k) => v?.[k]), save: (keys, soon, only) => writes.push({ keys, only, media: structuredClone(s.parts?.x?.bg?.media ?? null) }), preview() {}, frame });
  const media = () => s.parts?.x?.bg?.media ?? null;
  const find = (pred) => roots['x-media'].all.find(pred);
  const kind = () => find((e) => e.tagName === 'select');
  const link = () => find((e) => e.id === 'x-media-link');
  const note = () => find((e) => e.id === 'x-media-note');
  const picker = () => find((e) => e.id === 'x-media-file');
  const settle = () => new Promise((done) => setTimeout(done, 5));
  // The preview frame reporting to the editor.
  const report = (data) => { for (const f of listeners.message || []) f({ origin: 'chrome-extension://glaze', source: frame.contentWindow, data }); };
  return { s, ctx, sent, writes, media, kind, link, note, picker, settle, report, roots, find, asked };
};
const pickKind = (r, k) => { const sel = r.kind(); sel.value = k; sel.fire('change'); };
const typeLink = (r, v) => { const l = r.link(); l.value = v; l.fire('change'); };
const withFile = { x: { bg: { media: { type: 'video', src: `file:${HASH}`, dim: 60 } } } };
const withLink = { x: { bg: { media: { type: 'video', src: LINK, fit: 'contain' } } } };

test('changing Kind only changes what the next link or file will be: the current background keeps its type and file', async () => {
  const r = rig({ parts: withFile });
  await r.settle();
  assert.equal(r.kind().value, 'video');
  pickKind(r, 'lottie');
  assert.deepEqual(r.media(), withFile.x.bg.media, 'a video file is not re-typed as a Lottie animation');
  assert.deepEqual(r.writes, [], 'and nothing is saved');
  assert.equal(r.picker().accept, '.json', 'the picker now offers Lottie files');
  pickKind(r, 'image');
  assert.equal(r.picker().accept, '.webp,.avif');
  assert.deepEqual(r.media(), withFile.x.bg.media);
  // The same for a link: it keeps its type until another link or file replaces it.
  const l = rig({ parts: withLink });
  await l.settle();
  pickKind(l, 'lottie');
  assert.deepEqual(l.media(), withLink.x.bg.media);
  assert.deepEqual(l.writes, []);
});

test('the next link is the kind the picker shows, and keeps the fit and dim the Look has', async () => {
  const r = rig({ parts: withLink });
  await r.settle();
  pickKind(r, 'image');
  typeLink(r, 'https://cdn.example.com/a.webp');
  await r.settle();
  assert.deepEqual(r.media(), { type: 'image', src: 'https://cdn.example.com/a.webp', fit: 'contain' });
});

test('clearing the link box does not remove a kept file that is in use, even after a refused link', async () => {
  const r = rig({ parts: withFile });
  await r.settle();
  assert.equal(r.link().value, '', 'the box is empty while a file is in use');
  typeLink(r, 'http://cdn.example.com/not-https.webm');
  assert.deepEqual(r.media(), withFile.x.bg.media, 'a refused link changes nothing');
  assert.match(r.note().textContent, /isn’t a link Glaze can use/);
  typeLink(r, '');
  assert.deepEqual(r.media(), withFile.x.bg.media, 'and clearing it afterwards leaves the file');
  assert.deepEqual(r.writes, []);
  assert.doesNotMatch(r.note().textContent, /isn’t a link/, 'the refusal is cleared');
  assert.match(r.note().textContent, /file kept on this computer/);
});

test('clearing the link box still removes a background that is a link', async () => {
  const r = rig({ parts: withLink });
  await r.settle();
  assert.equal(r.link().value, LINK);
  typeLink(r, '');
  assert.equal(r.media(), null);
  assert.equal(r.writes.length, 1);
  assert.equal(r.note().textContent, '');
});

test('a link replaces a kept file only when it is a good link', async () => {
  const r = rig({ parts: withFile });
  await r.settle();
  typeLink(r, LINK);
  await r.settle();
  assert.deepEqual(r.media(), { type: 'video', src: LINK, dim: 60 }, 'the link, with the dim the Look had');
});

// The worker fetches a link's file (lib/media.js remote), and a host Glaze lacks is refused there: the link's host is asked
// for in the change that takes it (a paste and Enter, or leaving the box), before anything is awaited.
test('a link asks the browser for its host as it is taken; refused, the background stays as it was and the box says so', async () => {
  const r = rig({ parts: withFile });
  await r.settle();
  typeLink(r, LINK);
  assert.deepEqual(r.asked, [['https://cdn.example.com/*']], 'asked at once, for that host');
  await r.settle();
  assert.equal(r.media().src, LINK);
  const no = rig({ parts: withFile, answer: () => false });
  await no.settle();
  typeLink(no, LINK);
  await no.settle();
  assert.deepEqual(no.asked, [['https://cdn.example.com/*']]);
  assert.deepEqual(no.media(), withFile.x.bg.media, 'refused: the kept file stays');
  assert.deepEqual(no.writes, []);
  assert.equal(no.note().textContent, 'That link can’t be saved.');
  // A link Glaze can't use, or an emptied box, asks nothing.
  const bad = rig({ parts: withLink });
  await bad.settle();
  typeLink(bad, 'http://cdn.example.com/x.webm');
  typeLink(bad, '');
  await bad.settle();
  assert.deepEqual(bad.asked, []);
});

test('the preview reporting a file past the limits says so, in words that are not about the link', async () => {
  const r = rig({ parts: withLink });
  await r.settle();
  const status = () => r.roots['x-media'].all.filter((e) => e.attrs.role === 'status').map((e) => e.textContent);
  r.report({ gzMediaState: { state: 'failed', why: 'limits' } });
  const text = status().find((t) => /won’t play that file/.test(t));
  assert.ok(text, `a limits message among ${JSON.stringify(status())}`);
  assert.match(text, /12 MB/);
  assert.match(text, /4096/);
  r.report({ gzMediaState: { state: 'failed', why: 'load' } });
  assert.ok(status().some((t) => /couldn’t load it/.test(t)), 'a link that does not load is still about the link');
  assert.ok(!status().some((t) => /won’t play that file/.test(t)));
  r.report({ gzMediaState: { state: 'ready' } });
  assert.ok(status().includes('The preview is playing it.'));
});

test('a file whose location and device details cannot be taken out is not kept, and the editor says why', async () => {
  const r = rig({ parts: null, reply: (m) => (m.op === 'list' ? { ok: true, files: [] } : m.op === 'put' ? { ok: false, error: m.kind === 'video' ? 'meta' : 'type' } : { ok: true }) });
  await r.settle();
  const status = () => r.roots['x-media'].all.filter((e) => e.attrs.role === 'status').map((e) => e.textContent);
  const choose = async () => {
    r.picker()._files = [{ size: 2048, arrayBuffer: async () => new ArrayBuffer(2048) }];
    r.picker().fire('change');
    await r.settle();
  };
  await choose();
  assert.ok(status().some((t) => /can’t take the location and device details out of that file, so it won’t keep it/.test(t)), JSON.stringify(status()));
  assert.equal(r.media(), null, 'and nothing is set');
  assert.deepEqual(r.sent.filter((m) => m.op === 'put').map((m) => m.kind), ['video']);
  pickKind(r, 'image');
  await choose();
  assert.ok(status().some((t) => /can’t play that file as this kind/.test(t)), 'another refusal is still its own');
});
