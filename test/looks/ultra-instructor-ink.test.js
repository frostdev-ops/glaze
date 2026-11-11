// An Ultra instructor's own text colour (a due date in red, a step in green) is theirs: theme.css forced every element of the
// page to the palette's ink, `!important` over the inline value (audit 2026-11-11 A7 #4). Inside what an instructor wrote it
// keeps the colour they set; on a dark Look it is lifted, in its own hue, to a lightness that reads (OKLCH L 0.78, 6.3:1 or more
// on every built-in dark surface), the way canvas.css lifts Canvas's.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const C = require('../../extension/core/color.js');
const { PALETTES, LIGHT } = require('../helpers/palettes.cjs');
const { cssRules, parts, chain, winner } = require('../helpers/css-cascade.cjs');

const rules = cssRules('content/theme.css');
const el = (path, attrs) => Object.assign(chain(...path), { attrs });
const inherits = (e) => winner(rules, e, 'color')?.[0] === 'inherit';
const READ = ['div#site-wrap', 'div.bb-editor-container.is-read-only'];
const MODAL = ['div.MuiModal-root', 'div.bb-editor-container.is-read-only'];

for (const [what, base] of [['the page', READ], ['a dialog', MODAL]]) {
  test(`in ${what}, text with a colour the instructor set keeps it`, () => {
    for (const style of ['color: red', 'color:#c00', 'font-size: 12pt; color: rgb(0, 0, 0);', 'font-size:12pt;color:#000', 'font-weight: bold; color: #a00']) {
      assert.ok(!inherits(el([...base, 'span'], { style })), `<span style="${style}"> is not forced to the ink`);
    }
    assert.ok(!inherits(el([...base, 'font'], { color: '#c00' })), '<font color> is not forced');
    assert.ok(!inherits(el([...base, 'p', 'span'], { style: 'color: red' })) , 'a span inside a paragraph');
  });

  test(`in ${what}, text without one still takes the ink`, () => {
    assert.ok(inherits(el([...base, 'span'], { style: 'font-size: 12pt' })), 'a plain span');
    assert.ok(inherits(el([...base, 'span'], { style: 'background-color: yellow' })), 'background-color is not a text colour');
    assert.ok(inherits(el([...base, 'span'], { style: 'border-color: red; font-size: 10pt' })), 'border-color is not a text colour');
    assert.ok(inherits(el([...base, 'span'], undefined)), 'no style at all');
  });
}

test('outside what an instructor wrote, an inline colour is still the ink', () => {
  assert.ok(inherits(el(['div#site-wrap', 'div.other', 'span'], { style: 'color: red' })));
  assert.ok(inherits(el(['div.MuiModal-root', 'div.other', 'span'], { style: 'color: red' })));
});

test('on a dark Look the instructor\'s colour is lifted to OKLCH lightness 0.78, in its own hue', () => {
  const lift = rules.find(([sel, body]) => parts(sel).some((p) => p.includes('[data-gz-dark-theme]') && p.includes('.bb-editor-container.is-read-only')) && /-webkit-text-fill-color:\s*oklch\(from currentColor max\(l, 0\.78\) c h\)/.test(body));
  assert.ok(lift, 'a dark-theme rule with -webkit-text-fill-color: oklch(from currentColor max(l, 0.78) c h)');
  const text = fs.readFileSync(path.join(__dirname, '../../extension/content/theme.css'), 'utf8');
  assert.ok(/@supports \(color: oklch\(from red l c h\)\)\s*\{[^@]*-webkit-text-fill-color: oklch\(from currentColor max\(l, 0\.78\) c h\)/.test(text), 'where relative colours are read');
  assert.ok(/@supports not \(color: oklch\(from red l c h\)\)\s*\{[^@]*html\[data-gz-dark-theme\][^{]*\{[^}]*color: inherit !important/.test(text), 'and the page\'s ink, as before, where they are not');
});

test('a lift never touches an instructor\'s highlight, whose words take the ground\'s dark', () => {
  const lift = rules.find(([sel, body]) => /-webkit-text-fill-color:\s*oklch/.test(body) && sel.includes('.bb-editor-container.is-read-only'));
  assert.ok(lift && /:not\(:is\(mark,[\s\S]*\[style\*="background"\]/.test(lift[0]), 'the lift leaves out a highlight and what sits in one');
});

test('lightness 0.78 in any hue and chroma reads at 4.5:1 on the dark Looks\' surface and ground', () => {
  const fromLab = ([L, A, B]) => {
    const [l, m, s] = [L + 0.3963377774 * A + 0.2158037573 * B, L - 0.1055613458 * A - 0.0638541728 * B, L - 0.0894841775 * A - 1.291485548 * B].map((v) => v ** 3);
    const gam = (v) => 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);
    return C.hex({ r: gam(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s), g: gam(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s), b: gam(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s) });
  };
  let worst = 99;
  for (const [name, c] of Object.entries(PALETTES)) {
    if (LIGHT.includes(name)) continue;
    for (let h = 0; h < 360; h += 5) for (const chroma of [0, 0.05, 0.1, 0.15, 0.2]) {
      const lifted = fromLab([0.78, chroma * Math.cos(h * Math.PI / 180), chroma * Math.sin(h * Math.PI / 180)]);
      for (const bg of ['--gz-surface', '--gz-surface-2']) worst = Math.min(worst, C.contrast(lifted, c[bg]));
    }
  }
  assert.ok(worst >= 4.5, `worst ${worst.toFixed(2)}:1`);
});
