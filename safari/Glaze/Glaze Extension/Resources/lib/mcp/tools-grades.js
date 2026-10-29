// The grades group's tools for agent apps (lib/mcp/*.js): an account's latest grade in each course, and one course's grade
// over the term and its work, from Insights' record for that account (storage.local insights:<origin>/<uid>,
// lib/insights.js), which Glaze keeps once the student opens Insights. grades_list is lib/modbroker.js's grades, so an app
// gets the shape a mod gets. Accounts, run, ctx and what they answer as lib/mcp/tools-study.js's. A course whose teacher
// shows letter grades only (Canvas's restrict_quantitative_data) has no percentage or points here, as Insights shows none.
// Classic script for the worker, after lib/mcp/tools-study.js; module.exports for node.
var GZ_MCP_GRADES = globalThis.GZ_MCP_GRADES || (() => {
  const B = () => (typeof GZ_MODBROKER !== 'undefined' ? GZ_MODBROKER : require('../modbroker.js'));
  const ST = () => (typeof GZ_MCP_STUDY !== 'undefined' ? GZ_MCP_STUDY : require('./tools-study.js'));
  const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
  const arr = (v) => (Array.isArray(v) ? v : []);
  const when = (v) => (Number.isFinite(v) && v > 0 && v < 1e14 ? v : 0);
  const fail = (error) => ({ ok: false, error });
  // Insights' word for where a piece of work stands ('' is past due with nothing handed in that the LMS doesn't call
  // missing, or, on Ultra, not known).
  const STATUS = { on: 'on-time', late: 'late', missing: 'missing', excused: 'excused', open: 'open', '': 'unknown' };
  // The account's record, read once, and the broker's env over that read; null while none is kept (or it was cleared).
  const record = async (who, ctx) => {
    const key = `insights:${who.account}`, got = await ctx.local.get(key), rec = got[key];
    return isObj(rec) && Array.isArray(rec.courses) && when(rec.at) ? { rec, env: ST().env(who, got) } : null;
  };

  const tools = () => [
    {
      name: 'grades_list', kind: 'read', group: 'grades', scope: 'account', title: 'Grades',
      description: "List an account's latest grade in each course, from Glaze's Insights: courseId, name, percent, and at (when the graded work behind it was due or graded, ms since 1970). Courses with no grade yet, or letter grades only, are left out.",
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      run: async (args, ctx) => {
        const who = ST().parse(ctx?.account);
        if (!who) return fail('Unknown account.');
        const r = await record(who, ctx);
        return r ? { account: who.account, at: r.rec.at, items: await B().CALLS.grades.run([], r.env) } : ST().none(who, 'grades');
      },
    },
    {
      name: 'course_grades', kind: 'read', group: 'grades', scope: 'account', title: 'Course grades',
      description: "One course's grade over the term and its work, from Glaze's Insights. course: courseId, name, percent and at as grades_list gives them, lettersOnly (the teacher shows letter grades only, so there are no figures), complete (false when Insights read only part of the course). trend: the grade after each day's graded work, [{ at, percent, period }]; with grading periods each period starts afresh. items: type, id, title, due, points (possible), handedIn (ms since 1970, or null), status: on-time, late, missing, excused, open or unknown.",
      parameters: { type: 'object', properties: { course: { type: 'string', minLength: 1, maxLength: ST().LIMIT.course, description: "The course's id (grades_list or courses_list)." } }, required: ['course'], additionalProperties: false },
      run: async (args, ctx) => {
        const who = ST().parse(ctx?.account);
        if (!who) return fail('Unknown account.');
        const r = await record(who, ctx);
        if (!r) return ST().none(who, 'grades');
        const id = isObj(args) && typeof args.course === 'string' ? args.course : '';
        const c = id && r.rec.courses.find((x) => isObj(x) && String(x.id) === id);
        if (!c) return fail("Insights keeps no course by that id for this account; grades_list names the courses it graded.");
        const q = c.q === true;
        const [g] = q ? [] : await B().CALLS.grades.run([id], r.env);
        return {
          account: who.account, at: r.rec.at,
          course: { courseId: id, name: g?.name ?? (typeof c.name === 'string' ? c.name.slice(0, 200) : ''), percent: g?.percent ?? null, at: g?.at ?? null, lettersOnly: q, complete: c.more !== true && !(c.cut > 0) },
          trend: q ? [] : arr(c.trend).filter((p) => Array.isArray(p) && when(p[0]) && Number.isFinite(p[1])).map(([at, percent, period]) => ({ at, percent, period: typeof period === 'string' && period ? period : null })),
          items: arr(c.items).filter((i) => isObj(i) && typeof i.k === 'string' && i.k.includes(':')).slice(0, B().LIMIT.items).map((i) => ({
            type: i.k.slice(0, i.k.indexOf(':')), id: i.k.slice(i.k.indexOf(':') + 1), title: typeof i.n === 'string' ? i.n.slice(0, 300) : '', due: when(i.d) || null,
            points: q || !Number.isFinite(i.p) ? null : i.p, handedIn: when(i.a) || null, status: typeof i.s === 'string' && Object.hasOwn(STATUS, i.s) ? STATUS[i.s] : 'unknown',
          })),
        };
      },
    },
  ];
  // Adds them to a lib/ai/tools.js registry (its define checks each) → the tools as added.
  const register = (registry) => tools().map((t) => registry.add(t));
  return { tools, register };
})();
if (typeof module !== 'undefined') module.exports = GZ_MCP_GRADES; else GZ_MCP_GRADES;
