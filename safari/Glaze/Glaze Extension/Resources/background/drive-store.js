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
// at), per key, Settings key by key. First meeting (a second device connecting, or Sync turned on again): a key on one side
// only is taken by the other; on both, the same is linked, Settings take the later change, and every other record is
// joined by Restore's own rules (background/backup.js apply: newer dashboard note, each class and term by its time, words
// and favorites together, every task either Better To Do list has…), so a device's own data is never wiped by connecting.
// Two files for one record (first syncs that overlapped): every device keeps the lowest id, met as a first meeting. A
// deleted key is a tombstone that deletes it on the other side; a tombstone never deletes a record met for the first time.
// State: driveSyncRec:<h> { area, key, cat, id, lsum, rsum, at, seen } and driveSyncFile:<id> 'r:<h>'; the folders and the
// last snapshot on driveSync (data, backups, snap).
// Classic script for the worker; module.exports for node.
var GZ_DRIVE_STORE = globalThis.GZ_DRIVE_STORE || (() => {
  const REC = 'driveSyncRec:', FILE = 'driveSyncFile:', STAMPS = 'driveSyncStamps', STATE = 'driveSync';
  const FOLDER = 'application/vnd.google-apps.folder', JSON_TYPE = 'application/json', ZIP = 'application/zip';
  const HASH = /^[0-9a-f]{32}$/, SUM = /^[0-9a-f]{64}$/;
  const SNAP = { every: 864e5, keep: 5 };
  const MAX = 32 << 20; // a 20 MB attachment as base64, with room
  const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
  const ACCT = 'notesIdx:https?:\\/\\/[a-z\\d.-]+(?::\\d+)?\\/(?:\\d{1,20}|_\\d{1,20}_\\d{1,20})';
  const NOTES_KEY = new RegExp(`^${ACCT}$`, 'i');
  // A Notes record's key: <account>|folders, <account>|file|<id>, <account>|<note id>.
  const NREC = new RegExp(`^(${ACCT})\\|(?:(folders)|file\\|(${UUID})|(${UUID}))$`, 'i');
  // What syncs, by category: the store's keys (background/backup.js STORES, planner/todo.js STORE_KEY, pet/pet.js KEY,
  // writer/writer-sources.js's keys) in their area.
  const CATS = [
    { cat: 'tasks', area: 'local', test: (k) => /^(?:todo|pet):https?:\/\/[a-z\d.-]+(?::\d+)?\/(?:\d+|_\d+_\d+)$/i.test(k) },
    { cat: 'dashNotes', area: 'local', test: (k) => /^notes:https?:\/\/[a-z\d.-]+(?::\d+)?\/(\d+|_\d+_\d+)$/i.test(k) },
    { cat: 'classes', area: 'local', test: (k) => /^classes:https?:\/\/[a-z\d.-]+(?::\d+)?\/(?:\d+|_\d+_\d+)$/i.test(k) },
    { cat: 'gpa', area: 'local', test: (k) => /^gpaTerms:https?:\/\/[a-z\d.-]+(?::\d+)?:\w{1,40}$/i.test(k) },
    { cat: 'widgets', area: 'local', test: (k) => k === 'widgetLayout' },
    { cat: 'looks', area: 'local', test: (k) => k === 'lookHistory' || k === 'lookFavorites' },
    { cat: 'writerWords', area: 'local', test: (k) => k === 'writerWords' },
    { cat: 'sources', area: 'local', test: (k) => /^writer:sources:(?:[\w.!~*'()%-]{1,2700}\|){3}[\w.!~*'()%-]{1,2700}$/.test(k) },
    // Gradescope: what the student chose (the account, each course's placing, the bar's dismissal, each Canvas account's
    // answer); what was read from Gradescope stays on the device that read it.
    { cat: 'gradescope', area: 'local', test: (k) => k === 'gradescope', view: (v) => (obj(v) ? { acct: v.acct ?? null, map: v.map ?? {}, hide: !!v.hide, bind: v.bind ?? {} } : v),
      merge: (here, v) => ({ ...v, courses: here?.acct?.id === v.acct?.id && obj(here?.courses)
        ? Object.fromEntries(Object.entries(here.courses).filter(([id]) => v.map[id]?.to && v.map[id].to === here.map?.[id]?.to)) : {} }) },
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
  // A value from Drive as its store keeps it (each store's own cleaner), or undefined when it isn't one.
  const clean = (cat, key, v) => {
    try {
      if (cat === 'tasks') return key.startsWith('todo:') ? (obj(v) ? L.todo().clean(v) : undefined) : L.pet().backup({ [key]: v })?.[key];
      if (cat === 'dashNotes') return obj(v) ? L.widgets().cleanNote(v) : undefined;
      if (cat === 'classes') return obj(v) ? L.classes().clean(v) : undefined;
      if (cat === 'gpa') return obj(v) ? L.gpa().clean(v) : undefined;
      if (cat === 'widgets') return obj(v) ? L.widgets().layout(v, L.widgets().mods(v)) : undefined;
      if (cat === 'looks') return Array.isArray(v) ? (key === 'lookFavorites' ? L.history().favorites(v) : L.history().entries(v)) : undefined;
      if (cat === 'writerWords') return Array.isArray(v) ? v.filter((w) => typeof w === 'string' && w && w === w.trim() && w.length <= 60).slice(-5000) : undefined;
      if (cat === 'sources') return obj(v) && Array.isArray(v.sources) && v.sources.length <= 2000 && Number.isFinite(v.at) && v.sources.every((x) => obj(x) && typeof x.id === 'string') ? v : undefined;
      if (cat === 'gradescope') { const g = L.gradescope().clean(v); return { acct: g.acct, map: g.map, hide: g.hide, bind: g.bind }; }
      if (cat === 'notes') return obj(v) && obj(v.note) && typeof v.html === 'string' && v.html.length <= L.notes().LIMIT.body * 2 ? { note: v.note, html: v.html } : undefined;
      if (cat === 'noteFolders') return obj(v) && obj(v.folders) ? { folders: L.notes().clean({ folders: v.folders }).folders } : undefined;
      if (cat === 'noteFiles') return obj(v) && ['image', 'file'].includes(v.kind) && typeof v.data === 'string' && L.notes().ID.test(v.note || '') ? { kind: v.kind, name: String(v.name || ''), type: String(v.type || ''), note: v.note, data: v.data } : undefined;
      if (cat === 'settings') {
        if (v === undefined || canon(v).length > 1 << 20) return undefined;
        const d = L.sanitize()({});
        return Object.hasOwn(d, key) ? L.sanitize()({ [key]: v })[key] : v;
      }
    } catch { /* not one */ }
    return undefined;
  };
  // Drive's value joined into what is here as Restore joins a backup's (background/backup.js apply); the Looks history and a
  // record with no such rule keep this device's. local: storage.local.
  const join = async (cat, key, value, local, notes) => {
    // Notes: a note's newer text, every folder either side has; a file is the same file on both.
    if (cat === 'notes' || cat === 'noteFolders') {
      const here = (await notes.get(key))[key];
      // A first meeting joins independent metadata edits as well as the newer text. Note.at only dates the text.
      const time = (n) => Number.isFinite(n) && n > 0 ? n : 0;
      const merge = (a, b, fields) => {
        const latest = (n) => Math.max(time(n.at), time(n.del), ...fields.map((f) => time(n.ft?.[f])));
        const out = { ...a, ft: { ...a.ft } };
        for (const f of fields) if ((b.ft?.[f] || 0) > (a.ft?.[f] || 0)) {
          out[f] = b[f]; out.ft[f] = b.ft[f];
          if (f === 'course') out.cn = b.cn;
        }
        const trash = latest(b) > latest(a) ? b : a;
        delete out.del; delete out.with;
        if (trash.del) { out.del = trash.del; if (trash.with) out.with = trash.with; }
        return out;
      };
      let next = value;
      if (cat === 'notes' && here) {
        const body = (value.note.at || 0) > (here.note.at || 0) ? value : here;
        next = { note: { ...body.note, ...merge(here.note, value.note, ['title', 'folder', 'course']), at: body.note.at }, html: body.html };
      } else if (cat === 'noteFolders') {
        const folders = { ...value.folders, ...here?.folders };
        for (const [id, f] of Object.entries(value.folders)) if (here?.folders[id]) folders[id] = merge(here.folders[id], f, ['name', 'course', 'order']);
        next = { folders };
      }
      if (canon(next) === canon(here)) return;
      if (!await notes.replace(key, here, next)) throw new Fail('stale');
      return;
    }
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
  // device's revision, excerpt and save id, html }, an account's { folders }, a file { kind, name, type, note, data }.
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
      if (m[2]) return { folders: idx.folders };
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
      if (m[2]) return ok(await run({ key: m[1], op: 'folders', folders: v.folders }, onChange));
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
      const m = NREC.exec(key), part = (idx) => m[2] ? idx.folders : idx.notes[m[4]];
      return canon({ before: part(before) ?? null, after: part(after) ?? null });
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
          if (canon(was.folders) !== canon(is.folders)) ids.push(`notes:${key}|folders`);
          for (const id of ids) {
            if (owned.get(id) === transition(id.slice(6), was, is)) owned.delete(id);
            else mine[id] = at;
          }
          continue;
        }
        if (!catOf(area, key)) continue;
        const id = `${area}:${key}`;
        if (applying.has(id) && applying.get(id) === canon(c.newValue ?? null)) { applying.delete(id); continue; }
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
      if (id !== st[tag]) await ctx.state({ [tag]: id });
      return id;
    };

    const fetchRec = async (ctx, R, h) => {
      const bytes = await ctx.D((c) => c.media(R.id, MAX));
      let j;
      try { j = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new Fail('bad'); }
      if (j?.glaze !== 'record' || j.v !== 1 || !['local', 'sync', 'notes'].includes(j.area) || catOf(j.area, j.key) !== j.cat || (await hk(j.area, j.key)) !== h
        || !Number.isFinite(j.at) || (j.deleted !== true && j.value === undefined)) throw new Fail('bad');
      const value = j.deleted === true ? undefined : (env.clean || clean)(j.cat, j.key, j.value);
      if (j.deleted !== true && value === undefined) throw new Fail('bad');
      return { area: j.area, key: j.key, cat: j.cat, at: j.at, value, sum: R.appProperties?.sum };
    };
    // Drive's value here: written (or removed, for a tombstone) as this layer's own, at its time.
    const take = async (h, got, R, was, expected) => {
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
      // to pass over the student's own later change back to this value.
      if (canon(write ?? null) !== canon(before ?? null)) {
        applying.set(id, canon(write ?? null));
        try {
          const onChange = got.area === 'notes' && !d?.immutable ? (old, next) => owned.set(id, transition(got.key, old, next)) : undefined;
          if (!await a.replace(got.key, before, write, onChange)) throw new Fail('stale');
        } catch (e) {
          applying.delete(id); owned.delete(id);
          // storage.sync refusing this value (past its 8 KB an item, its total or its count of items): passed over as too big.
          // Its writes-a-minute and -an-hour limits pass, so those are tried again.
          if (got.area === 'sync' && !(e instanceof Fail) && !/MAX_WRITE_OPERATIONS/.test(String(e?.message))) throw new Fail('bad');
          throw e;
        }
      }
      await restamp({ [id]: got.at }, { [id]: stampBefore });
      // A later local write is still dirty even if it lands before the sync bookkeeping finishes.
      await put(h, { area: got.area, key: got.key, cat: got.cat, id: R.id, lsum: await sumOf(got.area, got.key, got.value), rsum: got.sum, at: got.at, seen: got.at }, was);
    };
    // This device's value up, at its time (or a tombstone once it is gone).
    const push = async (ctx, h, area, key, cat, was, at) => {
      const value = await valueOf(area, key), sum = await sumOf(area, key, value);
      const body = new TextEncoder().encode(JSON.stringify({ glaze: 'record', v: 1, cat, area, key, at, ...(value === undefined ? { deleted: true } : { value }) }));
      const meta = { appProperties: { glaze: 'rec', cat, key: h, sum, at: String(at) } };
      let r = null;
      if (was?.id) { try { r = await ctx.D((c) => c.put({ id: was.id, meta, mime: JSON_TYPE, bytes: body })); } catch (e) { if (e.why !== 'missing') throw e; } }
      r ||= await ctx.D((c) => c.put({ meta: { ...meta, name: `${cat}-${h.slice(0, 12)}.json`, mimeType: JSON_TYPE, parents: [ctx.data] }, mime: JSON_TYPE, bytes: body }));
      await put(h, { area, key, cat, id: r.id, lsum: sum, rsum: sum, at, seen: at }, was);
    };

    // One record, both sides. key and area: when known here; R: its file's metadata (undefined: ask Drive when known).
    const one = async (ctx, h, { area, key, R }) => {
      let was = await recOf(h);
      // Another device's file for the same record, made while this one made its own (first syncs that overlapped): every
      // device keeps the lowest id, met as a first meeting, so neither side's value is lost and each hears the other's after.
      if (was?.id && R?.id && !R.removed && R.id !== was.id) {
        if (R.id < was.id && !R.trashed) { await S.remove([REC + h, FILE + was.id]); was = null; } else R = undefined;
      }
      area ||= was?.area; key ||= was?.key;
      if (R === undefined) R = was?.id ? await ctx.D((c) => c.file(was.id)).catch((e) => { if (e.why === 'missing') return { removed: true }; throw e; }) : await lookup(ctx, h);
      if (R && !R.removed && R.trashed) R = { removed: true }; // a record file moved to Drive's trash: put back from here
      const st = await stamps();
      if (!key) { // a record only Drive has, met for the first time
        if (!R || R.removed) return;
        const got = await fetchRec(ctx, R, h);
        if (got.value !== undefined && await valueOf(got.area, got.key) === undefined) return take(h, got, R, null);
        return one(ctx, h, { area: got.area, key: got.key, R });
      }
      const def = defOf(area, key), cat = def?.cat;
      if (!cat) return;
      const value = await valueOf(area, key), lsum = await sumOf(area, key, value), at = st[`${area}:${key}`] || 0;
      if (def.immutable) {
        // The bytes never change, but Notes may have cleaned up this device's copy since it last used them.
        if (value === undefined) {
          if (R && !R.removed) { const got = await fetchRec(ctx, R, h); if (got.value !== undefined) await take(h, got, R, was, value); }
          return;
        }
        if (was && R && !R.removed) return;
      }
      if (!was) {
        if (!R || R.removed) { if (value !== undefined) await push(ctx, h, area, key, cat, null, at || now()); return; }
        const got = await fetchRec(ctx, R, h);
        if (got.sum === lsum) return put(h, { area, key, cat, id: R.id, lsum, rsum: got.sum, at: got.at, seen: Math.max(at, got.at) }, null);
        if (value === undefined) { if (got.value !== undefined) await take(h, got, R, null, value); else await put(h, { area, key, cat, id: R.id, lsum, rsum: got.sum, at: got.at, seen: got.at }, null); return; }
        if (got.value === undefined) return push(ctx, h, area, key, cat, { id: R.id }, Math.max(at, got.at + 1) || now());
        // First meeting, both hold it: Settings by time; the rest joined as Restore joins.
        if (cat === 'settings') { if (got.at > at) return take(h, got, R, null, value); return push(ctx, h, area, key, cat, { id: R.id }, at || now()); }
        applying.delete(`${area}:${key}`);
        await (env.join || ((c, k, v) => join(c, k, v, env.area('local'), env.area('notes'))))(cat, key, got.value);
        return push(ctx, h, area, key, cat, { id: R.id }, now());
      }
      if (!R || R.removed) { if (value !== undefined) await push(ctx, h, area, key, cat, { ...was, id: null }, at || now()); else await S.remove([REC + h, ...(was.id ? [FILE + was.id] : [])]); return; }
      const ldirty = lsum !== was.lsum, rdirty = R.appProperties?.sum !== was.rsum;
      if (!ldirty && !rdirty) { if (at > (was.seen || 0)) await put(h, { ...was, seen: at }, was); return; }
      if (rdirty) {
        const got = await fetchRec(ctx, R, h);
        if (!ldirty || got.at >= (at || 0)) return take(h, got, R, was, value);
      }
      return push(ctx, h, area, key, cat, was, at || now());
    };
    // The file another device made for h first, if any (oldest id first), so two devices never keep two.
    const lookup = async (ctx, h) => {
      const r = await ctx.D((c) => c.find(`'${ctx.data}' in parents and appProperties has { key='key' and value='${h}' } and appProperties has { key='glaze' and value='rec' } and trashed=false`, { pageSize: 10 }));
      return r.files.filter((f) => f.appProperties?.key === h).sort((a, b) => (a.id < b.id ? -1 : 1))[0] || null;
    };
    const each = async (ctx, h, x) => {
      try {
        await one(ctx, h, x);
        // A note's pictures and attachments go up with it (each once).
        const r = await recOf(h);
        if (r?.cat === 'notes') {
          const v = await valueOf('notes', r.key);
          for (const id of v ? L.notes().refs(v.html) : []) {
            const k = `${r.key.slice(0, r.key.lastIndexOf('|'))}|file|${id}`, fh = await hk('notes', k);
            if (!await recOf(fh) || await valueOf('notes', k) === undefined) await one(ctx, fh, { area: 'notes', key: k });
          }
        }
      } catch (e) {
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
      const remote = new Map();
      let page = null;
      do {
        const r = await ctx.D((c) => c.find(`'${ctx.data}' in parents and appProperties has { key='glaze' and value='rec' } and trashed=false`, { pageToken: page }));
        for (const f of r.files) if (HASH.test(f.appProperties?.key || '') && (!remote.has(f.appProperties.key) || f.id < remote.get(f.appProperties.key).id)) remote.set(f.appProperties.key, f);
        page = r.nextPageToken || null;
      } while (page);
      const seen = new Set();
      for (const { area, key } of await locals()) {
        const h = await hk(area, key);
        seen.add(h);
        const was = await recOf(h), R = remote.get(h) || null;
        await each(ctx, h, { area, key, R: !was?.id || (R && R.id <= was.id) ? R : undefined });
      }
      for (const [h, R] of [...remote].sort(([, a], [, b]) => (ORDER[a.appProperties?.cat] || 0) - (ORDER[b.appProperties?.cat] || 0))) if (!seen.has(h)) { seen.add(h); await each(ctx, h, { R }); }
      for (const k of (await S.keys()).filter((x) => x.startsWith(REC))) if (!seen.has(k.slice(REC.length))) await each(ctx, k.slice(REC.length), {});
      await snapshot(ctx);
    };
    // A page of Drive's changes: the record files among them.
    const changes = async (list, ctx) => {
      ctx.data = await sub(ctx, 'data', 'Data');
      list = [...list].sort((a, b) => (ORDER[a?.file?.appProperties?.cat] || 0) - (ORDER[b?.file?.appProperties?.cat] || 0));
      for (const c of list) {
        const f = c?.file;
        if (c?.removed || !f) {
          const ref = typeof c?.fileId === 'string' && (await S.get(FILE + c.fileId))[FILE + c.fileId];
          if (typeof ref === 'string' && ref.startsWith('r:')) await each(ctx, ref.slice(2), { R: { removed: true } });
          continue;
        }
        if (f.appProperties?.glaze !== 'rec' || !HASH.test(f.appProperties.key || '') || !(f.parents || []).includes(ctx.data)) continue;
        const was = await recOf(f.appProperties.key);
        if (was?.id && was.id !== f.id && (f.id > was.id || f.trashed)) continue;
        await each(ctx, f.appProperties.key, { R: f });
      }
    };
    // What changed here since it was last seen.
    const sweep = async (ctx) => {
      ctx.data = await sub(ctx, 'data', 'Data');
      const settled = {};
      for (const [id, at] of Object.entries(await stamps())) {
        const cut = id.indexOf(':'), area = id.slice(0, cut), key = id.slice(cut + 1);
        if (!catOf(area, key)) { settled[id] = at; continue; }
        const h = await hk(area, key), was = await recOf(h);
        // Times can tie, or a remote device's clock can be ahead of this one. Only unchanged content is settled.
        if (was && (was.seen || 0) >= at && await sumOf(area, key, await valueOf(area, key)) === was.lsum) { settled[id] = at; continue; }
        await each(ctx, h, { area, key });
      }
      if (Object.keys(settled).length) await unstamp(settled);
      await snapshot(ctx);
    };
    // The daily snapshot: Back up…'s zip in Backups, the newest SNAP.keep kept, older ones moved to Drive's trash.
    const snapshot = async (ctx) => {
      const st = (await S.get(STATE))[STATE] || {};
      if (!env.snapshot || (st.snap && now() - st.snap < SNAP.every)) return;
      // Tried once a day: one too big for a backup (null), one that can't be built, or one Drive refuses as it stands
      // (larger than one upload, or more than a full Drive has room for) waits for tomorrow, never failing the run or being
      // built again on every run. snapSkip: 'quota' while the day's was skipped for want of room (Settings says so).
      const skip = async (e) => { if (e) console.warn('Sync to Google Drive: no snapshot today', e?.why || e); await ctx.state({ snap: now(), snapSkip: e?.why === 'quota' ? 'quota' : null }); };
      let made;
      // A note saved while it was read (background/backup.js notesOut 'changed'): the next run tries again.
      try { made = await env.snapshot(); } catch (e) { if (e?.why === 'changed') return; return skip(e); }
      if (!made) return skip();
      let r, same, up;
      try {
        const backups = await sub(ctx, 'backups', 'Backups');
        r = await ctx.D((c) => c.find(`'${backups}' in parents and appProperties has { key='glaze' and value='snapshot' } and trashed=false`, { fields: 'id,name,trashed,appProperties,version', pageSize: 100 }));
        // Another device's of the same day (its name is the day's) is replaced, a new revision of the one file: five kept are five days.
        same = r.files.filter((f) => f.name === made.name).sort((a, b) => (a.id < b.id ? -1 : 1))[0];
        up = await ctx.D((c) => c.put({ ...(same && { id: same.id }), meta: { ...(!same && { name: made.name, mimeType: ZIP, parents: [backups] }), appProperties: { glaze: 'snapshot' } }, mime: ZIP, bytes: made.bytes }));
      } catch (e) { if (['bad', 'size', 'quota'].includes(e?.why)) return skip(e); throw e; }
      await ctx.state({ snap: now(), snapSkip: null });
      const all = same ? r.files : [...r.files, { id: up.id, name: made.name }];
      const old = all.sort((a, b) => (a.name < b.name ? 1 : a.name > b.name ? -1 : a.id < b.id ? 1 : -1)).slice(SNAP.keep);
      for (const f of old) await ctx.D((c) => c.patch(f.id, { trashed: true }));
    };
    const forget = async () => {
      const keys = (await S.keys()).filter((k) => k.startsWith(REC) || k === STAMPS);
      if (keys.length) await S.remove(keys);
    };
    // Whether a change to this key is one this layer listens for.
    const watches = (area, key) => !!catOf(area, key) || (area === 'local' && NOTES_KEY.test(key));
    return { stamp, full, changes, sweep, snapshot, forget, catOf, watches };
  };

  return { REC, FILE, STAMPS, CATS, SNAP, catOf, canon, clean, join, notesArea, create };
})();
if (typeof module !== 'undefined') module.exports = GZ_DRIVE_STORE;
