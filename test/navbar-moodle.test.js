const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const A = require('../features/navbar-moodle.js');
const M = require('../lib/navbar.js');
const G = require('../defaults.js');
const D = A.data, root = 'https://school.test/moodle';

test('Moodle session and row addresses stay on this origin, including folder installs', () => {
  assert.deepEqual(D.session(root + '/login/logout.php?sesskey=abc', 'https://school.test'), { root, sesskey: 'abc' });
  for (const href of ['https://else.test/login/logout.php?sesskey=abc', root + '/login/logout.php', root + '/wrong.php?sesskey=x']) assert.equal(D.session(href, 'https://school.test'), null);
  for (const href of ['https://else.test/a', '//else.test/a', 'javascript:alert(1)', '#', '', ' #menu', 'https://user:pass@school.test/a', undefined]) assert.equal(D.here(href, root), '');
  assert.equal(D.here('/moodle/user/profile.php', root), root + '/user/profile.php');
});

test('Moodle notification and conversation rows preserve data and safe destinations', () => {
  const rows = D.notifications({ notifications: [{ subject: 'A &amp; B', smallmessage: '<b>Graded</b>', contexturl: root + '/mod/assign/view.php?id=8', read: false }, { subject: 'Other', contexturl: 'https://else.test/a', read: true }, { subject: 'Gone', deleted: true }] }, root, (s) => s);
  assert.equal(rows.length, 2); assert.equal(rows[0].label, 'A & B'); assert.equal(rows[0].sub, 'Unread · Graded'); assert.equal(rows[0].badge, '•');
  assert.equal(rows[1].href, root + '/message/output/popup/notifications.php');
  const messages = D.conversations({ conversations: [{ id: 12, members: [{ fullname: 'Sam' }], messages: [{ text: '<p>Hello</p>' }], unreadcount: 102 }, { id: 'evil&x=1', name: 'bad' }] }, root);
  assert.deepEqual(messages, [{ label: 'Sam', sub: 'Hello', href: root + '/message/index.php?convid=12', icon: 'inbox', badge: '99+' }]);
  assert.deepEqual(D.conversations({ conversations: [] }, root), []);
  assert.equal(D.text('Sam&#039;s &amp; &#x42;'), "Sam's & B");
  assert.throws(() => D.notifications({}, root, (s) => s)); assert.throws(() => D.conversations({}, root));
  for (const [value, want] of [['0', ''], ['3', '3'], ['99+', '99+'], ['120', '99+'], ['wrong', '']]) assert.equal(D.count(value), want);
});

test('Moodle first paint words exactly match layout, with no course tabs', () => {
  const src = fs.readFileSync(require.resolve('../content.js'), 'utf8');
  const paint = src.match(/X\.paintNav = \(\) => \{([\s\S]*?)\n    \};/)[1];
  for (const patch of [{}, { place: 'top' }, { rail: 'open' }, { style: 'embed' }, { course: 'icons' }, { course: 'top' }, { course: 'hide' }, { cmenu: false }, { on: false }]) {
    const b = { ...G.GZ_SANITIZE().navbar, ...patch };
    for (const [pathname, cls, course] of [['/my/', '', false], ['/course/view.php', '', true], ['/mod/assign/view.php', 'course-5 context-78', true], ['/my/courses.php', 'course-1', false]]) {
      let words;
      const win = {}; win.top = win;
      vm.runInNewContext('(() => {' + paint + '})()', { settings: { navbar: b }, document: { body: { className: cls } }, location: { pathname }, globalThis: {}, window: win, setAttr: (k, v) => { words = v; } });
      assert.equal(words, b.on && M.layout(b, { course, menu: course, tabs: false }).words, JSON.stringify([patch, pathname]));
    }
  }
});

test('Moodle adapter and renderer are lazy, ordered and packaged', () => {
  const bg = fs.readFileSync(require.resolve('../lib/background.js'), 'utf8');
  assert.match(bg, /LOADABLE = new Set\([^\n]*'features\/navbar-moodle.js'/);
  assert.match(bg, /files.includes\('features\/navbar-moodle.js'\).*\['lib\/nav.js', 'lib\/nav-items.js', 'lib\/navlayout.js'\]/);
  const src = fs.readFileSync(require.resolve('../content.js'), 'utf8');
  assert.match(src, /need\('features\/navbar-moodle.js'[\s\S]*?then\(\(\) => need\('features\/navbar.js'/);
  assert.match(src, /if \(moodle\) \{ globalThis.GZ_NAVBAR_UI\?\.sync\(\); html.removeAttribute\('data-gz-navbar'\); \}/);
});

test('the injected factory ends on a serializable acknowledgement for the worker', () => {
  const source = fs.readFileSync(require.resolve('../features/navbar-moodle.js'), 'utf8');
  const context = vm.createContext({});
  const result = vm.runInContext(source, context);
  assert.equal(result.ready, true);
  assert.equal(vm.runInContext('typeof GZ_NAVBAR_MOODLE', context), 'function');
});

test('only a registered Moodle top frame can use its narrow pin permission', async () => {
  const source = fs.readFileSync(require.resolve('../lib/background.js'), 'utf8');
  const from = vm.runInNewContext(source.match(/const fromMoodle = ([\s\S]*?)\n};/)[0] + '\nfromMoodle;', { URL, chrome: { runtime: { id: 'ext' }, storage: { local: { get: async () => ({ moodle: ['https://school.test/*'] }) } } } });
  const sender = { id: 'ext', tab: {}, frameId: 0, url: root + '/my/' };
  assert.equal(await from(sender), 'https://school.test');
  for (const change of [{ id: 'other' }, { frameId: 1 }, { tab: null }, { url: 'https://other.test/' }, { url: 'http://school.test/' }, { url: 'about:blank' }]) assert.equal(await from({ ...sender, ...change }), null);
});
