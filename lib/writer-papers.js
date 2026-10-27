// Glaze Writer's papers: one per assignment, on this device, keyed by school, student, course and assignment, with its
// versions and the student's own format presets. In chrome.storage.local (the manifest's unlimitedStorage lifts its
// quota), which the editor frame (an extension page inside the LMS) and papers.html (a tab of its own) both see as the
// same store, where a framed page's IndexedDB can be partitioned by the site around it. A version is taken on submit,
// before an import or a restore, before a big edit, and every 10 minutes of writing; versions are capped by count and
// size, keeping the last submitted one.
// Classic script; module.exports for node.
var GZ_WRITER_PAPERS = globalThis.GZ_WRITER_PAPERS || (() => {
  const INDEX = 'writerPapers', PAPER = 'writerPaper:', VERSIONS = 'writerVersions:', PRESETS = 'writerPresets:';
  const CAP = { versions: 40, bytes: 4e6, every: 10 * 60e3, words: 100, share: 0.15, presets: 20 };
  const ID = /^_\d+_\d+$/, HOST = /^[a-z0-9.-]{1,253}(:\d{1,5})?$/i;
  // A paper's key, or null unless every part is real: the school's host, and Ultra's ids for the student, course and
  // assignment.
  const keyOf = (k = {}) => (HOST.test(k.school || '') && ID.test(k.user || '') && ID.test(k.course || '') && ID.test(k.content || '') ? `${k.school.toLowerCase()}|${k.user}|${k.course}|${k.content}` : null);
  const scopeOf = (k = {}) => (HOST.test(k.school || '') && ID.test(k.user || '') ? `${k.school.toLowerCase()}|${k.user}` : null);
  // A document's text size from its JSON: characters and words.
  const measure = (doc) => {
    let text = '';
    const walk = (n) => { if (typeof n?.text === 'string') text += n.text; else if (Array.isArray(n?.content)) { for (const c of n.content) walk(c); text += ' '; } };
    walk(doc);
    return { chars: text.replace(/\s+/g, ' ').trim().length, words: text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length };
  };
  const bytes = (v) => new TextEncoder().encode(JSON.stringify(v)).length;
  const queues = new WeakMap();

  // store: chrome.storage.local's get/set/remove (promises); now: the clock (tests pin it).
  const open = (store, now = () => Date.now()) => {
    if (!store && globalThis.chrome?.runtime?.sendMessage) {
      const local = open(chrome.storage.local, now), seen = new Map();
      const send = async (op, args) => {
        const r = await chrome.runtime.sendMessage({ type: 'glaze:writerPapers', op, args });
        if (!r?.ok) throw new Error(r?.error || 'paper storage unavailable');
        if (r.value?.paper) seen.set(args[0], r.value.paper.revision);
        return r.value;
      };
      return { ...local, get: async (k) => { const p = await local.get(k); seen.set(k, p?.revision || 0); return p; },
        save: (k, patch, options = {}) => send('save', [k, patch, { ...options, base: seen.get(k) }]),
        restore: (k, id) => send('restore', [k, id]), remove: (k) => send('remove', [k]),
        savePreset: (scope, p) => send('savePreset', [scope, p]), removePreset: (scope, id) => send('removePreset', [scope, id]) };
    }
    store ||= globalThis.chrome?.storage?.local;
    const get = async (k) => (await store.get(k))[k];
    // The worker owns browser writes, including the index shared by every paper.
    const seen = new Map();
    const serial = (_k, fn) => { const p = (queues.get(store) || Promise.resolve()).then(fn, fn); queues.set(store, p.catch(() => {})); return p; };

    const versionsOf = async (k) => (Array.isArray(await get(VERSIONS + k)) ? await get(VERSIONS + k) : []);
    // Newest first, within the caps; the newest submitted version always stays.
    const cap = (list) => {
      const keep = [...list].sort((a, b) => b.at - a.at);
      const submitted = keep.find((v) => v.reason === 'submit');
      let total = keep.reduce((n, v) => n + v.bytes, 0);
      for (let i = keep.length - 1; i >= 0 && (keep.length > CAP.versions || total > CAP.bytes); i--) {
        if (keep[i] === submitted || i === 0) continue;
        total -= keep[i].bytes;
        keep.splice(i, 1);
      }
      return keep;
    };
    const snapshot = (paper, reason, at) => {
      const doc = paper.doc, m = measure(doc);
      return { format: paper.format, id: `${at.toString(36)}-${Math.random().toString(36).slice(2, 8)}`, at, reason, words: m.words, bytes: bytes(doc), doc };
    };
    const addVersion = async (k, v) => { const list = cap([v, ...(await versionsOf(k))]); await store.set({ [VERSIONS + k]: list }); return v; };
    const index = async (paper) => {
      const list = (await get(INDEX)) || [];
      const row = { key: paper.key, title: paper.title || '', course: paper.courseName || '', url: paper.url || '', words: paper.words || 0, format: paper.format, updated: paper.updated, submitted: paper.submitted || null };
      await store.set({ [INDEX]: [row, ...list.filter((r) => r.key !== paper.key)].slice(0, 2000) });
    };

    // Saves the paper under k, merging patch into what's stored. reason: 'auto' (the default: autosave), 'submit',
    // 'import' or 'restore' (the doc before it is kept), 'format'. → { paper, version }.
    const save = (k, patch = {}, { reason = 'auto', base = seen.get(k) } = {}) => serial(k, async () => {
      if (typeof k !== 'string' || !k) throw new Error('no paper key');
      const prev = (await get(PAPER + k)) || null, t = now();
      const paper = { ...(prev || { key: k, created: t }), ...patch, key: k, updated: t, revision: (prev?.revision || 0) + 1 };
      if (patch.doc) paper.words = patch.words ?? measure(patch.doc).words;
      let version = null;
      const last = paper.lastVersion || 0;
      if (reason === 'submit') { version = await addVersion(k, snapshot(paper, 'submit', t)); paper.submitted = t; }
      else if (prev?.doc && patch.doc && base != null && base !== (prev.revision || 0) && JSON.stringify(prev.doc) !== JSON.stringify(patch.doc)) version = await addVersion(k, snapshot(prev, 'conflict', t));
      else if ((reason === 'import' || reason === 'restore' || reason === 'format') && prev?.doc) version = await addVersion(k, snapshot(prev, reason, t));
      else if (prev?.doc && patch.doc) {
        const a = measure(prev.doc), b = measure(patch.doc);
        const big = Math.abs(a.words - b.words) >= CAP.words || Math.abs(a.chars - b.chars) >= CAP.share * Math.max(a.chars, b.chars, 500);
        if (big) version = await addVersion(k, snapshot(prev, 'edit', t));
        else if (t - last >= CAP.every && JSON.stringify(prev.doc) !== JSON.stringify(patch.doc)) version = await addVersion(k, snapshot(paper, 'auto', t));
      }
      if (!prev && patch.doc) version = await addVersion(k, snapshot(paper, 'start', t));
      if (version) paper.lastVersion = t;
      await store.set({ [PAPER + k]: paper });
      await index(paper);
      seen.set(k, paper.revision);
      return { paper, version };
    });
    const versions = async (k) => (await versionsOf(k)).map(({ doc, ...v }) => v);
    const version = async (k, id) => (await versionsOf(k)).find((v) => v.id === id) || null;
    // The version back as the paper, with what it replaces kept as a version.
    const restore = async (k, id) => {
      const v = await version(k, id);
      if (!v) return null;
      return save(k, { doc: v.doc, words: v.words, ...(v.format != null ? { format: v.format } : {}) }, { reason: 'restore' });
    };
    const list = async () => ((await get(INDEX)) || []).filter((r) => r && typeof r.key === 'string');
    const remove = (k) => serial(k, async () => {
      await store.remove([PAPER + k, VERSIONS + k]);
      await store.set({ [INDEX]: ((await get(INDEX)) || []).filter((r) => r.key !== k) });
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
    const merge = async (records) => {
      for (const [name, value] of Object.entries(records)) {
        if (name.startsWith(PAPER)) {
          const k = name.slice(PAPER.length), prev = await get(name);
          if (!prev || (value.updated || 0) > (prev.updated || 0)) await save(k, value, { reason: 'restore' });
          else if (JSON.stringify(prev.doc) !== JSON.stringify(value.doc)) await addVersion(k, snapshot(value, 'restore', now()));
        } else if (name.startsWith(VERSIONS)) {
          const k = name.slice(VERSIONS.length), here = await versionsOf(k), ids = new Set(here.map((v) => v.id));
          await store.set({ [name]: cap([...here, ...value.filter((v) => !ids.has(v.id))]) });
        } else if (name.startsWith(PRESETS)) {
          const here = await get(name) || [], ids = new Set(here.map((v) => v.id));
          await store.set({ [name]: [...here, ...value.filter((v) => !ids.has(v.id))].slice(0, CAP.presets) });
        }
      }
    };
    const api = { get: (k) => get(PAPER + k).then((p) => { seen.set(k, p?.revision || 0); return p || null; }), save, versions, version, restore, list, remove, presets, savePreset, removePreset, merge };
    if (!store) throw new Error('paper storage unavailable');
    return api;
  };

  return { open, keyOf, scopeOf, measure, CAP, KEYS: { INDEX, PAPER, VERSIONS, PRESETS } };
})();

if (typeof module !== 'undefined') module.exports = GZ_WRITER_PAPERS; else GZ_WRITER_PAPERS;
