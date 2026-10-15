// Reminders and streaks (Canvas, W11): the parts that don't touch the page, so node can test them. Every category is
// the student's own opt-in and off by default (defaults.js enhance.remind, remindPlan, remindExam, streak). Days and
// "a day before" are counted in the student's Canvas time zone through lib/todo.js, which is loaded first.
// Classic script; module.exports for node. Loaded on demand (features/reminders.js asks for it): a second injection keeps the first.
var GZ_REMIND = globalThis.GZ_REMIND || (() => {
  const T = globalThis.GZ_TODO || require('./todo.js');
  const H = 36e5, DAY = T.DAY;

  // Its settings (storage.sync `remind`; the categories' switches are in enhance), added to GZ_SPEC from here as
  // lib/todo.js does. m15…d2: lead times before a due date, as many as wanted; exam: how long before an exam;
  // plan: minutes before a focus session.
  const SPEC = {
    m15: [false, 'bool'], h1: [false, 'bool'], h3: [true, 'bool'], d1: [false, 'bool'], d2: [false, 'bool'],
    exam: ['2d', ['1d', '2d', '3d', '1w']], plan: ['15', ['0', '5', '15', '30', '60']],
    // cls: minutes before a class in the class schedule (lib/classes.js events; the switch is enhance.remindClass).
    cls: ['10', ['5', '10', '15', '30']],
  };
  (typeof GZ_SPEC !== 'undefined' ? GZ_SPEC : require('../defaults.js').GZ_SPEC).remind = SPEC;
  // Hours as lengths of time; days as the same time of day that many days before, so a day's lead is still "the day
  // before at 23:59" across a daylight-saving change.
  const LEADS = { m15: 0.25 * H, h1: H, h3: 3 * H, d1: '1', d2: '2' };
  const EXAM = { '1d': '1', '2d': '2', '3d': '3', '1w': '7' };
  const before = (at, lead, tz) => {
    if (typeof lead === 'number') return at - lead;
    const { date, time } = T.inputs(at, tz);
    return T.typed(T.dayKey(T.keyDay(date) - +lead), time, tz) ?? at - lead * DAY;
  };

  // ---- exams ----------------------------------------------------------------------------------------------
  // A test, quiz or exam by its title, in Glaze's six languages, or a Canvas quiz. Whole words (plurals too); German
  // and Dutch also at the end of a compound (Abschlussprüfung, deeltentamen). ponytail: "final" and "test" also match
  // "Final project" or "Test run", as another extension's do; muting one item is a click.
  const WORD = /(?<![\p{L}\p{N}])(?:quiz(?:zes)?|exams?|midterms?|finals?|tests?|examen(?:s)?|exámenes|prueba(?:s)?|parcial(?:es)?|cuestionarios?|partiels?|contrôles?|interros?|interrogations?|exames?|provas?|testes?|questionários?|avaliaç(?:ão|ões))(?![\p{L}\p{N}])/iu;
  const COMPOUND = /(?:prüfung(?:en)?|klausur(?:en)?|tentamens?|toets(?:en)?)(?![\p{L}\p{N}])/iu;
  const isExam = (r) => r.type === 'quiz' || WORD.test(r.title || '') || COMPOUND.test(r.title || '');

  // ---- what to remind of ---------------------------------------------------------------------------------------
  // rows: what's open on the student's list (lib/todo.js build, done ones left out); cats: { due, exam, plan } on;
  // o: the remind settings; extra: reminders other packages make (class start, study), in the same shape.
  // → [{ id, key, cat, at (when it fires), until (when it stops mattering), end (the deadline or session), title, … }].
  // An id is the item and the moment, so a moved due date is a new reminder. Two at one moment are one; an exam's wins.
  const events = ({ rows, cats, o, tz, extra = [] }) => {
    const out = new Map();
    const add = (r, cat, at, until, end = until) => {
      if (!(at < until)) return;
      const id = `${r.key}@${at}`;
      if (!out.has(id) || cat === 'exam') out.set(id, { id, key: r.key, cat, at, until, end, title: r.title, url: r.url || '', course: r.course || '', allDay: !!r.allDay, day: r.day });
    };
    for (const r of rows) {
      if (r.done) continue;
      // The deadline: a moment, or the end of a whole day in the student's zone.
      const end = r.at === null ? null : r.allDay ? T.midnight(r.day + 1, tz) : r.at;
      // With exam reminders on, an exam's due-date reminders say it's an exam too.
      const exam = end !== null && cats.exam && isExam(r);
      if (end !== null && cats.due) for (const [k, lead] of Object.entries(LEADS)) if (o[k]) add(r, exam ? 'exam' : 'due', before(end, lead, tz), end);
      if (exam) add(r, 'exam', before(end, EXAM[o.exam], tz), end);
      if (cats.plan) {
        const on = T.keyDay(r.local?.on);
        if (on !== null) add(r, 'day', T.midnight(on, tz), T.midnight(on + 1, tz));
        for (const s of r.local?.sessions || []) add(r, 'session', s.at - +o.plan * 6e4, s.at + s.min * 6e4, s.at);
      }
    }
    for (const e of extra) if (e?.key && Number.isFinite(e.at) && Number.isFinite(e.until)) add(e, e.cat, e.at, e.until, e.end ?? e.until);
    return [...out.values()].sort((a, b) => a.at - b.at);
  };

  // What's due to show now and when the next one is. A muted item reminds of nothing; a snoozed reminder fires at its
  // snooze; one seen (shown in any tab) doesn't come back. Ones missed while no page was open aren't a pile: one per
  // item (its latest), and the newest first, for one toast that names how many more there are. One another tab holds
  // (claimed, not yet shown) waits until its lease runs out. tab: this page's id.
  // → { show, ids (every reminder this covers, to claim and then mark seen), next (ms, or Infinity) }.
  const pending = (evs, st, now, tab) => {
    const held = (e) => (st.held[e.id] && st.held[e.id].by !== tab && st.held[e.id].until > now ? st.held[e.id].until : 0);
    const when = (e) => Math.max(e.at, st.snooze[e.id] || 0, held(e));
    const live = evs.filter((e) => !st.mute[e.key] && !st.seen[e.id] && now < e.until);
    const due = live.filter((e) => when(e) <= now);
    const one = new Map();
    for (const e of due) if (!one.has(e.key) || when(one.get(e.key)) <= when(e)) one.set(e.key, e);
    const later = live.filter((e) => when(e) > now).map(when);
    return { show: [...one.values()].sort((a, b) => when(b) - when(a)), ids: due.map((e) => e.id), next: later.length ? Math.min(...later) : Infinity };
  };
  // The hub's "coming up": each item's next reminder not yet shown, soonest first.
  const upcoming = (evs, st, now) => {
    const next = new Map();
    for (const e of evs.filter((x) => !st.mute[x.key] && !st.seen[x.id] && now < x.until).map((x) => ({ ...x, fires: Math.max(x.at, st.snooze[x.id] || 0) }))) {
      if (!next.has(e.key) || e.fires < next.get(e.key).fires) next.set(e.key, e);
    }
    return [...next.values()].sort((a, b) => a.fires - b.fires);
  };
  // The hub's "recent": what was shown in the last three days (a toast names one and counts the rest; this lists them
  // all) or is snoozed, for work still open, one per item, newest first. Muted items are listed apart.
  const recent = (evs, st, now) => {
    const by = new Map();
    for (const e of evs) {
      const seen = st.seen[e.id] || 0, snoozed = st.snooze[e.id] > now ? st.snooze[e.id] : 0;
      if (st.mute[e.key] || !(seen > now - 3 * DAY || snoozed)) continue;
      const cur = by.get(e.key);
      if (!cur || Math.max(seen, snoozed) > Math.max(cur.seen, cur.snoozed)) by.set(e.key, { ...e, seen, snoozed });
    }
    return [...by.values()].sort((a, b) => Math.max(b.seen, b.snoozed) - Math.max(a.seen, a.snoozed));
  };

  // ---- the streak -------------------------------------------------------------------------------------------------
  // Days in a row with nothing missed. Missed: work that wanted handing in (a submission, or the student's own task
  // with a due date) and is past due and not done, or was handed in late. Excused never counts, and nothing counts
  // from before the streak started or that a restore forgave. Today counts once nothing due today is still open.
  // b: lib/todo.js build() over the last month (past: 'month'); s: the stored streak or null; today: a day number in tz.
  // → { start, best, was, keys, broke, current, extended }: a miss moves the start to the day after it, and keeps
  // the start before (was) and what was missed (keys) for a restore.
  // Late is late whether or not the student ticked it (manual "done means"); open is Canvas's rule, ticks aside.
  const counts = (r) => r.day !== null && (r.custom || r.sub) && !r.sub?.excused;
  const missed = (b) => [...b.groups.flatMap(([, l]) => l), ...b.done, ...b.graded].filter((r) => counts(r)
    && (r.sub?.late || (r.custom && r.at && r.doneAt > r.at) || (!r.done && r.past && !T.isDone(r, 'auto'))));
  const streak = (b, s, today) => {
    const cur = s || { start: today, best: 0, was: null, keys: [], ok: [], broke: null };
    const ok = new Set(cur.ok || []);
    const miss = missed(b).filter((r) => r.day >= cur.start && !ok.has(r.key));
    let { start, was, keys, broke } = cur;
    if (miss.length) {
      broke = Math.max(...miss.map((r) => r.day));
      was = start;
      keys = [...new Set(miss.map((r) => r.key))].slice(0, 50);
      start = broke + 1;
    }
    const extended = !b.groups.flatMap(([, l]) => l).some((r) => counts(r) && r.day === today && !r.past && !T.isDone(r, 'auto'));
    const current = start > today ? 0 : today - start + (extended ? 1 : 0);
    return { start, best: Math.max(cur.best || 0, current), was: was ?? null, keys: keys || [], ok: [...ok], broke: broke ?? null, current, extended };
  };
  // Restores: a few a month, free, never more for anything. One puts back the start from before the last miss.
  const RESTORES = 2;
  const left = (st, month) => RESTORES - (st.restores?.month === month ? st.restores.n : 0);

  // ---- the student's reminder state, on this device -----------------------------------------------------------
  // storage.local remind:<site>/<user id>: { seen, snooze (id → ms), held (id → { by: tab, lease, until }), mute (item key → ms),
  // streak, restores }. Kept
  // apart from Canvas's own read state, which nothing here touches. Old entries go after a month.
  const storeKey = (origin, uid) => `remind:${origin}/${uid}`;
  const STORE_KEY = /^remind:https?:\/\/[a-z\d.-]+(?::\d+)?\/\d+$/i;
  const ITEM = /^(?:[a-z_]+:(?:\d+|_\d+_\d+)|task:[\w-]{1,40}|[a-z]+:[\w.-]{1,60})$/;
  const ID = /^(.{1,80})@(\d{1,15})$/;
  const TAB = /^[\w-]{1,40}$/;
  // How long a tab holds a reminder it claimed before it says it showed it; after that another tab may claim it.
  const LEASE = 3e4;
  const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
  const ms = (v) => (Number.isFinite(v) && v > 0 && v < 1e14 ? v : 0);
  const day = (v) => (Number.isInteger(v) && Math.abs(v) < 1e6 ? v : null);
  const map = (raw, ok, keep) => Object.fromEntries((isObj(raw) ? Object.entries(raw) : []).filter(([k, v]) => ok(k) && ms(v) && keep(k, v)).slice(-1000));
  const clean = (raw, now = Date.now()) => {
    const fresh = (k) => +ID.exec(k)?.[2] > now - 30 * DAY;
    const okId = (k) => ID.test(k) && ITEM.test(ID.exec(k)[1]);
    const s = raw?.streak;
    const keys = (v) => (Array.isArray(v) ? v.filter((k) => typeof k === 'string' && ITEM.test(k)).slice(-100) : []);
    const r = raw?.restores;
    return {
      seen: map(raw?.seen, okId, fresh),
      snooze: map(raw?.snooze, okId, (k, v) => fresh(k) && v > now - DAY),
      // An expired lease is kept a lease longer, free to claim, so its tab's late confirm still counts if nobody took it.
      held: Object.fromEntries((isObj(raw?.held) ? Object.entries(raw.held) : [])
        .filter(([k, v]) => okId(k) && TAB.test(v?.by) && TAB.test(v.lease) && ms(v.until) > now - LEASE && v.until <= now + LEASE)
        .slice(-500).map(([k, v]) => [k, { by: v.by, lease: v.lease, until: v.until }])),
      mute: map(raw?.mute, (k) => ITEM.test(k), (k, v) => v > now - 90 * DAY),
      streak: isObj(s) && day(s.start) !== null ? { start: s.start, best: Number.isInteger(s.best) && s.best >= 0 ? s.best : 0, was: day(s.was), keys: keys(s.keys), ok: keys(s.ok), broke: day(s.broke) } : null,
      restores: isObj(r) && /^\d{4}-\d{2}$/.test(r.month) && Number.isInteger(r.n) && r.n >= 0 ? { month: r.month, n: Math.min(r.n, RESTORES) } : null,
    };
  };

  // ---- writes: one at a time, in the background worker (lib/background.js 'glaze:remind') ----
  // m: { key, op, … } from a Canvas page. Two steps, so a reminder is never lost to a tab that closed or went quiet
  // between asking and showing: claim (tab) leases the reminders no other tab has shown or holds, answering which;
  // confirm (tab, lease), sent once the toast is on screen, marks them seen. An unconfirmed lease runs out (LEASE).
  // snooze: one reminder, until a time; mute/unmute: an item; streak: the page's reckoning, kept only if the stored
  // streak is still the one it reckoned from (from: its start), so a restore made in another tab isn't undone;
  // restore: one of this month's. area: { local } as lib/background.js gives it.
  // → { ok, data, and claimed, lease, until (a claim) or confirmed (a confirm) } or { ok: false, error }.
  const change = async (m, area, now = Date.now()) => {
    if (typeof m?.key !== 'string' || !STORE_KEY.test(m.key)) return { ok: false, error: 'bad' };
    const d = clean((await area.local.get([m.key]))[m.key], now);
    const out = { ok: true };
    const ids = Array.isArray(m.ids) ? m.ids.slice(0, 500).filter((id) => typeof id === 'string' && ID.test(id) && !d.seen[id]) : [];
    if (m.op === 'claim' && TAB.test(m.tab)) {
      // A new lease each time, named, with its end: the tab draws only before that end, and confirms by its name.
      out.claimed = ids.filter((id) => !d.held[id] || d.held[id].by === m.tab || d.held[id].until <= now);
      out.lease = crypto.randomUUID();
      out.until = now + LEASE;
      for (const id of out.claimed) d.held[id] = { by: m.tab, lease: out.lease, until: out.until };
    } else if (m.op === 'confirm' && TAB.test(m.tab) && TAB.test(m.lease)) {
      // Only under the lease it names: a lease another claim has since replaced confirms nothing.
      out.confirmed = ids.filter((x) => d.held[x]?.by === m.tab && d.held[x].lease === m.lease);
      for (const id of out.confirmed) { d.seen[id] = now; delete d.held[id]; }
    } else if (m.op === 'snooze' && typeof m.id === 'string' && ms(m.until)) {
      delete d.held[m.id];
      d.snooze[m.id] = m.until;
      delete d.seen[m.id];
    } else if (m.op === 'mute' && typeof m.item === 'string') d.mute[m.item] = now;
    else if (m.op === 'unmute' && typeof m.item === 'string') delete d.mute[m.item];
    else if (m.op === 'streak' && isObj(m.streak)) {
      if ((d.streak?.start ?? null) !== (m.from ?? null)) return { ok: false, error: 'stale', data: d };
      d.streak = { ...m.streak, best: Math.max(m.streak.best || 0, d.streak?.best || 0) };
    } else if (m.op === 'restore' && /^\d{4}-\d{2}$/.test(m.month)) {
      const s = d.streak;
      if (!s || s.was === null || left(d, m.month) < 1) return { ok: false, error: 'none', data: d };
      d.restores = { month: m.month, n: RESTORES - left(d, m.month) + 1 };
      d.streak = { ...s, start: s.was, was: null, ok: [...s.ok, ...s.keys].slice(-100), keys: [], broke: null };
    } else return { ok: false, error: 'bad' };
    const next = clean(d, now);
    return (await area.local.set({ [m.key]: next })) ? { ...out, data: next } : { ok: false, error: 'write' };
  };

  return { SPEC, LEASE, LEADS, isExam, events, pending, upcoming, recent, streak, RESTORES, left, storeKey, STORE_KEY, clean, change };
})();

if (typeof module !== 'undefined') module.exports = GZ_REMIND; else GZ_REMIND;
