// W12: sticker placements, the pointer sets' hotspots, own-picture caps and Look rotation's schedule (lib/lookx.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const L = require('../lib/lookx.js');
const G = require('../defaults.js');

test('placements: bundled or own stickers only, numbers clamped, junk dropped, capped per page', () => {
  assert.deepEqual(L.clean([
    { s: 'study/coffee', x: 50, y: 300, w: 120, r: 0 },
    { s: 'critters/study-buddy-happy', x: 140, y: -5, w: 9000, r: 90 },
    { s: 'own:3f2a-11', x: 10.04, y: 20, w: 24, r: -3 },
    { s: 'study/not-a-sticker', x: 1, y: 1, w: 50 },
    { s: '../../evil', x: 1, y: 1, w: 50 },
    { s: 'study/pencil', x: '5', y: 1, w: 50 },
    { s: 'study/pencil', x: NaN, y: 1, w: 50 },
    null, 'study/coffee',
  ]), [
    { s: 'study/coffee', x: 50, y: 300, w: 120, r: 0 },
    { s: 'critters/study-buddy-happy', x: 100, y: 0, w: 480, r: 45 },
    { s: 'own:3f2a-11', x: 10, y: 20, w: 24, r: -3 },
  ]);
  assert.deepEqual(L.clean('nope'), []);
  assert.equal(L.clean(Array.from({ length: 500 }, () => ({ s: 'study/sun', x: 1, y: 1, w: 50 }))).length, 0);
  assert.equal(L.clean(Array.from({ length: 500 }, () => ({ s: 'space-sky/sun', x: 1, y: 1, w: 50 }))).length, L.MAX_ON_PAGE);
});

test('a page\'s stickers are keyed by origin and path, a trailing slash ignored', () => {
  assert.equal(L.pageKey('https://u.instructure.com', '/courses/1/'), 'stk:https://u.instructure.com/courses/1');
  assert.equal(L.pageKey('https://u.instructure.com', '/'), 'stk:https://u.instructure.com/');
  assert.ok(L.PAGE_KEY.test(L.pageKey('https://u.instructure.com', '/courses/1')));
  assert.ok(!L.PAGE_KEY.test('stk:javascript:alert(1)'));
  // content.js works out the same key without loading lib/lookx.js.
  const content = fs.readFileSync(path.join(__dirname, '../content.js'), 'utf8');
  assert.ok(content.includes("`stk:${location.origin}${location.pathname.replace(/(.)\\/+$/, '$1')}`"));
});

test('every bundled sticker is a file, named after its pack and name', () => {
  assert.equal(L.BUNDLED.size, 51);
  for (const id of L.BUNDLED.keys()) assert.ok(fs.existsSync(path.join(__dirname, '..', L.file(id))), id);
  assert.equal(L.BUNDLED.get('cozy-autumn/steaming-cocoa-mug'), 'Steaming cocoa mug');
});

test('the pointer sets\' hotspots are the art README\'s, inside their 32 × 32 files', () => {
  const readme = fs.readFileSync(path.join(__dirname, '../assets/art/README.md'), 'utf8');
  const rows = [...readme.matchAll(/`cursors\/(\w+)\/(default|pointer)\.png` \| (\d+), (\d+) \|/g)];
  assert.equal(rows.length, 6);
  for (const [, set, kind, x, y] of rows) assert.deepEqual(L.CURSORS[set][kind], [+x, +y], `${set}/${kind}`);
  assert.deepEqual(Object.keys(L.CURSORS), G.GZ_SPEC.extras.cursor[1].filter((c) => !['off', 'own'].includes(c)));
  for (const set of Object.keys(L.CURSORS)) for (const kind of ['default', 'pointer']) {
    const png = fs.readFileSync(path.join(__dirname, `../assets/art/cursors/${set}/${kind}.png`));
    assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [32, 32], `${set}/${kind}`);
  }
});

test('own pictures: scaled down only, data URLs of bitmaps only, each and all capped', () => {
  assert.deepEqual(L.fit(1024, 512, 256), [256, 128]);
  assert.deepEqual(L.fit(20, 10, 32), [20, 10]);
  assert.ok(L.DATA.test('data:image/png;base64,iVBORw0KGgo='));
  assert.ok(!L.DATA.test('data:image/svg+xml;base64,PHN2Zz4='));
  assert.ok(L.roomFor({}, 1000));
  assert.ok(!L.roomFor({}, L.IMG_MAX + 1));
  assert.ok(!L.roomFor({ a: L.IMGS_MAX - 10 }, 11));
});

