// A click on Blackboard Ultra answers within its frame (enhance.feedback, on by default). Glaze's bar's links and course tabs,
// the course-tab strip, a course's own tabs (Content, Calendar, Announcements…) and course cards look current from the press
// (data-gz-press), until the press is cancelled, the page doesn't change, or the site's own mark takes over. A page they open
// shows a skeleton in the Look's surfaces over Ultra's main area (#gz-skel), in place of Ultra's spinners, until that page's
// view is ready (its own markers, or its spinners gone and its content in), an instant copy (#gz-instant) takes over, or 20 s
// pass. A cold load shows the same from the document's first sync (#gz-boot, below). Never in the hidden standby
// (gz-ctab:standby). A page feature on Ultra's pages (content/routes.js); a second injection keeps the first. sync(), off().
var GZ_FEEDBACK = globalThis.GZ_FEEDBACK || (() => {
  const ctx = globalThis.GZ_CTX;
  if (!ctx) return null; // landed before its document's bootstrap: asked for again
  const html = document.documentElement;
  // LAST: the longest a skeleton stays. WAIT: how long a click has to change the page. GLIDE: Glaze's bar's marker moving to
  // its item (navigation/page/navbar.css). SLOP: a press that moves further is a drag.
  const LAST = 20000, WAIT = 1500, GLIDE = 500, SLOP = 8;
  const SPIN = 'div.spinner.bb-secondary-color-2';
  // Each page's view by its address (glaze-plans/perf-ultra/0b/live-shapes-2026-10-31.md): its skeleton's shape and the
  // markers that say it's in. Any other page is generic and ready once its spinners have gone with content in.
  const PAGES = [
    [/^\/ultra\/courses\/_\d+_\d+\/outline\/?$/, 'rows', '.course-outline-content-list .content-list-item'],
    [/^\/ultra\/courses\/_\d+_\d+\/announcements\/?$/, 'rows', 'tr.announcement-item-row'],
    [/^\/ultra\/courses\/_\d+_\d+\/grades\/?$/, 'rows', 'course-student-grades tbody tr'],
    [/^\/ultra\/grades\/?$/, 'tiles', 'bb-base-grades-student .base-grades-course-tile'],
    [/^\/ultra\/course\/?$/, 'tiles', 'bb-base-course-card article.course-element-card'],
    [/^\/ultra\/stream\/?$/, 'rows', '#activity-stream .stream-item'],
  ];
  const pageOf = (path) => PAGES.find(([re]) => re.test(path)) || [null, 'generic', ''];
  let listening = false;
  let p = null; // the press: { el, group, kind, id, x, y, from, clicked, timer, mo, visit }
  let v = null; // the visit a click started: its skeleton

  const wanted = () => ctx.on() && ctx.settings()?.enhance?.feedback !== false && window.name !== 'gz-ctab:standby';
  const plain = (e) => !e.button && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
  const here = () => location.pathname + location.search;
  const shown = (e) => !!e?.getClientRects().length;
  const ours = (e) => !!e.closest?.('#gz-skel, #gz-boot, #gz-instant');

  // ---- the press ----
  // What a press is on, from the innermost: a link or course tab in Glaze's bar (its open shadow root), a tab of the strip, a
  // course's own tab, a course card. A tool on one (a tab's pin or close, a card's menu, any other button) is none of them.
  const targetOf = (e) => {
    for (const n of e.composedPath?.() || []) {
      if (!n?.matches) continue;
      if (n.matches('a[href]')) {
        const target = (n.getAttribute('target') || '').toLowerCase();
        if (n.hasAttribute('download') || target && target !== '_self') return null;
      }
      const bar = n.getRootNode?.()?.host;
      if (bar?.id === 'gz-navbar') {
        if (n.matches('.ctab-go')) return { el: n, group: bar, kind: 'tab' };
        if (n.matches('a[href]')) return { el: n, group: bar, kind: 'bar' };
      } else if (n.matches('#gz-ctabs .gz-ctab')) return { el: n, group: n.closest('#gz-ctabs'), kind: 'tab' };
      else if (n.matches('.js-course-navigation a[href]')) return { el: n, group: n.closest('.js-course-navigation'), kind: 'course' };
      else if (n.matches('article.course-element-card')) return { el: n, group: null, kind: 'card' };
      if (n.tagName === 'BUTTON' || n.matches('[role="button"], input, select, textarea, .gz-ctab-x, .gz-ctab-pin')) return null;
    }
    return null;
  };
  // The site's own mark: what it shows as current.
  const own = (el) => { const c = el.getAttribute('aria-current'); return (!!c && c !== 'false') || el.getAttribute('aria-selected') === 'true' || el.matches('.active, .Mui-selected'); };
  const press = (t, id = -1, x = 0, y = 0) => {
    unpress();
    p = { ...t, id, x, y, from: here(), clicked: false, timer: 0, mo: null, visit: null };
    t.el.setAttribute('data-gz-press', '');
    t.group?.setAttribute('data-gz-pressing', '');
  };
  const unpress = () => {
    if (!p) return;
    const q = p;
    p = null;
    clearTimeout(q.timer);
    q.mo?.disconnect();
    q.el.removeAttribute('data-gz-press');
    q.group?.removeAttribute('data-gz-pressing');
  };
  // After the click: the site's own mark takes over (in Glaze's bar once its marker has glided there), the page didn't
  // change, or the page's view is ready (end()).
  const land = (q) => {
    clearTimeout(q.timer);
    if (own(q.el)) { unpress(); return; }
    q.mo = new MutationObserver(() => {
      if (p !== q || !own(q.el)) return;
      q.mo.disconnect();
      q.group?.removeAttribute('data-gz-pressing');
      clearTimeout(q.timer);
      if (q.group?.id === 'gz-navbar') q.timer = setTimeout(() => { if (p === q) unpress(); }, GLIDE);
      else unpress();
    });
    q.mo.observe(q.el, { attributes: true, attributeFilter: ['aria-current', 'aria-selected', 'class'] });
    q.timer = setTimeout(() => { if (p === q && (here() === q.from || !q.visit || v !== q.visit)) unpress(); }, WAIT);
  };

  const onDown = (e) => {
    if (e.isPrimary === false || !plain(e) || !wanted()) return;
    const t = targetOf(e);
    if (t) press(t, e.pointerId, e.clientX, e.clientY);
  };
  const onMove = (e) => {
    if (p && !p.clicked && e.pointerId === p.id && Math.hypot(e.clientX - p.x, e.clientY - p.y) > SLOP) unpress();
  };
  // Let go off the item: no click comes. On it, the click follows (on a touch screen, a moment later).
  const onUp = (e) => {
    if (!p || p.clicked || e.pointerId !== p.id) return;
    const q = p;
    if (!e.composedPath?.().includes(q.el)) { unpress(); return; }
    q.timer = setTimeout(() => { if (p === q && !q.clicked) unpress(); }, 400);
  };
  const onCancel = () => { if (p && !p.clicked) unpress(); };
  const onClick = (e) => {
    if (!wanted()) return;
    const t = targetOf(e);
    if (!t) return;
    if (!plain(e)) { if (p?.el === t.el) unpress(); return; }
    // Answered already: a second click on the item while its page comes keeps the skeleton the first started.
    if (p?.el === t.el && p.clicked && p.visit && p.visit === v) return;
    if (p?.el !== t.el) press(t); // from the keyboard
    const q = p;
    q.clicked = true;
    const dest = destOf(t);
    if (dest) q.visit = start(dest);
    land(q);
  };

  // ---- the skeleton ----
  // Where a click goes: a page of this site's Ultra, by its link's path (Ultra's <base href> is its CDN, which a resolved
  // href can name). None for a course tab, which shows its own frame, nor for the page already open.
  const destOf = (t) => {
    if (t.kind === 'tab') return '';
    const a = t.kind === 'card' ? t.el.querySelector('a[href*="/ultra/courses/"]') : t.el;
    const raw = a?.getAttribute('href') || '';
    let u, base = '';
    try { u = new URL(raw, location.href); base = new URL(document.baseURI).origin; } catch { return ''; }
    if (/#$/.test(raw) || (u.origin !== location.origin && u.origin !== base) || !/^\/ultra(?:\/|$)/.test(u.pathname)) return '';
    return u.pathname + u.search === here() ? '' : u.pathname + u.search;
  };
  // The main area on screen: a course's over the page's, else the page's.
  const front = () => [...document.querySelectorAll('main.course-main-content')].find(shown)
    || [...document.querySelectorAll('main.bb-offcanvas-container, main#main-content')].find(shown);
  // The part of it a page's view fills: a course's tool area under its own tabs, else the main area, short of the course's tabs.
  const areaOf = (m) => {
    if (!m) return null;
    const tool = m.querySelector('.course-tool-content');
    if (tool) return tool;
    const nav = m.querySelector('div.bb-course-navigation');
    let a = m;
    while (nav && a && a !== nav.parentElement) a = [...a.children].find((k) => k.contains?.(nav));
    return a || m;
  };
  // Laid over the area's content box, moved by transform (never a layout shift), from where it shows on screen (below a
  // course's sticky tabs) to the window's foot, again as the page scrolls or resizes.
  const place = (x) => {
    const box = x.box, m = x.host;
    if (!box?.isConnected || !m) return;
    const cs = getComputedStyle(m), r = m.getBoundingClientRect(), b = box.getBoundingClientRect();
    const pl = parseFloat(cs.paddingLeft) || 0, pr = parseFloat(cs.paddingRight) || 0, pt = parseFloat(cs.paddingTop) || 0;
    let top = Math.max(r.top + (m.clientTop || 0) + pt, 0);
    const nav = (m.closest('.course-content-container') || m.closest('main'))?.querySelector('div.bb-course-navigation');
    if (nav) { const n = nav.getBoundingClientRect(); if (n.bottom > top && (m.contains(nav) || n.top <= top)) top = n.bottom; }
    x.tx += r.left + (m.clientLeft || 0) + pl - b.left;
    x.ty += top - b.top;
    box.style.width = `${Math.max(0, (m.clientWidth || 0) - pl - pr)}px`;
    box.style.height = `${Math.max(0, innerHeight - top)}px`;
    box.style.transform = `translate(${Math.round(x.tx)}px, ${Math.round(x.ty)}px)`;
  };
  // Into the area on screen, Ultra's view there waiting hidden under it (extras.css).
  const seat = (x) => {
    const host = areaOf(front());
    if (!host) return false;
    if (host !== x.host) {
      x.host?.removeAttribute('data-gz-skel-host');
      x.host = host;
      host.setAttribute('data-gz-skel-host', '');
      x.ro.disconnect();
      x.ro.observe(host);
    }
    if (x.box.parentElement !== host) host.append(x.box);
    place(x);
    return true;
  };
  const draw = (shape) => {
    const box = document.createElement('div');
    box.id = 'gz-skel';
    box.setAttribute('aria-hidden', 'true');
    box.inert = true;
    box.dataset.shape = shape;
    const n = shape === 'tiles' ? 6 : shape === 'rows' ? 8 : 3;
    for (let i = 0; i <= n; i++) { const e = document.createElement('div'); if (!i) e.className = 'h'; box.append(e); }
    return box;
  };
  // A page's view is in: its own markers, new since the click; or, with no spinners and content in, once it showed spinners,
  // a moment after the address changed when it has a new view or new words, or a second after when none ever showed.
  const textOf = (m) => areaOf(m)?.textContent.length ?? -1;
  const filled = (m) => [...(areaOf(m)?.children || [])].some((k) => k.matches && shown(k) && !ours(k) && !k.matches(`${SPIN}, div.bb-course-navigation`) && !!k.textContent.trim());
  const spinnersOf = (m) => [...(m?.querySelectorAll(SPIN) || [])].filter((e) => shown(e) && !ours(e));
  const ready = (x, m) => {
    if (!m) return false;
    const mark = pageOf(location.pathname)[2];
    if (mark && [...m.querySelectorAll(mark)].some((e) => shown(e) && !x.stale.has(e) && !ours(e))) return true;
    if (spinnersOf(m).length || !filled(m)) return false;
    const since = performance.now() - x.routedAt;
    if (x.spun || since > (x.boot ? 3000 : 1000)) return true;
    if (x.boot) return false;
    const fresh = !x.old.has(m) || [...m.querySelectorAll('.route-view-container')].some((e) => !x.old.has(e)) || textOf(m) !== x.text;
    return fresh && since > 150;
  };
  const check = (x) => {
    x.frame = 0;
    if (v !== x) return;
    if (!wanted()) { end(x); return; }
    if (x.boot) { bootCheck(x); return; }
    if (copied(x)) { end(x); return; }
    if (here() !== x.at && !x.routed) {
      if (here() !== x.dest) { end(x); return; }
      x.routed = true; x.routedAt = performance.now(); x.landed = here();
    }
    // Another page opened since: not the click's to show.
    else if (x.routed && here() !== x.landed) { end(x); return; }
    // Ultra drew its tabs again: its own marks are on the new ones.
    if (p?.visit === x && !p.el.isConnected) unpress();
    const m = front();
    if (x.routed && spinnersOf(m).some((e) => !x.spinners.has(e))) x.spun = true;
    if (x.routed && ready(x, m)) { end(x); return; }
    if (!seat(x)) end(x);
  };
  // Only a new copy on the destination can take over: a pending source-page cache read may also finish after the click.
  const copied = (x) => { const c = document.getElementById('gz-instant'); return here() === x.dest && !!c && c !== x.copy; };
  const start = (dest) => {
    end();
    const [, shape, mark] = pageOf(dest.split('?')[0]);
    const m = front();
    const x = { at: here(), dest, shape, routed: false, routedAt: 0, landed: '', spun: false, copy: document.getElementById('gz-instant'),
      stale: new Set(mark ? document.querySelectorAll(mark) : []), spinners: new Set(document.querySelectorAll(SPIN)),
      old: new Set(document.querySelectorAll('main, .route-view-container')), text: textOf(m),
      box: draw(shape), host: null, tx: 0, ty: 0, frame: 0, moving: 0 };
    x.onMove = () => { if (!x.moving) x.moving = requestAnimationFrame(() => { x.moving = 0; place(x); }); };
    x.ro = new ResizeObserver(x.onMove);
    v = x;
    html.setAttribute('data-gz-skel', shape);
    if (!seat(x)) { end(x); return null; }
    addEventListener('scroll', x.onMove, { capture: true, passive: true });
    addEventListener('resize', x.onMove, { passive: true });
    x.mo = new MutationObserver(() => {
      if (v !== x) return;
      if (copied(x)) { end(x); return; }
      // Ultra's new view put in place of the area it was in: back in before the page paints without it.
      if (!x.box.isConnected) seat(x);
      if (!x.frame) x.frame = requestAnimationFrame(() => check(x));
    });
    x.mo.observe(document.body || html, { childList: true, subtree: true });
    // A route can change without touching the DOM, and the last mutation can arrive before a readiness deadline.
    // Keep a bounded check alive while loading, coalesced with mutation checks into the next frame.
    x.poll = setTimeout(function poll() {
      if (v !== x) return;
      if (!x.frame) x.frame = requestAnimationFrame(() => check(x));
      x.poll = setTimeout(poll, 100);
    }, 100);
    x.cap = setTimeout(() => end(x), LAST);
    x.wait = setTimeout(() => { if (v === x && !x.routed && here() === x.at) end(x); }, WAIT);
    return x;
  };
  // The page shown at once in the skeleton's or copy's place: Glaze's entrances on what came in under it (fading up from
  // nothing, motion.css) end where they would, so no frame shows neither.
  const settle = (root) => { for (const a of root?.getAnimations?.({ subtree: true }) || []) if (/^gz-/.test(a.animationName) && Number.isFinite(a.effect?.getComputedTiming().endTime)) a.finish(); };
  const end = (x = v) => {
    if (!x) return;
    if (v === x) { v = null; html.removeAttribute(x.boot ? 'data-gz-boot' : 'data-gz-skel'); if (x.boot) for (const root of document.querySelectorAll('#site-wrap, body > .routed-page.bb-offcanvas-container')) settle(root); }
    x.mo?.disconnect();
    x.ro?.disconnect();
    clearTimeout(x.cap);
    clearTimeout(x.wait);
    clearTimeout(x.poll);
    cancelAnimationFrame(x.frame);
    cancelAnimationFrame(x.moving);
    removeEventListener('scroll', x.onMove, { capture: true });
    removeEventListener('resize', x.onMove);
    x.box.remove();
    x.host?.removeAttribute('data-gz-skel-host');
    if (p?.visit === x) unpress();
  };
  const onHide = () => { end(); unpress(); };

  // ---- a cold load ----
  // A page Ultra is still booting when this first syncs (its boot screen, #initial-load-area, still in), in a document under
  // BOOT_AGE old: from then until the page's own view is ready, Glaze's bar over the Look with one skeleton (#gz-boot), or
  // the page's instant copy once it paints, and nothing of Ultra's: its boot screen, its first view of another page (its
  // Institution page), its spinners and half-built views wait hidden (data-gz-boot, extras.css). Then one swap: the page at
  // once, or as the copy goes with a ready view (instant.js). A click on the way ends it for its own
  // skeleton. Once a document.
  const BOOT_AGE = 15000, BOOT = '#initial-load-area';
  let booted = false;
  const boot = () => {
    booted = true;
    if (performance.now() >= BOOT_AGE || !document.querySelector(BOOT)) return;
    const at = here(), shape = pageOf(location.pathname)[1];
    const x = { boot: true, at, dest: at, shape, routed: true, routedAt: performance.now(), landed: at, spun: false, copied: false,
      stale: new Set(), spinners: new Set(), old: new Set(), text: -1, box: draw(shape), frame: 0 };
    x.box.id = 'gz-boot';
    v = x;
    html.setAttribute('data-gz-boot', '');
    (document.body || html).append(x.box);
    // The copy going is seen in its own mutation, so the page shows in the frame it goes.
    x.mo = new MutationObserver(() => {
      if (v !== x) return;
      if (html.hasAttribute('data-gz-instant')) { x.copied = true; return; }
      if (x.copied) { check(x); return; }
      if (!x.frame) x.frame = requestAnimationFrame(() => check(x));
    });
    x.mo.observe(document.body || html, { childList: true, subtree: true });
    x.mo.observe(html, { attributes: true, attributeFilter: ['data-gz-instant'] });
    // Looked at without a frame too: a frame that is hidden draws none.
    x.poll = setTimeout(function poll() { if (v !== x) return; cancelAnimationFrame(x.frame); check(x); if (v === x) x.poll = setTimeout(poll, 100); }, 100);
    x.cap = setTimeout(() => end(x), LAST);
  };
  const bootCheck = (x) => {
    // A removed copy can also mean its switch turned off or the route changed: only a ready native view ends the boot.
    if (html.hasAttribute('data-gz-instant')) { x.copied = true; return; }
    x.copied = false;
    if (here() !== x.landed) Object.assign(x, { landed: here(), routedAt: performance.now(), spun: false });
    // Full routed views (assessments, attempts and documents) can have no main, and can sit beside site-wrap.
    const m = [...document.querySelectorAll('.routed-page.bb-offcanvas-container')]
      .filter((e) => shown(e) && !ours(e) && !e.closest('.peek, .peek-panel__content-wrapper, .ms-Panel-main') && !e.querySelector('.bb-course-navigation')).pop() || front();
    // These course tools must belong to the requested course, not the base page or a course Ultra is leaving.
    const course = /^\/ultra\/courses\/(_\d+_\d+)\//.exec(location.pathname)?.[1];
    if (course && pageOf(location.pathname)[2]) {
      if (!m?.matches('main.course-main-content')) return;
      const ids = [...m.querySelectorAll('.js-course-navigation a[href]')].filter((a) => !ours(a))
        .map((a) => /\/ultra\/courses\/(_\d+_\d+)(?:\/|$)/.exec(a.getAttribute('href') || '')?.[1]).filter(Boolean);
      if (ids.length && !ids.includes(course)) return;
    }
    if (spinnersOf(m).length) x.spun = true;
    const ila = document.querySelector(BOOT);
    if (ila && !/(^|\s)fade-out(\s|$)/.test(ila.className)) return;
    if (!/^\/ultra\/institution-page\/?$/.test(location.pathname) && [...(m?.querySelectorAll('section.institution-page-container') || [])].some(shown)) return;
    if (ready(x, m)) end(x);
  };

  const EVENTS = [['pointerdown', onDown], ['pointermove', onMove], ['pointerup', onUp], ['pointercancel', onCancel], ['contextmenu', onCancel], ['click', onClick]];
  const listen = (on) => {
    if (on === listening) return;
    listening = on;
    for (const [type, fn] of EVENTS) { if (on) addEventListener(type, fn, { capture: true, passive: true }); else removeEventListener(type, fn, { capture: true }); }
    if (on) addEventListener('pagehide', onHide); else removeEventListener('pagehide', onHide);
  };
  const sync = () => { listen(wanted()); if (!listening) onHide(); else if (!booted) boot(); };
  const off = () => { listen(false); onHide(); };
  return { sync, off };
})();

GZ_FEEDBACK;
