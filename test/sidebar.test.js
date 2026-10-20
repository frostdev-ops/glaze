// The sidebar's state (lib/sidebar.js): the record and its bounds, each change, the one-time move of To Do into the
// dock, where each widget goes (resolve) and how the page shows the sidebar (mode). Plus: a shared Look never carries
// the layout or the sidebar.
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../lib/sidebar.js');
const W = require('../lib/widgets.js');
const G = require('../defaults.js');
const share = require('../lib/share.js');

const CANVAS = 'https://school.instructure.com', ULTRA = 'https://bb.example.edu';
const ops = (rec, ...list) => S.apply(rec, list, { lms: 'canvas' });
const docked = (r) => S.docked(r).map((x) => x.id);

test('keys name a site and an account: Canvas or Ultra, https or local Canvas, no other shapes', () => {
  assert.equal(S.key('canvas', CANVAS, '42'), `sidebar:canvas:${CANVAS}/42`);
  assert.equal(S.key('ultra', ULTRA, '_9_1'), `sidebar:ultra:${ULTRA}/_9_1`);
  assert.equal(S.key('canvas', 'http://localhost:3000', '1'), 'sidebar:canvas:http://localhost:3000/1');
  for (const [l, o, u] of [['moodle', CANVAS, '1'], ['canvas', 'http://school.edu', '1'], ['canvas', CANVAS, 'x'], ['ultra', ULTRA, '_9'], ['canvas', `${CANVAS}/a`, '1'], ['canvas', CANVAS, '']]) assert.equal(S.key(l, o, u), null, `${l} ${o} ${u}`);
  assert.deepEqual(S.parse(`sidebar:ultra:${ULTRA}/_9_1`), { lms: 'ultra', origin: ULTRA, uid: '_9_1' });
  assert.equal(S.parse(`sidebar:ultra:${ULTRA}/_9_1/x`), null);
  assert.equal(S.parse(null), null);
  for (const [lms, uid] of [['canvas', '_9_1'], ['ultra', '42']]) {
    assert.equal(S.key(lms, CANVAS, uid), null, 'account ids belong to their LMS');
    assert.equal(S.parse(`sidebar:${lms}:${CANVAS}/${uid}`), null);
  }
});

test('clean gives a whole v1 record from anything, each field in its bounds and unknown ones dropped', () => {
  const d = S.clean(undefined);
  assert.deepEqual(d, { v: 1, rev: 0, mig: 0, on: true, width: 352, open: true, fold: {}, todoScope: 'follow', dock: [], dest: {}, ret: {}, offer: {} });
  assert.deepEqual(S.clean('x'), d);
  assert.deepEqual(S.clean([]), d);
  const r = S.clean({
    v: 7, rev: -3, mig: true, on: false, width: 9999, open: 0, extra: 1, todoScope: 'mine',
    fold: { dashboard: { page: true, widgets: 'no', x: 1 }, 'Bad Family': { page: true }, grades: 3 },
    dock: [{ id: 'todo', h: 20 }, { id: 'todo' }, { id: 'notes', h: 99999, fold: 1, gone: true }, { id: 'course:https://a/1' }, { id: 'timer', h: 300.4, fold: true }, null, 'x'],
    dest: { todo: 'dock', notes: 'gone', 'course:x': 'dock', constructor: 'off' },
    ret: { todo: { to: 'board', board: 'nope' }, timer: { to: 'float', board: 'cdash' }, notes: { to: 'sea' } },
    offer: { todo: 'later' },
  });
  assert.equal(r.v, 1); assert.equal(r.rev, 0); assert.equal(r.mig, 0); assert.equal(r.on, false); assert.equal(r.open, true);
  assert.equal(r.width, 480); assert.equal(S.clean({ width: 1 }).width, 288); assert.equal(S.clean({ width: 300.6 }).width, 301);
  assert.equal(r.todoScope, 'follow'); assert.equal(S.clean({ todoScope: 'all' }).todoScope, 'all');
  assert.ok(!('extra' in r));
  assert.deepEqual(r.fold, { dashboard: { page: true } });
  assert.deepEqual(r.dock, [{ id: 'todo', h: 48 }, { id: 'notes', gone: true, h: 3000 }, { id: 'timer', fold: true, h: 300 }]);
  assert.deepEqual(r.dest, { todo: 'dock', constructor: 'off' });
  assert.deepEqual(r.ret, { todo: { to: 'board' }, timer: { to: 'float' } });
  assert.deepEqual(r.offer, {});
  // Bounded lists: the dock, the overrides and the families.
  const many = Array.from({ length: 80 }, (_, i) => `w${i}`);
  const big = S.clean({ dock: many.map((id) => ({ id })), dest: Object.fromEntries(many.map((id) => [id, 'off'])), fold: Object.fromEntries(many.map((id) => [`f${id}`, { page: true }])) });
  assert.equal(big.dock.length, 24); assert.equal(Object.keys(big.dest).length, 64); assert.equal(Object.keys(big.fold).length, 32);
  assert.deepEqual(S.clean(S.clean(r)), S.clean(r), 'cleaning is stable');
});

