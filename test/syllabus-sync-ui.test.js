// ACA-3, as the student does it: features/syllabus.js on a stand-in Canvas page, talking to the real background worker
// (lib/background.js 'glaze:syllabus' and 'glaze:todo') over in-memory storage. A syllabus date is saved to To Do, then
// edited, removed or read again, and what To Do holds is checked each time.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { El } = require('./stand-in-dom.js');
const workerEnv = require('./helpers/worker-env.cjs');
const S = require('../lib/syllabus.js');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const settle = async (n = 30) => { for (let i = 0; i < n; i++) await new Promise(setImmediate); };
const ORIGIN = 'https://school.instructure.com';
const TODO = `todo:${ORIGIN}/3`;
const KEPT = `syllabus:${ORIGIN}/3/25`;

const stage = async (local = {}) => {
  const w = workerEnv({ store: { sync: { version: 2, enabled: true, enhance: {} }, local: structuredClone(local), session: {} } });
  const sender = { id: 'glaze', tab: { id: 1, url: `${ORIGIN}/courses/25` }, frameId: 0, url: `${ORIGIN}/courses/25` };
  const doc = { activeElement: null };
  // The stand-in element, with what the page's own inputs answer: files, and the type as an attribute.
  class Elx extends El {
    constructor(tag) { super(tag, doc); this.files = []; }
    getAttribute(k) { return k === 'type' && this.type ? this.type : super.getAttribute(k); }
  }
  const body = new Elx('body');
  doc.root = body;
  const home = new Elx('div');
  home.id = 'course_home_content';
  body.append(home);
  let now = Date.UTC(2026, 9, 1);
  class Clock extends Date { static now() { return (now += 1000); } }
  const ctx = vm.createContext({
    Intl, Date: Clock, JSON, Promise, Math, Number, String, Object, Array, Error, File, AbortController, confirm: () => true,
    document: { body, get activeElement() { return doc.activeElement; }, createElement: (t) => new Elx(t), getElementById: (id) => body.all().find((e) => e.id === id) || null, querySelector: () => null },
    location: { origin: ORIGIN, pathname: '/courses/25' },
    chrome: {
      runtime: { sendMessage: (m, cb) => { w.send(m, sender).then(cb); } },
      storage: { local: { get: (k, cb) => cb(Object.fromEntries([].concat(k).filter((x) => x in w.store.local).map((x) => [x, structuredClone(w.store.local[x])]))) }, onChanged: { addListener() {} } },
    },
    GZ_I18N: require('../lib/i18n.js'),
    GZ_CTX: {
      t: (k, v) => String(k).replace(/\{(\w+)\}/g, (_, n) => v?.[n] ?? ''), locale: () => 'en', settings: () => ({ enabled: true, enhance: { syllabus: true, todo: true } }), on: () => true, canvasCourseId: () => '25',
      profile: () => Promise.resolve({ id: 3 }), canvasCourses: () => Promise.resolve([{ id: '25' }]),
      need: async (file, ready) => { if (!ready()) vm.runInContext(read(file), ctx); },
    },
  });
  vm.runInContext(read('features/syllabus.js'), ctx);
  const UI = ctx.GZ_SYL_UI;
  UI.sync(true);
  await settle();

  const button = (root, text) => root.all().find((e) => e.tagName === 'BUTTON' && e.textContent === text);
  const click = (el) => el.dispatchEvent({ type: 'click', isTrusted: true, preventDefault() {} });
  const dialog = () => body.children.find((c) => c.tagName === 'DIALOG');
  const rows = () => dialog().querySelectorAll('.gz-syl-date');
  const set = (r, f) => {
    if ('title' in f) r.querySelector('.gz-syl-label').value = f.title;
    if ('day' in f) r.querySelector('input[type="date"]').value = f.day;
    if ('tick' in f) r.querySelector('.gz-syl-task').checked = f.tick;
  };
  const save = async () => { click(button(dialog(), 'Save')); await settle(); };
  return {
    w, rows, set, save, click, button, dialog,
    // "Import a syllabus", the text pasted, read, and the review on screen.
    async paste(text) {
      UI.open();
      await settle();
      dialog().querySelector('#gz-syl-paste').value = text;
      click(button(dialog(), 'Read it'));
      await settle();
    },
    // The kept card's Edit, and the review of what is kept on screen.
    async edit() { click(button(home, 'Edit')); await settle(); },
    tasks: () => (w.store.local[TODO]?.tasks || []).map((x) => [x.title, x.due.day, x.done ? 'done' : 'open']),
    kept: () => w.store.local[KEPT],
    open: () => !!dialog()?.open,
  };
};

const MIDTERM = 'Midterm exam: October 12, 2026';

test('a date moved in "Edit your syllabus" and saved again moves its To Do task: one task, not two', async () => {
  const s = await stage();
  await s.paste(MIDTERM);
  assert.equal(s.rows().length, 1);
  s.set(s.rows()[0], { tick: true });
  await s.save();
  assert.deepEqual(s.tasks(), [['Midterm exam', '2026-10-12', 'open']]);
  assert.equal(s.open(), false, 'saved and closed');
  await s.edit();
  s.set(s.rows()[0], { day: '2026-10-14', tick: true });
  await s.save();
  assert.deepEqual(s.tasks(), [['Midterm exam', '2026-10-14', 'open']], 'the same task, on the new day');
  assert.equal(s.kept().dates[0].day, '2026-10-14');
});

