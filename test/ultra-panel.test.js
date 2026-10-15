// Glaze's panel on Blackboard Ultra's Courses page (features/widgets.js on Ultra), on a synthetic page built from B0's
// anchors (parity/spikes/B0.md): first in the To Do column, back after Ultra redraws it, folded away and kept so, gone
// on other pages; a school without Ultra's To Do gets it above the courses. And a tile another file declares (MORE) and
// registers, on either site: filled once, stopped when it goes.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const D = require('../defaults.js');
const W = require('../lib/widgets.js');
const { El } = require('./stand-in-dom.js');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise(setImmediate); };

// site: 'ultra' or 'canvas'; todo: whether the Courses page has Ultra's To Do column.
const page = ({ site = 'ultra', todo = true, local = {} } = {}) => {
  const doc = { activeElement: null, root: null };
  const make = (t) => new El(t, doc);
  doc.root = make('html');
  doc.body = make('body');
  doc.root.append(doc.body);
  const el = (tag, cls, ...kids) => { const e = make(tag); e.className = cls; e.append(...kids); return e; };
  const bbTodo = el('bb-todo', 'react-container');
  if (site === 'ultra') {
    doc.body.append(el('section', 'base-courses-container', el('div', 'base-courses-content', el('div', 'courses-panel', el('div', 'base-courses')), ...(todo ? [el('div', 'todo-panel js-todo-panel-skip-link-target', bbTodo)] : []))));
  } else {
    const head = make('div');
    head.id = 'dashboard_header_container';
    doc.body.append(head);
  }
  doc.fire = (target, type, { trusted = true } = {}) => { for (let p = target; p; p = p.parentNode) for (const l of p.listeners.filter((x) => x.type === type)) l.f({ type, target, isTrusted: trusted, preventDefault() {}, stopPropagation() {} }); };
  Object.assign(doc, { createElement: make, createTextNode: (data) => ({ data, textContent: data }), getElementById: (x) => doc.root.all().find((e) => e.id === x) || null,
    querySelector: (s) => doc.root.querySelector(s), querySelectorAll: (s) => doc.root.querySelectorAll(s), addEventListener() {}, removeEventListener() {}, visibilityState: 'visible' });
  const filled = [], stopped = [], wrote = [];
  let ui;
  const c = {
    console, URL, Intl, Date, Map, Set, JSON, Promise, Error, Number, Math, Object, Array, String, setTimeout, clearTimeout,
    document: doc, location: site === 'ultra' ? { origin: 'https://school.blackboard.test', pathname: '/ultra/course' } : { origin: 'https://canvas.test', pathname: '/' },
    innerWidth: 1280, innerHeight: 900, addEventListener() {}, removeEventListener() {},
    GZ_SANITIZE: D.GZ_SANITIZE, GZ_I18N: { locale: () => 'en' }, GZ_WIDGETS: W,
    GZ_CTX: {
      site, t: (k) => k, locale: () => 'en', settings: () => D.GZ_SANITIZE({ enhance: { notes: true, widgets: true } }),
      profile: async () => ({ id: site === 'ultra' ? '_5_1' : '5' }),
      // The declared tile's file, when asked for, registers it.
      need: async (f) => { if (f === 'features/pet.js') ui.register('pet', (body, api) => { filled.push([body, api.site]); body.append(make('p')); return { stop: () => stopped.push(body) }; }); },
    },
    chrome: {
      runtime: { lastError: undefined, getManifest: () => ({ version: '2.3.0' }), sendMessage: (m, cb) => cb?.({ ok: true }) },
      storage: {
        local: { get: (keys, cb) => cb(Object.fromEntries([keys].flat().filter((k) => k in local).map((k) => [k, structuredClone(local[k])]))), set: (v) => { wrote.push(v); Object.assign(local, v); } },
        sync: { get: (k, cb) => cb({}) },
        onChanged: { addListener() {}, removeListener() {} },
      },
    },
  };
  c.globalThis = c;
  c.window = c;
  vm.createContext(c);
  const src = read('features/widgets.js').replace('const MORE = {};', "const MORE = { pet: { file: 'features/pet.js', name: 'Study buddy', size: 'm' } };");
  assert.notEqual(src, read('features/widgets.js'));
  ui = vm.runInContext(src, c);
  return { ui, doc, c, filled, stopped, wrote, local, bbTodo, panel: () => doc.getElementById('gz-panel') };
};
// Only the declared tile is on: the built-in ones have tests of their own.
const ONLY_PET = { widgetLayout: { tiles: [...W.TILES.map((id) => ({ id, on: false })), { id: 'pet', on: true }] } };

