// Owner, 2026-10-20: starter Dashboards and settings in the dock supersede the 2026-10-19 empty default.
const test = require('node:test');
const assert = require('node:assert/strict');
const W = require('../lib/widgets.js');
const S = require('../lib/sidebar.js');
const starter = ['pet', 'timer', 'notes', 'quotes'];
const fresh = () => W.fresh();
const cards = (lms) => Array.from({ length: 6 }, (_, i) => `course:https://school.test/${lms === 'canvas' ? i + 1 : `_${i + 1}_1`}`);
const fill = (lms) => ({ fill: lms === 'canvas' ? 'cdash' : 'dash', ops: cards(lms).map((id) => ({ s: lms === 'canvas' ? 'cdash' : 'dash', id, set: { on: true, term: 'Fall', size: 's' } })) });
for (const [lms, board] of [['canvas', 'cdash'], ['ultra', 'dash']]) {
  test(`fresh ${lms}: cards share the Dashboard with starter widgets; settings follows To Do in the dock`, () => {
    const lay = W.apply(fresh(), fill(lms)), rec = S.migrate(lay, null, { lms });
    const at = S.resolve(lay, rec, { site: lms, board });
    assert.equal(lay.boards[board].find((x) => x.id === 'pet').h, 330, 'the starter habitat has room to show the pet');
    assert.deepEqual(lay.boards[board].filter((x) => x.on && !W.course(x.id) && x.id !== 'todo').map((x) => x.id), starter);
    for (const id of [...starter, ...cards(lms)]) assert.equal(at.get(id).where, 'board', id);
    assert.deepEqual(S.docked(rec).map((x) => x.id), ['todo', 'settings']);
    assert.deepEqual(W.layout(lay), lay, 'reading the stored seed is idempotent');
    assert.deepEqual(S.migrate(lay, rec, { lms }), rec, 'migration is idempotent');
  });
  test(`${lms}: removed defaults and an emptied Dashboard never return`, () => {
    let lay = W.apply(fresh(), fill(lms));
    const rec = S.apply(S.migrate(lay, null, { lms }), [{ op: 'remove', id: 'settings' }], { lms, lay });
    lay = W.apply(lay, { ops: lay.boards[board].map(({ id }) => ({ s: board, id, set: { on: false } })) });
    assert.deepEqual(W.apply(W.layout(lay), fill(lms)), lay);
    assert.ok(!lay.boards[board].some((x) => x.on));
    assert.equal(S.migrate(lay, rec, { lms }).dest.settings, 'off');
    const early = W.apply(fresh(), { ops: [{ s: board, id: 'quotes', set: { on: false } }] });
    assert.deepEqual(W.apply(early, fill(lms)), early, 'an edit before courses load also opts out');
  });
  test(`${lms}: existing layouts and deliberately empty boards keep their choices`, () => {
    for (const raw of [W.kept(true), { ...W.kept(true), sidebarFresh: true }, { todo: true, canvasTodo: true, filled: ['cdash'], boards: { courses: [], dash: [], cdash: [] }, tiles: W.TILES.map((id) => ({ id, on: false })) }]) {
      const lay = W.layout(raw), rec = S.migrate(lay, null, { lms });
      assert.deepEqual(W.apply(lay, fill(lms)), lay);
      assert.equal(rec.dest.settings, undefined);
      assert.deepEqual(S.migrate(lay, rec, { lms }), rec);
    }
  });
}
test('settings can move, be removed and be re-added with its dock configuration intact', () => {
  const lay = fresh();
  let rec = S.migrate(lay, null, { lms: 'canvas' });
  rec = S.apply(rec, [{ op: 'fold', id: 'settings', v: true }, { op: 'move', id: 'settings', by: -1 }, { op: 'remove', id: 'settings' }], { lms: 'canvas', lay });
  assert.equal(S.resolve(lay, rec, { site: 'canvas', board: 'cdash' }).get('settings').where, 'off');
  rec = S.apply(rec, [{ op: 'dock', id: 'settings' }], { lms: 'canvas', lay });
  assert.deepEqual(S.docked(rec).map((x) => x.id), ['settings', 'todo']);
  assert.equal(S.docked(rec)[0].fold, true);
});
test('responsive card rows fill the available room, align below starters and retain saved placements', () => {
  const lay = W.apply(fresh(), fill('canvas')), list = lay.boards.cdash.filter((x) => x.on && x.id !== 'todo');
  const dims = Object.fromEntries(list.map((x) => [x.id, { w: 288, h: starter.includes(x.id) ? 270 : 310 }]));
  for (const vw of [1800, 1440, 1280, 1024]) for (const reserved of [0, 368]) for (const min of [200, 262, 420]) {
    const width = vw - 220 - reserved, gap = 16;
    const res = W.arrange(list, dims, width, { cards: { width: min, gap } });
    const row = cards('canvas').map((id) => res.at[id]).filter((x, _, all) => x.top === all[0].top);
    const cols = Math.max(1, Math.floor((width + gap) / (min + gap)));
    assert.equal(row.length, Math.min(cols, 6));
    assert.equal(row[0].left, 0);
    if (row.length === cols) assert.ok(Math.abs(row.at(-1).left + row.at(-1).w - width) < 0.01);
    assert.ok(row[0].top >= Math.max(...starter.map((id) => res.at[id].top + res.at[id].h)) + gap);
    for (let i = 1; i < row.length; i++) assert.ok(Math.abs(row[i].left - row[i - 1].left - row[i - 1].w - gap) < 0.01);
  }
  const courses = list.filter((x) => W.course(x.id));
  const area = { left: 24, top: 80, width: 960 };
  const res = W.arrange(courses, dims, 1000, { col: { right: 0, top: 0 }, courseArea: area, cards: { width: 262, gap: 16 } });
  assert.equal(res.at[courses[0].id].left, area.left);
  assert.equal(res.at[courses[0].id].top, area.top);
  assert.equal(res.at[courses[2].id].left + res.at[courses[2].id].w, area.left + area.width);
  const placed = list.map((x, i) => ({ ...x, x: i * 16, y: i * 32 }));
  assert.deepEqual(W.arrange(placed, dims, 1400, { cards: { width: 262, gap: 16 } }), W.arrange(placed, dims, 1400));
});

