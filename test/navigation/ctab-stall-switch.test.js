// A course tab's frame still loading (its picture, a blank, a slow page) has no strip of its own yet: the page's strip goes
// over it, in reach, so the student can switch or close tabs at once instead of waiting for Retry / Go back. Once the
// frame is drawn, the page's strip is back under it, out of reach, as before.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const source = read('features/coursetabs.js');
const L = require(path.join(root, 'lib/coursetabs.js'));
const { El } = require('./stand-in-dom.js');
const part = (a, b) => source.slice(source.indexOf(a), source.indexOf(b, source.indexOf(a)));
const origin = 'https://bb.school.test';

const rig = (site = 'ultra') => {
  const doc = { activeElement: null };
  doc.root = new El('html', doc); doc.body = new El('body', doc); doc.root.append(doc.body);
  const bar = new El('div', doc), strip = new El('div', doc), list = new El('div', doc), host = new El('div', doc);
  strip.id = 'gz-ctabs'; host.id = 'gz-ctabs-frames';
  strip.append(list); bar.append(strip); doc.body.append(bar, host);
  for (const cid of ['_1_1', '_2_1', '_3_1']) { const e = new El('div', doc); e.setAttribute('data-course-id', cid); list.append(e); }
  let now = 1000, fdoc = { location: { href: 'about:blank', pathname: 'blank', origin }, body: { childElementCount: 0 }, getElementById: () => null };
  const timers = [];
  const frame = (ready, contentDocument = () => null) => {
    const el = { style: { visibility: 'hidden' }, inert: true, contentWindow: { postMessage() {} }, focus() { doc.activeElement = el; }, get contentDocument() { return contentDocument(); } };
    return { at: 0, ready, url: '/ultra/courses/_2_1/outline', dirty: false, el };
  };
  const loading = frame(false, () => fdoc), drawn = frame(true);
  const frames = new Map([['_2_1', loading], ['_3_1', drawn]]);
  const c = vm.createContext({ PAGE: 'page', requestAnimationFrame() {}, nudge() {}, keepPage() {}, spare: new Map(), next: new Map(), popping: false,
    showTurn: 0, showing: '', shownFrom: '', shooting: null, on: true, framed: '', pic: null, waiting: '', primed: '', LIVE: 4, frames, host, strip, list, bar, L,
    ctx: { site, scene() {} }, html: { toggleAttribute() {} }, sessionStorage: { setItem() {}, removeItem() {} }, document: doc,
    location: { origin, pathname: '/ultra/courses/_1_1/outline', search: '' }, Date, Promise, performance: { now: () => now },
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimeout() {},
    MutationObserver: class { observe() {} disconnect() {} }, loading: () => false, shown: (e) => !!e && !e.hidden, t: (s) => s,
    hosted: () => false, keepClear() {}, measureRow() {}, handOn() {}, hostIn() {}, wait() {}, lay() {}, unpicture() {}, clearSlow() {},
    slowFrame() {}, picture() {}, draw() {}, later() {}, drop() {},
  });
  vm.runInContext(part('  const spot = ', '  const home = ') + "const home = () => spot('above', strip.parentElement === bar, () => bar.prepend(strip));\n"
    + part('  const place = ', '  // From content-ultra.js') + part('  let drawerFrom = ', '  const drawerOn = ')
    + part('  const show = async (cid) => {', '  // A tab: its frame') + part('  const watch = ', '  const open = ')
    + '\nglobalThis.show = show; globalThis.watch = watch; globalThis.hoist = typeof hoist === "function" ? hoist : null;', c);
  const tab = (cid) => list.querySelector(`[data-course-id="${cid}"]`);
  return { c, doc, bar, strip, host, loading, drawn, frames, tab, timers,
    built() { fdoc = { location: { href: `${origin}/ultra/courses/_2_1/outline`, pathname: '/ultra/courses/_2_1/outline', origin }, body: {}, documentElement: { matches: () => false },
      querySelector: (s) => (s === '.bb-course-navigation' ? {} : null), addEventListener() {}, getElementById: () => null }; },
    later(ms) { now += ms; const due = timers.splice(0); for (const x of due) x.fn(); },
    ownStrip(on) { fdoc.getElementById = (id) => (on && id === 'gz-ctabs' ? {} : null); },
  };
};

