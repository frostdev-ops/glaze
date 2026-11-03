// The engine host for Glaze's own model (docs/ai-harness.md "Glaze's own model"): a dedicated Worker that downloads the
// weights (ai/local/store.js), loads them into the WebGPU engine (ai/local/engine.js) and keeps them loaded between
// requests, runs one sequence at a time, and keeps the system turn of up to three instructions read (snapshots), so a
// warm-up or a run with the same instructions starts after them. Chrome starts it from an offscreen document
// (ai/local/offscreen.js), Firefox from the background event page (ai/local/link.js); both pass messages to it as they are.
//   in  { op: 'config', idle }  { op: 'detach' } (the worker's port went: runs and warm-ups stop, a download goes on)
//       { id, op: 'prepare', tier?, part? }  { id, op: 'run', model, parts, stable, schema?, tools?, sources?, sampler,
//       maxTokens, projector?, images?, think?, window?, priority?, memory? }  { id, op: 'warm', model, parts, stable?, memory? }  { id, op: 'remove', part? }
//       { id, op: 'release' }  { id, op: 'cancel' }  { id, op: 'update', doc, model, glaze } (ai/local/updates.js update: a signed model list from the
//       worker's daily check; the newer version of `model` downloads beside it, waiting while a run or warm-up is in
//       flight, and swaps in at the next idle moment, the engine let go; a run on the model in its trial confirms it, or
//       rolls it back on a load or engine failure and runs again on the old version when nothing of the answer was sent)
//   One sequence stays on the GPU between requests (engine.js extend): a run or warm-up feeds only what follows the longest
//   prefix the model already holds, from the latest mark inside it (marks at the system turn's end, a think prefill's
//   start, every LIMIT.spacing tokens and the prompt's end). A warm-up with `stable` reads its parts past the system turn too
//   (the history, while the student types); a run arriving stops a warm-up between steps and keeps what it read. After a
//   think run, the host reads the answer back as the next request will hold it (the turn's empty think block, the answer,
//   the end token) while nothing else waits. window: the engine's room grows to it, up to LIMIT.maxContext; without one,
//   LIMIT.context. priority 'low' (and writer.complete's task token): the prompt uses adaptive steps, amortizing a learned
//   launch floor with bulk batches when necessary, each finished and followed by a yield, and decode yields between tokens, so typing
//   paints and a cancel lands within a step.
//   tools [{ name, parameters }] (with schema; ai/tasks/agent-tools.js constraint()): the answer is either the schema's
//   JSON or one native call to a listed tool, held by the grammar (grammar.js compile's tools). sources { [name]: text }
//   (with schema; providers/local.js spans): the texts its span strings are held to (grammar.js compile's sources).
//   think { budget, close, after } (parts ending in format.js's think prefill): the model reasons first, unmasked but for
//   text tokens and </think>, until it writes </think> (then `after` is fed) or `budget` tokens (then `close` is fed, which
//   ends with </think>); then the answer, with the grammar's mask as any run. The reasoning is never decoded to text, posted
//   or returned. window (a Glaze-tuned model's trained window, think or not): the prompt, the close, the reasoning and the
//   answer fit it; the budget stays whole while the answer keeps min(maxTokens, LIMIT.answer), the answer cut to the rest.
//   part 'pictures': the picture download (models.json role pictures, LFM3-VL's language model, and the projector it names,
//   role projector), fetched and removed as one. A run with images loads that model with its projector (vision.js) on the
//   engine's device, the one model loaded (another is released first); each { image: i } part of its parts is images[i]
//   ({ mime, data: base64 }), decoded here (env.decode), encoded and fed as prefill embeds between <|vision_start|> and
//   <|vision_end|>. A projector that isn't here: provider-unavailable, reason 'pictures'.
//   out { id, type: 'progress', loaded }  { id, type: 'delta', text }  { id, type: 'done', result } (a run's: { text, finish,
//       model, usage: { input, output, thought }, rate? }, rate the decode tokens a second it measured over at least
//       LIMIT.rate tokens; a text prepare's: { state, model?, reason?, tps? }, tps the ladder's estimate for its pick)
//       { id, type: 'error', error: { category, reason?, code?, tokens?, context? } }  { type: 'tick' } (every LIMIT.tick
//       while anything is in flight: Chrome's worker hears it and stays)  { type: 'idle' } (LIMIT.idle with nothing in
//       flight: the engine is released and the host may go)
// parts come from ai/local/format.js and are tokenized here with encodeWith, never by reading specials out of text.
// The engine, the JSON grammar and the tier ladder are their own files (engine.js, grammar.js, ladder.js). The grammar and
// the schema it compiles (ai/schema.js) are IMPORTS.required: a run with a schema and no grammar, or a schema it refuses, is
// an error (provider-unavailable 'engine'; request-rejected 'unsupported'), never a run in words only. A missing engine or
// encoder is reported ('engine'); no ladder, the smallest tier.
// The grammar's mask allows the end token only once the JSON is whole, so a run stops at the end token as any other.
// Classic script; node exports (create), and in a Worker it starts itself.
var GZ_AI_LOCAL_HOST = globalThis.GZ_AI_LOCAL_HOST || (() => {
  const LIMIT = { idle: 300000, tick: 20000, warm: 3, context: 16000, maxContext: 131072, first: 8192, step: 8, bulk: 128, busy: 20, spacing: 2048, rate: 16, answer: 256, spans: 2 };
  // What the Worker loads, in order, beside this file: required ones throw at its start; optional ones until they ship.
  const IMPORTS = Object.freeze({ required: Object.freeze(['../../core/doctext.js', 'store.js', 'gguf.js', 'tokenizer.js', '../schema.js', '../text.js', 'grammar.js', 'updates.js']),
    optional: Object.freeze(['quant.js', 'reference.js', 'engine.js', 'vision-reference.js', 'vision.js', 'ladder.js']) });
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

  // env: { store (ai/local/store.js), gguf (gguf.js), tokenizer (tokenizer.js), engine(), grammar(), ladder(), updates?() (updates.js), vision?()
  // (each the global or null), gpu() (navigator.gpu or null), bench?() (the ladder's bench kernel's source), decode?({ mime,
  // data }) → { width, height, data: RGBA bytes } (the picture's pixels), kernels? (vision.js's kernels' base URL),
  // post(message), setTimeout?, clearTimeout?, now? (ms) }.
  const create = (env) => {
    const later = env.setTimeout || setTimeout, cancelTimer = env.clearTimeout || clearTimeout, now = env.now || (() => performance.now());
    // A task's yield without a timer's clamp (nested zero timeouts wait 4 ms): a message to ourselves; env.pause in tests.
    const pause = env.pause || (typeof MessageChannel === 'function' ? (() => {
      const ch = new MessageChannel(), waiting = [];
      ch.port1.onmessage = () => waiting.shift()?.();
      ch.port1.unref?.(); ch.port2.unref?.();
      return () => new Promise((r) => { waiting.push(r); ch.port2.postMessage(0); });
    })() : () => new Promise((r) => later(r, 0)));
    const ops = new Map(); // id → { control, kind }
    let idleMs = LIMIT.idle, idleTimer = null, tickTimer = null;
    let loaded = null; // { id, key, projector, control, ready, model, tok, eos, base, vision?, warm: [{ ids, snap }] }
    let turn = Promise.resolve(); // one sequence at a time
    const spoke = new Set(); // runs that have sent part of their answer
    const post = (m) => { if (m?.type === 'delta') spoke.add(m.id); try { env.post(m); } catch { /* the host's page is gone */ } };

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
      return was.ready.then((job) => { for (const w of job.warm) { try { w.snap.drop?.(); } catch { /* gone */ } } try { job.base?.drop?.(); } catch { /* gone */ } try { job.vision?.release(); } catch { /* gone */ } try { job.model.release(); } catch { /* gone */ } }, () => {});
    };
    const tokenized = async (id, signal) => {
      try {
        const file = await wait(env.store.open(id), signal), g = await wait(env.gguf.open(file), signal);
        const tok = env.tokenizer.fromGGUF(g.kv);
        for (const name of env.tokenizer.GLAZE_TOKENS) { try { tok.add(name); } catch { break; } }
        return { g, tok };
      } catch (e) { if (signal?.aborted) throw aborted(signal); throw fail('provider-unavailable', 'assets'); }
    };
    // The engine with model `id` (and, for pictures, its projector on the engine's device), loaded once and shared by the
    // calls that ask together; another model or session size releases it first.
    const load = (id, projector = null, window) => {
      const context = Math.max(LIMIT.context, Math.min(Number.isSafeInteger(window) && window > 0 ? window : LIMIT.context, LIMIT.maxContext));
      const key = `${projector ? `${id}+${projector}` : id}:${context}`;
      if (loaded?.key === key) return loaded.ready;
      const retired = unload();
      const E = env.engine(), V = projector ? env.vision?.() : null;
      if (typeof E?.load !== 'function' || (projector && typeof V?.load !== 'function')) return Promise.reject(fail('provider-unavailable', 'engine'));
      const job = { id, key, projector, context, control: new AbortController(), warm: [], schemas: new Map() };
      job.ready = (async () => {
        await retired;
        if (job.control.signal.aborted) throw aborted(job.control.signal);
        // The projector first: one that isn't here says so before the language model loads.
        let pfile;
        if (projector) { try { pfile = await env.store.open(projector); } catch { throw fail('provider-unavailable', 'pictures'); } }
        const { g, tok } = await tokenized(id, job.control.signal);
        let model;
        try { model = await E.load(g, { context: LIMIT.first, signal: job.control.signal }); }
        catch (e) { if (job.control.signal.aborted) throw e; throw fail('provider-unavailable', ENGINE[e?.reason] || 'engine'); }
        try {
          if (job.control.signal.aborted) throw aborted(job.control.signal);
          if (projector) {
            let pg;
            try { pg = await env.gguf.open(pfile); } catch { throw fail('provider-unavailable', 'pictures'); }
            try { job.vision = await V.load(pg, { device: model.device, signal: job.control.signal, ...(env.kernels && { kernels: env.kernels }) }); }
            catch (e) { if (job.control.signal.aborted) throw e; throw fail('provider-unavailable', e?.reason === 'model' ? 'pictures' : ENGINE[e?.reason] || 'engine'); }
            if (job.control.signal.aborted) throw aborted(job.control.signal);
          }
          Object.assign(job, { model, tok, eos: tok.eos ?? tok.id('<|im_end|>'), base: await model.snapshot() });
          return job;
        } catch (e) {
          // A failed initialization never becomes loaded: unload() cannot recover its allocations later.
          try { job.vision?.release(); } catch { /* gone */ }
          try { model.release(); } catch { /* gone */ }
          throw e;
        }
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
    let ahead = null; // the read-ahead after a think run: its AbortController
    const stopSequences = () => {
      for (const o of ops.values()) if (o.kind === 'run' || o.kind === 'warm') o.control.abort(new DOMException('Released', 'AbortError'));
      ahead?.abort(new DOMException('Released', 'AbortError'));
    };
    // Retire requests immediately, but let their pending engine calls settle before freeing GPU resources.
    const release = () => { stopSequences(); return queued(unload); };
    // The model at the end of `head` (the system turn): already held (an engine that keeps its sequence), a kept snapshot
    // of it, else read (from the latest mark it shares, or the start) and kept. → the tokens it fed.
    const prefix = async (job, head, signal, pacing = {}, keepTail = true) => {
      const keeps = typeof job.model.extend === 'function';
      // Only a full-sequence extend can keep the old suffix. Picture prefills append and need the cursor at head's end.
      if (keeps && keepTail && job.model.common(head) === head.length) return 0;
      const at = job.warm.findIndex((w) => same(w.ids, head));
      if (at >= 0) { const [w] = job.warm.splice(at, 1); job.warm.push(w); await job.model.restore(w.snap); return 0; }
      let snap, fed = head.length;
      if (keeps) {
        fed = (await job.model.extend(head, { signal, ...pacing })).fed;
        snap = await job.model.snapshot().catch((e) => { if (e?.reason === 'memory') return null; throw e; });
      } else {
        await job.model.restore(job.base);
        snap = await job.model.prefill(head, { snapshot: true, signal });
      }
      if (snap) job.warm.push({ ids: head, snap });
      while (job.warm.length > LIMIT.warm) { try { job.warm.shift().snap.drop?.(); } catch { /* gone */ } }
      return fed;
    };
    // Where a later request may part from this one, as marks: the system turn's end, a think prefill's start (the next turn
    // holds an empty think block there; a block already closed needs none), and every LIMIT.spacing tokens of a long feed. Each mark splits the feed into
    // another forward pass, which reads every weight again (about a 30-token prefill's time), so block edges get none.
    const stops = (job, ids, from) => {
      const out = [from], think = job.tok.id('<think>');
      const open = Number.isInteger(think) ? ids.lastIndexOf(think) : -1;
      if (open > from && ids[open + 1] !== job.tok.id('</think>')) out.push(open);
      for (let p = from + LIMIT.spacing; p < ids.length; p += LIMIT.spacing) out.push(p);
      return [...new Set(out)].sort((a, b) => a - b);
    };
    // Background work waits and yields between submissions. On a linear GPU, target busy ms. Some drivers have a
    // GEMM launch floor above that target: shrinking to decode's fast single-token path then oscillates at 1/2 tokens.
    // Compare two GEMM sizes before allowing single-token steps. A mostly fixed cost instead selects bulk prefill and
    // targets busy ms of variable work above that floor (best effort latency; the driver can preempt a submission).
    const paced = () => {
      let steps = LIMIT.step, previous = null, launch = 0, linear = false;
      return { step: () => steps, pace: async (ms, tokens) => {
        // Checkpoint tails and chunk caps do not measure the batch we requested.
        if (ms > 0 && tokens === steps) {
          let learned = false;
          if (!launch && previous && tokens > 1 && previous.tokens > 1) {
            const [small, big] = tokens < previous.tokens ? [{ ms, tokens }, previous] : [previous, { ms, tokens }];
            if (big.tokens >= 2 * small.tokens) {
              const slope = Math.max(0, (big.ms - small.ms) / (big.tokens - small.tokens));
              const fixed = Math.max(0, small.ms - slope * small.tokens);
              if (fixed > LIMIT.busy && fixed >= 0.6 * small.ms) {
                launch = fixed; steps = LIMIT.bulk; learned = true;
              } else linear = true;
            }
          }
          if (!learned) {
            const minimum = launch ? 32 : linear ? 1 : 2;
            steps = Math.max(minimum, Math.min(512, 2 * steps, Math.floor(LIMIT.busy * tokens / Math.max(1, ms - launch))));
          }
          previous = { ms, tokens };
        }
        await pause();
      } };
    };
    // The JSON grammar's matcher for a schema (grammar.js), with tools a turn that may instead call one of them in LFM3's
    // own syntax: its vocabulary once per model (with the tool tags' ids, where the model has them), each schema compiled
    // once. No grammar, or no vocabulary: provider-unavailable 'engine'; a schema or tools it refuses (tools on a model
    // without the tags): request-rejected 'unsupported'. With sources, the last LIMIT.spans compiled are kept (each holds
    // its texts' automata).
    const matcher = (job, schema, tools, sources) => {
      const G = env.grammar();
      if (typeof G?.vocab !== 'function' || typeof G.compile !== 'function') throw fail('provider-unavailable', 'engine');
      try {
        const marks = Array.isArray(G.TOOL_MARKS) ? Object.fromEntries(G.TOOL_MARKS.map((n) => [n, job.tok.id(n)])) : {};
        job.vocab ||= G.vocab(job.tok.byteStrings(), { eos: [job.eos], marks: Object.values(marks).every(Number.isInteger) ? marks : {} });
      } catch { throw fail('provider-unavailable', 'engine'); }
      const kept = sources === undefined ? job.schemas : (job.spans ||= new Map()), most = sources === undefined ? 32 : LIMIT.spans;
      const key = JSON.stringify([schema, ...(tools !== undefined || sources !== undefined ? [tools ?? null] : []), ...(sources !== undefined ? [sources] : [])]);
      if (!kept.has(key)) {
        let g = null;
        try { g = G.compile(schema, job.vocab, { ...(tools !== undefined && { tools }), ...(sources !== undefined && { sources }) }); } catch { /* refused */ }
        kept.set(key, g);
        if (kept.size > most) kept.delete(kept.keys().next().value);
      }
      const g = kept.get(key);
      if (!g) throw fail('request-rejected', 'unsupported');
      return g.matcher();
    };
    // The think phase's mask: every token with text, and </think>; never the end token or another control token.
    const reasoning = (job, end) => {
      if (job.reasoning) return job.reasoning;
      const bytes = job.tok.byteStrings(), mask = new Uint32Array(Math.ceil(job.tok.size / 32));
      for (let i = 0; i < bytes.length; i++) if (bytes[i] && i !== job.eos) mask[i >>> 5] |= 1 << (i & 31);
      mask[end >>> 5] |= 1 << (end & 31);
      return (job.reasoning = mask);
    };
    const encode = (job, parts) => {
      try { return job.tok.encodeWith(parts); } catch { throw fail('request-rejected', 'unsupported'); }
    };

    // ---- ops ------------------------------------------------------------------------------------------------------------
    // The model a download takes: one with that tier, else one already here (ready, then partial), else the ladder's pick.
    const pick = async (tier) => {
      const all = (await env.store.list()).filter((m) => m.state !== 'stale' && !m.role);
      // An older catalog may have offered the saved tier; if it is gone, use Auto.
      const chosen = tier && all.find((x) => x.tier === tier);
      if (chosen) return { id: chosen.id };
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
        if (r && typeof r.id === 'string' && all.some((m) => m.id === r.id)) {
          const tps = r.quants?.find?.((q) => q.id === r.id)?.tps;
          return { id: r.id, ...(Number.isFinite(tps) && tps > 0 && { tps }) };
        }
        return { reason: r?.reason === 'storage' ? 'quota' : r?.reason === 'no-model' ? 'assets' : 'hardware' };
      }
      const adapter = await Promise.resolve().then(() => gpu.requestAdapter({ powerPreference: 'high-performance' })).catch(() => null);
      if (!adapter) return { reason: 'hardware' };
      const smallest = [...all].sort((a, b) => a.tier - b.tier)[0];
      return smallest ? { id: smallest.id } : { reason: 'assets' };
    };
    // The picture download: the projector, then its language model, one progress over both.
    const pictureFiles = async () => {
      const all = (await env.store.list()).filter((m) => m.state !== 'stale');
      const lm = all.find((m) => m.role === 'pictures'), proj = lm && all.find((m) => m.role === 'projector' && m.id === lm.projector);
      return lm && proj ? [proj, lm] : null;
    };
    const pictures = async (m, signal) => {
      const files = await pictureFiles();
      if (!files) return { state: 'unavailable', reason: 'assets' };
      if (!env.gpu()) return { state: 'unavailable', reason: 'webgpu' };
      const total = files.reduce((n, f) => n + f.size, 0);
      let done = 0;
      try {
        for (const f of files) {
          if (signal.aborted) return { state: 'download' };
          await env.store.download(f.id, { signal, onProgress: (loaded) => post({ id: m.id, type: 'progress', loaded: (done + loaded * f.size) / total }) });
          done += f.size;
        }
        return { state: 'ready', model: files[1].id };
      } catch (e) {
        if (signal.aborted || e?.reason === 'removed' || e?.reason === 'aborted') return { state: 'download' };
        return { state: 'download', reason: e?.reason === 'quota' ? 'quota' : 'network' };
      }
    };
    const prepare = async (m, signal) => {
      if (m.part === 'pictures') return pictures(m, signal);
      const p = await pick(Number.isSafeInteger(m.tier) && m.tier > 0 ? m.tier : 0);
      if (signal.aborted) return { state: 'download' };
      if (!p.id) return { state: 'unavailable', reason: p.reason };
      try {
        await env.store.download(p.id, { signal, onProgress: (loaded) => post({ id: m.id, type: 'progress', loaded }) });
        return { state: 'ready', model: p.id, ...(p.tps && { tps: p.tps }) };
      } catch (e) {
        if (signal.aborted) return { state: 'download' };
        if (e?.reason === 'removed' || e?.reason === 'aborted') return { state: 'download', model: p.id };
        return { state: 'download', model: p.id, reason: e?.reason === 'quota' ? 'quota' : 'network' };
      }
    };
    // The pictures' pixels, each { width, height, data, tokens } (the encoder's count for its resized size).
    const pixels = async (job, images, signal) => {
      const out = [];
      for (const image of images) {
        if (signal.aborted) throw aborted(signal);
        let img;
        try { img = await env.decode(image); } catch { throw fail('request-rejected', 'unsupported'); }
        if (signal.aborted) throw aborted(signal);
        let size;
        try { size = job.vision.prepare(img); } catch { throw fail('request-rejected', 'unsupported'); }
        out.push({ ...img, tokens: size.tokens });
      }
      return out;
    };
    // parts after the system turn → ids, with a row of placeholders for each { image: i } part, and where each sits.
    const feed = (job, parts, pictures) => {
      const ids = [], slots = [];
      let text = [];
      const flush = () => { if (text.length) for (const id of encode(job, text)) ids.push(id); text = []; };
      for (const p of parts) {
        if (p?.image === undefined) { text.push(p); continue; }
        const pic = Number.isSafeInteger(p.image) ? pictures[p.image] : undefined;
        if (!pic || Object.keys(p).length !== 1) throw fail('request-rejected', 'unsupported');
        flush();
        slots.push({ at: ids.length, pic });
        for (let i = 0; i < pic.tokens; i++) ids.push(0);
      }
      flush();
      return { rest: Uint32Array.from(ids), slots };
    };
    // The provider marks prompts that depend on memory or the model's scale contract. Check the weights when queued
    // work actually runs, and again after trial rollback; an already-formatted prompt cannot be replayed on legacy weights.
    const capabilitiesReady = async (m) => {
      if (m.memory === undefined && m.scale === undefined) return;
      let model;
      try { model = (await env.store.catalog?.())?.entries.get(m.model); } catch { /* unavailable is unsupported */ }
      if (m.memory !== undefined && (m.memory !== 1 || model?.memory !== 1)) throw Object.assign(new Error('This model does not support memory.'), { code: 'caps' });
      if (m.scale !== undefined && (m.scale !== 1 || model?.scale !== 1 || model.stock || model.role)) throw Object.assign(new Error('This model does not support size tokens.'), { code: 'caps' });
    };
    const answer = async (m, signal) => {
        await capabilitiesReady(m);
        const images = Array.isArray(m.images) ? m.images : [];
        if (images.length && typeof m.projector !== 'string') throw fail('request-rejected', 'unsupported');
        if (images.length && typeof env.decode !== 'function') throw fail('provider-unavailable', 'engine');
        const job = await wait(load(m.model, images.length ? m.projector : null, m.window), signal);
        const { model, tok } = job;
        const pictures = images.length ? await pixels(job, images, signal) : [];
        const head = encode(job, m.parts.slice(0, m.stable)), { rest, slots } = feed(job, m.parts.slice(m.stable), pictures);
        // An engine that grows its session takes the window as its room (at least LIMIT.context, at most LIMIT.maxContext).
        const grows = typeof model.reserve === 'function', keeps = grows && typeof model.extend === 'function' && !slots.length;
        const input = head.length + rest.length, room = grows ? Math.min(Math.max(LIMIT.context, Number.isSafeInteger(m.window) && m.window > 0 ? m.window : 0), LIMIT.maxContext)
          : Math.min(model.context || job.context, job.context);
        if (input + m.maxTokens > room) throw fail('request-rejected', 'context', { tokens: input, context: room });
        // Think mode: </think>'s id, the parts the host may feed, and the budget the window leaves.
        let think = null, close = null;
        if (m.think) {
          const end = tok.id('</think>');
          if (end === undefined || !Number.isSafeInteger(m.think.budget) || m.think.budget < 0 || images.length) throw fail('request-rejected', 'unsupported');
          close = Uint32Array.from(encode(job, m.think.close));
          // Even no reasoning feeds the close: the engine must hold it, refused before the sequence is touched as any prompt
          // over the room.
          if (input + m.maxTokens + close.length > (m.think.preserveAnswer === true ? Math.min(m.window || room, room) : room)) throw fail('request-rejected', 'context', { tokens: input + close.length, context: room });
          think = { end, close, after: Uint32Array.from(encode(job, m.think.after)), budget: m.think.budget, preserveAnswer: m.think.preserveAnswer === true,
            until: m.think.until, rate: m.think.rate };
        }
        // The trained window (a Glaze-tuned model's): the prompt, the close, the reasoning and the answer share it. The
        // reasoning keeps its budget while the answer is left at least LIMIT.answer (or its maxTokens, if fewer), and the
        // answer takes the rest, up to maxTokens. A prompt that leaves the answer less runs as planned in the engine's room.
        let answer = m.maxTokens;
        if (Number.isSafeInteger(m.window) && m.window > 0) {
          const space = Math.min(m.window, room) - input - (close?.length || 0), floor = think?.preserveAnswer ? m.maxTokens : Math.min(m.maxTokens, LIMIT.answer);
          if (think) think.budget = Math.max(0, Math.min(think.budget, space - floor));
          const left = space - (think?.budget || 0);
          if (left >= floor) answer = Math.min(m.maxTokens, left);
        }
        // A trained window is optional; the physical engine limit still holds beside the reserved answer and close.
        if (think) think.budget = Math.min(think.budget, room - input - answer - think.close.length);
        if (m.tools !== undefined && !m.schema) throw fail('request-rejected', 'unsupported');
        const grammar = m.schema ? matcher(job, m.schema, m.tools, m.sources) : null;
        if (grows) await model.reserve(input + (close?.length || 0) + (think?.budget || 0) + answer, room).catch((e) => { throw e?.reason === 'memory' ? fail('provider-unavailable', 'hardware') : e; });
        // Low priority: start small, then learn linear or launch-floor pacing; wait and yield after every GPU step.
        const low = m.priority === 'low' || head.includes(tok.id('<|gz_task:writer.complete|>'));
        const yieldNow = pause;
        const pacing = low ? paced() : {};
        const read = await prefix(job, head, signal, pacing, keeps);
        const ids = keeps ? [...head, ...rest] : null;
        let cached = 0;
        // Each picture encoded on the engine's device, fed in place of its placeholders, and its buffer freed at once.
        const encoded = [];
        try {
          for (const s of slots) {
            let r;
            try { r = await job.vision.encode(s.pic, { signal }); } catch (e) { if (signal.aborted) throw aborted(signal); throw fail('provider-unavailable', ENGINE[e?.reason] === 'assets' ? 'pictures' : ENGINE[e?.reason] || 'engine'); }
            encoded.push(r);
            if (r.tokens !== s.pic.tokens) throw fail('provider-unavailable', 'engine');
            s.pic.data = null;
          }
          if (keeps) cached = ids.length - read - (await model.extend(ids, { at: stops(job, ids, head.length), signal, ...pacing })).fed;
          else if (rest.length) await model.prefill(rest, { signal, ...pacing, ...(slots.length && { embeds: slots.map((s, i) => ({ at: s.at, tokens: encoded[i].tokens, buffer: encoded[i].buffer })) }) });
        } finally { for (const r of encoded) { try { r.drop?.(); } catch { /* gone */ } } }
        const sampler = { ...SAMPLER, ...m.sampler };
        let spent = 0; // ms in decode, for the rate
        const step = async (mask) => {
          if (signal.aborted) throw aborted(signal);
          // An engine that keeps its sequence takes the mask lazily: the grammar's work overlaps the GPU's.
          const t = now(), id = await model.decode({ sampler, ...(mask && { mask: grows && typeof mask === 'function' ? mask : typeof mask === 'function' ? mask() : mask }), signal });
          spent += now() - t;
          if (low) await yieldNow();
          if (signal.aborted) throw aborted(signal);
          return id;
        };
        // The reasoning: decoded and fed, never turned into text.
        let thought = 0;
        if (think) {
          let closed = false;
          while (thought < think.budget) {
            // Prefill/queue time counts too. Keep time for the full answer at the slower of the saved rate and
            // this run's actual pace; close thought before another decode would spend that reserve.
            if (think.preserveAnswer) {
              const rate = Math.min(think.rate || 15, thought && spent > 0 ? thought / spent * 1000 : Infinity);
              if (now() + (answer + 1) / rate * 1000 + 2000 >= think.until) break;
            }
            const id = await step(reasoning(job, think.end));
            thought++;
            if (id === think.end) { closed = true; break; }
          }
          const fed = closed ? think.after : think.close;
          if (fed.length) await model.prefill(fed, { signal });
          if (signal.aborted) throw aborted(signal);
        }
        // A tool turn's grammar admits its tag ids; keep their text even when the tokenizer calls them control tokens.
        const dec = tok.decoder({ specials: m.tools !== undefined });
        let text = '', n = 0, finish = 'length';
        const said = [];
        while (n < answer) {
          const id = await step(grammar ? () => grammar.mask() : null);
          n++;
          said.push(id);
          if (id === job.eos) { finish = 'stop'; break; }
          grammar?.advance(id);
          const d = dec.push(id);
          if (d) { text += d; post({ id: m.id, type: 'delta', text: d }); }
        }
        const tail = dec.end();
        if (tail) { text += tail; post({ id: m.id, type: 'delta', text: tail }); }
        const rate = thought + n >= LIMIT.rate && spent > 0 ? Math.round((thought + n) / spent * 10000) / 10 : null;
        // A think run's answer, read back as the next request holds it: the turn's empty think block, the answer, the end.
        if (keeps && think && finish === 'stop') {
          const open = ids.lastIndexOf(tok.id('<think>'));
          if (open >= 0) readAhead(job, [...ids.slice(0, open), ids[open], think.end, ...said], m.id);
        }
        return { text, finish, model: m.model, usage: { input, output: thought + n, thought, ...(keeps && { cached }) }, ...(rate && { rate }) };
    };
    // A run on the model in its trial (a swapped-in update): its first good answer keeps the new version; a load or engine
    // failure brings the old one back, and the run goes again on it unless part of its answer was already sent.
    const run = (m, signal) => queued(async () => {
      const U = env.updates?.(), pics = Array.isArray(m.images) && m.images.length;
      const trial = U && !pics ? (await env.store.catalog?.().catch(() => null))?.state?.trial : null;
      if (!trial || trial.id !== m.model) return answer(m, signal);
      try {
        const r = await answer(m, signal);
        await U.settle(env.store, true).catch(() => {});
        return r;
      } catch (e) {
        if (signal.aborted || !U.fault(e)) throw e;
        await unload();
        await U.settle(env.store, false);
        if (spoke.has(m.id)) throw e;
        return answer(m, signal);
      }
    }, signal);
    // Resolves once no run or warm-up is in flight; throws when the signal fires or Data Saver comes on.
    let idlers = [];
    const busy = () => [...ops.values()].some((o) => o.kind === 'run' || o.kind === 'warm');
    const saveData = env.saveData || (() => globalThis.navigator?.connection?.saveData === true);
    const idle = (signal) => new Promise((resolve, reject) => {
      const go = () => {
        if (signal?.aborted) return reject(aborted(signal));
        if (saveData()) return reject(Object.assign(new Error('Data Saver is on'), { reason: 'saveData' }));
        if (!busy()) return resolve();
        idlers.push(go);
      };
      signal?.addEventListener('abort', () => reject(aborted(signal)), { once: true });
      go();
    });
    const update = async (m, signal) => {
      const U = env.updates?.();
      if (!U || !env.store.catalog) return { state: 'unavailable', reason: 'engine' };
      return U.update({ store: env.store, key: env.key, idle, progress: (loaded) => post({ id: m.id, type: 'progress', loaded }),
        between: (fn) => queued(async () => { await fn(); if (loaded?.id === m.model) await unload(); }) },
      { doc: m.doc, id: m.model, glaze: m.glaze }, signal);
    };
    // After the run (queued behind it), while nothing else waits; the next request stops it between steps.
    const readAhead = (job, ids, owner) => {
      // A request may have arrived before this answer finished, when there was no read-ahead to cancel yet.
      if ([...ops].some(([id, op]) => id !== owner && (op.kind === 'run' || op.kind === 'warm'))) return;
      const control = new AbortController();
      ahead?.abort(new DOMException('Replaced', 'AbortError'));
      ahead = control;
      queued(async () => {
        if (loaded !== job) return;
        await job.model.extend(ids, { at: [ids.length], signal: control.signal, ...paced() });
      }, control.signal).catch(() => {}).finally(() => { if (ahead === control) ahead = null; });
    };
    // The system turn (parts, or its first `stable`), kept; with stable the rest is read on after it in the live sequence.
    const warm = async (m, signal) => {
      return queued(async () => {
        await capabilitiesReady(m);
        if ((await env.store.status(m.model)).state !== 'ready') return { ok: false };
        const job = await wait(load(m.model, null, m.window), signal);
        const stable = Number.isSafeInteger(m.stable) && m.stable > 0 && m.stable < m.parts.length ? m.stable : m.parts.length;
        const head = encode(job, m.parts.slice(0, stable)), ids = [...head, ...encode(job, m.parts.slice(stable))], pacing = paced();
        const room = typeof job.model.reserve === 'function' ? job.context : Math.min(job.model.context || job.context, job.context);
        if (ids.length > room) throw fail('request-rejected', 'context', { tokens: ids.length, context: room });
        if (typeof job.model.reserve === 'function') await job.model.reserve(ids.length, room).catch((e) => { throw e?.reason === 'memory' ? fail('provider-unavailable', 'hardware') : e; });
        await prefix(job, head, signal, pacing);
        if (stable < m.parts.length && typeof job.model.extend === 'function') {
          await job.model.extend(ids, { at: stops(job, ids, head.length), signal, ...pacing });
        }
        return { ok: true };
      }, signal);
    };
    const remove = async (m) => {
      if (m?.part === 'pictures') {
        for (const o of ops.values()) if (o.part === 'pictures' && o.kind !== 'remove') o.control.abort(new DOMException('Removed', 'AbortError'));
        return queued(async () => {
          if (loaded?.projector) await unload();
          for (const x of await env.store.list()) if (x.role) await env.store.remove(x.id);
          return { state: 'download' };
        });
      }
      for (const o of ops.values()) if (o.kind === 'prepare' || o.kind === 'update') o.control.abort(new DOMException('Removed', 'AbortError'));
      stopSequences();
      return queued(async () => {
        await unload();
        // A download before its first committed chunk still reports missing; remove must cancel it too.
        for (const x of await env.store.list()) await env.store.remove(x.id);
        return { state: 'download' };
      });
    };
    // count: a request's prompt tokens as run would feed them (encodeWith over its parts), for Ask Rime's window accounting.
    const count = async (m, signal) => {
      if (!Array.isArray(m.parts)) throw fail('request-rejected', 'unsupported');
      const read = async () => {
        await capabilitiesReady(m);
        // Counting must not replace or release a GPU model another feature is using.
        const tok = loaded?.id === m.model && loaded.tok || (await tokenized(m.model, signal)).tok;
        return { tokens: encode({ tok }, m.parts).length };
      };
      // Capability-dependent prompts wait for trial settlement/swaps; ordinary counting stays independent.
      return m.memory === undefined && m.scale === undefined ? read() : queued(read, signal);
    };
    const OPS = { prepare, run, warm, count, remove, update, release: async () => { await release(); return {}; } };

    const handle = (m) => {
      if (!m || typeof m !== 'object') return;
      if (m.op === 'config') { if (Number.isSafeInteger(m.idle) && m.idle > 0) idleMs = m.idle; quiet(); return; }
      if (m.op === 'detach') { for (const o of ops.values()) if (o.kind === 'run' || o.kind === 'warm') o.control.abort(new DOMException('Detached', 'AbortError')); return; }
      if (m.op === 'cancel') { ops.get(m.id)?.control.abort(new DOMException('Cancelled', 'AbortError')); return; }
      const op = Object.hasOwn(OPS, m.op) ? OPS[m.op] : null;
      if (!op || ops.has(m.id) || m.id === undefined) return post({ id: m.id, type: 'error', error: { code: 'request' } });
      // A run outranks a warm-up and a read-ahead: they stop between steps, keeping what they read.
      if (m.op === 'run') {
        for (const o of ops.values()) if (o.kind === 'warm') o.control.abort(new DOMException('Superseded', 'AbortError'));
      }
      if (m.op === 'run' || m.op === 'warm') ahead?.abort(new DOMException('Superseded', 'AbortError'));
      if (m.op === 'run' && m.think?.preserveAnswer === true) m = { ...m, think: { ...m.think, until: now() + Math.max(0, Math.min(300000, Number.isFinite(m.think.ms) ? m.think.ms : 0)) } };
      const control = new AbortController();
      ops.set(m.id, { control, kind: m.op, ...((m.part === 'pictures' || (m.op === 'run' && Array.isArray(m.images) && m.images.length)) && { part: 'pictures' }) });
      quiet();
      return Promise.resolve().then(() => op(m, control.signal)).then(
        (result) => post({ id: m.id, type: 'done', result }),
        (e) => post({ id: m.id, type: 'error', error: control.signal.aborted ? { category: 'cancelled' }
          : { ...(typeof e?.category === 'string' && { category: e.category }), ...(typeof e?.reason === 'string' && { reason: e.reason }), ...(typeof e?.code === 'string' && { code: e.code }),
            ...(Number.isSafeInteger(e?.tokens) && { tokens: e.tokens }), ...(Number.isSafeInteger(e?.context) && { context: e.context }) } }),
      ).finally(() => {
        ops.delete(m.id); spoke.delete(m.id); quiet();
        const waiting = idlers; idlers = [];
        for (const f of waiting) f();
      });
    };
    quiet();
    return { handle, release, get loaded() { return loaded?.id || null; } };
  };

  return { LIMIT, SAMPLER, IMPORTS, create };
})();
if (typeof module !== 'undefined') module.exports = GZ_AI_LOCAL_HOST;
else if (typeof WorkerGlobalScope !== 'undefined' && globalThis instanceof WorkerGlobalScope) {
  importScripts(...GZ_AI_LOCAL_HOST.IMPORTS.required);
  for (const f of GZ_AI_LOCAL_HOST.IMPORTS.optional) { try { importScripts(f); } catch { /* not shipped yet */ } }
  const g = (name) => (typeof globalThis[name] !== 'undefined' ? globalThis[name] : null);
  // Bound decompression from the header before calling the browser, as the document reader does. A compressed-byte
  // limit alone does not bound pixels. Then draw at most MAX pixels, with a side limit even for very thin pictures.
  // createImageBitmap reads a GIF's first frame and turns a JPEG upright; the encoder resizes again for its own window.
  const MAX = 4096 * 4096, SIDE = 16384;
  const bounded = (w, h) => Number.isSafeInteger(w) && Number.isSafeInteger(h) && w > 0 && h > 0 && w * h <= GZ_DOCTEXT.READ.pixels;
  const decode = async ({ mime, data }) => {
    const bin = atob(data), bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const size = GZ_DOCTEXT.imageSize(bytes);
    if (!size || !bounded(size.w, size.h)) throw new Error('unsupported picture dimensions');
    const bmp = await createImageBitmap(new Blob([bytes], { type: mime }));
    try {
      if (!bounded(bmp.width, bmp.height)) throw new Error('unsupported picture dimensions');
      const k = Math.min(1, Math.sqrt(MAX / (bmp.width * bmp.height)), SIDE / bmp.width, SIDE / bmp.height);
      const width = Math.max(1, Math.floor(bmp.width * k)), height = Math.max(1, Math.floor(bmp.height * k));
      const ctx = new OffscreenCanvas(width, height).getContext('2d', { willReadFrequently: true });
      ctx.drawImage(bmp, 0, 0, width, height);
      return { width, height, data: ctx.getImageData(0, 0, width, height).data, channels: 4 };
    } finally { bmp.close(); }
  };
  const host = GZ_AI_LOCAL_HOST.create({ store: GZ_AI_STORE, gguf: GZ_AI_GGUF, tokenizer: GZ_AI_TOKENIZER, engine: () => g('GZ_AI_ENGINE'),
    vision: () => g('GZ_AI_VISION'), decode, kernels: new URL('kernels/', location.href).href,
    grammar: () => g('GZ_AI_GRAMMAR'), ladder: () => g('GZ_AI_LADDER'), updates: () => g('GZ_AI_MODEL_UPDATES'), gpu: () => globalThis.navigator?.gpu || null, post: (m) => postMessage(m),
    bench: () => fetch(new URL('kernels/bench.wgsl', location.href)).then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status))))) });
  addEventListener('message', (e) => host.handle(e.data));
}