test('malformed dock ids cannot occupy slots or resolve as widgets through string coercion', () => {
  const rec = S.clean({ dock: [{}, { id: null }, { id: ['notes'] }, { id: true }, { id: 'notes' }] });
  assert.deepEqual(rec.dock, [{ id: 'notes' }]);
  assert.deepEqual(S.clean(rec), rec);
});

test('each change: dock, fold, height, width, open, section, To Do scope, offer; malformed ops change nothing', () => {
  let r = ops(null, { op: 'dock', id: 'todo' }, { op: 'dock', id: 'notes' });
  assert.deepEqual(docked(r), ['todo', 'notes']);
  assert.deepEqual(r.dest, { todo: 'dock', notes: 'dock' });
  r = ops(r, { op: 'fold', id: 'notes', v: true }, { op: 'height', id: 'notes', h: 240 });
  assert.deepEqual(r.dock[1], { id: 'notes', fold: true, h: 240 });
  r = ops(r, { op: 'height', id: 'notes', h: null }, { op: 'fold', id: 'notes', v: false });
  assert.deepEqual(r.dock[1], { id: 'notes' });
  assert.equal(ops(r, { op: 'height', id: 'notes', h: 10 }).dock[1].h, 48);
  r = ops(r, { op: 'width', px: 400 }, { op: 'open', v: false }, { op: 'section', family: 'grades', part: 'page', v: true }, { op: 'section', family: 'grades', part: 'widgets', v: false }, { op: 'todoScope', v: 'all' });
  assert.equal(r.width, 400); assert.equal(r.open, false); assert.deepEqual(r.fold, { grades: { page: true, widgets: false } }); assert.equal(r.todoScope, 'all');
  assert.equal(ops(r, { op: 'width', px: 2000 }).width, 480);
  assert.equal(ops(r, { op: 'width', px: 100 }).width, 288);
  const before = structuredClone(r);
  for (const bad of [{ op: 'dock', id: 'course:https://a/1' }, { op: 'dock', id: 'Bad' }, { op: 'fold', id: 'notes', v: 'yes' }, { op: 'height', id: 'notes', h: 'tall' }, { op: 'width', px: 'wide' },
    { op: 'open', v: 1 }, { op: 'section', family: 'X!', part: 'page', v: true }, { op: 'section', family: 'grades', part: 'all', v: true }, { op: 'todoScope', v: 'some' },
    { op: 'undock', id: 'notes', to: 'sea' }, { op: 'undock', id: 'notes', to: 'board', board: 'courses' }, { op: 'move', id: 'notes', by: 3 }, { op: 'nope' }, { op: 'offer', v: 'dismissed' }, { op: 'migrate' }])
    assert.deepEqual(ops(r, bad), before, JSON.stringify(bad));
  assert.ok(S.ops([{ op: 'dock', id: 'todo' }]));
  for (const bad of [[], [{ op: 'eat' }], [null], 'dock', Array(33).fill({ op: 'open', v: true })]) assert.ok(!S.ops(bad), JSON.stringify(bad).slice(0, 40));
  // An offer pending (Ultra's boards disagreed) is dismissed, or answered by docking To Do.
  const pending = S.clean({ offer: { todo: 'pending' } });
  assert.deepEqual(ops(pending, { op: 'offer', v: 'dismissed' }).offer, { todo: 'dismissed' });
  assert.deepEqual(ops(pending, { op: 'dock', id: 'todo' }).offer, {});
});

test('reorder: up, down, before another, past the ends; gone widgets keep their place but are stepped over', () => {
  let r = ops(null, ...['a1', 'b1', 'c1', 'd1'].map((id) => ({ op: 'dock', id })));
  r = ops(r, { op: 'move', id: 'c1', by: -1 });
  assert.deepEqual(docked(r), ['a1', 'c1', 'b1', 'd1']);
  r = ops(r, { op: 'move', id: 'a1', by: 1 }, { op: 'move', id: 'd1', by: 1 }, { op: 'move', id: 'c1', by: -1 });
  assert.deepEqual(docked(r), ['c1', 'a1', 'b1', 'd1']);
  r = ops(r, { op: 'move', id: 'd1', to: 'c1' });
  assert.deepEqual(docked(r), ['d1', 'c1', 'a1', 'b1']);
  r = ops(r, { op: 'remove', id: 'c1' }, { op: 'move', id: 'a1', by: -1 });
  assert.deepEqual(docked(r), ['a1', 'd1', 'b1'], 'a removed widget is stepped over');
  assert.deepEqual(ops(r, { op: 'move', id: 'a1', to: 'c1' }), r, 'not before a removed one');
  assert.deepEqual(ops(r, { op: 'move', id: 'c1', by: 1 }), r, 'a removed one does not move');
  // Docked at a place among those shown.
  r = ops(r, { op: 'dock', id: 'e1', at: 1 });
  assert.deepEqual(docked(r), ['a1', 'e1', 'd1', 'b1']);
  r = ops(r, { op: 'dock', id: 'b1', at: 0 });
  assert.deepEqual(docked(r), ['b1', 'a1', 'e1', 'd1']);
});

