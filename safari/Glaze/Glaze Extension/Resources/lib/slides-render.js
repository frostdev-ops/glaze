// One slide of lib/pptx.js's model as DOM, for the slides viewer (slides-kind.js): the slide at its own size in CSS pixels
// (9525 EMU each, 96 to the inch), each shape a box at its place with its own SVG (an EMU viewBox: one SVG holding the
// whole slide in EMU breaks in Chromium past ~3.4×10⁷), its text as HTML over it. Fills: solid, linear and path
// gradients, a pattern as a simple hatch, pictures; lines with their dashes, caps, joins and arrowheads; pictures cropped
// and clipped to their geometry; tables with spans; groups nested, each turned and flipped about its centre; what the
// model can't draw ('box') a titled frame. Effects and 3-D the model cut are left out. Fonts by name, then the bundled face
// under the family name writer-paper.css gives it, then the generic family. Built with createElement, createElementNS,
// setAttribute, textContent and the CSSOM only (papers.html allows no inline style attribute), so a node test can run it on
// a stub document.
//   slide(slide, deck, { document, media, labels, find }) → the slide's element; media: path → a blob: URL (a Map or a
//     function), labels: a box's word by its kind when it has no title, find: text to mark.
//   stage(slide, deck, { scale, … }) → the slide scaled, in a box of the scaled size.
//   fit(size, w, h) → the scale that fits a slide in w × h pixels. text(slide) → its shapes' text; count(text, term);
//   visible(deck) → the indices of the slides a show plays (not hidden).
// Classic script; module.exports for node.
var GZ_SLIDES_RENDER = globalThis.GZ_SLIDES_RENDER || (() => {
  const G = () => globalThis.GZ_PPTX_GEOM || require('./pptx-geom.js');
  const SVG = 'http://www.w3.org/2000/svg';
  const EMU = 9525, PT = 4 / 3, LINE = 1.2; // EMU in a CSS pixel; pixels in a point; PowerPoint's single line in ems
  const r2 = (v) => Math.round(v * 100) / 100 || 0;
  const r4 = (v) => Math.round(v * 1e4) / 1e4 || 0;
  const px = (emu) => emu / EMU;
  const len = (emu) => `${r2(emu / EMU)}px`;
  const fit = (size, w, h) => (size?.w > 0 && size?.h > 0 && w > 0 && h > 0 ? Math.min(w / (size.w / EMU), h / (size.h / EMU)) : 0);
  let renders = 0;

  // ---- colours: '#rrggbb' or '#rrggbbaa' as CSS, or as an SVG paint and its opacity
  const HEX = /^#[0-9a-f]{6}([0-9a-f]{2})?$/i;
  const split = (hex) => (HEX.test(hex || '') ? { c: hex.slice(0, 7).toLowerCase(), a: hex.length === 9 ? parseInt(hex.slice(7), 16) / 255 : 1 } : null);
  const cssColor = (hex) => {
    const k = split(hex);
    if (!k) return 'transparent';
    if (k.a >= 1) return k.c;
    const n = parseInt(k.c.slice(1), 16);
    return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${Math.round(k.a * 1000) / 1000})`;
  };
  // A path's lighten and darken modes (shaded faces of a cube or a can) on a solid colour.
  const SHADE = { lighten: [255, 0.4], lightenLess: [255, 0.2], darken: [0, 0.4], darkenLess: [0, 0.2] };
  const shade = (hex, mode) => {
    const k = split(hex), s = SHADE[mode];
    if (!k || !s) return hex;
    const n = parseInt(k.c.slice(1), 16), mix = (v) => Math.round(v + (s[0] - v) * s[1]).toString(16).padStart(2, '0');
    return `#${mix(n >> 16)}${mix((n >> 8) & 255)}${mix(n & 255)}${hex.length === 9 ? hex.slice(7) : ''}`;
  };

  // ---- fonts: the name, the bundled face's family (writer-paper.css), the generic family
  const FAMILY = { carlito: 'Calibri', arimo: 'Arial', tinos: 'Times New Roman', cousine: 'Courier New' };
  const GENERIC = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy']);
  const family = (f) => {
    const names = [];
    for (const n of [f?.name, FAMILY[f?.face]]) {
      const clean = String(n || '').replace(/["\\;{}]/g, '').trim();
      if (clean && !names.some((x) => x.toLowerCase() === clean.toLowerCase())) names.push(clean);
    }
    return [...names.map((n) => `"${n}"`), GENERIC.has(f?.generic) ? f.generic : 'sans-serif'].join(', ');
  };

  // ---- elements
  const style = (e, props) => { for (const [k, v] of Object.entries(props)) if (v != null && v !== '') e.style.setProperty(k, String(v)); return e; };
  const html = (X, tag, cls) => { const e = X.doc.createElement(tag); if (cls) e.className = cls; return e; };
  const svgEl = (X, tag, attrs = {}) => {
    const e = X.doc.createElementNS(SVG, tag);
    for (const [k, v] of Object.entries(attrs)) if (v != null) e.setAttribute(k, String(v));
    return e;
  };
  // A box at its place: bounds relative to its container's origin, turned and flipped about its centre.
  const place = (e, s, origin) => {
    const b = s.bounds;
    style(e, { position: 'absolute', left: len(b.x - origin.x), top: len(b.y - origin.y), width: len(b.w), height: len(b.h) });
    const t = [];
    if (s.rotation) t.push(`rotate(${r2(s.rotation)}deg)`);
    if (s.flipH || s.flipV) t.push(`scale(${s.flipH ? -1 : 1}, ${s.flipV ? -1 : 1})`);
    if (t.length) style(e, { transform: t.join(' '), 'transform-origin': '50% 50%' });
    e.setAttribute('data-name', s.name || '');
    return e;
  };

  // ---- geometry: a preset or custom path in the shape's own EMU box
  const ALIAS = { straightConnector1: 'line' };
  const geometry = (s) => {
    const g = s.geometry || {}, w = s.bounds.w, h = s.bounds.h;
    if (Array.isArray(g.pathLst)) return G().custom(g, w, h);
    return G().path({ prst: ALIAS[g.prst] || g.prst || 'rect', avLst: g.avLst, w, h });
  };
  // An SVG the size of the box (at least a pixel each way, so a flat line still draws) with its viewBox in EMU.
  const canvas = (X, w, h) => {
    const W = Math.max(Math.round(w), EMU), H = Math.max(Math.round(h), EMU);
    const svg = svgEl(X, 'svg', { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none', 'aria-hidden': 'true', focusable: 'false' });
    style(svg, { position: 'absolute', left: '0', top: '0', width: len(W), height: len(H), overflow: 'visible' });
    let defs = null;
    // Defined before anything that uses it is drawn, so first in the SVG.
    const def = (el) => { if (!defs) { defs = svgEl(X, 'defs'); svg.append(defs); } defs.append(el); return el; };
    return { svg, def };
  };

  // A fill as an SVG paint: 'none', a colour, or url(#…) to a gradient or pattern it defines. Pictures are drawn apart.
  const paint = (X, C, fill, mode) => {
    if (!fill) return { fill: 'none' };
    if (fill.type === 'solid') {
      const k = split(shade(fill.color, mode));
      return k ? { fill: k.c, 'fill-opacity': k.a < 1 ? r4(k.a) : null } : { fill: 'none' };
    }
    if (fill.type === 'gradient') return { fill: `url(#${gradient(X, C, fill)})` };
    if (fill.type === 'pattern') return { fill: `url(#${pattern(X, C, fill)})` };
    return { fill: 'none' };
  };
  const stops = (X, el, list) => {
    for (const s of list) {
      const k = split(s.color);
      if (k) el.append(svgEl(X, 'stop', { offset: r4(s.at), 'stop-color': k.c, 'stop-opacity': k.a < 1 ? r4(k.a) : null }));
    }
    return el;
  };
  // Linear: along the angle (clockwise from →) across the box; a path gradient: out from its focus rectangle's centre.
  const gradient = (X, C, g) => {
    const id = X.id();
    if (g.kind === 'linear') {
      const a = (g.angle * Math.PI) / 180, dx = Math.cos(a), dy = Math.sin(a), half = (Math.abs(dx) + Math.abs(dy)) / 2;
      C.def(stops(X, svgEl(X, 'linearGradient', { id, x1: r4(0.5 - dx * half), y1: r4(0.5 - dy * half), x2: r4(0.5 + dx * half), y2: r4(0.5 + dy * half) }), g.stops));
    } else {
      const f = g.focus || { l: 0.5, t: 0.5, r: 0.5, b: 0.5 }, cx = r4((f.l + 1 - f.r) / 2), cy = r4((f.t + 1 - f.b) / 2);
      C.def(stops(X, svgEl(X, 'radialGradient', { id, cx, cy, fx: cx, fy: cy, r: 0.75 }), g.stops));
    }
    return id;
  };
  // A pattern preset as a hatch in its foreground over its background: lines across, up, both, diagonals, or dots.
  const pattern = (X, C, p) => {
    const id = X.id(), T = 8 * EMU, w = EMU;
    const el = svgEl(X, 'pattern', { id, patternUnits: 'userSpaceOnUse', width: T, height: T });
    const bg = split(p.bg), fg = split(p.fg) || { c: '#000000', a: 1 };
    if (bg) el.append(svgEl(X, 'rect', { x: 0, y: 0, width: T, height: T, fill: bg.c, 'fill-opacity': bg.a < 1 ? r4(bg.a) : null }));
    const name = String(p.preset || ''), ink = { stroke: fg.c, 'stroke-opacity': fg.a < 1 ? r4(fg.a) : null, 'stroke-width': /^dk|^wd/.test(name) ? 2 * w : w };
    let lines = 0;
    const line = (d) => { lines++; el.append(svgEl(X, 'path', { d, fill: 'none', ...ink })); };
    const cross = /cross|grid|check|trellis|weave|brick|shingle|wave|sphere|divot/i.test(name) && !/diagCross/i.test(name);
    if (/horz/i.test(name) || cross) line(`M 0 ${T / 2} H ${T}`);
    if (/vert/i.test(name) || cross) line(`M ${T / 2} 0 V ${T}`);
    if (/dnDiag|diagCross/i.test(name)) line(`M 0 0 L ${T} ${T}`);
    if (/upDiag|diagCross/i.test(name)) line(`M 0 ${T} L ${T} 0`);
    if (!lines || /^pct|dot|confetti|plaid|zigZag|^open|solidDmnd/i.test(name)) {
      const pct = Math.min(90, Math.max(5, Number(/^pct(\d+)$/.exec(name)?.[1]) || 25)) / 100, s = Math.max(EMU, Math.round(T * Math.sqrt(pct) / 1.5));
      el.append(svgEl(X, 'rect', { x: (T - s) / 2, y: (T - s) / 2, width: s, height: s, fill: fg.c, 'fill-opacity': fg.a < 1 ? r4(fg.a) : null }));
    }
    C.def(el);
    return id;
  };

  // A line's dashes in line widths, its caps and joins, and its ends as markers.
  const DASH = { dot: [1, 3], dash: [4, 3], lgDash: [8, 3], dashDot: [4, 3, 1, 3], lgDashDot: [8, 3, 1, 3], lgDashDotDot: [8, 3, 1, 3, 1, 3], sysDash: [3, 1], sysDot: [1, 1], sysDashDot: [3, 1, 1, 1], sysDashDotDot: [3, 1, 1, 1, 1, 1] };
  const CAP = { flat: 'butt', round: 'round', square: 'square' };
  const stroke = (line) => {
    const k = line && split(line.color);
    if (!k) return { stroke: 'none' };
    const w = Math.max(1, Math.round(line.width || 0));
    return {
      stroke: k.c, 'stroke-opacity': k.a < 1 ? r4(k.a) : null, 'stroke-width': w, 'stroke-linecap': CAP[line.cap] || 'butt', 'stroke-linejoin': line.join || 'round',
      'stroke-dasharray': DASH[line.dash] ? DASH[line.dash].map((d) => d * w).join(' ') : null,
    };
  };
  const SIZE = { sm: 2, med: 3, lg: 5 };
  const marker = (X, C, end, line, start) => {
    const id = X.id(), k = split(line.color), color = k ? k.c : '#000000';
    const m = svgEl(X, 'marker', { id, viewBox: '0 0 10 10', preserveAspectRatio: 'none', markerUnits: 'strokeWidth', markerWidth: SIZE[end.len] || 3, markerHeight: SIZE[end.w] || 3,
      refX: end.type === 'oval' || end.type === 'diamond' ? 5 : end.type === 'arrow' ? 9 : 10, refY: 5, orient: start ? 'auto-start-reverse' : 'auto', overflow: 'visible' });
    const fill = { fill: color, 'fill-opacity': k && k.a < 1 ? r4(k.a) : null };
    if (end.type === 'oval') m.append(svgEl(X, 'ellipse', { cx: 5, cy: 5, rx: 5, ry: 5, ...fill }));
    else if (end.type === 'diamond') m.append(svgEl(X, 'path', { d: 'M 0 5 L 5 0 L 10 5 L 5 10 Z', ...fill }));
    else if (end.type === 'stealth') m.append(svgEl(X, 'path', { d: 'M 0 0 L 10 5 L 0 10 L 3 5 Z', ...fill }));
    else if (end.type === 'arrow') m.append(svgEl(X, 'path', { d: 'M 0 0 L 10 5 L 0 10', fill: 'none', stroke: color, 'stroke-width': 10 / (SIZE[end.len] || 3), 'stroke-linejoin': 'miter' }));
    else m.append(svgEl(X, 'path', { d: 'M 0 0 L 10 5 L 0 10 Z', ...fill }));
    C.def(m);
    return `url(#${id})`;
  };

  // A picture over the box: the visible part (the crop) stretched to it, clipped to the geometry's paths.
  const image = (X, C, g, media, crop, alpha, w, h) => {
    const url = media && X.url(media.path);
    if (!url) return;
    const c = crop || { l: 0, t: 0, r: 0, b: 0 }, fw = 1 - c.l - c.r, fh = 1 - c.t - c.b;
    if (!(fw > 0 && fh > 0)) return;
    const W = w / fw, H = h / fh, clip = X.id(), cp = svgEl(X, 'clipPath', { id: clip });
    for (const p of g.paths) if (p.d && p.fill !== 'none') cp.append(svgEl(X, 'path', { d: p.d }));
    C.def(cp);
    C.svg.append(svgEl(X, 'image', { href: url, x: r2(-c.l * W), y: r2(-c.t * H), width: r2(W), height: r2(H), preserveAspectRatio: 'none', 'clip-path': `url(#${clip})`, opacity: alpha < 1 ? r4(alpha) : null }));
  };
  // The geometry's paths with the fill and line; arrowheads on the open ones.
  const draw = (X, C, g, fill, line) => {
    const st = stroke(line), ends = line && split(line.color) ? [line.head && ['marker-start', line.head, true], line.tail && ['marker-end', line.tail, false]].filter(Boolean) : [];
    for (const p of g.paths) {
      if (!p.d) continue;
      const attrs = { d: p.d, ...(p.fill === 'none' || fill?.type === 'picture' ? { fill: 'none' } : paint(X, C, fill, p.fill)), ...(p.stroke ? st : { stroke: 'none' }) };
      if (p.stroke && !/Z\s*$/.test(p.d)) for (const [at, end, start] of ends) attrs[at] = marker(X, C, end, line, start);
      C.svg.append(svgEl(X, 'path', attrs));
    }
  };

  // ---- text
  const ANCHOR = { t: 'flex-start', ctr: 'center', b: 'flex-end', just: 'space-between', dist: 'space-between' };
  const CELL = { t: 'top', ctr: 'middle', b: 'bottom', just: 'middle', dist: 'middle' };
  const UNDERLINE = { solid: 'solid', double: 'double', dotted: 'dotted', dashed: 'dashed', wavy: 'wavy' };
  const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const finder = (term) => (term ? new RegExp(escape(term), 'giu') : null);
  const count = (text, term) => { const re = finder(String(term || '')); return re ? (String(text || '').match(re) || []).length : 0; };
  // A run's text, each match of find in a mark.
  const marked = (X, el, text, ranges, offset) => {
    if (!X.find) { el.textContent = text; return; }
    let at = 0;
    for (const m of ranges) {
      const start = Math.max(0, m.start - offset), end = Math.min(text.length, m.end - offset);
      if (end <= start) continue;
      if (start > at) el.append(text.slice(at, start));
      const mark = html(X, 'mark', 'gs-hit');
      mark.setAttribute('data-gs-hit', m.hit);
      mark.textContent = text.slice(start, end);
      el.append(mark);
      at = end;
    }
    if (at < text.length) el.append(text.slice(at));
  };
  // A superscript or subscript is drawn smaller, as Office draws it, and raised or lowered by its baseline share of the
  // run's own size.
  const SCRIPT = 2 / 3;
  const runEl = (X, r, fs, ranges, offset) => {
    if (r.br) return html(X, 'br');
    const e = html(X, 'span');
    const lines = [r.underline && 'underline', r.strike && 'line-through'].filter(Boolean);
    style(e, {
      'font-family': family(r.font), 'font-size': `${r2(r.size * PT * fs * (r.baseline ? SCRIPT : 1))}px`, 'font-weight': r.bold ? '700' : null, 'font-style': r.italic ? 'italic' : null,
      color: r.color == null ? 'transparent' : cssColor(r.color), 'text-decoration-line': lines.length ? lines.join(' ') : null,
      'text-decoration-style': r.underline ? UNDERLINE[r.underline] : r.strike === 'double' ? 'double' : null, 'background-color': r.highlight ? cssColor(r.highlight) : null,
      'vertical-align': r.baseline ? `${r2(r.baseline * r.size * PT * fs)}px` : null, 'text-transform': r.caps === 'all' ? 'uppercase' : null, 'font-variant-caps': r.caps === 'small' ? 'small-caps' : null,
      'letter-spacing': r.spacing ? `${r2(r.spacing * PT * fs)}px` : null,
    });
    marked(X, e, r.text, ranges, offset);
    return e;
  };
  const gap = (sp, size, fs) => (sp?.pt != null ? `${r2(sp.pt * PT * fs)}px` : sp?.pct != null ? `${r2(sp.pct * size * LINE * PT * fs)}px` : null);
  const paraEl = (X, p, A) => {
    const el = html(X, 'div', 'gs-p'), first = p.runs.find((r) => !r.br && r.text), size = first ? first.size : p.endSize;
    style(el, {
      'text-align': p.align, 'padding-inline-start': len(Math.max(0, p.marL)), 'text-indent': len(p.indent), direction: p.rtl ? 'rtl' : null, 'font-size': `${r2(size * PT * A.fs)}px`,
      'line-height': p.lineSpacing?.pt != null ? `${r2(p.lineSpacing.pt * PT)}px` : String(r4(Math.max(0.1, (p.lineSpacing?.pct ?? 1) - A.lr) * LINE)),
      'margin-top': gap(p.spaceBefore, size, A.fs), 'margin-bottom': gap(p.spaceAfter, size, A.fs), 'tab-size': p.defTab > 0 ? len(p.defTab) : null,
    });
    const b = p.bullet;
    if (b) {
      const bu = html(X, 'span', 'gs-bu');
      style(bu, { display: 'inline-block', 'min-width': len(Math.max(0, -p.indent)), 'text-indent': '0', 'font-family': family(b.font), 'font-size': `${r2(b.size * PT * A.fs)}px`,
        color: cssColor(b.color), 'font-weight': 'normal', 'font-style': 'normal', 'padding-inline-end': p.indent >= 0 ? '0.3em' : null, 'white-space': 'pre' });
      const url = b.picture && X.url(b.picture.path);
      if (url) { const img = html(X, 'img'); img.setAttribute('src', url); img.setAttribute('alt', ''); style(img, { width: '0.8em', height: '0.8em', 'vertical-align': 'middle' }); bu.append(img); } else bu.textContent = b.text;
      el.append(bu);
    }
    const ranges = X.find ? [...p.runs.map((r) => r.text).join('').matchAll(X.find)].map((m) => ({ start: m.index, end: m.index + m[0].length, hit: X.hit++ })) : [];
    let offset = 0, at = 0;
    for (const r of p.runs) {
      while (at < ranges.length && ranges[at].end <= offset) at++;
      let to = at;
      while (to < ranges.length && ranges[to].start < offset + r.text.length) to++;
      el.append(runEl(X, r, A.fs, ranges.slice(at, to), offset));
      offset += r.text.length;
    }
    if (!first) el.append(html(X, 'br'));
    return el;
  };
  const paragraphs = (X, el, text) => {
    const A = { fs: text.autofit?.fontScale || 1, lr: text.autofit?.lineReduction || 0 };
    for (const p of text.paragraphs) el.append(paraEl(X, p, A));
    return el;
  };
  // A shape's text in its geometry's text box less the insets, anchored top, middle or bottom, in columns where it has them.
  // A paragraph's margin and indent are on its start side: the right of a right-to-left one.
  // A flipped shape's text still reads: flipped back across, or turned half round where it was flipped upside down.
  const VERTICAL = { vert: 'vertical-rl', eaVert: 'vertical-rl', mongolianVert: 'vertical-lr', wordArtVert: 'vertical-rl', wordArtVertRtl: 'vertical-rl', vert270: 'vertical-rl' };
  const bodyEl = (X, text, s, rect) => {
    const el = html(X, 'div', 'gs-body'), ins = text.insets;
    const w = Math.max(0, rect.r - rect.l - ins.l - ins.r), h = Math.max(0, rect.b - rect.t - ins.t - ins.b);
    const t = [];
    if (text.rotation) t.push(`rotate(${r2(text.rotation)}deg)`);
    if (s.flipH !== s.flipV) t.push('scale(-1, 1)');
    if (text.vert === 'vert270') t.push('rotate(180deg)');
    style(el, {
      position: 'absolute', left: len(rect.l + ins.l), top: len(rect.t + ins.t), width: len(w), height: len(h), display: 'flex', 'flex-direction': 'column',
      'justify-content': ANCHOR[text.anchor] || 'flex-start', 'align-items': text.anchorCtr ? 'center' : null, 'white-space': text.wrap ? 'pre-wrap' : 'pre',
      'overflow-wrap': text.wrap ? 'break-word' : null, 'writing-mode': VERTICAL[text.vert] || null, 'text-orientation': text.vert === 'wordArtVert' ? 'upright' : null,
      transform: t.length ? t.join(' ') : null, 'transform-origin': t.length ? '50% 50%' : null, color: '#000000',
    });
    if (text.columns > 1) {
      const cols = html(X, 'div', 'gs-cols');
      style(cols, { 'column-count': text.columns, 'column-gap': len(text.columnGap), 'column-fill': 'auto', height: '100%' });
      el.append(paragraphs(X, cols, text));
    } else paragraphs(X, el, text);
    return el;
  };

  // ---- shapes
  const shapeEl = (X, s, origin) => {
    const e = place(html(X, 'div', 'gs-shape'), s, origin), g = geometry(s), C = canvas(X, s.bounds.w, s.bounds.h);
    if (s.fill?.type === 'picture') image(X, C, g, s.fill.media, s.fill.crop, s.fill.alpha ?? 1, s.bounds.w, s.bounds.h);
    draw(X, C, g, s.fill, s.line);
    e.append(C.svg);
    if (s.text) e.append(bodyEl(X, s.text, s, g.rect));
    return e;
  };
  const pictureEl = (X, s, origin) => {
    const e = place(html(X, 'div', 'gs-shape gs-pic'), s, origin), g = geometry(s), C = canvas(X, s.bounds.w, s.bounds.h);
    e.setAttribute('role', 'img');
    if (s.alt) e.setAttribute('aria-label', s.alt);
    image(X, C, g, s.media, s.crop, s.alpha ?? 1, s.bounds.w, s.bounds.h);
    draw(X, C, g, null, s.line);
    e.append(C.svg);
    return e;
  };
  const border = (line) => {
    const k = line && split(line.color);
    if (!k) return null;
    const kind = line.dash === 'solid' ? 'solid' : /dot/i.test(line.dash) && !/dash/i.test(line.dash) ? 'dotted' : 'dashed';
    return `${r2(px(line.width))}px ${kind} ${cssColor(line.color)}`;
  };
  const cellFill = (f) => (!f ? null : f.type === 'solid' ? cssColor(f.color) : f.type === 'gradient' ? cssColor(f.stops[0]?.color) : f.type === 'pattern' ? cssColor(f.bg) : null);
  const tableEl = (X, s, origin) => {
    const e = place(html(X, 'div', 'gs-shape gs-table'), s, origin), t = html(X, 'table'), cg = html(X, 'colgroup'), tb = html(X, 'tbody');
    style(t, { position: 'absolute', left: '0', top: '0', width: len(s.cols.reduce((n, w) => n + w, 0)), 'table-layout': 'fixed', 'border-collapse': 'collapse', 'border-spacing': '0' });
    for (const w of s.cols) cg.append(style(html(X, 'col'), { width: len(w) }));
    for (const row of s.rows) {
      const tr = style(html(X, 'tr'), { height: len(row.h) });
      for (const c of row.cells) {
        if (c.merged) continue;
        const td = html(X, 'td'), ins = c.text.insets;
        if (c.colSpan > 1) td.setAttribute('colspan', c.colSpan);
        if (c.rowSpan > 1) td.setAttribute('rowspan', c.rowSpan);
        style(td, {
          padding: `${len(ins.t)} ${len(ins.r)} ${len(ins.b)} ${len(ins.l)}`, 'vertical-align': CELL[c.text.anchor] || 'top', 'background-color': cellFill(c.fill),
          'border-left': border(c.borders.l), 'border-right': border(c.borders.r), 'border-top': border(c.borders.t), 'border-bottom': border(c.borders.b),
          'white-space': 'pre-wrap', 'overflow-wrap': 'break-word', overflow: 'hidden', color: '#000000',
        });
        tr.append(paragraphs(X, td, c.text));
      }
      tb.append(tr);
    }
    t.append(cg, tb);
    e.append(t);
    return e;
  };
  const groupEl = (X, s, origin) => {
    const e = place(html(X, 'div', 'gs-group'), s, origin);
    for (const c of s.shapes) { const n = shapeOf(X, c, s.bounds); if (n) e.append(n); }
    return e;
  };
  const boxEl = (X, s, origin) => {
    const e = place(html(X, 'div', 'gs-shape gs-box'), s, origin);
    style(e, { display: 'flex', 'align-items': 'center', 'justify-content': 'center', 'box-sizing': 'border-box', padding: '8px', border: '1px dashed rgba(0, 0, 0, 0.35)',
      'background-color': 'rgba(127, 127, 127, 0.08)', color: 'rgba(0, 0, 0, 0.6)', 'font-family': '"Calibri", sans-serif', 'font-size': '18px', 'text-align': 'center', overflow: 'hidden' });
    e.textContent = s.title || X.labels?.[s.kind] || '';
    return e;
  };
  const DRAW = { shape: shapeEl, picture: pictureEl, table: tableEl, group: groupEl, box: boxEl };
  // A shape that fails to draw is left out alone.
  const shapeOf = (X, s, origin) => {
    try { return Object.hasOwn(DRAW, s?.type) ? DRAW[s.type](X, s, origin) : null; } catch { return null; }
  };

  const context = (o) => {
    const prefix = `gs${++renders}`;
    let n = 0;
    const media = o.media;
    return {
      hit: 0, doc: o.document || globalThis.document, labels: o.labels || {}, find: finder(String(o.find || '')), id: () => `${prefix}-${++n}`,
      url: (path) => (typeof media === 'function' ? media(path) : media?.get?.(path)) || null,
    };
  };
  const slide = (s, deck, o = {}) => {
    const X = context(o), el = html(X, 'div', 'gs-slide'), size = deck.size;
    style(el, { position: 'relative', overflow: 'hidden', width: len(size.w), height: len(size.h), 'background-color': '#ffffff' });
    const bg = s?.background;
    if (bg?.type === 'solid') style(el, { 'background-color': cssColor(bg.color) });
    else if (bg) {
      const C = canvas(X, size.w, size.h), rect = { paths: [{ d: `M 0 0 H ${size.w} V ${size.h} H 0 Z`, fill: 'norm', stroke: false }] };
      C.svg.setAttribute('class', 'gs-bg');
      if (bg.type === 'picture') image(X, C, rect, bg.media, bg.crop, bg.alpha ?? 1, size.w, size.h);
      else draw(X, C, rect, bg, null);
      el.append(C.svg);
    }
    for (const sh of s?.shapes || []) { const n = shapeOf(X, sh, { x: 0, y: 0 }); if (n) el.append(n); }
    return el;
  };
  const stage = (s, deck, o = {}) => {
    const k = Number.isFinite(o.scale) && o.scale > 0 ? o.scale : 1, X = context(o);
    const box = style(html(X, 'div', 'gs-stage'), { position: 'relative', overflow: 'hidden', width: len(deck.size.w * k), height: len(deck.size.h * k), flex: 'none' });
    const el = slide(s, deck, o);
    style(el, { transform: `scale(${r4(k)})`, 'transform-origin': '0 0' });
    box.append(el);
    return box;
  };

  // ---- the model's text, for find
  const bodyText = (t) => (t ? t.paragraphs.map((p) => p.runs.map((r) => r.text).join('')).join('\n') : '');
  const shapeText = (s) => (s.type === 'group' ? s.shapes.map(shapeText) : s.type === 'table' ? s.rows.flatMap((r) => r.cells.filter((c) => !c.merged).map((c) => bodyText(c.text))) : [bodyText(s.text)]).flat();
  const text = (s) => (s?.shapes || []).flatMap(shapeText).filter(Boolean).join('\n');
  const visible = (deck) => deck.slides.flatMap((s, i) => (s.hidden ? [] : [i]));

  return { EMU, px, fit, slide, stage, text, count, visible, family };
})();

if (typeof module !== 'undefined') module.exports = GZ_SLIDES_RENDER; else GZ_SLIDES_RENDER;
