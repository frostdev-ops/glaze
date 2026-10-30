// Course tabs on Ultra (WP-U1): a frame holding unsaved work outlives another browser tab's list and this page opening
// its course; notices reach the student wherever the tabs are; the covered strip is out of reach; Ultra's redirect into a
// frame's own course is not leaving it; Ultra's own Sign Out reaches course tabs; injected UI follows the text direction.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = process.env.GZ_B8_REPO || path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'features/coursetabs.js'), 'utf8');
const L = require(path.join(root, 'lib/coursetabs.js'));
const part = (a, b, src = source) => src.slice(src.indexOf(a), src.indexOf(b, src.indexOf(a)));
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const fill = (s, a = {}) => s.replace(/\{(\w+)\}/g, (_, k) => a[k]);

// Another browser tab's list (onStore), as audit/repro-onstore-dirty.js drives it: B, at its cap, evicted _7_1.
const stored = () => {
  const removed = [], notes = [];
  let saves = 0;
  const frame = (cid, dirty) => ({ el: { remove: () => removed.push(cid) }, dirty, ready: true });
  const frames = new Map([['_7_1', frame('_7_1', true)], ['_8_1', frame('_8_1', false)], ['_6_1', frame('_6_1', false)]]);
  const c = vm.createContext({ L, ctx: { site: 'ultra', courseId: () => '_1_1', courseList: () => ({ _7_1: { name: 'Biology 101' } }) }, preview: false, who: '_42_1',
    key: () => 'ctabs:https://bb.test:_42_1', frames, spare: new Map(), next: new Map(), PAGE: 'page', requestAnimationFrame() {}, nudge() {}, closedCourse: '', showing: '_7_1', waiting: '',
    tabs: [{ cid: '_1_1', at: 1 }, { cid: '_6_1', at: 2 }, { cid: '_7_1', name: 'Biology', code: 'BIO101', pin: false, at: 3, path: '/ultra/courses/_7_1/grades', top: 40 }, { cid: '_8_1', at: 4 }],
    drawerFrom: null, drawerOff() {}, showTurn: 0, wait() {}, show: (x) => { c.showing = x; }, dropNext() {}, readPrefs: () => Promise.resolve(), pass() {}, route() {},
    save: () => saves++, say: (m) => notes.push(m), t: fill, labelFor: (cid, name) => name, Date, JSON,
  });
  vm.runInContext(part('  const drop = ', '  const dropNext = ') + part('  const onStore = ', '  // Where the page frame is') + '\nthis.onStore = onStore;', c);
  const list = [{ cid: '_1_1', path: '/ultra/courses/_1_1/outline' }, { cid: '_8_1', path: '/ultra/courses/_8_1/outline' }, { cid: '_9_1', path: '/ultra/courses/_9_1/outline' }];
  return { c, frames, removed, notes, saves: () => saves, change: (next = list) => c.onStore({ 'ctabs:https://bb.test:_42_1': { newValue: { tabs: next } } }, 'local') };
};

test('a full remote list cannot evict a restored dirty tab or leave a dirty frame without a tab', () => {
  for (const pinned of [false, true]) {
    const s = stored();
    s.frames.get('_8_1').dirty = true;
    const remote = Array.from({ length: L.MAX }, (_, i) => ({ cid: `_${100 + i}_1`, pin: pinned, at: 100 + i }));
    s.change(remote);
    for (const cid of ['_7_1', '_8_1']) assert.ok(s.c.tabs.some((x) => x.cid === cid), `${cid}, pinned=${pinned}`);
    assert.ok(s.c.tabs.length <= L.MAX, 'the existing hard bound still holds');
    assert.deepEqual(s.removed, ['_6_1']);
    assert.ok(L.clean(s.c.tabs, 'ultra').some((x) => x.cid === '_7_1'), 'a storage round trip keeps the protected entry');
  }
});

