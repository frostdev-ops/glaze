// Canvas uses the same tab list, frame manager and settings as Ultra. Only its routes, identity and header differ.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const L = require('../lib/coursetabs.js');
const source = fs.readFileSync(path.join(__dirname, '../features/coursetabs.js'), 'utf8');
const part = (a, b) => source.slice(source.indexOf(a), source.indexOf(b, source.indexOf(a)));
const origin = 'https://school.instructure.com';

test('Canvas course places preserve subpages and queries, with exact numeric course boundaries', () => {
  for (const p of ['/courses/12', '/courses/12/', '/courses/12/modules', '/courses/12/pages/introduction', '/courses/12/pages/caf%C3%A9', '/courses/12/pages/first%20reading', '/courses/12/quizzes/8/take', '/courses/12/assignments/7/submissions/42']) {
    assert.equal(L.safe(p), p);
    assert.equal(L.target({ cid: '12', path: p + '?module_item_id=99' }), p + '?module_item_id=99');
    assert.equal(L.target({ cid: '12', path: p }, false), '/courses/12');
  }
  for (const p of ['/courses/123/modules', '/courses/12evil', '/courses/12/../13', '/courses/12/./modules', '/courses/12//modules', '/courses/12/%2e%2e/13', '/courses/12/pages/unsafe%2fpath', '/courses/12/pages/unsafe%5cpath', '/courses/12/pages/unsafe%252fpath', '/courses/12/pages/%00', '/courses/12/pages/%GG', '/courses/12/pages/has space', '/ultra/courses/_12_1/outline', 'https://other.test/courses/12']) {
    assert.equal(L.target({ cid: '12', path: p }), '/courses/12', p);
  }
  assert.deepEqual(L.placeOf('/courses/12/pages/has space'), { path: '/courses/12', exact: false });
  assert.equal(L.safe('/courses/12evil'), null);
  assert.equal(L.validId('12', 'canvas'), true);
  assert.equal(L.validId('_12_1', 'canvas'), false);
  assert.equal(L.validId('12', 'ultra'), false);
  assert.equal(L.validId(12), false);
  assert.deepEqual(L.clean([{ cid: '12' }, { cid: '_12_1' }], 'canvas').map((t) => t.cid), ['12']);
  assert.deepEqual(L.clean([{ cid: '12' }, { cid: '_12_1' }], 'ultra').map((t) => t.cid), ['_12_1']);
});

test('Canvas tab lists sanitize places and use site/account keys without collisions', () => {
  const tabs = L.clean([{ cid: '12', path: '/courses/123/grades', top: 90 }, { cid: '13', path: '/courses/13/pages/notes?view=1', top: 220, pin: true }, { cid: '12' }]);
  assert.deepEqual(tabs.map((t) => [t.cid, t.path, t.top]), [['13', '/courses/13/pages/notes?view=1', 220], ['12', '/courses/12', 0]]);
  assert.ok(L.KEY.test(L.storeKey(origin, '42')));
  assert.ok(L.KEY.test(L.storeKey('http://localhost:3000', '42')));
  assert.notEqual(L.storeKey(origin, '42'), L.storeKey('https://another.instructure.com', '42'));
  assert.notEqual(L.storeKey(origin, '42'), L.storeKey(origin, '43'));
  assert.equal(L.KEY.test(L.storeKey('http://school.test', '42')), false);
});

test('Canvas maps its existing host-scoped course list and cached profile into the shared manager', async () => {
  const all = { [`canvas:${origin}/12`]: { name: 'Biology', code: 'BIO 1100', color: '#123456' }, 'canvas:https://another.test/12': { name: 'Other school' }, _1_1: { name: 'Ultra' } };
  const ctx = vm.runInNewContext('(() => { ' + part('  const base = ', '  const { t }') + '\nreturn ctx; })()', {
    GZ_CTABS_LIB: L, globalThis: { GZ_CTABS_LIB: L, GZ_CTX: { site: 'canvas', courseList: () => all, canvasCourseId: () => '12', profile: async () => ({ id: 42 }) } }, location: { origin },
  });
  assert.equal(ctx.courseId(), '12');
  assert.equal(await ctx.me(), '42');
  assert.deepEqual(Object.keys(ctx.courseList()), ['12']);
  assert.equal(ctx.courseList()['12'].color, '#123456');
});

