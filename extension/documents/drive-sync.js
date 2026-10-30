// Sync Documents: Glaze's documents kept in step with a folder named Glaze in the student's own Google Drive, in the worker
// (background/background.js), with drive.file only (documents/drive.js; Glaze sees only the files it made). A setting, off by default and
// offered only while Drive is connected (settings/options.js); its state is this device's: storage.local driveSync { on, account,
// folder, token (the Changes API's page token), last, problem, wait, fails, busy }, a record per document
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
//     of its own named "<title> (Drive copy)"; then this device's is pushed.
//   A .docx or .xlsx edited outside Glaze is never overwritten: it stays in Drive as it is (glaze: 'kept') and Glaze writes
//     a new file beside it. A .pdf or .pptx edited outside Glaze is the document's new content, as a change in Drive.
//   Trash: a document trashed or restored in Glaze moves its two files into or out of Drive's trash; a file trashed or
//     restored in Drive moves the document into or out of Glaze's Trash (both changed: restored wins). A document deleted
//     for good here (Delete forever, Trash's 30 days, Clear) has its files trashed in Drive; a file deleted for good in Drive
//     (a 404, or removed from the changes) puts the document in Trash here. Nothing is ever deleted for good by Glaze.
// When: turning it on uploads every document and takes Drive's (a full pass, the page token taken first); then each run
// reads the changes since its token and pushes the documents saved since (driveSyncDirty, marked by the worker as they are
// written), each push 5 s after the last save (WAIT.push). Runs start when it is turned on, when the browser starts or
// comes back online, and when Documents or Writer opens (at most every 30 s). One run at a time and one document at a
// time (Web Locks where there are, else a queue). Drive's busy answers (rate limits, 429, 5xx) are retried 5 times with
// growing waits in a run, then the run stops and the next waits a minute, doubling to an hour; Glaze's own requests never
// ask the student to sign in. The account: bound when turned on; another account connected stops Sync, forgets this
// account's state and touches nothing on either side (documents/drive.js stops a client the moment its account changes).
// Nothing goes anywhere but Google Drive.
// Classic script for the worker; module.exports for node.
var GZ_DRIVE_SYNC = globalThis.GZ_DRIVE_SYNC || (() => {
  const STATE = 'driveSync', DOC = 'driveSyncDoc:', FILE = 'driveSyncFile:', DIRTY = 'driveSyncDirty';
  const FOLDER = 'application/vnd.google-apps.folder', JSON_TYPE = 'application/json', NAME = 'Glaze';
  const KINDS = ['paper', 'sheet', 'pdf', 'slides'], FILES = ['pdf', 'slides'];
  const EXT = { paper: '.docx', sheet: '.xlsx', pdf: '.pdf', slides: '.pptx' };
  // What a record carries that is this device's own, never synced or compared.
  const STRIP = ['key', 'revision', 'titled', 'edited', 'lastVersion', 'parts', 'partDrops', 'drive', 'trashed', 'updated'];
  const WAIT = { push: 5000, pull: 30e3, retry: [1000, 2000, 4000, 8000, 16000], run: 60e3, most: 3600e3 };
  const MAX_JSON = 64e6;
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

  // env: { drive() (a documents/drive.js client, interactive: false, bound to the account as it is made), account() (the connected
  // account's email, background/google.js account), store (storage.local: get, set, remove, keys), papers (writer/writer-papers.js in
  // the worker's queue: get, list, save, trash, untrash, keep), parts(key, record) (a spreadsheet's stored parts, each
  // without its rev), files { has(hash), put(bytes, type) → ref } (documents/doc-files.js), exportOf(key, record, parts) →
  // { name, mime, bytes } or null, pack(record, parts) → a spreadsheet version's gz, hash(text) → SHA-256 hex,
  // copyName(title), now, sleep, random, locks (navigator.locks or null), timer(fn, ms) → cancel }
  const create = (env) => {
    const now = env.now || Date.now, S = env.store;
    const sleep = env.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
    const random = env.random || Math.random;
    const timer = env.timer || ((fn, ms) => { const t = setTimeout(fn, ms); return () => clearTimeout(t); });
    const locks = env.locks === undefined ? globalThis.navigator?.locks || null : env.locks;
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
    const setState = (patch) => held('state', async () => { const next = { ...(await state()), ...patch }; await S.set({ [STATE]: next }); return next; });
    const docOf = async (h) => (await S.get(DOC + h))[DOC + h] || null;
    const putDoc = async (h, d, was) => {
      const ids = [d.json, d.file].filter(Boolean), gone = [was?.json, was?.file].filter((id) => id && !ids.includes(id));
      await S.set({ [DOC + h]: d, ...Object.fromEntries(ids.map((id) => [FILE + id, h])) });
      if (gone.length) await S.remove(gone.map((id) => FILE + id));
      return d;
    };
    const dropDoc = (h, was) => S.remove([DOC + h, ...[was?.json, was?.file].filter(Boolean).map((id) => FILE + id)]);
    const forget = async () => {
      const keys = (await S.keys()).filter((k) => k.startsWith(DOC) || k.startsWith(FILE) || k === DIRTY);
      if (keys.length) await S.remove(keys);
    };
    const hk = async (key) => (await env.hash(key)).slice(0, 32);
    // The documents saved since they were last pushed: key → a count, so a save during a push keeps its mark.
    const mark = (key) => held('dirty', async () => { const m = (await S.get(DIRTY))[DIRTY] || {}; m[key] = (m[key] || 0) + 1; await S.set({ [DIRTY]: m }); });
    const unmark = (key, n) => held('dirty', async () => { const m = (await S.get(DIRTY))[DIRTY] || {}; if (m[key] === n) { delete m[key]; await S.set({ [DIRTY]: m }); } });

    // ---- Drive, through this run's client: busy answers waited out and asked again, up to WAIT.retry's tries.
    let client = null;
    const D = async (fn) => {
      for (let i = 0; ; i++) {
        try { return await fn(client); } catch (e) {
          if (e?.why !== 'busy' || i >= WAIT.retry.length) throw e;
          await sleep(Math.round(WAIT.retry[i] * (1 + random() / 4)));
        }
      }
    };
    const meta = async (id) => { try { return await D((c) => c.file(id)); } catch (e) { if (e.why === 'missing') return { id, removed: true }; throw e; } };
    const trashTo = async (id, on) => { if (!id) return; try { await D((c) => c.patch(id, { trashed: on })); } catch (e) { if (e.why !== 'missing') throw e; } };

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
    const fetchCopy = async (R, h, key) => {
      const sum = R.appProperties?.sum;
      if (!SUM.test(sum || '')) throw new Fail('bad');
      let j;
      try { j = JSON.parse(new TextDecoder().decode(await D((c) => c.media(R.id, MAX_JSON)))); } catch (e) { throw e instanceof Fail ? e : new Fail('bad'); }
      if (j?.glaze !== 'document' || j.v !== 1 || !syncable(j.key) || (key && j.key !== key) || (await hk(j.key)) !== h || !KINDS.includes(j.kind)
        || !j.record || typeof j.record !== 'object' || Array.isArray(j.record) || kindOf(j.record) !== j.kind) throw new Fail('bad');
      if (j.kind === 'sheet' && (!j.parts || typeof j.parts !== 'object' || !Object.keys(j.parts).every((n) => PART.test(n) && Array.isArray(j.parts[n]?.rows)))) throw new Fail('bad');
      const record = { ...strip(j.record), kind: j.kind };
      if (FILES.includes(j.kind)) await bring(record.file, j.file);
      return { key: j.key, kind: j.kind, record, parts: j.kind === 'sheet' ? j.parts : null, file: typeof j.file === 'string' ? j.file : null, fileRev: typeof j.fileRev === 'string' ? j.fileRev : null, sum };
    };
    const bring = async (ref, id) => {
      if (!P().isRef(ref)) throw new Fail('bad');
      if (await env.files.has(ref.hash)) return;
      if (typeof id !== 'string') throw new Fail('bad');
      const bytes = await D((c) => c.media(id, 50e6));
      const got = await env.files.put(bytes, ref.type || '');
      // The file moved on since the copy was written (its next copy is on its way): the next run takes both.
      if (got.hash !== ref.hash) throw new Fail('stale');
    };
    // Drive's side written here as the document's current state. → the record and its parts as written.
    const take = async (key, l, got) => {
      const { paper } = await env.papers.save(key, got.record, { reason: 'auto', base: l ? l.rec.revision || 0 : 0, rename: true,
        ...(got.kind === 'sheet' && { parts: got.parts, drop: Object.keys(l?.rec.parts || {}).filter((n) => !Object.hasOwn(got.parts, n)), changed: true }) });
      return { rec: paper, parts: got.kind === 'sheet' ? got.parts : null };
    };
    // Drive's side of a conflict kept beside this device's: a version, or a PDF's own document.
    const keepOther = async (key, l, got) => {
      if (got.kind === 'pdf') {
        const k = P().newKey(), title = env.copyName(String(got.record.title || l?.rec.title || 'PDF'));
        await env.papers.save(k, { ...got.record, title, named: true }, { reason: 'auto' });
        await mark(k);
      } else if (got.kind === 'sheet') await env.papers.keep(key, { kind: 'sheet', gz: await env.pack(got.record, got.parts), cells: got.record.cells });
      else await env.papers.keep(key, got.record);
    };

    // This device's document up: its kind's file (a new one when it has none, or the one it had is gone), then its copy.
    const push = async (key, h, l, d, folder) => {
      const kind = kindOf(l.rec), b = body(key, l.rec, l.parts), sum = await env.hash(canon(b));
      let ex = null;
      try { ex = await env.exportOf(key, l.rec, l.parts); } catch (e) { console.warn('Sync Documents: no file for', kind, e); }
      const base = (ex?.name || `${safe(l.rec.title) || 'Untitled'}${EXT[kind]}`).replace(/\.[^.]+$/, '');
      let file = d?.file || null, fh = d?.fh || null;
      const up = async (id, meta, mime, bytes) => {
        if (id) { try { return await D((c) => c.put({ id, meta, mime, bytes })); } catch (e) { if (e.why !== 'missing') throw e; } }
        return D((c) => c.put({ meta: { ...meta, mimeType: mime, parents: [folder] }, mime, bytes }));
      };
      if (ex) {
        const r = await up(file, { name: ex.name, appProperties: { glaze: 'file', key: h, sum } }, ex.mime, ex.bytes);
        file = r.id; fh = r.headRevisionId || null;
      }
      const json = new TextEncoder().encode(JSON.stringify({ glaze: 'document', v: 1, ...b, file, fileRev: fh }));
      const r = await up(d?.json || null, { name: `${base}.glaze.json`, appProperties: { glaze: 'doc', key: h, sum, rev: String(l.rec.revision || 0) } }, JSON_TYPE, json);
      return putDoc(h, { key, h, kind, json: r.id, file, fh, fsum: sum, rsum: sum, lsum: sum, rev: l.rec.revision || 0, trashed: false }, d);
    };
    const agreed = async (key, h, R, got, l, d) => putDoc(h, { key, h, kind: got.kind, json: R.id, file: got.file, fh: got.fileRev, fsum: got.sum, rsum: got.sum,
      lsum: await sumOf(key, l), rev: l.rec.revision || 0, trashed: false }, d);

    // One document, both sides. R: its JSON copy's metadata from Drive (undefined: not known yet; null: Drive has none;
    // { removed }: deleted for good, or out of reach); E: its kind's file's, when a change named it.
    const sync = async (key, h, { R, E, folder }) => {
      if (!(await state()).on) throw new Fail('off');
      const d = await docOf(h);
      key ||= d?.key || null;
      if (key && !syncable(key)) return;
      let l = key ? await local(key) : null;
      const lt = !!l && P().trashed(l.rec);
      if (d && R?.id && R.id !== d.json && !R.removed) R = undefined; // another device's copy of the same document: not this one's
      if (d && E && E.id !== d.file) E = undefined;
      if (R === undefined) R = d?.json ? await meta(d.json) : d ? null : !lt && l ? await lookup(h, folder) : null;

      if (!d) {
        if (!R || R.removed || R.trashed || lt) { if (l && !lt && !R) await push(key, h, l, null, folder); return; }
        const got = await fetchCopy(R, h, key);
        if (!l) { const now2 = await take(got.key, null, got); await agreed(got.key, h, R, got, now2, null); return; }
        if ((await sumOf(key, l)) !== got.sum) { await keepOther(key, l, got); return push(key, h, await local(key), { json: R.id, file: got.file, fh: got.fileRev, fsum: got.sum }, folder); }
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
          const bytes = await D((c) => c.media(d.file, 50e6)), ref = await env.files.put(bytes, E.mimeType || '');
          const base = rdirty ? (await fetchCopy(R, h, key)).record : strip(l.rec);
          const got = { kind: kindOf(l.rec), record: { ...base, kind: kindOf(l.rec), file: { hash: ref.hash, size: ref.size, type: ref.type }, size: ref.size }, parts: null, file: d.file, fileRev: E.headRevisionId, sum: null };
          if (ldirty) await keepOther(key, l, got);
          else l = await take(key, l, got);
          return push(key, h, l, { ...d, fh: E.headRevisionId }, folder);
        }
        // A .docx or .xlsx edited outside Glaze stays as it is; the document gets a file of its own again.
        await D((c) => c.patch(d.file, { appProperties: { glaze: 'kept', sum: null } }));
        Object.assign(d, { file: null, fh: null, fsum: null });
        force = true;
      }
      if (rdirty) {
        const got = await fetchCopy(R, h, key);
        if (ldirty) { await keepOther(key, l, got); return push(key, h, await local(key), d, folder); }
        const now2 = await take(key, l, got);
        if (force) return push(key, h, now2, { ...d, json: R.id }, folder);
        await agreed(key, h, R, got, now2, d);
        return;
      }
      if (ldirty || force) await push(key, h, l, d, folder);
    };
    // The JSON copy Drive holds for h, if another device made one first (oldest id first).
    const lookup = async (h, folder) => {
      const r = await D((c) => c.find(`'${folder}' in parents and appProperties has { key='key' and value='${h}' } and appProperties has { key='glaze' and value='doc' } and trashed=false`, { pageSize: 10 }));
      return r.files.filter((f) => f.appProperties?.key === h).sort((a, b) => (a.id < b.id ? -1 : 1))[0] || null;
    };
    // A document Drive's copy of can't be read is passed over; one that met a write here or a file still moving
    // (stale, or the paper store's refusal) is marked to be tried again next run. Drive's own trouble stops the run.
    const one = (key, h, hint) => held(`doc:${h}`, () => sync(key, h, hint)).catch(async (e) => {
      if (SKIP.has(e?.why)) { console.warn('Sync Documents: passed over', h, e.why); return; }
      if (e instanceof Fail ? e.why !== 'stale' : typeof e?.why === 'string') throw e;
      console.warn('Sync Documents: again next run', h, e);
      const k = key || (await docOf(h))?.key;
      if (k) await mark(k);
    });

    // ---- the folder: the one Glaze made (found by its tag, so a second device finds the first's), or a new one.
    const folderOf = async (st) => {
      if (st.folder) {
        const f = await meta(st.folder);
        if (!f.removed && f.trashed) throw new Fail('folder');
        if (!f.removed) return st.folder;
        // Gone for good: everything goes up again into a new one; nothing here goes to Trash for it.
        await forget();
        await setState({ folder: null, token: null });
      }
      const r = await D((c) => c.find(`mimeType='${FOLDER}' and name='${NAME}' and appProperties has { key='glaze' and value='root' } and trashed=false`, { pageSize: 10 }));
      const f = r.files.filter((x) => x.mimeType === FOLDER && !x.trashed).sort((a, b) => (a.id < b.id ? -1 : 1))[0]
        || await D((c) => c.folder({ name: NAME, mimeType: FOLDER, appProperties: { glaze: 'root' } }));
      await setState({ folder: f.id });
      return f.id;
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
      const seen = new Set();
      for (const row of await env.papers.list()) {
        if (!syncable(row.key) || !KINDS.includes(row.kind || 'paper')) continue;
        const h = await hk(row.key);
        seen.add(h);
        const d = await docOf(h);
        const R = remote.get(h) || null;
        await one(row.key, h, { R: !d?.json ? R : R?.id === d.json ? R : undefined, folder });
      }
      for (const [h, R] of remote) if (!seen.has(h)) { seen.add(h); const d = await docOf(h); await one(null, h, { R: d?.json && d.json !== R.id ? undefined : R, folder }); }
      for (const k of (await S.keys()).filter((x) => x.startsWith(DOC))) if (!seen.has(k.slice(DOC.length))) await one(null, k.slice(DOC.length), { folder });
      for (const [k, n] of Object.entries(dirt)) await unmark(k, n);
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
          if (role === 'doc' && (f.parents || []).includes(folder) && f.mimeType === JSON_TYPE) at(h).R = f;
          else if (role === 'file') at(h).E = f;
        }
        for (const [h, x] of docs) {
          const d = await docOf(h);
          if (!d && !x.R) continue;
          await one(null, h, { ...x, folder });
        }
        token = r.nextPageToken || r.newStartPageToken;
        await setState({ token });
        if (!r.nextPageToken) return;
      }
    };
    // The documents saved here since their last push.
    const sweep = async (folder) => {
      for (const [key, n] of Object.entries((await S.get(DIRTY))[DIRTY] || {})) {
        if (syncable(key)) await one(key, await hk(key), { folder });
        await unmark(key, n);
      }
    };

    // ---- runs. o.full: everything (turning it on); o.push: only what was saved here.
    const run = (o = {}) => held('run', async () => {
      let st = await state();
      if (!st.on) return { ok: false, why: 'off' };
      const who = await Promise.resolve().then(env.account).catch(() => null);
      if (!who) { await setState({ problem: 'connect', busy: 0 }); return { ok: false, why: 'connect' }; }
      if (st.account && st.account !== who) {
        await forget();
        await S.set({ [STATE]: { on: false } });
        return { ok: false, why: 'account' };
      }
      if (!o.full && st.wait && now() < st.wait) return { ok: false, why: 'later' };
      if (!st.account) st = await setState({ account: who });
      client = env.drive();
      await setState({ busy: now() });
      try {
        if (o.full || !st.folder || !st.token) await full(st);
        else {
          const folder = await folderOf(st);
          if (!o.push) await pull(await state(), folder);
        }
        await sweep((await state()).folder);
        await setState({ last: now(), problem: null, fails: 0, wait: 0, busy: 0 });
        return { ok: true };
      } catch (e) {
        const why = whyOf(e), was = await state();
        if (why === 'off') { await setState({ busy: 0 }); return { ok: false, why }; }
        if (why === 'stale') console.warn('Sync Documents:', e);
        const fails = (was.fails || 0) + 1;
        await setState({ problem: why, busy: 0, fails, wait: now() + Math.min(WAIT.most, WAIT.run * 2 ** (fails - 1)) });
        return { ok: false, why };
      } finally { client = null; }
    });

    // Settings' switch. On: bound to the account connected now, and a full run. → that run's answer, or { ok: true } off.
    const set = async (on) => {
      if (!on) { await setState({ on: false, busy: 0 }); cancel?.(); cancel = null; return { ok: true }; }
      const who = await Promise.resolve().then(env.account).catch(() => null);
      if (!who) return { ok: false, why: 'connect' };
      const st = await state();
      if (st.account && st.account !== who) { await forget(); await S.set({ [STATE]: { on: false } }); }
      await setState({ on: true, account: who, problem: null, wait: 0, fails: 0 });
      return run({ full: true });
    };
    // A document written here (the worker's storage listener): pushed once saving pauses.
    let cancel = null;
    const touched = async (key) => {
      if (!syncable(key) || !(await state()).on) return;
      await mark(key);
      cancel?.();
      cancel = timer(() => { cancel = null; return run({ push: true }); }, WAIT.push);
    };
    // Documents or Writer opened, the browser started or came online: a run, at most every WAIT.pull.
    let poked = 0;
    const poke = async () => {
      if (now() - poked < WAIT.pull || !(await state()).on) return null;
      poked = now();
      return run();
    };
    // busy: a run under way (one a stopped worker left counts for two minutes at most).
    const status = async () => { const s = await state(); return { on: !!s.on, last: s.last || null, problem: s.problem || null, busy: !!s.busy && now() - s.busy < 120e3 }; };
    return { set, run, touched, poke, status };
  };

  return { STATE, DOC, FILE, DIRTY, WAIT, KINDS, Fail, canon, strip, body, create };
})();
if (typeof module !== 'undefined') module.exports = GZ_DRIVE_SYNC;
