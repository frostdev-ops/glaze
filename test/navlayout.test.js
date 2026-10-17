const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../lib/navlayout.js');

const link = (id, extra = {}) => ({ id, n: `Link ${id}`, u: `https://example.com/${id}`, i: 'book', ...extra });
const A = 'aaaaaaaaaaaa', B = 'bbbbbbbbbbbb';

test('a nav layout keeps what it was given, and cleaning it again changes nothing', () => {
  const nav = { place: 'dock', groups: [{ label: 'Study', items: ['course', `link:${A}`, 'w:next'] }, { items: ['calendar', 'w:clock'] }], hidden: ['stream', 'help'], links: [link(A)], icons: { course: 'star', [`link:${A}`]: 'globe' } };
  assert.deepEqual(L.clean(nav), nav);
  assert.deepEqual(L.clean(L.clean(nav)), L.clean(nav));
  assert.deepEqual(L.clean(JSON.parse(JSON.stringify(nav))), nav, 'survives a JSON round trip, as in a theme code');
  assert.deepEqual(L.clean({ place: 'left' }), { place: 'left' }, 'keys left out stay out');
});

test('unknown keys and wrong types refuse the whole layout', () => {
  for (const raw of [null, 'top', [], {}, { place: 'side' }, { extra: 1 }, { groups: {} }, { groups: [{ items: 'course' }] }, { groups: [{ label: 3, items: [] }] }, { groups: [{ items: [], open: true }] },
    { hidden: 'stream' }, { links: {} }, { links: [link(A, { tab: true })] }, { links: ['x'] }, { icons: [] }]) assert.equal(L.clean(raw), null, JSON.stringify(raw));
});

test('limits: six groups, eight links, labels of 24 characters, Glaze settings never hidden', () => {
  const links = Array.from({ length: 12 }, (_, n) => link(`link${String(n).padStart(8, '0')}`));
  const nav = L.clean({ groups: Array.from({ length: 9 }, (_, n) => ({ label: `Group ${n} with a label that runs on and on`, items: [] })), links, hidden: ['glaze', 'grades', 'grades', 'nope', 7] });
  assert.equal(nav.groups.length, 6);
  assert.equal(nav.groups[0].label, 'Group 0 with a label tha');
  assert.equal(nav.links.length, 8);
  assert.deepEqual(nav.hidden, ['grades']);
  assert.equal(L.clean({ groups: [{ label: ' \u0000 ', items: [] }] }).groups[0].label, undefined, 'a blank label is left out');
});

test('entries that do not fit are dropped: unsafe links, unknown ids, repeats, hidden items in groups, unknown icons', () => {
  const nav = L.clean({
    links: [link(A), link(A), link(B, { u: 'javascript:alert(1)' }), link('short'), link(B, { u: 'https://user:pw@example.com/' })],
    groups: [{ items: ['course', 'course', 'grades', 'link:cccccccccccc', `link:${A}`, 'w:radio', 'w:pet', 'profile'] }, { items: ['course', 'w:pet', 'calendar'] }],
    hidden: ['grades'],
    icons: { course: 'rocket', calendar: 'star', 'link:cccccccccccc': 'star', nope: 'star' },
  });
  assert.deepEqual(nav.links.map((l) => l.id), [A]);
  assert.deepEqual(nav.groups, [{ items: ['course', `link:${A}`, 'w:pet', 'profile'] }, { items: ['calendar'] }]);
  assert.deepEqual(nav.icons, { calendar: 'star' });
  assert.deepEqual(L.clean(nav), nav);
});

test('resolve draws groups in order, then what no group names, and leaves out what this site lacks', () => {
  const nav = L.clean({ groups: [{ label: 'Study', items: ['course', 'w:clock', `link:${A}`] }, { label: 'Admin', items: ['admin'] }, { label: 'Me', items: ['messages', 'profile'] }], hidden: ['stream'], links: [link(A), link(B)], icons: { profile: 'star' } });
  const seq = L.resolve(nav, ['profile', 'stream', 'course', 'calendar', 'messages', 'glaze']);
  assert.deepEqual(seq.map((e) => e.key), ['g:0', 'course', 'w:clock', `link:${A}`, 'g:2', 'messages', 'profile', 'calendar', 'glaze', `link:${B}`]);
  assert.deepEqual(seq.find((e) => e.key === 'g:0'), { key: 'g:0', kind: 'label', label: 'Study' });
  assert.equal(seq.find((e) => e.key === 'profile').icon, 'star');
  assert.equal(seq.find((e) => e.key === 'w:clock').kind, 'widget');
  assert.ok(!seq.some((e) => e.key === 'stream' || e.key === 'g:1'), 'hidden items and labels of empty groups stay out');
  assert.deepEqual(L.resolve(L.clean({ place: 'top' }), ['course', 'glaze']).map((e) => e.key), ['course', 'glaze'], 'no groups: the page\'s own order');
});

test('the rail model: a layout\'s links open in the page, with their icons, and widgets only where a group puts them', () => {
  const nav = L.clean({ groups: [{ items: ['w:timer', 'w:next'] }], links: [link(A)], icons: { [`link:${A}`]: 'globe' }, hidden: ['grades'] });
  assert.deepEqual(L.rail(nav), { links: [{ ...link(A), i: 'globe', tab: false }], order: [], hidden: ['grades'], widgets: [{ id: 'next', on: true, at: 'inline' }, { id: 'timer', on: true, at: 'inline' }] });
  assert.deepEqual(L.rail(L.clean({ place: 'dock' })), { links: [], order: [], hidden: [], widgets: [] });
});

test('each site\'s native items get the shared names', () => {
  assert.deepEqual(['global_nav_profile_link', 'global_nav_dashboard_link', 'global_nav_courses_link', 'global_nav_conversations_link', 'global_nav_accounts_link', 'global_nav_help_link', 'global_nav_lti_link', 'primaryNavToggle', ''].map(L.canvas),
    ['profile', 'dashboard', 'course', 'messages', 'admin', 'help', '', '', '']);
  assert.deepEqual(['http://m.test/my/', '/my/index.php', '/my/courses.php', '/?redirect=0', '/moodle/?redirect=0', '/moodle/', '/mod/forum/index.php', '/admin/search.php', '#', '', null].map(L.moodle),
    ['dashboard', 'dashboard', 'course', 'home', 'home', '', '', 'admin', '', '', '']);
  for (const id of [...Object.values({ a: L.canvas('global_nav_courses_link'), b: L.moodle('/my/') })]) assert.ok(L.NATIVE.includes(id));
});
