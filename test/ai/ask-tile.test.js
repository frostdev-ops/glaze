// Ask Rime as a widget (ai/page/ask-tile.js, core/page/widgets.js MORE 'ask'): on a synthetic Ultra Courses page and Canvas
// Dashboard, as test/core/ultra-panel.test.js builds them, with the chat component (ai/page/ask-chat.js) stood in. The tile
// is offered and drawn only while AI and Ask Rime are on, mounts one chat in its body, goes when either turns off, and
// ⌘K's row finds it (reveal) where it is shown, else opens the dialog.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const D = require('../../extension/content/defaults.js');
const W = require('../../extension/core/widgets.js');
const { El } = require('../stand-in-dom.js');

const read = (f) => fs.readFileSync(path.join(__dirname, '../../extension', f), 'utf8');
const settle = async () => { for (let i = 0; i < 20; i++) await new Promise(setImmediate); };
const AI = (on = true, ask = true) => ({ on, model: { use: 'openai', model: 'm' }, features: { ask } });
const ONLY_ASK = (ai = AI()) => ({ ai, widgetLayout: { todo: true, canvasTodo: true, tiles: [...W.TILES.map((id) => ({ id, on: false })), { id: 'ask', on: true, size: 'l' }] } });

const page = ({ site = 'ultra', local = ONLY_ASK() } = {}) => {
  const doc = { activeElement: null, root: null };
  const make = (t) => new El(t, doc);
  doc.root = make('html');
  doc.body = make('body');
  doc.root.append(doc.body);
  const el = (tag, cls, ...kids) => { const e = make(tag); e.className = cls; e.append(...kids); return e; };
  if (site === 'ultra') doc.body.append(el('section', 'base-courses-container', el('div', 'base-courses-content', el('div', 'courses-panel', el('div', 'base-courses')), el('div', 'todo-panel', el('bb-todo', 'react-container')))));
  else { const head = make('div'); head.id = 'dashboard_header_container'; doc.body.append(head); }
  const docOn = {}, loads = [], mounts = [], changed = [];
  Object.assign(doc, { createElement: make, createTextNode: (data) => ({ data, textContent: data }), getElementById: (x) => doc.root.all().find((e) => e.id === x) || null,
    querySelector: (s) => doc.root.querySelector(s), querySelectorAll: (s) => doc.root.querySelectorAll(s), addEventListener: (type, f) => (docOn[type] ||= []).push(f), removeEventListener() {}, visibilityState: 'visible' });
  const settings = D.GZ_SANITIZE({ enhance: { notes: true, widgets: true } });
  let ui;
  // The chat component as the tile uses it: mount(host, { variant }) → { focus, stop }.
  const CHAT = { mount: (host, o) => { const m = { host, o, focused: 0, stopped: 0 }; mounts.push(m); host.append(make('div')); return { focus: () => { m.focused++; }, stop: () => { m.stopped++; } }; } };
  const c = {
    console, URL, Intl, Date, Map, Set, JSON, Promise, Error, Number, Math, Object, Array, String, setTimeout, clearTimeout,
    document: doc, location: site === 'ultra' ? { origin: 'https://school.blackboard.test', pathname: '/ultra/course' } : { origin: 'https://canvas.test', pathname: '/' },
    innerWidth: 1280, innerHeight: 900, addEventListener() {}, removeEventListener() {},
    ResizeObserver: class { observe() {} unobserve() {} disconnect() {} }, requestAnimationFrame: () => 0, cancelAnimationFrame() {},
    GZ_SANITIZE: D.GZ_SANITIZE, GZ_I18N: { locale: () => 'en' }, GZ_WIDGETS: W,
    GZ_CTX: {
      site, t: (k) => k, locale: () => 'en', settings: () => settings,
      profile: async () => ({ id: site === 'ultra' ? '_5_1' : '5' }),
      need: async (f, ready) => {
        loads.push(f);
        if (f === 'ai/page/ask-chat.js') { c.GZ_ASK_CHAT = CHAT; return; }
        if (f === 'ai/page/ask-tile.js') { vm.runInContext(read('ai/page/ask-tile.js'), c); for (let i = 0; i < 50 && !ready?.(); i++) await new Promise(setImmediate); }
      },
    },
    chrome: {
      runtime: { id: 'glaze', lastError: undefined, getManifest: () => ({ version: '2.3.0' }), sendMessage: (m, cb) => cb?.({ ok: true }) },
      storage: {
        local: { get: (keys, cb) => cb(Object.fromEntries([keys].flat().filter((k) => k in local).map((k) => [k, structuredClone(local[k])]))), set: (v) => { Object.assign(local, v); } },
        sync: { get: (k, cb) => cb({}) },
        onChanged: { addListener: (f) => changed.push(f), removeListener() {} },
      },
    },
  };
  c.globalThis = c;
  c.window = c;
  vm.createContext(c);
  ui = vm.runInContext(read('core/page/widgets.js'), c);
  const tile = () => doc.querySelector('section[data-tile="ask"]');
  const setAi = (ai) => { local.ai = ai; for (const f of changed) f({ ai: { newValue: structuredClone(ai) } }, 'local'); };
  return { ui, doc, c, local, loads, mounts, tile, setAi };
};