test('removing or moving a widget out keeps its dock fold and height; docking it again restores them and its place', () => {
  let r = ops(null, { op: 'dock', id: 'notes' }, { op: 'dock', id: 'timer' }, { op: 'dock', id: 'agenda' }, { op: 'fold', id: 'timer', v: true }, { op: 'height', id: 'timer', h: 200 });
  r = ops(r, { op: 'remove', id: 'timer' });
  assert.equal(r.dest.timer, 'off'); assert.deepEqual(docked(r), ['notes', 'agenda']);
  assert.deepEqual(r.dock[1], { id: 'timer', gone: true, fold: true, h: 200 });
  r = ops(r, { op: 'dock', id: 'timer' });
  assert.deepEqual(docked(r), ['notes', 'timer', 'agenda']); assert.deepEqual(r.dock[1], { id: 'timer', fold: true, h: 200 });
  r = ops(r, { op: 'undock', id: 'timer', to: 'float' });
  assert.equal(r.dest.timer, 'float'); assert.deepEqual(docked(r), ['notes', 'agenda']);
  r = ops(r, { op: 'dock', id: 'timer' });
  assert.deepEqual(r.dock[1], { id: 'timer', fold: true, h: 200 });
  assert.equal(S.apply(r, [{ op: 'undock', id: 'notes', to: 'board', board: 'courses' }], { lms: 'ultra' }).dest.notes, 'board');
});

test('a resize or fold that arrives after a removal never brings the widget back', () => {
  let r = ops(null, { op: 'dock', id: 'notes' }, { op: 'remove', id: 'notes' });
  const after = ops(r, { op: 'height', id: 'notes', h: 300 }, { op: 'fold', id: 'notes', v: true });
  assert.deepEqual(after, r);
  assert.equal(after.dest.notes, 'off'); assert.deepEqual(docked(after), []);
  r = ops(null, { op: 'dock', id: 'notes' }, { op: 'undock', id: 'notes', to: 'board', board: 'cdash' });
  assert.deepEqual(ops(r, { op: 'height', id: 'notes', h: 300 }), r);
  assert.deepEqual(ops(null, { op: 'height', id: 'notes', h: 300 }), S.clean(null), 'never docked: nothing');
});

test('a full dock makes room by forgetting a removed widget, never one shown', () => {
  let r = ops(null, ...Array.from({ length: 24 }, (_, i) => ({ op: 'dock', id: `w${i}` })));
  assert.equal(r.dock.length, 24);
  assert.deepEqual(ops(r, { op: 'dock', id: 'zz' }), r, 'all shown: refused');
  r = ops(r, { op: 'remove', id: 'w3' }, { op: 'dock', id: 'zz' });
  assert.equal(r.dock.length, 24); assert.ok(!r.dock.some((x) => x.id === 'w3')); assert.equal(docked(r).at(-1), 'zz');
});

test('docking remembers where the widget was, for Move back; the layout is never changed', () => {
  const lay = W.apply(W.layout(), { ops: [{ s: 'cdash', id: 'notes', set: { on: true, x: 10, y: 20, w: 300 } }, { s: 'canvas', id: 'timer', set: { on: true, float: true, x: 0.5, y: 0.5 } }] });
  const keep = structuredClone(lay);
  let r = S.apply(null, [{ op: 'dock', id: 'notes' }, { op: 'dock', id: 'timer' }, { op: 'dock', id: 'agenda' }], { lms: 'canvas', lay });
  assert.deepEqual(r.ret, { notes: { to: 'board', board: 'cdash' }, timer: { to: 'float' } });
  assert.deepEqual(lay, keep);
  const ul = W.apply(W.layout(), { ops: [{ s: 'dash', id: 'quotes', set: { on: true } }, { s: 'courses', id: 'quotes', set: { on: false } }, { s: 'pages', id: 'music', set: { on: true } }] });
  r = S.apply(null, [{ op: 'dock', id: 'quotes' }, { op: 'dock', id: 'music' }], { lms: 'ultra', lay: ul });
  assert.deepEqual(r.ret, { quotes: { to: 'board', board: 'dash' }, music: { to: 'float' } });
});

