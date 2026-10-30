// A sheet's charts as an .xlsx keeps them (lib/sheet-xlsx.js: sheet.keep.drawing, the parts in wb.keep.parts): the
// drawing's anchors (two-cell, one-cell, absolute) and each chart part read into a plain description, never written back.
// charts(wb, sheet) → [{ id, path, anchor, chart }] with each anchor and every c:f reference moved through wb.keep.log
// (the rows and columns inserted or deleted, the sheets renamed since the file was read), as the writer moves the parts.
// A chart: { kind: 'plot' | 'frame', type (the frame's word), title, legend, groups: [{ type: bar | line | pie | doughnut |
// scatter | area, dir, grouping, varyColors, gap, overlap, hole, first, series: [{ name, cat, val, x, y, color, line,
// marker, points, labels }] }], axes: { cat, val, x, y } }. A series' name, cat and val are { f, cache: { pts, fmt } }:
// resolve(chart, lookup) reads each f live (lookup: lib/sheet-model's cells through the engine's values) and falls back
// to the cache. Colours are '#RRGGBB' from the theme (wb.keep.theme), the series' own, or Excel's automatic order.
// Classic script; doctext, the model and the formula module are looked up when a function runs. module.exports for node.
var GZ_SHEET_CHART_XML = globalThis.GZ_SHEET_CHART_XML || (() => {
  const dep = (name, file) => (typeof globalThis[name] !== 'undefined' ? globalThis[name] : typeof module !== 'undefined' ? require(file) : null);
  const D = () => dep('GZ_DOCTEXT', './doctext.js');
  const M = () => dep('GZ_SHEET_MODEL', './sheet-model.js');
  const F = () => dep('GZ_SHEET_FORMULA', './sheet-formula.js');
  const EMU = 9525; // per CSS pixel

  // ── XML ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
  const local = (name) => name.slice(name.lastIndexOf(':') + 1);
  const ATTR = /([^\s=/]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  const tree = (src) => {
    const d = D(), root = { name: '', a: {}, kids: [], text: '' }, stack = [root];
    for (const tk of d.tokens(src)) {
      const top = stack[stack.length - 1];
      if (!tk.name) { top.text += tk.cdata ?? d.decode(tk.text); continue; }
      if (tk.close) { const i = stack.findLastIndex((n) => n.name === tk.name); if (i > 0) stack.length = i; continue; }
      const a = {};
      for (const m of tk.attrs.matchAll(ATTR)) a[m[1]] = d.decode(m[2] ?? m[3]);
      const node = { name: tk.name, a, kids: [], text: '' };
      top.kids.push(node);
      if (!tk.empty) stack.push(node);
    }
    return root;
  };
  const kid = (n, name) => n?.kids.find((k) => local(k.name) === name) ?? null;
  const kids = (n, name) => n?.kids.filter((k) => local(k.name) === name) ?? [];
  const path = (n, ...names) => names.reduce((x, name) => kid(x, name), n);
  const val = (n, name) => kid(n, name)?.a.val;
  const flag = (n, name, dflt = false) => { const k = kid(n, name); if (!k) return dflt; return k.a.val === undefined ? true : k.a.val === '1' || k.a.val === 'true'; };
  const num = (v, dflt = null) => { const x = Number(v); return v !== undefined && v !== '' && Number.isFinite(x) ? x : dflt; };
  const all = (n, name, out = []) => { for (const k of n?.kids ?? []) { if (local(k.name) === name) out.push(k); all(k, name, out); } return out; };
  const textOf = (n) => n.text + n.kids.map(textOf).join('');
  const attr = (n, name) => n?.a[name] ?? Object.entries(n?.a ?? {}).find(([k]) => local(k) === name)?.[1];
  const partText = (data) => (typeof data === 'string' ? data : new TextDecoder(/^﻿?<\?xml\s[^?]*\bencoding\s*=\s*["']([^"']+)["']/.exec(new TextDecoder().decode(data.subarray(0, 512)))?.[1] ?? 'utf-8').decode(data));

  // ── Package paths ───────────────────────────────────────────────────────────────────────────────────────────────────
  const dirOf = (p) => p.slice(0, p.lastIndexOf('/') + 1);
  const relsPath = (p) => `${dirOf(p)}_rels/${p.slice(dirOf(p).length)}.rels`;
  const resolvePath = (from, target) => {
    if (/^[a-z][\w+.-]*:/i.test(target)) return null;
    const out = [];
    for (const s of (target.startsWith('/') ? target.slice(1) : dirOf(from) + target).split('/')) {
      if (s === '..') out.pop(); else if (s !== '.' && s) out.push(s);
    }
    return out.join('/');
  };
  const partOf = (parts, p) => { if (!p) return null; if (parts[p]) return parts[p]; const low = p.toLowerCase(); const k = Object.keys(parts).find((x) => x.toLowerCase() === low); return k ? parts[k] : null; };
  const relsOf = (parts, from) => {
    const part = partOf(parts, relsPath(from));
    if (!part) return new Map();
    const out = new Map();
    for (const r of kids(kid(tree(partText(part.data)), 'Relationships'), 'Relationship')) {
      if (r.a.TargetMode === 'External' || !r.a.Id || !r.a.Target) continue;
      out.set(r.a.Id, { type: (r.a.Type || '').slice((r.a.Type || '').lastIndexOf('/') + 1), path: resolvePath(from, r.a.Target) });
    }
    return out;
  };

  // ── Colours: DrawingML's solidFill (srgbClr, schemeClr, sysClr, prstClr) with lumMod, lumOff, tint, shade ──────────
  const SCHEME = { lt1: 0, bg1: 0, dk1: 1, tx1: 1, lt2: 2, bg2: 2, dk2: 3, tx2: 3, accent1: 4, accent2: 5, accent3: 6, accent4: 7, accent5: 8, accent6: 9, hlink: 10, folHlink: 11 };
  const DEFAULT_THEME = ['#FFFFFF', '#000000', '#E8E8E8', '#0E2841', '#156082', '#E97132', '#196B24', '#0F9ED5', '#A02B93', '#4EA72E', '#467886', '#96607D'];
  const PRESET = { black: '#000000', white: '#FFFFFF', red: '#FF0000', green: '#008000', blue: '#0000FF', yellow: '#FFFF00', gray: '#808080', orange: '#FFA500' };
  const hex2 = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0').toUpperCase();
  const rgbOf = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const toHex = ([r, g, b]) => `#${hex2(r * 255)}${hex2(g * 255)}${hex2(b * 255)}`;
  const hsl = ([r, g, b]) => {
    const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
    if (max === min) return [0, 0, l];
    const d = max - min, s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    const h = (max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4) / 6;
    return [h, s, l];
  };
  const rgb = ([h, s, l]) => {
    if (!s) return [l, l, l];
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
    const f = (t) => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
    return [f(h + 1 / 3), f(h), f(h - 1 / 3)];
  };
  // A hex colour with DrawingML's transforms, in the order they're written.
  const transform = (hex, mods) => {
    let c = rgbOf(hex);
    for (const m of mods) {
      const v = num(m.a.val, 100000) / 100000, n = local(m.name);
      if (n === 'lumMod' || n === 'lumOff') { const x = hsl(c); x[2] = Math.max(0, Math.min(1, n === 'lumMod' ? x[2] * v : x[2] + v)); c = rgb(x); }
      else if (n === 'tint') c = c.map((k) => 1 - (1 - k) * v);
      else if (n === 'shade') c = c.map((k) => k * v);
    }
    return toHex(c);
  };
  // A fill's colour, or null (none, or nothing said). auto: what phClr stands for.
  const colorIn = (n, theme, auto = null) => {
    if (!n) return null;
    const c = n.kids.find((k) => /^(srgbClr|schemeClr|sysClr|prstClr|scrgbClr)$/.test(local(k.name)));
    if (!c) return null;
    const k = local(c.name);
    let hex = null;
    if (k === 'srgbClr' && /^[0-9A-Fa-f]{6}$/.test(c.a.val || '')) hex = `#${c.a.val.toUpperCase()}`;
    else if (k === 'sysClr') hex = /^[0-9A-Fa-f]{6}$/.test(c.a.lastClr || '') ? `#${c.a.lastClr.toUpperCase()}` : c.a.val === 'window' ? '#FFFFFF' : '#000000';
    else if (k === 'prstClr') hex = PRESET[c.a.val] ?? null;
    else if (k === 'schemeClr') hex = c.a.val === 'phClr' ? auto : (theme[SCHEME[c.a.val]] ?? null);
    else if (k === 'scrgbClr') hex = toHex(['r', 'g', 'b'].map((x) => num(c.a[x], 0) / 100000));
    return hex && transform(hex, c.kids);
  };
  // An spPr's fill and line: { fill (a colour, 'none' or null), line (the same), width (px) }.
  const shapeOf = (spPr, theme, auto) => {
    if (!spPr) return { fill: null, line: null, width: null };
    const fill = kid(spPr, 'noFill') ? 'none' : colorIn(kid(spPr, 'solidFill'), theme, auto) ?? colorIn(kid(kid(kid(spPr, 'gradFill'), 'gsLst'), 'gs'), theme, auto);
    const ln = kid(spPr, 'ln');
    const line = !ln ? null : kid(ln, 'noFill') ? 'none' : colorIn(kid(ln, 'solidFill'), theme, auto);
    return { fill: fill ?? null, line, width: ln?.a.w ? num(ln.a.w, 9525) / EMU : null };
  };
  // Excel's automatic series colours: the six accents, then each darker or lighter in turn (chart style 2).
  const VARY = [[], [{ name: 'lumMod', a: { val: '60000' } }], [{ name: 'lumMod', a: { val: '80000' } }, { name: 'lumOff', a: { val: '20000' } }], [{ name: 'lumMod', a: { val: '80000' } }],
    [{ name: 'lumMod', a: { val: '60000' } }, { name: 'lumOff', a: { val: '40000' } }], [{ name: 'lumMod', a: { val: '50000' } }]];
  const autoColor = (i, theme) => transform(theme[4 + (i % 6)] ?? DEFAULT_THEME[4 + (i % 6)], VARY[Math.floor(i / 6) % VARY.length]);

  // ── Drawing anchors ─────────────────────────────────────────────────────────────────────────────────────────────────
  const marker = (n) => n && { col: num(textOf(kid(n, 'col')), 0), colOff: num(textOf(kid(n, 'colOff') ?? { text: '0', kids: [] }), 0) / EMU, row: num(textOf(kid(n, 'row')), 0), rowOff: num(textOf(kid(n, 'rowOff') ?? { text: '0', kids: [] }), 0) / EMU };
  const extOf = (n) => n && { w: num(n.a.cx, 0) / EMU, h: num(n.a.cy, 0) / EMU };
  // The anchors that hold a chart (a graphic frame of c:chart or cx:chart, the first choice of an mc:AlternateContent).
  const anchors = (xml) => {
    const root = kid(tree(xml), 'wsDr');
    const out = [];
    for (const a of root?.kids ?? []) {
      const kind = local(a.name);
      if (!/^(twoCellAnchor|oneCellAnchor|absoluteAnchor)$/.test(kind)) continue;
      const frame = all(a, 'graphicFrame')[0];
      const data = frame && all(frame, 'graphicData')[0];
      const ref = data && data.kids.find((k) => local(k.name) === 'chart');
      if (!ref) continue;
      const rid = attr(ref, 'id');
      const nv = all(frame, 'cNvPr')[0];
      out.push({ kind, rid, ex: /chartex/i.test(data.a.uri || '') || /^cx:/.test(ref.name), name: nv?.a.name || '', descr: nv?.a.descr || '',
        from: marker(kid(a, 'from')), to: marker(kid(a, 'to')), ext: extOf(kid(a, 'ext')), pos: kid(a, 'pos') && { x: num(kid(a, 'pos').a.x, 0) / EMU, y: num(kid(a, 'pos').a.y, 0) / EMU }, editAs: a.a.editAs || null });
    }
    return out;
  };

  // ── Moving through the log (as lib/sheet-xlsx.js moveXml moves the parts it writes) ───────────────────────────────
  const MAXR = 1048576, MAXC = 16384;
  const moveIndex = (k, e) => { const max = e.axis === 'row' ? MAXR : MAXC; return k < e.at ? k : e.n < 0 && k < e.at - e.n ? null : k + e.n < max ? k + e.n : null; };
  // An anchor's cell (row or col) after the sheet's shifts: a deleted one lands where the deletion was.
  const moveCell = (k, axis, entries) => { for (const e of entries) { if (e.axis !== axis) continue; const m = moveIndex(k, e); k = m === null ? e.at : m; } return k; };
  const moveFormula = (text, log) => {
    let f = text;
    for (const e of log) {
      try { f = e.op === 'rename' ? F().rename(f, e.from, e.to) : e.op === 'shift' ? F().shift(f, { sheet: e.name, axis: e.axis, at: e.at, n: e.n }, null) : f; } catch { return f; }
    }
    return f;
  };
  const moveAnchor = (a, entries) => {
    if (!entries.length || a.kind === 'absoluteAnchor') return a;
    const at = (m) => m && { ...m, row: moveCell(m.row, 'row', entries), col: moveCell(m.col, 'col', entries) };
    return { ...a, from: at(a.from), to: at(a.to) };
  };

  // ── Charts ──────────────────────────────────────────────────────────────────────────────────────────────────────────
  const richText = (rich) => {
    if (!rich) return '';
    return kids(rich, 'p').map((p) => all(p, 't').map(textOf).join('')).filter((s, i, a) => s || a.length === 1).join('\n');
  };
  const cacheOf = (n) => {
    if (!n) return null;
    const pts = [];
    const count = num(val(n, 'ptCount'), 0);
    for (const p of kids(n, 'pt')) { const i = num(p.a.idx, -1); if (i >= 0 && i < 100000) pts[i] = textOf(kid(p, 'v') ?? { text: '', kids: [] }); }
    pts.length = Math.max(pts.length, Math.min(count, 100000));
    return { pts: Array.from(pts, (x) => (x === undefined ? null : x)), fmt: kid(n, 'formatCode') ? textOf(kid(n, 'formatCode')) : null };
  };
  // A c:tx, c:cat, c:val, c:xVal or c:yVal: { f, cache, kind: 'num' | 'str' }; a literal is a cache without f.
  const dataOf = (n, log) => {
    if (!n) return null;
    const ref = kid(n, 'numRef') ?? kid(n, 'strRef') ?? kid(n, 'multiLvlStrRef');
    const lit = kid(n, 'numLit') ?? kid(n, 'strLit');
    const kind = /^num/.test(local((ref ?? lit)?.name ?? '')) ? 'num' : 'str';
    if (ref) {
      const f = kid(ref, 'f') ? textOf(kid(ref, 'f')) : null;
      const multi = local(ref.name) === 'multiLvlStrRef';
      const cache = multi ? cacheOf(kid(kid(ref, 'multiLvlStrCache'), 'lvl')) : cacheOf(kid(ref, 'numCache') ?? kid(ref, 'strCache'));
      return { f: f && moveFormula(f, log), cache, kind, multi };
    }
    if (lit) return { f: null, cache: cacheOf(lit), kind };
    if (kid(n, 'v')) return { f: null, cache: { pts: [textOf(kid(n, 'v'))], fmt: null }, kind: 'str' };
    return null;
  };
  const labelsOf = (d) => d && { val: flag(d, 'showVal'), pct: flag(d, 'showPercent'), cat: flag(d, 'showCatName'), fmt: kid(d, 'numFmt')?.a.formatCode ?? null, pos: val(d, 'dLblPos') ?? null, del: flag(d, 'delete') };
  const TYPES = { barChart: 'bar', lineChart: 'line', pieChart: 'pie', doughnutChart: 'doughnut', scatterChart: 'scatter', areaChart: 'area' };
  // Words for the frame a chart Glaze doesn't draw shows (lib/i18n catalogues).
  const OTHER = { bar3DChart: '3-D chart', line3DChart: '3-D chart', pie3DChart: '3-D chart', area3DChart: '3-D chart', surfaceChart: 'Surface chart', surface3DChart: 'Surface chart',
    radarChart: 'Radar chart', bubbleChart: 'Bubble chart', stockChart: 'Stock chart', ofPieChart: 'Pie chart' };
  const EX = { waterfall: 'Waterfall chart', funnel: 'Funnel chart', treemap: 'Treemap chart', sunburst: 'Sunburst chart', boxWhisker: 'Box and whisker chart', clusteredColumn: 'Histogram',
    paretoLine: 'Pareto chart', regionMap: 'Map chart' };
  const axisOf = (n, theme, log) => {
    const kind = local(n.name);
    const title = kid(n, 'title');
    const sc = kid(n, 'scaling');
    const nf = kid(n, 'numFmt');
    return {
      id: val(n, 'axId'), kind: kind === 'valAx' ? 'val' : kind === 'dateAx' ? 'date' : kind === 'serAx' ? 'ser' : 'cat', pos: val(n, 'axPos') ?? null, cross: val(n, 'crossAx') ?? null,
      deleted: flag(n, 'delete'), reverse: val(sc, 'orientation') === 'maxMin', min: num(val(sc, 'min')), max: num(val(sc, 'max')), log: num(val(sc, 'logBase')),
      major: num(val(n, 'majorUnit')), grid: !!kid(n, 'majorGridlines'), title: title ? titleOf(title, log) : null,
      fmt: nf ? { code: nf.a.formatCode ?? 'General', linked: nf.a.sourceLinked === '1' } : null, between: val(n, 'crossBetween') ?? null,
      labels: val(n, 'tickLblPos') !== 'none', crosses: val(n, 'crosses') ?? null, crossesAt: num(val(n, 'crossesAt')),
      line: shapeOf(kid(n, 'spPr'), theme, null).line,
    };
  };
  // A title: { text } or { f, cache } (a cell's text), or { auto: true } with nothing written in it.
  const titleOf = (n, log) => {
    const tx = kid(n, 'tx');
    if (kid(tx, 'rich')) return { text: richText(kid(tx, 'rich')) };
    if (kid(tx, 'strRef')) { const d = dataOf(tx, log); return { f: d.f, cache: d.cache }; }
    return { auto: true };
  };
  // chartSpace XML → the chart's description. log: wb.keep.log.
  const chart = (xml, theme = DEFAULT_THEME, log = []) => {
    const space = kid(tree(xml), 'chartSpace');
    const ch = kid(space, 'chart');
    const plot = kid(ch, 'plotArea');
    if (!ch || !plot) return { kind: 'frame', type: 'Chart', title: null };
    const titleEl = kid(ch, 'title');
    const title = titleEl ? titleOf(titleEl, log) : null;
    const autoDeleted = flag(ch, 'autoTitleDeleted');
    const legendEl = kid(ch, 'legend');
    const legend = legendEl ? { pos: val(legendEl, 'legendPos') ?? 'r', overlay: flag(legendEl, 'overlay'), hidden: kids(legendEl, 'legendEntry').filter((e) => flag(e, 'delete')).map((e) => num(val(e, 'idx'), -1)) } : null;
    const groups = [], other = [];
    let auto = 0;
    for (const g of plot.kids) {
      const name = local(g.name);
      if (!/Chart$/.test(name)) continue;
      if (!TYPES[name]) { other.push(OTHER[name] ?? 'Chart'); continue; }
      const type = TYPES[name];
      const vary = flag(g, 'varyColors');
      const series = kids(g, 'ser').map((s) => {
        const idx = num(val(s, 'idx'), auto);
        const color = autoColor(idx, theme);
        auto++;
        const sp = shapeOf(kid(s, 'spPr'), theme, color);
        const mk = kid(s, 'marker');
        const mkSp = shapeOf(kid(mk, 'spPr'), theme, color);
        const points = new Map();
        for (const p of kids(s, 'dPt')) { const i = num(val(p, 'idx'), -1); const c = shapeOf(kid(p, 'spPr'), theme, null); if (i >= 0 && (c.fill || c.line)) points.set(i, c.fill && c.fill !== 'none' ? c.fill : c.line); }
        const dl = labelsOf(kid(s, 'dLbls'));
        return {
          idx, order: num(val(s, 'order'), idx), name: dataOf(kid(s, 'tx'), log), color, fill: sp.fill, line: sp.line, width: sp.width,
          cat: dataOf(kid(s, 'cat') ?? kid(s, 'xVal'), log), val: dataOf(kid(s, 'val') ?? kid(s, 'yVal'), log),
          marker: mk ? { symbol: val(mk, 'symbol') ?? null, size: num(val(mk, 'size'), 5), fill: mkSp.fill, line: mkSp.line } : null,
          smooth: flag(s, 'smooth'), points, labels: dl,
        };
      }).sort((a, b) => a.order - b.order);
      groups.push({
        type, dir: val(g, 'barDir') === 'bar' ? 'bar' : 'col', grouping: val(g, 'grouping') ?? (type === 'bar' ? 'clustered' : 'standard'), vary,
        gap: num(val(g, 'gapWidth'), 150), overlap: num(val(g, 'overlap'), null), hole: num(val(g, 'holeSize'), 50), first: num(val(g, 'firstSliceAng'), 0),
        style: val(g, 'scatterStyle') ?? null, markers: kid(g, 'marker') ? flag(g, 'marker') : null, axes: kids(g, 'axId').map((a) => a.a.val), series, labels: labelsOf(kid(g, 'dLbls')),
      });
    }
    const axes = {};
    for (const n of plot.kids) if (/^(valAx|catAx|dateAx|serAx)$/.test(local(n.name))) { const a = axisOf(n, theme, log); axes[a.id] = a; }
    const blanks = val(ch, 'dispBlanksAs') ?? 'gap';
    const out = { kind: 'plot', title, autoDeleted, legend, groups, axes, blanks, visible: flag(ch, 'plotVisOnly', true) };
    // Drawn: one or more of the six on one pair of axes (a pie or doughnut alone); else the titled frame.
    const pairs = new Set(groups.map((g) => g.axes.slice(0, 2).join(',')));
    const round = groups.some((g) => g.type === 'pie' || g.type === 'doughnut');
    if (other.length || !groups.length || pairs.size > 1 || (round && groups.length > 1) || (groups.some((g) => g.type === 'scatter') && groups.length > 1)) {
      return { ...out, kind: 'frame', type: other[0] ?? (groups.length > 1 ? 'Combo chart' : 'Chart') };
    }
    return out;
  };
  // A chartex part (Excel 2016's waterfall, funnel and the rest): only its title and type, for the frame.
  const chartEx = (xml) => {
    const root = tree(xml);
    const layout = all(root, 'series')[0]?.a.layoutId;
    const t = all(root, 'title')[0];
    const text = t ? all(t, 't').map(textOf).join('') : '';
    return { kind: 'frame', type: EX[layout] ?? 'Chart', title: text ? { text } : null };
  };

  // ── The sheet's charts ─────────────────────────────────────────────────────────────────────────────────────────────
  // Parsed parts, by the bytes they are (a part replaced after import reads again).
  const memo = new WeakMap();
  const parsed = (data, make) => {
    if (typeof data === 'string') return make(data);
    let m = memo.get(data);
    if (!m) { m = make(partText(data)); memo.set(data, m); }
    return m;
  };
  // → [{ id, path, anchor, chart }] in the drawing's order (the later ones on top).
  const charts = (wb, sh) => {
    const d = sh?.keep?.drawing;
    const parts = wb?.keep?.parts ?? {};
    const part = d && partOf(parts, d.path);
    if (!part) return [];
    const log = wb.keep.log ?? [];
    const theme = Array.isArray(wb.keep.theme) && wb.keep.theme.length >= 10 ? wb.keep.theme : DEFAULT_THEME;
    const entries = log.filter((e) => e.op === 'shift' && e.sheet === sh.id);
    const rels = parsed(partOf(parts, relsPath(d.path))?.data ?? '', () => relsOf(parts, d.path));
    const out = [];
    for (const [i, a] of parsed(part.data, anchors).entries()) {
      const rel = rels.get(a.rid);
      const cp = rel && partOf(parts, rel.path);
      let c;
      try {
        if (!cp) c = { kind: 'frame', type: 'Chart', title: null };
        else if (a.ex || /chartEx/i.test(rel.type)) c = parsed(cp.data, chartEx);
        else c = log.length ? chart(partText(cp.data), theme, log) : parsed(cp.data, (x) => chart(x, theme, []));
      } catch { c = { kind: 'frame', type: 'Chart', title: null }; }
      out.push({ id: `${d.path}#${i}`, path: rel?.path ?? null, anchor: moveAnchor(a, entries), chart: c, name: a.name || a.descr });
    }
    return out;
  };

  // ── Values ─────────────────────────────────────────────────────────────────────────────────────────────────────────
  // A lookup over a workbook: a c:f's cells, in order, as { t, v, fmt, hidden }, or null when it names no sheet's cells.
  const lookup = (wb) => {
    const cellsOf = (f, depth) => {
      let toks;
      try { toks = F().tokenize(f); } catch { return null; }
      const cells = [];
      for (const t of toks) {
        if (t.k === 'ws' || t.k === '(' || t.k === ')' || t.k === ',') continue;
        if (t.k === 'name') {
          const nm = depth < 4 && (wb.names ?? []).find((x) => x.name.toLowerCase() === t.name.toLowerCase());
          const got = nm ? cellsOf(String(nm.ref).replace(/^=/, ''), depth + 1) : null;
          if (!got) return null;
          cells.push(...got);
          continue;
        }
        if (t.k !== 'ref' || !t.sheet || t.sheet2) return null;
        const sh = M().getSheet(wb, t.sheet);
        if (!sh) return null;
        const r1 = Math.min(t.r1, t.r0 + 100000), c1 = Math.min(t.c1, t.c0 + 1000);
        for (let r = t.r0; r <= r1; r++) for (let c = t.c0; c <= c1; c++) {
          const x = sh.rows.get(r)?.get(c);
          cells.push({ t: x?.t ?? 'z', v: x?.v, fmt: wb.styles?.[x?.s ?? 0]?.fmt ?? null, hidden: !!(sh.hidden?.rows?.has(r) || sh.hidden?.cols?.has(c)) });
        }
        if (cells.length > 100000) return null;
      }
      return cells.length ? cells : null;
    };
    return (f) => cellsOf(f, 0);
  };
  // A cell as a number to plot: text counts 0 as in Excel, blanks and errors are gaps (null).
  const numOf = (x) => (x.t === 'n' ? x.v : x.t === 'b' ? (x.v ? 1 : 0) : x.t === 's' ? 0 : null);
  // A series part read live, else from its cache: { nums, texts, fmt, hidden }.
  const read = (d, look, show) => {
    if (!d) return null;
    const live = d.f ? look(d.f) : null;
    if (live) return { nums: live.map(numOf), texts: live.map((x) => show(x)), fmt: live.find((x) => x.t === 'n')?.fmt ?? null, hidden: live.map((x) => !!x.hidden), live: true };
    const pts = d.cache?.pts ?? [];
    const nums = pts.map((s) => (s === null || s === '' || !Number.isFinite(Number(s)) ? null : Number(s)));
    return { nums, texts: pts.map((s, i) => (s === null ? '' : d.kind === 'num' && d.cache?.fmt && nums[i] !== null ? show({ t: 'n', v: nums[i], fmt: d.cache.fmt }) : s)), fmt: d.cache?.fmt ?? null, hidden: pts.map(() => false), live: false };
  };
  // chart → the values to draw: { title, legend, groups: [{ …group, series: [{ name, cats, vals, xs, color, … }] }], axes }.
  // show(cell) → its shown text (the grid's number formats).
  const resolve = (c, look, show = (x) => (x.v === undefined || x.v === null ? '' : String(x.v))) => {
    if (c.kind !== 'plot') {
      const title = c.title?.text ?? (c.title?.f ? (read({ f: c.title.f, cache: c.title.cache, kind: 'str' }, look, show)?.texts.join(' ') ?? '') : '');
      return { kind: 'frame', type: c.type, title: title || null };
    }
    const groups = c.groups.map((g) => {
      const series = g.series.map((s) => {
        const v = read(s.val, look, show);
        const k = read(s.cat, look, show);
        const n = read(s.name, look, show);
        const len = v ? v.nums.length : 0;
        const keep = [];
        for (let i = 0; i < len; i++) if (!(c.visible && v.hidden[i])) keep.push(i);
        const xsNum = k && g.type === 'scatter' && k.nums.some((x) => x !== null) && (s.cat.kind === 'num' || k.live) && k.nums.every((x, i) => x !== null || k.texts[i] === '');
        return {
          ...s, name: n ? n.texts.join(' ') : '', vals: keep.map((i) => v.nums[i]), cats: k ? keep.map((i) => k.texts[i] ?? '') : null,
          xs: g.type === 'scatter' ? keep.map((i, j) => (xsNum ? k.nums[i] : j + 1)) : null, fmt: v?.fmt ?? null, catFmt: k?.fmt ?? null,
        };
      });
      return { ...g, series };
    });
    const first = groups[0]?.series[0];
    let title = null;
    if (c.title?.text !== undefined) title = c.title.text;
    else if (c.title?.f) title = read({ f: c.title.f, cache: c.title.cache, kind: 'str' }, look, show)?.texts.join(' ') ?? '';
    else if (!c.autoDeleted && groups.length === 1 && groups[0].series.length === 1 && (c.title?.auto || ['pie', 'doughnut'].includes(groups[0].type) || c.title)) title = first?.name || null;
    return { kind: 'plot', title: title || null, legend: c.legend, groups, axes: c.axes, blanks: c.blanks };
  };

  // Every word a frame can show, for the catalogues.
  const WORDS = [...new Set(['Chart', 'Combo chart', ...Object.values(OTHER), ...Object.values(EX)])];

  return { EMU, DEFAULT_THEME, WORDS, tree, anchors, chart, chartEx, charts, lookup, resolve, autoColor, transform, moveFormula, moveAnchor, relsOf, partText };
})();

if (typeof module !== 'undefined') module.exports = GZ_SHEET_CHART_XML; else GZ_SHEET_CHART_XML;
