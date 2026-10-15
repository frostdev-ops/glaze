// Dashboard notes and widgets (lib/widgets.js): music links per provider, the timer's math, breathing, quotes, the
// layout and its sanitizer, notes' writes and links, the agenda's day and the feedback link.
const test = require('node:test');
const assert = require('node:assert/strict');
const W = require('../lib/widgets.js');
const L = require('../lib/todo.js');
const D = require('../defaults.js');

test('music: each provider\'s links become its embed, built from checked parts only', () => {
  const ok = {
    'https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC': ['Spotify', 'https://open.spotify.com/embed/track/4uLU6hMCjMI75M1A2tKUQC'],
    'https://open.spotify.com/intl-de/album/1DFixLWuPkv3KT3TnV35m3?si=abc': ['Spotify', 'https://open.spotify.com/embed/album/1DFixLWuPkv3KT3TnV35m3'],
    'https://open.spotify.com/embed/playlist/37i9dQZF1DXcBWIGoYBM5M': ['Spotify', 'https://open.spotify.com/embed/playlist/37i9dQZF1DXcBWIGoYBM5M'],
    'https://www.youtube.com/watch?v=jfKfPfyJRdk': ['YouTube', 'https://www.youtube-nocookie.com/embed/jfKfPfyJRdk'],
    'https://youtube.com/watch?v=jfKfPfyJRdk&list=PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG&t=30': ['YouTube', 'https://www.youtube-nocookie.com/embed/jfKfPfyJRdk?list=PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG'],
    'https://m.youtube.com/playlist?list=PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG': ['YouTube', 'https://www.youtube-nocookie.com/embed/videoseries?list=PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG'],
    'https://youtu.be/jfKfPfyJRdk?si=x': ['YouTube', 'https://www.youtube-nocookie.com/embed/jfKfPfyJRdk'],
    'https://www.youtube.com/live/jfKfPfyJRdk': ['YouTube', 'https://www.youtube-nocookie.com/embed/jfKfPfyJRdk'],
    'https://music.youtube.com/watch?v=jfKfPfyJRdk&feature=share': ['YouTube Music', 'https://www.youtube-nocookie.com/embed/jfKfPfyJRdk'],
    'https://music.youtube.com/playlist?list=OLAK5uy_nYvLpNb2bZzc3EEtD1tY1-0ZiDqEe4VGM': ['YouTube Music', 'https://www.youtube-nocookie.com/embed/videoseries?list=OLAK5uy_nYvLpNb2bZzc3EEtD1tY1-0ZiDqEe4VGM'],
    'https://music.apple.com/us/album/random-access-memories/617154241': ['Apple Music', 'https://embed.music.apple.com/us/album/random-access-memories/617154241'],
    'https://music.apple.com/gb/album/get-lucky/617154241?i=617154366': ['Apple Music', 'https://embed.music.apple.com/gb/album/get-lucky/617154241?i=617154366'],
    'https://music.apple.com/us/playlist/chill/pl.u-abc123XYZ': ['Apple Music', 'https://embed.music.apple.com/us/playlist/chill/pl.u-abc123XYZ'],
    '  https://music.apple.com/DE/station/ra.978194965  ': ['Apple Music', 'https://embed.music.apple.com/de/station/ra.978194965'],
  };
  for (const [url, [provider, src]] of Object.entries(ok)) assert.deepEqual(W.music(url), { provider, src }, url);
  const bad = [
    '', 'not a link', 'http://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC', 'https://open.spotify.com/track/short',
    'https://open.spotify.com/user/someone', 'https://open.spotify.com.evil.example/track/4uLU6hMCjMI75M1A2tKUQC',
    'https://evil.example/?u=https://www.youtube.com/watch?v=jfKfPfyJRdk', 'https://www.youtube.com/watch?v=bad"onload=x',
    'https://www.youtube.com/watch', 'https://www.youtube.com/channel/UC123', 'https://youtube.com:8443/watch?v=jfKfPfyJRdk',
    'https://user:pw@youtube.com/watch?v=jfKfPfyJRdk', 'javascript:alert(1)', 'https://music.apple.com/us/album/a/b/1',
    'https://music.apple.com/us/artist/daft-punk/5468295', 'https://music.youtube.com/channel/UC1', 'https://music.apple.com/usa/album/x/1',
    `https://www.youtube.com/watch?v=jfKfPfyJRdk&x=${'a'.repeat(600)}`, null, 42,
  ];
  for (const url of bad) assert.equal(W.music(url), null, String(url));
  // A title in the link stays percent-encoded, as the parser left it.
  assert.equal(W.music('https://music.apple.com/fr/album/"été"/1').src, 'https://embed.music.apple.com/fr/album/%22%C3%A9t%C3%A9%22/1');
});