// ---- migration -------------------------------------------------------------------------------------------------------
const yes = { lms: 'canvas', todo: true };
// A board listing every built-in tile, off unless given.
const all = (on = {}) => [...Object.entries(on).map(([id, v]) => ({ id, ...v })), ...W.TILES.filter((id) => !(id in on)).map((id) => ({ id, on: false }))];
test('migration: a new install gets To Do then Glaze settings on both sites', () => {
  const fresh = W.fresh();
  for (const lms of ['canvas', 'ultra']) {
    const r = S.migrate(fresh, null, { lms, todo: true });
    // Owner 2026-10-20: settings joins To Do; starter widgets stay on the Dashboard.
    assert.equal(r.mig, 1); assert.deepEqual(docked(r), ['todo', 'settings']); assert.deepEqual(Object.keys(r.dest), ['todo', 'settings']);
  }
  // Better To Do off: only settings docks, and the account counts as migrated.
  const off = S.migrate(fresh, null, { lms: 'canvas', todo: false });
  assert.equal(off.mig, 1); assert.deepEqual(docked(off), ['settings']);
});

test('migration on Canvas: the old always-there list docks; the Dashboard tile docks; a removed tile stays removed', () => {
  // A layout from before To Do was a Dashboard tile (no canvasTodo mark): the list was always there.
  const old = { tiles: [{ id: 'notes', on: true }], boards: { cdash: [{ id: 'notes', on: true }, { id: 'todo', on: false }] } };
  let r = S.migrate(old, null, yes);
  assert.deepEqual(docked(r), ['todo']); assert.deepEqual(r.ret.todo, { to: 'board', board: 'cdash' });
  assert.equal(r.dest.notes, undefined, 'other widgets keep their places');
  // Since then: the tile says. On (the canvasTodo baseline) docks it; off is the student's removal.
  const on = W.layout(old);
  assert.equal(on.canvasTodo, true); assert.ok(on.boards.cdash.find((x) => x.id === 'todo').on);
  assert.deepEqual(docked(S.migrate(on, null, yes)), ['todo']);
  const removed = W.apply(on, { ops: [{ s: 'cdash', id: 'todo', set: { on: false } }] });
  r = S.migrate(removed, null, yes);
  assert.equal(r.mig, 1); assert.equal(r.dest.todo, 'off'); assert.deepEqual(docked(r), []);
  // A deliberately empty board: nothing docks.
  const empty = W.apply(on, { ops: W.TILES.map((id) => ({ s: 'cdash', id, set: { on: false } })) });
  assert.deepEqual(docked(S.migrate(empty, null, yes)), []);
  // Floating To Do docks and remembers floating.
  const fl = W.apply(on, { ops: [{ s: 'canvas', id: 'todo', set: { on: true, float: true } }] });
  assert.deepEqual(S.migrate(fl, null, yes).ret.todo, { to: 'float' });
  // No layout stored at all: the list was always there.
  assert.deepEqual(docked(S.migrate(undefined, null, yes)), ['todo']);
});

test('migration on Ultra: boards that agree decide; boards that disagree are left and To Do is offered', () => {
  const both = W.layout({ todo: true, tiles: [], boards: { courses: all({ todo: { on: true } }), dash: all({ todo: { on: true } }) } });
  let r = S.migrate(both, null, { lms: 'ultra', todo: true });
  assert.deepEqual(docked(r), ['todo']); assert.deepEqual(r.ret.todo, { to: 'board', board: 'courses' }); assert.deepEqual(r.offer, {});
  const none = W.layout({ todo: true, tiles: [], boards: { courses: all(), dash: all() } });
  r = S.migrate(none, null, { lms: 'ultra', todo: true });
  assert.equal(r.dest.todo, 'off');
  for (const [c, d] of [[true, false], [false, true]]) {
    const split = W.layout({ todo: true, tiles: [], boards: { courses: all({ todo: { on: c } }), dash: all({ todo: { on: d } }) } });
    r = S.migrate(split, null, { lms: 'ultra', todo: true });
    assert.equal(r.mig, 1); assert.deepEqual(r.dest, {}); assert.deepEqual(r.dock, []); assert.deepEqual(r.offer, { todo: 'pending' });
  }
  // Before the Courses page's To Do mark, its off was never a choice (lib/widgets.js layout): it counts as on.
  r = S.migrate({ tiles: [], boards: { courses: all(), dash: all({ todo: { on: true } }) } }, null, { lms: 'ultra', todo: true });
  assert.deepEqual(docked(r), ['todo']);
});

