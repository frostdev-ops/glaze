// Glaze's caches for the MCP read tools' tests (test/mcp-tools-*.test.js), made by the code that writes them, from the
// live-shaped fixtures: Canvas's planner items through features/todo.js load and lib/todo.js change, and its gradebooks (test/fixtures/canvas-grades.json,
// read from a local Canvas) through lib/insights.js, as features/todo.js and features/insights.js keep them; Ultra's
// memberships, To Do and gradebook rows (test/fixtures/ultra-*.json) through lib/ultra.js; course caches through the actual
// content scripts' record functions; each Insights record through lib/insights.js change, as the worker keeps it.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const T = require('../../lib/todo.js');
const U = require('../../lib/ultra.js');
const I = require('../../lib/insights.js');
const { GZ_COURSES } = require('../../defaults.js');

const load = (n) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'fixtures', n), 'utf8'));
const CANVAS = 'https://school.instructure.com', ULTRA = 'https://lms.example.edu', ULTRA_UID = '_900_1';
const NOW = Date.parse('2026-10-15T12:00:00Z'), LATER = Date.parse('2026-10-24T12:00:00Z');
const TZ = 'UTC';
const O = Object.fromEntries(Object.entries(T.SPEC).map(([k, [d]]) => [k, d])); // the to-do list's defaults
// Execute the production writer without starting its page UI. Boundaries fail loudly if it moves.
const part = (file, from, to) => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', file), 'utf8'), a = src.indexOf(from), b = src.indexOf(to, a);
  if (a < 0 || b <= a) throw new Error(`Missing writer in ${file}`);
  return src.slice(a, b);
};
const writerArea = (store) => ({
  get: async (keys) => Object.fromEntries([].concat(keys).map((k) => [k, store[k]])),
  set: async (patch) => { Object.assign(store, structuredClone(patch)); return true; },
});
const planCache = async (origin, uid, at, scope) => {
  const key = T.storeKey(origin, uid), store = {};
  const load = vm.runInNewContext(part('features/todo.js', '  const load = async (reuse)', '  // Teachers\' grading progress:') + '\nload;', {
    Date: class extends Date { static now() { return at; } }, L: T, o: () => O, who: { tz: TZ }, key, gen: 0, box: {}, cache: null, ...scope,
  });
  const [cache, due] = await load(false);
  const r = await T.change({ key, cache, due }, { local: writerArea(store) });
  if (!r.ok) throw new Error(`planner not kept: ${JSON.stringify(r)}`);
  return store.todoCache;
};

// One item of Canvas's /api/v1/planner/items, as test/todo.test.js writes them.
const planner = ({ type = 'assignment', id, course = 25, name = 'BIO 1100', title, at, sub = {}, ov = null, details }) => ({
  plannable_type: type, plannable_id: id, course_id: course, context_name: name, plannable_date: at,
  html_url: type === 'planner_note' ? `${CANVAS}/api/v1/planner_notes/${id}` : `${CANVAS}/courses/${course}/assignments/${id}`,
  plannable: { title, ...(details && { details }) },
  submissions: type === 'planner_note' ? false : { submitted: false, excused: false, graded: false, late: false, missing: false, redo_request: false, ...sub },
  planner_override: ov,
});
// storage.local todoCache, as features/todo.js load() makes it on each site.
const canvasPlan = (uid, raw, at = NOW - 60e3) => planCache(CANVAS, uid, at, {
  ultra: false, pages: async () => raw, ctx: { canvasCourses: async () => [] },
  GZ_CANVAS_DUE_WEEK: require('../../defaults.js').GZ_CANVAS_DUE_WEEK,
});
const memberships = () => load('ultra-memberships.json').results;
const ultraPlan = (at = NOW - 120e3, complete = true) => {
  const names = Object.fromEntries(Object.entries(GZ_COURSES(memberships())).map(([id, c]) => [id, c.name]));
  return planCache(ULTRA, ULTRA_UID, at, { ultra: true, ctx: { need: async () => {} },
    GZ_ULTRA: { page: { due: async () => ({ items: U.due({ todo: [load('ultra-todo.json')], names, now: at }), complete }) } },
  });
};
const seenCache = (file, start, end, scope) => new Promise((resolve, reject) => {
  const store = {};
  const local = { get: (k, cb) => cb({ [k]: store[k] }), set: (patch) => { Object.assign(store, structuredClone(patch)); resolve(store); } };
  const record = vm.runInNewContext(part(file, start, end) + '\nrecord;', { chrome: { storage: { local } }, Date: { now: () => NOW - 300e3 }, ...scope });
  Promise.resolve(record()).catch(reject);
});
// Both course caches come from the unmodified content-script writer, with only its LMS/extension APIs replaced.
const ultraSeen = async () => (await seenCache('content-ultra.js', '  const record = ', '  // ---- the gradebook', {
  location: { origin: ULTRA }, myCourses: async () => memberships(), GZ_COURSES, courseSlots: {},
})).seenCourses;
const canvasSeen = async (list) => (await seenCache('content-canvas.js', '  const COURSE_CACHE = ', '  // ---- code on demand', {
  URL, I: { settings: {}, setCourseList: () => {} }, location: { origin: CANVAS },
  sessionStorage: { getItem: () => null, setItem: () => {} }, canvasCourseKey: (id) => `canvas:${CANVAS}/${id}`,
  capi: async (p) => p.startsWith('/courses?') ? list : p === '/users/self/profile' ? { id: '5' }
    : { custom_colors: Object.fromEntries(list.map((c) => [`course_${c.id}`, c.color])) },
})).seenCourses;

