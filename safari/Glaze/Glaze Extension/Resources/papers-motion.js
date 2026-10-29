// The Documents page in motion (papers.html): Glaze's motion (lib/motion.js on motion.css's knobs) and its pop-up's genie
// (lib/popup.js) on the list and between the list and a document. Cards glide to their new places when the search, the
// filters, the order or the view change; a deleted one fades where it was while the rest close up; imported, copied and
// restored ones settle in. The ⋯ menu genies out of its button (Expressive) or settles in, as the rename field and the Undo
// toast do, and each goes the way it came; the status line pops. papers.js passes each of those changes through here (its
// motion()); each reads the level, the three switches, reduced motion and the Pop-up animation setting as it happens, so
// Off is instant.
// A document opens in a page load of its own (the editor has no unmount and saves on pagehide; inside a school's page the
// host keeps the history), so opening and closing one is a cross-document view transition, as Canvas and Moodle pages
// change (content.js): the page leaving says where it goes, how, and out of which card or New tile (sessionStorage); the
// page arriving holds the old picture until it has drawn (at most HOLD ms), then plays the genie out of that box on the new
// picture (a scale about it on Subtle, a crossfade with the Pop-up animation at Fade) or, back on the list, the same
// backwards on the old picture into the card. Back finds the list as it was: search, filters, order and scroll.
// Loaded in papers.html's head, since the page arriving must listen before its first frame. Classic script; the choices
// are exported for node.
var GZ_PAPERS_MOTION = globalThis.GZ_PAPERS_MOTION || (() => {
  const L = globalThis.GZ_POPUP_LIB || (typeof module !== 'undefined' ? require('./lib/popup.js') : null);
  const KINDS = ['none', 'fade', 'scale', 'genie'];

  // ---- the choices
  // What something coming or going gets: lib/popup.js's motion (the Pop-up animation setting, the page's level and the
  // system's reduced motion give none, fade, scale or genie), and none while Glaze's transitions or entrances are off.
  const kind = ({ anim = 'genie', level = 'subtle', reduced = false, trans = true, enter = true } = {}) => (L && trans && enter ? L.motion({ anim, level, reduced }) : 'none');
  const route = kind;
  const px = (v) => `${Math.round(v * 10) / 10}px`;
  // The keyframes and timing that bring `dest` (a box) out of `box`: lib/popup.js's genie where box is on screen (win: the
  // window) and smaller than dest, else its scale (shrink, closing) about box's middle; or its fade. Played forwards to open,
  // backwards (below) to close. → { kind, frames, timing }, or null for none.
  const frames = (k, box, dest, out = false, win = dest) => {
    if (!L || !KINDS.includes(k) || k === 'none') return null;
    const seen = !!box && L.onScreen(box, win.width, win.height) && box.width * box.height < dest.width * dest.height;
    if (k === 'genie' && seen) { const g = L.genie(box, dest); return { kind: 'genie', frames: g.frames.map((f) => ({ ...f, transformOrigin: g.origin })), timing: L.timing('genie', out) }; }
    const use = k === 'genie' ? (out ? 'shrink' : 'scale') : k;
    const origin = seen ? `${px(box.left + box.width / 2 - dest.left)} ${px(box.top + box.height / 2 - dest.top)}` : '50% 50%';
    return { kind: use, frames: L.FRAMES[use].map((f) => (use === 'fade' ? { ...f } : { ...f, transformOrigin: origin })), timing: L.timing(use, out) };
  };
  // Frames played the other way: offsets mirrored, order reversed (as features/popup.js closes).
  const backwards = (list) => list.map((f) => ({ ...f, ...(typeof f.offset === 'number' && { offset: 1 - f.offset }) })).reverse();
  // The document an address opens (its key under a kind's param, lib/doc-kinds.js) and a New tile's format. → or null.
  const address = (search, params = ['paper']) => {
    const q = new URLSearchParams(search || ''), p = params.find((x) => q.get(x));
    return p ? { key: q.get(p), format: q.get('format') || '' } : null;
  };
  const rect = (b) => (b && [b.left, b.top, b.width, b.height].every(Number.isFinite) && b.width > 0 && b.height > 0
    ? { left: b.left, top: b.top, width: b.width, height: b.height, right: b.left + b.width, bottom: b.top + b.height } : null);
  const parse = (raw) => { try { const v = JSON.parse(raw); return v && typeof v === 'object' ? v : null; } catch { return null; } };
  const str = (v, or = '') => (typeof v === 'string' ? v : or);
  // What a page leaving for another of Documents' addresses tells the next: that address (its query), the motion chosen
  // there, the box a document opens out of, and the key and New tile format of the one it closes. → it, checked, or null.
  const handoff = (raw) => {
    const h = parse(raw);
    return h && typeof h.at === 'string' && KINDS.includes(h.kind) ? { at: h.at, kind: h.kind, box: rect(h.box), back: str(h.back) || null, format: str(h.format) } : null;
  };
  // Where the list was as a document opened from it (search, course, kind, order, scroll) and, once that document closes,
  // its key (back) and whether it began on the New band (fresh). → it, checked, or null.
  const place = (raw) => {
    const p = parse(raw);
    return p && { q: str(p.q).slice(0, 200), course: str(p.course) || 'all', kind: str(p.kind), sort: p.sort === 'title' ? 'title' : 'updated',
      y: Number.isFinite(p.y) && p.y > 0 ? p.y : 0, back: str(p.back) || null, fresh: p.fresh === true };
  };
  const api = { kind, route, frames, backwards, address, handoff, place };
  if (typeof document === 'undefined') return api;

  const html = document.documentElement, M = () => globalThis.GZ_MOTION || null;
  const HOLD = 1200, KEY = 'gz-documents-route', LIST = 'gz-documents-list';
  const calm = matchMedia('(prefers-reduced-motion: reduce)');
  let anim = 'genie', revision = 0;
  let changed = () => {};
  const setAnim = (p) => { anim = ['genie', 'fade', 'none'].includes(p?.anim) ? p.anim : 'genie'; changed(); };
  try {
    const read = revision;
    chrome.storage.sync.get('popup').then((r) => { if (revision === read) setAnim(r?.popup); }, () => {});
    chrome.storage.onChanged.addListener((c, area) => { if (area === 'sync' && 'popup' in c) { revision++; setAnim(c.popup.newValue); } });
  } catch { /* outside the extension: the default */ }
  // The motion as the page has it now (papers.js wears the level and the switches on <html>, as content.js does).
  const now = () => ({ anim, level: html.getAttribute('data-gz-motion') || 'subtle', reduced: calm.matches, trans: !html.hasAttribute('data-gz-no-trans'), enter: !html.hasAttribute('data-gz-no-enter') });
  const win = () => ({ left: 0, top: 0, width: innerWidth, height: innerHeight, right: innerWidth, bottom: innerHeight });

  // ---- on the list
  // The genie between `el` and `source` (its button), forwards or back; null where it doesn't fit (scrolled away, larger).
  // Opening, it plays on a copy laid over `el`, which waits unseen in its place, as features/popup.js keeps its dialog under
  // its sheet: what el holds can be clicked and focused from the first frame. Closing, el itself folds (inert by then).
  const opening = new Map(); // el → { a, hold, done } while its copy opens
  const settling = new Map(); // fade/scale entrances also obey a live Pop-up None
  const exits = new Map(); // direct genie exits, released on navigation or a motion change
  const bend = (el, source, out) => {
    const f = frames('genie', source?.isConnected ? source.getBoundingClientRect() : null, el.getBoundingClientRect(), out, win());
    if (f?.kind !== 'genie') return null;
    let copy = null, a = null, hold = null;
    try {
      if (out) return el.animate(backwards(f.frames), { ...f.timing, fill: 'forwards' });
      copy = el.cloneNode(true);
      for (const e of [copy, ...copy.querySelectorAll('[id]')]) e.removeAttribute('id');
      copy.inert = true;
      copy.setAttribute('aria-hidden', 'true');
      copy.dataset.gzGhost = '';
      copy.style.pointerEvents = 'none';
      el.after(copy);
      a = copy.animate(f.frames, { ...f.timing, fill: 'forwards' });
      hold = el.animate([{ opacity: 0 }, { opacity: 0 }], f.timing);
      const turn = { a, hold, done: null };
      const done = turn.done = () => {
        if (opening.get(el) === turn) opening.delete(el);
        copy.remove(); hold.cancel();
        if (!opening.size) { watch.disconnect(); watch.observe(html, { attributes: true, attributeFilter: ['data-gz-motion', 'data-gz-no-trans', 'data-gz-no-enter'] }); }
      };
      opening.set(el, turn);
      watch.observe(document, { childList: true, subtree: true });
      a.finished.then(done, done);
      return a;
    } catch { copy?.remove(); a?.cancel(); hold?.cancel(); return null; }
  };
  const rise = (el) => (el.classList.contains('gd-toast') ? { translate: '0 8px' } : {});
  // What papers.js just put on the page (the ⋯ menu, the rename field, the toast): out of `source` with the genie, else in
  // as Glaze's entrances settle (lib/motion.js enter).
  const open = (el, source) => {
    if (!el?.isConnected) return;
    const k = kind(now());
    if (k === 'none') return;
    if (source && k === 'genie' && bend(el, source, false)) return;
    let a;
    if (k === 'fade') { try { a = el.animate(L.FRAMES.fade, L.timing('fade', false)); } catch { /* instant */ } }
    else a = M()?.enter(el, { from: rise(el) });
    if (a) {
      settling.set(el, a);
      const done = () => { if (settling.get(el) === a) settling.delete(el); a.cancel(); };
      a.finished.then(done, done);
    }
  };
  // …and as it goes: back into its source with the genie (a copy still opening turns back, at the closing pace), else fading
  // (lib/motion.js exit); removed after, or at once.
  const going = new WeakSet();
  const leave = (el, source) => {
    if (!el?.isConnected || going.has(el)) return;
    going.add(el);
    const o = opening.get(el), k = kind(now());
    if (k === 'none') { o?.a.cancel(); o?.done(); el.remove(); return; }
    if (o?.a.playState === 'running') {
      el.inert = true;
      el.style.opacity = '0';
      o.hold.cancel();
      o.a.reverse();
      o.a.playbackRate = -L.timing('genie', false).duration / L.timing('genie', true).duration;
      const gone = () => { exits.delete(el); el.remove(); };
      exits.set(el, { a: o.a, done: gone });
      o.a.finished.then(gone, gone);
      return;
    }
    let a = source && k === 'genie' ? bend(el, source, true) : null;
    if (k === 'fade') { try { a = el.animate(backwards(L.FRAMES.fade), L.timing('fade', true)); } catch { /* instant */ } }
    const gone = () => { exits.delete(el); el.remove(); };
    if (a) { el.inert = true; exits.set(el, { a, done: gone }); a.finished.then(gone, gone); }
    else if (k !== 'fade' && M()) { exits.set(el, { done: gone }); M().exit(el, { to: rise(el) }).then(gone, gone); }
    else el.remove();
  };
  // The status line: new words pop; cleared, the old ones fade first.
  let said = 0;
  const say = (el, text) => {
    const turn = ++said;
    for (const a of el.getAnimations()) a.cancel();
    if (el.textContent === text) return;
    if (text) { el.textContent = text; M()?.pop(el); return; }
    if (!M()) { el.textContent = ''; return; }
    M().exit(el, { remove: false }).then(() => { if (turn === said) el.textContent = ''; });
  };
  // The cards, from where they show to where `change` puts them (lib/motion.js flip): those within a screen of the window.
  // One that leaves fades where it was, on a layer of its own over the list (the list holds only cards); new ones settle in.
  // Still while the list is put back as it was.
  let ghosts = null, still = false;
  const cards = (change) => {
    const G = M(), docs = document.getElementById('gd-docs');
    if (!G || still || document.hidden || !docs?.parentElement) return change();
    const k = G.knobs();
    if (!k.move && !k.fade) return change();
    if (ghosts?.parentElement !== docs.parentElement) {
      ghosts = Object.assign(document.createElement('div'), { className: 'gd-ghosts', inert: true });
      ghosts.setAttribute('aria-hidden', 'true');
      docs.before(ghosts);
    }
    const near = () => { const h = innerHeight; return [...docs.children].filter((el) => { const r = el.getBoundingClientRect(); return r.bottom > -h / 2 && r.top < h * 1.5; }); };
    return G.flip(near, change, { ghosts: true, container: ghosts });
  };

  // ---- between the list and a document
  const store = (() => { try { return sessionStorage; } catch { return null; } })();
  const take = (k) => { try { const v = store?.getItem(k) ?? null; store?.removeItem(k); return v; } catch { return null; } };
  const keep = (k, v) => { try { store?.setItem(k, JSON.stringify(v)); } catch { /* the next page opens without it */ } };
  // The host gives every iframe instance its own name: replacement frames share sessionStorage, not handoffs.
  const context = globalThis.name || '';
  // Consume on load too: Firefox and Safari 18.0 never dispatch pagereveal. A crash or abandoned navigation cannot
  // leave a record waiting for a later deep link. Native transitions also require a fresh matching handoff below.
  let incoming = parse(take(KEY));
  const params = () => ['paper', ...Object.values(globalThis.GZ_DOC_KINDS?.KINDS || {}).map((x) => x.param)];
  const here = () => address(location.search, params());
  const boxOf = (el) => rect(el?.isConnected ? el.getBoundingClientRect() : null);
  // The card a document's address belongs to on the list, or for a new one its New tile's page.
  const sourceOf = (a) => (a ? document.querySelector(`.gd-card[data-key="${CSS.escape(a.key)}"]`)
    || (a.format ? document.querySelector(`.gd-tile[data-format="${CSS.escape(a.format)}"] .gd-tile-pic`) : null) : null);

  // The list's place as the page leaves it. A document opened from it carries that place and, closing, names itself in it.
  const FIELDS = { q: 'gd-q', course: 'gd-course', kind: 'gd-kind', sort: 'gd-sort' };
  const saved = parse(take(LIST));
  const arrived = saved?.context === context ? place(JSON.stringify(saved)) : null;
  if (!here() && arrived?.back) { try { history.scrollRestoration = 'manual'; } catch { /* the browser's own */ } }
  addEventListener('pagehide', () => {
    const at = here(), list = document.getElementById('list');
    if (!at && list && !list.hidden) {
      const p = { y: scrollY, context };
      for (const [k, id] of Object.entries(FIELDS)) p[k] = document.getElementById(id)?.value ?? '';
      keep(LIST, p);
    } else if (at && arrived) keep(LIST, { ...arrived, context, back: at.key, fresh: !!at.format });
  });
  const restore = (p) => {
    still = true;
    try {
      for (const [k, id] of Object.entries(FIELDS)) {
        const el = document.getElementById(id), v = p[k];
        if (!el || el.value === v || (el.tagName === 'SELECT' && ![...el.options].some((o) => o.value === v))) continue;
        el.value = v;
        el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input'));
      }
    } finally { still = false; }
    if (p.y) scrollTo({ top: p.y, behavior: 'instant' });
  };

  // The page leaving: where it goes (the Navigation API's entry, else the link last clicked) and how, or no transition.
  let clicked = '';
  document.addEventListener('click', (e) => { clicked = e.target.closest?.('a[href]')?.href || ''; }, true);
  addEventListener('pageswap', (e) => {
    const vt = e.viewTransition;
    take(KEY);
    if (!vt) return;
    const to = new URL(e.activation?.entry?.url || clicked || location.href, location.href), k = route(now());
    if (k === 'none' || to.origin !== location.origin || to.pathname !== location.pathname) { vt.skipTransition(); return; }
    const from = here();
    keep(KEY, { context, time: Date.now(), from: location.href, view: win(), at: to.search, kind: k, box: from ? null : boxOf(sourceOf(address(to.search, params()))), back: from?.key || null, format: from?.format || '' });
  });
  // The page arriving: the old picture held, the new one hidden, until this page has drawn (shown), then played.
  let pending = null, drawn = false, waiting = null, deadline = 0;
  const end = (turn, skip = false) => {
    if (pending !== turn) return;
    pending = null;
    cancelAnimationFrame(deadline); deadline = 0;
    waiting?.disconnect(); waiting = null;
    turn.hold?.cancel();
    html.removeAttribute('data-gd-route');
    if (skip) turn.vt.skipTransition();
    settle();
  };
  addEventListener('pagereveal', (e) => {
    const vt = e.viewTransition, raw = incoming || parse(take(KEY));
    incoming = null;
    const h = handoff(JSON.stringify(raw)), age = Date.now() - raw?.time;
    const activation = globalThis.navigation?.activation;
    if (!vt) return;
    if (!h || h.at !== location.search || raw.context !== context || !Number.isFinite(age) || age < 0 || age > 4000
      || (activation?.from?.url && activation.from.url !== raw.from)
      || route(now()) === 'none') { vt.skipTransition(); return; }
    if (pending) end(pending, true);
    const turn = pending = { vt, h, view: raw.view, hold: null, ready: false, until: performance.now() + HOLD };
    html.setAttribute('data-gd-route', 'hold');
    // A bounded frame loop only while waiting for the editor/host. No work on an ordinary first load, and no layout reads.
    const limit = () => {
      if (pending !== turn || turn.played) return;
      if (performance.now() >= turn.until) { end(turn, true); return; }
      deadline = requestAnimationFrame(limit);
    };
    deadline = requestAnimationFrame(limit);
    vt.ready.then(() => {
      if (pending !== turn) return;
      if (performance.now() >= turn.until) { end(turn, true); return; }
      turn.ready = true;
      try { turn.hold = html.animate([{ opacity: 0 }, { opacity: 0 }], { duration: Math.max(1, turn.until - performance.now()), pseudoElement: '::view-transition-new(root)' }); }
      catch { end(turn, true); return; }
      turn.hold.finished.then(() => { if (!turn.played) end(turn, true); }, () => {});
      play();
    }, () => end(turn, true));
    vt.finished.then(() => end(turn), () => end(turn));
  });
  // Inside a school's page (papers.js's embedded section) the page shows only once its frame is let in.
  const visible = () => !html.hasAttribute('data-embedded') || html.style.getPropertyValue('opacity') !== '0';
  const play = () => {
    const p = pending;
    if (!p?.ready || p.played || !drawn) return;
    // Home can draw before its asynchronously loaded Look has worn the motion level. Keep the captured page until
    // both are ready, rather than accidentally using the head script's Subtle fallback for an Expressive return.
    if (!visible() || !html.hasAttribute('data-gz-motion')) {
      waiting ||= new MutationObserver(play);
      waiting.observe(html, { attributes: true, attributeFilter: ['style', 'data-gz-motion'] });
      return;
    }
    waiting?.disconnect(); waiting = null;
    const current = route(now());
    if (current === 'none' || performance.now() >= p.until) { end(p, true); return; }
    p.played = true;
    cancelAnimationFrame(deadline); deadline = 0;
    p.hold?.cancel();
    const back = !!p.h.back && !here(), view = win();
    const sameSize = p.view?.width === view.width && p.view?.height === view.height;
    const f = frames(current === 'genie' && p.h.kind !== 'genie' ? p.h.kind : current, back ? boxOf(sourceOf({ key: p.h.back, format: p.h.format })) : sameSize ? p.h.box : null, view, back, view);
    settle();
    if (!f) { end(p, true); return; }
    // A crossfade (Fade) is lib/motion.js swap's: at the transitions' pace, the pictures added (motion.css).
    const k = f.kind === 'fade' && M()?.knobs(), timing = k?.fade ? { duration: k.fade, easing: k.ease } : f.timing;
    html.setAttribute('data-gd-route', back ? 'back' : f.kind === 'fade' ? 'fade' : 'open');
    const old = '::view-transition-old(root)', fresh = '::view-transition-new(root)';
    try {
      html.animate(back ? backwards(f.frames) : f.frames, { ...timing, fill: 'both', pseudoElement: back ? old : fresh });
      // The other picture stays whole underneath as long, or goes as this one comes in a crossfade.
      const other = f.kind === 'fade' ? (back ? f.frames : backwards(f.frames)) : [{ opacity: 1 }, { opacity: 1 }];
      html.animate(other, { ...timing, fill: 'both', pseudoElement: back ? fresh : old });
    } catch { end(p, true); }
  };
  // papers.js: the list (home) or a document (paper) has drawn. Back on the list: its place again, and a new document's card
  // settles in once the document has measured it to fold into.
  let entering = null;
  const settle = () => { const c = entering; entering = null; if (c?.isConnected) M()?.enter(c); };
  const shown = (what) => {
    if (what === 'home' && arrived?.back) {
      restore(arrived);
      entering = arrived.fresh ? document.querySelector(`.gd-card[data-key="${CSS.escape(arrived.back)}"]`) : null;
    }
    drawn = true;
    if (pending) play(); else settle();
  };

  const finishMenus = () => {
    for (const [, a] of settling) a.cancel();
    settling.clear();
    for (const [el, o] of opening) { o.a.cancel(); o.done(); if (going.has(el)) el.remove(); }
    for (const [, o] of exits) { o.a?.cancel(); o.done(); }
  };
  changed = () => { if (pending && route(now()) === 'none') end(pending, true); if (kind(now()) === 'none') finishMenus(); };
  const watch = new MutationObserver(() => {
    changed();
    for (const [el, o] of opening) if (!el.isConnected) { o.a.cancel(); o.done(); }
  });
  watch.observe(html, { attributes: true, attributeFilter: ['data-gz-motion', 'data-gz-no-trans', 'data-gz-no-enter'] });
  calm.addEventListener('change', changed);
  addEventListener('pagehide', () => { incoming = null; if (pending) end(pending, true); finishMenus(); });
  addEventListener('pageshow', (e) => {
    if (!e.persisted) return;
    incoming = parse(take(KEY));
    if (pending) end(pending, true);
    html.removeAttribute('data-gd-route');
    take(LIST); finishMenus();
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden) { if (pending) end(pending, true); finishMenus(); } });

  return { ...api, cards, open, leave, say, shown };
})();

if (typeof module !== 'undefined') module.exports = GZ_PAPERS_MOTION; else GZ_PAPERS_MOTION;
