// WP-N1: with Glaze's bar on, every control Moodle's own navbar offers stays reachable. The real adapter and the real
// renderer run on the captured dashboard (test/fixtures/moodle-dashboard.html, a student's page) in the stand-in DOM,
// so what is asserted is what the bar draws and what a click on it does, not a copy of the code's logic.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { El } = require('./stand-in-dom.js');
const { parse } = require('./fixture-dom.js');
const G = require('../defaults.js'), M = require('../lib/navbar.js');
const L = require('../lib/navlayout.js'), N = require('../lib/nav-items.js');

const read = (file) => fs.readFileSync(require.resolve(`../${file}`), 'utf8');
const plain = (v) => JSON.parse(JSON.stringify(v));
const origin = 'http://localhost:8081';
const dashboard = read('test/fixtures/moodle-dashboard.html');

// ---- a selector engine for what the adapter and the renderer ask: lists, descendant and child, tag, #id, .class,
// [attr], [attr=v], [attr*=v], [attr^=v], :not() and :is() ----------------------------------------------------------------
const top = (s, at) => { // split s where at(char) holds outside brackets, parentheses and quotes
  const out = []; let depth = 0, quote = '', cur = '';
  for (const ch of s) {
    if (quote) { cur += ch; if (ch === quote) quote = ''; continue; }
    if (ch === '"' || ch === "'") { quote = ch; cur += ch; continue; }
    if ('(['.includes(ch)) depth++; else if (')]'.includes(ch)) depth--;
    if (!depth && at(ch)) { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur); return out;
};
const chain = (sel) => { // 'a > b c' -> [{ c: 'a' }, { c: 'b', comb: '>' }, { c: 'c', comb: ' ' }]
  const parts = []; let comb = '', cur = '', depth = 0, quote = '';
  const end = () => { if (cur) parts.push({ c: cur, comb: parts.length ? comb || ' ' : '' }); cur = ''; comb = ''; };
  for (const ch of sel.trim()) {
    if (quote) { cur += ch; if (ch === quote) quote = ''; continue; }
    if (ch === '"' || ch === "'") { quote = ch; cur += ch; continue; }
    if ('(['.includes(ch)) depth++; else if (')]'.includes(ch)) depth--;
    if (!depth && (ch === '>' || /\s/.test(ch))) { end(); if (ch === '>') comb = '>'; } else cur += ch;
  }
  end(); return parts;
};
const compound = (el, c) => {
  const tag = /^(\*|[a-zA-Z][\w-]*)/.exec(c);
  if (tag && tag[1] !== '*' && el.tagName.toLowerCase() !== tag[1].toLowerCase()) return false;
  for (let i = tag ? tag[0].length : 0, m; i < c.length; i += m[0].length) {
    const r = c.slice(i);
    if ((m = /^#([\w-]+)/.exec(r))) { if (el.id !== m[1]) return false; }
    else if ((m = /^\.([\w-]+)/.exec(r))) { if (!String(el.className).split(/\s+/).includes(m[1])) return false; }
    else if ((m = /^\[([\w:-]+)(?:([*^$~]?=)(?:"([^"]*)"|'([^']*)'|([^\]]*)))?\]/.exec(r))) {
      const have = el.getAttribute(m[1]), want = m[3] ?? m[4] ?? m[5];
      if (have == null) return false;
      if (m[2] === '=' && have !== want || m[2] === '*=' && !have.includes(want) || m[2] === '^=' && !have.startsWith(want) || m[2] === '$=' && !have.endsWith(want)) return false;
    } else if ((m = /^:(not|is)\(/.exec(r))) {
      let depth = 1, j = m[0].length;
      for (; j < r.length && depth; j++) depth += r[j] === '(' ? 1 : r[j] === ')' ? -1 : 0;
      const inner = r.slice(m[0].length, j - 1), hit = top(inner, (ch) => ch === ',').some((s) => complex(el, s));
      if (m[1] === 'not' ? hit : !hit) return false;
      m = [r.slice(0, j)];
    } else throw new Error(`the test's selector engine does not know ${c}`);
  }
  return true;
};
const complex = (el, sel) => {
  const parts = chain(sel);
  const test = (e, i) => {
    if (!e?.tagName || !compound(e, parts[i].c)) return false;
    if (!i) return true;
    if (parts[i].comb === '>') return test(e.parentNode, i - 1);
    for (let p = e.parentNode; p?.tagName; p = p.parentNode) if (test(p, i - 1)) return true;
    return false;
  };
  return test(el, parts.length - 1);
};
const entities = (s) => s.replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

// The stand-in element with what the page code uses of a browser's: a parsed attribute reads as a browser would read it
// (entities decoded, an href resolved), a checkbox toggles and says so, a shadow root reaches its host.
class NavEl extends El {
  get localName() { return this.tagName.toLowerCase(); }
  get ownerDocument() { return this.doc; }
  get tabIndex() { return Number(this.getAttribute('tabindex') || 0); }
  set tabIndex(v) { this.setAttribute('tabindex', String(v)); }
  get childNodes() { return this.children; }
  get childElementCount() { return this.children.filter((e) => e instanceof El).length; }
  get classList() { return Object.assign(this.className.split(/\s+/).filter(Boolean), { contains: (c) => this.className.split(/\s+/).includes(c) }); }
  get dir() { return this.getAttribute('dir') || ''; }
  set dir(v) { this.setAttribute('dir', v); }
  get href() { const h = this.getAttribute('href'); return h == null ? '' : new URL(h, this.doc.location.href).href; }
  set href(v) { this.setAttribute('href', v); }
  get action() { const h = this.getAttribute('action'); return h == null ? '' : new URL(h, this.doc.location.href).href; }
  get checked() { return this._checked ?? this.hasAttribute('checked'); }
  set checked(v) { this._checked = !!v; }
  get offsetLeft() { return this.box?.left || 0; }
  get offsetTop() { return this.box?.top || 0; }
  get scrollWidth() { return this.clientWidth; }
  get isConnected() { let p = this; while (p.parentNode || p.host) p = p.parentNode || p.host; return p === this.doc.root; }
  getAttribute(k) { const v = super.getAttribute(k); return typeof v === 'string' ? entities(v) : v; }
  matches(selector) { return top(selector, (ch) => ch === ',').some((s) => complex(this, s)); }
  querySelectorAll(selector) { return this.all().filter((e) => e.matches(selector)); }
  closest(selector) { for (let p = this; p?.tagName; p = p.parentNode) if (p.matches(selector)) return p; return null; }
  get previousElementSibling() { const s = this.parentNode?.children.filter((x) => x instanceof El) || []; return s[s.indexOf(this) - 1] || null; }
  getClientRects() { return this.isConnected && !this.hidden ? [this.getBoundingClientRect()] : []; }
  attachShadow() {
    const r = new NavEl('shadow-root', this.doc); r.host = this;
    Object.defineProperty(r, 'activeElement', { get: () => this.doc.focused?.isConnected && r.contains(this.doc.focused) ? this.doc.focused : null });
    this.shadowRoot = r; return r;
  }
  focus() { this.doc.focused = this; }
  click() {
    this.clicks = (this.clicks || 0) + 1;
    if (this.tagName === 'INPUT' && this.getAttribute('type') === 'checkbox') { this.checked = !this.checked; this.doc.heard('change', this); }
  }
  requestSubmit() { this.submitted = (this.submitted || 0) + 1; }
}
const upgrade = (e) => { Object.setPrototypeOf(e, NavEl.prototype); for (const c of e.children) if (c instanceof El) upgrade(c); };

// ---- the page and the bar -----------------------------------------------------------------------------------------------
async function setup({ html = dashboard, path = '/my/', width = 1440, navbar = {}, prefs = {} } = {}) {
  const listeners = [], animation = new Map(), assigned = [], writes = [], events = {};
  const document = { location: new URL(origin + path), focused: null, visibilityState: 'visible', title: 'Dashboard',
    addEventListener: (type, f) => listeners.push({ type, f }), removeEventListener: (type, f) => { const at = listeners.findIndex((l) => l.type === type && l.f === f); if (at >= 0) listeners.splice(at, 1); },
    heard: (type, target) => { for (const l of [...listeners].filter((x) => x.type === type)) l.f({ type, target }); } };
  document.root = document.documentElement = new NavEl('html', document);
  document.body = parse(html, document); upgrade(document.root);
  document.createElement = (tag) => new NavEl(tag, document);
  document.createElementNS = (_, tag) => new NavEl(tag, document);
  document.querySelector = (s) => document.root.querySelector(s);
  document.querySelectorAll = (s) => document.root.querySelectorAll(s);
  document.getElementById = (id) => document.root.querySelector(`#${id}`);
  Object.defineProperty(document, 'activeElement', { get: () => document.focused?.isConnected ? document.focused : document.body });
  document.location.assign = (href) => assigned.push(href);
  const settings = G.GZ_SANITIZE({ navbar: { ...navbar }, enhance: { tabs: false } });
  let tick = 0, adapter;
  const window = {}; window.top = window;
  const context = vm.createContext({ document, location: document.location, window, URL, URLSearchParams, AbortSignal, Response,
    GZ_NAVBAR: M, GZ_NAV_LAYOUT: L, GZ_NAV_ITEMS: N, innerWidth: width, innerHeight: 900,
    MutationObserver: class { observe() {} disconnect() {} }, CSS: { escape: (s) => s }, getComputedStyle: () => ({ backgroundImage: '' }),
    matchMedia: (q) => ({ matches: q === '(min-width: 900px)' ? context.innerWidth >= 900 : true }),
    requestAnimationFrame: (fn) => { animation.set(++tick, fn); return tick; }, cancelAnimationFrame: (id) => animation.delete(id),
    setTimeout: () => ++tick, clearTimeout() {}, addEventListener: (name, fn) => { events[name] = fn; },
    fetch: async () => new Response(JSON.stringify([{ data: { notifications: [], conversations: [] } }])),
    chrome: { runtime: { id: 'glaze', getURL: (s) => `chrome-extension://glaze/${s}` },
      storage: { sync: { get: (_, cb) => cb({ navbarItems: prefs }) }, local: { get: (_, cb) => cb({}), set: (v) => writes.push(v) }, onChanged: { addListener() {} } } },
    GZ_CTX: { site: 'moodle', t: (s) => s, settings: () => settings, on: () => true, parts: () => ({}), locale: () => 'en',
      setVar: (key, value) => document.documentElement.style.setProperty(key, value), need: () => Promise.reject(new Error('lazy')) } });
  const factory = vm.runInContext(read('features/navbar-moodle.js') + '\nGZ_NAVBAR_MOODLE;', context);
  context.GZ_NAVBAR_MOODLE = Object.assign((x) => (adapter = factory(x)), { data: factory.data });
  const ui = vm.runInContext(read('features/navbar.js') + '\nGZ_NAVBAR_UI;', context);
  ui.sync(); await Promise.resolve();
  const host = document.getElementById('gz-navbar'), root = host.shadowRoot;
  root.querySelector('link').dispatchEvent({ type: 'load' });
  const frame = () => { for (const [id, fn] of [...animation]) { animation.delete(id); fn(); } };
  const click = (target, extra = {}) => {
    const path = []; for (let e = target; e; e = e.parentNode) path.push(e);
    const event = { type: 'click', button: 0, isTrusted: true, ...extra, composedPath: () => path, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {} };
    root.dispatchEvent(event); return event;
  };
  return { ui, adapter, document, root, host, settings, context, click, frame, assigned, writes, events,
    rail: (selector) => root.querySelector(`.rail ${selector}`), sheet: (selector) => root.querySelector(`.sheet ${selector}`) };
}

const nav = (doc) => doc.querySelector('nav.navbar');
const edit = (doc) => doc.querySelector('.editmode-switch-form input[type="checkbox"]');
// Where a link goes, as a page address, and whether it goes anywhere (Moodle's own menus use href="#" for their toggles).
const goes = (a) => { const h = a.getAttribute('href'); return h && !h.startsWith('#') ? new URL(h, origin).href : ''; };

// ---- acceptance: the captured pages' navbars --------------------------------------------------------------------------------
// Where a page's links lead from the bar: its items, and the rows of the panels it opens.
const reached = async (h) => {
  const reach = new Set(plain(h.adapter.read()).map((i) => i.href).filter(Boolean));
  for (const id of ['profile', 'notifications', 'messages']) {
    const panel = await h.adapter.panel(id).catch(() => null);
    for (const row of panel ? [...panel.sections.flatMap((s) => s.rows), ...(panel.foot || [])] : []) reach.add(row.href);
  }
  return reach;
};

test('every link in the navbar of every captured Moodle page is reachable with the bar on', async () => {
  const dir = require('node:path').join(__dirname, 'fixtures');
  let pages = 0;
  for (const f of fs.readdirSync(dir).filter((x) => /^moodle-.*\.html$/.test(x))) {
    const h = await setup({ html: read(`test/fixtures/${f}`), path: '/' + f });
    if (!nav(h.document)) continue; // the sign-in page has none
    pages++;
    const reach = await reached(h);
    const links = nav(h.document).querySelectorAll('a[href]').map(goes).filter(Boolean);
    assert.ok(links.length >= 8, `${f}: the navbar has its links`);
    assert.deepEqual([...new Set(links)].filter((href) => !reach.has(href)), [], `${f}: links the bar neither carries nor reaches through a panel`);
  }
  assert.ok(pages >= 8, 'the captured pages with a navbar');
});

test('the dashboard\'s navbar controls are all in the bar: its menus as panels, its Edit mode form as a switch', async () => {
  const h = await setup();
  const items = plain(h.adapter.read());
  // The toggles that only open Moodle's own menus have the bar's own: the account, the notifications and the messages.
  for (const id of ['profile', 'notifications', 'messages']) assert.ok(items.some((i) => i.id === id && i.panel), id);
  const forms = nav(h.document).querySelectorAll('form');
  assert.equal(forms.length, 1, 'the one form in the fixture\'s navbar is Moodle\'s Edit mode switch');
  const mode = items.find((i) => i.checked !== undefined);
  assert.ok(mode, 'the bar offers Edit mode');
  assert.equal(mode.label, 'Edit mode');
  assert.equal(mode.checked, false);
  assert.equal(mode.href, '', 'a switch, not a link to editmode.php');
});

test('Edit mode in the bar is a switch: named, its state announced, in the rail and in a phone\'s More sheet', async () => {
  for (const width of [1440, 600]) {
    const h = await setup({ width });
    const sw = (width > 900 ? h.rail : h.sheet)('[role="switch"]');
    assert.ok(sw, `a switch at ${width}px`);
    assert.equal(sw.tagName, 'BUTTON');
    assert.equal(sw.getAttribute('aria-checked'), 'false');
    assert.match(sw.textContent, /Edit mode/);
    assert.ok(!sw.hasAttribute('href'));
    assert.ok(!sw.getAttribute('part').split(' ').includes('switch-on'));
  }
});

test('turning Edit mode on from the bar flips Moodle\'s own switch, and the bar follows its state', async () => {
  const h = await setup();
  const box = edit(h.document), form = box.closest('form');
  assert.equal(box.checked, false);
  const event = h.click(h.rail('[role="switch"]'));
  assert.equal(event.defaultPrevented, true);
  assert.equal(box.clicks, 1, 'the click is the page\'s own: Moodle\'s script hears the change');
  assert.equal(box.checked, true);
  assert.equal(form.submitted, undefined, 'one request, not two');
  h.frame();
  const sw = h.rail('[role="switch"]');
  assert.equal(sw.getAttribute('aria-checked'), 'true');
  assert.ok(sw.getAttribute('part').split(' ').includes('switch-on'));
  assert.deepEqual(h.assigned, [], 'no page load of ours');
  h.click(sw); h.frame();
  assert.equal(box.checked, false);
  assert.equal(h.rail('[role="switch"]').getAttribute('aria-checked'), 'false');
});

test('where Moodle\'s script never started on the switch, the bar posts the native form', async () => {
  const h = await setup({ html: dashboard.replace(' data-edit-switch-initialised="1"', '') });
  const box = edit(h.document), form = box.closest('form');
  h.click(h.rail('[role="switch"]'));
  assert.equal(box.checked, true, 'the form says what the click chose');
  assert.equal(form.submitted, 1, 'and posts to editmode.php as it does without scripts');
  assert.equal(box.clicks, undefined);
});

test('Edit mode already on reads on, and a page without the form has no switch', async () => {
  const on = await setup({ html: dashboard.replace('name="setmode"', 'name="setmode" checked') });
  assert.equal(on.rail('[role="switch"]').getAttribute('aria-checked'), 'true');
  const none = await setup({ html: dashboard.replace(/<form action="[^"]*editmode.php"[\s\S]*?<\/form>/, '') });
  assert.equal(none.rail('[role="switch"]'), null);
  assert.ok(!plain(none.adapter.read()).some((i) => i.checked !== undefined));
});

test('under the top bar\'s More menu the switch stays a switch, with its state', async () => {
  const h = await setup({ navbar: { place: 'top' } });
  const row = h.root.querySelector('.titems [role="switch"]');
  assert.ok(row, 'a switch in the top bar\'s row');
  // A row too narrow for its items sends the last to More.
  const items = h.root.querySelector('.titems');
  Object.defineProperty(items, 'scrollWidth', { get: () => 1000 });
  items.box = { left: 0, top: 0, width: 300, height: 40 };
  h.events.resize(); h.frame();
  h.click(h.root.querySelector('.tmore'));
  const entry = h.root.querySelector('.menu [role="menuitemcheckbox"]');
  assert.ok(entry, 'in the menu as a checkbox item');
  assert.equal(entry.getAttribute('aria-checked'), 'false');
  assert.ok(!h.root.querySelector('.menu [role="menuitem"][data-id="' + entry.dataset.id + '"]'));
});

test('a mod cannot flip Edit mode: not through the bar\'s go(), not with a click it made up', async () => {
  const h = await setup();
  const id = h.ui.model().items.find((i) => i.label === 'Edit mode').id;
  assert.equal(h.ui.go(id), false);
  h.click(h.rail('[role="switch"]'), { isTrusted: false });
  assert.equal(edit(h.document).clicks, undefined);
});

// ---- a school's menu links, its dropdowns, its language menu and its search box ----------------------------------------
const menus = dashboard
  .replace('<li role="none" class="nav-item d-flex align-items-center dropdown dropdownmoremenu d-none">',
    '<li role="none" class="nav-item d-flex align-items-center"><a class="mds-nav-pill" href="http://localhost:8081/local/library/index.php" role="menuitem"><span class="mds-nav-pill__label">Library</span></a></li>'
    + '<li role="none" class="nav-item dropdown"><a href="#" id="drop-down-1" class="mds-nav-pill dropdown-toggle" role="menuitem" data-bs-toggle="dropdown" aria-haspopup="true" aria-expanded="false" aria-controls="drop-down-menu-1"><span class="mds-nav-pill__label">Student support</span></a>'
    + '<div class="dropdown-menu" role="menu" id="drop-down-menu-1" aria-labelledby="drop-down-1"><a class="dropdown-item" role="menuitem" href="http://localhost:8081/local/support/writing.php">Writing centre</a><div class="dropdown-divider"></div>'
    + '<a class="dropdown-item" role="menuitem" href="http://localhost:8081/local/support/tutoring.php?term=2">Tutoring</a><a class="dropdown-item" role="menuitem" href="https://elsewhere.test/help">Elsewhere</a></div></li>'
    + '<li role="none" class="nav-item"><a class="mds-nav-pill" href="https://elsewhere.test/portal"><span class="mds-nav-pill__label">Portal</span></a></li>'
    + '<li role="none" class="nav-item"><a class="mds-nav-pill" href="javascript:alert(1)"><span class="mds-nav-pill__label">Script</span></a></li>'
    + '<li role="none" class="nav-item d-flex align-items-center dropdown dropdownmoremenu d-none">')
  .replace('<div id="usernavigation" class="navbar-nav ms-auto h-100">',
    '<div id="usernavigation" class="navbar-nav ms-auto h-100"><div class="langmenu"><div class="dropdown"><a href="#" role="button" id="lang-menu-toggle" data-bs-toggle="dropdown" aria-label="Language" class="dropdown-toggle">English ‎(en)‎</a>'
    + '<div role="menu" class="dropdown-menu" id="lang-action-menu" aria-labelledby="lang-menu-toggle"><a href="http://localhost:8081/my/?lang=es" class="dropdown-item" role="menuitem" lang="es">Español ‎(es)‎</a><a href="http://localhost:8081/my/?lang=de" class="dropdown-item" role="menuitem" lang="de">Deutsch ‎(de)‎</a></div></div></div>'
    + '<div class="nav-item d-flex align-items-center"><form action="http://localhost:8081/search/index.php" method="get" class="mform simplesearchform"><label for="searchinput-1"><span class="visually-hidden">Search</span></label><input type="text" id="searchinput-1" name="q" placeholder="Search"><button type="submit">Go</button></form></div>');
const own = (items) => items.filter((i) => /^link:[a-z0-9]{12}$/.test(i.id));

test('a school\'s unmapped same-origin links become items of the bar, and off-origin ones are left out', async () => {
  const h = await setup({ html: menus });
  const items = plain(h.adapter.read()), mine = own(items);
  const library = mine.find((i) => i.label === 'Library');
  assert.ok(library, 'Library');
  assert.equal(library.href, origin + '/local/library/index.php');
  assert.ok(!library.panel);
  assert.deepEqual(mine.filter((i) => /Portal|Script|Elsewhere/.test(i.label)), [], 'off-origin and script links never become items');
  assert.ok(!items.some((i) => /elsewhere\.test|javascript/.test(i.href)));
  // The shared vocabulary's own items are as they were.
  assert.deepEqual(items.filter((i) => !i.id.startsWith('link:')).map((i) => i.id), ['dashboard', 'course', 'grades', 'profile', 'notifications', 'messages', 'logout']);
  // And the bar draws it: a link in the rail, after the places, with the page's own address.
  const drawn = h.rail(`[data-id="${library.id}"]`);
  assert.equal(drawn.tagName, 'A');
  assert.equal(drawn.href, library.href);
  const phone = await setup({ html: menus, width: 600 });
  assert.equal(phone.sheet(`[data-id="${library.id}"]`).getAttribute('href'), library.href, 'on a phone it lands in the More sheet');
});

test('a link\'s name is the same for the same address and fits the bar\'s link ids', () => {
  const { slug } = require('../features/navbar-moodle.js').data;
  const a = slug(origin + '/local/library/index.php'), b = slug(origin + '/local/library/index.php');
  assert.equal(a, b);
  for (const id of [a, slug(''), slug('menu:Language'), slug('Ünïcödé ✓ 🎓')]) assert.match(`link:${id}`, /^link:[a-z0-9]{12}$/);
  assert.notEqual(slug(origin + '/a'), slug(origin + '/b'));
  assert.ok(M.clean({ links: [{ id: a, n: 'x', u: origin + '/x' }] }).links.length === 1, 'the model accepts it as a link id');
});

test('a dropdown (a custom menu, the language menu) is one item opening a panel of its links; foreign links stay out of it', async () => {
  const h = await setup({ html: menus });
  const mine = own(plain(h.adapter.read()));
  const support = mine.find((i) => i.label === 'Student support'), lang = mine.find((i) => i.label === 'Language');
  assert.ok(support?.panel && lang?.panel);
  assert.equal(support.href, '');
  assert.ok(!mine.some((i) => /Writing centre|Tutoring|Español/.test(i.label)), 'its links are not also loose items');
  const rows = (await h.adapter.panel(support.id)).sections[0].rows;
  assert.deepEqual(plain(rows).map((r) => [r.label, r.href]), [['Writing centre', origin + '/local/support/writing.php'], ['Tutoring', origin + '/local/support/tutoring.php?term=2']]);
  const langs = await h.adapter.panel(lang.id);
  assert.equal(langs.title, 'Language');
  assert.deepEqual(plain(langs.sections[0].rows).map((r) => r.label.replace(/\u200e/g, '')), ['Español (es)', 'Deutsch (de)'], 'Moodle\'s own direction marks stay in its names');
  assert.equal(await h.adapter.panel('link:zzzzzzzzzzzz'), null);
  // In the bar: a button with a panel, as Canvas's menus are.
  const button = h.rail(`[data-id="${support.id}"]`);
  assert.equal(button.tagName, 'BUTTON');
  assert.equal(button.getAttribute('aria-haspopup'), 'dialog');
});

// Recent Moodle measures overflow links out of the page until its More menu opens; its data still lists them, with their children.
const measured = (html) => {
  const item = (text, href, children = []) => ({ key: text, text, title: null, href, active: false, forceintomoremenu: false, showchildreninsubmenu: false, id: null, attributes: [], actions: [], divider: false, children });
  const more = [item('Library', origin + '/local/library/index.php'), item('Student support', '#', [item('Writing centre', origin + '/local/support/writing.php'), { divider: true }, item('Elsewhere', 'https://elsewhere.test/help')]), item('Portal', 'https://elsewhere.test/portal')];
  return html.replace('}],&quot;morelabel&quot;', '},' + JSON.stringify(more).slice(1, -1).replace(/"/g, '&quot;') + '],&quot;morelabel&quot;');
};

test('what Moodle has measured out of its navbar is still carried, from its data, and not twice', async () => {
  const h = await setup({ html: measured(dashboard) });
  const mine = own(plain(h.adapter.read()));
  assert.deepEqual(mine.filter((i) => i.id !== 'link:editmode0000').map((i) => [i.label, i.href, !!i.panel]), [['Library', origin + '/local/library/index.php', false], ['Student support', '', true]]);
  const support = mine.find((i) => i.label === 'Student support');
  assert.deepEqual(plain((await h.adapter.panel(support.id)).sections[0].rows).map((r) => [r.label, r.href]), [['Writing centre', origin + '/local/support/writing.php']]);
  // The same links in the page as well: one item each, with the page's own rows.
  const both = await setup({ html: measured(menus) });
  const twice = own(plain(both.adapter.read()));
  assert.equal(twice.filter((i) => i.label === 'Library').length, 1);
  assert.equal(twice.filter((i) => i.label === 'Student support').length, 1);
  assert.equal(plain((await both.adapter.panel(twice.find((i) => i.label === 'Student support').id)).sections[0].rows).length, 2);
});

test('a native search box is carried as a link to its search page', async () => {
  const h = await setup({ html: menus });
  const search = own(plain(h.adapter.read())).find((i) => i.href === origin + '/search/index.php');
  assert.ok(search);
  assert.equal(search.label, 'Search');
});

test('the items\' ids hold still while the menu is reordered, and the bar keeps only what the student hasn\'t hidden', async () => {
  const a = plain(await setup({ html: menus }).then((h) => h.adapter.read()));
  const moved = menus.replace(/(<li role="none" class="nav-item d-flex align-items-center"><a class="mds-nav-pill" href="http:\/\/localhost:8081\/local\/library[\s\S]*?<\/li>)([\s\S]*?)(<li role="none" class="nav-item"><a class="mds-nav-pill" href="https:\/\/elsewhere)/, '$2$1$3');
  assert.notEqual(moved, menus);
  const b = plain(await setup({ html: moved }).then((h) => h.adapter.read()));
  const ids = (list) => Object.fromEntries(own(list).map((i) => [i.label, i.id]));
  assert.deepEqual(ids(b), ids(a));
  assert.equal(new Set(own(a).map((i) => i.id)).size, own(a).length, 'no two items share an id');
  const library = ids(a).Library;
  const h = await setup({ html: menus, prefs: { items: { [library]: { hidden: true }, [ids(a)['Student support']]: { label: 'Support', icon: 'help' } } } });
  assert.equal(h.rail(`[data-id="${library}"]`), null, 'hidden like any item');
  assert.match(h.rail(`[data-id="${ids(a)['Student support']}"]`).textContent, /Support/);
});

test('the cache of the places last seen holds only the shared vocabulary\'s names', async () => {
  const h = await setup({ html: menus });
  h.adapter.read();
  const saved = h.writes.flatMap((w) => Object.values(w)).flat();
  assert.ok(saved.length);
  assert.deepEqual(saved.filter((i) => /^link:/.test(i.id)), []);
});

test('native generic items retain their destination and control type when a saved link has the same id', async () => {
  const library = require('../features/navbar-moodle.js').data.slug(origin + '/local/library/index.php');
  const h = await setup({ html: menus, prefs: { links: [
    { id: library, n: 'Old link', u: origin + '/wrong', tab: true },
    { id: 'editmode0000', n: 'Old mode', u: origin + '/wrong', tab: true },
  ] } });
  const item = h.ui.model().items.find((i) => i.id === 'link:' + library);
  assert.equal(item.href, origin + '/local/library/index.php');
  assert.equal(h.rail(`[data-id="${item.id}"]`).hasAttribute('target'), false);
  const sw = h.rail('[role="switch"]');
  assert.equal(sw.tagName, 'BUTTON');
  assert.equal(sw.hasAttribute('href'), false);
});

test('a disabled native Edit mode control stays disabled in the bar', async () => {
  const h = await setup();
  edit(h.document).disabled = true;
  h.ui.sync();
  assert.equal(h.rail('[role="switch"]').disabled, true);
  h.click(h.rail('[role="switch"]'));
  assert.equal(edit(h.document).clicks, undefined);
});

test('the notifications panel also carries the preferences link of Moodle\'s notification menu', async () => {
  const h = await setup();
  // An icon-only link: a browser keeps the whitespace around its icon, which the stand-in's parser drops.
  h.document.querySelector('a[href*="notificationpreferences"]').append('\n   ');
  const panel = await h.adapter.panel('notifications');
  const foot = panel.foot.map((r) => r.href);
  assert.ok(foot.includes(origin + '/message/output/popup/notifications.php'));
  assert.ok(foot.includes(origin + '/message/notificationpreferences.php'));
  assert.equal(panel.foot.find((r) => /notificationpreferences/.test(r.href)).label, 'Notification preferences');
});

test('Moodle\'s own navbar stays hidden under the bar, because everything in it has a place there', () => {
  const css = read('moodle.css');
  assert.match(css, /html\[data-gz-navbar\] :is\(nav\.navbar\.fixed-top,/);
  assert.match(css, /::part\(switch-on\)/, 'the lit switch is styled, because the bar\'s own sheet styles only its pin');
});
