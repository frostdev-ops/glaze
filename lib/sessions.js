// Optional extension-side adapters and broker. lib/sharing.js remains the transport/crypto dependency; only this
// module knows Glaze's local data. Nothing is imported until a Sessions surface or an explicit backup asks for it.
var GZ_SESSIONS = globalThis.GZ_SESSIONS || (() => {
  const C = typeof GZ_SHARING !== 'undefined' ? GZ_SHARING : require('./sharing.js');
  const N = typeof GZ_NOTES !== 'undefined' ? GZ_NOTES : require('./notes.js');
  const T = typeof GZ_TODO !== 'undefined' ? GZ_TODO : require('./todo.js');
  const D = typeof GZ_SANITIZE !== 'undefined' ? GZ_SANITIZE : require('../defaults.js').GZ_SANITIZE;
  const L = typeof GZ_SHARE !== 'undefined' ? GZ_SHARE : require('./share.js');
  const LIMIT = { sessions: 20, items: 200, state: 16 << 20, files: 64 << 20, total: 200 << 20 };
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const str = (v, n) => typeof v === 'string' && v.length <= n ? v : undefined;
  const uuid = () => crypto.randomUUID();
  const check = (ok, error = 'storage') => { if (!ok) throw new Error(error); };
  // Registration is the client's public adapter boundary. New carriers can be added here without loading them on LMS pages.
  C.ADAPTERS.collection = {
    fields: ['kind', 'title', 'html', 'file', 'code', 'task', 'plan', 'member'], copy: ['html'],
    clean: async (f, v) => {
      if (f === 'kind') return ['notes', 'look', 'todo'].includes(v) ? v : undefined;
      if (f === 'title') return str(v, N.LIMIT.title);
      if (f === 'html' || f === 'file') return C.ADAPTERS.notes.clean(f, v);
      if (f === 'code') return C.ADAPTERS.look.clean('code', v);
      if (f === 'task') { const x = T.clean({ tasks: [v] }).tasks[0]; return x ? { ...x, cid: '' } : undefined; }
      if (f === 'plan') return T.clean({ tasks: [{ id: 'x', title: 'x' }], items: { 'task:x': v } }).items['task:x'] || {};
      if (f === 'member' && v && str(v.name, 60) !== undefined && Number.isFinite(v.at) && v.at > 0) return { name: v.name, at: v.at, left: v.left === true };
    },
    copyOf: (ent, f, v) => ({ title: (ent.title || '').slice(0, 270) + ' (conflict copy)', html: v }),
  };
  const open = () => new Promise((resolve, reject) => {
    const r = indexedDB.open('glaze-sharing', 1);
    r.onupgradeneeded = () => { r.result.createObjectStore('sessions'); r.result.createObjectStore('files'); };
    r.onerror = () => reject(r.error);
    r.onsuccess = () => { r.result.onversionchange = () => r.result.close(); resolve(r.result); };
  });
  const database = () => {
    let db;
    const tx = async (store, mode, fn) => {
      const d = await (db ||= open().catch((e) => { db = null; throw e; }));
      const t = d.transaction(store, mode), r = fn(t.objectStore(store));
      let value;
      if (r) { r.onsuccess = () => { value = r.result; }; }
      await new Promise((res, rej) => { t.oncomplete = res; t.onerror = t.onabort = () => rej(t.error); });
      return value;
    };
    return { get: (s, k) => tx(s, 'readonly', (o) => o.get(k)), all: (s) => tx(s, 'readonly', (o) => o.getAll()),
      put: (s, k, v) => tx(s, 'readwrite', (o) => o.put(v, k)), del: (s, k) => tx(s, 'readwrite', (o) => o.delete(k)) };
  };
  const make = ({ local, sync, notes, db = database(), enqueue = (f) => f(), fetch, WebSocket, relay = C.SERVER, dev = false, permission = () => chrome.permissions.contains({ origins: [C.SERVER + '/*'] }), now = Date.now, offerLook = async () => false, notify = () => {} }) => {
    let live = null, ctl = new AbortController(), ports = 0, timer = 0, scheduled = false;
    const save = async (r) => { check(JSON.stringify(r).length <= LIMIT.state, 'big'); await db.put('sessions', r.st.sid, r); };
    const all = async () => { const rs = await db.all('sessions'); check(Array.isArray(rs) && rs.length <= LIMIT.sessions, 'big'); return rs; };
    const enabled = async () => (await local.get('shareOn')).shareOn === true;
    const allowed = async () => await enabled() && await permission();
    const net = async (...args) => { check(await allowed(), 'off'); return (fetch || globalThis.fetch)(...args); };
    const client = (r) => C.session(r.st, { fetch: net, signal: ctl.signal });
    const keys = async () => (await all()).map((r) => C.exportKeys(r.st));
    const fileKey = (r, id) => `${r.st.sid}/${id}`;
    const cacheFile = async (r, id, f) => {
      const k = fileKey(r, id), had = await db.get('files', k);
      const files = await db.all('files');
      check(files.reduce((n, x) => n + x.bytes.length, 0) - (had?.bytes.length || 0) + f.bytes.length <= LIMIT.total, 'full');
      await db.put('files', k, { ...f, sid: r.st.sid, entity: id });
    };
    const sources = async () => {
      const got = await local.get(null), out = [];
      for (const [key, value] of Object.entries(got)) {
        if (N.KEY.test(key)) {
          const idx = N.clean(value);
          for (const [id, f] of N.folderList(idx)) out.push({ kind: 'notes', key, folder: id, title: f.name });
          for (const [id, n] of N.list(idx)) out.push({ kind: 'notes', key, ids: [id], title: n.title || '…' });
        }
        if (T.STORE_KEY.test(key)) for (const task of T.clean(value).tasks) out.push({ kind: 'todo', key, ids: [task.id], title: task.title });
      }
      return { sources: out.slice(0, 3000), partial: out.length > 3000, accounts: Object.keys(got).filter((k) => N.KEY.test(k) || T.STORE_KEY.test(k)) };
    };
    const readLocal = async (r, c) => {
      const v = c.view(), b = r.bind;
      if (!b || !r.st.seed || r.st.gone) return v;
      const out = Object.fromEntries(Object.entries(v).filter(([id]) => id.startsWith('_m_')));
      out._ = { title: r.title, kind: r.kind };
      if (r.kind === 'look') {
        const s = D(await sync.get(null));
        out.look = { code: await L.encode(s, (await sync.get('cards')).cards) };
      } else if (r.kind === 'notes') {
        const stored = await local.get(b.key); check(Object.hasOwn(stored, b.key));
        const idx = N.clean(stored[b.key]);
        if (b.folder) {
          r.title = idx.folders[b.folder]?.name || r.title;
          out._.title = r.title;
          for (const [id, n] of N.list(idx)) if (n.folder === b.folder && !b.detached?.includes(id) && !Object.values(b.map).includes(id)) b.map[id] = id;
        }
        check(Object.keys(b.map).length <= LIMIT.items, 'big');
        let bytes = 0, text = 0;
        for (const [entity, id] of Object.entries(b.map)) {
          const n = idx.notes[id];
          if (!n || n.del) continue;
          const body = await N.run({ key: b.key, op: 'load', id }, { local }, notes); check(body.ok);
          text += body.html.length; check(text <= LIMIT.state / 2, 'big');
          const inverse = Object.fromEntries(Object.entries(b.files || {}).map(([k, v]) => [v, k]));
          out[entity] = { title: n.title, html: body.html.replace(/data-gz-file="([0-9a-f-]{36})"/g, (m, id) => inverse[id] ? `data-gz-file="${inverse[id]}"` : m) };
          for (const fid of N.refs(body.html)) {
            const canonical = inverse[fid] || fid; b.files ||= {}; b.files[canonical] = fid;
            const e = `f_${canonical}`, f = await N.run({ key: b.key, op: 'getFile', id: fid }, { local }, notes); check(f.ok);
            const data = N.unb64(f.data); bytes += data.length; check(bytes <= LIMIT.files, 'full');
            const old = await db.get('files', fileKey(r, e));
            if (!old) await cacheFile(r, e, { bytes: data, name: f.name, type: f.type, kind: f.kind, note: entity });
            // Files are immutable in Notes. An upload is done once, before its reference is published.
            let ref = v[e]?.file || old?.ref;
            if (!ref) ref = { ...await c.put(data), n: f.name, t: f.type };
            const kept = await db.get('files', fileKey(r, e));
            if (!v[e]?.file && kept.ref?.h !== ref.h) await db.put('files', fileKey(r, e), { ...kept, ref });
            if (!v[e]?.file) { b.hashes ||= {}; b.hashes[canonical] = ref.h; }
            out[e] = { file: ref };
          }
        }
      } else {
        const stored = await local.get(b.key); check(Object.hasOwn(stored, b.key));
        const d = T.clean(stored[b.key]);
        for (const [entity, id] of Object.entries(b.map)) {
          const task = d.tasks.find((x) => x.id === id);
          if (task) out[entity] = { task: { ...task, id: entity, cid: '' }, plan: d.items[`task:${id}`] || {} };
        }
      }
      check(Object.keys(out).length <= LIMIT.items * 3, 'big');
      return out;
    };
    const keepFiles = async (r, c) => {
      let bytes = 0;
      for (const [id, v] of Object.entries(c.view())) if (v.file) {
        bytes += v.file.s; check(bytes <= LIMIT.files, 'full');
        const kept = await db.get('files', fileKey(r, id));
        if (!kept || kept.ref?.h !== v.file.h) {
          const bytes = await c.get(v.file);
          await cacheFile(r, id, { bytes, ref: v.file, name: v.file.n, type: v.file.t, kind: N.imageType(bytes) && bytes.length <= N.LIMIT.image ? 'image' : 'file' });
        }
      }
    };
    const apply = async (r, c) => {
      const b = r.bind, v = c.view();
      if (!b || r.kind === 'look') return; // Following a Look never applies it.
      for (const id of Object.keys(b.map)) if (!v[id]) { b.detached ||= []; b.detached.push(b.map[id]); delete b.map[id]; }
      if (r.kind === 'todo') {
        const stored = await local.get(b.key); check(Object.hasOwn(stored, b.key));
        const d = T.clean(stored[b.key]);
        for (const [e, x] of Object.entries(v)) if (x.task) {
          b.map[e] ||= uuid();
          const id = b.map[e];
          const task = { ...x.task, id, cid: '' };
          d.tasks = [...d.tasks.filter((t) => t.id !== id), task]; d.items[`task:${id}`] = x.plan || {};
        }
        // Removing an item in the shared list keeps the last local copy.
        if (!same(T.clean(stored[b.key]), T.clean(d))) check(await local.set({ [b.key]: T.clean(d) }));
      } else {
        const stored = await local.get(b.key); check(Object.hasOwn(stored, b.key));
        let idx = N.clean(stored[b.key]);
        if (!b.folder) { b.folder = uuid(); check((await N.run({ key: b.key, op: 'folder', id: b.folder, name: r.title }, { local }, notes)).ok); }
        for (const [e, x] of Object.entries(v)) if (typeof x.html === 'string') {
          b.map[e] ||= uuid();
          const id = b.map[e];
          const remap = {};
          for (const fid of N.refs(x.html)) {
            const f = await db.get('files', fileKey(r, `f_${fid}`));
            if (!f) continue;
            b.files ||= {}; b.hashes ||= {};
            if (!b.files[fid] || b.hashes[fid] !== f.ref?.h) b.files[fid] = uuid();
            b.hashes[fid] = f.ref?.h; remap[fid] = b.files[fid];
            check((await N.run({ key: b.key, op: 'file', id: remap[fid], note: id, name: f.name, kind: f.kind, data: N.b64(f.bytes) }, { local }, notes)).ok);
          }
          const html = N.sanitize(x.html.replace(/data-gz-file="([0-9a-f-]{36})"/g, (m, f) => remap[f] ? `data-gz-file="${remap[f]}"` : m));
          const had = idx.notes[id];
          const body = had && await N.run({ key: b.key, op: 'load', id }, { local }, notes);
          if (!had || body?.html !== html) {
            check((await N.run({ key: b.key, op: 'save', id, base: had?.rev || 0, sid: uuid(), copy: uuid(), title: x.title, folder: b.folder, html }, { local }, notes)).ok);
          }
          if (had && had.title !== x.title) check((await N.run({ key: b.key, op: 'meta', id, title: x.title, at: now() }, { local }, notes)).ok);
        }
      }
    };
    const update = async (r, { upload = false } = {}) => {
      if (r.st.gone || !await allowed()) return;
      const c = client(r);
      try {
        if (r.st.seed && r.st.type && now() - (c.view()[`_m_${r.st.actor}`]?.member?.at || 0) >= 60000) {
          const v = c.view(); v[`_m_${r.st.actor}`] = { member: { name: r.name || '…', at: now() } };
          await c.edit(v); await save(r);
        }
        // Persist edits before sending. Failed local reads never turn into an empty shared view.
        if (r.bind && r.st.seed) { const e = await c.edit(await readLocal(r, c)); check(!e.big.length, 'big'); await save(r); }
        const result = await c.sync();
        check(Object.keys(c.view()).length <= LIMIT.items * 3, 'big');
        r.kind ||= c.view()._?.kind;
        r.title = c.view()._?.title || r.title;
        if (upload && r.st.seed) {
          const v = c.view();
          for (const [id, x] of Object.entries(v)) if (x.file) {
            const f = await db.get('files', fileKey(r, id)); check(f, 'missing');
            v[id] = { file: { ...await c.put(f.bytes), n: f.name, t: f.type } };
            await db.put('files', fileKey(r, id), { ...f, ref: v[id].file });
          }
          await c.edit(v); await save(r); await c.sync();
        }
        await keepFiles(r, c);
        // Persist received data before touching the local apps. Reopening retries a failed apply.
        r.status = result.gone ? 'gone' : result.more || result.bad ? 'incomplete' : 'live';
        r.at = now(); await save(r); await apply(r, c); await save(r);
      } catch (e) { r.status = 'offline'; r.error = ['big', 'full', 'missing', 'storage', 'off'].includes(e.message) ? e.message : 'network'; await save(r); }
      notify();
    };
    const stop = () => { live?.close(); live = null; clearTimeout(timer); ctl.abort(); ctl = new AbortController(); };
    const refresh = async () => {
      stop();
      if (!ports || !await allowed()) return;
      const rs = await all();
      for (const r of rs) await update(r);
      const sids = rs.filter((r) => !r.st.gone).map((r) => r.st.sid);
      if (ports && sids.length && await allowed()) live = C.live(relay, sids, (m) => enqueue(async () => {
        if (!ports || !await allowed()) return;
        const r = await db.get('sessions', m.s); if (r) await update(r);
      }).catch(() => {}), { WebSocket });
      // Presence is a last-seen device list, not an account identity or an access-control list.
      timer = setTimeout(() => enqueue(refresh).catch(() => {}), 60000);
    };
    const brief = (r) => ({ sid: r.st.sid, title: r.title, kind: r.kind, edit: !!r.st.seed, creator: !!r.st.del, expire: !!r.st.expire,
      status: r.st.gone ? 'gone' : r.st.pending.length ? 'pending' : r.status || 'offline', error: r.error, at: r.at || 0, bound: !!r.bind,
      members: Object.values(C.view(r.st)).filter((x) => x.member).map((x) => x.member).slice(0, LIMIT.items),
      items: Object.entries(C.view(r.st)).filter(([, v]) => v.html !== undefined || v.task || v.code).map(([id, v]) => ({ id, title: v.title || v.task?.title || r.title })) });
    const handle = async (m) => {
      if (m.op === 'notesRead' || m.op === 'notesGetFile') {
        check(N.KEY.test(m.key) && Object.hasOwn(await local.get(m.key), m.key), 'bad');
        return N.run({ key: m.key, op: m.op === 'notesRead' ? 'load' : 'getFile', id: m.id }, { local }, notes);
      }
      if (m.op === 'notesFile' || m.op === 'notesImport') {
        check(N.KEY.test(m.key) && Object.hasOwn(await local.get(m.key), m.key), 'bad');
        if (m.op === 'notesFile') return N.run({ ...m.file, key: m.key, op: 'file' }, { local }, notes);
        check(typeof m.json === 'string' && m.json.length <= (16 << 20), 'big');
        const data = N.parseExport(m.json, { site: new URL(m.key.slice(9)).origin });
        let done = 0, skipped = 0;
        for (let i = 0; i < data.notes.length || i === 0; i += 20) {
          const r = await N.run({ key: m.key, op: 'import', folders: i ? [] : data.folders, notes: data.notes.slice(i, i + 20) }, { local }, notes);
          check(r.ok); done += r.done; skipped += r.skipped;
        }
        return { ok: true, done, skipped };
      }
      if (m.op === 'list') return { ok: true, on: await enabled(), sessions: (await all()).map(brief), ...await sources() };
      if (m.op === 'exportKeys') return { ok: true, keys: await keys() };
      if (m.op === 'importKeys') {
        check(Array.isArray(m.keys) && m.keys.length <= LIMIT.sessions, 'big');
        const records = m.keys.map((x) => C.importKeys(x, dev));
        check(records.every((s) => s && s.server === relay && (s.type === null || s.type === 'collection')), 'bad');
        const rs = await all();
        check(new Set([...rs.map((r) => r.st.sid), ...records.map((s) => s.sid)]).size <= LIMIT.sessions, 'big');
        check(await local.set({ shareOn: false })); stop();
        for (const st of records) if (!rs.some((r) => r.st.sid === st.sid)) await save({ st, title: '…', status: 'offline' });
        return { ok: true };
      }
      if (m.op === 'pause') { check(await local.set({ shareOn: false })); stop(); return { ok: true }; }
      if (m.op === 'resume' || m.op === 'create' || m.op === 'join') {
        check(await permission(), 'permission');
        check(await C.supported(), 'unsupported');
        const rs = await all();
        if (m.op !== 'resume') check(rs.length < LIMIT.sessions, 'many');
        let r;
        if (m.op === 'create') {
          check(['notes', 'todo', 'look'].includes(m.kind) && str(m.title, 80)?.trim(), 'bad');
          if (m.kind !== 'look') {
            check((m.kind === 'notes' ? N.KEY : T.STORE_KEY).test(m.key), 'bad');
            check(Array.isArray(m.ids) && m.ids.length <= LIMIT.items && m.ids.every((x) => m.kind === 'notes' ? N.ID.test(x) : /^[\w-]{1,40}$/.test(x)), 'bad');
            check(m.ids.length || (m.kind === 'notes' && N.ID.test(m.folder)), 'bad');
            const stored = await local.get(m.key); check(Object.hasOwn(stored, m.key));
            if (m.kind === 'notes') {
              const idx = N.clean(stored[m.key]);
              if (m.folder) check(idx.folders[m.folder] && !idx.folders[m.folder].del && N.list(idx).filter(([, n]) => n.folder === m.folder).length <= LIMIT.items, 'bad');
              else check(m.ids.every((id) => idx.notes[id] && !idx.notes[id].del), 'missing');
            } else {
              const ids = new Set(T.clean(stored[m.key]).tasks.map((x) => x.id));
              check(m.ids.every((id) => ids.has(id)), 'missing');
            }
          }
          r = { st: C.create('collection', { server: relay, expire: m.expire === true }), title: m.title.trim(), name: str(m.name, 60) || '…', kind: m.kind,
            bind: { key: m.key, folder: m.folder || '', map: Object.fromEntries((m.ids || []).map((id) => [id, id])), files: {} } };
        } else if (m.op === 'join') {
          check(typeof m.link === 'string' && m.link.length < 200, 'bad');
          const st = C.join(m.link, dev); check(st && st.server === relay, 'bad');
          check(!rs.some((r) => r.st.sid === st.sid), 'duplicate');
          r = { st, title: '…', name: str(m.name, 60) || '…', status: 'offline' };
        }
        if (r) await save(r);
        check(await local.set({ shareOn: true }));
        if (r) {
          const c = client(r);
          if (r.st.seed && r.st.type) { const v = c.view(); v[`_m_${r.st.actor}`] = { member: { name: str(m.name, 60) || '…', at: now() } }; await c.edit(v); await save(r); }
          await update(r);
        }
        await refresh();
        return { ok: true, sid: r?.st.sid };
      }
      const r = typeof m.sid === 'string' && await db.get('sessions', m.sid); check(r, 'missing');
      if (m.op === 'read') return { ok: true, view: C.view(r.st) };
      if (m.op === 'link') return { ok: true, link: await client(r).link(m.edit === true) };
      if (m.op === 'leave') {
        await db.del('sessions', r.st.sid);
        for (const f of await db.all('files')) if (f.sid === r.st.sid) await db.del('files', fileKey(r, f.entity));
        await refresh(); return { ok: true };
      }
      if (m.op === 'attach') {
        check(!r.bind && ['notes', 'todo'].includes(r.kind) && (r.kind === 'notes' ? N.KEY : T.STORE_KEY).test(m.key), 'bad');
        check(Object.hasOwn(await local.get(m.key), m.key), 'bad');
        r.bind = { key: m.key, map: {}, files: {} }; await save(r); await apply(r, client(r));
        if (!r.st.seed) r.bind = null; // View access makes a detached editable copy; the session itself stays read-only.
        await save(r); return { ok: true };
      }
      if (m.op === 'useLook') {
        check(r.kind === 'look', 'bad');
        const code = C.view(r.st).look?.code; check(code, 'bad');
        await L.decode(code); check(await offerLook(code, r.title)); return { ok: true };
      }
      check(await allowed(), 'off');
      if (m.op === 'delete') { await client(r).remove(); r.status = 'gone'; await save(r); }
      else if (m.op === 'expiry') { await client(r).expiry(m.on === true); await save(r); }
      else if (m.op === 'sync' || m.op === 'reupload') await update(r, { upload: m.op === 'reupload' });
      else throw new Error('bad');
      notify(); return { ok: true };
    };
    const backupNotes = async (key) => {
      check(N.KEY.test(key), 'bad');
      const stored = await local.get(key); check(Object.hasOwn(stored, key));
      const idx = N.clean(stored[key]);
      // Contents travel one item at a time: Chrome's message limit is smaller than a full Notes backup.
      return { site: new URL(key.slice(9)).origin, folders: N.folderList(idx).map(([id, f]) => ({ id, ...f })),
        notes: N.list(idx).map(([id, n]) => ({ id, ...n })), files: [], keys: await keys() };
    };
    return { handle, backupNotes, keys, stop, changed: () => { if (!ports || scheduled) return; scheduled = true; enqueue(refresh).catch(() => {}).finally(() => { scheduled = false; }); },
      connect: () => { ports++; enqueue(refresh).catch(() => {}); return () => { ports = Math.max(0, ports - 1); if (!ports) stop(); }; } };
  };
  return { LIMIT, database, make };
})();
if (typeof module !== 'undefined') module.exports = GZ_SESSIONS;
