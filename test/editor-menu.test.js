// Ultra opens an editor's toolbar menu below its button, inside the page's scroller; at the foot of a test the colour
// menu's last colours sat under the scroller's edge, above the Save / Submit footer (the 2026-10-27 audit: Red hidden).
// features/editor-menu.js, a page feature (features/routes.js), scrolls the open menu into view once Ultra draws it.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { El } = require('./stand-in-dom.js');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

const load = () => {
  const doc = { activeElement: null };
  const make = (t) => new El(t, doc);
  const el = (tag, cls, ...kids) => { const e = make(tag); e.className = cls; e.append(...kids); return e; };
  doc.root = make('html'); doc.body = make('body'); doc.root.append(doc.body);
  const listeners = [];
  Object.assign(doc, {
    documentElement: doc.root, querySelector: (s) => doc.root.querySelector(s), querySelectorAll: (s) => doc.root.querySelectorAll(s),
    addEventListener: (type, f, o) => listeners.push({ type, f, capture: o === true || !!o?.capture }),
    removeEventListener: (type, f) => { const i = listeners.findIndex((l) => l.type === type && l.f === f); if (i >= 0) listeners.splice(i, 1); },
  });
  const frames = [];
  const c = { document: doc, requestAnimationFrame: (f) => { frames.push(f); return frames.length; }, GZ_CTX: { site: 'ultra', on: () => c.glazeOn }, glazeOn: true };
  c.globalThis = c;
  vm.createContext(c);
  const ui = vm.runInContext(read('features/editor-menu.js'), c);
  const button = el('button', 'bb-editor-toolbar-button bb-editor-toolbar-button--main bb-editor-submenu-is-closed bb-editor-toolbar-dropdown color-picker-normal');
  button.setAttribute('aria-expanded', 'false');
  const icon = el('span', 'icon paint-bucket-normal-icon');
  button.append(icon);
  const menu = el('ul', 'bb-editor-toolbar bb-editor-toolbar-submenu', el('li', '', 'Red'));
  const scrolled = [];
  menu.scrollIntoView = (o) => scrolled.push(o);
  menu.getClientRects = () => (menu.hidden ? [] : [{}]);
  menu.hidden = true;
  doc.body.append(el('div', 'bb-editor-toolbar no-select', el('div', 'bb-editor-toolbar-button-container bb-editor-toolbar-dropdown-container', button, menu)));
  // A click as the DOM delivers it: the document's listeners, then (bubbling) Ultra's own on the button, which opens it.
  const click = (target) => {
    for (const l of listeners.filter((x) => x.type === 'click')) l.f({ type: 'click', target });
    const open = button.getAttribute('aria-expanded') !== 'true';
    button.setAttribute('aria-expanded', String(open)); menu.hidden = !open;
    for (const f of frames.splice(0)) f();
  };
  return { c, ui, button, icon, menu, scrolled, listeners, click };
};

test('an opened toolbar menu is scrolled into view, nearest edge only; a closing click scrolls nothing', () => {
  const { ui, icon, scrolled, click } = load();
  ui.sync();
  click(icon);
  assert.deepEqual(scrolled.map((o) => ({ ...o })), [{ block: 'nearest', inline: 'nearest' }]);
  click(icon);
  assert.equal(scrolled.length, 1, 'closing the menu scrolls nothing');
});

test('one listener however often the page syncs, and none once the page or Glaze is left', () => {
  const { c, ui, icon, scrolled, listeners, click } = load();
  ui.sync(); ui.sync();
  assert.equal(listeners.filter((l) => l.type === 'click').length, 1);
  ui.off();
  assert.equal(listeners.length, 0);
  click(icon);
  assert.equal(scrolled.length, 0);
  c.glazeOn = false;
  ui.sync();
  assert.equal(listeners.length, 0, 'Glaze off: nothing listens');
});

test('the menu feature loads on Ultra pages with an editor, and the worker may load it', () => {
  const need = [];
  const c = { location: { pathname: '' }, GZ_CTX: { site: 'ultra', need: (f) => { need.push(f); return new Promise(() => {}); } }, sessionStorage: { getItem: () => null } };
  c.globalThis = c;
  vm.createContext(c);
  const routes = vm.runInContext(read('features/routes.js'), c);
  const asks = (p) => { need.length = 0; c.location.pathname = p; routes.sync(); return need.includes('features/editor-menu.js'); };
  for (const p of ['/ultra/courses/_101_1/assessment/_7_1/attempt/_8_1', '/ultra/courses/_101_1/assessment/_7_1/attempt/create',
    '/ultra/courses/_101_1/journal/_9_1', '/ultra/courses/_101_1/discussion/_9_1', '/ultra/courses/_101_1/outline/discussion/_9_1']) assert.ok(asks(p), p);
  for (const p of ['/ultra/courses/_101_1/outline', '/ultra/stream', '/ultra/courses/_101_1/assessment/_7_1/overview']) assert.ok(!asks(p), p);
  const list = JSON.parse(read('lib/background.js').match(/const LOADABLE = new Set\((\[[^\]]*\])\)/)[1].replace(/'/g, '"'));
  assert.ok(list.includes('features/editor-menu.js'));
});
