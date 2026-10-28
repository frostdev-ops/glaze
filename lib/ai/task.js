// The AI harness's tasks (docs/ai-harness.md): what a feature (later, a mod) asks a model to do, defined once, versioned, and
// run the same way on every provider. A task (lib/ai/tasks/<id>.js, added with define):
//   id: 'syllabus.read' (dotted lower-case words), version: 1 (raise it when its output changes; results carry it),
//   caps: { images?, tools? } (what a provider must have; json always),
//   input(raw) → the input cleaned, or null (refused: raw came from a page),
//   build(input, { caps, text, fence }) → a request without its schema (lib/ai/text.js request() fences the data),
//   output: the answer's JSON Schema (an object at the root; lib/ai/schema.js), or 'text': the model's words as they are
//     (no schema; an answer cut off at maxTokens comes back as far as it got, meta.truncated),
//   check(output, input, { truncated }) → the output cleaned (grounded, in range), or null (refused); a text task's output
//     is the text,
//   tools?: [names] (lib/ai/tools.js; run through lib/ai/loop.js), limits?: { steps (rounds), ms, tokens, maxTokens },
//   stream?: true (the page may see the model's words as they come; a keyed endpoint's JSON answer only once checked),
//   rate?: { perMinute?, supersede? } (lib/ai/broker.js: perMinute, runs a tab's feature may start of this task in a minute,
//     instead of the broker's; supersede, a new run of it in the same tab and feature cancels the one in flight instead of
//     being refused busy, and its runs share one call-record row a minute),
//   disclose?: true (the feature shows the student where the text goes first: a run must carry status's `to`, and a
//     connection over the network runs only to that host),
//   split?(input, { budget, text }) → [input] and merge([output], input) → output: a long input in parts, each its own
//     request, put back together before check. budget: tokens a part's data may take on this provider.
// A run emits lib/ai/loop.js's events (thinking, text_delta, says, step_start, step, pending, usage, reply) and a note
// { part, parts } as each part starts. A tool that waits for the student ends the run with `pending` and no output.
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
  const KEYS = ['id', 'version', 'caps', 'input', 'build', 'output', 'check', 'tools', 'limits', 'stream', 'disclose', 'rate', 'split', 'merge', 'warm'];
  // rate.perMinute at most: a supersede task's runs are short and replace each other.
  const RATE = 120;
  // → the task, frozen; throws a TypeError that says what is wrong with it.
  const define = (def) => {
    const d = R().isObj(def) ? def : {};
    const lim = d.limits;
    const why = Object.keys(d).find((k) => !KEYS.includes(k)) || (!ID.test(d.id) && 'id') || (!(Number.isSafeInteger(d.version) && d.version > 0) && 'version')
      || ((d.caps !== undefined && (!R().isObj(d.caps) || Object.entries(d.caps).some(([k, v]) => !['images', 'tools'].includes(k) || typeof v !== 'boolean'))) && 'caps')
      || (!['input', 'build', 'check'].every((k) => fn(d[k])) && 'input, build and check')
      || (d.output !== 'text' && S().clean(d.output)?.type !== 'object' && 'output')
      || ((d.tools !== undefined && (!Array.isArray(d.tools) || !d.tools.length || !d.tools.every((n) => R().NAME.test(n)))) && 'tools')
      || ((lim !== undefined && (!R().isObj(lim) || Object.entries(lim).some(([k, v]) => !['steps', 'ms', 'tokens', 'maxTokens'].includes(k) || !Number.isSafeInteger(v) || v <= 0))) && 'limits')
      || ((d.stream !== undefined && typeof d.stream !== 'boolean') && 'stream')
      || ((d.disclose !== undefined && typeof d.disclose !== 'boolean') && 'disclose')
      || ((d.warm !== undefined && typeof d.warm !== 'boolean') && 'warm')
      || ((d.rate !== undefined && (!R().isObj(d.rate) || !Object.keys(d.rate).length || Object.entries(d.rate).some(([k, v]) => (k === 'perMinute' ? !(Number.isSafeInteger(v) && v > 0 && v <= RATE) : k !== 'supersede' || typeof v !== 'boolean')))) && 'rate')
      || ((fn(d.split) !== fn(d.merge) || (d.split !== undefined && !fn(d.split))) && 'split and merge');
    if (why) throw new TypeError(`task ${typeof d.id === 'string' ? d.id.slice(0, 64) : '?'}: ${why}`);
    const t = Object.freeze({ ...d, caps: Object.freeze({ ...d.caps }), limits: Object.freeze({ ...d.limits }), stream: d.stream === true, disclose: d.disclose === true, warm: d.warm === true, ...(d.rate && { rate: Object.freeze({ ...d.rate }) }) });
    defined.add(t);
    return t;
  };
  const defined = new WeakSet();
  const all = new Map();
  const add = (def) => { const t = defined.has(def) ? def : define(def); if (all.has(t.id) && all.get(t.id) !== t) throw new TypeError(`task ${t.id} is already added`); all.set(t.id, t); return t; };
  const get = (id) => all.get(id) || null;

  // run(task, raw input, { provider (id or object), cfg, signal, emit(event), fetch, tools (a lib/ai/tools.js registry; the
  //   harness's own by default), policy, headless, confirms, ctx, over }) → { output, steps?, pending?, meta: { task,
  //   version, provider, finish, usage, rounds, parts, truncated? } }, or { pending, steps, meta } when a tool waits for the
  //   student. over: what the student set in Settings → AI ({ effort?, temperature?, maxTokens?, timeoutMs? }), each
  //   request's over the task's own; a timeout longer than the task's whole run lengthens the run to it. Throws { code }.
  const run = async (task, raw, { provider, cfg, signal, emit = () => {}, fetch, tools = TL(), policy, headless, confirms, ctx, over = {} } = {}) => {
    const Q = R();
    const p = typeof provider === 'string' ? P().get(provider) : provider;
    const c = p && p.config(cfg);
    if (!c) throw Q.error('setup');
    const can = P().caps(p, c);
    const text = task.output === 'text';
    if (Object.entries(task.caps).some(([k, want]) => want && can[k] === false) || (!text && can.json === false) || (task.tools && can.tools === false)) throw Q.error('caps');
    const input = task.input(raw);
    if (input === null || input === undefined) throw Q.error('input');
    const kit = (task.tools || []).map((n) => tools.get(n) || (() => { throw Q.error('tool', n); })());
    const budget = Math.floor((can.context || LIMIT.context) * 0.6);
    const inputs = task.split ? task.split(input, { budget, text: X() }) : [input];
    if (!Array.isArray(inputs) || !inputs.length || inputs.length > LIMIT.parts) throw Q.error('size', 'parts');
    // One deadline for the whole run, the caller's cancel within it.
    const F = typeof GZ_AI_FAILURE !== 'undefined' ? GZ_AI_FAILURE : require('./failure.js');
    if (signal?.aborted) throw Object.assign(Q.error('cancelled'), { category: 'cancelled' });
    // The loop's own default is 120 s (lib/ai/loop.js LIMIT.ms).
    const longer = over.timeoutMs > (task.limits.ms || 120000), limits = longer ? { ...task.limits, ms: over.timeoutMs } : task.limits;
    const timer = F.deadline(Math.max(task.limits.ms || LIMIT.ms, over.timeoutMs || 0)), both = F.anySignal([signal, timer.signal]);
    const outputs = [], steps = [], usage = { input: 0, output: 0 };
    let rounds = 0, finish = 'stop', pending;
    try {
      for (const [i, part] of inputs.entries()) {
        if (both.signal.aborted) break;
        if (inputs.length > 1) emit({ type: 'note', part: i + 1, parts: inputs.length });
        const built = task.build(part, { caps: can, text: X(), fence: X().fence() });
        if (!Q.isObj(built)) throw Q.error('input', 'build');
        const request = { ...built, ...(!text && { schema: task.output }), ...(task.limits.maxTokens && built.maxTokens === undefined && { maxTokens: task.limits.maxTokens }), ...own(over) };
        const call = (r, o) => P().run(p, r, c, { ...o, fetch });
        const res = await L().run({ request, tools: kit, call, policy, rounds: task.limits.steps, limits, headless, stream: task.stream, signal: both.signal, emit, ctx, confirms });
        steps.push(...res.steps);
        rounds += res.rounds;
        usage.input += res.usage?.input || 0; usage.output += res.usage?.output || 0;
        if (res.pending) { pending = res.pending; break; }
        if (res.paused) throw Q.error('steps');
        if (text ? typeof res.text !== 'string' : res.json === undefined) throw Object.assign(F.modelFailure({ category: 'invalid-response' }), { detail: 'no answer' });
        outputs.push(text ? res.text : res.json);
        finish = res.finish;
      }
    } catch (e) {
      if (both.signal.aborted && !Q.CODES.includes(e?.code)) throw F.modelFailure(e, { aborted: !!signal?.aborted });
      if (both.signal.aborted) throw signal?.aborted ? Object.assign(Q.error('cancelled'), { category: 'cancelled' }) : Object.assign(Q.error('timeout'), { category: 'timeout' });
      throw Q.CODES.includes(e?.code) ? e : Q.error(Q.code(e));
    } finally { timer.done(); both.done(); }
    if (both.signal.aborted) throw signal?.aborted ? Object.assign(Q.error('cancelled'), { category: 'cancelled' }) : Object.assign(Q.error('timeout'), { category: 'timeout' });
    const truncated = text && finish === 'length';
    const meta = { task: task.id, version: task.version, provider: p.id, finish, usage, rounds, parts: inputs.length, ...(truncated && { truncated: true }) };
    if (pending) return { pending, steps, meta };
    const merged = inputs.length > 1 ? task.merge(outputs, input) : outputs[0];
    if (inputs.length > 1 && (text ? typeof merged !== 'string' : S().validate(merged, task.output).length)) throw Object.assign(F.modelFailure({ category: 'invalid-response' }), { detail: 'merge' });
    const output = task.check(merged, input, { truncated, caps: can });
    if (output === null || output === undefined) throw Q.error('check');
    return { output, ...(steps.length && { steps }), meta };
  };

  // The student's settings a request takes: only those Glaze knows, as lib/ai/request.js cleans them.
  const own = (over) => Object.fromEntries(['effort', 'temperature', 'maxTokens', 'timeoutMs'].filter((k) => R().isObj(over) && over[k] !== undefined).map((k) => [k, over[k]]));
  // prepare(task, raw input, { provider, cfg, over }) → the request a run of it would send first, or null: what a warm-up
  // (lib/ai/broker.js op warm) gives the provider so it reads the instructions before the run comes. A split task: null.
  const prepare = (task, raw, { provider, cfg, over = {} } = {}) => {
    const p = typeof provider === 'string' ? P().get(provider) : provider;
    const c = p && p.config(cfg);
    if (!c || task.split) return null;
    const input = task.input(raw);
    if (input === null || input === undefined) return null;
    const built = task.build(input, { caps: P().caps(p, c), text: X(), fence: X().fence() });
    return R().isObj(built) ? { ...built, ...(task.output !== 'text' && { schema: task.output }), ...own(over) } : null;
  };

  return { LIMIT, ID, define, add, get, run, prepare, list: () => [...all.keys()] };
})();
if (typeof module !== 'undefined') module.exports = GZ_AI_TASKS; else GZ_AI_TASKS;
