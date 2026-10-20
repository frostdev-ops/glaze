// Board cards consume existing promises/storage only. No reader is available in this synthetic page.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const D = require('../defaults.js');
const W = require('../lib/widgets.js');
const { El } = require('./stand-in-dom.js');
const settle = async () => { for (let i = 0; i < 10; i++) await new Promise(setImmediate); };
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r; }); return { promise, resolve }; };
const page = () => {
  let writes = 0, enabled = true, color = { color: '#ffe12b', own: true }, peek = { me: null, courses: null, books: new Map() };
  const reads = [], renders = [], waiting = [], local = {}, listeners = [];
  const doc = { createElement: (tag) => {
    const el = new El(tag, doc), props = {};
    el.style = { getPropertyValue: (k) => props[k] || '', setProperty: (k, v) => { props[k] = String(v); writes++; }, removeProperty: (k) => { delete props[k]; writes++; } };
    return el;
  }, querySelectorAll: () => [] };
  const settings = D.GZ_SANITIZE({ enhance: { cardTasks: true, overall: true, coursemenu: true } });
  const ctx = { site: 'ultra', on: () => enabled, t: (s) => s, locale: () => 'en', nickOf: () => '', courseList: () => ({ _101_1: { name: 'Biology', site: 'https://bb.test', slot: '3' } }), courseColors: () => ({ _101_1: color }), canvasPeek: () => peek, settings: () => settings,
    need: (file) => { assert.ok(['lib/todo.js', 'features/cards.js', 'features/cardtasks.js'].includes(file), `unexpected reader ${file}`); return file === 'features/cardtasks.js' ? new Promise((r) => waiting.push(r)) : Promise.resolve(); } };
  const c = { GZ_CTX: ctx, GZ_WIDGETS: W, GZ_SANITIZE: D.GZ_SANITIZE, GZ_COURSE_VARS: D.GZ_COURSE_VARS, GZ_TODO: { clean: (v) => v || {}, gradescope: () => () => [] }, GZ_CARD_UI: { paint() {} }, GZ_CARD_TASKS: { render: (...args) => renders.push(args) }, document: doc, location: { origin: 'https://bb.test' }, chrome: { runtime: { id: 'x' }, storage: { local: { get: (keys, cb) => reads.push(() => cb(local)) }, sync: { get: (keys, cb) => cb({}) }, onChanged: { addListener: (f) => listeners.push(f) } } }, URL, console };
  const ui = vm.runInNewContext(fs.readFileSync(require.resolve('../features/coursecards.js'), 'utf8'), c);
  ui.sync();
  const mount = (body = doc.createElement('div')) => ui.fill(body, { id: 'course:https://bb.test/_101_1', term: () => '' });
  const body = doc.createElement('div'), tile = mount(body);
  return { ui, body, tile, mount, local, renders, waiting, reads, setPeek: (p) => { peek = p; ui.sync(); }, setColor: (v) => { color = v; tile.update(); }, answer: () => { while (reads.length) reads.shift()(); }, writes: () => writes, setEnabled: (v) => { enabled = v; }, settings, listeners };
};

test('board cards retain the native slot and clear a removed per-course colour override', async () => {
  const p = page(); await settle();
  const card = p.body.querySelector('.gz-course-card');
  assert.match(card.className, /course-color-3/);
  p.setColor({ color: '#123456', own: false, picked: true });
  assert.equal(card.style.getPropertyValue('--gz-pick'), '#123456');
  p.setColor({ color: '#ffe12b', own: true });
  assert.equal(card.style.getPropertyValue('--gz-pick'), '', 'the slot supplies the colour again');
  const before = p.writes(); p.tile.update(); p.ui.sync();
  assert.equal(p.writes(), before, 'an unchanged pass writes no styles');
});

test('board tasks use the known account cache and ignore old identity/storage answers', async () => {
  const p = page(), old = deferred(), next = deferred();
  p.local.todoCache = { key: 'todo:https://bb.test/_7_1', items: [{ title: 'Other student' }] };
  p.setPeek({ me: old.promise, courses: null, books: new Map() });
  p.setPeek({ me: next.promise, courses: null, books: new Map() });
  old.resolve('_7_1'); await settle();
  assert.equal(p.reads.length, 0, 'replaced identity cannot start a storage read');
  next.resolve('_8_1'); await settle(); p.answer(); await settle();
  assert.equal(p.waiting.length, 0, 'another account cache cannot render');
  p.local.todoCache = { key: 'todo:https://bb.test/_8_1', items: [] };
  p.listeners[0]({ todoCache: {} }, 'local'); p.answer(); await settle();
  assert.ok(p.waiting.length);
  p.settings.enhance.cardTasks = false;
  while (p.waiting.length) p.waiting.shift()(); await settle();
  assert.equal(p.renders.length, 0, 'a pending module load cannot restore tasks after their switch is off');
});

