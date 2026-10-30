// The engine host for Glaze's own model (docs/ai-harness.md "Glaze's own model"): a dedicated Worker that downloads the
// weights (ai/local/store.js), loads them into the WebGPU engine (ai/local/engine.js) and keeps them loaded between
// requests, runs one sequence at a time, and keeps the system turn of up to three instructions read (snapshots), so a
// warm-up or a run with the same instructions starts after them. Chrome starts it from an offscreen document
// (ai/local/offscreen.js), Firefox from the background event page (ai/local/link.js); both pass messages to it as they are.
//   in  { op: 'config', idle }  { op: 'detach' } (the worker's port went: runs and warm-ups stop, a download goes on)
//       { id, op: 'prepare', tier? }  { id, op: 'run', model, parts, stable, schema?, sampler, maxTokens }
//       { id, op: 'warm', model, parts }  { id, op: 'remove' }  { id, op: 'release' }  { id, op: 'cancel' }
//   out { id, type: 'progress', loaded }  { id, type: 'delta', text }  { id, type: 'done', result }
//       { id, type: 'error', error: { category, reason?, code?, tokens?, context? } }  { type: 'tick' } (every LIMIT.tick
//       while anything is in flight: Chrome's worker hears it and stays)  { type: 'idle' } (LIMIT.idle with nothing in
//       flight: the engine is released and the host may go)
// parts come from ai/local/format.js and are tokenized here with encodeWith, never by reading specials out of text.
// The engine, the JSON grammar and the tier ladder are their own files (engine.js, grammar.js, ladder.js); a missing one
// is reported (engine: 'engine') or done without (grammar: the schema in words only; ladder: the smallest stock model).
// The grammar's mask allows the end token only once the JSON is whole, so a run stops at the end token as any other.
// Classic script; node exports (create), and in a Worker it starts itself.
var GZ_AI_LOCAL_HOST = globalThis.GZ_AI_LOCAL_HOST || (() => {
  const LIMIT = { idle: 300000, tick: 20000, warm: 3, context: 16000 };
  // LFM3's GGUF sampling defaults (general.sampling.*: top_k 50, temp 0.1) where a request names none.
  const SAMPLER = Object.freeze({ temperature: 0.1, topK: 50 });
  const fail = (category, reason, extra = {}) => Object.assign(new Error(`${category}: ${reason}`), { category, reason, ...extra });
  const aborted = (signal) => signal?.reason || new DOMException('Cancelled', 'AbortError');
  // An engine's own reasons (docs/ai-harness.md), as the provider says them.
  const ENGINE = { webgpu: 'webgpu', memory: 'hardware', lost: 'engine', model: 'assets' };
  const wait = (p, signal) => (!signal ? p : new Promise((resolve, reject) => {
    if (signal.aborted) return reject(aborted(signal));
    const stop = () => reject(aborted(signal));
    signal.addEventListener('abort', stop, { once: true });
    p.then((v) => { signal.removeEventListener('abort', stop); resolve(v); }, (e) => { signal.removeEventListener('abort', stop); reject(e); });
  }));
  const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

  // env: { store (ai/local/store.js), gguf (gguf.js), tokenizer (tokenizer.js), engine(), grammar(), ladder() (each the
  // global or null), gpu() (navigator.gpu or null), bench?() (the ladder's bench kernel's source), post(message),
  // setTimeout?, clearTimeout? }.
  const create = (env) => {
    const later = env.setTimeout || setTimeout, cancelTimer = env.clearTimeout || clearTimeout;
    const ops = new Map(); // id → { control, kind }
    let idleMs = LIMIT.idle, idleTimer = null, tickTimer = null;
    let loaded = null; // { id, control, ready, model, tok, eos, base, warm: [{ ids, snap }] }
    let turn = Promise.resolve(); // one sequence at a time
    const post = (m) => { try { env.post(m); } catch { /* the host's page is gone */ } };

    // ---- idle and tick ------------------------------------------------------------------------------------------------
    const quiet = () => {
      cancelTimer(idleTimer); idleTimer = null;
      if (ops.size) { if (!tickTimer) tickTimer = later(function tick() { post({ type: 'tick' }); tickTimer = ops.size ? later(tick, LIMIT.tick) : null; }, LIMIT.tick); return; }
      cancelTimer(tickTimer); tickTimer = null;
      idleTimer = later(() => { idleTimer = null; if (ops.size) return; release(); post({ type: 'idle' }); }, idleMs);
    };

    // ---- the model ------------------------------------------------------------------------------------------------------
    const unload = () => {
      const was = loaded;
      loaded = null;
      if (!was) return;
      was.control.abort(new DOMException('Released', 'AbortError'));
      return was.ready.then((job) => { for (const w of job.warm) { try { w.snap.drop?.(); } catch { /* gone */ } } try { job.base?.drop?.(); } catch { /* gone */ } try { job.model.release(); } catch { /* gone */ } }, () => {});
    };
    // The engine with model `id`, loaded once and shared by the calls that ask together; another model releases it first.
    const load = (id) => {
      if (loaded?.id === id) return loaded.ready;
      const retired = unload();
      const E = env.engine();
      if (typeof E?.load !== 'function') return Promise.reject(fail('provider-unavailable', 'engine'));
      const job = { id, control: new AbortController(), warm: [], schemas: new Map() };
      job.ready = (async () => {
        await retired;
        if (job.control.signal.aborted) throw aborted(job.control.signal);
        let file;
        try { file = await env.store.open(id); } catch { throw fail('provider-unavailable', 'assets'); }
        let g, tok;
        try {
          g = await env.gguf.open(file);
          tok = env.tokenizer.fromGGUF(g.kv);
        } catch { throw fail('provider-unavailable', 'assets'); }
        for (const name of env.tokenizer.GLAZE_TOKENS) { try { tok.add(name); } catch { break; } }
        let model;
        try { model = await E.load(g, { context: LIMIT.context, signal: job.control.signal }); }
        catch (e) { if (job.control.signal.aborted) throw e; throw fail('provider-unavailable', ENGINE[e?.reason] || 'engine'); }
        if (job.control.signal.aborted) { try { model.release(); } catch { /* gone */ } throw aborted(job.control.signal); }
        Object.assign(job, { model, tok, eos: tok.eos ?? tok.id('<|im_end|>'), base: await model.snapshot() });
        return job;
      })();
      job.ready.catch(() => { if (loaded === job) loaded = null; });
      loaded = job;
      return job.ready;
    };
    // fn on the model, after every call queued before it; a call cancelled while it waits never runs.
    const queued = (fn, signal) => {
      const run = turn.then(() => { if (signal?.aborted) throw aborted(signal); return fn(); });
      turn = run.catch(() => {});
      return run;
    };
    const stopSequences = () => {
      for (const o of ops.values()) if (o.kind === 'run' || o.kind === 'warm') o.control.abort(new DOMException('Released', 'AbortError'));
    };
    // Retire requests immediately, but let their pending engine calls settle before freeing GPU resources.
    const release = () => { stopSequences(); return queued(unload); };
    // The model at the end of `head` (the system turn): a kept snapshot of it, else read from the start and kept.
    const prefix = async (job, head, signal) => {
      const at = job.warm.findIndex((w) => same(w.ids, head));
      if (at >= 0) { const [w] = job.warm.splice(at, 1); job.warm.push(w); await job.model.restore(w.snap); return; }
      await job.model.restore(job.base);
      const snap = await job.model.prefill(head, { snapshot: true, signal });
      if (!snap) return;
      job.warm.push({ ids: head, snap });
      while (job.warm.length > LIMIT.warm) { try { job.warm.shift().snap.drop?.(); } catch { /* gone */ } }
    };
    // The JSON grammar's matcher for a schema (grammar.js): its vocabulary once per model, each schema compiled once. No
    // grammar, or a schema it refuses: none, and the schema is said in words only (ai/local/format.js).
    const matcher = (job, schema) => {
      const G = env.grammar();
      if (!G) return null;
      try {
        job.vocab ||= G.vocab(job.tok.byteStrings(), { eos: [job.eos] });
        const key = JSON.stringify(schema);
        if (!job.schemas.has(key)) { let g = null; try { g = G.compile(schema, job.vocab); } catch { /* words only */ } job.schemas.set(key, g); if (job.schemas.size > 32) job.schemas.delete(job.schemas.keys().next().value); }
        return job.schemas.get(key)?.matcher() || null;
      } catch { return null; }
    };
    const encode = (job, parts) => {
      try { return job.tok.encodeWith(parts); } catch { throw fail('request-rejected', 'unsupported'); }
    };

    // ---- ops ------------------------------------------------------------------------------------------------------------
    // The model a download takes: one with that tier, else one already here (ready, then partial), else the ladder's pick.
    const pick = async (tier) => {
      const all = (await env.store.list()).filter((m) => m.state !== 'stale');
      if (tier) { const m = all.find((x) => x.tier === tier); return m ? { id: m.id } : { reason: 'assets' }; }
      const here = all.find((m) => m.state === 'ready') || all.find((m) => m.state === 'partial');
      if (here) return { id: here.id };
      const gpu = env.gpu();
      if (!gpu) return { reason: 'webgpu' };
      const L = env.ladder();
      if (L) {
        // ladder.js: probe() asks for the adapter and benches it (its kernel read here: a Worker has no chrome.runtime),
        // pick() decides. Its refusals, as the provider says them.
        const r = await Promise.resolve().then(async () => L.pick({ ...await L.probe({ gpu, ...(env.bench && { source: await env.bench().catch(() => undefined) }) }),
          models: all, stored: all.filter((m) => m.state !== 'missing').map((m) => m.id) })).catch(() => null);
        if (r && typeof r.id === 'string' && all.some((m) => m.id === r.id)) return { id: r.id };
        return { reason: r?.reason === 'storage' ? 'quota' : r?.reason === 'no-model' ? 'assets' : 'hardware' };
      }
      const adapter = await Promise.resolve().then(() => gpu.requestAdapter({ powerPreference: 'high-performance' })).catch(() => null);
      if (!adapter) return { reason: 'hardware' };
      const stock = all.filter((m) => m.stock).sort((a, b) => a.tier - b.tier)[0];
      return stock ? { id: stock.id } : { reason: 'assets' };
    };
    const prepare = async (m, signal) => {
      const p = await pick(Number.isSafeInteger(m.tier) && m.tier > 0 ? m.tier : 0);
      if (signal.aborted) return { state: 'download' };
      if (!p.id) return { state: 'unavailable', reason: p.reason };
      try {
        await env.store.download(p.id, { signal, onProgress: (loaded) => post({ id: m.id, type: 'progress', loaded }) });
        return { state: 'ready', model: p.id };
      } catch (e) {
        if (signal.aborted) return { state: 'download' };
        if (e?.reason === 'removed' || e?.reason === 'aborted') return { state: 'download', model: p.id };
        return { state: 'download', model: p.id, reason: e?.reason === 'quota' ? 'quota' : 'network' };
      }
    };
    const run = async (m, signal) => {
      return queued(async () => {
        const job = await wait(load(m.model), signal);
        const { model, tok } = job;
        const head = encode(job, m.parts.slice(0, m.stable)), rest = encode(job, m.parts.slice(m.stable));
        const input = head.length + rest.length, room = Math.min(model.context || LIMIT.context, LIMIT.context);
        if (input + m.maxTokens > room) throw fail('request-rejected', 'context', { tokens: input, context: room });
        await prefix(job, head, signal);
        if (rest.length) await model.prefill(rest, { signal });
        const grammar = m.schema ? matcher(job, m.schema) : null;
        const sampler = { ...SAMPLER, ...m.sampler };
        const dec = tok.decoder();
        let text = '', n = 0, finish = 'length';
        while (n < m.maxTokens) {
          if (signal.aborted) throw aborted(signal);
          const mask = grammar ? grammar.mask() : null;
          const id = await model.decode({ sampler, ...(mask && { mask }), signal });
          if (signal.aborted) throw aborted(signal);
          n++;
          if (id === job.eos) { finish = 'stop'; break; }
          grammar?.advance(id);
          const d = dec.push(id);
          if (d) { text += d; post({ id: m.id, type: 'delta', text: d }); }
        }
        const tail = dec.end();
        if (tail) { text += tail; post({ id: m.id, type: 'delta', text: tail }); }
        return { text, finish, model: m.model, usage: { input, output: n } };
      }, signal);
    };
    const warm = async (m, signal) => {
      return queued(async () => {
        if ((await env.store.status(m.model)).state !== 'ready') return { ok: false };
        const job = await wait(load(m.model), signal);
        await prefix(job, encode(job, m.parts), signal);
        return { ok: true };
      }, signal);
    };
    const remove = async () => {
      for (const o of ops.values()) if (o.kind === 'prepare') o.control.abort(new DOMException('Removed', 'AbortError'));
      stopSequences();
      return queued(async () => {
        await unload();
        // A download before its first committed chunk still reports missing; remove must cancel it too.
        for (const x of await env.store.list()) await env.store.remove(x.id);
        return { state: 'download' };
      });
    };
    const OPS = { prepare, run, warm, remove, release: async () => { await release(); return {}; } };

    const handle = (m) => {
      if (!m || typeof m !== 'object') return;
      if (m.op === 'config') { if (Number.isSafeInteger(m.idle) && m.idle > 0) idleMs = m.idle; quiet(); return; }
      if (m.op === 'detach') { for (const o of ops.values()) if (o.kind === 'run' || o.kind === 'warm') o.control.abort(new DOMException('Detached', 'AbortError')); return; }
      if (m.op === 'cancel') { ops.get(m.id)?.control.abort(new DOMException('Cancelled', 'AbortError')); return; }
      const op = Object.hasOwn(OPS, m.op) ? OPS[m.op] : null;
      if (!op || ops.has(m.id) || m.id === undefined) return post({ id: m.id, type: 'error', error: { code: 'request' } });
      const control = new AbortController();
      ops.set(m.id, { control, kind: m.op });
      quiet();
      return Promise.resolve().then(() => op(m, control.signal)).then(
        (result) => post({ id: m.id, type: 'done', result }),
        (e) => post({ id: m.id, type: 'error', error: control.signal.aborted ? { category: 'cancelled' }
          : { ...(typeof e?.category === 'string' && { category: e.category }), ...(typeof e?.reason === 'string' && { reason: e.reason }), ...(typeof e?.code === 'string' && { code: e.code }),
            ...(Number.isSafeInteger(e?.tokens) && { tokens: e.tokens }), ...(Number.isSafeInteger(e?.context) && { context: e.context }) } }),
      ).finally(() => { ops.delete(m.id); quiet(); });
    };
    quiet();
    return { handle, release, get loaded() { return loaded?.id || null; } };
  };

  return { LIMIT, SAMPLER, create };
})();
if (typeof module !== 'undefined') module.exports = GZ_AI_LOCAL_HOST;
else if (typeof WorkerGlobalScope !== 'undefined' && globalThis instanceof WorkerGlobalScope) {
  // In its Worker: the store, the GGUF reader and the tokenizer, then what the engine needs and the engine, grammar and
  // ladder, each optional until it ships.
  importScripts('store.js', 'gguf.js', 'tokenizer.js');
  for (const f of ['quant.js', 'reference.js', 'engine.js', 'grammar.js', 'ladder.js']) { try { importScripts(f); } catch { /* not shipped yet */ } }
  const g = (name) => (typeof globalThis[name] !== 'undefined' ? globalThis[name] : null);
  const host = GZ_AI_LOCAL_HOST.create({ store: GZ_AI_STORE, gguf: GZ_AI_GGUF, tokenizer: GZ_AI_TOKENIZER, engine: () => g('GZ_AI_ENGINE'),
    grammar: () => g('GZ_AI_GRAMMAR'), ladder: () => g('GZ_AI_LADDER'), gpu: () => globalThis.navigator?.gpu || null, post: (m) => postMessage(m),
    bench: () => fetch(new URL('kernels/bench.wgsl', location.href)).then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status))))) });
  addEventListener('message', (e) => host.handle(e.data));
}