// Insights' courses, as features/insights.js one() makes them: Canvas's from the live gradebooks (named by their code, which
// the fixture keeps in place of the name), Ultra's from its gradebook rows.
const canvasGrades = () => load('canvas-grades.json').courses;
const canvasCourse = ({ course, groups, periods }, at, more = {}) => {
  const q = !!course.restrict_quantitative_data;
  const work = groups.flatMap((g) => g.assignments || []).filter((a) => a.published !== false && a.workflow_state !== 'unpublished');
  const gp = course.enrollment?.current_grading_period_id;
  const trend = q ? [] : I.trend(groups, { weighted: course.apply_assignment_group_weights, periods, weightedPeriods: course.has_weighted_grading_periods }, TZ, gp);
  return { id: String(course.id), name: course.course_code, q, more: false, items: work.map((a) => I.item(a, at)), trend, gp: trend.some((x) => x[2]) ? String(gp) : '', ...more };
};
const ultraRows = (n) => load(`ultra-${n}.json`).results;
const ultraCourse = (id, name, rows, at) => ({ id, name, q: false, more: false, items: U.work(rows, at), trend: U.trend(rows, TZ), gp: '' });
// Kept in store as the worker's 'glaze:insights' put keeps it. → the stored record.
const keepInsights = async (store, origin, uid, courses, at) => {
  const local = writerArea(store);
  const key = I.storeKey(origin, uid);
  const r = await I.change({ key, op: 'put', at, base: 0, rec: I.clean({ term: '5', name: 'Fall 2026', from: Date.parse('2026-08-24T04:00:00Z'), to: Date.parse('2026-12-19T05:00:00Z'), courses }) }, local);
  if (!r.ok) throw new Error(`insights not kept: ${JSON.stringify(r)}`);
  return store[key];
};
const clearInsights = async (store, origin, uid, at) => {
  const local = writerArea(store);
  return I.change({ key: I.storeKey(origin, uid), op: 'clear', at }, local);
};

// storage.local as the tools read it (get; the keys, as the worker's getKeys), and a tool's context for one account.
const area = (data) => ({
  data, reads: [],
  async get(k) { this.reads.push(k); const keys = k === null ? Object.keys(data) : [].concat(k); return structuredClone(Object.fromEntries(keys.filter((x) => Object.hasOwn(data, x)).map((x) => [x, data[x]]))); },
});
const ctx = (store, account, more = {}) => { const local = area(store); return { account, local, keys: async () => Object.keys(store), now: () => NOW, ...more }; };
// The broker's own answer for a mod on that account's page (lib/modbroker.js CALLS), over the same storage.
const broker = (store, account) => {
  const i = account.lastIndexOf('/');
  return { site: account.slice(0, i), account: async () => account.slice(i + 1), local: area(store), keys: async () => Object.keys(store) };
};

module.exports = { load, CANVAS, ULTRA, ULTRA_UID, NOW, LATER, TZ, planner, canvasPlan, ultraSeen, ultraPlan, canvasSeen, canvasGrades, canvasCourse, ultraRows, ultraCourse, keepInsights, clearInsights, area, ctx, broker };
