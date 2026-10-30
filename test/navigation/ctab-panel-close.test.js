// Ultra opens some panels of a course under another page (an announcement at /ultra/stream/announcement-detail?courseId=…)
// and, closing one, goes to that page (/ultra/stream). In a course tab's frame that close returns to where the tab was;
// a real move away still takes the page around it there.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const source = fs.readFileSync(path.join(process.env.EXT || path.join(__dirname, '..'), 'features/coursetabs.js'), 'utf8');
const part = (a, b) => source.slice(source.indexOf(a), source.indexOf(b, source.indexOf(a)));
const origin = 'https://bb.test';

// A frame of course _2_1 walking through addresses as Ultra's router would take it (pass on each).
const frame = (framed = '_2_1') => {
  const sent = [], routed = [];
  const location = { origin, pathname: '', search: '', hash: '' };
  const at = (url) => { const u = new URL(url, origin); Object.assign(location, { pathname: u.pathname, search: u.search, href: u.href }); };
  class Element { closest() { return this; } getAttribute() { return ''; } }
  const button = new Element(); button.closest = (s) => s === 'a[href], button, [role="button"], [role="link"]' ? button : null;
  const c = vm.createContext({
    Element,
    on: true, framed, PAGE: 'page', preview: false, ctx: { site: 'ultra', courseId: () => '_2_1' }, location, URL, URLSearchParams, awayFrom: '',
    here: () => location.pathname.match(/\/ultra\/courses\/(_\d+_\d+)\//)?.[1], observeView() {}, showing: '', frames: new Map(), loaded: false,
    last: '', lastPath: '', restored: true, flag() {}, place() {}, draw() {}, lay() {}, later() {}, moved() {},
    toTop: (op, m) => sent.push([op, m.url]),
    history: { replaceState: (s, t, url) => { routed.push(['replace', url]); at(url); }, pushState: (s, t, url) => { routed.push(['push', url]); at(url); } },
    PopStateEvent: class { constructor(type) { this.type = type; } },
    dispatchEvent: (e) => { routed.push([e.type]); c.pass(); },
  });
  c.pass = vm.runInContext(part('  const pass = ', '  const sync = ') + '\npass;', c);
  const go = (url) => { at(url); c.pass(); };
  const leave = vm.runInContext(part('  const onLeave = ', '  // ---- live tabs') + '\nonLeave;', c);
  return { go, sent, routed, location, at, close: () => leave({ type: 'click', isTrusted: true, target: button }),
    escape: () => leave({ type: 'keydown', key: 'Escape', isTrusted: true, target: new Element() }) };
};
const COURSE = '/ultra/courses/_2_1/announcements', ANN = '/ultra/stream/announcement-detail?courseId=_2_1&announcementId=_5_1';

test('closing an announcement opened in a course tab returns the tab to the course page it was on', () => {
  const f = frame();
  f.go(COURSE); f.go(ANN); f.go('/ultra/stream');
  assert.deepEqual(f.sent, [], 'the window stays where it is');
  assert.deepEqual(f.routed, [['replace', origin + COURSE], ['popstate']], 'Ultra\'s router takes the frame back, in place of the stream');
  assert.equal(f.location.pathname + f.location.search, COURSE);
});

test('a second panel opened from the first, closed, still returns to the course page', () => {
  const f = frame();
  f.go('/ultra/courses/_2_1/outline'); f.go(COURSE); f.go(ANN);
  f.go('/ultra/stream/announcement-detail?courseId=_2_1&announcementId=_6_1');
  f.go('/ultra/stream');
  assert.deepEqual(f.sent, []);
  assert.deepEqual(f.routed, [['replace', origin + COURSE], ['popstate']]);
});

test('Back from a panel to the course, then a move to the stream, is a real move away', () => {
  const f = frame();
  f.go(COURSE); f.go(ANN); f.go(COURSE); f.go('/ultra/stream');
  assert.deepEqual(f.sent, [['away', '/ultra/stream']]);
  assert.deepEqual(f.routed, []);
});

test('Back and Forward over a panel keep the frame in its course', () => {
  const f = frame();
  f.go(COURSE); f.go(ANN); f.go(COURSE); f.go(ANN); f.go('/ultra/stream');
  assert.deepEqual(f.sent, []);
  assert.deepEqual(f.routed, [['replace', origin + COURSE], ['popstate']]);
});

test('from a panel, a page it was not opened under, or another course\'s, is a real move away', () => {
  for (const to of ['/ultra/calendar', '/ultra/stream?courseId=_3_1', '/ultra/courses/_3_1/outline', '/ultra/streams', '/webapps/blackboard/execute/launcher']) {
    const f = frame();
    f.go(COURSE); f.go(ANN); f.go(to);
    assert.deepEqual(f.sent, [['away', to]], to);
    assert.deepEqual(f.routed, [], to);
  }
});

test('a course page moving to the stream, with no panel open, still goes to the top', () => {
  const f = frame();
  f.go(COURSE); f.go('/ultra/stream');
  assert.deepEqual(f.sent, [['away', '/ultra/stream']]);
});

test('a frame that came in on the panel itself closes to its course', () => {
  const f = frame();
  f.go(ANN); f.go('/ultra/stream');
  assert.deepEqual(f.sent, []);
  assert.deepEqual(f.routed, [['replace', origin + '/ultra/courses/_2_1/outline'], ['popstate']]);
});

test('closing before the next scan still remembers the panel', () => {
  const f = frame();
  f.go(COURSE); f.at(ANN); f.close(); f.go('/ultra/stream');
  assert.deepEqual(f.sent, [], 'a fast close must not eject the course tab');
  assert.equal(f.location.pathname, COURSE);
});

test('a panel under Calendar closes to its course without a prior scan', () => {
  const f = frame();
  f.go(COURSE); f.at('/ultra/calendar/event-detail?course_id=_2_1'); f.close(); f.go('/ultra/calendar');
  assert.deepEqual(f.sent, []);
  assert.equal(f.location.pathname, COURSE);
});

test('leaving a panel for the Ultra root is a real move away', () => {
  const f = frame();
  f.go(COURSE); f.go(ANN); f.go('/ultra');
  assert.deepEqual(f.sent, [['away', '/ultra']]);
});

test('Escape before the next scan remembers the panel even with focus outside its close button', () => {
  const f = frame();
  f.go(COURSE); f.at(ANN); f.escape(); f.go('/ultra/stream');
  assert.deepEqual(f.sent, [], 'a fast keyboard close must not eject the course tab');
  assert.equal(f.location.pathname, COURSE);
});
