// Optional extension-side adapters and broker. lib/sharing.js remains the transport/crypto dependency; only this
// module knows Glaze's local data. Nothing is imported until a Sessions surface or an explicit backup asks for it.
var GZ_SESSIONS = globalThis.GZ_SESSIONS || (() => {
  const C = typeof GZ_SHARING !== 'undefined' ? GZ_SHARING : require('./sharing.js');
  const N = typeof GZ_NOTES !== 'undefined' ? GZ_NOTES : require('./notes.js');
  const T = typeof GZ_TODO !== 'undefined' ? GZ_TODO : require('./todo.js');
  const D = typeof GZ_SANITIZE !== 'undefined' ? GZ_SANITIZE : require('../defaults.js').GZ_SANITIZE;
  const L = typeof GZ_SHARE !== 'undefined' ? GZ_SHARE : require('./share.js');
  const P = typeof GZ_XPARTS !== 'undefined' ? GZ_XPARTS : require('./lookparts.js');
  const R = typeof GZ_RELAY !== 'undefined' ? GZ_RELAY : require('./relay.js');
  const media = () => (typeof GZ_MEDIA !== 'undefined' ? GZ_MEDIA : require('./media.js'));
  const LIMIT = { sessions: 20, items: 200, state: 16 << 20, files: 64 << 20, total: 200 << 20 };
  // Presence (a last-seen device list) goes with a change; alone, at most this often.
  const PRESENCE = 5 * 60e3;
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const str = (v, n) => typeof v === 'string' && v.length <= n ? v : undefined;
  const uuid = () => crypto.randomUUID();
  const check = (ok, error = 'storage') => { if (!ok) throw new Error(error); };
  // The ids Glaze makes for what a share carries: a note (a UUID) or a To Do task (a UUID's first 13 characters), the
  // folder (_), a device's presence (_m_ and its 8-character actor), a file (f_ and the id its notes name it by, or
  // media) and a Look. Anything else a member sends is no entity: a name like toString never gets as far as a lookup.
  const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
  // Syllabus imports have deterministic task ids instead of UUIDs (Canvas numeric or Ultra composite course id).
  const TASK_ID = `${UUID}|[0-9a-f]{8}-[0-9a-f]{4}|syl-(?:[0-9]+|_[0-9]+_[0-9]+)-[0-9a-z]{1,7}`;
  const ENTITY = new RegExp(`^(?:${TASK_ID}|_|_m_[0-9a-z]{8}|f_(?:[0-9a-f-]{36}|media)|look)$`);
  const TASK = new RegExp(`^(?:${TASK_ID})$`);
  const FILE = /^[0-9a-f-]{36}$/, REF = /^[\w-]{22}$/;
  // A map keyed by ids that others chose has no prototype to inherit from. Read back from storage it has one again, so a
  // record is rebuilt as it's opened, with the own keys that are ids Glaze makes and nothing else.
  const dict = (o, ok = () => true) => {
    const out = Object.create(null);
    if (o && typeof o === 'object') for (const k of Object.keys(o)) if (ok(k, o[k])) out[k] = o[k];
    return out;
  };
  const str2 = (v, n) => typeof v === 'string' && v.length <= n;
  const load = (r) => {
    if (r?.bind) r.bind = { ...r.bind, map: dict(r.bind.map, (k, v) => ENTITY.test(k) && /^[\w-]{1,64}$/.test(v)),
      ...(r.bind.files !== undefined && { files: dict(r.bind.files, (k, v) => FILE.test(k) && FILE.test(v)) }),
      ...(r.bind.hashes !== undefined && { hashes: dict(r.bind.hashes, (k, v) => FILE.test(k) && str2(v, 2000)) }) };
    if (r?.refs) r.refs = dict(r.refs, (k, v) => REF.test(k) && /^f_(?:[0-9a-f-]{36}|media)$/.test(v));
    return r;
  };
  // Registration is the client's public adapter boundary. New carriers can be added here without loading them on LMS pages.
  C.ADAPTERS.collection = {
    fields: ['kind', 'title', 'html', 'file', 'code', 'task', 'plan', 'member'], copy: ['html'], id: (e) => ENTITY.test(e),
    clean: async (f, v) => {
      if (f === 'kind') return ['notes', 'look', 'todo'].includes(v) ? v : undefined;
      if (f === 'title') return str(v, N.LIMIT.title);
      if (f === 'html' || f === 'file') return C.ADAPTERS.notes.clean(f, v);
      if (f === 'code') return C.ADAPTERS.look.clean('code', v);
      if (f === 'task') { const x = T.clean({ tasks: [v] }).tasks[0]; return x ? { ...x, cid: '' } : undefined; }
      if (f === 'plan') return T.clean({ tasks: [{ id: 'x', title: 'x' }], items: { 'task:x': v } }).items['task:x'] || {};
      if (f === 'member' && v && str(v.name, 60) !== undefined && Number.isFinite(v.at) && v.at > 0) return { name: v.name, at: v.at, left: v.left === true };
    },
    copyOf: (ent, f, v) => C.ADAPTERS.notes.copyOf({ ...ent, title: (ent.title || '').slice(0, 270) }, f, v),
  };
  const open = (closed) => new Promise((resolve, reject) => {
    // `vault` (version 2): keys other features keep out of storage.local, where any page's script can read them. A database
    // made before it has the other two.
    const r = indexedDB.open('glaze-sharing', 2);
    r.onupgradeneeded = () => { for (const name of ['sessions', 'files', 'vault']) if (!r.result.objectStoreNames.contains(name)) r.result.createObjectStore(name); };
    r.onerror = () => reject(r.error);
    r.onsuccess = () => { r.result.onversionchange = () => { r.result.close(); closed(); }; resolve(r.result); };
  });
  const database = () => {
    let db;
    const tx = async (store, mode, fn) => {
      const d = await (db ||= open(() => { db = null; }).catch((e) => { db = null; throw e; }));
      const t = d.transaction(store, mode), r = fn(t.objectStore(store));
      let value;
      if (r) { r.onsuccess = () => { value = r.result; }; }
      await new Promise((res, rej) => { t.oncomplete = res; t.onerror = t.onabort = () => rej(t.error); });
      return value;
    };
    return { get: (s, k) => tx(s, 'readonly', (o) => o.get(k)), all: (s) => tx(s, 'readonly', (o) => o.getAll()),
      put: (s, k, v) => tx(s, 'readwrite', (o) => o.put(v, k)), del: (s, k) => tx(s, 'readwrite', (o) => o.delete(k)) };
  };
  // enqueue: a turn of the storage broker's queue, for reading and writing what other features keep too (Notes, To Do,
  // the Look, media). serial: the sessions' own queue, where the worker runs handle() too: one operation at a time. The
  // relay is asked there, never in a broker turn, so a slow relay holds up sharing alone.
  // keptFiles: the worker's store of files kept for Looks' backgrounds (lib/media.js), which a Look share reads and fills.
  const make = ({ local, sync, notes, keptFiles = null, db = database(), enqueue = (f) => f(), serial = (f) => f(), fetch, WebSocket, relay = C.SERVER, dev = false, permission = (server) => chrome.permissions.contains({ origins: [server + '/*'] }), now = Date.now, offerLook = async () => false, notify = () => {}, healthTimeout = 5000 }) => {
    check(dev || relay === C.SERVER, 'bad');
    let live = new Map(), ctl = new AbortController(), ports = 0, timer = 0, scheduled = false, generation = 0, wanted = new Set(), transfer = null;
    const save = async (r) => { check(JSON.stringify(r).length <= LIMIT.state, 'big'); await db.put('sessions', r.st.sid, r); };
    const all = async () => { const rs = await db.all('sessions'); check(Array.isArray(rs) && rs.length <= LIMIT.sessions, 'big'); return rs.map(load); };
    const record = async (sid) => load(await db.get('sessions', sid));
    const enabled = async () => (await local.get('shareOn')).shareOn === true;
    const hosts = async () => { const v = (await local.get('shareHosts')).shareHosts; return Array.isArray(v) ? v.filter((x) => R.normalize(x) === x).slice(0, LIMIT.sessions) : []; };
    const selected = async () => R.normalize((await sync.get('shareRelay')).shareRelay) || relay;
    const approved = async (server) => server === relay || (await hosts()).includes(server);
    const allowed = async (server) => !!server && R.normalize(server) === server && await enabled() && await approved(server) && await permission(server);
    const net = async (server, url, init) => {
      check(new URL(url).origin === server && await allowed(server) && !init?.signal?.aborted, 'off');
      return (fetch || globalThis.fetch)(url, { ...init, credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer' });
    };
    const client = (r, signal = ctl.signal) => C.session(r.st, { fetch: (url, init) => net(r.st.server, url, init), signal,
      checkpoint: () => { r.st.snapshot = true; return save({ ...r, st: { ...r.st, pending: [] } }); } });
    const health = async (server) => {
      check(server && R.normalize(server) === server, 'bad');
      const mine = generation;
      check(await permission(server), 'permission'); check(mine === generation, 'off');
      const controller = new AbortController(), signal = ctl.signal;
      let timedOut = false;
      const stop = () => controller.abort();
      const timer = setTimeout(() => { timedOut = true; stop(); }, healthTimeout);
      signal.addEventListener('abort', stop, { once: true });
      try {
        const response = await (fetch || globalThis.fetch)(server + '/health', { method: 'GET', credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer', cache: 'no-store', signal: controller.signal });
        if (!response.ok) { await response.body?.cancel(); return { ok: true, result: 'http', status: response.status }; }
        if (Number(response.headers.get('content-length')) > 1024) { await response.body?.cancel(); return { ok: true, result: 'invalid' }; }
        const reader = response.body?.getReader();
        let bytes = new Uint8Array();
        if (reader) for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
          if (bytes.length + chunk.value.length > 1024) { await reader.cancel(); return { ok: true, result: 'invalid' }; }
          const next = new Uint8Array(bytes.length + chunk.value.length); next.set(bytes); next.set(chunk.value, bytes.length); bytes = next;
        }
        let data; try { data = JSON.parse(new TextDecoder().decode(bytes)); } catch {}
        return { ok: true, result: signal.aborted ? 'cancelled' : data?.ok === true ? 'connected' : 'invalid' };
      } catch { return { ok: true, result: timedOut ? 'timeout' : signal.aborted ? 'cancelled' : 'network' }; }
      finally { clearTimeout(timer); signal.removeEventListener('abort', stop); }
    };
    const keys = async () => (await all()).map((r) => C.exportKeys(r.st));
    const fileKey = (r, id) => `${r.st.sid}/${id}`;
    // The bytes kept are counted as they come and go, in a record of their own beside the files (its key has no '/'):
    // adding them up would read up to 200 MiB for every file kept. A write after the file's, or a crash between the two,
    // leaves the count high, never low, so before a file is refused for room it's counted again, once, from what's there.
    const TOTAL = 'total';
    const tally = async () => (await db.all('files')).reduce((n, x) => n + (x?.bytes?.length || 0), 0);
    const cacheFile = async (r, id, f) => {
      const k = fileKey(r, id), had = await db.get('files', k), delta = f.bytes.length - (had?.bytes.length || 0);
      let total = (await db.get('files', TOTAL))?.total;
      if (!Number.isSafeInteger(total) || total < 0 || total + delta > LIMIT.total) total = await tally();
      check(total + delta <= LIMIT.total, 'full');
      // Reserve growth first, release shrinkage only after replacement: a failed smaller write still keeps old bytes.
      await db.put('files', TOTAL, { total: total + Math.max(0, delta) });
      await db.put('files', k, { ...f, sid: r.st.sid, entity: id });
      if (delta < 0) await db.put('files', TOTAL, { total: total + delta });
    };
    // Only the Notes and To Do keys are read, where the browser can name the keys without reading what they hold: the
    // rest of local storage includes the media of a Look (up to 48 MiB), and a share panel asks again after every update.
    const sources = async () => {
      const names = local.getKeys ? await local.getKeys() : null;
      const got = Array.isArray(names) ? await local.get(names.filter((k) => N.KEY.test(k) || T.STORE_KEY.test(k))) : await local.get(null), out = [];
      for (const [key, value] of Object.entries(got)) {
        if (N.KEY.test(key)) {
          const idx = N.clean(value);
          for (const [id, f] of N.folderList(idx)) out.push({ kind: 'notes', key, folder: id, title: f.name });
          for (const [id, n] of N.list(idx)) out.push({ kind: 'notes', key, ids: [id], title: n.title || '…' });
        }
        if (T.STORE_KEY.test(key)) for (const task of T.clean(value).tasks) if (TASK.test(task.id)) out.push({ kind: 'todo', key, ids: [task.id], title: task.title });
      }
      return { sources: out.slice(0, 3000), partial: out.length > 3000, accounts: Object.keys(got).filter((k) => N.KEY.test(k) || T.STORE_KEY.test(k)) };
    };
    // The reference kept beside a file's bytes when they went up, unless the state says its entity was deleted (the file
    // went off the relay with it); and what a file entity of this device points to, if a reference is on hand: the merged
    // state's, or that one.
    const kept = (r, e, old) => (r.st.state[e]?.del?.[0] ? null : old?.ref);
    const known = (r, v, e, old) => v[e]?.file || kept(r, e, old);
    // A file goes up, and its reference is kept beside its bytes to go out with the next batch. Not in a broker turn.
    const send = async (r, c, e, bytes, meta) => {
      const ref = { ...await c.put(bytes), ...meta }, key = fileKey(r, e);
      (r.refs ||= dict())[ref.id] = e;
      await db.put('files', key, { ...await db.get('files', key), ref });
      return ref;
    };
    // In a broker turn. Files not yet up wait in `files` for the caller to send after the text has synced: each answers
    // { e, ref }, the entity to publish and the reference it goes by.
    const readLocal = async (r, c, files) => {
      const v = c.view(), b = r.bind;
      if (!b || !r.st.seed || r.st.gone) return v;
      const out = Object.fromEntries(Object.entries(v).filter(([id]) => id.startsWith('_m_')));
      out._ = { title: r.title, kind: r.kind };
      if (r.kind === 'look') {
        const all = await sync.get(null);
        // The Look as worn here, with its parts (lookX), unless they were saved on another computer.
        const parts = await P.fromStored(all.lookX, local) ?? null;
        out.look = { code: await L.encode(D(all), all.cards, parts) };
        // A media background kept on this computer (`file:<hash>`) goes beside the code as one encrypted file, uploaded once.
        const h = D(all).bg.kind === 'media' ? media().fileOf(parts?.x?.bg?.media?.src) : null;
        if (h) {
          const e = 'f_media', old = await db.get('files', fileKey(r, e));
          const ref = old?.h === h ? kept(r, e, old) : null;
          if (ref) out[e] = { file: ref };
          else {
            const f = keptFiles && await media().read({ local, files: keptFiles }, h);
            if (f && old?.h !== h) await cacheFile(r, e, { bytes: f.bytes, name: 'media', type: f.mime, kind: 'file', h });
            if (f) files.push(async (transport) => ({ e, ref: await send(r, transport, e, f.bytes, { n: 'media', t: f.mime }) }));
          }
        }
      } else if (r.kind === 'notes') {
        const stored = await local.get(b.key); check(Object.hasOwn(stored, b.key));
        const idx = N.clean(stored[b.key]);
        if (b.wholeFolder) {
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
          const inverse = dict(Object.fromEntries(Object.entries(b.files || {}).map(([k, v]) => [v, k])));
          out[entity] = { title: n.title, html: body.html.replace(/data-gz-file="([0-9a-f-]{36})"/g, (m, id) => inverse[id] ? `data-gz-file="${inverse[id]}"` : m) };
          for (const fid of N.refs(body.html)) {
            const canonical = inverse[fid] || fid;
            const e = `f_${canonical}`, f = await N.run({ key: b.key, op: 'getFile', id: fid }, { local }, notes);
            // A file the note names that isn't here (it hasn't come in yet, or was never sent): the note keeps its id, the
            // share keeps the file as it is if it has it, and sync goes on.
            if (!f.ok && f.error === 'gone') { if (v[e]?.file) out[e] = { file: v[e].file }; continue; }
            check(f.ok);
            (b.files ||= dict())[canonical] = fid;
            const data = N.unb64(f.data); bytes += data.length; check(bytes <= LIMIT.files, 'full');
            const old = await db.get('files', fileKey(r, e));
            if (!old) await cacheFile(r, e, { bytes: data, name: f.name, type: f.type, kind: f.kind, note: entity });
            // Files are immutable in Notes. An upload is done once; its reference goes out with the text when it is
            // known, and a file without one is sent after the text has synced, and goes out with the next batch.
            const ref = known(r, v, e, old);
            if (ref) {
              out[e] = { file: ref };
              if (!v[e]?.file) (b.hashes ||= dict())[canonical] = JSON.stringify(ref);
            } else files.push(async (transport) => {
              const sent = await send(r, transport, e, data, { n: f.name, t: f.type });
              (b.hashes ||= dict())[canonical] = JSON.stringify(sent);
              return { e, ref: sent };
            });
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
      return out;
    };
    // What a bound session's apply writes over, as stored: its notes' index entries, or its tasks and their plans.
    const held = async (r) => {
      const b = r.bind;
      if (!b || r.kind === 'look') return '';
      const stored = (await local.get(b.key))[b.key], ids = Object.values(b.map);
      if (r.kind === 'todo') { const d = T.clean(stored); return JSON.stringify(ids.map((id) => [d.tasks.find((x) => x.id === id), d.items[`task:${id}`]])); }
      const idx = N.clean(stored);
      return JSON.stringify(ids.map((id) => idx.notes[id]));
    };
    // What a bound session shares here, in short: what held() reads (a save changes a note's rev), with a whole-folder
    // share's name and notes. A write that leaves it as it was when the session last synced needs no sync of it.
    const mark = async (r) => {
      const b = r.bind;
      if (!b || r.kind === 'look') return null;
      let s = await held(r);
      if (r.kind === 'notes' && b.wholeFolder) {
        const idx = N.clean((await local.get(b.key))[b.key]);
        s += JSON.stringify([idx.folders[b.folder]?.name, Object.keys(idx.notes).filter((id) => idx.notes[id].folder === b.folder && !idx.notes[id].del)]);
      }
      return C.b64(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))));
    };
    // A share whose state grew past what this device keeps waits for an explicit Sync: an automatic one would read it
    // all again, only to fail the same way.
    const stuck = (r) => r.status === 'big' && r.error === 'state';
    // A file failing is about that file when the relay answered it (gone, or not what its reference says, or too big): the
    // ones after it are still tried. A relay that can't be reached, or room that's gone, stops them all.
    const alone = (e) => ['signature', 'file', 'big'].includes(e.message) || e.status === 404;
    // Fetches the files the merged state names that this device doesn't hold, and answers how many came and what went
    // wrong first. After the text has been applied: a file that is slow, or never comes, holds up nothing else.
    const keepFiles = async (r, c, current) => {
      let bytes = 0, fetched = 0, failure = null;
      for (const [id, v] of Object.entries(c.view())) if (v.file) {
        try {
          bytes += v.file.s; check(bytes <= LIMIT.files, 'full');
          const kept = await db.get('files', fileKey(r, id));
          if (!kept || !same(kept.ref, v.file)) {
            const bytes = await c.get(v.file);
            await cacheFile(r, id, { bytes, ref: v.file, name: v.file.n, type: v.file.t, kind: N.imageType(bytes) && bytes.length <= N.LIMIT.image ? 'image' : 'file' });
            fetched++;
          }
        } catch (e) {
          current();
          failure ||= e;
          if (!alone(e)) break;
        }
      }
      return { fetched, failure };
    };
    const apply = async (r, c, current = () => {}) => {
      const b = r.bind, v = c.view();
      if (!b || r.kind === 'look') return; // Following a Look never applies it.
      for (const id of Object.keys(b.map)) if (!Object.hasOwn(v, id)) { b.detached ||= []; b.detached.push(b.map[id]); delete b.map[id]; }
      if (r.kind === 'todo') {
        const stored = await local.get(b.key); check(Object.hasOwn(stored, b.key));
        const d = T.clean(stored[b.key]);
        for (const [e, x] of Object.entries(v)) if (x.task) {
          if (!Object.hasOwn(b.map, e)) b.map[e] = uuid();
          const id = b.map[e];
          const task = { ...x.task, id, cid: '' };
          d.tasks = [...d.tasks.filter((t) => t.id !== id), task]; d.items[`task:${id}`] = x.plan || {};
        }
        // Removing an item in the shared list keeps the last local copy.
        current();
        if (!same(T.clean(stored[b.key]), T.clean(d))) check(await local.set({ [b.key]: T.clean(d) }));
      } else {
        const stored = await local.get(b.key); check(Object.hasOwn(stored, b.key));
        let idx = N.clean(stored[b.key]);
        current();
        if (!b.folder) { b.folder = uuid(); check((await N.run({ key: b.key, op: 'folder', id: b.folder, name: r.title }, { local }, notes)).ok); }
        for (const [e, x] of Object.entries(v)) if (typeof x.html === 'string') {
          current();
          if (!Object.hasOwn(b.map, e)) b.map[e] = uuid();
          const id = b.map[e];
          const remap = {};
          for (const fid of N.refs(x.html)) {
            const f = await db.get('files', fileKey(r, `f_${fid}`));
            if (!f) continue;
            b.files ||= dict(); b.hashes ||= dict();
            const revision = JSON.stringify(f.ref);
            if (!Object.hasOwn(b.files, fid) || b.hashes[fid] !== revision) b.files[fid] = uuid();
            b.hashes[fid] = revision; remap[fid] = b.files[fid];
            current();
            check((await N.run({ key: b.key, op: 'file', id: remap[fid], note: id, name: f.name, kind: f.kind, data: N.b64(f.bytes) }, { local }, notes)).ok);
          }
          // A file that isn't here yet (it is fetched after the text) keeps the id it has in the share; the next apply, once
          // the file is here, gives it a local one.
          const html = x.html.replace(/data-gz-file="([0-9a-f-]{36})"/g, (m, f) => remap[f] ? `data-gz-file="${remap[f]}"` : m);
          const had = idx.notes[id];
          const body = had && await N.run({ key: b.key, op: 'load', id }, { local }, notes);
          if (!had || body?.html !== html) {
            current();
            check((await N.run({ key: b.key, op: 'save', id, base: had?.rev || 0, sid: uuid(), copy: uuid(), title: x.title, folder: b.folder, html }, { local }, notes)).ok);
          }
          current();
          if (had && had.title !== x.title) check((await N.run({ key: b.key, op: 'meta', id, title: x.title, at: now() }, { local }, notes)).ok);
        }
      }
    };
    // What a round received goes to the local apps in one broker turn. `base`: what the session shared here, and its mark,
    // when the round read it, and after each landing as that left it.
    const land = (r, c, base, current) => enqueue(async () => {
      current();
      // A write to what this session shares landed while the relay was asked. Applying now would put back what was
      // read before it, so the round is dropped as an aborted one is: nothing received is kept, and the next round
      // (that write's) sends it first and gets the same changes again.
      if (base.seen !== undefined && await held(r) !== base.seen) return false;
      // Any other write it shares since it was read leaves the mark unset, so that write's change syncs it.
      const kept = base.marked === undefined || await mark(r) === base.marked;
      await save(r); current(); await apply(r, c, current); current();
      // What apply() wrote comes back as a storage change: the mark says this session has it already.
      r.mark = kept ? await mark(r) : null;
      await save(r);
      base.seen = await held(r); base.marked = r.mark;
      return true;
    });
    const why = (e) => (['big', 'full', 'missing', 'storage', 'off'].includes(e.message) ? e.message : e.status === 507 ? 'full' : 'network');
    // Never throws. A record too big to keep, or a failing disk, still records why: on the copy last kept, which already
    // fits, without what this round got (as a dropped round).
    const remember = async (r, whole = true) => {
      if (whole) try { await save(r); return; } catch {}
      try { const kept = await db.get('sessions', r.st.sid); if (kept) await db.put('sessions', r.st.sid, { ...kept, status: r.status, error: r.error }); } catch {}
    };
    // The files an editor has seen a share point to, by id (value: the entity that holds it). One the merged state no
    // longer holds was replaced, or its entity deleted: once the batch that dropped it is in, it goes off the relay, and
    // the copy kept beside the bytes loses the reference that names it (a file that comes back is sent again, not
    // pointed at a file that is gone). A delete that fails stays listed for the next round.
    const refsOf = (view) => { const out = dict(); for (const [e, x] of Object.entries(view)) if (x.file) out[x.file.id] = e; return out; };
    const track = (r, c) => { if (r.st.seed) Object.assign(r.refs ||= dict(), refsOf(c.view())); };
    const sweep = async (r, c, current) => {
      if (!r.st.seed || r.st.pending.length) return;
      const live = refsOf(c.view());
      let changed = !r.refs;
      r.refs ||= dict();
      for (const [id, e] of Object.entries(r.refs)) {
        if (Object.hasOwn(live, id)) continue;
        try { await c.removeFile(id); } catch { current(); continue; }
        delete r.refs[id]; changed = true;
        const key = fileKey(r, e), had = await db.get('files', key);
        if (had?.ref?.id === id) { const { ref, ...rest } = had; await db.put('files', key, rest); }
      }
      for (const id of Object.keys(live)) if (!Object.hasOwn(r.refs, id)) { r.refs[id] = live[id]; changed = true; }
      if (changed) await save(r);
    };
    // The files of a round, after its text has synced and landed: those the others sent come in, those only this device
    // has go up and are published with one more batch (and those a Re-upload replaces), and what the share no longer
    // holds comes off the relay. Each file on its own: one that fails does not keep the rest, and none of it holds up the
    // text. Only a relay that can't be reached ends the round's files, and the share then says it is offline.
    const carry = async (r, c, files, upload, base, current, transport, interrupted) => {
      let trouble = null, down = false, landed = true;
      const lame = (e) => { current(); trouble ||= e; if (!alone(e)) down = true; };
      const got = await keepFiles(r, transport, current);
      if (interrupted()) return remember(r);
      if (got.failure) lame(got.failure);
      // Pictures and attachments that came in belong in the notes that name them.
      if (got.fetched) landed = await land(r, c, base, current);
      const sent = [];
      for (const up of down || !landed ? [] : files) {
        try { sent.push(await up(transport)); } catch (e) { lame(e); if (down) break; }
      }
      if (upload && r.st.seed && !down && landed) for (const [id, x] of Object.entries(c.view())) if (x.file) {
        try {
          const f = await db.get('files', fileKey(r, id)); check(f, 'missing');
          sent.push({ e: id, ref: await send(r, transport, id, f.bytes, { n: f.name, t: f.type }) });
        } catch (e) { lame(e); if (down) break; }
      }
      if (interrupted()) return remember(r);
      if (sent.length) {
        await save(r); // what was sent is listed here, and each reference is kept beside its bytes
        const v = c.view();
        for (const { e, ref } of sent) v[e] = { file: ref };
        await c.edit(v); current();
        const more = await c.sync(); current();
        check(Object.keys(c.view()).length <= LIMIT.items * 3, 'big');
        if (more.gone) r.status = 'gone'; else if ((more.more || more.bad) && r.status === 'live') r.status = 'incomplete';
        landed = await land(r, c, base, current);
      }
      // A round that had a file go wrong deletes nothing: what the share points to may not all be here to compare with.
      if (landed && !trouble && r.status === 'live') await sweep(r, c, current);
      if (trouble && r.status !== 'gone') { r.status = trouble.message === 'big' ? 'big' : 'offline'; r.error = why(trouble); await remember(r, landed); }
    };
    const update = async (r, { upload = false } = {}) => {
      const signal = ctl.signal;
      if (r.st.gone || !await allowed(r.st.server) || signal.aborted) return;
      const c = client(r);
      const current = () => check(!signal.aborted, 'off');
      let seen, marked, got = false;
      const files = [];
      try {
        // Persist edits before sending. Failed local reads never turn into an empty shared view.
        const bound = r.bind && r.st.seed;
        if (bound) {
          const view = await enqueue(async () => { current(); const out = await readLocal(r, c, files); seen = await held(r); marked = await mark(r); return out; });
          check(Object.keys(view).length <= LIMIT.items * 3, 'big');
          track(r, c);
          const e = await c.edit(view); current(); check(!e.big.length, 'big');
          track(r, c);
        }
        // Presence is a last-seen device list, not an account identity or an access-control list. It goes with a
        // change this device sends anyway, or alone every few minutes: never a batch a minute for every share.
        const present = r.st.seed && r.st.type && now() - (c.view()[`_m_${r.st.actor}`]?.member?.at || 0) >= (r.st.pending.length ? 60000 : PRESENCE);
        if (present) {
          const v = c.view(); v[`_m_${r.st.actor}`] = { member: { name: r.name || '…', at: now() } };
          await c.edit(v); current();
        }
        if (bound || present) await save(r);
        const result = await c.sync();
        current(); got = true;
        check(Object.keys(c.view()).length <= LIMIT.items * 3, 'big');
        r.kind ||= c.view()._?.kind;
        r.title = c.view()._?.title || r.title;
        // Persist received data before touching the local apps. Reopening retries a failed apply.
        r.status = result.gone ? 'gone' : result.more || result.bad ? 'incomplete' : 'live';
        delete r.error;
        r.at = now();
        const base = { seen, marked };
        const applied = await land(r, c, base, current);
        // An editor compacts the log once it runs LIMIT.compact batches past its last trim (a full one is compacted by
        // the sync itself). A state that had to wait for the trim goes at once. The round has synced either way: if
        // this can't be kept (a state still queued twice its size), the record from the round above stands.
        if (applied && r.st.seed && r.st.cursor - r.st.base >= C.LIMIT.compact) {
          // The client's pre-trim checkpoint keeps a retry without doubling the state on disk. If the replacement
          // cannot be sent or kept, that marker rebuilds its pending snapshot when this record is next opened.
          try {
            const compacted = await c.compact(); current();
            delete r.st.snapshot;
            if (compacted && r.st.pending.length) await c.sync();
          } catch {}
          current(); await save(r).catch(() => {});
        }
        if (applied && !result.gone) {
          // Text saves and newer doorbells must not wait behind a slow file in sessionTurn. Interrupt only the file
          // transport; the next queued turn sends/reads text first, and retained files retry afterwards.
          const controller = new AbortController(), stop = () => controller.abort();
          signal.addEventListener('abort', stop, { once: true });
          if (signal.aborted) stop();
          transfer = { r, stop };
          try { await carry(r, c, files, upload, base, current, client(r, controller.signal), () => controller.signal.aborted); }
          finally { transfer = null; signal.removeEventListener('abort', stop); }
        }
      } catch (e) {
        if (signal.aborted) return;
        // Too big is not offline, and says so. Too big once this round had read the relay ('state'), it is left to an
        // explicit Sync (stuck()).
        r.status = e.message === 'big' ? 'big' : 'offline';
        r.error = e.message === 'big' && got ? 'state' : why(e);
        await remember(r);
      }
      notify();
    };
    const stop = () => { generation++; for (const socket of live.values()) socket.close(); live.clear(); clearTimeout(timer); ctl.abort(); ctl = new AbortController(); };
    // The relay answers a subscribe with each session's newest batch, and rings for every new one, this device's own
    // included: a batch this device has read already needs no sync.
    const ring = (server, mine) => (m) => {
      const active = transfer;
      if (mine === generation && active) record(m.s).then((r) => {
        if (mine === generation && transfer === active && r?.st.server === server && !stuck(r)
          && !(Number.isSafeInteger(m.n) && m.n <= r.st.cursor)) active.stop();
      }).catch(() => {});
      return serial(async () => {
        if (mine !== generation || !ports || !await allowed(server)) return;
        const r = await record(m.s);
        if (r?.st.server !== server || mine !== generation || stuck(r) || (Number.isSafeInteger(m.n) && m.n <= r.st.cursor)) return;
        await update(r);
      }).catch(() => {});
    };
    // One socket per server for the sessions it holds, kept across refreshes: it opens or closes only when that set
    // changes, or when the server may no longer be asked.
    const listen = async (rs, mine) => {
      const want = new Map();
      for (const r of rs) if (!r.st.gone) want.set(r.st.server, [...(want.get(r.st.server) || []), r.st.sid].sort());
      for (const [server, socket] of [...live]) {
        if (same(socket.sids, want.get(server)) && await allowed(server)) continue;
        socket.close(); live.delete(server);
      }
      for (const [server, sids] of want) {
        if (live.has(server) || !await allowed(server) || mine !== generation || !ports) continue;
        live.set(server, Object.assign(C.live(server, sids, ring(server, mine), { WebSocket }), { sids }));
      }
    };
    // Every session synced, then the sockets brought in line. Each session on its own: one that fails (too big, a
    // failing disk) can't keep the rest, the sockets or the next refresh from running.
    const refresh = async () => {
      clearTimeout(timer);
      const mine = generation;
      if (!ports || !await enabled()) return stop();
      try {
        const rs = await all();
        for (const r of rs) {
          if (mine !== generation || !ports) return;
          if (!stuck(r)) await update(r).catch(() => {});
        }
        if (mine === generation && ports) await listen(rs, mine);
      } finally {
        if (mine === generation && ports) { clearTimeout(timer); timer = setTimeout(() => serial(refresh).catch(() => {}), 60000); }
      }
    };
    // A local write (keys: the Notes or To Do keys it changed, or 'look' for the Look's settings) syncs only the
    // sessions that share what it changed, and only if that is no longer what they last synced, or they have
    // something waiting to go: what apply() wrote comes back here as what its session has already. Without keys (the
    // device is back online), every session that isn't up to date tries again.
    const touch = async (keys) => {
      const mine = generation;
      if (!ports || !await enabled()) return;
      const dirty = async (r) => r.st.snapshot || r.st.pending.length > 0 || (!!r.bind && r.kind !== 'look' && r.mark !== await enqueue(() => mark(r)));
      for (const r of await all()) {
        if (mine !== generation || !ports) return;
        if (r.st.gone || stuck(r)) continue;
        try {
          const due = keys ? keys.has(r.bind && (r.kind === 'look' ? 'look' : r.bind.key)) && (r.kind === 'look' || await dirty(r)) : r.status !== 'live' || await dirty(r);
          if (due) await update(r);
        } catch {}
      }
    };
    const brief = (r) => ({ sid: r.st.sid, server: r.st.server, title: r.title, kind: r.kind, edit: !!r.st.seed, creator: !!r.st.del, expire: !!r.st.expire,
      status: r.st.gone ? 'gone' : r.status === 'big' ? 'big' : r.st.pending.length ? 'pending' : r.status || 'offline', error: r.error, at: r.at || 0, bound: !!r.bind,
      // Where a shared copy lives here: the Notes share panel finds a note's session by its account and note id.
      account: r.bind?.key || r.copy?.key || '', notes: r.kind === 'notes' ? (r.bind ? Object.values(r.bind.map) : r.copy?.notes || []) : [], folder: r.kind === 'notes' && r.bind?.wholeFolder ? r.bind.folder : '',
      members: Object.values(C.view(r.st)).filter((x) => x.member).map((x) => x.member).slice(0, LIMIT.items),
      items: Object.entries(C.view(r.st)).filter(([, v]) => v.html !== undefined || v.task || v.code).map(([id, v]) => ({ id, title: v.title || v.task?.title || r.title })) });
    const handle = async (m) => {
      const mine = generation, current = () => check(mine === generation, 'off');
      // Operations on Notes, To Do or media take a broker turn whole, as those features' own writes do.
      if (m.op === 'notesRead' || m.op === 'notesGetFile') return enqueue(async () => {
        check(N.KEY.test(m.key) && Object.hasOwn(await local.get(m.key), m.key), 'bad');
        return N.run({ key: m.key, op: m.op === 'notesRead' ? 'load' : 'getFile', id: m.id }, { local }, notes);
      });
      if (m.op === 'notesFile' || m.op === 'notesImport') return enqueue(async () => {
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
      });
      // m.scope (set only by the worker, from a Notes share panel's ticket): that one Notes account and note.
      if (m.op === 'list') {
        const out = { ok: true, on: await enabled(), relay: await selected(), defaultRelay: C.SERVER, hosts: await hosts(), name: str((await local.get('shareName')).shareName, 60) || '', sessions: (await all()).map(brief), ...await sources() };
        if (!m.scope) return out;
        return { ...out, scope: { key: m.scope.key, note: m.scope.note }, sessions: out.sessions.filter((s) => s.account === m.scope.key), sources: out.sources.filter((s) => s.key === m.scope.key && s.ids), accounts: out.accounts.filter((k) => k === m.scope.key) };
      }
      if (m.scope && m.op === 'create') check(m.kind === 'notes' && m.key === m.scope.key && m.scope.note && !m.folder && Array.isArray(m.ids) && m.ids.length === 1 && m.ids[0] === m.scope.note, 'bad');
      if (m.op === 'relaySave') { const server = R.normalize(m.server); check(server, 'bad'); check(await sync.set({ shareRelay: server })); return { ok: true, server }; }
      if (m.op === 'relayTest') return health(R.normalize(m.server));
      if (m.op === 'exportKeys') return { ok: true, keys: await keys() };
      if (m.op === 'importKeys') {
        check(Array.isArray(m.keys) && m.keys.length <= LIMIT.sessions, 'big');
        const records = m.keys.map((x) => C.importKeys(x, true));
        check(records.every((s) => s && R.normalize(s.server) === s.server && (s.type === null || s.type === 'collection')), 'bad');
        const rs = await all();
        check(new Set([...rs.map((r) => r.st.sid), ...records.map((s) => s.sid)]).size <= LIMIT.sessions, 'big');
        check(await local.set({ shareOn: false })); stop();
        for (const st of records) if (!rs.some((r) => r.st.sid === st.sid)) await save({ st, title: '…', status: 'offline' });
        return { ok: true };
      }
      if (m.op === 'pause') { check(await local.set({ shareOn: false })); stop(); return { ok: true }; }
      if (m.op === 'resume' || m.op === 'create' || m.op === 'join') {
        const rs = await all();
        // Restarting the device-wide switch also restarts every saved session. A panel cannot consent for other accounts.
        if (m.scope && !await enabled()) check(rs.every((r) => r.st.gone || brief(r).account === m.scope.key
          || (!r.bind && !r.copy && typeof m.scope.id === 'string' && !!m.scope.id && r.joinedScope === m.scope.id)), 'confirmation');
        let server, joined;
        // The device name is remembered for the next share, wherever it is typed.
        if (m.op !== 'resume' && str(m.name, 60)?.trim()) check(await local.set({ shareName: m.name.trim() }));
        if (m.op === 'create') { server = await selected(); check(m.server === undefined || m.server === server, 'bad'); }
        if (m.op === 'join') {
          server = R.invite(m.link); check(server, 'bad');
          check((server === relay && server === await selected()) || m.confirmServer === server, 'confirmation');
          joined = C.join(m.link, true); check(joined && joined.server === server, 'bad');
        }
        const servers = server ? [server] : [...new Set(rs.filter((r) => !r.st.gone).map((r) => r.st.server))];
        check(servers.every((s) => R.normalize(s) === s), 'bad');
        if (m.op === 'resume') for (const s of servers) check(await approved(s) || (Array.isArray(m.confirmServers) && m.confirmServers.length <= LIMIT.sessions && m.confirmServers.includes(s)), 'confirmation');
        for (const s of servers) check(await permission(s), 'permission');
        current();
        check(await C.supported(), 'unsupported');
        current();
        if (m.op !== 'resume') check(rs.length < LIMIT.sessions, 'many');
        let r;
        if (m.op === 'create') {
          check(['notes', 'todo', 'look'].includes(m.kind) && str(m.title, 80)?.trim(), 'bad');
          if (m.kind !== 'look') {
            check((m.kind === 'notes' ? N.KEY : T.STORE_KEY).test(m.key), 'bad');
            check(Array.isArray(m.ids) && m.ids.length <= LIMIT.items && m.ids.every((x) => (m.kind === 'notes' ? N.ID : TASK).test(x)), 'bad');
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
          // Its id bound to its key: a read link handed out before the first sync can't be used to take the id.
          r = { st: await C.createBound('collection', { server, expire: m.expire === true }), title: m.title.trim(), name: str(m.name, 60) || '…', kind: m.kind,
            bind: { key: m.key, folder: m.folder || '', wholeFolder: !!m.folder, map: dict(Object.fromEntries((m.ids || []).map((id) => [id, id]))), files: dict() } };
        } else if (m.op === 'join') {
          const st = joined;
          check(!rs.some((r) => r.st.sid === st.sid), 'duplicate');
          r = { st, title: '…', name: str(m.name, 60) || '…', status: 'offline', ...(m.scope?.id ? { joinedScope: m.scope.id } : {}) };
        }
        current();
        if (r) await save(r);
        current();
        const known = await hosts();
        check(await local.set({ shareHosts: [...new Set([...rs.map((x) => x.st.server).filter((s) => known.includes(s)), ...servers].filter((s) => s !== relay))] }));
        current();
        check(await local.set({ shareOn: true }));
        current();
        if (r) {
          const c = client(r);
          if (r.st.seed && r.st.type) { const v = c.view(); v[`_m_${r.st.actor}`] = { member: { name: str(m.name, 60) || '…', at: now() } }; await c.edit(v); await save(r); }
          await update(r);
        }
        await refresh();
        return { ok: true, sid: r?.st.sid, kind: r?.kind, title: r?.title };
      }
      const r = typeof m.sid === 'string' && await record(m.sid); check(r, 'missing');
      // A panel reaches only its account's sessions, and attaches a session it just joined only into that account.
      if (m.scope) check(m.op === 'attach'
        ? typeof m.scope.id === 'string' && !!m.scope.id && r.joinedScope === m.scope.id && !r.bind && m.key === m.scope.key && (!r.copy || r.copy.key === m.scope.key)
        : brief(r).account === m.scope.key, 'bad');
      if (m.op === 'read') return { ok: true, view: C.view(r.st) };
      if (m.op === 'link') return { ok: true, link: await client(r).link(m.edit === true) };
      if (m.op === 'leave') {
        await db.del('sessions', r.st.sid);
        let freed = 0;
        for (const f of await db.all('files')) if (f.sid === r.st.sid) { freed += f.bytes?.length || 0; await db.del('files', fileKey(r, f.entity)); }
        const total = (await db.get('files', TOTAL))?.total;
        if (freed && Number.isSafeInteger(total)) await db.put('files', TOTAL, { total: Math.max(0, total - freed) });
        await refresh(); return { ok: true };
      }
      if (m.op === 'attach') return enqueue(async () => {
        check(!r.bind && ['notes', 'todo'].includes(r.kind) && (r.kind === 'notes' ? N.KEY : T.STORE_KEY).test(m.key), 'bad');
        check(Object.hasOwn(await local.get(m.key), m.key), 'bad');
        r.bind = { key: m.key, map: dict(), files: dict() }; await save(r); await apply(r, client(r));
        if (!r.st.seed) {
          // Keep the detached copy discoverable in Notes without binding its edits back to the read-only session.
          r.copy = { key: m.key, notes: Object.values(r.bind.map) }; r.bind = null;
        }
        await save(r); return { ok: true };
      });
      if (m.op === 'useLook') return enqueue(async () => {
        check(r.kind === 'look', 'bad');
        const code = C.view(r.st).look?.code; check(code, 'bad');
        const got = await L.decode(code);
        // The media file it names, if one came with it, is kept on this computer (read again, and named by what it is) first,
        // but pending, as a gallery Look's is: the editor lets it go unless the student uses the Look, and says when there was
        // no room for it.
        const wanted = got.parts?.x?.bg?.media, h = media().fileOf(wanted?.src), f = h && keptFiles && await db.get('files', fileKey(r, 'f_media'));
        let kept = null;
        if (f?.bytes) {
          const had = (await media().index(local))[h];
          const put = had ? { ok: true } : await media().change({ op: 'put', kind: wanted.type, expect: h, b64: media().std(f.bytes), pending: true }, { local, sync, files: keptFiles }, { decode: L.decode });
          kept = put.ok ? { h, ...((had ? had.p : true) && { pending: true }) } : { h, error: put.error };
        }
        check(await offerLook(code, r.title, kept)); return { ok: true };
      });
      check(await allowed(r.st.server), 'off');
      current();
      if (m.op === 'delete') { await client(r).remove(); r.status = 'gone'; await save(r); await refresh(); }
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
    // Changes share one waiting turn, their keys gathered for it (none: every session may have changed). Once it
    // starts, the next change asks for another: a write can land while it waits on the relay, and that turn sends it.
    return { handle, backupNotes, keys, stop, changed: (keys) => {
      if (!ports) return;
      const active = transfer;
      if (active) enqueue(async () => {
        if (transfer !== active) return;
        // apply() emits storage changes too. Its mark already includes them, so only a newer local save interrupts.
        const r = active.r;
        if (!keys || !r.bind || r.kind === 'look' || !keys.includes(r.bind.key) || r.mark !== await mark(r)) active.stop();
      }).catch(() => {});
      if (!keys) wanted = null; else if (wanted) for (const k of keys) wanted.add(k);
      if (scheduled) return;
      const mine = generation; scheduled = true;
      serial(() => { scheduled = false; const these = wanted; wanted = new Set(); return mine === generation && touch(these); }).catch(() => {});
    },
      connect: () => { ports++; const mine = generation; serial(() => mine === generation && refresh()).catch(() => {}); return () => { ports = Math.max(0, ports - 1); if (!ports) stop(); }; } };
  };
  return { LIMIT, database, make };
})();
if (typeof module !== 'undefined') module.exports = GZ_SESSIONS;
