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
