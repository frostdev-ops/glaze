// Slides of a .pptx (or .ppsx) as a plain model the slides viewer draws with DOM calls: the deck's size and theme, and each
// slide's background, shapes and notes with what they inherit (master → layout → slide) resolved. Lengths are EMUs (914,400
// an inch), font sizes points, angles degrees clockwise, colours CSS hex (#rrggbb, or #rrggbbaa when see-through), except
// geometry, which stays as lib/pptx-geom.js's input straight from the XML. A picture names its media part, whose bytes
// media() reads. What the viewer can't draw is counted in
// deck.cut, never thrown: a malformed shape degrades alone and an unreadable slide comes back empty.
// Bounded: the archive by lib/doctext.js's unzip, then slides, shapes, group depth, table cells (each table's and the
// deck's), text, paragraphs, runs, custom geometry's guides and path commands, and each XML part's bytes and elements.
// Classic script; module.exports for node.
var GZ_PPTX = globalThis.GZ_PPTX || (() => {
  const D = () => globalThis.GZ_DOCTEXT || require('./doctext.js');
  const LIMITS = { slides: 2000, shapes: 50000, depth: 16, cells: 10000, text: 4 << 20, part: 8 << 20, nodes: 400000, paragraphs: 100000, runs: 400000, allCells: 50000, guides: 100000, guideWork: 1000000, commands: 300000 };
  const MAX = 1e9; // EMUs, about 1,000 inches: anything further out is junk

  // ---- values -----------------------------------------------------------------------------------------------------
  // An attribute that isn't a finite number counts as absent. Strict OOXML writes percentages as "50%".
  const num = (s, d) => {
    if (typeof s === 'number') return Number.isFinite(s) ? s : d;
    if (s == null || s === '') return d;
    const v = s.endsWith('%') ? parseFloat(s) * 1000 : Number(s);
    return Number.isFinite(v) ? v : d;
  };
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const flag = (s, d = false) => (s === '1' || s === 'true' || s === 'on' ? true : s === '0' || s === 'false' || s === 'off' ? false : d);
  const round = (v, k = 1) => Math.round(v * k) / k || 0; // never -0, which JSON can't keep
  const coord = (s) => clamp(num(s, 0), -MAX, MAX);
  const length = (s) => clamp(num(s, 0), 0, MAX);
  const frac = (s, d = 0) => round(clamp(num(s, d * 100000) / 100000, -10, 10), 1e4);
  const angle = (s) => round((((num(s, 0) / 60000) % 360) + 360) % 360, 100);
  const own = (o, k) => (o && typeof k === 'string' && Object.hasOwn(o, k) ? o[k] : undefined);
  const lastOf = (list) => list[list.length - 1] || null;

  // ---- XML --------------------------------------------------------------------------------------------------------
  // A part as a tree of { n: local name, a: raw attributes, kids }, plus `text` for a:t and a:tableStyleId. A stray end
  // tag is dropped and an unclosed element ends with its parent. mc:AlternateContent keeps its Fallback (PowerPoint's
  // picture of an equation, a newer chart or ink), each node marked with what the Choice held; with no Fallback, the Choice.
  // More than max elements is refused: a few kilobytes of deflated <a:p/> are millions of them. The presentation keeps
  // its prefix instead, so trailing content over the cap cannot refuse a whole deck.
  const local = (q) => q.slice(q.lastIndexOf(':') + 1);
  const TEXT = new Set(['t', 'tableStyleId']);
  const parse = (src, max = Infinity, onLimit = null) => {
    const T = D(), root = { n: '', a: '', kids: [] }, stack = [root], open = new Map();
    let nodes = 0;
    const pop = () => {
      const node = stack.pop();
      open.set(node.n, open.get(node.n) - 1);
      settle(node, stack[stack.length - 1]);
      return node;
    };
    for (const tk of T.tokens(src)) {
      const top = stack[stack.length - 1];
      if (tk.name == null) {
        if (top.text != null) top.text += tk.cdata ?? T.decode(tk.text);
        continue;
      }
      const n = local(tk.name);
      if (tk.close) {
        if (open.get(n)) for (let done = false; !done;) done = pop().n === n;
        continue;
      }
      if (++nodes > max) {
        if (!onLimit) throw new RangeError('document too large');
        onLimit(); break;
      }
      const node = { n, a: tk.attrs, kids: [] };
      if (TEXT.has(n)) node.text = '';
      top.kids.push(node);
      if (!tk.empty) { stack.push(node); open.set(n, (open.get(n) || 0) + 1); }
    }
    while (stack.length > 1) pop();
    return root.kids[0] || null;
  };
  const settle = (node, parent) => {
    if (node.n !== 'AlternateContent' || parent.kids[parent.kids.length - 1] !== node) return;
    const choice = node.kids.find((k) => k.n === 'Choice'), fallback = node.kids.find((k) => k.n === 'Fallback');
    const what = fallback && choice ? feature(choice) : '';
    parent.kids.pop();
    for (const k of (fallback || choice)?.kids || []) {
      if (what) k.alt = what;
      parent.kids.push(k);
    }
  };
  // What a Choice held, so its Fallback can say what it stands for.
  const feature = (choice) => {
    const todo = [choice];
    for (let seen = 0; todo.length && seen < 5000; seen++) {
      const k = todo.pop();
      if (k.n === 'oMath' || k.n === 'oMathPara') return 'equation';
      if (k.n === 'contentPart') return 'ink';
      if (k.n === 'model3d') return '3d';
      if (k.n === 'graphicData' && /chart/.test(at(k, 'uri') || '')) return 'chart';
      for (const c of k.kids) todo.push(c);
    }
    return '';
  };
  const ATTR = /(?:^|\s)([A-Za-z_][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  const attrs = (node) => {
    if (!node.m) {
      node.m = Object.create(null);
      for (const [, k, a, b] of node.a.matchAll(ATTR)) node.m[k] = D().decode(a ?? b);
    }
    return node.m;
  };
  const at = (node, name) => (node ? attrs(node)[name] : undefined);
  // A relationship id, whatever its namespace prefix (r:embed, r:id, r:link).
  const ref = (node, name) => {
    if (!node) return null;
    const m = attrs(node);
    for (const k in m) if (k.endsWith(`:${name}`)) return m[k];
    return null;
  };
  const kid = (node, ...names) => {
    for (const n of names) node = node && (node.kids.find((k) => k.n === n) || null);
    return node || null;
  };
  const kids = (node, n) => (node ? node.kids.filter((k) => k.n === n) : []);
  const make = (n, m = {}, kidList = []) => {
    const node = { n, a: '', m: Object.create(null), kids: kidList };
    for (const [k, v] of Object.entries(m)) if (v != null) node.m[k] = v;
    return node;
  };
  const nvOf = (node) => node.kids.find((k) => k.n.startsWith('nv')) || null;

  // ---- colours ----------------------------------------------------------------------------------------------------
  // A colour is { r, g, b, a } (sRGB, 0–1) while its transforms run, in a context { scheme: the theme's colours, map: the
  // slide's colour map (bg1 → lt1, …), ph: a style reference's colour for phClr }. Transforms run in document order:
  // luminance, saturation and hue in HSL, tint and shade in linear RGB, as PowerPoint mixes them (lighter 40% of #4472c4
  // is #8faadc, its 50% shade #2f528f, its 40% tint #cfd5ea).
  const COLOR = new Set(['srgbClr', 'schemeClr', 'sysClr', 'prstClr', 'scrgbClr', 'hslClr']);
  const SCHEME = ['dk1', 'lt1', 'dk2', 'lt2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink'];
  const OFFICE = { dk1: '000000', lt1: 'FFFFFF', dk2: '44546A', lt2: 'E7E6E6', accent1: '4472C4', accent2: 'ED7D31', accent3: 'A5A5A5', accent4: 'FFC000', accent5: '5B9BD5', accent6: '70AD47', hlink: '0563C1', folHlink: '954F72' };
  const MAP = { bg1: 'lt1', tx1: 'dk1', bg2: 'lt2', tx2: 'dk2', accent1: 'accent1', accent2: 'accent2', accent3: 'accent3', accent4: 'accent4', accent5: 'accent5', accent6: 'accent6', hlink: 'hlink', folHlink: 'folHlink' };
  const SYSTEM = { windowText: '000000', window: 'FFFFFF', btnFace: 'F0F0F0', btnText: '000000', highlight: '0078D7', highlightText: 'FFFFFF', grayText: '6D6D6D', menu: 'F0F0F0', menuText: '000000', captionText: '000000' };
  const PRESET = {
    aliceBlue: 'F0F8FF', antiqueWhite: 'FAEBD7', aqua: '00FFFF', aquamarine: '7FFFD4', azure: 'F0FFFF', beige: 'F5F5DC', bisque: 'FFE4C4', black: '000000',
    blanchedAlmond: 'FFEBCD', blue: '0000FF', blueViolet: '8A2BE2', brown: 'A52A2A', burlyWood: 'DEB887', cadetBlue: '5F9EA0', chartreuse: '7FFF00',
    chocolate: 'D2691E', coral: 'FF7F50', cornflowerBlue: '6495ED', cornsilk: 'FFF8DC', crimson: 'DC143C', cyan: '00FFFF', darkBlue: '00008B',
    darkCyan: '008B8B', darkGoldenrod: 'B8860B', darkGray: 'A9A9A9', darkGreen: '006400', darkGrey: 'A9A9A9', darkKhaki: 'BDB76B', darkMagenta: '8B008B',
    darkOliveGreen: '556B2F', darkOrange: 'FF8C00', darkOrchid: '9932CC', darkRed: '8B0000', darkSalmon: 'E9967A', darkSeaGreen: '8FBC8F',
    darkSlateBlue: '483D8B', darkSlateGray: '2F4F4F', darkSlateGrey: '2F4F4F', darkTurquoise: '00CED1', darkViolet: '9400D3', deepPink: 'FF1493',
    deepSkyBlue: '00BFFF', dimGray: '696969', dimGrey: '696969', dkBlue: '00008B', dkCyan: '008B8B', dkGoldenrod: 'B8860B', dkGray: 'A9A9A9',
    dkGreen: '006400', dkGrey: 'A9A9A9', dkKhaki: 'BDB76B', dkMagenta: '8B008B', dkOliveGreen: '556B2F', dkOrange: 'FF8C00', dkOrchid: '9932CC',
    dkRed: '8B0000', dkSalmon: 'E9967A', dkSeaGreen: '8FBC8F', dkSlateBlue: '483D8B', dkSlateGray: '2F4F4F', dkSlateGrey: '2F4F4F', dkTurquoise: '00CED1',
    dkViolet: '9400D3', dodgerBlue: '1E90FF', firebrick: 'B22222', floralWhite: 'FFFAF0', forestGreen: '228B22', fuchsia: 'FF00FF', gainsboro: 'DCDCDC',
    ghostWhite: 'F8F8FF', gold: 'FFD700', goldenrod: 'DAA520', gray: '808080', green: '008000', greenYellow: 'ADFF2F', grey: '808080', honeydew: 'F0FFF0',
    hotPink: 'FF69B4', indianRed: 'CD5C5C', indigo: '4B0082', ivory: 'FFFFF0', khaki: 'F0E68C', lavender: 'E6E6FA', lavenderBlush: 'FFF0F5',
    lawnGreen: '7CFC00', lemonChiffon: 'FFFACD', lightBlue: 'ADD8E6', lightCoral: 'F08080', lightCyan: 'E0FFFF', lightGoldenrodYellow: 'FAFAD2',
    lightGray: 'D3D3D3', lightGreen: '90EE90', lightGrey: 'D3D3D3', lightPink: 'FFB6C1', lightSalmon: 'FFA07A', lightSeaGreen: '20B2AA',
    lightSkyBlue: '87CEFA', lightSlateGray: '778899', lightSlateGrey: '778899', lightSteelBlue: 'B0C4DE', lightYellow: 'FFFFE0', lime: '00FF00',
    limeGreen: '32CD32', linen: 'FAF0E6', ltBlue: 'ADD8E6', ltCoral: 'F08080', ltCyan: 'E0FFFF', ltGoldenrodYellow: 'FAFAD2', ltGray: 'D3D3D3',
    ltGreen: '90EE90', ltGrey: 'D3D3D3', ltPink: 'FFB6C1', ltSalmon: 'FFA07A', ltSeaGreen: '20B2AA', ltSkyBlue: '87CEFA', ltSlateGray: '778899',
    ltSlateGrey: '778899', ltSteelBlue: 'B0C4DE', ltYellow: 'FFFFE0', magenta: 'FF00FF', maroon: '800000', medAquamarine: '66CDAA', medBlue: '0000CD',
    mediumAquamarine: '66CDAA', mediumBlue: '0000CD', mediumOrchid: 'BA55D3', mediumPurple: '9370DB', mediumSeaGreen: '3CB371', mediumSlateBlue: '7B68EE',
    mediumSpringGreen: '00FA9A', mediumTurquoise: '48D1CC', mediumVioletRed: 'C71585', medOrchid: 'BA55D3', medPurple: '9370DB', medSeaGreen: '3CB371',
    medSlateBlue: '7B68EE', medSpringGreen: '00FA9A', medTurquoise: '48D1CC', medVioletRed: 'C71585', midnightBlue: '191970', mintCream: 'F5FFFA',
    mistyRose: 'FFE4E1', moccasin: 'FFE4B5', navajoWhite: 'FFDEAD', navy: '000080', oldLace: 'FDF5E6', olive: '808000', oliveDrab: '6B8E23',
    orange: 'FFA500', orangeRed: 'FF4500', orchid: 'DA70D6', paleGoldenrod: 'EEE8AA', paleGreen: '98FB98', paleTurquoise: 'AFEEEE',
    paleVioletRed: 'DB7093', papayaWhip: 'FFEFD5', peachPuff: 'FFDAB9', peru: 'CD853F', pink: 'FFC0CB', plum: 'DDA0DD', powderBlue: 'B0E0E6',
    purple: '800080', red: 'FF0000', rosyBrown: 'BC8F8F', royalBlue: '4169E1', saddleBrown: '8B4513', salmon: 'FA8072', sandyBrown: 'F4A460',
    seaGreen: '2E8B57', seaShell: 'FFF5EE', sienna: 'A0522D', silver: 'C0C0C0', skyBlue: '87CEEB', slateBlue: '6A5ACD', slateGray: '708090',
    slateGrey: '708090', snow: 'FFFAFA', springGreen: '00FF7F', steelBlue: '4682B4', tan: 'D2B48C', teal: '008080', thistle: 'D8BFD8', tomato: 'FF6347',
    turquoise: '40E0D0', violet: 'EE82EE', wheat: 'F5DEB3', white: 'FFFFFF', whiteSmoke: 'F5F5F5', yellow: 'FFFF00', yellowGreen: '9ACD32',
  };
  const rgb = (h) => (typeof h === 'string' && /^[0-9a-f]{6}$/i.test(h) ? { r: parseInt(h.slice(0, 2), 16) / 255, g: parseInt(h.slice(2, 4), 16) / 255, b: parseInt(h.slice(4), 16) / 255, a: 1 } : null);
  const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const srgb = (c) => clamp(c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055, 0, 1);
  const toHsl = ({ r, g, b }) => {
    const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
    if (!d) return { h: 0, s: 0, l };
    const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return { h: h / 6, s: l > 0.5 ? d / (2 - max - min) : d / (max + min), l };
  };
  const fromHsl = ({ h, s, l }) => {
    if (!s) return { r: l, g: l, b: l };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
    const f = (t) => {
      t = ((t % 1) + 1) % 1;
      return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p;
    };
    return { r: f(h + 1 / 3), g: f(h), b: f(h - 1 / 3) };
  };
  const baseColor = (node, C) => {
    switch (node.n) {
      case 'srgbClr': return rgb(at(node, 'val'));
      case 'schemeClr': {
        const v = at(node, 'val');
        return v === 'phClr' ? C.ph && { ...C.ph } : rgb(own(C.scheme, own(C.map, v) || v));
      }
      case 'sysClr': return rgb(at(node, 'lastClr')) || rgb(own(SYSTEM, at(node, 'val')));
      case 'prstClr': return rgb(own(PRESET, at(node, 'val')));
      case 'scrgbClr': return { r: srgb(clamp(num(at(node, 'r'), 0) / 100000, 0, 1)), g: srgb(clamp(num(at(node, 'g'), 0) / 100000, 0, 1)), b: srgb(clamp(num(at(node, 'b'), 0) / 100000, 0, 1)), a: 1 };
      case 'hslClr': return { ...fromHsl({ h: num(at(node, 'hue'), 0) / 21600000, s: clamp(num(at(node, 'sat'), 0) / 100000, 0, 1), l: clamp(num(at(node, 'lum'), 0) / 100000, 0, 1) }), a: 1 };
    }
    return null;
  };
  const transform = (c, t) => {
    const raw = num(at(t, 'val'), NaN), v = raw / 100000;
    if (!Number.isFinite(raw) && t.n !== 'comp' && t.n !== 'inv' && t.n !== 'gray') return;
    const hsl = (fn) => { const h = toHsl(c); fn(h); h.h = ((h.h % 1) + 1) % 1; h.s = clamp(h.s, 0, 1); h.l = clamp(h.l, 0, 1); Object.assign(c, fromHsl(h)); };
    const each = (fn) => { for (const k of ['r', 'g', 'b']) c[k] = clamp(fn(c[k]), 0, 1); };
    switch (t.n) {
      case 'alpha': c.a = clamp(v, 0, 1); break;
      case 'alphaMod': c.a = clamp(c.a * v, 0, 1); break;
      case 'alphaOff': c.a = clamp(c.a + v, 0, 1); break;
      case 'lumMod': hsl((h) => { h.l *= v; }); break;
      case 'lumOff': hsl((h) => { h.l += v; }); break;
      case 'lum': hsl((h) => { h.l = v; }); break;
      case 'satMod': hsl((h) => { h.s *= v; }); break;
      case 'satOff': hsl((h) => { h.s += v; }); break;
      case 'sat': hsl((h) => { h.s = v; }); break;
      case 'hueMod': hsl((h) => { h.h *= v; }); break;
      case 'hueOff': hsl((h) => { h.h += raw / 21600000; }); break;
      case 'hue': hsl((h) => { h.h = raw / 21600000; }); break;
      case 'comp': hsl((h) => { h.h += 0.5; }); break;
      case 'tint': each((x) => srgb(1 - (1 - lin(x)) * clamp(v, 0, 1))); break;
      case 'shade': each((x) => srgb(lin(x) * clamp(v, 0, 1))); break;
      case 'inv': each((x) => 1 - x); break;
      case 'gray': { const y = 0.3 * c.r + 0.59 * c.g + 0.11 * c.b; each(() => y); break; }
    }
  };
  const colorOf = (node, C) => {
    const c = node && baseColor(node, C);
    if (!c) return null;
    for (const t of node.kids) transform(c, t);
    return c;
  };
  const hex = (c) => {
    if (!c) return null;
    const h = (v) => Math.round(clamp(v, 0, 1) * 255).toString(16).padStart(2, '0');
    return `#${h(c.r)}${h(c.g)}${h(c.b)}${Math.round(clamp(c.a, 0, 1) * 255) < 255 ? h(c.a) : ''}`;
  };
  const colorNode = (node) => (node ? node.kids.find((k) => COLOR.has(k.n)) || null : null);
  const colorIn = (node, C) => hex(colorOf(colorNode(node), C));
  const schemeHex = (name, C) => hex(rgb(own(C.scheme, own(C.map, name) || name)));
  const mapOf = (node, base) => {
    const out = { ...base };
    for (const k of Object.keys(MAP)) { const v = at(node, k); if (SCHEME.includes(v)) out[k] = v; }
    return out;
  };

  // ---- theme and fonts --------------------------------------------------------------------------------------------
  // Each font with the bundled face (lib/fonts) standing in for it: the metric twins of Office's core fonts, and the
  // nearest twin for Office's other theme fonts, as Writer has them. Other fonts keep their name and a generic family
  // from their pitchFamily (its high nibble: roman, swiss, modern, script, decorative).
  const FACES = {
    calibri: 'carlito', 'calibri light': 'carlito', carlito: 'carlito', aptos: 'carlito', 'aptos display': 'carlito',
    arial: 'arimo', helvetica: 'arimo', 'helvetica neue': 'arimo', arimo: 'arimo', 'liberation sans': 'arimo', 'century gothic': 'arimo',
    'times new roman': 'tinos', times: 'tinos', tinos: 'tinos', 'liberation serif': 'tinos', cambria: 'tinos', georgia: 'tinos', 'book antiqua': 'tinos',
    'courier new': 'cousine', courier: 'cousine', cousine: 'cousine', 'liberation mono': 'cousine',
  };
  const GENERIC = { carlito: 'sans-serif', arimo: 'sans-serif', tinos: 'serif', cousine: 'monospace' };
  const FAMILY = ['', 'serif', 'sans-serif', 'monospace', 'cursive', 'fantasy'];
  const faceOf = (name, pitch) => {
    const face = own(FACES, name.toLowerCase()) || null;
    return { name, face, generic: face ? GENERIC[face] : FAMILY[(num(pitch, 0) >> 4) & 15] || 'sans-serif' };
  };
  const themeOf = (tree) => {
    const el = kid(tree, 'themeElements'), fmt = kid(el, 'fmtScheme');
    const scheme = { ...OFFICE };
    for (const k of kid(el, 'clrScheme')?.kids || []) {
      const c = Object.hasOwn(OFFICE, k.n) && hex(colorOf(colorNode(k), { scheme: OFFICE, map: MAP, ph: null }));
      if (c) scheme[k.n] = c.slice(1, 7);
    }
    const font = (k, d) => {
      const l = kid(el, 'fontScheme', k, 'latin');
      return faceOf((at(l, 'typeface') || '').trim().slice(0, 64) || d, at(l, 'pitchFamily'));
    };
    return {
      name: at(tree, 'name') || '', scheme, fonts: { major: font('majorFont', 'Calibri Light'), minor: font('minorFont', 'Calibri') },
      fills: kid(fmt, 'fillStyleLst')?.kids || [], lines: kids(kid(fmt, 'lnStyleLst'), 'ln'), effects: kids(kid(fmt, 'effectStyleLst'), 'effectStyle'), bg: kid(fmt, 'bgFillStyleLst')?.kids || [],
    };
  };
  const DEFAULT_THEME = themeOf(null);
  const fontOf = (latin, X) => {
    const name = (at(latin, 'typeface') || '').trim().slice(0, 64);
    if (!name || name.startsWith('+')) return name.startsWith('+mj') ? X.theme.fonts.major : X.theme.fonts.minor;
    return faceOf(name, at(latin, 'pitchFamily'));
  };

  // ---- fills and lines --------------------------------------------------------------------------------------------
  // A fill: null for none, { type: 'solid', color }, { type: 'gradient', kind: 'linear' | 'circle' | 'rect' | 'shape',
  // angle, rotate, stops: [{ at, color }], focus? }, { type: 'picture', media, crop, alpha, tile } or { type: 'pattern',
  // preset, fg, bg }; undefined where a node has no fill of its own, so the next one down the inheritance decides.
  const IMAGES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', jpe: 'image/jpeg', jfif: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', webp: 'image/webp', svg: 'image/svg+xml' };
  const METAFILES = new Set(['emf', 'wmf', 'emz', 'wmz', 'pict', 'pct']);
  const extOf = (path) => /\.([a-z0-9]+)$/i.exec(path || '')?.[1].toLowerCase();
  const mimeOf = (path) => own(IMAGES, extOf(path)) || null;
  const PICTURE_EFFECTS = new Set(['grayscl', 'duotone', 'biLevel', 'clrChange', 'clrRepl', 'lum', 'hsl', 'tint', 'blur']);
  // A blip's picture: its media part (the SVG where PowerPoint keeps one beside its PNG), crop and opacity; or why it has none.
  const picture = (fill, X) => {
    const blip = kid(fill, 'blip');
    const svg = kids(kid(blip, 'extLst'), 'ext').map((e) => kid(e, 'svgBlip')).find(Boolean);
    let media = null, why = 'pictures';
    for (const id of [ref(svg, 'embed'), ref(blip, 'embed')]) {
      const path = id && X.rels.get(id)?.path;
      if (!path || !X.names.has(path)) continue;
      if (mimeOf(path)) { media = { path, mime: mimeOf(path) }; break; }
      if (METAFILES.has(extOf(path))) why = 'metafiles';
    }
    if (media) X.media.set(media.path, media.mime);
    const src = kid(fill, 'srcRect');
    return {
      media, why, crop: { l: frac(at(src, 'l')), t: frac(at(src, 't')), r: frac(at(src, 'r')), b: frac(at(src, 'b')) },
      alpha: round(clamp(num(at(kid(blip, 'alphaModFix'), 'amt'), 100000) / 100000, 0, 1), 1e4), effects: !!blip && blip.kids.some((k) => PICTURE_EFFECTS.has(k.n)),
    };
  };
  const PATHS = new Set(['circle', 'rect', 'shape']);
  const gradient = (g, C) => {
    const stops = kids(kid(g, 'gsLst'), 'gs').slice(0, 64).map((s) => ({ at: round(clamp(num(at(s, 'pos'), 0) / 100000, 0, 1), 1e4), color: colorIn(s, C) }))
      .filter((s) => s.color).sort((a, b) => a.at - b.at);
    if (!stops.length) return null;
    const path = kid(g, 'path');
    const out = { type: 'gradient', kind: path ? (PATHS.has(at(path, 'path')) ? at(path, 'path') : 'circle') : 'linear', angle: path ? 0 : angle(at(kid(g, 'lin'), 'ang')), rotate: flag(at(g, 'rotWithShape'), true), stops };
    if (path) { const r = kid(path, 'fillToRect'); out.focus = { l: frac(at(r, 'l')), t: frac(at(r, 't')), r: frac(at(r, 'r')), b: frac(at(r, 'b')) }; }
    return out;
  };
  const fillOf = (parent, X) => {
    for (const k of parent ? parent.kids : []) {
      switch (k.n) {
        case 'noFill': return null;
        case 'solidFill': { const color = colorIn(k, X.colors); return color ? { type: 'solid', color } : null; }
        case 'gradFill': return gradient(k, X.colors);
        case 'pattFill': {
          const preset = /^[A-Za-z0-9]{1,20}$/.test(at(k, 'prst') || '') ? at(k, 'prst') : 'pct5';
          return { type: 'pattern', preset, fg: colorIn(kid(k, 'fgClr'), X.colors) || '#000000', bg: colorIn(kid(k, 'bgClr'), X.colors) || '#ffffff' };
        }
        case 'blipFill': {
          const p = picture(k, X);
          if (!p.media) { X.count(p.why); return null; }
          return { type: 'picture', media: p.media, crop: p.crop, alpha: p.alpha, tile: !!kid(k, 'tile') };
        }
        case 'grpFill': return X.groupFill ?? null;
      }
    }
    return undefined;
  };
  // An outline: { width, color, dash, cap, join, head, tail } or null, property by property over a list of [<a:ln>, colour
  // context], most general first: a style's theme line, then each shape's own from master to slide.
  const DASHES = new Set(['solid', 'dot', 'dash', 'lgDash', 'dashDot', 'lgDashDot', 'lgDashDotDot', 'sysDash', 'sysDot', 'sysDashDot', 'sysDashDotDot']);
  const CAPS = { rnd: 'round', sq: 'square', flat: 'flat' };
  const ENDS = new Set(['triangle', 'stealth', 'diamond', 'oval', 'arrow']);
  const SIZES = new Set(['sm', 'med', 'lg']);
  const lineEnd = (k) => (ENDS.has(at(k, 'type')) ? { type: at(k, 'type'), w: SIZES.has(at(k, 'w')) ? at(k, 'w') : 'med', len: SIZES.has(at(k, 'len')) ? at(k, 'len') : 'med' } : null);
  const lineOf = (list) => {
    const L = {};
    for (const [ln, C] of list) {
      if (!ln) continue;
      const w = num(at(ln, 'w'), -1), cap = own(CAPS, at(ln, 'cap'));
      if (w >= 0) L.width = round(Math.min(w, 20116800));
      if (cap) L.cap = cap;
      for (const k of ln.kids) {
        switch (k.n) {
          case 'noFill': L.color = null; break;
          case 'solidFill': L.color = colorIn(k, C); break;
          case 'gradFill': L.color = gradient(k, C)?.stops[0].color ?? null; break;
          case 'pattFill': L.color = colorIn(kid(k, 'fgClr'), C); break;
          case 'prstDash': L.dash = DASHES.has(at(k, 'val')) ? at(k, 'val') : 'solid'; break;
          case 'custDash': L.dash = 'dash'; break;
          case 'round': case 'bevel': case 'miter': L.join = k.n; break;
          case 'headEnd': L.head = lineEnd(k); break;
          case 'tailEnd': L.tail = lineEnd(k); break;
        }
      }
    }
    return L.color ? { width: L.width ?? 9525, color: L.color, dash: L.dash || 'solid', cap: L.cap || 'flat', join: L.join || 'round', head: L.head || null, tail: L.tail || null } : null;
  };
  // A style's references to the theme's fills (idx 1–999; backgrounds from 1001), lines and effects, its colour standing
  // in for phClr.
  const withPh = (refNode, X) => ({ ...X.colors, ph: colorOf(colorNode(refNode), X.colors) });
  const styleFill = (refNode, X) => {
    if (!refNode) return undefined;
    const idx = num(at(refNode, 'idx'), 0);
    const node = idx >= 1001 ? X.theme.bg[idx - 1001] : idx > 0 ? X.theme.fills[idx - 1] : null;
    return node ? fillOf({ kids: [node] }, { ...X, colors: withPh(refNode, X) }) ?? null : null;
  };
  const styleLine = (refNode, X) => {
    const ln = refNode && X.theme.lines[num(at(refNode, 'idx'), 0) - 1];
    return ln ? [ln, withPh(refNode, X)] : [null];
  };
  const effectful = (node) => !!node && node.kids.some((k) => (k.n === 'effectLst' || k.n === 'effectDag') && k.kids.length);
  const deep = (node) => {
    const sp3d = kid(node, 'sp3d'), camera = kid(node, 'scene3d', 'camera');
    return !!(sp3d && (sp3d.kids.length || num(at(sp3d, 'extrusionH'), 0) > 0 || num(at(sp3d, 'contourW'), 0) > 0)) || !!(camera && (at(camera, 'prst') !== 'orthographicFront' || kid(camera, 'rot')));
  };
  // What a shape's own properties, its style's effect and its text ask for that the viewer drops.
  const cutOf = (spPrs, style, txBody, X) => {
    const cut = [];
    const effect = X.theme.effects[num(at(kid(style, 'effectRef'), 'idx'), 0) - 1];
    const runs = kids(txBody, 'p').flatMap((p) => p.kids).map((r) => kid(r, 'rPr'));
    if (spPrs.some(effectful) || effectful(effect) || runs.some(effectful)) cut.push('effects');
    if (spPrs.some(deep) || deep(effect) || deep(kid(txBody, 'bodyPr'))) cut.push('3d');
    return cut;
  };

  // ---- text -------------------------------------------------------------------------------------------------------
  // Paragraph and run properties merge from the most general list to the run itself: the presentation's defaults, the
  // master's title, body or other style, a style's fontRef, the master's and the layout's placeholder list styles, the
  // shape's own, the paragraph, the run. Each list is { list: an lstStyle-like node } or { run: properties for every
  // level }.
  const PARA = ['marL', 'indent', 'defTabSz'];
  const mergePara = (P, node, runs = true) => {
    if (!node) return;
    const m = attrs(node);
    for (const k of PARA) if (Number.isFinite(num(m[k], NaN))) P[k] = num(m[k]);
    if (m.algn != null) P.algn = m.algn;
    if (m.rtl != null) P.rtl = m.rtl;
    for (const k of node.kids) {
      switch (k.n) {
        case 'lnSpc': case 'spcBef': case 'spcAft': P[k.n] = k; break;
        case 'buClrTx': P.buClr = 'tx'; break;
        case 'buClr': P.buClr = k; break;
        case 'buSzTx': P.buSz = 'tx'; break;
        case 'buSzPct': case 'buSzPts': P.buSz = k; break;
        case 'buFontTx': P.buFont = 'tx'; break;
        case 'buFont': P.buFont = k; break;
        case 'buNone': case 'buChar': case 'buAutoNum': case 'buBlip': P.bu = k; break;
        case 'tabLst': P.tabs = k; break;
        case 'defRPr': if (runs) mergeRun(P.run, k); break;
      }
    }
  };
  const mergeRun = (R, node) => {
    if (!node) return;
    const m = attrs(node);
    for (const k of ['sz', 'spc', 'baseline']) if (Number.isFinite(num(m[k], NaN))) R[k] = num(m[k]);
    for (const k of ['b', 'i', 'u', 'strike', 'cap']) if (m[k] != null) R[k] = m[k];
    for (const k of node.kids) {
      switch (k.n) {
        case 'noFill': case 'solidFill': case 'gradFill': case 'pattFill': R.fill = k; break;
        case 'latin': R.latin = k; break;
        case 'highlight': R.highlight = k; break;
        // A hyperlink takes the theme's link colour, or keeps the text's where PowerPoint 2019's extension says "tx".
        case 'hlinkClick': R.link = kids(kid(k, 'extLst'), 'ext').some((e) => at(kid(e, 'hlinkClr'), 'val') === 'tx') ? 'text' : 'theme'; break;
      }
    }
  };
  // A style's or a table style's font and colour, as run properties for every level.
  const fontLayer = (fontRef, color, b, i) => {
    const R = {};
    const idx = at(fontRef, 'idx');
    if (idx === 'major' || idx === 'minor') R.latin = make('latin', { typeface: idx === 'major' ? '+mj-lt' : '+mn-lt' });
    const c = color || colorNode(fontRef);
    if (c) R.fill = make('solidFill', {}, [c]);
    if (b === 'on' || b === 'off') R.b = b;
    if (i === 'on' || i === 'off') R.i = i;
    return R;
  };
  const levelStyle = (lists, level) => {
    const P = { run: {} };
    for (const l of lists) {
      if (l.run) Object.assign(P.run, l.run);
      else if (l.list) { mergePara(P, kid(l.list, 'defPPr')); mergePara(P, kid(l.list, `lvl${level + 1}pPr`)); }
    }
    return P;
  };
  const UNDERLINE = {
    sng: 'solid', words: 'solid', heavy: 'solid', dbl: 'double', dotted: 'dotted', dottedHeavy: 'dotted', dash: 'dashed', dashHeavy: 'dashed', dashLong: 'dashed',
    dashLongHeavy: 'dashed', dotDash: 'dashed', dotDashHeavy: 'dashed', dotDotDash: 'dashed', dotDotDashHeavy: 'dashed', wavy: 'wavy', wavyHeavy: 'wavy', wavyDbl: 'wavy',
  };
  const STRIKE = { sngStrike: 'single', dblStrike: 'double' };
  const CASE = { all: 'all', small: 'small' };
  const ptOf = (sz) => round(clamp(sz ?? 1800, 100, 400000) / 100, 100);
  const runOf = (k, R, X) => {
    const field = k.n === 'fld' ? (at(k, 'type') || 'field').slice(0, 32) : null;
    const text = X.take(k.n === 'br' ? '\n' : field === 'slidenum' ? String(X.number) : kid(k, 't')?.text ?? '');
    if (text == null) return null;
    let color = X.ink;
    if (R.fill) color = R.fill.n === 'noFill' ? null : (R.fill.n === 'gradFill' ? gradient(R.fill, X.colors)?.stops[0].color : colorIn(R.fill.n === 'pattFill' ? kid(R.fill, 'fgClr') : R.fill, X.colors)) || X.ink;
    if (R.link === 'theme') color = schemeHex('hlink', X.colors);
    const run = {
      text, font: fontOf(R.latin, X), size: ptOf(R.sz), bold: flag(R.b), italic: flag(R.i), underline: own(UNDERLINE, R.u) || (R.link ? 'solid' : false),
      strike: own(STRIKE, R.strike) || false, color, highlight: R.highlight ? colorIn(R.highlight, X.colors) : null, baseline: round(clamp((R.baseline ?? 0) / 100000, -1, 1), 1e4),
      caps: own(CASE, R.cap) || null, spacing: round(clamp((R.spc ?? 0) / 100, -4000, 4000), 100), link: !!R.link, field,
    };
    if (k.n === 'br') run.br = true;
    return run;
  };
  // Wingdings' and Symbol's bullet characters as the Unicode ones they draw (those fonts aren't on the web), also where
  // PowerPoint stored them in the private use area (U+F0xx).
  const SYMBOLS = { wingdings: { '§': '▪', 'Ø': '➢', 'ü': '✓', q: '❑', v: '❖', n: '■', l: '●' }, symbol: { '·': '•' } };
  const ROMAN = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  const roman = (n) => {
    if (n > 3999) return String(n);
    let s = '';
    for (const [v, r] of ROMAN) while (n >= v) { s += r; n -= v; }
    return s;
  };
  // An auto-number's label: arabic, roman or letters (A–Z, then AA, BB, …) with its period or parentheses.
  const numeral = (scheme, n) => {
    const m = /^(arabic|romanUc|romanLc|alphaUc|alphaLc)(ParenBoth|ParenR|Period|Plain)/.exec(scheme || '');
    const kind = m ? m[1] : 'arabic';
    const v = kind === 'arabic' ? String(n) : kind.startsWith('roman') ? roman(n) : String.fromCharCode(65 + ((n - 1) % 26)).repeat(Math.min(10, Math.floor((n - 1) / 26) + 1));
    const s = kind.endsWith('Lc') ? v.toLowerCase() : v;
    return m && m[2] === 'ParenBoth' ? `(${s})` : m && m[2] === 'ParenR' ? `${s})` : m && m[2] === 'Plain' ? s : `${s}.`;
  };
  const bulletOf = (P, runs, endSize, number, X) => {
    if (!P.bu || P.bu.n === 'buNone') return null;
    const first = runs.find((r) => !r.br);
    const base = first ? first.size : endSize;
    const color = (P.buClr && P.buClr !== 'tx' && colorIn(P.buClr, X.colors)) || (first ? first.color : X.ink);
    let font = P.buFont && P.buFont !== 'tx' ? fontOf(P.buFont, X) : first ? first.font : X.theme.fonts.minor;
    const sz = P.buSz && P.buSz !== 'tx'
      ? P.buSz.n === 'buSzPct' ? base * clamp(num(at(P.buSz, 'val'), 100000) / 100000, 0.25, 4) : clamp(num(at(P.buSz, 'val'), base * 100) / 100, 1, 4000)
      : base;
    let text;
    if (P.bu.n === 'buAutoNum') text = numeral(at(P.bu, 'type'), number);
    else {
      text = [...(at(P.bu, 'char') || '•')].slice(0, 2).join('');
      const code = text.codePointAt(0);
      if (code >= 0xf020 && code <= 0xf0ff) text = String.fromCharCode(code - 0xf000);
      const glyph = own(own(SYMBOLS, font.name.toLowerCase()), text);
      if (glyph) { text = glyph; font = first ? first.font : X.theme.fonts.minor; }
    }
    const out = { text, font, color, size: round(sz, 100) };
    if (P.bu.n === 'buBlip') out.picture = picture(P.bu, X).media;
    return out;
  };
  const spacing = (node, d) => {
    const pct = kid(node, 'spcPct'), pts = kid(node, 'spcPts');
    if (pct) return { pct: round(clamp(num(at(pct, 'val'), 100000) / 100000, 0, 132), 1e4) };
    if (pts) return { pt: round(clamp(num(at(pts, 'val'), 0) / 100, 0, 1584), 100) };
    return d;
  };
  const ALIGN = { l: 'left', ctr: 'center', r: 'right', just: 'justify', justLow: 'justify', dist: 'justify', thaiDist: 'justify' };
  const TABS = { l: 'left', ctr: 'center', r: 'right', dec: 'decimal' };
  // Paragraphs with their levels' merged styles. Auto-numbers count per level: a deeper paragraph keeps the count, a
  // shallower paragraph restarts the deeper ones, and an unnumbered one or a new scheme restarts its own.
  const paragraphsOf = (body, lists, X) => {
    const levels = [], counters = [], out = [];
    for (const p of kids(body, 'p')) {
      if (X.budget.paragraphs >= X.L.paragraphs) { X.count('text'); break; }
      X.budget.paragraphs++;
      const pPr = kid(p, 'pPr');
      const level = clamp(Math.trunc(num(at(pPr, 'lvl'), 0)), 0, 8);
      const base = (levels[level] ||= levelStyle(lists, level));
      const P = { ...base, run: { ...base.run } };
      mergePara(P, pPr);
      const runs = [];
      for (const k of p.kids) {
        if (k.n !== 'r' && k.n !== 'fld' && k.n !== 'br') continue;
        if (X.budget.runs >= X.L.runs) { X.count('text'); break; }
        X.budget.runs++;
        const R = { ...P.run };
        mergeRun(R, kid(k, 'rPr'));
        const run = runOf(k, R, X);
        if (run) runs.push(run);
      }
      const E = { ...P.run };
      mergeRun(E, kid(p, 'endParaRPr'));
      const endSize = ptOf(E.sz), has = runs.some((r) => !r.br && r.text);
      let number = 0;
      if (has) {
        counters.length = Math.min(counters.length, level + 1);
        if (P.bu && P.bu.n === 'buAutoNum') {
          const scheme = at(P.bu, 'type') || 'arabicPeriod', start = clamp(Math.trunc(num(at(P.bu, 'startAt'), 1)), 1, 32767), c = counters[level];
          counters[level] = c && c.scheme === scheme && c.start === start ? { scheme, start, n: c.n + 1 } : { scheme, start, n: start };
          number = counters[level].n;
        } else counters[level] = null;
      }
      out.push({
        level, align: own(ALIGN, P.algn) || 'left', marL: round(clamp(P.marL ?? 0, -MAX, MAX)), indent: round(clamp(P.indent ?? 0, -MAX, MAX)), rtl: flag(P.rtl),
        lineSpacing: spacing(P.lnSpc, { pct: 1 }), spaceBefore: spacing(P.spcBef, { pt: 0 }), spaceAfter: spacing(P.spcAft, { pt: 0 }),
        bullet: has ? bulletOf(P, runs, endSize, number, X) : null, runs, endSize,
        tabs: tabsOf(P.tabs),
        defTab: round(clamp(P.defTabSz ?? 914400, 0, MAX)),
      });
    }
    return out;
  };
  // A tab list's stops, read once however many paragraphs inherit it.
  const tabStops = new WeakMap();
  const tabsOf = (node) => {
    if (!node) return [];
    if (!tabStops.has(node)) tabStops.set(node, kids(node, 'tab').slice(0, 32).map((t) => ({ pos: round(length(at(t, 'pos'))), align: own(TABS, at(t, 'algn')) || 'left' })));
    return tabStops.get(node);
  };
  const ANCHORS = new Set(['t', 'ctr', 'b', 'just', 'dist']);
  const VERTS = new Set(['horz', 'vert', 'vert270', 'wordArtVert', 'eaVert', 'mongolianVert', 'wordArtVertRtl']);
  const FITS = { noAutofit: 'none', normAutofit: 'normal', spAutoFit: 'shape' };
  // A text body: its bodyPr merged attribute by attribute (master → layout → shape), the autofit PowerPoint stored (the
  // scales it fitted the text with), and the paragraphs.
  const bodyOf = (bodyPrs, body, lists, X) => {
    const B = {};
    let fit = null;
    for (const b of bodyPrs) {
      if (!b) continue;
      const m = attrs(b);
      for (const k of ['lIns', 'tIns', 'rIns', 'bIns', 'rot', 'numCol', 'spcCol']) if (Number.isFinite(num(m[k], NaN))) B[k] = num(m[k]);
      for (const k of ['anchor', 'anchorCtr', 'wrap', 'vert', 'upright']) if (m[k] != null) B[k] = m[k];
      fit = b.kids.find((k) => Object.hasOwn(FITS, k.n)) || fit;
    }
    const inset = (v, d) => round(clamp(v ?? d, 0, MAX));
    const normal = fit && fit.n === 'normAutofit';
    return {
      insets: { l: inset(B.lIns, 91440), t: inset(B.tIns, 45720), r: inset(B.rIns, 91440), b: inset(B.bIns, 45720) },
      anchor: ANCHORS.has(B.anchor) ? B.anchor : 't', anchorCtr: flag(B.anchorCtr), wrap: B.wrap !== 'none', vert: VERTS.has(B.vert) ? B.vert : 'horz',
      rotation: angle(B.rot), upright: flag(B.upright), columns: clamp(Math.trunc(B.numCol ?? 1), 1, 16), columnGap: round(clamp(B.spcCol ?? 0, 0, MAX)),
      autofit: {
        type: fit ? FITS[fit.n] : 'none', fontScale: normal ? round(clamp(num(at(fit, 'fontScale'), 100000) / 100000, 0.01, 1), 1e4) : 1,
        lineReduction: normal ? round(clamp(num(at(fit, 'lnSpcReduction'), 0) / 100000, 0, 0.9), 1e4) : 0,
      },
      paragraphs: body ? paragraphsOf(body, lists, X) : [],
    };
  };
  const plain = (body) => (body ? body.paragraphs.map((p) => p.runs.map((r) => r.text).join('')).join(' ').replace(/\s+/g, ' ').trim() : '');

  // ---- geometry ---------------------------------------------------------------------------------------------------
  // lib/pptx-geom.js's input, straight from the XML (EMUs, angles in 60000ths of a degree): a preset as { prst, avLst:
  // { adj: 16667 } }, custom geometry as { avLst, gdLst: [{ name, fmla }], cxnLst: [{ ang, x, y }], rect: { l, t, r, b },
  // pathLst: [{ w, h, fill, stroke, cmds: [{ cmd, pts: [{ x, y }] } | { cmd: 'arcTo', wR, hR, stAng, swAng } |
  // { cmd: 'close' }] }] }, its values as written (a number or a guide name).
  const PATH_FILLS = new Set(['none', 'norm', 'lighten', 'lightenLess', 'darken', 'darkenLess']);
  // Custom geometry's guides and commands count against the deck's budgets (X.budget): past them a shape keeps what fit.
  const guides = (list, X, spaces) => {
    const n = Math.max(0, Math.min(1000, X.L.guides - X.budget.guides, Math.floor((X.L.guideWork - X.budget.guideWork) / spaces))), all = kids(list, 'gd');
    if (all.length > n) X.count('shapes');
    const kept = Math.min(all.length, n);
    X.budget.guides += kept;
    X.budget.guideWork += kept * spaces;
    return all.slice(0, n).map((g) => ({ name: (at(g, 'name') || '').slice(0, 64), fmla: (at(g, 'fmla') || '').slice(0, 256) }));
  };
  const geometryOf = (g, X) => {
    if (g && g.n === 'custGeom') {
      const rect = kid(g, 'rect');
      const room = Math.max(0, Math.min(10000, X.L.commands - X.budget.commands));
      let budget = room;
      const pathLst = kids(kid(g, 'pathLst'), 'path').slice(0, 256).map((p) => {
        const cmds = [];
        for (const c of p.kids) {
          if (budget <= 0) break;
          if (c.n === 'moveTo' || c.n === 'lnTo' || c.n === 'cubicBezTo' || c.n === 'quadBezTo') cmds.push({ cmd: c.n, pts: kids(c, 'pt').slice(0, 3).map((q) => ({ x: at(q, 'x') ?? '0', y: at(q, 'y') ?? '0' })) });
          else if (c.n === 'arcTo') cmds.push({ cmd: 'arcTo', wR: at(c, 'wR') ?? '0', hR: at(c, 'hR') ?? '0', stAng: at(c, 'stAng') ?? '0', swAng: at(c, 'swAng') ?? '0' });
          else if (c.n === 'close') cmds.push({ cmd: 'close' });
          else continue;
          budget--;
        }
        return { w: round(length(at(p, 'w'))), h: round(length(at(p, 'h'))), fill: PATH_FILLS.has(at(p, 'fill')) ? at(p, 'fill') : 'norm', stroke: flag(at(p, 'stroke'), true), cmds };
      });
      X.budget.commands += room - budget;
      if (!budget && X.budget.commands >= X.L.commands) X.count('shapes');
      // The renderer evaluates every guide again for each distinct path size, as well as the shape's own size.
      // Count the default space once; a fixed path size equal to the shape's may conservatively count twice.
      const spaces = new Set(['0,0', ...pathLst.map((p) => `${p.w},${p.h}`)]).size;
      const cxnLst = kids(kid(g, 'cxnLst'), 'cxn').slice(0, 256).map((c) => ({ ang: at(c, 'ang') ?? '0', x: at(kid(c, 'pos'), 'x') ?? '0', y: at(kid(c, 'pos'), 'y') ?? '0' }));
      return {
        avLst: guides(kid(g, 'avLst'), X, spaces), gdLst: guides(kid(g, 'gdLst'), X, spaces), cxnLst,
        rect: { l: at(rect, 'l') ?? 'l', t: at(rect, 't') ?? 't', r: at(rect, 'r') ?? 'r', b: at(rect, 'b') ?? 'b' }, pathLst,
      };
    }
    const avLst = {};
    for (const gd of kids(kid(g, 'avLst'), 'gd')) {
      const v = /^val\s+(-?\d+(?:\.\d+)?)$/.exec(at(gd, 'fmla') || ''), name = at(gd, 'name') || '';
      if (v && Number.isFinite(Number(v[1])) && /^[A-Za-z][A-Za-z0-9]{0,31}$/.test(name)) avLst[name] = Number(v[1]);
    }
    const prst = at(g, 'prst');
    return { prst: /^[A-Za-z0-9]{1,40}$/.test(prst || '') ? prst : 'rect', avLst };
  };

  // ---- shapes -----------------------------------------------------------------------------------------------------
  // Every shape: { type, id, name, bounds: { x, y, w, h }, rotation, flipH, flipV }, and from ('master', 'layout' or
  // 'slide') at the slide's top level. Bounds are on the slide: a group's scale and offset are applied to its shapes, and
  // its rotation and flips turn them about its own centre. type 'shape' has geometry, fill, line and text; 'picture' media,
  // crop, alpha, geometry, line and alt; 'table' cols and rows of cells; 'group' shapes; 'box' a kind ('chart', 'smartart',
  // 'ole', 'picture', 'media', 'table', 'broken', 'other') and a title, for what can't be drawn. placeholder, cut (what
  // was dropped from it) and fallback (what a stored fallback stands for) appear where they apply.
  const SHAPES = new Set(['sp', 'cxnSp', 'pic', 'grpSp', 'graphicFrame', 'contentPart']);
  const BOXES = { chart: 'charts', smartart: 'smartart', ole: 'ole', table: 'tables', other: 'other' };
  const BASE = { title: 'title', ctrTitle: 'title', dt: 'dt', ftr: 'ftr', sldNum: 'sldNum', hdr: 'hdr', sldImg: 'sldImg' };
  const baseType = (t) => own(BASE, t) || 'body';
  const phOf = (node) => {
    const ph = kid(nvOf(node), 'nvPr', 'ph');
    return ph ? { type: at(ph, 'type') || 'obj', idx: num(at(ph, 'idx'), 0) } : null;
  };
  const phsOf = (tree) => (kid(tree, 'cSld', 'spTree')?.kids || []).filter((n) => SHAPES.has(n.n)).map((node) => ({ node, ph: phOf(node) })).filter((x) => x.ph);
  // By idx among placeholders of the same kind (title, body, date, …), then by type: LibreOffice writes its title and
  // its body both with idx omitted (0), as <p:ph type="title"/> and <p:ph/>.
  const findPh = (list, ph, byIdx) => (byIdx && list.find((x) => x.ph.idx === ph.idx && baseType(x.ph.type) === baseType(ph.type)))
    || list.find((x) => x.ph.type === ph.type) || list.find((x) => baseType(x.ph.type) === baseType(ph.type)) || null;
  const styleKind = (t) => (t === 'title' || t === 'ctrTitle' ? 'titleStyle' : t === 'dt' || t === 'ftr' || t === 'sldNum' || t === 'hdr' ? 'otherStyle' : 'bodyStyle');
  // What a slide's shape inherits from: the layout's placeholder of its idx (else of its type), and the master's of that
  // one's type. list runs master → layout → shape, each with its part's relationships.
  const chainOf = (node, X) => {
    const self = { node, rels: X.rels };
    const ph = X.level === 'slide' && X.depth === 0 ? phOf(node) : null;
    if (!ph) {
      const textBox = flag(at(kid(nvOf(node), 'cNvSpPr'), 'txBox'));
      return { ph: null, kind: textBox ? null : 'otherStyle', list: [self] };
    }
    const lay = X.layout && findPh(X.layout.phs, ph, true);
    const mas = X.master && findPh(X.master.phs, lay ? lay.ph : ph, false);
    return { ph, kind: styleKind((mas || lay || { ph }).ph.type), list: [mas && { node: mas.node, rels: X.master.rels }, lay && { node: lay.node, rels: X.layout.rels }, self].filter(Boolean) };
  };
  const frameOf = (node, xfrm, X) => {
    const c = kid(nvOf(node), 'cNvPr'), id = num(at(c, 'id'), NaN), off = kid(xfrm, 'off'), ext = kid(xfrm, 'ext');
    const b = X.map(coord(at(off, 'x')), coord(at(off, 'y')), length(at(ext, 'cx')), length(at(ext, 'cy')));
    return {
      id: Number.isInteger(id) ? id : null, name: (at(c, 'name') || '').slice(0, 256), bounds: { x: round(coord(b.x)), y: round(coord(b.y)), w: round(length(b.w)), h: round(length(b.h)) },
      rotation: angle(at(xfrm, 'rot')), flipH: flag(at(xfrm, 'flipH')), flipV: flag(at(xfrm, 'flipV')),
    };
  };
  const finish = (s, node, C, cut, X) => {
    if (C && C.ph) s.placeholder = C.ph.type;
    if (cut.length) { s.cut = [...new Set(cut)]; for (const c of s.cut) X.count(c); }
    if (node.alt) s.fallback = node.alt;
    return s;
  };
  // why: the deck.cut count it adds to (the kind's own by default).
  const box = (frame, kind, title, node, C, X, why = BOXES[kind] || kind) => {
    X.count(why);
    return finish({ type: 'box', ...frame, kind, title: (title || '').slice(0, 500) }, node, C, [], X);
  };
  const textLists = (C, style, X) => {
    const lists = [{ list: X.defaults }, { list: kid(X.master?.styles, C.kind) }];
    const ref = kid(style, 'fontRef');
    if (ref) lists.push({ run: fontLayer(ref) });
    for (const e of C.list) lists.push({ list: kid(e.node, 'txBody', 'lstStyle') });
    return lists;
  };
  const parts = (C, name) => C.list.map((e) => kid(e.node, name));
  const xfrmOf = (spPrs) => lastOf(spPrs.map((p) => kid(p, 'xfrm')).filter((x) => x && (kid(x, 'off') || kid(x, 'ext'))));
  const geomOf = (spPrs) => lastOf(spPrs.map((p) => p && p.kids.find((k) => k.n === 'prstGeom' || k.n === 'custGeom')).filter(Boolean));
  const outline = (spPrs, style, X) => lineOf([styleLine(kid(style, 'lnRef'), X), ...spPrs.map((p) => [kid(p, 'ln'), X.colors])]);

  const sp = (node, C, X) => {
    const spPrs = parts(C, 'spPr'), style = lastOf(parts(C, 'style').filter(Boolean)), txBody = kid(node, 'txBody');
    let fill = flag(at(node, 'useBgFill')) ? X.background : undefined;
    for (let i = C.list.length - 1; fill === undefined && i >= 0; i--) fill = fillOf(spPrs[i], { ...X, rels: C.list[i].rels });
    if (fill === undefined) fill = styleFill(kid(style, 'fillRef'), X) ?? null;
    const text = txBody ? bodyOf(C.list.map((e) => kid(e.node, 'txBody', 'bodyPr')), txBody, textLists(C, style, X), X) : null;
    const s = { type: 'shape', ...frameOf(node, xfrmOf(spPrs), X), geometry: geometryOf(geomOf(spPrs), X), fill, line: outline(spPrs, style, X), text };
    return finish(s, node, C, cutOf(spPrs, style, txBody, X), X);
  };

  const MEDIA = ['videoFile', 'audioFile', 'quickTimeFile', 'audioCd', 'wavAudioFile'];
  const pic = (node, C, X) => {
    const spPrs = parts(C, 'spPr'), style = lastOf(parts(C, 'style').filter(Boolean));
    const nvPr = kid(nvOf(node), 'nvPr'), alt = (at(kid(nvOf(node), 'cNvPr'), 'descr') || '').slice(0, 2000);
    const media = MEDIA.some((n) => kid(nvPr, n)) || kids(kid(nvPr, 'extLst'), 'ext').some((e) => kid(e, 'media'));
    const frame = frameOf(node, xfrmOf(spPrs), X), p = picture(kid(node, 'blipFill'), X);
    if (!p.media) return media ? box(frame, 'media', alt, node, C, X) : box(frame, 'picture', alt, node, C, X, p.why);
    const cut = cutOf(spPrs, style, null, X);
    if (p.effects) cut.unshift('effects');
    if (media) cut.push('media');
    const s = { type: 'picture', ...frame, media: p.media, crop: p.crop, alpha: p.alpha, geometry: geometryOf(geomOf(spPrs), X), line: outline(spPrs, style, X), alt };
    return finish(s, node, C, cut, X);
  };

  const group = (node, X) => {
    if (X.depth >= X.L.depth) { X.count('shapes'); return null; }
    const pr = kid(node, 'grpSpPr'), x = kid(pr, 'xfrm');
    const pt = (k) => ({ x: coord(at(kid(x, k), 'x')), y: coord(at(kid(x, k), 'y')) });
    const size = (k) => ({ w: length(at(kid(x, k), 'cx')), h: length(at(kid(x, k), 'cy')) });
    const off = pt('off'), ext = size('ext'), chOff = pt('chOff'), chExt = size('chExt');
    const sx = chExt.w ? ext.w / chExt.w : 1, sy = chExt.h ? ext.h / chExt.h : 1, parent = X.map;
    const map = (cx, cy, cw, ch) => parent(off.x + (cx - chOff.x) * sx, off.y + (cy - chOff.y) * sy, cw * sx, ch * sy);
    const fill = fillOf(pr, X);
    const inner = { ...X, map, depth: X.depth + 1, groupFill: fill === undefined ? X.groupFill : fill };
    return finish({ type: 'group', ...frameOf(node, x, X), shapes: shapesIn(node, inner) }, node, null, cutOf([pr], null, null, X), X);
  };

  // A graphic frame: a table, else a titled box for a chart (its title from the chart part), SmartArt or an OLE object,
  // unless the OLE object stored a picture of itself the viewer can draw.
  const frame = (node, X) => {
    const C = chainOf(node, X);
    const xfrm = lastOf(C.list.map((e) => kid(e.node, 'xfrm')).filter(Boolean));
    const f = frameOf(node, xfrm, X), alt = at(kid(nvOf(node), 'cNvPr'), 'descr') || '';
    const data = kid(node, 'graphic', 'graphicData'), uri = at(data, 'uri') || '';
    if (uri.endsWith('/table')) return table(kid(data, 'tbl'), f, node, C, X);
    if (uri.endsWith('/chart')) return box(f, 'chart', X.charts.get(ref(kid(data, 'chart'), 'id')) || alt, node, C, X);
    if (uri.includes('chartex')) return box(f, 'chart', alt, node, C, X);
    if (uri.endsWith('/diagram')) return box(f, 'smartart', alt, node, C, X);
    if (uri.endsWith('/ole')) {
      const p = kid(data, 'oleObj', 'pic'), img = p && picture(kid(p, 'blipFill'), X);
      if (img && img.media) return finish({ type: 'picture', ...f, media: img.media, crop: img.crop, alpha: img.alpha, geometry: geometryOf(null, X), line: null, alt, fallback: 'ole' }, node, C, [], X);
      return box(f, 'ole', alt, node, C, X);
    }
    return box(f, 'other', alt, node, C, X);
  };

  // ---- tables -----------------------------------------------------------------------------------------------------
  // A table style's parts, most general first (wholeTbl, column then row bands, first and last columns, first and last
  // rows, corners), each with the cells it spans: a part's left, right, top and bottom borders are its region's outer
  // edges, insideV and insideH the edges within.
  const regionsOf = (style, F, r, c, nr, nc) => {
    const out = [];
    if (!style) return out;
    const all = { r0: 0, r1: nr - 1, c0: 0, c1: nc - 1 };
    const add = (name, region) => { const n = kid(style, name); if (n) out.push({ node: n, region: { ...all, ...region } }); };
    const br = r - (F.firstRow ? 1 : 0), bc = c - (F.firstCol ? 1 : 0);
    add('wholeTbl', {});
    if (F.bandCol && bc >= 0 && !(F.lastCol && c === nc - 1)) add(bc % 2 ? 'band2V' : 'band1V', { c0: c, c1: c });
    if (F.bandRow && br >= 0 && !(F.lastRow && r === nr - 1)) add(br % 2 ? 'band2H' : 'band1H', { r0: r, r1: r });
    if (F.firstCol && c === 0) add('firstCol', { c1: 0 });
    if (F.lastCol && c === nc - 1) add('lastCol', { c0: nc - 1 });
    if (F.firstRow && r === 0) add('firstRow', { r1: 0 });
    if (F.lastRow && r === nr - 1) add('lastRow', { r0: nr - 1 });
    const cell = { r0: r, r1: r, c0: c, c1: c };
    if (F.firstRow && F.lastCol && r === 0 && c === nc - 1) add('neCell', cell);
    if (F.firstRow && F.firstCol && r === 0 && c === 0) add('nwCell', cell);
    if (F.lastRow && F.lastCol && r === nr - 1 && c === nc - 1) add('seCell', cell);
    if (F.lastRow && F.firstCol && r === nr - 1 && c === 0) add('swCell', cell);
    return out;
  };
  const EDGES = [['l', 'lnL', 'left', 'insideV'], ['r', 'lnR', 'right', 'insideV'], ['t', 'lnT', 'top', 'insideH'], ['b', 'lnB', 'bottom', 'insideH']];
  const outer = (side, r, c, rows, cols, g) => (side === 'l' ? c === g.c0 : side === 'r' ? c + cols - 1 >= g.c1 : side === 't' ? r === g.r0 : r + rows - 1 >= g.r1);
  const cellOf = (tc, r, c, T, X) => {
    const tcPr = kid(tc, 'tcPr'), m = tcPr ? attrs(tcPr) : {};
    const colSpan = clamp(Math.trunc(num(at(tc, 'gridSpan'), 1)), 1, T.nc), rowSpan = clamp(Math.trunc(num(at(tc, 'rowSpan'), 1)), 1, T.nr);
    const regions = regionsOf(T.style, T.flags, r, c, T.nr, T.nc);
    let fill;
    for (const { node } of regions) {
      const st = kid(node, 'tcStyle');
      let f = fillOf(kid(st, 'fill'), X);
      if (f === undefined && kid(st, 'fillRef')) f = styleFill(kid(st, 'fillRef'), X);
      if (f !== undefined) fill = f;
    }
    const mine = fillOf(tcPr, X);
    if (mine !== undefined) fill = mine;
    const borders = {};
    for (const [side, ownEdge, out, inside] of EDGES) {
      let line = [null];
      for (const { node, region } of regions) {
        const e = kid(node, 'tcStyle', 'tcBdr', outer(side, r, c, rowSpan, colSpan, region) ? out : inside);
        if (kid(e, 'ln')) line = [kid(e, 'ln'), X.colors];
        else if (kid(e, 'lnRef')) line = styleLine(kid(e, 'lnRef'), X);
      }
      borders[side] = lineOf([line, [kid(tcPr, ownEdge), X.colors]]);
    }
    const tx = regions.map(({ node }) => kid(node, 'tcTxStyle')).filter(Boolean)
      .map((t) => ({ run: { ...fontLayer(kid(t, 'fontRef'), colorNode(t), at(t, 'b'), at(t, 'i')), ...(kid(t, 'font', 'latin') && { latin: kid(t, 'font', 'latin') }) } }));
    const lists = [{ list: X.defaults }, { list: kid(X.master?.styles, 'otherStyle') }, ...tx, { list: kid(tc, 'txBody', 'lstStyle') }];
    const bodyPr = make('bodyPr', { lIns: m.marL ?? '91440', rIns: m.marR ?? '91440', tIns: m.marT ?? '45720', bIns: m.marB ?? '45720', anchor: m.anchor, vert: m.vert, anchorCtr: m.anchorCtr });
    return { colSpan, rowSpan, merged: flag(at(tc, 'hMerge')) || flag(at(tc, 'vMerge')), fill: fill ?? null, borders, text: bodyOf([bodyPr], kid(tc, 'txBody'), lists, X) };
  };
  const table = (tbl, f, node, C, X) => {
    const trs = kids(tbl, 'tr');
    const cells = trs.reduce((n, tr) => n + kids(tr, 'tc').length, 0);
    if (!tbl || cells > X.L.cells || X.budget.cells + cells > X.L.allCells) return box(f, 'table', '', node, C, X);
    X.budget.cells += cells;
    const pr = kid(tbl, 'tblPr'), on = (k) => flag(at(pr, k));
    const flags = { firstRow: on('firstRow'), lastRow: on('lastRow'), firstCol: on('firstCol'), lastCol: on('lastCol'), bandRow: on('bandRow'), bandCol: on('bandCol') };
    const cols = kids(kid(tbl, 'tblGrid'), 'gridCol').map((g) => round(length(at(g, 'w'))));
    const T = { flags, style: kid(pr, 'tableStyle') || X.tableStyle(kid(pr, 'tableStyleId')?.text), nr: trs.length, nc: Math.max(cols.length, ...trs.map((tr) => kids(tr, 'tc').length), 1) };
    const rows = trs.map((tr, r) => ({ h: round(length(at(tr, 'h'))), cells: kids(tr, 'tc').map((tc, c) => cellOf(tc, r, c, T, X)) }));
    return finish({ type: 'table', ...f, cols, rows }, node, C, [], X);
  };
  // PowerPoint keeps its built-in table styles to itself (a deck's tableStyles.xml lists only its own), so the ones decks
  // use most are here: No Style, No Grid and No Style, Table Grid as PowerPoint's own list has them, and the Medium Style 2
  // family (the default, Accent 1, among them) by their ids in PowerPoint's table. Any other style id draws as Table Grid.
  const GRID = '{5940675A-B579-460E-94D1-54222C63F5DA}';
  const tcTx = (c, b = '') => `<tcTxStyle${b}><fontRef idx="minor"><prstClr val="black"/></fontRef><schemeClr val="${c}"/></tcTxStyle>`;
  const tcBdr = (ln) => `<tcBdr>${['left', 'right', 'top', 'bottom', 'insideH', 'insideV'].map((e) => `<${e}>${ln}</${e}>`).join('')}</tcBdr>`;
  const solid = (c, tint) => `<fill><solidFill><schemeClr val="${c}">${tint ? `<tint val="${tint}"/>` : ''}</schemeClr></solidFill></fill>`;
  const plainStyle = (ln) => `<tblStyle><wholeTbl>${tcTx('tx1')}<tcStyle>${tcBdr(ln)}<fill><noFill/></fill></tcStyle></wholeTbl></tblStyle>`;
  const medium2 = (c) => {
    const white = (w) => `<ln w="${w}" cmpd="sng"><solidFill><schemeClr val="lt1"/></solidFill></ln>`, head = `${tcTx('lt1', ' b="on"')}<tcStyle><tcBdr/>${solid(c)}</tcStyle>`;
    return `<tblStyle><wholeTbl>${tcTx('dk1')}<tcStyle>${tcBdr(white(12700))}${solid(c, 20000)}</tcStyle></wholeTbl><band1H><tcStyle><tcBdr/>${solid(c, 40000)}</tcStyle></band1H>`
      + `<band2H><tcStyle><tcBdr/></tcStyle></band2H><band1V><tcStyle><tcBdr/>${solid(c, 40000)}</tcStyle></band1V><band2V><tcStyle><tcBdr/></tcStyle></band2V><lastCol>${head}</lastCol><firstCol>${head}</firstCol>`
      + `<lastRow>${tcTx('lt1', ' b="on"')}<tcStyle><tcBdr><top>${white(38100)}</top></tcBdr>${solid(c)}</tcStyle></lastRow><firstRow>${tcTx('lt1', ' b="on"')}<tcStyle><tcBdr><bottom>${white(38100)}</bottom></tcBdr>${solid(c)}</tcStyle></firstRow></tblStyle>`;
  };
  const BUILT_IN = {
    '{2D5ABB26-0587-4C30-8999-92F81FD0307C}': () => plainStyle('<ln><noFill/></ln>'),
    [GRID]: () => plainStyle('<ln w="12700" cmpd="sng"><solidFill><schemeClr val="tx1"/></solidFill></ln>'),
    '{073A0DAA-6AF3-43AB-8588-CEC1D06C72B9}': () => medium2('dk1'),
    '{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}': () => medium2('accent1'),
    '{21E4AEA4-8DFA-4A89-87EB-49C32662AFE0}': () => medium2('accent2'),
    '{F5AB1C69-6EDB-4FF4-983F-18BD219EF322}': () => medium2('accent3'),
    '{00A15C55-8517-42AA-B614-E9B94910E393}': () => medium2('accent4'),
    '{7DF18680-E054-41AD-8BC1-D1AEF772440D}': () => medium2('accent5'),
    '{93296810-A885-4BE3-A3E7-6D5BEEA58F35}': () => medium2('accent6'),
  };
  const builtIn = new Map();
  const builtInStyle = (id) => {
    if (!Object.hasOwn(BUILT_IN, id)) return null;
    if (!builtIn.has(id)) builtIn.set(id, parse(BUILT_IN[id]()));
    return builtIn.get(id);
  };

  // ---- slides -----------------------------------------------------------------------------------------------------
  const IDENTITY = (x, y, w, h) => ({ x, y, w, h });
  // The shapes of a shape tree, each converted on its own: one that throws comes back as a broken box where its bounds
  // can be read. Master and layout placeholders are only templates; hidden shapes aren't drawn.
  const shapesIn = (container, X) => {
    const out = [];
    for (const node of container ? container.kids : []) {
      if (!SHAPES.has(node.n) || (X.level !== 'slide' && X.depth === 0 && phOf(node))) continue;
      if (flag(at(kid(nvOf(node), 'cNvPr'), 'hidden'))) continue;
      if (X.budget.shapes >= X.L.shapes) { X.count('shapes'); continue; }
      X.budget.shapes++;
      let s = null;
      try {
        s = shapeOf(node, X);
      } catch {
        try { s = box(frameOf(node, kid(node, 'spPr', 'xfrm') || kid(node, 'xfrm'), X), 'broken', '', node, null, X); } catch { X.count('broken'); }
      }
      if (s) out.push(s);
      else X.budget.shapes--;
    }
    return out;
  };
  const shapeOf = (node, X) => {
    if (node.n === 'grpSp') return group(node, X);
    if (node.n === 'graphicFrame') return frame(node, X);
    if (node.n === 'contentPart') { X.count('ink'); return null; }
    return node.n === 'pic' ? pic(node, chainOf(node, X), X) : sp(node, chainOf(node, X), X);
  };
  const backgroundOf = (bg, X) => {
    const pr = kid(bg, 'bgPr');
    if (pr) return fillOf(pr, X) ?? null;
    return styleFill(kid(bg, 'bgRef'), X) ?? null;
  };
  const notesOf = (tree, X) => {
    const lines = [];
    for (const node of kid(tree, 'cSld', 'spTree')?.kids || []) {
      if (node.n !== 'sp' || phOf(node)?.type !== 'body') continue;
      for (const p of kids(kid(node, 'txBody'), 'p')) {
        lines.push(p.kids.map((k) => (k.n === 'br' ? '\n' : k.n === 'fld' && at(k, 'type') === 'slidenum' ? String(X.number) : k.n === 'r' || k.n === 'fld' ? kid(k, 't')?.text ?? '' : '')).join(''));
      }
    }
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    return X.take(lines.join('\n')) ?? '';
  };
  const chartTitle = (tree) => kids(kid(tree, 'chart', 'title', 'tx', 'rich'), 'p').map((p) => kids(p, 'r').map((r) => kid(r, 't')?.text ?? '').join('')).join(' ').replace(/\s+/g, ' ').trim();

  // The deck: { size, notesSize, theme: { name, colors, fonts: { major, minor } }, slides, hiddenSkipped (hidden slides,
  // which Present skips), media: [{ path, mime }] (every picture the slides draw), cut: { what: how many } }. A slide is
  // { id, number, hidden, title, background, shapes, notes }, with missing or broken when its part is gone or unreadable.
  const read = async (bytes, opts = {}) => {
    const L = { ...LIMITS, ...opts.limits }, T = D();
    const z = T.unzip(bytes, { limits: { ...opts.limits, duplicates: true } });
    const names = new Set(z.names), cut = {}, budget = { shapes: 0, text: 0, paragraphs: 0, runs: 0, cells: 0, guides: 0, guideWork: 0, commands: 0 }, media = new Map();
    const count = (k, n = 1) => { cut[k] = (cut[k] || 0) + n; };
    const take = (s) => {
      if (budget.text + s.length <= L.text) { budget.text += s.length; return s; }
      count('text');
      const left = Math.max(0, L.text - budget.text);
      budget.text += left;
      return left ? s.slice(0, left) : null;
    };
    const boundedText = async (path) => {
      const bytes = await z.bytes(path);
      if (bytes && bytes.length > L.part) throw new RangeError('document too large');
      return z.text(path);
    };
    const relsOf = (path) => T.rels({ text: boundedText }, path, { withinPackage: true }).catch(() => new Map());
    const typed = (rels, type) => [...rels.values()].find((r) => r.type === type)?.path;
    const kept = new Map();
    const load = (path) => (path ? boundedText(path).then((s) => (s == null ? null : parse(s, L.nodes))).catch(() => null) : Promise.resolve(null));
    const xml = (path, keep) => {
      if (!keep) return load(path);
      if (!kept.has(path)) kept.set(path, load(path));
      return kept.get(path);
    };

    const main = typed(await relsOf(''), 'officeDocument') || 'ppt/presentation.xml';
    const src = await boundedText(main);
    const pres = src == null ? null : parse(src, L.nodes, () => count('parts'));
    if (!pres || pres.n !== 'presentation') throw new Error('not a PowerPoint presentation');
    const prels = await relsOf(main);
    const sizeOf = (node, w, h) => ({ w: round(clamp(num(at(node, 'cx'), w), 914400, 51206400)), h: round(clamp(num(at(node, 'cy'), h), 914400, 51206400)) });
    const first = clamp(Math.trunc(num(at(pres, 'firstSlideNum'), 1)), 0, 9999);
    const fonts = kids(kid(pres, 'embeddedFontLst'), 'embeddedFont').length;
    if (fonts) count('fonts', fonts);
    const defaults = kid(pres, 'defaultTextStyle');
    const styles = await xml(typed(prels, 'tableStyles'), true);
    const deckStyles = new Map(kids(styles, 'tblStyle').map((s) => [(at(s, 'styleId') || '').trim().toUpperCase(), s]));
    const tableStyle = (id) => {
      const key = (id || at(styles, 'def') || '').trim().toUpperCase();
      if (!key) return null;
      const style = deckStyles.get(key) || builtInStyle(key);
      if (style) return style;
      count('tableStyles');
      return builtInStyle(GRID);
    };

    const masters = new Map(), layouts = new Map();
    const masterOf = (path) => {
      if (!masters.has(path)) {
        masters.set(path, (async () => {
          const tree = await xml(path, true);
          if (!tree || tree.n !== 'sldMaster') { count('parts'); return null; }
          const rels = await relsOf(path), theme = await xml(typed(rels, 'theme'), true);
          if (!theme) count('parts');
          return { tree, rels, theme: theme ? themeOf(theme) : DEFAULT_THEME, map: mapOf(kid(tree, 'clrMap'), MAP), phs: phsOf(tree), styles: kid(tree, 'txStyles') };
        })());
      }
      return masters.get(path);
    };
    const layoutOf = (path) => {
      if (!layouts.has(path)) {
        layouts.set(path, (async () => {
          const tree = await xml(path, true);
          if (!tree || tree.n !== 'sldLayout') { count('parts'); return null; }
          const rels = await relsOf(path);
          return { tree, rels, master: await masterOf(typed(rels, 'slideMaster')), phs: phsOf(tree) };
        })());
      }
      return layouts.get(path);
    };
    const chartTitles = new Map();
    const chartsOf = async (rels) => {
      const out = new Map();
      for (const [id, r] of rels) if (r.type === 'chart') {
        if (!chartTitles.has(r.path)) { const t = await xml(r.path); chartTitles.set(r.path, t ? chartTitle(t).slice(0, 500) : ''); }
        out.set(id, chartTitles.get(r.path));
      }
      return out;
    };

    const ids = kids(kid(pres, 'sldIdLst'), 'sldId');
    if (ids.length > L.slides) count('slides', ids.length - L.slides);
    const slides = [], seen = new Set();
    for (const sid of ids.slice(0, L.slides)) {
      const path = prels.get(ref(sid, 'id'))?.path;
      if (path && seen.has(path)) continue; // a slide listed twice is drawn once
      if (path) seen.add(path);
      const slide = { id: Math.trunc(num(at(sid, 'id'), 0)), number: first + slides.length, hidden: false, title: '', background: null, shapes: [], notes: '' };
      slides.push(slide);
      const tree = await xml(path);
      if (!tree || tree.n !== 'sld') { slide[path && names.has(path) ? 'broken' : 'missing'] = true; count('parts'); continue; }
      const rels = await relsOf(path), layout = await layoutOf(typed(rels, 'slideLayout')), master = layout?.master || null, theme = master?.theme || DEFAULT_THEME;
      // A slide's <a:masterClrMapping/> (PowerPoint writes it on every slide) keeps what its layout maps: Office's own themes
      // darken a Section Header layout by overriding the map there, for the slides made from it.
      const layoutMap = mapOf(kid(layout?.tree, 'clrMapOvr', 'overrideClrMapping'), master?.map || MAP);
      const map = mapOf(kid(tree, 'clrMapOvr', 'overrideClrMapping'), layoutMap);
      const colors = { scheme: theme.scheme, map, ph: null };
      const S = {
        L, count, take, budget, media, names, number: slide.number, theme, colors, ink: schemeHex('tx1', colors), defaults, master, layout, tableStyle,
        rels, level: 'slide', charts: new Map(), map: IDENTITY, depth: 0, groupFill: undefined, background: null,
      };
      slide.hidden = !flag(at(tree, 'show'), true);
      if (kid(tree, 'timing') || kid(tree, 'transition')) count('animations');
      const from = [[tree, rels], [layout?.tree, layout?.rels], [master?.tree, master?.rels]].find(([t]) => kid(t, 'cSld', 'bg'));
      if (from) slide.background = backgroundOf(kid(from[0], 'cSld', 'bg'), { ...S, rels: from[1] });
      S.background = slide.background;
      const add = async (part, level, partRels) => {
        const X = { ...S, rels: partRels, level, charts: await chartsOf(partRels) };
        for (const s of shapesIn(kid(part, 'cSld', 'spTree'), X)) { s.from = level; slide.shapes.push(s); }
      };
      const showMaster = flag(at(tree, 'showMasterSp'), true);
      if (master && showMaster && flag(at(layout.tree, 'showMasterSp'), true)) await add(master.tree, 'master', master.rels);
      if (layout && showMaster) await add(layout.tree, 'layout', layout.rels);
      await add(tree, 'slide', rels);
      const title = slide.shapes.find((s) => s.from === 'slide' && (s.placeholder === 'title' || s.placeholder === 'ctrTitle') && s.text);
      slide.title = title ? plain(title.text) : '';
      const notes = await xml(typed(rels, 'notesSlide'));
      if (notes) slide.notes = notesOf(notes, S);
    }

    const firstMaster = await masterOf(prels.get(ref(kid(kid(pres, 'sldMasterIdLst'), 'sldMasterId'), 'id'))?.path);
    const theme = firstMaster?.theme || DEFAULT_THEME;
    return {
      size: sizeOf(kid(pres, 'sldSz'), 9144000, 6858000), notesSize: sizeOf(kid(pres, 'notesSz'), 6858000, 9144000),
      theme: { name: theme.name, colors: Object.fromEntries(SCHEME.map((k) => [k, `#${theme.scheme[k].toLowerCase()}`])), fonts: theme.fonts },
      slides, hiddenSkipped: slides.filter((s) => s.hidden).length, media: [...media].sort(([a], [b]) => (a < b ? -1 : 1)).map(([path, mime]) => ({ path, mime })), cut,
    };
  };

  // A picture's bytes for the viewer's blob: URL, within the archive's limits; null for anything that isn't a picture the
  // viewer draws.
  const mediaBytes = async (bytes, path, opts = {}) => {
    if (!mimeOf(path)) return null;
    const b = await D().unzip(bytes, { limits: { ...opts.limits, duplicates: true } }).bytes(path);
    return b && b.slice();
  };

  return { read, media: mediaBytes, LIMITS };
})();

if (typeof module !== 'undefined') module.exports = GZ_PPTX; else GZ_PPTX;
