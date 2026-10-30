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
  + '\nglobalThis.helpers = { resting, allowFrame, press };', context);
const { resting, allowFrame, press } = context.helpers;

const anim = (endTime, playState = 'running') => ({ playState, effect: { getComputedTiming: () => ({ endTime }) } });
const node = (rect, { parent = null, anims = [], ...rest } = {}) => ({ anims, rect, parentElement: parent, parentNode: parent, ...rest,
  getAnimations() { return this.anims; }, getBoundingClientRect() { const [x, y, width, height] = this.rect; return { x, y, width, height }; }, hasAttribute(a) { return !!this[a]; } });
const run = (fn, arg, r) => vm.runInNewContext(`(${fn})(${JSON.stringify(arg)})`, { scrollX: 0, scrollY: 0, ...r });
const doc = (byId, bySelector = {}, pageAnims = []) => ({ document: { getElementById: (i) => byId[i] ?? null, querySelector: (s) => bySelector[s] ?? null, getAnimations: () => pageAnims } });
const page = ({ top, frames = [], clicked = [] }) => ({ evaluate: async (fn, arg) => run(fn, arg, top), frames: () => frames, click: async (s) => { clicked.push(s); } });
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
