// The sidebar's state (the page's own sidebar content, then the widgets docked under it), the parts that don't touch
// the page, so node can test them. Classic script; module.exports for node. Loaded by the background worker for its
// writes ('glaze:sidebar') and on demand by the pages, after lib/widgets.js. A second injection keeps the first.
//
// One record per account, device-local like the widgets' layout: storage.local sidebar:<lms>:<origin>/<uid>. The layout
// (storage.local widgetLayout, lib/widgets.js) stays where each widget sits on a board or floats, with its spot and
// size; the record only says where a widget goes instead (dest), in what order the dock shows them, and the dock's
// own fold and height. Docking never rewrites the layout, so a widget moved back finds its old spot.
var GZ_SIDEBAR = globalThis.GZ_SIDEBAR || (() => {
  const W = () => (typeof GZ_WIDGETS !== 'undefined' && GZ_WIDGETS ? GZ_WIDGETS : require('./widgets.js'));
  const own = (o, k) => !!o && typeof o === 'object' && Object.hasOwn(o, k);
  const obj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);

  // ---- the key ----------------------------------------------------------------------------------------------------
  // sidebar:<canvas|ultra>:<origin>/<uid>: Canvas's numeric user id, Ultra's _1_1. https, or a development build's local
  // Canvas (http://localhost, as lib/widgets.js course). The worker checks the origin and the sending document's account.
  const LMS = ['canvas', 'ultra'];
  const KEY = /^sidebar:(canvas|ultra):(https:\/\/[a-z\d.-]+(?::\d+)?|http:\/\/localhost(?::\d+)?)\/(\d{1,20}|_\d{1,20}_\d{1,20})$/i;
  const key = (lms, origin, uid) => {
    const k = `sidebar:${lms}:${origin}/${uid}`;
    return parse(k) ? k : null;
  };
  // → { lms, origin, uid } or null.
  const parse = (k) => {
    const m = typeof k === 'string' && k.length <= 300 ? KEY.exec(k) : null;
    return m && LMS.includes(m[1]) && (m[1] === 'canvas' ? /^\d+$/.test(m[3]) : /^_\d+_\d+$/.test(m[3]))
      ? { lms: m[1], origin: m[2], uid: m[3] } : null;
  };

  // ---- the record (v1) ----------------------------------------------------------------------------------------------
  // rev: one more each committed change. mig: To Do's one-time move into the dock is done (migrate). on: reserved (the
  // switch is enhance.sidebar). width: the desktop width the student chose; the page shows less when the window is
  // narrow (mode) but never writes that back. open: expanded on desktop. fold: per page family, the This page and My
  // widgets sections folded. todoScope: To Do follows the page's course, or shows all courses. dock: the dock's order,
  // each with its fold and height; a widget moved out or removed stays (gone) so docking it again restores both and its
  // place. dest: where a widget goes instead of the layout's say ('off': nowhere). ret: where Move back returns it.
  // offer: Ultra's boards disagreed about To Do, so the page offers to dock it (migrate). chose: the width and To Do's
  // scope the student chose here (width, scope); until then the sidebar settings' (sidebar.width, sidebar.todo) hold. A
  // record from before chose counts a width or scope that isn't the default as chosen.
  const ID = /^[a-z][a-z0-9]{1,15}$/; // a tile (lib/widgets.js TILES, MORE_ID, mod ids); never a course card
  const DESTS = ['dock', 'board', 'float', 'off'];
  const FAMILY = /^[a-z][a-z0-9-]{1,23}$/;
  const WIDTH = 352, MIN_WIDTH = 288, MAX_WIDTH = 480;
  const MIN_H = 48, MAX_H = 3000;
  const DOCK_MAX = 24, MAP_MAX = 64, FAMILY_MAX = 32, OPS_MAX = 32;
  const BOARDS = { canvas: ['cdash'], ultra: ['courses', 'dash'] };
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, Math.round(v)));
  const height = (h) => (Number.isFinite(h) ? clamp(h, MIN_H, MAX_H) : null);
  const retOf = (r) => (obj(r) && ['board', 'float'].includes(r.to) ? { to: r.to, ...(r.to === 'board' && BOARDS.ultra.concat(BOARDS.canvas).includes(r.board) && { board: r.board }) } : null);
  const entry = (x) => {
    const h = height(x.h);
    return { id: x.id, ...(x.gone === true && { gone: true }), ...(x.fold === true && { fold: true }), ...(h !== null && { h }) };
  };
  const map = (o, keep) => Object.fromEntries((obj(o) ? Object.entries(o) : []).filter(([k]) => ID.test(k)).map(([k, v]) => [k, keep(v)]).filter(([, v]) => v != null).slice(0, MAP_MAX));
  // Any stored value → a whole v1 record: each field in its bounds, unknown ones dropped.
  const clean = (raw) => {
    const r = obj(raw) ? raw : {};
    const seen = new Set();
    const dock = (Array.isArray(r.dock) ? r.dock : []).filter((x) => obj(x) && typeof x.id === 'string' && ID.test(x.id) && !seen.has(x.id) && seen.add(x.id)).slice(0, DOCK_MAX).map(entry);
    const fold = Object.fromEntries((obj(r.fold) ? Object.entries(r.fold) : []).filter(([k, v]) => FAMILY.test(k) && obj(v)).slice(0, FAMILY_MAX)
      .map(([k, v]) => [k, { ...(typeof v.page === 'boolean' && { page: v.page }), ...(typeof v.widgets === 'boolean' && { widgets: v.widgets }) }]));
    return {
      v: 1, rev: Number.isInteger(r.rev) && r.rev >= 0 && r.rev < 2 ** 31 ? r.rev : 0, mig: r.mig === 1 ? 1 : 0,
      on: r.on !== false, width: Number.isFinite(r.width) ? clamp(r.width, MIN_WIDTH, MAX_WIDTH) : WIDTH, open: r.open !== false,
      fold, todoScope: r.todoScope === 'all' ? 'all' : 'follow', dock,
      dest: map(r.dest, (v) => (DESTS.includes(v) ? v : null)), ret: map(r.ret, retOf),
      offer: obj(r.offer) && ['pending', 'dismissed'].includes(r.offer.todo) ? { todo: r.offer.todo } : {},
      chose: {
        ...((r.chose?.width === true || (!obj(r.chose) && Number.isFinite(r.width) && clamp(r.width, MIN_WIDTH, MAX_WIDTH) !== WIDTH)) && { width: true }),
        ...((r.chose?.scope === true || (!obj(r.chose) && r.todoScope === 'all')) && { scope: true }),
      },
    };
  };

  // ---- placement ----------------------------------------------------------------------------------------------------
  // Keep declared utility and mod tiles while validating the layout, including tiles present only on a board.
  const layout = (raw) => {
    const kept = [raw?.tiles, ...['cdash', 'courses', 'dash', 'pages'].map((b) => raw?.boards?.[b])]
      .flatMap((a) => Array.isArray(a) ? a : []).filter((x) => typeof x?.id === 'string' && ID.test(x.id));
    return W().layout(raw, Object.fromEntries(kept.map((x) => [x.id, { size: x.size }])));
  };
  // Where the layout alone puts a widget on this site (as features/widgets.js draws it without the sidebar): floating
  // wins over a board, as a floating tile is on no board. board: this page's board, if any.
  const legacy = (lay, lms, id, board) => {
    const float = lms === 'ultra' ? lay.boards.pages.find((x) => x.id === id) : lay.tiles.find((x) => x.id === id && x.float);
    if (float?.on) return { where: 'float', tile: float };
    const row = board && lay.boards[board]?.find((x) => x.id === id);
    return row?.on ? { where: 'board', board, tile: row } : { where: 'off' };
  };
  // Where a widget is right now, wherever its page: its float, else the first board that shows it (for Move back).
  const whereNow = (lay, lms, id, rec) => {
    const d = rec.dest[id];
    if (d === 'off' || (d === 'board' && rec.ret[id]?.to === 'board')) return rec.ret[id] || null;
    if (d === 'float') return { to: 'float' };
    const now = legacy(lay, lms, id, null);
    if (now.where === 'float' && d !== 'board') return { to: 'float' };
    const board = BOARDS[lms].find((b) => lay.boards[b]?.find((x) => x.id === id)?.on);
    return board ? { to: 'board', board } : null;
  };
  // Each widget's one destination on this page: Map id → { where: 'dock' | 'board' | 'float' | 'off', board?, tile?, dock? }.
  // lay: the layout (lib/widgets.js layout); rec: this account's record, or null. site: 'canvas' | 'ultra'; board: this
  // page's board or null; enabled: enhance.sidebar; allowed(id): its switch is on here; dockable(id): it may dock (not
  // a course card). Without the sidebar, or without a choice in the record, the layout decides as before; a choice in the
  // record suppresses the other copies but leaves their spots in the layout. dock: its entry (fold, h).
  const resolve = (lay, rec, { site, board = null, enabled = true, allowed = () => true, dockable = () => true } = {}) => {
    const L = layout(lay);
    const r = rec ? clean(rec) : null;
    const ids = new Set([...L.tiles.map((x) => x.id), ...L.boards.pages.map((x) => x.id), ...(board && L.boards[board] ? L.boards[board].map((x) => x.id) : [])]);
    if (enabled && r) for (const id of [...Object.keys(r.dest), ...r.dock.map((x) => x.id)]) ids.add(id);
    const out = new Map();
    for (const id of ids) {
      let at = legacy(L, site, id, board);
      const d = enabled && r && dockable(id) ? r.dest[id] : undefined;
      if (d === 'dock') at = { where: 'dock', dock: r.dock.find((x) => x.id === id) || { id } };
      else if (d === 'off') at = { where: 'off' };
      else if (d === 'board') {
        const chosen = r.ret[id]?.to === 'board' ? r.ret[id].board : null;
        const row = board && (!chosen || chosen === board) && L.boards[board]?.find((x) => x.id === id);
        at = row?.on ? { where: 'board', board, tile: row } : { where: 'off' };
      }
      else if (d === 'float' && at.where !== 'float') at = { where: 'off' };
      out.set(id, allowed(id) ? at : { where: 'off' });
    }
    return out;
  };
  // The dock's widgets in order (each entry, with its fold and h), those placed there and not gone.
  const docked = (rec) => {
    const r = clean(rec);
    return r.dock.filter((x) => !x.gone && r.dest[x.id] === 'dock');
  };

  // ---- the layout's mode --------------------------------------------------------------------------------------------
  // How the page shows the sidebar: vw the window's width; left, right what Glaze's and the LMS's navigation take;
  // width the saved width; grades a table-heavy page (900px for the main column, else 720); empty both sections;
  // open the desktop preference. → { mode: 'expanded' | 'collapsed' | 'drawer' | 'none', w }: w is the width to show,
  // within 288–480 and the room there is, never written back to the record. A drawer starts closed; closing it isn't
  // the desktop preference.
  const GAP = 16, MAIN = 720, MAIN_GRADES = 900;
  // A column the student must see while working there (a quiz's timer and question list) keeps its place beside the
  // content down to this much room for the content (features/sidebar.js minMain).
  const MAIN_KEEP = 480;
  // min: the main column's room instead (the sidebar settings' sidebar.min or sidebar.grades).
  const mode = ({ vw, left = 0, right = 0, width = WIDTH, grades = false, min, empty = false, open = true } = {}) => {
    const avail = Math.max(0, (Number.isFinite(vw) ? vw : 0) - left - right);
    const want = Number.isFinite(width) ? clamp(width, MIN_WIDTH, MAX_WIDTH) : WIDTH;
    if (empty) return { mode: 'none', w: 0 };
    if (avail - want - GAP >= (Number.isFinite(min) ? min : grades ? MAIN_GRADES : MAIN)) return { mode: open ? 'expanded' : 'collapsed', w: want };
    return { mode: 'drawer', w: Math.min(want, avail) };
  };

  // What this page shows: the width and To Do's scope the student chose for the account, else the settings' (cfg: the
  // synced sidebar group, or nothing for the defaults).
  const shown = (rec, cfg = {}) => {
    const r = clean(rec);
    return {
      width: r.chose.width || !Number.isFinite(cfg.width) ? r.width : clamp(cfg.width, MIN_WIDTH, MAX_WIDTH),
      todoScope: r.chose.scope || !['follow', 'all'].includes(cfg.todo) ? r.todoScope : cfg.todo,
    };
  };

  // ---- changes ------------------------------------------------------------------------------------------------------
  // Field-level changes, as the worker's queue applies them to what is stored then, and as the page shows them at once:
  // never a whole record, which would undo another tab's change made since. Each op is one of
  //   { op: 'dock', id, at? }              into the dock (at: before the at-th docked widget, else its old place or last)
  //   { op: 'undock', id, to, board? }     out to 'board' | 'float' (the page also turns it on there: glaze:widgetLayout)
  //   { op: 'remove', id }                 nowhere; its data and its dock fold and height stay
  //   { op: 'move', id, by: -1 | 1 } | { op: 'move', id, to: id }   reorder the dock
  //   { op: 'fold', id, v }  { op: 'height', id, h: px | null }     a docked widget's own; never re-adds one
  //   { op: 'width', px }  { op: 'open', v }  { op: 'section', family, part: 'page' | 'widgets', v }
  //   { op: 'todoScope', v: 'follow' | 'all' }  { op: 'offer', v: 'dismissed' }  { op: 'migrate' }
  //   { op: 'reset' }                      the width, expanded, folded sections, To Do's scope and the docked widgets'
  //                                        fold and height as new; where each widget goes, and the dock's order, stay
  // A malformed op changes nothing. ctx: { lms, lay } (the stored layout, for Move back's return).
  const OPS = ['dock', 'undock', 'remove', 'move', 'fold', 'height', 'width', 'open', 'section', 'todoScope', 'offer', 'migrate', 'reset'];
  const ops = (list) => Array.isArray(list) && list.length > 0 && list.length <= OPS_MAX && list.every((o) => obj(o) && OPS.includes(o.op));
  const live = (r) => r.dock.filter((x) => !x.gone);
  const without = (dock, id) => dock.filter((x) => x.id !== id);
  const gone = (r, id) => ({ ...r, dock: r.dock.map((x) => (x.id === id ? { ...x, gone: true } : x)) });
  const one = (r, o, { lms = 'canvas', lay } = {}) => {
    const id = typeof o.id === 'string' && ID.test(o.id) ? o.id : null;
    if (id && ['dock', 'undock', 'remove'].includes(o.op) && !own(r.dest, id) && Object.keys(r.dest).length >= MAP_MAX) return r;
    switch (o.op) {
      case 'dock': {
        if (!id) return r;
        const had = r.dock.find((x) => x.id === id);
        let dock = r.dock;
        if (!had && dock.length >= DOCK_MAX) {
          const drop = dock.find((x) => x.gone);
          if (!drop) return r;
          dock = without(dock, drop.id);
        }
        const e = { ...(had || { id }) };
        delete e.gone;
        if (Number.isInteger(o.at) && o.at >= 0) {
          dock = without(dock, id);
          const before = live({ dock }).filter((x) => x.id !== id)[o.at];
          const i = before ? dock.indexOf(before) : dock.length;
          dock = [...dock.slice(0, i), e, ...dock.slice(i)];
        } else dock = had ? dock.map((x) => (x.id === id ? e : x)) : [...dock, e];
        const back = r.dest[id] !== 'dock' && lay ? whereNow(layout(lay), lms, id, r) : null;
        const offer = id === 'todo' ? {} : r.offer;
        return { ...r, dock, dest: { ...r.dest, [id]: 'dock' }, ret: back ? { ...r.ret, [id]: back } : r.ret, offer };
      }
      case 'undock': {
        if (!id || !['board', 'float'].includes(o.to) || (o.board !== undefined && !BOARDS[lms].includes(o.board))) return r;
        return { ...gone(r, id), dest: { ...r.dest, [id]: o.to }, ret: { ...r.ret, [id]: { to: o.to, ...(o.to === 'board' && o.board && { board: o.board }) } } };
      }
      case 'remove': return id ? { ...gone(r, id), dest: { ...r.dest, [id]: 'off' } } : r;
      case 'move': {
        if (!id || r.dest[id] !== 'dock' || !live(r).some((x) => x.id === id)) return r;
        const e = r.dock.find((x) => x.id === id);
        if (o.by === -1 || o.by === 1) {
          const l = live(r), j = l.indexOf(e) + o.by;
          if (j < 0 || j >= l.length) return r;
          const a = r.dock.indexOf(e), b = r.dock.indexOf(l[j]);
          const dock = [...r.dock];
          [dock[a], dock[b]] = [dock[b], dock[a]];
          return { ...r, dock };
        }
        if (typeof o.to !== 'string' || o.to === id || !live(r).some((x) => x.id === o.to)) return r;
        const dock = without(r.dock, id);
        const i = dock.findIndex((x) => x.id === o.to);
        return { ...r, dock: [...dock.slice(0, i), e, ...dock.slice(i)] };
      }
      case 'fold':
      case 'height': {
        // Only a docked widget's own: a removed or moved-out widget's late resize mustn't bring it back.
        if (!id || r.dest[id] !== 'dock' || typeof (o.op === 'fold' ? o.v : true) !== 'boolean') return r;
        const h = o.op === 'height' ? (o.h === null ? null : height(o.h)) : undefined;
        if (o.op === 'height' && o.h !== null && h === null) return r;
        return { ...r, dock: r.dock.map((x) => {
          if (x.id !== id) return x;
          const { fold: _f, h: _h, ...rest } = x;
          const fold = o.op === 'fold' ? o.v : x.fold === true;
          const hh = o.op === 'height' ? h : x.h ?? null;
          return { ...rest, ...(fold && { fold: true }), ...(hh !== null && { h: hh }) };
        }) };
      }
      case 'width': return Number.isFinite(o.px) ? { ...r, width: clamp(o.px, MIN_WIDTH, MAX_WIDTH), chose: { ...r.chose, width: true } } : r;
      case 'open': return typeof o.v === 'boolean' ? { ...r, open: o.v } : r;
      case 'section': {
        if (typeof o.family !== 'string' || !FAMILY.test(o.family) || !['page', 'widgets'].includes(o.part) || typeof o.v !== 'boolean') return r;
        if (!own(r.fold, o.family) && Object.keys(r.fold).length >= FAMILY_MAX) return r;
        return { ...r, fold: { ...r.fold, [o.family]: { ...r.fold[o.family], [o.part]: o.v } } };
      }
      case 'todoScope': return ['follow', 'all'].includes(o.v) ? { ...r, todoScope: o.v, chose: { ...r.chose, scope: true } } : r;
      case 'offer': return o.v === 'dismissed' && r.offer.todo ? { ...r, offer: { todo: 'dismissed' } } : r;
      case 'reset': return { ...r, width: WIDTH, open: true, fold: {}, todoScope: 'follow', chose: {}, dock: r.dock.map((x) => ({ id: x.id, ...(x.gone && { gone: true }) })) };
      default: return r; // migrate: the worker's (change), before any op
    }
  };
  // rec with ops applied in order (page side: shown at once; the worker's answer then replaces it). Not counted (rev).
  const apply = (rec, list, ctx = {}) => {
    let r = clean(rec);
    for (const o of Array.isArray(list) ? list.slice(0, OPS_MAX) : []) if (obj(o)) r = clean(one(r, o, ctx));
    return r;
  };

  // ---- migration ----------------------------------------------------------------------------------------------------
  // Once per account, in the worker's queue, from the layout stored then (raw: storage.local widgetLayout as stored, so
  // its marks are read as they are). To Do the student had moves into the dock, remembering where it was for Move back;
  // a To Do they removed stays removed. A new install (lib/widgets.js layout's sidebarFresh) starts with To Do on, but a
  // later removal still wins. On Ultra, boards that disagree about To Do are left as they are and the page offers to
  // dock it (offer). On Ultra the dock replaces the Courses page's column board, so its widgets dock too (owner,
  // 2026-10-19). todo: enhance.todo (with Better To Do off, To Do stays). Done is mig: 1; the layout and its marks are
  // never changed.
  const migrateBase = (raw, rec, { lms = 'canvas', todo = true } = {}) => {
    const r = clean(rec);
    if (r.mig) return r;
    const out = { ...r, mig: 1 };
    const lay = layout(raw);
    const dock = (id, ret, base = out, tile = null, first = false) => {
      let next = one(base, { op: 'dock', id, ...(first && { at: 0 }) }, { lms, lay });
      if (next === base) return base;
      if (tile?.fold && !base.dock.some((x) => x.id === id)) next = { ...next, dock: next.dock.map((x) => x.id === id ? { ...x, fold: true } : x) };
      return { ...next, ret: { ...next.ret, [id]: ret } };
    };
    const now = legacy(lay, lms, 'todo', null);
    if (lms === 'canvas') {
      if (!todo || own(r.dest, 'todo')) return out;
      if (now.where === 'float') return dock('todo', { to: 'float' }, out, null, true);
      // Before the Dashboard's To Do was a tile (canvasTodo), the list was always there: dock it. Since, the tile says.
      const on = lay.boards.cdash.find((x) => x.id === 'todo')?.on;
      return raw?.canvasTodo !== true || on ? dock('todo', { to: 'board', board: 'cdash' }, out, null, true) : one(out, { op: 'remove', id: 'todo' });
    }
    // Ultra: the dock replaces the Courses page's column board. Its tiles that were on (not floating, not course cards,
    // which stay in the page's room) dock in the board's order with their fold; their board entries stay as they were.
    // To Do there is decided with the Dashboard's board; when both show it, it keeps its column order and fold too.
    const c = lay.boards.courses.find((x) => x.id === 'todo')?.on, d = lay.boards.dash.find((x) => x.id === 'todo')?.on;
    let u = out;
    for (const x of lay.boards.courses) {
      if (!x.on || (x.id === 'todo' && (!todo || !d)) || !ID.test(x.id) || own(r.dest, x.id) || legacy(lay, 'ultra', x.id, null).where === 'float') continue;
      u = dock(x.id, { to: 'board', board: 'courses' }, u, x);
    }
    if (!todo || own(r.dest, 'todo')) return u;
    if (now.where === 'float') return dock('todo', { to: 'float' }, u, null, true);
    if (c && d) return u;
    if (!c && !d) return one(u, { op: 'remove', id: 'todo' });
    return { ...u, offer: { todo: 'pending' } };
  };

  // New installs dock the existing settings editor after To Do (owner, 2026-10-20). Migrated accounts and explicit
  // destinations, including removals, stay as saved.
  const migrate = (raw, rec, opts = {}) => {
    const before = clean(rec), r = migrateBase(raw, before, opts);
    return opts.settings !== false && !before.mig && raw?.sidebarFresh === true && raw?.starter === true && !own(before.dest, 'settings')
      ? one(r, { op: 'dock', id: 'settings' }) : r;
  };

  // The worker's side ('glaze:sidebar'): m { key, ops } on what is stored now, migrating first if this account hasn't
  // been, so the move is written before it takes effect. sync (optional) gives enhance.todo. → { ok, rec } (what is
  // stored after), or { ok: false, error } with the record left as stored. Nothing changed, nothing written.
  const change = async (m, local, sync, opts = {}) => {
    const at = parse(m?.key);
    if (!at || !ops(m.ops)) return { ok: false, error: 'bad' };
    const got = await local.get([m.key, 'widgetLayout']);
    const before = clean(got[m.key]);
    let r = before;
    if (!r.mig) {
      const enhance = sync ? (await sync.get('enhance')).enhance : null;
      r = migrate(got.widgetLayout, r, { lms: at.lms, todo: enhance?.todo !== false, ...opts });
    }
    r = apply(r, m.ops, { lms: at.lms, lay: got.widgetLayout });
    if (JSON.stringify(r) === JSON.stringify(before) && own(got, m.key)) return { ok: true, rec: before };
    r = { ...r, rev: (before.rev + 1) % 2 ** 31 };
    return (await local.set({ [m.key]: r })) ? { ok: true, rec: r } : { ok: false, error: 'write' };
  };

  // A course tab's frame asking the page around it to send its changes (features/coursetabs.js): its own site's and
  // account's record, ops the worker would take, small, with the request's number and the frame's gen (a string) to
  // answer with. Anything else is not sent.
  const RELAY_MAX = 8192;
  const relayable = (m, lms, origin, uid) => {
    if (!obj(m) || !Number.isSafeInteger(m.n) || m.n < 1 || typeof m.gen !== 'string' || !m.gen || m.gen.length > 64 || !ops(m.ops)) return false;
    const at = parse(m.key);
    if (!at || at.lms !== lms || at.origin !== origin || at.uid !== String(uid ?? '')) return false;
    try {
      let bytes = 0;
      for (const c of JSON.stringify(m.ops)) { const n = c.codePointAt(0); bytes += n < 0x80 ? 1 : n < 0x800 ? 2 : n < 0x10000 ? 3 : 4; if (bytes > RELAY_MAX) return false; }
      return true;
    } catch { return false; }
  };

  return { KEY, key, parse, clean, relayable, WIDTH, MIN_WIDTH, MAX_WIDTH, GAP, MAIN, MAIN_GRADES, MAIN_KEEP, OPS, OPS_MAX, ops, apply, migrate, change, resolve, docked, mode, shown };
})();

if (typeof module !== 'undefined') module.exports = GZ_SIDEBAR; else GZ_SIDEBAR;
