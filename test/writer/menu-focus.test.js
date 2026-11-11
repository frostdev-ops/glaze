// A menu item the keyboard has reached is marked by more than the accent tint hover also gives: the tint is 1.1-1.4:1 on the
// surface, and the Writer menus had `outline: none` (audit 2026-11-11 A7 #9). Each menu's items get the 2px accent ring the
// rest of the UI uses, drawn inside the item.
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../../extension/core/color.js');
const { PALETTES } = require('../helpers/palettes.cjs');
const { cssRules, parts } = require('../helpers/css-cascade.cjs');

// [stylesheet, the items a rule's selector must name].
const MENUS = [
  ['writer/frame/writer.css', '.menu button'],
  ['writer/frame/writer-paper.css', '.gp-menu > button'],
  ['writer/frame/writer-paper.css', '.gp-palette > .gp-sw-auto'],
  ['writer/frame/writer-objects.css', '.gzo-mrow > button'],
  ['content/canvas.css', '.ui-menu .ui-menu-item a'],
  ['content/canvas.css', '.tox-tbtn'],
  ['content/canvas.css', '.tox-collection__item'],
];

for (const [file, item] of MENUS) {
  test(`${item} (${file}) shows keyboard focus as an accent ring`, () => {
    const ring = cssRules(file).find(([sel, body]) => parts(sel).some((p) => p.includes(item) && p.includes(':focus-visible'))
      && /outline:\s*2px solid var\(--gz-accent\)/.test(body) && /outline-offset:\s*-2px/.test(body));
    assert.ok(ring, `a :focus-visible rule for ${item} with outline: 2px solid var(--gz-accent); outline-offset: -2px`);
  });
}

test('the ring reads at 3:1 against the menu\'s surface, the ground and the tint, in every palette', () => {
  const low = [];
  for (const [name, c] of Object.entries(PALETTES)) {
    for (const bg of ['--gz-surface', '--gz-surface-2', '--gz-accent-soft']) {
      const ratio = C.contrast(c['--gz-accent'], c[bg]);
      if (ratio < 3) low.push(`${name} accent on ${bg} ${ratio.toFixed(2)}`);
    }
  }
  assert.deepEqual(low, []);
});
