// The MCP view of the tools: Glaze's own (a GZ_AI_TOOLS registry; only those with a group) and the tools of the mods that can
// run (lib/modtools.js defs, defined with lib/ai/tools.js's keys), as MCP Tool descriptors. The list is the same for every
// connection, as the spec asks (clientInfo is self-reported); grants are checked when a tool is called (lib/mcp/calls.js).
// state: { tools (a GZ_AI_TOOLS registry), mods: [the installed records, as lib/background.js modRead keeps them, with name and
//   tools], dev (storage.local modDev), blocklist (modsBlocklist's list), browser: 'chrome' | 'firefox' | 'safari', runtime
//   (storage.local modRuntime: { ok }), data(source, account) → { at, items, missing? } (or the items): a source's answer for
//   an account (<origin>/<uid>), as lib/modbroker.js CALLS give it; code(mod, name, args, ctx) → a code tool's answer (its
//   Worker's, through an open tab); now() }. A mod is listed while it is on, not blocked and, as an unsigned copy, only in
//   dev mode (lib/modbroker.js usable); its code tools only in Chrome once a page found the mods sandbox working.
// list(state, era?) → the descriptors, by name; get(name, state) → the defined tool or null; describe(tool, era?) → one
// descriptor; hash(list) → its fingerprint, for list_changed. Raw output schemas are refused here: calls.js adds its own
// envelope and may replace large answers with an omission receipt, in both protocol eras.
// Pure: no extension APIs. Classic script for the worker (it needs lib/ai/tools.js, lib/modtools.js and lib/modbroker.js
// first); module.exports for node.
var GZ_MCP_REGISTRY = globalThis.GZ_MCP_REGISTRY || (() => {
  const T = () => (typeof GZ_AI_TOOLS !== 'undefined' ? GZ_AI_TOOLS : require('../ai/tools.js'));
  const M = () => (typeof GZ_MODTOOLS !== 'undefined' ? GZ_MODTOOLS : require('../modtools.js'));
  const B = () => (typeof GZ_MODBROKER !== 'undefined' ? GZ_MODBROKER : require('../modbroker.js'));
  const NS = 'io.frostdev.glaze/';
  const LEGACY = ['legacy', '2025-11-25', '2025-06-18'];
  const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
  const copy = (v) => JSON.parse(JSON.stringify(v));
  const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
  // The argument a scoped tool gains, named as its scope: which account (optional; calls.js resolves it), or which document.
  const SCOPE = {
    account: { type: 'string', minLength: 1, maxLength: 320, description: "Which account's data, by its id from accounts_list (<origin>/<uid>). Needed only when Glaze holds more than one." },
    document: { type: 'string', minLength: 1, maxLength: 320, description: 'Which document, by its key from documents_list.' },
  };

  const describe = (t, era) => {
    if (t.output !== undefined) throw new TypeError('mcp registry: output schemas do not describe the call envelope');
    // A mod's Worker can change its storage and granted network hosts; a read-only dispatcher does not exist yet.
    const code = t.owner?.startsWith('mod:') && t.needs === 'tab';
    const change = code || t.kind !== 'read';
    const inputSchema = copy(t.parameters);
    if (SCOPE[t.scope]) inputSchema.properties = { ...inputSchema.properties, [t.scope]: { ...SCOPE[t.scope] } };
    if (t.scope === 'document') inputSchema.required = [...(inputSchema.required || []).filter((k) => k !== 'document'), 'document'];
    return {
      name: t.name, ...(t.title !== undefined && { title: t.title }), description: t.description, inputSchema,
      annotations: { readOnlyHint: !change, destructiveHint: !!code, idempotentHint: !code && (!change || t.hints?.idempotent === true), openWorldHint: t.hints?.openWorld === true },
      _meta: { [`${NS}group`]: t.group, ...(t.needs !== undefined && { [`${NS}needs`]: t.needs }), ...(change && { [`${NS}approval`]: 'student' }) },
    };
  };

  // A declarative tool answers from its source's cache for the account calls.js resolved; a code tool from the mod's Worker.
  const answer = (tool, s) => async (args, ctx) => {
    if (typeof s.data !== 'function') throw new Error('mcp registry: no data path');
    const got = await s.data(tool.from, ctx?.account);
    const r = Array.isArray(got) ? { items: got } : isObj(got) ? got : {};
    return { account: ctx?.account ?? null, at: Number.isFinite(r.at) ? r.at : null, items: M().apply(tool, r.items, args, (s.now || Date.now)()),
      ...(typeof r.missing === 'string' && { missing: r.missing }) };
  };
  const worker = (id, name, s) => async (args, ctx) => {
    if (typeof s.code !== 'function') throw new Error('mcp registry: no code runner');
    return s.code(id, name, args, ctx);
  };
  // One manifest entry at a time, so each descriptor runs on the entry it was made from; one C1 refuses is left out.
  const modTools = (rec, s) => {
    const code = s.browser === 'chrome' && s.runtime?.ok === true;
    return (Array.isArray(rec.manifest.tools) ? rec.manifest.tools : []).flatMap((entry) => {
      if (!isObj(entry) || (entry.code === true && !code)) return [];
      try {
        // The runner keeps the same source and filters that passed the grant check, even if the input record changes.
        const t = copy(entry);
        return M().defs({ ...rec, manifest: { ...rec.manifest, tools: [t] } }).map((d) => T().define({ ...d,
          ...(t.code === true && { kind: 'confirm', summarize: () => `Run ${d.title}.` }),
          run: t.code === true ? worker(rec.id, t.name, s) : answer(t, s) }));
      } catch { return []; }
    });
  };
  // Every listed tool by name. Glaze's own come first and a name is never taken twice, though C1 keeps mod_ names for mods.
  const all = (state) => {
    const s = isObj(state) ? state : {}, out = new Map();
    const put = (t) => { if (!out.has(t.name)) out.set(t.name, t); };
    const reg = s.tools;
    for (const n of typeof reg?.list === 'function' ? reg.list() : []) {
      const t = reg.get(n);
      if (!isObj(t) || t.output !== undefined || t.group === undefined || (t.owner !== undefined && t.owner !== 'glaze')) continue;
      try { put(T().is(t) ? t : T().define(t)); } catch { /* not a tool C1 takes */ }
    }
    const mods = (Array.isArray(s.mods) ? s.mods : []).filter((r) => B().usable(r, r?.id, s.dev === true) && !B().blocked(s.blocklist, r));
    // Repeated records have no unambiguous owner/revision. Refuse that mod rather than let input order choose its tools.
    const counts = new Map();
    for (const r of mods) counts.set(r.id, (counts.get(r.id) || 0) + 1);
    for (const r of mods.filter((r) => counts.get(r.id) === 1).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) modTools(r, s).forEach(put);
    return out;
  };

  const list = (state, era) => [...all(state).values()].sort(byName).map((t) => describe(t, era));
  const get = (name, state) => all(state).get(name) || null;
  // FNV-1a and a second pass with another multiplier, as 16 hex digits: a fingerprint for list_changed, not a secret.
  const hash = (tools) => {
    const s = JSON.stringify(tools);
    let a = 0x811c9dc5, b = 0x050c5d1f;
    for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); a = Math.imul(a ^ c, 0x01000193); b = Math.imul(b ^ c, 0x5bd1e995); }
    return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
  };

  return { NS, LEGACY, list, get, describe, hash };
})();
if (typeof module !== 'undefined') module.exports = GZ_MCP_REGISTRY; else GZ_MCP_REGISTRY;
