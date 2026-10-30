// DrawingML shape geometry (lib/pptx-geom.js): the guide formula evaluator and its built-in guides, arcTo drawn as SVG
// arcs, custom geometry (custGeom), and every preset against stored path snapshots.
// The snapshots are test/fixtures/pptx-geom/<preset>.json. After a reviewed change to the geometry, rewrite them with
//   GZ_GEOM_SNAPSHOTS=write node --test test/pptx-geom.test.js
// and read the diff before committing it. Regeneration is refused when CI is set.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const G = require('../lib/pptx-geom.js');

const SNAPSHOTS = path.join(__dirname, 'fixtures', 'pptx-geom');
const WRITE = process.env.GZ_GEOM_SNAPSHOTS === 'write';

const PRESETS = ['rect', 'roundRect', 'ellipse', 'triangle', 'rtTriangle', 'diamond', 'parallelogram', 'trapezoid', 'pentagon',
  'hexagon', 'octagon', 'star5', 'rightArrow', 'leftArrow', 'upArrow', 'downArrow', 'leftRightArrow', 'chevron', 'homePlate',
  'flowChartProcess', 'flowChartDecision', 'flowChartTerminator', 'wedgeRectCallout', 'wedgeRoundRectCallout',
  'wedgeEllipseCallout', 'cloudCallout', 'line', 'bentConnector3', 'curvedConnector3', 'snip1Rect', 'plaque', 'can', 'cube',
  'heart', 'donut', 'noSmoking', 'bracketPair', 'bracePair'];
// A non-default value for every adjust a preset has.
const ADJUSTED = {
  roundRect: { adj: 40000 }, triangle: { adj: 20000 }, parallelogram: { adj: 60000 }, trapezoid: { adj: 40000 },
  pentagon: { hf: 90000, vf: 100000 }, hexagon: { adj: 40000, vf: 100000 }, octagon: { adj: 15000 },
  star5: { adj: 35000, hf: 90000, vf: 100000 }, rightArrow: { adj1: 30000, adj2: 80000 }, leftArrow: { adj1: 30000, adj2: 80000 },
  upArrow: { adj1: 30000, adj2: 80000 }, downArrow: { adj1: 30000, adj2: 80000 }, leftRightArrow: { adj1: 70000, adj2: 30000 },
  chevron: { adj: 25000 }, homePlate: { adj: 25000 }, wedgeRectCallout: { adj1: 40000, adj2: -70000 },
  wedgeRoundRectCallout: { adj1: 40000, adj2: -70000, adj3: 30000 }, wedgeEllipseCallout: { adj1: 40000, adj2: -70000 },
  cloudCallout: { adj1: 45000, adj2: 70000 }, bentConnector3: { adj1: 25000 }, curvedConnector3: { adj1: 75000 },
  snip1Rect: { adj: 35000 }, plaque: { adj: 30000 }, can: { adj: 40000 }, cube: { adj: 10000 }, donut: { adj: 10000 },
  noSmoking: { adj: 10000 }, bracketPair: { adj: 30000 }, bracePair: { adj: 15000 },
};
// 2.5 × 1.5 in and 1 × 3 in, in EMU: the short side is the height in one and the width in the other.
const SIZES = [[2286000, 1371600], [914400, 2743200]];

const gd = (name, fmla) => ({ name, fmla });
const value = (fmla, w = 1200, h = 600) => G.guides({ gdLst: [gd('x', fmla)] }, w, h).x;
const near = (actual, expected, tolerance, message) => assert.ok(Math.abs(actual - expected) <= tolerance, `${message ?? ''} ${actual} is not ${expected} ± ${tolerance}`);

// ---- formulas ----------------------------------------------------------------------------------------------------

