// The command palette (enhance.palette), loaded on demand: content.js loads this on the first Ctrl+K (⌘K on a Mac) and
// opens it (open). One search over the site's pages, your courses, this course's tabs and items, what is due and Glaze's
// own switches. Courses and items are asked of Ultra's own APIs once per page, when it first opens. On Canvas it searches
// Canvas's pages, your courses, this course's tabs, what is due and Glaze's switches; with search on, your courses' content
// too (features/search.js). Classic script, through GZ_CTX; a second injection keeps the first.
var GZ_CMD = globalThis.GZ_CMD || (() => {
  const ctx = globalThis.GZ_CTX;
  const ultra = ctx.site === 'ultra';
  const moodle = ctx.site === 'moodle';
  const { t, locale, need, capi, canvasCourseId, canvasCourses, dueWeek, moodleIn, myCourses, courseId, courseItems, nickOf } = ctx;
  const TOOLS = [['/ultra/course', 'Courses'], ['/ultra/calendar', 'Calendar'], ['/ultra/grades', 'Grades'], ['/ultra/messages', 'Messages'],
    ['/ultra/stream', 'Activity stream'], ['/ultra/organizations', 'Organizations'], ['/ultra/profile', 'Profile'], ['/ultra/tools', 'Tools']];
  const EXTRAS = { urgency: 'Due-date urgency', clamp: 'Shorter descriptions', scores: 'Score bars', reading: 'Reading width', inline: 'Due-date status and percentages',
    previews: 'Folder previews', progress: 'Course progress', keys: 'Keyboard shortcuts', newgrades: 'New-grade badges', newcontent: 'New-content badges', calc: 'What-if calculator', coursemenu: 'Course menu', search: 'Search in your courses' };
  // Canvas's global navigation, and the same switches plus the card grades and the GPA.
  const CANVAS_TOOLS = [['/', 'Dashboard'], ['/courses', 'Courses'], ['/calendar', 'Calendar'], ['/conversations', 'Inbox'], ['/grades', 'Grades']];
  const CANVAS_EXTRAS = { ...EXTRAS, overall: 'Grades on course cards', quizLight: 'Keep quizzes light', gradeHover: 'Card grades only on hover',
    gpa: 'Grade point average', gpaPlus: 'Plus/minus grade points', gpaWeighted: 'Weighted grade points', gpaAfter: 'Grade point average below the cards', todo: 'Better To Do', cardTasks: 'Tasks on course cards', gradescope: 'Gradescope in To Do', search: 'Search in your courses',
    remind: 'Due-date reminders', remindExam: 'Exam reminders', remindPlan: 'Plan reminders', remindClass: 'Class reminders', streak: 'Streak', pet: 'Pet habitat',
    docTheme: 'Document viewer in your palette', docInk: 'Pen and highlighter on documents',
    notes: 'Notes', widgets: 'Widgets', syllabus: 'Syllabus import', insights: 'Insights' };
  // A path on this site, or a full address (a Canvas tab can be another site's, an external tool's): web pages only.
  const go = (url) => () => {
    let u;
    try { u = new URL(url, location.origin); } catch { return; }
    if (u.protocol === 'https:' || u.protocol === 'http:') location.assign(u.href);
  };
  const pages = () => (moodle ? [] : ultra ? TOOLS : CANVAS_TOOLS).map(([path, label]) => ({ label: t(label), hint: ultra ? 'Blackboard' : 'Canvas', group: 'Go to', run: go(path) }));
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
    return due.filter((d) => d.due >= now).map((d) => ({ label: d.title, hint: [GZ_PAGE.describe(new Date(d.due), true, now, lang).rel, new Date(d.due).toLocaleString(lang, { weekday: 'short', hour: 'numeric', minute: '2-digit' }), nickOf(d.cid) || d.course || ctx.courseList()[d.cid]?.name].filter(Boolean).join(' · '), group: 'Due this week',
      run: d.url ? go(d.url) : () => (d.content ? courseItems(d.cid).p : Promise.resolve([])).then((all) => go(all.find((c) => c.id === d.content)?.links?.[0]?.href.replace(/^https?:\/\/[^/]+/, '') || `/ultra/courses/${d.cid}/outline`)()) }));
  };
  // Glaze's own switches, the same on both sites but for the extras.
  const glazeCmds = () => {
    const s = ctx.settings();
    return [
      ...GZ_LOOKS.map((L) => ({ label: t('Look: {name}', { name: L.name }), hint: GZ_LOOK_ON(s, L) ? t('Current') : 'Glaze', group: 'Glaze', run: store(GZ_LOOK_APPLY(s, L)) })),
      ...GZ_ALL_PRESETS(s.presets).map(([name, colors]) => ({ label: t('Palette: {name}', { name }), hint: s.preset === name && !s.auto.on ? t('Current') : 'Glaze', group: 'Glaze', run: store({ colors, preset: name, auto: { ...s.auto, on: false } }) })),
      ...[['off', 'Off'], ['device', 'Follow the system'], ['schedule', 'On a schedule']].map(([m, n]) => ({ label: t('Auto light and dark: {mode}', { mode: t(n) }), hint: (s.auto.on ? s.auto.mode : 'off') === m ? t('Current') : 'Glaze', group: 'Glaze', run: store({ auto: { ...s.auto, on: m !== 'off', ...(m !== 'off' && { mode: m }) } }) })),
      ...['off', 'subtle', 'expressive'].map((level) => ({ label: t('Motion: {level}', { level: t(`${level[0].toUpperCase()}${level.slice(1)}`) }), hint: s.motion.level === level ? t('Current') : 'Glaze', group: 'Glaze', run: store({ motion: { ...s.motion, level } }) })),
      ...Object.entries(ultra ? { ...EXTRAS, pet: 'Pet habitat' } : moodle ? { overall: CANVAS_EXTRAS.overall } : CANVAS_EXTRAS).map(([k, label]) => ({ label: t(s.enhance[k] ? 'Turn off {name|lower}' : 'Turn on {name|lower}', { name: t(label) }), hint: t('Glaze extra'), group: 'Glaze', run: store({ enhance: { ...s.enhance, [k]: !s.enhance[k] } }) })),
      ...(globalThis.GZ_LOOKX?.cmds() || []),
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
      ...(globalThis.GZ_TODO_UI?.cmds() || []),
      ...(globalThis.GZ_REMIND_UI?.cmds() || []),
      // Your class schedule (features/classes.js): import, review, edit.
      { label: t('Class schedule'), hint: 'Glaze', group: 'Glaze', run: () => need('features/classes.js', () => globalThis.GZ_CLASSES_UI).then(() => GZ_CLASSES_UI.open()).catch(() => {}) },
      { label: t('Export calendar (.ics)'), hint: 'Glaze', group: 'Glaze', run: () => need('features/calexport.js', () => globalThis.GZ_CAL_UI).then(() => GZ_CAL_UI.open(), () => {}) },
      // Opens the GPA's past terms, trends and goal (features/grades.js), on the Dashboard.
      ...(ctx.settings().enhance.gpa ? [{ label: t('GPA: past terms, trends and goal'), hint: 'Glaze', group: 'Glaze', run: () => (location.pathname === '/' && globalThis.GZ_GRADES_UI ? GZ_GRADES_UI.open() : go('/#gz-gpa')()) }] : []),
      // Insights (features/insights.js): this term in numbers, on any Canvas page.
      ...(ctx.settings().enhance.insights ? [{ label: t('Insights: your term in numbers'), hint: 'Glaze', group: 'Glaze', run: () => need('features/insights.js', () => globalThis.GZ_INSIGHTS_UI).then(() => GZ_INSIGHTS_UI.open(), () => {}) }] : []),
      ...apps(cid),
      ...(cid && ctx.settings().enhance.syllabus ? [{ label: t('Import a syllabus'), hint: t('This course'), group: 'Glaze', run: () => need('features/syllabus.js', () => globalThis.GZ_SYL_UI).then(() => GZ_SYL_UI.open(), () => {}) }] : []),
    ];
  };
  // Canvas and Ultra alike: the notes app (features/notes.js: the library, a new note, and this course's notes), Glaze's
  // own commands, and every extra with its switch (features/widgets.js), whether or not the widgets are on.
  const apps = (cid) => [
    ...(ctx.settings().enhance.pet ? [{ label: t('Pet habitat'), hint: 'Glaze', group: 'Glaze', run: () => need('features/widgets.js', () => globalThis.GZ_WIDGETS_UI).then(() => need('features/pet.js', () => globalThis.GZ_PET_UI)).then(() => GZ_PET_UI.open(), () => {}) }] : []),
    ...(ctx.settings().enhance.notes ? [
      { label: t('Notes'), hint: 'Glaze', group: 'Glaze', run: (e) => notes({ event: e }) },
      { label: t('New note'), hint: cid ? t('This course') : 'Glaze', group: 'Glaze', run: (e) => notes({ create: true, course: cid, event: e }) },
      ...(cid ? [{ label: t('Course notes'), hint: t('This course'), group: 'Glaze', run: (e) => notes({ course: cid, event: e }) }] : []),
    ] : []),
    ...glazeCmds(),
    { label: t('What Glaze can do'), hint: 'Glaze', group: 'Glaze', run: () => need('features/widgets.js', () => globalThis.GZ_WIDGETS_UI).then(() => GZ_WIDGETS_UI.hub(), () => {}) },
  ];
  // Notes opens only for the student's own click or Enter on its row: that event goes with the request, through loading
  // features/notes.js, and open() checks it.
  const notes = (o) => o.event?.isTrusted && need('features/notes.js', () => globalThis.GZ_NOTES_UI).then(() => GZ_NOTES_UI.open(o), () => {});
  // Everything the palette can do, built when it opens.
  const commands = async () => {
    // Stickers, pointers and Look rotation (features/lookx.js) bring their own switches (glazeCmds).
    await need('features/lookx.js', () => globalThis.GZ_LOOKX).catch(() => {});
    if (moodle) { const [m, due] = await Promise.all([moodleIn(), dueWeek()]); return [...await m.commands(go), ...dueCmds(due), ...glazeCmds()]; }
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
      ...apps(cid),
    ];
  };
  let cmd = null; // { box, input, list, all, shown, active, back }
  const closeCmd = () => {
    if (!cmd) return;
    cmd.stop?.();
    cmd.box.remove();
    if (cmd.back?.isConnected) cmd.back.focus({ preventScroll: true });
    cmd = null;
  };
  // keep (search's arrivals): the choice stays on the same thing.
  const showCmd = (keep) => {
    const q = cmd.input.value;
    const was = keep === true && cmd.shown[cmd.active];
    // Empty: every page and course, then this course's first items, then Glaze. Typed: the best 40.
    cmd.shown = q.trim()
      ? cmd.all.map((c) => [c, Math.max(GZ_PAGE.fuzzy(q, c.label), GZ_PAGE.fuzzy(q, `${c.hint} ${c.label}`) - 2)]).filter(([, s]) => s >= 0).sort((a, b) => b[1] - a[1]).slice(0, cmd.found ? 12 : 40).map(([c]) => c)
      : [...cmd.all.filter((c) => c.group !== 'In this course' && c.group !== 'Glaze'), ...cmd.all.filter((c) => c.group === 'In this course').slice(0, 8)];
    // Searching your courses too (features/search.js): what has the query as typed, then what it finds, each arrival below
    // the last, so no row moves under the pointer; the looser matches (its letters in order) follow once it's done.
    // Its "Searching…" row is where the next ones go. Until the next keystroke, rows once shown keep their places
    // (cmd.head above the results, cmd.tail below), even when the palette's own list arrives late: anything new from it
    // joins the end, and a command it rebuilt is known by its group, hint and label, so it isn't shown twice.
    let at = -1;
    if (keep !== true) cmd.head = cmd.tail = null;
    if (q.trim() && cmd.found) {
      const id = (c) => `${c.group}\n${c.hint}\n${c.label}`;
      const near = (c) => `${c.hint} ${c.label}`.toLowerCase().includes(q.trim().toLowerCase());
      const close = (cmd.head ||= cmd.shown.filter(near));
      at = close.length + cmd.found.length;
      if (!cmd.seeking) {
        const have = new Set([...close, ...cmd.found, ...(cmd.tail || [])].map(id));
        cmd.tail = [...(cmd.tail || []), ...cmd.shown.filter((c) => !have.has(id(c)))];
      }
      cmd.shown = [...close, ...cmd.found, ...(cmd.seeking ? [] : cmd.tail)];
    }
    cmd.active = Math.max(0, was ? cmd.shown.indexOf(was) : 0);
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
      li.addEventListener('click', (e) => runCmd(i, e));
      return li;
    }));
    if (cmd.seeking || !cmd.shown.length) cmd.list.insertBefore(Object.assign(document.createElement('li'), { className: 'gz-cmd-empty', textContent: t(cmd.seeking ? 'Searching your courses…' : cmd.loading ? 'Loading…' : 'Nothing matches.') }), cmd.list.children[at] || null);
    mark();
  };
  const mark = () => {
    for (const li of cmd.list.children) li.setAttribute('aria-selected', String(li.id === `gz-cmd-${cmd.active}`));
    const on = cmd.list.querySelector('[aria-selected="true"]');
    if (on) { cmd.input.setAttribute('aria-activedescendant', on.id); on.scrollIntoView({ block: 'nearest' }); } else cmd.input.removeAttribute('aria-activedescendant');
  };
  // e: the click or key that chose it, for the commands that need the student's own action (Notes).
  const runCmd = (i, e) => {
    const c = cmd?.shown[i];
    if (!c) return;
    closeCmd();
    c.run(e);
  };
  // Canvas and Ultra share content search; Moodle has no adapter.
  const searchHere = () => !moodle && ctx.settings().enhance.search;
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
      else if (e.key === 'Home' || e.key === 'End') { if (n) { e.preventDefault(); cmd.active = e.key === 'Home' ? 0 : n - 1; mark(); } } else if (e.key === 'Enter') { e.preventDefault(); runCmd(cmd.active, e); } else if (e.key === 'Escape') { e.preventDefault(); closeCmd(); }
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
    // While your courses are being searched, what is on screen stays (showCmd's keep); otherwise the list starts afresh.
    commands().then((all) => { if (cmd !== mine) return; cmd.all = all; cmd.loading = false; showCmd(!!cmd.found); });
    if (searchHere()) need('features/search.js', () => globalThis.GZ_SEARCH).then(() => GZ_SEARCH.attach(mine, showCmd), () => {});
  };

  return { open: () => { if (!cmd) openCmd(); }, close: closeCmd, isOpen: () => !!cmd };
})();

GZ_CMD;
