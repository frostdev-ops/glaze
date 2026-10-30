const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');

test('the Submit check presses a reopening frame before readiness even when its boot is immediate', async () => {
  const source = fs.readFileSync(require.resolve('../scripts/writer-submit-check.js'), 'utf8');
  const start = source.indexOf('    const watchPress = '), end = source.indexOf('    let r = await pressReopening(', start);
  assert.ok(start >= 0 && end > start);
  let ready = false;
  const boot = vm.createContext({ location: { pathname: '/writer.html' }, chrome: { runtime: { sendMessage: async () => ({ ok: true }) } } });
  const fr = { evaluate: (fn) => vm.runInContext(`(${fn})()`, boot) };
  const el = { contentFrame: async () => fr, evaluate: async () => true };
  const old = { evaluate: async () => {
    vm.runInContext("chrome.runtime.sendMessage({ type: 'glaze:writer', op: 'claim' })", boot).then(() => { ready = true; });
    await new Promise(setImmediate);
  } };
  const p = { evaluate: async () => {}, addInitScript: async (fn) => { vm.runInContext(`(${fn})()`, boot); },
    $: async () => el, mouse: { click: async () => { assert.equal(ready, false, 'the pre-readiness press must be established by state'); } } };
  const scope = vm.createContext({ Date, openAttempt: async () => ({ p, el, fr: old }), center: async () => ({ x: 10, y: 10 }), until: async (fn) => fn() });
  vm.runInContext(source.slice(start, end) + '\nglobalThis.press = pressReopening;', scope);
  await scope.press('button');
  await new Promise(setImmediate);
  assert.equal(ready, true, 'the press releases boot so the real scenario can continue');
});
