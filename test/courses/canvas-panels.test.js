// Geometry contracts for Canvas's floating panels. No browser layout claims: expand the authored
// box declarations into physical edges for each direction, with unequal start/end gutters.
const test = require('node:test');
const assert = require('node:assert/strict');
const { cssRules, split, chain, winner, matches } = require('../helpers/css-cascade.cjs');

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

// Assignments 2's student page wraps the chosen submission type in a div it styles inline,
// `background-color: grey1111; border-top: 2px solid grey1214` (AttemptTab.jsx): #e8eaec on every Look, a white line over
// the text entry box on a dark one. An inline declaration outranks any author rule that isn't !important.
test('the line above the Assignments 2 submission box takes the Look\'s border colour over Canvas\'s inline one', () => {
  const node = (tag, attrs, parent) => ({ tag, id: '', cls: [], attrs, parent });
  const tab = node('div', { 'data-testid': 'attempt-tab' }, chain('div#application', 'div#content'));
  const box = node('div', { style: 'background-color: rgb(242, 244, 244); border-top: 2px solid rgb(232, 234, 236);' }, tab);
  const hit = winner(rules, box, 'border(?:-top)?-color');
  assert.ok(hit, 'a rule paints the box\'s top border');
  const [value, sel] = hit;
  assert.equal(value, 'var(--gz-border-line, var(--gz-line))');
  const decl = rules.find(([s]) => s === sel)[1].match(/(?:^|;)\s*border(?:-top)?-color\s*:\s*([^;]+)/)[1];
  assert.match(decl, /!important\s*$/, `${sel} loses to the inline border-top without !important`);
});

test('the Assignments 2 divider rule leaves the editor inside it and the rest of the page alone', () => {
  const node = (tag, attrs, parent) => ({ tag, id: '', cls: [], attrs, parent });
  const tab = node('div', { 'data-testid': 'attempt-tab' }, chain('div#application', 'div#content'));
  const box = node('div', { style: 'background-color: rgb(242, 244, 244); border-top: 2px solid rgb(232, 234, 236);' }, tab);
  const hit = rules.find(([s, b]) => /attempt-tab/.test(s) && /border-top-color/.test(b));
  assert.ok(hit, 'a rule scoped to the attempt tab paints the divider');
  const sel = hit[0];
  assert.ok(matches(box, sel), `${sel} reaches the box`);
  for (const [name, el] of [
    ['the text editor in it', node('div', { 'data-testid': 'text-editor', style: 'padding: 0.75rem 3rem;' }, box)],
    ['the tab itself', tab],
    ['the page panel', chain('div#application', 'div#content')],
    ['a styled div elsewhere', node('div', { style: 'border-top: 1px solid red;' }, chain('div#application', 'div#content'))],
  ]) assert.ok(!matches(el, sel), `${sel} must not reach ${name}`);
});

// The sticky Submit/Next bar of the same page is styled inline too, `background-color: white; border-color: grey1214`
// (StudentFooter.jsx), so its top edge is the same white line on a dark Look.
const a2Footer = () => {
  const footer = { tag: 'div', id: 'assignments-student-footer', cls: [], parent: chain('div#application', 'div') };
  footer.attrs = { style: 'background-color: rgb(255, 255, 255); border-color: rgb(232, 234, 236);' };
  return footer;
};

test('the Assignments 2 footer\'s border takes the Look\'s border colour over Canvas\'s inline one', () => {
  const hit = winner(rules, a2Footer(), 'border(?:-top)?-color');
  assert.ok(hit, 'a rule paints the footer\'s border');
  const [value, sel] = hit;
  assert.equal(value, 'var(--gz-border-line, var(--gz-line))');
  const decl = rules.find(([s]) => s === sel)[1].match(/(?:^|;)\s*border(?:-top)?-color\s*:\s*([^;]+)/)[1];
  assert.match(decl, /!important\s*$/, `${sel} loses to the inline border-color without !important`);
});

test('the Assignments 2 footer rule leaves the rest of the page alone', () => {
  const hit = rules.find(([s, b]) => /assignments-student-footer/.test(s) && /border-color/.test(b));
  assert.ok(hit, 'a rule scoped to the footer paints its border');
  const sel = hit[0];
  assert.ok(matches(a2Footer(), sel), `${sel} reaches the footer`);
  const node = (tag, attrs, parent) => ({ tag, id: '', cls: [], attrs, parent });
  for (const [name, el] of [
    ['the page panel', chain('div#application', 'div#content')],
    ['a styled div elsewhere', node('div', { style: 'border-color: red;' }, chain('div#application', 'div#content'))],
    ['the footer without Canvas\'s inline colour', Object.assign(a2Footer(), { attrs: {} })],
  ]) assert.ok(!matches(el, sel), `${sel} must not reach ${name}`);
});
