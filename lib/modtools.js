// Mod tools: mod.json's `tools`, which agent apps the student connects (Settings → Agents) may call on a mod's behalf. A
// tool is declarative, { name, title, description, from, select?, where?, sort?, limit?, input? }, answered by Glaze from
// what it keeps (lib/modbroker.js's todo, schedule, courses and grades answers) with none of the mod's code, or
// { name, title, description, code: true, input? }, answered by the mod's Worker. clean checks them as strictly as
// lib/modbundle.js checks the rest of mod.json; apply is the declarative runner; defs are what the tool registry lists.
// Classic script for the worker and the editor; module.exports for node.
var GZ_MODTOOLS = globalThis.GZ_MODTOOLS || (() => {
  // A code tool's input is in the AI harness's schema subset; only a code tool needs it.
  const S = () => (typeof GZ_AI_SCHEMA !== 'undefined' ? GZ_AI_SCHEMA : require('./ai/schema.js'));
  const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
  const own = (o, k) => Object.hasOwn(o, k);
  const DAY = 864e5;
  // Tools a mod, a title's and a description's characters, tests a tool, items an answer, the app's days, a test's days,
  // a text test's characters; the registry's title and description in UTF-16 units (lib/ai/tools.js).
  const LIMIT = { tools: 8, title: 60, description: 500, where: 8, items: 200, days: 60, span: 366, eq: 300, shownTitle: 120, shownDescription: 1024 };

  // As lib/modbundle.js refuses a manifest: the English with {field}, which the editor shows through t().
  const WHY = "That mod's mod.json has a value Glaze can't use ({field}).";
  const bad = (field) => { throw Object.assign(new Error(WHY.replace('{field}', field)), { why: WHY, vars: { field } }); };
  const keys = (o, allowed, field, req = []) => { if (!isObj(o) || Object.keys(o).some((k) => !allowed.includes(k)) || req.some((k) => !own(o, k))) bad(field); };
  // One line of text, as lib/modbundle.js's line().
  const line = (v, max) => typeof v === 'string' && v.length > 0 && v.length <= max * 2 && v === v.replace(/\s+/g, ' ').trim()
    && !/[\p{Cc}\p{Bidi_Control}]/u.test(v) && [...v].length <= max;

  // Each source's answer, field by field, as lib/modbroker.js's CALLS give it (test/modtools.test.js holds them to it):
  // text, a time (ms since 1970, or null), a flag, a number or null, a colour or null.
  const PLAN = { id: 'text', type: 'text', courseId: 'text', course: 'text', title: 'text', due: 'time', url: 'text', done: 'flag', submitted: 'flag', graded: 'flag', late: 'flag', missing: 'flag' };
  const FIELDS = { todo: PLAN, schedule: PLAN, courses: { id: 'text', name: 'text', code: 'text', color: 'color' }, grades: { courseId: 'text', name: 'text', percent: 'number', at: 'time' } };
  const SOURCES = Object.keys(FIELDS);
  // The permission each source reads with.
  const PERM = { todo: 'todo', schedule: 'todo', courses: 'courses', grades: 'grades' };
  // The app's days look at a source's date: ahead for what is due, back for when Glaze read a grade. Its course: an id.
  const WHEN = { todo: ['due', 1], schedule: ['due', 1], grades: ['at', -1] };
  const COURSE = { todo: 'courseId', schedule: 'courseId', courses: 'id', grades: 'courseId' };
  const EQ = {
    text: (v) => typeof v === 'string' && v.length <= LIMIT.eq, flag: (v) => typeof v === 'boolean',
    time: (v) => v === null || (Number.isSafeInteger(v) && v >= 0), number: (v) => v === null || Number.isFinite(v),
    color: (v) => v === null || (typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v)),
  };
  const KEYS = { data: ['name', 'title', 'description', 'from', 'select', 'where', 'sort', 'limit', 'input'], code: ['name', 'title', 'description', 'code', 'input'] };
  const NAME = /^[a-z][a-z0-9_]{0,23}$/;
  const isCode = (t) => isObj(t) && t.code === true;

  // tools: mod.json's `tools` as parsed; manifest: the rest of it, for the permissions and hooks the tools need. → tools,
  // unchanged, or a refusal naming the field.
  const clean = (tools, manifest = {}) => {
    if (!Array.isArray(tools) || tools.length > LIMIT.tools) bad('tools');
    const declared = (Array.isArray(manifest?.permissions) ? manifest.permissions : []).filter(isObj).map((p) => p.id);
    const names = new Set();
    tools.forEach((t, i) => {
      const f = `tools.${i}`, code = isObj(t) && own(t, 'code');
      keys(t, code ? KEYS.code : KEYS.data, f, code ? ['name', 'title', 'description', 'code'] : ['name', 'title', 'description', 'from']);
      if (typeof t.name !== 'string' || !NAME.test(t.name) || names.has(t.name)) bad(`${f}.name`);
      names.add(t.name);
      if (!line(t.title, LIMIT.title)) bad(`${f}.title`);
      if (!line(t.description, LIMIT.description)) bad(`${f}.description`);
      if (code) {
        // Its Worker answers it.
        if (t.code !== true || !(typeof manifest?.hooks === 'string' && manifest.hooks)) bad(`${f}.code`);
        if (own(t, 'input') && !(isObj(t.input) && t.input.type === 'object' && S().clean(t.input) === t.input && !own(t.input.properties || {}, 'reason'))) bad(`${f}.input`);
        return;
      }
      if (typeof t.from !== 'string' || !own(FIELDS, t.from)) bad(`${f}.from`);
      const fields = FIELDS[t.from];
      const field = (v) => typeof v === 'string' && own(fields, v);
      if (own(t, 'select')) {
        if (!Array.isArray(t.select) || !t.select.length) bad(`${f}.select`);
        t.select.forEach((v, j) => { if (!field(v) || t.select.indexOf(v) !== j) bad(`${f}.select.${j}`); });
      }
      if (own(t, 'where')) {
        if (!Array.isArray(t.where) || t.where.length > LIMIT.where) bad(`${f}.where`);
        t.where.forEach((w, j) => {
          const g = `${f}.where.${j}`;
          keys(w, ['field', 'eq', 'days'], g, ['field']);
          if (own(w, 'eq') === own(w, 'days')) bad(g);
          if (!field(w.field)) bad(`${g}.field`);
          if (own(w, 'eq') && !EQ[fields[w.field]](w.eq)) bad(`${g}.eq`);
          if (own(w, 'days') && (fields[w.field] !== 'time' || !Number.isInteger(w.days) || !w.days || Math.abs(w.days) > LIMIT.span)) bad(`${g}.days`);
        });
      }
      if (own(t, 'sort')) {
        keys(t.sort, ['field', 'order'], `${f}.sort`, ['field', 'order']);
        if (!field(t.sort.field)) bad(`${f}.sort.field`);
        if (!['asc', 'desc'].includes(t.sort.order)) bad(`${f}.sort.order`);
      }
      if (own(t, 'limit') && !(Number.isInteger(t.limit) && t.limit >= 1 && t.limit <= LIMIT.items)) bad(`${f}.limit`);
      if (own(t, 'input')) {
        keys(t.input, ['course', 'days'], `${f}.input`);
        if (own(t.input, 'course') && t.input.course !== true) bad(`${f}.input.course`);
        if (own(t.input, 'days') && (t.input.days !== true || !WHEN[t.from])) bad(`${f}.input.days`);
      }
      // The data it reads is the mod's to declare, as a Worker's would be.
      if (!declared.includes(PERM[t.from])) bad(`${f}.from`);
    });
    if (tools.length && !declared.includes('agents')) bad('permissions');
    return tools;
  };

  // What tools ask the student to consent to, as lib/modbundle.js caps: each tool by its name and where its answer comes
  // from, so a new tool, or one reading something else, asks again.
  const caps = (m) => (Array.isArray(m?.tools) ? m.tools : []).filter(isObj).map((t) => `tool:${t.name}@${isCode(t) ? 'code' : t.from}`);
  // The permissions tools need, sorted: agents, and each declarative tool's source's.
  const needs = (tools) => (Array.isArray(tools) && tools.length ? [...new Set(['agents', ...tools.filter((t) => isObj(t) && !isCode(t)).map((t) => PERM[t.from]).filter(Boolean)])].sort() : []);

  // ---- the declarative runner ------------------------------------------------------------------------------------------
  // tool: one clean() kept; items: its source's answer (lib/modbroker.js CALLS: the planner's items for todo and schedule);
  // args: the app's, already checked against defs()' parameters; now: ms. → the items that pass every test (a schedule's
  // only dated ones; the app's course and days when the tool takes them), sorted (empty values last, ties in the source's
  // order), at most limit (and 200), each with only the selected fields (all the source's, by default), as new objects.
  const cmp = (a, b) => (typeof a === 'string' && typeof b === 'string' ? a.localeCompare(b, 'en', { numeric: true }) : a < b ? -1 : a > b ? 1 : 0);
  const apply = (tool, items, args, now) => {
    const fields = FIELDS[tool?.from];
    if (!fields || !Array.isArray(items)) return [];
    const a = isObj(args) ? args : {}, input = isObj(tool.input) ? tool.input : {};
    const within = (v, days) => typeof v === 'number' && (days > 0 ? v >= now && v <= now + days * DAY : v >= now + days * DAY && v <= now);
    const tests = (Array.isArray(tool.where) ? tool.where : []).filter(isObj).map((w) => (own(w, 'days') ? (x) => within(x[w.field], w.days) : (x) => x[w.field] === w.eq));
    if (tool.from === 'schedule') tests.push((x) => Number.isFinite(x.due));
    if (input.course === true && typeof a.course === 'string' && a.course) tests.push((x) => x[COURSE[tool.from]] === a.course);
    if (input.days === true && WHEN[tool.from] && Number.isInteger(a.days) && a.days >= 1 && a.days <= LIMIT.days) {
      const [at, way] = WHEN[tool.from];
      tests.push((x) => within(x[at], a.days * way));
    }
    const out = items.filter((x) => isObj(x) && tests.every((ok) => ok(x)));
    // sort is stable: ties keep the source's order.
    if (isObj(tool.sort) && own(fields, tool.sort.field)) {
      const k = tool.sort.field, way = tool.sort.order === 'desc' ? -1 : 1, empty = (v) => v === null || v === undefined || v === '';
      out.sort((x, y) => (empty(x[k]) || empty(y[k]) ? empty(x[k]) - empty(y[k]) : cmp(x[k], y[k]) * way));
    }
    const select = Array.isArray(tool.select) ? tool.select.filter((k) => own(fields, k)) : Object.keys(fields);
    return out.slice(0, Math.min(Number.isInteger(tool.limit) && tool.limit > 0 ? tool.limit : LIMIT.items, LIMIT.items))
      .map((x) => Object.fromEntries(select.map((k) => [k, own(x, k) ? x[k] : null])));
  };

  // ---- what the registry lists ---------------------------------------------------------------------------------------
  // Shown to apps without the format and direction characters a prompt drops (lib/modbundle.js prompt), and within the
  // registry's lengths: cut by whole characters, with an ellipsis.
  const shown = (v) => String(v).replace(/[\p{Cf}\p{Bidi_Control}]/gu, '');
  const cut = (v, max) => {
    if (v.length <= max) return v;
    let out = '';
    for (const c of v) { if (out.length + c.length > max - 1) break; out += c; }
    return `${out.trimEnd()}…`;
  };
  const PARAMS = {
    course: (t) => ({ type: 'string', minLength: 1, maxLength: 40, description: t.from === 'courses' ? 'Only this course, by its id.' : "Only this course's items, by the course's id." }),
    days: (t) => ({ type: 'integer', minimum: 1, maximum: LIMIT.days, description: t.from === 'grades' ? 'Only grades Glaze read within this many days before now.' : 'Only items due within this many days from now.' }),
  };
  // rec: an installed mod's record (lib/modbundle.js change). → the descriptors of the tools its grants allow: none without
  // agents, and a declarative tool only with its source's permission. The caller lists only mods that are on, not blocked and
  // (code tools) able to run, and adds each tool's run.
  const defs = (rec) => {
    const m = rec?.manifest, grants = isObj(rec?.grants) ? rec.grants : {};
    if (!isObj(m) || !Array.isArray(m.tools) || typeof rec.id !== 'string' || !/^[a-z2-7]{16}$/.test(rec.id) || grants.agents !== true) return [];
    const head = `${cut(shown(m.name), 40)} (mod): `;
    const network = Object.keys(grants).some((g) => g.startsWith('network:') && grants[g] === true);
    return m.tools.filter((t) => isObj(t) && (isCode(t) || grants[PERM[t.from]] === true)).map((t) => {
      const code = isCode(t);
      const parameters = code ? (isObj(t.input) ? JSON.parse(JSON.stringify(t.input)) : { type: 'object', properties: {}, additionalProperties: false })
        : { type: 'object', properties: Object.fromEntries(['course', 'days'].filter((k) => isObj(t.input) && t.input[k] === true).map((k) => [k, PARAMS[k](t)])), additionalProperties: false };
      return {
        name: `mod_${rec.id}_${t.name}`, owner: `mod:${rec.id}`, group: `mod:${rec.id}`, kind: 'read', scope: 'account',
        title: head + cut(shown(t.title), LIMIT.shownTitle - head.length),
        description: cut(`Written by the mod's author, not Glaze. ${shown(t.description)}`, LIMIT.shownDescription), parameters,
        ...(code && { needs: 'tab' }), ...(code && network && { hints: { openWorld: true } }),
      };
    });
  };

  return { LIMIT, FIELDS, SOURCES, KEYS, PERM, clean, caps, needs, apply, defs };
})();
if (typeof module !== 'undefined') module.exports = GZ_MODTOOLS; else GZ_MODTOOLS;
