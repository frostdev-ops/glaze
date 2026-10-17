const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../content.js'), 'utf8');
const fn = (name) => { const start = source.indexOf(`  const ${name} =`); return source.slice(start, source.indexOf('\n  };', start) + 6); };

test('showing and dismissing a tooltip preserves the native title exactly', () => {
  for (const ultra of [false, true]) {
    const title = '  Show notifications\nfor this course  ', attrs = new Map([['title', title]]);
    class HTMLElement {
      dataset = {};
      textContent = 'Notifications';
      closest() { return this; }
      matches() { return false; }
      getAttribute(k) { return attrs.get(k) ?? null; }
      hasAttribute(k) { return attrs.has(k); }
      setAttribute(k, v) { attrs.set(k, v); }
      removeAttribute(k) { attrs.delete(k); }
    }
    const target = new HTMLElement();
    let later, displayed;
    const ctx = vm.createContext({ ultra, HTMLElement, target, settings: { look: { tooltips: true, hints: false } }, observer: {},
      tipFor: null, tipTimer: 0, tip: null, textOf: (el) => el.textContent, squash: (s) => s.trim(),
      setTimeout: (f) => { later = f; return 1; }, clearTimeout() {}, showTip: (el, info) => { displayed = info.title; } });
    vm.runInContext(`${fn('hideTip')}\n${fn('onTip')}\nonTip({ target, type: 'focusin' });`, ctx);
    later();
    assert.equal(displayed, title.trim(), 'the displayed tooltip stays trimmed');
    vm.runInContext('hideTip();', ctx);
    assert.equal(attrs.get('title'), title, 'the native title retains all whitespace');
  }
});
