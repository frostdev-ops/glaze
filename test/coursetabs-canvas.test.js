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
      here: () => undefined, loaded: true, tabs: [{}], ctx: { site: 'canvas' }, P: () => ({ at }), courseBar: () => bar, strip,
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
    L, ctx: { site: 'canvas' }, framed: '', preview: false, on: true, location: { origin },
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

test('with a course frame running, Canvas course links open in their course\'s frame instead of reloading the page', () => {
  const run = (framed, frameCount) => {
    const opened = [], sent = [];
    const toFrame = vm.runInNewContext(part('  const toFrame = ', '  // A course page in its course') + '\ntoFrame;', {
      L, framed, frames: { size: frameCount }, location: { origin }, openAt: (cid, url) => opened.push([cid, url]), toTop: (op, m) => sent.push([op, m.url]),
    });
    const click = (href, more = {}) => {
      const u = new URL(href, origin);
      const a = { localName: 'a', origin: u.origin, pathname: u.pathname, search: u.search, hash: u.hash, target: more.target || '', hasAttribute: (k) => k === 'download' && !!more.download };
      let stopped = false;
      const e = { button: more.button || 0, ctrlKey: !!more.ctrl, metaKey: false, shiftKey: false, altKey: false, defaultPrevented: false, preventDefault() { stopped = true; }, stopPropagation() {} };
      return [toFrame(e, a), stopped];
    };
    return { click, opened, sent };
  };
  const page = run('', 1);
  assert.deepEqual(page.click('/courses/12/assignments?x=1'), [true, true]);
  assert.deepEqual(page.opened, [['12', '/courses/12/assignments?x=1']]);
  for (const [href, more] of [['/courses/12/modules', { ctrl: true }], ['/courses/12/modules', { button: 1 }], ['/courses/12/modules', { target: '_blank' }],
    ['/courses/12/files/5/download?download_frd=1', {}], ['/courses/12/modules', { download: true }], ['/courses/12/modules#unit', {}], ['/calendar', {}], ['https://other.test/courses/12', {}]]) {
    assert.deepEqual(page.click(href, more), [false, false], `${href} ${JSON.stringify(more)} goes as the browser takes it`);
  }
  assert.deepEqual(run('', 0).click('/courses/12/modules'), [false, false], 'no frame to keep: the page loads as usual');
  const frame = run('12', 0);
  assert.deepEqual(frame.click('/courses/12/modules'), [false, false], 'its own course stays in its frame');
  assert.deepEqual(frame.click('/courses/13/pages/notes'), [true, true]);
  assert.deepEqual(frame.sent, [['open', '/courses/13/pages/notes']], 'another course goes to the page around it');
});
