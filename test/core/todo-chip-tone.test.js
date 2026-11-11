// The To Do chips' tones (core/page/apps.css: Submitted, Late, Missing… in Better To Do and the course cards) on every
// built-in palette: on a light Look each chip reads in its own tone, darkened toward the ink, at 4.5:1 or more on its
// tinted pill; a dark Look shows the tone as it is (audit 2026-11-11 K6: currentColor inside `color` was the inherited ink,
// so every chip on a light Look was the same slate).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const C = require('../../extension/core/color.js');
const P = require('../helpers/palettes.cjs');

const css = fs.readFileSync(path.join(__dirname, '../../extension/core/page/apps.css'), 'utf8');
const TONES = ['ok', 'warn', 'err'];
const rule = (prefix, tone) => {
  const sel = `${prefix}:is(#gz-todo, .gz-ct) .gz-todo-chip[data-tone="${tone}"] {`;
  const at = css.indexOf(`\n${sel}`);
  assert.ok(at !== -1, `a rule for ${sel}`);
  const body = css.slice(at + sel.length + 1, css.indexOf('}', at));
  return { color: body.match(/(?:^|;)\s*color:\s*([^;]+?)\s*(?:;|$)/)?.[1], background: body.match(/background:\s*([^;]+?)\s*(?:;|$)/)?.[1] };
};

test('on every light palette each tone chip reads in its own tone at 4.5:1 on its pill, on the surface and the ground', () => {
  assert.ok(P.LIGHT.length >= 2, P.LIGHT.join(', '));
  for (const name of P.LIGHT) {
    const c = P.PALETTES[name], seen = new Set();
    for (const tone of TONES) {
      const fg = rule('html:not([data-gz-dark-theme]) ', tone).color, { background } = rule('', tone);
      assert.match(fg, new RegExp(`var\\(--gz-${tone}\\)`), `${tone}: mixed from its own tone`);
      for (const ground of ['--gz-surface', '--gz-surface-2']) {
        const over = c[ground], ink = P.resolve(fg, c, over), pill = P.resolve(background, c, over);
        const ratio = C.contrast(ink, pill);
        assert.ok(ratio >= 4.5, `${name} ${tone} ${ink} on ${pill} (${ground}): ${ratio.toFixed(2)}:1`);
        seen.add(ink);
      }
    }
    assert.equal(seen.size, TONES.length, `${name}: three tones, not one colour`);
  }
});

test('a dark palette shows each tone as it is', () => {
  for (const tone of TONES) assert.equal(rule('', tone).color, `var(--gz-${tone})`);
  assert.ok(!/\[data-gz-dark-theme\]\)? [^{]*gz-todo-chip/.test(css.replace(/html:not\(\[data-gz-dark-theme\]\)/g, '')), 'no rule for the chips on a dark Look');
});
