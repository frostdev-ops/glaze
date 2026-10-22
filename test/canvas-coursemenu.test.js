const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const D = require('../defaults.js');
const { El } = require('./stand-in-dom.js');
const read = (f) => fs.readFileSync(require.resolve(`../${f}`), 'utf8');
const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(setImmediate); };

// Run the real decoration hook and popover with controlled Canvas responses and timers.
const page = () => {
  const doc = { cookie: '_csrf_token=page-token' }, requests = [], timers = new Map(), events = [], editors = [];
  let timerId = 0;
  const make = (tag, props = {}, ...kids) => {
    const el = Object.assign(new El(tag, doc), props);
    const attr = el.getAttribute.bind(el);
    el.getAttribute = (k) => k === 'tabindex' ? String(el.tabIndex ?? 0) : k === 'href' ? el.href || attr(k) : attr(k);
    const query = el.querySelector.bind(el);
    el.querySelector = (s) => s === 'a[href*="/courses/"]' ? el.all().find((x) => x.tagName === 'A' && x.href?.includes('/courses/')) || null : query(s);
    el.getClientRects = () => el.disabled || el.hidden ? [] : [{}];
    el.append(...kids); return el;
  };
  doc.root = make('html'); doc.body = make('body'); doc.root.append(doc.body);
  Object.assign(doc, { documentElement: doc.root, createElement: make, querySelectorAll: (s) => doc.root.querySelectorAll(s), querySelector: (s) => doc.root.querySelector(s),
    getElementById: (id) => doc.root.all().find((x) => x.id === id), addEventListener: (type, f) => events.push({ type, f }) });
  doc.fire = (target, type) => { const e = { type, target, isTrusted: true }; target.dispatchEvent(e); if (type === 'click') target.onclick?.(e); };
  const cards = [false, true].map((tile) => {
    const name = make('span', { textContent: 'Biology' });
    const card = make('div', { className: 'ic-DashboardCard' },
      make('div', { className: 'ic-DashboardCard__header-title' }, name),
      make('div', { className: 'ic-DashboardCard__header_hero' }));
    card.querySelector('.ic-DashboardCard__header_hero').style.backgroundColor = '#123456';
    if (tile) card.setAttribute('data-gz-tile-card', '');
    const query = card.querySelector.bind(card);
    card.querySelector = (s) => s === 'a[href*="/courses/"]' ? { getAttribute: () => '/courses/27' }
      : s === ':scope > .gz-cm-btn' ? card.children.find((x) => x.className === 'gz-cm-btn') || null : query(s);
    doc.body.append(card); return card;
  });
  const origin = 'https://school.instructure.com', cid = `canvas:${origin}/27`;
  const rows = [{ id: 27, name: 'Biology' }];
  const all = doc.querySelectorAll;
  doc.querySelectorAll = (s) => s === '.ic-DashboardCard:not([data-gz-tile-card])' ? cards.filter((c) => c.isConnected && !c.hasAttribute('data-gz-tile-card')) : all(s);
  const courses = { [cid]: { name: 'Biology', canvas: true, color: '#123456' } }, settings = D.GZ_SANITIZE({});
  const c = vm.createContext({ ...D, GZ_COLOR: require('../lib/color.js'), GZ_WIDGETS: require('../lib/widgets.js'), GZ_CARD_UI: { paint() {} }, URL, structuredClone,
    document: doc, Element: El, Node: El, location: { origin }, innerWidth: 1200, innerHeight: 900,
    setTimeout: (f) => { timers.set(++timerId, f); return timerId; }, clearTimeout: (id) => timers.delete(id),
    addEventListener() {}, matchMedia: () => ({ matches: false }), requestAnimationFrame: () => 0,
    getComputedStyle: (el) => ({ direction: el.closest('[dir]')?.getAttribute('dir') || doc.root.style.direction || 'ltr' }),
    chrome: { runtime: { id: 'glaze' }, storage: { sync: { set() {} }, onChanged: { addListener() {} } } },
    fetch: (url, init) => new Promise((resolve, reject) => requests.push({ url, init, ok: () => resolve({ ok: true, json: async () => ({}) }), fail: () => reject(Error('unavailable')) })),
    ultra: false, moodle: false, menuOn: () => true, courseList: courses, settings,
    canvasCourseKey: (id) => `canvas:${origin}/${id}`, X: { nickOf: () => '' }, t: (s) => s,
    docButton: () => make('button'), syncCards() {},
    GZ_CTX: { site: 'canvas', on: () => true, need: async () => {}, make, t: (s) => s, nickOf: () => '', cardUI: (f) => f({ open: (...a) => editors.push(a) }), courseColor() {}, courseColors: () => ({}), varText() {},
      settings: () => settings, courseList: () => courses, canvasCourses: async () => rows, setCourses: (v) => { settings.courses = v; } },
  });
  const src = read('content.js');
  vm.runInContext(src.slice(src.indexOf('  const syncCourseMenu = () => {'), src.indexOf("  // Canvas's dashboard cards:")) + '\nsyncCourseMenu();', c);
  const ui = vm.runInContext(read('features/coursemenu.js'), c);
  const open = async (card = cards[0]) => { ui.toggle(card.querySelector(':scope > .gz-cm-btn')); await settle(); };
  const nick = (value) => { const n = doc.getElementById('gz-cm-nick'); n.value = value; doc.fire(n, 'input'); doc.fire(n, 'change'); };
  const flush = async () => { const pending = [...timers.values()]; timers.clear(); for (const f of pending) f(); await settle(); };
  const color = () => cards[0].querySelector('.ic-DashboardCard__header_hero').style.backgroundColor;
  return { doc, cards, requests, ui, open, nick, flush, color, events, editors, loadCards: () => vm.runInContext(read('features/coursecards.js'), c) };
};

