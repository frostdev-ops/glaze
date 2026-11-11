// A dark Look prints near-white text on white paper (1.1:1: the page prints blank, or, with background graphics on, as a dark
// slab) and Moodle kept the navigation's left gutter on paper (audit 2026-11-11 A7 #2). Printed, a dark Look is ink on paper in
// light colours, its background layers and floating Glaze chrome are off, and each site's page keeps no room for the bar.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const C = require('../../extension/core/color.js');
const { parts } = require('../helpers/css-cascade.cjs');

const ext = (f) => fs.readFileSync(path.join(__dirname, '../../extension', f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
// Every rule inside the sheet's `@media print` blocks: [selector, declarations].
const printRules = (file) => {
  const css = ext(file), out = [];
  for (const m of css.matchAll(/@media\s+print\s*\{/g)) {
    let depth = 1, i = m.index + m[0].length;
    for (; depth && i < css.length; i++) if (css[i] === '{') depth++; else if (css[i] === '}') depth--;
    for (const [, sel, body] of css.slice(m.index + m[0].length, i - 1).matchAll(/([^{}]+)\{([^{}]*)\}/g)) out.push([sel.trim().replace(/\s+/g, ' '), body]);
  }
  return out;
};
const decls = (body) => Object.fromEntries([...body.matchAll(/(?:^|;)\s*([\w-]+)\s*:\s*([^;]+)/g)].map(([, k, v]) => [k, v.trim()]));

// The sheets each site loads (content.js SHEETS), the way content.js builds them.
const sheetsFor = (kind) => {
  const expr = ext('content/content.js').match(/const SHEETS = (\[.*\]);/)[1];
  return new Function('ultra', 'site', 'moodle', `return ${expr};`)(kind === 'ultra', kind, kind === 'moodle');
};

test('every site loads the shared sheet that holds the print reset', () => {
  for (const kind of ['ultra', 'canvas', 'moodle']) assert.ok(sheetsFor(kind).includes('looks/page/surfaces.css'), kind);
});

const reset = () => printRules('looks/page/surfaces.css').find(([sel]) => parts(sel).includes('html[data-gz-dark-theme]'));

test('printed, a dark Look is dark ink on white: the palette tokens are reset, over the inline values', () => {
  const rule = reset();
  assert.ok(rule, 'surfaces.css has a print rule for html[data-gz-dark-theme]');
  const d = decls(rule[1]);
  for (const k of ['--gz-ink', '--gz-ink-muted', '--gz-ink-faint', '--gz-surface', '--gz-surface-2', '--gz-accent', '--gz-accent-hi', '--gz-accent-soft', '--gz-accent-ink', '--gz-ok', '--gz-warn', '--gz-err', '--gz-line', '--gz-line-strong']) {
    assert.ok(d[k]?.endsWith('!important'), `${k} is set !important, which beats the value content.js writes on <html>`);
  }
  assert.ok(/^light\b/.test(d['color-scheme'] || ''), 'form controls print light');
  assert.equal(d['--gz-surface-grain'], 'none !important');
  const v = (k) => d[k].replace(/\s*!important$/, '');
  const read = [['--gz-ink', '--gz-surface'], ['--gz-ink', '--gz-surface-2'], ['--gz-ink-muted', '--gz-surface'], ['--gz-ink-faint', '--gz-surface'], ['--gz-accent', '--gz-surface'],
    ['--gz-accent-hi', '--gz-accent-soft'], ['--gz-accent-ink', '--gz-accent'], ['--gz-ok', '--gz-surface'], ['--gz-warn', '--gz-surface'], ['--gz-err', '--gz-surface']];
  for (const [fg, bg] of read) {
    const ratio = C.contrast(v(fg), v(bg));
    assert.ok(ratio >= 4.5, `${fg} ${v(fg)} on ${bg} ${v(bg)}: ${ratio.toFixed(2)}:1`);
  }
  assert.ok(C.contrast('#ffffff', v('--gz-surface')) < 1.01, 'the paper is white');
});

test('printed, the background layers and the floating Glaze chrome are off, only while Glaze is', () => {
  const rules = printRules('looks/page/surfaces.css');
  const hidden = rules.filter(([, body]) => /display:\s*none\s*!important/.test(body)).flatMap(([sel]) => parts(sel));
  for (const want of ['html[data-gz-bg]::before', '#gz-scene', '#gz-read', '#gz-boot', '#gz-cmd', '#gz-keys', '#gz-cm', '#gz-peek', '#gz-mk', '#gz-doc-tools', '.gz-tip']) assert.ok(hidden.includes(want), `${want} is hidden`);
  for (const [sel] of rules) for (const p of parts(sel)) assert.ok(/^(html\[data-gz-|#gz-|\.gz-)/.test(p), `${p} only matches what Glaze put on the page`);
});

test('each site\'s own sheet keeps no room for Glaze\'s bar on paper, Moodle\'s gutter included', () => {
  for (const file of ['content/theme.css', 'content/canvas.css', 'content/moodle.css']) {
    const hit = printRules(file).find(([sel, body]) => parts(sel).includes('html[data-gz-navbar]') && /--gz-navbar-left:\s*0px !important/.test(body) && /--gz-navbar-top:\s*0px !important/.test(body));
    assert.ok(hit, `${file} zeroes --gz-navbar-left and --gz-navbar-top when printed`);
  }
  const moodle = printRules('content/moodle.css').find(([sel]) => parts(sel).includes('html[data-gz-navbar]'));
  assert.ok(/--gz-navbar-bottom:\s*0px !important/.test(moodle?.[1] || ''), 'and the bottom');
});
