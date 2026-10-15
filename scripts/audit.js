// The audit behind scripts/canvas-shots.js --audit, run inside each frame with page.evaluate (so it has to stand alone).
// Plain node module, so test/canvas-fixtures.test.js can run it against a stand-in window.

// Elements painted wrong for the palette, in this frame: a light patch in a dark palette (or a dark one in a
// light palette), and text under 4.5:1 (3:1 when large) against what is painted behind it. Biggest area first.
const auditFrame = (w = window) => {
  // A frame's window: the real one in the page (page.evaluate), a stand-in in test/canvas-fixtures.test.js.
  const { document, innerWidth, innerHeight } = w;
  const getComputedStyle = (e) => w.getComputedStyle(e);
  const ctx = Object.assign(document.createElement('canvas'), { width: 1, height: 1 }).getContext('2d', { willReadFrequently: true });
  const memo = new Map();
  // Every CSS colour syntax (oklab, color-mix results, color(srgb ...)) to sRGB bytes, via the canvas.
  const rgba = (str) => {
    if (!memo.has(str)) {
      ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = '#000'; ctx.fillStyle = str; ctx.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
      memo.set(str, { r, g, b, a: a / 255 });
    }
    return memo.get(str);
  };
  const over = (top, under) => ({ r: top.r * top.a + under.r * (1 - top.a), g: top.g * top.a + under.g * (1 - top.a), b: top.b * top.a + under.b * (1 - top.a), a: 1 });
  const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const lum = (c) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
  const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
  // Paper and pastel tints (a notice's pale yellow), not a colour meant to stand out.
  const chroma = (c) => Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b);
  const root = getComputedStyle(document.documentElement);
  const paletteBg = rgba(root.getPropertyValue('--gz-surface-2').trim() || getComputedStyle(document.body).backgroundColor || '#fff');
  // The accent is meant to be a bright fill (a primary button, its hover).
  const accents = ['--gz-accent', '--gz-accent-hi'].map((v) => root.getPropertyValue(v).trim()).filter(Boolean).map((v) => rgba(v));
  const same = (a, b) => Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b) < 6;
  const dark = lum(paletteBg) < 0.2;
  const painted = new Map();
  // What shows behind an element: its fills composited down to the first opaque one. A background image
  // (Glaze's gradients and scenes) counts as the palette's background.
  const paint = (e) => {
    if (!e || e.nodeType !== 1) return paletteBg;
    if (painted.has(e)) return painted.get(e);
    const cs = getComputedStyle(e);
    let c;
    if (cs.backgroundImage !== 'none' && !/^url\(/.test(cs.backgroundImage) && e !== document.documentElement) c = paletteBg;
    else {
      const own = rgba(cs.backgroundColor);
      c = own.a >= 0.99 ? own : own.a > 0 ? over(own, paint(e.parentElement)) : paint(e.parentElement);
    }
    painted.set(e, c);
    return c;
  };
  const hex = (c) => `#${[c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
  const name = (e) => {
    let s = e.tagName.toLowerCase() + (e.id ? `#${e.id}` : '');
    const cls = [...e.classList].filter((c) => !/^css-/.test(c)).slice(0, 3);
    if (cls.length) s += `.${cls.join('.')}`;
    // InstUI's css-<hash>-<label>: only the label is stable.
    const labels = [...e.classList].filter((c) => /^css-/.test(c)).map((c) => c.replace(/^css-\w+-/, ''));
    if (labels.length) s += `~${labels.join('~')}`;
    const t = e.getAttribute('data-testid') || e.getAttribute('data-cid');
    if (t) s += `[${e.hasAttribute('data-testid') ? 'data-testid' : 'data-cid'}="${t}"]`;
    const ctxEl = e.parentElement?.closest('[id]');
    return ctxEl && ctxEl !== document.body ? `#${ctxEl.id} ${s}` : s;
  };
  // What of a box the window shows: cut to the viewport (with --full the viewport is the whole page), or nothing.
  const shown = (r) => {
    const left = Math.max(r.left, 0), top = Math.max(r.top, 0), right = Math.min(r.right, innerWidth), bottom = Math.min(r.bottom, innerHeight);
    return right > left && bottom > top ? { x: (left + right) / 2, y: (top + bottom) / 2, area: (right - left) * (bottom - top) } : null;
  };
  const issues = [];
  const flagged = new Set();
  for (const e of document.body.querySelectorAll('*')) {
    if (/^(IMG|VIDEO|CANVAS|SVG|IFRAME|PICTURE|SOURCE|PATH|USE|SCRIPT|STYLE|LINK|META|BR|OPTION)$/i.test(e.tagName) || e.closest('svg')) continue;
    if (!e.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;
    // Only what is seen: on screen, and on top at the middle of what shows. The element itself or something inside it
    // must answer there. An ancestor answering means this one is clipped away (screen-reader text) or covered, unless
    // it lets the pointer through (pointer-events: none: painted, but never hit).
    const v = shown(e.getBoundingClientRect());
    if (!v || v.area < 16) continue;
    const a = v.area;
    const hit = document.elementFromPoint(v.x, v.y);
    const cs = getComputedStyle(e);
    if (!hit || !(hit === e || e.contains(hit) || (cs.pointerEvents === 'none' && hit.contains(e)))) continue;
    const own = rgba(cs.backgroundColor);
    if (own.a >= 0.5 && cs.backgroundImage === 'none' && chroma(own) < (dark ? 100 : 60)) {
      const fill = paint(e);
      const wrong = (dark ? lum(fill) > 0.35 : lum(fill) < 0.05) && !accents.some((c) => same(c, fill));
      // Report a patch once, at its outermost element, not again for every child it paints behind.
      if (wrong && !flagged.has(e.parentElement && paint(e.parentElement) === fill ? e.parentElement : null)) {
        issues.push({ kind: dark ? 'light-fill' : 'dark-fill', el: name(e), area: Math.round(a), bg: hex(fill) });
      }
      if (wrong) flagged.add(e);
    } else if (e.parentElement && flagged.has(e.parentElement) && own.a === 0) flagged.add(e);
    let text = false;
    for (const n of e.childNodes) if (n.nodeType === 3 && n.textContent.trim()) { text = true; break; }
    if (text || /^(INPUT|TEXTAREA|SELECT)$/.test(e.tagName)) {
      const bg = paint(e);
      const fg = over(rgba(cs.color), bg);
      const k = contrast(fg, bg);
      const large = parseFloat(cs.fontSize) >= 24 || (parseFloat(cs.fontSize) >= 18.6 && +cs.fontWeight >= 700);
      if (k < (large ? 3 : 4.5) && rgba(cs.color).a > 0.3) issues.push({ kind: 'text', el: name(e), area: Math.round(a), bg: hex(bg), fg: hex(fg), contrast: +k.toFixed(2) });
    }
  }
  return { dark, issues: issues.sort((x, y) => y.area - x.area) };
};

module.exports = { auditFrame };
