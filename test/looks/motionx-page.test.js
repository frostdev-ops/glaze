// Look parts that move, on the page (features/motionx.js): how the animations reach the page and what a quiz page gets.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const M = require('../lib/motionx.js');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const ENTER = { s: [{ at: 0, y: 20, o: 0 }, { at: 1, y: 0, o: 1 }], ms: 500, ease: 'spring', delay: 0, stagger: 80 };

// ---- features/motionx.js ----------------------------------------------------------------------------------------------------------
const feature = ({ adopt = true, parts = null, level = 'subtle', quiet = false, extras = { pointer: 'look', pointerAnim: true } } = {}) => {
  const styles = [], listeners = {}, handlers = {}, queue = new Map(), switches = new Set(), canvases = [];
  let on = true, fills = 0, styleReads = 0;
  let adopted = [], now = 1000, ids = 0;
  class Sheet { replaceSync(text) { this.text = text; } }
  // A 2D context that accepts any call, and a canvas that knows whether it is on the page.
  const context = new Proxy({}, { get: (t, k) => (k in t ? t[k] : () => ({ addColorStop() {} })), set: (t, k, v) => { t[k] = v; return true; } });
  context.fill = () => { fills++; };
  const html = { getAttribute: (k) => (k === 'data-gz-motion' ? level : null), hasAttribute: (k) => switches.has(k), style: { getPropertyValue: () => '#336699' }, append: (s) => { s.isConnected = true; styles.push(s); } };
  const document = {
    documentElement: html, hidden: false, head: null,
    body: { append: (c) => { c.isConnected = true; canvases.push(c); } },
    get adoptedStyleSheets() { return adopted; },
    set adoptedStyleSheets(v) { if (!adopt) throw new TypeError('not allowed'); adopted = v; },
    addEventListener: (t, f) => { listeners[t] = f; }, removeEventListener: (t) => { delete listeners[t]; },
    createElement: (tag) => (tag === 'canvas'
      ? { id: '', style: {}, isConnected: false, setAttribute() {}, getContext: () => context, remove() { this.isConnected = false; } }
      : { style: {}, setAttribute() {}, attachShadow: () => ({ append() {} }), replaceChildren() {}, isConnected: false, remove() { this.isConnected = false; }, set textContent(v) { this._t = v; }, get textContent() { return this._t; } }),
  };
  const ctx = vm.createContext({ document, location: { pathname: '/ultra/course' }, CSSStyleSheet: Sheet, performance: { now: () => now }, innerWidth: 800, innerHeight: 600, devicePixelRatio: 1,
    matchMedia: () => ({ matches: false }), addEventListener: (t, f) => { handlers[t] = f; }, removeEventListener: (t) => { delete handlers[t]; },
    requestAnimationFrame: (f) => { queue.set(++ids, f); return ids; }, cancelAnimationFrame: (id) => { queue.delete(id); }, Object, Promise, Number, Math, Array, Map, RegExp, String, WeakMap,
    getComputedStyle: () => { styleReads++; return {}; }, getSelection: () => null });
  ctx.globalThis = ctx;
  ctx.window = ctx;
  ctx.GZ_MX = M;
  ctx.GZ_LX = { quiet: () => quiet };
  const settings = { extras };
  ctx.GZ_CTX = { on: () => on, need: () => Promise.resolve(), parts: () => parts, settings: () => settings };
  vm.runInContext(read('features/motionx.js'), ctx);
  // Frames the browser would run: every callback asked for, 16 ms apart.
  const tick = (ms = 16) => { now += ms; const run = [...queue]; queue.clear(); if (run.length > 4) throw new Error(`${run.length} frame loops running at once`); for (const [, f] of run) f(now); };
  return { settings, api: ctx.GZ_MOTIONX, adopted: () => adopted, styles, listeners, handlers, document, ctx, queue, tick, now: () => now, canvases, switches, fills: () => fills, setOn: (v) => { on = v; }, setParts: (v) => { parts = v; }, setQuiet: (v) => { quiet = v; }, styleReads: () => styleReads };
};
const settle = () => new Promise(setImmediate);

