// Agent apps' reads in an LMS tab: lib/mcp/tabs.js puts this into the top frame of the account's own tab and calls run.
// todo and insights read the planner and Insights afresh as the page's own features do (features/cardtasks.js load,
// features/insights.js load: the same libraries, requests and record) and keep what they read through the worker's publish
// paths ('glaze:todo', 'glaze:insights'), so every cache updates the normal way. Insights only while it is on and keeps a
// record for this account: one the student cleared, or never made, is theirs to make by opening Insights. assignment reads
// one assignment's title, due date, points, instructions, the names of the files they attach and its rubric's definition:
// Ultra's as Writer reads it (lib/writer-context-assignment.js build), Canvas's from its assignment through lib/rubric.js;
// never a submission or an attempt, so never the student's scores or feedback. mark is Canvas's planner mark for an item,
// with the page's CSRF token (lib/mcp/tools-study.js todo_mark_done, once the student allowed it). The worker binds each
// call to its document, origin, uid and deadline (at most LIMIT.ms), and cancels it by id; no late requests or publishes.
// Content side, in Glaze's own world (GZ_CTX); a second injection keeps the first. run(op, args) → { ok: true, … } or
// { ok: false, error }.
var GZ_MCP_TAB = globalThis.GZ_MCP_TAB || (() => {
  // ms: the most a read takes; text: the characters of an assignment's text.
  const LIMIT = { ms: 8e3, text: 200000 };
  const ACCEPT = 'application/json+canvas-string-ids, application/json';
  const ID = /^\d{1,20}$/, BB = /^_\d{1,20}_\d{1,20}$/;
  const no = (error) => ({ ok: false, error });
  const X = () => globalThis.GZ_CTX;
  const send = (m) => new Promise((res) => { try { chrome.runtime.sendMessage(m, (r) => res(chrome.runtime.lastError ? null : r)); } catch { res(null); } });
  const get = (keys) => new Promise((res) => { try { chrome.storage.local.get(keys, (r) => res(chrome.runtime.lastError || !r ? null : r)); } catch { res(null); } });
  // One request to this site, never followed elsewhere, only while go() says yes. → { j, next (the Link header's next page,
  // on this site) }.
  const req = async (path, go, init = {}) => {
    if (!go()) throw new Error('late');
    const r = await fetch(go.origin + path, { credentials: 'same-origin', redirect: 'error', ...init, signal: go.signal, headers: { accept: ACCEPT, ...init.headers } });
    if (!go()) throw new Error('late');
    if (!r.ok) throw new Error(String(r.status));
    const j = JSON.parse((await r.text()).replace(/^while\(1\);/, ''));
    if (!go()) throw new Error('late');
    const link = r.headers.get('link')?.match(/<([^>]+)>;\s*rel="next"/)?.[1];
    let next = null;
    try { const u = link && new URL(link, go.origin); next = u && u.origin === go.origin && u.pathname === path.split('?')[0] ? u.pathname + u.search : null; } catch { /* not an address */ }
    return { j, next, more: !!link };
  };
  // Every page of a list Canvas pages with Link headers, up to max; more: it had more.
  const pages = async (path, go, max) => {
    const out = [];
    let p = path, more = false;
    for (let i = 0; p && i < max; i++) { const r = await req(p, go); if (!Array.isArray(r.j)) throw new Error('not a list'); out.push(...r.j); p = r.next; more = r.more; }
    out.more = more;
    return out;
  };
  const libs = (...files) => Promise.all(files.map(([f, g]) => X().need(f, () => globalThis[g])));

  // ---- the planner, as features/cardtasks.js load reads it, kept in the list's shape ----
  const prefs = () => new Promise((res) => { try { chrome.storage.sync.get('todo', (r) => res(r?.todo)); } catch { res(); } }).then((raw) => GZ_SANITIZE({ todo: raw }).todo);
  const todo = async (go) => {
    const x = X(), ultra = x.site === 'ultra';
    await libs(['lib/todo.js', 'GZ_TODO']);
    const L = GZ_TODO, [p, o] = await Promise.all([x.profile(), prefs()]);
    if (!L.ID.test(String(p?.id)) || String(p.id) !== go.uid) return no('profile');
    const key = L.storeKey(location.origin, String(p.id)), now = Date.now(), { start, end } = L.fetchRange(o, now, L.zone(p.time_zone));
    let cache, due;
    if (ultra) {
      await libs(['lib/ultra.js', 'GZ_ULTRA']);
      const reader = GZ_ULTRA.read({ origin: go.origin, signal: go.signal, live: go });
      const r = await GZ_ULTRA.planner({ ...reader, me: async () => go.uid }, { from: Date.parse(start), to: Date.parse(end), now });
      cache = { key, at: now, start, end, teach: o.teacher, progress: o.progress, items: r.items.map((i) => ({ ...i, url: go.origin + i.url })), complete: r.complete, grading: [], sums: {} };
    } else {
      const [raw, list] = await Promise.all([pages(`/api/v1/planner/items?start_date=${start}&end_date=${end}&per_page=100`, go, 10), x.canvasCourses()]);
      // A teacher's list also wants the grading: teach null, so the list asks for that alone (features/todo.js load).
      const teaches = list.some((c) => (c.enrollments || []).some((e) => /^(teacher|ta)/i.test(e.type || '')));
      cache = { key, at: now, start, end, teach: o.teacher && teaches ? null : o.teacher, progress: o.progress, items: raw.map(L.slim), complete: !raw.more, grading: [], sums: {} };
      due = GZ_CANVAS_DUE_WEEK(raw, now);
    }
    if (!go()) return no('late');
    const r = await send({ type: 'glaze:todo', key, cache, due });
    return r?.ok ? { ok: true } : no('not kept');
  };

  // ---- Insights, as features/insights.js load reads it, three courses at a time ----
  const insights = async (go) => {
    const x = X(), s = x.settings(), ultra = x.site === 'ultra';
    if (s.enabled === false || !s.enhance?.insights) return no('off');
    await libs(['lib/todo.js', 'GZ_TODO']);
    await libs(['lib/gradecalc.js', 'GZ_GRADECALC'], ['lib/insights.js', 'GZ_INSIGHTS'], ...(ultra ? [['lib/ultra.js', 'GZ_ULTRA']] : []));
    const I = GZ_INSIGHTS, L = GZ_TODO, now = Date.now();
    let uid, term, tz;
    if (ultra) {
      const mem = await x.myCourses();
      if (mem.complete === false) return no('memberships');
      uid = String(mem.find((m) => BB.test(m?.userId || ''))?.userId || '');
      term = GZ_ULTRA.current(mem, now);
      tz = L.zone(Intl.DateTimeFormat().resolvedOptions().timeZone);
    } else {
      const [p, list] = await Promise.all([x.profile(), x.canvasCourses()]);
      uid = String(p?.id ?? '');
      term = I.term(list, now);
      tz = L.zone(p?.time_zone);
    }
    if (!(ultra ? BB : ID).test(uid) || uid !== go.uid) return no('profile');
    const key = I.storeKey(location.origin, uid), rec = I.clean((await get(key))?.[key]);
    if (!rec?.courses.length) return no('none');
    if (!term.courses.length) return no('term');
    const at = Date.now();
    const one = async (c) => {
      if (ultra) {
        const r = GZ_ULTRA.read({ origin: go.origin, signal: go.signal, live: go });
        const rows = await r.grades(c.id, uid);
        const excepted = await GZ_ULTRA.excepts(r, c.m, c.id, rows, at);
        return { id: c.id, name: c.name, q: false, more: rows.complete === false, items: GZ_ULTRA.work(rows, at, excepted), trend: rows.complete === false ? [] : GZ_ULTRA.trend(rows, tz), gp: '' };
      }
      const [groups, periods] = await Promise.all([
        pages(`/api/v1/courses/${c.id}/assignment_groups?include[]=assignments&include[]=submission&exclude_response_fields[]=description&exclude_response_fields[]=rubric&per_page=100`, go, 20),
        c.has_grading_periods ? req(`/api/v1/courses/${c.id}/grading_periods`, go).then(({ j }) => j.grading_periods) : null,
      ]);
      const q = !!c.restrict_quantitative_data;
      const work = groups.flatMap((g) => g.assignments || []).filter((a) => a.published !== false && a.workflow_state !== 'unpublished');
      const gp = c.enrollments?.find((e) => e?.type === 'student')?.current_grading_period_id;
      const trend = q ? [] : I.trend(groups, { weighted: c.apply_assignment_group_weights, periods, weightedPeriods: c.has_weighted_grading_periods }, tz, gp);
      return { id: String(c.id), name: c.name, q, more: groups.more, items: work.map((a) => I.item(a, at)), trend, gp: trend.some((p) => p[2]) ? String(gp) : '' };
    };
    const out = [];
    let next = 0, failed = false;
    await Promise.all([0, 1, 2].map(async () => {
      while (next < term.courses.length && !failed && go()) {
        const c = term.courses[next++];
        out.push(await one(c).catch(() => { failed = true; return null; }));
      }
    }));
    // A course that couldn't be read leaves the saved record as it is, as the view does.
    if (failed || out.length < term.courses.length || !go()) return no(failed ? 'course' : 'late');
    const order = new Map(term.courses.map((c, i) => [String(c.id), i]));
    const courses = out.filter(Boolean).sort((a, b) => order.get(a.id) - order.get(b.id));
    const fresh = I.clean({ term: term.key, name: term.name, from: term.from, to: term.to, at, courses });
    const r = await send({ type: 'glaze:insights', op: 'put', key, at, base: rec.cl || 0, rec: fresh });
    return r?.ok ? { ok: true } : no(r?.error || 'not kept');
  };

  // ---- one assignment: its text, its files' names, its rubric's definition; never a submission or an attempt ----
  // Rich text as text, block ends as line breaks (lib/writer-context-assignment.js reads Ultra's the same way).
  const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  const char = (m, e) => {
    if (e[0] !== '#') return ENT[e.toLowerCase()] ?? m;
    const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1));
    return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
  };
  const text = (h) => String(h).replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, '').replace(/<(br|\/p|\/div|\/li|\/h\d|\/tr)\b[^>]*>/gi, '\n').replace(/<[^>]*>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, char).replace(/[ \t\f\r ]+/g, ' ').replace(/ ?\n ?/g, '\n').replace(/\n{2,}/g, '\n').trim().slice(0, LIMIT.text);
  // The files a Canvas description links on this site (its API writes each as an absolute link to the course's, a group's or a
  // user's /files/<id>): by the link's text, else its title, each once.
  const files = (h) => {
    const out = new Map();
    for (const [, tag, inner] of String(h).matchAll(/<a\s((?:[^"'<>]|"[^"]*"|'[^']*')*)>([\s\S]*?)<\/a\s*>/gi)) {
      const attr = (n) => { for (const m of tag.matchAll(/([^\s"'<>/=]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g)) if (m[1].toLowerCase() === n) return (m[2] ?? m[3] ?? m[4]).replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, char); return ''; };
      let u;
      try { u = new URL(attr('href'), location.origin); } catch { continue; }
      const id = u.origin === location.origin && /^\/(?:(?:courses|groups|users)\/\d+\/)?files\/(\d+)(?:\/|$)/.exec(u.pathname)?.[1];
      const name = text(inner).replace(/\s+/g, ' ') || attr('title').trim();
      if (id && name && !out.has(id)) out.set(id, name.slice(0, 200));
    }
    return [...out.values()].slice(0, 20);
  };
  // Ultra keeps a rubric's descriptions as rich text: as text here, as the rest.
  const plain = (r) => ({ ...r, ...(typeof r.detail === 'string' && { detail: text(r.detail) }),
    criteria: r.criteria.map((c) => ({ ...c, detail: text(c.detail || ''), cells: (c.cells || []).map((x) => ({ ...x, detail: text(x.detail || '') })) })) });
  const assignment = async (go, a) => {
    const x = X(), ultra = x.site === 'ultra', ok = ultra ? BB : ID;
    if (!ok.test(a.course || '') || !ok.test(a.assignment || '')) return no('args');
    await libs(['lib/rubric.js', 'GZ_RUBRIC_LIB'], ['lib/writer-context-assignment.js', 'GZ_WRITER_CONTEXT_ASSIGNMENT'], ...(ultra ? [['lib/ultra.js', 'GZ_ULTRA']] : []));
    const R = GZ_RUBRIC_LIB, W = GZ_WRITER_CONTEXT_ASSIGNMENT, uid = String(await x.account());
    if (ultra) {
      // Writer's own read of an assignment (build), from the course's content item, gradebook row and rubric column; the
      // rubric as it shows before an attempt, so no evaluation is asked for.
      const reader = GZ_ULTRA.read({ origin: go.origin, signal: go.signal, live: go, maxPages: 3, maxRequests: 8 });
      let rows = null;
      const c = await W.build({ school: location.host, path: `/ultra/courses/${a.course}/assessment/${a.assignment}/attempt`, url: '', origin: location.origin,
        uid: async () => uid, me: async () => null, courses: () => x.myCourses(), rows: async () => (rows = await reader.grades(a.course, uid)), get: (u) => reader.get(u), R, instructions: async () => '' });
      const s = c?.assignment;
      if (!go()) return no('late');
      if (!s || (!s.title && !s.instructions && !s.description && !s.rubric)) return no('none');
      const col = (Array.isArray(rows) ? rows : []).map((r) => r?.column).find((k) => k?.contentId === a.assignment);
      return { ok: true, title: s.title, due: Date.parse(s.due) || null, points: Number.isFinite(col?.possible) ? col.possible : null, instructions: s.instructions, description: s.description,
        files: s.files.map((f) => f.name), rubric: s.rubric && plain(s.rubric), incomplete: s.incomplete === true };
    }
    let s;
    try { ({ j: s } = await req(`/api/v1/courses/${a.course}/assignments/${a.assignment}`, go)); } catch (e) { if (/^(401|403|404)$/.test(e.message)) return no('none'); throw e; }
    if (String(s?.id) !== a.assignment || String(s?.course_id) !== a.course) return no('none');
    const html = typeof s.description === 'string' ? s.description : '';
    const m = R.parse.canvas(s, null, { courseId: a.course, assignmentId: a.assignment });
    return { ok: true, title: typeof s.name === 'string' ? s.name.slice(0, 300) : '', due: Date.parse(s.due_at) || null,
      points: s.restrict_quantitative_data !== true && Number.isFinite(s.points_possible) ? s.points_possible : null,
      instructions: text(html), description: '', files: files(html), rubric: m ? W.rubricOf(m) : null, incomplete: html.length > LIMIT.text };
  };

  // ---- Canvas's planner mark, as features/todo.js write sends it: the page's CSRF token, an assignment behind a quiz or a
  // discussion marked as the assignment, PUT to an override Canvas keeps already. → the override Canvas kept ----
  const csrf = () => { const m = document.cookie.match(/(?:^|;\s*)_csrf_token=([^;]*)/); return m ? decodeURIComponent(m[1]) : ''; };
  const mark = async (go, a) => {
    const x = X();
    if (x.site !== 'canvas' || !ID.test(a.id || '') || !/^[a-z_]{1,40}$/.test(a.type || '') || (a.aid && !ID.test(a.aid)) || (a.ov && !ID.test(a.ov))) return no('args');
    const uid = String(await x.account());
    if (!ID.test(uid) || uid !== go.uid) return no('profile');
    const body = { plannable_id: a.aid || a.id, plannable_type: a.aid ? 'assignment' : a.type, user_id: uid, marked_complete: true };
    if (!go()) return no('late');
    try {
      const { j } = await req(`/api/v1/planner/overrides${a.ov ? `/${a.ov}` : ''}`, go, {
        method: a.ov ? 'PUT' : 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': csrf(), 'x-requested-with': 'XMLHttpRequest' },
        body: JSON.stringify(a.ov ? { id: a.ov, ...body } : body),
      });
      return ID.test(String(j?.id)) && j.marked_complete === true ? { ok: true, ov: { id: String(j.id), done: true, dismissed: !!j.dismissed } } : no('no override');
    } catch (e) { return { ...no('not confirmed'), uncertain: !/^4\d\d$/.test(e.message) }; }
  };

  const OPS = { todo, insights, assignment, mark };
  const jobs = new Map();
  const cancel = (id) => {
    if (jobs.has(id)) jobs.get(id)?.abort();
    else { jobs.set(id, null); if (jobs.size > 128) jobs.delete(jobs.keys().next().value); }
  };
  const run = async (op, args) => {
    const x = X(), a = args && typeof args === 'object' ? args : {};
    if (!x?.on() || !Object.hasOwn(OPS, op) || location.origin !== a.origin || location.href !== a.href || (a.doc !== null && globalThis.__gzDoc !== a.doc)) return no('here');
    if (op === 'insights' && (x.settings().enabled === false || !x.settings().enhance?.insights)) return no('off');
    const id = a.call;
    if (typeof id !== 'string' || jobs.has(id)) { jobs.delete(id); return no('cancelled'); }
    const ac = new AbortController(), end = Math.min(a.end, Date.now() + LIMIT.ms);
    if (!Number.isFinite(end) || end <= Date.now()) return no('late');
    jobs.set(id, ac);
    const go = () => !ac.signal.aborted && Date.now() < end && X() === x && x.on() && location.origin === a.origin && location.href === a.href;
    Object.assign(go, { origin: a.origin, uid: a.uid, signal: ac.signal });
    const timer = setTimeout(() => ac.abort(), end - Date.now());
    const stopped = new Promise((res) => ac.signal.addEventListener('abort', () => res(no('timeout')), { once: true }));
    const work = async () => {
      if (String(await x.account()) !== a.uid || !go()) return no('profile');
      // GZ_CTX caches identity for a document. Cookies can change in another tab without replacing this document.
      const { j: me } = await req(x.site === 'ultra' ? '/learn/api/v1/users/me' : '/api/v1/users/self/profile', go);
      if (String(me?.id) !== a.uid || !go()) return no('profile');
      return OPS[op](go, a);
    };
    try { return await Promise.race([work(), stopped]); } catch { return no(go() ? 'failed' : 'late'); }
    finally { clearTimeout(timer); ac.abort(); jobs.delete(id); }
  };
  return { LIMIT, run, cancel };
})();
GZ_MCP_TAB;
