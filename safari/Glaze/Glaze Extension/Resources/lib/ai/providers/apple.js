// The AI harness's `apple` provider (docs/ai-harness.md): Apple's Foundation Models, through Safari's native handler
// (safari/Glaze/Glaze Extension/GlazeAI.swift). cfg: { model: 'on-device' } (Apple Intelligence on this device; text stays
// on the device).
// browser.runtime.sendNativeMessage is one message and one reply, so nothing streams and a cancel is a second message
// (ai.cancel) the native side honours when the run is still in its process. Tools aren't offered: Foundation Models runs a
// tool inside the native call, where Glaze's loop and approvals can't reach it. Added only on Safari; elsewhere the file
// adds nothing. Classic script for the worker; module.exports for node.
var GZ_AI_APPLE = globalThis.GZ_AI_APPLE || (() => {
  const P = typeof GZ_AI_PROVIDERS !== 'undefined' ? GZ_AI_PROVIDERS : require('../providers.js');
  const R = typeof GZ_AI_REQUEST !== 'undefined' ? GZ_AI_REQUEST : require('../request.js');
  const F = typeof GZ_AI_FAILURE !== 'undefined' ? GZ_AI_FAILURE : require('../failure.js');
  // Context sizes as Foundation Models reports them on macOS 27 (contextSize).
  const MODELS = { 'on-device': { context: 8192, name: 'Apple Intelligence (on this device)' } };
  const APP = 'io.frostdev.Glaze'; // Safari ignores it and asks the containing app's extension.
  const STATES = ['ready', 'download', 'downloading', 'unavailable'];
  let metadata = { context: MODELS['on-device'].context, images: true };
  const safari = () => { try { return new URL((typeof globalThis.browser?.runtime?.getURL === 'function' ? globalThis.browser.runtime : globalThis.chrome?.runtime).getURL('')).protocol === 'safari-web-extension:'; } catch { return false; } };
  const runtime = () => (typeof globalThis.browser?.runtime?.sendNativeMessage === 'function' ? globalThis.browser.runtime : globalThis.chrome?.runtime);
  const send = async (m) => {
    let reply;
    try { reply = await runtime().sendNativeMessage(APP, m); } catch { throw Object.assign(new Error('native handler'), { category: 'provider-unavailable' }); }
    if (!R.isObj(reply)) throw Object.assign(new Error('native reply'), { category: 'invalid-response' });
    return reply;
  };

  const config = (raw) => (R.isObj(raw) && Object.hasOwn(MODELS, raw.model) ? { model: raw.model } : null);
  const caps = (cfg) => ({ text: true, images: metadata.images, json: true, tools: false, stream: false, local: true, context: Math.min(cfg.context || metadata.context, metadata.context) });
  // Never forward arbitrary native diagnostics, even to Settings. Checking status sends no prompt.
  const REASONS = ['os', 'off', 'device', 'not-ready', 'unknown'];
  const status = async (cfg, { signal } = {}) => {
    const timer = F.deadline(20000), both = F.anySignal([signal, timer.signal]);
    try {
      const r = await F.wait(() => send({ type: 'ai.status', model: cfg.model }), both.signal);
      if (r.ok !== true || !STATES.includes(r.state)) return { state: 'unavailable', reason: 'native' };
      if (r.state === 'ready') metadata = { context: Number.isSafeInteger(r.context) && r.context > 0 ? r.context : metadata.context, images: typeof r.images === 'boolean' ? r.images : metadata.images };
      return { state: r.state, ...(r.state !== 'ready' && { reason: REASONS.includes(r.reason) ? r.reason : 'native' }) };
    } catch { return { state: 'unavailable', reason: 'native' }; }
    finally { timer.done(); both.done(); }
  };
  // A schema with each object's keys in their order (x-order): the native side gets a dictionary, which keeps none, and the
  // model writes an object's keys in the order its schema gives them (a decision's evidence before its score).
  const ordered = (s) => {
    if (!R.isObj(s)) return s;
    const o = { ...s };
    if (R.isObj(s.properties)) { o.properties = Object.fromEntries(Object.entries(s.properties).map(([k, v]) => [k, ordered(v)])); o['x-order'] = Object.keys(s.properties); }
    if (s.items !== undefined) o.items = ordered(s.items);
    if (Array.isArray(s.anyOf)) o.anyOf = s.anyOf.map(ordered);
    return o;
  };
  const run = async (req, cfg, { signal } = {}) => {
    if (signal?.aborted) throw F.modelFailure(signal.reason, { aborted: true });
    const id = crypto.randomUUID();
    const m = { type: 'ai.run', id, model: cfg.model, messages: req.messages, ...(req.schema !== undefined && { schema: ordered(req.schema) }),
      ...['temperature', 'maxTokens'].reduce((o, k) => (req[k] === undefined ? o : { ...o, [k]: req[k] }), {}) };
    const stop = () => { send({ type: 'ai.cancel', id }).catch(() => {}); };
    signal?.addEventListener('abort', stop, { once: true });
    try {
      const r = await F.wait(() => send(m), signal);
      if (signal?.aborted) throw signal.reason;
      if (r.ok === true && typeof r.text === 'string') {
        const u = R.isObj(r.usage) ? r.usage : null;
        return { text: r.text, model: typeof r.model === 'string' ? r.model : cfg.model, finish: r.finish === 'length' ? 'length' : 'stop', ...(u && { usage: u }) };
      }
      if (r.ok === false && r.error === 'refusal') throw Object.assign(R.error('refusal'), F.diagnostic(r));
      const category = r.ok === false && F.CATEGORIES.includes(r.error) ? r.error : 'invalid-response';
      // The native reason and thrown errors may contain prompt text; retain only our categories.
      throw Object.assign(new Error('apple'), { category, ...F.diagnostic(r), ...(r.status === 429 && { status: 429 }) });
    } finally { signal?.removeEventListener('abort', stop); }
  };
  // A warm-up: the native side makes and prewarms a session with the request's instructions (ai.warm), which the next run
  // with them takes (GlazeAI.swift). Nothing is asked of the model.
  const warm = async (req, cfg, { signal } = {}) => {
    const instructions = req.messages.filter((m) => m.role === 'system').flatMap((m) => m.content.filter((p) => p.type === 'text').map((p) => p.text)).join('\n\n');
    if (!instructions) return false;
    try { return (await F.wait(() => send({ type: 'ai.warm', model: cfg.model, instructions }), signal)).ok === true; } catch { return false; }
  };
  const catalog = async () => ({ models: Object.entries(MODELS).map(([id, m]) => ({ id, name: m.name })), source: 'none', at: Date.now() });
  // A connection changed: the native side drops its warm sessions (GlazeAI.swift).
  const release = () => { send({ type: 'ai.release' }).catch(() => {}); };
  const provider = { id: 'apple', config, caps, status, run, warm, catalog, release };
  return safari() ? P.add(provider) : provider;
})();
if (typeof module !== 'undefined') module.exports = GZ_AI_APPLE; else GZ_AI_APPLE;
