// B8b: all values invented. GZ_B8_REPO permits the same behavioral witnesses against the pre-change archive.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = process.env.GZ_B8_REPO || path.join(__dirname, '..');
const L = require(path.join(root, 'lib/coursetabs.js'));
const source = fs.readFileSync(path.join(root, 'features/coursetabs.js'), 'utf8');
const C = '/ultra/courses/_71_1', documentPath = `${C}/document/_81_1`, overview = `${C}/assessment/_82_1/overview`;
const part = (a, b) => source.slice(source.indexOf(a), source.indexOf(b, source.indexOf(a)));

test('routed documents and assignments are kept exactly, query and all', () => {
  assert.equal(L.safe(documentPath, '?view=content&state=view&parentId=_83_1&launch=1'), `${documentPath}?view=content&state=view&parentId=_83_1&launch=1`);
  assert.equal(L.safe(overview, '?courseId=_71_1'), `${overview}?courseId=_71_1`);
  const kept = L.clean([{ cid: '_71_1', path: `${overview}?courseId=_71_1`, top: 610 }])[0];
  assert.deepEqual([kept.path, kept.top], [`${overview}?courseId=_71_1`, 610]);
  assert.equal(L.target(kept), kept.path);
  assert.equal(L.target({ ...kept, cid: '_72_1' }), '/ultra/courses/_72_1/outline', 'never another course\'s page');
});

test('remembering an assignment rubric panel keeps its assignment, including when cleaning an older saved tab', () => {
  const query = '?columnId=_83_1&courseId=_71_1&view=content&return_to=%2Fultra%2Fstream';
  for (const parent of [`${C}/assessment/_82_1/overview`, `${C}/assessment/_82_1/attempt`, `${C}/assessment/_82_1/attempt/create`,
    `${C}/assessment/_82_1/attempt/_84_1`, `${C}/outline/assessment/_82_1/attempt/create`]) {
    for (const tail of ['/rubric-view', '/rubric-view/']) {
      const panel = parent + tail, expected = parent + query;
      assert.equal(L.safe(panel, query), panel + query, 'an explicit rubric destination stays valid');
      assert.deepEqual(L.placeOf(panel, query), { path: expected, exact: false }, 'capture remembers the assignment beneath its panel');
      assert.equal(L.target({ cid: '_71_1', path: panel + query }), expected, 'restore closes only the transient panel');
      const kept = L.clean([{ cid: '_71_1', path: panel + query, top: 610 }], 'ultra')[0];
      assert.equal(kept.path, expected, 'an older stored panel is repaired before a frame opens');
      assert.equal(kept.top, 0, 'the panel scroll does not belong to the assignment');
    }
  }
});

test('a rubric captured on first render cannot reopen after a URL-only panel close', () => {
  const parent = `${C}/assessment/_82_1/attempt/create`, panel = `${parent}/rubric-view`;
  const location = { pathname: panel, search: '?courseId=_71_1' }, tab = { cid: '_71_1', path: parent, top: 0 };
  // Closing Ultra's panel can keep the assignment's existing main/content nodes.
  const nodes = [{}, {}, {}];
  const api = vm.runInNewContext(part('  const sameView = ', '  const readyView = ')
    + part('  let liveView = ', '  // A panel over the bar') + part('  const notePlace = ', '  const onScroll = ')
    + '\n({observeView,notePlace});', {
    view: () => nodes, readyView: () => true, location, safePath: (p, q) => L.safe(p, q), showing: '', tabs: [tab], L, save() {},
  });
  api.observeView(); api.notePlace('_71_1');
  location.pathname = parent;
  api.observeView(); api.notePlace('_71_1');
  assert.equal(tab.path, parent + location.search, 'the saved location never includes the rubric panel');
  assert.equal(L.target(tab), parent + location.search, 'reloading the surrounding page restores the assignment alone');
});

test('remembered ordinary destinations and their queries retain their exact spelling', () => {
  const query = '?columnId=_83_1&view=content&return_to=%2Fultra%2Fstream&view=all';
  for (const [cid, pathname] of [['_71_1', documentPath], ['_71_1', overview], ['_71_1', `${C}/document/rubric-view`],
    ['_71_1', `${C}/discussion/_82_1/rubric-view`], ['12', '/courses/12/pages/rubric-view']]) {
    const expected = pathname + query;
    assert.deepEqual(L.placeOf(pathname, query), { path: expected, exact: true });
    assert.equal(L.target({ cid, path: expected }), expected);
    assert.equal(L.clean([{ cid, path: expected, top: 610 }])[0].top, 610);
  }
});

