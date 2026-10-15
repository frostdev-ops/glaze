// B8b review: the URL can lead native main replacement during links and Back/Forward. Values are invented.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = process.env.GZ_B8_REPO || path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'features/coursetabs.js'), 'utf8');
const L = require(path.join(root, 'lib/coursetabs.js'));
const part = (a, b) => source.slice(source.indexOf(a), source.indexOf(b, source.indexOf(a)));
const first = '/ultra/courses/_71_1/document/_81_1', next = '/ultra/courses/_71_1/document/_82_1';

function fixture() {
  let pathname = first, copies = 0, saves = 0;
  const page = { getBoundingClientRect: () => ({ top: 0, bottom: 600, left: 0, right: 800 }) };
  const oldMain = { childElementCount: 1, textContent: 'First reading' }, oldChild = {};
  let current = [page, oldMain, oldChild];
  const tab = { cid: '_71_1', path: first, top: 430 }, sc = { scrollTop: 0 };
  const api = vm.runInNewContext(part('  const sameView = ', '  // A panel over the bar')
    + part('  const notePlace = ', '  // ---- pictures')
    + '\n({observeView,notePlace,onScroll});', {
    view: () => current, routed: () => current?.[0], readyView: (v) => !!v?.[1]?.childElementCount,
    shown: (e) => !!e, loading: () => false, courseBar: () => null,
    location: { get pathname() { return pathname; }, search: '' },
    safePath: (p = pathname, q = '') => L.safe(p, q), assignment: () => false, L,
    ctx: { courseId: () => '_71_1', holding: () => false },
    showing: '', framed: '', moved() {}, later() {}, capTimer: 0, clearTimeout() {}, on: true, signedOut: false, tabs: [tab],
    save: () => saves++, say() {}, t: (s) => s, document: {}, pageScroller: () => sc,
    strip: null, layers: () => [page], copy: () => { copies++; return '<section>Reading</section>'; },
    chain: () => [], keep() {}, innerWidth: 800, innerHeight: 600,
  });
  api.observeView();
  return { api, tab, sc, page, oldMain, oldChild,
    url(p) { pathname = p; }, native(v) { current = v; }, counts: () => ({ copies, saves }) };
}

test('native route and Back preserve the old saved place and scroll until new main content arrives', () => {
  const f = fixture();
  f.url(next); f.api.observeView(); f.api.notePlace('_71_1'); f.api.onScroll({ target: f.sc });
  assert.equal(f.tab.path, first, 'the new URL cannot relabel outgoing main metadata');
  assert.equal(f.tab.top, 430, 'an outgoing scroll event cannot overwrite the remembered scroll');
  f.native([f.page, { childElementCount: 0, textContent: '', childNodes: [] }, null]);
  f.api.observeView(); f.api.notePlace('_71_1');
  assert.equal(f.tab.path, first, 'a temporarily empty main is not destination evidence');
  f.native([f.page, { childElementCount: 1, textContent: 'Second reading' }, {}]);
  f.api.observeView(); f.api.notePlace('_71_1'); f.sc.scrollTop = 520; f.api.onScroll({ target: f.sc });
  assert.equal(f.tab.path, next); assert.equal(f.tab.top, 520);
  f.url(first); f.api.observeView(); f.api.notePlace('_71_1'); f.sc.scrollTop = 0; f.api.onScroll({ target: f.sc });
  assert.equal(f.tab.path, next, 'Back cannot relabel the still-rendered second main');
  assert.equal(f.tab.top, 520);
  f.native([f.page, f.oldMain, f.oldChild]); f.api.observeView(); f.api.notePlace('_71_1');
  assert.equal(f.tab.path, first, 'a returned native main establishes the Back destination');
});

test('the first native scroll after main replacement records its proven path before the next core pass', () => {
  const f = fixture();
  f.url(next); f.native([f.page, { childElementCount: 1, textContent: 'Second reading' }, {}]);
  f.sc.scrollTop = 380; f.api.onScroll({ target: f.sc });
  assert.equal(f.tab.path, next, 'the populated changed native main can establish its own first scroll event');
  assert.equal(f.tab.top, 380);
});

test('appending a Glaze root cannot certify outgoing native main as replacement content', () => {
  const native = { id: 'native-reading' }, main = { lastElementChild: native }, page = {};
  const api = vm.runInNewContext(part('  const view = ', '  const readyView = ') + '\n({view,sameView});', {
    routed: () => page, routedMain: () => main,
  });
  const before = api.view();
  main.lastElementChild = { id: 'gz-fixture-owned', previousElementSibling: native };
  assert.equal(api.sameView(api.view(), before), true, 'owned UI cannot release the cached view or change capture provenance');
});

test('an emptied native main containing only a Glaze root cannot establish destination readiness', () => {
  const f = fixture();
  f.url(next);
  f.native([f.page, { childElementCount: 1, textContent: 'Helper UI', childNodes: [{ nodeType: 1, id: 'gz-owned', textContent: 'Helper UI' }] }, undefined]);
  f.api.observeView(); f.api.notePlace('_71_1'); f.sc.scrollTop = 0; f.api.onScroll({ target: f.sc });
  assert.equal(f.tab.path, first, 'owned-only content cannot relabel the previous native route');
  assert.equal(f.tab.top, 430);
  f.native([f.page, { childElementCount: 0, textContent: 'Native prose', childNodes: [{ nodeType: 3, textContent: 'Native prose' }] }, undefined]);
  f.api.observeView(); f.api.notePlace('_71_1');
  assert.equal(f.tab.path, next, 'native main text remains legitimate content without an element wrapper');
});

test('an invalidated extension never attempts a delayed storage or worker call', async () => {
  let calls = 0;
  const api = vm.runInNewContext(part('  const local = ', '  const readPrefs = ') + '\n({local,send});', {
    chrome: { runtime: { id: undefined, sendMessage: () => { calls++; return null; } }, storage: { local: {} } },
    preview: false, framed: '', who: '_41_1', epoch: 1, performance: { timeOrigin: 1 },
  });
  api.local(() => calls++); await api.send({ op: 'put' });
  assert.equal(calls, 0, 'the old module must not call either API after its runtime ID disappears');
});

test('routed header keep-clear moves and tears down without erasing a pre-existing marker', () => {
  const make = (initial) => ({ value: initial, writes: 0, hasAttribute() { return this.value !== undefined; },
    setAttribute(k, v) { this.writes++; this.value = v; }, removeAttribute() { this.writes++; this.value = undefined; } });
  const first = make(), next = make('existing');
  const keepClear = vm.runInNewContext(part('  let clearHeader = ', '  const place = ') + '\nkeepClear;');
  keepClear(first); assert.equal(first.value, '');
  keepClear(first); assert.equal(first.writes, 1, 'stable placement does not rewrite the native header');
  keepClear(next); assert.equal(first.value, undefined); assert.equal(next.value, 'existing');
  keepClear(null); assert.equal(next.value, 'existing', 'turning tabs off preserves another owner of the marker');
});
