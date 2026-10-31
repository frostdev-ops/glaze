// Instant copies (enhance.instant, on by default) on Blackboard Ultra's Grades, Courses list and Activity, in the top page:
// the student's last view (courses/instant.js) paints inert over Ultra's main area once /users/me confirms the student it
// was kept for, while Ultra's own view builds hidden beneath it, keeping its layout; the moment Ultra's view is ready (its
// markers) it shows and the copy fades out over it, or goes at once under reduced motion. Gone at once on a route change,
// with the switch off, when Ultra shows an error or nothing, or 20 s on with no ready view. Kept again (storage.local, per
// site and student, purged by background/background.js) once Ultra's view is ready and as the page goes. Classic script,
// loaded on demand (content-ultra.js syncInstant); a second injection keeps the first. sync(on, me, settled).
var GZ_INSTANT = globalThis.GZ_INSTANT || (() => {
  const ctx = globalThis.GZ_CTX;
  if (!ctx) return null; // landed before its document's bootstrap: asked for again
  const L = globalThis.GZ_INSTANT_LIB, html = document.documentElement;
  const MAIN = 'main.bb-offcanvas-container', LAST = 20000;
  let me = () => Promise.reject(new Error('no account')), settled = null, wanted = false, v = null; // v: this route's visit

  const on = () => { const s = ctx.settings(); return wanted && !!s?.enabled && !!s.enhance?.instant; };
  const main = () => document.querySelector(MAIN);
  // Ultra's <base href> is its CDN: course banners may come from there.
  const where = () => {
    let cdn = '';
    try { const u = new URL(document.baseURI); if (u.protocol === 'https:' && u.origin !== location.origin) cdn = u.origin; } catch { /* none */ }
    return { origin: location.origin, cdn, base: document.baseURI };
  };
  const read = (k) => new Promise((res) => { try { chrome.storage.local.get(k, (r) => res(chrome.runtime.lastError ? null : r?.[k] ?? null)); } catch { res(null); } });
  const drop = () => { try { chrome.runtime.sendMessage({ type: 'glaze:ultraCopy', op: 'drop' })?.catch?.(() => {}); } catch { /* reloaded */ } };
  const signedOut = (e) => e === 401 || /HTTP 401/.test(e?.message || '');

  // ---- painting ----
  // Over the main area's content box, wherever its containing block is: moved by transform (never a layout shift), again
  // as it scrolls or resizes.
  const place = (x) => {
    const box = x.copy, m = box?.parentElement;
    if (!m) return;
    const cs = getComputedStyle(m), r = m.getBoundingClientRect(), b = box.getBoundingClientRect();
    const pl = parseFloat(cs.paddingLeft) || 0, pr = parseFloat(cs.paddingRight) || 0, pt = parseFloat(cs.paddingTop) || 0;
    x.tx += r.left + (m.clientLeft || 0) + pl - b.left;
    x.ty += r.top + (m.clientTop || 0) + pt - (m.scrollTop || 0) - b.top;
    box.style.width = `${Math.max(0, (m.clientWidth || 0) - pl - pr)}px`;
    box.style.transform = `translate(${Math.round(x.tx)}px, ${Math.round(x.ty)}px)`;
  };
  const follow = (x) => { if (!x.moving) x.moving = requestAnimationFrame(() => { x.moving = 0; place(x); }); };
  const paint = (x) => {
    const m = main();
    if (!m) { x.waiting = true; return; } // Ultra's main area isn't in yet: check() paints once it is
    x.waiting = false;
    const box = document.createElement('div');
    box.id = 'gz-instant';
    box.setAttribute('aria-hidden', 'true');
    box.inert = true;
    if (!L.build(document, box, x.rec.nodes, where())) return;
    Object.assign(x, { copy: box, tx: 0, ty: 0, onMove: () => follow(x) });
    m.append(box);
    html.setAttribute('data-gz-instant', x.kind);
    place(x);
    addEventListener('scroll', x.onMove, { capture: true, passive: true });
    addEventListener('resize', x.onMove, { passive: true });
    x.ro = new ResizeObserver(x.onMove);
    x.ro.observe(m);
  };
  const unhook = (x) => {
    removeEventListener('scroll', x.onMove, { capture: true });
    removeEventListener('resize', x.onMove);
    x.ro?.disconnect();
    cancelAnimationFrame(x.moving);
    x.moving = 0;
  };
  const unpaint = (x) => {
    if (!x.copy) return;
    x.copy.remove();
    x.copy = null;
    unhook(x);
    html.removeAttribute('data-gz-instant');
  };
  // Ultra's view is ready: once it has laid out (the next frame) it shows, and the copy fades out over it.
  const swap = (x) => {
    const box = x.copy;
    if (!box) return;
    requestAnimationFrame(() => {
      if (x.copy !== box) return;
      x.copy = null;
      unhook(x);
      html.removeAttribute('data-gz-instant');
      box.setAttribute('data-out', '');
      const fades = box.getAnimations?.() || [];
      if (!fades.length) box.remove();
      else Promise.all(fades.map((a) => a.finished)).then(() => box.remove(), () => box.remove());
    });
  };

  // ---- keeping ----
  const keep = (x) => {
    if (!x.uid || !on() || v !== x || location.pathname !== x.path) return;
    const m = main();
    if (!L.ready(x.kind, m)) return;
    const c = L.capture(m, where());
    if (!c) return;
    try { chrome.storage.local.set({ [L.key(location.origin, x.uid, x.kind)]: { v: L.VERSION, uid: x.uid, kind: x.kind, at: Date.now(), full: c.full, nodes: c.nodes } }); } catch { /* reloaded */ }
  };
  const keepIdle = (x) => (globalThis.requestIdleCallback ? requestIdleCallback(() => keep(x), { timeout: 2000 }) : setTimeout(() => keep(x), 200));
  addEventListener('pagehide', () => { if (v) keep(v); });

  // ---- a visit to one of the three pages ----
  // Waits on the page: every change to it is looked at once a frame until Ultra's view is ready.
  const check = (x) => {
    x.frame = 0;
    if (v !== x) return;
    if (location.pathname !== x.path) { sync(wanted); return; }
    const m = main();
    if (L.ready(x.kind, m)) {
      x.ready = true;
      stop(x);
      swap(x);
      keepIdle(x);
      return;
    }
    if (x.copy && L.failed(m)) unpaint(x);
    else if (x.copy && !x.copy.isConnected && m) { m.append(x.copy); x.ro?.disconnect(); x.ro?.observe(m); place(x); }
    else if (x.waiting && m) paint(x);
  };
  const stop = (x) => { x.mo?.disconnect(); x.mo = null; clearTimeout(x.timer); cancelAnimationFrame(x.frame); x.frame = 0; };
  const start = (kind) => {
    const x = { kind, path: location.pathname, uid: '', rec: null, copy: null, ready: false, waiting: false, frame: 0, moving: 0 };
    v = x;
    x.mo = new MutationObserver(() => { if (!x.frame) x.frame = requestAnimationFrame(() => check(x)); });
    x.mo.observe(document.body || html, { childList: true, subtree: true });
    x.timer = setTimeout(() => { if (v !== x) return; unpaint(x); stop(x); }, LAST);
    // The last student's copy is read while the one signed in is confirmed; only that student's paints.
    const copies = new Map();
    const copyOf = (uid) => (L.ID.test(uid) ? (copies.has(uid) || copies.set(uid, read(L.key(location.origin, uid, kind))), copies.get(uid)) : Promise.resolve(null));
    ctx.need('courses/ultra.js', () => globalThis.GZ_ULTRA).then(() => GZ_ULTRA.page.known()).then((k) => k && copyOf(k.id), () => {});
    Promise.resolve().then(() => me()).then(async (uid) => {
      if (v !== x) return;
      x.uid = L.ID.test(uid) ? uid : '';
      if (x.ready) { keepIdle(x); return; }
      const [rec] = await Promise.all([copyOf(x.uid), settled]);
      if (v !== x || x.ready || x.copy || !on() || !L.usable(rec, x.uid, kind)) return;
      x.rec = rec;
      if (L.ready(kind, main())) return;
      paint(x);
    }).catch((e) => { if (signedOut(e)) drop(); });
    check(x);
  };
  const end = (x) => { stop(x); unpaint(x); if (v === x) v = null; };

  // on: the switch and Glaze on this page. me: content-ultra.js's confirmed student. settled: the stored settings are in.
  const sync = (want, who, ready) => {
    if (who) me = who;
    if (ready) settled = ready;
    wanted = !!want;
    const kind = on() && window.top === window ? L.kindOf(location.pathname) : '';
    if (v && (!kind || v.path !== location.pathname)) end(v);
    if (kind && !v) start(kind);
  };
  return { sync, now: () => (v ? { kind: v.kind, painted: !!v.copy, ready: v.ready } : null) };
})();
