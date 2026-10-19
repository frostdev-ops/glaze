const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const vm = require('vm');
const L = require('../lib/coursetabs.js');

const source = fs.readFileSync(require.resolve('../features/coursetabs.js'), 'utf8');
const part = (a, b) => source.slice(source.indexOf(a), source.indexOf(b, source.indexOf(a)));
const origin = 'https://school.instructure.com';

const docAt = (path, o = {}) => {
  const [pathname, q] = path.split('?');
  return {
    location: { origin, href: origin + path, pathname, search: q ? `?${q}` : '' }, readyState: o.ready || 'complete', body: {},
    documentElement: { matches: () => false }, querySelector: () => ({}), scrollingElement: { scrollTop: o.top || 0 },
    on: {}, addEventListener(ev, fn) { this.on[ev] = fn; },
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
      contentWindow: { postMessage: (m) => el.msgs.push(m) }, remove() { el.removed = true; }, focus() { c.document.activeElement = el; } };
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
    save: () => calls.push(['save']), keepPage() {}, later() {}, globalThis: {},
    show: (cid) => calls.push(['show', cid]), reveal: (cid) => calls.push(['reveal', cid]),
    openAt: (cid, url) => calls.push(['course', cid, url]), openPage: (url) => calls.push(['page', url]),
    load: (cid, f, url) => { calls.push(['load', cid, url]); return true; },
  });
  vm.runInContext(part('  const KEEP = ', '  let showing = ') + part("  // ---- a frame's pages (Canvas)", '  // Canvas: a frame still loading')
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
  return { c, first, els, host, entries, calls, wait, fn, pop, latest: () => els.at(-1) };
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

test('a page loading that lands outside its frame\'s course goes where a link to it goes; another site loads in place', () => {
  const w = world();
  w.fn('turnTo')('12', '/courses/12/modules/items/5');
  const g = w.fn('next').get('12');
  g.el.contentDocument = docAt('/courses/13/assignments/2');
  w.wait(40);
  assert.equal(g.el.removed, true);
  assert.equal(w.c.frames.get('12'), w.first);
  assert.deepEqual(w.calls.filter(([k]) => k === 'course'), [['course', '13', '/courses/13/assignments/2']]);
  const w2 = world();
  w2.fn('turnTo')('12', '/courses/12/external_tools/4');
  w2.fn('next').get('12').el.contentDocument = null;
  w2.wait(40);
  assert.deepEqual(w2.calls.filter(([k]) => k === 'load'), [['load', '12', '/courses/12/external_tools/4']]);
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
