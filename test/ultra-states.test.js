// The states Ultra's controls show (hovered, focused, chosen, disabled, refused) survive Glaze's restyle: theme.css
// paints whole families of elements with !important, and a state left out of that paints like the rest.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// A sheet's rules as [selector, body], comments removed, @media and @supports blocks flattened, in file order.
const cssRules = (file) => {
  const css = fs.readFileSync(path.join(__dirname, '..', file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const out = [];
  const walk = (text) => {
    for (let i = 0; i < text.length;) {
      const open = text.indexOf('{', i);
      if (open < 0) break;
      const sel = text.slice(i, open).trim();
      let depth = 1, j = open + 1;
      for (; depth && j < text.length; j++) if (text[j] === '{') depth++; else if (text[j] === '}') depth--;
      const body = text.slice(open + 1, j - 1);
      if (sel.startsWith('@media') || sel.startsWith('@supports')) walk(body); else out.push([sel, body]);
      i = j;
    }
  };
  walk(css);
  return out;
};
// The selector list's own selectors (commas inside :is() and friends don't split).
const parts = (sel) => {
  const out = [];
  let depth = 0, from = 0;
  for (let i = 0; i < sel.length; i++) {
    if (sel[i] === '(') depth++;
    else if (sel[i] === ')') depth--;
    else if (sel[i] === ',' && !depth) { out.push(sel.slice(from, i).trim()); from = i + 1; }
  }
  return [...out, sel.slice(from).trim()];
};
const theme = cssRules('theme.css');
// A selector's specificity as one comparable number (ids, classes, types; 1000 of each is plenty): :is(), :not() and
// :has() count their most specific argument, :where() nothing.
const specificity = (sel) => {
  let n = 0, s = sel.replace(/"[^"]*"/g, '""');
  for (let m; (m = s.match(/:(is|not|has|where)\(/));) {
    let depth = 1, j = m.index + m[0].length;
    for (; depth && j < s.length; j++) if (s[j] === '(') depth++; else if (s[j] === ')') depth--;
    if (m[1] !== 'where') n += Math.max(...parts(s.slice(m.index + m[0].length, j - 1)).map(specificity));
    s = s.slice(0, m.index) + ' ' + s.slice(j);
  }
  n += 1e6 * (s.match(/#[\w-]+/g) || []).length;
  n += 1e3 * (s.match(/\.[\w-]+|\[[^\]]*\]|(?<!:):(?!:)[\w-]+(\([^)]*\))?/g) || []).length;
  n += (s.match(/(^|[\s>+~(])[a-z][\w-]*|::[\w-]+/gi) || []).length;
  return n;
};
// Whether the rule at index `i` wins over the rule at `j` for an element both match: its strongest selector (of those
// `onlyI` keeps) against theirs (of those `onlyJ` keeps), the later rule on a tie.
const top = (i, only) => Math.max(...parts(theme[i][0]).filter(only).map(specificity));
const beats = (i, j, onlyI = () => true, onlyJ = () => true) => top(i, onlyI) > top(j, onlyJ) || (top(i, onlyI) === top(j, onlyJ) && i > j);

test('specificity counts the way the cascade does', () => {
  assert.equal(specificity('#site-wrap :where(a, b)'), 1e6);
  assert.equal(specificity(':is(#site-wrap, .MuiModal-root) button.button:is(.x, :disabled)'), 1e6 + 2e3 + 1);
  assert.equal(specificity('.MuiModal-root *:not(a):not(.MuiButton-root):not(svg :is(path, g))'), 2e3 + 3);
  assert.equal(specificity('#site-wrap .MuiInputBase-root:hover .MuiOutlinedInput-notchedOutline'), 1e6 + 3e3);
  assert.equal(specificity('html[data-gz-bg] .panel-wrap::before'), 2e3 + 2);
});
// The first rule after `from` with a selector matching `sel` and a body matching `body`: its index, or -1.
const after = (from, sel, body) => theme.findIndex(([s, b], i) => i > from && parts(s).some((p) => sel.test(p)) && body.test(b));

test('menu items in a portal are clear at rest, and hover, keyboard focus and the chosen item still show', () => {
  // Ultra's menus, selects and popovers mount on <body>; MUI marks the keyboard's item only with a fill.
  const clear = theme.findLastIndex(([s, b]) => /background:\s*transparent/.test(b) && parts(s).some((p) => /^\.MuiModal-root .*\.MuiMenuItem-root/.test(p)));
  assert.ok(clear >= 0, 'the rest state is still cleared');
  for (const scope of ['MuiModal-root', 'MuiPopper-root']) {
    const item = `^\\.${scope} :is\\(\\.MuiMenuItem-root, \\.MuiListItem-root[^)]*\\)`;
    assert.ok(after(clear, new RegExp(`${item}:is\\(:hover, \\.Mui-focusVisible\\)$`), /background: var\(--gz-hover-fill\) !important/) > clear, `${scope}: a hover and keyboard fill after the clear`);
    assert.ok(after(clear, new RegExp(`${item}\\.Mui-focusVisible$`), /outline: 2px solid var\(--gz-accent\) !important/) > clear, `${scope}: an outline where the keyboard is`);
    const chosen = after(clear, new RegExp(`${item}\\.Mui-selected$`), /background: var\(--gz-accent-soft\) !important/);
    assert.ok(chosen > clear && /box-shadow: inset 3px 0 0 var\(--gz-accent\) !important/.test(theme[chosen][1]), `${scope}: the chosen item filled and barred`);
  }
});

// The rule whose selector starts with `start` (is it, when `start` ends in " {") and whose body matches `body`; a renamed
// rule fails here, not quietly wins.
const rule = (start, body) => {
  const i = theme.findIndex(([s, b]) => (start.endsWith(' {') ? s === start.slice(0, -2) : s.startsWith(start)) && body.test(b));
  assert.ok(i >= 0, `${start} is still in theme.css`);
  return i;
};
const COLOR = /(^|;)\s*color:[^;]*!important/, FILL = /background:[^;]*!important/;

test('a disabled button looks disabled, on the page and in dialogs: its colours outrank every colour forced on buttons', () => {
  const states = /:is\(\.Mui-disabled, :disabled, \[aria-disabled="true"\]\)/;
  const ink = theme.findIndex(([s, b]) => states.test(s) && /(^|;)\s*color: var\(--palette-action-disabled\) !important/.test(b));
  const fill = theme.findIndex(([s, b]) => states.test(s) && /background: var\(--palette-action-disabledBackground\) !important/.test(b));
  assert.ok(ink >= 0 && fill >= 0, 'a disabled text and a disabled fill');
  for (const p of [...parts(theme[ink][0]), ...parts(theme[fill][0])]) assert.match(p, /^:is\(#site-wrap, \.MuiModal-root, \.MuiPopper-root\) /, `${p}: page and portals`);
  for (const c of ['.MuiButton-root', '.MuiIconButton-root', '.MuiPickersDay-root', 'button', 'a.button']) assert.ok(theme[ink][0].includes(c), `${c} greys out`);
  assert.ok(parts(theme[ink][0]).some((p) => p.endsWith(' *')), 'labels and icons inside grey out with it');
  assert.ok(!/MuiMenuItem/.test(theme[ink][0]), 'menu items keep MUI\'s own fade');
  // What paints a button's label or fill.
  for (const j of [rule('#site-wrap :where(*:not(a', COLOR), rule('.MuiButton-contained {', COLOR), rule('.MuiButton-outlined, .MuiButton-text', COLOR),
    rule('#site-wrap button:not(.MuiButton-contained)', COLOR), rule('#site-wrap a.button, #site-wrap a.button *', COLOR),
    rule('#site-wrap :is(a, button).button:is(.button-attempt, .js-submit, [type="submit"]), #site-wrap', COLOR),
    rule('#site-wrap :is([class*="resultsButtonWrapper"]', COLOR), rule('.MuiModal-root *:not(a)', COLOR)]) assert.ok(beats(ink, j), `disabled text beats ${theme[j][0].slice(0, 80)}`);
  for (const j of [rule('.MuiButton-contained {', FILL), rule('#site-wrap a.button, #site-wrap button.button {', FILL),
    rule('#site-wrap :is(a, button).button:is(.button-attempt, .js-submit, [type="submit"]) {', FILL), rule('#site-wrap :is([class*="resultsButtonWrapper"]', FILL)]) assert.ok(beats(fill, j), `disabled fill beats ${theme[j][0].slice(0, 80)}`);
  // MUI's disabled colours, in the palette.
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'theme.css'), 'utf8'), /--palette-action-disabled: var\(--gz-ink-faint\) !important;\s*--palette-action-disabledBackground: var\(--gz-line\) !important;/);
});

test('a field that refused its input shows it: error edge, label and hint, hovered or focused, and a group keeps its asterisk', () => {
  const edge = theme.findIndex(([s, b]) => s.includes('.MuiInputBase-root.Mui-error .MuiOutlinedInput-notchedOutline') && /border-color: var\(--gz-err\) !important/.test(b));
  const words = theme.findIndex(([s, b]) => /\.MuiFormHelperText-root/.test(s) && /\.Mui-error\b/.test(s) && /(^|;)\s*color: var\(--gz-err\) !important/.test(b));
  assert.ok(edge >= 0 && words >= 0, 'an error edge and error words');
  for (const p of [...parts(theme[edge][0]), ...parts(theme[words][0])]) assert.match(p, /^:is\(#site-wrap, \.MuiModal-root, \.MuiPopper-root\) /, `${p}: page and dialogs`);
  for (const c of ['.MuiFormLabel-root', '.MuiInputLabel-root', '.MuiFormLabel-asterisk']) assert.ok(theme[words][0].includes(c), `${c} turns the error colour`);
  assert.ok(theme[edge][0].includes('[aria-invalid="true"]'), 'a plain field marked invalid too');
  const border = /border-color:[^;]*!important/;
  for (const j of [rule('.MuiOutlinedInput-notchedOutline {', border), rule('.MuiInputBase-root:hover .MuiOutlinedInput-notchedOutline', border), rule('.Mui-focused .MuiOutlinedInput-notchedOutline', border),
    rule('.MuiModal-root *, .MuiPopper-root * {', border), rule('#site-wrap * {', border), rule('#site-wrap .MuiInputBase-root:hover', border), rule('#site-wrap .Mui-focused .MuiOutlinedInput-notchedOutline', border)]) assert.ok(beats(edge, j), `the error edge beats ${theme[j][0].slice(0, 80)}`);
  for (const j of [rule('#site-wrap :where(*:not(a', COLOR), rule('#site-wrap :where(.course-id', COLOR), rule('#site-wrap label.MuiInputLabel-root {', COLOR), rule('.MuiModal-root *:not(a)', COLOR)]) assert.ok(beats(words, j), `error words beat ${theme[j][0].slice(0, 80)}`);
  // Hiding text in a legend is for the outline's notch (it only sizes the gap); a group's legend is its title.
  for (const [s, b] of theme) if (/color:\s*transparent/.test(b)) for (const p of parts(s)) if (/\blegend\b/.test(p)) assert.match(p, /\.MuiOutlinedInput-notchedOutline > legend/, p);
});

test('a field\'s edge is a control\'s outline: faint ink at rest, muted ink hovered, over the theme\'s receding lines', () => {
  const border = /border-color:[^;]*!important/, edge = (tok) => new RegExp(`border-color: var\\(--gz-${tok}\\) !important`);
  assert.match(theme[rule('input, textarea, select, .MuiInputBase-root', /color:/)][1], edge('ink-faint'), 'fields anywhere');
  assert.match(theme[rule('.MuiOutlinedInput-notchedOutline {', border)][1], edge('ink-faint'), 'MUI\'s outline');
  // The page's and the portals' catch-all lines come later and are stronger; the fields' own rule outranks them.
  const rest = rule('#site-wrap :where(input, textarea, select, .MuiOutlinedInput-notchedOutline), .MuiModal-root :where', edge('ink-faint'));
  for (const scope of ['#site-wrap', '.MuiModal-root', '.MuiPopper-root']) assert.ok(parts(theme[rest][0]).includes(`${scope} :where(input, textarea, select, .MuiOutlinedInput-notchedOutline)`), scope);
  const page = (p) => p.startsWith('#site-wrap'), portal = (p) => !page(p);
  assert.ok(beats(rest, rule('#site-wrap * {', border), page), 'fields keep their edge over the page\'s lines');
  assert.ok(beats(rest, rule('.MuiModal-root *, .MuiPopper-root * {', border), portal), 'and over the portals\'');
  // Hovered and focused still show, on the page and (by the unscoped rules) in portals.
  for (const j of [rule('#site-wrap .Mui-focused .MuiOutlinedInput-notchedOutline', border), rule('#site-wrap .MuiInputBase-root:hover .MuiOutlinedInput-notchedOutline', edge('ink-muted'))]) assert.ok(beats(j, rest, page, page), `${theme[j][0]} still shows over the resting edge`);
  for (const j of [rule('.Mui-focused .MuiOutlinedInput-notchedOutline', border), rule('.MuiInputBase-root:hover .MuiOutlinedInput-notchedOutline', edge('ink-muted'))]) assert.ok(beats(j, rest, portal, portal), `${theme[j][0]} still shows over the resting edge in a portal`);
});

test('words are never in the faint ink, and words on the accent tint are in the bright accent', () => {
  // Faint ink is for edges and what is switched off (under 4.5:1 on the light palettes); muted ink is the quiet text.
  const muted = /(^|[;{\s])color: var\(--gz-ink-muted\) !important/;
  for (const start of ['#site-wrap .peek .panel-sub-title', '#site-wrap .bb-editor-wrapper:not(.read-only) .ql-editor.ql-blank::before', '#site-wrap .bb-editor-wrapper:not(.read-only) .status-bar {',
    '#site-wrap :is(.js-empty-state, [class*="empty-state"])', '#gz-footer {', '#gz-footer a {']) assert.ok(rule(start, muted) >= 0, `${start} in muted ink`);
  // The accent on its own tint is 4.24:1 on Paper; the tonal controls whose colour wins on the page.
  const hi = /(^|[;{\s])color: var\(--gz-accent-hi\) !important/;
  for (const start of ['#site-wrap a.button, #site-wrap a.button *, #site-wrap button.button, #site-wrap button.button * {', '#site-wrap button.button.small.active-switch, #site-wrap button.button.small.active-switch * {',
    '#site-wrap .js-rubric-view-achievement-score {', '#site-wrap [data-analytics-id^="courses.overview.view.toggle."]:has(input:checked) {', '#site-wrap header[class*="makeStylesheader-"] .MuiButtonBase-root[class*="makeStylescontained-"] {',
    '#site-wrap :is([class*="resultsButtonWrapper"], [role="row"], td) .MuiButton-contained {', '#site-wrap :is(.js-content-navigator-previous, .js-content-navigator-next) button:is(:hover, :focus-visible) {']) {
    const i = rule(start, /background:[^;]*var\(--gz-accent-soft\)|background:[^;]*var\(--gz-accent\) 22%|(^|[;{\s])color:/);
    assert.match(theme[i][1], hi, `${start} words in the bright accent`);
  }
});

test('on a dark palette, words in an instructor\'s highlight are dark, and nothing else in the document is', () => {
  const i = theme.findIndex(([s, b]) => s.startsWith('html[data-gz-dark-theme] #site-wrap :is(.bb-editor-container.is-read-only, .bbml-content) :is(mark,') && /(^|[;{\s])color: var\(--gz-surface-2\) !important/.test(b));
  assert.ok(i >= 0, 'a highlight rule for Ultra\'s read-only content');
  const [first, link] = parts(theme[i][0]);
  assert.match(first, /:is\(mark, :is\(span, font, strong, b, em, i, u\)\[style\*="background"\]/, 'inline text with an authored background, and <mark>');
  assert.match(first, /:not\(\[style\*="transparent" i\], \[data-gz-light\]\)/, 'not a see-through background, nor a light one the sweep repaints');
  assert.ok(!/\b(td|th|p|div|table)\b/.test(first.split(':is(mark')[1]), 'no blocks or cells: their dark fills keep the light ink');
  assert.equal(link, `${first} a`, 'a link in a highlight too');
  // It outranks the page's inherited ink and link colour.
  for (const j of [rule('#site-wrap :where(*:not(a', COLOR), rule('#site-wrap :where(a, .MuiLink-root) {', COLOR)]) assert.ok(beats(i, j), `beats ${theme[j][0].slice(0, 60)}`);
});

test('the chosen day in a date picker is an accent disc with its number on it', () => {
  // MUI fills it with the primary colour (the palette's ink) and the portal's inherit rule gives its number that ink too.
  const day = rule(':is(#site-wrap, .MuiModal-root, .MuiPopper-root) .MuiPickersDay-root.Mui-selected', /background: var\(--gz-accent\) !important/);
  assert.match(theme[day][1], /(^|[;{\s])color: var\(--gz-accent-ink\) !important/);
  for (const j of [rule('.MuiModal-root *:not(a)', COLOR), rule('#site-wrap :where(*:not(a', COLOR)]) assert.ok(beats(day, j), `beats ${theme[j][0].slice(0, 60)}`);
});
