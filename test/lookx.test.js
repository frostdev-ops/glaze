// W12: sticker placements, the pointer sets' hotspots, own-picture caps and Look rotation's schedule (lib/lookx.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const L = require('../lib/lookx.js');
const MX = require('../lib/motionx.js');
const G = require('../defaults.js');

test('placements: bundled or own stickers only, with an id each, numbers clamped, junk dropped, capped per page', () => {
  assert.deepEqual(L.clean([
    { id: 'a', s: 'study/coffee', x: 50, y: 300, w: 120, r: 0 },
    { id: 'b', s: 'critters/study-buddy-happy', x: 140, y: -5, w: 9000, r: 90 },
    { id: 'c', s: 'own:3f2a-11', x: 10.04, y: 20, w: 24, r: -3 },
    { id: 'a', s: 'study/pencil', x: 1, y: 1, w: 50 },
    { s: 'study/pencil', x: 1, y: 1, w: 50 },
    { id: 'no spaces', s: 'study/pencil', x: 1, y: 1, w: 50 },
    { id: 'd', s: 'study/not-a-sticker', x: 1, y: 1, w: 50 },
    { id: 'e', s: '../../evil', x: 1, y: 1, w: 50 },
    { id: 'f', s: 'study/pencil', x: '5', y: 1, w: 50 },
    { id: 'g', s: 'study/pencil', x: NaN, y: 1, w: 50 },
    null, 'study/coffee',
  ]), [
    { id: 'a', s: 'study/coffee', x: 50, y: 300, w: 120, r: 0 },
    { id: 'b', s: 'critters/study-buddy-happy', x: 100, y: 0, w: 480, r: 45 },
    { id: 'c', s: 'own:3f2a-11', x: 10, y: 20, w: 24, r: -3 },
  ]);
  assert.deepEqual(L.clean('nope'), []);
  assert.equal(L.clean(Array.from({ length: 500 }, (_, i) => ({ id: `s${i}`, s: 'space-sky/sun', x: 1, y: 1, w: 50 }))).length, L.MAX_ON_PAGE);
});

