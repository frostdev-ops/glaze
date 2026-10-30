// Announcements in Glaze's pop-up (features/popup.js) over the page, and their preview on hover or focus. Loaded on
// demand, through GZ_CTX; what node tests is lib/announce.js. A second injection keeps the first.
//
// A reference is { site: 'canvas' | 'ultra' | 'moodle', courseId (Moodle: optional), id (the discussion topic, Ultra's
// announcement, Moodle's discussion), url (the site's own page for it), title?, course?, entry?: 'glaze' | 'canvas' |
// 'ultra' | 'moodle' (whose setting decides; the site's by default), from?: Element or () => Element (where it grows from
// and focus goes back to; what has focus by default), onRead?() (after the site has it as read), and for a preview only:
// author?, at? (ms), text? (what the page already shows) }.
//
//   await GZ_ANNOUNCE.ready                // its libraries are in: mode() and handle() work from here on
//   GZ_ANNOUNCE.mode(entry)                // 'popup' | 'site', that entry point's setting
//   GZ_ANNOUNCE.handle(event, ref)         // a click: true when it took it (a plain click, mode pop-up: preventDefault and
//                                          // open); false leaves it to the page (Ctrl, Cmd, Shift, Alt, a middle click,
//                                          // the site's page chosen)
//   GZ_ANNOUNCE.go(ref)                    // what a plain click means under the setting: open(), or the site's page
//   GZ_ANNOUNCE.open(ref)                  // the pop-up, whatever the setting
//   GZ_ANNOUNCE.preview(el, ref)           // previews on el; returns a function that takes them off
//   GZ_ANNOUNCE.sync(), off()              // the site's own lists (GZ_ROUTES, features/routes.js): hooked, unhooked
//
// The site's own lists: features/routes.js loads this on their pages; it then reads only lib/announce.js's recognisers
// (find) until the first pointerover, focus or click on one of their announcements brings the rest (ready). A plain click
// there is taken at the window, before the site's own handlers: preventDefault and stopPropagation, then the pop-up.
//
// One request per open: the announcement, from this site, with the student's session, through the site's queue
// (lib/lmsq.js), kept for the page's life and shared with previews, so a pop-up after a preview asks nothing. Then the read
// mark, where the site marks one on opening (lib/announce.js SITES). A preview asks only after its delay, gives up when the
// pointer or focus leaves first, and never marks anything read (Moodle's answer would, so a Moodle preview asks nothing).
// If the announcement can't be read, the site's page opens instead.
var GZ_ANNOUNCE = globalThis.GZ_ANNOUNCE || (() => {
  const ctx = globalThis.GZ_CTX;
  const t = (k, v) => ctx.t(k, v);
  let A = globalThis.GZ_ANNOUNCE_LIB || null;
  const prefs = () => ctx.settings().announce || {};
  const libs = ctx.need('lib/popup.js', () => globalThis.GZ_POPUP_LIB).then(() => ctx.need('lib/announce.js', () => globalThis.GZ_ANNOUNCE_LIB))
    .then(() => { A = globalThis.GZ_ANNOUNCE_LIB; });
  // The pop-up's own files, asked for when first wanted (GZ_ANNOUNCE.ready, or a hover, focus or click on a site's list).
  let all = null, loaded = false;
  const load = () => (all ||= Promise.all([libs, ctx.need('features/popup.js', () => globalThis.GZ_POPUP).then(() => GZ_POPUP.ready), ctx.need('lib/lmsq.js', () => globalThis.GZ_LMSQ)])
    .then(() => { loaded = true; }, (e) => { all = null; throw e; }));

  const make = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids.filter((k) => k != null && k !== false)); return e; };
  const focused = () => { let a = document.activeElement; while (a?.shadowRoot?.activeElement) a = a.shadowRoot.activeElement; return a; };
  const mode = (entry) => (A ? A.mode(prefs(), entry) : 'popup');
  const refOf = (x) => (A ? A.ref(x, location.origin) : null);
  const lang = () => GZ_I18N.locale(ctx.locale());
  const when = (at) => (at ? new Date(at).toLocaleString(lang(), { dateStyle: 'medium', timeStyle: 'short' }) : '');
  const metaOf = (r, it) => [r.course, it?.author, when(it?.at)].filter(Boolean).join(' · ');

  // ---- reading -----------------------------------------------------------------------------------------------------
  const cache = new Map(); // key -> item, for the page's life
  const asking = new Map(); // key -> { p, ctl, kept }: a request in flight; kept once a pop-up waits on it
  const marking = new Map(); // key -> Canvas's read mark in flight
  const csrf = () => { const m = document.cookie.match(/(?:^|;\s*)_csrf_token=([^;]*)/); return m ? decodeURIComponent(m[1]) : ''; };
  const json = async (res) => { if (!res.ok) throw new Error(`HTTP ${res.status}`); return JSON.parse((await res.text()).replace(/^while\(1\);/, '')); };
  const ACCEPT = 'application/json+canvas-string-ids, application/json';
  // prio: 0 for a pop-up, 1 for a preview (the site's queue puts what's asked for now first).
  const fetchOne = async (r, prio, signal) => {
    const S = A.SITES[r.site];
    const q = (url, init) => GZ_LMSQ.fetch(url, { credentials: 'same-origin', redirect: 'error', signal, ...init }, prio);
    if (r.site === 'canvas') {
      const g = S.get(r);
      return S.item(await json(await q(g.url, { headers: { accept: ACCEPT } })), r.origin);
    }
    if (r.site === 'ultra') {
      await ctx.need('lib/ultra.js', () => globalThis.GZ_ULTRA);
      return S.item(await GZ_ULTRA.read({ origin: r.origin, signal, f: (u, i) => GZ_LMSQ.fetch(u, i, prio) }).get(S.path(r)), r.origin);
    }
    const s = (await ctx.moodleIn()).session();
    if (!s) throw new Error('signed out');
    const g = S.get(r, s);
    return S.item(await json(await q(g.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: g.body })), r.origin);
  };
  const read = (r, { prio = 0, peek = false } = {}) => {
    if (cache.has(r.key)) return Promise.resolve(cache.get(r.key));
    const was = asking.get(r.key);
    if (was && !was.ctl.signal.aborted) { if (!peek) was.keep(); return was.p; }
    const ctl = new AbortController();
    let timer = 0;
    // A pop-up waits ten seconds at most, then the site's page opens; a preview's request it takes over too.
    const job = { ctl, kept: false, p: null, keep: () => { if (job.kept) return; job.kept = true; timer = setTimeout(() => ctl.abort(new Error('timeout')), 10000); } };
    if (!peek) job.keep();
    job.p = fetchOne(r, prio, ctl.signal).then((it) => {
      if (ctl.signal.aborted) throw ctl.signal.reason;
      cache.set(r.key, it);
      return it;
    }).finally(() => { clearTimeout(timer); if (asking.get(r.key) === job) asking.delete(r.key); });
    asking.set(r.key, job);
    return job.p;
  };
  // The read mark, where the site makes one on opening; onRead once the site has it.
  const markRead = (r, it, onRead) => {
    if (!it.unread) return;
    if (r.site === 'moodle') { if (!it.manualRead) { it.unread = false; onRead?.(); } return; } // only automatic forum tracking marks it
    const m = A.SITES[r.site].mark(r, it);
    if (!m) return;
    if (!marking.has(r.key)) marking.set(r.key,
      GZ_LMSQ.fetch(m.url, { method: m.method, credentials: 'same-origin', redirect: 'error', headers: { accept: ACCEPT, 'x-csrf-token': csrf(), 'x-requested-with': 'XMLHttpRequest' } })
        .then((res) => { if (res.ok) it.unread = false; return res.ok; }, () => false).finally(() => marking.delete(r.key)));
    marking.get(r.key).then((ok) => { if (ok) onRead?.(); });
  };

  // ---- the pop-up --------------------------------------------------------------------------------------------------
  // The site's own page, as a click on its link did before: through the course tabs where they run.
  const leave = (url) => { const own = url && GZ_POPUP_LIB.own(url, location.origin); if (own) globalThis.GZ_CTABS?.bar?.open(own) || location.assign(own); };
  let showing = null; // { key, h }
  const open = (x) => {
    const r = refOf(x);
    if (!r) { leave(x?.url); return null; }
    if (showing?.key === r.key && showing.h.isOpen()) return showing.h;
    asking.get(r.key)?.keep();
    hide();
    const S = A.SITES[r.site];
    const go = make('a', { className: 'go', href: r.url, textContent: t('Open in {site}', { site: S.name }) });
    // A plain click on it leaves the pop-up for the site's page; with a modifier, the browser's new tab, the pop-up stays.
    go.addEventListener('click', (e) => { if (A.plain(e)) h.close(true); });
    // What the pop-up shows of it; the read mark goes as it is shown.
    const fill = (it) => {
      markRead(r, it, x.onRead);
      const files = it.files.length && make('ul', { className: 'files' }, ...it.files.map((f) => make('li', {}, make('a', { href: f.url, target: '_blank', rel: 'noopener noreferrer', textContent: f.name }))));
      return [...GZ_POPUP.safe(it.html, r.origin), files].filter(Boolean);
    };
    // Read already (a preview, an earlier open): drawn at once, with no Loading… and no request.
    const kept = cache.get(r.key);
    const h = GZ_POPUP.open({
      title: kept?.title || r.title || t('Announcement'), meta: kept ? metaOf(r, kept) : r.course, actions: [go],
      source: x.from || focused(),
      body: kept && !kept.locked ? fill(kept) : async () => {
        const it = await read(r);
        if (!h.isOpen()) return [];
        if (it.locked) throw new Error('locked');
        h.head(it.title || r.title || t('Announcement'), metaOf(r, it));
        return fill(it);
      },
      onClose: () => { if (showing?.h === h) showing = null; },
    });
    showing = { key: r.key, h };
    h.loaded.catch(() => { if (h.isOpen()) { h.close(true); leave(r.url); } });
    return h;
  };
  const go = (x) => { const r = refOf(x); if (r && mode(r.entry) === 'popup') return open(x); leave(r?.url || x?.url); return null; };
  const handle = (e, x) => {
    const r = refOf(x);
    if (!r || !A.plain(e) || mode(r.entry) !== 'popup') return false;
    e.preventDefault();
    open(x);
    return true;
  };

  // ---- the preview -----------------------------------------------------------------------------------------------
  // A tooltip (WCAG 1.4.13): after the delay on hover or keyboard focus, beside the link and never over it; it stays while
  // the pointer is on the link or on it, or focus is on the link; Escape puts it away until the next hover or focus.
  const TIP = `:host { all: initial; position: fixed; top: 0; left: 0; z-index: 2147483647; }
.tip { position: fixed; box-sizing: border-box; display: grid; gap: 0.2em; width: max-content; max-width: min(24em, calc(100vw - 16px)); padding: 0.6em 0.75em; overflow: hidden;
  font: 0.875em/1.45 var(--gz-font, system-ui, sans-serif); text-align: start; color: var(--gz-ink, #1d2733);
  background: var(--gz-surface-grain, none), var(--gz-surface-fill, var(--gz-surface, #fff)); border: 1px solid var(--gz-border-strong, var(--gz-line-strong, #9aa7b4));
  border-radius: var(--gz-radius-sm, 8px); box-shadow: var(--gz-shadow, 0 10px 30px rgb(0 0 0 / 0.25)); }
.tip[hidden] { display: none; }
.t { font-weight: 600; overflow-wrap: anywhere; }
.m { font-size: 0.9em; color: var(--gz-ink-muted, #5b6876); }
.x { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: var(--lines, 3); overflow: hidden; white-space: pre-line; overflow-wrap: anywhere; }
.m:empty, .x:empty { display: none; }`;
  let tip = null; // { host, box, title, meta, text }
  let on = null; // { el, r, x, desc }: the link the preview is for
  const tipIn = () => {
    if (tip?.host.isConnected) return tip;
    const host = make('div', { id: 'gz-ann-tip' });
    host.setAttribute('role', 'tooltip');
    const root = host.attachShadow({ mode: 'closed' });
    try { const s = new CSSStyleSheet(); s.replaceSync(TIP); root.adoptedStyleSheets = [s]; } catch { root.append(make('style', { textContent: TIP })); }
    const title = make('div', { className: 't', dir: 'auto' }), meta = make('div', { className: 'm', dir: 'auto' }), text = make('div', { className: 'x', dir: 'auto' });
    const box = make('div', { className: 'tip', hidden: true }, title, meta, text);
    box.addEventListener('pointerenter', () => { tip.over = true; clearTimeout(gone); });
    box.addEventListener('pointerleave', () => { tip.over = false; later(); });
    root.append(box);
    (document.body || document.documentElement).append(host);
    tip = { host, box, title, meta, text, over: false };
    return tip;
  };
  const fill = (r, x, it) => {
    const T = tipIn();
    T.title.textContent = it?.title || r.title || t('Announcement');
    T.meta.textContent = metaOf(r, it || { author: x.author, at: x.at });
    T.text.textContent = it ? GZ_POPUP_LIB.text(GZ_POPUP_LIB.tree(it.html, r.origin, GZ_NOTES)) : typeof x.text === 'string' ? x.text.slice(0, 600) : '';
    T.box.style.setProperty('--lines', String(prefs().lines));
    T.box.hidden = false;
    position();
  };
  const position = () => {
    if (!on || !tip || tip.box.hidden) return;
    const a = on.el.getBoundingClientRect();
    if (!on.el.isConnected || !GZ_POPUP_LIB.onScreen(a, innerWidth, innerHeight)) { hide(); return; }
    tip.box.style.maxHeight = '';
    const b = tip.box.getBoundingClientRect();
    const p = GZ_POPUP_LIB.place(a, b.width, b.height, innerWidth, innerHeight);
    Object.assign(tip.box.style, { left: `${p.left}px`, top: `${p.top}px`, maxHeight: `${p.maxHeight}px` });
  };
  addEventListener('scroll', position, true);
  addEventListener('resize', position);
  let wait = 0, gone = 0, gen = 0;
  const hide = () => {
    clearTimeout(wait); clearTimeout(gone);
    gen++;
    if (on) {
      const job = asking.get(on.r.key);
      if (job && !job.kept) job.ctl.abort(new Error('left'));
      if (on.desc === null) on.el.removeAttribute('aria-describedby'); else on.el.setAttribute('aria-describedby', on.desc);
    }
    on = null;
    if (tip) { tip.box.hidden = true; tip.over = false; }
  };
  const later = () => {
    clearTimeout(gone);
    if (!on || on.state.hover || on.state.focus || tip?.over) return;
    if (on.shown) gone = setTimeout(hide, 150); else hide();
  };
  const show = (el, x, state) => {
    const r = refOf(x);
    if (!r || state.dismissed || !prefs().preview || prefs()[r.entry + 'Preview'] === false || GZ_POPUP.current()) return;
    if (on?.el === el) { clearTimeout(gone); return; }
    hide();
    on = { el, r, x, state, desc: el.getAttribute('aria-describedby') };
    const g = gen;
    wait = setTimeout(() => {
      if (g !== gen) return;
      on.shown = true;
      el.setAttribute('aria-describedby', [on.desc, 'gz-ann-tip'].filter(Boolean).join(' '));
      const kept = cache.get(r.key);
      fill(r, x, kept);
      if (kept || !A.SITES[r.site].peek) return;
      read(r, { prio: 1, peek: true }).then((it) => { if (g === gen) fill(r, x, it); }, () => {});
    }, prefs().delay);
  };
  // Typing Escape anywhere puts the preview away, and only that: the key goes no further.
  addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !on) return;
    e.stopPropagation();
    e.preventDefault();
    on.state.dismissed = true;
    hide();
  }, true);
  const attached = new WeakMap();
  const preview = (el, x) => {
    if (!el || attached.has(el)) return attached.get(el) || (() => {});
    const state = { hover: false, focus: false, dismissed: false };
    const enter = (e) => { if (e.pointerType !== 'touch') { state.hover = true; show(el, x, state); } };
    const left = () => { if (!state.hover && !state.focus) state.dismissed = false; if (on?.el === el) later(); };
    const leaveEl = () => { state.hover = false; left(); };
    const focus = () => { let k = true; try { k = el.matches(':focus-visible'); } catch { /* older browser */ } if (k) { state.focus = true; show(el, x, state); } };
    const blur = () => { state.focus = false; left(); };
    const click = (e) => {
      if (on?.el !== el) return;
      if (A.plain(e) && mode(on.r.entry) === 'popup') asking.get(on.r.key)?.keep();
      hide();
    };
    const pairs = [['pointerenter', enter], ['pointerleave', leaveEl], ['focus', focus], ['blur', blur], ['click', click]];
    for (const [k, f] of pairs) el.addEventListener(k, f);
    const off = () => { for (const [k, f] of pairs) el.removeEventListener(k, f); attached.delete(el); if (on?.el === el) hide(); };
    attached.set(el, off);
    // Attached while the pointer or focus is already on it (a hook that loaded this on that hover): start now.
    try { state.hover = el.matches(':hover'); state.focus = focused() === el; } catch { /* stand-in */ }
    if (state.hover || state.focus) show(el, x, state);
    return off;
  };

  // ---- the site's own lists ---------------------------------------------------------------------------------------
  // Their links (lib/announce.js find), hooked from the window: a hover or focus loads the rest and attaches the preview; a
  // plain click opens the pop-up where this entry point's setting says so. Anything else, a click with a modifier, a link
  // whose ids can't be read, or Glaze switched off, stays the site's.
  let hooked = null; // link -> { id, off }: the announcement its preview is for, while sync()ed
  const hit = (t) => {
    const h = A && t?.closest && ctx.on?.() !== false ? A.find(ctx.site, t, location.origin, location.pathname) : null;
    if (!h) return null;
    const r = h.ref;
    r.from = h.link;
    r.course ||= ctx.nickOf?.(r.courseId) || ctx.courseList?.()?.[ctx.site === 'ultra' ? r.courseId : ctx.canvasCourseKey?.(r.courseId)]?.name || '';
    return h;
  };
  // A link the site has since given another announcement (a list redrawn in place) gets its preview anew.
  const near = (e) => {
    const h = hooked && hit(e.target);
    const was = h && hooked.get(h.link);
    if (!h || was?.id === h.ref.id) return;
    was?.off?.();
    const job = { id: h.ref.id, off: null };
    hooked.set(h.link, job);
    load().then(() => { if (hooked?.get(h.link) === job) job.off = preview(h.link, h.ref); }, () => { if (hooked?.get(h.link) === job) hooked.delete(h.link); });
  };
  const take = (e) => {
    if (!e.isTrusted || !hooked || e.detail > 0 && globalThis.getSelection?.()?.isCollapsed === false) return;
    const h = hit(e.target);
    if (!h) return;
    if (loaded) { if (handle(e, h.ref)) e.stopPropagation(); return; }
    if (!A.plain(e) || mode(h.ref.entry) !== 'popup') return;
    e.preventDefault();
    e.stopPropagation();
    load().then(() => go(h.ref), () => leave(h.ref.url));
  };
  const HOOKS = [['pointerover', near], ['focusin', near], ['click', take]];
  const sync = () => {
    if (!hooked) { hooked = new Map(); for (const [k, f] of HOOKS) addEventListener(k, f, { capture: true, passive: k !== 'click' }); }
    for (const [el, job] of hooked) if (!el.isConnected) { job.off?.(); hooked.delete(el); }
  };
  const off = () => {
    if (!hooked) return;
    for (const [k, f] of HOOKS) removeEventListener(k, f, true);
    for (const job of hooked.values()) job.off?.();
    hooked = null;
  };

  return { get ready() { return load(); }, mode, handle, go, open, preview, sync, off, close: () => showing?.h.close(), isOpen: () => !!showing?.h.isOpen() };
})();

GZ_ANNOUNCE;