test('each formula computes what ECMA-376 §20.1.9.11 says it does', () => {
  assert.equal(value('*/ 6 4 3'), 8);
  assert.equal(value('+- 6 4 3'), 7);
  assert.equal(value('+/ 6 4 5'), 2);
  assert.equal(value('?: 1 10 20'), 10);
  assert.equal(value('?: 0 10 20'), 20, 'only x > 0 picks y');
  assert.equal(value('?: -1 10 20'), 20);
  assert.equal(value('abs -7'), 7);
  assert.equal(value('abs 7'), 7);
  near(value('at2 1 1'), 2700000, 1e-6, 'at2 x y is atan(y / x) in 60000ths of a degree');
  near(value('at2 -1 0'), 10800000, 1e-6, 'at2 keeps the quadrant');
  near(value('at2 0 -1'), -5400000, 1e-6);
  near(value('cat2 10 3 4'), 6, 1e-12);
  near(value('sat2 10 3 4'), 8, 1e-12);
  near(value('cat2 10 -3 4'), -6, 1e-12, 'cat2 keeps the quadrant');
  near(value('cos 10 cd2'), -10, 1e-12);
  near(value('cos 10 5400000'), 0, 1e-12);
  near(value('sin 10 5400000'), 10, 1e-12);
  near(value('sin 10 -5400000'), -10, 1e-12);
  near(value('tan 10 2700000'), 10, 1e-12);
  assert.equal(value('max 3 -5'), 3);
  assert.equal(value('min 3 -5'), -5);
  assert.equal(value('mod 3 4 12'), 13);
  assert.equal(value('pin 0 5 10'), 5);
  assert.equal(value('pin 0 -5 10'), 0);
  assert.equal(value('pin 0 15 10'), 10);
  assert.equal(value('sqrt 144'), 12);
  assert.equal(value('val 42'), 42);
  assert.equal(value('val -8333'), -8333);
});

test('three-argument formulas group as the spec writes them, not by arithmetic precedence', () => {
  assert.equal(value('+/ 1 2 3'), 1, '(x + y) / z, not x + y / z');
  assert.equal(value('+- 1 2 3'), 0, '(x + y) - z');
  assert.equal(value('*/ 2 3 4'), 1.5, '(x * y) / z');
  assert.equal(value('*/ w 1 3', 1200), 400);
});

test('pin checks the low bound first, so a low bound above the high one wins below and loses above', () => {
  assert.equal(value('pin 10 5 0'), 10);
  assert.equal(value('pin 10 20 0'), 0);
  assert.equal(value('pin 5 5 5'), 5);
  assert.equal(value('pin 0 adj 50000'), 0, 'an adjust that is not there reads 0');
});

test('division by zero, a negative square root and broken formulas give 0, never NaN or Infinity', () => {
  assert.equal(value('*/ 5 6 0'), 0);
  assert.equal(value('*/ 0 6 0'), 0);
  assert.equal(value('+/ 5 6 0'), 0);
  assert.equal(value('*/ ss 1 h', 1200, 0), 0, 'a zero-height shape');
  assert.equal(value('sqrt -4'), 0);
  assert.equal(value('at2 0 0'), 0);
  assert.equal(value('*/ 5'), 0, 'missing arguments');
  assert.equal(value('nope 1 2 3'), 0, 'an unknown formula');
  assert.equal(value(''), 0);
  assert.equal(value('val missing'), 0, 'an unknown name');
});

test('the built-in guides of ECMA-376 §20.1.10.56, and the three the preset addendum also uses', () => {
  const v = G.guides({}, 1200, 600);
  const want = {
    w: 1200, h: 600, l: 0, t: 0, r: 1200, b: 600, hc: 600, vc: 300, ss: 600, ls: 1200,
    wd2: 600, wd3: 400, wd4: 300, wd5: 240, wd6: 200, wd8: 150, wd10: 120, wd12: 100, wd32: 37.5,
    hd2: 300, hd3: 200, hd4: 150, hd5: 120, hd6: 100, hd8: 75, hd10: 60,
    ssd2: 300, ssd4: 150, ssd6: 100, ssd8: 75, ssd16: 37.5, ssd32: 18.75,
    cd2: 10800000, cd4: 5400000, cd8: 2700000, '3cd4': 16200000, '3cd8': 8100000, '5cd8': 13500000, '7cd8': 18900000,
  };
  for (const [k, n] of Object.entries(want)) assert.equal(v[k], n, k);
  const tall = G.guides({}, 300, 900);
  assert.equal(tall.ss, 300);
  assert.equal(tall.ls, 900);
});

