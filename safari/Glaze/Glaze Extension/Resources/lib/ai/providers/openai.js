// Ported from Rimeward src/lib/agent/openrouter.ts (chatStream, readChatResponse, toWire, fromWire, callCompat), codex.ts
// (the typed single fallback remembered per model) and provider.ts (the retry rule) (MIT). The AI harness's `openai`
// provider (docs/ai-harness.md): any server that speaks Chat Completions (POST <base>/chat/completions): OpenAI, Anthropic,
// Gemini, OpenRouter, xAI, Mistral, Groq, DeepSeek, Ollama, LM Studio, vLLM. cfg: { base (lib/ai/endpoint.js: https, or
// http on this computer), model (none: a connection not yet used, its key checked by status only), key? (a Bearer
// token to that server only), images? (the student says the model takes pictures), context? (tokens it reads),
// generation? (lib/ai/endpoint.js) }. Glaze keeps its own neutral messages; toWire and fromWire are this provider's
// converters. A request asks for json_schema output; a server that refuses that parameter by name gets json_object (the
// schema then in the system message), and one that refuses that, the schema in words only, the answer read as askJson
// reads one: remembered for that server and model for an hour. max_tokens, temperature and a reasoning effort step down
// the same way. One quiet retry, after 1.2 s, only for a 429 (the server ran nothing); a dropped connection, a 5xx or a
// cut stream may have run the request and are never replayed. Runs in the worker and in node (fetch passed in, or the
// global one) for the eval. Classic script; module.exports for node.
var GZ_AI_OPENAI = globalThis.GZ_AI_OPENAI || (() => {
  const P = typeof GZ_AI_PROVIDERS !== 'undefined' ? GZ_AI_PROVIDERS : require('../providers.js');
  const R = typeof GZ_AI_REQUEST !== 'undefined' ? GZ_AI_REQUEST : require('../request.js');
  const S = typeof GZ_AI_SCHEMA !== 'undefined' ? GZ_AI_SCHEMA : require('../schema.js');
  const ST = typeof GZ_AI_STREAM !== 'undefined' ? GZ_AI_STREAM : require('../stream.js');
  const F = typeof GZ_AI_FAILURE !== 'undefined' ? GZ_AI_FAILURE : require('../failure.js');
  const E = typeof GZ_AI_ENDPOINT !== 'undefined' ? GZ_AI_ENDPOINT : require('../endpoint.js');
  const M = typeof GZ_AI_MODELS !== 'undefined' ? GZ_AI_MODELS : require('../models.js');
  const isObj = R.isObj;
  // body: an answer's bytes; error: what is read of a refusal; remember: how long a step down holds for a model.
  const LIMIT = { body: 10 << 20, error: 64 << 10, model: 200, key: 512, context: 2e6, retry: 1200, remember: 3600000 };
  const CTRL = /[\p{Cc}\p{Bidi_Control}]/u;

  // → cfg cleaned, or null. A key is trimmed, and an empty one is none (the office app's setSecret).
  const config = (raw) => {
    if (!isObj(raw) || Object.keys(raw).some((k) => !['base', 'model', 'key', 'images', 'context', 'generation'].includes(k))) return null;
    const base = E.clean(raw.base);
    if (!base) return null;
    if (raw.model !== undefined && (typeof raw.model !== 'string' || !raw.model || raw.model.length > LIMIT.model || raw.model.trim() !== raw.model || CTRL.test(raw.model))) return null;
    const key = typeof raw.key === 'string' ? raw.key.trim() : raw.key;
    if (key !== undefined && key !== '' && (typeof key !== 'string' || key.length > LIMIT.key || !/^[\x21-\x7e]+$/.test(key))) return null;
    if (raw.images !== undefined && typeof raw.images !== 'boolean') return null;
    if (raw.context !== undefined && !(Number.isSafeInteger(raw.context) && raw.context > 0 && raw.context <= LIMIT.context)) return null;
    if (raw.generation !== undefined && (typeof raw.generation !== 'string' || !/^[\w-]{1,64}$/.test(raw.generation))) return null;
    return { base, ...(raw.model && { model: raw.model }), ...(key && { key }), ...(raw.images !== undefined && { images: raw.images }), ...(raw.context && { context: raw.context }), ...(raw.generation && { generation: raw.generation }) };
  };
  // What it can do: text, JSON and streaming always; pictures only when the student says so (unknown is absent, never
  // false); tools unknown until a catalog says (lib/ai/models.js).
  const caps = (cfg) => ({ text: true, json: true, stream: true, ...(cfg.images !== undefined && { images: cfg.images }), ...(cfg.context && { context: cfg.context }) });
  // The host the browser must hold for Glaze to reach the server (the manifest's optional https://*/* and loopback hosts).
  const origin = (cfg) => { const u = new URL(cfg.base); return `${u.protocol}//${u.hostname}/*`; };

  // ---- wire ------------------------------------------------------------------------------------------------------------
  const words = (m) => m.content.filter((p) => p.type === 'text').map((p) => p.text).join('\n\n');
  // A neutral message (lib/ai/request.js) → Chat Completions'.
  const toWire = (m, cache = false) => {
    if (m.role === 'user' && m.content.some((p) => p.type === 'image' || (cache && p.cache))) {
      return { role: 'user', content: m.content.map((p) => (p.type === 'text' ? { type: 'text', text: p.text, ...(cache && p.cache && { cache_control: { type: 'ephemeral' } }) } : { type: 'image_url', image_url: { url: `data:${p.mime};base64,${p.data}` } })) };
    }
    if (m.role === 'assistant' && m.toolCalls) {
      return { role: 'assistant', content: words(m), tool_calls: m.toolCalls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: typeof c.args === 'string' ? c.args : JSON.stringify(c.args ?? {}) } })) };
    }
    if (m.role === 'tool') return { role: 'tool', tool_call_id: m.toolCallId, content: words(m) };
    return { role: m.role, content: words(m) };
  };
  // An answer's message → its text and calls (arguments parsed when they are JSON; the loop answers one that isn't).
  const fromWire = (msg) => {
    const text = typeof msg?.content === 'string' ? msg.content : Array.isArray(msg?.content) ? msg.content.map((c) => (typeof c?.text === 'string' ? c.text : '')).join('') : '';
    const calls = (Array.isArray(msg?.tool_calls) ? msg.tool_calls : []).filter((tc) => typeof tc?.id === 'string' && typeof tc.function?.name === 'string')
      .map((tc) => { const a = typeof tc.function.arguments === 'string' ? tc.function.arguments : '{}'; let args = a; try { args = JSON.parse(a || '{}'); } catch { /* answered as invalid */ } return { id: tc.id, name: tc.function.name, args }; });
    return { text, calls, refusal: typeof msg?.refusal === 'string' && msg.refusal ? msg.refusal : '' };
  };

  // ---- the stream (Rimeward's chatStream) ---------------------------------------------------------------------------------
  // A streamed answer put back together: text to onText as it comes, tool calls rebuilt by index. Throws on an error chunk,
  // a finish other than stop, tool_calls or length, a stream that ends before it finishes, a call missing its id or name, or
  // arguments that aren't JSON. 'length' comes back as the finish (a schema task treats it as a refusal).
  const chatStream = (onText, onThinking) => {
    const thinking = ST.thinkingCounter(onThinking);
    const msg = { role: 'assistant', content: '' };
    const calls = new Map();
    let finish = null, usage, model;
    return {
      push(chunk) {
        if (typeof chunk.model === 'string') model = chunk.model;
        if (chunk.error) throw Object.assign(Error(chunk.error.message ?? JSON.stringify(chunk.error)), { ...(Number.isInteger(chunk.error.code) && { status: chunk.error.code }) });
        if (chunk.usage) usage = chunk.usage;
        const choice = chunk.choices?.[0];
        if (!choice) { thinking.usage(usage?.completion_tokens_details?.reasoning_tokens); return; }
        const delta = choice.delta ?? {};
        // Providers may send both representations of the same reasoning; count one.
        const reasoningText = delta.reasoning ?? delta.reasoning_content;
        thinking.text(typeof reasoningText === 'string' && reasoningText ? reasoningText
          : (delta.reasoning_details ?? []).filter((d) => d.type === 'reasoning.text').map((d) => (typeof d.text === 'string' ? d.text : '')).join(''), false);
        const text = delta.content ?? delta.refusal;
        if (typeof text === 'string' && text) {
          if (msg.content.length + text.length > R.LIMIT.text) throw Object.assign(Error('Stream response is too large.'), { category: 'invalid-response' });
          msg.content += text; onText?.(text);
        }
        if (typeof delta.refusal === 'string') msg.refusal = (msg.refusal ?? '') + delta.refusal;
        for (const tc of delta.tool_calls ?? []) {
          if (!Number.isInteger(tc.index) || tc.index < 0 || tc.index >= R.LIMIT.calls) throw Error('Invalid streamed tool index');
          const item = calls.get(tc.index) ?? { id: '', type: 'function', function: { name: '', arguments: '' } };
          if (tc.id) item.id = tc.id;
          if (tc.function?.name) item.function.name = tc.function.name; // sent whole, some servers repeat it per chunk
          if (tc.function?.arguments) {
            if (item.function.arguments.length + tc.function.arguments.length > R.LIMIT.args) throw Object.assign(Error('Stream tool arguments are too large.'), { category: 'invalid-response' });
            item.function.arguments += tc.function.arguments;
          }
          calls.set(tc.index, item);
        }
        if (chunk.usage) thinking.usage(usage.completion_tokens_details?.reasoning_tokens);
        const f = choice.finish_reason;
        if (f) {
          if (!['stop', 'tool_calls', 'function_call', 'length'].includes(f)) throw Object.assign(Error(`Incomplete response (${f})`), { category: 'invalid-response' });
          finish = f;
        }
      },
      result() {
        if (!finish) throw Object.assign(Error('response stream ended before completion'), { category: 'invalid-response' });
        if (calls.size) {
          msg.tool_calls = [...calls.entries()].sort(([a], [b]) => a - b).map(([, call]) => call);
          for (const tc of msg.tool_calls) {
            if (!tc.id || !tc.function.name) throw Object.assign(Error('Incomplete streamed tool call'), { category: 'invalid-response' });
            JSON.parse(tc.function.arguments || '{}');
          }
        }
        return { choices: [{ message: msg, finish_reason: finish }], usage, ...(model && { model }) };
      },
    };
  };

  // ---- the request -----------------------------------------------------------------------------------------------------
  const SAY_JSON = (schema) => `Answer with one JSON object and nothing else. It must match this JSON Schema:\n${JSON.stringify(schema)}`;
  const body = (req, cfg, mode, stream) => {
    // OpenRouter documents per-block cache_control for Chat Completions. Anthropic's compatible endpoint does not
    // support caching; there is no native Messages provider here. Other compatible servers keep ordinary text.
    const cache = openrouter(cfg) && /^anthropic\//.test(cfg.model);
    const messages = req.messages.map((m) => toWire(m, cache));
    // Without json_schema, the schema is said in words (and json_object wants the word JSON in a message).
    if (req.schema && mode.format !== 'schema') {
      const sys = messages.find((m) => m.role === 'system');
      if (sys) sys.content = `${sys.content}\n\n${SAY_JSON(req.schema)}`; else messages.unshift({ role: 'system', content: SAY_JSON(req.schema) });
    }
    return {
      model: cfg.model, messages, stream,
      ...(stream && { stream_options: { include_usage: true } }),
      ...(req.schema && mode.format === 'schema' && { response_format: { type: 'json_schema', json_schema: { name: 'answer', strict: S.strict(req.schema), schema: req.schema } } }),
      ...(req.schema && mode.format === 'object' && { response_format: { type: 'json_object' } }),
      ...(req.tools && { tools: req.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } })), tool_choice: 'auto' }),
      ...(req.temperature !== undefined && mode.temperature && { temperature: req.temperature }),
      ...(req.maxTokens && { [mode.tokens]: req.maxTokens }),
      ...(req.effort && !mode.noEffort && (openrouter(cfg) ? { reasoning: { effort: effort(req, mode) } } : { reasoning_effort: effort(req, mode) })),
    };
  };
  // A reasoning model's effort: OpenRouter's reasoning object there, OpenAI's reasoning_effort elsewhere (Gemini, xAI and Groq
  // take it too). A model that must reason refuses 'none' (OpenRouter: a 400, its catalog's reasoning.mandatory), and one may
  // not list 'minimal' (supported_efforts), so a refusal steps up a level at a time, to 'low'; a server or model that refuses
  // the parameter at all (its typed code, or words saying so) gets none. A level stepped up to only ever raises a request's own.
  const openrouter = (cfg) => /(^|\.)openrouter\.ai$/i.test(new URL(cfg.base).hostname);
  // Anthropic's compatible endpoint: it answers a browser's request only with its direct-access header, and ignores
  // response_format, so a schema goes in words from the start.
  const anthropic = (cfg) => new URL(cfg.base).hostname === 'api.anthropic.com';
  const UP = { none: 'minimal', minimal: 'low' };
  const effort = (req, mode) => (R.EFFORTS.indexOf(mode.effort) > R.EFFORTS.indexOf(req.effort) ? mode.effort : req.effort);
  // A refusal of one parameter, by name: the server's typed error ({ error: { param } }), else (ponytail: servers without
  // typed errors) its message naming that parameter. Only these step down; any other 400 is the request's fault.
  const refused = (text, pattern) => {
    let e = null;
    try { e = JSON.parse(text)?.error; } catch { /* not JSON */ }
    if (typeof e?.param === 'string') return pattern.test(e.param);
    return pattern.test(typeof e?.message === 'string' ? e.message : text);
  };
  const unknown = (text) => {
    let e = null;
    try { e = JSON.parse(text)?.error; } catch { /* not JSON */ }
    return e?.code === 'unsupported_parameter' || /unrecogni[sz]ed|unknown (?:parameter|argument|field)|unsupported parameter|extra (?:inputs|fields)/i.test(typeof e?.message === 'string' ? e.message : text);
  };
  const STEPS = [
    [(t, m, req) => req.schema && m.format === 'schema' && refused(t, /response_format|json_schema/i), (m) => ({ ...m, format: 'object' })],
    [(t, m, req) => req.schema && m.format === 'object' && refused(t, /response_format|json_object/i), (m) => ({ ...m, format: 'none' })],
    [(t, m, req) => req.maxTokens && m.tokens === 'max_tokens' && refused(t, /max_tokens/i), (m) => ({ ...m, tokens: 'max_completion_tokens' })],
    [(t, m, req) => req.temperature !== undefined && m.temperature && refused(t, /temperature/i), (m) => ({ ...m, temperature: false })],
    [(t, m, req) => req.effort && !m.noEffort && UP[effort(req, m)] && refused(t, /reasoning|effort/i) && !unknown(t), (m, req) => ({ ...m, effort: UP[effort(req, m)] })],
    [(t, m, req) => req.effort && !m.noEffort && refused(t, /reasoning|effort/i), (m) => ({ ...m, noEffort: true })],
  ];
  const FIRST = { format: 'schema', tokens: 'max_tokens', temperature: true };
  const modes = new Map(); // `${base}\n${model}` → { mode, until }
  const remember = (k, mode) => { modes.delete(k); if (mode !== FIRST) modes.set(k, { mode, until: Date.now() + LIMIT.remember }); if (modes.size > 50) modes.delete(modes.keys().next().value); };
  // A server's words, for a developer's eyes only (an Error's cause): the key, and anything shaped like one, out.
  const redact = (s, cfg) => E.redact(s, cfg.key);
  const pause = (ms, signal) => new Promise((resolve, reject) => {
    const t = setTimeout(() => { signal?.removeEventListener('abort', stop); resolve(); }, ms);
    const stop = () => { clearTimeout(t); reject(signal.reason); };
    if (signal?.aborted) stop(); else signal?.addEventListener('abort', stop, { once: true });
  });

  // run(request, cfg, { signal, onDelta, onThinking, fetch }) → the result (lib/ai/request.js). No cookies, no referrer,
  // no redirect (a redirect would take the key elsewhere).
  const request = async (req, cfg, { signal, onDelta, onThinking, fetch = globalThis.fetch } = {}) => {
    const k = `${cfg.base}\n${cfg.model}`, kept = modes.get(k), stream = typeof onDelta === 'function';
    if (!cfg.model) throw Object.assign(new Error('Pick a model for this connection.'), { code: 'setup' });
    let mode = kept && kept.until > Date.now() ? kept.mode : anthropic(cfg) ? { ...FIRST, format: 'none' } : FIRST, retried = false;
    // The effort step can run once per UP level. Leave room for the final answer and the one 429 retry too.
    for (let i = 0; i < STEPS.length + Object.keys(UP).length + 1; i++) {
      let res;
      try {
        res = await fetch(`${cfg.base}/chat/completions`, { method: 'POST', credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error', cache: 'no-store', signal,
          headers: { 'content-type': 'application/json', accept: stream ? 'text/event-stream' : 'application/json', ...(cfg.key && { authorization: `Bearer ${cfg.key}` }),
            ...(anthropic(cfg) && { 'anthropic-dangerous-direct-browser-access': 'true' }) },
          body: JSON.stringify(body(req, cfg, mode, stream)) });
      } catch (err) {
        // A cancel, or a refusal before anything was sent (the broker's pinned fetch: another host, a changed connection).
        if (signal?.aborted || typeof err?.code === 'string') throw err;
        throw E.safeError(err, cfg.key);
      }
      if (res.status < 200 || res.status >= 300) {
        const text = await F.bounded(res, LIMIT.error).catch((e) => { if (signal?.aborted) throw e; return ''; });
        const step = (res.status === 400 || res.status === 422) && STEPS.find(([when]) => when(text, mode, req));
        if (step) { mode = step[1](mode, req); continue; }
        if (!retried && F.transient(res.status)) { retried = true; await pause(LIMIT.retry, signal); continue; }
        if (res.status === 400 && R.images(req) && /image|vision|modalit|multimodal/i.test(text)) throw Object.assign(new Error(`"${cfg.model}" does not take pictures. Pick a vision model.`), { code: 'caps' });
        throw Object.assign(new Error(`compat: ${res.status} ${redact(text, cfg)}`), { status: res.status });
      }
      let data, safe;
      if (/text\/event-stream/i.test(res.headers.get('content-type') || '')) {
        // A server may answer a stream request with one JSON body; this one streams.
        safe = E.safeStream(onDelta, cfg.key);
        const s = chatStream((text) => safe.push(text), onThinking);
        await ST.readSse(res.body, (payload) => { if (payload !== '[DONE]') s.push(E.guard(JSON.parse(payload), cfg.key)); }, undefined, signal);
        data = s.result();
      } else data = JSON.parse(await F.bounded(res, LIMIT.body));
      E.guard(data, cfg.key);
      const choice = data?.choices?.[0], raw = choice?.message;
      if (!raw) throw Object.assign(new Error('compat: empty response'), { category: 'invalid-response' });
      const finish = choice.finish_reason ?? 'stop';
      if (!['stop', 'tool_calls', 'function_call', 'length'].includes(finish)) throw Object.assign(new Error(`Incomplete response (${finish})`), { category: 'invalid-response' });
      const { text, calls, refusal } = fromWire(raw);
      E.guard({ text, calls }, cfg.key);
      if (refusal) throw Object.assign(new Error('The model declined to answer.'), { code: 'refusal' });
      if (!text && !calls.length && finish !== 'length') throw Object.assign(new Error('compat: empty response'), { category: 'invalid-response' });
      safe?.finish();
      remember(k, mode);
      const u = data.usage;
      return { text, ...(calls.length && { toolCalls: calls }), model: typeof data.model === 'string' ? data.model : '',
        finish: finish === 'length' ? 'length' : calls.length ? 'tool' : 'stop',
        ...(Number.isSafeInteger(u?.prompt_tokens) && { usage: { input: u.prompt_tokens, ...(Number.isSafeInteger(u.prompt_tokens_details?.cached_tokens) && { cached: u.prompt_tokens_details.cached_tokens }),
          ...(Number.isSafeInteger(u.prompt_tokens_details?.cache_write_tokens) && { cacheWrite: u.prompt_tokens_details.cache_write_tokens }), ...(Number.isSafeInteger(u.completion_tokens) && { output: u.completion_tokens }) } }) };
    }
    throw Object.assign(new Error('compat: every step down was refused'), { status: 400 });
  };
  const run = async (req, cfg, env) => {
    try { return await request(req, cfg, env); } catch (error) { throw E.safeError(error, cfg.key); }
  };

  // OpenRouter's catalog is public, so its key is checked on its own: GET <base>/key (the key's own record) answers 401 for
  // a key it doesn't know.
  const keyed = async (cfg, fetch, signal) => {
    if (!openrouter(cfg) || !cfg.key) return;
    const res = await fetch(`${cfg.base}/key`, { method: 'GET', credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error', cache: 'no-store', signal,
      headers: { accept: 'application/json', authorization: `Bearer ${cfg.key}` } });
    res.body?.cancel?.().catch(() => {});
    if (!res.ok) throw Object.assign(new Error(`key ${res.status}`), { status: res.status });
  };
  // Settings' Test: the key (OpenRouter's), the connection's catalog (lib/ai/models.js), and whether it names the model
  // (a connection with no model yet: ready once its catalog answers). → { state, reason?, status?, reference?, source? }:
  // a failure's category, HTTP status and reference, never the server's words.
  const status = async (cfg, { fetch = globalThis.fetch, signal, cache } = {}) => {
    let catalog;
    try { await keyed(cfg, fetch, signal); catalog = await M.list(cfg, { fetch, signal, cache }); } catch (e) { const f = F.modelFailure(E.safeError(e, cfg.key), { aborted: !!signal?.aborted }); return { state: 'unavailable', reason: f.category, ...(f.status && { status: f.status }), reference: f.reference }; }
    if (!cfg.model) return { state: 'ready', source: catalog.source };
    try { const s = M.select(cfg.model, catalog); return { state: 'ready', source: catalog.source, ...(s.unverified && { unverified: true }) }; } catch { return { state: 'unavailable', reason: 'model', source: catalog.source }; }
  };

  return P.add({ id: 'openai', config, caps, origin, status, run, catalog: (cfg, env) => M.list(cfg, env), toWire, fromWire, chatStream, redact });
})();
if (typeof module !== 'undefined') module.exports = GZ_AI_OPENAI; else GZ_AI_OPENAI;