test('another browser tab\'s list never destroys a frame holding unsaved work: its tab comes back, saved, with a word', () => {
  const s = stored();
  s.change();
  assert.deepEqual(s.removed, ['_6_1'], 'only the untouched frame of a course closed elsewhere goes');
  assert.ok(s.frames.has('_7_1'), 'the edited frame stays');
  assert.equal(s.c.showing, '_7_1', 'and stays on screen');
  const kept = s.c.tabs.find((x) => x.cid === '_7_1');
  assert.ok(kept, 'its tab is back in the list');
  assert.equal(kept.name, 'Biology', 'as this page knew it');
  assert.equal(kept.path, '/ultra/courses/_7_1/grades');
  assert.deepEqual(s.c.tabs.map((x) => x.cid), ['_1_1', '_8_1', '_9_1', '_7_1'], 'the other tab\'s list otherwise, with no further eviction');
  assert.equal(s.saves(), 1, 'written back, so the other browser tab shows it again');
  assert.deepEqual(s.notes, ['Biology 101 has unsaved work, so its tab stays open.']);
});

test('unsaved work in an earlier or next page of a frame keeps it too; a clean list change says nothing', () => {
  for (const where of ['spare', 'next']) {
    const s = stored();
    s.frames.get('_7_1').dirty = false;
    if (where === 'spare') s.c.spare.set('_7_1', [{ el: { remove() {} }, dirty: true }]); else s.c.next.set('_7_1', { dirty: true });
    s.change();
    assert.ok(s.frames.has('_7_1'), where);
    assert.ok(s.c.tabs.some((x) => x.cid === '_7_1'), where);
  }
  const s = stored();
  s.frames.get('_7_1').dirty = false;
  s.change();
  assert.deepEqual(s.removed.sort(), ['_6_1', '_7_1']);
  assert.equal(s.saves(), 0);
  assert.deepEqual(s.notes, []);
});

// This page routing into a course whose hidden frame holds unsaved work (pass), and its tab picked again (visit).
const passing = (dirty) => {
  const calls = [];
  const location = { pathname: '/ultra/courses/_7_1/outline', search: '' };
  const c = vm.createContext({ on: true, framed: '', preview: false, ctx: { site: 'ultra' }, PAGE: 'page', requestAnimationFrame() {}, nudge() {}, location, showing: '', shownFrom: '', waiting: '',
    frames: new Map([['_7_1', { dirty, ready: true }]]), spare: new Map(), next: new Map(), tabs: [{ cid: '_7_1', name: 'Biology', code: 'BIO101' }],
    loaded: true, last: '_7_1', lastPath: '', restored: true, here: () => '_7_1', observeView() {}, notePlace() {}, flag() {}, place() {}, draw() {}, lay() {}, later() {}, moved() {},
    visitTab: () => calls.push(['tab']), drop: (cid) => calls.push(['drop', cid]), say: (m) => calls.push(['say', m]), t: fill, labelFor: (cid, name) => name,
    show: async (cid) => { calls.push(['show', cid]); c.showing = cid; c.shownFrom = location.pathname + location.search; },
  });
  const pass = vm.runInContext(part('  const pass = ', '  const sync = ') + '\npass;', c);
  return { c, calls, location, pass };
};

test('this page opening a course whose hidden frame holds unsaved work shows that frame, never drops it', async () => {
  const p = passing(true);
  p.pass(); await new Promise(setImmediate);
  assert.deepEqual(p.calls.filter(([k]) => k !== 'tab'), [['show', '_7_1'], ['say', 'Biology has unsaved work, so it stays where it was.']], 'said once the frame shows, in it');
  // Ultra settling its own route inside that course does not uncover the page and cover it again.
  p.location.search = '?courseId=_7_1'; p.calls.length = 0;
  p.pass(); p.pass(); await new Promise(setImmediate);
  assert.deepEqual(p.calls.filter(([k]) => k === 'show' || k === 'drop' || k === 'say'), []);
  const clean = passing(false);
  clean.pass();
  assert.deepEqual(clean.calls.filter(([k]) => k === 'drop' || k === 'show'), [['drop', '_7_1']], 'an untouched duplicate still goes: Ultra keeps one copy of a course');
});