test('migration runs once: repeated, it changes nothing; a choice already made is kept; the layout and its marks stay', () => {
  const lay = W.layout();
  const keep = structuredClone(lay);
  const r = S.migrate(lay, null, yes);
  assert.deepEqual(S.migrate(lay, r, yes), r);
  const moved = S.apply(r, [{ op: 'remove', id: 'todo' }]);
  assert.deepEqual(S.migrate(lay, moved, yes), moved, 'a later removal survives');
  assert.deepEqual(S.migrate(lay, { dest: { todo: 'float' } }, yes).dest, { todo: 'float' }, 'an existing choice wins');
  const notes = S.migrate(lay, { dock: [{ id: 'notes' }, { id: 'todo', fold: true, h: 100, gone: true }], dest: { notes: 'dock' } }, yes);
  assert.deepEqual(notes.dock, [{ id: 'todo', fold: true, h: 100 }, { id: 'notes' }], 'To Do first, its dock settings kept');
  assert.deepEqual(lay, keep);
  assert.equal(W.layout({ ...lay, sidebarFresh: true }).sidebarFresh, true, 'the fresh mark survives the layout');
  assert.ok(!('sidebarFresh' in W.layout(lay)));
});

test('a fresh-install marker never overrides a later To Do removal or Ultra board disagreement', () => {
  const fresh = W.fresh();
  const canvas = W.apply(fresh, { ops: [{ s: 'cdash', id: 'todo', set: { on: false } }] });
  const ultra = W.apply(fresh, { ops: ['courses', 'dash'].map((s) => ({ s, id: 'todo', set: { on: false } })) });
  for (const [lms, lay] of [['canvas', canvas], ['ultra', ultra]]) {
    const rec = S.migrate(lay, null, { lms, todo: true });
    assert.equal(rec.dest.todo, 'off', lms);
    assert.deepEqual(docked(rec), ['settings']); // owner 2026-10-20: To Do removal still wins
    assert.deepEqual(S.migrate(lay, rec, { lms, todo: true }), rec);
  }
  const split = W.apply(fresh, { ops: [{ s: 'dash', id: 'todo', set: { on: false } }] });
  const offer = S.migrate(split, null, { lms: 'ultra', todo: true });
  assert.deepEqual(offer.offer, { todo: 'pending' });
  assert.equal(offer.dest.todo, undefined);
});

test('Ultra migrates To Do in the saved Courses board order with its fold state', () => {
  const lay = W.layout({ todo: true, boards: {
    courses: all({ notes: { on: true }, todo: { on: true, fold: true }, timer: { on: true } }),
    dash: all({ todo: { on: true } }),
  } });
  const rec = S.migrate(lay, null, { lms: 'ultra', todo: true });
  assert.deepEqual(rec.dock, [{ id: 'notes' }, { id: 'todo', fold: true }, { id: 'timer' }]);
  assert.deepEqual(S.migrate(lay, rec, { lms: 'ultra', todo: true }), rec);
});

test('migration respects a full dock and override map without dropping active widgets or creating orphan destinations', () => {
  const full = ops(null, ...Array.from({ length: 24 }, (_, i) => ({ op: 'dock', id: `w${i}` })));
  const migrated = S.migrate(W.layout(), full, yes);
  assert.deepEqual(docked(migrated), docked(full));
  assert.equal(migrated.dest.todo, undefined, 'no room: leave its legacy placement');
  const room = ops(full, { op: 'remove', id: 'w2' });
  const added = S.migrate(W.layout(), room, yes);
  assert.equal(added.dock.length, 24);
  assert.deepEqual(docked(added), ['todo', ...docked(room)]);
  assert.ok(!added.dock.some((x) => x.id === 'w2'));
  const bounded = S.clean({ dest: Object.fromEntries(Array.from({ length: 64 }, (_, i) => [`w${i}`, 'off'])) });
  const capped = S.migrate(W.layout(), bounded, yes);
  assert.deepEqual(S.clean(capped), capped);
  assert.deepEqual(capped.dock, []);
  assert.deepEqual(capped.dest, bounded.dest);
});

