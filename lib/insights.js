// Insights (Canvas, W17): the student's term in numbers, worked out on the device from what Canvas already tells them
// about their own work (features/insights.js reads it, read-only, with their session). another extension's version is
// hosted and unknown, so this is Glaze's own: how much was handed in on time, each course's grade over the term, how
// the work spreads over the weeks, and how often the student's own Better To Do plans were kept. Nothing here tracks
// anything new: no timers, no "minutes spent", no comparison with anyone else.
// Days are lib/todo.js day numbers in the student's Canvas time zone; grades are lib/gradecalc.js's (Canvas's rules).
// Classic script, loaded on demand after those two (a second injection keeps the first); the service worker loads it
// for change(); module.exports for node.
var GZ_INSIGHTS = globalThis.GZ_INSIGHTS || (() => {
  const lib = (name, file) => globalThis[name] || require(file);
  const DAY = 864e5;
  const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
  const arr = (v) => (Array.isArray(v) ? v : []);
  const when = (v) => (Number.isFinite(v) && v > 0 && v < 1e14 ? v : 0);
  const text = (v, n) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, n) : '');
  const id = (v) => (/^\d{1,20}$/.test(String(v ?? '')) ? String(v) : '');

  // ---- the term ---------------------------------------------------------------------------------------------------
  // The student's courses that are on now: active, theirs as a student, open to them, and begun and not ended (a
  // course's own dates when it keeps to them, else its term's; no dates, as Canvas's default term has, counts as on).
  // → { key (the terms' ids, which names the cache), name (the term's, when it has dates; else ''), from, to (ms or 0),
  //   courses }.
  const term = (list, now) => {
    const dates = (c) => (c.restrict_enrollments_to_course_dates ? c : c.term || {});
    const courses = arr(list).filter((c) => id(c?.id) && c.name && !c.access_restricted_by_date && arr(c.enrollments).some((e) => e?.type === 'student'))
      .filter((c) => { const d = dates(c); return !(Date.parse(d.start_at) > now) && !(Date.parse(d.end_at) <= now); });
    const starts = courses.map((c) => Date.parse(dates(c).start_at)).filter(Number.isFinite);
    const ends = courses.map((c) => Date.parse(dates(c).end_at)).filter(Number.isFinite);
    const named = new Map();
    for (const c of courses) if (c.term?.name && (c.term.start_at || c.term.end_at)) named.set(c.term.name, (named.get(c.term.name) || 0) + 1);
    return {
      key: [...new Set(courses.map((c) => id(c.term?.id) || '-'))].sort().join(','),
      name: [...named].sort((a, b) => b[1] - a[1])[0]?.[0] || '',
      from: starts.length ? Math.min(...starts) : 0, to: ends.length ? Math.max(...ends) : 0, courses,
    };
  };

  // ---- one course's work ------------------------------------------------------------------------------------------
  // An assignment (with its submission, from /assignment_groups) as Insights keeps it: k, its key in Better To Do's
  // plans (a classic quiz and a graded discussion are planned under their own ids); n, name; d, due; p, points; a, when
  // handed in; s, where it stands, as Canvas says: excused, late, missing, on (handed in, or graded, and not late),
  // open (nothing yet, not due yet), or '' (past due, nothing handed in, and Canvas doesn't call it missing: work done
  // on paper or with nothing to hand in).
  const item = (x, now) => {
    const s = isObj(x?.submission) ? x.submission : {};
    const d = when(Date.parse(x.due_at)), a = when(Date.parse(s.submitted_at));
    const graded = s.score != null && s.workflow_state === 'graded';
    const st = s.excused ? 'excused' : s.late ? 'late' : s.missing ? 'missing' : a || graded ? 'on' : !d || d > now ? 'open' : '';
    const k = id(x.quiz_id) ? `quiz:${x.quiz_id}` : id(x.discussion_topic?.id) ? `discussion_topic:${x.discussion_topic.id}` : `assignment:${id(x.id)}`;
    return { k, n: text(x.name, 120), d, p: Math.max(0, Number(x.points_possible) || 0), a, s: st };
  };
  // A course's grade after each graded piece of work, in date order (its due date, else when it was graded or handed
  // in): Canvas's current score (lib/gradecalc.js) with the work graded later left out. Work graded on the same day
  // makes one point; graded work with no date at all counts from the start. → [[ms, percent]], the last 40.
  // info: lib/gradecalc.js fromApi's (weights, grading periods).
  const trend = (groups, info, tz) => {
    const C = lib('GZ_GRADECALC', './gradecalc.js'), T = lib('GZ_TODO', './todo.js');
    const course = C.fromApi(groups, info);
    const dated = [];
    for (const g of arr(groups)) {
      for (const x of arr(g?.assignments)) {
        const s = x?.submission || {};
        if (s.score == null || s.score === '' || s.excused) continue;
        const at = when(Date.parse(x.due_at)) || when(Date.parse(s.graded_at)) || when(Date.parse(s.submitted_at));
        if (at) dated.push([String(x.id), at]);
      }
    }
    dated.sort((a, b) => a[1] - b[1]);
    const out = [];
    for (let i = 0; i < dated.length; i++) {
      if (i + 1 < dated.length && T.dayOf(dated[i + 1][1], tz) === T.dayOf(dated[i][1], tz)) continue;
      const pct = C.calc(course, { hidden: dated.slice(i + 1).map(([x]) => x) }).current;
      if (pct != null) out.push([dated[i][1], C.round2(pct)]);
    }
    return out.slice(-40);
  };

  // ---- what the view shows ----------------------------------------------------------------------------------------
  const DECIDED = ['on', 'late', 'missing'];
  // How a list of items stands: counts, the share on time of what was decided (excused work left out), and how many
  // went in a day or more early.
  const tally = (items) => {
    const c = { on: 0, late: 0, missing: 0, excused: 0, early: 0, share: null };
    for (const i of items) {
      if (i.s in c) c[i.s]++;
      if (i.s === 'on' && i.a && i.d && i.d - i.a >= DAY) c.early++;
    }
    const all = c.on + c.late + c.missing;
    c.share = all ? c.on / all : null;
    return c;
  };
  // Weeks start on Monday. ponytail: one week start for everyone; follow Better To Do's own if students ask.
  const week = (day) => day - ((day + 3) % 7);
  // The best run of weeks in a row where everything due that week was on time, and the run going now. Weeks with
  // nothing decided don't count and don't break a run.
  const runs = (items, tz) => {
    const T = lib('GZ_TODO', './todo.js');
    const weeks = new Map();
    for (const i of items) if (i.d && DECIDED.includes(i.s)) { const w = week(T.dayOf(i.d, tz)); weeks.set(w, (weeks.get(w) ?? true) && i.s === 'on'); }
    let best = 0, now = 0;
    for (const w of [...weeks.keys()].sort((a, b) => a - b)) { now = weeks.get(w) ? now + 1 : 0; best = Math.max(best, now); }
    return { best, now };
  };
  // Work due each week over the term (excused work left out): { w (Monday's day number), n, p (points), names,
  // past, now, heavy }. The term runs from its start (or the first due date) to its end (or the last), at most half a
  // year either side of this week. heavy: the three busiest weeks from this one on (most items, then most points).
  const workload = (items, { from, to, now, tz }) => {
    const T = lib('GZ_TODO', './todo.js');
    const due = items.filter((i) => i.d && i.s !== 'excused').map((i) => ({ ...i, w: week(T.dayOf(i.d, tz)) }));
    const here = week(T.dayOf(now, tz));
    const ends = [...due.map((i) => i.w), ...[from, to].filter(Boolean).map((ms) => week(T.dayOf(ms, tz)))];
    if (!ends.length) return [];
    const first = Math.max(Math.min(...ends), here - 182), last = Math.min(Math.max(...ends), here + 182);
    const weeks = [];
    for (let w = first; w <= last; w += 7) weeks.push({ w, n: 0, p: 0, names: [], past: w < here, now: w === here, heavy: false });
    for (const i of due) {
      const x = weeks[(i.w - first) / 7];
      if (!x) continue;
      x.n++;
      x.p += i.p;
      if (x.names.length < 8) x.names.push(i.n);
    }
    for (const x of weeks.filter((y) => !y.past && y.n).sort((a, b) => b.n - a.n || b.p - a.p).slice(0, 3)) x.heavy = true;
    return weeks;
  };
  // Better To Do's plans (lib/todo.js clean()), kept or not: a "do on" day is kept when the work was handed in or ticked
  // off by the end of that day; focus sessions, when it was done by the end of the day of the last one. Only plans for
  // this term's work and days that are over count; work ticked off at an unknown time (a Canvas item's tick) is left
  // out. items: this term's (with a, handed in); fromDay: the term's first day.
  const planning = (data, items, { now, tz, fromDay = -Infinity }) => {
    const T = lib('GZ_TODO', './todo.js');
    const today = T.dayOf(now, tz);
    const done = new Map(items.map((i) => [i.k, i.a || null]));
    for (const x of arr(data?.tasks)) done.set(`task:${x.id}`, x.done || null);
    const out = { on: { kept: 0, all: 0 }, focus: { kept: 0, all: 0 } };
    for (const [k, l] of Object.entries(isObj(data?.items) ? data.items : {})) {
      if (!done.has(k)) continue;
      const at = done.get(k);
      if (!at && l.done === true) continue;
      const count = (o, day) => { if (day === null || day < fromDay || day >= today) return; o.all++; if (at && T.dayOf(at, tz) <= day) o.kept++; };
      count(out.on, T.keyDay(l.on));
      const last = arr(l.sessions).at(-1);
      count(out.focus, last ? T.dayOf(last.at, tz) : null);
    }
    return out;
  };
  // Everything the view draws, from the cache record (clean()) and the student's own Better To Do data, at `now`.
  // → { total (tally), courses: [{ id, name, tally, trend, first, last, change, q }], runs, weeks, plans, card }.
  // card: the summary's figures (null where there's nothing to say).
  const view = (rec, { now, tz, data = null, streak = null }) => {
    const T = lib('GZ_TODO', './todo.js');
    const all = rec.courses.flatMap((c) => c.items);
    const courses = rec.courses.map((c) => {
      const tr = c.q ? [] : c.trend;
      const first = tr[0]?.[1] ?? null, last = tr.at(-1)?.[1] ?? null;
      return { id: c.id, name: c.name, q: c.q, tally: tally(c.items), trend: tr, first, last, change: tr.length > 1 ? Math.round((last - first) * 10) / 10 : null };
    });
    const total = tally(all);
    const weeks = workload(all, { from: rec.from, to: rec.to, now, tz });
    const here = weeks.findIndex((w) => w.now);
    const fromDay = rec.from ? T.dayOf(rec.from, tz) : weeks[0]?.w ?? -Infinity;
    const plans = data ? planning(data, all, { now, tz, fromDay }) : { on: { kept: 0, all: 0 }, focus: { kept: 0, all: 0 } };
    const rise = courses.filter((c) => c.change > 0).sort((a, b) => b.change - a.change)[0] || null;
    const busiest = weeks.reduce((b, w) => (w.n > (b?.n || 0) ? w : b), null);
    const kept = plans.on.kept + plans.focus.kept, planned = plans.on.all + plans.focus.all;
    const r = runs(all, tz);
    return {
      total, courses, runs: r, weeks, plans,
      card: {
        share: total.share, handed: all.filter((i) => i.a && (i.s === 'on' || i.s === 'late')).length, courses: courses.length, best: r.best,
        rise: rise && { name: rise.name, change: rise.change }, busiest: busiest && { w: busiest.w, n: busiest.n },
        left: rec.to && here >= 0 ? weeks.length - here : null, plans: planned ? kept / planned : null, streak: streak?.best || null,
      },
    };
  };

  // ---- the cache --------------------------------------------------------------------------------------------------
  // One record per Canvas site and user in storage.local (insights:<origin>/<uid>), for the term it was made for: its
  // courses' items and grade points as above, when it was asked for (at), and when it was last cleared (cl). It is
  // only ever this term's; the student clears it from the view.
  const storeKey = (origin, uid) => `insights:${origin}/${uid}`;
  const KEY = /^insights:https?:\/\/[a-z\d.-]+(?::\d+)?\/\d+$/i;
  const STATES = new Set(['excused', 'late', 'missing', 'on', 'open', '']);
  const cleanItem = (i) => (isObj(i) && /^(assignment|quiz|discussion_topic):\d{1,20}$/.test(i.k) && STATES.has(i.s)
    ? { k: i.k, n: text(i.n, 120), d: when(i.d), p: Number.isFinite(i.p) && i.p >= 0 && i.p <= 1e6 ? i.p : 0, a: when(i.a), s: i.s } : null);
  const clean = (raw) => {
    if (!isObj(raw)) return null;
    const courses = arr(raw.courses).filter((c) => id(c?.id)).slice(0, 30).map((c) => ({
      id: id(c.id), name: text(c.name, 120), q: c.q === true,
      items: arr(c.items).map(cleanItem).filter(Boolean).slice(0, 300),
      trend: arr(c.trend).filter((p) => Array.isArray(p) && when(p[0]) && Number.isFinite(p[1]) && Math.abs(p[1]) < 1e4).slice(-40).map(([at, pct]) => [at, pct]),
    }));
    return { term: text(raw.term, 400), name: text(raw.name, 120), from: when(raw.from), to: when(raw.to), at: when(raw.at), cl: when(raw.cl), courses };
  };
  // In the service worker's write queue (lib/background.js 'glaze:insights'). m: { key, op, at, base, rec }.
  // put: keeps rec as asked for at `at`, unless it was made on a view read before the last clear (base, the clear that
  // view knew of), began before that clear, or a newer one for the same term is stored. clear: drops the record and
  // keeps the time, so a put still on its way can't bring it back. local: { get, set } (set says whether it worked).
  const change = async (m, local) => {
    if (typeof m?.key !== 'string' || !KEY.test(m.key) || !when(m.at)) return { ok: false, error: 'bad' };
    const cur = clean((await local.get(m.key))[m.key]) || { cl: 0, at: 0, term: '' };
    if (m.op === 'clear') return { ok: await local.set({ [m.key]: { cl: Math.max(cur.cl, m.at) } }) };
    const rec = m.op === 'put' && clean(m.rec);
    if (!rec) return { ok: false, error: 'bad' };
    if ((Number(m.base) || 0) < cur.cl || m.at <= cur.cl) return { ok: false, error: 'cleared' };
    if (cur.at > m.at && cur.term === rec.term) return { ok: true, kept: false };
    return { ok: await local.set({ [m.key]: { ...rec, at: m.at, cl: cur.cl } }) };
  };

  return { DAY, term, item, trend, tally, week, runs, workload, planning, view, storeKey, KEY, clean, change };
})();

if (typeof module !== 'undefined') module.exports = GZ_INSIGHTS; else GZ_INSIGHTS;
