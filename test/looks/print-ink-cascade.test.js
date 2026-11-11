const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../../extension/core/color.js');
const { cssRules, chain, winner } = require('../helpers/css-cascade.cjs');
const { resolve } = require('../helpers/palettes.cjs');

const rulesFor = (file, medium) => cssRules(file, (header) => {
  if (header.startsWith('@supports')) return !header.startsWith('@supports not');
  return !header.includes(medium === 'print' ? 'screen' : 'print');
});
const element = (...path) => {
  const el = chain('html', 'body', ...path);
  let root = el;
  while (root.parent) root = root.parent;
  root.attrs = { 'data-gz-dark-theme': '' };
  return el;
};

for (const [file, path, attrs] of [
  ['content/theme.css', ['div#site-wrap', 'div.bbml-content', 'span'], { style: 'color: #000' }],
  ['content/canvas.css', ['div#application', 'div.user_content', 'span'], { 'data-gz-lift': '', style: 'color: #000' }],
]) {
  test(`${file}: dark text lifting stays on screen and does not lighten printed black text`, () => {
    const el = Object.assign(element(...path), { attrs });
    assert.match(winner(rulesFor(file, 'screen'), el, '-webkit-text-fill-color')?.[0] || '', /^oklch\(/);
    const fill = winner(rulesFor(file, 'print'), el, '-webkit-text-fill-color')?.[0] || 'currentColor';
    assert.equal(fill, 'currentColor', 'print uses the authored black instead of a light text fill');
  });
}

test('the print reset does not turn Ultra highlight text white on yellow', () => {
  const el = element('div#site-wrap', 'div.bbml-content', 'mark');
  const rules = [...rulesFor('content/theme.css', 'print'), ...rulesFor('looks/page/surfaces.css', 'print')];
  let root = el;
  while (root.parent) root = root.parent;
  const colors = Object.fromEntries(['--gz-surface-2', '--gz-ink'].map((key) => [key, winner(rules, root, key)?.[0]]));
  const ink = winner(rules, el, 'color')?.[0];
  const printed = !ink || ink === 'inherit' ? colors['--gz-ink'] : resolve(ink, colors);
  assert.ok(C.contrast(printed, '#ffff00') >= 4.5, `${printed} on the instructor's yellow highlight`);
});
