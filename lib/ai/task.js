// The AI harness's tasks (docs/ai-harness.md): what a feature (later, a mod) asks a model to do, defined once, versioned, and
// run the same way on every provider. A task (lib/ai/tasks/<id>.js, added with define):
//   id: 'syllabus.read' (dotted lower-case words), version: 1 (raise it when its output changes; results carry it),
//   caps: { images?, tools? } (what a provider must have; json always),
//   input(raw) → the input cleaned, or null (refused: raw came from a page),
//   build(input, { caps, text, fence }) → a request without its schema (lib/ai/text.js request() fences the data),
//   output: the answer's JSON Schema (an object at the root; lib/ai/schema.js),
//   check(output, input) → the output cleaned (grounded, in range), or null (refused),
//   tools?: [names] (lib/ai/tools.js; run through lib/ai/loop.js), limits?: { steps, ms, tokens, maxTokens },
//   stream?: true (the page may see the model's words as they come; off for JSON answers, which are only read checked),
//   split?(input, { budget, text }) → [input] and merge([output], input) → output: a long input in parts, each its own
//     request, put back together before check. budget: tokens a part's data may take on this provider.
// Classic script for the worker; module.exports for node.
var GZ_AI_TASKS = globalThis.GZ_AI_TASKS || (() => {
  const R = () => (typeof GZ_AI_REQUEST !== 'undefined' ? GZ_AI_REQUEST : require('./request.js'));
  const S = () => (typeof GZ_AI_SCHEMA !== 'undefined' ? GZ_AI_SCHEMA : require('./schema.js'));
  const P = () => (typeof GZ_AI_PROVIDERS !== 'undefined' ? GZ_AI_PROVIDERS : require('./providers.js'));
  const L = () => (typeof GZ_AI_LOOP !== 'undefined' ? GZ_AI_LOOP : require('./loop.js'));
  const X = () => (typeof GZ_AI_TEXT !== 'undefined' ? GZ_AI_TEXT : require('./text.js'));
  const TL = () => (typeof GZ_AI_TOOLS !== 'undefined' ? GZ_AI_TOOLS : require('./tools.js'));
  const ID = /^[a-z][a-z0-9-]{0,31}(\.[a-z][a-z0-9-]{0,31}){0,3}$/;
  // parts: most requests one run makes; context: tokens assumed when a provider doesn't say; ms: a whole run's default.
  const LIMIT = { parts: 20, context: 16000, ms: 180000 };
  const fn = (v) => typeof v === 'function';
  const KEYS = ['id', 'version', 'caps', 'input', 'build', 'output', 'check', 'tools', 'limits', 'stream', 'split', 'merge'];
  // → the task, frozen; throws a TypeError that says what is wrong with it.
  const define = (def) => {
    const d = R().isObj(def) ? def : {};
    const lim = d.limits;
    const why = Object.keys(d).find((k) => !KEYS.includes(k)) || (!ID.test(d.id) && 'id') || (!(Number.isSafeInteger(d.version) && d.version > 0) && 'version')
      || ((d.caps !== undefined && (!R().isObj(d.caps) || Object.entries(d.caps).some(([k, v]) => !['images', 'tools'].includes(k) || typeof v !== 'boolean'))) && 'caps')
      || (!['input', 'build', 'check'].every((k) => fn(d[k])) && 'input, build and check')
      || (S().clean(d.output)?.type !== 'object' && 'output')
      || ((d.tools !== undefined && (!Array.isArray(d.tools) || !d.tools.length || !d.tools.every((n) => R().NAME.test(n)))) && 'tools')
      || ((lim !== undefined && (!R().isObj(lim) || Object.entries(lim).some(([k, v]) => !['steps', 'ms', 'tokens', 'maxTokens'].includes(k) || !Number.isSafeInteger(v) || v <= 0))) && 'limits')
      || ((d.stream !== undefined && typeof d.stream !== 'boolean') && 'stream')
      || ((fn(d.split) !== fn(d.merge) || (d.split !== undefined && !fn(d.split))) && 'split and merge');
    if (why) throw new TypeError(`task ${typeof d.id === 'string' ? d.id.slice(0, 64) : '?'}: ${why}`);
    const t = Object.freeze({ ...d, caps: Object.freeze({ ...d.caps }), limits: Object.freeze({ ...d.limits }), stream: d.stream === true });
    defined.add(t);
    return t;
  };
  const defined = new WeakSet();
  const all = new Map();
  const add = (def) => { const t = defined.has(def) ? def : define(def); if (all.has(t.id) && all.get(t.id) !== t) throw new TypeError(`task ${t.id} is already added`); all.set(t.id, t); return t; };
  const get = (id) => all.get(id) || null;

  // run(task, raw input, { provider (id or object), cfg, signal, onDelta, onProgress({ part, parts }), onStep, fetch,
  //   tools (a lib/ai/tools.js registry; the harness's own by default), ctx }) → { output, proposals?, meta: { task, version,
  //   provider, finish, usage, steps, parts } }. Throws { code }.
  const run = async (task, raw, { provider, cfg, signal, onDelta, onProgress, onStep, fetch, tools = TL(), ctx } = {}) => {
    const Q = R();
    const p = typeof provider === 'string' ? P().get(provider) : provider;
    const c = p && p.config(cfg);
    if (!c) throw Q.error('setup');
    const can = P().caps(p, c);
    if (Object.entries(task.caps).some(([k, want]) => want && !can[k]) || !can.json || (task.tools && !can.tools)) throw Q.error('caps');
    const input = task.input(raw);
    if (input === null || input === undefined) throw Q.error('input');
    const kit = (task.tools || []).map((n) => tools.get(n) || (() => { throw Q.error('tool', n); })());
    const budget = Math.floor((can.context || LIMIT.context) * 0.6);
    const inputs = task.split ? task.split(input, { budget, text: X() }) : [input];
    if (!Array.isArray(inputs) || !inputs.length || inputs.length > LIMIT.parts) throw Q.error('size', 'parts');
    // One deadline for the whole run, the caller's cancel within it.
    const ctl = new AbortController(), stop = () => ctl.abort(signal.reason);
    if (signal?.aborted) throw Q.error('cancelled');
    signal?.addEventListener('abort', stop, { once: true });
    const timer = setTimeout(() => ctl.abort(new DOMException('Timed out', 'TimeoutError')), task.limits.ms || LIMIT.ms);
    const outputs = [], proposals = [], usage = { input: 0, output: 0 };
    let steps = 0, finish = 'stop';
    try {
      for (const [i, part] of inputs.entries()) {
        if (ctl.signal.aborted) break;
        onProgress?.({ part: i + 1, parts: inputs.length });
        const built = task.build(part, { caps: can, text: X(), fence: X().fence() });
        if (!Q.isObj(built)) throw Q.error('input', 'build');
        const request = { ...built, schema: task.output, ...(task.limits.maxTokens && built.maxTokens === undefined && { maxTokens: task.limits.maxTokens }) };
        const opts = { signal: ctl.signal, onDelta: task.stream ? onDelta : undefined, fetch };
        const res = kit.length
          ? await L().run({ request, tools: kit, call: (r, o) => P().run(p, r, c, { ...opts, ...o }), limits: task.limits, signal: ctl.signal, onDelta: opts.onDelta, onStep, ctx })
          : await P().run(p, request, c, opts);
        if (res.json === undefined) throw Q.error('format', 'no answer');
        outputs.push(res.json);
        steps += res.steps || 1;
        usage.input += res.usage?.input || 0; usage.output += res.usage?.output || 0;
        proposals.push(...(res.proposals || []));
        finish = res.finish;
      }
    } catch (e) {
      if (ctl.signal.aborted) throw Q.error(ctl.signal.reason?.name === 'TimeoutError' ? 'timeout' : 'cancelled');
      throw Q.CODES.includes(e?.code) ? e : Q.error(Q.code(e));
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', stop); }
    if (ctl.signal.aborted) throw Q.error(ctl.signal.reason?.name === 'TimeoutError' ? 'timeout' : 'cancelled');
    const merged = inputs.length > 1 ? task.merge(outputs, input) : outputs[0];
    if (inputs.length > 1 && S().validate(merged, task.output).length) throw Q.error('format', 'merge');
    const output = task.check(merged, input);
    if (output === null || output === undefined) throw Q.error('check');
    return { output, ...(proposals.length && { proposals }), meta: { task: task.id, version: task.version, provider: p.id, finish, usage, steps, parts: inputs.length } };
  };

  return { LIMIT, ID, define, add, get, run, list: () => [...all.keys()] };
})();
if (typeof module !== 'undefined') module.exports = GZ_AI_TASKS; else GZ_AI_TASKS;
