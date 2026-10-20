// Canvas-only helpers for content.js, loaded before it on Canvas hosts (lib/background.js) or on demand.
// Receives the core's live state (I); reinjection keeps the first copy and returns it.
var GZ_SITE_CANVAS = globalThis.GZ_SITE_CANVAS || ((I) => {
  const { C, html, isPreview, need, t, locale, capi, canvasCourseKey, canvasCourseId, celebrate, markDue, drawProgress, cardBadge, KIND, cardsInView, inView, tagExtras, setVar, setAttr } = I;

  // ---- completion burst (Expressive) -----------------------------------------------------------
  const DONE_BY = '#mark-as-done-checkbox, #set-module-item-completion-button, input[data-testid="planner-item-completed-checkbox"]';
  const isDone = (el) => (el.matches('input') ? el.checked : el.classList.contains('btn-success') || !!el.querySelector('svg[name="IconComplete"]'));
  let following = null;
  document.addEventListener('click', (e) => {
    if (!e.isTrusted || !(e.target instanceof Element)) return;
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
  const COURSE_CACHE = 'gz-canvas-courses';
  let canvasList = null, canvasSnapshot = null, coursesRead = false;
  // Same tab and origin, briefly: navigation needn't ask for the same courses and colors again.
  try {
    const kept = JSON.parse(sessionStorage.getItem(COURSE_CACHE)), age = Date.now() - kept?.at;
    if (age >= 0 && age < 60000 && /^\d+$/.test(kept.uid) && Array.isArray(kept.list) && kept.colors && typeof kept.colors === 'object') canvasSnapshot = kept;
  } catch { /* blocked or empty */ }
  // Follow Canvas's next link, never off this API; a broken cycle or huge account stops at twenty pages.
  const readCourses = async () => {
    let next = '/courses?enrollment_state=active&include[]=total_scores&include[]=current_grading_period_scores&include[]=restrict_quantitative_data&include[]=term&per_page=100';
    const out = [], seen = new Set();
    for (let page = 0; next && page < 20 && !seen.has(next); page++) {
      const path = next;
      seen.add(path); next = '';
      let link;
      const rows = await capi(path, (r) => { link = r.headers.get('Link'); });
      if (!Array.isArray(rows)) throw new Error('Invalid list');
      out.push(...rows);
      const raw = /<([^>]+)>\s*;\s*rel="?next"?(?:\s*[,;]|$)/i.exec(link || '')?.[1];
      if (raw) try {
        const u = new URL(raw, `${location.origin}/api/v1${path}`);
        if (u.origin === location.origin && !u.username && !u.password && u.pathname.startsWith('/api/v1/')) next = u.pathname.slice(7) + u.search;
      } catch { /* malformed next link */ }
    }
    return out;
  };
  let mine = null;
  const profile = () => (mine ||= capi('/users/self/profile').catch((e) => { mine = null; throw e; }));
  // Who is signed in is always Canvas's word on this page (the page's own storage could say anything); a snapshot counts
  // only for that account, so one signed in a moment ago never lends its courses or grades.
  const snap = () => (canvasSnapshot ? profile().then((p) => (String(p?.id) === canvasSnapshot.uid ? canvasSnapshot : null), () => null) : Promise.resolve(null));
  const canvasCourses = () => (canvasList ||= snap().then((s) => s ? s.list : readCourses()
    .then((j) => { coursesRead = Array.isArray(j); return coursesRead ? j : []; }, () => { setTimeout(() => { canvasList = null; }, 60000); return []; }))); // asked again after a minute
  const record = () => snap().then((s) => Promise.all([canvasCourses(), s ? s.colors : capi('/users/self/colors').catch(() => null), profile().catch(() => null)])).then(([list, colors, me]) => {
    // Failed reads must not turn into a fresh, empty snapshot.
    if (coursesRead && colors && /^\d+$/.test(me?.id)) try { sessionStorage.setItem(COURSE_CACHE, JSON.stringify({ at: Date.now(), uid: String(me.id), list, colors })); } catch { /* blocked or full */ }
    const seen = Object.fromEntries(list.filter((c) => /^\d+$/.test(c.id) && c.name).map((c) => [canvasCourseKey(c.id), {
      name: c.name, code: c.course_code, canvas: true, color: /^#[0-9a-f]{6}$/i.test(colors?.custom_colors?.[`course_${c.id}`]) ? colors.custom_colors[`course_${c.id}`] : null,
    }]));
    // Preserve Blackboard and other schools; Canvas ids alone are only unique within their own host.
    chrome.storage.local.get('seenCourses', (r) => {
      const all = { ...r?.seenCourses, ...seen };
      chrome.storage.local.set({ seenCourses: all });
      I.setCourseList(all);
    });
  });

  // ---- code on demand ------------------------------------------------------------------------------
  const todoHere = () => I.links.length && I.settings.enhance.todo && /^\/(courses\/\d+\/?)?$/.test(location.pathname);
  const syncTodo = () => (todoHere() ? need('features/todo.js', () => globalThis.GZ_TODO_UI).then(() => GZ_TODO_UI.sync(todoHere()), () => {}) : globalThis.GZ_TODO_UI?.sync(false));
  const cardsHere = () => I.links.length && I.settings.enhance.cardTasks && location.pathname === '/';
  const syncCardTasks = () => (cardsHere() && document.querySelector('.ic-DashboardCard') ? need('features/cardtasks.js', () => globalThis.GZ_CARD_TASKS).then(() => GZ_CARD_TASKS.sync(cardsHere()), () => {}) : globalThis.GZ_CARD_TASKS?.sync(false));
  const widgetsHere = () => { const e = I.settings.enhance; return I.links.length && (window.top === window || I.tabFrame === 'page') && (e.widgets || e.notes || e.pet || (e.todo && location.pathname === '/')); };
  const syncWidgets = () => (widgetsHere() ? need('features/widgets.js', () => globalThis.GZ_WIDGETS_UI).then(() => GZ_WIDGETS_UI.sync(widgetsHere()), () => {}) : globalThis.GZ_WIDGETS_UI?.sync(false));
  const remindHere = () => I.links.length && window.top === window && ['remind', 'remindExam', 'remindPlan', 'remindClass', 'streak'].some((k) => I.settings.enhance[k]);
  const syncRemind = () => (remindHere() ? need('features/reminders.js', () => globalThis.GZ_REMIND_UI).then(() => GZ_REMIND_UI.sync(remindHere()), () => {}) : globalThis.GZ_REMIND_UI?.sync(false));
  const sylHere = () => I.links.length && window.top === window && I.settings.enhance.syllabus && /^\/courses\/\d+(\/assignments\/syllabus)?\/?$/.test(location.pathname);
  const syncSyl = () => (sylHere() ? need('features/syllabus.js', () => globalThis.GZ_SYL_UI).then(() => GZ_SYL_UI.sync(sylHere()), () => {}) : globalThis.GZ_SYL_UI?.sync(false));
  const syncInsights = () => (globalThis.GZ_INSIGHTS_UI || (I.links.length && I.settings.enhance.insights && location.pathname === '/')) && need('features/insights.js', () => globalThis.GZ_INSIGHTS_UI).then(() => GZ_INSIGHTS_UI.sync(), () => {});
  const canvasGrades = () => {
    const e = I.settings.enhance;
    if (I.observer && (globalThis.GZ_GRADES_UI || (e.calc && /^\/courses\/\d+\/grades\/?$/.test(location.pathname)) || (e.gpa && location.pathname === '/'))) {
      need('features/grades.js', () => globalThis.GZ_GRADES_UI).then(() => GZ_GRADES_UI.render(), () => {});
    }
  };
  addEventListener('message', (e) => { if (e.data?.gz === 'docs?' && /^https:\/\/canvadocs(-[\w-]+)?\.instructure\.com$/.test(e.origin)) need('features/docs.js', () => globalThis.GZ_DOCS).then(() => GZ_DOCS.ask(e), () => {}); });

  // ---- grades on course cards (Extras) ---------------------------------------------------------
  addEventListener('click', (e) => {
    const el = I.settings.enhance.overall && e.target.closest?.('.ic-DashboardCard [data-gz-grade]');
    const r = el && document.createRange();
    if (!r) return;
    r.selectNodeContents(el);
    const b = r.getBoundingClientRect();
    if (html.dir === 'rtl' ? e.clientX >= b.left : e.clientX <= b.right) return; // on the code, not the chip
    e.preventDefault();
    const url = `${el.closest('a').href}/grades`;
    if (e.ctrlKey || e.metaKey) open(url); else globalThis.GZ_CTABS?.bar?.open(url) || location.assign(url); // through a course tab's frame when they run
  }, true);
  const tagCanvasCards = () => {
    if (!document.querySelector('.ic-DashboardCard')) return;
    canvasCourses().then((list) => {
      if (!I.observer) return; // switched off while it was asked
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
  const liftCourses = (records) => {
    for (const [box, src, prop] of COURSE_BOXES) {
      // Initial paint visits every box; mutations only revisit their box and newly inserted boxes.
      const boxes = records ? new Set() : document.querySelectorAll(box);
      if (records) for (const r of records) {
        const near = r.target.closest?.(box);
        if (near) boxes.add(near);
        if (r.type === 'childList') for (const n of r.addedNodes) {
          if (n.nodeType !== 1) continue;
          if (n.matches(box)) boxes.add(n);
          for (const el of n.querySelectorAll(box)) boxes.add(el);
        }
      }
      for (const el of boxes) {
        const c = el.querySelector(src)?.style[prop];
        if (c && el.style.getPropertyValue('--gz-course-raw') !== c) el.style.setProperty('--gz-course-raw', c);
      }
    }
  };

  // ---- extras that read page text (score bars, due-date urgency), only while switched on ----
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
        if (I.observer && canvasWork === w) tagExtras([document.body]);
      }, () => {});
    }
    return canvasWork.by;
  };
  const tagCanvasExtras = () => {
    const { scores, urgency, inline } = I.settings.enhance;
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

  // ---- folder previews (Extras) ----------------------------------------------------------------
  // What a module or folder holds, for features/previews.js and features/download.js.
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

  // ---- course progress (Extras) ---------------------------------------------------------------
  // The outline with a done state is Modules: the bar adds up the completion requirements the course sets, done or not
  // as Canvas's own API has them for this student, above the Modules list, also on a course home
  // that shows it. A course that sets none gets no bar: Canvas calls a module without requirements "completed", and it
  // hides that itself, as nothing there was asked of you.
  // Progress and new-content badges share this exact capped list; both refresh after five minutes.
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
  // Hidden modules (features/folders.js), where a course lists its modules; who you are keys what you hid.
  let meP = null;
  const me = () => (meP ||= profile().then((p) => String(p.id), (e) => { meP = null; throw e; }));
  const syncFolders = () => (I.links.length && I.settings.enhance.hideFolders && document.getElementById('context_modules')
    ? need('lib/folders.js', () => globalThis.GZ_FOLDERS).then(() => need('features/folders.js', () => globalThis.GZ_FOLDER_UI)).then(() => GZ_FOLDER_UI.sync(true, me()), () => {})
    : globalThis.GZ_FOLDER_UI?.sync(false));
  let reqs = null; // { cid, load, progress: { done, total } | null }, tied to the shared Modules cache
  const canvasProgress = () => {
    syncFolders();
    const old = document.getElementById('gz-progress');
    const cid = canvasCourseId();
    const list = I.observer && I.settings.enabled && I.settings.enhance.progress && /^\/courses\/\d+(\/modules)?\/?$/.test(location.pathname) && document.getElementById('context_modules_sortable_container');
    if (!list) return old?.remove();
    if (reqs?.cid === cid && Date.now() - reqs.failed < 60000) return old?.remove(); // a failed request is asked again after a minute
    const load = canvasModules(cid);
    if (reqs?.cid !== cid || reqs.load !== load) {
      const r = (reqs = { cid, load });
      // shortcut: hide incomplete module lists; follow Link and items_url if large-course progress is needed.
      load.then((mods) => {
        r.progress = GZ_PAGE.canvasProgress(mods);
        if (reqs === r) canvasProgress();
      }).catch(() => { if (reqs === r) r.failed = Date.now(); }); // a failed request must not pin the course
      return;
    }
    if (!reqs.progress?.total) return old?.remove();
    drawProgress(old, reqs.progress.done, reqs.progress.total, list);
  };
  addEventListener('pageshow', (e) => { if (e.persisted) canvasProgress(); }); // BFCache may outlive the Modules cache

  // ---- new grades and new content (Extras) ----------------------------------------------------
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
      canvasNewsUser = String(id); canvasNews = kept; renderCanvasNew();
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
      if (I.observer && I.settings.enhance[kind === 'items' ? 'newcontent' : 'newgrades']) renderCanvasNew();
    });
    return kept;
  };
  const canvasNewsBadge = (host, cid, n, kind) => {
    let pill = host.querySelector(`:scope > .gz-new[data-kind="${kind}"]`);
    if (!n) { if (kind === 'grades') globalThis.GZ_CTX.gradeMoment(cid, n, host); return pill?.remove(); }
    if (!pill) {
      pill = document.createElement('a'); pill.className = 'gz-new'; pill.dataset.kind = kind;
      pill.href = `/courses/${cid}/${kind === 'grades' ? 'grades' : 'modules'}`;
      host.append(pill);
    }
    const text = t(kind === 'items' ? '{n} new items' : '{n} new', { n });
    if (pill.textContent !== text) pill.textContent = text;
    const label = t(KIND[kind], { n });
    if (pill.getAttribute('aria-label') !== label) pill.setAttribute('aria-label', label);
    if (kind === 'grades') globalThis.GZ_CTX.gradeMoment(cid, n, pill);
  };
  const renderCanvasNew = () => {
    const { newgrades, newcontent } = I.settings.enhance;
    if (!(newgrades || newcontent) || !I.observer || document.hidden || window.top !== window) return;
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
  document.addEventListener('visibilitychange', () => { if (!document.hidden) renderCanvasNew(); });

  // ---- course colors -----------------------------------------------------------------------------
  // The course's own color (the course list's, which a native color edit on a Dashboard card updates) on its breadcrumb
  // and course menu, the Grades page's links and the Inbox's course labels. The Dashboard's and the calendar's are native.
  const paintCourses = () => {
    if (!I.observer || !I.settings.enabled) return;
    const courseList = I.courseList;
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
  };

  // ---- the global navigation (features/navbar.js) --------------------------------------------------
  const paintNav = (n, picture) => {
    if (window.top !== window) { setAttr('data-gz-navbar-frame', I.tabFrame && I.settings.navbar.on && (I.settings.navbar.cmenu !== false && I.settings.navbar.course !== 'hide' ? 'menu' : '')); return; }
    // Reserve the bar's room before its lazy renderer arrives, using GZ_NAVBAR.layout's words.
    const b = I.settings.navbar, c = /^\/courses\/\d+(?:\/|$)/.test(location.pathname) ? b?.course : 'same';
    const p = c === 'same' ? b?.place : c === 'icons' ? 'rail' : c === 'hide' ? 'none' : 'top';
    if (!globalThis.GZ_NAVBAR_UI?.live()) setAttr('data-gz-navbar', !!b?.on && !/^\/(?:login|logout)(?:\/|$)/.test(location.pathname) && `${p}${p === 'rail' ? ` ${c === 'icons' ? 'icons' : b.rail}` : ''} ${b.style}${p !== 'none' && b.tabs && I.settings.enhance.tabs ? ' tabs' : ''}${p !== 'none' && /^\/courses\/\d+(?:\/|$)/.test(location.pathname) && b.cmenu !== false && document.querySelector('#section-tabs a[href]') ? ' menu' : ''}`);
    setAttr('data-gz-nav-size', n.size !== 'medium' || n.labels !== 'normal' || n.collapsed ? n.size : false);
    for (const k of ['labels', 'collapsed', 'f']) setAttr(`data-gz-nav-${k}`, n[k]);
    setAttr('data-gz-nav-no-logo', !n.logo);
    const src = n.i ? picture : n.u;
    setAttr('data-gz-nav', n.k !== 'default' && (n.k === 'image' && !src ? 'solid' : n.k));
    for (const [k, v] of [['ink', n.ink], ['c', n.c], ['d', n.d], ['a', `${n.a}deg`], ['o', n.o / 100], ['img', src ? `url("${src}")` : 'none']]) setVar(`--gz-nav-${k}`, v);
  };
  // Course tabs (features/coursetabs.js, on demand): the strip's place and size as this browser tab last had them, else
  // the defaults, as data-gz-ctabs from the first paint: canvas.css holds that room, so the row doesn't move when it comes.
  const paintTabs = () => {
    let at = null;
    try { at = sessionStorage.getItem('gz-ctabs'); } catch { /* blocked */ }
    setAttr('data-gz-ctabs', !!I.links.length && I.solo && !!I.settings.enhance.tabs && !globalThis.GZ_CTABS?.revoked?.() && (at ?? 'above medium'));
  };
  const syncNav = () => {
    if (window.top !== window || /^\/(?:login|logout)(?:\/|$)/.test(location.pathname)) return;
    if (globalThis.GZ_NAVBAR_UI || (I.links.length && I.settings.navbar?.on)) need('features/navbar-canvas.js', () => globalThis.GZ_NAVBAR_CANVAS).then(() => need('features/navbar.js', () => globalThis.GZ_NAVBAR_UI)).then(() => GZ_NAVBAR_UI.sync(), () => setAttr('data-gz-navbar', false));
    if (I.worn.nav.i || I.worn.nav.collapsed || I.worn.nav.labels === 'icons' || (I.links.length && globalThis.GZ_CTX?.parts()?.nav)) need('features/nav.js', () => globalThis.GZ_NAV_UI).then(() => globalThis.GZ_NAV_UI.sync()).catch(() => {});
    else globalThis.GZ_NAV_UI?.sync();
  };

  return {
    record, stop: () => { globalThis.GZ_FOLDER_UI?.sync(false); globalThis.GZ_NAVBAR_UI?.sync(); }, planner: () => todoHere() || cardsHere(), tagCards: tagCanvasCards, tagExtras: tagCanvasExtras, lift: liftCourses,
    renderProgress: canvasProgress, renderNew: renderCanvasNew, renderCalc: canvasGrades, paintCourses, paintNav, paintTabs, syncNav,
    syncTodo, syncCardTasks, syncWidgets, syncRemind, syncSyl,
    syncInsights: () => {
      syncInsights();
      if (I.solo && (I.settings.enhance.tabs || globalThis.GZ_CTABS)) need('features/coursetabs.js', () => globalThis.GZ_CTABS).then(() => GZ_CTABS.sync(!!I.links.length && I.settings.enhance.tabs), () => {});
    },
    ctx: { canvasCourses, profile, canvasPeek, moduleItems },
  };
});

GZ_SITE_CANVAS;
