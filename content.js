// Glaze — content script, document_start.
// Jobs: (1) put the stylesheets on the page while the theme is on (<link>s we own, so the popup can
// toggle them without a reload), (2) push settings onto <html> — colors and look values as inline
// --gz-* vars, everything else as data-gz-* attributes — so the CSS never branches here,
// (3) the long tail: tag what no selector can reach and let the CSS restyle the tag.
// It runs on two sites: Blackboard Ultra, which gets all of that plus its extras (everything marked
// Extras below), and Canvas LMS, which gets (1) to (3), with its own stylesheet, and three extras: Due this
// week, the command palette and grades on the dashboard's course cards (marked Canvas below).
(async () => {
  // Only HTML pages: an /ultra/ address can also be an XML error from Ultra's CDN, or a raw script.
  if (window.__gzGlaze || !/html/.test(document.contentType)) return;
  window.__gzGlaze = true;

  // The options preview is Ultra. On a site, decide once from its head while the parser is still there;
  // addresses and body classes can belong to another app or a same-host tool.
  const isPreview = /-extension:$/.test(location.protocol); // chrome-, moz-, safari-web-extension:
  const ULTRA = 'base[href*="/ultra/"]';
  let site;
  if (isPreview) site = 'ultra';
  else site = await new Promise((resolve) => {
    const look = () => {
      const hit = document.head?.querySelector(`${ULTRA}, link[rel~="stylesheet"][href*="/dist/brandable_css/"]`);
      if (!hit && !document.body) return;
      mo.disconnect();
      document.removeEventListener('DOMContentLoaded', look);
      resolve(hit ? (hit.matches(ULTRA) ? 'ultra' : 'canvas') : null);
    };
    const mo = new MutationObserver(look);
    mo.observe(document, { childList: true, subtree: true });
    document.addEventListener('DOMContentLoaded', look);
    look();
  });
  if (!site) return;
  const ultra = site === 'ultra';

  const C = GZ_COLOR;
  const html = document.documentElement;
  const SKIP = /^(img|video|canvas|svg|iframe|picture|source|path|use|script|style|link|meta)$/i;
  const TAGS = ['data-gz-light', 'data-gz-dark', 'data-gz-fixed-bottom', 'data-gz-vh', 'data-gz-rule', 'data-gz-score', 'data-gz-due', 'data-gz-hover', 'data-gz-pct', 'data-gz-countdown', 'data-gz-chip', 'data-gz-grade', 'data-gz-held', 'data-gz-loading', 'data-gz-reveal', 'data-gz-new', 'data-gz-brand-bg', 'data-gz-brand-fg'];
  const darkMQ = matchMedia('(prefers-color-scheme: dark)');
  // Gradients mixed in OKLab keep their midpoints bright instead of going grey (Chrome 111, Firefox 127).
  const OKLAB = CSS.supports('background-image', 'linear-gradient(in oklab, red, blue)') ? 'oklab' : '';
  const calmMQ = matchMedia('(prefers-reduced-motion: reduce)');
  let settings = GZ_DEFAULTS;
  let links = [];
  let observer = null;
  let timer = 0;
  let notUltra = false; // the page isn't the site its address says (Ultra or Canvas): stays off
  let darkTheme = true;
  let accentInk = null; // dark text Glaze itself puts on accent fills; the sweep leaves it alone
  let enhanced = {};
  // Canvas wears canvas.css instead of theme.css and extras.css, which are written against Ultra's markup.
  // motion.css comes along: it is mostly the motion knobs (--gz-t, --gz-enter…, set per level by
  // html[data-gz-motion] and the three switches) that any sheet's animations read, so canvas.css doesn't
  // redo them. Its Ultra-named rules (.route-view-container, .element-card…) match nothing in Canvas.
  const SHEETS = ultra ? ['theme.css', 'motion.css', 'extras.css'] : ['canvas.css', 'motion.css'];

  const hasText = (e) => { for (const n of e.childNodes) if (n.nodeType === 3 && n.textContent.trim()) return true; return false; };
  // On Canvas, the whole document: put on a school's own host by lib/background.js mid-load, the body can be
  // there before Canvas's wrapper (isCanvas) is.
  const onBody = (fn) => (document.body && (ultra || document.readyState !== 'loading') ? fn() : document.addEventListener('DOMContentLoaded', fn, { once: true }));
  // Keep the head marker check when enabling after settings change too.
  const isUltra = () => isPreview || !!document.head?.querySelector(ULTRA);
  // Likewise `https://*.instructure.com/*`, and each school's own Canvas host that lib/detect.js found, is
  // every page and frame on that host. Canvas's own pages sit in this wrapper; a tool framed inside one
  // doesn't, and stays as it is.
  const isCanvas = () => !!document.querySelector('#application.ic-app');
  // A same-host tool can carry Canvas's head marker too; confirm its wrapper before styling a frame.
  if (!ultra && window.top !== window) {
    await new Promise(onBody);
    if (!isCanvas()) return;
  }

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
  // Canvas: InstUI writes its brand blue (#2B7ABC, and darker shades) into its buttons, links and icons as a literal, so no
  // variable reaches it. Cool blues on InstUI's own (css-hash) elements are tagged, and canvas.css paints them the accent;
  // an instructor's blue text, which has no such class, is left as written. The fills, text and icons it sweeps are
  // read here for that alone, so it runs on a light palette too.
  const instBlue = (c) => !!c && c.a >= 0.5 && c.b > c.g + 25 && c.g > c.r + 25;
  const tagBrand = (cs, tags) => {
    if (instBlue(C.parse(cs.backgroundColor))) tags.push('data-gz-brand-bg');
    if (instBlue(C.parse(cs.color))) tags.push('data-gz-brand-fg');
  };
  const sweepColors = (e, cs) => {
    if (cs.transitionDuration === '0s') return cs;
    const colors = { backgroundColor: cs.backgroundColor, color: cs.color };
    // InstUI's transition can still show the old state after its class changes.
    for (const a of e.getAnimations()) {
      const k = a.transitionProperty === 'background-color' ? 'backgroundColor' : a.transitionProperty === 'color' ? 'color' : null;
      if (k) colors[k] = a.effect?.getKeyframes().at(-1)?.[k] || colors[k];
    }
    return colors;
  };
  // A field's own text is its value, not a text node; on Canvas an InstUI field in a modal (a portal, outside #application) keeps Canvas's dark ink.
  const FIELD = /^(input|textarea|select)$/i;
  const SWEEP_TAGS = ['data-gz-light', 'data-gz-dark', 'data-gz-fixed-bottom', 'data-gz-vh', 'data-gz-brand-bg', 'data-gz-brand-fg'];
  const sweepEls = (els) => {
    // Read the site's current state, without our previous pass's overrides.
    for (const e of els) for (const a of e.getAttributeNames()) if (SWEEP_TAGS.includes(a)) e.removeAttribute(a);
    const pending = [];
    const canvasInk = !ultra && new Map();
    for (const e of els) {
      if (e.tagName === 'IMG') {
        if (e.complete) tagRule(e);
        else e.addEventListener('load', () => tagRule(e), { once: true });
        continue;
      }
      // An InstUI icon's colour is on the <svg> itself, which the sweep otherwise skips.
      if (!ultra && e.tagName === 'svg') {
        if (e.getAttribute('class')?.includes('css-')) {
          const ink = C.parse(sweepColors(e, getComputedStyle(e)).color);
          if (instBlue(ink)) pending.push([e, ['data-gz-brand-fg']]);
          else if (ink && ink.a >= 0.5 && !C.saturated(ink) && C.brightness(ink) < 0.35 && e.closest('[data-cid~="BaseButton"]')) pending.push([e, ['data-gz-dark']]);
        }
        continue;
      }
      if (!e.isConnected || SKIP.test(e.tagName) || e.id.startsWith('gz-') || e.closest('svg, [id^="gz-"]')) continue;
      const cs = getComputedStyle(e);
      const instui = !ultra && e.getAttribute('class')?.includes('css-');
      const colors = instui ? sweepColors(e, cs) : cs;
      const tags = [];
      if (instui) tagBrand(colors, tags);
      // Light paper and dark text only clash with a dark theme. On a light preset Ultra's white is
      // already close to the surface, and repainting it would flatten the chips and badges on it.
      if (darkTheme) {
        const bg = C.parse(colors.backgroundColor);
        const fg = C.parse(colors.color);
        let fill = null, fillColor = null;
        if (!ultra && e.closest('.user_content')) {
          // Keep an instructor's light coloured highlight, and only repair ink that cannot read on it.
          // shortcut: opaque inline fills only; add compositing for translucent or gradient highlights when seen.
          for (let p = e; p; p = p.parentElement) {
            const fillStyle = p === e ? cs : getComputedStyle(p);
            const authored = p.style.backgroundColor && C.parse(fillStyle.backgroundColor);
            if (p.style.backgroundImage && fillStyle.backgroundImage !== 'none') break;
            if (authored && authored.a > 0) {
              if (authored.a === 1 && C.luminance(authored) > 0.45
                && Math.max(authored.r, authored.g, authored.b) !== Math.min(authored.r, authored.g, authored.b)) { fill = p; fillColor = authored; }
              break;
            }
            if (p.classList.contains('user_content')) break;
          }
          if (fill && fg) {
            let inkColor = fg;
            const paletteInk = C.parse(getComputedStyle(document.documentElement).getPropertyValue('--gz-ink')) || fg;
            for (let p = e; p; p = p.parentElement) {
              if (p !== e && canvasInk.get(p) === '') { inkColor = paletteInk; break; }
              if (p.style.color) break;
              // On enable the stylesheet may still be loading; un-authored inherited ink becomes palette ink.
              if (p.classList.contains('user_content')) { inkColor = paletteInk; break; }
            }
            const ink = `rgb(${['r', 'g', 'b'].map((k) => inkColor[k] * inkColor.a + fillColor[k] * (1 - inkColor.a)).join(', ')})`;
            if (C.contrast(ink, C.hex(fillColor)) < 4.5) canvasInk.set(e, 'highlight');
          }
          const line = e.tagName === 'HR' && e.style.borderTopColor && C.parse(cs.borderTopColor);
          if (line && line.a === 1 && C.same(line, C.parse('#000'))) canvasInk.set(e, 'rule');
        }
        if (bg && bg.a >= 0.5 && !C.saturated(bg) && C.brightness(bg) > 0.4 && cs.backgroundImage === 'none' && fill !== e) tags.push('data-gz-light');
        // Dark text on a coloured fill (Submit, filled chips) is meant to be dark.
        const onFill = fill || (bg && bg.a >= 0.5 && C.saturated(bg)) || C.same(fg, accentInk);
        if (fg && fg.a >= 0.5 && !C.saturated(fg) && C.brightness(fg) < 0.35 && !onFill && (hasText(e) || (!ultra && FIELD.test(e.tagName)))) tags.push('data-gz-dark');
        if (!ultra && canvasInk.has(e)) tags.push('data-gz-dark');
        if (!ultra && tags.includes('data-gz-dark') && !canvasInk.has(e)) canvasInk.set(e, '');
      }
      const r = e.getBoundingClientRect();
      // Fixed to the bottom of the VIEWPORT (Ultra's action bars, the help button): outside the
      // shrunk layout, so it would sit over the footer. Lift it by the footer height.
      if (cs.position === 'fixed' && r.bottom >= innerHeight - 1) tags.push('data-gz-fixed-bottom');
      // Sized with 100vh (Ultra's route containers): the shrunk wrappers can't reach it, so clamp.
      if (Math.abs(r.height - innerHeight) <= 1) tags.push('data-gz-vh');
      if (tags.length) pending.push([e, tags]);
    }
    for (const [e, tags] of pending) for (const a of tags) e.setAttribute(a, (!ultra && a === 'data-gz-dark' && canvasInk.get(e)) || '');
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

  // ---- the student's courses -------------------------------------------------------------------
  // Every course and the color slot Ultra gives it, for the editor's course list and the tint on
  // pages that don't show the slot: from the membership list Ultra's own Courses page asks for, once
  // a page load and at most every ten minutes. Stored locally; nothing leaves the device.
  let canvasRecorded = false;
  const canvasCourseKey = (id = canvasCourseId()) => id ? `canvas:${location.origin}/${id}` : null;
  const recordCourses = () => {
    if (!ultra) {
      if (canvasRecorded || window.top !== window) return;
      canvasRecorded = true;
      Promise.all([canvasCourses(), capi('/users/self/colors').catch(() => ({}))]).then(([list, colors]) => {
        const seen = Object.fromEntries(list.filter((c) => /^\d+$/.test(c.id) && c.name).map((c) => [canvasCourseKey(c.id), {
          name: c.name, code: c.course_code, canvas: true, color: /^#[0-9a-f]{6}$/i.test(colors.custom_colors?.[`course_${c.id}`]) ? colors.custom_colors[`course_${c.id}`] : null,
        }]));
        // Preserve Blackboard and other schools; Canvas ids alone are only unique within their own host.
        chrome.storage.local.get('seenCourses', (r) => {
          const all = { ...r?.seenCourses, ...seen };
          chrome.storage.local.set({ seenCourses: all });
          courseList = all;
          paintCourses();
          syncCourseMenu();
          reapply();
        });
      }).catch(() => { canvasRecorded = false; });
      return;
    }
    if (window.top !== window) return;
    try {
      chrome.storage.local.get('seenCoursesAt', (r) => {
        if (Date.now() - (r?.seenCoursesAt || 0) < 600000) return;
        myCourses().then((ms) => {
          const seen = GZ_COURSES(ms);
          if (!Object.keys(seen).length) return;
          for (const [id, c] of Object.entries(seen)) courseSlots[id] = c.slot;
          try { chrome.storage.local.get('seenCourses', (r) => {
            const canvas = Object.fromEntries(Object.entries(r?.seenCourses || {}).filter(([, c]) => c?.canvas));
            chrome.storage.local.set({ seenCourses: { ...canvas, ...seen }, seenCoursesAt: Date.now(), courseSlots });
          }); } catch { /* reloaded */ }
        });
      });
    } catch { /* extension reloaded under the tab */ }
  };
  // What's left to do in the next seven days (GZ_DUE_WEEK), from Ultra's own To Do list, or on Canvas from
  // its planner (GZ_CANVAS_DUE_WEEK), for the command palette and the popup (which can't ask the site, so it
  // reads what's kept here). Asked once a page load and at most every ten minutes, like the course list, which
  // names each Ultra item's course (a Canvas item brings its own, and its address, which Ultra's never do).
  let dueSoon = null;
  const dueWeek = () => (dueSoon ||= new Promise((res) => {
    try { chrome.storage.local.get(['dueWeek', 'dueWeekAt', 'dueWeekFrom'], res); } catch { res({}); }
  }).then((r) => {
    const now = Date.now();
    // A list kept by another site (someone with Blackboard and Canvas, or two schools' Canvas, open) is no use
    // here: its items open nothing, or the wrong school's. Even an empty one says nothing about this site.
    const other = r?.dueWeekFrom !== location.origin;
    const kept = other ? [] : r?.dueWeek || [];
    if (!other && now - (r?.dueWeekAt || 0) < 600000) return kept;
    const at = (days) => new Date(now + days * 864e5).toISOString();
    const ask = ultra ? api(`/calendars/todo/studentItems?since=${at(0)}&until=${at(7)}`).then((j) => GZ_DUE_WEEK(j, now))
      : capi(`/planner/items?start_date=${at(0)}&end_date=${at(7)}&per_page=100`).then((j) => GZ_CANVAS_DUE_WEEK(j, now));
    return ask.then((list) => {
      try { chrome.storage.local.set({ dueWeek: list, dueWeekAt: Date.now(), dueWeekFrom: location.origin }); } catch { /* reloaded */ }
      return list;
    }, () => kept);
  }));

  // Where Ultra writes a due date, in any language: a course item's grade line and an assignment's own
  // page (its .due-date-container). Its English details lists put the label one element up:
  // "Assessment due date" / "10/11/26, 11:59 PM".
  const DUE_AT = '.due-date-container, .content-list-item [class*="makeStylesgradeDetail-"]';
  const dueLabelled = (el) => /\bdue\b/i.test(el?.parentElement?.previousElementSibling?.textContent || '') || !!el?.closest(DUE_AT);
  // The locale Ultra renders in: <html lang> is bound to it ("{{index.locale}}" until Ultra starts).
  const locale = () => { try { return Intl.getCanonicalLocales(html.lang.replace(/_/g, '-'))[0] || navigator.language; } catch { return navigator.language; } };
  // Glaze's own words on the page are in that language too (lib/i18n.js), English where it has none.
  const t = (key, vars) => GZ_I18N.t(key, vars, locale());

  // ---- the gradebook --------------------------------------------------------------------------
  // Due-date status, new grades and the what-if calculator read the student's own gradebook records,
  // asked of their own Blackboard (same origin, their session) the way Ultra's Grades page asks: at
  // most once a minute per course, and only for courses on the page where one of those is showing.
  // Absolute URLs: Ultra's <base href> points at its CDN.
  // Canvas's REST API is the same thing under /api/v1 (capi): its string-id JSON keeps long ids exact, and an
  // older Canvas starts a response with `while(1);`.
  const api = (path, base = '/learn/api/v1', accept = 'application/json') => fetch(`${location.origin}${base}${path}`, { credentials: 'same-origin', headers: { accept } })
    .then((r) => (r.ok ? r.text() : Promise.reject(r.status))).then((text) => JSON.parse(text.replace(/^while\(1\);/, '')));
  const capi = (path) => api(path, '/api/v1', 'application/json+canvas-string-ids');
  // The Canvas course this page is in (/courses/:id/...), or undefined.
  const canvasCourseId = () => location.pathname.match(/^\/courses\/(\d+)/)?.[1];
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

  // ---- grades on course cards (Extras; Canvas below) -----------------------------------------
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
    if (!observer || !settings.enhance.overall) return;
    if (!ultra) return tagCanvasCards();
    if (location.pathname !== '/ultra/course') return;
    for (const el of document.querySelectorAll(CARD_STATUS)) cardsIO.observe(el);
    for (const el of onScreen) {
      if (!el.isConnected) { onScreen.delete(el); cardsIO.unobserve(el); continue; }
      const cid = el.closest('[data-course-id]')?.dataset.courseId || el.closest('a')?.href.match(/\/courses\/(_\d+_\d+)\//)?.[1];
      const g = cid && bookFor(cid).overall;
      if (g) { el.setAttribute('data-gz-grade', g.label); el.setAttribute('data-gz-chip', g.tone); }
      else if (g === null) { el.removeAttribute('data-gz-grade'); el.removeAttribute('data-gz-chip'); }
    }
  };
  // Canvas: the dashboard's cards (card view) get the same chip, on the course code's line: the course's current
  // score (GZ_PAGE.canvasOverall), drawn by canvas.css from the same attributes. One course list with scores
  // serves every card, asked once a page load; the command palette's course list is that answer too.
  // ponytail: the first 100 courses, no paging.
  let canvasList = null;
  const canvasCourses = () => (canvasList ||= capi('/courses?enrollment_state=active&include[]=total_scores&include[]=current_grading_period_scores&include[]=restrict_quantitative_data&per_page=100')
    .then((j) => (Array.isArray(j) ? j : []), () => { setTimeout(() => { canvasList = null; }, 60000); return []; })); // asked again after a minute
  const tagCanvasCards = () => {
    if (!document.querySelector('.ic-DashboardCard')) return;
    canvasCourses().then((list) => {
      if (!observer) return; // switched off while it was asked
      const grades = GZ_PAGE.canvasOverall(list, locale());
      for (const card of document.querySelectorAll('.ic-DashboardCard')) {
        const el = card.querySelector('.ic-DashboardCard__header-subtitle, .ic-DashboardCard__header-term');
        if (!el) continue;
        const g = grades[card.querySelector('a[href*="/courses/"]')?.getAttribute('href').match(/\/courses\/([^/?#]+)/)?.[1]];
        if (g) { el.setAttribute('data-gz-grade', g.label); el.setAttribute('data-gz-chip', g.tone); } else { el.removeAttribute('data-gz-grade'); el.removeAttribute('data-gz-chip'); }
      }
    });
  };
  // Canvas: its course colors come inline on the card's hero and the list view's group (canvas.css, Course colors),
  // where no selector can read them: copied into --gz-course-raw on the card or group, which canvas.css tones. The
  // source is the inline value, never computed: canvas.css overrides it with !important and never writes it, so
  // what is read is always Canvas's own (a color changed on the page re-renders it, and the style mutation brings
  // us back here). Run from the mutation callback, so a new card is toned before its first paint. Only on change:
  // our own write is a mutation too. Not /users/self/colors: Canvas picks a default color in the browser for a course
  // with none and saves it only after painting, and a color changed on the page never reaches a list asked for once.
  const COURSE_BOXES = [['.ic-DashboardCard', '.ic-DashboardCard__header_hero', 'backgroundColor'], ['.planner-grouping', ':scope > ol', 'borderColor']];
  const liftCourses = () => {
    for (const [box, src, prop] of COURSE_BOXES) {
      for (const el of document.querySelectorAll(box)) {
        const c = el.querySelector(src)?.style[prop];
        if (c && el.style.getPropertyValue('--gz-course-raw') !== c) el.style.setProperty('--gz-course-raw', c);
      }
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
          Object.assign(b, { results: j.results, grades: GZ_PAGE.gradesByContent(j.results), overall: GZ_PAGE.overall(j.results, locale()), late: lateCols, key });
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
    if (!ultra) return;
    const { scores, urgency, inline } = settings.enhance;
    if (!scores && !urgency && !inline) return;
    const now = new Date();
    const loc = locale();
    for (const root of roots) {
      if (scores || inline) {
        for (const pill of root.querySelectorAll('.readonly-pill, .wrapping-input-style.pill-style')) {
          const sc = GZ_PAGE.score(pill.querySelector('.js-pill-grade')?.textContent, pill.querySelector('.pill-points-possible')?.textContent);
          if (!sc) continue;
          // Only on change: a style write is itself a mutation the observer would hand back.
          if (scores && pill.style.getPropertyValue('--gz-score') !== String(sc.ratio)) pill.style.setProperty('--gz-score', sc.ratio);
          if (scores) pill.setAttribute('data-gz-score', sc.band);
          if (inline) pill.setAttribute('data-gz-pct', GZ_I18N.pct(Math.round(sc.ratio * 100), loc));
        }
      }
      if (urgency || inline) {
        // Due dates by where Ultra puts them; in English, also by the word ("puede" isn't one).
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
            if (w && !w.past) chip = { label: w.rel, tone: '' };
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
    // Both sites run the same list; a helper that isn't on Canvas yet returns at its top (`if (!ultra) return`).
    themeEditors();
    if (tip && ultraTipShown()) hideTip();
    paintCourses();
    if (tintKey() !== tinted || lookHere() !== looked) applySettings();
    placeScene();
    renderProgress();
    renderNew();
    keepPlace();
    renderCalc();
    watchDrafts();
    syncDownloads();
    syncDocTools();
    syncCourseMenu();
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
    if (!ultra) liftCourses();
    for (const r of records) {
      if (ultra && r.attributeName === 'aria-checked') {
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
        if (!ultra) continue; // holding a page while it loads is Ultra's
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
    if (window.top === window) dueWeek();
    if (!ultra) liftCourses();
    tagExtras([document.body]);
    watchDrafts();
    recordCourses();
    syncCourseMenu();
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
    clearTags(ultra ? TAGS : [...TAGS, 'data-gz-course-color']);
    if (!ultra) for (const e of document.querySelectorAll('[style*="--gz-course-raw"]')) { e.style.removeProperty('--gz-course-raw'); if (!e.style.length) e.removeAttribute('style'); } // Canvas's course colors
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
    // Canvas: InstUI's icon buttons are mostly <svg>, so the pointer lands on a path, not an HTMLElement, and the
    // walk below stopped before it reached the button whose fill lights up. Start at the svg's parent instead.
    let start = e.target;
    if (!ultra && start instanceof SVGElement) start = start.closest('svg')?.parentElement;
    for (let el = start, i = 0; el instanceof HTMLElement && i < (focus ? 1 : 6); el = el.parentElement, i++) {
      if (seen.has(el)) continue;
      seen.add(el);
      // Canvas eases its hover fills in (a roster row, InstUI's buttons), so at pointerover the fill read is still
      // the resting one, and the row was marked seen without its light fill ever being tagged. Judge it once the
      // transition lands instead; if it is cut short (the pointer left), the next contact looks again.
      if (!ultra) {
        const easing = el.getAnimations().filter((a) => a.transitionProperty?.startsWith('background'));
        if (easing.length) {
          Promise.all(easing.map((a) => a.finished)).then(() => (darkTheme && observer && el.isConnected && el.matches(focus ? ':focus' : ':hover') ? judgeHover(el) : seen.delete(el)), () => seen.delete(el));
          continue;
        }
      }
      judgeHover(el);
    }
  };
  const judgeHover = (el) => {
    const cs = getComputedStyle(el);
    const bg = C.parse(cs.backgroundColor);
    if (!bg || bg.a < 0.5 || C.saturated(bg) || C.brightness(bg) <= 0.4) return;
    if (el.matches(CLICKABLE) || cs.cursor === 'pointer') el.setAttribute('data-gz-hover', '');
    else if (cs.backgroundImage === 'none') el.setAttribute('data-gz-light', '');
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
        if (sc) return [el, { title: t('{got} of {n} points', { got: parseFloat(got), n: parseFloat(max) }), sub: GZ_I18N.pct(Math.round(sc.ratio * 100), locale()) }];
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
    if (!ultra || !settings.look.tooltips || !observer || !(e.target instanceof HTMLElement)) return;
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
  // A folder's or learning module's own fold toggle, by the id Ultra gives it in every language; null for
  // anything else (an Ultra document is a folder to the API, but has none).
  const toggleOf = (item) => item?.querySelector(`[id="folder-title-${item.dataset.contentId}"], [id="learning-module-title-${item.dataset.contentId}"]`);
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
    head.textContent = t('{n} items · {done} done', { n: list.length, done });
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
        d.textContent = GZ_PAGE.describe(new Date(due), true, now, locale()).rel;
        li.append(d);
      }
      ul.append(li);
    }
    peek.append(head, ul);
    if (list.length > 8) {
      const more = document.createElement('div');
      more.className = 'gz-peek-more';
      more.textContent = t('and {n} more', { n: list.length - 8 });
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
    if (!ultra || !settings.enhance.previews || !observer || !(e.target instanceof Element)) return;
    const item = e.target.closest('.content-list-item[data-content-id]');
    if (item === peekFor) return;
    hidePeek();
    // Collapsed folders only: an open one already shows its contents.
    const cid = courseId();
    if (!cid || toggleOf(item)?.getAttribute('aria-expanded') !== 'false') return;
    peekFor = item;
    const fid = item.getAttribute('data-content-id');
    peekTimer = setTimeout(() => children(cid, fid).then((list) => showPeek(item, list)), 550);
  }, { capture: true, passive: true });
  for (const ev of ['pointerdown', 'scroll', 'wheel']) document.addEventListener(ev, hidePeek, { capture: true, passive: true });

  // ---- course progress (Extras) ---------------------------------------------------------------
  // One bar above the course outline adding up what the outline already says: each folder's
  // "N of M completed" (in any language: lib/page.js) plus each top-level item's review circle. Redrawn
  // only when the numbers move. The Content page only: other course tabs (Discussions) list items too.
  const renderProgress = () => {
    if (!ultra) return;
    const old = document.getElementById('gz-progress');
    if (!settings.enhance.progress || !/^\/ultra\/courses\/_\d+_\d+\/outline(\/|$)/.test(location.pathname)) return old?.remove();
    const top = [...document.querySelectorAll('.content-list-item[data-content-id]')].filter((e) => !e.parentElement.closest('.content-list-item'));
    let done = 0;
    let total = 0;
    for (const it of top) {
      // Some are done where Ultra puts its check in the line (all done) or a completed part in its chart.
      const msg = it.querySelector('.js-completion-status-message');
      const m = msg && GZ_PAGE.completion(msg.textContent, !!msg.querySelector('svg') || !!msg.parentElement.querySelector('.js-completion-chart [class*="chartLineCompleted"]'));
      if (m) { total += m.total; done += m.done; continue; }
      const rs = it.querySelector('.js-review-state-icon-button');
      if (rs) { total += 1; if (rs.getAttribute('aria-checked') === 'true') done += 1; }
    }
    if (!total) return old?.remove();
    const key = `${done}/${total} ${locale()}`;
    if (old?.dataset.v === key && old.isConnected) return;
    const bar = old || document.createElement('div');
    bar.id = 'gz-progress';
    bar.dataset.v = key;
    const pct = Math.round((done / total) * 100);
    bar.style.setProperty('--gz-pct', `${pct}%`);
    bar.replaceChildren();
    const label = document.createElement('span');
    label.textContent = t('Course progress: {done} of {n} items complete', { done, n: total });
    const num = document.createElement('b');
    num.textContent = GZ_I18N.pct(pct, locale());
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
  const KIND = { grades: '{n} new grades: open the gradebook', items: '{n} new items: open the course', inside: '{n} new items: show them' };
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
    const label = kind === 'item' ? t('New') : t(kind === 'items' ? '{n} new items' : '{n} new', { n: count });
    if (pill.textContent !== label) {
      pill.textContent = label;
      if (KIND[kind]) pill.setAttribute('aria-label', t(KIND[kind], { n: count }));
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
    if (!ultra) return;
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
        for (const el of document.querySelectorAll('[id^="course-student-grades-item-name-"]')) badge(el, set.has(el.id.slice(32)) && t('New'));
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

  // ---- your place in a course (Extras) --------------------------------------------------------
  // Ultra keeps a course's open folders and last-clicked item in memory only: gone with a reload, a
  // new visit or another course's content. Glaze keeps them per course on this device (storage.local
  // coursePlace, lib/page.js): a folder once it unfolds, forgotten once you fold it yourself (Ultra
  // folds some itself), and how far down you were. Each time the outline comes back, folders still
  // closed are unfolded as the jump above does, each once, then it scrolls back if nothing has moved
  // it. Anything you do first (wheel, touch, a key, a click) ends that; given up after ten seconds.
  const OUTLINE = /^\/ultra\/courses\/_\d+_\d+\/outline\/?$/;
  const ROWS = '.content-list-item[data-content-id]';
  let place = null; // { cid, open (folder ids), top, seen (id → open), away, loaded, back: { at, opened, clicked, quiet, scrolled, steady } | null }
  let tapped = null; // { id, at }: the row of your last click
  const scrollerOf = (el) => {
    for (let p = el?.parentElement; p && p !== document.body; p = p.parentElement) if (/auto|scroll|overlay/.test(getComputedStyle(p).overflowY)) return p;
    return document.scrollingElement;
  };
  const outlineRows = (cid) => (OUTLINE.test(location.pathname) && courseId() === cid ? document.querySelectorAll(ROWS) : []);
  // Also kept in this tab's sessionStorage, so a reload finds it even when storage.local can't be
  // reached: an extension updated or reloaded under the tab leaves the tab's old script without it.
  const tabPlace = (cid) => `gz-place:${cid}`;
  const savePlace = () => {
    const p = place;
    if (!p?.loaded) return;
    const v = { open: [...p.open], top: p.top };
    const now = Date.now();
    try { sessionStorage.setItem(tabPlace(p.cid), JSON.stringify(GZ_PAGE.place(null, p.cid, v, now)[p.cid])); } catch { /* blocked or full */ }
    local((s) => s.get('coursePlace', (r) => s.set({ coursePlace: GZ_PAGE.place(r?.coursePlace, p.cid, v, now) })));
  };
  const backTo = () => {
    const p = place;
    const b = p?.back;
    if (!b) return;
    const rows = outlineRows(p.cid);
    if (!rows.length) { p.back = null; return; }
    if (b.ready && !held.size) {
      let busy = false;
      for (const row of rows) {
        const id = row.dataset.contentId;
        const tg = p.open.has(id) && toggleOf(row);
        if (!tg || tg.getAttribute('aria-expanded') !== 'false') continue;
        if (!b.opened.has(id)) { b.opened.add(id); b.clicked = Date.now(); tg.click(); }
        // A folder that never opens (restricted, say) is waited for two seconds.
        busy ||= Date.now() - b.clicked < 2000;
      }
      b.quiet = busy ? 0 : b.quiet + 1;
      if (b.quiet >= 2 || Date.now() - b.at > 10000) {
        const sc = scrollerOf(rows[0]);
        // Anything you do ends this above, so what moved the outline meanwhile is Ultra (it scrolls a
        // module it unfolds into view): the place kept wins.
        if (!p.top) { p.back = null; return; }
        // An unfolded module's contents slide open over ~0.4 s and rows can still arrive, so the outline
        // grows under the scroll (clamping it, then anchoring shifts it): set again until it holds there
        // twice running, for three seconds at most. Nothing is saved meanwhile.
        b.scrolled ||= Date.now();
        const there = Math.abs(sc.scrollTop - p.top) < 2;
        b.steady = there ? (b.steady || 0) + 1 : 0;
        if (b.steady >= 2 || Date.now() - b.scrolled > 3000) { p.back = null; return; }
        if (!there) sc.scrollTop = p.top;
      }
    }
    setTimeout(backTo, 200);
  };
  const keepPlace = () => {
    if (!ultra) return;
    if (!settings.enhance.place) { place = null; return; }
    const cid = window.top === window && observer && courseId();
    const rows = cid ? outlineRows(cid) : [];
    if (!rows.length) { if (place) place.away = true; return; }
    if (!place || place.away || place.cid !== cid) {
      const p = { cid, open: new Set(), top: 0, seen: new Map(), back: { at: Date.now(), opened: new Set(), clicked: 0, quiet: 0 } };
      place = p;
      // The newer of what this device and this tab kept.
      let tab = null;
      try { tab = JSON.parse(sessionStorage.getItem(tabPlace(cid))); } catch { /* none */ }
      const got = (kept) => {
        const was = tab?.at > (kept?.at || 0) ? tab : kept;
        p.open = new Set([...(Array.isArray(was?.open) ? was.open : []), ...p.open]);
        if (was?.top > 0) p.top = +was.top;
        p.loaded = true;
        if (p.back) { p.back.ready = true; backTo(); }
      };
      try { chrome.storage.local.get('coursePlace', (r) => got(r?.coursePlace?.[cid])); } catch { got(null); }
    }
    let changed = false;
    for (const row of rows) {
      const tg = toggleOf(row);
      if (!tg) continue;
      const id = row.dataset.contentId;
      const open = tg.getAttribute('aria-expanded') === 'true';
      const was = place.seen.get(id);
      place.seen.set(id, open);
      if (was === open) continue;
      if (open) place.open.add(id);
      else if (was && tapped?.id === id && Date.now() - tapped.at < 3000) place.open.delete(id);
      else continue;
      changed = true;
    }
    if (changed) savePlace();
  };
  document.addEventListener('click', (e) => { if (e.isTrusted && e.target instanceof Element) tapped = { id: e.target.closest(ROWS)?.dataset.contentId, at: Date.now() }; }, true);
  for (const ev of ['wheel', 'touchstart', 'keydown', 'pointerdown']) document.addEventListener(ev, (e) => { if (e.isTrusted && place) place.back = null; }, { capture: true, passive: true });
  // How far down, read at most every half second while scrolling; not while being put back, or once the
  // outline is gone (a page shrinking under it scrolls it too).
  let placeTimer = 0;
  document.addEventListener('scroll', () => {
    if (!place || place.back || placeTimer) return;
    placeTimer = setTimeout(() => {
      placeTimer = 0;
      const rows = place && !place.back && !place.away ? outlineRows(place.cid) : [];
      const top = rows.length && scrollerOf(rows[0]).scrollTop;
      if (rows.length && top !== place.top) { place.top = top; savePlace(); }
    }, 500);
  }, { capture: true, passive: true });

  // ---- what-if calculator (Extras) -----------------------------------------------------------
  // On a course's gradebook: scores typed for work not graded yet give the overall grade they'd make,
  // and a target gives the even share of the remaining points it needs. The recipe is the course's own
  // overall grade (lib/grades.js), and it must reproduce Blackboard's figure first; otherwise it says so.
  // The scores are kept on this device (storage.local, whatIf) until cleared, or the item is graded or gone.
  const whatIf = new Map(); // cid → { overrides: Map columnId → score, target }, or null while loading
  const keepCalc = (cid, overrides) => {
    try { chrome.storage.local.get('whatIf', (r) => chrome.storage.local.set({ whatIf: GZ_GRADES.storeScores(r?.whatIf, cid, overrides) })); } catch { /* extension reloaded under the tab */ }
  };
  // Cut, not rounded, to two places: how Ultra writes its own overall grade (82.456 is 82.45%).
  const asPct = (p) => (p == null ? '–' : GZ_I18N.pct(Math.floor(p * 100 + 1e-9) / 100, locale()));
  const make = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; };
  const renderCalc = () => {
    if (!ultra) return;
    const old = document.getElementById('gz-calc');
    const cid = courseId();
    const host = settings.enhance.calc && observer && cid && /^\/ultra\/courses\/_\d+_\d+\/grades/.test(location.pathname) && document.querySelector('.grades-list > aside.student-grade-overview');
    if (!host) return old?.remove();
    const b = bookFor(cid);
    if (!b.results) return;
    const key = `${cid} ${b.key} ${locale()}`;
    if (old?.dataset.key === key && old.previousElementSibling === host) return;
    if (!whatIf.has(cid)) {
      whatIf.set(cid, null);
      const got = (r) => whatIf.set(cid, { overrides: new Map(Object.entries(r?.whatIf?.[cid] || {})), target: '' });
      try { chrome.storage.local.get('whatIf', (r) => { got(r); renderCalc(); }); } catch { got(); }
    }
    const st = whatIf.get(cid);
    if (!st) return;
    const m = GZ_GRADES.model(b.results);
    // Graded, exempted or gone since: its score goes.
    const kept = GZ_GRADES.keptScores(st.overrides, m.items);
    if (kept.size !== st.overrides.size) { st.overrides = kept; keepCalc(cid, kept); }
    const now = make('b', { textContent: m.kind === 'unsupported' ? '' : asPct(m.percent()) });
    const box = make('details', { id: 'gz-calc', open: !!old?.open },
      make('summary', {}, make('span', { textContent: t('What-if calculator') }), now));
    box.dataset.key = key;
    box.setAttribute('aria-label', t('What-if grade calculator'));
    if (m.note) box.append(make('p', { className: 'gz-calc-note', textContent: m.why ? t("Glaze can't work out this course's overall grade: {why}.", { why: t(m.why) }) : t(m.note) }));
    if (m.kind !== 'unsupported') {
      const left = m.items.filter((i) => i.score == null && i.possible > 0);
      const out = make('p', { className: 'gz-calc-out' });
      out.setAttribute('aria-live', 'polite');
      const need = make('p', { className: 'gz-calc-out' });
      need.setAttribute('aria-live', 'polite');
      const target = make('input', { type: 'number', min: 0, max: 100, step: 'any', value: st.target, placeholder: '90' });
      target.setAttribute('aria-label', t('Target overall grade, in percent'));
      const clear = make('button', { type: 'button', className: 'gz-calc-clear', textContent: t('Clear scores') });
      const update = () => {
        clear.hidden = !st.overrides.size;
        const p = m.percent(st.overrides);
        out.textContent = st.overrides.size ? t('With those scores: {pct} overall.', { n: st.overrides.size, pct: asPct(p) }) : t(left.length ? 'Type a score to see where it would leave you.' : 'Everything here is graded.');
        const goal = parseFloat(st.target);
        if (!Number.isFinite(goal)) { need.textContent = ''; return; }
        const r = m.need(goal, st.overrides);
        need.textContent = !r.left ? t('Nothing left to change: {pct}.', { pct: asPct(p) })
          : r.reachable === false ? t('Out of reach: full marks on the {n} items left would make {pct}.', { n: r.left, pct: asPct(r.best) })
            : r.share === 0 ? t("You'd stay at {pct} or above even with zeros on what's left.", { pct: asPct(goal) })
              : t("You'd need about {pct} on each of the {n} items left.", { n: r.left, pct: asPct(Math.ceil(r.share * 1000) / 10) });
      };
      const rows = left.map((i) => {
        const input = make('input', { type: 'number', min: 0, step: 'any', value: st.overrides.get(i.id) ?? '', placeholder: '–' });
        input.setAttribute('aria-label', t('Score for {name}, out of {n}', { name: i.name, n: i.possible }));
        input.addEventListener('input', () => {
          const v = parseFloat(input.value);
          if (Number.isFinite(v) && v >= 0) st.overrides.set(i.id, v); else st.overrides.delete(i.id);
          keepCalc(cid, st.overrides);
          update();
        });
        return make('li', {}, make('span', { className: 'gz-calc-name', textContent: i.name }), make('span', { className: 'gz-calc-score' }, input, ` / ${GZ_I18N.num(i.possible, locale())}`));
      });
      target.addEventListener('input', () => { st.target = target.value; update(); });
      clear.addEventListener('click', () => {
        st.overrides.clear();
        keepCalc(cid, st.overrides);
        for (const r of rows) r.querySelector('input').value = '';
        update();
        rows[0].querySelector('input').focus(); // the button hides, so focus can't stay on it
      });
      if (rows.length) box.append(make('h3', { textContent: t('Not graded yet') }), make('ul', {}, ...rows));
      // The box sits where {target} is in the sentence.
      const [before, after] = t('Aim for {target}% overall').split('{target}');
      box.append(out, clear, make('label', { className: 'gz-calc-target' }, before, target, after), need);
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
    const ed = ultra && settings.enhance.drafts && observer && e.target instanceof Element && e.target.closest(EDITOR);
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
    msg.textContent = t('Glaze kept a copy of what you wrote here ({when}).', { when: GZ_PAGE.describe(new Date(d.at), true, new Date(), locale()).rel });
    // type=button: Ultra's editors sit in forms, where a plain button would submit.
    const button = (label, fn) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.addEventListener('click', () => { bar.remove(); fn(); });
      return b;
    };
    bar.append(msg, button(t('Restore'), () => {
      ed.focus();
      const r = document.createRange();
      r.selectNodeContents(ed);
      getSelection().removeAllRanges();
      getSelection().addRange(r);
      document.execCommand('insertHTML', false, d.html);
    }), button(t('Dismiss'), () => local((s) => s.remove(key))));
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
    if (!ultra) return;
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
    b.setAttribute('aria-label', j?.label || t('Download all'));
    b.toggleAttribute('data-busy', !!j && !j.done);
    b.toggleAttribute('data-job', !!j);
    b.style.setProperty('--gz-pct', `${j?.done ? 0 : j?.pct || 0}%`);
  };
  const download = async (fid, title) => {
    const cid = courseId();
    const ctl = new AbortController();
    const job = { ctl, label: t('Finding files · Cancel'), pct: 0 };
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
    const mb = (n) => new Intl.NumberFormat(GZ_I18N.locale(locale()), { style: 'unit', unit: 'megabyte', maximumFractionDigits: 0 }).format(n / 2 ** 20);
    const tooBig = (label) => Object.assign(new Error(label), { said: true });
    try {
      await walk(fid, '');
      const known = found.reduce((n, f) => n + (f.size || 0), 0);
      if (known > MAX_ZIP) throw tooBig(t('Too big: {size}, over {max}', { size: mb(known), max: mb(MAX_ZIP) }));
      const out = [];
      const taken = new Set();
      let bytes = 0;
      let failed = 0;
      for (const [i, f] of found.entries()) {
        say(t('{i} of {n} · Cancel', { i: i + 1, n: found.length }), (i / found.length) * 100);
        const r = await fetch(f.url, { credentials: 'same-origin', signal: ctl.signal }).catch((e) => { if (ctl.signal.aborted) throw e; return null; });
        if (!r?.ok) { failed += 1; continue; }
        const data = new Uint8Array(await r.arrayBuffer());
        bytes += data.length;
        if (bytes > MAX_ZIP) throw tooBig(t('Too big: over {max}', { max: mb(MAX_ZIP) }));
        out.push({ name: GZ_ZIP.unique(f.dir + GZ_ZIP.safeName(f.name), taken), data });
      }
      const left = skipped ? ` · ${t('{n} unopened left out', { n: skipped })}` : '';
      if (!out.length) return say((found.length ? t('Download failed') : t(skipped ? 'No files you have opened' : 'No files')) + left);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob(GZ_ZIP.zip(out), { type: 'application/zip' }));
      a.download = `${GZ_ZIP.safeName(title)}.zip`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 60000);
      say(t('Saved {n} files', { n: out.length }) + left + (failed ? ` · ${t('{n} failed', { n: failed })}` : ''));
    } catch (e) {
      say(ctl.signal.aborted ? t('Cancelled') : e.said ? e.message : t('Download failed'));
    } finally {
      job.done = true;
      paintDl(fid);
      setTimeout(() => { if (jobs.get(fid) === job) { jobs.delete(fid); paintDl(fid); } }, 6000);
    }
  };
  const syncDownloads = () => {
    if (!ultra) return;
    const on = settings.enhance.download && courseId();
    if (!on) { for (const b of document.querySelectorAll('.gz-dl')) b.remove(); return; }
    for (const item of document.querySelectorAll('.content-list-item[data-content-id]')) {
      const fid = item.dataset.contentId;
      // The item's own title comes first; an open folder's children follow it.
      if (!toggleOf(item) || document.getElementById(`gz-dl-${fid}`)) continue;
      const h3 = item.querySelector('h3');
      if (!h3) continue;
      const b = document.createElement('button');
      b.type = 'button';
      b.id = `gz-dl-${fid}`; // gz- ids are skipped by the sweep
      b.className = 'gz-dl';
      b.title = t("Download all: save this folder's files as one zip. Items you haven't opened are left out, so this never marks them viewed.");
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
  const PREVIEWS = ultra ? '#site-wrap :is(.js-file-viewer-inline-preview, [class*="fileViewerContainer"]) iframe' : '#doc_preview iframe, #file-preview-iframe, iframe.ef-file-preview-frame:not(.annotated-document-submission), .file_preview iframe';
  const DOC = ultra ? '#site-wrap .document-content-root' : '#wiki_page_show .show-content, #assignment_show .description';
  const UNFLIP = 'img, video, picture, canvas { filter: invert(1) hue-rotate(180deg); }';
  const framesShown = new Set();
  const framesSeen = new WeakSet();
  let docTools = null;
  let focusAt = null; // the document focus mode is on for
  let focusPath = '';
  let readBar = null;
  const unflip = (f) => {
    if (!ultra) return; // Canvas viewers may contain annotations: invert the frame, never reach inside.
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
  const ICONS = { dark: 'M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z', focus: 'M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5', paint: 'M12 3.5c3.4 4 6 7 6 10.2a6 6 0 0 1-12 0c0-3.2 2.6-6.2 6-10.2z' };
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
    let sc = ultra ? focusAt.parentElement : document.scrollingElement;
    if (!ultra) for (let p = focusAt.parentElement; p; p = p.parentElement) {
      if (/auto|scroll/.test(getComputedStyle(p).overflowY) && p.scrollHeight > p.clientHeight) { sc = p; break; }
    }
    // On <html>, outside the observed body: a style write on the bar would wake the sweep every scroll.
    setVar('--gz-read', GZ_PAGE.readShare(sc.scrollTop, sc.scrollHeight, sc.clientHeight));
  };
  const setFocus = (on) => {
    const doc = on && !(!ultra && document.querySelector('.ef-file-preview-overlay, #file-preview-modal-alert')) && document.querySelector(DOC);
    if ((doc || null) === focusAt) return;
    focusAt = doc || null;
    focusPath = focusAt ? location.pathname : '';
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
    if (!ultra) docTools?.querySelector('[data-gz="focus"]')?.focus({ preventScroll: true });
  };
  const setDark = (on) => {
    settings = { ...settings, enhance: { ...settings.enhance, darkDocs: on } };
    setAttr('data-gz-enhance-darkDocs', on);
    syncDocTools();
    try { chrome.storage.sync.set({ enhance: settings.enhance }); } catch { /* extension reloaded under the tab */ }
  };
  const syncDocTools = () => {
    const on = window.top === window && observer && settings.enhance.toggles;
    const doc = on && !(!ultra && document.querySelector('.ef-file-preview-overlay, #file-preview-modal-alert')) && document.querySelector(DOC);
    if (focusAt && (focusAt !== doc || focusPath !== location.pathname)) setFocus(false);
    if (!ultra && keysBox && keysBox.dataset.path !== location.pathname) closeKeys();
    for (const f of document.querySelectorAll(PREVIEWS)) {
      if (!framesSeen.has(f)) { framesSeen.add(f); frameIO.observe(f); f.addEventListener('load', () => unflip(f)); }
      unflip(f);
    }
    for (const f of framesShown) if (!f.isConnected) { framesShown.delete(f); frameIO.unobserve(f); }
    const visible = [...framesShown].find((f) => f.isConnected && f.getClientRects().length);
    const dark = on && darkTheme && !!visible;
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
      docTools.setAttribute('aria-label', t('Document'));
      const time = document.createElement('span');
      time.className = 'gz-doc-time';
      docTools.append(time, docButton('dark', t('Dark documents'), () => setDark(!settings.enhance.darkDocs)), docButton('focus', t('Focus mode'), () => setFocus(!focusAt)));
      document.body.append(docTools);
    }
    if (!ultra) {
      // In the reading flow (including a modal's flow), so neither content nor Canvas controls sit under it.
      const before = doc || visible?.closest('#doc_preview, .ef-file-preview-stretch, .file_preview') || visible;
      if (before && docTools.nextElementSibling !== before) before.before(docTools);
    }
    const [time, darkB, focusB] = docTools.children;
    const mins = focusAt && GZ_PAGE.readMinutes(ultra ? focusAt.querySelector('.bbml-editor')?.textContent : focusAt.textContent);
    time.hidden = !mins;
    // Only on change: a text write is itself a mutation the observer would hand back.
    const read = mins && t('{n} min read', { n: mins });
    if (mins && time.textContent !== read) time.textContent = read;
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
    if (e.key !== 'Escape' || !focusAt || (!ultra && typing(e.target)) || (e.target instanceof Element && e.target.closest('[role="menu"], [role="dialog"], [role="listbox"]'))) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    setFocus(false);
  }, true);

  // ---- keyboard shortcuts (Extras) ------------------------------------------------------------
  // "g" then a letter goes somewhere, "/" searches, "?" lists them. Never while typing, never with
  // a modifier, top frame only.
  const GO = ultra ? { c: ['/ultra/course', 'Courses'], a: ['/ultra/calendar', 'Calendar'], g: ['/ultra/grades', 'Grades'], m: ['/ultra/messages', 'Messages'], s: ['/ultra/stream', 'Activity stream'] } : { d: ['/', 'Dashboard'], c: ['/courses', 'Courses'], a: ['/calendar', 'Calendar'], g: ['/grades', 'Grades'], m: ['/conversations', 'Inbox'] };
  let gAt = 0;
  let keysBox = null;
  let keysBack = null;
  const closeKeys = () => { keysBox?.remove(); keysBox = null; if (!ultra && keysBack?.isConnected) keysBack.focus({ preventScroll: true }); keysBack = null; };
  const openKeys = () => {
    keysBox = document.createElement('div');
    keysBox.id = 'gz-keys';
    keysBox.dataset.path = location.pathname;
    keysBox.setAttribute('role', 'dialog');
    keysBox.setAttribute('aria-label', t('Keyboard shortcuts'));
    const h = document.createElement('h2');
    h.textContent = t('Keyboard shortcuts');
    const dl = document.createElement('dl');
    const row = (keys, what) => {
      const dt = document.createElement('dt');
      for (const k of keys) { const kbd = document.createElement('kbd'); kbd.textContent = k; dt.append(kbd); }
      const dd = document.createElement('dd');
      dd.textContent = what;
      dl.append(dt, dd);
    };
    for (const [k, [, label]] of Object.entries(GO)) row(['g', k], t(label));
    if (ultra) row(['/'], t('Search'));
    if (settings.enhance.palette) row([/Mac/.test(navigator.platform) ? '⌘' : 'Ctrl', 'K'], t('Go to anything'));
    row(ultra ? ['?'] : ['g', '?'], t('Show or hide this list'));
    const panel = document.createElement('div');
    panel.className = 'gz-keys-panel';
    panel.append(h, dl);
    if (!ultra) {
      const b = document.createElement('button');
      b.type = 'button'; b.textContent = t('Dismiss'); b.addEventListener('click', closeKeys); panel.append(b);
      keysBox.setAttribute('aria-modal', 'true');
      keysBox.addEventListener('keydown', (e) => { if (e.key === 'Tab') { e.preventDefault(); b.focus(); } });
      keysBack = document.activeElement;
    }
    keysBox.append(panel);
    keysBox.addEventListener('click', (e) => { if (e.target === keysBox) closeKeys(); });
    document.body.append(keysBox);
    if (!ultra) keysBox.querySelector('button').focus();
  };
  const typing = (el) => el instanceof Element && (el.isContentEditable || !!el.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])'));
  if (window.top === window) {
    document.addEventListener('keydown', (e) => {
      if (!ultra && e.key === 'Escape' && keysBox && !typing(e.target)) { e.preventDefault(); closeKeys(); return; }
      if (!ultra && e.key === 'Shift') return; // g then Shift+? must keep its prefix.
      if (!settings.enhance.keys || !observer || e.metaKey || e.ctrlKey || e.altKey || typing(e.target) || (!ultra && (e.defaultPrevented || e.repeat || !GZ_PAGE.canvasKeys(location.pathname) || e.target.closest?.('[role="dialog"]:not(#gz-keys), [role="menu"], [role="listbox"], [role="grid"]')))) { gAt = 0; return; }
      if (e.key === 'Escape' && keysBox) { closeKeys(); return; }
      if (!ultra && Date.now() - gAt < 1200 && e.key === '?') {
        e.preventDefault(); e.stopImmediatePropagation(); gAt = 0;
        if (keysBox) closeKeys(); else openKeys();
        return;
      }
      if (Date.now() - gAt < 1200 && GO[e.key]) {
        e.preventDefault();
        gAt = 0;
        location.assign(location.origin + GO[e.key][0]);
        return;
      }
      gAt = e.key === 'g' ? Date.now() : 0;
      if (!ultra) return; // Canvas owns both / and its global ? help dialog.
      if (e.key === '/') {
        // By Ultra's ids (courses-overview-filter-search, search-button…), which no language changes.
        const target = [...document.querySelectorAll('input[type="search"], :is(input, button)[id*="search" i]')].find((el) => el.offsetWidth > 0);
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

  // ---- command palette (Extras; Canvas too) --------------------------------------------------
  // Ctrl+K (⌘K on a Mac) opens one search over Blackboard's pages, your courses, this course's tabs
  // and items, and Glaze's own switches. Never while typing (Ultra's editor uses Ctrl+K for links),
  // top frame only. Courses and items are asked of Ultra's own APIs once per page, when it first opens.
  // On Canvas it searches Canvas's pages, your courses, this course's tabs, what is due and Glaze's switches.
  const TOOLS = [['/ultra/course', 'Courses'], ['/ultra/calendar', 'Calendar'], ['/ultra/grades', 'Grades'], ['/ultra/messages', 'Messages'],
    ['/ultra/stream', 'Activity stream'], ['/ultra/organizations', 'Organizations'], ['/ultra/profile', 'Profile'], ['/ultra/tools', 'Tools']];
  const EXTRAS = { urgency: 'Due-date urgency', clamp: 'Shorter descriptions', scores: 'Score bars', reading: 'Reading width', inline: 'Due-date status and percentages',
    previews: 'Folder previews', progress: 'Course progress', keys: 'Keyboard shortcuts', newgrades: 'New-grade badges', newcontent: 'New-content badges', calc: 'What-if calculator', coursemenu: 'Course menu' };
  // Canvas's global navigation, and the one extra there is to switch (the palette itself isn't listed, as on Ultra).
  const CANVAS_TOOLS = [['/', 'Dashboard'], ['/calendar', 'Calendar'], ['/conversations', 'Inbox'], ['/grades', 'Grades']];
  const CANVAS_EXTRAS = { overall: 'Grades on course cards' };
  // A path on this site, or a full address (a Canvas tab can be another site's, an external tool's): web pages only.
  const go = (url) => () => {
    let u;
    try { u = new URL(url, location.origin); } catch { return; }
    if (u.protocol === 'https:' || u.protocol === 'http:') location.assign(u.href);
  };
  const pages = () => (ultra ? TOOLS : CANVAS_TOOLS).map(([path, label]) => ({ label: t(label), hint: ultra ? 'Blackboard' : 'Canvas', group: 'Go to', run: go(path) }));
  const store = (patch) => () => { try { chrome.storage.sync.set({ version: 2, ...patch }); } catch { /* extension reloaded under the tab */ } };
  const paletteItems = (cid) => courseItems(cid).p.then((all) => {
    const title = new Map(all.map((c) => [c.id, c.title]));
    return all.filter((c) => c.links?.[0]?.href).map((c) => ({ label: c.title, hint: title.get(c.parentId) || '', group: 'In this course', run: go(c.links[0].href.replace(/^https?:\/\/[^/]+/, '')) }));
  });
  // The due items, "in 2 days · Thu 11:59 PM · ENG1001", each opening its item: on Canvas at its own address, on Ultra
  // at the address the content API gives it (as "In this course" does), or its course when it has none.
  const dueCmds = (due) => {
    const now = new Date();
    const lang = GZ_I18N.locale(locale());
    return due.filter((d) => d.due >= now).map((d) => ({ label: d.title, hint: [GZ_PAGE.describe(new Date(d.due), true, now, lang).rel, new Date(d.due).toLocaleString(lang, { weekday: 'short', hour: 'numeric', minute: '2-digit' }), nickOf(d.cid) || d.course || courseList[d.cid]?.name].filter(Boolean).join(' · '), group: 'Due this week',
      run: d.url ? go(d.url) : () => (d.content ? courseItems(d.cid).p : Promise.resolve([])).then((all) => go(all.find((c) => c.id === d.content)?.links?.[0]?.href.replace(/^https?:\/\/[^/]+/, '') || `/ultra/courses/${d.cid}/outline`)()) }));
  };
  // Glaze's own switches, the same on both sites but for the extras.
  const glazeCmds = () => {
    const s = settings;
    return [
      ...GZ_LOOKS.map((L) => ({ label: t('Look: {name}', { name: L.name }), hint: GZ_LOOK_ON(s, L) ? t('Current') : 'Glaze', group: 'Glaze', run: store(GZ_LOOK_APPLY(s, L)) })),
      ...GZ_ALL_PRESETS(s.presets).map(([name, colors]) => ({ label: t('Palette: {name}', { name }), hint: s.preset === name && !s.auto.on ? t('Current') : 'Glaze', group: 'Glaze', run: store({ colors, preset: name, auto: { ...s.auto, on: false } }) })),
      ...['off', 'subtle', 'expressive'].map((level) => ({ label: t('Motion: {level}', { level: t(`${level[0].toUpperCase()}${level.slice(1)}`) }), hint: s.motion.level === level ? t('Current') : 'Glaze', group: 'Glaze', run: store({ motion: { ...s.motion, level } }) })),
      ...Object.entries(ultra ? EXTRAS : CANVAS_EXTRAS).map(([k, label]) => ({ label: t(s.enhance[k] ? 'Turn off {name|lower}' : 'Turn on {name|lower}', { name: t(label) }), hint: t('Glaze extra'), group: 'Glaze', run: store({ enhance: { ...s.enhance, [k]: !s.enhance[k] } }) })),
      { label: t('Turn the theme off'), hint: 'Glaze', group: 'Glaze', run: store({ enabled: false }) },
      { label: t('Glaze settings'), hint: t('Opens the editor'), group: 'Glaze', run: () => { try { Promise.resolve(chrome.runtime.sendMessage('options')).catch(() => {}); } catch { /* extension reloaded under the tab */ } } },
    ];
  };
  // On Canvas: its pages, this course's tabs, your courses and what is due. Each is a plain page load.
  const canvasCommands = async () => {
    const cid = canvasCourseId();
    const [courses, tabs, due] = await Promise.all([canvasCourses(), cid ? capi(`/courses/${cid}/tabs`).catch(() => []) : [], dueWeek()]);
    return [
      ...tabs.filter((x) => x.label && !x.hidden).map((x) => ({ label: x.label, hint: t('This course'), group: 'Go to', run: go(x.html_url) })),
      ...pages(),
      ...courses.filter((c) => c.name).map((c) => ({ label: c.friendly_name || c.name, hint: c.course_code || t('Course'), group: 'Courses', run: go(`/courses/${c.id}`) })),
      ...dueCmds(due),
      ...glazeCmds(),
    ];
  };
  // Everything the palette can do, built when it opens.
  const commands = async () => {
    if (!ultra) return canvasCommands();
    const cid = courseId();
    // A tab's name without its count badge ("Announcements 12").
    const tabName = (a) => { const c = a.cloneNode(true); for (const b of c.querySelectorAll('[class*="badge" i]')) b.remove(); return c.textContent.trim(); };
    const here = cid ? [...document.querySelectorAll('.bb-ui-navigation-list-horizontal a[href]')].map((a) => ({ label: tabName(a), hint: t('This course'), group: 'Go to', run: () => a.click() })).filter((c) => c.label) : [];
    const [courses, items, due] = await Promise.all([myCourses(), cid ? paletteItems(cid) : [], dueWeek()]);
    return [
      ...here,
      ...pages(),
      ...courses.filter((m) => m.course).sort((a, b) => !!a.course.isClosed - !!b.course.isClosed)
        .map((m) => ({
          label: nickOf(m.courseId) || m.course.name,
          // A nickname's hint is the real name, so searching either finds it.
          hint: [nickOf(m.courseId) && m.course.name, m.course.isOrganization ? t('Organization') : m.course.isClosed ? t('Closed course') : m.course.courseId || t('Course')].filter(Boolean).join(' · '),
          group: 'Courses',
          run: go(`/ultra/courses/${m.courseId}/outline`),
        })),
      ...dueCmds(due),
      ...items,
      ...glazeCmds(),
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
      hint.textContent = c.hint && c.hint !== c.group ? `${t(c.group)} · ${c.hint}` : t(c.group);
      li.append(label, hint);
      li.addEventListener('pointermove', () => { if (cmd.active !== i) { cmd.active = i; mark(); } });
      li.addEventListener('click', () => runCmd(i));
      return li;
    }));
    if (!cmd.shown.length) cmd.list.append(Object.assign(document.createElement('li'), { className: 'gz-cmd-empty', textContent: t(cmd.loading ? 'Loading…' : 'Nothing matches.') }));
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
    panel.setAttribute('aria-label', t('Go to'));
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = t('Go to a course, an item, a page or a Glaze setting…');
    input.autocomplete = 'off';
    input.spellcheck = false;
    for (const [k, v] of [['role', 'combobox'], ['aria-expanded', 'true'], ['aria-controls', 'gz-cmd-list'], ['aria-autocomplete', 'list'], ['aria-label', t('Go to')]]) input.setAttribute(k, v);
    const list = document.createElement('ul');
    list.id = 'gz-cmd-list';
    list.setAttribute('role', 'listbox');
    list.setAttribute('aria-label', t('Results'));
    const foot = document.createElement('p');
    foot.className = 'gz-cmd-foot';
    foot.textContent = t('↑ ↓ to choose · Enter to go · Esc to close');
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
    cmd.all = pages();

    showCmd();
    commands().then((all) => { if (cmd !== mine) return; cmd.all = all; cmd.loading = false; showCmd(); });
  };
  if (window.top === window) {
    document.addEventListener('keydown', (e) => {
      if (e.key?.toLowerCase() !== 'k' || !(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey || !settings.enhance.palette || !observer) return;
      // Stopped, as when opening: the search box (focused, now gone) would otherwise answer it with no palette left.
      if (cmd) { e.preventDefault(); e.stopPropagation(); closeCmd(); return; }
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
  if (ultra && window.top === window && document.startViewTransition) {
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
  // LAYERS is Ultra's; Canvas has no layer picked yet, so its scene goes in the body (canvas.css places it).
  const placeScene = () => {
    if (!sceneCanvas) return;
    const home = (ultra && [...document.querySelectorAll(LAYERS)].filter((e) => e.getClientRects().length).pop()) || document.body;
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
    const { dim, amount, pace } = GZ_SCENE_LOOK(worn.bg.intensity);
    return {
      name: worn.bg.scene,
      ground: palette['--gz-surface-2'],
      colors: GZ_BG_COLORS(worn.bg.colors, palette),
      dim,
      amount,
      speed: pace * ({ off: 0, expressive: 1.6 }[html.getAttribute('data-gz-motion')] ?? 1),
    };
  };
  const syncScene = () => {
    if (!settings.enabled || !links.length || worn.bg.kind !== 'scene' || !sceneFrame || sceneFailed || !document.body) return stopScene();
    if (scene) return scene.update(sceneOpts());
    sceneLoad ||= import(chrome.runtime.getURL('lib/scene.js'));
    sceneLoad.then((mod) => {
      if (scene || !links.length || worn.bg.kind !== 'scene') return;
      sceneCanvas = document.createElement('canvas');
      sceneCanvas.id = 'gz-scene';
      sceneCanvas.setAttribute('aria-hidden', 'true');
      placeScene();
      scene = mod.start(sceneCanvas);
      scene.update(sceneOpts());
    }).catch(() => { sceneFailed = true; stopScene(); });
  };

  // ---- course colors and tint ------------------------------------------------------------------
  // Every course its own color (GZ_COURSE_COLORS), worked out from the course list recordCourses
  // keeps. Inside a course picked in the editor, the palette also leans toward it (GZ_TINT). A
  // course's own pages carry its color slot on the course section; its item pages carry nothing, so
  // the slot is remembered per course id, on this device. flush() re-checks on every page change.
  const COURSE = 'section.course[class*="course-color-"]';
  const courseSlots = {};
  let courseList = {};
  const courseColors = () => GZ_COURSE_COLORS(courseList, settings.courses.colors);
  try {
    chrome.storage.local.get(['courseSlots', 'seenCourses'], (r) => {
      Object.assign(courseSlots, r?.courseSlots);
      courseList = r?.seenCourses || {};
      reapply();
    });
  } catch { /* extension reloaded under the tab */ }
  // A course's own color on everything of it Glaze can tell is it: a course's section, a Messages card
  // (data-course-id), a Grades row (a link into the course), anything on the course's own pages, a
  // calendar entry by its title (calendarCourse).
  const courseOf = (el) => el.getAttribute('bb-course-membership-markups') || el.closest('[data-course-id]')?.dataset.courseId
    || (el.closest('a[href*="/courses/_"]') || el.querySelector('a[href*="/courses/_"]'))?.getAttribute('href').match(/\/courses\/(_\d+_\d+)/)?.[1]
    || courseId() || calendarCourse(el);
  // Calendar entries name no course: on the calendar, an entry is the course's whose item title it shows,
  // when no other course sharing its slot has an item by that title (GZ_CAL_COURSE); otherwise it keeps
  // its slot's color. The items are the calendar's own list, asked for once a page load.
  // ponytail: six weeks back to ten on; entries outside that keep their slot's color.
  let calItems = null;
  const calendarCourse = (el) => {
    if (!location.pathname.startsWith('/ultra/calendar')) return null;
    if (!calItems) {
      calItems = [];
      const at = (days) => new Date(Date.now() + days * 864e5).toISOString();
      api(`/calendars/calendarItems?since=${at(-42)}&until=${at(70)}`).then((j) => { calItems = j.results || []; paintCourses(); }, () => {});
    }
    return GZ_CAL_COURSE(el.textContent, el.className.match?.(/course-color-(\d+)/)?.[1], calItems, courseList);
  };
  const paintCourses = () => {
    if (!ultra) {
      const changed = {};
      // A native color edit repaints the hero before a new API request would see it.
      for (const card of document.querySelectorAll('.ic-DashboardCard')) {
        const id = card.querySelector('a[href*="/courses/"]')?.getAttribute('href').match(/\/courses\/(\d+)/)?.[1];
        const c = courseList[canvasCourseKey(id)];
        const raw = C.parse(card.querySelector('.ic-DashboardCard__header_hero')?.style.backgroundColor || '');
        if (c && raw && c.color !== C.hex(raw)) { c.color = C.hex(raw); changed[canvasCourseKey(id)] = c; }
      }
      if (Object.keys(changed).length) try { chrome.storage.local.get('seenCourses', (r) => chrome.storage.local.set({ seenCourses: { ...r?.seenCourses, ...changed } })); } catch { /* reloaded */ }
      const cid = canvasCourseKey();
      const targets = new Map();
      if (cid) for (const el of document.querySelectorAll('#breadcrumbs li:nth-child(2), #section-tabs')) targets.set(el, cid);
      // Calendar and dashboard colors are native; Grades links and Inbox course labels have no color.
      if (location.pathname === '/grades') for (const el of document.querySelectorAll('#content a[href*="/courses/"]')) {
        targets.set(el, canvasCourseKey(el.getAttribute('href').match(/\/courses\/(\d+)/)?.[1]));
      }
      if (location.pathname === '/conversations') {
        const list = Object.entries(courseList).filter(([id, c]) => id.startsWith(`canvas:${location.origin}/`) && c.color);
        // MessageDetailItem’s second header field is the native context label, not the message body.
        // Canvas supplies only its name; ambiguous names keep Canvas’s own styling.
        for (const el of document.querySelectorAll('[data-testid^="message-detail-item-"] > :nth-child(2) > :first-child > :nth-child(2) > span')) {
          if (el.children.length) continue;
          const matches = list.filter(([, c]) => [c.name, c.code].includes(el.textContent.trim()));
          if (matches.length === 1) targets.set(el, matches[0][0]);
        }
      }
      for (const el of document.querySelectorAll('[data-gz-course-color]')) if (!targets.has(el) || !courseList[targets.get(el)]?.color) {
        el.removeAttribute('data-gz-course-color');
        el.style.removeProperty('--gz-course-raw');
      }
      for (const [el, id] of targets) {
        const color = courseList[id]?.color;
        if (!color) continue;
        if (el.style.getPropertyValue('--gz-course-raw') !== color) el.style.setProperty('--gz-course-raw', color);
        if (!el.hasAttribute('data-gz-course-color')) el.setAttribute('data-gz-course-color', '');
      }
      return;
    }
    if (isPreview) return;
    const colors = courseColors();
    for (const el of document.querySelectorAll('[class*="course-color-"]')) {
      const v = GZ_COURSE_VARS(colors[courseOf(el)]);
      for (const k of ['--gz-pick', '--gz-course-raw']) {
        if (el.style.getPropertyValue(k) === (v[k] || '')) continue;
        if (v[k]) el.style.setProperty(k, v[k]);
        else el.style.removeProperty(k);
      }
    }
  };
  const varText = (v) => Object.entries(v).map(([k, x]) => `${k}:${x}`).join(';');
  // The course tinting the page now, as { key, slot, vars }, or null.
  const tintOf = () => {
    if (!ultra) {
      const id = canvasCourseKey();
      const color = courseList[id]?.color;
      return color && settings.courses.tint && settings.courses.tinted.includes(id) && chrome.runtime?.id ? { key: `${id};${color}`, color } : null;
    }
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
    // Cut off by a reload or update of Glaze (no runtime id), ticks since removed never arrive: no tint.
    if (!tint || !chrome.runtime?.id) return null;
    // The editor's preview is its first ticked course: the section carries that course's slot and color.
    if (!cid) return isPreview && slot && picked.length ? { key: `${slot};${sec.style.cssText}`, slot, vars: sec.style.cssText } : null;
    // Ticked by id; a slot number is a tick from before each course had its own.
    const now = courseSlots[cid];
    return now && (picked.includes(cid) || picked.includes(now)) ? { key: cid, slot: now, vars: varText(GZ_COURSE_VARS(courseColors()[cid])) } : null;
  };
  const tintKey = () => tintOf()?.key || null;
  // The color the Course colors section already resolves (--gz-course: a pick, toned or raw), read
  // off a hidden probe on <html>, outside the observed body. Null until theme.css has loaded.
  const courseColor = (slot, vars = '') => {
    const p = document.createElement('i');
    p.className = `course-color-${slot}`;
    p.style.cssText = `${vars};display:none;color:color-mix(in srgb, var(--gz-course, transparent) 100%, transparent)`;
    html.append(p);
    const c = C.parse(getComputedStyle(p).color);
    p.remove();
    return c?.a ? C.hex(c) : null;
  };
  let tinted = null; // the key of the course whose color is painted now
  let palette = GZ_DEFAULTS.colors; // the colors painted, tint included
  // A course given a look of its own wears it on its pages (GZ_COURSE_LOOK); flush() re-checks. Once
  // Glaze is reloaded or updated under the tab, this script is cut off from storage (no runtime id) and
  // would keep switching to looks since removed: it wears none until the page loads again.
  const lookHere = () => (chrome.runtime?.id && settings.courses.looks[ultra ? courseId() : canvasCourseKey()]) || null;
  let looked = null; // the course look painted now
  let worn = settings; // the settings painted now: the student's, or a course's look over them

  // ---- course menu (Extras) ----------------------------------------------------------------------
  // Ultra's Courses page: each course card gets a small button in its corner that opens a popover with the
  // course's nickname, color, tint and look. That is the editor's course row (options.js renderCourses) written to
  // the same settings.courses keys, so the card and the editor always agree, and every card and page repaints from
  // settings as it does after an edit made there. The popover lives in <body>, not in the card: a press in it can't
  // reach the card (a link) behind it. Ultra only, top frame only; off with the Extras switch (nicknames with it).
  const CARD = COURSE_CARDS[0][0];
  // Ultra's course-color-1…10 in order, by hue, for the swatches' names.
  const TONES = ['Purple', 'Cyan', 'Yellow', 'Orange', 'Mint', 'Pink', 'Green', 'Teal', 'Magenta', 'Blue'];
  let menu = null; // { box, btn, cid, nick, edited, note, custom, reset, tint, grid, sw, looks } while the popover is open

  // The nickname given to a course, while the Extra is on; '' for none. Only Glaze's own surfaces and the page's
  // course names call this: Blackboard's real name is always the course list's (recordCourses), never the page's.
  const nickOf = (cid) => (ultra && observer && settings.enhance.coursemenu && settings.courses.names[cid]) || '';

  // -- edits: painted here at once, saved a moment later --
  // Each edit is kept by what it changes and applied again to the settings at save time, so one that an echo of an
  // earlier save (or another tab) overwrote in between still goes out, and a color dragged for a second is one write
  // (sync storage allows ~120 a minute).
  const edits = new Map();
  let editTimer = 0;
  // Roll back only our still-current batch; a newer value from another tab wins.
  let editStored = null;
  let editCourses = null;
  const refuseEdits = () => {
    edits.clear();
    const restore = settings.courses === editCourses;
    if (restore) settings = { ...settings, courses: editStored };
    editCourses = null;
    if (restore) applySettings();
    menuNote(t('Too much to sync. Shorten a nickname or clear one.'));
    if (menu) paintMenu();
    return false;
  };
  const saveEdits = () => {
    clearTimeout(editTimer);
    editTimer = 0;
    if (!edits.size) return true;
    const c = structuredClone(settings.courses);
    for (const fn of edits.values()) fn(c);
    if (GZ_SYNC_BYTES('courses', c) > GZ_SYNC_ITEM_MAX) return refuseEdits();
    edits.clear();
    editCourses = null;
    try {
      chrome.storage.sync.set({ version: 2, courses: c }, () => { if (chrome.runtime.lastError) menuNote(t('Not saved. Try again in a moment.')); });
    } catch { /* extension reloaded under the tab */ }
    return true;
  };
  // An edit that would take the courses item past what sync storage keeps (8 KB) is refused, said in the menu,
  // and leaves the page as it was: false.
  const editCourse = (key, fn, soon = false) => {
    const c = structuredClone(settings.courses);
    for (const edit of edits.values()) edit(c);
    fn(c);
    if (GZ_SYNC_BYTES('courses', c) > GZ_SYNC_ITEM_MAX) return refuseEdits();
    menuNote('');
    if (settings.courses !== editCourses) editStored = settings.courses;
    editCourses = c;
    settings = { ...settings, courses: c };
    applySettings();
    edits.set(key, fn);
    clearTimeout(editTimer);
    if (soon) { editTimer = setTimeout(saveEdits, 500); return true; }
    return saveEdits();
  };
  // A short line in the open menu, read out when it changes; '' clears it.
  const menuNote = (text) => { if (menu) { menu.note.textContent = text; menu.note.hidden = !text; } };
  addEventListener('pagehide', saveEdits);

  // -- nicknames: swapped into the page's own text, and put back exactly --
  // Where Ultra writes a course's name: [selector, course id of a match, the element holding the name, whether the
  // name is only one text among others there]. A card's title is the name, so its first text is swapped; the course's
  // header and a breadcrumb hold other text too, so there only a text that is the course's name is.
  // ponytail: the header and breadcrumb selectors are guesses at Ultra's markup (the cards' are COURSE_CARDS');
  // check them on a real site, and add a surface by adding a row.
  const NAME_AT = [
    ...COURSE_CARDS.map(([sel, idOf, where]) => [sel, idOf, where, false]),
    ['course-page-header > header', () => courseId(), (e) => e, true],
    ['[class*="readcrumb"]', () => courseId(), (e) => e, true],
  ];
  // The swapped text's parent keeps what Ultra wrote (data-gz-real), what Glaze wrote over it (data-gz-nick) and
  // whose name it is (data-gz-cid), and the real name as a tooltip unless the element has a title of its own
  // (data-gz-titled). Putting it back is exact; a text Ultra has since rewritten is left as Ultra wrote it.
  const unname = (p) => {
    const mine = [...p.childNodes].find((n) => n.nodeType === 3 && n.data === p.dataset.gzNick);
    if (mine) mine.data = p.dataset.gzReal;
    if (p.dataset.gzTitled !== undefined) p.removeAttribute('title');
    for (const k of ['gzReal', 'gzNick', 'gzCid', 'gzTitled']) delete p.dataset[k];
  };
  const paintName = (scope, cid, exact) => {
    const nick = nickOf(cid);
    const real = courseList[cid]?.name;
    const walk = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (!n.data.trim() || n.parentElement?.closest('.gz-new, .gz-cm-btn') ? 3 : 1) });
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      const p = n.parentElement;
      const was = p.dataset.gzReal;
      if (was === undefined) {
        // Nothing swapped here yet.
        if (!nick || !real || (exact && n.data.replace(/\s+/g, ' ').trim() !== real)) continue;
        p.dataset.gzReal = n.data;
        p.dataset.gzCid = cid;
        if (!p.hasAttribute('title') && p.dataset.gzTitle === undefined) { p.title = real; p.dataset.gzTitled = ''; }
      } else if (n.data !== was && n.data !== p.dataset.gzNick) continue; // another text of this element
      if (!nick) unname(p);
      else {
        if (n.data !== nick) n.data = nick;
        p.dataset.gzNick = nick;
      }
      if (!exact) break;
    }
  };
  // Run with the flush: Ultra draws cards and headers again as it likes, and this puts the nicknames back.
  const syncNames = () => {
    if (!document.querySelector('[data-gz-real]') && !Object.keys(settings.courses.names).length) return;
    for (const [sel, idOf, where, exact] of NAME_AT) {
      for (const el of document.querySelectorAll(sel)) {
        const cid = idOf(el);
        const at = cid && where(el);
        if (at) paintName(at, cid, exact);
      }
    }
    // What is still swapped whose nickname is gone or off (or whose element Ultra moved out of reach).
    for (const p of document.querySelectorAll('[data-gz-real]')) if (!nickOf(p.dataset.gzCid)) unname(p);
  };

  // -- the button on each card --
  const syncCourseMenu = () => {
    const on = !!observer && settings.enhance.coursemenu && window.top === window && !isPreview;
    for (const card of document.querySelectorAll(ultra ? CARD : '.ic-DashboardCard')) {
      const cid = ultra ? (card.dataset.courseId || card.id.slice(19)) : canvasCourseKey(card.querySelector('a[href*="/courses/"]')?.getAttribute('href').match(/\/courses\/(\d+)/)?.[1]);
      let b = card.querySelector(':scope > .gz-cm-btn');
      if (b && (!on || b.dataset.cid !== cid || !courseList[cid])) { b.remove(); b = null; }
      if (!on || !courseList[cid]) continue;
      const label = t(ultra ? 'Colour and look for {name}' : 'Tint and look for {name}', { name: nickOf(cid) || courseList[cid].name });
      if (!b) {
        // Inside Ultra's card, positioned over its corner (extras.css); document-level capture listeners take
        // its events, below.
        b = docButton('paint', label, () => {});
        b.className = 'gz-cm-btn';
        b.id = `gz-cm-${cid}`; // gz- ids are skipped by the sweep
        b.dataset.cid = cid;
        b.setAttribute('aria-haspopup', 'dialog');
        b.setAttribute('aria-expanded', String(menu?.cid === cid));
        card.append(b);
      } else if (b.getAttribute('aria-label') !== label) {
        b.setAttribute('aria-label', label);
        // While the pointer is on it, its title is in the tooltip (onTip).
        if (b.dataset.gzTitle !== undefined) b.dataset.gzTitle = label; else b.title = label;
      }
    }
    // The popover goes with its card: gone, hidden, or the extra switched off.
    if (menu && !menu.btn.isConnected) {
      const again = document.getElementById(`gz-cm-${menu.cid}`); // a card Ultra drew again
      if (again) menu.btn = again; else closeMenu(false, true);
    }
    if (menu && (!on || !menu.btn.getClientRects().length)) closeMenu(false, true);
    if (menu) paintMenu();
    if (ultra) syncNames();
  };
  // Nothing of the extra left on the page: the theme or the extra is off.
  const unmenu = () => {
    closeMenu(false, true);
    for (const b of document.querySelectorAll('.gz-cm-btn')) b.remove();
    for (const p of document.querySelectorAll('[data-gz-real]')) unname(p);
  };

  // -- the popover --
  const swatches = () => [
    ...TONES.map((name, i) => [name, courseColor(String(i + 1), '--gz-pick:initial') || GZ_SLOT_COLORS[i + 1]]),
    ['Accent', GZ_ACTIVE_COLORS(settings, darkMQ.matches)['--gz-accent']],
  ];
  // Everything that follows the settings: what is picked, ticked and worn.
  const paintMenu = (m = menu) => {
    const { cid } = m;
    const c = settings.courses;
    m.tint.checked = GZ_COURSE_TINTED(c, cid, courseList);
    for (const b of m.looks) b.setAttribute('aria-pressed', String((c.looks[cid] || '') === b.dataset.look));
    if (!ultra) return;
    const cur = courseColors()[cid];
    if (!cur) return;
    // The color the cards show for it now (a pick as is, else Ultra's toned): the custom picker starts there.
    const now = courseColor(courseList[cid].slot, varText(GZ_COURSE_VARS(cur))) || cur.color;
    for (const b of m.sw) b.setAttribute('aria-pressed', String(cur.picked && C.same(C.parse(b.dataset.hex), C.parse(cur.color))));
    m.custom.toggleAttribute('data-on', cur.picked && !m.sw.some((b) => b.getAttribute('aria-pressed') === 'true'));
    if (m.custom.value !== now) m.custom.value = now; // not while it is being dragged to the same
    // The nickname as kept, unless the student is changing it: another tab's save shows here, and isn't undone.
    if (!m.edited && m.nick.value !== (c.names[cid] || '')) m.nick.value = c.names[cid] || '';
    m.reset.hidden = !cur.picked;
  };
  const placeMenu = () => {
    if (!menu) return;
    const { box, btn } = menu;
    const r = btn.getBoundingClientRect();
    if (r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) return closeMenu(false, true);
    const w = box.offsetWidth;
    const h = box.offsetHeight;
    let top = r.bottom + 6;
    if (top + h > innerHeight - 8) top = r.top - h - 6; // above, when there is no room below
    box.style.left = `${Math.min(Math.max(8, r.right - w), innerWidth - w - 8)}px`;
    box.style.top = `${Math.min(Math.max(8, top), Math.max(8, innerHeight - h - 8))}px`;
    box.style.setProperty('--gz-cm-origin', top < r.top ? 'bottom right' : 'top right');
  };
  // One tab stop per group; arrow keys walk it.
  const rove = (group, active) => { for (const b of group.querySelectorAll('button, input')) b.tabIndex = b === active ? 0 : -1; };
  // Only what the student typed: an untouched field may be behind a nickname saved elsewhere since. One that doesn't
  // fit stays in the field, still theirs to shorten, with the menu's note saying why.
  const commitNick = (m = menu) => {
    if (!m?.edited) return true;
    const v = m.nick.value;
    const was = settings.courses.names[m.cid] || '';
    const c = structuredClone(settings.courses);
    GZ_COURSE_EDIT.name(c, m.cid, v);
    if ((c.names[m.cid] || '') !== was && !editCourse(`name ${m.cid}`, (x) => GZ_COURSE_EDIT.name(x, m.cid, v))) return false;
    m.edited = false;
    m.nick.value = settings.courses.names[m.cid] || ''; // as kept: one trimmed line
    return true;
  };
  const closeMenu = (refocus = true, teardown = false) => {
    const m = menu;
    if (!m) return true;
    if (teardown) menu = null; // no dialog to keep when its card or the extra has gone
    if ((!commitNick(m) || !saveEdits()) && !teardown) return false;
    menu = null;
    m.box.remove();
    m.btn.setAttribute('aria-expanded', 'false');
    if (refocus && m.btn.isConnected) m.btn.focus({ preventScroll: true });
    return true;
  };
  const openMenu = (btn) => {
    const cid = btn.dataset.cid;
    const real = courseList[cid]?.name;
    if (!real) return;
    if (!closeMenu(false)) return;
    const name = nickOf(cid) || real;
    const box = make('div', { id: 'gz-cm' });
    for (const [k, v] of [['role', 'dialog'], ['aria-modal', 'true'], ['aria-label', t(ultra ? 'Colour and look for {name}' : 'Tint and look for {name}', { name })]]) box.setAttribute(k, v);
    const cap = (text, id) => make('div', { className: 'gz-cm-cap', id, textContent: text });
    const group = (labelledby, ...kids) => {
      const g = make('div', {}, ...kids);
      g.setAttribute('role', 'group');
      g.setAttribute('aria-labelledby', labelledby);
      g.dataset.roving = '';
      return g;
    };

    // The nickname: what the field shows empty is the real name. Saved on Enter, on leaving it, and on closing.
    const nick = make('input', { type: 'text', id: 'gz-cm-nick', className: 'gz-cm-nick', maxLength: GZ_NICK_MAX, placeholder: real, title: real, value: settings.courses.names[cid] || '', autocomplete: 'off', spellcheck: false });
    nick.addEventListener('input', () => { if (menu?.nick === nick) menu.edited = true; });
    nick.addEventListener('change', () => commitNick());
    const note = make('p', { className: 'gz-cm-note', hidden: true });
    note.setAttribute('role', 'status');

    // Colors: Ultra's ten as Glaze tones them (the very colors its cards show: a pick is used as is, so a swatch picked
    // is what its card then shows), and the theme's accent. Ultra's ten cover the hues except red and grey, which the
    // custom picker is for. Then Reset, back to Blackboard's own.
    const sw = (ultra ? swatches() : []).map(([label, hex]) => {
      const b = make('button', { type: 'button', className: 'gz-cm-sw', title: t(label) });
      b.setAttribute('aria-label', t(label));
      b.dataset.hex = hex;
      b.style.backgroundColor = hex;
      b.addEventListener('click', () => editCourse(`color ${cid}`, (c) => GZ_COURSE_EDIT.color(c, cid, hex, courseList)));
      return b;
    });
    const custom = make('input', { type: 'color', className: 'gz-cm-custom' });
    custom.setAttribute('aria-label', t('Colour for {name}', { name }));
    custom.addEventListener('input', () => { const hex = custom.value; editCourse(`color ${cid}`, (c) => GZ_COURSE_EDIT.color(c, cid, hex, courseList), true); });
    custom.addEventListener('change', saveEdits);
    const grid = group('gz-cm-colors', ...sw, custom);
    grid.className = 'gz-cm-grid';
    const reset = make('button', { type: 'button', className: 'gz-cm-reset', textContent: t('Reset') });
    reset.addEventListener('click', () => {
      editCourse(`color ${cid}`, (c) => GZ_COURSE_EDIT.color(c, cid, null, courseList));
      grid.querySelector('[tabindex="0"]').focus(); // the button hides, so focus can't stay on it
    });

    // Tint. A tick does nothing while the master switch (courses.tint) is off, so ticking turns it on too
    // (GZ_COURSE_EDIT.tint); unticking leaves the master alone.
    const tint = make('input', { type: 'checkbox' });
    tint.addEventListener('change', () => { const on = tint.checked; editCourse(`tint ${cid}`, (c) => GZ_COURSE_EDIT.tint(c, cid, on, courseList)); });

    // Look: the student's own theme, or one of the eight, drawn as the popup's look cards are. Look names are names.
    const looks = [['', null], ...GZ_LOOKS.map((L) => [L.name, L])].map(([look, L]) => {
      const b = make('button', { type: 'button', className: 'gz-cm-look', textContent: L ? L.name : t('Your theme') });
      b.dataset.look = look;
      if (L) {
        const c = L.colors;
        const tone = L.bg.colors?.length ? L.bg.colors : L.bg.kind === 'solid' ? [c['--gz-surface-2']] : [c['--gz-accent'], c['--gz-accent-hi']];
        b.setAttribute('translate', 'no');
        b.style.color = c['--gz-ink'];
        b.style.borderColor = c['--gz-line-strong'];
        b.style.background = `linear-gradient(90deg, ${c['--gz-accent']} 0 3px, transparent 3px), linear-gradient(120deg, ${c['--gz-surface']} 45%, ${tone.join(', ')})`;
      }
      b.addEventListener('click', () => editCourse(`look ${cid}`, (c) => GZ_COURSE_EDIT.look(c, cid, look)));
      return b;
    });
    const lookGrid = group('gz-cm-look', ...looks);
    lookGrid.className = 'gz-cm-looks';

    if (ultra) box.append(make('label', { className: 'gz-cm-cap', htmlFor: 'gz-cm-nick', textContent: t('Nickname') }), nick, note,
      make('div', { className: 'gz-cm-colorhead' }, cap(t('Colors'), 'gz-cm-colors'), reset), grid,
      make('label', { className: 'gz-cm-tint' }, tint, t('Tint pages inside this course')),
      cap(t('Look'), 'gz-cm-look'), lookGrid);
    else box.append(note, make('p', { className: 'gz-cm-note', textContent: t('Change the colour and nickname in Canvas’s own card menu.') }),
      make('label', { className: 'gz-cm-tint' }, tint, t('Tint pages inside this course')), cap(t('Look'), 'gz-cm-look'), lookGrid);
    document.body.append(box);
    menu = { box, btn, cid, nick, edited: false, note, custom, reset, tint, grid, sw, looks };
    btn.setAttribute('aria-expanded', 'true');
    paintMenu();
    rove(grid, sw.find((b) => b.getAttribute('aria-pressed') === 'true') || sw[0]);
    rove(lookGrid, looks.find((b) => b.getAttribute('aria-pressed') === 'true') || looks[0]);
    placeMenu();
    (ultra ? grid.querySelector('[tabindex="0"]') : tint).focus({ preventScroll: true });
  };

  // The button is taken at the document, in the capture phase, as the cards' counts are (openNew): Ultra's card
  // around it, and what Ultra listens for on the way down, never see a press of it. A press opens or closes
  // the popover on its click (a key press makes one); a key press is left to make it, not repeated here.
  const onMenuButton = (e) => {
    const b = e.target instanceof Element && e.target.closest('.gz-cm-btn');
    if (!b) return;
    e.stopPropagation();
    if (e.type === 'pointerdown') e.preventDefault(); // don't blur the nickname before the click commits it
    if (e.type !== 'click') return;
    e.preventDefault();
    if (menu?.btn === b) closeMenu(); else openMenu(b);
  };
  for (const ev of ['click', 'pointerdown', 'pointerup', 'mousedown', 'mouseup', 'keydown', 'keyup']) document.addEventListener(ev, onMenuButton, true);
  // Esc closes; Tab stays inside; arrows walk a group; Enter in the nickname field saves it.
  const ARROWS = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1, Home: -2, End: 2 };
  document.addEventListener('keydown', (e) => {
    if (!menu) return;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeMenu(); return; }
    if (!(e.target instanceof Element) || !menu.box.contains(e.target)) return;
    if (e.key === 'Enter' && e.target === menu.nick) { e.preventDefault(); if (commitNick()) saveEdits(); return; }
    if (e.key === 'Tab') {
      const tabs = [...menu.box.querySelectorAll('button, input')].filter((x) => x.tabIndex >= 0 && x.getClientRects().length);
      const to = tabs[tabs.indexOf(e.target) + (e.shiftKey ? -1 : 1)] || tabs[e.shiftKey ? tabs.length - 1 : 0];
      e.preventDefault();
      to.focus();
      return;
    }
    const g = e.target.closest('[data-roving]');
    const step = ARROWS[e.key];
    if (!g || !step || e.altKey || e.ctrlKey || e.metaKey) return;
    const items = [...g.querySelectorAll('button, input')];
    // Up and down move a row: as many along as the first row holds.
    const per = items.filter((b) => b.offsetTop === items[0].offsetTop).length;
    const at = items.indexOf(e.target);
    const vertical = e.key === 'ArrowUp' || e.key === 'ArrowDown';
    const next = Math.abs(step) === 2 ? (step < 0 ? 0 : items.length - 1) : Math.min(Math.max(at + step * (vertical ? per : 1), 0), items.length - 1);
    e.preventDefault();
    rove(g, items[next]);
    items[next].focus();
  }, true);
  // An outside press closes it; its own button toggles it (above). Focus stays where the press put it.
  document.addEventListener('pointerdown', (e) => {
    if (e.target instanceof Element && e.target.closest('.gz-cm-btn')) return;
    if (menu && e.target instanceof Node && !menu.box.contains(e.target) && !menu.btn.contains(e.target) && !closeMenu(false)) e.preventDefault();
  }, true);
  let placing = 0;
  const follow = () => { if (menu && !placing) placing = requestAnimationFrame(() => { placing = 0; placeMenu(); }); };
  addEventListener('scroll', follow, { capture: true, passive: true });
  addEventListener('resize', follow);

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

  // Canvas page changes: every click is a full navigation, so both pages opt in to a cross-document view
  // transition (Chrome 126+, Safari 18.2+): the old page stays up until the new one has painted, then they
  // crossfade (canvas.css, Page transitions). An at-rule can't sit under an attribute selector, so the opt-in is
  // a style element that exists only while motion and entrances are on. A page that is revealed inside a
  // transition is marked, so its own entrances (a second movement) stay off; sticky, because letting go would
  // restart them.
  let fade = null;
  const syncPageFade = () => {
    const want = !ultra && links.length && html.getAttribute('data-gz-motion') !== 'off' && !html.hasAttribute('data-gz-no-enter');
    if (want && !fade) {
      fade = document.createElement('style');
      fade.textContent = '@view-transition { navigation: auto; }';
      (document.head || html).appendChild(fade);
    } else if (!want && fade) { fade.remove(); fade = null; }
  };
  if (!ultra) addEventListener('pagereveal', (e) => { if (e.viewTransition) setAttr('data-gz-vt-in', true); });

  const applySettings = () => {
    looked = lookHere();
    const s = (worn = looked ? GZ_COURSE_LOOK(settings, ultra ? courseId() : canvasCourseKey()) : settings);
    const base = GZ_ACTIVE_COLORS(s, darkMQ.matches);
    for (const [v] of GZ_COLORS) setVar(v, base[v]);
    setAttr('data-gz-raw-courses', !s.courses.harmonize);
    // Course colors and tint read Ultra's color slots (course-color-N, the course list recordCourses keeps):
    // Canvas uses its native color directly for tint; its dashboard/calendar toning stays in canvas.css.
    // `colors` is the palette painted: the base one, tinted inside a picked course.
    let colors = base;
    if (ultra) {
      // A slot's own course's pick colors the slot, so what Glaze can't tell apart (the calendar) agrees.
      const own = {};
      for (const [id, c] of Object.entries(courseColors())) if (c.own && c.picked) own[courseList[id].slot] = c.color;
      for (let n = 1; n <= 10; n++) {
        const c = own[n] || s.courses.colors[n];
        if (c) setVar(`--gz-pick-${n}`, c);
        else html.style.removeProperty(`--gz-pick-${n}`);
      }
      // The course color is worked out from the untinted palette set above, then painted over it.
      const on = tintOf();
      const course = on && courseColor(on.slot, on.vars);
      tinted = course ? on.key : null;
      colors = course ? GZ_TINT(base, course, s.courses.strength / 100) : base;
      if (course) for (const [v] of GZ_COLORS) setVar(v, colors[v]);
      paintCourses();
    } else {
      const on = tintOf();
      tinted = on?.key || null;
      if (on) {
        colors = GZ_TINT(base, on.color, s.courses.strength / 100);
        for (const [v] of GZ_COLORS) setVar(v, colors[v]);
      }
      paintCourses();
    }
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
    setAttr('data-gz-scene', kind === 'scene' && s.bg.scene);
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
    syncPageFade();
    setAttr('data-gz-footer', s.footer);
    // Extras: CSS is gated on these; a switch turned on needs one pass over what is already there.
    const was = enhanced;
    enhanced = s.enhance;
    for (const k of Object.keys(s.enhance)) setAttr(`data-gz-enhance-${k}`, s.enhance[k]);
    if (observer && ['scores', 'urgency', 'inline', 'overall'].some((k) => s.enhance[k] && !was[k])) tagExtras([document.body]);
    if (observer) { renderProgress(); renderCalc(); syncDownloads(); syncCourseMenu(); }
    if (!s.enhance.newgrades) { clearTags(['data-gz-new']); for (const p of document.querySelectorAll('.gz-new[data-kind="grades"]')) p.remove(); }
    if (!s.enhance.newcontent) for (const p of document.querySelectorAll('.gz-new:not([data-kind="grades"])')) p.remove();
    if (observer) renderNew();
    if (was.drafts && !s.enhance.drafts) { dropBars(); typed.clear(); tidyDrafts(); }
    // Declutter: CSS hides by these.
    for (const k of ['help', 'banner', 'faculty']) setAttr(`data-gz-hide-${k}`, s.declutter[k]);
    for (const [slug] of GZ_TABS) setAttr(`data-gz-hide-tab-${slug}`, s.declutter.tabs.includes(slug));
    if (!s.enhance.keys) { gAt = 0; closeKeys(); }
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
    themeEditors();
  };
  const clearSettings = () => {
    for (const k of vars) html.style.removeProperty(k);
    for (const k of attrs) html.removeAttribute(k);
    vars.clear();
    attrs.clear();
  };

  // ---- Canvas: the rich text editor's writing area ---------------------------------------------
  // TinyMCE (discussion replies, text submissions, the inbox) writes in a same-origin iframe that it fills by script.
  // The content script isn't injected there (about:blank, and the manifest doesn't ask for it), and canvas.css doesn't
  // reach into it, so it would stay white. The page reaches in instead: the frame gets one small <style>, the palette's
  // values copied from <html> (the --gz-* vars, color-scheme) and the few rules a writing area needs. It is rewritten
  // on every sweep pass (a new editor is an added node), by applySettings (a palette change reaches an open editor),
  // and on the frame's load, for a frame TinyMCE hadn't filled yet when the pass saw it. It is in the frame's <head>;
  // what Canvas posts is the body's HTML, so none of it is saved. disable() calls this after dropping the links: it removes it.
  // Canvas compares this default token to the selection's colour before deciding to save a foreground.
  const EDITOR_CSS = `html, body.mce-content-body { --ic-brand-font-color-dark: var(--gz-ink) !important; background: var(--gz-surface) !important; color: var(--ic-brand-font-color-dark) !important; }
body.mce-content-body { caret-color: var(--gz-accent); }
body.mce-content-body[data-mce-placeholder]::before { color: var(--gz-ink-faint) !important; }
body.mce-content-body a { color: var(--gz-accent); }
body.mce-content-body blockquote { border-left: 3px solid var(--gz-accent); color: var(--gz-ink-muted); }
body.mce-content-body :is(hr, table, th, td) { border-color: var(--gz-line-strong); }
::selection { background: var(--gz-accent-soft); color: var(--gz-ink); }`;
  const waiting = new WeakSet();
  const themeEditors = () => {
    if (ultra) return;
    for (const frame of document.querySelectorAll('iframe.tox-edit-area__iframe')) {
      let doc;
      try { doc = frame.contentDocument; } catch { continue; }
      let style = doc?.getElementById('gz-editor');
      if (!links.length) { style?.remove(); continue; }
      if (!doc?.body?.classList.contains('mce-content-body')) {
        if (!waiting.has(frame)) { waiting.add(frame); frame.addEventListener('load', themeEditors, { once: true }); }
        continue;
      }
      const css = `:root { ${[...vars].map((k) => `${k}: ${html.style.getPropertyValue(k)}`).join('; ')} }\n${EDITOR_CSS}`
        + (darkTheme ? '\nbody.mce-content-body img:not(:hover) { filter: brightness(0.88); }' : '');
      if (!style) {
        style = doc.createElement('style');
        style.id = 'gz-editor';
        (doc.head || doc.documentElement).append(style);
      }
      if (style.textContent !== css) style.textContent = css;
    }
  };

  const enable = () => {
    if (notUltra) return;
    if (!links.length) {
      links = SHEETS.map((f) => {
        const l = document.createElement('link');
        l.rel = 'stylesheet';
        l.href = chrome.runtime.getURL(f);
        // Canvas: hold the first paint until the sheets are in. A script-inserted sheet doesn't block rendering
        // on its own, so a page's first paint was Canvas's own, white. Chrome 105+, Safari 18.2+; ignored
        // elsewhere, and only counts while the document has no body (as here, at document_start). A sheet that
        // fails lets go at once; one that never answers would hold the page forever, so it lets go after 1 s.
        if (!ultra && !document.body) {
          l.setAttribute('blocking', 'render');
          setTimeout(() => l.removeAttribute('blocking'), 1000);
        }
        // The tint reads the course color theme.css resolves: none before it loads.
        l.addEventListener('load', () => { if (tintKey() !== tinted) reapply(); }, { once: true });
        (document.head || html).appendChild(l);
        return l;
      });
    }
    applySettings();
    onBody(() => {
      if (!links.length) return;
      if (!(ultra ? isUltra() : isCanvas())) { disable(); notUltra = true; return; }
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
    unmenu();
    for (const l of links) l.remove();
    links = [];
    themeEditors();
    syncPageFade();
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
  }).then((s) => {
    // Not the nicknames: they're Ultra's, and this tab's sessionStorage is the page's to read too.
    if (!ultra) try { sessionStorage.setItem(KEPT, JSON.stringify({ ...s, courses: { ...s.courses, names: {} } })); } catch { /* blocked or full */ }
    return s;
  });
  // Canvas: the settings are kept in this tab's sessionStorage too, and the next page starts from them. Its
  // first paint waits for the sheets (enable), and storage can answer after that: a light look's page
  // flashed the default dark palette first.
  const KEPT = 'gz-settings';
  if (!ultra) try { const kept = sessionStorage.getItem(KEPT); if (kept) settings = GZ_SANITIZE(JSON.parse(kept)); } catch { /* none */ }
  // Theme on before storage answers: most people leave it on, and this way the first paint is
  // already themed. If it turns out to be off, it comes straight back off.
  enable();
  load().then((s) => {
    settings = s;
    if (ultra) tidyDrafts();
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
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.seenCourses) {
      courseList = changes.seenCourses.newValue || {};
      reapply();
    }
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
