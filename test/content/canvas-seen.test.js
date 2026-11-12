// content-canvas.js's writes to the course list every tab shares (storage.local seenCourses): the list a page load records and
// a card's colour edited on the Dashboard, sent in the same instant, both stay. The real functions, cut out of the file and run
// in a VM, their patches merged as the worker merges them (courses/seen.js), one a turn later (audit 2026-11-11 A4, N5).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../../extension/content/content-canvas.js'), 'utf8');
const block = (from, to) => { const a = source.indexOf(from), b = source.indexOf(to, a); assert.ok(a > 0 && b > a, `${from} … ${to}`); return source.slice(a, b); };
const settle = async (n = 30) => { for (let i = 0; i < n; i++) await new Promise(setImmediate); };
const ORIGIN = 'https://school.instructure.com';

const SEEN = require('../../extension/courses/seen.js');
// worker: false is a worker that hasn't answered yet. lists: what the page set as its own course list.
const tab = ({ data, rows = [{ id: '5', name: 'Calculus', course_code: 'MATH' }], colors = {}, worker = true }) => {
  const asked = [], lists = [];
  const chrome = { runtime: { sendMessage: (m) => new Promise((res) => setImmediate(() => {
    asked.push(m);
    if (!worker) return;
    const patch = SEEN.merge(data[m.key], m, { kind: 'canvas', origin: ORIGIN });
    if (patch) Object.assign(data, structuredClone(patch));
    res({ ok: !!patch });
  })) }, storage: { local: { get: (k, cb) => setImmediate(() => cb(structuredClone({ [k]: data[k] }))) } } };
  const hero = { style: { backgroundColor: 'rgb(1, 2, 3)' } }, link = { getAttribute: () => '/courses/6' };
  const card = { querySelector: (sel) => (sel.startsWith('a[href') ? link : sel.includes('hero') ? hero : null) };
  const document = { querySelectorAll: (sel) => (sel === '.ic-DashboardCard' ? [card] : []) };
  const I = { observer: {}, settings: { enabled: true }, courseList: { [`canvas:${ORIGIN}/6`]: { name: 'Art', color: '#ffffff' } }, setCourseList: (all) => lists.push(Object.keys(all).sort()) };
  const ctx = vm.createContext({ chrome, document, I, C: require('../../extension/core/color.js'), Promise, Object, JSON, Date, URL,
    location: { origin: ORIGIN, pathname: '/' }, sessionStorage: { setItem() {}, getItem: () => null },
    canvasCourseKey: (id) => (id ? `canvas:${ORIGIN}/${id}` : undefined), canvasAll: () => (rows instanceof Error ? Promise.reject(rows) : Promise.resolve(rows)),
    capi: (p) => Promise.resolve(p.includes('colors') ? { custom_colors: colors } : { id: '77' }), setTimeout: () => 1 });
  ctx.globalThis = ctx;
  vm.runInContext(`let canvasList = null, canvasSnapshot = null, coursesRead = false; const COURSE_CACHE = 'c';
    const readCourses = () => canvasAll();\n${block('  let mine = null;', '  // ---- code on demand')}\n${block('  const paintCourses = () => {', '  // ---- the global navigation')}
    this.record = record; this.paint = paintCourses;`, ctx);
  return { record: ctx.record, paint: ctx.paint, asked, lists };
};
const names = (data) => Object.keys(data.seenCourses).sort();

test('a Dashboard colour edit and a page load recording the course list in the same instant both keep their courses', async () => {
  const data = { seenCourses: { [`canvas:${ORIGIN}/6`]: { name: 'Art', color: '#ffffff' }, 'other:1': { name: 'Elsewhere' } } };
  // Course 6 is the student's (in the list Canvas answers), its colour as Canvas keeps it the one the card shows.
  const t = tab({ data, rows: [{ id: '5', name: 'Calculus', course_code: 'MATH' }, { id: '6', name: 'Art', course_code: 'ART' }], colors: { course_6: '#010203' } });
  t.record();
  t.paint();
  await settle();
  assert.deepEqual(names(data), [`canvas:${ORIGIN}/5`, `canvas:${ORIGIN}/6`, 'other:1']);
  assert.equal(data.seenCourses[`canvas:${ORIGIN}/6`].color, '#010203', 'the colour the student picked');
  assert.deepEqual([...new Set(t.asked.map((m) => `${m.type} ${m.key}`))], ['glaze:seen seenCourses'], 'each a patch for the worker');
});

// Audit 2026-11-11 N1: on a shared browser profile the list kept every account's courses at this host for good.
test("this host's courses are the signed-in student's list: another account's leave, other hosts' and sites' stay", async () => {
  const other = { 'canvas:https://other.instructure.com/9': { name: 'Other school' }, _7_1: { name: 'Ultra', site: 'https://bb.example' }, 'moodle:https://m.example/3': { name: 'Moodle' } };
  const data = { seenCourses: { ...other, [`canvas:${ORIGIN}/6`]: { name: 'The last student\'s', canvas: true } } };
  tab({ data }).record();
  await settle();
  assert.deepEqual(names(data), [`canvas:${ORIGIN}/5`, ...Object.keys(other)].sort());
  // An empty answer, a failed one and one cut short drop nothing.
  for (const rows of [[], new Error('503'), Object.assign([{ id: '8', name: 'Eight' }], { complete: false })]) {
    const kept = { seenCourses: { ...other, [`canvas:${ORIGIN}/6`]: { name: 'Kept', canvas: true } } };
    tab({ data: kept, rows }).record();
    await settle();
    assert.ok(kept.seenCourses[`canvas:${ORIGIN}/6`], String(rows));
    assert.deepEqual(Object.keys(other).filter((k) => !kept.seenCourses[k]), []);
  }
});


// The course tabs and the document tools wait for the page's course list. Through the worker alone it came a round trip late
// (they reached a Canvas page about 150 ms after it painted, pushing it down): the page takes its own at once, as the
// worker will merge it, and stores nothing itself.
test('the page takes its own course list at once, before the worker answers', async () => {
  const data = { seenCourses: { 'other:1': { name: 'Elsewhere' }, [`canvas:${ORIGIN}/6`]: { name: 'The last student\'s', canvas: true } } };
  const t = tab({ data, worker: false });
  t.record();
  await settle();
  assert.deepEqual(t.asked.map((m) => `${m.type} ${m.key}`), ['glaze:seen seenCourses'], 'the patch is on its way');
  assert.deepEqual(t.lists, [[`canvas:${ORIGIN}/5`, 'other:1']], 'this student\'s courses and the other sites\', with no answer yet');
  assert.deepEqual(names(data), [`canvas:${ORIGIN}/6`, 'other:1'], 'storage is the worker\'s to write');
  // A list cut short drops nothing from the page's view either.
  const cut = tab({ data, worker: false, rows: Object.assign([{ id: '8', name: 'Eight' }], { complete: false }) });
  cut.record();
  await settle();
  assert.deepEqual(cut.lists, [[`canvas:${ORIGIN}/6`, `canvas:${ORIGIN}/8`, 'other:1']]);
});
