// Glaze — content script, document_start.
// Jobs: (1) put the stylesheets on the page while the theme is on (<link>s we own, so the popup can
// toggle them without a reload), (2) push settings onto <html> — colors and look values as inline
// --gz-* vars, everything else as data-gz-* attributes — so the CSS never branches here,
// (3) the long tail: tag what no selector can reach and let the CSS restyle the tag, (4) the extras.
// This is the part every site runs: Blackboard Ultra, Canvas (each with its own stylesheet and its own part,
// content-ultra.js and content-canvas.js, listed before this file) and Moodle (themed as Canvas is, moodle.css;
// its extras load on demand, moodleIn).
(async () => {
  // Only HTML pages: an /ultra/ address can also be an XML error from Ultra's CDN, or a raw script.
  if (window.__gzGlaze || !/html/.test(document.contentType)) return;
  window.__gzGlaze = true;

  // The options preview is Ultra. On a site, decide once from its head while the parser is still there;
  // addresses and body classes can belong to another app or a same-host tool.
  const isPreview = /-extension:$/.test(location.protocol); // chrome-, moz-, safari-web-extension:
  // A course tab's live frame (gz-ctab:<course>) works as a page of its own (solo), without the footer.
  const tabFrame = window.top !== window && /^gz-ctab:(?:_\d+_\d+|\d+)$/.test(window.name) ? window.name.slice(8) : '';
  const solo = window.top === window || !!tabFrame;
  const ULTRA = 'base[href*="/ultra/"]';
  const MOODLE = 'meta[name="keywords"][content^="moodle,"]'; // core writes it on every page
  let site;
  if (isPreview) site = 'ultra';
  else site = await new Promise((resolve) => {
    const look = () => {
      const hit = document.head?.querySelector(`${ULTRA}, ${MOODLE}, link[rel~="stylesheet"][href*="/dist/brandable_css/"]`);
      if (!hit && !document.body) return;
      mo.disconnect();
      document.removeEventListener('DOMContentLoaded', look);
      resolve(hit ? (hit.matches(ULTRA) ? 'ultra' : hit.matches(MOODLE) ? 'moodle' : 'canvas') : null);
    };
    const mo = new MutationObserver(look);
    mo.observe(document, { childList: true, subtree: true });
    document.addEventListener('DOMContentLoaded', look);
    look();
  });
  if (site !== 'ultra') globalThis.GZ_SITE_ULTRA?.sheets?.forEach((l) => l.remove());
  if (!site) return;
  const ultra = site === 'ultra';
  const moodle = site === 'moodle';

  const C = GZ_COLOR;
  const html = document.documentElement;
  const SKIP = /^(img|video|canvas|svg|iframe|picture|source|path|use|script|style|link|meta)$/i;
  const TAGS = ['data-gz-light', 'data-gz-dark', 'data-gz-fixed-bottom', 'data-gz-vh', 'data-gz-rule', 'data-gz-score', 'data-gz-due', 'data-gz-hover', 'data-gz-pct', 'data-gz-countdown', 'data-gz-chip', 'data-gz-grade', 'data-gz-held', 'data-gz-new', 'data-gz-brand-bg', 'data-gz-brand-fg', 'data-gz-lift'];
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
  // Each site's theme, shared motion and surfaces; Canvas and Ultra also share tabs and apps.
  const SHEETS = [...ultra ? ['theme.css', 'motion.css', 'extras.css'] : [`${site}.css`, 'motion.css'], ...moodle ? [] : ['features/apps.css', 'features/coursetabs.css'], 'features/surfaces.css'];
  // What only one site does: its part puts its own over these (the site's part, below). Moodle's: nothing.
  const no = () => {};
  const X = { record: () => Promise.resolve(), planner: no, tagCards: no, tagExtras: no, lift: no, gate: no, stop: no, renderProgress: no,
    renderNew: no, renderCalc: no, openNew: no, paintCourses: no, tintOf: no, courseColor: no, paintNav: no, syncNav: no, nickOf: () => '', syncNames: no,
    unname: no, holding: () => false, syncTodo: no, syncCardTasks: no, syncWidgets: no, syncRemind: no, syncSyl: no, syncInsights: no, ctx: {} };

  const hasText = (e) => { for (const n of e.childNodes) if (n.nodeType === 3 && n.textContent.trim()) return true; return false; };
  // On Canvas, the whole document: put on a school's own host by lib/background.js mid-load, the body can be
  // there before Canvas's wrapper (isCanvas) is.
  const onBody = (fn) => (document.body && (ultra || document.readyState !== 'loading') ? fn() : document.addEventListener('DOMContentLoaded', fn, { once: true }));
  // Keep the head marker check when enabling after settings change too.
  const isUltra = () => isPreview || !!document.head?.querySelector(ULTRA);
  // Likewise `https://*.instructure.com/*`, and each school's own Canvas host that lib/detect.js found, is
  // every page and frame on that host. Canvas's own pages sit in this wrapper; a tool framed inside one
  // doesn't, and stays as it is.
  // Moodle's: its page id and layout on <body>.
  const isCanvas = () => !!document.querySelector(moodle ? 'body[id^="page-"][class*="pagelayout-"]' : '#application.ic-app');
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
  // A field's text is its value, not a text node; on Canvas an InstUI field in a modal (a portal, outside #application) keeps its dark ink.
  const FIELD = /^(input|textarea|select)$/i;
  const SWEEP_TAGS = ['data-gz-light', 'data-gz-dark', 'data-gz-fixed-bottom', 'data-gz-vh', 'data-gz-brand-bg', 'data-gz-brand-fg', 'data-gz-lift'];
  const sweepEls = (els) => {
    // Read the site's current state, without our previous pass's overrides.
    for (const e of els) { liftable.delete(e); for (const a of e.getAttributeNames()) if (SWEEP_TAGS.includes(a)) e.removeAttribute(a); }
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
      if (!e.isConnected || SKIP.test(e.tagName) || e.closest('svg, [id^="gz-"]')) continue; // a form's e.id can be its field named id
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
        // Instructor's dark colour (navy), links too: canvas.css lifts it.
        if (!ultra && fg?.a >= 0.5 && C.saturated(fg) && !onFill && hasText(e) && e.closest('.user_content')) {
          liftable.set(e, C.hex(fg));
          if (C.contrast(C.hex(fg), palette['--gz-surface']) < 3) tags.push('data-gz-lift');
        }
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
  // Instructor colours met by the sweep: a new dark palette re-checks only these.
  const liftable = new Map();
  const relift = () => { for (const [e, c] of liftable) if (!e.isConnected) liftable.delete(e); else e.toggleAttribute('data-gz-lift', C.contrast(c, palette['--gz-surface']) < 3); };
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

  // ---- moments and the completion burst --------------------------------------------------------
  // 'glaze:moment' on the document: something happened that a Look's effect (features/motionx.js) or a mod may answer,
  // with its name and, if it has a place, where. `once` keys one that must not repeat on this page.
  const told = new Set();
  const moment = (name, el, once) => {
    if (once !== undefined) { if (told.has(once)) return; told.add(once); }
    const r = el?.getBoundingClientRect();
    document.dispatchEvent(new CustomEvent('glaze:moment', { detail: r?.width ? { name, x: r.left + r.width / 2, y: r.top + r.height / 2 } : { name } }));
  };
  // A Look with animations, effects or a pointer effect (GZ_CTX.parts()) brings features/motionx.js in.
  const moveParts = () => {
    const p = GZ_CTX.parts();
    if (globalThis.GZ_MOTIONX || p?.anim || p?.fx || p?.cursor) need('features/motionx.js', () => globalThis.GZ_MOTIONX).then(() => GZ_MOTIONX.sync(), () => {});
  };
  document.addEventListener('glaze:parts', moveParts);
  // Ultra's review circle is role=checkbox; aria-checked turning "true" is the item being completed. The dots are
  // Expressive's, and a Look's own effect for it replaces them.
  const celebrate = (el) => {
    if (globalThis.GZ_LX?.quiet(location.pathname, document)) return;
    const r = el.getBoundingClientRect();
    if (!r.width) return;
    moment('complete', el);
    if (html.getAttribute('data-gz-motion') !== 'expressive' || globalThis.GZ_MOTIONX?.has('complete') || globalThis.GZ_MODS?.replaces('effect:complete')) return;
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

  const reviewing = new WeakMap();
  document.addEventListener('click', (e) => {
    if (!e.isTrusted) return;
    const el = e.target.closest?.('.js-review-state-icon-button');
    if (el && el.getAttribute('aria-checked') !== 'true') reviewing.set(el, Date.now() + 5000);
  }, true);

  // ---- the student's courses -------------------------------------------------------------------
  // Every course and its color, for the editor's course list, the course menu and the tint on pages that don't show
  // it: once a page load, from the site's own list (Ultra's and Canvas's are their parts', X.record; Moodle's is
  // features/moodle.js). Stored locally; nothing leaves the device.
  let canvasRecorded = false;
  // Moodle's: <body>'s course (1 is the site) under its theme sheet's root.
  const canvasCourseKey = (id = moodle ? document.body?.className.match(/\bcourse-(?!1\b)(\d+)/)?.[1] : canvasCourseId()) => id ? `${site}:${moodle ? document.querySelector('link[href*="/theme/styles"]')?.href.split('/theme/')[0] : location.origin}/${id}` : null;
  const recordCourses = () => {
    if (!ultra) {
      if (canvasRecorded || !solo) return;
      canvasRecorded = true;
      if (moodle) return moodleIn().then((m) => m.record()).catch(() => { canvasRecorded = false; });
      X.record().catch(() => { canvasRecorded = false; });
      return;
    }
    if (!solo) return;
    X.record();
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
      : moodle ? moodleIn().then((m) => m.due(now)) : capi(`/planner/items?start_date=${at(0)}&end_date=${at(7)}&per_page=100`).then((j) => GZ_CANVAS_DUE_WEEK(j, now));
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

  // ---- code on demand ------------------------------------------------------------------------------
  // What only some pages need isn't in the first content script: it runs in this frame the first time it's needed,
  // put there by lib/background.js ('glaze:load', its LOADABLE list). The options preview has it as <script> tags.
  // `ready` says whether what the file defines is here: before asking (the preview), and after the worker says it ran.
  // One request per file at a time; a failed one may be asked again after a minute (flush asks often).
  // docId names this document to the worker where the browser can't (no sender.documentId): it checks the frame still
  // holds this document before injecting.
  const docId = crypto.randomUUID();
  globalThis.__gzDoc = docId;
  const loading = new Map(); // file -> promise
  const need = (file, ready) => {
    if (!loading.has(file)) {
      const p = ready() ? Promise.resolve() : isPreview ? Promise.reject(new Error('not in the preview'))
        : Promise.resolve().then(() => {
          if (!chrome.runtime?.id) throw new Error('reloaded');
          return chrome.runtime.sendMessage({ type: 'glaze:load', files: [file], doc: docId });
        }).then((r) => {
          if (!r?.ok) throw new Error(r?.error || 'not loaded');
          if (!ready()) throw new Error('ran, but not ready');
        });
      p.catch(() => { if (chrome.runtime?.id) setTimeout(() => { if (loading.get(file) === p) loading.delete(file); }, 60000); });
      loading.set(file, p);
    }
    return loading.get(file);
  };
  // Moodle's extras, on first use: its data read (lib/moodle.js), then asked of the page's own Moodle.
  const moodleIn = () => need('lib/moodle.js', () => globalThis.GZ_MOODLE).then(() => need('features/moodle.js', () => globalThis.GZ_MOODLE_PAGE)).then(() => GZ_MOODLE_PAGE);
  // The page's language: its catalogue (i18n/<lang>.js) is asked for as the page starts, and nothing is on an
  // English page. Until it is in, the extras that write words wait (flush), so no English turns into German in
  // front of you; the theme itself never waits. It is asked for once per page: if that fails, the page stays in
  // English for good, since switching language under the student later would be worse than not switching.
  let wordsFor = null; // the catalogue the words are ready for ('' for none)
  let wordsLate = false; // a pass skipped its extras while waiting: the next one covers the whole page
  const wordsIn = new Set(); // what was drawn outside the extras' wait (the keyboard help) redraws itself in the words
  const words = () => {
    const file = isPreview ? '' : GZ_I18N.file(locale()) || '';
    if (file === wordsFor) return true;
    if (!file) { wordsFor = file; return true; }
    if (!loading.has(file)) {
      need(file, () => globalThis.GZ_LANGS?.[file.slice(5, -3)]).then(() => true, () => false).then((ok) => {
        if (GZ_I18N.file(locale()) !== file) return;
        wordsFor = file;
        if (ok) for (const f of wordsIn) f();
        if (observer && wordsLate && !timer) timer = setTimeout(flush, 0);
      });
    }
    return false;
  };
  words();

  // ---- the gradebook --------------------------------------------------------------------------
  // Due-date status, new grades and the what-if calculator read the student's own gradebook records,
  // asked of their own Blackboard (same origin, their session) the way Ultra's Grades page asks: at
  // most once a minute per course, and only for courses on the page where one of those is showing
  // (content-ultra.js). Absolute URLs: Ultra's <base href> points at its CDN.
  // Canvas's REST API is the same thing under /api/v1 (capi): its string-id JSON keeps long ids exact, and an
  // older Canvas starts a response with `while(1);`.
  const api = (path, base = '/learn/api/v1', accept = 'application/json') => fetch(`${location.origin}${base}${path}`, { credentials: 'same-origin', redirect: 'error', headers: { accept } })
    .then((r) => (r.ok ? r.text() : Promise.reject(r.status))).then((text) => JSON.parse(text.replace(/^while\(1\);/, '')));
  const capi = (path) => api(path, '/api/v1', 'application/json+canvas-string-ids');
  // The Canvas course this page is in (/courses/:id/...), or undefined.
  const canvasCourseId = () => location.pathname.match(/^\/courses\/(\d+)(?:\/|$)/)?.[1];

  // ---- grades on course cards (Extras) ---------------------------------------------------------
  // A course card's overall grade, drawn by CSS from attributes: Ultra's Courses page and Canvas's Dashboard (X.tagCards),
  // Moodle's Dashboard and My courses (features/moodle.js).
  const tagCards = () => {
    if (!observer || !settings.enhance.overall) return;
    if (moodle) return document.querySelector('[data-region="course-content"]') && moodleIn().then((m) => m.cards(), () => {});
    X.tagCards();
  };

  // ---- extras that read page text (score bars, due-date urgency), only while switched on ----
  // The chip and urgency on a due date, drawn by CSS from these attributes.
  const markDue = (el, state, chip) => {
    if (state) el.setAttribute('data-gz-due', state);
    else el.removeAttribute('data-gz-due');
    if (chip) {
      el.setAttribute('data-gz-countdown', chip.label);
      if (chip.tone) el.setAttribute('data-gz-chip', chip.tone);
      else el.removeAttribute('data-gz-chip');
    } else {
      el.removeAttribute('data-gz-countdown');
      el.removeAttribute('data-gz-chip');
    }
  };
  // Score bars and due dates: Ultra's from the subtrees a pass looks at, Canvas's from its few selectors (X.tagExtras).
  const tagExtras = (roots) => {
    tagCards();
    X.tagExtras(roots);
  };

  let dirty = new Set();
  let full = false;
  const hid = () => tabFrame && html.hasAttribute('data-gz-ctab-framed');
  // The Look's LMS rules (features/rules.js), once it has any: each pass puts them back on what the page redrew.
  const syncRules = () => { if (globalThis.GZ_RULES) GZ_RULES.sync(); else if (GZ_CTX.parts()?.rules?.length) need('features/rules.js', () => globalThis.GZ_RULES).then(() => GZ_RULES.sync(), () => {}); };
  document.addEventListener('glaze:parts', syncRules);
  const flush = () => {
    timer = 0;
    if (hid()) { dirty.clear(); full = true; return; }
    const roots = outermost(dirty);
    dirty.clear();
    const said = words();
    const all = full || (said && wordsLate);
    if (full) { full = false; if (ultra) X.gate(document.body); sweepAll(); } else sweepRoots(roots);
    if (said) { tagExtras(all ? [document.body] : roots); wordsLate = false; } else wordsLate = true;
    // Every site runs the same list; what a site doesn't do is a default that does nothing (X).
    themeEditors();
    if (tip && ultraTipShown()) hideTip();
    X.paintCourses();
    if (tintKey() !== tinted || lookHere() !== looked || surfaceCourse() !== html.style.getPropertyValue('--gz-surface-course')) applySettings();
    globalThis.GZ_XPARTS_PAGE?.pass();
    placeScene();
    syncRules();
    if (!said) return;
    if (all) X.syncNav();
    X.renderProgress();
    X.renderNew();
    keepPlace();
    X.renderCalc();
    watchDrafts();
    syncDownloads();
    syncDocTools();
    syncCourseMenu();
    globalThis.GZ_MODS?.pass();
    X.syncTodo();
    X.syncCardTasks();
    X.syncWidgets();
    X.syncRemind();
    X.syncSyl();
    X.syncInsights();
  };
  // Throttle, not debounce: Ultra never stops mutating (ripples, popper repositioning), and a
  // debounce that restarts on every record would put the sweep off indefinitely.
  const schedule = (records) => {
    // Cut off by a reload of Glaze: stop watching, and every GZ_CTX.on() feature stops too.
    if (!chrome.runtime?.id) { observer?.disconnect(); observer = null; return; }
    // A course tab's hidden frame: no sweep until it is shown (GZ_CTX scene), then one full pass.
    if (hid()) { dirty.clear(); full = true; return; }
    // Keep native-parent removals for remount/teardown; ignore owned UI internals.
    records = records.filter((r) => !globalThis.GZ_LIGHT?.owns(r) && !r.target.closest?.('.gz-game,.gz-game-dialog,.gz-game-world') && !(ultra && r.target.closest?.('[id^="gz-"]')));
    if (!records.length) return;
    X.lift();
    for (const r of records) {
      if (ultra && r.attributeName === 'aria-checked') {
        if (r.oldValue !== 'true' && r.target.getAttribute('aria-checked') === 'true' && Date.now() <= (reviewing.get(r.target) || 0)) { reviewing.delete(r.target); celebrate(r.target); }
        // A circle that changes changes its item's due-date chip.
        const item = r.target.closest('.content-list-item');
        if (item) dirty.add(item);
        continue;
      }
      if (r.type === 'attributes') { dirty.add(r.target); continue; }
      for (const n of r.addedNodes) {
        if (n.nodeType !== 1) continue;
        dirty.add(n);
        if (ultra) X.gate(n); // native additions may need first-paint nav discovery
      }
    }
    // Too many separate subtrees to be worth tracking: one full pass is cheaper.
    if (dirty.size > 500) { dirty.clear(); full = true; }
    if (!timer) timer = setTimeout(flush, 150);
  };
  const startSweep = () => {
    if (observer) return;
    if (ultra) X.gate(document.body); // what Ultra drew before the observer
    sweepAll();
    observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeOldValue: true, attributeFilter: ['class', 'style', 'aria-checked'] });
    if (window.top === window && !X.planner()) dueWeek();
    X.lift();
    recordCourses();
    if (!ultra) X.paintCourses();
    syncRules();
    if (!words()) { wordsLate = true; return; }
    tagExtras([document.body]);
    watchDrafts();
    syncCourseMenu();
    X.syncNav();
    if (!ultra) X.renderProgress();
  };
  const clearTags = (names) => { for (const a of names) for (const e of document.querySelectorAll(`[${a}]`)) e.removeAttribute(a); };
  const stopSweep = () => {
    observer?.disconnect();
    observer = null;
    clearTimeout(timer);
    timer = 0;
    dirty.clear();
    full = false;
    X.stop();
    globalThis.GZ_MOODLE_PAGE?.paint();
    clearTags(ultra ? TAGS : [...TAGS, 'data-gz-course-color']);
    liftable.clear();
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

  // ---- tooltips and hints -------------------------------------------------------------------
  // Two sources, one themed tooltip:
  // - titles: Ultra's icon buttons lean on the browser's title tooltip (unthemed, a second late).
  //   While the pointer or focus is on one, its title moves into the tooltip (and into aria-label
  //   when it was the element's only name), and goes back the moment it leaves.
  // - hints, worked out at hover time: what a date means ("Due in 2 days"), a grade as a share,
  //   the full text of anything Ultra cut off with an ellipsis.
  // Where Ultra shows a tooltip of its own, Glaze's stands down.
  // Canvas: the same, with its own words. Its titles are icon buttons' names too, but many only repeat a link's text
  // (a module item's title), and those are left to the browser unless the text is cut short. Where Canvas draws a
  // tooltip itself, Glaze's stands down: jQuery UI's (.ui-tooltip, over [data-tooltip], whose title is left to it),
  // InstUI's ([role=tooltip], there at no size until shown) and the older pages' CSS ones (.tooltip_wrap, always
  // there, made visible on hover). Hints read Canvas's dates (GZ_PAGE.canvasDate, or a <time>'s own) and scores
  // (canvasScore), from the text a reader sees: not its screen-reader copy. A hint at or inside a titled element
  // wins over the title, which on Canvas mostly repeats the text (a <time>'s, the Grades page's score cell's).
  const ULTRA_TIP = `.MuiTooltip-popper, .tooltip.opened, span.enhanced-tooltip, .ms-Tooltip, [role="tooltip"]:not(.gz-tip)${ultra ? '' : ', .ui-tooltip, .tooltip_wrap'}`;
  const SR_ONLY = '.screenreader-only, [class*="screenReaderContent"]';
  const textOf = (el) => {
    if (ultra || !el.querySelector(SR_ONLY)) return el.textContent;
    const c = el.cloneNode(true);
    for (const s of c.querySelectorAll(SR_ONLY)) s.remove();
    return c.textContent;
  };
  const CANVAS_DUE_AT = '.assignment-date-due, .due_date_display, #grades_summary td.due';
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
  const ultraTipShown = () => [...document.querySelectorAll(ULTRA_TIP)].some((t) => t.offsetWidth > 0 && (ultra || t.checkVisibility({ visibilityProperty: true })));
  const showTip = (el, { title, sub }) => {
    if (!el.isConnected || ultraTipShown()) { if (!ultra) hideTip(); return; }
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
      // InstUI cuts some titles (the To Do sidebar's) in script, so the rest isn't on the page: its link's label has it.
      // Pointed at, or the link focused from the keyboard.
      const cut = !ultra && (el.matches('[data-cid="TruncateText"]') ? el : el.matches('a[aria-label]') && el.querySelector('[data-cid="TruncateText"]'));
      if (cut) {
        const full = GZ_PAGE.uncut(cut.textContent, cut.closest('a[aria-label]')?.getAttribute('aria-label'));
        if (full) return [cut, { title: full.slice(0, 300) }];
      }
      if (!ultra && el.matches('.score_holder > .tooltip, .score-display')) {
        const sc = GZ_PAGE.canvasScore(el.textContent);
        if (sc?.max) return [el, { title: t('{got} of {n} points', { got: sc.got, n: sc.max }), sub: GZ_I18N.pct(Math.round(sc.ratio * 100), locale()) }];
      }
      // Month-view chips are always cut short: the whole title, and when it is due.
      if (el.matches('.fc-event')) return [el, { title: squash(el.querySelector('.fc-title')?.textContent || el.textContent) }];
      const text = el.childElementCount <= 3 ? squash(textOf(el)) : '';
      if (text.length && text.length < 120) {
        const loc = locale();
        const now = new Date();
        const isDue = (ultra ? dueLabelled(el) : !!el.closest(CANVAS_DUE_AT)) || (/^en\b/i.test(loc) && /\bdue\b/i.test(text));
        const at = ultra ? text : el.matches('time[datetime]') ? new Date(el.dateTime) : GZ_PAGE.canvasDate(text, loc, now);
        const w = GZ_PAGE.when(at, now, loc, isDue);
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
    let titled = e.target.closest('[title], [data-gz-title]');
    if (titled && titled === tipFor) return;
    if (!ultra && titled?.matches('[data-tooltip]')) return hideTip();
    let hinted = settings.look.hints && (!titled || !ultra) ? hintFor(e.target) : null;
    if (hinted && titled && !titled.contains(hinted[0])) hinted = null;
    if (hinted && hinted[0] === tipFor) return;
    // Canvas: a title that only repeats the text beside it, uncut.
    if (!ultra && titled && !hinted && !titled.closest('#header') && squash(textOf(titled)) === squash(titled.getAttribute('title') || '') && titled.scrollWidth <= titled.clientWidth + 1) titled = null;
    hideTip();
    const title = titled?.getAttribute('title'), text = title?.trim();
    if (titled && !text && !hinted) return;
    if (text) {
      tipFor = titled;
      titled.dataset.gzTitle = title;
      titled.removeAttribute('title');
      if (!titled.hasAttribute('aria-label') && !titled.textContent.trim()) { titled.setAttribute('aria-label', text); titled.dataset.gzAria = '1'; }
    }
    if (hinted) {
      tipFor ||= hinted[0];
      tipTimer = setTimeout(() => showTip(hinted[0], hinted[1]), e.type === 'focusin' ? 150 : 450);
    } else if (text) tipTimer = setTimeout(() => showTip(titled, { title: text }), e.type === 'focusin' ? 150 : 350);
  };
  document.addEventListener('pointerover', onTip, true);
  document.addEventListener('focusin', onTip, true);
  document.addEventListener('pointerout', (e) => { if (!e.relatedTarget) hideTip(); }, true);
  document.addEventListener('focusout', (e) => { if (e.target === tipFor) hideTip(); }, true);
  for (const ev of ['pointerdown', 'scroll', 'wheel']) document.addEventListener(ev, hideTip, { capture: true, passive: true });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideTip(); }, true);

  // ---- folder previews (Extras) ----------------------------------------------------------------
  // Hovering a collapsed folder lists what is inside (features/previews.js). What it shares with Download all and
  // the rest of this script is here: the course, a folder's toggle, and Canvas's lists, kept for a minute.
  const courseId = () => location.pathname.match(/\/ultra\/courses\/(_\d+_\d+)\//)?.[1];
  // A folder's or learning module's own fold toggle, by the id Ultra gives it in every language; null for
  // anything else (an Ultra document is a folder to the API, but has none).
  const toggleOf = (item) => item?.querySelector(`[id="folder-title-${item.dataset.contentId}"], [id="learning-module-title-${item.dataset.contentId}"]`);
  // What a folder or module holds, shown when the pointer rests on its row: features/previews.js (Canvas's lists are
  // content-canvas.js'), loaded the first time it does (or, on Canvas, focus reaches one), then handed that event if
  // the row is still where it was.
  const PEEK_AT = ultra ? '.content-list-item[data-content-id]' : '.context_module .expand_module_link, a[href*="/files/folder/"]';
  const peekIn = (e) => {
    if (globalThis.GZ_PEEK || !settings.enhance.previews || !observer || !(e.target instanceof Element)) return;
    const { target, type } = e;
    if (!(ultra ? courseId() : canvasCourseId()) || !target.closest(PEEK_AT)) return;
    need('features/previews.js', () => globalThis.GZ_PEEK).then(() => { if (observer && settings.enhance.previews && (type === 'focusin' ? document.activeElement === target : target.matches(':hover'))) GZ_PEEK.on({ target, type }); }, () => {});
  };
  document.addEventListener('pointerover', peekIn, { capture: true, passive: true });
  document.addEventListener('focusin', (e) => { if (!ultra) peekIn(e); }, true);

  // ---- course progress (Extras) ---------------------------------------------------------------
  // One bar above a course's outline (Ultra) or Modules list (Canvas) adding up what is done there (X.renderProgress).
  // The bar, drawn before `before` (the list it adds up), or brought up to date.
  const drawProgress = (old, done, total, before) => {
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
    if (!old) before.before(bar);
  };

  // ---- new grades (Extras) --------------------------------------------------------------------
  // "New" on what was graded or added since it was last looked at, and counts on course cards (X.renderNew).
  // Counts are real link-like pills: on a card, first in the course name (where an ellipsis can't cut
  // it), opening that course's gradebook at the first new grade ('grades') or its outline at the newest
  // item ('items'); on a closed folder in the outline, after its title, unfolding it down to its newest
  // item ('inside'). A new item's own "New" ('item') is a plain label. Clicks are taken in the capture
  // phase so the card or row around a pill (itself a link or a toggle) doesn't act instead.
  const KIND = { grades: '{n} new grades: open the gradebook', items: '{n} new items: open the course', inside: '{n} new items: show them' };
  const gradeCounts = new Map();
  const gradeMoment = (cid, n, el) => {
    if (!Number.isFinite(n)) return;
    const was = gradeCounts.get(cid);
    gradeCounts.set(cid, n);
    if (was !== undefined && n > was) moment('grade', el);
  };
  const cardBadge = (el, cid, count, kind = 'grades') => {
    let pill = el.querySelector(`:scope > .gz-new[data-kind="${kind}"]`);
    if (!count) { if (kind === 'grades') gradeMoment(cid, count, el); return pill?.remove(); }
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
    if (kind === 'grades') gradeMoment(cid, count, pill);
  };
  // Ultra's pills (X.openNew), registered here on every site so they still come before the other listeners.
  for (const ev of ['click', 'keydown', 'pointerdown', 'mousedown']) document.addEventListener(ev, (e) => X.openNew(e), true);

  // ---- new content (Extras) -------------------------------------------------------------------
  // The course cards on screen, whose counts are asked for.
  const inView = new Set();
  const cardsInView = new IntersectionObserver((es) => {
    for (const e of es) if (e.isIntersecting) inView.add(e.target); else inView.delete(e.target);
    X.renderNew();
  });

  // ---- your place in a course (Extras) --------------------------------------------------------
  // Ultra: a course outline's open folders and how far down it you were; Canvas: how far down a course's Modules list,
  // and the item opened last. Put back when you return: features/place.js, loaded where there is a place to keep or put
  // back. Anything you do first (wheel, touch, a key, a click) ends putting it back, so that is watched from the start.
  const ROWS = '.content-list-item[data-content-id]';
  let tapped = null; // { id, at }: the row of your last click
  let acted = 0; // when you last did anything on this page (Canvas: before the list is even there, it ends the restore too)
  let placeAsked = 0; // when the outline or list was first there to put back: anything done after it, while place.js loads, ends that
  const keepPlace = () => {
    if (globalThis.GZ_PLACE) return GZ_PLACE.sync();
    if (!settings.enhance.place || !solo || !observer) return;
    if (ultra ? courseId() && /^\/ultra\/courses\/_\d+_\d+\/outline\/?$/.test(location.pathname) && document.querySelector(ROWS)
      : canvasCourseKey() && (new URLSearchParams(location.search).get('module_item_id') || (/^\/courses\/\d+(\/modules)?\/?$/.test(location.pathname) && document.getElementById('context_modules_sortable_container')))) {
      placeAsked ||= Date.now();
      need('features/place.js', () => globalThis.GZ_PLACE).then(() => GZ_PLACE.sync(), () => {});
    }
  };
  document.addEventListener('click', (e) => { if (e.isTrusted && e.target instanceof Element) tapped = { id: e.target.closest(ROWS)?.dataset.contentId, at: Date.now() }; }, true);
  for (const ev of ['wheel', 'touchstart', 'keydown', 'pointerdown']) document.addEventListener(ev, (e) => { if (!e.isTrusted) return; acted = Date.now(); globalThis.GZ_PLACE?.stop(); }, { capture: true, passive: true });

  // ---- what-if calculator (Extras) -----------------------------------------------------------
  // On a course's gradebook: scores typed for work not graded yet give the overall grade they'd make, and a target what
  // it takes: features/grades.js, asked for by each site's part (X.renderCalc).
  const make = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; };

  // ---- draft backup (Extras) ------------------------------------------------------------------
  // What you write in Ultra's editors, or in Canvas's Inbox compose, is kept on this device until it posts, and offered
  // back when that editor turns up empty again: features/drafts.js (with lib/drafts.js), loaded once such an editor is on
  // the page or written in. An editor written in before it arrives (one paste can be all there is) is taken up when it
  // does, as if just written in; from then on it gets every keydown, input and paste, and the passes (watchDrafts).
  const DRAFT_ED = ultra ? '.ql-editor[contenteditable="true"]' : '#compose-message-modal textarea[data-testid="message-body"]';
  const local = (fn) => { try { fn(chrome.storage.local); } catch { /* extension reloaded under the tab */ } };
  // What a copy needs, read as it is written: the editor can be gone (compose closed, the page changed) before it's kept.
  const draftAt = (ed) => {
    // Values, not elements: Ultra may reuse the editor and its wrapper for another post before the copy is made.
    // Ultra: the nearest Blackboard id above the editor (a reply's post, say).
    const m = ed.closest('#compose-message-modal'), BBID = /_\d+_\d+/;
    let near = '';
    for (let p = ultra && ed.parentElement, i = 0; p && !near && i < 15; p = p.parentElement, i++) {
      for (const a of p.attributes) if ((a.name === 'id' || a.name.startsWith('data-')) && BBID.test(a.value)) { near = a.value.match(BBID)[0]; break; }
    }
    return { ed, id: ed.id, near, path: location.pathname, at: Date.now(), text: ultra ? ed.textContent : ed.value, html: ultra ? ed.innerHTML : ed.value,
      subject: m?.querySelector('input[data-testid="subject-input"]')?.value, name: m?.querySelector('input[data-testid="course-select-modal"]')?.value,
      to: [...(m?.querySelectorAll('[data-testid="address-book-tag"]') || [])].map((e) => e.id) };
  };
  const draftsWaiting = new Map(); // editor -> what was read from it last
  // Read again; an editor Ultra has put to another post (other ids or page) keeps what it held for the last one too.
  const draftsOld = [];
  const draftWait = (ed) => {
    const was = draftsWaiting.get(ed), now = draftAt(ed);
    if (was && (was.id !== now.id || was.near !== now.near || was.path !== now.path)) draftsOld.push(was);
    draftsWaiting.set(ed, now);
  };
  const draftsIn = () => need('lib/drafts.js', () => globalThis.GZ_DRAFTS).then(() => need('features/drafts.js', () => globalThis.GZ_DRAFT_UI)).then(() => {
    const eds = [...draftsOld.splice(0), ...draftsWaiting.values()];
    draftsWaiting.clear();
    for (const at of eds) GZ_DRAFT_UI.take(at);
    if (observer) watchDrafts();
  }, () => { draftsWaiting.clear(); draftsOld.length = 0; });
  for (const ev of ['keydown', 'input', 'paste']) document.addEventListener(ev, (e) => {
    if (globalThis.GZ_DRAFT_UI) return GZ_DRAFT_UI.write(e);
    if ((!ultra && e.type !== 'input') || !settings.enhance.drafts || !observer || !(e.target instanceof Element)) return;
    const ed = e.target.closest(DRAFT_ED);
    if (ed) { draftWait(ed); draftsIn(); } else if (!ultra && e.target.closest('#compose-message-modal')) watchDrafts();
  }, true);
  // Canvas owns RCE recovery and assignment/quiz drafts. Only its plain-text new Inbox compose lacks it.
  const watchDrafts = () => {
    if (globalThis.GZ_DRAFT_UI) return GZ_DRAFT_UI.watch();
    // Read again each pass while it loads: a paste lands in Quill after its event.
    for (const [ed] of draftsWaiting) if (ed.isConnected) draftWait(ed);
    if (settings.enhance.drafts && (ultra || /^\/conversations\/?$/.test(location.pathname)) && document.querySelector(DRAFT_ED)) draftsIn();
  };
  // Expired copies go; with backup off, all copies go. Top frame only.
  const tidyDrafts = () => {
    if (window.top !== window) return;
    // Only drafts are read where keys can be listed.
    local((s) => Promise.resolve(s.getKeys?.()).catch(() => null).then((ks) => s.get(ks?.filter((k) => k.startsWith('draft:')) || null, (all) => {
      if (!Object.keys(all || {}).some((k) => k.startsWith('draft:'))) return;
      need('lib/drafts.js', () => globalThis.GZ_DRAFTS).then(() => { const old = GZ_DRAFTS.stale(all, Date.now(), settings.enhance.drafts); if (old.length) s.remove(old); }, () => {});
    })).catch(() => {}));
  };

  // ---- download all (Extras) -------------------------------------------------------------------
  // A button on each folder and learning module in course content saves the files inside as one zip:
  // features/download.js, loaded on a course page that has one (Ultra) or a course's modules (Canvas) while the
  // switch is on. The previews' pass rides along.
  const dlHere = () => settings.enhance.download && (ultra ? !!courseId() && !!document.querySelector('.content-list-item [id^="folder-title-"], .content-list-item [id^="learning-module-title-"]')
    : typeof chrome.runtime.connect === 'function' && !!canvasCourseId() && /^\/courses\/\d+(?:\/modules)?\/?$/.test(location.pathname));
  const syncDownloads = () => {
    globalThis.GZ_PEEK?.sync();
    if (dlHere()) need('features/download.js', () => globalThis.GZ_DOWNLOAD).then(() => { if (observer && dlHere()) GZ_DOWNLOAD.sync(); }, () => {});
    else globalThis.GZ_DOWNLOAD?.sync();
  };

  // ---- document buttons (Extras) ---------------------------------------------------------------
  // Round buttons in the bottom-right gutter, top frame only: dark documents while a file preview is on screen (dark
  // palettes only), focus mode on a course document. features/docs.js, loaded where they can appear: a course document
  // with the switch on, or a file preview (on Ultra, in any frame: a same-origin preview's images are turned back).
  const PREVIEWS = ultra ? '#site-wrap :is(.js-file-viewer-inline-preview, [class*="fileViewerContainer"]) iframe' : '#doc_preview iframe, #file-preview-iframe, iframe.ef-file-preview-frame:not(.annotated-document-submission), .file_preview iframe';
  const DOC = ultra ? '#site-wrap .document-content-root' : '#wiki_page_show .show-content, #assignment_show .description';
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
  const setDark = (v) => {
    settings = { ...settings, enhance: { ...settings.enhance, docPages: v } };
    setAttr('data-gz-enhance-docPages', v);
    syncDocTools();
    try { chrome.storage.sync.set({ enhance: settings.enhance }); } catch { /* extension reloaded under the tab */ }
  };
  const syncDocTools = () => {
    globalThis.GZ_KEYS?.sync();
    if (globalThis.GZ_DOCS) return GZ_DOCS.sync();
    if (observer && ((ultra && document.querySelector(PREVIEWS)) || (solo && settings.enhance.toggles && document.querySelector(`${DOC}, ${PREVIEWS}`)))) {
      need('features/docs.js', () => globalThis.GZ_DOCS).then(() => GZ_DOCS.sync(), () => {});
    }
  };
  // Here, so it is first to see the key: Esc leaves focus mode, and the site doesn't also act on it.
  addEventListener('keydown', (e) => globalThis.GZ_DOCS?.esc(e), true);

  // ---- keyboard shortcuts (Extras) ------------------------------------------------------------
  // "g" then a letter goes somewhere, "/" searches, "?" lists them: features/keys.js, loaded on the first key that
  // starts one while the switch is on, then handed every key. Top frame only.
  const typing = (el) => el instanceof Element && (el.isContentEditable || !!el.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])'));
  // Whether a key is one for the shortcuts: switched on, no modifier, not typing, and on Canvas and Moodle not repeated, not
  // already taken, not on a page or in a widget that has keys of its own (keys.js asks this too, and Moodle's pages).
  const keyOn = (e) => !!chrome.runtime?.id && !!settings.enhance.keys && !!observer && !e.metaKey && !e.ctrlKey && !e.altKey && !typing(e.target)
    && (ultra || !(e.defaultPrevented || e.repeat || !(moodle || GZ_PAGE.canvasKeys(location.pathname)) || e.target.closest?.('[role="dialog"]:not(#gz-keys), [role="menu"], [role="listbox"], [role="grid"]')));
  let keysWaiting = null; // the keys pressed while keys.js loads, as they were: handed over in order when it's in
  if (solo) {
    document.addEventListener('keydown', (e) => {
      if (!chrome.runtime?.id) return;
      if (globalThis.GZ_KEYS) return GZ_KEYS.key(e);
      const was = { key: e.key, target: e.target, metaKey: e.metaKey, ctrlKey: e.ctrlKey, altKey: e.altKey, defaultPrevented: e.defaultPrevented, repeat: e.repeat, at: Date.now(), preventDefault() {}, stopImmediatePropagation() {} };
      if (keysWaiting) {
        // What keys.js does at once with a "?" (Ultra's list; Canvas's g then ?, so Canvas's own help stays shut),
        // which can't wait for the file.
        const prev = keysWaiting.findLast((k) => k.key !== 'Shift');
        if (e.key === '?' && keyOn(e) && (ultra || (prev?.key === 'g' && was.at - prev.at < 1200))) { e.preventDefault(); if (!ultra) e.stopImmediatePropagation(); }
        keysWaiting.push(was);
        return;
      }
      if (!keyOn(e) || !(e.key === 'g' || (ultra && (e.key === '/' || e.key === '?')))) return;
      if (ultra && e.key === '?') e.preventDefault();
      keysWaiting = [was];
      need('features/keys.js', () => globalThis.GZ_KEYS).then(() => { for (const k of keysWaiting) GZ_KEYS.key(k); }, () => {}).finally(() => { keysWaiting = null; });
    }, true);
  }

  // ---- command palette (Extras; Canvas too) --------------------------------------------------
  // Ctrl+K (⌘K on a Mac) opens one search over the site's pages, your courses, this course and Glaze's own switches:
  // features/palette.js, loaded the first time. Never while typing (Ultra's editor uses Ctrl+K for links), top frame only.
  let cmdWanted = null; // while palette.js loads: open it when it's in? Each press meanwhile turns that over.
  if (solo) {
    document.addEventListener('keydown', (e) => {
      if (!chrome.runtime?.id || e.key?.toLowerCase() !== 'k' || !(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey || !settings.enhance.palette || !observer) return;
      // Stopped, as when opening: the search box (focused, now gone) would otherwise answer it with no palette left.
      if (globalThis.GZ_CMD?.isOpen()) { e.preventDefault(); e.stopPropagation(); GZ_CMD.close(); return; }
      if (cmdWanted !== null) { e.preventDefault(); e.stopPropagation(); cmdWanted = !cmdWanted; return; }
      if (typing(e.target)) return;
      if (!ultra && e.target.closest?.('[role="dialog"], [role="menu"], [role="listbox"]')) return;
      e.preventDefault();
      e.stopPropagation();
      cmdWanted = true;
      need('features/palette.js', () => globalThis.GZ_CMD).then(() => { if (cmdWanted && chrome.runtime?.id && observer && settings.enhance.palette) GZ_CMD.open(); }, () => {}).finally(() => { cmdWanted = null; });
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

  // ---- animated background -----------------------
  const LAYERS = ':is(.panel-wrap, .bb-offcanvas-panel):not(.peek, :is(.peek, .peek-panel__content-wrapper, .ms-Panel-main) *)';
  const sceneFrame = solo || location.protocol !== 'https:';
  let scene = null, sceneCanvas = null, sceneFile = '';
  const sceneLoad = {};
  let sceneLoadId = 0;
  let sceneFailed = false, sceneRetry = null, scenePending = null;
  let sceneBad = '';
  const partsOf = () => globalThis.GZ_CTX?.parts() ?? null;
  const bgKind = () => globalThis.GZ_XPARTS_PAGE?.bgKind(partsOf()?.bg) || worn.bg.kind;
  const sceneKind = () => { const k = bgKind(), b = partsOf()?.bg; return k === 'scene' || (k === 'shader' ? !!b?.shader?.src : k === 'media' ? !!b?.media : k === 'layers' && !!b?.layers?.length); };
  const sceneModule = () => (bgKind() === 'media' ? 'lib/scene-media.js' : 'lib/scene.js');
  const sceneSig = () => JSON.stringify([bgKind(), worn.bg.scene, partsOf()?.bg]);
  let modBg = null;
  const placeScene = () => {
    const c = modBg || sceneCanvas;
    if (!c) return;
    const home = (ultra && [...document.querySelectorAll(LAYERS)].filter((e) => e.getClientRects().length).pop()) || document.body;
    if (c.parentNode === home) return;
    home.append(c);
    scene?.draw();
  };
  const stopScene = () => {
    clearTimeout(sceneRetry?.timer);
    sceneRetry = scenePending = null;
    sceneFailed = false;
    scene?.stop();
    scene = null;
    sceneCanvas?.remove();
    sceneCanvas = null;
  };
  // Retry startup twice. sceneBad still blocks refused shaders and over-budget scenes.
  const retryScene = (key, error) => {
    console.warn('[Glaze] Background startup failed', error);
    const tries = (sceneRetry?.tries || 0) + 1;
    stopScene();
    sceneFailed = true;
    const retry = sceneRetry = { key, tries, timer: 0 };
    if (tries < 3) retry.timer = setTimeout(() => {
      if (sceneRetry !== retry) return;
      retry.timer = 0; sceneFailed = false; syncScene();
    }, tries === 1 ? 1000 : 5000);
  };
  const sceneOpts = () => {
    const { dim, amount, pace } = GZ_SCENE_LOOK(worn.bg.intensity);
    return {
      kind: bgKind(),
      name: worn.bg.scene,
      x: partsOf(),
      palette,
      ground: palette['--gz-surface-2'],
      colors: GZ_BG_COLORS(worn.bg.colors, palette),
      dim,
      amount,
      speed: html.hasAttribute('data-gz-ctab-framed') ? 0 : pace * ({ off: 0, expressive: 1.6 }[html.getAttribute('data-gz-motion')] ?? 1),
    };
  };
  const syncScene = () => {
    // An extension reload leaves the last frame in place.
    if (!chrome.runtime?.id) return;
    if (modBg) { stopScene(); return placeScene(); }
    const key = sceneSig();
    if (sceneRetry && sceneRetry.key !== key) { clearTimeout(sceneRetry.timer); sceneRetry = null; sceneFailed = false; }
    if (scenePending && scenePending.key !== key) scenePending = null;
    if (!settings.enabled || !links.length || !sceneKind() || !sceneFrame || !document.body || hid() || sceneBad === key) return stopScene();
    if (sceneFailed || scenePending) return;
    const file = sceneModule();
    if (scene && sceneFile !== file) stopScene();
    const wait = bgKind() === 'shader' && !globalThis.GZ_GLSL;
    if (scene && !wait) { try { scene.update(sceneOpts()); } catch (error) { retryScene(key, error); } return; }
    sceneLoad[file] ||= import(chrome.runtime.getURL(`${file}?r=${docId}-${++sceneLoadId}`)).catch((error) => { delete sceneLoad[file]; throw error; });
    const pending = scenePending = { key };
    Promise.all([sceneLoad[file], wait && need('lib/glsl.js', () => globalThis.GZ_GLSL).catch(() => {})]).then(([mod]) => {
      if (scenePending !== pending) return;
      if (!settings.enabled || sceneBad === key || !chrome.runtime?.id || !links.length || hid() || key !== sceneSig() || (bgKind() === 'shader' && !globalThis.GZ_GLSL)) { scenePending = null; return; }
      if (!scene) {
        sceneCanvas = document.createElement(file === 'lib/scene.js' ? 'canvas' : 'div');
        sceneCanvas.id = 'gz-scene';
        sceneCanvas.setAttribute('aria-hidden', 'true');
        placeScene();
        sceneFile = file;
        scene = mod.start(sceneCanvas, () => !!chrome.runtime?.id, (why) => { if (why === 'module') retryScene(sceneSig(), why); else { sceneBad = sceneSig(); stopScene(); } });
      }
      scene.update(sceneOpts());
      scenePending = null;
    }).catch((error) => { if (scenePending === pending) retryScene(key, error); });
  };
  document.addEventListener('glaze:parts', () => settings.enabled && links.length ? applySettings() : syncScene());

  // ---- course colors and tint ------------------------------------------------------------------
  // Every course its own color (GZ_COURSE_COLORS), worked out from the course list recordCourses
  // keeps. Inside a course picked in the editor, the palette also leans toward it (GZ_TINT). A
  // course's own pages carry its color slot on the course section; its item pages carry nothing, so
  // the slot is remembered per course id, on this device. flush() re-checks on every page change.
  const courseSlots = {};
  let courseList = {};
  const surfaceCourse = () => chrome.runtime?.id ? GZ_COURSE_COLOR(settings, courseList, ultra ? courseId() : canvasCourseKey()) : '';
  let cc = []; // worked out once per list and picks
  const courseColors = () => { const p = settings.courses.colors; if (cc[0] !== courseList || cc[1] !== p) cc = [courseList, p, GZ_COURSE_COLORS(courseList, p)]; return cc[2]; };
  try {
    chrome.storage.local.get(['courseSlots', 'seenCourses'], (r) => {
      Object.assign(courseSlots, r?.courseSlots);
      courseList = r?.seenCourses || {};
      reapply();
    });
  } catch { /* extension reloaded under the tab */ }
  // Each course's color on the page's own elements of it is the site part's: Ultra's slots, Canvas's breadcrumb and
  // tabs (X.paintCourses).
  const varText = (v) => Object.entries(v).map(([k, x]) => `${k}:${x}`).join(';');
  // The course tinting the page now, as { key, color } (Canvas, Moodle: the course list's color), Ultra's as { key, slot,
  // vars } (X.tintOf), or null.
  const tintOf = () => {
    if (ultra) return X.tintOf();
    const id = canvasCourseKey();
    const color = courseList[id]?.color;
    return color && settings.courses.tint && settings.courses.tinted.includes(id) && chrome.runtime?.id ? { key: `${id};${color}`, color } : null;
  };
  const tintKey = () => tintOf()?.key || null;
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
  // The popover itself, and the edits it makes, are features/coursemenu.js, loaded when a button is first pointed at.
  // Nicknames, swapped into Ultra's own text, are content-ultra.js' (X.nickOf, X.syncNames).
  const CARD = 'article[id^="course-list-course-"]';

  // -- the button on each card --
  const menuOn = () => !!observer && settings.enhance.coursemenu && solo && !isPreview;
  const syncCourseMenu = () => {
    const on = menuOn();
    for (const card of document.querySelectorAll(ultra ? CARD : moodle ? '[data-region="course-content"]' : '.ic-DashboardCard')) {
      const cid = ultra ? (card.dataset.courseId || card.id.slice(19)) : canvasCourseKey(moodle ? card.dataset.courseId : card.querySelector('a[href*="/courses/"]')?.getAttribute('href').match(/\/courses\/(\d+)/)?.[1]);
      let b = card.querySelector(':scope > .gz-cm-btn');
      if (b && (!on || b.dataset.cid !== cid || !courseList[cid])) { b.remove(); b = null; }
      if (!on || !courseList[cid]) continue;
      const label = t(moodle ? 'Tint and look for {name}' : 'Colour and look for {name}', { name: X.nickOf(cid) || courseList[cid].name });
      if (!b) {
        // Inside Ultra's card, positioned over its corner (extras.css); document-level capture listeners take
        // its events, below.
        b = docButton('paint', label, () => {});
        b.className = 'gz-cm-btn';
        b.id = `gz-cm-${cid}`; // gz- ids are skipped by the sweep
        b.dataset.cid = cid;
        b.setAttribute('aria-haspopup', 'dialog');
        b.setAttribute('aria-expanded', String(globalThis.GZ_COURSE_MENU?.cid() === cid));
        card.append(b);
      } else if (b.getAttribute('aria-label') !== label) {
        b.setAttribute('aria-label', label);
        // While the pointer is on it, its title is in the tooltip (onTip).
        if (b.dataset.gzTitle !== undefined) b.dataset.gzTitle = label; else b.title = label;
      }
    }
    globalThis.GZ_COURSE_MENU?.sync(on);
    if (ultra) X.syncNames(); else syncCards();
  };
  // Canvas's dashboard cards: features/cards.js.
  const cardUI = (f) => need('features/cards.js', () => globalThis.GZ_CARD_UI).then(() => f(GZ_CARD_UI), () => {});
  const syncCards = () => { if (moodle) globalThis.GZ_MOODLE_PAGE?.paint(); else if (!isPreview && location.pathname === '/') cardUI((m) => m.paint()); };
  // Nothing of the extra left on the page: the theme or the extra is off.
  const unmenu = () => {
    globalThis.GZ_COURSE_MENU?.close(false, true);
    for (const b of document.querySelectorAll('.gz-cm-btn')) b.remove();
    X.unname();
  };

  // The button is taken at the document, in the capture phase, as the cards' counts are (openNew): Ultra's card
  // around it, and what Ultra listens for on the way down, never see a press of it. A press opens or closes
  // the popover on its click (a key press makes one); a key press is left to make it, not repeated here.
  // Pointing at a button, or focusing it, already asks for the popover's file, so it's in by the press.
  const menuUI = () => need('features/coursemenu.js', () => globalThis.GZ_COURSE_MENU);
  const onMenuButton = (e) => {
    const b = e.target instanceof Element && e.target.closest('.gz-cm-btn');
    if (!b) return;
    if (e.type === 'pointerover' || e.type === 'focusin') return menuUI();
    e.stopPropagation();
    if (e.type === 'pointerdown') e.preventDefault(); // don't blur the nickname before the click commits it
    if (e.type !== 'click') return;
    e.preventDefault();
    // When the file arrives: only if the button is still on the page and the menu still on.
    menuUI().then(() => { if (menuOn() && b.isConnected && b.getClientRects().length) GZ_COURSE_MENU.toggle(b); }, () => {});
  };
  for (const ev of ['click', 'pointerdown', 'pointerup', 'mousedown', 'mouseup', 'keydown', 'keyup', 'pointerover', 'focusin']) document.addEventListener(ev, onMenuButton, true);
  // ---- settings → <html> ----------------------------------------------------------------------
  // Everything set goes through these two, so clearSettings removes exactly what was set.
  const vars = new Set();
  const attrs = new Set();
  const setVar = (k, v) => { vars.add(k); if (html.style.getPropertyValue(k) !== String(v)) html.style.setProperty(k, v); };
  const setAttr = (k, v) => { attrs.add(k); if (v === false) html.removeAttribute(k); else if (html.getAttribute(k) !== (v === true ? '' : String(v))) html.setAttribute(k, v === true ? '' : v); };

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
  // restart them. Not in a tab's frame: its next page opts in too late.
  let fade = null;
  const syncPageFade = () => {
    const want = !ultra && !tabFrame && links.length && html.getAttribute('data-gz-motion') !== 'off' && !html.hasAttribute('data-gz-no-enter');
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
    setVar('--gz-surface-course', surfaceCourse());
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
      const course = on && X.courseColor(on.slot, on.vars);
      tinted = course ? on.key : null;
      colors = course ? GZ_TINT(base, course, s.courses.strength / 100) : base;
      if (course) for (const [v] of GZ_COLORS) setVar(v, colors[v]);
      X.paintCourses();
    } else {
      const on = tintOf();
      tinted = on?.key || null;
      if (on) {
        colors = GZ_TINT(base, on.color, s.courses.strength / 100);
        for (const [v] of GZ_COLORS) setVar(v, colors[v]);
      }
      X.paintCourses();
    }
    const surface = palette['--gz-surface'];
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
    for (const [key, value] of Object.entries(GZ_SURFACE_VARS(s))) setVar(key, value);
    // Fonts: the stacks are vars; a web font loads into the page once chosen (lib/fonts.js).
    setAttr('data-gz-font', s.look.font);
    setVar('--gz-font', GZ_FONTS.stack(s.look.font));
    setVar('--gz-font-head', s.look.head === 'auto' ? 'inherit' : GZ_FONTS.stack(s.look.head));
    setAttr('data-gz-font-mono', s.look.mono !== 'auto');
    setVar('--gz-font-mono', GZ_FONTS.stack(s.look.mono));
    for (const f of [s.look.font, s.look.head, s.look.mono]) GZ_FONTS.load(f);
    setAttr('data-gz-density', s.look.density);
    setAttr('data-gz-depth', String(s.look.depth));
    X.paintNav(s.nav);
    // Background: the kind is an attribute, the picture and its dim/blur are vars. An image that
    // fails to load (bad URL, a host's CSP) falls back to the gradient instead of a bare ground.
    const kind = bgKind() === 'image' && !s.bg.image ? 'gradient' : bgKind();
    setAttr('data-gz-bg', kind);
    setAttr('data-gz-scene', kind === 'scene' && s.bg.scene);
    // A scene's gradient fallback (until it draws, or without WebGL) takes its dim from intensity.
    const look = (kind === 'scene' || kind === 'shader' || kind === 'layers' || kind === 'media') && GZ_SCENE_LOOK(s.bg.intensity);
    setVar('--gz-bg-dim', `${look ? Math.round(look.dim * 100) : s.bg.dim}%`);
    setVar('--gz-bg-blur', `${look ? 0 : s.bg.blur}px`);
    GZ_BG_COLORS(s.bg.colors, colors).forEach((c, i) => setVar(`--gz-bg-${i + 1}`, c));
    setVar('--gz-bg-grad', GZ_GRADIENT(s.bg, OKLAB));
    setAttr('data-gz-bg-grain', s.bg.grain);
    if (kind === 'image') probeImage(s.bg.image);
    else setAttr('data-gz-bg-failed', false);
    // Motion: the system's reduced-motion setting wins over the level unless told otherwise.
    setAttr('data-gz-motion', s.motion.followSystem && calmMQ.matches ? 'off' : s.motion.level);
    if (s.motion.level === 'expressive') need('features/light.js', () => globalThis.GZ_LIGHT).catch(() => {}); // the pointer light
    moveParts();
    setAttr('data-gz-no-trans', !s.motion.transitions);
    setAttr('data-gz-no-enter', !s.motion.enter);
    setAttr('data-gz-no-hover', !s.motion.hover);
    syncPageFade();
    setAttr('data-gz-footer', s.footer && window.top === window);
    // Extras: CSS is gated on these; a switch turned on needs one pass over what is already there.
    const was = enhanced;
    enhanced = s.enhance;
    for (const k of Object.keys(s.enhance)) setAttr(`data-gz-enhance-${k}`, s.enhance[k]);
    // Waiting for the page's words: the pass that brings them in draws all of this.
    const said = observer && words();
    if (said && ['scores', 'urgency', 'inline', 'overall'].some((k) => s.enhance[k] && !was[k])) tagExtras([document.body]);
    if (said) { X.renderProgress(); X.renderCalc(); syncDownloads(); syncCourseMenu(); X.syncTodo(); X.syncCardTasks(); X.syncRemind(); X.syncSyl(); X.syncWidgets(); X.syncInsights(); X.syncNav(); }
    if (!s.enhance.newgrades) { clearTags(['data-gz-new']); for (const p of document.querySelectorAll('.gz-new[data-kind="grades"]')) p.remove(); }
    if (!s.enhance.newcontent) for (const p of document.querySelectorAll('.gz-new:not([data-kind="grades"])')) p.remove();
    if (said) X.renderNew();
    if (was.drafts && !s.enhance.drafts) { globalThis.GZ_DRAFT_UI?.drop(true); tidyDrafts(); }
    // Declutter: CSS hides by these.
    for (const k of ['help', 'banner', 'faculty']) setAttr(`data-gz-hide-${k}`, s.declutter[k]);
    for (const [slug] of GZ_TABS) setAttr(`data-gz-hide-tab-${slug}`, s.declutter.tabs.includes(slug));
    if (!s.enhance.keys) globalThis.GZ_KEYS?.off();
    syncFooter();
    // The light/dark tags only apply to a dark theme: re-sweep when that flips.
    if (dark !== darkTheme) {
      darkTheme = dark;
      hoverSeen = new WeakSet();
      focusSeen = new WeakSet();
      if (observer) { clearTags(['data-gz-light', 'data-gz-dark', 'data-gz-hover']); sweepAll(); }
    } else if (dark && surface !== colors['--gz-surface']) relift();
    if (!s.look.tooltips) hideTip();
    if (said) syncDocTools();
    syncScene();
    themeEditors();
    armFlip();
  };
  // Scheduled dark's clock loads while a schedule is worn.
  const onSchedule = () => (links.length && worn.auto.on && worn.auto.mode === 'schedule' ? worn.auto : null);
  const armFlip = () => {
    if (onSchedule() || globalThis.GZ_SCHEDULE) need('features/schedule.js', () => globalThis.GZ_SCHEDULE).then(() => GZ_SCHEDULE.arm({ auto: onSchedule, reapply }), () => {});
    // The pointer, Look rotation and this page's stickers (features/lookx.js) load once one is in use.
    const k = `stk:${location.origin}${location.pathname.replace(/(.)\/+$/, '$1')}`, x = settings.extras;
    local((l) => l.get(k, (r) => { if (globalThis.GZ_LOOKX || links.length && (x.cursor !== 'off' || x.rotate !== 'off' || x.stickers && r?.[k]?.length)) need('features/lookx.js', () => globalThis.GZ_LOOKX).then(() => GZ_LOOKX.sync(), () => {}); }));
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
        const l = (ultra && globalThis.GZ_SITE_ULTRA?.sheets?.shift()) || document.createElement('link');
        // The tint reads the course color theme.css resolves: none before it loads.
        l.addEventListener('load', () => { if (tintKey() !== tinted) reapply(); }, { once: true });
        // Moving/reassigning an early Ultra sheet restarts its load and can release its render blocker.
        if (!l.isConnected) {
          l.rel = 'stylesheet';
          l.href = chrome.runtime.getURL(f);
          // Hold the first paint until the sheets are in. A script-inserted sheet does not block rendering
          // on its own, so a page's first paint was Canvas's own, white. Chrome 105+, Safari 18.2+; ignored
          // elsewhere, and only counts while the document has no body (as here, at document_start). A sheet that
          // fails lets go at once; one that never answers would hold the page forever, so it lets go after 1 s.
          if (!document.body) {
            l.setAttribute('blocking', 'render');
            setTimeout(() => l.removeAttribute('blocking'), 1000);
          }
          (document.head || html).appendChild(l);
        }
        return l;
      });
    }
    applySettings();
    onBody(async () => {
      if (!links.length) return;
      if (!(ultra ? isUltra() : isCanvas())) { disable(); notUltra = true; return; }
      if (!ultra) await ready;
      // The site's part still on its way: the theme is on already; the sweep and the extras wait for it.
      if (partIn) await partIn;
      if (!links.length) return;
      if (!on(settings)) return disable();
      syncFooter();
      startSweep();
      syncScene();
      moveParts();
    });
  };
  const disable = () => {
    hideTip();
    globalThis.GZ_PEEK?.hide();
    if (!ultra) globalThis.GZ_DOWNLOAD?.stop();
    globalThis.GZ_KEYS?.off();
    globalThis.GZ_MOTIONX?.off();
    globalThis.GZ_CMD?.close();
    for (const id of ['gz-progress', 'gz-calc', 'gz-gpa']) document.getElementById(id)?.remove();
    for (const p of document.querySelectorAll('.gz-new, .gz-card-grade')) p.remove();
    globalThis.GZ_DRAFT_UI?.drop();
    for (const b of document.querySelectorAll('.gz-dl')) b.remove();
    unmenu();
    for (const l of links) l.remove();
    links = [];
    armFlip();
    X.syncTodo();
    X.syncCardTasks();
    X.syncWidgets();
    X.syncRemind();
    X.syncSyl();
    X.syncInsights();
    themeEditors();
    syncPageFade();
    stopScene();
    stopSweep();
    syncRules();
    clearSettings();
    globalThis.GZ_NAV_UI?.sync();
    syncDocTools();
    syncFooter();
  };

  const reapply = () => { if (settings.enabled && links.length) applySettings(); };

  // ---- the site's own part -------------------------------------------------------------------------
  // content-ultra.js or content-canvas.js is given what it needs from here (I; live state through getters), and puts
  // its own over X. A page that hasn't it (its host was registered for Moodle) asks for it, and the theme doesn't wait:
  // only the sweep and the extras do (enable). Without it, the theme stays on.
  const I = { C, html, isPreview, solo, tabFrame, need, t, locale, api, capi, canvasCourseKey, canvasCourseId, courseId, celebrate, markDue, drawProgress, cardBadge, KIND,
    cardsInView, inView, tagCards, tagExtras, courseSlots, courseColors, varText, CARD, dueLabelled, setVar, setAttr,
    setCourseList: (all) => { courseList = all; X.paintCourses(); syncCourseMenu(); reapply(); },
    get settings() { return settings; }, get observer() { return observer; }, get links() { return links; }, get timer() { return timer; },
    get courseList() { return courseList; }, get worn() { return worn; } };
  const part = { ultra: 'GZ_SITE_ULTRA', canvas: 'GZ_SITE_CANVAS' }[site];
  const takePart = () => { if (part && globalThis[part]) Object.assign(X, globalThis[part](I)); };
  const partIn = part && !globalThis[part] && need(`content-${site}.js`, () => globalThis[part]).then(() => { takePart(); reapply(); }, () => {});
  if (!partIn) takePart();
  // Moodle has no part: a worn Look's nav layout (x.nav, features/nav.js) is all Glaze does to its nav.
  if (moodle) X.syncNav = () => { if (window.top === window && ((links.length && GZ_CTX.parts()?.nav) || globalThis.GZ_NAV_UI)) need('features/nav.js', () => globalThis.GZ_NAV_UI).then(() => GZ_NAV_UI.sync(), no); };
  // Wearing or taking off a Look can change the nav's layout (GZ_CTX.parts).
  document.addEventListener('glaze:parts', () => { if (links.length) X.syncNav(); });

  // The helpers a file loaded by need() may use (features/*.js): this frame's, through one name. The part's are asked
  // of it when called, so a part that comes late still answers.
  globalThis.GZ_CTX = Object.freeze({ need, t, locale, capi, local, canvasCourseId, celebrate, moment, gradeMoment, settings: () => settings, nav: () => worn.nav, repaintNav: (src) => X.paintNav(worn.nav, src), on: () => !!observer && !!chrome.runtime?.id,
    // The palette, the keys, the course menu, the previews and Download all (W0c).
    site, wordsIn, typing, keyOn, make, dueWeek, moodleIn, courseId, toggleOf,
    nickOf: (cid) => X.nickOf(cid), courseList: () => courseList, courseColors, varText, cardUI,
    setCourses: (c) => { settings = { ...settings, courses: c }; applySettings(); },
    // Draft backup, Ultra's what-if calculator, the document buttons and your place in a course (W0d).
    draftEditor: DRAFT_ED, draftAt, docButton, setVar, setDark, PREVIEWS, DOC, darkTheme: () => darkTheme,
    // Look parts stay off on courses with their own Look; changes fire `glaze:parts`.
    parts: () => (on(settings) && (!isPreview || html.dataset.previewPage !== 'quiz') && !lookHere() && (globalThis.GZ_MODS ? GZ_MODS.parts(globalThis.GZ_XPARTS_PAGE?.now() || null) : globalThis.GZ_XPARTS_PAGE?.now())) || null,
    background: (el) => { if (modBg && modBg !== el) modBg.remove(); modBg = el || null; syncScene(); },
    canvasCourseKey, ROWS, holding: () => X.holding(), tapped: () => tapped, acted: () => acted, placeAsked: () => placeAsked, solo, tabFrame, scene: () => { syncScene(); if (full && !timer && !hid()) timer = setTimeout(flush); },
    ...Object.fromEntries(['me', 'canvasCourses', 'profile', 'canvasPeek', 'moduleItems', 'myCourses', 'courseItems', 'bookFor', 'courseColor'].map((k) => [k, (...a) => X.ctx[k](...a)])) });

  // Independent card/widget stores aren't theme settings; don't transfer them on every page load.
  let lookX;
  const load = () => new Promise((res) => {
    try { chrome.storage.sync.get([...Object.keys(GZ_DEFAULTS), 'lookX'], (raw) => { lookX = chrome.runtime.lastError ? undefined : raw?.lookX; res(GZ_SANITIZE(chrome.runtime.lastError ? {} : raw)); }); }
    catch { res(GZ_SANITIZE()); }
  }).then((s) => {
    // Not the nicknames: they're Ultra's, and this tab's sessionStorage is the page's to read too.
    try { sessionStorage.setItem(KEPT, JSON.stringify({ ...s, courses: { ...s.courses, names: {} } })); } catch { /* blocked or full */ }
    return s;
  });
  // The previous palette covers storage latency, avoiding a dark flash with a light look.
  const KEPT = 'gz-settings';
  try { const kept = sessionStorage.getItem(KEPT); if (kept) settings = GZ_SANITIZE(JSON.parse(kept)); } catch { /* none */ }
  // Keep quizzes light: no Glaze on a quiz being taken or a tool's page (New Quizzes; seen once the body is in).
  const on = (s) => s.enabled && (ultra || !s.enhance.quizLight || !(/\/quizzes\/\d+\/(take|history)(\/|$)|\/external_tools\//.test(location.pathname) || document.getElementById('tool_content')));
  // Theme on before storage answers: most people leave it on, and this way the first paint is
  // already themed. If it turns out to be off, it comes straight back off.
  const ready = load().then((s) => {
    settings = s;
    tidyDrafts();
    if (!on(s)) disable();
    else if (links.length) applySettings();
    else enable();
  });
  if (on(settings)) enable();
  // Load parts after the theme, only when present.
  const partsIn = (m) => {
    if (solo && !isPreview && (m || lookX || globalThis.GZ_XPARTS_PAGE)) need('features/lookparts.js', () => globalThis.GZ_XPARTS_PAGE).then(() => GZ_XPARTS_PAGE.read(), () => {});
  };
  // Mods start only in the top frame; parts also reach live course tabs.
  const modsIn = (parts = false) => {
    if (solo && !isPreview && on(settings)) local((l) => l.get('mods', (r) => {
      if (parts) partsIn(r?.mods?.length);
      if (!r?.mods?.length || window.top !== window || (globalThis.GZ_MODS && globalThis.GZ_MODWIDGETS)) return;
      chrome.runtime.sendMessage({ type: 'glaze:modpage', op: 'list' }).then((a) => {
        if (a?.mods?.length && !globalThis.GZ_MODS && chrome.runtime.getManifest().sandbox) need('features/mods.js', () => globalThis.GZ_MODS).then(() => GZ_MODS.start());
        if (a?.plain?.length && !globalThis.GZ_MODWIDGETS) need('features/modwidgets.js', () => globalThis.GZ_MODWIDGETS).then(() => GZ_MODWIDGETS.start());
      }, no);
    }));
  };
  ready.then(() => modsIn(true));
  // The preview is fed the editor's state directly, before it is saved, and ignores storage so a
  // save landing late can't undo an edit that is further along.
  if (isPreview) {
    addEventListener('message', (e) => {
      if (e.origin !== location.origin || e.source !== parent || !e.data?.gzPreview) return;
      globalThis.GZ_XPARTS_PAGE?.preview(e.data.gzPreviewParts);
      const was = settings.enabled && links.length > 0;
      settings = GZ_SANITIZE(e.data.gzPreview);
      if (settings.enabled && !was) enable();
      else if (!settings.enabled && was) disable();
      else if (settings.enabled) applySettings();
    });
  }
  chrome.storage.onChanged.addListener((changes, area) => {
    if (changes.lookX && area === 'sync') lookX = changes.lookX.newValue;
    if (area === 'local' && Object.keys(changes).some((k) => /^mod(s$|:|Dev$|Order$|sBlocklist$)/.test(k))) modsIn(true);
    else if (changes.lookX && (area !== 'sync' || !changes.enabled)) partsIn();
    if (area === 'local' && changes.seenCourses) {
      courseList = changes.seenCourses.newValue || {};
      reapply();
    }
    if (area !== 'sync' || isPreview || !Object.keys(changes).some((k) => k in settings || k in GZ_SPEC)) return;
    load().then((s) => {
      const was = settings.enabled && links.length > 0;
      settings = s;
      if (on(s) && !was) enable();
      else if (!on(s) && was) disable();
      else if (on(s)) applySettings();
      if (changes.enabled) modsIn(true);
    });
  });
  // Moodle's course is on <body>: its tint and look before that is drawn.
  if (moodle && !document.body) new MutationObserver((_, o) => document.body && (o.disconnect(), reapply())).observe(html, { childList: true });
  darkMQ.addEventListener('change', reapply);
  calmMQ.addEventListener('change', reapply);
})();