// ---- placement -------------------------------------------------------------------------------------------------------
test('placement: board → dock → float → board, one destination each, the board spot and float spot kept throughout', () => {
  const where = (lay, rec, enabled = true) => Object.fromEntries([...S.resolve(lay, rec, { site: 'canvas', board: 'cdash', enabled })].map(([id, v]) => [id, v.where]));
  let lay = W.apply(W.layout(), { ops: [{ s: 'cdash', id: 'notes', set: { on: true, x: 40, y: 80, w: 320 } }] });
  const spot = () => lay.boards.cdash.find((x) => x.id === 'notes');
  assert.equal(where(lay, null).notes, 'board');
  let rec = S.apply(null, [{ op: 'dock', id: 'notes' }], { lms: 'canvas', lay });
  assert.equal(where(lay, rec).notes, 'dock', 'the board copy is suppressed though it is on');
  const dockOnly = S.resolve(lay, rec, { site: 'canvas', board: 'cdash' }).get('notes');
  assert.deepEqual(dockOnly, { where: 'dock', dock: { id: 'notes' } });
  assert.equal(where(lay, rec, false).notes, 'board', 'with the sidebar off the layout decides as before');
  // Float: the page turns floating on (glaze:widgetLayout) and moves it out of the dock.
  lay = W.apply(lay, { ops: [{ s: 'canvas', id: 'notes', set: { on: true, float: true, x: 0.2, y: 0.3 } }] });
  rec = S.apply(rec, [{ op: 'undock', id: 'notes', to: 'float' }], { lms: 'canvas', lay });
  assert.equal(where(lay, rec).notes, 'float');
  assert.deepEqual([spot().x, spot().y, spot().w], [40, 80, 320]);
  // Back to the board: floating off, the board's spot as it was.
  lay = W.apply(lay, { ops: [{ s: 'canvas', id: 'notes', set: { float: false } }] });
  rec = S.apply(rec, [{ op: 'undock', id: 'notes', to: 'board', board: 'cdash' }], { lms: 'canvas', lay });
  const back = S.resolve(lay, rec, { site: 'canvas', board: 'cdash' }).get('notes');
  assert.equal(back.where, 'board'); assert.deepEqual([back.tile.x, back.tile.y, back.tile.w], [40, 80, 320]);
  // An override for one surface suppresses another the layout still shows.
  const both = W.apply(lay, { ops: [{ s: 'canvas', id: 'notes', set: { float: true } }] });
  assert.equal(where(both, rec).notes, 'board', 'board chosen: its float copy is not drawn');
  assert.equal(where(both, S.apply(rec, [{ op: 'undock', id: 'notes', to: 'float' }])).notes, 'float');
  assert.equal(where(both, S.apply(rec, [{ op: 'remove', id: 'notes' }])).notes, 'off');
  // Elsewhere (no board): a docked widget is still docked, a board one is nowhere.
  assert.equal(S.resolve(lay, rec, { site: 'canvas', board: null }).get('notes').where, 'off');
  assert.equal(S.resolve(lay, S.apply(rec, [{ op: 'dock', id: 'notes' }]), { site: 'canvas', board: null }).get('notes').where, 'dock');
});

test('placement: not dockable or not allowed here decides; Ultra floats from its pages; a mod tile may dock', () => {
  const lay = W.apply(W.layout(), { ops: [{ s: 'pages', id: 'timer', set: { on: true } }, { s: 'courses', id: 'notes', set: { on: true } }] });
  const rec = S.apply(null, [{ op: 'dock', id: 'notes' }, { op: 'dock', id: 'mabcdefghijklmn0' }]);
  const r = S.resolve(lay, rec, { site: 'ultra', board: 'courses', dockable: (id) => id !== 'notes', allowed: (id) => id !== 'quotes' });
  assert.equal(r.get('timer').where, 'float');
  assert.equal(r.get('notes').where, 'board', 'not dockable: the layout decides');
  assert.equal(r.get('mabcdefghijklmn0').where, 'dock');
  assert.equal(S.resolve(W.apply(lay, { ops: [{ s: 'courses', id: 'quotes', set: { on: true } }] }), rec, { site: 'ultra', board: 'courses', allowed: (id) => id !== 'quotes' }).get('quotes').where, 'off');
  assert.deepEqual(docked(rec), ['notes', 'mabcdefghijklmn0']);
  for (const [, v] of S.resolve(lay, rec, { site: 'ultra', board: 'courses' })) assert.ok(['dock', 'board', 'float', 'off'].includes(v.where));
});

test('declared widgets keep their legacy board and float placements, return destination and Ultra migration', () => {
  const id = 'mabcdefghijklmn0', more = { pet: { size: 'm' }, [id]: { size: 's' } };
  const lay = W.apply(W.layout(), { ops: [
    { s: 'courses', id: 'pet', set: { on: true, x: 900, y: 32, fold: true } },
    { s: 'dash', id, set: { on: true, x: 16, y: 64, w: 300 } },
    { s: 'pages', id, set: { on: true, x: 0.3, y: 0.5 } },
  ] }, more);
  const keep = structuredClone(lay);
  assert.equal(S.resolve(lay, null, { site: 'ultra', board: 'courses' }).get('pet')?.where, 'board');
  assert.equal(S.resolve(lay, null, { site: 'ultra', board: 'dash' }).get(id)?.where, 'float');
  const rec = S.apply(null, [{ op: 'dock', id }], { lms: 'ultra', lay });
  assert.deepEqual(rec.ret[id], { to: 'float' });
  const moved = S.apply(rec, [{ op: 'undock', id, to: 'float' }], { lms: 'ultra', lay });
  assert.equal(S.resolve(lay, moved, { site: 'ultra', board: 'dash' }).get(id)?.where, 'float');
  const migrated = S.migrate(lay, null, { lms: 'ultra', todo: false });
  assert.deepEqual(migrated.dock, [{ id: 'pet', fold: true }]);
  assert.deepEqual(lay, keep);
});