test('Canvas strip wraps above or below the single breadcrumb row, also outside a course', () => {
  for (const at of ['above', 'between', 'below']) {
    const calls = [], bar = { prepend: (e) => calls.push(['before', e]), append: (e) => calls.push(['after', e]) }, strip = {};
    const home = vm.runInNewContext(part('  const home = ', '  let clearHeader = ') + '\nhome;', {
      here: () => undefined, loaded: true, tabs: [{}], ctx: { site: 'canvas' }, P: () => ({ at }), at: () => at, courseBar: () => bar, strip,
      document: { getElementById: () => null }, spot: (at, ok, put, clear) => ({ at, ok, put, clear }),
    });
    const result = home(); result.put();
    assert.equal(calls[0][0], at === 'above' ? 'before' : 'after');
    assert.equal(result.clear, bar);
  }
});

test('Canvas numeric frame names receive the full theme bootstrap; other frame names do not', () => {
  const core = fs.readFileSync(path.join(__dirname, '../content.js'), 'utf8');
  const block = core.slice(core.indexOf('  const tabFrame = '), core.indexOf('  const solo = '));
  for (const [name, expected] of [['gz-ctab:12', '12'], ['gz-ctab:_12_1', '_12_1'], ['gz-ctab:12evil', ''], ['course_12', ''], ['gz-ctab:12/grades', '']]) {
    assert.equal(vm.runInNewContext(block + '\ntabFrame;', { window: { name, top: {} } }), expected);
  }
});

test('closing the surrounding Canvas course preserves another course’s edited live document', () => {
  const routes = [], shown = [], drops = [];
  const context = vm.createContext({
    ctx: { site: 'canvas', courseId: () => '12' }, closedCourse: '', framed: '', showing: '', here: () => '12', L,
    tabs: [{ cid: '12' }, { cid: '13' }], frames: new Map([['13', { dirty: true }]]), snaps: new Map(), preview: false,
    send() {}, save() {}, draw() {}, flag() {}, route: (url) => routes.push(url), visit: (cid) => shown.push(cid), drop: (cid) => drops.push(cid),
  });
  const shut = vm.runInContext(part('  const shut = ', '  const pinTab = ') + '\nshut;', context);
  shut('12');
  assert.equal(context.closedCourse, '12');
  assert.deepEqual(routes, []);
  assert.deepEqual(shown, ['13']);
  assert.deepEqual(drops, ['12']);
  context.showing = '13'; shut('13');
  assert.deepEqual(routes, ['/courses'], 'closing the last retained frame returns to the native courses page');
});

test('Canvas frame commands require an owned same-origin frame and numeric IDs', () => {
  let listen; const mine = {}, actions = [];
  vm.runInNewContext(part("  if (!framed && !preview) addEventListener('message'", '  if (framed && !preview) {'), {
    L, ctx: { site: 'canvas' }, framed: '', preview: false, on: true, location: { origin }, spare: new Map(), next: new Map(),
    addEventListener: (event, fn) => { listen = fn; }, frames: new Map([['12', { el: { contentWindow: mine } }]]),
    visit: (cid) => actions.push(cid),
  });
  const send = (cid, from = mine, site = origin) => listen({ source: from, origin: site, data: { gzCtab: 'visit', cid } });
  send('12', {}, origin); send('12', mine, 'https://other.test'); send('_12_1'); send('12evil');
  assert.deepEqual(actions, []);
  send('12'); assert.deepEqual(actions, ['12']);
});


test('the shared strip stylesheet is shipped and available to both Canvas and Ultra', () => {
  const manifest = require('../manifest.json');
  assert.ok(manifest.web_accessible_resources.some((r) => r.resources.includes('features/coursetabs.css')));
  const core = fs.readFileSync(path.join(__dirname, '../content.js'), 'utf8');
  assert.match(core, /moodle \? \[\] : \['features\/apps.css', 'features\/coursetabs.css'\]/);
});


