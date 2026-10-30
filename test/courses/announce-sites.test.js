// The LMSs' own announcement lists opening in Glaze's pop-up: lib/announce.js find() (which link is an announcement, and
// what the page shows of it) against each site's markup, the routes that load features/announce.js on those pages, and
// its click and hover hooks in a VM with the stand-in DOM (a plain click taken before the site hears it; modifiers, the
// site's page chosen, an unreadable link and Glaze switched off left alone).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const D = require('../defaults.js');
const A = require('../lib/announce.js');
const { El } = require('./stand-in-dom.js');
const { parse } = require('./fixture-dom.js');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const settle = async (n = 8) => { for (let i = 0; i < n; i++) await new Promise(setImmediate); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
// (The stand-in parser keeps attributes as written: &amp; is decoded here, as a browser does.)
const page = (html) => { const doc = { activeElement: null }; doc.createElement = (t) => new El(t, doc); doc.root = new El('#document', doc); doc.body = parse(html.replaceAll('&amp;', '&'), doc); return doc; };
const fixture = (f) => page(read(`test/fixtures/${f}`));
const UB = 'https://bb.school.test', CV = 'https://ann.school.instructure.com', MD = 'https://moodle.school.test';
const pick = (h) => h && { ...h.ref };

test('Ultra: a course\'s Announcements (Ultra\'s own markup: href="#", the id in the link\'s id) and the course from the address', () => {
  const doc = fixture('announce-ultra-lists.html');
  const [first, second] = doc.body.querySelectorAll('announcement-list a.list-item-title');
  const h = A.find('ultra', first, UB, '/ultra/courses/_101_1/announcements');
  assert.equal(h.link, first);
  assert.deepEqual(pick(h), { site: 'ultra', entry: 'ultra', courseId: '_101_1', id: '_7001_1', url: `${UB}/ultra/stream/announcement-detail?courseId=_101_1&announcementId=_7001_1`,
    title: 'Lab moved to room 2', text: 'This week\'s lab is in room 2 of the Science Building. Bring your lab coat and goggles.' });
  assert.equal(A.find('ultra', second, UB, '/ultra/courses/_101_1/announcements').ref.id, '_7002_1');
  // Observed title nesting; the rest of the row is not clickable.
  assert.equal(A.find('ultra', first, UB, '/ultra/courses/_101_1/announcements/').link, first);
  assert.equal(first.getAttribute('href'), '#');
  assert.ok(first.closest('tr.announcement-item-row td.announcement-header-column[role="gridcell"] .announcement-header .click-message-detail .announcement-title-detail'));
  assert.ok(second.closest('tr.announcement-item-row.is-read'));
  for (const el of [first.closest('.announcement-title-detail'), first.closest('.announcement-header'), first.closest('td'), first.closest('tr')]) {
    assert.ok(el);
    assert.equal(A.find('ultra', el, UB, '/ultra/courses/_101_1/announcements'), null);
  }
  assert.equal(A.find('ultra', doc.body.querySelector('.list-item-body'), UB, '/ultra/courses/_101_1/announcements'), null);
  // Without the course in the address its ids can't be read: Ultra's own click.
  assert.equal(A.find('ultra', first, UB, '/ultra/stream'), null);
  first.id = 'list-item-title-7001';
  assert.equal(A.find('ultra', first, UB, '/ultra/courses/_101_1/announcements'), null);
});

test('Ultra: an Activity Stream announcement and a course tab\'s link to announcement-detail; other stream items stay Ultra\'s', () => {
  const doc = fixture('announce-ultra-lists.html');
  const s = A.find('ultra', doc.body.querySelector('#stream-announcement .name a'), UB, '/ultra/stream');
  assert.deepEqual(pick(s), { site: 'ultra', entry: 'ultra', courseId: '_101_1', id: '_7001_1', url: `${UB}/ultra/stream/announcement-detail?courseId=_101_1&announcementId=_7001_1`,
    title: 'Lab moved to room 2' });
  for (const id of ['stream-discussion', 'stream-content', 'stream-grade']) {
    const a = doc.body.querySelector(`#${id} a.js-title-link[analytics-id="stream.entry.title"]`);
    assert.ok(a);
    assert.equal(A.find('ultra', a.querySelector('span'), UB, '/ultra/stream'), null, id);
  }
  for (const a of doc.body.querySelectorAll('[analytics-id="stream.entry.course"]')) assert.equal(A.find('ultra', a, UB, '/ultra/stream'), null);
  // test/fixtures/ultra-course.html's Announcements tool, as a course tab's frame shows it.
  const tool = read('test/fixtures/ultra-course.html').match(/<announcement-list>.*?<\/announcement-list>/)[0].replaceAll('${c.id}', '_102_1');
  const tab = page(`<body>${tool}</body>`);
  const t = A.find('ultra', tab.body.querySelector('a'), UB, '/ultra/courses/_102_1/announcements');
  assert.equal(t.ref.courseId, '_102_1');
  assert.equal(t.ref.id, '_7001_1');
  assert.equal(t.ref.title, 'Week 7');
  // Another site's address, or ids of the wrong shape: not one.
  for (const href of ['https://evil.example/ultra/stream/announcement-detail?courseId=_1_1&announcementId=_2_1', '/ultra/stream/announcement-detail?courseId=1&announcementId=_2_1',
    '/ultra/stream/announcement-detail?courseId=_1_1', '/ultra/stream/announcement-details?courseId=_1_1&announcementId=_2_1']) {
    const x = page(`<body><div id="activity-stream"><div class="name"><a href="${href}">X</a></div></div></body>`);
    assert.equal(A.find('ultra', x.body.querySelector('a'), UB, '/ultra/stream'), null, href);
  }
});

test('Canvas: a course\'s Announcements (the local Canvas\'s rendered page): the title link, not Reply; the unread mark kept out of the title', () => {
  const doc = fixture('canvas-announcements.html');
  const O = 'http://localhost:3000';
  const links = doc.body.querySelectorAll('.ic-announcement-row a.ic-item-row__content-link');
  const h = A.find('canvas', links[0], O, '/courses/25/announcements');
  assert.deepEqual(pick(h), { site: 'canvas', entry: 'canvas', courseId: '25', id: '55', url: `${O}/courses/25/discussion_topics/55`, title: 'Lab moved to room 214 this week',
    author: 'Avery Chen', text: 'Lab moved to room 214 this week. Details are on the course page.' });
  assert.equal(A.find('canvas', links[1], O, '/courses/25/announcements'), null, 'Reply stays Canvas\'s');
  const unread = A.find('canvas', links[2], O, '/courses/25/announcements');
  assert.equal(unread.ref.id, '56');
  assert.equal(unread.ref.title, 'Unit 1 grades are posted');
  assert.equal(A.find('canvas', links[0], 'https://other.instructure.com', '/courses/25/announcements'), null, 'another origin\'s link');
  assert.equal(A.find('moodle', links[0], O, '/courses/25/announcements'), null, 'another site\'s markup');
});

test('Canvas: Recent Activity\'s announcements and the dashboard widget\'s; discussions, groups and Ignore stay Canvas\'s', () => {
  const doc = fixture('announce-canvas-lists.html');
  const [ann, group] = doc.body.querySelectorAll('.stream-announcement a.content_summary');
  assert.deepEqual(pick(A.find('canvas', ann, CV, '/')), { site: 'canvas', entry: 'canvas', courseId: '25', id: '7', url: `${CV}/courses/25/announcements/7`,
    title: 'Lab moved to room 2 this week', course: 'BIO 1100 · Cell Biology' });
  assert.equal(A.find('canvas', ann.querySelector('.fake-link'), CV, '/').link, ann);
  assert.equal(A.find('canvas', group, CV, '/'), null);
  assert.equal(A.find('canvas', doc.body.querySelector('.stream-discussion_topic a.content_summary'), CV, '/'), null);
  assert.equal(A.find('canvas', doc.body.querySelector('.stream-announcement .ignore-item'), CV, '/'), null);
  const more = doc.body.querySelector('[data-testid="announcement-item-10"] a');
  assert.deepEqual(pick(A.find('canvas', more, CV, '/')), { site: 'canvas', entry: 'canvas', courseId: '25', id: '10', url: `${CV}/courses/25/discussion_topics/10`,
    title: 'Exam seating plan', course: 'BIO 1100 · Cell Biology' });
  assert.equal(A.find('canvas', doc.body.querySelector('[data-testid="mark-read-10"]'), CV, '/'), null);
});

test('Moodle: the news forum\'s discussion list and the Latest announcements block, with what the page shows (no fetch for a preview)', () => {
  const html = read('test/fixtures/announce-moodle-lists.html');
  const doc = page(html);
  const row = doc.body.querySelector('[data-region="discussion-list-item"] th.topic a');
  assert.deepEqual(pick(A.find('moodle', row, MD, '/mod/forum/view.php')), { site: 'moodle', entry: 'moodle', courseId: '16', id: '12', url: `${MD}/mod/forum/discuss.php?d=12`,
    title: 'Lab moved to room 2', author: 'Ana Rivera', at: Date.parse('2026-10-21T13:55:00+00:00') });
  assert.equal(A.find('moodle', doc.body.querySelector('a[href*="parent=31"]'), MD, '/mod/forum/view.php'), null, 'the latest reply stays Moodle\'s');
  const block = doc.body.querySelectorAll('[data-block="news_items"] .info a');
  assert.deepEqual(pick(A.find('moodle', block[1], MD, '/course/view.php')), { site: 'moodle', entry: 'moodle', courseId: '16', id: '13', url: `${MD}/mod/forum/discuss.php?d=13`,
    title: 'Exam seating plan', author: 'Ana Rivera' });
  assert.equal(A.find('moodle', doc.body.querySelector('.newlink a'), MD, '/course/view.php'), null);
  // Another forum's discussion list is not the Announcements forum.
  const other = page(html.replace('forumtype-news course-16', 'forumtype-general course-16'));
  assert.equal(A.find('moodle', other.body.querySelector('th.topic a'), MD, '/mod/forum/view.php'), null);
  // Moodle under a path, and a discussion link elsewhere on the page.
  const sub = page(html.replaceAll('/mod/forum/discuss.php', '/moodle/mod/forum/discuss.php'));
  assert.equal(A.find('moodle', sub.body.querySelector('th.topic a'), MD, '/moodle/mod/forum/view.php').ref.url, `${MD}/moodle/mod/forum/discuss.php?d=12`);
  const loose = page('<body class="course-16"><a href="/mod/forum/discuss.php?d=4">A discussion</a></body>');
  assert.equal(A.find('moodle', loose.body.querySelector('a'), MD, '/course/view.php'), null);
});

// features/routes.js: the pages that load features/announce.js.
test('routes: features/announce.js loads on the pages with a site\'s own announcement list, and nowhere else', async () => {
  const where = async (site, pathname, search = '') => {
    const loaded = [];
    const ctx = vm.createContext({ GZ_CTX: { site, need: async (f) => { loaded.push(f); ctx.GZ_ANNOUNCE = ctx.GZ_ANNOUNCE_READ = ctx.GZ_STICKY_FOLD = { sync() {} }; } }, location: { pathname, search }, Set, Promise });
    ctx.globalThis = ctx;
    vm.runInContext(read('features/routes.js'), ctx);
    ctx.GZ_ROUTES.sync(); await settle();
    assert.equal(loaded.includes('features/announce-read.js'), site === 'ultra' && /^\/ultra\/courses\/_\d+_\d+\/announcements\/?$/.test(pathname));
    return loaded.includes('features/announce.js');
  };
  for (const [site, p, s] of [['ultra', '/ultra/stream'], ['ultra', '/ultra/courses/_101_1/announcements'], ['canvas', '/'], ['canvas', '/courses/25'],
    ['canvas', '/courses/25/announcements'], ['canvas', '/courses/25/discussion_topics', '?only_announcements=true'], ['moodle', '/course/view.php', '?id=16'],
    ['moodle', '/moodle/mod/forum/view.php', '?id=40']]) assert.equal(await where(site, p, s), true, `${site} ${p}${s || ''}`);
  for (const [site, p, s] of [['ultra', '/ultra/courses/_101_1/outline'], ['ultra', '/ultra/course'], ['canvas', '/courses/25/assignments'], ['canvas', '/courses/25/discussion_topics'],
    ['canvas', '/ultra/stream'], ['moodle', '/mod/assign/view.php', '?id=3'], ['moodle', '/courses/25/announcements']]) assert.equal(await where(site, p, s), false, `${site} ${p}${s || ''}`);
});

// features/announce.js's hooks on a site's page, in a VM.
const hooked = ({ site = 'canvas', origin = CV, pathname = '/', html, announce = {}, on = true, slow = false, selection = null } = {}) => {
  const doc = page(html);
  doc.documentElement = new El('html', doc);
  const asked = [], assigned = [], win = [], needed = [];
  const settings = D.GZ_SANITIZE({ announce, popup: { anim: 'none' } });
  settings.announce = { ...settings.announce, delay: 10 };
  let release = () => {};
  const gate = slow ? new Promise((r) => { release = r; }) : Promise.resolve();
  const ctx = vm.createContext({
    GZ_CTX: { site, on: () => on, t: (k, v) => k.replace(/\{(\w+)\}/g, (_, n) => v?.[n] ?? ''), locale: () => 'en', settings: () => settings,
      need: (f) => { needed.push(f); return f === 'lib/popup.js' || f === 'lib/announce.js' ? Promise.resolve() : gate; }, courseList: () => ({}),
      moodleIn: async () => ({ session: () => ({ root: origin, sesskey: 'sk' }) }) },
    GZ_I18N: require('../lib/i18n.js'), GZ_POPUP_LIB: require('../lib/popup.js'), GZ_ANNOUNCE_LIB: A, GZ_NOTES: require('../lib/notes.js'), GZ_DOCTEXT: require('../lib/doctext.js'),
    GZ_LMSQ: { fetch: (url, init = {}) => { asked.push(`${init.method || 'GET'} ${url}`); return Promise.resolve({ ok: true, status: 200, text: async () => JSON.stringify({ title: 'Lab moved', message: '<p>Room 2.</p>', read_state: 'read' }) }); } },
    getSelection: () => selection, document: doc, location: { origin, pathname, href: `${origin}${pathname}`, assign: (u) => assigned.push(u) },
    matchMedia: () => ({ matches: true }), innerWidth: 1440, innerHeight: 900,
    addEventListener: (type, f, o) => win.push({ type, f, capture: o === true || !!o?.capture }), removeEventListener: (type, f) => { const i = win.findIndex((x) => x.type === type && x.f === f); if (i >= 0) win.splice(i, 1); },
    URL, AbortController, Promise, JSON, Date, Intl, Map, Set, WeakMap, setTimeout, clearTimeout, console,
  });
  ctx.globalThis = ctx;
  vm.runInContext(read('features/popup.js'), ctx);
  vm.runInContext(read('features/announce.js'), ctx);
  // An event as the browser sends it to the window first (capture), with what the page's own handlers would see.
  const fire = (type, target, o = {}) => {
    const e = { type, target, isTrusted: true, button: 0, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, defaultPrevented: false, stopped: false, ...o };
    e.preventDefault = () => { e.defaultPrevented = true; };
    e.stopPropagation = () => { e.stopped = true; };
    for (const l of win.filter((x) => x.type === type && x.capture)) l.f(e);
    return e;
  };
  const popup = () => doc.body.children.find((c) => c.id === 'gz-popup') || null;
  const tip = () => doc.body.children.find((c) => c.id === 'gz-ann-tip')?.shadowForTest.querySelector('.tip') || null;
  return { doc, ctx, A: ctx.GZ_ANNOUNCE, asked, assigned, win, needed, fire, popup, tip, release };
};
const canvasPage = (o) => hooked({ html: read('test/fixtures/announce-canvas-lists.html'), ...o });

test('hooks: a plain click opens the pop-up before the site hears it; modifiers, a middle click and untrusted clicks stay the site\'s', async () => {
  const p = canvasPage();
  p.A.sync(); await settle();
  const a = p.doc.body.querySelector('.stream-announcement a.content_summary');
  for (const o of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }, { isTrusted: false }]) {
    const e = p.fire('click', a, o);
    assert.equal(e.defaultPrevented || e.stopped, false, JSON.stringify(o));
  }
  assert.equal(p.popup(), null);
  const e = p.fire('click', a.querySelector('.fake-link'));
  assert.ok(e.defaultPrevented && e.stopped, 'taken: no navigation, the page\'s own handlers never hear it');
  await settle();
  assert.ok(p.popup(), 'the pop-up is open');
  assert.deepEqual(p.asked, [`GET ${CV}/api/v1/courses/25/discussion_topics/7`]);
  assert.deepEqual(p.assigned, []);
});

