// Blackboard Ultra's answers, in the shapes Glaze's Canvas features already use: courses and terms as the editor and
// GZ_COURSES have them, due items as planner/todo.js's planner items (which planner/remind.js and planner/calexport.js read), work as
// planner/insights.js's items, and gradebook rows as planner/gradecalc.js's model() takes them. Pure apart from read(), which
// asks the student's own Ultra. Shapes and rules come from the B0 spike; a rule B0 inferred rather
// than measured is marked [I] here and in test/ultra.test.js.
// Classic script, loaded on demand (content.js need()): a second injection keeps the first; module.exports for node.
var GZ_ULTRA = globalThis.GZ_ULTRA || (() => {
  const P = typeof GZ_PAGE !== 'undefined' ? GZ_PAGE : require('../core/page.js');
  const COURSES = typeof GZ_COURSES !== 'undefined' ? GZ_COURSES : require('../content/defaults.js').GZ_COURSES;
  const calc = () => globalThis.GZ_GRADECALC || require('../planner/gradecalc.js');
  const DAY = 864e5;
  const ID = /^_\d+_\d+$/;
  const str = (v, n = 300) => (typeof v === 'string' ? v.slice(0, n) : '');
  const ms = (v) => { const t = Date.parse(v); return Number.isFinite(t) ? t : null; };
  const arr = (v) => (Array.isArray(v) ? v : []);

  // ---- course content: folder previews and Download all ------------------------------------------------------------
  // Ultra's private content API sends each item's contentDetail, and an LTI link with its own credentials carries the
  // tool's `secret` and `key` there. Every way of asking tried in B0 kept them (no query, @view=Summary, nested
  // fields), except a `fields` list that leaves contentDetail out. So Glaze asks with these lists only, and keeps
  // only what it uses.
  const PEEK_FIELDS = 'id,title,state,genericReadOnlyData';
  const peekItem = (c) => ({ id: str(c?.id, 40), title: str(c?.title), state: str(c?.state, 20), genericReadOnlyData: { dueDate: str(c?.genericReadOnlyData?.dueDate, 40) || undefined } });
  const FILES_FIELDS = 'id,title,contentHandler,state,body';
  const FILE = 'resource/x-bb-file';
  // A File item's file, with contentDetail left out, comes from the public API's attachments for it: download
  // addresses on origin (Blackboard redirects them to the bytes).
  const attachments = (origin, cid, id, results) => (ID.test(cid) && ID.test(id) && Array.isArray(results) ? results : [])
    .filter((a) => ID.test(a?.id)).map((a) => ({ url: `${origin}/learn/api/public/v1/courses/${cid}/contents/${id}/attachments/${a.id}/download`, name: str(a.fileName, 255) || 'file' }));
  // The files under a folder or learning module, subfolders as directories. An Ultra document is a folder to the API
  // (isBbPage, from the public API) whose blocks hold its files. An item not opened yet is left out and counted, so a
  // download never marks it viewed. list(id): its children, asked for with FILES_FIELDS; isPage(item); files(id): a
  // File item's attachments, or null when they can't be read. → { found: [{ url, name, size, dir }], skipped, failed }.
  // ponytail: first 200 children of each folder (the caller's limit).
  const files = async ({ root, list, isPage, attachments: att, origin, safeName }) => {
    const found = [], seen = new Set();
    let skipped = 0, failed = 0;
    const has = (k) => k.contentHandler === FILE || P.files(k, origin).length > 0;
    const walk = async (id, dir) => {
      for (const c of await list(id)) {
        const page = c.contentHandler !== FILE && await isPage(c);
        if (/folder|lesson/.test(c.contentHandler) && !page) { await walk(c.id, `${dir}${safeName(c.title)}/`); continue; }
        const kids = (page ? await list(c.id) : [c]).filter(has);
        if (!kids.length) continue;
        if (c.state !== 'Started' && c.state !== 'Completed') { skipped += 1; continue; }
        for (const k of kids) {
          const fs = k.contentHandler === FILE ? await att(k.id) : P.files(k, origin);
          if (!fs) { failed += 1; continue; }
          for (const f of fs) if (!seen.has(f.url)) { seen.add(f.url); found.push({ url: f.url, name: f.name, size: f.size, dir }); }
        }
      }
    };
    await walk(root, '');
    return { found, skipped, failed };
  };

  // The outline id of a course link is not necessarily its destination id. Only the API's same-site UI
  // alternate is authoritative; API self links and foreign launch URLs must not become palette destinations.
  const contentLink = (item, cid, origin = 'https://ultra.invalid') => {
    if (!ID.test(cid)) return null;
    const link = arr(item?.links).find((l) => l?.rel === 'alternate');
    if (link) {
      try {
        const u = new URL(link.href, origin), q = ['courseId', 'course_id'].flatMap((k) => u.searchParams.getAll(k));
        const own = u.pathname.startsWith(`/ultra/courses/${cid}/`);
        if (u.origin === origin && q.every((id) => id === cid) && (own || u.pathname === '/ultra/redirect' && q.length)) return u.pathname + u.search + u.hash;
      } catch { /* malformed or foreign UI link */ }
      return null;
    }
    if (!ID.test(cid) || !ID.test(item?.id) || item?.contentHandler?.id === 'resource/x-bb-courselink') return null;
    return `/ultra/redirect?redirectType=nautilus&courseId=${cid}&contentId=${item.id}`;
  };

  // Search reads public lists only. Cache text and validated UI destinations, never handler objects or LTI data.
  const SEARCH_KINDS = [
    { kind: 'Document', list: 'contents', fields: 'id,parentId,title,availability,body,contentHandler.id,links', also: '&recursive=true' },
    { kind: 'Announcement', list: 'announcements', fields: 'id,title,body,availability' },
    { kind: 'Discussion', list: 'discussions', fields: 'id,title,available,topic.body,topic.status' },
  ];
  // Content a student may see now, the one rule search and the notes app's links share: x → until when (ms, Infinity), or
  // null when it, or any folder above it, isn't released now, has unknown or malformed availability, or loops.
  const visibleIn = (items, now = Date.now()) => {
    const byId = new Map(arr(items).map((x) => [x?.id, x]));
    // An empty release object is unrestricted in B0. Missing, malformed or unknown rules are not proof of access.
    const released = (a) => {
      const r = a?.adaptiveRelease;
      if (a?.available !== 'Yes' || !r || typeof r !== 'object' || Array.isArray(r) || Object.keys(r).some((key) => key !== 'start' && key !== 'end')) return null;
      const date = (value) => value == null ? null : typeof value === 'string' ? ms(value) : null;
      const start = date(r.start), end = date(r.end);
      if (r.start != null && start === null || r.end != null && end === null || start > now || end !== null && end < now) return null;
      return end ?? Infinity;
    };
    return (x) => {
      const seen = new Set();
      let until = Infinity;
      for (let p = x; p; p = byId.get(p.parentId)) {
        const end = released(p.availability);
        if (seen.has(p.id) || end === null) return null;
        until = Math.min(until, end);
        seen.add(p.id);
      }
      return until;
    };
  };
  const searchItems = (k, items, course, text, now = Date.now(), origin) => {
    if (!ID.test(course?.id)) return [];
    const visible = visibleIn(items, now);
    const labels = { document: 'Document', folder: 'Folder', lesson: 'Module', 'asmt-test-link': 'Test', file: 'File' };
    return arr(items).map((x) => {
      if (!ID.test(x?.id) || !str(x.title).trim()) return null;
      let until = Infinity, kind = k.kind;
      if (k.list === 'contents') {
        // The authoritative discussion list owns forum results: outline content ids are not discussion ids.
        const handler = str(x.contentHandler?.id, 100).replace('resource/x-bb-', '');
        if (handler === 'forumlink') return null;
        until = visible(x);
        if (until === null) return null;
        kind = labels[handler] || 'Link';
      } else if (k.list === 'discussions') {
        if (x.available !== true || x.topic?.status !== 'Published') return null;
      } else {
        const d = x.availability?.duration;
        const end = ms(d?.end);
        if (x.availability?.available === 'No' || ms(d?.start) > now || end !== null && end < now) return null;
        until = end ?? Infinity;
      }
      const url = k.list === 'contents' ? contentLink(x, course.id, origin) : `/ultra/courses/${course.id}/${k.list === 'discussions' ? 'engagement' : 'announcements'}`;
      if (!url) return null;
      return {
        key: `${course.id}/${k.list}:${x.id}`, title: str(x.title).trim(), kind, course: course.name, until,
        // B0 confirms nautilus redirects. The other destinations are native course tool lists, corroborated by GZ_TABS.
        url,
        // shortcut: first 100,000 HTML characters / 20,000 text characters per item; measure before indexing larger documents.
        text: text(str(k.list === 'discussions' ? x.topic?.body : x.body, 100000)).slice(0, 20000),
        // An announcement's course and id, for Glaze's pop-up (courses/page/announce.js).
        ...(k.list === 'announcements' && { cid: course.id, aid: x.id }),
        ...(k.list === 'discussions' && { cid: course.id }),
      };
    }).filter(Boolean);
  };

  // ---- courses and terms ---------------------------------------------------------------------------------------------
  // GZ_COURSES's map (name, color slot, organization; hidden courses left out), with each course's code, whether it's
  // closed, its term and its banner. A term is the course's own (memberships?expand=course has it inline) or, by
  // termId, one from /terms; dates only for a date-range term, named as Canvas names them so planner/calexport.js's range
  // reads them. The banner only when shown, and only from origin.
  const term = (t) => (t && ID.test(t.id) ? { id: t.id, name: str(t.name, 120), start_at: t.durationType === 'DATE_RANGE' ? str(t.startDate, 40) || null : null, end_at: t.durationType === 'DATE_RANGE' ? str(t.endDate, 40) || null : null } : null);
  const courses = (memberships, { terms = [], origin } = {}) => {
    const byId = new Map(arr(terms).map((t) => [t?.id, t]));
    const out = COURSES(memberships);
    for (const m of arr(memberships)) {
      const c = out[m?.courseId];
      if (!c) continue;
      const k = m.course;
      const pic = str(k.banner?.permanentUrl || k.bannerImageThumbnail, 2000);
      let banner = null;
      try { if (pic && k.isBannerVisible !== false && new URL(pic, origin).origin === origin) banner = new URL(pic, origin).href; } catch { /* none */ }
      Object.assign(c, { code: str(k.displayId || k.courseId, 80), closed: !!k.isClosed || k.isAvailable === false, term: term(k.term || byId.get(k.termId)), banner });
    }
    return out;
  };
  // A course's own dates, for week 1 of a syllabus's dates by course week: → { known, start (ms, a date range's first
  // instant, else undefined) }. The course list's course (memberships?expand=course) gives only its durationType
  // (CONTINUOUS on the courses measured); the public course (v3 courses/{id}?fields=availability) gives a DateRange's
  // days. known: false when nothing was said, or a date range without its start.
  const ownDates = (k) => {
    const pub = k?.availability?.duration, type = pub ? pub.type : k?.durationType;
    if (typeof type !== 'string' || !type) return { known: false };
    const start = pub && type === 'DateRange' ? Date.parse(str(pub.start, 40)) : NaN;
    return { known: !/^date_?range$/i.test(type) || Number.isFinite(start), start: Number.isFinite(start) ? start : undefined };
  };
  // The same courses in Canvas's course list's shape (id, name, course_code, a term with start_at and end_at, and
  // access_restricted_by_date for a closed one), for the planning features that read Canvas's: Better To Do's courses
  // and names, the class schedule's matching, the calendar file's "This term".
  const list = (memberships, o) => Object.defineProperty(Object.entries(courses(memberships, o))
    .map(([id, c]) => ({ id, name: c.name, course_code: c.code, access_restricted_by_date: c.closed, term: c.term })), 'complete', { value: memberships?.complete !== false });

  // ---- where a piece of work stands --------------------------------------------------------------------------------
  // From a row of the course's gradebook as Ultra's own Grades page asks for it (gradebook/grades with
  // expand=lastAttempt,submissionStatus,column). → { state, submitted, graded, draft, at (handed in, ms), due (ms) }.
  // state: 'excused', 'on-time', 'late', 'missing', 'open' (nothing handed in, not due yet) or 'unknown'. Unknown is a
  // real answer: Glaze never guesses. Ultra has no late flag, and its `gradable` flag is unreliable, so neither is read.
  // excepted: the student has a due-date exception for it, so neither late nor missing can be told.
  // [M] UNOPENED; [D] NOT_SUBMITTED (Ultra's bundle). Not NO_STATUS: [M] it marks LTI, attendance and calculated
  // columns, graded or not, so it says nothing about handing in.
  const NOTHING = new Set(['UNOPENED', 'NOT_SUBMITTED']);
  const standing = (row, now, excepted = false) => {
    const s = row?.submissionStatus?.status;
    const a = row?.lastAttempt;
    const due = ms(row?.column?.dueDate);
    // [M] IN_PROGRESS is a saved draft, not a submission. [M] attemptDate is the submission time (equal to the
    // receipt's whenever there is one, and there often isn't).
    const draft = a?.status === 'IN_PROGRESS' || row?.status === 'IN_PROGRESS';
    const handed = P.submitted(row);
    const at = (handed && !draft && ms(a?.attemptDate)) || null;
    const graded = row?.status === 'GRADED' || s === 'GRADED';
    // Attempt ids and dates alone cannot prove a hand-in. An earlier submission behind a new draft needs Ultra's
    // explicit SUBMITTED status; the draft's date cannot tell when that earlier submission was handed in.
    const out = (state) => ({ state, submitted: handed, graded, draft, at, due });
    // [M] isExempt (none seen exempt); [D] EXEMPT.
    if (row?.isExempt === true || s === 'EXEMPT') return out('excused');
    // [I] on time or late: the submission time against the due date. With no (readable) due date, handed in is all
    // that's known.
    if (at) return out(!due || excepted && at > due ? 'unknown' : at > due ? 'late' : 'on-time');
    // [D] Ultra's own zero for work not handed in.
    if (s === 'PAST_DUE_AUTO_ZERO') return out(excepted ? 'unknown' : 'missing');
    if (handed || graded) return out('unknown');
    // Nothing handed in: Ultra says so, or the row has no attempt and no grade at all ([M]: a row with nothing yet
    // carries no status). [I] missing once the due date has passed.
    const nothing = draft || (s ? NOTHING.has(s) : !row?.status && !row?.lastAttemptId);
    if (!nothing) return out('unknown');
    if (!due || due > now) return out('open');
    return out(excepted ? 'unknown' : 'missing');
  };

  // ---- due items -----------------------------------------------------------------------------------------------------
  // To Do (calendars/todo/studentItems: { overdueItems, dueTodayItems, futureDueItems }, one answer per slice) and the
  // calendar (calendars/calendarItems results) as planner/todo.js's planner items, one per gradebook column: both name it
  // ([M] column.id in To Do, itemSourceId in the calendar, Engagement items too), and a graded discussion appears in the
  // calendar twice with the same id ([M]), so items are deduped by it. Each joins the course's gradebook rows
  // (rows: course id → rows) by that column id, never by title: an item that joins no row stays on the list with no
  // grade state (sub null), as does one whose standing is unknown. names: course id → name; excepted(cid, columnId).
  // Ultra's own items open through its redirect, as the public content API's `alternate` link does ([M]).
  const GRADABLE = /\.(GradableItem|Engagement)$/;
  const due = ({ todo = [], calendar = [], rows = {}, names = {}, now, excepted = () => false }) => {
    const found = new Map();
    const add = (id, cid, title, at, handle, engagement) => {
      if (!ID.test(id) || !ID.test(cid)) return;
      const had = found.get(id);
      found.set(id, { id, cid, title: had?.title || str(title), at: had?.at ?? at, discussion: !!had?.discussion || engagement || /forumlink/.test(handle || '') });
    };
    for (const t of arr(todo)) {
      for (const i of [...arr(t?.overdueItems), ...arr(t?.dueTodayItems), ...arr(t?.futureDueItems)]) add(i?.column?.id, i?.column?.courseId, i?.title, ms(i?.dueDate), i?.column?.scoreProviderHandle, false);
    }
    for (const i of arr(calendar)) {
      if (!GRADABLE.test(i?.itemSourceType || '')) continue;
      add(i.itemSourceId, i.calendarId, i.title, ms(i.endDate || i.startDate), i.dynamicCalendarItemProps?.handle, /\.Engagement$/.test(i.itemSourceType));
    }
    return [...found.values()].map((f) => {
      const row = arr(rows[f.cid]).find((r) => r?.columnId === f.id);
      const col = row?.column || {};
      const st = row ? standing(row, now, excepted(f.cid, f.id)) : null;
      const known = st && (st.state !== 'unknown' || st.submitted || st.graded);
      const content = ID.test(col.contentId) ? col.contentId : '';
      return {
        // [I] a test by Ultra's own subtype, where the column has one (the calendar calls assignments "Test" too).
        type: f.discussion || /forumlink/.test(col.scoreProviderHandle || '') ? 'discussion_topic' : col.assessmentSubtype === 'Test' ? 'quiz' : 'assignment',
        id: f.id, cid: f.cid, course: str(names[f.cid], 120), title: f.title || str(col.effectiveColumnName || col.columnName), at: f.at,
        url: content ? `/ultra/redirect?redirectType=nautilus&courseId=${f.cid}&contentId=${content}` : `/ultra/courses/${f.cid}/outline`,
        sub: known ? { submitted: st.submitted, excused: st.state === 'excused', graded: st.graded, late: st.state === 'late', missing: st.state === 'missing', redo: false } : null,
        ov: null, aid: f.id, read: false, note: '', ws: '', allDay: false, content, state: st ? st.state : 'unknown',
      };
    });
  };

  // ---- the course's work, for Insights ---------------------------------------------------------------------------------
  // Its graded items' columns (not the overall grade, not other calculated columns) as planner/insights.js's items:
  // k, n, d (due), p (points), a (handed in), s (excused, late, missing, on, open; '' when unknown).
  const S = { excused: 'excused', late: 'late', missing: 'missing', 'on-time': 'on', open: 'open', unknown: '' };
  const work = (rows, now, excepted = () => false) => arr(rows).filter((r) => r?.column?.calculationType === 'NON_CALCULATED' && !r.column.externalGrade && ID.test(r.columnId)).map((r) => {
    const st = standing(r, now, excepted(r.columnId));
    const type = /forumlink/.test(r.column.scoreProviderHandle || '') ? 'discussion_topic' : r.column.assessmentSubtype === 'Test' ? 'quiz' : 'assignment';
    return { k: `${type}:${r.columnId}`, n: str(r.column.effectiveColumnName || r.column.columnName, 120), d: st.due || 0, p: Math.max(0, Number(r.column.possible) || 0), a: st.at || 0, s: S[st.state] };
  });

  // ---- grades ----------------------------------------------------------------------------------------------------------
  // The course's gradebook rows through planner/gradecalc.js's model(), and its letter cut-offs. Where the course returns
  // no overall formula, one Glaze can't read, or one that doesn't reproduce Blackboard's own figure, the result is
  // the share of points in graded work, flagged estimate: true (owner decision 3), with Blackboard's figure beside it
  // (overall) and why (model's reason, '' for no overall grade). schemas: gradebook/schemas results; the overall column's
  // own, when it's a letter scale, gives scale: [[letter, min %]], highest first, as planner/gpa.js takes it; letter: the
  // letter Blackboard writes for the overall grade, where it writes one. names: category id → category record or title (model()).
  const grade = (rows, schemas = [], names = {}) => {
    if (rows?.complete === false || schemas?.complete === false) throw Object.assign(new Error('Incomplete Ultra gradebook'), { code: 'incomplete' });
    const G = calc();
    const m = G.model(rows, names);
    const overallRow = arr(rows).find((r) => r?.column?.externalGrade);
    const schema = arr(schemas).find((s) => s?.id && s.id === overallRow?.column?.gradingSchemaId);
    // A symbol's lowerBound, where Ultra sends one ([I]). [M] (B4) a student's answer carries only each letter and its
    // absoluteValue (private: symbol, absoluteTranslation): what an entered letter stands for [I], not where it starts,
    // so it is never read as a cut-off. With no bounds there's no scale, and the GPA uses yours or a common one.
    const sym = arr(schema?.symbols);
    const scale = /^tabular$/i.test(schema?.scaleType || '') && sym.every((s) => s?.lowerBound != null)
      ? sym.map((s) => [str(s?.text, 20), Number(s.lowerBound)]).filter(([t, v]) => t && Number.isFinite(v)).sort((a, b) => b[1] - a[1]) : null;
    // The text is the letter only on a letter (Tabular) scale, or when it is a letter with grade points: a Percent or
    // Score column writes its figure ("87%"), which is not a grade the GPA could use.
    const text = str(overallRow?.displayGrade?.text, 20);
    const more = { scale: scale?.length ? scale : null, letter: text && (/^tabular$/i.test(schema?.scaleType || '') || G.points(text, true) != null) ? text : null };
    if (m.kind === 'weighted') return { ...m, estimate: false, why: '', ...more };
    const pts = G.model(arr(rows).filter((r) => !r?.column?.externalGrade), names);
    return { ...pts, estimate: true, overall: m.overall ?? null, why: m.kind === 'unsupported' ? m.why : '', ...more };
  };
  // The course's grade over the term, for Insights (planner/insights.js along): grade()'s figure after each graded item, in
  // the order of its due date, else when it was graded or handed in. tz: the student's time zone (the browser's: Ultra
  // doesn't say). → [[ms, percent]].
  const trend = (rows, tz) => {
    const g = grade(rows);
    const graded = new Set(g.items.filter((i) => i.score != null).map((i) => i.id));
    const dated = arr(rows).filter((r) => graded.has(String(r?.columnId))).map((r) => [String(r.columnId), ms(r.column?.dueDate) || ms(r.lastAttempt?.attemptLastGradedDate)
      || ms(r.lastAttempt?.attemptFirstGradedDate) || ms(r.lastOverrideDate) || ms(r.lastGradedDateViaLtiAgs) || ms(r.lastAttempt?.attemptDate)]).filter(([, at]) => at);
    return (globalThis.GZ_INSIGHTS || require('../planner/insights.js')).along(g.course, dated, tz);
  };

  // ---- this term --------------------------------------------------------------------------------------------------------
  // The student's courses that are on now, as planner/insights.js's term() gives Canvas's: theirs as a student, not an
  // organization or hidden, not closed, and begun and not ended by their term's dates (a term without dates counts as
  // on). → { key (the terms' ids), name (the term's most of them are in, when it has dates), from, to, courses: [{ id,
  // name, code, term, m (the membership) }] }.
  const current = (memberships, at, { terms = [] } = {}) => {
    const all = courses(memberships, { terms });
    const list = arr(memberships).filter((m) => all[m?.courseId] && !all[m.courseId].org && !all[m.courseId].closed && (!m.role || m.role === 'S'))
      .map((m) => ({ id: m.courseId, name: all[m.courseId].name, code: all[m.courseId].code, term: all[m.courseId].term, m }))
      .filter((c) => !(Date.parse(c.term?.start_at) > at) && !(Date.parse(c.term?.end_at) <= at));
    const starts = list.map((c) => Date.parse(c.term?.start_at)).filter(Number.isFinite);
    const ends = list.map((c) => Date.parse(c.term?.end_at)).filter(Number.isFinite);
    const named = new Map();
    for (const c of list) if (c.term?.name && c.term.start_at) named.set(c.term.name, (named.get(c.term.name) || 0) + 1);
    return {
      key: [...new Set(list.map((c) => c.term?.id || '-'))].sort().join(','), name: [...named].sort((a, b) => b[1] - a[1])[0]?.[0] || '',
      from: starts.length ? Math.min(...starts) : 0, to: ends.length ? Math.max(...ends) : 0, courses: list,
    };
  };

  // ---- reading Ultra ---------------------------------------------------------------------------------------------------
  // [M] To Do takes 15 days and refuses 21, so longer ranges are read in 14-day slices; the calendar took 81 days, so
  // 56-day ones. [[since, until]] (ms) covering [from, to); a range that isn't one is refused.
  const slices = (from, to, days) => {
    if (![from, to, days].every(Number.isFinite) || from > to || !(days > 0)) throw new RangeError('not a range');
    const out = [];
    for (let a = from; a < to; a += days * DAY) out.push([a, Math.min(to, a + days * DAY)]);
    return out;
  };
  // A calendar window whose page comes back full (CAL_LIMIT rows, or fewer than its paging.count) is asked again in
  // halves until each comes back whole, at most CAL_ASKS requests in all and down to an hour; past that the answer is
  // marked incomplete for the caller to say so. What a full page did bring is kept (due() dedupes).
  const CAL_LIMIT = 200, CAL_ASKS = 16;
  const MAX_TODO_SLICES = 6; // ponytail: To Do for the first twelve weeks; the calendar covers the rest of a range
  const STALE = 'stale';
  const linkItem = (c) => ({ id: str(c?.id, 40), parentId: str(c?.parentId, 40), title: str(c?.title), links: arr(c?.links).slice(0, 5).map((l) => ({ rel: str(l?.rel, 40), href: str(l?.href, 2000) })) });
  // GET only, from the student's own Ultra (origin, always an absolute address: Ultra's <base href> is its CDN), with
  // the session, redirects refused (one means signed out), paged and bounded. signal aborts; live() says whether the
  // caller still wants the answer (its page and generation), checked after every await: once it doesn't, the read
  // throws 'stale'. f: fetch.
  const read = ({ origin, signal, live = () => true, f = (...a) => fetch(...a), maxPages = 10, maxRequests = Infinity }) => {
    let requests = 0;
    const ok = () => { if (signal?.aborted || !live()) throw new Error(STALE); };
    const get = async (path) => {
      if (!/^\/learn\/api\/(v1|public\/v[1-3])\//.test(path)) throw new Error(`not Ultra's API: ${path}`);
      ok();
      if (++requests > maxRequests) throw new Error('Ultra request budget');
      const r = await f(origin + path, { method: 'GET', credentials: 'same-origin', redirect: 'error', headers: { accept: 'application/json' }, signal });
      ok();
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const text = await r.text();
      ok();
      return JSON.parse(text.replace(/^while\(1\);/, ''));
    };
    // A paged list's results, following paging.nextPage while it stays on Ultra's API here.
    const all = async (path) => {
      const out = [];
      let p = path, complete = true;
      for (let n = 0; p && n < maxPages; n++) {
        const j = await get(p);
        out.push(...arr(j?.results));
        const next = str(j?.paging?.nextPage, 2000);
        let u = null;
        try { u = next ? new URL(next, `${origin}${p}`) : null; } catch { /* none */ }
        if (next && (!u || u.origin !== origin)) complete = false;
        p = u && u.origin === origin ? u.pathname + u.search : '';
      }
      // Keep the array API and ordinary serialization while exposing its read coverage to local callers.
      return Object.defineProperty(out, 'complete', { value: complete && !p });
    };
    const iso = (t) => encodeURIComponent(new Date(t).toISOString());
    // A public list of a course's, page by page, each page asked with this list's own limit and fields (only a nextPage's
    // offset is taken from it). A nextPage that leaves this list (another site, API, course or resource) isn't asked:
    // the read stops there, incomplete, as it does past maxPages or on a page it has asked already. → { items, complete }.
    const list = async (path, fields, recursive) => {
      const items = [], pages = new Set();
      let query = '?', complete = true;
      for (let n = 0; query; n++) {
        const params = new URLSearchParams({ limit: '200', fields });
        const offset = new URLSearchParams(query).get('offset');
        if (offset && /^\d{1,9}$/.test(offset)) params.set('offset', offset);
        if (recursive) params.set('recursive', 'true');
        const url = `${path}?${params}`;
        if (n >= maxPages || pages.has(url)) { complete = false; break; }
        pages.add(url);
        const j = await get(url);
        items.push(...arr(j?.results).slice(0, 200));
        let next = null;
        try { if (j?.paging?.nextPage) next = new URL(j.paging.nextPage, origin + path); } catch { complete = false; }
        // A nextPage may page this list only, never switch to a thread, private API or another site.
        query = next ? (next.origin === origin && next.pathname === path ? next.search || '?' : (complete = false, '')) : '';
      }
      return { items, complete };
    };
    return {
      get, all, list,
      search: async (course, k, text) => {
        const cid = course?.id;
        if (!ID.test(cid) || !SEARCH_KINDS.includes(k)) return [];
        const result = await list(`/learn/api/public/v1/courses/${cid}/${k.list}`, k.fields, !!k.also);
        return Object.defineProperty(searchItems(k, result.items, course, text, Date.now(), origin), 'complete', { value: result.complete });
      },
      me: () => get('/learn/api/v1/users/me').then((m) => (ID.test(m?.id) ? m.id : Promise.reject(new Error('no user')))),
      memberships: (uid) => all(`/learn/api/v1/users/${uid}/memberships?expand=course&limit=200`),
      terms: () => all('/learn/api/v1/terms?limit=200'),
      // With now, the slices are laid back from `to` as far as whole slices still reach now: what's left of the range
      // is never split for want of the past days ahead of it, which the calendar answers with the rest ([I]: To Do adds
      // nothing the calendar lacks there). So Better To Do's default range, a week back to a week on, is one request.
      todo: async (from, to, now) => {
        const out = [];
        const start = Number.isFinite(now) && now > from && now < to ? Math.max(from, to - Math.ceil((to - now) / (14 * DAY)) * 14 * DAY) : from;
        for (const [a, b] of slices(start, to, 14).slice(0, MAX_TODO_SLICES)) out.push(await get(`/learn/api/v1/calendars/todo/studentItems?since=${iso(a)}&until=${iso(b)}`));
        return out;
      },
      // [M] The calendar's nextPage is no "more": it was there with every item already in hand, and led to a wider
      // window. So it isn't followed; a full page is split instead. → { items, complete }.
      calendar: async (from, to) => {
        const items = [];
        let asks = 0, complete = true;
        const window = async (a, b) => {
          if (asks >= CAL_ASKS) { complete = false; return; }
          asks += 1;
          const j = await get(`/learn/api/v1/calendars/calendarItems?since=${iso(a)}&until=${iso(b)}&limit=${CAL_LIMIT}`);
          const l = arr(j?.results), n = j?.paging?.count;
          items.push(...l);
          if (l.length < CAL_LIMIT && !(Number.isFinite(n) && n > l.length)) return;
          if (b - a <= 36e5) { complete = false; return; }
          const m = Math.floor((a + b) / 2);
          await window(a, m);
          await window(m, b);
        };
        for (const [a, b] of slices(from, to, 56)) await window(a, b);
        return { items, complete };
      },
      grades: (cid, uid) => (ID.test(cid) && ID.test(uid) ? all(`/learn/api/v1/courses/${cid}/gradebook/grades?userId=${uid}&limit=200&includeNoGradeItems=true&expand=column,lastAttempt,submissionStatus`) : Promise.resolve([])),
      schemas: (cid) => (ID.test(cid) ? all(`/learn/api/public/v1/courses/${cid}/gradebook/schemas?limit=200`) : Promise.resolve([])),
      // A course's content items the student may open now (visibleIn, search's rule), from the public API (never the private
      // one, whose items carry LTI credentials: B0), each kept to its id, parent, title and links, whatever else comes back:
      // the notes app's links. → { items, complete: false when its pages couldn't all be read (list) }.
      contents: async (cid) => {
        if (!ID.test(cid)) return { items: [], complete: true };
        const r = await list(`/learn/api/public/v1/courses/${cid}/contents`, 'id,parentId,title,availability,links', true);
        const visible = visibleIn(r.items);
        return { items: r.items.filter((c) => ID.test(c?.id) && visible(c) !== null).map(linkItem), complete: r.complete };
      },
    };
  };

  // Everything due from `from` to `to` (ms), as due() gives it: the student and their courses (names, due-date exception
  // settings) beside To Do and the calendar, then the gradebook of each course with something due, three courses at a
  // time. A course whose students have due-date exceptions turned on, or whose own exceptions can't be read,
  // has no late or missing work ([I], as content.js's due-date chips reckon it); otherwise an item named in the
  // course's exceptions answer has none either. → { items, complete: false when the calendar couldn't be read whole }.
  const PER_COURSE = 3;
  const planner = async (r, { from, to, now }) => {
    const [[uid, mem], todo, { items: calendar, complete: calendarComplete }] = await Promise.all([
      r.me().then(async (id) => [id, await r.memberships(id)]), r.todo(from, to, now), r.calendar(from, to)]);
    const names = Object.fromEntries(Object.entries(COURSES(mem)).map(([id, c]) => [id, c.name]));
    let complete = calendarComplete && mem.complete !== false;
    const ids = new Set(due({ todo, calendar, now }).map((i) => `${i.cid} ${i.id}`));
    const rows = {}, exc = {}, cids = [...new Set([...ids].map((k) => k.split(' ')[0]))];
    let next = 0;
    const one = async (cid) => {
      rows[cid] = await r.grades(cid, uid).catch((e) => { if (e.message === STALE) throw e; complete = false; return []; });
      if (rows[cid].complete === false) complete = false;
      exc[cid] = await excepts(r, mem.find((x) => x?.courseId === cid), cid, rows[cid].filter((g) => ids.has(`${cid} ${g?.columnId}`)), now);
    };
    await Promise.all(Array.from({ length: Math.min(PER_COURSE, cids.length) }, async () => { while (next < cids.length) await one(cids[next++]); }));
    return { items: due({ todo, calendar, rows, names, now, excepted: (cid, col) => exc[cid](col) }), complete };
  };
  // Which of a course's rows can't be called late or missing (the planner's rule above), asked only when one of them
  // would be: one request at most. m: the course's membership. → (columnId) → boolean.
  const excepts = async (r, m, cid, rows, now) => {
    const risky = arr(rows).filter((g) => /^(late|missing)$/.test(standing(g, now).state)).map((g) => g.columnId);
    if (!risky.length) return () => false;
    if (m?.dueDateExceptionType !== 'Normal' || !ID.test(m?.id)) return () => true;
    // By column id exactly: an exception for _12_10 is none for _12_1.
    const cols = await r.get(`/learn/api/v1/courses/${cid}/gradebook/memberships/${m.id}/exceptions?columnId=${risky.join(',')}`)
      .then((j) => new Set(arr(j?.results).map((x) => x?.columnId)), (e) => { if (e.message === STALE) throw e; return null; });
    return cols === null ? () => true : (col) => cols.has(col);
  };

  // ---- on an Ultra page: the planning features' reads (planner/page/todo.js, cardtasks.js, reminders.js, calexport.js,
  // classes.js, gcal.js), the gradebook's and a course's content, through read() like every Ultra request here, on the
  // page's own origin and through its queue (courses/lmsq.js) ----
  const MINE_TTL = 6e5, PLAN_TTL = 12e4, BOOK_TTL = 6e4, OUTLINE_TTL = 3e5;
  const BOOKS_KEEP = 30, BOOKS_BYTES = 2e6, BOOKS_AGE = 30 * DAY;
  const OUTLINE_FIELDS = 'id,parentId,title,availability,contentHandler.id,contentHandler.isBbPage,links';
  const zone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
  // Whole days in the browser's zone (Ultra's for its students): a range's start down to its midnight, its end up to one.
  const dayStart = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return +d; };
  const dayEnd = (t) => { const s = dayStart(t); if (s === t) return t; const d = new Date(s); d.setDate(d.getDate() + 1); return +d; };
  const covered = (rows, complete) => Object.defineProperty(rows, 'complete', { value: complete !== false });
  // env: { origin(), now(), fetch(url, init, prio, live), live(), local: { get(k), set(v) }, send(m),
  // todo() (planner/todo.js or null), todoPrefs() }.
  const makePage = (env) => {
    const at = () => env.origin();
    // Serialize this page's read/modify/write operations for each stored record.
    const writes = new Map();
    const update = (key, change) => {
      const run = () => Promise.resolve(env.local.get(key)).then((r) => {
        const next = change(r?.[key]);
        if (next !== undefined) return env.local.set({ [key]: next });
      });
      const p = (writes.has(key) ? writes.get(key).then(run) : run()).catch(() => {});
      writes.set(key, p);
      p.then(() => { if (writes.get(key) === p) writes.delete(key); });
    };
    // The fan-outs (gradebooks, outlines) stop once the page isn't live; who's signed in and what's due are asked as before.
    const reader = (o = {}) => read({ origin: at(), f: (u, init) => env.fetch(u, init, o.prio || 0, o.live), ...o });
    const fanout = (prio) => reader({ prio, live: env.live });

    // ---- who's signed in, and their courses: one source per site ----
    // Asked once a page, and kept by the worker a few minutes (storage.session, 'glaze:ultraMine') for the site's other
    // pages and course-tab frames. Each document confirms the student (/users/me, light), then keeps the memberships
    // when it's the same one: a shared snapshot's timestamp cannot prove which account a frame is signed in as. The last student
    // confirmed is kept per site too (storage.local ultraMe:<origin>, purged with the site), so what's saved for them
    // paints before anything answers (known). Ultra keeps no time zone for a student ([M] /users/me has none): days are
    // the browser's, named, so what's kept with a time zone is kept in one.
    let copy = null, meP = null, mineP = null, confirmed = '', seen = null;
    const SEEN = () => `ultraMe:${at()}`;
    const send = (m) => Promise.resolve().then(() => env.send(m)).catch(() => null);
    const kept = () => (copy ||= send({ type: 'glaze:ultraMine', op: 'get' }).then((c) => {
      const now = env.now();
      return c && ID.test(c.uid) && Array.isArray(c.mem) && now >= c.read && now - c.read < MINE_TTL ? c : null;
    }));
    // { uid, courses (Canvas's list's shape, list above: id, name, code, closed) } as kept; courses only once read.
    const remember = (uid, mem) => {
      const courses = mem && list(mem, { origin: at() }).map((c) => ({ id: c.id, name: c.name, course_code: c.course_code, access_restricted_by_date: c.access_restricted_by_date }));
      if (uid === confirmed && !courses) return;
      confirmed = uid;
      seen = null;
      const k = SEEN();
      update(k, (was) => {
        const next = { uid, ...((courses || was?.uid === uid && was.courses) && { courses: courses || was.courses }) };
        return JSON.stringify(was) !== JSON.stringify(next) ? next : undefined;
      });
    };
    const me = () => (meP ||= (async () => {
      const [c, uid] = await Promise.all([kept(), reader().me()]);
      remember(uid);
      if (c?.uid === uid) send({ type: 'glaze:ultraMine', op: 'touch', uid });
      return uid;
    })().catch((e) => { meP = null; copy = null; throw e; }));
    const mine = () => (mineP ||= (async () => {
      const uid = await me(), c = await kept();
      const mem = c?.uid === uid ? covered([...c.mem], c.complete) : await reader().memberships(uid);
      if (c?.uid !== uid) send({ type: 'glaze:ultraMine', op: 'put', mine: { uid, mem, complete: mem.complete !== false } });
      remember(uid, mem);
      return { uid, mem };
    })().catch((e) => { mineP = null; throw e; }));
    // The student last confirmed on this site and their courses as last read, before anything is asked: null when none.
    const known = () => (seen ||= Promise.resolve().then(() => env.local.get(SEEN())).then((r) => {
      const x = r?.[SEEN()];
      if (confirmed && x?.uid !== confirmed) return { uid: confirmed };
      return ID.test(x?.uid) ? { uid: x.uid, courses: Array.isArray(x.courses) ? x.courses.filter((c) => ID.test(c?.id) && typeof c.name === 'string') : undefined } : null;
    }, () => (confirmed ? { uid: confirmed } : null)));

    // ---- the gradebook: one store per site, by student and course ----
    // Every reader of a course's gradebook rows (the card badges and due-date chips, the planner, the GPA, Insights, the
    // rubric, agent apps) asks here, in the one shape Ultra's own Grades page asks for (read().grades): one request at a
    // time per course and student, its answer kept a minute, and kept on this device (storage.local
    // ultraBooks:<origin>/<uid>: the newest 30 courses of the last 30 days, about 2 MB at most, purged with the site), so
    // a page shows the last one at once while it asks again (saved). maxAge: how old an answer may be.
    const books = new Map(); // `${uid} ${cid}` → { at, rows, p }
    const BOOKS = (uid) => `ultraBooks:${at()}/${uid}`;
    const toKeep = new Map(); // uid → Map(cid → { at, rows, complete })
    const prune = (all, now) => {
      const list = Object.entries(all || {}).filter(([cid, b]) => ID.test(cid) && Array.isArray(b?.rows) && Number.isFinite(b.at) && now - b.at < BOOKS_AGE)
        .sort((x, y) => y[1].at - x[1].at).slice(0, BOOKS_KEEP);
      const sizes = list.map((e) => JSON.stringify(e).length);
      let total = sizes.reduce((a, b) => a + b, 0);
      while (list.length && total > BOOKS_BYTES) { list.pop(); total -= sizes.pop(); }
      return Object.fromEntries(list);
    };
    // Written once the reads in flight have all come back, so a page of courses is one write, not one each.
    let flying = 0;
    const flush = () => {
      for (const [uid, add] of toKeep) {
        const k = BOOKS(uid);
        update(k, (was) => prune({ ...was, ...Object.fromEntries(add) }, env.now()));
      }
      toKeep.clear();
    };
    const keep = (uid, cid, rows, t) => {
      if (!toKeep.has(uid)) toKeep.set(uid, new Map());
      toKeep.get(uid).set(cid, { at: t, rows: [...rows], complete: rows.complete !== false });
    };
    const stale = (signal, live) => { if (signal?.aborted || (live && !live())) throw new Error(STALE); };
    const book = (cid, uid, { maxAge = BOOK_TTL, prio = 0, signal, live } = {}) => {
      if (!ID.test(cid) || !ID.test(uid)) return Promise.resolve(covered([], true));
      const k = `${uid} ${cid}`, b = books.get(k);
      let p = b?.p;
      if (!p && b?.rows && env.now() - b.at < maxAge) p = Promise.resolve(b.rows);
      if (!p) {
        flying += 1;
        const landed = () => { if (!--flying) flush(); };
        p = fanout(prio).grades(cid, uid).then((rows) => {
          const t = env.now();
          books.set(k, { at: t, rows });
          keep(uid, cid, rows, t);
          landed();
          return rows;
        }, (e) => { if (books.get(k)?.p === p) books.set(k, { ...b, p: null }); landed(); throw e; });
        books.set(k, { ...b, p });
      }
      // One caller giving up (its page, its signal) leaves the read for the others.
      return signal || live ? p.then((rows) => { stale(signal, live); return rows; }, (e) => { stale(signal, live); throw e; }) : p;
    };
    // The last answer kept on this device, however old: { at, rows (complete as kept) }, or null. The kept record is read
    // once a page per student, however many cards ask.
    const keptBooks = new Map(); // uid → Promise of the record as it was when the page first asked
    const saved = (cid, uid) => {
      const b = books.get(`${uid} ${cid}`);
      if (b?.rows) return Promise.resolve({ at: b.at, rows: b.rows });
      if (!ID.test(cid) || !ID.test(uid)) return Promise.resolve(null);
      if (!keptBooks.has(uid)) keptBooks.set(uid, Promise.resolve().then(() => env.local.get(BOOKS(uid))).then((r) => r?.[BOOKS(uid)] || {}, () => ({})));
      return keptBooks.get(uid).then((all) => {
        const x = all[cid];
        return Array.isArray(x?.rows) && Number.isFinite(x.at) ? { at: x.at, rows: covered([...x.rows], x.complete) } : null;
      });
    };

    // ---- a course's content: one store per site, by course ----
    // Its items from the public contents list (recursive, these fields only: never contentDetail, B0), at most every five
    // minutes and one read at a time, for the new-content badges, the palette, Download all and a hover's prefetch;
    // search's documents take a read with their bodies (body), which answers the others too. → { items, complete }.
    const outlines = new Map(); // cid → { at, body, value, p }
    const outline = (cid, { prio = 0, maxAge = OUTLINE_TTL, body = false } = {}) => {
      if (!ID.test(cid)) return Promise.resolve({ items: [], complete: true });
      const o = outlines.get(cid);
      // Finish the narrower read before upgrading it, so a late metadata answer cannot replace document bodies.
      if (o?.p) return o.pBody || !body ? o.p : o.p.catch(() => {}).then(() => outline(cid, { prio, maxAge, body }));
      if (o?.value && (o.body || !body) && env.now() - o.at < maxAge) return Promise.resolve(o.value);
      const p = fanout(prio).list(`/learn/api/public/v1/courses/${cid}/contents`, `${OUTLINE_FIELDS}${body ? ',body' : ''}`, true).then((value) => {
        outlines.set(cid, { at: env.now(), body, value });
        return value;
      }, (e) => { if (outlines.get(cid)?.p === p) outlines.set(cid, { ...o, p: null }); throw e; });
      outlines.set(cid, { ...o, p, pBody: body });
      return p;
    };
    // A fresh read already in hand, or null: search takes one with bodies as it is.
    const outlineNow = (cid, { body = false } = {}) => { const o = outlines.get(cid); return o?.value && (o.body || !body) && env.now() - o.at < OUTLINE_TTL ? o.value : null; };
    // Fresh enough not to ask again: for the idle prefetch.
    const fresh = { book: (cid, uid) => { const b = books.get(`${uid} ${cid}`); return !!b?.p || (!!b?.rows && env.now() - b.at < BOOK_TTL); } };

    // ---- what's due ----
    // One read per range of whole days, kept two minutes from when it was asked: a range inside a fresh one is answered
    // by it, so Better To Do, the cards, the reminders, the agenda and the rail share one read. Its links made whole
    // (Ultra's <base href> is its CDN); at: when it was asked. prio: the queue's, for the reads it starts.
    const reads = []; // { from, to, at, done, p }
    const due = (from, to, prio = 0) => {
      const a = dayStart(from), b = dayEnd(to), now = env.now();
      for (let i = reads.length; i--;) if (reads[i].done && now - reads[i].at >= PLAN_TTL) reads.splice(i, 1);
      const hit = reads.find((x) => x.from <= a && x.to >= b);
      if (hit) return hit.p;
      const x = { from: a, to: b, at: now, done: false };
      const r = { ...reader({ prio }), me, memberships: () => mine().then((m) => m.mem), grades: (cid, uid) => book(cid, uid, { prio }) };
      x.p = planner(r, { from: a, to: b, now }).then((p) => ({ ...p, at: now, items: p.items.map((i) => ({ ...i, url: at() + i.url })) }));
      x.p.then(() => { x.done = true; }, () => { const i = reads.indexOf(x); if (i !== -1) reads.splice(i, 1); });
      reads.push(x);
      return x.p;
    };
    // Better To Do's own range and switches (planner/todo.js fetchRange), when its library and settings can be had.
    const own = async (now) => {
      const L = await Promise.resolve().then(() => env.todo()).catch(() => null);
      const o = L && await Promise.resolve().then(() => env.todoPrefs()).catch(() => null);
      return o ? { ...L.fetchRange(o, now, zone()), teach: o.teacher, progress: o.progress } : null;
    };
    const published = new WeakSet();

    const page = {
      // Who to paint for before anything answers: { id, time_zone, courses? } or null. Panels confirm it (profile) before
      // they ask or keep anything, and start again for a different student.
      known: () => known().then((k) => (k ? { id: k.uid, time_zone: zone(), courses: k.courses } : null)),
      profile: () => me().then((id) => ({ id, time_zone: zone() })),
      me, mine,
      // Canvas's course list's shape (list above).
      courses: () => mine().then((m) => list(m.mem, { origin: at() })),
      due: (from, to, prio) => due(from, to, prio),
      // Agenda/rail: this account's covered To Do copy for ten minutes (for the student it's drawn for, uid, without
      // waiting on who is signed in); else, inside Better To Do's own range, that range's read, kept as the To Do copy
      // through the worker as Better To Do keeps it ('glaze:todo', newest wins); else this range's.
      planned: async (from, to, cache, uid, prio = 0) => {
        const covers = (key) => cache?.key === key && env.now() - cache.at < 600000 && Date.parse(cache.start) <= from && Date.parse(cache.end) >= to;
        if (ID.test(uid) && covers(`todo:${at()}/${uid}`)) return { key: cache.key, items: cache.items || [] };
        const { id } = await page.profile(), key = `todo:${at()}/${id}`, now = env.now();
        if (covers(key)) return { key, items: cache.items || [] };
        const w = await own(now);
        if (!w || Date.parse(w.start) > from || Date.parse(w.end) < to) return { key, ...await page.due(from, to, prio) };
        const r = await page.due(Date.parse(w.start), Date.parse(w.end), prio);
        if (!published.has(r)) {
          published.add(r);
          send({ type: 'glaze:todo', key, cache: { key, at: r.at, start: w.start, end: w.end, teach: w.teach, progress: w.progress, items: r.items, complete: r.complete, grading: [], sums: {} } });
        }
        return { key, ...r };
      },
      book, saved, outline, outlineNow, fresh,
    };
    return page;
  };
  const lmsq = () => (globalThis.GZ_LMSQ ? Promise.resolve(GZ_LMSQ)
    : globalThis.GZ_CTX?.need ? GZ_CTX.need('courses/lmsq.js', () => globalThis.GZ_LMSQ).then(() => globalThis.GZ_LMSQ || null, () => null) : Promise.resolve(null));
  const area = (name) => ({
    get: (k) => new Promise((res) => { try { chrome.storage[name].get(k, (r) => res(chrome.runtime.lastError ? {} : r || {})); } catch { res({}); } }),
    set: (v) => new Promise((res) => { try { chrome.storage[name].set(v, () => res(!chrome.runtime.lastError)); } catch { res(false); } }),
  });
  // Reads stop once Glaze is turned off, or off this page (the site's part says so: page.alive).
  let alive = () => true;
  const live = () => globalThis.GZ_CTX?.settings?.()?.enabled !== false && alive();
  const page = makePage({
    origin: () => location.origin, now: () => Date.now(), live,
    // The site's queue once it's in (one backoff for every read), plain fetch where it can't be (node, the preview).
    fetch: (u, init, prio, still) => lmsq().then((q) => (q ? q.fetch(u, init, prio, still) : fetch(u, init))),
    local: area('local'),
    send: (m) => new Promise((res) => { try { chrome.runtime.sendMessage(m, (r) => res(chrome.runtime.lastError ? null : r))?.then?.(res, () => res(null)); } catch { res(null); } }),
    todo: () => (globalThis.GZ_TODO ? GZ_TODO : globalThis.GZ_CTX?.need ? GZ_CTX.need('planner/todo.js', () => globalThis.GZ_TODO).then(() => globalThis.GZ_TODO || null) : null),
    todoPrefs: () => (typeof GZ_SANITIZE === 'undefined' ? null : area('sync').get('todo').then((r) => GZ_SANITIZE({ todo: r?.todo }).todo)),
  });
  page.alive = (f) => { alive = f; };

  return { contentLink, SEARCH_KINDS, searchItems, PEEK_FIELDS, peekItem, FILES_FIELDS, attachments, files, courses, ownDates, list, current, standing, due, work, grade, trend, slices, read, planner, excepts, page, makePage, STALE };
})();

if (typeof module !== 'undefined') module.exports = GZ_ULTRA; else GZ_ULTRA;
