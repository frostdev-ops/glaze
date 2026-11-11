// Writer's feedback chips (writer-ai.css .gz-fb-chip: met, partly, missing) read at 4.5:1 on the light palettes, from the
// palettes' own values. Text in the tone on a 14% tint of itself was 3.7-4.2:1 on Paper and Rose (audit 2026-11-11 A7 #7).
const test = require('node:test');
const assert = require('node:assert/strict');
const C = require('../../extension/core/color.js');
const { PALETTES, LIGHT, resolve } = require('../helpers/palettes.cjs');
const { cssRules, parts } = require('../helpers/css-cascade.cjs');

const rules = cssRules('writer/frame/writer-ai.css');
const decl = (body, prop) => body.match(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*([^;]+)`))?.[1].trim();
const TONES = { met: 'ok', partly: 'warn', missing: 'err' };

test('the two light palettes are the ones this covers', () => assert.deepEqual(LIGHT, ['Paper', 'Rose']));

for (const [chip, tone] of Object.entries(TONES)) {
  test(`.gz-fb-chip.${chip} reads at 4.5:1 on a light palette's surface and ground`, () => {
    const mine = rules.filter(([sel]) => parts(sel).some((s) => s.endsWith(`.gz-fb-chip.${chip}`)));
    const base = mine.find(([sel]) => !sel.includes(':root'));
    assert.ok(base, 'a base rule');
    const light = mine.filter(([sel, body]) => parts(sel).some((s) => s.includes(':root:not([data-dark])')) && decl(body, 'color')).at(-1) || base;
    const [text, tint] = [decl(light[1], 'color'), decl(base[1], 'background')];
    for (const name of LIGHT) {
      for (const over of ['--gz-surface', '--gz-surface-2']) {
        const colors = PALETTES[name];
        const ratio = C.contrast(resolve(text, colors, colors[over]), resolve(tint, colors, colors[over]));
        assert.ok(ratio >= 4.5, `${name} ${tone} on ${over}: ${ratio.toFixed(2)}:1 (${text})`);
      }
    }
  });

  test(`.gz-fb-chip.${chip} keeps its tone on a dark palette`, () => {
    const mine = rules.filter(([sel]) => parts(sel).some((s) => s.endsWith(`.gz-fb-chip.${chip}`)));
    const base = mine.find(([sel]) => !sel.includes(':root'));
    assert.equal(decl(base[1], 'color'), `var(--gz-${tone})`);
    for (const [sel, body] of mine) if (decl(body, 'color') && sel.includes(':root')) assert.ok(sel.includes(':not([data-dark])'), `${sel} is for light palettes only`);
  });
}