test("Ultra: the panel goes first in the Courses page's To Do column, and comes back when Ultra redraws it", async () => {
  const p = page({ local: structuredClone(ONLY_PET) });
  p.ui.sync(true);
  await settle();
  const col = p.doc.querySelector('div.todo-panel');
  assert.equal(col.firstElementChild, p.panel(), 'first in the column');
  assert.equal(p.panel().nextElementSibling, p.bbTodo, "Ultra's own To Do right after it, untouched");
  assert.ok(p.panel().querySelector('#gz-dash .gz-dash-grid section[data-tile="pet"]'), 'the declared tile, in the grid');
  assert.equal(p.filled.length, 1);
  assert.equal(p.filled[0][1], 'ultra');
  // Ultra redraws the column: the next pass puts the panel back, the same one, with the same tile (not filled again).
  p.panel().remove();
  p.ui.sync(true);
  assert.equal(col.firstElementChild, p.panel());
  assert.equal(p.filled.length, 1, 'filled once');
  p.ui.sync(true);
  assert.equal(col.querySelectorAll('#gz-panel').length, 1, 'once, however often the pass runs');
});

test('Ultra: the panel folds away from its heading, by keyboard or pointer, and stays folded on this device', async () => {
  const p = page({ local: structuredClone(ONLY_PET) });
  p.ui.sync(true);
  await settle();
  const toggle = p.panel().querySelector('.gz-panel-toggle');
  assert.equal(toggle.tagName, 'BUTTON', 'a real button: Tab reaches it, Enter and Space press it');
  assert.equal(toggle.getAttribute('aria-expanded'), 'true');
  assert.equal(toggle.getAttribute('aria-controls'), 'gz-panel-body');
  assert.equal(toggle.textContent, 'Notes and widgets', 'its name');
  p.doc.fire(toggle, 'click');
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
  assert.equal(p.doc.getElementById('gz-panel-body').hidden, true);
  assert.equal(JSON.stringify(p.wrote.at(-1)), '{"panelShut":true}', 'storage.local, never the page');
  // A new page load: still folded.
  const q = page({ local: { ...structuredClone(ONLY_PET), panelShut: true } });
  q.ui.sync(true);
  await settle();
  assert.equal(q.panel().querySelector('.gz-panel-toggle').getAttribute('aria-expanded'), 'false');
  assert.equal(q.doc.getElementById('gz-panel-body').hidden, true);
});

test('Ultra: leaving the Courses page takes the panel and its tiles away (stopped); switching off leaves nothing', async () => {
  const p = page({ local: structuredClone(ONLY_PET) });
  p.ui.sync(true);
  await settle();
  p.c.location.pathname = '/ultra/stream';
  p.ui.sync(true);
  assert.equal(p.panel(), null);
  assert.equal(p.stopped.length, 1, 'the tile was stopped');
  p.c.location.pathname = '/ultra/course';
  p.ui.sync(true);
  assert.ok(p.panel(), 'back on the Courses page');
  p.ui.sync(false);
  assert.equal(p.panel(), null);
  assert.equal(p.doc.querySelectorAll('.gz-w').length, 0);
  assert.equal(p.stopped.length, 2);
});

test('Ultra: a school without the To Do column gets the panel above the courses', async () => {
  const p = page({ todo: false, local: structuredClone(ONLY_PET) });
  p.ui.sync(true);
  await settle();
  assert.equal(p.doc.querySelector('div.courses-panel').firstElementChild, p.panel());
});

test('Canvas: a declared tile registers and shows in the Dashboard grid the same way, and is off until added', async () => {
  const p = page({ site: 'canvas', local: structuredClone(ONLY_PET) });
  p.ui.sync(true);
  await settle();
  const grid = p.doc.getElementById('dashboard_header_container').nextElementSibling;
  assert.equal(grid.id, 'gz-dash');
  assert.ok(grid.querySelector('section[data-tile="pet"]'));
  assert.deepEqual(p.filled.map((f) => f[1]), ['canvas']);
  assert.equal(p.panel(), null, 'no Ultra panel on Canvas');
  const q = page({ site: 'canvas', local: { widgetLayout: { tiles: W.TILES.map((id) => ({ id, on: false })) } } });
  q.ui.sync(true);
  await settle();
  assert.equal(q.filled.length, 0, 'not added: its file is never asked for');
});