test('picking the page\'s own course shows its frame while that frame holds unsaved work', () => {
  for (const dirty of [false, true]) {
    const shown = [];
    const c = vm.createContext({ PAGE: 'page', requestAnimationFrame() {}, nudge() {}, spare: new Map(), next: new Map(), framed: '', preview: false, tabs: [{ cid: '_7_1' }], save() {}, Date,
      frames: new Map([['_7_1', { ready: true, dirty }]]), showing: '', drop() {}, reveal: (cid) => shown.push(cid), ctx: { site: 'ultra', courseId: () => '_7_1' },
    });
    vm.runInContext(part('  const visit = (cid) => {', "  if (!framed && !preview) addEventListener('message'") + "\nvisit('_7_1');", c);
    assert.deepEqual(shown, [dirty ? '_7_1' : ''], dirty ? 'the frame with the work, not the page\'s fresh copy' : 'the page itself');
  }
});

// Where the strip's word goes (say).
const saying = ({ hosted = false, shown = true, connected = true, showing = '', ready = true } = {}) => {
  const posted = [];
  const note = { textContent: '' }, aside = { textContent: '' };
  const c = vm.createContext({ framed: '', showing, note, aside, strip: { isConnected: connected }, location: { origin: 'https://bb.test' },
    frames: new Map([['_7_1', { ready, el: { contentWindow: { postMessage: (m) => posted.push(m) } } }]]),
    hosted: () => hosted, shown: () => shown, setTimeout: () => 1, clearTimeout() {},
  });
  const say = vm.runInContext(part('  let sayTimer = 0;', '  // ---- the student\'s courses') + '\nsay;', c);
  return { say, note, aside, posted };
};

test('notices during frame loading stay above the frame, rather than disappearing in its blank document', () => {
  const s = saying({ showing: '_7_1', ready: false });
  s.say('Biology has unsaved work, so its tab stays open.');
  assert.equal(s.aside.textContent, 'Biology has unsaved work, so its tab stays open.');
  assert.deepEqual(s.posted, [], 'only ready frames own their notice channel');
  assert.equal(s.note.textContent, '', 'the covered strip must not receive another live announcement');
});

test('course-tab notices reach the student when the bar holds the tabs or a short window hides the strip', () => {
  const inStrip = saying();
  inStrip.say('Pinned');
  assert.equal(inStrip.note.textContent, 'Pinned', 'a strip on screen says it itself');
  assert.equal(inStrip.aside.textContent, '');
  // In the bar alone the strip is taken out; in a short window it stays in the page, not displayed.
  for (const where of [{ hosted: true, shown: false, connected: false }, { shown: false }]) {
    const s = saying(where);
    s.say('Close or unpin a tab to open another course tab.');
    assert.equal(s.aside.textContent, 'Close or unpin a tab to open another course tab.', JSON.stringify(where));
    assert.equal(s.note.textContent, '');
  }
  // A strip Ultra took away with its old bar, about to be put back by the same pass: the word waits in it.
  const between = saying({ shown: false, connected: false });
  between.say('Closed Biology to make room.');
  assert.equal(between.note.textContent, 'Closed Biology to make room.');
  const framed = saying({ hosted: true, shown: false, connected: false, showing: '_7_1' });
  framed.say('Closed Biology to make room.');
  assert.deepEqual(framed.posted.map((m) => m.text), ['Closed Biology to make room.'], 'a frame on screen says it in its own document');
  assert.equal(framed.aside.textContent, '', 'not twice');
  assert.equal(framed.note.textContent, '', 'nor in the covered inert strip');
});