test('hooks: the site\'s page chosen, an unreadable link, a page\'s other links and Glaze off leave the click alone', async () => {
  for (const announce of [{ canvas: 'site' }, { open: 'site' }]) {
    const p = canvasPage({ announce });
    p.A.sync(); await settle();
    const e = p.fire('click', p.doc.body.querySelector('.stream-announcement a.content_summary'));
    assert.equal(e.defaultPrevented || e.stopped, false, JSON.stringify(announce));
  }
  const p = canvasPage();
  p.A.sync(); await settle();
  for (const sel of ['a[href="/groups/4/announcements/12"]', '.stream-discussion_topic a.content_summary', '.ignore-item', '[data-testid="mark-read-10"]']) {
    const e = p.fire('click', p.doc.body.querySelector(sel));
    assert.equal(e.defaultPrevented || e.stopped, false, sel);
  }
  const off = canvasPage({ on: false });
  off.A.sync(); await settle();
  assert.equal(off.fire('click', off.doc.body.querySelector('.stream-announcement a.content_summary')).defaultPrevented, false, 'Glaze switched off');
  // Off the route, its listeners go.
  p.A.off();
  assert.equal(p.win.filter((x) => ['click', 'pointerover', 'focusin'].includes(x.type)).length, 0);
  assert.equal(p.fire('click', p.doc.body.querySelector('.stream-announcement a.content_summary')).defaultPrevented, false);
});

