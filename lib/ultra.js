// Blackboard Ultra's answers, in the shapes Glaze's Canvas features already use: courses and terms as the editor and
// GZ_COURSES have them, due items as lib/todo.js's planner items (which lib/remind.js and lib/calexport.js read), work as
// lib/insights.js's items, and gradebook rows as lib/gradecalc.js's model() takes them. Pure apart from read(), which
// asks the student's own Ultra. Shapes and rules come from the B0 spike (parity/spikes/B0.md); a rule B0 inferred rather
// than measured is marked [I] here and in test/ultra.test.js.
// Classic script, loaded on demand (content.js need()): a second injection keeps the first; module.exports for node.
var GZ_ULTRA = globalThis.GZ_ULTRA || (() => {
  const P = typeof GZ_PAGE !== 'undefined' ? GZ_PAGE : require('./page.js');
  const COURSES = typeof GZ_COURSES !== 'undefined' ? GZ_COURSES : require('../defaults.js').GZ_COURSES;
  const calc = () => globalThis.GZ_GRADECALC || require('./gradecalc.js');
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

  // Search reads public lists only. Project before caching: no handler objects, launch URLs, read state or LTI data.
  const SEARCH_KINDS = [
    { kind: 'Page', list: 'contents', fields: 'id,parentId,title,availability.available,body', also: '&recursive=true' },
    { kind: 'Announcement', list: 'announcements', fields: 'id,title,body,availability' },
    { kind: 'Discussion', list: 'discussions', fields: 'id,title,available,topic.body,topic.status' },
  ];
  const searchItems = (k, items, course, text, now = Date.now()) => {
    if (!ID.test(course?.id)) return [];
    const byId = new Map(arr(items).map((x) => [x?.id, x]));
    const visible = (x) => {
      const seen = new Set();
      for (let p = x; p; p = byId.get(p.parentId)) {
        if (seen.has(p.id) || p.availability?.available !== 'Yes') return false;
        seen.add(p.id);
      }
      return true;
    };
    return arr(items).filter((x) => {
      if (!ID.test(x?.id) || !str(x.title).trim()) return false;
      if (k.list === 'contents') return visible(x);
      if (k.list === 'discussions') return x.available === true && x.topic?.status === 'Published';
      const d = x.availability?.duration;
      const end = ms(d?.end);
      return x.availability?.available !== 'No' && !(ms(d?.start) > now) && !(end !== null && end < now);
    }).map((x) => ({
      key: `${course.id}/${k.list}:${x.id}`, title: str(x.title).trim(), kind: k.kind, course: course.name,
      // B0 confirms nautilus content redirects. Other results open the tool's list, without opening or marking a post read.
      url: k.list === 'contents' ? `/ultra/redirect?redirectType=nautilus&courseId=${course.id}&contentId=${x.id}`
        : `/ultra/courses/${course.id}/${k.list === 'discussions' ? 'engagement' : 'announcements'}`,
      text: text(str(k.list === 'discussions' ? x.topic?.body : x.body, 100000)).slice(0, 20000),
    }));
  };

  // ---- courses and terms ---------------------------------------------------------------------------------------------
  // GZ_COURSES's map (name, color slot, organization; hidden courses left out), with each course's code, whether it's
  // closed, its term and its banner. A term is the course's own (memberships?expand=course has it inline) or, by
  // termId, one from /terms; dates only for a date-range term, named as Canvas names them so lib/calexport.js's range
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
    const draft = a?.status === 'IN_PROGRESS';
    const at = (!draft && ms(a?.attemptDate)) || null;
    const graded = row?.status === 'GRADED' || s === 'GRADED';
    // Handed in with no date to go by: a submitted status, a row waiting for a grade, or an earlier attempt behind
    // a draft [I].
    const handed = !!at || s === 'SUBMITTED' || row?.status === 'NEEDS_GRADING' || (draft && !!row.firstAttemptId && row.firstAttemptId !== row.lastAttemptId);
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
    const nothing = s ? NOTHING.has(s) : !row?.status && (!row?.lastAttemptId || draft);
    if (!nothing) return out('unknown');
    if (!due || due > now) return out('open');
    return out(excepted ? 'unknown' : 'missing');
  };

  // ---- due items -----------------------------------------------------------------------------------------------------
  // To Do (calendars/todo/studentItems: { overdueItems, dueTodayItems, futureDueItems }, one answer per slice) and the
  // calendar (calendars/calendarItems results) as lib/todo.js's planner items, one per gradebook column: both name it
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
  // Its graded items' columns (not the overall grade, not other calculated columns) as lib/insights.js's items:
  // k, n, d (due), p (points), a (handed in), s (excused, late, missing, on, open; '' when unknown).
  const S = { excused: 'excused', late: 'late', missing: 'missing', 'on-time': 'on', open: 'open', unknown: '' };
  const work = (rows, now, excepted = () => false) => arr(rows).filter((r) => r?.column?.calculationType === 'NON_CALCULATED' && !r.column.externalGrade && ID.test(r.columnId)).map((r) => {
    const st = standing(r, now, excepted(r.columnId));
    const type = /forumlink/.test(r.column.scoreProviderHandle || '') ? 'discussion_topic' : r.column.assessmentSubtype === 'Test' ? 'quiz' : 'assignment';
    return { k: `${type}:${r.columnId}`, n: str(r.column.effectiveColumnName || r.column.columnName, 120), d: st.due || 0, p: Math.max(0, Number(r.column.possible) || 0), a: st.at || 0, s: S[st.state] };
  });

  // ---- grades ----------------------------------------------------------------------------------------------------------
  // The course's gradebook rows through lib/gradecalc.js's model(), and its letter cut-offs. Where the course returns
  // no overall formula, one Glaze can't read, or one that doesn't reproduce Blackboard's own figure, the result is
  // the share of points in graded work, flagged estimate: true (owner decision 3), with Blackboard's figure beside it
  // (overall) and why. schemas: gradebook/schemas results; the overall column's own, when it's a letter scale, gives
  // scale: [[letter, min %]], highest first, as lib/gpa.js takes it.
  const grade = (rows, schemas = []) => {
    const G = calc();
    const m = G.model(rows);
    const overallRow = arr(rows).find((r) => r?.column?.externalGrade);
    const schema = arr(schemas).find((s) => s?.id && s.id === overallRow?.column?.gradingSchemaId);
    // [I] a symbol's lowerBound when Ultra sends one, else its absoluteValue (B0 saw only the latter).
    const scale = /^tabular$/i.test(schema?.scaleType || '') ? arr(schema.symbols).map((s) => [str(s?.text, 20), Number(s?.lowerBound ?? s?.absoluteValue)])
      .filter(([t, v]) => t && Number.isFinite(v)).sort((a, b) => b[1] - a[1]) : null;
    if (m.kind === 'weighted') return { ...m, estimate: false, scale: scale?.length ? scale : null };
    const pts = G.model(arr(rows).filter((r) => !r?.column?.externalGrade));
    const overall = overallRow?.displayGrade?.score != null ? Number(overallRow.displayGrade.score) : null;
    return { ...pts, estimate: true, overall, why: m.kind === 'unsupported' ? m.note : '', scale: scale?.length ? scale : null };
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
      for (let p = path, n = 0; p && n < maxPages; n++) {
        const j = await get(p);
        out.push(...arr(j?.results));
        const next = str(j?.paging?.nextPage, 2000);
        let u = null;
        try { u = next ? new URL(next, `${origin}${p}`) : null; } catch { /* none */ }
        p = u && u.origin === origin ? u.pathname + u.search : '';
      }
      return out;
    };
    const iso = (t) => encodeURIComponent(new Date(t).toISOString());
    return {
      get, all,
      search: async (course, k, text) => {
        const cid = course?.id;
        if (!ID.test(cid) || !SEARCH_KINDS.includes(k)) return [];
        const path = `/learn/api/public/v1/courses/${cid}/${k.list}`;
        const items = [];
        let query = `?limit=200${k.also || ''}`;
        for (let n = 0; query && n < maxPages; n++) {
          const params = new URLSearchParams({ limit: '200', fields: k.fields });
          const offset = new URLSearchParams(query).get('offset');
          if (offset && /^\d{1,9}$/.test(offset)) params.set('offset', offset);
          if (k.also) params.set('recursive', 'true');
          const j = await get(`${path}?${params}`);
          items.push(...arr(j?.results).slice(0, 200));
          let next = null;
          try { if (j?.paging?.nextPage) next = new URL(j.paging.nextPage, origin + path); } catch { /* no next page */ }
          // A nextPage may page this list only, never switch to a thread, private API or another site.
          query = next?.origin === origin && next.pathname === path ? next.search : '';
        }
        return searchItems(k, items, course, text);
      },
      me: () => get('/learn/api/v1/users/me').then((m) => (ID.test(m?.id) ? m.id : Promise.reject(new Error('no user')))),
      memberships: (uid) => all(`/learn/api/v1/users/${uid}/memberships?expand=course&limit=200`),
      terms: () => all('/learn/api/v1/terms?limit=200'),
      todo: async (from, to) => {
        const out = [];
        for (const [a, b] of slices(from, to, 14).slice(0, MAX_TODO_SLICES)) out.push(await get(`/learn/api/v1/calendars/todo/studentItems?since=${iso(a)}&until=${iso(b)}`));
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
    };
  };

  // Everything due from `from` to `to` (ms), as due() gives it, read one request at a time: the student, their
  // courses (names, due-date exception settings), To Do and the calendar, then the gradebook of each course with
  // something due. A course whose students have due-date exceptions turned on, or whose own exceptions can't be read,
  // has no late or missing work ([I], as content.js's due-date chips reckon it); otherwise an item named in the
  // course's exceptions answer has none either. → { items, complete: false when the calendar couldn't be read whole }.
  const planner = async (r, { from, to, now }) => {
    const uid = await r.me();
    const mem = await r.memberships(uid);
    const names = Object.fromEntries(Object.entries(COURSES(mem)).map(([id, c]) => [id, c.name]));
    const todo = await r.todo(from, to);
    const { items: calendar, complete } = await r.calendar(from, to);
    const ids = new Set(due({ todo, calendar, now }).map((i) => `${i.cid} ${i.id}`));
    const rows = {}, exc = {};
    for (const cid of new Set([...ids].map((k) => k.split(' ')[0]))) {
      rows[cid] = await r.grades(cid, uid).catch((e) => { if (e.message === STALE) throw e; return []; });
      const m = mem.find((x) => x?.courseId === cid);
      const risky = rows[cid].filter((g) => ids.has(`${cid} ${g?.columnId}`) && /^(late|missing)$/.test(standing(g, now).state)).map((g) => g.columnId);
      if (!risky.length) continue;
      if (m?.dueDateExceptionType !== 'Normal' || !ID.test(m?.id)) { exc[cid] = () => true; continue; }
      const text = await r.get(`/learn/api/v1/courses/${cid}/gradebook/memberships/${m.id}/exceptions?columnId=${risky.join(',')}`)
        .then((j) => JSON.stringify(j?.results || []), (e) => { if (e.message === STALE) throw e; return null; });
      exc[cid] = text === null ? () => true : (col) => text.includes(col);
    }
    return { items: due({ todo, calendar, rows, names, now, excepted: (cid, col) => !!exc[cid]?.(col) }), complete };
  };

  return { SEARCH_KINDS, searchItems, PEEK_FIELDS, peekItem, FILES_FIELDS, attachments, files, courses, standing, due, work, grade, slices, read, planner, STALE };
})();

if (typeof module !== 'undefined') module.exports = GZ_ULTRA; else GZ_ULTRA;
