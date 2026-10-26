// A test's overview: its Assessment Results section puts the heading in its own header and its content in a plain
// ul.section-content with no well. It gets the other overview sections' label pill and surface, so it never sits bare on
// the background.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
// Every rule as [selector, body], @media and @supports flattened.
const rules = (file) => {
  const css = read(file), out = [];
  const walk = (text) => {
    for (let i = 0; i < text.length;) {
      const open = text.indexOf('{', i);
      if (open < 0) break;
      const sel = text.slice(i, open).trim();
      let depth = 1, j = open + 1;
      for (; depth && j < text.length; j++) if (text[j] === '{') depth++; else if (text[j] === '}') depth--;
      const body = text.slice(open + 1, j - 1);
      if (/^@(media|supports)/.test(sel)) walk(body); else if (!sel.startsWith('@')) out.push([sel.replace(/\s+/g, ' '), body]);
      i = j;
    }
  };
  walk(css);
  return out;
};
const THEME = rules('theme.css');
const LABEL = '.assessment-overview-grid > .overview-section > h2.section-label';
const RESULTS_LABEL = '.assessment-overview-grid > .assessment-results-section > .assessment-results-header > h2.section-label';
const RESULTS_WELL = '.assessment-results-section > .section-content';

test('the Assessment Results heading wears every rule the other overview section labels do', () => {
  const pills = THEME.filter(([s]) => s.includes(LABEL));
  assert.ok(pills.length >= 2, 'the label pill: its fill and its shape');
  for (const [s] of pills) assert.ok(s.includes(RESULTS_LABEL), `${s.slice(0, 80)}… also styles the Assessment Results heading`);
  assert.ok(pills.some(([, b]) => /border-radius:\s*999px/.test(b) && /var\(--gz-surface-fill-2/.test(b)));
  assert.ok(pills.some(([, b]) => /display:\s*inline-flex/.test(b) && /min-height:\s*2\.25rem/.test(b)));
});

test('the Assessment Results content gets the wells\' surface, padding and solid-background treatment', () => {
  const fixture = read('test/fixtures/ultra-assessment-rubric.html');
  assert.match(fixture, /assessment-results-section main-section-container"><div class="assessment-results-header">[\s\S]*?<\/div><ul class="section-content"><li class="details-list-item assessment-result-options">/, 'the Results fixture uses the native list shape');
  const wells = THEME.filter(([s]) => s.includes('.section-well'));
  assert.ok(wells.length >= 2, 'the well surface and its solid-background rule');
  for (const [s] of wells) assert.ok(s.includes(RESULTS_WELL), `${s.slice(0, 80)}… also covers the Assessment Results content`);
  assert.ok(wells.some(([, b]) => /border-radius:\s*var\(--gz-radius\)/.test(b) && /backdrop-filter:\s*blur\(var\(--gz-glass\)\)/.test(b) && /var\(--gz-surface-paint/.test(b)));
  assert.ok(wells.some(([s, b]) => s.startsWith('html[data-gz-bg="solid"]') && /backdrop-filter:\s*none/.test(b)));
  const padded = THEME.filter(([s, b]) => s.includes('.assessment-details-section > ul.section-content') && /padding:/.test(b));
  assert.ok(padded.length && padded.every(([s]) => s.includes(RESULTS_WELL)), 'padded like the details list');
});
