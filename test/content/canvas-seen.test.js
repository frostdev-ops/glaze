// content-canvas.js's writes to the course list every tab shares (storage.local seenCourses): the list a page load records and
// a card's colour edited on the Dashboard, read-modify-written in the same instant, both stay. The real functions, cut out of
// the file and run in a VM over storage that answers a turn later, as chrome.storage does (audit 2026-11-11 A4).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../../extension/content/content-canvas.js'), 'utf8');
const block = (from, to) => { const a = source.indexOf(from), b = source.indexOf(to, a); assert.ok(a > 0 && b > a, `${from} … ${to}`); return source.slice(a, b); };
const settle = async (n = 30) => { for (let i = 0; i < n; i++) await new Promise(setImmediate); };
const ORIGIN = 'https://school.instructure.com';

const tab = ({ data, locks }) => {
  const asked = [];
  const chrome = { runtime: {}, storage: { local: {
    get: (k, cb) => setImmediate(() => cb(Object.fromEntries([].concat(k).filter((x) => x in data).map((x) => [x, structuredClone(data[x])])))),
    set: (o, cb) => setImmediate(() => { Object.assign(data, structuredClone(o)); cb?.(); }),
  } } };
  const hero = { style: { backgroundColor: 'rgb(1, 2, 3)' } }, link = { getAttribute: () => '/courses/6' };
  const card = { querySelector: (sel) => (sel.startsWith('a[href') ? link : sel.includes('hero') ? hero : null) };
  const document = { querySelectorAll: (sel) => (sel === '.ic-DashboardCard' ? [card] : []) };
  const I = { observer: {}, settings: { enabled: true }, courseList: { [`canvas:${ORIGIN}/6`]: { name: 'Art', color: '#ffffff' } }, setCourseList: () => {} };
  const ctx = vm.createContext({ chrome, document, I, C: require('../../extension/core/color.js'), Promise, Object, JSON, Date, URL,
    navigator: locks ? { locks: { request: (name, cb) => { asked.push(name); return locks(name, cb); } } } : {},
    location: { origin: ORIGIN, pathname: '/' }, sessionStorage: { setItem() {}, getItem: () => null },
    canvasCourseKey: (id) => (id ? `canvas:${ORIGIN}/${id}` : undefined), canvasAll: () => Promise.resolve([{ id: '5', name: 'Calculus', course_code: 'MATH' }]),
    capi: (p) => Promise.resolve(p.includes('colors') ? { custom_colors: {} } : { id: '77' }), setTimeout: () => 1 });
  ctx.globalThis = ctx;
  vm.runInContext(`let canvasList = null, canvasSnapshot = null, coursesRead = false; const COURSE_CACHE = 'c';
    const readCourses = () => canvasAll();\n${block('  let mine = null;', '  // ---- code on demand')}\n${block('  const paintCourses = () => {', '  // ---- the global navigation')}
    this.record = record; this.paint = paintCourses;`, ctx);
  return { record: ctx.record, paint: ctx.paint, asked };
};
const originLocks = () => { const tails = new Map(); return (name, cb) => { const run = (tails.get(name) || Promise.resolve()).then(() => cb()); tails.set(name, run.catch(() => {})); return run; }; };
const names = (data) => Object.keys(data.seenCourses).sort();

test('a Dashboard colour edit and a page load recording the course list in the same instant both keep their courses', async () => {
  const data = { seenCourses: { [`canvas:${ORIGIN}/6`]: { name: 'Art', color: '#ffffff' }, 'other:1': { name: 'Elsewhere' } } };
  const t = tab({ data, locks: originLocks() });
  t.record();
  t.paint();
  await settle();
  assert.deepEqual(names(data), [`canvas:${ORIGIN}/5`, `canvas:${ORIGIN}/6`, 'other:1']);
  assert.equal(data.seenCourses[`canvas:${ORIGIN}/6`].color, '#010203', 'the colour the student picked');
  assert.deepEqual([...new Set(t.asked)], ['glaze:seenCourses']);
});

test('without Web Locks the page still orders its own two writes', async () => {
  const data = { seenCourses: { [`canvas:${ORIGIN}/6`]: { name: 'Art', color: '#ffffff' } } };
  const t = tab({ data });
  t.record();
  t.paint();
  await settle();
  assert.deepEqual(names(data), [`canvas:${ORIGIN}/5`, `canvas:${ORIGIN}/6`]);
  assert.equal(data.seenCourses[`canvas:${ORIGIN}/6`].color, '#010203');
});
