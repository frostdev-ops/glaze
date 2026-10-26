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
  const EASE_IN = 'cubic-bezier(0.4, 0, 0.2, 1)', EASE_OUT = 'cubic-bezier(0.4, 0, 0.9, 0.4)';
  const TIMING = { fade: [120, 100, 'ease-out'], scale: [180, 140, 'ease-out'], genie: [420, 340, EASE_IN], shrink: [200, 200, 'ease-in'] };
  const timing = (kind, out) => { const t = TIMING[kind]; return t ? { duration: t[out ? 1 : 0], easing: out ? (kind === 'genie' ? EASE_OUT : 'ease-in') : t[2] } : null; };
  const px = (v) => `${Math.round(v * 10) / 10}px`;
  const pct = (v) => `${Math.round(v * 100) / 100}%`;
  // The genie, macOS style: the dialog (d, its rect) funnels out of the link (s, its rect). Its near edge (the one facing
  // the link) starts as wide as the link and widens last; the far edge reaches full width first; the whole slides from the
  // link (transform-origin at it). Only clip-path, transform and opacity change; the shape is in shares of the dialog's
  // box, so a dialog that grows as its body arrives keeps it.
  // → { origin, frames } for opening; close plays them backwards.
  const genie = (s, d) => {
    const W = Math.max(1, d.width), H = Math.max(1, d.height);
    const top = s.top + s.height / 2 <= d.top + d.height / 2; // the link is above: the top edge is near
    const clamp = (v) => Math.max(0, Math.min(W, v));
    const sw = Math.min(W, Math.max(1, s.width));
    const nl = Math.min(W - sw, clamp(s.left - d.left)), nr = nl + sw;
    const dx = s.left - d.left - nl;
    const sh = Math.min(H, Math.max(8, s.height));
    const dy = top ? s.top - d.top : s.bottom - d.bottom;
    const lerp = (a, b, t) => a + (b - a) * t;
    // At p the far edge is `reach` of the way down, and the near edge `open` of the way to full width.
    const shape = (reach, open, pinch) => {
      const L = lerp(nl, 0, open), R = lerp(nr, W, open), far = lerp(sh, H, reach), fL = lerp(nl, 0, Math.min(1, reach * 1.6)), fR = lerp(nr, W, Math.min(1, reach * 1.6));
      // the sides bow in toward the near edge: a funnel, not a trapezoid
      const mL = lerp(L, fL, pinch), mR = lerp(R, fR, pinch);
      const y = (v) => (top ? v : H - v);
      return `polygon(${[[L, 0], [R, 0], [mR, far / 2], [fR, far], [fL, far], [mL, far / 2]].map(([x, v]) => `${pct((x / W) * 100)} ${pct((y(v) / H) * 100)}`).join(', ')})`;
    };
    return {
      origin: `${pct(((nl + nr) / 2 / W) * 100)} ${top ? '0%' : '100%'}`,
      frames: [
        { offset: 0, opacity: 0.5, transform: `translate(${px(dx)}, ${px(dy)})`, clipPath: shape(0, 0, 0.2) },
        { offset: 0.45, opacity: 1, transform: `translate(${px(dx * 0.35)}, ${px(dy * 0.35)})`, clipPath: shape(0.6, 0.05, 0.25) },
        { offset: 0.75, opacity: 1, transform: `translate(${px(dx * 0.08)}, ${px(dy * 0.08)})`, clipPath: shape(0.95, 0.55, 0.45) },
        { offset: 1, opacity: 1, transform: 'none', clipPath: shape(1, 1, 0.5) },
      ],
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
