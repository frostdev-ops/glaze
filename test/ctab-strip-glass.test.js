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

test('Ultra\'s course header and its tools are one inset glass panel, no rule between them', () => {
  const both = body(THEME, '.bb-course-navigation course-page-header > header, .bb-course-navigation bb-course-navigation > [class*="makeStylestoolbar"]');
  const head = both + body(THEME, '.bb-course-navigation course-page-header > header');
  const tools = both + body(THEME, '.bb-course-navigation bb-course-navigation > [class*="makeStylestoolbar"]');
  for (const [name, b] of [['header', head], ['tools', tools]]) {
    assert.match(b, /margin-inline:\s*var\(--gz-float-start[^;]*var\(--gz-float-end/, `${name}: inset like the strip`);
    assert.match(b, /backdrop-filter:\s*blur\(var\(--gz-glass/, `${name}: glass`);
    assert.match(b, /var\(--gz-border-line/, `${name}: the Look's line`);
  }
  assert.match(body(THEME, '.bb-course-navigation course-page-header > header'), /border-bottom:\s*0/, 'no rule under the header row');
  assert.match(head, /border-radius:\s*var\(--gz-radius[^;]*var\(--gz-radius[^;]*0 0/, 'rounded on top');
  assert.match(body(THEME, '.bb-course-navigation bb-course-navigation > [class*="makeStylestoolbar"]'), /border-top:\s*0/);
  assert.match(tools, /border-radius:\s*0 0 var\(--gz-radius/, 'rounded below');
  // The same gap from the window, or from the strip above, as the strip keeps.
  assert.match(body(THEME, 'html:not([data-gz-ctabs~="above"]) div.bb-course-navigation'), /padding-top:\s*var\(--gz-float-gap/);
  assert.match(body(THEME, 'html[data-gz-ctabs~="above"] .bb-course-navigation course-page-header > header'), /margin-top:\s*var\(--gz-float-gap/);
  // Scrolled, the rows passing under the bars are veiled in the gaps, by a scroll-linked fade, not a blur.
  const veil = body(THEME, 'div.bb-course-navigation::before');
  assert.match(veil, /animation-timeline:\s*scroll\(\)/);
  assert.doesNotMatch(veil, /backdrop-filter/);
  // The strip between the rows: each row a panel of its own.
  assert.ok(rules(THEME).some(([s, b]) => s.includes('[data-gz-ctabs~="between"]') && s.includes('course-page-header > header') && /border-radius:\s*var\(--gz-radius\) !important/.test(b)));
  // The old full-width paint is gone from both rows.
  assert.ok(!rules(THEME).some(([s, b]) => s.includes('.bb-course-navigation [class*="makeStylestoolbar"]') && !s.includes('course-page-header') && /border-bottom:\s*1px/.test(b)));
});

test('Ultra\'s list toolbar (Announcements: its count and search) has no band; each control is a pill', () => {
  // Ultra's own rule under it goes, also where #site-wrap's guidance rule (other tools' bars) would reach it.
  const bar = body(THEME, '.course-announcement-layer > .guidance-wrapper, #site-wrap .course-announcement-layer > .guidance-wrapper, .messages-header, .messages-header > .summary');
  assert.match(bar, /border-bottom:\s*0 !important/);
  assert.match(bar, /background:\s*transparent/);
  const pill = rules(THEME).find(([s]) => s.includes('.guidance-wrapper > span') && s.includes('#search-button'));
  assert.ok(pill, 'a pill rule for the count and the search button');
  assert.match(pill[1], /border-radius:\s*999px/);
  assert.match(pill[1], /border:\s*1px solid var\(--gz-border-line/);
  assert.match(pill[1], /var\(--gz-surface-paint/);
});
