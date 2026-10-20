// Canvas audit: execute the production routing functions with invented URLs and DOM/event doubles.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const L = require('../lib/coursetabs.js');
const source = fs.readFileSync(require.resolve('../features/coursetabs.js'), 'utf8');
const part = (a, b) => {
  const start = source.indexOf(a), end = source.indexOf(b, start);
  assert.ok(start >= 0 && end > start, `production section: ${a}`);
  return source.slice(start, end);
};
const origin = 'https://school.instructure.com';

function routing({ framed = '', here = '5', count = 1, showing = '12', base = false } = {}) {
  const calls = [];
  class Element {
    constructor(href, options = {}) {
      const u = new URL(href, origin);
      Object.assign(this, { localName: 'a', href: u.href, origin: u.origin, pathname: u.pathname,
        search: u.search, hash: u.hash, target: '', ...options });
    }
    closest(selector) {
      if (selector === 'a[href]') return this;
      if (selector === 'form, #gz-ctabs') return this.inForm || this.inStrip ? {} : null;
      return null;
    }
    matches() { return !!this.action; }
    hasAttribute(name) { return name === 'download' && !!this.download; }
  }
  const c = vm.createContext({ L, URL, Element, PAGE: 'page', on: true, preview: false, signedOut: false,
    framed, showing, here: () => here, frames: new Map(Array.from({ length: count }, (_, i) => [String(i + 12), {}])),
    location: new URL(framed === 'page' ? '/calendar' : framed ? '/courses/12/pages/reading' : '/courses/5', origin), ctx: { site: 'canvas' }, document: { querySelector: () => base ? {} : null },
    openAt: (cid, url) => calls.push(['course', cid, url]), openPage: (url) => calls.push(['page', url]),
    toTop: (op, m) => calls.push([op, m.url]), show: (cid) => calls.push(['show', cid]), route: (url) => calls.push(['route', url]),
  });
  const api = vm.runInContext(part('  const pathOf = ', '  let showing = ')
    + part('  const onCourseLink = ', '  // A course page in its course')
    + part('  const bar = {', '  return { sync') + '\n({onCourseLink,toFrame,goes,pageable,bar});', c);
  const click = (href, options = {}, event = {}) => {
    const e = { target: new Element(href, options), button: 0, isTrusted: true, defaultPrevented: false,
      ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, stopped: false,
      preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; }, ...event };
    api.onCourseLink(e);
    return e;
  };
  return { api, c, calls, click };
}

test('Canvas action links, links in forms and cancelled clicks retain their native handlers', () => {
  const p = routing();
  for (const options of [{ action: true }, { inForm: true }, { inStrip: true }]) {
    const e = p.click('/courses/13/assignments', options);
    assert.equal(e.defaultPrevented, false);
    assert.equal(e.stopped, false);
  }
  const cancelled = p.click('/courses/13', {}, { defaultPrevented: true });
  assert.equal(cancelled.stopped, false);
  p.click('/courses/13', {}, { isTrusted: false });
  assert.deepEqual(p.calls, []);
});

test('Canvas clicks preserve every modifier, alternate button, download attribute and named target', () => {
  const p = routing();
  for (const event of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }, { button: 2 }]) {
    assert.equal(p.click('/courses/13/modules', {}, event).defaultPrevented, false);
  }
  for (const target of ['_blank', '_parent', '_top', 'assignment-window']) {
    assert.equal(p.click('/courses/13/modules', { target }).defaultPrevented, false);
  }
  assert.equal(p.click('/courses/13/modules', { download: true }).defaultPrevented, false);
  assert.deepEqual(p.calls, []);
  assert.equal(p.click('/courses/13/modules', { target: '_self' }).defaultPrevented, true);
  assert.deepEqual(p.calls, [['course', '13', '/courses/13/modules']]);
});

test('a base target affects implicit Canvas targets but not an explicit _self target', () => {
  const p = routing({ base: true });
  assert.equal(p.click('/courses/13').defaultPrevented, false);
  assert.deepEqual(p.calls, []);
  assert.equal(p.click('/courses/13', { target: '_self' }).defaultPrevented, true);
  assert.deepEqual(p.calls, [['course', '13', '/courses/13']]);
});

test('native same-document hashes stay inside their course or page frame', () => {
  for (const [framed, href] of [['12', '/courses/12/pages/reading#part-2'], ['page', '/calendar#today']]) {
    const p = routing({ framed });
    assert.equal(p.click(href).defaultPrevented, false);
    assert.equal(p.api.bar.open(href), false);
    assert.deepEqual(p.calls, []);
  }
});