test('an explicit Ultra board destination selects that board and survives docking again', () => {
  const lay = W.apply(W.layout(), { ops: ['courses', 'dash'].map((s) => ({ s, id: 'notes', set: { on: true } })) });
  let rec = S.apply(null, [{ op: 'dock', id: 'notes' }, { op: 'undock', id: 'notes', to: 'board', board: 'dash' }], { lms: 'ultra', lay });
  assert.equal(S.resolve(lay, rec, { site: 'ultra', board: 'dash' }).get('notes').where, 'board');
  assert.equal(S.resolve(lay, rec, { site: 'ultra', board: 'courses' }).get('notes').where, 'off');
  rec = S.apply(rec, [{ op: 'dock', id: 'notes' }], { lms: 'ultra', lay });
  assert.deepEqual(rec.ret.notes, { to: 'board', board: 'dash' });
  rec = S.apply(rec, [{ op: 'remove', id: 'notes' }, { op: 'dock', id: 'notes' }], { lms: 'ultra', lay });
  assert.deepEqual(rec.ret.notes, { to: 'board', board: 'dash' });
});

test('an override map at its bound cannot leave a new dock entry without its destination', () => {
  let rec = S.clean({ dest: Object.fromEntries(Array.from({ length: 64 }, (_, i) => [`w${i}`, 'off'])) });
  assert.deepEqual(ops(rec, { op: 'dock', id: 'notes' }), rec);
  rec = ops(rec, { op: 'dock', id: 'w0' });
  assert.deepEqual(docked(rec), ['w0'], 'existing overrides remain editable');
  assert.equal(rec.dest.w0, 'dock');
});

// ---- the layout's mode -----------------------------------------------------------------------------------------------
test('reset: width, expanded, folds, To Do scope and docked heights as new; destinations, order and removals stay', () => {
  let r = ops(S.clean({}), { op: 'dock', id: 'todo' }, { op: 'dock', id: 'timer' }, { op: 'dock', id: 'quote' }, { op: 'remove', id: 'quote' },
    { op: 'width', px: 420 }, { op: 'open', v: false }, { op: 'section', family: 'dashboard', part: 'page', v: true },
    { op: 'todoScope', v: 'all' }, { op: 'height', id: 'timer', h: 300 }, { op: 'fold', id: 'todo', v: true }, { op: 'move', id: 'timer', by: -1 });
  r = ops(r, { op: 'reset' });
  assert.equal(r.width, S.WIDTH);
  assert.equal(r.open, true);
  assert.deepEqual(r.fold, {});
  assert.equal(r.todoScope, 'follow');
  assert.deepEqual(docked(r), ['timer', 'todo']);
  assert.deepEqual(r.dock, [{ id: 'timer' }, { id: 'todo' }, { id: 'quote', gone: true }]);
  assert.equal(r.dest.quote, 'off');
  assert.ok(S.ops([{ op: 'reset' }]));
});

test('mode: 352 by default within 288–480, a 16px gap, 720 (900 on grades) for the main column, nothing when empty', () => {
  assert.deepEqual(S.mode({ vw: 352 + 16 + 720 }), { mode: 'expanded', w: 352 });
  assert.deepEqual(S.mode({ vw: 352 + 16 + 719 }), { mode: 'drawer', w: 352 });
  assert.deepEqual(S.mode({ vw: 352 + 16 + 720, grades: true }).mode, 'drawer');
  assert.deepEqual(S.mode({ vw: 352 + 16 + 900, grades: true }), { mode: 'expanded', w: 352 });
  assert.deepEqual(S.mode({ vw: 2000, width: 100 }), { mode: 'expanded', w: 288 });
  assert.deepEqual(S.mode({ vw: 2000, width: 999 }), { mode: 'expanded', w: 480 });
  assert.equal(S.mode({ vw: 480 + 16 + 720, width: 480 }).mode, 'expanded');
  assert.equal(S.mode({ vw: 480 + 16 + 720, width: 480, left: 1 }).mode, 'drawer', 'navigation takes its room');
  assert.equal(S.mode({ vw: 1400, left: 200, right: 100 }).mode, 'expanded');
  assert.equal(S.mode({ vw: 2000, open: false }).mode, 'collapsed');
  assert.deepEqual(S.mode({ vw: 2000, empty: true }), { mode: 'none', w: 0 });
  assert.deepEqual(S.mode({ vw: 390 }), { mode: 'drawer', w: 352 });
  assert.deepEqual(S.mode({ vw: 300 }), { mode: 'drawer', w: 300 }, 'a phone shows what fits');
  // A drawer is not the desktop preference: open stays as saved, and the saved width is never changed.
  const rec = S.clean({ width: 460, open: true });
  assert.equal(S.mode({ vw: 900, width: rec.width, open: rec.open }).mode, 'drawer');
  assert.deepEqual(rec, S.clean({ width: 460, open: true }));
});

