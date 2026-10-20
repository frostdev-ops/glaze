const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const vm = require('vm');
const L = require('../lib/coursetabs.js');

const source = fs.readFileSync(require.resolve('../features/coursetabs.js'), 'utf8');
const part = (a, b) => source.slice(source.indexOf(a), source.indexOf(b, source.indexOf(a)));
const origin = 'https://school.instructure.com';

const docAt = (path, o = {}) => {
  return {
    location: new URL(path, origin), readyState: o.ready || 'complete', body: {},
    documentElement: { matches: () => false }, querySelector: () => ({ childElementCount: 1 }), scrollingElement: { scrollTop: o.top || 0 },
    on: {}, addEventListener(ev, fn) { this.on[ev] = fn; }, removeEventListener(ev, fn) { if (this.on[ev] === fn) delete this.on[ev]; },
    media: o.media || [], frames: o.frames || [],
    querySelectorAll(sel) { return sel.startsWith('iframe') ? this.frames.filter((e) => !sel.includes('data-gz-rest') || e.hasAttribute('data-gz-rest')) : sel.startsWith('video') ? this.media : []; },
  };
};
const blank = () => ({ location: { origin, href: 'about:blank', pathname: 'blank', search: '' }, readyState: 'complete', body: {}, documentElement: { matches: () => false }, querySelector: () => null });