test('Canvas reserves only the login, logout and API path segments from page frames', () => {
  const p = routing();
  for (const href of ['/login', '/login/canvas', '/logout', '/logout/all', '/api', '/api/v1/courses']) {
    assert.equal(p.click(href).defaultPrevented, false, href);
  }
  assert.deepEqual(p.calls, []);
  for (const href of ['/logins', '/logout-help', '/apiary']) {
    assert.equal(p.click(href).defaultPrevented, true, href);
  }
  assert.deepEqual(p.calls, [['page', '/logins'], ['page', '/logout-help'], ['page', '/apiary']]);
});

test('Canvas file downloads with queries remain native from both course and page frames', () => {
  for (const framed of ['', '12', 'page']) {
    const p = routing({ framed });
    for (const href of ['/courses/13/files/8/download?download_frd=1', '/files/8/download?wrap=1']) {
      assert.equal(p.click(href).defaultPrevented, false);
    }
    assert.deepEqual(p.calls, []);
  }
});

function bridge(from = '12') {
  const mine = {}, calls = [], replies = [];
  let listener;
  const frame = { ready: true, el: { contentWindow: mine } };
  const c = vm.createContext({ L, PAGE: 'page', ctx: { site: 'canvas' }, location: { origin },
    framed: '', preview: false, on: true, showing: from, waiting: '14', who: '42',
    spare: new Map(), next: new Map(), frames: new Map([[from, frame]]), tabs: [{ cid: '12', path: '/courses/12/pages/reading', top: 430, pin: true }],
    addEventListener: (event, fn) => { listener = fn; },
    openAt: (cid, url) => calls.push(['course', cid, url]), openPage: (url) => calls.push(['page', url]),
    later: (delay) => calls.push(['later', delay]), keepPage: () => calls.push(['keepPage']), save: () => calls.push(['save']),
    GZ_PET_WORLD: { refresh: () => calls.push(['pet']) }, GZ_NAVBAR_UI: { sync: () => calls.push(['navbar']) },
  });
  mine.postMessage = (message, site) => replies.push({ ...message, site });
  vm.runInContext(part('  const split = ', '  // What is on screen') + part('  const pageable = ', '  // A press on a link') + part("  if (!framed && !preview) addEventListener('message'", '  // In a tab\'s frame on Ultra'), c);
  return { c, frame, calls, replies, post: (data) => listener({ origin, source: mine, data }) };
}

test('Canvas loaded messages restore visibility and pending selection to only the shown frame', () => {
  const p = bridge(); p.c.showing = '13';
  p.post({ gzCtab: 'loaded' });
  assert.deepEqual(p.replies, [{ gzCtab: 'visible', on: false, site: origin }]);
  p.replies.length = 0; p.c.showing = '12'; p.frame.ready = false; p.post({ gzCtab: 'loaded' });
  assert.deepEqual(p.replies, [{ gzCtab: 'visible', on: false, site: origin }, { gzCtab: 'loading', cid: '14', site: origin }], 'a selected document still loading cannot operate the sidebar');
  p.replies.length = 0; p.frame.ready = true; p.post({ gzCtab: 'loaded' });
  assert.deepEqual(p.replies, [{ gzCtab: 'visible', on: true, site: origin }, { gzCtab: 'loading', cid: '14', site: origin }]);
});

test('Canvas moved messages refresh only the visible surface and synchronize the page navbar once', () => {
  for (const from of ['12', 'page']) {
    const p = bridge(from); p.c.showing = '13';
    p.post({ gzCtab: 'moved' }); assert.deepEqual(p.calls, []);
    p.c.showing = from; p.post({ gzCtab: 'moved' });
    assert.deepEqual(p.calls, [['pet'], ['later', 700], ['keepPage'], ['navbar']]);
  }
});

test('Canvas place messages require the current account and bound scroll without changing tab metadata', () => {
  const p = bridge(), path = '/courses/12/pages/notes?module_item_id=7';
  p.post({ gzCtab: 'place', uid: '43', path, top: 610 });
  assert.equal(p.c.tabs[0].top, 430); assert.deepEqual(p.calls, []);
  p.post({ gzCtab: 'place', uid: '42', path, top: 1e9 });
  assert.equal(p.c.tabs[0].path, path); assert.equal(p.c.tabs[0].top, 1e7);
  assert.equal(p.c.tabs[0].pin, true); assert.deepEqual(p.calls, [['save']]);
  p.post({ gzCtab: 'place', uid: '42', path, top: 1e9 });
  assert.deepEqual(p.calls, [['save']], 'unchanged messages do not schedule another storage write');
});

