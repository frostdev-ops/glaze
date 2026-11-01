// Ultra's early sheets (content/content-ultra.js, its last block): at document_start, before the parser reaches <body>, the
// theme's sheets go on render-blocking, so the first paint is Glaze's and Ultra's grey boot screen never shows under it
// (content/extras.css). On Blackboard's own hosts always; on a school's own host once Glaze themed it in this tab (the
// first-paint settings content.js keeps in sessionStorage, on). content.js takes them off again where Glaze turns out off or
// the host isn't approved (test/navigation/ultra-off.test.js, test/core/consent.test.js). Scripts in a VM, no browser.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = process.env.GZ_EARLY_ROOT || path.join(__dirname, '../../extension');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

const arm = ({ origin = 'https://bb.school.edu', kept, body = false, storage = true, pathname = '/ultra/grades' } = {}) => {
  const links = [];
  const html = { appendChild: (l) => links.push(l) };
  const c = vm.createContext({
    URL, location: new URL(origin + pathname),
    document: { contentType: 'text/html', body: body ? {} : null, head: null, documentElement: html,
      createElement: () => { const a = new Map(); return { setAttribute: (k, v) => a.set(k, v), removeAttribute: (k) => a.delete(k), attrs: a }; } },
    chrome: { runtime: { getURL: (f) => `chrome-extension://glaze/${f}` } },
    setTimeout: () => 0,
  });
  Object.defineProperty(c, 'sessionStorage', { get: () => { if (!storage) throw new Error('SecurityError'); return kept === undefined ? {} : { 'gz-settings': kept }; } });
  c.globalThis = c;
  // defaults.js's built-in host test, as the scripts before content-ultra.js leave it.
  vm.runInContext(read('content/defaults.js').match(/^const GZ_BUILT_IN = .*$/m)[0].replace('const', 'var'), c);
  vm.runInContext(read('content/content-ultra.js'), c);
  return links.map((l) => [l.href.split('/').pop(), l.attrs.get('blocking')]);
};
const SHEETS = [['theme.css', 'render'], ['motion.css', 'render'], ['extras.css', 'render'], ['apps.css', 'render']];
const ON = JSON.stringify({ enabled: true, enhance: { feedback: true } }), OFF = JSON.stringify({ enabled: false });

test('Blackboard\'s own hosts arm the early sheets render-blocking, kept settings or not', () => {
  assert.deepEqual(arm({ origin: 'https://school.blackboard.com' }), SHEETS);
});

test('a school\'s own host arms them once Glaze themed it in this tab, and only then', () => {
  assert.deepEqual(arm({ kept: ON }), SHEETS, 'kept settings, on: the first paint is Glaze\'s');
  assert.deepEqual(arm(), [], 'a fresh tab: content.js puts them on once the host is confirmed');
  assert.deepEqual(arm({ kept: OFF }), [], 'kept settings, off');
  assert.deepEqual(arm({ kept: '{"enabled":truthy' }), [], 'not the kept copy');
  assert.deepEqual(arm({ kept: ON, storage: false }), [], 'sessionStorage refused: nothing, and nothing thrown');
  assert.deepEqual(arm({ kept: ON, body: true }), [], 'the body already in: too late to block the first paint');
  assert.deepEqual(arm({ kept: ON, pathname: '/webapps/portal' }), [], 'not an Ultra page');
});
