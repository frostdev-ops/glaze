// The AI harness's providers, by id (docs/ai-harness.md). A provider is one file (lib/ai/providers/<id>.js) that adds itself
// here with:
//   id: 'openai', /^[a-z][a-z0-9-]{0,31}$/
//   config(raw) → its settings cleaned ({ base, model, key } for openai), or null. The broker keeps them in the worker only.
//   caps(cfg) → { text, images, json, tools, stream } (booleans), and context (tokens it reads) when known
//   status(cfg, { fetch, signal }) → { state: 'ready' | 'download' | 'downloading' | 'unavailable', reason? }
//   run(request, cfg, { signal, onDelta, fetch }) → { text, toolCalls?, usage?, model, finish } (lib/ai/request.js result)
//   origin(cfg) → the host pattern it sends to ('https://api.example.com/*'), for a provider that goes over the network;
//     the broker refuses while the browser doesn't hold it.
// run() below is the one way in: it cleans the request, checks the provider can do what it asks, holds it to its time, and
// reads and checks a JSON answer against the request's schema, whatever the provider promised. Classic script for the
// worker; module.exports for node.
var GZ_AI_PROVIDERS = globalThis.GZ_AI_PROVIDERS || (() => {
  const R = () => (typeof GZ_AI_REQUEST !== 'undefined' ? GZ_AI_REQUEST : require('./request.js'));
  const S = () => (typeof GZ_AI_SCHEMA !== 'undefined' ? GZ_AI_SCHEMA : require('./schema.js'));
  const ID = /^[a-z][a-z0-9-]{0,31}$/;
  const all = new Map();
  const add = (p) => {
    if (!p || !ID.test(p.id) || !['config', 'caps', 'status', 'run'].every((k) => typeof p[k] === 'function') || (p.origin !== undefined && typeof p.origin !== 'function')) throw new TypeError('provider');
    if (all.has(p.id) && all.get(p.id) !== p) throw new TypeError(`provider ${p.id} is already added`);
    all.set(p.id, Object.freeze(p));
    return p;
  };
  const get = (id) => all.get(id) || null;
  const list = () => [...all.keys()];
  const CAPS = ['text', 'images', 'json', 'tools', 'stream'];
  const caps = (p, cfg) => { const c = p.caps(cfg) || {}; return { ...Object.fromEntries(CAPS.map((k) => [k, c[k] === true])), ...(Number.isSafeInteger(c.context) && c.context > 0 && { context: c.context }) }; };
  const DEFAULT_TIMEOUT = 120000;

  // A signal that aborts with the caller's, or with a TimeoutError after ms. → { signal, done() }.
  const deadline = (outer, ms) => {
    const c = new AbortController();
    const stop = () => c.abort(outer.reason ?? new DOMException('Cancelled', 'AbortError'));
    if (outer?.aborted) stop(); else outer?.addEventListener('abort', stop, { once: true });
    const timer = setTimeout(() => c.abort(new DOMException('Timed out', 'TimeoutError')), ms);
    return { signal: c.signal, done: () => { clearTimeout(timer); outer?.removeEventListener('abort', stop); } };
  };

  // run(provider (id or object), request, cfg, { signal, onDelta, fetch }) → the result, with json when the request had a
  // schema and the model answered with words. Throws { code } (lib/ai/request.js CODES).
  const run = async (provider, request, cfg, { signal, onDelta, fetch } = {}) => {
    const Q = R();
    const p = typeof provider === 'string' ? get(provider) : provider;
    if (!p) throw Q.error('setup', 'provider');
    const req = Q.clean(request);
    if (!req) throw Q.error('request');
    const c = p.config(cfg);
    if (!c) throw Q.error('setup', 'config');
    const can = caps(p, c);
    if ((Q.images(req) && !can.images) || (req.tools && !can.tools) || (req.schema && !can.json)) throw Q.error('caps');
    if (signal?.aborted) throw Q.error('cancelled');
    const d = deadline(signal, req.timeoutMs || DEFAULT_TIMEOUT);
    let raw;
    try {
      raw = await p.run(req, c, { signal: d.signal, fetch, onDelta: typeof onDelta === 'function' && can.stream ? (t) => { if (typeof t === 'string' && t && !d.signal.aborted) onDelta(t); } : undefined });
    } catch (e) {
      if (d.signal.aborted) throw Q.error(d.signal.reason?.name === 'TimeoutError' ? 'timeout' : 'cancelled');
      throw Q.CODES.includes(e?.code) ? e : Q.error(Q.code(e));
    } finally { d.done(); }
    if (d.signal.aborted) throw Q.error(d.signal.reason?.name === 'TimeoutError' ? 'timeout' : 'cancelled');
    const out = Q.result({ ...raw, provider: p.id });
    if (!out) throw Q.error('format', 'result');
    if (out.finish === 'refusal') throw Q.error('refusal');
    if (req.schema && !out.toolCalls) {
      if (out.finish === 'length') throw Q.error('size', 'the answer was cut off at maxTokens');
      const json = S().parse(out.text);
      if (json === undefined) throw Q.error('format', 'not JSON');
      const errors = S().validate(json, req.schema);
      if (errors.length) throw Q.error('format', errors);
      out.json = json;
    }
    return out;
  };

  return { add, get, list, caps, run, ID };
})();
if (typeof module !== 'undefined') module.exports = GZ_AI_PROVIDERS; else GZ_AI_PROVIDERS;
