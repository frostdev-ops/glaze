const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Exercise the check's helpers without launching Firefox or packaging the extension.
const source = fs.readFileSync(path.join(__dirname, '../scripts/firefox-check.mjs'), 'utf8');
const context = vm.createContext({ setTimeout, clearTimeout, Date, EXT: 'moz-extension://check/', FILES: 'files.cdn-a.test' });
vm.runInContext(source.slice(source.indexOf('const pause ='), source.indexOf('const fixture =')).replace('const SLOW = 60000;', 'const SLOW = 30;')
  + source.slice(source.indexOf('const resting ='), source.indexOf('\nconst run =')) + '\nglobalThis.helpers = { until, allowFrame };', context);
const { until, allowFrame } = context.helpers;
vm.runInContext('{ let n = 0; const wait = new Map(); const ws = { send() {} };'
  + source.slice(source.indexOf('    const send = (method'), source.indexOf("\n    await send('session.new'"))
  + '\nglobalThis.command = send; globalThis.pending = wait; }', context);

const allowBrowser = ({ button = { textContent: 'Allow files.cdn-a.test', hidden: false }, inHeader = true, frameError = false } = {}) => {
  const download = { hasAttribute: () => true, textContent: 'Finding files · Cancel' };
  const document = {
    getElementById: () => download,
    querySelector: (selector) => selector === '.gz-dl-allow' || (inHeader && selector === '#context_module_73 .ig-header > .gz-dl-allow') ? {} : null,
  };
  return {
    value: async (expression, c) => vm.runInNewContext(expression, { document: c === 'frame' ? { getElementById: () => button } : document }),
    frame: async () => { if (frameError) throw new Error('frame not ready'); return 'frame'; },
  };
};

test('Firefox until bounds a browser command that never answers', async () => {
  let watchdog;
  try {
    const result = await Promise.race([
      until(() => new Promise(() => {}), 'stalled browser command', 20).then(() => 'unexpected success', (e) => e.message),
      new Promise((resolve) => { watchdog = setTimeout(() => resolve('deadline missed'), 200); }),
    ]);
    assert.equal(result, 'timed out: stalled browser command');
  } finally { clearTimeout(watchdog); }
});

test('Firefox commands outside until also time out and release their pending entry', async () => {
  let watchdog;
  try {
    const result = await Promise.race([
      context.command('input.performActions').then(() => 'unexpected success', (e) => e.message),
      new Promise((resolve) => { watchdog = setTimeout(() => resolve('deadline missed'), 200); }),
    ]);
    assert.equal(result, 'timed out: input.performActions');
    assert.equal(context.pending.size, 0);
  } finally { clearTimeout(watchdog); }
});

test('Firefox Allow frame reports a missing button after the download and frame exist', async () => {
  await assert.rejects(allowFrame(allowBrowser({ button: null }), 'tab'), /its button not shown.*Download all says "Finding files · Cancel"/);
});

test('Firefox Allow frame reports its URL state when the frame lookup rejects', async () => {
  await assert.rejects(allowFrame(allowBrowser({ frameError: true }), 'tab'), /no moz-extension:\/\/check\/features\/allow.html in the frame/);
});

