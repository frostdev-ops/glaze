// Canvas's editor writes in a frame canvas.css can't reach (owner, 2026-11-09: the text-entry submission's typing area was
// white on a dark Look). courses/page/rce-ink.js puts the palette into each editor frame's head as values, keeps it there
// when TinyMCE writes the frame anew or the palette changes, and takes it out when Glaze stops. Stand-in frames here.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = (f) => fs.readFileSync(path.join(__dirname, '../../extension', f), 'utf8');

const PALETTE = { '--gz-surface-paint, var(--gz-surface)': 'rgb(13, 27, 46)', '--gz-ink': 'rgb(230, 237, 245)', '--gz-ink-faint': 'rgb(120, 130, 140)', '--gz-accent': 'rgb(23, 200, 244)', '--gz-accent-soft': 'rgba(23, 200, 244, 0.2)' };

// A frame's document: a head whose children are kept in order, and what getElementById finds there.
const frameDoc = () => {
  const head = { kids: [], append(e) { this.kids = this.kids.filter((k) => k !== e); this.kids.push(e); e.parent = this; }, get lastElementChild() { return this.kids.at(-1) || null; } };
  return { head, createElement: (tag) => ({ tag, id: '', textContent: '', remove() { if (this.parent) { this.parent.kids = this.parent.kids.filter((k) => k !== this); this.parent = null; } } }),
    getElementById: (id) => head.kids.find((k) => k.id === id) || null };
};
const iframe = () => {
  const f = { doc: frameDoc(), listeners: {}, addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }, get contentDocument() { return this.doc; } };
  return f;
};

const load = ({ dark = true, frames = [iframe()] } = {}) => {
  const vars = { '--gz-surface': '#0d1b2e', '--gz-ink': '#e6edf5', '--gz-accent': '#17c8f4' };
  const attrs = new Set(dark ? ['data-gz-dark-theme'] : []);
  const html = { style: { getPropertyValue: (v) => vars[v] || '' }, hasAttribute: (a) => attrs.has(a) };
  const observers = [];
  let reads = 0, rafs = [];
  const c = {
    document: {
      documentElement: html,
      head: { append: () => {} },
      querySelectorAll: (s) => (s === 'iframe.tox-edit-area__iframe' ? c.frames : []),
      createElement: () => {
        const probe = { style: { color: '' }, remove: () => {} };
        return probe;
      },
    },
    frames,
    getComputedStyle: (probe) => { reads++; return { get color() { return PALETTE[probe.style.color.replace(/^var\((.*)\)$/, '$1')] || 'rgb(0, 0, 0)'; } }; },
    MutationObserver: class { constructor(fn) { this.fn = fn; this.on = false; observers.push(this); } observe() { this.on = true; } disconnect() { this.on = false; } },
    requestAnimationFrame: (fn) => { rafs.push(fn); return rafs.length; },
    cancelAnimationFrame: () => { rafs = []; },
    GZ_CTX: { site: 'canvas', on: () => c.glazeOn },
    glazeOn: true,
  };
  c.globalThis = c;
  vm.createContext(c);
  const ui = vm.runInContext(read('courses/page/rce-ink.js'), c);
  const tick = () => { const run = rafs; rafs = []; for (const f of run) f(); };
  const ink = (f) => f.contentDocument.getElementById('gz-rce-ink');
  return { c, ui, html, vars, attrs, observers, tick, ink, reads: () => reads };
};

