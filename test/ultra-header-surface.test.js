// theme.css paints any Ultra "*-header" block (and the guidance bars) in the page ground, for the header bars Ultra draws
// white on the page. The same names turn up inside surfaces Glaze paints a step up from the ground: the page header's
// tools slot (behind Glaze's toolbar on Courses, the settings button on Activity), each Announcements row, a Grades
// card's title band, the calendar's bars. Painted ground there they showed as dark patches (WP-F1, the owner's
// screenshots). Here the cascade picks each element's background from theme.css's rules, as the browser would: the
// elements and their ancestors are the ones read on the owner's pages.
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
      if (sel.startsWith('@media') || sel.startsWith('@supports')) walk(body); else if (!sel.startsWith('@')) out.push([sel, body]);
      i = j;
    }
  };
  walk(css);
  return out;
};
// Split `s` at `at` (a regex for one character) outside brackets, parentheses and quotes.
const split = (s, at) => {
  const out = [];
  let depth = 0, quote = '', from = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) { if (c === quote) quote = ''; continue; }
    if (c === '"' || c === "'") quote = c;
    else if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    else if (!depth && at.test(c)) { out.push(s.slice(from, i)); from = i + 1; }
  }
  return [...out, s.slice(from)];
};
const parts = (sel) => split(sel, /,/).map((p) => p.trim()).filter(Boolean);
// A compound's simple selectors: tag, *, #id, .class, [attr], [attr op "v"], :pseudo and :pseudo(args).
const simples = (compound) => {
  const out = [];
  for (let i = 0; i < compound.length;) {
    const c = compound[i];
    let j = i + 1;
    if (c === '[') { for (let q = ''; j < compound.length && (q || compound[j] !== ']'); j++) if (q ? compound[j] === q : /["']/.test(compound[j])) q = q ? '' : compound[j]; j++; }
    else if (c === ':') {
      if (compound[j] === ':') j++;
      while (j < compound.length && /[\w-]/.test(compound[j])) j++;
      if (compound[j] === '(') { for (let depth = 0; j < compound.length; j++) { if (compound[j] === '(') depth++; else if (compound[j] === ')' && !--depth) { j++; break; } } }
    } else while (j < compound.length && /[\w-]/.test(compound[j])) j++;
    out.push(compound.slice(i, j));
    i = j;
  }
  return out;
};
// Whether element `el` ({ tag, id, cls, parent }) matches selector `sel`. Pseudo-classes other than :is(), :not() and
// :where() (states, :has(), pseudo-elements) never match: this is the element at rest, its own box.
const matches = (el, sel) => parts(sel).some((p) => matchComplex(el, p));
const matchComplex = (el, sel) => {
  const tokens = split(sel.replace(/\s*>\s*/g, ' > ').trim(), /\s/).filter(Boolean);
  const go = (e, i) => {
    if (!e || !matchCompound(e, tokens[i])) return false;
    if (i === 0) return true;
    if (tokens[i - 1] === '>') return go(e.parent, i - 2);
    for (let p = e.parent; p; p = p.parent) if (go(p, i - 1)) return true;
    return false;
  };
  return go(el, tokens.length - 1);
};
const matchCompound = (el, compound) => simples(compound).every((s) => {
  if (s === '*') return true;
  if (/^[a-z]/i.test(s)) return el.tag === s.toLowerCase();
  if (s[0] === '#') return el.id === s.slice(1);
  if (s[0] === '.') return el.cls.includes(s.slice(1));
  if (s[0] === '[') {
    const [, k, op = '', v = ''] = s.match(/^\[([\w-]+)(?:([*^$~]?)=["']?([^"'\]]*)["']?)?\]$/);
    const a = k === 'class' ? el.cls.join(' ') : el.attrs?.[k];
    if (a == null) return false;
    return op === '*' ? a.includes(v) : op === '^' ? a.startsWith(v) : op === '$' ? a.endsWith(v) : op === '~' ? a.split(/\s+/).includes(v) : s.includes('=') ? a === v : true;
  }
  const m = s.match(/^:(is|not|where)\(([\s\S]*)\)$/);
  if (!m) return false;
  return m[1] === 'not' ? !matches(el, m[2]) : matches(el, m[2]);
});
// Specificity as one comparable number: :is() and :not() count their most specific argument (here: the one that
// matched, as the browser's :is() counts its most specific argument either way), :where() nothing.
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

// An element path, outermost first: 'div#site-wrap', 'div.base-header.x', 'td.y'.
const chain = (...specs) => specs.reduce((parent, spec) => {
  const [, tag, rest] = spec.match(/^([a-z][\w-]*)(.*)$/i);
  return { tag: tag.toLowerCase(), id: (rest.match(/#([\w-]+)/) || [])[1] || '', cls: [...rest.matchAll(/\.([\w-]+)/g)].map((m) => m[1]), parent };
}, null);
const theme = cssRules('theme.css');
// The background the cascade gives `el` from theme.css: [the winning declaration's value, its rule's selector].
const background = (el) => {
  let best = null;
  theme.forEach(([sel, body], order) => {
    const decl = [...body.matchAll(/(?:^|;)\s*(background(?:-color)?)\s*:\s*([^;]+)/g)].at(-1);
    if (!decl) return;
    const hit = parts(sel).filter((p) => matchComplex(el, p));
    if (!hit.length) return;
    const important = /!important\s*$/.test(decl[2]);
    const rank = [important ? 1 : 0, Math.max(...hit.map(specificity)), order];
    if (!best || rank[0] > best.rank[0] || (rank[0] === best.rank[0] && (rank[1] > best.rank[1] || (rank[1] === best.rank[1] && rank[2] > best.rank[2])))) {
      best = { rank, value: decl[2].replace(/\s*!important\s*$/, '').trim(), sel };
    }
  });
  return best && [best.value, best.sel];
};
const GROUND = /var\(--gz-ground\)|--gz-surface-2\)?\s*$/;

const PAGE = ['html', 'body', 'div#site-wrap', 'main#main-content', 'div#main-content-inner'];

test('the matcher reads selectors the way the cascade does', () => {
  const e = chain(...PAGE, 'section.route-view-container', 'div.base-header', 'div.base-header-tools-transclude');
  assert.ok(matches(e, '#site-wrap div:is([class*="-header"], [class*="header-"]):not(.base-header, .base-header-tools)'));
  assert.ok(!matches(e, '#site-wrap div:is([class*="-header"]):not(.base-header-tools-transclude)'));
  assert.ok(matches(e, '#site-wrap .base-header > div'));
  assert.ok(!matches(e, '#site-wrap > div'));
  assert.ok(!matches(e, '#site-wrap div:hover'));
  assert.ok(matches(e, 'section div[class^="base-header-tools"]'));
  assert.ok(specificity('#site-wrap div:is([class*="-header"], [class*="header-"]):not(.base-header, .base-header-tools)') === 1e6 + 2e3 + 1);
});

test('header-named blocks inside a surface take that surface; they are not ground patches on it', () => {
  const cases = {
    // Courses: the header's tools slot, Glaze's toolbar inside it (one order or the other).
    'Courses: the header tools slot behind Glaze\'s toolbar': chain(...PAGE, 'section.base-courses-container.route-view-container', 'div.base-courses-header-container.base-header', 'div.base-header-tools-transclude'),
    'Courses: the slot, inside the tools': chain(...PAGE, 'section.base-courses-container.route-view-container', 'div.base-courses-header-container.base-header', 'div.base-header-tools', 'div.base-header-tools-transclude'),
    // Activity: the settings button's slot.
    'Activity: the settings button\'s slot': chain(...PAGE, 'section.js-base-stream-container.route-view-container', 'div.base-header', 'div.base-header-tools-transclude'),
    // The Institution page's header slot, where the Dashboard's tabs go.
    'Institution page: the tabs\' slot': chain(...PAGE, 'section.institution-page-container.route-view-container', 'div.black-panel-header.base-header', 'div.base-header-tools-transclude'),
    // Announcements: each row's title, description and icon block, in the list's table.
    'Announcements: a row\'s block': chain(...PAGE, 'div.course-content-container', 'div.panel-wrap', 'div.tabular-list', 'table', 'tbody', 'tr.announcement-item-row', 'td.announcement-header-column', 'div.announcement-header'),
    // Grades: a course card's title band.
    'Grades: a card\'s title band': chain(...PAGE, 'section.route-view-container', 'div.grades-list', 'div.base-grades-course-tile', 'div.row.grades-header'),
    // Calendar: its header slot, the guidance bar and the day view's date bar, on the calendar's surface.
    'Calendar: the header tools slot': chain(...PAGE, 'section.page-base-calendar.route-view-container', 'div.base-header', 'div.base-header-tools-transclude'),
    'Calendar: the guidance bar': chain(...PAGE, 'section.page-base-calendar.route-view-container', 'div.calendar-wrapper', 'div.calendar-head.guidance-wrapper'),
    'Calendar: the day view\'s date bar': chain(...PAGE, 'section.page-base-calendar.route-view-container', 'div.calendar-wrapper', 'div.day-view-header'),
  };
  const wrong = Object.entries(cases).map(([name, el]) => [name, ...(background(el) || ['(none)', ''])]).filter(([, value]) => value !== 'transparent');
  assert.deepEqual(wrong.map(([name, value, sel]) => `${name}: ${value} from ${sel}`), []);
});

test('the bars the ground rule is for keep the ground, and the surfaces around them stay surfaces', () => {
  // A header bar straight on the page (no surface around it) is still ground.
  for (const el of [chain(...PAGE, 'section.route-view-container', 'div.discussion-list-header'), chain(...PAGE, 'div.panel-wrap', 'div.messages-header'),
    chain(...PAGE, 'section.route-view-container', 'div.guidance-wrapper')]) {
    const [value, sel] = background(el);
    assert.match(value, GROUND, `${el.cls.join('.')}: ground (${value} from ${sel})`);
  }
  // The header card, the list and the icon tile in a row are surfaces, as before.
  const surface = /var\(--gz-surface-(paint|fill)/;
  assert.match(background(chain(...PAGE, 'section.route-view-container', 'div.base-courses-header-container.base-header'))[0], surface);
  assert.match(background(chain(...PAGE, 'div.panel-wrap', 'div.tabular-list'))[0], surface);
  assert.match(background(chain(...PAGE, 'div.tabular-list', 'table', 'tbody', 'tr', 'td', 'div.announcement-header', 'div.announcement-icon', 'div.element-image'))[0], surface);
  // A header card inside another surface keeps its own card paint.
  assert.match(background(chain(...PAGE, 'div.element-card', 'div.course-groups-header'))[0], surface);
});
