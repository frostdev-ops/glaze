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
const page = ({ site = 'ultra', todo = true, local = {}, failLoad = false } = {}) => {
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
    querySelector: (s) => doc.root.querySelector(s), querySelectorAll: (s) => doc.root.querySelectorAll(s), addEventListener: (type, f) => (docOn[type] ||= []).push(f), removeEventListener() {}, visibilityState: 'visible' });
  const filled = [], stopped = [], wrote = [], woke = [], docOn = {}, loads = [];
  const settings = D.GZ_SANITIZE({ enhance: { notes: true, widgets: true, pet: true } });
  const clock = { at: Date.now() };
  const FakeDate = class extends Date {}; FakeDate.now = () => clock.at;
  let ui;
  const c = {
    console, URL, Intl, Date: FakeDate, Map, Set, JSON, Promise, Error, Number, Math, Object, Array, String, setTimeout, clearTimeout,
    document: doc, location: site === 'ultra' ? { origin: 'https://school.blackboard.test', pathname: '/ultra/course' } : { origin: 'https://canvas.test', pathname: '/' },
    innerWidth: 1280, innerHeight: 900, addEventListener() {}, removeEventListener() {},
    ResizeObserver: class { observe() {} unobserve() {} disconnect() {} }, requestAnimationFrame: () => 0, cancelAnimationFrame() {},
    GZ_SANITIZE: D.GZ_SANITIZE, GZ_I18N: { locale: () => 'en' }, GZ_WIDGETS: W,
    GZ_CTX: {
      site, t: (k) => k, locale: () => 'en', settings: () => settings,
      profile: async () => ({ id: site === 'ultra' ? '_5_1' : '5' }),
      // The declared tile's file, when asked for, registers it.
      need: async (f) => { if (f === 'features/pet.js') { loads.push(f); if (failLoad) throw new Error('load failed'); ui.register('pet', (body, api) => { filled.push([body, api.site]); body.append(make('p')); return { stop: () => stopped.push(body), wake: () => woke.push(doc.visibilityState) }; }); } },
    },
    chrome: {
      runtime: { id: 'glaze', lastError: undefined, getManifest: () => ({ version: '2.3.0' }), sendMessage: (m, cb) => cb?.({ ok: true }) },
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
  const src = read('features/widgets.js');
  ui = vm.runInContext(src, c);
  // The page hidden or shown again, as the browser reports it.
  const visible = (v) => { doc.visibilityState = v ? 'visible' : 'hidden'; for (const f of docOn.visibilitychange || []) f(); };
  return { ui, doc, c, settings, loads, clock, filled, stopped, wrote, woke, visible, local, bbTodo, panel: () => doc.getElementById('gz-panel') };
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
  await settle();
  assert.ok(p.panel(), 'back on the Courses page');
  // Codex B5 review: the panel came back empty (its grid had been taken out of it).
  assert.ok(p.panel().querySelector('#gz-dash .gz-dash-bar button'), "the grid and its controls are back in the panel");
  assert.ok(p.panel().querySelector('#gz-dash .gz-dash-grid section[data-tile="pet"]'), 'and the tile');
  assert.equal(p.filled.length, 2, 'filled again for this visit');
  p.ui.sync(true);
  assert.equal(p.panel().querySelectorAll('#gz-dash').length, 1, 'one grid');
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

// Codex B5 review: Reminders comes in its own file, often after the panel has settled.
test('Ultra: the panel offers Reminders once its file is in, on the next pass, and drops it when it has none', async () => {
  const p = page({ local: structuredClone(ONLY_PET) });
  p.ui.sync(true);
  await settle();
  const button = () => p.panel().querySelector('.gz-dash-remind');
  assert.equal(button().hidden, true, 'no reminders yet');
  let cmds = [{ run() {} }];
  p.c.GZ_REMIND_UI = { cmds: () => cmds };
  p.ui.sync(true);
  assert.equal(button().hidden, false, 'shown on the next pass');
  cmds = [];
  p.ui.sync(true);
  assert.equal(button().hidden, true, 'hidden again when reminders are off');
});

// Codex B5 review: a registered tile's wake() is "the page is shown again", never on hiding.
test('a registered tile wakes only when the page is shown again', async () => {
  const p = page({ local: structuredClone(ONLY_PET) });
  p.ui.sync(true);
  await settle();
  p.visible(false);
  assert.deepEqual(p.woke, [], 'not when hidden');
  p.visible(true);
  assert.deepEqual(p.woke, ['visible']);
});


test('W24: disabling only Pet habitat stops the registered tile exactly once on Canvas and Ultra', async () => {
  for (const site of ['canvas', 'ultra']) {
    const p = page({ site, local: structuredClone(ONLY_PET) });
    p.ui.sync(true); await settle();
    assert.equal(p.filled.length, 1);
    p.settings.enhance.pet = false;
    p.ui.sync(true); await settle();
    assert.equal(p.stopped.length, 1);
    assert.equal(p.doc.querySelectorAll('.gz-w').length, 0);
    p.ui.sync(false); assert.equal(p.stopped.length, 1);
  }
});
test('W24: a failed declared-widget load is quiet until its bounded retry', async () => {
  const p = page({ site: 'canvas', local: structuredClone(ONLY_PET), failLoad: true });
  p.ui.sync(true); await settle();
  for (let i = 0; i < 12; i++) { p.ui.sync(true); await settle(); }
  assert.equal(p.loads.length, 1);
  assert.equal(p.doc.querySelectorAll('.gz-w').length, 0);
  p.clock.at += 60001; p.ui.sync(true); await settle();
  assert.equal(p.loads.length, 2);
  p.ui.sync(false);
});


test('Ultra hub offers Streak beside Pet habitat', async () => {
  const p = page(); p.c.navigator = { userAgent: 'Synthetic fixture' };
  await p.ui.hub();
  const hub = p.doc.getElementById('gz-hub');
  const group = hub.querySelectorAll('fieldset').find((g) => g.querySelector('legend')?.textContent === 'Reminders and streak');
  assert.ok(group.querySelector('input[data-key="streak"]'));
  assert.ok(group.querySelector('input[data-key="pet"]'));
  hub.close();
});


test('the feature hub refuses an invalid context before the core observes any mutation', async () => {
  const p = page({ local: { widgetLayout: { tiles: W.TILES.map((id) => ({ id, on: false })) } } }); p.c.navigator = { userAgent: 'Synthetic fixture' };
  p.ui.sync(true); await settle();
  let calls = 0;
  delete p.c.chrome.runtime.id;
  p.c.chrome.runtime.getManifest = () => { calls++; throw Error('Extension context invalidated'); };
  const before = p.doc.root.all().length;
  const hub = p.doc.querySelector('.gz-dash-bar').children.find((x) => x.textContent === 'What Glaze can do');
  assert.doesNotThrow(() => p.doc.fire(hub, 'click'));
  p.c.GZ_CTX.need = () => { calls++; throw Error('Extension context invalidated'); };
  await assert.doesNotReject(p.ui.hub());
  assert.equal(calls, 0, 'guard precedes getManifest');
  assert.equal(p.doc.root.all().length, before, 'no DOM mutation needed to notice invalidation');
  assert.equal(p.doc.getElementById('gz-hub'), null);
  p.ui.sync(false);
});