test('hooks: a click before the pop-up\'s files are in is taken, and opens once they are; the pop-up loads only on demand', async () => {
  const p = canvasPage({ slow: true });
  p.A.sync(); await settle();
  assert.equal(p.needed.includes('features/popup.js'), false, 'only the recogniser libraries load on the route');
  const e = p.fire('click', p.doc.body.querySelector('[data-testid="announcement-item-10"] a'));
  assert.ok(e.defaultPrevented && e.stopped);
  assert.equal(p.popup(), null);
  assert.ok(p.needed.includes('features/popup.js'), 'the first click requests the pop-up');
  assert.equal(p.A.ready, p.A.ready, 'existing callers share the same ready promise');
  p.release(); await settle();
  assert.ok(p.popup());
  assert.deepEqual(p.asked, [`GET ${CV}/api/v1/courses/25/discussion_topics/10`]);
});

test('hooks: hover attaches the preview (its delay, then one GET); a Moodle preview shows the page\'s words and asks nothing', async () => {
  const p = canvasPage();
  p.A.sync(); await settle();
  const a = p.doc.body.querySelector('.stream-announcement a.content_summary');
  a.box = { left: 100, top: 40, width: 160, height: 20 };
  a.matches = (s) => s === ':hover' || require('./stand-in-dom.js').matches(a, s);
  p.fire('pointerover', a, { pointerType: 'mouse' }); await settle();
  assert.deepEqual(p.asked, []);
  await wait(30); await settle();
  assert.equal(p.tip()?.hidden, false, 'shown after the delay');
  assert.deepEqual(p.asked, [`GET ${CV}/api/v1/courses/25/discussion_topics/7`]);
  const m = hooked({ site: 'moodle', origin: MD, pathname: '/mod/forum/view.php', html: read('test/fixtures/announce-moodle-lists.html') });
  m.A.sync(); await settle();
  const link = m.doc.body.querySelector('th.topic a');
  link.box = { left: 100, top: 40, width: 160, height: 20 };
  link.matches = (s) => s === ':hover' || require('./stand-in-dom.js').matches(link, s);
  m.fire('pointerover', link, { pointerType: 'mouse' });
  await wait(30); await settle();
  const tip = m.tip();
  assert.equal(tip?.hidden, false);
  assert.match(tip.textContent, /Lab moved to room 2/);
  assert.match(tip.textContent, /Ana Rivera/);
  assert.deepEqual(m.asked, [], 'a Moodle preview never asks (its answer would mark it read)');
  // The per-entry preview switch.
  const quiet = canvasPage({ announce: { canvasPreview: false } });
  quiet.A.sync(); await settle();
  const b = quiet.doc.body.querySelector('.stream-announcement a.content_summary');
  b.box = { left: 100, top: 40, width: 160, height: 20 };
  b.matches = (s) => s === ':hover' || require('./stand-in-dom.js').matches(b, s);
  quiet.fire('pointerover', b, { pointerType: 'mouse' });
  await wait(30); await settle();
  assert.equal(quiet.tip(), null);
  assert.deepEqual(quiet.asked, []);
});

