// Glaze's own text fields, selects, segmented choices and off switches are drawn by their edge, which was `line-strong`:
// 1.6:1 on the surface in nine of the ten palettes the built-in Looks wear (audit 2026-11-11 A7 #6). WCAG 1.4.11 asks 3:1; the
// palette contract holds the faint ink to 3:1 on the surface and the ground, and Ultra's own fields already take it.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const C = require('../../extension/core/color.js');
const { PALETTES } = require('../helpers/palettes.cjs');
const { cssRules, parts } = require('../helpers/css-cascade.cjs');

const EDGE = /var\(--gz-border-field,\s*var\(--gz-ink-faint\)\)|var\(--gz-ink-faint\)/;
// [stylesheet, a selector the field's rule names]
const FIELDS = [
  ['core/ui.css', 'input[type="text"]'],
  ['core/ui.css', '.seg'],
  ['core/page/apps.css', '.gz-w-music input'],
  ['core/page/apps.css', '#gz-nt select'],
  ['core/page/apps.css', '#gz-ics select'],
  ['core/page/apps.css', '#gz-rm select'],
  ['core/page/apps.css', '#gz-gpa textarea'],
  ['documents/papers.css', '.gd-bar select'],
  ['documents/pdf/pdf-kind.css', '.gq-find input'],
  ['writer/frame/writer.css', '.tb .href'],
  ['writer/frame/writer-paper.css', '.gp-form input'],
  ['writer/frame/writer-objects.css', '.gzo-field'],
  ['writer/frame/writer-submit.css', '.gs-field textarea'],
  ['sharing/quick.css', 'input'],
];
const border = (file, needle) => {
  const rule = cssRules(file).find(([sel, body]) => parts(sel).some((p) => p === needle || p.startsWith(`${needle}`) || p.endsWith(` ${needle}`)) && /(?:^|;)\s*border(?:-color)?\s*:/.test(body) && !/:focus|:hover/.test(sel));
  return rule && rule[1].match(/(?:^|;)\s*border(?:-color)?\s*:\s*([^;]+)/)[1];
};

for (const [file, needle] of FIELDS) {
  test(`${needle} (${file}) is edged in the faint ink`, () => {
    const b = border(file, needle);
    assert.ok(b, `a rule for ${needle} with a border`);
    assert.ok(EDGE.test(b), `border: ${b}`);
  });
}

test('the off switch\'s track has the same edge, and the on switch does not need it', () => {
  const rules = cssRules('core/ui.css');
  const ring = (needle, on) => rules.find(([sel, body]) => parts(sel).some((p) => p.includes(needle) && (on ? p.includes(':checked') : !p.includes(':checked') && !p.includes('::before') && !p.includes('::after') && !p.includes(':focus') && !p.includes(':disabled'))) && /box-shadow:/.test(body));
  for (const track of ['input[type="checkbox"]:not(.switch > input)', '.switch span']) {
    const off = ring(track, false);
    assert.ok(off && /box-shadow:\s*inset 0 0 0 1px var\(--gz-border-field, var\(--gz-ink-faint\)\)/.test(off[1]), `${track} is ringed`);
    const on = ring(track === '.switch span' ? '.switch input:checked + span' : 'input[type="checkbox"]:not(.switch > input):checked', true);
    assert.ok(on && /box-shadow:\s*none/.test(on[1]), `${track} loses the ring once on`);
  }
});

test('surfaces.css draws the edge at the Look\'s border strength, as --gz-border-strong does', () => {
  const css = fs.readFileSync(path.join(__dirname, '../../extension/looks/page/surfaces.css'), 'utf8');
  assert.ok(/--gz-border-field:\s*color-mix\(in srgb, var\(--gz-ink-faint\) var\(--gz-surface-border, 100%\), transparent\)/.test(css));
});

test('a field\'s focus stays visible where the border colour is all that changes: a 2px accent edge', () => {
  for (const [file, focus] of [['writer/frame/writer.css', '.tb .href:focus'], ['writer/frame/writer-paper.css', '.gp-form input:focus'], ['writer/frame/writer-objects.css', '.gzo-field:focus'], ['writer/frame/writer-submit.css', '.gs-field textarea:focus-visible']]) {
    const rule = cssRules(file).find(([sel]) => parts(sel).includes(focus));
    assert.ok(rule && /box-shadow:\s*0 0 0 1px var\(--gz-accent\)/.test(rule[1]), `${focus} adds a 1px accent ring to its border`);
  }
});

test('the faint ink reads at 3:1 on the surface and the ground in every palette (line-strong did on one)', () => {
  const low = [], was = [];
  for (const [name, c] of Object.entries(PALETTES)) {
    for (const bg of ['--gz-surface', '--gz-surface-2']) {
      if (C.contrast(c['--gz-ink-faint'], c[bg]) < 3) low.push(`${name} faint on ${bg}`);
      if (C.contrast(c['--gz-line-strong'], c[bg]) < 3) was.push(name);
    }
  }
  assert.deepEqual(low, []);
  assert.ok(new Set(was).size >= 9, 'line-strong is what failed');
});
