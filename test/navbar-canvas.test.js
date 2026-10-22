const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const L = require('../lib/navlayout.js'), M = require('../lib/navbar.js'), G = require('../defaults.js');
const read = (f) => fs.readFileSync(require.resolve(`../${f}`), 'utf8');
const plain = (v) => JSON.parse(JSON.stringify(v));
const origin = 'https://school.instructure.com';
const anchor = (key, href, label, badge = '', active = false) => ({
  id: `global_nav_${key}_link`, href: origin + href, classList: [key], textContent: label,
  getAttribute: (k) => ({ href, 'aria-label': label }[k] || null),
  matches: () => active, closest: () => null, click() { this.clicked = true; },
  querySelector: (s) => s === '.menu-item__badge' && badge ? { textContent: badge } : null,
  nodes: [{ data: label, parentElement: { closest: () => null } }, { data: badge, parentElement: { closest: () => true } }],
});
function setup({ links = [], tools = [], cached = [], path = '/', answers = {} } = {}) {
  const calls = [], writes = [], assigned = [], observations = [];
  const location = { origin, href: origin + path, pathname: path, protocol: 'https:', assign: (p) => assigned.push(p) };
  const document = {
    location, cookie: '_csrf_token=a%2Bb%3D', documentElement: { dataset: {} },
    querySelector: (s) => s.startsWith('#menu') ? { querySelectorAll: (q) => q.includes('globalNavExternalTool') ? tools : links } : null,
    querySelectorAll: () => [], getElementById: () => null,
    createTreeWalker: (a, type, filter) => { const nodes = (a.nodes || []).filter((n) => filter.acceptNode(n) === 1); let i = 0; return { nextNode: () => nodes[i++] }; },
  };
  const ctx = { URL, URLSearchParams, AbortSignal, setTimeout, clearTimeout, document, location, GZ_NAV_LAYOUT: L, GZ_NAVBAR: M,
    NodeFilter: { SHOW_TEXT: 4, FILTER_REJECT: 2, FILTER_ACCEPT: 1 },
    MutationObserver: class { observe(...args) { observations.push(args); } disconnect() {} },
    X: { t: (s) => s, courseColors: () => ({ [`canvas:${origin}/12`]: { color: '#abc' } }) },
    chrome: { storage: { local: { get: (k, cb) => cb({ [k]: cached }), set: (v) => writes.push(v) } } },
    fetch: async (u, o) => { calls.push([u, o]); const a = answers[u] ?? answers[new URL(u, origin).pathname]; if (a instanceof Error) throw a; if (a instanceof Response) return a.clone(); return new Response(JSON.stringify(a ?? [])); },
  };
  const adapter = vm.runInNewContext(read('features/navbar-canvas.js') + '\nGZ_NAVBAR_CANVAS(X);', ctx);
  return { adapter, calls, writes, assigned, document, observations, ctx };
}

test('Canvas reads native vocabulary, badge-free labels, active state and panel flags; trays never receive clicks', () => {
  const links = [anchor('dashboard', '/', 'Dashboard'), anchor('courses', '/courses', 'Courses'), anchor('conversations', '/conversations', 'Inbox', '12'), anchor('help', '#', 'Help'), anchor('history', '#', 'History'), anchor('groups', '/groups', 'Groups'), anchor('profile', '/profile/settings', 'Account'), anchor('accounts', '/accounts', 'Admin')];
  const s = setup({ links, path: '/courses/12/modules' }), items = plain(s.adapter.read());
  assert.deepEqual(items.map((i) => i.id), ['dashboard', 'course', 'messages', 'help', 'history', 'groups', 'profile', 'admin']);
  assert.equal(items.find((i) => i.id === 'messages').label, 'Inbox');
  assert.equal(items.find((i) => i.id === 'messages').badge, '12');
  assert.deepEqual(items.filter((i) => i.active).map((i) => i.id), ['course']);
  assert.deepEqual(items.filter((i) => i.panel).map((i) => i.id), ['course', 'help', 'history', 'groups', 'profile', 'admin']);
  for (const i of items.filter((i) => i.panel)) assert.equal(s.adapter.go(i.id), false);
  assert.ok(!links.some((a) => a.clicked)); assert.equal(s.adapter.go('messages'), true);
  assert.equal(s.adapter.home(), 'dashboard'); assert.equal(s.adapter.inCourse(), true);
  assert.ok(s.writes.length); assert.ok(!JSON.stringify(s.writes).includes('badge'));
});

