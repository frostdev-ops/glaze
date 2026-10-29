// Agent apps' access to Glaze over MCP: the mcp setting (storage.local { on }, off unless it says on, and kept out of
// defaults.js), the apps the student paired and the groups each may use, and the activity list.
// Apps live in the worker's own IndexedDB (glaze-mcp, store apps), never storage.local, which content scripts can write. An
// app's id is the first 16 base32 characters of SHA-256 over the JSON of [its program's path, its client name]: a new name
// splits an app in two, and two apps never merge. A record: { id, name, exe, verified, at (first paired), used (last call),
// grants: { [group]: true }, declined: { pair?: at, [group]?: at } }. An app is paired while declined.pair is unset, and a
// declined app holds no grants. A decline is remembered so Glaze never asks again; pair or grant clears it. A new app's
// declined pairing is pair(peer, name, []) then decline(id, 'pair'). Groups are lib/ai/tools.js isGroup's.
// The activity list (storage.local mcpCalls): the last LIMIT.calls rows of { at, app, tool, group, kind, outcome, ms }. A
// value outside its key's shape is dropped and a row without a known outcome isn't kept, so no content is ever stored.
// Classic script for the worker; module.exports for node.
var GZ_MCP_GRANTS = globalThis.GZ_MCP_GRANTS || (() => {
  const T = () => (typeof GZ_AI_TOOLS !== 'undefined' ? GZ_AI_TOOLS : require('../ai/tools.js'));
  const R = () => (typeof GZ_AI_REQUEST !== 'undefined' ? GZ_AI_REQUEST : require('../ai/request.js'));
  const KEY = 'mcp', CALLS = 'mcpCalls', DB = 'glaze-mcp', STORE = 'apps';
  // calls: activity rows kept; name, exe: the characters of an app's name and program path kept.
  const LIMIT = { calls: 200, name: 100, exe: 1024 };
  const OUTCOMES = ['ok', 'error', 'declined', 'timeout', 'interrupted', 'refused', 'busy'];
  const ID = /^[a-z2-7]{16}$/;
  const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
  const str = (v) => (typeof v === 'string' ? v : '');
  const isId = (v) => typeof v === 'string' && ID.test(v);
  // The first n UTF-16 units, without half a surrogate pair.
  const cut = (s, n) => { const t = s.slice(0, n); return /[\ud800-\udbff]$/.test(t) ? t.slice(0, -1) : t; };
  const without = (o, keys) => Object.fromEntries(Object.entries(isObj(o) ? o : {}).filter(([k]) => !keys.includes(k)));

  const clean = (raw) => ({ on: isObj(raw) && raw.on === true });

  // As lib/modbundle.js base32: lowercase RFC 4648, no padding.
  const base32 = (bytes) => {
    let out = '', v = 0, n = 0;
    for (const b of bytes) {
      v = ((v & 31) << 8) | b;
      for (n += 8; n >= 5; n -= 5) out += 'abcdefghijklmnopqrstuvwxyz234567'[(v >>> (n - 5)) & 31];
    }
    return n ? out + 'abcdefghijklmnopqrstuvwxyz234567'[(v << (5 - n)) & 31] : out;
  };
  // peer: the host's { exe?, verified?, … }; clientName: the app's own clientInfo.name. Only strings count.
  const appId = async (peer, clientName) => {
    const hash = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([str(peer?.exe), str(clientName)])));
    return base32(new Uint8Array(hash, 0, 10));
  };
  const paired = (rec) => isObj(rec) && !rec.declined?.pair;
  const granted = (rec, group) => paired(rec) && rec.grants?.[group] === true;

  // The apps, over an IndexedDB (the worker's; a test's fake). now: the clock for at, used and declines.
  // get → the app or null, list → the apps by when they were paired; both reject when the database does. pair, grant,
  // decline, touch → the app as written, or null (no such app, a group or a value outside its rule, or a failed write);
  // revoke, forget → whether it was written.
  const open = (idb = globalThis.indexedDB, now = Date.now) => {
    let db = null;
    const connect = () => (db ||= new Promise((resolve, reject) => {
      const r = idb.open(DB, 1);
      r.onupgradeneeded = () => { if (!r.result.objectStoreNames?.contains?.(STORE)) r.result.createObjectStore(STORE); };
      r.onerror = () => reject(r.error);
      r.onsuccess = () => { r.result.onversionchange = () => { r.result.close(); db = null; }; resolve(r.result); };
    }).catch((e) => { db = null; throw e; }));
    // One transaction: f(store, done) makes its requests → what it gave done, once the transaction has completed.
    const tx = async (mode, f) => {
      const t = (await connect()).transaction(STORE, mode);
      let value = null;
      f(t.objectStore(STORE), (v) => { value = v; });
      await new Promise((resolve, reject) => { t.oncomplete = resolve; t.onerror = t.onabort = () => reject(t.error); });
      return value;
    };
    const app = (v) => (isObj(v) && isId(v.id) ? v : null);
    // Reads an app and puts change(app) back, in one transaction.
    const edit = (id, change) => (!isId(id) ? Promise.resolve(null) : tx('readwrite', (s, done) => {
      const r = s.get(id);
      r.onsuccess = () => { const a = app(r.result); if (a) { const next = change(a); s.put(next, id); done(next); } };
    }).catch(() => null));
    const get = (id) => (!isId(id) ? Promise.resolve(null) : tx('readonly', (s, done) => { const r = s.get(id); r.onsuccess = () => done(app(r.result)); }));
    const list = () => tx('readonly', (s, done) => { const r = s.getAll(); r.onsuccess = () => done(r.result.map(app).filter(Boolean).sort((a, b) => a.at - b.at)); }).then((v) => v || []);
    // Pairs the app with exactly these groups granted, keeping when it was first paired and its other groups' declines.
    const pair = async (peer, clientName, groups) => {
      if (!Array.isArray(groups) || !groups.every((g) => T().isGroup(g))) return null;
      const id = await appId(peer, clientName), at = now();
      const rec = { id, name: cut(str(clientName), LIMIT.name), exe: cut(str(peer?.exe), LIMIT.exe), verified: peer?.verified === true, at, used: at, grants: Object.fromEntries(groups.map((g) => [g, true])) };
      return tx('readwrite', (s, done) => {
        const r = s.get(id);
        r.onsuccess = () => { const was = app(r.result), next = { ...rec, at: was?.at ?? at, declined: without(was?.declined, ['pair', ...groups]) }; s.put(next, id); done(next); };
      }).catch(() => null);
    };
    const grant = (id, group, on) => (!T().isGroup(group) || typeof on !== 'boolean' ? Promise.resolve(null)
      : edit(id, (a) => ({ ...a, grants: on ? { ...a.grants, [group]: true } : without(a.grants, [group]), declined: on ? without(a.declined, [group]) : a.declined })));
    // what: 'pair' or a group.
    const decline = (id, what) => (what !== 'pair' && !T().isGroup(what) ? Promise.resolve(null)
      : edit(id, (a) => ({ ...a, grants: what === 'pair' ? {} : without(a.grants, [what]), declined: { ...a.declined, [what]: now() } })));
    const touch = (id) => edit(id, (a) => ({ ...a, used: now() }));
    const revoke = (id) => (!isId(id) ? Promise.resolve(false) : tx('readwrite', (s) => s.delete(id)).then(() => true, () => false));
    const forget = () => tx('readwrite', (s) => { const r = s.getAllKeys(); r.onsuccess = () => { for (const k of r.result) s.delete(k); }; }).then(() => true, () => false);
    return { get, list, pair, grant, decline, touch, revoke, forget };
  };

  // Each kept key's shape.
  const SHAPE = {
    at: (v) => Number.isFinite(v) && v >= 0,
    app: isId,
    tool: (v) => typeof v === 'string' && R().NAME.test(v),
    group: (v) => T().isGroup(v),
    kind: (v) => T().KINDS.includes(v),
    outcome: (v) => OUTCOMES.includes(v),
    ms: (v) => Number.isFinite(v) && v >= 0,
  };
  // local: storage.local's { get, set }. Rows are written in the order recorded; a failed write never blocks a call.
  let writes = Promise.resolve();
  const record = (local, row) => {
    if (!isObj(row) || !OUTCOMES.includes(row.outcome)) return writes;
    const kept = Object.fromEntries(Object.keys(SHAPE).filter((k) => SHAPE[k](row[k])).map((k) => [k, row[k]]));
    return (writes = writes.then(async () => {
      try {
        const rows = (await local.get(CALLS))[CALLS];
        await local.set({ [CALLS]: [...(Array.isArray(rows) ? rows.slice(-(LIMIT.calls - 1)) : []), kept] });
      } catch { /* The activity list must never block a call. */ }
    }));
  };
  return { KEY, CALLS, DB, STORE, LIMIT, OUTCOMES, clean, appId, paired, granted, open, record };
})();
if (typeof module !== 'undefined') module.exports = GZ_MCP_GRANTS; else GZ_MCP_GRANTS;
