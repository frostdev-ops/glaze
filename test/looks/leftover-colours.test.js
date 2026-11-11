// Colours the CSS stream left because they sit in JS strings or outside its list (audit 2026-11-11 A7 #5 and #6): the accent text on
// the accent tint in the pen bar (courses/page/docviewer.js) and the rubric table (courses/page/rubric.js) takes --gz-on-soft, and
// the hub's and the course menu's switch tracks, the course cards dialog's search and URL fields and its Frame kinds choice are edged
// in --gz-border-field, as Settings' own switches and fields are (core/ui.css). Each colour's contrast is worked out from the ten
// palettes the built-in Looks wear: before (what the rule drew) and after.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const C = require('../../extension/core/color.js');
const { PALETTES } = require('../helpers/palettes.cjs');
const { cssRules, parts } = require('../helpers/css-cascade.cjs');

const root = path.join(__dirname, '../../extension');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const dark = (c) => C.brightness(C.parse(c['--gz-surface'])) < 0.5;
// What --gz-on-soft is on a palette (looks/page/surfaces.css): the accent on a dark one, the bright accent on a light one.
const onSoft = (c) => (dark(c) ? c['--gz-accent'] : c['--gz-accent-hi']);
const flat = (js) => js.replace(/\/\*[\s\S]*?\*\//g, '');
const rulesIn = (text) => [...flat(text).matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, sel, body]) => [sel.trim().replace(/\s+/g, ' '), body]);
// The template literal `const NAME = \`…\`` of a script.
const sheetOf = (file, name) => { const js = read(file), at = js.indexOf(`const ${name} = \``); assert.ok(at >= 0, `${file} has ${name}`); return js.slice(at + name.length + 10, js.indexOf('`', at + name.length + 10)); };
const table = (rows) => rows.map(([name, before, after]) => `${name} ${before.toFixed(2)} → ${after.toFixed(2)}`).join(', ');

