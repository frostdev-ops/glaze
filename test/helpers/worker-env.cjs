// The real lib/background.js in a vm, as test/sidebar-broker.test.js runs it, with in-memory storage and what the tests of
// frame trust and starter flags also need: the worker's ports, tab events, session storage, and a count of the reads of
// all of sync. Pass a previous run's `store` to restart the worker over the same storage, and `globals` for more of the
// worker's own (indexedDB). chrome.permissions answers as
// the browser would for the manifest's hosts plus `grants` (a Set the test may change); `revoked` takes required hosts
// away, as Firefox lets a student do. `perms` records what was requested and removed; `registered`, the content scripts.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

// Whether match pattern `p` covers `want` (a pattern or an origin's `scheme://host[:port]/*`).
const covers = (p, want) => {
  if (p === '<all_urls>') return true;
  const a = /^(\*|https?):\/\/([^/:]+)(?::(\d+))?\//.exec(p), b = /^(https?):\/\/([^/:]+)(?::(\d+))?\//.exec(want);
  if (!a || !b) return false;
  const host = a[2] === '*' || a[2] === b[2] || (a[2].startsWith('*.') && (b[2] === a[2].slice(2) || b[2].endsWith(a[2].slice(1))));
  return (a[1] === '*' ? /^https?$/.test(b[1]) : a[1] === b[1]) && host && (!a[3] || a[3] === b[3]);
};
module.exports = ({ store = { sync: { version: 2, enabled: true, enhance: {} }, local: { ultra: [] }, session: {} }, session = true, sessionArea, fetch, grants = new Set(), revoked = [], manifest: edit, globals = {} } = {}) => {
  const manifest = JSON.parse(read('manifest.json'));
  if (edit) edit(manifest);
  const perms = { requested: [], removed: [], added: [], gone: [] };
  const holding = () => [...(manifest.host_permissions || []).filter((p) => !revoked.includes(p)), ...grants];
  const permissions = {
    contains: async ({ origins = [] } = {}) => origins.every((o) => holding().some((p) => covers(p, o))),
    getAll: async () => ({ origins: holding() }),
    remove: async ({ origins = [] } = {}) => { perms.removed.push(...origins); for (const o of origins) grants.delete(o); return true; },
    request: async ({ origins = [] } = {}) => { perms.requested.push(...origins); return false; },
    onAdded: { addListener: (f) => perms.added.push(f) }, onRemoved: { addListener: (f) => perms.gone.push(f) },
  };
  const registered = new Map();
  const changed = [], startup = [], listeners = [], installed = [], connects = [], removed = [];
  const reads = { sync: 0, syncAll: 0, local: 0 };
  const area = (s, name) => ({
    get: async (k) => {
      if (reads[name] !== undefined) reads[name]++;
      if (name === 'sync' && k === null) reads.syncAll++;
      return structuredClone(k === null ? s : Object.fromEntries([].concat(k).filter((x) => x in s).map((x) => [x, s[x]])));
    },
    set: async (v) => {
      const ch = Object.fromEntries(Object.entries(v).map(([k, newValue]) => [k, { oldValue: s[k], newValue }]));
      Object.assign(s, structuredClone(v));
      for (const f of changed) f(ch, name);
    },
    remove: async (k) => { for (const x of [].concat(k)) delete s[x]; },
  });
  const context = vm.createContext({
    URL, console, TextEncoder, TextDecoder, structuredClone, Promise, Date, Intl, setTimeout, clearTimeout, crypto: globalThis.crypto, AbortController, AbortSignal, DOMException, Response, btoa, atob, fetch, navigator: {}, ...globals,
    importScripts: (...files) => { for (const f of files) vm.runInContext(read(`lib/${f}`), context); },
    chrome: {
      runtime: { id: 'glaze', getURL: (f = '') => `chrome-extension://x/${f}`, getManifest: () => manifest,
        onMessage: { addListener: (f) => listeners.push(f) }, onInstalled: { addListener: (f) => installed.push(f) }, onStartup: { addListener: (f) => startup.push(f) },
        onConnect: { addListener: (f) => connects.push(f) } },
      tabs: { onRemoved: { addListener: (f) => removed.push(f) }, query: async () => [] },
      storage: { ...(session && { session: sessionArea || area(store.session, 'session') }), local: area(store.local, 'local'), sync: area(store.sync, 'sync'), onChanged: { addListener: (f) => changed.push(f) } },
      permissions,
      scripting: { getRegisteredContentScripts: async () => [...registered.values()], registerContentScripts: async (l) => { for (const x of l) registered.set(x.id, x); },
        unregisterContentScripts: async ({ ids } = {}) => { for (const id of ids || [...registered.keys()]) registered.delete(id); }, executeScript: async () => [{ result: true }] },
    },
  });
  vm.runInContext(read('lib/background.js'), context);
  const send = (msg, sender) => new Promise((res) => {
    let kept = false;
    for (const f of listeners) if (f(msg, sender, (r) => res(JSON.parse(JSON.stringify(r ?? null)))) === true) kept = true;
    if (!kept) res('ignored');
  });
  const settle = async () => { for (let i = 0; i < 40; i++) await new Promise(setImmediate); };
  // A runtime port from `sender`: what the worker posted, whether it hung up, `say` for what the page would send, and `close`
  // for the page going away.
  const connect = (name, sender) => {
    const on = { message: [], disconnect: [] };
    const port = { name, sender, posted: [], hungUp: false, disconnect() { this.hungUp = true; }, postMessage(m) { this.posted.push(m); },
      onMessage: { addListener: (f) => on.message.push(f) }, onDisconnect: { addListener: (f) => on.disconnect.push(f) } };
    for (const f of connects) f(port);
    return { port, say: (m) => { for (const f of on.message) f(m); }, close: () => { for (const f of on.disconnect) f(port); } };
  };
  return { store, send, installed, startup, changed, removed, reads, settle, connect, context, perms, grants, registered, manifest };
};