test('a cross-course fragment link must preserve live frames instead of reloading the top page', () => {
  const p = routing();
  const href = '/courses/13/pages/reading#part-2';
  const e = p.click(href);
  assert.equal(e.defaultPrevented, true, 'the browser default would replace the top document and destroy every live frame');
  assert.deepEqual(p.calls, [['course', '13', href]], 'retain the destination fragment in the course frame');
  for (const framed of ['', '12', 'page']) {
    const course = routing({ framed }), page = routing({ framed });
    assert.equal(course.click(href).defaultPrevented, true);
    assert.deepEqual(course.calls, [framed ? ['open', href] : ['course', '13', href]]);
    assert.equal(page.click('/conversations#unread').defaultPrevented, true);
    assert.deepEqual(page.calls, [framed ? [framed === 'page' ? 'go' : 'open', '/conversations#unread'] : ['page', '/conversations#unread']]);
  }
});

test('the navbar must keep a shown course fragment inside its live frame', () => {
  const p = routing();
  const href = '/courses/12/pages/reading#part-2';
  const location = new URL('/courses/12/pages/reading', origin);
  p.c.frames.set('12', { el: { contentDocument: { location }, contentWindow: { location } } });
  assert.equal(p.api.bar.open(href), true);
  assert.deepEqual(p.calls, [], 'a fragment in the shown page uses its native anchor');
  assert.equal(location.hash, '#part-2');
  assert.equal(p.api.bar.open('/courses/12/pages/next#part-3'), true);
  assert.deepEqual(p.calls, [['course', '12', '/courses/12/pages/next#part-3']]);
  const native = routing({ showing: '' });
  assert.equal(native.click('/courses/5#part-2').defaultPrevented, false);
  assert.equal(native.api.bar.open('/courses/5#part-2'), false);
  assert.deepEqual(native.calls, []);
});

test('Canvas frame handoff must retain the fragment after scripted cross-course navigation', () => {
  const sent = [];
  const location = new URL('/courses/13/pages/reading?module_item_id=7#part-2', origin);
  const pass = vm.runInNewContext(part('  const pass = ', '  const sync = ') + '\npass;', {
    on: true, ctx: { site: 'canvas' }, framed: '12', PAGE: 'page', preview: false, location,
    observeView() {}, here: () => '13', awayFrom: '', toTop: (op, m) => sent.push([op, m.url]),
  });
  pass(); pass();
  assert.deepEqual(sent, [['away', '/courses/13/pages/reading?module_item_id=7#part-2']], 'the owning frame needs the native navigation fragment to restore its anchor');
  const p = bridge(); p.post({ gzCtab: sent[0][0], url: sent[0][1] });
  assert.deepEqual(p.calls, [['course', '13', sent[0][1]]], 'the parent must preserve the anchor when accepting the handoff');
  for (const op of ['go', 'open', 'warm']) {
    const parent = bridge(), url = op === 'open' ? '/courses/13#unit' : '/courses/12/grades#grade';
    parent.c.turnTo = (...args) => parent.calls.push(['turn', ...args]);
    parent.post({ gzCtab: op, url });
    assert.deepEqual(parent.calls, [op === 'warm' ? ['turn', '12', url, true] : ['course', op === 'open' ? '13' : '12', url]]);
  }
});

test('Canvas library cleaning is idempotent and preserves valid encoded slugs and scroll bounds', () => {
  const raw = [{ cid: '12', path: '/courses/12/pages/caf%C3%A9%20notes?module_item_id=8', top: 1e9, pin: true },
    { cid: '13', path: '/courses/12/grades', top: 400 }, { cid: '_14_1' }, { cid: '12' }, { cid: '15', top: NaN }];
  const clean = L.clean(raw, 'canvas');
  assert.deepEqual(L.clean(clean, 'canvas'), clean);
  assert.equal(raw[0].top, 1e9, 'cleaning does not mutate storage input');
  assert.deepEqual(clean.map((x) => [x.cid, x.path, x.top]), [
    ['12', raw[0].path, 1e7], ['13', '/courses/13', 0], ['15', '/courses/15', 0],
  ]);
  assert.equal(L.owns('/courses/123/grades', '12'), false);
});

test('Canvas library keeps course-query boundaries and rejects nested escapes on outside paths', () => {
  assert.equal(L.target({ cid: '12', path: '/courses/12?view=all&return_to=%2Fcalendar' }), '/courses/12?view=all&return_to=%2Fcalendar');
  for (const path of ['/courses/12', '/courses/12/', '/courses/12/grades', '/calendar/%252Fother', '/calendar/%5Cother']) {
    assert.equal(L.outside(path), null, path);
  }
  assert.equal(L.outside('/calendar', '?view=month&include[]=courses'), '/calendar?view=month&include[]=courses');
});
