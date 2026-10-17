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
    // Blackboard Ultra: go on to the Dashboard when Ultra opens on its start page after sign-in (landing, below).
    land: [false, 'bool'],
  };
  (typeof GZ_SPEC !== 'undefined' ? GZ_SPEC : require('../defaults.js').GZ_SPEC).widgets = SPEC;

  // ---- the layout (storage.local widgetLayout: this device's screen, so not synced) ------------------------------
  // Tiles in their order, each on or off, small/medium/large, in the Dashboard's grid or floating (x, y: where in the
  // room the screen leaves, 0–1, so a smaller window still shows it). The music link too.
  // todo: Better To Do (features/todo.js) as a tile on Ultra's boards (on Canvas it has its own place): on the Dashboard
  // from the start, as Canvas's Dashboard has it, and on the Courses page from the start too, in the column it had.
  const TILES = ['notes', 'agenda', 'timer', 'quotes', 'music', 'breathe', 'buddy', 'todo'];
  const ON = new Set(['notes', 'agenda', 'timer', 'quotes']);
  const SIZES = ['s', 'm', 'l'];
  const SIZE = { notes: 'm', agenda: 'm', timer: 's', quotes: 'm', music: 'm', breathe: 's', buddy: 's', todo: 'm' };
  const frac = (v) => (Number.isFinite(v) && v >= 0 && v <= 1 ? v : null);
  // more: tiles other files add (features/widgets.js MORE: { id: { size } }), after the built-in ones and off until added.
  const MORE_ID = /^[a-z][a-z0-9]{1,15}$/;
  const COURSE_MAX = 48, COURSE_TOTAL = 384; // eight full school boards, bounded together
  const course = (key) => {
    if (typeof key !== 'string' || key.length > 300 || !key.startsWith('course:')) return null;
    try {
      const u = new URL(key.slice(7));
      if (u.protocol === 'https:' && /^\/_\d+_\d+$/.test(u.pathname) && key === `course:${u.origin}${u.pathname}`) return { origin: u.origin, id: u.pathname.slice(1) };
    } catch { /* not a course key */ }
    return null;
  };
  const termOf = (v) => typeof v === 'string' ? v.slice(0, 120) : '';
  const tile = (x, more = {}) => ({
    id: x.id, on: typeof x.on === 'boolean' ? x.on : ON.has(x.id), size: SIZES.includes(x.size) ? x.size : SIZE[x.id] || (SIZES.includes(more[x.id]?.size) ? more[x.id].size : 's'),
    float: x.float === true, x: frac(x.x), y: frac(x.y),
  });
  // Each tile once, in the kept order, then the ones not kept (make: a tile from what was kept, or from { id } alone).
  const each = (list, ids, make) => {
    const seen = new Set();
    const out = [];
    for (const x of Array.isArray(list) ? list : []) {
      if (!ids.includes(x?.id) || seen.has(x.id)) continue;
      seen.add(x.id);
      out.push(make(x));
    }
    for (const id of ids) if (!seen.has(id)) out.push(make({ id }));
    return out;
  };
  // boards: Blackboard Ultra's Courses page and Dashboard, each its own layout of free tiles (B7b): on or off, its size,
  // where it is (x, y in pixels from the room's top left, or x from its right when r), folded, and z, its place in the
  // stack where tiles overlap (higher on top). No spot yet: placed in free room (arrange). Both start from today's
  // tiles: the Courses page from the tiles that were in its panel, small enough for Ultra's column, and the Dashboard
  // from the defaults Canvas's Dashboard starts with. The notes, the timer, the music link and the pet are the same
  // whichever board shows them.
  // pages: Ultra's tiles floating over every Blackboard page (the owner's third surface): on (floating, and then on no
  // board, whose spot it keeps for when it comes back), where in the room the window leaves (x, y: 0–1, as Canvas's
  // floating tiles), its size, folded and z. It starts from the tiles that floated before (B5: over every Ultra page).
  const BOARDS = ['courses', 'dash'];
  const px = (v) => (Number.isInteger(v) && v >= 0 && v <= 20000 ? v : null);
  const zOf = (x) => (Number.isInteger(x.z) && x.z > 0 && x.z < 1000 ? x.z : 0);
  // w, h: the size the student dragged a tile to by its corner (px: its width, and its body's height, which scrolls
  // inside), each only once dragged; else its size's width and its content's height.
  const MIN_W = 192, MIN_H = 48;
  const sizeOf = (x) => {
    const w = Number.isInteger(x.w) && x.w >= MIN_W && x.w <= 4000 ? x.w : null;
    const h = Number.isInteger(x.h) && x.h >= MIN_H && x.h <= 3000 ? x.h : null;
    return { ...(w && { w }), ...(h && { h }) };
  };
  const btile = (x, more) => {
    const t = tile(x, more);
    const at = px(x.x) !== null && px(x.y) !== null;
    return { id: t.id, on: t.on, size: t.size, x: at ? x.x : null, y: at ? x.y : null, r: at && x.r === true, z: zOf(x), fold: x.fold === true, ...(course(t.id) && { term: termOf(x.term) }), ...sizeOf(x) };
  };
  const ptile = (x, more) => {
    const t = tile(x, more);
    return { id: t.id, on: x.on === true, size: t.size, x: t.x, y: t.y, z: zOf(x), fold: x.fold === true, ...sizeOf(x) };
  };
  const layout = (raw, more = {}) => {
    const ids = [...TILES, ...Object.keys(more).filter((id) => MORE_ID.test(id) && !TILES.includes(id))];
    const tiles = each(raw?.tiles, ids, (x) => tile(x, more));
    const start = { courses: tiles.map((x) => ({ id: x.id, on: x.on, size: 's' })), dash: TILES.map((id) => ({ id, on: ON.has(id) || id === 'todo' })) };
    const boards = Object.fromEntries(BOARDS.map((b) => {
      const list = Array.isArray(raw?.boards?.[b]) ? raw.boards[b] : start[b];
      const courses = [], counts = new Map();
      for (const x of list) {
        const c = course(x?.id);
        if (!c || courses.includes(x.id) || courses.length >= COURSE_TOTAL || (counts.get(c.origin) || 0) >= COURSE_MAX) continue;
        courses.push(x.id); counts.set(c.origin, (counts.get(c.origin) || 0) + 1);
      }
      return [b, each(list, [...ids, ...courses], (x) => btile(x, more))];
    }));
    // The Courses page's To Do became a tile (owner, 2026-10-15). Before, it couldn't be on that board, so an "off"
    // kept there was never the student's choice: a layout without the mark (todo) gets it on, small, unplaced (the
    // column, where it was); one saved since keeps what the student did.
    if (raw?.todo !== true) boards.courses = boards.courses.map((x) => (x.id === 'todo' ? { ...x, on: true, size: 's', x: null, y: null, r: false } : x));
    boards.pages = each(Array.isArray(raw?.boards?.pages) ? raw.boards.pages : tiles.map((x) => ({ ...x, on: x.on && x.float })), ids, (x) => ptile(x, more));
    // The room's width each board (and the floating tiles) was last arranged in (arrange's and floating's w0).
    const widths = Object.fromEntries([...BOARDS, 'pages'].map((b) => [b, px(raw?.widths?.[b]) || 0]));
    return { tiles, music: music(raw?.music) ? raw.music.trim() : '', boards, widths, todo: true };
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
  // within SNAP pixels of it (not when it was placed already: snap, free). → { left, top } in pixels and { x, y } to keep.
  const EDGE = 12, SNAP = 24;
  const place = (left, top, w, h, vw, vh, placed = false) => {
    const axis = (v, size, room) => {
      const max = Math.max(EDGE, room - size - EDGE);
      const c = Math.min(max, Math.max(EDGE, v));
      const p = placed ? c : c - EDGE < SNAP ? EDGE : max - c < SNAP ? max : c;
      return [p, max > EDGE ? (p - EDGE) / (max - EDGE) : 0];
    };
    const [l, x] = axis(left, w, vw), [t, y] = axis(top, h, vh);
    return { left: l, top: t, x, y };
  };
  // A kept { x, y } back to pixels in this window (none kept: the bottom right corner).
  const spot = (x, y, w, h, vw, vh) => place(EDGE + (x ?? 1) * Math.max(0, vw - w - 2 * EDGE), EDGE + (y ?? 1) * Math.max(0, vh - h - 2 * EDGE), w, h, vw, vh);

  // ---- free placement: snapping, the boards' arrangement -----------------------------------------------------------
  // A tile's width on a board, in pixels (Ultra's own rem may not be 16 px); its height is its content's.
  const WIDTH = { s: 288, m: 384, l: 512 };
  const GRID = 16, NEAR = 10, GAP = 16;
  // A tile w × h dragged to (left, top) in a room W wide and H high (Infinity: it grows), others: the other tiles'
  // { left, top, w, h }, lines: the page's own x lines (Ultra's column). It goes onto the room's edges (EDGE in), another
  // tile's edges or centre or beside it (GAP apart), or a line, whichever is nearest within NEAR; else onto the grid.
  // free (Alt): where it is. Always inside the room. → { left, top, guides: { x, y } } (the line it met on each axis, or null).
  const snap = (left, top, w, h, W, H, others = [], { free = false, lines = [] } = {}) => {
    const axis = (v, size, room, marks) => {
      let best = null;
      if (!free) for (const [want, guide] of marks) { const d = Math.abs(want - v); if (d <= NEAR && (!best || d < best.d)) best = { want, d, guide }; }
      const p = free ? v : best ? best.want : Math.round(v / GRID) * GRID;
      return [Math.round(Math.min(Math.max(0, room - size), Math.max(0, p))), best?.guide ?? null];
    };
    const marks = (size, room, side) => [
      [EDGE, EDGE], [room - EDGE - size, room - EDGE],
      ...others.flatMap((o) => {
        const a = side === 'x' ? o.left : o.top, s = side === 'x' ? o.w : o.h;
        return [[a, a], [a + s - size, a + s], [a + s + GAP, a + s + GAP], [a - GAP - size, a - GAP], [a + s / 2 - size / 2, a + s / 2]];
      }),
      ...(side === 'x' ? lines.flatMap((l) => [[l, l], [l - size, l]]) : []),
    ];
    const [l, gx] = axis(left, w, W, marks(w, W, 'x'));
    const [t, gy] = axis(top, h, H, marks(h, H, 'y').filter(([want]) => Number.isFinite(want)));
    return { left: l, top: t, guides: { x: gx, y: gy } };
  };
  // A tile at (left, top) whose bottom right corner is dragged to (x, y): the corner meets the same lines a dragged tile
  // does (snap: the room's edges, the other tiles' edges and the gaps beside them, else the grid; free: where it is).
  // → { w, h, guides }, never under minW × minH.
  const stretch = (left, top, x, y, W, H, others = [], { free = false, lines = [], minW = MIN_W, minH = MIN_H } = {}) => {
    const s = snap(x, y, 0, 0, W, H, others, { free, lines });
    return { w: Math.max(minW, s.left - left), h: Math.max(minH, s.top - top), guides: s.guides };
  };
  const meet =(a, b) => a.left < b.left + b.w && b.left < a.left + a.w && a.top < b.top + b.h && b.top < a.top + a.h;
  // Where a board's on tiles go in a room W wide. dims: id -> { w, h }. A placed tile is at its spot; one without goes in
  // free room, GAP from the others: down a column `col.right` from the room's right edge from `col.top` (Ultra's Courses
  // page: where its panel was, one right under another), or else in rows from the top left on the grid. On the Courses
  // page a placed tile keeps its side, and the layout doesn't fit (stack: the page lays the tiles out in a column
  // instead, and keeps their spots) when a tile would cross the room's edge, or, in a room narrower than w0 (the one
  // they were placed in), one kept from the left would meet one kept from the right that didn't meet it there. The
  // Dashboard's placed tiles are one block, as they were in w0, the room left on either side of it growing or shrinking
  // alike: a zoom or another window moves no tile against another. A block wider than the room flows: every tile in free
  // room, in reading order, the spots kept for a wider room. A tile wider than the room stacks them. Tiles laid over each
  // other on purpose stay so.
  // → { at: { id: { left, top, w, h, r } }, order (reading order), stack, bottom }.
  // ponytail: free room is found by a scan of grid cells, fine for a dozen tiles.
  const arrange = (tiles, dims, W, { col = null, w0 = 0, courseArea = null } = {}) => {
    const at = {}, rects = [];
    let stack = false, queue = tiles;
    const put = (id, left, top, r) => { const { w, h } = dims[id]; at[id] = { left, top, w, h, r }; rects.push(at[id]); };
    const kept = tiles.filter((t) => t.x !== null && dims[t.id]);
    if (col) {
      for (const t of kept) {
        const { w } = dims[t.id];
        const left = t.r ? W - t.x - w : t.x;
        if (left < 0 || left + w > W) stack = true;
        put(t.id, left, t.y, t.r);
      }
      const rs = Object.values(at);
      const was = (a) => ({ ...a, left: a.r ? a.left + w0 - W : a.left });
      if (W < w0 && rs.some((a) => !a.r && rs.some((b) => b.r && meet(a, b) && !meet(was(a), was(b))))) stack = true;
    } else if (kept.length) {
      const R = w0 || W;
      const lefts = new Map(kept.map((t) => [t, t.r ? R - t.x - dims[t.id].w : t.x]));
      const lo = Math.min(...lefts.values()), hi = Math.max(...kept.map((t) => lefts.get(t) + dims[t.id].w)), room = R - (hi - lo);
      if (hi - lo <= W) {
        const by = Math.min(W - hi, Math.max(-lo, Math.round(room > 0 ? ((W - R) * lo) / room : (W - R) / 2)));
        for (const t of kept) put(t.id, lefts.get(t) + by, t.y, t.r);
      } else queue = [...kept.sort((a, b) => a.y - b.y || lefts.get(a) - lefts.get(b)), ...tiles.filter((t) => !lefts.has(t))];
    }
    const fixed = rects.length;
    const free = (r) => !rects.some((o) => meet({ left: r.left - GAP, top: r.top - GAP, w: r.w + 2 * GAP, h: r.h + 2 * GAP }, o));
    let term = null, termTop = courseArea?.top || 0;
    for (const t of queue) {
      if (at[t.id] || !dims[t.id]) continue;
      const { w, h } = dims[t.id];
      if (w > W) stack = true;
      const inCourses = courseArea && course(t.id);
      if (col && !inCourses) {
        const left = W - col.right - w;
        let top = col.top, hit;
        while ((hit = rects.find((o) => meet({ left: left - GAP, top: top - GAP, w: w + 2 * GAP, h: h + 2 * GAP }, o)))) top = hit.top + hit.h + GAP;
        put(t.id, left, top, true);
        continue;
      }
      if (inCourses && term !== t.term) {
        if (term !== null) termTop = Math.max(termTop, ...tiles.filter((x) => course(x.id) && at[x.id]).map((x) => at[x.id].top + at[x.id].h + GAP));
        term = t.term;
      }
      let spot = null;
      const left0 = inCourses ? courseArea.left : 0;
      const right = inCourses ? Math.min(W, left0 + Math.max(w, courseArea.width)) : Math.max(W, w);
      for (let top = inCourses ? termTop : 0; !spot; top += GRID) for (let left = left0; left + w <= Math.max(right, left0 + w) && !spot; left += GRID) if (free({ left, top, w, h })) spot = [left, top];
      put(t.id, spot[0], spot[1], false);
    }
    // A fresh Dashboard (no tile placed yet), or a flowing one, sits in the middle of its room, the width it leaves split
    // on both sides.
    if (!col && !fixed && rects.length) {
      const by = Math.floor((W - Math.max(...rects.map((r) => r.left + r.w))) / 2);
      if (by > 0) for (const r of rects) r.left += by;
    }
    const order = Object.keys(at).sort((a, b) => at[a].top - at[b].top || at[a].left - at[b].left);
    return { at, order, stack, bottom: Math.max(0, ...rects.map((r) => r.top + r.h)) };
  };
  // A tile's spot to keep, from where it shows: from whichever side of the room it's nearer, so it stays by that edge
  // as the window grows or shrinks.
  const spotOf = ({ left, top, w }, W) => {
    const r = left + w / 2 > W / 2;
    return { x: Math.max(0, Math.round(r ? W - left - w : left)), y: Math.max(0, Math.round(top)), r };
  };
  // Ultra's Courses page: how far down its column (left–right) the tiles over it reach from `top`, so the column's own
  // contents (Better To Do, Ultra's To Do) start below them: a tile never covers them.
  const reserve = (rects, left, right, top) => Math.max(0, ...rects.filter((r) => r.left < right && r.left + r.w > left).map((r) => r.top + r.h - top));
  // A board's tiles with one put on top of the others (z 1…n, in the order they were stacked).
  const front = (board, id) => {
    const order = [...board].sort((a, b) => a.z - b.z).map((x) => x.id).filter((x) => x !== id).concat(id);
    return board.map((x) => ({ ...x, z: order.indexOf(x.id) + 1 }));
  };
  // One tile of a board changed; a spot, size or z that isn't one is dropped (btile).
  const bset = (lay, b, id, patch, more = {}) => ({ ...lay, boards: { ...lay.boards, [b]: lay.boards[b].map((x) => (x.id === id ? (b === 'pages' ? ptile : btile)({ ...x, ...patch }, more) : x)) } });
  // Ultra's floating tiles in a room W × H (the window right of the nav, below a course's top bar): each at its place
  // (spot), unless the room is narrower than w0 (where they were placed) and two that didn't meet there would meet
  // here, or one is wider than the room: then the page stacks them in a column at its edge, and keeps their places.
  // → { at: { id: { left, top, w, h } }, stack }.
  const floating = (tiles, dims, W, H, w0 = 0) => {
    const ts = tiles.filter((t) => dims[t.id]);
    const box = (t, room) => { const { w, h } = dims[t.id]; const p = spot(t.x, t.y, w, h, room, H); return { left: p.left, top: p.top, w, h }; };
    const at = Object.fromEntries(ts.map((t) => [t.id, box(t, W)]));
    const stack = ts.some((t) => dims[t.id].w + 2 * EDGE > W || dims[t.id].h + 2 * EDGE > H) || (W < w0 && ts.some((a) => ts.some((b) => a !== b && meet(at[a.id], at[b.id]) && !meet(box(a, w0), box(b, w0)))));
    return { at, stack };
  };
  // Where a tile w × h starts floating: the room's bottom right corner, else up its right edge, then the next column
  // to the left, GAP clear of the others; out of room, the corner.
  const corner = (rects, w, h, W, H) => {
    for (let left = W - EDGE - w; left >= EDGE; left -= w + GAP) {
      let top = H - EDGE - h, hit;
      while (top >= EDGE && (hit = rects.find((o) => meet({ left: left - GAP, top: top - GAP, w: w + 2 * GAP, h: h + 2 * GAP }, o)))) top = hit.top - GAP - h;
      if (top >= EDGE) return { left, top };
    }
    return { left: Math.max(EDGE, W - EDGE - w), top: Math.max(EDGE, H - EDGE - h) };
  };

  // Changes to the layout, as the worker's queue applies them to what is stored then ('glaze:widgetLayout'), and as the
  // page shows them at once: never a whole copy of a tab's layout, which would undo another tab's change made since.
  // m: { ops: [{ s: 'canvas' | 'courses' | 'dash' | 'pages', id, set?: { fields }, move?: -1 | 1, to?: id, front?: true }],
  // widths?: { board: px }, music?: link }. more: the tiles other files declare (layout's).
  const SURFACES = new Set(['canvas', ...BOARDS, 'pages']);
  const apply = (lay, m, more = {}) => {
    let l = layout(lay, more);
    for (const o of Array.isArray(m?.ops) ? m.ops.slice(0, 64) : []) {
      if (!SURFACES.has(o?.s) || typeof o.id !== 'string') continue;
      const { id: _, ...patch } = o.set && typeof o.set === 'object' ? o.set : {};
      if (o.s === 'canvas') {
        if (o.set) l = set(l, o.id, patch);
        if (o.move === -1 || o.move === 1 || typeof o.to === 'string') l = move(l, o.id, o.move === -1 || o.move === 1 ? o.move : 0, typeof o.to === 'string' ? o.to : undefined);
        continue;
      }
      if (course(o.id)) {
        if (!BOARDS.includes(o.s)) continue;
        const rows = l.boards[o.s];
        if (o.remove === true) { l = { ...l, boards: { ...l.boards, [o.s]: rows.filter((x) => x.id !== o.id) } }; continue; }
        if (!rows.some((x) => x.id === o.id) && o.set && rows.filter((x) => course(x.id)?.origin === course(o.id).origin).length < COURSE_MAX && rows.filter((x) => course(x.id)).length < COURSE_TOTAL)
          l = { ...l, boards: { ...l.boards, [o.s]: [...rows, btile({ id: o.id, ...patch }, more)] } };
      }
      if (o.set) l = bset(l, o.s, o.id, patch, more);
      if (o.front === true) l = { ...l, boards: { ...l.boards, [o.s]: front(l.boards[o.s], o.id) } };
    }
    for (const [b, w] of Object.entries(m?.widths && typeof m.widths === 'object' ? m.widths : {})) if (b in l.widths && px(w) !== null) l = { ...l, widths: { ...l.widths, [b]: w } };
    if (typeof m?.music === 'string') l = { ...l, music: m.music };
    return layout(l, more);
  };
  // The worker's side: m's changes on what is stored now. → { ok, layout } (what is stored after).
  const change = async (m, local) => {
    const more = m?.more && typeof m.more === 'object' ? m.more : {};
    const next = apply((await local.get(['widgetLayout'])).widgetLayout, m, more);
    return (await local.set({ widgetLayout: next })) ? { ok: true, layout: next } : { ok: false, error: 'write' };
  };

  // ---- the Dashboard on Blackboard Ultra ---------------------------------------------------------------------------
  // Its page (Ultra's Institution page, which it shows beside Ultra's own) and its name, for the nav (B7c).
  const DASH = { path: '/ultra/institution-page', name: 'Dashboard' };
  // Whether a page Ultra opened (from: its address when it loaded) is its start page right after sign-in, to go on to
  // the Dashboard once: Ultra's bare address, or its stream or Courses page opened from a sign-in page of the same site;
  // and the student is still there (now). A page asked for by address, bookmark or link is left alone.
  const START = /^\/ultra(?:\/(?:stream|course))?\/?$/;
  const landing = ({ from, now, referrer = '', origin }) => {
    if (!START.test(from) || !START.test(now)) return false;
    if (/^\/ultra\/?$/.test(from)) return true;
    try { const r = new URL(referrer); return r.origin === origin && /^\/(?:webapps\/(?:login|bb-auth-provider)|auth-saml)\b/.test(r.pathname); } catch { return false; }
  };

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

  return { SPEC, TILES, SIZES, course, COURSE_MAX, COURSE_TOTAL, mood, ticks, layout, move, set, place, spot, EDGE, SNAP, BOARDS, WIDTH, MIN_W, MIN_H, GRID, GAP, snap, stretch, arrange, spotOf, reserve, front, bset, floating, corner, apply, change, DASH, landing, music, IDLE, cleanTimer, len, left, start, pause, advance, clock, breath, quoteAt, NOTES_MAX, notesKey, NOTES_KEY, cleanNote, saveNote, links, agenda, browser, feedback };
})();

if (typeof module !== 'undefined') module.exports = GZ_WIDGETS; else GZ_WIDGETS;
