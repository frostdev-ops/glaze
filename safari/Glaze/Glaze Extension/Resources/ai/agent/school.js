// Ask Rime's reads of the student's school site (docs/ai-harness.md "Rime's own tools"): announcements, a course's content,
// its syllabus as Glaze imported it, and its discussions, each read the way Glaze's own features read them. Canvas's
// announcements across courses come from the to-do list Glaze keeps (storage.local todoCache, planner items of type
// announcement); everything else is read in an open tab of the student's school, signed in as this account (agents/tab.js
// ops announcement, search, modules, topics, document, syllabus, discussion), and a syllabus from what Glaze kept when the
// student imported it (planner/syllabus.js syllabus:<origin>/<uid>/<course>) and, on Blackboard, the course's syllabus
// document. A Blackboard discussion gives its prompt and the student's own replies; classmates' replies are only counted.
// Embedded files are named, never their signed addresses. Canvas and Blackboard Ultra: the agent layer reads no Moodle account.
// Text comes a page at a time (PAGE characters); lists are capped (LIMIT.items) and say whether they were read whole.
// ctx: { account, local (storage.local's get), tab(op, args) → the tab's answer or null when no tab of the school is open }.
// Classic script for the worker; module.exports for node.
var GZ_AI_RIME_SCHOOL = globalThis.GZ_AI_RIME_SCHOOL || (() => {
  const AT = () => (typeof GZ_AI_TASK_AGENT_TOOLS !== 'undefined' ? GZ_AI_TASK_AGENT_TOOLS : require('../tasks/agent-tools.js'));
  const LIMIT = { items: 40, text: 200000 };
  // Stay below agent.tools' per-string limit so formatting never skips part of a page.
  const PAGE = 1000;
  const UID = /^(\d{1,20}|_\d{1,20}_\d{1,20})$/;
  const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
  const fail = (error) => ({ ok: false, error });
  // '<origin>/<uid>' → { account, origin, uid, lms }, as agents/tools-study.js parse reads one.
  const who = (a) => {
    if (typeof a !== 'string' || a.length > 300) return null;
    const i = a.lastIndexOf('/'), origin = a.slice(0, i), uid = a.slice(i + 1);
    try { if (new URL(origin).origin !== origin || !UID.test(uid)) return null; } catch { return null; }
    return { account: a, origin, uid, lms: uid[0] === '_' ? 'ultra' : 'canvas' };
  };
  const host = (w) => new URL(w.origin).host;
  const NONE = 'Glaze could not tell which school account this is; accounts_list names them.';
  const ERRORS = {
    none: 'The site has no such item, or it is not open to the student.', locked: 'The site keeps that one locked for now.', args: 'That id does not fit this site.',
    timeout: 'The school site took too long to answer. Try again.', profile: 'The open tab is signed in as someone else.',
    partial: 'Glaze read only part of the course content; the requested item may be in the unread part. Open it on the site.',
  };
  // A body that is only an embedded file: its names stand in for the text.
  const FILED = 'The text is in the attached file; Glaze names it but can\'t read it. Open it on the site.';
  const filesOf = (r) => (Array.isArray(r.files) ? r.files.slice(0, 10) : []);
  // A read's text a page at a time with the files it embeds, or the files alone when it has no text.
  const body = (r, page) => {
    const files = filesOf(r);
    if (!String(r.text || '').trim()) return files.length ? (page > 1 ? { error: 'There is 1 page.' } : { files, note: FILED }) : null;
    const p = paged(r.text, page, r.truncated);
    return p.error ? p : { ...p, ...(files.length && { files }) };
  };
  // The tab's answer, or why there is none.
  const viaTab = async (w, ctx, op, args) => {
    if (typeof ctx?.tab !== 'function') return fail(`Open ${host(w)} in this browser, signed in, so Glaze can read it.`);
    let r;
    try { r = await ctx.tab(op, args); } catch { return fail('Glaze could not read that from the school site.'); }
    if (r === null || r === undefined) return fail(`Open ${host(w)} in this browser, signed in as this account, so Glaze can read it.`);
    if (r.ok !== true) return fail(ERRORS[r.error] || 'Glaze could not read that from the school site.');
    return r;
  };
  // A page of a text, from 1: { text, page, pages }, or why not.
  const paged = (text, page = 1, truncated = false) => {
    const t = String(text || '').slice(0, LIMIT.text), chunks = [];
    let part = '', size = 0;
    // Escaped control characters can take six JSON characters each. Leave room for the record's metadata inside
    // agent.tools' total result limit, as well as keeping each string below its own limit. Keep surrogate pairs whole.
    for (const c of t) {
      const n = JSON.stringify(c).length - 2;
      if (part && (part.length + c.length > PAGE || size + n > 1500)) { chunks.push(part); part = ''; size = 0; }
      part += c; size += n;
    }
    chunks.push(part);
    const pages = chunks.length;
    if (page > pages) return { error: `There are ${pages} pages.` };
    return { text: chunks[page - 1], page, pages, ...((truncated || String(text || '').length > LIMIT.text) && { truncated: true }) };
  };
  const capped = (items) => ({ items: items.slice(0, LIMIT.items), ...(items.length > LIMIT.items && { more: items.length - LIMIT.items }) });
  const spec = (name) => AT().SPECS.find((t) => t.name === name);
  const def = (name, run) => ({ name, kind: spec(name).kind, description: spec(name).description, parameters: spec(name).parameters, run });
  const course = (w, c) => (w.lms === 'ultra' ? /^_\d{1,20}_\d{1,20}$/ : /^\d{1,20}$/).test(c || '');

  // Canvas's announcements as the to-do list keeps them (its planner, read for the list's own range).
  const planned = async (w, ctx, c) => {
    const got = await ctx.local.get('todoCache'), cache = got?.todoCache;
    if (!isObj(cache) || cache.key !== `todo:${w.account}` || !Array.isArray(cache.items)) return { account: w.account, at: null, items: [], missing: `Open the Dashboard at ${w.origin}, signed in as this account, so Glaze reads its announcements.` };
    const items = cache.items.filter((i) => isObj(i) && i.type === 'announcement' && UID.test(String(i.id)) && (!c || String(i.cid) === c))
      .sort((a, b) => (b.at || 0) - (a.at || 0)).map((i) => ({ id: String(i.id), title: String(i.title || ''), course: String(i.course || ''), courseId: String(i.cid || ''), at: i.at || null, read: i.read === true }));
    return { account: w.account, at: cache.at || null, covers: { from: Date.parse(cache.start) || null, to: Date.parse(cache.end) || null, complete: cache.complete !== false }, ...capped(items) };
  };

  const tools = () => [
    def('announcements_list', async (args, ctx) => {
      const w = who(ctx?.account);
      if (!w) return fail(NONE);
      if (args.course !== undefined && !course(w, args.course)) return fail(ERRORS.args);
      if (w.lms === 'canvas') return planned(w, ctx, args.course);
      if (!args.course) return fail('On Blackboard, name the course: courses_list gives its id.');
      const r = await viaTab(w, ctx, 'search', { course: args.course, kind: 'announcements' });
      return r.ok === false ? r : { account: w.account, complete: r.complete, ...capped(r.items.map((i) => ({ id: i.id, title: i.title, at: i.at ?? null }))) };
    }),
    def('announcement_read', async (args, ctx) => {
      const w = who(ctx?.account);
      if (!w) return fail(NONE);
      if (!course(w, args.course)) return fail(ERRORS.args);
      const r = await viaTab(w, ctx, 'announcement', { course: args.course, id: args.id });
      if (r.ok === false) return r;
      const p = paged(r.text, args.page || 1, r.truncated);
      return p.error ? fail(p.error) : { account: w.account, title: r.title, ...(r.author && { author: r.author }), at: r.at, ...p, ...(r.files.length && { files: r.files.slice(0, 20) }) };
    }),
    def('content_list', async (args, ctx) => {
      const w = who(ctx?.account);
      if (!w) return fail(NONE);
      if (!course(w, args.course)) return fail(ERRORS.args);
      const r = await viaTab(w, ctx, w.lms === 'ultra' ? 'search' : 'modules', { course: args.course, kind: 'contents' });
      return r.ok === false ? r : { account: w.account, complete: r.complete, ...capped(r.items.map(({ id, title, kind, module }) => ({ id, title, kind, ...(module && { module }) }))) };
    }),
    def('content_read', async (args, ctx) => {
      const w = who(ctx?.account);
      if (!w) return fail(NONE);
      if (w.lms !== 'ultra') return fail("Glaze can't read Canvas pages or files yet; open the item on the site.");
      if (!course(w, args.course)) return fail(ERRORS.args);
      const r = await viaTab(w, ctx, 'document', { course: args.course, id: args.id });
      if (r.ok === false) return r.error === ERRORS.none ? fail('No such item in this course for the student now; content_list names them.') : r;
      const got = body(r, args.page || 1);
      if (!got) return fail(`“${r.title}” holds no text Glaze can read (a ${String(r.kind).toLowerCase()}); open it on the site.`);
      return got.error ? fail(got.error) : { account: w.account, title: r.title, kind: r.kind, ...got };
    }),
    def('syllabus_read', async (args, ctx) => {
      const w = who(ctx?.account);
      if (!w) return fail(NONE);
      if (!course(w, args.course)) return fail(ERRORS.args);
      const key = `syllabus:${w.account}/${args.course}`, rec = (await ctx.local.get(key))?.[key];
      const kept = isObj(rec) && !rec.deleted;
      // On Blackboard the syllabus is a document in the course, wherever the instructor put it: its text, a page at a time.
      let doc = null, looked = '';
      if (w.lms === 'ultra') {
        const r = await viaTab(w, ctx, 'syllabus', { course: args.course });
        if (r.ok === false) looked = r.error;
        else if (r.found) {
          const got = body(r, args.page || 1);
          if (got?.error) return fail(got.error);
          doc = { id: r.id, title: r.title, ...(got || { note: "It holds no text Glaze can read; open it on the site." }) };
        } else looked = r.complete === false ? 'Glaze read only part of the course content and found no syllabus there.' : 'The course has no item named as a syllabus.';
      }
      if (!kept && !doc) return { account: w.account, course: args.course, at: null, missing: `Glaze holds nothing from this course's syllabus. Import it with Glaze's Syllabus import, from the course's page.${looked ? ` ${looked}` : ''}` };
      if (!kept) return { account: w.account, course: args.course, at: null, document: doc };
      const prof = isObj(rec.prof) ? Object.fromEntries(Object.entries(rec.prof).filter(([, v]) => typeof v === 'string' && v)) : {};
      const list = (v) => (Array.isArray(v) ? v : []);
      return { account: w.account, course: args.course, at: rec.at || null, ...(Object.keys(prof).length && { instructor: prof }),
        hours: list(rec.hours), meetings: list(rec.meetings), dates: list(rec.dates).slice(0, LIMIT.items).map(({ title, day, kind }) => ({ title, day, kind })),
        scale: list(rec.scale).map(([letter, min]) => ({ letter, min })), weights: list(rec.weights),
        ...(list(rec.dates).length > LIMIT.items && { more: { dates: rec.dates.length - LIMIT.items } }), ...(doc && { document: doc }) };
    }),
    def('discussions_list', async (args, ctx) => {
      const w = who(ctx?.account);
      if (!w) return fail(NONE);
      if (!course(w, args.course)) return fail(ERRORS.args);
      const r = await viaTab(w, ctx, w.lms === 'ultra' ? 'search' : 'topics', { course: args.course, kind: 'discussions' });
      return r.ok === false ? r : { account: w.account, complete: r.complete, ...capped(r.items.map(({ id, title }) => ({ id, title }))) };
    }),
    def('discussion_read', async (args, ctx) => {
      const w = who(ctx?.account);
      if (!w) return fail(NONE);
      if (!course(w, args.course)) return fail(ERRORS.args);
      if (w.lms === 'ultra') {
        // The prompt, whether it's graded, the student's own replies (first page only) and how many classmates replied:
        // never a classmate's name or words.
        const r = await viaTab(w, ctx, 'discussion', { course: args.course, id: args.id });
        if (r.ok === false) return r;
        const page = args.page || 1, got = body(r, page) || { text: '', page: 1, pages: 1 };
        if (got.error) return fail(got.error);
        const mine = page === 1 ? (r.mine || []).slice(0, 3).map((m) => ({ at: m.at ?? null, reply: m.reply === true, text: String(m.text || '').slice(0, 300) })) : [];
        return { account: w.account, title: r.title, ...(r.at && { at: r.at }), gradable: r.gradable === true, ...got,
          ...(page === 1 && { mine, ...((r.mine || []).length > 3 && { mineMore: r.mine.length - 3 }), others: r.others ?? null, ...(r.complete === false && { complete: false }) }) };
      }
      // A Canvas topic may itself be a student's post. The popup's shape supplies neither instructor authorship nor a
      // separate instructor prompt, so passing its author/message through would expose a classmate's name and words.
      return fail("Glaze can't verify this Canvas prompt's authorship yet; open it on the site.");
    }),
  ];
  const register = (registry) => tools().map((t) => registry.add(t));
  return { LIMIT, PAGE, paged, tools, register };
})();
if (typeof module !== 'undefined') module.exports = GZ_AI_RIME_SCHOOL; else GZ_AI_RIME_SCHOOL;
