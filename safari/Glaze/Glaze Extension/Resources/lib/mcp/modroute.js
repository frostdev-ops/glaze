// A mod's code tools for agent apps (lib/mcp/registry.js's code): an agent app's call, answered by the mod's own Worker in an
// open tab of the account's school, in Chrome only, where code mods run. The call goes to Glaze's content script in a tab's
// top frame (features/mods.js, 'glaze:modtool'): 'call' hands it to the mod's Worker as a 'tool.call' event when that page is
// the account's and runs the mod, and says at once whether it did, so the next tab is tried when it didn't; 'wait' answers
// once the call has ended there. The Worker's answer comes as the broker's 'tools.result' (lib/modbroker.js), checked as every
// call of a mod's is, and the broker hands it to settle, for the one call waiting for it from that tab. At most
// LIMIT.timeout from the call; the mod stopped or the page gone ends it at once. A call once handed over runs to its end
// (lib/mcp/calls.js: what is logged is what happened), so a cancel is heeded only before.
// create({ tabs (chrome.tabs: query, sendMessage), browser ('chrome' | 'firefox' | 'safari'), quiet?(path) (a page code mods
//   never run on: lib/background.js modQuiet), timers?, id?() (a call's id) }) → { code(mod, name, args, ctx) → the Worker's
//   answer, or a failure ({ ok: false, error } or { cancelled }, lib/ai/tools.js toolFailure), settle(sender, mod, call,
//   out: { value } | { error }) → whether a call waiting for it took it }.
// Classic script for the worker, after lib/mcp/tools-study.js (its account parser); module.exports for node.
var GZ_MCP_MODROUTE = globalThis.GZ_MCP_MODROUTE || (() => {
  const P = () => (typeof GZ_MCP_STUDY !== 'undefined' ? GZ_MCP_STUDY : require('./tools-study.js'));
  // timeout: a call, from its start; args: what one may carry (the broker's limit for a mod's call, lib/modbroker.js); pending:
  // one mod's calls at once; tabs: the tabs one call tries.
  const LIMIT = { timeout: 15e3, args: (1 << 20) + 16 * 1024, pending: 16, tabs: 8 };
  const TEXT = {
    chrome: "This mod's agent tools run only in Chrome.",
    account: "Glaze couldn't tell which school account this call is for.",
    args: "The arguments are too large for this mod's tool.",
    busy: "Too many calls to this mod's tools are waiting; try again once they are answered.",
    open: (school) => `Open ${school}, signed in as this account; this mod's tool runs there.`,
    stopped: 'The mod stopped before it answered.',
    timeout: "The mod's tool didn't answer within 15 seconds.",
    refused: (code) => `Glaze refused the mod's answer (${code}).`,
    failed: (why) => `The mod's tool failed: ${why}`,
  };
  const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
  const fail = (error) => ({ ok: false, error });
  const originOf = (url) => { try { return new URL(url).origin; } catch { return null; } };

  const create = (o) => {
    const d = isObj(o) ? o : {};
    if (!isObj(d.tabs) || typeof d.tabs.query !== 'function' || typeof d.tabs.sendMessage !== 'function') throw new TypeError('mcp modroute: tabs');
    const { tabs } = d;
    const timers = d.timers || globalThis;
    const quiet = typeof d.quiet === 'function' ? d.quiet : () => false;
    const newId = typeof d.id === 'function' ? d.id : () => (globalThis.crypto || require('node:crypto').webcrypto).randomUUID();
    const pending = new Map(); // call id → { mod, origin, tab (the one it is handed to, or null), end(answer) }

    // The school's tabs where its mods could run, most likely first: the one shown, then the latest used, one asleep last.
    const candidates = async (origin) => {
      const all = await tabs.query({});
      return (Array.isArray(all) ? all : []).filter((t) => {
        if (!Number.isSafeInteger(t?.id) || t.id < 0 || t.discarded || typeof t.url !== 'string') return false;
        let u;
        try { u = new URL(t.url); } catch { return false; }
        let p = u.pathname;
        try { p = decodeURIComponent(p); } catch { /* as it is */ }
        return u.protocol === 'https:' && u.origin === origin && !quiet(p);
      }).sort((a, b) => (b.active === true) - (a.active === true) || (a.frozen === true) - (b.frozen === true) || (b.lastAccessed || 0) - (a.lastAccessed || 0))
        .slice(0, LIMIT.tabs);
    };
    const ask = (tab, m) => Promise.resolve().then(() => tabs.sendMessage(tab, { type: 'glaze:modtool', ...m }, { frameId: 0 })).catch(() => null);

    const code = async (mod, name, args, ctx) => {
      if (d.browser !== 'chrome') return fail(TEXT.chrome);
      const who = P().parse(ctx?.account);
      if (!who) return fail(TEXT.account);
      const given = isObj(args) ? args : {};
      let size;
      try { size = new TextEncoder().encode(JSON.stringify(given)).length; } catch { return fail(TEXT.args); }
      if (size > LIMIT.args) return fail(TEXT.args);
      if ([...pending.values()].filter((e) => e.mod === mod).length >= LIMIT.pending) return fail(TEXT.busy);
      const signal = ctx?.signal;
      if (signal?.aborted) return { cancelled: true };
      const call = newId();
      return new Promise((resolve) => {
        const e = { mod, origin: who.origin, tab: null, done: false };
        const end = (r) => {
          if (e.done) return;
          e.done = true;
          timers.clearTimeout(timer);
          if (pending.get(call) === e) pending.delete(call);
          resolve(r);
        };
        const timer = timers.setTimeout(() => end(fail(TEXT.timeout)), LIMIT.timeout);
        e.end = end;
        pending.set(call, e);
        (async () => {
          for (const t of await candidates(who.origin)) {
            if (e.done) return;
            if (signal?.aborted) return end({ cancelled: true });
            // Bound to this tab before it is asked: a quick Worker can answer before the page's reply arrives.
            e.tab = t.id;
            const r = await ask(t.id, { op: 'call', mod, call, name, args: given, account: who.account });
            if (e.done) return;
            if (r?.ok !== true) { e.tab = null; continue; }
            const w = await ask(t.id, { op: 'wait', call });
            // An answer the broker took came before this (settle); this says how a call ended without one.
            const code = w?.ok === false && typeof w.error === 'string' && /^[a-z]{1,16}$/.test(w.error) ? w.error : 'stopped';
            return end(fail(code === 'timeout' ? TEXT.timeout : code === 'stopped' ? TEXT.stopped : TEXT.refused(code)));
          }
          end(fail(TEXT.open(new URL(who.origin).host)));
        })().catch(() => end(fail(TEXT.stopped)));
      });
    };

    // The Worker's answer, from the broker: only for the call waiting for it, from that mod, from the tab it was handed to,
    // in its top frame, on the school's site.
    const settle = (s, mod, call, out) => {
      const e = typeof call === 'string' ? pending.get(call) : undefined;
      if (!e || e.done || e.mod !== mod || e.tab === null || !isObj(s) || s.tab?.id !== e.tab || s.frameId !== 0 || originOf(s.url) !== e.origin || !isObj(out)) return false;
      e.end(typeof out.error === 'string' ? fail(TEXT.failed(out.error)) : out.value === undefined ? null : out.value);
      return true;
    };

    return { code, settle };
  };
  return { LIMIT, TEXT, create };
})();
if (typeof module !== 'undefined') module.exports = GZ_MCP_MODROUTE; else GZ_MCP_MODROUTE;
