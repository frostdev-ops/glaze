// Glaze — content script, document_start.
// Jobs: (1) put the stylesheets on the page while the theme is on (<link>s we own, so the popup can
// toggle them without a reload), (2) push settings onto <html> — colors and look values as inline
// --gz-* vars, everything else as data-gz-* attributes — so the CSS never branches here,
// (3) the long tail: tag what no selector can reach and let the CSS restyle the tag.
// It runs on three sites: Blackboard Ultra, which gets all of that plus its extras (everything marked
// Extras below), and Canvas LMS, which gets (1) to (3), with its own stylesheet, and three extras: Due this
// week, the command palette and grades on the dashboard's course cards (marked Canvas below). Moodle is themed as
// Canvas is (moodle.css), and its three of those load on demand (moodleIn).
(async () => {
  // Only HTML pages: an /ultra/ address can also be an XML error from Ultra's CDN, or a raw script.
  if (window.__gzGlaze || !/html/.test(document.contentType)) return;
  window.__gzGlaze = true;

  // The options preview is Ultra. On a site, decide once from its head while the parser is still there;
  // addresses and body classes can belong to another app or a same-host tool.
  const isPreview = /-extension:$/.test(location.protocol); // chrome-, moz-, safari-web-extension:
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
  if (!site) return;
  const ultra = site === 'ultra';
  const moodle = site === 'moodle';

  const C = GZ_COLOR;
  const html = document.documentElement;
  const SKIP = /^(img|video|canvas|svg|iframe|picture|source|path|use|script|style|link|meta)$/i;
  const TAGS = ['data-gz-light', 'data-gz-dark', 'data-gz-fixed-bottom', 'data-gz-vh', 'data-gz-rule', 'data-gz-score', 'data-gz-due', 'data-gz-hover', 'data-gz-pct', 'data-gz-countdown', 'data-gz-chip', 'data-gz-grade', 'data-gz-held', 'data-gz-loading', 'data-gz-reveal', 'data-gz-new', 'data-gz-brand-bg', 'data-gz-brand-fg', 'data-gz-lift'];
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
  const SHEETS = ultra ? ['theme.css', 'motion.css', 'extras.css'] : [`${site}.css`, 'motion.css'];

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
  // A field's own text is its value, not a text node; on Canvas an InstUI field in a modal (a portal, outside #application) keeps Canvas's dark ink.
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
  // Canvas: a module item's "Mark as done" button (the page's own, or the newer assignment page's) and the
  // planner's checkboxes (the dashboard's List View). Canvas flips either once its request succeeds, so a
  // click is followed for five seconds and bursts there if it turns done; only a click starts one, so a page
  // that loads done never does. A module item's icon on the Modules page only changes as that page loads.
  const DONE_BY = '#mark-as-done-checkbox, #set-module-item-completion-button, input[data-testid="planner-item-completed-checkbox"]';
  const isDone = (el) => (el.matches('input') ? el.checked : el.classList.contains('btn-success') || !!el.querySelector('svg[name="IconComplete"]'));
  let following = null;
  document.addEventListener('click', (e) => {
    if (ultra || !e.isTrusted || html.getAttribute('data-gz-motion') !== 'expressive' || !(e.target instanceof Element)) return;
    const box = e.target.closest('label')?.control;
    const el = e.target.closest(DONE_BY) || (box?.matches(DONE_BY) && box);
    // A label's click passes on to its checkbox: one follow. A checkbox clicked itself has already
    // flipped when the click reaches it; through its label, or a button, flips after.
    if (!el || el === following || (e.target === el && el.matches('input') ? !el.checked : isDone(el))) return;
    following = el;
    const at = Date.now();
    const look = () => {
      const now = el.isConnected ? el : el.id && document.getElementById(el.id); // React may draw it anew
      if (now && isDone(now)) celebrate(now.labels?.[0] || now);
      else if (Date.now() - at < 5000) return setTimeout(look, 150);
      following = null;
    };
    setTimeout(look, 150);
  }, true);

  // ---- the student's courses -------------------------------------------------------------------
  // Every course and the color slot Ultra gives it, for the editor's course list and the tint on
  // pages that don't show the slot: from the membership list Ultra's own Courses page asks for, once
  // a page load and at most every ten minutes. Stored locally; nothing leaves the device.
  let canvasRecorded = false;
  const canvasCourseKey = (id = canvasCourseId()) => id ? `canvas:${location.origin}/${id}` : null;
  const recordCourses = () => {
    if (!ultra) {
      if (moodle || canvasRecorded || window.top !== window) return;
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
        : chrome.runtime.sendMessage({ type: 'glaze:load', files: [file], doc: docId }).then((r) => {
          if (!r?.ok) throw new Error(r?.error || 'not loaded');
          if (!ready()) throw new Error('ran, but not ready');
        });
      p.catch(() => setTimeout(() => { if (loading.get(file) === p) loading.delete(file); }, 60000));
      loading.set(file, p);
    }
    return loading.get(file);
  };
  // Moodle's extras, on first use: its data read (lib/moodle.js), then asked of the page's own Moodle.
  const moodleIn = () => need('lib/moodle.js', () => globalThis.GZ_MOODLE).then(() => need('features/moodle.js', () => globalThis.GZ_MOODLE_PAGE)).then(() => GZ_MOODLE_PAGE);
  // Better To Do (features/todo.js)
  const todoHere = () => !ultra && !moodle && links.length && settings.enhance.todo && /^\/(courses\/\d+\/?)?$/.test(location.pathname);
  const syncTodo = () => (todoHere() ? need('features/todo.js', () => globalThis.GZ_TODO_UI).then(() => GZ_TODO_UI.sync(todoHere()), () => {}) : globalThis.GZ_TODO_UI?.sync(false));
  // Tasks on the Dashboard's course cards (features/cardtasks.js), from the same planner answer.
  const cardsHere = () => !ultra && !moodle && links.length && settings.enhance.cardTasks && location.pathname === '/';
  const syncCardTasks = () => (cardsHere() && document.querySelector('.ic-DashboardCard') ? need('features/cardtasks.js', () => globalThis.GZ_CARD_TASKS).then(() => GZ_CARD_TASKS.sync(cardsHere()), () => {}) : globalThis.GZ_CARD_TASKS?.sync(false));
  // Dashboard notes and widgets, floating ones on every page (features/widgets.js); the palette opens its hub.
  const widgetsHere = () => !ultra && !moodle && links.length && window.top === window && (settings.enhance.widgets || (settings.enhance.notes && location.pathname === '/'));
  const syncWidgets = () => (widgetsHere() ? need('features/widgets.js', () => globalThis.GZ_WIDGETS_UI).then(() => GZ_WIDGETS_UI.sync(widgetsHere()), () => {}) : globalThis.GZ_WIDGETS_UI?.sync(false));
  // Reminders and the streak (features/reminders.js): any page, top frame, once one is on.
  const remindHere = () => !ultra && !moodle && links.length && window.top === window && ['remind', 'remindExam', 'remindPlan', 'streak'].some((k) => settings.enhance[k]);
  const syncRemind = () => (remindHere() ? need('features/reminders.js', () => globalThis.GZ_REMIND_UI).then(() => GZ_REMIND_UI.sync(remindHere()), () => {}) : globalThis.GZ_REMIND_UI?.sync(false));
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
  // most once a minute per course, and only for courses on the page where one of those is showing.
  // Absolute URLs: Ultra's <base href> points at its CDN.
  // Canvas's REST API is the same thing under /api/v1 (capi): its string-id JSON keeps long ids exact, and an
  // older Canvas starts a response with `while(1);`.
  const api = (path, base = '/learn/api/v1', accept = 'application/json') => fetch(`${location.origin}${base}${path}`, { credentials: 'same-origin', headers: { accept } })
    .then((r) => (r.ok ? r.text() : Promise.reject(r.status))).then((text) => JSON.parse(text.replace(/^while\(1\);/, '')));
  const capi = (path) => api(path, '/api/v1', 'application/json+canvas-string-ids');
  // Progress and new-content badges share this exact capped list; news can refresh after five minutes.
  const canvasModuleLists = new Map();
  const canvasModules = (cid) => {
    let c = canvasModuleLists.get(cid);
    if (!c || Date.now() - c.at >= 300000) {
      c = { at: Date.now() };
      c.p = capi(`/courses/${cid}/modules?include[]=items&per_page=100`).catch((e) => {
        if (canvasModuleLists.get(cid) === c) canvasModuleLists.delete(cid);
        throw e;
      });
      canvasModuleLists.set(cid, c);
    }
    return c.p;
  };
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
    if (moodle) return document.querySelector('[data-region="course-content"]') && moodleIn().then((m) => m.cards(), () => {});
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
  const canvasCourses = () => (canvasList ||= capi('/courses?enrollment_state=active&include[]=total_scores&include[]=current_grading_period_scores&include[]=restrict_quantitative_data&include[]=term&per_page=100')
    .then((j) => (Array.isArray(j) ? j : []), () => { setTimeout(() => { canvasList = null; }, 60000); return []; })); // asked again after a minute
  // Your profile (id, time zone), asked once a page for whoever needs it; again after a failure.
  let mine = null;
  const profile = () => (mine ||= capi('/users/self/profile').catch((e) => { mine = null; throw e; }));
  // The chip is drawn after the course code (canvas.css), inside the card's link: a click on it opens the grades.
  if (!ultra) addEventListener('click', (e) => {
    const el = settings.enhance.overall && e.target.closest?.('.ic-DashboardCard [data-gz-grade]');
    const r = el && document.createRange();
    if (!r) return;
    r.selectNodeContents(el);
    const b = r.getBoundingClientRect();
    if (html.dir === 'rtl' ? e.clientX >= b.left : e.clientX <= b.right) return; // on the code, not the chip
    e.preventDefault();
    const url = `${el.closest('a').href}/grades`;
    if (e.ctrlKey || e.metaKey) open(url); else location.assign(url);
  }, true);
  const tagCanvasCards = () => {
    if (!document.querySelector('.ic-DashboardCard')) return;
    canvasCourses().then((list) => {
      if (!observer) return; // switched off while it was asked
      const grades = GZ_PAGE.canvasOverall(list, locale());
      for (const card of document.querySelectorAll('.ic-DashboardCard')) {
        const el = card.querySelector('.ic-DashboardCard__header-subtitle, .ic-DashboardCard__header-term');
        if (!el) continue;
        const id = card.querySelector('a[href*="/courses/"]')?.getAttribute('href').match(/\/courses\/([^/?#]+)/)?.[1];
        const g = grades[id];
        if (g) { el.setAttribute('data-gz-grade', g.label); el.setAttribute('data-gz-chip', g.tone); } else { el.removeAttribute('data-gz-grade'); el.removeAttribute('data-gz-chip'); }
        // The same grade as a link of its own to the course's grades, for the keyboard and screen readers: right after
        // the card's link (next in Tab order), not in it, and shown when focused (canvas.css). Written only on a change.
        let a = card.querySelector('.gz-card-grade');
        if (!g) { a?.remove(); continue; }
        const name = t('Grades for {course}: {grade}', { course: card.getAttribute('aria-label') || id, grade: g.label });
        if (!a) el.closest('a')?.after(a = Object.assign(document.createElement('a'), { className: 'gz-card-grade' }));
        if (a.getAttribute('aria-label') !== name) { a.href = `/courses/${id}/grades`; a.textContent = g.label; a.setAttribute('aria-label', name); }
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
  // Canvas: the same extras on Canvas's markup, from the whole page each pass (a few selectors).
  // - Scores are read off the page, so a what-if score Canvas draws gets its bar too, and a course that restricts
  //   quantitative data (letters only) gets none: the course Grades page's cells and group totals, the Grades page
  //   of all courses, the Assignments index's "18/20 pts". The share goes beside points, never beside a percentage.
  // - Due dates on the Assignments index and Modules take the date and where the work stands from the course's
  //   assignments with the student's submission, asked once a page load (a module item names its assignment, quiz
  //   or topic in its class). The To Do sidebar's (dashboard, course home) are read from its text: only how long is
  //   left and never overdue, as Ultra's outside course content (an announcement's date there is when it was posted).
  const CANVAS_SCORES = '#grades_summary td.assignment_score .score_holder, .student_grades td.percent, div.ig-row[id^="assignment_"] .score-display';
  const CANVAS_DUE = 'div.ig-row[id^="assignment_"][data-item-id] .assignment-date-due, li.context_module_item .due_date_display';
  let canvasWork = null;
  const workIn = (cid) => {
    if (canvasWork?.cid !== cid) {
      const w = (canvasWork = { cid, by: null });
      capi(`/courses/${cid}/assignments?include[]=submission&per_page=100`).then((list) => {
        // ponytail: the first 100 assignments, no paging.
        w.by = new Map((Array.isArray(list) ? list : []).flatMap((a) => [[`Assignment_${a.id}`, a], ...(a.quiz_id ? [[`Quiz_${a.quiz_id}`, a]] : []),
          ...(a.discussion_topic?.id ? [[`DiscussionTopic_${a.discussion_topic.id}`, a]] : [])]));
        if (observer && canvasWork === w) tagExtras([document.body]);
      }, () => {});
    }
    return canvasWork.by;
  };
  const tagCanvasExtras = () => {
    const { scores, urgency, inline } = settings.enhance;
    if (!scores && !urgency && !inline) return;
    const now = new Date();
    const loc = locale();
    if (scores || inline) {
      for (const el of document.querySelectorAll(CANVAS_SCORES)) {
        // The Grades page's cell keeps Canvas's own numbers in a hidden block beside the shown ones.
        const shown = el.matches('.score_holder') ? el.querySelector(':scope > .tooltip') : el;
        const sc = GZ_PAGE.canvasScore(shown?.textContent);
        if (scores && sc && el.style.getPropertyValue('--gz-score') !== String(sc.ratio)) el.style.setProperty('--gz-score', sc.ratio);
        if (scores && sc) el.setAttribute('data-gz-score', sc.band);
        else el.removeAttribute('data-gz-score');
        if (inline && sc?.max) shown.setAttribute('data-gz-pct', GZ_I18N.pct(Math.round(sc.ratio * 100), loc));
        else shown?.removeAttribute('data-gz-pct');
      }
    }
    if (!urgency && !inline) return;
    const due = document.querySelectorAll(CANVAS_DUE);
    const by = due.length && canvasCourseId() && workIn(canvasCourseId());
    if (by) {
      for (const el of due) {
        const index = el.matches('.assignment-date-due');
        const a = by.get(index ? `Assignment_${el.closest('.ig-row').dataset.itemId}` : el.closest('li').className.match(/\b(?:Assignment|Quiz|DiscussionTopic)_\d+\b/)?.[0]);
        const state = urgency && a?.due_at && !GZ_PAGE.isDone(null, GZ_PAGE.canvasGrade(a)) && GZ_PAGE.due(new Date(a.due_at), now, loc);
        markDue(el, state, inline && GZ_PAGE.canvasStatus(a, now, loc, index));
      }
    }
    for (const el of document.querySelectorAll('[data-testid="ToDoSidebarItem__InformationRow"] > li')) {
      const d = GZ_PAGE.canvasDate(el.textContent, loc, now);
      const w = d?.timed && GZ_PAGE.when(d, now, loc);
      const state = urgency && w && !w.past && GZ_PAGE.due(d.at, now, loc);
      markDue(el, state, inline && w && !w.past && { label: w.rel, tone: '' });
    }
  };
  const tagExtras = (roots) => {
    tagCards();
    if (!ultra) return tagCanvasExtras();
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
          // The chip is drawn by CSS from these attributes: no element is added to Ultra's tree. In course
          // content it says where the work stands; elsewhere only how long is left, never how long ago.
          let chip = null;
          if (inline && (item || pageId)) chip = GZ_PAGE.status(at, circle, grade, now, late, loc);
          else if (inline) {
            const w = GZ_PAGE.when(at, now, loc, true);
            if (w && !w.past) chip = { label: w.rel, tone: '' };
          }
          markDue(el, state, chip);
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
    const said = words();
    const all = full || (said && wordsLate);
    if (full) { full = false; sweepAll(); } else sweepRoots(roots);
    if (said) { tagExtras(all ? [document.body] : roots); wordsLate = false; } else wordsLate = true;
    // Both sites run the same list; a helper that isn't on Canvas yet returns at its top (`if (!ultra) return`).
    themeEditors();
    if (tip && ultraTipShown()) hideTip();
    paintCourses();
    if (tintKey() !== tinted || lookHere() !== looked) applySettings();
    placeScene();
    if (!said) return;
    if (all) syncNav();
    renderProgress();
    renderNew();
    keepPlace();
    renderCalc();
    watchDrafts();
    syncDownloads();
    syncDocTools();
    syncCourseMenu();
    syncTodo();
    syncCardTasks();
    syncWidgets();
    syncRemind();
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
    if (window.top === window && !todoHere() && !cardsHere()) dueWeek();
    if (!ultra) liftCourses();
    recordCourses();
    if (!ultra) paintCourses();
    if (!words()) { wordsLate = true; return; }
    tagExtras([document.body]);
    watchDrafts();
    syncCourseMenu();
    syncNav();
    if (!ultra) renderProgress();
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
    const text = titled?.getAttribute('title')?.trim();
    if (titled && !text && !hinted) return;
    if (text) {
      tipFor = titled;
      titled.dataset.gzTitle = text;
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
  const peeks = new Map();
  // Canvas paginates these lists; cache complete answers, shared by previews and module downloads.
  const canvasPeekList = async (path) => {
    const out = [];
    for (let page = 1; ; page++) {
      const rows = await capi(`${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
      if (!Array.isArray(rows)) throw new Error('Invalid list');
      out.push(...rows);
      if (rows.length < 100) return out;
    }
  };
  const canvasPeek = (path) => {
    const key = `canvas:${path}`;
    const hit = peeks.get(key);
    if (hit && Date.now() - hit.at < 60000) return hit.p;
    const p = canvasPeekList(path).catch((e) => { peeks.delete(key); throw e; });
    peeks.set(key, { at: Date.now(), p });
    return p;
  };
  const moduleItems = (cid, mid, fresh = false) => (fresh ? canvasPeekList : canvasPeek)(`/courses/${cid}/modules/${mid}/items?include[]=content_details`);
  // What a folder or module holds, shown when the pointer rests on its row: features/previews.js, loaded the first
  // time it does (or, on Canvas, focus reaches one), then handed that event if the row is still where it was.
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
  // One bar above the course outline adding up what the outline already says: each folder's
  // "N of M completed" (in any language: lib/page.js) plus each top-level item's review circle. Redrawn
  // only when the numbers move. The Content page only: other course tabs (Discussions) list items too.
  // On Canvas the outline with a done state is Modules: the bar adds up the completion requirements the
  // course sets, done or not as Canvas's own API has them for this student (asked once a page), above the
  // Modules list, also on a course home that shows it. A course that sets none gets no bar: Canvas calls
  // a module without requirements "completed", and it hides that itself, as nothing there was asked of you.
  let reqs = null; // Canvas: { cid, progress: { done, total } | null }, null when the whole total isn't known
  const canvasProgress = () => {
    const old = document.getElementById('gz-progress');
    const cid = canvasCourseId();
    const list = observer && settings.enabled && settings.enhance.progress && /^\/courses\/\d+(\/modules)?\/?$/.test(location.pathname) && document.getElementById('context_modules_sortable_container');
    if (!list) return old?.remove();
    if (reqs?.cid !== cid) {
      const r = (reqs = { cid });
      // shortcut: hide incomplete module lists; follow Link and items_url if large-course progress is needed.
      canvasModules(cid).then((mods) => {
        r.progress = GZ_PAGE.canvasProgress(mods);
        if (reqs === r) renderProgress();
      }).catch(() => {});
      return;
    }
    if (!reqs.progress?.total) return old?.remove();
    drawProgress(old, reqs.progress.done, reqs.progress.total, list);
  };
  const renderProgress = () => {
    if (!ultra) return canvasProgress();
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
    drawProgress(old, done, total, top[0].parentElement);
  };
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
    if (!ultra) return renderCanvasNew();
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

  // Canvas keeps unread grade dots itself. A passive HTML GET reads those exact dots, without running
  // the grade page's scripts. The submissions API's include[]=read_state would mark submissions read.
  // Keep only counts and module ids, scoped to this host AND signed-in user; five-minute cache across pages.
  // shortcut: first 100 modules; Canvas omits items in oversized modules. Don't guess at their contents.
  let canvasNews = null, canvasNewsLoad = null, canvasNewsUser = null;
  const canvasNewsPending = new Set(), canvasNewsShown = new Map();
  const canvasNewsKey = (cid) => `${location.origin}/${canvasNewsUser}/${cid}`;
  const canvasNewsStore = `canvasNews:${location.origin}`;
  // One origin's map is one write boundary; hold its lock until storage's set callback completes.
  let canvasNewsWrite = Promise.resolve();
  const saveCanvasNews = (key, patch) => {
    const write = () => new Promise((done) => {
      try { chrome.storage.local.get(canvasNewsStore, (r) => {
        const record = GZ_GRADES.canvasNewsRecord(r ? r[canvasNewsStore]?.[key] : canvasNews[key], patch);
        canvasNews[key] = record;
        try { chrome.storage.local.set({ [canvasNewsStore]: { ...r?.[canvasNewsStore], [key]: record } }, done); } catch { done(); }
      }); } catch { canvasNews[key] = GZ_GRADES.canvasNewsRecord(canvasNews[key], patch); done(); } // extension reloaded under the tab
    });
    // shortcut: without usable Web Locks, writes are ordered within this tab only.
    return canvasNewsWrite = canvasNewsWrite.then(() => navigator.locks?.request ? navigator.locks.request(`glaze:${canvasNewsStore}`, write).catch(write) : write());
  };
  const loadCanvasNews = () => {
    canvasNewsLoad ||= Promise.all([capi('/users/self').then((u) => u.id), new Promise((resolve) => {
      try { chrome.storage.local.get(canvasNewsStore, (r) => resolve(r?.[canvasNewsStore] || {})); } catch { resolve({}); }
    })]).then(([id, kept]) => {
      if (!id) throw new Error('No Canvas user');
      canvasNewsUser = String(id); canvasNews = kept; renderNew();
    }).catch(() => { setTimeout(() => { canvasNewsLoad = null; }, 60000); });
  };
  const askCanvasNews = (cid, kind) => {
    const key = canvasNewsKey(cid), kept = canvasNews[key]?.[kind], pending = `${key}/${kind}`;
    if (kept && Date.now() - kept.at < 300000 || canvasNewsPending.has(pending) || document.hidden) return kept;
    canvasNewsPending.add(pending);
    const p = kind === 'items' ? canvasModules(cid).then(GZ_GRADES.canvasItems)
      : fetch(`${location.origin}/courses/${cid}/grades`, { credentials: 'same-origin', headers: { accept: 'text/html' } })
        .then((r) => r.ok && new URL(r.url).origin === location.origin && new URL(r.url).pathname === `/courses/${cid}/grades` ? r.text() : Promise.reject())
        .then((text) => {
          const doc = new DOMParser().parseFromString(text, 'text/html');
          // Restricted and upgraded React grade pages have no server-rendered table: fail closed.
          return doc.querySelector('#grades_summary') ? doc.querySelectorAll('#grades_summary .unread_dot.grade_dot').length : null;
        });
    const at = kind === 'items' ? canvasModuleLists.get(cid).at : null;
    p.then((value) => saveCanvasNews(key, { [kind]: { at: at ?? Date.now(), value } }), () => saveCanvasNews(key, { [kind]: { at: Date.now(), value: null } })).finally(() => {
      canvasNewsPending.delete(pending);
      if (observer && settings.enhance[kind === 'items' ? 'newcontent' : 'newgrades']) renderNew();
    });
    return kept;
  };
  const canvasNewsBadge = (host, cid, n, kind) => {
    let pill = host.querySelector(`:scope > .gz-new[data-kind="${kind}"]`);
    if (!n) return pill?.remove();
    if (!pill) {
      pill = document.createElement('a'); pill.className = 'gz-new'; pill.dataset.kind = kind;
      pill.href = `/courses/${cid}/${kind === 'grades' ? 'grades' : 'modules'}`;
      host.append(pill);
    }
    const text = t(kind === 'items' ? '{n} new items' : '{n} new', { n });
    if (pill.textContent !== text) pill.textContent = text;
    const label = t(KIND[kind], { n });
    if (pill.getAttribute('aria-label') !== label) pill.setAttribute('aria-label', label);
  };
  const renderCanvasNew = () => {
    const { newgrades, newcontent } = settings.enhance;
    if (!(newgrades || newcontent) || !observer || document.hidden || window.top !== window) return;
    const cid = canvasCourseId(), modules = cid && /^\/courses\/\d+(\/modules)?\/?$/.test(location.pathname) && document.querySelector('#context_modules');
    const grades = newgrades && cid && /^\/courses\/\d+\/grades\/?$/.test(location.pathname);
    const cards = location.pathname === '/' && document.querySelectorAll('.ic-DashboardCard');
    if (!(newcontent && modules || grades || cards?.length)) return;
    if (!canvasNews) return loadCanvasNews();
    // Native page scripts can mark grades read; refresh the passive count when the student returns.
    if (grades && canvasNews[canvasNewsKey(cid)]?.grades?.at) saveCanvasNews(canvasNewsKey(cid), { grades: { at: 0, value: null } });
    if (newcontent && modules) {
      const key = canvasNewsKey(cid), items = askCanvasNews(cid, 'items')?.value;
      if (items) {
        const rows = [...document.querySelectorAll('.context_module_item[id^="context_module_item_"]')];
        const looked = new Set(rows.filter((r) => r.getClientRects().length).map((r) => r.id.slice(20)));
        const was = canvasNews[key]?.seen;
        const { ids, seen: now } = GZ_GRADES.newItems(items, was, looked);
        const shown = canvasNewsShown.get(key) || new Set();
        for (const id of ids) shown.add(id);
        canvasNewsShown.set(key, shown);
        if (now !== was) saveCanvasNews(key, { seen: now });
        for (const row of rows) {
          const title = row.querySelector('.ig-title');
          if (title) cardBadge(title, cid, shown.has(row.id.slice(20)) ? 1 : 0, 'item');
        }
      }
    }
    let n = 0;
    for (const card of cards || []) {
      const id = card.querySelector('a[href*="/courses/"]')?.getAttribute('href').match(/\/courses\/(\d+)/)?.[1];
      const host = card.querySelector('.ic-DashboardCard__header');
      if (!id || !host) continue;
      cardsInView.observe(host);
      if (!inView.has(host) || n++ >= 12) continue;
      if (newgrades) canvasNewsBadge(host, id, askCanvasNews(id, 'grades')?.value, 'grades');
      if (newcontent && canvasNews[canvasNewsKey(id)]?.seen) {
        const items = askCanvasNews(id, 'items')?.value;
        canvasNewsBadge(host, id, GZ_GRADES.newItems(items, canvasNews[canvasNewsKey(id)].seen).ids.size, 'items');
      }
    }
  };
  document.addEventListener('visibilitychange', () => { if (!ultra && !document.hidden) renderNew(); });

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
  // Ultra: a course outline's open folders and how far down it you were; Canvas: how far down a course's Modules list,
  // and the item opened last. Put back when you return: features/place.js, loaded where there is a place to keep or put
  // back. Anything you do first (wheel, touch, a key, a click) ends putting it back, so that is watched from the start.
  const ROWS = '.content-list-item[data-content-id]';
  let tapped = null; // { id, at }: the row of your last click
  let acted = false; // anything done on this page yet (Canvas: before the list is even there, it ends the restore too)
  const keepPlace = () => {
    if (globalThis.GZ_PLACE) return GZ_PLACE.sync();
    if (!settings.enhance.place || window.top !== window || !observer) return;
    if (ultra ? courseId() && /^\/ultra\/courses\/_\d+_\d+\/outline\/?$/.test(location.pathname) && document.querySelector(ROWS)
      : canvasCourseKey() && (new URLSearchParams(location.search).get('module_item_id') || (/^\/courses\/\d+(\/modules)?\/?$/.test(location.pathname) && document.getElementById('context_modules_sortable_container')))) {
      need('features/place.js', () => globalThis.GZ_PLACE).then(() => GZ_PLACE.sync(), () => {});
    }
  };
  document.addEventListener('click', (e) => { if (e.isTrusted && e.target instanceof Element) tapped = { id: e.target.closest(ROWS)?.dataset.contentId, at: Date.now() }; }, true);
  for (const ev of ['wheel', 'touchstart', 'keydown', 'pointerdown']) document.addEventListener(ev, (e) => { if (!e.isTrusted) return; acted = true; globalThis.GZ_PLACE?.stop(); }, { capture: true, passive: true });

  // ---- what-if calculator (Extras) -----------------------------------------------------------
  // On a course's gradebook: scores typed for work not graded yet give the overall grade they'd make, and a target what
  // it takes. Ultra's is features/whatif.js (with lib/gradecalc.js), loaded on a course's Grades once its grades are in.
  const make = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids); return e; };
  // Canvas: the what-if calculator (a course's Grades) and the GPA (Dashboard) are features/grades.js, asked for where on.
  const canvasGrades = () => {
    const e = settings.enhance;
    if (observer && (globalThis.GZ_GRADES_UI || (e.calc && /^\/courses\/\d+\/grades\/?$/.test(location.pathname)) || (e.gpa && location.pathname === '/'))) {
      need('features/grades.js', () => globalThis.GZ_GRADES_UI).then(() => GZ_GRADES_UI.render(), () => {});
    }
  };
  const renderCalc = () => {
    if (!ultra) return moodle || canvasGrades();
    if (globalThis.GZ_WHATIF) return GZ_WHATIF.render();
    const cid = courseId();
    if (settings.enhance.calc && observer && cid && /^\/ultra\/courses\/_\d+_\d+\/grades/.test(location.pathname) && document.querySelector('.grades-list > aside.student-grade-overview') && bookFor(cid).results) {
      need('lib/gradecalc.js', () => globalThis.GZ_GRADECALC).then(() => need('features/whatif.js', () => globalThis.GZ_WHATIF)).then(() => GZ_WHATIF.render(), () => {});
    }
  };

  // ---- draft backup (Extras) ------------------------------------------------------------------
  // What you write in Ultra's editors, or in Canvas's Inbox compose, is kept on this device until it posts, and offered
  // back when that editor turns up empty again: features/drafts.js (with lib/drafts.js), loaded once such an editor is on
  // the page or written in. An editor written in before it arrives (one paste can be all there is) is taken up when it
  // does, as if just written in; from then on it gets every keydown, input and paste, and the passes (watchDrafts).
  const DRAFT_ED = ultra ? '.ql-editor[contenteditable="true"]' : '#compose-message-modal textarea[data-testid="message-body"]';
  const local = (fn) => { try { fn(chrome.storage.local); } catch { /* extension reloaded under the tab */ } };
  const draftsWaiting = new Set();
  const draftsIn = () => need('lib/drafts.js', () => globalThis.GZ_DRAFTS).then(() => need('features/drafts.js', () => globalThis.GZ_DRAFT_UI)).then(() => {
    const eds = [...draftsWaiting];
    draftsWaiting.clear();
    for (const ed of eds) if (ed.isConnected) GZ_DRAFT_UI.write({ type: 'input', target: ed });
    if (observer) watchDrafts();
  }, () => draftsWaiting.clear());
  for (const ev of ['keydown', 'input', 'paste']) document.addEventListener(ev, (e) => {
    if (globalThis.GZ_DRAFT_UI) return GZ_DRAFT_UI.write(e);
    if ((!ultra && e.type !== 'input') || !settings.enhance.drafts || !observer || !(e.target instanceof Element)) return;
    const ed = e.target.closest(DRAFT_ED);
    if (ed) { draftsWaiting.add(ed); draftsIn(); } else if (!ultra && e.target.closest('#compose-message-modal')) watchDrafts();
  }, true);
  // Canvas owns RCE recovery and assignment/quiz drafts. Only its plain-text new Inbox compose lacks it.
  const watchDrafts = () => {
    if (globalThis.GZ_DRAFT_UI) return GZ_DRAFT_UI.watch();
    if (settings.enhance.drafts && (ultra || /^\/conversations\/?$/.test(location.pathname)) && document.querySelector(DRAFT_ED)) draftsIn();
  };
  // Expired copies go, and with the feature off, all of them. Top frame, on load and when switched off.
  const tidyDrafts = () => {
    if (window.top !== window) return;
    // lib/drafts.js only when there are copies to look at.
    local((s) => s.get(null, (all) => {
      if (!Object.keys(all || {}).some((k) => k.startsWith('draft:'))) return;
      need('lib/drafts.js', () => globalThis.GZ_DRAFTS).then(() => { const old = GZ_DRAFTS.stale(all, Date.now(), settings.enhance.drafts); if (old.length) s.remove(old); }, () => {});
    }));
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
  const setDark = (on) => {
    settings = { ...settings, enhance: { ...settings.enhance, darkDocs: on } };
    setAttr('data-gz-enhance-darkDocs', on);
    syncDocTools();
    try { chrome.storage.sync.set({ enhance: settings.enhance }); } catch { /* extension reloaded under the tab */ }
  };
  const syncDocTools = () => {
    globalThis.GZ_KEYS?.sync();
    if (globalThis.GZ_DOCS) return GZ_DOCS.sync();
    if (observer && ((ultra && document.querySelector(PREVIEWS)) || (window.top === window && settings.enhance.toggles && document.querySelector(`${DOC}, ${PREVIEWS}`)))) {
      need('features/docs.js', () => globalThis.GZ_DOCS).then(() => GZ_DOCS.sync(), () => {});
    }
  };
  // Here, so it is first to see the key: Esc leaves focus mode, and the site doesn't also act on it.
  addEventListener('keydown', (e) => globalThis.GZ_DOCS?.esc(e), true);

  // ---- keyboard shortcuts (Extras) ------------------------------------------------------------
  // "g" then a letter goes somewhere, "/" searches, "?" lists them: features/keys.js, loaded on the first key that
  // starts one while the switch is on, then handed every key. Top frame only.
  const typing = (el) => el instanceof Element && (el.isContentEditable || !!el.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])'));
  // Whether a key is one for the shortcuts: switched on, no modifier, not typing, and on Canvas not repeated, not
  // already taken, not on a page or in a widget that has keys of its own (keys.js asks this too).
  const keyOn = (e) => !!settings.enhance.keys && !!observer && !e.metaKey && !e.ctrlKey && !e.altKey && !typing(e.target)
    && (ultra || !(moodle || e.defaultPrevented || e.repeat || !GZ_PAGE.canvasKeys(location.pathname) || e.target.closest?.('[role="dialog"]:not(#gz-keys), [role="menu"], [role="listbox"], [role="grid"]')));
  let keysWaiting = null; // the keys pressed while keys.js loads, as they were: handed over in order when it's in
  if (window.top === window) {
    document.addEventListener('keydown', (e) => {
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
  if (window.top === window) {
    document.addEventListener('keydown', (e) => {
      if (e.key?.toLowerCase() !== 'k' || !(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey || !settings.enhance.palette || !observer) return;
      // Stopped, as when opening: the search box (focused, now gone) would otherwise answer it with no palette left.
      if (globalThis.GZ_CMD?.isOpen()) { e.preventDefault(); e.stopPropagation(); GZ_CMD.close(); return; }
      if (cmdWanted !== null) { e.preventDefault(); e.stopPropagation(); cmdWanted = !cmdWanted; return; }
      if (typing(e.target)) return;
      if (!ultra && e.target.closest?.('[role="dialog"], [role="menu"], [role="listbox"]')) return;
      e.preventDefault();
      e.stopPropagation();
      cmdWanted = true;
      need('features/palette.js', () => globalThis.GZ_CMD).then(() => { if (cmdWanted && observer && settings.enhance.palette) GZ_CMD.open(); }, () => {}).finally(() => { cmdWanted = null; });
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
      if (!observer || !settings.enabled) return;
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
  // The popover itself, and the edits it makes, are features/coursemenu.js, loaded when a button is first pointed at.
  const CARD = COURSE_CARDS[0][0];

  // The nickname given to a course, while the Extra is on; '' for none. Only Glaze's own surfaces and the page's
  // course names call this: Blackboard's real name is always the course list's (recordCourses), never the page's.
  const nickOf = (cid) => (ultra && observer && settings.enhance.coursemenu && settings.courses.names[cid]) || '';

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
  const menuOn = () => !!observer && settings.enhance.coursemenu && window.top === window && !isPreview;
  const syncCourseMenu = () => {
    const on = menuOn();
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
        b.setAttribute('aria-expanded', String(globalThis.GZ_COURSE_MENU?.cid() === cid));
        card.append(b);
      } else if (b.getAttribute('aria-label') !== label) {
        b.setAttribute('aria-label', label);
        // While the pointer is on it, its title is in the tooltip (onTip).
        if (b.dataset.gzTitle !== undefined) b.dataset.gzTitle = label; else b.title = label;
      }
    }
    globalThis.GZ_COURSE_MENU?.sync(on);
    if (ultra) syncNames(); else syncCards();
  };
  // Canvas's dashboard cards: features/cards.js.
  const cardUI = (f) => need('features/cards.js', () => globalThis.GZ_CARD_UI).then(() => f(GZ_CARD_UI), () => {});
  const syncCards = () => { if (!isPreview && !moodle && location.pathname === '/') cardUI((m) => m.paint()); };
  // Nothing of the extra left on the page: the theme or the extra is off.
  const unmenu = () => {
    globalThis.GZ_COURSE_MENU?.close(false, true);
    for (const b of document.querySelectorAll('.gz-cm-btn')) b.remove();
    for (const p of document.querySelectorAll('[data-gz-real]')) unname(p);
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

  const paintNav = (n, picture) => {
    if (site !== 'canvas' || window.top !== window) return;
    setAttr('data-gz-nav-size', n.size !== 'medium' || n.labels !== 'normal' || n.collapsed ? n.size : false);
    for (const k of ['labels', 'collapsed', 'f']) setAttr(`data-gz-nav-${k}`, n[k]);
    setAttr('data-gz-nav-no-logo', !n.logo);
    const src = n.i ? picture : n.u;
    setAttr('data-gz-nav', n.k !== 'default' && (n.k === 'image' && !src ? 'solid' : n.k));
    for (const [k, v] of [['ink', n.ink], ['c', n.c], ['d', n.d], ['a', `${n.a}deg`], ['o', n.o / 100], ['img', src ? `url("${src}")` : 'none']]) setVar(`--gz-nav-${k}`, v);
  };
  const syncNav = () => {
    if (site !== 'canvas' || isPreview || window.top !== window) return;
    if (worn.nav.i || worn.nav.collapsed || worn.nav.labels === 'icons') need('features/nav.js', () => globalThis.GZ_NAV_UI).then(() => globalThis.GZ_NAV_UI.sync()).catch(() => {});
    else globalThis.GZ_NAV_UI?.sync();
  };

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
    paintNav(s.nav);
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
    // Waiting for the page's words: the pass that brings them in draws all of this.
    const said = observer && words();
    if (said && ['scores', 'urgency', 'inline', 'overall'].some((k) => s.enhance[k] && !was[k])) tagExtras([document.body]);
    if (said) { renderProgress(); renderCalc(); syncDownloads(); syncCourseMenu(); syncTodo(); syncCardTasks(); syncRemind(); syncWidgets(); syncNav(); }
    if (!s.enhance.newgrades) { clearTags(['data-gz-new']); for (const p of document.querySelectorAll('.gz-new[data-kind="grades"]')) p.remove(); }
    if (!s.enhance.newcontent) for (const p of document.querySelectorAll('.gz-new:not([data-kind="grades"])')) p.remove();
    if (said) renderNew();
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
    onBody(async () => {
      if (!links.length) return;
      if (!(ultra ? isUltra() : isCanvas())) { disable(); notUltra = true; return; }
      if (!ultra) await ready;
      if (!links.length) return;
      if (!on(settings)) return disable();
      syncFooter();
      startSweep();
      syncScene();
    });
  };
  const disable = () => {
    hideTip();
    globalThis.GZ_PEEK?.hide();
    if (!ultra) globalThis.GZ_DOWNLOAD?.stop();
    globalThis.GZ_KEYS?.off();
    globalThis.GZ_CMD?.close();
    for (const id of ['gz-progress', 'gz-calc', 'gz-gpa']) document.getElementById(id)?.remove();
    for (const p of document.querySelectorAll('.gz-new, .gz-card-grade')) p.remove();
    globalThis.GZ_DRAFT_UI?.drop();
    for (const b of document.querySelectorAll('.gz-dl')) b.remove();
    unmenu();
    for (const l of links) l.remove();
    links = [];
    armFlip();
    syncTodo();
    syncCardTasks();
    syncWidgets();
    syncRemind();
    themeEditors();
    syncPageFade();
    stopScene();
    stopSweep();
    clearSettings();
    globalThis.GZ_NAV_UI?.sync();
    syncDocTools();
    syncFooter();
  };

  // The helpers a file loaded by need() may use (features/*.js): this frame's, read through one name.
  globalThis.GZ_CTX = Object.freeze({ need, t, locale, capi, profile, local, canvasCourses, canvasCourseId, celebrate, settings: () => settings, nav: () => worn.nav, repaintNav: (src) => paintNav(worn.nav, src), on: () => !!observer,
    // The palette, the keys, the course menu, the previews and Download all (W0c).
    site, wordsIn, typing, keyOn, make, dueWeek, moodleIn, myCourses, courseId, courseItems, toggleOf, canvasPeek, moduleItems,
    nickOf, courseList: () => courseList, courseColor, courseColors, varText, cardUI,
    setCourses: (c) => { settings = { ...settings, courses: c }; applySettings(); },
    // Draft backup, Ultra's what-if calculator, the document buttons and your place in a course (W0d).
    draftEditor: DRAFT_ED, bookFor, docButton, setVar, setDark, PREVIEWS, DOC, darkTheme: () => darkTheme,
    canvasCourseKey, ROWS, holding: () => held.size > 0, tapped: () => tapped, acted: () => acted });

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
      if (on(s) && !was) enable();
      else if (!on(s) && was) disable();
      else if (on(s)) applySettings();
    });
  });
  const reapply = () => { if (settings.enabled && links.length) applySettings(); };
  darkMQ.addEventListener('change', reapply);
  calmMQ.addEventListener('change', reapply);
})();
