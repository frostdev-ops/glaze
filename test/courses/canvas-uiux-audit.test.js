// Canvas UI/UX audit: what the audit measured in a browser on the captured pages (focus that couldn't be seen, borders and
// labels under their contrast), kept here as canvas.css's rules and the colours every preset and Look gives them.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const D = require('../defaults.js');
const C = require('../lib/color.js');

const css = fs.readFileSync(path.join(__dirname, '..', 'canvas.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
// The declarations of the rule written with exactly this selector.
const rule = (selector) => {
  const i = css.indexOf(`${selector} {`);
  assert.ok(i >= 0 && /(^|[}\n])\s*$/.test(css.slice(0, i)), `canvas.css has no rule for ${selector}`);
  return css.slice(css.indexOf('{', i) + 1, css.indexOf('}', i)).trim();
};
// Every palette a student can wear: the presets, and each Look's own.
const PALETTES = [...D.GZ_PRESETS.map(([name, colors]) => [name, colors]), ...D.GZ_LOOKS.map((l) => [l.name, D.GZ_SANITIZE(D.GZ_LOOK_APPLY(D.GZ_DEFAULTS, l)).colors])];
// A control's edge or focus ring against both surfaces it sits on (WCAG 1.4.11: 3:1).
const visible = (token) => {
  for (const [name, c] of PALETTES) for (const s of ['--gz-surface', '--gz-surface-2']) {
    const ratio = C.contrast(c[token], c[s]);
    assert.ok(ratio >= 3, `${name}: ${token} on ${s} is ${ratio.toFixed(2)}:1`);
  }
};
const FORMS = ':is(#application, .ui-dialog, [role="dialog"]:not([id^="gz-"] *))';

test('a radio or checkbox shows keyboard focus with the accent ring, at least 3:1 in every palette', () => {
  // The fields' soft ring (accent-soft, about 1.25:1) also reaches them, and the ring for every other control leaves inputs out.
  assert.match(rule(`${FORMS} :is(input, textarea, select):focus, ${FORMS} [class*="textInput__facade"]:focus-within`), /box-shadow: 0 0 0 3px var\(--gz-accent-soft\); outline: 0;/);
  assert.match(css, /body :focus-visible:not\(input, /);
  assert.equal(rule(`${FORMS} input:is([type="checkbox"], [type="radio"]):focus-visible`), 'outline: 2px solid var(--gz-accent); outline-offset: 2px;');
  visible('--gz-accent');
});

test('an InstUI checkbox or toggle has an edge at least 3:1 in every palette, not the strong line\'s 1.6:1', () => {
  // Canvas's own is 4.59:1; unchecked, the edge is all there is of the control.
  for (const [name, c] of PALETTES) assert.ok(C.contrast(c['--gz-line-strong'], c['--gz-surface']) < 3, `${name}: the strong line is a hairline, not a control's edge`);
  assert.equal(rule(`${FORMS} :is([class*="checkboxFacade__facade"], [class*="toggleFacade"])`), 'border-color: var(--gz-ink-muted);');
  visible('--gz-ink-muted');
});

test('an instructor\'s own table headers keep their text as written, not Canvas tables\' small muted labels', () => {
  // 12px uppercase muted ink on an instructor's #c2e0f4 header fill read 4.35:1 in Paper.
  const shading = '#application table:not(.user_content *) :is(th, td)';
  const label = '#application :is(#content, #right-side) table:not([class*="-view-table"], .user_content *) :is(thead th, th[scope="col"])';
  assert.match(rule(shading), /background: transparent !important;/);
  assert.match(rule(label), /color: var\(--gz-ink-muted\); font-size: 0\.75rem;.*text-transform: uppercase;/s);
  // No other rule styles a table's header cells as labels without the exclusion.
  const labels = [...css.matchAll(/([^{}]*\btable\b[^{}]*\bth\b[^{}]*)\{[^}]*text-transform: uppercase[^}]*\}/g)].map((m) => m[1].trim());
  assert.ok(labels.includes(label));
  for (const s of labels) assert.ok(s.includes('.user_content *)'), `${s}: an instructor's headers too`);
});

test('a scene Look\'s stand-in gradient (no WebGL, or until the scene draws) is dark enough for muted text, at any intensity', () => {
  // At the scene's own dim (intensity 60 is 30%), Synthwave's pastel wash put Glaze's dashboard text near 2:1.
  const fallback = '--gz-bg-tint: color-mix(in srgb, var(--gz-surface-2) calc(80% + var(--gz-bg-dim, 60%) / 4), transparent);';
  const selector = 'html[data-gz-bg]:is([data-gz-bg="scene"], [data-gz-bg="shader"], [data-gz-bg="layers"])';
  assert.equal(rule(selector), fallback);
  const moodle = fs.readFileSync(path.join(__dirname, '..', 'moodle.css'), 'utf8');
  assert.ok(moodle.includes(`${selector} { ${fallback} }`), 'Moodle\'s backgrounds too');
  // After the base rule, at its specificity, so it wins.
  assert.ok(css.indexOf(`${selector} {`) > css.indexOf('html[data-gz-bg]:not([data-gz-bg="solid"]) {'));
  const [, base, per] = fallback.match(/calc\((\d+)% \+ var\(--gz-bg-dim, 60%\) \/ (\d+)\)/).map(Number);
  const over = (a, t, b) => ({ r: a.r * t + b.r * (1 - t), g: a.g * t + b.g * (1 - t), b: a.b * t + b.b * (1 - t) });
  const scenes = D.GZ_LOOKS.map((l) => [l.name, D.GZ_SANITIZE(D.GZ_LOOK_APPLY(D.GZ_DEFAULTS, l))]).filter(([, s]) => ['scene', 'shader', 'layers'].includes(s.bg.kind));
  assert.ok(scenes.length >= 5);
  for (const [name, s] of scenes) for (let intensity = 0; intensity <= 100; intensity += 10) {
    const dim = Math.round(D.GZ_SCENE_LOOK(intensity).dim * 100), tint = Math.min(100, base + dim / per) / 100;
    // The tint over each of the gradient's colours at full strength: the lightest spot it can have.
    for (const c of D.GZ_BG_COLORS(s.bg.colors, s.colors)) {
      const ratio = C.contrast(s.colors['--gz-ink-muted'], C.hex(over(C.parse(s.colors['--gz-surface-2']), tint, C.parse(c))));
      assert.ok(ratio >= 4.5, `${name} at intensity ${intensity}: muted ink ${ratio.toFixed(2)}:1 over ${c}`);
    }
  }
});

test('a quiz result\'s Correct answer / Wrong answer label keeps its ink on its fill, over the sweep\'s repair tags', () => {
  // A sweep that ran before canvas.css tagged the label data-gz-dark ([data-gz-dark] { color: var(--gz-ink) !important }):
  // light ink on the green read 1.69:1, on the red 2.44:1.
  assert.match(css, /\[data-gz-dark\] \{ color: var\(--gz-ink\) !important; \}/);
  const label = rule('#application #questions .answer_indicator');
  assert.match(label, /background: var\(--gz-ok\) !important;/);
  assert.match(label, /color: var\(--gz-accent-ink\) !important;/);
  assert.match(rule('#application #questions .answer_indicator.incorrect'), /background: var\(--gz-err\) !important;/);
  for (const [name, c] of PALETTES) for (const fill of ['--gz-ok', '--gz-err']) {
    const ratio = C.contrast(c['--gz-accent-ink'], c[fill]);
    assert.ok(ratio >= 4.5, `${name}: --gz-accent-ink on ${fill} is ${ratio.toFixed(2)}:1`);
  }
});
