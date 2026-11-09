// Geometry contracts for Canvas's floating panels. No browser layout claims: expand the authored
// box declarations into physical edges for each direction, with unequal start/end gutters.
const test = require('node:test');
const assert = require('node:assert/strict');
const { cssRules, split } = require('../helpers/css-cascade.cjs');

const rules = cssRules('content/canvas.css');
const body = (part) => {
  const hit = rules.find(([s]) => s.includes(part));
  assert.ok(hit, `missing rule: ${part}`);
  return hit[1];
};
const edges = (decls, property, dir) => {
  const sides = {}, start = dir === 'rtl' ? 'right' : 'left', end = dir === 'rtl' ? 'left' : 'right';
  for (const raw of decls.split(';')) {
    const colon = raw.indexOf(':');
    if (colon < 0) continue;
    const prop = raw.slice(0, colon).trim();
    const values = split(raw.slice(colon + 1).replace(/!important/g, '').trim(), /\s/).filter(Boolean);
    if (prop === property) {
      const [a, b = a, c = a, d = b] = values;
      Object.assign(sides, { top: a, right: b, bottom: c, left: d });
    } else if (prop === `${property}-inline`) {
      sides[start] = values[0]; sides[end] = values[1] || values[0];
    } else if (prop === `${property}-block`) {
      sides.top = values[0]; sides.bottom = values[1] || values[0];
    }
  }
  return sides;
};

test('floating content and desktop breadcrumb gutters follow the inline direction', () => {
  for (const selector of ['#application #content:not(:has(', '#application .ic-app-nav-toggle-and-crumbs:not(:has(']) {
    for (const dir of ['ltr', 'rtl']) {
      const sides = edges(body(selector), 'margin', dir);
      assert.equal(sides[dir === 'rtl' ? 'right' : 'left'], 'var(--gz-float-start, 12px)', `${selector}: ${dir} start`);
      assert.equal(sides[dir === 'rtl' ? 'left' : 'right'], 'var(--gz-float-end, 12px)', `${selector}: ${dir} end`);
    }
  }
});

test('the course menu keeps its larger padding at the inline start in RTL too', () => {
  for (const dir of ['ltr', 'rtl']) {
    const sides = edges(body('#application #left-side #section-tabs'), 'padding', dir);
    assert.equal(sides[dir === 'rtl' ? 'right' : 'left'], '1rem', `${dir} start`);
    assert.equal(sides[dir === 'rtl' ? 'left' : 'right'], '0.5rem', `${dir} end`);
  }
});

test('the submission panel joins the first tab at the start corner in either direction', () => {
  const panel = body('#application #submit_assignment .ui-tabs-panel');
  assert.match(panel, /border-radius:\s*var\(--gz-radius\)\s*;/);
  assert.match(panel, /border-start-start-radius:\s*0\s*;/);
});

// Canvas's modules script marks the last item the pointer or focus touched with context_module_item_hover and only takes it
// off when another item is touched (ui/shared/context-modules/jquery/index.jsx), painting it #fff
// (content_next.scss). The row the cursor left must stay on the palette, as a hovered one does.
test('a module item Canvas keeps marked as hovered after the pointer leaves stays on the palette', () => {
  const hit = rules.find(([s]) => /li\.context_module_item:is\([^)]*\.context_module_item_hover/.test(s));
  assert.ok(hit, 'the sticky hover class is covered');
  assert.match(hit[1], /background:\s*transparent\s*!important/);
});
