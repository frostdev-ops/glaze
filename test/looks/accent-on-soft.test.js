// Accent text on the accent tint (accent-soft: selected rows, chips, menu items) read 4.24:1 in Paper and 4.47:1 in Rose.
// The palette contract holds the bright accent to 4.5:1 on that tint, so on a light palette text on the tint takes it:
// --gz-on-soft (looks/page/surfaces.css), as Moodle's selected rows already did (audit 2026-11-11 A7 #5).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const C = require('../../extension/core/color.js');
const { PALETTES } = require('../helpers/palettes.cjs');
const { cssRules, parts } = require('../helpers/css-cascade.cjs');

const root = path.join(__dirname, '../../extension');
const sheets = execFileSync('git', ['ls-files', '*.css', 'options.html', 'popup.html'], { cwd: root, encoding: 'utf8' }).trim().split('\n').filter((f) => !f.startsWith('vendor/'));
const dark = (c) => C.brightness(C.parse(c['--gz-surface'])) < 0.5;

test('surfaces.css derives --gz-on-soft: the bright accent on a light palette, the accent on a dark one', () => {
  const css = fs.readFileSync(path.join(root, 'looks/page/surfaces.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.ok(/(?:^|\n)html[^{]*\{[^}]*--gz-on-soft:\s*var\(--gz-accent\)/.test(css), 'a plain value where light-dark() is not read');
  assert.ok(/@supports\s*\(color:\s*light-dark\(red, red\)\)\s*\{[^{}]*html[^{}]*\{[^}]*--gz-on-soft:\s*light-dark\(var\(--gz-accent-hi\), var\(--gz-accent\)\)/.test(css), 'light-dark(accent-hi, accent) under @supports');
});

test('no rule sets accent text on an accent-soft fill', () => {
  const bad = [];
  for (const f of sheets) {
    const text = fs.readFileSync(path.join(root, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const [, sel, body] of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (/(?:^|[;\s])background(?:-color)?\s*:[^;]*var\(--gz-accent-soft/.test(body) && /(?:^|[;\s])color\s*:\s*var\(--gz-accent[,)]/.test(body)) bad.push(`${f}: ${sel.trim().replace(/\s+/g, ' ').slice(0, 90)}`);
    }
  }
  assert.deepEqual(bad, []);
});

test('on its tint the text reads at 4.5:1 in every palette (Paper 4.24 and Rose 4.47 with the plain accent)', () => {
  const low = [], plain = {};
  for (const [name, c] of Object.entries(PALETTES)) {
    plain[name] = C.contrast(c['--gz-accent'], c['--gz-accent-soft']);
    const token = dark(c) ? '--gz-accent' : '--gz-accent-hi';
    const ratio = C.contrast(c[token], c['--gz-accent-soft']);
    if (ratio < 4.5) low.push(`${name} ${token} ${ratio.toFixed(2)}`);
  }
  assert.deepEqual(low, []);
  assert.ok(plain.Paper < 4.5 && plain.Rose < 4.5, 'the plain accent is what failed');
});

test('Moodle still gives its own rows their tint text', () => {
  const rules = cssRules('content/moodle.css');
  assert.ok(rules.some(([sel, body]) => parts(sel).includes('html .courseindex .courseindex-item.pageitem') && /color:\s*var\(--gz-on-soft\)/.test(body)));
});