test('hooks: a link the site redraws for another announcement previews that one', async () => {
  const p = canvasPage();
  p.A.sync(); await settle();
  const a = p.doc.body.querySelector('.stream-announcement a.content_summary');
  a.box = { left: 100, top: 40, width: 160, height: 20 };
  a.matches = (s) => s === ':hover' || require('./stand-in-dom.js').matches(a, s);
  p.fire('pointerover', a, { pointerType: 'mouse' });
  await wait(30); await settle();
  a.setAttribute('href', '/courses/25/announcements/10');
  p.fire('pointerover', a, { pointerType: 'mouse' });
  await wait(30); await settle();
  assert.deepEqual(p.asked, [`GET ${CV}/api/v1/courses/25/discussion_topics/7`, `GET ${CV}/api/v1/courses/25/discussion_topics/10`]);
});


test('find: controls nested in announcement links keep their own action on every site', () => {
  const cases = [
    ['ultra', UB, '/ultra/stream', '<a href="/ultra/stream/announcement-detail?courseId=_101_1&announcementId=_7001_1">Title {control}</a>'],
    ['canvas', CV, '/', '<div class="stream-announcement"><a class="content_summary" href="/courses/25/announcements/7">Title {control}</a></div>'],
    ['moodle', MD, '/course/view.php', '<div data-block="news_items"><div class="post"><div class="info"><a href="/mod/forum/discuss.php?d=12">Title {control}</a></div></div></div>'],
  ];
  for (const [site, origin, pathname, html] of cases) for (const control of ['<button><span>Pin</span></button>', '<span role="button"><span>Mark read</span></span>', '<input type="checkbox">', '<span contenteditable="true"><span>Edit</span></span>']) {
    const doc = page(`<body>${html.replace('{control}', control)}</body>`);
    const a = doc.body.querySelector('a'), target = a.querySelector('button, [role="button"], input, [contenteditable="true"]');
    assert.ok(A.find(site, a, origin, pathname), `${site}: the title still opens`);
    assert.ok(A.find(site, target.querySelector('span') || target, origin, pathname) === null, `${site}: ${control}`);
  }
});

