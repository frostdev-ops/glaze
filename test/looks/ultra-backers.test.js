// The text backers share Ultra's actual control markup; their fills must leave control states visible.
// Exercise the shipped sheets' cascade without launching a browser.
const test = require('node:test');
const assert = require('node:assert/strict');
const { chain, cssRules, winner } = require('../helpers/css-cascade.cjs');

// For these controls, :disabled is their own disabled attribute; a synthetic attribute stands for the pointer state.
// Both substitutions preserve specificity and let the existing static matcher evaluate the relevant state rules.
const theme = cssRules('content/theme.css').map(([s, b]) => [s.replace(/:disabled\b/g, '[disabled]').replace(/:hover\b/g, '[data-test-hover]'), b]);
const PAGE = ['html', 'body', 'div#site-wrap'];
const streamButton = (cls = '', attrs = {}) => Object.assign(chain(...PAGE, 'div.base-recent-activity', 'div#activity-stream.activity-stream',
  'div.activity-group', `button.js-show-more.expand.button.button--text${cls}`), { attrs });

test('Activity Show more keeps its surface at rest and changes its fill on hover', () => {
  assert.match(winner(theme, streamButton(), 'background(?:-color)?')[0], /var\(--gz-surface-fill-2/);
  assert.equal(winner(theme, streamButton('', { 'data-test-hover': '' }), 'background(?:-color)?')[0], 'var(--gz-accent-soft)');
});

test('Activity Show more still looks disabled while it cannot load more items', () => {
  for (const [cls, attrs] of [['', { disabled: '' }], ['', { 'aria-disabled': 'true' }], ['.Mui-disabled', {}]]) {
    const el = streamButton(cls, attrs);
    assert.equal(winner(theme, el, 'background(?:-color)?')[0], 'var(--palette-action-disabledBackground)', JSON.stringify([cls, attrs]));
    assert.equal(winner(theme, el, 'color')[0], 'var(--palette-action-disabled)');
  }
});

test('Activity filter keeps its error state and floating-label ink on its surface', () => {
  for (const error of [true, false]) {
    const label = chain(...PAGE, 'bb-ui-async-combobox#streams-filter', 'div.MuiFormControl-root',
      `label#streams-filter-label.MuiFormLabel-root.MuiInputLabel-root.MuiInputLabel-shrink${error ? '.Mui-error' : ''}`);
    assert.match(winner(theme, label, 'background(?:-color)?')[0], /var\(--gz-surface-fill-2/);
    assert.equal(winner(theme, label, 'color')[0], error ? 'var(--gz-err)' : 'var(--gz-ink-muted)');
  }
});