test('animations go on the page as a constructed stylesheet, and off removes it', async () => {
  const x = feature({ parts: { anim: { 'card.enter': ENTER } } });
  await x.api.sync();
  await settle();
  assert.equal(x.adopted().length, 1);
  assert.equal(x.adopted()[0].text, M.compile({ 'card.enter': ENTER }));
  assert.equal(x.styles.length, 0, 'no <style> element, which a strict style-src would refuse');
  await x.api.sync();
  await settle();
  assert.equal(x.adopted().length, 1, 'the same text again: the same sheet');
  x.api.off();
  assert.equal(x.adopted().length, 0);
});

test('a page that took its adopted sheets back gets ours put back at the next sync', async () => {
  const x = feature({ parts: { anim: { 'card.enter': ENTER } } });
  await x.api.sync();
  await settle();
  x.document.adoptedStyleSheets = [];
  await x.api.sync();
  await settle();
  assert.equal(x.adopted().length, 1);
});

test('a browser that cannot adopt a sheet gets a <style> element', async () => {
  const x = feature({ adopt: false, parts: { anim: { 'card.enter': ENTER } } });
  await x.api.sync();
  await settle();
  assert.equal(x.styles.length, 1);
  assert.equal(x.styles[0].textContent, M.compile({ 'card.enter': ENTER }));
  x.api.off();
  assert.equal(x.styles[0].isConnected, false);
});

test('a Look without animations leaves the page as it was; a quiz page gets nothing', async () => {
  for (const parts of [null, {}, { bg: {} }, { fx: { complete: {} } }]) {
    const x = feature({ parts });
    await x.api.sync();
    await settle();
    assert.equal(x.adopted().length, 0, JSON.stringify(parts));
  }
  const quiz = feature({ quiet: true, parts: { anim: { 'card.enter': ENTER }, fx: { complete: {} } } });
  await quiz.api.sync();
  await settle();
  assert.equal(quiz.adopted().length, 0);
  assert.equal(quiz.api.has('complete'), false);
});

test('has() says whether the Look has an effect for an event', async () => {
  const x = feature({ parts: { fx: { complete: { kind: 'ring' }, 'bogus': {} } } });
  assert.equal(x.api.has('complete'), false, 'not before it has read the parts');
  await x.api.sync();
  await settle();
  assert.equal(x.api.has('complete'), true);
  assert.equal(x.api.has('submit'), false);
  assert.equal(x.api.has('bogus'), false);
  assert.equal(x.api.has('constructor'), false);
  x.api.off();
  assert.equal(x.api.has('complete'), false);
});