test('Canvas native and board cards have distinct menu ids', () => {
  const p = page(), buttons = p.cards.map((card) => card.querySelector(':scope > .gz-cm-btn'));
  assert.equal(new Set(buttons.map((b) => b.id)).size, 2);
});

test('the course menu passes its board opener to the card style dialog', async () => {
  const p = page(); await p.open(p.cards[1]);
  p.doc.fire(p.doc.querySelectorAll('.gz-cm-more').find((b) => b.textContent === 'Card style and bookmarks'), 'click');
  assert.ok(p.editors[0][1] === p.cards[1].querySelector(':scope > .gz-cm-btn'), 'retain the visible opener for focus restoration');
});

test('a saved Canvas nickname survives board metadata refresh without a native card', async () => {
  const p = page(); p.cards[0].remove();
  const cc = p.loadCards(); cc.sync(); await settle();
  const body = p.doc.createElement('div'); p.doc.body.append(body);
  const tile = cc.fill(body, { id: 'course:https://school.instructure.com/27' });
  await p.open(p.cards[1]); p.nick('Renamed'); await settle(); p.requests[0].ok(); await settle();
  cc.sync(); tile.update();
  assert.equal(body.querySelector('.ic-DashboardCard__header-title').textContent, 'Renamed');
});

test('Canvas nickname writes finish in edit order and reopening retains the latest edit', async () => {
  const p = page(); await p.open();
  p.nick('First'); await settle(); p.nick('Second'); await settle();
  assert.equal(p.requests.length, 1, 'only one nickname mutation in flight per course');
  p.requests[0].ok(); await settle();
  assert.equal(JSON.parse(p.requests[1].init.body).nickname, 'Second');
  p.requests[1].ok(); await settle();
  p.ui.close(); await p.open(p.cards[1]);
  assert.equal(p.doc.getElementById('gz-cm-nick').value, 'Second');
  assert.ok(p.cards.every((card) => card.querySelector('.ic-DashboardCard__header-title').textContent === 'Second'));
});

test('an earlier failed Canvas color save cannot undo a later pick in a reopened menu', async () => {
  const p = page(); await p.open();
  const first = p.doc.querySelector('.gz-cm-sw'); docClick(first);
  await p.flush();
  p.ui.close(); await p.open(p.cards[1]);
  const second = p.doc.querySelectorAll('.gz-cm-sw')[1]; docClick(second);
  await p.flush();
  const wanted = second.dataset.hex;
  p.requests[0].fail(); await settle();
  assert.equal(p.color(), wanted, 'stale failure must not repaint either card');
  p.requests[1].ok(); await settle();
  assert.equal(p.color(), wanted);
  function docClick(b) { p.doc.fire(b, 'click'); }
});

for (const via of ['close', 'change']) test(`Canvas color drafts flush on ${via} without waiting for the debounce`, async () => {
  const p = page(); await p.open(p.cards[1]);
  const custom = p.doc.querySelector('.gz-cm-custom');
  for (const hex of ['#abcdef', '#445566']) { custom.value = hex; p.doc.fire(custom, 'input'); }
  assert.equal(p.requests.length, 0);
  if (via === 'close') p.ui.close(); else p.doc.fire(custom, 'change');
  await settle();
  assert.equal(p.requests.length, 1);
  assert.deepEqual(JSON.parse(p.requests[0].init.body), { hexcode: '#445566' });
  p.requests[0].ok(); await settle(); await p.flush();
  assert.equal(p.requests.length, 1, 'the flushed timer cannot save the same draft twice');
});

