// The AI harness's tasks (docs/ai-harness.md): what a feature (later, a mod) asks a model to do, defined once, versioned, and
// run the same way on every provider. A task (ai/tasks/<id>.js, added with define):
//   id: 'syllabus.read' (dotted lower-case words), version: 1 (raise it when its output changes; results carry it),
//   caps: { images?, tools? } (what a provider must have; json always),
//   input(raw, { caps }) → the input cleaned, or null (refused: raw came from a page); caps are provider-owned,
//   build(input, { caps, text, fence }) → a request without its schema (ai/text.js request() fences the data),
//   output: the answer's JSON Schema (an object at the root; ai/schema.js), or 'text': the model's words as they are
//     (no schema; an answer cut off at maxTokens comes back as far as it got, meta.truncated); a request carries it
//     bare (schema.js bare(): no span), and Glaze's own model finds its spans by the task's id (providers/local.js),
//   check(output, input, { truncated }) → the output cleaned (grounded, in range), or null (refused); a text task's output
//     is the text,
//   tools?: [names] (ai/tools.js; run through ai/loop.js), limits?: { steps (rounds), ms, tokens, maxTokens },
//   stream?: true (the page may see the model's words as they come; a keyed endpoint's JSON answer only once checked),
//   rate?: { perMinute?, supersede? } (ai/broker.js: perMinute, runs a tab's feature may start of this task in a minute,
//     instead of the broker's; supersede, a new run of it in the same tab and feature cancels the one in flight instead of
//     being refused busy, and its runs share one call-record row a minute),
//   disclose?: true (the feature shows the student where the text goes first: a run must carry status's `to`, and a
//     connection over the network runs only to that host),
//   split?(input, { budget, room, caps, text, count }) → [input] (or Promise) and merge([output], input) → output: a long input in parts, each its own
//     request, put back together before check. budget: legacy data estimate; count(built) includes the real answer reserve.
//   orchestrate?(input, { caps, text, ask, fits, signal, limits }) → a raw output, or undefined for the ordinary run.
//     Trusted task code only. ask(request, { output?, check?, accept?, call? }) uses this run's provider, deadline and
//     accounting (accept: providers.js run's, a looser schema the answer is checked against); it never retries. Calls are
//     sequential and bounded by limits.calls (at most LIMIT.calls). fits reserves output room.
//     ask's call: the orchestration's own kind of request (CALL, e.g. writer.feedback's decide, explain, summary, scan),
//     on the request's task info beside id and version, which no provider sends; Glaze's own model reads it
//     (ai/providers/local.js THINK).
// A run emits ai/loop.js's events (thinking, text_delta, says, step_start, step, pending, usage, reply) and a note
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
  const LIMIT = { parts: 20, calls: 64, context: 16000, ms: 180000 };
  const fn = (v) => typeof v === 'function';
  const CALL = /^[a-z]{1,16}$/;
  const KEYS = ['id', 'version', 'caps', 'input', 'build', 'output', 'check', 'tools', 'limits', 'stream', 'disclose', 'rate', 'split', 'merge', 'warm', 'orchestrate', 'why'];
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
      || ((lim !== undefined && (!R().isObj(lim) || Object.entries(lim).some(([k, v]) => !['steps', 'ms', 'tokens', 'maxTokens', 'calls'].includes(k) || !Number.isSafeInteger(v) || v <= 0 || (k === 'calls' && v > LIMIT.calls)))) && 'limits')
      || ((d.stream !== undefined && typeof d.stream !== 'boolean') && 'stream')
      || ((d.disclose !== undefined && typeof d.disclose !== 'boolean') && 'disclose')
      || ((d.warm !== undefined && typeof d.warm !== 'boolean') && 'warm')
      || ((d.why !== undefined && !fn(d.why)) && 'why')
      || ((d.rate !== undefined && (!R().isObj(d.rate) || !Object.keys(d.rate).length || Object.entries(d.rate).some(([k, v]) => (k === 'perMinute' ? !(Number.isSafeInteger(v) && v > 0 && v <= RATE) : k !== 'supersede' || typeof v !== 'boolean')))) && 'rate')
      || ((d.orchestrate !== undefined && (!fn(d.orchestrate) || d.split || d.tools || d.stream)) && 'orchestrate')
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

  // run(task, raw input, { provider (id or object), cfg, signal, emit(event), fetch, tools (a ai/tools.js registry; the
  //   harness's own by default), policy, headless, confirms, ctx, over }) → { output, steps?, pending?, meta: { task,
  //   version, provider, finish, usage, rounds, parts, truncated? } }, or { pending, steps, meta } when a tool waits for the
  //   student. over: what the student set in Settings → AI ({ effort?, temperature?, maxTokens?, timeoutMs? }), each
  //   request's over the task's own (a higher effort with room to think: mine); a timeout longer than the task's whole run
  //   lengthens the run to it. Throws { code }.
  const run = async (task, raw, { provider, cfg, signal, emit = () => {}, fetch, tools = TL(), policy, headless, confirms, ctx, imageCache, over = {} } = {}) => {
    const Q = R();
    const p = typeof provider === 'string' ? P().get(provider) : provider;
    const c = p && p.config(p.id === 'local' && R().isObj(cfg) && over.effort !== undefined ? { ...cfg, effort: over.effort } : cfg);
    if (!c) throw Q.error('setup');
    const can = P().caps(p, c);
    const text = task.output === 'text';
    if (Object.entries(task.caps).some(([k, want]) => want && can[k] === false) || (!text && can.json === false) || (task.tools && can.tools === false)) throw Q.error('caps');
    const input = task.input(raw, { caps: can });
    if (input === null || input === undefined) throw Q.error('input');
    const kit = (task.tools || []).map((n) => tools.get(n) || (() => { throw Q.error('tool', n); })());
    // A local run's default accounting grows with the effective window (bounded at 128K). Explicit task budgets,
    // deadlines and request counts remain authoritative; a large valid prompt must not trip the old 60K run default.
    const window = Math.min(can.context || LIMIT.context, 131072, p.id === 'local' && p.profileWindow ? p.profileWindow(can.context || LIMIT.context, c) : Infinity);
    const tokenLimit = task.limits.tokens || (can.local === true ? Math.max(L().LIMIT.tokens[0], window * 2) : L().LIMIT.tokens[0]);
    const room = Math.min(window, L().limit('tokens', tokenLimit));
    const budget = Math.floor(room * 0.6);
    let inputs;
    // One deadline for the whole run, the caller's cancel within it.
    const F = typeof GZ_AI_FAILURE !== 'undefined' ? GZ_AI_FAILURE : require('./failure.js');
    if (signal?.aborted) throw Object.assign(Q.error('cancelled'), { category: 'cancelled' });
    // The loop's own default is 120 s (ai/loop.js LIMIT.ms).
    const reasoning = p.id === 'local' && p.limits?.({ id: task.id }, window, c).think > 0;
    const ms = over.timeoutMs || (reasoning ? p.LIMIT?.reasoning ?? 300000 : task.limits.ms || LIMIT.ms);
    const limits = { ...task.limits, tokens: tokenLimit, ...(reasoning || over.timeoutMs ? { ms } : {}) };
    const expires = Date.now() + ms;
    const timer = F.deadline(ms), both = F.anySignal([signal, timer.signal]);
    const callProvider = (request, options) => P().run(p, { ...request, timeoutMs: Math.max(Q.LIMIT.timeout[0], Math.min(request.timeoutMs || ms, expires - Date.now())) }, c, options);
    const outputs = [], steps = [], usage = { input: 0, output: 0 };
    let rounds = 0, finish = 'stop', pending, orchestrated, calls = 0, inFlight = false, active = true, releaseImages;
    const checkFailure = () => Object.assign(Q.error('check'), ['writer.outline', 'writer.feedback'].includes(task.id) ? { reason: task.id.slice(7) } : {});
    const requestOf = (built, output = task.output, maxTokensCap, call) => {
      const request = mine({ ...built, ...(output !== 'text' && { schema: S().bare(output) }), ...(task.limits.maxTokens && built.maxTokens === undefined && { maxTokens: task.limits.maxTokens }), task: { ...own(task), ...(call && { call }) } }, over, p.id === 'local');
      if (Number.isSafeInteger(maxTokensCap) && maxTokensCap > 0 && maxTokensCap <= Q.LIMIT.maxTokens) request.maxTokens = Math.min(request.maxTokens || maxTokensCap, maxTokensCap);
      return request;
    };
    // Exact counts when offered; the same trusted request and answer/thinking reserve are used for splitting and inference.
    let lastCount;
    const counted = async (request, options) => {
      const key = JSON.stringify({ ...request, timeoutMs: undefined });
      if (lastCount?.key === key) return lastCount.value;
      const value = await P().count(p, request, c, options);
      lastCount = { key, value };
      return value;
    };
    const count = async (built) => {
      const request = Q.clean(requestOf(built));
      if (!request) throw Q.error('request');
      const n = await F.wait(() => counted(request, { signal: both.signal }), both.signal);
      if (!n) throw Q.error('request');
      const reserve = reserved(p, request, room, c, n.tokens);
      return { ...n, used: n.tokens, reserve, window: room, available: room - reserve };
    };
    const fits = (built, { output = task.output, maxTokensCap } = {}) => {
      const request = requestOf(built, output, maxTokensCap), context = room;
      const pictures = (request.messages || []).flatMap((m) => Array.isArray(m.content) ? m.content : []).filter((c) => c.type === 'image').length;
      const prompt = X().estimateTokens(request);
      return prompt + (p.id === 'local' ? reserved(p, request, room, c, prompt + Math.max(128, Math.ceil(context * 0.08))) : (request.maxTokens || 1024) + pictures * 1024) + Math.max(128, Math.ceil(context * 0.08)) <= context;
    };
    const ask = async (built, { output = task.output, check, note, maxTokensCap, call, accept } = {}) => {
      if (!active) throw Q.error('limit', 'finished');
      if (call !== undefined && !(typeof call === 'string' && CALL.test(call))) throw Q.error('input', 'call');
      if (both.signal.aborted) throw both.signal.reason;
      if (inFlight || calls >= (task.limits.calls || LIMIT.parts)) throw Q.error('limit', 'calls');
      if (!Q.isObj(built) || (output !== 'text' && S().clean(output)?.type !== 'object')) throw Q.error('input', 'build');
      if (!fits(built, { output, maxTokensCap })) throw Object.assign(Q.error('size'), { reason: 'context' });
      inFlight = true; calls++;
      emit({ type: 'note', part: calls, parts: task.limits.calls || LIMIT.parts, ...(Q.isObj(note) && ['evidence', 'criterion', 'summary'].includes(note.stage) && Number.isSafeInteger(note.part) && Number.isSafeInteger(note.parts) && note.part > 0 && note.part <= note.parts ? { stage: note.stage, part: note.part, parts: note.parts } : {}) });
      try {
        const request = requestOf(built, output, maxTokensCap, call);
        const res = await L().run({ request, tools: [], call: (r, o) => callProvider(r, { ...o, fetch, ...(accept && { accept }) }), policy, rounds: task.limits.steps, limits, count: can.local === true && room > 4096 ? (r, o) => counted(r, o) : undefined, headless, stream: false, signal: both.signal, emit, ctx, confirms });
        steps.push(...res.steps); rounds += res.rounds;
        usage.input += res.usage?.input || 0; usage.output += res.usage?.output || 0;
        if (both.signal.aborted) throw both.signal.reason;
        if (res.pending || res.paused) throw Q.error('steps');
        const answer = output === 'text' ? res.text : res.json;
        if (answer === undefined) throw Object.assign(F.modelFailure({ category: 'invalid-response' }), { detail: 'no answer' });
        finish = res.finish;
        const checked = check ? check(answer) : answer;
        if (checked === null || checked === undefined) throw checkFailure();
        return checked;
      } finally { inFlight = false; }
    };
    try {
      inputs = task.split ? await F.wait(() => task.split(input, { budget, room, caps: { ...can, context: room }, text: X(), count }), both.signal) : [input];
      if (!Array.isArray(inputs) || !inputs.length || inputs.length > LIMIT.parts) throw Q.error('size', 'parts');
      let visuals;
      if (task.orchestrate && ['writer.image', 'writer.feedback'].includes(task.id) && imageCache) {
        try {
          visuals = await F.wait(() => typeof imageCache === 'function' ? imageCache(input, both.signal) : imageCache, both.signal);
          if (typeof visuals?.hold === 'function') releaseImages = await F.wait(() => visuals.hold(), both.signal);
        }
        catch (e) { if (both.signal.aborted) throw e; /* A disposable cache never prevents assessment. */ }
      }
      if (task.orchestrate) orchestrated = await F.wait(() => task.orchestrate(input, { caps: can.context ? { ...can, context: room } : can, text: X(), ask, fits, signal: both.signal, imageCache: visuals, limits: { calls: task.limits.calls || LIMIT.parts } }), both.signal);
      for (const [i, part] of (orchestrated === undefined ? inputs : []).entries()) {
        if (both.signal.aborted) break;
        if (inputs.length > 1) emit({ type: 'note', part: i + 1, parts: inputs.length });
        const built = task.build(part, { caps: can, text: X(), fence: X().fence() });
        if (!Q.isObj(built)) throw Q.error('input', 'build');
        const request = mine({ ...built, ...(!text && { schema: S().bare(task.output) }), ...(task.limits.maxTokens && built.maxTokens === undefined && { maxTokens: task.limits.maxTokens }), task: own(task) }, over, p.id === 'local');
        if (can.local === true && room > 4096) {
          const n = await count(built);
          if (n.used + n.reserve > room) throw Object.assign(Q.error('size'), { reason: 'context' });
        }
        const call = (r, o) => callProvider(r, { ...o, fetch });
        const res = await L().run({ request, tools: kit, call, policy, rounds: task.limits.steps, limits, count: can.local === true && room > 4096 ? (r, o) => counted(r, o) : undefined, headless, stream: task.stream, signal: both.signal, emit, ctx, confirms });
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
    } finally { active = false; releaseImages?.(); timer.done(); both.done(); }
    if (both.signal.aborted) throw signal?.aborted ? Object.assign(Q.error('cancelled'), { category: 'cancelled' }) : Object.assign(Q.error('timeout'), { category: 'timeout' });
    const truncated = text && finish === 'length';
    const meta = { task: task.id, version: task.version, provider: p.id, finish, usage, rounds, parts: orchestrated === undefined ? inputs.length : calls, ...(truncated && { truncated: true }) };
    if (pending) return { pending, steps, meta };
    const merged = orchestrated === undefined ? (inputs.length > 1 ? task.merge(outputs, input) : outputs[0]) : orchestrated;
    if ((orchestrated !== undefined || inputs.length > 1) && (text ? typeof merged !== 'string' : S().validate(merged, task.output).length)) throw Object.assign(F.modelFailure({ category: 'invalid-response' }), { detail: 'merge' });
    const output = task.check(merged, input, { truncated, caps: can });
    // why(output, input): a task's own name for the rule a refused output broke; raw: that output, for the requester only.
    if (output === null || output === undefined) {
      let why, raw;
      try { why = task.why?.(merged, input); raw = typeof merged === 'string' ? merged : JSON.stringify(merged); } catch { /* none */ }
      throw Object.assign(checkFailure(), typeof why === 'string' && why && { why }, typeof raw === 'string' && { raw: raw.slice(0, 2000) });
    }
    return { output, ...(steps.length && { steps }), meta };
  };

  // The task a request is for, as ai/request.js keeps it: Glaze's own model reads its token by it (ai/local/format.js).
  const own = (task) => ({ id: task.id, version: task.version });
  // The student's settings a request takes: only those Glaze knows, as ai/request.js cleans them.
  const theirs = (over) => Object.fromEntries(['effort', 'temperature', 'maxTokens', 'timeoutMs'].filter((k) => R().isObj(over) && over[k] !== undefined).map((k) => [k, over[k]]));
  // Reasoning counts against a request's output (OpenRouter's docs: an effort takes about a tenth to four fifths of
  // max_tokens; one too small thinks it all away and answers nothing). An effort the student set above the task's own gets
  // the room that effort thinks in beside the answer's own, unless the student set the output too.
  const ROOM = { none: 0, minimal: 1024, low: 2048, medium: 4096, high: 8192 };
  const mine = (request, over, local = false) => {
    const out = { ...request, ...theirs(over) }, more = (ROOM[out.effort] ?? 0) - (ROOM[request.effort || 'none'] ?? 0);
    if (!local && more > 0 && over?.maxTokens === undefined && Number.isSafeInteger(request.maxTokens)) out.maxTokens = Math.min(R().LIMIT.maxTokens, request.maxTokens + more);
    return out;
  };
  // prepare(task, raw input, { provider, cfg, over }) → the request a run of it would send first, or null: what a warm-up
  // (ai/broker.js op warm) gives the provider so it reads the instructions before the run comes. A split task: null.
  const prepare = (task, raw, { provider, cfg, over = {} } = {}) => {
    const p = typeof provider === 'string' ? P().get(provider) : provider;
    const c = p && p.config(p.id === 'local' && R().isObj(cfg) && over.effort !== undefined ? { ...cfg, effort: over.effort } : cfg);
    if (!c || task.split || task.orchestrate) return null;
    const input = task.input(raw, { caps: P().caps(p, c) });
    if (input === null || input === undefined) return null;
    const built = task.build(input, { caps: P().caps(p, c), text: X(), fence: X().fence() });
    return R().isObj(built) ? mine({ ...built, ...(task.output !== 'text' && { schema: S().bare(task.output) }), ...(task.limits.maxTokens && built.maxTokens === undefined && { maxTokens: task.limits.maxTokens }), task: own(task) }, over, p.id === 'local') : null;
  };

  // No page-controlled field selects the retention size. Missing caps retain the established 4K bounds.
  const retention = (caps = {}) => {
    const context = Math.max(4096, Math.min(131072, Number.isSafeInteger(caps.context) ? caps.context : 4096));
    return { context, scale: context / 4096 };
  };
  const reserved = (provider, request, window, cfg = {}, promptTokens) => {
    request = R().clean(request);
    if (!request) throw R().error('request');
    const effective = provider.profileWindow ? provider.profileWindow(window, cfg) : Math.min(window, cfg.context || cfg.window || provider.TUNED || window);
    const local = provider.id === 'local' && typeof provider.limits === 'function' ? provider.limits(request.task, effective, { maxTokens: request.maxTokens, ...cfg, promptTokens }) : null;
    // Keep the entire configured think allowance even when a slow machine currently answers directly.
    return (local ? local.maxTokens + local.think + (local.think || provider.adaptive?.(request.task, effective, cfg) ? provider.CLOSE || 0 : 0) : request.maxTokens || 1024) + R().images(request) * 1024;
  };
  // Partition supplied text by complete requests, including schema, instructions, answer and thinking. Nothing is lost:
  // each character appears in a part; overlaps keep a boundary phrase together. A small guard covers changing part labels.
  const splitText = async (inp, { count, text }, { build, parts: maxParts, overlap = 0 }) => {
    const fits = async (value) => { const n = await count(build(value)); return n.used + n.reserve + 128 <= n.window; };
    if (await fits(inp)) return [inp];
    const parts = []; let at = 0;
    while (at < inp.text.length) {
      if (parts.length >= maxParts) throw R().error('size', 'parts');
      const part = (end) => ({ ...inp, text: inp.text.slice(at, end), part: maxParts, parts: maxParts, whole: inp.text, ...(parts.length && { images: [] }) });
      let lo = at, hi = inp.text.length;
      while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); if (await fits(part(mid))) lo = mid; else hi = mid - 1; }
      if (lo === at) throw R().error('size', 'context');
      // Prefer a complete paragraph or word when it costs less than five percent of this part.
      const span = inp.text.slice(at, lo), boundary = Math.max(span.lastIndexOf('\n'), span.lastIndexOf(' '));
      const end = lo < inp.text.length && boundary > span.length * 0.95 ? at + boundary + 1 : lo;
      parts.push(part(end));
      if (end === inp.text.length) break;
      at = Math.max(at + 1, end - overlap > at ? end - overlap : end);
    }
    const out = parts.map((part, i) => ({ ...part, part: i + 1, parts: parts.length }));
    for (const part of out) if (!await fits(part)) throw R().error('size', 'context');
    return out;
  };

  return { LIMIT, ID, retention, reserved, splitText, define, add, get, run, prepare, list: () => [...all.keys()] };
})();
if (typeof module !== 'undefined') module.exports = GZ_AI_TASKS; else GZ_AI_TASKS;
