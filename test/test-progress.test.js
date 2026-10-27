// A test attempt's progress band (the bar, "N of M questions remaining") sticks to the top of Ultra's scroller as a whole
// band over the questions (the owner, 2026-10-27: make it smaller and less in the way when scrolled down, as it is in its
// place). features/test-progress.js marks it data-gz-stuck once it has left its place, and gives back the height it folds
// as --gz-progress-fold, so nothing under it moves. Here a stand-in layout: the parent scrolls up, the band stops at y 60.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { El } = require('./stand-in-dom.js');
const { chain, cssRules, winner } = require('./helpers/css-cascade.cjs');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

const load = () => {
  const doc = { activeElement: null };
  const make = (t) => new El(t, doc);
  const el = (tag, cls, ...kids) => { const e = make(tag); e.className = cls; e.append(...kids); return e; };
  doc.root = make('html'); doc.body = make('body'); doc.root.append(doc.body);
  const listeners = [];
  const on = (target) => ({
    addEventListener: (type, f, o) => listeners.push({ target, type, f, o }),
    removeEventListener: (type, f) => { const i = listeners.findIndex((l) => l.target === target && l.type === type && l.f === f); if (i >= 0) listeners.splice(i, 1); },
  });
  Object.assign(doc, { documentElement: doc.root, querySelector: (s) => doc.root.querySelector(s), querySelectorAll: (s) => doc.root.querySelectorAll(s), ...on('document') });
  const header = el('div', 'assessment-progress-header', el('div', 'assessment-progress-header-first-row'), el('div', 'assessment-progress-header-second-row'));
  const parent = el('div', 'panel-content-full panel-content-separator', header, el('ol', 'question-list'));
  doc.body.append(el('div', 'panel-wrap assessment-attempt-panel', el('section', 'panel-content', parent)));
  const state = { scroll: 0 };
  // The parent's top moves with the scroll; the band sits 8px into it, sticks at y 60, and is 170.6px tall (40.2 folded).
  doc.boxOf = (e) => {
    const top = 100 - state.scroll;
    if (e === parent) return { left: 0, top, width: 900, height: 1500 };
    if (e === header) {
      const natural = top + 8;
      return { left: 0, top: header.style.position === 'static' ? natural : Math.max(natural, 60), width: 900, height: header.hasAttribute('data-gz-stuck') ? 40.2 : 170.6 };
    }
    return null;
  };
  const frames = new Map();
  let frameId = 0;
  const flush = () => { const pending = [...frames.values()]; frames.clear(); for (const f of pending) f(); };
  const c = { document: doc, requestAnimationFrame: (f) => { frames.set(++frameId, f); return frameId; }, cancelAnimationFrame: (id) => frames.delete(id),
    GZ_CTX: { site: 'ultra', on: () => c.glazeOn }, glazeOn: true, ...on('window') };
  c.globalThis = c;
  vm.createContext(c);
  const ui = vm.runInContext(read('features/test-progress.js'), c);
  const scrollTo = (y) => { state.scroll = y; for (const l of listeners.filter((x) => x.type === 'scroll')) l.f({ type: 'scroll', target: doc.querySelector('.assessment-attempt-panel') }); flush(); };
  return { c, ui, header, listeners, scrollTo, flush };
};

test('in its place the band stays whole; scrolled under, it folds and gives the fold back below', () => {
  const { ui, header, scrollTo, flush } = load();
  ui.sync();
  flush();
  assert.equal(header.hasAttribute('data-gz-stuck'), false, 'at the top');
  scrollTo(30);
  assert.equal(header.hasAttribute('data-gz-stuck'), false, 'still above the line');
  scrollTo(400);
  assert.equal(header.hasAttribute('data-gz-stuck'), true, 'questions under it');
  assert.equal(parseFloat(header.style.getPropertyValue('--gz-progress-fold')).toFixed(3), '130.400', 'the fold to the fraction');
  assert.equal(header.style.position, undefined, 'its own position is Ultra\'s again after the measure');
  scrollTo(800);
  assert.equal(parseFloat(header.style.getPropertyValue('--gz-progress-fold')).toFixed(3), '130.400', 'measured once per fold');
  scrollTo(0);
  assert.equal(header.hasAttribute('data-gz-stuck'), false, 'back in its place');
  assert.equal(header.style.getPropertyValue('--gz-progress-fold'), '');
});

test('one set of listeners however often the page syncs; none, and no fold, once the page or Glaze is left', () => {
  const { c, ui, header, listeners, scrollTo } = load();
  ui.sync(); ui.sync();
  assert.deepEqual(listeners.map((l) => `${l.target} ${l.type}`).sort(), ['document scroll', 'window resize']);
  assert.equal(listeners.find((l) => l.type === 'scroll').o?.capture, true, 'a scroller\'s scroll reaches the document only in capture');
  scrollTo(400);
  ui.off();
  assert.deepEqual(listeners, []);
  assert.equal(header.hasAttribute('data-gz-stuck'), false);
  ui.sync();
  scrollTo(400);
  c.glazeOn = false;
  ui.sync();
  assert.deepEqual(listeners, []);
  assert.equal(header.hasAttribute('data-gz-stuck'), false);
});

test('routed on test attempts only, and loadable', () => {
  const need = [];
  const c = { location: { pathname: '' }, GZ_CTX: { site: 'ultra', need: (f) => { need.push(f); return new Promise(() => {}); } }, sessionStorage: { getItem: () => null } };
  c.globalThis = c;
  vm.createContext(c);
  const routes = vm.runInContext(read('features/routes.js'), c);
  const asks = (p) => { need.length = 0; c.location.pathname = p; routes.sync(); return need.includes('features/test-progress.js'); };
  for (const p of ['/ultra/courses/_101_1/assessment/_7_1/attempt/_8_1', '/ultra/courses/_101_1/assessment/_7_1/attempt/create',
    '/ultra/courses/_101_1/outline/assessment/_7_1/attempt/_8_1']) assert.ok(asks(p), p);
  for (const p of ['/ultra/courses/_101_1/journal/_9_1', '/ultra/courses/_101_1/assessment/_7_1/overview', '/ultra/courses/_101_1/outline']) assert.ok(!asks(p), p);
  const list = JSON.parse(read('lib/background.js').match(/const LOADABLE = new Set\((\[[^\]]*\])\)/)[1].replace(/'/g, '"'));
  assert.ok(list.includes('features/test-progress.js'));
});

test('folded, the band is a small pill at the column\'s end, its filters row hidden', () => {
  const theme = cssRules('theme.css');
  const HEADER = ['html', 'body', 'div#site-wrap', 'div.assessment-attempt-panel', 'section.panel-content', 'div.panel-content-full', 'div.assessment-progress-header'];
  const stuck = Object.assign(chain(...HEADER), { attrs: { 'data-gz-stuck': '' } });
  assert.equal(winner(theme, stuck, 'border-radius')[0], '999px');
  assert.equal(winner(theme, stuck, 'inline-size')[0], 'fit-content');
  assert.equal(winner(theme, stuck, 'margin-inline-start')[0], 'auto');
  assert.match(winner(theme, stuck, 'margin-block-end')[0], /--gz-progress-fold/);
  const third = { tag: 'div', id: '', cls: ['assessment-progress-header-third-row'], parent: stuck };
  assert.equal(winner(theme, third, 'display')?.[0], 'none');
  // In its place it keeps the band's corners.
  assert.match(winner(theme, chain(...HEADER), 'border-radius')[0], /--gz-radius/);
});
