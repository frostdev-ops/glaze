// Sync to Google Drive, beyond Documents: Glaze's own data kept in the Glaze folder's Data folder, one file a record, and a
// daily snapshot (the Back up… zip) in its Backups folder, one a day, the newest 5 kept. Run by documents/drive-sync.js (its more hooks:
// the same runs, page token, account, locks and backoff) in the worker. A record is one stored key of what Back up… covers
// (background/backup.js): every Settings key (storage.sync), and on this device (storage.local) Better To Do's tasks and the
// pet, dashboard notes, class schedules, GPA past terms, widgets, Looks history and favorites, the personal dictionary and
// saved sources, Gradescope's placings and answers (not what was read from Gradescope, a cache), and Notes (area 'notes', the
// worker's Notes database through notesArea below): each account's folders, each note (its index entry and text) and each
// picture or attachment (immutable, by id). Never: share keys (the share sessions' end-to-end keys and the creator's delete
// tokens: in Drive they would let anyone who can read the folder, Google included, read or delete every share), AI keys and
// connections (the worker's IndexedDB), Agents' pairing, caches of what a school showed, session data, or anything Back
// up… leaves out.
// A record's file: { glaze: 'record', v: 1, cat, area, key, at, value } or, once deleted, { …, deleted: true } (a tombstone:
// the file stays). appProperties { glaze: 'rec', cat, key: h (32 hex of the SHA-256 of area and key), sum, at }. sum: the
// SHA-256 of { area, key, value | deleted }, as with documents: each side's change is told by content, Glaze's own uploads
// come back as no news. at: when it changed on the device that wrote it (this device's stamps: storage.local
// driveSyncStamps, set by the worker as each key changes, on or off while bound to an account, and let go once synced).
// The rules: changed on one side, that side's goes to the other. Changed on both: the later change wins (last writer, by
// at), per key, Settings key by key; a note and an account's folders field by field (mergeNote, mergeFolders). First
// meeting (a second device connecting, or Sync turned on again): a key on one side only is taken by the other; on both, the
// same is linked, Settings take the later change, Notes merge field by field, and every other record is joined by
// Restore's own rules (background/backup.js apply: newer dashboard note, each class and term by its time, words and
// favorites together, every task either Better To Do list has…), so a device's own data is never wiped by connecting; the
// join goes up at the time of the latest change it holds.
// Two files for one record (first syncs that overlapped): every device keeps the lowest id, met as a first meeting. A
// deleted key is a tombstone that deletes it on the other side; a tombstone never deletes a record met for the first time.
// State: driveSyncRec:<h> { area, key, cat, id, lsum, rsum, at, seen } (or, for a picture a note here uses that Drive doesn't
// have yet, { area, key, cat, id: null, want: the note's key }) and driveSyncFile:<id> 'r:<h>'; the folders and the
// last snapshot on driveSync (data, backups, snap); a record file or the day's zip larger than one request on its way in
// documents/drive-sync.js's transfers (driveSyncMoves 'R:<h>', 'r:<h>', 'snap'). A record file past MAX is never sent or
// brought ('large'), the record marked too large while this device holds it (documents/drive-sync.js driveSyncLarge); with
// transfers off (env.staged unset, as 4.0.1's builds ran), the same past one request, and the day's zip skipped (snapSkip 'large').
// Classic script for the worker; module.exports for node.
var GZ_DRIVE_STORE = globalThis.GZ_DRIVE_STORE || (() => {
  const REC = 'driveSyncRec:', FILE = 'driveSyncFile:', STAMPS = 'driveSyncStamps', STATE = 'driveSync', LARGE = 'driveSyncLarge';
  const FOLDER = 'application/vnd.google-apps.folder', JSON_TYPE = 'application/json', ZIP = 'application/zip';
  const HASH = /^[0-9a-f]{32}$/, SUM = /^[0-9a-f]{64}$/;
  const SNAP = { every: 864e5, keep: 5 };
  const UNTIMED = 1; // the time of a record whose change time isn't known here: older than any change made with one
  const MAX = 32 << 20; // a 20 MB attachment as base64, with room
  const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
  const ACCT = 'notesIdx:https?:\\/\\/[a-z\\d.-]+(?::\\d+)?\\/(?:\\d{1,20}|_\\d{1,20}_\\d{1,20})';
  const NOTES_KEY = new RegExp(`^${ACCT}$`, 'i');
  // A Notes record's key: <account>|folders, <account>|file|<id>, <account>|<note id>.
  const NREC = new RegExp(`^(${ACCT})\\|(?:(folders)|file\\|(${UUID})|(${UUID}))$`, 'i');
  // What syncs, by category: the store's keys (background/backup.js STORES, planner/todo.js STORE_KEY, pet/pet.js KEY,
  // writer/writer-sources.js's keys) in their area.
  const CATS = [
    { cat: 'tasks', area: 'local', test: (k) => /^todo:https?:\/\/[a-z\d.-]+(?::\d+)?\/(?:\d+|_\d+_\d+)$/i.test(k) },
    // The pet: what its widget reads into it from this device alone each time it shows (the focus timer's state here, the
    // character this device chose or drew) stays here, beside what came; each device writing its own over the other's
    // would send the record back and forth on every pull.
    { cat: 'tasks', area: 'local', test: (k) => /^pet:https?:\/\/[a-z\d.-]+(?::\d+)?\/(?:\d+|_\d+_\d+)$/i.test(k), view: (v) => petView(v),
      merge: (here, v) => (obj(v) ? { ...v, ...Object.fromEntries(PET_HERE.filter((f) => obj(here) && here[f] !== undefined).map((f) => [f, here[f]])) } : v) },
    { cat: 'dashNotes', area: 'local', test: (k) => /^notes:https?:\/\/[a-z\d.-]+(?::\d+)?\/(\d+|_\d+_\d+)$/i.test(k) },
    { cat: 'classes', area: 'local', test: (k) => /^classes:https?:\/\/[a-z\d.-]+(?::\d+)?\/(?:\d+|_\d+_\d+)$/i.test(k) },
    { cat: 'gpa', area: 'local', test: (k) => /^gpaTerms:https?:\/\/[a-z\d.-]+(?::\d+)?:\w{1,40}$/i.test(k) },
    { cat: 'widgets', area: 'local', test: (k) => k === 'widgetLayout' },
    { cat: 'looks', area: 'local', test: (k) => k === 'lookHistory' || k === 'lookFavorites' },
    { cat: 'writerWords', area: 'local', test: (k) => k === 'writerWords' },
    { cat: 'sources', area: 'local', test: (k) => /^writer:sources:(?:[\w.!~*'()%-]{1,2700}\|){3}[\w.!~*'()%-]{1,2700}$/.test(k) },
    // Gradescope: what the student chose (the account, each course's placing, the bar's dismissal, each Canvas account's
    // answer); what was read from Gradescope stays on the device that read it. A device signed in to a Gradescope account
    // keeps it: another account's record (a second device signed in to someone else's) changes nothing here, so the two
    // never replace each other back and forth; a device with none takes the record's.
    { cat: 'gradescope', area: 'local', test: (k) => k === 'gradescope', view: (v) => (obj(v) ? { acct: v.acct ?? null, map: v.map ?? {}, hide: !!v.hide, bind: v.bind ?? {} } : v),
      merge: (here, v) => {
        const mine = L.gradescope().clean(here).acct;
        if (mine && mine.id !== v.acct?.id) return here;
        return { ...v, courses: here?.acct?.id === v.acct?.id && obj(here?.courses)
          ? Object.fromEntries(Object.entries(here.courses).filter(([id]) => v.map[id]?.to && v.map[id].to === here.map?.[id]?.to)) : {} };
      } },
    { cat: 'settings', area: 'sync', test: () => true },
    // Notes, in the order a record needs what it points at: an account's folders, then its files, then its notes.
    { cat: 'noteFolders', area: 'notes', test: (k) => NREC.exec(k)?.[2] !== undefined, order: 1 },
    { cat: 'noteFiles', area: 'notes', test: (k) => NREC.exec(k)?.[3] !== undefined, order: 2, immutable: true },
    { cat: 'notes', area: 'notes', test: (k) => NREC.exec(k)?.[4] !== undefined, order: 3 },
  ];
  const defOf = (area, key) => (typeof key === 'string' && key.length <= 3000 ? CATS.find((c) => c.area === area && c.test(key)) || null : null);
  const catOf = (area, key) => defOf(area, key)?.cat || null;
  const ORDER = Object.fromEntries(CATS.map((c) => [c.cat, c.order || 0]));
  const canon = (v) => JSON.stringify(v, (_, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x));
  class Fail extends Error { constructor(why) { super(why); this.why = why; } }
  // Each store's library as the worker loaded it, or node's.
  const L = {
    todo: () => (typeof GZ_TODO !== 'undefined' ? GZ_TODO : require('../planner/todo.js')), pet: () => (typeof GZ_PET !== 'undefined' ? GZ_PET : require('../pet/pet.js')),
    widgets: () => (typeof GZ_WIDGETS !== 'undefined' ? GZ_WIDGETS : require('../core/widgets.js')), classes: () => (typeof GZ_CLASSES !== 'undefined' ? GZ_CLASSES : require('../planner/classes.js')),
    gpa: () => (typeof GZ_GPA !== 'undefined' ? GZ_GPA : require('../planner/gpa.js')), history: () => (typeof GZ_HISTORY !== 'undefined' ? GZ_HISTORY : require('../looks/history.js')),
    sanitize: () => (typeof GZ_SANITIZE !== 'undefined' ? GZ_SANITIZE : require('../content/defaults.js').GZ_SANITIZE),
    notes: () => (typeof GZ_NOTES !== 'undefined' ? GZ_NOTES : require('../planner/notes.js')),
    gradescope: () => (typeof GZ_GRADESCOPE !== 'undefined' ? GZ_GRADESCOPE : require('../planner/gradescope.js')),
    backup: () => (typeof GZ_BACKUP !== 'undefined' ? GZ_BACKUP : require('./backup.js')),
    sync: () => (typeof GZ_DRIVE_SYNC !== 'undefined' ? GZ_DRIVE_SYNC : require('../documents/drive-sync.js')),
  };
  const obj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
  const PET_HERE = ['timerSignal', 'sprite'];
  const petView = (v) => (obj(v) ? Object.fromEntries(Object.entries(v).filter(([f]) => !PET_HERE.includes(f))) : v);
  // A value from Drive as its store keeps it (each store's own cleaner), or undefined when it isn't one.
  const clean = (cat, key, v) => {
    try {
      if (cat === 'tasks') return key.startsWith('todo:') ? (obj(v) ? L.todo().clean(v) : undefined) : petView(L.pet().backup({ [key]: v })?.[key]);
      if (cat === 'dashNotes') return obj(v) ? L.widgets().cleanNote(v) : undefined;
      if (cat === 'classes') return obj(v) ? L.classes().clean(v) : undefined;
      if (cat === 'gpa') return obj(v) ? L.gpa().clean(v) : undefined;
      if (cat === 'widgets') return obj(v) ? L.widgets().layout(v, L.widgets().mods(v)) : undefined;
      if (cat === 'looks') return Array.isArray(v) ? (key === 'lookFavorites' ? L.history().favorites(v) : L.history().entries(v)) : undefined;
      if (cat === 'writerWords') return Array.isArray(v) ? v.filter((w) => typeof w === 'string' && w && w === w.trim() && w.length <= 60).slice(-5000) : undefined;
      if (cat === 'sources') return obj(v) && Array.isArray(v.sources) && v.sources.length <= 2000 && Number.isFinite(v.at) && v.sources.every((x) => obj(x) && typeof x.id === 'string') ? v : undefined;
      if (cat === 'gradescope') { const g = L.gradescope().clean(v); return { acct: g.acct, map: g.map, hide: g.hide, bind: g.bind }; }
      if (cat === 'notes') return obj(v) && obj(v.note) && typeof v.html === 'string' && v.html.length <= L.notes().LIMIT.body * 2 ? { note: v.note, html: v.html } : undefined;
      if (cat === 'noteFolders') { if (!obj(v) || !obj(v.folders)) return undefined; const c = L.notes().clean({ folders: v.folders, fgone: v.gone }); return { folders: c.folders, ...(c.fgone && { gone: c.fgone }) }; }
      if (cat === 'noteFiles') return obj(v) && ['image', 'file'].includes(v.kind) && typeof v.data === 'string' && L.notes().ID.test(v.note || '') ? { kind: v.kind, name: String(v.name || ''), type: String(v.type || ''), note: v.note, data: v.data } : undefined;
      if (cat === 'settings') {
        if (v === undefined || canon(v).length > 1 << 20) return undefined;
        // The palette's name: checked alone, without the student's own palettes (presets, a record of its own) and colours
        // beside it, it would become a built-in one. Settings check it against those as they load.
        if (key === 'preset') return v === null || (typeof v === 'string' && v.length <= 40 && v.trim() === v && !!v) ? v : undefined;
        const d = L.sanitize()({});
        return Object.hasOwn(d, key) ? L.sanitize()({ [key]: v })[key] : v;
      }
    } catch { /* not one */ }
    return undefined;
  };
  // Notes, field by field (the owner's call): a note's text (its at), title, folder, course (ft) and Trash (ft.trash, else
  // when it went there) each keep their later change; an account's folders each by name, course, order and Trash, every
  // folder either side has unless the other deleted it for good (gone) after its last change, never at a first meeting.
  // A tie goes to the larger value, so both sides agree. A field neither side has a time for (Notes from before field times)
  // goes by each side's record time, as whole records did: rt { here, there }. Only what Notes keeps is merged.
  const t0 = (n) => (Number.isFinite(n) && n > 0 ? n : 0);
  const wins = (a, b, ta, tb, rt) => { // b's value over a's
    if (!ta && !tb) { ta = t0(rt?.here); tb = t0(rt?.there); }
    return tb > ta || (tb === ta && (canon(b) ?? '') > (canon(a) ?? ''));
  };
  const NOTE_FIELDS = [['title', ['title']], ['folder', ['folder']], ['course', ['course', 'cn']]];
  const FOLDER_FIELDS = [['name', ['name']], ['course', ['course', 'cn']], ['order', ['order']]];
  const entry = (a, b, fields, rt) => {
    const out = { ft: {} };
    for (const [f, keys] of fields) {
      const src = wins(keys.map((k) => a[k] ?? null), keys.map((k) => b[k] ?? null), t0(a.ft?.[f]), t0(b.ft?.[f]), rt) ? b : a;
      for (const k of keys) if (src[k] !== undefined) out[k] = src[k];
      out.ft[f] = t0(src.ft?.[f]);
    }
    const trashAt = (x) => t0(x.ft?.trash) || t0(x.del);
    // Its own time in the value too: one side timed and the other not (an older index), at the same time, both pick the timed.
    const tr = wins([t0(a.del), a.with ?? '', t0(a.ft?.trash)], [t0(b.del), b.with ?? '', t0(b.ft?.trash)], trashAt(a), trashAt(b), rt) ? b : a;
    if (t0(tr.del)) { out.del = tr.del; if (tr.with) out.with = tr.with; }
    if (t0(tr.ft?.trash)) out.ft.trash = tr.ft.trash;
    const made = [t0(a.created), t0(b.created)].filter(Boolean);
    out.created = made.length ? Math.min(...made) : 0;
    return out;
  };
  const mergeNote = (here, there, rt) => {
    const body = wins(here.html, there.html, t0(here.note.at), t0(there.note.at), rt) ? there : here;
    return { note: { ...entry(here.note, there.note, NOTE_FIELDS, rt), at: body.note.at }, html: body.html };
  };
  const latestOf = (f) => Math.max(t0(f.created), t0(f.del), ...Object.values(f.ft || {}).map(t0));
  const mergeFolders = (here, there, rt, first = false) => {
    const A = here?.folders || {}, B = there?.folders || {}, ga = here?.gone || {}, gb = there?.gone || {}, folders = {}, gone = {};
    for (const id of [...new Set([...Object.keys(A), ...Object.keys(B), ...Object.keys(ga), ...Object.keys(gb)])].sort()) {
      const f = A[id] && B[id] ? entry(A[id], B[id], FOLDER_FIELDS, rt) : A[id] || B[id], g = Math.max(t0(ga[id]), t0(gb[id]));
      if (f && (first || !g || latestOf(f) > g)) folders[id] = f; else if (g) gone[id] = g;
    }
    return { folders, ...(Object.keys(gone).length && { gone }) };
  };
  const MERGE = { notes: mergeNote, noteFolders: (a, b, rt) => mergeFolders(a, b, rt) };

  // Drive's value joined into what is here as Restore joins a backup's (background/backup.js apply); the Looks history and a
  // record with no such rule keep this device's. local: storage.local. rt: each side's record time (Notes' merge). own: the
  // store's (create below), so its write is this layer's own and stamps nothing: set(patch) before a write to storage.local,
  // change, Notes' onChange.
  const join = async (cat, key, value, local, notes, rt, own) => {
    // Notes: field by field, every folder either side has; a file is the same file on both.
    if (cat === 'notes' || cat === 'noteFolders') {
      const here = (await notes.get(key))[key];
      const next = !here ? value : cat === 'notes' ? mergeNote(here, value, rt) : mergeFolders(here, value, rt, true);
      if (canon(next) === canon(here)) return;
      if (!await notes.replace(key, here, next, own?.change)) throw new Fail('stale');
      return;
    }
    if (own?.set) { const base = local; local = { get: (k) => base.get(k), set: async (o) => { await own.set(o); return base.set(o); } }; }
    if (cat === 'noteFiles') return;
    // Looks history: each Look either side wore, once, at the later time it was worn, newest first.
    if (key === 'lookHistory') {
      const H = L.history(), here = H.entries((await local.get(key))[key]), by = new Map();
      for (const e of [...here, ...H.entries(value)]) {
        const id = JSON.stringify(H.theme(e.theme)), at = Number.isFinite(e.at) ? e.at : 0, had = by.get(id);
        if (!had) by.set(id, { ...e, at }); else if (at > had.at) had.at = at;
      }
      const next = [...by.values()].sort((a, b) => b.at - a.at).slice(0, H.MAX);
      if (canon(next) !== canon(here)) await local.set({ [key]: next });
      return;
    }
    // Gradescope: every placing and answer either side has (this device's where both), for the one account; read rows stay
    // only for a course still placed where they were read.
    if (cat === 'gradescope') {
      const G = L.gradescope(), raw = (await local.get(key))[key], here = G.clean(raw), same = !!here.acct && here.acct.id === value.acct?.id;
      if (here.acct && !same) return; // another account's: this device keeps its own (the category's merge)
      const view = { acct: here.acct || value.acct, map: same ? { ...value.map, ...here.map } : here.acct ? here.map : value.map, hide: here.hide || value.hide, bind: { ...value.bind, ...here.bind } };
      const next = G.clean(defOf('local', key).merge(raw, view));
      if (canon(next) !== canon(here)) await local.set({ [key]: next });
      return;
    }
    // A Better To Do list on both: every task either side has (this device's where both do), never one side's list whole.
    if (cat === 'tasks' && key.startsWith('todo:')) {
      const T = L.todo(), here = T.clean((await local.get(key))[key]), ids = new Set(here.tasks.map((t) => t.id));
      value = T.clean({ tasks: [...here.tasks, ...value.tasks.filter((t) => !ids.has(t.id))], items: { ...value.items, ...here.items } });
    }
    if (cat === 'tasks' && !key.startsWith('todo:')) value = defOf('local', key).merge((await local.get(key))[key], value);
    const r = cat === 'tasks' ? { tasks: key.startsWith('todo:') ? { tasks: { [key]: value } } : { tasks: {}, pets: { [key]: value } } }
      : ['dashNotes', 'classes', 'gpa'].includes(cat) ? { [cat]: { [key]: value } } : cat === 'widgets' ? { widgets: value }
        : key === 'lookFavorites' ? { favorites: value } : cat === 'writerWords' ? { writerWords: value } : null;
    if (cat === 'sources') {
      const here = (await local.get(key))[key], mine = Array.isArray(here?.sources) ? here.sources : [], ids = new Set(mine.map((x) => x.id));
      const sources = [...mine, ...value.sources.filter((x) => !ids.has(x.id))];
      if (sources.length > mine.length) await local.set({ [key]: { sources, at: Math.max(Number.isFinite(here?.at) ? here.at : 0, value.at) } });
      return;
    }
    if (!r) return;
    const out = await L.backup().apply(r, { local: { get: (k) => local.get(k), set: async (o) => { await local.set(o); return true; } } });
    // Refused as it stands (more than this device keeps): passed over, each device keeping its own; a failed write is tried again.
    if (!out?.ok) throw new Fail(out?.error === 'write' ? 'stale' : 'bad');
  };

  // Notes as an area of records (keys above): local (storage.local), db (the worker's Notes database, background/background.js
  // NOTES_DB), run(m, onChange) (planner/notes.js run), turn(fn) (the worker's queue). Reads and comparisons share a turn
  // with their writes. A value: a note { note: its index entry without this
  // device's revision, excerpt and save id, html }, an account's { folders, gone?: those deleted for good }, a file
  // { kind, name, type, note, data }.
  const notesArea = ({ local, db, run, turn = (f) => f() }) => {
    const N = L.notes();
    const scope = (acct) => acct.slice('notesIdx:'.length);
    // Notes' refusals of what came (too big, not one, more than it keeps, no room here) and a note whose text this device can't
    // find (which no retry brings back) pass the record over; the rest are tried again.
    const ok = (r) => { if (!r?.ok) throw new Fail(['big', 'bad', 'type', 'many', 'full', 'missing'].includes(r?.error) ? 'bad' : 'stale'); return r; };
    const read = async (key) => {
      const m = NREC.exec(key);
      if (!m) return undefined;
      const acct = m[1], raw = (await local.get(acct))[acct];
      if (raw === undefined) return undefined;
      const idx = N.clean(raw);
      if (m[2]) return { folders: idx.folders, ...(idx.fgone && { gone: idx.fgone }) };
      if (m[3]) {
        const f = await db.get('files', `${scope(acct)}/${m[3]}`), bytes = f && await db.get('blobs', `${scope(acct)}/${m[3]}`);
        return bytes ? { kind: f.kind, name: f.name, type: f.type, note: f.note, data: N.b64(bytes) } : undefined;
      }
      const n = idx.notes[m[4]];
      if (!n) return undefined;
      const { rev, ex, sid, ...note } = n;
      const r = rev > 0 ? ok(await run({ key: acct, op: 'load', id: m[4] })) : { html: '' };
      return { note, html: r.html };
    };
    const write = async (key, v, onChange) => {
      const m = NREC.exec(key);
      if (!m) throw new Fail('bad');
      if (m[2]) return ok(await run({ key: m[1], op: 'folders', folders: v.folders, gone: v.gone }, onChange));
      if (m[3]) return ok(await run({ key: m[1], op: 'file', id: m[3], kind: v.kind, name: v.name, data: v.data, note: v.note }, onChange));
      return ok(await run({ key: m[1], op: 'put', id: m[4], note: v.note, html: v.html }, onChange));
    };
    const drop = async (key, onChange) => { const m = NREC.exec(key); if (m?.[4]) ok(await run({ key: m[1], op: 'drop', id: m[4] }, onChange)); };
    return {
      keys: async () => {
        const out = [];
        for (const acct of (await local.keys()).filter((k) => NOTES_KEY.test(k))) {
          const idx = N.clean((await local.get(acct))[acct]);
          out.push(`${acct}|folders`, ...(await db.keys('files', `${scope(acct)}/`)).map((k) => `${acct}|file|${k.slice(scope(acct).length + 1)}`), ...Object.keys(idx.notes).map((id) => `${acct}|${id}`));
        }
        return out;
      },
      get: (key) => turn(async () => { const v = await read(key); return v === undefined ? {} : { [key]: v }; }),
      set: (o) => turn(async () => { for (const [k, v] of Object.entries(o)) await write(k, v); return true; }),
      remove: (keys) => turn(async () => { for (const k of [].concat(keys)) await drop(k); return true; }),
      replace: (key, expected, value, onChange) => turn(async () => {
        if (canon(await read(key)) !== canon(expected)) return false;
        if (value === undefined) await drop(key, onChange); else await write(key, value, onChange);
        return true;
      }),
    };
  };

  // env: { area(name) → storage.local or storage.sync (get, set, remove, keys, replace(key, expected, value): atomic CAS), store (storage.local: this layer's state),
  // hash(text), now, snapshot() → { name, bytes } or null; clean and join (above) by default }
  const create = (env) => {
    const now = env.now || Date.now, S = env.store;
    const applying = new Map(); // `${area}:${key}` → the canon of a value this layer is writing, so its own write stamps nothing
    const recOf = async (h) => (await S.get(REC + h))[REC + h] || null;
    const hk = async (area, key) => (await env.hash(`${area}\n${key}`)).slice(0, 32);
    const sumOf = (area, key, value) => env.hash(canon({ area, key, ...(value === undefined ? { deleted: true } : { value }) }));
    const stamps = async () => (await S.get(STAMPS))[STAMPS] || {};
    // The stamps' read and write one at a time: the listener's and a take's would otherwise lose each other's.
    let turn = Promise.resolve();
    const restamp = (patch, expected) => {
      const p = turn.then(async () => {
        const here = await stamps();
        const next = expected ? Object.fromEntries(Object.entries(patch).filter(([id]) => here[id] === expected[id])) : patch;
        if (Object.keys(next).length) await S.set({ [STAMPS]: { ...here, ...next } });
      });
      turn = p.catch(() => {}); return p;
    };
    // Stamps the sync has settled, let go (each only if no change stamped it again since): a sweep reads what changed since.
    const unstamp = (expected) => {
      const p = turn.then(async () => {
        const here = await stamps(), gone = Object.keys(expected).filter((id) => here[id] === expected[id]);
        if (!gone.length) return;
        for (const id of gone) delete here[id];
        await S.set({ [STAMPS]: here });
      });
      turn = p.catch(() => {}); return p;
    };
    const valueOf = async (area, key) => { const v = (await env.area(area).get(key))[key], d = defOf(area, key); return d?.view ? d.view(v) : v; };
    const owned = new Map(); // Notes record id → the exact index transition this layer is committing in the broker queue
    const transition = (key, before, after) => {
      const m = NREC.exec(key), part = (idx) => m[2] ? { folders: idx.folders, gone: idx.fgone } : idx.notes[m[4]];
      return canon({ before: part(before) ?? null, after: part(after) ?? null });
    };
    // Notes' onChange for a write of this layer's: the transition it makes, and with an account's folders each note Notes takes
    // out of a folder no longer there (planner/notes.js 'folders'): a consequence of what came, never a change made here to
    // outweigh that note's own change from the other device. mine: the ids owned, for the caller to let go on failure.
    const ownNotes = (key, cat, mine = []) => (old, next) => {
      owned.set(`notes:${key}`, transition(key, old, next)); mine.push(`notes:${key}`);
      if (cat !== 'noteFolders') return;
      const acct = NREC.exec(key)[1];
      for (const n of new Set([...Object.keys(old.notes), ...Object.keys(next.notes)])) {
        if (canon(old.notes[n]) === canon(next.notes[n])) continue;
        const k = `${acct}|${n}`;
        owned.set(`notes:${k}`, transition(k, old, next)); mine.push(`notes:${k}`);
      }
    };
    const put = async (h, r, was) => {
      await S.set({ [REC + h]: r, ...(r.id && { [FILE + r.id]: `r:${h}` }) });
      if (was?.id && was.id !== r.id) await S.remove(FILE + was.id);
    };

    // A key changed here (the worker's storage listener, while Sync is on): its time, unless it is this layer's own write.
    const stamp = async (changes, area) => {
      const at = now(), mine = {};
      for (const [key, c] of Object.entries(changes)) {
        // A Notes account's index: each note and its folders, by what changed in it.
        if (area === 'local' && NOTES_KEY.test(key)) {
          const N = L.notes(), was = N.clean(c.oldValue), is = N.clean(c.newValue);
          const ids = [...new Set([...Object.keys(was.notes), ...Object.keys(is.notes)])].filter((id) => canon(was.notes[id]) !== canon(is.notes[id])).map((id) => `notes:${key}|${id}`);
          if (canon(was.folders) !== canon(is.folders) || canon(was.fgone) !== canon(is.fgone)) ids.push(`notes:${key}|folders`);
          for (const id of ids) {
            if (owned.get(id) === transition(id.slice(6), was, is)) owned.delete(id);
            else mine[id] = at;
          }
          continue;
        }
        if (!catOf(area, key)) continue;
        const id = `${area}:${key}`;
        // canon(undefined) is undefined: a removal is told from a write of null.
        if (applying.has(id) && applying.get(id) === canon(c.newValue)) { applying.delete(id); continue; }
        mine[id] = at;
      }
      if (!Object.keys(mine).length) return;
      await restamp(mine);
    };

    // The folders inside Glaze: Data and Backups, found by their tag, else made; two made at once by two devices converge on
    // one (documents/drive-sync.js converge), the other's records or snapshots moving into it and the emptied one put away
    // in Data.
    const sub = async (ctx, tag, name) => {
      const st = (await S.get(STATE))[STATE] || {};
      const id = await L.sync().converge(ctx.D, { parent: ctx.folder, tag, name, mine: st[tag] || null, hide: tag === 'data' ? null : () => sub(ctx, 'data', 'Data') });
      // Another Data than the one this device had (that one in Drive's trash, gone, or merged into another): every record goes
      // over to it, unchanged ones too, before it is the Data on driveSync. moving: such a pass under way, so a run stopped
      // midway does it again over whichever Data is the one then, even the old one put back (records went to the new one).
      if (tag === 'data' && (st.moving || (st.data && id !== st.data))) {
        await ctx.state({ moving: id });
        ctx.data = id; await all(ctx); ctx.whole = true;
        await ctx.state({ data: id, moving: null });
      } else if (id !== st[tag]) await ctx.state({ [tag]: id });
      return id;
    };

    // owner: the transfer's, when the file is too large for one request (documents/drive-sync.js down: 'pending').
    const fetchRec = async (ctx, R, h, owner = { rec: h }) => {
      const bytes = ctx.down ? await ctx.down(`r:${h}`, R, MAX, { ...owner, R: R.id }) : await ctx.D((c) => c.media(R.id, MAX));
      let j;
      try { j = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new Fail('bad'); }
      if (j?.glaze !== 'record' || j.v !== 1 || !['local', 'sync', 'notes'].includes(j.area) || catOf(j.area, j.key) !== j.cat || (await hk(j.area, j.key)) !== h
        || !Number.isFinite(j.at) || (j.deleted !== true && j.value === undefined)) throw new Fail('bad');
      const value = j.deleted === true ? undefined : (env.clean || clean)(j.cat, j.key, j.value);
      if (j.deleted !== true && value === undefined) throw new Fail('bad');
      // Its sum from what came, as its writer summed it, never from the metadata it was asked by: a change page read before
      // this device's own write since names the file as it was then.
      return { area: j.area, key: j.key, cat: j.cat, at: j.at, value, sum: await sumOf(j.area, j.key, j.deleted === true ? undefined : j.value) };
    };
    // Drive's value here: written (or removed, for a tombstone) as this layer's own, at its time. o.pending: a merge of both
    // sides on its way up (meet), kept dirty here until it lands.
    const take = async (h, got, R, was, expected, o = {}) => {
      const a = env.area(got.area), id = `${got.area}:${got.key}`, d = defOf(got.area, got.key);
      if (d?.immutable && got.value === undefined) return; // a file is never taken away: Notes' own clean-up does that
      const stampBefore = (await stamps())[id];
      let write = got.value, before = expected;
      // A record seen through a view (Gradescope): what this device alone keeps stays beside what came.
      if (d?.merge) {
        const raw = (await a.get(got.key))[got.key];
        if (canon(d.view(raw)) !== canon(expected)) throw new Fail('stale');
        before = raw; write = got.value === undefined ? undefined : d.merge(raw, got.value);
      }
      // Already the value here: nothing written. Storage tells no one of an equal write, which would leave applying waiting
      // to pass over the student's own later change back to this value. A value of null is a value (a palette of the
      // student's own), not the key gone.
      if (write === undefined ? before !== undefined : before === undefined || canon(write) !== canon(before)) {
        applying.set(id, canon(write));
        const mine = [id];
        try {
          const onChange = got.area === 'notes' && !d?.immutable ? ownNotes(got.key, d.cat, mine) : undefined;
          if (!await a.replace(got.key, before, write, onChange)) throw new Fail('stale');
        } catch (e) {
          applying.delete(id); for (const x of mine) owned.delete(x);
          // storage.sync refusing this value (past its 8 KB an item, its total or its count of items): passed over as too big.
          // Its writes-a-minute and -an-hour limits pass, so those are tried again.
          if (got.area === 'sync' && !(e instanceof Fail) && !/MAX_WRITE_OPERATIONS/.test(String(e?.message))) throw new Fail('bad');
          throw e;
        }
      }
      await restamp({ [id]: got.at }, { [id]: stampBefore });
      // A later local write is still dirty even if it lands before the sync bookkeeping finishes. lsum: what this device holds
      // now, as it is compared (a view's own merge may keep this device's, Gradescope's account).
      const held = d?.merge && got.value !== undefined ? d.view(write) : got.value;
      await put(h, { area: got.area, key: got.key, cat: got.cat, id: R.id, lsum: o.pending ? null : await sumOf(got.area, got.key, held), rsum: got.sum, at: got.at, seen: got.at }, was);
    };
    // A note or an account's folders changed on both sides: each field's later change, here and in Drive (MERGE), the record at
    // the time of the latest change it holds.
    const meet = async (ctx, h, got, R, was, value, at) => {
      const next = MERGE[got.cat](value, got.value, { here: at || was.at || 0, there: got.at }), t = Math.max(at, got.at) || now();
      if (canon(next) === canon(got.value)) return take(h, got, R, was, value);
      if (canon(next) !== canon(value)) await take(h, { ...got, value: next, at: t }, R, was, value, { pending: true });
      return push(ctx, h, got.area, got.key, got.cat, (await recOf(h)) || was, t, R.appProperties?.sum ?? null);
    };
    // A file up as documents/drive-sync.js up sends it (one too large for a request waits for the run's last step: 'pending'),
    // or, for a caller with no transfers (ctx.up), in one request. m: { bytes, id, meta, create, mime, info }.
    const send = async (ctx, slot, tag, target, make, owner, commit = null) => {
      if (ctx.up) return ctx.up(slot, tag, target, make, owner, commit);
      const m = await make();
      let file = null;
      if (m.id) { try { file = await ctx.D((c) => c.put({ id: m.id, meta: m.meta, mime: m.mime, bytes: m.bytes })); } catch (e) { if (e.why !== 'missing') throw e; } }
      file ||= await ctx.D((c) => c.put({ meta: m.create, mime: m.mime, bytes: m.bytes }));
      return { file, info: m.info ?? null };
    };
    // This device's value up, at its time (or a tombstone once it is gone). One still on its way since an earlier run keeps
    // the time it went with.
    // One too large for a request is staged: its file's id is written into its link as Drive's answer comes (commit), and
    // the record is held as this push left it until then (documents/drive-sync.js holds). Aimed at the file as this device
    // last agreed with it (its sum): another device's write since sends it back to be weighed again.
    // aim: the sum of Drive's file as this run met it (undefined: as this device last agreed with it).
    const push = async (ctx, h, area, key, cat, was, at, aim) => {
      const value = await valueOf(area, key), sum = await sumOf(area, key, value), link = { area, key, cat, lsum: sum, rsum: sum, at, seen: at };
      const expect = aim !== undefined ? aim : was?.rsum;
      const r = await send(ctx, `R:${h}`, sum, was?.id ?? null, async () => {
        const meta = { appProperties: { glaze: 'rec', cat, key: h, sum, at: String(at) } };
        const bytes = new TextEncoder().encode(JSON.stringify({ glaze: 'record', v: 1, cat, area, key, at, ...(value === undefined ? { deleted: true } : { value }) }));
        if (bytes.length > MAX) throw new Fail('large');
        return { bytes, id: was?.id ?? null, sum: was?.id && SUM.test(expect || '') ? expect : null, meta, create: { ...meta, name: `${cat}-${h.slice(0, 12)}.json`, mimeType: JSON_TYPE, parents: [ctx.data] }, mime: JSON_TYPE };
      }, { rec: h, area, key }, { rec: h, link });
      await put(h, { ...link, id: r.file.id }, was);
    };

    // One record, both sides. key and area: when known here; R: its file's metadata (undefined: ask Drive when known).
    const one = async (ctx, h, x) => {
      let { area, key, R } = x;
      let was = await recOf(h), left = null;
      // Its upload on its way: held as its push left it until Drive's answer is written (documents/drive-sync.js holds).
      if (ctx.move?.hold && await ctx.move.hold(`R:${h}`, R, was?.id || null)) throw new Fail('pending');
      // This device's record let go for another device's file (below), met as a first meeting: what it holds as synced keeps
      // the time of that change as its stamp, so it weighs as the change it was, not as one with no time (which any other
      // wins over), on this run and on any later one should this one stop first.
      const leave = async () => {
        const id = `${was.area}:${was.key}`;
        if (was.at && await sumOf(was.area, was.key, await valueOf(was.area, was.key)) === was.lsum) await restamp({ [id]: was.at }, { [id]: undefined });
        await S.remove([REC + h, FILE + was.id]); left = was; was = null;
      };
      // Another device's file for the same record, made while this one made its own (first syncs that overlapped): every
      // device keeps the lowest id, met as a first meeting, so neither side's value is lost and each hears the other's after.
      if (was?.id && R?.id && !R.removed && R.id !== was.id) {
        if (R.id < was.id && !R.trashed) await leave(); else R = undefined;
      }
      area ||= was?.area || left?.area; key ||= was?.key || left?.key;
      if (R === undefined) R = was?.id ? await ctx.D((c) => c.file(was.id)).catch((e) => { if (e.why === 'missing') return { removed: true }; throw e; }) : ctx.listed ? ctx.known.get(h) || null : await lookup(ctx, h);
      if (R && !R.removed && R.trashed) R = { removed: true }; // a record file moved to Drive's trash: put back from here
      // This device's file outside Data (left in a Data merged into this one before Drive's search showed it): moved in, where
      // every other device lists and hears it.
      if (was?.id && R?.id === was.id && !R.removed && ctx.data && Array.isArray(R.parents) && !R.parents.includes(ctx.data)) {
        await ctx.D((c) => c.patch(R.id, {}, undefined, { add: ctx.data, remove: R.parents }));
      }
      // Unless another device put it back first (Glaze/Data trashed with it, say): that one is met as a first meeting, never
      // a second file made beside it.
      if (was?.id && R?.removed) { const other = await lookup(ctx, h); if (other && other.id !== was.id) { await leave(); R = other; } }
      const st = await stamps();
      // A push here goes over Drive's file as this run met it: a write another device makes before it lands sends it back.
      const over = (w, t) => push(ctx, h, area, key, cat, w, t, R && !R.removed ? R.appProperties?.sum ?? null : null);
      if (!key) { // a record only Drive has, met for the first time
        if (!R || R.removed) return;
        // A picture or attachment comes with a note here that uses it (each below, x.need), never by itself: one whose note
        // was deleted for good stays in Drive and off this device.
        if (R.appProperties?.cat === 'noteFiles' && !x.need) return;
        const got = await fetchRec(ctx, R, h);
        // Not here and never changed here: taken. One deleted here (its time stamped while bound, so it was here once, its
        // record's note lost to a worker stopped before it landed) is weighed below as a deletion made here.
        if (got.value !== undefined && await valueOf(got.area, got.key) === undefined && !(await stamps())[`${got.area}:${got.key}`]) return take(h, got, R, null);
        return one(ctx, h, { area: got.area, key: got.key, R });
      }
      const def = defOf(area, key), cat = def?.cat, owner = { rec: h, area, key, ...(x.need && { need: x.need }) };
      if (!cat) return;
      const value = await valueOf(area, key), lsum = await sumOf(area, key, value);
      // The time of the change here, read again once Drive's side has come (stamp): one made while this run read it, already
      // in the value weighed here, is weighed by its own time, never by none.
      let at = st[`${area}:${key}`] || 0;
      const stamp = async () => { at = (await stamps())[`${area}:${key}`] || 0; };
      if (def.immutable) {
        // The bytes never change, but Notes may have cleaned up this device's copy since it last used them: fetched again
        // only for a note that uses it again (x.need), never for one deleted with its note.
        if (value === undefined) {
          // One a note here wanted before Drive had it (was.want: that note's key): fetched now, while that note still uses
          // it; let go once it doesn't.
          const noteKey = typeof x.need === 'string' ? x.need : was?.want;
          const need = !!(x.need || was?.want) && await uses(noteKey, key);
          if (was?.want && !was.id && !need) { await S.remove(REC + h); return; }
          if (R && !R.removed && need) {
            const got = await fetchRec(ctx, R, h, owner);
            if (got.value !== undefined && await uses(noteKey, key)) await take(h, got, R, was, value);
          }
          return;
        }
        if (was && R && !R.removed) return;
      }
      if (!was) {
        // Here only. With no time of its own (it was here before Sync was bound to this account): older than any change made
        // with one, so a later change another device hasn't pushed yet still wins over it.
        if (!R || R.removed) { if (value !== undefined) await over(null, at || UNTIMED); return; }
        const got = await fetchRec(ctx, R, h, owner);
        await stamp();
        if (got.sum === lsum) {
          // The same value on both sides, changed here later than Drive's: sent again with this device's time (retold below).
          if (at > got.at && !def.view && !MERGE[cat]) return over({ id: R.id }, at);
          return put(h, { area, key, cat, id: R.id, lsum, rsum: got.sum, at: got.at, seen: Math.max(at, got.at) }, null);
        }
        // Gone here: Drive's value taken, unless this device deleted it later than that value's change (its time stamped while
        // bound, so it had the key): the deletion goes up, as a later change would.
        if (value === undefined) {
          if (got.value !== undefined && at > got.at) return over({ id: R.id }, at);
          if (got.value !== undefined) await take(h, got, R, null, value); else await put(h, { area, key, cat, id: R.id, lsum, rsum: got.sum, at: got.at, seen: got.at }, null);
          return;
        }
        if (got.value === undefined) return over({ id: R.id }, Math.max(at, got.at + 1) || now());
        // First meeting, both hold it: Settings by time; the rest joined as Restore joins.
        if (cat === 'settings') { if (got.at > at) return take(h, got, R, null, value); return over({ id: R.id }, at || now()); }
        const id = `${area}:${key}`, t = Math.max(at, got.at) || now(), mine = [];
        applying.delete(id);
        // The join's write is this layer's own: it stamps nothing, and carries the time of the latest change it holds, never
        // the meeting's, here (so an upload that fails is sent again with it) and in Drive, so a later change another device
        // hasn't pushed yet still wins over it. One that is Drive's own value is linked to it, not sent again.
        const own = { change: ownNotes(key, cat, mine), set: async (o) => {
          if (area === 'local' && Object.hasOwn(o, key) && canon((await env.area('local').get(key))[key]) !== canon(o[key])) applying.set(id, canon(o[key]));
        } };
        try {
          await (env.join || ((c, k, v, rt, w) => join(c, k, v, env.area('local'), env.area('notes'), rt, w)))(cat, key, got.value, { here: at, there: got.at }, own);
        } catch (e) { applying.delete(id); for (const x of mine) owned.delete(x); throw e; }
        const joined = await sumOf(area, key, await valueOf(area, key));
        if (joined === got.sum) return put(h, { area, key, cat, id: R.id, lsum: joined, rsum: got.sum, at: got.at, seen: Math.max(at, got.at) }, null);
        await restamp({ [id]: t }, { [id]: st[id] });
        return over({ id: R.id }, t);
      }
      // Its file gone or in Drive's trash: put back from here, unchanged since it last synced with the time of that change.
      if (!R || R.removed) { if (value !== undefined) await over({ ...was, id: null }, at || (lsum === was.lsum && was.at) || now()); else await S.remove([REC + h, ...(was.id ? [FILE + was.id] : [])]); return; }
      const ldirty = lsum !== was.lsum, rdirty = R.appProperties?.sum !== was.rsum;
      // The value as it was, sent again later by another device (a change back to it): retold, Drive's time for it, is weighed
      // against a change here as a change of its own. Content alone tells neither side of it.
      const rat = Number(R.appProperties?.at), retold = !rdirty && Number.isFinite(rat) && rat > (was.at || 0) ? rat : 0;
      if (!ldirty && !rdirty) {
        // A change back to the value already synced, made here later than it: sent again with its time, so an earlier change
        // another device hasn't pushed yet doesn't go up over it unseen. Only where the whole value is the record: a view
        // (the pet, Gradescope) keeps fields of this device's own, and Notes merge field by field.
        if (at > (was.seen || 0) && at > Math.max(was.at || 0, retold) && !def.view && !MERGE[cat]) return over(was, at);
        if (at > (was.seen || 0) || retold) await put(h, { ...was, seen: Math.max(was.seen || 0, at), ...(retold && { at: retold }) }, was);
        return;
      }
      if (rdirty) {
        const got = await fetchRec(ctx, R, h, owner);
        await stamp();
        // Unchanged here by content, but changed and back since it synced (where the whole value is the record): weighed by
        // time like any other change made here.
        if (!ldirty) return at > (was.seen || 0) && at > got.at && !def.view && !MERGE[cat] ? over(was, at) : take(h, got, R, was, value);
        if (MERGE[cat] && got.value !== undefined && value !== undefined) return meet(ctx, h, got, R, was, value, at);
        if (got.at >= (at || 0)) return take(h, got, R, was, value);
      }
      if (at && retold > at) return take(h, await fetchRec(ctx, R, h, owner), R, was, value);
      return over(was, at || now());
    };
    // Whether a note here still shows this picture. A conflict copy may share its id, so losing the note that first wanted
    // it does not abandon a picture the copy still uses. No reference is kept alive by a transfer's old need flag.
    const uses = async (noteKey, fileKey) => {
      const shows = async (key) => {
        const v = await valueOf('notes', key).catch(() => undefined);
        return !!v && L.notes().refs(v.html).has(fileKey.slice(fileKey.lastIndexOf('|') + 1));
      };
      if (noteKey && await shows(noteKey)) return true;
      const acct = NREC.exec(fileKey)?.[1];
      if (!acct) return false;
      for (const key of await env.area('notes').keys()) {
        if (key !== noteKey && NREC.exec(key)?.[1] === acct && catOf('notes', key) === 'notes' && await shows(key)) return true;
      }
      return false;
    };
    // The file another device made for h first, if any (oldest id first), so two devices never keep two.
    const lookup = async (ctx, h) => {
      const r = await ctx.D((c) => c.find(`'${ctx.data}' in parents and appProperties has { key='key' and value='${h}' } and appProperties has { key='glaze' and value='rec' } and trashed=false`, { pageSize: 10 }));
      return r.files.filter((f) => f.appProperties?.key === h).sort((a, b) => (a.id < b.id ? -1 : 1))[0] || null;
    };
    // A record's 'area:key' as this pass met it, for its too-large mark.
    const idOf = async (h, x) => { const r = await recOf(h); return x.area && x.key ? `${x.area}:${x.key}` : r ? `${r.area}:${r.key}` : null; };
    const each = async (ctx, h, x) => {
      try {
        await one(ctx, h, x);
        await ctx.move?.settle?.(`r:${h}`);
        { const id = await idOf(h, x); if (id) await ctx.large?.(id, false); }
        // A note's pictures and attachments go up with it (each once).
        const r = await recOf(h);
        if (r?.cat === 'notes') {
          const v = await valueOf('notes', r.key);
          for (const id of v ? L.notes().refs(v.html) : []) {
            const k = `${r.key.slice(0, r.key.lastIndexOf('|'))}|file|${id}`, fh = await hk('notes', k);
            // Its file as this pass met it (a full pass's listing, a change page), else looked up.
            const R = ctx.known?.get(fh);
            if (!await recOf(fh) || await valueOf('notes', k) === undefined) {
              // One too large to sync stays here, marked; the note and its other pictures go on.
              try { await one(ctx, fh, { area: 'notes', key: k, need: r.key, ...(R && { R }) }); await ctx.move?.settle?.(`r:${fh}`); await ctx.large?.(`notes:${k}`, false); } catch (e) {
                if (e?.why !== 'large') throw e;
                if (await valueOf('notes', k).catch(() => undefined) !== undefined) await ctx.large?.(`notes:${k}`, true);
                continue;
              }
              // Not in Drive yet (its device's push stopped between the note and it, say): wanted by this note, so it is
              // fetched once it comes (one, was.want), not passed over as a picture no note here asked for.
              if (!await recOf(fh) && await valueOf('notes', k) === undefined) await put(fh, { area: 'notes', key: k, cat: 'noteFiles', id: null, want: r.key }, null);
            }
          }
        }
      } catch (e) {
        // On its way in the run's last step (documents/drive-sync.js transfers), which hands it back here (replay).
        if (e?.why === 'pending') return 'pending';
        // Too large to sync (larger than one request): passed over, marked while this device holds it.
        if (e?.why === 'large') {
          const id = await idOf(h, x), at = id ? id.indexOf(':') : -1;
          if (id && await valueOf(id.slice(0, at), id.slice(at + 1)).catch(() => undefined) !== undefined) await ctx.large?.(id, true);
          return;
        }
        if (e?.why === 'bad' || e?.why === 'size' || e?.why === 'denied') { console.warn('Sync to Google Drive: passed over a record', h, e.why); return; }
        throw e;
      }
    };
    const locals = async () => {
      const out = [];
      for (const area of ['sync', 'local', 'notes']) {
        if (area === 'notes' && !env.area('notes')) continue;
        const keys = (await env.area(area).keys()).filter((k) => catOf(area, k));
        for (const key of keys) out.push({ area, key });
      }
      return out.sort((a, b) => ORDER[catOf(a.area, a.key)] - ORDER[catOf(b.area, b.key)]);
    };

    // ---- the hooks documents/drive-sync.js calls. ctx: { D, folder, state(patch) }
    // Everything, both sides.
    const full = async (ctx) => {
      ctx.data = await sub(ctx, 'data', 'Data');
      if (!ctx.whole) await all(ctx);
      await snapshot(ctx);
    };
    // Every record, both sides, in ctx.data.
    const all = async (ctx) => {
      const remote = new Map();
      let page = null;
      do {
        const r = await ctx.D((c) => c.find(`'${ctx.data}' in parents and appProperties has { key='glaze' and value='rec' } and trashed=false`, { pageToken: page }));
        for (const f of r.files) if (HASH.test(f.appProperties?.key || '') && (!remote.has(f.appProperties.key) || f.id < remote.get(f.appProperties.key).id)) remote.set(f.appProperties.key, f);
        page = r.nextPageToken || null;
      } while (page);
      ctx.known = remote;
      // While this pass goes over what it listed, the listing says what Drive has: nothing is looked up again.
      ctx.listed = true;
      try {
        const seen = new Set();
        for (const { area, key } of await locals()) {
          const h = await hk(area, key);
          seen.add(h);
          const was = await recOf(h), R = remote.get(h) || null;
          await each(ctx, h, { area, key, R: !was?.id || (R && R.id <= was.id) ? R : undefined });
        }
        for (const [h, R] of [...remote].sort(([, a], [, b]) => (ORDER[a.appProperties?.cat] || 0) - (ORDER[b.appProperties?.cat] || 0))) if (!seen.has(h)) { seen.add(h); await each(ctx, h, { R }); }
        for (const k of (await S.keys()).filter((x) => x.startsWith(REC))) if (!seen.has(k.slice(REC.length))) await each(ctx, k.slice(REC.length), {});
      } finally { ctx.listed = false; }
    };
    // A page of Drive's changes: the record files among them.
    const changes = async (list, ctx) => {
      ctx.data = await sub(ctx, 'data', 'Data');
      list = [...list].sort((a, b) => (ORDER[a?.file?.appProperties?.cat] || 0) - (ORDER[b?.file?.appProperties?.cat] || 0));
      ctx.known = new Map(list.filter((c) => c?.file?.appProperties?.glaze === 'rec' && !c.file.trashed && (c.file.parents || []).includes(ctx.data)).map((c) => [c.file.appProperties.key, c.file]));
      for (const c of list) {
        const f = c?.file;
        if (c?.removed || !f) {
          const ref = typeof c?.fileId === 'string' && (await S.get(FILE + c.fileId))[FILE + c.fileId];
          if (typeof ref === 'string' && ref.startsWith('r:')) await each(ctx, ref.slice(2), { R: { removed: true } });
          continue;
        }
        if (f.appProperties?.glaze !== 'rec' || !HASH.test(f.appProperties.key || '') || !(f.parents || []).includes(ctx.data)) continue;
        // Another file for a record this device follows: one asks after the file it follows (gone or in the trash, this one
        // takes its place); one in the trash is none.
        const was = await recOf(f.appProperties.key);
        if (was?.id && was.id !== f.id && f.trashed) continue;
        await each(ctx, f.appProperties.key, { R: f });
      }
    };
    // What changed here since it was last seen, in the order a record needs what it points at (a note's folder before it).
    const sweep = async (ctx) => {
      ctx.data = await sub(ctx, 'data', 'Data');
      const settled = {}, split = (id) => [id.slice(0, id.indexOf(':')), id.slice(id.indexOf(':') + 1)];
      const rank = (id) => ORDER[catOf(...split(id))] || 0;
      const due = Object.entries(await stamps()).sort(([a], [b]) => rank(a) - rank(b)), notesChanged = due.some(([id]) => id.startsWith('notes:'));
      for (const [id, at] of due) {
        const [area, key] = split(id);
        if (!catOf(area, key)) { settled[id] = at; continue; }
        const h = await hk(area, key), was = await recOf(h);
        // Times can tie, or a remote device's clock can be ahead of this one. Only unchanged content is settled. A value that
        // can't be read here (a note whose text Notes can't find) goes to each, which passes it over or stops the run.
        if (was && (was.seen || 0) >= at && await sumOf(area, key, await valueOf(area, key).catch(() => null)) === was.lsum) { settled[id] = at; continue; }
        await each(ctx, h, { area, key });
        // Gone here with no record either side (made and removed before it went up): nothing left to settle against.
        if (!await recOf(h) && await valueOf(area, key).catch(() => null) === undefined) settled[id] = at;
      }
      if (Object.keys(settled).length) await unstamp(settled);
      // A record marked too large that is no longer here (deleted while no run met it): its mark let go.
      for (const id of Object.keys((await S.get(LARGE))[LARGE]?.recs || {})) {
        const at = id.indexOf(':');
        if (await valueOf(id.slice(0, at), id.slice(at + 1)).catch(() => null) === undefined) await ctx.large?.(id, false);
      }
      // A picture wanted but never come is let go once no note here uses it, looked at after a change to Notes here (a note
      // deleted, or its last use of the picture edited away), in one read, never on every run.
      if (notesChanged) {
        const recs = await S.get((await S.keys()).filter((k) => k.startsWith(REC)));
        for (const [k, r] of Object.entries(recs)) if (r?.want && !r.id && !await uses(r.want, r.key)) await S.remove(k);
      }
      await snapshot(ctx);
    };
    // The daily snapshot: Back up…'s zip in Backups, the newest SNAP.keep kept, older ones deleted for good. One larger than a
    // request is built once, staged, and sent by the run's last step (documents/drive-sync.js transfers) over as many runs as
    // it takes, then cleaned up after here (replay); one whose day ends before it lands is let go, the next day's built.
    const snapshot = async (ctx) => {
      const st = (await S.get(STATE))[STATE] || {};
      if (!env.snapshot) return;
      let t = ctx.move ? await ctx.move.get('snap') : null;
      if (t && now() - (t.since || 0) >= SNAP.every) { await ctx.move.drop('snap'); t = null; }
      if (t && !t.file) return; // on its way
      if (!t && st.snap && now() - st.snap < SNAP.every) return;
      // Tried once a day: one too big for a backup (null), one that can't be built, or one Drive refuses as it stands
      // (larger than one upload, or more than a full Drive has room for) waits for tomorrow, never failing the run or being
      // built again on every run. snapSkip: 'quota' while the day's was skipped for want of room (Settings says so).
      const skip = async (e) => { if (e) console.warn('Sync to Google Drive: no snapshot today', e?.why || e); await ctx.state({ snap: now(), snapSkip: ['quota', 'large'].includes(e?.why) ? e.why : null }); };
      const back = () => ctx.state({ snap: st.snap ?? null, snapSkip: st.snapSkip ?? null });
      let made = null;
      if (!t) {
        // The day's try is marked before the zip is built: one cut short by the worker stopping before it was staged waits
        // for tomorrow as well. Only a note saved while it was read and Drive's or the network's failure give the mark back.
        await ctx.state({ snap: now(), snapSkip: null });
        // A note saved while it was read (background/backup.js notesOut 'changed'): the next run tries again.
        try { made = await env.snapshot(); } catch (e) { if (e?.why === 'changed') return back(); return skip(e); }
        if (!made) return skip();
      }
      let r;
      try {
        let backups = null, list = null, same = null;
        if (made) {
          backups = await sub(ctx, 'backups', 'Backups');
          list = (await ctx.D((c) => c.find(`'${backups}' in parents and appProperties has { key='glaze' and value='snapshot' } and trashed=false`, { fields: 'id,name,trashed,appProperties,version', pageSize: 100 }))).files;
          // Another device's of the same day (its name is the day's) is replaced, a new revision of the one file: five kept are five days.
          same = list.filter((f) => f.name === made.name).sort((x, y) => (x.id < y.id ? -1 : 1))[0] || null;
        }
        r = await send(ctx, 'snap', made ? made.name : t.tag, made ? same?.id ?? null : undefined, async () => ({
          bytes: made.bytes, id: same?.id ?? null, meta: { appProperties: { glaze: 'snapshot' } }, create: { name: made.name, mimeType: ZIP, parents: [backups], appProperties: { glaze: 'snapshot' } }, mime: ZIP,
          info: { backups, name: made.name, same: !!same, files: list.map((f) => ({ id: f.id, name: f.name })) },
        }), { snap: made?.name || t.tag });
      } catch (e) {
        if (e?.why === 'pending') return; // staged: the run's last step sends it
        if (['bad', 'size', 'quota', 'large'].includes(e?.why)) return skip(e);
        await back(); throw e;
      }
      await ctx.state({ snapSkip: null, ...(made && { snap: now() }) });
      const { backups, name, same, files } = r.info || {};
      if (!backups) return;
      const all = same ? files : [...files, { id: r.file.id, name }];
      const old = all.sort((a, b) => (a.name < b.name ? 1 : a.name > b.name ? -1 : a.id < b.id ? 1 : -1)).slice(SNAP.keep);
      // Copies of what is on the device, never the student's own (the owner's call): deleted for good, not left in Drive's trash
      // counting against their storage. Each only once Drive says it is still a zip Glaze made and tagged as a snapshot, in
      // Backups and not in the trash; one that isn't stays. Gone already, or one Drive won't let go: passed over.
      for (const f of old) {
        const m = await ctx.D((c) => c.file(f.id)).catch((e) => { if (e.why === 'missing') return null; throw e; });
        if (m?.appProperties?.glaze !== 'snapshot' || m.mimeType !== ZIP || m.trashed !== false || !(m.parents || []).includes(backups)) continue;
        await ctx.D((c) => c.remove(f.id)).catch((e) => { if (e.why !== 'missing' && e.why !== 'denied') throw e; });
      }
    };
    // A transfer of this layer's, back from documents/drive-sync.js's last step: a record (its file sent or brought in), or the
    // day's snapshot (sent: cleaned up after).
    const replay = async (owner, ctx) => {
      ctx.data = await sub(ctx, 'data', 'Data');
      if (owner.snap) return snapshot(ctx);
      if (!owner.rec) return;
      // The file a meeting named, as Drive has it now; one gone for good counts only when it is the record's own.
      let R = owner.R ? await ctx.D((c) => c.file(owner.R)).catch((e) => { if (e.why === 'missing') return { id: owner.R, removed: true }; throw e; }) : undefined;
      if (R?.removed && R.id !== (await recOf(owner.rec))?.id) R = undefined;
      if (R?.removed) R = { removed: true };
      return each(ctx, owner.rec, { area: owner.area, key: owner.key, need: owner.need, ...(R && { R }) });
    };
    // One Drive refused as it stands: the day's snapshot skipped (snapSkip 'quota' while for want of room).
    const failed = async (owner, why, ctx) => { if (owner.snap) await ctx.state({ snapSkip: ['quota', 'large'].includes(why) ? why : null }); };
    // A staged upload may outlive a local edit or deletion before the first record link exists.
    const current = async (owner, tag) => tag === await sumOf(owner.area, owner.key, await valueOf(owner.area, owner.key));
    // A staged upload's answer (documents/drive-sync.js commit): written into the record's link as its push writes it.
    const commit = async (h, link, file) => put(h, { ...link, id: file.id }, await recOf(h));
    const forget = async () => {
      const keys = (await S.keys()).filter((k) => k.startsWith(REC) || k === STAMPS);
      if (keys.length) await S.remove(keys);
    };
    // Whether a change to this key is one this layer listens for.
    const watches = (area, key) => !!catOf(area, key) || (area === 'local' && NOTES_KEY.test(key));
    return { stamp, full, changes, sweep, snapshot, replay, failed, current, commit, forget, catOf, watches };
  };

  return { REC, FILE, STAMPS, CATS, SNAP, catOf, canon, clean, join, mergeNote, mergeFolders, notesArea, create };
})();
if (typeof module !== 'undefined') module.exports = GZ_DRIVE_STORE;