test('Ultra: unreadable or foreign title URLs stay with the site even with a list-item id', () => {
  const doc = fixture('announce-ultra-lists.html');
  const a = doc.body.querySelector('announcement-list a.list-item-title');
  for (const href of ['https://elsewhere.example/', 'javascript:void(0)', 'http://[']) {
    a.setAttribute('href', href);
    assert.ok(A.find('ultra', a, UB, '/ultra/courses/_101_1/announcements') === null, href);
  }
});

test('hooks: selecting text in a link leaves the mouse click alone, while keyboard Enter still opens', async () => {
  for (const loaded of [false, true]) {
    const p = canvasPage({ selection: { isCollapsed: false } });
    p.A.sync(); await settle();
    if (loaded) await p.A.ready;
    const a = p.doc.body.querySelector('.stream-announcement a.content_summary');
    const drag = p.fire('click', a, { detail: 1 });
    assert.equal(drag.defaultPrevented || drag.stopped, false, `selection with popup ${loaded ? 'loaded' : 'unloaded'}`);
    assert.deepEqual(p.asked, []);
    const enter = p.fire('click', a, { detail: 0 });
    assert.ok(enter.defaultPrevented && enter.stopped, 'Enter is a trusted keyboard click');
    await settle();
    assert.ok(p.popup());
  }
});