test('guides run in order: each sees the adjusts and the guides before it, and a later name replaces an earlier one', () => {
  const v = G.guides({
    avLst: [gd('adj', 'val 25000')],
    gdLst: [gd('early', '+- later 0 0'), gd('later', 'val 5'), gd('a', '*/ w adj 100000'), gd('a', '+- a 1 0'), gd('wd2', 'val 7'), gd('b2', '+- wd2 0 0')],
  }, 1200, 600);
  assert.equal(v.early, 0, 'a guide cannot use one that comes after it');
  assert.equal(v.a, 301);
  assert.equal(v.wd2, 7, 'a guide may take a built-in name');
  assert.equal(v.b2, 7);
});

test('a name that starts with digits is a name, not a number', () => {
  // noSmoking's addendum defines a guide called 2dang; 3cd4 is a built-in.
  const v = G.guides({ gdLst: [gd('2dang', 'val 7'), gd('x', '*/ 2dang 2 1'), gd('y', '+- 3cd4 0 0'), gd('z', '+-  x   1 0')] }, 100, 100);
  assert.equal(v.x, 14);
  assert.equal(v.y, 16200000);
  assert.equal(v.z, 15, 'extra spaces between arguments');
});

test('adjusts come as numbers or as val formulas, in a list or by name', () => {
  for (const avLst of [{ adj: 25000 }, { adj: 'val 25000' }, [gd('adj', 'val 25000')], [gd('adj', 25000)]]) {
    assert.equal(G.guides({ avLst, gdLst: [gd('x', '*/ w adj 100000')] }, 1000, 500).x, 250, JSON.stringify(avLst));
  }
});

// ---- arcTo ---------------------------------------------------------------------------------------------------------

const one = (cmds, w, h, extra = {}) => G.custom({ pathLst: [{ ...extra, cmds }] }, w, h).paths[0].d;
const moveTo = (x, y) => ({ cmd: 'moveTo', pts: [{ x, y }] });
const lnTo = (x, y) => ({ cmd: 'lnTo', pts: [{ x, y }] });
const arcTo = (wR, hR, stAng, swAng) => ({ cmd: 'arcTo', wR, hR, stAng, swAng });
const close = { cmd: 'close' };

test('arcTo turns clockwise for a positive swing and counterclockwise for a negative one', () => {
  assert.equal(one([moveTo(0, 1000), arcTo(1000, 1000, 'cd2', 'cd4')], 2000, 2000), 'M 0 1000 A 1000 1000 0 0 1 1000 0');
  assert.equal(one([moveTo(1000, 0), arcTo(1000, 1000, '3cd4', -5400000)], 2000, 2000), 'M 1000 0 A 1000 1000 0 0 0 0 1000');
});

test('arcTo starts on its ellipse at the pen, so the pen and the start angle place the centre', () => {
  assert.equal(one([moveTo(1000, 1000), arcTo(1000, 1000, 0, 'cd4')], 2000, 2000), 'M 1000 1000 A 1000 1000 0 0 1 0 2000');
});

test('arcTo angles are angles seen from the ellipse centre, not the ellipse parameter', () => {
  // A 2:1 ellipse, centre (2e6, 1e6), from angle 0 through 45°: the end is on the 45° ray from the centre,
  // (2e6, 1e6) + (2e6, 2e6) / √5. Read as the parameter it would be (2e6, 1e6) + (√2e6, √2e6 / 2) = (3414214, 1707107).
  assert.equal(one([moveTo(4000000, 1000000), arcTo(2000000, 1000000, 0, 'cd8')], 4000000, 2000000),
    'M 4000000 1000000 A 2000000 1000000 0 0 1 2894427 1894427');
});

test('a full or larger swing draws the whole ellipse in quarters, once', () => {
  const whole = 'M 0 500 A 1000 500 0 0 1 1000 0 A 1000 500 0 0 1 2000 500 A 1000 500 0 0 1 1000 1000 A 1000 500 0 0 1 0 500';
  assert.equal(one([moveTo(0, 500), arcTo(1000, 500, 'cd2', 21600000)], 2000, 1000), whole);
  assert.equal(one([moveTo(0, 500), arcTo(1000, 500, 'cd2', 43200000)], 2000, 1000), whole);
});