test('menu sync follows the same card replacement and restores focus to it', async () => {
  const p = page(); await p.open(p.cards[1]);
  const before = p.cards[1].querySelector(':scope > .gz-cm-btn'), again = p.doc.createElement('button');
  again.id = before.id; again.dataset.cid = before.dataset.cid;
  before.remove(); p.cards[1].append(again);
  p.ui.sync(true); p.ui.close();
  assert.equal(again.getAttribute('aria-expanded'), 'false');
  assert.equal(p.doc.activeElement, again);
});

test('the card style dialog opens from the replacement menu button after a redraw', async () => {
  const p = page(); await p.open(p.cards[1]);
  const before = p.cards[1].querySelector(':scope > .gz-cm-btn'), again = p.doc.createElement('button');
  again.id = before.id; again.dataset.cid = before.dataset.cid;
  before.remove(); p.cards[1].append(again);
  p.ui.sync(true);
  p.doc.fire(p.doc.querySelectorAll('.gz-cm-more').find((b) => b.textContent === 'Card style and bookmarks'), 'click');
  assert.equal(p.editors[0][1], again, 'the editor rejects a disconnected opener');
});

test('removing a board menu button closes its menu instead of anchoring to the native card', async () => {
  const p = page(); await p.open(p.cards[1]);
  p.cards[1].querySelector(':scope > .gz-cm-btn').remove();
  p.ui.sync(true);
  assert.equal(p.doc.getElementById('gz-cm'), undefined);
  assert.equal(p.ui.cid(), undefined);
});

// ---- WP-N2 (NAV-6, NAV-10): the popover's keys ----------------------------------------------------------------------------------
const press = (p, target, extra) => {
  const e = { type: 'keydown', key: 'Enter', target, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {}, ...extra };
  for (const l of p.events.filter((x) => x.type === 'keydown')) l.f(e);
  return e;
};

test('the Enter that confirms an IME composition in the nickname field neither saves nor is swallowed', async () => {
  const p = page(); await p.open();
  const n = p.doc.getElementById('gz-cm-nick');
  n.value = 'にほん'; p.doc.fire(n, 'input'); n.focus();
  for (const extra of [{ isComposing: true, keyCode: 229 }, { keyCode: 229 }]) {
    const e = press(p, n, extra); await settle();
    assert.equal(e.defaultPrevented, false, JSON.stringify(extra));
    assert.equal(p.requests.length, 0, 'nothing is sent mid-composition');
  }
  const e = press(p, n, { keyCode: 13 }); await settle();
  assert.equal(e.defaultPrevented, true);
  assert.equal(p.requests.length, 1, 'the Enter after it saves');
});

test('Escape that cancels an IME composition does not close the popover', async () => {
  const p = page(); await p.open();
  const n = p.doc.getElementById('gz-cm-nick');
  const e = press(p, n, { key: 'Escape', isComposing: true, keyCode: 229 });
  assert.equal(e.defaultPrevented, false);
  assert.equal(p.ui.cid(), 'canvas:https://school.instructure.com/27');
  press(p, n, { key: 'Escape', keyCode: 27 });
  assert.equal(p.ui.cid(), undefined);
});

test('the arrow keys of the popover mirror in a right-to-left page: Left goes on, Right goes back', async () => {
  for (const rtl of [false, true]) {
    const p = page(); if (rtl) p.doc.root.setAttribute('dir', 'rtl'); await p.open();
    const group = p.doc.querySelector('[data-roving]'), items = group.querySelectorAll('button, input');
    assert.ok(items.length >= 3);
    const step = (from, key) => { items[from].focus(); press(p, items[from], { key }); return items.findIndex((x) => x === p.doc.activeElement); };
    assert.equal(step(1, 'ArrowRight'), rtl ? 0 : 2, `${rtl ? 'rtl' : 'ltr'}: Right`);
    assert.equal(step(1, 'ArrowLeft'), rtl ? 2 : 0, `${rtl ? 'rtl' : 'ltr'}: Left`);
    assert.equal(step(1, 'Home'), 0);
    assert.equal(step(1, 'End'), items.length - 1);
    assert.equal(step(0, 'ArrowDown'), items.length - 1, 'down is down in both (the stand-in has no rows: one row of all)');
  }
});

test('course-menu arrow direction follows computed CSS direction without a dir attribute', async () => {
  const p = page(); p.doc.root.style.direction = 'rtl'; await p.open();
  const items = p.doc.querySelector('[data-roving]').querySelectorAll('button, input');
  items[1].focus(); press(p, items[1], { key: 'ArrowRight' });
  assert.equal(p.doc.activeElement, items[0]);
});