test('the pen bar\'s pressed tool reads its text in --gz-on-soft on the accent tint: Paper 4.24 and Rose 4.47 become 4.5 and over', () => {
  const rule = rulesIn(sheetOf('courses/page/docviewer.js', 'BAR_CSS')).find(([sel]) => sel === 'button[aria-pressed="true"]');
  assert.ok(rule, 'the pressed tool has a rule');
  assert.match(rule[1], /(?:^|[;\s])color:\s*var\(--gz-on-soft,\s*var\(--gz-accent,\s*#2563eb\)\)/, 'on-soft, then the accent where the page defines no token');
  assert.match(rule[1], /background:\s*var\(--gz-accent-soft,/, 'the tint it reads on');
  const rows = Object.entries(PALETTES).map(([n, c]) => [n, C.contrast(c['--gz-accent'], c['--gz-accent-soft']), C.contrast(onSoft(c), c['--gz-accent-soft'])]);
  const low = rows.filter(([, , after]) => after < 4.5);
  assert.deepEqual(low, [], table(rows));
  assert.ok(rows.some(([n, before]) => (n === 'Paper' || n === 'Rose') && before < 4.5), `the plain accent is what failed: ${table(rows)}`);
});

test('a link in the rubric\'s chosen cell takes --gz-on-soft on its accent tint, the same contrast', () => {
  const rules = rulesIn(sheetOf('courses/page/rubric.js', 'CSS'));
  const cell = rules.find(([sel]) => sel === 'td[aria-current]'), link = rules.find(([sel]) => sel === 'td[aria-current] a');
  assert.ok(cell && /background:\s*var\(--gz-accent-soft,/.test(cell[1]), 'the chosen cell is on the tint');
  assert.ok(link, 'its links have a rule of their own');
  assert.match(link[1], /(?:^|[;\s])color:\s*var\(--gz-on-soft,\s*var\(--gz-accent,\s*#086bc1\)\)/);
  const plain = rules.find(([sel]) => sel === 'a');
  assert.match(plain[1], /color:\s*var\(--gz-accent,\s*#086bc1\)/, 'a link on the surface keeps the accent: the tint is where it was short');
  const rows = Object.entries(PALETTES).map(([n, c]) => [n, C.contrast(c['--gz-accent'], c['--gz-accent-soft']), C.contrast(onSoft(c), c['--gz-accent-soft'])]);
  assert.deepEqual(rows.filter(([, , after]) => after < 4.5), [], table(rows));
});

test('both tokens are defined wherever these rules render: every school page loads surfaces.css, and a shadow root inherits from its page', () => {
  const surfaces = read('looks/page/surfaces.css').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(surfaces, /(?:^|\n)html, \[data-gz-course-look\] \{ --gz-on-soft: var\(--gz-accent\); \}/);
  assert.match(surfaces, /(?:^|\n):root, :host, \[data-gz-course-look\] \{[^}]*--gz-border-field:/);
  // content.js puts it on every site it styles (Ultra, Canvas and Moodle alike): the one list of sheets
  assert.match(read('content/content.js'), /const SHEETS = \[[^\n]*'looks\/page\/surfaces\.css'\];/);
  // the pen bar and the rubric are shadow roots (custom properties inherit into them); where a token is missing the old colour shows
  assert.match(read('courses/page/docviewer.js'), /bar\.attachShadow\(/);
  assert.match(read('courses/page/rubric.js'), /node\.attachShadow\(/);
});

// [stylesheet, the track's selector]
const TRACKS = [['core/page/apps.css', '#gz-hub input[type="checkbox"]'], ['content/extras.css', '#gz-cm .gz-cm-tint input'], ['content/canvas.css', '#gz-cm .gz-cm-tint input'], ['content/moodle.css', '#gz-cm .gz-cm-tint input']];
const RING = /box-shadow:\s*inset 0 0 0 1px var\(--gz-border-field, var\(--gz-ink-faint\)\)/;

for (const [file, track] of TRACKS) {
  test(`${track} (${file}) is edged in the faint ink while off, and loses the edge once on`, () => {
    const rules = cssRules(file);
    const off = rules.find(([sel, body]) => parts(sel).includes(track) && /background:\s*var\(--gz-line-strong\)/.test(body));
    assert.ok(off, 'the off track');
    assert.match(off[1], RING);
    const on = rules.find(([sel]) => parts(sel).includes(`${track}:checked`));
    assert.ok(on && /box-shadow:\s*none/.test(on[1]), 'the on track');
  });
}

test('the off track\'s edge reads 3:1 on the surface and the ground in every palette (line-strong, what it was, nowhere near)', () => {
  const rows = Object.entries(PALETTES).map(([n, c]) => [n, C.contrast(c['--gz-line-strong'], c['--gz-surface']), C.contrast(c['--gz-ink-faint'], c['--gz-surface'])]);
  const ground = Object.entries(PALETTES).map(([n, c]) => [n, C.contrast(c['--gz-line-strong'], c['--gz-surface-2']), C.contrast(c['--gz-ink-faint'], c['--gz-surface-2'])]);
  assert.deepEqual(rows.filter(([, , after]) => after < 3), [], `on the surface: ${table(rows)}`);
  assert.deepEqual(ground.filter(([, , after]) => after < 3), [], `on the ground: ${table(ground)}`);
  assert.ok(rows.filter(([, before]) => before < 3).length >= 9, `the strong line was short in nearly every palette: ${table(rows)}`);
});

test('the course cards dialog\'s search and URL fields and its Frame kinds choice are edged in the faint ink', () => {
  const rules = cssRules('core/page/apps.css');
  const edge = (needle) => rules.find(([sel]) => parts(sel).includes(needle))?.[1].match(/(?:^|;)\s*border:\s*1px solid ([^;]+)/)?.[1];
  for (const needle of ['#gz-ccm input[type="search"]', '#gz-ccm input[type="url"]', '#gz-ccm .gz-ccm-kinds']) assert.equal(edge(needle), 'var(--gz-border-field, var(--gz-ink-faint))', needle);
});