const o = { work: 25, rest: 5 };
test('timer: start, pause, reset and a phase ending while away', () => {
  const t0 = 1_000_000;
  let s = W.IDLE;
  assert.equal(W.left(s, t0, o), 25 * 6e4);
  s = W.start(s, t0, o);
  assert.equal(s.end, t0 + 25 * 6e4);
  assert.equal(W.start(s, t0 + 5, o), s, 'starting a running timer changes nothing');
  s = W.pause(s, t0 + 10 * 6e4);
  assert.deepEqual(s, { phase: 'work', end: 0, left: 15 * 6e4 });
  assert.equal(W.left(s, t0 + 99 * 6e4, o), 15 * 6e4, 'paused time stands still');
  s = W.start(s, t0 + 20 * 6e4, o);
  assert.equal(s.end, t0 + 35 * 6e4, 'resumes with what was left');
  // The work phase ends: the break runs on its own, from when work ended, not from when the page noticed.
  assert.deepEqual(W.advance(s, t0 + 36 * 6e4, o), { phase: 'rest', end: t0 + 40 * 6e4, left: 0 });
  assert.equal(W.advance(s, t0 + 34 * 6e4, o), s, 'not yet');
  // Away past the break too: back to work, waiting for Start. Never a second round on its own.
  assert.deepEqual(W.advance(s, t0 + 5 * 3600e3, o), W.IDLE);
  assert.deepEqual(W.advance({ phase: 'rest', end: t0, left: 0 }, t0 + 1, o), W.IDLE);
  assert.equal(W.clock(25 * 6e4), '25:00');
  assert.equal(W.clock(61_001), '1:02', 'a part second shows as the next second');
  assert.equal(W.clock(0), '0:00');
  // Settings shorter than what was left: never more than the phase.
  assert.equal(W.left({ phase: 'work', end: 0, left: 20 * 6e4 }, t0, { work: 10, rest: 5 }), 10 * 6e4);
  assert.deepEqual(W.cleanTimer({ phase: 'nap', end: -1, left: 'x' }), W.IDLE);
  assert.deepEqual(W.cleanTimer({ phase: 'rest', end: 5, left: 0 }), { phase: 'rest', end: 5, left: 0 });
  assert.equal(W.pause({ phase: 'work', end: t0, left: 0 }, t0 + 1).left, 1000, 'a pause at the bell keeps a second');
});

test('breathing: phases, counts, cycles, and a hold of zero skipped', () => {
  const b = { inhale: 4, hold: 4, exhale: 6, cycles: 2 };
  assert.deepEqual(W.breath(0, b), { phase: 'in', count: 4, cycle: 1, next: 4000 });
  assert.deepEqual(W.breath(4500, b), { phase: 'hold', count: 4, cycle: 1, next: 3500 });
  assert.deepEqual(W.breath(13_999, b), { phase: 'out', count: 1, cycle: 1, next: 1 });
  assert.deepEqual(W.breath(14_000, b), { phase: 'in', count: 4, cycle: 2, next: 4000 });
  assert.deepEqual(W.breath(28_000, b), { done: true });
  assert.equal(W.breath(4000, { ...b, hold: 0 }).phase, 'out');
});

test('quotes: one a day, or the next every n seconds, and the student\'s own steps', () => {
  const at = new Date(2026, 9, 15, 9).getTime();
  assert.equal(W.quoteAt(5, at, 'daily', 30), W.quoteAt(5, at + 12 * 3600e3, 'daily', 30), 'same all day');
  assert.notEqual(W.quoteAt(5, at, 'daily', 30), W.quoteAt(5, at + 24 * 3600e3, 'daily', 30));
  assert.equal((W.quoteAt(5, at, 'cycle', 30) + 1) % 5, W.quoteAt(5, at + 30_000, 'cycle', 30));
  assert.equal(W.quoteAt(5, at, 'cycle', 30, -1), (W.quoteAt(5, at, 'cycle', 30) + 4) % 5);
  assert.equal(W.quoteAt(0, at, 'cycle', 30), -1);
});

