// The courses group's tools for agent apps (lib/mcp/*.js): the school accounts Glaze holds data for and, for one of them, its
// courses, to-do list and schedule, read from Glaze's own caches with lib/modbroker.js's runners, so an app gets the slim
// shapes a mod gets, and marking a to-do done. Nothing here reads the LMS: the call core refreshes through an open tab first,
// and adds the note, source and age. An item's done is the LMS's own (Canvas's planner mark); marked is Glaze's own mark on
// this device, which Glaze's list uses unless Canvas sync is on (then the list follows Canvas's, and marked is null).
// todo_mark_done marks the way Glaze's list does (features/todo.js mark, lib/todo.js change): with Canvas sync on, Canvas's
// planner through the account's tab (lib/mcp/tab.js mark, with the page's CSRF token), else Glaze's own mark.
// An account is '<origin>/<uid>' (Canvas's user id, or Ultra's _N_N), as lib/todo.js and lib/insights.js key theirs.
// run(args, ctx): ctx { account (the resolved account; accounts_list takes none), local (storage.local's { get }), keys?()
// (storage.local's keys; else one get(null)), now?() }. → { account, at (the cache's own time in ms, or null where it keeps
// none), items } (todo_list and schedule_list add covers: the span the planner was read for, and whether it was read whole);
// with nothing kept for that account, { account, at: null, items: [], missing: what to open in the LMS }; and for an
// account or arguments Glaze can't use, { ok: false, error }.
// register(registry, deps?): deps { sync (storage.sync: the list's settings), tabs (lib/mcp/tabs.js create's) }; todo_mark_done
// is added only with them.
// The planner cache (storage.local todoCache) is one account's at a time. seenCourses keeps one list a school, which every
// account signed in there adds to without its identity. Only this account's planner and Insights prove course membership.
// Classic script for the worker, after lib/ai/tools.js and lib/modbroker.js; module.exports for node.
var GZ_MCP_STUDY = globalThis.GZ_MCP_STUDY || (() => {
  const B = () => (typeof GZ_MODBROKER !== 'undefined' ? GZ_MODBROKER : require('../modbroker.js'));
  const T = () => (typeof GZ_TODO !== 'undefined' ? GZ_TODO : require('../todo.js'));
  const Z = () => (typeof GZ_SANITIZE !== 'undefined' ? GZ_SANITIZE : require('../../defaults.js').GZ_SANITIZE);
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
  // The to-do list's settings (storage.sync todo, cleaned as the list cleans them; lib/todo.js adds their spec), and whether a
  // mark goes to the site: only Canvas has a planner for it, with sync on (features/todo.js toSite).
  const prefs = async (deps) => {
    let raw;
    try { raw = (await deps?.sync?.get('todo'))?.todo; } catch { /* the defaults */ }
    T();
    return Z()({ todo: raw }).todo;
  };
  const toSite = (who, o) => who.lms === 'canvas' && o.sync === true;
  // Glaze's own marks on an account's planner items (storage.local todo:<origin>/<uid>), by '<type>:<id>'; null while the list
  // doesn't use them.
  const marks = async (who, ctx, o) => {
    if (toSite(who, o)) return null;
    const k = T().storeKey(who.origin, who.uid), d = T().clean((await ctx.local.get(k))[k]);
    return new Map(Object.entries(d.items).filter(([, v]) => typeof v.done === 'boolean').map(([key, v]) => [key, v.done]));
  };
  // Glaze's own mark beside each item, and complete: done as Glaze's list shows it (lib/todo.js isDone over the cached item).
  const marked = (items, m, c, o) => {
    const raw = new Map(c.items.filter(isObj).map((i) => [`${i.type}:${i.id}`, i]));
    return items.map((i) => {
      const key = `${i.type}:${i.id}`, own = m?.get(key), r = raw.get(key);
      return { ...i, marked: own ?? null, complete: r ? T().isDone(r, o.done, own) : i.done === true };
    });
  };
  const course = { type: 'string', minLength: 1, maxLength: LIMIT.course, description: "Only this course's items, by its id (courses_list)." };
  const day = (which) => ({ type: 'string', pattern: ISO.source, description: `The ${which} day (2026-10-29: the student's own day) or moment (2026-10-29T17:00:00Z), ISO 8601.` });
  const ITEM = "id, type, courseId, course, title, due (ms since 1970, or null), url, whether it is done (the LMS's own mark), submitted, graded, late or missing, marked (Glaze's own mark on this device: true done, false not done, null none), and complete (whether Glaze's to-do list shows it done: by marked, else by the LMS's mark, else by a submission, excuse or grade not awaiting a resubmission, unless the student marks items by hand)";
  const NOTHING = 'Nothing was done.';
  const DATE = { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' };
  // The planner item a mark is for, as Glaze last read it, and what marking it does. → { who, item, o, site, store, key, say }
  // or { error }.
  const marking = async (args, ctx, deps) => {
    const who = parse(ctx?.account);
    if (!who) return { error: 'Unknown account.' };
    const got = await ctx.local.get('todoCache'), c = plan(who, got);
    if (!c) return { error: `${none(who, 'to-do list').missing} ${NOTHING}` };
    const key = `${args?.type}:${args?.id}`, item = c.items.find((i) => isObj(i) && `${i.type}:${i.id}` === key);
    if (!item) return { error: `That item is not on this account's to-do list as Glaze last read it; todo_list names them. ${NOTHING}` };
    const o = await prefs(deps), site = toSite(who, o), store = T().storeKey(who.origin, who.uid);
    const own = site ? undefined : (await marks(who, ctx, o)).get(key);
    const title = typeof item.title === 'string' && item.title ? item.title.slice(0, 200) : 'Untitled';
    if (T().isDone(item, o.done, own)) return { error: `“${title}” is already done in Glaze's to-do list. ${NOTHING}` };
    const at = when(item.at), date = at && (item.allDay ? new Date(at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : new Date(at).toLocaleString('en-US', DATE));
    const about = [typeof item.course === 'string' ? item.course.slice(0, 120) : '', date ? `due ${date}` : ''].filter(Boolean).join(', ');
    return { who, item, o, site, store, key, title, say: `Mark “${title}”${about ? ` (${about})` : ''} as done in Glaze's to-do list${site ? " and in Canvas's planner" : ''}.` };
  };
  const host = (who) => new URL(who.origin).host;
  const noTab = (who) => `Open ${host(who)} in this browser, signed in as this account, to sync it. ${NOTHING}`;
  // storage.local as lib/todo.js change writes it: set says whether it worked.
  const area = (local) => ({ local: { get: (k) => local.get(k), set: (v) => Promise.resolve(local.set(v)).then(() => true, () => false) } });
  const approved = new WeakMap();
  const fingerprint = (m) => JSON.stringify([m.who.account, m.key, m.say, m.site, m.item.aid || '', m.item.ov?.id || '']);
  const tools = (deps) => [
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
        const o = await prefs(deps);
        return { account: who.account, at: when(c.at) || null, covers: covers(c), items: marked(items, await marks(who, ctx, o), c, o) };
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
        const o = await prefs(deps);
        return { account: who.account, at: when(c.at) || null, covers: covers(c), items: marked(await B().CALLS.schedule.run([from, to], env(who, got)), await marks(who, ctx, o), c, o) };
      },
    },
    ...(deps?.tabs && deps?.sync ? [{
      name: 'todo_mark_done', kind: 'write', group: 'courses', scope: 'account', title: 'Mark a to-do done', hints: { idempotent: true },
      description: "Mark one of an account's to-do items done, by its type and id as todo_list gives them, once the student allows it in Glaze. With Canvas sync on in Glaze's settings, the mark goes to Canvas's planner through the account's Canvas tab open in this browser, and todo_list's done shows it; otherwise it is Glaze's own mark on this device, and todo_list's marked shows it.",
      parameters: { type: 'object', properties: {
        type: { type: 'string', pattern: '^[a-z_]{1,40}$', description: "The item's type (todo_list)." },
        id: { type: 'string', pattern: UID.source, description: "The item's id (todo_list)." },
      }, required: ['type', 'id'], additionalProperties: false },
      // Glaze's sentence for the approval window, from the cache alone; a mark that can't happen is said before anyone is asked.
      summarize: async (args, ctx) => {
        const m = await marking(args, ctx, deps);
        if (m.error) throw new Error(m.error);
        if (m.site && !(await deps.tabs.find(m.who.account))) throw new Error(noTab(m.who));
        approved.set(ctx, fingerprint(m));
        return m.say;
      },
      // In the broker's turn (lib/mcp/calls.js), with the same edit or the same planner write Glaze's list makes for a tick.
      run: async (args, ctx) => {
        const m = await marking(args, ctx, deps);
        if (m.error) return fail(m.error);
        if (approved.has(ctx) && approved.get(ctx) !== fingerprint(m)) return fail(`That item or its sync settings changed. Ask again to approve the current mark. ${NOTHING}`);
        const { who, item, key, store, title } = m, at = clock(ctx);
        if (!m.site) {
          // A mark that agrees with the LMS is no mark: the item follows the LMS again.
          const r = await T().change({ key: store, edits: [['done', key, T().isDone(item, m.o.done) ? null : true]] }, area(ctx.local));
          if (!r.ok) return fail(`Glaze couldn't save that on this device. ${NOTHING}`);
          return { account: who.account, at, item: { type: item.type, id: item.id, title, done: !!item.ov?.done, marked: r.data.items[key]?.done ?? null }, where: 'glaze' };
        }
        const r = await deps.tabs.run(who.account, 'mark', { type: item.type, id: item.id, aid: typeof item.aid === 'string' ? item.aid : '', ov: item.ov?.id || '' }, {});
        if (r === null) return fail(noTab(who));
        const ov = r.ok === true && isObj(r.ov) && r.ov.done === true && /^\d{1,20}$/.test(r.ov.id) ? { id: r.ov.id, done: true, dismissed: r.ov.dismissed === true } : null;
        if (!ov) return fail(r.error === 'timeout' || r.uncertain === true ? "Canvas didn't confirm the mark, so it may or may not be in its planner; todo_list shows it once Glaze reads the planner again."
          : `Canvas didn't confirm the mark. ${NOTHING}`);
        // The kept planner takes Canvas's override, as the list keeps it after a tick (features/todo.js mark).
        const c = plan(who, await ctx.local.get('todoCache')), it = c?.items.find((i) => isObj(i) && `${i.type}:${i.id}` === key);
        if (it) { it.ov = ov; await T().change({ key: store, cache: c }, area(ctx.local)); }
        return { account: who.account, at, item: { type: item.type, id: item.id, title, done: ov.done, marked: null }, where: 'canvas' };
      },
    }] : []),
  ];
  // Adds them to a lib/ai/tools.js registry (its define checks each) → the tools as added.
  const register = (registry, deps) => tools(deps).map((t) => registry.add(t));
  return { LIMIT, parse, env, none, tools, register };
})();
if (typeof module !== 'undefined') module.exports = GZ_MCP_STUDY; else GZ_MCP_STUDY;
