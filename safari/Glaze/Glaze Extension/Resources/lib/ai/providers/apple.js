// The AI harness's `apple` provider (docs/ai-harness.md): Apple's Foundation Models, through Safari's native handler
// (safari/Glaze/Glaze Extension/GlazeAI.swift). cfg: { model: 'on-device' (Apple Intelligence on this device) |
// 'private-cloud' (Apple's Private Cloud Compute: the request leaves the device, encrypted to Apple's servers) }.
// browser.runtime.sendNativeMessage is one message and one reply, so nothing streams and a cancel is a second message
// (ai.cancel) the native side honours when the run is still in its process. Tools aren't offered: Foundation Models runs a
// tool inside the native call, where Glaze's loop and approvals can't reach it. Added only on Safari; elsewhere the file
// adds nothing. Classic script for the worker; module.exports for node.
var GZ_AI_APPLE = globalThis.GZ_AI_APPLE || (() => {
  const P = typeof GZ_AI_PROVIDERS !== 'undefined' ? GZ_AI_PROVIDERS : require('../providers.js');
  const R = typeof GZ_AI_REQUEST !== 'undefined' ? GZ_AI_REQUEST : require('../request.js');
  const F = typeof GZ_AI_FAILURE !== 'undefined' ? GZ_AI_FAILURE : require('../failure.js');
  // Context sizes as Foundation Models reports them on macOS 27 (contextSize).
  const MODELS = { 'on-device': { context: 8192 }, 'private-cloud': { context: 32768 } };
  const APP = 'io.frostdev.Glaze'; // Safari ignores it and asks the containing app's extension.
  const STATES = ['ready', 'download', 'downloading', 'unavailable'];
  const safari = () => { try { return new URL(globalThis.chrome.runtime.getURL('')).protocol === 'safari-web-extension:'; } catch { return false; } };
  const runtime = () => (typeof globalThis.browser?.runtime?.sendNativeMessage === 'function' ? globalThis.browser.runtime : globalThis.chrome?.runtime);
  const send = async (m) => {
    let reply;
    try { reply = await runtime().sendNativeMessage(APP, m); } catch (e) { throw Object.assign(new Error('native handler'), { category: 'provider-unavailable', cause: e }); }
    if (!R.isObj(reply)) throw Object.assign(new Error('native reply'), { category: 'invalid-response' });
    return reply;
  };

  const config = (raw) => (R.isObj(raw) && Object.hasOwn(MODELS, raw.model) ? { model: raw.model } : null);
  const caps = (cfg) => ({ text: true, images: true, json: true, tools: false, stream: false, context: MODELS[cfg.model].context });
  const status = async (cfg) => {
    try {
      const r = await send({ type: 'ai.status', model: cfg.model });
      if (r.ok !== true || !STATES.includes(r.state)) return { state: 'unavailable', reason: 'native' };
      return { state: r.state, ...(r.state !== 'ready' && typeof r.reason === 'string' && { reason: r.reason.slice(0, 40) }) };
    } catch { return { state: 'unavailable', reason: 'native' }; }
  };
  const run = async (req, cfg, { signal } = {}) => {
    const id = crypto.randomUUID();
    const m = { type: 'ai.run', id, model: cfg.model, messages: req.messages, ...['schema', 'temperature', 'maxTokens'].reduce((o, k) => (req[k] === undefined ? o : { ...o, [k]: req[k] }), {}) };
    const stop = () => { send({ type: 'ai.cancel', id }).catch(() => {}); };
    signal?.addEventListener('abort', stop, { once: true });
    try {
      const r = await send(m);
      if (signal?.aborted) throw signal.reason;
      if (r.ok === true && typeof r.text === 'string') {
        const u = R.isObj(r.usage) ? r.usage : null;
        return { text: r.text, model: typeof r.model === 'string' ? r.model : cfg.model, finish: r.finish === 'length' ? 'length' : 'stop', ...(u && { usage: u }) };
      }
      if (r.ok === false && r.error === 'refusal') throw R.error('refusal');
      const category = r.ok === false && F.CATEGORIES.includes(r.error) && r.error !== 'cancelled' ? r.error : 'invalid-response';
      // The native reason is for a developer only (the eval); the failure's message never carries it.
      throw Object.assign(new Error('apple'), { category, ...(r.status === 429 && { status: 429 }), detail: typeof r.reason === 'string' ? r.reason.slice(0, 200) : undefined });
    } finally { signal?.removeEventListener('abort', stop); }
  };
  const provider = { id: 'apple', config, caps, status, run };
  return safari() ? P.add(provider) : provider;
})();
if (typeof module !== 'undefined') module.exports = GZ_AI_APPLE; else GZ_AI_APPLE;
