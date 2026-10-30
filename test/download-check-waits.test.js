const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// scripts/download-check.js's waits around Download all, without Chromium: the rest before its click and the Allow frame's
// four states, each miss named.
const source = fs.readFileSync(path.join(__dirname, '../scripts/download-check.js'), 'utf8');
const context = vm.createContext({ setTimeout, clearTimeout, Date, id: 'ext' });
vm.runInContext(source.slice(source.indexOf('const pause ='), source.indexOf('\n(async () => {')).replace('const SLOW = 60000;', 'const SLOW = 400;')
  + '\nglobalThis.helpers = { resting, allowFrame, press, until, pressAllow: typeof pressAllow === "undefined" ? undefined : pressAllow };', context);
const { resting, allowFrame, press, until, pressAllow } = context.helpers;

const anim = (endTime, playState = 'running') => ({ playState, effect: { getComputedTiming: () => ({ endTime }) } });
const node = (rect, { parent = null, anims = [], ...rest } = {}) => ({ anims, rect, parentElement: parent, parentNode: parent, ...rest,
  getAnimations() { return this.anims; }, getBoundingClientRect() { const [x, y, width, height] = this.rect; return { x, y, width, height }; }, hasAttribute(a) { return !!this[a]; } });
const run = (fn, arg, r) => vm.runInNewContext(`(${fn})(${JSON.stringify(arg)})`, { scrollX: 0, scrollY: 0, ...r });
const doc = (byId, bySelector = {}, pageAnims = []) => ({ document: { getElementById: (i) => byId[i] ?? null, querySelector: (s) => bySelector[s] ?? null, getAnimations: () => pageAnims } });
const page = ({ top, frames = [], clicked = [], headerFrame = frames[0] }) => ({
  evaluate: async (fn, arg) => run(fn, arg, top), frames: () => frames, click: async (s) => { clicked.push(s); },
  $: async (s) => top.document.querySelector(s) ? { contentFrame: async () => headerFrame, dispose: async () => {} } : null,
});
const frame = (url, button) => ({ url: () => url, evaluate: async (fn, arg) => run(fn, arg, doc({ allow: button })) });