test('an arc after close starts where the closed subpath began', () => {
  assert.equal(one([moveTo(0, 1000), lnTo(500, 500), close, arcTo(1000, 1000, 'cd2', 'cd4')], 2000, 2000),
    'M 0 1000 L 500 500 Z A 1000 1000 0 0 1 1000 0');
});

test('an arc with no radius or no swing draws nothing', () => {
  assert.equal(G.path({ prst: 'roundRect', avLst: { adj: 0 }, w: 1000, h: 500 }).paths[0].d, 'M 0 0 L 1000 0 L 1000 500 L 0 500 Z');
  assert.equal(one([moveTo(0, 0), arcTo(1000, 1000, 0, 0), lnTo(5, 5)], 10, 10), 'M 0 0 L 5 5');
});

test('in a path with its own w and h, arcs are drawn in that space and then stretched to the shape', () => {
  // Path space 2 × 2: a unit circle about (1, 1) from its left through 45°, ending at (1 − √½, 1 − √½), then stretched
  // to 2e6 × 1e6. Reading the angle on the stretched ellipse instead would end at (552786, 52786).
  assert.equal(one([moveTo(0, 1), arcTo(1, 1, 'cd2', 'cd8')], 2000000, 1000000, { w: 2, h: 2 }),
    'M 0 500000 A 1000000 500000 0 0 1 292893 146447');
});

// ---- SVG arcs, read back the way a browser reads them (SVG 1.1 F.6.5) ----------------------------------------------

const segments = (d) => [...d.matchAll(/([MLAQCZ])([^MLAQCZ]*)/g)].map(([, c, args]) => [c, ...args.trim().split(/\s+/).filter(Boolean).map(Number)]);
const arcCentre = (x1, y1, rx, ry, large, sweep, x2, y2) => {
  const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
  const lambda = (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry);
  if (lambda > 1) { rx *= Math.sqrt(lambda); ry *= Math.sqrt(lambda); }
  const num = rx * rx * ry * ry - rx * rx * dy * dy - ry * ry * dx * dx;
  const k = (large === sweep ? -1 : 1) * Math.sqrt(Math.max(0, num / (rx * rx * dy * dy + ry * ry * dx * dx)));
  const cx = (k * rx * dy) / ry, cy = (-k * ry * dx) / rx;
  const angle = (ux, uy, vx, vy) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  let turn = angle((dx - cx) / rx, (dy - cy) / ry, (-dx - cx) / rx, (-dy - cy) / ry);
  if (!sweep && turn > 0) turn -= 2 * Math.PI;
  if (sweep && turn < 0) turn += 2 * Math.PI;
  return { x: cx + (x1 + x2) / 2, y: cy + (y1 + y2) / 2, turn: (turn * 180) / Math.PI, lambda };
};
const arcs = (d) => {
  const out = [];
  let x = 0, y = 0, sx = 0, sy = 0;
  for (const [c, ...n] of segments(d)) {
    if (c === 'M') { [x, y] = n; [sx, sy] = n; } else if (c === 'Z') { [x, y] = [sx, sy]; } else if (c === 'A') {
      out.push({ ...arcCentre(x, y, n[0], n[1], n[3], n[4], n[5], n[6]), rx: n[0], ry: n[1] });
      [x, y] = n.slice(5);
    } else [x, y] = n.slice(-2);
  }
  return out;
};

test('every preset arc ends on its own ellipse and turns at most a quarter, so its SVG flags are unambiguous', () => {
  for (const prst of PRESETS) for (const [w, h] of SIZES) for (const avLst of [undefined, ADJUSTED[prst]]) {
    for (const p of G.path({ prst, avLst, w, h }).paths) for (const a of arcs(p.d)) {
      assert.ok(a.lambda <= 1 + 1e-3, `${prst} ${w}×${h}: an arc endpoint is off its ellipse (λ ${a.lambda})`);
      assert.ok(Math.abs(a.turn) <= 90 + 1e-3, `${prst} ${w}×${h}: an arc turns ${a.turn}°`);
    }
  }
});