test('layout: every tile once, in the kept order, with defaults; moves and floating spots', () => {
  const fresh = W.layout(undefined);
  assert.deepEqual(fresh.tiles.map((t) => t.id), W.TILES);
  assert.deepEqual(fresh.tiles.filter((t) => t.on).map((t) => t.id), ['notes', 'agenda', 'timer', 'quotes']);
  const kept = W.layout({ tiles: [{ id: 'music', on: true, size: 'l', float: true, x: 0.5, y: 2 }, { id: 'music' }, { id: 'evil' }, { id: 'timer', size: 'xl' }, null], music: 'javascript:x' });
  assert.deepEqual(kept.tiles.slice(0, 2), [{ id: 'music', on: true, size: 'l', float: true, x: 0.5, y: null }, { id: 'timer', on: true, size: 's', float: false, x: null, y: null }]);
  assert.equal(kept.tiles.length, W.TILES.length);
  assert.equal(kept.music, '');
  assert.equal(W.layout({ music: ' https://youtu.be/jfKfPfyJRdk ' }).music, 'https://youtu.be/jfKfPfyJRdk');
  const ids = (l) => l.tiles.map((t) => t.id).join(' ');
  assert.equal(ids(W.move(fresh, 'timer', -1)), 'notes timer agenda quotes music breathe buddy');
  assert.equal(ids(W.move(fresh, 'notes', -1)), ids(fresh), 'the first stays first');
  assert.equal(ids(W.move(fresh, 'buddy', 1)), ids(fresh), 'the last stays last');
  assert.equal(ids(W.move(fresh, 'buddy', 0, 'agenda')), 'notes buddy agenda timer quotes music breathe');
  assert.equal(ids(W.move(fresh, 'buddy', 0, 'nope')), ids(fresh));
  assert.deepEqual(W.set(fresh, 'timer', { size: 'zz', on: false }).tiles[2], { id: 'timer', on: false, size: 's', float: false, x: null, y: null });
  // Floating: inside the margin, onto an edge within SNAP of it, and kept as where in the free room it is.
  const E = W.EDGE;
  assert.deepEqual(W.place(-50, 5000, 200, 100, 1000, 800), { left: E, top: 800 - 100 - E, x: 0, y: 1 });
  assert.deepEqual(W.place(E + W.SNAP - 1, 300, 200, 100, 1000, 800), { left: E, top: 300, x: 0, y: (300 - E) / (800 - 100 - 2 * E) });
  const mid = W.place(400, 300, 200, 100, 1000, 800);
  assert.deepEqual(W.spot(mid.x, mid.y, 200, 100, 1000, 800), mid, 'a kept spot comes back where it was');
  const small = W.spot(mid.x, mid.y, 200, 100, 600, 400);
  assert.ok(small.left + 200 <= 600 - E && small.top + 100 <= 400 - E, 'a smaller window still shows it');
  assert.deepEqual(W.spot(null, null, 200, 100, 1000, 800), { left: 1000 - 200 - E, top: 800 - 100 - E, x: 1, y: 1 });
  assert.deepEqual(W.place(0, 0, 500, 500, 300, 300), { left: E, top: E, x: 0, y: 0 }, 'bigger than the window: its corner');
});

test('settings: the widgets item goes through GZ_SANITIZE with its own rules', () => {
  const s = D.GZ_SANITIZE({ widgets: { work: 500, rest: 'x', sound: 'yes', quotes: 'calm', quoteEvery: 3 } }).widgets;
  assert.deepEqual(s, { work: 25, rest: 5, sound: false, quotes: 'calm', quoteMode: 'cycle', quoteEvery: 30, inhale: 4, hold: 4, exhale: 6, cycles: 6, land: false });
  assert.equal(D.GZ_DEFAULTS.enhance.notes, false);
  assert.equal(D.GZ_DEFAULTS.enhance.widgets, false);
});

