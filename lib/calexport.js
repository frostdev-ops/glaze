// The calendar file (Canvas): what goes into the .ics the student saves (features/calexport.js), so node can test it.
// lib/todo.js gives the days in the student's Canvas time zone; lib/ics.js writes the file and makes the UIDs.
// Classic script, loaded on demand after those two (a second injection keeps the first); module.exports for node.
var GZ_CALEXPORT = globalThis.GZ_CALEXPORT || (() => {
  const lib = (name, file) => globalThis[name] || require(file);
  const WEEKS = { '2w': 2, '4w': 4, '8w': 8, '16w': 16 };

  // From the start of today to the end of the range, in tz, as instants and as lib/todo.js day numbers [first, last).
  // 'term': to the last day of the current term, the latest end date among the student's courses that have begun and
  // not ended (a course's own dates when it keeps to them, else its term's), at most a year ahead. Canvas's default
  // term has no dates: with none to go by it's the next 16 weeks, and guessed says so.
  const range = (pick, now, tz, courses = []) => {
    const T = lib('GZ_TODO', './todo.js');
    const first = T.dayOf(now, tz);
    let last = first + 7 * (WEEKS[pick] || 16), guessed = false;
    if (pick === 'term') {
      const ends = courses.map((c) => (c.restrict_enrollments_to_course_dates ? c : c.term || {}))
        .filter((d) => !(Date.parse(d.start_at) > now)).map((d) => Date.parse(d.end_at)).filter((e) => e > now);
      if (ends.length) last = Math.min(T.dayOf(Math.max(...ends), tz) + 1, first + 366);
      else guessed = true;
    }
    return { from: T.midnight(first, tz), to: T.midnight(last, tz), first, last, guessed };
  };

  // lib/ics.js events for the range. items: lib/todo.js slim planner items; gs: lib/gradescope.js items (already only
  // those of an account that said yes); data: the student's own (lib/todo.js clean); o: the todo settings (icsDue,
  // icsTasks, icsPlan, icsGs); site: the Canvas origin, for links; host: in every UID, so the same item is the same
  // event in each export (re-importing updates it where the calendar supports that); cids: the courses to include
  // (null: any); names: course id -> name; words: { plan(title), focus(title), untitled } in the page's language; classes: the
  // class periods' events, as lib/ics.js takes them (W14, once it lands).
  // Deadlines are instants (UTC in the file); all-day items and "do on" days are dates; focus sessions run from their
  // start for their length.
  const events = ({ items = [], gs = [], data, o, from, to, first, last, site, host, cids = null, names = {}, words, classes = [] }) => {
    const T = lib('GZ_TODO', './todo.js');
    const { uid } = lib('GZ_ICS', './ics.js');
    const d = T.clean(data);
    const shown = (cid) => !cid || !cids || cids.has(cid);
    const inDays = (n) => n >= first && n < last;
    const day = (n) => T.dayKey(n);
    const out = [];
    const known = new Map(); // item key -> { title, url }, for plans
    const hidden = new Set(); // items Better To Do doesn't show (dismissed, another course): their plans stay out too
    for (const i of [...items, ...gs]) {
      if (!i?.id || !i.title) continue;
      // What Better To Do lists: not announcements, nor calendar events (Canvas's own calendar feed has those).
      if (i.type === 'announcement' || i.type === 'calendar_event' || i.ov?.dismissed || !shown(i.cid)) { hidden.add(`${i.type}:${i.id}`); continue; }
      const url = /^https?:/.test(i.url) ? i.url : i.url ? site + i.url : '';
      known.set(`${i.type}:${i.id}`, { title: i.title, url });
      if (!i.at || !(i.type === 'gradescope' ? o.icsGs : o.icsDue)) continue;
      const base = { uid: uid(host, i.type, i.id), summary: i.title, description: names[i.cid] || i.course || '', url };
      if (i.allDay) {
        const n = Math.floor(i.at / T.DAY);
        if (inDays(n)) out.push({ ...base, start: day(n), end: day(n + 1) });
      } else if (i.at >= from && i.at < to) out.push({ ...base, start: i.at });
    }
    for (const x of d.tasks) {
      if (!shown(x.cid)) { hidden.add(`task:${x.id}`); continue; }
      known.set(`task:${x.id}`, { title: x.title, url: '' });
      if (!o.icsTasks || !x.due) continue;
      const base = { uid: uid(host, 'task', x.id), summary: x.title, description: [names[x.cid], x.notes].filter(Boolean).join('\n') };
      if (x.due.day) { const n = T.keyDay(x.due.day); if (inDays(n)) out.push({ ...base, start: day(n), end: day(n + 1) }); }
      else if (x.due.at >= from && x.due.at < to) out.push({ ...base, start: x.due.at });
    }
    if (o.icsPlan) {
      for (const [k, l] of Object.entries(d.items)) {
        if (hidden.has(k)) continue;
        // Planned work is never dropped: a Canvas item that wasn't among what was read still gets its plan, untitled. Not
        // a Gradescope item that isn't among those allowed (no answer, or no), nor a kind that never goes in: their plans
        // would carry the item's id and day.
        const it = known.get(k) || (/^(gradescope|announcement|calendar_event):/.test(k) ? null : { title: words.untitled, url: '' });
        if (!it) continue;
        const on = T.keyDay(l.on);
        if (on !== null && inDays(on)) out.push({ uid: uid(host, 'on', k), summary: words.plan(it.title), start: day(on), end: day(on + 1), url: it.url });
        for (const s of l.sessions || []) {
          if (s.at >= from && s.at < to) out.push({ uid: uid(host, 'session', k, s.at), summary: words.focus(it.title), start: s.at, end: s.at + s.min * 6e4, url: it.url });
        }
      }
    }
    return [...out, ...classes];
  };

  // The keys of the student's items with a "do on" day or a focus session in the range: what the planner read must
  // cover for their titles (features/calexport.js asks further back for those it didn't).
  const planned = (data, { from, to, first, last }) => {
    const T = lib('GZ_TODO', './todo.js');
    return Object.entries(T.clean(data).items).filter(([, l]) => {
      const on = T.keyDay(l.on);
      return (on !== null && on >= first && on < last) || (l.sessions || []).some((s) => s.at >= from && s.at < to);
    }).map(([k]) => k);
  };

  return { range, events, planned };
})();

if (typeof module !== 'undefined') module.exports = GZ_CALEXPORT; else GZ_CALEXPORT;