test('Firefox Allow frame must belong to module 73\'s header', async () => {
  await assert.rejects(allowFrame(allowBrowser({ inHeader: false }), 'tab'), /no frame in the module's header/);
});

// The rest wait before every trusted click, on the target forms clickOn takes: an expression for the element in the tab's
// realm (into an open shadow root, say), or in a frame's realm with the frame's element in the tab's.
const rest = vm.createContext({ setTimeout, clearTimeout, Date, EXT: 'moz-extension://check/', FILES: 'files.cdn-a.test', WIDGET: 'w' });
vm.runInContext(source.slice(source.indexOf('const pause ='), source.indexOf('const fixture =')).replace('const SLOW = 60000;', 'const SLOW = 400;')
  + source.slice(source.indexOf('const browser ='), source.indexOf("// In one of Glaze's pages"))
  + source.slice(source.indexOf('const resting ='), source.indexOf('\nconst run =')) + '\nglobalThis.helpers = { resting, browser };', rest);
const { resting, browser } = rest.helpers;
const anim = (endTime, playState = 'running') => ({ playState, effect: { getComputedTiming: () => ({ endTime }) } });
const node = (rect, { parent = null, anims = [] } = {}) => ({ anims, rect, parentElement: parent, parentNode: parent,
  getAnimations() { return this.anims; }, getBoundingClientRect() { const [x, y, width, height] = this.rect; return { x, y, width, height }; }, scrollIntoView() {} });
const realm = (byId, pageAnims = []) => ({ scrollX: 0, scrollY: 0, document: { getElementById: (i) => byId[i] ?? null, querySelector: (s) => byId[s] ?? null, getAnimations: () => pageAnims } });
// A shadow host whose root holds the target, as Glaze's navbar does.
const shadowed = (hostAnims) => {
  const host = node([0, 0, 300, 40], { anims: hostAnims });
  const target = node([10, 10, 24, 24]);
  target.parentNode = { host }; // the shadow root: no parentElement across it
  host.shadowRoot = { querySelector: () => target };
  return realm({ 'gz-navbar': host });
};
const NAV = `document.getElementById('gz-navbar').shadowRoot.querySelector('[data-id="glaze:settings"]')`;
const realms = (r) => ({ value: async (expression, c) => vm.runInNewContext(expression, r[c]) });

test('resting follows an expression into a shadow root and waits out a finite animation on its host', async () => {
  await assert.rejects(resting(realms({ tab: shadowed([anim(800)]) }), 'tab', NAV), /to come to rest \(moving\)/);
  await resting(realms({ tab: shadowed([anim(800, 'finished')]) }), 'tab', NAV);
  await resting(realms({ tab: shadowed([anim(Infinity)]) }), 'tab', NAV); // an endless one never ends: it can't hold a click
});

test('resting waits while a view transition covers the page', async () => {
  const t = node([10, 10, 24, 24]);
  const vt = { ...anim(300), effect: { pseudoElement: '::view-transition-group(root)', getComputedTiming: () => ({ endTime: 300 }) } };
  await assert.rejects(resting(realms({ tab: realm({ '#go': t }, [vt]) }), 'tab', `document.querySelector("#go")`), /\(moving\)/);
});

test('resting, for a target in a frame, looks in the frame\'s realm and at the frame\'s element in the tab', async () => {
  const inner = node([0, 0, 120, 26]), module = node([0, 400, 900, 60], { anims: [anim(1000)] });
  const frame = node([600, 410, 150, 26], { parent: module });
  const r = { tab: realm({ '.gz-dl-allow': frame }), frame: realm({ '#allow': inner }) };
  await assert.rejects(resting(realms(r), 'tab', `document.querySelector("#allow")`, ['frame', '.gz-dl-allow']), /\(0,0,120,26 \| moving\)/);
  module.anims = [];
  await resting(realms(r), 'tab', `document.querySelector("#allow")`, ['frame', '.gz-dl-allow']);
});

test('resting waits for the same box twice, and says what it last saw', async () => {
  const t = node([10, 10, 24, 24]);
  const b = { value: async (expression, c) => { t.rect = [t.rect[0], t.rect[1] + 5, 24, 24]; return vm.runInNewContext(expression, { tab: realm({ '#x': t }) }[c]); } };
  await assert.rejects(resting(b, 'tab', `document.querySelector("#x")`), /document\.querySelector\("#x"\) to come to rest \(10,\d+,24,24\)/);
  await assert.rejects(resting(realms({ tab: realm({}) }), 'tab', `document.querySelector("#x")`), /\(missing\)/);
});

test('every click rests before it measures and presses', async () => {
  const button = node([100, 200, 24, 24], { anims: [anim(800)] });
  const pressed = [];
  const send = async (method, params) => {
    if (method === 'input.performActions') { pressed.push(params.actions[0].actions[0]); return {}; }
    if (method !== 'script.evaluate') return {};
    const value = await vm.runInNewContext(params.expression, realm({ '#gz-dl-73': button }));
    return { type: 'success', result: { type: 'string', value } };
  };
  const b = browser(send, () => '');
  await assert.rejects(b.click('tab', '#gz-dl-73'), /to come to rest \(moving\)/);
  assert.equal(pressed.length, 0, 'no press while the button moves');
  button.anims = [];
  await b.click('tab', '#gz-dl-73');
  assert.equal(JSON.stringify(pressed), JSON.stringify([{ type: 'pointerMove', x: 112, y: 212 }])); // made in the check's realm
});
