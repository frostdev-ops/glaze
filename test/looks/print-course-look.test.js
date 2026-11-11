const test = require('node:test');
const assert = require('node:assert/strict');
const { cssRules, chain, winner } = require('../helpers/css-cascade.cjs');

const rules = cssRules('looks/page/surfaces.css', (header) => !header.includes('screen') && !header.startsWith('@supports not'));
const card = (pageDark, own) => {
  const root = Object.assign(chain('html'), { attrs: pageDark ? { 'data-gz-dark-theme': '' } : {} });
  return Object.assign(chain('div'), { attrs: { 'data-region': 'course-content', 'data-gz-course-look': own }, parent: root });
};

for (const pageDark of [false, true]) {
  test(`a dark course card prints dark ink on white on a ${pageDark ? 'dark' : 'light'} page`, () => {
    const el = card(pageDark, 'dark');
    for (const [token, value] of [['--gz-ink', '#14181f'], ['--gz-surface', '#fff'], ['--gz-surface-2', '#fff'], ['--gz-surface-color', '#fff'], ['--gz-on-soft', 'var(--gz-accent-hi)'], ['color-scheme', 'light']]) {
      const hit = winner(rules, el, token);
      assert.equal(hit?.[0], value, `${token} must be set on the card: it owns inline palette values`);
      const body = rules.find(([sel]) => sel === hit[1])[1];
      assert.ok(body.includes(`${token}: ${value} !important`), 'the reset beats the local inline palette');
    }
  });
}

test('the dark-card print reset leaves a card with its own light Look alone', () => {
  assert.equal(winner(rules, card(false, 'light'), '--gz-ink'), null);
});

test('screen keeps the local dark palette', () => {
  const screen = cssRules('looks/page/surfaces.css', (header) => !header.includes('print'));
  assert.equal(winner(screen, card(false, 'dark'), '--gz-ink'), null);
});
