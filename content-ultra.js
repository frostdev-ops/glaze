// Glaze — Blackboard Ultra's part of the first content script: what only Ultra does, so Canvas and Moodle don't parse it.
// Listed before content.js for /ultra pages (and in the options preview); content.js calls it with its helpers and live
// state (I) and puts what it returns over its defaults (X). A second copy keeps the first; it ends on its value (loadable).
var GZ_SITE_ULTRA = globalThis.GZ_SITE_ULTRA || ((I) => {
  const { C, html, isPreview, need, t, locale, api, courseId, markDue, drawProgress, cardBadge, cardsInView, inView, tagCards, tagExtras, courseSlots, courseColors, varText, CARD, dueLabelled } = I;

  // ---- the student's courses -------------------------------------------------------------------
  // Every course and the color slot Ultra gives it, for the editor's course list and the tint on
  // pages that don't show the slot: from the membership list Ultra's own Courses page asks for, once
  // a page load and at most every ten minutes. Stored locally; nothing leaves the device.
  const record = () => {
    try {
      chrome.storage.local.get('seenCoursesAt', (r) => {
        if (Date.now() - (r?.seenCoursesAt || 0) < 600000) return;
        myCourses().then((ms) => {
          const seen = GZ_COURSES(ms);
          if (!Object.keys(seen).length) return;
          for (const [id, c] of Object.entries(seen)) courseSlots[id] = c.slot;
          // Its site and code, to place Gradescope courses with (lib/gradescope.js).
          for (const m of ms) if (seen[m.courseId]) Object.assign(seen[m.courseId], { site: location.origin, code: String(m.course.displayId || '').slice(0, 80) });
          try { chrome.storage.local.get('seenCourses', (r) => {
            const canvas = Object.fromEntries(Object.entries(r?.seenCourses || {}).filter(([k]) => k.includes(':')));
            chrome.storage.local.set({ seenCourses: { ...canvas, ...seen }, seenCoursesAt: Date.now(), courseSlots });
          }); } catch { /* reloaded */ }
        });
      });
    } catch { /* extension reloaded under the tab */ }
  };

  // ---- the gradebook --------------------------------------------------------------------------
  // One /users/me for everything that asks at once; asked again only if it failed.
  let meId = null;
  const me = () => (meId ||= api('/users/me').then((m) => m.id).catch((e) => { meId = null; throw e; }));
  // The student's courses, once per page: names for the command palette, and each membership's
  // due-date exception setting.
  let memberships = null;
  const myCourses = () => (memberships ||= me().then((id) => api(`/users/${id}/memberships?expand=course&limit=200`)).then((j) => j.results || []).catch(() => (memberships = null, [])));
  // ---- planning (features/todo.js, cardtasks.js, reminders.js, calexport.js, classes.js), as Canvas's part answers it ----
  // The student (Ultra keeps no time zone: the browser's) and their courses in Canvas's shape (lib/ultra.js list); what's
  // due is lib/ultra.js pageDue. Better To Do on the Courses page and a course's outline, tasks on the Courses page's
  // cards, reminders on any page; each loaded once it's on.
  const profile = () => me().then((id) => ({ id, time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone }));
  const canvasCourses = () => need('lib/ultra.js', () => globalThis.GZ_ULTRA).then(myCourses).then((ms) => GZ_ULTRA.list(ms, { origin: location.origin }));
  const load = (on, file, name) => (on ? need(file, () => globalThis[name]).then(() => globalThis[name].sync(on), () => {}) : globalThis[name]?.sync(false));
  const top = () => I.links.length && window.top === window;
  const syncTodo = () => load(top() && I.settings.enhance.todo && /^\/ultra\/(course\/?$|courses\/_\d+_\d+\/outline)/.test(location.pathname), 'features/todo.js', 'GZ_TODO_UI');
  const syncCardTasks = () => load(top() && I.settings.enhance.cardTasks && /^\/ultra\/course\/?$/.test(location.pathname) && !!document.querySelector(CARD), 'features/cardtasks.js', 'GZ_CARD_TASKS');
  const syncRemind = () => load(top() && ['remind', 'remindExam', 'remindPlan', 'remindClass', 'streak'].some((k) => I.settings.enhance[k]), 'features/reminders.js', 'GZ_REMIND_UI');

  // Submitted late: the latest attempt against the due date, for work waiting to be graded. An
  // attempt's date never changes, so each is asked once. Nothing is called late in a course that
  // gives this student due-date exceptions, or for an item with one of its own.
  const attempts = new Map();
  const lateIn = (cid, results) => {
    const waiting = GZ_GRADES.awaiting(results);
    if (!waiting.length || !I.settings.enhance.inline) return Promise.resolve(new Set());
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

  // ---- page loads ------------------------------------------------------------------------------
  // Ultra builds a page in view: a spinner, then parts arriving and pushing each other down, with
  // Glaze's progress bar and chips landing on top. A page's container (a course tab's, not the course
  // shell around it) is held hidden while that happens and let go once it's built: still for 300 ms
  // (pages that load per course, like Grades, pause ~250 ms between parts), no spinner or skeleton
  // showing, the course's grades in, or after 2.5 s at most. It then resolves from a blur, once
  // (motion.css). content.js's mutation callback hands each added element here (gate) and each change (still), so a
  // page is held before it's first painted.
  const GATE = '.route-view-container:not(.bb-offcanvas-container)';
  const held = new Map(); // container -> { at, still }
  let gateTimer = 0;
  const loaderIn = (el) => [...el.querySelectorAll('.spinner, path[class*="makeStylesindeterminateSvg-"], .MuiSkeleton-root')]
    .some((e) => e.getClientRects().length && !e.closest('.ng-hide'));
  const release = () => {
    const now = performance.now();
    for (const [el, t] of held) {
      if (el.isConnected && now - t.at < 2500 && (now - t.still < 300 || I.timer || [...books.values()].some((b) => b.pending) || loaderIn(el))) continue;
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
  const gate = (n) => {
    if (n.matches(GATE)) hold(n);
    else if (n.firstElementChild) for (const c of n.querySelectorAll(GATE)) hold(c);
  };
  const still = (target) => { if (held.size) for (const [el, t] of held) if (el.contains(target)) t.still = performance.now(); };

  // ---- course progress (Extras) ---------------------------------------------------------------
  // One bar above the course outline adding up what the outline already says: each folder's
  // "N of M completed" (in any language: lib/page.js) plus each top-level item's review circle. Redrawn
  // only when the numbers move. The Content page only: other course tabs (Discussions) list items too.
  const renderProgress = () => {
    const old = document.getElementById('gz-progress');
    if (!I.settings.enhance.progress || !/^\/ultra\/courses\/_\d+_\d+\/outline(\/|$)/.test(location.pathname)) return old?.remove();
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
    const { newgrades, newcontent } = I.settings.enhance;
    if (!(newgrades || newcontent) || window.top !== window || !I.observer) return;
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
  // features/whatif.js (with lib/gradecalc.js), loaded on a course's Grades once its grades are in.
  const renderCalc = () => {
    if (globalThis.GZ_WHATIF) return GZ_WHATIF.render();
    const cid = courseId();
    if (I.settings.enhance.calc && I.observer && cid && /^\/ultra\/courses\/_\d+_\d+\/grades/.test(location.pathname) && document.querySelector('.grades-list > aside.student-grade-overview') && bookFor(cid).results) {
      need('lib/gradecalc.js', () => globalThis.GZ_GRADECALC).then(() => need('features/whatif.js', () => globalThis.GZ_WHATIF)).then(() => GZ_WHATIF.render(), () => {});
    }
  };

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
      if (replaying || !I.observer || e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
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

  return {
    record, tagCards: tagCourseCards, tagExtras: tagPage, gate, still, stop: () => { cardsIO.disconnect(); onScreen.clear(); },
    renderProgress, renderNew, renderCalc, openNew, paintCourses, tintOf, courseColor, nickOf, syncNames,
    unname: () => { for (const p of document.querySelectorAll('[data-gz-real]')) unname(p); }, holding: () => held.size > 0,
    syncTodo, syncCardTasks, syncRemind,
    ctx: { myCourses, courseItems, bookFor, courseColor, profile, canvasCourses },
  };
});

GZ_SITE_ULTRA;