test('Ultra: a course title id does not turn a discussion, content or grade destination into an announcement', () => {
  const doc = fixture('announce-ultra-lists.html');
  const title = doc.body.querySelector('announcement-list a.list-item-title');
  for (const id of ['stream-discussion', 'stream-content', 'stream-grade']) {
    const href = doc.body.querySelector(`#${id} a.js-title-link`).getAttribute('href');
    title.setAttribute('href', href);
    assert.ok(A.find('ultra', title, UB, '/ultra/courses/_101_1/announcements') === null, href);
  }
});

test('Ultra hooks: observed stream title and course links keep their native click', async () => {
  const p = hooked({ site: 'ultra', origin: UB, pathname: '/ultra/stream', html: read('test/fixtures/announce-ultra-lists.html') });
  p.A.sync(); await p.A.ready;
  for (const id of ['stream-discussion', 'stream-content', 'stream-grade']) {
    const a = p.doc.body.querySelector(`#${id} a.js-title-link`);
    const e = p.fire('click', a.querySelector('span'));
    assert.equal(e.defaultPrevented || e.stopped, false, id);
  }
  for (const a of p.doc.body.querySelectorAll('[analytics-id="stream.entry.course"]')) {
    const e = p.fire('click', a);
    assert.equal(e.defaultPrevented || e.stopped, false);
  }
  assert.equal(p.popup(), null);
  assert.deepEqual(p.asked, []);
});

test('Ultra hooks: the observed href="#" title captures Enter safely, including before the pop-up loads', async () => {
  for (const slow of [false, true]) {
    const p = hooked({ site: 'ultra', origin: UB, pathname: '/ultra/courses/_101_1/announcements', html: read('test/fixtures/announce-ultra-lists.html'), slow });
    p.ctx.GZ_ULTRA = { read: () => ({ get: async () => ({ title: 'Lab moved to room 2', body: '<p>Room 2.</p>' }) }) };
    p.A.sync(); await settle();
    if (!slow) await p.A.ready;
    const a = p.doc.body.querySelector('announcement-list a.list-item-title');
    for (const o of [{ isTrusted: false }, { metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }]) {
      const e = p.fire('click', a, o);
      assert.equal(e.defaultPrevented || e.stopped, false);
    }
    const e = p.fire('click', a, { detail: 0 });
    assert.ok(e.defaultPrevented && e.stopped, 'no hash navigation or native panel');
    if (slow) { assert.equal(p.popup(), null); p.release(); }
    await settle();
    assert.ok(p.popup());
    assert.deepEqual(p.assigned, []);
    assert.equal(p.ctx.location.href, `${UB}/ultra/courses/_101_1/announcements`);
  }
});
