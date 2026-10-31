// A course page's instant copy in a course tab's frame (navigation/page/coursetabs.js with courses/page/instant.js): the
// frame on screen while it loads shows its copy in place of its stand-in; the standby and frames kept hidden (warming
// ahead, Keep Course Content's outline under an item or its fresh outline) are never told to paint; the course bar the
// strip goes in is Ultra's, never a copy's. The frame's side: test/courses/ultra-instant.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.join(__dirname, '../../extension');
const source = fs.readFileSync(path.join(root, 'navigation/page/coursetabs.js'), 'utf8');
const L = require(path.join(root, 'navigation/coursetabs.js'));
const part = (a, b) => {
  const i = source.indexOf(a), j = source.indexOf(b, i);
  assert.ok(i >= 0 && j > i, `${a} … ${b}`);
  return source.slice(i, j);
};
const origin = 'https://bb.school.test';
const frameOf = (over = {}) => {
  const doc = { location: { origin, pathname: '/ultra/courses/_2_1/outline' } }, posted = [];
  const win = { postMessage: (m, o) => posted.push([structuredClone(m), o]) };
  return { url: '/ultra/courses/_2_1/outline', ready: false, dirty: false, posted, doc, el: { style: { visibility: 'hidden' }, contentDocument: doc, contentWindow: win }, ...over };
};
const copies = (over = {}) => {
  const did = [];
  const c = vm.createContext({ ctx: { site: 'ultra' }, on: true, framed: '', showing: '_2_1', frames: new Map(), spare: new Map(), location: { origin },
    post: (f, m) => f.el.contentWindow.postMessage(m, origin), unpicture: () => did.push('unpicture'), hoist: () => did.push('hoist'), ...over });
  const copyFrom = vm.runInContext(`${part("  // ---- a course page's copy in a tab's frame", '  const show = async (cid) => {')}\ncopyFrom;`, c);
  return { c, did, copyFrom };
};

test('the frame on screen while it loads is told to paint its copy, and shown with it in place of its stand-in', () => {
  const p = copies(), f = frameOf();
  p.c.frames.set('_2_1', f);
  p.copyFrom('_2_1', f, false);
  assert.deepEqual(f.posted, [[{ gzCtab: 'copy', picked: true }, origin]], 'asked: it is the one');
  assert.deepEqual(p.did, [], 'nothing to show yet');
  assert.equal(f.el.style.visibility, 'hidden');
  p.copyFrom('_2_1', f, true);
  assert.deepEqual(p.did, ['unpicture', 'hoist'], 'its stand-in goes');
  assert.equal(f.el.style.visibility, '', 'the frame shows, its copy over Ultra\'s page');
  assert.equal(f.copied, f.doc, 'remembered for its document');
  p.copyFrom('_2_1', f, false);
  assert.equal(f.copied, null);
});

test('no other frame is told to paint: hidden, kept beside its course, drawn, slow-stalled elsewhere, off, or on Canvas', () => {
  const cases = [
    ['another course on screen', (p, f) => { p.c.frames.set('_2_1', f); p.c.showing = '_3_1'; }],
    ['the page itself on screen', (p, f) => { p.c.frames.set('_2_1', f); p.c.showing = ''; }],
    ['kept beside its course (Keep Course Content)', (p, f) => { p.c.frames.set('_2_1', frameOf()); p.c.spare.set('_2_1', [f]); }],
    ['already drawn', (p, f) => { f.ready = true; p.c.frames.set('_2_1', f); }],
    ['course tabs off', (p, f) => { p.c.frames.set('_2_1', f); p.c.on = false; }],
    ['Canvas', (p, f) => { p.c.frames.set('_2_1', f); p.c.ctx = { site: 'canvas' }; }],
  ];
  for (const [why, set] of cases) {
    const p = copies(), f = frameOf();
    set(p, f);
    p.copyFrom('_2_1', f, true);
    assert.deepEqual(f.posted, [[{ gzCtab: 'copy', picked: false }, origin]], why);
    assert.deepEqual(p.did, [], why);
    assert.equal(f.el.style.visibility, 'hidden', why);
  }
});

test('the page around takes a frame\'s word about its copy from its own course frames only, never from the standby', () => {
  const at = source.indexOf('  const onAhead = ');
  const body = source.slice(at, source.indexOf('\n  };\n', at));
  const standby = body.indexOf('if (s && e.source === s.el.contentWindow)'), mine = body.indexOf("if (d.gzCtab === 'copy')"), found = body.indexOf('if (!f) return;');
  assert.ok(standby > 0 && found > standby && mine > found, 'after the standby\'s own messages and the frame lookup');
  assert.match(body, /if \(d\.gzCtab === 'copy'\) return copyFrom\(cid, f, d\.on === true\);/);
});

test('a frame showing its copy is never covered by its stand-in when it is shown again; another document\'s word doesn\'t count', async () => {
  for (const [why, same, covered] of [['its copy is up', true, false], ['an older document had one', false, true]]) {
    let created = 0;
    const f = frameOf();
    f.copied = same ? f.doc : {};
    const c = vm.createContext({ PAGE: 'page', showing: '_2_1', frames: new Map([['_2_1', f]]), pic: null, snaps: new Map([['_2_1', { cid: '_2_1' }]]), unpicture() {}, keep() {},
      fits: () => true, send: async () => null, html: { getAttribute: () => null, hasAttribute: () => false }, host: { append() {}, getBoundingClientRect: () => ({ x: 0, y: 0 }) }, innerWidth: 1280, innerHeight: 800, ctx: { site: 'ultra' }, t: (s) => s, L: { drawn: () => [] },
      document: { createElement: () => { created++; const el = { style: {}, attachShadow: () => ({ append() {}, prepend() {} }), setAttribute() {}, toggleAttribute() {}, addEventListener() {}, append() {} }; return el; } } });
    vm.runInContext(`${part('  const picture = ', '  const unpicture = ')}\npicture('_2_1', f);`, Object.assign(c, { f }));
    await new Promise(setImmediate);
    assert.equal(created > 0, covered, why);
    if (!covered) assert.equal(f.el.style.visibility, '', `${why}: shown at once, with its copy`);
  }
});

test('the strip goes in Ultra\'s own course bar, never a copy\'s', () => {
  const live = { localName: 'div', closest: () => null }, copy = { localName: 'div', closest: (s) => (s === '#gz-instant' ? {} : null) };
  const c = vm.createContext({ ctx: { site: 'ultra' }, document: { getElementsByClassName: () => [live, copy] } });
  const courseBar = vm.runInContext(`${part('  const bars = ', '  const topLayer = ')}\ncourseBar;`, c);
  assert.equal(courseBar(), live, 'a copy comes after Ultra\'s view in its main area');
  c.document.getElementsByClassName = () => [copy];
  const alone = vm.runInContext(`${part('  const bars = ', '  const topLayer = ')}\ncourseBar;`, c);
  assert.equal(alone(), null, 'only the copy\'s: none yet');
});
