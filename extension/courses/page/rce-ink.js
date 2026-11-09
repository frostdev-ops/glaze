// Canvas's rich content editor (TinyMCE) writes in an about:blank frame of Canvas's own origin, which canvas.css doesn't
// reach: a style in that frame's head gives its page the palette's surface, ink, accent, selection and placeholder, as
// values (a frame doesn't inherit the page's variables). On a dark palette an author's own dark colours are lifted and a
// highlight keeps dark ink, as canvas.css shows them in a posted reply. Only the head changes: TinyMCE saves the body.
// Put back when TinyMCE writes its frame anew (load) and when the palette changes (<html>'s own attributes); gone when
// Glaze stops or the page is left. A page feature (content/routes.js).
var GZ_RCE_INK = globalThis.GZ_RCE_INK || (() => {
  const ctx = globalThis.GZ_CTX;
  if (!ctx) return null;
  const ID = 'gz-rce-ink';
  const FRAMES = 'iframe.tox-edit-area__iframe';
  const VARS = ['--gz-surface', '--gz-surface-paint', '--gz-surface-color', '--gz-surface-tint-strength', '--gz-surface-course', '--gz-surface-course-weight', '--gz-ink', '--gz-ink-faint', '--gz-accent', '--gz-accent-soft'];
  const html = document.documentElement;
  const known = new Set();
  let active = false, watch = null, frame = 0, key = '', css = '';
  // The palette as content.js wrote it on <html>, and whether it is dark: the sheet is built again only when that changes,
  // not for the other variables <html> carries (a course tab's frame writes its viewport there as it scrolls).
  const keyNow = () => VARS.map((v) => html.style.getPropertyValue(v)).join('|') + html.hasAttribute('data-gz-dark-theme');
  const sheet = () => {
    // Each colour resolved here, where the variables are (color-mix and var() fallbacks included).
    const probe = document.createElement('i');
    probe.hidden = true;
    document.head.append(probe);
    const cs = getComputedStyle(probe);
    const [surface, ink, faint, accent, soft] = ['var(--gz-surface-paint, var(--gz-surface))', 'var(--gz-ink)', 'var(--gz-ink-faint)', 'var(--gz-accent)', 'var(--gz-accent-soft)']
      .map((v) => { probe.style.color = v; return cs.color; });
    probe.remove();
    const dark = html.hasAttribute('data-gz-dark-theme');
    const body = 'body.mce-content-body';
    return `html{color-scheme:${dark ? 'dark' : 'light'};background:${surface}}`
      + `${body}{background:${surface}!important;color:${ink}!important}${body} a{color:${accent}}`
      + `${body} ::selection{background:${soft};color:${ink}}${body}[data-mce-placeholder]:not(.mce-visualblocks)::before{color:${faint}}`
      + (dark ? `${body} [style*="color"]{-webkit-text-fill-color:oklch(from currentColor max(l, 0.78) c h)}${body} [style*="background-color"]{-webkit-text-fill-color:#14181f}` : '');
  };
  const ink = (f, text) => {
    let doc = null;
    try { doc = f.contentDocument; } catch { return; }
    if (!doc?.head) return;
    let el = doc.head.querySelector(`style#${ID}`);
    if (!text) { el?.remove(); return; }
    if (!el) { el = doc.createElement('style'); el.id = ID; }
    if (el.textContent !== text) el.textContent = text;
    // Last in the head, after the content CSS TinyMCE adds as it starts.
    if (doc.head.lastElementChild !== el) doc.head.append(el);
  };
  const release = (f) => { f.removeEventListener('load', later); ink(f, ''); known.delete(f); };
  const later = () => { if (active && !frame) frame = requestAnimationFrame(() => { frame = 0; if (active) sync(); }); };
  const sync = () => {
    if (!ctx.on()) return off();
    const frames = new Set(document.querySelectorAll(FRAMES));
    for (const f of known) if (!frames.has(f)) release(f);
    if (!frames.size) return off();
    active = true;
    const now = keyNow();
    if (now !== key) { key = now; css = sheet(); }
    for (const f of frames) {
      if (!known.has(f)) { known.add(f); f.addEventListener('load', later); }
      ink(f, css);
    }
    if (!watch) { watch = new MutationObserver(later); watch.observe(html, { attributes: true, attributeFilter: ['style', 'data-gz-dark-theme'] }); }
  };
  const off = () => {
    active = false;
    watch?.disconnect(); watch = null;
    cancelAnimationFrame(frame); frame = 0; key = '';
    for (const f of known) release(f);
  };
  return { sync, off };
})();

GZ_RCE_INK;