test('cached items restore same-origin links without trusting foreign or executable paths', () => {
  const s = setup({ cached: [{ id: 'course', label: 'Courses', path: '/courses' }, { id: 'help', label: 'Help', path: '//foreign.test/' }, { id: 'admin', label: 'Admin', path: 'javascript:alert(1)' }], path: '/courses/12' });
  assert.deepEqual(plain(s.adapter.read()).map((i) => i.id), ['course']);
});

test('school global-navigation tools remain reachable and preserve new-tab launches', async () => {
  const tool = anchor('', '/accounts/1/external_tools/9', 'School library');
  tool.id = ''; tool.target = '_blank';
  const s = setup({ links: [anchor('dashboard', '/', 'Dashboard')], tools: [tool] });
  const item = s.adapter.read().find((i) => i.id === 'tools');
  assert.equal(item?.panel, true);
  const rows = (await s.adapter.panel('tools')).sections[0].rows;
  assert.equal(rows[0].label, 'School library');
  assert.equal(rows[0].href, origin + '/accounts/1/external_tools/9');
  assert.equal(rows[0].tab, true);
});

test('course menu reads a supplied frame document, class keys, current page, course name and Glaze color', () => {
  const s = setup(), a = anchor('modules', '/courses/12/modules', 'Modules');
  a.classList = ['modules']; a.classList.contains = (c) => c === 'active'; a.hidden = false;
  const doc = { location: { pathname: '/courses/12/modules' }, getElementById: () => ({ querySelectorAll: () => [a] }), querySelector: () => ({ textContent: 'Biology', getAttribute: () => '/courses/12' }) };
  const m = plain(s.adapter.menu(doc));
  assert.equal(m.name, 'Biology'); assert.equal(m.color, '#abc');
  assert.deepEqual(m.items, [{ key: 'modules', label: 'Modules', href: origin + '/courses/12/modules', active: true }]);
  a.target = '_blank';
  assert.equal(s.adapter.menu(doc).items[0].tab, true, 'course tools may require a new window');
});

test('the integrated course menu honors Canvas course-tab declutter choices', () => {
  const s = setup();
  const links = ['modules', 'announcements', 'discussions', 'grades'].map((key) => {
    const a = anchor(key, `/courses/12/${key}`, key);
    a.classList.contains = (c) => c === key;
    return a;
  });
  const doc = { location: { pathname: '/courses/12' }, getElementById: () => ({ querySelectorAll: () => links }), querySelector: () => null };
  s.ctx.X.settings = () => ({ declutter: { tabs: ['announcements', 'engagement', 'grades'] } });
  assert.deepEqual(plain(s.adapter.menu(doc).items.map((i) => i.key)), ['modules']);
});

test('the replacement global menu honors Canvas Hide help for live and cached items', () => {
  for (const options of [{ links: [anchor('help', '#', 'Help'), anchor('dashboard', '/', 'Dashboard')] }, { cached: [{ id: 'help', label: 'Help', path: '/' }, { id: 'dashboard', label: 'Dashboard', path: '/' }] }]) {
    const s = setup(options);
    s.ctx.X.settings = () => ({ declutter: { help: true } });
    assert.deepEqual(plain(s.adapter.read().map((i) => i.id)), ['dashboard']);
  }
});

test('panels parse Canvas JSON prefixes and next links, cap pagination, and preserve term names and colors', async () => {
  const s = setup({ answers: { '/api/v1/users/self/favorites/courses': new Response('while(1);' + JSON.stringify([{ id: 12, name: 'Biology', term: { name: 'Fall' } }]), { headers: { Link: `<${origin}/api/v1/page2>; rel="next"` } }), '/api/v1/page2': new Response('[{"id":13,"name":"Writing"}]', { headers: { Link: '<https://elsewhere.test/api/v1/page3>; rel="next"' } }) } });
  const d = plain(await s.adapter.panel('course'));
  assert.equal(d.sections[0].rows.length, 2); assert.equal(d.sections[0].rows[0].sub, 'Fall'); assert.equal(d.sections[0].rows[0].color, '#abc');
  assert.equal(d.foot[0].href, origin + '/courses');
  assert.equal(s.calls.length, 2);
  for (const [u, o] of s.calls) { assert.equal(new URL(u).origin, origin); assert.equal(o.credentials, 'same-origin'); assert.equal(o.headers.Accept, 'application/json'); assert.equal(o.redirect, 'error'); }
  const many = setup({ answers: { '/api/v1/users/self/groups': Array.from({ length: 250 }, (_, id) => ({ id, name: `Group ${id}` })) } });
  assert.equal((await many.adapter.panel('groups')).sections[0].rows.length, 200);
});

