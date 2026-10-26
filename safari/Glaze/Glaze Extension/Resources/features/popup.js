// Glaze's pop-up: one modal dialog over the page, for announcements (features/announce.js) and rubrics. Loaded on demand,
// through GZ_CTX; the parts node tests are lib/popup.js. A second injection keeps the first.
//
//   await GZ_POPUP.ready;                       // its library and the sanitizer are in
//   const h = GZ_POPUP.open({
//     title,                                    // the heading, and the dialog's name unless `label` is given
//     label?, meta?,                            // meta: one line under the title (course · author · date)
//     body,                                     // a Node, an array of them, a string, or an async () => any of those:
//                                               // until it settles the pop-up says Loading… (aria-busy)
//     actions?,                                 // Nodes for its footer (an "Open in …" link)
//     source?,                                  // the Element (or () => Element) it came from: it grows out of it, and
//                                               // focus goes back to it when it closes
//     wide?,                                    // a wider pop-up (tables)
//     onClose?,                                 // after it is gone
//   });
//   h.loaded                                    // body's promise: rejects when an async body failed (the pop-up stays;
//                                               // the caller closes it or says why)
//   h.close(instant?), h.set(body), h.say(text), h.head(title, meta), h.isOpen(), h.closed (a promise)
//   GZ_POPUP.safe(html, origin)                 // a site's HTML as elements, through the one sanitizer (lib/notes.js)
//   GZ_POPUP.current()                          // the open handle, or null; GZ_POPUP.kind() the motion it would use
//
// A real modal <dialog> (the rest of the page inert, focus inside it from the start), named by its title, closed by Escape,
// its Close button or a click outside it, focus then going back where it came from at once, before the closing motion.
// It lives in a closed shadow root, so the school's styles and scripts can't reach in, and wears the Look's tokens (the
// page's --gz-* custom properties), light and dark. Motion (lib/popup.js motion): the genie out of `source` on Expressive,
// a scale and fade on Subtle, a fade or nothing as the "Pop-up animation" setting says, nothing with motion off or reduced.
// Only transform, opacity and clip-path move.
var GZ_POPUP = globalThis.GZ_POPUP || (() => {
  const ctx = globalThis.GZ_CTX;
  const t = (k, v) => ctx.t(k, v);
  let L = globalThis.GZ_POPUP_LIB || null;
  const ready = Promise.all([
    ctx.need('lib/popup.js', () => globalThis.GZ_POPUP_LIB),
    ctx.need('lib/lmsq.js', () => globalThis.GZ_LMSQ),
    ctx.need('lib/doctext.js', () => globalThis.GZ_DOCTEXT).then(() => ctx.need('lib/notes.js', () => globalThis.GZ_NOTES)),
  ]).then(() => { L = globalThis.GZ_POPUP_LIB; });

  const CSS = `:host { all: initial; position: fixed; top: 0; left: 0; width: 0; height: 0; z-index: 2147483647; }
.veil { position: fixed; inset: 0; background: rgb(0 0 0 / 0.35); }
dialog { position: fixed; inset: 0; box-sizing: border-box; display: flex; flex-direction: column; width: min(42em, calc(100vw - 1rem)); height: fit-content;
  max-width: none; max-height: calc(100dvh - 1rem); margin: auto; padding: 0; overflow: hidden; font: 1em/1.5 var(--gz-font, system-ui, sans-serif); text-align: start;
  color: var(--gz-ink, #1d2733); background: var(--gz-surface-grain, none), var(--gz-surface-fill, var(--gz-surface, #fff));
  border: 1px solid var(--gz-border-strong, var(--gz-line-strong, #9aa7b4)); border-radius: var(--gz-radius, 12px); box-shadow: var(--gz-shadow, 0 18px 50px rgb(0 0 0 / 0.3)); }
dialog.wide { width: min(64em, calc(100vw - 1rem)); }
dialog:not([open]) { display: none; }
dialog::backdrop { background: transparent; }
header { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 0.15em 0.75em; padding: 0.9em 0.9em 0.7em 1.1em; border-bottom: 1px solid var(--gz-line, #d5dbe1); }
h2 { margin: 0; font: 600 1.15em/1.3 var(--gz-font-head, var(--gz-font, system-ui, sans-serif)); color: inherit; overflow-wrap: anywhere; outline: none; }
.meta { grid-column: 1; margin: 0; font-size: 0.85em; color: var(--gz-ink-muted, #5b6876); overflow-wrap: anywhere; }
.meta:empty { display: none; }
.x { grid-column: 2; grid-row: 1 / span 2; align-self: start; display: grid; place-items: center; width: 2.25em; height: 2.25em; min-width: 44px; min-height: 44px; margin: -0.35em 0;
  padding: 0; font: inherit; font-size: 1.1em; line-height: 1; color: var(--gz-ink-muted, #5b6876); background: transparent; border: 0; border-radius: 999px; cursor: pointer; }
.x:hover { color: var(--gz-ink, #1d2733); background: var(--gz-row-hover, rgb(0 0 0 / 0.06)); }
.body { flex: 1 1 auto; min-height: 3em; padding: 1em 1.1em; overflow: auto; overscroll-behavior: contain; overflow-wrap: anywhere; }
.body > :first-child { margin-top: 0; }
.body > :last-child { margin-bottom: 0; }
.body p, .body ul, .body ol, .body pre, .body blockquote, .body table { margin: 0 0 0.8em; }
.body h1, .body h2, .body h3 { margin: 1em 0 0.4em; font: 600 1.05em/1.3 var(--gz-font-head, var(--gz-font, system-ui, sans-serif)); }
.body ul, .body ol { padding-inline-start: 1.4em; }
.body blockquote { padding-inline-start: 0.8em; border-inline-start: 3px solid var(--gz-line-strong, #9aa7b4); color: var(--gz-ink-muted, #5b6876); }
.body pre { padding: 0.6em 0.8em; overflow-x: auto; white-space: pre-wrap; background: var(--gz-surface-2, rgb(0 0 0 / 0.05)); border-radius: var(--gz-radius-sm, 6px); }
.body code { font-family: var(--gz-font-mono, ui-monospace, monospace); font-size: 0.92em; }
.body table { display: block; max-width: 100%; overflow-x: auto; border-collapse: collapse; }
.body th, .body td { padding: 0.35em 0.6em; border: 1px solid var(--gz-line, #d5dbe1); text-align: start; vertical-align: top; }
.body img { max-width: 100%; height: auto; border-radius: var(--gz-radius-sm, 6px); }
.body hr { border: 0; border-top: 1px solid var(--gz-line, #d5dbe1); }
a { color: var(--gz-accent, #0b6bcb); text-underline-offset: 0.15em; }
.wait { margin: 0; color: var(--gz-ink-muted, #5b6876); }
.body .files { display: flex; flex-wrap: wrap; gap: 0.35em 0.9em; margin: 1em 0 0; padding: 0.7em 0 0; list-style: none; font-size: 0.9em; border-top: 1px solid var(--gz-line, #d5dbe1); }
footer { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 0.5em; padding: 0.7em 1.1em 0.9em; border-top: 1px solid var(--gz-line, #d5dbe1); }
footer:empty { display: none; }
.go { display: inline-flex; align-items: center; min-height: 2.25em; padding: 0.3em 1em; font-weight: 600; text-decoration: none; color: var(--gz-accent-ink, #fff);
  background: var(--gz-accent, #0b6bcb); border: 1px solid var(--gz-accent, #0b6bcb); border-radius: 999px; }
.go:hover { filter: brightness(1.08); }
:focus-visible { outline: 2px solid var(--gz-accent, #0b6bcb); outline-offset: 2px; }
h2:focus-visible { outline-offset: 4px; }`;

  const make = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids.filter((k) => k != null && k !== false)); return e; };
  // What has focus, through open shadow roots (from Glaze's bar, the document's is the bar's host, which can't take it back).
  const focused = () => { let a = document.activeElement; while (a?.shadowRoot?.activeElement) a = a.shadowRoot.activeElement; return a; };
  const nodes = (b) => (b == null ? [] : Array.isArray(b) ? b : [b]);
  const html = document.documentElement;
  const reduced = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };
  const kind = () => (L ? L.motion({ anim: ctx.settings().popup?.anim, level: html.getAttribute('data-gz-motion') || 'subtle', reduced: reduced() }) : 'none');
  const rectOf = (el) => {
    if (!el?.isConnected) return null;
    try {
      const range = document.createRange();
      range.selectNodeContents(el);
      const r = range.getBoundingClientRect();
      if (r.width && r.height) return r;
    } catch { /* an empty source, or no Range support */ }
    return el.getBoundingClientRect();
  };
  // The genie needs a source smaller than the pop-up, on screen (not the page itself, say): otherwise it scales in.
  const from = (s, d) => L.onScreen(s, innerWidth, innerHeight) && s.width * s.height < d.width * d.height;
  const play = (el, frames, timing) => { try { return el.animate?.(frames, { ...timing, fill: 'none' }) || null; } catch { return null; } };

  let cur = null;
  const open = (o) => {
    cur?.close(true);
    const was = focused();
    const sourceOf = () => (typeof o.source === 'function' ? o.source() : o.source) || null;
    const start = rectOf(sourceOf());
    const host = make('div', { id: 'gz-popup' });
    const root = host.attachShadow({ mode: 'closed' });
    try { const s = new CSSStyleSheet(); s.replaceSync(CSS); root.adoptedStyleSheets = [s]; } catch { root.append(make('style', { textContent: CSS })); }
    const veil = make('div', { className: 'veil' });
    const title = make('h2', { id: 'gz-popup-title', tabIndex: -1, dir: 'auto', textContent: o.title || '' });
    const meta = make('p', { className: 'meta', dir: 'auto', textContent: o.meta || '' });
    const x = make('button', { type: 'button', className: 'x', textContent: '×', title: t('Close') });
    x.setAttribute('aria-label', t('Close'));
    const body = make('div', { className: 'body', dir: 'auto' });
    const foot = make('footer', {}, ...nodes(o.actions));
    const box = make('dialog', { className: o.wide ? 'wide' : '' }, make('header', {}, title, meta, x), body, foot);
    if (o.label) box.setAttribute('aria-label', o.label); else box.setAttribute('aria-labelledby', 'gz-popup-title');
    root.append(veil, box);
    let live = true, done, moving = null;
    const closed = new Promise((r) => { done = r; });
    let images = null;
    const urls = new Set();
    const clearImages = () => { images?.abort(); images = null; for (const u of urls) URL.revokeObjectURL(u); urls.clear(); };
    const set = (b) => {
      clearImages();
      body.removeAttribute('aria-busy'); body.replaceChildren(...nodes(b));
      if (!live) return;
      const ctl = images = new AbortController();
      for (const img of body.querySelectorAll('img')) {
        const src = L.picture(img);
        if (!src) continue;
        // An <img src> would follow redirects, including to trackers. Only verified bytes reach the image element.
        GZ_LMSQ.fetch(src, { credentials: 'same-origin', redirect: 'error', signal: ctl.signal }, 1)
          .then((r) => { if (!r.ok) throw new Error('image'); return r.blob(); })
          .then((blob) => {
            if (ctl.signal.aborted) return;
            if (!blob.type.startsWith('image/')) throw new Error('image');
            const u = URL.createObjectURL(blob); urls.add(u); img.src = u;
          }).catch(() => {
            if (!ctl.signal.aborted) img.replaceWith(make('a', { href: src, target: '_blank', rel: 'noopener noreferrer', textContent: img.getAttribute('alt') || new URL(src).pathname.split('/').pop() || src }));
          });
      }
    };
    const say = (text) => { clearImages(); const p = make('p', { className: 'wait', textContent: text }); p.setAttribute('role', 'status'); body.setAttribute('aria-busy', 'true'); body.replaceChildren(p); };
    const end = () => { moving?.cancel(); box.close(); host.remove(); done(); o.onClose?.(); };
    // Focus goes back first; the motion plays on a dialog no longer modal (inert, out of the tab order), then it goes.
    const close = (instant = false) => {
      if (!live) return;
      live = false;
      clearImages();
      // Still current while focus goes back, so what that focus starts (a preview) knows a pop-up just closed.
      const release = () => { if (cur === h) cur = null; };
      const k = instant ? 'none' : kind();
      const to = sourceOf();
      const box0 = box.getBoundingClientRect(), back = rectOf(to);
      if (box.open) box.close();
      const home = to?.isConnected ? to : was?.isConnected ? was : null;
      if (k === 'none') { home?.focus({ preventScroll: true }); release(); end(); return; }
      box.inert = true;
      box.show();
      home?.focus({ preventScroll: true });
      release();
      const genie = k === 'genie' && from(back, box0);
      const g = genie ? L.genie(back, box0) : null;
      const frames = g ? g.frames.map((f) => ({ ...f, offset: 1 - f.offset })).reverse().map((f, i, a) => (i === a.length - 1 ? { ...f, opacity: 0 } : f))
        : (k === 'genie' ? L.FRAMES.shrink : L.FRAMES[k]).slice().reverse();
      if (g) box.style.transformOrigin = g.origin;
      const timing = L.timing(g ? 'genie' : k === 'genie' ? 'shrink' : k, true);
      moving = play(box, frames, timing);
      play(veil, [{ opacity: 1 }, { opacity: 0 }], timing);
      if (moving) moving.finished.then(end, end); else end();
    };
    box.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
    box.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab') return;
      const all = [...box.querySelectorAll('a[href], button, input, select, textarea, summary, [tabindex], [contenteditable="true"]')]
        .filter((el) => !el.disabled && el.tabIndex >= 0 && !el.closest('[inert]') && el.getClientRects().length)
        .sort((a, b) => (a.tabIndex || Infinity) - (b.tabIndex || Infinity));
      const at = all.indexOf(root.activeElement), next = e.shiftKey ? (at <= 0 ? all.length - 1 : at - 1) : (at + 1) % all.length;
      e.preventDefault(); (all[next] || title).focus({ preventScroll: true });
    });
    // The browser closing it by itself (a repeated Escape it no longer lets the page refuse).
    box.addEventListener('close', () => { if (live && !box.open) close(true); });
    x.addEventListener('click', () => close());
    box.addEventListener('click', (e) => {
      if (e.target !== box) return;
      const r = box.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) close();
    });
    const head = (a, b) => { if (a != null) title.textContent = a; if (b != null) meta.textContent = b; };
    const h = { close, set, say, head, closed, isOpen: () => live, dialog: box, loaded: Promise.resolve() };
    if (typeof o.body === 'function') {
      say(t('Loading…'));
      h.loaded = Promise.resolve().then(o.body).then((b) => { if (live) set(b); });
    } else set(o.body);
    (document.body || html).append(host);
    box.showModal();
    title.focus({ preventScroll: true });
    cur = h;
    const k = kind(), to = box.getBoundingClientRect();
    if (k !== 'none') {
      const g = k === 'genie' && from(start, to) ? L.genie(start, to) : null;
      if (g) box.style.transformOrigin = g.origin;
      const timing = L.timing(g ? 'genie' : k === 'genie' ? 'scale' : k, false);
      moving = play(box, g ? g.frames : L.FRAMES[k === 'genie' ? 'scale' : k], timing);
      play(veil, [{ opacity: 0 }, { opacity: 1 }], timing);
    }
    return h;
  };

  // A site's HTML as elements, through lib/notes.js's sanitizer (after ready).
  const safe = (htmlText, origin = location.origin) => L.safe(htmlText, origin, globalThis.GZ_NOTES, document);

  return { open, ready, safe, current: () => cur, kind };
})();

GZ_POPUP;
