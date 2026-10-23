// The course tab strip and Ultra's course header float as glass, like Glaze's rail: inset from the window and the rail,
// rounded with the Look's radius, one line and the Look's resting depth, and no full-width band or rule under them.
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
const body = (file, sel) => rules(file).filter(([s]) => s === sel).map(([, b]) => b).join(';');
const TABS = 'features/coursetabs.css', THEME = 'theme.css';

test('the strip is a floating glass bar, not a band across the page', () => {
  const box = body(TABS, '#gz-ctabs');
  assert.ok(box, '#gz-ctabs rule');
  assert.doesNotMatch(box, /border-bottom|backdrop-filter|background:\s*(?![\s]|none|transparent)/, 'the strip\'s own box paints nothing full-width');
  const bar = body(TABS, '#gz-ctabs::before');
  assert.match(bar, /inset-block:\s*var\(--gz-float-gap[^;]*\) 0;/, 'inset from the top');
  assert.match(bar, /inset-inline:\s*var\(--gz-float-start[^;]*var\(--gz-float-end/, 'and from both sides, logically (RTL too)');
  assert.match(bar, /border:\s*1px solid var\(--gz-border-line/);
  assert.match(bar, /border-radius:\s*var\(--gz-radius/);
  assert.match(bar, /backdrop-filter:\s*blur\(var\(--gz-glass/);
  assert.match(bar, /color-mix\(in srgb, var\(--gz-surface-paint[^;]*var\(--gz-glass-mix/, 'the Look\'s surface at its glass mix: solid at glass 0');
  assert.match(bar, /box-shadow:\s*var\(--gz-rest-shadow/);
  assert.match(bar, /pointer-events:\s*none/);
  // The strip keeps its footprint (what the page reserves before it arrives): the gap is inside it.
  assert.match(read(TABS), /html\[data-gz-ctabs\] \{[^}]*--gz-ctabs-h:\s*calc\(var\(--gz-ctabs-bar\) \+ var\(--gz-float-gap\)\)/);
  // A solid background has nothing to blur.
  assert.ok(rules(TABS).some(([s, b]) => s.startsWith('html[data-gz-bg="solid"]') && s.includes('#gz-ctabs::before') && /backdrop-filter:\s*none/.test(b)));
});

test('beside Glaze\'s rail the bars start at its gutter; elsewhere they keep the same gap from the window', () => {
  const root = body(TABS, 'html');
  assert.match(root, /--gz-float-gap:\s*12px/, 'the rail\'s own gutter');
  assert.match(root, /--gz-float-start:\s*max\(0px, calc\(var\(--gz-float-gap\) - var\(--gz-navbar-left, 0px\)\)\)/);
});

test('tabs are soft rounded items, the current one marked as the rail marks its item', () => {
  const css = read(TABS);
  assert.doesNotMatch(css, /margin-bottom:\s*-1px/, 'no folder tab hanging over a rule');
  assert.doesNotMatch(css, /\[data-shape="tab"\] \.gz-ctab \{[^}]*0 0;/, 'no square-bottomed folder corners');
  const tab = body(TABS, '#gz-ctabs .gz-ctab');
  assert.match(tab, /background:\s*transparent/, 'resting tabs sit on the bar\'s glass');
  assert.match(body(TABS, '#gz-ctabs .gz-ctab[aria-selected="true"]'), /var\(--gz-accent-hi[^;]*15%[^;]*transparent/);
  assert.match(body(TABS, '#gz-ctabs .gz-ctab:hover'), /var\(--gz-ink-muted\) 12%, transparent/);
});
