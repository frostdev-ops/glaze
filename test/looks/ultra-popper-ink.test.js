const test = require('node:test');
const assert = require('node:assert/strict');
const { cssRules, chain, winner } = require('../helpers/css-cascade.cjs');

const text = () => {
  const el = chain('html', 'body', 'div.MuiPopper-root', 'div.bbml-content', 'span');
  el.attrs = { style: 'color: #000' };
  el.parent.parent.parent.parent.attrs = { 'data-gz-dark-theme': '' };
  return el;
};

for (const relative of [true, false]) {
  test(`authored text in a dark Ultra popover is readable with relative colours ${relative ? 'supported' : 'unsupported'}`, () => {
    const rules = cssRules('content/theme.css', (header) => {
      if (header.startsWith('@media')) return !header.includes('print');
      return header.startsWith('@supports not') ? !relative : relative;
    });
    const el = text();
    if (relative) {
      assert.equal(winner(rules, el, '-webkit-text-fill-color')?.[0], 'oklch(from currentColor max(l, 0.78) c h)');
      assert.notEqual(winner(rules, el, 'color')?.[0], 'inherit', 'the authored colour remains the source of the lift');
    } else {
      assert.equal(winner(rules, el, 'color')?.[0], 'inherit', 'the fallback overrides unreadable inline black');
    }
  });
}
