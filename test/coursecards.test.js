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
const page = ({ more = {}, ctxMore = {} } = {}) => {
  let writes = 0, enabled = true, color = { color: '#ffe12b', own: true }, peek = { me: null, courses: null, books: new Map() };
  const reads = [], renders = [], waiting = [], local = {}, listeners = [];
  const doc = { createElement: (tag) => {
    const el = new El(tag, doc), props = {};
    el.style = { getPropertyValue: (k) => props[k] || '', setProperty: (k, v) => { props[k] = String(v); writes++; }, removeProperty: (k) => { delete props[k]; writes++; } };
    return el;
  }, querySelectorAll: () => [] };
  const settings = D.GZ_SANITIZE({ enhance: { cardTasks: true, overall: true, coursemenu: true } });
  const ctx = { site: 'ultra', on: () => enabled, t: (s) => s, locale: () => 'en', nickOf: () => '', courseList: () => ({ _101_1: { name: 'Biology', site: 'https://bb.test', slot: '3' } }), courseColors: () => ({ _101_1: color }), canvasPeek: () => peek, settings: () => settings,
    need: (file) => { assert.ok(['lib/todo.js', 'features/cards.js', 'features/cardtasks.js'].includes(file), `unexpected reader ${file}`); return file === 'features/cardtasks.js' ? new Promise((r) => waiting.push(r)) : Promise.resolve(); }, ...ctxMore };
  const c = { GZ_CTX: ctx, GZ_WIDGETS: W, GZ_SANITIZE: D.GZ_SANITIZE, GZ_COURSE_VARS: D.GZ_COURSE_VARS, GZ_TODO: { clean: (v) => v || {}, gradescope: () => () => [] }, GZ_CARD_UI: { paint() {} }, GZ_CARD_TASKS: { render: (...args) => renders.push(args) }, document: doc, location: { origin: 'https://bb.test' }, chrome: { runtime: { id: 'x' }, storage: { local: { get: (keys, cb) => reads.push(() => cb(local)) }, sync: { get: (keys, cb) => cb({}) }, onChanged: { addListener: (f) => listeners.push(f) } } }, URL, console, ...more };
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

// ---- a Look's card rules on the board's cards (lib/parts.js names each piece, features/rules.js wears them) ----
const P = require('../lib/parts.js');
const tileOf = (doc) => { const tile = doc.createElement('section'), body = doc.createElement('div'); tile.className = 'gz-w'; body.className = 'gz-w-body'; tile.append(body); return { tile, body }; };

test("Ultra: each course-card part's board piece is in the card the board draws, and only there", async () => {
  const p = page(), { tile, body } = tileOf(p.body.doc);
  p.mount(body); await settle();
  const card = body.querySelector('article.gz-course-card');
  const want = { 'ultra.course-card': card, 'ultra.course-card.banner': card.querySelector('.course-banner'), 'ultra.course-card.title': card.querySelector('a.course-title'), 'ultra.course-card.id': card.querySelector('.course-id') };
  for (const [name, el] of Object.entries(want)) { assert.ok(P.get(name).b, `${name} names a board piece`); assert.deepEqual(tile.querySelectorAll(P.get(name).b), [el], name); }
  for (const name of ['ultra.course-card.status', 'ultra.course-card.instructors']) assert.equal(P.get(name).b, '', `${name}: no such piece on a board card`);
  // The Course cards dialog's small copies are not the board's cards.
  const preview = p.body.doc.createElement('article');
  preview.className = 'gz-course-card'; preview.setAttribute('data-gz-card-preview', '');
  const pick = p.body.doc.createElement('label'); pick.className = 'gz-ccm-pick'; pick.append(preview);
  assert.deepEqual(pick.querySelectorAll(P.get('ultra.course-card').b), []);
});

test("Canvas: each dashboard-card part's board piece is in the card the board draws", () => {
  const doc = { createElement: (tag) => { const el = new El(tag, doc); el.style = {}; return el; }, querySelectorAll: () => [] };
  const ctx = { site: 'canvas', on: () => true, t: (s) => s, nickOf: () => '', settings: () => D.GZ_SANITIZE({}), courseList: () => ({ 'canvas:https://canvas.test/27': { name: 'Calculus I', code: 'MATH 1350', canvas: true } }),
    canvasCourses: () => new Promise(() => {}), need: () => Promise.resolve() };
  const ui = vm.runInNewContext(fs.readFileSync(require.resolve('../features/coursecards.js'), 'utf8'), { GZ_CTX: ctx, GZ_WIDGETS: W, GZ_SANITIZE: D.GZ_SANITIZE, GZ_COURSE_VARS: D.GZ_COURSE_VARS,
    GZ_CARD_UI: { paint() {} }, document: doc, location: { origin: 'https://canvas.test' }, chrome: { runtime: { id: 'x' }, storage: { onChanged: { addListener() {} } } }, URL, console });
  ui.sync();
  const { tile, body } = tileOf(doc);
  ui.fill(body, { id: 'course:https://canvas.test/27', term: () => '' });
  const card = body.querySelector('.ic-DashboardCard');
  const want = { 'canvas.dashboard-card': card, 'canvas.dashboard-card.image': card.querySelector('.ic-DashboardCard__header_image'), 'canvas.dashboard-card.title': card.querySelector('h2'),
    'canvas.dashboard-card.subtitle': card.querySelector('.ic-DashboardCard__header-subtitle'), 'canvas.dashboard-card.term': card.querySelector('.ic-DashboardCard__header-term') };
  for (const [name, el] of Object.entries(want)) { assert.ok(P.get(name).b, `${name} names a board piece`); assert.deepEqual(tile.querySelectorAll(P.get(name).b), [el], name); }
  assert.equal(P.get('canvas.dashboard-card.menu').b, '', "Canvas's menu button: the board card has Glaze's instead");
});

test("a Look's label on a board card stays: the board writes its text only when the real one changed, then asks the rules back", async () => {
  const rules = { syncs: 0, real: new Map() };
  const p = page({ more: { GZ_RULES: { real: (el) => (rules.real.has(el) ? rules.real.get(el) : el.textContent), sync: () => { rules.syncs++; } } } });
  await settle();
  assert.ok(rules.syncs > 0, 'a mounted card asks for the rules');
  const link = p.body.querySelector('a.course-title');
  assert.equal(link.textContent, 'Biology');
  link.textContent = 'Renamed'; rules.real.set(link, 'Biology'); // what features/rules.js leaves: its label over the real name
  const before = rules.syncs;
  p.tile.update(); p.ui.sync(); await settle();
  assert.equal(link.textContent, 'Renamed', 'the label stays');
  assert.equal(rules.syncs, before, 'nothing written, so no extra rules pass');
  rules.real.set(link, 'Botany'); // the name under the label is no longer the course's
  p.tile.update(); await settle();
  assert.equal(link.textContent, 'Biology');
  assert.ok(rules.syncs > before, 'a write asks the rules to put the label back');
});

test("a nickname on a board card is marked as one, so a Look's label leaves it (as on Ultra's own cards)", async () => {
  let nick = 'Bio (mine)';
  const p = page({ ctxMore: { nickOf: () => nick } });
  await settle();
  const link = p.body.querySelector('a.course-title');
  assert.equal(link.textContent, 'Bio (mine)');
  assert.equal(link.getAttribute('data-gz-nick'), '');
  nick = '';
  p.tile.update();
  assert.equal(link.textContent, 'Biology');
  assert.equal(link.getAttribute('data-gz-nick'), null);
});

test('a course renamed to the visible Look label still replaces the underlying name', async () => {
  let courseName = 'Biology', labelled;
  const p = page({ ctxMore: { courseList: () => ({ _101_1: { name: courseName, site: 'https://bb.test' } }) },
    more: { GZ_RULES: { real: (el) => el === labelled ? 'Biology' : el.textContent, sync() {} } } });
  await settle();
  labelled = p.body.querySelector('a.course-title');
  labelled.textContent = 'Botany';
  const oldNode = labelled.children[0];
  courseName = 'Botany'; p.ui.sync(); await settle();
  assert.notEqual(labelled.children[0], oldNode, 'replace the labelled node so removing the Look cannot restore Biology');
});

test('nickname changes reconcile a label even when the nickname equals its underlying name', async () => {
  let nick = '', labelled, syncs = 0;
  const p = page({ ctxMore: { nickOf: () => nick }, more: { GZ_RULES: {
    real: (el) => el === labelled ? 'Biology' : el.textContent, sync: () => { syncs++; },
  } } });
  await settle();
  labelled = p.body.querySelector('a.course-title'); labelled.textContent = 'Renamed';
  const before = syncs;
  nick = 'Biology'; p.tile.update(); await settle();
  assert.ok(syncs > before, 'the nickname marker must trigger rules even when no text changes');
});

test('Ultra board metadata reads native course text beneath Look labels', async () => {
  const title = { textContent: 'From the Look' }, code = { textContent: 'Labelled code' };
  const p = page({ more: { GZ_RULES: { real: (el) => el === title ? 'Botany' : el === code ? 'BIO-101' : el.textContent, sync() {} } } });
  await settle();
  p.body.doc.querySelectorAll = () => [{ dataset: { courseId: '_101_1' }, closest: () => null, querySelectorAll: () => [],
    querySelector: (selector) => selector.includes('course-title') ? title : selector === '.course-id' ? code : null }];
  p.ui.sync(); await settle();
  assert.equal(p.ui.list()[0].name, 'Botany', 'Look labels must not become course metadata');
  assert.equal(p.ui.list()[0].code, 'BIO-101');
  assert.equal(p.body.querySelector('a.course-title').title, 'Botany · BIO-101');
});
