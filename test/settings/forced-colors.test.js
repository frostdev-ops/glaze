// Windows High Contrast (forced-colors: active) replaces background colours and drops box shadows: the popup's and the settings
// page's switch, segmented choice and palette swatch, and the hub's switches, are drawn in system colours so on and off,
// the chosen segment and the chosen swatch stay apart (audit 2026-11-11 A7 #3).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parts } = require('../helpers/css-cascade.cjs');

// The inside of every `@media (forced-colors: active)` block of a sheet, as rule text.
const forced = (file) => {
  const css = fs.readFileSync(path.join(__dirname, '../../extension', file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const out = [];
  for (const m of css.matchAll(/@media[^{]*\(forced-colors:\s*active\)[^{]*\{/g)) {
    let depth = 1, i = m.index + m[0].length;
    for (; depth && i < css.length; i++) if (css[i] === '{') depth++; else if (css[i] === '}') depth--;
    out.push(css.slice(m.index + m[0].length, i - 1));
  }
  return out.join('\n');
};
// The body of the rule whose selector list names `selector` (a list is matched by any one of its selectors).
const rule = (block, selector) => [...block.matchAll(/([^{}]+)\{([^}]*)\}/g)].find(([, sel]) => parts(sel).includes(selector))?.[2];

test('ui.css draws the popup\'s and settings page\'s switches in system colours', () => {
  const b = forced('core/ui.css');
  assert.ok(b, 'a forced-colors block');
  for (const [track, knob, on, onKnob] of [
    ['input[type="checkbox"]:not(.switch > input)', 'input[type="checkbox"]:not(.switch > input)::before', 'input[type="checkbox"]:not(.switch > input):checked', 'input[type="checkbox"]:not(.switch > input):checked::before'],
    ['.switch span', '.switch span::after', '.switch input:checked + span', '.switch input:checked + span::after'],
  ]) {
    const t = rule(b, track), k = rule(b, knob), o = rule(b, on), ok = rule(b, onKnob);
    assert.ok(t && /forced-color-adjust:\s*none/.test(t) && /border:\s*1px solid ButtonText/.test(t) && /background:\s*Canvas/.test(t), `${track} has an edge and a Canvas fill`);
    assert.ok(k && /background:\s*ButtonText/.test(k), `${knob} is ButtonText`);
    assert.ok(o && /background:\s*Highlight/.test(o), `${on} is Highlight`);
    assert.ok(ok && /background:\s*HighlightText/.test(ok), `${onKnob} is HighlightText`);
  }
});

test('ui.css marks the chosen segment and the chosen swatch', () => {
  const b = forced('core/ui.css');
  const seg = rule(b, '.seg label:has(input:checked)');
  assert.ok(seg && /background:\s*Highlight/.test(seg) && /color:\s*HighlightText/.test(seg), 'the chosen segment is filled in Highlight');
  const sw = rule(b, '.swatch[aria-pressed="true"]');
  assert.ok(sw && /outline:\s*3px solid Highlight/.test(sw), 'the chosen swatch and Look card are ringed in Highlight');
  const own = rule(b, '.swatch');
  assert.ok(own && /forced-color-adjust:\s*none/.test(own) && /border-color:\s*CanvasText/.test(own), 'a swatch keeps its own colours, edged');
});

test('apps.css draws the hub\'s switches in system colours', () => {
  const b = forced('core/page/apps.css');
  const t = rule(b, '#gz-hub input[type="checkbox"]'), k = rule(b, '#gz-hub input[type="checkbox"]::before');
  const o = rule(b, '#gz-hub input[type="checkbox"]:checked'), ok = rule(b, '#gz-hub input[type="checkbox"]:checked::before');
  assert.ok(t && /forced-color-adjust:\s*none/.test(t) && /border:\s*1px solid ButtonText !important/.test(t) && /background:\s*Canvas !important/.test(t));
  assert.ok(k && /background:\s*ButtonText/.test(k));
  assert.ok(o && /background:\s*Highlight !important/.test(o));
  assert.ok(ok && /background:\s*HighlightText/.test(ok));
});
