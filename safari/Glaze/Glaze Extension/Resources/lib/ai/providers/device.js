// The AI harness's `device` provider (docs/ai-harness.md): Chrome's Prompt API (LanguageModel), on this
// computer, in the worker itself. Nothing goes over the network and there is no key.
// What it rests on (checked 2026-10-26):
// - Chrome 138 ships the Prompt API to extensions only (developer.chrome.com/docs/ai/built-in-apis). Chrome's renderer turns
//   it on for an extension's process, workers included (chrome/renderer/chrome_content_renderer_client.cc,
//   EnableAIPromptAPIForWorkers, from tag 138.0.7204.183 to main), and LanguageModel is Exposed(Window AIPromptAPI, Worker
//   AIPromptAPIForWorkers) (third_party/blink/renderer/modules/ai/language_model.idl). So the service worker has it, and no
//   document, frame or permission is needed. The web's docs say "not in Web Workers" (developer.chrome.com/docs/ai/
//   prompt-api): that is a page's workers. A content script runs in the page's process and has none.
// - User activation is asked only of a window, and only while the model is 'downloadable' (main's
//   language_model_create_client.cc: `if (window && RequiresUserActivation(...))`; 138 checks none), so the worker may
//   start the download from Settings' click. A NotAllowedError is still read as 'activation'.
// - availability() → 'unavailable' | 'downloadable' | 'downloading' | 'available', given the same expectedInputs the
//   session will have (developer.chrome.com/docs/ai/get-started). Hardware: desktop Windows 10/11, macOS 13+, Linux,
//   ChromeOS Chromebook Plus; 22 GB free; a GPU over 4 GB or 16 GB RAM and 4 cores (developer.chrome.com/docs/ai/prompt-api).
// - create({ initialPrompts (the system prompt first), expectedInputs ([{ type: 'image' }] for pictures, values ImageBitmap
//   sources incl. Blob), monitor (downloadprogress, loaded 0..1), signal, temperature + topK (extensions: both or neither,
//   from LanguageModel.params()) }); prompt / promptStreaming(input, { responseConstraint (JSON Schema),
//   omitResponseConstraintInput, signal }); destroy(). Streamed chunks are deltas (138's model_execution_responder.cc
//   enqueues each piece; the non-streaming path concatenates them).
// - The window: contextWindow / contextUsage / measureContextUsage(input, options) now; 138's inputQuota / inputUsage /
//   measureInputUsage are kept as aliases in extensions (language_model.idl, AIPromptAPILegacyIdentifiers). A prompt that
//   doesn't fit fails with QuotaExceededError; one that fits only by dropping earlier turns drops them and fires
//   contextoverflow (138: quotaoverflow). Glaze measures first and refuses either way: nothing is cut silently.
// - Tool calls exist in Chromium's main behind expectedOutputs 'tool-call', not in what Chrome 138 ships: not claimed.
// - No maxTokens: the API takes no output limit. Schema requests with an explicit maxTokens use an app byte cutoff at
//   four UTF-8 bytes per estimated token; streaming is cancelled and its session destroyed when that allowance is exceeded.
// - clone() copies a session with what it has read (LanguageModel.prototype.clone, with a signal), so a request with no
//   earlier turns prompts a clone of a warm session that read its system prompt once: one per system prompt (and
//   sampling and pictures), destroyed WARM.ms after its last use, when a call on it fails or times out, and when a
//   connection changes (release). A create() signal that aborts later destroys its session, so a warm one has its own.
//   Without clone(), each request has its own session, as before.
// cfg: {} (generation kept by the broker). Classic script; module.exports for node.
var GZ_AI_DEVICE = globalThis.GZ_AI_DEVICE || (() => {
  const P = typeof GZ_AI_PROVIDERS !== 'undefined' ? GZ_AI_PROVIDERS : require('../providers.js');
  const R = typeof GZ_AI_REQUEST !== 'undefined' ? GZ_AI_REQUEST : require('../request.js');
  const F = typeof GZ_AI_FAILURE !== 'undefined' ? GZ_AI_FAILURE : require('../failure.js');
  // A stable Glaze compatibility id, not a model selector: Chrome chooses the built-in model. No model option is sent.
  const MODEL = 'gemini-nano';
  const STATES = { unavailable: 'unavailable', downloadable: 'download', downloading: 'downloading', available: 'ready' };
  const api = () => globalThis.LanguageModel || null;
  const fail = (category, message, reason, details = {}) => Object.assign(new Error(message), { category, ...(reason && { reason }), ...details });
  const refuse = (code, message) => Object.assign(new Error(message), { code });
  let windowSize = 0; // the context window a session reported, once one has
  let preparing = null; // the download in progress: { done, listeners }
  const WARM = { ms: 120000, n: 3 };
  const warm = new Map(); // key → { ready: a promise of the session, control, timer }, oldest first

  const destroy = (s) => { try { s?.destroy(); } catch { /* gone */ } };
  // Some API operations notice an abort only when their reply arrives (138's measureInputUsage does). Stop waiting now;
  // a create() that still hands back a session later must dispose of it, never start inference with it.
  const wait = (pending, signal, late) => !signal ? Promise.resolve(pending) : new Promise((resolve, reject) => {
    let active = true;
    const finish = (f, value) => {
      if (!active) return false;
      active = false; signal.removeEventListener('abort', stop); f(value); return true;
    };
    const stop = () => finish(reject, signal.reason);
    if (signal.aborted) stop(); else signal.addEventListener('abort', stop, { once: true });
    Promise.resolve(pending).then((s) => { if (!finish(resolve, s)) late?.(s); }, (e) => finish(reject, e));
  });

  // → cfg, or null: the compatibility id stays fixed; images and context are what the broker learnt from catalog().
  const config = (raw) => {
    if (!R.isObj(raw) || Object.keys(raw).some((k) => !['model', 'images', 'context', 'generation'].includes(k))) return null;
    if (raw.model !== undefined && raw.model !== MODEL) return null;
    if (raw.images !== undefined && typeof raw.images !== 'boolean') return null;
    if (raw.context !== undefined && !(Number.isSafeInteger(raw.context) && raw.context > 0)) return null;
    if (raw.generation !== undefined && (typeof raw.generation !== 'string' || !/^[\w-]{1,64}$/.test(raw.generation))) return null;
    return { model: MODEL, ...(raw.images !== undefined && { images: raw.images }), ...(raw.context && { context: raw.context }), ...(raw.generation && { generation: raw.generation }) };
  };
  const caps = (cfg) => ({ text: true, json: true, stream: true, local: true, ...(typeof cfg.images === 'boolean' && { images: cfg.images }), ...(cfg.context && { context: cfg.context }) });
  const inputs = (images) => [{ type: 'text' }, ...(images ? [{ type: 'image' }] : [])];
  const availability = async (images, signal) => {
    const LM = api();
    if (!LM) return 'none';
    try { const a = await wait(LM.availability({ expectedInputs: inputs(images) }), signal); return Object.hasOwn(STATES, a) ? a : 'failed'; }
    catch (e) { if (signal?.aborted) throw e; return 'failed'; }
  };
  const describe = (a) => (a === 'none' ? { state: 'unavailable', reason: 'browser' } : a === 'failed' ? { state: 'unavailable', reason: 'failed' } : a === 'unavailable' ? { state: 'unavailable', reason: 'device' } : { state: STATES[a] });
  const status = async (cfg, { signal } = {}) => {
    const timer = F.deadline(20000), both = F.anySignal([signal, timer.signal]);
    let text;
    try {
      text = describe(await availability(false, both.signal));
      if (text.state !== 'ready') return text;
      // A fresh connection has no catalog-derived images flag yet. Discover currently ready vision without creating a
      // session or downloading; an unavailable or failed image probe must not take working text features offline.
      return { ...text, caps: { images: await availability(true, both.signal) === 'available' } };
    }
    catch { return text?.state === 'ready' ? { ...text, caps: { images: false } } : { state: 'unavailable', reason: timer.signal.aborted ? 'timeout' : 'failed' }; }
    finally { timer.done(); both.done(); }
  };

  const used = (s) => s.contextUsage ?? s.inputUsage ?? 0;
  const room = (s) => s.contextWindow ?? s.inputQuota;
  const learn = (s) => { const w = room(s); if (Number.isFinite(w) && w > 0) windowSize = Math.floor(w); };

  // The model, downloaded if it isn't there: create() with a monitor, then the session destroyed. Callers that ask while
  // it runs join it and hear its progress. Bound the whole attempt to four minutes, before MV3's five-minute request
  // limit; a stopped worker has no saved job, and Settings rechecks Chrome's availability before retrying.
  const prepare = async (cfg, { onProgress } = {}) => {
    const listen = (p) => { if (Number.isFinite(p)) onProgress(Math.min(1, Math.max(0, p))); };
    if (preparing) { if (typeof onProgress === 'function') preparing.listeners.add(listen); return preparing.done; }
    const job = { listeners: new Set(typeof onProgress === 'function' ? [listen] : []) };
    preparing = job;
    job.done = (async () => {
      const timer = F.deadline(240000);
      let monitor, s;
      const progress = (e) => { for (const f of job.listeners) try { f(e.loaded); } catch { /* a listener's own */ } };
      try {
        const a = await availability(false, timer.signal);
        if (a === 'available' && windowSize) return { state: 'ready' };
        if (!['downloadable', 'downloading', 'available'].includes(a)) return describe(a);
        s = await wait(api().create({ expectedInputs: inputs(false), signal: timer.signal,
          monitor: (m) => { monitor = m; if (!timer.signal.aborted) m.addEventListener('downloadprogress', progress); } }), timer.signal, destroy);
        learn(s);
        return { state: 'ready' };
      } catch (e) {
        return e?.name === 'NotAllowedError' ? { state: 'download', reason: 'activation' } : { state: 'unavailable', reason: timer.signal.aborted ? 'timeout' : 'failed' };
      } finally {
        timer.done(); destroy(s); monitor?.removeEventListener('downloadprogress', progress); job.listeners.clear();
        if (preparing === job) preparing = null;
      }
    })();
    return job.done;
  };

  // What the model takes, for the broker's checks (lib/ai/models.js shape): pictures as availability says, the window once a
  // session has told it (a session is made for that only when the model is already there).
  const catalog = async (cfg, { signal } = {}) => {
    const a = await availability(false, signal);
    if (a === 'none' || a === 'failed') throw fail('provider-unavailable', 'The Prompt API is not available.');
    const pictures = a === 'unavailable' ? 'unavailable' : await availability(true, signal);
    if (a === 'available' && !windowSize) {
      const s = await wait(api().create({ expectedInputs: inputs(false), ...(signal && { signal }) }), signal, destroy);
      try { learn(s); } finally { destroy(s); }
    }
    const model = { id: MODEL, name: 'Chrome on-device AI', json: true, ...(a !== 'unavailable' && Object.hasOwn(STATES, pictures) && { vision: pictures !== 'unavailable' }),
      ...(windowSize && { context: { window: windowSize, inputLimit: windowSize - Math.ceil(windowSize * 0.1) } }) };
    return { models: [model], source: 'live', at: Date.now() };
  };

  // A neutral message's parts → the Prompt API's content.
  const content = (m) => m.content.map((p) => (p.type === 'text' ? { type: 'text', value: p.text }
    : { type: 'image', value: new Blob([Uint8Array.from(atob(p.data), (c) => c.charCodeAt(0))], { type: p.mime }) }));
  const words = (m) => m.content.map((p) => p.text).join('\n\n');

  const cool = (k, expected) => {
    const w = warm.get(k);
    if (!w || (expected && w !== expected)) return;
    warm.delete(k); clearTimeout(w.timer); w.control.abort();
    w.ready.then(destroy, () => {});
  };
  const release = () => { for (const k of [...warm.keys()]) cool(k); };
  const idle = (k, w) => { clearTimeout(w.timer); w.timer = setTimeout(() => cool(k, w), WARM.ms); w.timer.unref?.(); };
  // The warm session for `k`, made with `opts` if there is none: shared by the calls that ask together, bounded by its own
  // deadline, never by one call's signal (the call stops waiting; the session stays).
  const warmFor = (LM, k, opts) => {
    let w = warm.get(k);
    if (w) { warm.delete(k); warm.set(k, w); } else {
      const control = new AbortController(), t = setTimeout(() => control.abort(new DOMException('Model response timed out.', 'TimeoutError')), 20000);
      w = { control, timer: null };
      w.ready = wait(Promise.resolve().then(() => LM.create({ ...opts, signal: control.signal })), control.signal, destroy).finally(() => clearTimeout(t));
      w.ready.catch(() => { if (warm.get(k) === w) { warm.delete(k); clearTimeout(w.timer); } });
      warm.set(k, w);
      while (warm.size > WARM.n) cool(warm.keys().next().value);
    }
    idle(k, w);
    return w;
  };

  // What a request's session reads first: its instructions and earlier turns, sampling, and the warm session's key (none for
  // earlier turns or without clone()), the same for a run and for a warm-up.
  const plan = async (LM, req, signal) => {
    const images = R.images(req) > 0;
    const system = req.messages.filter((m) => m.role === 'system').map(words).join('\n\n');
    const history = req.messages.slice(0, -1).filter((m) => m.role !== 'system').map((m) => ({ role: m.role, content: content(m) }));
    let sampling = {};
    if (req.temperature !== undefined && typeof LM.params === 'function') {
      const p = await wait(LM.params().catch(() => null), signal);
      if (p && Number.isFinite(p.maxTemperature) && Number.isFinite(p.defaultTopK)) sampling = { temperature: Math.min(req.temperature, p.maxTemperature), topK: p.defaultTopK };
    }
    const opts = { expectedInputs: inputs(images), initialPrompts: [...(system ? [{ role: 'system', content: system }] : []), ...history], ...sampling };
    const k = !history.length && typeof LM.prototype?.clone === 'function' ? JSON.stringify([system, sampling, images]) : null;
    return { images, opts, k };
  };

  const run = async (req, cfg, { signal, onDelta } = {}) => {
    if (req.tools || req.messages.some((m) => m.role === 'tool' || m.toolCalls)) throw refuse('caps', 'The model on this device does not take tool calls.');
    const last = req.messages.at(-1);
    if (last.role !== 'user') throw refuse('request', 'The last message must be the student\'s.');
    const LM = api();
    if (!LM) throw fail('provider-unavailable', 'The Prompt API is not available in this browser.', 'browser');
    const a = await availability(false, signal);
    if (a !== 'available') throw fail('provider-unavailable', `The model on this device is ${a}.`, a === 'unavailable' ? 'device' : a === 'none' ? 'browser' : 'failed');
    if (R.images(req) > 0 && await availability(true, signal) !== 'available') throw refuse('caps', 'The model on this device does not take pictures.');
    if (signal?.aborted) throw signal.reason;
    const { opts, k } = await plan(LM, req, signal);
    const byteLimit = req.schema && Number.isSafeInteger(req.maxTokens) && req.maxTokens > 0 ? req.maxTokens * 4 : 0;
    const parts = content(last);
    if (req.schema) parts.push({ type: 'text', value: [
      'Return only compact JSON matching this JSON Schema. Respect every maxItems, maxLength and enum constraint. No Markdown, commentary or padding.',
      ...(byteLimit ? [`Keep the entire JSON within ${byteLimit} UTF-8 bytes, the estimated allowance for ${req.maxTokens} output tokens.`] : []),
      JSON.stringify(req.schema),
    ].join('\n') });
    const prompt = [{ role: 'user', content: parts }];
    // Chrome's implicit schema instructions have not always been included in its native input measurement. Supply the
    // full bounded schema ourselves, and measure exactly the prompt that is sent, without duplicate hidden guidance.
    const options = { ...(req.schema && { responseConstraint: req.schema, omitResponseConstraintInput: true }), ...(signal && { signal }) };
    let s, w, dropped = false, dropPhase, ok = false, phase = 'create', measuredInput, contextSize, inputFits = false;
    const diagnostic = (at) => {
      const tokens = Math.ceil(measuredInput), context = Math.floor(contextSize);
      return { phase: at, ...(Number.isSafeInteger(tokens) && tokens >= 0 && tokens <= 10000000 && { tokens }),
        ...(Number.isSafeInteger(context) && context > 0 && context <= 10000000 && { context }) };
    };
    const responseContext = 'The measured input fit, but the model exhausted its context while processing the prompt or response.';
    const contextFailure = (message, at = phase) => fail('request-rejected', message, at === 'response' && inputFits ? 'response-context' : 'context', diagnostic(at));
    const encoder = byteLimit ? new TextEncoder() : null;
    const withinOutput = (value) => {
      if (!encoder || typeof value !== 'string') return;
      // Encode the joined text: a native chunk can split a UTF-16 surrogate pair, whose separate encodings overcount.
      const actual = encoder.encode(value).byteLength;
      if (actual > byteLimit) throw fail('request-rejected', 'The response exceeded the estimated UTF-8 byte allowance.', 'response-limit',
        { ...diagnostic('response'), actual, limit: byteLimit });
    };
    try {
      try {
        w = k && warmFor(LM, k, opts);
        const base = w && await wait(w.ready, signal);
        if (base && typeof base.clone === 'function') { learn(base); s = await wait(base.clone({ ...(signal && { signal }) }), signal, destroy); }
        else {
          if (base) cool(k, w);
          s = await wait(LM.create({ ...opts, ...(signal && { signal }) }), signal, destroy);
        }
      } catch (e) {
        if (e?.name === 'QuotaExceededError') throw contextFailure('The instructions and earlier turns are longer than the model on this device can read.');
        throw e;
      }
      if (signal?.aborted) throw signal.reason;
      learn(s);
      const drop = () => { if (!dropped) dropPhase = phase; dropped = true; };
      for (const ev of ['contextoverflow', 'quotaoverflow']) s.addEventListener?.(ev, drop);
      const measure = s.measureContextUsage || s.measureInputUsage;
      let input = used(s);
      phase = 'measure'; contextSize = room(s);
      if (typeof measure === 'function') {
        const need = await wait(measure.call(s, prompt, options), signal);
        contextSize = room(s);
        const initial = used(s), left = contextSize - initial;
        if (Number.isFinite(need) && need >= 0 && Number.isFinite(initial) && initial >= 0) measuredInput = need + initial;
        inputFits = Number.isFinite(measuredInput) && Number.isFinite(contextSize) && contextSize > 0 && measuredInput <= contextSize;
        if (Number.isFinite(need) && Number.isFinite(left) && need > left) throw contextFailure('The text is longer than the model on this device can read.');
        if (Number.isFinite(need)) input += need;
      }
      if (dropped) throw contextFailure('The model on this device dropped earlier turns while measuring the input.', dropPhase);
      phase = 'response';
      let text = '';
      const deltas = byteLimit && typeof onDelta === 'function' ? [] : null;
      try {
        if (typeof s.promptStreaming === 'function' && (byteLimit || typeof onDelta === 'function')) {
          const reader = s.promptStreaming(prompt, options).getReader();
          try {
            for (;;) {
              const { done, value } = await wait(reader.read(), signal);
              if (done) break;
              if (dropped) break;
              if (typeof value === 'string' && value) {
                const next = text + value; withinOutput(next); text = next;
                if (deltas) deltas.push(value); else onDelta?.(value);
              }
            }
          } finally { reader.cancel().catch(() => {}); reader.releaseLock(); }
        } else {
          // An older implementation without streaming can only reject the completed response afterward. This check
          // bounds accepted output, not how long that native prompt generated before returning.
          text = await wait(s.prompt(prompt, options), signal); withinOutput(text);
          if (deltas) deltas.push(text); else if (typeof onDelta === 'function' && typeof text === 'string') onDelta(text);
        }
      } catch (e) {
        if (e?.name === 'QuotaExceededError') throw contextFailure(inputFits ? responseContext : 'The model could not fit the prompt or response in its context window.');
        throw e;
      }
      if (dropped) throw contextFailure(inputFits ? responseContext : 'The model on this device dropped earlier turns while processing the prompt or response.', dropPhase);
      if (typeof text !== 'string') throw fail('invalid-response', 'The model on this device gave no text.');
      if (deltas) for (const delta of deltas) { if (signal?.aborted) throw signal.reason; onDelta(delta); }
      if (signal?.aborted) throw signal.reason;
      ok = true;
      return { text, model: MODEL, finish: 'stop', ...(Number.isSafeInteger(Math.round(input)) && input > 0 && { usage: { input: Math.round(input) } }) };
    } catch (e) {
      if (signal?.aborted) throw signal.reason;
      if (e?.name === 'QuotaExceededError') throw contextFailure(inputFits && phase === 'response' ? responseContext : 'The text is longer than the model on this device can read.');
      if (e?.name === 'NotSupportedError') throw fail('request-rejected', 'Unsupported model input.', 'unsupported');
      if (e?.name === 'InvalidStateError') throw fail('provider-unavailable', 'The model session is no longer available.', 'assets');
      if (e?.name === 'NotAllowedError') throw fail('provider-unavailable', 'Model activation required.', 'activation');
      // Chromium's exception_helpers.cc uses these for local service, execution and safety failures. They do not mean
      // the extension port or a network connection was lost. Keep only fixed reasons; native descriptions stay private.
      if (e?.name === 'NotReadableError') throw fail('request-rejected', 'The model declined the request under its safety rules.', 'guardrail');
      if (['OperationError', 'UnknownError', 'AbortError'].includes(e?.name)) throw fail('provider-unavailable', 'The model on this device could not complete the request.', 'unknown');
      throw e;
    } finally {
      destroy(s);
      // A warm session whose call failed or timed out (not the caller's cancel) may be what failed: the next call makes another.
      if (k && !ok && (!signal?.aborted || signal.reason?.name === 'TimeoutError')) cool(k, w);
    }
  };

  // A warm-up (lib/ai/providers.js warm): the warm session a run with these instructions will clone, made now so the model
  // is in memory before the student's first pause; one already warm stays, its time renewed. Never starts a download, and
  // asks the model nothing.
  const warmUp = async (req, cfg, { signal } = {}) => {
    const LM = api();
    if (!LM || typeof LM.prototype?.clone !== 'function' || R.images(req) > 0) return false;
    if (await availability(false, signal) !== 'available') return false;
    const { opts, k } = await plan(LM, req, signal);
    if (!k) return false;
    await wait(warmFor(LM, k, opts).ready, signal);
    return true;
  };

  // A check for a real Chrome, from the worker's console (chrome://extensions → Glaze → service worker):
  //   ai(); await GZ_AI_DEVICE.check()
  // It downloads nothing. → { api, status, pictures, window, answer?, refusedLong?, error? }.
  const check = async () => {
    const out = { api: !!api(), status: await status(), pictures: await availability(true) };
    if (out.status.state !== 'ready') return out;
    try {
      const seen = [];
      const r = await P.run('device', { messages: [{ role: 'system', content: 'Answer with JSON only.' }, { role: 'user', content: 'Name one colour as {"colour": "..."}.' }],
        schema: { type: 'object', properties: { colour: { type: 'string' } }, required: ['colour'], additionalProperties: false } }, {}, { onDelta: (t) => seen.push(t) });
      out.answer = { json: r.json, deltas: seen.length, usage: r.usage };
      out.window = windowSize;
      const long = await P.run('device', { messages: [{ role: 'user', content: 'word '.repeat(Math.max(windowSize, 1000) * 2) }] }, {}).catch((e) => e);
      out.refusedLong = long?.code === 'request-rejected';
    } catch (e) { out.error = { code: e?.code, cause: String(e?.cause?.message || e?.message) }; }
    return out;
  };

  return P.add({ id: 'device', config, caps, status, run, catalog, prepare, warm: warmUp, check, release, WARM, _reset: () => { windowSize = 0; preparing = null; release(); } });
})();
if (typeof module !== 'undefined') module.exports = GZ_AI_DEVICE; else GZ_AI_DEVICE;
