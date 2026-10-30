// Ultra's sticky bands fold once the page scrolls under them, and stay whole in their place: a test attempt's progress
// band (the owner, 2026-10-27: make it smaller and less in the way when scrolled down, as it is in its place) and a course's
// top bar (the owner, same day: no solid backer behind it scrolled, the same treatment as the progress bar).
// features/sticky-fold.js marks a band data-gz-stuck once it has left its place, and gives back the height it folds as
// --gz-fold (the progress band) or keeps its height as --gz-whole (the bar), so nothing under it moves. Here stand-in
// layouts: the band's parent scrolls up, or is the scroller itself.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { El } = require('./stand-in-dom.js');
const { chain, cssRules, winner } = require('./helpers/css-cascade.cjs');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

const load = (kind = 'progress') => {
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
  const state = { scroll: 0 };
  let header, parent, scroller;
  if (kind === 'progress') {
    // The parent's top moves with the scroll; the band sits 8px into it, sticks at y 60, and is 170.6px tall (40.2 folded).
    header = el('div', 'assessment-progress-header', el('div', 'assessment-progress-header-first-row'), el('div', 'assessment-progress-header-second-row'));
    parent = el('div', 'panel-content-full panel-content-separator', header, el('ol', 'question-list'));
    scroller = el('div', 'panel-wrap assessment-attempt-panel', el('section', 'panel-content', parent));
    doc.boxOf = (e) => {
      const top = 100 - state.scroll;
      if (e === parent) return { left: 0, top, width: 900, height: 1500 };
      if (e === header) {
        const natural = top + 8;
        return { left: 0, top: header.style.position === 'static' ? natural : Math.max(natural, 60), width: 900, height: header.hasAttribute('data-gz-stuck') ? 40.2 : 170.6 };
      }
      return null;
    };
  } else {
    // A course's bar, first in its course section (which scrolls up in the panel), or straight in the scroller (whose box
    // stays put while its scrollTop grows); it sticks at the panel's top, 118.4px tall (48.2 folded).
    header = el('div', 'bb-course-navigation', el('bb-course-navigation', '', el('course-page-header', '', el('header', ''))));
    const content = el('div', 'course-outline-content');
    if (kind === 'bar') { parent = el('section', 'course', header, content); scroller = el('div', 'panel-wrap', parent); }
    else { parent = scroller = el('div', 'panel-wrap', header, content); Object.defineProperty(scroller, 'scrollTop', { get: () => state.scroll }); }
    doc.boxOf = (e) => {
      const top = parent === scroller ? 0 : -state.scroll;
      if (e === parent) return { left: 0, top: parent === scroller ? 0 : top, width: 1280, height: parent === scroller ? 800 : 3000 };
      if (e === header) {
        const natural = parent === scroller ? -state.scroll : top;
        return { left: 0, top: header.style.position === 'static' ? natural : Math.max(natural, 0), width: 1280, height: header.hasAttribute('data-gz-stuck') ? 48.2 : 118.4 };
      }
      return null;
    };
  }
  doc.body.append(el('div', 'course-content-container', scroller));
  const frames = new Map();
  let frameId = 0;
  const flush = () => { const pending = [...frames.values()]; frames.clear(); for (const f of pending) f(); };
  const c = { document: doc, requestAnimationFrame: (f) => { frames.set(++frameId, f); return frameId; }, cancelAnimationFrame: (id) => frames.delete(id),
    GZ_CTX: { site: 'ultra', on: () => c.glazeOn, settings: () => c.settings }, glazeOn: true, settings: { enhance: { fold: true } }, ...on('window') };
  c.globalThis = c;
  vm.createContext(c);
  const ui = vm.runInContext(read('features/sticky-fold.js'), c);
  const scrollTo = (y) => { state.scroll = y; for (const l of listeners.filter((x) => x.type === 'scroll')) l.f({ type: 'scroll', target: scroller }); flush(); };
  return { c, ui, header, listeners, scrollTo, flush, el };
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
  assert.equal(parseFloat(header.style.getPropertyValue('--gz-fold')).toFixed(3), '130.400', 'the fold to the fraction');
  assert.equal(header.style.position, undefined, 'its own position is Ultra\'s again after the measure');
  scrollTo(800);
  assert.equal(parseFloat(header.style.getPropertyValue('--gz-fold')).toFixed(3), '130.400', 'measured once per fold');
  scrollTo(0);
  assert.equal(header.hasAttribute('data-gz-stuck'), false, 'back in its place');
  assert.equal(header.style.getPropertyValue('--gz-fold'), '');
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

test('off with its setting: nothing folds, and what was folded unfolds', () => {
  for (const kind of ['progress', 'bar']) {
    const { c, ui, header, scrollTo } = load(kind);
    ui.sync();
    scrollTo(400);
    assert.equal(header.hasAttribute('data-gz-stuck'), true, `${kind}: on by default`);
    c.settings = { enhance: { fold: false } };
    ui.sync();
    assert.equal(header.hasAttribute('data-gz-stuck'), false, `${kind}: unfolded when turned off`);
    assert.equal(header.style.getPropertyValue('--gz-fold') + header.style.getPropertyValue('--gz-whole'), '');
    scrollTo(500);
    assert.equal(header.hasAttribute('data-gz-stuck'), false, `${kind}: stays whole`);
  }
});

test('routed on a course\'s pages (its tools, a test attempt), and loadable', () => {
  const need = [];
  const c = { location: { pathname: '' }, GZ_CTX: { site: 'ultra', need: (f) => { need.push(f); return new Promise(() => {}); } }, sessionStorage: { getItem: () => null } };
  c.globalThis = c;
  vm.createContext(c);
  const routes = vm.runInContext(read('features/routes.js'), c);
  const asks = (p) => { need.length = 0; c.location.pathname = p; routes.sync(); return need.includes('features/sticky-fold.js'); };
  for (const p of ['/ultra/courses/_101_1/assessment/_7_1/attempt/_8_1', '/ultra/courses/_101_1/assessment/_7_1/attempt/create',
    '/ultra/courses/_101_1/outline/assessment/_7_1/attempt/_8_1', '/ultra/courses/_101_1/outline', '/ultra/courses/_101_1/calendar',
    '/ultra/courses/_101_1/announcements']) assert.ok(asks(p), p);
  for (const p of ['/ultra/course', '/ultra/stream', '/ultra/calendar']) assert.ok(!asks(p), p);
  const list = JSON.parse(read('lib/background.js').match(/const LOADABLE = new Set\((\[[^\]]*\])\)/)[1].replace(/'/g, '"'));
  assert.ok(list.includes('features/sticky-fold.js'));
});

test('a course\'s bar stays whole at the top and folds once the course scrolls under it', () => {
  for (const kind of ['bar', 'bar in its scroller']) {
    const { ui, header, scrollTo, flush } = load(kind);
    ui.sync();
    flush();
    assert.equal(header.hasAttribute('data-gz-stuck'), false, `${kind}: at the top`);
    scrollTo(24);
    assert.equal(header.hasAttribute('data-gz-stuck'), true, `${kind}: scrolled`);
    assert.equal(parseFloat(header.style.getPropertyValue('--gz-whole')).toFixed(3), '118.400', `${kind}: its height kept, to the fraction`);
    assert.equal(header.style.getPropertyValue('--gz-fold'), '');
    scrollTo(0);
    assert.equal(header.hasAttribute('data-gz-stuck'), false, `${kind}: back at the top`);
    assert.equal(header.style.getPropertyValue('--gz-whole'), '');
  }
});

test('a course\'s bar holding Glaze\'s course strip folds as well, its strip kept', () => {
  const { ui, header, scrollTo, el } = load('bar');
  const strip = el('div', '');
  strip.id = 'gz-ctabs';
  header.prepend(strip);
  ui.sync();
  scrollTo(400);
  assert.equal(header.hasAttribute('data-gz-stuck'), true);
  scrollTo(0);
  assert.equal(header.hasAttribute('data-gz-stuck'), false);
});

test('folded, the band is a small pill at the column\'s end, its filters row hidden', () => {
  const theme = cssRules('theme.css');
  const HEADER = ['html', 'body', 'div#site-wrap', 'div.assessment-attempt-panel', 'section.panel-content', 'div.panel-content-full', 'div.assessment-progress-header'];
  const stuck = Object.assign(chain(...HEADER), { attrs: { 'data-gz-stuck': '' } });
  assert.equal(winner(theme, stuck, 'border-radius')[0], '999px');
  assert.equal(winner(theme, stuck, 'inline-size')[0], 'fit-content');
  assert.equal(winner(theme, stuck, 'margin-inline-start')[0], 'auto');
  assert.match(winner(theme, stuck, 'margin-block-end')[0], /--gz-fold/);
  const third = { tag: 'div', id: '', cls: ['assessment-progress-header-third-row'], parent: stuck };
  assert.equal(winner(theme, third, 'display')?.[0], 'none');
  // In its place it keeps the band's corners.
  assert.match(winner(theme, chain(...HEADER), 'border-radius')[0], /--gz-radius/);
});

test('folded, a course\'s bar is its tools in a small pill at the end, with no backing; at the top it is as it was', () => {
  const theme = cssRules('theme.css');
  // As read on a real course: the bar is the scroller's first child; its tools row is a toolbar in bb-course-navigation.
  const PANEL = ['html', 'body', 'div#site-wrap', 'div.course-content-container', 'div.panel-wrap.hide-in-background.modern'];
  const at = (bar, ...rest) => rest.reduce((parent, spec) => Object.assign(chain(spec), { parent }), bar);
  const whole = chain(...PANEL, 'div.bb-course-navigation');
  const stuck = Object.assign(chain(...PANEL, 'div.bb-course-navigation'), { attrs: { 'data-gz-stuck': '' } });
  const tools = (bar) => at(bar, 'bb-course-navigation', 'div.makeStylesroot-0-2-75.makeStylesbasic-0-2-76.makeStylestoolbar-0-2-70');
  assert.equal(winner(theme, tools(stuck), 'border-radius')[0], '999px');
  assert.equal(winner(theme, tools(stuck), 'inline-size')[0], 'fit-content');
  assert.equal(winner(theme, tools(stuck), 'margin-inline-start')[0], 'auto');
  assert.equal(winner(theme, tools(stuck), 'pointer-events')[0], 'auto');
  assert.equal(winner(theme, stuck, 'pointer-events')[0], 'none', 'beside the pill the page takes the pointer');
  assert.match(winner(theme, stuck, 'block-size')[0], /var\(--gz-whole/, 'its height kept, so nothing under it moves');
  assert.match(winner(theme, stuck, 'min-block-size')[0], /var\(--gz-whole/, 'also where Ultra\'s scroller, a flex column, would shrink it');
  // The header row is out of view, not out of the page: still read by assistive tech.
  const head = at(stuck, 'course-page-header');
  assert.equal(winner(theme, head, 'position')[0], 'absolute');
  assert.equal(winner(theme, head, 'clip-path')[0], 'inset(50%)');
  assert.equal(winner(theme, head, 'display'), null);
  // Glaze's course strip stays where it is, and takes the pointer: a course is switched to and back from at any place.
  const strip = Object.assign(at(stuck, 'div'), { id: 'gz-ctabs' });
  assert.equal(winner(theme, strip, 'pointer-events')[0], 'auto');
  assert.equal(winner(theme, strip, 'position'), null);
  assert.equal(winner(theme, strip, 'clip-path'), null);
  // The pill keeps the window's gap above it, or the strip's after it: the bar's own top padding goes.
  assert.match(winner(theme, tools(stuck), 'margin-(?:top|block-start)')[0], /var\(--gz-float-gap/);
  for (const at of ['above', 'between', 'below']) {
    const html = Object.assign(chain('html'), { attrs: { 'data-gz-ctabs': at } });
    const bar = Object.assign(chain('body', 'div.bb-course-navigation'), { attrs: { 'data-gz-stuck': '' } });
    bar.parent.parent = html;
    assert.equal(winner(theme, bar, 'padding-(?:top|block-start)')[0], '0', at);
    assert.match(winner(theme, tools(bar), 'margin-(?:top|block-start)')[0], /var\(--gz-float-gap/, at);
  }
  const link = at(tools(stuck), 'div.makeStylesroot-0-2-77.js-course-navigation', 'div.makeStylesscrollArea-0-2-78', 'nav.makeStylesroot-0-2-79',
    'ul.MuiList-root.bb-ui-navigation-list-horizontal', 'li', 'a.MuiButtonBase-root.MuiListItemButton-root');
  assert.equal(winner(theme, link, 'font-size')[0], '0.75rem');
  // The name is a Typography span with a size of its own: it takes the link's.
  assert.equal(winner(theme, at(link, 'div.MuiListItemText-root', 'span.MuiTypography-root.MuiTypography-body1'), 'font-size')[0], 'inherit');
  // No backing behind it: the veil is off while it is folded.
  assert.ok(theme.some(([sel, body]) => /^div\.bb-course-navigation\[data-gz-stuck\].*::before$/.test(sel) && /display:\s*none/.test(body)));
  // At the top: the two rows as before.
  assert.match(winner(theme, tools(whole), 'border-radius')[0], /0 0 var\(--gz-radius/);
  assert.equal(winner(theme, at(whole, 'course-page-header'), 'position'), null);
  assert.equal(winner(theme, whole, 'pointer-events'), null);
});
