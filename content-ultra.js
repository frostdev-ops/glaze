// Glaze — Blackboard Ultra's part of the first content script: what only Ultra does, so Canvas and Moodle don't parse it.
// Listed before content.js for /ultra pages (and in the options preview); content.js calls it with its helpers and live
// state (I) and puts what it returns over its defaults (X). A second copy keeps the first; it ends on its value (loadable).
var GZ_SITE_ULTRA = globalThis.GZ_SITE_ULTRA || ((I) => {
  const { C, html, isPreview, solo, tabFrame, need, t, locale, api, courseId, markDue, drawProgress, cardBadge, cardsInView, inView, tagCards, tagExtras, courseSlots, courseColors, varText, CARD, dueLabelled } = I;

  // ---- the student's courses -------------------------------------------------------------------
  // Every course and the color slot Ultra gives it, for the editor's course list and the tint on
  // pages that don't show the slot: from the membership list Ultra's own Courses page asks for, once
  // a page load and at most every ten minutes. Stored locally; nothing leaves the device. Each Ultra site has its own: two
  // schools' records stay side by side, each with its own ten-minute gate (`seenCoursesAt <origin>`, as Moodle's).
  const record = () => {
    const at = `seenCoursesAt ${location.origin}`;
    try {
      chrome.storage.local.get(at, (r) => {
        if (Date.now() - (r?.[at] || 0) < 600000) return;
        myCourses().then((ms) => {
          const seen = GZ_COURSES(ms);
          if (!Object.keys(seen).length) return;
          for (const [id, c] of Object.entries(seen)) courseSlots[id] = c.slot;
          for (const m of ms) if (seen[m.courseId]) Object.assign(seen[m.courseId], { site: location.origin, code: String(m.course.displayId || '').slice(0, 80) });
          try { chrome.storage.local.get('seenCourses', (r) => {
            // Canvas's and Moodle's (keyed by site) and other Ultra sites' stay; this site's go, with any kept before Ultra's
            // records named their site.
            const kept = Object.fromEntries(Object.entries(r?.seenCourses || {}).filter(([k, c]) => k.includes(':') || (c?.site && c.site !== location.origin)));
            chrome.storage.local.set({ seenCourses: { ...kept, ...seen }, [at]: Date.now(), courseSlots });
          }); } catch { /* reloaded */ }
        });
      });
    } catch { /* extension reloaded under the tab */ }
  };

  // ---- the gradebook --------------------------------------------------------------------------
  // One /users/me for everything that asks at once. A failure (this, a gradebook) is asked again after a minute, a 401
  // (signed out) once the page changes.
  let meId = null;
  let meFailed = null;
  const route = () => location.pathname + (location.search || '');
  const failed = (e, at = route()) => ({ at: Date.now(), out: (e === 401 || /HTTP 401/.test(e?.message)) && at });
  const askAgain = (f) => (f.out ? f.out !== route() : Date.now() - f.at >= 60000);
  const me = () => {
    if (meFailed && askAgain(meFailed)) meId = meFailed = null;
    const at = route();
    return (meId ||= api('/users/me').then((m) => m.id).catch((e) => { meFailed = failed(e, at); throw e; }));
  };
  // Gradebooks and contents, fanned out over course cards: lib/ultra.js's reader through the site's queue (lib/lmsq.js).
  const reader = () => need('lib/lmsq.js', () => globalThis.GZ_LMSQ).then(() => need('lib/ultra.js', () => globalThis.GZ_ULTRA))
    .then(() => { const live = () => I.settings.enabled && !!I.links.length; return GZ_ULTRA.read({ origin: location.origin, live, f: (u, o) => GZ_LMSQ.fetch(u, o, 0, live) }); });
  const covered = (rows, complete) => Object.defineProperty(rows, 'complete', { value: complete });
  // One page of memberships, shared by names and due-date exceptions.
  let memberships = null;
  let membershipsFailed = null;
  const myCourses = () => {
    if (membershipsFailed && askAgain(membershipsFailed)) memberships = membershipsFailed = null;
    const at = route();
    return (memberships ||= me().then((id) => api(`/users/${id}/memberships?expand=course&limit=200`))
      .then((j) => covered(j.results || [], !j.paging?.nextPage)).catch((e) => { membershipsFailed = failed(e, at); return covered([], false); }));
  };
  // Planning (features/todo.js…), as Canvas's part: lib/ultra.js reads; each file loaded once on, asked again as it lands.
  const page = (k) => () => need('lib/ultra.js', () => globalThis.GZ_ULTRA).then(() => GZ_ULTRA.page[k]());
  const load = (on, file, n) => (on() ? need(file, () => globalThis[n]).then(() => globalThis[n].sync(!!on()), () => {}) : globalThis[n]?.sync(false));
  const top = () => I.links.length && solo && I.settings.enhance;
  // The sidebar (features/sidebar.js) owns To Do in the visible document while enabled on this kind of page;
  // otherwise its legacy places stay in use, including while the sidebar cannot start.
  const sidebarHere = () => !!top()?.sidebar && I.settings.sidebar?.ultra !== false && /^\/ultra(\/|$)/.test(location.pathname);
  const sidebarOn = () => sidebarHere() && (globalThis.GZ_SIDEBAR_UI?.enabled?.() ?? !I.settings.sidebar?.off?.length);
  const syncSidebar = () => load(sidebarHere, 'features/sidebar.js', 'GZ_SIDEBAR_UI');
  const syncTodo = () => load(() => top()?.todo && /^\/ultra\/(course\/?$|institution-page\/?$|courses\/_\d+_\d+\/outline)/.test(location.pathname) && !(sidebarOn() && !globalThis.GZ_SIDEBAR_UI?.failed()), 'features/todo.js', 'GZ_TODO_UI');
  const syncCardTasks = () => load(() => top()?.cardTasks && /^\/ultra\/course\/?$/.test(location.pathname) && document.querySelector(CARD), 'features/cardtasks.js', 'GZ_CARD_TASKS');
  // Reminders and floating widgets are the page's, once: never again in a course tab's frame over it.
  const syncRemind = () => load(() => !tabFrame && ['remind', 'remindExam', 'remindPlan', 'remindClass', 'streak'].some((k) => top()?.[k]), 'features/reminders.js', 'GZ_REMIND_UI');

  // Only submitted attempts have a hand-in date. A newer draft leaves earlier submission timing unknown.
  // Course and item due-date exceptions suppress lateness.
  const lateIn = (cid, results) => {
    const waiting = GZ_GRADES.awaiting(results).filter(GZ_PAGE.submitted);
    if (!waiting.length || !I.settings.enhance.inline) return Promise.resolve(new Set());
    const excepted = myCourses().then((ms) => {
      const m = ms.find((x) => x.courseId === cid);
      if (!m || m.dueDateExceptionType !== 'Normal') return () => true;
      return api(`/courses/${cid}/gradebook/memberships/${m.id}/exceptions?columnId=${waiting.map((g) => g.columnId).join(',')}`)
        .then((j) => { const cols = new Set([].concat(j.results || []).map((x) => x?.columnId)); return (col) => cols.has(col); }, () => () => true);
    });
    return excepted.then((exc) => new Set(waiting.filter((g) => !exc(g.columnId) && g.lastAttempt?.status !== 'IN_PROGRESS'
      && GZ_GRADES.late(g.lastAttempt?.attemptDate, g.column.dueDate)).map((g) => g.columnId)));
  };
  // Per-course gradebook cache. Only due-date chips ask for lateness; changed answers re-tag the page.
  const books = new Map();
  const bookFor = (cid, late = false) => {
    let b = books.get(cid);
    if (!b || (!b.pending && (b.fail ? askAgain(b.fail) : Date.now() - b.at > 60000 || (late && !b.late)))) {
      b = { key: '', ...b, at: Date.now(), route: route(), pending: true, fail: null };
      books.set(cid, b);
      // One page (200 grades); calculators reject an incomplete answer.
      Promise.all([me(), reader()]).then(([id, r]) => r.get(`/learn/api/v1/courses/${cid}/gradebook/grades?userId=${id}&limit=200&includeNoGradeItems=true&expand=column,lastAttempt,submissionStatus`))
        .then((j) => (late || b.late ? lateIn(cid, j.results) : Promise.resolve(undefined)).then((lateCols) => {
          b.pending = false;
          const complete = !j.paging?.nextPage;
          const key = JSON.stringify([j.results.map((g) => [g.columnId, g.status, g.isExempt, g.displayGrade, g.submissionStatus?.status, g.lastAttempt?.status, g.lastAttempt?.attemptDate]), [...(lateCols || [])], complete]);
          b.late = lateCols;
          b.results = covered(j.results, complete);
          if (key === b.key) return;
          Object.assign(b, { grades: GZ_PAGE.gradesByContent(j.results), overall: GZ_PAGE.overall(j.results, locale()), key });
          onBook();
        }))
        .catch((e) => { b.pending = false; b.fail = failed(e, b.route); });
    }
    return b;
  };
  // undefined until the current course's gradebook answers.
  const gradesIn = () => { const cid = courseId(); return cid ? bookFor(cid, true).grades : undefined; };
  const onBook = () => { tagExtras([document.body]); renderProgress(); renderNew(); renderCalc(); globalThis.GZ_COURSE_CARDS?.sync(); };

  // ---- grades on course cards (Extras) ---------------------------------------------------------
  // On the Courses page each card's status line ("Open") gains the course's overall grade, drawn by CSS
  // from attributes. Grid and list views share one card; the Recent Courses strip has its own. A card's
  // book is asked for only once the card is on screen.
  const CARD_STATUS = 'article.course-element-card[data-course-id] .course-status, a[class*="courseCard"] [class*="courseStatus"]';
  const onScreen = new Set();
  const cardsIO = new IntersectionObserver((es) => {
    for (const e of es) if (e.isIntersecting) onScreen.add(e.target); else onScreen.delete(e.target);
    tagCards();
  });
  const tagCourseCards = () => {
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

  // ---- extras that read page text (score bars, due-date urgency), only while switched on ----
  const tagPage = (roots) => {
    tagDocs(roots); // a document removed, or a class lost or gained, with nothing added
    const { scores, urgency, inline } = I.settings.enhance;
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

  // Tag document columns before paint; a broad :has() restyled Ultra on every change.
  const docs = new Set();
  const tagDocs = (scopes) => {
    for (const d of docs) if (!d.isConnected || !d.querySelector(':scope > .document-content-root')) { d.removeAttribute('data-gz-doc'); docs.delete(d); }
    for (const scope of scopes) {
      const found = scope.matches?.('.document-content-root') ? [scope] : scope.getElementsByClassName?.('document-content-root') || [];
      for (const d of found) { const p = d.parentElement; if (p && !docs.has(p)) { p.setAttribute('data-gz-doc', ''); docs.add(p); } }
    }
  };
  // Requests behind file previews (features/docs.js).
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (/view(er)?Url/.test(e.name)) (self.GZ_ASKS ||= []).unshift(e.name); self.GZ_ASKS?.splice(50); }).observe({ type: 'resource', buffered: true }); } catch {}
  // Keep the course strip attached when Ultra replaces its header; no route paint hold.
  const gate = (scope) => { discoverNav(scope); tagDocs([scope]); return globalThis.GZ_CTABS?.held(); };

  // ---- course progress (Extras) ---------------------------------------------------------------
  // One bar above the course outline adding up what the outline already says: each folder's
  // "N of M completed" (in any language: lib/page.js) plus each top-level item's review circle. Redrawn
  // only when the numbers move. The Content page only: other course tabs (Discussions) list items too.
  const renderProgress = () => {
    if (top()?.hideFolders && /^\/ultra\/courses\/_\d+_\d+\/outline(?:\/|$)/.test(location.pathname)) need('lib/folders.js', () => globalThis.GZ_FOLDERS).then(() => need('features/folders.js', () => globalThis.GZ_FOLDER_UI)).then(() => GZ_FOLDER_UI.sync(!!top()?.hideFolders, meId), () => {});
    else globalThis.GZ_FOLDER_UI?.sync(false, meId);
    const old = document.getElementById('gz-progress');
    if (!I.settings.enhance.progress || !/^\/ultra\/courses\/_\d+_\d+\/outline(\/|$)/.test(location.pathname)) return old?.remove();
    const rows = [...document.querySelectorAll('.content-list-item[data-content-id]')].filter((e) => !e.parentElement.closest('.content-list-item'));
    let done = 0;
    let total = 0;
    for (const it of rows) {
      // Some are done where Ultra puts its check in the line (all done) or a completed part in its chart.
      const msg = it.querySelector('.js-completion-status-message');
      const m = msg && GZ_PAGE.completion(msg.textContent, !!msg.querySelector('svg') || !!msg.parentElement.querySelector('.js-completion-chart [class*="chartLineCompleted"]'));
      if (m) { total += m.total; done += m.done; continue; }
      const rs = it.querySelector('.js-review-state-icon-button');
      if (rs) { total += 1; if (GZ_PAGE.isDone(rs.getAttribute('aria-checked'), gradesIn()?.get(it.dataset.contentId))) done += 1; }
    }
    if (!total) return old?.remove();
    drawProgress(old, done, total, rows[0].parentElement);
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
    [CARD, (e) => e.id.slice(19), (e) => e.querySelector('h4[id^="course-name-"]')],
    ['bb-recent-courses-view a[href*="/ultra/courses/_"]', (e) => e.getAttribute('href').match(/courses\/(_\d+_\d+)/)?.[1], (e) => e.querySelector('[class*="courseName"]')],
    ['.base-grades-course-tile', (e) => e.querySelector('a[href*="/grades"]')?.getAttribute('href').match(/(_\d+_\d+)\/grades/)?.[1], (e) => e.querySelector('.grades-header a.bb-click-target')],
  ];
  const badge = (el, label) => {
    if (!label) el.removeAttribute('data-gz-new');
    else if (el.getAttribute('data-gz-new') !== label) el.setAttribute('data-gz-new', label);
  };
  // A count's click or key (content.js's listeners hand them here, KIND has what each opens).
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
  const renderNew = () => {
    if (globalThis.GZ_CTABS?.showing?.() || (tabFrame && html.hasAttribute('data-gz-ctab-framed'))) return;
    const { newgrades, newcontent } = I.settings.enhance;
    if (!(newgrades || newcontent) || !solo || !I.observer) return;
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
    // ponytail: the first 12 cards on screen, one gradebook request each a minute; a long course list waits its turn.
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
        cardsInView.observe(el);
        const b = newgrades && (inView.has(el) && n++ < 12 ? bookFor(id) : books.get(id));
        if (b) cardBadge(el, id, b.results ? GZ_GRADES.fresh(b.results, seen[id]).ids.size : undefined);
        if (!newcontent) continue;
        const items = seenItems[id] && (inView.has(el) ? courseItems(id) : contents.get(id))?.items;
        cardBadge(el, id, GZ_GRADES.newItems(...against(id, items)).ids.size, 'items');
      }
    }
  };

  // ---- new content (Extras) -------------------------------------------------------------------
  // "New" on course items added (or made visible) since the course's content was last looked at here,
  // a count on a closed folder or module holding some, and on course cards. The first visit records
  // everything; an item is seen once its row has been on the page (the badge stays for that visit), so
  // what's in a folder only once it's unfolded. Kept on this device (storage.local, seenContent).
  // ponytail: "on the page", not on screen; a long outline's last rows count as seen unscrolled.
  // The course's items come from one paged read (ten pages of 200 at most), shared with the command palette and
  // asked again after five minutes at most, with only the fields used.
  const contents = new Map(); // cid → { at, p, items }
  const courseItems = (cid) => {
    let c = contents.get(cid);
    if (!c || Date.now() - c.at > 300000) {
      c = { at: Date.now(), items: c?.items };
      c.p = reader().then((r) => r.list(`/learn/api/public/v1/courses/${cid}/contents`, 'id,parentId,title,availability.available,links,contentHandler.isBbPage', true))
        .then((j) => { c.items = covered(j.items.filter((i) => i.availability?.available !== 'No'), j.complete); renderNew(); return c.items; }, () => c.items || []);
      contents.set(cid, c);
    }
    return c;
  };
  // What they're compared with: nothing after a read that stopped short (items it couldn't reach may slide into it), and
  // a fresh start over a record kept before reads were paged (no '+'), which saw only the first 200.
  const against = (cid, items) => {
    const kept = seenItems[cid];
    return items?.complete === false ? [null, kept] : [items, !kept?.includes('+') ? undefined : kept];
  };
  const shownItems = new Map(); // cid → content ids badged on this page
  let jump = null; // { under (a folder id, or null for the whole course), at, opened (folder ids) }
  const renderItems = (cid) => {
    const rows = document.querySelectorAll('.content-list-item[data-content-id]');
    const c = rows.length && courseItems(cid);
    if (!c?.items) return;
    const { ids, seen: was, inside } = GZ_GRADES.newItems(...against(cid, c.items), new Set([...rows].map((r) => r.dataset.contentId)));
    const now = c.items.complete !== false && was && !was.includes('+') ? [...was, '+'] : was;
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

  // ---- grades (Extras): features/grades.js (what-if, GPA), syllabus.js (outline), insights.js (Courses) ----
  const loadIf = (want, f, name, run) => (globalThis[name] || (I.observer && want)) && need(`features/${f}.js`, () => globalThis[name]).then(() => run(globalThis[name]), () => {});
  const onPath = (re) => re.test(location.pathname);
  const renderCalc = () => { const e = I.settings.enhance; loadIf((e.calc && onPath(/^\/ultra\/courses\/_\d+_\d+\/grades/)) || (e.gpa && onPath(/^\/ultra\/grades\/?$/)), 'grades', 'GZ_GRADES_UI', (g) => g.render()); };
  const sylHere = () => solo && I.settings.enhance.syllabus && onPath(/^\/ultra\/courses\/_\d+_\d+\/outline/);
  const syncSyl = () => loadIf(sylHere(), 'syllabus', 'GZ_SYL_UI', (s) => s.sync(I.observer && sylHere()));
  const syncInsights = () => loadIf(I.settings.enhance.insights && onPath(/^\/ultra\/course$/), 'insights', 'GZ_INSIGHTS_UI', (s) => s.sync());

  // ---- code on demand ------------------------------------------------------------------------------
  // Notes, widgets and the pet: the Courses page's board, the tiles floating over every page, and the Dashboard (the
  // Institution page, B7b; its own switch, enhance.dashboard, on by default). Ultra routes without reloading; this pass
  // also places Course notes on the outline. Until the Dashboard is drawn, Ultra's own Institution page waits hidden
  // (html[data-gz-dash], apps.css), so it doesn't show for a moment first. A page loaded at Ultra's start may go on to the
  // Dashboard (opt-in, once: features/dashboard.js); from is its first address, kept until a pass has the settings.
  let from = location.pathname;
  let globalFloats = false, floatEpoch = 0;
  const floatsIn = (l) => {
    globalFloats = Array.isArray(l?.boards?.pages) ? l.boards.pages.some((x) => x?.on === true)
      : Array.isArray(l?.tiles) && l.tiles.some((x) => x?.on === true && x.float === true);
    syncWidgets();
  };
  const dash = () => top()?.dashboard && /^\/ultra\/institution-page\/?$/.test(location.pathname);
  // A course tab's frame has the dock's widgets only (floats and the wandering pet are the page's).
  const widgetsHere = () => { const e = top(); if (e && tabFrame) return sidebarOn() && !!(e.widgets || e.notes || e.pet || e.todo); return !!e && (dash() || e.widgets || e.notes || e.pet || (e.dashboard && globalFloats) || (e.todo && sidebarOn())); };
  const syncWidgets = () => {
    syncSidebar();
    const on = widgetsHere();
    if (!dash()) html.removeAttribute('data-gz-dash'); else if (!html.hasAttribute('data-gz-dash')) html.setAttribute('data-gz-dash', '');
    if (on) need('features/widgets.js', () => globalThis.GZ_WIDGETS_UI).then(() => GZ_WIDGETS_UI.sync(widgetsHere()), () => { if (dash()) html.setAttribute('data-gz-dash', 'ip'); }); else globalThis.GZ_WIDGETS_UI?.sync(false);
    if (from && top()?.dashboard) { const f = from; from = ''; if (/^\/ultra(\/(stream|course))?\/?$/.test(f)) need('features/dashboard.js', () => globalThis.GZ_DASH_UI).then(() => GZ_DASH_UI.land(f), () => {}); }
    if (solo && (globalThis.GZ_NOTES_UI || (I.settings.enhance.notes && /^\/ultra\/courses\/_\d+_\d+\/outline/.test(location.pathname)))) need('features/notes.js', () => globalThis.GZ_NOTES_UI).then(() => GZ_NOTES_UI.sync(!!I.links.length && I.settings.enhance.notes), () => {});
  };
  if (window.top === window) try {
    const epoch = floatEpoch;
    // Not on a fresh tab's defaults: Glaze may be off.
    chrome.storage.local.get('widgetLayout', (r) => { const go = () => epoch === floatEpoch && floatsIn(r?.widgetLayout); if (!chrome.runtime.lastError) Promise.resolve().then(() => I.ready).then(go, go); });
    chrome.storage.onChanged.addListener((ch, area) => { if (area === 'local' && ch.widgetLayout) { const epoch = ++floatEpoch; Promise.resolve().then(() => I.ready).then(() => { if (epoch === floatEpoch) floatsIn(ch.widgetLayout.newValue); }, () => {}); } });
  } catch { /* extension reloaded */ }

  // Course tabs load on demand; extras.css first reserves their cached place and size.
  const tabsOn = () => !!I.links.length && (isPreview || solo) && I.settings.enhance.tabs && !globalThis.GZ_CTABS?.revoked?.();
  const syncTabs = () => (tabsOn() ? need('lib/coursetabs.js', () => globalThis.GZ_CTABS_LIB).then(() => need('features/coursetabs.js', () => globalThis.GZ_CTABS))
    .then(() => GZ_CTABS.sync(tabsOn()), () => {}) : globalThis.GZ_CTABS?.sync(false));

  // ---- page changes ---------------------------------------------------------------------------
  // Ultra swaps pages in place, painting its half-built states on the way (and one long script can
  // stall it for half a second). A click on the main menu or a course's tabs instead holds the old
  // page in a view transition until the next one exists, then crossfades into it: when the address has
  // changed and the new page has been still for 120 ms, or after 500 ms at most. A page of its own (a course tab's
  // frame too), and only while entrances are on. Route containers themselves stay visible as Ultra builds them.
  if (solo && document.startViewTransition) {
    const PAGE_LINKS = '#base_tools a, .bb-ui-navigation-list-horizontal a';
    const settled = (from) => new Promise((done) => {
      const t0 = performance.now();
      let still = t0;
      const mo = new MutationObserver(() => { still = performance.now(); });
      mo.observe(document.body, { childList: true, subtree: true });
      const check = () => {
        const now = performance.now();
        if ((location.href !== from && now - still > 120) || now - t0 > 500) { mo.disconnect(); done(); } else setTimeout(check, 25);
      };
      setTimeout(check, 25);
    });
    let replaying = false;
    document.addEventListener('click', (e) => {
      if (replaying || !I.observer || e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      if (html.getAttribute('data-gz-motion') === 'off' || html.hasAttribute('data-gz-no-enter')) return;
      const link = e.target instanceof Element && e.target.closest(PAGE_LINKS);
      // Native fragment actions and Sign Out must keep their trusted click for later listeners (course tabs included).
      if (!link || link.matches('[aria-current="page"], .active') || /^#|^$|(?:^|\/)logout(?:[/?#]|$)|[?&](?:action|event)=logout(?:[&#]|$)/i.test((link.getAttribute('href') || '').trim())) return;
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

  // ---- course colors and tint ------------------------------------------------------------------
  // A course's own pages carry its color slot on the course section; its item pages carry nothing, so
  // the slot is remembered per course id, on this device (courseSlots, content.js's).
  const COURSE = 'section.course[class*="course-color-"]';
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
    return GZ_CAL_COURSE(el.textContent, el.className.match?.(/course-color-(\d+)/)?.[1], calItems, I.courseList);
  };
  const paintCourses = () => {
    let at = null;
    try { at = sessionStorage.getItem('gz-ctabs'); } catch { /* blocked */ }
    if (at === 'nav') {
      const b = I.settings.navbar;
      let holds = b?.on && b.tabs && (!/^\/ultra\/courses\//.test(location.pathname) || b.course !== 'hide');
      if (tabFrame) try { holds = (parent.document.documentElement.getAttribute('data-gz-navbar') || '').split(' ').includes('tabs'); } catch { holds = false; }
      // A cached nav placement still needs a host.
      if (!holds) at = 'above medium';
    }
    I.setAttr('data-gz-ctabs', tabsOn() && (at ?? 'above medium'));
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
  // The course tinting the page now, as { key, slot, vars }, or null.
  const tintOf = () => {
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
    const { tint, tinted: picked } = I.settings.courses;
    // Cut off by a reload or update of Glaze (no runtime id), ticks since removed never arrive: no tint.
    if (!tint || !chrome.runtime?.id) return null;
    // The editor's preview is its first ticked course: the section carries that course's slot and color.
    if (!cid) return isPreview && slot && picked.length ? { key: `${slot};${sec.style.cssText}`, slot, vars: sec.style.cssText } : null;
    // Ticked by id; a slot number is a tick from before each course had its own.
    const now = courseSlots[cid];
    return now && (picked.includes(cid) || picked.includes(now)) ? { key: cid, slot: now, vars: varText(GZ_COURSE_VARS(courseColors()[cid])) } : null;
  };
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

  // ---- course menu: nicknames (Extras) -----------------------------------------------------------
  // The nickname given to a course, while the Extra is on; '' for none. Only Glaze's own surfaces and the page's
  // course names call this: Blackboard's real name is always the course list's (recordCourses), never the page's.
  const nickOf = (cid) => (I.observer && I.settings.enhance.coursemenu && I.settings.courses.names[cid]) || '';
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
    const real = I.courseList[cid]?.name;
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
    syncNav();
    if (!document.querySelector('[data-gz-real]') && !Object.keys(I.settings.courses.names).length) return;
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

  html.removeAttribute?.('data-gz-nav-expanded');
  const navRoots = new Set(), renamed = new Map();
  const navSelector = 'nav#base_tools, nav:has(> #base_tools), nav[class*="makeStylesnavigation"]';
  let navDirty = false, navQueued = false;
  const syncDashboard = () => {
    if (!chrome.runtime?.id) return;
    const enabled = I.links.length && I.settings.enabled, on = enabled && I.settings.enhance.dashboard;
    if (navDirty) {
      navDirty = false;
      for (const root of navRoots) {
        if (!root.isConnected) { navRoots.delete(root); continue; }
        const footer = root.closest?.('.MuiDrawer-paper')?.querySelectorAll('footer a[href], [class*="makeStylesfooter"] a[href]') || [];
        for (const a of [...root.querySelectorAll('a[href]'), ...footer]) {
          const id = GZ_NAV.native(a.getAttribute('href'));
          if (!id && !a.closest('footer, [class*="makeStylesfooter"]')) continue;
          const label = a.querySelector('.MuiTypography-root, .MuiListItemText-root, span:not(:has(svg))') || a;
          const text = label && document.createTreeWalker(label, NodeFilter.SHOW_TEXT).nextNode();
          const prior = renamed.get(a);
          if (text && prior?.node !== text) {
            let original;
            if (!prior && id === 'institution-page' && a.classList.contains('gz-nav-dashboard')) {
              try { const raw = a.getAttribute('data-gz-nav-original'); if (raw?.length <= 2048) { const v = JSON.parse(raw); if (typeof v?.text === 'string' && v.text.length <= 512 && ['aria', 'title'].every((k) => v[k] === null || typeof v[k] === 'string' && v[k].length <= 512)) original = v; } } catch { /* malformed own mark: keep native text */ }
            }
            renamed.set(a, { ...prior, node: text, text: original?.text ?? text.data, dashboard: id === 'institution-page', aria: original ? original.aria : prior ? prior.aria : a.getAttribute('aria-label'), title: original ? original.title : prior ? prior.title : a.getAttribute('title'), icon: prior?.icon || a.querySelector(':scope > svg.gz-nav-dashboard-icon') });
          }
        }
      }
    }
    for (const [a, r] of renamed) {
      if (!a.isConnected) { renamed.delete(a); continue; }
      const dash = on && r.dashboard, name = dash ? t('Dashboard') : r.text;
      r.painted = name;
      if (r.node.data !== name) r.node.data = name;
      if (dash && !a.hasAttribute('data-gz-nav-original')) a.setAttribute('data-gz-nav-original', JSON.stringify({ text: r.text, aria: r.aria, title: r.title }));
      else if (!dash && r.dashboard) a.removeAttribute('data-gz-nav-original');
      a.classList.toggle('gz-nav-dashboard', !!dash);
      if (dash && !r.icon) {
        r.icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        r.icon.classList.add('gz-nav-dashboard-icon'); r.icon.setAttribute('viewBox', '0 0 24 24'); r.icon.setAttribute('aria-hidden', 'true');
        const path = document.createElementNS(r.icon.namespaceURI, 'path'); path.setAttribute('d', 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z'); r.icon.append(path);
      }
      if (dash && !r.icon.isConnected) a.prepend(r.icon); else if (!dash) r.icon?.remove();
      for (const [key, value] of [['aria-label', r.aria], ['title', r.title]]) {
        const next = dash ? name : key === 'title' && enabled && !r.dashboard ? value || name.trim() : value;
        if (next === null) a.removeAttribute(key); else if (a.getAttribute(key) !== next) a.setAttribute(key, next);
      }
    }
  };
  // Glaze settings, last in Ultra's nav: a copy of its last item (so every nav setting styles it), Glaze's drop for its
  // icon (theme.css); it opens the editor. Hidden and moved like Ultra's own (lib/nav.js NATIVE 'glaze').
  const glazeItem = (on) => {
    for (const root of navRoots) {
      const g = root.isConnected && root.querySelector('a[href="#glaze"]');
      if (!on) { (g?.parentElement.classList.contains('gz-nav-glaze') ? g.parentElement : g || null)?.remove(); continue; }
      const last = root.isConnected && !g && [...root.querySelectorAll('a[href]')].filter((a) => GZ_NAV.native(a.getAttribute('href'))).pop();
      if (!last) continue;
      const a = last.cloneNode(true), name = t('Glaze settings');
      for (const k of ['id', 'aria-current', 'target', 'data-gz-nav-id', 'data-gz-nav-original']) a.removeAttribute(k);
      a.classList.remove('active', 'Mui-selected', 'gz-nav-dashboard');
      Object.assign(a, { href: '#glaze', title: name }); a.setAttribute('aria-label', name);
      a.querySelector('svg')?.replaceWith(Object.assign(document.createElement('span'), { className: 'gz-nav-glaze-icon' }));
      const label = a.querySelector('.MuiTypography-root, .MuiListItemText-root, span:not(:has(svg)):not(.gz-nav-glaze-icon)') || a;
      const text = document.createTreeWalker(label, NodeFilter.SHOW_TEXT).nextNode();
      if (text) text.data = name; else label.append(name);
      a.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); try { chrome.runtime.sendMessage('options'); } catch { /* reloaded */ } });
      const li = last.parentElement.tagName === 'LI' && Object.assign(last.parentElement.cloneNode(false), { id: '' });
      if (li) { li.hidden = false; li.classList.add('gz-nav-glaze'); li.append(a); last.parentElement.after(li); } else last.after(a);
    }
  };
  const queueNav = () => { if (!navQueued) { navQueued = true; queueMicrotask(() => { navQueued = false; syncDashboard(); }); } };
  const navObserver = new MutationObserver((changes) => {
    if (!chrome.runtime?.id) { navObserver.disconnect(); return; }
    for (const m of changes) {
      const nodes = [...(m.addedNodes || []), ...(m.removedNodes || [])];
      if (nodes.length && nodes.every((n) => n.nodeType === 1 && n.classList?.contains('gz-nav-dashboard-icon'))) continue;
      const a = (m.target.nodeType === 1 ? m.target : m.target.parentElement)?.closest('a[href]');
      if (a && GZ_NAV.native(a.getAttribute('href'))) {
        const r = renamed.get(a);
        if (m.type === 'characterData' && r?.node === m.target) { if (m.target.data === r.painted) continue; r.text = m.target.data; }
        navDirty = true; queueNav(); return;
      }
      if (m.type === 'childList' && [...m.addedNodes].some((n) => n.nodeType === 1 && (n.matches('a[href]') && GZ_NAV.native(n.getAttribute('href')) || [...n.querySelectorAll('a[href]')].some((a) => GZ_NAV.native(a.getAttribute('href')))))) { navDirty = true; queueNav(); return; }
    }
  });
  // The existing core gate already sees added subtrees before paint; no second document-wide observer.
  const discoverNav = (scope) => {
    if (scope.closest?.('footer, [class*="makeStylesfooter"]')) navDirty = true;
    if ([...navRoots].some((root) => !root.isConnected)) {
      navObserver.disconnect();
      for (const root of navRoots) if (!root.isConnected) navRoots.delete(root); else navObserver.observe(root, { childList: true, subtree: true, characterData: true });
      navDirty = true;
    }
    if (![...navRoots].some((root) => root.contains(scope))) {
      const found = scope.matches?.(navSelector) ? [scope] : scope.querySelectorAll(navSelector);
      // Tagged for theme.css (.MuiDrawer-paper:has([data-gz-nav-root])): matching the class there would put a class
      // test in a :has(), and then every class Ultra changes anywhere would restyle the page.
      for (const root of found) if (!navRoots.has(root)) { navRoots.add(root); root.setAttribute('data-gz-nav-root', ''); navObserver.observe(root, { childList: true, subtree: true, characterData: true }); navDirty = true; }
    }
    if (navDirty) queueNav();
  };
  discoverNav(document);
  addEventListener('pagehide', () => navObserver.disconnect(), { once: true });
  const paintNav = (n, picture) => {
    if (!isPreview && window.top !== window) return;
    I.setAttr('data-gz-nav-size', n.size !== 'medium' || n.labels !== 'normal' || n.collapsed ? n.size : false);
    for (const [key, value] of [['overflow', n.labelOverflow], ['style', n.itemStyle], ['background', n.itemBackground], ['indicator', n.activeIndicator], ['logo-align', n.logoAlign], ['footer-hidden', !n.footer]]) I.setAttr(`data-gz-nav-${key}`, value);
    I.setVar('--gz-nav-logo-size', `${n.logoSize}px`);
    for (const k of ['labels', 'collapsed', 'f']) I.setAttr(`data-gz-nav-${k}`, n[k]);
    I.setAttr('data-gz-nav-no-logo', !n.logo);
    I.setAttr('data-gz-nav-brand', n.brand);
    // First-paint room, as GZ_NAVBAR.layout words it.
    const b = I.settings.navbar, c = /^\/ultra\/courses\//.test(location.pathname) ? b?.course : 'same';
    if (!globalThis.GZ_NAVBAR_UI?.live()) I.setAttr('data-gz-navbar', !!b?.on && `${c === 'same' ? `${b.place} ${b.rail}` : c === 'icons' ? 'rail icons' : c === 'hide' ? 'none' : 'top'} ${b.style}${c !== 'hide' && b.tabs && I.settings.enhance.tabs ? ' tabs' : ''}`);
    I.setAttr('data-gz-nav-detailed', n.detailed);
    for (const [k, v] of Object.entries(GZ_NAV.dimensions(n))) I.setVar(`--gz-nav-${k}`, `${v}px`);
    const src = n.i ? picture : n.u;
    I.setAttr('data-gz-nav', n.k !== 'default' && (n.k === 'image' && !src ? 'solid' : n.k));
    for (const [k, v] of [['ink', n.ink], ['c', n.c], ['d', n.d], ['a', `${n.a}deg`], ['o', n.o / 100], ['img', src ? `url("${src}")` : 'none']]) I.setVar(`--gz-nav-${k}`, v);
    syncDashboard();
  };
  // The nav's logo goes home in this tab: the Dashboard when it's on, else Courses (Ultra's opens "/" in a new tab).
  document.addEventListener('click', (e) => {
    if (!I.links.length || !I.settings.enabled || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target.closest?.('.MuiDrawer-paper header.themed-logo-background-primary-fill a');
    if (!a) return;
    e.preventDefault(); e.stopPropagation();
    const id = I.settings.enhance.dashboard ? 'institution-page' : 'course';
    const link = document.querySelector(`.MuiDrawer-paper a[href$="/ultra/${id}"]`);
    if (link) link.click(); else location.assign(`/ultra/${id}`);
  }, true);
  let navRead = false, navItems = null;
  const syncNav = () => {
    globalThis.GZ_FOLDER_UI?.sync(!!top()?.hideFolders, meId);
    if (!isPreview && window.top !== window) return;
    syncDashboard();
    glazeItem(I.links.length && I.settings?.enabled);
    if (globalThis.GZ_NAVBAR_UI || (I.links.length && I.settings?.navbar?.on)) need('features/navbar.js', () => globalThis.GZ_NAVBAR_UI).then(() => GZ_NAVBAR_UI.sync(), () => {});
    if (globalThis.GZ_NAV_UI) GZ_NAV_UI.sync();
    else if (I.links.length && navItems) {
      const n = I.worn.nav;
      if (n.i || n.li || n.labelOverflow === 'shrink' || n.collapsed || n.labels === 'icons' || globalThis.GZ_CTX?.parts()?.nav || ['links', 'order', 'hidden'].some((k) => Array.isArray(navItems[k]) && navItems[k].length) || (Array.isArray(navItems.widgets) && navItems.widgets.some((w) => w?.on === true))) need('features/nav.js', () => globalThis.GZ_NAV_UI).then(() => GZ_NAV_UI.sync()).catch(() => {});
    } else if (I.links.length && !navRead) {
      navRead = true;
      try { chrome.storage.sync.get('navItems', (r) => {
        navRead = false;
        navItems ||= r?.navItems || {}; syncNav();
      }); } catch { navRead = false; }
    }
    if (isPreview || location.pathname === '/ultra/course' || globalThis.GZ_CARD_UI) need('features/cards.js', () => globalThis.GZ_CARD_UI).then(() => GZ_CARD_UI.paint(), () => {});
  };
  chrome.storage.onChanged.addListener((c, area) => { if (area === 'sync' && c.navItems) { navItems = c.navItems.newValue || {}; syncNav(); } });
  // A host registered for another LMS may answer settings before Ultra's schema arrives.
  if (!('brand' in I.settings.nav)) {
    const nav = I.settings.nav;
    Object.assign(nav, { ...GZ_DEFAULTS.nav, ...nav });
    try { chrome.storage.sync.get('nav', (raw) => {
      if (I.settings.nav !== nav || chrome.runtime.lastError) return;
      Object.assign(nav, GZ_SANITIZE(raw).nav);
      if (I.links.length) { paintNav(I.worn.nav); syncNav(); }
    }); } catch { /* reloaded; keep defaults */ }
  }

  return {
    paintNav, syncNav, record, tagCards: tagCourseCards, tagExtras: tagPage, gate, stop: () => { syncDashboard(); globalThis.GZ_NAVBAR_UI?.sync(); globalThis.GZ_FOLDER_UI?.sync(false); cardsIO.disconnect(); onScreen.clear(); },
    renderProgress, renderNew, renderCalc, syncSyl, syncInsights: () => (syncInsights(), syncTabs()), openNew, paintCourses, tintOf, courseColor, nickOf, syncNames,
    unname: () => { for (const p of document.querySelectorAll('[data-gz-real]')) unname(p); },
    syncTodo, syncCardTasks, syncRemind, syncWidgets,
    ctx: { canvasPeek: () => ({ me: meId, courses: memberships, books }), me, myCourses, courseItems, bookFor, courseColor, profile: page('profile'), canvasCourses: page('courses') },
  };
});

// Known Ultra entry: arm before asynchronous head detection lets the parser reach <body>.
if (/html/.test(document.contentType) && !document.body && location.protocol === 'https:' && !location.port && /\.blackboard\.com$/.test(location.hostname) && /^\/ultra(?:\/|$)/.test(location.pathname) && !GZ_SITE_ULTRA.sheets) {
  GZ_SITE_ULTRA.sheets = ['theme.css', 'motion.css', 'extras.css', 'features/apps.css'].map((f) => {
    const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = chrome.runtime.getURL(f);
    l.setAttribute('blocking', 'render');
    l.onload = l.onerror = () => l.removeAttribute('blocking'); setTimeout(l.onload, 1000);
    (document.head || document.documentElement).appendChild(l); return l;
  });
}
GZ_SITE_ULTRA;
