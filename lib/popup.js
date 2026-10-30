// Glaze's pop-up (features/popup.js), the parts that don't touch the page, so node can test them: how it comes and
// goes (the motion each setting and motion level gets, the genie's keyframes), where a preview beside a link
// goes, and the safe path for a site's HTML: lib/notes.js's sanitizer (GZ_NOTES.parse) into elements made one by one.
// Announcements (features/announce.js) and rubrics use it. Classic script; module.exports for node. Loaded on demand: a
// second injection keeps the first.
var GZ_POPUP_LIB = globalThis.GZ_POPUP_LIB || (() => {
  // An address on this site (origin), made absolute (Ultra's <base href> is its CDN, so nothing is left relative), or null.
  const own = (v, origin) => {
    try {
      const u = new URL(String(v ?? ''), `${origin}/`);
      return (u.protocol === 'https:' || u.protocol === 'http:') && u.origin === origin && !u.username && !u.password ? u.href : null;
    } catch { return null; }
  };

  // ---- a site's HTML ------------------------------------------------------------------------------------------------------
  // Through lib/notes.js's sanitizer (N: GZ_NOTES): its allowlist, links http(s) and mailto only, scripts, styles, frames,
  // forms, media and every attribute it doesn't name dropped. Pictures from this site stay pictures; any other site's
  // becomes a link to it. Kept pictures are loaded by features/popup.js with redirects refused. → the tree's children.
  const tree = (html, origin, N) => N.parse(html, { base: `${origin}/`, pictures: (h) => own(h, origin) !== null }).kids;
  const ATTRS = ['href', 'alt', 'title', 'colspan', 'rowspan', 'start'];
  const pictures = new WeakMap();
  // The tree as elements of doc, made one by one (no HTML is parsed): links open in a new tab, without the opener.
  const build = (kids, doc) => kids.map((n) => {
    if (typeof n === 'string') return n;
    const el = doc.createElement(n.tag);
    for (const k of ATTRS) if (typeof n.attrs?.[k] === 'string') el.setAttribute(k, n.attrs[k]);
    if (n.tag === 'a') { el.setAttribute('target', '_blank'); el.setAttribute('rel', 'noopener noreferrer'); }
    if (n.tag === 'img') { if (n.attrs?.src) pictures.set(el, n.attrs.src); el.setAttribute('alt', n.attrs?.alt || ''); el.setAttribute('decoding', 'async'); }
    el.append(...build(n.kids || [], doc));
    return el;
  });
  // Plain text of the tree, a line per block, for the preview: at most n characters.
  const BLOCK = new Set(['p', 'div', 'br', 'hr', 'h1', 'h2', 'h3', 'li', 'tr', 'pre', 'blockquote', 'ul', 'ol', 'table']);
  const text = (kids, n = 600) => {
    const out = [];
    const walk = (list) => { for (const k of list) { if (typeof k === 'string') out.push(k); else { if (BLOCK.has(k.tag)) out.push('\n'); walk(k.kids || []); if (BLOCK.has(k.tag)) out.push('\n'); } } };
    walk(kids);
    return out.join('').split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n').slice(0, n);
  };

  // ---- the preview's place -------------------------------------------------------------------------------------------
  // Below the link where it fits, else above, else on the side with more room, its height capped there: never over the
  // link, always inside the viewport (vw × vh), `m` from its edges. a: the link's rect; w, h: the preview's size.
  // → { left, top, maxHeight, side }.
  const place = (a, w, h, vw, vh, gap = 6, m = 8) => {
    const width = Math.min(w, vw - 2 * m);
    const left = Math.max(m, Math.min(a.left, vw - m - width));
    const below = vh - m - (a.bottom + gap), above = a.top - gap - m;
    const side = h <= below ? 'below' : h <= above ? 'above' : below >= above ? 'below' : 'above';
    const room = Math.max(0, side === 'below' ? below : above), height = Math.min(h, room);
    return { left, top: side === 'below' ? a.bottom + gap : a.top - gap - height, maxHeight: room, side };
  };

  // ---- the pop-up's motion -----------------------------------------------------------------------------------------
  // How it comes and goes: none with motion off or reduced, or the setting None; a fade with Fade; a quick scale and fade
  // on Subtle; the genie on Expressive. level: the page's motion (content.js data-gz-motion).
  const motion = ({ anim = 'genie', level = 'subtle', reduced = false } = {}) => (reduced || level === 'off' || anim === 'none' ? 'none'
    : anim === 'fade' ? 'fade' : level === 'expressive' ? 'genie' : 'scale');
  const TIMING = { fade: [120, 100, 'ease-out'], scale: [180, 140, 'ease-out'], genie: [420, 340, 'linear'], shrink: [200, 200, 'ease-in'] };
  const timing = (kind, out) => { const t = TIMING[kind]; return t ? { duration: t[out ? 1 : 0], easing: kind === 'genie' ? 'linear' : out ? 'ease-in' : t[2] } : null; };
  const px = (v) => `${Math.round(v * 10) / 10}px`;
  const pct = (v) => `${Math.round(v * 100) / 100}%`;
  // A sheet pulled out of the source text: the leading edge unfurls first, the neck follows, then both settle. Twenty
  // projective strips bend the *content*, rather than just cropping an unmoving rectangle. Shared edge coordinates keep
  // the strips joined. The silhouette remains a cheap fallback for unusually complex dialogs or missing animation APIs.
  // Motion is sampled here, so every strip follows the same curve with linear WAAPI timing, forwards or backwards.
  const genie = (s, d, count = 20) => {
    const W = Math.max(1, d.width), H = Math.max(1, d.height);
    const top = s.top + s.height / 2 <= d.top + d.height / 2; // the link is above: the top edge is near
    const clamp = (v) => Math.max(0, Math.min(W, v));
    const sw = Math.min(W, Math.max(1, s.width));
    const nl = Math.min(W - sw, clamp(s.left - d.left)), nr = nl + sw;
    const dx = s.left - d.left - nl;
    const sh = Math.min(H, Math.max(8, s.height));
    const dy = top ? s.top - d.top : s.bottom - d.bottom;
    const lerp = (a, b, t) => a + (b - a) * t;
    const unit = (v) => Math.max(0, Math.min(1, v));
    const smooth = (v) => { const x = unit(v); return x * x * (3 - 2 * x); };
    const bands = Math.max(8, Math.min(24, Math.round(count) || 20));
    const samples = Array.from({ length: 29 }, (_, i) => {
      const p = i / 28, reach = 1 - Math.pow(1 - p, 3), open = smooth((p - 0.38) / 0.62);
      const L = lerp(nl, 0, open), R = lerp(nr, W, open), far = lerp(sh, H, reach);
      // Neither end jumps to full width. The leading edge blooms as it travels; the neck stays at the text until the
      // sheet has emerged, then releases into its final position. This reads as flowing out of a point, not a trapezoid.
      const travel = 1 - smooth((p - 0.35) / 0.65);
      const flare = smooth((p - 0.06) / 0.94), width = lerp(sw, W, flare);
      // The leading edge travels toward the dialog's centre independently of the anchored neck. A source beside the
      // dialog therefore produces a diagonal, curving ribbon, rather than a sheet expanding along one straight side.
      const centre = Math.max(width / 2, Math.min(W - width / 2, lerp((nl + nr) / 2, W / 2 - dx * travel, smooth(p / 0.78))));
      const fL = centre - width / 2, fR = centre + width / 2;
      // A curved neck, with no sharp corner halfway down either side. At rest material coordinates become linear again.
      const edge = (v) => {
        const u = top ? v : 1 - v, bend = lerp(smooth(u), u, open);
        return [lerp(L, fL, bend), lerp(R, fR, bend), top ? far * u : H - far * u];
      };
      const path = [...Array.from({ length: bands + 1 }, (_, j) => { const [l, r, y] = edge(top ? j / bands : 1 - j / bands); return [r, y]; }),
        ...Array.from({ length: bands + 1 }, (_, j) => { const [l, r, y] = edge(top ? 1 - j / bands : j / bands); return [l, y]; })];
      // Put the near edge's left and right corners first, including for sources below the dialog.
      const [left, right, y] = edge(top ? 0 : 1);
      const poly = [[left, y], [right, y], ...path.slice(1, -1)];
      return { p, edge, frame: { offset: p, opacity: smooth(p / 0.2), transform: i === 28 ? 'none' : `translate(${px(dx * travel)}, ${px(dy * travel)})`,
        clipPath: `polygon(${poly.map(([x, y]) => `${pct(x / W * 100)} ${pct(y / H * 100)}`).join(', ')})` } };
    });
    // Homography from a flat strip to a trapezoid. Unlike scale/skew alone, it maps all four corners exactly: type and
    // table lines stay attached to the curving surface. The tiny overlap covers subpixel raster seams in WebKit/Chromium.
    const strips = Array.from({ length: bands }, (_, i) => {
      const step = H / bands, y0 = i * step, height = Math.min(H - y0, step + 0.6);
      return { top: y0, height, frames: samples.map(({ p, edge }) => {
        const [l0, r0, t] = edge(y0 / H), [l1, r1, b] = edge((y0 + step) / H), k = (r0 - l0) / (r1 - l1);
        // Factor translation out before the projection. Putting a large screen offset inside the perspective matrix
        // makes CSS's matrix decomposition cross a singularity mid-tween, tearing neighboring strips apart.
        const m = [(r0 - l0) / W, 0, 0, 0, (l1 - l0) * k / step, (b - t) * k / step, 0, (k - 1) / step,
          0, 0, 1, 0, 0, 0, 0, 1];
        return { offset: p, transform: `translate(${+l0.toFixed(5)}px, ${+t.toFixed(5)}px) matrix3d(${m.map((n) => +n.toFixed(9)).join(',')})` };
      }) };
    });
    return {
      origin: `${pct(((nl + nr) / 2 / W) * 100)} ${top ? '0%' : '100%'}`,
      frames: samples.map(({ frame }) => frame), bands: strips,
    };
  };
  // Keyframes for the other kinds; the close of a link no longer on screen is `shrink`.
  const FRAMES = {
    fade: [{ opacity: 0 }, { opacity: 1 }],
    scale: [{ opacity: 0, transform: 'scale(0.96)' }, { opacity: 1, transform: 'none' }],
    shrink: [{ opacity: 0, transform: 'scale(0.92)' }, { opacity: 1, transform: 'none' }],
  };
  // On screen: a rect with some of it inside the viewport.
  const onScreen = (r, vw, vh) => !!r && r.width > 0 && r.height > 0 && r.right > 0 && r.bottom > 0 && r.left < vw && r.top < vh;


  // The safe path in one call: HTML from the site at origin as elements of doc, through N (GZ_NOTES).
  const safe = (html, origin, N, doc) => build(tree(html, origin, N), doc);

  return { own, tree, build, text, safe, picture: (el) => pictures.get(el), place, motion, timing, genie, FRAMES, onScreen };
})();

if (typeof module !== 'undefined') module.exports = GZ_POPUP_LIB; else GZ_POPUP_LIB;