// The page around Canvas's frames, with one course frame (12) on screen at `at`.
function world({ at = '/courses/12/modules', showing = '12' } = {}) {
  let clock = 0, id = 0;
  const timers = new Map(), entries = [], calls = [];
  const els = [];
  const mkEl = (doc) => {
    const el = { style: { visibility: 'hidden' }, inert: true, contentDocument: doc, msgs: [], removed: false,
      contentWindow: { postMessage: (m) => el.msgs.push(m) }, remove() { el.removed = true; if (c.document.activeElement === el) c.document.activeElement = null; }, focus() { c.document.activeElement = el; } };
    els.push(el);
    return el;
  };
  const host = { turning: false, prepend() {}, toggleAttribute(k, v) { if (k === 'data-turning') host.turning = v; } };
  const first = { el: mkEl(docAt(at)), ready: true, at: 0, dirty: false };
  first.el.style.visibility = ''; first.el.inert = false;
  const history = { state: null, pushState(s) { entries.push(['push', s.gzTurn]); this.state = s; }, replaceState(s) { entries.push(['replace', s.gzTurn]); this.state = s; } };
  const c = vm.createContext({
    L, PAGE: 'page', ctx: { site: 'canvas' }, preview: false, framed: '', on: true, showing, host, history, location: { origin, pathname: '/', search: '' },
    frames: new Map([['12', first]]), tabs: [{ cid: '12', path: at, top: 40 }], document: { activeElement: first.el },
    performance: { now: () => clock }, setTimeout: (fn, ms) => { timers.set(++id, { fn, at: clock + (ms || 0) }); return id; }, clearTimeout: (i) => timers.delete(i),
    split: (url) => { const i = url.indexOf('?'); return i < 0 ? [url, ''] : [url.slice(0, i), url.slice(i + 1)]; },
    shown: (e) => !!e, loading: () => false, pageable: (path) => !/^\/(?:login|logout|api)(?:\/|$)/.test(path),
    frameEl: (cid, url) => Object.assign(mkEl(blank()), { name: `gz-ctab:${cid}`, src: origin + url }),
    save: () => calls.push(['save']), keepPage() {}, later() {}, showTurn: 0, waiting: '', wait: (cid) => calls.push(['wait', cid]), globalThis: {}, say: (s) => calls.push(['say', s]), t: (s) => s,
    show: (cid) => calls.push(['show', cid]), reveal: (cid) => calls.push(['reveal', cid]),
    openAt: (cid, url) => calls.push(['course', cid, url]), openPage: (url) => calls.push(['page', url]),
    load: (cid, f, url) => { calls.push(['load', cid, url]); return true; }, guardFrame() {}, watch: () => calls.push(['watch']),
  });
  vm.runInContext(part('  const canvasURL = ', '  // On the page itself') + part('  const KEEP = ', '  let showing = ') + part("  // ---- a frame's pages (Canvas)", '  // Canvas: a frame still loading')
    + part('  const dropNext = ', '  // Canvas loads a whole page'), c);
  // Time passes: due timers run, as many rounds as they reschedule.
  const wait = (ms) => {
    const end = clock + ms;
    for (;;) {
      const due = [...timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      timers.delete(due[0]);
      clock = Math.max(clock, due[1].at);
      due[1].fn();
    }
    clock = end;
  };
  const fn = (name) => vm.runInContext(name, c);
  // Back or Forward to an entry whose state is `s`.
  const pop = (s) => { history.state = s; fn('onPop')(); };
  return { c, first, els, host, entries, calls, timers, wait, fn, pop, latest: () => els.at(-1) };
}

test('a link in a frame: the next page loads hidden, the one on screen stays until it is drawn, then is kept', () => {
  const w = world();
  w.fn('turnTo')('12', '/courses/12/assignments');
  const g = w.fn('next').get('12');
  assert.ok(g?.go, 'a frame loads the page');
  assert.equal(w.c.frames.get('12'), w.first, 'the page on screen stays');
  assert.equal(w.host.turning, true, 'the loading line shows');
  w.wait(200);
  assert.equal(w.c.frames.get('12'), w.first, 'not drawn yet: nothing changes');
  g.el.contentDocument = docAt('/courses/12/assignments', { ready: 'interactive' });
  w.wait(40);
  assert.equal(w.c.frames.get('12'), g, 'drawn: it takes the frame\'s place');
  assert.equal(g.el.style.visibility, '');
  assert.equal(g.el.inert, false);
  assert.equal(w.first.el.style.visibility, 'hidden');
  assert.equal(w.first.el.inert, true);
  assert.deepEqual([...w.fn('spare').get('12')], [w.first], 'the page before is kept, live');
  assert.equal(w.first.el.removed, false);
  assert.equal(w.host.turning, false);
  assert.equal(w.c.document.activeElement, g.el, 'focus follows the page');
  assert.deepEqual(JSON.parse(JSON.stringify(w.entries)), [['replace', { cid: '12', url: '/courses/12/modules' }], ['push', { cid: '12', url: '/courses/12/assignments' }]], 'an entry for Back');
  assert.equal(w.c.tabs[0].path, '/courses/12/assignments');
  assert.equal(w.c.tabs[0].top, 0);
});

test('a kept page shows at once, then a fresh copy takes its place at the same scroll unless the student began using it', () => {
  for (const touched of [false, true]) {
    const w = world();
    w.fn('turnTo')('12', '/courses/12/assignments');
    const g = w.fn('next').get('12');
    g.el.contentDocument = docAt('/courses/12/assignments');
    w.wait(40);
    w.first.el.contentDocument.scrollingElement.scrollTop = 900;
    w.fn('turnTo')('12', '/courses/12/modules');
    assert.equal(w.c.frames.get('12'), w.first, 'Back to it (or a link): at once');
    assert.equal(w.first.el.style.visibility, '');
    assert.deepEqual([...w.fn('spare').get('12')], [g]);
    const r = w.fn('next').get('12');
    assert.ok(r?.refresh === w.first && !r.go, 'a fresh copy loads under it');
    if (touched) w.first.el.contentDocument.on.pointerdown();
    r.el.contentDocument = docAt('/courses/12/modules');
    w.wait(40);
    if (touched) {
      assert.equal(w.c.frames.get('12'), w.first, 'in use: it stays');
      assert.equal(r.el.removed, true);
    } else {
      assert.equal(w.c.frames.get('12'), r, 'the fresh copy takes its place');
      assert.equal(r.el.contentDocument.scrollingElement.scrollTop, 900, 'at the same scroll');
      assert.equal(w.first.el.removed, true, 'the stale copy goes, not kept');
      assert.deepEqual([...w.fn('spare').get('12')], [g]);
      assert.equal(w.entries.filter(([k]) => k === 'push').length, 2, 'a fresh copy is no new entry');
    }
  }
});

test('a fresh copy waits for its page to finish loading; a kept page with unsaved work is never reloaded under it', () => {
  const w = world();
  w.fn('turnTo')('12', '/courses/12/assignments');
  w.fn('next').get('12').el.contentDocument = docAt('/courses/12/assignments');
  w.wait(40);
  w.first.dirty = true;
  w.fn('turnTo')('12', '/courses/12/modules');
  assert.equal(w.c.frames.get('12'), w.first);
  assert.equal(w.fn('next').has('12'), false, 'unsaved work: no fresh copy');
  const w2 = world();
  w2.fn('turnTo')('12', '/courses/12/assignments');
  w2.fn('next').get('12').el.contentDocument = docAt('/courses/12/assignments');
  w2.wait(40);
  w2.fn('turnTo')('12', '/courses/12/modules');
  const r = w2.fn('next').get('12');
  r.el.contentDocument = docAt('/courses/12/modules', { ready: 'interactive' });
  w2.wait(500);
  assert.equal(w2.c.frames.get('12'), w2.first, 'still loading: the kept page stays');
  w2.wait(15000);
  assert.equal(w2.fn('next').has('12'), false, 'never finishing: let go of');
  assert.equal(r.el.removed, true);
});

test('a press loads the page ahead; the click shows that same page; a press never clicked is let go of', () => {
  const w = world();
  w.fn('turnTo')('12', '/courses/12/grades', true);
  const g = w.fn('next').get('12');
  assert.ok(g && !g.go, 'pressed: loading, not to show');
  assert.equal(w.host.turning, false, 'no loading line for a press');
  g.el.contentDocument = docAt('/courses/12/grades');
  w.wait(40);
  assert.equal(w.c.frames.get('12'), w.first, 'drawn, but not clicked: hidden');
  w.fn('turnTo')('12', '/courses/12/grades');
  assert.equal(w.c.frames.get('12'), g, 'the click: that page, at once');
  assert.equal(w.els.length, 2, 'loaded once');
  const w2 = world();
  w2.fn('turnTo')('12', '/courses/12/grades', true);
  const p = w2.fn('next').get('12');
  w2.wait(10000);
  assert.equal(w2.fn('next').has('12'), false);
  assert.equal(p.el.removed, true);
  const w3 = world();
  w3.fn('turnTo')('12', '/courses/12/grades', true);
  w3.fn('turnTo')('12', '/courses/12/people');
  assert.equal(w3.els[1].removed, true, 'a click elsewhere: the pressed page goes');
  assert.equal(w3.fn('next').get('12').url, '/courses/12/people');
});

test('kept pages: at most three a frame and eight in all, the least recently shown going first, never one with unsaved work', () => {
  const w = world();
  const turn = (path) => { w.fn('turnTo')('12', path); w.fn('next').get('12').el.contentDocument = docAt(path); w.wait(40); };
  w.first.dirty = true;
  for (const p of ['a', 'b', 'c', 'd', 'e']) turn(`/courses/12/pages/${p}`);
  const kept = w.fn('spare').get('12');
  assert.equal(kept.length, 3);
  assert.ok(kept.includes(w.first), 'unsaved work stays');
  assert.deepEqual([...kept.filter((f) => f !== w.first).map((f) => f.el.contentDocument.location.pathname)], ['/courses/12/pages/c', '/courses/12/pages/d']);
  const many = [];
  for (let i = 0; i < 12; i++) many.push([`${i}`, [{ el: { remove() { this.removed = true; } }, at: i, dirty: false }]]);
  w.fn('spare').clear();
  for (const [k, a] of many) w.fn('spare').set(k, a);
  w.fn('trim')();
  assert.equal([...w.fn('spare').values()].flat().length, 8);
  assert.deepEqual(many.slice(0, 4).map(([, [f]]) => f.el.removed), [true, true, true, true], 'the oldest go');
});

test('a page loading that lands outside its frame\'s course goes where a link to it goes; another site preserves the old document', () => {
  const w = world();
  w.fn('turnTo')('12', '/courses/12/modules/items/5');
  const g = w.fn('next').get('12');
  g.el.contentDocument = docAt('/courses/13/assignments/2');
  w.wait(40);
  assert.equal(g.el.removed, true);
  assert.equal(w.c.frames.get('12'), w.first);
  assert.deepEqual(w.calls.filter(([k]) => k === 'course'), [['course', '13', '/courses/13/assignments/2']]);
  const w2 = world();
  w2.first.dirty = true;
  w2.fn('turnTo')('12', '/courses/12/external_tools/4');
  w2.fn('next').get('12').el.contentDocument = null;
  w2.fn('next').get('12').loaded = true;
  w2.wait(40);
  assert.deepEqual(w2.calls.filter(([k]) => k === 'load'), [], 'an external redirect cannot reload the outgoing page');
  assert.equal(w2.c.frames.get('12'), w2.first);
});

test('a slow page shows as it loads, as the browser would show it', () => {
  const w = world();
  w.fn('turnTo')('12', '/courses/12/quizzes');
  const g = w.fn('next').get('12');
  g.el.contentDocument = docAt('/courses/12/quizzes', { ready: 'loading' });
  w.wait(7900);
  assert.equal(w.c.frames.get('12'), w.first);
  w.wait(200);
  assert.equal(w.c.frames.get('12'), g);
  assert.equal(g.ready, false, 'the timeout cannot certify a still-loading document');
  assert.ok(w.calls.some(([kind]) => kind === 'watch'), 'the slow page keeps its readiness watcher');
});

test('Back and Forward turn the frames from their entries, adding none, and come back to this page', () => {
  const w = world();
  w.fn('turnTo')('12', '/courses/12/assignments');
  w.fn('next').get('12').el.contentDocument = docAt('/courses/12/assignments');
  w.wait(40);
  const pushes = () => w.entries.filter(([k]) => k === 'push').length;
  const before = pushes();
  w.pop({ gzTurn: { cid: '12', url: '/courses/12/modules' } });
  assert.equal(w.c.frames.get('12'), w.first, 'Back: the page before, at once');
  assert.equal(pushes(), before);
  assert.deepEqual(w.calls.filter(([k]) => k === 'reveal'), [['reveal', '12']]);
  w.pop({ gzTurn: { cid: '', url: '/' } });
  assert.deepEqual(w.calls.at(-1), ['show', ''], 'to this page itself');
  w.c.frames.clear();
  w.pop({ gzTurn: { cid: '14', url: '/courses/14/grades' } });
  assert.deepEqual(w.calls.at(-1), ['course', '14', '/courses/14/grades'], 'a frame gone since: opened again');
  w.pop({ gzTurn: { cid: 'page', url: '/calendar' } });
  assert.deepEqual(w.calls.at(-1), ['page', '/calendar']);
  const n = w.calls.length;
  for (const s of [null, {}, { gzTurn: { cid: '1x', url: '/courses/1x' } }, { gzTurn: { cid: '12', url: 5 } }]) w.pop(s);
  assert.equal(w.calls.length, n, 'other entries are not Glaze\'s');
  assert.equal(w.fn('popping'), false);
});

test('Back while a page is on its way: it no longer shows', () => {
  const w = world();
  w.fn('turnTo')('12', '/courses/12/assignments');
  const g = w.fn('next').get('12');
  w.pop({ gzTurn: { cid: '', url: '/' } });
  assert.equal(g.el.removed, true);
  assert.equal(w.host.turning, false);
});

test('with the Navigation API, entries are known by key: the page’s own state is left as it set it, a stale read of it ignored', () => {
  const w = world();
  let key = 'k0', n = 0;
  w.c.globalThis.navigation = { get currentEntry() { return { key }; } };
  w.c.history.pushState = function (st) { w.entries.push(['push', st.gzTurn]); this.state = st; key = `k${++n}`; };
  w.c.history.state = { page: 'canvas' };
  w.fn('turnTo')('12', '/courses/12/assignments');
  w.fn('next').get('12').el.contentDocument = docAt('/courses/12/assignments');
  w.wait(40);
  assert.deepEqual(JSON.parse(JSON.stringify(w.entries)), [['push', { cid: '12', url: '/courses/12/assignments' }]], 'no replaceState of the page\'s own entry');
  // Back: the stale state this world reads says the newer entry; the key says the older one.
  key = 'k0';
  w.fn('onPop')();
  assert.equal(w.c.frames.get('12'), w.first);
  key = 'k1';
  w.fn('onPop')();
  assert.equal(w.fn('pathOf')(w.c.frames.get('12')), '/courses/12/assignments', 'Forward');
  key = 'unknown';
  const before = w.calls.length;
  w.fn('onPop')();
  assert.equal(w.calls.length, before, 'an entry not Glaze\'s: nothing, whatever the stale state says');
});

test('rapid clicks preserve the pending history destination with and without Navigation entry keys', () => {
  for (const keyed of [false, true]) {
    const w = world();
    let key = 'k0', n = 0;
    if (keyed) {
      w.c.globalThis.navigation = { get currentEntry() { return { key }; } };
      w.c.history.pushState = function (s) { this.state = s; w.entries.push(['push', s.gzTurn]); key = `k${++n}`; };
    }
    w.fn('turnTo')('12', '/courses/12/assignments');
    w.fn('turnTo')('12', '/courses/12/grades');
    if (keyed) { key = 'k1'; assert.equal(w.fn('turnHere')().url, '/courses/12/assignments'); }
    else assert.equal(w.entries.filter(([kind]) => kind === 'replace').length, 1, 'only the original entry needs initializing; the pending entry keeps its destination');
  }
});

test('clicking the outgoing page while another loads records the actual destination', () => {
  const w = world();
  w.fn('turnTo')('12', '/courses/12/assignments');
  w.fn('turnTo')('12', '/courses/12/modules');
  assert.equal(w.fn('next').size, 0);
  assert.equal(w.c.history.state.gzTurn.url, '/courses/12/modules');
});

test('dirty earlier pages cannot exceed either retention cap', () => {
  const w = world();
  for (let i = 0; i < 6; i++) {
    w.c.frames.get('12').dirty = true;
    w.fn('turnTo')('12', `/courses/12/pages/${i}`);
    const g = w.fn('next').get('12');
    if (g) { g.el.contentDocument = docAt(g.url); w.wait(40); }
    assert.ok((w.fn('spare').get('12') || []).length <= 3, 'refuse to leave a dirty page when its course cache is full');
  }
  const all = world();
  for (let i = 0; i < 8; i++) all.fn('spare').set(String(20 + i), [{ el: all.first.el, dirty: true, at: i }]);
  all.first.dirty = true;
  all.fn('turnTo')('12', '/courses/12/grades');
  assert.equal(all.fn('next').size, 0, 'the overall dirty-page cap is checked before loading or stamping');
  assert.equal(all.entries.length, 0);
});

test('canceling a pending page clears its poll timer and refresh interaction listeners', () => {
  const w = world();
  w.fn('turnTo')('12', '/courses/12/grades', true);
  w.fn('dropNext')('12');
  assert.equal(w.timers.size, 0, 'removing an iframe also removes its polling and expiration timers');
  w.fn('fresh')('12', w.first);
  assert.ok(w.first.el.contentDocument.on.pointerdown);
  w.fn('dropNext')('12');
  assert.deepEqual(Object.keys(w.first.el.contentDocument.on), [], 'canceling refresh removes every listener on the retained page');
});

test('refresh preserves iframe focus and horizontal scroll including negative RTL positions', () => {
  const w = world();
  w.first.el.contentDocument.scrollingElement.scrollLeft = -320;
  w.fn('fresh')('12', w.first);
  const g = w.fn('next').get('12');
  g.el.contentDocument = docAt('/courses/12/modules');
  w.wait(40);
  assert.equal(w.c.document.activeElement, g.el, 'focus is captured before removing the old iframe');
  assert.equal(g.el.contentDocument.scrollingElement.scrollLeft, -320);
  assert.deepEqual(Object.keys(w.first.el.contentDocument.on), []);
});

test('focus entering a restored page cancels background refresh', () => {
  const w = world();
  w.fn('fresh')('12', w.first);
  const g = w.fn('next').get('12');
  w.first.el.contentDocument.on.focusin?.();
  g.el.contentDocument = docAt('/courses/12/modules');
  w.wait(40);
  assert.equal(w.c.frames.get('12'), w.first, 'screen reader or programmatic focus must not be discarded by refresh');
});

test('a hidden course frame cannot preload or issue user navigation commands', () => {
  let listener;
  const w = world({ showing: '13' });
  Object.assign(w.c, { addEventListener: (ev, fn) => { listener = fn; }, visit: () => w.calls.push(['visit']), shut: () => w.calls.push(['shut']), pinTab: () => w.calls.push(['pin']), moveTab: () => w.calls.push(['move']) });
  vm.runInContext(part("  if (!framed && !preview) addEventListener('message'", '  // In a tab\'s frame on Ultra'), w.c);
  for (const op of ['warm', 'go', 'open', 'visit', 'shut', 'pin', 'move']) listener({ origin, source: w.first.el.contentWindow, data: { gzCtab: op, cid: '12', to: 1, url: '/courses/12/grades' } });
  assert.equal(w.fn('next').size, 0);
  assert.deepEqual(w.calls, []);
});

test('automatic course eviction protects unsaved work in earlier pages and pending pages', () => {
  for (const where of ['spare', 'next']) {
    const w = world({ showing: '14' });
    for (const cid of ['13', '14', '15']) w.c.frames.set(cid, { at: 10, dirty: true });
    w.fn(where).set('12', where === 'spare' ? [{ dirty: true }] : { dirty: true });
    let dropped = false;
    Object.assign(w.c, { LIVE: 4, drop: () => { dropped = true; } });
    const room = vm.runInContext(part('  const room = ', '  // A frame is shown once') + '\nroom;', w.c);
    assert.equal(room(), false);
    assert.equal(dropped, false);
  }
});

test('Back to the underlying Canvas course retains its live pages; Ultra still drops its duplicate', () => {
  for (const site of ['canvas', 'ultra']) {
    const w = world({ showing: '' });
    Object.assign(w.c, { ctx: { site }, loaded: false, waiting: '', last: '', lastPath: '', here: () => '12', observeView() {}, flag() {}, place() {}, draw() {}, lay() {}, drop: () => w.calls.push(['drop']) });
    vm.runInContext(part('  const pass = ', '  const sync = ') + '\npass();', w.c);
    assert.equal(w.calls.some(([kind]) => kind === 'drop'), site === 'ultra');
  }
});

test('redirects replace the clicked entry and cannot take over a newer course selection', () => {
  for (const later of [false, true]) {
    const w = world();
    let key = 'k0', n = 0;
    w.c.globalThis.navigation = { get currentEntry() { return { key }; } };
    w.c.history.pushState = function (s) { this.state = s; w.entries.push(['push', s.gzTurn]); key = `k${++n}`; };
    w.fn('turnTo')('12', '/courses/12/modules/items/5');
    const g = w.fn('next').get('12');
    if (later) { w.fn('stamp')('14', '/courses/14'); w.c.showing = '14'; }
    w.c.openAt = (cid, url) => { w.fn('stamp')(cid, url); w.calls.push(['course', cid, url]); };
    g.el.contentDocument = docAt('/courses/13/assignments/2');
    w.wait(40);
    assert.equal(w.fn('turns').get('k1').cid, '13');
    assert.equal(w.entries.filter(([kind]) => kind === 'push').length, later ? 2 : 1, 'a redirect is not another click');
    assert.equal(w.calls.some(([kind]) => kind === 'course'), !later, 'an older redirect stays in its history entry');
  }
});

test('selecting a retained course keeps the history entry for a page still loading', () => {
  const w = world();
  Object.assign(w.c, { ctx: { site: 'canvas', courseId: () => '5' }, P: () => ({ place: true }), closedCourse: '', drop() {} });
  vm.runInContext(part('  const visit = ', "  if (!framed && !preview) addEventListener('message'"), w.c);
  w.c.frames.set('13', { el: { contentDocument: docAt('/courses/13/grades') }, ready: true });
  w.c.tabs.push({ cid: '13' });
  w.fn('turnTo')('12', '/courses/12/assignments');
  w.fn('visit')('13');
  assert.equal(w.c.history.state.gzTurn.cid, '13');
  assert.equal(w.entries.filter(([kind]) => kind === 'replace').length, 1, 'the pending assignment entry stays intact');
});

test('the tab-list cap also preserves courses with dirty earlier pages', () => {
  const w = world();
  w.fn('spare').set('12', [{ dirty: true }]);
  Object.assign(w.c, { ctx: { site: 'canvas', courseList: () => ({}), courseId: () => '5' }, P: () => ({ cap: 2 }),
    labelFor: () => 'Course', snaps: new Map(), send() {}, drop: (cid) => w.calls.push(['drop', cid]) });
  w.c.tabs.push({ cid: '13', at: 10 });
  vm.runInContext(part('  const visitTab = ', '  const notePlace = ') + "\nvisitTab('14');", w.c);
  assert.deepEqual(w.c.tabs.map((tab) => tab.cid), ['12', '14']);
  assert.deepEqual(w.calls.filter(([kind]) => kind === 'drop'), [['drop', '13']]);
});

test('a late dirty edit cannot overflow the cache as a pending page lands', () => {
  const w = world();
  for (let i = 0; i < 3; i++) w.fn('spare').set(String(20 + i), [{ dirty: true, el: w.first.el }]);
  // The course already has three dirty earlier pages, but its current page is initially clean.
  w.fn('spare').set('12', Array.from({ length: 3 }, () => ({ dirty: true, el: w.first.el })));
  w.fn('turnTo')('12', '/courses/12/grades');
  const g = w.fn('next').get('12');
  w.first.dirty = true;
  g.el.contentDocument = docAt('/courses/12/grades');
  w.wait(40);
  assert.equal(w.c.frames.get('12'), w.first);
  assert.equal(g.el.removed, true);
  assert.equal(w.fn('spare').get('12').length, 3);
  assert.equal(w.c.history.state.gzTurn.url, '/courses/12/modules');
});

test('a committed pending frame receives the same external-navigation recovery as an initial frame', () => {
  const w = world();
  const loads = new Map();
  w.c.frameEl = (cid, url) => ({ style: { visibility: 'hidden' }, inert: true, contentDocument: blank(),
    contentWindow: { location: { origin }, postMessage() {} }, addEventListener: (ev, fn) => loads.set(ev, fn), focus() {}, remove() {} });
  vm.runInContext(part('  const guardFrame = ', '  const frameEl = '), w.c);
  w.fn('turnTo')('12', '/courses/12/grades');
  const g = w.fn('next').get('12');
  g.el.contentDocument = docAt('/courses/12/grades'); w.wait(40);
  assert.equal(typeof loads.get('load'), 'function');
  g.el.contentWindow.location.origin = 'https://tool.test';
  loads.get('load')();
  assert.equal(g.el.src, origin + '/courses/12');
});

test('a transient missing document waits for load rather than losing the click', () => {
  const w = world();
  w.fn('turnTo')('12', '/courses/12/grades');
  const g = w.fn('next').get('12');
  g.el.contentDocument = null; w.wait(60);
  assert.equal(w.fn('next').get('12'), g);
  g.el.contentDocument = docAt('/courses/12/grades'); w.wait(40);
  assert.equal(w.c.frames.get('12'), g);
});

test('a press on a download, another target, a base target, or a canceled event never preloads', () => {
  const calls = [];
  const a = { target: '', href: origin + '/courses/12/files/5', closest: () => null, matches: () => false, hasAttribute: () => false };
  const c = vm.createContext({ on: true, preview: false, anchorOf: () => a, document: { querySelector: () => null }, warm: (href) => calls.push(href) });
  const press = vm.runInContext(part('  const onPress = ', '  const warm = ') + '\nonPress;', c);
  const e = { isTrusted: true, button: 0 };
  a.hasAttribute = () => true; press(e);
  a.hasAttribute = () => false; a.target = '_blank'; press(e);
  a.target = ''; c.document.querySelector = () => ({}); press(e);
  c.document.querySelector = () => null; press({ ...e, defaultPrevented: true });
  assert.deepEqual(calls, []);
  press(e); assert.deepEqual(calls, [a.href]);
});

test('a turn landing in a hidden course keeps every document hidden and inert', () => {
  const w = world();
  w.fn('turnTo')('12', '/courses/12/grades');
  const g = w.fn('next').get('12');
  w.c.showing = '13'; w.first.el.style.visibility = 'hidden'; w.first.el.inert = true;
  g.el.contentDocument = docAt('/courses/12/grades'); w.wait(40);
  for (const f of [w.first, g]) { assert.equal(f.el.style.visibility, 'hidden'); assert.equal(f.el.inert, true); }
});

test('retrying a slow current page cannot drop unsaved work in an earlier page', () => {
  const w = world();
  w.first.ready = false; w.first.slow = true;
  w.fn('spare').set('12', [{ dirty: true }]);
  Object.assign(w.c, { ctx: { site: 'canvas', courseId: () => '5' }, closedCourse: '', drop: () => w.calls.push(['drop']) });
  vm.runInContext(part('  const visit = ', "  if (!framed && !preview) addEventListener('message'") + "\nvisit('12');", w.c);
  assert.equal(w.calls.some(([kind]) => kind === 'drop'), false);
});

test('course-frame move messages refresh the Canvas navbar without changing Ultra behavior', () => {
  for (const site of ['canvas', 'ultra']) {
    const w = world(); let listen, synced = 0;
    Object.assign(w.c, { ctx: { site }, addEventListener: (ev, fn) => { listen = fn; } });
    w.c.globalThis.GZ_NAVBAR_UI = { sync: () => synced++ };
    vm.runInContext(part("  if (!framed && !preview) addEventListener('message'", '  // In a tab\'s frame on Ultra'), w.c);
    listen({ origin, source: w.first.el.contentWindow, data: { gzCtab: 'moved' } });
    assert.equal(synced, site === 'canvas' ? 1 : 0);
  }
});

test('a kept page pauses its media and preserves embedded documents, then rests and restores its scroll', () => {
  const w = world();
  const video = { paused: false, pause() { this.paused = true; } };
  const attrs = {};
  const embed = { src: 'https://player.example/v/1', contentWindow: { get location() { throw new Error('cross-origin'); } },
    hasAttribute: (k) => k in attrs, setAttribute: (k, v) => { attrs[k] = v; }, getAttribute: (k) => attrs[k], removeAttribute: (k) => { delete attrs[k]; } };
  w.first.el.contentDocument = docAt('/courses/12/modules', { media: [video], frames: [embed], top: 640 });
  w.fn('turnTo')('12', '/courses/12/assignments');
  w.fn('next').get('12').el.contentDocument = docAt('/courses/12/assignments');
  w.wait(40);
  assert.equal(video.paused, true, 'its video paused');
  assert.equal(embed.src, 'https://player.example/v/1', 'embedded documents must stay live');
  assert.notEqual(w.first.el.style.display, 'none', 'still drawn for a moment');
  w.wait(3000);
  assert.equal(w.first.el.style.display, 'none', 'then not drawn at all');
  w.first.el.contentDocument.scrollingElement.scrollTop = 0; // (a page not drawn has no scroll)
  w.pop({ gzTurn: { cid: '12', url: '/courses/12/modules' } });
  assert.equal(w.c.frames.get('12'), w.first);
  assert.equal(w.first.el.style.display, '', 'drawn again');
  assert.equal(w.first.el.contentDocument.scrollingElement.scrollTop, 640, 'at its scroll');
  assert.equal(embed.src, 'https://player.example/v/1', 'its embedded document is unchanged');
  assert.equal(embed.hasAttribute('data-gz-rest'), false);
});

test('a kept page that did something as it loaded is not loaded again under it', () => {
  const w = world({ at: '/courses/12/quizzes/4/take' });
  w.fn('turnTo')('12', '/courses/12/modules');
  w.fn('next').get('12').el.contentDocument = docAt('/courses/12/modules');
  w.wait(40);
  w.fn('turnTo')('12', '/courses/12/quizzes/4/take');
  assert.equal(w.c.frames.get('12'), w.first, 'the kept attempt shows');
  assert.equal(w.fn('next').size, 0, 'and is not loaded again');
});

test('a press loads ahead only for a plain press with the main button, never a touch (a scroll may start there)', () => {
  const pressed = [];
  const c = vm.createContext({ L, PAGE: 'page', on: true, preview: false, framed: '', location: { origin, href: origin + '/courses/12', pathname: '/courses/12', search: '' },
    URL, Element: class {}, document: { querySelector: () => null }, frames: new Map([['12', { ready: true }]]), pathOf: () => '/courses/12',
    pageable: (path) => !/^\/(?:login|logout|api)(?:\/|$)/.test(path), turnTo: (cid, url, warm) => pressed.push([cid, url, warm]) });
  vm.runInContext(part('  const anchorOf = ', '  const toFrame = ') + part('  const onPress = ', '  // A course page in its course') + part('  const acts = ', '  // A kept page is quiet'), c);
  const a = Object.assign(new c.Element(), { localName: 'a', href: `${origin}/courses/12/grades`, target: '', hasAttribute: (k) => k === 'href', closest: () => null, matches: () => false });
  const press = (more = {}) => vm.runInContext('onPress', c)({ isTrusted: true, button: 0, pointerType: 'mouse', defaultPrevented: false, composedPath: () => [a], ...more });
  for (const more of [{ button: 2 }, { button: 1 }, { ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { pointerType: 'touch' }, { isTrusted: false }]) press(more);
  assert.deepEqual(pressed, []);
  press({ pointerType: 'pen' }); press();
  assert.deepEqual(JSON.parse(JSON.stringify(pressed)), [['12', '/courses/12/grades', true], ['12', '/courses/12/grades', true]]);
  // Pages that do something as they load: never loaded ahead.
  for (const path of ['/courses/12/quizzes/4/take', '/courses/12/external_tools/9', '/courses/12/assignments/3/submissions/7', '/courses/12/lti/launch']) {
    a.href = origin + path; press();
  }
  assert.equal(pressed.length, 2);
});

test('Glaze\'s bar keeps an open shadow root: a press or click in it is found through the event\'s path', () => {
  const navbar = fs.readFileSync(require.resolve('../features/navbar.js'), 'utf8');
  assert.match(navbar, /attachShadow\(\{ mode: 'open' \}\)/, 'a closed root would hide its links from course tabs (anchorOf)');
});

test('a link without a fragment finds its kept page at any fragment of its own (the calendar\'s month)', () => {
  const w = world({ at: '/calendar#view_name=month', showing: 'page' });
  w.c.frames.set('page', w.c.frames.get('12')); w.c.frames.delete('12');
  w.fn('turnTo')('page', '/conversations');
  w.fn('next').get('page').el.contentDocument = docAt('/conversations#filter=type=inbox');
  w.wait(40);
  w.fn('turnTo')('page', '/calendar');
  assert.equal(w.c.frames.get('page'), w.first, 'the kept calendar, at once');
  w.fn('turnTo')('page', '/calendar');
  assert.equal(w.c.frames.get('page'), w.first, 'the calendar again is the page on screen: nothing loads');
  assert.equal(w.fn('next').get('page')?.go, undefined);
});

test('a frame not on screen shows its new page only once drawn, never first the page it had', () => {
  const w = world({ showing: '' });
  const g = w.fn('turnTo')('12', '/courses/12/grades');
  assert.equal(w.fn('awaitDrawn')('12', g), true, 'held back');
  assert.deepEqual(w.calls.filter(([k]) => k === 'reveal'), []);
  assert.deepEqual(w.calls.filter(([k]) => k === 'wait'), [['wait', '12']], 'its tab marked as loading meanwhile');
  g.el.contentDocument = docAt('/courses/12/grades');
  w.wait(40);
  assert.equal(w.c.frames.get('12'), g);
  assert.deepEqual(w.calls.filter(([k]) => k === 'reveal'), [['reveal', '12']], 'shown as drawn');
  const on = world();
  assert.equal(on.fn('awaitDrawn')('12', on.fn('turnTo')('12', '/courses/12/grades')), false, 'a frame on screen keeps its page until then anyway');
});

test('retaining a Canvas page never navigates an embedded tool or discards its unsaved work', () => {
  const w = world();
  let draft = 'Unsaved tool answer', src = 'https://tool.example/editor';
  const attrs = {};
  const tool = { contentWindow: { get location() { throw new Error('cross-origin'); } },
    get src() { return src; }, set src(value) { src = value; draft = ''; },
    hasAttribute: (k) => k in attrs, setAttribute: (k, v) => { attrs[k] = v; }, getAttribute: (k) => attrs[k], removeAttribute: (k) => { delete attrs[k]; } };
  w.first.el.contentDocument = docAt('/courses/12/assignments/4', { frames: [tool] });
  w.fn('turnTo')('12', '/courses/12/modules');
  w.fn('next').get('12').el.contentDocument = docAt('/courses/12/modules'); w.wait(40);
  assert.equal(draft, 'Unsaved tool answer', 'cross-origin editing cannot bubble a dirty event to Canvas');
  assert.equal(tool.src, 'https://tool.example/editor');
  w.wait(3000);
  w.fn('turnTo')('12', '/courses/12/assignments/4');
  assert.equal(w.c.frames.get('12'), w.first);
  assert.equal(draft, 'Unsaved tool answer', 'returning keeps the same embedded document');
  assert.equal(w.fn('next').has('12'), false, 'automatic refresh must also preserve opaque embedded work');
});

test('a kept page stops another site\'s video player (put back on return) and media in its own frames, never a tool', () => {
  const w = world();
  const embed = (url) => {
    const attrs = {}; let src = url;
    return { get src() { return src; }, set src(v) { src = v; }, hasAttribute: (k) => k in attrs, setAttribute: (k, v) => { attrs[k] = v; }, getAttribute: (k) => attrs[k], removeAttribute: (k) => { delete attrs[k]; } };
  };
  const video = embed('https://www.youtube-nocookie.com/embed/abc'), studio = embed('https://school.instructuremedia.com/embed/1'), tool = embed('https://tool.example/editor');
  const comment = { paused: false, pause() { this.paused = true; } };
  const own = Object.assign(embed(`${origin}/media_objects_iframe/m-1`), { contentDocument: docAt('/media_objects_iframe/m-1', { media: [comment] }) });
  w.first.el.contentDocument = docAt('/courses/12/pages/week-1', { frames: [video, studio, tool, own] });
  w.fn('turnTo')('12', '/courses/12/modules');
  w.fn('next').get('12').el.contentDocument = docAt('/courses/12/modules'); w.wait(40);
  assert.deepEqual([video.src, studio.src], ['about:blank', 'about:blank'], 'players stop as the page is left');
  assert.equal(tool.src, 'https://tool.example/editor', 'a tool may hold work: untouched');
  assert.equal(comment.paused, true, 'media in its own frames paused');
  w.pop({ gzTurn: { cid: '12', url: '/courses/12/pages/week-1' } });
  assert.deepEqual([video.src, studio.src], ['https://www.youtube-nocookie.com/embed/abc', 'https://school.instructuremedia.com/embed/1'], 'back as the page shows again');
  assert.equal(video.hasAttribute('data-gz-rest'), false);
});
