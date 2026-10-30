// A sheet's charts drawn on the grid (sheet-grid.js): scene() lays a resolved chart (lib/sheet-chart-xml.js resolve) out
// in a w×h box as plain shapes (pure, for node: bars, lines, areas, pies and doughnuts, scatter, axes with nice ticks,
// titles, the legend), svg() builds them with DOM calls, and layer() keeps a chart layer in each of the grid's panes, each
// chart at its anchor's cells, moving and sizing with them and with the frozen panes, drawn again a moment after the
// cells it reads change. The chart's own colours draw its data; its text, axes and ground take the Look (sheet.css
// .gc-*). A chart Glaze doesn't draw is a frame with its title and kind. Nothing here writes the file's chart parts.
// Classic script, loaded with the grid (sheet-kind.js); module.exports for node.
var GZ_SHEET_CHART = globalThis.GZ_SHEET_CHART || (() => {
  const dep = (name, file) => (typeof globalThis[name] !== 'undefined' ? globalThis[name] : typeof module !== 'undefined' ? require(file) : null);
  const CX = () => dep('GZ_SHEET_CHART_XML', './sheet-chart-xml.js');
  const NF = () => dep('GZ_SHEET_NUMFMT', './sheet-numfmt.js');
  const SVG = 'http://www.w3.org/2000/svg';
  const P = 8, TITLE = 14, TICK = 10, LEG = 11, ATITLE = 11;

  // ── Measures ────────────────────────────────────────────────────────────────────────────────────────────────────────
  // Text's width, estimated (the same in node and every browser, so a layout is one answer).
  const width = (s, size) => { let w = 0; for (const ch of String(s)) w += /[ilj.,:;'!|]/.test(ch) ? 0.3 : /[mwMW@]/.test(ch) ? 0.85 : /[A-Z0-9%$]/.test(ch) ? 0.62 : 0.52; return w * size; };
  const fit = (s, max, size) => {
    s = String(s ?? '');
    if (width(s, size) <= max + 0.5) return s;
    let out = '';
    for (const ch of s) { if (width(`${out}${ch}…`, size) > max) break; out += ch; }
    return out ? `${out}…` : '';
  };
  const round = (x) => Math.round(x * 100) / 100;
  const clean = (x) => Number(x.toPrecision(12));
  const format = (v, code) => { if (v === null || v === undefined) return ''; try { return NF().format(v, code || 'General', {}) ?? String(v); } catch { return String(v); } };

  // An axis's scale: Excel's rule (from 0 unless the values sit within a sixth of their top, 5% of room past them), steps
  // of 1, 2 or 5 a power of ten as many as `len` px holds at `gap` px apart, the file's min, max and major unit where set.
  const step = (span, n) => { const raw = span / Math.max(1, n), p = 10 ** Math.floor(Math.log10(raw)), f = raw / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p; };
  const scale = (lo, hi, len, gap = 28, ax = {}) => {
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) { lo = 0; hi = 1; }
    if (ax.min !== null && ax.min !== undefined) lo = ax.min;
    if (ax.max !== null && ax.max !== undefined) hi = ax.max;
    if (lo > hi) [lo, hi] = [hi, lo];
    const fixedMin = ax.min !== null && ax.min !== undefined, fixedMax = ax.max !== null && ax.max !== undefined;
    if (!fixedMin && lo > 0 && (hi - lo) / hi >= 1 / 6) lo = 0;
    if (!fixedMax && hi < 0 && (hi - lo) / -lo >= 1 / 6) hi = 0;
    const flat = lo === hi;
    if (flat) { if (lo === 0) hi = 1; else if (lo > 0) lo = fixedMin ? lo : 0; else hi = fixedMax ? hi : 0; if (lo === hi) hi = lo + 1; }
    // Excel's room past the values: 5% of their span beyond the furthest from 0.
    const span = hi - lo;
    if (!flat && !fixedMax && hi > 0) hi += span * 0.05;
    if (!flat && !fixedMin && lo < 0) lo -= span * 0.05;
    const n = Math.max(1, Math.min(10, Math.floor(len / gap)));
    const st = ax.major > 0 ? ax.major : step(hi - lo, n);
    const min = fixedMin ? lo : clean(Math.floor(lo / st + 1e-9) * st), max0 = fixedMax ? hi : clean(Math.ceil(hi / st - 1e-9) * st);
    const max = max0 > min ? max0 : min + st;
    const ticks = [];
    for (let k = 0; k <= 200; k++) { const v = clean(min + k * st); if (v > max + st * 1e-9) break; ticks.push(v); }
    return { min, max, step: st, ticks };
  };

  // ── The scene ──────────────────────────────────────────────────────────────────────────────────────────────────────
  // data: resolve()'s; opts: { t (words), dark }. → { prims: [{ el, a, cls, text, tip }], marks } (marks: the geometry the
  // tests read: bars, points, slices, ticks, legend, title).
  const scene = (data, w, h, opts = {}) => {
    const t = opts.t || ((s) => s);
    const prims = [], marks = { bars: [], points: [], slices: [], ticks: { val: [], cat: [], x: [] }, legend: [], title: null, areas: [], lines: [] };
    const add = (el, a, cls, text, tip) => { prims.push({ el, a, cls: cls || null, text: text ?? null, tip: tip ?? null }); return prims[prims.length - 1]; };
    add('rect', { x: 0.5, y: 0.5, width: Math.max(0, w - 1), height: Math.max(0, h - 1), rx: 3 }, data.kind === 'frame' ? 'gc-bg gc-frame' : 'gc-bg');
    let top = P, left = P, right = w - P, bottom = h - P;
    const titleLines = (s, size) => {
      const max = right - left, words = String(s).split(/\s+/), out = [];
      let line = '';
      for (const word of words) { const next = line ? `${line} ${word}` : word; if (width(next, size) > max && line) { out.push(line); line = word; } else line = next; }
      if (line) out.push(line);
      return out.slice(0, 2).map((l, i, a) => (i === a.length - 1 && out.length > 2 ? fit(`${l} ${out.slice(2).join(' ')}`, max, size) : fit(l, max, size)));
    };
    if (data.title) {
      const lines = titleLines(data.title, TITLE);
      lines.forEach((l, i) => add('text', { x: round(w / 2), y: round(top + TITLE * (i + 1)), 'text-anchor': 'middle' }, 'gc-title', l));
      marks.title = lines.join(' ');
      top += lines.length * (TITLE + 3) + 6;
    }
    if (data.kind === 'frame') {
      const word = t(data.type || 'Chart');
      add('text', { x: round(w / 2), y: round(Math.max(top + LEG, (top + bottom) / 2 + LEG / 2)), 'text-anchor': 'middle' }, 'gc-kind', fit(word, right - left, LEG));
      marks.kind = word;
      return { prims, marks };
    }
    const groups = data.groups.filter((g) => g.series.length);
    if (!groups.length) return { prims, marks };
    const round1 = groups[0].type === 'pie' || groups[0].type === 'doughnut';
    const pointColor = (g, s, i) => s.points?.get(i) ?? (g.vary || round1 ? CX().autoColor(i, opts.theme || CX().DEFAULT_THEME) : null) ?? fillOf(s);
    const fillOf = (s) => (s.fill && s.fill !== 'none' ? s.fill : s.color);
    const lineOf = (s) => (s.line && s.line !== 'none' ? s.line : s.color);

    // The legend: categories for a pie (and a series of varied colours), else series.
    const legend = data.legend;
    if (legend && w > 120 && h > 80) {
      const g = groups[0];
      const vary = round1 || (g.vary && g.series.length === 1);
      const s0 = g.series[0];
      let items = vary ? (s0.cats ?? s0.vals.map((_, i) => String(i + 1))).map((name, i) => ({ name, color: pointColor(g, s0, i), i }))
        : groups.flatMap((gg) => gg.series.map((s) => ({ name: s.name || t('Series {n}', { n: s.idx + 1 }), color: gg.type === 'line' || gg.type === 'scatter' ? lineOf(s) : fillOf(s), i: s.idx, line: gg.type === 'line' || gg.type === 'scatter' })));
      items = items.filter((x) => !legend.hidden?.includes(x.i));
      const side = legend.pos === 'r' || legend.pos === 'l' || legend.pos === 'tr';
      if (side) {
        const lw = Math.min((right - left) * 0.38, Math.max(...items.map((x) => width(x.name, LEG))) + 18);
        const rows = Math.max(1, Math.min(items.length, Math.floor((bottom - top) / 16)));
        const y0 = (top + bottom) / 2 - (rows * 16) / 2;
        const x0 = legend.pos === 'l' ? left : right - lw;
        items.slice(0, rows).forEach((x, k) => {
          const y = y0 + k * 16;
          add('rect', { x: round(x0), y: round(y + 3), width: 9, height: 9, fill: x.color }, 'gc-swatch');
          const text = fit(x.name, lw - 14, LEG);
          add('text', { x: round(x0 + 14), y: round(y + 11.5) }, 'gc-leg', text);
          marks.legend.push(text);
        });
        if (legend.pos === 'l') left += lw + 8; else right -= lw + 8;
      } else {
        const lines = [[]];
        let lineW = 0;
        for (const x of items) {
          const iw = Math.min(width(x.name, LEG), (right - left) * 0.6) + 22;
          if (lineW + iw > right - left && lines[lines.length - 1].length) { lines.push([]); lineW = 0; }
          lines[lines.length - 1].push({ ...x, iw }); lineW += iw;
        }
        const shown = lines.slice(0, 2);
        const lh = shown.length * 16;
        const y0 = legend.pos === 't' ? top : bottom - lh;
        shown.forEach((line, k) => {
          const total = line.reduce((n, x) => n + x.iw, 0);
          let x0 = (left + right) / 2 - total / 2;
          for (const x of line) {
            const y = y0 + k * 16;
            add('rect', { x: round(x0), y: round(y + 3), width: 9, height: 9, fill: x.color }, 'gc-swatch');
            const text = fit(x.name, x.iw - 22, LEG);
            add('text', { x: round(x0 + 14), y: round(y + 11.5) }, 'gc-leg', text);
            marks.legend.push(text);
            x0 += x.iw;
          }
        });
        if (legend.pos === 't') top += lh + 6; else bottom -= lh + 6;
      }
    }
    if (right - left < 16 || bottom - top < 16) return { prims, marks };

    // ── Pies and doughnuts: the first series a pie, every series a ring (the first innermost) ──
    if (round1) {
      const g = groups[0];
      const cx = (left + right) / 2, cy = (top + bottom) / 2, r = Math.max(4, Math.min(right - left, bottom - top) / 2 - 2);
      const rings = g.type === 'pie' ? [g.series[0]] : g.series;
      const inner = g.type === 'pie' ? 0 : r * Math.max(10, Math.min(90, g.hole)) / 100;
      const band = (r - inner) / rings.length;
      const at = (deg, rad) => [round(cx + rad * Math.sin((deg * Math.PI) / 180)), round(cy - rad * Math.cos((deg * Math.PI) / 180))];
      rings.forEach((s, k) => {
        const r1 = inner + band * (k + 1), r0 = inner + band * k;
        const vals = s.vals.map((v) => (v === null ? 0 : Math.abs(v)));
        const total = vals.reduce((n, v) => n + v, 0);
        if (!total) return;
        let a = g.first || 0;
        vals.forEach((v, i) => {
          if (!v) return;
          const a1 = a + (v / total) * 360, color = pointColor(g, s, i);
          const large = a1 - a > 180 ? 1 : 0;
          const tip = `${s.cats?.[i] ?? i + 1}: ${format(s.vals[i], s.fmt)}`;
          if (v === total) {
            if (r0 > 0) add('path', { d: `M${cx - r1} ${cy}a${r1} ${r1} 0 1 0 ${2 * r1} 0a${r1} ${r1} 0 1 0 ${-2 * r1} 0ZM${cx - r0} ${cy}a${r0} ${r0} 0 1 1 ${2 * r0} 0a${r0} ${r0} 0 1 1 ${-2 * r0} 0Z`, fill: color, 'fill-rule': 'evenodd' }, 'gc-slice', null, tip);
            else add('circle', { cx: round(cx), cy: round(cy), r: round(r1), fill: color }, 'gc-slice', null, tip);
          } else {
            const [x0, y0] = at(a, r1), [x1, y1] = at(a1, r1);
            const d = r0 > 0
              ? `M${x0} ${y0}A${round(r1)} ${round(r1)} 0 ${large} 1 ${x1} ${y1}L${at(a1, r0).join(' ')}A${round(r0)} ${round(r0)} 0 ${large} 0 ${at(a, r0).join(' ')}Z`
              : `M${round(cx)} ${round(cy)}L${x0} ${y0}A${round(r1)} ${round(r1)} 0 ${large} 1 ${x1} ${y1}Z`;
            add('path', { d, fill: color }, 'gc-slice', null, tip);
          }
          marks.slices.push({ ring: k, i, a0: round(a), a1: round(a1), color });
          const lab = s.labels ?? g.labels;
          if (lab && !lab.del && (lab.val || lab.pct || lab.cat) && a1 - a >= 12) {
            const mid = (a + a1) / 2, [lx, ly] = at(mid, r0 > 0 ? (r0 + r1) / 2 : r1 * 0.66);
            const text = [lab.cat ? s.cats?.[i] : null, lab.val ? format(s.vals[i], lab.fmt || s.fmt) : null, lab.pct ? format(v / total, lab.fmt && /%/.test(lab.fmt) ? lab.fmt : '0%') : null].filter(Boolean).join(' ');
            add('text', { x: lx, y: round(ly + 4), 'text-anchor': 'middle' }, 'gc-plabel', text);
          }
          a = a1;
        });
      });
      return { prims, marks };
    }

    // ── Cartesian: one pair of axes ──
    const axList = Object.values(data.axes || {});
    const scatter = groups[0].type === 'scatter';
    const horiz = groups[0].type === 'bar' && groups[0].dir === 'bar';
    const valAx = axList.find((a) => a.kind === 'val' && (!scatter || a.pos === 'l' || a.pos === 'r')) ?? axList.find((a) => a.kind === 'val') ?? { kind: 'val', grid: true };
    const catAx = scatter ? (axList.find((a) => a.kind === 'val' && a !== valAx) ?? { kind: 'val' }) : (axList.find((a) => a.kind === 'cat' || a.kind === 'date') ?? { kind: 'cat' });
    const n = Math.max(1, ...groups.flatMap((g) => g.series.map((s) => s.vals.length)));
    const catsOf = groups.flatMap((g) => g.series).find((s) => s.cats?.some((c) => c !== ''))?.cats;
    const cats = Array.from({ length: n }, (_, i) => catsOf?.[i] ?? String(i + 1));
    // Each group's values as drawn: stacked ones on the ones before, 100% ones over the category's total.
    const stacks = groups.map((g) => {
      const stacked = g.grouping === 'stacked' || g.grouping === 'percentStacked';
      const pct = g.grouping === 'percentStacked';
      const totals = Array.from({ length: n }, (_, i) => g.series.reduce((m, s) => m + Math.abs(s.vals[i] ?? 0), 0));
      const pos = new Array(n).fill(0), neg = new Array(n).fill(0);
      return g.series.map((s) => s.vals.map((v0, i) => {
        if (v0 === null || v0 === undefined) return null;
        let v = v0;
        if (pct) v = totals[i] ? v0 / totals[i] : 0;
        if (!stacked) return { lo: 0, hi: v, v: v0 };
        const base = v >= 0 ? pos : neg;
        const lo = base[i], hi = base[i] + v;
        base[i] = hi;
        return { lo, hi, v: v0 };
      }));
    });
    const anyPct = groups.some((g) => g.grouping === 'percentStacked');
    let lo = Infinity, hi = -Infinity;
    stacks.forEach((ss, gi) => ss.forEach((pts) => pts.forEach((p) => {
      if (!p) return;
      const stacked = groups[gi].grouping !== 'standard' && groups[gi].grouping !== 'clustered';
      for (const v of stacked ? [p.lo, p.hi] : [p.hi]) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    })));
    if (groups.some((g) => g.type === 'bar' || g.type === 'area') && Number.isFinite(lo)) { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
    if (anyPct && Number.isFinite(hi)) { hi = Math.max(hi, 1e-9) > 0 ? 1 : hi; lo = lo < 0 ? -1 : 0; }
    const valFmt = valAx.fmt && !valAx.fmt.linked ? valAx.fmt.code : anyPct ? '0%' : (groups[0].series[0].fmt || valAx.fmt?.code || 'General');
    const catFmt = catAx.fmt && !catAx.fmt.linked ? catAx.fmt.code : (groups[0].series[0].catFmt || catAx.fmt?.code || 'General');

    // Room for the axes' words, then the plot.
    const vTitle = valAx.title && !valAx.deleted ? (valAx.title.text ?? '') : '', cTitle = catAx.title && !catAx.deleted ? (catAx.title.text ?? '') : '';
    let xScale = null, xLo = 0, xHi = 1;
    if (scatter) {
      const all = groups.flatMap((g) => g.series.flatMap((s) => s.xs.filter((x) => x !== null && Number.isFinite(x))));
      if (all.length) { xLo = Math.min(...all); xHi = Math.max(...all); }
    }
    // A first scale to measure its labels, then the final one in the room left.
    const vLen0 = horiz ? right - left : bottom - top;
    let vs = scale(lo, hi, vLen0, horiz ? 64 : 28, anyPct ? { ...valAx, min: valAx.min ?? lo, max: valAx.max ?? hi } : valAx);
    const vLabels = (s) => s.ticks.map((v) => format(v, valFmt));
    const showV = !valAx.deleted && valAx.labels !== false, showC = !catAx.deleted && catAx.labels !== false;
    if (vTitle) { if (horiz) bottom -= ATITLE + 6; else left += ATITLE + 6; }
    if (cTitle) { if (horiz) left += ATITLE + 6; else bottom -= ATITLE + 6; }
    if (horiz) {
      if (showV) bottom -= TICK + 6;
      if (showC) left += Math.min((right - left) * 0.4, Math.max(...cats.map((c) => width(format(c, catFmt), TICK)))) + 6;
    } else {
      if (showV) left += Math.max(...vLabels(vs).map((s) => width(s, TICK))) + 6;
      if (showC) bottom -= TICK + 6;
    }
    if (right - left < 12 || bottom - top < 12) return { prims, marks };
    vs = scale(lo, hi, horiz ? right - left : bottom - top, horiz ? 64 : 28, anyPct ? { ...valAx, min: valAx.min ?? lo, max: valAx.max ?? hi } : valAx);
    if (scatter) xScale = scale(xLo, xHi, right - left, 56, catAx);
    const vRev = !!valAx.reverse, cRev = !!catAx.reverse;
    // Value → px along the value axis; category index → px of its band's start along the category axis.
    const vpx = (v) => {
      const f = (v - vs.min) / (vs.max - vs.min);
      return horiz ? left + (vRev ? 1 - f : f) * (right - left) : bottom - (vRev ? 1 - f : f) * (bottom - top);
    };
    const cLen = horiz ? bottom - top : right - left;
    const mid = !scatter && !groups.some((g) => g.type === 'bar') && (valAx.between === 'midCat' || (!valAx.between && groups.every((g) => g.type === 'area')));
    const band = mid && n > 1 ? cLen / (n - 1) : cLen / n;
    const cpx = (i, f = 0.5) => {
      const k = cRev ? n - 1 - i : i;
      const along = mid ? k * band : (k + f) * band;
      return horiz ? bottom - along : left + along;
    };
    const xpx = (x) => left + ((x - xScale.min) / (xScale.max - xScale.min)) * (right - left);
    // Gridlines and the value axis's labels.
    vs.ticks.forEach((v) => {
      const p = round(vpx(v));
      if (valAx.grid !== false && (valAx.grid || !data.axes || !Object.keys(data.axes).length)) add('line', horiz ? { x1: p, y1: round(top), x2: p, y2: round(bottom) } : { x1: round(left), y1: p, x2: round(right), y2: p }, 'gc-grid');
      if (showV) add('text', horiz ? { x: p, y: round(bottom + TICK + 3), 'text-anchor': 'middle' } : { x: round(left - 5), y: round(p + TICK / 2 - 1), 'text-anchor': 'end' }, 'gc-tick', format(v, valFmt));
      marks.ticks.val.push(v);
    });
    if (scatter) {
      xScale.ticks.forEach((x) => {
        const p = round(xpx(x));
        if (catAx.grid) add('line', { x1: p, y1: round(top), x2: p, y2: round(bottom) }, 'gc-grid');
        if (showC) add('text', { x: p, y: round(bottom + TICK + 3), 'text-anchor': 'middle' }, 'gc-tick', format(x, catFmt));
        marks.ticks.x.push(x);
      });
    }
    // The category axis's line where the values are 0 (or the scale's edge), and its labels, thinned to fit.
    const zero = Math.min(Math.max(0, vs.min), vs.max);
    const base = round(vpx(valAx.crossesAt ?? (vs.min > 0 ? vs.min : vs.max < 0 ? vs.max : zero)));
    if (!catAx.deleted || scatter) add('line', horiz ? { x1: base, y1: round(top), x2: base, y2: round(bottom) } : { x1: round(left), y1: base, x2: round(right), y2: base }, 'gc-axis');
    if (!scatter && showC) {
      const each = horiz ? TICK + 4 : Math.max(...cats.map((c) => width(format(c, catFmt), TICK))) + 8;
      const skip = Math.max(1, Math.ceil(each / Math.max(1, band)));
      cats.forEach((c, i) => {
        if (i % skip) return;
        const p = round(cpx(i));
        const text = fit(format(c, catFmt), horiz ? left - P - 6 : band * skip - 2, TICK);
        add('text', horiz ? { x: round(left - 5), y: round(p + TICK / 2 - 1), 'text-anchor': 'end' } : { x: p, y: round(bottom + TICK + 3), 'text-anchor': 'middle' }, 'gc-tick', text);
        marks.ticks.cat.push(text);
      });
    }
    if (vTitle) add('text', horiz ? { x: round((left + right) / 2), y: round(h - P - 2), 'text-anchor': 'middle' } : { x: round(P + ATITLE), y: round((top + bottom) / 2), 'text-anchor': 'middle', transform: `rotate(-90 ${round(P + ATITLE)} ${round((top + bottom) / 2)})` }, 'gc-atitle', fit(vTitle, horiz ? right - left : bottom - top, ATITLE));
    if (cTitle) add('text', horiz ? { x: round(P + ATITLE), y: round((top + bottom) / 2), 'text-anchor': 'middle', transform: `rotate(-90 ${round(P + ATITLE)} ${round((top + bottom) / 2)})` } : { x: round((left + right) / 2), y: round(h - P - 2), 'text-anchor': 'middle' }, 'gc-atitle', fit(cTitle, horiz ? bottom - top : right - left, ATITLE));

    // ── The marks, group by group ──
    const smoothPath = (pts) => {
      if (pts.length < 3) return pts.map(([x, y], i) => `${i ? 'L' : 'M'}${round(x)} ${round(y)}`).join('');
      let d = `M${round(pts[0][0])} ${round(pts[0][1])}`;
      for (let i = 0; i < pts.length - 1; i++) {
        const p0 = pts[i - 1] ?? pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] ?? p2;
        d += `C${round(p1[0] + (p2[0] - p0[0]) / 6)} ${round(p1[1] + (p2[1] - p0[1]) / 6)} ${round(p2[0] - (p3[0] - p1[0]) / 6)} ${round(p2[1] - (p3[1] - p1[1]) / 6)} ${round(p2[0])} ${round(p2[1])}`;
      }
      return d;
    };
    const runs = (pts) => {
      // Gaps break a line; 'zero' plots blanks at 0 (made before), 'span' joins across them.
      const out = [[]];
      for (const p of pts) { if (p) out[out.length - 1].push(p); else if (data.blanks !== 'span' && out[out.length - 1].length) out.push([]); }
      return out.filter((r) => r.length);
    };
    const markerAt = (s, g, x, y, color, i, tip) => {
      const m = s.marker;
      if (m?.symbol === 'none' || g.markers === false) return;
      const size = Math.max(3, Math.min(12, m?.size ?? 5)), fill = m?.fill && m.fill !== 'none' ? m.fill : color, stroke = m?.line && m.line !== 'none' ? m.line : color;
      if (m?.symbol === 'square' || m?.symbol === 'diamond') add('rect', { x: round(x - size / 2), y: round(y - size / 2), width: size, height: size, fill, stroke, ...(m.symbol === 'diamond' && { transform: `rotate(45 ${round(x)} ${round(y)})` }) }, 'gc-mark', null, tip);
      else add('circle', { cx: round(x), cy: round(y), r: round(size / 2), fill, stroke }, 'gc-mark', null, tip);
    };
    groups.forEach((g, gi) => {
      const S = g.series.length;
      if (g.type === 'bar') {
        const stacked = g.grouping === 'stacked' || g.grouping === 'percentStacked';
        const gap = Math.max(0, Math.min(500, g.gap)) / 100, o = Math.max(-100, Math.min(100, g.overlap ?? (stacked ? 100 : 0))) / 100;
        const k = stacked ? 1 : S;
        const barW = band / (k - (k - 1) * o + gap);
        const groupW = barW * (k - (k - 1) * o), start = (band - groupW) / 2;
        g.series.forEach((s, j) => {
          stacks[gi][j].forEach((p, i) => {
            if (!p) return;
            const off = start + (stacked ? 0 : j * barW * (1 - o));
            const a = vpx(Math.max(vs.min, Math.min(vs.max, stacked ? p.lo : Math.max(vs.min, Math.min(vs.max, 0))))), b = vpx(Math.max(vs.min, Math.min(vs.max, p.hi)));
            const along = cpx(i, 0) + (horiz ? -off - barW : off);
            const box = horiz ? { x: Math.min(a, b), y: along, width: Math.abs(b - a), height: barW } : { x: along, y: Math.min(a, b), width: barW, height: Math.abs(b - a) };
            const color = pointColor(g, s, i);
            const tip = `${s.name ? `${s.name}, ` : ''}${cats[i]}: ${format(p.v, s.fmt)}`;
            add('rect', { x: round(box.x), y: round(box.y), width: round(box.width), height: round(box.height), fill: color }, 'gc-bar', null, tip);
            marks.bars.push({ s: j, i, x: round(box.x), y: round(box.y), w: round(box.width), h: round(box.height), v: p.v, top: p.hi, color });
            const lab = s.labels ?? g.labels;
            if (lab && !lab.del && lab.val) add('text', horiz ? { x: round(Math.max(a, b) + 3), y: round(box.y + box.height / 2 + 3.5) } : { x: round(box.x + box.width / 2), y: round(Math.min(a, b) - 3), 'text-anchor': 'middle' }, 'gc-label', format(p.v, lab.fmt || s.fmt));
          });
        });
      } else if (g.type === 'line' || g.type === 'area') {
        const stacked = g.grouping !== 'standard';
        for (const j of g.series.keys()) {
          const s = g.series[j];
          const color = g.type === 'area' ? fillOf(s) : lineOf(s);
          const pts = stacks[gi][j].map((p, i) => {
            if (!p && data.blanks === 'zero') return [cpx(i), vpx(Math.max(vs.min, Math.min(vs.max, stacked ? (stacks[gi][j - 1]?.[i]?.hi ?? 0) : 0))), i, 0];
            return p ? [cpx(i), vpx(Math.max(vs.min, Math.min(vs.max, p.hi))), i, p.v] : null;
          });
          if (g.type === 'area') {
            const lows = stacks[gi][j].map((p, i) => [cpx(i), vpx(Math.max(vs.min, Math.min(vs.max, stacked && p ? p.lo : zero)))]);
            const run = pts.map((p, i) => p ?? [cpx(i), lows[i][1]]);
            const d = `M${run.map(([x, y]) => `${round(x)} ${round(y)}`).join('L')}L${[...lows].reverse().map(([x, y]) => `${round(x)} ${round(y)}`).join('L')}Z`;
            add('path', { d, fill: color }, 'gc-area', null, s.name || null);
            marks.areas.push({ s: j, top: run.map(([, y]) => round(y)) });
          } else {
            for (const run of runs(pts)) {
              const d = s.smooth ? smoothPath(run) : run.map(([x, y], i) => `${i ? 'L' : 'M'}${round(x)} ${round(y)}`).join('');
              add('path', { d, fill: 'none', stroke: color, 'stroke-width': round(Math.max(1, Math.min(6, s.width ?? 2.25))), 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, 'gc-line');
            }
            marks.lines.push({ s: j, points: pts.filter(Boolean).map(([x, y]) => [round(x), round(y)]) });
          }
          pts.forEach((p) => {
            if (!p) return;
            const [x, y, i, v] = p;
            marks.points.push({ s: j, i, x: round(x), y: round(y), v });
            if (g.type === 'line') markerAt(s, g, x, y, color, i, `${s.name ? `${s.name}, ` : ''}${cats[i]}: ${format(v, s.fmt)}`);
            const lab = s.labels ?? g.labels;
            if (lab && !lab.del && lab.val) add('text', { x: round(x), y: round(y - 6), 'text-anchor': 'middle' }, 'gc-label', format(v, lab.fmt || s.fmt));
          });
        }
      } else if (g.type === 'scatter') {
        g.series.forEach((s, j) => {
          const color = lineOf(s);
          const pts = s.xs.map((x, i) => (x === null || s.vals[i] === null || s.vals[i] === undefined ? null : [xpx(x), vpx(Math.max(vs.min, Math.min(vs.max, s.vals[i]))), i, s.vals[i], x]));
          const lined = s.line !== 'none' && g.style !== 'marker';
          const smooth = s.smooth || g.style === 'smooth' || g.style === 'smoothMarker';
          if (lined) for (const run of runs(pts)) add('path', { d: smooth ? smoothPath(run) : run.map(([x, y], i) => `${i ? 'L' : 'M'}${round(x)} ${round(y)}`).join(''), fill: 'none', stroke: color, 'stroke-width': round(Math.max(1, Math.min(6, s.width ?? 2.25))) }, 'gc-line');
          pts.forEach((p) => {
            if (!p) return;
            const [x, y, i, v, xv] = p;
            marks.points.push({ s: j, i, x: round(x), y: round(y), v, xv });
            if (g.style !== 'line' && g.style !== 'smooth') markerAt(s, { ...g, markers: true }, x, y, s.marker?.fill && s.marker.fill !== 'none' ? s.marker.fill : color, i, `(${format(xv, s.catFmt)}, ${format(v, s.fmt)})`);
          });
        });
      }
    });
    if (scatter) add('line', { x1: round(left), y1: round(top), x2: round(left), y2: round(bottom) }, 'gc-axis');
    return { prims, marks };
  };

  // ── SVG on the page ────────────────────────────────────────────────────────────────────────────────────────────────
  const svg = (sc, w, h, label) => {
    const root = document.createElementNS(SVG, 'svg');
    root.setAttribute('class', 'gc');
    root.setAttribute('width', String(Math.max(1, Math.round(w))));
    root.setAttribute('height', String(Math.max(1, Math.round(h))));
    root.setAttribute('viewBox', `0 0 ${Math.max(1, Math.round(w))} ${Math.max(1, Math.round(h))}`);
    root.setAttribute('role', 'img');
    if (label) root.setAttribute('aria-label', label);
    for (const p of sc.prims) {
      const el = document.createElementNS(SVG, p.el);
      for (const [k, v] of Object.entries(p.a)) el.setAttribute(k, String(v));
      if (p.cls) el.setAttribute('class', p.cls);
      if (p.text !== null) el.textContent = p.text;
      if (p.tip) { const tt = document.createElementNS(SVG, 'title'); tt.textContent = p.tip; el.append(tt); }
      root.append(el);
    }
    return root;
  };

  // ── The layer on the grid ──────────────────────────────────────────────────────────────────────────────────────────
  // o: { panes (the grid's four: { el, inner, fr, fc }), wb (), sheet (), geo () → { R, C, FR, FC, FW, FH }, t }.
  // → { draw (on every frame the grid draws: places the charts, sizes them again), changed (the cells changed: draws
  // them again a moment later), list () → the shown sheet's charts with their boxes, dispose }.
  const layer = (o) => {
    const t = o.t || ((s) => s);
    const holders = Object.values(o.panes).map((p) => {
      const el = document.createElement('div');
      el.className = 'gx-charts';
      el.setAttribute('aria-hidden', 'true');
      p.inner.append(el);
      return { p, el, boxes: new Map() };
    });
    let sig = '', list = [], timer = 0, gone = false, version = 0;
    const show = (x) => {
      if (!x || x.t === 'z' || x.v === undefined || x.v === null) return '';
      if (x.t === 'b') return x.v ? 'TRUE' : 'FALSE';
      if (x.t === 'n') return format(x.v, x.fmt);
      return String(x.v);
    };
    const signature = () => {
      const wb = o.wb(), sh = o.sheet(), log = wb?.keep?.log ?? [];
      return [version, sh?.id, sh?.keep?.drawing?.path ?? '', log.length, JSON.stringify(log[log.length - 1] ?? null), Object.keys(wb?.keep?.parts ?? {}).length];
    };
    let wbSeen = null;
    const theme = () => { const th = o.wb()?.keep?.theme; return Array.isArray(th) && th.length >= 10 ? th : CX().DEFAULT_THEME; };
    const rebuild = () => {
      const wb = o.wb(), sh = o.sheet();
      let found = [];
      try { found = CX().charts(wb, sh); } catch (e) { console.error(e); found = []; }
      list = found.map((c) => ({ ...c, data: null, w: 0, h: 0, rendered: null }));
      for (const hd of holders) { for (const el of hd.boxes.values()) el.remove(); hd.boxes.clear(); }
    };
    const resolveAll = () => {
      const wb = o.wb(), look = CX().lookup(wb);
      for (const c of list) { try { c.data = CX().resolve(c.chart, look, show); } catch (e) { console.error(e); c.data = { kind: 'frame', type: 'Chart', title: null }; } c.rendered = null; }
    };
    // A chart's box on the sheet, in px from A1's corner.
    const boxOf = (a, g) => {
      const { R, C } = g;
      const x0 = a.kind === 'absoluteAnchor' ? a.pos?.x ?? 0 : C.offset(a.from.col) + Math.min(a.from.colOff, C.size(a.from.col));
      const y0 = a.kind === 'absoluteAnchor' ? a.pos?.y ?? 0 : R.offset(a.from.row) + Math.min(a.from.rowOff, R.size(a.from.row));
      let x1, y1;
      if (a.kind === 'twoCellAnchor' && a.to) { x1 = C.offset(a.to.col) + Math.min(a.to.colOff, C.size(a.to.col)); y1 = R.offset(a.to.row) + Math.min(a.to.rowOff, R.size(a.to.row)); }
      else { x1 = x0 + (a.ext?.w ?? 480); y1 = y0 + (a.ext?.h ?? 288); }
      return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
    };
    const render = (c) => {
      const sc = scene(c.data, c.w, c.h, { t, theme: theme() });
      const label = c.data.title || t(c.data.kind === 'frame' ? c.data.type || 'Chart' : 'Chart');
      c.rendered = svg(sc, c.w, c.h, label);
      c.marks = sc.marks;
    };
    const draw = () => {
      if (gone) return;
      const wb = o.wb();
      const s = JSON.stringify(signature());
      if (s !== sig || wb !== wbSeen) { sig = s; wbSeen = wb; rebuild(); resolveAll(); }
      const g = o.geo();
      for (const c of list) {
        const b = boxOf(c.anchor, g);
        c.box = b;
        if (Math.round(b.w) !== c.w || Math.round(b.h) !== c.h || !c.rendered) { c.w = Math.round(b.w); c.h = Math.round(b.h); if (c.w >= 8 && c.h >= 8) render(c); else c.rendered = null; for (const hd of holders) { hd.boxes.get(c.id)?.remove(); hd.boxes.delete(c.id); } }
      }
      for (const hd of holders) {
        const { p } = hd;
        const want = new Set();
        if (!p.el.hidden) for (const c of list) {
          const b = c.box;
          if (!c.rendered) continue;
          // The part of the chart in this pane: frozen columns hold x < FW, the rest x ≥ FW (rows the same).
          if (p.fc ? b.x >= g.FW : b.x + b.w <= g.FW) continue;
          if (p.fr ? b.y >= g.FH : b.y + b.h <= g.FH) continue;
          want.add(c.id);
          let el = hd.boxes.get(c.id);
          if (!el) {
            el = document.createElement('div');
            el.className = 'gx-chart';
            el.dataset.chart = c.id;
            el.append(c.rendered.parentNode ? c.rendered.cloneNode(true) : c.rendered);
            hd.boxes.set(c.id, el);
            hd.el.append(el);
          }
          el.style.left = `${b.x - (p.fc ? 0 : g.FW)}px`; el.style.top = `${b.y - (p.fr ? 0 : g.FH)}px`;
          el.style.width = `${c.w}px`; el.style.height = `${c.h}px`;
        }
        for (const [id, el] of hd.boxes) if (!want.has(id)) { el.remove(); hd.boxes.delete(id); }
      }
    };
    // The cells changed: every chart reads its values again, a moment after the last change.
    const changed = () => {
      if (gone || !list.length) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        timer = 0;
        if (gone) return;
        resolveAll();
        for (const hd of holders) { for (const el of hd.boxes.values()) el.remove(); hd.boxes.clear(); }
        for (const c of list) if (c.w >= 8 && c.h >= 8) render(c);
        draw();
      }, 120);
    };
    const touch = () => { version++; };
    const dispose = () => { gone = true; clearTimeout(timer); for (const hd of holders) hd.el.remove(); };
    return { draw, changed, touch, dispose, list: () => list.map((c) => ({ id: c.id, box: c.box, kind: c.data?.kind, title: c.data?.title ?? null, marks: c.marks })) };
  };

  return { scene, svg, layer, scale, width, fit };
})();

if (typeof module !== 'undefined') module.exports = GZ_SHEET_CHART; else GZ_SHEET_CHART;