test('read back by SVG rules, the ellipse, roundRect, donut and can arcs have the centres and turns of their definitions', () => {
  const [w, h] = SIZES[0];
  const ellipse = arcs(G.path({ prst: 'ellipse', w, h }).paths[0].d);
  assert.equal(ellipse.length, 4);
  for (const a of ellipse) { near(a.x, w / 2, 2); near(a.y, h / 2, 2); near(a.turn, 90, 0.01); }

  const x1 = (Math.min(w, h) * 16667) / 100000;
  const corners = arcs(G.path({ prst: 'roundRect', w, h }).paths[0].d);
  assert.equal(corners.length, 4);
  [[x1, x1], [w - x1, x1], [w - x1, h - x1], [x1, h - x1]].forEach(([x, y], i) => {
    near(corners[i].x, x, 2, `corner ${i}`); near(corners[i].y, y, 2, `corner ${i}`); near(corners[i].turn, 90, 0.01, `corner ${i}`);
  });

  const donut = arcs(G.path({ prst: 'donut', w, h }).paths[0].d);
  assert.equal(donut.length, 8);
  for (const a of donut) { near(a.x, w / 2, 2); near(a.y, h / 2, 2); }
  near(donut.slice(0, 4).reduce((s, a) => s + a.turn, 0), 360, 0.01, 'the outer ring turns clockwise');
  near(donut.slice(4).reduce((s, a) => s + a.turn, 0), -360, 0.01, 'the hole turns back, so it stays empty');

  const y1 = (Math.min(w, h) * 25000) / 200000;
  const body = arcs(G.path({ prst: 'can', w, h }).paths[0].d);
  near(body.slice(0, 2).reduce((s, a) => s + a.turn, 0), -180, 0.01, 'the can body\'s top edge turns back over the top');
  for (const a of body.slice(0, 2)) { near(a.x, w / 2, 2); near(a.y, y1, 2); }
});

// ---- presets -------------------------------------------------------------------------------------------------------

test('the presets are the ones Slides draws', () => {
  assert.deepEqual([...G.presets].sort(), [...PRESETS].sort());
  assert.ok(Object.isFrozen(G.presets));
});

test('an unknown preset draws as rect and says which name it did not know', () => {
  const out = G.path({ prst: 'wave', w: 1000, h: 500 });
  assert.equal(out.prst, 'rect');
  assert.equal(out.unknown, 'wave');
  assert.deepEqual(out.paths, [{ d: 'M 0 0 L 1000 0 L 1000 500 L 0 500 Z', fill: 'norm', stroke: true }]);
  assert.deepEqual(out.rect, { l: 0, t: 0, r: 1000, b: 500 });
  assert.equal(G.path({ prst: 'rect', w: 1000, h: 500 }).unknown, undefined);
  assert.equal(G.path({ w: 10, h: 10 }).prst, 'rect');
});

test('roundRect: its default and given adjusts, pinned to the range its guides allow', () => {
  const at = (adj) => G.path({ prst: 'roundRect', avLst: adj === undefined ? undefined : { adj }, w: 2000000, h: 1000000 });
  const x1 = 166670; // ss × 16667 / 100000
  assert.equal(at().paths[0].d, `M 0 ${x1} A ${x1} ${x1} 0 0 1 ${x1} 0 L ${2000000 - x1} 0 A ${x1} ${x1} 0 0 1 2000000 ${x1} `
    + `L 2000000 ${1000000 - x1} A ${x1} ${x1} 0 0 1 ${2000000 - x1} 1000000 L ${x1} 1000000 A ${x1} ${x1} 0 0 1 0 ${1000000 - x1} Z`);
  assert.deepEqual(at().rect, { l: 48816, t: 48816, r: 1951184, b: 951184 }, 'the text box: il = x1 × 29289 / 100000 = 48815.98');
  assert.deepEqual(at(16667), at());
  assert.deepEqual(at(80000), at(50000), 'adj stops at 50000');
  assert.deepEqual(at(-5), at(0));
  assert.deepEqual(at().cxn, [{ x: 1000000, y: 0, ang: 270 }, { x: 0, y: 500000, ang: 180 }, { x: 1000000, y: 1000000, ang: 90 }, { x: 2000000, y: 500000, ang: 0 }]);
});

