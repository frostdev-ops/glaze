// DrawingML shape geometry for Slides: a preset shape (prstGeom) or a custom one (custGeom) as SVG path data, with its
// connection sites and text box. Formulas, built-in guides, arcTo and paths follow ECMA-376 Part 1, 5th edition (2016),
// §20.1.9 and §20.1.10.56; the presets are transcribed from its addendum presetShapeDefinitions.xml (in
// OfficeOpenXML-DrawingMLGeometries.zip), less the adjust handles and extrusionOk, which Slides doesn't use.
// Lengths in and out are EMU from the shape's top-left corner, rounded to whole EMU; angles are 60000ths of a degree in
// and degrees out.
//   path({ prst, avLst, w, h }) → { prst, unknown?, paths: [{ d, fill, stroke }], rect: { l, t, r, b }, cxn: [{ x, y, ang }] }
//     prst is the preset drawn: an unknown one draws as rect and is named in unknown. avLst: { adj: 16667 } or
//     [{ name, fmla: 'val 16667' }]; names the preset doesn't adjust are ignored. fill is the path's fill mode (norm, none,
//     lighten, lightenLess, darken, darkenLess); a later path draws over an earlier one.
//   custom(model, w, h) → { paths, rect, cxn }, model as in the file: { avLst, gdLst: [{ name, fmla }], cxnLst: [{ ang, x, y }],
//     rect: { l, t, r, b }, pathLst: [{ w, h, fill, stroke, cmds }] }, cmds [{ cmd: 'moveTo' | 'lnTo' | 'quadBezTo' |
//     'cubicBezTo', pts: [{ x, y }] }, { cmd: 'arcTo', wR, hR, stAng, swAng }, { cmd: 'close' }], values numbers or the
//     attributes' strings (a number or a guide's name).
//   guides(model, w, h) → every name's value in the shape: the built-ins, then avLst and gdLst in order.
//   presets: the preset names.
// Classic script; module.exports for node.
var GZ_PPTX_GEOM = globalThis.GZ_PPTX_GEOM || (() => {
  const RAD = Math.PI / 180 / 60000;
  const TURN = 2 * Math.PI;

  // ---- guides (§20.1.9.11) -----------------------------------------------------------------------------------------
  // A result that is not a finite number (a division by zero, the root of a negative) is 0.
  const FORMULAS = {
    '*/': (x, y, z) => (x * y) / z,
    '+-': (x, y, z) => x + y - z,
    '+/': (x, y, z) => (x + y) / z,
    '?:': (x, y, z) => (x > 0 ? y : z),
    abs: (x) => Math.abs(x),
    at2: (x, y) => Math.atan2(y, x) / RAD,
    cat2: (x, y, z) => x * Math.cos(Math.atan2(z, y)),
    cos: (x, y) => x * Math.cos(y * RAD),
    max: (x, y) => Math.max(x, y),
    min: (x, y) => Math.min(x, y),
    mod: (x, y, z) => Math.sqrt(x * x + y * y + z * z),
    pin: (x, y, z) => (y < x ? x : y > z ? z : y),
    sat2: (x, y, z) => x * Math.sin(Math.atan2(z, y)),
    sin: (x, y) => x * Math.sin(y * RAD),
    sqrt: (x) => Math.sqrt(x),
    tan: (x, y) => x * Math.tan(y * RAD),
    val: (x) => x,
  };
  const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i;
  const finite = (n) => (Number.isFinite(n) ? n : 0);
  // A number, or a name: a guide's or a built-in's value, 0 when it has none (yet). Names may start with digits (3cd4).
  const read = (v, scope) => {
    if (typeof v === 'number') return finite(v);
    const s = typeof v === 'string' ? v.trim() : '';
    return NUMBER.test(s) ? Number(s) : scope.get(s) ?? 0;
  };
  const formula = (fmla, scope) => {
    if (typeof fmla === 'number' || NUMBER.test(String(fmla).trim())) return read(fmla, scope);
    const [op, ...args] = String(fmla ?? '').trim().split(/\s+/);
    return Object.hasOwn(FORMULAS, op) ? finite(FORMULAS[op](...[0, 1, 2].map((i) => read(args[i], scope)))) : 0;
  };
  // The built-in guides of §20.1.10.56, and wd12, wd32 and hd10, which the addendum uses without listing them.
  const builtins = (w, h) => {
    const ss = Math.min(w, h);
    return new Map(Object.entries({
      w, h, l: 0, t: 0, r: w, b: h, hc: w / 2, vc: h / 2, ss, ls: Math.max(w, h),
      wd2: w / 2, wd3: w / 3, wd4: w / 4, wd5: w / 5, wd6: w / 6, wd8: w / 8, wd10: w / 10, wd12: w / 12, wd32: w / 32,
      hd2: h / 2, hd3: h / 3, hd4: h / 4, hd5: h / 5, hd6: h / 6, hd8: h / 8, hd10: h / 10,
      ssd2: ss / 2, ssd4: ss / 4, ssd6: ss / 6, ssd8: ss / 8, ssd16: ss / 16, ssd32: ss / 32,
      cd8: 2700000, cd4: 5400000, '3cd8': 8100000, cd2: 10800000, '5cd8': 13500000, '3cd4': 16200000, '7cd8': 18900000,
    }));
  };
  const list = (gds) => (Array.isArray(gds) ? gds.filter((g) => typeof g?.name === 'string')
    : gds && typeof gds === 'object' ? Object.entries(gds).map(([name, fmla]) => ({ name, fmla })) : []);
  const scopeFor = (model, w, h) => {
    const scope = builtins(w, h);
    for (const g of [...list(model.avLst), ...list(model.gdLst)]) scope.set(g.name, formula(g.fmla, scope));
    return scope;
  };

  // ---- paths (§20.1.9.4, §20.1.9.15) ---------------------------------------------------------------------------------
  const FILLS = new Set(['norm', 'none', 'lighten', 'lightenLess', 'darken', 'darkenLess']);
  const size = (v) => Math.max(0, finite(Number(v)));
  const emu = (v) => Math.round(v) || 0;
  // arcTo's angles are seen from the ellipse's centre; SVG's arc runs on the ellipse's parameter. The parameter for a
  // centre-seen angle, on the same turn.
  const parameter = (a, wR, hR) => {
    const t = Math.atan2(wR * Math.sin(a), hR * Math.cos(a));
    return t + TURN * Math.round((a - t) / TURN);
  };
  // A path with its own w and h is drawn in that space, its guides worked out at that size (as Apache POI does), then
  // stretched to the shape.
  const draw = (path, model, shape, W, H) => {
    const pw = size(path.w), ph = size(path.h);
    const scope = pw || ph ? scopeFor(model, pw || W, ph || H) : shape;
    const sx = pw ? W / pw : 1, sy = ph ? H / ph : 1;
    const xy = (x, y) => `${emu(x * sx)} ${emu(y * sy)}`;
    const point = (p) => [read(p?.x, scope), read(p?.y, scope)];
    const d = [];
    let x = 0, y = 0, x0 = 0, y0 = 0, started = false;
    const start = () => { if (!started) { d.push(`M ${xy(x, y)}`); started = true; } };
    // The pen is on the arc's ellipse at stAng; a positive swAng turns clockwise on the page. Drawn in quarter turns or
    // less, so each SVG arc's flags name one arc. An arc with no radius or no swing draws nothing.
    const arc = (c) => {
      const wR = Math.abs(read(c.wR, scope)), hR = Math.abs(read(c.hR, scope));
      const st = read(c.stAng, scope) * RAD, sw = Math.max(-TURN, Math.min(TURN, read(c.swAng, scope) * RAD));
      if (!wR || !hR || !sw) return;
      const t0 = parameter(st, wR, hR), t1 = parameter(st + sw, wR, hR);
      const cx = x - wR * Math.cos(t0), cy = y - hR * Math.sin(t0);
      const n = Math.ceil(Math.abs(t1 - t0) / (TURN / 4) - 1e-9);
      for (let i = 1; i <= n; i++) {
        const t = t0 + ((t1 - t0) * i) / n;
        x = cx + wR * Math.cos(t);
        y = cy + hR * Math.sin(t);
        d.push(`A ${emu(wR * sx)} ${emu(hR * sy)} 0 0 ${sw > 0 ? 1 : 0} ${xy(x, y)}`);
      }
    };
    const LETTER = { lnTo: ['L', 1], quadBezTo: ['Q', 2], cubicBezTo: ['C', 3] };
    for (const c of Array.isArray(path.cmds) ? path.cmds : []) {
      const pts = Array.isArray(c?.pts) ? c.pts : [];
      if (c?.cmd === 'moveTo' && pts.length) {
        [x, y] = point(pts[0]);
        [x0, y0] = [x, y];
        d.push(`M ${xy(x, y)}`);
        started = true;
      } else if (Object.hasOwn(LETTER, c?.cmd ?? '') && pts.length >= LETTER[c.cmd][1]) {
        start();
        const ps = pts.slice(0, LETTER[c.cmd][1]).map(point);
        d.push(`${LETTER[c.cmd][0]} ${ps.map(([px, py]) => xy(px, py)).join(' ')}`);
        [x, y] = ps[ps.length - 1];
      } else if (c?.cmd === 'arcTo') {
        start();
        arc(c);
      } else if (c?.cmd === 'close' && started) {
        d.push('Z');
        [x, y] = [x0, y0];
      }
    }
    const stroke = !(path.stroke === false || path.stroke === 0 || path.stroke === 'false' || path.stroke === '0');
    return { d: d.join(' '), fill: FILLS.has(path.fill) ? path.fill : 'norm', stroke };
  };

  const custom = (model, w, h) => {
    const m = model && typeof model === 'object' ? model : {};
    const W = size(w), H = size(h);
    const shape = scopeFor(m, W, H);
    const r = m.rect && typeof m.rect === 'object' ? m.rect : { l: 'l', t: 't', r: 'r', b: 'b' };
    return {
      paths: (Array.isArray(m.pathLst) ? m.pathLst : []).filter((p) => p && typeof p === 'object').map((p) => draw(p, m, shape, W, H)),
      rect: { l: emu(read(r.l, shape)), t: emu(read(r.t, shape)), r: emu(read(r.r, shape)), b: emu(read(r.b, shape)) },
      cxn: (Array.isArray(m.cxnLst) ? m.cxnLst : []).filter((c) => c && typeof c === 'object').map((c) => ({
        x: emu(read(c.x, shape)), y: emu(read(c.y, shape)), ang: Math.round(read(c.ang, shape) / 60) / 1000 || 0,
      })),
    };
  };

  const guides = (model, w, h) => Object.fromEntries(scopeFor(model && typeof model === 'object' ? model : {}, size(w), size(h)));

  // ---- presets ---------------------------------------------------------------------------------------------------------
  // Each as in the addendum: av, the adjusts and their defaults; gd, the guides, one per line, name then formula; cxn, the
  // connection sites, angle then x y; rect, the text box l t r b; paths, the commands with their attributes' values in order
  // (arcTo wR hR stAng swAng), a path line before each path that has attributes or when there are several.
  const PRESETS = {
    rect: {
      cxn: `
        3cd4 hc t
        cd2  l vc
        cd4  hc b
        0    r vc`,
      rect: 'l t r b',
      paths: `
        moveTo l t
        lnTo r t
        lnTo r b
        lnTo l b
        close`,
    },
    roundRect: {
      av: { adj: 16667 },
      gd: `
        a  pin 0 adj 50000
        x1 */ ss a 100000
        x2 +- r 0 x1
        y2 +- b 0 x1
        il */ x1 29289 100000
        ir +- r 0 il
        ib +- b 0 il`,
      cxn: `
        3cd4 hc t
        cd2  l vc
        cd4  hc b
        0    r vc`,
      rect: 'il il ir ib',
      paths: `
        moveTo l x1
        arcTo x1 x1 cd2 cd4
        lnTo x2 t
        arcTo x1 x1 3cd4 cd4
        lnTo r y2
        arcTo x1 x1 0 cd4
        lnTo x1 b
        arcTo x1 x1 cd4 cd4
        close`,
    },
    ellipse: {
      gd: `
        idx cos wd2 2700000
        idy sin hd2 2700000
        il  +- hc 0 idx
        ir  +- hc idx 0
        it  +- vc 0 idy
        ib  +- vc idy 0`,
      cxn: `
        3cd4 hc t
        3cd4 il it
        cd2  l vc
        cd4  il ib
        cd4  hc b
        cd4  ir ib
        0    r vc
        3cd4 ir it`,
      rect: 'il it ir ib',
      paths: `
        moveTo l vc
        arcTo wd2 hd2 cd2 cd4
        arcTo wd2 hd2 3cd4 cd4
        arcTo wd2 hd2 0 cd4
        arcTo wd2 hd2 cd4 cd4
        close`,
    },
    triangle: {
      av: { adj: 50000 },
      gd: `
        a  pin 0 adj 100000
        x1 */ w a 200000
        x2 */ w a 100000
        x3 +- x1 wd2 0`,
      cxn: `
        3cd4 x2 t
        cd2  x1 vc
        cd4  l b
        cd4  x2 b
        cd4  r b
        0    x3 vc`,
      rect: 'x1 vc x3 b',
      paths: `
        moveTo l b
        lnTo x2 t
        lnTo r b
        close`,
    },
    rtTriangle: {
      gd: `
        it */ h 7 12
        ir */ w 7 12
        ib */ h 11 12`,
      cxn: `
        3cd4 l t
        cd2  l vc
        cd4  l b
        cd4  hc b
        cd4  r b
        0    hc vc`,
      rect: 'wd12 it ir ib',
      paths: `
        moveTo l b
        lnTo l t
        lnTo r b
        close`,
    },
    diamond: {
      gd: `
        ir */ w 3 4
        ib */ h 3 4`,
      cxn: `
        3cd4 hc t
        cd2  l vc
        cd4  hc b
        0    r vc`,
      rect: 'wd4 hd4 ir ib',
      paths: `
        moveTo l vc
        lnTo hc t
        lnTo r vc
        lnTo hc b
        close`,
    },
    parallelogram: {
      av: { adj: 25000 },
      gd: `
        maxAdj */ 100000 w ss
        a      pin 0 adj maxAdj
        x1     */ ss a 200000
        x2     */ ss a 100000
        x6     +- r 0 x1
        x5     +- r 0 x2
        x3     */ x5 1 2
        x4     +- r 0 x3
        il     */ wd2 a maxAdj
        q1     */ 5 a maxAdj
        q2     +/ 1 q1 12
        il     */ q2 w 1
        it     */ q2 h 1
        ir     +- r 0 il
        ib     +- b 0 it
        q3     */ h hc x2
        y1     pin 0 q3 h
        y2     +- b 0 y1`,
      cxn: `
        3cd4 hc y2
        3cd4 x4 t
        0    x6 vc
        cd4  x3 b
        cd4  hc y1
        cd2  x1 vc`,
      rect: 'il it ir ib',
      paths: `
        moveTo l b
        lnTo x2 t
        lnTo r t
        lnTo x5 b
        close`,
    },
    trapezoid: {
      av: { adj: 25000 },
      gd: `
        maxAdj */ 50000 w ss
        a      pin 0 adj maxAdj
        x1     */ ss a 200000
        x2     */ ss a 100000
        x3     +- r 0 x2
        x4     +- r 0 x1
        il     */ wd3 a maxAdj
        it     */ hd3 a maxAdj
        ir     +- r 0 il`,
      cxn: `
        3cd4 hc t
        cd2  x1 vc
        cd4  hc b
        0    x4 vc`,
      rect: 'il it ir b',
      paths: `
        moveTo l b
        lnTo x2 t
        lnTo x3 t
        lnTo r b
        close`,
    },
    pentagon: {
      av: { hf: 105146, vf: 110557 },
      gd: `
        swd2 */ wd2 hf 100000
        shd2 */ hd2 vf 100000
        svc  */ vc vf 100000
        dx1  cos swd2 1080000
        dx2  cos swd2 18360000
        dy1  sin shd2 1080000
        dy2  sin shd2 18360000
        x1   +- hc 0 dx1
        x2   +- hc 0 dx2
        x3   +- hc dx2 0
        x4   +- hc dx1 0
        y1   +- svc 0 dy1
        y2   +- svc 0 dy2
        it   */ y1 dx2 dx1`,
      cxn: `
        3cd4 hc t
        cd2  x1 y1
        cd4  x2 y2
        cd4  hc b
        cd4  x3 y2
        0    x4 y1`,
      rect: 'x2 it x3 y2',
      paths: `
        moveTo x1 y1
        lnTo hc t
        lnTo x4 y1
        lnTo x3 y2
        lnTo x2 y2
        close`,
    },
    hexagon: {
      av: { adj: 25000, vf: 115470 },
      gd: `
        maxAdj */ 50000 w ss
        a      pin 0 adj maxAdj
        shd2   */ hd2 vf 100000
        x1     */ ss a 100000
        x2     +- r 0 x1
        dy1    sin shd2 3600000
        y1     +- vc 0 dy1
        y2     +- vc dy1 0
        q1     */ maxAdj -1 2
        q2     +- a q1 0
        q3     ?: q2 4 2
        q4     ?: q2 3 2
        q5     ?: q2 q1 0
        q6     +/ a q5 q1
        q7     */ q6 q4 -1
        q8     +- q3 q7 0
        il     */ w q8 24
        it     */ h q8 24
        ir     +- r 0 il
        ib     +- b 0 it`,
      cxn: `
        0    r vc
        cd4  x2 y2
        cd4  x1 y2
        cd2  l vc
        3cd4 x1 y1
        3cd4 x2 y1`,
      rect: 'il it ir ib',
      paths: `
        moveTo l vc
        lnTo x1 y1
        lnTo x2 y1
        lnTo r vc
        lnTo x2 y2
        lnTo x1 y2
        close`,
    },
    octagon: {
      av: { adj: 29289 },
      gd: `
        a  pin 0 adj 50000
        x1 */ ss a 100000
        x2 +- r 0 x1
        y2 +- b 0 x1
        il */ x1 1 2
        ir +- r 0 il
        ib +- b 0 il`,
      cxn: `
        0    r x1
        0    r y2
        cd4  x2 b
        cd4  x1 b
        cd2  l y2
        cd2  l x1
        3cd4 x1 t
        3cd4 x2 t`,
      rect: 'il il ir ib',
      paths: `
        moveTo l x1
        lnTo x1 t
        lnTo x2 t
        lnTo r x1
        lnTo r y2
        lnTo x2 b
        lnTo x1 b
        lnTo l y2
        close`,
    },
    star5: {
      av: { adj: 19098, hf: 105146, vf: 110557 },
      gd: `
        a    pin 0 adj 50000
        swd2 */ wd2 hf 100000
        shd2 */ hd2 vf 100000
        svc  */ vc vf 100000
        dx1  cos swd2 1080000
        dx2  cos swd2 18360000
        dy1  sin shd2 1080000
        dy2  sin shd2 18360000
        x1   +- hc 0 dx1
        x2   +- hc 0 dx2
        x3   +- hc dx2 0
        x4   +- hc dx1 0
        y1   +- svc 0 dy1
        y2   +- svc 0 dy2
        iwd2 */ swd2 a 50000
        ihd2 */ shd2 a 50000
        sdx1 cos iwd2 20520000
        sdx2 cos iwd2 3240000
        sdy1 sin ihd2 3240000
        sdy2 sin ihd2 20520000
        sx1  +- hc 0 sdx1
        sx2  +- hc 0 sdx2
        sx3  +- hc sdx2 0
        sx4  +- hc sdx1 0
        sy1  +- svc 0 sdy1
        sy2  +- svc 0 sdy2
        sy3  +- svc ihd2 0
        yAdj +- svc 0 ihd2`,
      cxn: `
        3cd4 hc t
        cd2  x1 y1
        cd4  x2 y2
        cd4  x3 y2
        0    x4 y1`,
      rect: 'sx1 sy1 sx4 sy3',
      paths: `
        moveTo x1 y1
        lnTo sx2 sy1
        lnTo hc t
        lnTo sx3 sy1
        lnTo x4 y1
        lnTo sx4 sy2
        lnTo x3 y2
        lnTo hc sy3
        lnTo x2 y2
        lnTo sx1 sy2
        close`,
    },
    rightArrow: {
      av: { adj1: 50000, adj2: 50000 },
      gd: `
        maxAdj2 */ 100000 w ss
        a1      pin 0 adj1 100000
        a2      pin 0 adj2 maxAdj2
        dx1     */ ss a2 100000
        x1      +- r 0 dx1
        dy1     */ h a1 200000
        y1      +- vc 0 dy1
        y2      +- vc dy1 0
        dx2     */ y1 dx1 hd2
        x2      +- x1 dx2 0`,
      cxn: `
        3cd4 x1 t
        cd2  l vc
        cd4  x1 b
        0    r vc`,
      rect: 'l y1 x2 y2',
      paths: `
        moveTo l y1
        lnTo x1 y1
        lnTo x1 t
        lnTo r vc
        lnTo x1 b
        lnTo x1 y2
        lnTo l y2
        close`,
    },
    leftArrow: {
      av: { adj1: 50000, adj2: 50000 },
      gd: `
        maxAdj2 */ 100000 w ss
        a1      pin 0 adj1 100000
        a2      pin 0 adj2 maxAdj2
        dx2     */ ss a2 100000
        x2      +- l dx2 0
        dy1     */ h a1 200000
        y1      +- vc 0 dy1
        y2      +- vc dy1 0
        dx1     */ y1 dx2 hd2
        x1      +- x2 0 dx1`,
      cxn: `
        3cd4 x2 t
        cd2  l vc
        cd4  x2 b
        0    r vc`,
      rect: 'x1 y1 r y2',
      paths: `
        moveTo l vc
        lnTo x2 t
        lnTo x2 y1
        lnTo r y1
        lnTo r y2
        lnTo x2 y2
        lnTo x2 b
        close`,
    },
    // The addendum has no upArrow: this is its downArrow turned upside down.
    upArrow: {
      av: { adj1: 50000, adj2: 50000 },
      gd: `
        maxAdj2 */ 100000 h ss
        a1      pin 0 adj1 100000
        a2      pin 0 adj2 maxAdj2
        dy2     */ ss a2 100000
        y2      +- t dy2 0
        dx1     */ w a1 200000
        x1      +- hc 0 dx1
        x2      +- hc dx1 0
        dy1     */ x1 dy2 wd2
        y1      +- y2 0 dy1`,
      cxn: `
        3cd4 hc t
        cd2  l y2
        cd4  hc b
        0    r y2`,
      rect: 'x1 y1 x2 b',
      paths: `
        moveTo l y2
        lnTo hc t
        lnTo r y2
        lnTo x2 y2
        lnTo x2 b
        lnTo x1 b
        lnTo x1 y2
        close`,
    },
    downArrow: {
      av: { adj1: 50000, adj2: 50000 },
      gd: `
        maxAdj2 */ 100000 h ss
        a1      pin 0 adj1 100000
        a2      pin 0 adj2 maxAdj2
        dy1     */ ss a2 100000
        y1      +- b 0 dy1
        dx1     */ w a1 200000
        x1      +- hc 0 dx1
        x2      +- hc dx1 0
        dy2     */ x1 dy1 wd2
        y2      +- y1 dy2 0`,
      cxn: `
        3cd4 hc t
        cd2  l y1
        cd4  hc b
        0    r y1`,
      rect: 'x1 t x2 y2',
      paths: `
        moveTo l y1
        lnTo x1 y1
        lnTo x1 t
        lnTo x2 t
        lnTo x2 y1
        lnTo r y1
        lnTo hc b
        close`,
    },
    leftRightArrow: {
      av: { adj1: 50000, adj2: 50000 },
      gd: `
        maxAdj2 */ 50000 w ss
        a1      pin 0 adj1 100000
        a2      pin 0 adj2 maxAdj2
        x2      */ ss a2 100000
        x3      +- r 0 x2
        dy      */ h a1 200000
        y1      +- vc 0 dy
        y2      +- vc dy 0
        dx1     */ y1 x2 hd2
        x1      +- x2 0 dx1
        x4      +- x3 dx1 0`,
      cxn: `
        0    r vc
        cd4  x3 b
        cd4  x2 b
        cd2  l vc
        3cd4 x2 t
        3cd4 x3 t`,
      rect: 'x1 y1 x4 y2',
      paths: `
        moveTo l vc
        lnTo x2 t
        lnTo x2 y1
        lnTo x3 y1
        lnTo x3 t
        lnTo r vc
        lnTo x3 b
        lnTo x3 y2
        lnTo x2 y2
        lnTo x2 b
        close`,
    },
    chevron: {
      av: { adj: 50000 },
      gd: `
        maxAdj */ 100000 w ss
        a      pin 0 adj maxAdj
        x1     */ ss a 100000
        x2     +- r 0 x1
        x3     */ x2 1 2
        dx     +- x2 0 x1
        il     ?: dx x1 l
        ir     ?: dx x2 r`,
      cxn: `
        3cd4 x3 t
        cd2  x1 vc
        cd4  x3 b
        0    r vc`,
      rect: 'il t ir b',
      paths: `
        moveTo l t
        lnTo x2 t
        lnTo r vc
        lnTo x2 b
        lnTo l b
        lnTo x1 vc
        close`,
    },
    homePlate: {
      av: { adj: 50000 },
      gd: `
        maxAdj */ 100000 w ss
        a      pin 0 adj maxAdj
        dx1    */ ss a 100000
        x1     +- r 0 dx1
        ir     +/ x1 r 2
        x2     */ x1 1 2`,
      cxn: `
        3cd4 x2 t
        cd2  l vc
        cd4  x1 b
        0    r vc`,
      rect: 'l t ir b',
      paths: `
        moveTo l t
        lnTo x1 t
        lnTo r vc
        lnTo x1 b
        lnTo l b
        close`,
    },
    flowChartProcess: {
      cxn: `
        3cd4 hc t
        cd2  l vc
        cd4  hc b
        0    r vc`,
      rect: 'l t r b',
      paths: `
        path w=1 h=1
          moveTo 0 0
          lnTo 1 0
          lnTo 1 1
          lnTo 0 1
          close`,
    },
    flowChartDecision: {
      gd: `
        ir */ w 3 4
        ib */ h 3 4`,
      cxn: `
        3cd4 hc t
        cd2  l vc
        cd4  hc b
        0    r vc`,
      rect: 'wd4 hd4 ir ib',
      paths: `
        path w=2 h=2
          moveTo 0 1
          lnTo 1 0
          lnTo 2 1
          lnTo 1 2
          close`,
    },
    flowChartTerminator: {
      gd: `
        il */ w 1018 21600
        ir */ w 20582 21600
        it */ h 3163 21600
        ib */ h 18437 21600`,
      cxn: `
        3cd4 hc t
        cd2  l vc
        cd4  hc b
        0    r vc`,
      rect: 'il it ir ib',
      paths: `
        path w=21600 h=21600
          moveTo 3475 0
          lnTo 18125 0
          arcTo 3475 10800 3cd4 cd2
          lnTo 3475 21600
          arcTo 3475 10800 cd4 cd2
          close`,
    },
    wedgeRectCallout: {
      av: { adj1: -20833, adj2: 62500 },
      gd: `
        dxPos */ w adj1 100000
        dyPos */ h adj2 100000
        xPos  +- hc dxPos 0
        yPos  +- vc dyPos 0
        dx    +- xPos 0 hc
        dy    +- yPos 0 vc
        dq    */ dxPos h w
        ady   abs dyPos
        adq   abs dq
        dz    +- ady 0 adq
        xg1   ?: dxPos 7 2
        xg2   ?: dxPos 10 5
        x1    */ w xg1 12
        x2    */ w xg2 12
        yg1   ?: dyPos 7 2
        yg2   ?: dyPos 10 5
        y1    */ h yg1 12
        y2    */ h yg2 12
        t1    ?: dxPos l xPos
        xl    ?: dz l t1
        t2    ?: dyPos x1 xPos
        xt    ?: dz t2 x1
        t3    ?: dxPos xPos r
        xr    ?: dz r t3
        t4    ?: dyPos xPos x1
        xb    ?: dz t4 x1
        t5    ?: dxPos y1 yPos
        yl    ?: dz y1 t5
        t6    ?: dyPos t yPos
        yt    ?: dz t6 t
        t7    ?: dxPos yPos y1
        yr    ?: dz y1 t7
        t8    ?: dyPos yPos b
        yb    ?: dz t8 b`,
      cxn: `
        3cd4 hc t
        cd2  l vc
        cd4  hc b
        0    r vc
        cd4  xPos yPos`,
      rect: 'l t r b',
      paths: `
        moveTo l t
        lnTo x1 t
        lnTo xt yt
        lnTo x2 t
        lnTo r t
        lnTo r y1
        lnTo xr yr
        lnTo r y2
        lnTo r b
        lnTo x2 b
        lnTo xb yb
        lnTo x1 b
        lnTo l b
        lnTo l y2
        lnTo xl yl
        lnTo l y1
        close`,
    },
    wedgeRoundRectCallout: {
      av: { adj1: -20833, adj2: 62500, adj3: 16667 },
      gd: `
        dxPos */ w adj1 100000
        dyPos */ h adj2 100000
        xPos  +- hc dxPos 0
        yPos  +- vc dyPos 0
        dq    */ dxPos h w
        ady   abs dyPos
        adq   abs dq
        dz    +- ady 0 adq
        xg1   ?: dxPos 7 2
        xg2   ?: dxPos 10 5
        x1    */ w xg1 12
        x2    */ w xg2 12
        yg1   ?: dyPos 7 2
        yg2   ?: dyPos 10 5
        y1    */ h yg1 12
        y2    */ h yg2 12
        t1    ?: dxPos l xPos
        xl    ?: dz l t1
        t2    ?: dyPos x1 xPos
        xt    ?: dz t2 x1
        t3    ?: dxPos xPos r
        xr    ?: dz r t3
        t4    ?: dyPos xPos x1
        xb    ?: dz t4 x1
        t5    ?: dxPos y1 yPos
        yl    ?: dz y1 t5
        t6    ?: dyPos t yPos
        yt    ?: dz t6 t
        t7    ?: dxPos yPos y1
        yr    ?: dz y1 t7
        t8    ?: dyPos yPos b
        yb    ?: dz t8 b
        u1    */ ss adj3 100000
        u2    +- r 0 u1
        v2    +- b 0 u1
        il    */ u1 29289 100000
        ir    +- r 0 il
        ib    +- b 0 il`,
      cxn: `
        3cd4 hc t
        cd2  l vc
        cd4  hc b
        0    r vc
        cd4  xPos yPos`,
      rect: 'il il ir ib',
      paths: `
        moveTo l u1
        arcTo u1 u1 cd2 cd4
        lnTo x1 t
        lnTo xt yt
        lnTo x2 t
        lnTo u2 t
        arcTo u1 u1 3cd4 cd4
        lnTo r y1
        lnTo xr yr
        lnTo r y2
        lnTo r v2
        arcTo u1 u1 0 cd4
        lnTo x2 b
        lnTo xb yb
        lnTo x1 b
        lnTo u1 b
        arcTo u1 u1 cd4 cd4
        lnTo l y2
        lnTo xl yl
        lnTo l y1
        close`,
    },
    wedgeEllipseCallout: {
      av: { adj1: -20833, adj2: 62500 },
      gd: `
        dxPos  */ w adj1 100000
        dyPos  */ h adj2 100000
        xPos   +- hc dxPos 0
        yPos   +- vc dyPos 0
        sdx    */ dxPos h 1
        sdy    */ dyPos w 1
        pang   at2 sdx sdy
        stAng  +- pang 660000 0
        enAng  +- pang 0 660000
        dx1    cos wd2 stAng
        dy1    sin hd2 stAng
        x1     +- hc dx1 0
        y1     +- vc dy1 0
        dx2    cos wd2 enAng
        dy2    sin hd2 enAng
        x2     +- hc dx2 0
        y2     +- vc dy2 0
        stAng1 at2 dx1 dy1
        enAng1 at2 dx2 dy2
        swAng1 +- enAng1 0 stAng1
        swAng2 +- swAng1 21600000 0
        swAng  ?: swAng1 swAng1 swAng2
        idx    cos wd2 2700000
        idy    sin hd2 2700000
        il     +- hc 0 idx
        ir     +- hc idx 0
        it     +- vc 0 idy
        ib     +- vc idy 0`,
      cxn: `
        3cd4 hc t
        3cd4 il it
        cd4  il ib
        cd4  hc b
        cd4  ir ib
        0    r vc
        3cd4 ir it
        pang xPos yPos`,
      rect: 'il it ir ib',
      paths: `
        moveTo xPos yPos
        lnTo x1 y1
        arcTo wd2 hd2 stAng1 swAng
        close`,
    },
    cloudCallout: {
      av: { adj1: -20833, adj2: 62500 },
      gd: `
        dxPos */ w adj1 100000
        dyPos */ h adj2 100000
        xPos  +- hc dxPos 0
        yPos  +- vc dyPos 0
        ht    cat2 hd2 dxPos dyPos
        wt    sat2 wd2 dxPos dyPos
        g2    cat2 wd2 ht wt
        g3    sat2 hd2 ht wt
        g4    +- hc g2 0
        g5    +- vc g3 0
        g6    +- g4 0 xPos
        g7    +- g5 0 yPos
        g8    mod g6 g7 0
        g9    */ ss 6600 21600
        g10   +- g8 0 g9
        g11   */ g10 1 3
        g12   */ ss 1800 21600
        g13   +- g11 g12 0
        g14   */ g13 g6 g8
        g15   */ g13 g7 g8
        g16   +- g14 xPos 0
        g17   +- g15 yPos 0
        g18   */ ss 4800 21600
        g19   */ g11 2 1
        g20   +- g18 g19 0
        g21   */ g20 g6 g8
        g22   */ g20 g7 g8
        g23   +- g21 xPos 0
        g24   +- g22 yPos 0
        g25   */ ss 1200 21600
        g26   */ ss 600 21600
        x23   +- xPos g26 0
        x24   +- g16 g25 0
        x25   +- g23 g12 0
        il    */ w 2977 21600
        it    */ h 3262 21600
        ir    */ w 17087 21600
        ib    */ h 17337 21600
        g27   */ w 67 21600
        g28   */ h 21577 21600
        g29   */ w 21582 21600
        g30   */ h 1235 21600
        pang  at2 dxPos dyPos`,
      cxn: `
        cd2  g27 vc
        cd4  hc g28
        0    g29 vc
        3cd4 hc g30
        pang xPos yPos`,
      rect: 'il it ir ib',
      paths: `
        path w=43200 h=43200
          moveTo 3900 14370
          arcTo 6753 9190 -11429249 7426832
          arcTo 5333 7267 -8646143 5396714
          arcTo 4365 5945 -8748475 5983381
          arcTo 4857 6595 -7859164 7034504
          arcTo 5333 7273 -4722533 6541615
          arcTo 6775 9220 -2776035 7816140
          arcTo 5785 7867 37501 6842000
          arcTo 6752 9215 1347096 6910353
          arcTo 7720 10543 3974558 4542661
          arcTo 4360 5918 -16496525 8804134
          arcTo 4345 5945 -14809710 9151131
          close
        path
          moveTo x23 yPos
          arcTo g26 g26 0 21600000
          close
        path
          moveTo x24 g17
          arcTo g25 g25 0 21600000
          close
        path
          moveTo x25 g24
          arcTo g12 g12 0 21600000
          close
        path w=43200 h=43200 fill=none
          moveTo 4693 26177
          arcTo 4345 5945 5204520 1585770
          moveTo 6928 34899
          arcTo 4360 5918 4416628 686848
          moveTo 16478 39090
          arcTo 6752 9215 8257449 844866
          moveTo 28827 34751
          arcTo 6752 9215 387196 959901
          moveTo 34129 22954
          arcTo 5785 7867 -4217541 4255042
          moveTo 41798 15354
          arcTo 5333 7273 1819082 1665090
          moveTo 38324 5426
          arcTo 4857 6595 -824660 891534
          moveTo 29078 3952
          arcTo 4857 6595 -8950887 1091722
          moveTo 22141 4720
          arcTo 4365 5945 -9809656 1061181
          moveTo 14000 5192
          arcTo 6753 9190 -4002417 739161
          moveTo 4127 15789
          arcTo 6753 9190 9459261 711490`,
    },
    line: {
      cxn: `
        cd4  l t
        3cd4 r b`,
      paths: `
        moveTo l t
        lnTo r b`,
    },
    bentConnector3: {
      av: { adj1: 50000 },
      gd: `
        x1 */ w adj1 100000`,
      rect: 'l t r b',
      paths: `
        path fill=none
          moveTo l t
          lnTo x1 t
          lnTo x1 b
          lnTo r b`,
    },
    curvedConnector3: {
      av: { adj1: 50000 },
      gd: `
        x2 */ w adj1 100000
        x1 +/ l x2 2
        x3 +/ r x2 2
        y3 */ h 3 4`,
      rect: 'l t r b',
      paths: `
        path fill=none
          moveTo l t
          cubicBezTo x1 t x2 hd4 x2 vc
          cubicBezTo x2 y3 x3 b r b`,
    },
    snip1Rect: {
      av: { adj: 16667 },
      gd: `
        a   pin 0 adj 50000
        dx1 */ ss a 100000
        x1  +- r 0 dx1
        it  */ dx1 1 2
        ir  +/ x1 r 2`,
      cxn: `
        0    r vc
        cd4  hc b
        cd2  l vc
        3cd4 hc t`,
      rect: 'l it ir b',
      paths: `
        moveTo l t
        lnTo x1 t
        lnTo r dx1
        lnTo r b
        lnTo l b
        close`,
    },
    plaque: {
      av: { adj: 16667 },
      gd: `
        a  pin 0 adj 50000
        x1 */ ss a 100000
        x2 +- r 0 x1
        y2 +- b 0 x1
        il */ x1 70711 100000
        ir +- r 0 il
        ib +- b 0 il`,
      cxn: `
        3cd4 hc t
        cd2  l vc
        cd4  hc b
        0    r vc`,
      rect: 'il il ir ib',
      paths: `
        moveTo l x1
        arcTo x1 x1 cd4 -5400000
        lnTo x2 t
        arcTo x1 x1 cd2 -5400000
        lnTo r y2
        arcTo x1 x1 3cd4 -5400000
        lnTo x1 b
        arcTo x1 x1 0 -5400000
        close`,
    },
    can: {
      av: { adj: 25000 },
      gd: `
        maxAdj */ 50000 h ss
        a      pin 0 adj maxAdj
        y1     */ ss a 200000
        y2     +- y1 y1 0
        y3     +- b 0 y1`,
      cxn: `
        3cd4 hc y2
        3cd4 hc t
        cd2  l vc
        cd4  hc b
        0    r vc`,
      rect: 'l y2 r y3',
      paths: `
        path stroke=false
          moveTo l y1
          arcTo wd2 y1 cd2 -10800000
          lnTo r y3
          arcTo wd2 y1 0 cd2
          close
        path fill=lighten stroke=false
          moveTo l y1
          arcTo wd2 y1 cd2 cd2
          arcTo wd2 y1 0 cd2
          close
        path fill=none
          moveTo r y1
          arcTo wd2 y1 0 cd2
          arcTo wd2 y1 cd2 cd2
          lnTo r y3
          arcTo wd2 y1 0 cd2
          lnTo l y1`,
    },
    cube: {
      av: { adj: 25000 },
      gd: `
        a  pin 0 adj 100000
        y1 */ ss a 100000
        y4 +- b 0 y1
        y2 */ y4 1 2
        y3 +/ y1 b 2
        x4 +- r 0 y1
        x2 */ x4 1 2
        x3 +/ y1 r 2`,
      cxn: `
        3cd4 x3 t
        3cd4 x2 y1
        cd2  l y3
        cd4  x2 b
        0    x4 y3
        0    r y2`,
      rect: 'l y1 x4 b',
      paths: `
        path stroke=false
          moveTo l y1
          lnTo x4 y1
          lnTo x4 b
          lnTo l b
          close
        path fill=darkenLess stroke=false
          moveTo x4 y1
          lnTo r t
          lnTo r y4
          lnTo x4 b
          close
        path fill=lightenLess stroke=false
          moveTo l y1
          lnTo y1 t
          lnTo r t
          lnTo x4 y1
          close
        path fill=none
          moveTo l y1
          lnTo y1 t
          lnTo r t
          lnTo r y4
          lnTo x4 b
          lnTo l b
          close
          moveTo l y1
          lnTo x4 y1
          lnTo r t
          moveTo x4 y1
          lnTo x4 b`,
    },
    heart: {
      gd: `
        dx1 */ w 49 48
        dx2 */ w 10 48
        x1  +- hc 0 dx1
        x2  +- hc 0 dx2
        x3  +- hc dx2 0
        x4  +- hc dx1 0
        y1  +- t 0 hd3
        il  */ w 1 6
        ir  */ w 5 6
        ib  */ h 2 3`,
      cxn: `
        3cd4 hc hd4
        cd4  hc b`,
      rect: 'il hd4 ir ib',
      paths: `
        moveTo hc hd4
        cubicBezTo x3 y1 x4 hd4 hc b
        cubicBezTo x1 hd4 x2 y1 hc hd4
        close`,
    },
    donut: {
      av: { adj: 25000 },
      gd: `
        a    pin 0 adj 50000
        dr   */ ss a 100000
        iwd2 +- wd2 0 dr
        ihd2 +- hd2 0 dr
        idx  cos wd2 2700000
        idy  sin hd2 2700000
        il   +- hc 0 idx
        ir   +- hc idx 0
        it   +- vc 0 idy
        ib   +- vc idy 0`,
      cxn: `
        3cd4 hc t
        3cd4 il it
        cd2  l vc
        cd4  il ib
        cd4  hc b
        cd4  ir ib
        0    r vc
        3cd4 ir it`,
      rect: 'il it ir ib',
      paths: `
        moveTo l vc
        arcTo wd2 hd2 cd2 cd4
        arcTo wd2 hd2 3cd4 cd4
        arcTo wd2 hd2 0 cd4
        arcTo wd2 hd2 cd4 cd4
        close
        moveTo dr vc
        arcTo iwd2 ihd2 cd2 -5400000
        arcTo iwd2 ihd2 cd4 -5400000
        arcTo iwd2 ihd2 0 -5400000
        arcTo iwd2 ihd2 3cd4 -5400000
        close`,
    },
    noSmoking: {
      av: { adj: 18750 },
      gd: `
        a      pin 0 adj 50000
        dr     */ ss a 100000
        iwd2   +- wd2 0 dr
        ihd2   +- hd2 0 dr
        ang    at2 w h
        ct     cos ihd2 ang
        st     sin iwd2 ang
        m      mod ct st 0
        n      */ iwd2 ihd2 m
        drd2   */ dr 1 2
        dang   at2 n drd2
        2dang  */ dang 2 1
        swAng  +- -10800000 2dang 0
        t3     at2 w h
        stAng1 +- t3 0 dang
        stAng2 +- stAng1 0 cd2
        ct1    cos ihd2 stAng1
        st1    sin iwd2 stAng1
        m1     mod ct1 st1 0
        n1     */ iwd2 ihd2 m1
        dx1    cos n1 stAng1
        dy1    sin n1 stAng1
        x1     +- hc dx1 0
        y1     +- vc dy1 0
        x2     +- hc 0 dx1
        y2     +- vc 0 dy1
        idx    cos wd2 2700000
        idy    sin hd2 2700000
        il     +- hc 0 idx
        ir     +- hc idx 0
        it     +- vc 0 idy
        ib     +- vc idy 0`,
      cxn: `
        3cd4 hc t
        3cd4 il it
        cd2  l vc
        cd4  il ib
        cd4  hc b
        cd4  ir ib
        0    r vc
        3cd4 ir it`,
      rect: 'il it ir ib',
      paths: `
        moveTo l vc
        arcTo wd2 hd2 cd2 cd4
        arcTo wd2 hd2 3cd4 cd4
        arcTo wd2 hd2 0 cd4
        arcTo wd2 hd2 cd4 cd4
        close
        moveTo x1 y1
        arcTo iwd2 ihd2 stAng1 swAng
        close
        moveTo x2 y2
        arcTo iwd2 ihd2 stAng2 swAng
        close`,
    },
    bracketPair: {
      av: { adj: 16667 },
      gd: `
        a  pin 0 adj 50000
        x1 */ ss a 100000
        x2 +- r 0 x1
        y2 +- b 0 x1
        il */ x1 29289 100000
        ir +- r 0 il
        ib +- b 0 il`,
      cxn: `
        3cd4 hc t
        cd2  l vc
        cd4  hc b
        0    r vc`,
      rect: 'il il ir ib',
      paths: `
        path stroke=false
          moveTo l x1
          arcTo x1 x1 cd2 cd4
          lnTo x2 t
          arcTo x1 x1 3cd4 cd4
          lnTo r y2
          arcTo x1 x1 0 cd4
          lnTo x1 b
          arcTo x1 x1 cd4 cd4
          close
        path fill=none
          moveTo x1 b
          arcTo x1 x1 cd4 cd4
          lnTo l x1
          arcTo x1 x1 cd2 cd4
          moveTo x2 t
          arcTo x1 x1 3cd4 cd4
          lnTo r y2
          arcTo x1 x1 0 cd4`,
    },
    bracePair: {
      av: { adj: 8333 },
      gd: `
        a  pin 0 adj 25000
        x1 */ ss a 100000
        x2 */ ss a 50000
        x3 +- r 0 x2
        x4 +- r 0 x1
        y2 +- vc 0 x1
        y3 +- vc x1 0
        y4 +- b 0 x1
        it */ x1 29289 100000
        il +- x1 it 0
        ir +- r 0 il
        ib +- b 0 it`,
      cxn: `
        3cd4 hc t
        cd2  l vc
        cd4  hc b
        0    r vc`,
      rect: 'il il ir ib',
      paths: `
        path stroke=false
          moveTo x2 b
          arcTo x1 x1 cd4 cd4
          lnTo x1 y3
          arcTo x1 x1 0 -5400000
          arcTo x1 x1 cd4 -5400000
          lnTo x1 x1
          arcTo x1 x1 cd2 cd4
          lnTo x3 t
          arcTo x1 x1 3cd4 cd4
          lnTo x4 y2
          arcTo x1 x1 cd2 -5400000
          arcTo x1 x1 3cd4 -5400000
          lnTo x4 y4
          arcTo x1 x1 0 cd4
          close
        path fill=none
          moveTo x2 b
          arcTo x1 x1 cd4 cd4
          lnTo x1 y3
          arcTo x1 x1 0 -5400000
          arcTo x1 x1 cd4 -5400000
          lnTo x1 x1
          arcTo x1 x1 cd2 cd4
          moveTo x3 t
          arcTo x1 x1 3cd4 cd4
          lnTo x4 y2
          arcTo x1 x1 cd2 -5400000
          arcTo x1 x1 3cd4 -5400000
          lnTo x4 y4
          arcTo x1 x1 0 cd4`,
    },
  };
  const lines = (text) => String(text ?? '').split('\n').map((s) => s.trim().split(/\s+/)).filter((l) => l[0]);
  const compile = (def) => {
    const pathLst = [];
    for (const [op, ...a] of lines(def.paths)) {
      if (op === 'path' || !pathLst.length) pathLst.push({ cmds: [] });
      const p = pathLst[pathLst.length - 1];
      if (op === 'path') for (const [k, v] of a.map((kv) => kv.split('='))) p[k] = v;
      else if (op === 'arcTo') p.cmds.push({ cmd: op, wR: a[0], hR: a[1], stAng: a[2], swAng: a[3] });
      else p.cmds.push({ cmd: op, pts: a.flatMap((v, i) => (i % 2 ? [] : [{ x: v, y: a[i + 1] }])) });
    }
    const [l, t, r, b] = (def.rect ?? 'l t r b').split(' ');
    return {
      avLst: Object.entries(def.av ?? {}).map(([name, fmla]) => ({ name, fmla })),
      gdLst: lines(def.gd).map(([name, ...f]) => ({ name, fmla: f.join(' ') })),
      cxnLst: lines(def.cxn).map(([ang, x, y]) => ({ ang, x, y })),
      rect: { l, t, r, b },
      pathLst,
    };
  };
  const compiled = new Map();
  const model = (prst) => {
    if (!compiled.has(prst)) compiled.set(prst, compile(PRESETS[prst]));
    return compiled.get(prst);
  };

  const path = (shape) => {
    const { prst, avLst, w, h } = shape || {};
    const known = typeof prst === 'string' && Object.hasOwn(PRESETS, prst);
    const m = model(known ? prst : 'rect');
    const adjusts = new Set(m.avLst.map((g) => g.name));
    const out = custom({ ...m, avLst: [...m.avLst, ...list(avLst).filter((g) => adjusts.has(g.name))] }, w, h);
    return known ? { prst, ...out } : { prst: 'rect', unknown: String(prst ?? ''), ...out };
  };

  return { path, custom, guides, presets: Object.freeze(Object.keys(PRESETS)) };
})();

if (typeof module !== 'undefined') module.exports = GZ_PPTX_GEOM; else GZ_PPTX_GEOM;