// ---- Look export -----------------------------------------------------------------------------------------------------
test('a shared Look carries neither the widgets layout nor any sidebar record or setting', async () => {
  const s = G.GZ_SANITIZE({ enhance: { sidebar: false } });
  const lay = W.layout();
  const rec = S.apply(null, [{ op: 'dock', id: 'notes' }, { op: 'width', px: 401 }]);
  const settings = { ...s, widgetLayout: lay, [`sidebar:canvas:${CANVAS}/42`]: rec, sidebar: rec };
  const code = await share.encode(settings, {});
  const back = await share.decode(code);
  const text = JSON.stringify(back);
  for (const word of ['widgetLayout', 'sidebar', 'dock', 'canvasTodo', '401', 'enhance']) assert.ok(!text.includes(word), word);
  assert.deepEqual(Object.keys(back).sort(), ['bg', 'card', 'cards', 'colors', 'look', 'nav', 'navbar', 'parts']);
});

test("migration on Ultra: the Courses column's widgets dock in board order with their fold; course cards, floats and the Dashboard stay", () => {
  const card = `course:${ULTRA}/_5_1`;
  const lay = W.layout({ todo: true, tiles: [], boards: {
    courses: [{ id: 'timer', on: true, fold: true, x: 5, y: 6 }, { id: 'todo', on: true }, { id: 'quotes', on: false }, { id: 'notes', on: true, x: 900, y: 40 }, { id: 'music', on: true }, { id: card, on: true }, { id: 'mabcdefghijklmn0', on: true }, ...all()],
    dash: all({ todo: { on: true }, agenda: { on: true } }),
    pages: all({ music: { on: true } }),
  } }, { mabcdefghijklmn0: { size: 's' } });
  const keep = structuredClone(lay);
  const r = S.migrate(lay, null, { lms: 'ultra', todo: true });
  assert.deepEqual(r.dock, [{ id: 'timer', fold: true }, { id: 'todo' }, { id: 'notes' }, { id: 'mabcdefghijklmn0' }], 'the column in order; a room-placed tile docks too');
  assert.equal(r.dest.music, undefined, 'floating stays floating'); assert.equal(r.dest.agenda, undefined, "the Dashboard's board stays");
  assert.ok(!Object.keys(r.dest).some((k) => k.startsWith('course:')));
  assert.deepEqual(r.ret.timer, { to: 'board', board: 'courses' });
  assert.deepEqual(lay, keep, 'board entries untouched');
  const where = S.resolve(lay, r, { site: 'ultra', board: 'courses' });
  assert.equal(where.get('timer').where, 'dock'); assert.equal(where.get(card).where, 'board');
  assert.deepEqual(S.migrate(lay, r, { lms: 'ultra', todo: true }), r, 'repeated: unchanged');
  const removed = S.apply(r, [{ op: 'remove', id: 'timer' }]);
  assert.deepEqual(S.migrate(lay, removed, { lms: 'ultra', todo: true }), removed, 'a later removal survives');
  // To Do disagreeing with the Dashboard: the column's other widgets dock, To Do is offered.
  const split = W.apply(lay, { ops: [{ s: 'dash', id: 'todo', set: { on: false } }] }, { mabcdefghijklmn0: { size: 's' } });
  const o = S.migrate(split, null, { lms: 'ultra', todo: true });
  assert.deepEqual(docked(o), ['timer', 'notes', 'mabcdefghijklmn0']); assert.deepEqual(o.offer, { todo: 'pending' }); assert.equal(o.dest.todo, undefined);
  assert.deepEqual(docked(S.apply(o, [{ op: 'dock', id: 'todo', at: 0 }])), ['todo', 'timer', 'notes', 'mabcdefghijklmn0']);
  // Better To Do off: the column still docks, To Do doesn't.
  assert.deepEqual(docked(S.migrate(lay, null, { lms: 'ultra', todo: false })), ['timer', 'notes', 'mabcdefghijklmn0']);
});
