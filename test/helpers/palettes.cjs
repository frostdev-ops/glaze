// The ten palettes the eleven built-in Looks wear (six presets, four of their own) and the colour maths a stylesheet does
// with them: color-mix(in srgb, ...) over var(--gz-*), as the browser resolves it.
const C = require('../../extension/core/color.js');
const D = require('../../extension/content/defaults.js');

const PALETTES = Object.fromEntries([...D.GZ_PRESETS, ...D.GZ_LOOKS.filter((l) => !l.palette).map((l) => [l.name, l.colors])]);
const LIGHT = Object.keys(PALETTES).filter((n) => C.brightness(C.parse(PALETTES[n]['--gz-surface'])) >= 0.5);

const split = (s) => {
  const out = [];
  let depth = 0, from = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '(') depth++;
    else if (s[i] === ')') depth--;
    else if (s[i] === ',' && !depth) { out.push(s.slice(from, i).trim()); from = i + 1; }
  }
  return [...out, s.slice(from).trim()];
};
// A colour expression to hex, `over` being what a see-through colour sits on: var(--gz-x), #hex, and
// color-mix(in srgb, A p%, B), B being `transparent` or another colour.
const resolve = (expr, colors, over = colors['--gz-surface']) => {
  expr = expr.trim();
  let m = expr.match(/^var\((--[\w-]+)(?:,\s*([\s\S]+))?\)$/);
  if (m) return resolve(colors[m[1]] ?? m[2], colors, over);
  if (/^#[0-9a-f]{3,8}$/i.test(expr)) return C.hex(C.parse(expr));
  m = expr.match(/^color-mix\(in srgb,([\s\S]+)\)$/);
  if (!m) throw new Error(`can't resolve ${expr}`);
  const [a, b] = split(m[1]);
  const side = (part) => { const p = part.match(/^([\s\S]+?)(?:\s+([\d.]+)%)?$/); return [p[1], p[2] === undefined ? null : +p[2] / 100]; };
  let [ax, ap] = side(a), [bx, bp] = side(b);
  ap ??= bp === null ? 0.5 : 1 - bp;
  bp ??= 1 - ap;
  const mix = (x, y, p) => { const X = C.parse(x), Y = C.parse(y); return C.hex({ r: X.r * p + Y.r * (1 - p), g: X.g * p + Y.g * (1 - p), b: X.b * p + Y.b * (1 - p) }); };
  const left = resolve(ax, colors, over);
  if (bx === 'transparent') return mix(left, over, ap);
  return mix(left, resolve(bx, colors, over), ap / (ap + bp));
};

module.exports = { PALETTES, LIGHT, resolve, split };
