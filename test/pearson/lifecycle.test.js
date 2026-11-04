const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const defaults = require('../../extension/content/defaults.js');
const read = f => fs.readFileSync(path.join(__dirname, '../../extension', f), 'utf8');
const tick = () => new Promise(setImmediate);

test('an already themed homework document restores its native appearance after revocation and after all switches go off', async () => {
  const attrs = new Map(), styles = new Map(), listeners = [], math = [];
  let pearsonAccess = true, enhance = { pearsonViewer: true };
  const html = {
    style: { getPropertyValue: k => styles.get(k) || '', getPropertyPriority: () => '', setProperty: (k,v) => styles.set(k,v), removeProperty: k => styles.delete(k) },
    getAttribute: k => attrs.get(k) ?? null, setAttribute: (k,v) => attrs.set(k,v), removeAttribute: k => attrs.delete(k),
  };
  const local = { get: async () => ({ pearsonAccess }) };
  const c = vm.createContext({ URL, console, setTimeout, clearTimeout, location: new URL('https://mylab.pearson.com/Student/PlayerHomework.aspx?homeworkId=1'),
    document: { contentType: 'text/html', documentElement: html, body: null, querySelectorAll: () => [] },
    chrome: { runtime: { id: 'own' }, storage: { sync: { get: (keys, callback) => callback({ enabled: true, enhance }) }, onChanged: { addListener: f => listeners.push(f) } } },
    ...defaults, GZ_I18N: { ui: () => 'en', file: () => null }, GZ_XPARTS: { areas: () => ({ local }), stored: async () => null, parse: async () => null },
    GZ_MX: { compile: () => '' }, GZ_FONTS: { stack: () => 'system-ui', load() {} }, GZ_UI: { readable: () => 100 },
    GZ_SURFACE_VARS: () => ({}), GZ_COLOR: { parse: () => [1,1,1], brightness: () => 1 }, GZ_LX: { pointerOf: () => 'system', CURSORS: {} },
    GZ_PEARSON_MATH: { update: on => math.push(on) }, matchMedia: () => ({ matches: false, addEventListener() {} }),
    MutationObserver: class { observe() {} disconnect() {} }, addEventListener() {},
  });
  c.window = c; c.top = c;
  vm.runInContext(read('content/pearson.js'), c); await tick();
  assert.equal(attrs.get('data-gz-pearson'), 'shell');
  pearsonAccess = false;
  for (const f of listeners) f({ pearsonAccess: { newValue: false } }, 'local');
  await tick();
  assert.equal(attrs.has('data-gz-pearson'), false, 'unregistering alone cannot undo an injected script');
  assert.equal(styles.size, 0, 'appearance overrides are restored');
  assert.equal(math.at(-1), false);
  pearsonAccess = true;
  for (const f of listeners) f({ pearsonAccess: { newValue: true } }, 'local');
  await tick(); assert.equal(attrs.get('data-gz-pearson'), 'shell');
  enhance = {};
  for (const f of listeners) f({ enhance: { newValue: {} } }, 'sync');
  await tick(); assert.equal(attrs.has('data-gz-pearson'), false, 'the last switch off also restores native appearance');
});
