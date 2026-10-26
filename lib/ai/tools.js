// The AI harness's tools (docs/ai-harness.md): what a model may ask for while a task runs (lib/ai/loop.js). A tool:
//   { name: 'courses_list' (lower case, digits, _), description, params (lib/ai/schema.js, an object at the root),
//     run(args, { signal, ctx }) → data, or { proposal } , kind: 'read' }
// Tools only read: run answers with data, or with a proposal (something the page shows the student to confirm and does
// itself, never the tool). 'read' is the only kind there is; one that writes needs its own review and kind. A tool's
// arguments come from the model, so they are checked against params before run sees them, and what a tool answers goes
// back to the model as data, within LIMIT.output. Classic script for the worker; module.exports for node.
var GZ_AI_TOOLS = globalThis.GZ_AI_TOOLS || (() => {
  const R = () => (typeof GZ_AI_REQUEST !== 'undefined' ? GZ_AI_REQUEST : require('./request.js'));
  const S = () => (typeof GZ_AI_SCHEMA !== 'undefined' ? GZ_AI_SCHEMA : require('./schema.js'));
  const LIMIT = { output: 64 << 10, ms: 10000, description: 1024 };
  const KINDS = ['read'];
  const define = ({ name, description, params = { type: 'object', properties: {}, additionalProperties: false }, run, kind = 'read', ...rest }) => {
    const why = Object.keys(rest).length ? `unknown ${Object.keys(rest)[0]}` : !R().NAME.test(name) ? 'name' : typeof description !== 'string' || !description || description.length > LIMIT.description ? 'description'
      : S().clean(params)?.type !== 'object' ? 'params' : typeof run !== 'function' ? 'run' : !KINDS.includes(kind) ? 'kind' : '';
    if (why) throw new TypeError(`tool ${name}: ${why}`);
    const t = Object.freeze({ name, description, params, run, kind });
    defined.add(t);
    return t;
  };
  const defined = new WeakSet();
  // A set of tools by name. The harness keeps one (add, get); a test or a feature may make its own.
  const registry = () => {
    const all = new Map();
    return {
      add: (t) => { if (all.has(t.name) && all.get(t.name) !== t) throw new TypeError(`tool ${t.name} is already added`); all.set(t.name, defined.has(t) ? t : define(t)); return all.get(t.name); },
      get: (name) => all.get(name) || null,
      list: () => [...all.keys()],
    };
  };
  const spec = (t) => ({ name: t.name, description: t.description, params: t.params });
  // One call: → { ok: true, data } | { ok: true, proposal } | { ok: false, error } (words for the model: what didn't fit,
  // or a code, never a tool's own message).
  const call = async (tool, args, { signal, ctx } = {}) => {
    const errors = S().validate(args, tool.params);
    if (errors.length) return { ok: false, error: `invalid arguments: ${errors.join('; ')}` };
    const c = new AbortController(), stop = () => c.abort(signal.reason);
    if (signal?.aborted) return { ok: false, error: 'cancelled' };
    signal?.addEventListener('abort', stop, { once: true });
    const timer = setTimeout(() => c.abort(new DOMException('Timed out', 'TimeoutError')), LIMIT.ms);
    try {
      const out = await Promise.race([tool.run(structuredClone(args), { signal: c.signal, ctx }), new Promise((_, no) => c.signal.addEventListener('abort', () => no(c.signal.reason), { once: true }))]);
      let json;
      try { json = JSON.stringify(out ?? null); } catch { return { ok: false, error: 'failed' }; }
      if (new TextEncoder().encode(json).length > LIMIT.output) return { ok: false, error: 'size' };
      const v = JSON.parse(json);
      if (R().isObj(v) && Object.keys(v).length === 1 && Object.hasOwn(v, 'proposal')) return R().isObj(v.proposal) ? { ok: true, proposal: v.proposal } : { ok: false, error: 'failed' };
      return { ok: true, data: v };
    } catch (e) { return { ok: false, error: R().code(e) }; } finally { clearTimeout(timer); signal?.removeEventListener('abort', stop); }
  };
  const tools = registry();
  return { LIMIT, KINDS, define, is: (t) => defined.has(t), registry, spec, call, add: tools.add, get: tools.get, list: tools.list };
})();
if (typeof module !== 'undefined') module.exports = GZ_AI_TOOLS; else GZ_AI_TOOLS;