test('the first remounted card rereads tasks changed while the board was absent, once per batch', async () => {
  const p = page(), key = 'todo:https://bb.test/_8_1';
  p.local.todoCache = { key, items: [{ title: 'Before leaving' }] };
  p.setPeek({ me: Promise.resolve('_8_1'), courses: null, books: new Map() });
  await settle(); p.answer(); await settle(); p.tile.stop();
  p.local.todoCache = { key, items: [{ title: 'Changed on another page' }] };
  p.listeners[0]({ todoCache: {} }, 'local');
  assert.equal(p.reads.length, 0, 'no work while unmounted');
  p.mount(); p.mount();
  assert.equal(p.reads.length, 1, 'one stored-data refresh for the batch');
  p.answer(); await settle();
  while (p.waiting.length) p.waiting.shift()(); await settle();
  assert.equal(p.renders.at(-1)[4].cache.items[0].title, 'Changed on another page');
});

test("Canvas: a board's card is drawn as Canvas's own, from what its page shows, else its course list", async () => {
  const doc = { createElement: (tag) => { const el = new El(tag, doc); el.style = {}; return el; } };
  // Canvas's card view: one card with its nickname, code, term, color and picture (as test/fixtures' dashboard has it).
  const at = { '.ic-DashboardCard__header-title': 'Calc (mine)', '.ic-DashboardCard__header-subtitle': 'MATH 1350', '.ic-DashboardCard__header-term': 'Fall 2026' };
  const native = { querySelector: (sel) => sel === 'a[href*="/courses/"]' ? { getAttribute: () => '/courses/27' }
    : sel === '.ic-DashboardCard__header_hero' ? { style: { backgroundColor: 'rgb(23, 123, 99)' } }
      : sel === '.ic-DashboardCard__header_image' ? { style: { backgroundImage: 'url("https://canvas.test/courses/27/files/22/download?verifier=x")' } }
        : at[sel] ? { getAttribute: () => at[sel], textContent: at[sel] } : null };
  let shown = [native];
  doc.querySelectorAll = (sel) => (sel === '.ic-DashboardCard:not([data-gz-tile-card])' ? shown : []);
  const rows = deferred(), needs = [];
  const ctx = { site: 'canvas', on: () => true, t: (s) => s, nickOf: () => '', settings: () => D.GZ_SANITIZE({}),
    courseList: () => ({ 'canvas:https://canvas.test/31': { name: 'History', code: 'HIST 2010', canvas: true, color: '#aa3300' }, 'canvas:https://other.test/27': { name: 'Elsewhere' } }),
    canvasCourses: () => rows.promise, need: (f) => { needs.push(f); return Promise.resolve(); } };
  const c = { GZ_CTX: ctx, GZ_WIDGETS: W, GZ_SANITIZE: D.GZ_SANITIZE, GZ_COURSE_VARS: D.GZ_COURSE_VARS, GZ_CARD_UI: { paint() {} }, document: doc, location: { origin: 'https://canvas.test' },
    chrome: { runtime: { id: 'x' }, storage: { onChanged: { addListener() {} } } }, URL, console };
  const ui = vm.runInNewContext(fs.readFileSync(require.resolve('../features/coursecards.js'), 'utf8'), c);
  ui.sync();
  assert.deepEqual(JSON.parse(JSON.stringify(ui.list().map((x) => [x.key, x.name, x.term]))), [['course:https://canvas.test/27', 'Calc (mine)', 'Fall 2026'], ['course:https://canvas.test/31', 'History', '']], "this site's courses only, its cards' order first");
  const body = doc.createElement('div');
  const tile = ui.fill(body, { id: 'course:https://canvas.test/27', term: () => '' });
  const card = body.querySelector('.ic-DashboardCard');
  assert.ok(card.hasAttribute('data-gz-tile-card'), "marked as a board's, so it is never read as one of Canvas's own");
  assert.equal(card.querySelector('a.ic-DashboardCard__link').href, '/courses/27');
  assert.equal(card.getAttribute('aria-label'), 'Calc (mine)');
  assert.equal(card.querySelector('.ic-DashboardCard__header-subtitle').textContent, 'MATH 1350');
  assert.equal(card.querySelector('.ic-DashboardCard__header-term').textContent, 'Fall 2026');
  assert.equal(card.querySelector('.ic-DashboardCard__header_hero').style.backgroundColor, 'rgb(23, 123, 99)');
  assert.equal(card.querySelector('.ic-DashboardCard__header_image').style.backgroundImage, 'url("https://canvas.test/courses/27/files/22/download?verifier=x")');
  assert.deepEqual([...needs], ['features/cards.js'], 'no reader of its own: only the card painter');
  // List view (no cards on the page): the course list Canvas's page asked for.
  shown = [];
  rows.resolve([{ id: '27', name: 'Calculus I', course_code: 'MATH 1350', term: { name: 'Fall 2026' } }]);
  await settle();
  tile.update();
  assert.equal(card.querySelector('.ic-DashboardCard__header-title span').textContent, 'Calculus I');
  assert.equal(card.querySelector('.ic-DashboardCard__header-term').textContent, 'Fall 2026');
  assert.equal(card.querySelector('.ic-DashboardCard__header_image').style.backgroundImage, 'url("https://canvas.test/courses/27/files/22/download?verifier=x")', 'keep the last picture while native cards are absent');
  // A picture address that isn't one is never written into the style.
  shown = [{ querySelector: (sel) => sel === '.ic-DashboardCard__header_image' ? { style: { backgroundImage: 'url("javascript:x")' } } : native.querySelector(sel) }];
  ui.sync(); tile.update();
  assert.equal(card.querySelector('.ic-DashboardCard__header_image').style.backgroundImage, '');
  tile.stop();
});
