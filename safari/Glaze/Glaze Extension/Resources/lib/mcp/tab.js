// Agent apps' reads in an LMS tab: lib/mcp/tabs.js puts this into the top frame of the account's own tab and calls run.
// todo and insights read the planner and Insights afresh as the page's own features do (features/cardtasks.js load,
// features/insights.js load: the same libraries, requests and record) and keep what they read through the worker's publish
// paths ('glaze:todo', 'glaze:insights'), so every cache updates the normal way. Insights only while it is on and keeps a
// record for this account: one the student cleared, or never made, is theirs to make by opening Insights. Past args.ms (at
// most LIMIT.ms) nothing more is asked of the site and nothing is kept; a read that didn't finish whole keeps nothing.
// Content side, in Glaze's own world (GZ_CTX); a second injection keeps the first. run(op, args) → { ok: true, … } or
// { ok: false, error }.
var GZ_MCP_TAB = globalThis.GZ_MCP_TAB || (() => {
  const LIMIT = { ms: 8e3 };
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
    const r = await fetch(location.origin + path, { credentials: 'same-origin', redirect: 'error', ...init, headers: { accept: ACCEPT, ...init.headers } });
    if (!r.ok) throw new Error(String(r.status));
    const j = JSON.parse((await r.text()).replace(/^while\(1\);/, ''));
    const link = r.headers.get('link')?.match(/<([^>]+)>;\s*rel="next"/)?.[1];
    let next = null;
    try { const u = link && new URL(link, location.origin); next = u && u.origin === location.origin ? u.pathname + u.search : null; } catch { /* not an address */ }
    return { j, next };
  };
  // Every page of a list Canvas pages with Link headers, up to max; more: it had more.
  const pages = async (path, go, max) => {
    const out = [];
    let p = path;
    for (let i = 0; p && i < max; i++) { const { j, next } = await req(p, go); if (Array.isArray(j)) out.push(...j); p = next; }
    out.more = !!p;
    return out;
  };
  const libs = (...files) => Promise.all(files.map(([f, g]) => X().need(f, () => globalThis[g])));

  // ---- the planner, as features/cardtasks.js load reads it, kept in the list's shape ----
  const prefs = () => new Promise((res) => { try { chrome.storage.sync.get('todo', (r) => res(r?.todo)); } catch { res(); } }).then((raw) => GZ_SANITIZE({ todo: raw }).todo);
  const todo = async (go) => {
    const x = X(), ultra = x.site === 'ultra';
    await libs(['lib/todo.js', 'GZ_TODO']);
    const L = GZ_TODO, [p, o] = await Promise.all([x.profile(), prefs()]);
    if (!L.ID.test(String(p?.id))) return no('profile');
    const key = L.storeKey(location.origin, String(p.id)), now = Date.now(), { start, end } = L.fetchRange(o, now, L.zone(p.time_zone));
    let cache, due;
    if (ultra) {
      await libs(['lib/ultra.js', 'GZ_ULTRA']);
      const r = await GZ_ULTRA.page.due(Date.parse(start), Date.parse(end));
      cache = { key, at: now, start, end, teach: o.teacher, progress: o.progress, items: r.items, complete: r.complete, grading: [], sums: {} };
    } else {
      const [raw, list] = await Promise.all([pages(`/api/v1/planner/items?start_date=${start}&end_date=${end}&per_page=100`, go, 10), x.canvasCourses()]);
      // A teacher's list also wants the grading: teach null, so the list asks for that alone (features/todo.js load).
      const teaches = list.some((c) => (c.enrollments || []).some((e) => /^(teacher|ta)/i.test(e.type || '')));
      cache = { key, at: now, start, end, teach: o.teacher && teaches ? null : o.teacher, progress: o.progress, items: raw.map(L.slim), grading: [], sums: {} };
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
    if (!(ultra ? BB : ID).test(uid)) return no('profile');
    const key = I.storeKey(location.origin, uid), rec = I.clean((await get(key))?.[key]);
    if (!rec?.courses.length) return no('none');
    if (!term.courses.length) return no('term');
    const at = Date.now();
    const one = async (c) => {
      if (ultra) {
        const r = GZ_ULTRA.read({ origin: location.origin, live: go });
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

  const OPS = { todo, insights };
  const run = async (op, args) => {
    const x = X(), a = args && typeof args === 'object' ? args : {};
    if (!x?.on() || !Object.hasOwn(OPS, op)) return no('here');
    const end = Date.now() + Math.min(Number.isFinite(a.ms) && a.ms > 0 ? a.ms : LIMIT.ms, LIMIT.ms);
    const go = () => Date.now() < end && X() === x && x.on();
    try { return await OPS[op](go, a); } catch { return no(go() ? 'failed' : 'late'); }
  };
  return { LIMIT, run };
})();
GZ_MCP_TAB;