test('rotation: every 6/12/24 hours or a week after the last turn, or daily at a local time', () => {
  const at = new Date(2026, 9, 15, 9, 30).getTime();
  assert.equal(L.nextTurn('6h', '08:00', at), at + 6 * 36e5);
  assert.equal(L.nextTurn('week', '08:00', at), at + 168 * 36e5);
  assert.equal(L.nextTurn('daily', '08:00', at), new Date(2026, 9, 16, 8, 0).getTime());
  assert.equal(L.nextTurn('daily', '21:15', at), new Date(2026, 9, 15, 21, 15).getTime());
  assert.equal(L.nextTurn('daily', '09:30', at), new Date(2026, 9, 16, 9, 30).getTime(), 'not the moment just turned');
  assert.equal(L.nextTurn('off', '08:00', at), null);
  assert.equal(L.nextTurn('6h', '08:00', undefined), null);
});

test('rotation turns: a new schedule starts its clock without changing; then one turn per due time, in order, wrapping', () => {
  const x = { rotate: '6h', at: '08:00' };
  const list = ['Library', 'Terminal', 'Clear'];
  const t0 = 1e12;
  let r = L.turn(undefined, t0, x, list);
  assert.deepEqual(r, { state: { mode: '6h 08:00', at: t0, i: -1 }, wear: -1 });
  assert.equal(L.turn(r.state, t0 + 36e5, x, list).wear, -1, 'not due');
  r = L.turn(r.state, t0 + 6 * 36e5, x, list);
  assert.deepEqual(r, { state: { mode: '6h 08:00', at: t0 + 6 * 36e5, i: 0 }, wear: 0 });
  // A second tab asking at the same moment finds nothing due.
  assert.equal(L.turn(r.state, t0 + 6 * 36e5, x, list).wear, -1);
  r = L.turn({ ...r.state, i: 2 }, t0 + 12 * 36e5, x, list);
  assert.equal(r.wear, 0, 'wraps');
  // Changing the schedule restarts the clock, keeping the place in the list.
  assert.deepEqual(L.turn(r.state, t0 + 13 * 36e5, { rotate: 'daily', at: '07:00' }, list), { state: { mode: 'daily 07:00', at: t0 + 13 * 36e5, i: 0 }, wear: -1 });
  // "Next Look now" turns at once; off never does.
  assert.equal(L.turn(r.state, t0 + 12 * 36e5 + 1, x, list, true).wear, 1);
  assert.equal(L.turn(r.state, t0 + 99 * 36e5, { rotate: 'off', at: '08:00' }, list, true).wear, -1);
});

test('rotation\'s list: chosen Looks and favorite codes, none chosen being every built-in Look', () => {
  const looks = G.GZ_LOOKS.map((l) => l.name);
  assert.deepEqual(L.rotation(undefined, looks), looks);
  assert.deepEqual(L.rotation(['Library', 'Gone', 'glaze1:abc', 'Library', 7], looks), ['Library', 'glaze1:abc']);
  assert.deepEqual(L.rotation([`glaze1:${'a'.repeat(5000)}`], looks), looks);
});

test('a rotated favorite is worn like "Use this theme": its palette, look and background; auto off; the rest kept', () => {
  const s = G.GZ_SANITIZE({ auto: { on: true }, look: { tooltips: false, font: 'inter' } });
  const got = { colors: G.GZ_PRESETS.find(([n]) => n === 'Forest')[1], look: { radius: 4 }, bg: { kind: 'aurora' }, card: {}, cards: [] };
  const w = L.wearCode(s, got);
  assert.equal(w.preset, 'Forest');
  assert.equal(w.auto.on, false);
  assert.equal(w.look.radius, 4);
  assert.equal(w.look.font, 'inter');
  assert.equal(w.look.tooltips, false);
  assert.equal(w.bg.kind, 'aurora');
  assert.deepEqual(Object.keys(w).sort(), ['auto', 'bg', 'colors', 'look', 'preset']);
});

test('extras settings: off by default, sanitized', () => {
  assert.deepEqual(G.GZ_DEFAULTS.extras, { cursor: 'off', stickers: true, rotate: 'off', at: '08:00' });
  assert.deepEqual(G.GZ_SANITIZE({ extras: { cursor: 'evil', rotate: '1m', at: '25:99', stickers: 'yes' } }).extras, G.GZ_DEFAULTS.extras);
});
