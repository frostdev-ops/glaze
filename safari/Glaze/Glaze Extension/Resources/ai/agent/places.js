// Ask Rime's places (docs/ai-harness.md "Rime's own tools"): a map of the student's school site that Glaze knows the way to,
// and the panel's actions on it. The paths are the ones Glaze already opens: the command palette's site pages
// (navigation/page/palette.js), the widgets' places and course homes (mods/page/modwidgets.js PLACE, COURSE), a Canvas
// course's own navigation and an Ultra course's (their pages' links; test/fixtures/canvas-course-grades.html,
// ultra-instant-outline.html) and Moodle's user report (courses/moodle.js). Nothing is guessed: a place not on the map is refused with the nearest one.
//   map({ site, url, courses, writer }) → { site, origin, here, places: [{ place, title, url? | app? }] }: site 'canvas',
//     'ultra' or 'moodle'; url the page the student is on; courses [{ id, name, code }] (courses_list's); writer whether
//     Glaze Writer is on (Documents). A course's own pages only with course (list(map, course)).
//   tools() → places_list, place_open, page_highlight, for ai/tools.js define. ctx: { page: { site, url }, courses() →
//     courses, writer?, text? (the page's visible words, for page_highlight), ui: { push(action), actions? } }. The panel
//     performs ui actions after the run (ai/page/ask.js, in integration): { action: 'open', place, title, url | app }
//     ('documents' or 'settings'), { action: 'highlight', text, note }. There is no fill: Glaze never fills in the
//     student's work or a site's forms.
// Pure apart from ctx. Classic script for the worker; module.exports for node.
var GZ_AI_RIME_PLACES = globalThis.GZ_AI_RIME_PLACES || (() => {
  const AT = () => (typeof GZ_AI_TASK_AGENT_TOOLS !== 'undefined' ? GZ_AI_TASK_AGENT_TOOLS : require('../tasks/agent-tools.js'));
  const LIMIT = { courses: 60, places: 80, text: 200, note: 80, title: 120 };
  const SITES = {
    canvas: { pages: [['dashboard', 'Dashboard', '/'], ['courses', 'Courses', '/courses'], ['calendar', 'Calendar', '/calendar'], ['grades', 'Grades', '/grades']],
      id: /^\d{1,20}$/, home: (id) => `/courses/${id}`,
      course: [['grades', 'grades', (id) => `/courses/${id}/grades`], ['assignments', 'assignments', (id) => `/courses/${id}/assignments`],
        ['announcements', 'announcements', (id) => `/courses/${id}/announcements`], ['modules', 'modules', (id) => `/courses/${id}/modules`]] },
    ultra: { pages: [['courses', 'Courses', '/ultra/course'], ['calendar', 'Calendar', '/ultra/calendar'], ['grades', 'Grades', '/ultra/grades'], ['stream', 'Activity stream', '/ultra/stream']],
      id: /^_\d{1,20}_\d{1,20}$/, home: (id) => `/ultra/courses/${id}/outline`,
      course: [['grades', 'grades', (id) => `/ultra/courses/${id}/grades`], ['announcements', 'announcements', (id) => `/ultra/courses/${id}/announcements`]] },
    moodle: { pages: [['dashboard', 'Dashboard', '/my/'], ['courses', 'My courses', '/my/courses.php'], ['calendar', 'Calendar', '/calendar/view.php?view=month'], ['grades', 'Grades', '/grade/report/overview/index.php']],
      id: /^\d{1,20}$/, home: (id) => `/course/view.php?id=${id}`,
      course: [['grades', 'grades', (id) => `/grade/report/user/index.php?id=${id}`]] },
  };
  const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
  const fail = (error) => ({ ok: false, error });
  const text = (v, n) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, n) : '');
  const originOf = (url) => { try { const u = new URL(url); return /^https?:$/.test(u.protocol) ? u : null; } catch { return null; } };
  const courseTitle = (c) => text(c.name, LIMIT.title) || text(c.code, LIMIT.title) || 'Course';

  // Every place on this site, its courses' own pages too (list() picks).
  const map = ({ site, url, courses = [], writer = false } = {}) => {
    const S = SITES[site], u = originOf(url);
    if (!S || !u) return null;
    const at = (path) => new URL(path, u.origin).href;
    const places = S.pages.map(([place, title, path]) => ({ place, title, url: at(path) }));
    if (writer) places.push({ place: 'documents', title: 'Documents (Glaze Writer)', app: 'documents' });
    places.push({ place: 'settings', title: 'Glaze settings', app: 'settings' });
    const seen = new Set();
    for (const c of Array.isArray(courses) ? courses : []) {
      if (!isObj(c) || !S.id.test(String(c.id)) || seen.has(String(c.id)) || seen.size >= LIMIT.courses) continue;
      const id = String(c.id), name = courseTitle(c);
      seen.add(id);
      places.push({ place: `course:${id}`, title: name, url: at(S.home(id)), course: id });
      for (const [k, word, path] of S.course) places.push({ place: `course:${id}/${k}`, title: `${name} ${word}`, url: at(path(id)), course: id });
    }
    // The place on screen: the longest path the page is at or under. Query ids identify Moodle courses; extra
    // presentation options do not change the place, nor does the calendar's day/week/month view.
    const here = places.filter((p) => p.url).map((p) => ({ p, v: new URL(p.url) })).filter(({ p, v }) => (v.search ? v.pathname === u.pathname && [...v.searchParams].every(([k, value]) => p.place === 'calendar' || (u.searchParams.has(k) && u.searchParams.getAll(k).every((x) => x === value)))
      : v.pathname === '/' ? u.pathname === '/' : u.pathname === v.pathname || u.pathname.startsWith(`${v.pathname.replace(/\/$/, '')}/`)))
      .sort((a, b) => b.v.pathname.length + b.v.search.length - a.v.pathname.length - a.v.search.length)[0]?.p.place || null;
    return { site, origin: u.origin, here, places };
  };
  // What places_list answers: without course the site's pages, Glaze's and each course's home; with it that course's.
  const list = (m, course) => {
    const keep = course === undefined ? m.places.filter((p) => !p.course || !p.place.includes('/')) : m.places.filter((p) => p.course === course);
    // A course's id beside its home in the top list, so places_list with course can follow it.
    return keep.slice(0, LIMIT.places).map(({ place, title, course: c }) => ({ place, title, ...(c && course === undefined && { course: c }) }));
  };
  const words = (s) => String(s).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  // The nearest place to a name that isn't one: the most words in common with its id and title, then the shortest.
  const suggest = (m, want) => {
    const w = new Set(words(want));
    return m.places.map((p) => ({ p, n: [...new Set([...words(p.place), ...words(p.title)])].filter((x) => w.has(x)).length }))
      .sort((a, b) => b.n - a.n || a.p.place.length - b.p.place.length)[0]?.p || null;
  };
  const build = async (ctx) => {
    const page = isObj(ctx?.page) ? ctx.page : {};
    let courses = [];
    try { courses = typeof ctx?.courses === 'function' ? await ctx.courses() : []; } catch { courses = []; }
    return map({ site: page.site, url: page.url, courses, writer: ctx?.writer === true });
  };
  const NOT_HERE = "Glaze can open places only from a page of the student's school site.";
  const fold = (s) => String(s).normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
  const spec = (name) => AT().SPECS.find((t) => t.name === name);
  const def = (name, run) => ({ name, kind: spec(name).kind, description: spec(name).description, parameters: spec(name).parameters, run });

  const tools = () => [
    def('places_list', async (args, ctx) => {
      const m = await build(ctx);
      if (!m) return fail(NOT_HERE);
      if (args.course !== undefined && !m.places.some((p) => p.course === args.course)) return fail(`No course ${args.course} on this site. places_list without course names the courses.`);
      return { site: m.site, here: m.here, places: list(m, args.course) };
    }),
    def('place_open', async (args, ctx) => {
      const m = await build(ctx);
      if (!m) return fail(NOT_HERE);
      const p = m.places.find((x) => x.place === args.place);
      if (!p) {
        const near = suggest(m, args.place);
        return fail(`There is no place "${String(args.place).slice(0, 80)}".${near ? ` The nearest is ${near.place} (${near.title}).` : ''} places_list names every place.`);
      }
      ctx.ui.push({ action: 'open', place: p.place, title: p.title, ...(p.url ? { url: p.url } : { app: p.app }) });
      return { opened: p.place, title: p.title };
    }),
    def('page_highlight', async (args, ctx) => {
      const want = text(args.text, LIMIT.text), note = text(args.note, LIMIT.note);
      if (!want) return fail('Give the words to mark.');
      // After an open, the words are on the next page: the panel looks for them there.
      const opened = (Array.isArray(ctx.ui?.actions) ? ctx.ui.actions : []).some((a) => a?.action === 'open');
      if (!opened && typeof ctx.text === 'string' && !fold(ctx.text).includes(fold(want))) return fail('Those words are not on this page. Open the place they are on first, or mark words that are here.');
      ctx.ui.push({ action: 'highlight', text: want, note });
      return { marked: want, on: opened ? 'the place just opened' : 'this page' };
    }),
  ];
  const register = (registry) => tools().map((t) => registry.add(t));
  return { LIMIT, SITES, map, list, suggest, tools, register };
})();
if (typeof module !== 'undefined') module.exports = GZ_AI_RIME_PLACES; else GZ_AI_RIME_PLACES;
