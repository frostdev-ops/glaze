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
  assert.deepEqual(s, { work: 25, rest: 5, sound: false, quotes: 'calm', quoteMode: 'cycle', quoteEvery: 30, inhale: 4, hold: 4, exhale: 6, cycles: 6 });
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

test('declared widgets keep layout and float settings without changing built-in order or defaults', () => {
  const more = { pet: { size: 'm' }, '../bad': { size: 'l' }, buddy: { size: 'l' } };
  const fresh = W.layout(null, more);
  assert.deepEqual(fresh.tiles.map((x) => x.id), [...W.TILES, 'pet']);
  assert.deepEqual(fresh.tiles.at(-1), { id: 'pet', on: false, size: 'm', float: false, x: null, y: null });
  const saved = W.layout({ tiles: [{ id: 'pet', on: true, size: 'l', float: true, x: .2, y: .3 }] }, more);
  assert.equal(saved.tiles[0].id, 'pet');
  assert.deepEqual(saved.tiles[0], { id: 'pet', on: true, size: 'l', float: true, x: .2, y: .3 });
  assert.equal(W.set(saved, 'pet', { size: 's' }).tiles[0].size, 's');
  assert.equal(W.layout(saved).tiles.some((x) => x.id === 'pet'), false);
});