test('Ultra’s provisional sheets keep their order in the shared core’s complete stylesheet list', () => {
  const core = fs.readFileSync(path.join(__dirname, '../content.js'), 'utf8');
  const ultra = fs.readFileSync(path.join(__dirname, '../content-ultra.js'), 'utf8');
  const line = core.split('\n').find((s) => s.includes('const SHEETS = '));
  const sheets = vm.runInNewContext(line + '\nSHEETS;', { ultra: true, moodle: false, site: 'ultra' });
  const early = vm.runInNewContext(ultra.match(/GZ_SITE_ULTRA\.sheets = (\[[^\n]+?\])\.map/)[1]);
  assert.deepEqual(Array.from(sheets.slice(0, early.length)), Array.from(early), 'connected early sheets are reused by index and must not displace the course-tab stylesheet');
});

test('Canvas links open in a frame instead of reloading the page; in a frame, its own pages are turned to by the page around', () => {
  const run = (framed, frameCount, here = '', at = '/courses/5') => {
    const opened = [], pages = [], sent = [];
    const toFrame = vm.runInNewContext(part('  const toFrame = ', '  // A course page in its course') + '\ntoFrame;', {
      L, framed, PAGE: 'page', showing: '', here: () => here, frames: { size: frameCount }, location: { origin, pathname: at, search: '' }, openAt: (cid, url) => opened.push([cid, url]), openPage: (url) => pages.push(url), toTop: (op, m) => sent.push([op, m.url]),
    });
    const click = (href, more = {}) => {
      const u = new URL(href, origin);
      const a = { localName: 'a', origin: u.origin, pathname: u.pathname, search: u.search, hash: u.hash, target: more.target || '', hasAttribute: (k) => k === 'download' && !!more.download };
      let stopped = false;
      const e = { button: more.button || 0, ctrlKey: !!more.ctrl, metaKey: false, shiftKey: false, altKey: false, defaultPrevented: false, preventDefault() { stopped = true; }, stopPropagation() {} };
      return [toFrame(e, a), stopped];
    };
    return { click, opened, pages, sent };
  };
  const page = run('', 1, '5');
  assert.deepEqual(page.click('/courses/12/assignments?x=1'), [true, true]);
  assert.deepEqual(page.opened, [['12', '/courses/12/assignments?x=1']]);
  assert.deepEqual(page.click('/calendar?view=month'), [true, true]);
  assert.deepEqual(page.pages, ['/calendar?view=month'], 'a page outside a course goes to the page frame: the course frames keep running');
  for (const [href, more] of [['/courses/12/modules', { ctrl: true }], ['/courses/12/modules', { button: 1 }], ['/courses/12/modules', { target: '_blank' }],
    ['/courses/12/files/5/download?download_frd=1', {}], ['/courses/12/modules', { download: true }], ['/courses/12/modules#unit', {}], ['/logout', {}], ['/login/canvas', {}], ['/api/v1/courses', {}], ['https://other.test/courses/12', {}]]) {
    assert.deepEqual(page.click(href, more), [false, false], `${href} ${JSON.stringify(more)} goes as the browser takes it`);
  }
  const course = run('', 0, '5');
  assert.deepEqual(course.click('/courses/5/modules'), [true, true], 'no frame yet on a course page: its own pages open in its frame, this page stays live under it');
  assert.deepEqual(course.click('/calendar'), [true, true]);
  assert.deepEqual(course.click('/courses/5'), [false, false], 'this very page again reloads, as it would');
  assert.deepEqual([course.opened, course.pages], [[['5', '/courses/5/modules']], ['/calendar']]);
  const dash = run('', 0, '', '/');
  assert.deepEqual(dash.click('/courses/12'), [true, true], 'from the Dashboard a course opens in its frame: the Dashboard stays');
  assert.deepEqual(dash.opened, [['12', '/courses/12']]);
  assert.deepEqual(dash.click('/calendar'), [true, true], 'another page outside a course goes to the page frame');
  const frame = run('12', 0, '12', '/courses/12/assignments');
  assert.deepEqual(frame.click('/courses/12/modules'), [true, true], 'its own course: turned to by the page around, this page kept');
  assert.deepEqual(frame.click('/courses/12/assignments'), [false, false], 'its own page again reloads in place');
  assert.deepEqual(frame.click('/courses/13/pages/notes'), [true, true]);
  assert.deepEqual(frame.click('/conversations'), [true, true]);
  assert.deepEqual(frame.click('/logout'), [false, false]);
  assert.deepEqual(frame.sent, [['go', '/courses/12/modules'], ['open', '/courses/13/pages/notes'], ['open', '/conversations']], 'another course and a page outside one go to the page around it');
  const pageFrame = run('page', 0, '', '/calendar');
  assert.deepEqual(pageFrame.click('/conversations'), [true, true], 'the page frame turns to its own pages through the page around');
  assert.deepEqual(pageFrame.click('/calendar'), [false, false]);
  assert.deepEqual(pageFrame.click('/courses/12'), [true, true]);
  assert.deepEqual(pageFrame.sent, [['go', '/conversations'], ['open', '/courses/12']], 'a course from the page frame goes to its own frame');
});

