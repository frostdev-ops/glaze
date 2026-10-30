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
  // The moves a kept part takes now: the log, or for a part Glaze wrote (wb.keep.bases) the log since it did, what has come
  // off it since taken back first (lib/sheet-xlsx.js since, which writes it so).
  const logFor = (wb, path) => {
    const log = wb.keep?.log ?? [], base = wb.keep?.bases?.[path];
    if (!base) return log;
    let k = 0;
    while (k < base.length && k < log.length && JSON.stringify(base[k]) === JSON.stringify(log[k])) k++;
    return [...base.slice(k).reverse().map((e) => (e.op === 'shift' ? { ...e, n: -e.n } : { ...e, from: e.to, to: e.from })), ...log.slice(k)];
  };
  // → [{ id, path, anchor, chart }] in the drawing's order (the later ones on top).
  // The sheet a drawing part is written with: two sheets share one after Duplicate, and the file keeps it with the one it
  // was read from (lib/sheet-xlsx.js write), else the first.
  const owner = (wb, path) => { const all = wb.sheets.filter((x) => x.keep?.drawing?.path === path); return all.find((x) => x.keep.sourceId === x.id) ?? all[0] ?? null; };
  const charts = (wb, sh) => {
    const d = sh?.keep?.drawing;
    if (d && owner(wb, d.path) !== sh) return [];
    const parts = wb?.keep?.parts ?? {};
    const part = d && partOf(parts, d.path);
    if (!part) return [];
    const theme = Array.isArray(wb.keep.theme) && wb.keep.theme.length >= 10 ? wb.keep.theme : DEFAULT_THEME;
    const entries = logFor(wb, d.path).filter((e) => e.op === 'shift' && e.sheet === sh.id);
    const rels = parsed(partOf(parts, relsPath(d.path))?.data ?? '', () => relsOf(parts, d.path));
    const out = [];
    for (const [i, a] of parsed(part.data, anchors).entries()) {
      const rel = rels.get(a.rid);
      const cp = rel && partOf(parts, rel.path);
      let c;
      try {
        if (!cp) c = { kind: 'frame', type: 'Chart', title: null };
        else if (a.ex || /chartEx/i.test(rel.type)) c = parsed(cp.data, chartEx);
        else { const log = logFor(wb, rel.path); c = log.length ? chart(partText(cp.data), theme, log) : parsed(cp.data, (x) => chart(x, theme, [])); }
      } catch { c = { kind: 'frame', type: 'Chart', title: null }; }
      out.push({ id: `${d.path}#${i}`, path: rel?.path ?? null, anchor: moveAnchor(a, entries), chart: c, name: a.name || a.descr });
    }
    return out;
  };

  // ── Values ─────────────────────────────────────────────────────────────────────────────────────────────────────────
  // A lookup over a workbook: a c:f's cells, in order, as { t, v, fmt, hidden }, or null when it names no sheet's cells.
  const lookup = (wb) => {
    const extents = new Map();
    const extent = (sh) => {
      if (!extents.has(sh)) {
        let r = 0, c = 0;
        for (const [ri, row] of sh.rows) if (row.size) { r = Math.max(r, ri); for (const ci of row.keys()) c = Math.max(c, ci); }
        extents.set(sh, { r, c });
      }
      return extents.get(sh);
    };
    const cellsOf = (f, depth, budget) => {
      let toks;
      try { toks = F().tokenize(f); } catch { return null; }
      const cells = [];
      for (const t of toks) {
        if (t.k === 'ws' || t.k === '(' || t.k === ')' || t.k === ',') continue;
        if (t.k === 'name') {
          const nm = depth < 4 && (wb.names ?? []).find((x) => x.name.toLowerCase() === t.name.toLowerCase());
          const got = nm ? cellsOf(String(nm.ref).replace(/^=/, ''), depth + 1, budget) : null;
          if (!got) return null;
          for (const x of got) cells.push(x);
          continue;
        }
        if (t.k !== 'ref' || !t.sheet || t.sheet2) return null;
        const sh = M().getSheet(wb, t.sheet);
        if (!sh) return null;
        // Whole rows/columns stop at the used extent. Explicit ranges stay exact; refuse an oversized rectangle before
        // visiting it, with one shared budget for unions and defined names as well.
        const r1 = t.whole === 'col' ? Math.min(t.r1, extent(sh).r) : t.r1;
        const c1 = t.whole === 'row' ? Math.min(t.c1, extent(sh).c) : t.c1;
        const count = (r1 - t.r0 + 1) * (c1 - t.c0 + 1);
        if (count > budget.left) return null;
        budget.left -= count;
        for (let r = t.r0; r <= r1; r++) for (let c = t.c0; c <= c1; c++) {
          const x = sh.rows.get(r)?.get(c);
          cells.push({ t: x?.t ?? 'z', v: x?.v, fmt: wb.styles?.[x?.s ?? 0]?.fmt ?? null, hidden: !!(sh.hidden?.rows?.has(r) || sh.hidden?.cols?.has(c)) });
        }
      }
      return cells.length ? cells : null;
    };
    return (f) => cellsOf(f, 0, { left: 100000 });
  };
  // A cell as a number to plot: text counts 0 as in Excel, blanks and errors are gaps (null).
  const numOf = (x) => (x.t === 'n' ? x.v : x.t === 'b' ? (x.v ? 1 : 0) : x.t === 's' ? 0 : null);
  // A series part read live, else from its cache: { nums, texts, fmt, hidden }.
  const read = (d, look, show) => {
    if (!d) return null;
    const live = d.f ? look(d.f) : null;
    if (live) return { nums: live.map(numOf), texts: live.map((x) => show(x)), fmt: live.find((x) => x.t === 'n')?.fmt ?? null, hidden: live.map((x) => !!x.hidden), live: true, isNum: live.map((x) => x.t === 'n' || x.t === 'z') };
    const pts = d.cache?.pts ?? [];
    const nums = pts.map((s) => (s === null || s === '' || !Number.isFinite(Number(s)) ? null : Number(s)));
    return { nums, texts: pts.map((s, i) => (s === null ? '' : d.kind === 'num' && d.cache?.fmt && nums[i] !== null ? show({ t: 'n', v: nums[i], fmt: d.cache.fmt }) : s)), fmt: d.cache?.fmt ?? null, hidden: pts.map(() => false), live: false,
      isNum: pts.map((x, i) => d.kind === 'num' || nums[i] !== null || x === null) };
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
        // A scatter's x values are its numbers; text in them counts 1, 2, 3… as in Excel.
        const xsNum = k && g.type === 'scatter' && k.nums.some((x) => x !== null) && k.isNum.every(Boolean);
        return {
          ...s, indices: keep, name: n ? n.texts.join(' ') : '', vals: keep.map((i) => v.nums[i]), cats: k ? keep.map((i) => k.texts[i] ?? '') : null,
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

  // ── Writing a chart (Insert): the parts in Excel's element order ───────────────────────────────────────────────────
  const xesc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  const NS_C = 'http://schemas.openxmlformats.org/drawingml/2006/chart', NS_A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
  const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships', NS_XDR = 'http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing';
  const TYPE_CHART = 'application/vnd.openxmlformats-officedocument.drawingml.chart+xml', TYPE_RELS = 'application/vnd.openxmlformats-package.relationships+xml';
  const pts = (list) => `<c:ptCount val="${list.length}"/>${list.map((v, i) => (v === null || v === undefined || v === '' ? '' : `<c:pt idx="${i}"><c:v>${xesc(v)}</c:v></c:pt>`)).join('')}`;
  const strRef = (d) => `<c:strRef><c:f>${xesc(d.f)}</c:f><c:strCache>${pts(d.texts)}</c:strCache></c:strRef>`;
  const numRef = (d) => `<c:numRef><c:f>${xesc(d.f)}</c:f><c:numCache><c:formatCode>${xesc(d.fmt || 'General')}</c:formatCode>${pts(d.nums.map((v) => (v === null ? null : String(v))))}</c:numCache></c:numRef>`;
  const scheme = (i) => { const mods = VARY[Math.floor(i / 6) % VARY.length].map((m) => `<a:${m.name} val="${m.a.val}"/>`).join(''); return `<a:schemeClr val="accent${(i % 6) + 1}"${mods ? `>${mods}</a:schemeClr>` : '/>'}`; };
  const AX = ['500000001', '500000002'];
  const catAx = (pos, cross, fmt) => `<c:catAx><c:axId val="${AX[0]}"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="${pos}"/><c:numFmt formatCode="${xesc(fmt || 'General')}" sourceLinked="1"/>`
    + `<c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:crossAx val="${cross}"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/></c:catAx>`;
  const valAx = (id, pos, cross, fmt, grid, between) => `<c:valAx><c:axId val="${id}"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="${pos}"/>${grid ? '<c:majorGridlines/>' : ''}`
    + `<c:numFmt formatCode="${xesc(fmt || 'General')}" sourceLinked="1"/><c:majorTickMark val="none"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/><c:crossAx val="${cross}"/><c:crosses val="autoZero"/><c:crossBetween val="${between}"/></c:valAx>`;
  // spec (plan's): { kind: column | bar | line | pie | scatter, date1904, cats: { f, texts, nums, num, fmt } | null, series: [{ name:
  // { f, texts } | null, vals: { f, nums, fmt } }] } → chartSpace XML.
  const build = (spec) => {
    const { kind, series } = spec;
    const tx = (s) => (s.name ? `<c:tx>${strRef(s.name)}</c:tx>` : '');
    const cat = (tag) => (spec.cats ? `<c:${tag}>${spec.cats.num ? numRef({ ...spec.cats, nums: spec.cats.nums }) : strRef(spec.cats)}</c:${tag}>` : '');
    const head = (s, i) => `<c:idx val="${i}"/><c:order val="${i}"/>${tx(s)}`;
    let plot;
    if (kind === 'column' || kind === 'bar') {
      plot = `<c:barChart><c:barDir val="${kind === 'bar' ? 'bar' : 'col'}"/><c:grouping val="clustered"/><c:varyColors val="0"/>`
        + series.map((s, i) => `<c:ser>${head(s, i)}<c:spPr><a:solidFill>${scheme(i)}</a:solidFill><a:ln><a:noFill/></a:ln></c:spPr><c:invertIfNegative val="0"/>${cat('cat')}<c:val>${numRef(s.vals)}</c:val></c:ser>`).join('')
        + `<c:gapWidth val="${kind === 'bar' ? 182 : 219}"/><c:overlap val="-27"/><c:axId val="${AX[0]}"/><c:axId val="${AX[1]}"/></c:barChart>`
        + catAx(kind === 'bar' ? 'l' : 'b', AX[1], spec.cats?.fmt) + valAx(AX[1], kind === 'bar' ? 'b' : 'l', AX[0], series[0]?.vals.fmt, true, 'between');
    } else if (kind === 'line') {
      plot = '<c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/>'
        + series.map((s, i) => `<c:ser>${head(s, i)}<c:spPr><a:ln w="28575" cap="rnd"><a:solidFill>${scheme(i)}</a:solidFill><a:round/></a:ln></c:spPr><c:marker><c:symbol val="none"/></c:marker>${cat('cat')}<c:val>${numRef(s.vals)}</c:val><c:smooth val="0"/></c:ser>`).join('')
        + `<c:marker val="1"/><c:axId val="${AX[0]}"/><c:axId val="${AX[1]}"/></c:lineChart>`
        + catAx('b', AX[1], spec.cats?.fmt) + valAx(AX[1], 'l', AX[0], series[0]?.vals.fmt, true, 'between');
    } else if (kind === 'pie') {
      const s = series[0];
      plot = `<c:pieChart><c:varyColors val="1"/><c:ser>${head(s, 0)}`
        + s.vals.nums.map((_, i) => `<c:dPt><c:idx val="${i}"/><c:bubble3D val="0"/><c:spPr><a:solidFill>${scheme(i)}</a:solidFill><a:ln w="19050"><a:solidFill><a:schemeClr val="lt1"/></a:solidFill></a:ln></c:spPr></c:dPt>`).join('')
        + `${cat('cat')}<c:val>${numRef(s.vals)}</c:val></c:ser><c:firstSliceAng val="0"/></c:pieChart>`;
    } else {
      plot = '<c:scatterChart><c:scatterStyle val="lineMarker"/><c:varyColors val="0"/>'
        + series.map((s, i) => `<c:ser>${head(s, i)}<c:spPr><a:ln w="25400" cap="rnd"><a:noFill/><a:round/></a:ln></c:spPr><c:marker><c:symbol val="circle"/><c:size val="5"/><c:spPr><a:solidFill>${scheme(i)}</a:solidFill><a:ln w="9525"><a:solidFill>${scheme(i)}</a:solidFill></a:ln></c:spPr></c:marker>`
          + `${spec.cats ? `<c:xVal>${spec.cats.num ? numRef(spec.cats) : strRef(spec.cats)}</c:xVal>` : ''}<c:yVal>${numRef(s.vals)}</c:yVal><c:smooth val="0"/></c:ser>`).join('')
        + `<c:axId val="${AX[0]}"/><c:axId val="${AX[1]}"/></c:scatterChart>`
        + valAx(AX[0], 'b', AX[1], spec.cats?.fmt, false, 'midCat') + valAx(AX[1], 'l', AX[0], series[0]?.vals.fmt, true, 'midCat');
    }
    const one = series.length === 1;
    const legend = !one || kind === 'pie' ? '<c:legend><c:legendPos val="b"/><c:overlay val="0"/></c:legend>' : '';
    return `${HEAD}<c:chartSpace xmlns:c="${NS_C}" xmlns:a="${NS_A}" xmlns:r="${NS_R}"><c:date1904 val="${spec.date1904 ? 1 : 0}"/><c:lang val="en-US"/><c:roundedCorners val="0"/>`
      + `<c:chart>${one && series[0].name ? '<c:title><c:overlay val="0"/></c:title><c:autoTitleDeleted val="0"/>' : '<c:autoTitleDeleted val="1"/>'}<c:plotArea><c:layout/>${plot}</c:plotArea>${legend}`
      + '<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart></c:chartSpace>';
  };
  // A two-cell anchor: from and to as { col, colOff, row, rowOff } (offsets in px). body: the graphic frame's XML.
  const cellXml = (tag, m, p) => `<${p}${tag}><${p}col>${m.col}</${p}col><${p}colOff>${Math.round(m.colOff * EMU)}</${p}colOff><${p}row>${m.row}</${p}row><${p}rowOff>${Math.round(m.rowOff * EMU)}</${p}rowOff></${p}${tag}>`;
  const frameXml = (id, name, rid, p) => `<${p}graphicFrame macro=""><${p}nvGraphicFramePr><${p}cNvPr id="${id}" name="${xesc(name)}"/><${p}cNvGraphicFramePr/></${p}nvGraphicFramePr>`
    + `<${p}xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></${p}xfrm><a:graphic><a:graphicData uri="${NS_C}"><c:chart xmlns:c="${NS_C}" xmlns:r="${NS_R}" r:id="${rid}"/></a:graphicData></a:graphic></${p}graphicFrame>`;
  const anchorXml = (from, to, body, p, attrs = '') => `<${p}twoCellAnchor${attrs}>${cellXml('from', from, p)}${cellXml('to', to, p)}${body}<${p}clientData/></${p}twoCellAnchor>`;
  // The chart anchors of a drawing's XML, as anchors() finds them: { at, end, body (the graphic's XML), prefix, attrs }.
  const spans = (xml) => {
    const d = D(), out = [];
    let depth = 0, cur = null;
    for (const tk of d.tokens(xml)) {
      if (!tk.name) continue;
      if (tk.close) {
        depth--;
        if (depth === 1 && cur && tk.name === cur.name) { cur.end = tk.end; if (anchors(`<wsDr>${xml.slice(cur.at, cur.end)}</wsDr>`).length) out.push(cur); cur = null; }
        continue;
      }
      if (depth === 1 && /(?:^|:)(twoCellAnchor|oneCellAnchor|absoluteAnchor)$/.test(tk.name)) cur = { name: tk.name, at: tk.at, prefix: tk.name.slice(0, tk.name.lastIndexOf(':') + 1), attrs: tk.attrs.replace(/\/\s*$/, '') };
      if (!tk.empty) depth++;
    }
    // Each anchor's graphic: everything between its from/to/ext/pos and its clientData.
    for (const s of out) {
      const inner = xml.slice(s.at, s.end);
      const body = [];
      let dd = 0, start = -1;
      for (const tk of d.tokens(inner)) {
        if (!tk.name) continue;
        if (tk.close) { dd--; if (dd === 1 && start >= 0) { body.push(inner.slice(start, tk.end)); start = -1; } continue; }
        if (dd === 1 && !/^(from|to|ext|pos|clientData)$/.test(local(tk.name))) { if (tk.empty) body.push(inner.slice(tk.at, tk.end)); else start = tk.at; }
        if (!tk.empty) dd++;
      }
      s.body = body.join('');
    }
    return out;
  };
  // The drawing's XML with a chart anchor added at its end, and the cNvPr id it takes.
  const addAnchor = (xml, from, to, rid, name) => {
    const ids = [...xml.matchAll(/<(?:\w+:)?cNvPr\b[^>]*?\sid="(\d+)"/g)].map((m) => Number(m[1]));
    const id = Math.max(1, ...ids) + 1;
    const rootOpen = /<((?:\w+:)?wsDr)\b([^>]*?)(\/?)>/.exec(xml);
    if (!rootOpen) return null;
    const p = rootOpen[1].slice(0, rootOpen[1].lastIndexOf(':') + 1);
    const declared = new RegExp(`xmlns${p ? `:${p.slice(0, -1)}` : ''}="${NS_XDR}"`).test(rootOpen[2]) && /xmlns:a="http:\/\/schemas\.openxmlformats\.org\/drawingml\/2006\/main"/.test(rootOpen[2]);
    const attrs = declared ? '' : ` xmlns:xdr="${NS_XDR}" xmlns:a="${NS_A}"`;
    const q = declared ? p : 'xdr:';
    const one = anchorXml(from, to, frameXml(id, name || `Chart ${id - 1}`, rid, q), q, attrs);
    if (rootOpen[3]) return xml.replace(rootOpen[0], `<${rootOpen[1]}${rootOpen[2]}>${one}</${rootOpen[1]}>`);
    const close = xml.lastIndexOf(`</${rootOpen[1]}>`);
    return close < 0 ? null : xml.slice(0, close) + one + xml.slice(close);
  };
  // The drawing's XML with chart anchor i at new cells (made a two-cell anchor), or taken out (to null).
  const setAnchor = (xml, i, from, to) => {
    const s = spans(xml)[i];
    if (!s) return null;
    if (!from) return xml.slice(0, s.at) + xml.slice(s.end);
    const attrs = s.name.endsWith('twoCellAnchor') ? s.attrs : '';
    return xml.slice(0, s.at) + anchorXml(from, to, s.body, s.prefix, attrs) + xml.slice(s.end);
  };
  const relsXml = (list) => `${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${list.map((r) => `<Relationship Id="${xesc(r.id)}" Type="${xesc(r.type)}" Target="${xesc(r.target)}"${r.mode ? ` TargetMode="${xesc(r.mode)}"` : ''}/>`).join('')}</Relationships>`;
  // A rels part's relationships as written: [{ id, type, target, mode }].
  const relList = (xml) => kids(kid(tree(xml || ''), 'Relationships'), 'Relationship').map((r) => ({ id: r.a.Id, type: r.a.Type, target: r.a.Target, ...(r.a.TargetMode && { mode: r.a.TargetMode }) }));

  // ── What a selection charts (Insert) ───────────────────────────────────────────────────────────────────────────────
  // sh's cells in g (a range) as Excel reads them for a chart: series down the columns when there are at least as many
  // rows as columns (else along the rows), names from a header of text, categories (a scatter's x values) from a first
  // column of text or dates, or any first column when its header is blank. show(cell) → its shown text.
  // → the spec build() takes, or null when there's no number to chart.
  const plan = (wb, sh, g, kind, show) => {
    const cell = (r, c) => sh.rows.get(r)?.get(c) ?? null;
    const NFm = dep('GZ_SHEET_NUMFMT', './sheet-numfmt.js');
    const fmtOf = (x) => { const f = wb.styles?.[x?.s ?? 0]?.fmt; return f === undefined || f === null ? 'General' : NFm.code(f); };
    const isNum = (x) => x?.t === 'n', isText = (x) => x?.t === 's' && x.v !== '', blank = (x) => !x || x.t === 'z' || (x.t === 's' && x.v === '');
    const isDate = (x) => isNum(x) && NFm.isDate(fmtOf(x));
    const byCol = g.r1 - g.r0 >= g.c1 - g.c0;
    const nI = byCol ? g.r1 - g.r0 + 1 : g.c1 - g.c0 + 1, nJ = byCol ? g.c1 - g.c0 + 1 : g.r1 - g.r0 + 1;
    const at = (i, j) => (byCol ? [g.r0 + i, g.c0 + j] : [g.r0 + j, g.c0 + i]);
    const T = (i, j) => cell(...at(i, j));
    // Names: a first line (row, or column) of text and blanks above numbers.
    let named = nI > 1;
    for (let j = 0; j < nJ && named; j++) if (isNum(T(0, j)) && !(j === 0 && isDate(T(0, j)))) named = false;
    if (named) { let text = false; for (let j = 0; j < nJ; j++) if (isText(T(0, j))) text = true; named = text; }
    const i0 = named ? 1 : 0;
    let catLine = false;
    if (nJ > 1) {
      if (kind === 'scatter') catLine = true;
      else {
        for (let i = i0; i < nI; i++) if (isText(T(i, 0)) || isDate(T(i, 0))) catLine = true;
        if (named && blank(T(0, 0))) catLine = true;
      }
    }
    const j0 = catLine ? 1 : 0;
    const ref = (i, j, i2, j2) => { const [r0, c0] = at(i, j), [r1, c1] = at(i2, j2); return `${F().sheetPrefix(sh.name)}${M().rangeName(r0, c0, r1, c1).replace(/([A-Z]+)(\d+)/g, '$$$1$$$2')}`; };
    const line = (j) => Array.from({ length: nI - i0 }, (_, k) => T(i0 + k, j));
    const series = [];
    for (let j = j0; j < nJ; j++) {
      const xs = line(j);
      if (!xs.some(isNum)) continue;
      const first = xs.find(isNum);
      series.push({ name: named ? { f: ref(0, j, 0, j), texts: [show(T(0, j)) ?? ''] } : null, vals: { f: ref(i0, j, nI - 1, j), nums: xs.map((x) => (isNum(x) ? x.v : null)), fmt: fmtOf(first) } });
      if (kind === 'pie') break;
    }
    if (!series.length || nI - i0 < 1) return null;
    let cats = null;
    if (catLine) {
      const xs = line(0), num = xs.every((x) => blank(x) || isNum(x));
      cats = { f: ref(i0, 0, nI - 1, 0), texts: xs.map((x) => (blank(x) ? '' : show(x) ?? '')), nums: xs.map((x) => (isNum(x) ? x.v : null)), num, fmt: fmtOf(xs.find(isNum)) };
    }
    return { kind, date1904: !!wb.date1904, cats, series };
  };

  // Every word a frame can show, for the catalogues.
  const WORDS = [...new Set(['Chart', 'Combo chart', ...Object.values(OTHER), ...Object.values(EX)])];

  return { EMU, DEFAULT_THEME, WORDS, logFor, owner, TYPE_CHART, TYPE_RELS, build, plan, spans, addAnchor, setAnchor, relsXml, relList, tree, anchors, chart, chartEx, charts, lookup, resolve, autoColor, transform, moveFormula, moveAnchor, relsOf, partText };
})();

if (typeof module !== 'undefined') module.exports = GZ_SHEET_CHART_XML; else GZ_SHEET_CHART_XML;
