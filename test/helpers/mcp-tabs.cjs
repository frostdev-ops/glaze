// A browser's LMS tabs for lib/mcp/tabs.js and lib/mcp/tab.js (test/mcp-tabs, mcp-assign, mcp-todo-write): chrome.tabs.query's
// answer and chrome.scripting.executeScript into a tab's top frame, which is a vm context standing for Glaze's own world
// there: GZ_CTX as content.js makes it (site, on, account, profile, canvasCourses, myCourses, settings, need), defaults.js,
// location, the page's fetch (routes: path → JSON, or a function of (url, init)), storage and runtime.sendMessage. A func
// runs from its source, as the browser serializes it; a file runs as the extension's. The worker's publish paths
// ('glaze:todo', 'glaze:insights') write `store` as lib/background.js's broker does, through lib/todo.js and lib/insights.js.
// Also the worker wiring each step hands the orchestrator (lib/background.js's group D stubs), applied to the worker's
// source for test/helpers/worker-env.cjs.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const T = require('../../lib/todo.js');
const I = require('../../lib/insights.js');

const root = path.join(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const writerArea = (store) => ({
  get: async (keys) => Object.fromEntries([].concat(keys).filter((k) => Object.hasOwn(store, k)).map((k) => [k, structuredClone(store[k])])),
  set: async (patch) => { Object.assign(store, structuredClone(patch)); return true; },
});
const FIRST = ['lib/color.js', 'lib/i18n.js', 'lib/page.js', 'lib/grades.js', 'lib/fonts.js', 'lib/surfaces.js', 'defaults.js'];
const json = (body, status = 200, headers = {}) => ({ ok: status >= 200 && status < 300, status, headers: { get: (k) => headers[k.toLowerCase()] ?? null }, text: async () => JSON.stringify(body) });

// One tab: its tabs.Tab fields, and its top frame's world. ctx: GZ_CTX's own answers over the defaults.
const tab = ({ id, url, active = false, lastAccessed = 0, discarded = false, frozen, status = 'complete', site = 'canvas', uid = '5', tz = 'UTC',
  on = true, settings = {}, courses = [], memberships = [], routes = {}, store, sync = {}, documentId = `doc-${id}`, gone = false, hang = false, sent = [], cookie = '' } = {}) => {
  const loc = url ? new URL(url) : null;
  const asked = [];
  const page = { id, asked, sent, loaded: [], documentId, hang, gone };
  const fetch = async (u, init = {}) => {
    const url = new URL(u, loc.origin);
    asked.push({ url: url.href, method: init.method || 'GET', headers: init.headers || {}, body: init.body, credentials: init.credentials, redirect: init.redirect });
    if (url.origin !== loc.origin) throw new TypeError('Failed to fetch');
    if (url.pathname === '/api/v1/users/self/profile') return json({ id: uid, time_zone: tz });
    if (url.pathname === '/learn/api/v1/users/me') return json({ id: uid });
    const key = Object.keys(routes).find((k) => (k.startsWith('^') ? new RegExp(k).test(url.pathname + url.search) : url.pathname === k));
    if (!key) return json({ errors: [{ message: 'not found' }] }, 404);
    const r = routes[key];
    const v = typeof r === 'function' ? await r(url, init) : r;
    return v && typeof v.text === 'function' ? v : json(v);
  };
  const area = (s) => ({ get: (k, cb) => { const v = Object.fromEntries([].concat(k).filter((x) => Object.hasOwn(s, x)).map((x) => [x, structuredClone(s[x])])); if (cb) cb(v); return Promise.resolve(v); } });
  const context = vm.createContext({
    URL, URLSearchParams, console, Promise, Date, Intl, JSON, Math, setTimeout, clearTimeout, structuredClone, TextEncoder, TextDecoder, btoa, atob, AbortController, DOMException,
    location: loc ? { origin: loc.origin, host: loc.host, href: loc.href, pathname: loc.pathname, search: loc.search } : {},
    document: { cookie },
    fetch,
    chrome: {
      runtime: { id: 'glaze', lastError: undefined, sendMessage: (m, cb) => { sent.push(structuredClone(m)); const done = (r) => { if (cb) cb(r); return r; }; return Promise.resolve(publish(m, store)).then(done); } },
      storage: { local: area(store || {}), sync: area(sync) },
    },
  });
  context.globalThis = context;
  // The manifest's first content scripts before content.js, in its order.
  for (const f of FIRST) vm.runInContext(read(f), context, { filename: f });
  const need = async (file, ready) => {
    if (ready()) return;
    page.loaded.push(file);
    vm.runInContext(read(file), context, { filename: file });
    if (!ready()) throw new Error('ran, but not ready');
  };
  const all = { ...vm.runInContext('GZ_DEFAULTS', context), ...settings, enhance: { ...vm.runInContext('GZ_DEFAULTS.enhance', context), ...settings.enhance } };
  context.GZ_CTX = Object.freeze({
    site, need, on: () => on, settings: () => all,
    account: async () => uid,
    profile: async () => (site === 'ultra' ? { id: uid, time_zone: tz } : { id: Number(uid), time_zone: tz }),
    canvasCourses: async () => courses,
    myCourses: async () => Object.defineProperty([...memberships], 'complete', { value: true }),
  });
  const info = { id, windowId: 1, active, lastAccessed, discarded, status, ...(frozen !== undefined && { frozen }), ...(url && { url }) };
  return { info, context, page };
};

// What the worker's broker does with a page's publish ('glaze:todo' cache or edits, 'glaze:insights'), over `store`.
const publish = async (m, store) => {
  if (!store) return { ok: false };
  if (m?.type === 'glaze:todo') return T.change(m, { local: writerArea(store) });
  if (m?.type === 'glaze:insights') return I.change(m, writerArea(store));
  return { ok: false, error: 'not here' };
};

// chrome.tabs and chrome.scripting over those tabs: what was injected where (calls), each func run from its source.
const browser = (tabs) => {
  const calls = [];
  const byId = new Map(tabs.map((t) => [t.info.id, t]));
  const executeScript = async ({ target, func, args = [], files }) => {
    calls.push({ target: structuredClone(target), files, func: func && func.toString().slice(0, 40) });
    const t = byId.get(target.tabId);
    if (!t || t.page.gone) throw new Error(`No tab with id: ${target.tabId}`);
    if (target.documentIds && !target.documentIds.includes(t.page.documentId)) throw new Error('No document with id');
    if (t.page.hang) await new Promise(() => {});
    if (files) { for (const f of files) vm.runInContext(read(f), t.context, { filename: f }); return [{ frameId: 0, documentId: t.page.documentId, result: null }]; }
    const fn = vm.runInContext(`(${func.toString()})`, t.context);
    return [{ frameId: 0, documentId: t.page.documentId, result: structuredClone(await fn(...structuredClone(args))) }];
  };
  return { tabs: { query: async () => tabs.map((t) => structuredClone(t.info)) }, scripting: { executeScript }, calls, byId };
};
// lib/background.js modQuiet: Glaze stays out of these pages.
const LX = require('../../lib/lookx.js');
const quiet = (p) => LX.quiet(p) || /\/(quizzes|external_tools|assessment|attempt|lti)(\/|$)|\/mod\/(quiz|lti)(\/|$)/.test(p);

// The worker wiring for lib/background.js's group D stubs, as the orchestrator applies it: [stub, wired] pairs. A source that
// already holds the wired line is left as it is; one with neither throws, so a moved stub is found at once.
const WIRING = [
  ["'mcp/writer.js', 'mcp/wire.js'", "'mcp/writer.js', 'mcp/tabs.js', 'mcp/tools-assign.js', 'mcp/wire.js'"],
  ['const mcpRefresh = async (account, group, { signal, tool } = {}) => null;',
    'let mcpTabsMade = null;\nconst mcpTabs = () => (mcpTabsMade ||= GZ_MCP_TABS.create({ tabs: chrome.tabs, scripting: chrome.scripting, quiet: modQuiet }));\nconst mcpRefresh = (account, group, o) => mcpTabs().refresh(account, group, o);'],
  ["if (!GZ_AI_TOOLS.get('accounts_list')) { GZ_MCP_STUDY.register(GZ_AI_TOOLS); GZ_MCP_GRADES.register(GZ_AI_TOOLS); }",
    "if (!GZ_AI_TOOLS.get('accounts_list')) { const deps = { sync: chrome.storage.sync, tabs: mcpTabs() }; GZ_MCP_STUDY.register(GZ_AI_TOOLS, deps); GZ_MCP_GRADES.register(GZ_AI_TOOLS); GZ_MCP_ASSIGN.register(GZ_AI_TOOLS, deps); }"],
  ['await local.set({ mcp: { on: m.on } });',
    'await local.set({ mcp: { on: m.on } });\n    if (!m.on) { mcpFiles(); await GZ_MCP_ASSIGN.clear({ local }); }'],
  ["return { ok: await (m.op === 'revoke' ? grants.revoke(m.app) : grants.forget()) };",
    "const ok = await (m.op === 'revoke' ? grants.revoke(m.app) : grants.forget());\n  if (ok && m.op === 'forget') { mcpFiles(); await GZ_MCP_ASSIGN.clear({ local }); await local.remove('mcpCalls'); }\n  return { ok };"],
  ['const forget = async (origin) => {',
    'const forget = async (origin) => {\n  mcpFiles(); await GZ_MCP_ASSIGN.clear({ local: chrome.storage.local }, origin);'],
  ['const forgetAll = async () => {',
    'const forgetAll = async () => {\n  mcpFiles(); await GZ_MCP_ASSIGN.clear({ local: chrome.storage.local });'],
];
const wired = (src = read('lib/background.js')) => WIRING.reduce((s, [stub, line]) => {
  if (s.includes(line)) return s;
  if (!s.includes(stub)) throw new Error(`lib/background.js: no stub ${stub.slice(0, 60)}`);
  return s.replace(stub, line);
}, src);

// The real worker (test/helpers/worker-env.cjs) with that wiring, its tabs the fake browser's, agent access on and one app
// paired with every group, as test/mcp-worker.test.js boots it. A tab's publish reaches this worker's broker as Chrome routes
// a content script's message (route). → { w, store, b, windows }.
const PEER = { name: 'node', exe: '/Applications/Claude.app/Contents/MacOS/Claude', ppid: 4242, verified: false };
const boot = async ({ local = {}, sync = {}, tabs = [] } = {}) => {
  const worker = require('./worker-env.cjs');
  const { fakeIDB } = require('./fake-idb.cjs');
  const G = require('../../lib/mcp/grants.js');
  const idb = fakeIDB().indexedDB;
  idb.dbs.set('glaze-mcp-settings', new Map([['settings', new Map([['on', true]])]]));
  await G.open(idb).pair(PEER, 'Claude', ['courses', 'grades', 'assignments']);
  const store = { sync: { version: 2, enabled: true, enhance: {}, ...sync }, local: { ultra: [], mcp: { on: true }, ...local }, session: {} };
  const w = worker({ store, background: wired(), globals: { indexedDB: idb } });
  const b = browser(tabs);
  Object.assign(w.context.chrome.tabs, b.tabs);
  w.context.chrome.scripting.executeScript = b.scripting.executeScript;
  let n = 0;
  const windows = { made: [], create: async () => { n++; const x = { id: 100 + n, tabs: [{ id: 200 + n, windowId: 100 + n }] }; windows.made.push(x); return x; }, remove: async () => {}, onRemoved: { addListener() {} } };
  w.context.chrome.windows = windows;
  w.context.chrome.runtime.connectNative = () => ({ onMessage: { addListener() {} }, onDisconnect: { addListener() {} }, postMessage() {}, disconnect() {} });
  for (const t of tabs) {
    t.context.chrome.runtime.sendMessage = (m, cb) => { t.page.sent.push(structuredClone(m)); return w.send(m, { id: 'glaze', tab: { id: t.info.id }, frameId: 0, url: t.info.url, origin: new URL(t.info.url).origin }).then((r) => { cb?.(r); return r; }); };
  }
  return { w, store, b, windows };
};
// Agent access off: the link and its timers stop, so the test's process can end.
const off = async (env) => { await env.w.context.chrome.storage.local.set({ mcp: { on: false } }); await env.w.settle(); };
// The student's answer to the action ask waiting in the approval window, from that window's tab. → the ask's record.
const answer = async (env, value) => {
  for (let i = 0; i < 400; i++) {
    const rec = Object.values(env.store.session).find((r) => r?.state === 'waiting' && r.kind === 'action');
    const win = env.store.session.mcpAskWindow && env.windows.made.find((x) => x.id === env.store.session.mcpAskWindow.id);
    if (rec && win) {
      const s = { id: 'glaze', tab: { id: win.tabs[0].id, windowId: win.id }, frameId: 0, url: 'chrome-extension://x/lib/mcp/approve.html' };
      await env.w.send({ type: 'glaze:mcp-ask', id: rec.id, answer: value }, s);
      return rec;
    }
    await pause(5);
  }
  throw new Error('no action ask');
};
// One agent connection straight on the worker's engine, initialized: ask(message) → its answer; lines() → all it heard.
const conn = async (w) => {
  const out = [];
  w.context.mcpOut = out;
  await vm.runInContext('mcpCore().ready', w.context);
  vm.runInContext(`globalThis.mcpTest = mcpCore().wire.conn(77, ${JSON.stringify(PEER)}, (l) => mcpOut.push(l), () => {});`, w.context);
  const send = (m) => vm.runInContext(`mcpTest.line(${JSON.stringify(JSON.stringify(m))})`, w.context);
  const lines = () => out.map((l) => JSON.parse(l));
  const ask = async (m) => {
    send(m);
    for (let i = 0; i < 1000; i++) { const r = lines().find((x) => x.id === m.id && ('result' in x || 'error' in x)); if (r) return r; await pause(5); }
    throw new Error(`no answer to ${m.id}`);
  };
  await ask({ jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'Claude', version: '1' } } });
  send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  const call = (id, name, args = {}) => ask({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } });
  return { ask, send, call, lines };
};

module.exports = { tab, browser, publish, quiet, json, pause, writerArea, WIRING, wired, read, boot, off, answer, conn, PEER };
