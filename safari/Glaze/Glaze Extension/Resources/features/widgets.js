// Dashboard notes, widgets and the feature hub (Canvas and Blackboard Ultra), loaded on demand. The site's part
// (syncWidgets) calls sync(on) from its passes while enhance.notes or enhance.widgets is on, in the top frame, and the
// command palette calls hub(). Other files add tiles: MORE, then register().
// Canvas's Dashboard and Ultra's Courses page and Dashboard each have a board of free tiles. Canvas's stays under
// its heading in the page flow; Ultra's Courses tiles start over its right column, its Dashboard on the Institution
// page. Edit layout lets a tile move from anywhere but its controls, or with its arrow keys, and resize by its corner.
// Tiles snap to the grid, edges and each other (Alt: freely), and the one pressed comes to the front. A Dashboard's
// tiles stay one block through zoom, flow when that block doesn't fit, and stack when a tile is wider than the room.
// Any widget can float over every page, dragged by its heading, resized by its corner. The logic is lib/widgets.js.
// What it asks Canvas for: the student's profile (id and time zone, shared with the other extras) and,
// for the agenda, their planner items for a day Better To Do's copy doesn't cover; Ultra: who's signed in (/users/me)
// and, for the agenda, that day's To Do and calendar with their submissions (lib/ultra.js). The music player is the one other
// address, and only after the student clicks Load player. Nothing here polls: each clock is one setTimeout to its next
// change, and only while the page is shown. Loaded on demand: a second injection into the same frame keeps the first.
var GZ_WIDGETS_UI = globalThis.GZ_WIDGETS_UI || (() => {
  const ctx = globalThis.GZ_CTX;
  const t = (k, v) => ctx.t(k, v);
  const NAMES = { notes: 'Notes', agenda: 'Agenda', timer: 'Focus timer', quotes: 'Quote', music: 'Music', breathe: 'Breathe', buddy: 'Study buddy', todo: 'To Do', settings: 'Glaze settings' };
  // Tiles other files add, the same on both sites: { id: { file, name (an English key for t()), size } }. This file
  // loads the file (need) while its tile is on, and the file calls register(id, fill). Off until the student adds it.
  const MORE = { pet: { file: 'features/pet.js', name: 'Pet habitat', size: 'm' } };
  // Mods' tiles join MORE while their mod runs on this page (declare, from features/mods.js and features/modwidgets.js), with no file to load.
  const modTiles = new Set();
  const loadingMore = new Map(); // id -> retry time, Infinity while loading
  const added = new Map(); // id -> fill(body, api), from register()
  const nameOf = (id) => MORE[id]?.name || NAMES[id] || globalThis.GZ_COURSE_CARDS?.title(id) || id;
  const ultra = ctx.site === 'ultra';
  const pages = ultra ? 'pages' : 'canvas'; // the floating surface; Canvas's old tiles keep their normalized spots
  // Written for Glaze (original, not quoted from anyone), each in every language Glaze speaks.
  const QUOTES = [
    ['focus', 'One page at a time is still forward.'], ['focus', 'Start with the smallest next step.'],
    ['focus', 'Twenty-five minutes of attention beats a day of worry.'], ['focus', 'Close the extra tabs. Keep this one.'],
    ['focus', 'Done today beats perfect someday.'],
    ['calm', 'Breathe out. The deadline can wait one breath.'], ['calm', "You don't have to finish everything today."],
    ['calm', 'Rest is part of the work.'], ['calm', 'A tired mind learns less. Take the break.'], ['calm', 'Drink some water. Then begin again.'],
    ['courage', 'Asking a question is how you learn the answer.'], ['courage', 'Every expert was confused by this once too.'],
    ['courage', 'A rough draft is a real draft.'], ['courage', "You've handled hard weeks before."], ['courage', 'Mistakes are how practice shows up.'],
  ];
  const CHEERS = ['such focus', 'very study', 'wow', 'much learning', 'so brave', 'many tasks, much done'];
  // The feature hub: Canvas's extras by where they show, with the names the editor gives them.
  const HUB = [
    ['Dashboard', ['notes', 'widgets', 'todo', 'cardTasks', 'overall', 'gradeHover', 'gpa', 'insights', 'newgrades', 'newcontent', 'coursemenu']],
    ['Course pages', ['progress', 'place', 'download', 'calc', 'syllabus', 'inline', 'scores', 'urgency', 'previews', 'toggles', 'darkDocs', 'reading', 'clamp']],
    ['Reminders and streak', ['remind', 'remindExam', 'remindPlan', 'remindClass', 'streak', 'pet']],
    ['Everywhere', ['palette', 'search', 'keys', 'drafts', 'quizLight']],
  ];
  // Ultra's: what works there.
  const HUB_ULTRA = [
    ['Courses page', ['dashboard', 'notes', 'widgets', 'newgrades', 'newcontent', 'coursemenu']],
    ['Reminders and streak', ['streak', 'pet']],
    ['Course pages', ['progress', 'place', 'download', 'calc', 'inline', 'scores', 'urgency', 'previews', 'toggles', 'reading', 'clamp']],
    ['Everywhere', ['palette', 'keys', 'drafts']],
  ];
  const EXTRA = {
    notes: 'Notes', widgets: 'Widgets', dashboard: 'Glaze Dashboard', todo: 'Better To Do', cardTasks: 'Tasks on course cards', overall: 'Grades on course cards',
    gradeHover: 'Card grades only on hover', gpa: 'Grade point average', insights: 'Insights', newgrades: 'New-grade badges', newcontent: 'New-content badges', coursemenu: 'Course menu',
    progress: 'Course progress', place: 'Remember your place', download: 'Download all', calc: 'What-if calculator', syllabus: 'Syllabus import', inline: 'Due-date status and percentages',
    scores: 'Score bars', urgency: 'Due-date urgency', previews: 'Folder previews', toggles: 'Document buttons', darkDocs: 'Dark documents',
    reading: 'Reading width', clamp: 'Shorter descriptions', palette: 'Command palette', search: 'Search in your courses',
    remind: 'Due-date reminders', remindExam: 'Exam reminders', remindPlan: 'Plan reminders', remindClass: 'Class reminders', streak: 'Streak', pet: 'Pet habitat', keys: 'Keyboard shortcuts', drafts: 'Back up what you type', quizLight: 'Keep quizzes light',
  };

  let W = null; // lib/widgets.js
  let o = null; // the widgets settings (storage.sync widgets)
  let lay = null; // the layout (storage.local widgetLayout)
  let on = false, starting = null, editing = false, petResumeReady = false;
  let me = null; // { uid, tz }
  // bar: a board's buttons (Edit layout, Reminders, Insights, What Glaze can do; on the Courses page, Hide widgets too),
  // in the Courses page's header (#gz-toolbar) or atop the Dashboard's grid. hidden: Hide widgets, on this device.
  let grid = null, floats = null, panel = null, bar = null, hidden = false;
  let hubButton = null; // the bar's What Glaze can do, where the tour hands focus back when what opened it is gone
  const atTop = (globalThis.top ?? globalThis.window) === globalThis.window; // not in Canvas's frame for its pages outside a course (features/coursetabs.js)
  // The boards: which one this page is ('courses', 'dash', 'cdash' or null), the one drawn, and the Courses page's layer the
  // tiles float in (the Dashboard's tiles are in its own room, the grid).
  let board = null, drawn = null, room = null;
  const tiles = new Map(); // id -> { el, body, wake?, stop?, update?, context? }
  // The sidebar (features/sidebar.js) while it is on this page: then each widget has one destination for this account
  // (lib/sidebar.js resolve), the dock, this page's board, floating or nowhere, and the layout keeps every spot it had.
  // placedAt: each widget's, as last resolved; dockIds: the dock's tiles as drawn, in order.
  let side = null, sideWas = null, sideAccount = '', heard = false, placedAt = new Map(), dockIds = [];
  let laid = ''; // the board last laid out, so its first layout places tiles without motion
  const sideNow = () => (ctx.settings().enhance.sidebar && globalThis.GZ_SIDEBAR_UI?.active?.() ? GZ_SIDEBAR_UI : null);
  const dockable = (id) => !W?.course(id);
  // Ultra's Courses page with the sidebar (owner, 2026-10-19): the dock replaces its column board. Its widgets are in the
  // dock, so only its course cards stay on the board, in the page's room; the grid's panel goes above the courses.
  const boardless = () => ultra && board === 'courses' && !!side;
  // Where Move to Dashboard sends a widget: Canvas's Dashboard, or Ultra's (its own switch).
  const homeBoard = () => (ultra ? (ctx.settings().enhance.dashboard ? 'dash' : null) : 'cdash');

  const make = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids.filter((k) => k != null && k !== false)); return e; };
  const button = (text, run, props = {}) => { const b = make('button', { type: 'button', className: 'gz-w-btn', textContent: text, ...props }); b.addEventListener('click', run); return b; };
  const area = (a) => { try { return chrome.storage[a]; } catch { return null; } };
  const get = (a, keys, failed = {}) => new Promise((res) => { try { area(a).get(keys, (r) => res(chrome.runtime.lastError ? failed : r || {})); } catch { res(failed); } });
  // This device's own small items (widgetsHidden, widgetBuddy); the layout and the timer go through the worker.
  const put = (v) => { try { area('local').set(v); } catch { /* reloaded under the tab */ } };
  const send = (m) => new Promise((res) => { try { chrome.runtime.sendMessage(m, (r) => res(chrome.runtime.lastError ? null : r)); } catch { res(null); } });
  // A reload can invalidate a callback before the core sees its first DOM mutation.
  const validContext = () => { try { return !!chrome.runtime.id; } catch { return false; } };
  // In course tabs (features/coursetabs.js) only the document on screen draws, ticks or chimes: the page itself, or the
  // tab's frame over it (whose widgets are the dock's only). A covered or hidden one keeps its state and waits (cover).
  const covered = () => { const c = globalThis.GZ_CTABS; return document.documentElement?.hasAttribute?.('data-gz-review-focus') || document.documentElement?.hasAttribute?.('data-gz-review-immersive') || (c?.visible ? !c.visible() : !!ctx.tabFrame && !atTop); };
  // A floating tile is the page's own, over every tab: it stays on screen while a tab's frame covers the page.
  const onTop = (el) => atTop && !!el?.closest?.('[data-float]');
  const shown = (el) => document.visibilityState === 'visible' && !document.documentElement?.hasAttribute?.('data-gz-review-focus') && !document.documentElement?.hasAttribute?.('data-gz-review-immersive') && (!covered() || onTop(el));
  const lang = () => GZ_I18N.locale(ctx.locale());
  // The Courses page's board is there with the widgets, notes or pet; the Dashboard with its own switch (on by default).
  const boardOf = () => {
    const e = ctx.settings().enhance;
    if (!ultra) return location.pathname === '/' ? 'cdash' : null;
    if (/^\/ultra\/course\/?$/.test(location.pathname)) return e.widgets || e.notes || e.pet ? 'courses' : null;
    return e.dashboard && /^\/ultra\/institution-page\/?$/.test(location.pathname) ? 'dash' : null;
  };
  // Where the grid goes: under Canvas's Dashboard heading; on Ultra's Courses page, first in its right column (or, at a
  // school without Ultra's To Do, above the courses); on its Institution page, before Ultra's own page.
  const home = () => (ultra ? board === 'courses' ? (!boardless() && document.querySelector('div.todo-panel')) || document.querySelector('div.courses-panel')
    : board === 'dash' && (document.querySelector('institution-page-home')?.parentElement || document.querySelector('section.institution-page-container'))
    : location.pathname === '/' && document.getElementById('dashboard_header_container'));
  // The Courses page's layer: first in the page's own container, no height of its own, so the tiles in it are placed
  // from the page's top left, scroll with it and never go under Ultra's nav.
  const roomHost = (h) => h.closest('.route-view-container') || h.parentElement;
  // Ultra's Reminders button, shown while the reminders (features/reminders.js, which may load after the panel) have a hub.
  const remindIn = () => {
    const rm = bar?.querySelector('.gz-dash-remind');
    const off = !globalThis.GZ_REMIND_UI?.cmds().length;
    if (rm && rm.hidden !== off) rm.hidden = off;
  };
  const placed = (h) => (board === 'courses' ? h.firstElementChild === panel && panel.contains(grid) && roomHost(h).firstElementChild === room
    : board === 'dash' ? grid.parentNode === h && (!grid.nextElementSibling || grid.nextElementSibling.tagName === 'INSTITUTION-PAGE-HOME') : h.nextElementSibling === grid);
  // Better To Do's tile: on either site's boards, with its own switch and one copy of the list.
  // The Dashboard is its own switch: its widgets need no other, but the notes and the pet keep theirs.
  const allowed = (id) => {
    if (W?.course(id)) return !!board && W.course(id).origin === location.origin && W.course(id).canvas === !ultra;
    const e = ctx.settings().enhance;
    return id === 'todo' ? (!!board || !!side) && e.todo : id === 'pet' ? e.pet : id === 'notes' ? e.notes : e.widgets || (ultra && (board === 'dash' || (e.dashboard && fl(id))));
  };
  // A change to the layout (lib/widgets.js apply): shown here at once, and sent to the worker, which applies it to what
  // is stored then, so another tab's change made since is kept. While changes are on their way, the stored layout that
  // comes back is the worker's answer to the last one; one that couldn't be saved is put back as stored.
  let flying = 0, layoutRead = 0;
  const declared = () => Object.fromEntries(Object.entries(MORE).map(([k, v]) => [k, { size: v.size }]));
  let rawLay; // the layout as stored, read again when the tiles declared change
  const adopt = (raw) => { rawLay = raw; const next = W.layout(raw, MORE); if (JSON.stringify(next) !== JSON.stringify(lay)) { lay = next; draw(); } };
  const change = (m) => {
    layoutRead++;
    lay = W.apply(lay, m, MORE);
    draw();
    flying++;
    return send({ type: 'glaze:widgetLayout', more: declared(), ...m }).then((r) => {
      const ok = r?.ok === true;
      if (--flying) return ok;
      // Callbacks can arrive backwards; reread storage instead of adopting the last callback's older snapshot.
      const n = ++layoutRead;
      get('local', 'widgetLayout', null).then((x) => { if (x && !flying && n === layoutRead) adopt(x.widgetLayout); });
      return ok;
    });
  };
  // Who's signed in (their id names their notes; their Canvas time zone counts the agenda's days), asked only when a
  // tile needs it: a page with nothing of theirs to show asks Canvas nothing. A failed ask is asked again next time.
  let asking = null, identity = 0;
  // Ultra shares the planning features' profile (the browser's time zone counts).
  const profile = () => (ultra ? ctx.need('lib/ultra.js', () => globalThis.GZ_ULTRA).then(() => GZ_ULTRA.page.profile()) : ctx.profile());
  const who = () => {
    if (asking) return asking;
    const n = identity;
    const pending = profile().then((p) => {
      if (n !== identity) throw new Error('stale profile');
      if (!/^(\d+|_\d+_\d+)$/.test(String(p?.id))) throw new Error('no profile');
      let tz;
      try { tz = p.time_zone && new Intl.DateTimeFormat('en', { timeZone: p.time_zone }).resolvedOptions().timeZone; } catch { /* the browser's */ }
      me = { uid: String(p.id), tz: tz || undefined };
    }).catch((e) => { if (asking === pending) asking = null; throw e; });
    return (asking = pending);
  };

  // ---- the tiles ---------------------------------------------------------------------------------------------
  // Each widget fills its tile's body once; wake() runs when the page is shown again, update() when settings change,
  // stop() when the tile goes.
  const WIDGETS = {
    settings(body) {
      body.append(button(t('Glaze settings'), () => { send('options'); }));
    },
    notes(body) {
      // note: the last saved (or stored) text; draft: the newest typed, stamped when typed, until a save confirms that very
      // draft. Shown is the draft while there is one.
      let key = '', note = { text: '', at: 0 }, draft = null, wait = 0, busy = false, tries = 0, alive = true;
      const view = make('div', { className: 'gz-w-note-view', tabIndex: 0 });
      view.setAttribute('role', 'button');
      view.setAttribute('aria-label', t('Edit notes'));
      const text = make('textarea', { className: 'gz-w-note', placeholder: t('Notes for yourself. Links work.'), maxLength: W.NOTES_MAX, hidden: true });
      text.setAttribute('aria-label', t('Notes'));
      const status = make('p', { className: 'gz-w-status', role: 'status' });
      const content = () => (draft || note).text;
      // The note only ever moves forward: whatever comes in (storage, another tab, a save's answer) replaces it only if newer.
      const newer = (x) => { if (x && x.at > note.at) note = x; };
      const render = () => {
        if (!alive || !shown(body)) return;
        view.replaceChildren(...(content() ? W.links(content()).map((p) => (p.href ? make('a', { href: p.href, textContent: p.text, target: '_blank', rel: 'noopener noreferrer' }) : p.text))
          : [make('span', { className: 'gz-w-faint', textContent: t('Notes for yourself. Links work.') })]));
      };
      const edit = () => { view.hidden = true; text.hidden = false; text.value = content(); text.focus(); text.setSelectionRange(text.value.length, text.value.length); };
      // A draft stays until the worker confirms that draft (a confirmation of an older one confirms only that); a failed
      // save is tried again on blur, on leaving the page and when the tile goes, three times per draft at most. One save
      // at a time: a draft typed while one is on its way goes as soon as it's answered.
      const fail = () => { if (alive && shown(body)) status.textContent = t("Couldn't save your notes. They're still here; try again in a moment."); };
      const save = () => {
        clearTimeout(wait);
        if (!draft || busy || tries >= 3) return;
        if (!key) { fail(); return; }
        const sent = draft;
        busy = true;
        tries++;
        send({ type: 'glaze:notes', key, text: sent.text, at: sent.at }).then((r) => {
          busy = false;
          if (!r?.ok) return fail();
          if (alive && shown(body)) status.textContent = '';
          newer(r.kept ? sent : r.note);
          // Done when this was the newest draft, or a stored note (another tab's) is as new; else the newer draft goes now.
          tries = 0;
          if (draft === sent || draft.at <= note.at) draft = null; else save();
          if (text.hidden) render();
        });
      };
      view.addEventListener('click', (e) => { if (!e.target.closest('a')) edit(); });
      view.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && !e.target.closest('a')) { e.preventDefault(); edit(); } });
      text.addEventListener('input', () => { draft = { text: text.value, at: Date.now() }; tries = 0; clearTimeout(wait); wait = setTimeout(save, 600); });
      text.addEventListener('blur', () => { save(); render(); text.hidden = true; view.hidden = false; });
      const leave = () => save();
      addEventListener('pagehide', leave);
      const onStore = (ch, a) => { if (a === 'local' && key && ch[key]) { newer(W.cleanNote(ch[key].newValue)); if (text.hidden && !draft) render(); } };
      try { chrome.storage.onChanged.addListener(onStore); } catch { /* reloaded */ }
      const load = () => who().then(() => { key = W.notesKey(location.origin, me.uid); return get('local', key); })
        .then((r) => { newer(W.cleanNote(r[key])); if (text.hidden && !draft) render(); }, () => {});
      load();
      render();
      // The notes app (features/notes.js, the same switch): these notes stay as they are, and this opens the rest.
      const app = make('button', { type: 'button', className: 'gz-w-btn gz-w-note-app', textContent: t('Open Notes') });
      app.addEventListener('click', (e) => { if (e.isTrusted) ctx.need('features/notes.js', () => globalThis.GZ_NOTES_UI).then(() => GZ_NOTES_UI.open({ event: e }), () => {}); });
      body.append(view, text, status, app);
      return { wake: () => { if (!key) load(); if (text.hidden) render(); }, suspend: save, stop: () => { save(); alive = false; removeEventListener('pagehide', leave); try { chrome.storage.onChanged.removeListener(onStore); } catch { /* reloaded */ } } };
    },

    agenda(body) {
      let L = null, day = null, data = null, cache = null, alive = true;
      let todo = {}; // Better To Do's settings (storage.sync todo): what counts as done, and whether ticks go to Canvas
      // The class schedule (lib/classes.js, features/classes.js), when the student has one: the day's classes too.
      let C = null, classes = null, ckey = '';
      const withClasses = (raw) => {
        classes = raw?.courses?.length ? raw : null;
        return classes && !C ? ctx.need('lib/classes.js', () => globalThis.GZ_CLASSES).then(() => { C = globalThis.GZ_CLASSES; }, () => {}) : Promise.resolve();
      };
      // The classes that start within day d of the student's Canvas zone, by instant: a schedule kept in another zone
      // (lib/classes.js between) can put a class on the day before or after its own date.
      const classRows = (d) => (C && classes ? C.between(classes, L.midnight(d, me.tz), L.midnight(d + 1, me.tz), me.tz).map((x) => ({
        key: `class:${x.id}.${x.p}`, kind: 'class', title: x.name, course: [x.code && !x.name.includes(x.code) && x.code, x.loc].filter(Boolean).join(' · '),
        url: /^\d+$/.test(x.id) ? `/courses/${x.id}` : /^_\d+_\d+$/.test(x.id) ? `/ultra/courses/${x.id}/outline` : '', at: x.at, end: x.until, done: false,
      })) : []);
      const memo = ultra ? null : new Map(); // Canvas days the shared copy doesn't cover; Ultra shares page.planned's memo.
      const title = make('h4', { className: 'gz-w-day' });
      const list = make('ul', { className: 'gz-w-agenda' });
      const today = () => L.dayOf(Date.now(), me.tz);
      const go = (d) => { day = d; paint(); };
      const back = button('‹', () => go(day - 1), { className: 'gz-w-icon' });
      const next = button('›', () => go(day + 1), { className: 'gz-w-icon' });
      const home = button(t('Today'), () => go(today()), { className: 'gz-w-small' });
      back.setAttribute('aria-label', t('Previous day'));
      next.setAttribute('aria-label', t('Next day'));
      const dayName = (d) => {
        const off = d - today();
        if (Math.abs(off) <= 1) return t(off === 0 ? 'Today' : off === 1 ? 'Tomorrow' : 'Yesterday');
        return new Date(d * L.DAY).toLocaleDateString(lang(), { timeZone: 'UTC', weekday: 'long', month: 'short', day: 'numeric' });
      };
      // Better To Do's copy when it's this account's, covers the day and is under ten minutes old; else this day alone.
      const items = async (d) => {
        const lo = L.midnight(d, me.tz), hi = L.midnight(d + 1, me.tz);
        if (ultra) return (await GZ_ULTRA.page.planned(lo, hi, cache)).items;
        if (cache?.key === L.storeKey(location.origin, me.uid) && Date.now() - cache.at < 6e5 && Date.parse(cache.start) <= lo && Date.parse(cache.end) >= hi) return cache.items || [];
        const m = memo.get(d);
        if (m && Date.now() - m.at < 12e4) return m.items;
        const got = await ctx.capi(`/planner/items?start_date=${new Date(lo).toISOString()}&end_date=${new Date(hi).toISOString()}&per_page=100`).then((raw) => (Array.isArray(raw) ? raw : []).map(L.slim));
        memo.set(d, { at: Date.now(), items: got });
        return got;
      };
      let asked = 0;
      const paint = async () => {
        if (!L || !alive || !shown(body)) return;
        const n = ++asked;
        title.textContent = dayName(day);
        home.hidden = day === today();
        let rows;
        try { rows = W.agenda(L, { items: await items(day), data, day, tz: me.tz, extra: classRows(day), o: todo, sync: !ultra && !!todo.sync }); } catch { rows = null; }
        if (n !== asked || !alive || !shown(body)) return;
        list.replaceChildren(...(rows === null ? [make('li', { className: 'gz-w-faint', textContent: t("Couldn't load this day. Try again in a moment.") })]
          : rows.length ? rows.map((r) => {
            const clock = new Intl.DateTimeFormat(lang(), { timeZone: me.tz, hour: 'numeric', minute: '2-digit' });
            const when = r.kind === 'session' ? t('Focus · {min} min', { min: r.min }) : r.kind === 'plan' ? t('Planned') : r.at === null ? t('All day')
              : r.kind === 'class' ? clock.formatRange(r.at, r.end) : clock.format(r.at);
            const at = r.kind === 'session' ? `${new Date(r.at).toLocaleTimeString(lang(), { timeZone: me.tz, hour: 'numeric', minute: '2-digit' })} · ${when}` : when;
            const li = make('li', {}, make('span', { className: 'gz-w-when', textContent: at }),
              make(r.url ? 'a' : 'span', { className: 'gz-w-what', textContent: r.title, ...(r.url && { href: r.url }) }),
              r.course && make('span', { className: 'gz-w-faint', textContent: r.course }));
            if (r.done) li.dataset.done = '';
            return li;
          }) : [make('li', { className: 'gz-w-faint', textContent: t('Nothing planned or due.') })]));
      };
      const onStore = (ch, a) => {
        if (a === 'sync' && ch.todo && L) { todo = GZ_SANITIZE({ todo: ch.todo.newValue }).todo; paint(); return; }
        if (a !== 'local' || !L) return;
        const k = L.storeKey(location.origin, me.uid);
        if (ch.todoCache) cache = ch.todoCache.newValue;
        if (ch[k]) data = L.clean(ch[k].newValue);
        if (ch[ckey]) withClasses(ch[ckey].newValue).then(paint);
        else if (ch.todoCache || ch[k]) paint();
      };
      const schedule = button(t('Class schedule'), () => ctx.need('features/classes.js', () => globalThis.GZ_CLASSES_UI).then(() => GZ_CLASSES_UI.open()).catch(() => {}), { className: 'gz-w-small gz-w-classes' });
      body.append(make('div', { className: 'gz-w-row' }, back, title, next, home), list, schedule);
      Promise.all([ctx.need('lib/todo.js', () => globalThis.GZ_TODO), who()]).then(async () => {
        if (!alive) return;
        L = globalThis.GZ_TODO;
        const k = L.storeKey(location.origin, me.uid);
        ckey = `classes:${location.origin}/${me.uid}`;
        const [r, prefs] = await Promise.all([get('local', [k, 'todoCache', ckey]), get('sync', ['todo'])]);
        todo = GZ_SANITIZE({ todo: prefs.todo }).todo;
        data = L.clean(r[k]);
        await withClasses(r[ckey]);
        if (!alive) return;
        cache = r.todoCache;
        day = today();
        try { chrome.storage.onChanged.addListener(onStore); } catch { /* reloaded */ }
        paint();
      }, () => list.replaceChildren(make('li', { className: 'gz-w-faint', textContent: t("Couldn't load this day. Try again in a moment.") })));
      return { wake: () => { if (L && day !== null) paint(); }, stop: () => { alive = false; try { chrome.storage.onChanged.removeListener(onStore); } catch { /* reloaded */ } } };
    },

    timer(body) {
      let s = W.IDLE, tick = 0, alarm = 0, audio = null, alive = true, seenEnd = 0;
      // Text nodes changed in place, and labels only when they change: the page's own observer sees no new nodes each second.
      const phase = document.createTextNode(''), time = document.createTextNode('');
      const clock = make('p', { className: 'gz-w-clock' }, time);
      clock.setAttribute('role', 'timer');
      const say = make('p', { className: 'gz-w-status', role: 'status' });
      // Every change goes through the worker's one queue ('glaze:widgetTimer'), which the nav's timer (B7c) uses too:
      // it applies the change to what is stored then. Its answer is shown only while it is the newest thing known: not
      // after a later ask, nor after the stored timer changed since it was asked (another tab or the nav reset it), when
      // what is stored is what shows. Without one, nothing changed and the stored state stays (an advance the page saw
      // for itself says nothing: the next tab or look does it again).
      let asked = 0, heard = 0;
      const ask = (op) => {
        const n = ++asked, at = heard;
        const reply = !atTop && ctx.tabFrame ? globalThis.GZ_CTABS?.timer?.(op) || Promise.resolve(null) : send({ type: 'glaze:widgetTimer', op });
        return reply.then((r) => {
          if (!alive) return r;
          if (r?.ok && r.timer) { if (n === asked && at === heard) { s = W.cleanTimer(r.timer); run(); } if (shown(body)) say.textContent = ''; return r; }
          if (op !== 'advance' && shown(body)) say.textContent = t("Couldn't change the timer. Nothing changed; try again in a moment.");
          return r;
        });
      };
      const go = button(t('Start'), () => {
        // A sound needs a click to be allowed: it plays in the tab where Start was pressed.
        if (!s.end && o.sound) try { audio ||= new AudioContext(); audio.resume(); } catch { audio = null; }
        ask('toggle');
      }, { className: 'gz-w-btn gz-w-main' });
      const reset = button(t('Reset'), () => ask('reset'));
      const chime = () => {
        if (!o.sound || !audio) return;
        const at = audio.currentTime;
        for (const [f, d] of [[660, 0], [880, 0.28]]) {
          const osc = audio.createOscillator(), g = audio.createGain();
          osc.frequency.value = f;
          g.gain.setValueAtTime(0.0001, at + d);
          g.gain.exponentialRampToValueAtTime(0.18, at + d + 0.02);
          g.gain.exponentialRampToValueAtTime(0.0001, at + d + 0.7);
          osc.connect(g).connect(audio.destination);
          osc.start(at + d);
          osc.stop(at + d + 0.75);
        }
      };
      // The phase that has run out moves on (the worker moves the stored one once, for whichever tab asks first) and rings,
      // if the sound is on, in the tab whose answer says it was the one that moved it: only the tab where Start was pressed
      // has the sound allowed. A phase that ended while away moves on quietly, as does one a clock set back made over: its
      // deadline is not behind it. away: this tab was hidden and waiting for this end (the alarm), which counts as having
      // watched it, and rings even though the tile is not on screen.
      const over = (now, away) => {
        const was = s, ended = away || seenEnd === was.end;
        seenEnd = was.end > now ? was.end : 0;
        s = W.advance(s, now, o);
        if (s === was) return;
        ask('advance').then((r) => {
          const late = Date.now() - was.end;
          if (alive && (away || shown(body)) && r?.advanced === was.end && ended && late >= 0 && late < 2000) { chime(); ctx.moment?.('timer.done', null, `timer ${was.end}`); say.textContent = t(s.phase === 'rest' ? 'Time for a break.' : 'Break over. Ready when you are.'); }
        });
      };
      // A hidden tab can't tick (a chain of timeouts is what browsers slow down in the background), but a phase running in
      // the tab that has the sound ready should still ring where it ends: one timeout to the end, set again whenever the
      // state is. Shown, the tick below does this; a tab that took the phase from storage never had the sound allowed.
      const arm = () => {
        clearTimeout(alarm);
        alarm = 0;
        if (!alive || !s.end || !o.sound || !audio) return;
        alarm = setTimeout(() => { alarm = 0; if (alive && !shown(body)) { over(Date.now(), true); arm(); } }, Math.max(0, Math.min(s.end - Date.now(), W.len(s.phase, o))) + 5);
      };
      // One timeout to the next second shown, while it runs and the page is shown.
      const run = () => {
        clearTimeout(tick);
        tick = 0;
        if (!alive) return;
        const now = Date.now(), visible = shown(body);
        if (visible) over(now);
        arm();
        if (!visible) return;
        phase.data = t(s.phase === 'rest' ? 'Break' : 'Focus');
        time.data = W.clock(W.left(s, now, o));
        const label = t(s.end ? 'Pause' : W.left(s, now, o) < W.len(s.phase, o) ? 'Resume' : 'Start');
        if (go.textContent !== label) go.textContent = label;
        body.dataset.running = s.end ? 'yes' : 'no';
        if (s.end && shown(body)) tick = setTimeout(run, ((s.end - now) % 1000 || 1000) + 5);
      };
      const onStore = (ch, a) => { if (a === 'local' && ch.widgetTimer) { heard++; s = W.cleanTimer(ch.widgetTimer.newValue); run(); } };
      try { chrome.storage.onChanged.addListener(onStore); } catch { /* reloaded */ }
      const at = heard;
      get('local', 'widgetTimer').then((r) => { if (heard === at && !asked) { s = W.cleanTimer(r.widgetTimer); run(); } });
      body.append(make('p', { className: 'gz-w-faint' }, phase), clock, make('div', { className: 'gz-w-row' }, go, reset), say);
      run();
      // Its deadline is stored, so another document showing it carries on from there; this one stops ticking meanwhile (but
      // not its alarm, for the sound it holds).
      return { wake: run, update: run, suspend: () => { clearTimeout(tick); tick = 0; }, stop: () => { alive = false; clearTimeout(tick); clearTimeout(alarm); audio?.close?.(); try { chrome.storage.onChanged.removeListener(onStore); } catch { /* reloaded */ } } };
    },

    quotes(body) {
      let step = 0, paused = false, wait = 0;
      const q = make('blockquote', { className: 'gz-w-quote' });
      const list = () => QUOTES.filter(([k]) => o.quotes === 'all' || k === o.quotes);
      const pause = button(t('Pause'), () => { paused = !paused; show(); });
      const show = () => {
        clearTimeout(wait);
        if (!shown(body)) return;
        const all = list();
        const now = Date.now();
        q.textContent = t(all[W.quoteAt(all.length, now, o.quoteMode, o.quoteEvery, step)][1]);
        pause.hidden = o.quoteMode !== 'cycle';
        pause.textContent = t(paused ? 'Play' : 'Pause');
        pause.setAttribute('aria-pressed', String(paused));
        if (o.quoteMode === 'cycle' && !paused && shown(body)) wait = setTimeout(show, o.quoteEvery * 1000 - (now % (o.quoteEvery * 1000)) + 5);
      };
      const prev = button('‹', () => { step--; show(); }, { className: 'gz-w-icon' });
      const next = button('›', () => { step++; show(); }, { className: 'gz-w-icon' });
      prev.setAttribute('aria-label', t('Previous quote'));
      next.setAttribute('aria-label', t('Next quote'));
      body.append(q, make('div', { className: 'gz-w-row' }, prev, pause, next));
      show();
      return { wake: show, update: show, suspend: () => clearTimeout(wait), stop: () => clearTimeout(wait) };
    },

    music(body) {
      const form = make('form', { className: 'gz-w-music' });
      const input = make('input', { type: 'url', placeholder: 'https://open.spotify.com/…', value: lay.music, spellcheck: false, autocomplete: 'off' });
      input.setAttribute('aria-label', t('A Spotify, YouTube, Apple Music or YouTube Music link'));
      const err = make('p', { className: 'gz-w-status', role: 'status' });
      const stage = make('div', { className: 'gz-w-stage' });
      // Nothing is asked of the player's site until Load player: the link stays on this device and goes nowhere else.
      const ready = () => {
        const m = W.music(lay.music);
        stage.replaceChildren(...(m ? [
          make('p', { className: 'gz-w-faint', textContent: t('Plays from {provider}, which then sees this visit.', { provider: m.provider }) }),
          button(t('Load player'), () => {
            const f = make('iframe', { src: m.src, title: t('{provider} player', { provider: m.provider }), loading: 'lazy', allow: 'autoplay; encrypted-media; fullscreen; picture-in-picture; clipboard-write' });
            // YouTube refuses to play without the page's origin; the others get nothing.
            f.referrerPolicy = m.src.startsWith('https://www.youtube-nocookie.com/') ? 'strict-origin' : 'no-referrer';
            f.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-popups allow-presentation');
            stage.replaceChildren(f);
          }, { className: 'gz-w-btn gz-w-main' }),
        ] : [make('p', { className: 'gz-w-faint', textContent: t('Paste a Spotify, YouTube, Apple Music or YouTube Music link to listen while you work.') })]));
      };
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const v = input.value.trim();
        if (v && !W.music(v)) { err.textContent = t("That link isn't a song, album, playlist or video Glaze can play."); input.setAttribute('aria-invalid', 'true'); return; }
        err.textContent = '';
        input.removeAttribute('aria-invalid');
        change({ ops: [], music: v });
        ready();
      });
      form.append(input, make('button', { type: 'submit', className: 'gz-w-btn', textContent: t('Save') }));
      body.append(form, err, stage);
      ready();
      return {};
    },

    breathe(body) {
      let t0 = 0, wait = 0;
      const ring = make('div', { className: 'gz-w-breath' });
      ring.setAttribute('aria-hidden', 'true');
      const word = make('p', { className: 'gz-w-breath-word' });
      word.setAttribute('aria-live', 'polite');
      const left = document.createTextNode('');
      const count = make('p', { className: 'gz-w-faint' }, left);
      const go = button(t('Start'), () => { if (t0) stop(); else { t0 = Date.now(); go.textContent = t('Stop'); step(); } }, { className: 'gz-w-btn gz-w-main' });
      const WORDS = { in: 'Breathe in', hold: 'Hold', out: 'Breathe out' };
      const stop = (done) => {
        clearTimeout(wait);
        t0 = 0;
        ring.dataset.phase = '';
        word.textContent = done ? t('Well done.') : '';
        left.data = '';
        go.textContent = t('Start');
      };
      // One timeout to each next whole second: every phase is whole seconds long.
      const step = () => {
        const b = W.breath(Date.now() - t0, o);
        if (b.done) return stop(true);
        if (ring.dataset.phase !== b.phase) {
          ring.style.setProperty('--gz-breath', `${b.count}s`);
          ring.dataset.phase = b.phase;
          word.textContent = t(WORDS[b.phase]);
        }
        left.data = t('{left} · breath {cycle} of {cycles}', { left: b.count, cycle: b.cycle, cycles: o.cycles });
        wait = setTimeout(step, 1000 - ((Date.now() - t0) % 1000) + 5);
      };
      body.append(ring, word, count, go);
      // A breathing exercise doesn't carry on unseen: a hidden page ends it.
      return { wake: () => { if (!shown(body) && t0) stop(); }, suspend: () => { if (t0) stop(); }, stop: () => clearTimeout(wait) };
    },

    // The place features/todo.js puts its list. The tile holds the existing list and all its account-scoped state.
    // Without the sidebar, a spot Better To Do finds (features/todo.js anchor); with it, the list mounted here, following
    // the page's course or showing all of them (the record's todoScope).
    todo(body) {
      if (!side) { body.append(make('div', { className: 'gz-w-todo-spot' })); return {}; }
      let alive = true;
      const scope = () => (side ? { courseId: side.context().courseId, scope: side.scope?.() || side.rec()?.todoScope || 'follow', setScope: (v) => side?.op([{ op: 'todoScope', v }]), rendered: () => todoIn(), failed: () => todoIn() } : null);
      const mount = () => { if (alive && side && globalThis.GZ_TODO_UI?.mount) { GZ_TODO_UI.mount(body, scope()); todoIn(); } };
      ctx.need('features/todo.js', () => globalThis.GZ_TODO_UI).then(mount, () => {});
      return { context: mount, suspend: () => globalThis.GZ_TODO_UI?.suspend?.(), resume: () => globalThis.GZ_TODO_UI?.resume?.(), stop: () => { alive = false; globalThis.GZ_TODO_UI?.unmount?.(body); } };
    },

    // Every pet surface uses this character, account record and the same timer/task reactions.
    buddy(body, options = {}) {
      let st = { happyAt: 0, patAt: 0, running: false }, wait = 0, todoKey = '', petKey = '', alive = true, sleeping = false, player = null, sprite = '', pose = null;
      let attentionWait = 0, attentionAt = 0, attentionBlocked = 0, gaze = -1, gazing = false;
      let patPending = false, cheer = null, cheerWait = 0, lastPat = 0;
      const saved = {}, versions = new Map();
      let lifecycle = 0;
      // Gone from the page once it has been on it. One made but not yet attached waits: the Courses page with its widgets
      // hidden builds the tiles and attaches none until Show widgets, and a buddy that stopped itself in its first paint was
      // attached then as a blank tile that never woke (the board's draw() stops the tiles it removes).
      let attached = false;
      const gone = () => { if (pet.isConnected !== false) { attached = true; return false; } return attached; };
      const img = make('img', { alt: '', draggable: false, decoding: 'async' });
      const read = (keys) => {
        const before = keys.map((k) => versions.get(k)), life = lifecycle;
        return get('local', keys).then((r) => {
          if (!alive || life !== lifecycle || !validContext()) return;
          keys.forEach((k, i) => { if (before[i] === versions.get(k)) saved[k] = r[k]; });
          st.running = !!W.cleanTimer(saved.widgetTimer).end;
          st.happyAt = Math.max(st.happyAt, Number.isFinite(saved.widgetBuddy?.happyAt) ? saved.widgetBuddy.happyAt : 0);
          st.patAt = Math.max(st.patAt, Number.isFinite(saved.widgetBuddy?.patAt) ? saved.widgetBuddy.patAt : 0);
          paint();
        });
      };
      const paint = () => {
        clearTimeout(wait);
        if (!alive) return;
        if (!validContext()) { stop(); return; }
        if (gone()) { stop(); return; }
        const P = globalThis.GZ_PET_BRAIN && globalThis.GZ_PET, S = globalThis.GZ_PET_SPRITES;
        const data = P?.view(saved[petKey]);
        options.onData?.(data);
        const m = W.mood(st, Date.now());
        const choice = typeof saved.petCharacter === 'string' ? saved.petCharacter : data?.sprite || (['cat', 'bunny'].includes(ctx.settings().card?.pet) ? ctx.settings().card.pet : '');
        const selected = S?.picture(choice, saved.petSprites) || (!choice && (!data?.wear || data.wear === 'plain') ? S?.picture('study-buddy') : null);
        const label = selected ? t('Play with {name}', { name: selected.name }) : t('Pet your study buddy');
        pet.setAttribute('aria-label', label);
        const identity = selected?.data || selected?.path || '';
        const changed = identity !== sprite || !!(selected && !player && globalThis.GZ_PET_PLAYER);
        if (changed) {
          sprite = identity; player?.stop(); player = null;
          pet.replaceChildren(img);
          if (selected && globalThis.GZ_PET_PLAYER) {
            try {
              const canvas = make('canvas'); pet.replaceChildren(canvas);
              player = GZ_PET_PLAYER.mount(canvas, selected);
            } catch { sprite = ''; pet.replaceChildren(img); }
          }
        }
        const wear = data?.wear || 'plain';
        const art = m.mood === 'happy' ? 'study-buddy-happy' : m.mood === 'sleepy' && wear === 'plain' ? 'study-buddy-sleepy' : P?.WEAR[wear].art || 'study-buddy';
        const src = chrome.runtime.getURL(`assets/art/stickers/critters/${art}.webp`);
        if (img.src !== src) img.src = src;
        player?.rest(options.resting || (m.mood === 'happy' ? 'jumping' : st.running ? 'running' : m.mood === 'sleepy' ? 'sleeping' : 'idle'));
        if (changed && pose) player?.play(...pose);
        if (body.dataset.mood !== (m.mood || 'awake')) body.dataset.mood = m.mood || 'awake';
        if (sleeping || document.visibilityState === 'hidden') player?.sleep(); else player?.wake();
        if (m.until && !sleeping && document.visibilityState !== 'hidden') wait = setTimeout(paint, m.until - Date.now() + 50);
      };
      const win = () => { st.happyAt = Date.now(); attentionBlocked = Date.now() + 1600; gazing = false; clearTimeout(attentionWait); put({ widgetBuddy: { happyAt: st.happyAt, patAt: st.patAt } }); paint(); };
      const pat = async (state = 'waving') => {
        if (!alive || !validContext() || patPending || Date.now() - lastPat < 2500) return;
        const data = globalThis.GZ_PET_BRAIN && globalThis.GZ_PET?.view(saved[petKey]);
        if (ctx.settings().enhance.pet) {
          if (!petKey || !data || !globalThis.GZ_TODO) return;
          const allowance = GZ_PET.care(data.care, me?.tz);
          if (!allowance.remaining || Date.now() < allowance.nextAt) return;
          patPending = true;
          let reply;
          try { reply = await send({ type: 'glaze:pet', key: petKey, tz: me?.tz, op: 'interact', event: state === 'jumping' ? 'play' : 'pet', action: 'greet',
            context: GZ_PET_BRAIN.vector({ focus: W.cleanTimer(saved.widgetTimer).phase === 'work' && st.running, pointerNear: true, needs: data.needs, wandering: false, water: data.habitat === 'aquarium' }) }); }
          finally { patPending = false; }
          if (!alive || !validContext() || !reply?.ok || !reply.interaction?.accepted) return;
          saved[petKey] = reply.data;
        }
        lastPat = Date.now();
        st.patAt = Date.now();
        attentionBlocked = Date.now() + 1600; gazing = false;
        put({ widgetBuddy: { happyAt: st.happyAt, patAt: st.patAt } });
        paint();
        player?.play(state);
        clearTimeout(cheerWait); cheer?.remove();
        const w = make('span', { className: 'gz-w-cheer', textContent: t(CHEERS[Math.floor(Math.random() * CHEERS.length)]) });
        w.setAttribute('aria-hidden', 'true');
        pet.after(w);
        cheer = w; cheerWait = setTimeout(() => { w.remove(); if (cheer === w) cheer = null; }, 1600);
      };
      const pet = options.interactive === false ? make('span', { className: 'gz-w-pet' }) : button('', () => pat(), { className: 'gz-w-pet' });
      pet.setAttribute('aria-label', t('Pet your study buddy'));
      pet.append(img);
      if (options.interactive !== false) {
        pet.addEventListener('keydown', (e) => { if (e.isTrusted && ['Enter', ' '].includes(e.key)) { e.preventDefault(); e.stopPropagation(); if (!e.repeat) pat('jumping'); } });
      }
      const releaseGaze = () => { clearTimeout(attentionWait); if (gazing) { gazing = false; player?.set('idle'); } };
      const watch = (e) => {
        const now = Date.now();
        if (!e.isTrusted || !alive || !player || sleeping || document.hidden || now < attentionBlocked || now - attentionAt < 80) return;
        if (!validContext() || gone()) { stop(); return; }
        attentionAt = now;
        const r = pet.getBoundingClientRect(), dx = e.clientX - r.left - r.width / 2, dy = e.clientY - r.top - r.height / 2;
        if (!r.width || r.bottom < 0 || r.top > innerHeight || Math.hypot(dx, dy) > 420) { releaseGaze(); return; }
        const direction = GZ_PET_SPRITES.direction(dx, dy);
        if (!gazing || direction !== gaze) { gaze = direction; gazing = true; player.set('look', direction); }
        clearTimeout(attentionWait); attentionWait = setTimeout(releaseGaze, 1800);
      };
      const onStore = (ch, a) => {
        if (!alive || a !== 'local') return;
        if (!validContext()) { stop(); return; }
        for (const k of ['widgetTimer', 'widgetBuddy', 'petCharacter', 'petSprites', petKey]) if (ch[k]) { saved[k] = ch[k].newValue; versions.set(k, (versions.get(k) || 0) + 1); }
        const tm = ch.widgetTimer;
        if (tm) {
          const was = W.cleanTimer(tm.oldValue), now = W.cleanTimer(tm.newValue);
          st.running = !!now.end;
          if (was.phase === 'work' && was.end && now.phase === 'rest') win(); else paint();
        }
        if (todoKey && ch[todoKey] && W.ticks(ch[todoKey].newValue) > W.ticks(ch[todoKey].oldValue)) win();
        if (ch.widgetBuddy) {
          st.happyAt = Math.max(st.happyAt, +ch.widgetBuddy.newValue?.happyAt || 0);
          st.patAt = Math.max(st.patAt, +ch.widgetBuddy.newValue?.patAt || 0);
        }
        if (ch.widgetBuddy || ch.petCharacter || ch.petSprites || ch[petKey]) paint();
        if (ch[petKey] && globalThis.GZ_PET_BRAIN && globalThis.GZ_PET) {
          const before = GZ_PET.view(ch[petKey].oldValue), after = GZ_PET.view(ch[petKey].newValue);
          if (before && after && after.xp > before.xp) { attentionBlocked = Date.now() + 900; gazing = false; player?.play(after.level > before.level ? 'level-up' : 'xp'); }
        }
      };
      body.append(pet);
      const show = () => paint();
      // What the buddy listens to, and what it reads when it starts: again after a back/forward-cache restore.
      const listen = () => {
        if (options.attention !== false) document.addEventListener('pointermove', watch, { passive: true });
        try { chrome.storage.onChanged.addListener(onStore); } catch { /* reloaded */ }
        document.addEventListener('visibilitychange', show);
        read(['widgetTimer', 'widgetBuddy', 'petCharacter', 'petSprites']);
        who().then(() => {
          if (!alive || !validContext()) return;
          todoKey = `todo:${location.origin}/${me.uid}`; petKey = `pet:${location.origin}/${me.uid}`;
          read([petKey]);
        }, () => {});
      };
      const release = () => {
        lifecycle++;
        alive = false; clearTimeout(wait); clearTimeout(attentionWait); clearTimeout(cheerWait); cheer?.remove(); player?.stop(); player = null; sprite = '';
        try { chrome.storage.onChanged.removeListener(onStore); } catch { /* reloaded */ }
        document.removeEventListener?.('visibilitychange', show); document.removeEventListener?.('pointermove', watch);
      };
      // A page put in the back/forward cache is torn down by pagehide but comes back as it was, running no script again: that
      // buddy is only put away, and pageshow wakes it. Anywhere else pagehide is the end of the page.
      let cached = false;
      const stop = () => {
        if (!alive && !cached) return;
        if (alive) release();
        cached = false; removeEventListener('pagehide', leave); removeEventListener('pageshow', back);
      };
      const leave = (e) => { if (!alive) return; if (e.persisted) { cached = true; release(); } else stop(); };
      const back = (e) => {
        if (!e.persisted || !cached) return;
        if (!validContext() || ctx.settings().enabled === false) { stop(); return; }
        cached = false;
        alive = true; listen(); paint();
      };
      addEventListener('pagehide', leave); addEventListener('pageshow', back);
      listen();
      Promise.all(['lib/petbrain.js', 'lib/pet.js', 'lib/todo.js', 'lib/petsprites.js', 'lib/petplayer.js'].map((file) => ctx.need(file, () => ({ 'lib/petbrain.js': globalThis.GZ_PET_BRAIN, 'lib/pet.js': globalThis.GZ_PET, 'lib/todo.js': globalThis.GZ_TODO, 'lib/petsprites.js': globalThis.GZ_PET_SPRITES, 'lib/petplayer.js': globalThis.GZ_PET_PLAYER })[file]))).then(paint, () => {});
      Promise.resolve().then(paint);
      return { wake: () => { sleeping = false; paint(); }, sleep: () => { sleeping = true; clearTimeout(wait); releaseGaze(); player?.sleep(); }, update: paint, play: (state, direction) => { pose = [state, direction]; attentionBlocked = Date.now() + 900; gazing = false; player?.play(state, direction); }, stop };
    },
  };

  // ---- the grid, the boards and the floating layer -------------------------------------------------------------
  // Seats a tile right after `prev` in `parent` (first when there is none). Taking an element out of the document and
  // putting it back unloads an iframe in it, so the music player restarted, paused at its start, whenever the board put
  // its tile elsewhere: another tile moved before it, the Courses board switching between stacked and free, a drag in the
  // dock. Element.moveBefore moves without that, where the browser has it. Without it a tile holding a player stays where it
  // is and the tiles in its way move past it; only a move between parents can't be helped.
  const seatAfter = (parent, el, prev = null) => {
    const at = prev ? prev.nextElementSibling : parent.firstElementChild;
    if (at === el) return;
    if (parent.moveBefore && el.isConnected && parent.isConnected) { try { parent.moveBefore(el, at); return; } catch { /* not a move it can make: the old way */ } }
    if (el.parentNode === parent && el.querySelector('iframe')) {
      const behind = [], ahead = [];
      let x = el.previousElementSibling;
      while (x && x !== prev) { behind.push(x); x = x.previousElementSibling; }
      if (x === prev) { for (const n of behind) el.after(n); return; } // prev is before it (or none): what is between goes after it
      for (x = el.nextElementSibling; x; x = x.nextElementSibling) { ahead.push(x); if (x === prev) break; }
      if (x && x === prev) { for (const n of ahead) el.before(n); return; } // prev is after it: what is between, and prev, go before it
    }
    if (prev) prev.after(el); else parent.prepend(el);
  };
  const tileEl = (id) => {
    const name = t(nameOf(id));
    const el = make('section', { className: 'gz-w' });
    el.dataset.id = id;
    el.dataset.tile = id;
    el.setAttribute('aria-label', name);
    const head = make('header', { className: 'gz-w-head' }, make('h3', { textContent: name }));
    const tools = make('div', { className: 'gz-w-tools' });
    const body = make('div', { className: 'gz-w-body' });
    const corner = button('', () => {}, { className: 'gz-w-resize' });
    corner.setAttribute('aria-label', t('Resize {name}: arrow keys', { name }));
    corner.title = t('Drag to resize, or use the arrow keys. Double-click for its own size.');
    el.append(head, tools, body, corner);
    drag(el, head, id);
    resizer(el, body, corner, id);
    return { el, head, tools, body };
  };
  // Floats use their site's surface, once, instead of this page's board (which keeps its own spot).
  const pageTiles = () => (ultra ? lay.boards.pages : lay.tiles.filter((x) => x.float));
  const fl = (id) => pageTiles().some((x) => x.id === id && x.on);
  // A docked tile (or one off this page's board) has its size from the site's tiles.
  const cur = (id) => (fl(id) ? pageTiles() : lay.boards[board] || []).find((x) => x.id === id) || lay.tiles.find((x) => x.id === id);
  const widthOf = (x) => x.w || W.WIDTH[x.size];
  // A tile starts floating from the room's bottom right corner, clear of the others; its resized size goes with it.
  const floatOut = (id) => {
    const r = floatRoom(), x = cur(id);
    const others = [...tiles].filter(([k]) => k !== id && fl(k)).map(([, v]) => { const b = v.el.getBoundingClientRect(); return { left: b.left - r.left, top: b.top - r.top, w: b.width, h: b.height }; });
    const w = widthOf(x), h = tiles.get(id)?.el.offsetHeight || 200;
    const c = W.corner(others, w, h, r.W, r.H);
    const p = W.place(c.left, c.top, w, h, r.W, r.H, true);
    const saved = change({ ops: [{ s: pages, id, set: { on: true, ...(!ultra && { float: true }), size: x.size, fold: x.fold, x: p.x, y: p.y, w: x.w ?? null, h: x.h ?? null }, front: true }], widths: { [pages]: Math.round(r.W) } });
    tiles.get(id)?.el.focus();
    say(t(ultra ? '{name} floats on every Blackboard page.' : '{name} floats on every Canvas page.', { name: t(nameOf(id)) }));
    return saved;
  };
  const backBoard = () => {
    const e = ctx.settings().enhance;
    return board || (!ultra ? 'cdash' : e.widgets || e.notes || e.pet ? 'courses' : 'dash');
  };
  const floatBack = (id) => {
    const b = backBoard();
    change({ ops: [{ s: pages, id, set: ultra ? { on: false } : { float: false } }, { s: b, id, set: { on: true } }] });
    say(t(board ? '{name} is back on this page.' : b !== 'courses' ? '{name} is back on the Dashboard.' : '{name} is back on the Courses page.', { name: t(nameOf(id)) }));
  };
  // With the sidebar, where a widget can go from where it is (the destination menu): the dock (not a course card), the
  // Dashboard's board, floating (not To Do), or nowhere. Moving keeps the other places' spots (lib/sidebar.js).
  const dests = (id, where, tile) => [
    where !== 'dock' && dockable(id) && { label: t('Move to sidebar'), run: () => toDock(id) },
    where !== 'board' && atTop && dockable(id) && homeBoard() && { label: t('Move to Dashboard'), run: () => toBoard(id) },
    where !== 'float' && atTop && dockable(id) && id !== 'todo' && { label: t('Float'), run: () => toFloat(id) },
    where === 'dock' && tile.h && { label: t('Auto height'), run: () => { side.op([{ op: 'height', id, h: null }]); say(t('{name} is its own height again.', { name: t(nameOf(id)) })); } },
    { label: t('Remove'), run: () => toOff(id) },
  ].filter(Boolean);
  const toDock = (id) => { side.op([{ op: 'dock', id }]); say(t('{name} is in the sidebar.', { name: t(nameOf(id)) })); };
  const toBoard = async (id) => {
    const to = homeBoard();
    if (!to) return;
    const owner = side, generation = owner.context().gen;
    const ok = await change({ ops: [{ s: to, id, set: { on: true } }] });
    if (owner !== side || !owner?.active() || owner.context().gen !== generation) return;
    if (!ok) { owner.status(t("Couldn't save. Try again.")); return; }
    if (!await owner.op([{ op: 'undock', id, to: 'board', board: to }])) return;
    if (owner !== side || !owner.active() || owner.context().gen !== generation) return;
    // The override now owns the board. Only then retire the old float, so a refused destination keeps it reachable.
    if (fl(id) && !await change({ ops: [{ s: pages, id, set: ultra ? { on: false } : { float: false } }] })) owner.status(t("Couldn't save. Try again."));
    if (owner !== side || !owner.active() || owner.context().gen !== generation) return;
    say(t(board ? '{name} is back on this page.' : '{name} is on the Dashboard.', { name: t(nameOf(id)) }));
  };
  // Floating where it floated before, if it did; else from the room's corner (floatOut).
  const toFloat = async (id) => {
    const owner = side, generation = owner.context().gen;
    const was = ultra ? lay.boards.pages.find((x) => x.id === id) : lay.tiles.find((x) => x.id === id);
    const ok = await (!Number.isFinite(was?.x) ? floatOut(id) : change({ ops: [{ s: pages, id, set: { on: true, ...(!ultra && { float: true }) }, front: true }] }));
    if (owner !== side || !owner?.active() || owner.context().gen !== generation) return;
    if (!ok) { owner.status(t("Couldn't save. Try again.")); return; }
    if (owner.rec()?.dest[id] !== undefined) owner.op([{ op: 'undock', id, to: 'float' }]);
    say(t(ultra ? '{name} floats on every Blackboard page.' : '{name} floats on every Canvas page.', { name: t(nameOf(id)) }));
  };
  // Removed from wherever it shows; its data, and its spots, fold and height, stay for when it comes back.
  const toOff = (id) => {
    if (W.course(id)) change({ ops: [{ s: board, id, remove: true }] });
    else side.op([{ op: 'remove', id }]);
    say(t('{name} is removed. Add widgets brings it back.', { name: t(nameOf(id)) }));
  };
  // The dock's order: a step up or down (the buttons, the handle's arrow keys), or dragged by the handle.
  const dockMove = (id, by, sel) => {
    const i = dockIds.indexOf(id), j = i + by;
    if (i < 0 || j < 0 || j >= dockIds.length) return;
    side.op([{ op: 'move', id, by }]);
    say(t('{name} moved to {n} of {all}.', { name: t(nameOf(id)), n: j + 1, all: dockIds.length }));
    tiles.get(id)?.tools.querySelector(sel)?.focus();
  };
  const dockDrag = (id, handle) => {
    handle.addEventListener('pointerdown', (e) => {
      const home = side?.host()?.widgets, x = tiles.get(id);
      if (e.button !== 0 || gesture || !home || !x) return;
      e.preventDefault();
      const el = x.el, list = () => [...home.children].filter((c) => c.dataset?.tile);
      const from = list().indexOf(el);
      const move = (ev) => {
        const next = list().find((c) => { if (c === el) return false; const r = c.getBoundingClientRect(); return ev.clientY < r.top + r.height / 2; }) || null;
        if (next ? el.nextElementSibling === next : home.lastElementChild === el) return;
        // The tiles it passes glide aside (lib/motion.js), and so does it into its new place.
        const seat = () => seatAfter(home, el, next ? next.previousElementSibling : home.lastElementChild);
        if (globalThis.GZ_MOTION) GZ_MOTION.flip(list, seat, { enter: false, skip: (e) => e === el }); else seat();
      };
      const up = (ev) => {
        for (const [k, f] of [['pointermove', move], ['pointerup', up], ['pointercancel', up]]) document.removeEventListener(k, f);
        delete el.dataset.dragging;
        gesture = null;
        if (!ev) return;
        const to = list().indexOf(el);
        if (ev.type !== 'pointerup' || to === from || to < 0) { draw(); return; }
        side.op(Array.from({ length: Math.abs(to - from) }, () => ({ op: 'move', id, by: to > from ? 1 : -1 })));
        say(t('{name} moved to {n} of {all}.', { name: t(nameOf(id)), n: to + 1, all: dockIds.length }));
      };
      gesture = { id, cancel: up };
      el.dataset.dragging = '';
      // Moving a node releases its pointer capture. Listen on the document until release so the reorder can finish.
      for (const [k, f] of [['pointermove', move], ['pointerup', up], ['pointercancel', up]]) document.addEventListener(k, f);
    });
    handle.addEventListener('keydown', (e) => {
      const by = { ArrowUp: -1, ArrowDown: 1 }[e.key];
      if (!by) return;
      e.preventDefault();
      dockMove(id, by, '.gz-w-handle');
    });
  };
  // A docked tile's height, by the edge under it (the arrow keys too; a double-click, or Auto height in its menu, gives
  // it its own again). Its width is the sidebar's.
  const vsize = (x, id) => {
    const h = make('div', { className: 'gz-w-vsize', tabIndex: 0 });
    const name = t(nameOf(id));
    h.setAttribute('role', 'separator');
    h.setAttribute('aria-orientation', 'horizontal');
    h.setAttribute('aria-label', t('Height of {name}: arrow keys', { name }));
    h.setAttribute('aria-valuemin', String(W.MIN_H));
    h.setAttribute('aria-valuemax', '3000');
    h.title = t('Drag to resize, or use the arrow keys. Double-click for its own height.');
    const keep = (px) => { const v = Math.max(W.MIN_H, Math.min(3000, Math.round(px))); side?.op([{ op: 'height', id, h: v }]); say(t('Resized {name}: {h} px tall', { name, h: v })); };
    h.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || gesture) return;
      e.preventDefault();
      const y0 = e.clientY, h0 = x.body.offsetHeight;
      let got = null;
      const move = (ev) => { got = Math.max(W.MIN_H, Math.min(3000, h0 + ev.clientY - y0)); x.body.style.height = `${got}px`; };
      const up = (ev) => {
        for (const [k, f] of [['pointermove', move], ['pointerup', up], ['pointercancel', up]]) h.removeEventListener(k, f);
        gesture = null;
        if (!ev) return;
        if (ev.type === 'pointerup' && got !== null) keep(got); else draw();
      };
      gesture = { id, cancel: up };
      h.setPointerCapture?.(e.pointerId);
      for (const [k, f] of [['pointermove', move], ['pointerup', up], ['pointercancel', up]]) h.addEventListener(k, f);
    });
    h.addEventListener('keydown', (e) => {
      const by = { ArrowUp: -1, ArrowDown: 1 }[e.key];
      if (!by) return;
      e.preventDefault();
      keep(x.body.offsetHeight + by * W.GRID * (e.shiftKey ? 4 : 1));
      h.focus();
    });
    h.addEventListener('dblclick', () => { side?.op([{ op: 'height', id, h: null }]); say(t('{name} is its own height again.', { name })); });
    return h;
  };
  // Fold at any time; floating, its way back; on a board while editing, Float and Remove, all in the heading row.
  // With the sidebar, the destination menu takes Float and Remove's place, and a docked tile has its handle and Move up
  // and down too. A control redrawn by its own click keeps the focus.
  const toolsFor = (x, tile) => {
    const signature = JSON.stringify([!!side, editing, tile.dock, tile.float, tile.fold, tile.h, dockIds.indexOf(tile.id), dockIds.length]);
    if (x.toolsKey === signature) return;
    x.toolsKey = signature;
    const name = t(nameOf(tile.id));
    const label = (b, text) => { b.setAttribute('aria-label', text); b.title = text; return b; };
    const again = (sel, run) => () => { run(); x.tools.querySelector(sel)?.focus(); };
    if (side) {
      const where = tile.dock ? 'dock' : tile.float ? 'float' : 'board';
      const m = label(button('⋯', () => side?.menu(m, dests(tile.id, where, tile)), { className: 'gz-w-icon gz-w-dest' }), t('Move {name}', { name }));
      m.setAttribute('aria-haspopup', 'menu');
      m.setAttribute('aria-expanded', 'false');
      const folded = !!tile.fold;
      const fold = label(button(folded ? '▸' : '▾', again('.gz-w-fold', () => (tile.dock ? side.op([{ op: 'fold', id: tile.id, v: !folded }]) : change({ ops: [{ s: tile.float ? pages : board, id: tile.id, set: { fold: !folded } }] }))), { className: 'gz-w-icon gz-w-fold' }), t(folded ? 'Unfold {name}' : 'Fold {name}', { name }));
      fold.setAttribute('aria-expanded', String(!folded));
      x.body.hidden = folded;
      if (!tile.dock) { x.tools.replaceChildren(...(tile.float || editing ? [m] : []), fold); return; }
      const i = dockIds.indexOf(tile.id);
      const handle = label(button('⠿', () => {}, { className: 'gz-w-icon gz-w-handle' }), t('Reorder {name}: drag, or use the arrow keys', { name }));
      dockDrag(tile.id, handle);
      const up = label(button('↑', () => dockMove(tile.id, -1, '.gz-w-up'), { className: 'gz-w-icon gz-w-up', disabled: i <= 0 }), t('Move {name} up', { name }));
      const down = label(button('↓', () => dockMove(tile.id, 1, '.gz-w-down'), { className: 'gz-w-icon gz-w-down', disabled: i < 0 || i >= dockIds.length - 1 }), t('Move {name} down', { name }));
      x.tools.replaceChildren(handle, up, down, m, fold);
      return;
    }
    const where = tile.float ? pages : board;
    const fold = label(button(tile.fold ? '▸' : '▾', again('.gz-w-fold', () => change({ ops: [{ s: where, id: tile.id, set: { fold: !tile.fold } }] })), { className: 'gz-w-icon gz-w-fold' }), t(tile.fold ? 'Unfold {name}' : 'Fold {name}', { name }));
    fold.setAttribute('aria-expanded', String(!tile.fold));
    x.body.hidden = tile.fold;
    x.tools.replaceChildren(...(tile.float ? [label(button('⇲', () => floatBack(tile.id), { className: 'gz-w-icon' }), t(board ? 'Put {name} back on this page' : backBoard() !== 'courses' ? 'Put {name} back on the Dashboard' : 'Put {name} back on the Courses page', { name }))]
      : editing ? [...(tile.id === 'todo' || W.course(tile.id) ? [] : [label(button('⇱', () => floatOut(tile.id), { className: 'gz-w-icon' }), t(ultra ? 'Float {name} on every Blackboard page' : 'Float {name} over every page', { name }))]), label(button('×', () => change({ ops: [{ s: board, id: tile.id, ...(W.course(tile.id) ? { remove: true } : { set: { on: false } }) }] }), { className: 'gz-w-icon' }), t('Remove {name}', { name }))] : []), fold);
  };

  // What is said to a screen reader (a status line in the bar, or the floating layer's).
  let live = null;
  const say = (text) => {
    if (!grid && side) { side.say(text); return; }
    const at = grid || floats;
    if (!at) return;
    if (live?.parentNode !== at) { live = make('p', { className: 'gz-sr' }); live.setAttribute('role', 'status'); at.append(live); }
    live.textContent = text;
  };
  // The guides a dragged tile shows on the lines it met (snap's guides), in its room: len, how far they reach, from
  // off (a floating tile's room's corner on the window).
  let guides = null;
  const showGuides = (parent, g, len, off = { left: 0, top: 0 }) => {
    guides ||= ['x', 'y'].map((a) => { const d = make('div', { className: 'gz-guide' }); d.dataset.axis = a; d.setAttribute('aria-hidden', 'true'); return d; });
    guides.forEach((d, i) => {
      const at = i ? g.y : g.x;
      d.hidden = at === null;
      if (at === null) return;
      if (d.parentNode !== parent) parent.append(d);
      Object.assign(d.style, i ? { left: `${off.left}px`, top: `${at + off.top}px`, width: `${len.w}px`, height: '' } : { left: `${at + off.left}px`, top: `${off.top}px`, width: '', height: `${len.h}px` });
    });
  };

  // On a board, drag anywhere but its controls while editing; floating, by its heading. Arrow keys move a focused
  // tile (Shift: further). Both snap to the grid, room and neighbours, Alt freely. A press brings it to the front.
  let lastAt = {}, lastW = 0, stacked = false; // the board's last arrangement (arrange), its room's width, stacked or not
  let floatsStacked = false; // Floating tiles, stacked at the window's edge (floating)
  let gesture = null; // the tile being dragged or resized, and how to release it if it goes away
  const ARROWS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  const movable = (id) => (dockIds.includes(id) ? false : fl(id) ? !floatsStacked : board ? editing && !stacked : false);
  const roomEl = () => (board === 'courses' ? room : grid?.querySelector('.gz-dash-grid'));
  // The room a floating tile has (lib/widgets.js room), so it never covers what stays over the page: the window less Glaze's
  // bar (its rail's or top bar's room, its bottom bar on a phone), and on Ultra the nav right of it, a course's top bar and
  // Glaze's footer; the course tabs (B8's, or anything else marked data-gz-keep-clear) and the sidebar expanded beside the
  // content on both. Canvas's footer is in its page.
  const floatRoom = () => {
    const html = document.documentElement, css = html && typeof getComputedStyle === 'function' ? getComputedStyle(html) : null;
    const edges = [...document.querySelectorAll(ultra ? '.MuiDrawer-paper, #base_tools, div.bb-course-navigation, [data-gz-keep-clear], #gz-footer' : '[data-gz-keep-clear]')];
    const tabs = document.getElementById('gz-navbar')?.shadowRoot?.querySelector('.tabs');
    if (tabs) edges.push(tabs);
    const sb = html?.getAttribute('data-gz-sidebar') === 'expanded' && globalThis.GZ_SIDEBAR_UI?.host?.()?.el;
    if (sb) edges.push(sb);
    const at = (v) => parseFloat(css?.getPropertyValue(v)) || 0;
    const r = W.room(innerWidth, innerHeight, edges.filter((e) => e !== sb).map((e) => e.getBoundingClientRect()),
      { bar: { left: at('--gz-navbar-left'), top: at('--gz-navbar-top') }, rtl: html?.dir === 'rtl', aside: sb ? sb.getBoundingClientRect() : null });
    return { ...r, edges };
  };
  // The room a tile moves in: its box on screen, its size, the other tiles in it ({ left, top, w, h }) and Ultra's column.
  const frame = (id) => {
    if (fl(id)) {
      const r = floatRoom();
      const others = [...tiles].filter(([k]) => k !== id && fl(k)).map(([, v]) => v.el.getBoundingClientRect());
      return { at: () => ({ left: r.left, top: r.top }), W: r.W, H: r.H, others: others.map((b) => ({ left: b.left - r.left, top: b.top - r.top, w: b.width, h: b.height })), lines: [], layer: floats, float: true };
    }
    const host = roomEl();
    const at = () => host.getBoundingClientRect();
    const g = grid.querySelector('.gz-dash-grid').getBoundingClientRect();
    return {
      at, W: host.clientWidth, H: board === 'courses' ? Math.max(host.parentElement.scrollHeight, lastAt[id]?.top + lastAt[id]?.h || 0) : Infinity,
      others: Object.entries(lastAt).filter(([k]) => k !== id).map(([, a]) => a),
      lines: board === 'courses' && g.width ? [g.left - at().left, g.right - at().left] : [], layer: host,
    };
  };
  // A board's tile moved: this one goes to its new spot, on top, and every other keeps where it shows now, all of them
  // kept from this room (its width is the board's w0), so nothing else moves.
  const settle = (id, spot) => change({
    ops: [{ s: board, id, set: spot, front: true }, ...lay.boards[board].filter((x) => x.id !== id && lastAt[x.id]).map((x) => ({ s: board, id: x.id, set: W.spotOf(lastAt[x.id], lastW) }))],
    widths: { [board]: Math.round(lastW) },
  });
  // A tile pressed goes on top of the others where it is (a board, or floating), unless it's there already.
  const raise = (id) => {
    const s = fl(id) ? pages : board, list = (fl(id) ? pageTiles() : lay.boards[s]) || [], me = list.find((x) => x.id === id);
    if (me && list.some((x) => x !== me && x.on && x.z >= me.z)) change({ ops: [{ s, id, front: true }] });
  };
  const drag = (el, head, id) => {
    const to = (left, top, f, free) => {
      const s = W.snap(left, top, el.offsetWidth, el.offsetHeight, f.W, f.H, f.others, { free, lines: f.lines });
      const o = f.float ? f.at() : { left: 0, top: 0 };
      el.style.left = `${s.left + o.left}px`;
      el.style.top = `${s.top + o.top}px`;
      return s;
    };
    const keep = (s, f) => {
      if (!f.float) { settle(id, W.spotOf({ left: s.left, top: s.top, w: el.offsetWidth }, f.W)); return s; }
      const p = W.place(s.left, s.top, el.offsetWidth, el.offsetHeight, f.W, f.H, true);
      change({ ops: [{ s: pages, id, set: { x: p.x, y: p.y }, front: true }], widths: { [pages]: Math.round(f.W) } });
      return p;
    };
    const surface = el;
    surface.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || gesture || !movable(id)) return;
      if (!ultra && fl(id) && !head.contains(e.target) && !e.target.closest('.gz-w-tools, .gz-w-resize')) { raise(id); return; }
      if (!fl(id) ? e.target.closest('.gz-w-tools, .gz-w-resize') : !head.contains(e.target) || e.target.closest('button, a, input, select, textarea')) return;
      const f = frame(id);
      const r = el.getBoundingClientRect();
      const x0 = e.clientX, y0 = e.clientY, dx = x0 - r.left, dy = y0 - r.top;
      const z0 = el.style.zIndex;
      let s = null;
      // The room's box is asked again each move: the page can scroll under the pointer. A press that wanders a pixel or
      // two is still a press.
      const move = (ev) => {
        if (!s && Math.abs(ev.clientX - x0) + Math.abs(ev.clientY - y0) < 4) return;
        el.dataset.dragging = '';
        const at = f.at();
        s = to(ev.clientX - dx - at.left, ev.clientY - dy - at.top, f, ev.altKey);
        showGuides(f.layer, s.guides, { w: f.W, h: Number.isFinite(f.H) ? f.H : Math.max(f.layer.clientHeight, innerHeight) }, f.float ? at : undefined);
      };
      const up = (ev) => {
        surface.removeEventListener('pointermove', move);
        surface.removeEventListener('pointerup', up);
        surface.removeEventListener('pointercancel', up);
        surface.removeEventListener('lostpointercapture', up);
        delete el.dataset.dragging;
        gesture = null;
        guides?.forEach((d) => d.remove());
        if (surface.hasPointerCapture?.(e.pointerId)) surface.releasePointerCapture(e.pointerId);
        el.style.zIndex = z0;
        if (!ev) return; // the caller is already redrawing or taking the tile away
        if (ev.type !== 'pointerup') { draw(); return; }
        if (s) keep(s, f);
        else { raise(id); draw(); }
      };
      gesture = { id, cancel: up };
      surface.setPointerCapture(e.pointerId);
      el.style.zIndex = f.float ? '2000' : '999'; el.focus({ preventScroll: true });
      surface.addEventListener('pointermove', move);
      surface.addEventListener('pointerup', up);
      surface.addEventListener('pointercancel', up);
      surface.addEventListener('lostpointercapture', up);
      e.preventDefault();
    });
    el.addEventListener('keydown', (e) => {
      const d = ARROWS[e.key];
      if (!d || e.target !== el) return;
      e.preventDefault();
      if (!movable(id)) return;
      const by = W.GRID * (e.shiftKey ? 4 : 1);
      const f = frame(id);
      const b = el.getBoundingClientRect(), o = f.at();
      const at = f.float ? { left: b.left - o.left, top: b.top - o.top } : lastAt[id];
      if (!at) return;
      const s = to(at.left + d[0] * by, at.top + d[1] * by, f, true);
      const kept = keep(s, f) || s;
      el.focus();
      say(t('Moved {name}: {x} px from the left, {y} px from the top', { name: t(nameOf(id)), x: kept.left, y: kept.top }));
    });
  };

  // Resizing a tile by its corner: on a board while editing, floating at any time. Dragged, the corner snaps as a
  // moved tile does (Alt: freely); the arrow keys on it grow or shrink it a grid step (Shift: four); a double-click gives
  // it its own size back. Its width and its body's height are kept (w, h; folded, only its width), and on a board every
  // spot from this room, as a move keeps them. The one resized goes on top.
  const resizer = (el, body, corner, id) => {
    // w: its new width, h: its body's height (null: its own; h undefined: as it is), tall: the tile's height then.
    const keep = (f, at, w, h, tall) => {
      if (w !== null) w = Math.min(4000, Math.round(w));
      if (h != null) { const next = Math.min(3000, Math.round(h)); tall += next - h; h = next; }
      const set = { w, ...(h !== undefined && { h }) };
      const wide = w || W.WIDTH[cur(id).size];
      if (!f.float) return settle(id, { ...W.spotOf({ left: at.left, top: at.top, w: wide }, f.W), ...set });
      const p = W.place(at.left, at.top, wide, tall, f.W, f.H, true);
      change({ ops: [{ s: pages, id, set: { x: p.x, y: p.y, ...set }, front: true }], widths: { [pages]: Math.round(f.W) } });
    };
    const where = (f) => {
      const b = el.getBoundingClientRect(), o = f.at();
      return f.float ? { left: b.left - o.left, top: b.top - o.top } : lastAt[id];
    };
    corner.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || gesture || !movable(id)) return;
      e.preventDefault();
      e.stopPropagation();
      const f = frame(id), r = el.getBoundingClientRect(), o = f.at();
      const at = { left: r.left - o.left, top: r.top - o.top };
      const extra = el.offsetHeight - (body.hidden ? 0 : body.offsetHeight); // its heading, padding and gaps
      const dx = e.clientX - r.right, dy = e.clientY - r.bottom;
      const z0 = el.style.zIndex;
      let got = null;
      const move = (ev) => {
        const o2 = f.at();
        got = W.stretch(at.left, at.top, ev.clientX - dx - o2.left, ev.clientY - dy - o2.top, f.W, f.H, f.others, { free: ev.altKey, lines: f.lines, minH: extra + W.MIN_H });
        el.style.width = `${got.w}px`;
        if (!body.hidden) body.style.height = `${got.h - extra}px`;
        showGuides(f.layer, got.guides, { w: f.W, h: Number.isFinite(f.H) ? f.H : Math.max(f.layer.clientHeight, innerHeight) }, f.float ? o2 : undefined);
      };
      const up = (ev) => {
        corner.removeEventListener('pointermove', move);
        corner.removeEventListener('pointerup', up);
        corner.removeEventListener('pointercancel', up);
        corner.removeEventListener('lostpointercapture', up);
        delete el.dataset.resizing;
        gesture = null;
        guides?.forEach((d) => d.remove());
        if (corner.hasPointerCapture?.(e.pointerId)) corner.releasePointerCapture(e.pointerId);
        el.style.zIndex = z0;
        if (!ev) return;
        if (ev.type !== 'pointerup') { draw(); return; }
        if (got) keep(f, at, got.w, body.hidden ? undefined : got.h - extra, body.hidden ? el.offsetHeight : got.h);
        else { raise(id); draw(); }
      };
      gesture = { id, cancel: up };
      corner.setPointerCapture(e.pointerId);
      el.dataset.resizing = '';
      el.style.zIndex = f.float ? '2000' : '999';
      corner.addEventListener('pointermove', move);
      corner.addEventListener('pointerup', up);
      corner.addEventListener('pointercancel', up);
      corner.addEventListener('lostpointercapture', up);
    });
    corner.addEventListener('keydown', (e) => {
      const d = ARROWS[e.key];
      if (!d) return;
      e.preventDefault();
      if (!movable(id)) return;
      const by = W.GRID * (e.shiftKey ? 4 : 1);
      const f = frame(id), at = where(f);
      if (!at) return;
      const w = Math.max(W.MIN_W, Math.round(el.offsetWidth) + d[0] * by);
      const h = body.hidden ? undefined : Math.max(W.MIN_H, Math.round(body.offsetHeight) + d[1] * by);
      keep(f, at, w, h, el.offsetHeight + (h === undefined ? 0 : d[1] * by));
      corner.focus();
      say(t('Resized {name}: {w} by {h} px', { name: t(nameOf(id)), w, h: Math.round(el.offsetHeight) }));
    });
    corner.addEventListener('dblclick', () => {
      if (!movable(id)) return;
      const f = frame(id), at = where(f);
      if (!at) return;
      keep(f, at, null, null, el.offsetHeight);
      say(t('{name} is its own size again.', { name: t(nameOf(id)) }));
    });
  };

  // Edit layout (then Done, with Reset layout and the tiles to add). Said to a
  // screen reader as it starts and ends; Esc ends it too.
  const setEditing = (v) => {
    if (!v) { gesture?.cancel(); globalThis.GZ_COURSE_CARDS?.picker.close(false); }
    editing = v;
    const edit = bar?.querySelector('.gz-dash-edit');
    if (edit) { if (v) edit.style.minWidth = `${edit.getBoundingClientRect().width}px`; edit.setAttribute('aria-pressed', String(editing)); if (board) edit.textContent = t(editing ? 'Done' : 'Edit layout'); }
    const reset = bar?.querySelector('.gz-dash-reset');
    if (reset) reset.hidden = !editing;
    if (board) say(t(editing ? 'Editing the layout. Drag a widget to move it, or its corner to resize it; the one you press comes to the front. Arrow keys work too, and Alt places it freely.' : 'Layout saved.'));
    draw();
  };
  const escape = (e) => { if (e.key === 'Escape' && editing && board) { setEditing(false); bar?.querySelector('.gz-dash-edit')?.focus(); } };
  let loadingCourses = null, nativeShown = false, courseSpace = null;
  const coursesChanged = () => { draw(); fillCourses(); };
  const loadCourses = () => {
    if (globalThis.GZ_COURSE_CARDS || loadingCourses) return;
    loadingCourses = ctx.need('features/coursecards.js', () => globalThis.GZ_COURSE_CARDS).then(() => {
      loadingCourses = null;
      if (on && board && globalThis.GZ_COURSE_CARDS) { GZ_COURSE_CARDS.sync(coursesChanged); coursesChanged(); }
    }, () => { loadingCourses = null; });
  };
  // Both Dashboards get their first course cards once (owner, 2026-10-20). The stored filled marker protects edits,
  // emptied boards and removed defaults; starter utilities share the board with its cards.
  const fillCourses = () => {
    if (!['cdash', 'dash'].includes(board) || !on || !lay?.starter || lay.filled.includes(board) || editing || flying) return;
    const C = globalThis.GZ_COURSE_CARDS;
    if (!C) { loadCourses(); return; }
    const cards = ultra ? C.list() : C.shown();
    if (!cards.length) return;
    change({ fill: board, ops: cards.slice(0, W.COURSE_MAX).map((c) => ({ s: board, id: c.key, set: { on: true, size: 's', term: c.term || '' } })) });
  };
  // The board's Course cards button: its dialog (features/coursecards.js) ticks courses on and off this board, each
  // tick or Select all one change, with the cards new to it placed in the board's free room (arrange). It asks the
  // board as it is when asked, so a change from it, or from another tab, shows in it at once.
  const coursePicker = (add) => {
    const C = globalThis.GZ_COURSE_CARDS;
    if (!C) return;
    const b = board;
    const rows = () => (board === b && lay.boards[b]) || [];
    const room = () => Math.max(0, Math.min(W.COURSE_MAX - rows().filter((x) => W.course(x.id)?.origin === location.origin).length, W.COURSE_TOTAL - rows().filter((x) => W.course(x.id)).length));
    const open = button(t('+ Course cards'), () => C.picker.open({
      board: b,
      has: (key) => rows().some((x) => x.id === key),
      on: (key) => rows().some((x) => x.id === key && x.on),
      room,
      count: () => rows().filter((x) => x.on && W.course(x.id)?.origin === location.origin).length,
      set: (keys, on) => {
        if (board !== b) return;
        if (on) nativeShown = false; // the cards show, not Ultra's list
        const terms = new Map(C.list().map((c) => [c.key, c.term]));
        change({ ops: keys.map((id) => (on ? { s: b, id, set: { on: true, size: 's', term: terms.get(id) || '' } } : { s: b, id, remove: true })) });
      },
      back: () => grid?.querySelector('.gz-course-open'),
    }), { className: 'gz-w-small gz-course-open' });
    open.setAttribute('aria-haspopup', 'dialog');
    add.append(open);
    C.picker.sync();
  };
  const clearCourses = () => {
    document.documentElement?.removeAttribute('data-gz-course-tiles');
    courseSpace?.remove(); courseSpace = null;
    bar?.querySelector('.gz-course-native')?.remove();
    nativeShown = false;
  };
  const nativeCourses = (want, away) => {
    const selected = (board === 'courses' || board === 'cdash') && want.some((x) => W.course(x.id));
    const cardsOn = selected && !away && !nativeShown;
    // Canvas's own cards (the card view) step aside as Ultra's list does.
    document.documentElement?.toggleAttribute('data-gz-course-tiles', cardsOn);
    let toggle = bar?.querySelector('.gz-course-native');
    if (selected && !toggle) {
      toggle = button('', () => { nativeShown = !nativeShown; draw(); }, { className: 'gz-w-small gz-course-native' });
      if (ultra) toggle.title = t("Ultra's search, filters and term picker stay in its course list.");
      bar.append(toggle);
    }
    if (toggle) {
      if (!selected) toggle.remove();
      else { const text = t(nativeShown ? ultra ? 'Show course cards' : 'Show course card widgets' : ultra ? "Show Ultra’s course list" : "Show Canvas’s course cards"); if (toggle.textContent !== text) toggle.textContent = text; toggle.setAttribute('aria-pressed', String(nativeShown)); }
    }
    for (const [id, x] of tiles) if (W.course(id) && x.el.hidden !== (nativeShown && selected)) x.el.hidden = nativeShown && selected;
    const home = ultra && cardsOn && document.querySelector('.courses-panel .base-courses');
    if (home) { courseSpace ||= make('div', { className: 'gz-course-space', ariaHidden: 'true' }); if (courseSpace.parentNode !== home) home.append(courseSpace); }
    else { courseSpace?.remove(); courseSpace = null; }
  };
  const gridEl = () => {
    const edit = button(t('Edit layout'), () => setEditing(!editing), { className: 'gz-w-small gz-dash-edit' });
    edit.setAttribute('aria-pressed', 'false');
    const reset = board && button(t('Reset layout'), () => {
      change({ ops: lay.boards[board].filter((x) => !W.course(x.id) || W.course(x.id).origin === location.origin).map((x) => ({ s: board, id: x.id, set: { x: null, y: null, r: false, z: 0, fold: false, w: null, h: null } })), widths: { [board]: 0 } });
      say(t('Layout reset.'));
    }, { className: 'gz-w-small gz-dash-reset', hidden: true });
    const hubBtn = button(t('What Glaze can do'), () => hub(), { className: 'gz-w-small' });
    hubButton = hubBtn;
    // Ultra: the reminders' hub (features/reminders.js) from here too, when it has one to open (Canvas's is in its To Do's head).
    const remind = ultra && button(t('Reminders'), () => globalThis.GZ_REMIND_UI?.cmds()[0]?.run(), { className: 'gz-w-small gz-dash-remind', hidden: true });
    // Hide widgets: every widget on the Courses page (its board's and the ones floating everywhere) away at once.
    const hide = board === 'courses' && button(t('Hide widgets'), () => { hidden = !hidden; put({ widgetsHidden: hidden }); draw(); }, { className: 'gz-w-small gz-dash-hide' });
    const add = make('div', { className: 'gz-dash-add' });
    const area = make('div', { className: 'gz-dash-grid' });
    bar = make('div', { className: 'gz-dash-bar' }, !ultra && make('h2', { className: 'screenreader-only', textContent: t('Notes and widgets') }), hide, edit, reset, remind, hubBtn);
    // A named group, not a toolbar: a toolbar promises arrow keys between its buttons, and Tab reaches each of these.
    if (board === 'courses') { bar.id = 'gz-toolbar'; bar.setAttribute('role', 'group'); bar.setAttribute('aria-label', 'Glaze'); bar.addEventListener('keydown', escape); }
    const box = make('section', { id: 'gz-dash' }, ...(board === 'courses' ? [] : [bar]), area, add);
    if (board) box.dataset.board = board;
    box.setAttribute('aria-label', t(board === 'dash' ? 'Dashboard' : 'Notes and widgets'));
    box.addEventListener('keydown', escape);
    return box;
  };
  // Ultra's panel: first in its column, the grid, whose height keeps the column's widgets clear of what is below them
  // (Ultra's own To Do, when Better To Do is off). The To Do is a widget too, so there's nothing to fold here: Hide
  // widgets, in the toolbar, takes them all away.
  const panelEl = () => {
    const box = make('section', { id: 'gz-panel' }, make('div', { id: 'gz-panel-body' }, grid));
    box.setAttribute('aria-label', 'Glaze');
    return box;
  };
  // The Dashboard's tabs (features/dashboard.js). Without them the board stays hidden, and Ultra's page shows as it is.
  // Only for the Dashboard it was asked for: by the time the file arrives (or doesn't), the student may be elsewhere.
  const tabsIn = () => {
    const g = grid;
    const still = () => on && board === 'dash' && grid === g && g.isConnected;
    return ctx.need('features/dashboard.js', () => globalThis.GZ_DASH_UI).then(() => { if (still()) GZ_DASH_UI.tabs(g); }, () => {
      if (!still()) return;
      g.hidden = true;
      document.documentElement.setAttribute('data-gz-dash', 'ip');
    });
  };
  // Canvas: right under the Dashboard's heading; the GPA goes right before the cards, so the two never trade places.
  // Ultra's Courses page: the panel goes first in its column, above Ultra's To Do and Glaze's Better To Do, and the tiles'
  // layer first in the page; its Dashboard: before Ultra's own Institution page.
  const placeGrid = () => {
    const h = home();
    // Off this page: Ultra's panel goes with the grid still in it, so it comes back whole.
    if (!h) { for (const e of [panel, grid, room, bar]) e?.remove(); return false; }
    grid ||= gridEl();
    if (board === 'courses') {
      panel ||= panelEl();
      const body = panel.querySelector('#gz-panel-body');
      if (grid.parentNode !== body) body.append(grid);
      if (h.firstElementChild !== panel) h.prepend(panel);
      // The toolbar: in the page's header, where Ultra keeps its own (empty) header tools; else atop the grid.
      const tools = document.querySelector('div.base-courses-header-container div.base-header-tools');
      if (tools ? bar.parentNode !== tools : bar.parentNode !== grid) { if (tools) tools.prepend(bar); else grid.prepend(bar); }
      if (!room) { room = make('div', { id: 'gz-room' }); room.addEventListener('keydown', escape); }
      if (roomHost(h).firstElementChild !== room) roomHost(h).prepend(room);
    } else if (board === 'dash') {
      if (!placed(h)) { const ip = [...h.children].find((e) => e.tagName === 'INSTITUTION-PAGE-HOME'); if (ip) ip.before(grid); else h.append(grid); }
      tabsIn();
    } else if (!placed(h)) h.after(grid);
    return true;
  };

  // Everything of this page's taken away (Glaze off, or another page: a board's tiles start again on the next).
  let ro = null, frame0 = 0, floatRO = null, floatFrame = 0;
  const floatWatched = new Set();
  const teardown = (all = true) => {
    gesture?.cancel();
    laid = '';
    for (const [id, x] of tiles) if (all || x.el.parentNode !== floats) { x.stop?.(); x.el.remove(); tiles.delete(id); }
    ro?.disconnect();
    floatRO?.disconnect();
    floatWatched.clear();
    cancelAnimationFrame(floatFrame);
    globalThis.GZ_DASH_UI?.tabs(null);
    globalThis.GZ_COURSE_CARDS?.picker.close(false);
    document.documentElement?.removeAttribute('data-gz-todo-tile');
    document.documentElement?.removeAttribute('data-gz-canvas-todo');
    document.documentElement?.removeAttribute('data-gz-sidebar-todo');
    dockIds = [];
    clearCourses();
    for (const e of [grid, panel, room, bar, all && floats]) e?.remove?.();
    grid = panel = room = bar = null;
    if (all) floats = null;
    editing = false;
    lastAt = {};
    stacked = false;
  };
  // On Canvas's Dashboard the board owns To Do, including an intentional removal. Course-home lists stay native.
  // With the sidebar, Better To Do drawn here (docked, or on this board) owns it, and so does removing it on purpose; a
  // list that couldn't load (features/todo.js) gives Canvas's back.
  const todoIn = () => {
    const root = document.documentElement;
    if (side) {
      root?.removeAttribute('data-gz-canvas-todo');
      const owns = ctx.settings().enhance.todo && (!!tiles.get('todo')?.body.querySelector('#gz-todo[data-ready]') || side.rec()?.dest.todo === 'off');
      root?.toggleAttribute('data-gz-sidebar-todo', !!owns);
      return;
    }
    root?.removeAttribute('data-gz-sidebar-todo');
    const owns = !ultra && board === 'cdash' && !!grid?.isConnected && ctx.settings().enhance.todo;
    if (owns) globalThis.GZ_TODO_UI?.sync(true);
    // Keep the native list visible if the selected widget's feature has not loaded. Removing the widget is deliberate.
    document.documentElement?.toggleAttribute('data-gz-canvas-todo', !!owns && (!tiles.has('todo') || !!grid.querySelector('#gz-todo')));
  };
  let asleep = false, fullyHidden = false, owed = false;
  const draw = () => {
    if (!on || !lay) return;
    const sleeping = document.visibilityState === 'hidden' || covered();
    if (sleeping && !asleep) cover();
    // Covered, nothing is drawn until shown again; but the page's floats, over the frame, are drawn as ever.
    owed = sleeping;
    if (sleeping && (document.visibilityState === 'hidden' || !(atTop && (pageTiles().some((x) => x.on) || [...tiles.values()].some((x) => onTop(x.el)))))) return;
    if (!sleeping && drawn !== board) teardown(false);
    if (!sleeping) drawn = board;
    if (!sleeping) side = sideNow();
    else if (!side && ctx.settings().enhance.sidebar && globalThis.GZ_SIDEBAR_UI?.rec()) side = GZ_SIDEBAR_UI;
    if (!sideAccount && side?.context().accountId) sideAccount = side.context().accountId;
    // The sidebar came or went: To Do's tile is filled the other way (a spot, or the list mounted in it).
    if (!sleeping && !!side !== sideWas) { sideWas = !!side; const x = tiles.get('todo'); if (x) { x.stop?.(); x.el.remove(); tiles.delete('todo'); } }
    const hasGrid = sleeping ? !!grid : placeGrid();
    const want = wanted(hasGrid, sleeping);
    dockIds = want.filter((x) => x.dock).map((x) => x.id);
    if (want.some((x) => x.float) && !floats?.isConnected) { floats = make('div', { id: 'gz-float' }); document.body.append(floats); }
    // A board is laid out again when its room's width or a tile's height changes (the nav folding, what a tile shows),
    // once a frame at most.
    if (!sleeping && board && hasGrid) {
      ro ||= new ResizeObserver(() => { cancelAnimationFrame(frame0); frame0 = requestAnimationFrame(() => { if (on && board && !asleep) layoutBoard(); }); });
      ro.observe(roomEl());
    }
    // The dock's tiles glide to new places (moved by its buttons or arrow keys, one added or removed), and a new one
    // settles in (lib/motion.js); not while a gesture moves them itself, nor in the dock's first drawing.
    const dock = !sleeping && !gesture && side?.host()?.widgets;
    const docked = () => (dock ? [...dock.children].filter((c) => c.dataset?.tile) : []);
    const motion = dock && docked().length ? globalThis.GZ_MOTION : null;
    const seat = () => {
      for (const [id, x] of tiles) if ((!sleeping || onTop(x.el)) && !want.some((w) => w.id === id)) { if (gesture?.id === id) gesture.cancel(); x.stop?.(); x.el.remove(); tiles.delete(id); }
      const last = new Map(); // home -> the tile placed last in it
      for (const tile of want) {
        if (sleeping && !tile.float) continue;
        let x = tiles.get(tile.id);
        const wasShown = x && shown(x.el);
        let fresh = false;
        if (!x) {
          x = tileEl(tile.id);
          x.el.toggleAttribute('data-float', !!tile.float);
          Object.assign(x, (added.get(tile.id) || WIDGETS[tile.id] || GZ_COURSE_CARDS.fill)(x.body, api(tile.id)) || {});
          tiles.set(tile.id, x);
          fresh = true;
        }
        if (!sleeping) ro?.observe(x.el);
        if (W.course(tile.id)) {
          const name = nameOf(tile.id);
          if (x.head.querySelector('h3').textContent !== name) { x.head.querySelector('h3').textContent = name; x.el.setAttribute('aria-label', name); }
        }
        x.el.dataset.size = tile.size;
        x.el.toggleAttribute('data-float', !!tile.float);
        x.el.toggleAttribute('data-fold', !!tile.fold);
        // Its body as tall as it was resized to (else its content), scrolling inside. While a board is edited, its tiles
        // are things to move (their content waits), each in the Tab order for the arrow keys; a floating one always is.
        if (!gesture) { const h = tile.h ? `${tile.h}px` : ''; if (x.body.style.height !== h) x.body.style.height = h; }
        const edit = editing && !tile.float && !tile.dock;
        if (x.body.inert !== edit) x.body.inert = edit;
        if (tile.float || edit) { x.el.setAttribute('tabindex', '0'); x.el.setAttribute('aria-description', t('Drag to move, or use the arrow keys')); }
        else { x.el.removeAttribute('tabindex'); x.el.removeAttribute('aria-description'); }
        x.el.toggleAttribute('data-dock', !!tile.dock);
        if (tile.dock && !x.vsize) { x.vsize = vsize(x, tile.id); x.el.append(x.vsize); }
        if (x.vsize) { x.vsize.hidden = !tile.dock || !!tile.fold; x.vsize.setAttribute('aria-valuenow', String(tile.h || Math.max(W.MIN_H, x.body.offsetHeight))); }
        toolsFor(x, tile);
        x.context?.();
        if (board && !tile.float && !tile.dock) continue; // laid out below, in reading order
        // In order, moving only what is out of place: a moved element loses focus (a note being typed).
        const home = tile.float ? floats : tile.dock ? side.host()?.widgets : grid.querySelector('.gz-dash-grid');
        if (!home) continue;
        const prev = last.get(home);
        if (x.el.parentNode !== home || x.el.previousElementSibling !== (prev || null)) seatAfter(home, x.el, prev);
        last.set(home, x.el);
        if (!tile.float) x.el.removeAttribute('style');
        if ((fresh || !wasShown) && tile.float && sleeping) (x.resume || x.wake)?.();
      }
    };
    if (motion) motion.flip(docked, seat); else seat();
    if (sleeping) { placeFloats(); return; }
    // Hide widgets (the Courses page only; editing shows them all).
    const away = board === 'courses' && hidden && !editing;
    // Better To Do in its tile on the Courses page: Ultra's own To Do in the column steps aside (apps.css).
    document.documentElement?.toggleAttribute('data-gz-todo-tile', board === 'courses' && !boardless() && want.some((x) => x.id === 'todo'));
    for (const e of [room, panel, floats]) if (e && e.hidden !== away) e.hidden = away;
    const hb = bar?.querySelector('.gz-dash-hide');
    if (hb) { hb.textContent = t(hidden ? 'Show widgets' : 'Hide widgets'); hb.setAttribute('aria-pressed', String(hidden)); }
    nativeCourses(want, away);
    if (board) layoutBoard();
    placeFloats();
    if (grid) {
      remindIn();
      grid.toggleAttribute('data-editing', editing);
      room?.toggleAttribute('data-editing', editing);
      const add = grid.querySelector('.gz-dash-add');
      // With the sidebar, a widget shown nowhere (one shown elsewhere moves by its own menu).
      const off = (board ? lay.boards[board] : lay.tiles).filter((x) => !W.course(x.id) && !boardless() && (side ? placedAt.get(x.id)?.where === 'off' : !x.on && !fl(x.id)) && allowed(x.id));
      // A Dashboard with every widget off is still the Dashboard: it says how to fill it.
      const empty = board && board !== 'courses' && !editing && !want.some((x) => !x.float && !x.dock);
      add.replaceChildren(...(editing && off.length ? [make('span', { className: 'gz-w-faint', textContent: t('Add:') }),
        ...off.map((x) => button(`+ ${t(nameOf(x.id))}`, () => {
          change({ ops: [{ s: board || 'canvas', id: x.id, set: board ? { on: true, x: null, y: null } : { on: true } }] });
          if (side && board && side.rec()?.dest[x.id] !== undefined) side.op([{ op: 'undock', id: x.id, to: 'board', board }]);
        }, { className: 'gz-w-small' }))]
        : empty ? [make('p', { className: 'gz-w-faint', textContent: t('Nothing here yet. Edit layout adds widgets.') })] : []));
      if (board && editing) { loadCourses(); coursePicker(add); }
    }
    side?.drawn(dockIds.length);
    todoIn();
  };

  // Where a board's tiles show (lib/widgets.js arrange): at their spots, or one under another when the window is too
  // narrow for the layout, which is kept for a wider one; the Courses page's panel makes room for the tiles at its
  // column's top, so Ultra's To Do and Better To Do start below them. The tiles' order on the page (Tab, a screen reader)
  // is their reading order. A tile's height is kept from when it was on the board, so stacking doesn't flip back and forth.
  const heights = new Map();
  const layoutBoard = () => {
    if (asleep) return;
    const area = grid?.querySelector('.gz-dash-grid');
    const host = roomEl();
    if (gesture || !board || !area || !host?.isConnected || (board === 'courses' && hidden && !editing)) return;
    const list = wanted(true).filter((x) => !x.float && !x.dock && tiles.has(x.id));
    const dims = {};
    for (const x of list) {
      const { el } = tiles.get(x.id);
      if (!el.isConnected) (stacked || board !== 'courses' ? area : room).append(el);
      if (el.offsetHeight && (!stacked || !heights.has(x.id))) heights.set(x.id, el.offsetHeight);
      dims[x.id] = { w: widthOf(x), h: heights.get(x.id) || el.offsetHeight };
    }
    const width = host.clientWidth;
    let col = null, lines = null, side = true, courseArea = null;
    if (boardless()) {
      // The dock has the column: only course cards here, at their spots in the page's room.
      const r = host.getBoundingClientRect();
      col = { right: 0, top: 0 };
      const c = document.querySelector('.courses-panel .base-courses')?.getBoundingClientRect();
      if (c) courseArea = { left: Math.max(0, Math.round(c.left - r.left)), top: Math.max(0, Math.round(c.top - r.top)), width: c.width };
    } else if (board === 'courses') {
      // Ultra's column, where the panel is: beside the courses, or (narrow) under them at their width.
      const r = host.getBoundingClientRect(), g = area.getBoundingClientRect();
      col = { right: Math.max(0, Math.round(r.right - g.right)), top: Math.round(g.top - r.top) };
      lines = [g.left - r.left, g.right - r.left];
      side = g.width > 0 && g.width <= width / 2;
      const c = document.querySelector('.courses-panel .base-courses')?.getBoundingClientRect();
      if (c) courseArea = { left: Math.max(0, Math.round(c.left - r.left)), top: Math.max(0, Math.round(c.top - r.top)), width: c.width };

    }
    const card = location.pathname.endsWith('/preview.html') ? ctx.settings().card : cardPrefs || ctx.settings().card;
    const cards = { width: card?.width || 262, gap: card?.gap >= 0 ? card.gap : W.GAP };
    const opts = { col, courseArea, w0: lay.widths[board], ordered: board === 'cdash', cards: lay.starter || list.some((x) => W.course(x.id)) ? cards : null, rtl: document.documentElement?.dir === 'rtl' };
    let res = W.arrange(list, dims, width, opts);
    if (side && !res.stack) {
      // Measure at the final row width before positioning the next row, so wrapped content cannot overlap it at first paint.
      for (const id of res.order) {
        const el = tiles.get(id).el, w = `${res.at[id].w}px`;
        if (el.style.width !== w) el.style.width = w;
      }
      for (const id of res.order) {
        const h = tiles.get(id).el.offsetHeight;
        if (h) { dims[id].h = h; heights.set(id, h); }
      }
      res = W.arrange(list, dims, width, opts);
    }
    lastAt = res.at;
    lastW = width;
    stacked = !side || res.stack;
    area.toggleAttribute('data-stack', stacked);
    const parent = stacked || board !== 'courses' ? area : room;
    const focus = document.activeElement;
    const place = () => {
      let prev = null;
      for (const id of res.order) {
        const { el } = tiles.get(id);
        if (el.parentNode !== parent || el.previousElementSibling !== prev) seatAfter(parent, el, prev);
        prev = el;
        const a = res.at[id];
        const z = String(1 + (cur(id)?.z || 0));
        if (stacked) { if (el.style.left) el.removeAttribute('style'); continue; }
        for (const [k, v] of Object.entries({ left: `${a.left}px`, top: `${a.top}px`, width: `${a.w}px`, zIndex: z })) if (el.style[k] !== v) el.style[k] = v;
      }
    };
    // Tiles the board moves (one added, removed or resized, the room's width changing) glide there (lib/motion.js);
    // not in a board's first layout, which would fly every tile in from where the page first put it.
    const motion = laid === board ? globalThis.GZ_MOTION : null;
    if (motion) motion.flip(() => res.order.map((id) => tiles.get(id).el), place, { enter: false }); else place();
    laid = board;
    if (focus !== document.activeElement && focus?.isConnected) focus.focus({ preventScroll: true });
    const keep = stacked || boardless() ? '' : `${board === 'courses' ? W.reserve(Object.values(res.at), lines[0], lines[1], col.top) : res.bottom + W.GAP}px`;
    if (area.style.height !== keep) area.style.height = keep;
    if (courseSpace) {
      const height = stacked || !courseArea ? '0px' : `${W.reserve(Object.values(res.at), courseArea.left, courseArea.left + courseArea.width, courseArea.top) + W.GAP}px`;
      if (courseSpace.style.height !== height) courseSpace.style.height = height;
    }
  };

  // This board's allowed tiles and this site's floats, each once. Declared tiles wait for their file to register. In the
  // frame Canvas's pages outside a course open in (the Dashboard over a course page), the page around has the floats.
  // With the sidebar, each in its one destination (lib/sidebar.js resolve), and the dock's in the dock's order.
  const placement = () => (placedAt = side ? GZ_SIDEBAR.resolve(lay, side.rec(), { site: ctx.site, board, enabled: true, allowed, dockable }) : new Map());
  const wanted = (hasGrid, floatsOnly = false) => (side ? (() => {
    const at = placement();
    return [
      ...(board && hasGrid ? lay.boards[board].filter((x) => at.get(x.id)?.where === 'board' && !(boardless() && dockable(x.id))) : []),
      ...(atTop ? pageTiles().filter((x) => at.get(x.id)?.where === 'float').map((x) => ({ ...x, float: true })) : []),
      ...GZ_SIDEBAR.docked(side.rec()).filter((e) => at.get(e.id)?.where === 'dock')
        .map((e) => ({ id: e.id, on: true, size: cur(e.id)?.size || MORE[e.id]?.size || 's', dock: true, fold: !!e.fold, ...(e.h && { h: e.h }) })),
    ];
  })() : [
    ...(board && hasGrid ? lay.boards[board].filter((x) => !fl(x.id)) : []),
    ...(atTop ? pageTiles().filter((x) => x.on).map((x) => ({ ...x, float: true })) : []),
  ]).filter((x) => {
    if (floatsOnly && !x.float) return false;
    if (!x.on || !allowed(x.id)) return false;
    if (W.course(x.id)) { loadCourses(); return !!globalThis.GZ_COURSE_CARDS; }
    if (WIDGETS[x.id] || added.has(x.id)) return true;
    if (MORE[x.id] && !(loadingMore.get(x.id) > Date.now())) {
      loadingMore.set(x.id, Infinity);
      ctx.need(MORE[x.id].file, () => added.has(x.id)).then(() => { loadingMore.delete(x.id); if (on) draw(); }, () => { loadingMore.set(x.id, Date.now() + 60000); });
    }
    return false;
  });
  // What a tile from another file is given besides its body.
  const account = () => who().then(() => ({ ...me }));
  // surface(): where it shows now ('dock', 'float' or 'board'): no page, account or LMS data with it, so mods get it too.
  const api = (id) => ({ id, term: () => cur(id)?.term || '', who: account, site: ctx.site, size: () => cur(id)?.size || 's', surface: () => (dockIds.includes(id) ? 'dock' : fl(id) ? 'float' : 'board') });
  // Floating tiles (lib/widgets.js floating): each at its place in the room the window leaves right of the nav
  // and below a course's top bar, on top in the order they were moved; stacked at the window's edge (data-stack) when
  // the window is too narrow for where they were placed. Their width is as resized, else their size's, as on the boards.
  const placeFloats = () => {
    if (!floats || gesture || document.visibilityState === 'hidden') return;
    const r = floatRoom();
    const list = pageTiles().filter((x) => x.on && tiles.has(x.id));
    if (!list.length) { floatRO?.disconnect(); floatWatched.clear(); floatsStacked = false; floats.removeAttribute('data-stack'); return; }
    const watch = new Set([...r.edges, ...list.map((x) => tiles.get(x.id).el)]);
    floatRO ||= new ResizeObserver(() => { cancelAnimationFrame(floatFrame); floatFrame = requestAnimationFrame(() => { if (on) placeFloats(); }); });
    for (const e of floatWatched) if (!watch.has(e)) { floatRO.unobserve(e); floatWatched.delete(e); }
    for (const e of watch) if (!floatWatched.has(e)) { floatRO.observe(e); floatWatched.add(e); }
    const dims = Object.fromEntries(list.map((x) => [x.id, { w: widthOf(x), h: Math.max(tiles.get(x.id).el.offsetHeight, tiles.get(x.id).el.scrollHeight) }]));
    const res = W.floating(list, dims, r.W, r.H, lay.widths[pages]);
    floatsStacked = res.stack;
    floats.toggleAttribute('data-stack', floatsStacked);
    for (const [k, v] of Object.entries({ '--gz-float-top': `${r.top + W.EDGE}px`, '--gz-float-right': `${innerWidth - r.right + W.EDGE}px`, '--gz-float-bottom': `${innerHeight - r.bottom + W.EDGE}px`, '--gz-float-width': `${Math.max(0, r.W - 2 * W.EDGE)}px`, '--gz-float-height': `${Math.max(0, r.H - 2 * W.EDGE)}px` })) {
      if (floats.style.getPropertyValue?.(k) !== v) floats.style.setProperty(k, v);
    }
    for (const x of list) {
      const { el } = tiles.get(x.id);
      if (floatsStacked) { el.removeAttribute('style'); continue; }
      for (const [k, v] of Object.entries({ left: `${r.left + res.at[x.id].left}px`, top: `${r.top + res.at[x.id].top}px`, width: `${widthOf(x)}px`, zIndex: String(1000 + x.z) })) if (el.style[k] !== v) el.style[k] = v;
    }
  };

  // ---- the feature hub and the tour ----------------------------------------------------------------------------
  // "What Glaze can do": every Canvas extra with its switch, the tour, reporting a problem and the editor. Opened by the
  // student only (the command palette, or the Dashboard's button): nothing here opens by itself.
  let hubBox = null;
  const hub = () => {
    if (!validContext()) return;
    hubBox?.remove();
    const opener = document.activeElement; // where the tour gives focus back to when it ends
    const s = ctx.settings();
    const set = (k, v) => { try { chrome.storage.sync.set({ version: 2, enhance: { ...ctx.settings().enhance, [k]: v } }); } catch { /* reloaded */ } };
    // Dark documents is a choice of docPages (darkDocs is only read once, from an older Glaze): on as the documents'
    // own button turns it on, dimmed, and off plain.
    const isOn = (e, k) => (k === 'darkDocs' ? !!e && e.docPages !== 'plain' : !!e?.[k]);
    const close = () => hubBox?.close();
    const report = make('a', { className: 'gz-w-btn', textContent: t('Report a problem'), target: '_blank', rel: 'noopener noreferrer',
      href: W.feedback({ version: chrome.runtime.getManifest().version, ua: navigator.userAgent, lang: ctx.locale(), lms: ultra ? 'Blackboard Ultra' : 'Canvas' }) });
    report.title = t('Opens a new GitHub issue with your Glaze version and browser filled in. GitHub receives that text when the page opens; nothing is posted until you submit it.');
    const tourBtn = button(t('Take the tour'), () => { close(); tour(opener); }, { className: 'gz-w-btn gz-w-main' });
    const editor = button(t('Glaze settings'), () => { try { chrome.runtime.sendMessage('options'); } catch { /* reloaded */ } });
    hubBox = make('dialog', { id: 'gz-hub', className: 'gz-w-dialog' },
      make('header', { className: 'gz-w-row' }, make('h2', { id: 'gz-hub-h', textContent: t('What Glaze can do') }), button('×', close, { className: 'gz-w-icon', ariaLabel: t('Close') })),
      make('p', { className: 'gz-w-faint', textContent: t('Switch any of these on or off. Everything runs on this device; the editor has the details.') }),
      ...(ultra ? HUB_ULTRA : HUB).map(([group, keys]) => make('fieldset', {}, make('legend', { textContent: t(group) }),
        ...keys.map((k) => {
          const box = make('input', { type: 'checkbox', checked: isOn(s.enhance, k) });
          box.setAttribute('role', 'switch');
          box.dataset.key = k;
          box.addEventListener('change', () => (k === 'darkDocs' ? set('docPages', box.checked ? 'dim' : 'plain') : set(k, box.checked)));
          return make('label', { className: 'gz-w-check' }, box, make('span', { textContent: t(EXTRA[k]) }));
        }))),
      make('footer', { className: 'gz-w-row' }, tourBtn, report, editor));
    hubBox.setAttribute('aria-labelledby', 'gz-hub-h');
    const sync = (ch, a) => { if (a === 'sync' && ch.enhance) for (const b of hubBox.querySelectorAll('input[data-key]')) b.checked = isOn(ch.enhance.newValue, b.dataset.key); };
    try { chrome.storage.onChanged.addListener(sync); } catch { /* reloaded */ }
    hubBox.addEventListener('close', () => { try { chrome.storage.onChanged.removeListener(sync); } catch { /* reloaded */ } hubBox.remove(); hubBox = null; });
    hubBox.addEventListener('click', (e) => { if (e.target === hubBox) close(); });
    document.body.append(hubBox);
    hubBox.showModal();
  };
  // A few steps over what's on this page, each pointing at its part; a step whose part isn't here is skipped. Esc,
  // End tour or the last step's Finish ends it; nothing is kept.
  const STEPS = [
    ['#gz-dash', 'Your notes and widgets. Edit layout lets you add, move and resize them; any of them can float over every Canvas page.'],
    ['#gz-todo, #right-side .Sidebar__TodoListContainer, #right-side .todo-list-header', "Your To Do. Glaze's Better To Do can take its place, grouped by day, with your own tasks and plans."],
    ['#DashboardCard_Container .ic-DashboardCard', "Your course cards. Each card's menu gives it a color, a picture and bookmarks."],
    [null, 'Press Ctrl+K (⌘K on a Mac) anywhere in Canvas to jump to a course, a page or a Glaze setting.'],
    [null, "Glaze's button in your browser's toolbar has your Looks and palettes, and What Glaze can do is in Ctrl+K whenever you want it."],
  ];
  const STEPS_ULTRA = [
    ['#gz-panel', 'Your notes and widgets. Edit layout adds them and moves them anywhere on this page; your Dashboard has a layout of its own.'],
    ['#gz-todo, div.todo-panel bb-todo', "Your To Do. Glaze's Better To Do can take its place, grouped by day, with your own tasks and plans."],
    [null, 'Press Ctrl+K (⌘K on a Mac) anywhere in Blackboard to jump to a course, a page or a Glaze setting.'],
    STEPS[4],
  ];
  // `from`: what had focus when the hub opened (the Dashboard's button, or whatever the command palette was opened from).
  const tour = (from) => {
    const here = ultra ? STEPS_ULTRA : STEPS;
    const steps = here.map(([sel, text]) => [sel && [...document.querySelectorAll(sel)].find((e) => e.getClientRects().length), text]).filter(([el], i) => el || !here[i][0]);
    let i = 0;
    const ring = make('div', { className: 'gz-tour-ring' });
    const text = make('p', { id: 'gz-tour-text' });
    const n = make('p', { className: 'gz-w-faint' });
    const backBtn = button(t('Back'), () => show(i - 1));
    const nextBtn = button(t('Next'), () => (i === steps.length - 1 ? end() : show(i + 1)), { className: 'gz-w-btn gz-w-main' });
    const bubble = make('div', { className: 'gz-tour gz-w-dialog', tabIndex: -1 }, text, n, make('div', { className: 'gz-w-row' }, button(t('End tour'), () => end(), { className: 'gz-w-small' }), backBtn, nextBtn));
    bubble.setAttribute('role', 'dialog');
    bubble.setAttribute('aria-labelledby', 'gz-tour-text');
    const key = (e) => { if (e.key === 'Escape') { e.preventDefault(); end(); } };
    // The bubble held focus, so removing it left focus on <body>: it goes back to where the tour was started from, or to the
    // Dashboard's What Glaze can do button when that is gone (the palette closes), and stays where it is if neither is.
    const end = () => {
      ring.remove(); bubble.remove(); document.removeEventListener('keydown', key, true);
      [from, hubButton].find((e) => e && e !== document.body && e.isConnected)?.focus({ preventScroll: true });
    };
    const show = (k) => {
      i = k;
      const [el, words] = steps[i];
      text.textContent = t(words);
      n.textContent = t('{step} of {steps}', { step: i + 1, steps: steps.length });
      backBtn.disabled = i === 0;
      nextBtn.textContent = t(i === steps.length - 1 ? 'Finish' : 'Next');
      ring.hidden = !el;
      if (el) {
        el.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
        const r = el.getBoundingClientRect();
        Object.assign(ring.style, { left: `${r.left + scrollX - 6}px`, top: `${r.top + scrollY - 6}px`, width: `${r.width + 12}px`, height: `${r.height + 12}px` });
        const below = r.bottom + 220 < innerHeight;
        Object.assign(bubble.style, { position: 'absolute', left: `${Math.max(12, Math.min(innerWidth - 372, r.left)) + scrollX}px`, top: `${(below ? r.bottom + 14 : Math.max(12, r.top - 200)) + scrollY}px`, transform: '' });
      } else Object.assign(bubble.style, { position: 'fixed', left: '50%', top: '30%', transform: 'translateX(-50%)' });
      bubble.focus();
    };
    document.addEventListener('keydown', key, true);
    document.body.append(ring, bubble);
    show(0);
  };

  // ---- starting and stopping ------------------------------------------------------------------------------------
  let cardPrefs = null, prefsRead = 0;
  const readPrefs = async () => {
    const n = ++prefsRead, r = await get('sync', ['widgets', 'card']);
    if (r.card !== undefined && !globalThis.GZ_CARDS) await ctx.need('lib/cards.js', () => globalThis.GZ_CARDS).catch(() => {});
    if (n !== prefsRead) return;
    o = GZ_SANITIZE({ widgets: r.widgets }).widgets;
    cardPrefs = globalThis.GZ_CARDS?.settings(r.card) || ctx.settings().card || null;
  };
  const onStore = (ch, a) => {
    if (a === 'sync' && ch.widgets) readPrefs().then(() => { for (const x of tiles.values()) if (shown(x.el)) x.update?.(); });
    if (a === 'sync' && ch.card) readPrefs().then(() => { cancelAnimationFrame(frame0); frame0 = requestAnimationFrame(() => { if (on && board && !asleep) layoutBoard(); }); });
    // Another tab's change (this tab's own come back as the worker's answer).
    if (a === 'local' && ch.widgetLayout) { layoutRead++; if (!flying && lay) adopt(ch.widgetLayout.newValue); }
  };
  const onShow = () => cover();
  const onResize = () => { if (!on || !lay) return; if (board && !asleep) layoutBoard(); placeFloats(); };
  // Another document took the screen (a course tab over this page, or this frame hidden): each tile keeps what is typed
  // and stops what only shows (suspend, else sleep); back on screen, what changed meanwhile is drawn, and each wakes.
  const cover = () => {
    const hiddenNow = document.visibilityState === 'hidden';
    const now = hiddenNow || covered();
    if (now === asleep && hiddenNow === fullyHidden) return;
    asleep = now;
    fullyHidden = hiddenNow;
    if (asleep) {
      gesture?.cancel();
      cancelAnimationFrame(frame0);
      cancelAnimationFrame(floatFrame);
      ro?.disconnect();
      if (document.visibilityState === 'hidden') { floatRO?.disconnect(); floatWatched.clear(); }
      owed = true;
      for (const x of tiles.values()) try { if (!shown(x.el)) (x.suspend || x.sleep)?.(); else (x.resume || x.wake)?.(); } catch { /* one tile's fault stays its own */ }
      return;
    }
    if (on && lay && owed) draw();
    for (const x of tiles.values()) if (shown(x.el)) try { (x.resume || x.wake)?.(); } catch { /* one tile's fault stays its own */ }
  };
  const start = async () => {
    await ctx.need('lib/widgets.js', () => globalThis.GZ_WIDGETS);
    W = globalThis.GZ_WIDGETS;
    const [r] = await Promise.all([get('local', ['widgetLayout', 'widgetsHidden']), readPrefs()]);
    rawLay = r.widgetLayout;
    declare(globalThis.GZ_MODS?.tiles() || {});
    declare(globalThis.GZ_MODWIDGETS?.tiles() || {}, 'plain');
    lay = W.layout(r.widgetLayout, MORE);
    hidden = r.widgetsHidden === true;
    // With the sidebar on, its record first, so a docked widget never shows on a board first.
    if ((atTop || ctx.tabFrame) && ctx.settings().enhance.sidebar) await ctx.need('features/sidebar.js', () => globalThis.GZ_SIDEBAR_UI).then(() => GZ_SIDEBAR_UI.ready()).catch(() => {});
    try { chrome.storage.onChanged.addListener(onStore); } catch { /* reloaded */ }
    document.addEventListener('visibilitychange', onShow);
    addEventListener('resize', onResize);
  };
  const contextChanged = () => {
    const account = globalThis.GZ_SIDEBAR_UI?.context().accountId || '';
    if (sideAccount && account !== sideAccount) {
      identity++;
      me = asking = null;
      teardown(true);
      drawn = null;
    }
    sideAccount = account;
    if (on && W && lay) draw();
  };
  // If it can't start (the extension reloaded under the tab), the page stays as Canvas has it; it tries again after a minute.
  const sync = (want) => {
    on = !!want;
    board = atTop || ctx.tabFrame === 'page' ? boardOf() : null;
    // The wandering buddy is the page's: not again in the frame Canvas's pages outside a course open in.
    if (!atTop) { /* the page around has it */ }
    else if (globalThis.GZ_PET_UI?.resume) GZ_PET_UI.resume();
    else if (ctx.settings().enhance.pet && on && !petResumeReady && !(loadingMore.get('pet') > Date.now())) {
      loadingMore.set('pet', Infinity);
      ctx.need('features/pet.js', () => globalThis.GZ_PET_UI).then(() => { petResumeReady = true; loadingMore.delete('pet'); globalThis.GZ_PET_UI?.resume?.(); }, () => loadingMore.set('pet', Date.now() + 60000));
    }
    if (!on) { teardown(true); drawn = null; return; }
    if (globalThis.GZ_SIDEBAR_UI && !heard) {
      heard = true;
      const again = () => { if (on && W && lay) draw(); };
      GZ_SIDEBAR_UI.on('change', again);
      GZ_SIDEBAR_UI.on('context', contextChanged);
    }
    if (!starting) starting = start().then(() => { draw(); fillCourses(); }, () => {
      if (on && board === 'dash') document.documentElement.setAttribute('data-gz-dash', 'ip');
      setTimeout(() => { starting = null; }, 60000);
    });
    else if (W && lay) {
      if (board) { globalThis.GZ_COURSE_CARDS?.sync(coursesChanged); fillCourses(); }
      // A pass: draw only when something changed (a switch let a tile in or out, Canvas redrew the Dashboard), so the
      // page's observer isn't fed changes of Glaze's own.
      const h = home();
      const want = wanted(!!h);
      if (sideNow() !== side) { draw(); return; }
      if (drawn !== board || want.map((x) => x.id).sort().join() !== [...tiles.keys()].sort().join() || (h ? !grid || !placed(h) : grid?.isConnected)
        || (!board && want.some((x) => x.float) && !floats?.isConnected)) draw();
      else {
        remindIn();
        todoIn();
        placeFloats();
        // Ultra draws its page's header again as it likes: the Dashboard's tabs go back in.
        if (board === 'dash') globalThis.GZ_DASH_UI?.tabs(grid);
      }
    }
  };
  // The hub can open with the widgets off: it needs only this file and lib/widgets.js.
  const open = () => !validContext() ? Promise.resolve() : ctx.need('lib/widgets.js', () => globalThis.GZ_WIDGETS).then(() => { W ||= globalThis.GZ_WIDGETS; hub(); });

  // A tile from another file (MORE), called as that file runs: fill(body, api) gives { wake?, update?, stop? }, as the
  // built-in ones do; the first registration of an id wins. api: who() (the account: { uid, tz }), site, size(). The
  // grid draws it once its file is in (wanted).
  const register = (id, fill) => { if (MORE[id] && !added.has(id) && typeof fill === 'function') added.set(id, fill); };
  // The code mods' tiles now: { id: { name, size, fill } }, replacing the ones declared before. A tile whose mod stopped goes
  // from the board; the worker keeps its stored place even when another tab edits without the mod running.
  let modSig = '';
  // Two sources: code mods (features/mods.js) and declarative widgets (features/modwidgets.js), each replacing its own.
  const modSources = { mods: {}, plain: {} };
  const declare = (next, from = 'mods') => { modSources[from] = next; join({ ...modSources.mods, ...modSources.plain }); };
  const join = (next) => {
    const signature = (v) => v && [v.name, v.size, v.owner];
    const sig = JSON.stringify(Object.entries(next).map(([k, v]) => [k, signature(v)]));
    if (sig === modSig) return;
    modSig = sig;
    for (const id of new Set([...modTiles, ...Object.keys(next)])) {
      if (JSON.stringify(signature(MORE[id])) === JSON.stringify(signature(next[id]))) continue;
      const x = tiles.get(id);
      x?.stop?.(); x?.el.remove(); tiles.delete(id);
    }
    for (const id of modTiles) if (!Object.hasOwn(next, id)) { delete MORE[id]; added.delete(id); modTiles.delete(id); }
    for (const [id, v] of Object.entries(next)) {
      if (id === 'pet' || (MORE[id] && !modTiles.has(id))) continue;
      MORE[id] = { name: v.name, size: v.size, owner: v.owner };
      added.set(id, v.fill);
      modTiles.add(id);
    }
    if (W && lay) { lay = W.layout(rawLay, MORE); if (on) draw(); }
  };

  const avatar = (body, options = {}) => {
    let alive = true, sleeping = false, live, pose;
    ctx.need('lib/widgets.js', () => globalThis.GZ_WIDGETS).then(() => {
      if (alive && validContext() && body.isConnected !== false) { W ||= globalThis.GZ_WIDGETS; live = WIDGETS.buddy(body, options); if (sleeping) live.sleep(); if (pose) live.play(...pose); }
    }).catch(() => {});
    return { wake: () => { sleeping = false; live?.wake(); }, sleep: () => { sleeping = true; live?.sleep(); }, play: (state, direction) => { pose = [state, direction]; live?.play(state, direction); }, stop: () => { alive = false; live?.stop(); } };
  };
  // For the sidebar's Add widgets: each widget that can dock here, with where it is now.
  const catalog = () => {
    if (!W || !lay || !side) return [];
    const at = placement();
    return [...new Set([...W.TILES, ...Object.keys(MORE)])].filter((id) => dockable(id) && allowed(id)).map((id) => ({ id, name: t(nameOf(id)), where: at.get(id)?.where || 'off' }));
  };
  return { sync, cover, hub: open, register, declare, who: account, avatar, catalog };
})();

GZ_WIDGETS_UI;
