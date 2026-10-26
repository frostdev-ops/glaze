// The AI harness's `device` provider (docs/ai-harness.md): Chrome's Prompt API (LanguageModel, Gemini Nano), on this
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
// - No maxTokens: the API takes no output limit.
// cfg: {} (generation kept by the broker). Classic script; module.exports for node.
var GZ_AI_DEVICE = globalThis.GZ_AI_DEVICE || (() => {
  const P = typeof GZ_AI_PROVIDERS !== 'undefined' ? GZ_AI_PROVIDERS : require('../providers.js');
  const R = typeof GZ_AI_REQUEST !== 'undefined' ? GZ_AI_REQUEST : require('../request.js');
  const MODEL = 'gemini-nano';
  const STATES = { unavailable: 'unavailable', downloadable: 'download', downloading: 'downloading', available: 'ready' };
  const api = () => globalThis.LanguageModel || null;
  const fail = (category, message) => Object.assign(new Error(message), { category });
  const refuse = (code, message) => Object.assign(new Error(message), { code });
  let windowSize = 0; // the context window a session reported, once one has
  let preparing = null; // the download in progress: { done, listeners }

  // → cfg, or null: the model is always Gemini Nano; images and context are what the broker learnt from catalog().
  const config = (raw) => {
    if (!R.isObj(raw) || Object.keys(raw).some((k) => !['model', 'images', 'context', 'generation'].includes(k))) return null;
    if (raw.model !== undefined && raw.model !== MODEL) return null;
    if (raw.images !== undefined && typeof raw.images !== 'boolean') return null;
    if (raw.context !== undefined && !(Number.isSafeInteger(raw.context) && raw.context > 0)) return null;
    if (raw.generation !== undefined && (typeof raw.generation !== 'string' || !/^[\w-]{1,64}$/.test(raw.generation))) return null;
    return { model: MODEL, ...(raw.images !== undefined && { images: raw.images }), ...(raw.context && { context: raw.context }), ...(raw.generation && { generation: raw.generation }) };
  };
  const caps = (cfg) => ({ text: true, json: true, stream: true, ...(typeof cfg.images === 'boolean' && { images: cfg.images }), ...(cfg.context && { context: cfg.context }) });
  const inputs = (images) => [{ type: 'text' }, ...(images ? [{ type: 'image' }] : [])];
  const availability = async (images) => {
    const LM = api();
    if (!LM) return 'none';
    try { const a = await LM.availability({ expectedInputs: inputs(images) }); return Object.hasOwn(STATES, a) ? a : 'failed'; } catch { return 'failed'; }
  };
  const describe = (a) => (a === 'none' ? { state: 'unavailable', reason: 'browser' } : a === 'failed' ? { state: 'unavailable', reason: 'failed' } : a === 'unavailable' ? { state: 'unavailable', reason: 'device' } : { state: STATES[a] });
  const status = async () => describe(await availability(false));

  const used = (s) => s.contextUsage ?? s.inputUsage ?? 0;
  const room = (s) => s.contextWindow ?? s.inputQuota;
  const learn = (s) => { const w = room(s); if (Number.isFinite(w) && w > 0) windowSize = Math.floor(w); };

  // The model, downloaded if it isn't there: create() with a monitor, then the session destroyed. Callers that ask while
  // it runs join it and hear its progress. → { state, reason? }.
  const prepare = async (cfg, { onProgress } = {}) => {
    const a = await availability(false);
    if (a === 'available' && windowSize) return { state: 'ready' };
    if (!['downloadable', 'downloading', 'available'].includes(a)) return describe(a);
    const listen = (p) => { if (Number.isFinite(p)) onProgress(Math.min(1, Math.max(0, p))); };
    if (preparing) { if (typeof onProgress === 'function') preparing.listeners.add(listen); return preparing.done; }
    const job = { listeners: new Set(typeof onProgress === 'function' ? [listen] : []) };
    preparing = job;
    job.done = (async () => {
      try {
        const s = await api().create({ expectedInputs: inputs(false), monitor: (m) => m.addEventListener('downloadprogress', (e) => { for (const f of job.listeners) try { f(e.loaded); } catch { /* a listener's own */ } }) });
        learn(s);
        s.destroy();
        return { state: 'ready' };
      } catch (e) {
        return e?.name === 'NotAllowedError' ? { state: 'download', reason: 'activation' } : { state: 'unavailable', reason: 'failed' };
      } finally { if (preparing === job) preparing = null; }
    })();
    return job.done;
  };

  // What the model takes, for the broker's checks (lib/ai/models.js shape): pictures as availability says, the window once a
  // session has told it (a session is made for that only when the model is already there).
  const catalog = async (cfg, { signal } = {}) => {
    const a = await availability(false);
    if (a === 'none' || a === 'failed') throw fail('provider-unavailable', 'The Prompt API is not available.');
    const pictures = a === 'unavailable' ? 'unavailable' : await availability(true);
    if (a === 'available' && !windowSize) {
      const s = await api().create({ expectedInputs: inputs(false), ...(signal && { signal }) });
      try { learn(s); } finally { s.destroy(); }
    }
    const model = { id: MODEL, name: 'Gemini Nano', json: true, ...(a !== 'unavailable' && Object.hasOwn(STATES, pictures) && { vision: pictures !== 'unavailable' }),
      ...(windowSize && { context: { window: windowSize, inputLimit: windowSize - Math.ceil(windowSize * 0.1) } }) };
    return { models: [model], source: 'live', at: Date.now() };
  };

  // A neutral message's parts → the Prompt API's content.
  const content = (m) => m.content.map((p) => (p.type === 'text' ? { type: 'text', value: p.text }
    : { type: 'image', value: new Blob([Uint8Array.from(atob(p.data), (c) => c.charCodeAt(0))], { type: p.mime }) }));
  const words = (m) => m.content.map((p) => p.text).join('\n\n');

  const run = async (req, cfg, { signal, onDelta } = {}) => {
    if (req.tools || req.messages.some((m) => m.role === 'tool' || m.toolCalls)) throw refuse('caps', 'The model on this device does not take tool calls.');
    const last = req.messages.at(-1);
    if (last.role !== 'user') throw refuse('request', 'The last message must be the student\'s.');
    const LM = api();
    if (!LM) throw fail('provider-unavailable', 'The Prompt API is not available in this browser.');
    const images = R.images(req) > 0;
    const a = await availability(false);
    if (a !== 'available') throw fail('provider-unavailable', `The model on this device is ${a}.`);
    if (images && await availability(true) !== 'available') throw refuse('caps', 'The model on this device does not take pictures.');
    if (signal?.aborted) throw signal.reason;
    const system = req.messages.filter((m) => m.role === 'system').map(words).join('\n\n');
    const history = req.messages.slice(0, -1).filter((m) => m.role !== 'system').map((m) => ({ role: m.role, content: content(m) }));
    let sampling = {};
    if (req.temperature !== undefined && typeof LM.params === 'function') {
      const p = await LM.params().catch(() => null);
      if (p && Number.isFinite(p.maxTemperature) && Number.isFinite(p.defaultTopK)) sampling = { temperature: Math.min(req.temperature, p.maxTemperature), topK: p.defaultTopK };
    }
    const prompt = [{ role: 'user', content: content(last) }];
    const options = { ...(req.schema && { responseConstraint: req.schema }), ...(signal && { signal }) };
    let s, dropped = false;
    try {
      try {
        s = await LM.create({ expectedInputs: inputs(images), initialPrompts: [...(system ? [{ role: 'system', content: system }] : []), ...history], ...sampling, ...(signal && { signal }) });
      } catch (e) {
        if (e?.name === 'QuotaExceededError') throw fail('request-rejected', 'The instructions and earlier turns are longer than the model on this device can read.');
        throw e;
      }
      learn(s);
      const drop = () => { dropped = true; };
      for (const ev of ['contextoverflow', 'quotaoverflow']) s.addEventListener?.(ev, drop);
      const measure = s.measureContextUsage || s.measureInputUsage;
      let input = used(s);
      if (typeof measure === 'function') {
        const need = await measure.call(s, prompt, options);
        const left = room(s) - used(s);
        if (Number.isFinite(need) && Number.isFinite(left) && need > left) throw fail('request-rejected', `The text is longer than the model on this device can read (${Math.ceil(need)} tokens, ${Math.floor(left)} left).`);
        if (Number.isFinite(need)) input += need;
      }
      let text = '';
      try {
        if (typeof onDelta === 'function') {
          const reader = s.promptStreaming(prompt, options).getReader();
          try {
            for (;;) {
              const { done, value } = await reader.read();
              if (done) break;
              if (dropped) break;
              if (typeof value === 'string' && value) { text += value; onDelta(value); }
            }
          } finally { reader.cancel().catch(() => {}); }
        } else text = await s.prompt(prompt, options);
      } catch (e) {
        if (e?.name === 'QuotaExceededError') throw fail('request-rejected', 'The text is longer than the model on this device can read.');
        throw e;
      }
      if (dropped) throw fail('request-rejected', 'The model on this device dropped earlier turns to fit the text.');
      if (typeof text !== 'string') throw fail('invalid-response', 'The model on this device gave no text.');
      return { text, model: MODEL, finish: 'stop', ...(Number.isSafeInteger(Math.round(input)) && input > 0 && { usage: { input: Math.round(input) } }) };
    } finally { try { s?.destroy(); } catch { /* gone */ } }
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

  return P.add({ id: 'device', config, caps, status, run, catalog, prepare, check, _reset: () => { windowSize = 0; preparing = null; } });
})();
if (typeof module !== 'undefined') module.exports = GZ_AI_DEVICE; else GZ_AI_DEVICE;
