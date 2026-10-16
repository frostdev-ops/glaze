// Glaze on Moodle: what is due this week (for the popup and the command palette), the palette's pages and courses, and
// each course card's total. Read-only: it asks the student's own Moodle, with their session, what Moodle's own pages ask
// (the Timeline and Course overview blocks' service calls), and reads the grades overview page as they would see it.
// Loaded on demand into the page's Glaze world (content.js moodleIn), after lib/moodle.js; uses content.js's helpers
// through GZ_CTX. A second injection into the same frame keeps the first.
var GZ_MOODLE_PAGE = globalThis.GZ_MOODLE_PAGE || (() => {
  const M = GZ_MOODLE;
  // Where Moodle lives on this host (its address can be a folder: school.edu/moodle) and the session key its own pages
  // send, from the user menu's log-out link, which every signed-in page has. None: signed out, or not this site's.
  const session = () => {
    let u;
    try { u = new URL(document.querySelector('a[href*="/login/logout.php?sesskey="]')?.href); } catch { return null; }
    const sesskey = u.searchParams.get('sesskey');
    return u.origin === location.origin && sesskey ? { root: u.origin + u.pathname.replace(/\/login\/logout\.php$/, ''), sesskey } : null;
  };
  const service = (methodname, args) => {
    const s = session();
    if (!s) return Promise.reject(new Error('signed out'));
    return fetch(`${s.root}/lib/ajax/service.php?sesskey=${encodeURIComponent(s.sesskey)}&info=${methodname}`, {
      method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(M.call(methodname, args)),
    }).then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status))))).then(M.answer);
  };

  // The Timeline's own call, for the week ahead. ponytail: Moodle's cap of 50 events; a week with more shows the soonest 50.
  const due = (now) => {
    const from = Math.floor(now / 1000);
    return service('core_calendar_get_action_events_by_timesort', { timesortfrom: from, timesortto: from + 7 * 86400, limitnum: 50, limittononsuspendedevents: true })
      .then((d) => M.due(d, now, location.origin));
  };

  // The command palette: on a course's home, its tabs (read off the page; an activity's own tabs are its, not the
  // course's), Moodle's main pages, the courses in progress.
  let mine = null;
  const courses = () => (mine ||= service('core_course_get_enrolled_courses_by_timeline_classification', { classification: 'inprogress', limit: 0, offset: 0, sort: 'fullname' })
    .then((d) => M.courses(d, location.origin), () => { mine = null; return []; }));
  const PAGES = [['/my/', 'Dashboard'], ['/my/courses.php', 'Courses'], ['/calendar/view.php?view=month', 'Calendar'], ['/grade/report/overview/index.php', 'Grades'], ['/message/index.php', 'Messages'], ['/user/profile.php', 'Profile']];
  const commands = async (go) => {
    const { t } = GZ_CTX;
    const root = session()?.root.slice(location.origin.length) ?? '';
    const tabs = [...document.querySelectorAll('body.pagelayout-course .secondary-navigation a[href]:is(.nav-link, .mds-nav-pill, .dropdown-item):not([href="#"], [data-bs-toggle], .dropdown-toggle)')]
      .map((a) => ({ label: a.textContent.trim(), hint: t('This course'), group: 'Go to', run: go(a.href) })).filter((c) => c.label);
    return [
      ...tabs,
      ...PAGES.map(([path, label]) => ({ label: t(label), hint: 'Moodle', group: 'Go to', run: go(root + path) })),
      ...(await courses()).map((c) => ({ label: c.name, hint: c.code || t('Course'), group: 'Courses', run: go(c.url) })),
    ];
  };

  // Every course the student is in, for the editor's list, the course menu, the tint and the cards (below), kept beside
  // other sites' courses (storage.local seenCourses, content.js's course keys). content.js asks once a page load (top
  // frame); Moodle is asked when this root (the courses' keys' own: one host can hold two Moodles, in folders) has no
  // course kept, or its list is ten minutes old (`seenCoursesAt <key prefix>`). Nothing is asked while Glaze is off, checked
  // again once storage answers: the promise rejects, and content.js asks again when Glaze comes back on, as after a
  // failed read (which the next page asks again too).
  let recording = null;
  const live = () => GZ_CTX.settings().enabled && GZ_CTX.on();
  const record = () => {
    if (!live()) return Promise.reject(new Error('off'));
    paint();
    const pre = GZ_CTX.canvasCourseKey('x')?.slice(0, -1); // moodle:<root>/
    if (!/^moodle:https?:\/\//.test(pre)) return Promise.resolve();
    const at = `seenCoursesAt ${pre}`;
    const get = (keys) => new Promise((res) => GZ_CTX.local((l) => l.get(keys, (r) => res(r || {}))));
    return (recording ||= get(['seenCourses', at]).then((r) => {
      if (!live()) throw new Error('off');
      if (Date.now() - (r[at] || 0) < 600000 && Object.keys(r.seenCourses || {}).some((k) => k.startsWith(pre) && /^\d+$/.test(k.slice(pre.length)))) return;
      return service('core_course_get_enrolled_courses_by_timeline_classification', { classification: 'all', limit: 0, offset: 0, sort: 'fullname' })
        .then((d) => {
          const seen = M.seen(d, GZ_CTX.canvasCourseKey);
          return get('seenCourses').then((now) => GZ_CTX.local((l) => l.set({ seenCourses: { ...now.seenCourses, ...seen }, [at]: Date.now() })));
        });
    }).catch((e) => { recording = null; throw e; }));
  };

  // Each card (Dashboard and My courses) in its course's own Look and tint, as the course's pages wear them (content.js
  // applySettings): the palette as --gz-* on the card, from which moodle.css derives the rest there. Only on change; with
  // the course menu's edits, the cards' redraws and a switch to dark, content.js's syncCards calls this again.
  const painted = new WeakMap();
  const paint = () => {
    const s = GZ_CTX.settings();
    const list = GZ_CTX.courseList();
    const on = s.enabled && GZ_CTX.on();
    for (const card of document.querySelectorAll('[data-region="course-content"][data-course-id]')) {
      const key = GZ_CTX.canvasCourseKey(card.dataset.courseId);
      const color = on && s.courses.tint && s.courses.tinted.includes(key) && list[key]?.color;
      const look = on && s.courses.looks[key];
      const worn = GZ_COURSE_LOOK(s, key);
      let colors = (look || color) && GZ_ACTIVE_COLORS(worn, matchMedia('(prefers-color-scheme: dark)').matches);
      if (color) colors = GZ_TINT(colors, color, s.courses.strength / 100);
      const vars = colors ? { ...colors, ...Object.fromEntries(Object.entries(GZ_SURFACE_VARS({ ...worn, bg: s.bg })).map(([key, value]) => [key, value || 'initial'])),
        '--gz-radius': `${worn.look.radius}px`, '--gz-radius-sm': `${worn.look.radius * 2 / 3}px`, '--gz-glass': `${worn.look.glass}px` } : {};
      const text = colors ? JSON.stringify([vars, worn.look.depth]) : '';
      if ((painted.get(card) || '') === text) continue;
      painted.set(card, text);
      const keys = [...GZ_COLORS.map(([v]) => v), ...Object.keys(GZ_SURFACE_VARS(s)), '--gz-radius', '--gz-radius-sm', '--gz-glass'];
      for (const v of keys) if (colors) card.style.setProperty(v, vars[v]); else card.style.removeProperty(v);
      if (colors) {
        card.dataset.gzCourseLook = GZ_COLOR.brightness(GZ_COLOR.parse(colors['--gz-surface'])) < 0.5 ? 'dark' : 'light';
        card.dataset.gzDepth = String(worn.look.depth);
      } else { delete card.dataset.gzCourseLook; delete card.dataset.gzDepth; }
    }
  };

  // Grades on course cards (Dashboard and My courses): the totals from the grades overview, asked once a page load when a
  // card is on the page. Each card's name is tagged; moodle.css draws the chip. Only on change: the cards are redrawn
  // when the student pages, filters or switches views, and come back here through content.js's sweep.
  let totals = null;
  const cards = () => {
    const s = session();
    if (!s) return;
    totals ||= fetch(`${s.root}/grade/report/overview/index.php`, { credentials: 'same-origin' })
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status))))).then(M.overview).catch(() => ({}));
    totals.then((byId) => {
      const now = GZ_CTX.settings();
      if (!now.enabled || !now.enhance.overall) return; // switched off while it was asked
      for (const card of document.querySelectorAll('[data-region="course-content"][data-course-id]')) {
        const el = card.querySelector('.coursename');
        const g = el && byId[card.dataset.courseId] && M.grade(byId[card.dataset.courseId]);
        const tone = g && g.pct !== null && `graded-${GZ_PAGE.score(g.pct, 100).band}`;
        if (!el) continue;
        if (!g) { el.removeAttribute('data-gz-grade'); el.removeAttribute('data-gz-chip'); continue; }
        if (el.getAttribute('data-gz-grade') !== g.label) el.setAttribute('data-gz-grade', g.label);
        if (!tone) el.removeAttribute('data-gz-chip');
        else if (el.getAttribute('data-gz-chip') !== tone) el.setAttribute('data-gz-chip', tone);
      }
    });
  };

  return { session, due, commands, cards, record, paint };
})();

GZ_MOODLE_PAGE;
