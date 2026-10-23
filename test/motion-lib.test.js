// lib/motion.js: Glaze's own UI in motion. A small fake DOM: <html>'s knobs as computed style, elements with a box,
// an animate() that records what it was asked and resolves when told.
const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../lib/motion.js');

const KNOBS = { '--gz-t-move': '0.32s', '--gz-t': '0.25s', '--gz-ease': 'cubic-bezier(0.22, 1, 0.36, 1)', '--gz-spring': 'linear(0, 1.06 26%, 1)', '--gz-enter': 'gz-in 0.6s ease backwards' };
const env = ({ knobs = KNOBS, vt = false, busy = false, hidden = false } = {}) => {
  const attrs = new Map();
  const runs = [];
  const html = {
    hasAttribute: (n) => attrs.has(n), setAttribute: (n, v) => attrs.set(n, String(v)), removeAttribute: (n) => attrs.delete(n), attrs,
    matches: (sel) => { if (sel === ':active-view-transition') return busy; throw new SyntaxError(sel); },
  };
  const doc = { documentElement: html, hidden };
  if (vt) doc.startViewTransition = (update) => {
    const t = { update, finished: null, updateCallbackDone: null };
    t.updateCallbackDone = Promise.resolve().then(update);
    t.finished = t.updateCallbackDone.then(() => {});
    runs.push(t);
    return t;
  };
  globalThis.document = doc;
  globalThis.getComputedStyle = (el) => (el === html ? { getPropertyValue: (n) => knobs[n] ?? '' } : { opacity: '1', position: el.position || 'relative' });
  return { html, runs };
};