test('notes: kept per site and user, a newer note wins, links are links and nothing else', async () => {
  const key = W.notesKey('https://school.instructure.com', '42');
  assert.ok(W.NOTES_KEY.test(key));
  for (const k of ['notes:javascript:x/1', 'notes:https://a.b/x', 'todo:https://a.b/1']) assert.ok(!W.NOTES_KEY.test(k), k);
  const box = {};
  const local = { get: async (k) => ({ [k[0]]: box[k[0]] }), set: async (p) => (Object.assign(box, p), true), remove: async (k) => (delete box[k[0]], true) };
  assert.deepEqual(await W.saveNote({ key, text: 'read ch. 4', at: 10 }, local), { ok: true, kept: true, note: { text: 'read ch. 4', at: 10 } });
  assert.deepEqual(await W.saveNote({ key, text: 'older', at: 5 }, local), { ok: true, kept: false, note: { text: 'read ch. 4', at: 10 } });
  await W.saveNote({ key, text: 'x'.repeat(W.NOTES_MAX + 50), at: 11 }, local);
  assert.equal(box[key].text.length, W.NOTES_MAX);
  await W.saveNote({ key, text: '', at: 12 }, local);
  assert.deepEqual(box[key], { text: '', at: 12 }, 'an emptied note keeps only when it was emptied');
  assert.equal((await W.saveNote({ key: 'notes:https://x/1/2', text: 'a', at: 1 }, local)).ok, false);
  assert.equal((await W.saveNote({ key, text: 7, at: 1 }, local)).ok, false);

  // Text at 100, cleared at 300, then a text typed at 200 that arrives late: the clearing stands.
  const k2 = W.notesKey('https://school.instructure.com', '43');
  await W.saveNote({ key: k2, text: 'draft', at: 100 }, local);
  await W.saveNote({ key: k2, text: '', at: 300 }, local);
  assert.deepEqual(await W.saveNote({ key: k2, text: 'late', at: 200 }, local), { ok: true, kept: false, note: { text: '', at: 300 } });
  assert.deepEqual(box[k2], { text: '', at: 300 });

  assert.deepEqual(W.links('See https://example.com/a?b=1. And (https://en.wikipedia.org/wiki/Foo_(bar)), ok'), [
    { text: 'See ' }, { text: 'https://example.com/a?b=1', href: 'https://example.com/a?b=1' }, { text: '. And (' },
    { text: 'https://en.wikipedia.org/wiki/Foo_(bar)', href: 'https://en.wikipedia.org/wiki/Foo_(bar)' }, { text: '), ok' },
  ]);
  assert.deepEqual(W.links('javascript:alert(1) and data:text/html,x'), [{ text: 'javascript:alert(1) and data:text/html,x' }]);
  assert.deepEqual(W.links('<b>http://x.test/"onmouseover=1</b>'), [{ text: '<b>' }, { text: 'http://x.test/', href: 'http://x.test/' }, { text: '"onmouseover=1</b>' }]);
  assert.deepEqual(W.links(''), []);
});

test('agenda: one day\'s due work, plans and focus sessions, in the student\'s time zone', () => {
  const tz = 'America/New_York';
  const day = L.keyDay('2026-10-15');
  const at = (iso) => Date.parse(iso);
  const items = [
    { type: 'assignment', id: '1', title: 'Essay', course: 'ENG', url: '/a/1', at: at('2026-10-16T03:59:00Z'), sub: { submitted: true } }, // 11:59 PM on the 15th in New York
    { type: 'quiz', id: '2', title: 'Quiz', course: 'BIO', url: '/q/2', at: at('2026-10-16T05:00:00Z') }, // the 16th there
    { type: 'announcement', id: '3', title: 'News', at: at('2026-10-15T12:00:00Z') },
    { type: 'assignment', id: '4', title: 'Lab', course: 'BIO', url: '/a/4', at: at('2026-10-20T12:00:00Z') },
    { type: 'assignment', id: '5', title: 'Gone', at: at('2026-10-15T12:00:00Z'), ov: { dismissed: true } },
  ];
  const data = {
    tasks: [{ id: 't1', title: 'Buy notebook', due: { day: '2026-10-15' } }],
    items: { 'assignment:4': { on: '2026-10-15', sessions: [{ at: at('2026-10-15T18:00:00Z'), min: 30 }] } },
  };
  const rows = W.agenda(L, { items, data, day, tz });
  assert.deepEqual(rows.map((r) => [r.kind, r.title, r.done]), [
    ['due', 'Buy notebook', false], ['plan', 'Lab', false], ['session', 'Lab', false], ['due', 'Essay', true],
  ]);
  assert.equal(rows.find((r) => r.kind === 'session').min, 30);
  assert.deepEqual(W.agenda(L, { items, data, day: day + 1, tz }).map((r) => r.title), ['Quiz']);
  assert.deepEqual(W.agenda(L, { items: [], data: null, day, tz }), []);
});