test('an assignment overview without a main counts its routed body as the content', () => {
  const routedMain = vm.runInNewContext(part('  const routedMain = ', '  // A URL or header change') + '\nroutedMain;', {});
  const body = { id: 'body' }, main = { id: 'main' };
  const page = (hasMain) => ({ querySelector: (sel) => (sel.includes('main') ? (hasMain ? main : null) : sel === '.routed-page-body' ? body : null) });
  assert.equal(routedMain(page(true)), main);
  assert.equal(routedMain(page(false)), body, 'section.assessment-overview-modern-panel > learning-module-panel-view.routed-page-body');
  assert.equal(routedMain(null), null);
});

test('the strip goes before/after the full routed header without moving native content', () => {
  for (const at of ['above', 'between', 'below']) {
    const strip = {}, hd = {}, page = { firstElementChild: hd };
    let put = '';
    hd.before = (s) => { assert.equal(s, strip); put = 'before'; };
    hd.after = (s) => { assert.equal(s, strip); put = 'after'; };
    const home = vm.runInNewContext(part('  const home = ', '  const place = ') + '\nhome;', {
      ctx: { site: 'ultra' }, go: null, strip, P: () => ({ at }), courseBar: () => null, topLayer: () => null, shown: () => false,
      here: () => '_71_1', routed: () => page, routedHeader: () => hd, loaded: true, tabs: [{}],
      spot: (at, ok, put) => ({ at, ok, put }),
    });
    const place = home(); assert.ok(place, at); assert.equal(place.at, 'routed'); place.put();
    assert.equal(put, at === 'above' ? 'before' : 'after');
  }
});

test('on a routed page the strip sits above its breadcrumb row, also when the item is a panel under that row', () => {
  // A routed discussion: content-page-header (the breadcrumbs) and, under it, the discussion in a panel whose own header
  // is its title. The strip goes before the breadcrumb row, as on a routed document, not between it and the title.
  for (const at of ['above', 'below']) {
    const strip = {}, crumbs = { tag: 'crumbs' }, title = { tag: 'title' };
    const layer = { querySelector: () => title, contains: (e) => e === title, firstElementChild: title };
    const page = { contains: (e) => e === layer || e === crumbs || e === title, firstElementChild: crumbs,
      querySelector: (sel) => (sel.startsWith('content-page-header') ? crumbs : sel.includes('h1') ? null : title) };
    let put = '';
    for (const e of [crumbs, title]) { e.before = () => { put = `before ${e.tag}`; }; e.after = () => { put = `after ${e.tag}`; }; }
    const home = vm.runInNewContext(part('  const crumbsOf = ', '  // A URL or header change') + part('  const home = ', '  const place = ') + '\nhome;', {
      ctx: { site: 'ultra' }, strip, P: () => ({ at }), courseBar: () => null, topLayer: () => layer, shown: () => false,
      here: () => '_71_1', routed: () => page, loaded: true, tabs: [{}], spot: (at, ok, put) => ({ at, ok, put }),
    });
    const place = home(); assert.equal(place.at, 'routed', at); place.put();
    assert.equal(put, at === 'above' ? 'before crumbs' : 'after crumbs');
  }
  // A panel opened over a course (no routed page around it) keeps its place at the panel's header.
  const strip = {}, title = { before() {}, after() {} }, layer = { querySelector: () => title, contains: () => true, firstElementChild: title };
  const home = vm.runInNewContext(part('  const crumbsOf = ', '  // A URL or header change') + part('  const home = ', '  const place = ') + '\nhome;', {
    ctx: { site: 'ultra' }, strip, P: () => ({ at: 'above' }), courseBar: () => null, topLayer: () => layer, shown: () => false,
    here: () => '_71_1', routed: () => null, loaded: true, tabs: [{}], spot: (at, ok, put) => ({ at, ok, put }),
  });
  assert.equal(home().at, 'nested');
});