test('the navigation bar reads the shown course frame and opens addresses in it, else on the page', () => {
  const run = (site, showing, frames, here = '5') => {
    const calls = [];
    const bar = vm.runInNewContext(part('  const pageable = ', '  // A course page in its course') + part('  const bar = {', '  return { sync') + '\nbar;', {
      L, on: true, framed: '', signedOut: false, showing, frames, location: { origin }, URL, ctx: { site }, tabs: [], here: () => here,
      openAt: (cid, url) => calls.push(['frame', cid, url]), openPage: (url) => calls.push(['pageframe', url]), show: (c) => calls.push(['show', c]), route: (u) => calls.push(['page', u]),
      rowsOf: () => [], visit() {}, shut() {}, pinTab() {}, moveTab() {}, flag() {}, place() {},
    });
    return { bar, calls };
  };
  const doc = { location: { origin } }, assigned = [];
  const frame = { el: { contentDocument: doc, contentWindow: { location: { assign: (u) => assigned.push(u) } } } };
  let { bar, calls } = run('canvas', '12', new Map([['12', frame]]));
  assert.equal(bar.doc(), doc);
  bar.open('/courses/13/modules?x=1'); bar.open(`${origin}/courses/12/grades`); bar.open('/calendar'); bar.open('/calendar#today'); bar.open('https://evil.test/courses/12');
  assert.deepEqual(calls, [['frame', '13', '/courses/13/modules?x=1'], ['frame', '12', '/courses/12/grades'], ['pageframe', '/calendar'], ['show', ''], ['page', '/calendar#today']]);
  ({ bar, calls } = run('canvas', '', new Map([['12', frame]])));
  bar.open('/courses/13/modules'); bar.open('/conversations');
  assert.deepEqual(calls, [['frame', '13', '/courses/13/modules'], ['pageframe', '/conversations']], 'a frame running, though not on screen: still no reload');
  ({ bar, calls } = run('canvas', '', new Map()));
  assert.equal(bar.doc(), null, 'no frame on screen: no document');
  bar.open('/courses/13/modules');
  assert.deepEqual(calls, [['frame', '13', '/courses/13/modules']], 'no frame yet, on a course page: still in a frame, this page never reloads');
  ({ bar, calls } = run('canvas', '', new Map(), ''));
  bar.open('/courses/13/modules');
  assert.deepEqual(calls, [['frame', '13', '/courses/13/modules']], 'from a page outside a course, a course opens in its frame');
  ({ bar, calls } = run('ultra', '_2_1', new Map([['_2_1', frame]])));
  bar.open('/ultra/courses/_2_1/grades');
  assert.deepEqual(assigned, [`${origin}/ultra/courses/_2_1/grades`], "Ultra: the shown course's own page in its frame");
  bar.open('/ultra/courses/_3_1/outline');
  assert.deepEqual(calls, [['show', ''], ['page', '/ultra/courses/_3_1/outline']]);
});
