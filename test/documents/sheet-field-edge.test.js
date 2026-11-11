// The spreadsheet's formula bar, Find and Replace, and format fields (documents/sheets/sheet.css) were edged in line-strong, 1.6:1 on
// the surface in nine of the ten palettes the built-in Looks wear (audit 2026-11-11 X14); every other Glaze field now takes the faint
// ink, which the palette contract holds to 3:1 (--gz-border-field, looks/page/surfaces.css). WCAG 1.4.11 asks 3:1 of a field's edge.
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../../extension/core/color.js');
const { PALETTES, resolve } = require('../helpers/palettes.cjs');
const { cssRules, parts } = require('../helpers/css-cascade.cjs');

const BEFORE = 'var(--gz-border-strong, var(--gz-line-strong))', AFTER = 'var(--gz-border-field, var(--gz-ink-faint))';
const NEEDLES = ['.gx-bar input', '.gx-find input', '.gx-fmt-row input'];

const rule = cssRules('documents/sheets/sheet.css').find(([sel, body]) => NEEDLES.every((n) => parts(sel).includes(n)) && /(?:^|;)\s*border\s*:/.test(body));
const edge = rule && rule[1].match(/(?:^|;)\s*border\s*:\s*1px solid\s+([^;]+)/)?.[1].trim();
const fill = rule && rule[1].match(/(?:^|;)\s*background\s*:\s*([^;]+)/)?.[1].trim();

test('the sheet\'s fields are edged in the faint ink, as every other Glaze field is', () => {
  assert.ok(rule, 'one rule for the formula bar, Find and format fields');
  assert.equal(edge, AFTER);
  assert.equal(fill, 'var(--gz-surface-fill-2, var(--gz-surface-2))', 'the fields sit on the second surface, in a bar on the first');
});

test('the edge reads at 3:1 on the field and on the bar in every palette; the old edge did not in nine of ten', () => {
  const table = [], low = [], was = [];
  for (const [name, c] of Object.entries(PALETTES)) {
    const row = { name };
    for (const ground of ['--gz-surface', '--gz-surface-2']) {
      const before = C.contrast(resolve(BEFORE, c, c[ground]), c[ground]), after = C.contrast(resolve(edge, c, c[ground]), c[ground]);
      row[ground] = [+before.toFixed(2), +after.toFixed(2)];
      if (after < 3) low.push(`${name} on ${ground}: ${after.toFixed(2)}`);
      if (before < 3) was.push(name);
    }
    table.push(row);
  }
  if (process.env.GLAZE_TABLE) console.log(table.map((r) => `${r.name}: surface ${r['--gz-surface'].join(' -> ')}, surface-2 ${r['--gz-surface-2'].join(' -> ')}`).join('\n'));
  assert.deepEqual(low, []);
  assert.ok(new Set(was).size >= 9, `line-strong was under 3:1 in ${new Set(was).size} palettes`);
});

test('a focused field still shows it: the accent edge and a ring', () => {
  const focus = cssRules('documents/sheets/sheet.css').find(([sel]) => NEEDLES.every((n) => parts(sel).includes(`${n}:focus`)));
  assert.ok(focus && /border-color:\s*var\(--gz-accent\)/.test(focus[1]) && /box-shadow:/.test(focus[1]));
});
