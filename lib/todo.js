// Better To Do (Canvas): the parts that don't touch the page, so node can test them. Days are counted in the student's
// Canvas time zone (their profile's), not the browser's, and only through Intl: nothing parses English.
// Classic script; module.exports for node. Loaded on demand (features/todo.js asks for it): a second injection keeps the first.
var GZ_TODO = globalThis.GZ_TODO || (() => {
  const DAY = 864e5;

  // Its settings (storage.sync `todo`; the switch itself is enhance.todo), added to GZ_SPEC from here so the first
  // content script doesn't carry them: the editor loads this file before it reads settings, and features/todo.js
  // cleans what it reads through GZ_SANITIZE once this is in. span: this week, or n days or weeks from the week
  // start; past: how long overdue work stays; done: auto (submissions) or manual; sync: marks go to Canvas's planner.
  const SPEC = {
    span: ['week', ['week', 'custom']], n: [7, [1, 60]], unit: ['days', ['days', 'weeks']],
    start: ['rolling', ['rolling', 'monday', 'sunday', 'saturday']], past: ['week', ['never', '3days', 'week', 'month', 'always']],
    rel: [false, 'bool'], urgent: [true, 'bool'], teacher: [true, 'bool'], progress: [true, 'bool'], done: ['auto', ['auto', 'manual']],
    group: [true, 'bool'], sync: [false, 'bool'],
    // Tasks on the Dashboard's course cards (the switch is enhance.cardTasks): how many, their status, done ones crossed out.
    cardN: [4, [1, 10]], cardStatus: [true, 'bool'], cardCross: [false, 'bool'],
    // Gradescope's assignments (the switch is enhance.gradescope) also read once a day from Canvas, not only on a visit.
    gsDaily: [false, 'bool'],
    // The calendar file (lib/calexport.js): what goes in it and how far ahead, remembered from the last export.
    icsDue: [true, 'bool'], icsTasks: [true, 'bool'], icsPlan: [true, 'bool'], icsGs: [true, 'bool'], icsClasses: [true, 'bool'], icsRange: ['4w', ['2w', '4w', '8w', '16w', 'term']],
  };
  (typeof GZ_SPEC !== 'undefined' ? GZ_SPEC : require('../defaults.js').GZ_SPEC).todo = SPEC;

  // ---- days in a time zone ------------------------------------------------------------------------------------
  // A day is a number: days since 1970-01-01 of the calendar date (not of an instant), so a date is the same
  // number in every zone, and "tomorrow" is +1 across a DST change.
  const zone = (tz) => { try { return (tz && new Intl.DateTimeFormat('en', { timeZone: tz }).resolvedOptions().timeZone) || undefined; } catch { return undefined; } };
  const fmts = new Map();
  const parts = (ms, tz) => {
    if (!fmts.has(tz)) fmts.set(tz, new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' }));
    const p = Object.fromEntries(fmts.get(tz).formatToParts(ms).map((x) => [x.type, +x.value]));
    return Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second);
  };
  const dayOf = (ms, tz) => Math.floor(parts(ms, tz) / DAY);
  const dayKey = (n) => new Date(n * DAY).toISOString().slice(0, 10);
  // A 'YYYY-MM-DD' that names a real date (not 2026-02-30), as a day number; anything else null.
  const keyDay = (k) => {
    if (typeof k !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(k)) return null;
    const n = Date.UTC(+k.slice(0, 4), +k.slice(5, 7) - 1, +k.slice(8)) / DAY;
    return dayKey(n) === k ? n : null;
  };
  // The instant a wall-clock time (minutes into day n) happens in tz, by one rule for every zone (Temporal's
  // "compatible"): a time that happens twice (the fall-back hour) is the earlier; a time the clocks skip is read with
  // the offset from before the change, so it lands past the gap by the gap's length (2:30 in New York, Berlin or
  // Sydney is 3:30; 2:15 on Lord Howe's half-hour change is 2:45). Offsets a day either side are before and after it.
  const offset = (ms, tz) => parts(ms, tz) - Math.floor(ms / 1000) * 1000;
  const instant = (n, minutes, tz) => {
    const wall = n * DAY + minutes * 6e4;
    const early = wall - offset(wall - DAY, tz), late = wall - offset(wall + DAY, tz);
    const fits = [early, late].filter((ms) => parts(ms, tz) === wall);
    return fits.length ? Math.min(...fits) : early;
  };
  const midnight = (n, tz) => instant(n, 0, tz);
  // A date and time typed into the page's inputs ('2026-10-16', '15:30'), read in tz.
  const typed = (date, time, tz) => {
    const n = keyDay(date);
    const m = /^(\d{2}):(\d{2})$/.exec(time || '');
    return n === null || !m ? null : instant(n, +m[1] * 60 + +m[2], tz);
  };
  // The other way, for an input's value: { date: '2026-10-16', time: '15:30' }.
  const inputs = (ms, tz) => { const iso = new Date(parts(ms, tz)).toISOString(); return { date: iso.slice(0, 10), time: iso.slice(11, 16) }; };
  const weekday = (n) => new Date(n * DAY).getUTCDay(); // 0 is Sunday

  // ---- the window -------------------------------------------------------------------------------------------
  const PAST = { never: 0, '3days': 3, week: 7, month: 30, always: 180 }; // ponytail: "always" is half a year back
  const START = { sunday: 0, monday: 1, saturday: 6 };
  // o: the todo settings. Days as numbers: what the list covers [today - past, to), and where "this week" ends.
  const span = (o, today) => {
    const ws = START[o.start];
    const weekEnd = ws === undefined ? today + 7 : today + (((ws - weekday(today) + 7) % 7) || 7);
    const to = o.span !== 'custom' ? weekEnd
      : o.unit === 'weeks' ? (ws === undefined ? today : weekEnd - 7) + 7 * o.n
        : today + o.n;
    return { past: today - PAST[o.past], to, weekEnd: Math.min(weekEnd, to) };
  };
  // What to ask Canvas's planner for: a week back at least (announcements, what was done lately), and seven days
  // ahead at least (the popup's due list comes from the same answer), a day of slack each side.
  const fetchRange = (o, now, tz) => {
    const today = dayOf(now, tz);
    const { to } = span(o, today);
    const start = midnight(today - Math.max(PAST[o.past], 7) - 1, tz);
    const end = Math.max(midnight(to + 1, tz), now + 8 * DAY);
    return { start: new Date(start).toISOString(), end: new Date(end).toISOString() };
  };

  // ---- Canvas's planner items, kept small -------------------------------------------------------------------------
  // A path on the site the item came from, never another site's address.
  const path = (u) => { const p = String(u || '').replace(/^https?:\/\/[^/]+/, ''); return /^\/(?!\/)/.test(p) ? p : ''; };
  const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
  // Canvas's ids are digits; Blackboard Ultra's are _N_N (lib/ultra.js gives its items in this same shape).
  const ID = /^(?:\d+|_\d+_\d+)$/;
  const id = (v) => (ID.test(String(v ?? '')) ? String(v) : '');
  const slim = (i) => {
    const p = i?.plannable || {};
    const s = i?.submissions;
    const ov = i?.planner_override;
    return {
      type: str(i?.plannable_type, 40), id: id(i?.plannable_id), cid: id(i?.course_id), course: str(i?.context_name, 120),
      title: str(p.title || p.name, 300), at: Date.parse(i?.plannable_date) || null, url: i?.plannable_type === 'planner_note' ? '' : path(i?.html_url),
      sub: s && typeof s === 'object' ? { submitted: !!s.submitted, excused: !!s.excused, graded: !!s.graded, late: !!s.late, missing: !!s.missing, redo: !!s.redo_request } : null,
      ov: ov && id(ov.id) ? { id: id(ov.id), done: !!ov.marked_complete, dismissed: !!ov.dismissed } : null,
      aid: id(p.assignment_id), read: p.read_state === 'read', note: str(p.details, 2000), ws: str(p.workflow_state, 20), allDay: !!p.all_day,
    };
  };
  // /users/self/todo for a teacher: work waiting to be graded.
  const slimGrading = (x) => ({
    aid: id(x?.assignment?.id), cid: id(x?.course_id), course: str(x?.context_name, 120), title: str(x?.assignment?.name, 300),
    n: Number.isInteger(x?.needs_grading_count) ? x.needs_grading_count : 0, at: Date.parse(x?.assignment?.due_at) || null, url: path(x?.html_url),
  });

  // ---- where an item stands ----------------------------------------------------------------------------------
  // done: Canvas's rule (handed in, and no resubmission asked for; a peer review completed), and also excused or
  // graded, which leave nothing to do (Canvas's own list keeps those open). A mark (the student's, in Canvas's planner or in Glaze) wins either way;
  // manual: only a mark counts.
  // A resubmission asked for keeps it open, graded or not.
  const auto = (i) => (i.type === 'assessment_request' ? i.ws === 'completed' : !!i.sub && !i.sub.redo && (i.sub.submitted || i.sub.excused || i.sub.graded));
  const isDone = (i, mode, mark) => (mark !== undefined ? mark : i.ov ? i.ov.done : mode === 'manual' ? false : auto(i));
  // The word beside it, as an English key for t(): what Canvas knows, else what the student marked.
  const status = (i, done) => {
    const s = i.sub || {};
    if (s.excused) return 'Excused';
    if (s.graded) return 'Graded';
    if (s.submitted) return s.late ? 'Submitted late' : 'Submitted';
    if (done) return 'Done';
    if (s.missing) return 'Missing';
    return '';
  };

  // ---- the list -----------------------------------------------------------------------------------------------
  const GROUPS = ['past', 'today', 'tomorrow', 'week', 'later', 'none'];
  const TYPES = new Set(['assignment', 'quiz', 'discussion_topic', 'wiki_page', 'planner_note', 'assessment_request', 'sub_assignment', 'gradescope']);
  // Everything the list shows.
  //   items: slim planner items; grading: slimGrading rows (teachers); data: the student's own ({ tasks, items });
  //   o: the todo settings; cids: the courses to show (hidden, concluded and past ones are not in it), or null for any;
  //   course: a course page's id ('' on the Dashboard); names: course id -> name; sync: marks go to Canvas.
  // Returns { groups: [[kind, rows]] (in order, empty ones left out), done, graded, unread, read, grading, count }.
  const build = ({ items = [], grading = [], data, o, now, tz, cids = null, course = '', names = {}, sync = false }) => {
    const today = dayOf(now, tz);
    const { past, to, weekEnd } = span(o, today);
    const d = clean(data);
    const shown = (cid) => (cid ? (course ? cid === course : !cids || cids.has(cid)) : !course);
    const plan = (x) => {
      const on = keyDay(x.on);
      const next = (x.sessions || []).filter((s) => s.at + s.min * 6e4 > now).map((s) => dayOf(s.at, tz));
      const days = [...(on !== null && on >= today ? [on] : []), ...next];
      return days.length ? Math.min(...days) : null;
    };
    const rows = [];
    const out = { groups: [], done: [], graded: [], unread: [], read: [], grading: [], count: { done: 0, all: 0 } };
    for (const i of items) {
      if (!i?.id || !shown(i.cid)) continue;
      if (i.type === 'announcement') {
        if (i.at && i.at <= now) (i.read ? out.read : out.unread).push({ ...i, key: `announcement:${i.id}`, kind: 'announcement' });
        continue;
      }
      if (!TYPES.has(i.type) || i.ov?.dismissed) continue;
      const key = `${i.type}:${i.id}`;
      const local = d.items[key] || {};
      // A Gradescope item has no Canvas planner to tick in: its tick stays on this device, sync or not.
      const done = isDone(i, o.done, sync && i.type !== 'gradescope' ? undefined : local.done);
      const allDay = i.allDay;
      rows.push({
        ...i, key, done, status: status(i, done), canMark: true, allDay,
        day: i.at ? (allDay ? Math.floor(i.at / DAY) : dayOf(i.at, tz)) : null,
        local, plan: plan(local), course: i.course || names[i.cid] || '',
      });
    }
    for (const x of d.tasks) {
      if (!shown(x.cid)) continue;
      const local = d.items[`task:${x.id}`] || {};
      const day = x.due ? (x.due.day ? keyDay(x.due.day) : dayOf(x.due.at, tz)) : null;
      rows.push({
        type: 'task', id: x.id, key: `task:${x.id}`, cid: x.cid, course: names[x.cid] || '', title: x.title, url: '', note: x.notes,
        at: x.due ? (x.due.day ? midnight(day + 1, tz) - 1 : x.due.at) : null, allDay: !!x.due?.day, day,
        done: !!x.done, doneAt: x.done || 0, status: x.done ? 'Done' : '', canMark: true, custom: true, local, plan: plan(local),
      });
    }
    const groups = Object.fromEntries(GROUPS.map((g) => [g, []]));
    for (const r of rows) {
      r.past = r.at !== null && (r.allDay ? r.day < today : r.at < now);
      if (r.done) {
        // What was done lately: due in the window (or this past week), or a task ticked off this week.
        if (r.day === null ? r.doneAt > now - 7 * DAY : r.day >= Math.min(past, today - 7) && r.day < to) {
          (r.status === 'Graded' || r.status === 'Excused' ? out.graded : out.done).push(r);
        }
        continue;
      }
      r.urgent = !!o.urgent && (r.past || (r.at !== null && (r.allDay ? r.day === today : r.at - now < DAY)));
      // A plan never hides a deadline: an item shows under its due date until it's done and, planned for another
      // day, under that day too (its row says "planned for"). With no due date, the plan is where it goes.
      const at = (d) => (d <= today ? 'today' : d === today + 1 ? 'tomorrow' : d < weekEnd ? 'week' : d < to ? 'later' : null);
      const due = r.past ? (o.past !== 'never' && r.day >= past ? 'past' : null) : r.day === null ? (r.plan === null ? 'none' : null) : at(r.day);
      for (const g of new Set([due, r.plan === null ? null : at(r.plan)])) if (g) groups[g].push(r);
    }
    const order = (a, b) => (a.at ?? Infinity) - (b.at ?? Infinity) || a.title.localeCompare(b.title);
    if (o.group) out.groups = GROUPS.map((g) => [g, groups[g].sort(order)]).filter(([, l]) => l.length);
    else {
      const all = [...new Set(GROUPS.flatMap((g) => groups[g]))].sort(order);
      if (all.length) out.groups = [['all', all]];
    }
    out.done.sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
    out.graded.sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
    out.unread.sort((a, b) => b.at - a.at);
    out.read.sort((a, b) => b.at - a.at);
    out.grading = grading.filter((g) => g.aid && g.n > 0 && shown(g.cid)).map((g) => ({ ...g, key: `grade:${g.aid}`, course: g.course || names[g.cid] || '' }))
      .sort((a, b) => (a.at ?? Infinity) - (b.at ?? Infinity));
    const open = new Set(out.groups.flatMap(([, l]) => l)).size; // a planned item can show twice; it counts once
    out.count = { done: out.done.length + out.graded.length, all: open + out.done.length + out.graded.length };
    return out;
  };
  // A course card's rows (features/cardtasks.js), from build() for that course: what's open on the list and has a
  // date, and with cross set, what's done and not yet past (crossed out; else left off), soonest first, up to n.
  // Work with no due date counts if it's planned (a "do on" day or a focus session), at the start of that day in tz.
  const card = (b, n, cross, tz) => {
    const when = (r) => r.at ?? midnight(r.plan, tz);
    return [...new Set(b.groups.flatMap(([, l]) => l)), ...(cross ? [...b.done, ...b.graded].filter((r) => !r.past) : [])]
      .filter((r) => r.at !== null || r.plan !== null).sort((a, b) => when(a) - when(b) || a.title.localeCompare(b.title)).slice(0, n);
  };
  // Teachers: submissions graded out of all handed in, over what's on the list ({ aid: { graded, ungraded } }).
  const graded = (rows, sums) => rows.reduce((c, r) => {
    const s = sums?.[r.aid];
    return s ? { graded: c.graded + (s.graded || 0), all: c.all + (s.graded || 0) + (s.ungraded || 0) } : c;
  }, { graded: 0, all: 0 });

  // ---- how a date reads ------------------------------------------------------------------------------------------
  // { rel: 'in 2 days', abs: 'Thu 11:59 PM' } for a moment ({ at }) or a whole day ({ allDay: true, day }), in lang,
  // in tz. A whole day has no time and is the same calendar day everywhere.
  const rtfs = new Map();
  const label = ({ at, allDay, day: whole }, now, tz, lang) => {
    if (!rtfs.has(lang)) rtfs.set(lang, new Intl.RelativeTimeFormat(lang, { numeric: 'auto' }));
    const rtf = rtfs.get(lang);
    const day = allDay ? whole : dayOf(at, tz);
    const days = day - dayOf(now, tz);
    let rel;
    if (days === 0 && !allDay) {
      const min = Math.round((at - now) / 6e4);
      rel = Math.abs(min) < 60 ? rtf.format(min, 'minute') : rtf.format(Math.round(min / 60), 'hour');
    } else if (Math.abs(days) < 7) rel = rtf.format(days, 'day');
    else if (Math.abs(days) < 60) rel = rtf.format(Math.round(days / 7), 'week');
    else rel = rtf.format(Math.round(days / 30), 'month');
    const near = Math.abs(days) < 7;
    const abs = new Date(allDay ? day * DAY : at).toLocaleString(lang, {
      timeZone: allDay ? 'UTC' : tz, weekday: 'short', ...(!near && { month: 'short', day: 'numeric' }), ...(!allDay && { hour: 'numeric', minute: '2-digit' }),
    });
    return { rel, abs };
  };

  // ---- the student's own data -----------------------------------------------------------------------------------
  // Kept in storage.local under one key per site (Canvas or Blackboard Ultra) and user, and in the editor's backup file.
  // Everything that comes back from storage or a file goes through clean().
  const storeKey = (origin, uid) => `todo:${origin}/${uid}`;
  const STORE_KEY = /^todo:https?:\/\/[a-z\d.-]+(?::\d+)?\/(?:\d+|_\d+_\d+)$/i;
  const ITEM_KEY = /^(?:[a-z_]+:(?:\d+|_\d+_\d+)|task:[\w-]{1,40})$/;
  const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
  const text = (v, n) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, n) : '');
  const when = (v) => (Number.isFinite(v) && v > 0 && v < 1e14 ? v : 0);
  const due = (v) => (!isObj(v) ? null : keyDay(v.day) !== null ? { day: v.day } : when(v.at) ? { at: v.at } : null);
  const local = (x) => {
    const out = {};
    if (keyDay(x?.on) !== null) out.on = x.on;
    if (typeof x?.done === 'boolean') out.done = x.done;
    const sessions = (Array.isArray(x?.sessions) ? x.sessions : []).filter((s) => when(s?.at) && Number.isInteger(s.min) && s.min >= 5 && s.min <= 600)
      .slice(0, 20).map((s) => ({ at: s.at, min: s.min })).sort((a, b) => a.at - b.at);
    if (sessions.length) out.sessions = sessions;
    const subs = (Array.isArray(x?.subs) ? x.subs : []).filter((s) => /^[\w-]{1,40}$/.test(s?.id) && text(s.title, 200)).slice(0, 50)
      .map((s) => ({ id: s.id, title: text(s.title, 200), done: !!s.done }));
    if (subs.length) out.subs = subs;
    return out;
  };
  const clean = (raw) => {
    const tasks = (Array.isArray(raw?.tasks) ? raw.tasks : []).filter((x) => /^[\w-]{1,40}$/.test(x?.id) && text(x.title, 300)).slice(0, 500)
      .map((x) => ({ id: x.id, title: text(x.title, 300), cid: id(x.cid), due: due(x.due), notes: typeof x.notes === 'string' ? x.notes.slice(0, 2000) : '', done: when(x.done), at: when(x.at) }));
    const ids = new Set(tasks.map((x) => `task:${x.id}`));
    const items = Object.fromEntries((isObj(raw?.items) ? Object.entries(raw.items) : [])
      .filter(([k]) => ITEM_KEY.test(k) && (!k.startsWith('task:') || ids.has(k)))
      .map(([k, v]) => [k, local(v)]).filter(([, v]) => Object.keys(v).length).slice(0, 2000));
    return { tasks, items };
  };

  // ---- writes: one at a time, in the background worker (lib/background.js 'glaze:todo') ----
  // Every change to the student's own data goes through change(), run in the worker's one write queue, so the tabs of
  // every Canvas site and the editor take turns, and each change is applied to what storage holds when its turn
  // comes. area: { sync, local }, each { get(keys) → object, set(patch) → bool, remove(keys) → bool }.

  // A change from a Canvas page, as data (it crosses from the page to the worker): [op, ...args] on one account's
  // { tasks, items }. Anything it can't apply does nothing; clean() checks what's left.
  const edit = (d, [op, k, a, b] = []) => {
    if (op === 'task') { const x = clean({ tasks: [k] }).tasks[0]; if (x) d.tasks = d.tasks.some((y) => y.id === x.id) ? d.tasks.map((y) => (y.id === x.id ? x : y)) : [...d.tasks, x]; return; }
    // A task another feature keeps up to date (a syllabus date): its title, course and due date change, while whether
    // it's done, when it was made, its notes and its steps (items) stay the student's.
    if (op === 'importTask') {
      const x = clean({ tasks: [k] }).tasks[0];
      const y = x && d.tasks.find((t) => t.id === x.id);
      if (y) Object.assign(y, { title: x.title, cid: x.cid, due: x.due });
      else if (x) d.tasks = [...d.tasks, { ...x, done: 0 }];
      return;
    }
    if (op === 'taskDone') { const x = d.tasks.find((y) => y.id === k); if (x) x.done = when(a); return; }
    if (op === 'dropTask') { d.tasks = d.tasks.filter((y) => y.id !== k); delete d.items[`task:${k}`]; return; }
    if (typeof k !== 'string' || !ITEM_KEY.test(k)) return;
    const l = (d.items[k] ||= {});
    if (op === 'on') { if (keyDay(a) !== null) l.on = a; else delete l.on; }
    else if (op === 'done') { if (typeof a === 'boolean') l.done = a; else delete l.done; }
    else if (op === 'addStep') l.subs = [...(l.subs || []), a];
    else if (op === 'step') { const x = (l.subs || []).find((y) => y.id === a); if (x) x.done = !!b; }
    else if (op === 'dropStep') l.subs = (l.subs || []).filter((y) => y.id !== a);
    else if (op === 'addSession') l.sessions = [...(l.sessions || []), a];
    else if (op === 'dropSession') l.sessions = (l.sessions || []).filter((y) => y.at !== a?.at || y.min !== a?.min);
    if (!Object.keys(l).length) delete d.items[k];
  };

  // Restoring a backup: its Better To Do data (storage.local) and its settings (storage.sync) together, or neither.
  // The tasks go first; if the settings then don't take, what those keys held before is put back. local, sync: the
  // storage areas, whose set and remove resolve false (or reject) when they fail. → { ok } and, if putting the
  // tasks back failed too, undone: false (the imported tasks may still be in storage).
  const took = async (p) => { try { return (await p) !== false; } catch { return false; } };
  const restore = async (tasks, settings, local, sync) => {
    const keys = Object.keys(tasks);
    const before = keys.length ? await local.get(keys) : {};
    if (keys.length && !await took(local.set(tasks))) return { ok: false };
    if (await took(sync.set(settings))) return { ok: true };
    const gone = keys.filter((k) => !(k in before));
    const undone = (!Object.keys(before).length || await took(local.set(before))) && (!gone.length || await took(local.remove(gone)));
    return undone ? { ok: false } : { ok: false, undone: false };
  };

  // The planner answer (storage.local todoCache, shared by the list and the course cards, features/todo.js and
  // cardtasks.js) and the due list made from it: m { key, cache, due }. Kept in the worker's queue turn only if what's
  // stored for the account isn't newer (at, when it was asked for), so a slow answer never replaces a newer one,
  // whichever tab or feature asked. The same answer kept again (grading counts, a Canvas mark) is not older.
  // → { ok, kept } and, when a newer one stands, that one (cache).
  const publishIn = async (m, local) => {
    const c = m.cache;
    if (!isObj(c) || c.key !== m.key || !when(c.at) || !Array.isArray(c.items)) return { ok: false, error: 'bad' };
    const cur = (await local.get(['todoCache'])).todoCache;
    if (isObj(cur) && cur.key === c.key && cur.at > c.at) return { ok: true, kept: false, cache: cur };
    const due = Array.isArray(m.due) ? { dueWeek: m.due.slice(0, 200), dueWeekAt: c.at, dueWeekFrom: m.key.slice(5, m.key.lastIndexOf('/')) } : {};
    return (await local.set({ todoCache: c, ...due })) ? { ok: true, kept: true } : { ok: false, error: 'write' };
  };

  // Work handed in between two planner answers (todoCache, the same account): an item whose submission was open and now
  // isn't. → how many. A page that reads the planner tells its Look (the 'submit' moment, content.js) when a newer answer
  // stored by this or another tab shows one; an item first seen already handed in, or whose submission Ultra didn't know, isn't one.
  const handedIn = (was, now) => {
    if (!isObj(was) || !isObj(now) || was.key !== now.key || !Array.isArray(was.items) || !Array.isArray(now.items)) return 0;
    const item = (i) => (isObj(i) ? `${i.type} ${i.id}` : '');
    const open = new Set(was.items.filter((i) => isObj(i) && isObj(i.sub) && !i.sub.submitted && i.id).map(item));
    return now.items.filter((i) => isObj(i) && isObj(i.sub) && i.sub.submitted && open.has(item(i))).length;
  };
  if (globalThis.GZ_CTX?.moment) {
    try { chrome.storage.onChanged.addListener((c, area) => { if (area === 'local' && c.todoCache && handedIn(c.todoCache.oldValue, c.todoCache.newValue)) GZ_CTX.moment('submit'); }); } catch { /* no storage here */ }
  }

  // m: { key, edits } from a Canvas page (edits: up to 20 of edit()'s), or { restore: { tasks, settings } } from the
  // editor. → { ok, data (the account's, as stored) } or { ok: false, error | undone }.
  const change = async (m, area) => {
    if (m?.restore) {
      const tasks = Object.fromEntries(Object.entries(m.restore.tasks || {}).filter(([k]) => STORE_KEY.test(k)).map(([k, v]) => [k, clean(v)]));
      return isObj(m.restore.settings) ? restore(tasks, m.restore.settings, area.local, area.sync) : { ok: false, error: 'bad' };
    }
    if (typeof m?.key !== 'string' || !STORE_KEY.test(m.key)) return { ok: false, error: 'bad' };
    if (m.cache) return publishIn(m, area.local);
    if (!Array.isArray(m.edits)) return { ok: false, error: 'bad' };
    const d = clean((await area.local.get([m.key]))[m.key]);
    for (const e of m.edits.slice(0, 20)) if (Array.isArray(e)) edit(d, e);
    const next = clean(d);
    return (await area.local.set({ [m.key]: next })) ? { ok: true, data: next } : { ok: false, error: 'write' };
  };

  // Gradescope's assignments (lib/gradescope.js) for a list on a Canvas page, once the student has turned them on: a
  // getter (now, uid) => that Canvas user's items, [] until that file is in; ask(uid) and answer(uid, show) for the
  // one-time "show this Gradescope account's work here?"; redraw() is called when anything arrives or changes.
  const gradescope = (redraw) => {
    let src = null;
    const on = () => { const s = globalThis.GZ_CTX?.settings?.(); return s?.enabled !== false && !!s?.enhance?.gradescope; };
    const get = (now, uid) => {
      if (!on()) return [];
      if (!src) {
        src = () => [];
        globalThis.GZ_CTX.need('lib/gradescope.js', () => globalThis.GZ_GRADESCOPE).then(() => { src = GZ_GRADESCOPE.source(redraw); }, () => { src = null; });
      }
      return src(now, uid);
    };
    get.ask = (uid) => (on() && src?.ask ? src.ask(uid) : null);
    get.answer = (uid, show, acct) => src?.answer?.(uid, show, acct);
    // The question as one quiet line, the same wherever it's asked (Better To Do, above the first card's tasks, the
    // reminders hub): an element, or null when there's nothing to ask. Either button answers for this Canvas account
    // everywhere at once (one answer, kept by the worker); only a person's click counts. t: the page's words.
    get.question = (uid, t, cls = '') => {
      const asked = get.ask(uid); // { id, name }: the Gradescope account this question is about
      if (!asked) return null;
      const { name } = asked;
      const make = (tag, props) => Object.assign(document.createElement(tag), props);
      const line = make('p', { className: `gz-gs-ask ${cls}`.trim() });
      line.dataset.ask = `${asked.id} ${name}`;
      const button = (label, show) => {
        const b = make('button', { type: 'button', textContent: label });
        b.dataset.focus = `gs ${show ? 'yes' : 'no'}`;
        b.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation(); // not the card's link, nor the list's or the hub's own handlers
          if (e.isTrusted && (globalThis.navigator?.userActivation?.isActive ?? true)) get.answer(uid, show, asked.id);
        });
        return b;
      };
      line.append(make('span', { textContent: name ? t('Show Gradescope work from {name} here?', { name }) : t('Show your Gradescope work here?') }),
        button(t('Show'), true), button(t('Not here'), false));
      return line;
    };
    return get;
  };

  return { gradescope, handedIn, edit, change, restore, SPEC, DAY, ID, zone, dayOf, dayKey, keyDay, midnight, typed, inputs, span, fetchRange, slim, slimGrading, isDone, status, build, card, graded, label, storeKey, STORE_KEY, clean };
})();

if (typeof module !== 'undefined') module.exports = GZ_TODO; else GZ_TODO;