const calls = [];
const el = (name, box, { linearOk = true } = {}) => {
  const e = {
    name, box: { ...box }, isConnected: true, inert: false, dataset: {}, style: {}, attrs: new Map(), anims: [],
    getBoundingClientRect() { const b = this.box; return { left: b.left, top: b.top, width: b.width, height: b.height }; },
    getClientRects() { return this.box.width || this.box.height ? [this.box] : []; },
    remove() { this.isConnected = false; this.removed = true; },
    setAttribute(n, v) { this.attrs.set(n, v); }, removeAttribute(n) { this.attrs.delete(n); }, hasAttribute(n) { return this.attrs.has(n); },
    animate(frames, o) {
      if (!linearOk && /^linear\(/.test(o.easing)) throw new TypeError('easing');
      let done, fail;
      const a = { frames, o, cancelled: false, finished: new Promise((r, j) => { done = r; fail = j; }) };
      a.cancel = () => { a.cancelled = true; fail(new Error('AbortError')); };
      a.finish = () => done(a);
      a.finished.catch(() => {});
      this.anims.push(a); calls.push({ el: this, a });
      return a;
    },
  };
  return e;
};

test('a CSS time in ms; anything else nothing', () => {
  assert.equal(M.ms('0.25s'), 250);
  assert.equal(M.ms(' 320ms '), 320);
  assert.equal(M.ms('.5s'), 500);
  for (const v of ['', 'none', '0s', undefined, 'calc(1s)', '-2s']) assert.equal(M.ms(v), 0, String(v));
});

test('with every knob at 0s a flip only makes the change: nothing animates', () => {
  env({ knobs: { ...KNOBS, '--gz-t-move': '0s', '--gz-t': '0s' } });
  const a = el('a', { left: 0, top: 0, width: 100, height: 20 });
  let ran = 0;
  const out = M.flip(() => [a], () => { ran++; a.box.left = 200; return 'done'; });
  assert.equal(out, 'done');
  assert.equal(ran, 1);
  assert.equal(a.anims.length, 0);
});

test('a moved element glides from where it showed, on translate with the spring, never transform', () => {
  env();
  const a = el('a', { left: 0, top: 0, width: 100, height: 20 }), b = el('b', { left: 100, top: 0, width: 100, height: 20 });
  M.flip(() => [a, b], () => { a.box.left = 100; b.box.left = 0; });
  const [fa] = a.anims, [fb] = b.anims;
  assert.deepEqual(fa.frames, [{ translate: '-100px 0px' }, { translate: '0px 0px' }]);
  assert.deepEqual(fb.frames, [{ translate: '100px 0px' }, { translate: '0px 0px' }]);
  assert.equal(fa.o.duration, 320);
  assert.equal(fa.o.easing, KNOBS['--gz-spring']);
  for (const f of [...fa.frames, ...fb.frames]) assert.ok(!('transform' in f));
  assert.equal(fa.o.composite, undefined, 'composite add keeps an animation off the compositor');
});

test('an element that did not move, or is skipped, is left alone; size scales only when asked', () => {
  env();
  const a = el('a', { left: 0, top: 0, width: 100, height: 20 }), drag = el('drag', { left: 100, top: 0, width: 100, height: 20 });
  M.flip(() => [a, drag], () => { drag.box.left = 300; }, { skip: (e) => e === drag });
  assert.equal(a.anims.length, 0);
  assert.equal(drag.anims.length, 0);
  const c = el('c', { left: 0, top: 0, width: 100, height: 20 });
  M.flip(() => [c], () => { c.box.width = 200; c.box.left = -50; }, { size: true });
  assert.deepEqual(c.anims[0].frames, [{ translate: '0px 0px', scale: '0.5 1' }, { translate: '0px 0px', scale: '1 1' }]);
});

test('a second flip mid-move starts from where the first has the element now', () => {
  env();
  const a = el('a', { left: 0, top: 0, width: 100, height: 20 });
  M.flip(() => [a], () => { a.box.left = 100; });
  const first = a.anims[0];
  // Halfway through, the element shows at 50 (what getBoundingClientRect reports with the move running).
  a.box.left = 50;
  M.flip(() => [a], () => {}, {});
  // The new layout is measured without the old move: cancelling it puts the box back to its true place.
  assert.equal(first.cancelled, true);
});

test('a flip keyed across a rebuild matches the new element to the old one', () => {
  env();
  const old = el('old', { left: 0, top: 0, width: 100, height: 20 }); old.dataset.id = 'x';
  const neu = el('new', { left: 120, top: 0, width: 100, height: 20 }); neu.dataset.id = 'x';
  let list = [old];
  M.flip(() => list, () => { old.isConnected = false; list = [neu]; }, { key: (e) => e.dataset.id });
  assert.deepEqual(neu.anims[0].frames[0], { translate: '-120px 0px' });
});

test('new elements fade in only with entrances on', () => {
  env();
  const a = el('a', { left: 0, top: 0, width: 10, height: 10 });
  let list = [];
  M.flip(() => list, () => { list = [a]; });
  assert.deepEqual(a.anims[0].frames, [{ opacity: 0, scale: 0.94 }, { opacity: 1, scale: 1 }]);
  env({ knobs: { ...KNOBS, '--gz-enter': 'none' } });
  const b = el('b', { left: 0, top: 0, width: 10, height: 10 });
  list = [];
  M.flip(() => list, () => { list = [b]; });
  assert.equal(b.anims.length, 0);
});

test('a curve the browser does not know falls back to a plain one rather than failing the move', () => {
  env();
  const a = el('a', { left: 0, top: 0, width: 100, height: 20 }, { linearOk: false });
  M.flip(() => [a], () => { a.box.top = 40; });
  assert.equal(a.anims.length, 1);
  assert.equal(a.anims[0].o.easing, 'ease-out');
});

test('exit fades, cannot be used while it goes, then removes; at once with transitions off', async () => {
  env();
  const a = el('a', { left: 0, top: 0, width: 10, height: 10 });
  const p = M.exit(a, { to: { translate: '0 8px' } });
  assert.equal(a.inert, true);
  assert.deepEqual(a.anims[0].frames[1], { opacity: 0, scale: 0.96, translate: '0 8px' });
  assert.equal(a.removed, undefined);
  a.anims[0].finish();
  await p;
  assert.equal(a.removed, true);

  env({ knobs: { ...KNOBS, '--gz-t': '0s' } });
  const b = el('b', { left: 0, top: 0, width: 10, height: 10 });
  await M.exit(b);
  assert.equal(b.removed, true);
  assert.equal(b.anims.length, 0);

  const gone = el('gone', { left: 0, top: 0, width: 10, height: 10 });
  gone.isConnected = false;
  await M.exit(gone);
  assert.equal(gone.anims.length, 0);
});

test('exit with remove: false keeps the element and gives it back usable', async () => {
  env();
  const a = el('a', { left: 0, top: 0, width: 10, height: 10 });
  const p = M.exit(a, { remove: false });
  a.anims[0].finish();
  await p;
  assert.equal(a.removed, undefined);
  assert.equal(a.inert, false);
  assert.equal(a.anims[0].cancelled, true, 'the fade lets go once the caller has hidden it');
});

test('pop never plays with transitions off', () => {
  env({ knobs: { ...KNOBS, '--gz-t': '0s' } });
  const a = el('a', { left: 0, top: 0, width: 10, height: 10 });
  assert.equal(M.pop(a), null);
  env();
  assert.ok(M.pop(a));
  assert.deepEqual(a.anims[0].frames.map((f) => f.scale), [1, 1.18, 1]);
});

test('swap crossfades only where it can: otherwise the change runs now', async () => {
  let n = 0;
  const update = () => { n++; };
  env(); // no view transitions
  await M.swap(update);
  assert.equal(n, 1);
  for (const o of [{ vt: true, busy: true }, { vt: true, hidden: true }, { vt: true, knobs: { ...KNOBS, '--gz-t': '0s' } }]) {
    const { runs } = env(o);
    M.swap(update);
    assert.equal(runs.length, 0, JSON.stringify(o));
  }
  assert.equal(n, 4, 'each ran at once');
  const framed = env({ vt: true });
  framed.html.setAttribute('data-gz-ctab-framed', '');
  M.swap(update);
  assert.equal(framed.runs.length, 0);

  const { html, runs } = env({ vt: true });
  const p = M.swap(update);
  assert.equal(runs.length, 1);
  assert.equal(html.attrs.has('data-gz-swap'), true);
  // A second one while the first runs does not start another: it just makes its change.
  M.swap(update);
  assert.equal(runs.length, 1);
  await p;
  await runs[0].finished;
  await new Promise((r) => setImmediate(r));
  assert.equal(html.attrs.has('data-gz-swap'), false);
});

test('motion.css defines the move knob at every level and zeroes it with transitions', () => {
  const css = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'motion.css'), 'utf8');
  assert.match(css, /:root \{[^}]*--gz-t-move: 0\.32s/);
  assert.match(css, /html\[data-gz-motion="expressive"\] \{[^}]*--gz-t-move:/);
  assert.match(css, /html\[data-gz-motion="off"\], html\[data-gz-no-trans\] \{[^}]*--gz-t-move: 0s/);
  assert.match(css, /html:not\(\[data-gz-motion\]\) \{[^}]*--gz-t-move: 0s/);
});