for (const site of ['ultra', 'canvas']) {
  test(`${site}: with AI and Ask Rime on, the tile is drawn on the board with one chat mounted in its body, loaded on demand`, async () => {
    const p = page({ site });
    p.ui.sync(true);
    await settle();
    assert.ok(p.tile(), 'the Ask Rime tile');
    assert.ok(p.loads.includes('ai/page/ask-tile.js'));
    assert.equal(p.mounts.length, 1);
    assert.equal(p.mounts[0].o.variant, 'tile');
    assert.ok(p.tile().querySelector('.gz-w-body').children.includes(p.mounts[0].host.children[0]) || p.mounts[0].host === p.tile().querySelector('.gz-w-body'), 'mounted in the tile\'s body');
    assert.equal(p.tile().getAttribute('aria-label'), 'Ask Rime');
    p.ui.sync(true);
    assert.equal(p.mounts.length, 1, 'mounted once, however often the pass runs');
  });

  test(`${site}: with AI or Ask Rime off the tile is neither drawn nor loaded; turned on it comes, turned off it goes and its chat stops`, async () => {
    for (const ai of [AI(false, true), AI(true, false), null]) {
      const p = page({ site, local: ONLY_ASK(ai) });
      p.ui.sync(true);
      await settle();
      assert.equal(p.tile(), null, String(JSON.stringify(ai)));
      assert.ok(!p.loads.includes('ai/page/ask-tile.js'), 'never loaded');
    }
    const p = page({ site, local: ONLY_ASK(AI(true, false)) });
    p.ui.sync(true);
    await settle();
    p.setAi(AI());
    await settle();
    assert.ok(p.tile(), 'Ask turned on: the tile comes');
    p.setAi(AI(true, false));
    await settle();
    assert.equal(p.tile(), null, 'Ask turned off: the tile goes');
    assert.equal(p.mounts[0].stopped, 1, 'its chat stopped, once');
  });
}

test('Edit layout offers Ask Rime to add only while AI and Ask Rime are on', async () => {
  const offered = async (ai) => {
    const p = page({ site: 'canvas', local: { ai, widgetLayout: { todo: true, canvasTodo: true, tiles: [...W.TILES.map((id) => ({ id, on: false })), { id: 'ask', on: false }] } } });
    p.ui.sync(true);
    await settle();
    p.doc.fire = (target, type) => { for (const l of target.listeners.filter((x) => x.type === type)) l.f({ type, target, isTrusted: true, preventDefault() {}, stopPropagation() {} }); };
    const edit = p.doc.querySelector('#gz-dash .gz-dash-bar').children.find((b) => b.textContent === 'Edit layout');
    p.doc.fire(edit, 'click');
    await settle();
    return p.doc.querySelector('#gz-dash .gz-dash-add').children.map((b) => b.textContent);
  };
  assert.ok((await offered(AI())).includes('+ Ask Rime'));
  assert.ok(!(await offered(AI(true, false))).includes('+ Ask Rime'));
  assert.ok(!(await offered(AI(false, true))).includes('+ Ask Rime'));
});

test('reveal(\'ask\') brings a shown tile to the student and focuses its chat; folded, hidden or absent, it says no', async () => {
  const p = page({ site: 'canvas' });
  assert.equal(p.ui.reveal('ask'), false, 'nothing drawn yet');
  p.ui.sync(true);
  await settle();
  assert.equal(p.ui.reveal('ask'), true);
  assert.equal(p.mounts[0].focused, 1);
  p.tile().setAttribute('data-fold', '');
  assert.equal(p.ui.reveal('ask'), false, 'folded: the dialog opens instead');
  p.tile().removeAttribute('data-fold');
  p.doc.visibilityState = 'hidden';
  assert.equal(p.ui.reveal('ask'), false, 'the page hidden');
  p.doc.visibilityState = 'visible';
  assert.equal(p.ui.reveal('pet'), false, 'another tile, not drawn');
});

test('⌘K\'s Ask Rime row reveals the tile first and opens the dialog only where it isn\'t; both files load on demand', () => {
  const src = read('navigation/page/palette.js');
  assert.match(src, /run: \(e\) => e\?\.isTrusted && \(globalThis\.GZ_WIDGETS_UI\?\.reveal\?\.\('ask'\) \|\| need\('ai\/page\/ask\.js'/);
  const loadable = read('background/background.js').match(/const LOADABLE = new Set\((\[[^\]]*\])\)/)[1];
  for (const f of ['ai/page/ask-chat.js', 'ai/page/ask-tile.js']) assert.ok(loadable.includes(`'${f}'`), f);
  const first = JSON.parse(read('manifest.json')).content_scripts.flatMap((s) => s.js);
  assert.ok(!first.some((f) => f.startsWith('ai/')), 'nothing of Ask Rime in a first content script');
});

test('the tile\'s sheet is its own block, sized by the tile, with every animation gated on motion', () => {
  const css = read('core/page/apps.css');
  const start = css.indexOf('/* Ask Rime as a widget'), end = css.indexOf('/* end Ask Rime as a widget */');
  assert.ok(start > 0 && end > start, 'its own block');
  const sheet = css.slice(start, end).replace(/\/\*[\s\S]*?\*\//g, '');
  for (const size of ['s', 'm', 'l']) assert.match(sheet, new RegExp(`\\.gz-w\\[data-tile="ask"\\]\\[data-size="${size}"\\]`), size);
  assert.doesNotMatch(sheet.replace(/@media \(prefers-reduced-motion: no-preference\) \{[\s\S]*$/, ''), /animation(?!:\s*none)|transition(?!:\s*none)/, 'motion only in its gated block');
});
