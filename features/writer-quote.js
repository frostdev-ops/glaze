// Glaze Writer's Quote pop, loaded with features/writer.js: while a reply box is open in Glaze's editor, selecting text in a
// post of the thread shows the mockup's "Quote" above the selection. It puts the text, with its author from the thread
// data (lib/writer-context-discussion.js; none when that isn't read), into the reply that answers the post (else the reply
// box in the same thread), as compose's quote. It only listens to the selection, never changes it before the click. It sits
// right after the post's text, so Tab from the selection reaches it and Tab again goes on to the post's own controls;
// scrolling, leaving the window, Escape or a new selection take it away.
// Classic script, through GZ_CTX; a second injection keeps the first. Without GZ_CTX (node), module.exports has place, clean.
var GZ_WRITER_QUOTE = globalThis.GZ_WRITER_QUOTE || (() => {
  const MAX = 2000;
  // The selection's text as quoted lines: whitespace folded, blank lines dropped, cut at MAX.
  const clean = (s) => String(s || '').replace(/\r\n?/g, '\n').split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n').slice(0, MAX);
  // Where the pop goes for a selection's line boxes (viewport px): centred above its first line, or under its last when
  // there's no room above; inside the window either way. → { x, y, below } for the pop's arrow tip.
  const place = (rects, w, h, vw, vh, gap = 8) => {
    const list = [...(rects || [])].filter((r) => r && r.width + r.height > 0);
    if (!list.length) return null;
    const first = list[0], last = list[list.length - 1], below = first.top - gap - h < 4;
    const line = below ? last : first, x = Math.max(4 + w / 2, Math.min(vw - 4 - w / 2, (line.left + line.right) / 2));
    const y = below ? Math.min(vh - 4 - h - gap, line.bottom + gap) : first.top - gap;
    return { x: Math.round(x), y: Math.round(y), below };
  };
  const X = globalThis.GZ_CTX;
  if (!X || typeof document === 'undefined') { if (typeof module !== 'undefined') module.exports = { clean, place }; return null; }

  const on = () => X.on() && X.settings().enabled !== false && !!X.settings().enhance?.writer;
  const boxes = []; // reply boxes, in the order they opened
  const live = (box) => (!box.path || box.path === location.pathname) && box.kind === 'reply' && box.ready && !!box.port && !!box.frame?.isConnected;
  const BODY = '.ql-editor[contenteditable="false"]';
  const elOf = (n) => (n?.nodeType === 1 ? n : n?.parentElement);
  // The read-only post body a node is in, and the post's message id, or null (an editor, Glaze's own, no id).
  const postOf = (n) => {
    const body = elOf(n)?.closest?.(BODY);
    if (!body || body.closest('.reply-input-wrapper, [data-gz-writer]')) return null;
    const post = body.closest('[message-id]:not([message-id=""])');
    return post ? { body, id: post.getAttribute('message-id') } : null;
  };
  // The reply that answers this post, else one in its thread, never a box in another thread.
  const replyFor = (post) => {
    const open = boxes.filter(live);
    const answers = (b) => (globalThis.GZ_WRITER_ULTRA?.replyTo?.(b.editor) || b.context?.post?.id) === post.id;
    const thread = post.body.closest('.comment-and-reply');
    return open.find(answers) || open.find((b) => thread?.contains(b.root)) || null;
  };

  // ---- the pop ----------------------------------------------------------------------------------------------------------
  const CSS = `
:host { all: initial; position: fixed; z-index: 2147483000; left: 0; top: 0; width: 0; height: 0; }
button { all: unset; box-sizing: border-box; position: absolute; left: 0; bottom: 0; display: flex; gap: 6px; align-items: center; white-space: nowrap; cursor: pointer;
  padding: 5px 10px; border-radius: 8px; font: 600 13px/1.5 var(--gz-font, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif);
  background: var(--gz-ink, #e8f2fa); color: var(--gz-accent-ink, #04121f); box-shadow: 0 12px 32px rgba(0,0,0,.45), 0 2px 6px rgba(0,0,0,.35);
  transform: translateX(-50%) scale(.98); transform-origin: 50% 100%; opacity: 0; transition: opacity 150ms ease-out, transform 150ms ease-out; }
button::after { content: ""; position: absolute; left: 50%; bottom: -5px; border: 5px solid transparent; border-bottom: 0; border-top-color: var(--gz-ink, #e8f2fa); transform: translateX(-50%); }
:host([data-below]) button { bottom: auto; top: 0; transform-origin: 50% 0; }
:host([data-below]) button::after { bottom: auto; top: -5px; border: 5px solid transparent; border-top: 0; border-bottom-color: var(--gz-ink, #e8f2fa); }
:host([data-open]) button { opacity: 1; transform: translateX(-50%); }
:host([data-still]) button { transition: none; }
button:focus-visible { outline: 2px solid var(--gz-accent, #17c8f4); outline-offset: 2px; }
svg { width: 16px; height: 16px; stroke: currentColor; fill: none; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
@media (prefers-reduced-motion: reduce) { button { transition: none; } }`;
  let host = null, button = null, shown = null; // shown: { box, id, text, range }
  const make = () => {
    host = document.createElement('div');
    host.className = 'gz-writer-quote';
    const root = host.attachShadow({ mode: 'closed' });
    try { const s = new CSSStyleSheet(); s.replaceSync(CSS); root.adoptedStyleSheets = [s]; } catch { const s = document.createElement('style'); s.textContent = CSS; root.append(s); }
    button = document.createElement('button');
    button.type = 'button';
    const NS = 'http://www.w3.org/2000/svg', svg = document.createElementNS(NS, 'svg'), path = document.createElementNS(NS, 'path');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    path.setAttribute('d', 'M7 7h4v4c0 3-2 5-4 6M15 7h4v4c0 3-2 5-4 6');
    svg.append(path);
    button.append(svg, document.createElement('span'));
    // Pressing it keeps the page's selection (and focus) where they are until the click.
    button.addEventListener('pointerdown', (e) => e.preventDefault());
    button.addEventListener('mousedown', (e) => e.preventDefault());
    button.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); quote(); });
    button.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); hide(); } });
    button.addEventListener('blur', () => { if (shown) hide(); });
    root.append(button);
  };
  const hide = () => {
    shown = null;
    if (!host) return;
    host.removeAttribute('data-open');
    host.remove();
  };
  const show = (sel, post, box) => {
    const range = sel.getRangeAt(0), text = clean(sel.toString());
    if (!text) { hide(); return; }
    if (!host) make();
    button.lastChild.textContent = X.t('Quote');
    button.setAttribute('aria-label', X.t('Quote'));
    host.toggleAttribute('data-still', (document.documentElement.getAttribute('data-gz-motion') || 'off') === 'off');
    const anchor = post.body.closest('.ql-container') || post.body;
    const fresh = host.previousSibling !== anchor || !host.isConnected;
    if (fresh) { host.removeAttribute('data-open'); anchor.after(host); }
    const at = place(range.getClientRects(), button.offsetWidth || 80, button.offsetHeight || 30, innerWidth, innerHeight);
    if (!at) { hide(); return; }
    // Fixed to the window, unless a transformed ancestor of Ultra's holds it: then measured and moved by the difference.
    for (const [k, v] of [['position', 'fixed'], ['display', 'block'], ['margin', '0'], ['padding', '0'], ['width', '0'], ['height', '0'], ['left', `${at.x}px`], ['top', `${at.y}px`]]) host.style.setProperty(k, v, 'important');
    const r = host.getBoundingClientRect();
    if (Math.abs(r.left - at.x) + Math.abs(r.top - at.y) > 1) { host.style.setProperty('left', `${2 * at.x - r.left}px`, 'important'); host.style.setProperty('top', `${2 * at.y - r.top}px`, 'important'); }
    host.toggleAttribute('data-below', at.below);
    shown = { box, id: post.id, text };
    if (fresh) { host.getBoundingClientRect(); host.setAttribute('data-open', ''); }
  };
  const quote = () => {
    const s = shown;
    hide();
    if (!s || !on() || !live(s.box)) return;
    const author = globalThis.GZ_WRITER_CONTEXT_DISCUSSION?.author?.(s.id) || '';
    s.box.port.postMessage({ type: 'quote', text: s.text, author });
    s.box.frame.focus();
    s.box.port.postMessage({ type: 'focus' });
    getSelection()?.removeAllRanges();
  };

  // ---- the selection --------------------------------------------------------------------------------------------------
  let queued = false, raf = 0;
  const update = () => {
    queued = false; raf = 0;
    if (host?.matches(':focus-within')) return; // the student reached the pop by Tab: it stays for them
    const sel = getSelection();
    if (!on() || !sel || sel.isCollapsed || !sel.rangeCount) { hide(); return; }
    const post = postOf(sel.anchorNode);
    if (!post || postOf(sel.focusNode)?.body !== post.body) { hide(); return; }
    const box = replyFor(post);
    if (!box) { hide(); return; }
    show(sel, post, box);
  };
  const later = () => { if (!queued) { queued = true; raf = requestAnimationFrame(update); } };
  let listening = false;
  const dismiss = () => { if (shown) hide(); };
  const escape = (e) => { if (shown && e.key === 'Escape' && !e.defaultPrevented) hide(); };
  const listen = () => {
    if (listening) return;
    listening = true;
    document.addEventListener('selectionchange', later);
    addEventListener('scroll', dismiss, { capture: true, passive: true });
    addEventListener('blur', dismiss);
    addEventListener('resize', dismiss);
    document.addEventListener('keydown', escape, true);
  };
  const disarm = (box) => {
    const i = boxes.indexOf(box);
    if (i !== -1) boxes.splice(i, 1);
    if (shown?.box === box) hide();
    if (boxes.length) return;
    hide();
    document.removeEventListener('selectionchange', later);
    removeEventListener('scroll', dismiss, true);
    removeEventListener('blur', dismiss);
    removeEventListener('resize', dismiss);
    document.removeEventListener('keydown', escape, true);
    cancelAnimationFrame(raf);
    raf = 0; queued = listening = false;
    host = button = null;
  };
  // features/writer.js, as a reply box's frame comes up (and again when it reopens).
  const arm = (box) => {
    if (!on() || box?.kind !== 'reply' || !live(box)) return;
    if (!boxes.includes(box)) boxes.push(box);
    for (let i = boxes.length - 1; i >= 0; i--) if (boxes[i].frame && !boxes[i].frame.isConnected) boxes.splice(i, 1);
    listen();
  };
  return { clean, place, arm, disarm };
})();
if (typeof module !== 'undefined' && GZ_WRITER_QUOTE) module.exports = GZ_WRITER_QUOTE;
GZ_WRITER_QUOTE;