test('the notice outside the strip is a live region over the page, made with the strip and taken away with it', () => {
  const make = part('  const make = () => {', '  const set = (e, k, v)');
  assert.match(make, /aside\.setAttribute\('role', 'status'\)/);
  assert.match(make, /id: 'gz-ctabs-say'/);
  const sync = part('  const sync = (want) => {', '  const revoke = ');
  assert.match(sync, /if \(!strip\) make\(\);\s*document\.body\.append\(aside\);/, 'in the page, whatever holds the tabs, once they are on');
  assert.match(sync, /aside\?\.remove\(\)/);
  const css = read('features/coursetabs.css');
  assert.match(css, /#gz-ctabs-say\s*\{[^}]*position:\s*fixed/);
  assert.match(css, /#gz-ctabs-say\s*\{[^}]*z-index:\s*1260/, 'over a shown frame too');
});

test('while a frame covers the page, the page\'s own strip is inert: out of the tab order and the accessibility tree', async () => {
  for (const site of ['ultra', 'canvas']) {
    const frames = new Map([['_2_1', { at: 0, ready: true, el: { style: {}, focus() {}, contentWindow: { postMessage() {} } } }]]);
    const strip = { inert: false, contains: () => false };
    const c = vm.createContext({ PAGE: 'page', requestAnimationFrame() {}, nudge() {}, keepPage() {}, spare: new Map(), next: new Map(), popping: false, showTurn: 0, showing: '', shownFrom: '', shooting: null, on: true, framed: '', frames, LIVE: 4,
      host: { toggleAttribute() {} }, strip, list: null, wait() {}, document: { activeElement: null }, location: { pathname: '/ultra/courses/_1_1/outline', search: '' }, ctx: { site, scene() {} },
      html: { toggleAttribute() {} }, sessionStorage: { setItem() {}, removeItem() {} }, hostIn() {}, lay() {}, clearSlow() {}, unpicture() {}, draw() {}, later() {}, Date,
    });
    const show = vm.runInContext(part('  let drawerFrom = ', '  const drawerOn = ') + part('  const show = async (cid) => {', '  // A tab: its frame') + '\nshow;', c);
    await show('_2_1');
    assert.equal(strip.inert, true);
    await show('');
    assert.equal(strip.inert, false);
    assert.match(part('  const sync = (want) => {', '  const revoke = '), /strip\.inert = false/, 'switched off with a frame on screen, the strip is not left inert for next time');
  }
});

test('in a frame, Ultra\'s redirect into its own course is not leaving it; another course\'s is', () => {
  for (const [search, away] of [['?course_id=_2_1&content_id=_9_1', false], ['?courseId=_2_1', false], ['?content_id=_9_1', false], ['?course_id=_3_1', true], ['?course_id=_2_1&courseId=_3_1', true], ['?course_id=_2_1&course_id=_3_1', true]]) {
    const sent = [];
    const location = { pathname: '/ultra/redirect', search, hash: '', href: `https://bb.test/ultra/redirect${search}` };
    const c = vm.createContext({ on: true, framed: '_2_1', PAGE: 'page', requestAnimationFrame() {}, nudge() {}, preview: false, ctx: { site: 'ultra' }, location, URLSearchParams, awayFrom: '', here: () => undefined, observeView() {},
      toTop: (op, m) => sent.push([op, m.url]), showing: '', frames: new Map(), loaded: true, last: '_2_1', lastPath: '', flag() {}, place() {}, draw() {}, lay() {}, later() {}, moved() {},
    });
    vm.runInContext(part('  const pass = ', '  const sync = ') + '\npass();', c);
    assert.deepEqual(sent, away ? [['away', `/ultra/redirect${search}`]] : [], search);
  }
});

test('redirect link clicks and passes agree: conflicting or repeated course identifiers leave the frame', () => {
  const block = part("  if (framed && !preview && ctx.site !== 'canvas') document.addEventListener('click'", '  if (framed && !preview) {');
  for (const [search, away] of [['?courseId=_2_1', false], ['?content_id=_9_1', false], ['?course_id=_3_1', true], ['?course_id=_2_1&courseId=_3_1', true], ['?course_id=_2_1&course_id=_3_1', true]]) {
    let listener; const sent = [];
    class Anchor {}
    const a = Object.assign(new Anchor(), { href: `https://bb.test/ultra/redirect${search}`, getAttribute: () => `/ultra/redirect${search}`, hasAttribute: (k) => k === 'href' });
    vm.runInNewContext(block, { framed: '_2_1', preview: false, ctx: { site: 'ultra' }, on: true, HTMLAnchorElement: Anchor, URL,
      location: { origin: 'https://bb.test', href: 'https://bb.test/ultra/courses/_2_1/outline' }, document: { addEventListener: (_, f) => { listener = f; } },
      toTop: (op, m) => sent.push([op, m.url]),
    });
    const e = { isTrusted: true, composedPath: () => [a], preventDefault() {}, stopImmediatePropagation() {} };
    listener(e);
    assert.deepEqual(sent, away ? [['away', `/ultra/redirect${search}`]] : [], search);
  }
});

test('in a frame, a panel of its own course that Ultra opens under another page stays; another course\'s or none leaves', () => {
  const cases = [['/ultra/stream/announcement-detail', '?courseId=_2_1&announcementId=_5_1', false], ['/ultra/stream/announcement-detail', '?courseId=_3_1&announcementId=_5_1', true],
    ['/ultra/stream/announcement-detail', '?courseId=_2_1&courseId=_3_1', true], ['/ultra/stream', '', true], ['/ultra/stream/announcement-detail', '?announcementId=_5_1', true]];
  for (const [pathname, search, away] of cases) {
    const sent = [];
    const location = { pathname, search, hash: '', href: `https://bb.test${pathname}${search}` };
    const c = vm.createContext({ on: true, framed: '_2_1', PAGE: 'page', requestAnimationFrame() {}, nudge() {}, preview: false, ctx: { site: 'ultra' }, location, URLSearchParams, awayFrom: '', here: () => undefined, observeView() {},
      toTop: (op, m) => sent.push([op, m.url]), showing: '', frames: new Map(), loaded: true, last: '_2_1', lastPath: '', flag() {}, place() {}, draw() {}, lay() {}, later() {}, moved() {},
    });
    vm.runInContext(part('  const pass = ', '  const sync = ') + '\npass();', c);
    assert.deepEqual(sent, away ? [['away', `${pathname}${search}`]] : [], pathname + search);
  }
  const block = part("  if (framed && !preview && ctx.site !== 'canvas') document.addEventListener('click'", '  if (framed && !preview) {');
  for (const [pathname, search, away] of cases) {
    let listener; const sent = [];
    class Anchor {}
    const a = Object.assign(new Anchor(), { href: `https://bb.test${pathname}${search}`, getAttribute: () => `${pathname}${search}`, hasAttribute: (k) => k === 'href' });
    vm.runInNewContext(block, { framed: '_2_1', preview: false, ctx: { site: 'ultra' }, on: true, HTMLAnchorElement: Anchor, URL,
      location: { origin: 'https://bb.test', href: 'https://bb.test/ultra/courses/_2_1/announcements' }, document: { addEventListener: (_, f) => { listener = f; } },
      toTop: (op, m) => sent.push([op, m.url]),
    });
    listener({ isTrusted: true, composedPath: () => [a], preventDefault() {}, stopImmediatePropagation() {} });
    assert.deepEqual(sent, away ? [['away', `${pathname}${search}`]] : [], `click ${pathname}${search}`);
  }
});

// content-ultra.js's page-transition click handler (WP-U1 touches only this block there).
test('the page-transition click handler leaves Ultra\'s own Sign Out to the page and to course tabs', () => {
  const ultra = read('content-ultra.js');
  const block = part('  if (solo && document.startViewTransition) {', '  // ---- course colors and tint', ultra);
  for (const [href, held] of [['/ultra/stream', true], ['#', false], ['#help', false], ['', false], ['/webapps/login/?action=logout', false], ['/ultra/logout', false], ['/ultra/courses/_7_1/outline?title=logout-policy', true]]) {
    let listener, transitions = 0, handled = 0;
    class Element {}
    const link = Object.assign(new Element(), { matches: () => false, getAttribute: (k) => (k === 'href' ? href : null), click() {} });
    const target = Object.assign(new Element(), { closest: () => link });
    vm.runInNewContext(block, { solo: true, I: { observer: {} }, Element, html: { getAttribute: () => null, hasAttribute: () => false }, location: { href: 'https://bb.test/ultra/course' },
      document: { startViewTransition: () => { transitions++; const p = { catch: () => { handled++; } }; return (transition = { ready: p, finished: p }); }, addEventListener: (type, fn, capture) => { if (type === 'click' && capture) listener = fn; } } });
    const e = { target, button: 0, defaultPrevented: false, prevented: false, stopped: false, preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; } };
    listener(e);
    assert.equal(e.prevented, held, href);
    assert.equal(e.stopped, held, `${href}: later capture listeners (course tabs' onLeave) see the trusted click`);
    assert.equal(transitions, held ? 1 : 0, href);
    assert.equal(handled, held ? 2 : 0, `${href}: an aborted transition (a resize) rejects ready and finished, handled so the page sees no error`);
  }
});

test('Ultra\'s page-link crossfade starts only with the page world\'s guard there, and hands it the transition', () => {
  // Chrome rejects a skipped transition's ready in the page's own world too (lib/background.js transitionGuard).
  const ultra = read('content-ultra.js');
  const block = part('  if (solo && document.startViewTransition) {', '  // ---- course colors and tint', ultra);
  for (const guarded of [false, true]) for (const native of [false, true]) {
    let listener, transition, transitions = 0;
    class PageRevealEvent extends Event { constructor(type, init) { super(type); this.viewTransition = init.viewTransition; } }
    const events = [];
    class Element {}
    const link = Object.assign(new Element(), { matches: () => false, getAttribute: (k) => (k === 'href' ? '/ultra/stream' : null), click() {} });
    const target = Object.assign(new Element(), { closest: () => link });
    vm.runInNewContext(block, { solo: true, I: { observer: {} }, Element, Event, html: { getAttribute: () => null, hasAttribute: () => false }, location: { href: 'https://bb.test/ultra/course' },
      ...(native && { PageRevealEvent }),
      dispatchEvent: (e) => { if (!e.cancelable && native) assert.equal(e.viewTransition, transition, 'the exact transition in a native event'); events.push([e.type, e.cancelable, transitions]); if (guarded && e.cancelable) e.preventDefault(); return !e.defaultPrevented; },
      document: { activeViewTransition: null, startViewTransition: () => { transitions++; const p = { catch: () => {} }; return (transition = { ready: p, finished: p }); }, addEventListener: (type, fn, capture) => { if (type === 'click' && capture) listener = fn; } } });
    const e = { target, button: 0, defaultPrevented: false, prevented: false, stopped: false, preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; } };
    listener(e);
    assert.equal(e.prevented, guarded, guarded ? 'held for the crossfade' : 'without the guard the click is Ultra\'s, with no transition');
    assert.equal(transitions, guarded ? 1 : 0);
    assert.deepEqual(events, guarded ? [['glaze:transition', true, 0], ['glaze:transition', false, 1]] : [['glaze:transition', true, 0]]);
  }
});