test('every non-default adjust changes its preset', () => {
  for (const [prst, avLst] of Object.entries(ADJUSTED)) {
    const [w, h] = SIZES[0];
    assert.notDeepEqual(G.path({ prst, avLst, w, h }), G.path({ prst, w, h }), prst);
  }
});

test('the multi-part presets keep each part\'s fill and stroke', () => {
  const parts = (prst) => G.path({ prst, w: 2000000, h: 1000000 }).paths.map(({ fill, stroke }) => `${fill}${stroke ? '' : ' unstroked'}`);
  assert.deepEqual(parts('can'), ['norm unstroked', 'lighten unstroked', 'none']);
  assert.deepEqual(parts('cube'), ['norm unstroked', 'darkenLess unstroked', 'lightenLess unstroked', 'none']);
  assert.deepEqual(parts('bracketPair'), ['norm unstroked', 'none']);
  assert.deepEqual(parts('bracePair'), ['norm unstroked', 'none']);
  assert.deepEqual(parts('cloudCallout'), ['norm', 'norm', 'norm', 'norm', 'none']);
  assert.deepEqual(parts('bentConnector3'), ['none']);
});

test('a preset scales with its shape: twice the size draws every point twice as far', () => {
  for (const prst of PRESETS) for (const [w, h] of SIZES) for (const avLst of [undefined, ADJUSTED[prst]]) {
    const small = G.path({ prst, avLst, w, h }), big = G.path({ prst, avLst, w: 2 * w, h: 2 * h });
    small.paths.forEach((p, i) => {
      const a = segments(p.d), b = segments(big.paths[i].d);
      assert.equal(b.length, a.length, prst);
      a.forEach(([c, ...n], j) => {
        assert.equal(b[j][0], c, prst);
        n.forEach((v, k) => {
          if (c === 'A' && k >= 2 && k <= 4) assert.equal(b[j][k + 1], v, `${prst}: arc flags`);
          else near(b[j][k + 1], 2 * v, 2, `${prst} ${c}`);
        });
      });
    });
    for (const k of ['l', 't', 'r', 'b']) near(big.rect[k], 2 * small.rect[k], 2, `${prst} rect.${k}`);
  }
});

// ---- custom geometry -----------------------------------------------------------------------------------------------

test('custGeom: adjusts and guides, a path in shape space, a path in its own space, connection sites and the text box', () => {
  const model = {
    avLst: [gd('adj', 'val 25000')],
    gdLst: [gd('x1', '*/ w adj 100000'), gd('y1', '*/ h adj 100000'), gd('x2', '+- r 0 x1'), gd('r1', 'min x1 y1')],
    cxnLst: [{ ang: 'cd4', x: 'hc', y: 'b' }, { ang: '3cd4', x: 'x1', y: 't' }],
    rect: { l: 'x1', t: 'y1', r: 'x2', b: 'b' },
    pathLst: [
      { cmds: [moveTo('x1', 't'), lnTo('x2', 't'), arcTo('r1', 'r1', '3cd4', 'cd4'), lnTo('r', 'b'), lnTo('l', 'b'), close] },
      { w: '100', h: '100', fill: 'darken', stroke: 'false', cmds: [
        moveTo('50', '50'),
        { cmd: 'quadBezTo', pts: [{ x: '100', y: '0' }, { x: '100', y: '50' }] },
        { cmd: 'cubicBezTo', pts: [{ x: '100', y: '100' }, { x: '0', y: '100' }, { x: '0', y: '50' }] },
        lnTo('hc', 't'),
        close,
      ] },
    ],
  };
  assert.deepEqual(G.custom(model, 4000000, 2000000), {
    paths: [
      // x1 = 1e6, y1 = 5e5, x2 = 3e6, r1 = 5e5; the arc's centre is (3e6, 5e5).
      { d: 'M 1000000 0 L 3000000 0 A 500000 500000 0 0 1 3500000 500000 L 4000000 2000000 L 0 2000000 Z', fill: 'norm', stroke: true },
      // Stretched 40000 × 20000 from its 100 × 100 space, where hc is 50.
      { d: 'M 2000000 1000000 Q 4000000 0 4000000 1000000 C 4000000 2000000 0 2000000 0 1000000 L 2000000 0 Z', fill: 'darken', stroke: false },
    ],
    rect: { l: 1000000, t: 500000, r: 3000000, b: 2000000 },
    cxn: [{ x: 2000000, y: 2000000, ang: 90 }, { x: 1000000, y: 0, ang: 270 }],
  });
});

