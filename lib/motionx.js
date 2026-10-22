// Look parts that move: the parts that don't touch the page, so node can test
// them. x.anim becomes CSS text (a @keyframes per moment, and values for the knobs motion.css reads); x.fx, x.cursor and
// x.type become the particles features/motionx.js draws, and x.pointer names the pointer set features/lookx.js shows. Everything arrives already cleaned (lib/lookparts.js), and is clamped
// again here anyway: the CSS is built from numbers and names looked up in the tables below, never from a string of the
// input. Classic script; module.exports for node. Loaded on demand (features/motionx.js asks for it): a second injection
// keeps the first.
var GZ_MX = globalThis.GZ_MX || (() => {
  const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
  const num = (v, lo, hi, d) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
  const int = (v, lo, hi, d) => Math.round(num(v, lo, hi, d));
  const fmt = (v) => String(Math.round(v * 1000) / 1000); // never an exponent in this range; -0 prints 0

  // ---- animations: moments → CSS --------------------------------------------------------------------------------------
  // The moments that play once as something appears, with the knob in motion.css each one feeds (--gz-x-<knob> is read by
  // --gz-<knob>) and that knob's own length in ms. The two that hold a state while it lasts (hover, press) feed lift/press.
  const ENTERING = { 'page.enter': ['enter-page', 450], 'panel.enter': ['enter-panel', 300], 'card.enter': ['enter', 600], 'tile.enter': ['enter-tile', 600], 'rail.open': ['rail-open', 300], 'tooltip.in': ['tip-in', 160] };
  const MOMENTS = [...Object.keys(ENTERING), 'card.hover', 'button.press'];
  // A stop's keys and their limits.
  const RANGE = { x: [-200, 200], y: [-200, 200], sc: [0.5, 1.5], r: [-180, 180], kx: [-30, 30], ky: [-30, 30], o: [0, 1], bl: [0, 20], br: [0, 2], sa: [0, 2], hu: [-180, 180] };
  // The names an easing may take. The motion.css curves stay Glaze's, so the level (Expressive's spring) still shapes them.
  const EASES = { linear: 'linear', ease: 'ease', 'ease-in': 'ease-in', 'ease-out': 'ease-out', 'ease-in-out': 'ease-in-out', smooth: 'var(--gz-ease)', spring: 'var(--gz-spring)' };
  const easing = (e) => {
    if (Array.isArray(e) && e.length === 4 && e.every((n) => typeof n === 'number' && Number.isFinite(n))) {
      return `cubic-bezier(${fmt(num(e[0], 0, 1))},${fmt(num(e[1], -3, 3))},${fmt(num(e[2], 0, 1))},${fmt(num(e[3], -3, 3))})`;
    }
    return typeof e === 'string' && Object.hasOwn(EASES, e) ? EASES[e] : 'var(--gz-ease)';
  };
  const stops = (raw) => {
    if (!Array.isArray(raw)) return [];
    const list = raw.filter(isObj).slice(0, 8).map((s, i, all) => {
      const out = { at: num(s.at, 0, 1, all.length > 1 ? i / (all.length - 1) : 0) };
      for (const [k, [lo, hi]] of Object.entries(RANGE)) { const v = num(s[k], lo, hi, null); if (v !== null) out[k] = v; }
      return out;
    });
    return list.sort((a, b) => a.at - b.at); // stable: stops at the same place keep their order
  };
  const MOVE = ['x', 'y'], SKEW = ['kx', 'ky'], TF = ['x', 'y', 'r', 'kx', 'ky', 'sc'], FL = ['bl', 'br', 'sa', 'hu'];
  const has = (s, ks) => ks.some((k) => k in s);
  // One transform / filter value lists the same functions in every stop that sets one, so the browser blends them
  // function by function (a turn of 180° stays a turn, not a matrix).
  const used = (list) => ({ move: list.some((s) => has(s, MOVE)), rot: list.some((s) => 'r' in s), skew: list.some((s) => has(s, SKEW)), sc: list.some((s) => 'sc' in s),
    bl: list.some((s) => 'bl' in s), br: list.some((s) => 'br' in s), sa: list.some((s) => 'sa' in s), hu: list.some((s) => 'hu' in s) });
  const transform = (s, u) => [u.move && `translate(${fmt(s.x ?? 0)}px,${fmt(s.y ?? 0)}px)`, u.rot && `rotate(${fmt(s.r ?? 0)}deg)`,
    u.skew && `skew(${fmt(s.kx ?? 0)}deg,${fmt(s.ky ?? 0)}deg)`, u.sc && `scale(${fmt(s.sc ?? 1)})`].filter(Boolean).join(' ');
  const filter = (s, u) => [u.bl && `blur(${fmt(s.bl ?? 0)}px)`, u.br && `brightness(${fmt(s.br ?? 1)})`, u.sa && `saturate(${fmt(s.sa ?? 1)})`,
    u.hu && `hue-rotate(${fmt(s.hu ?? 0)}deg)`].filter(Boolean).join(' ');
  // A stop sets only the properties it names: the rest blend between the stops around it.
  const declare = (s, u) => [has(s, TF) && `transform:${transform(s, u)}`, 'o' in s && `opacity:${fmt(s.o)}`, has(s, FL) && `filter:${filter(s, u)}`].filter(Boolean).join(';');
  // A delay is a hold on the first stop: the knobs' users (card staggers) set animation-delay themselves, which would
  // replace one given in the shorthand.
  const frames = (list, ms, delay) => {
    const u = used(list), total = ms + delay;
    const rows = list.map((s) => `${fmt(((delay + s.at * ms) / total) * 100)}%{${declare(s, u)}}`);
    if (delay > 0) rows.unshift(`0%{${declare(list[0], u)}}`);
    return rows.join('');
  };
  // 53-bit string hash (cyrb53): the same animation gets the same name, so two moments with one look share a @keyframes.
  const hash = (str) => {
    let a = 0xdeadbeef, b = 0x41c6ce57;
    for (let i = 0; i < str.length; i++) { const c = str.charCodeAt(i); a = Math.imul(a ^ c, 2654435761); b = Math.imul(b ^ c, 1597334677); }
    a = Math.imul(a ^ (a >>> 16), 2246822507) ^ Math.imul(b ^ (b >>> 13), 3266489909);
    b = Math.imul(b ^ (b >>> 16), 2246822507) ^ Math.imul(a ^ (a >>> 13), 3266489909);
    return (4294967296 * (2097151 & b) + (a >>> 0)).toString(36);
  };
  // What a moment that holds a state ends up as: the last stop that names each key.
  const final = (list, k) => { for (let i = list.length - 1; i >= 0; i--) if (k in list[i]) return list[i][k]; return null; };

  // anim → CSS text: '' when there is nothing to say. Knob values on :root (read by motion.css through var(), so the
  // level's, the switches' and reduced motion's `none` still win) and the keyframes they name.
  const compile = (anim) => {
    if (!isObj(anim)) return '';
    const keyframes = new Map(), knobs = [];
    for (const moment of MOMENTS) {
      const a = Object.hasOwn(anim, moment) ? anim[moment] : null;
      if (!isObj(a)) continue;
      const list = stops(a.s);
      const ms = int(a.ms, 50, 2000, ENTERING[moment]?.[1] ?? 250), delay = int(a.delay, 0, 1000, 0), ease = easing(a.ease);
      if (ENTERING[moment]) {
        if (list.length < 2) continue;
        const body = frames(list, ms, delay);
        if (!body.replace(/\d+(?:\.\d+)?%\{\}/g, '')) continue;
        const name = `gz-x-${hash(body)}`;
        keyframes.set(name, body);
        knobs.push(`--gz-x-${ENTERING[moment][0]}:${name} ${fmt(ms + delay)}ms ${ease} backwards`);
        if (moment === 'card.enter' && a.stagger !== undefined) knobs.push(`--gz-x-stagger:${int(a.stagger, 0, 200, 50)}ms`);
      } else if (moment === 'card.hover' && list.length) {
        const v = Object.fromEntries(Object.keys(RANGE).map((k) => [k, final(list, k)]));
        const lift = [(v.x || v.y) && `translate(${fmt(v.x ?? 0)}px,${fmt(v.y ?? 0)}px)`, v.r && `rotate(${fmt(v.r)}deg)`, (v.kx || v.ky) && `skew(${fmt(v.kx ?? 0)}deg,${fmt(v.ky ?? 0)}deg)`,
          v.sc != null && v.sc !== 1 && `scale(${fmt(v.sc)})`].filter(Boolean).join(' ');
        // Opacity rides the filter here: a hovered card has no animation to hold it.
        const fl = [v.o != null && v.o !== 1 && `opacity(${fmt(v.o)})`, v.bl && `blur(${fmt(v.bl)}px)`, v.br != null && v.br !== 1 && `brightness(${fmt(v.br)})`,
          v.sa != null && v.sa !== 1 && `saturate(${fmt(v.sa)})`, v.hu && `hue-rotate(${fmt(v.hu)}deg)`].filter(Boolean).join(' ');
        knobs.push(`--gz-x-lift:${lift || 'none'}`);
        if (fl) knobs.push(`--gz-x-hover-filter:${fl}`);
        if (a.ms !== undefined) knobs.push(`--gz-x-hover-t:${ms}ms`);
        if (a.ease !== undefined) knobs.push(`--gz-x-hover-ease:${ease}`);
      } else if (moment === 'button.press' && final(list, 'sc') !== null) knobs.push(`--gz-x-press:${fmt(final(list, 'sc'))}`);
    }
    if (!knobs.length) return '';
    return `${[...keyframes].map(([name, body]) => `@keyframes ${name}{${body}}`).join('')}:root{${knobs.join(';')}}`;
  };

  // ---- event effects and the pointer: what to draw ---------------------------------------------------------------------
  const EVENTS = ['complete', 'submit', 'grade', 'streak', 'timer.done', 'look.rotate'];
  const KINDS = ['burst', 'confetti', 'rain', 'ring', 'sprite'];
  const SHAPES = ['dot', 'star', 'snow', 'heart', 'leaf', 'spark'];
  // Marks: shapes only the canvas draws (event effects, the pointer's and typing's), never a background layer's particles,
  // which lib/scene.js draws on the GPU from SHAPES alone.
  const MARKS = ['bat', 'petal', 'pixel', 'drop', 'bubble', 'ghost', 'pumpkin'];
  const DRAWN = [...SHAPES, ...MARKS];
  // The pointer's animation, drawn around the system pointer (never in its place): a trail, sparkles, ripples, a glow that
  // follows, a glow that flickers like a candle, marks that orbit it, scanlines that shimmer over it, marks that drift down.
  const CURSORS = ['trail', 'sparkle', 'ripple', 'glow', 'flicker', 'orbit', 'scan', 'drift'];
  // The pointer sets (x.pointer): assets/art/cursors/<set>/, their hotspots in lib/lookx.js. 'own' is the student's own
  // picture, which stays on their device: a theme code never carries it (lib/share.js).
  const POINTERS = ['aqua', 'lilac', 'pearl', 'aurora', 'quill', 'terminal', 'lava', 'neon', 'clear', 'lagoon', 'rose', 'ghost', 'pumpkin', 'own'];
  // Typing effects (x.type): what rises from the caret as the student types.
  const TYPES = ['embers', 'ink', 'sparks', 'pixels', 'petals', 'snow', 'bubbles', 'wisps'];
  // A palette token (--gz-<name> on <html>) or #rrggbb; features/motionx.js turns a name into the colour the page wears.
  const COLOR = /^(?:#[0-9a-f]{6}|[a-z][a-z0-9-]{0,24})$/i;
  const colors = (c, fallback) => {
    const list = (Array.isArray(c) ? c : []).filter((v) => typeof v === 'string' && COLOR.test(v)).slice(0, 6).map((v) => v.toLowerCase());
    return list.length ? list : fallback;
  };
  // Per kind: what an effect does when its part leaves a field out.
  const FX = {
    burst: { count: 12, spread: 360, gravity: 0.3, life: 900, size: 8 },
    confetti: { count: 30, spread: 80, gravity: 1, life: 1600, size: 8 },
    rain: { count: 30, spread: 0, gravity: 1, life: 1400, size: 6 },
    ring: { count: 20, spread: 0, gravity: 0, life: 800, size: 8 },
    sprite: { count: 8, spread: 60, gravity: -0.2, life: 1400, size: 16 },
  };
  const fx = (raw) => {
    if (!isObj(raw)) return null;
    const kind = KINDS.includes(raw.kind) ? raw.kind : 'burst', d = FX[kind];
    const shapes = [...new Set((Array.isArray(raw.shapes) ? raw.shapes : []).filter((s) => DRAWN.includes(s)))].slice(0, 4);
    return { kind, count: int(raw.count, 1, 60, d.count), shapes: shapes.length ? shapes : ['dot'], c: colors(raw.c, ['accent', 'ok', 'warn']),
      spread: num(raw.spread, 0, 360, d.spread), gravity: num(raw.gravity, -2, 2, d.gravity), life: int(raw.life, 200, 2500, d.life), size: num(raw.size, 2, 48, d.size) };
  };
  // x.fx → { event: effect } for the events there are.
  const fxs = (x) => (isObj(x) ? Object.fromEntries(EVENTS.filter((e) => Object.hasOwn(x, e)).map((e) => [e, fx(x[e])]).filter(([, v]) => v)) : {});
  // A pointer animation's mark (orbit, drift, and sparkle when one is named): the default is per kind.
  const MARK = { orbit: 'star', drift: 'petal' };
  const cursor = (raw) => (isObj(raw) && CURSORS.includes(raw.kind)
    ? { kind: raw.kind, c: colors(raw.c, ['accent']), size: num(raw.size, 2, 48, 10), len: int(raw.len, 2, 24, 10), fade: int(raw.fade, 100, 2000, 600),
      ...((DRAWN.includes(raw.shape) || MARK[raw.kind]) && { shape: DRAWN.includes(raw.shape) ? raw.shape : MARK[raw.kind] }) } : null);
  // Per typing kind: its colours, size and how many particles a key makes, when the part leaves them out.
  const TYPE = {
    embers: { c: ['warn', 'err'], size: 4, count: 3 }, ink: { c: ['ink'], size: 4, count: 2 }, sparks: { c: ['accent', 'accent-hi'], size: 6, count: 3 },
    pixels: { c: ['accent'], size: 4, count: 3 }, petals: { c: ['accent', 'accent-hi'], size: 8, count: 2 }, snow: { c: ['ink'], size: 6, count: 2 },
    bubbles: { c: ['accent-hi'], size: 6, count: 2 }, wisps: { c: ['accent-hi'], size: 10, count: 1 },
  };
  const typing = (raw) => {
    if (!isObj(raw) || !TYPES.includes(raw.kind)) return null;
    const d = TYPE[raw.kind];
    return { kind: raw.kind, c: colors(raw.c, d.c), size: num(raw.size, 2, 24, d.size), count: int(raw.count, 1, 8, d.count) };
  };

  // ---- particles ----------------------------------------------------------------------------------------------------------
  // { x, y } px; { vx, vy } px/s; g px/s² downward; d drag per second; r rad, vr rad/s; s size px (a ring: its final radius);
  // shape; c colour; life and age ms (a negative age waits to start). `rect` is a confetti piece; `ring` and `glow` draw themselves.
  const G = 800; // px/s² at gravity 1
  const TAU = Math.PI * 2;
  const pick = (list, rnd) => list[Math.floor(rnd() * list.length) % list.length];
  const blank = (p) => ({ x: 0, y: 0, vx: 0, vy: 0, g: 0, d: 0, r: 0, vr: 0, s: 8, shape: 'dot', c: 'accent', life: 600, age: 0, ...p });
  // One event's effect at (x, y) in a w × h window. rnd() is in [0, 1).
  const spawn = (f, x, y, w, h, rnd = Math.random) => {
    const out = [];
    if (f.kind === 'ring') {
      for (let i = 0; i < Math.min(4, 1 + Math.floor(f.count / 20)); i++) out.push(blank({ shape: 'ring', x, y, s: f.size * 4, c: pick(f.c, rnd), life: f.life, age: -i * f.life * 0.18 }));
      return out;
    }
    for (let i = 0; i < f.count; i++) {
      const shape = pick(f.shapes, rnd), c = pick(f.c, rnd);
      const toward = -Math.PI / 2 + (rnd() - 0.5) * (f.spread * Math.PI) / 180; // up, fanned by the spread
      if (f.kind === 'burst') {
        const v = 120 + rnd() * 240;
        out.push(blank({ x, y, vx: Math.cos(toward) * v, vy: Math.sin(toward) * v, g: f.gravity * G, d: 1.4, r: rnd() * TAU, vr: (rnd() - 0.5) * 6, s: f.size * (0.6 + 0.8 * rnd()), shape, c, life: f.life * (0.7 + 0.3 * rnd()) }));
      } else if (f.kind === 'confetti') {
        const v = 260 + rnd() * 380;
        out.push(blank({ x, y, vx: Math.cos(toward) * v, vy: Math.sin(toward) * v, g: f.gravity * G, d: 0.6, r: rnd() * TAU, vr: (rnd() - 0.5) * 20, s: f.size * (0.7 + 0.6 * rnd()), shape: shape === 'dot' ? 'rect' : shape, c, life: f.life * (0.8 + 0.2 * rnd()) }));
      } else if (f.kind === 'rain') {
        // Across the window and over its height in about a life, starting at different moments.
        out.push(blank({ x: rnd() * w, y: -f.size, vx: (rnd() - 0.5) * 30, vy: (h / (f.life / 1000)) * (0.7 + 0.4 * rnd()), g: f.gravity * 300, r: rnd() * TAU, vr: (rnd() - 0.5) * 4, s: f.size * (0.7 + 0.6 * rnd()), shape, c, life: f.life, age: -rnd() * f.life * 0.6 }));
      } else {
        const v = 50 + rnd() * 70; // rises slowly, as far to the side as the spread leans
        out.push(blank({ x: x + (rnd() - 0.5) * f.size * 4, y, vx: Math.cos(toward) * v, vy: Math.sin(toward) * v, g: f.gravity * 300, d: 0.5, r: (rnd() - 0.5) * 0.6, vr: (rnd() - 0.5) * 2, s: f.size * (1 + rnd() * 0.6), shape, c, life: f.life, age: -rnd() * f.life * 0.3 }));
      }
    }
    return out;
  };
  // The pointer's: a trail dot, a sparkle, a ripple (small as the pointer moves, larger on a press) and the glow, which follows.
  const spot = (cur, x, y, rnd = Math.random) => blank({ x, y, s: cur.size, c: pick(cur.c, rnd), life: cur.fade, shrink: true });
  const dust = (cur, x, y, rnd = Math.random) => blank({ x: x + (rnd() - 0.5) * cur.size, y: y + (rnd() - 0.5) * cur.size, vx: (rnd() - 0.5) * 60, vy: (rnd() - 0.5) * 60 + 20, g: 200, d: 1,
    r: rnd() * TAU, vr: (rnd() - 0.5) * 4, s: cur.size * (0.4 + 0.6 * rnd()), shape: rnd() < 0.5 ? 'spark' : 'star', c: pick(cur.c, rnd), life: cur.fade * (0.7 + 0.3 * rnd()), shrink: true });
  const ripple = (cur, x, y, press = false, rnd = Math.random) => blank({ shape: 'ring', x, y, s: cur.size * (press ? 4 : 2.5), c: pick(cur.c, rnd), life: cur.fade });
  const glow = (cur, x, y) => blank({ shape: 'glow', x, y, s: cur.size * 2.5, c: cur.c[0], life: cur.fade, age: 0, flick: cur.kind === 'flicker' });
  // A candle's unsteadiness at time t (ms): between about 0.45 and 1, never the same twice in a row, the same for the same t.
  const flick = (t) => 0.72 + 0.28 * (Math.sin(t * 0.031) * 0.5 + Math.sin(t * 0.077 + 1.3) * 0.3 + Math.sin(t * 0.013 + 0.4) * 0.2);
  // Scanlines over the pointer (one particle that draws its own lines) and a mark that orbits it.
  const scan = (cur, x, y) => blank({ shape: 'scan', x, y, s: cur.size * 3, c: cur.c[0], life: cur.fade });
  const orbiter = (cur, i, x, y) => blank({ shape: cur.shape || 'star', x, y, s: cur.size, c: cur.c[i % cur.c.length], life: cur.fade, orbit: i });
  // Where orbiter i of n is at time t (ms) around (x, y): an ellipse a little wider than tall, each mark bobbing as it goes.
  const orbitAt = (cur, i, n, t, x, y) => {
    const a = t * 0.0025 + (i / n) * TAU, rad = cur.size * 2.2 + 8;
    return { x: x + Math.cos(a) * rad, y: y + Math.sin(a) * rad * 0.6 + Math.sin(t * 0.012 + i) * 2, r: Math.sin(t * 0.02 + i * 2) * 0.35 };
  };
  // A mark let go as the pointer moves: it drifts down and turns.
  const fall = (cur, x, y, rnd = Math.random) => blank({ x: x + (rnd() - 0.5) * cur.size, y, vx: (rnd() - 0.5) * 50, vy: 20 + rnd() * 30, g: 60, d: 0.8, r: rnd() * TAU, vr: (rnd() - 0.5) * 3,
    s: cur.size * (0.7 + 0.5 * rnd()), shape: cur.shape || 'petal', c: pick(cur.c, rnd), life: cur.fade * (1 + rnd() * 0.5) });
  // A key's particles at the caret (x, y). What was typed never reaches here: only that something was.
  const keys = (t, x, y, rnd = Math.random) => {
    const out = [];
    for (let i = 0; i < t.count; i++) {
      const c = pick(t.c, rnd), s = t.size * (0.6 + 0.6 * rnd()), side = (rnd() - 0.5);
      const p = {
        embers: { vx: side * 60, vy: -(40 + rnd() * 60), g: -30, d: 0.8, s, shape: 'dot', life: 650 + rnd() * 300, shrink: true },
        ink: { vx: side * 40, vy: 10 + rnd() * 40, g: 260, d: 1.2, s, shape: 'drop', life: 550 },
        sparks: { vx: side * 220, vy: -(80 + rnd() * 100), g: 420, d: 2, r: rnd() * TAU, vr: side * 12, s, shape: 'spark', life: 450 },
        pixels: { vx: side * 120, vy: -(80 + rnd() * 90), g: 700, s: Math.round(s), shape: 'pixel', life: 600 },
        petals: { vx: side * 70, vy: -(20 + rnd() * 40), g: 90, d: 0.6, r: rnd() * TAU, vr: side * 6, s, shape: 'petal', life: 1100 },
        snow: { vx: side * 30, vy: 10 + rnd() * 20, g: 20, d: 0.4, r: rnd() * TAU, vr: side * 2, s, shape: 'snow', life: 1200 },
        bubbles: { vx: side * 20, vy: -(30 + rnd() * 30), g: -30, d: 0.6, s, shape: 'bubble', life: 900 },
        wisps: { vx: side * 20, vy: -(20 + rnd() * 25), g: -10, d: 0.6, s, shape: 'glow', life: 900 },
      }[t.kind];
      out.push(blank({ x: x + side * 6, y, c, ...p }));
    }
    return out;
  };
  const step = (p, dt) => {
    p.age += dt;
    if (p.age <= 0) return;
    const s = dt / 1000, k = Math.max(0, 1 - p.d * s);
    p.vy += p.g * s;
    p.vx *= k;
    p.vy *= k;
    p.x += p.vx * s;
    p.y += p.vy * s;
    p.r += p.vr * s;
  };
  const alive = (p) => p.age < p.life;
  // How much of it shows: all, then none, eased in the last stretch. Not started yet: none.
  const fade = (p) => (p.age <= 0 ? 0 : Math.max(0, 1 - (p.age / p.life) ** 2));

  return { MOMENTS, RANGE, EASES, EVENTS, KINDS, SHAPES, MARKS, DRAWN, CURSORS, POINTERS, TYPES, compile, hash, fx, fxs, cursor, typing, spawn, spot, dust, ripple, glow, flick, scan, orbiter, orbitAt, fall, keys, step, alive, fade };
})();

if (typeof module !== 'undefined') module.exports = GZ_MX; else GZ_MX;
