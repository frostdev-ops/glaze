// Glaze — content script, document_start.
// Jobs: (1) put the stylesheets on the page while the theme is on (<link>s we own, so the popup can
// toggle them without a reload), (2) push settings onto <html> — colors and look values as inline
// --gz-* vars, everything else as data-gz-* attributes — so the CSS never branches here,
// (3) the long tail: tag what no selector can reach and let the CSS restyle the tag.
(() => {
  // Only HTML pages: an /ultra/ address can also be an XML error from Ultra's CDN, or a raw script.
  if (window.__gzGlaze || !/html/.test(document.contentType)) return;
  window.__gzGlaze = true;

  const C = GZ_COLOR;
  const html = document.documentElement;
  const SHEETS = ['theme.css', 'motion.css', 'extras.css'];
  const SKIP = /^(img|video|canvas|svg|iframe|picture|source|path|use|script|style|link|meta)$/i;
  const TAGS = ['data-gz-light', 'data-gz-dark', 'data-gz-fixed-bottom', 'data-gz-vh', 'data-gz-rule', 'data-gz-score', 'data-gz-due', 'data-gz-hover', 'data-gz-pct', 'data-gz-countdown', 'data-gz-chip', 'data-gz-grade', 'data-gz-held', 'data-gz-loading', 'data-gz-reveal', 'data-gz-new'];
  const darkMQ = matchMedia('(prefers-color-scheme: dark)');
  // Gradients mixed in OKLab keep their midpoints bright instead of going grey (Chrome 111, Firefox 127).
  const OKLAB = CSS.supports('background-image', 'linear-gradient(in oklab, red, blue)') ? 'oklab' : '';
  const calmMQ = matchMedia('(prefers-reduced-motion: reduce)');
  let settings = GZ_DEFAULTS;
  let links = [];
  let observer = null;
  let timer = 0;
  let notUltra = false;
  let darkTheme = true;
  let accentInk = null; // dark text Glaze itself puts on accent fills; the sweep leaves it alone
  let enhanced = {};
  // The options page shows a mock of Ultra (preview.html) that runs this same script.
  const isPreview = /-extension:$/.test(location.protocol); // chrome-, moz-, safari-web-extension:

  const hasText = (e) => { for (const n of e.childNodes) if (n.nodeType === 3 && n.textContent.trim()) return true; return false; };
  const onBody = (fn) => (document.body ? fn() : document.addEventListener('DOMContentLoaded', fn, { once: true }));
  // `https://*/ultra/*` matches any host with that path, so confirm this is really Blackboard
  // Ultra before touching the page. Checked once, when the body exists.
  const isUltra = () => !!document.querySelector('#site-wrap, [class*="bb-"], [id*="bb-"], base[href*="ultra"]');

  // ---- long tail -------------------------------------------------------------------------------
  // Read everything first, write after: setting an attribute mid-loop invalidates layout and the
  // next getBoundingClientRect would force a reflow, once per element.
  // A full pass is O(elements) getComputedStyle calls, so only the first pass looks at everything;
  // after that we only look at the subtrees the mutation observer reports.
  // ponytail: 20k-element cap on the full pass; drop it if a real page ever needs one that big.
  const MAX_FULL = 20000;
  // Thin, wide images in course content are decorative dividers drawn for a white page; on a dark
  // theme they glow. Their size is only known once loaded.
  const isRule = (img) => img.naturalHeight > 0 && img.naturalHeight <= 40 && img.naturalWidth >= 8 * img.naturalHeight;
  const tagRule = (img) => { if (isRule(img)) img.setAttribute('data-gz-rule', ''); };
  const sweepEls = (els) => {
    const pending = [];
    for (const e of els) {
      if (e.tagName === 'IMG') {
        if (e.complete) tagRule(e);
        else e.addEventListener('load', () => tagRule(e), { once: true });
        continue;
      }
      if (!e.isConnected || SKIP.test(e.tagName) || e.id.startsWith('gz-') || e.closest('svg, [id^="gz-"]')) continue;
      const cs = getComputedStyle(e);
      const tags = [];
      // Light paper and dark text only clash with a dark theme. On a light preset Ultra's white is
      // already close to the surface, and repainting it would flatten the chips and badges on it.
      if (darkTheme) {
        const bg = C.parse(cs.backgroundColor);
        if (bg && bg.a >= 0.5 && !C.saturated(bg) && C.brightness(bg) > 0.4 && cs.backgroundImage === 'none') tags.push('data-gz-light');
        const fg = C.parse(cs.color);
        // Dark text on a coloured fill (Submit, filled chips) is meant to be dark.
        const onFill = (bg && bg.a >= 0.5 && C.saturated(bg)) || C.same(fg, accentInk);
        if (fg && fg.a >= 0.5 && !C.saturated(fg) && C.brightness(fg) < 0.35 && !onFill && hasText(e)) tags.push('data-gz-dark');
      }
      const r = e.getBoundingClientRect();
      // Fixed to the bottom of the VIEWPORT (Ultra's action bars, the help button): outside the
      // shrunk layout, so it would sit over the footer. Lift it by the footer height.
      if (cs.position === 'fixed' && r.bottom >= innerHeight - 1) tags.push('data-gz-fixed-bottom');
      // Sized with 100vh (Ultra's route containers): the shrunk wrappers can't reach it, so clamp.
      if (Math.abs(r.height - innerHeight) <= 1) tags.push('data-gz-vh');
      if (tags.length) pending.push([e, tags]);
    }
    for (const [e, tags] of pending) for (const a of tags) e.setAttribute(a, '');
  };
  const sweepAll = () => {
    const all = document.body.querySelectorAll('*');
    if (all.length <= MAX_FULL) sweepEls(all);
  };
  const sweepRoots = (roots) => {
    const els = [];
    for (const r of roots) {
      els.push(r);
      for (const d of r.querySelectorAll('*')) els.push(d);
      if (els.length > MAX_FULL) break;
    }
    sweepEls(els);
  };
  // A root inside another dirty root is already covered by that root's subtree.
  const outermost = (set) => [...set].filter((r) => {
    if (!r.isConnected) return false;
    for (let p = r.parentElement; p; p = p.parentElement) if (set.has(p)) return false;
    return true;
  });

  // ---- completion burst (Expressive) -----------------------------------------------------------
  // Ultra's review circle is role=checkbox; aria-checked turning "true" is the item being completed.
  const celebrate = (el) => {
    const r = el.getBoundingClientRect();
    if (!r.width) return;
    const b = document.createElement('div');
    b.className = 'gz-burst';
    b.style.left = `${r.left + r.width / 2}px`;
    b.style.top = `${r.top + r.height / 2}px`;
    for (let i = 0; i < 10; i++) {
      const dot = document.createElement('i');
      dot.style.setProperty('--a', `${i * 36}deg`);
      b.append(dot);
    }
    document.body.append(b);
    setTimeout(() => b.remove(), 900);
  };

  // ---- courses seen ---------------------------------------------------------------------------
  // Which course sits in which of Ultra's ten colour slots, for the options page's course list.
  // Messages and Grades title every course-coloured card. Stored locally; nothing leaves the device.
  let seenAt = 0;
  const recordCourses = () => {
    if (window.top !== window || Date.now() - seenAt < 5000) return;
    seenAt = Date.now();
    const found = {};
    for (const e of document.querySelectorAll('[class*="course-color-"]')) {
      const slot = e.className.match?.(/course-color-(\d+)/)?.[1];
      const name = e.querySelector('h2.title, h2, h3, .course-title')?.textContent.trim();
      if (slot && name && !/^ID:/.test(name)) found[slot] = name.slice(0, 80);
    }
    if (!Object.keys(found).length) return;
    try {
      chrome.storage.local.get('seenCourses', (r) => {
        const seen = { ...(r?.seenCourses || {}), ...found };
        if (JSON.stringify(seen) !== JSON.stringify(r?.seenCourses)) chrome.storage.local.set({ seenCourses: seen });
      });
    } catch { /* extension reloaded under the tab */ }
  };

  // Where Ultra writes a due date, in any language: a course item's grade line and an assignment's own
  // page (its .due-date-container). Its English details lists put the label one element up:
  // "Assessment due date" / "10/11/26, 11:59 PM".
  const DUE_AT = '.due-date-container, .content-list-item [class*="makeStylesgradeDetail-"]';
  const dueLabelled = (el) => /\bdue\b/i.test(el?.parentElement?.previousElementSibling?.textContent || '') || !!el?.closest(DUE_AT);
  // The locale Ultra renders in: <html lang> is bound to it ("{{index.locale}}" until Ultra starts).
  const locale = () => { try { return Intl.getCanonicalLocales(html.lang.replace(/_/g, '-'))[0] || navigator.language; } catch { return navigator.language; } };

  // ---- the gradebook --------------------------------------------------------------------------
  // Due-date status, new grades and the what-if calculator read the student's own gradebook records,
  // asked of their own Blackboard (same origin, their session) the way Ultra's Grades page asks: at
  // most once a minute per course, and only for courses on the page where one of those is showing.
  // Absolute URLs: Ultra's <base href> points at its CDN.
  const api = (path, base = '/learn/api/v1') => fetch(`${location.origin}${base}${path}`, { credentials: 'same-origin', headers: { accept: 'application/json' } })
    .then((r) => (r.ok ? r.json() : Promise.reject(r.status)));
  // One /users/me for everything that asks at once; asked again only if it failed.
  let meId = null;
  const me = () => (meId ||= api('/users/me').then((m) => m.id).catch((e) => { meId = null; throw e; }));
  // The student's courses, once per page: names for the command palette, and each membership's
  // due-date exception setting.
  let memberships = null;
  const myCourses = () => (memberships ||= me().then((id) => api(`/users/${id}/memberships?expand=course&limit=200`)).then((j) => j.results || []).catch(() => (memberships = null, [])));
  // Submitted late: the latest attempt against the due date, for work waiting to be graded. An
  // attempt's date never changes, so each is asked once. Nothing is called late in a course that
  // gives this student due-date exceptions, or for an item with one of its own.
  const attempts = new Map();
  const lateIn = (cid, results) => {
    const waiting = GZ_GRADES.awaiting(results);
    if (!waiting.length || !settings.enhance.inline) return Promise.resolve(new Set());
    const excepted = myCourses().then((ms) => {
      const m = ms.find((x) => x.courseId === cid);
      if (!m || m.dueDateExceptionType !== 'Normal') return () => true;
      return api(`/courses/${cid}/gradebook/memberships/${m.id}/exceptions?columnId=${waiting.map((g) => g.columnId).join(',')}`)
        .then((j) => { const text = JSON.stringify(j.results || []); return (col) => text.includes(col); }, () => () => true);
    });
    const dates = waiting.map((g) => {
      if (!attempts.has(g.lastAttemptId)) attempts.set(g.lastAttemptId, api(`/courses/${cid}/gradebook/attempts/${g.lastAttemptId}?columnId=${g.columnId}`).then((a) => a.attemptDate, () => null));
      return attempts.get(g.lastAttemptId);
    });
    return Promise.all([excepted, ...dates]).then(([exc, ...when]) => new Set(waiting.filter((g, i) => !exc(g.columnId) && GZ_GRADES.late(when[i], g.column.dueDate)).map((g) => g.columnId)));
  };

  // ---- grades on course cards (Extras) -------------------------------------------------------
  // On the Courses page each card's status line ("Open") gains the course's overall grade, drawn by CSS
  // from attributes. Grid and list views share one card; the Recent Courses strip has its own. A card's
  // book is asked for only once the card is on screen.
  const CARD_STATUS = 'article.course-element-card[data-course-id] .course-status, a[class*="courseCard"] [class*="courseStatus"]';
  const onScreen = new Set();
  const cardsIO = new IntersectionObserver((es) => {
    for (const e of es) if (e.isIntersecting) onScreen.add(e.target); else onScreen.delete(e.target);
    tagCards();
  });
  const tagCards = () => {
    if (!observer || !settings.enhance.overall || location.pathname !== '/ultra/course') return;
    for (const el of document.querySelectorAll(CARD_STATUS)) cardsIO.observe(el);
    for (const el of onScreen) {
      if (!el.isConnected) { onScreen.delete(el); cardsIO.unobserve(el); continue; }
      const cid = el.closest('[data-course-id]')?.dataset.courseId || el.closest('a')?.href.match(/\/courses\/(_\d+_\d+)\//)?.[1];
      const g = cid && bookFor(cid).overall;
      if (g) { el.setAttribute('data-gz-grade', g.label); el.setAttribute('data-gz-chip', g.tone); }
      else if (g === null) { el.removeAttribute('data-gz-grade'); el.removeAttribute('data-gz-chip'); }
    }
  };
  // cid → { at, pending, results, grades (by content item), overall, late (column ids), key }. Lateness is
  // asked only by the due-date chips (late = true), so a course card never costs attempt requests. An
  // answer that changes anything re-tags the page.
  const books = new Map();
  const bookFor = (cid, late = false) => {
    let b = books.get(cid);
    if (!b || (!b.pending && (Date.now() - b.at > 60000 || (late && !b.late)))) {
      b = { key: '', ...b, at: Date.now(), pending: true };
      books.set(cid, b);
      // ponytail: one page, Ultra's cap of 200 grades; items past that show only their countdown.
      me().then((id) => api(`/courses/${cid}/gradebook/grades?userId=${id}&limit=200&includeNoGradeItems=true&expand=column`))
        .then((j) => (late || b.late ? lateIn(cid, j.results) : Promise.resolve(undefined)).then((lateCols) => {
          b.pending = false;
          const key = JSON.stringify([j.results.map((g) => [g.columnId, g.status, g.isExempt, g.displayGrade]), [...(lateCols || [])]]);
          if (key === b.key) return;
          Object.assign(b, { results: j.results, grades: GZ_PAGE.gradesByContent(j.results), overall: GZ_PAGE.overall(j.results), late: lateCols, key });
          onBook();
        }))
        .catch(() => { b.pending = false; });
    }
    return b;
  };
  // undefined until the current course's gradebook answers.
  const gradesIn = () => { const cid = courseId(); return cid ? bookFor(cid, true).grades : undefined; };
  const onBook = () => { tagExtras([document.body]); renderNew(); renderCalc(); };

  // ---- extras that read page text (score bars, due-date urgency), only while switched on ----
  const tagExtras = (roots) => {
    tagCards();
    const { scores, urgency, inline } = settings.enhance;
    if (!scores && !urgency && !inline) return;
    const now = new Date();
    for (const root of roots) {
      if (scores || inline) {
        for (const pill of root.querySelectorAll('.readonly-pill, .wrapping-input-style.pill-style')) {
          const sc = GZ_PAGE.score(pill.querySelector('.js-pill-grade')?.textContent, pill.querySelector('.pill-points-possible')?.textContent);
          if (!sc) continue;
          // Only on change: a style write is itself a mutation the observer would hand back.
          if (scores && pill.style.getPropertyValue('--gz-score') !== String(sc.ratio)) pill.style.setProperty('--gz-score', sc.ratio);
          if (scores) pill.setAttribute('data-gz-score', sc.band);
          if (inline) pill.setAttribute('data-gz-pct', `${Math.round(sc.ratio * 100)}%`);
        }
      }
      if (urgency || inline) {
        // Due dates by where Ultra puts them; in English, also by the word ("puede" isn't one).
        const loc = locale();
        const en = /^en\b/i.test(loc);
        const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: (n) => ((en && /due/i.test(n.data)) || (/\d/.test(n.data) && dueLabelled(n.parentElement)) ? 1 : 3) });
        for (let n = walk.nextNode(); n; n = walk.nextNode()) {
          const el = n.parentElement;
          const text = /due/i.test(n.data) ? n.data : `Due: ${n.data}`;
          // A course item's circle ('false' empty, 'mixed' half, 'true' full; null without progress
          // tracking) and gradebook record say where the work stands.
          const item = el.closest('.content-list-item[data-content-id]');
          const circle = item?.querySelector('.js-review-state-icon-button')?.getAttribute('aria-checked') ?? null;
          // An assignment's own page: the due date in its details card, its id in the address.
          const pageId = !item && el.closest('.due-date-container') && location.pathname.match(/\/assessment\/(_\d+_\d+)\//)?.[1];
          // A discussion's outline item is a link with its own id; the gradebook knows the discussion's.
          const grades = (item || pageId) && gradesIn();
          const grade = !grades ? undefined : pageId ? grades.get(pageId) : grades.get(item.dataset.contentId)
            ?? grades.get(item.querySelector('a[href*="/discussion/"]')?.getAttribute('href').match(/\/discussion\/(_\d+_\d+)/)?.[1]);
          const late = !!grade && !!books.get(courseId())?.late?.has(grade.columnId);
          // The date itself from the gradebook where it has one, so it reads in any locale; otherwise
          // from the text, in Ultra's locale.
          const at = grade?.column?.dueDate && dueLabelled(el) ? new Date(grade.column.dueDate) : text;
          // Nothing is urgent once it's done. Elsewhere a past date may well be done, and the stream
          // says "Past due" itself.
          let state = urgency && GZ_PAGE.due(at, now, loc);
          if (state && (GZ_PAGE.isDone(circle, grade) || (!item && !pageId && state === 'overdue'))) state = null;
          if (state) el.setAttribute('data-gz-due', state);
          else el.removeAttribute('data-gz-due');
          // The chip is drawn by CSS from these attributes: no element is added to Ultra's tree. In course
          // content it says where the work stands; elsewhere only how long is left, never how long ago.
          let chip = null;
          if (inline && (item || pageId)) chip = GZ_PAGE.status(at, circle, grade, now, late, loc);
          else if (inline) {
            const w = GZ_PAGE.when(at, now, loc, true);
            if (w && !w.title.startsWith('Was due')) chip = { label: w.rel, tone: '' };
          }
          if (chip) {
            el.setAttribute('data-gz-countdown', chip.label);
            if (chip.tone) el.setAttribute('data-gz-chip', chip.tone);
            else el.removeAttribute('data-gz-chip');
          } else {
            el.removeAttribute('data-gz-countdown');
            el.removeAttribute('data-gz-chip');
          }
        }
      }
    }
  };

  let dirty = new Set();
  let full = false;
  const flush = () => {
    timer = 0;
    const roots = outermost(dirty);
    dirty.clear();
    if (full) { full = false; sweepAll(); tagExtras([document.body]); } else { sweepRoots(roots); tagExtras(roots); }
    if (tip && ultraTipShown()) hideTip();
    if (tintSlot() !== tinted) applySettings();
    placeScene();
    renderProgress();
    renderNew();
    renderCalc();
    watchDrafts();
    syncDownloads();
    syncDocTools();
    recordCourses();
  };
  // ---- page loads ------------------------------------------------------------------------------
  // Ultra builds a page in view: a spinner, then parts arriving and pushing each other down, with
  // Glaze's progress bar and chips landing on top. A page's container (a course tab's, not the course
  // shell around it) is held hidden while that happens and let go once it's built: still for 300 ms
  // (pages that load per course, like Grades, pause ~250 ms between parts), no spinner or skeleton
  // showing, the course's grades in, or after 2.5 s at most. It then resolves from a blur, once
  // (motion.css).
  const GATE = '.route-view-container:not(.bb-offcanvas-container)';
  const held = new Map(); // container -> { at, still }
  let gateTimer = 0;
  const loaderIn = (el) => [...el.querySelectorAll('.spinner, path[class*="makeStylesindeterminateSvg-"], .MuiSkeleton-root')]
    .some((e) => e.getClientRects().length && !e.closest('.ng-hide'));
  const release = () => {
    const now = performance.now();
    for (const [el, t] of held) {
      if (el.isConnected && now - t.at < 2500 && (now - t.still < 300 || timer || [...books.values()].some((b) => b.pending) || loaderIn(el))) continue;
      held.delete(el);
      // Cards already there arrive with the page, not one by one after it.
      for (const c of el.querySelectorAll('.content-list-item, .element-card')) c.setAttribute('data-gz-held', '');
      el.setAttribute('data-gz-reveal', '');
      el.removeAttribute('data-gz-loading');
      setTimeout(() => el.removeAttribute('data-gz-reveal'), 800);
    }
    if (!held.size) { clearInterval(gateTimer); gateTimer = 0; }
  };
  const hold = (el) => {
    if (held.has(el) || el.parentElement?.closest('[data-gz-loading]')) return;
    const now = performance.now();
    held.set(el, { at: now, still: now });
    // data-gz-held: the reveal is its entrance, so its own fade-up never starts (motion.css).
    el.setAttribute('data-gz-held', '');
    el.setAttribute('data-gz-loading', '');
    gateTimer ||= setInterval(release, 50);
  };

  // Throttle, not debounce: Ultra never stops mutating (ripples, popper repositioning), and a
  // debounce that restarts on every record would put the sweep off indefinitely.
  const schedule = (records) => {
    for (const r of records) {
      if (r.attributeName === 'aria-checked') {
        if (r.oldValue !== 'true' && r.target.getAttribute('aria-checked') === 'true'
          && html.getAttribute('data-gz-motion') === 'expressive' && r.target.matches('.js-review-state-icon-button')) celebrate(r.target);
        // A circle that changes changes its item's due-date chip.
        const item = r.target.closest('.content-list-item');
        if (item) dirty.add(item);
        continue;
      }
      if (r.type === 'attributes') { dirty.add(r.target); continue; }
      // Here, not in the throttled pass: a page must be held before it's first painted.
      for (const n of r.addedNodes) {
        if (n.nodeType !== 1) continue;
        dirty.add(n);
        if (n.matches(GATE)) hold(n);
        else if (n.firstElementChild) for (const c of n.querySelectorAll(GATE)) hold(c);
      }
      if (held.size) for (const [el, t] of held) if (el.contains(r.target)) t.still = performance.now();
    }
    // Too many separate subtrees to be worth tracking: one full pass is cheaper.
    if (dirty.size > 500) { dirty.clear(); full = true; }
    if (!timer) timer = setTimeout(flush, 150);
  };
  const startSweep = () => {
    if (observer) return;
    sweepAll();
    observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeOldValue: true, attributeFilter: ['class', 'style', 'aria-checked'] });
    tagExtras([document.body]);
    watchDrafts();
    recordCourses();
  };
  const clearTags = (names) => { for (const a of names) for (const e of document.querySelectorAll(`[${a}]`)) e.removeAttribute(a); };
  const stopSweep = () => {
    observer?.disconnect();
    observer = null;
    clearTimeout(timer);
    timer = 0;
    dirty.clear();
    full = false;
    cardsIO.disconnect();
    onScreen.clear();
    clearTags(TAGS);
  };

  // ---- hover fills ------------------------------------------------------------------------------
  // Ultra hard-codes some hover and focus fills (#fff, #f0f0f0, #e5e5e5) that exist only while
  // hovered, so the sweep never sees them. The first time the pointer reaches an element, it and
  // its nearest ancestors (all :hover too) are checked once; theme.css recolors the tagged ones.
  // Focus only puts :focus on the target, so focus checks the target alone, in its own set.
  let hoverSeen = new WeakSet();
  let focusSeen = new WeakSet();
  // A light fill on something you can click is a hover fill. On anything else it is resting paper
  // the sweep missed: Ultra's JSS rewrites rule values in place, which no mutation reports.
  const CLICKABLE = 'a, button, label, summary, tr, li, [tabindex], [role=button], [role=link], [role=row], [role=option], [role=menuitem], [role=tab], [role=treeitem]';
  const checkHover = (e) => {
    if (!darkTheme || !observer) return;
    const focus = e.type === 'focusin';
    const seen = focus ? focusSeen : hoverSeen;
    for (let el = e.target, i = 0; el instanceof HTMLElement && i < (focus ? 1 : 6); el = el.parentElement, i++) {
      if (seen.has(el)) continue;
      seen.add(el);
      const cs = getComputedStyle(el);
      const bg = C.parse(cs.backgroundColor);
      if (!bg || bg.a < 0.5 || C.saturated(bg) || C.brightness(bg) <= 0.4) continue;
      if (el.matches(CLICKABLE) || cs.cursor === 'pointer') el.setAttribute('data-gz-hover', '');
      else if (cs.backgroundImage === 'none') el.setAttribute('data-gz-light', '');
    }
  };
  document.addEventListener('pointerover', checkHover, { capture: true, passive: true });
  document.addEventListener('focusin', checkHover, true);

  // ---- pointer light (Expressive) ------------------------------------------------------------
  // Hovered cards carry a soft light under the pointer: extras.css reads --gz-mx/--gz-my off <html>.
  // One write per frame, and <html> sits outside the observed body, so the sweep never hears it.
  let raf = 0;
  let mx = 0;
  let my = 0;
  document.addEventListener('pointermove', (e) => {
    // A finger has no hover: the light would stay wherever the last touch was.
    if (e.pointerType === 'touch' || html.getAttribute('data-gz-motion') !== 'expressive') return;
    mx = e.clientX;
    my = e.clientY;
    if (!raf) raf = requestAnimationFrame(() => { raf = 0; setVar('--gz-mx', `${mx}px`); setVar('--gz-my', `${my}px`); });
  }, { passive: true });

  // ---- tooltips and hints -------------------------------------------------------------------
  // Two sources, one themed tooltip:
  // - titles: Ultra's icon buttons lean on the browser's title tooltip (unthemed, a second late).
  //   While the pointer or focus is on one, its title moves into the tooltip (and into aria-label
  //   when it was the element's only name), and goes back the moment it leaves.
  // - hints, worked out at hover time: what a date means ("Due in 2 days"), a grade as a share,
  //   the full text of anything Ultra cut off with an ellipsis.
  // Where Ultra shows a tooltip of its own, Glaze's stands down.
  const ULTRA_TIP = '.MuiTooltip-popper, .tooltip.opened, span.enhanced-tooltip, .ms-Tooltip, [role="tooltip"]:not(.gz-tip)';
  let tip = null;
  let tipFor = null;
  let tipTimer = 0;
  const hideTip = () => {
    clearTimeout(tipTimer);
    if (tipFor?.dataset.gzTitle) {
      tipFor.setAttribute('title', tipFor.dataset.gzTitle);
      delete tipFor.dataset.gzTitle;
      if (tipFor.dataset.gzAria) { tipFor.removeAttribute('aria-label'); delete tipFor.dataset.gzAria; }
    }
    tipFor = null;
    tip?.remove();
    tip = null;
  };
  const ultraTipShown = () => [...document.querySelectorAll(ULTRA_TIP)].some((t) => t.offsetWidth > 0);
  const showTip = (el, { title, sub }) => {
    if (!el.isConnected || ultraTipShown()) return;
    tip = document.createElement('div');
    tip.className = 'gz-tip';
    tip.setAttribute('role', 'tooltip');
    tip.textContent = title;
    if (sub) {
      const s2 = document.createElement('span');
      s2.className = 'gz-tip-sub';
      s2.textContent = sub;
      tip.append(s2);
    }
    document.body.append(tip);
    const r = el.getBoundingClientRect();
    const t = tip.getBoundingClientRect();
    let top = r.top - t.height - 8;
    const below = top < 4;
    if (below) top = r.bottom + 8;
    tip.style.top = `${top}px`;
    tip.style.left = `${Math.min(Math.max(4, r.left + r.width / 2 - t.width / 2), innerWidth - t.width - 4)}px`;
    tip.dataset.side = below ? 'bottom' : 'top';
  };
  const squash = (t) => t.replace(/\s+/g, ' ').trim();
  // The nearest of the target and three ancestors that has something worth saying.
  const hintFor = (target) => {
    for (let el = target, i = 0; el instanceof HTMLElement && i < 4; el = el.parentElement, i++) {
      if (el.matches('.readonly-pill, .wrapping-input-style.pill-style')) {
        const got = el.querySelector('.js-pill-grade')?.textContent;
        const max = el.querySelector('.pill-points-possible')?.textContent;
        const sc = GZ_PAGE.score(got, max);
        if (sc) return [el, { title: `${got.trim()} of ${max.trim()} points`, sub: `${Math.round(sc.ratio * 100)}%` }];
      }
      // Month-view chips are always cut short: the whole title, and when it is due.
      if (el.matches('.fc-event')) return [el, { title: squash(el.querySelector('.fc-title')?.textContent || el.textContent) }];
      const text = el.childElementCount <= 3 ? squash(el.textContent) : '';
      if (text.length && text.length < 120) {
        const loc = locale();
        const w = GZ_PAGE.when(text, new Date(), loc, dueLabelled(el) || (/^en\b/i.test(loc) && /\bdue\b/i.test(text)));
        if (w) return [el, w];
      }
      if (text && el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).textOverflow === 'ellipsis') {
        return [el, { title: text.slice(0, 300) }];
      }
    }
    return null;
  };
  const onTip = (e) => {
    if (!settings.look.tooltips || !observer || !(e.target instanceof HTMLElement)) return;
    const titled = e.target.closest('[title], [data-gz-title]');
    if (titled && titled === tipFor) return;
    const hinted = !titled && settings.look.hints ? hintFor(e.target) : null;
    if (hinted && hinted[0] === tipFor) return;
    hideTip();
    if (titled) {
      const text = titled.getAttribute('title')?.trim();
      if (!text) return;
      tipFor = titled;
      titled.dataset.gzTitle = text;
      titled.removeAttribute('title');
      if (!titled.hasAttribute('aria-label') && !titled.textContent.trim()) { titled.setAttribute('aria-label', text); titled.dataset.gzAria = '1'; }
      tipTimer = setTimeout(() => showTip(titled, { title: text }), e.type === 'focusin' ? 150 : 350);
    } else if (hinted) {
      tipFor = hinted[0];
      tipTimer = setTimeout(() => showTip(hinted[0], hinted[1]), e.type === 'focusin' ? 150 : 450);
    }
  };
  document.addEventListener('pointerover', onTip, true);
  document.addEventListener('focusin', onTip, true);
  document.addEventListener('pointerout', (e) => { if (!e.relatedTarget) hideTip(); }, true);
  document.addEventListener('focusout', (e) => { if (e.target === tipFor) hideTip(); }, true);
  for (const ev of ['pointerdown', 'scroll', 'wheel']) document.addEventListener(ev, hideTip, { capture: true, passive: true });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideTip(); }, true);

  // ---- folder previews (Extras) ----------------------------------------------------------------
  // Hovering a collapsed folder lists what is inside, with each item's state and due date, from
  // the same content API Ultra's own outline uses (same origin, the user's own session; nothing
  // leaves Blackboard). Answers are kept for a minute so moving back and forth costs nothing.
  const courseId = () => location.pathname.match(/\/ultra\/courses\/(_\d+_\d+)\//)?.[1];
  const peeks = new Map();
  const children = (cid, fid) => {
    const key = `${cid}/${fid}`;
    const hit = peeks.get(key);
    if (hit && Date.now() - hit.at < 60000) return hit.p;
    // Absolute URL: Ultra's <base href> points at its CDN, so a relative one would go there.
    const p = fetch(`${location.origin}/learn/api/v1/courses/${cid}/contents/${fid}/children`, { credentials: 'same-origin', headers: { accept: 'application/json' } })
      .then((r) => (r.ok ? r.json() : null)).then((j) => j?.results || null).catch(() => null);
    peeks.set(key, { at: Date.now(), p });
    return p;
  };
  let peek = null;
  let peekFor = null;
  let peekTimer = 0;
  const hidePeek = () => { clearTimeout(peekTimer); peek?.remove(); peek = null; peekFor = null; };
  const STATE = { Completed: 'done', Started: 'started' };
  const showPeek = (item, list) => {
    if (!list?.length || peekFor !== item || !item.isConnected) return;
    peek?.remove();
    peek = document.createElement('div');
    peek.id = 'gz-peek';
    peek.setAttribute('role', 'tooltip');
    const done = list.filter((c) => c.state === 'Completed').length;
    const head = document.createElement('div');
    head.className = 'gz-peek-head';
    head.textContent = `${list.length} item${list.length === 1 ? '' : 's'} · ${done} done`;
    const ul = document.createElement('ul');
    const now = new Date();
    for (const c of list.slice(0, 8)) {
      const li = document.createElement('li');
      li.dataset.state = STATE[c.state] || 'todo';
      const t = document.createElement('span');
      t.className = 'gz-peek-title';
      t.textContent = c.title;
      li.append(t);
      const due = c.genericReadOnlyData?.dueDate;
      if (due) {
        const d = document.createElement('span');
        d.className = 'gz-peek-due';
        d.textContent = GZ_PAGE.describe(new Date(due), true, now).rel;
        li.append(d);
      }
      ul.append(li);
    }
    peek.append(head, ul);
    if (list.length > 8) {
      const more = document.createElement('div');
      more.className = 'gz-peek-more';
      more.textContent = `and ${list.length - 8} more`;
      peek.append(more);
    }
    document.body.append(peek);
    const r = item.getBoundingClientRect();
    const w = peek.getBoundingClientRect();
    const right = r.right + 12 + w.width < innerWidth;
    peek.style.left = `${right ? r.right + 12 : Math.max(8, r.right - w.width)}px`;
    peek.style.top = `${Math.min(Math.max(8, right ? r.top : r.bottom + 8), innerHeight - w.height - 8)}px`;
  };
  document.addEventListener('pointerover', (e) => {
    if (!settings.enhance.previews || !observer || !(e.target instanceof Element)) return;
    const item = e.target.closest('.content-list-item[data-content-id]');
    if (item === peekFor) return;
    hidePeek();
    // Collapsed folders only: an open one already shows its contents.
    const isFolder = item?.querySelector('svg:is([aria-label="Learning Module"], [aria-label="Folder"])');
    const cid = courseId();
    if (!item || !isFolder || !cid || item.querySelector('[aria-expanded]')?.getAttribute('aria-expanded') !== 'false') return;
    peekFor = item;
    const fid = item.getAttribute('data-content-id');
    peekTimer = setTimeout(() => children(cid, fid).then((list) => showPeek(item, list)), 550);
  }, { capture: true, passive: true });
  for (const ev of ['pointerdown', 'scroll', 'wheel']) document.addEventListener(ev, hidePeek, { capture: true, passive: true });

  // ---- course progress (Extras) ---------------------------------------------------------------
  // One bar above the course outline adding up what the outline already says: each folder's
  // "N of M completed" plus each top-level item's review circle. Redrawn only when the numbers move.
  const renderProgress = () => {
    const old = document.getElementById('gz-progress');
    if (!settings.enhance.progress) return old?.remove();
    const top = [...document.querySelectorAll('.content-list-item[data-content-id]')].filter((e) => !e.parentElement.closest('.content-list-item'));
    let done = 0;
    let total = 0;
    for (const it of top) {
      const m = it.querySelector('.js-completion-status-message')?.textContent.match(/(\d+)\s+of\s+(\d+)\s+(completed|started)/i);
      if (m) { total += +m[2]; if (/completed/i.test(m[3])) done += +m[1]; continue; }
      const rs = it.querySelector('.js-review-state-icon-button');
      if (rs) { total += 1; if (rs.getAttribute('aria-checked') === 'true') done += 1; }
    }
    if (!total) return old?.remove();
    const key = `${done}/${total}`;
    if (old?.dataset.v === key && old.isConnected) return;
    const bar = old || document.createElement('div');
    bar.id = 'gz-progress';
    bar.dataset.v = key;
    const pct = Math.round((done / total) * 100);
    bar.style.setProperty('--gz-pct', `${pct}%`);
    bar.replaceChildren();
    const label = document.createElement('span');
    label.textContent = `Course progress: ${done} of ${total} items complete`;
    const num = document.createElement('b');
    num.textContent = `${pct}%`;
    const track = document.createElement('i');
    bar.append(label, num, track);
    if (!old) top[0].parentElement.before(bar);
  };

  // ---- new grades (Extras) --------------------------------------------------------------------
  // "New" on a course gradebook's rows graded since that gradebook was last shown here (or, the first
  // time, that Ultra says are unviewed), and a count on course cards elsewhere. Showing a gradebook marks
  // its grades seen; the badges stay until the page is left. Kept on this device (storage.local).
  let seen = null; // { cid: { columnId: mark } }
  let seenItems = null; // { cid: [content ids] }, for new content (below)
  let seenLoad = null;
  const shown = new Map(); // cid → column ids badged on this page
  const loadSeen = () => {
    seenLoad ||= new Promise((res) => {
      try { chrome.storage.local.get(['seenGrades', 'seenContent'], (r) => res(r || {})); } catch { res({}); }
    }).then((r) => { seen = r.seenGrades || {}; seenItems = r.seenContent || {}; renderNew(); });
  };
  // One course at a time, over what's stored: another tab may have recorded other courses since.
  const keepSeen = (key, cid, v) => {
    try { chrome.storage.local.get(key, (r) => chrome.storage.local.set({ [key]: { ...r?.[key], [cid]: v } })); } catch { /* extension reloaded under the tab */ }
  };
  // [card selector, its course id, where the badge goes]. Course list cards, recent courses, Grades tiles.
  const COURSE_CARDS = [
    ['article[id^="course-list-course-"]', (e) => e.id.slice(19), (e) => e.querySelector('h4[id^="course-name-"]')],
    ['bb-recent-courses-view a[href*="/ultra/courses/_"]', (e) => e.getAttribute('href').match(/courses\/(_\d+_\d+)/)?.[1], (e) => e.querySelector('[class*="courseName"]')],
    ['.base-grades-course-tile', (e) => e.querySelector('a[href*="/grades"]')?.getAttribute('href').match(/(_\d+_\d+)\/grades/)?.[1], (e) => e.querySelector('.grades-header a.bb-click-target')],
  ];
  const badge = (el, label) => {
    if (!label) el.removeAttribute('data-gz-new');
    else if (el.getAttribute('data-gz-new') !== label) el.setAttribute('data-gz-new', label);
  };
  // Counts are real link-like pills: on a card, first in the course name (where an ellipsis can't cut
  // it), opening that course's gradebook at the first new grade ('grades') or its outline at the newest
  // item ('items'); on a closed folder in the outline, after its title, unfolding it down to its newest
  // item ('inside'). A new item's own "New" ('item') is a plain label. Clicks are taken in the capture
  // phase so the card or row around a pill (itself a link or a toggle) doesn't act instead.
  const KIND = { grades: ['grade', 'open the gradebook'], items: ['item', 'open the course'], inside: ['item', 'show them'] };
  const cardBadge = (el, cid, count, kind = 'grades') => {
    let pill = el.querySelector(`:scope > .gz-new[data-kind="${kind}"]`);
    if (!count) return pill?.remove();
    if (!pill) {
      pill = Object.assign(document.createElement('span'), { className: 'gz-new' });
      pill.dataset.kind = kind;
      if (kind === 'item' || kind === 'inside') el.append(pill);
      else el.insertBefore(pill, (kind === 'items' && el.querySelector(':scope > .gz-new')?.nextSibling) || el.firstChild);
      if (KIND[kind]) { pill.tabIndex = 0; pill.setAttribute('role', 'link'); }
    }
    const label = kind === 'item' ? 'New' : `${count} new${kind === 'items' ? ` item${count === 1 ? '' : 's'}` : ''}`;
    if (pill.textContent !== label) {
      pill.textContent = label;
      if (KIND[kind]) pill.setAttribute('aria-label', `${count} new ${KIND[kind][0]}${count === 1 ? '' : 's'}: ${KIND[kind][1]}`);
    }
    pill.dataset.cid = cid;
  };
  const openNew = (e) => {
    const pill = e.target instanceof Element && e.target.closest('.gz-new[role="link"]');
    if (!pill || (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ')) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.type !== 'click' && e.type !== 'keydown') return;
    const { kind, cid } = pill.dataset;
    if (kind === 'inside') { jump = { under: pill.closest('[data-content-id]').dataset.contentId, at: Date.now(), opened: new Set() }; return renderNew(); }
    sessionStorage.setItem('gz-new-jump', `${kind} ${cid}`);
    location.assign(`${location.origin}/ultra/courses/${cid}/${kind === 'items' ? 'outline' : 'grades'}`);
  };
  const glide = (el) => el?.scrollIntoView({ block: 'center', behavior: html.getAttribute('data-gz-motion') === 'off' ? 'auto' : 'smooth' });
  for (const ev of ['click', 'keydown', 'pointerdown', 'mousedown']) document.addEventListener(ev, openNew, true);
  const renderNew = () => {
    const { newgrades, newcontent } = settings.enhance;
    if (!(newgrades || newcontent) || window.top !== window || !observer) return;
    if (!seen) return loadSeen();
    const cid = courseId();
    if (newcontent && cid) renderItems(cid);
    if (newgrades && cid && /^\/ultra\/courses\/_\d+_\d+\/grades/.test(location.pathname)) {
      const b = bookFor(cid);
      if (b.results) {
        const { ids, seen: now } = GZ_GRADES.fresh(b.results, seen[cid]);
        const set = shown.get(cid) || new Set();
        for (const id of ids) set.add(id);
        shown.set(cid, set);
        if (JSON.stringify(now) !== JSON.stringify(seen[cid])) { seen[cid] = now; keepSeen('seenGrades', cid, now); }
        for (const el of document.querySelectorAll('[id^="course-student-grades-item-name-"]')) badge(el, set.has(el.id.slice(32)) && 'New');
        // Arrived from a card's "N new": bring the first new grade into view, once.
        const first = sessionStorage.getItem('gz-new-jump') === `grades ${cid}` && document.querySelector('[id^="course-student-grades-item-name-"][data-gz-new]');
        if (first) { sessionStorage.removeItem('gz-new-jump'); glide(first.closest('li, tr, [role="row"]')); }
      }
    }
    // Cards only count: nothing is marked seen until its gradebook is shown. Only on the Courses and
    // Grades pages themselves, not under a course opened over them.
    // ponytail: the first 12 cards, one gradebook request each a minute; a long course list waits its turn.
    // New content is counted only for courses opened before (there's nothing to compare with
    // otherwise), and asked for only while the card is on screen.
    if (!/^\/ultra\/(course|grades)\/?$/.test(location.pathname)) return;
    for (const el of inView) if (!el.isConnected) { inView.delete(el); cardsInView.unobserve(el); }
    let n = 0;
    for (const [sel, idOf, where] of COURSE_CARDS) {
      for (const card of document.querySelectorAll(sel)) {
        const id = idOf(card);
        const el = where(card);
        if (!id || !el) continue;
        if (newgrades && n++ < 12) {
          const b = bookFor(id);
          cardBadge(el, id, b.results ? GZ_GRADES.fresh(b.results, seen[id]).ids.size : 0);
        }
        if (!newcontent) continue;
        cardsInView.observe(el);
        const items = seenItems[id] && (inView.has(el) ? courseItems(id) : contents.get(id))?.items;
        cardBadge(el, id, GZ_GRADES.newItems(items, seenItems[id]).ids.size, 'items');
      }
    }
  };

  // ---- new content (Extras) -------------------------------------------------------------------
  // "New" on course items added (or made visible) since the course's content was last looked at here,
  // a count on a closed folder or module holding some, and on course cards. The first visit records
  // everything; an item is seen once its row has been on the page (the badge stays for that visit), so
  // what's in a folder only once it's unfolded. Kept on this device (storage.local, seenContent).
  // ponytail: "on the page", not on screen; a long outline's last rows count as seen unscrolled.
  // The course's items come from one request, shared with the command palette and asked again after
  // five minutes at most, with only the fields used. Courses past 200 items show the first 200.
  const contents = new Map(); // cid → { at, p, items }
  const courseItems = (cid) => {
    let c = contents.get(cid);
    if (!c || Date.now() - c.at > 300000) {
      c = { at: Date.now(), items: c?.items };
      c.p = api(`/courses/${cid}/contents?recursive=true&limit=200&fields=id,parentId,title,availability.available,links,contentHandler.isBbPage`, '/learn/api/public/v1')
        .then((j) => { c.items = (j.results || []).filter((i) => i.availability?.available !== 'No'); renderNew(); return c.items; }, () => c.items || []);
      contents.set(cid, c);
    }
    return c;
  };
  const inView = new Set();
  const cardsInView = new IntersectionObserver((es) => {
    for (const e of es) if (e.isIntersecting) inView.add(e.target); else inView.delete(e.target);
    renderNew();
  });
  const shownItems = new Map(); // cid → content ids badged on this page
  let jump = null; // { under (a folder id, or null for the whole course), at, opened (folder ids) }
  const renderItems = (cid) => {
    const rows = document.querySelectorAll('.content-list-item[data-content-id]');
    const c = rows.length && courseItems(cid);
    if (!c?.items) return;
    const { ids, seen: now, inside } = GZ_GRADES.newItems(c.items, seenItems[cid], new Set([...rows].map((r) => r.dataset.contentId)));
    const set = shownItems.get(cid) || new Set();
    for (const id of ids) set.add(id);
    shownItems.set(cid, set);
    if (now !== seenItems[cid]) { seenItems[cid] = now; keepSeen('seenContent', cid, now); }
    // A row's own title comes first; an open folder's rows follow it.
    for (const r of rows) {
      const title = r.querySelector('[class*="contentItemTitle"]')?.parentElement;
      if (!title) continue;
      const id = r.dataset.contentId;
      const closed = r.querySelector('[aria-expanded]')?.getAttribute('aria-expanded') === 'false';
      cardBadge(title, cid, set.has(id) ? 1 : 0, 'item');
      cardBadge(title, cid, !set.has(id) && closed ? inside.get(id) : 0, 'inside');
    }
    // Arrived from a card's count, or a folder's count was clicked: unfold the folders down to the
    // newest new item (the highest id) and bring it into view. Folders are only unfolded, never opened,
    // and each at most once, so a slow one isn't folded back. Given up after ten seconds.
    if (sessionStorage.getItem('gz-new-jump') === `items ${cid}`) { sessionStorage.removeItem('gz-new-jump'); jump = { under: null, at: Date.now(), opened: new Set() }; }
    if (!jump) return;
    const up = new Map(c.items.map((i) => [i.id, i.parentId]));
    const chain = (id) => { const a = []; for (let p = up.get(id); up.has(p); p = up.get(p)) a.unshift(p); return a; };
    const target = [...set].filter((id) => !jump.under || chain(id).includes(jump.under)).sort((a, b) => b.split('_')[1] - a.split('_')[1])[0];
    const row = (id) => document.querySelector(`.content-list-item[data-content-id="${id}"]`);
    if (!target || Date.now() - jump.at > 10000) { jump = null; return; }
    if (row(target)) { glide(row(target)); jump = null; return; }
    for (const f of chain(target)) {
      const t = row(f)?.querySelector('[aria-expanded]');
      if (!t) return;
      if (t.getAttribute('aria-expanded') === 'false' && !jump.opened.has(f)) { jump.opened.add(f); t.click(); return; }
    }
  };

  // ---- what-if calculator (Extras) -----------------------------------------------------------
  // On a course's gradebook: scores typed for work not graded yet give the overall grade they'd make,
  // and a target gives the even share of the remaining points it needs. The recipe is the course's own
  // overall grade (lib/grades.js), and it must reproduce Blackboard's figure first; otherwise it says so.
  const whatIf = new Map(); // cid → { overrides: Map columnId → score, target }
  const asPct = (p) => (p == null ? '–' : `${Math.round(p * 100) / 100}%`);
  const make = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; };
  const renderCalc = () => {
    const old = document.getElementById('gz-calc');
    const cid = courseId();
    const host = settings.enhance.calc && observer && cid && /^\/ultra\/courses\/_\d+_\d+\/grades/.test(location.pathname) && document.querySelector('.grades-list > aside.student-grade-overview');
    if (!host) return old?.remove();
    const b = bookFor(cid);
    if (!b.results) return;
    const key = `${cid} ${b.key}`;
    if (old?.dataset.key === key && old.previousElementSibling === host) return;
    const m = GZ_GRADES.model(b.results);
    if (!whatIf.has(cid)) whatIf.set(cid, { overrides: new Map(), target: '' });
    const st = whatIf.get(cid);
    const now = make('b', { textContent: m.kind === 'unsupported' ? '' : asPct(m.percent()) });
    const box = make('details', { id: 'gz-calc', open: !!old?.open },
      make('summary', {}, make('span', { textContent: 'What-if calculator' }), now));
    box.dataset.key = key;
    box.setAttribute('aria-label', 'What-if grade calculator');
    if (m.note) box.append(make('p', { className: 'gz-calc-note', textContent: m.note }));
    if (m.kind !== 'unsupported') {
      const left = m.items.filter((i) => i.score == null && i.possible > 0);
      const out = make('p', { className: 'gz-calc-out' });
      out.setAttribute('aria-live', 'polite');
      const need = make('p', { className: 'gz-calc-out' });
      need.setAttribute('aria-live', 'polite');
      const target = make('input', { type: 'number', min: 0, max: 100, step: 'any', value: st.target, placeholder: '90' });
      target.setAttribute('aria-label', 'Target overall grade, in percent');
      const update = () => {
        const p = m.percent(st.overrides);
        out.textContent = st.overrides.size ? `With ${st.overrides.size === 1 ? 'that score' : 'those scores'}: ${asPct(p)} overall.` : left.length ? 'Type a score to see where it would leave you.' : 'Everything here is graded.';
        const t = parseFloat(st.target);
        if (!Number.isFinite(t)) { need.textContent = ''; return; }
        const r = m.need(t, st.overrides);
        need.textContent = !r.left ? `Nothing left to change: ${asPct(p)}.`
          : r.reachable === false ? `Out of reach: full marks on the ${r.left} item${r.left === 1 ? '' : 's'} left would make ${asPct(r.best)}.`
            : r.share === 0 ? `You'd stay at ${t}% or above even with zeros on what's left.`
              : `You'd need about ${Math.ceil(r.share * 1000) / 10}% on ${r.left === 1 ? 'the item' : `each of the ${r.left} items`} left.`;
      };
      const rows = left.map((i) => {
        const input = make('input', { type: 'number', min: 0, step: 'any', value: st.overrides.get(i.id) ?? '', placeholder: '–' });
        input.setAttribute('aria-label', `Score for ${i.name}, out of ${i.possible}`);
        input.addEventListener('input', () => {
          const v = parseFloat(input.value);
          if (Number.isFinite(v) && v >= 0) st.overrides.set(i.id, v); else st.overrides.delete(i.id);
          update();
        });
        return make('li', {}, make('span', { className: 'gz-calc-name', textContent: i.name }), make('span', { className: 'gz-calc-score' }, input, ` / ${i.possible}`));
      });
      target.addEventListener('input', () => { st.target = target.value; update(); });
      if (rows.length) box.append(make('h3', { textContent: 'Not graded yet' }), make('ul', {}, ...rows));
      box.append(out, make('label', { className: 'gz-calc-target' }, 'Aim for ', target, '% overall'), need);
      update();
    }
    if (old) old.replaceWith(box); else host.after(box);
  };

  // ---- draft backup (Extras) ------------------------------------------------------------------
  // What you write in Ultra's editors (Quill) is copied to storage.local a second after you stop, keyed
  // by the page and the editor. The copy goes once what you wrote shows on the page outside an editor
  // (the post went through), when you clear the editor, or after 14 days. When that editor turns up
  // empty again (a reload, a crash, a timed-out session) a bar above it offers the copy back. Restoring
  // types it in through the browser's own editing, so Quill and Ultra take it as your edit.
  const EDITOR = '.ql-editor[contenteditable="true"]';
  const BBID = /_\d+_\d+/;
  // The nearest Blackboard id above the editor (a reply's post, say), and the editor's own id.
  const draftKey = (ed) => {
    let near = '';
    for (let p = ed.parentElement, i = 0; p && !near && i < 15; p = p.parentElement, i++) {
      for (const a of p.attributes) if ((a.name === 'id' || a.name.startsWith('data-')) && BBID.test(a.value)) { near = a.value.match(BBID)[0]; break; }
    }
    return `draft:${location.pathname}#${near}/${ed.id}`;
  };
  const local = (fn) => { try { fn(chrome.storage.local); } catch { /* extension reloaded under the tab */ } };
  const typed = new Map(); // key -> { ed, text, gone }: written here, watched until it posts
  const saveTimers = new Map(); // editor -> timer
  const offered = new WeakSet();
  const bars = new Map(); // bar -> editor
  const saveDraft = (ed) => {
    saveTimers.delete(ed);
    if (!ed.isConnected || !settings.enhance.drafts) return;
    const key = draftKey(ed);
    const text = ed.textContent;
    // Too short, or cleared: drop the copy, but only one written here. A copy still on offer stays
    // until something worth keeping replaces it.
    if (!GZ_DRAFTS.worth(text)) { if (typed.delete(key)) local((s) => s.remove(key)); return; }
    typed.set(key, { ed, text, gone: 0 });
    local((s) => s.set({ [key]: { html: ed.innerHTML, text, at: Date.now() } }));
  };
  // keydown and input cover typing, undo and dictation; paste lands through Quill's own clipboard.
  const onWrite = (e) => {
    const ed = settings.enhance.drafts && observer && e.target instanceof Element && e.target.closest(EDITOR);
    if (!ed) return;
    clearTimeout(saveTimers.get(ed));
    saveTimers.set(ed, setTimeout(() => saveDraft(ed), 1000));
  };
  for (const ev of ['keydown', 'input', 'paste']) document.addEventListener(ev, onWrite, true);
  addEventListener('pagehide', () => { for (const [ed, t] of saveTimers) { clearTimeout(t); saveDraft(ed); } });
  // The page's text outside the editors being written in: where a post shows up once it's sent.
  // ponytail: walks the whole page, only while a draft's editor has just emptied or gone (a minute at most).
  const pageText = () => {
    const skip = `${EDITOR}, .ql-clipboard, .gz-draft`;
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.nodeType === 3 ? 1 : n.matches(skip) ? 2 : 3) });
    let out = '';
    for (let n = walk.nextNode(); n; n = walk.nextNode()) out += n.data;
    return out;
  };
  const restoreBar = (ed, key, d) => {
    const bar = document.createElement('div');
    bar.className = 'gz-draft';
    bar.setAttribute('role', 'status');
    const msg = document.createElement('span');
    msg.textContent = `Glaze kept a copy of what you wrote here (${GZ_PAGE.describe(new Date(d.at), true).rel}).`;
    // type=button: Ultra's editors sit in forms, where a plain button would submit.
    const button = (label, fn) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.addEventListener('click', () => { bar.remove(); fn(); });
      return b;
    };
    bar.append(msg, button('Restore', () => {
      ed.focus();
      const r = document.createRange();
      r.selectNodeContents(ed);
      getSelection().removeAllRanges();
      getSelection().addRange(r);
      document.execCommand('insertHTML', false, d.html);
    }), button('Dismiss', () => local((s) => s.remove(key))));
    (ed.closest('react-editor-wrapper') || ed.closest('.bb-editor-root') || ed).before(bar);
    bars.set(bar, ed);
  };
  const dropBars = () => { for (const bar of bars.keys()) bar.remove(); bars.clear(); };
  const offerDraft = (ed) => {
    const key = draftKey(ed);
    local((s) => s.get(key, (r) => {
      const d = r?.[key];
      if (!d?.html || !settings.enhance.drafts || !observer || !ed.isConnected || ed.textContent.trim()) return;
      if (GZ_DRAFTS.posted(d.text, pageText())) s.remove(key);
      else restoreBar(ed, key, d);
    }));
  };
  const watchDrafts = () => {
    if (!settings.enhance.drafts) return;
    const now = Date.now();
    let page = null;
    for (const [key, d] of typed) {
      // Still being written in. An editor turned read-only shows the sent post, so it counts as gone.
      if (d.ed.isConnected && d.ed.matches(EDITOR) && d.ed.textContent.trim()) { d.gone = 0; continue; }
      d.gone ||= now;
      page ??= pageText();
      if (GZ_DRAFTS.posted(d.text, page)) { typed.delete(key); local((s) => s.remove(key)); }
      else if (now - d.gone > 60000) typed.delete(key); // never posted: the copy stays
    }
    // A bar steps aside while its editor has text (Ultra's own saved draft, or you're writing), and goes with it.
    for (const [bar, ed] of bars) {
      if (!bar.isConnected || !ed.isConnected) { bar.remove(); bars.delete(bar); } else bar.hidden = !!ed.textContent.trim();
    }
    // An editor offers its copy once, after it has sat empty for a moment: Ultra may still be filling it.
    for (const ed of document.querySelectorAll(EDITOR)) {
      if (offered.has(ed)) continue;
      offered.add(ed);
      if (!ed.textContent.trim()) setTimeout(() => offerDraft(ed), 800);
    }
  };
  // Expired copies go, and with the feature off, all of them. Top frame, on load and when switched off.
  const tidyDrafts = () => {
    if (window.top !== window) return;
    local((s) => s.get(null, (all) => { const old = GZ_DRAFTS.stale(all, Date.now(), settings.enhance.drafts); if (old.length) s.remove(old); }));
  };

  // ---- download all (Extras) -------------------------------------------------------------------
  // A button on each folder and learning module in course content saves the files inside, subfolders
  // included, as one zip named after it. Listed with the content API, fetched from the site you are on
  // (Blackboard redirects the bytes to its file CDN, which allows it), zipped here, saved through a blob
  // link. Items you haven't opened are left out: downloading is never what marks them viewed.
  const MAX_ZIP = 250 * 2 ** 20; // ponytail: the whole zip is built in memory; stream to disk if folders outgrow it
  const jobs = new Map(); // folder id -> { ctl, label, pct, done }
  const paintDl = (fid) => {
    const b = document.getElementById(`gz-dl-${fid}`);
    const j = jobs.get(fid);
    if (!b) return;
    // Idle it's just an arrow, named for screen readers; working, it says how far along.
    b.textContent = j?.label || '';
    b.setAttribute('aria-label', j?.label || 'Download all');
    b.toggleAttribute('data-busy', !!j && !j.done);
    b.toggleAttribute('data-job', !!j);
    b.style.setProperty('--gz-pct', `${j?.done ? 0 : j?.pct || 0}%`);
  };
  const download = async (fid, title) => {
    const cid = courseId();
    const ctl = new AbortController();
    const job = { ctl, label: 'Finding files · Cancel', pct: 0 };
    jobs.set(fid, job);
    const say = (label, pct = 0) => { Object.assign(job, { label, pct }); paintDl(fid); };
    say(job.label);
    const list = (id) => fetch(`${location.origin}/learn/api/v1/courses/${cid}/contents/${id}/children?limit=200`, { credentials: 'same-origin', headers: { accept: 'application/json' }, signal: ctl.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.status)))).then((j) => j.results || []);
    const found = [];
    const seen = new Set();
    let skipped = 0;
    // A folder or module is a directory; an Ultra document is a folder too (isBbPage), whose blocks hold its files.
    // ponytail: first 200 children of each folder.
    const walk = async (id, dir) => {
      for (const c of await list(id)) {
        const page = c.contentDetail?.[c.contentHandler]?.isBbPage;
        if (/folder|lesson/.test(c.contentHandler) && !page) { await walk(c.id, `${dir}${GZ_ZIP.safeName(c.title)}/`); continue; }
        const fs = (page ? (await list(c.id)).flatMap((k) => GZ_PAGE.files(k, location.origin)) : GZ_PAGE.files(c, location.origin)).filter((f) => !seen.has(f.url));
        if (!fs.length) continue;
        if (c.state !== 'Started' && c.state !== 'Completed') { skipped += 1; continue; }
        for (const f of fs) { seen.add(f.url); found.push({ ...f, dir }); }
      }
    };
    const mb = (n) => `${Math.round(n / 2 ** 20)} MB`;
    try {
      await walk(fid, '');
      const known = found.reduce((n, f) => n + (f.size || 0), 0);
      if (known > MAX_ZIP) throw new Error(`Too big: ${mb(known)}, over ${mb(MAX_ZIP)}`);
      const out = [];
      const taken = new Set();
      let bytes = 0;
      let failed = 0;
      for (const [i, f] of found.entries()) {
        say(`${i + 1} of ${found.length} · Cancel`, (i / found.length) * 100);
        const r = await fetch(f.url, { credentials: 'same-origin', signal: ctl.signal }).catch((e) => { if (ctl.signal.aborted) throw e; return null; });
        if (!r?.ok) { failed += 1; continue; }
        const data = new Uint8Array(await r.arrayBuffer());
        bytes += data.length;
        if (bytes > MAX_ZIP) throw new Error(`Too big: over ${mb(MAX_ZIP)}`);
        out.push({ name: GZ_ZIP.unique(f.dir + GZ_ZIP.safeName(f.name), taken), data });
      }
      const left = skipped ? ` · ${skipped} unopened left out` : '';
      if (!out.length) return say(found.length ? `Download failed${left}` : `No files${skipped ? ' you have opened' : ''}${left}`);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob(GZ_ZIP.zip(out), { type: 'application/zip' }));
      a.download = `${GZ_ZIP.safeName(title)}.zip`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 60000);
      say(`Saved ${out.length} file${out.length === 1 ? '' : 's'}${left}${failed ? ` · ${failed} failed` : ''}`);
    } catch (e) {
      say(ctl.signal.aborted ? 'Cancelled' : /^Too big/.test(e.message) ? e.message : 'Download failed');
    } finally {
      job.done = true;
      paintDl(fid);
      setTimeout(() => { if (jobs.get(fid) === job) { jobs.delete(fid); paintDl(fid); } }, 6000);
    }
  };
  const FOLDER = /^(Folder|Learning Module)$/;
  const syncDownloads = () => {
    const on = settings.enhance.download && courseId();
    if (!on) { for (const b of document.querySelectorAll('.gz-dl')) b.remove(); return; }
    for (const item of document.querySelectorAll('.content-list-item[data-content-id]')) {
      const fid = item.dataset.contentId;
      // The item's own icon and title come first; an open folder's children follow them.
      if (!FOLDER.test(item.querySelector('svg[aria-label]')?.getAttribute('aria-label')) || document.getElementById(`gz-dl-${fid}`)) continue;
      const h3 = item.querySelector('h3');
      if (!h3) continue;
      const b = document.createElement('button');
      b.type = 'button';
      b.id = `gz-dl-${fid}`; // gz- ids are skipped by the sweep
      b.className = 'gz-dl';
      b.title = "Download all: save this folder's files as one zip. Items you haven't opened are left out, so this never marks them viewed.";
      // Inside Ultra's clickable row: keep the row from opening or folding.
      for (const ev of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'keydown', 'keyup']) b.addEventListener(ev, (e) => e.stopPropagation());
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        const j = jobs.get(fid);
        if (j && !j.done) j.ctl.abort();
        else download(fid, h3.textContent.trim());
      });
      h3.after(b);
      paintDl(fid);
    }
  };

  // ---- document buttons (Extras) ---------------------------------------------------------------
  // Round buttons in the bottom-right gutter, top frame only: dark documents while a file preview is
  // on screen (dark palettes only), focus mode on a course document. Dark documents invert the
  // preview's frame (extras.css), which works whatever its origin; where a frame is same-origin, its
  // images and videos are turned back.
  const PREVIEWS = '#site-wrap :is(.js-file-viewer-inline-preview, [class*="fileViewerContainer"]) iframe';
  const UNFLIP = 'img, video, picture, canvas { filter: invert(1) hue-rotate(180deg); }';
  const framesShown = new Set();
  const framesSeen = new WeakSet();
  let docTools = null;
  let focusAt = null; // the document focus mode is on for
  let readBar = null;
  const unflip = (f) => {
    try {
      const d = f.contentDocument;
      const old = d?.getElementById('gz-unflip');
      const on = html.matches('[data-gz-dark-theme][data-gz-enhance-darkDocs]'); // as extras.css
      if (!d?.documentElement || on === !!old) return;
      if (old) return old.remove();
      const s = d.createElement('style');
      s.id = 'gz-unflip';
      s.textContent = UNFLIP;
      d.documentElement.append(s);
    } catch { /* another origin */ }
  };
  const ICONS = { dark: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z', focus: 'M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5' };
  const docButton = (key, label, onClick) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.gz = key;
    b.title = label;
    b.setAttribute('aria-label', label);
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    const p = document.createElementNS(svg.namespaceURI, 'path');
    p.setAttribute('d', ICONS[key]);
    svg.append(p);
    b.append(svg);
    b.addEventListener('click', onClick);
    return b;
  };
  const onRead = () => {
    if (!readBar) return;
    const sc = focusAt.parentElement; // Ultra's scroller around the document
    // On <html>, outside the observed body: a style write on the bar would wake the sweep every scroll.
    setVar('--gz-read', GZ_PAGE.readShare(sc.scrollTop, sc.scrollHeight, sc.clientHeight));
  };
  const setFocus = (on) => {
    const doc = on && document.querySelector('#site-wrap .document-content-root');
    if ((doc || null) === focusAt) return;
    focusAt = doc || null;
    html.toggleAttribute('data-gz-focus', !!focusAt);
    readBar?.remove();
    readBar = null;
    if (focusAt) {
      readBar = document.createElement('div');
      readBar.id = 'gz-read';
      readBar.setAttribute('aria-hidden', 'true');
      document.body.append(readBar);
      onRead();
    }
    syncDocTools();
  };
  const setDark = (on) => {
    settings = { ...settings, enhance: { ...settings.enhance, darkDocs: on } };
    setAttr('data-gz-enhance-darkDocs', on);
    syncDocTools();
    try { chrome.storage.sync.set({ enhance: settings.enhance }); } catch { /* extension reloaded under the tab */ }
  };
  const syncDocTools = () => {
    const on = window.top === window && observer && settings.enhance.toggles;
    const doc = on && document.querySelector('#site-wrap .document-content-root');
    if (focusAt && focusAt !== doc) setFocus(false);
    for (const f of document.querySelectorAll(PREVIEWS)) {
      if (!framesSeen.has(f)) { framesSeen.add(f); frameIO.observe(f); f.addEventListener('load', () => unflip(f)); }
      unflip(f);
    }
    for (const f of framesShown) if (!f.isConnected) { framesShown.delete(f); frameIO.unobserve(f); }
    const dark = on && darkTheme && framesShown.size > 0;
    if (!doc && !dark) {
      docTools?.remove();
      docTools = null;
      html.removeAttribute('data-gz-doc-tools');
      return;
    }
    if (!docTools) {
      docTools = document.createElement('div');
      docTools.id = 'gz-doc-tools';
      docTools.setAttribute('role', 'toolbar');
      docTools.setAttribute('aria-label', 'Document');
      const time = document.createElement('span');
      time.className = 'gz-doc-time';
      docTools.append(time, docButton('dark', 'Dark documents', () => setDark(!settings.enhance.darkDocs)), docButton('focus', 'Focus mode', () => setFocus(!focusAt)));
      document.body.append(docTools);
    }
    const [time, darkB, focusB] = docTools.children;
    const mins = focusAt && GZ_PAGE.readMinutes(focusAt.querySelector('.bbml-editor')?.textContent);
    time.hidden = !mins;
    // Only on change: a text write is itself a mutation the observer would hand back.
    if (mins && time.textContent !== `${mins} min read`) time.textContent = `${mins} min read`;
    darkB.hidden = !dark;
    darkB.setAttribute('aria-pressed', String(settings.enhance.darkDocs));
    focusB.hidden = !doc;
    focusB.setAttribute('aria-pressed', String(!!focusAt));
    html.setAttribute('data-gz-doc-tools', '');
  };
  const frameIO = new IntersectionObserver((es) => {
    for (const e of es) if (e.isIntersecting) framesShown.add(e.target); else framesShown.delete(e.target);
    syncDocTools();
  });
  document.addEventListener('scroll', onRead, { capture: true, passive: true });
  // Esc leaves focus mode, and Ultra doesn't also act on it. An open menu or dialog gets its Esc as
  // usual. Focus inside a preview's frame keeps the key there; the button still works.
  addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !focusAt || (e.target instanceof Element && e.target.closest('[role="menu"], [role="dialog"], [role="listbox"]'))) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    setFocus(false);
  }, true);

  // ---- keyboard shortcuts (Extras) ------------------------------------------------------------
  // "g" then a letter goes somewhere, "/" searches, "?" lists them. Never while typing, never with
  // a modifier, top frame only.
  const GO = { c: ['/ultra/course', 'Courses'], a: ['/ultra/calendar', 'Calendar'], g: ['/ultra/grades', 'Grades'], m: ['/ultra/messages', 'Messages'], s: ['/ultra/stream', 'Activity stream'] };
  let gAt = 0;
  let keysBox = null;
  const closeKeys = () => { keysBox?.remove(); keysBox = null; };
  const openKeys = () => {
    keysBox = document.createElement('div');
    keysBox.id = 'gz-keys';
    keysBox.setAttribute('role', 'dialog');
    keysBox.setAttribute('aria-label', 'Keyboard shortcuts');
    const h = document.createElement('h2');
    h.textContent = 'Keyboard shortcuts';
    const dl = document.createElement('dl');
    const row = (keys, what) => {
      const dt = document.createElement('dt');
      for (const k of keys) { const kbd = document.createElement('kbd'); kbd.textContent = k; dt.append(kbd); }
      const dd = document.createElement('dd');
      dd.textContent = what;
      dl.append(dt, dd);
    };
    for (const [k, [, label]] of Object.entries(GO)) row(['g', k], label);
    row(['/'], 'Search');
    if (settings.enhance.palette) row([/Mac/.test(navigator.platform) ? '⌘' : 'Ctrl', 'K'], 'Go to anything');
    row(['?'], 'Show or hide this list');
    const panel = document.createElement('div');
    panel.className = 'gz-keys-panel';
    panel.append(h, dl);
    keysBox.append(panel);
    keysBox.addEventListener('click', (e) => { if (e.target === keysBox) closeKeys(); });
    document.body.append(keysBox);
  };
  const typing = (el) => el instanceof Element && (el.isContentEditable || !!el.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])'));
  if (window.top === window) {
    document.addEventListener('keydown', (e) => {
      if (!settings.enhance.keys || !observer || e.metaKey || e.ctrlKey || e.altKey || typing(e.target)) return;
      if (e.key === 'Escape' && keysBox) { closeKeys(); return; }
      if (Date.now() - gAt < 1200 && GO[e.key]) {
        e.preventDefault();
        gAt = 0;
        location.assign(location.origin + GO[e.key][0]);
        return;
      }
      gAt = e.key === 'g' ? Date.now() : 0;
      if (e.key === '/') {
        const target = [...document.querySelectorAll('input[type="search"], input[placeholder*="earch" i], button[aria-label*="earch" i]')].find((el) => el.offsetWidth > 0);
        if (!target) return;
        e.preventDefault();
        if (target.tagName === 'BUTTON') target.click();
        else target.focus();
      } else if (e.key === '?') {
        e.preventDefault();
        if (keysBox) closeKeys();
        else openKeys();
      }
    }, true);
  }

  // ---- command palette (Extras) --------------------------------------------------------------
  // Ctrl+K (⌘K on a Mac) opens one search over Blackboard's pages, your courses, this course's tabs
  // and items, and Glaze's own switches. Never while typing (Ultra's editor uses Ctrl+K for links),
  // top frame only. Courses and items are asked of Ultra's own APIs once per page, when it first opens.
  const TOOLS = [['/ultra/course', 'Courses'], ['/ultra/calendar', 'Calendar'], ['/ultra/grades', 'Grades'], ['/ultra/messages', 'Messages'],
    ['/ultra/stream', 'Activity stream'], ['/ultra/organizations', 'Organizations'], ['/ultra/profile', 'Profile'], ['/ultra/tools', 'Tools']];
  const EXTRAS = { urgency: 'Due-date urgency', clamp: 'Shorter descriptions', scores: 'Score bars', reading: 'Reading width', inline: 'Due-date status and percentages',
    previews: 'Folder previews', progress: 'Course progress', keys: 'Keyboard shortcuts', newgrades: 'New-grade badges', newcontent: 'New-content badges', calc: 'What-if calculator' };
  const go = (path) => () => location.assign(location.origin + path);
  const store = (patch) => () => { try { chrome.storage.sync.set({ version: 2, ...patch }); } catch { /* extension reloaded under the tab */ } };
  const paletteItems = (cid) => courseItems(cid).p.then((all) => {
    const title = new Map(all.map((c) => [c.id, c.title]));
    return all.filter((c) => c.links?.[0]?.href).map((c) => ({ label: c.title, hint: title.get(c.parentId) || '', group: 'In this course', run: go(c.links[0].href.replace(/^https?:\/\/[^/]+/, '')) }));
  });
  // Everything the palette can do, built when it opens.
  const commands = async () => {
    const cid = courseId();
    // A tab's name without its count badge ("Announcements 12").
    const tabName = (a) => { const c = a.cloneNode(true); for (const b of c.querySelectorAll('[class*="badge" i]')) b.remove(); return c.textContent.trim(); };
    const here = cid ? [...document.querySelectorAll('.bb-ui-navigation-list-horizontal a[href]')].map((a) => ({ label: tabName(a), hint: 'This course', group: 'Go to', run: () => a.click() })).filter((c) => c.label) : [];
    const [courses, items] = await Promise.all([myCourses(), cid ? paletteItems(cid) : []]);
    const s = settings;
    return [
      ...here,
      ...TOOLS.map(([path, label]) => ({ label, hint: 'Blackboard', group: 'Go to', run: go(path) })),
      ...courses.filter((m) => m.course).sort((a, b) => !!a.course.isClosed - !!b.course.isClosed)
        .map((m) => ({ label: m.course.name, hint: m.course.isOrganization ? 'Organization' : m.course.isClosed ? 'Closed course' : m.course.courseId || 'Course', group: 'Courses', run: go(`/ultra/courses/${m.courseId}/outline`) })),
      ...items,
      ...GZ_ALL_PRESETS(s.presets).map(([name, colors]) => ({ label: `Palette: ${name}`, hint: s.preset === name && !s.auto.on ? 'Current' : 'Glaze', group: 'Glaze', run: store({ colors, preset: name, auto: { ...s.auto, on: false } }) })),
      ...['off', 'subtle', 'expressive'].map((level) => ({ label: `Motion: ${level[0].toUpperCase()}${level.slice(1)}`, hint: s.motion.level === level ? 'Current' : 'Glaze', group: 'Glaze', run: store({ motion: { ...s.motion, level } }) })),
      ...Object.entries(EXTRAS).map(([k, label]) => ({ label: `${s.enhance[k] ? 'Turn off' : 'Turn on'} ${label.toLowerCase()}`, hint: 'Glaze extra', group: 'Glaze', run: store({ enhance: { ...s.enhance, [k]: !s.enhance[k] } }) })),
      { label: 'Turn the theme off', hint: 'Glaze', group: 'Glaze', run: store({ enabled: false }) },
    ];
  };
  let cmd = null; // { box, input, list, all, shown, active, back }
  const closeCmd = () => {
    if (!cmd) return;
    cmd.box.remove();
    if (cmd.back?.isConnected) cmd.back.focus({ preventScroll: true });
    cmd = null;
  };
  const showCmd = () => {
    const q = cmd.input.value;
    // Empty: every page and course, then this course's first items, then Glaze. Typed: the best 40.
    cmd.shown = q.trim()
      ? cmd.all.map((c) => [c, Math.max(GZ_PAGE.fuzzy(q, c.label), GZ_PAGE.fuzzy(q, `${c.hint} ${c.label}`) - 2)]).filter(([, s]) => s >= 0).sort((a, b) => b[1] - a[1]).slice(0, 40).map(([c]) => c)
      : [...cmd.all.filter((c) => c.group !== 'In this course' && c.group !== 'Glaze'), ...cmd.all.filter((c) => c.group === 'In this course').slice(0, 8)];
    cmd.active = 0;
    cmd.list.replaceChildren(...cmd.shown.map((c, i) => {
      const li = document.createElement('li');
      li.id = `gz-cmd-${i}`;
      li.setAttribute('role', 'option');
      const label = document.createElement('span');
      label.textContent = c.label;
      const hint = document.createElement('small');
      hint.textContent = c.hint && c.hint !== c.group ? `${c.group} · ${c.hint}` : c.group;
      li.append(label, hint);
      li.addEventListener('pointermove', () => { if (cmd.active !== i) { cmd.active = i; mark(); } });
      li.addEventListener('click', () => runCmd(i));
      return li;
    }));
    if (!cmd.shown.length) cmd.list.append(Object.assign(document.createElement('li'), { className: 'gz-cmd-empty', textContent: cmd.loading ? 'Loading…' : 'Nothing matches.' }));
    mark();
  };
  const mark = () => {
    for (const li of cmd.list.children) li.setAttribute('aria-selected', String(li.id === `gz-cmd-${cmd.active}`));
    const on = cmd.list.querySelector('[aria-selected="true"]');
    if (on) { cmd.input.setAttribute('aria-activedescendant', on.id); on.scrollIntoView({ block: 'nearest' }); } else cmd.input.removeAttribute('aria-activedescendant');
  };
  const runCmd = (i) => {
    const c = cmd?.shown[i];
    if (!c) return;
    closeCmd();
    c.run();
  };
  const openCmd = () => {
    const box = document.createElement('div');
    box.id = 'gz-cmd';
    const panel = document.createElement('div');
    panel.className = 'gz-cmd-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-label', 'Go to');
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Go to a course, an item, a page or a Glaze setting…';
    input.autocomplete = 'off';
    input.spellcheck = false;
    for (const [k, v] of [['role', 'combobox'], ['aria-expanded', 'true'], ['aria-controls', 'gz-cmd-list'], ['aria-autocomplete', 'list'], ['aria-label', 'Go to']]) input.setAttribute(k, v);
    const list = document.createElement('ul');
    list.id = 'gz-cmd-list';
    list.setAttribute('role', 'listbox');
    list.setAttribute('aria-label', 'Results');
    const foot = document.createElement('p');
    foot.className = 'gz-cmd-foot';
    foot.textContent = '↑ ↓ to choose · Enter to go · Esc to close';
    panel.append(input, list, foot);
    box.append(panel);
    box.addEventListener('pointerdown', (e) => {
      if (e.target === box) closeCmd();
      else if (e.target !== input) e.preventDefault(); // focus stays in the search box
    });
    input.addEventListener('input', showCmd);
    input.addEventListener('keydown', (e) => {
      const n = cmd.shown.length;
      const step = { ArrowDown: 1, ArrowUp: -1, Tab: e.shiftKey ? -1 : 1 }[e.key];
      if (step && n) { e.preventDefault(); cmd.active = (cmd.active + step + n) % n; mark(); } else if (e.key === 'Tab') e.preventDefault();
      else if (e.key === 'Home' || e.key === 'End') { if (n) { e.preventDefault(); cmd.active = e.key === 'Home' ? 0 : n - 1; mark(); } } else if (e.key === 'Enter') { e.preventDefault(); runCmd(cmd.active); } else if (e.key === 'Escape') { e.preventDefault(); closeCmd(); }
      // Ultra's own shortcuts never see keys meant for the palette.
      e.stopPropagation();
    });
    cmd = { box, input, list, all: [], shown: [], active: 0, back: document.activeElement, loading: true };
    document.body.append(box);
    input.focus();
    // Pages show at once; courses and items join when Ultra answers.
    const mine = cmd;
    cmd.all = TOOLS.map(([path, label]) => ({ label, hint: 'Blackboard', group: 'Go to', run: go(path) }));
    showCmd();
    commands().then((all) => { if (cmd !== mine) return; cmd.all = all; cmd.loading = false; showCmd(); });
  };
  if (window.top === window) {
    document.addEventListener('keydown', (e) => {
      if (e.key?.toLowerCase() !== 'k' || !(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey || !settings.enhance.palette || !observer) return;
      if (cmd) { e.preventDefault(); closeCmd(); return; }
      if (typing(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
      openCmd();
    }, true);
  }

  // ---- page changes ---------------------------------------------------------------------------
  // Ultra swaps pages in place, painting its half-built states on the way (and one long script can
  // stall it for half a second). A click on the main menu or a course's tabs instead holds the old
  // page in a view transition until the next one exists, then crossfades into it: when the address has
  // changed and the new page is being held while it loads (see page loads), or has been still for
  // 120 ms, or after 500 ms at most. Top frame only, and only while entrances are on.
  if (window.top === window && document.startViewTransition) {
    const PAGE_LINKS = '#base_tools a, .bb-ui-navigation-list-horizontal a';
    const settled = (from) => new Promise((done) => {
      const t0 = performance.now();
      let still = t0;
      const mo = new MutationObserver(() => { still = performance.now(); });
      mo.observe(document.body, { childList: true, subtree: true });
      const check = () => {
        const now = performance.now();
        if ((location.href !== from && (held.size || now - still > 120)) || now - t0 > 500) { mo.disconnect(); done(); } else setTimeout(check, 25);
      };
      setTimeout(check, 25);
    });
    let replaying = false;
    document.addEventListener('click', (e) => {
      if (replaying || !observer || e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      if (html.getAttribute('data-gz-motion') === 'off' || html.hasAttribute('data-gz-no-enter')) return;
      const link = e.target instanceof Element && e.target.closest(PAGE_LINKS);
      if (!link || link.matches('[aria-current="page"], .active')) return;
      // Ultra gets the click inside the transition, once the old page has been captured.
      e.preventDefault();
      e.stopImmediatePropagation();
      const from = location.href;
      document.startViewTransition(async () => {
        replaying = true;
        link.click();
        replaying = false;
        await settled(from);
        // The crossfade is the entrance: the new page's own fade-up would be a second movement. Marked
        // on the element rather than switched on <html>, so it can't restart when the mark goes.
        for (const el of document.querySelectorAll('.route-view-container, .panel-wrap')) el.setAttribute('data-gz-held', '');
      });
    }, true);
  }

  // ---- footer ---------------------------------------------------------------------------------
  // A full-width bar, top frame only. theme.css shrinks the app by --gz-footer-h so the bar sits
  // below everything rather than over it.
  const syncFooter = () => {
    const want = links.length && settings.footer && window.top === window && document.body;
    const have = document.getElementById('gz-footer');
    if (want && !have) {
      const f = document.createElement('footer');
      f.id = 'gz-footer';
      const a = document.createElement('a');
      a.href = 'https://github.com/frostdev-ops/glaze';
      a.target = '_blank';
      a.rel = 'noopener';
      a.textContent = 'Glaze';
      f.appendChild(a);
      document.body.appendChild(f);
    } else if (!want && have) have.remove();
  };

  // ---- animated background (bg.kind "scene") ----------------------------------------------------
  // lib/scene.js and three.js (~520 KB) load only once a scene is picked, and only in the top frame
  // or the editor's preview: one WebGL canvas per tab. The canvas lives in the topmost full-screen
  // layer (see extras.css); flush() moves it when a course or item panel opens or closes.
  const LAYERS = ':is(.panel-wrap, .bb-offcanvas-panel):not(.peek, :is(.peek, .peek-panel__content-wrapper, .ms-Panel-main) *)';
  const sceneFrame = window === top || location.protocol !== 'https:';
  let scene = null; // { update, draw, stop } from lib/scene.js
  let sceneCanvas = null;
  let sceneLoad = null;
  let sceneFailed = false; // no WebGL, or the module was blocked: the gradient under it stays
  // ponytail: the last visible layer in document order is taken as the top one, which holds while
  // Ultra stacks panels in DOM order. Compare z-index if a panel ever opens under the canvas.
  const placeScene = () => {
    if (!sceneCanvas) return;
    const home = [...document.querySelectorAll(LAYERS)].filter((e) => e.getClientRects().length).pop() || document.body;
    if (sceneCanvas.parentNode === home) return;
    home.append(sceneCanvas);
    scene?.draw();
  };
  const stopScene = () => {
    scene?.stop();
    scene = null;
    sceneCanvas?.remove();
    sceneCanvas = null;
  };
  const sceneOpts = () => {
    const { dim, amount, pace } = GZ_SCENE_LOOK(settings.bg.intensity);
    return {
      name: settings.bg.scene,
      ground: palette['--gz-surface-2'],
      colors: GZ_BG_COLORS(settings.bg.colors, palette),
      dim,
      amount,
      speed: pace * ({ off: 0, expressive: 1.6 }[html.getAttribute('data-gz-motion')] ?? 1),
    };
  };
  const syncScene = () => {
    if (!settings.enabled || !links.length || settings.bg.kind !== 'scene' || !sceneFrame || sceneFailed || !document.body) return stopScene();
    if (scene) return scene.update(sceneOpts());
    sceneLoad ||= import(chrome.runtime.getURL('lib/scene.js'));
    sceneLoad.then((mod) => {
      if (scene || !links.length || settings.bg.kind !== 'scene') return;
      sceneCanvas = document.createElement('canvas');
      sceneCanvas.id = 'gz-scene';
      sceneCanvas.setAttribute('aria-hidden', 'true');
      placeScene();
      scene = mod.start(sceneCanvas);
      scene.update(sceneOpts());
    }).catch(() => { sceneFailed = true; stopScene(); });
  };

  // ---- course tint ----------------------------------------------------------------------------
  // Inside a course picked in the editor, the palette leans toward the course's color (GZ_TINT).
  // A course's own pages carry its color slot on the course section; its item pages carry nothing,
  // so the slot is remembered per course id, on this device. flush() re-checks on every page change.
  const COURSE = 'section.course[class*="course-color-"]';
  const courseSlots = {};
  try {
    chrome.storage.local.get('courseSlots', (r) => {
      Object.assign(courseSlots, r?.courseSlots);
      if (tintSlot() !== tinted) reapply();
    });
  } catch { /* extension reloaded under the tab */ }
  const tintSlot = () => {
    const cid = courseId();
    const sec = document.querySelector(COURSE);
    const slot = sec?.className.match(/course-color-(\d+)/)?.[1];
    // The section names its course: the address changes ~250 ms before the next course's section
    // replaces the last one's.
    const id = sec?.getAttribute('bb-course-membership-markups') || cid;
    if (id && slot && courseSlots[id] !== slot) {
      courseSlots[id] = slot;
      try { chrome.storage.local.set({ courseSlots }); } catch { /* reloaded */ }
    }
    const { tint, tinted: picked } = settings.courses;
    const now = cid ? courseSlots[cid] : isPreview && slot;
    return tint && picked.includes(now) ? now : null;
  };
  // The color the Course colors section already resolves (--gz-course: a pick, toned or raw), read
  // off a hidden probe on <html>, outside the observed body. Null until theme.css has loaded.
  const courseColor = (slot) => {
    const p = document.createElement('i');
    p.className = `course-color-${slot}`;
    p.style.cssText = 'display:none;color:color-mix(in srgb, var(--gz-course, transparent) 100%, transparent)';
    html.append(p);
    const c = C.parse(getComputedStyle(p).color);
    p.remove();
    return c?.a ? C.hex(c) : null;
  };
  let tinted = null; // the slot whose color is painted now
  let palette = GZ_DEFAULTS.colors; // the colors painted, tint included

  // ---- settings → <html> ----------------------------------------------------------------------
  // Everything set goes through these two, so clearSettings removes exactly what was set.
  const vars = new Set();
  const attrs = new Set();
  const setVar = (k, v) => { vars.add(k); html.style.setProperty(k, v); };
  const setAttr = (k, v) => { attrs.add(k); if (v === false) html.removeAttribute(k); else html.setAttribute(k, v === true ? '' : v); };

  // sanitize only lets https URLs through, as URL.href (quotes percent-encoded), so the string is
  // safe inside url("…").
  let probed = '';
  const probeImage = (url) => {
    setVar('--gz-bg-image', `url("${url}")`);
    if (url === probed) return;
    probed = url;
    setAttr('data-gz-bg-failed', false);
    const img = new Image();
    img.onerror = () => { if (probed === url) setAttr('data-gz-bg-failed', true); };
    img.src = url;
  };

  const applySettings = () => {
    const s = settings;
    const base = GZ_ACTIVE_COLORS(s, darkMQ.matches);
    for (const [v] of GZ_COLORS) setVar(v, base[v]);
    setAttr('data-gz-raw-courses', !s.courses.harmonize);
    for (let n = 1; n <= 10; n++) {
      const c = s.courses.colors[n];
      if (c) setVar(`--gz-pick-${n}`, c);
      else html.style.removeProperty(`--gz-pick-${n}`);
    }
    // The course color is worked out from the untinted palette set above, then painted over it.
    const slot = tintSlot();
    const course = slot && courseColor(slot);
    tinted = course ? slot : null;
    const colors = course ? GZ_TINT(base, course, s.courses.strength / 100) : base;
    if (course) for (const [v] of GZ_COLORS) setVar(v, colors[v]);
    palette = colors;
    const dark = C.brightness(C.parse(colors['--gz-surface'])) < 0.5;
    accentInk = C.parse(colors['--gz-accent-ink']);
    setVar('color-scheme', dark ? 'dark' : 'light');
    setAttr('data-gz-dark-theme', dark);
    // Look: numbers become vars, choices become attributes theme.css matches on.
    setVar('--gz-radius', `${s.look.radius}px`);
    setVar('--gz-scale', s.look.scale);
    setVar('--gz-leading', s.look.leading);
    setVar('--gz-glass', `${s.look.glass}px`);
    // No blur means no glass: a see-through header without the blur just shows text behind text.
    setVar('--gz-glass-mix', s.look.glass ? '78%' : '100%');
    // Fonts: the stacks are vars; a web font loads into the page once chosen (lib/fonts.js).
    setAttr('data-gz-font', s.look.font);
    setVar('--gz-font', GZ_FONTS.stack(s.look.font));
    setVar('--gz-font-head', s.look.head === 'auto' ? 'inherit' : GZ_FONTS.stack(s.look.head));
    setAttr('data-gz-font-mono', s.look.mono !== 'auto');
    setVar('--gz-font-mono', GZ_FONTS.stack(s.look.mono));
    for (const f of [s.look.font, s.look.head, s.look.mono]) GZ_FONTS.load(f);
    setAttr('data-gz-density', s.look.density);
    setAttr('data-gz-depth', String(s.look.depth));
    // Background: the kind is an attribute, the picture and its dim/blur are vars. An image that
    // fails to load (bad URL, a host's CSP) falls back to the gradient instead of a bare ground.
    const kind = s.bg.kind === 'image' && !s.bg.image ? 'gradient' : s.bg.kind;
    setAttr('data-gz-bg', kind);
    // A scene's gradient fallback (until it draws, or without WebGL) takes its dim from intensity.
    const look = kind === 'scene' && GZ_SCENE_LOOK(s.bg.intensity);
    setVar('--gz-bg-dim', `${look ? Math.round(look.dim * 100) : s.bg.dim}%`);
    setVar('--gz-bg-blur', `${look ? 0 : s.bg.blur}px`);
    GZ_BG_COLORS(s.bg.colors, colors).forEach((c, i) => setVar(`--gz-bg-${i + 1}`, c));
    setVar('--gz-bg-grad', GZ_GRADIENT(s.bg, OKLAB));
    setAttr('data-gz-bg-grain', s.bg.grain);
    if (kind === 'image') probeImage(s.bg.image);
    else setAttr('data-gz-bg-failed', false);
    // Motion: the system's reduced-motion setting wins over the level unless told otherwise.
    setAttr('data-gz-motion', s.motion.followSystem && calmMQ.matches ? 'off' : s.motion.level);
    setAttr('data-gz-no-trans', !s.motion.transitions);
    setAttr('data-gz-no-enter', !s.motion.enter);
    setAttr('data-gz-no-hover', !s.motion.hover);
    setAttr('data-gz-footer', s.footer);
    // Extras: CSS is gated on these; a switch turned on needs one pass over what is already there.
    const was = enhanced;
    enhanced = s.enhance;
    for (const k of Object.keys(s.enhance)) setAttr(`data-gz-enhance-${k}`, s.enhance[k]);
    if (observer && ['scores', 'urgency', 'inline', 'overall'].some((k) => s.enhance[k] && !was[k])) tagExtras([document.body]);
    if (observer) { renderProgress(); renderCalc(); syncDownloads(); }
    if (!s.enhance.newgrades) { clearTags(['data-gz-new']); for (const p of document.querySelectorAll('.gz-new[data-kind="grades"]')) p.remove(); }
    if (!s.enhance.newcontent) for (const p of document.querySelectorAll('.gz-new:not([data-kind="grades"])')) p.remove();
    if (observer) renderNew();
    if (was.drafts && !s.enhance.drafts) { dropBars(); typed.clear(); tidyDrafts(); }
    // Declutter: CSS hides by these.
    for (const k of ['help', 'banner', 'faculty']) setAttr(`data-gz-hide-${k}`, s.declutter[k]);
    for (const [slug] of GZ_TABS) setAttr(`data-gz-hide-tab-${slug}`, s.declutter.tabs.includes(slug));
    syncFooter();
    // The light/dark tags only apply to a dark theme: re-sweep when that flips.
    if (dark !== darkTheme) {
      darkTheme = dark;
      hoverSeen = new WeakSet();
      focusSeen = new WeakSet();
      if (observer) { clearTags(['data-gz-light', 'data-gz-dark', 'data-gz-hover']); sweepAll(); }
    }
    if (!s.look.tooltips) hideTip();
    if (observer) syncDocTools();
    syncScene();
  };
  const clearSettings = () => {
    for (const k of vars) html.style.removeProperty(k);
    for (const k of attrs) html.removeAttribute(k);
    vars.clear();
    attrs.clear();
  };

  const enable = () => {
    if (notUltra) return;
    if (!links.length) {
      links = SHEETS.map((f) => {
        const l = document.createElement('link');
        l.rel = 'stylesheet';
        l.href = chrome.runtime.getURL(f);
        (document.head || html).appendChild(l);
        return l;
      });
    }
    applySettings();
    onBody(() => {
      if (!links.length) return;
      if (!isUltra()) { disable(); notUltra = true; return; }
      syncFooter();
      startSweep();
      syncScene();
    });
  };
  const disable = () => {
    hideTip();
    hidePeek();
    closeKeys();
    closeCmd();
    for (const id of ['gz-progress', 'gz-calc']) document.getElementById(id)?.remove();
    for (const p of document.querySelectorAll('.gz-new')) p.remove();
    dropBars();
    for (const b of document.querySelectorAll('.gz-dl')) b.remove();
    for (const l of links) l.remove();
    links = [];
    stopScene();
    stopSweep();
    clearSettings();
    syncDocTools();
    syncFooter();
  };

  // Storage can fail (offline sync errors) and every chrome.* call throws once the extension is
  // reloaded or updated under a live tab. Fall back to the defaults rather than breaking the page.
  const load = () => new Promise((res) => {
    try {
      chrome.storage.sync.get(null, (raw) => res(GZ_SANITIZE(chrome.runtime.lastError ? {} : raw)));
    } catch { res(GZ_SANITIZE()); }
  });
  // Theme on before storage answers: most people leave it on, and this way the first paint is
  // already themed. If it turns out to be off, it comes straight back off.
  enable();
  load().then((s) => {
    settings = s;
    tidyDrafts();
    if (!s.enabled) disable();
    else if (links.length) applySettings();
  });
  // The preview is fed the editor's state directly, before it is saved, and ignores storage so a
  // save landing late can't undo an edit that is further along.
  if (isPreview) {
    addEventListener('message', (e) => {
      if (e.origin !== location.origin || !e.data?.gzPreview) return;
      const was = settings.enabled && links.length > 0;
      settings = GZ_SANITIZE(e.data.gzPreview);
      if (settings.enabled && !was) enable();
      else if (!settings.enabled && was) disable();
      else if (settings.enabled) applySettings();
    });
  }
  chrome.storage.onChanged.addListener((_, area) => {
    if (area !== 'sync' || isPreview) return;
    load().then((s) => {
      const was = settings.enabled && links.length > 0;
      settings = s;
      if (s.enabled && !was) enable();
      else if (!s.enabled && was) disable();
      else if (s.enabled) applySettings();
    });
  });
  const reapply = () => { if (settings.enabled && links.length) applySettings(); };
  darkMQ.addEventListener('change', reapply);
  calmMQ.addEventListener('change', reapply);
})();
