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

// A file upload's states paint two more edges inline, grey1214 (#e8eaec) on every Look: the left edge of a submitted file's
// preview, a bare box or an iframe (FilePreview.jsx), and the line under the Canvas Files picker's column headings
// (CanvasFiles/TableHeader.jsx, in a modal outside #application).
const elem = (tag, attrs, parent, id = '') => ({ tag, id, cls: [], attrs, parent });
const edge = (el, side) => {
  const hit = winner(rules, el, `border(?:-${side})?-color`);
  assert.ok(hit, `a rule paints the ${side} border`);
  const [value, sel] = hit;
  const decl = rules.find(([s]) => s === sel)[1].match(new RegExp(`(?:^|;)\\s*border(?:-${side})?-color\\s*:\\s*([^;]+)`))[1];
  return { value, sel, important: /!important\s*$/.test(decl) };
};
const filePreview = () => elem('span', { 'data-testid': 'file-preview' }, elem('div', { 'data-testid': 'attempt-tab' }, chain('div#application', 'div#content')));
const rawBox = () => elem('div', { style: 'text-align: center; padding: 1.5rem 0px; border-left: 1px solid rgb(232, 234, 236);' }, elem('span', {}, filePreview()));
const rawFrame = () => elem('iframe', { style: 'border: none; width: 100%; height: 100%; position: absolute; border-left: 1px solid rgb(232, 234, 236);' },
  elem('div', { 'data-testid': 'assignments_2_submission_preview' }, elem('span', {}, filePreview())));
const pickerHeading = () => elem('div', { style: 'border-bottom: 1px solid rgb(232, 234, 236);' },
  elem('span', {}, elem('span', { 'data-testid': 'more-options-file-select' }, elem('form', { role: 'dialog', 'data-testid': 'upload-file-modal' }, chain('body', 'span')))));

test('a submitted file preview\'s left edge takes the Look\'s border colour over Canvas\'s inline one', () => {
  for (const [name, el] of [['the unavailable-preview box', rawBox()], ['the preview iframe', rawFrame()]]) {
    const { value, sel, important } = edge(el, 'left');
    assert.equal(value, 'var(--gz-border-line, var(--gz-line))', name);
    assert.ok(important, `${sel} loses to the inline border-left on ${name} without !important`);
  }
});

test('the Canvas Files picker\'s heading line takes the Look\'s border colour over Canvas\'s inline one', () => {
  const { value, sel, important } = edge(pickerHeading(), 'bottom');
  assert.equal(value, 'var(--gz-border-line, var(--gz-line))');
  assert.ok(important, `${sel} loses to the inline border-bottom without !important`);
});

test('the file upload edge rules leave the rest of the page and the modal alone', () => {
  const left = rules.find(([s, b]) => /file-preview/.test(s) && /border-left-color/.test(b));
  assert.ok(left, 'a rule scoped to the file preview paints its left edge');
  for (const el of [rawBox(), rawFrame()]) assert.ok(matches(el, left[0]), `${left[0]} reaches the preview`);
  const stray = elem('div', { style: 'border-left: 1px solid red;' }, elem('div', { 'data-testid': 'attempt-tab' }, chain('div#application', 'div#content')));
  for (const [name, el] of [
    ['a styled div beside the preview', stray],
    ['the preview itself', filePreview()],
    ['the preview box without Canvas\'s inline edge', Object.assign(rawBox(), { attrs: { style: 'text-align: center;' } })],
    ['the page panel', chain('div#application', 'div#content')],
  ]) assert.ok(!matches(el, left[0]), `${left[0]} must not reach ${name}`);
  const bottom = rules.find(([s, b]) => /more-options-file-select/.test(s) && /border-bottom-color/.test(b));
  assert.ok(bottom, 'a rule scoped to the picker paints its heading line');
  assert.ok(matches(pickerHeading(), bottom[0]), `${bottom[0]} reaches the heading`);
  for (const [name, el] of [
    ['the dialog', pickerHeading().parent.parent.parent],
    ['a heading without Canvas\'s inline line', Object.assign(pickerHeading(), { attrs: { style: 'padding: 0;' } })],
    ['a styled div in the page', elem('div', { style: 'border-bottom: 1px solid red;' }, chain('div#application', 'div#content'))],
  ]) assert.ok(!matches(el, bottom[0]), `${bottom[0]} must not reach ${name}`);
});

// The file upload box's "or" divider is a 1px div Canvas colours inline, #6a7883 (FileUpload.jsx). The sweep reads that as a light
// fill and repaints it with the surface, so on a dark Look the line Canvas draws vanishes. It stays a line you can see, as Canvas
// drew it: the Look's strong line colour, over the sweep's !important.
const orLine = (style = 'height: 100%; width: 1px; left: 50%; position: absolute; background-color: rgb(106, 120, 131);') =>
  elem('div', { style, 'data-gz-light': '' },
    elem('div', { style: 'display: flex; height: 100%; position: relative; flex-direction: column; justify-content: center; align-items: center;' },
      elem('div', {}, elem('div', { 'data-testid': 'upload-box' }, chain('div#application', 'div#content')))));
const mobileStyle = 'height: 1px; width: 100%; left: 0px; position: absolute; background-color: rgb(106, 120, 131);';

test('the upload box\'s "or" divider is painted with the Look\'s strong line colour, upright or lying down, over the sweep\'s repaint', () => {
  for (const [name, el] of [['upright', orLine()], ['lying down', orLine(mobileStyle)]]) {
    const hit = winner(rules, el, 'background(?:-color)?');
    assert.ok(hit, `a rule paints the ${name} divider`);
    const [value, sel] = hit;
    assert.equal(value, 'var(--gz-border-strong, var(--gz-line-strong))', `${name}: won by ${sel}`);
    assert.match(rules.find(([s]) => s === sel)[1], /background(?:-color)?\s*:[^;]*!important/, `${sel} loses to the sweep's !important`);
  }
});

test('the "or" divider rule leaves the label, its box and every other positioned fill alone', () => {
  const hit = rules.find(([s, b]) => /upload-box/.test(s) && /background(?:-color)?\s*:\s*var\(--gz-border-strong/.test(b));
  assert.ok(hit, 'a rule scoped to the upload box paints the divider');
  const sel = hit[0];
  assert.ok(matches(orLine(), sel) && matches(orLine(mobileStyle), sel), `${sel} reaches the divider`);
  const line = orLine();
  const label = elem('span', { style: 'display: block; width: 100%; z-index: 99; background-color: rgb(242, 244, 244); padding: 1.5rem 0px;', 'data-gz-light': '' }, line.parent);
  const tab = elem('div', { 'data-testid': 'attempt-tab' }, chain('div#application', 'div#content'));
  for (const [name, el] of [
    ['the "or" label', label],
    ['the divider\'s flex box', line.parent],
    ['the upload box', line.parent.parent.parent],
    ['a positioned fill outside the upload box', elem('div', { style: 'position: absolute; background-color: red;' }, tab)],
    ['a positioned fill in the box without Canvas\'s inline colour', Object.assign(orLine(), { attrs: { style: 'position: absolute;' } })],
  ]) assert.ok(!matches(el, sel), `${sel} must not reach ${name}`);
});
