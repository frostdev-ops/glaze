// The courses group's tools for agent apps (lib/mcp/*.js): the school accounts Glaze holds data for and, for one of them, its
// courses, to-do list and schedule, read from Glaze's own caches with lib/modbroker.js's runners, so an app gets the slim
// shapes a mod gets. Nothing here asks the LMS: the call core refreshes through an open tab first, and adds the note,
// source and age.
// An account is '<origin>/<uid>' (Canvas's user id, or Ultra's _N_N), as lib/todo.js and lib/insights.js key theirs.
// run(args, ctx): ctx { account (the resolved account; accounts_list takes none), local (storage.local's { get }), keys?()
// (storage.local's keys; else one get(null)), now?() }. → { account, at (the cache's own time in ms, or null where it keeps
// none), items } (todo_list and schedule_list add covers: the span the planner was read for, and whether it was read whole);
// with nothing kept for that account, { account, at: null, items: [], missing: what to open in the LMS }; and for an
// account or arguments Glaze can't use, { ok: false, error }.
// The planner cache (storage.local todoCache) is one account's at a time. seenCourses keeps one list a school, which every
// account signed in there adds to without its identity. Only this account's planner and Insights prove course membership.
// Classic script for the worker, after lib/ai/tools.js and lib/modbroker.js; module.exports for node.
var GZ_MCP_STUDY = globalThis.GZ_MCP_STUDY || (() => {
  const B = () => (typeof GZ_MODBROKER !== 'undefined' ? GZ_MODBROKER : require('../modbroker.js'));
  const DAY = 864e5;
  // days: the most a to-do list looks ahead and a schedule spans (lib/modbroker.js schedule's); course: an id's characters.
  const LIMIT = { days: 60, course: 40 };
  const UID = /^(\d{1,20}|_\d{1,20}_\d{1,20})$/;
  const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
  const when = (v) => (Number.isFinite(v) && v > 0 && v < 1e14 ? v : 0);
  const fail = (error) => ({ ok: false, error });
  const clock = (ctx) => (typeof ctx.now === 'function' ? ctx.now() : Date.now());

  // '<origin>/<uid>' → { account, origin, uid, lms: 'canvas' | 'ultra' }, or null unless it is exactly one.
  const parse = (a) => {
    if (typeof a !== 'string' || a.length > 300) return null;
    const i = a.lastIndexOf('/'), origin = a.slice(0, i), uid = a.slice(i + 1);
    let u;
    try { u = new URL(origin); } catch { return null; }
    return /^https?:$/.test(u.protocol) && u.origin === origin && UID.test(uid) ? { account: a, origin, uid, lms: uid[0] === '_' ? 'ultra' : 'canvas' } : null;
  };
  // Storage read once, as an area for the broker's runners, so their answer and `at` are of the same moment; and the
  // broker's env for this account's page (its account() is this account's id, so nothing falls back to the newest).
  const view = (got) => ({ get: async (k) => Object.fromEntries([].concat(k).filter((x) => Object.hasOwn(got, x)).map((x) => [x, got[x]])) });
  const env = (who, got) => ({ site: who.origin, account: async () => who.uid, local: view(got) });
  const keys = async (ctx) => { const k = typeof ctx.keys === 'function' ? await ctx.keys() : Object.keys(await ctx.local.get(null)); return Array.isArray(k) ? k : []; };
  // What the student opens for Glaze to read it: Canvas's Dashboard, Ultra's Courses page (where Insights' button is too).
  const page = (who) => (who.lms === 'ultra' ? 'the Courses page' : 'the Dashboard');
  const none = (who, what) => ({ account: who.account, at: null, items: [], missing: what === 'grades'
    ? `Turn on Insights in Glaze's settings, then open it from ${page(who)} at ${who.origin}, signed in as this account.`
    : `Open ${page(who)} at ${who.origin}, signed in as this account, so Glaze reads its ${what}.` });
  // The planner cache, when it is this account's.
  const plan = (who, got) => { const c = got.todoCache; return isObj(c) && c.key === `todo:${who.account}` && Array.isArray(c.items) ? c : null; };
  const covers = (c) => ({ from: Date.parse(c.start) || null, to: Date.parse(c.end) || null, complete: c.complete !== false });
  // An ISO 8601 date or date-time → ms, or null. A date alone, or a time with no zone, is on the student's own clock (this
  // browser's): a date is its first millisecond, or with end its last.
  const ISO = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|([+-])(\d{2}):(\d{2}))?)?$/;
  const instant = (v, end) => {
    const m = typeof v === 'string' ? ISO.exec(v) : null;
    if (!m) return null;
    const [y, mo, d, h, mi, s] = m.slice(1, 7).map((x) => Number(x || 0)), ms = Number((m[7] || '').padEnd(3, '0'));
    const t = new Date(Date.UTC(y, mo - 1, d, h, mi, s, ms));
    if (y < 1970 || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d || t.getUTCHours() !== h || t.getUTCMinutes() !== mi || t.getUTCSeconds() !== s) return null;
    if (m[8] && m[8] !== 'Z' && (+m[10] > 23 || +m[11] > 59)) return null;
    const at = m[8] === 'Z' ? t.getTime() : m[8] ? t.getTime() - (m[9] === '-' ? -1 : 1) * (m[10] * 60 + +m[11]) * 6e4
      : m[4] === undefined ? new Date(y, mo - 1, d + (end ? 1 : 0)).getTime() - (end ? 1 : 0) : new Date(y, mo - 1, d, h, mi, s, ms).getTime();
    return at >= 0 ? at : null;
  };
  const course = { type: 'string', minLength: 1, maxLength: LIMIT.course, description: "Only this course's items, by its id (courses_list)." };
  const day = (which) => ({ type: 'string', pattern: ISO.source, description: `The ${which} day (2026-10-29: the student's own day) or moment (2026-10-29T17:00:00Z), ISO 8601.` });
  const ITEM = 'id, type, courseId, course, title, due (ms since 1970, or null), url, and whether it is done, submitted, graded, late or missing';
  const tools = () => [
    {
      name: 'accounts_list', kind: 'read', group: 'courses', title: 'School accounts',
      description: "List the school accounts Glaze holds data for in this browser, the one it read last first: account (what the other tools take as account), lms ('canvas', or 'ultra' for Blackboard Ultra), origin (the school's site) and seen (when Glaze last read it, ms since 1970).",
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      run: async (args, ctx) => {
        const all = await keys(ctx);
        const records = all.filter((k) => k.startsWith('insights:') && parse(k.slice(9)));
        const got = await ctx.local.get(['todoCache', ...records]);
        const seen = new Map();
        const add = (a, at) => { if (parse(a) && at) seen.set(a, Math.max(seen.get(a) || 0, at)); };
        const c = got.todoCache;
        if (isObj(c) && typeof c.key === 'string' && c.key.startsWith('todo:') && Array.isArray(c.items)) add(c.key.slice(5), when(c.at));
        // A cleared record ({ cl }) keeps nothing.
        for (const k of records) if (isObj(got[k]) && Array.isArray(got[k].courses)) add(k.slice(9), when(got[k].at));
        const items = [...seen].sort(([a, x], [b, y]) => y - x || (a < b ? -1 : 1)).map(([account, at]) => { const w = parse(account); return { account, lms: w.lms, origin: w.origin, seen: at }; });
        return items.length ? { account: null, at: items[0].seen, items }
          : { account: null, at: null, items: [], missing: "Open your school's site in this browser, signed in, so Glaze reads your courses and to-do list." };
      },
    },
    {
      name: 'courses_list', kind: 'read', group: 'courses', scope: 'account', title: 'Courses',
      description: "List courses named in an account's cached planner or Insights: id, name, code, color (null while Glaze's school-wide course cache cannot identify whose colour it is). Other courses may be missing until their account is recorded with them.",
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      run: async (args, ctx) => {
        const who = parse(ctx?.account);
        if (!who) return fail('Unknown account.');
        const own = `insights:${who.account}`;
        const got = await ctx.local.get(['seenCourses', 'todoCache', own]);
        const school = await B().CALLS.courses.run([], env(who, got));
        // Even with one known account, another may have left only school-wide courses. Their presence proves nothing
        // about this account. A code is the course's own; names and colours may be another account's choices.
        const rec = isObj(got[own]) && Array.isArray(got[own].courses) ? got[own] : null, c = plan(who, got);
        const names = new Map();
        for (const x of rec ? rec.courses : []) if (isObj(x) && UID.test(x.id) && !names.has(x.id)) names.set(x.id, typeof x.name === 'string' ? x.name.slice(0, 200) : '');
        for (const i of c ? c.items : []) if (isObj(i) && UID.test(i.cid) && !names.has(i.cid)) names.set(i.cid, typeof i.course === 'string' ? i.course.slice(0, 200) : '');
        const code = new Map(school.map((x) => [x.id, x.code]));
        const items = [...names].slice(0, B().LIMIT.items).map(([id, name]) => ({ id, name, code: code.get(id) ?? '', color: null }));
        return items.length ? { account: who.account, at: Math.max(when(rec?.at), when(c?.at)) || null, items } : none(who, 'courses');
      },
    },
    {
      name: 'todo_list', kind: 'read', group: 'courses', scope: 'account', title: 'To-do list',
      description: `List an account's to-do items as Glaze last read its planner: ${ITEM}. covers is the span Glaze read (ms since 1970); nothing outside it is known. Optionally one course's, or only what is due within the next days.`,
      parameters: { type: 'object', properties: { course, days: { type: 'integer', minimum: 1, maximum: LIMIT.days, description: 'Only items due within this many days from now.' } }, additionalProperties: false },
      run: async (args, ctx) => {
        const who = parse(ctx?.account);
        if (!who) return fail('Unknown account.');
        const got = await ctx.local.get('todoCache'), c = plan(who, got);
        if (!c) return none(who, 'to-do list');
        const now = clock(ctx), { course: id, days } = isObj(args) ? args : {};
        const items = (await B().CALLS.todo.run([], env(who, got)))
          .filter((i) => (!id || i.courseId === id) && (!days || (i.due !== null && i.due >= now && i.due <= now + days * DAY)));
        return { account: who.account, at: when(c.at) || null, covers: covers(c), items };
      },
    },
    {
      name: 'schedule_list', kind: 'read', group: 'courses', scope: 'account', title: 'Schedule',
      description: `List an account's to-do items due from one date to another, at most ${LIMIT.days} days apart, as Glaze last read its planner: ${ITEM}. covers is the span Glaze read; nothing outside it is known.`,
      parameters: { type: 'object', properties: { from: day('first'), to: day('last') }, required: ['from', 'to'], additionalProperties: false },
      run: async (args, ctx) => {
        const who = parse(ctx?.account);
        if (!who) return fail('Unknown account.');
        const from = instant(args?.from, false), to = instant(args?.to, true);
        if (from === null || to === null) return fail('from and to are ISO 8601 dates (2026-10-29) or date-times (2026-10-29T17:00:00Z).');
        if (to < from || to - from > LIMIT.days * DAY) return fail(`to is after from, and at most ${LIMIT.days} days after it.`);
        const got = await ctx.local.get('todoCache'), c = plan(who, got);
        if (!c) return none(who, 'to-do list');
        return { account: who.account, at: when(c.at) || null, covers: covers(c), items: await B().CALLS.schedule.run([from, to], env(who, got)) };
      },
    },
  ];
  // Adds them to a lib/ai/tools.js registry (its define checks each) → the tools as added.
  const register = (registry) => tools().map((t) => registry.add(t));
  return { LIMIT, parse, env, none, tools, register };
})();
if (typeof module !== 'undefined') module.exports = GZ_MCP_STUDY; else GZ_MCP_STUDY;
