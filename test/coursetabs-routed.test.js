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
      go: null, strip, P: () => ({ at }), courseBar: () => null, topLayer: () => null, shown: () => false,
      here: () => '_71_1', routed: () => page, routedHeader: () => hd, loaded: true, tabs: [{}],
      spot: (at, ok, put) => ({ at, ok, put }),
    });
    const place = home(); assert.ok(place, at); assert.equal(place.at, 'routed'); place.put();
    assert.equal(put, at === 'above' ? 'before' : 'after');
  }
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

test('disabled tabs never scan native routes or place a strip from the mutation hook', () => {
  let scans = 0, writes = 0;
  const held = vm.runInNewContext(part('  const held = ', '  // The first paint') + '\nheld;', {
    on: false, strip: {}, bars: [], seenBar: null,
    courseBar: () => { scans++; return null; }, routed: () => { scans++; return null; }, place: () => writes++,
  });
  held(); assert.equal(scans, 0); assert.equal(writes, 0);
});
