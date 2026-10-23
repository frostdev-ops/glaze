// Look parts that move, on the LMS page: a Look's animations (x.anim), the effects that play on events (x.fx), the
// pointer's animation (x.cursor) and typing's (x.type). content.js loads this (need) once the worn Look has one of them, and calls sync() when its
// parts change ('glaze:parts') and off() when Glaze turns off. The parts come from GZ_CTX.parts() (cleaned,
// lib/lookparts.js), the events from GZ_CTX.moment() ('glaze:moment' on the document); the pure half is lib/motionx.js.
// Classic script; a second injection keeps the first.
//
// Animations are CSS text built from numbers (lib/motionx.js compile) and put on the page as a constructed stylesheet
// (adoptedStyleSheets), not as a <style> element. A school's Content-Security-Policy can carry `style-src` without
// 'unsafe-inline', which refuses an inline <style> that a page's own scripts add; a stylesheet built through CSSOM
// (replaceSync, like style.setProperty and the canvas) is not a source that policy checks. Measured in
// headless Chrome 153 under `default-src 'self'; style-src 'self'` and three other
// policies: the page's own <style> was refused, and a content script's <style>, adopted sheet, style attribute and CSSOM
// all applied, since Chrome exempts an extension's world from the page's policy. So Chrome would do either; this way
// does not lean on that exemption, which Firefox and Safari were not measured for. A browser that cannot adopt a sheet
// gets the <style> element, the best it can do.
//
// What plays is nothing when motion is off (the level, or reduced motion through it): effects check
// html[data-gz-motion] as they start and every frame, the pointer's also data-gz-no-hover, and the animations' own
// knobs (motion.css) do the same for CSS. Never on a quiz or a tool's page (lib/lookx.js quiet). The pointer itself is
// the system's, drawn by features/lookx.js as a CSS cursor; what this draws goes around it, never in its place. One canvas
// (#gz-fx, pointer-events none, hidden from a screen reader) is made for an effect and removed when none is left;
// frames run only while something is alive or the pointer is moving, and not while the page is hidden.
var GZ_MOTIONX = globalThis.GZ_MOTIONX || (() => {
  const ctx = globalThis.GZ_CTX;
  if (!ctx) return null; // a frame-only injection can outlive its document
  const html = document.documentElement;
  const lib = () => Promise.all([ctx.need('lib/motionx.js', () => globalThis.GZ_MX), ctx.need('lib/lookx.js', () => globalThis.GZ_LX)]);
  const quiet = () => !!globalThis.GZ_LX?.quiet(location.pathname, document);
  let live = true;
  const moving = () => live && /^(subtle|expressive)$/.test(html.getAttribute('data-gz-motion') || '');

  // ---- the animations: one stylesheet ------------------------------------------------------------------------------------
  let sheet = null, style = null, put = '';
  const drop = () => {
    if (sheet) document.adoptedStyleSheets = document.adoptedStyleSheets.filter((s) => s !== sheet);
    style?.remove();
    sheet = style = null;
  };
  const css = (text) => {
    // Asked again after the page took its sheet back (a page can set adoptedStyleSheets itself): put it back.
    if (text === put && (sheet ? document.adoptedStyleSheets.includes(sheet) : !style || style.isConnected)) return;
    put = text;
    if (!text) return drop();
    try {
      sheet ||= new CSSStyleSheet();
      sheet.replaceSync(text);
      if (!document.adoptedStyleSheets.includes(sheet)) document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
      return;
    } catch { sheet = null; }
    style ||= Object.assign(document.createElement('style'), { id: 'gz-motionx' });
    style.textContent = text;
    if (!style.isConnected) (document.head || html).append(style);
  };

  // ---- the canvas -------------------------------------------------------------------------------------------------------
  // A colour is a palette token (what the page wears, on <html>) or #rrggbb: { hex, rgb: 'r,g,b' }, remade when the parts are.
  const tones = new Map();
  const tone = (c) => {
    if (!tones.has(c)) {
      const v = c[0] === '#' ? c : html.style.getPropertyValue(`--gz-${c}`).trim();
      const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(v) || /^#(.)(.)(.)$/.exec(v)?.map((d, i) => (i ? d + d : d));
      tones.set(c, m ? { hex: `#${m[1]}${m[2]}${m[3]}`, rgb: `${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)}` } : { hex: '#888888', rgb: '136,136,136' });
    }
    return tones.get(c);
  };
  // Each shape inside a box h wide around (0, 0).
  const SHAPE = {
    dot: (g, h) => { g.arc(0, 0, h, 0, 6.2832); },
    rect: (g, h) => { g.rect(-h, -h / 2, h * 2, h); },
    star: (g, h) => { for (let i = 0; i < 10; i++) { const r = i % 2 ? h * 0.45 : h, a = (i * Math.PI) / 5 - Math.PI / 2; g[i ? 'lineTo' : 'moveTo'](Math.cos(a) * r, Math.sin(a) * r); } g.closePath(); },
    spark: (g, h) => { g.moveTo(0, -h); g.quadraticCurveTo(0, 0, h, 0); g.quadraticCurveTo(0, 0, 0, h); g.quadraticCurveTo(0, 0, -h, 0); g.quadraticCurveTo(0, 0, 0, -h); },
    snow: (g, h) => { for (let i = 0; i < 3; i++) { const a = (i * Math.PI) / 3; g.moveTo(Math.cos(a) * h, Math.sin(a) * h); g.lineTo(-Math.cos(a) * h, -Math.sin(a) * h); } },
    heart: (g, h) => { g.moveTo(0, h * 0.9); g.bezierCurveTo(-h * 1.3, -h * 0.1, -h * 0.6, -h * 1.1, 0, -h * 0.35); g.bezierCurveTo(h * 0.6, -h * 1.1, h * 1.3, -h * 0.1, 0, h * 0.9); },
    leaf: (g, h) => { g.moveTo(0, -h); g.quadraticCurveTo(h * 0.9, -h * 0.2, 0, h); g.quadraticCurveTo(-h * 0.9, -h * 0.2, 0, -h); },
    // The marks (lib/motionx.js MARKS).
    bat: (g, h) => {
      const half = [[0.12, -0.42], [0.22, -0.2], [0.5, -0.5], [1, -0.38], [0.82, -0.06], [0.62, 0.1], [0.46, -0.02], [0.3, 0.2], [0.12, 0.06], [0, 0.36]];
      g.moveTo(0, -0.3 * h);
      for (const [x, y] of half) g.lineTo(x * h, y * h);
      for (const [x, y] of half.reverse().slice(1)) g.lineTo(-x * h, y * h);
      g.lineTo(-0.12 * h, -0.42 * h);
      g.closePath();
    },
    petal: (g, h) => { g.moveTo(0, -h); g.bezierCurveTo(h * 0.8, -h * 0.5, h * 0.6, h * 0.6, 0, h); g.bezierCurveTo(-h * 0.6, h * 0.6, -h * 0.8, -h * 0.5, 0, -h); },
    pixel: (g, h) => { g.rect(-h * 0.8, -h * 0.8, h * 1.6, h * 1.6); },
    drop: (g, h) => { g.moveTo(0, -h); g.quadraticCurveTo(h * 0.7, -h * 0.1, h * 0.7, h * 0.3); g.arc(0, h * 0.3, h * 0.7, 0, Math.PI); g.quadraticCurveTo(-h * 0.7, -h * 0.1, 0, -h); },
    bubble: (g, h) => { g.arc(0, 0, h * 0.85, 0, 6.2832); },
    // Its eyes are holes (filled even-odd).
    ghost: (g, h) => {
      g.moveTo(-h * 0.7, h); g.lineTo(-h * 0.7, -h * 0.15); g.arc(0, -h * 0.15, h * 0.7, Math.PI, 0); g.lineTo(h * 0.7, h);
      g.lineTo(h * 0.35, h * 0.72); g.lineTo(0, h); g.lineTo(-h * 0.35, h * 0.72); g.closePath();
      g.moveTo(-h * 0.12, -h * 0.2); g.arc(-h * 0.25, -h * 0.2, h * 0.13, 0, 6.2832);
      g.moveTo(h * 0.38, -h * 0.2); g.arc(h * 0.25, -h * 0.2, h * 0.13, 0, 6.2832);
    },
    pumpkin: (g, h) => { g.ellipse(0, h * 0.12, h, h * 0.78, 0, 0, 6.2832); g.rect(-h * 0.12, -h * 0.95, h * 0.24, h * 0.36); },
    // Six arms, each with two pairs of branches (the Frostdev snowflake), and a slim ice shard.
    flake: (g, h) => {
      for (let i = 0; i < 6; i++) {
        const a = (i * Math.PI) / 3;
        g.moveTo(0, 0); g.lineTo(Math.cos(a) * h, Math.sin(a) * h);
        for (const [d, len] of [[0.42, 0.34], [0.7, 0.24]]) for (const b of [0.75, -0.75]) {
          const x = Math.cos(a) * d * h, y = Math.sin(a) * d * h;
          g.moveTo(x, y); g.lineTo(x + Math.cos(a + b) * len * h, y + Math.sin(a + b) * len * h);
        }
      }
    },
    shard: (g, h) => { g.moveTo(0, -h); g.lineTo(h * 0.38, -h * 0.15); g.lineTo(0, h); g.lineTo(-h * 0.3, h * 0.1); g.closePath(); },
  };
  const STROKED = new Set(['snow', 'bubble', 'flake']);
  // A contour ring (lib/motionx.js ring): traced, grown and lifted with its age; one the pointer let go keeps a 6 px clear
  // zone round the pointer's tip, wherever it is now.
  const contour = (g, p, a) => {
    const t = Math.min(1, p.age / p.life), e = 1 - (1 - t) ** 3, r = p.r0 + (p.s - p.r0) * e, y = p.y - p.lift * e;
    const end = p.sweep * (p.trace ? Math.min(1, t / p.trace) : 1), n = Math.max(6, Math.ceil((end / 6.2832) * 40));
    g.save();
    if (p.hole && ptr) {
      g.beginPath();
      g.rect(0, 0, innerWidth, innerHeight);
      g.arc(ptr.x, ptr.y, 6, 0, 6.2832, true);
      g.clip();
    }
    g.beginPath();
    for (let k = 0; k <= n; k++) {
      const th = p.seed + (end * k) / n, w = r * (1 + 0.1 * Math.sin(3 * th + p.seed * 2) + 0.06 * Math.sin(5 * th - p.seed));
      g[k ? 'lineTo' : 'moveTo'](p.x + Math.cos(th) * w, y + Math.sin(th) * w * 0.86);
    }
    if (p.fill && end >= 6.28) { g.globalAlpha = a * p.fill; g.fill(); }
    g.lineCap = 'round';
    g.lineWidth = 3.5;
    g.globalAlpha = a * 0.2;
    g.stroke();
    g.lineWidth = 1.3;
    g.globalAlpha = a;
    g.stroke();
    g.restore();
  };
  const draw = (g, p) => {
    const a = GZ_MX.fade(p);
    if (!a) return;
    const t = p.age / p.life, c = tone(p.c);
    // A mark that grows comes in at a third of its size and reaches it a third of the way through.
    const s = p.shrink ? Math.max(0.1, p.s * (1 - t)) : p.grow ? p.s * Math.min(1, 0.35 + (0.65 * t) / 0.35) : p.s;
    g.globalAlpha = a;
    g.fillStyle = g.strokeStyle = c.hex;
    if (p.shape === 'contour') contour(g, p, a);
    else if (p.shape === 'ring') {
      g.globalAlpha = 1 - t;
      g.lineWidth = 2;
      g.beginPath();
      g.arc(p.x, p.y, Math.max(0.5, p.s * (1 - (1 - t) ** 3)), 0, 6.2832);
      g.stroke();
    } else if (p.shape === 'glow') {
      // A flickering glow (a jack-o'-lantern's) wavers in strength and size, warmer at its heart.
      const f = p.flick ? GZ_MX.flick(performance.now()) : 1, r = p.s * (p.flick ? 0.85 + 0.15 * f : 1);
      const grad = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
      grad.addColorStop(0, `rgba(${c.rgb},${0.55 * f})`);
      if (p.c2) grad.addColorStop(0.45, `rgba(${tone(p.c2).rgb},${0.3 * f})`);
      grad.addColorStop(1, `rgba(${c.rgb},0)`);
      g.fillStyle = grad;
      g.beginPath();
      g.arc(p.x, p.y, r, 0, 6.2832);
      g.fill();
    } else if (p.shape === 'scan') {
      // Scanlines over the pointer, rolling slowly downward, strongest at its middle.
      const roll = (performance.now() / 60) % 4;
      for (let i = -4; i <= 4; i++) {
        g.globalAlpha = a * 0.35 * (1 - Math.abs(i) / 5);
        g.fillRect(p.x - p.s, p.y + i * 4 + roll, p.s * 2, 1);
      }
    } else {
      g.save();
      g.translate(p.x, p.y);
      g.rotate(p.r);
      g.beginPath();
      (SHAPE[p.shape] || SHAPE.dot)(g, s / 2);
      if (STROKED.has(p.shape)) {
        g.lineWidth = Math.max(1, s / (p.shape === 'flake' ? 11 : 6));
        g.lineCap = 'round';
        g.stroke();
      } else g.fill(p.shape === 'ghost' ? 'evenodd' : 'nonzero');
      g.restore();
    }
  };

  // One loop for everything alive. `hook` is the pointer's: it adds particles as the pointer moves and says whether it
  // wants another frame (a glow fading out); with nothing alive and the hook done, the canvas goes.
  const engine = (() => {
    let canvas = null, g = null, list = [], raf = 0, last = 0, hook = null, framing = false;
    const size = () => {
      if (!canvas) return;
      const k = Math.min(devicePixelRatio || 1, 2);
      canvas.width = Math.round(innerWidth * k);
      canvas.height = Math.round(innerHeight * k);
      g.setTransform(k, 0, 0, k, 0, 0);
    };
    const end = () => {
      cancelAnimationFrame(raf);
      raf = 0;
      list = [];
      ptr = anchor = bloom = null;
      trail = []; dust = []; orbit = []; typed = [];
      lastMove = -1e9;
      canvas?.remove();
      canvas = g = null;
      removeEventListener('resize', size);
    };
    const frame = (now) => {
      raf = 0;
      if (!ctx.on() || quiet()) return off();
      if (document.hidden || !moving()) return end();
      const dt = Math.max(0, Math.min(64, now - last));
      last = now;
      framing = true;
      try {
        const more = hook ? hook(now) : false;
        g.clearRect(0, 0, innerWidth, innerHeight);
        list = list.filter((p) => {
          if (p.pointer && calm()) return false;
          GZ_MX.step(p, dt);
          if (!GZ_MX.alive(p)) return false;
          draw(g, p);
          return true;
        });
        g.globalAlpha = 1;
        if (list.length || more) raf = requestAnimationFrame(frame);
        else end();
      } catch { end(); } finally { framing = false; } // a canvas that cannot draw is not left on the page
    };
    // The one loop: asked for while a frame is running (the pointer adds as it moves), it is the frame's own end that goes on.
    const wake = () => {
      if (!ctx.on() || quiet()) { off(); return false; }
      if (document.hidden || !moving()) return false;
      if (!canvas) {
        canvas = document.createElement('canvas');
        canvas.id = 'gz-fx';
        canvas.setAttribute('aria-hidden', 'true');
        Object.assign(canvas.style, { position: 'fixed', inset: '0', width: '100%', height: '100%', pointerEvents: 'none', zIndex: '2147483000' });
        g = canvas.getContext('2d');
        (document.body || html).append(canvas);
        addEventListener('resize', size);
        size();
      }
      if (!raf && !framing) { last = performance.now(); raf = requestAnimationFrame(frame); }
      return true;
    };
    return {
      add: (ps, pointer = false) => { if (wake()) { if (pointer) for (const p of ps) p.pointer = true; list.push(...ps); } },
      wake,
      hook: (h) => { hook = h; },
      end,
    };
  })();

  // ---- event effects --------------------------------------------------------------------------------------------------------
  let fxs = {};
  const played = {};
  const play = (e) => {
    const { name, x, y } = e.detail || {};
    const f = typeof name === 'string' && Object.hasOwn(fxs, name) ? fxs[name] : null;
    // A mod the student lets replace this moment's effect plays its own instead (features/mods.js).
    if (!f || globalThis.GZ_MODS?.replaces(`effect:${name}`) || document.hidden || !moving() || !ctx.on() || quiet()) return;
    // A page of cards can find several at once (new grades on each): one effect, not a dozen.
    const now = performance.now();
    if (now - (played[name] ?? -1e9) < 600) return;
    played[name] = now;
    const at = Number.isFinite(x) && Number.isFinite(y) ? [x, y] : [innerWidth / 2, innerHeight / 3];
    engine.add(GZ_MX.spawn(f, at[0], at[1], innerWidth, innerHeight));
  };

  // ---- the pointer's effect ---------------------------------------------------------------------------------------------------
  let cur = null, ptr = null, anchor = null, lastMove = -1e9, trail = [], dust = [], orbit = [], bloom = null, armed = false;
  const calm = () => !cur || !ctx.on() || quiet() || html.hasAttribute('data-gz-no-hover');
  const alive = (list) => list.filter(GZ_MX.alive);
  const far = (a, b, d) => Math.hypot(a.x - b.x, a.y - b.y) >= d;
  // Called each frame: true while the pointer is moving (the loop needs another frame), false once it rests and only
  // what is already alive is left to finish.
  const follow = (now) => {
    if (calm() || !ptr) return false;
    const fresh = now - lastMove < 150;
    // Marks that orbit the pointer keep going round as they fade out after it rests.
    if (cur.kind === 'orbit') {
      const n = Math.max(1, Math.min(6, cur.len));
      orbit = alive(orbit);
      if (fresh && orbit.length < n) {
        for (const o of orbit) o.age = o.life;
        orbit = Array.from({ length: n }, (_, i) => GZ_MX.orbiter(cur, i, ptr.x, ptr.y));
        engine.add(orbit, true);
      }
      for (const o of orbit) {
        Object.assign(o, GZ_MX.orbitAt(cur, o.orbit, n, now, ptr.x, ptr.y));
        if (fresh) o.age = 1; // held at full while the pointer moves
      }
      return fresh;
    }
    if (!fresh) { anchor = null; return false; }
    if (cur.kind === 'glow' || cur.kind === 'flicker' || cur.kind === 'scan') {
      if (!bloom || !GZ_MX.alive(bloom)) {
        bloom = cur.kind === 'scan' ? GZ_MX.scan(cur, ptr.x, ptr.y) : GZ_MX.glow(cur, ptr.x, ptr.y);
        if (cur.kind === 'flicker' && cur.c[1]) bloom.c2 = cur.c[1];
        engine.add([bloom], true);
      }
      const k = cur.kind === 'scan' ? 1 : 0.35;
      bloom.x += (ptr.x - bloom.x) * k;
      bloom.y += (ptr.y - bloom.y) * k;
      bloom.age = 1; // held at full while the pointer moves, then it ages out over the fade
      return true;
    }
    anchor ||= { ...ptr };
    if (cur.kind === 'trail') {
      const gap = Math.max(3, cur.size * 0.5), dx = ptr.x - anchor.x, dy = ptr.y - anchor.y, n = Math.min(24, Math.floor(Math.hypot(dx, dy) / gap));
      const made = [];
      for (let i = 1; i <= n; i++) made.push(GZ_MX.spot(cur, anchor.x + (dx * i) / n, anchor.y + (dy * i) / n));
      if (n) anchor = { ...ptr };
      trail = alive([...trail, ...made]);
      for (const old of trail.splice(0, Math.max(0, trail.length - cur.len))) old.age = old.life;
      engine.add(made, true);
    } else if (cur.kind === 'sparkle' && far(anchor, ptr, 14)) {
      anchor = { ...ptr };
      dust = alive(dust);
      if (dust.length < cur.len * 3) { const d = GZ_MX.dust(cur, ptr.x, ptr.y); dust.push(d); engine.add([d], true); }
    } else if (cur.kind === 'drift' && far(anchor, ptr, 18)) {
      anchor = { ...ptr };
      dust = alive(dust);
      if (dust.length < cur.len * 2) { const d = GZ_MX.fall(cur, ptr.x, ptr.y); dust.push(d); engine.add([d], true); }
    } else if (cur.kind === 'contour' && far(anchor, ptr, Math.max(12, cur.size))) {
      anchor = { ...ptr };
      dust = alive(dust);
      if (dust.length < Math.min(3, cur.len)) { const d = GZ_MX.contour(cur, ptr.x, ptr.y); dust.push(d); engine.add([d], true); }
    } else if (cur.kind === 'ripple' && far(anchor, ptr, 64)) {
      anchor = { ...ptr };
      engine.add([GZ_MX.ripple(cur, ptr.x, ptr.y)], true);
    }
    return true;
  };
  const onMove = (e) => {
    if (e.pointerType === 'touch' || calm() || !moving()) return;
    ptr = { x: e.clientX, y: e.clientY };
    lastMove = performance.now();
    if (engine.wake()) engine.hook(follow);
  };
  const onDown = (e) => {
    if (e.pointerType === 'touch' || calm() || cur.kind !== 'ripple') return;
    engine.add([GZ_MX.ripple(cur, e.clientX, e.clientY, true)], true);
  };
  const arm = () => {
    // A screen with no pointer that hovers (a phone) has nothing to follow.
    const want = !!cur && !matchMedia('(hover: none)').matches;
    if (want === armed) return;
    armed = want;
    const f = want ? addEventListener : removeEventListener;
    f.call(window, 'pointermove', onMove, { passive: true, capture: true });
    f.call(window, 'pointerdown', onDown, { passive: true, capture: true });
    if (!want) { ptr = anchor = bloom = null; trail = []; dust = []; orbit = []; }
  };

  // ---- typing -------------------------------------------------------------------------------------------------------------
  // Input events say only that something was inserted; their data and the field's text are never read. Inputs and
  // textareas use the field's edge or centre, since measuring their caret would need the text. A contenteditable uses
  // the selection's rects. At most one measurement a frame, however fast the keys come.
  let typ = null, typArmed = false, composing = false, field = null, keyed = 0, pending = 0, typed = [];
  const TEXTY = /^(?:text|search|email|url|tel)$/;
  const SECRET = /(?:^|\s)(?:cc-[\w-]+|one-time-code|current-password|new-password)(?:\s|$)/i;
  // The field typed in, or null for one that gets nothing.
  const fieldOf = (el) => {
    if (typeof el?.matches !== 'function') return null;
    if (el.matches('input, textarea')) {
      if (el.matches('input') && !TEXTY.test(el.type)) return null;
      return SECRET.test(el.getAttribute('autocomplete') || '') ? null : el;
    }
    return el.isContentEditable ? el.closest('[contenteditable]:not([contenteditable="false"])') || el : null;
  };
  // The selection's caret, or the field's end (an input) or middle (the rest).
  const caretOf = (el) => {
    const b = el.getBoundingClientRect();
    const end = { x: el.matches('input') ? Math.max(b.left, b.right - 10) : b.left + b.width / 2, y: b.top + b.height / 2 };
    if (el.matches('input, textarea')) return end;
    try {
      const sel = getSelection(), r = sel?.rangeCount ? sel.getRangeAt(0) : null;
      const last = r && el.contains(r.endContainer) ? [...r.getClientRects()].pop() : null;
      return last ? { x: last.right, y: last.top + last.height / 2 } : end;
    } catch { return end; }
  };
  const spill = () => {
    pending = 0;
    // A contour bloom answers once a frame, however many keys came.
    const el = field, n = Math.min(typ?.kind === 'contour' ? 1 : 3, keyed);
    keyed = 0;
    field = null;
    if (!typ || composing || !el?.isConnected || fieldOf(el) !== el || !n || document.hidden || !moving() || !ctx.on() || quiet()) return;
    typed = alive(typed);
    if (typed.length > 90) return;
    const at = caretOf(el), made = [];
    for (let i = 0; i < n; i++) made.push(...GZ_MX.keys(typ, at.x, at.y));
    typed.push(...made);
    engine.add(made);
  };
  const onInput = (e) => {
    if (!typ || composing || e.isComposing || (e.inputType && !e.inputType.startsWith('insert')) || !moving() || !ctx.on() || quiet()) return;
    const el = fieldOf(e.composedPath?.()[0] || e.target);
    if (!el) return;
    field = el;
    keyed++;
    if (!pending) pending = requestAnimationFrame(spill);
  };
  const onCompose = (e) => { composing = e.type === 'compositionstart'; };
  const clearKeys = () => {
    cancelAnimationFrame(pending);
    pending = keyed = 0;
    field = null;
  };
  const armType = () => {
    const want = !!typ;
    if (want === typArmed) return;
    typArmed = want;
    const f = want ? document.addEventListener : document.removeEventListener;
    f.call(document, 'input', onInput, { passive: true, capture: true });
    f.call(document, 'compositionstart', onCompose, { passive: true, capture: true });
    f.call(document, 'compositionend', onCompose, { passive: true, capture: true });
    if (!want) {
      clearKeys();
      composing = false;
    }
  };

  // ---- the parts ---------------------------------------------------------------------------------------------------------------
  let gen = 0, config = '';
  const sync = async () => {
    const g = ++gen;
    try { await lib(); } catch { return; }
    if (g !== gen) return;
    if (!live || !ctx.on()) return off();
    const p = quiet() ? null : ctx.parts() || null;
    css(GZ_MX.compile(p?.anim));
    fxs = GZ_MX.fxs(p?.fx);
    // The pointer's animation is the Look's, unless the student turned it off (extras.pointerAnim).
    cur = ctx.settings?.().extras?.pointerAnim === false ? null : GZ_MX.cursor(p?.cursor);
    typ = GZ_MX.typing(p?.type);
    const next = JSON.stringify([fxs, cur, typ]);
    if (next !== config) { clearKeys(); engine.end(); config = next; }
    tones.clear();
    arm();
    armType();
    if (!cur) engine.hook(null);
  };
  const off = () => {
    gen++;
    config = '';
    css('');
    fxs = {};
    cur = null;
    typ = null;
    arm();
    armType();
    engine.hook(null);
    engine.end();
  };

  document.addEventListener('glaze:moment', play);
  document.addEventListener('visibilitychange', () => { if (document.hidden) engine.end(); });
  addEventListener('pagehide', () => { live = false; off(); });
  addEventListener('pageshow', () => { live = true; sync(); });
  // Ultra changes pages in place: a quiz may have come or gone.
  globalThis.navigation?.addEventListener('navigatesuccess', sync);
  // A mod's effect (glaze.effects.play, cleaned by the worker into GZ_MX.fx's form) at (x, y), as a Look's would play.
  const burst = async (f, x, y) => {
    try { await lib(); } catch { return false; }
    if (!f || document.hidden || !moving() || !ctx.on() || quiet()) return false;
    engine.add(GZ_MX.spawn(GZ_MX.fx(f), x, y, innerWidth, innerHeight));
    return true;
  };
  return { sync, off, burst, has: (name) => Object.hasOwn(fxs, name) };
})();

GZ_MOTIONX;