test('custGeom: what a file leaves out or gets wrong draws something sensible and never throws', () => {
  assert.deepEqual(G.custom({}, 100, 50), { paths: [], rect: { l: 0, t: 0, r: 100, b: 50 }, cxn: [] });
  assert.deepEqual(G.custom(null, 100, 50), { paths: [], rect: { l: 0, t: 0, r: 100, b: 50 }, cxn: [] });
  assert.equal(one([lnTo(5, 5)], 10, 10), 'M 0 0 L 5 5', 'a path that does not start with moveTo starts at 0 0');
  assert.equal(one([moveTo(1, 1), { cmd: 'squiggle' }, { cmd: 'lnTo' }, lnTo(2, 'nowhere')], 10, 10), 'M 1 1 L 2 0', 'unknown commands and missing points are skipped; unknown names are 0');
  assert.equal(G.custom({ pathLst: [{ fill: 'sparkly', cmds: [] }] }, 10, 10).paths[0].fill, 'norm');
});

test('custGeom: non-finite numeric strings and stretched coordinates become zero', () => {
  assert.deepEqual(G.custom({
    pathLst: [{ w: 1, h: 1, cmds: [moveTo('1e309', '-1e309'), lnTo('1e308', '1e308')] }],
    rect: { l: '1e309', t: '-1e309', r: Infinity, b: NaN },
    cxnLst: [{ x: '1e309', y: -Infinity, ang: '1e309' }],
  }, 10, 10), {
    paths: [{ d: 'M 0 0 L 0 0', fill: 'norm', stroke: true }],
    rect: { l: 0, t: 0, r: 0, b: 0 },
    cxn: [{ x: 0, y: 0, ang: 0 }],
  });
});

// ---- snapshots -----------------------------------------------------------------------------------------------------

test('CI refuses snapshot regeneration before writing any fixture', () => {
  const child = spawnSync(process.execPath, ['--test-name-pattern', '^every preset matches its snapshot', '-e', `
    require('node:fs').writeFileSync = () => { throw Error('snapshot write attempted'); };
    require(${JSON.stringify(__filename)});
  `], { env: { ...process.env, NODE_TEST_CONTEXT: undefined, CI: 'true', GZ_GEOM_SNAPSHOTS: 'write' }, encoding: 'utf8' });
  assert.ifError(child.error);
  const output = child.stdout + child.stderr;
  assert.notEqual(child.status, 0, output);
  assert.match(output, /Snapshot regeneration is disabled in CI/);
  assert.doesNotMatch(output, /snapshot write attempted/);
});

const casesFor = (prst) => [
  ...SIZES.map(([w, h]) => ({ w, h })),
  ...(ADJUSTED[prst] ? [{ w: SIZES[0][0], h: SIZES[0][1], avLst: ADJUSTED[prst] }] : []),
];

test('every preset matches its snapshot at two sizes and with its adjusts changed', () => {
  assert.ok(!(WRITE && process.env.CI), 'Snapshot regeneration is disabled in CI');
  if (WRITE) fs.mkdirSync(SNAPSHOTS, { recursive: true });
  for (const prst of PRESETS) {
    const file = path.join(SNAPSHOTS, `${prst}.json`);
    const now = { prst, cases: casesFor(prst).map((c) => ({ ...c, out: G.path({ prst, ...c }) })) };
    if (WRITE) fs.writeFileSync(file, `${JSON.stringify(now, null, 2)}\n`);
    assert.ok(fs.existsSync(file), `${prst} has no snapshot: run with GZ_GEOM_SNAPSHOTS=write`);
    assert.deepEqual(now, JSON.parse(fs.readFileSync(file, 'utf8')), `${prst} differs from ${path.relative(process.cwd(), file)}`);
  }
  const stale = fs.readdirSync(SNAPSHOTS).filter((f) => !PRESETS.includes(f.replace(/\.json$/, '')));
  assert.deepEqual(stale, [], 'snapshots for presets the module does not have');
});
