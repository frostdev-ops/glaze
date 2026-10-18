// Look parts that move, on the LMS page: a Look's animations (x.anim), the effects that play on events (x.fx) and the
// pointer's (x.cursor). content.js loads this (need) once the worn Look has one of them, and calls sync() when its
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
// knobs (motion.css) do the same for CSS. Never on a quiz or a tool's page (lib/lookx.js quiet). One canvas
// (#gz-fx, pointer-events none, hidden from a screen reader) is made for an effect and removed when none is left;
// frames run only while something is alive or the pointer is moving, and not while the page is hidden.
var GZ_MOTIONX = globalThis.GZ_MOTIONX || (() => {
  const ctx = globalThis.GZ_CTX;
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
  };
  const draw = (g, p) => {
    const a = GZ_MX.fade(p);
    if (!a) return;
    const t = p.age / p.life, c = tone(p.c);
    const s = p.shrink ? Math.max(0.1, p.s * (1 - t)) : p.s;
    g.globalAlpha = a;
    g.fillStyle = g.strokeStyle = c.hex;
    if (p.shape === 'ring') {
      g.globalAlpha = 1 - t;
      g.lineWidth = 2;
      g.beginPath();
      g.arc(p.x, p.y, Math.max(0.5, p.s * (1 - (1 - t) ** 3)), 0, 6.2832);
      g.stroke();
    } else if (p.shape === 'glow') {
      const grad = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.s);
      grad.addColorStop(0, `rgba(${c.rgb},0.55)`);
      grad.addColorStop(1, `rgba(${c.rgb},0)`);
      g.fillStyle = grad;
      g.beginPath();
      g.arc(p.x, p.y, p.s, 0, 6.2832);
      g.fill();
    } else {
      g.save();
      g.translate(p.x, p.y);
      g.rotate(p.r);
      g.beginPath();
      (SHAPE[p.shape] || SHAPE.dot)(g, s / 2);
      if (p.shape === 'snow') {
        g.lineWidth = Math.max(1, s / 6);
        g.stroke();
      } else g.fill();
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
      trail = []; dust = [];
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
  let cur = null, ptr = null, anchor = null, lastMove = -1e9, trail = [], dust = [], bloom = null, armed = false;
  const calm = () => !cur || !ctx.on() || quiet() || html.hasAttribute('data-gz-no-hover');
  const alive = (list) => list.filter(GZ_MX.alive);
  const far = (a, b, d) => Math.hypot(a.x - b.x, a.y - b.y) >= d;
  // Called each frame: true while the pointer is moving (the loop needs another frame), false once it rests and only
  // what is already alive is left to finish.
  const follow = (now) => {
    if (calm() || !ptr) return false;
    const fresh = now - lastMove < 150;
    if (!fresh) { anchor = null; return false; }
    if (cur.kind === 'glow') {
      if (!bloom || !GZ_MX.alive(bloom)) { bloom = GZ_MX.glow(cur, ptr.x, ptr.y); engine.add([bloom], true); }
      bloom.x += (ptr.x - bloom.x) * 0.35;
      bloom.y += (ptr.y - bloom.y) * 0.35;
      bloom.age = 0; // held at full while the pointer moves, then it ages out over the fade
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
    if (!want) { ptr = anchor = bloom = null; trail = []; dust = []; }
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
    cur = GZ_MX.cursor(p?.cursor);
    const next = JSON.stringify([fxs, cur]);
    if (next !== config) { engine.end(); config = next; }
    tones.clear();
    arm();
    if (!cur) engine.hook(null);
  };
  const off = () => {
    gen++;
    config = '';
    css('');
    fxs = {};
    cur = null;
    arm();
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