test('Canvas pagination stops at five pages, repeated links and same-origin non-API destinations', async () => {
  const answers = {};
  for (let n = 1; n <= 6; n++) answers[n === 1 ? '/api/v1/users/self/groups' : `/api/v1/page${n}`] = new Response(JSON.stringify([{ id: n, name: `Group ${n}` }]), { headers: { Link: `<${origin}/api/v1/page${n + 1}>; rel="next"` } });
  const s = setup({ answers });
  assert.equal((await s.adapter.panel('groups')).sections[0].rows.length, 5);
  assert.equal(s.calls.length, 5);
  for (const href of [`${origin}/api/v1/users/self/groups?per_page=100`, `${origin}/logout`, 'https://elsewhere.test/api/v1/groups']) {
    const cycle = setup({ answers: { '/api/v1/users/self/groups': new Response('[{"id":1,"name":"One"}]', { headers: { Link: `<${href}>; rel="next"` } }) } });
    assert.equal((await cycle.adapter.panel('groups')).sections[0].rows.length, 1);
    assert.equal(cycle.calls.length, 1, href);
  }
});

test('empty favorites fall back to active courses; failed panels return null for the renderer retry', async () => {
  const s = setup({ answers: { '/api/v1/courses': [{ id: 12, name: 'Active course' }], '/api/v1/accounts': new Response('{}', { status: 403 }) } });
  assert.equal((await s.adapter.panel('course')).sections[0].rows[0].label, 'Active course');
  assert.equal(await s.adapter.panel('admin'), null);
  const bad = setup({ answers: { '/api/v1/users/self/history': new Response('<html>login</html>') } });
  assert.equal(await bad.adapter.panel('history'), null);
});

test('navigation discovery observes an empty document and can be read after teardown', () => {
  const s = setup();
  s.adapter.observe(() => {});
  assert.ok(s.observations.some(([node, options]) => node === s.document.documentElement && options.subtree), 'late headers must be discovered');
  s.adapter.unobserve();
  s.document.getElementById = () => ({});
  assert.doesNotThrow(() => s.adapter.read());
});

test('malformed cached items cannot stop Canvas navigation', () => {
  const s = setup({ cached: [null, 12, { id: 'course', label: 'Courses', path: '/courses' }] });
  assert.deepEqual(plain(s.adapter.read()).map((i) => i.id), ['course']);
});

test('Canvas image URLs are validated and a replaced avatar or school image is refreshed', () => {
  const s = setup();
  const img = { src: 'javascript:bad()', alt: 'School' };
  const logo = { querySelector: () => img, getAttribute: () => '' };
  s.document.querySelector = (selector) => selector.startsWith('#header') ? logo : selector === '#global_nav_profile_link img' ? img : null;
  assert.equal(s.adapter.brand().src, '');
  assert.equal(s.adapter.avatar(), '');
  img.src = origin + '/school.png';
  assert.equal(s.adapter.brand().src, img.src);
  assert.equal(s.adapter.avatar(), img.src);
});

test('Account, Groups, History, Help and Admin use actual Canvas data and safe destinations', async () => {
  const s = setup({ answers: {
    '/api/v1/users/self/tabs': [{ id: 'eportfolios', label: 'My portfolio', html_url: '/users/1/eportfolios' }],
    '/api/v1/users/self/groups': [{ id: 5, name: 'Lab team' }],
    '/api/v1/users/self/history': [{ asset_name: 'Microscopes', context_name: 'Biology', visited_url: '/courses/12/pages/microscopes', asset_icon: 'icon-document' }, { asset_name: 'Bad', visited_url: 'javascript:bad()' }],
    '/help_links': [{ text: 'Guide', url: 'https://guides.example.test/', subtext: 'Documentation' }, { text: 'Form', url: '#teacher_feedback' }],
    '/api/v1/accounts': [{ id: 1, name: 'School' }],
  } });
  const account = await s.adapter.panel('profile');
  assert.deepEqual(plain(account.sections[0].rows.map((r) => r.label)), ['Profile', 'Settings', 'Notifications', 'Files', 'My portfolio']);
  assert.equal(account.foot[0].run, 'logout');
  assert.equal((await s.adapter.panel('groups')).sections[0].rows[0].href, origin + '/groups/5');
  const hist = await s.adapter.panel('history'); assert.equal(hist.sections[0].rows.length, 1); assert.equal(hist.sections[0].rows[0].sub, 'Biology');
  assert.equal((await s.adapter.panel('help')).sections[0].rows[0].href, 'https://guides.example.test/');
  assert.equal((await s.adapter.panel('admin')).sections[0].rows[0].href, origin + '/accounts/1');
  assert.equal(await s.adapter.panel('unknown'), null);
});

