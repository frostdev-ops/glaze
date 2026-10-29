// Ported from Rimeward src/lib/agent/tools.ts (ToolKind, ToolDef, aiTools, invokeReadTool) and tasks.ts (toolFailure) (MIT).
// The AI harness's tools (docs/ai-harness.md): what a model may call while a task runs (lib/ai/loop.js). A tool:
//   { name: 'courses_list' (snake_case), kind: 'read' | 'write' | 'confirm', description, parameters (lib/ai/schema.js, an
//     object at the root), run(args, ctx) → data, summarize?(args, ctx) → the sentence a confirm shows, built from data }
// 'read' answers with data; 'write' changes something; 'confirm' does something the student must see first: Glaze's
// proposals. Whether a kind runs, waits for the student or is refused is the run's policy (lib/ai/loop.js). Every call
// carries a `reason` (aiTools adds it to each tool's parameters); arguments come from the model and are checked against
// parameters before run sees them. Glaze's own tools in H1 are read or confirm only; a write tool needs its own review.
// What the MCP view reads (lib/mcp/*.js), each optional: title (≤ 120), group (courses, grades, writer, assignments, or a
// mod's mod:<id>), owner ('glaze' when absent, or mod:<id>), scope ('account' | 'document'), needs ('tab' | 'writer': what
// must be open), output (a schema accepted by lib/ai/schema.js), hints ({ idempotent?, openWorld? }: booleans). A mod's tool
// is named mod_<id>_<local> (local [a-z][a-z0-9_]{0,23}) in the group mod:<id>; Glaze's names never start with mod_.
// Classic script for the worker; module.exports for node.
var GZ_AI_TOOLS = globalThis.GZ_AI_TOOLS || (() => {
  const R = () => (typeof GZ_AI_REQUEST !== 'undefined' ? GZ_AI_REQUEST : require('./request.js'));
  const S = () => (typeof GZ_AI_SCHEMA !== 'undefined' ? GZ_AI_SCHEMA : require('./schema.js'));
  const KINDS = ['read', 'write', 'confirm'];
  const LIMIT = { description: 1024, title: 120 };
  const GROUPS = ['courses', 'grades', 'writer', 'assignments'];
  const SCOPES = ['account', 'document'];
  const NEEDS = ['tab', 'writer'];
  const HINTS = ['idempotent', 'openWorld'];
  const MOD = /^mod:[a-z2-7]{16}$/, LOCAL = /^[a-z][a-z0-9_]{0,23}$/;
  const defined = new WeakSet();
  const KEYS = ['name', 'kind', 'description', 'parameters', 'run', 'summarize', 'revision', 'title', 'group', 'owner', 'scope', 'needs', 'output', 'hints'];
  const one = (v, list) => v === undefined || list.includes(v);
  // A mod's tool: mod_<id>_<local>, in its own group. Glaze's: never mod_, never a mod's group.
  const named = (name, owner) => (owner.startsWith('mod:') ? name.startsWith(`mod_${owner.slice(4)}_`) && LOCAL.test(name.slice(21)) : !name.startsWith('mod_'));
  const grouped = (group, owner) => (owner.startsWith('mod:') ? group === owner : one(group, GROUPS));
  const isGroup = (g) => GROUPS.includes(g) || (typeof g === 'string' && MOD.test(g));
  // The MCP keys' check: '' or the key that is wrong.
  const mcp = (d) => {
    const owner = d.owner === undefined ? 'glaze' : d.owner;
    return typeof owner !== 'string' || !(owner === 'glaze' || MOD.test(owner)) ? 'owner' : !named(d.name, owner) ? 'name' : !grouped(d.group, owner) ? 'group'
      : d.title !== undefined && (typeof d.title !== 'string' || !d.title || d.title.length > LIMIT.title) ? 'title'
        : !one(d.scope, SCOPES) ? 'scope' : !one(d.needs, NEEDS) ? 'needs' : d.output !== undefined && !S().clean(d.output) ? 'output'
          : d.hints !== undefined && !(R().isObj(d.hints) && Object.entries(d.hints).every(([k, v]) => HINTS.includes(k) && typeof v === 'boolean')) ? 'hints' : '';
  };
  // → the tool, frozen; throws a TypeError that says what is wrong with it.
  const define = (t) => {
    const d = R().isObj(t) ? t : {};
    const parameters = d.parameters ?? S().obj({});
    const extra = Object.keys(d).find((k) => !KEYS.includes(k));
    const why = extra ? `unknown ${extra}` : !R().NAME.test(d.name) ? 'name'
      : !KINDS.includes(d.kind) ? 'kind' : typeof d.description !== 'string' || !d.description || d.description.length > LIMIT.description ? 'description'
        : S().clean(parameters)?.type !== 'object' || Object.hasOwn(parameters.properties || {}, 'reason') ? 'parameters' : typeof d.run !== 'function' ? 'run'
          : d.summarize !== undefined && typeof d.summarize !== 'function' ? 'summarize' : mcp(d);
    if (why) throw new TypeError(`tool ${typeof d.name === 'string' ? d.name.slice(0, 64) : '?'}: ${why}`);
    const out = Object.freeze({ ...d, parameters });
    defined.add(out);
    return out;
  };
  const is = (t) => defined.has(t);
  // A set of tools by name: the harness keeps one (add, get); a feature or a test may make its own.
  const registry = () => {
    const all = new Map();
    return {
      add: (t) => { const d = is(t) ? t : define(t); if (all.has(d.name) && all.get(d.name) !== d) throw new TypeError(`tool ${d.name} is already added`); all.set(d.name, d); return d; },
      get: (name) => all.get(name) || null,
      list: () => [...all.keys()],
    };
  };
  const REASON = { type: 'string', minLength: 1, maxLength: 300, description: 'REQUIRED. One short, concrete sentence explaining this action, shown to the student. Never claim success before the result.' };
  // The specs a request carries: the tools `allow` lets through ('all', or 'read-only': read tools only), sorted by name,
  // each with `reason` required (Rimeward enforces it in the loop, not only asks).
  const aiTools = (tools, allow = 'all') => tools.filter((t) => allow === 'all' || t.kind === 'read').sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    .map((t) => ({ name: t.name, description: t.description, parameters: { ...t.parameters, properties: { reason: REASON, ...(t.parameters.properties || {}) }, required: ['reason', ...(t.parameters.required || [])] } }));
  // A sandbox's (later, a mod's) way to a tool: read tools only, by name. → its answer as JSON.
  const invokeReadTool = async (tools, name, argsJson, ctx) => {
    const t = tools.get(name);
    if (!t || t.kind !== 'read') throw new Error(`tools.${name}: not a read-only tool`);
    const args = argsJson ? JSON.parse(argsJson) : {};
    if (S().validate(args, t.parameters).length) throw new Error(`tools.${name}: invalid arguments`);
    return JSON.stringify((await t.run(args, ctx)) ?? null);
  };
  // Whether a tool's answer reports a failure, and what. null when it doesn't.
  const toolFailure = (value) => {
    if (!value || typeof value !== 'object') return null;
    if (value.cancelled === true) return 'Cancelled.';
    if (value.error != null) return String(value.error) || 'Tool reported failure.';
    return value.ok === false ? 'Tool reported failure.' : null;
  };
  const tools = registry();
  return { KINDS, GROUPS, LIMIT, REASON, define, isGroup, is, registry, aiTools, invokeReadTool, toolFailure, add: tools.add, get: tools.get, list: tools.list };
})();
if (typeof module !== 'undefined') module.exports = GZ_AI_TOOLS; else GZ_AI_TOOLS;
