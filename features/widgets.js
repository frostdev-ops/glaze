// Dashboard notes, widgets and the feature hub (Canvas and Blackboard Ultra), loaded on demand. The site's part
// (syncWidgets) calls sync(on) from its passes while enhance.notes or enhance.widgets is on, in the top frame, and the
// command palette calls hub(). Other files add tiles: MORE, then register().
// Canvas: the Dashboard gets a grid of tiles under its heading (notes, agenda, focus timer, quote, music, breathe, study
// buddy), each small, medium or large, in the order the student puts them; any tile can float instead, over every page
// of the site, dragged with the pointer or moved with the arrow keys.
// Blackboard Ultra has two boards, each its own layout of free tiles (B7b): the Courses page, where they float over the
// page and start where Glaze's panel was, at the top of its right column (the panel keeps its bar there and makes room
// for them), and the Dashboard, Glaze's page on Ultra's Institution page (features/dashboard.js has its tabs). Edit
// layout lets the tiles move: dragged by their heading or moved with the arrow keys on their handle, they snap to the
// grid, the room's edges, each other and Ultra's column, with a guide while dragging; Alt places freely. A window too
// narrow for the layout stacks them in a column instead, and keeps the layout. The logic is lib/widgets.js.
// What it asks Canvas for: the student's profile (id and time zone, shared with the other extras) and,
// for the agenda, their planner items for a day Better To Do's copy doesn't cover; Ultra: who's signed in (/users/me)
// and, for the agenda, that day's To Do and calendar with their submissions (lib/ultra.js). The music player is the one other
// address, and only after the student clicks Load player. Nothing here polls: each clock is one setTimeout to its next
// change, and only while the page is shown. Loaded on demand: a second injection into the same frame keeps the first.
var GZ_WIDGETS_UI = globalThis.GZ_WIDGETS_UI || (() => {
  const ctx = globalThis.GZ_CTX;
  const t = (k, v) => ctx.t(k, v);
  const NAMES = { notes: 'Notes', agenda: 'Agenda', timer: 'Focus timer', quotes: 'Quote', music: 'Music', breathe: 'Breathe', buddy: 'Study buddy', todo: 'To Do' };
  // Tiles other files add, the same on both sites: { id: { file, name (an English key for t()), size } }. This file
  // loads the file (need) while its tile is on, and the file calls register(id, fill). Off until the student adds it.
  const MORE = { pet: { file: 'features/pet.js', name: 'Pet habitat', size: 'm' } };
  const loadingMore = new Map(); // id -> retry time, Infinity while loading
  const added = new Map(); // id -> fill(body, api), from register()
  const nameOf = (id) => NAMES[id] || MORE[id]?.name || globalThis.GZ_COURSE_CARDS?.title(id) || id;
  const ultra = ctx.site === 'ultra';
  const SIZE_NAMES = { s: 'Small', m: 'Medium', l: 'Large' };
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
  let on = false, starting = null, editing = false;
  let me = null; // { uid, tz }
  // bar: a board's buttons (Edit layout, Reminders, Insights, What Glaze can do; on the Courses page, Hide widgets too),
  // in the Courses page's header (#gz-toolbar) or atop the Dashboard's grid. hidden: Hide widgets, on this device.
  let grid = null, floats = null, panel = null, bar = null, hidden = false;
  // Ultra's boards: which one this page is ('courses', 'dash' or null), the one drawn, and the Courses page's layer the
  // tiles float in (the Dashboard's tiles are in its own room, the grid).
  let board = null, drawn = null, room = null;
  const tiles = new Map(); // id -> { el, body, wake?, stop?, update? }

  const make = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids.filter((k) => k != null && k !== false)); return e; };
  const button = (text, run, props = {}) => { const b = make('button', { type: 'button', className: 'gz-w-btn', textContent: text, ...props }); b.addEventListener('click', run); return b; };
  const area = (a) => { try { return chrome.storage[a]; } catch { return null; } };
  const get = (a, keys, failed = {}) => new Promise((res) => { try { area(a).get(keys, (r) => res(chrome.runtime.lastError ? failed : r || {})); } catch { res(failed); } });
  // This device's own small items (widgetsHidden, widgetBuddy); the layout and the timer go through the worker.
  const put = (v) => { try { area('local').set(v); } catch { /* reloaded under the tab */ } };
  const send = (m) => new Promise((res) => { try { chrome.runtime.sendMessage(m, (r) => res(chrome.runtime.lastError ? null : r)); } catch { res(null); } });
  // A reload can invalidate a callback before the core sees its first DOM mutation.
  const validContext = () => { try { return !!chrome.runtime.id; } catch { return false; } };
  const shown = () => document.visibilityState === 'visible';
  const lang = () => GZ_I18N.locale(ctx.locale());
  // The Courses page's board is there with the widgets, notes or pet; the Dashboard with its own switch (on by default).
  const boardOf = () => {
    const e = ctx.settings().enhance;
    if (!ultra) return null;
    if (/^\/ultra\/course\/?$/.test(location.pathname)) return e.widgets || e.notes || e.pet ? 'courses' : null;
    return e.dashboard && /^\/ultra\/institution-page\/?$/.test(location.pathname) ? 'dash' : null;
  };
  // Where the grid goes: under Canvas's Dashboard heading; on Ultra's Courses page, first in its right column (or, at a
  // school without Ultra's To Do, above the courses); on its Institution page, before Ultra's own page.
  const home = () => (ultra ? board === 'courses' ? document.querySelector('div.todo-panel') || document.querySelector('div.courses-panel')
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
  // Better To Do's tile: on Ultra's Dashboard only, with its switch (it has its own place everywhere else: one copy).
  // The Dashboard is its own switch: its widgets need no other, but the notes and the pet keep theirs.
  const allowed = (id) => {
    if (W?.course(id)) return ultra && !!board && W.course(id).origin === location.origin;
    const e = ctx.settings().enhance;
    return id === 'todo' ? ultra && !!board && e.todo : id === 'pet' ? e.pet : id === 'notes' ? e.notes : e.widgets || (ultra && (board === 'dash' || (e.dashboard && fl(id))));
  };
  // A change to the layout (lib/widgets.js apply): shown here at once, and sent to the worker, which applies it to what
  // is stored then, so another tab's change made since is kept. While changes are on their way, the stored layout that
  // comes back is the worker's answer to the last one; one that couldn't be saved is put back as stored.
  let flying = 0, layoutRead = 0;
  const DECLARED = Object.fromEntries(Object.entries(MORE).map(([k, v]) => [k, { size: v.size }]));
  const adopt = (raw) => { const next = W.layout(raw, MORE); if (JSON.stringify(next) !== JSON.stringify(lay)) { lay = next; draw(); } };
  const change = (m) => {
    layoutRead++;
    lay = W.apply(lay, m, MORE);
    draw();
    flying++;
    send({ type: 'glaze:widgetLayout', more: DECLARED, ...m }).then(() => {
      if (--flying) return;
      // Callbacks can arrive backwards; reread storage instead of adopting the last callback's older snapshot.
      const n = ++layoutRead;
      get('local', 'widgetLayout', null).then((x) => { if (x && !flying && n === layoutRead) adopt(x.widgetLayout); });
    });
  };
  // Who's signed in (their id names their notes; their Canvas time zone counts the agenda's days), asked only when a
  // tile needs it: a page with nothing of theirs to show asks Canvas nothing. A failed ask is asked again next time.
  let asking = null;
  // Ultra shares the planning features' profile (the browser's time zone counts).
  const profile = () => (ultra ? ctx.need('lib/ultra.js', () => globalThis.GZ_ULTRA).then(() => GZ_ULTRA.page.profile()) : ctx.profile());
  const who = () => (asking ||= profile().then((p) => {
    if (!/^(\d+|_\d+_\d+)$/.test(String(p?.id))) throw new Error('no profile');
    let tz;
    try { tz = p.time_zone && new Intl.DateTimeFormat('en', { timeZone: p.time_zone }).resolvedOptions().timeZone; } catch { /* the browser's */ }
    me = { uid: String(p.id), tz: tz || undefined };
  }).catch((e) => { asking = null; throw e; }));

  // ---- the tiles ---------------------------------------------------------------------------------------------
  // Each widget fills its tile's body once; wake() runs when the page is shown again, update() when settings change,
  // stop() when the tile goes.
  const WIDGETS = {
    notes(body) {
      // note: the last saved (or stored) text; draft: the newest typed, stamped when typed, until a save confirms that very
      // draft. Shown is the draft while there is one.
      let key = '', note = { text: '', at: 0 }, draft = null, wait = 0, busy = false, tries = 0;
      const view = make('div', { className: 'gz-w-note-view', tabIndex: 0 });
      view.setAttribute('role', 'button');
      view.setAttribute('aria-label', t('Edit notes'));
      const text = make('textarea', { className: 'gz-w-note', placeholder: t('Notes for yourself. Links work.'), maxLength: W.NOTES_MAX, hidden: true });
      text.setAttribute('aria-label', t('Notes'));
      const status = make('p', { className: 'gz-w-status', role: 'status' });
      const shown = () => (draft || note).text;
      // The note only ever moves forward: whatever comes in (storage, another tab, a save's answer) replaces it only if newer.
      const newer = (x) => { if (x && x.at > note.at) note = x; };
      const render = () => {
        view.replaceChildren(...(shown() ? W.links(shown()).map((p) => (p.href ? make('a', { href: p.href, textContent: p.text, target: '_blank', rel: 'noopener noreferrer' }) : p.text))
          : [make('span', { className: 'gz-w-faint', textContent: t('Notes for yourself. Links work.') })]));
      };
      const edit = () => { view.hidden = true; text.hidden = false; text.value = shown(); text.focus(); text.setSelectionRange(text.value.length, text.value.length); };
      // A draft stays until the worker confirms that draft (a confirmation of an older one confirms only that); a failed
      // save is tried again on blur, on leaving the page and when the tile goes, three times per draft at most. One save
      // at a time: a draft typed while one is on its way goes as soon as it's answered.
      const fail = () => { status.textContent = t("Couldn't save your notes. They're still here; try again in a moment."); };
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
          status.textContent = '';
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
      return { wake: () => { if (!key) load(); }, stop: () => { save(); removeEventListener('pagehide', leave); try { chrome.storage.onChanged.removeListener(onStore); } catch { /* reloaded */ } } };
    },

    agenda(body) {
      let L = null, day = null, data = null, cache = null, alive = true;
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
        if (!L) return;
        const n = ++asked;
        title.textContent = dayName(day);
        home.hidden = day === today();
        let rows;
        try { rows = W.agenda(L, { items: await items(day), data, day, tz: me.tz, extra: classRows(day) }); } catch { rows = null; }
        if (n !== asked) return;
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
        const r = await get('local', [k, 'todoCache', ckey]);
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
      let s = W.IDLE, tick = 0, audio = null, alive = true;
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
        return send({ type: 'glaze:widgetTimer', op }).then((r) => {
          if (r?.ok && r.timer) { if (n === asked && at === heard) { s = W.cleanTimer(r.timer); run(); } say.textContent = ''; return; }
          if (op !== 'advance') say.textContent = t("Couldn't change the timer. Nothing changed; try again in a moment.");
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
      // One timeout to the next second shown, while it runs and the page is shown. A phase that ended while away moves
      // on quietly; one ending now rings (if the sound is on) and says so.
      const run = () => {
        clearTimeout(tick);
        tick = 0;
        if (!alive) return;
        const now = Date.now();
        const was = s;
        s = W.advance(s, now, o);
        if (s !== was && shown()) {
          ask('advance');
          if (now - was.end < 2000) { chime(); say.textContent = t(s.phase === 'rest' ? 'Time for a break.' : 'Break over. Ready when you are.'); }
        }
        phase.data = t(s.phase === 'rest' ? 'Break' : 'Focus');
        time.data = W.clock(W.left(s, now, o));
        const label = t(s.end ? 'Pause' : W.left(s, now, o) < W.len(s.phase, o) ? 'Resume' : 'Start');
        if (go.textContent !== label) go.textContent = label;
        body.dataset.running = s.end ? 'yes' : 'no';
        if (s.end && shown()) tick = setTimeout(run, ((s.end - now) % 1000 || 1000) + 5);
      };
      const onStore = (ch, a) => { if (a === 'local' && ch.widgetTimer) { heard++; s = W.cleanTimer(ch.widgetTimer.newValue); run(); } };
      try { chrome.storage.onChanged.addListener(onStore); } catch { /* reloaded */ }
      const at = heard;
      get('local', 'widgetTimer').then((r) => { if (heard === at && !asked) { s = W.cleanTimer(r.widgetTimer); run(); } });
      body.append(make('p', { className: 'gz-w-faint' }, phase), clock, make('div', { className: 'gz-w-row' }, go, reset), say);
      run();
      return { wake: run, update: run, stop: () => { alive = false; clearTimeout(tick); audio?.close?.(); try { chrome.storage.onChanged.removeListener(onStore); } catch { /* reloaded */ } } };
    },

    quotes(body) {
      let step = 0, paused = false, wait = 0;
      const q = make('blockquote', { className: 'gz-w-quote' });
      const list = () => QUOTES.filter(([k]) => o.quotes === 'all' || k === o.quotes);
      const pause = button(t('Pause'), () => { paused = !paused; show(); });
      const show = () => {
        clearTimeout(wait);
        const all = list();
        const now = Date.now();
        q.textContent = t(all[W.quoteAt(all.length, now, o.quoteMode, o.quoteEvery, step)][1]);
        pause.hidden = o.quoteMode !== 'cycle';
        pause.textContent = t(paused ? 'Play' : 'Pause');
        pause.setAttribute('aria-pressed', String(paused));
        if (o.quoteMode === 'cycle' && !paused && shown()) wait = setTimeout(show, o.quoteEvery * 1000 - (now % (o.quoteEvery * 1000)) + 5);
      };
      const prev = button('‹', () => { step--; show(); }, { className: 'gz-w-icon' });
      const next = button('›', () => { step++; show(); }, { className: 'gz-w-icon' });
      prev.setAttribute('aria-label', t('Previous quote'));
      next.setAttribute('aria-label', t('Next quote'));
      body.append(q, make('div', { className: 'gz-w-row' }, prev, pause, next));
      show();
      return { wake: show, update: show, stop: () => clearTimeout(wait) };
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
      return { wake: () => { if (!shown() && t0) stop(); }, stop: () => clearTimeout(wait) };
    },

    // Better To Do on Ultra's Dashboard: the place features/todo.js puts its list (right before this spot), as it does
    // before Ultra's own To Do on the Courses page. The list is its own; the tile only holds it.
    todo(body) {
      body.append(make('div', { className: 'gz-w-todo-spot' }));
      return {};
    },

    // Every pet surface uses this character, account record and the same timer/task reactions.
    buddy(body, options = {}) {
      let st = { happyAt: 0, patAt: 0, running: false }, wait = 0, todoKey = '', petKey = '', alive = true, sleeping = false, player = null, sprite = '';
      const saved = {}, versions = new Map();
      const img = make('img', { alt: '', draggable: false, decoding: 'async' });
      const read = (keys) => {
        const before = keys.map((k) => versions.get(k));
        return get('local', keys).then((r) => {
          if (!alive || !validContext()) return;
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
        if (pet.isConnected === false) { stop(); return; }
        const P = globalThis.GZ_PET, S = globalThis.GZ_PET_SPRITES;
        const data = P?.view(saved[petKey]);
        options.onData?.(data);
        const m = W.mood(st, Date.now());
        const choice = typeof saved.petCharacter === 'string' ? saved.petCharacter : data?.sprite || (['cat', 'bunny'].includes(ctx.settings().card?.pet) ? ctx.settings().card.pet : '');
        const selected = S?.picture(choice, saved.petSprites);
        const label = selected ? t('Play with {name}', { name: selected.name }) : t('Pet your study buddy');
        pet.setAttribute('aria-label', label);
        const identity = selected?.data || selected?.path || '';
        if (identity !== sprite) {
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
        player?.rest(m.mood === 'happy' ? 'jumping' : st.running ? 'running' : m.mood === 'sleepy' ? 'waiting' : 'idle');
        if (body.dataset.mood !== (m.mood || 'awake')) body.dataset.mood = m.mood || 'awake';
        if (sleeping || document.visibilityState === 'hidden') player?.sleep(); else player?.wake();
        if (m.until && !sleeping && document.visibilityState !== 'hidden') wait = setTimeout(paint, m.until - Date.now() + 50);
      };
      const win = () => { st.happyAt = Date.now(); put({ widgetBuddy: { happyAt: st.happyAt, patAt: st.patAt } }); paint(); };
      const pat = (state = 'waving') => {
        if (!alive || !validContext()) return;
        st.patAt = Date.now();
        put({ widgetBuddy: { happyAt: st.happyAt, patAt: st.patAt } });
        paint();
        player?.set(state);
        const w = make('span', { className: 'gz-w-cheer', textContent: t(CHEERS[Math.floor(Math.random() * CHEERS.length)]) });
        w.setAttribute('aria-hidden', 'true');
        pet.after(w);
        setTimeout(() => w.remove(), 1600);
      };
      const pet = options.interactive === false ? make('span', { className: 'gz-w-pet' }) : button('', () => pat(), { className: 'gz-w-pet' });
      pet.setAttribute('aria-label', t('Pet your study buddy'));
      pet.append(img);
      if (options.interactive !== false) {
        pet.addEventListener('keydown', (e) => { if (e.isTrusted && ['Enter', ' '].includes(e.key)) { e.preventDefault(); e.stopPropagation(); pat('jumping'); } });
        pet.addEventListener('pointermove', (e) => {
          if (!e.isTrusted || !player || (globalThis.GZ_PET_SPRITES?.BUILTIN[choiceId()]?.spriteVersionNumber || saved.petSprites?.[choiceId()]?.spriteVersionNumber) !== 2) return;
          const rect = pet.getBoundingClientRect(); player.set('look', GZ_PET_SPRITES.direction(e.clientX - rect.left - rect.width / 2, e.clientY - rect.top - rect.height / 2));
        });
        pet.addEventListener('pointerleave', () => player?.set('idle'));
      }
      const choiceId = () => typeof saved.petCharacter === 'string' ? saved.petCharacter : globalThis.GZ_PET?.view(saved[petKey])?.sprite || '';
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
      };
      try { chrome.storage.onChanged.addListener(onStore); } catch { /* reloaded */ }
      body.append(pet);
      const show = () => paint();
      const stop = () => {
        if (!alive) return;
        alive = false; clearTimeout(wait); player?.stop();
        try { chrome.storage.onChanged.removeListener(onStore); } catch { /* reloaded */ }
        document.removeEventListener?.('visibilitychange', show); removeEventListener('pagehide', stop);
      };
      document.addEventListener('visibilitychange', show); addEventListener('pagehide', stop, { once: true });
      read(['widgetTimer', 'widgetBuddy', 'petCharacter', 'petSprites']);
      who().then(() => {
        if (!alive || !validContext()) return;
        todoKey = `todo:${location.origin}/${me.uid}`; petKey = `pet:${location.origin}/${me.uid}`;
        read([petKey]);
      }, () => {});
      Promise.all(['lib/pet.js', 'lib/petsprites.js', 'lib/petplayer.js'].map((file) => ctx.need(file, () => ({ 'lib/pet.js': globalThis.GZ_PET, 'lib/petsprites.js': globalThis.GZ_PET_SPRITES, 'lib/petplayer.js': globalThis.GZ_PET_PLAYER })[file]))).then(paint, () => {});
      Promise.resolve().then(paint);
      return { wake: () => { sleeping = false; paint(); }, sleep: () => { sleeping = true; clearTimeout(wait); player?.sleep(); }, update: paint, play: (state) => player?.set(state), stop };
    },
  };

  // ---- the grid, the boards and the floating layer -------------------------------------------------------------
  const tileEl = (id) => {
    const name = t(nameOf(id));
    const el = make('section', { className: 'gz-w' });
    el.dataset.id = id;
    el.dataset.tile = id;
    el.setAttribute('aria-label', name);
    // Canvas: a handle to move it by. Ultra: the tile itself (dragged anywhere while editing, by its heading while it
    // floats, the arrow keys once it has the focus), and its corner to resize it by.
    const grip = !ultra && button('', () => {}, { className: 'gz-w-grip' });
    if (grip) {
      grip.setAttribute('aria-label', t('Move {name}: arrow keys', { name }));
      grip.title = t('Drag to move, or use the arrow keys');
    }
    const head = make('header', { className: 'gz-w-head' }, grip, make('h3', { textContent: name }));
    const tools = make('div', { className: 'gz-w-tools' });
    const body = make('div', { className: 'gz-w-body' });
    const corner = ultra && button('', () => {}, { className: 'gz-w-resize' });
    if (corner) {
      corner.setAttribute('aria-label', t('Resize {name}: arrow keys', { name }));
      corner.title = t('Drag to resize, or use the arrow keys. Double-click for its own size.');
    }
    el.append(head, tools, body);
    if (corner) el.append(corner);
    drag(el, head, grip, id);
    if (corner) resizer(el, body, corner, id);
    return { el, head, tools, body };
  };
  // Floating: on Ultra, over every Blackboard page (lay.boards.pages, then on no board); on Canvas, over every page.
  const fl = (id) => (ultra ? !!lay.boards.pages.find((x) => x.id === id)?.on : !!lay.tiles.find((x) => x.id === id)?.float);
  // The tile as this page keeps it: floating on Ultra, the board's, or Canvas's.
  const cur = (id) => (ultra && fl(id) ? lay.boards.pages : board ? lay.boards[board] : lay.tiles).find((x) => x.id === id);
  // Its width on Ultra: as the student resized it, else its size's.
  const widthOf = (x) => x.w || W.WIDTH[x.size];
  // Ultra: a board's tile goes to float over every page, from the room's bottom right corner clear of the others (its
  // board keeps its spot), or comes back to this page's board (on a page without one, the Courses page's).
  const floatOut = (id) => {
    const r = floatRoom(), x = cur(id);
    const others = [...tiles].filter(([k]) => k !== id && fl(k)).map(([, v]) => { const b = v.el.getBoundingClientRect(); return { left: b.left - r.left, top: b.top - r.top, w: b.width, h: b.height }; });
    const w = widthOf(x), h = tiles.get(id)?.el.offsetHeight || 200;
    const c = W.corner(others, w, h, r.W, r.H);
    const p = W.place(c.left, c.top, w, h, r.W, r.H, true);
    change({ ops: [{ s: 'pages', id, set: { on: true, size: x.size, fold: x.fold, x: p.x, y: p.y, w: x.w ?? null, h: x.h ?? null }, front: true }], widths: { pages: Math.round(r.W) } });
    tiles.get(id)?.el.focus();
    say(t('{name} floats on every Blackboard page.', { name: t(nameOf(id)) }));
  };
  const backBoard = () => {
    const e = ctx.settings().enhance;
    return board || (e.widgets || e.notes || e.pet ? 'courses' : 'dash');
  };
  const floatBack = (id) => {
    const b = backBoard();
    change({ ops: [{ s: 'pages', id, set: { on: false } }, { s: b, id, set: { on: true } }] });
    say(t(board ? '{name} is back on this page.' : b === 'dash' ? '{name} is back on the Dashboard.' : '{name} is back on the Courses page.', { name: t(nameOf(id)) }));
  };
  // The controls a tile shows: on a board, Fold at any time, and Float and Remove while editing (its corner resizes it);
  // on Canvas, a floating tile its way back and away, and in the grid while editing, order, size and float. A control
  // redrawn by its own click keeps the focus.
  const toolsFor = (x, tile) => {
    const name = t(nameOf(tile.id));
    const label = (b, text) => { b.setAttribute('aria-label', text); b.title = text; return b; };
    const again = (sel, run) => () => { run(); x.tools.querySelector(sel)?.focus(); };
    if (ultra) {
      // Ultra: Fold at any time. Floating over every page: its way back. On a board while editing: float, remove.
      const where = tile.float ? 'pages' : board;
      const fold = label(button(tile.fold ? '▸' : '▾', again('.gz-w-fold', () => change({ ops: [{ s: where, id: tile.id, set: { fold: !tile.fold } }] })), { className: 'gz-w-icon gz-w-fold' }), t(tile.fold ? 'Unfold {name}' : 'Fold {name}', { name }));
      fold.setAttribute('aria-expanded', String(!tile.fold));
      x.body.hidden = tile.fold;
      x.tools.replaceChildren(...(tile.float ? [label(button('⇲', () => floatBack(tile.id), { className: 'gz-w-icon' }), t(board ? 'Put {name} back on this page' : backBoard() === 'dash' ? 'Put {name} back on the Dashboard' : 'Put {name} back on the Courses page', { name }))]
        : editing ? [...(tile.id === 'todo' || W.course(tile.id) ? [] : [label(button('⇱', () => floatOut(tile.id), { className: 'gz-w-icon' }), t('Float {name} on every Blackboard page', { name }))]), label(button('×', () => change({ ops: [{ s: board, id: tile.id, ...(W.course(tile.id) ? { remove: true } : { set: { on: false } }) }] }), { className: 'gz-w-icon' }), t('Remove {name}', { name }))] : []), fold);
      return;
    }
    const size = make('select', { className: 'gz-w-size' }, ...W.SIZES.map((v) => make('option', { value: v, textContent: t(SIZE_NAMES[v]), selected: v === tile.size })));
    size.setAttribute('aria-label', t('Size of {name}', { name }));
    size.addEventListener('change', again('.gz-w-size', () => change({ ops: [{ s: 'canvas', id: tile.id, set: { size: size.value } }] })));
    if (tile.float) {
      x.tools.replaceChildren(
        label(button('⇲', () => change({ ops: [{ s: 'canvas', id: tile.id, set: { float: false } }] }), { className: 'gz-w-icon' }), t('Put {name} back on the Dashboard', { name })),
        label(button('×', () => change({ ops: [{ s: 'canvas', id: tile.id, set: { on: false, float: false } }] }), { className: 'gz-w-icon' }), t('Remove {name}', { name })),
      );
      return;
    }
    if (!editing) { x.tools.replaceChildren(); return; }
    x.tools.replaceChildren(
      label(button('←', () => change({ ops: [{ s: 'canvas', id: tile.id, move: -1 }] }), { className: 'gz-w-icon' }), t('Move {name} earlier', { name })),
      label(button('→', () => change({ ops: [{ s: 'canvas', id: tile.id, move: 1 }] }), { className: 'gz-w-icon' }), t('Move {name} later', { name })),
      size,
      label(button('⇱', () => change({ ops: [{ s: 'canvas', id: tile.id, set: { float: true } }] }), { className: 'gz-w-icon' }), t('Float {name} over every page', { name })),
      label(button('×', () => change({ ops: [{ s: 'canvas', id: tile.id, set: { on: false } }] }), { className: 'gz-w-icon' }), t('Remove {name}', { name })),
    );
  };

  // What is said to a screen reader (a status line in the bar, or the floating layer's).
  let live = null;
  const say = (text) => {
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

  // Moving a tile, on Ultra: on a board while editing, dragged anywhere but its controls; floating, by its heading; or,
  // once it has the focus, by the arrow keys (Shift: further). On Canvas: dragged by its header, or its grip's arrow
  // keys. It snaps to the grid, its room's edges, the other tiles and Ultra's column (lib/widgets.js snap), with a guide
  // on the line it met; Alt places it freely. A floating tile keeps where it is in the room the window leaves; a board's
  // keeps its spot. On Ultra the one pressed goes on top of the others, moved or not.
  let dragged = null; // the grid tile being dragged to a new place in the order
  let lastAt = {}, lastW = 0, stacked = false; // the board's last arrangement (arrange), its room's width, stacked or not
  let floatsStacked = false; // Ultra's floating tiles, stacked at the window's edge (floating)
  let gesture = false; // a tile being dragged or resized: nothing is laid out under the pointer meanwhile
  const ARROWS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  const movable = (id) => (fl(id) ? !(ultra && floatsStacked) : board ? editing && !stacked : false);
  const roomEl = () => (board === 'courses' ? room : grid?.querySelector('.gz-dash-grid'));
  // The room a floating tile has: on Ultra, the window right of the nav, below a course's top bar (B8's course tabs, or
  // anything else marked data-gz-keep-clear, too) and above Glaze's own footer, so it never covers them; on Canvas, the
  // window.
  const floatRoom = () => {
    let left = 0, right = innerWidth, top = 0, bottom = innerHeight;
    const edges = ultra ? [...document.querySelectorAll('.MuiDrawer-paper, #base_tools, div.bb-course-navigation, [data-gz-keep-clear], #gz-footer')] : [];
    if (ultra) {
      for (const e of edges) {
        const r = e.getBoundingClientRect();
        if (!r.width || !r.height) continue;
        if (r.left <= 1 && r.right < innerWidth / 2 && r.height > innerHeight / 2) left = Math.max(left, r.right);
        else if (r.right >= innerWidth - 1 && r.left > innerWidth / 2 && r.height > innerHeight / 2) right = Math.min(right, r.left);
        else if (r.top < innerHeight / 2 && r.bottom > 0) top = Math.max(top, r.bottom);
        else if (r.top > innerHeight / 2) bottom = Math.min(bottom, r.top);
      }
    }
    return { left, right, top, bottom, W: Math.max(0, right - left), H: Math.max(0, bottom - top), edges };
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
  // Ultra: a tile pressed goes on top of the others where it is (a board, or floating), unless it's there already.
  const raise = (id) => {
    const s = fl(id) ? 'pages' : board, list = lay.boards[s] || [], me = list.find((x) => x.id === id);
    if (me && list.some((x) => x !== me && x.on && x.z >= me.z)) change({ ops: [{ s, id, front: true }] });
  };
  const drag = (el, head, grip, id) => {
    const to = (left, top, f, free) => {
      const s = W.snap(left, top, el.offsetWidth, el.offsetHeight, f.W, f.H, f.others, { free, lines: f.lines });
      const o = f.float ? f.at() : { left: 0, top: 0 };
      el.style.left = `${s.left + o.left}px`;
      el.style.top = `${s.top + o.top}px`;
      return s;
    };
    const keep = (s, f) => {
      if (!f.float) return settle(id, W.spotOf({ left: s.left, top: s.top, w: el.offsetWidth }, f.W));
      const p = W.place(s.left, s.top, el.offsetWidth, el.offsetHeight, f.W, f.H, true);
      change(ultra ? { ops: [{ s: 'pages', id, set: { x: p.x, y: p.y }, front: true }], widths: { pages: Math.round(f.W) } } : { ops: [{ s: 'canvas', id, set: { x: p.x, y: p.y } }] });
      return p;
    };
    const surface = ultra ? el : head;
    surface.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || !movable(id)) return;
      if (ultra && !fl(id) ? e.target.closest('.gz-w-tools, .gz-w-resize') : !head.contains(e.target) || (e.target.closest('button, a, input, select, textarea') && e.target !== grip)) return;
      const f = frame(id);
      const r = el.getBoundingClientRect();
      const x0 = e.clientX, y0 = e.clientY, dx = x0 - r.left, dy = y0 - r.top;
      surface.setPointerCapture(e.pointerId);
      gesture = true;
      const z0 = el.style.zIndex;
      if (ultra) { el.style.zIndex = f.float ? '2000' : '999'; el.focus({ preventScroll: true }); }
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
      const up = () => {
        surface.removeEventListener('pointermove', move);
        surface.removeEventListener('pointerup', up);
        surface.removeEventListener('pointercancel', up);
        delete el.dataset.dragging;
        gesture = false;
        guides?.forEach((d) => d.remove());
        if (s) keep(s, f);
        else if (ultra) { el.style.zIndex = z0; raise(id); }
      };
      surface.addEventListener('pointermove', move);
      surface.addEventListener('pointerup', up);
      surface.addEventListener('pointercancel', up);
      e.preventDefault();
    });
    (grip || el).addEventListener('keydown', (e) => {
      const d = ARROWS[e.key];
      if (!d || (!grip && e.target !== el)) return;
      e.preventDefault();
      // In Canvas's grid: left and up move it earlier, right and down later.
      if (!ultra && !fl(id)) { change({ ops: [{ s: 'canvas', id, move: d[0] + d[1] < 0 ? -1 : 1 }] }); grip.focus(); return; }
      if (!movable(id)) return;
      const by = W.GRID * (e.shiftKey ? 4 : 1);
      const f = frame(id);
      const b = el.getBoundingClientRect(), o = f.at();
      const at = f.float ? { left: b.left - o.left, top: b.top - o.top } : lastAt[id];
      if (!at) return;
      const s = to(at.left + d[0] * by, at.top + d[1] * by, f, true);
      const kept = keep(s, f) || s;
      (grip || el).focus();
      say(t('Moved {name}: {x} px from the left, {y} px from the top', { name: t(nameOf(id)), x: kept.left, y: kept.top }));
    });
    // In Canvas's grid while editing: drag a tile onto another to put it there.
    el.addEventListener('dragstart', (e) => { dragged = id; e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', t(nameOf(id))); });
    el.addEventListener('dragover', (e) => { if (dragged && dragged !== id) { e.preventDefault(); el.dataset.over = ''; } });
    el.addEventListener('dragleave', () => delete el.dataset.over);
    el.addEventListener('drop', (e) => { e.preventDefault(); delete el.dataset.over; if (dragged && dragged !== id) change({ ops: [{ s: 'canvas', id: dragged, to: id }] }); dragged = null; });
    el.addEventListener('dragend', () => { dragged = null; });
  };

  // Resizing a tile by its corner (Ultra): on a board while editing, floating at any time. Dragged, the corner snaps as a
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
      change({ ops: [{ s: 'pages', id, set: { x: p.x, y: p.y, ...set }, front: true }], widths: { pages: Math.round(f.W) } });
    };
    const where = (f) => {
      const b = el.getBoundingClientRect(), o = f.at();
      return f.float ? { left: b.left - o.left, top: b.top - o.top } : lastAt[id];
    };
    corner.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || !movable(id)) return;
      e.preventDefault();
      e.stopPropagation();
      const f = frame(id), r = el.getBoundingClientRect(), o = f.at();
      const at = { left: r.left - o.left, top: r.top - o.top };
      const extra = el.offsetHeight - (body.hidden ? 0 : body.offsetHeight); // its heading, padding and gaps
      const dx = e.clientX - r.right, dy = e.clientY - r.bottom;
      corner.setPointerCapture(e.pointerId);
      gesture = true;
      el.dataset.resizing = '';
      const z0 = el.style.zIndex;
      el.style.zIndex = f.float ? '2000' : '999';
      let got = null;
      const move = (ev) => {
        const o2 = f.at();
        got = W.stretch(at.left, at.top, ev.clientX - dx - o2.left, ev.clientY - dy - o2.top, f.W, f.H, f.others, { free: ev.altKey, lines: f.lines, minH: extra + W.MIN_H });
        el.style.width = `${got.w}px`;
        if (!body.hidden) body.style.height = `${got.h - extra}px`;
        showGuides(f.layer, got.guides, { w: f.W, h: Number.isFinite(f.H) ? f.H : Math.max(f.layer.clientHeight, innerHeight) }, f.float ? o2 : undefined);
      };
      const up = () => {
        corner.removeEventListener('pointermove', move);
        corner.removeEventListener('pointerup', up);
        corner.removeEventListener('pointercancel', up);
        delete el.dataset.resizing;
        gesture = false;
        guides?.forEach((d) => d.remove());
        if (got) keep(f, at, got.w, body.hidden ? undefined : got.h - extra, got.h);
        else { el.style.zIndex = z0; raise(id); }
      };
      corner.addEventListener('pointermove', move);
      corner.addEventListener('pointerup', up);
      corner.addEventListener('pointercancel', up);
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

  // Edit widgets (Canvas's grid) or Edit layout (a board: then Done, with Reset layout and the tiles to add). Said to a
  // screen reader as it starts and ends; Esc ends it too.
  const setEditing = (v) => {
    editing = v;
    const edit = bar?.querySelector('.gz-dash-edit');
    if (edit) { edit.setAttribute('aria-pressed', String(editing)); if (board) edit.textContent = t(editing ? 'Done' : 'Edit layout'); }
    const reset = bar?.querySelector('.gz-dash-reset');
    if (reset) reset.hidden = !editing;
    if (board) say(t(editing ? 'Editing the layout. Drag a widget to move it, or its corner to resize it; the one you press comes to the front. Arrow keys work too, and Alt places it freely.' : 'Layout saved.'));
    draw();
  };
  const escape = (e) => { if (e.key === 'Escape' && editing && board) { setEditing(false); bar?.querySelector('.gz-dash-edit')?.focus(); } };
  let loadingCourses = null, nativeShown = false, courseSpace = null;
  const loadCourses = () => {
    if (!ultra || globalThis.GZ_COURSE_CARDS || loadingCourses) return;
    loadingCourses = ctx.need('features/coursecards.js', () => globalThis.GZ_COURSE_CARDS).then(() => {
      loadingCourses = null;
      if (on && board && globalThis.GZ_COURSE_CARDS) { GZ_COURSE_CARDS.sync(draw); draw(); }
    }, () => { loadingCourses = null; });
  };
  const coursePicker = (add) => {
    const C = globalThis.GZ_COURSE_CARDS;
    if (!C) return;
    const available = C.list().filter((c) => !lay.boards[board].some((x) => x.id === c.key && x.on));
    const count = lay.boards[board].filter((x) => W.course(x.id)?.origin === location.origin).length;
    const room = Math.max(0, Math.min(W.COURSE_MAX - count, W.COURSE_TOTAL - lay.boards[board].filter((x) => W.course(x.id)).length));
    if (board === 'courses') {
      add.append(button(t('+ Course cards'), () => {
        nativeShown = false;
        change({ ops: available.slice(0, room).map((c) => ({ s: board, id: c.key, set: { on: true, size: 's', term: c.term } })) });
      }, { className: 'gz-w-small gz-course-add', disabled: !available.length || !room }));
    } else {
      const select = make('select', { className: 'gz-course-pick' }, ...available.map((c) => make('option', { value: c.key, textContent: [C.title(c.key), c.term, c.code].filter(Boolean).join(' · ') })));
      select.setAttribute('aria-label', t('Course card'));
      const addOne = button(t('+ Course card'), () => {
        const c = available.find((c) => c.key === select.value);
        if (c) change({ ops: [{ s: board, id: c.key, set: { on: true, size: 's', term: c.term } }] });
      }, { className: 'gz-w-small gz-course-add', disabled: !available.length || !room });
      add.append(select, addOne);
    }
    add.append(make('span', { className: 'gz-w-faint', textContent: t('Up to {n} course cards per board.', { n: W.COURSE_MAX }) }));
  };
  const clearCourses = () => {
    document.documentElement?.removeAttribute('data-gz-course-tiles');
    courseSpace?.remove(); courseSpace = null;
    bar?.querySelector('.gz-course-native')?.remove();
    nativeShown = false;
  };
  const nativeCourses = (want, away) => {
    const selected = board === 'courses' && want.some((x) => W.course(x.id));
    const cardsOn = selected && !away && !nativeShown;
    if (!ultra) return;
    document.documentElement?.toggleAttribute('data-gz-course-tiles', cardsOn);
    let toggle = bar?.querySelector('.gz-course-native');
    if (selected && !toggle) {
      toggle = button('', () => { nativeShown = !nativeShown; draw(); }, { className: 'gz-w-small gz-course-native' });
      toggle.title = t("Ultra's search, filters and term picker stay in its course list.");
      bar.append(toggle);
    }
    if (toggle) {
      if (!selected) toggle.remove();
      else { const text = t(nativeShown ? 'Show course cards' : "Show Ultra’s course list"); if (toggle.textContent !== text) toggle.textContent = text; toggle.setAttribute('aria-pressed', String(nativeShown)); }
    }
    for (const [id, x] of tiles) if (W.course(id) && x.el.hidden !== (nativeShown && selected)) x.el.hidden = nativeShown && selected;
    const home = cardsOn && document.querySelector('.courses-panel .base-courses');
    if (home) { courseSpace ||= make('div', { className: 'gz-course-space', ariaHidden: 'true' }); if (courseSpace.parentNode !== home) home.append(courseSpace); }
    else { courseSpace?.remove(); courseSpace = null; }
  };
  const gridEl = () => {
    const edit = button(t(board ? 'Edit layout' : 'Edit widgets'), () => setEditing(!editing), { className: 'gz-w-small gz-dash-edit' });
    edit.setAttribute('aria-pressed', 'false');
    const reset = board && button(t('Reset layout'), () => {
      change({ ops: lay.boards[board].filter((x) => !W.course(x.id) || W.course(x.id).origin === location.origin).map((x) => ({ s: board, id: x.id, set: { x: null, y: null, r: false, z: 0, fold: false, w: null, h: null } })), widths: { [board]: 0 } });
      say(t('Layout reset.'));
    }, { className: 'gz-w-small gz-dash-reset', hidden: true });
    const hubBtn = button(t('What Glaze can do'), () => hub(), { className: 'gz-w-small' });
    // Ultra: the reminders' hub (features/reminders.js) from here too, when it has one to open (Canvas's is in its To Do's head).
    const remind = ultra && button(t('Reminders'), () => globalThis.GZ_REMIND_UI?.cmds()[0]?.run(), { className: 'gz-w-small gz-dash-remind', hidden: true });
    // Hide widgets: every widget on the Courses page (its board's and the ones floating everywhere) away at once.
    const hide = board === 'courses' && button(t('Hide widgets'), () => { hidden = !hidden; put({ widgetsHidden: hidden }); draw(); }, { className: 'gz-w-small gz-dash-hide' });
    const add = make('div', { className: 'gz-dash-add' });
    const area = make('div', { className: 'gz-dash-grid' });
    bar = make('div', { className: 'gz-dash-bar' }, !ultra && make('h2', { className: 'screenreader-only', textContent: t('Notes and widgets') }), hide, edit, reset, remind, hubBtn);
    if (board === 'courses') { bar.id = 'gz-toolbar'; bar.setAttribute('role', 'toolbar'); bar.setAttribute('aria-label', 'Glaze'); bar.addEventListener('keydown', escape); }
    const box = make('section', { id: 'gz-dash' }, ...(board === 'courses' ? [] : [bar]), ...(board ? [add, area] : [area, add]));
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
    for (const [id, x] of tiles) if (all || x.el.parentNode !== floats) { x.stop?.(); x.el.remove(); tiles.delete(id); }
    ro?.disconnect();
    floatRO?.disconnect();
    floatWatched.clear();
    cancelAnimationFrame(floatFrame);
    globalThis.GZ_DASH_UI?.tabs(null);
    document.documentElement?.removeAttribute('data-gz-todo-tile');
    clearCourses();
    for (const e of [grid, panel, room, bar, all && floats]) e?.remove?.();
    grid = panel = room = bar = null;
    if (all) floats = null;
    editing = false;
    lastAt = {};
    stacked = false;
  };
  const draw = () => {
    if (!on || !lay) return;
    if (drawn !== board) teardown(false);
    drawn = board;
    const hasGrid = placeGrid();
    const want = wanted(hasGrid);
    if (want.some((x) => x.float) && !floats?.isConnected) { floats = make('div', { id: 'gz-float' }); document.body.append(floats); }
    // A board is laid out again when its room's width or a tile's height changes (the nav folding, what a tile shows),
    // once a frame at most.
    if (board && hasGrid) {
      ro ||= new ResizeObserver(() => { cancelAnimationFrame(frame0); frame0 = requestAnimationFrame(() => { if (on && board) layoutBoard(); }); });
      ro.observe(roomEl());
    }
    for (const [id, x] of tiles) if (!want.some((w) => w.id === id)) { x.stop?.(); x.el.remove(); tiles.delete(id); }
    const last = new Map(); // home -> the tile placed last in it
    for (const tile of want) {
      let x = tiles.get(tile.id);
      if (!x) {
        x = tileEl(tile.id);
        Object.assign(x, (WIDGETS[tile.id] || added.get(tile.id) || GZ_COURSE_CARDS.fill)(x.body, api(tile.id)) || {});
        tiles.set(tile.id, x);
        ro?.observe(x.el);
      }
      if (W.course(tile.id)) {
        const name = nameOf(tile.id);
        if (x.head.querySelector('h3').textContent !== name) { x.head.querySelector('h3').textContent = name; x.el.setAttribute('aria-label', name); }
      }
      x.el.dataset.size = tile.size;
      x.el.draggable = editing && !ultra && !tile.float;
      x.el.toggleAttribute('data-float', !!tile.float);
      x.el.toggleAttribute('data-fold', !!tile.fold);
      if (ultra) {
        // Its body as tall as it was resized to (else its content), scrolling inside. While a board is edited, its tiles
        // are things to move (their content waits), each in the Tab order for the arrow keys; a floating one always is.
        if (!gesture) { const h = tile.h ? `${tile.h}px` : ''; if (x.body.style.height !== h) x.body.style.height = h; }
        const edit = editing && !tile.float;
        if (x.body.inert !== edit) x.body.inert = edit;
        if (tile.float || edit) { x.el.setAttribute('tabindex', '0'); x.el.setAttribute('aria-description', t('Drag to move, or use the arrow keys')); }
        else { x.el.removeAttribute('tabindex'); x.el.removeAttribute('aria-description'); }
      }
      toolsFor(x, tile);
      if (board && !tile.float) continue; // laid out below, in reading order
      // In order, moving only what is out of place: a moved element loses focus (a note being typed).
      const home = tile.float ? floats : grid.querySelector('.gz-dash-grid');
      const prev = last.get(home);
      if (x.el.parentNode !== home || x.el.previousElementSibling !== (prev || null)) { if (prev) prev.after(x.el); else home.prepend(x.el); }
      last.set(home, x.el);
      if (!tile.float) x.el.removeAttribute('style');
    }
    // Hide widgets (the Courses page only; editing shows them all).
    const away = board === 'courses' && hidden && !editing;
    // Better To Do in its tile on the Courses page: Ultra's own To Do in the column steps aside (apps.css).
    document.documentElement?.toggleAttribute('data-gz-todo-tile', board === 'courses' && want.some((x) => x.id === 'todo'));
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
      const off = (board ? lay.boards[board] : lay.tiles).filter((x) => !W.course(x.id) && !x.on && allowed(x.id) && !(ultra && fl(x.id)));
      // A Dashboard with every widget off is still the Dashboard: it says how to fill it.
      const empty = board === 'dash' && !editing && !want.some((x) => !x.float);
      add.replaceChildren(...(editing && off.length ? [make('span', { className: 'gz-w-faint', textContent: t('Add:') }),
        ...off.map((x) => button(`+ ${t(nameOf(x.id))}`, () => change({ ops: [{ s: board || 'canvas', id: x.id, set: board ? { on: true, x: null, y: null } : { on: true } }] }), { className: 'gz-w-small' }))]
        : empty ? [make('p', { className: 'gz-w-faint', textContent: t('Nothing here yet. Edit layout adds widgets.') })] : []));
      if (board && editing) { loadCourses(); coursePicker(add); }
    }
  };

  // Where a board's tiles show (lib/widgets.js arrange): at their spots, or one under another when the window is too
  // narrow for the layout, which is kept for a wider one; the Courses page's panel makes room for the tiles at its
  // column's top, so Ultra's To Do and Better To Do start below them. The tiles' order on the page (Tab, a screen reader)
  // is their reading order. A tile's height is kept from when it was on the board, so stacking doesn't flip back and forth.
  const heights = new Map();
  const layoutBoard = () => {
    const area = grid?.querySelector('.gz-dash-grid');
    const host = roomEl();
    if (gesture || !board || !area || !host?.isConnected || (board === 'courses' && hidden && !editing)) return;
    const list = wanted(true).filter((x) => !x.float && tiles.has(x.id));
    const dims = {};
    for (const x of list) {
      const { el } = tiles.get(x.id);
      if (!el.isConnected) (stacked || board === 'dash' ? area : room).append(el);
      if (el.offsetHeight && (!stacked || !heights.has(x.id))) heights.set(x.id, el.offsetHeight);
      dims[x.id] = { w: widthOf(x), h: heights.get(x.id) || el.offsetHeight };
    }
    const width = host.clientWidth;
    let col = null, lines = null, side = true, courseArea = null;
    if (board === 'courses') {
      // Ultra's column, where the panel is: beside the courses, or (narrow) under them at their width.
      const r = host.getBoundingClientRect(), g = area.getBoundingClientRect();
      col = { right: Math.max(0, Math.round(r.right - g.right)), top: Math.round(g.top - r.top) };
      lines = [g.left - r.left, g.right - r.left];
      side = g.width > 0 && g.width <= width / 2;
      const c = document.querySelector('.courses-panel .base-courses')?.getBoundingClientRect();
      if (c) courseArea = { left: Math.max(0, Math.round(c.left - r.left)), top: Math.max(0, Math.round(c.top - r.top)), width: c.width };

    }
    const res = W.arrange(list, dims, width, { col, courseArea, w0: lay.widths[board] });
    lastAt = res.at;
    lastW = width;
    stacked = !side || res.stack;
    area.toggleAttribute('data-stack', stacked);
    const parent = stacked || board === 'dash' ? area : room;
    const focus = document.activeElement;
    let prev = null;
    for (const id of res.order) {
      const { el } = tiles.get(id);
      if (el.parentNode !== parent || el.previousElementSibling !== prev) { if (prev) prev.after(el); else parent.prepend(el); }
      prev = el;
      const a = res.at[id];
      const z = String(1 + (cur(id)?.z || 0));
      if (stacked) { if (el.style.left) el.removeAttribute('style'); continue; }
      for (const [k, v] of Object.entries({ left: `${a.left}px`, top: `${a.top}px`, width: `${a.w}px`, zIndex: z })) if (el.style[k] !== v) el.style[k] = v;
    }
    if (focus !== document.activeElement && focus?.isConnected) focus.focus({ preventScroll: true });
    const keep = stacked ? '' : `${board === 'courses' ? W.reserve(Object.values(res.at), lines[0], lines[1], col.top) : res.bottom + W.GAP}px`;
    if (area.style.height !== keep) area.style.height = keep;
    if (courseSpace) {
      const height = stacked || !courseArea ? '0px' : `${W.reserve(Object.values(res.at), courseArea.left, courseArea.left + courseArea.width, courseArea.top) + W.GAP}px`;
      if (courseSpace.style.height !== height) courseSpace.style.height = height;
    }
  };

  // What this page shows: tiles that are on, allowed by their switch, and on this board, or (Canvas) floating or with
  // the grid here; on Ultra, the tiles floating over every page too, and those only once (not on a board while they
  // float). A declared tile (MORE) shows once its file has registered it; while it's on, the file is asked for.
  const wanted = (hasGrid) => [
    ...(ultra ? (board && hasGrid ? lay.boards[board].filter((x) => !fl(x.id)) : []) : lay.tiles.filter((x) => x.float || hasGrid)),
    ...(ultra ? lay.boards.pages.filter((x) => x.on).map((x) => ({ ...x, float: true })) : []),
  ].filter((x) => {
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
  const api = (id) => ({ id, term: () => cur(id)?.term || '', who: account, site: ctx.site, size: () => cur(id)?.size || 's' });
  // Ultra's floating tiles (lib/widgets.js floating): each at its place in the room the window leaves right of the nav
  // and below a course's top bar, on top in the order they were moved; stacked at the window's edge (data-stack) when
  // the window is too narrow for where they were placed. Their width is as resized, else their size's, as on the boards.
  const placeFloats = () => {
    if (ultra) {
      if (!floats || gesture) return;
      const r = floatRoom();
      const list = lay.boards.pages.filter((x) => x.on && tiles.has(x.id));
      if (!list.length) { floatRO?.disconnect(); floatWatched.clear(); floatsStacked = false; floats.removeAttribute('data-stack'); return; }
      const watch = new Set([...r.edges, ...list.map((x) => tiles.get(x.id).el)]);
      floatRO ||= new ResizeObserver(() => { cancelAnimationFrame(floatFrame); floatFrame = requestAnimationFrame(() => { if (on) placeFloats(); }); });
      for (const e of floatWatched) if (!watch.has(e)) { floatRO.unobserve(e); floatWatched.delete(e); }
      for (const e of watch) if (!floatWatched.has(e)) { floatRO.observe(e); floatWatched.add(e); }
      const dims = Object.fromEntries(list.map((x) => [x.id, { w: widthOf(x), h: Math.max(tiles.get(x.id).el.offsetHeight, tiles.get(x.id).el.scrollHeight) }]));
      const res = W.floating(list, dims, r.W, r.H, lay.widths.pages);
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
      return;
    }
    for (const tile of lay.tiles) {
      const el = tile.float && tiles.get(tile.id)?.el;
      if (!el) continue;
      const r = el.getBoundingClientRect();
      const p = W.spot(tile.x, tile.y, r.width, r.height, innerWidth, innerHeight);
      el.style.left = `${p.left}px`;
      el.style.top = `${p.top}px`;
    }
  };

  // ---- the feature hub and the tour ----------------------------------------------------------------------------
  // "What Glaze can do": every Canvas extra with its switch, the tour, reporting a problem and the editor. Opened by the
  // student only (the command palette, or the Dashboard's button): nothing here opens by itself.
  let hubBox = null;
  const hub = () => {
    if (!validContext()) return;
    hubBox?.remove();
    const s = ctx.settings();
    const set = (k, v) => { try { chrome.storage.sync.set({ version: 2, enhance: { ...ctx.settings().enhance, [k]: v } }); } catch { /* reloaded */ } };
    const close = () => hubBox?.close();
    const report = make('a', { className: 'gz-w-btn', textContent: t('Report a problem'), target: '_blank', rel: 'noopener noreferrer',
      href: W.feedback({ version: chrome.runtime.getManifest().version, ua: navigator.userAgent, lang: ctx.locale(), lms: ultra ? 'Blackboard Ultra' : 'Canvas' }) });
    report.title = t('Opens a new GitHub issue with your Glaze version and browser filled in. GitHub receives that text when the page opens; nothing is posted until you submit it.');
    const tourBtn = button(t('Take the tour'), () => { close(); tour(); }, { className: 'gz-w-btn gz-w-main' });
    const editor = button(t('Glaze settings'), () => { try { chrome.runtime.sendMessage('options'); } catch { /* reloaded */ } });
    hubBox = make('dialog', { id: 'gz-hub', className: 'gz-w-dialog' },
      make('header', { className: 'gz-w-row' }, make('h2', { id: 'gz-hub-h', textContent: t('What Glaze can do') }), button('×', close, { className: 'gz-w-icon', ariaLabel: t('Close') })),
      make('p', { className: 'gz-w-faint', textContent: t('Switch any of these on or off. Everything runs on this device; the editor has the details.') }),
      ...(ultra ? HUB_ULTRA : HUB).map(([group, keys]) => make('fieldset', {}, make('legend', { textContent: t(group) }),
        ...keys.map((k) => {
          const box = make('input', { type: 'checkbox', checked: !!s.enhance[k] });
          box.setAttribute('role', 'switch');
          box.dataset.key = k;
          box.addEventListener('change', () => set(k, box.checked));
          return make('label', { className: 'gz-w-check' }, box, make('span', { textContent: t(EXTRA[k]) }));
        }))),
      make('footer', { className: 'gz-w-row' }, tourBtn, report, editor));
    hubBox.setAttribute('aria-labelledby', 'gz-hub-h');
    const sync = (ch, a) => { if (a === 'sync' && ch.enhance) for (const b of hubBox.querySelectorAll('input[data-key]')) b.checked = !!ch.enhance.newValue?.[b.dataset.key]; };
    try { chrome.storage.onChanged.addListener(sync); } catch { /* reloaded */ }
    hubBox.addEventListener('close', () => { try { chrome.storage.onChanged.removeListener(sync); } catch { /* reloaded */ } hubBox.remove(); hubBox = null; });
    hubBox.addEventListener('click', (e) => { if (e.target === hubBox) close(); });
    document.body.append(hubBox);
    hubBox.showModal();
  };
  // A few steps over what's on this page, each pointing at its part; a step whose part isn't here is skipped. Esc,
  // End tour or the last step's Finish ends it; nothing is kept.
  const STEPS = [
    ['#gz-dash', 'Your notes and widgets. Edit widgets adds, orders and sizes them; any of them can float over every Canvas page.'],
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
  const tour = () => {
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
    const end = () => { ring.remove(); bubble.remove(); document.removeEventListener('keydown', key, true); };
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
  const readPrefs = () => get('sync', 'widgets').then((r) => { o = GZ_SANITIZE({ widgets: r.widgets }).widgets; });
  const onStore = (ch, a) => {
    if (a === 'sync' && ch.widgets) readPrefs().then(() => { for (const x of tiles.values()) x.update?.(); });
    // Another tab's change (this tab's own come back as the worker's answer).
    if (a === 'local' && ch.widgetLayout) { layoutRead++; if (!flying && lay) adopt(ch.widgetLayout.newValue); }
  };
  const onShow = () => { if (shown()) for (const x of tiles.values()) x.wake?.(); };
  const onResize = () => { if (!on || !lay) return; if (board) layoutBoard(); placeFloats(); };
  const start = async () => {
    await ctx.need('lib/widgets.js', () => globalThis.GZ_WIDGETS);
    W = globalThis.GZ_WIDGETS;
    const [r] = await Promise.all([get('local', ['widgetLayout', 'widgetsHidden']), readPrefs()]);
    lay = W.layout(r.widgetLayout, MORE);
    hidden = r.widgetsHidden === true;
    try { chrome.storage.onChanged.addListener(onStore); } catch { /* reloaded */ }
    document.addEventListener('visibilitychange', onShow);
    addEventListener('resize', onResize);
  };
  // If it can't start (the extension reloaded under the tab), the page stays as Canvas has it; it tries again after a minute.
  const sync = (want) => {
    on = !!want;
    board = boardOf();
    if (!on) { teardown(true); drawn = null; return; }
    if (!starting) starting = start().then(draw, () => {
      if (on && board === 'dash') document.documentElement.setAttribute('data-gz-dash', 'ip');
      setTimeout(() => { starting = null; }, 60000);
    });
    else if (W && lay) {
      if (ultra && board) globalThis.GZ_COURSE_CARDS?.sync(draw);
      // A pass: draw only when something changed (a switch let a tile in or out, Canvas redrew the Dashboard), so the
      // page's observer isn't fed changes of Glaze's own.
      const h = home();
      const want = wanted(!!h);
      if (drawn !== board || want.map((x) => x.id).sort().join() !== [...tiles.keys()].sort().join() || (h ? !grid || !placed(h) : grid?.isConnected)
        || (!board && want.some((x) => x.float) && !floats?.isConnected)) draw();
      else {
        remindIn();
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

  const avatar = (body, options = {}) => {
    let alive = true, sleeping = false, live;
    ctx.need('lib/widgets.js', () => globalThis.GZ_WIDGETS).then(() => {
      if (alive && validContext() && body.isConnected !== false) { W ||= globalThis.GZ_WIDGETS; live = WIDGETS.buddy(body, options); if (sleeping) live.sleep(); }
    }).catch(() => {});
    return { wake: () => { sleeping = false; live?.wake(); }, sleep: () => { sleeping = true; live?.sleep(); }, play: (state) => live?.play(state), stop: () => { alive = false; live?.stop(); } };
  };
  return { sync, hub: open, register, who: account, avatar };
})();

GZ_WIDGETS_UI;
