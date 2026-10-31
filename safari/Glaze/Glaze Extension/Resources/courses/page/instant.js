// Instant copies (enhance.instant, on by default) on Blackboard Ultra's Grades, Courses list and Activity in the top page, and
// a course's Course Content, Announcements and Gradebook there or in that course's tab frame (navigation/page/coursetabs.js):
// the student's last view (courses/instant.js) paints inert over Ultra's main area once /users/me confirms the student it
// was kept for, while Ultra's own view builds hidden beneath it, keeping its layout; the moment Ultra's view is ready (its
// markers) it shows and the copy fades out over it, or goes at once under reduced motion. Gone at once on a route change,
// with the switch off, when Ultra shows an error or nothing, or 20 s on with no ready view. Kept again (storage.local, per
// site and student, and course, purged by background/background.js) once Ultra's view is ready and as the page goes; a course
// page's only whole. Classic script, loaded on demand (content-ultra.js syncInstant); a second injection keeps the first.
// sync(on, me, settled).
var GZ_INSTANT = globalThis.GZ_INSTANT || (() => {
  const ctx = globalThis.GZ_CTX;
  if (!ctx) return null; // landed before its document's bootstrap: asked for again
  const L = globalThis.GZ_INSTANT_LIB, html = document.documentElement;
  const LAST = 20000;
  let me = () => Promise.reject(new Error('no account')), settled = null, wanted = false, out = false, v = null; // v: this route's visit

  const on = () => { const s = ctx.settings(); return !out && wanted && !!s?.enabled && !!s.enhance?.instant; };
  // Ultra's main area: on a course's page the course's own (its section is .bb-offcanvas-container, over the base page's).
  const main = (x = v) => {
    if (!x || !L.COURSE.has(x.kind)) return document.querySelector('main.bb-offcanvas-container');
    // The address can change before Ultra replaces the last course's view: its tools' links, when it has them, are this course's.
    return [...document.querySelectorAll('main.course-main-content')].find((m) => {
      const ids = [...m.querySelectorAll('.js-course-navigation a[href]')].filter((a) => !a.closest('#gz-instant'))
        .map((a) => /\/ultra\/courses\/(_\d+_\d+)(?:\/|$)/.exec(a.getAttribute('href') || '')?.[1]).filter(Boolean);
      return !ids.length || ids.includes(x.course);
    }) || null;
  };
  // In a course tab's frame (gz-ctab:<course>, never the standby's): its course's pages, painted only while the page around
  // has it as the frame on screen, still loading (picked). It says whether it has a copy up ('copy' on), as a visit starts
  // and whenever that page shows or hides it ('visible'); with one up, its page shows under the copy until then.
  const framed = () => window.top !== window;
  let picked = false;
  const tabOf = () => /^gz-ctab:(_\d+_\d+)$/.exec(window.name)?.[1] || '';
  const here = () => {
    const kind = L.kindOf(location.pathname), course = L.courseOf(location.pathname);
    return !framed() || (course && course === tabOf()) ? kind : '';
  };
  const toTop = (has) => { if (framed()) try { window.top.postMessage({ gzCtab: 'copy', on: has }, location.origin); } catch { /* gone */ } };
  const shown = (yes) => { if (framed()) html.toggleAttribute('data-gz-instant-frame', yes); };
  // Ultra's <base href> is its CDN: course banners may come from there.
  const where = () => {
    let cdn = '';
    try { const u = new URL(document.baseURI); if (u.protocol === 'https:' && u.origin !== location.origin) cdn = u.origin; } catch { /* none */ }
    return { origin: location.origin, cdn, base: document.baseURI };
  };
  const read = (k) => new Promise((res) => { try { chrome.storage.local.get(k, (r) => res(chrome.runtime.lastError ? null : Array.isArray(k) ? r : r?.[k] ?? null)); } catch { res(null); } });
  const send = (m) => { try { return Promise.resolve(chrome.runtime.sendMessage({ type: 'glaze:ultraCopy', ...m })).catch(() => null); } catch { return Promise.resolve(null); } };
  const drop = () => { signout(); send({ op: 'drop' }); };
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
    if (v !== x || x.expired || !on() || location.pathname !== x.path || (framed() && !picked)) return;
    const m = main(x);
    if (!m) { x.waiting = true; return; } // Ultra's main area isn't in yet: check() paints once it is
    x.waiting = false;
    if (L.failed(m)) return;
    const box = document.createElement('div');
    box.id = 'gz-instant';
    box.setAttribute('aria-hidden', 'true');
    box.inert = true;
    if (!L.build(document, box, x.rec.nodes, where())) return;
    Object.assign(x, { copy: box, tx: 0, ty: 0, onMove: () => follow(x) });
    m.append(box);
    html.setAttribute('data-gz-instant', x.kind);
    shown(true);
    toTop(true);
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
    toTop(false);
  };
  // Ultra's view is ready: once it has laid out (the next frame) it shows, and the copy fades out over it.
  const swap = (x) => {
    const box = x.copy;
    if (!box) return;
    requestAnimationFrame(() => {
      if (x.copy !== box) return;
      unhook(x);
      html.removeAttribute('data-gz-instant');
      toTop(false);
      box.setAttribute('data-out', '');
      const fades = box.getAnimations?.() || [];
      const remove = () => { box.remove(); if (x.copy === box) x.copy = null; };
      if (!fades.length) remove();
      else Promise.all(fades.map((a) => a.finished)).then(remove, remove);
    });
  };

  // ---- keeping ----
  const keep = (x) => {
    if (!x.uid || !x.epoch || !on() || v !== x || location.pathname !== x.path) return;
    const m = main(x);
    if (!L.ready(x.kind, m)) return;
    const c = L.capture(m, where());
    // A course page's copy is whole or not kept: a cut-short outline would end mid-list.
    if (!c || (x.course && c.full)) return;
    send({ op: 'put', epoch: x.epoch, record: { v: L.VERSION, uid: x.uid, kind: x.kind, ...(x.course && { course: x.course }), at: x.at, full: c.full, nodes: c.nodes } });
  };
  const keepIdle = (x) => (globalThis.requestIdleCallback ? requestIdleCallback(() => keep(x), { timeout: 2000 }) : setTimeout(() => keep(x), 200));
  addEventListener('pagehide', () => { if (v) keep(v); });

  // ---- a visit to one of the three pages ----
  // Waits on the page: every change to it is looked at once a frame until Ultra's view is ready.
  const check = (x) => {
    x.frame = 0;
    if (v !== x || x.expired) return;
    if (location.pathname !== x.path) { sync(wanted); return; }
    const m = main(x);
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
    const x = { kind, course: L.courseOf(location.pathname), at: Date.now(), path: location.pathname, uid: '', rec: null, copy: null, ready: false, waiting: false, frame: 0, moving: 0 };
    v = x;
    picked = false;
    toTop(false);
    x.mo = new MutationObserver(() => { if (!x.frame) x.frame = requestAnimationFrame(() => check(x)); });
    x.mo.observe(document.body || html, { childList: true, subtree: true });
    x.timer = setTimeout(() => { if (v !== x) return; x.expired = true; unpaint(x); stop(x); }, LAST);
    const fences = ['ultraCopyFence', `ultraCopyFence:${location.origin}`];
    // Bind the request to the purge state this visit observed locally, before it can be delayed on the way to the worker.
    const lease = read(fences).then((r) => r && v === x && !x.expired && on()
      ? send({ op: 'begin', fence: fences.map((k) => r[k]?.epoch || '').join('/') }) : null).then((r) => { x.epoch = r?.epoch || ''; });
    // The last student's copy is read while the one signed in is confirmed; only that student's paints.
    const copies = new Map();
    const copyOf = (uid) => (L.ID.test(uid) ? (copies.has(uid) || copies.set(uid, read(L.key(location.origin, uid, kind, x.course))), copies.get(uid)) : Promise.resolve(null));
    ctx.need('courses/ultra.js', () => globalThis.GZ_ULTRA).then(() => GZ_ULTRA.page.known()).then((k) => k && copyOf(k.id), () => {});
    Promise.resolve().then(() => me()).then(async (uid) => {
      if (v !== x || x.expired) return;
      x.uid = L.ID.test(uid) ? uid : '';
      // Saves wait for the worker's lease; painting doesn't (a cold worker can take longer than Ultra's own first paint).
      lease.then(() => { if (x.ready) keepIdle(x); });
      if (x.ready) return;
      const [rec] = await Promise.all([copyOf(x.uid), settled]);
      if (v !== x || x.expired || x.ready || x.copy || !on() || !L.usable(rec, x.uid, kind, x.course)) return;
      x.rec = rec;
      if (L.ready(kind, main(x))) return;
      paint(x);
    }).catch((e) => { if (signedOut(e)) drop(); });
    check(x);
  };
  const end = (x) => { stop(x); unpaint(x); if (v === x) v = null; };
  const signout = () => { out = true; shown(false); if (v) end(v); };
  // From the page around a tab's frame: whether it is the frame on screen loading (picked), or shown or hidden ('visible':
  // shown, it has the frame as drawn, so a copy still up goes).
  addEventListener('message', (e) => {
    const d = e.data;
    if (!framed() || e.source !== window.top || e.origin !== location.origin || typeof d?.gzCtab !== 'string') return;
    if (d.gzCtab === 'copy' && typeof d.picked === 'boolean') {
      picked = d.picked && !!v;
      shown(picked && !!v.copy);
      if (picked && v.rec && !v.copy && !v.ready) paint(v);
    } else if (d.gzCtab === 'visible' && typeof d.on === 'boolean') {
      picked = false;
      shown(false);
      if (!v) return;
      if (d.on) swap(v);
      else toTop(!!v.copy);
    }
  });
  // A frame told it is hidden runs no page passes (content.js), so its routes in place are seen here: the standby's, as it
  // is adopted for a course (navigation/page/coursetabs.js adoptHere), above all.
  addEventListener('popstate', () => { if (framed()) sync(wanted); });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    const fences = [changes.ultraCopyFence, changes[`ultraCopyFence:${location.origin}`]].filter(Boolean);
    if (!fences.length) return;
    if (fences.some((c) => c.newValue?.retire !== false)) signout();
    else if (v) end(v);
  });

  // on: the switch and Glaze on this page. me: content-ultra.js's confirmed student. settled: the stored settings are in.
  const sync = (want, who, ready) => {
    if (who) me = who;
    if (ready) settled = ready;
    wanted = !!want;
    const kind = on() ? here() : '';
    if (!on()) shown(false);
    if (v && (!kind || v.path !== location.pathname)) end(v);
    if (kind && !v) start(kind);
  };
  return { sync, signout, now: () => (v ? { kind: v.kind, painted: !!v.copy, ready: v.ready } : null) };
})();

GZ_INSTANT;
