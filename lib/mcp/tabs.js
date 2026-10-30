// Agent apps' reads through an open LMS tab (lib/mcp/calls.js refresh, and the tools that need a tab): the account's own tab,
// found by its school's origin and the account Glaze's own content script there reads (GZ_CTX.account, in the top frame, as
// lib/background.js modAccount asks it), never a quiz's, a test's or a tool's page (quiet: lib/background.js modQuiet) nor a
// discarded or frozen tab (spike S5: a discarded tab "answers" from an empty document). Then lib/mcp/tab.js goes into the
// document that answered, and reads there through the page's own paths. The active tab first, then the one used last.
// create({ tabs (chrome.tabs: query), scripting (chrome.scripting: executeScript), quiet(path) → whether Glaze stays out of
//   that page, limit? ({ probe, read } ms, for tests) }) → {
//   find(account) → { tabId, documentId? } | null,
//   run(account, op, args, { signal }) → the tab side's answer ({ ok, … }), or null with no tab; past limit.read,
//     { ok: false, error: 'timeout' }; a cancelled signal rejects,
//   refresh(account, group, { signal, tool }) → { ok, source: 'tab' } | null (no tab, or a group no tab refreshes) }.
// An account is '<origin>/<uid>' (lib/mcp/tools-study.js parse). Classic script for the worker; module.exports for node.
var GZ_MCP_TABS = globalThis.GZ_MCP_TABS || (() => {
  const FILE = 'lib/mcp/tab.js';
  // probe: how long a tab may take to say whose it is (lib/background.js modAccount's); read: the most a tab's read takes
  // (lib/mcp/calls.js LIMIT.refresh); tabs: how many of a school's tabs are asked.
  const LIMIT = { probe: 1500, read: 8e3, tabs: 8 };
  const UID = /^(\d{1,20}|_\d{1,20}_\d{1,20})$/;
  // What each group's caches are read with in the tab: courses and assignments_list read the planner; grades, Insights.
  const OPS = { courses: 'todo', assignments: 'todo', grades: 'insights' };
  const parse = (a) => {
    if (typeof a !== 'string' || a.length > 300) return null;
    const i = a.lastIndexOf('/'), origin = a.slice(0, i), uid = a.slice(i + 1);
    try { return new URL(origin).origin === origin && UID.test(uid) ? { origin, uid } : null; } catch { return null; }
  };
  const later = (ms, value) => { let t; const p = new Promise((res) => { t = setTimeout(() => res(value), ms); }); p.stop = () => clearTimeout(t); return p; };

  const create = (o) => {
    const d = o || {};
    if (typeof d.tabs?.query !== 'function' || typeof d.scripting?.executeScript !== 'function' || typeof d.quiet !== 'function') throw new TypeError('mcp tabs: tabs, scripting, quiet');
    const limit = { ...LIMIT, ...d.limit };
    // A tab Glaze may read for this school: its own origin (a URL comes back only for hosts Glaze holds), a page Glaze runs
    // on, and loaded.
    const fits = (t, origin) => {
      if (!Number.isInteger(t?.id) || t.discarded || t.frozen === true || t.status === 'unloaded' || typeof t.url !== 'string') return false;
      try { const u = new URL(t.url); return u.origin === origin && !d.quiet(decodeURIComponent(u.pathname)); } catch { return false; }
    };
    // Whether the tab's top frame is Glaze's, on, and signed in as uid; → its document, or null.
    const probe = async (t, who) => {
      const ask = Promise.resolve().then(() => d.scripting.executeScript({ target: { tabId: t.id, frameIds: [0] }, func: async (origin, uid) => {
        const c = globalThis.GZ_CTX;
        const here = () => (globalThis.origin || location.origin) === origin && !!c && globalThis.GZ_CTX === c && c.on();
        try { if (!here()) return false; const a = await c.account(); return here() && String(a) === uid; } catch { return false; }
      }, args: [who.origin, who.uid] })).then((r) => (r?.[0]?.result === true ? { tabId: t.id, ...(typeof r[0].documentId === 'string' && { documentId: r[0].documentId }) } : null), () => null);
      const timer = later(limit.probe, null);
      try { return await Promise.race([ask, timer]); } finally { timer.stop(); }
    };
    const find = async (account) => {
      const who = parse(account);
      if (!who) return null;
      let all;
      try { all = await d.tabs.query({}); } catch { return null; }
      const here = (Array.isArray(all) ? all : []).filter((t) => fits(t, who.origin))
        .sort((a, b) => (b.active === true) - (a.active === true) || (Number(b.lastAccessed) || 0) - (Number(a.lastAccessed) || 0)).slice(0, limit.tabs);
      // All asked at once; the first in that order that is the account's.
      const asked = here.map((t) => probe(t, who));
      for (const p of asked) { const r = await p; if (r) return r; }
      return null;
    };
    const run = async (account, op, args, { signal } = {}) => {
      signal?.throwIfAborted();
      const tab = await find(account);
      if (!tab) return null;
      signal?.throwIfAborted();
      const target = tab.documentId ? { tabId: tab.tabId, documentIds: [tab.documentId] } : { tabId: tab.tabId, frameIds: [0] };
      const read = (async () => {
        await d.scripting.executeScript({ target, files: [FILE] });
        const r = await d.scripting.executeScript({ target, func: (op, args) => (globalThis.GZ_MCP_TAB ? globalThis.GZ_MCP_TAB.run(op, args) : null), args: [op, { ...args, ms: limit.read }] });
        const v = r?.[0]?.result;
        return v && typeof v === 'object' && typeof v.ok === 'boolean' ? v : { ok: false, error: 'no answer' };
      })().catch(() => ({ ok: false, error: 'gone' }));
      const timer = later(limit.read, { ok: false, error: 'timeout' });
      let stop;
      const cancelled = new Promise((res, rej) => { stop = () => rej(signal.reason ?? new DOMException('Aborted', 'AbortError')); signal?.addEventListener('abort', stop, { once: true }); });
      cancelled.catch(() => {});
      try { return await Promise.race([read, timer, cancelled]); } finally { timer.stop(); signal?.removeEventListener('abort', stop); }
    };
    const refresh = async (account, group, { signal, tool } = {}) => {
      const op = Object.hasOwn(OPS, group) ? OPS[group] : null;
      if (!op || !parse(account)) return null;
      const r = await run(account, op, { tool: typeof tool === 'string' ? tool : '' }, { signal });
      return r === null ? null : { ok: r.ok === true, source: 'tab' };
    };
    return { find, run, refresh };
  };
  return { LIMIT, OPS, FILE, create };
})();
if (typeof module !== 'undefined') module.exports = GZ_MCP_TABS; else GZ_MCP_TABS;