test('one that was not drawn before comes in where it is, not across the page from the corner', () => {
  env();
  const row = el('row', { left: 0, top: 0, width: 0, height: 0 }); // display: none
  M.flip(() => [row], () => { row.box = { left: 40, top: 300, width: 200, height: 30 }; });
  assert.equal(row.anims.length, 1);
  assert.deepEqual(row.anims[0].frames, [{ opacity: 0, scale: 0.94 }, { opacity: 1, scale: 1 }]);
  const hidden = el('hidden', { left: 0, top: 0, width: 0, height: 0 });
  M.flip(() => [hidden], () => {}); // still not drawn: nothing to play
  assert.equal(hidden.anims.length, 0);
});

test('an exit that removes something still gliding stops the glide with it', async () => {
  env();
  const a = el('a', { left: 0, top: 0, width: 100, height: 20 });
  M.flip(() => [a], () => { a.box.top = 50; });
  const glide = a.anims[0];
  const p = M.exit(a);
  a.anims[1].finish();
  await p;
  assert.equal(glide.cancelled, true);
  assert.equal(a.removed, true);
});

test('an element a change removes while it glides has its glide stopped with it', () => {
  env();
  const a = el('a', { left: 0, top: 0, width: 100, height: 20 }), b = el('b', { left: 0, top: 30, width: 100, height: 20 });
  M.flip(() => [a, b], () => { a.box.top = 30; b.box.top = 0; });
  const glide = a.anims[0];
  M.flip(() => [a, b].filter((e) => e.isConnected), () => { a.isConnected = false; });
  assert.equal(glide.cancelled, true);
});

test('swap never crossfades inside a frame: a course tab\'s copy of the background must stay in step with the page', () => {
  const { runs } = env({ vt: true });
  let n = 0;
  const top = {};
  globalThis.window = { top };
  try {
    M.swap(() => { n++; });
    assert.equal(runs.length, 0);
    assert.equal(n, 1, 'it ran at once');
  } finally { delete globalThis.window; }
});