test('each editor frame gets the palette as values, last in its head', () => {
  const { ui, c, ink } = load();
  const f = c.frames[0];
  f.doc.head.append({ id: 'tinymce-content-css' });
  ui.sync();
  const s = ink(f);
  assert.ok(s, 'a style in the frame');
  assert.equal(f.doc.head.lastElementChild, s, 'after the content CSS');
  assert.match(s.textContent, /body\.mce-content-body\{background:rgb\(13, 27, 46\)!important;color:rgb\(230, 237, 245\)!important\}/);
  assert.match(s.textContent, /color-scheme:dark/);
  assert.match(s.textContent, /a\{color:rgb\(23, 200, 244\)\}/);
  assert.match(s.textContent, /\[data-mce-placeholder\][^{]*::before\{color:rgb\(120, 130, 140\)\}/);
  // An author's dark colour lifted and a highlight kept readable, on a dark palette only.
  assert.match(s.textContent, /\[style\*="color"\]\{-webkit-text-fill-color:oklch\(from currentColor max\(l, 0\.78\) c h\)\}/);
  assert.match(s.textContent, /\[style\*="background-color"\]\{-webkit-text-fill-color:#14181f\}/);
});

test('a light palette is the light scheme, with an author\'s colours as written', () => {
  const { ui, c, ink } = load({ dark: false });
  ui.sync();
  const css = ink(c.frames[0]).textContent;
  assert.match(css, /color-scheme:light/);
  assert.doesNotMatch(css, /text-fill-color/);
});

test('passes keep one style and read the palette again only when it changes', () => {
  const { ui, c, ink, vars, reads, observers, tick } = load();
  ui.sync();
  const first = reads();
  ui.sync(); ui.sync();
  assert.equal(reads(), first, 'no style reads while the palette is the same');
  assert.equal(c.frames[0].doc.head.kids.filter((k) => k.id === 'gz-rce-ink').length, 1);
  // A course tab's frame writes its viewport on <html> as it scrolls: not a palette change.
  vars['--gz-vy'] = '-400px';
  observers[0].fn(); tick();
  assert.equal(reads(), first);
  vars['--gz-accent'] = '#ff0066';
  observers[0].fn(); tick();
  assert.ok(reads() > first, 'read again for a new accent');
  assert.ok(ink(c.frames[0]));
});

test('a frame TinyMCE writes anew gets the style back on its load', () => {
  const { ui, c, ink, tick } = load();
  const f = c.frames[0];
  ui.sync();
  f.doc = frameDoc();
  assert.equal(ink(f), null);
  for (const fn of f.listeners.load) fn();
  tick();
  assert.ok(ink(f), 'back after the frame loaded');
});

test('Glaze stopping, or leaving the page, takes the style out and stops watching', () => {
  for (const how of ['off', 'stopped']) {
    const { ui, c, ink, observers, tick } = load();
    ui.sync();
    assert.ok(ink(c.frames[0]));
    if (how === 'off') ui.off();
    else { c.glazeOn = false; observers[0].fn(); tick(); }
    assert.equal(ink(c.frames[0]), null, how);
    assert.equal(observers[0].on, false, `${how}: no longer watching`);
  }
});

test('routed on Canvas pages a student writes on, and loadable', () => {
  const need = [];
  const c = { location: { pathname: '' }, GZ_CTX: { site: 'canvas', need: (f) => { need.push(f); return new Promise(() => {}); } }, sessionStorage: { getItem: () => null } };
  c.globalThis = c;
  vm.createContext(c);
  const routes = vm.runInContext(read('content/routes.js'), c);
  const asks = (p, site = 'canvas') => { need.length = 0; c.GZ_CTX.site = site; c.location.pathname = p; routes.sync(); return need.includes('courses/page/rce-ink.js'); };
  for (const p of ['/courses/34/assignments/238', '/courses/34/discussion_topics/79', '/courses/33/quizzes/50/take', '/groups/7/discussion_topics/1', '/conversations', '/calendar']) assert.ok(asks(p), p);
  for (const p of ['/', '/grades', '/courses', '/profile/settings']) assert.ok(!asks(p), p);
  assert.ok(!asks('/ultra/courses/_1_1/outline', 'ultra'));
  const list = JSON.parse(read('../extension/background/background.js').match(/const LOADABLE = new Set\((\[[^\]]*\])\)/)[1].replace(/'/g, '"'));
  assert.ok(list.includes('courses/page/rce-ink.js'));
});