test('a routed content scroller need not contain the strip to save its position', () => {
  const sc = { scrollTop: 610, contains: () => false }, tab = { cid: '_71_1' }; let saves = 0;
  vm.runInNewContext(part('  const onScroll = ', '  // ---- pictures') + '\nonScroll({target:sc});', {
    showing: '', framed: '', ctx: { courseId: () => '_71_1' }, document: {}, sc, Element: Object, strip: {}, tabs: [tab],
    location: { pathname: documentPath, search: '?view=content&state=view' }, L,
    pageScroller: () => sc, safePath: () => documentPath, observeView() {}, atView: () => true, notePlace() {}, save: () => saves++,
  });
  assert.equal(tab.top, 610); assert.equal(saves, 1);
});

test('routed scrollers use the nearest content overflow ancestor, then the document', () => {
  const block = part('  const scrollerOf = ', '  const scrollBack = ');
  const doc = { scrollingElement: {}, body: {} }, outer = { parentElement: doc.body, overflowY: 'auto' }, main = { parentElement: outer };
  const scrollerOf = vm.runInNewContext(block + '\nscrollerOf;', { document: doc, getComputedStyle: (e) => e });
  assert.equal(scrollerOf(main, true), outer, 'the ancestor owns scroll even before its content overflows');
  main.overflowY = 'scroll'; assert.equal(scrollerOf(main, true), main, 'the content main can own scrolling itself');
  main.overflowY = 'hidden'; assert.equal(scrollerOf(main, true), outer, 'hidden is not a scroll owner');
  main.overflowY = 'clip';
  outer.overflowY = 'visible'; assert.equal(scrollerOf(main, true), doc.scrollingElement);
});

test('Canvas discussion scroll is saved and restored in its nested drawer, not the course row or an editor', () => {
  const discussion = { scrollTop: 430 }, outer = { scrollTop: 0 }, strip = {}, editor = { scrollTop: 25 };
  let site = 'canvas', present = true;
  const pageScroller = vm.runInNewContext(part('  const pageScroller = ', '  let restored = ') + '\npageScroller;', {
    ctx: { get site() { return site; } }, strip,
    document: { getElementById: (id) => id === 'discussion-drawer-layout' && present ? discussion : null, activeElement: editor },
    routed: () => null, routedMain: () => null, scrollerOf: () => outer,
  });
  assert.equal(pageScroller(), discussion);
  const tab = { cid: '30', path: '/courses/30/discussion_topics/71', top: 0 };
  vm.runInNewContext(part('  const onScroll = ', '  // ---- pictures') + '\nonScroll({ target: discussion });', {
    showing: '', framed: '30', ctx: { courseId: () => '30' }, document: {}, tabs: [tab], discussion,
    pageScroller, safePath: () => tab.path, observeView() {}, atView: () => true, notePlace() {}, save() {},
  });
  assert.equal(tab.top, 430, 'the course tab keeps the discussion position');
  const timers = [], html = { setAttribute() {}, removeAttribute() {} };
  const scrollBack = vm.runInNewContext(part('  const scrollBack = ', '  // ---- closing, pinning, moving') + '\nscrollBack;', {
    location: { pathname: tab.path }, ctx: { on: () => true, acted: () => 0 }, html, Date, pageScroller,
    setTimeout: (fn) => timers.push(fn),
  });
  discussion.scrollTop = 0; scrollBack(tab.top);
  assert.equal(discussion.scrollTop, 430);
  assert.equal(editor.scrollTop, 25, 'restoration never scrolls the focused RCE document');
  assert.equal(outer.scrollTop, 0);
  present = false; assert.equal(pageScroller(), outer, 'other Canvas pages retain their native scroller');
  present = true; site = 'ultra'; assert.equal(pageScroller(), outer, 'the discussion drawer is Canvas only');
});

test('disabled tabs never scan native routes or place a strip from the mutation hook', () => {
  let scans = 0, writes = 0;
  const held = vm.runInNewContext(part('  const held = ', '  // The first paint') + '\nheld;', {
    on: false, strip: {}, bars: [], seenBar: null,
    courseBar: () => { scans++; return null; }, routed: () => { scans++; return null; }, place: () => writes++,
  });
  held(); assert.equal(scans, 0); assert.equal(writes, 0);
});