test('motionx never reads the page\'s styles or sweeps it, and runs no timer under a minute', () => {
  const src = read('features/motionx.js').replace(/\/\/[^\n]*/g, '');
  assert.doesNotMatch(src, /getComputedStyle|querySelectorAll|setInterval|innerHTML|insertAdjacentHTML|outerHTML/);
  assert.doesNotMatch(read('lib/motionx.js').replace(/\/\/[^\n]*/g, ''), /document|window|innerHTML|eval|Function\(/);
});

test('the pointer effect runs one frame loop while the pointer moves, and none once everything has faded', async () => {
  const x = feature({ parts: { cursor: { kind: 'trail', c: ['accent'], size: 10, len: 8, fade: 300 } } });
  const canvas = () => x.document.body.last;
  let canvasOnPage = 0;
  x.document.body.append = (c) => { c.isConnected = true; x.document.body.last = c; canvasOnPage++; };
  await x.api.sync();
  await settle();
  assert.ok(x.handlers.pointermove, 'listening for the pointer');
  let most = 0, frames = 0;
  for (let i = 0; i < 40; i++) {
    x.handlers.pointermove({ pointerType: 'mouse', clientX: 50 + i * 12, clientY: 100 + (i % 5) * 6 });
    most = Math.max(most, x.queue.size);
    frames += x.queue.size;
    x.tick();
    most = Math.max(most, x.queue.size);
  }
  assert.equal(most, 1, `never more than one frame asked for at a time (saw ${most})`);
  assert.ok(canvas().isConnected && canvas().id === 'gz-fx', 'a canvas while it moves');
  for (let i = 0; i < 60; i++) x.tick();
  assert.equal(canvas().isConnected, false, 'the canvas is gone once the trail has faded');
  assert.equal(x.queue.size, 0, 'and no frame is asked for');
  assert.equal(canvasOnPage, 1, 'one canvas for the whole stroke');
  x.handlers.pointermove({ pointerType: 'touch', clientX: 5, clientY: 5 });
  assert.equal(x.queue.size, 0, 'a finger draws nothing');
  x.api.off();
  assert.equal(x.handlers.pointermove, undefined, 'off stops listening');
});

test('an event effect plays once, with one frame loop, and removes its canvas', async () => {
  const x = feature({ parts: { fx: { complete: { kind: 'confetti', count: 60, life: 800 } } } });
  let last = null;
  x.document.body.append = (c) => { c.isConnected = true; last = c; };
  await x.api.sync();
  await settle();
  x.listeners['glaze:moment']({ detail: { name: 'complete', x: 100, y: 100 } });
  x.listeners['glaze:moment']({ detail: { name: 'complete', x: 100, y: 100 } });
  assert.equal(x.queue.size, 1, 'the second moment inside the same breath is not a second effect');
  let most = 0;
  for (let i = 0; i < 80 && x.queue.size; i++) { x.tick(); most = Math.max(most, x.queue.size); }
  assert.equal(most, 1);
  assert.equal(last.isConnected, false, 'removed when it has finished');
  assert.equal(x.queue.size, 0);
  // Not a name the Look has, not a page-made event with junk in it.
  for (const detail of [{ name: 'submit' }, { name: 'constructor' }, { name: 7 }, null, undefined, 'complete']) { x.listeners['glaze:moment']({ detail }); assert.equal(x.queue.size, 0, JSON.stringify(detail)); }
});

test('motion off or a hidden page: an event draws nothing and a running effect ends', async () => {
  for (const level of ['off']) {
    const x = feature({ level, parts: { fx: { complete: {} } } });
    await x.api.sync();
    await settle();
    x.listeners['glaze:moment']({ detail: { name: 'complete' } });
    assert.equal(x.queue.size, 0, level);
  }
  const x = feature({ parts: { fx: { complete: { life: 2000 } } } });
  let last = null;
  x.document.body.append = (c) => { c.isConnected = true; last = c; };
  await x.api.sync();
  await settle();
  x.listeners['glaze:moment']({ detail: { name: 'complete' } });
  x.tick();
  assert.ok(last.isConnected);
  x.document.hidden = true;
  x.listeners.visibilitychange();
  assert.equal(last.isConnected, false, 'hiding the page takes the canvas away');
  assert.equal(x.queue.size, 0);
});


test('the student\'s pointer animation switch: off, the Look\'s pointer animation stops and nothing listens; on, it plays again', async () => {
  const look = { cursor: { kind: 'trail', fade: 300 }, fx: { complete: {} }, type: { kind: 'sparks' } };
  const x = feature({ parts: look, extras: { pointer: 'look', pointerAnim: false } });
  await x.api.sync();
  await settle();
  assert.equal(x.handlers.pointermove, undefined, 'no pointer listener with the animation off');
  // The Look's other effects stay: an event still plays, and typing still listens.
  assert.equal(x.api.has('complete'), true);
  assert.equal(typeof x.listeners.input, 'function', 'typing still listens');
  // Turned on (applySettings asks again): the Look's animation plays while the pointer moves.
  x.settings.extras = { ...x.settings.extras, pointerAnim: true };
  await x.api.sync();
  assert.equal(typeof x.handlers.pointermove, 'function');
  x.handlers.pointermove({ pointerType: 'mouse', clientX: 50, clientY: 60 });
  x.tick();
  assert.ok(x.canvases.at(-1)?.isConnected, 'drawn around the pointer');
  // Off again while particles are alive: they go, with the listener, and no frame is left asked for.
  x.settings.extras = { ...x.settings.extras, pointerAnim: false };
  await x.api.sync();
  assert.equal(x.handlers.pointermove, undefined);
  assert.equal(x.canvases.at(-1).isConnected, false);
  assert.equal(x.queue.size, 0);
  // The setting never touches the Look: its parts are as they were.
  assert.deepEqual(look.cursor, { kind: 'trail', fade: 300 });
});

test('the custom pointer switch off: no pointer animation, whatever the animation switch says; on, it plays again', async () => {
  const look = { cursor: { kind: 'trail', fade: 300 }, type: { kind: 'sparks' } };
  const x = feature({ parts: look, extras: { pointer: 'aqua', pointerOn: false, pointerAnim: true } });
  await x.api.sync();
  await settle();
  assert.equal(x.handlers.pointermove, undefined, 'no pointer listener with the custom pointer off');
  assert.equal(typeof x.listeners.input, 'function', 'typing still listens');
  x.settings.extras = { ...x.settings.extras, pointerOn: true };
  await x.api.sync();
  assert.equal(typeof x.handlers.pointermove, 'function');
  x.handlers.pointermove({ pointerType: 'mouse', clientX: 50, clientY: 60 });
  x.tick();
  assert.ok(x.canvases.at(-1)?.isConnected, 'drawn around the pointer');
  x.settings.extras = { ...x.settings.extras, pointerOn: false };
  await x.api.sync();
  assert.equal(x.handlers.pointermove, undefined);
  assert.equal(x.canvases.at(-1).isConnected, false);
});

test('changing or removing a Look cancels its running particles without adding pointer listeners', async () => {
  const x = feature({ parts: { cursor: { kind: 'glow' }, fx: { complete: {} } } });
  await x.api.sync();
  const move = x.handlers.pointermove;
  x.listeners['glaze:moment']({ detail: { name: 'complete' } });
  assert.ok(x.canvases.at(-1).isConnected);
  x.setParts({ cursor: { kind: 'ripple' } });
  await x.api.sync();
  assert.equal(x.canvases.at(-1).isConnected, false);
  assert.equal(x.queue.size, 0);
  assert.equal(x.handlers.pointermove, move);
  x.handlers.pointerdown({ pointerType: 'mouse', clientX: 20, clientY: 30 });
  x.setParts(null);
  await x.api.sync();
  assert.equal(x.canvases.at(-1).isConnected, false);
  assert.equal(x.handlers.pointermove, undefined);
});

for (const stop of ['invalidation', 'quiet', 'pagehide']) test(`${stop} drops active particles and the animation sheet`, async () => {
  const x = feature({ parts: { anim: { 'card.enter': ENTER }, cursor: { kind: 'glow' }, fx: { complete: {} } } });
  await x.api.sync();
  x.listeners['glaze:moment']({ detail: { name: 'complete' } });
  if (stop === 'invalidation') x.setOn(false);
  if (stop === 'quiet') x.setQuiet(true);
  if (stop === 'pagehide') {
    assert.equal(typeof x.handlers.pagehide, 'function');
    x.handlers.pagehide();
  } else x.tick();
  assert.equal(x.queue.size, 0);
  assert.equal(x.canvases.at(-1).isConnected, false);
  assert.equal(x.adopted().length, 0);
  assert.equal(x.handlers.pointermove, undefined);
  if (stop === 'pagehide') {
    x.listeners['glaze:moment']({ detail: { name: 'complete' } });
    assert.equal(x.queue.size, 0);
    x.handlers.pageshow();
    await settle();
    assert.equal(x.adopted().length, 1, 'a restored page can animate again');
  }
});

test('hover off removes existing cursor particles on the next frame', async () => {
  for (const kind of M.CURSORS) {
    const x = feature({ parts: { cursor: { kind, fade: 2000 } } });
    await x.api.sync();
    x.handlers.pointermove({ pointerType: 'mouse', clientX: 20, clientY: 30 });
    x.tick();
    x.handlers.pointermove({ pointerType: 'mouse', clientX: 200, clientY: 30 });
    x.tick();
    assert.ok(x.canvases.at(-1).isConnected, kind);
    x.switches.add('data-gz-no-hover');
    x.tick();
    assert.equal(x.queue.size, 0, kind);
    assert.equal(x.canvases.at(-1).isConnected, false, kind);
  }
});

test('a glow resumes drawing after the page was hidden', async () => {
  const x = feature({ parts: { cursor: { kind: 'glow' } } });
  await x.api.sync();
  x.handlers.pointermove({ pointerType: 'mouse', clientX: 20, clientY: 30 });
  x.tick();
  const before = x.fills();
  assert.ok(before > 0);
  x.document.hidden = true;
  x.listeners.visibilitychange();
  x.document.hidden = false;
  x.handlers.pointermove({ pointerType: 'mouse', clientX: 200, clientY: 30 });
  x.tick();
  assert.ok(x.fills() > before, 'the new canvas contains a glow');
});

// ---- typing --------------------------------------------------------------------------------------------------------------------
// A text field as a page has it; `attrs` for autocomplete. Its value is what the student typed.
const field = (tag = 'input', type = 'text', attrs = {}) => ({
  tagName: tag.toUpperCase(), type, value: 'my secret essay', selectionEnd: 15, scrollLeft: 0, scrollTop: 0, isConnected: true, isContentEditable: false,
  matches: (sel) => sel.split(',').some((s) => s.trim() === tag) || (sel === 'input, textarea' && ['input', 'textarea'].includes(tag)),
  getAttribute: (k) => attrs[k] ?? null, getBoundingClientRect: () => ({ left: 100, top: 200, right: 400, bottom: 230, width: 300, height: 30 }),
});
// An input event that throws if anything reads what was typed (its data).
const typed = (target, inputType = 'insertText', isComposing = false) => new Proxy({ target, inputType, isComposing, composedPath: () => [target] }, {
  get: (o, k) => { if (k === 'data' || k === 'dataTransfer') throw new Error('read what was typed'); return o[k]; },
});
const TYPE = { type: { kind: 'embers', c: ['warn'] } };

test('typing: no listener and no canvas unless the Look has a typing effect', async () => {
  const x = feature({ parts: { cursor: { kind: 'glow' } } });
  await x.api.sync();
  await settle();
  assert.equal(x.listeners.input, undefined);
  x.setParts(TYPE);
  await x.api.sync();
  await settle();
  assert.equal(typeof x.listeners.input, 'function');
  x.setParts(null);
  await x.api.sync();
  await settle();
  assert.equal(x.listeners.input, undefined, 'and it goes with the part');
});

test('typing: particles at the field, one measurement a frame however many keys, and nothing typed is read', async () => {
  const x = feature({ parts: TYPE });
  await x.api.sync();
  await settle();
  const f = field();
  for (let i = 0; i < 10; i++) x.listeners.input(typed(f));
  assert.equal(x.queue.size, 1, 'one frame asked for');
  x.tick();
  assert.equal(x.canvases.length, 1, 'a canvas for the particles');
  assert.equal(x.styleReads(), 0, 'no field style read');
  x.listeners.input(typed(f));
  x.tick();
  assert.equal(x.styleReads(), 0, 'nor for the next key');
  for (let i = 0; i < 200; i++) x.tick();
  assert.equal(x.canvases[0].isConnected, false, 'gone once they have faded');
});

test('typing: never in a password, card or one-time-code field, never while composing, never deleting, never with motion off', async () => {
  const quietFields = [field('input', 'password'), field('input', 'text', { autocomplete: 'cc-number' }), field('input', 'text', { autocomplete: 'section-pay billing cc-csc' }),
    field('input', 'text', { autocomplete: 'one-time-code' }), field('input', 'number'), field('input', 'checkbox'),
    field('input', 'text', { autocomplete: 'current-password' }), field('input', 'text', { autocomplete: 'section-login New-Password' })];
  for (const f of quietFields) {
    const x = feature({ parts: TYPE });
    await x.api.sync();
    await settle();
    x.listeners.input(typed(f));
    assert.equal(x.queue.size, 0, `${f.type} ${f.getAttribute('autocomplete')}`);
  }
  const x = feature({ parts: TYPE });
  await x.api.sync();
  await settle();
  const f = field('textarea', 'textarea');
  x.listeners.compositionstart({ type: 'compositionstart' });
  x.listeners.input(typed(f));
  x.listeners.input(typed(f, 'insertCompositionText', true));
  assert.equal(x.queue.size, 0, 'composing');
  x.listeners.compositionend({ type: 'compositionend' });
  x.listeners.input(typed(f, 'deleteContentBackward'));
  assert.equal(x.queue.size, 0, 'deleting');
  x.listeners.input(typed(f));
  assert.equal(x.queue.size, 1, 'typing again');
  const off = feature({ parts: TYPE, level: 'off' });
  await off.api.sync();
  await settle();
  off.listeners.input(typed(field()));
  assert.equal(off.queue.size, 0, 'motion off');
  const quiz = feature({ parts: TYPE });
  await quiz.api.sync();
  await settle();
  quiz.setQuiet(true);
  quiz.listeners.input(typed(field()));
  assert.equal(quiz.queue.size, 0, 'a quiz');
});

test('the pointer\'s new animations run while it moves and stop once they have faded', async () => {
  for (const cursor of [{ kind: 'orbit', shape: 'bat', len: 3 }, { kind: 'flicker', c: ['accent', 'warn'] }, { kind: 'scan' }, { kind: 'drift', shape: 'petal' }]) {
    const x = feature({ parts: { cursor } });
    await x.api.sync();
    await settle();
    for (let i = 0; i < 30; i++) {
      x.handlers.pointermove({ pointerType: 'mouse', clientX: 50 + i * 10, clientY: 100 });
      x.tick();
      assert.ok(x.queue.size <= 1, cursor.kind);
    }
    assert.ok(x.canvases.at(-1).isConnected, `${cursor.kind}: drawing while it moves`);
    for (let i = 0; i < 300; i++) x.tick();
    assert.equal(x.queue.size, 0, `${cursor.kind}: no frames once it has faded`);
    assert.equal(x.canvases.at(-1).isConnected, false, `${cursor.kind}: canvas gone`);
  }
});


test('typing never reads field text, including through a shadow root event path', async () => {
  for (const tag of ['input', 'textarea']) {
    const x = feature({ parts: TYPE });
    await x.api.sync();
    let reads = 0;
    const f = field(tag);
    for (const k of ['value', 'textContent', 'innerText']) Object.defineProperty(f, k, { get() { reads++; throw new Error('private text'); } });
    const e = typed(f);
    x.listeners.input({ target: {}, inputType: e.inputType, composedPath: () => [f, {}] });
    x.tick();
    assert.equal(reads, 0, tag);
    assert.equal(x.canvases.length, 1, 'uses field geometry without its contents');
  }
});

test('typing rechecks sensitive fields and composition before a queued frame', async () => {
  for (const change of ['password', 'autocomplete', 'composition']) {
    const x = feature({ parts: TYPE });
    await x.api.sync();
    const attrs = {}, f = field('input', 'text', attrs);
    x.listeners.input(typed(f));
    if (change === 'password') f.type = 'password';
    if (change === 'autocomplete') attrs.autocomplete = 'cc-number';
    if (change === 'composition') x.listeners.compositionstart({ type: 'compositionstart' });
    x.tick();
    assert.equal(x.canvases.length, 0, change);
    assert.equal(x.queue.size, 0, change);
  }
});

test('changing Looks discards typing queued by the previous Look', async () => {
  const x = feature({ parts: TYPE });
  await x.api.sync();
  x.listeners.input(typed(field()));
  x.setParts({ type: { kind: 'snow' } });
  await x.api.sync();
  assert.equal(x.queue.size, 0, 'no stale typing measurement');
  x.tick();
  assert.equal(x.canvases.length, 0, 'the new Look starts without the previous key');
});

test('the contour pointer keeps at most three live rings, even with a longer imported part', async () => {
  const x = feature({ parts: { cursor: { kind: 'contour', len: 24, size: 22, fade: 650 } } });
  const made = [], original = M.contour;
  M.contour = (...args) => { const p = original(...args); made.push(p); return p; };
  try {
    await x.api.sync();
    for (let i = 0; i < 12; i++) {
      x.handlers.pointermove({ pointerType: 'mouse', clientX: 40 + i * 30, clientY: 100 });
      x.tick();
      assert.ok(made.filter(M.alive).length <= 3, 'at most three live contour rings');
    }
    assert.equal(made.filter(M.alive).length, 3, 'the capped effect still draws');
    for (let i = 0; i < 60; i++) x.tick();
    assert.equal(x.queue.size, 0, 'nothing at rest');
    assert.equal(x.canvases.at(-1).isConnected, false);
  } finally { M.contour = original; x.api.off(); }
});
