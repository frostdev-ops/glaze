const test = require('node:test');
const assert = require('node:assert/strict');
const { cssRules, chain, winner } = require('../helpers/css-cascade.cjs');

const rules = cssRules('content/theme.css', (header) => !header.includes('print') && !header.startsWith('@supports not'));

for (const container of ['div#site-wrap', 'div.MuiModal-root', 'div.MuiPopper-root']) {
  test(`a link inside lifted instructor text in ${container} paints its own link colour`, () => {
    const link = chain('html', container, 'div.bbml-content', 'span', 'a');
    link.parent.attrs = { style: 'color: #800000' };
    link.parent.parent.parent.parent.attrs = { 'data-gz-dark-theme': '' };
    assert.match(winner(rules, link.parent, '-webkit-text-fill-color')?.[0] || '', /^oklch\(/, 'the parent supplies a resolved coloured fill');
    assert.equal(winner(rules, link, 'color')?.[0], 'var(--gz-accent)', 'the existing link colour still wins');
    assert.equal(winner(rules, link, '-webkit-text-fill-color')?.[0], 'currentColor',
      'a link must not inherit the parent\'s resolved fill over its own normal and hover colours');
    link.attrs = { style: 'color: #000080' };
    assert.match(winner(rules, link, '-webkit-text-fill-color')?.[0] || '', /^oklch\(/, 'a link with its own authored colour keeps its own lift');
  });
}