test('fresh navigation yields to saved navigation arriving later without writing sync', () => {
  const N = require('../lib/navbar.js');
  assert.deepEqual(N.initial(undefined, undefined, true).glaze, ['settings']);
  assert.deepEqual(N.initial(undefined, { hidden: ['course'] }, true).glaze, []);
  assert.deepEqual(N.initial({ glaze: [] }, undefined, true).glaze, []);
  assert.deepEqual(N.initial(undefined, undefined, false).glaze, []);
});

test('responsive rows respect a card resized before placement and never allocate rows to absent renderers', () => {
  const list = cards('canvas').map((id) => ({ id, x: null, w: 420 }));
  const dims = Object.fromEntries(list.map((x) => [x.id, { w: x.w, h: 300 }]));
  const res = W.arrange(list, dims, 1200, { cards: { width: 262, gap: 16 } });
  assert.equal(res.at[list[0].id].w, 420, 'saved per-card width wins over automatic sizing');
  const unavailable = [...starter.map((id) => ({ id, x: null })), ...list.map(({ id }) => ({ id, x: null }))];
  const shown = W.arrange(unavailable, dims, 1200, { cards: { width: 262, gap: 16 } });
  assert.equal(shown.at[list[0].id].top, 0, 'unavailable utilities reserve no empty rows');
});

test('automatic card rows begin at the reading edge in RTL', () => {
  const list = cards('canvas').map((id) => ({ id, x: null }));
  const dims = Object.fromEntries(list.map((x) => [x.id, { w: 262, h: 300 }]));
  const res = W.arrange(list, dims, 1000, { cards: { width: 262, gap: 16 }, rtl: true });
  assert.equal(res.at[list[0].id].left + res.at[list[0].id].w, 1000);
  assert.ok(res.at[list[1].id].left < res.at[list[0].id].left);
});

