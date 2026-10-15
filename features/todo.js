// Better To Do (Canvas): Glaze's own To Do list in place of Canvas's sidebar list, on the Dashboard and a course's home
// page, when the student turns it on (enhance.todo). content.js loads this (need) and calls sync(on) from its passes; the
// logic is lib/todo.js, loaded from here. Canvas's list is hidden by canvas.css only while this one is on the page
// (#gz-todo ~ .Sidebar__TodoListContainer), so if anything here fails, Canvas's comes back.
//
// What it asks Canvas for, with the student's session: their profile (id, time zone), their planner items (Link
// paging), and, for a teacher, /users/self/todo and each listed assignment's submission summary. One answer serves
// the Dashboard, course pages and the popup's due list, kept in storage.local and asked again after two minutes,
// only when the page is shown or focused: no polling. The one write is a mark, and only with todo.sync on: Canvas's
// planner override, exactly as Canvas's own List View checkbox sends it.
// Loaded on demand: a second injection into the same frame keeps the first.
var GZ_TODO_UI = globalThis.GZ_TODO_UI || (() => {
  const ctx = globalThis.GZ_CTX;
  const t = (k, v) => ctx.t(k, v);
  const CACHE = 'todoCache';
  const FRESH = 120000;
  const CAP = 6; // rows a group shows before "Show more"
  let L = null; // lib/todo.js
  let box = null; // section#gz-todo: its head and body are drawn anew; the status line stays, so it's announced
  let head = null, line = null, body = null;
  let started = null; // the start() promise while mounted
  let dead = false; // it failed for good on this page: Canvas's own list stays
  let gen = 0; // which start is current: off() and each start move it on, and a superseded start's results are dropped
  let who = null; // { uid, tz }
  let key = '';
  let data = { tasks: [], items: {} };
  let cache = null;
  let courses = { cids: null, names: {}, list: [] };
  let fetching = null; // the planner (or summaries) request in flight, and the generation it was asked for in
  let fetchGen = -1;
  let drawn = '';
  let shown = new Map(); // key -> row, for every row the list drew
  const open = new Set(); // rows with their details open, and "show more" groups
  const shut = new Set(['done', 'graded', 'read']); // sections closed until opened
  let form = null; // the add/edit form's task: { id?, cid, … } or null

  // The list's own settings (storage.sync `todo`, in GZ_SPEC once lib/todo.js is in); content.js reads only the switch.
  let prefs = null;
  const o = () => prefs;
  const readPrefs = () => new Promise((res) => { try { chrome.storage.sync.get('todo', (r) => res(r?.todo)); } catch { res(); } })
    .then((raw) => { prefs = GZ_SANITIZE({ todo: raw }).todo; });
  const lang = () => GZ_I18N.locale(ctx.locale());
  const store = () => { try { return chrome.storage.local; } catch { return null; } };
  // { ok, value } for one storage.local key; ok false if storage couldn't be read (then nothing is written over it).
  const get = (k) => new Promise((res) => { try { store().get(k, (r) => res({ ok: !chrome.runtime.lastError, value: r?.[k] })); } catch { res({ ok: false }); } });
  // Resolves true once storage has it, false if it didn't take (quota, the extension reloaded under the tab).
  const put = (v) => new Promise((res) => { try { store().set(v, () => res(!chrome.runtime.lastError)); } catch { res(false); } });
  const make = (tag, props = {}, ...kids) => { const e = Object.assign(document.createElement(tag), props); e.append(...kids.filter((k) => k != null && k !== false)); return e; };
  const json = async (r) => { if (!r.ok) throw new Error(String(r.status)); return JSON.parse((await r.text()).replace(/^while\(1\);/, '')); };
  const ACCEPT = 'application/json+canvas-string-ids, application/json';

  // ---- Canvas ------------------------------------------------------------------------------------------------
  // A list over every page Canvas's Link header names, on this site only. ponytail: ten pages (1,000 items).
  const pages = async (path) => {
    const out = [];
    let url = location.origin + path;
    for (let i = 0; url && i < 10; i++) {
      const r = await fetch(url, { credentials: 'same-origin', headers: { accept: ACCEPT } });
      const j = await json(r);
      if (Array.isArray(j)) out.push(...j);
      const next = r.headers.get('link')?.match(/<([^>]+)>;\s*rel="next"/)?.[1];
      url = next && new URL(next, location.origin).origin === location.origin ? next : null;
    }
    return out;
  };
  const csrf = () => { const m = document.cookie.match(/(?:^|;\s*)_csrf_token=([^;]*)/); return m ? decodeURIComponent(m[1]) : ''; };
  // Mark done or not done in Canvas's planner: the override Canvas's own List View checkbox writes (an assignment
  // behind a quiz or discussion is marked as the assignment, as there). Returns the override Canvas kept.
  const write = async (row, done) => {
    const body = { plannable_id: row.aid || row.id, plannable_type: row.aid ? 'assignment' : row.type, user_id: who.uid, marked_complete: done };
    const id = row.ov?.id;
    const r = await fetch(`${location.origin}/api/v1/planner/overrides${id ? `/${id}` : ''}`, {
      method: id ? 'PUT' : 'POST', credentials: 'same-origin',
      headers: { accept: ACCEPT, 'content-type': 'application/json', 'x-csrf-token': csrf(), 'x-requested-with': 'XMLHttpRequest' },
      body: JSON.stringify(id ? { id, ...body } : body),
    });
    const j = await json(r);
    if (!/^\d+$/.test(String(j?.id))) throw new Error('no override');
    return { id: String(j.id), done: !!j.marked_complete, dismissed: !!j.dismissed };
  };
  const covers = (c, now) => {
    if (!c || c.key !== key || now - c.at >= FRESH || c.teach !== o().teacher || c.progress !== o().progress) return false;
    const need = L.fetchRange(o(), now, who.tz);
    return Date.parse(c.start) <= Date.parse(need.start) && Date.parse(c.end) >= Date.parse(need.end) - L.DAY;
  };
  const load = async () => {
    const now = Date.now();
    const { start, end } = L.fetchRange(o(), now, who.tz);
    const [raw, list] = await Promise.all([pages(`/api/v1/planner/items?start_date=${start}&end_date=${end}&per_page=100`), ctx.canvasCourses()]);
    // The popup and the command palette's due list comes from this same answer (content.js dueWeek).
    put({ dueWeek: GZ_CANVAS_DUE_WEEK(raw, now), dueWeekAt: now, dueWeekFrom: location.origin });
    const teach = o().teacher && list.some((c) => (c.enrollments || []).some((e) => /^(teacher|ta)/i.test(e.type || '')));
    const grading = !teach ? [] : (await ctx.capi('/users/self/todo?per_page=100').catch(() => [])).filter((x) => x?.type === 'grading').map(L.slimGrading).filter((g) => g.aid && g.n > 0);
    const c = { key, at: now, start, end, teach: o().teacher, progress: o().progress, items: raw.map(L.slim), grading, sums: {} };
    if (teach && o().progress) await summaries(c);
    return c;
  };
  // Teachers' grading progress: each listed assignment's submission counts. One that doesn't come (refused, or the page
  // left mid-way) leaves the cache partial; the planner answer still counts, and only the missing counts are asked for
  // again, when the page is next shown or focused. ponytail: thirty summaries, one request each; the rest count as unknown.
  const summaries = async (c) => {
    c.partial = false;
    await Promise.all(c.grading.filter((g) => g.cid && !c.sums[g.aid]).slice(0, 30).map((g) => ctx.capi(`/courses/${g.cid}/assignments/${g.aid}/submission_summary`)
      .then((x) => { c.sums[g.aid] = { graded: +x.graded || 0, ungraded: +x.ungraded || 0 }; }, () => { c.partial = true; })));
  };
  // Asked when the list starts, when the page is shown or focused again, when its settings change and after a refused
  // tick; never from content.js's passes. Within two minutes of the last answer only missing grading counts are asked.
  // A request asked for by a list that has since gone doesn't hold up the new list's own: each generation asks for itself,
  // and an older answer is dropped when it comes.
  const refresh = (force = false) => {
    const g = gen;
    if (!who || dead) return null;
    if (fetching && fetchGen === g) return fetching;
    const done = (p) => { fetching = p; fetchGen = g; p.finally(() => { if (fetching === p) fetching = null; }); return p; };
    if (!force && covers(cache, Date.now())) {
      if (!cache.partial || !o().progress) return null;
      return done(summaries(cache).then(() => put({ [CACHE]: cache })).finally(() => { if (g !== gen) return; if (typing()) drawn = ''; else render(true); }));
    }
    if (!cache) setBusy(true);
    return done(load().then((c) => {
      if (g !== gen) return;
      cache = c;
      put({ [CACHE]: c });
    }, () => {
      if (g !== gen) return;
      if (!cache) return fail();
      note(t("Couldn't refresh your To Do from Canvas."));
    }).finally(() => { if (g !== gen) return; setBusy(false); if (typing()) drawn = ''; else render(true); }));
  };
  // The courses the Dashboard list shows: active ones Canvas lets the student into. canvasCourses() answers [] both
  // when the student has none and when the request failed (its other callers want that), so an empty answer filters
  // nothing either way: nothing is hidden on a guess.
  const coursesIn = (list) => {
    const live = list.filter((c) => /^\d+$/.test(String(c.id)) && c.name && !c.access_restricted_by_date);
    courses = { cids: live.length ? new Set(live.map((c) => String(c.id))) : null, names: Object.fromEntries(live.map((c) => [String(c.id), c.name])), list: live };
  };

  // ---- the student's own -------------------------------------------------------------------------------------
  // The student's changes, one at a time. Each belongs to the account and list it was made in (key and generation
  // taken when it's asked for), is applied to what storage holds for that account when its turn comes (so none undoes
  // another, here or in a newer list), and is shown as saved only once storage has it. One storage refuses changes
  // nothing and is said so. A change made in a list that has since gone (off, remounted, another account) is still
  // stored under its own account, and shown nowhere. change(d) edits d in place; ok: what to say once it's kept.
  let queue = Promise.resolve();
  const save = (change, ok = '') => {
    const k0 = key, g0 = gen;
    return (queue = queue.then(async () => {
      const was = await get(k0);
      let next = null;
      if (was.ok) {
        try { next = L.clean(was.value); change(next); next = L.clean(next); } catch { next = null; }
      }
      const kept = !!next && await put({ [k0]: next });
      if (g0 !== gen) return kept;
      if (kept) data = next;
      note(kept ? ok : t("Couldn't save that on this device, so nothing changed."));
      render(true);
      return kept;
    }));
  };
  const local = (d, k) => (d.items[k] ||= {});
  const tidy = (d, k) => { if (d.items[k] && !Object.keys(d.items[k]).length) delete d.items[k]; };
  const uid = () => crypto.randomUUID().slice(0, 13);
  // A change comes from the student: a trusted event while the page has their transient activation (a click or key
  // just now; Space and Enter count). A script's dispatched event, or its .click() with no person behind it, changes
  // nothing. A browser without the userActivation API is held to the trusted event alone.
  const human = (e) => e.isTrusted && (navigator.userActivation?.isActive ?? true);

  // ---- drawing ------------------------------------------------------------------------------------------------
  const setBusy = (on) => box?.setAttribute('aria-busy', String(on));
  const note = (text) => { if (line) line.textContent = text; };
  // Typing in the list: a pass that isn't the student's own doing waits, so nothing typed is lost.
  const typing = () => !!box?.contains(document.activeElement) && document.activeElement.matches('input:not([type="checkbox"]), textarea, select');
  const fail = () => {
    dead = true;
    off();
  };
  const when = (x, now) => L.label(x, now, who.tz, lang());
  const dueText = (r, now) => {
    if (r.at === null) return null;
    const w = when(r, now);
    const rel = o().rel;
    const text = rel ? w.rel : w.abs;
    // A planner note has a day to do it on, not a due date.
    return make('span', { className: 'gz-todo-when', title: rel ? w.abs : w.rel, textContent: r.type === 'planner_note' ? text : t(r.past ? 'Was due {when}' : 'Due {when}', { when: text }) });
  };
  const chip = (text, tone = '') => { const e = make('span', { className: 'gz-todo-chip', textContent: text }); e.dataset.tone = tone; return e; };
  const TONE = { Missing: 'err', 'Submitted late': 'warn', Submitted: 'ok', Graded: 'ok', Excused: 'ok', Done: 'ok' };
  const planText = (r, now) => {
    const next = (r.local.sessions || []).find((x) => x.at + x.min * 6e4 > now);
    if (next) return t('Focus {when} · {min} min', { when: when({ at: next.at }, now).abs, min: next.min });
    if (r.local.on && L.keyDay(r.local.on) >= L.dayOf(now, who.tz)) {
      const w = when({ allDay: true, day: L.keyDay(r.local.on) }, now);
      return t('Planned for {when}', { when: o().rel ? w.rel : w.abs });
    }
    return '';
  };
  // kind: the group it's drawn in. An item planned for another day than it's due is drawn in both: ids and focus keys
  // are per group, and its details open under the first.
  let firstIds = new Map(); // key -> id of the row drawn first, this render
  const row = (r, now, kind = '') => {
    const id = `gz-todo-${kind}-${r.key.replace(/\W/g, '-')}`;
    if (!firstIds.has(r.key)) firstIds.set(r.key, id);
    const first = firstIds.get(r.key) === id;
    const fk = `${kind} ${r.key}`;
    const subs = r.local.subs || [];
    const check = make('input', { type: 'checkbox', checked: r.done });
    check.dataset.act = 'done';
    check.dataset.focus = `${fk} done`;
    check.setAttribute('aria-labelledby', `${id}-t`);
    check.setAttribute('aria-describedby', `${id}-m`);
    const title = r.url
      ? make('a', { href: r.url, id: `${id}-t`, className: 'gz-todo-title', textContent: r.title })
      : make('button', { type: 'button', id: `${id}-t`, className: 'gz-todo-title', textContent: r.title });
    if (!r.url) { title.dataset.act = 'more'; title.dataset.focus = `${fk} title`; title.setAttribute('aria-expanded', String(open.has(r.key))); title.setAttribute('aria-controls', `${firstIds.get(r.key)}-d`); } else title.dataset.focus = `${fk} title`;
    const plan = planText(r, now);
    const meta = make('div', { className: 'gz-todo-meta', id: `${id}-m` },
      r.course && !ctx.canvasCourseId() && make('span', { textContent: r.course }),
      dueText(r, now),
      r.status && chip(t(r.status), TONE[r.status]),
      plan && make('span', { className: 'gz-todo-plan', textContent: plan }),
      subs.length > 0 && make('span', { textContent: t('{done} of {n} steps', { done: subs.filter((x) => x.done).length, n: subs.length }) }));
    const more = make('button', { type: 'button', className: 'gz-todo-more', title: t('Plan it'), textContent: '⋯' });
    more.dataset.act = 'more';
    more.dataset.focus = `${fk} more`;
    more.setAttribute('aria-expanded', String(open.has(r.key)));
    more.setAttribute('aria-controls', `${firstIds.get(r.key)}-d`);
    more.setAttribute('aria-label', t('Plan {title}', { title: r.title }));
    const li = make('li', { className: 'gz-todo-item' }, check, make('div', { className: 'gz-todo-main' }, title, meta), more, first && open.has(r.key) && detail(r, id, now));
    li.dataset.key = r.key;
    if (r.urgent) li.dataset.urgent = r.past ? 'past' : 'soon';
    if (r.done) li.dataset.done = '';
    return li;
  };
  const field = (label, input) => make('label', { className: 'gz-todo-field' }, make('span', { textContent: label }), input);
  const small = (act, label, text = label) => { const b = make('button', { type: 'button', className: 'gz-todo-small', textContent: text }); b.dataset.act = act; if (text !== label) b.setAttribute('aria-label', label); return b; };
  const detail = (r, id, now) => {
    const k = r.key;
    const d = make('div', { className: 'gz-todo-detail', id: `${id}-d` });
    d.dataset.key = k;
    if (r.type === 'planner_note' && r.note) d.append(make('p', { className: 'gz-todo-note', textContent: r.note }));
    if (r.custom && r.note) d.append(make('p', { className: 'gz-todo-note', textContent: r.note }));
    // Steps
    const steps = make('ul', { className: 'gz-todo-steps' });
    for (const x of r.local.subs || []) {
      const c = make('input', { type: 'checkbox', checked: x.done });
      c.dataset.act = 'step';
      c.dataset.step = x.id;
      c.dataset.focus = `${k} step ${x.id}`;
      const rm = small('unstep', t('Remove step {title}', { title: x.title }), '×');
      rm.dataset.step = x.id;
      steps.append(make('li', {}, make('label', {}, c, make('span', { textContent: x.title })), rm));
    }
    const stepIn = make('input', { type: 'text', maxLength: 200, placeholder: t('Add a step') });
    stepIn.dataset.act = 'stepText';
    stepIn.dataset.focus = `${k} stepText`;
    stepIn.setAttribute('aria-label', t('Add a step'));
    const stepForm = make('form', { className: 'gz-todo-row' }, stepIn, make('button', { type: 'submit', className: 'gz-todo-small', textContent: t('Add') }));
    stepForm.dataset.act = 'addStep';
    d.append(make('h4', { textContent: t('Steps') }), steps, stepForm);
    // Do on: a whole day
    const on = make('input', { type: 'date', value: r.local.on || '' });
    on.dataset.act = 'on';
    on.dataset.focus = `${k} on`;
    d.append(make('div', { className: 'gz-todo-row' }, field(t('Do on'), on), r.local.on && small('unon', t('Clear date'))));
    // Focus sessions: a start and a length, as many as wanted
    const list = make('ul', { className: 'gz-todo-steps' });
    for (const [i, x] of (r.local.sessions || []).entries()) {
      const rm = small('unsession', t('Remove this session'), '×');
      rm.dataset.i = i;
      const w = when({ at: x.at }, now);
      list.append(make('li', { className: x.at + x.min * 6e4 <= now ? 'gz-todo-gone' : '' }, make('span', { textContent: t('{when} · {min} min', { when: w.abs, min: x.min }), title: w.rel }), rm));
    }
    const at = make('input', { type: 'datetime-local' });
    at.dataset.focus = `${k} sessionAt`;
    at.required = true;
    const min = make('input', { type: 'number', min: 5, max: 600, step: 5, value: 30, className: 'gz-todo-min' });
    const sForm = make('form', { className: 'gz-todo-row' }, field(t('Focus session'), at), field(t('Minutes'), min), make('button', { type: 'submit', className: 'gz-todo-small', textContent: t('Add') }));
    sForm.dataset.act = 'addSession';
    d.append(make('h4', { textContent: t('Focus sessions') }), list, sForm);
    if (r.custom) {
      const del = small('delete', t('Delete task'));
      del.dataset.focus = `${k} delete`;
      d.append(make('div', { className: 'gz-todo-row' }, small('edit', t('Edit task')), del));
    }
    return d;
  };
  const section = (kind, label, rows, now, opts = {}) => {
    const all = open.has(`group:${kind}`);
    const shown = all ? rows : rows.slice(0, CAP);
    const ul = make('ul', { className: 'gz-todo-list' }, ...shown.map((r) => (opts.draw || row)(r, now, kind)));
    const rest = rows.length - shown.length;
    const more = rest > 0 && small('all', t('Show {n} more', { n: rest }));
    if (more) { more.dataset.group = kind; more.dataset.focus = `group:${kind}`; }
    const count = make('span', { className: 'gz-todo-n', textContent: opts.count ?? String(rows.length) });
    if (opts.fold) {
      const d = make('details', { className: 'gz-todo-group', open: !shut.has(kind) }, make('summary', {}, make('span', { textContent: label }), count), ul, more);
      d.dataset.kind = kind;
      return d;
    }
    const g = make('div', { className: 'gz-todo-group' }, make('h3', {}, make('span', { textContent: label }), count), opts.after, ul, more);
    g.dataset.kind = kind;
    return g;
  };
  const LABEL = { past: 'Past due', today: 'Today', tomorrow: 'Tomorrow', week: 'This week', later: 'Later', none: 'No date', all: 'Upcoming' };
  const news = (r) => {
    const li = make('li', { className: 'gz-todo-item gz-todo-news' }, make('div', { className: 'gz-todo-main' },
      make('a', { href: r.url, className: 'gz-todo-title', textContent: r.title }),
      make('div', { className: 'gz-todo-meta' }, r.course && make('span', { textContent: r.course }), make('span', { textContent: when(r, Date.now())[o().rel ? 'rel' : 'abs'] }),
        !r.read && chip(t('Unread')))));
    if (!r.read) li.dataset.unread = '';
    return li;
  };
  const grade = (r) => make('li', { className: 'gz-todo-item gz-todo-grade' }, make('div', { className: 'gz-todo-main' },
    make('a', { href: r.url || `/courses/${r.cid}/gradebook`, className: 'gz-todo-title', textContent: r.title }),
    make('div', { className: 'gz-todo-meta' }, r.course && !ctx.canvasCourseId() && make('span', { textContent: r.course }), chip(t('{n} to grade', { n: r.n })))));
  const taskForm = () => {
    const x = form;
    const due = x.due?.at ? L.inputs(x.due.at, who.tz) : { date: x.due?.day || '', time: '' };
    const v = x.draft || { title: x.title || '', cid: x.cid || '', date: due.date, time: due.time, notes: x.notes || '' };
    const title = make('input', { type: 'text', name: 'title', required: true, maxLength: 300, value: v.title });
    title.dataset.focus = 'form title';
    const course = make('select', { name: 'cid' }, make('option', { value: '', textContent: t('No course') }),
      ...courses.list.map((c) => make('option', { value: String(c.id), textContent: c.name, selected: String(c.id) === v.cid })));
    const input = (name, type, value) => { const e = make('input', { type, name, value }); e.dataset.focus = `form ${name}`; return e; };
    course.dataset.focus = 'form cid';
    const notes = make('textarea', { name: 'notes', rows: 2, maxLength: 2000, value: v.notes });
    notes.dataset.focus = 'form notes';
    const f = make('form', { className: 'gz-todo-form' },
      field(t('Task'), title),
      field(t('Course'), course),
      make('div', { className: 'gz-todo-row' }, field(t('Due date'), input('date', 'date', v.date)), field(t('Time'), input('time', 'time', v.time))),
      field(t('Notes'), notes),
      who.tz && who.tz !== Intl.DateTimeFormat().resolvedOptions().timeZone && make('p', { className: 'gz-todo-hint', textContent: t('Times are in {zone}, your Canvas time zone.', { zone: who.tz }) }),
      make('div', { className: 'gz-todo-row' }, make('button', { type: 'submit', className: 'gz-todo-btn', textContent: x.id ? t('Save') : t('Add task') }), small('cancel', t('Cancel'))));
    f.dataset.act = 'saveTask';
    f.setAttribute('aria-label', x.id ? t('Edit task') : t('Add task'));
    return f;
  };
  const render = (force = false) => {
    if (!box || !L || !who) return;
    const now = Date.now();
    const sig = JSON.stringify([prefs, lang(), Math.floor(now / 6e4)]);
    if (!force && (sig === drawn || typing())) return;
    drawn = sig;
    // What's typed in the task form so far survives the redraw.
    const f = box.querySelector('.gz-todo-form');
    if (f && form) form.draft = Object.fromEntries([...new FormData(f)].map(([k, v]) => [k, String(v)]));
    const course = ctx.canvasCourseId() || '';
    const out = L.build({ items: cache?.items || [], grading: o().teacher ? cache?.grading || [] : [], data, o: o(), now, tz: who.tz, cids: courses.cids, course, names: courses.names, sync: o().sync });
    firstIds = new Map();
    shown = new Map([...out.groups.flatMap(([, l]) => l), ...out.done, ...out.graded].map((r) => [r.key, r]));
    // The focused control, found again in the new tree by what it was for; if that went out of sight (a ticked item
    // into the closed Done section), the one after it.
    const was = box.contains(document.activeElement) ? document.activeElement.dataset.focus : null;
    const order = [...box.querySelectorAll('[data-focus]')].map((e) => e.dataset.focus);
    const add = small('add', t('Add task'));
    add.dataset.focus = 'add';
    add.setAttribute('aria-expanded', String(!!form));
    head.replaceChildren(make('h2', { id: 'gz-todo-title', textContent: t('To Do') }),
      ...(out.count.all > 0 ? [make('span', { className: 'gz-todo-count', textContent: t('{done} of {all} done', out.count) })] : []), add);
    const parts = [form && taskForm()];
    if (!cache) parts.push(make('p', { className: 'gz-todo-empty', textContent: t('Loading…') }));
    else if (!out.groups.length && !out.grading.length) parts.push(make('p', { className: 'gz-todo-empty', textContent: t('Nothing to do. Enjoy it.') }));
    for (const [kind, rows] of out.groups) parts.push(section(kind, t(LABEL[kind]), rows, now));
    if (out.grading.length) {
      const c = o().progress ? L.graded(out.grading, cache?.sums) : null;
      parts.push(section('grading', t('To grade'), out.grading, now, {
        draw: grade, count: String(out.grading.reduce((n, g) => n + g.n, 0)),
        after: c?.all > 0 && make('p', { className: 'gz-todo-progress' }, make('span', { textContent: t('{graded} of {all} graded', c) }), Object.assign(make('i'), { style: `--gz-pct: ${Math.round((c.graded / c.all) * 100)}%` })),
      }));
    }
    if (out.done.length) parts.push(section('done', t('Done'), out.done, now, { fold: true }));
    if (out.graded.length) parts.push(section('graded', t('Graded'), out.graded, now, { fold: true }));
    if (out.unread.length || out.read.length) {
      parts.push(section(out.unread.length ? 'unread' : 'read', t('Announcements'), [...out.unread, ...out.read], now, {
        fold: true, draw: news, count: out.unread.length ? t('{n} unread', { n: out.unread.length }) : String(out.read.length),
      }));
    }
    body.replaceChildren(...parts.filter(Boolean));
    if (!was) return;
    const seen = (v) => { const e = box.querySelector(`[data-focus="${CSS.escape(v)}"]`); return e?.checkVisibility() ? e : null; };
    (seen(was) || order.slice(order.indexOf(was) + 1).map(seen).find(Boolean) || seen('add'))?.focus({ preventScroll: true });
  };

  // ---- what the student does -----------------------------------------------------------------------------------
  // The row a control belongs to, from the list as drawn: whatever is on screen can be acted on.
  const rowOf = (el) => shown.get(el.closest('[data-key]')?.dataset.key) || null;
  const mark = async (r, el) => {
    const want = el.checked;
    const said = want ? t('{title} is done.', { title: r.title }) : t('{title} is back on your list.', { title: r.title });
    const burst = () => { if (want && document.documentElement.getAttribute('data-gz-motion') === 'expressive') ctx.celebrate?.(el); };
    if (r.custom || !o().sync) {
      // The burst where the box is now: the redraw moves a done item into the Done section.
      burst();
      return save((d) => {
        if (r.custom) { const x = d.tasks.find((y) => y.id === r.id); if (x) x.done = want ? Date.now() : 0; return; }
        // A mark that agrees with Canvas is no mark: the item follows Canvas again (handed in later, say).
        const l = local(d, r.key);
        if (want === L.isDone(r, o().done)) delete l.done; else l.done = want;
        tidy(d, r.key);
      }, said);
    }
    // Ticks go to Canvas: nothing of the student's own changes.
    el.disabled = true;
    try {
      const ov = await write(r, want);
      const it = cache?.items.find((i) => `${i.type}:${i.id}` === r.key);
      if (it) { it.ov = ov; put({ [CACHE]: cache }); }
    } catch {
      // Refused, or no answer to read: Canvas may or may not have it, so the list asks Canvas again.
      el.checked = !want;
      el.disabled = false;
      note(t("Canvas didn't confirm that, so your list is checking with Canvas again."));
      refresh(true);
      return;
    }
    burst();
    note(said);
    render(true);
  };
  const onClick = (e) => {
    const el = e.target.closest('[data-act]');
    if (!el || el.tagName === 'INPUT' || el.tagName === 'FORM') return;
    const act = el.dataset.act;
    const k = el.closest('[data-key]')?.dataset.key;
    if (act === 'add') { form = form ? null : { cid: ctx.canvasCourseId() || '' }; render(true); if (form) box.querySelector('[data-focus="form title"]')?.focus(); return; }
    if (act === 'cancel') { form = null; render(true); box.querySelector('[data-focus="add"]')?.focus(); return; }
    if (act === 'all') { open.add(`group:${el.dataset.group}`); render(true); return; }
    if (!k) return;
    if (act === 'more') { if (open.has(k)) open.delete(k); else open.add(k); render(true); return; }
    if (act === 'edit') { form = { ...data.tasks.find((x) => `task:${x.id}` === k) }; render(true); box.querySelector('[data-focus="form title"]')?.focus(); return; }
    // What changes data only from the student's own click or key, never a script's.
    if (!human(e)) return;
    if (act === 'delete') {
      // Twice, so a stray click can't lose a task.
      if (el.dataset.armed !== '1') { el.dataset.armed = '1'; el.textContent = t('Click again to delete'); return; }
      const title = data.tasks.find((x) => `task:${x.id}` === k)?.title || '';
      open.delete(k);
      save((d) => { d.tasks = d.tasks.filter((x) => `task:${x.id}` !== k); delete d.items[k]; }, t('Deleted {title}.', { title }))
        .then(() => box?.querySelector('[data-focus="add"]')?.focus());
      return;
    }
    const step = el.dataset.step, i = +el.dataset.i;
    if (!['unon', 'unstep', 'unsession'].includes(act)) return;
    save((d) => {
      const l = local(d, k);
      if (act === 'unon') delete l.on;
      else if (act === 'unstep') l.subs = (l.subs || []).filter((x) => x.id !== step);
      else l.sessions = (l.sessions || []).filter((_, j) => j !== i);
      tidy(d, k);
    });
  };
  const onChange = (e) => {
    const el = e.target;
    const k = el.closest('[data-key]')?.dataset.key;
    if (!k || !['done', 'step', 'on'].includes(el.dataset.act)) return;
    // A change a script made (not the student's tick or pick) writes nothing, here or to Canvas: the list is redrawn as it was.
    if (!human(e)) { render(true); return; }
    if (el.dataset.act === 'done') { const r = rowOf(el); if (r) mark(r, el); return; }
    const { act, step } = el.dataset, checked = el.checked, value = el.value;
    save((d) => {
      const l = local(d, k);
      if (act === 'step') { const x = (l.subs || []).find((y) => y.id === step); if (x) x.done = checked; }
      else if (value && L.keyDay(value) !== null) l.on = value;
      else delete l.on;
      tidy(d, k);
    });
  };
  const onSubmit = (e) => {
    const f = e.target;
    e.preventDefault();
    if (!human(e)) return;
    const k = f.closest('[data-key]')?.dataset.key;
    if (f.dataset.act === 'addStep' && k) {
      const title = f.querySelector('input').value.trim();
      if (!title) return;
      const id = uid();
      save((d) => { const l = local(d, k); l.subs = [...(l.subs || []), { id, title, done: false }]; })
        .then(() => box?.querySelector(`[data-focus="${CSS.escape(`${k} stepText`)}"]`)?.focus());
    } else if (f.dataset.act === 'addSession' && k) {
      const [date, time] = (f.querySelector('input[type="datetime-local"]').value || '').split('T');
      const at = L.typed(date, time, who.tz);
      const min = Math.round(+f.querySelector('input[type="number"]').value);
      if (!at || !(min >= 5 && min <= 600)) return note(t('Pick a start and a length from 5 to 600 minutes.'));
      save((d) => { const l = local(d, k); l.sessions = [...(l.sessions || []), { at, min }]; });
    } else if (f.dataset.act === 'saveTask') {
      const v = Object.fromEntries(new FormData(f));
      const title = String(v.title || '').trim();
      if (!title) return;
      const day = L.keyDay(String(v.date || '')) !== null ? v.date : '';
      const at = day && v.time ? L.typed(day, v.time, who.tz) : null;
      const x = { id: form.id || uid(), title, cid: String(v.cid || ''), due: at ? { at } : day ? { day } : null, notes: String(v.notes || ''), done: form.done || 0, at: form.at || Date.now() };
      // The form stays open with what was typed if it couldn't be kept.
      const was = form;
      form = null;
      save((d) => { d.tasks = was.id ? d.tasks.map((y) => (y.id === x.id ? x : y)) : [...d.tasks, x]; }, was.id ? t('Saved {title}.', { title }) : t('Added {title}.', { title })).then((kept) => {
        if (!kept) form = { ...was, draft: Object.fromEntries([...new FormData(f)].map(([n, w]) => [n, String(w)])) };
        if (!kept) render(true);
        box?.querySelector(`[data-focus="${kept ? 'add' : 'form title'}"]`)?.focus();
      });
    }
  };
  // Enter on an item's checkbox opens it, as on its title; Space ticks it (the browser's own).
  const onKey = (e) => {
    if (e.key === 'Enter' && e.target.dataset?.act === 'done') {
      e.preventDefault();
      e.target.closest('.gz-todo-item')?.querySelector('.gz-todo-title')?.click();
    }
  };
  const onToggle = (e) => {
    const k = e.target.dataset?.kind;
    if (k) { if (e.target.open) shut.delete(k); else shut.add(k); }
  };
  const onShow = () => { if (document.visibilityState === 'visible') { render(); refresh(); } };
  const onStore = (changes, area) => {
    if (!L || !who) return;
    if (area === 'sync' && changes.todo) readPrefs().then(() => { render(true); refresh(); });
    if (area === 'local' && changes[key]) { data = L.clean(changes[key].newValue); render(true); }
  };

  // ---- on the page -------------------------------------------------------------------------------------------------
  const start = async () => {
    const g = ++gen;
    try {
      await ctx.need('lib/todo.js', () => globalThis.GZ_TODO);
      if (g !== gen) return;
      L = globalThis.GZ_TODO;
      const [p, list] = await Promise.all([ctx.capi('/users/self/profile'), ctx.canvasCourses(), readPrefs()]);
      if (g !== gen) return;
      if (!/^\d+$/.test(String(p?.id))) throw new Error('no profile');
      who = { uid: String(p.id), tz: L.zone(p.time_zone) };
      coursesIn(list);
      key = L.storeKey(location.origin, who.uid);
      const r = await new Promise((res) => { try { store().get([key, CACHE], res); } catch { res({}); } });
      if (g !== gen) return;
      data = L.clean(r?.[key]);
      cache = r?.[CACHE]?.key === key ? r[CACHE] : null;
      if (!box) return;
      render(true);
      await refresh();
    } catch {
      if (g === gen) fail();
    }
  };
  const sync = (on) => {
    if (!on || dead) return off();
    // Canvas's list: the React one, or (a teacher's, server-drawn) a heading and a list.
    let native = document.querySelector('#right-side .Sidebar__TodoListContainer') || document.querySelector('#right-side ul.to-do-list');
    if (native?.previousElementSibling?.matches('.todo-list-header')) native = native.previousElementSibling;
    if (!native) return;
    if (!box) {
      head = make('div', { className: 'gz-todo-head' });
      line = make('p', { className: 'gz-todo-say', role: 'status' });
      body = make('div', { className: 'gz-todo-body' });
      box = make('section', { id: 'gz-todo', className: 'gz-todo' }, head, line, body);
      box.setAttribute('aria-labelledby', 'gz-todo-title');
      box.addEventListener('click', onClick);
      box.addEventListener('change', onChange);
      box.addEventListener('submit', onSubmit);
      box.addEventListener('keydown', onKey);
      box.addEventListener('toggle', onToggle, true);
      document.addEventListener('visibilitychange', onShow);
      addEventListener('focus', onShow);
      try { chrome.storage.onChanged.addListener(onStore); } catch { /* reloaded */ }
      setBusy(true);
    }
    if (box.nextElementSibling !== native) native.before(box);
    if (!started) started = start();
    else if (who) render();
  };
  const off = () => {
    gen++;
    if (!box) return;
    box.remove();
    box = null;
    started = null;
    drawn = '';
    document.removeEventListener('visibilitychange', onShow);
    removeEventListener('focus', onShow);
    try { chrome.storage.onChanged.removeListener(onStore); } catch { /* reloaded */ }
  };
  // "Add task" from the palette: the form, open and focused.
  const add = () => {
    if (!box || !who) return false;
    form = { cid: ctx.canvasCourseId() || '' };
    render(true);
    box.scrollIntoView({ block: 'nearest' });
    box.querySelector('[data-focus="form title"]')?.focus();
    return true;
  };

  // The command palette's entries while the list is on the page.
  const cmds = () => (box && who ? [{ label: t('Add task'), hint: 'Glaze', group: 'Glaze', run: add }] : []);

  return { sync, add, cmds };
})();

GZ_TODO_UI;
