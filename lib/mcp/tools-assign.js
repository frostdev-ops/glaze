// The assignments group's tools for agent apps (lib/mcp/*.js): an account's assignments, quizzes and graded discussions from
// its planner as Glaze last read it (storage.local todoCache, which the call core refreshes through an open tab first), and
// one assignment read in the account's own tab (lib/mcp/tab.js assignment, through lib/mcp/tabs.js run): title, due date,
// points, instructions, the names of the files they attach, and the rubric's definition (lib/writer-context-assignment.js
// rubricOf over lib/rubric.js's model), never the student's scores or feedback, which are the grades group's. Each read is
// kept, fitted to what an answer carries, in storage.local mcpRubric:<origin>/<uid>/<course>/<assignment> with its time; the
// 100 used last stay (mcpRubrics: their keys, the latest first). With no tab open, the kept read answers, dated.
// Accounts, run and ctx as lib/mcp/tools-study.js's; register(registry, { tabs (lib/mcp/tabs.js create's) }).
// Classic script for the worker, after lib/mcp/tools-study.js and lib/mcp/tabs.js; module.exports for node.
var GZ_MCP_ASSIGN = globalThis.GZ_MCP_ASSIGN || (() => {
  const B = () => (typeof GZ_MODBROKER !== 'undefined' ? GZ_MODBROKER : require('../modbroker.js'));
  const ST = () => (typeof GZ_MCP_STUDY !== 'undefined' ? GZ_MCP_STUDY : require('./tools-study.js'));
  // keep: reads kept; answer: the characters a read may take in an answer (lib/ai/loop.js LIMIT.output less the call core's
  // own fields); files: names listed; text: one text's characters before fitting.
  const LIMIT = { keep: 100, answer: 10500, files: 20, text: 200000, id: 40 };
  const PREFIX = 'mcpRubric:', INDEX = 'mcpRubrics';
  const ID = { canvas: /^\d{1,20}$/, ultra: /^_\d{1,20}_\d{1,20}$/ };
  const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
  const arr = (v) => (Array.isArray(v) ? v : []);
  const when = (v) => (Number.isFinite(v) && v > 0 && v < 1e14 ? v : 0);
  const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
  const fail = (error) => ({ ok: false, error });
  const clock = (ctx) => (typeof ctx.now === 'function' ? ctx.now() : Date.now());
  const cut = (s, n) => { const t = s.slice(0, n); return /[\ud800-\udbff]$/.test(t) ? t.slice(0, -1) : t; };

  // A planner item that is graded work, with the id assignment_read takes: Canvas's assignment (a quiz's or a graded
  // discussion's is its assignment's), Ultra's content item (lib/ultra.js due: its column's content).
  const TYPES = ['assignment', 'quiz', 'discussion_topic', 'sub_assignment'];
  const link = (u, origin) => {
    if (typeof u !== 'string' || !u) return '';
    if (u.startsWith('/') && !u.startsWith('//')) return origin + u.slice(0, 2000);
    try { const x = new URL(u); return x.origin === origin ? x.href.slice(0, 2000) : ''; } catch { return ''; }
  };
  const work = (i, who) => {
    if (!isObj(i) || !TYPES.includes(i.type)) return null;
    const id = who.lms === 'ultra' ? i.content : i.type === 'assignment' ? i.id : i.aid;
    if (typeof id !== 'string' || !ID[who.lms].test(id) || typeof i.cid !== 'string' || !ID[who.lms].test(i.cid)) return null;
    const s = isObj(i.sub) ? i.sub : {};
    return { assignment: id, type: i.type, courseId: i.cid, course: str(i.course, 120), title: str(i.title, 300), due: when(i.at) || null, url: link(i.url, who.origin),
      submitted: !!s.submitted, graded: !!s.graded, late: !!s.late, missing: !!s.missing };
  };

  // ---- a read, fitted and kept ----
  // What the tab answered, as data of the right kinds: the rubric is rubricOf's shape.
  const clean = (r) => ({
    title: str(r.title, 300), due: when(r.due) || null, points: Number.isFinite(r.points) && r.points >= 0 ? r.points : null,
    instructions: str(r.instructions, LIMIT.text), description: str(r.description, LIMIT.text),
    files: [...new Set(arr(r.files).filter((f) => typeof f === 'string' && f))].slice(0, LIMIT.files).map((f) => f.slice(0, 200)),
    rubric: isObj(r.rubric) && Array.isArray(r.rubric.criteria) ? r.rubric : null, ...(r.incomplete === true && { incomplete: true }),
  });
  // Longer than an answer carries: the texts cut, the instructions last, until it fits (cut: true); at the end the levels'
  // own texts go. A read still too long is left to the call core's receipt.
  const fit = (rec) => {
    for (const n of [Infinity, 6000, 3000, 1500, 800, 400, 200, 100]) {
      let cutAny = false;
      const c = (s, m) => { if (typeof s !== 'string' || s.length <= m) return s; cutAny = true; return `${cut(s, m)}…`; };
      const r = rec.rubric;
      const out = { ...rec, instructions: c(rec.instructions, n), description: c(rec.description, n / 2),
        rubric: r && { ...r, ...(r.detail !== undefined && { detail: c(r.detail, n / 4) }), criteria: r.criteria.map((k) => ({ ...k, detail: c(k.detail, n / 4),
          cells: arr(k.cells).map((x) => ({ ...x, detail: c(x.detail, n / 8) })) })) } };
      if (cutAny) out.cut = true;
      if (JSON.stringify(out).length <= LIMIT.answer) return out;
      if (n === 100 && r) {
        const bare = { ...out, cut: true, rubric: { ...out.rubric, criteria: out.rubric.criteria.map((k) => ({ ...k, cells: k.cells.map(({ detail: _d, ...x }) => x) })) } };
        if (JSON.stringify(bare).length <= LIMIT.answer) return bare;
      }
    }
    return rec;
  };
  const keys = async (ctx) => { const k = typeof ctx.keys === 'function' ? await ctx.keys() : Object.keys(await ctx.local.get(null)); return Array.isArray(k) ? k : []; };
  // The index's writes, one at a time.
  let turn = Promise.resolve();
  const serial = (f) => (turn = turn.then(f, f));
  // Kept (rec) or used again (none), the latest first; past LIMIT.keep, the ones used longest ago go, and any kept read the
  // index lost is the first to go.
  const remember = (ctx, key, rec) => serial(async () => {
    try {
      const was = arr((await ctx.local.get(INDEX))[INDEX]).filter((k) => typeof k === 'string' && k.startsWith(PREFIX) && k !== key);
      const stray = (await keys(ctx)).filter((k) => k.startsWith(PREFIX) && k !== key && !was.includes(k));
      const order = [key, ...was, ...stray], gone = order.slice(LIMIT.keep);
      await ctx.local.set({ ...(rec && { [key]: rec }), [INDEX]: order.slice(0, LIMIT.keep) });
      if (gone.length) await ctx.local.remove(gone);
    } catch { /* a cache that can't be kept leaves the answer as it is */ }
  });

  const tools = (deps) => [
    {
      name: 'assignments_list', kind: 'read', group: 'assignments', scope: 'account', title: 'Assignments',
      description: "List an account's assignments, quizzes and graded discussions on its planner as Glaze last read it: assignment (the id assignment_read takes), type, courseId, course, title, due (ms since 1970, or null), url, and whether it is submitted, graded, late or missing. covers is the span Glaze read; nothing outside it is known. Optionally one course's.",
      parameters: { type: 'object', properties: { course: { type: 'string', minLength: 1, maxLength: LIMIT.id, description: "Only this course's assignments, by its id (courses_list)." } }, additionalProperties: false },
      run: async (args, ctx) => {
        const who = ST().parse(ctx?.account);
        if (!who) return fail('Unknown account.');
        const c = (await ctx.local.get('todoCache')).todoCache;
        if (!isObj(c) || c.key !== `todo:${who.account}` || !Array.isArray(c.items)) return ST().none(who, 'assignments');
        const id = isObj(args) && typeof args.course === 'string' ? args.course : '';
        const items = c.items.map((i) => work(i, who)).filter((i) => i && (!id || i.courseId === id)).slice(0, B().LIMIT.items);
        return { account: who.account, at: when(c.at) || null, covers: { from: Date.parse(c.start) || null, to: Date.parse(c.end) || null, complete: c.complete !== false }, items };
      },
    },
    {
      name: 'assignment_read', kind: 'read', group: 'assignments', scope: 'account', needs: 'tab', title: 'Read an assignment',
      description: "Read one assignment as its school's site has it now, through the account's tab open in this browser: title, due (ms since 1970, or null), points (null where the teacher shows none), instructions and description as text, files (the names of files the instructions attach), and rubric (null when it has none): title, total, kind, levels, and criteria, each with its points and every level's text and points. Never the student's scores or feedback. With no tab open, Glaze's last read of it, dated. cut: texts were shortened to fit; incomplete: the site's text was longer than Glaze reads. course and assignment as assignments_list gives them.",
      parameters: { type: 'object', properties: {
        course: { type: 'string', minLength: 1, maxLength: LIMIT.id, description: "The course's id (courseId in assignments_list)." },
        assignment: { type: 'string', minLength: 1, maxLength: LIMIT.id, description: "The assignment's id (assignment in assignments_list)." },
      }, required: ['course', 'assignment'], additionalProperties: false },
      run: async (args, ctx) => {
        const who = ST().parse(ctx?.account);
        if (!who) return fail('Unknown account.');
        const course = isObj(args) ? args.course : '', item = isObj(args) ? args.assignment : '';
        if (!ID[who.lms].test(course) || !ID[who.lms].test(item)) return fail('course and assignment are ids from assignments_list.');
        const key = `${PREFIX}${who.account}/${course}/${item}`, head = { account: who.account, course, assignment: item };
        const r = deps?.tabs ? await deps.tabs.run(who.account, 'assignment', { course, assignment: item }, { signal: ctx.signal }) : null;
        if (r?.ok === true) {
          const at = clock(ctx), rec = fit(clean(r));
          await remember(ctx, key, { at, ...rec });
          return { ...head, source: 'tab', at, ...rec };
        }
        if (r?.error === 'none') return fail(`${new URL(who.origin).host} has no such assignment for this account; assignments_list names them.`);
        const kept = (await ctx.local.get(key))[key];
        if (isObj(kept) && when(kept.at)) {
          await remember(ctx, key, null);
          const { at, ...rest } = kept;
          return { ...head, source: 'cache', at, ...clean(rest), ...(rest.cut === true && { cut: true }) };
        }
        const host = new URL(who.origin).host;
        return fail(r === null ? `Open ${host} in this browser, signed in as this account, so Glaze can read this assignment there.` : `Glaze couldn't read this assignment from ${host} just now; try again in a moment.`);
      },
    },
  ];
  // Adds them to a lib/ai/tools.js registry (its define checks each) → the tools as added.
  const register = (registry, deps) => tools(deps).map((t) => registry.add(t));
  return { LIMIT, PREFIX, INDEX, tools, register };
})();
if (typeof module !== 'undefined') module.exports = GZ_MCP_ASSIGN; else GZ_MCP_ASSIGN;