for (const site of ['ultra', 'canvas']) {
  test(`${site}: over a frame still loading, the page's strip is on screen and in reach, and focus goes to the picked tab`, async () => {
    const p = rig(site);
    await p.c.show('_2_1');
    assert.equal(p.strip.inert, false, 'the strip takes clicks and keys while the frame has none of its own');
    assert.equal(p.strip.parentElement, p.host, 'over the frame, not under it');
    assert.equal(p.strip.dataset.at, 'over');
    assert.equal(p.doc.activeElement, p.tab('_2_1'), 'focus on the picked tab, not in a blank frame');
    assert.notEqual(p.doc.activeElement, p.loading.el);
  });

  test(`${site}: switching away from a frame still loading keeps it loading, and coming back puts the strip over it again`, async () => {
    const p = rig(site);
    await p.c.show('_2_1');
    await p.c.show('_3_1');
    assert.equal(p.strip.inert, true, 'a drawn frame has its own strip: the page\'s is out of reach under it');
    assert.equal(p.strip.parentElement, p.bar, 'back in its place on the page');
    assert.equal(p.doc.activeElement, p.drawn.el, 'focus goes into the drawn frame');
    assert.equal(p.frames.get('_2_1'), p.loading, 'the loading frame is kept');
    assert.equal(p.loading.el.style.visibility, 'hidden');
    await p.c.show('_2_1');
    assert.equal(p.strip.inert, false);
    assert.equal(p.strip.parentElement, p.host);
    assert.equal(p.doc.activeElement, p.tab('_2_1'));
  });
}

test('once the frame on screen is drawn, the page\'s strip goes back under it, out of reach, and focus into the frame', async () => {
  const p = rig();
  await p.c.show('_2_1');
  p.c.watch('_2_1', p.loading);
  p.later(50);
  assert.equal(p.loading.ready, false);
  assert.equal(p.strip.parentElement, p.host, 'still over a blank frame');
  p.built(); p.later(50); p.later(400);
  assert.equal(p.loading.ready, true);
  assert.equal(p.strip.inert, true);
  assert.equal(p.strip.parentElement, p.bar);
  assert.equal(p.strip.dataset.at, 'above');
  assert.equal(p.doc.activeElement, p.loading.el, 'the focus the strip had goes on into the frame');
});

test('a slow frame on screen that has drawn its own strip keeps it alone: no second strip over it', async () => {
  const p = rig();
  await p.c.show('_2_1');
  assert.equal(p.strip.parentElement, p.host);
  p.loading.el.style.visibility = ''; p.ownStrip(true);
  p.c.hoist();
  assert.equal(p.strip.parentElement, p.bar);
  assert.equal(p.strip.inert, true);
  p.ownStrip(false); p.c.hoist();
  assert.equal(p.strip.parentElement, p.host, 'its strip gone again (a new page loading): the page\'s is back over it');
  assert.equal(p.strip.inert, false);
});

test('coursetabs.css: the strip over a loading frame sits at its top, above its picture and Retry, and is not hidden as a strip under a see-through frame', () => {
  const rules = [...read('features/coursetabs.css').replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, s, b]) => [s.trim(), b]);
  const z = (sel) => Number(rules.find(([s]) => s === sel)?.[1].match(/z-index:\s*(\d+)/)?.[1]);
  const over = rules.find(([s]) => s === '#gz-ctabs-frames > #gz-ctabs');
  assert.ok(over, 'a rule for the strip over the frames');
  assert.match(over[1], /position:\s*absolute/);
  assert.match(over[1], /top:\s*0/);
  assert.ok(z('#gz-ctabs-frames > #gz-ctabs') > Math.max(z('#gz-ctabs-frames > .gz-ctabs-pic'), z('.gz-ctabs-retry')));
  const hide = rules.filter(([s, b]) => s.includes('iframe[data-gz-through]') && /visibility:\s*hidden/.test(b));
  assert.ok(hide.length);
  for (const [s] of hide) assert.ok(s.endsWith('#gz-ctabs:not([data-at="over"])'), s);
});