test('download-check: the Allow frame names the first of its four states not reached', async () => {
  const idle = node([0, 0, 24, 24], { textContent: '' }), busy = node([0, 0, 24, 24], { textContent: '1 of 1 · Cancel', 'data-busy': true });
  const header = { '#context_module_74 .ig-header > .gz-dl-allow': {} };
  const url = 'chrome-extension://ext/features/allow.html#files.cdn-c.test';
  const hidden = { textContent: 'Allow files.cdn-c.test', hidden: true }, shown = { textContent: 'Allow files.cdn-c.test', hidden: false };
  await assert.rejects(allowFrame(page({ top: doc({ 'gz-dl-74': idle }) }), 74, 'files.cdn-c.test'), /the Allow frame: no download running, Download all idle/);
  await assert.rejects(allowFrame(page({ top: doc({ 'gz-dl-74': busy }) }), 74, 'files.cdn-c.test'), /no frame in module 74's header, Download all says "1 of 1 · Cancel"/);
  await assert.rejects(allowFrame(page({ top: doc({ 'gz-dl-74': busy }, header), frames: [frame('about:blank', shown)] }), 74, 'files.cdn-c.test'), /no chrome-extension:\/\/ext\/features\/allow\.html in the frame/);
  await assert.rejects(allowFrame(page({ top: doc({ 'gz-dl-74': busy }, header), frames: [frame(url, hidden)] }), 74, 'files.cdn-c.test'), /its button not shown \(no ticket from the worker\)/);
  const f = frame(url, shown);
  assert.equal(await allowFrame(page({ top: doc({ 'gz-dl-74': busy }, header), frames: [f] }), 74, 'files.cdn-c.test'), f);
});

test('download-check: resting waits out a finite animation on the button or a box around it, never an endless one', async () => {
  const module = node([0, 400, 900, 60], { anims: [anim(800)] }), button = node([860, 418, 24, 24], { parent: module });
  await assert.rejects(resting(page({ top: doc({}, { '#gz-dl-73': button }) }), '#gz-dl-73'), /#gz-dl-73 to come to rest \(moving\)/);
  module.anims = [anim(Infinity)];
  await resting(page({ top: doc({}, { '#gz-dl-73': button }) }), '#gz-dl-73');
  await assert.rejects(resting(page({ top: doc({}) }), '#gz-dl-73'), /\(missing\)/);
});

test('download-check: Download all is pressed only once its button rests', async () => {
  const module = node([0, 400, 900, 60], { anims: [anim(800)] }), button = node([860, 418, 24, 24], { parent: module });
  const clicked = [];
  await assert.rejects(press(page({ top: doc({}, { '#gz-dl-73': button }), clicked }), 73), /to come to rest/);
  assert.deepEqual(clicked, []);
  module.anims = [];
  await press(page({ top: doc({}, { '#gz-dl-73': button }), clicked }), 73);
  assert.deepEqual(clicked, ['#gz-dl-73']);
});

test('download-check: until has a hard deadline even when a page never answers', async () => {
  let watchdog, state = 'before the page answered';
  try {
    const result = await Promise.race([
      until(() => { state = 'page stalled'; return new Promise(() => {}); }, () => state, 20).then(() => 'unexpected success', (e) => e.message),
      new Promise((resolve) => { watchdog = setTimeout(() => resolve('deadline missed'), 200); }),
    ]);
    assert.equal(result, 'timed out: page stalled');
  } finally { clearTimeout(watchdog); }
});

test('download-check: an infinite view transition blocks the click until the bounded rest wait fails', async () => {
  const button = node([0, 0, 24, 24]);
  const vt = anim(Infinity);
  vt.effect.pseudoElement = '::view-transition-group(root)';
  await assert.rejects(resting(page({ top: doc({}, { '#go': button }, [vt]) }), '#go'), /to come to rest \(moving\)/);
});

test('download-check: the Allow click rests both its button and its module frame', async () => {
  assert.equal(typeof pressAllow, 'function');
  const module = node([0, 0, 900, 60], { anims: [anim(800)] });
  const outer = node([600, 10, 150, 26], { parent: module }), inner = node([0, 0, 120, 26]);
  const clicked = [];
  const p = page({ top: doc({}, { '#context_module_74 .ig-header > .gz-dl-allow': outer }) });
  const f = page({ top: doc({}, { '#allow': inner }), clicked });
  f.locator = (s) => ({ click: () => f.click(s) });
  await assert.rejects(pressAllow(p, 74, f), /to come to rest.*moving/);
  assert.deepEqual(clicked, []);
  module.anims = [];
  inner.anims = [anim(300)];
  await assert.rejects(pressAllow(p, 74, f), /to come to rest.*moving/);
  assert.deepEqual(clicked, []);
  inner.anims = [];
  await pressAllow(p, 74, f);
  assert.deepEqual(clicked, ['#allow']);
});

test('download-check: a loaded Allow page elsewhere cannot stand in for the module frame', async () => {
  const busy = node([0, 0, 24, 24], { textContent: 'Finding files · Cancel', 'data-busy': true });
  const shown = { textContent: 'Allow files.cdn-c.test', hidden: false };
  const f = frame('chrome-extension://ext/features/allow.html#files.cdn-c.test', shown);
  const p = page({ top: doc({ 'gz-dl-74': busy }, { '#context_module_74 .ig-header > .gz-dl-allow': {} }), frames: [f], headerFrame: frame('about:blank', shown) });
  await assert.rejects(allowFrame(p, 74, 'files.cdn-c.test'), /no chrome-extension:\/\/ext\/features\/allow.html in the frame/);
});
