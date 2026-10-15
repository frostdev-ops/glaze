// Dashboard notes, widgets and the feature hub (Canvas): the parts that don't touch the page, so node can test them.
// Classic script; module.exports for node. Loaded on demand (features/widgets.js asks for it), by the editor for its
// settings, and by the background worker for the notes' writes: a second injection keeps the first.
var GZ_WIDGETS = globalThis.GZ_WIDGETS || (() => {
  const DAY = 864e5;

  // The widgets' settings (storage.sync `widgets`; the switches are enhance.notes and enhance.widgets), added to GZ_SPEC
  // from here so the first content script doesn't carry them. Minutes for the timer, seconds for quotes and breathing. The
  // notes' size is their tile's.
  const SPEC = {
    work: [25, [1, 120]], rest: [5, [1, 60]], sound: [false, 'bool'],
    quotes: ['all', ['all', 'focus', 'calm', 'courage']], quoteMode: ['cycle', ['cycle', 'daily']], quoteEvery: [30, [10, 600]],
    inhale: [4, [2, 10]], hold: [4, [0, 10]], exhale: [6, [2, 12]], cycles: [6, [1, 30]],
  };
  (typeof GZ_SPEC !== 'undefined' ? GZ_SPEC : require('../defaults.js').GZ_SPEC).widgets = SPEC;

  // ---- the layout (storage.local widgetLayout: this device's screen, so not synced) ------------------------------
  // Tiles in their order, each on or off, small/medium/large, in the Dashboard's grid or floating (x, y: where in the
  // room the screen leaves, 0–1, so a smaller window still shows it). The music link too.
  const TILES = ['notes', 'agenda', 'timer', 'quotes', 'music', 'breathe', 'buddy'];
  const ON = new Set(['notes', 'agenda', 'timer', 'quotes']);
  const SIZES = ['s', 'm', 'l'];
  const SIZE = { notes: 'm', agenda: 'm', timer: 's', quotes: 'm', music: 'm', breathe: 's', buddy: 's' };
  const frac = (v) => (Number.isFinite(v) && v >= 0 && v <= 1 ? v : null);
  // more: tiles other files add (features/widgets.js MORE: { id: { size } }), after the built-in ones and off until added.
  const MORE_ID = /^[a-z][a-z0-9]{1,15}$/;
  const tile = (x, more = {}) => ({
    id: x.id, on: typeof x.on === 'boolean' ? x.on : ON.has(x.id), size: SIZES.includes(x.size) ? x.size : SIZE[x.id] || (SIZES.includes(more[x.id]?.size) ? more[x.id].size : 's'),
    float: x.float === true, x: frac(x.x), y: frac(x.y),
  });
  const layout = (raw, more = {}) => {
    const ids = [...TILES, ...Object.keys(more).filter((id) => MORE_ID.test(id) && !TILES.includes(id))];
    const seen = new Set();
    const tiles = [];
    for (const x of Array.isArray(raw?.tiles) ? raw.tiles : []) {
      if (!ids.includes(x?.id) || seen.has(x.id)) continue;
      seen.add(x.id);
      tiles.push(tile(x, more));
    }
    for (const id of ids) if (!seen.has(id)) tiles.push(tile({ id }, more));
    return { tiles, music: music(raw?.music) ? raw.music.trim() : '' };
  };
  // A tile moved by `by` places in the order (-1 earlier, +1 later), or to before another tile (`to`, its id).
  const move = (lay, id, by, to) => {
    const tiles = [...lay.tiles];
    const from = tiles.findIndex((t) => t.id === id);
    if (from < 0) return lay;
    const [t] = tiles.splice(from, 1);
    const at = to ? tiles.findIndex((x) => x.id === to) : from + by;
    tiles.splice(to && at < 0 ? from : Math.max(0, Math.min(tiles.length, at)), 0, t);
    return { ...lay, tiles };
  };
  const set = (lay, id, patch) => ({ ...lay, tiles: lay.tiles.map((t) => (t.id === id ? tile({ ...t, ...patch }) : t)) });

  // Where a floating widget of w × h goes in a vw × vh window: kept inside a margin, and onto an edge when it comes
  // within SNAP pixels of it. → { left, top } in pixels and { x, y } to keep.
  const EDGE = 12, SNAP = 24;
  const place = (left, top, w, h, vw, vh) => {
    const axis = (v, size, room) => {
      const max = Math.max(EDGE, room - size - EDGE);
      const c = Math.min(max, Math.max(EDGE, v));
      const p = c - EDGE < SNAP ? EDGE : max - c < SNAP ? max : c;
      return [p, max > EDGE ? (p - EDGE) / (max - EDGE) : 0];
    };
    const [l, x] = axis(left, w, vw), [t, y] = axis(top, h, vh);
    return { left: l, top: t, x, y };
  };
  // A kept { x, y } back to pixels in this window (none kept: the bottom right corner).
  const spot = (x, y, w, h, vw, vh) => place(EDGE + (x ?? 1) * Math.max(0, vw - w - 2 * EDGE), EDGE + (y ?? 1) * Math.max(0, vh - h - 2 * EDGE), w, h, vw, vh);

  // ---- music: a link the student typed, as one of four players' embeds -------------------------------------------
  // Only links that name something to play are taken, and the embed address is built from the parts checked here,
  // never from the link itself. YouTube plays from youtube-nocookie.com (YouTube's privacy-enhanced mode), which also
  // plays YouTube Music's tracks and playlists. → { provider, src } or null.
  const YT = /^[\w-]{11}$/, LIST = /^[\w-]{10,64}$/;
  const SPOTIFY = new Set(['track', 'album', 'playlist', 'episode', 'show', 'artist']);
  const APPLE = new Set(['album', 'playlist', 'song', 'station', 'music-video']);
  const YT_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtube-nocookie.com', 'www.youtube-nocookie.com']);
  const yt = (v, list) => {
    const l = LIST.test(list || '') ? list : '';
    if (v) return YT.test(v) ? `https://www.youtube-nocookie.com/embed/${v}${l ? `?list=${l}` : ''}` : null;
    return l ? `https://www.youtube-nocookie.com/embed/videoseries?list=${l}` : null;
  };
  const music = (raw) => {
    if (typeof raw !== 'string' || raw.length > 500) return null;
    let u;
    try { u = new URL(raw.trim()); } catch { return null; }
    if (u.protocol !== 'https:' || u.username || u.password || u.port) return null;
    const h = u.hostname.toLowerCase(), p = u.pathname.split('/').filter(Boolean), q = u.searchParams;
    const out = (provider, src) => (src ? { provider, src } : null);
    if (h === 'open.spotify.com') {
      if (/^intl-[a-z]{2}(?:-[a-z]{2,4})?$/i.test(p[0] || '')) p.shift();
      if (p[0] === 'embed') p.shift();
      return out('Spotify', p.length === 2 && SPOTIFY.has(p[0]) && /^[A-Za-z0-9]{22}$/.test(p[1]) ? `https://open.spotify.com/embed/${p[0]}/${p[1]}` : null);
    }
    if (h === 'music.youtube.com') {
      return out('YouTube Music', p.length === 1 && p[0] === 'watch' ? yt(q.get('v') || '-', q.get('list')) : p.length === 1 && p[0] === 'playlist' ? yt('', q.get('list')) : null);
    }
    if (h === 'youtu.be') return out('YouTube', p.length === 1 ? yt(p[0], q.get('list')) : null);
    if (YT_HOSTS.has(h)) {
      if (p.length === 1 && p[0] === 'watch') return out('YouTube', yt(q.get('v') || '-', q.get('list')));
      if (p.length === 1 && p[0] === 'playlist') return out('YouTube', yt('', q.get('list')));
      return out('YouTube', p.length === 2 && ['embed', 'shorts', 'live'].includes(p[0]) ? yt(p[1], q.get('list')) : null);
    }
    if (h === 'music.apple.com' || h === 'embed.music.apple.com') {
      const [cc, kind, ...rest] = p;
      const id = rest.at(-1) || '';
      const slug = rest.length === 2 ? rest[0] : '';
      if (!/^[a-z]{2}$/i.test(cc || '') || !APPLE.has(kind) || rest.length < 1 || rest.length > 2) return null;
      if (!/^(?:\d{1,15}|pl\.[\w-]{1,64}|ra\.[\w-]{1,64})$/.test(id) || (slug && !/^[\w%.~-]{1,200}$/.test(slug))) return null;
      const i = q.get('i');
      return out('Apple Music', `https://embed.music.apple.com/${cc.toLowerCase()}/${kind}/${slug ? `${slug}/` : ''}${id}${/^\d{1,15}$/.test(i || '') ? `?i=${i}` : ''}`);
    }
    return null;
  };

  // ---- the focus timer (storage.local widgetTimer, so every tab shows the same one) ------------------------------
  // { phase: 'work' | 'rest', end: when it rings (running) or 0, left: what was left when paused, or 0 (all of it) }.
  const len = (phase, o) => (phase === 'rest' ? o.rest : o.work) * 6e4;
  const IDLE = { phase: 'work', end: 0, left: 0 };
  const cleanTimer = (raw) => ({
    phase: raw?.phase === 'rest' ? 'rest' : 'work',
    end: Number.isFinite(raw?.end) && raw.end > 0 && raw.end < 1e14 ? raw.end : 0,
    left: Number.isFinite(raw?.left) && raw.left > 0 && raw.left <= 120 * 6e4 ? raw.left : 0,
  });
  const left = (s, now, o) => (s.end ? Math.max(0, s.end - now) : Math.min(s.left || len(s.phase, o), len(s.phase, o)));
  const start = (s, now, o) => (s.end ? s : { ...s, end: now + left(s, now, o), left: 0 });
  const pause = (s, now) => (s.end ? { ...s, end: 0, left: Math.max(1000, s.end - now) } : s);
  // Where a running timer is now: past its end, work goes on to a break that starts at once, and a break back to
  // work, waiting for Start. However long the page was away, it never runs more than that one break on its own.
  const advance = (s, now, o) => {
    if (!s.end || now < s.end) return s;
    if (s.phase === 'work' && s.end + len('rest', o) > now) return { phase: 'rest', end: s.end + len('rest', o), left: 0 };
    return IDLE;
  };
  const clock = (ms) => {
    const sec = Math.ceil(ms / 1000);
    return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
  };

  // ---- the study buddy (owner-approved art: assets/art/stickers/critters/study-buddy*.webp) -----------------------
  // Happy for ten minutes after a win (a focus block finished, an item ticked off); awake while the timer runs or for a
  // minute after a pat; asleep otherwise. → { mood: '' | 'happy' | 'sleepy', until: when that changes, or 0 }.
  const HAPPY = 10 * 6e4, PAT = 6e4;
  const mood = ({ happyAt = 0, patAt = 0, running = false }, now) => {
    if (now - happyAt < HAPPY) return { mood: 'happy', until: happyAt + HAPPY };
    if (running) return { mood: '', until: 0 };
    if (now - patAt < PAT) return { mood: '', until: patAt + PAT };
    return { mood: 'sleepy', until: 0 };
  };
  // Items done in Better To Do's data for one account (raw, as stored): ticks on Canvas items and tasks ticked off.
  const ticks = (raw) => Object.values(raw?.items || {}).filter((x) => x?.done === true).length + (Array.isArray(raw?.tasks) ? raw.tasks.filter((x) => x?.done).length : 0);

  // ---- breathing ---------------------------------------------------------------------------------------------
  // t ms after Start: { phase: 'in' | 'hold' | 'out', count (seconds left in it), cycle (from 1), next (ms to the next
  // phase) }, or { done: true } after the last cycle.
  const breath = (t, o) => {
    const steps = [['in', o.inhale], ['hold', o.hold], ['out', o.exhale]].filter(([, s]) => s > 0);
    const cycle = steps.reduce((n, [, s]) => n + s, 0) * 1000;
    const k = Math.floor(Math.max(0, t) / cycle);
    if (k >= o.cycles) return { done: true };
    let at = Math.max(0, t) - k * cycle;
    for (const [phase, s] of steps) {
      if (at < s * 1000) return { phase, count: Math.ceil((s * 1000 - at) / 1000), cycle: k + 1, next: s * 1000 - at };
      at -= s * 1000;
    }
    return { done: true };
  };

  // ---- quotes ------------------------------------------------------------------------------------------------
  // Which of n to show: the same one all (local) day, or the next one every `every` seconds; `step` is the student's
  // own previous/next.
  const quoteAt = (n, now, mode, every, step = 0) => {
    if (!n) return -1;
    const d = new Date(now);
    const k = mode === 'daily' ? Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY : Math.floor(now / (every * 1000));
    return (((k + step) % n) + n) % n;
  };

  // ---- dashboard notes (storage.local, one per Canvas site and user, written through the worker) ------------------
  const NOTES_MAX = 20000;
  const notesKey = (origin, uid) => `notes:${origin}/${uid}`;
  const NOTES_KEY = /^notes:https?:\/\/[a-z\d.-]+(?::\d+)?\/(\d+|_\d+_\d+)$/i; // a Canvas user id, or Ultra's _N_N
  const cleanNote = (raw) => ({ text: typeof raw?.text === 'string' ? raw.text.slice(0, NOTES_MAX) : '', at: Number.isFinite(raw?.at) && raw.at > 0 ? raw.at : 0 });
  // In the worker's write queue (lib/background.js 'glaze:notes'): m { key, text, at } is kept unless what's stored is
  // newer (another tab typed later), which comes back instead. An emptied note is kept as its time alone ({ text: '', at }),
  // as what-if's Clear all keeps its time: a text typed before the clearing that arrives after it is refused.
  const saveNote = async (m, local) => {
    if (typeof m?.key !== 'string' || !NOTES_KEY.test(m.key) || typeof m.text !== 'string' || !Number.isFinite(m.at)) return { ok: false, error: 'bad' };
    const cur = cleanNote((await local.get([m.key]))[m.key]);
    if (cur.at > m.at) return { ok: true, kept: false, note: cur };
    const note = cleanNote(m);
    return (await local.set({ [m.key]: note })) ? { ok: true, kept: true, note } : { ok: false, error: 'write' };
  };
  // Plain text, with web addresses as links: [{ text }, { text, href }…]. Only http(s); punctuation that ends a
  // sentence after an address isn't part of it, nor is a closing bracket the address didn't open.
  const links = (text) => {
    const out = [];
    let last = 0;
    for (const m of String(text).matchAll(/\bhttps?:\/\/[^\s<>"]+/gi)) {
      let url = m[0].replace(/[.,;:!?'*]+$/, '');
      while (/[)\]]$/.test(url) && url.split(url.at(-1) === ')' ? '(' : '[').length < url.split(url.at(-1)).length) url = url.slice(0, -1).replace(/[.,;:!?'*]+$/, '');
      let href;
      try { const u = new URL(url); if (u.protocol === 'https:' || u.protocol === 'http:') href = u.href; } catch { /* not an address */ }
      if (!href) continue;
      if (m.index > last) out.push({ text: text.slice(last, m.index) });
      out.push({ text: url, href });
      last = m.index + url.length;
    }
    if (last < String(text).length) out.push({ text: String(text).slice(last) });
    return out;
  };

  // ---- the agenda: one day of Better To Do's data (lib/todo.js, L) ----------------------------------------------
  // items: slim planner items (L.slim); data: the student's own ({ tasks, items }); day: a day number in tz.
  // Due that day, planned for it ("do on"), and the focus sessions on it, soonest first; whole days first.
  const KINDS = new Set(['assignment', 'quiz', 'discussion_topic', 'wiki_page', 'planner_note', 'assessment_request', 'sub_assignment']);
  // extra: rows other packages add for the day (the class schedule's classes, lib/classes.js), already in this shape.
  const agenda = (L, { items = [], data, day, tz, extra = [] }) => {
    const d = L.clean(data);
    const rows = [...extra];
    const named = new Map();
    for (const i of items) {
      if (!i?.id || !KINDS.has(i.type) || i.ov?.dismissed) continue;
      const key = `${i.type}:${i.id}`;
      named.set(key, i);
      if (!i.at || (i.allDay ? Math.floor(i.at / DAY) : L.dayOf(i.at, tz)) !== day) continue;
      rows.push({ key, kind: 'due', title: i.title, course: i.course, url: i.url, at: i.allDay ? null : i.at, done: L.isDone(i, 'auto', d.items[key]?.done) });
    }
    for (const x of d.tasks) {
      named.set(`task:${x.id}`, x);
      const due = x.due ? (x.due.day ? L.keyDay(x.due.day) : L.dayOf(x.due.at, tz)) : null;
      if (due === day) rows.push({ key: `task:${x.id}`, kind: 'due', title: x.title, course: '', url: '', at: x.due.day ? null : x.due.at, done: !!x.done });
    }
    for (const [key, local] of Object.entries(d.items)) {
      const what = named.get(key);
      if (!what) continue;
      const base = { key, title: what.title, course: what.course || '', url: what.url || '', done: what.type ? L.isDone(what, 'auto', local.done) : !!what.done };
      if (L.keyDay(local.on) === day) rows.push({ ...base, kind: 'plan', at: null });
      for (const s of local.sessions || []) if (L.dayOf(s.at, tz) === day) rows.push({ ...base, kind: 'session', at: s.at, min: s.min });
    }
    return rows.sort((a, b) => (a.at ?? -1) - (b.at ?? -1) || a.title.localeCompare(b.title));
  };

  // ---- reporting a problem -------------------------------------------------------------------------------------
  // A new GitHub issue, filled in here from what the browser says about itself: Glaze's version, the browser and system
  // and the page's language. Never the school's address or anything from the page. It is in the link, so GitHub gets it
  // when the page opens; nothing is posted until the student submits the issue.
  const REPO = 'https://github.com/frostdev-ops/glaze';
  const browser = (ua) => {
    const v = (re) => ua.match(re)?.[1];
    const name = v(/Edg\/(\d+)/) ? `Edge ${v(/Edg\/(\d+)/)}` : v(/Firefox\/(\d+)/) ? `Firefox ${v(/Firefox\/(\d+)/)}`
      : v(/Chrome\/(\d+)/) ? `Chrome ${v(/Chrome\/(\d+)/)}` : v(/Version\/([\d.]+).*Safari\//) ? `Safari ${v(/Version\/([\d.]+).*Safari\//)}` : 'Unknown';
    const os = /iPhone|iPad|iPod/.test(ua) ? 'iOS' : /CrOS/.test(ua) ? 'ChromeOS' : /Android/.test(ua) ? 'Android' : /Mac OS X|Macintosh/.test(ua) ? 'macOS'
      : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'Unknown';
    return { name, os };
  };
  const feedback = ({ version, ua, lang, lms = '' }) => {
    const b = browser(String(ua || ''));
    const body = [
      "**What's wrong?**", '', '',
      '**Where?**', 'The kind of page (Dashboard, a course\'s Modules, Grades…). Please leave out your school\'s address, names and grades.', '', '',
      '**Environment**', `- Glaze: ${version}`, `- Browser: ${b.name}`, `- System: ${b.os}`, `- LMS: ${lms}`, `- Language: ${lang}`,
    ].join('\n');
    return `${REPO}/issues/new?${new URLSearchParams({ labels: 'bug', body })}`;
  };

  return { SPEC, TILES, SIZES, mood, ticks, layout, move, set, place, spot, EDGE, SNAP, music, IDLE, cleanTimer, len, left, start, pause, advance, clock, breath, quoteAt, NOTES_MAX, notesKey, NOTES_KEY, cleanNote, saveNote, links, agenda, browser, feedback };
})();

if (typeof module !== 'undefined') module.exports = GZ_WIDGETS; else GZ_WIDGETS;
