// One backup file (Settings → Privacy and data → Backup and reset, options.js): a zip of glaze-backup.json (the categories
// below), share-keys.json and each Notes account's own export (lib/notes.js exportZip) under notes/<n>/. Restore also takes
// a settings file (glaze-settings.json) and a Notes zip from before. All of a file is read and checked before anything is
// written; each category then joins what is here by its own store's rules. What Glaze read from a school (caches, course
// names, card pictures) stays out. Classic script for the editor and the worker (lib/background.js 'glaze:backup', apply);
// module.exports for node.
var GZ_BACKUP = globalThis.GZ_BACKUP || (() => {
  // Each library as the page or the worker loaded it (a script's const is no property of globalThis), or node's.
  const LIBS = {
    GZ_TODO: () => (typeof GZ_TODO !== 'undefined' ? GZ_TODO : require('./todo.js')), GZ_NOTES: () => (typeof GZ_NOTES !== 'undefined' ? GZ_NOTES : require('./notes.js')),
    GZ_DOCTEXT: () => (typeof GZ_DOCTEXT !== 'undefined' ? GZ_DOCTEXT : require('./doctext.js')), GZ_WIDGETS: () => (typeof GZ_WIDGETS !== 'undefined' ? GZ_WIDGETS : require('./widgets.js')),
    GZ_CLASSES: () => (typeof GZ_CLASSES !== 'undefined' ? GZ_CLASSES : require('./classes.js')), GZ_GPA: () => (typeof GZ_GPA !== 'undefined' ? GZ_GPA : require('./gpa.js')),
    GZ_SHARING: () => (typeof GZ_SHARING !== 'undefined' ? GZ_SHARING : require('./sharing.js')), GZ_RELAY: () => (typeof GZ_RELAY !== 'undefined' ? GZ_RELAY : require('./relay.js')),
    GZ_HISTORY: () => (typeof GZ_HISTORY !== 'undefined' ? GZ_HISTORY : require('./history.js')), GZ_PET: () => (typeof GZ_PET !== 'undefined' ? GZ_PET : require('./pet.js')),
    GZ_XPARTS: () => (typeof GZ_XPARTS !== 'undefined' ? GZ_XPARTS : require('./lookparts.js')),
  };
  const lib = (name) => LIBS[name]();
  const FORMAT = 'glaze-backup', VERSION = 1, MANIFEST = 'glaze-backup.json', KEYS = 'share-keys.json';
  // Refused by size before being read: a settings file, and a backup (two Notes accounts at their cap, and the rest).
  const LIMIT = { json: 16 << 20, zip: 512 << 20, entries: 40000, records: 1000 };
  // In the order the restore list shows them: two columns, row by row.
  const CATS = ['settings', 'notes', 'tasks', 'dashNotes', 'classes', 'gpa', 'widgets', 'shareKeys', 'papers', 'writerWords', 'sources'];
  // The stores' own keys (lib/widgets.js NOTES_KEY, lib/classes.js STORE_KEY, lib/gpa.js KEY, lib/notes.js KEY; test/backup.test.js
  // keeps them equal): the editor doesn't load those libraries.
  const STORES = {
    dashNotes: /^notes:https?:\/\/[a-z\d.-]+(?::\d+)?\/(\d+|_\d+_\d+)$/i,
    classes: /^classes:https?:\/\/[a-z\d.-]+(?::\d+)?\/(?:\d+|_\d+_\d+)$/i,
    gpa: /^gpaTerms:https?:\/\/[a-z\d.-]+(?::\d+)?:\w{1,40}$/i,
  };
  const ACCOUNT = /^notesIdx:https?:\/\/[a-z\d.-]+(?::\d+)?\/(\d{1,20}|_\d{1,20}_\d{1,20})$/i;
  const obj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
  const fail = (why) => Object.assign(new Error(why), { why });
  // JSON.parse, refusing a key that could reach an object's prototype anywhere in it.
  const BAD = new Set(['__proto__', 'constructor', 'prototype']);
  const parse = (text) => JSON.parse(text, (k, v) => { if (BAD.has(k)) throw fail('bad'); return v; });
  const keyList = (raw) => {
    if (!Array.isArray(raw) || raw.length > 20 || raw.some((x) => {
      if (!obj(x) || (x.type !== null && x.type !== 'collection')) return true;
      const k = lib('GZ_SHARING').importKeys({ ...x, type: null }, true);
      return !k || lib('GZ_RELAY').normalize(k.server) !== k.server;
    })) throw fail('bad');
    return raw;
  };
  // Read only the directory and one member at a time. Reuse the ZIP reader's CRC, header and bounded inflate checks;
  // rebuilding a one-member directory lets it release each inflated member instead of caching the whole archive.
  const archive = async (file) => {
    const Z = lib('GZ_DOCTEXT');
    if (!file.slice) file = new Blob([await file.arrayBuffer()]); // node fixtures; browser Files always have slice
    const bytes = async (a, b) => new Uint8Array(await file.slice(a, b).arrayBuffer());
    const tailAt = Math.max(0, file.size - 65557), tail = await bytes(tailAt, file.size), tv = new DataView(tail.buffer);
    let end = -1;
    for (let i = tail.length - 22; i >= 0; i--) if (tv.getUint32(i, true) === 0x06054b50 && i + 22 + tv.getUint16(i + 20, true) === tail.length) { end = i; break; }
    if (end < 0) throw fail('bad');
    const count = tv.getUint16(end + 10, true), size = tv.getUint32(end + 12, true), at = tv.getUint32(end + 16, true);
    if (tv.getUint16(end + 4, true) || tv.getUint16(end + 6, true) || tv.getUint16(end + 8, true) !== count
      || count > LIMIT.entries || size > LIMIT.json || at + size !== tailAt + end) throw fail('bad');
    const cd = await bytes(at, at + size), v = new DataView(cd.buffer), entries = new Map();
    let p = 0, total = 0;
    for (let i = 0; i < count; i++) {
      if (p + 46 > size || v.getUint32(p, true) !== 0x02014b50) throw fail('bad');
      const n = v.getUint16(p + 28, true), next = p + 46 + n + v.getUint16(p + 30, true) + v.getUint16(p + 32, true);
      if (next > size || v.getUint16(p + 34, true)) throw fail('bad');
      const name = new TextDecoder().decode(cd.subarray(p + 46, p + 46 + n));
      const json = name === MANIFEST || name === KEYS || /^(?:notes\/\d+\/)?notes\.json$/.test(name);
      const length = v.getUint32(p + 24, true), compressed = v.getUint32(p + 20, true), start = v.getUint32(p + 42, true);
      if (length > (json ? LIMIT.json : 64 << 20) || compressed > (64 << 20) || (total += length) > LIMIT.zip) throw fail('big');
      if (entries.has(name) || start + 30 + compressed > at || name.split('/').includes('..')) throw fail('bad');
      entries.set(name, { header: cd.slice(p, next), start, compressed });
      p = next;
    }
    if (p !== size) throw fail('bad');
    const raw = async (name) => {
      const e = entries.get(name);
      if (!e) return null;
      const h = await bytes(e.start, e.start + 30), hv = new DataView(h.buffer);
      const length = 30 + hv.getUint16(26, true) + hv.getUint16(28, true) + e.compressed;
      const descriptor = (hv.getUint16(6, true) & 8) ? 16 : 0;
      if (e.start + length > at) throw fail('bad');
      const member = await bytes(e.start, Math.min(at, e.start + length + descriptor));
      const out = new Uint8Array(member.length + e.header.length + 22);
      out.set(member); out.set(e.header, member.length);
      const ov = new DataView(out.buffer), stop = member.length + e.header.length;
      ov.setUint32(member.length + 42, 0, true);
      ov.setUint32(stop, 0x06054b50, true); ov.setUint16(stop + 8, 1, true); ov.setUint16(stop + 10, 1, true);
      ov.setUint32(stop + 12, e.header.length, true); ov.setUint32(stop + 16, member.length, true);
      return Z.unzip(out, { limits: { input: out.length, entry: 64 << 20, total: 64 << 20, entries: 1 } }).bytes(name);
    };
    return { names: [...entries.keys()], bytes: raw, text: async (name) => { const b = await raw(name); return b && new TextDecoder().decode(b); } };
  };
  // A store's records by key: every key the store's, every value an object, no more than LIMIT.records.
  const records = (raw, re) => {
    if (!obj(raw)) throw fail('bad');
    const out = Object.entries(raw);
    if (out.length > LIMIT.records || out.some(([k, v]) => !re.test(k) || !obj(v))) throw fail('bad');
    return Object.fromEntries(out);
  };
  const whole = (category, records) => {
    for (const raw of Object.values(records)) {
      if (category === 'classes') {
        const clean = lib('GZ_CLASSES').clean(raw), courses = raw.courses ?? [];
        if (!Array.isArray(courses) || courses.length !== clean.courses.length || courses.some((c, i) => !Array.isArray(c.periods) || c.periods.length !== clean.courses[i].periods.length)) throw fail('bad');
      } else if (category === 'gpa') {
        const clean = lib('GZ_GPA').clean(raw), terms = raw.t ?? [];
        if (!Array.isArray(terms) || terms.length !== clean.t.length || terms.some((t, i) => t.c !== undefined && (!Array.isArray(t.c) || t.c.length !== clean.t[i].c.length))) throw fail('bad');
      }
    }
    return records;
  };
  const paperKey = /^(writerPaper:|writerVersions:)(?:[a-z\d.-]+(?::\d{1,5})?\|_\d+_\d+\|_\d+_\d+\|_\d+_\d+|recovery:[a-z\d-]+|doc:[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12})$|^writerPresets:[a-z\d.-]+(?::\d{1,5})?\|_\d+_\d+$/i;
  // The kinds of document this build keeps (lib/doc-kinds.js KINDS; test/backup.test.js holds them equal). A spreadsheet's
  // record goes into its backup file with its bands (writerSheet:<key>:<sheet>:<band>, lib/writer-papers.js PART) as $parts,
  // so one restore step writes them together; a PDF's or deck's record holds its file (base64, at most 3 MB of it).
  const KINDS = ['paper', 'sheet', 'pdf', 'slides'], PART = 'writerSheet:', PART_NAME = /^\d{1,9}:\d{1,5}$/;
  const kindOf = (v) => (obj(v) && typeof v.kind === 'string' ? v.kind : 'paper');
  const paperVersion = (v) => !obj(v) || v.kind === undefined || KINDS.includes(v.kind);
  const B64 = /^[A-Za-z0-9+/]*={0,2}$/, FILE_MAX = 4e6, EXT = { pdf: ['.pdf'], slides: ['.pptx', '.ppsx'] };
  const count = (n) => n == null || (Number.isSafeInteger(n) && n >= 0);
  const text = (s, max) => s == null || (typeof s === 'string' && s.length <= max);
  const base64 = (s, max) => typeof s === 'string' && s.length > 0 && s.length <= max && s.length % 4 === 0 && B64.test(s);
  // A PDF's or deck's fields (pdf-kind.js, slides-kind.js STORE): the file, its size, its first page's picture, what was read.
  const fileFields = (kind, v) => base64(v.file, FILE_MAX) && (v.size == null || (Number.isSafeInteger(v.size) && v.size > 0 && v.size <= 3e6))
    && (v.ext == null || EXT[kind].includes(v.ext)) && text(v.text, 2e5) && count(v.pages) && count(v.slides) && count(v.words)
    && (v.thumb == null || (typeof v.thumb === 'string' && v.thumb.length <= 8e6 && /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]*={0,2}$/.test(v.thumb)));
  // A spreadsheet's record (sheet-data.js): its book, card text and counts, and each band the record names, at the revision
  // that wrote it.
  const glance = (g) => g == null || (Array.isArray(g) && g.length === 4 && g.every((row) => Array.isArray(row) && row.length === 6 && row.every((x) => typeof x === 'string' && x.length <= 40)));
  const sheetFields = (v) => {
    const names = Object.keys(v.parts ?? {}), bands = v.$parts ?? {};
    return (v.book == null || obj(v.book)) && glance(v.grid) && text(v.text, 2e4) && count(v.cells) && count(v.sheets)
      && (v.parts == null || obj(v.parts)) && obj(bands) && names.every((n) => PART_NAME.test(n) && Number.isSafeInteger(v.parts[n]))
      && Object.keys(bands).length === names.length && names.every((n) => obj(bands[n]) && bands[n].rev === v.parts[n] && Array.isArray(bands[n].rows) && Object.keys(bands[n]).every((k) => k === 'rows' || k === 'rev'));
  };
  const paperLibraries = async () => {
    if (typeof module !== 'undefined') return { P: require('./writer-papers.js'), S: require('./writer-schema.js'), ST: require('./writer-styles.js'), SR: require('./writer-sources.js') };
    if (!globalThis.GZ_WRITER_SCHEMA || !globalThis.GZ_WRITER_PAPERS || !globalThis.GZ_WRITER_STYLES || !globalThis.GZ_WRITER_SOURCES) {
      const files = ['lib/pm.js', 'lib/writer-schema.js', 'lib/writer-styles.js', 'lib/writer-papers.js', 'lib/writer-sources.js'];
      if (typeof importScripts === 'function') importScripts(...files.map((f) => chrome.runtime.getURL(f)));
      else for (const file of files) await new Promise((ok, no) => { const script = document.createElement('script'); script.src = chrome.runtime.getURL(file); script.onload = ok; script.onerror = no; document.head.append(script); });
    }
    return { P: GZ_WRITER_PAPERS, S: GZ_WRITER_SCHEMA, ST: GZ_WRITER_STYLES, SR: GZ_WRITER_SOURCES };
  };
  const paperRecords = async (raw) => {
    if (!obj(raw) || Object.keys(raw).length > 6000) throw fail('bad');
    const { P, S, ST } = await paperLibraries();
    const doc = (json) => {
      const node = S.paper.nodeFromJSON(json); node.check();
      const { setup, paste } = node.attrs;
      if (setup != null && JSON.stringify(ST.setup(setup)) !== JSON.stringify(setup) || ![null, 'keep', 'match'].includes(paste)) throw fail('bad');
      const parsed = S.parse(S.paper, S.serialize(S.paper, node), { document: true });
      // HTML carries block/run attributes; page setup and the paste choice live only on the document.
      if (!parsed.type.create(node.attrs, parsed.content).eq(node)) throw fail('bad');
    };
    // A kind this build doesn't know (a later one's) is left out with its versions, so the rest still restores.
    const later = new Set(Object.entries(raw).filter(([key, value]) => key.startsWith('writerPaper:') && obj(value) && !KINDS.includes(kindOf(value))).map(([key]) => key.slice(12)));
    const out = {};
    const size = (v) => new TextEncoder().encode(JSON.stringify(v)).length;
    for (const [key, original] of Object.entries(raw)) {
      const value = key.startsWith('writerVersions:') && Array.isArray(original) ? original.filter(paperVersion) : original;
      if (!paperKey.test(key)) throw fail('bad');
      if (later.has(key.replace(/^writer(?:Paper|Versions):/, ''))) continue;
      out[key] = value;
      if (key.startsWith('writerPaper:')) {
        if (!obj(value) || value.key !== key.slice(12) || !Number.isFinite(value.updated) || (value.title !== undefined && (typeof value.title !== 'string' || value.title.length > 1000))) throw fail('bad');
        const kind = kindOf(value);
        if (kind !== 'sheet' && value.$parts !== undefined) throw fail('bad');
        // Another kind's record holds no document; one left there by an older save is checked as a paper's is.
        if (kind === 'paper' || value.doc != null) doc(value.doc);
        if (kind !== 'paper' && !(kind === 'sheet' ? sheetFields(value) : fileFields(kind, value))) throw fail('bad');
      } else if (key.startsWith('writerVersions:')) {
        if (!Array.isArray(value) || value.length > 100) throw fail('bad');
        for (const v of value) {
          if (!obj(v) || typeof v.id !== 'string' || !Number.isFinite(v.at)) throw fail('bad');
          const kind = kindOf(v);
          // A spreadsheet's version is its workbook packed (gz); a PDF's or deck's, its file; a paper's, its document.
          if (kind !== 'paper' && v.doc != null) doc(v.doc);
          if (kind === 'sheet') { if (!base64(v.gz, 16e6) || !count(v.cells)) throw fail('bad'); v.bytes = v.gz.length; }
          else if (kind === 'paper') { doc(v.doc); v.bytes = size(v.doc); }
          else { if (!fileFields(kind, v)) throw fail('bad'); v.bytes = size(v.doc ?? null) + size(Object.fromEntries(['file', 'size', 'pages', 'thumb', 'ext', 'slides', 'text'].filter((f) => v[f] !== undefined).map((f) => [f, v[f]]))); }
        }
      } else if (!Array.isArray(value) || value.length > P.CAP.presets || value.some((v) => !ST.custom(v))) throw fail('bad');
    }
    return out;
  };
  // The writer's personal dictionary (writer-proof.js 'writerWords': words, the newest last) and each box's saved sources
  // (lib/writer-sources.js `writer:sources:<school>|<user>|<course>|<item>` → { sources, at }).
  const WORDS = { max: 5000, length: 60 };
  const sourceKey = /^writer:sources:(?:[\w.!~*'()%-]{1,2700}\|){3}[\w.!~*'()%-]{1,2700}$/;
  const wordsOf = (raw) => {
    if (!Array.isArray(raw) || raw.length > WORDS.max || raw.some((w) => typeof w !== 'string' || !w.trim() || w !== w.trim() || w.length > WORDS.length)) throw fail('bad');
    return raw;
  };
  const sourcesOf = async (raw) => {
    if (!obj(raw) || Object.keys(raw).length > 6000) throw fail('bad');
    const { SR } = await paperLibraries();
    for (const [key, value] of Object.entries(raw)) {
      if (!sourceKey.test(key) || !obj(value) || !Number.isFinite(value.at) || !Array.isArray(value.sources) || value.sources.length > SR.MAX.sources
        || value.sources.some((x) => SR.normalize(x)?.id !== x?.id)) throw fail('bad');
    }
    return raw;
  };
  const tasksOf = (raw) => {
    if (!obj(raw) || (raw.tasks !== undefined && !obj(raw.tasks)) || (raw.pets !== undefined && !obj(raw.pets))) throw fail('bad');
    if (raw.pets !== undefined && !lib('GZ_PET').backup(raw.pets)) throw fail('bad');
    const T = lib('GZ_TODO');
    return { tasks: Object.fromEntries(Object.entries(raw.tasks || {}).filter(([k]) => T.STORE_KEY.test(k))), ...(raw.pets !== undefined && { pets: raw.pets }) };
  };
  const filled = (v) => obj(v) && Object.keys(v).length > 0;
  const looksLikeSettings = (raw) => obj(raw) && ['colors', 'look', 'bg', 'motion', 'presets'].some((k) => k in raw);
  const settingsOf = (raw) => {
    if (!looksLikeSettings(raw)) throw fail('bad');
    if (raw.parts != null) {
      const P = lib('GZ_XPARTS'), parts = P.bundle(raw.parts);
      if (!parts || !P.same(parts, raw.parts)) throw fail('bad');
    }
    return raw;
  };

  // ---- reading a file: → { kind: 'backup' | 'settings' | 'notes', cats, zip? } or throws, with why: 'big', 'json' (not
  // JSON), 'none' (no Glaze data), 'newer' (a later format), 'bad' (damaged or not Glaze's).
  // A settings file from Export settings: its settings, its tasks and pets, its share keys.
  const settingsFile = (raw) => {
    if (!looksLikeSettings(raw)) throw fail('none');
    const { tasks, pets, shareKeys, ...settings } = raw;
    const cats = { settings: settingsOf(settings) };
    const taskData = tasksOf({ tasks: tasks ?? {}, ...(pets !== undefined && { pets }) });
    if (filled(taskData.tasks) || filled(taskData.pets)) cats.tasks = taskData;
    if (shareKeys !== undefined) keyList(shareKeys);
    if (shareKeys?.length) cats.shareKeys = shareKeys;
    return { kind: 'settings', cats };
  };
  // A Notes export in the zip (dir: '' or notes/<n>/): its notes.json checked as an import checks it, and every file it
  // declares there, whole.
  const checked = async (zip, dir, account = '') => {
    const N = lib('GZ_NOTES');
    const json = await zip.text(`${dir}notes.json`);
    if (typeof json !== 'string') throw fail('bad');
    const raw = parse(json);
    let data;
    try { data = N.parseExport(raw, { site: raw.site }); } catch { throw fail('bad'); }
    if (account && raw.site !== new URL(account.slice(9)).origin) throw fail('bad');
    for (const k of ['notes', 'folders', 'files']) if (!Array.isArray(raw[k]) || raw[k].length !== data[k].length) throw fail('bad');
    const files = new Set(data.files.map((f) => f.id));
    if (data.notes.some((n) => n.big || n.html.length > N.LIMIT.body) || raw.notes.some((n) => [...N.refs(n.html)].some((id) => !files.has(id)))) throw fail('bad');
    for (const f of data.files) {
      const bytes = await zip.bytes(dir + f.path);
      if (bytes?.length !== f.size || (f.kind === 'image' && !N.imageType(bytes))) throw fail('bad');
    }
    return { site: typeof raw.site === 'string' ? raw.site : '', count: data.notes.length };
  };
  const read = async (file) => {
    const zipped = /\.zip$/i.test(file.name || '') || file.type === 'application/zip';
    if (file.size > (zipped ? LIMIT.zip : LIMIT.json)) throw fail('big');
    if (!zipped) {
      let raw;
      try { raw = parse(await file.text()); } catch (e) { throw fail(e.why || 'json'); }
      return settingsFile(raw);
    }
    let zip;
    try { zip = await archive(file); } catch (e) { throw e.why ? e : fail('bad'); }
    try {
      const keysText = await zip.text(KEYS);
      const shareKeys = typeof keysText === 'string' ? parse(keysText) : undefined;
      if (shareKeys !== undefined) keyList(shareKeys);
      const keys = shareKeys?.length ? { shareKeys } : {};
      const manifest = await zip.text(MANIFEST);
      // A Notes zip from before: one account's notes, for an account on this device the student picks.
      if (typeof manifest !== 'string') {
        const n = await checked(zip, '');
        return { kind: 'notes', cats: { notes: [{ account: '', dir: '', site: n.site, count: n.count }], ...keys }, zip };
      }
      const m = parse(manifest);
      if (!obj(m) || m.format !== FORMAT || !Number.isInteger(m.version)) throw fail('bad');
      if (m.version > VERSION) throw fail('newer');
      if (m.version !== VERSION) throw fail('bad');
      const cats = {};
      if (m.settings !== undefined) cats.settings = settingsOf(m.settings);
      if (m.tasks !== undefined) { const r = tasksOf(m.tasks); if (filled(r.tasks) || filled(r.pets)) cats.tasks = r; }
      for (const c of ['dashNotes', 'classes', 'gpa']) if (m[c] !== undefined) { const r = whole(c, records(m[c], STORES[c])); if (Object.keys(r).length) cats[c] = r; }
      if (m.papers !== undefined) {
        if (!Array.isArray(m.papers) || m.papers.length > 6000) throw fail('bad');
        const raw = {};
        for (const row of m.papers) { if (!obj(row) || !paperKey.test(row.key) || !/^papers\/\d+\.json$/.test(row.file) || Object.hasOwn(raw, row.key)) throw fail('bad'); raw[row.key] = parse(await zip.text(row.file)); }
        const r = await paperRecords(raw);
        if (Object.keys(r).length) cats.papers = r;
      }
      if (m.writerWords !== undefined) { const r = wordsOf(m.writerWords); if (r.length) cats.writerWords = r; }
      if (m.sources !== undefined) { const r = await sourcesOf(m.sources); if (Object.keys(r).length) cats.sources = r; }
      if (m.widgets !== undefined) { if (!obj(m.widgets)) throw fail('bad'); cats.widgets = m.widgets; }
      if (m.notes !== undefined) {
        if (!Array.isArray(m.notes) || m.notes.length > 100) throw fail('bad');
        const seen = new Set(), notes = [];
        for (const a of m.notes) {
          if (!obj(a) || typeof a.account !== 'string' || !ACCOUNT.test(a.account) || typeof a.dir !== 'string' || !/^notes\/\d{1,3}\/$/.test(a.dir)
            || seen.has(a.account) || seen.has(a.dir)) throw fail('bad');
          seen.add(a.account).add(a.dir);
          notes.push({ account: a.account, dir: a.dir, count: (await checked(zip, a.dir, a.account)).count });
        }
        if (notes.length) cats.notes = notes;
      }
      Object.assign(cats, keys);
      if (!Object.keys(cats).length) throw fail('none');
      return { kind: 'backup', cats, zip };
    } catch (e) { throw e.why ? e : fail('bad'); }
  };

  // ---- making one ------------------------------------------------------------------------------------------------
  // One Notes account as its export's entries (lib/notes.js exportZip), read through the worker one note at a time (Chrome's
  // message limit is smaller than a Notes account), each at the revision listed: a mixed-revision archive is not a backup.
  // send(op, rest) → the worker's answer, throwing when it isn't ok.
  const notesOut = async (account, send, step = () => {}) => {
    const N = lib('GZ_NOTES');
    const data = (await send('backupNotes', { key: account })).data, seen = new Set();
    for (const n of data.notes) {
      step();
      const body = await send('notesRead', { key: account, id: n.id });
      if (body.rev !== n.rev) throw fail('changed');
      n.html = body.html;
      for (const id of N.refs(n.html)) if (!seen.has(id)) {
        seen.add(id);
        const f = await send('notesGetFile', { key: account, id });
        data.files.push({ id, ...f, bytes: N.unb64(f.data) });
      }
    }
    return N.exportZip(data);
  };
  // parts: { settings, tasks: { tasks, pets }, local (storage.local, all of it), notes: [{ account, entries }], keys (share
  // keys), version (Glaze's) } → the zip's entries for GZ_ZIP.zip.
  const pack = ({ settings, tasks, local, notes = [], keys = [], version = '' }, date = new Date()) => {
    const pick = (re) => Object.fromEntries(Object.entries(local).filter(([k, v]) => re.test(k) && obj(v)));
    const enc = new TextEncoder();
    const dirs = notes.map((n, i) => ({ account: n.account, dir: `notes/${i + 1}/` }));
    // Every kind's record and versions; a spreadsheet's record with the bands it names ($parts), never a stale one.
    const withBands = (key, value) => {
      if (!key.startsWith('writerPaper:') || kindOf(value) !== 'sheet') return value;
      const { partDrops, ...rec } = value, k = key.slice(12);
      return { ...rec, $parts: Object.fromEntries(Object.keys(obj(rec.parts) ? rec.parts : {}).map((n) => [n, local[`${PART}${k}:${n}`]])) };
    };
    // A spreadsheet missing a band it names can't be read back, here or anywhere: it stays out rather than spoil the file.
    const torn = (key, value) => key.startsWith('writerPaper:') && kindOf(value) === 'sheet' && Object.values(withBands(key, value).$parts).some((p) => !obj(p));
    const papers = Object.entries(local).filter(([key, value]) => paperKey.test(key) && !torn(key, value))
      .map(([key, value], i) => ({ key, value: key.startsWith('writerVersions:') && Array.isArray(value) ? value.filter(paperVersion) : withBands(key, value), file: `papers/${i + 1}.json` }));
    const words = Array.isArray(local.writerWords) ? local.writerWords.filter((w) => typeof w === 'string' && w.trim() === w && w && w.length <= WORDS.length).slice(-WORDS.max) : [];
    const sources = pick(sourceKey);
    const m = { format: FORMAT, version: VERSION, made: date.toISOString(), glaze: version, settings, tasks,
      dashNotes: pick(STORES.dashNotes), classes: pick(STORES.classes), gpa: pick(STORES.gpa),
      ...(obj(local.widgetLayout) && { widgets: local.widgetLayout }), notes: dirs, ...(papers.length && { papers: papers.map(({ key, file }) => ({ key, file })) }),
      ...(words.length && { writerWords: words }), ...(Object.keys(sources).length && { sources }) };
    const entries = [
      { name: MANIFEST, data: enc.encode(JSON.stringify(m, null, 1)), date },
      ...(keys.length ? [{ name: KEYS, data: enc.encode(JSON.stringify(keys, null, 2)), date }] : []),
      ...papers.map(({ file, value }) => ({ name: file, data: enc.encode(JSON.stringify(value)), date })),
      ...notes.flatMap((n, i) => n.entries.map((e) => ({ ...e, name: dirs[i].dir + e.name }))),
    ];
    if (notes.length > 100 || entries.length > LIMIT.entries || entries.reduce((n, e) => n + e.data.length + 76 + enc.encode(e.name).length * 2, 22) > LIMIT.zip
      || entries.some((e) => /(?:^|\/)(?:glaze-backup|notes|share-keys)\.json$/.test(e.name) && e.data.length > LIMIT.json)) throw fail('big');
    return entries;
  };
  // glaze-backup-2026-10-25.zip, by this device's date.
  const fileName = (d = new Date()) => `glaze-backup-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}.zip`;

  // ---- restoring -------------------------------------------------------------------------------------------------
  // The worker's part of a restore (lib/background.js 'glaze:backup'), in one turn of its write queue and one write: r {
  // dashNotes, classes, gpa, widgets, favorites, tasks (when the settings, which bring their own, aren't restored), notes
  // (accounts a Notes import then fills), papers, writerWords, sources }, each optional. Everything is checked first; a part that can't be taken whole
  // writes nothing. → { ok } or { ok: false, error }.
  const apply = async (r, { local }) => {
    const W = lib('GZ_WIDGETS'), C = lib('GZ_CLASSES'), G = lib('GZ_GPA');
    const H = lib('GZ_HISTORY'), N = lib('GZ_NOTES');
    let parts, papers;
    try {
      parts = {
        dashNotes: r?.dashNotes === undefined ? {} : records(r.dashNotes, STORES.dashNotes),
        classes: r?.classes === undefined ? {} : whole('classes', records(r.classes, STORES.classes)),
        gpa: r?.gpa === undefined ? {} : whole('gpa', records(r.gpa, STORES.gpa)),
        tasks: r?.tasks === undefined ? null : tasksOf(r.tasks),
      };
      if (!obj(r) || Object.keys(r).some((k) => !['dashNotes', 'classes', 'gpa', 'widgets', 'favorites', 'tasks', 'notes', 'papers', 'writerWords', 'sources'].includes(k))
        || (r.widgets !== undefined && !obj(r.widgets)) || (r.favorites !== undefined && !Array.isArray(r.favorites))
        || (r.notes !== undefined && (!Array.isArray(r.notes) || r.notes.length > 100 || r.notes.some((k) => typeof k !== 'string' || !ACCOUNT.test(k))))) throw fail('bad');
    } catch { return { ok: false, error: 'bad' }; }
    try {
      if (r.papers !== undefined) papers = await paperRecords(r.papers);
      if (r.writerWords !== undefined) wordsOf(r.writerWords);
      if (r.sources !== undefined) await sourcesOf(r.sources);
    } catch { return { ok: false, error: 'bad' }; }
    const tasks = parts.tasks ? Object.fromEntries(Object.entries(parts.tasks.tasks).map(([k, v]) => [k, lib('GZ_TODO').clean(v)])) : {};
    const pets = parts.tasks?.pets === undefined ? {} : lib('GZ_PET').backup(parts.tasks.pets);
    if (!pets) return { ok: false, error: 'bad' };
    const petKeys = [...new Set([...Object.keys(pets), ...Object.keys(tasks).map((k) => `pet:${k.slice(5)}`)])];
    const keys = [...Object.keys(parts.dashNotes), ...Object.keys(parts.classes), ...Object.keys(parts.gpa), ...Object.keys(tasks), ...petKeys, ...(r.notes || []),
      ...(r.favorites ? ['lookFavorites'] : []), ...(r.writerWords ? ['writerWords'] : []), ...Object.keys(r.sources || {})];
    const here = keys.length ? await local.get(keys) : {};
    const patch = {};
    // Dashboard notes: the newer typing stays (lib/widgets.js saveNote).
    for (const [k, v] of Object.entries(parts.dashNotes)) {
      const note = W.cleanNote(v);
      if (note.at > W.cleanNote(here[k]).at) patch[k] = note;
    }
    // Class schedules: a course comes back unless this device saved it later, deleted it later, or pressed Delete all later
    // (lib/classes.js change); the backup's own deletions count the same way here. A period keeps the zone it was saved in.
    for (const [k, v] of Object.entries(parts.classes)) {
      const d = C.clean(here[k]), b = C.clean(v);
      const since = (t, at) => !!t && t >= at; // a time here at or after `at`
      for (const c of b.courses) {
        const i = d.courses.findIndex((x) => x.id === c.id);
        if (since(d.cleared, c.at) || since(d.gone[c.id], c.at) || (i >= 0 && d.courses[i].at >= c.at)) continue;
        const course = { ...c, periods: c.periods.map((p) => ({ ...p, ...(!p.tz && (b.tz || d.tz) && { tz: b.tz || d.tz }) })) };
        delete d.gone[c.id];
        if (i < 0) d.courses.push(course); else d.courses[i] = course;
      }
      for (const [id, at] of Object.entries(b.gone)) if (at > (d.gone[id] || 0) && !(d.courses.find((x) => x.id === id)?.at > at)) { d.gone[id] = at; d.courses = d.courses.filter((x) => x.id !== id); }
      if (b.cleared > d.cleared) { d.cleared = b.cleared; d.courses = d.courses.filter((x) => x.at > b.cleared); }
      d.tz ||= b.tz;
      if (d.courses.length > C.MAX.courses) return { ok: false, error: 'classes' };
      const next = C.clean(d);
      if (JSON.stringify(next) !== JSON.stringify(C.clean(here[k]))) patch[k] = next;
    }
    // GPA past terms: each term by when it last changed, against removals and Clear (lib/gpa.js change); a goal set here stays.
    for (const [k, v] of Object.entries(parts.gpa)) {
      const d = G.clean(here[k]), b = G.clean(v), cl = Math.max(d.cl || 0, b.cl || 0), gone = { ...d.d };
      for (const [id, at] of Object.entries(b.d || {})) gone[id] = Math.max(gone[id] || 0, at);
      const at = (t) => t?.at || 0, keep = (t) => (!cl || at(t) > cl) && !(gone[t.id] >= at(t));
      const terms = d.t.map((t) => { const o = b.t.find((x) => x.id === t.id); return o && at(o) > at(t) ? o : t; }).filter(keep);
      for (const t of b.t) if (!d.t.some((x) => x.id === t.id) && keep(t)) terms.push(t);
      const rec = { t: terms, ...(Object.keys(gone).length && { d: gone }), ...((d.g || b.g) && { g: d.g || b.g }), ...(cl && { cl }) };
      if (terms.length > 40) return { ok: false, error: 'gpa' };
      const next = G.clean(rec);
      if (JSON.stringify(next) !== JSON.stringify(G.clean(here[k]))) patch[k] = next;
    }
    // Widgets: the backup's layout and music link, as a settings restore takes its settings whole.
    if (r.widgets) patch.widgetLayout = W.layout(r.widgets, W.mods(r.widgets));
    // Look favorites: one per code, this device's kept where both have it, newest first.
    if (r.favorites) {
      const mine = H.favorites(here.lookFavorites), theirs = H.favorites(r.favorites).filter((f) => f.code.length <= (1 << 20) && !mine.some((x) => x.code === f.code));
      if (theirs.length) patch.lookFavorites = [...mine, ...theirs].sort((a, b) => (b.at || 0) - (a.at || 0)).slice(0, H.MAX_FAVORITES);
    }
    // Tasks without the settings: as a settings restore takes them (lib/todo.js restore), each account's list whole, and its
    // pet's history joined with what is here (lib/pet.js merge).
    if (parts.tasks) {
      const P = lib('GZ_PET');
      for (const key of petKeys) {
        if (!here[key] && !pets[key]) continue;
        const tk = `todo:${key.slice(4)}`;
        pets[key] = P.merge(here[key], pets[key] ?? here[key], Object.hasOwn(tasks, tk) ? { before: here[tk], after: tasks[tk] } : null);
        if (!pets[key]) return { ok: false, error: 'history' };
      }
      Object.assign(patch, tasks, pets);
    }
    // A Notes account the backup has and this device doesn't: an empty one, for the Notes import to fill.
    for (const k of r.notes || []) if (!Object.hasOwn(here, k)) patch[k] = N.clean();
    // The dictionary: the backup's words this device lacks, ahead of its own, so a full list drops the backup's first.
    if (r.writerWords) {
      const mine = Array.isArray(here.writerWords) ? here.writerWords.filter((w) => typeof w === 'string') : [], low = new Set(mine.map((w) => w.toLowerCase()));
      const theirs = r.writerWords.filter((w) => !low.has(w.toLowerCase()) && low.add(w.toLowerCase()));
      if (theirs.length) patch.writerWords = [...theirs, ...mine].slice(-WORDS.max);
    }
    // Saved sources: each box's list joined with the backup's, one entry per work (lib/writer-sources.js dedupe).
    if (r.sources) {
      const { SR } = await paperLibraries();
      for (const [k, v] of Object.entries(r.sources)) {
        const mine = Array.isArray(here[k]?.sources) ? here[k].sources : [], sources = SR.dedupe([...mine, ...v.sources]);
        if (JSON.stringify(sources) !== JSON.stringify(SR.dedupe(mine))) patch[k] = { sources, at: Math.max(Number.isFinite(here[k]?.at) ? here[k].at : 0, v.at) };
      }
    }
    if (r.papers !== undefined) {
      const { P } = await paperLibraries();
      await P.open({ ...local, set: async (v) => { if (await local.set(v) === false) throw fail('write'); } }).merge(papers);
    }
    return !Object.keys(patch).length || await local.set(patch) ? { ok: true } : { ok: false, error: 'write' };
  };
  // One Notes account from the zip into account `key`, through the worker's Notes import (lib/sessions.js): its files, then
  // its notes five at a time, each kept only where it is newer than what is here. → { done, skipped }.
  const notesIn = async (zip, dir, key, send, step = () => {}) => {
    const N = lib('GZ_NOTES');
    const json = await zip.text(`${dir}notes.json`), raw = parse(json);
    const data = N.parseExport(raw, { site: new URL(key.slice(9)).origin });
    for (const f of data.files) {
      step();
      const owner = data.notes.find((n) => N.refs(n.html).has(f.id));
      if (owner) await send('notesFile', { key, file: { id: f.id, note: owner.id, kind: f.kind, name: f.name, data: N.b64(await zip.bytes(dir + f.path)) } });
    }
    let done = 0, skipped = 0;
    for (let i = 0; i < data.notes.length || i === 0; i += 5) {
      step();
      const r = await send('notesImport', { key, json: JSON.stringify({ format: raw.format, version: raw.version, site: raw.site, folders: data.folders, files: data.files, notes: data.notes.slice(i, i + 5) }) });
      done += r.done || 0; skipped += r.skipped || 0;
    }
    return { done, skipped };
  };

  // Scratch values live in IndexedDB, not a second in-memory copy of every attachment. Nothing in this database is
  // installed data. A worker restart or an abandoned upload is discarded when the next restore begins.
  const scratch = async () => {
    const db = await new Promise((resolve, reject) => {
      const r = indexedDB.open('glaze-backup-staging', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('values');
      r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
    });
    const tx = (mode, fn) => new Promise((resolve, reject) => {
      const t = db.transaction('values', mode), r = fn(t.objectStore('values'));
      let value;
      if (r) r.onsuccess = () => { value = r.result; };
      t.oncomplete = () => resolve(value); t.onerror = t.onabort = () => reject(t.error);
    });
    return { get: (k) => tx('readonly', (s) => s.get(k)), put: (k, v) => tx('readwrite', (s) => s.put(v, k)),
      clear: () => tx('readwrite', (s) => s.clear()), close: () => db.close() };
  };
  // Replay every store's existing restore on overlays first, in the worker's write queue. Only a complete successful
  // replay is committed. The journal holds the old values until all writes succeed, including Notes bodies and keys.
  const atomic = async (steps, env, disk) => {
    const memory = new Map();
    disk ||= { get: async (k) => memory.get(k), put: async (k, v) => { memory.set(k, structuredClone(v)); } };
    const changes = [], areas = {}, databases = {};
    const check = (r) => { if (!r?.ok) throw fail(r?.error || 'write'); return r; };
    for (const name of ['local', 'sync']) {
      const source = env[name], patch = new Map();
      const view = async (keys) => {
        const out = { ...await source.get(keys) };
        for (const [k, v] of patch) if (keys === null || [].concat(keys).includes(k)) { if (v === undefined) delete out[k]; else out[k] = structuredClone(v); }
        return out;
      };
      areas[name] = { get: view, set: async (o) => { for (const [k, v] of Object.entries(o)) patch.set(k, structuredClone(v)); return true; },
        remove: async (ks) => { for (const k of [].concat(ks)) patch.set(k, undefined); return true; } };
      changes.push({ prepare: async () => {
        if (!patch.size) return null;
        const keys = [...patch.keys()], before = await source.get(keys), gone = keys.filter((k) => !Object.hasOwn(before, k));
        const set = Object.fromEntries([...patch].filter(([, v]) => v !== undefined)), remove = keys.filter((k) => patch.get(k) === undefined);
        const write = async (put, del) => {
          if (Object.keys(put).length && await source.set(put) === false) throw fail('write');
          if (del.length && await source.remove(del) === false) throw fail('write');
        };
        return { put: () => write(set, remove), undo: () => write(before, gone) };
      } });
    }
    for (const name of ['notes', 'shares']) {
      const source = env[name], patch = new Map();
      if (!source) continue;
      const label = (s, k) => JSON.stringify([name, s, k]);
      const get = async (s, k) => patch.has(label(s, k)) ? (await disk.get(label(s, k)))?.value : source.get(s, k);
      const keys = async (s, prefix = '') => {
        const set = new Set(await source.keys(s, prefix));
        for (const [id, x] of patch) if (x.s === s && x.k.startsWith(prefix)) { if (x.gone) set.delete(x.k); else set.add(x.k); }
        return [...set];
      };
      const put = async (s, k, v, gone = false) => {
        const id = label(s, k);
        await disk.put(id, { value: v }); patch.set(id, { s, k, gone });
      };
      databases[name] = { get, put, del: async (s, ks) => { for (const k of [].concat(ks)) await put(s, k, undefined, true); }, keys,
        scan: async (s, p) => Promise.all((await keys(s, p)).map(async (k) => [k, await get(s, k)])),
        all: async (s) => Promise.all((await keys(s)).map((k) => get(s, k))), estimate: () => source.estimate?.() };
      // Database records first; the local indexes and sync preferences are published only once their bytes are in place.
      changes.unshift({ prepare: async () => {
        const entries = [...patch], attempted = [];
        for (const [id, { s, k }] of entries) await disk.put(`before:${id}`, { value: await source.get(s, k) });
        return {
          put: async () => { for (const [id, { s, k, gone }] of entries) { attempted.push([id, s, k]); if (gone) await source.del(s, [k]); else await source.put(s, k, (await disk.get(id)).value); } },
          undo: async () => { for (const [id, s, k] of attempted.reverse()) { const v = (await disk.get(`before:${id}`)).value; if (v === undefined) await source.del(s, [k]); else await source.put(s, k, v); } },
        };
      } });
    }
    let session, skipped = 0;
    try {
      for await (const { action, value } of steps) {
        if (action === 'own') check(await apply(value, areas));
        else if (action === 'settings') check(await env.settings(value, areas));
        else if (action === 'send') {
          if (!['notesFile', 'notesImport', 'importKeys'].includes(value.op)) throw fail('bad');
          session ||= env.sessions({ ...areas, notes: databases.notes, db: databases.shares });
          const r = check(await session.handle(value)); skipped += r.skipped || 0;
        } else throw fail('bad');
      }
      const commits = [];
      for (const c of changes) { const ready = await c.prepare(); if (ready) commits.push(ready); }
      const attempted = [];
      try {
        for (const c of commits) { attempted.push(c); await c.put(); }
      } catch (e) {
        let undone = true;
        for (const c of attempted.reverse()) try { await c.undo(); } catch { undone = false; }
        return { ok: false, error: e.why || 'write', undone };
      }
      return { ok: true, skipped };
    } catch (e) { return { ok: false, error: e.why || e.message || 'bad' }; }
    finally { session?.stop(); }
  };

  // Upload only the selected categories through begin/own/settings/send. finish replays them on the worker's overlays
  // and commits them together; abort always clears the scratch upload. Old Notes ZIPs require an explicit account.
  const restore = async (plan, ticked, io, account = '') => {
    const c = plan.cats, on = (k) => ticked.has(k) && c[k] !== undefined;
    const out = { failed: [], changed: false, skipped: 0 };
    const notes = on('notes') ? c.notes.map((n) => ({ ...n, account: n.account || account })).filter((n) => ACCOUNT.test(n.account)) : [];
    if (on('notes') && notes.length !== c.notes.length) return { ...out, failed: CATS.filter(on) };
    const favorites = on('settings') && Array.isArray(c.settings.favorites) && c.settings.favorites.length ? c.settings.favorites : null;
    const own = { ...Object.fromEntries(['dashNotes', 'classes', 'gpa', 'widgets', 'writerWords', 'sources'].filter(on).map((k) => [k, c[k]])),
      ...(favorites && { favorites }), ...(on('tasks') && !on('settings') && { tasks: c.tasks }), ...(notes.length && plan.kind === 'backup' && { notes: notes.map((n) => n.account) }) };
    try {
      await io.begin();
      if (Object.keys(own).length && !(await Promise.resolve().then(() => io.own(own)).catch(() => null))?.ok) return { ...out, failed: CATS.filter(on) };
      out.changed = Object.keys(own).length > 0;
      if (on('papers')) for (const [key, value] of Object.entries(c.papers)) {
        if (!(await io.own({ papers: { [key]: value } }))?.ok) return { ...out, failed: CATS.filter(on) };
        out.changed = true;
      }
      if (on('settings')) {
        const { favorites: _, ...settings } = c.settings;
        const r = await Promise.resolve().then(() => io.settings(on('tasks') ? { ...settings, ...c.tasks } : settings)).catch(() => ({ ok: false }));
        if (r.ok) out.changed = true; else out.failed.push('settings', ...(on('tasks') ? ['tasks'] : []));
        out.undone = r.undone;
        out.media = r.media;
      }
      if (on('shareKeys')) {
        try { await io.send('importKeys', { keys: c.shareKeys }); out.changed = true; } catch { out.failed.push('shareKeys'); }
      }
      // An old Notes zip goes into an account picked from those here; a backup's accounts are made where missing (apply).
      for (const n of notes) {
        try { out.skipped += (await notesIn(plan.zip, n.dir, n.account, io.send, io.step)).skipped; out.changed = true; } catch { if (!out.failed.includes('notes')) out.failed.push('notes'); }
      }
      if (on('notes') && !notes.length) out.failed.push('notes');
      if (out.failed.length) return { ...out, changed: false };
      const committed = await io.finish();
      if (!committed?.ok) return { ...out, changed: committed?.undone === false, undone: committed?.undone, failed: CATS.filter(on) };
      return { ...out, skipped: committed.skipped || 0 };
    } catch { return { ...out, changed: false, failed: CATS.filter(on) }; }
    finally { await io.abort?.().catch(() => {}); }
  };

  return { atomic, scratch, FORMAT, VERSION, MANIFEST, KEYS, LIMIT, CATS, STORES, ACCOUNT, KINDS, parse, read, notesOut, pack, fileName, apply, notesIn, restore };
})();

if (typeof module !== 'undefined') module.exports = GZ_BACKUP;