test('placement changes: add once per id, set moves without changing the sticker, del removes', () => {
  const a = { id: 'a', s: 'study/coffee', x: 50, y: 10, w: 100, r: 0 };
  assert.deepEqual(L.apply(undefined, { op: 'add', p: a }), [a]);
  assert.deepEqual(L.apply([a], { op: 'add', p: { ...a, x: 1 } }), [a]);
  assert.deepEqual(L.apply([a], { op: 'set', id: 'a', p: { x: 7, s: 'own:x', id: 'z' } }), [{ ...a, x: 7 }]);
  assert.deepEqual(L.apply([a], { op: 'set', id: 'a', p: { x: 'bad' } }), [a]);
  assert.deepEqual(L.apply([a], { op: 'del', id: 'a' }), []);
  assert.deepEqual(L.apply([a], { op: 'what' }), [a]);
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

test('no stickers on a quiz being taken or reviewed, or a tool\'s page: Canvas, Ultra and Moodle', () => {
  for (const p of ['/courses/1/quizzes/2/take', '/courses/1/quizzes/2/take/questions/3', '/courses/1/quizzes/2/history', '/courses/1/external_tools/9',
    '/ultra/courses/_1_1/outline/assessment/_2_1/overview/attempt/_3_1', '/mod/quiz/attempt.php', '/moodle/mod/quiz/summary.php', '/mod/quiz/review.php', '/mod/lti/view.php', '/mod/lti/launch.php']) assert.ok(L.quiet(p), p);
  for (const p of ['/', '/courses/1', '/courses/1/quizzes/2', '/courses/1/quizzes', '/ultra/course', '/mod/quiz/view.php', '/course/view.php', '/mod/lti/index.php']) assert.ok(!L.quiet(p), p);
  assert.ok(L.quiet('/courses/1/assignments/2', { getElementById: (id) => (id === 'tool_content' ? {} : null) }), 'a tool in the page');
});

test('every bundled sticker is a file, named after its pack and name', () => {
  assert.equal(L.BUNDLED.size, 57);
  for (const id of L.BUNDLED.keys()) assert.ok(fs.existsSync(path.join(__dirname, '..', L.file(id))), id);
  assert.equal(L.BUNDLED.get('cozy-autumn/steaming-cocoa-mug'), 'Steaming cocoa mug');
});

test('the pointer sets\' hotspots are the art README\'s, inside their 32 × 32 files', () => {
  const readme = fs.readFileSync(path.join(__dirname, '../assets/art/README.md'), 'utf8');
  const rows = [...readme.matchAll(/`cursors\/(\w+)\/(default|pointer)\.png` \| (\d+), (\d+) \|/g)];
  assert.equal(rows.length, 6);
  for (const [, set, kind, x, y] of rows) assert.deepEqual(L.CURSORS[set][kind], [+x, +y], `${set}/${kind}`);
  // The SVG sets: one row per set, both hotspots.
  const svg = [...readme.matchAll(/`cursors\/(\w+)\/` \([^)]+\) \| [^|]+ \| (\d+), (\d+) \| (\d+), (\d+) \|/g)];
  assert.equal(svg.length, 10);
  for (const [, set, dx, dy, px, py] of svg) assert.deepEqual([L.CURSORS[set].default, L.CURSORS[set].pointer, L.CURSORS[set].svg], [[+dx, +dy], [+px, +py], true], set);
  // Every set a Look part may name, and 'own'.
  assert.deepEqual([...Object.keys(L.CURSORS), 'own'], MX.POINTERS);
  const size = (f) => { const png = fs.readFileSync(path.join(__dirname, `../assets/art/cursors/${f}`)); return [png.readUInt32BE(16), png.readUInt32BE(20)]; };
  for (const [set, c] of Object.entries(L.CURSORS)) for (const kind of ['default', 'pointer']) {
    assert.deepEqual(size(`${set}/${kind}.png`), [32, 32], `${set}/${kind}`);
    if (!c.svg) continue;
    assert.deepEqual(size(`${set}/${kind}@2x.png`), [64, 64], `${set}/${kind}@2x`);
    const src = fs.readFileSync(path.join(__dirname, `../assets/art/cursors/${set}/${kind}.svg`), 'utf8');
    // Firefox draws an SVG cursor only with its own width and height; nothing in one may load or run anything.
    assert.match(src, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" width="32" height="32" viewBox="0 0 32 32">/, `${set}/${kind}.svg`);
    assert.doesNotMatch(src, /<script|<image|href=|url\(|<style|on\w+=/i, `${set}/${kind}.svg`);
  }
});

test('a pointer set as CSS: the SVG, then the PNGs at 2x and 1x, then the system\'s', () => {
  const url = (f) => `ext:/${f}`;
  assert.equal(L.cursorCss('aqua', 'pointer', url), 'url("ext:/assets/art/cursors/aqua/pointer.png") 14 2');
  assert.equal(L.cursorCss('ghost', 'default', url), 'url("ext:/assets/art/cursors/ghost/default.svg") 4 3, image-set(url("ext:/assets/art/cursors/ghost/default.png") 1x, url("ext:/assets/art/cursors/ghost/default@2x.png") 2x) 4 3, url("ext:/assets/art/cursors/ghost/default.png") 4 3');
  assert.equal(L.cursorCss('ghost', 'default', url, false), 'url("ext:/assets/art/cursors/ghost/default.svg") 4 3, url("ext:/assets/art/cursors/ghost/default.png") 4 3');
});

test('own pictures: scaled down only, data URLs of bitmaps only, each and all capped', () => {
  assert.deepEqual(L.fit(1024, 512, 256), [256, 128]);
  assert.deepEqual(L.fit(20, 10, 32), [20, 10]);
  assert.ok(L.DATA.test('data:image/png;base64,iVBORw0KGgo='));
  assert.ok(!L.DATA.test('data:image/svg+xml;base64,PHN2Zz4='));
  assert.ok(L.roomFor({}, 1000));
  assert.ok(!L.roomFor({}, L.IMG_MAX + 1));
  assert.ok(!L.roomFor({ 'stkImg:a': 'x'.repeat(L.IMGS_MAX - 10), other: 'y'.repeat(L.IMGS_MAX) }, 11));
  assert.ok(L.roomFor({ 'stkImg:a': 'x'.repeat(L.IMGS_MAX - 11) }, 11));
  assert.deepEqual(L.imgIds({ 'stkImg:a': 1, 'stk:x': 2, cursorImg: 3 }), ['a']);
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

test('daily rotation: a time a clock change skips moves later that day only, not on the days after', () => {
  const was = process.env.TZ;
  try {
    for (const [tz, at, y, mo, d, skipped] of [['America/New_York', '02:30', 2025, 2, 9, '03:30'], ['Australia/Lord_Howe', '02:15', 2025, 9, 5, '02:45']]) {
      process.env.TZ = tz;
      const hm = (t) => new Date(t).toTimeString().slice(0, 5);
      // The day before, after its turn: the next is the skipped time, moved later.
      let t = L.nextTurn('daily', at, new Date(y, mo, d - 1, 12).getTime());
      assert.equal(hm(t), skipped, `${tz} on the change day`);
      assert.equal(new Date(t).getDate(), d);
      // From then on, the chosen time again.
      t = L.nextTurn('daily', at, t);
      assert.equal(hm(t), at, `${tz} the day after`);
      assert.equal(new Date(t).getDate(), d + 1);
      assert.equal(hm(L.nextTurn('daily', at, t)), at);
    }
  } finally {
    if (was === undefined) delete process.env.TZ; else process.env.TZ = was;
  }
});

test('rotation turns: a new schedule starts its clock without changing; then one turn per due time, in order, wrapping', () => {
  const x = { rotate: '6h', at: '08:00' };
  const list = ['Library', 'Terminal', 'Clear'];
  const t0 = 1e12;
  let r = L.turn(undefined, t0, x, list);
  assert.deepEqual(r, { state: { mode: '6h 08:00', at: t0, i: -1 }, wear: -1 });
  assert.equal(L.turn(r.state, t0 + 36e5, x, list).wear, -1, 'not due');
  r = L.turn(r.state, t0 + 6 * 36e5, x, list);
  assert.deepEqual(r, { state: { mode: '6h 08:00', at: t0 + 6 * 36e5, i: 0, turned: true }, wear: 0 });
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
  // A favorite removed since it was ticked has no box left to untick: it isn't turned to.
  assert.deepEqual(L.rotation(['Library', 'glaze1:abc', 'glaze2:def'], looks, ['glaze2:def']), ['Library', 'glaze2:def']);
  assert.deepEqual(L.rotation(['glaze1:abc'], looks, []), looks, 'none left is every built-in Look');
  assert.deepEqual(L.rotation([`glaze1:${'a'.repeat(5000)}`], looks), looks);
  // A glaze2 code (a Look with parts) is longer: up to 20,000 characters.
  assert.deepEqual(L.rotation([`glaze2:${'a'.repeat(19993)}`, 'Library'], looks), [`glaze2:${'a'.repeat(19993)}`, 'Library']);
  assert.deepEqual(L.rotation([`glaze2:${'a'.repeat(19994)}`], looks), looks);
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
  // The navigation, its bar and the sidebar's look are worn as "Use this theme" wears them (a code that carries none leaves
  // the student's own); card styles are the cards queue's, and a code's parts are written beside this patch.
  assert.deepEqual(Object.keys(w).sort(), ['auto', 'bg', 'colors', 'look', 'nav', 'navbar', 'preset', 'sidebar']);
  assert.deepEqual([w.nav, w.navbar, w.sidebar], [s.nav, s.navbar, s.sidebar]);
});

test('extras settings: off by default, sanitized', () => {
  assert.deepEqual(G.GZ_DEFAULTS.extras, { cursor: 'off', stickers: true, rotate: 'off', at: '08:00' });
  assert.deepEqual(G.GZ_SANITIZE({ extras: { cursor: 'evil', rotate: '1m', at: '25:99', stickers: 'yes' } }).extras, G.GZ_DEFAULTS.extras);
});

test('Ultra LTI launch frames and direct attempts exclude Look effects', () => {
  for (const path of ['/ultra/courses/_101_1/outline/lti/launchFrame', '/ultra/courses/_101_1/attempt/_800_1']) {
    assert.equal(L.quiet(path), true, path);
  }
});