test('initial feature choices are local fallbacks and saved switches arriving through sync win', () => {
  const D = require('../defaults.js'), raw = { enhance: { todo: false } };
  const before = structuredClone(raw);
  const initial = D.GZ_SANITIZE(raw, true);
  assert.equal(initial.enhance.notes, true);
  assert.equal(initial.enhance.pet, true);
  assert.deepEqual(raw, before, 'reading defaults never writes a synced preference');
  assert.equal(initial.enhance.todo, false);
  const synced = D.GZ_SANITIZE({ enhance: { notes: false, pet: false } }, true);
  assert.equal(synced.enhance.notes, false);
  assert.equal(synced.enhance.pet, false);
  assert.equal(D.GZ_SANITIZE(raw).enhance.notes, false, 'an existing install keeps its original default');
  assert.ok(!W.layout().boards.dash.some((t) => t.id === 'pet' && t.on), 'missing layout storage does not authorize a seed');
});

test('an explicitly empty saved board stays empty when normalized, without requiring off entries for every widget', () => {
  const saved = { tiles: [], boards: { courses: [], dash: [], cdash: [] }, todo: true, canvasTodo: true, filled: ['dash', 'cdash'] };
  const read = W.layout(saved);
  assert.ok(!read.tiles.some((t) => t.on));
  for (const board of W.BOARDS) assert.ok(!read.boards[board].some((t) => t.on), board);
  assert.deepEqual(W.apply(read, fill('canvas')), read);
  assert.deepEqual(W.apply(read, fill('ultra')), read);
  assert.deepEqual(W.layout({ tiles: [], todo: true, canvasTodo: true }).boards.dash.filter((t) => t.on).map((t) => t.id),
    ['notes', 'agenda', 'timer', 'quotes', 'todo'], 'an unspecified legacy Dashboard keeps its historical defaults');
});

test('a stale automatic fill cannot add cards to an existing unfilled board without install authority', () => {
  const saved = { todo: true, canvasTodo: true, filled: [], tiles: W.TILES.map((id) => ({ id, on: false })),
    boards: Object.fromEntries(W.BOARDS.map((b) => [b, W.TILES.map((id) => ({ id, on: false }))])) };
  const lay = W.layout(saved);
  assert.deepEqual(W.apply(lay, fill('canvas')), lay);
  assert.deepEqual(W.apply(lay, fill('ultra')), lay);
});

test('a delayed settings read cannot replace a newer install or sync snapshot', async () => {
  const fs = require('node:fs'), vm = require('node:vm'), D = require('../defaults.js');
  const source = fs.readFileSync(require.resolve('../content.js'), 'utf8');
  const part = source.slice(source.indexOf('  let lookX;'), source.indexOf('  // The previous palette covers storage latency'));
  for (const initial of [false, true]) {
    const sync = [], local = [];
    const load = vm.runInNewContext(`${part}\nload;`, { GZ_DEFAULTS: D.GZ_DEFAULTS, GZ_SANITIZE: D.GZ_SANITIZE, sessionStorage: { setItem() {} },
      chrome: { runtime: {}, storage: { sync: { get: (_, cb) => sync.push(cb) }, local: { get: (_, cb) => local.push(cb) } } } });
    const older = load(), newer = load();
    sync[1](initial ? {} : { enhance: { notes: false } }); local[1]?.({ freshDefaults: { fresh: true } });
    const latest = await newer;
    sync[0](initial ? {} : { enhance: { notes: true } }); local[0]?.({});
    const late = await older;
    assert.equal(late.enhance.notes, latest.enhance.notes, 'the last completed callback cannot revive an older preference');
    assert.equal(late.enhance.notes, initial);
  }
});
