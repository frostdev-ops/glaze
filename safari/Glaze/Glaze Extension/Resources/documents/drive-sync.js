// Sync to Google Drive: Glaze's documents kept in step with a folder named Glaze in the student's own Google Drive, in the worker
// (background/background.js), with drive.file only (documents/drive.js; Glaze sees only the files it made); everything else
// Glaze keeps rides the same runs (env.more: background/drive-store.js). A setting, offered only while Drive is connected
// (settings/options.js), turned on when Drive connects unless the student turned it off (off); its state is this device's:
// storage.local driveSync { on, off, account, folder, token (the Changes API's page token), last, problem, wait, fails, busy }, a record per document
// (driveSyncDoc:<h>: its key, its two files, what each side held when they last agreed) and each file's document
// (driveSyncFile:<id>). h: the first 32 hex digits of the key's SHA-256, the tag both files carry (appProperties key).
// Each document is two files in the folder: its kind's file (.docx, .xlsx, .pdf, .pptx, written by the worker's own export:
// appProperties { glaze: 'file', key: h, sum }) and a JSON copy of the document and its record ({ glaze: 'document', v: 1,
// key, kind, record, parts (a spreadsheet's cells), file, fileRev }: appProperties { glaze: 'doc', key: h, sum, rev }).
// sum: the SHA-256 of what the copy holds (canon below), so each side's change is told by content: here, the record's
// revision moved and its sum is not the one last agreed; in Drive, the copy's sum is not the one last agreed. Glaze's own
// uploads come back through the Changes API with the sum already agreed, and change nothing. The kind's file is Glaze's
// while its head revision is the one Glaze wrote (fileRev); one whose head moved with Glaze's sum still on it was edited
// outside Glaze.
// The rules:
//   changed here only: pushed (the kind's file first, then its copy). Changed in Drive only: taken (papers.save).
//   Changed on both sides: both kept, nothing overwritten unseen. This device's stays current; Drive's becomes a version in
//     writerVersions (a paper, a deck, a spreadsheet's packed workbook), or, for a PDF (one copy, no versions), a document
//     of its own named "<title> (Drive copy)" (so is one too big to be a version); then this device's is pushed.
//   Met for the first time on both (a second device joining): as Restore, the later edited (updated) stays current and the
//     other is kept beside it as above. Two copies of one document (first syncs that overlapped): the lowest id is kept.
//   A .docx or .xlsx edited outside Glaze is never overwritten: it stays in Drive as it is (glaze: 'kept') and Glaze writes
//     a new file beside it. A .pdf or .pptx edited outside Glaze is the document's new content, as a change in Drive.
//   Trash: a document trashed or restored in Glaze moves its two files into or out of Drive's trash; a file trashed or
//     restored in Drive moves the document into or out of Glaze's Trash (both changed: restored wins). A document deleted
//     for good here (Delete forever, Trash's 30 days, Clear) has its files trashed in Drive; a file deleted for good in Drive
//     (a 404, or removed from the changes) puts the document in Trash here. No document is ever deleted for good by Glaze.
// When: turning it on uploads every document and takes Drive's (a full pass, the page token taken first); then each run
// reads the changes since its token and pushes the documents saved since (driveSyncDirty, marked by the worker as they are
// written), each push 5 s after the last save (WAIT.push). Runs start when it is turned on, when the browser starts or
// comes back online, and when Documents or Writer opens (at most every 30 s). One run at a time and one document at a
// time (Web Locks where there are, else a queue). Drive's busy answers (rate limits, 429, 5xx) are retried 5 times with
// growing waits in a run, then the run stops and the next waits a minute, doubling to an hour; Glaze's own requests never
// ask the student to sign in. The account: bound when turned on; another account connected stops Sync, forgets this
// account's state and touches nothing on either side (documents/drive.js stops a client the moment its account changes).
// A file larger than one request (documents/drive.js SMALL) never holds a run up: the run's own pass stages it (an upload's
// bytes, or a download to come) and goes on to the rest, the change list's token moving past it; the run's last step sends
// it in chunks, as far as the worker's life allows, and a later run goes on from where Drive says it stands (transfers below).
// Nothing goes anywhere but Google Drive.
// Classic script for the worker; module.exports for node.
var GZ_DRIVE_SYNC = globalThis.GZ_DRIVE_SYNC || (() => {
  const STATE = 'driveSync', DOC = 'driveSyncDoc:', FILE = 'driveSyncFile:', DIRTY = 'driveSyncDirty', WAITING = 'driveSyncWaiting', AWAY = 'driveSyncAway', MOVES = 'driveSyncMoves';
  const FOLDER = 'application/vnd.google-apps.folder', JSON_TYPE = 'application/json', NAME = 'Glaze';
  const KINDS = ['paper', 'sheet', 'pdf', 'slides'], FILES = ['pdf', 'slides'];
  const EXT = { paper: '.docx', sheet: '.xlsx', pdf: '.pdf', slides: '.pptx' };
  // What a record carries that is this device's own, never synced or compared.
  const STRIP = ['key', 'revision', 'titled', 'edited', 'lastVersion', 'parts', 'partDrops', 'drive', 'trashed', 'updated'];
  // copy: how long a file that moved on waits for its JSON copy (tries, or ms since first seen) before it stands alone.
  const WAIT = { push: 5000, pull: 30e3, retry: [1000, 2000, 4000, 8000, 16000], run: 60e3, most: 3600e3, copy: { tries: 3, ms: 10 * 60e3 } };
  const MAX_JSON = 64e6;
  // Larger than this, a transfer waits for the run's last step (documents/drive.js SMALL: an upload past it goes resumable);
  // the stage keeps its bytes in pieces of up to PIECE, each at its offset.
  const BIG = 5 << 20, PIECE = 8 << 20;
  const HASH = /^[0-9a-f]{32}$/, SUM = /^[0-9a-f]{64}$/, PART = /^\d{1,9}:\d{1,5}$/;
  // Why a run stopped that only the student can fix (Settings says how); every other reason is tried again later.
  const STOP = new Set(['auth', 'connect', 'account', 'setup', 'off', 'permission', 'scope', 'browser', 'unsupported', 'quota', 'folder']);
  // Why one document is passed over while the rest go on: its copy unreadable, too large, or refused by Drive.
  const SKIP = new Set(['bad', 'type', 'size', 'denied']);
  class Fail extends Error { constructor(why) { super(why); this.why = why; } }
  const P = () => globalThis.GZ_WRITER_PAPERS || require('../writer/writer-papers.js');

  // JSON with every object's keys in order: the same document, the same text, on every device.
  const canon = (v) => JSON.stringify(v, (_, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x));
  const strip = (rec) => Object.fromEntries(Object.entries(rec || {}).filter(([k, v]) => !STRIP.includes(k) && v !== undefined));
  const syncable = (key) => typeof key === 'string' && !key.startsWith('recovery:') && P().valid(key);
  const kindOf = (rec) => (typeof rec?.kind === 'string' && rec.kind) || 'paper';
  const body = (key, rec, parts) => ({ key, kind: kindOf(rec), record: strip(rec), ...(kindOf(rec) === 'sheet' && { parts: parts || {} }) });
  const safe = (s) => String(s || '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
  const whyOf = (e) => (e instanceof Fail || typeof e?.why === 'string' ? e.why : 'stale');
  const byId = (a, b) => (a.id < b.id ? -1 : 1);

  // The one folder of a kind every device keeps: Glaze in My Drive (tag 'root') and its Data and Backups (background/
  // drive-store.js). Devices that each made one at once converge on the lowest id: what another holds moves into it, and
  // the emptied one, tagged 'merged', is put away in Glaze/Data (hide), never into Drive's trash (which would take any file
  // of the student's in it along). mine: the one this device holds, counted before Drive's search shows it, and followed
  // when merged (what was put there since moves too). D: a run's Drive (create's D). → the folder's id
  const converge = async (D, { parent = null, tag, name, mine = null, hide = null }) => {
    const ok = (f) => !!f && f.mimeType === FOLDER && !f.trashed && f.appProperties?.glaze === tag && (!parent || (f.parents || []).includes(parent));
    const live = (await D((c) => c.find(`${parent ? `'${parent}' in parents and ` : ''}mimeType='${FOLDER}' and appProperties has { key='glaze' and value='${tag}' } and trashed=false`, { pageSize: 100 }))).files.filter(ok);
    let held = null;
    if (mine && !live.some((f) => f.id === mine)) {
      held = await D((c) => c.file(mine)).catch((e) => { if (e.why === 'missing') return null; throw e; });
      if (ok(held)) { live.push(held); held = null; }
    }
    live.sort(byId);
    const win = live[0] || await D((c) => c.folder({ name, mimeType: FOLDER, ...(parent && { parents: [parent] }), appProperties: { glaze: tag } }));
    for (const f of [...live.slice(1), ...(held && !held.trashed && held.appProperties?.glaze === 'merged' ? [held] : [])]) {
      // Each child moved, until none is left that Glaze can see (drive.file: the student's own stay where they are).
      for (let n = 0; n < 100; n++) {
        const r = await D((c) => c.find(`'${f.id}' in parents and trashed=false`, { pageSize: 100 }));
        const kids = r.files.filter((x) => (x.parents || []).includes(f.id));
        if (!kids.length) break;
        for (const x of kids) await D((c) => c.patch(x.id, {}, undefined, { add: win.id, remove: [f.id] }));
      }
      if (f.appProperties?.glaze === 'merged') continue;
      const into = hide ? await hide(win.id) : win.id;
      await D((c) => c.patch(f.id, { appProperties: { glaze: 'merged' } }, undefined, { add: into, remove: f.parents || [] }));
    }
    return win.id;
  };

  // env: { drive(active) (a documents/drive.js client, interactive: false, with active checked by its allowed hook), account() (the connected
  // account's email, background/google.js account), store (storage.local: get, set, remove, keys), papers (writer/writer-papers.js in
  // the worker's queue: get, list, save, trash, untrash, keep), parts(key, record) (a spreadsheet's stored parts, each
  // without its rev), files { has(hash), put(bytes, type) → ref } (documents/doc-files.js), exportOf(key, record, parts) →
  // { name, mime, bytes } or null, pack(record, parts) → a spreadsheet version's gz, hash(text) → SHA-256 hex,
  // copyName(title), now, sleep, random, locks (navigator.locks or null), timer(fn, ms) → cancel, stage (transfers' bytes:
  // documents/doc-files.js idb's get, keys, entries, write; none: every transfer in one request), alive() → stop (keeps the
  // worker up while transfers go; none on Safari) }
  const create = (env) => {
    const now = env.now || Date.now, S = env.store;
    const sleep = env.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
    const random = env.random || Math.random;
    const timer = env.timer || ((fn, ms) => { const t = setTimeout(fn, ms); return () => clearTimeout(t); });
    const locks = env.locks === undefined ? globalThis.navigator?.locks || null : env.locks;
    // Everything else Glaze keeps (background/drive-store.js): its hooks run in these same runs, after the documents.
    const more = env.more || null;
    const chains = new Map();
    const queued = (name, fn) => {
      const p = (chains.get(name) || Promise.resolve()).then(fn, fn), tail = p.catch(() => {});
      chains.set(name, tail);
      tail.then(() => { if (chains.get(name) === tail) chains.delete(name); });
      return p;
    };
    const held = (name, fn) => (locks ? locks.request(`glaze-drive-sync:${name}`, () => fn()) : queued(name, fn));

    // ---- this device's state
    const state = async () => ({ on: false, ...((await S.get(STATE))[STATE] || {}) });
    const setState = (patch, valid = () => true) => held('state', async () => {
      const was = await state();
      if (!valid()) return was;
      const next = { ...was, ...patch }; await S.set({ [STATE]: next }); return next;
    });
    const docOf = async (h) => (await S.get(DOC + h))[DOC + h] || null;
    const putDoc = async (h, d, was) => {
      const ids = [d.json, d.file].filter(Boolean), gone = [was?.json, was?.file].filter((id) => id && !ids.includes(id));
      await S.set({ [DOC + h]: d, ...Object.fromEntries(ids.map((id) => [FILE + id, h])) });
      if (gone.length) await S.remove(gone.map((id) => FILE + id));
      return d;
    };
    const dropDoc = (h, was) => S.remove([DOC + h, ...[was?.json, was?.file].filter(Boolean).map((id) => FILE + id)]);
    const forget = async () => {
      const keys = (await S.keys()).filter((k) => k.startsWith(DOC) || k.startsWith(FILE) || k === DIRTY || k === WAITING || k === AWAY || k === MOVES);
      if (keys.length) await S.remove(keys);
      if (stage) { const ks = await stage.keys(''); if (ks.length) await stage.write([], ks); }
      await more?.forget();
    };
    const hk = async (key) => (await env.hash(key)).slice(0, 32);
    // The documents saved since they were last pushed: key → a count, so a save during a push keeps its mark.
    const mark = (key) => held('dirty', async () => { const m = (await S.get(DIRTY))[DIRTY] || {}; m[key] = (m[key] || 0) + 1; await S.set({ [DIRTY]: m }); });
    const unmark = (key, n) => held('dirty', async () => { const m = (await S.get(DIRTY))[DIRTY] || {}; if (m[key] === n) { delete m[key]; await S.set({ [DIRTY]: m }); } });

    // ---- Drive, through this run's client: busy answers waited out and asked again, up to WAIT.retry's tries.
    let client = null, stopped = 0, runStop = 0, runAccount = null;
    const active = async () => {
      if (!(await state()).on || runStop !== stopped) throw new Fail('off');
      if (await Promise.resolve().then(env.account).catch(() => null) !== runAccount) throw new Fail('connect');
    };
    const D = async (fn) => {
      for (let i = 0; ; i++) {
        try {
          await active();
          const value = await fn(client);
          await active();
          return value;
        } catch (e) {
          if (e?.why !== 'busy' || i >= WAIT.retry.length) throw e;
          await sleep(Math.round(WAIT.retry[i] * (1 + random() / 4)));
        }
      }
    };
    const meta = async (id) => { try { return await D((c) => c.file(id)); } catch (e) { if (e.why === 'missing') return { id, removed: true }; throw e; } };
    const trashTo = async (id, on) => { if (!id) return; try { await D((c) => c.patch(id, { trashed: on })); } catch (e) { if (e.why !== 'missing') throw e; } };

    // ---- transfers larger than one request. env.stage (IndexedDB glaze-drive in the worker: '<slot>@<offset>' → a piece)
    // keeps an upload's bytes and a download's so far; storage.local driveSyncMoves { slot: { dir, tag, size, owner, since,
    // … } } what each is: an upload's target and metadata, its resumable session (documents/drive.js put keep: the session's
    // address, what Drive confirmed, the bytes' SHA-256) and, once sent, Drive's answer (file); a download's file, revision,
    // what has come (at) and whether it is whole (done). A run's own pass never sends one: up and down stage it and say
    // 'pending' (that document or record waits; the rest goes on). The run's last step (transfers) sends them, oldest first,
    // as far as the worker's life allows, then hands each back to its owner, whose next up or down takes the answer.
    const stage = env.stage || null;
    const moves = async () => (await S.get(MOVES))[MOVES] || {};
    const moveOf = async (slot) => (await moves())[slot] || null;
    const setMove = (slot, t) => held('moves', async () => {
      const m = await moves();
      if (t) m[slot] = t; else if (m[slot]) delete m[slot]; else return;
      await S.set({ [MOVES]: m });
    });
    const patchMove = (slot, patch) => held('moves', async () => { const m = await moves(); if (!m[slot]) return; m[slot] = { ...m[slot], ...patch }; await S.set({ [MOVES]: m }); });
    const at12 = (n) => String(n).padStart(12, '0');
    const unstage = async (slot) => { const ks = await stage.keys(`${slot}@`); if (ks.length) await stage.write([], ks); };
    const dropMove = async (slot) => { await setMove(slot, null); if (stage) await unstage(slot); };
    // Each piece its own copy: IndexedDB would keep a view's whole buffer.
    const staged = async (slot, bytes) => {
      const puts = [];
      for (let a = 0; a < bytes.length; a += PIECE) puts.push([`${slot}@${at12(a)}`, bytes.slice(a, a + PIECE)]);
      const keep = new Set(puts.map(([k]) => k));
      await stage.write(puts, (await stage.keys(`${slot}@`)).filter((k) => !keep.has(k)));
    };
    // The staged bytes, 0 to size in order, or null when any is missing (the stage cleared under it).
    const unstaged = async (slot, size) => {
      const out = new Uint8Array(size);
      let n = 0;
      for (const [k, v] of await stage.entries(`${slot}@`)) {
        if (n === size) break;
        if (Number(k.slice(slot.length + 1)) !== n || !(v?.length > 0) || n + v.length > size) return null;
        out.set(v, n); n += v.length;
      }
      return n === size ? out : null;
    };
    // o: { id (the file to update, or null), meta (for an update), create (for a new file, in its folder), mime }: as put
    // sends it, a new file when the one to update is gone (gone(): told first, so a later worker goes on with the new one;
    // null: 'missing' instead).
    const send = async (o, bytes, keep = null, gone = async () => {}) => {
      if (o.id) {
        try { return await D((c) => c.put({ id: o.id, meta: o.meta, mime: o.mime, bytes, keep })); } catch (e) { if (e.why !== 'missing' || !gone) throw e; }
        await keep?.drop(); await gone();
      }
      return D((c) => c.put({ meta: o.create, mime: o.mime, bytes, keep }));
    };
    // An upload of this content (tag) to slot, aimed at the file target (undefined: whichever make chooses). make() → { bytes,
    // id, meta, create, mime, info } or null (nothing to send), called only when it isn't already on its way. Small: sent now.
    // Large: staged, 'pending' until sent; one on its way to another file than the one aimed at now starts again. Once sent,
    // taken whichever file it landed in (a new one when its own was gone). → { file (Drive's answer), info } or null
    const up = async (slot, tag, target, make, owner) => {
      const t = await moveOf(slot);
      if (t?.dir === 'up' && t.tag === tag && (t.file || target === undefined || (t.aim ?? null) === (target ?? null))) {
        if (t.file) { await dropMove(slot); return { file: t.file, info: t.info ?? null }; }
        throw new Fail('pending');
      }
      if (t) await dropMove(slot);
      const m = await make();
      if (!m) return null;
      if (!stage || m.bytes.length <= BIG) return { file: await send(m, m.bytes), info: m.info ?? null };
      await staged(slot, m.bytes);
      await setMove(slot, { dir: 'up', tag, aim: target === undefined ? m.id ?? null : target ?? null, size: m.bytes.length, id: m.id ?? null, meta: m.meta, create: m.create, mime: m.mime,
        info: m.info ?? null, owner, since: now(), session: null, file: null });
      throw new Fail('pending');
    };
    // A download of file f (its metadata: id, size, headRevisionId), at most max bytes. Small, or of no size Drive gives:
    // read now. Large: 'pending' until brought into the stage by ranges, then taken by the next call. Its tag is the file's id,
    // revision and size: one replaced meanwhile starts over. → Uint8Array
    const down = async (slot, f, max, owner) => {
      const size = Number(f?.size);
      if (!stage || !Number.isSafeInteger(size) || size <= BIG || typeof f.headRevisionId !== 'string') return D((c) => c.media(f.id, max));
      if (size > max) throw new Fail('size');
      const tag = `${f.id}:${f.headRevisionId}:${size}`, t = await moveOf(slot);
      if (t?.dir === 'down' && t.tag === tag) {
        if (!t.done) throw new Fail('pending');
        const bytes = await unstaged(slot, size);
        if (bytes) return bytes;
        await dropMove(slot);
      } else if (t) await dropMove(slot);
      await setMove(slot, { dir: 'down', tag, id: f.id, rev: f.headRevisionId, size, max, at: 0, step: PIECE, owner, since: now(), done: false });
      throw new Fail('pending');
    };
    // One upload sent: its session kept on its record between requests and workers. A document's whose file is gone from
    // Drive goes back to the document ('missing'), which goes to Trash as a file deleted for good in Drive does; a record's
    // or the snapshot's goes into a new file.
    const sendMove = async (slot, t) => {
      const bytes = await unstaged(slot, t.size);
      if (!bytes) throw new Fail('missing');
      const keep = { get: async () => (await moveOf(slot))?.session || null, set: (session) => patchMove(slot, { session }), drop: () => patchMove(slot, { session: null }) };
      const file = await send(t, bytes, keep, t.owner?.doc ? null : () => patchMove(slot, { id: null }));
      await patchMove(slot, { file, session: null });
    };
    // One download brought in by ranges, each piece kept as it comes; a file whose revision or size moved meanwhile, or that
    // is gone, is given back to its owner to ask anew ('missing').
    const bringMove = async (slot, t) => {
      const same = (f) => !f.removed && f.trashed !== true && f.headRevisionId === t.rev && Number(f.size) === t.size;
      if (!same(await meta(t.id))) throw new Fail('missing');
      let at = t.at || 0, step = t.step || PIECE;
      if (t.sending) step = Math.max(256 << 10, Math.floor(step / 2));
      while (at < t.size) {
        const to = Math.min(t.size, at + step) - 1, began = Date.now();
        await patchMove(slot, { step, sending: true });
        const r = await D((c) => c.part(t.id, at, to, t.max));
        if (r.whole) {
          if (r.bytes.length !== t.size) throw new Fail('missing');
          await staged(slot, r.bytes); at = t.size;
        } else {
          if (!r.bytes.length) throw new Fail('bad');
          await stage.write([[`${slot}@${at12(at)}`, r.bytes.slice()]]); at += r.bytes.length;
        }
        const took = Date.now() - began;
        step = took > 15000 ? Math.max(256 << 10, step / 2) : took < 5000 ? Math.min(PIECE, step * 2) : step;
        await patchMove(slot, { at, step, sending: false });
      }
      if (!same(await meta(t.id))) throw new Fail('missing');
      await patchMove(slot, { done: true });
    };
    // The run's last step. Each transfer on its way, oldest first: sent or brought in, then handed back to its owner (a
    // document's next step, a record, the day's snapshot), which takes it. One its owner no longer wants is let go. A file
    // gone, or replaced, goes back to its owner to ask anew; one Drive refuses as it stands is passed over (a snapshot's
    // day skipped). env.alive keeps the worker up meanwhile where it can (not Safari: there the next run goes on).
    const transfers = async (folder) => {
      if (!stage || !Object.keys(await moves()).length) return;
      const stop = env.alive?.() || null, tries = new Map();
      try {
        for (;;) {
          const [slot, t] = Object.entries(await moves()).filter(([k]) => (tries.get(k) || 0) < 3).sort(([, a], [, b]) => (a.since || 0) - (b.since || 0))[0] || [];
          if (!slot) return;
          tries.set(slot, (tries.get(slot) || 0) + 1);
          if (t.dir === 'up' && t.owner?.doc) {
            const key = t.owner.key || (await docOf(t.owner.doc))?.key, l = key ? await local(key) : null;
            // A first upload has no document link yet: a later Trash or Delete must still cancel it.
            if (!l || P().trashed(l.rec)) {
              if (t.file?.id) await trashTo(t.file.id, true);
              await dropMove(slot);
              continue;
            }
          }
          try {
            if (!t.file && !t.done) await (t.dir === 'up' ? sendMove(slot, t) : bringMove(slot, t));
          } catch (e) {
            if (e?.why === 'missing') { await dropMove(slot); await replay(t.owner, folder); continue; }
            if (SKIP.has(e?.why) || (t.owner?.snap && e?.why === 'quota')) {
              console.warn('Sync to Google Drive: passed over a transfer', slot, e.why);
              await dropMove(slot);
              if (t.owner?.key) await held('dirty', async () => { const m = (await S.get(DIRTY))[DIRTY] || {}; if (m[t.owner.key]) { delete m[t.owner.key]; await S.set({ [DIRTY]: m }); } });
              if (t.owner?.snap || t.owner?.rec) await more?.failed?.(t.owner, e.why, hooks(folder));
              continue;
            }
            throw e;
          }
          const result = await replay(t.owner, folder);
          const left = await moveOf(slot);
          if (left?.tag === t.tag && (left.file || (left.done && result !== 'pending'))) await dropMove(slot);
        }
      } finally { stop?.(); }
    };
    // A transfer's owner again, as the run met it: a document (by its tag, with the copy and file a change named), or one of
    // background/drive-store.js's.
    const replay = async (owner, folder) => {
      let result;
      if (owner?.doc) {
        const hint = { folder };
        if (owner.R) hint.R = await meta(owner.R);
        if (owner.E) hint.E = await meta(owner.E);
        result = await one(owner.key || null, owner.doc, hint);
      } else if (owner && more?.replay) result = await more.replay(owner, hooks(folder));
      // A document may need both its JSON and its file: keep each completed download until it has taken both.
      const same = (t) => owner?.doc ? t.owner?.doc === owner.doc : owner?.rec ? t.owner?.rec === owner.rec : false;
      const held = Object.entries(await moves()).filter(([, t]) => same(t) && t.dir === 'down');
      if (result !== 'pending' || !held.some(([, t]) => !t.done)) for (const [slot, t] of held) {
        if (t.done) await dropMove(slot);
      }
      return result;
    };

    // ---- the documents here
    const local = async (key) => {
      const rec = await env.papers.get(key);
      if (!rec || !KINDS.includes(kindOf(rec))) return null;
      return { rec, parts: kindOf(rec) === 'sheet' ? await env.parts(key, rec) : null };
    };
    const sumOf = (key, l) => env.hash(canon(body(key, l.rec, l.parts)));
    const dirty = async (key, l, d) => (l.rec.revision || 0) !== d.rev && (await sumOf(key, l)) !== d.lsum;

    // A JSON copy from Drive, checked: Glaze's, for the document its tag names (h, and key when known), of a known kind; a
    // PDF's or deck's bytes brought into the file store from its file when they aren't here, checked against the record's hash.
    // owner: the transfer's, when the copy or its file is too large to come in one request (down).
    const fetchCopy = async (R, h, key, owner) => {
      const sum = R.appProperties?.sum;
      if (!SUM.test(sum || '')) throw new Fail('bad');
      const bytes = await down(`d:${h}:json`, R, MAX_JSON, owner);
      let j;
      try { j = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new Fail('bad'); }
      if (j?.glaze !== 'document' || j.v !== 1 || !syncable(j.key) || (key && j.key !== key) || (await hk(j.key)) !== h || !KINDS.includes(j.kind)
        || !j.record || typeof j.record !== 'object' || Array.isArray(j.record) || kindOf(j.record) !== j.kind) throw new Fail('bad');
      if (j.kind === 'sheet' && (!j.parts || typeof j.parts !== 'object' || !Object.keys(j.parts).every((n) => PART.test(n) && Array.isArray(j.parts[n]?.rows)))) throw new Fail('bad');
      const record = { ...strip(j.record), kind: j.kind };
      const replacement = FILES.includes(j.kind) ? await bring(record.file, j.file, sum, j.fileRev, h, owner) : null;
      if (replacement) Object.assign(record, { file: replacement.ref, size: replacement.ref.size });
      return { key: j.key, kind: j.kind, record, parts: j.kind === 'sheet' ? j.parts : null, file: typeof j.file === 'string' ? j.file : null, updated: Number.isFinite(j.updated) ? j.updated : 0,
        fileRev: replacement?.rev || (typeof j.fileRev === 'string' ? j.fileRev : null), external: !!replacement,
        sum: replacement ? await env.hash(canon(body(j.key, record, null))) : sum };
    };
    const bring = async (ref, id, sum, rev, h, owner) => {
      if (!P().isRef(ref)) throw new Fail('bad');
      if (typeof id !== 'string') throw new Fail('bad');
      const E = await meta(id);
      if (E.removed || E.trashed) throw new Fail('bad');
      const external = E.headRevisionId && E.headRevisionId !== rev && E.appProperties?.sum === sum
        && E.appProperties?.glaze === 'file' && E.appProperties?.key === h;
      if (!external && await env.files.has(ref.hash)) return null;
      const bytes = await down(`d:${h}:file`, E, 50e6, owner);
      const got = await env.files.put(bytes, (external ? E.mimeType : ref.type) || '');
      // A new device has no earlier mapping or change event for an external replacement. Bring that side in now.
      if (external) return { ref: { hash: got.hash, size: got.size, type: got.type }, rev: E.headRevisionId };
      // The file moved on since the copy was written: its next copy is on its way, and the next run takes both. One that
      // never comes (its device stopped between the two) holds the document back only so long: then the file's own bytes
      // are Drive's side, as a replacement made outside Glaze is.
      if (got.hash !== ref.hash) {
        if (!await waited(h)) throw new Fail('stale');
        await unwait(h);
        return { ref: { hash: got.hash, size: got.size, type: got.type }, rev: E.headRevisionId };
      }
      await unwait(h);
      return null;
    };
    // A copy's file seen moved on: how many times and since when (storage.local driveSyncWaiting { h: { n, since } }). → waited long enough
    const waited = (h) => held('waiting', async () => {
      const m = (await S.get(WAITING))[WAITING] || {}, w = m[h] = { n: (m[h]?.n || 0) + 1, since: m[h]?.since || now() };
      await S.set({ [WAITING]: m });
      return w.n >= WAIT.copy.tries || now() - w.since >= WAIT.copy.ms;
    });
    const unwait = (h) => held('waiting', async () => { const m = (await S.get(WAITING))[WAITING]; if (m?.[h]) { delete m[h]; await S.set({ [WAITING]: m }); } });
    // Drive's side written here as the document's current state. → the record and its parts as written.
    const take = async (key, l, got) => {
      const { paper } = await env.papers.save(key, got.record, { reason: l && kindOf(l.rec) !== got.kind ? 'import' : 'auto', base: l ? l.rec.revision || 0 : 0, expectedRevision: l?.rec.revision || 0, rename: true,
        ...(got.kind === 'sheet' && { parts: got.parts, drop: Object.keys(l?.rec.parts || {}).filter((n) => !Object.hasOwn(got.parts, n)), changed: true }) });
      return { rec: paper, parts: got.kind === 'sheet' ? got.parts : null };
    };
    // Drive's side of a conflict kept beside this device's: a version, or a document of its own (a PDF's, and one too big
    // to be a version: writer/writer-papers.js keep's RangeError).
    const keepOther = async (key, l, got) => {
      const apart = async () => {
        const k = P().newKey(), title = env.copyName(String(got.record.title || l?.rec.title || (got.kind === 'pdf' ? 'PDF' : '')));
        await env.papers.save(k, { ...got.record, title, named: true }, { reason: 'auto', ...(got.kind === 'sheet' && { parts: got.parts, changed: true }) });
        await mark(k);
      };
      if (got.kind === 'pdf') return apart();
      try {
        if (got.kind === 'sheet') await env.papers.keep(key, { kind: 'sheet', gz: await env.pack(got.record, got.parts), cells: got.record.cells });
        else await env.papers.keep(key, got.record);
      } catch (e) { if (!(e instanceof RangeError)) throw e; await apart(); }
    };

    // This device's side kept as a version before Drive's is taken (a first meeting where Drive's was edited later).
    const keepMine = async (key, l) => {
      if (kindOf(l.rec) === 'sheet') await env.papers.keep(key, { kind: 'sheet', gz: await env.pack(l.rec, l.parts), cells: l.rec.cells });
      else await env.papers.keep(key, l.rec);
    };

    // This device's document up: its kind's file (a new one when it has none, or the one it had is gone), then its copy.
    // Either one larger than a request goes in the run's last step (up: 'pending'), the copy only once the file is there.
    const push = async (key, h, l, d, folder) => {
      const kind = kindOf(l.rec), b = body(key, l.rec, l.parts), sum = await env.hash(canon(b)), owner = { doc: h, key };
      // This content's file staged already (on its way, or sent): not exported again.
      const going = await moveOf(`u:${h}:file`), onWay = going?.dir === 'up' && going.tag === sum ? going : null;
      let ex = onWay ? null : await env.exportOf(key, l.rec, l.parts);
      // No file to make here (a PDF's bytes still in its record from before the file store, or gone from this device) and
      // Drive's copy already this one: nothing new to send.
      if (!ex && !onWay && d?.json && d.rsum === sum && d.lsum === sum) return d;
      const base = ((onWay ? onWay.info?.name : ex?.name) || `${safe(l.rec.title) || 'Untitled'}${EXT[kind]}`).replace(/\.[^.]+$/, '');
      let file = d?.file || null, fh = d?.fh || null;
      // A document going up for the first time may have a file there already: its push stopped before the JSON copy went.
      if (!file && !d?.json && (ex || onWay)) file = (await D((c) => c.find(`'${folder}' in parents and appProperties has { key='key' and value='${h}' } and appProperties has { key='glaze' and value='file' } and trashed=false`, { pageSize: 10 })))
        .files.filter((f) => f.appProperties?.key === h && f.appProperties?.glaze === 'file').sort((a, b) => (a.id < b.id ? -1 : 1))[0]?.id || null;
      if (ex || onWay) {
        const r = await up(`u:${h}:file`, sum, d?.file ? file : undefined, async () => {
          ex ||= await env.exportOf(key, l.rec, l.parts);
          if (!ex) return null;
          const meta = { name: ex.name, appProperties: { glaze: 'file', key: h, sum } };
          return { bytes: ex.bytes, id: file, meta, create: { ...meta, mimeType: ex.mime, parents: [folder] }, mime: ex.mime, info: { name: ex.name } };
        }, owner);
        if (r) { file = r.file.id; fh = r.file.headRevisionId || null; }
      }
      // updated: Last edited where it was pushed, for a first meeting's later-edited rule (not in the sum: no change by itself).
      const text = JSON.stringify({ glaze: 'document', v: 1, ...b, file, fileRev: fh, updated: Number.isFinite(l.rec.updated) ? l.rec.updated : 0 });
      const meta = { name: `${base}.glaze.json`, appProperties: { glaze: 'doc', key: h, sum, rev: String(l.rec.revision || 0) } };
      const r = await up(`u:${h}:json`, await env.hash(text), d?.json || null,
        async () => ({ bytes: new TextEncoder().encode(text), id: d?.json || null, meta, create: { ...meta, mimeType: JSON_TYPE, parents: [folder] }, mime: JSON_TYPE }), owner);
      return putDoc(h, { key, h, kind, json: r.file.id, file, fh, fsum: sum, rsum: sum, lsum: sum, rev: l.rec.revision || 0, trashed: false }, d);
    };
    // Drive's side kept here, recorded before this device's goes up: what follows (and a retry after a push that failed) meets
    // only this device's change, never keeping Drive's side a second time. R: the copy whose side was kept, or null.
    const kept = async (h, d, R) => putDoc(h, { ...d, ...(R && { rsum: R.appProperties?.sum }) }, await docOf(h));
    const agreed = async (key, h, R, got, l, d) => putDoc(h, { key, h, kind: got.kind, json: R.id, file: got.file, fh: got.fileRev, fsum: got.sum, rsum: got.sum,
      lsum: await sumOf(key, l), rev: l.rec.revision || 0, trashed: false }, d);

    // One document, both sides. R: its JSON copy's metadata from Drive (undefined: not known yet; null: Drive has none;
    // { removed }: deleted for good, or out of reach); E: its kind's file's, when a change named it.
    const sync = async (key, h, { R, E, folder }) => {
      if (!(await state()).on) throw new Fail('off');
      // As this run met it, should a transfer it needs go on in the run's last step (replay).
      const owner = { doc: h, key: key || null, ...(R?.id && { R: R.id }), ...(E?.id && { E: E.id }) };
      let d = await docOf(h), gone = null;
      key ||= d?.key || null;
      if (key && !syncable(key)) return;
      let l = key ? await local(key) : null;
      const lt = !!l && P().trashed(l.rec);
      // Another device's copy of the same document. One made while this device made its own (first syncs that overlapped):
      // every device keeps the lowest id, met as a first meeting; any other is not this one's.
      if (d && R?.id && R.id !== d.json && !R.removed) {
        if (R.id < d.json && !R.trashed) {
          gone = d;
          await away([gone.json, gone.file], h);
          await dropDoc(h, d); d = null;
          await putAway(gone.json, folder); await away([gone.json], null);
        } else R = undefined;
      }
      if (d && E && E.id !== d.file) E = undefined;
      if (R === undefined) R = d?.json ? await meta(d.json) : d ? null : !lt && l ? await lookup(h, folder) : null;
      // This device's copy moved out of the Glaze folder (put away by the device whose copy it was, as above, or moved by
      // the student): no longer the document's; the folder's copy is, met as a first meeting, or this device's goes up anew.
      if (d && R && !R.removed && R.id === d.json && Array.isArray(R.parents) && !R.parents.includes(folder)) {
        await dropDoc(h, d); d = null;
        R = !lt && l ? await lookup(h, folder) : null;
      }

      if (!d) {
        if (!R || R.removed || R.trashed || lt) { if (l && !lt && !R) await push(key, h, l, null, folder); return; }
        const got = await fetchCopy(R, h, key, owner);
        // Met by its tag alone (Drive's changes) while this device holds that document too, unlinked (written before its first
        // push, or its link let go): a first meeting with this device's own, never a download over it.
        if (!key && await env.papers.get(got.key)) return sync(got.key, h, { R, folder });
        if (gone?.file) { if (gone.file !== got.file) await putAway(gone.file, folder); await away([gone.file], null); }
        const source = { json: R.id, file: got.file, fh: got.fileRev, fsum: got.sum };
        if (!l) { const now2 = await take(got.key, null, got); if (got.external) return push(got.key, h, now2, source, folder); await agreed(got.key, h, R, got, now2, null); return; }
        if ((await sumOf(key, l)) !== got.sum) {
          // Both hold it, as with Restore: the later edited stays current, the other kept beside it (a PDF: both documents).
          if (got.kind !== 'pdf' && got.kind === kindOf(l.rec) && got.updated > (l.rec.updated || 0)
            && await keepMine(key, l).then(() => true, (e) => { if (e instanceof RangeError) return false; throw e; })) {
            const now2 = await take(key, l, got);
            if (got.external) return push(key, h, now2, source, folder);
            await agreed(key, h, R, got, now2, null);
            return;
          }
          await keepOther(key, l, got);
          await kept(h, { key, h, kind: kindOf(l.rec), ...source, lsum: null, rev: -1, trashed: false }, R);
          return sync(key, h, { folder });
        }
        if (got.external) return push(key, h, l, source, folder);
        await agreed(key, h, R, got, l, null);
        return;
      }

      // Deleted for good in Drive, either file: into Trash here, the other file into Drive's trash.
      if (R?.removed || E?.removed) {
        if (l && !lt) await env.papers.trash(key);
        if (R?.removed) { await trashTo(d.file, true); await dropDoc(h, d); return; }
        await trashTo(d.json, true);
        await putDoc(h, { ...d, file: null, fh: null, trashed: true }, d);
        return;
      }
      if (!R) { // a document this device knew whose copy it can no longer find: up again as new
        if (l && !lt) await push(key, h, l, { ...d, json: null }, folder);
        return;
      }
      // Deleted for good here: Drive's files into Drive's trash, never further. One restored in Drive meanwhile comes back.
      if (!l) {
        if (d.trashed && R.trashed === false) { await dropDoc(h, d); return sync(null, h, { R, folder }); }
        if (!d.trashed) { await trashTo(d.json, true); await trashTo(d.file, true); }
        await dropDoc(h, d);
        return;
      }

      // Trash: each side's move since they last agreed; both moved apart, restored wins.
      const was = d.trashed === true, rt = typeof R.trashed === 'boolean' ? R.trashed : null, et = E && typeof E.trashed === 'boolean' ? E.trashed : null;
      const there = [rt, et].find((x) => x !== null && x !== was);
      let to = was;
      if (lt !== was && there !== undefined) to = lt && there;
      else if (lt !== was) to = lt;
      else if (there !== undefined) to = there;
      if (to !== was || (rt !== null && rt !== to) || (et !== null && et !== to)) {
        if (to !== lt) await (to ? env.papers.trash(key) : env.papers.untrash(key));
        if (rt !== to) await trashTo(d.json, to);
        if (d.file && et !== to) await trashTo(d.file, to);
        await putDoc(h, { ...d, trashed: to }, d);
        d.trashed = to;
        if (to) return;
        l = await local(key);
      }
      if (to) return;

      // Content.
      const ldirty = await dirty(key, l, d), rdirty = R.appProperties?.sum !== d.rsum;
      let force = !d.file;
      if (d.file && !E && ldirty) E = await meta(d.file);
      if (E?.removed) { await env.papers.trash(key); await trashTo(d.json, true); await putDoc(h, { ...d, file: null, fh: null, trashed: true }, d); return; }
      if (E && E.headRevisionId && E.headRevisionId !== d.fh && E.appProperties?.sum === d.fsum && E.appProperties?.glaze === 'file') {
        if (FILES.includes(d.kind || kindOf(l.rec))) {
          // A PDF or deck replaced in Drive: its new bytes are Drive's side.
          const bytes = await down(`d:${h}:file`, E, 50e6, owner), ref = await env.files.put(bytes, E.mimeType || '');
          const base = rdirty ? (await fetchCopy(R, h, key, owner)).record : strip(l.rec);
          const got = { kind: kindOf(l.rec), record: { ...base, kind: kindOf(l.rec), file: { hash: ref.hash, size: ref.size, type: ref.type }, size: ref.size }, parts: null, file: d.file, fileRev: E.headRevisionId, sum: null };
          if (ldirty) await keepOther(key, l, got);
          else l = await take(key, l, got);
          return push(key, h, l, await kept(h, { ...d, fh: E.headRevisionId }, rdirty ? R : null), folder);
        }
        // A .docx or .xlsx edited outside Glaze stays as it is; the document gets a file of its own again.
        // Detach durably before any more Drive writes: a failed upload or stopped worker must never reuse this id.
        await putDoc(h, { ...d, file: null, fh: null, fsum: null }, d);
        await D((c) => c.patch(d.file, { appProperties: { glaze: 'kept', sum: null } }));
        Object.assign(d, { file: null, fh: null, fsum: null });
        force = true;
      } else if (E && !E.removed && E.id === d.file && E.appProperties?.glaze !== 'file') {
        // One another device kept so (or anything else no longer Glaze's file): never written again.
        await putDoc(h, { ...d, file: null, fh: null, fsum: null }, d);
        Object.assign(d, { file: null, fh: null, fsum: null });
        force = true;
      }
      if (rdirty) {
        const got = await fetchCopy(R, h, key, owner);
        // Both changed to the same thing (another device took what this one pushed only halfway): nothing to keep apart.
        if (ldirty && (await sumOf(key, l)) === got.sum) { await agreed(key, h, R, got, l, d); return; }
        // Then this device's goes up as a change of its own, into the file Drive's copy names (another device may have left
        // the one this device knew) and as that file stands (edited outside Glaze since: kept as it is).
        if (ldirty) { await keepOther(key, l, got); await kept(h, { ...d, ...(got.file && { file: got.file, fh: got.fileRev, fsum: got.sum }) }, R); return sync(key, h, { folder }); }
        const now2 = await take(key, l, got);
        if (force && got.file && !got.external) {
          // No Glaze file of its own here (none yet, or the one it had is no longer Glaze's): the one Drive's copy names, while
          // it is still this document's Glaze file and not edited outside Glaze since that copy was written. Never a new one
          // beside it. One edited outside since is kept as it is (as above), and a new one goes up.
          const F = await meta(got.file);
          const ours = !F.removed && F.trashed === false && F.appProperties?.glaze === 'file' && F.appProperties?.key === h;
          const outside = !!F.headRevisionId && F.headRevisionId !== got.fileRev && F.appProperties?.sum === got.sum;
          if (ours && !outside) { await agreed(key, h, R, got, now2, d); return; }
          if (ours && !FILES.includes(got.kind)) await D((c) => c.patch(got.file, { appProperties: { glaze: 'kept', sum: null } }));
        }
        if (force || got.external) return push(key, h, now2, { ...d, json: R.id }, folder);
        await agreed(key, h, R, got, now2, d);
        return;
      }
      if (ldirty || force) await push(key, h, l, d, folder);
    };
    // A copy that lost to another of the same document, put away in Glaze/Data: out of the folder the student browses and
    // every search, so no device links to it anew, and never in Drive's trash, so a device still linked to it loses nothing
    // (it writes there until the folder's copy changes, then meets that one).
    const putAway = async (id, folder) => {
      const f = id ? await meta(id) : null;
      if (!f || f.removed || !(f.parents || []).includes(folder)) return;
      const data = await converge(D, { parent: folder, tag: 'data', name: 'Data' });
      await D((c) => c.patch(id, {}, undefined, { add: data, remove: [folder] }));
    };
    // A losing copy's files still to be put away (storage.local driveSyncAway: id → its document's tag), recorded before its
    // link goes, so a run that stopped first finishes the move on the next. h null: done.
    const away = (ids, h) => held('away', async () => {
      const m = (await S.get(AWAY))[AWAY] || {};
      for (const id of ids.filter(Boolean)) { if (h) m[id] = h; else delete m[id]; }
      await S.set({ [AWAY]: m });
    });
    // Those whose document met the folder's copy since: each moved unless it is that copy's own (a file both shared); one
    // whose document hasn't yet waits.
    const tidy = async (folder) => {
      for (const [id, h] of Object.entries((await S.get(AWAY))[AWAY] || {})) {
        const d = await docOf(h);
        if (!d) continue;
        if (id !== d.json && id !== d.file) await putAway(id, folder);
        await away([id], null);
      }
    };
    // The JSON copy Drive holds for h, if another device made one first (oldest id first).
    const lookup = async (h, folder) => {
      const r = await D((c) => c.find(`'${folder}' in parents and appProperties has { key='key' and value='${h}' } and appProperties has { key='glaze' and value='doc' } and trashed=false`, { pageSize: 10 }));
      return r.files.filter((f) => f.appProperties?.key === h).sort((a, b) => (a.id < b.id ? -1 : 1))[0] || null;
    };
    // A document Drive's copy of can't be read is passed over; one that met a write here or a file still moving
    // (stale, or the paper store's refusal) is marked to be tried again next run. Drive's own trouble stops the run.
    // → 'pending' for one whose file waits for the run's last step.
    const one = (key, h, hint) => held(`doc:${h}`, () => sync(key, h, hint)).catch(async (e) => {
      if (e?.why === 'pending') return 'pending';
      if (SKIP.has(e?.why)) { console.warn('Sync to Google Drive: passed over', h, e.why); return; }
      if (e instanceof Fail ? e.why !== 'stale' : typeof e?.why === 'string') throw e;
      console.warn('Sync to Google Drive: again next run', h, e);
      const k = key || (await docOf(h))?.key;
      if (k) await mark(k);
      else throw e; // A first download raced a local save: keep its change page available for the next run.
    });

    // ---- the folder: the one Glaze made (found by its tag, so a second device finds the first's), or a new one.
    const folderOf = async (st) => {
      let mine = st.folder || null;
      if (mine) {
        const f = await meta(mine);
        // In Drive's trash (the student's doing; one merged into another is followed instead): Sync stops and says so.
        if (!f.removed && f.trashed && f.appProperties?.glaze !== 'merged') throw new Fail('folder');
        if (f.removed) {
          // Gone for good: everything goes up again into a new one; nothing here goes to Trash for it.
          await forget();
          await setState({ folder: null, token: null });
          mine = null;
        }
      }
      // Another device's made at the same time: the one with the lowest id, its own put away in that one's Data.
      const id = await converge(D, { tag: 'root', name: NAME, mine, hide: (w) => converge(D, { parent: w, tag: 'data', name: 'Data' }) });
      if (id !== mine) await setState({ folder: id });
      return id;
    };

    // Everything, both sides: the first run, and again whenever the page token is lost.
    const full = async (st) => {
      const folder = await folderOf(st);
      const token = await D((c) => c.startToken());
      const dirt = (await S.get(DIRTY))[DIRTY] || {};
      const remote = new Map();
      let page = null;
      do {
        const r = await D((c) => c.find(`'${folder}' in parents and appProperties has { key='glaze' and value='doc' } and trashed=false`, { pageToken: page }));
        for (const f of r.files) if (HASH.test(f.appProperties?.key || '') && (!remote.has(f.appProperties.key) || f.id < remote.get(f.appProperties.key).id)) remote.set(f.appProperties.key, f);
        page = r.nextPageToken || null;
      } while (page);
      const seen = new Set(), waiting = new Set();
      for (const row of await env.papers.list()) {
        if (!syncable(row.key) || !KINDS.includes(row.kind || 'paper')) continue;
        const h = await hk(row.key);
        seen.add(h);
        const d = await docOf(h);
        const R = remote.get(h) || null;
        if (await one(row.key, h, { R: !d?.json || (R && R.id <= d.json) ? R : undefined, folder }) === 'pending') waiting.add(row.key);
      }
      for (const [h, R] of remote) if (!seen.has(h)) { seen.add(h); const d = await docOf(h); await one(null, h, { R: d?.json && R.id > d.json ? undefined : R, folder }); }
      for (const k of (await S.keys()).filter((x) => x.startsWith(DOC))) if (!seen.has(k.slice(DOC.length))) await one(null, k.slice(DOC.length), { folder });
      for (const [k, n] of Object.entries(dirt)) if (!waiting.has(k)) await unmark(k, n);
      if (more) await more.full(hooks(folder));
      await setState({ token });
    };
    // What changed in Drive since the token, a page at a time, each page's documents done before the token moves past it.
    const pull = async (st, folder) => {
      let token = st.token;
      for (;;) {
        let r;
        try { r = await D((c) => c.changes(token)); } catch (e) { if (e.why === 'bad' || e.why === 'missing') { await setState({ token: null }); return full(await state()); } throw e; }
        const docs = new Map(), at = (h) => (docs.has(h) ? docs.get(h) : docs.set(h, {}).get(h));
        for (const c of r.changes) {
          if (c?.changeType && c.changeType !== 'file') continue;
          const f = c?.file;
          if (c?.removed || !f) {
            const h = typeof c?.fileId === 'string' && (await S.get(FILE + c.fileId))[FILE + c.fileId];
            const d = h && await docOf(h);
            if (d?.json === c.fileId) at(h).R = { id: c.fileId, removed: true };
            else if (d?.file === c.fileId) at(h).E = { id: c.fileId, removed: true };
            continue;
          }
          const h = f.appProperties?.key, role = f.appProperties?.glaze;
          if (!HASH.test(h || '') || !['doc', 'file'].includes(role)) continue;
          if (role === 'doc' && f.mimeType === JSON_TYPE) {
            const x = at(h), out = (g) => Array.isArray(g?.parents) && !g.parents.includes(folder);
            // Two copies in one page: the lower id in the folder; one of this device's own moved out of it, when nothing else came.
            if (!out(f)) { if (!x.R || x.R.id === f.id || out(x.R) || (!f.trashed && !x.R.removed && f.id < x.R.id)) x.R = f; }
            else if (!x.R && (await S.get(FILE + f.id))[FILE + f.id] === h) x.R = f;
          }
          else if (role === 'file') at(h).E = f;
        }
        for (const [h, x] of docs) {
          const d = await docOf(h);
          if (!d && !x.R) continue;
          await one(null, h, { ...x, folder });
        }
        if (more) await more.changes(r.changes, hooks(folder));
        token = r.nextPageToken || r.newStartPageToken;
        await setState({ token });
        if (!r.nextPageToken) return;
      }
    };
    // The documents saved here since their last push.
    const sweep = async (folder) => {
      for (const [key, n] of Object.entries((await S.get(DIRTY))[DIRTY] || {})) {
        if (syncable(key) && await one(key, await hk(key), { folder }) === 'pending') continue; // still marked till it lands
        await unmark(key, n);
      }
    };

    const hooks = (folder) => ({ D, folder, state: setState, up, down, move: { get: moveOf, drop: dropMove } });
    // ---- runs. o.full: everything (turning it on); o.push: only what was saved here.
    const runNow = async (o = {}) => {
      runStop = stopped;
      let st = await state();
      if (!st.on) return { ok: false, why: 'off' };
      const who = await Promise.resolve().then(env.account).catch(() => null);
      if (!who) { await setState({ problem: 'connect', busy: 0 }); return { ok: false, why: 'connect' }; }
      if (st.account && st.account !== who) {
        await forget();
        await S.set({ [STATE]: { on: false, off: true, problem: 'account' } });
        return { ok: false, why: 'account' };
      }
      // The wait holds off saves' runs; a start, Documents or Writer opening, or coming back online tries at once after a
      // run that only failed to reach Drive.
      if (!o.full && st.wait && now() < st.wait && !(o.poke && st.problem === 'network')) return { ok: false, why: 'later' };
      if (!st.account) st = await setState({ account: who });
      runAccount = who;
      client = env.drive(active);
      await setState({ busy: now() });
      try {
        if (o.full || !st.folder || !st.token) await full(st);
        else {
          const folder = await folderOf(st);
          if (!o.push) await pull(await state(), folder);
        }
        await sweep((await state()).folder);
        await tidy((await state()).folder);
        if (more) await more.sweep(hooks((await state()).folder));
        await transfers((await state()).folder);
        await setState({ last: now(), problem: null, fails: 0, wait: 0, busy: 0 });
        return { ok: true };
      } catch (e) {
        const why = whyOf(e), was = await state();
        if (why === 'off') { await setState({ busy: 0 }); return { ok: false, why }; }
        if (why === 'stale') console.warn('Sync to Google Drive:', e);
        const fails = (was.fails || 0) + 1;
        await setState({ problem: why, busy: 0, fails, wait: now() + Math.min(WAIT.most, WAIT.run * 2 ** (fails - 1)) });
        return { ok: false, why };
      } finally { client = null; }
    };
    const run = (o = {}) => held('run', () => runNow(o));

    // Settings' switch. On: bound to the account connected now, and a full run. → that run's answer, or { ok: true } off.
    let switching = 0;
    const set = async (on) => {
      const request = ++switching;
      if (!on) { stopped++; await setState({ on: false, off: true, busy: 0 }); cancel?.(); cancel = null; return { ok: true }; }
      const who = await Promise.resolve().then(env.account).catch(() => null);
      if (request !== switching) return { ok: false, why: 'off' };
      if (!who) return { ok: false, why: 'connect' };
      // Enabling, including a deliberate account switch, waits for the previous run before replacing its bookkeeping.
      return held('run', async () => {
        if (request !== switching) return { ok: false, why: 'off' };
        const st = await state(), changed = st.account && st.account !== who;
        if (changed) await forget();
        await setState({ ...(changed && { folder: null, token: null, data: null, backups: null, snap: null, snapSkip: null, last: null }),
          on: true, off: false, account: who, problem: null, wait: 0, fails: 0 }, () => request === switching);
        if (request !== switching) return { ok: false, why: 'off' };
        return runNow({ full: true });
      });
    };
    // A document written here (the worker's storage listener): pushed once saving pauses.
    let cancel = null;
    const touched = async (key) => {
      if (!syncable(key) || !(await state()).on) return;
      await mark(key);
      await nudge();
    };
    // Something else Glaze keeps changed (background/drive-store.js stamps it): a push once saving pauses.
    const nudge = async () => {
      if (!(await state()).on) return;
      cancel?.();
      cancel = timer(() => { cancel = null; return run({ push: true }); }, WAIT.push);
    };
    // Documents or Writer opened, the browser started or came online: a run, at most every WAIT.pull.
    let poked = 0;
    const poke = async () => {
      if (now() - poked < WAIT.pull || !(await state()).on) return null;
      poked = now();
      return run({ poke: true });
    };
    // busy: a run under way (one a stopped worker left counts for two minutes at most).
    const status = async () => { const s = await state(); return { on: !!s.on, last: s.last || null, problem: s.problem || null, busy: !!s.busy && now() - s.busy < 120e3 }; };
    return { set, run, touched, nudge, poke, status };
  };

  return { STATE, DOC, FILE, DIRTY, MOVES, WAIT, KINDS, BIG, Fail, canon, strip, body, converge, create };
})();
if (typeof module !== 'undefined') module.exports = GZ_DRIVE_SYNC;
