const test = require('node:test');
const assert = require('node:assert/strict');
const { cssRules, chain, parts, winner } = require('../helpers/css-cascade.cjs');

// Substitute an attribute for the focus pseudo-class: both have the same specificity, and this exercises the full sheet.
const focused = (rules) => rules.map(([selector, body]) => [selector.replaceAll(':focus-visible', '[data-test-focus]'), body]);
const rules = focused(cssRules('core/ui.css', (header) => !header.startsWith('@media') || header.includes('forced-colors')));
const swatch = (selected, focused) => Object.assign(chain('button.swatch'), {
  attrs: { 'aria-pressed': String(selected), ...(focused ? { 'data-test-focus': '' } : {}) },
});

for (const selected of [false, true]) {
  test(`a ${selected ? 'selected' : 'plain'} swatch keeps system-colour keyboard focus in forced colours`, () => {
    assert.equal(winner(rules, swatch(selected, true), 'outline')?.[0], '2px solid Highlight',
      'forced-color-adjust:none leaves the authored outline unchanged, so the generic accent ring must not win');
  });
}

test('an unfocused selected swatch keeps its selected-state ring', () => {
  assert.equal(winner(rules, swatch(true, false), 'outline')?.[0], '3px solid Highlight');
});

test('ordinary screen focus keeps the palette accent', () => {
  const screen = focused(cssRules('core/ui.css', (header) => !header.startsWith('@media')));
  assert.equal(winner(screen, swatch(false, true), 'outline')?.[0], '2px solid var(--gz-accent)');
});

test('a focused checkbox switch uses system-colour focus after opting out of colour adjustment', () => {
  const input = Object.assign(chain('input'), { attrs: { type: 'checkbox', 'data-test-focus': '' } });
  assert.equal(winner(rules, input, 'outline(?:-color)?')?.[0], 'Highlight');
});

for (const selector of ['.switch input:focus-visible + span', '.seg label:has(input:focus-visible)']) {
  test(`${selector} also uses system-colour focus`, () => {
    const hit = cssRules('core/ui.css', (header) => !header.startsWith('@media') || header.includes('forced-colors'))
      .filter(([sel]) => parts(sel).includes(selector)).at(-1);
    assert.match(hit?.[1] || '', /outline-color:\s*Highlight\s*[;}]/);
  });
}

test('the hub switch also keeps system-colour focus after opting out of colour adjustment', () => {
  const hubRules = focused(cssRules('core/page/apps.css', (header) => !header.startsWith('@media') || header.includes('forced-colors')));
  const input = Object.assign(chain('div#gz-hub', 'input'), { attrs: { type: 'checkbox', 'data-test-focus': '' } });
  assert.equal(winner(hubRules, input, 'outline(?:-color)?')?.[0], 'Highlight');
});
