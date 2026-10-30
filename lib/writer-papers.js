// Glaze Writer's documents: standalone doc:<uuid> keys and one per assignment, on this device, with versions and the
// student's own format presets. In chrome.storage.local (the manifest's unlimitedStorage lifts its
// quota), which the editor frame (an extension page inside the LMS) and papers.html (a tab of its own) both see as the
// same store, where a framed page's IndexedDB can be partitioned by the site around it. A version is taken on submit
// ('sending', the paper as its .docx is built, marked 'submit' once Ultra's Submit is clicked: submitted()), before an
// import or a restore, before a big edit, and every 10 minutes of writing; versions are capped by count and size,
// keeping the last submitted one. The Documents home's Delete puts a paper in Trash (trashed: when, in ms, on the record and
// its index row) with its versions; Undo or Restore takes it out, and 30 days on it goes for good (purge). A spreadsheet
// (sheet-data.js) keeps its cells in parts beside its record (writerSheet:<key>:<sheet>:<band>), each written in the record's
// own set() and stamped with its revision, and its versions packed (gz) by the page, up to CAP.packed bytes of them.
// Classic script; module.exports for node.
var GZ_WRITER_PAPERS = globalThis.GZ_WRITER_PAPERS || (() => {
  const INDEX = 'writerPapers', PAPER = 'writerPaper:', VERSIONS = 'writerVersions:', PRESETS = 'writerPresets:', PART = 'writerSheet:';
  const CAP = { versions: 40, bytes: 4e6, packed: 16e6, every: 10 * 60e3, words: 100, share: 0.15, presets: 20, trash: 30 * 864e5 };
  // A part's name: a sheet's id and a band of its rows; a part's key is under its record's.
  const PART_NAME = /^\d{1,9}:\d{1,5}$/;
  const partsOf = (k, paper) => [...new Set([...Object.keys(paper?.parts || {}), ...(paper?.partDrops || [])])].filter((n) => PART_NAME.test(n)).map((n) => `${PART}${k}:${n}`);
  // The card's text a spreadsheet's index row carries (sheet-data.js glance): 4 rows of 6 short strings.
  const glance = (g) => Array.isArray(g) && g.length === 4 && g.every((row) => Array.isArray(row) && row.length === 6 && row.every((x) => typeof x === 'string' && x.length <= 40));
  const FILE_FIELDS = ['file', 'size', 'pages', 'thumb', 'ext', 'slides', 'text'];
  const ID = /^_\d+_\d+$/, HOST = /^[a-z0-9.-]{1,253}(:\d{1,5})?$/i;
  // A paper's key, or null unless every part is real: the school's host, and Ultra's ids for the student, course and
  // assignment.
  const keyOf = (k = {}) => (HOST.test(k.school || '') && ID.test(k.user || '') && ID.test(k.course || '') && ID.test(k.content || '') ? `${k.school.toLowerCase()}|${k.user}|${k.course}|${k.content}` : null);
  // A standalone document's key (the Documents home's New and Make a copy), tied to no assignment.
  const LOCAL = /^doc:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  const local = (k) => typeof k === 'string' && LOCAL.test(k);
  // Cite's local store, plus an assignment's own parts. Documents uses the local store when a legacy record lacks its
  // assignment identity, so an assignment can have used both. Each belongs to this exact paper key.
  const sourcesOf = (k) => [`writer:sources:local|local|papers|${encodeURIComponent(k)}`,
    ...(/^[^|]+(\|[^|]+){3}$/.test(k) ? [`writer:sources:${k.split('|').map(encodeURIComponent).join('|')}`] : [])];
  const newKey = () => `doc:${crypto.randomUUID()}`;
  // Every key a paper is kept under: an assignment's, a standalone document's, or the stand-in for one whose key never came
  // (writer-paper.js recovery:).
  const STORED = /^(?:[a-z0-9.-]{1,253}(?::\d{1,5})?\|_\d+_\d+\|_\d+_\d+\|_\d+_\d+|recovery:[a-z0-9-]{1,64})$/i;
  const valid = (k) => local(k) || (typeof k === 'string' && STORED.test(k));
  // A copy as a standalone document: the document and its look only, never the assignment it came from. title: the
  // caller's, in the student's language.
  // A PDF (pdf-kind.js) is its file: its bytes, their size and page count, and its first page's picture.
  const copyOf = (rec, title, t = Date.now()) => ({ key: newKey(), kind: rec.kind || 'paper', ...(rec.doc !== undefined && { doc: structuredClone(rec.doc) }),
    ...(rec.format !== undefined && { format: rec.format }), ...Object.fromEntries(['file', 'size', 'pages', 'thumb'].filter((f) => rec[f] !== undefined).map((f) => [f, rec[f]])),
    keep: rec.keep === true, title, named: true, created: t, updated: t, revision: 0 });
  // A standalone document brought into an assignment's paper (Writer's Open from Documents): what that paper's 'import'
  // save takes from it, its document, format and import choice, never its title (the assignment's stays Ultra's), and an
  // AI outline it holds, bound to the paper. target: the paper's key. → null without a document.
  const fromDocument = (target, source) => (source?.doc ? { doc: structuredClone(source.doc), words: measure(source.doc).words,
    ...(source.format !== undefined && { format: structuredClone(source.format) }), keep: source.keep === true,
    outline: source.outline && typeof source.outline === 'object' ? { ...structuredClone(source.outline), scope: target } : null } : null);
  // A rename made elsewhere (the Documents home, another tab), for an open editor: the stored record, newer than the one
  // the editor last read or wrote, names it differently. → { title, named, revision } (revision only where the document
  // is the one the editor knows, so its next save builds on the rename instead of keeping a conflict version), or null.
  // Unnamed on both sides is no rename: each editor derives its own title.
  const renamed = (known, stored) => {
    if (!stored || (stored.revision || 0) <= (known?.revision || 0)) return null;
    const named = stored.named === true, title = named ? String(stored.title || '') : '';
    if (named === (known?.named === true) && (!named || title === String(known?.title || ''))) return null;
    const same = known?.doc !== undefined && JSON.stringify(stored.doc) === JSON.stringify(known.doc)
      && JSON.stringify(stored.format) === JSON.stringify(known.format) && (stored.keep === true) === (known.keep === true);
    return { title, named, ...(same ? { revision: stored.revision } : {}) };
  };
  const scopeOf = (k = {}) => (HOST.test(k.school || '') && ID.test(k.user || '') ? `${k.school.toLowerCase()}|${k.user}` : null);
  // A document's text size from its JSON: characters and words, a hard break parting words as in the editor's count.
  const measure = (doc) => {
    let text = '';
    const walk = (n) => { if (typeof n?.text === 'string') text += n.text; else if (n?.type === 'hard_break') text += '\n'; else if (Array.isArray(n?.content)) { for (const c of n.content) walk(c); text += ' '; } };
    walk(doc);
    return { chars: text.replace(/\s+/g, ' ').trim().length, words: text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length };
  };
  const bytes = (v) => new TextEncoder().encode(JSON.stringify(v)).length;
  // Whether a record or an index row is in Trash.
  const trashed = (r) => Number.isFinite(r?.trashed);
  const queues = new WeakMap();

  // How many versions a paper keeps: Settings → Writer → Versions kept (storage.sync writer.versions, cleaned by
  // defaults.js) where the worker runs this, else CAP.versions.
  const keptVersions = async () => {
    try {
      const sync = globalThis.chrome?.storage?.sync;
      if (!sync || typeof GZ_SANITIZE !== 'function') return CAP.versions;
      return GZ_SANITIZE({ writer: (await sync.get('writer'))?.writer }).writer.versions;
    } catch { return CAP.versions; }
  };
  // store: chrome.storage.local's get/set/remove (promises); now: the clock (tests pin it); o.versions: the count kept
  // (a function, tests pin it); o.busy: the worker's submit fence, checked before removing a paper or purging it.
  const open = (store, now = () => Date.now(), o = {}) => {
    if (!store && globalThis.chrome?.runtime?.sendMessage) {
      // One write at a time per paper from this editor, each carrying the revision the one before it saved.
      const local = open(chrome.storage.local, now), seen = new Map(), turns = new Map();
      const turn = (k, fn) => { const p = (turns.get(k) || Promise.resolve()).then(fn, fn); turns.set(k, p.catch(() => {})); return p; };
      const send = async (op, args) => {
        let timer;
        try {
          const reply = chrome.runtime.sendMessage({ type: 'glaze:writerPapers', op, args });
          // A dead worker must not hold this editor's entire save queue forever. A late answer to an expired save cannot
          // change its revision; the student can retry against the revision last acknowledged, preserving conflicts.
          const r = await (op === 'save' ? Promise.race([reply, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('paper storage unavailable')), 60000); })]) : reply);
          if (!r?.ok) throw new Error(r?.error || 'paper storage unavailable');
          if (r.value?.paper) seen.set(args[0], r.value.paper.revision);
          return r.value;
        } finally { clearTimeout(timer); }
      };
      const { submitted: _, merge: __, ...reads } = local; // submit dispatch and backup replay are worker-only
      return { ...reads, get: async (k) => { const p = await local.get(k); seen.set(k, p?.revision || 0); return p; },
        save: (k, patch, options = {}) => turn(k, () => send('save', [k, patch, { ...options, base: options.base ?? seen.get(k) }])),
        restore: (k, id) => turn(k, () => send('restore', [k, id])), remove: (k) => turn(k, () => send('remove', [k])),
        savePreset: (scope, p) => send('savePreset', [scope, p]), removePreset: (scope, id) => send('removePreset', [scope, id]),
        trash: (k) => turn(k, () => send('trash', [k])), untrash: (k, options) => turn(k, () => send('untrash', options ? [k, options] : [k])), purge: () => send('purge', []) };
    }
    store ||= globalThis.chrome?.storage?.local;
    const get = async (k) => (await store.get(k))[k];
    // The worker owns browser writes, including the index shared by every paper.
    const seen = new Map();
    const serial = (_k, fn) => { const p = (queues.get(store) || Promise.resolve()).then(fn, fn); queues.set(store, p.catch(() => {})); return p; };

    const versionsOf = async (k) => (Array.isArray(await get(VERSIONS + k)) ? await get(VERSIONS + k) : []);
    // Newest first, within the caps; the newest submitted version always stays.
    // limit: the bytes a record's versions may hold (a spreadsheet's packed ones, CAP.packed).
    const cap = async (list, limit = CAP.bytes) => {
      const most = await (o.versions || keptVersions)();
      const keep = [...list].sort((a, b) => b.at - a.at);
      const submitted = keep.find((v) => v.reason === 'submit');
      let total = keep.reduce((n, v) => n + v.bytes, 0);
      for (let i = keep.length - 1; i >= 0 && (keep.length > most || total > limit); i--) {
        if (keep[i] === submitted || i === 0) continue;
        total -= keep[i].bytes;
        keep.splice(i, 1);
      }
      return keep;
    };
    const snapshot = (paper, reason, at) => {
      const doc = paper.doc, m = measure(doc);
      const file = paper.kind && paper.kind !== 'paper' ? Object.fromEntries(FILE_FIELDS.filter((f) => paper[f] !== undefined).map((f) => [f, paper[f]])) : {};
      return { kind: paper.kind || 'paper', format: paper.format, keep: paper.keep === true, outline: paper.outline || null, id: `${at.toString(36)}-${Math.random().toString(36).slice(2, 8)}`, at, reason, words: paper.file ? paper.words || 0 : m.words,
        bytes: bytes(doc) + (paper.file ? bytes(file) : 0), doc, ...file };
    };
    const addVersion = async (k, v) => { const list = await cap([v, ...(await versionsOf(k))]); await store.set({ [VERSIONS + k]: list }); return v; };
    const index = async (paper) => {
      const list = (await get(INDEX)) || [];
      const row = { key: paper.key, kind: paper.kind || 'paper', named: paper.named === true, title: paper.title || '', course: paper.courseName || '', url: paper.url || '', words: paper.words || 0, format: paper.format, updated: paper.updated, submitted: paper.submitted || null,
        ...(trashed(paper) && { trashed: paper.trashed }), ...(glance(paper.grid) && { grid: paper.grid }) };
      return [row, ...list.filter((r) => r.key !== paper.key)].slice(0, 2000);
    };

    // Saves the paper under k, merging patch into what's stored; a record written before kinds is a paper, and its title
    // the assignment's until the student names it (named). reason: 'auto' (the default: autosave), 'sending' or
    // 'submit' (the paper itself kept), 'import' or 'restore' (the doc before it is kept), 'format', 'view' (the paper as
    // the full writer left it, before the compact box writes it into Blackboard's). → { paper, version }.
    const save = (k, patch = {}, { reason = 'auto', base = seen.get(k), rename = false, expectedKind, parts = null, drop = null, changed: own, version: packed = null } = {}) => serial(k, async () => {
      if (typeof k !== 'string' || !k) throw new Error('no paper key');
      const written = Object.keys(parts || {}), dropped = [...(drop || [])];
      if ([...written, ...dropped].some((n) => typeof n !== 'string' || !PART_NAME.test(n)) || (packed && typeof packed.gz !== 'string')) throw new Error('no such part');
      const prev = (await get(PAPER + k)) || null, t = now();
      if (expectedKind && (prev?.kind || 'paper') !== expectedKind) throw new Error('document kind changed');
      // A save queued in another editor may arrive after Open in Glaze. Only an explicit import or restore can change
      // the kind; the editor's session copy still holds its unsaved document or workbook.
      if (prev && patch.kind && patch.kind !== (prev.kind || 'paper') && !['import', 'restore'].includes(reason)) throw new Error('document kind changed');
      const cleared = patch.kind && patch.kind !== (prev?.kind || 'paper') ? Object.fromEntries([...FILE_FIELDS, ...(prev?.kind === 'sheet' ? ['book', 'grid', 'cells', 'sheets'] : [])].map((f) => [f, null])) : {};
      const paper = { ...(prev || { key: k, created: t }), ...cleared, ...patch, key: k, updated: t, revision: (prev?.revision || 0) + 1 };
      // An autosave carries the name it last read. Only an explicit title edit can replace a later rename.
      if (patch.doc && prev && base != null && base < (prev.titled ?? prev.revision ?? 0) && !rename) {
        paper.title = prev.title; paper.named = prev.named;
      }
      paper.kind ||= 'paper';
      paper.named = paper.named === true;
      const retitled = paper.named !== (prev?.named === true) || (paper.named && paper.title !== prev?.title) || (!patch.doc && paper.title !== prev?.title);
      paper.titled = retitled ? paper.revision : prev?.titled ?? prev?.revision ?? 0;
      if (patch.doc) paper.words = patch.words ?? measure(patch.doc).words;
      // edited: the revision that last changed the document, its format or import choice. A save typed on an older
      // revision is a conflict only when one of those changed since: a rename (the Documents home's) in between is none.
      const changed = typeof own === 'boolean' ? own : paper.file !== prev?.file || JSON.stringify(paper.doc) !== JSON.stringify(prev?.doc) || JSON.stringify(paper.format) !== JSON.stringify(prev?.format) || (paper.keep === true) !== (prev?.keep === true);
      // A parts plan belongs to the revision its editor read. Merging it into another editor's book would silently
      // mix their bands; refuse before publishing anything, leaving the unsaved workbook in its editor.
      if (paper.kind === 'sheet' && changed && base != null && (base < (prev?.edited ?? prev?.revision ?? 0) || (!prev && base > 0))) throw new Error('spreadsheet changed in another tab');
      if (written.length || dropped.length) {
        paper.parts = { ...(prev?.parts || {}) };
        for (const n of dropped) delete paper.parts[n];
        for (const n of written) paper.parts[n] = paper.revision;
      }
      // A spreadsheet that became another kind (Open in Glaze, Open in Writer) lets its parts go.
      if (prev?.kind === 'sheet' && paper.kind !== 'sheet' && prev.parts) { paper.partDrops = [...new Set([...(prev.partDrops || []), ...Object.keys(prev.parts)])]; delete paper.parts; }
      // Publish cleanup names with the new parts map. A worker stopped after set() can retry them on its next save or
      // remove them with the record. Revived bands are excluded before either the publication or the cleanup.
      if (paper.parts) paper.partDrops = [...new Set([...(prev?.partDrops || []), ...dropped])].filter((n) => paper.parts[n] === undefined);
      const limit = paper.kind === 'sheet' ? CAP.packed : CAP.bytes;
      paper.edited = changed ? paper.revision : prev?.edited ?? prev?.revision ?? 0;
      // Typing in a document in Trash (an editor still open on it, an assignment's Writer), or submitting it, takes it out:
      // what is written is never purged with it. A record that says it is in Trash (a backup's) says so itself.
      if ((changed || reason === 'sending' || reason === 'submit') && !('trashed' in patch)) delete paper.trashed;
      let version = null, history = null;
      const retain = async (v) => {
        if (paper.kind === 'sheet' && v.bytes > limit) throw new RangeError('spreadsheet version size limit');
        history = await cap([v, ...(history || await versionsOf(k))], limit);
        if (paper.kind === 'sheet' && history.reduce((n, x) => n + x.bytes, 0) > limit) throw new RangeError('spreadsheet version size limit');
        return v;
      };
      const last = paper.lastVersion || 0, whole = reason === 'submit' || reason === 'sending';
      const conflict = prev?.doc && changed && base != null && base < (prev.edited ?? (prev.revision || 0));
      if (whole && conflict) await retain(snapshot(prev, 'conflict', t));
      if (whole) { version = await retain(snapshot(paper, reason, t)); if (reason === 'submit') paper.submitted = t; }
      else if (conflict) version = await retain(snapshot(prev, 'conflict', t));
      else if ((reason === 'import' || reason === 'restore' || reason === 'format' || reason === 'view') && (prev?.doc || prev?.file)) version = await retain(snapshot(prev, reason, t));
      else if (prev?.doc && patch.doc) {
        const a = measure(prev.doc), b = measure(patch.doc);
        const big = Math.abs(a.words - b.words) >= CAP.words || Math.abs(a.chars - b.chars) >= CAP.share * Math.max(a.chars, b.chars, 500);
        if (big) version = await retain(snapshot(prev, 'edit', t));
        else if (t - last >= CAP.every && JSON.stringify(prev.doc) !== JSON.stringify(patch.doc)) version = await retain(snapshot(paper, 'auto', t));
      }
      if (!prev && patch.doc) version = await retain(snapshot(paper, 'start', t));
      if (packed) version = await retain({ id: `${t.toString(36)}-${Math.random().toString(36).slice(2, 8)}`, at: t, reason: String(packed.reason || 'auto'), kind: paper.kind,
        cells: Number.isSafeInteger(packed.cells) ? packed.cells : 0, bytes: packed.gz.length, gz: packed.gz });
      if (version) paper.lastVersion = t;
      // One storage write publishes the document, history and index together. A quota refusal cannot evict
      // a submitted version or expose a half-saved paper. The worker serializes this read/compute/write.
      await store.set({ [PAPER + k]: paper, [INDEX]: await index(paper), ...(history ? { [VERSIONS + k]: history } : {}),
        ...Object.fromEntries(written.map((n) => [`${PART}${k}:${n}`, { ...parts[n], rev: paper.revision }])) });
      const stale = (paper.partDrops || []).map((n) => `${PART}${k}:${n}`);
      // The document is already safely published. A cleanup refusal must not turn that successful save into a retry
      // against an old revision; the persisted cleanup names keep deletion recoverable.
      if (stale.length) { try { await store.remove(stale); } catch { /* retry on the next save or deletion */ } }
      seen.set(k, paper.revision);
      return { paper, version };
    });
    // The 'sending' version a submit was built from, once Ultra's Submit is clicked (lib/background.js, at the dispatch):
    // 'submit' from then, the paper submitted. The document is unchanged, so its revision is too.
    const submitted = (k, id) => serial(k, async () => {
      const list = await versionsOf(k), v = list.find((x) => x.id === id && x.reason === 'sending'), paper = await get(PAPER + k);
      if (!v || !paper) return null;
      v.reason = 'submit';
      paper.submitted = now();
      delete paper.trashed; // another tab may have trashed it between the sending save and native dispatch
      await store.set({ [PAPER + k]: paper, [VERSIONS + k]: list, [INDEX]: await index(paper) });
      const { doc, file, thumb, ...meta } = v;
      return meta;
    });
    const versions = async (k) => (await versionsOf(k)).map(({ doc, file, thumb, gz, ...v }) => v);
    const version = async (k, id) => (await versionsOf(k)).find((v) => v.id === id) || null;
    // The version back as the paper, with what it replaces kept as a version.
    const restore = async (k, id) => {
      const v = await version(k, id);
      if (!v || (v.kind && v.kind !== 'paper' && !v.doc && !v.file)) return null;
      const file = Object.fromEntries(FILE_FIELDS.map((f) => [f, v.kind && v.kind !== 'paper' ? v[f] ?? null : null]));
      return save(k, { kind: v.kind || 'paper', doc: v.doc, words: v.words, keep: v.keep === true, outline: v.outline || null, ...file, ...(v.format != null ? { format: v.format } : {}) }, { reason: 'restore' });
    };
    const list = async () => ((await get(INDEX)) || []).filter((r) => r && typeof r.key === 'string').map((r) => ({ ...r, kind: r.kind || 'paper', named: r.named === true }));
    const remove = (k) => serial(k, async () => {
      // The submit fence is checked inside the same worker turn as deletion, including Settings' Clear all.
      if (await o.busy?.(k)) throw new Error('submit in progress');
      // Return the record actually deleted, including an editor's intervening autosave.
      const paper = await get(PAPER + k), history = await get(VERSIONS + k), list = (await get(INDEX)) || [];
      // Publish the smaller index before deleting data: a refused index write must leave the recovery records intact.
      await store.set({ [INDEX]: list.filter((r) => r.key !== k) });
      try { await store.remove([PAPER + k, VERSIONS + k, ...sourcesOf(k), ...partsOf(k, paper)]); }
      catch (e) { await store.set({ [INDEX]: list }); throw e; }
      return { ...(paper ? { [PAPER + k]: paper } : {}), ...(Array.isArray(history) ? { [VERSIONS + k]: history } : {}) };
    });
    // Into Trash (on: when it was first trashed stays) or out of it. Neither is an edit: the document, its versions, its
    // revision and Last edited stay. version: an open keeps a restore checkpoint. → { key, trashed } or { key }, or null when absent.
    const mark = (k, on, { version = false } = {}) => serial(k, async () => {
      if (typeof k !== 'string' || !k) throw new Error('no paper key');
      const paper = await get(PAPER + k);
      if (!paper) return null;
      if (on !== trashed(paper)) {
        if (on) paper.trashed = now(); else delete paper.trashed;
        // Opening a paper in Trash keeps what was opened as a checkpoint, in the same write that restores it.
        const history = !on && version && paper.doc ? await cap([snapshot(paper, 'restore', now()), ...await versionsOf(k)]) : null;
        await store.set({ [PAPER + k]: paper, [INDEX]: await index(paper), ...(history ? { [VERSIONS + k]: history } : {}) });
      }
      return on ? { key: k, trashed: paper.trashed } : { key: k };
    });
    // What has been in Trash longer than CAP.trash goes for good with its versions, the smaller index published first as in
    // remove. The record decides: a row whose record is out of Trash stays, and one whose record is gone goes. → the keys.
    const purge = () => serial('', async () => {
      const t = now(), list = (await get(INDEX)) || [], keys = [], extra = [];
      // A malformed timestamp or clock is never evidence of 30 elapsed days. A future flag survives clock rollback.
      const old = (r) => Number.isSafeInteger(t) && Number.isSafeInteger(r?.trashed) && r.trashed >= 0 && t - r.trashed > CAP.trash;
      for (const r of list) if (r && typeof r.key === 'string' && old(r)) { const paper = await get(PAPER + r.key); if ((!paper || old(paper)) && !await o.busy?.(r.key)) { keys.push(r.key); extra.push(...partsOf(r.key, paper)); } }
      if (!keys.length) return keys;
      const gone = new Set(keys);
      await store.set({ [INDEX]: list.filter((r) => !gone.has(r?.key)) });
      try { await store.remove([...keys.flatMap((k) => [PAPER + k, VERSIONS + k, ...sourcesOf(k)]), ...extra]); }
      catch (e) { await store.set({ [INDEX]: list }); throw e; }
      return keys;
    });

    // A student's presets (lib/writer-styles.js custom), kept valid.
    const presets = async (scope) => ((scope && (await get(PRESETS + scope))) || []).filter((x) => globalThis.GZ_WRITER_STYLES?.custom ? GZ_WRITER_STYLES.custom(x) : true);
    const savePreset = async (scope, preset) => {
      if (!scope) throw new Error('no student');
      const now2 = (await presets(scope)).filter((x) => x.id !== preset.id);
      await store.set({ [PRESETS + scope]: [...now2, preset].slice(-CAP.presets) });
    };
    const removePreset = async (scope, id) => { if (scope) await store.set({ [PRESETS + scope]: (await presets(scope)).filter((x) => x.id !== id) }); };

    // Backup replay runs inside the worker's staged storage transaction. A newer live paper stays;
    // the other document remains a version, and neither device's version history is discarded.
    // A backup's records (lib/backup.js): a spreadsheet's carries the bands it names as $parts, written with it.
    const merge = async (records) => {
      // A version's size as snapshot and save count it: a spreadsheet's packed workbook, a file kind's file, a paper's document.
      const sizeOf = (v) => (v.kind === 'sheet' ? (typeof v.gz === 'string' ? v.gz.length : 0)
        : bytes(v.doc ?? null) + (v.kind && v.kind !== 'paper' ? bytes(Object.fromEntries(FILE_FIELDS.filter((f) => v[f] !== undefined).map((f) => [f, v[f]]))) : 0));
      const mergedVersions = async (k, incoming, sheet = false) => {
        const here = await versionsOf(k), ids = new Set(here.map((v) => v.id));
        const limit = sheet || (await get(PAPER + k))?.kind === 'sheet' || incoming.some((v) => v.kind === 'sheet') ? CAP.packed : CAP.bytes;
        return cap([...here, ...incoming.filter((v) => !ids.has(v.id)).map((v) => ({ ...v, bytes: sizeOf(v) }))], limit);
      };
      const bandsOf = (k, bands) => Object.fromEntries(Object.entries(bands || {}).map(([n, p]) => [`${PART}${k}:${n}`, p]));
      const restored = new Set();
      // A missing paper and its history publish together even when a backup lists the versions first.
      const entries = Object.entries(records).sort(([a], [b]) => Number(b.startsWith(PAPER)) - Number(a.startsWith(PAPER)));
      for (const [name, full] of entries) {
        if (name.startsWith(PAPER)) {
          const { $parts: bands, partDrops, ...value } = full;
          const k = name.slice(PAPER.length), prev = await get(name), sheet = value.kind === 'sheet';
          // Backup replay of a missing record keeps its history intact: no synthetic start version displaces an old one.
          if (!prev) await serial(k, async () => {
            const vk = VERSIONS + k, history = records[vk] && await mergedVersions(k, records[vk], sheet);
            await store.set({ [name]: value, [INDEX]: await index(value), ...(history ? { [vk]: history } : {}), ...(sheet ? bandsOf(k, bands) : {}) });
            if (history) restored.add(vk);
            seen.set(k, value.revision || 0);
          });
          // A spreadsheet here stays as it is: its bands are never mixed with a backup's, and nothing here could keep it as
          // a version first (its versions are packed by the page). Its history still joins the backup's below.
          else if (prev.kind === 'sheet') continue;
          // The backup's newer: it replaces what is here, which is kept as a version (a spreadsheet's bands written with it).
          else if ((value.updated || 0) > (prev.updated || 0)) await save(k, value, { reason: 'restore', rename: true, ...(sheet && bands && { parts: bands }) });
          else if (!sheet && (prev.file !== value.file || JSON.stringify(prev.doc) !== JSON.stringify(value.doc) || JSON.stringify(prev.format) !== JSON.stringify(value.format) || (prev.keep === true) !== (value.keep === true))) await addVersion(k, snapshot(value, 'restore', now()));
        } else if (name.startsWith(VERSIONS) && !restored.has(name)) {
          await store.set({ [name]: await mergedVersions(name.slice(VERSIONS.length), full) });
        } else if (name.startsWith(PRESETS)) {
          const here = await get(name) || [], ids = new Set(here.map((v) => v.id));
          await store.set({ [name]: [...here, ...full.filter((v) => !ids.has(v.id))].slice(0, CAP.presets) });
        }
      }
    };
    const api = { get: (k) => get(PAPER + k).then((p) => { seen.set(k, p?.revision || 0); return p || null; }), save, submitted, versions, version, restore, list, remove, presets, savePreset, removePreset, merge,
      trash: (k) => mark(k, true), untrash: (k, options) => mark(k, false, options), purge };
    if (!store) throw new Error('paper storage unavailable');
    return api;
  };

  return { open, keyOf, scopeOf, measure, LOCAL, local, newKey, valid, copyOf, fromDocument, renamed, trashed, CAP, KEYS: { INDEX, PAPER, VERSIONS, PRESETS, PART } };
})();

if (typeof module !== 'undefined') module.exports = GZ_WRITER_PAPERS; else GZ_WRITER_PAPERS;