test('feedback: a prefilled GitHub issue with version, browser and system only', () => {
  const url = new URL(W.feedback({ version: '2.3.0', ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36', lang: 'de', lms: 'Canvas' }));
  assert.equal(url.origin + url.pathname, 'https://github.com/frostdev-ops/glaze/issues/new');
  const body = url.searchParams.get('body');
  for (const s of ['- Glaze: 2.3.0', '- Browser: Chrome 155', '- System: macOS', '- LMS: Canvas', '- Language: de']) assert.ok(body.includes(s), s);
  // Only what is passed in, and never anything about the school: an address handed over by mistake stays out.
  const leak = new URL(W.feedback({ version: '2.3.0', ua: '', lang: 'en', lms: 'Canvas', origin: 'https://school.instructure.com', title: 'BIO 1100' }));
  assert.ok(!leak.href.includes('instructure') && !leak.href.includes('BIO'));
  assert.deepEqual([...leak.searchParams.keys()], ['labels', 'body']);
  assert.deepEqual(W.browser('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'), { name: 'Safari 18.0', os: 'iOS' });
  assert.deepEqual(W.browser('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36 Edg/150.0.0.0'), { name: 'Edge 150', os: 'Windows' });
  assert.deepEqual(W.browser(''), { name: 'Unknown', os: 'Unknown' });
});

test('study buddy: happy after a win, awake while the timer runs or after a pat, asleep otherwise', () => {
  const now = 1_000_000_000;
  assert.deepEqual(W.mood({}, now), { mood: 'sleepy', until: 0 });
  assert.deepEqual(W.mood({ running: true }, now), { mood: '', until: 0 });
  assert.deepEqual(W.mood({ patAt: now - 1000 }, now), { mood: '', until: now - 1000 + 6e4 });
  assert.deepEqual(W.mood({ happyAt: now - 6e4, running: true }, now), { mood: 'happy', until: now - 6e4 + 10 * 6e4 });
  assert.equal(W.mood({ happyAt: now - 11 * 6e4 }, now).mood, 'sleepy');
  assert.equal(W.ticks({ items: { 'assignment:1': { done: true }, 'quiz:2': { done: false }, 'quiz:3': {} }, tasks: [{ done: 5 }, { done: 0 }] }), 2);
  assert.equal(W.ticks(undefined), 0);
});

test('layout: a tile another file declares (MORE) comes after the built-in ones, off and at its size, and keeps its place', () => {
  const more = { pet: { size: 'm' }, notes: { size: 'l' }, 'Bad id': {}, x: {} };
  const lay = W.layout(undefined, more);
  assert.deepEqual(lay.tiles.map((t) => t.id), [...W.TILES, 'pet'], 'a built-in id or a bad one is not added');
  assert.deepEqual(lay.tiles.at(-1), { id: 'pet', on: false, size: 'm', float: false, x: null, y: null });
  const kept = W.layout({ tiles: [{ id: 'pet', on: true, size: 's', float: true, x: 0.5, y: 0 }, { id: 'notes' }] }, more);
  assert.deepEqual(kept.tiles.slice(0, 2).map((t) => [t.id, t.on, t.size, t.float]), [['pet', true, 's', true], ['notes', true, 'm', false]]);
  assert.ok(!W.layout(kept).tiles.some((t) => t.id === 'pet'), 'without its declaration, not a tile');
});

test('notes: an Ultra account (_N_N) has its own key on its own site', () => {
  assert.ok(W.NOTES_KEY.test(W.notesKey('https://school.blackboard.test', '_5_1')));
  for (const k of ['notes:https://school.blackboard.test/_5', 'notes:https://school.blackboard.test/_5_1/x', 'notes:https://school.blackboard.test/5_1']) assert.ok(!W.NOTES_KEY.test(k), k);
});

// ---- B7b: Ultra's boards (the Courses page and the Dashboard), free placement and the landing ----------------------
test('boards: each its own layout; the Courses page starts from the tiles in its panel, the Dashboard from the defaults', () => {
  // Today's layout, as B5 and Canvas kept it: music floating, notes off, the rest as they were.
  const old = { tiles: [{ id: 'music', on: true, size: 'l', float: true, x: 0.5, y: 0.2 }, { id: 'notes', on: false }, { id: 'timer', size: 'm' }], music: 'https://youtu.be/jfKfPfyJRdk' };
  const lay = W.layout(old);
  assert.deepEqual(lay.tiles.slice(0, 3).map((t) => [t.id, t.on, t.size, t.float]), [['music', true, 'l', true], ['notes', false, 'm', false], ['timer', true, 'm', false]], "Canvas's own is as it was");
  assert.equal(lay.music, old.music, 'the music link is shared');
  const c = lay.boards.courses;
  assert.deepEqual(c.map((t) => t.id), lay.tiles.map((t) => t.id), 'the same tiles in the same order');
  assert.deepEqual(c.map((t) => t.on), lay.tiles.map((t) => t.on), 'every tile that was on is on, none lost');
  assert.ok(c.every((t) => t.size === 's' && t.x === null && t.y === null && t.z === 0 && !t.fold), "small enough for Ultra's column, placed where the panel was");
  const d = lay.boards.dash;
  assert.deepEqual(d.filter((t) => t.on).map((t) => [t.id, t.size]), [['notes', 'm'], ['agenda', 'm'], ['timer', 's'], ['quotes', 'm']], "Canvas's Dashboard defaults");
  // Kept boards come back as they were; what isn't a spot, a size or a z is dropped, and a spot needs both x and y.
  const kept = W.layout({ ...lay, boards: { courses: [{ id: 'notes', on: true, size: 'l', x: 40, y: 64, r: true, z: 3, fold: true }, { id: 'timer', x: 5 }, { id: 'evil', x: 1, y: 1 }, { id: 'agenda', x: -4, y: 2.5, z: 1e6 }], dash: 'nope' } });
  assert.deepEqual(kept.boards.courses.slice(0, 3), [
    { id: 'notes', on: true, size: 'l', x: 40, y: 64, r: true, z: 3, fold: true },
    { id: 'timer', on: true, size: 's', x: null, y: null, r: false, z: 0, fold: false },
    { id: 'agenda', on: true, size: 'm', x: null, y: null, r: false, z: 0, fold: false },
  ]);
  assert.equal(kept.boards.courses.length, W.TILES.length, 'every tile once');
  assert.deepEqual(kept.boards.dash, lay.boards.dash, 'a broken board starts from its defaults');
  assert.deepEqual(W.layout(kept), kept, 'stable');
  // The Courses board changes alone; Canvas's and the Dashboard's don't.
  const moved = W.bset(kept, 'courses', 'timer', { x: 10, y: 20, size: 'xl' });
  assert.deepEqual([moved.boards.courses[1].x, moved.boards.courses[1].y, moved.boards.courses[1].size], [10, 20, 's']);
  assert.equal(moved.boards.dash, kept.boards.dash);
  assert.equal(moved.tiles, kept.tiles);
  // A tile another file declares is on neither board until added.
  const more = W.layout(old, { pet: { size: 'm' } });
  assert.deepEqual(more.boards.dash.at(-1), { id: 'pet', on: false, size: 'm', x: null, y: null, r: false, z: 0, fold: false });
});

test('snap: onto the room edges, other tiles and the page lines within reach, else the grid; Alt places freely; always inside', () => {
  const other = { left: 400, top: 100, w: 288, h: 150 };
  // Near the left edge: onto EDGE, with its guide.
  assert.deepEqual(W.snap(18, 103, 288, 200, 1000, Infinity, [other]), { left: W.EDGE, top: 100, guides: { x: W.EDGE, y: 100 } });
  // Near the other tile: left edges lined up, and under it with the gap between.
  assert.deepEqual(W.snap(395, 260, 288, 200, 1000, Infinity, [other]), { left: 400, top: 266, guides: { x: 400, y: 266 } });
  // Beside it on the right, its centre lined up (a 100-high tile centred on 175).
  const beside = W.snap(400 + 288 + 16 + 4, 128, 200, 100, 2000, Infinity, [other]);
  assert.deepEqual([beside.left, beside.top, beside.guides], [704, 125, { x: 704, y: 175 }]);
  // Right edges lined up with a line of the page (Ultra's column).
  assert.deepEqual(W.snap(705, 500, 288, 100, 1200, Infinity, [], { lines: [990] }).left, 702);
  // Nothing near: the grid.
  assert.deepEqual(W.snap(203, 501, 288, 100, 1200, Infinity), { left: 208, top: 496, guides: { x: null, y: null } });
  // Alt: exactly where it was let go, no guide.
  assert.deepEqual(W.snap(395, 260, 288, 200, 1000, Infinity, [other], { free: true }), { left: 395, top: 260, guides: { x: null, y: null } });
  // Never outside the room, Alt or not.
  assert.deepEqual(W.snap(-50, -9, 288, 100, 1000, 600, [], { free: true }), { left: 0, top: 0, guides: { x: null, y: null } });
  assert.deepEqual(W.snap(990, 590, 288, 100, 1000, 600).left, 1000 - 288);
  assert.equal(W.snap(990, 590, 288, 100, 1000, 600).top, 600 - 100);
  assert.equal(W.snap(10, 10, 1200, 100, 1000, 600).left, 0, 'wider than the room: its left edge');
});

test('arrange: spots kept from their side, new tiles in free room, and a stack when the window is too narrow for the layout', () => {
  const dims = { notes: { w: 384, h: 300 }, agenda: { w: 384, h: 200 }, timer: { w: 288, h: 180 }, quotes: { w: 384, h: 160 } };
  const fresh = (ids) => ids.map((id) => ({ id, on: true, x: null, y: null, r: false, z: 0 }));
  // The Dashboard: rows from the top left, a gap apart, on the grid.
  const rows = W.arrange(fresh(['notes', 'agenda', 'timer', 'quotes']), dims, 1000);
  assert.deepEqual(Object.fromEntries(Object.entries(rows.at).map(([k, v]) => [k, [v.left, v.top]])), { notes: [0, 0], agenda: [400, 0], timer: [400, 224], quotes: [0, 320] });
  assert.equal(rows.stack, false);
  assert.equal(rows.bottom, 480);
  for (const a of Object.values(rows.at)) for (const b of Object.values(rows.at)) if (a !== b) assert.ok(!(a.left < b.left + b.w && b.left < a.left + a.w && a.top < b.top + b.h && b.top < a.top + a.h), 'none overlap');
  // The Courses page: down the column, from the right, where the panel was.
  const col = W.arrange(fresh(['notes', 'timer']), dims, 1000, { col: { right: 16, top: 60 } });
  assert.deepEqual([col.at.notes.left, col.at.notes.top, col.at.timer.left, col.at.timer.top], [1000 - 16 - 384, 60, 1000 - 16 - 288, 60 + 300 + W.GAP]);
  assert.ok(col.at.notes.r && col.at.timer.r);
  // Kept spots: from the left, or from the right edge, which follows the window.
  const kept = [{ id: 'notes', on: true, x: 24, y: 40, r: false }, { id: 'timer', on: true, x: 16, y: 40, r: true }];
  const wide = W.arrange(kept, dims, 1400);
  assert.deepEqual([wide.at.notes.left, wide.at.timer.left], [24, 1400 - 16 - 288]);
  assert.deepEqual(wide.order, ['notes', 'timer'], 'reading order');
  assert.equal(wide.stack, false);
  // Narrower than the room they were placed in: the one from the left and the one from the right would meet: a stack,
  // and the spots are untouched. As wide or wider: never.
  const narrow = W.arrange(kept, dims, 600, { w0: 1400 });
  assert.equal(narrow.stack, true);
  assert.deepEqual(kept[1], { id: 'timer', on: true, x: 16, y: 40, r: true });
  assert.equal(W.arrange(kept, dims, 1600, { w0: 1400 }).stack, false);
  // One from the left laid over one from the right on purpose (they met where they were placed) stays so.
  const laid = [{ id: 'notes', on: true, x: 500, y: 40, r: false }, { id: 'timer', on: true, x: 200, y: 100, r: true }];
  assert.equal(W.arrange(laid, dims, 1000, { w0: 1000 }).stack, false);
  assert.equal(W.arrange(laid, dims, 900, { w0: 1000 }).stack, false, 'narrower, but they met already');
  // A tile that would cross the room's edge stacks them too; overlaps the student made (same side) don't.
  assert.equal(W.arrange([{ id: 'notes', on: true, x: 500, y: 0, r: false }], dims, 800).stack, true);
  const overlap = W.arrange([{ id: 'notes', on: true, x: 24, y: 40, r: false }, { id: 'agenda', on: true, x: 100, y: 100, r: false }], dims, 1000);
  assert.equal(overlap.stack, false, 'tiles laid over each other on purpose stay so');
  // A tile placed in free room keeps clear of the kept ones.
  const mixed = W.arrange([{ id: 'notes', on: true, x: 0, y: 0, r: false }, ...fresh(['timer'])], dims, 1000);
  assert.ok(mixed.at.timer.left >= 384 + W.GAP || mixed.at.timer.top >= 300 + W.GAP);
});

test('spots, the Courses column kept clear, and the stacking order', () => {
  // A spot is kept from the nearer side, in whole pixels.
  assert.deepEqual(W.spotOf({ left: 100.4, top: 50.6, w: 288 }, 1000), { x: 100, y: 51, r: false });
  assert.deepEqual(W.spotOf({ left: 696, top: 60, w: 288 }, 1000), { x: 16, y: 60, r: true });
  // The column keeps room for every tile over it, however far down (its To Do is never under one), and not for one
  // beside it.
  const rects = [{ left: 700, top: 60, w: 288, h: 200 }, { left: 700, top: 276, w: 288, h: 100 }, { left: 600, top: 900, w: 288, h: 100 }, { left: 100, top: 60, w: 288, h: 1900 }];
  assert.equal(W.reserve(rects, 690, 1000, 60), 1000 - 60);
  assert.equal(W.reserve([], 690, 1000, 60), 0);
  // On top: the one moved goes over the others, the rest keep their order.
  const b = [{ id: 'a', z: 2 }, { id: 'b', z: 0 }, { id: 'c', z: 1 }];
  assert.deepEqual(W.front(b, 'b').map((x) => [x.id, x.z]), [['a', 2], ['b', 3], ['c', 1]]);
  assert.deepEqual(W.front(W.front(b, 'b'), 'c').map((x) => [x.id, x.z]), [['a', 1], ['b', 2], ['c', 3]]);
});

test("landing: only Ultra's start page right after sign-in, never a page the student asked for", () => {
  const o = 'https://school.blackboard.test';
  const go = (from, now, referrer = '') => W.landing({ from, now, referrer, origin: o });
  assert.equal(go('/ultra', '/ultra'), true, "Ultra's bare address, as sign-in leaves it");
  assert.equal(go('/ultra/', '/ultra/stream'), true, 'and after Ultra moved on to its own start page');
  assert.equal(go('/ultra/stream', '/ultra/stream', `${o}/webapps/login/`), true, 'its stream, from the sign-in page');
  assert.equal(go('/ultra/course', '/ultra/course', `${o}/auth-saml/saml/SSO`), true, 'its Courses page, from single sign-on');
  assert.equal(go('/ultra/stream', '/ultra/stream'), false, 'a bookmark or a typed address');
  assert.equal(go('/ultra/stream', '/ultra/stream', 'https://mail.example/inbox'), false, 'a link from elsewhere');
  assert.equal(go('/ultra/stream', '/ultra/stream', `${o}/ultra/calendar`), false, 'from another Ultra page');
  assert.equal(go('/ultra/stream', '/ultra/stream', 'https://evil.test/webapps/login/'), false, "another site's sign-in");
  assert.equal(go('/ultra/calendar', '/ultra/calendar', `${o}/webapps/login/`), false, 'a page asked for');
  assert.equal(go('/ultra/courses/_7_1/outline', '/ultra/courses/_7_1/outline', `${o}/webapps/login/`), false);
  assert.equal(go('/ultra', '/ultra/calendar'), false, 'the student went on already');
  assert.equal(go('/ultra', W.DASH.path), false, 'there already: nothing to do, nothing to loop');
  assert.equal(go(W.DASH.path, W.DASH.path), false);
  assert.deepEqual(W.DASH, { path: '/ultra/institution-page', name: 'Dashboard' }, 'the route and name the nav (B7c) uses');
});
