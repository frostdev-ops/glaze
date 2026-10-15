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
  vm.runInNewContext(part('  const onScroll = ', '  // ---- snapshots') + '\nonScroll({target:sc});', {
    go: null, ctx: { courseId: () => '_71_1' }, document: {}, sc, Element: Object, strip: {}, tabs: [tab],
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

test('a full routed switch waits for native content replacement, then settles without a course bar', () => {
  const old = {}, main = {}, next = {}, g = { cid: '_71_1', url: documentPath, at: 0, before: [old, main] }; let ended = 0, current = [old, main];
  const check = vm.runInNewContext(part('  const check = ', '  const end = ') + '\ncheck;', {
    go: g, performance: { now: () => 500 }, courseBar: () => null, shown: () => false,
    ctx: { on: () => true, courseId: () => '_71_1', holding: () => false }, view: () => current,
    sameView: (a, b) => a?.every((v, i) => v === b?.[i]), loading: () => false,
    readyView: () => true,
    document: {}, location: { pathname: documentPath }, end: () => ended++,
  });
  check(); assert.equal(ended, 0, 'a URL update with the old native shell cannot release the copy');
  current = [old, next]; check(); assert.equal(ended, 1, 'new settled native content can release it');
});

test('header-only and reused-header transitions cannot certify or capture the old main under the destination', () => {
  const helper = part('  const sameView = ', '  let liveView = ');
  const oldMain = { childElementCount: 1, textContent: 'Old reading' }, newMain = { childElementCount: 1, textContent: 'New reading' };
  let current = [{}, oldMain, {}, 'Old header'], pathname = `${C}/document/_81_1`, ended = 0;
  const go = { cid: '_71_1', at: 0, before: current };
  const api = vm.runInNewContext(helper + part('  let liveView = ', '  // A panel over the bar') + part('  const check = ', '  const end = ') + '\n({observeView, check, live:()=>liveView});', {
    view: () => current, location: { get pathname() { return pathname; }, search: '' }, shown: (e) => !!e, loading: () => false,
    go, courseBar: () => null, ctx: { on: () => true, courseId: () => '_71_1', holding: () => false }, performance: { now: () => 500 }, document: {}, end: () => ended++,
  });
  api.observeView(); const previous = api.live();
  pathname = `${C}/document/_86_1`;
  current = [current[0], oldMain, current[2], 'New header'];
  api.check(); assert.equal(ended, 0, 'a changed header cannot release outgoing native content');
  api.observeView(); assert.equal(api.live(), previous, 'a new root/header around old content cannot relabel capture provenance');
  current = [{}, null, null]; api.check(); assert.equal(ended, 0, 'a header appearing before main is not ready');
  api.observeView(); assert.equal(api.live(), previous);
  current = [{}, { childElementCount: 0, textContent: '', childNodes: [] }, null]; api.check(); assert.equal(ended, 0);
  api.observeView(); assert.equal(api.live(), previous);
  current = [{}, newMain, {}]; api.observeView(); assert.equal(api.live().path, pathname);
  api.check(); assert.equal(ended, 1);
});

test('disabled tabs never scan native routes or place a strip from the mutation hook', () => {
  let scans = 0, writes = 0;
  const held = vm.runInNewContext(part('  const held = ', '  // The first paint') + '\nheld;', {
    on: false, strip: {}, go: null, bars: [], seenBar: null,
    courseBar: () => { scans++; return null; }, routed: () => { scans++; return null; }, place: () => writes++,
  });
  held(); assert.equal(scans, 0); assert.equal(writes, 0);
});
