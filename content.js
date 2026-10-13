// Glaze — content script, document_start.
// Jobs: (1) put the stylesheets on the page while the theme is on (<link>s we own, so the popup can
// toggle them without a reload), (2) push settings onto <html> — colors and look values as inline
// --gz-* vars, everything else as data-gz-* attributes — so the CSS never branches here,
// (3) the long tail: tag what no selector can reach and let the CSS restyle the tag.
(() => {
  if (window.__gzGlaze) return;
  window.__gzGlaze = true;

  const C = GZ_COLOR;
  const html = document.documentElement;
  const SHEETS = ['theme.css', 'motion.css', 'extras.css'];
  const SKIP = /^(img|video|canvas|svg|iframe|picture|source|path|use|script|style|link|meta)$/i;
  const TAGS = ['data-gz-light', 'data-gz-dark', 'data-gz-fixed-bottom', 'data-gz-vh', 'data-gz-rule', 'data-gz-score', 'data-gz-due', 'data-gz-hover', 'data-gz-pct', 'data-gz-countdown', 'data-gz-chip', 'data-gz-held', 'data-gz-loading', 'data-gz-reveal'];
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

  // Ultra's details lists put the label one element up: "Assessment due date" / "10/11/26, 11:59 PM";
  // an assignment's own page puts both in a .due-date-container.
  const dueLabelled = (el) => /\bdue\b/i.test(el?.parentElement?.previousElementSibling?.textContent || '') || !!el?.closest('.due-date-container');

  // Due dates in course content and on an assignment's own page carry a status: Ultra's progress circle
  // where the course tracks progress, and the gradebook (submitted, graded, exempt). The gradebook is
  // asked of the user's own Blackboard (same origin, their session) at most once a minute per course, and
  // only when one of those due dates is on the page; an answer that changes anything re-tags the page.
  // undefined until it answers.
  let meId = null;
  let book = { cid: null, at: 0, grades: undefined, key: '' };
  const gradesIn = () => {
    const cid = courseId();
    if (!cid) return undefined;
    if (book.cid !== cid || Date.now() - book.at > 60000) {
      book = book.cid === cid ? { ...book, at: Date.now(), pending: true } : { cid, at: Date.now(), grades: undefined, key: '', pending: true };
      // Absolute URLs: Ultra's <base href> points at its CDN.
      const get = (path) => fetch(`${location.origin}/learn/api/v1${path}`, { credentials: 'same-origin', headers: { accept: 'application/json' } })
        .then((r) => (r.ok ? r.json() : Promise.reject(r.status)));
      // ponytail: one page, Ultra's cap of 200 grades; items past that show only their countdown.
      (meId ? Promise.resolve(meId) : get('/users/me').then((me) => (meId = me.id)))
        .then((id) => get(`/courses/${cid}/gradebook/grades?userId=${id}&limit=200&includeNoGradeItems=true&expand=column`))
        .then((j) => {
          if (book.cid !== cid) return;
          book.pending = false;
          const grades = GZ_PAGE.gradesByContent(j.results);
          const key = JSON.stringify([...grades].map(([id, g]) => [id, g.status, g.isExempt, g.displayGrade]));
          if (key === book.key) return;
          Object.assign(book, { grades, key });
          tagExtras([document.body]);
        })
        .catch(() => { if (book.cid === cid) book.pending = false; });
    }
    return book.grades;
  };

  // ---- extras that read page text (score bars, due-date urgency), only while switched on ----
  const tagExtras = (roots) => {
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
        const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (/due/i.test(n.data) || (/\d\/\d/.test(n.data) && dueLabelled(n.parentElement)) ? 1 : 3) });
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
          // Nothing is urgent once it's done. Elsewhere a past date may well be done, and the stream
          // says "Past due" itself.
          let state = urgency && GZ_PAGE.due(text, now);
          if (state && (GZ_PAGE.isDone(circle, grade) || (!item && !pageId && state === 'overdue'))) state = null;
          if (state) el.setAttribute('data-gz-due', state);
          else el.removeAttribute('data-gz-due');
          // The chip is drawn by CSS from these attributes: no element is added to Ultra's tree. In course
          // content it says where the work stands; elsewhere only how long is left, never how long ago.
          let chip = null;
          if (inline && (item || pageId)) chip = GZ_PAGE.status(text, circle, grade, now);
          else if (inline) {
            const w = GZ_PAGE.when(text, now);
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
    placeScene();
    renderProgress();
    syncDownloads();
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
      if (el.isConnected && now - t.at < 2500 && (now - t.still < 300 || timer || book.pending || loaderIn(el))) continue;
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
    if (html.getAttribute('data-gz-motion') !== 'expressive') return;
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
        const w = GZ_PAGE.when(dueLabelled(el) ? `Due ${text}` : text);
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
    b.textContent = j?.label || 'Download all';
    b.toggleAttribute('data-busy', !!j && !j.done);
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
      b.title = "Save this folder's files as one zip. Items you haven't opened are left out, so this never marks them viewed.";
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
    const colors = GZ_ACTIVE_COLORS(settings, darkMQ.matches);
    const { dim, amount, pace } = GZ_SCENE_LOOK(settings.bg.intensity);
    return {
      name: settings.bg.scene,
      ground: colors['--gz-surface-2'],
      colors: GZ_BG_COLORS(settings.bg.colors, colors),
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
    const colors = GZ_ACTIVE_COLORS(s, darkMQ.matches);
    for (const [v] of GZ_COLORS) setVar(v, colors[v]);
    const dark = C.brightness(C.parse(colors['--gz-surface'])) < 0.5;
    accentInk = C.parse(colors['--gz-accent-ink']);
    setVar('color-scheme', dark ? 'dark' : 'light');
    setAttr('data-gz-dark-theme', dark);
    setAttr('data-gz-raw-courses', !s.courses.harmonize);
    for (let n = 1; n <= 10; n++) {
      const c = s.courses.colors[n];
      if (c) setVar(`--gz-pick-${n}`, c);
      else html.style.removeProperty(`--gz-pick-${n}`);
    }
    // Look: numbers become vars, choices become attributes theme.css matches on.
    setVar('--gz-radius', `${s.look.radius}px`);
    setVar('--gz-scale', s.look.scale);
    setVar('--gz-leading', s.look.leading);
    setVar('--gz-glass', `${s.look.glass}px`);
    // No blur means no glass: a see-through header without the blur just shows text behind text.
    setVar('--gz-glass-mix', s.look.glass ? '78%' : '100%');
    setAttr('data-gz-font', s.look.font);
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
    if (observer && ['scores', 'urgency', 'inline'].some((k) => s.enhance[k] && !was[k])) tagExtras([document.body]);
    if (observer) { renderProgress(); syncDownloads(); }
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
    document.getElementById('gz-progress')?.remove();
    for (const b of document.querySelectorAll('.gz-dl')) b.remove();
    for (const l of links) l.remove();
    links = [];
    stopScene();
    stopSweep();
    clearSettings();
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
    if (!s.enabled) disable();
    else if (links.length) applySettings();
  });
  // The options page shows a mock of Ultra (preview.html) that runs this same script. It is fed
  // the editor's state directly, before it is saved, and ignores storage so a save landing late
  // can't undo an edit that is further along.
  const isPreview = location.protocol === 'chrome-extension:';
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