test('logout sends only Canvas DELETE with its decoded CSRF token and then returns to login', async () => {
  const s = setup();
  assert.equal(await s.adapter.run('logout'), true);
  const [u, o] = s.calls[0]; assert.equal(u, '/logout'); assert.equal(o.method, 'DELETE'); assert.equal(o.credentials, 'same-origin');
  assert.equal(o.body.get('authenticity_token'), 'a+b='); assert.deepEqual(s.assigned, ['/login']);
  s.document.cookie = ''; assert.equal(await s.adapter.run('logout'), false); assert.equal(s.calls.length, 1);
});

test('Canvas first-paint words exactly match the shared layout for every course, menu, tabs and placement setting', () => {
  const code = read('content-canvas.js').match(/    const b = I\.settings\.navbar, c = [\s\S]*?(?=    setAttr\('data-gz-nav-size')/)[0];
  const base = G.GZ_SANITIZE().navbar;
  for (const course of [false, true]) for (const menu of [false, true]) for (const tabs of [false, true]) for (const place of ['rail', 'top']) for (const state of ['same', 'icons', 'top', 'hide']) for (const style of ['float', 'embed']) for (const cmenu of [false, true]) {
    const navbar = { ...base, place, course: state, style, cmenu }, attrs = {};
    vm.runInNewContext(code, { I: { settings: { navbar, enhance: { tabs } } }, location: { pathname: course ? '/courses/12/modules' : '/' }, document: { querySelector: () => menu ? {} : null }, globalThis: {}, setAttr: (k, v) => { attrs[k] = v; } });
    assert.equal(attrs['data-gz-navbar'], M.layout(navbar, { course, menu, tabs }).words, JSON.stringify({ course, menu, tabs, place, state, style, cmenu }));
  }
  const source = read('lib/background.js');
  assert.ok(source.includes("files.includes('features/navbar-canvas.js') ? ['lib/nav.js', 'lib/nav-items.js', 'lib/navlayout.js']"));
});

test('Help falls back to tray DOM and account API without leaking role-restricted or executable links', async () => {
  const s = setup({ answers: { '/help_links': new Response('{}', { status: 404 }), '/api/v1/accounts/self/help_links': { custom_help_links: [{ text: 'School help', url: '/support', available_to: ['user'] }, { text: 'Staff only', url: '/staff', available_to: ['admin'] }], default_help_links: [{ text: 'Bad', url: 'javascript:bad()' }] } } });
  assert.deepEqual(plain((await s.adapter.panel('help')).sections[0].rows.map((r) => r.label)), ['School help']);
  s.document.querySelectorAll = () => [{ textContent: 'Help center', getAttribute: () => '/help-center' }];
  assert.equal((await s.adapter.panel('help')).sections[0].rows[0].href, origin + '/help-center');
});

test('Canvas Help retains built-in support forms and opens them through Canvas without submitting', async () => {
  const trigger = anchor('help', '#', 'Help');
  const s = setup({ links: [trigger], answers: { '/help_links': [{ text: 'Ask your instructor', url: '#teacher_feedback' }, { text: 'Report a problem', url: '#create_ticket' }, { text: 'Bad', url: '#arbitrary' }] } });
  const rows = (await s.adapter.panel('help')).sections[0].rows;
  assert.deepEqual(plain(rows.map((r) => r.run)), ['help:teacher_feedback', 'help:create_ticket']);
  let opened = false;
  trigger.click = () => { opened = true; };
  const base = s.document.querySelector;
  s.document.querySelector = (selector) => opened && selector.includes('#help_tray') ? { click: () => { opened = 'form'; } } : base(selector);
  assert.equal(await s.adapter.run('help:teacher_feedback'), true);
  assert.equal(opened, 'form');
  assert.equal(s.calls.length, 1, 'only the Help list was fetched; no form was submitted');
  assert.equal(await s.adapter.run('help:arbitrary'), false);
});

test('observers scope live changes to native navigation and disconnect when the bar stops', () => {
  const s = setup(); let disconnected = 0;
  s.ctx.MutationObserver = class { observe(...args) { s.observations.push(args); } disconnect() { disconnected++; } };
  const header = { parentElement: {} }, course = { parentElement: {} };
  s.document.getElementById = (id) => ({ header, 'section-tabs': course }[id]);
  s.adapter.observe(() => {}); s.adapter.read();
  assert.equal(s.observations.length, 4);
  assert.equal(s.observations[0][0], header); assert.equal(s.observations[2][0], course);
  s.adapter.unobserve(); assert.equal(disconnected, 4);
});

test('failed logout does not redirect or leave an unhandled action rejection', async () => {
  const s = setup({ answers: { '/logout': Error('offline') } });
  assert.equal(await s.adapter.run('logout'), false); assert.deepEqual(s.assigned, []);
});

test('the lazy adapter returns a serializable completion marker to the worker', () => {
  assert.equal(vm.runInNewContext(read('features/navbar-canvas.js')), true);
});

test('tray items render as buttons so modifier and middle clicks cannot jump to a native tray page', () => {
  const src = read('features/navbar.js'), node = src.slice(src.indexOf('  const node ='), src.indexOf('  const badgeOf ='));
  const make = (tag, props) => ({ tag, ...props, dataset: {}, setAttribute() {} });
  const build = vm.runInNewContext(node + '\nnode;', { make, part: () => {} });
  assert.equal(build({ id: 'course', href: '/courses', panel: true }, 'item', 'item').tag, 'button');
  assert.equal(build({ id: 'calendar', href: '/calendar' }, 'item', 'item').tag, 'a');
});

test('Canvas login and logout pages do not reserve authenticated navigation room', () => {
  const code = read('content-canvas.js').match(/    const b = I\.settings\.navbar, c = [\s\S]*?(?=    setAttr\('data-gz-nav-size')/)[0];
  for (const pathname of ['/login', '/login/canvas', '/logout']) {
    const attrs = {};
    vm.runInNewContext(code, { I: { settings: G.GZ_SANITIZE() }, location: { pathname }, globalThis: {}, document: {}, setAttr: (k, v) => { attrs[k] = v; } });
    assert.equal(attrs['data-gz-navbar'], false);
  }
});

test('what focus scrolls to stops clear of the fixed bar on Canvas and Moodle (WCAG 2.4.11)', () => {
  const canvas = read('canvas.css'), moodle = read('moodle.css');
  const phone = (css) => css.slice(css.indexOf('@media (max-width: 899.98px)', css.indexOf('html[data-gz-navbar] {')));
  assert.match(canvas, /^html\[data-gz-navbar\] \{ scroll-padding-top: var\(--gz-navbar-top\); \}$/m, 'under the top bar');
  assert.match(phone(canvas).slice(0, phone(canvas).indexOf('\n}')), /html\[data-gz-navbar\]:not\(\[data-gz-navbar~="none"\]\) \{ scroll-padding-bottom: calc\(96px \+ env\(safe-area-inset-bottom, 0px\)\); \}/, "above a phone's bottom bar");
  // Moodle keeps the bottom bar's room as a variable of its own.
  assert.match(moodle, /^html\[data-gz-navbar\] \{ scroll-padding: var\(--gz-navbar-top\) 0 var\(--gz-navbar-bottom\); \}$/m);
});

test('a failed lazy navbar load restores native Canvas navigation', async () => {
  const source = read('content-canvas.js'), start = source.indexOf('  const syncNav =');
  const window = {}; window.top = window;
  const attrs = {};
  vm.runInNewContext(source.slice(start, source.indexOf('\n\n  return {', start)) + '\nsyncNav();', {
    window, location: { pathname: '/' },
    I: { links: [{}], settings: { navbar: { on: true } }, worn: { nav: {} } },
    setAttr: (k, v) => { attrs[k] = v; }, need: async () => { throw Error('worker unavailable'); },
  });
  await new Promise(setImmediate);
  assert.equal(attrs['data-gz-navbar'], false);
});