test('a date edited without ticking Add to To Do again still moves the task it made, keeping its steps and whether it is done', async () => {
  const s = await stage();
  await s.paste(MIDTERM);
  s.set(s.rows()[0], { tick: true });
  await s.save();
  const id = s.w.store.local[TODO].tasks[0].id;
  Object.assign(s.w.store.local[TODO].tasks[0], { done: 5000 });
  s.w.store.local[TODO].items = { [`task:${id}`]: { subs: [{ id: 's1', title: 'Review chapter 3', done: false }] } };
  await s.edit();
  s.set(s.rows()[0], { title: 'Midterm exam 1', day: '2026-10-14' });
  await s.save();
  assert.deepEqual(s.tasks(), [['Midterm exam 1', '2026-10-14', 'done']]);
  assert.equal(s.w.store.local[TODO].items[`task:${id}`].subs[0].title, 'Review chapter 3');
});

test('a date taken out of the record takes its task, unless the student has done it', async () => {
  const s = await stage();
  await s.paste('Midterm exam: October 12, 2026\nFinal exam: December 14, 2026\nPaper due: November 20, 2026');
  assert.equal(s.rows().length, 3);
  for (const r of s.rows()) s.set(r, { tick: true });
  await s.save();
  assert.equal(s.tasks().length, 3);
  const mid = s.w.store.local[TODO].tasks.find((x) => x.title === 'Midterm exam');
  Object.assign(s.w.store.local[TODO].tasks.find((x) => x.title === 'Final exam'), { done: 9000 });
  await s.edit();
  for (const r of s.rows().filter((r) => ['Midterm exam', 'Final exam'].includes(r.querySelector('.gz-syl-label').value))) s.click(s.button(r, '×'));
  assert.equal(s.rows().length, 1, 'two rows taken out');
  await s.save();
  assert.deepEqual(s.tasks().sort(), [['Final exam', '2026-12-14', 'done'], ['Paper due', '2026-11-20', 'open']], 'the open one goes; the done one and the kept date\'s stay');
  assert.ok(!s.w.store.local[TODO].tasks.some((x) => x.id === mid.id));
});

test('a syllabus read again with a date moved leaves one task for it; the same date again keeps the task as it was', async () => {
  const s = await stage();
  await s.paste(`${MIDTERM}\nFinal exam: December 14, 2026`);
  for (const r of s.rows()) s.set(r, { tick: true });
  await s.save();
  const final = s.w.store.local[TODO].tasks.find((x) => x.title === 'Final exam');
  Object.assign(final, { done: 7000 });
  // The professor moved the midterm; the student reads the new file and ticks the dates again.
  await s.paste('Midterm exam: October 14, 2026\nFinal exam: December 14, 2026');
  for (const r of s.rows()) s.set(r, { tick: true });
  await s.save();
  assert.deepEqual(s.tasks().sort(), [['Final exam', '2026-12-14', 'done'], ['Midterm exam', '2026-10-14', 'open']], 'no task left on October 12');
  assert.equal(s.w.store.local[TODO].tasks.find((x) => x.title === 'Final exam').id, final.id, 'the date that did not change is the task it was');
});

test('a record kept before dates had ids: editing a date moves the task the earlier version made', async () => {
  const old = { title: 'Midterm exam', day: '2026-10-12', kind: 'exam' };
  const id = S.taskId('25', old); // the earlier version's: made from the day and title
  const s = await stage({
    [KEPT]: { prof: { name: 'Dr. Okafor' }, dates: [old], at: 1000 },
    [TODO]: { tasks: [{ id, title: 'Midterm exam', cid: '25', due: { day: '2026-10-12' }, notes: 'From your syllabus', done: 0, at: 1 }], items: {} },
  });
  await s.edit();
  s.set(s.rows()[0], { day: '2026-10-14' });
  await s.save();
  assert.deepEqual(s.tasks(), [['Midterm exam', '2026-10-14', 'open']]);
  assert.equal(s.w.store.local[TODO].tasks[0].id, id, 'the same task');
  assert.match(s.kept().dates[0].id, /^[a-z\d]+$/, 'and the row has its id from now on');
});

test('a date added in the review gets an id of its own, and its task is made once', async () => {
  const s = await stage();
  await s.paste(MIDTERM);
  s.click(s.dialog().all().find((e) => e.tagName === 'BUTTON' && e.attrs['aria-label'] === 'Add: Important dates'));
  assert.equal(s.rows().length, 2);
  s.set(s.rows()[0], { tick: true });
  s.set(s.rows()[1], { title: 'Lab report', day: '2026-11-02', tick: true });
  await s.save();
  assert.deepEqual(s.tasks().sort(), [['Lab report', '2026-11-02', 'open'], ['Midterm exam', '2026-10-12', 'open']]);
  const ids = s.kept().dates.map((d) => d.id);
  assert.equal(new Set(ids).size, 2, 'each row has its own');
  await s.edit();
  s.set(s.rows()[1], { day: '2026-11-04', tick: true });
  await s.save();
  assert.deepEqual(s.tasks().sort(), [['Lab report', '2026-11-04', 'open'], ['Midterm exam', '2026-10-12', 'open']]);
  assert.deepEqual(s.kept().dates.map((d) => d.id), ids, 'saving again keeps the ids');
});
