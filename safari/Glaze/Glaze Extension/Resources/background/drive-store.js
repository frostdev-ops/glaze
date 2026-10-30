// Sync to Google Drive, beyond Documents: Glaze's own data kept in the Glaze folder's Data folder, one file a record, and a
// daily snapshot (the Back up… zip) in its Backups folder, the newest 5 kept. Run by documents/drive-sync.js (its more hooks:
// the same runs, page token, account, locks and backoff) in the worker. A record is one stored key of what Back up… covers
// (background/backup.js): every Settings key (storage.sync), and on this device (storage.local) Better To Do's tasks and the
// pet, dashboard notes, class schedules, GPA past terms, widgets, Looks history and favorites, the personal dictionary and
// saved sources. Never: AI keys and connections (the worker's IndexedDB), Agents' pairing, caches of what a school showed,
// session data, or anything Back up… leaves out. Not yet: Notes and share keys (their own databases), which Back up… still
// carries.
// A record's file: { glaze: 'record', v: 1, cat, area, key, at, value } or, once deleted, { …, deleted: true } (a tombstone:
// the file stays). appProperties { glaze: 'rec', cat, key: h (32 hex of the SHA-256 of area and key), sum, at }. sum: the
// SHA-256 of { area, key, value | deleted }, as with documents: each side's change is told by content, Glaze's own uploads
// come back as no news. at: when it changed on the device that wrote it (this device's stamps: storage.local
// driveSyncStamps, set by the worker as each key changes).
// The rules: changed on one side, that side's goes to the other. Changed on both: the later change wins (last writer, by
// at), per key, Settings key by key. First meeting (a second device connecting, or Sync turned on again): a key on one side
// only is taken by the other; on both, the same is linked, Settings take the later change, and every other record is
// joined by Restore's own rules (background/backup.js apply: newer dashboard note, each class and term by its time, words
// and favorites together…), so a device's own data is never wiped by connecting. A deleted key is a tombstone that deletes
// it on the other side; a tombstone never deletes a record met for the first time.
// State: driveSyncRec:<h> { area, key, cat, id, lsum, rsum, at, seen } and driveSyncFile:<id> 'r:<h>'; the folders and the
// last snapshot on driveSync (data, backups, snap).
// Classic script for the worker; module.exports for node.
var GZ_DRIVE_STORE = globalThis.GZ_DRIVE_STORE || (() => {
  const REC = 'driveSyncRec:', FILE = 'driveSyncFile:', STAMPS = 'driveSyncStamps', STATE = 'driveSync';
  const FOLDER = 'application/vnd.google-apps.folder', JSON_TYPE = 'application/json', ZIP = 'application/zip';
  const HASH = /^[0-9a-f]{32}$/, SUM = /^[0-9a-f]{64}$/;
  const SNAP = { every: 864e5, keep: 5 };
  const MAX = 16 << 20;
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
    { cat: 'settings', area: 'sync', test: () => true },
  ];
  const catOf = (area, key) => (typeof key === 'string' && key.length <= 3000 ? CATS.find((c) => c.area === area && c.test(key))?.cat || null : null);
  const canon = (v) => JSON.stringify(v, (_, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, x[k]])) : x));
  class Fail extends Error { constructor(why) { super(why); this.why = why; } }
  // Each store's library as the worker loaded it, or node's.
  const L = {
    todo: () => (typeof GZ_TODO !== 'undefined' ? GZ_TODO : require('../planner/todo.js')), pet: () => (typeof GZ_PET !== 'undefined' ? GZ_PET : require('../pet/pet.js')),
    widgets: () => (typeof GZ_WIDGETS !== 'undefined' ? GZ_WIDGETS : require('../core/widgets.js')), classes: () => (typeof GZ_CLASSES !== 'undefined' ? GZ_CLASSES : require('../planner/classes.js')),
    gpa: () => (typeof GZ_GPA !== 'undefined' ? GZ_GPA : require('../planner/gpa.js')), history: () => (typeof GZ_HISTORY !== 'undefined' ? GZ_HISTORY : require('../looks/history.js')),
    sanitize: () => (typeof GZ_SANITIZE !== 'undefined' ? GZ_SANITIZE : require('../content/defaults.js').GZ_SANITIZE),
    backup: () => (typeof GZ_BACKUP !== 'undefined' ? GZ_BACKUP : require('./backup.js')),
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
  const join = async (cat, key, value, local) => {
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
    if (!out?.ok) throw new Fail('stale');
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
    const restamp = (patch) => { const p = turn.then(async () => { await S.set({ [STAMPS]: { ...(await stamps()), ...patch } }); }); turn = p.catch(() => {}); return p; };
    const valueOf = async (area, key) => (await env.area(area).get(key))[key];
    const put = async (h, r, was) => {
      await S.set({ [REC + h]: r, ...(r.id && { [FILE + r.id]: `r:${h}` }) });
      if (was?.id && was.id !== r.id) await S.remove(FILE + was.id);
    };

    // A key changed here (the worker's storage listener, while Sync is on): its time, unless it is this layer's own write.
    const stamp = async (changes, area) => {
      const at = now(), mine = {};
      for (const [key, c] of Object.entries(changes)) {
        if (!catOf(area, key)) continue;
        const id = `${area}:${key}`;
        if (applying.has(id) && applying.get(id) === canon(c.newValue ?? null)) { applying.delete(id); continue; }
        mine[id] = at;
      }
      if (!Object.keys(mine).length) return;
      await restamp(mine);
    };

    // The folders inside Glaze: Data and Backups, found by their tag, else made.
    const sub = async (ctx, tag, name) => {
      const st = (await S.get(STATE))[STATE] || {};
      if (st[tag]) {
        try { const f = await ctx.D((c) => c.file(st[tag])); if (!f.trashed && (f.parents || []).includes(ctx.folder)) return st[tag]; } catch (e) { if (e.why !== 'missing') throw e; }
      }
      const r = await ctx.D((c) => c.find(`'${ctx.folder}' in parents and mimeType='${FOLDER}' and appProperties has { key='glaze' and value='${tag}' } and trashed=false`, { pageSize: 10 }));
      const f = r.files.sort((a, b) => (a.id < b.id ? -1 : 1))[0] || await ctx.D((c) => c.folder({ name, mimeType: FOLDER, parents: [ctx.folder], appProperties: { glaze: tag } }));
      await ctx.state({ [tag]: f.id });
      return f.id;
    };

    const fetchRec = async (ctx, R, h) => {
      const bytes = await ctx.D((c) => c.media(R.id, MAX));
      let j;
      try { j = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new Fail('bad'); }
      if (j?.glaze !== 'record' || j.v !== 1 || !['local', 'sync'].includes(j.area) || catOf(j.area, j.key) !== j.cat || (await hk(j.area, j.key)) !== h
        || !Number.isFinite(j.at) || (j.deleted !== true && j.value === undefined)) throw new Fail('bad');
      const value = j.deleted === true ? undefined : (env.clean || clean)(j.cat, j.key, j.value);
      if (j.deleted !== true && value === undefined) throw new Fail('bad');
      return { area: j.area, key: j.key, cat: j.cat, at: j.at, value, sum: R.appProperties?.sum };
    };
    // Drive's value here: written (or removed, for a tombstone) as this layer's own, at its time.
    const take = async (h, got, R, was, expected) => {
      const a = env.area(got.area), id = `${got.area}:${got.key}`;
      applying.set(id, canon(got.value ?? null));
      try {
        if (!await a.replace(got.key, expected, got.value)) throw new Fail('stale');
      } catch (e) { applying.delete(id); throw e; }
      await restamp({ [id]: got.at });
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
      const was = await recOf(h);
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
      const cat = catOf(area, key);
      if (!cat) return;
      const value = await valueOf(area, key), lsum = await sumOf(area, key, value), at = st[`${area}:${key}`] || 0;
      if (!was) {
        if (!R || R.removed) { if (value !== undefined) await push(ctx, h, area, key, cat, null, at || now()); return; }
        const got = await fetchRec(ctx, R, h);
        if (got.sum === lsum) return put(h, { area, key, cat, id: R.id, lsum, rsum: got.sum, at: got.at, seen: Math.max(at, got.at) }, null);
        if (value === undefined) { if (got.value !== undefined) await take(h, got, R, null, value); else await put(h, { area, key, cat, id: R.id, lsum, rsum: got.sum, at: got.at, seen: got.at }, null); return; }
        if (got.value === undefined) return push(ctx, h, area, key, cat, { id: R.id }, Math.max(at, got.at + 1) || now());
        // First meeting, both hold it: Settings by time; the rest joined as Restore joins.
        if (cat === 'settings') { if (got.at > at) return take(h, got, R, null, value); return push(ctx, h, area, key, cat, { id: R.id }, at || now()); }
        applying.delete(`${area}:${key}`);
        await (env.join || ((c, k, v) => join(c, k, v, env.area('local'))))(cat, key, got.value);
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
      try { await one(ctx, h, x); } catch (e) {
        if (e?.why === 'bad' || e?.why === 'size' || e?.why === 'denied') { console.warn('Sync to Google Drive: passed over a record', h, e.why); return; }
        throw e;
      }
    };
    const locals = async () => {
      const out = [];
      for (const area of ['sync', 'local']) {
        const keys = (await env.area(area).keys()).filter((k) => catOf(area, k));
        for (const key of keys) out.push({ area, key });
      }
      return out;
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
        await each(ctx, h, { area, key, R: !was?.id ? R : R?.id === was.id ? R : undefined });
      }
      for (const [h, R] of remote) if (!seen.has(h)) { seen.add(h); await each(ctx, h, { R }); }
      for (const k of (await S.keys()).filter((x) => x.startsWith(REC))) if (!seen.has(k.slice(REC.length))) await each(ctx, k.slice(REC.length), {});
      await snapshot(ctx);
    };
    // A page of Drive's changes: the record files among them.
    const changes = async (list, ctx) => {
      ctx.data = await sub(ctx, 'data', 'Data');
      for (const c of list) {
        const f = c?.file;
        if (c?.removed || !f) {
          const ref = typeof c?.fileId === 'string' && (await S.get(FILE + c.fileId))[FILE + c.fileId];
          if (typeof ref === 'string' && ref.startsWith('r:')) await each(ctx, ref.slice(2), { R: { removed: true } });
          continue;
        }
        if (f.appProperties?.glaze !== 'rec' || !HASH.test(f.appProperties.key || '') || !(f.parents || []).includes(ctx.data)) continue;
        const was = await recOf(f.appProperties.key);
        if (was?.id && was.id !== f.id) continue;
        await each(ctx, f.appProperties.key, { R: f });
      }
    };
    // What changed here since it was last seen.
    const sweep = async (ctx) => {
      ctx.data = await sub(ctx, 'data', 'Data');
      for (const [id, at] of Object.entries(await stamps())) {
        const cut = id.indexOf(':'), area = id.slice(0, cut), key = id.slice(cut + 1);
        if (!catOf(area, key)) continue;
        const h = await hk(area, key), was = await recOf(h);
        // Times can tie, or a remote device's clock can be ahead of this one. Only unchanged content is settled.
        if (was && (was.seen || 0) >= at && await sumOf(area, key, await valueOf(area, key)) === was.lsum) continue;
        await each(ctx, h, { area, key });
      }
      await snapshot(ctx);
    };
    // The daily snapshot: Back up…'s zip in Backups, the newest SNAP.keep kept, older ones moved to Drive's trash.
    const snapshot = async (ctx) => {
      const st = (await S.get(STATE))[STATE] || {};
      if (st.snap && now() - st.snap < SNAP.every) return;
      const made = await env.snapshot?.();
      if (!made) return;
      const backups = await sub(ctx, 'backups', 'Backups');
      await ctx.D((c) => c.put({ meta: { name: made.name, mimeType: ZIP, parents: [backups], appProperties: { glaze: 'snapshot' } }, mime: ZIP, bytes: made.bytes }));
      await ctx.state({ snap: now() });
      const r = await ctx.D((c) => c.find(`'${backups}' in parents and appProperties has { key='glaze' and value='snapshot' } and trashed=false`, { fields: 'id,name,trashed,appProperties,version', pageSize: 100 }));
      const old = r.files.sort((a, b) => (a.name < b.name ? 1 : a.name > b.name ? -1 : a.id < b.id ? 1 : -1)).slice(SNAP.keep);
      for (const f of old) await ctx.D((c) => c.patch(f.id, { trashed: true }));
    };
    const forget = async () => {
      const keys = (await S.keys()).filter((k) => k.startsWith(REC) || k === STAMPS);
      if (keys.length) await S.remove(keys);
    };
    return { stamp, full, changes, sweep, snapshot, forget, catOf };
  };

  return { REC, FILE, STAMPS, CATS, SNAP, catOf, canon, clean, join, create };
})();
if (typeof module !== 'undefined') module.exports = GZ_DRIVE_STORE;
