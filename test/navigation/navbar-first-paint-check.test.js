const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('the browser check keeps its first copy observation when the renderer arrives after the first frame', () => {
  const source = fs.readFileSync(require.resolve('../../checks/navigation/ultra-navbar-first-paint-check.js'), 'utf8');
  const observers = [], window = {};
  const watch = vm.runInNewContext(source.slice(source.indexOf('const watch ='), source.indexOf('// The live bar')) + '\nwatch;', {
    window, performance: { now: () => 10 }, requestAnimationFrame() {},
    document: { querySelectorAll: () => [{}], querySelector: () => ({}) },
    PerformanceObserver: class { observe() {} },
    MutationObserver: class { constructor(fn) { observers.push(fn); } observe() {} },
  });
  watch();
  observers[0]();
  const first = window.__copy;
  assert.equal(first.framed, false, 'the copy arrived before the first frame');
  window.__first = {};
  observers[0](); // Native Ultra continues adding nodes while the copy waits for the renderer.
  assert.equal(window.__copy, first, 'later mutations must not turn an early copy into a late one');
});
