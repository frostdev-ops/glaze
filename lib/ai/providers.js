// The AI harness's providers, by id (docs/ai-harness.md). A provider is one file (lib/ai/providers/<id>.js) that adds itself
// here with:
//   id: 'openai', /^[a-z][a-z0-9-]{0,31}$/
//   config(raw) → its settings cleaned ({ base, model, key } for openai), or null. The broker keeps them in the worker only.
//   caps(cfg) → { text, images, json, tools, stream, context }: true or false where known; unknown is absent, never false
//   status(cfg, { fetch, signal, cache }) → { state: 'ready' | 'download' | 'downloading' | 'unavailable', reason? }
//   run(request, cfg, { signal, onDelta, onThinking, fetch }) → { text, toolCalls?, usage?, model, finish }
//   origin?(cfg) → the host pattern it sends to ('https://api.example.com/*'), for one that goes over the network: the
//     broker refuses while the browser doesn't hold it. catalog?(cfg, env) → lib/ai/models.js list(). prepare?(cfg,
//     { onProgress }) → status, for a model that downloads to this computer (device). release?() drops what it keeps warm
//     between requests (device, apple), when a connection changes.
// A request without a schema is plain text: its deltas go straight to onDelta (an endpoint's through its credential guard,
// lib/ai/endpoint.js safeStream), and an answer cut off at maxTokens comes back with finish 'length'.
// run() below is the one way in, Rimeward's runModel (src/lib/agent/provider.ts, MIT) on Glaze's request: it cleans the
// request, refuses what the provider is known not to do, holds the call to its own deadline raced with the caller's cancel
// (late output never re-enters), and turns any failure into a category with a reference (lib/ai/failure.js). A schema
// request's answer is read and checked against the schema whatever the provider promised; an answer cut off at maxTokens is
// a refusal, never parsed. Classic script for the worker; module.exports for node.
var GZ_AI_PROVIDERS = globalThis.GZ_AI_PROVIDERS || (() => {
  const R = () => (typeof GZ_AI_REQUEST !== 'undefined' ? GZ_AI_REQUEST : require('./request.js'));
  const S = () => (typeof GZ_AI_SCHEMA !== 'undefined' ? GZ_AI_SCHEMA : require('./schema.js'));
  const E = () => (typeof GZ_AI_ENDPOINT !== 'undefined' ? GZ_AI_ENDPOINT : require('./endpoint.js'));
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
  const CAPS = ['text', 'images', 'json', 'tools', 'stream', 'local']; // local: the model runs on this computer
  const caps = (p, cfg) => { const c = p.caps(cfg) || {}; return { ...Object.fromEntries(CAPS.filter((k) => typeof c[k] === 'boolean').map((k) => [k, c[k]])), ...(Number.isSafeInteger(c.context) && c.context > 0 && { context: c.context }) }; };
  const DEFAULT_TIMEOUT = 120000;
  const F = () => (typeof GZ_AI_FAILURE !== 'undefined' ? GZ_AI_FAILURE : require('./failure.js'));
  // The harness's own refusals pass as they are; anything else from a model call is a failure category.
  const OWN = ['request', 'setup', 'caps', 'changed', 'refusal', 'permission'];

  // run(provider (id or object), request, cfg, { signal, onDelta, onThinking, fetch }) → the result, with json when the
  // request had a schema. Throws { code } (lib/ai/request.js CODES; a failure also carries category, status?, reference).
  const run = async (provider, request, cfg, { signal, onDelta, onThinking, fetch } = {}) => {
    const Q = R();
    const p = typeof provider === 'string' ? get(provider) : provider;
    if (!p) throw Q.error('setup', 'provider');
    const req = Q.clean(request);
    if (!req) throw Q.error('request');
    const c = p.config(cfg);
    if (!c) throw Q.error('setup', 'config');
    const can = caps(p, c);
    if ((Q.images(req) && can.images === false) || (req.tools && can.tools === false) || (req.schema && can.json === false)) throw Q.error('caps');
    if (signal?.aborted) throw F().modelFailure(signal.reason, { aborted: true });
    const timer = F().deadline(req.timeoutMs || DEFAULT_TIMEOUT), both = F().anySignal([signal, timer.signal]);
    // JSON escapes can conceal a credential until the complete object is parsed. Hold keyed schema deltas within the
    // answer limit, then release the original chunks only after both schema and credential validation succeed.
    const buffered = req.schema && c.key ? [] : null;
    let bufferedSize = 0;
    let active = true, rejectAbort;
    const cancelled = new Promise((_, reject) => { rejectAbort = () => reject(both.signal.reason); both.signal.addEventListener('abort', rejectAbort, { once: true }); });
    let raw;
    try {
      raw = await Promise.race([p.run(req, c, { signal: both.signal, fetch,
        onDelta: typeof onDelta === 'function' && can.stream !== false ? (t) => {
          if (!active || typeof t !== 'string' || !t || both.signal.aborted) return;
          if (buffered) {
            bufferedSize += t.length;
            if (bufferedSize > Q.LIMIT.text) throw Object.assign(new Error('Stream response is too large.'), { category: 'invalid-response' });
            buffered.push(t);
          } else onDelta(t);
        } : undefined,
        onThinking: (x) => { if (active && !both.signal.aborted) onThinking?.(x); } }), cancelled]);
    } catch (e) {
      e = E().safeError(e, c.key);
      if (OWN.includes(e?.code) && !both.signal.aborted) throw Object.assign(Q.error(e.code), { detail: e.message });
      throw F().modelFailure(both.signal.aborted && !signal?.aborted && timer.signal.aborted ? Object.assign(new Error('timed out'), { name: 'TimeoutError' }) : e, { aborted: !!signal?.aborted });
    } finally { active = false; timer.done(); both.done(); both.signal.removeEventListener('abort', rejectAbort); }
    const out = Q.result({ ...raw, provider: p.id });
    if (!out) throw F().modelFailure({ category: 'invalid-response' });
    try { E().guard(out, c.key); } catch (e) { throw F().modelFailure(e); }
    if (req.schema && !out.toolCalls) {
      if (out.finish === 'length') throw Q.error('refusal', 'the answer was cut off at maxTokens');
      const json = S().parse(out.text);
      if (json === undefined) throw Object.assign(F().modelFailure({ category: 'invalid-response' }), { detail: 'not a JSON object' });
      try { E().guard(json, c.key); } catch (e) { throw F().modelFailure(e); }
      const errors = S().validate(json, req.schema);
      if (errors.length) throw Object.assign(F().modelFailure({ category: 'invalid-response' }), { detail: errors });
      out.json = json;
    }
    if (buffered?.length) {
      const text = buffered.join('');
      try { E().guard(text, c.key); E().guard(S().parse(text), c.key); } catch (e) { throw F().modelFailure(e); }
      for (const delta of buffered) {
        if (signal?.aborted) throw F().modelFailure(signal.reason, { aborted: true });
        onDelta(delta);
      }
    }
    return out;
  };

  return { add, get, list, caps, run, ID };
})();
if (typeof module !== 'undefined') module.exports = GZ_AI_PROVIDERS; else GZ_AI_PROVIDERS;
