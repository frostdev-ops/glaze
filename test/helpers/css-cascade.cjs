// The CSS cascade, as far as theme tests need it: a sheet's rules, whether an element path matches a selector, and which
// declaration of a property wins for that element. Elements are { tag, id, cls, attrs, parent } built with chain().
const fs = require('node:fs');
const path = require('node:path');

// A sheet's rules as [selector, body], comments removed, @media and @supports blocks flattened, in file order.
const cssRules = (file) => {
  const css = fs.readFileSync(path.join(__dirname, '..', '..', file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
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
// The value the cascade gives `el` for a property from `rules` (cssRules()): [value, the winning rule's selector], or null.
// `prop` is a regex source for the property name, e.g. 'background(?:-color)?'.
const winner = (rules, el, prop) => {
  let best = null;
  const re = new RegExp(`(?:^|;)\\s*(${prop})\\s*:\\s*([^;]+)`, 'g');
  rules.forEach(([sel, body], order) => {
    const decl = [...body.matchAll(re)].at(-1);
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

module.exports = { cssRules, split, parts, simples, matches, matchComplex, matchCompound, specificity, chain, winner };