test('RTL: injected Ultra UI uses logical sides, and the progress fill grows from the inline start', () => {
  const extras = read('extras.css'), tabs = read('features/coursetabs.css');
  const rule = (css, head) => { const i = css.indexOf(head); assert.ok(i >= 0, head); return css.slice(i, css.indexOf('}', i)); };
  const fill = rule(extras, '#gz-progress i::after');
  assert.match(fill, /inset-inline-start:\s*0/);
  assert.doesNotMatch(fill, /inset:\s*0 auto 0 0/);
  assert.match(extras, /#gz-progress i:dir\(rtl\)::after\s*\{[^}]*transform-origin:\s*right/, 'the grow animation starts at the right too');
  for (const head of ['.gz-draft {', '.gz-dl {', '[data-gz-new]::after {', ' .gz-new {', 'html .gz-new:is([data-kind="item"], [data-kind="inside"])']) {
    // Physical sides, or a four-value shorthand with different start and end sides.
    assert.doesNotMatch(rule(extras, head), /(?:margin|padding)-(?:left|right)|(?:margin|padding):\s*[^;\s]+\s+[^;\s]+\s+[^;\s]+\s+[^;\s]+/, head);
  }
  assert.match(rule(tabs, '#gz-ctabs .gz-ctab {'), /padding-inline:\s*11px 6px/);
  const narrow = tabs.slice(tabs.indexOf('@media (max-width: 700px)'));
  assert.match(rule(narrow, '#gz-ctabs .gz-ctabs-note {'), /inset-inline-end:\s*calc\(var\(--gz-float-end, 12px\) \+ 6px\)/);
  assert.doesNotMatch(rule(narrow, '#gz-ctabs .gz-ctabs-note {'), /[^-]right:/);
});
